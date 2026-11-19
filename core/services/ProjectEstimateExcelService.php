<?php
declare(strict_types=1);

use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/ProjectTemplateService.php';

/**
 * Unified Excel Import / Export service for Estimating & Project Templates:
 * 1. Matches Excel rows against live Cost Catalog items & assemblies (exact + safe electrical fuzzy matching)
 * 2. Imports Project Template workbooks from templates/Project Templates/*.xlsx (all quantities zeroed)
 * 3. Exports an Estimate into a filled copy of templates/Project Estimate Export_Template.xlsx (Estimate, BoM Flat, Summary)
 * 4. Imports a Project from an exported Estimate Excel (quantities kept in Estimating; Takeoff canvas stays clean at 0 with override badge)
 */
class ProjectEstimateExcelService
{
    public static function cleanNorm(?string $text): string
    {
        if ($text === null) return '';
        $s = str_replace(['“', '”', '″'], '"', (string)$text);
        $s = str_replace(['‘', '’', '′'], "'", $s);
        $s = preg_replace('/\binstalation\b/i', 'installation', $s);
        $s = preg_replace('/\bsimplex\b/i', 'single', $s);
        $s = preg_replace('/\bw\/\s*/i', 'with ', $s);
        $s = preg_replace('/(\d+)\s*amps?\b/i', '$1a', $s);
        $s = preg_replace('/\s+/', ' ', trim($s));
        return strtolower($s);
    }

    private static function extractSignature(string $raw): array
    {
        $s = self::cleanNorm($raw);
        preg_match_all('/"([^"]+)"/', $s, $mQuotes);
        preg_match_all('/\b\d+a\b/', $s, $mAmps);
        preg_match_all('/#\d+(?:\/0)?\b/', $s, $mGauges);
        preg_match_all('/\b\d+(?:-\d+\/\d+|\/\d+)?"/', $s, $mSizes);
        preg_match_all('/\b\d+-?(?:pole|way)\b/', $s, $mPoles);
        preg_match_all('/[a-z0-9#"-]+/', $s, $mTokens);

        $q = array_values(array_unique($mQuotes[1] ?? [])); sort($q);
        $a = array_values(array_unique($mAmps[0] ?? [])); sort($a);
        $g = array_values(array_unique($mGauges[0] ?? [])); sort($g);
        $z = array_values(array_unique($mSizes[0] ?? [])); sort($z);
        $p = array_values(array_unique($mPoles[0] ?? [])); sort($p);
        $t = array_fill_keys($mTokens[0] ?? [], true);

        return [$q, $a, $g, $z, $p, $t, $s];
    }

    private static function isElectricallyCompatible(string $excelName, string $catalogName): bool
    {
        [$qa, $aa, $ga, $sa, $pa, $ta, $na] = self::extractSignature($excelName);
        [$qb, $ab, $gb, $sb, $pb, $tb, $nb] = self::extractSignature($catalogName);

        if ($qa !== $qb) return false;
        if ($aa && $ab && $aa !== $ab) return false;
        if ($ga && $gb && $ga !== $gb) return false;
        if ($sa && $sb && $sa !== $sb) return false;
        if ($pa && $pb && $pa !== $pb) return false;

        foreach (['gfci', 'usb', 'dimmer', 'timer', 'occupancy', 'locking', '3-way', '4-way', 'non-fused', 'fused', 'ig', 'weatherproof', 'demo', 'demolition'] as $kw) {
            $inA = isset($ta[$kw]) || str_contains($na, $kw);
            $inB = isset($tb[$kw]) || str_contains($nb, $kw);
            if ($inA !== $inB) return false;
        }

        $famA = array_intersect(array_keys($ta), ['single', 'duplex', 'quad']);
        $famB = array_intersect(array_keys($tb), ['single', 'duplex', 'quad']);
        if ($famA && $famB && array_values($famA) !== array_values($famB)) return false;

        $isAluA = isset($ta['alu']) || isset($ta['aluminum']);
        $isAluB = isset($tb['alu']) || isset($tb['aluminum']);
        $isCuA = isset($ta['cu']) || isset($ta['copper']);
        $isCuB = isset($tb['cu']) || isset($tb['copper']);
        if (($isAluA && $isCuB) || ($isCuA && $isAluB)) return false;

        return true;
    }

    public static function loadCatalogIndex(PDO $pdo): array
    {
        $cols = ProjectTemplateService::tableColumns($pdo, 'catalog_items');
        $hasCostType = isset($cols['cost_type']);
        $hasBudgetCode = isset($cols['budget_code']);
        $hasLaborCost = isset($cols['labor_cost']);
        $hasEquipCost = isset($cols['equipment_cost']);
        $hasSubCost = isset($cols['subcontractor_cost']);
        $hasMatCost = isset($cols['material_cost']);
        $hasRevision = isset($cols['revision']);
        $hasEnabled = isset($cols['enabled_for_projects']);

        $select = "ci.id, ci.catalog_id, ci.catalog_group_id, ci.name, ci.description, ci.item_type, ci.unit_of_measure, ci.unit_cost, ci.labor_hours, ci.catalog_number";
        $select .= $hasCostType ? ", ci.cost_type" : ", 'material' AS cost_type";
        $select .= $hasBudgetCode ? ", ci.budget_code" : ", '' AS budget_code";
        $select .= $hasMatCost ? ", ci.material_cost" : ", ci.unit_cost AS material_cost";
        $select .= $hasLaborCost ? ", ci.labor_cost" : ", 0 AS labor_cost";
        $select .= $hasEquipCost ? ", ci.equipment_cost" : ", 0 AS equipment_cost";
        $select .= $hasSubCost ? ", ci.subcontractor_cost" : ", 0 AS subcontractor_cost";
        $select .= $hasRevision ? ", ci.revision" : ", 1 AS revision";
        $select .= $hasEnabled ? ", ci.enabled_for_projects" : ", 1 AS enabled_for_projects";

        $catJoin = ProjectTemplateService::tableExists($pdo, 'catalogs') ? "LEFT JOIN catalogs c ON c.id = ci.catalog_id" : "";
        $grpJoin = ProjectTemplateService::tableExists($pdo, 'catalog_groups') ? "LEFT JOIN catalog_groups cg ON cg.id = ci.catalog_group_id" : "";
        $catNameSel = $catJoin ? ", c.name AS catalog_name" : ", '' AS catalog_name";
        $grpNameSel = $grpJoin ? ", cg.name AS group_name" : ", '' AS group_name";

        $rows = $pdo->query(
            "SELECT {$select}{$catNameSel}{$grpNameSel}
             FROM catalog_items ci
             {$catJoin}
             {$grpJoin}
             WHERE ci.deleted_at IS NULL"
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $byId = [];
        $byNorm = [];
        $inverted = [];
        foreach ($rows as $idx => $r) {
            $r['id'] = (int)$r['id'];
            $byId[$r['id']] = $r;
            $kn = self::cleanNorm((string)$r['name']);
            $r['_norm'] = $kn;
            $rows[$idx] = $r;
            $byNorm[$kn][] = $r;
            preg_match_all('/[a-z0-9#"-]{2,}/', $kn, $wm);
            foreach (array_unique($wm[0] ?? []) as $w) {
                $inverted[$w][] = $idx;
            }
        }

        // Load assembly components if assembly_parts table exists
        $partsByAssembly = [];
        if (ProjectTemplateService::tableExists($pdo, 'assembly_parts')) {
            $apCols = ProjectTemplateService::tableColumns($pdo, 'assembly_parts');
            $hasOrder = isset($apCols['sort_order']);
            $hasRatioType = isset($apCols['ratio_type']);
            $hasWaste = isset($apCols['waste_factor_percent']);
            $apSql = "SELECT assembly_catalog_item_id, part_catalog_item_id, quantity"
                . ($hasRatioType ? ", ratio_type" : ", 'per_unit' AS ratio_type")
                . ($hasWaste ? ", waste_factor_percent" : ", 0 AS waste_factor_percent")
                . " FROM assembly_parts"
                . ($hasOrder ? " ORDER BY sort_order ASC, id ASC" : " ORDER BY id ASC");
            foreach ($pdo->query($apSql)->fetchAll(PDO::FETCH_ASSOC) ?: [] as $ap) {
                $aid = (int)$ap['assembly_catalog_item_id'];
                $pid = (int)$ap['part_catalog_item_id'];
                if ($aid > 0 && $pid > 0 && isset($byId[$pid])) {
                    $partsByAssembly[$aid][] = $ap;
                }
            }
        }

        return [
            'rows' => $rows,
            'byId' => $byId,
            'byNorm' => $byNorm,
            'inverted' => $inverted,
            'partsByAssembly' => $partsByAssembly,
        ];
    }

    public static function matchCatalogItem(array $index, string $name, string $uom = '', bool $preferAssembly = false): ?array
    {
        $kn = self::cleanNorm($name);
        if ($kn === '') return null;

        $pickBestType = function (array $candidates) use ($preferAssembly) {
            if (!$candidates) return null;
            usort($candidates, function ($a, $b) use ($preferAssembly) {
                $aAsm = strtolower((string)($a['item_type'] ?? '')) === 'assembly' ? 1 : 0;
                $bAsm = strtolower((string)($b['item_type'] ?? '')) === 'assembly' ? 1 : 0;
                if ($aAsm !== $bAsm) return $preferAssembly ? ($bAsm - $aAsm) : ($aAsm - $bAsm);
                return (int)$b['id'] - (int)$a['id'];
            });
            return $candidates[0];
        };

        if (!empty($index['byNorm'][$kn])) {
            return $pickBestType($index['byNorm'][$kn]);
        }

        preg_match_all('/[a-z0-9#"-]{2,}/', $kn, $wm);
        $words = array_unique($wm[0] ?? []);
        if (!$words) return null;

        $candCounts = [];
        foreach ($words as $w) {
            foreach (($index['inverted'][$w] ?? []) as $ci) {
                $candCounts[$ci] = ($candCounts[$ci] ?? 0) + 1;
            }
        }
        arsort($candCounts);

        $uomClean = self::cleanNorm($uom ?: 'ea');
        $bestRow = null;
        $bestScore = 0.0;
        $checked = 0;
        foreach ($candCounts as $ci => $cnt) {
            if ($checked++ >= 30) break;
            $crow = $index['rows'][$ci];
            if (!self::isElectricallyCompatible($name, (string)$crow['name'])) continue;
            $cuom = self::cleanNorm((string)($crow['unit_of_measure'] ?: 'ea'));
            if ($uomClean !== '' && $cuom !== '' && $uomClean !== $cuom) {
                $bothLinear = in_array($uomClean, ['ft', 'lf'], true) && in_array($cuom, ['ft', 'lf'], true);
                $bothArea = in_array($uomClean, ['sq ft', 'sf', 'sqft'], true) && in_array($cuom, ['sq ft', 'sf', 'sqft'], true);
                if (!$bothLinear && !$bothArea) continue;
            }
            $ck = (string)$crow['_norm'];
            similar_text($kn, $ck, $pct);
            $score = $pct / 100.0;
            if ($preferAssembly && strtolower((string)($crow['item_type'] ?? '')) === 'assembly') {
                $score += 0.015;
            }
            if ($score > $bestScore) {
                $bestScore = $score;
                $bestRow = $crow;
            }
        }

        return ($bestRow && $bestScore >= 0.72) ? $bestRow : null;
    }

    public static function buildCatalogDto(array $row, array $index): array
    {
        $isAsm = strtolower((string)($row['item_type'] ?? '')) === 'assembly';
        $mat = (float)($row['material_cost'] ?? 0);
        $unit = (float)($row['unit_cost'] ?? 0);
        if ($mat <= 0 && $unit > 0) $mat = $unit;
        $equip = (float)($row['equipment_cost'] ?? 0);
        $sub = (float)($row['subcontractor_cost'] ?? 0);
        $laborHrs = (float)($row['labor_hours'] ?? 0);
        $costType = strtolower(trim((string)($row['cost_type'] ?? 'material')));
        if ($costType === 'equipment' && $equip <= 0 && $unit > 0) {
            $equip = $unit;
            $mat = 0.0;
        }
        $components = [];
        if ($isAsm) {
            foreach (($index['partsByAssembly'][(int)$row['id']] ?? []) as $ap) {
                $childRow = $index['byId'][(int)$ap['part_catalog_item_id']] ?? null;
                if (!$childRow) continue;
                $cMat = (float)($childRow['material_cost'] ?? 0);
                if ($cMat <= 0 && (float)($childRow['unit_cost'] ?? 0) > 0) $cMat = (float)$childRow['unit_cost'];
                $components[] = [
                    'id' => (string)$childRow['id'],
                    'catalogItemId' => (string)$childRow['id'],
                    'name' => (string)$childRow['name'],
                    'description' => (string)($childRow['description'] ?? ''),
                    'uom' => (string)($childRow['unit_of_measure'] ?: 'ea'),
                    'costCategory' => ucfirst((string)($childRow['cost_type'] ?: 'Materials')),
                    'budgetCode' => (string)($childRow['catalog_number'] ?: $childRow['budget_code'] ?: ''),
                    'costCode' => (string)($childRow['catalog_number'] ?: $childRow['budget_code'] ?: ''),
                    'ratio' => (float)($ap['quantity'] ?? 1),
                    'quantity' => (float)($ap['quantity'] ?? 1),
                    'ratioType' => (string)($ap['ratio_type'] ?: 'per_unit'),
                    'componentWaste' => (float)($ap['waste_factor_percent'] ?? 0),
                    'unitMaterialCost' => $cMat,
                    'unitEquipmentCost' => (float)($childRow['equipment_cost'] ?? 0),
                    'unitSubcontractorCost' => (float)($childRow['subcontractor_cost'] ?? 0),
                    'unitLabor' => (float)($childRow['labor_hours'] ?? 0),
                ];
            }
        }
        $uom = (string)($row['unit_of_measure'] ?: 'ea');
        $tkType = $uom === 'ft' || $uom === 'lf' ? 'Linear' : (in_array(strtolower($uom), ['sq ft', 'sf', 'sqft'], true) ? 'Area / Volume' : 'Count');
        return [
            'schema' => 'CatalogItemDTO/v1',
            'catalogItemId' => (string)$row['id'],
            'catalogRevision' => (int)($row['revision'] ?? 1) ?: 1,
            'type' => $isAsm ? 'Assembly' : $tkType,
            'costCategory' => $costType ?: 'material',
            'uom' => $uom,
            'pricing' => [
                'materialUnitCost' => $mat,
                'equipmentUnitCost' => $equip,
                'subcontractorUnitCost' => $sub,
                'laborHoursPerUnit' => $laborHrs,
                'laborRate' => 0,
                'legacyUnitCost' => $unit ?: $mat,
                'unitCost' => $unit ?: $mat,
            ],
            'takeoffDefaults' => [
                'measurementType' => strtolower($tkType) === 'linear' ? 'linear' : 'count',
                'symbol' => 'circle',
                'color' => '#2563eb',
                'markerSize' => null,
            ],
            'assemblyComponents' => $components,
            'catalog' => [
                'id' => (string)($row['catalog_id'] ?? ''),
                'name' => (string)($row['catalog_name'] ?? 'Cost Catalog'),
            ],
            'category' => [
                'id' => (string)($row['catalog_group_id'] ?? ''),
                'name' => (string)($row['group_name'] ?? ''),
            ],
        ];
    }

    private static function mapCategoryLabel(string $costType): string
    {
        $c = strtolower(trim($costType));
        if (str_contains($c, 'equip')) return 'Equipment';
        if (str_contains($c, 'labor')) return 'Labor';
        if (str_contains($c, 'sub')) return 'Subcontractor';
        return 'Materials';
    }

    public static function makeEstimatingItemFromCatalog(
        array $catalogRow,
        array $index,
        string $groupId,
        string $groupName,
        string $estimateId,
        int $projectId,
        array $overrides = []
    ): array {
        $dto = self::buildCatalogDto($catalogRow, $index);
        $isAsm = strtolower((string)($catalogRow['item_type'] ?? '')) === 'assembly';
        $itemId = ProjectTemplateService::uid('estitem');
        $layerId = ProjectTemplateService::uid('layer');

        $children = [];
        $matUnit = (float)($dto['pricing']['materialUnitCost'] ?? 0);
        $equipUnit = (float)($dto['pricing']['equipmentUnitCost'] ?? 0);
        $subUnit = (float)($dto['pricing']['subcontractorUnitCost'] ?? 0);
        $laborUnit = (float)($dto['pricing']['laborHoursPerUnit'] ?? 0);

        if ($isAsm && !empty($dto['assemblyComponents'])) {
            $sumMat = 0.0;
            $sumLabor = 0.0;
            foreach ($dto['assemblyComponents'] as $comp) {
                $ratio = (float)($comp['ratio'] ?? 1);
                $cMat = (float)($comp['unitMaterialCost'] ?? 0);
                $cLab = (float)($comp['unitLabor'] ?? 0);
                $sumMat += $ratio * $cMat;
                $sumLabor += $ratio * $cLab;
                $children[] = [
                    'id' => ProjectTemplateService::uid('estchild'),
                    'parentItemId' => $itemId,
                    'assemblyComponentId' => (string)$comp['catalogItemId'],
                    'catalogItemId' => (string)$comp['catalogItemId'],
                    'name' => (string)$comp['name'],
                    'description' => (string)($comp['description'] ?? ''),
                    'budgetCode' => (string)($comp['budgetCode'] ?? ''),
                    'costCode' => (string)($comp['costCode'] ?? ''),
                    'costCategory' => $comp['costCategory'] ?? 'Materials',
                    'uom' => (string)($comp['uom'] ?: 'ea'),
                    'ratio' => $ratio,
                    'ratioType' => (string)($comp['ratioType'] ?: 'per_unit'),
                    'componentWaste' => (float)($comp['componentWaste'] ?? 0),
                    'quantity' => 0,
                    'originalQuantity' => 0,
                    'unitCost' => $cMat,
                    'unitMaterialCost' => $cMat,
                    'unitEquipmentCost' => (float)($comp['unitEquipmentCost'] ?? 0),
                    'unitSubcontractorCost' => (float)($comp['unitSubcontractorCost'] ?? 0),
                    'unitLabor' => $cLab,
                    'laborUnitType' => 'hrs',
                    'waste' => null,
                    'materialMargin' => null,
                    'equipmentMargin' => null,
                    'laborMargin' => null,
                    'difficulty' => null,
                    'taxable' => true,
                    'multiplier' => 1,
                    'groupId' => $groupId,
                    'groupName' => $groupName,
                    'estimateId' => $estimateId,
                    'projectId' => (string)$projectId,
                    'isAssembly' => false,
                    'children' => [],
                ];
            }
            if ($sumMat > 0) $matUnit = $sumMat;
            if ($sumLabor > 0) $laborUnit = $sumLabor;
        }

        $qty = isset($overrides['quantity']) ? (float)$overrides['quantity'] : 0.0;
        $isOverride = !empty($overrides['quantityOverride']) && abs($qty) > 0.000001;
        $uom = trim((string)($overrides['uom'] ?? $catalogRow['unit_of_measure'] ?: 'ea'));
        $budgetCode = trim((string)($overrides['budgetCode'] ?? ($catalogRow['catalog_number'] ?: $catalogRow['budget_code'] ?: '')));
        $color = trim((string)($overrides['color'] ?? ''));
        if (!preg_match('/^#[0-9a-f]{3,8}$/i', $color)) $color = '#2563eb';
        $tkType = $uom === 'ft' || $uom === 'lf' ? 'Linear' : (in_array(strtolower($uom), ['sq ft', 'sf', 'sqft'], true) ? 'Area / Volume' : 'Count');

        return [
            'id' => $itemId,
            'takeoffLayerId' => $layerId,
            'catalogItemId' => (string)$catalogRow['id'],
            'catalogMetadata' => $dto,
            'name' => (string)$catalogRow['name'],
            'description' => trim((string)($overrides['description'] ?? ($catalogRow['description'] ?? ''))),
            'type' => $isAsm ? 'Assembly' : $tkType,
            'itemType' => $isAsm ? 'assembly' : strtolower($tkType),
            'budgetCode' => $budgetCode,
            'costCode' => $budgetCode,
            'costCategory' => self::mapCategoryLabel((string)($catalogRow['cost_type'] ?? 'material')),
            'originalQuantity' => 0,
            'quantity' => $qty,
            'unitCost' => $matUnit + $equipUnit + $subUnit,
            'unitMaterialCost' => $matUnit,
            'unitEquipmentCost' => $equipUnit,
            'unitSubcontractorCost' => $subUnit,
            'waste' => $overrides['waste'] ?? null,
            'materialMargin' => $overrides['materialMargin'] ?? null,
            'equipmentMargin' => $overrides['equipmentMargin'] ?? null,
            'unitLabor' => $laborUnit,
            'laborRate' => null,
            'laborUnitType' => 'hrs',
            'difficulty' => $overrides['difficulty'] ?? null,
            'laborMargin' => $overrides['laborMargin'] ?? null,
            'notes' => trim((string)($overrides['notes'] ?? '')),
            'taxable' => array_key_exists('taxable', $overrides) ? (bool)$overrides['taxable'] : true,
            'tag' => trim((string)($overrides['tag'] ?? '')),
            'color' => $color,
            'groupId' => $groupId,
            'groupName' => $groupName,
            'uom' => $uom,
            'projectId' => (string)$projectId,
            'estimateId' => $estimateId,
            'estimatingItemId' => $itemId,
            'lastSyncedTakeoffQuantity' => 0,
            'pendingTakeoffQuantity' => null,
            'quantityOverride' => $isOverride,
            'quantitySource' => $isOverride ? 'estimating' : 'takeoff',
            'quantitySyncStatus' => $overrides['quantitySyncStatus'] ?? ($isOverride ? 'overridden' : 'synced'),
            'quantityOverrideSource' => $overrides['quantityOverrideSource'] ?? ($isOverride ? 'estimating_first' : null),
            'addedFromEstimating' => $isOverride,
            'origin' => $overrides['origin'] ?? ($isOverride ? 'estimating' : 'takeoff'),
            'catalogRevision' => (int)($catalogRow['revision'] ?? 1) ?: 1,
            'catalogSnapshot' => $dto,
            'isAssembly' => $isAsm,
            'parentItemId' => null,
            'assemblyComponentId' => null,
            'children' => $children,
            'childrenQuantitiesExtended' => false,
            'assemblyExpansionPolicy' => 'CANONICAL',
            'ratio' => null,
            'factorOverride' => null,
            'ratioType' => 'per_unit',
            'spacing' => null,
            'componentWaste' => 0,
            'multiplier' => isset($overrides['multiplier']) ? (float)$overrides['multiplier'] : 1,
            'locked' => false,
            'tags' => [],
            'equipmentQuantity' => 0,
            'laborWaste' => null,
            '_manualFields' => [],
        ];
    }

    /**
     * Parses a template workbook (templates/Project Templates/*.xlsx) keeping only items/assemblies
     * matched (exact + electrical fuzzy) to live Cost Catalog, all quantities strictly at 0.
     */
    public static function importTemplateWorkbook(PDO $pdo, string $filePath, ?string $templateName = null): array
    {
        if (!is_file($filePath)) {
            throw new RuntimeException("Template file not found: {$filePath}");
        }
        $catalogIndex = self::loadCatalogIndex($pdo);
        $spreadsheet = IOFactory::load($filePath);
        $ws = $spreadsheet->getSheetByName('Estimate') ?? $spreadsheet->getSheet(0);
        $maxRow = $ws->getHighestRow();

        // Detect header row (R1 in Project Templates, R6 in Export Template)
        $headerRow = 1;
        for ($r = 1; $r <= min(10, $maxRow); $r++) {
            $val = self::cleanNorm((string)$ws->getCell("A{$r}")->getValue());
            if ($val === 'cost item') {
                $headerRow = $r;
                break;
            }
        }
        $colMap = [];
        $maxCol = \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($ws->getHighestColumn());
        for ($c = 1; $c <= $maxCol; $c++) {
            $h = self::cleanNorm((string)$ws->getCell([$c, $headerRow])->getValue());
            if ($h !== '') $colMap[$h] = $c;
        }
        $colColor = $colMap['color'] ?? null;
        $colBudget = $colMap['budget code'] ?? 4;
        $colUom = $colMap['uom (quantity)'] ?? ($colMap['uom'] ?? 6);
        $colDesc = $colMap['description'] ?? 2;

        // Parse rows using outline levels (0=group, 1=item/assembly, 2=child)
        $rawGroups = [];
        $currentGroup = null;
        $rows = [];
        for ($r = $headerRow + 1; $r <= $maxRow; $r++) {
            $lvl = (int)$ws->getRowDimension($r)->getOutlineLevel();
            $name = trim((string)$ws->getCell([1, $r])->getValue());
            if ($name === '') continue;
            $rows[] = [
                'row' => $r,
                'lvl' => $lvl,
                'name' => $name,
                'desc' => trim((string)$ws->getCell([$colDesc, $r])->getValue()),
                'color' => $colColor ? trim((string)$ws->getCell([$colColor, $r])->getValue()) : '',
                'budget' => trim((string)$ws->getCell([$colBudget, $r])->getValue()),
                'uom' => trim((string)$ws->getCell([$colUom, $r])->getValue()),
            ];
        }

        // Look ahead so each lvl1 knows whether it has lvl2 children (prefers Assembly in catalog)
        $nRows = count($rows);
        for ($i = 0; $i < $nRows; $i++) {
            $entry = $rows[$i];
            if ($entry['lvl'] === 0) {
                $currentGroup = ['name' => $entry['name'], 'items' => []];
                $rawGroups[] = $currentGroup;
            } elseif ($entry['lvl'] === 1) {
                if (!$currentGroup) {
                    $currentGroup = ['name' => 'General', 'items' => []];
                    $rawGroups[] = $currentGroup;
                }
                $hasChildren = ($i + 1 < $nRows && $rows[$i + 1]['lvl'] === 2);
                $matched = self::matchCatalogItem($catalogIndex, $entry['name'], $entry['uom'], $hasChildren);
                if ($matched) {
                    $idxLast = count($rawGroups) - 1;
                    $rawGroups[$idxLast]['items'][] = [
                        'catalogRow' => $matched,
                        'color' => $entry['color'],
                    ];
                }
            }
        }

        $tplName = trim((string)$templateName);
        if ($tplName === '') {
            $tplName = pathinfo($filePath, PATHINFO_FILENAME);
        }

        $pdo->beginTransaction();
        try {
            // Reuse or create template project in status = 'templates'
            $findP = $pdo->prepare("SELECT id FROM projects WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL LIMIT 1");
            $findP->execute([$tplName]);
            $projectId = (int)$findP->fetchColumn();
            if ($projectId > 0) {
                $pdo->prepare("UPDATE projects SET status = 'templates', description = ? WHERE id = ?")
                    ->execute(["Imported from {$tplName}.xlsx (Cost Catalog synced)", $projectId]);
                // Clean old estimates & takeoff layers on re-import so template matches latest catalog cleanly
                $pdo->prepare("UPDATE takeoff_layers SET deleted_at = CURRENT_TIMESTAMP WHERE project_id = ?")->execute([$projectId]);
                $pdo->prepare("UPDATE estimates SET deleted_at = CURRENT_TIMESTAMP WHERE project_id = ?")->execute([$projectId]);
            } else {
                $meta = json_encode(['is_template' => true, 'estimator' => 'Juan Estevez', 'measurement_system' => 'US', 'estimate_pricing' => 'Unlocked'], JSON_UNESCAPED_SLASHES);
                $pdo->prepare("INSERT INTO projects (name, description, status, metadata_json) VALUES (?, ?, 'templates', ?)")
                    ->execute([$tplName, "Imported from {$tplName}.xlsx (Cost Catalog synced)", $meta]);
                $projectId = (int)$pdo->lastInsertId();
            }

            $tplId = ProjectTemplateService::upsertTemplateEntryForProject($pdo, $projectId, $tplName, "Cost Catalog synced template ({$tplName})");
            if ($tplId > 0) {
                $pdo->prepare("UPDATE projects SET project_template_id = ? WHERE id = ?")->execute([$tplId, $projectId]);
            }

            $estSettings = ProjectTemplateService::defaultEstimateSettings($pdo);
            $clientEstId = ProjectTemplateService::uid('estimate');
            $pdo->prepare(
                "INSERT INTO estimates (project_id, name, description, status, currency_code, settings_json, notes_json, subtotal_cost, markup_total, tax_total, total_cost, labor_hours_total)
                 VALUES (?, ?, ?, 'draft', 'USD', ?, ?, 0, 0, 0, 0, 0)"
            )->execute([
                $projectId,
                $tplName . ' Baseline',
                'Template Estimate',
                json_encode($estSettings, JSON_UNESCAPED_SLASHES),
                json_encode(['scope' => '', 'included' => [], 'excluded' => []], JSON_UNESCAPED_SLASHES),
            ]);
            $estimateId = (int)$pdo->lastInsertId();

            $groupsPayload = [];
            $matchedCount = 0;
            $sort = 0;
            foreach ($rawGroups as $rg) {
                if (empty($rg['items'])) continue;
                $gid = ProjectTemplateService::uid('estgrp');
                $tkGid = 'takeoff_group_' . ProjectTemplateService::uid('grp');
                $estItems = [];
                foreach ($rg['items'] as $itemSpec) {
                    $estItem = self::makeEstimatingItemFromCatalog(
                        $itemSpec['catalogRow'],
                        $catalogIndex,
                        $gid,
                        $rg['name'],
                        $clientEstId,
                        $projectId,
                        ['quantity' => 0, 'color' => $itemSpec['color']]
                    );
                    $estItems[] = $estItem;
                    $matchedCount++;
                }
                $groupsPayload[] = [
                    'id' => $gid,
                    'takeoffGroupId' => $tkGid,
                    'source' => 'takeoff',
                    'name' => $rg['name'],
                    'expanded' => true,
                    'sortOrder' => $sort++,
                    'items' => $estItems,
                ];
            }

            $workspace = [
                'id' => $clientEstId,
                'dbEstimateId' => $estimateId,
                'estimateItemId' => $estimateId,
                'isActive' => true,
                'isLocked' => false,
                'is_primary' => true,
                'isPrimary' => true,
                'estimateTotal' => 0,
                'totalSales' => 0,
                'estimateSummary' => ['material' => 0, 'labor' => 0, 'equipment' => 0, 'waste' => 0, 'markup' => 0, 'estimateTotal' => 0, 'total' => 0, 'laborHours' => 0],
                'revision' => 1,
                'estimateRevision' => 1,
                'projectId' => (string)$projectId,
                'name' => $tplName . ' Baseline',
                'status' => 'draft',
                'creationMode' => 'template',
                'takeoffSyncMode' => 'linked',
                'createdAt' => gmdate('c'),
                'updatedAt' => gmdate('c'),
                'groups' => $groupsPayload,
                'notes' => ['scope' => '', 'included' => [], 'excluded' => []],
                'settings' => $estSettings,
                'auditLog' => [],
                'grand_total' => 0,
                'total_amount' => 0,
            ];

            $pdo->prepare("INSERT INTO estimate_workspace_states (estimate_id, project_id, client_estimate_id, state_json, revision) VALUES (?, ?, ?, ?, 1)")
                ->execute([$estimateId, $projectId, $clientEstId, json_encode($workspace, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);

            ProjectTemplateService::ensureTakeoffLayersFromWorkspace($pdo, $projectId, $clientEstId);
            ProjectTemplateService::resetProjectQuantitiesToZero($pdo, $projectId);
            ProjectTemplateService::syncPrimaryEstimateMetadata($pdo, $projectId, true);

            $pdo->commit();
            return [
                'project_id' => $projectId,
                'template_id' => $tplId,
                'estimate_id' => $estimateId,
                'name' => $tplName,
                'groups' => count($groupsPayload),
                'items_matched' => $matchedCount,
            ];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Computes server-side financial row values matching estimating_export_service.js & estimate_calculation_service.js
     */
    private static function computeEstimateRowMetrics(array $item, array $settings, float $groupMultiplier = 1.0): array
    {
        $qty = (float)($item['quantity'] ?? 0);
        $totQty = $qty * $groupMultiplier;
        $laborCostRate = (float)($settings['globalLaborCost'] ?? 36);
        $defLaborMargin = (float)($settings['globalLaborMargin'] ?? 34.6);
        $defMatMargin = (float)($settings['materialMargin'] ?? 15);
        $defEqMargin = (float)($settings['equipmentMargin'] ?? 15);
        $defMatWaste = (float)($settings['materialWaste'] ?? 0);
        $defDiff = (float)($settings['laborDifficulty'] ?? 1);

        $isEq = stripos((string)($item['costCategory'] ?? ''), 'equip') !== false;
        $wastePct = isset($item['waste']) && $item['waste'] !== null && $item['waste'] !== '' ? (float)$item['waste'] : ($isEq ? (float)($settings['equipmentWaste'] ?? 0) : $defMatWaste);
        $marginPct = $isEq
            ? (isset($item['equipmentMargin']) && $item['equipmentMargin'] !== null && $item['equipmentMargin'] !== '' ? (float)$item['equipmentMargin'] : $defEqMargin)
            : (isset($item['materialMargin']) && $item['materialMargin'] !== null && $item['materialMargin'] !== '' ? (float)$item['materialMargin'] : $defMatMargin);
        $laborMarginPct = isset($item['laborMargin']) && $item['laborMargin'] !== null && $item['laborMargin'] !== '' ? (float)$item['laborMargin'] : $defLaborMargin;
        $diff = isset($item['difficulty']) && $item['difficulty'] !== null && $item['difficulty'] !== '' ? (float)$item['difficulty'] : $defDiff;

        $unitCost = (float)($item['unitMaterialCost'] ?? $item['unitEquipmentCost'] ?? $item['unitCost'] ?? 0);
        if ($isEq && (float)($item['unitEquipmentCost'] ?? 0) > 0) $unitCost = (float)$item['unitEquipmentCost'];
        if (!$isEq && $unitCost <= 0 && (float)($item['unitCost'] ?? 0) > 0) $unitCost = (float)$item['unitCost'];
        $unitLabor = (float)($item['unitLabor'] ?? 0);

        $wasteUnits = $totQty * ($wastePct / 100.0);
        $wasteDollars = $wasteUnits * $unitCost;
        $subItemCost = $totQty * $unitCost + $wasteDollars;

        $mFrac = min(0.999, max(0.0, $marginPct / 100.0));
        $unitSales = $marginPct > 0 ? ($unitCost / (1.0 - $mFrac)) : $unitCost;
        $markupPct = ($unitCost > 0 && $marginPct > 0) ? (($unitSales / $unitCost - 1.0) * 100.0) : ($marginPct > 0 ? ($marginPct / (1.0 - $mFrac)) : 0.0);
        $subItemSales = ($subItemCost > 0 && $marginPct > 0) ? ($subItemCost / (1.0 - $mFrac)) : $subItemCost;
        $profitMat = $subItemSales - $subItemCost;

        $totLaborHrs = $totQty * $unitLabor * $diff;
        $laborCost = $totLaborHrs * $laborCostRate;
        $lFrac = min(0.999, max(0.0, $laborMarginPct / 100.0));
        $laborSales = $laborMarginPct > 0 ? ($laborCost / (1.0 - $lFrac)) : $laborCost;
        $profitTotal = $profitMat + ($laborSales - $laborCost);
        $totalSales = $subItemSales + $laborSales;

        return [
            'qty' => $qty,
            'totQty' => $totQty,
            'groupMultiplier' => $groupMultiplier,
            'wastePct' => $wastePct,
            'unitCost' => $unitCost,
            'wasteDollars' => $wasteDollars,
            'subItemCost' => $subItemCost,
            'marginPct' => $marginPct,
            'markupPct' => $markupPct,
            'unitSales' => $unitSales,
            'subItemSales' => $subItemSales,
            'profit' => $profitTotal,
            'unitLabor' => $unitLabor,
            'diff' => $diff,
            'totLaborHrs' => $totLaborHrs,
            'laborCost' => $laborCost,
            'laborSales' => $laborSales,
            'totalSales' => $totalSales,
            'isEq' => $isEq,
        ];
    }

    public static function syncDirectoryTemplates(PDO $pdo, ?string $dir = null): array
    {
        $folder = $dir ?: (__DIR__ . '/../../templates/Project Templates');
        if (!is_dir($folder)) {
            throw new RuntimeException("Templates directory not found: {$folder}");
        }
        $files = glob(rtrim($folder, '/\\') . DIRECTORY_SEPARATOR . '*.xlsx') ?: [];
        sort($files);
        $summary = [];
        foreach ($files as $filePath) {
            $summary[] = self::importTemplateWorkbook($pdo, $filePath);
        }
        return $summary;
    }

    /**
     * Generates an .xlsx binary using templates/Project Estimate Export_Template.xlsx
     */
    public static function exportEstimateWorkbook(
        PDO $pdo,
        int $projectId,
        ?string $clientEstimateId = null,
        ?array $livePayload = null
    ): array {
        $templatePath = __DIR__ . '/../../templates/Project Estimate Export_Template.xlsx';
        if (!is_file($templatePath)) {
            throw new RuntimeException('Export template file is missing: templates/Project Estimate Export_Template.xlsx');
        }

        $projStmt = $pdo->prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $projStmt->execute([$projectId]);
        $project = $projStmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $projectMeta = ProjectTemplateService::decodeJson($project['metadata_json'] ?? null);

        $estimate = is_array($livePayload['estimate'] ?? null) ? $livePayload['estimate'] : null;
        if (!$estimate) {
            $sql = "SELECT e.*, ws.client_estimate_id, ws.state_json FROM estimates e LEFT JOIN estimate_workspace_states ws ON ws.estimate_id = e.id WHERE e.project_id = ? AND e.deleted_at IS NULL ORDER BY e.id ASC";
            $estStmt = $pdo->prepare($sql);
            $estStmt->execute([$projectId]);
            $rows = $estStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $chosen = $rows[0] ?? null;
            foreach ($rows as $row) {
                if ($clientEstimateId && ((string)$row['client_estimate_id'] === $clientEstimateId || (string)$row['id'] === $clientEstimateId)) {
                    $chosen = $row;
                    break;
                }
            }
            $estimate = $chosen ? ProjectTemplateService::decodeJson($chosen['state_json'] ?? '') : [];
            if ($chosen && empty($estimate['name'])) $estimate['name'] = $chosen['name'];
        }
        if (!is_array($estimate)) {
            throw new RuntimeException('No estimate found to export.');
        }

        $settings = is_array($estimate['settings'] ?? null) ? $estimate['settings'] : ProjectTemplateService::defaultEstimateSettings($pdo);
        $notes = is_array($estimate['notes'] ?? null) ? $estimate['notes'] : [];

        $spreadsheet = IOFactory::load($templatePath);

        // 1. ESTIMATE SHEET
        $wsEst = $spreadsheet->getSheetByName('Estimate');
        if ($wsEst) {
            // Capture style xf indices before clearing sample rows
            $styleGroup = [];
            $styleItem = [];
            $styleChild = [];
            $styleTotal = [];
            for ($c = 1; $c <= 25; $c++) {
                $styleGroup[$c] = $wsEst->getCell([$c, 7])->getXfIndex();
                $styleItem[$c] = $wsEst->getCell([$c, 8])->getXfIndex();
                $styleChild[$c] = $wsEst->getCell([$c, 28])->getXfIndex();
                $styleTotal[$c] = $wsEst->getCell([$c, $wsEst->getHighestRow()])->getXfIndex();
            }
            $oldHighest = $wsEst->getHighestRow();
            if ($oldHighest >= 7) {
                $wsEst->removeRow(7, $oldHighest - 6);
            }

            $projName = (string)($project['name'] ?? ($estimate['name'] ?? 'Project Estimate'));
            $projDesc = (string)($project['description'] ?? '');
            $dueRaw = (string)($project['bid_due_at'] ?? '');
            $dueFmt = $dueRaw !== '' ? substr($dueRaw, 0, 10) : '';
            $scopeText = (string)($notes['scope'] ?? '');

            $wsEst->setCellValue('A1', 'Proyect Name: "' . $projName . '"');
            $wsEst->setCellValue('A2', 'Proyect Description: "' . $projDesc . '"');
            $wsEst->setCellValue('A3', 'Due Date: "' . $dueFmt . '" ');
            $wsEst->setCellValue('A4', 'Scope of Work: "' . $scopeText . '"');

            $r = 7;
            $bomMap = [];
            $totals = [
                'matCost' => 0.0, 'matSales' => 0.0, 'matLaborHrs' => 0.0, 'matLaborCost' => 0.0, 'matLaborSales' => 0.0,
                'eqCost' => 0.0, 'eqSales' => 0.0, 'eqLaborHrs' => 0.0, 'eqLaborCost' => 0.0, 'eqLaborSales' => 0.0,
                'subCost' => 0.0, 'subSales' => 0.0, 'profit' => 0.0, 'totLaborHrs' => 0.0, 'totLaborCost' => 0.0, 'totSales' => 0.0,
                'taxableMatSales' => 0.0, 'taxableEqSales' => 0.0,
            ];

            foreach (($estimate['groups'] ?? []) as $group) {
                if (!is_array($group)) continue;
                $gName = (string)($group['name'] ?? 'Group');
                $gMult = (float)($group['multiplier'] ?? 1) ?: 1.0;

                // Pre-sum group metrics
                $gQtySum = 0.0; $gTotQtySum = 0.0; $gSubCost = 0.0; $gSubSales = 0.0; $gProfit = 0.0; $gLabHrs = 0.0; $gLabCost = 0.0; $gTotSales = 0.0;
                $gBudget = '';
                $groupItemMetrics = [];
                foreach (($group['items'] ?? []) as $item) {
                    if (!is_array($item)) continue;
                    if ($gBudget === '' && !empty($item['budgetCode'])) $gBudget = (string)$item['budgetCode'];
                    $itemMult = isset($item['multiplier']) && is_numeric($item['multiplier']) ? (float)$item['multiplier'] : $gMult;
                    $m = self::computeEstimateRowMetrics($item, $settings, $itemMult);
                    $groupItemMetrics[] = [$item, $m];
                    $gQtySum += $m['qty'];
                    $gTotQtySum += $m['totQty'];
                    $gSubCost += $m['subItemCost'];
                    $gSubSales += $m['subItemSales'];
                    $gProfit += $m['profit'];
                    $gLabHrs += $m['totLaborHrs'];
                    $gLabCost += $m['laborCost'];
                    $gTotSales += $m['totalSales'];
                }

                // Write Group row (lvl=0)
                $gRow = [$gName, null, null, $gBudget, $gQtySum, 'ea', $gTotQtySum, $gMult, '--', '--', '--', round($gSubCost, 4), '--', '--', '--', round($gSubSales, 4), round($gProfit, 4), '--', '--', '--', round($gLabHrs, 4), round($gLabCost, 4), round($gTotSales, 4), null, 'Yes'];
                foreach ($gRow as $idx => $val) {
                    $c = $idx + 1;
                    $wsEst->setCellValue([$c, $r], $val);
                    if (isset($styleGroup[$c])) $wsEst->getCell([$c, $r])->setXfIndex($styleGroup[$c]);
                }
                $wsEst->getRowDimension($r)->setOutlineLevel(0);
                $r++;

                foreach ($groupItemMetrics as [$item, $m]) {
                    $isAsm = !empty($item['isAssembly']) || !empty($item['children']);
                    $taxable = !array_key_exists('taxable', $item) || !empty($item['taxable']);
                    $iRow = [
                        (string)($item['name'] ?? ''),
                        $item['tag'] ?? null,
                        $item['description'] ?? null,
                        $item['budgetCode'] ?? ($item['costCode'] ?? null),
                        $m['qty'],
                        $item['uom'] ?? 'ea',
                        $m['totQty'],
                        $m['groupMultiplier'],
                        $m['wastePct'],
                        $m['unitCost'],
                        round($m['wasteDollars'], 4),
                        round($m['subItemCost'], 4),
                        $m['marginPct'],
                        round($m['markupPct'], 6),
                        round($m['unitSales'], 6),
                        round($m['subItemSales'], 4),
                        round($m['profit'], 4),
                        $m['unitLabor'],
                        $item['laborUnitType'] ?? 'hrs',
                        $m['diff'],
                        round($m['totLaborHrs'], 4),
                        round($m['laborCost'], 4),
                        round($m['totalSales'], 4),
                        $item['notes'] ?? null,
                        $taxable ? 'Yes' : 'No',
                    ];
                    foreach ($iRow as $idx => $val) {
                        $c = $idx + 1;
                        $wsEst->setCellValue([$c, $r], $val);
                        if (isset($styleItem[$c])) $wsEst->getCell([$c, $r])->setXfIndex($styleItem[$c]);
                    }
                    $wsEst->getRowDimension($r)->setOutlineLevel(1);
                    $r++;

                    // Accumulate overall financial totals at item level
                    $totals['subCost'] += $m['subItemCost'];
                    $totals['subSales'] += $m['subItemSales'];
                    $totals['profit'] += $m['profit'];
                    $totals['totLaborHrs'] += $m['totLaborHrs'];
                    $totals['totLaborCost'] += $m['laborCost'];
                    $totals['totSales'] += $m['totalSales'];
                    if ($m['isEq']) {
                        $totals['eqCost'] += $m['subItemCost'];
                        $totals['eqSales'] += $m['subItemSales'];
                        if ($taxable) $totals['taxableEqSales'] += $m['subItemSales'];
                    } else {
                        $totals['matCost'] += $m['subItemCost'];
                        $totals['matSales'] += $m['subItemSales'];
                        if ($taxable) $totals['taxableMatSales'] += $m['subItemSales'];
                    }

                    // Children rows (lvl=2) + BoM Flat accumulation
                    if ($isAsm && !empty($item['children']) && is_array($item['children'])) {
                        foreach ($item['children'] as $child) {
                            if (!is_array($child)) continue;
                            $ratio = (float)($child['ratio'] ?? $child['quantity'] ?? 1);
                            $childQty = $m['totQty'] * $ratio;
                            $childRowItem = $child;
                            $childRowItem['quantity'] = $childQty;
                            $cm = self::computeEstimateRowMetrics($childRowItem, $settings, 1.0);
                            $cRow = [
                                (string)($child['name'] ?? ''),
                                null,
                                $child['description'] ?? null,
                                $child['budgetCode'] ?? ($item['budgetCode'] ?? null),
                                $childQty,
                                $child['uom'] ?? 'ea',
                                $childQty,
                                1,
                                $cm['wastePct'],
                                $cm['unitCost'],
                                round($cm['wasteDollars'], 4),
                                round($cm['subItemCost'], 4),
                                $cm['marginPct'],
                                round($cm['markupPct'], 6),
                                round($cm['unitSales'], 6),
                                round($cm['subItemSales'], 4),
                                round($cm['profit'], 4),
                                $cm['unitLabor'],
                                $child['laborUnitType'] ?? 'hrs',
                                '--',
                                round($cm['totLaborHrs'], 4),
                                round($cm['laborCost'], 4),
                                round($cm['totalSales'], 4),
                                $child['notes'] ?? null,
                                $taxable ? 'Yes' : 'No',
                            ];
                            foreach ($cRow as $idx => $val) {
                                $c = $idx + 1;
                                $wsEst->setCellValue([$c, $r], $val);
                                if (isset($styleChild[$c])) $wsEst->getCell([$c, $r])->setXfIndex($styleChild[$c]);
                            }
                            $wsEst->getRowDimension($r)->setOutlineLevel(2);
                            $r++;

                            // Consolidate child leaf into BoM Flat
                            $bName = trim((string)($child['name'] ?? ''));
                            $bCode = trim((string)($child['budgetCode'] ?? $child['costCode'] ?? ''));
                            $bUom = trim((string)($child['uom'] ?? 'ea'));
                            $bCost = round((float)$cm['unitCost'], 5);
                            $bKey = strtolower($bName) . '|' . strtolower($bCode) . '|' . strtolower($bUom) . '|' . $bCost;
                            if (!isset($bomMap[$bKey])) {
                                $bomMap[$bKey] = ['qty' => 0.0, 'name' => $bName, 'part' => $bCode ?: null, 'uom' => $bUom, 'cost' => $bCost];
                            }
                            $bomMap[$bKey]['qty'] += $childQty;
                        }
                    } else {
                        // Simple item leaf goes directly to BoM Flat
                        $bName = trim((string)($item['name'] ?? ''));
                        $bCode = trim((string)($item['budgetCode'] ?? $item['costCode'] ?? ''));
                        $bUom = trim((string)($item['uom'] ?? 'ea'));
                        $bCost = round((float)$m['unitCost'], 5);
                        $bKey = strtolower($bName) . '|' . strtolower($bCode) . '|' . strtolower($bUom) . '|' . $bCost;
                        if (!isset($bomMap[$bKey])) {
                            $bomMap[$bKey] = ['qty' => 0.0, 'name' => $bName, 'part' => $bCode ?: null, 'uom' => $bUom, 'cost' => $bCost];
                        }
                        $bomMap[$bKey]['qty'] += $m['totQty'];
                    }
                }
            }

            // Final Grand Total row on Estimate sheet
            $totRow = [null, null, null, null, '--', null, '--', '--', '--', '--', '--', round($totals['subCost'], 4), '--', '--', '--', round($totals['subSales'], 4), round($totals['profit'], 4), '--', null, '--', round($totals['totLaborHrs'], 4), round($totals['totLaborCost'], 4), round($totals['totSales'], 4), null, null];
            foreach ($totRow as $idx => $val) {
                $c = $idx + 1;
                $wsEst->setCellValue([$c, $r], $val);
                if (isset($styleTotal[$c])) $wsEst->getCell([$c, $r])->setXfIndex($styleTotal[$c]);
            }
            $wsEst->getRowDimension($r)->setOutlineLevel(0);

            // 2. BoM Flat SHEET
            $wsBom = $spreadsheet->getSheetByName('BoM Flat');
            if ($wsBom) {
                $bomStyleItem = [];
                $bomStyleTotal = [];
                $bomOldMax = $wsBom->getHighestRow();
                for ($c = 1; $c <= 6; $c++) {
                    $bomStyleItem[$c] = $wsBom->getCell([$c, 7])->getXfIndex();
                    $bomStyleTotal[$c] = $wsBom->getCell([$c, $bomOldMax])->getXfIndex();
                }
                if ($bomOldMax >= 7) {
                    $wsBom->removeRow(7, $bomOldMax - 6);
                }
                $bomList = array_values($bomMap);
                usort($bomList, fn($a, $b) => strcasecmp($a['name'], $b['name']));
                $br = 7;
                foreach ($bomList as $entry) {
                    $vals = [$entry['qty'], $entry['name'], $entry['part'], $entry['uom'], $entry['cost'], "=A{$br}*E{$br}"];
                    foreach ($vals as $idx => $v) {
                        $c = $idx + 1;
                        $wsBom->setCellValue([$c, $br], $v);
                        if (isset($bomStyleItem[$c])) $wsBom->getCell([$c, $br])->setXfIndex($bomStyleItem[$c]);
                    }
                    $br++;
                }
                $endFormula = $br > 7 ? "=SUM(F7:F" . ($br - 1) . ")" : 0;
                $bomTotVals = [null, null, null, null, 'TOTAL', $endFormula];
                foreach ($bomTotVals as $idx => $v) {
                    $c = $idx + 1;
                    $wsBom->setCellValue([$c, $br], $v);
                    if (isset($bomStyleTotal[$c])) $wsBom->getCell([$c, $br])->setXfIndex($bomStyleTotal[$c]);
                }
            }

            // 3. SUMMARY SHEET
            $wsSum = $spreadsheet->getSheetByName('Summary');
            if ($wsSum) {
                $lMargin = (float)($settings['globalLaborMargin'] ?? 34.6);
                $lFrac = min(0.999, max(0.0, $lMargin / 100.0));
                $laborSalesTotal = $lMargin > 0 ? ($totals['totLaborCost'] / (1.0 - $lFrac)) : $totals['totLaborCost'];
                $laborProfit = $laborSalesTotal - $totals['totLaborCost'];

                $matProfit = $totals['matSales'] - $totals['matCost'];
                $eqProfit = $totals['eqSales'] - $totals['eqCost'];
                $matMarginEff = $totals['matSales'] > 0 ? ($matProfit / $totals['matSales']) * 100.0 : (float)($settings['materialMargin'] ?? 15);
                $eqMarginEff = $totals['eqSales'] > 0 ? ($eqProfit / $totals['eqSales']) * 100.0 : (float)($settings['equipmentMargin'] ?? 15);

                $directCost = $totals['totLaborCost'] + $totals['matCost'] + $totals['eqCost'];
                $directSales = $laborSalesTotal + $totals['matSales'] + $totals['eqSales'];
                $directProfit = $directSales - $directCost;
                $directMargin = $directSales > 0 ? ($directProfit / $directSales) * 100.0 : 0.0;

                // Row 4: Labor
                $wsSum->fromArray(['Labor', round($totals['totLaborHrs'], 4), (float)($settings['laborDifficulty'] ?? 1), (float)($settings['laborWaste'] ?? 0), round($totals['totLaborCost'], 2), round($lMargin, 2), round($laborSalesTotal, 2), round($laborProfit, 2)], null, 'A4');
                // Row 5: Materials
                $wsSum->fromArray(['Materials', 0, 0, (float)($settings['materialWaste'] ?? 0), round($totals['matCost'], 2), round($matMarginEff, 2), round($totals['matSales'], 2), round($matProfit, 2)], null, 'A5');
                // Row 6: Equipment
                $wsSum->fromArray(['Equipment', 0, 0, (float)($settings['equipmentWaste'] ?? 0), round($totals['eqCost'], 2), round($eqMarginEff, 2), round($totals['eqSales'], 2), round($eqProfit, 2)], null, 'A6');
                // Row 7: Subtotal
                $wsSum->fromArray(['Subtotal', '--', '--', '--', round($directCost, 2), round($directMargin, 2), round($directSales, 2), round($directProfit, 2)], null, 'A7');

                $preTaxSum = 0.0;
                foreach (($settings['preTaxMarkups'] ?? []) as $mk) {
                    if (empty($mk['active'])) continue;
                    $amt = ($mk['type'] ?? 'percentage') === 'percentage'
                        ? $directSales * ((float)($mk['percent'] ?? 0) / 100.0)
                        : (float)($mk['amount'] ?? 0);
                    if (($mk['operator'] ?? 'add') === 'subtract') $amt = -$amt;
                    $preTaxSum += $amt;
                }
                $wsSum->setCellValue('H11', round($preTaxSum, 2));

                $taxCfg = is_array($settings['taxes'] ?? null) ? $settings['taxes'] : [];
                $taxSum = ($totals['taxableMatSales'] * ((float)($taxCfg['Materials'] ?? 0) / 100.0))
                    + ($laborSalesTotal * ((float)($taxCfg['Labor'] ?? 0) / 100.0))
                    + ($totals['taxableEqSales'] * ((float)($taxCfg['Equipment'] ?? 0) / 100.0));
                $wsSum->setCellValue('H15', round($taxSum, 2));

                $postBase = $directSales + $preTaxSum + $taxSum;
                $postTaxSum = 0.0;
                foreach (($settings['postTaxMarkups'] ?? []) as $mk) {
                    if (empty($mk['active'])) continue;
                    $amt = ($mk['type'] ?? 'percentage') === 'percentage'
                        ? $postBase * ((float)($mk['percent'] ?? 0) / 100.0)
                        : (float)($mk['amount'] ?? 0);
                    if (($mk['operator'] ?? 'add') === 'subtract') $amt = -$amt;
                    $postTaxSum += $amt;
                }
                $wsSum->setCellValue('H19', round($postTaxSum, 2));
                $grandTotal = round($directSales + $preTaxSum + $taxSum + $postTaxSum, 2);
                $wsSum->setCellValue('A23', $grandTotal);
            }
        }

        $tmp = tempnam(sys_get_temp_dir(), 'est_exp_');
        $writer = new Xlsx($spreadsheet);
        $writer->save($tmp);
        $binary = file_get_contents($tmp);
        @unlink($tmp);

        $cleanPart = static function ($value): string {
            $s = trim((string)$value);
            $s = (string)preg_replace('/[^a-zA-Z0-9.-]+/', '_', $s);
            $s = (string)preg_replace('/_+/', '_', $s);
            return trim($s, '_');
        };
        $projPart = $cleanPart($project['name'] ?? '');
        $estPart = $cleanPart($estimate['name'] ?? '');
        if ($projPart !== '' && $estPart !== '') {
            $safeBase = $projPart . '_' . $estPart;
        } else {
            $safeBase = $projPart ?: ($estPart ?: 'Project_Estimate');
        }
        return [
            'filename' => $safeBase . '.xlsx',
            'content' => $binary,
        ];
    }

    private static function numOr($val, ?float $fallback = null): ?float
    {
        if ($val === null || $val === '' || $val === '--') return $fallback;
        if (is_numeric($val)) return (float)$val;
        $cleaned = str_replace([',', '$', '%', ' '], '', (string)$val);
        return is_numeric($cleaned) ? (float)$cleaned : $fallback;
    }

    private static function extractQuotedHeaderMeta(string $raw): string
    {
        if (preg_match('/:\s*"([^"]*)"/s', $raw, $m)) {
            return trim($m[1]);
        }
        $parts = explode(':', $raw, 2);
        return trim($parts[1] ?? '');
    }

    private static function parseExportedEstimateWorkbook(PDO $pdo, string $filePath): array
    {
        if (!is_file($filePath)) {
            throw new RuntimeException('Uploaded Excel file could not be read.');
        }

        $catalogIndex = self::loadCatalogIndex($pdo);
        $spreadsheet = IOFactory::load($filePath);
        $ws = $spreadsheet->getSheetByName('Estimate') ?? $spreadsheet->getSheet(0);
        $maxRow = $ws->getHighestRow();
        $maxCol = \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($ws->getHighestColumn());

        $excelName = self::extractQuotedHeaderMeta((string)$ws->getCell('A1')->getValue());
        $excelDesc = self::extractQuotedHeaderMeta((string)$ws->getCell('A2')->getValue());
        $excelDue = self::extractQuotedHeaderMeta((string)$ws->getCell('A3')->getValue());
        $excelScope = self::extractQuotedHeaderMeta((string)$ws->getCell('A4')->getValue());

        $headerRow = 6;
        for ($r = 1; $r <= min(12, $maxRow); $r++) {
            if (self::cleanNorm((string)$ws->getCell([1, $r])->getValue()) === 'cost item') {
                $headerRow = $r;
                break;
            }
        }
        $colMap = [];
        for ($c = 1; $c <= $maxCol; $c++) {
            $h = self::cleanNorm((string)$ws->getCell([$c, $headerRow])->getValue());
            if ($h !== '') $colMap[$h] = $c;
        }
        if (empty($colMap['cost item'])) {
            throw new RuntimeException('Invalid Excel format: missing "Cost item" header in Estimate sheet.');
        }

        $cName = $colMap['cost item'];
        $cTag = $colMap['tag'] ?? null;
        $cDesc = $colMap['description'] ?? null;
        $cBudget = $colMap['budget code'] ?? null;
        $cQty = $colMap['quantity'] ?? null;
        $cUom = $colMap['uom (quantity)'] ?? ($colMap['uom'] ?? null);
        $cMult = $colMap['group multiplier'] ?? null;
        $cWaste = $colMap['material waste'] ?? null;
        $cCost = $colMap['unit cost'] ?? null;
        $cMargin = $colMap['margin'] ?? null;
        $cLabTime = $colMap['unit labor time'] ?? null;
        $cLabUom = $colMap['uom (labor time)'] ?? null;
        $cDiff = $colMap['difficulty factor'] ?? null;
        $cNotes = $colMap['notes'] ?? null;
        $cTax = $colMap['taxable'] ?? null;
        $cColor = $colMap['color'] ?? null;

        $estSettings = ProjectTemplateService::defaultEstimateSettings($pdo);
        $wsSum = $spreadsheet->getSheetByName('Summary');
        if ($wsSum) {
            for ($sr = 1; $sr <= $wsSum->getHighestRow(); $sr++) {
                $label = self::cleanNorm((string)$wsSum->getCell([1, $sr])->getValue());
                if ($label === 'labor') {
                    $m = self::numOr($wsSum->getCell([6, $sr])->getValue());
                    $d = self::numOr($wsSum->getCell([3, $sr])->getValue());
                    $w = self::numOr($wsSum->getCell([4, $sr])->getValue());
                    if ($m !== null && $m >= 0 && $m < 99.9) {
                        $estSettings['globalLaborMargin'] = $m;
                        $lc = (float)($estSettings['globalLaborCost'] ?? 36);
                        $estSettings['globalLaborSales'] = round($lc / (1 - ($m / 100.0)), 2);
                    }
                    if ($d !== null && $d > 0) $estSettings['laborDifficulty'] = $d;
                    if ($w !== null && $w >= 0) $estSettings['laborWaste'] = $w;
                } elseif ($label === 'materials') {
                    $m = self::numOr($wsSum->getCell([6, $sr])->getValue());
                    $w = self::numOr($wsSum->getCell([4, $sr])->getValue());
                    if ($m !== null && $m >= 0) $estSettings['materialMargin'] = $m;
                    if ($w !== null && $w >= 0) $estSettings['materialWaste'] = $w;
                } elseif ($label === 'equipment') {
                    $m = self::numOr($wsSum->getCell([6, $sr])->getValue());
                    $w = self::numOr($wsSum->getCell([4, $sr])->getValue());
                    if ($m !== null && $m >= 0) $estSettings['equipmentMargin'] = $m;
                    if ($w !== null && $w >= 0) $estSettings['equipmentWaste'] = $w;
                }
            }
        }

        $parsedRows = [];
        for ($r = $headerRow + 1; $r <= $maxRow; $r++) {
            $itemName = trim((string)$ws->getCell([$cName, $r])->getValue());
            if ($itemName === '') continue;
            $lvl = (int)$ws->getRowDimension($r)->getOutlineLevel();
            $parsedRows[] = [
                'lvl' => $lvl,
                'name' => $itemName,
                'tag' => $cTag ? trim((string)$ws->getCell([$cTag, $r])->getValue()) : '',
                'desc' => $cDesc ? trim((string)$ws->getCell([$cDesc, $r])->getValue()) : '',
                'budget' => $cBudget ? trim((string)$ws->getCell([$cBudget, $r])->getValue()) : '',
                'qty' => $cQty ? (self::numOr($ws->getCell([$cQty, $r])->getValue(), 0.0) ?? 0.0) : 0.0,
                'uom' => $cUom ? (trim((string)$ws->getCell([$cUom, $r])->getValue()) ?: 'ea') : 'ea',
                'mult' => $cMult ? (self::numOr($ws->getCell([$cMult, $r])->getValue(), 1.0) ?? 1.0) : 1.0,
                'waste' => $cWaste ? self::numOr($ws->getCell([$cWaste, $r])->getValue()) : null,
                'unitCost' => $cCost ? (self::numOr($ws->getCell([$cCost, $r])->getValue(), 0.0) ?? 0.0) : 0.0,
                'margin' => $cMargin ? self::numOr($ws->getCell([$cMargin, $r])->getValue()) : null,
                'unitLabor' => $cLabTime ? (self::numOr($ws->getCell([$cLabTime, $r])->getValue(), 0.0) ?? 0.0) : 0.0,
                'laborUom' => $cLabUom ? (trim((string)$ws->getCell([$cLabUom, $r])->getValue()) ?: 'hrs') : 'hrs',
                'diff' => $cDiff ? self::numOr($ws->getCell([$cDiff, $r])->getValue()) : null,
                'notes' => $cNotes ? trim((string)$ws->getCell([$cNotes, $r])->getValue()) : '',
                'taxable' => $cTax ? !in_array(strtolower(trim((string)$ws->getCell([$cTax, $r])->getValue())), ['no', '0', 'false'], true) : true,
                'color' => $cColor ? trim((string)$ws->getCell([$cColor, $r])->getValue()) : '',
            ];
        }

        $groups = [];
        $curGroupIdx = -1;
        $curItemIdx = -1;
        foreach ($parsedRows as $row) {
            if ($row['lvl'] === 0) {
                $groups[] = ['name' => $row['name'], 'multiplier' => $row['mult'] ?: 1.0, 'items' => []];
                $curGroupIdx = count($groups) - 1;
                $curItemIdx = -1;
            } elseif ($row['lvl'] === 1) {
                if ($curGroupIdx < 0) {
                    $groups[] = ['name' => 'General', 'multiplier' => 1.0, 'items' => []];
                    $curGroupIdx = 0;
                }
                $row['children'] = [];
                $groups[$curGroupIdx]['items'][] = $row;
                $curItemIdx = count($groups[$curGroupIdx]['items']) - 1;
            } elseif ($row['lvl'] >= 2 && $curGroupIdx >= 0 && $curItemIdx >= 0) {
                $groups[$curGroupIdx]['items'][$curItemIdx]['children'][] = $row;
            }
        }

        return [
            'excelName' => $excelName,
            'excelDesc' => $excelDesc,
            'excelDue' => $excelDue,
            'excelScope' => $excelScope,
            'estSettings' => $estSettings,
            'groups' => $groups,
            'catalogIndex' => $catalogIndex,
        ];
    }

    private static function buildWorkspaceFromExcelGroups(
        array $groups,
        array $catalogIndex,
        array $estSettings,
        string $clientEstId,
        int $projectId,
        bool $zeroQuantities = false,
        bool $relinkCatalog = true,
        bool $refreshCatalogPrices = false
    ): array {
        $workspaceGroups = [];
        $estGrandTotal = 0.0;
        $estSubtotalCost = 0.0;
        $estLaborHrs = 0.0;
        $itemsCount = 0;
        $sort = 0;

        foreach ($groups as $rg) {
            if (empty($rg['items'])) continue;
            $gid = ProjectTemplateService::uid('estgrp');
            $tkGid = 'takeoff_group_' . ProjectTemplateService::uid('grp');
            $estItems = [];

            foreach ($rg['items'] as $itemRow) {
                $hasExcelChildren = !empty($itemRow['children']);
                $qty = $zeroQuantities ? 0.0 : (float)$itemRow['qty'];
                $matched = $relinkCatalog
                    ? self::matchCatalogItem($catalogIndex, $itemRow['name'], $itemRow['uom'], $hasExcelChildren)
                    : null;

                if ($matched) {
                    $estItem = self::makeEstimatingItemFromCatalog($matched, $catalogIndex, $gid, $rg['name'], $clientEstId, $projectId, [
                        'quantity' => $qty,
                        'quantityOverride' => ($qty != 0.0),
                        'quantitySyncStatus' => ($qty != 0.0) ? 'overridden' : 'synced',
                        'quantityOverrideSource' => ($qty != 0.0) ? 'estimating_first' : null,
                        'origin' => ($qty != 0.0) ? 'excel_import' : 'takeoff',
                        'uom' => $itemRow['uom'],
                        'budgetCode' => $itemRow['budget'] ?: ($matched['catalog_number'] ?? ''),
                        'description' => $itemRow['desc'] ?: ($matched['description'] ?? ''),
                        'tag' => $itemRow['tag'],
                        'waste' => $itemRow['waste'],
                        'materialMargin' => $itemRow['margin'],
                        'equipmentMargin' => $itemRow['margin'],
                        'difficulty' => $itemRow['diff'],
                        'notes' => $itemRow['notes'],
                        'taxable' => $itemRow['taxable'],
                        'color' => $itemRow['color'],
                        'multiplier' => $itemRow['mult'],
                    ]);
                    if (!$refreshCatalogPrices) {
                        if ($itemRow['unitCost'] > 0 && abs($itemRow['unitCost'] - (float)$estItem['unitMaterialCost']) > 0.001) {
                            $estItem['unitMaterialCost'] = $itemRow['unitCost'];
                            $estItem['unitCost'] = $itemRow['unitCost'];
                        }
                        if ($itemRow['unitLabor'] > 0 && abs($itemRow['unitLabor'] - (float)$estItem['unitLabor']) > 0.0001) {
                            $estItem['unitLabor'] = $itemRow['unitLabor'];
                        }
                    }
                } else {
                    $estItem = self::makeStandaloneItemFromExcelRow($itemRow, $gid, $rg['name'], $clientEstId, $projectId, $qty);
                }

                if ($hasExcelChildren && empty($estItem['children'])) {
                    $estItem['isAssembly'] = true;
                    $estItem['type'] = 'Assembly';
                    $estItem['itemType'] = 'assembly';
                    $parentQ = max(1.0, (float)$itemRow['qty']);
                    foreach ($itemRow['children'] as $chRow) {
                        $cMatched = $relinkCatalog ? self::matchCatalogItem($catalogIndex, $chRow['name'], $chRow['uom'], false) : null;
                        $ratio = $itemRow['qty'] > 0 ? round((float)$chRow['qty'] / $parentQ, 6) : max(1.0, (float)$chRow['qty']);
                        $childCost = ($refreshCatalogPrices && $cMatched) ? (float)($cMatched['unit_cost'] ?? $chRow['unitCost']) : (float)$chRow['unitCost'];
                        $childLabor = ($refreshCatalogPrices && $cMatched) ? (float)($cMatched['labor_hours'] ?? $chRow['unitLabor']) : (float)$chRow['unitLabor'];
                        $estItem['children'][] = [
                            'id' => ProjectTemplateService::uid('estchild'),
                            'parentItemId' => $estItem['id'],
                            'assemblyComponentId' => $cMatched ? (string)$cMatched['id'] : null,
                            'catalogItemId' => $cMatched ? (string)$cMatched['id'] : null,
                            'name' => $chRow['name'],
                            'description' => $chRow['desc'],
                            'budgetCode' => $chRow['budget'] ?: ($cMatched['catalog_number'] ?? ''),
                            'costCode' => $chRow['budget'] ?: ($cMatched['catalog_number'] ?? ''),
                            'costCategory' => 'Materials',
                            'uom' => $chRow['uom'],
                            'ratio' => $ratio,
                            'ratioType' => 'per_unit',
                            'componentWaste' => 0,
                            'quantity' => $qty * $ratio,
                            'originalQuantity' => 0,
                            'unitCost' => $childCost,
                            'unitMaterialCost' => $childCost,
                            'unitEquipmentCost' => 0,
                            'unitSubcontractorCost' => 0,
                            'unitLabor' => $childLabor,
                            'laborUnitType' => $chRow['laborUom'] ?: 'hrs',
                            'waste' => $chRow['waste'],
                            'materialMargin' => $chRow['margin'],
                            'taxable' => $chRow['taxable'],
                            'multiplier' => 1,
                            'groupId' => $gid,
                            'groupName' => $rg['name'],
                            'estimateId' => $clientEstId,
                            'projectId' => (string)$projectId,
                            'isAssembly' => false,
                            'children' => [],
                        ];
                    }
                }

                $m = self::computeEstimateRowMetrics($estItem, $estSettings, (float)($estItem['multiplier'] ?? 1));
                $estSubtotalCost += $m['subItemCost'] + $m['laborCost'];
                $estGrandTotal += $m['totalSales'];
                $estLaborHrs += $m['totLaborHrs'];
                $estItems[] = $estItem;
                $itemsCount++;
            }

            $workspaceGroups[] = [
                'id' => $gid,
                'takeoffGroupId' => $tkGid,
                'source' => 'estimating',
                'name' => $rg['name'],
                'expanded' => true,
                'sortOrder' => $sort++,
                'items' => $estItems,
            ];
        }

        return [
            'workspaceGroups' => $workspaceGroups,
            'estSubtotalCost' => $estSubtotalCost,
            'estGrandTotal' => $estGrandTotal,
            'estLaborHrs' => $estLaborHrs,
            'itemsCount' => $itemsCount,
        ];
    }

    /**
     * Imports an exported Estimate Excel workbook directly into an existing project as a NEW Estimate tab.
     */
    public static function importEstimateTabIntoProject(PDO $pdo, int $projectId, string $filePath, array $params = []): array
    {
        if ($projectId <= 0) {
            throw new RuntimeException('Valid project_id is required to import an estimate.');
        }
        $projCheck = $pdo->prepare("SELECT id, name FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $projCheck->execute([$projectId]);
        $project = $projCheck->fetch(PDO::FETCH_ASSOC);
        if (!$project) {
            throw new RuntimeException('Target project was not found.');
        }

        $parsed = self::parseExportedEstimateWorkbook($pdo, $filePath);
        $rawTabName = trim((string)($params['estimate_name'] ?? ''));
        if ($rawTabName === '') {
            $rawTabName = $parsed['excelName'] !== ''
                ? $parsed['excelName']
                : pathinfo((string)($params['original_filename'] ?? $filePath), PATHINFO_FILENAME);
        }
        $baseName = substr(trim($rawTabName) ?: 'Imported Estimate', 0, 180);

        $existingStmt = $pdo->prepare("SELECT COUNT(*) FROM estimates WHERE project_id = ? AND deleted_at IS NULL");
        $existingStmt->execute([$projectId]);
        $existingCount = (int)$existingStmt->fetchColumn();

        $tabName = $baseName;
        $dupStmt = $pdo->prepare("SELECT COUNT(*) FROM estimates WHERE project_id = ? AND deleted_at IS NULL AND LOWER(name) = LOWER(?)");
        $suffix = 2;
        while (true) {
            $dupStmt->execute([$projectId, $tabName]);
            if ((int)$dupStmt->fetchColumn() === 0) break;
            $tabName = substr($baseName, 0, 170) . ' (' . $suffix . ')';
            $suffix++;
        }

        $zeroQuantities = !empty($params['zero_quantities']);
        $relinkCatalog = !array_key_exists('relink_catalog', $params) || !empty($params['relink_catalog']);
        $refreshCatalogPrices = !empty($params['refresh_catalog_prices']);
        $makePrimary = ($existingCount === 0);

        $pdo->beginTransaction();
        try {
            $clientEstId = ProjectTemplateService::uid('estimate');
            $pdo->prepare(
                "INSERT INTO estimates (project_id, name, description, status, currency_code, settings_json, notes_json, subtotal_cost, markup_total, tax_total, total_cost, labor_hours_total)
                 VALUES (?, ?, ?, 'draft', 'USD', ?, ?, 0, 0, 0, 0, 0)"
            )->execute([
                $projectId,
                $tabName,
                $parsed['excelDesc'] ?: 'Imported from Excel workbook',
                json_encode($parsed['estSettings'], JSON_UNESCAPED_SLASHES),
                json_encode(['scope' => $parsed['excelScope'], 'included' => [], 'excluded' => []], JSON_UNESCAPED_SLASHES),
            ]);
            $estimateId = (int)$pdo->lastInsertId();

            $built = self::buildWorkspaceFromExcelGroups(
                $parsed['groups'],
                $parsed['catalogIndex'],
                $parsed['estSettings'],
                $clientEstId,
                $projectId,
                $zeroQuantities,
                $relinkCatalog,
                $refreshCatalogPrices
            );

            $workspace = [
                'id' => $clientEstId,
                'dbEstimateId' => $estimateId,
                'estimateItemId' => $estimateId,
                'isActive' => true,
                'isLocked' => false,
                'is_primary' => $makePrimary,
                'isPrimary' => $makePrimary,
                'estimateTotal' => round($built['estGrandTotal'], 2),
                'totalSales' => round($built['estGrandTotal'], 2),
                'estimateSummary' => [
                    'estimateTotal' => round($built['estGrandTotal'], 2),
                    'total' => round($built['estGrandTotal'], 2),
                    'laborHours' => round($built['estLaborHrs'], 4),
                ],
                'revision' => 1,
                'estimateRevision' => 1,
                'projectId' => (string)$projectId,
                'name' => $tabName,
                'status' => 'draft',
                'creationMode' => 'excel_import',
                'takeoffSyncMode' => 'linked',
                'createdAt' => gmdate('c'),
                'updatedAt' => gmdate('c'),
                'groups' => $built['workspaceGroups'],
                'notes' => ['scope' => $parsed['excelScope'], 'included' => [], 'excluded' => []],
                'settings' => $parsed['estSettings'],
                'auditLog' => [],
                'grand_total' => round($built['estGrandTotal'], 2),
                'total_amount' => round($built['estGrandTotal'], 2),
            ];

            $pdo->prepare("UPDATE estimates SET subtotal_cost = ?, total_cost = ?, labor_hours_total = ? WHERE id = ?")
                ->execute([round($built['estSubtotalCost'], 4), round($built['estGrandTotal'], 4), round($built['estLaborHrs'], 4), $estimateId]);

            $pdo->prepare("INSERT INTO estimate_workspace_states (estimate_id, project_id, client_estimate_id, state_json, revision) VALUES (?, ?, ?, ?, 1)")
                ->execute([$estimateId, $projectId, $clientEstId, json_encode($workspace, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);

            ProjectTemplateService::ensureTakeoffLayersFromWorkspace($pdo, $projectId, $clientEstId);
            if ($makePrimary) {
                ProjectTemplateService::syncPrimaryEstimateMetadata($pdo, $projectId, false);
            }

            $pdo->commit();
            return [
                'project_id' => $projectId,
                'estimate_id' => $estimateId,
                'client_estimate_id' => $clientEstId,
                'name' => $tabName,
                'groups' => count($built['workspaceGroups']),
                'items_count' => $built['itemsCount'],
                'estimate' => $workspace,
            ];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Imports a full Project from an exported Estimate Excel workbook (from Bid Board "Create New Project").
     * Keeps all imported item quantities in Estimating (flagged as quantityOverride/addedFromEstimating)
     * while Takeoff canvas stays completely empty at 0 so sidebar displays pro-tree-qty-override-badge.
     */
    public static function importProjectFromExportedExcel(PDO $pdo, string $filePath, array $params = []): array
    {
        $parsed = self::parseExportedEstimateWorkbook($pdo, $filePath);
        $catalogIndex = $parsed['catalogIndex'];
        $excelName = $parsed['excelName'];
        $excelDesc = $parsed['excelDesc'];
        $excelDue = $parsed['excelDue'];
        $excelScope = $parsed['excelScope'];
        $estSettings = $parsed['estSettings'];
        $groups = $parsed['groups'];

        $projName = trim((string)($params['name'] ?? ''));
        if ($projName === '' || $projName === 'New Project') {
            $projName = $excelName !== '' ? $excelName : pathinfo((string)($params['original_filename'] ?? $filePath), PATHINFO_FILENAME);
        }
        $projName = substr(trim($projName) ?: 'Imported Project', 0, 191);
        $status = trim((string)($params['status'] ?? 'to_do')) ?: 'to_do';
        $dueDate = $excelDue !== '' && preg_match('/^\d{4}-\d{2}-\d{2}/', $excelDue) ? substr($excelDue, 0, 10) . ' 00:00:00' : null;
        $isTemplateStage = strtolower($status) === 'templates';

        $pdo->beginTransaction();
        try {
            $meta = [
                'estimator' => 'Juan Estevez',
                'measurement_system' => 'US',
                'estimate_pricing' => 'Unlocked',
                'imported_from_excel' => true,
                'notes' => [],
                'tasks' => [],
            ];
            if ($isTemplateStage) $meta['is_template'] = true;

            $pdo->prepare("INSERT INTO projects (name, description, status, bid_due_at, metadata_json) VALUES (?, ?, ?, ?, ?)")
                ->execute([$projName, $excelDesc ?: 'Imported from Excel estimate', $status, $dueDate, json_encode($meta, JSON_UNESCAPED_SLASHES)]);
            $projectId = (int)$pdo->lastInsertId();

            if ($isTemplateStage) {
                $tplId = ProjectTemplateService::upsertTemplateEntryForProject($pdo, $projectId, $projName, $excelDesc ?: 'Imported Excel template');
                if ($tplId > 0) {
                    $pdo->prepare("UPDATE projects SET project_template_id = ? WHERE id = ?")->execute([$tplId, $projectId]);
                }
            }

            $clientEstId = ProjectTemplateService::uid('estimate');
            $pdo->prepare(
                "INSERT INTO estimates (project_id, name, description, status, currency_code, settings_json, notes_json, subtotal_cost, markup_total, tax_total, total_cost, labor_hours_total)
                 VALUES (?, ?, ?, 'draft', 'USD', ?, ?, 0, 0, 0, 0, 0)"
            )->execute([
                $projectId,
                'Primary Estimate',
                $excelDesc ?: 'Imported from Excel',
                json_encode($estSettings, JSON_UNESCAPED_SLASHES),
                json_encode(['scope' => $excelScope, 'included' => [], 'excluded' => []], JSON_UNESCAPED_SLASHES),
            ]);
            $estimateId = (int)$pdo->lastInsertId();

            $built = self::buildWorkspaceFromExcelGroups(
                $groups,
                $catalogIndex,
                $estSettings,
                $clientEstId,
                $projectId,
                $isTemplateStage,
                true,
                false
            );
            $workspaceGroups = $built['workspaceGroups'];
            $estSubtotalCost = $built['estSubtotalCost'];
            $estGrandTotal = $built['estGrandTotal'];
            $estLaborHrs = $built['estLaborHrs'];

            $workspace = [
                'id' => $clientEstId,
                'dbEstimateId' => $estimateId,
                'estimateItemId' => $estimateId,
                'isActive' => true,
                'isLocked' => false,
                'is_primary' => true,
                'isPrimary' => true,
                'estimateTotal' => round($estGrandTotal, 2),
                'totalSales' => round($estGrandTotal, 2),
                'estimateSummary' => [
                    'estimateTotal' => round($estGrandTotal, 2),
                    'total' => round($estGrandTotal, 2),
                    'laborHours' => round($estLaborHrs, 4),
                ],
                'revision' => 1,
                'estimateRevision' => 1,
                'projectId' => (string)$projectId,
                'name' => 'Primary Estimate',
                'status' => 'draft',
                'creationMode' => 'excel_import',
                'takeoffSyncMode' => 'linked',
                'createdAt' => gmdate('c'),
                'updatedAt' => gmdate('c'),
                'groups' => $workspaceGroups,
                'notes' => ['scope' => $excelScope, 'included' => [], 'excluded' => []],
                'settings' => $estSettings,
                'auditLog' => [],
                'grand_total' => round($estGrandTotal, 2),
                'total_amount' => round($estGrandTotal, 2),
            ];

            $pdo->prepare("UPDATE estimates SET subtotal_cost = ?, total_cost = ?, labor_hours_total = ? WHERE id = ?")
                ->execute([round($estSubtotalCost, 4), round($estGrandTotal, 4), round($estLaborHrs, 4), $estimateId]);

            $pdo->prepare("INSERT INTO estimate_workspace_states (estimate_id, project_id, client_estimate_id, state_json, revision) VALUES (?, ?, ?, ?, 1)")
                ->execute([$estimateId, $projectId, $clientEstId, json_encode($workspace, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);

            // Create corresponding Takeoff layers with quantity=0 and NO canvas geometry, so sidebar shows override badges
            ProjectTemplateService::ensureTakeoffLayersFromWorkspace($pdo, $projectId, $clientEstId);

            if ($isTemplateStage) {
                ProjectTemplateService::resetProjectQuantitiesToZero($pdo, $projectId);
            }
            ProjectTemplateService::syncPrimaryEstimateMetadata($pdo, $projectId, $isTemplateStage);

            $pdo->commit();
            return [
                'project_id' => $projectId,
                'estimate_id' => $estimateId,
                'client_estimate_id' => $clientEstId,
                'name' => $projName,
                'groups' => count($workspaceGroups),
            ];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    private static function makeStandaloneItemFromExcelRow(
        array $row,
        string $groupId,
        string $groupName,
        string $estimateId,
        int $projectId,
        float $qty
    ): array {
        $itemId = ProjectTemplateService::uid('estitem');
        $layerId = ProjectTemplateService::uid('layer');
        $uom = $row['uom'] ?: 'ea';
        $tkType = $uom === 'ft' || $uom === 'lf' ? 'Linear' : (in_array(strtolower($uom), ['sq ft', 'sf', 'sqft'], true) ? 'Area / Volume' : 'Count');
        $color = trim((string)($row['color'] ?? ''));
        if (!preg_match('/^#[0-9a-f]{3,8}$/i', $color)) $color = '#2563eb';
        $isOverride = abs($qty) > 0.000001;

        return [
            'id' => $itemId,
            'takeoffLayerId' => $layerId,
            'catalogItemId' => null,
            'catalogMetadata' => null,
            'name' => $row['name'],
            'description' => $row['desc'],
            'type' => $tkType,
            'itemType' => strtolower($tkType),
            'budgetCode' => $row['budget'],
            'costCode' => $row['budget'],
            'costCategory' => 'Materials',
            'originalQuantity' => 0,
            'quantity' => $qty,
            'unitCost' => $row['unitCost'],
            'unitMaterialCost' => $row['unitCost'],
            'unitEquipmentCost' => 0,
            'unitSubcontractorCost' => 0,
            'waste' => $row['waste'],
            'materialMargin' => $row['margin'],
            'equipmentMargin' => null,
            'unitLabor' => $row['unitLabor'],
            'laborRate' => null,
            'laborUnitType' => $row['laborUom'] ?: 'hrs',
            'difficulty' => $row['diff'],
            'laborMargin' => null,
            'notes' => $row['notes'],
            'taxable' => $row['taxable'],
            'tag' => $row['tag'],
            'color' => $color,
            'groupId' => $groupId,
            'groupName' => $groupName,
            'uom' => $uom,
            'projectId' => (string)$projectId,
            'estimateId' => $estimateId,
            'estimatingItemId' => $itemId,
            'lastSyncedTakeoffQuantity' => 0,
            'pendingTakeoffQuantity' => null,
            'quantityOverride' => $isOverride,
            'quantitySource' => $isOverride ? 'estimating' : 'takeoff',
            'quantitySyncStatus' => $isOverride ? 'overridden' : 'synced',
            'quantityOverrideSource' => $isOverride ? 'estimating_first' : null,
            'addedFromEstimating' => $isOverride,
            'origin' => $isOverride ? 'excel_import' : 'takeoff',
            'isAssembly' => !empty($row['children']),
            'children' => [],
            'childrenQuantitiesExtended' => false,
            'assemblyExpansionPolicy' => 'CANONICAL',
            'multiplier' => (float)($row['mult'] ?: 1.0),
            'locked' => false,
            'tags' => [],
        ];
    }
}
