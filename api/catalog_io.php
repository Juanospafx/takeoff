<?php
/**
 * Catalog Import / Export and Templates API
 *
 * Actions:
 * - GET  ?action=template&type=items|assemblies
 * - GET  ?action=export&catalog_id=X&group_id=Y&type=items|assemblies
 * - POST ?action=import (multipart/form-data: file, catalog_id, group_id, import_type)
 */

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/auth/WonProjectAdminAuthenticator.php';

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Style\Border;

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

if (!isset($pdo) || !($pdo instanceof PDO)) {
    http_response_code(503);
    echo json_encode(['error' => 'Catalog service is unavailable.']);
    exit;
}

$authenticator = new WonProjectAdminAuthenticator($pdo);
$authenticator->requireAdmin($_SESSION ?? []);

$action = strtolower(trim((string)($_GET['action'] ?? $_POST['action'] ?? '')));
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$allowedMethods = ['template' => 'GET', 'export' => 'GET', 'import' => 'POST'];
if (!isset($allowedMethods[$action]) || $allowedMethods[$action] !== $method) {
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Method not allowed.']);
    exit;
}

// Helper to style header row
function applyHeaderStyle(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $sheet, string $lastCol): void {
    $range = "A1:{$lastCol}1";
    $sheet->getStyle($range)->getFont()->setBold(true)->setSize(11)->getColor()->setRGB('1E293B');
    $sheet->getStyle($range)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('F1F5F9');
    $sheet->getStyle($range)->getAlignment()->setVertical(Alignment::VERTICAL_CENTER);
    $sheet->getRowDimension(1)->setRowHeight(26);

    // Auto-fit column widths
    foreach (range('A', $lastCol) as $col) {
        $sheet->getColumnDimension($col)->setAutoSize(true);
    }
}

// =========================================================================
// ACTION: TEMPLATE DOWNLOAD
// =========================================================================
if ($action === 'template') {
    $type = strtolower((string)($_GET['type'] ?? 'items'));
    $spreadsheet = new Spreadsheet();
    $sheet = $spreadsheet->getActiveSheet();

    if ($type === 'assemblies') {
        $sheet->setTitle('Assemblies');
        $headers = [
            'Catalog',
            'Group',
            'Assembly Name',
            'Description',
            'Unit',
            'Measurement Type',
            'Component Item Name',
            'Quantity',
            'Ratio Type'
        ];
        $sheet->fromArray([$headers], null, 'A1');
        applyHeaderStyle($sheet, 'I');

        // Sample rows showing structure
        $sampleData = [
            [
                '2027 Brightronix Cost Catalog',
                'Assemblies EMT',
                '1/2" EMT Conduit, Overhead Branch, w/ Pullstring',
                '1/2" EMT conduit assembly with strap, connectors, couplings and pullstring',
                'ft',
                'linear',
                '1/2" EMT Conduit',
                1.0,
                'per_linear_length'
            ],
            [
                '2027 Brightronix Cost Catalog',
                'Assemblies EMT',
                '1/2" EMT Conduit, Overhead Branch, w/ Pullstring',
                '1/2" EMT conduit assembly with strap, connectors, couplings and pullstring',
                'ft',
                'linear',
                '1/2" Steel One Hole Strap, EMT',
                0.1,
                'per_linear_length'
            ],
            [
                '2027 Brightronix Cost Catalog',
                'Assemblies EMT',
                '1/2" EMT Conduit, Overhead Branch, w/ Pullstring',
                '1/2" EMT conduit assembly with strap, connectors, couplings and pullstring',
                'ft',
                'linear',
                '1/2" EMT Set Screw Steel Connector',
                0.05,
                'per_linear_length'
            ],
            [
                '2027 Brightronix Cost Catalog',
                'Assemblies EMT',
                '1/2" EMT Conduit, Overhead Branch, w/ Pullstring',
                '1/2" EMT conduit assembly with strap, connectors, couplings and pullstring',
                'ft',
                'linear',
                'Poly Pull Line, 500\' Box, 210 lb Tensile Strength',
                1.0,
                'per_linear_length'
            ]
        ];
        $sheet->fromArray($sampleData, null, 'A2');

        $filename = 'Catalog_Assemblies_Template.xlsx';
    } else {
        // Items Template
        $sheet->setTitle('Parts');
        $headers = [
            'Catalog',
            'Group',
            'Item Type',
            'Name',
            'Description',
            'Unit',
            'Unit Cost',
            'Labor Hours',
            'Catalog Number',
            'Manufacturer',
            'Supplier',
            'Cost Code',
            'EPD Url',
            'Taxable'
        ];
        $sheet->fromArray([$headers], null, 'A1');
        applyHeaderStyle($sheet, 'N');

        // Sample rows
        $sampleData = [
            [
                '2027 Brightronix Cost Catalog',
                'Conduit & Raceways',
                'Part',
                '1/2" EMT Conduit',
                '1/2" Electrical Metallic Tubing, 10ft length',
                'ft',
                0.85,
                0.0400,
                'EMT-050',
                'Allied Tube',
                'Graybar',
                '26 05 33',
                '',
                'Yes'
            ],
            [
                '2027 Brightronix Cost Catalog',
                'Conduit Fittings',
                'Part',
                '1/2" EMT Set Screw Steel Connector',
                'Steel set screw connector concrete-tight when taped',
                'ea',
                0.78,
                0.0500,
                'SS-050',
                'Topaz',
                'City Electric',
                '26 05 33',
                '',
                'Yes'
            ],
            [
                '2027 Brightronix Cost Catalog',
                'Labor Rates',
                'Labor',
                'Journeyman Electrician',
                'Standard commercial journeyman labor hour rate',
                'hr',
                65.00,
                1.0000,
                'LAB-JM',
                '',
                '',
                '26 00 00',
                '',
                'No'
            ]
        ];
        $sheet->fromArray($sampleData, null, 'A2');

        $filename = 'Catalog_Items_Template.xlsx';
    }

    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: max-age=0');

    $writer = new Xlsx($spreadsheet);
    $writer->save('php://output');
    exit;
}

// =========================================================================
// ACTION: EXPORT TO EXCEL
// =========================================================================
if ($action === 'export') {
    $catalogId = (int)($_GET['catalog_id'] ?? 0);
    $groupId = !empty($_GET['group_id']) && $_GET['group_id'] !== 'all' ? (int)$_GET['group_id'] : null;
    $type = strtolower((string)($_GET['type'] ?? 'items'));

    if ($catalogId <= 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Catalog ID is required for export.']);
        exit;
    }

    // Get catalog metadata
    $catStmt = $pdo->prepare("SELECT name FROM catalogs WHERE id = ? LIMIT 1");
    $catStmt->execute([$catalogId]);
    $catName = $catStmt->fetchColumn() ?: 'Catalog';
    $safeCatName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $catName);

    $spreadsheet = new Spreadsheet();
    $sheet = $spreadsheet->getActiveSheet();

    if ($type === 'assemblies') {
        $sheet->setTitle('Assemblies');
        $headers = [
            'Catalog',
            'Group',
            'Assembly Name',
            'Description',
            'Unit',
            'Measurement Type',
            'Total Cost',
            'Total Labor (hrs)',
            'Component Item Name',
            'Quantity',
            'Component Unit',
            'Ratio Type',
            'Component Unit Cost',
            'Component Labor (hrs)'
        ];
        $sheet->fromArray([$headers], null, 'A1');
        applyHeaderStyle($sheet, 'N');

        // Query assemblies and their parts
        $whereGroup = $groupId ? "AND i.catalog_group_id = $groupId" : "";
        $query = "
            SELECT
                c.name as catalog_name,
                g.name as group_name,
                i.id as assembly_id,
                i.name as assembly_name,
                i.description as assembly_desc,
                i.unit_of_measure as assembly_uom,
                i.measurement_type as assembly_type,
                i.unit_cost as assembly_cost,
                i.labor_hours as assembly_labor,
                child.name as child_name,
                child.unit_of_measure as child_uom,
                p.quantity as part_qty,
                p.ratio_type as part_ratio,
                p.unit_cost_snapshot as part_cost,
                p.unit_labor_time_snapshot as part_labor
            FROM catalog_items i
            JOIN catalogs c ON c.id = i.catalog_id
            LEFT JOIN catalog_groups g ON g.id = i.catalog_group_id
            LEFT JOIN assembly_parts p ON p.assembly_catalog_item_id = i.id AND p.deleted_at IS NULL
            LEFT JOIN catalog_items child ON child.id = p.part_catalog_item_id
            WHERE i.catalog_id = ? AND i.item_type = 'assembly' AND i.deleted_at IS NULL $whereGroup
            ORDER BY g.name ASC, i.name ASC, p.sort_order ASC, p.id ASC
        ";
        $stmt = $pdo->prepare($query);
        $stmt->execute([$catalogId]);

        $rows = [];
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $rows[] = [
                $r['catalog_name'],
                $r['group_name'] ?? '',
                $r['assembly_name'],
                $r['assembly_desc'] ?? '',
                $r['assembly_uom'] ?? 'ea',
                $r['assembly_type'] ?? 'count',
                (float)$r['assembly_cost'],
                (float)$r['assembly_labor'],
                $r['child_name'] ?? '',
                $r['part_qty'] !== null ? (float)$r['part_qty'] : '',
                $r['child_uom'] ?? '',
                $r['part_ratio'] ?? '',
                $r['part_cost'] !== null ? (float)$r['part_cost'] : '',
                $r['part_labor'] !== null ? (float)$r['part_labor'] : ''
            ];
        }

        if (!empty($rows)) {
            $sheet->fromArray($rows, null, 'A2');
        }

        $filename = "{$safeCatName}_Assemblies_" . date('Y-m-d') . ".xlsx";
    } else {
        // Items export
        $sheet->setTitle('Parts');
        $headers = [
            'Catalog',
            'Group',
            'Item Type',
            'Name',
            'Description',
            'Unit',
            'Unit Cost',
            'Labor Hours',
            'Catalog Number',
            'Manufacturer',
            'Supplier',
            'Cost Code',
            'EPD Url',
            'Taxable'
        ];
        $sheet->fromArray([$headers], null, 'A1');
        applyHeaderStyle($sheet, 'N');

        $whereGroup = $groupId ? "AND i.catalog_group_id = $groupId" : "";
        $query = "
            SELECT
                c.name as catalog_name,
                g.name as group_name,
                i.item_type,
                i.name,
                i.description,
                i.unit_of_measure,
                i.unit_cost,
                i.labor_hours,
                i.catalog_number,
                i.manufacturer,
                i.supplier,
                i.cost_code,
                i.epd_url,
                i.taxable
            FROM catalog_items i
            JOIN catalogs c ON c.id = i.catalog_id
            LEFT JOIN catalog_groups g ON g.id = i.catalog_group_id
            WHERE i.catalog_id = ? AND i.item_type != 'assembly' AND i.deleted_at IS NULL $whereGroup
            ORDER BY g.name ASC, i.name ASC
        ";
        $stmt = $pdo->prepare($query);
        $stmt->execute([$catalogId]);

        $rows = [];
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $rows[] = [
                $r['catalog_name'],
                $r['group_name'] ?? '',
                ucfirst($r['item_type'] ?: 'Part'),
                $r['name'],
                $r['description'] ?? '',
                $r['unit_of_measure'] ?? 'ea',
                (float)$r['unit_cost'],
                (float)$r['labor_hours'],
                $r['catalog_number'] ?? '',
                $r['manufacturer'] ?? '',
                $r['supplier'] ?? '',
                $r['cost_code'] ?? '',
                $r['epd_url'] ?? '',
                !empty($r['taxable']) ? 'Yes' : 'No'
            ];
        }

        if (!empty($rows)) {
            $sheet->fromArray($rows, null, 'A2');
        }

        $filename = "{$safeCatName}_Items_" . date('Y-m-d') . ".xlsx";
    }

    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: max-age=0');

    $writer = new Xlsx($spreadsheet);
    $writer->save('php://output');
    exit;
}

// =========================================================================
// ACTION: IMPORT FROM EXCEL
// =========================================================================
if ($action === 'import') {
    header('Content-Type: application/json; charset=utf-8');

    $csrfToken = trim((string)($_POST['csrf_token'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''));
    $sessionCsrf = (string)($_SESSION['catalog_io_csrf_token'] ?? '');
    if ($csrfToken === '' || $sessionCsrf === '' || !hash_equals($sessionCsrf, $csrfToken)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Invalid or missing CSRF token.']);
        exit;
    }

    if (empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        http_response_code(422);
        echo json_encode(['success' => false, 'error' => 'No Excel file was uploaded.']);
        exit;
    }

    $uploadSize = (int)($_FILES['file']['size'] ?? 0);
    $uploadName = (string)($_FILES['file']['name'] ?? '');
    if ($uploadSize <= 0 || $uploadSize > 5 * 1024 * 1024 || strtolower(pathinfo($uploadName, PATHINFO_EXTENSION)) !== 'xlsx') {
        http_response_code(422);
        echo json_encode(['success' => false, 'error' => 'Upload must be a non-empty .xlsx file no larger than 5 MB.']);
        exit;
    }

    $catalogId = (int)($_POST['catalog_id'] ?? 0);
    $fallbackGroupId = !empty($_POST['group_id']) && $_POST['group_id'] !== 'all' ? (int)$_POST['group_id'] : null;
    $importType = strtolower((string)($_POST['import_type'] ?? 'auto'));

    if ($catalogId <= 0) {
        echo json_encode(['success' => false, 'error' => 'Please select a target catalog for import.']);
        exit;
    }

    try {
        $uploadedFile = $_FILES['file']['tmp_name'];
        $reader = IOFactory::createReaderForFile($uploadedFile);
        $reader->setReadDataOnly(true);
        $spreadsheet = $reader->load($uploadedFile);
        $sheet = $spreadsheet->getActiveSheet();
        $highestRow = $sheet->getHighestRow();
        $highestCol = $sheet->getHighestColumn();

        if ($highestRow < 2) {
            http_response_code(422);
            echo json_encode(['success' => false, 'error' => 'The uploaded spreadsheet contains no data rows.']);
            exit;
        }
        if ($highestRow > 5001) {
            http_response_code(422);
            echo json_encode(['success' => false, 'error' => 'The spreadsheet exceeds the 5,000-row import limit.']);
            exit;
        }

        $pdo->beginTransaction();

        // Read header row
        $headerMap = [];
        $colIndex = 1;
        while (true) {
            $val = trim((string)($sheet->getCell([$colIndex, 1])->getValue() ?? ''));
            if ($val === '') break;
            $norm = strtolower(preg_replace('/[^a-z0-9]/', '', $val));
            $headerMap[$norm] = $colIndex;
            $colIndex++;
        }

        // Auto-detect type if needed
        $isAssemblySheet = false;
        if ($importType === 'assemblies') {
            $isAssemblySheet = true;
        } elseif ($importType === 'items') {
            $isAssemblySheet = false;
        } else {
            // Auto detect
            if (isset($headerMap['assemblyname']) || isset($headerMap['componentitemname']) || isset($headerMap['partname'])) {
                $isAssemblySheet = true;
            }
        }

        // Preload Groups in this catalog
        $groupMap = [];
        $grpStmt = $pdo->prepare("SELECT id, name FROM catalog_groups WHERE catalog_id = ? AND deleted_at IS NULL");
        $grpStmt->execute([$catalogId]);
        while ($g = $grpStmt->fetch(PDO::FETCH_ASSOC)) {
            $groupMap[strtolower(trim($g['name']))] = (int)$g['id'];
        }

        // Helper to get or create group
        $getOrCreateGroup = function(string $groupName) use ($pdo, $catalogId, &$groupMap, $fallbackGroupId): ?int {
            $groupName = trim($groupName);
            if ($groupName === '') return $fallbackGroupId;
            $key = strtolower($groupName);
            if (isset($groupMap[$key])) return $groupMap[$key];

            // Create group
            $ins = $pdo->prepare("INSERT INTO catalog_groups (catalog_id, name, active, enabled_for_projects, sort_order) VALUES (?, ?, 1, 1, 100)");
            $ins->execute([$catalogId, $groupName]);
            $newId = (int)$pdo->lastInsertId();
            $groupMap[$key] = $newId;
            return $newId;
        };

        $created = 0;
        $updated = 0;
        $partsLinked = 0;
        $errors = [];

        if ($isAssemblySheet) {
            // ==========================================
            // PROCESS ASSEMBLIES IMPORT
            // ==========================================
            // Preload non-assembly items for fast component lookup
            $rawParts = $pdo->query("SELECT id, name, unit_cost, labor_hours FROM catalog_items WHERE catalog_id = $catalogId AND item_type != 'assembly' AND deleted_at IS NULL")->fetchAll(PDO::FETCH_ASSOC);
            $partLookup = [];
            foreach ($rawParts as $rp) {
                $partLookup[strtolower(preg_replace('/\s+/', ' ', trim($rp['name'])))] = $rp;
            }

            // Group spreadsheet rows by assembly name
            $assembliesData = [];
            for ($r = 2; $r <= $highestRow; $r++) {
                $asmNameCol = $headerMap['assemblyname'] ?? $headerMap['name'] ?? 3;
                $asmName = trim((string)($sheet->getCell([$asmNameCol, $r])->getValue() ?? ''));
                if ($asmName === '') continue;

                $grpCol = $headerMap['group'] ?? 2;
                $grpName = trim((string)($sheet->getCell([$grpCol, $r])->getValue() ?? ''));

                $descCol = $headerMap['description'] ?? 4;
                $desc = trim((string)($sheet->getCell([$descCol, $r])->getValue() ?? ''));

                $uomCol = $headerMap['unit'] ?? $headerMap['uom'] ?? 5;
                $uom = trim((string)($sheet->getCell([$uomCol, $r])->getValue() ?? 'ea'));

                $measCol = $headerMap['measurementtype'] ?? 6;
                $measType = trim((string)($sheet->getCell([$measCol, $r])->getValue() ?? 'count'));

                $compNameCol = $headerMap['componentitemname'] ?? $headerMap['componentname'] ?? $headerMap['partitemname'] ?? 7;
                $compName = trim((string)($sheet->getCell([$compNameCol, $r])->getValue() ?? ''));

                $qtyCol = $headerMap['quantity'] ?? $headerMap['qty'] ?? 8;
                $qtyVal = (float)($sheet->getCell([$qtyCol, $r])->getValue() ?? 1);

                $ratioCol = $headerMap['ratiotype'] ?? 9;
                $ratioType = trim((string)($sheet->getCell([$ratioCol, $r])->getValue() ?? ''));
                if (!$ratioType) {
                    $ratioType = strtolower($measType) === 'linear' ? 'per_linear_length' : 'per_unit';
                }

                $key = strtolower($asmName);
                if (!isset($assembliesData[$key])) {
                    $assembliesData[$key] = [
                        'name' => $asmName,
                        'group' => $grpName,
                        'description' => $desc,
                        'uom' => $uom ?: 'ea',
                        'measurement_type' => $measType ?: 'count',
                        'components' => []
                    ];
                }

                if ($compName !== '') {
                    $assembliesData[$key]['components'][] = [
                        'component_name' => $compName,
                        'quantity' => $qtyVal,
                        'ratio_type' => $ratioType
                    ];
                }
            }

            // Persist each assembly
            foreach ($assembliesData as $asm) {
                $groupId = $getOrCreateGroup($asm['group']);

                // Check if assembly already exists
                $findStmt = $pdo->prepare("SELECT id FROM catalog_items WHERE catalog_id = ? AND (catalog_group_id = ? OR ? IS NULL) AND name = ? AND deleted_at IS NULL LIMIT 1");
                $findStmt->execute([$catalogId, $groupId, $groupId, $asm['name']]);
                $existingId = $findStmt->fetchColumn();

                if ($existingId) {
                    $assemblyId = (int)$existingId;
                    $upd = $pdo->prepare("UPDATE catalog_items SET description = ?, unit_of_measure = ?, measurement_type = ?, item_type = 'assembly', active = 1, updated_at = NOW() WHERE id = ?");
                    $upd->execute([$asm['description'], $asm['uom'], $asm['measurement_type'], $assemblyId]);
                    $updated++;
                } else {
                    $ins = $pdo->prepare("INSERT INTO catalog_items (catalog_id, cost_catalog_id, catalog_group_id, name, description, item_type, cost_type, unit_of_measure, measurement_type, unit_cost, labor_hours, active, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'assembly', 'Material', ?, ?, 0.00, 0.00, 1, 1, NOW(), NOW())");
                    $ins->execute([$catalogId, $catalogId, $groupId, $asm['name'], $asm['description'], $asm['uom'], $asm['measurement_type']]);
                    $assemblyId = (int)$pdo->lastInsertId();
                    $created++;
                }

                // If components specified, replace parts
                if (!empty($asm['components'])) {
                    $pdo->prepare("DELETE FROM assembly_parts WHERE assembly_catalog_item_id = ?")->execute([$assemblyId]);

                    $totalCost = 0.0;
                    $totalLabor = 0.0;
                    $partSort = 0;
                    $partIns = $pdo->prepare("INSERT INTO assembly_parts (assembly_catalog_item_id, part_catalog_item_id, quantity, ratio_type, unit_cost_snapshot, unit_labor_time_snapshot, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)");

                    foreach ($asm['components'] as $comp) {
                        $compKey = strtolower(preg_replace('/\s+/', ' ', trim($comp['component_name'])));
                        $childItem = $partLookup[$compKey] ?? null;

                        // Fallback fuzzy search if exact match missed
                        if (!$childItem) {
                            foreach ($rawParts as $rp) {
                                if (stripos($rp['name'], $comp['component_name']) !== false) {
                                    $childItem = $rp;
                                    break;
                                }
                            }
                        }

                        if ($childItem) {
                            $childCost = (float)$childItem['unit_cost'];
                            $childLabor = (float)$childItem['labor_hours'];
                            $partIns->execute([
                                $assemblyId,
                                (int)$childItem['id'],
                                (float)$comp['quantity'],
                                $comp['ratio_type'],
                                $childCost,
                                $childLabor,
                                $partSort++
                            ]);
                            $partsLinked++;
                            $totalCost += ($comp['quantity'] * $childCost);
                            $totalLabor += ($comp['quantity'] * $childLabor);
                        } else {
                            $errors[] = "Part '{$comp['component_name']}' for assembly '{$asm['name']}' was not found in catalog.";
                        }
                    }

                    // Update assembly calculated cost & labor
                    $pdo->prepare("UPDATE catalog_items SET unit_cost = ?, labor_hours = ?, updated_at = NOW() WHERE id = ?")->execute([$totalCost, $totalLabor, $assemblyId]);
                }
            }

            $pdo->commit();
            echo json_encode([
                'success' => true,
                'type' => 'assemblies',
                'created' => $created,
                'updated' => $updated,
                'parts_linked' => $partsLinked,
                'errors' => array_slice($errors, 0, 10),
                'total_errors' => count($errors)
            ]);
            exit;

        } else {
            // ==========================================
            // PROCESS NORMAL ITEMS IMPORT
            // ==========================================
            for ($r = 2; $r <= $highestRow; $r++) {
                $nameCol = $headerMap['name'] ?? 4;
                $name = trim((string)($sheet->getCell([$nameCol, $r])->getValue() ?? ''));
                if ($name === '') continue;

                $grpCol = $headerMap['group'] ?? 2;
                $grpName = trim((string)($sheet->getCell([$grpCol, $r])->getValue() ?? ''));

                $typeCol = $headerMap['itemtype'] ?? $headerMap['type'] ?? 3;
                $itemType = strtolower(trim((string)($sheet->getCell([$typeCol, $r])->getValue() ?? 'part')));
                if (!in_array($itemType, ['part', 'labor', 'equipment', 'travel', 'material'])) {
                    $itemType = 'part';
                }

                $descCol = $headerMap['description'] ?? 5;
                $desc = trim((string)($sheet->getCell([$descCol, $r])->getValue() ?? ''));

                $uomCol = $headerMap['unit'] ?? $headerMap['uom'] ?? 6;
                $uom = trim((string)($sheet->getCell([$uomCol, $r])->getValue() ?? 'ea'));

                $costCol = $headerMap['unitcost'] ?? $headerMap['cost'] ?? 7;
                $unitCost = (float)($sheet->getCell([$costCol, $r])->getValue() ?? 0);

                $laborCol = $headerMap['laborhours'] ?? $headerMap['unitlaborhrs'] ?? $headerMap['labor'] ?? 8;
                $laborHours = (float)($sheet->getCell([$laborCol, $r])->getValue() ?? 0);

                $catNumCol = $headerMap['catalognumber'] ?? $headerMap['partnumber'] ?? 9;
                $catNum = trim((string)($sheet->getCell([$catNumCol, $r])->getValue() ?? ''));

                $mfgCol = $headerMap['manufacturer'] ?? 10;
                $mfg = trim((string)($sheet->getCell([$mfgCol, $r])->getValue() ?? ''));

                $supCol = $headerMap['supplier'] ?? 11;
                $sup = trim((string)($sheet->getCell([$supCol, $r])->getValue() ?? ''));

                $costCodeCol = $headerMap['costcode'] ?? 12;
                $costCode = trim((string)($sheet->getCell([$costCodeCol, $r])->getValue() ?? ''));

                $epdCol = $headerMap['epdurl'] ?? 13;
                $epdUrl = trim((string)($sheet->getCell([$epdCol, $r])->getValue() ?? ''));

                $taxCol = $headerMap['taxable'] ?? 14;
                $taxStr = strtolower(trim((string)($sheet->getCell([$taxCol, $r])->getValue() ?? 'yes')));
                $taxable = in_array($taxStr, ['yes', '1', 'true', 'si', 'y']) ? 1 : 0;

                $groupId = $getOrCreateGroup($grpName);

                // Upsert into catalog_items
                $find = $pdo->prepare("SELECT id FROM catalog_items WHERE catalog_id = ? AND (catalog_group_id = ? OR ? IS NULL) AND name = ? AND deleted_at IS NULL LIMIT 1");
                $find->execute([$catalogId, $groupId, $groupId, $name]);
                $existingId = $find->fetchColumn();

                if ($existingId) {
                    $upd = $pdo->prepare("
                        UPDATE catalog_items SET
                            item_type = ?, description = ?, unit_of_measure = ?, unit_cost = ?,
                            labor_hours = ?, catalog_number = ?, manufacturer = ?, supplier = ?,
                            cost_code = ?, epd_url = ?, taxable = ?, active = 1, updated_at = NOW()
                        WHERE id = ?
                    ");
                    $upd->execute([
                        $itemType, $desc, $uom, $unitCost,
                        $laborHours, $catNum, $mfg, $sup,
                        $costCode, $epdUrl, $taxable, (int)$existingId
                    ]);
                    $updated++;
                } else {
                    $ins = $pdo->prepare("
                        INSERT INTO catalog_items (
                            catalog_id, cost_catalog_id, catalog_group_id, name, item_type, cost_type,
                            description, unit_of_measure, unit_cost, labor_hours, catalog_number,
                            manufacturer, supplier, cost_code, epd_url, taxable, active, revision, created_at, updated_at
                        ) VALUES (
                            ?, ?, ?, ?, ?, 'Material',
                            ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?, 1, 1, NOW(), NOW()
                        )
                    ");
                    $ins->execute([
                        $catalogId, $catalogId, $groupId, $name, $itemType,
                        $desc, $uom, $unitCost, $laborHours, $catNum,
                        $mfg, $sup, $costCode, $epdUrl, $taxable
                    ]);
                    $created++;
                }
            }

            $pdo->commit();
            echo json_encode([
                'success' => true,
                'type' => 'items',
                'created' => $created,
                'updated' => $updated,
                'errors' => $errors
            ]);
            exit;
        }

    } catch (\Throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        http_response_code(422);
        echo json_encode(['success' => false, 'error' => 'Import failed. No catalog changes were saved.']);
        exit;
    }
}

http_response_code(400);
echo json_encode(['error' => 'Invalid action specified.']);
exit;
