<?php
/**
 * Catalog Import / Export and Templates API
 *
 * Supports Unified Single-Workbook 2-Tab Architecture:
 * - Tab 1: Parts (Materials, Labor, Equipment, Items)
 * - Tab 2: Assemblies (Assemblies with component breakdown)
 *
 * Actions:
 * - GET  ?action=template&type=both|items|assemblies
 * - GET  ?action=export&catalog_id=X&group_id=Y&type=both|items|assemblies
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
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

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
function applyHeaderStyle(Worksheet $sheet, string $lastCol): void {
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

// Helper to normalize strings for robust matching
function normalizeKey(string $str): string {
    $str = str_replace(['“', '”', '″'], '"', $str);
    $str = str_replace(['‘', '’', '′'], "'", $str);
    $str = preg_replace('/\s+/', ' ', trim($str));
    return strtolower($str);
}

// Helper to discover actual columns for a database table
function catalog_io_columns(PDO $pdo, string $table): array {
    static $cache = [];
    $key = spl_object_hash($pdo) . ':' . $table;
    if (isset($cache[$key])) {
        return $cache[$key];
    }
    $columns = [];
    try {
        $driver = (string)$pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            $stmt = $pdo->query("PRAGMA table_info(`$table`)");
            if ($stmt) {
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $col) {
                    if (!empty($col['name'])) {
                        $columns[] = (string)$col['name'];
                    }
                }
            }
        } else {
            $stmt = $pdo->query("SHOW COLUMNS FROM `$table`");
            if ($stmt) {
                $columns = $stmt->fetchAll(PDO::FETCH_COLUMN);
            }
        }
    } catch (\Throwable) {
        $columns = [];
    }
    $cache[$key] = $columns;
    return $cache[$key];
}

// Helper to extract header mapping from a worksheet
function getSheetHeaderMap(Worksheet $sheet): array {
    $headerMap = [];
    $highestCol = $sheet->getHighestColumn();
    $maxColIndex = \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($highestCol);
    for ($col = 1; $col <= $maxColIndex; $col++) {
        $val = trim((string)($sheet->getCell([$col, 1])->getValue() ?? ''));
        if ($val === '') continue;
        $norm = preg_replace('/[^a-z0-9]/', '', strtolower($val));
        $headerMap[$norm] = $col;
    }
    return $headerMap;
}

// Helper: Populate a worksheet with Parts template
function populatePartsTemplate(Worksheet $sheet): void {
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
            0.62,
            0.0350,
            'TC-501',
            'Topaz',
            'City Electric',
            '26 05 33',
            '',
            'Yes'
        ],
        [
            '2027 Brightronix Cost Catalog',
            'Conduit Fittings',
            'Part',
            '1/2" Steel One Hole Strap, EMT',
            'Zinc-plated steel one-hole pipe strap',
            'ea',
            0.35,
            0.0200,
            'PS-050',
            'Minerallac',
            'Graybar',
            '26 05 29',
            '',
            'Yes'
        ],
        [
            '2027 Brightronix Cost Catalog',
            'Conduit Fittings',
            'Part',
            'Poly Pull Line, 500\' Box, 210 lb Tensile Strength',
            'Polypropylene blow line for conduit runs',
            'ft',
            0.04,
            0.0050,
            'PL-500',
            'Ideal',
            'Graybar',
            '26 05 00',
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
}

// Helper: Populate a worksheet with Assemblies template
function populateAssembliesTemplate(Worksheet $sheet): void {
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
}

// Helper: Populate a worksheet with actual Parts data
function populatePartsExport(Worksheet $sheet, PDO $pdo, int $catalogId, ?int $groupId): void {
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
}

// Helper: Populate a worksheet with actual Assemblies data
function populateAssembliesExport(Worksheet $sheet, PDO $pdo, int $catalogId, ?int $groupId): void {
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
        ORDER BY g.name ASC, i.name ASC, " . (in_array('sort_order', catalog_io_columns($pdo, 'assembly_parts'), true) ? 'p.sort_order ASC, p.id ASC' : 'p.id ASC') . "
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
}

// =========================================================================
// ACTION: TEMPLATE DOWNLOAD
// =========================================================================
if ($action === 'template') {
    $type = strtolower((string)($_GET['type'] ?? 'both'));
    $spreadsheet = new Spreadsheet();

    if ($type === 'items') {
        $sheet = $spreadsheet->getActiveSheet();
        populatePartsTemplate($sheet);
        $filename = 'Catalog_Parts_Template.xlsx';
    } elseif ($type === 'assemblies') {
        $sheet = $spreadsheet->getActiveSheet();
        populateAssembliesTemplate($sheet);
        $filename = 'Catalog_Assemblies_Template.xlsx';
    } else {
        // Master Template with BOTH sheets (Unified Architecture)
        $sheetParts = $spreadsheet->getActiveSheet();
        populatePartsTemplate($sheetParts);

        $sheetAssemblies = $spreadsheet->createSheet();
        populateAssembliesTemplate($sheetAssemblies);

        $spreadsheet->setActiveSheetIndex(0);
        $filename = 'Catalog_Master_Template.xlsx';
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
    $type = strtolower((string)($_GET['type'] ?? 'both'));

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

    if ($type === 'items') {
        $sheet = $spreadsheet->getActiveSheet();
        populatePartsExport($sheet, $pdo, $catalogId, $groupId);
        $filename = "{$safeCatName}_Parts_" . date('Y-m-d') . ".xlsx";
    } elseif ($type === 'assemblies') {
        $sheet = $spreadsheet->getActiveSheet();
        populateAssembliesExport($sheet, $pdo, $catalogId, $groupId);
        $filename = "{$safeCatName}_Assemblies_" . date('Y-m-d') . ".xlsx";
    } else {
        // UNIFIED EXPORT: Both Sheets in ONE Master Workbook
        $sheetParts = $spreadsheet->getActiveSheet();
        populatePartsExport($sheetParts, $pdo, $catalogId, $groupId);

        $sheetAssemblies = $spreadsheet->createSheet();
        populateAssembliesExport($sheetAssemblies, $pdo, $catalogId, $groupId);

        $spreadsheet->setActiveSheetIndex(0);
        $filename = "{$safeCatName}_Complete_Catalog_" . date('Y-m-d') . ".xlsx";
    }

    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: max-age=0');

    $writer = new Xlsx($spreadsheet);
    $writer->save('php://output');
    exit;
}

// =========================================================================
// ACTION: IMPORT FROM EXCEL (TWO-PASS UNIFIED WORKBOOK ENGINE)
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
        $highestRow = 0;
        foreach ($spreadsheet->getAllSheets() as $ws) {
            $r = $ws->getHighestRow();
            if ($r > $highestRow) {
                $highestRow = $r;
            }
        }

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


        // Preload Groups in this catalog
        $groupMap = [];
        $grpStmt = $pdo->prepare("SELECT id, name FROM catalog_groups WHERE catalog_id = ? AND deleted_at IS NULL");
        $grpStmt->execute([$catalogId]);
        while ($g = $grpStmt->fetch(PDO::FETCH_ASSOC)) {
            $groupMap[normalizeKey($g['name'])] = (int)$g['id'];
        }

        $getOrCreateGroup = function(string $groupName) use ($pdo, $catalogId, &$groupMap, $fallbackGroupId): ?int {
            $groupName = trim($groupName);
            if ($groupName === '') return $fallbackGroupId;
            $key = normalizeKey($groupName);
            if (isset($groupMap[$key])) return $groupMap[$key];

            $ins = $pdo->prepare("INSERT INTO catalog_groups (catalog_id, name, active, enabled_for_projects, sort_order) VALUES (?, ?, 1, 1, 100)");
            $ins->execute([$catalogId, $groupName]);
            $newId = (int)$pdo->lastInsertId();
            $groupMap[$key] = $newId;
            return $newId;
        };

        // Identify Sheets
        $partsSheet = null;
        $assembliesSheet = null;

        // 1. By title
        foreach ($spreadsheet->getAllSheets() as $ws) {
            $title = strtolower(trim($ws->getTitle()));
            if (strpos($title, 'part') !== false || strpos($title, 'item') !== false || strpos($title, 'material') !== false) {
                if (!$partsSheet) $partsSheet = $ws;
            } elseif (strpos($title, 'assembl') !== false || strpos($title, 'kit') !== false || strpos($title, 'ensamble') !== false) {
                if (!$assembliesSheet) $assembliesSheet = $ws;
            }
        }

        // 2. By header inspection if not matched by title
        if (!$partsSheet && !$assembliesSheet) {
            foreach ($spreadsheet->getAllSheets() as $ws) {
                $hMap = getSheetHeaderMap($ws);
                if (isset($hMap['assemblyname']) || isset($hMap['componentitemname']) || isset($hMap['partname'])) {
                    if (!$assembliesSheet) $assembliesSheet = $ws;
                } elseif (isset($hMap['name']) || isset($hMap['itemtype']) || isset($hMap['unitcost'])) {
                    if (!$partsSheet) $partsSheet = $ws;
                }
            }
        }

        // 3. Fallback: single active sheet
        if (!$partsSheet && !$assembliesSheet) {
            $activeSheet = $spreadsheet->getActiveSheet();
            $hMap = getSheetHeaderMap($activeSheet);
            if (isset($hMap['assemblyname']) || isset($hMap['componentitemname'])) {
                $assembliesSheet = $activeSheet;
            } else {
                $partsSheet = $activeSheet;
            }
        }

        // Respect explicit user import_type override if requested
        if ($importType === 'items') {
            $assembliesSheet = null;
            if (!$partsSheet) $partsSheet = $spreadsheet->getActiveSheet();
        } elseif ($importType === 'assemblies') {
            $partsSheet = null;
            if (!$assembliesSheet) $assembliesSheet = $spreadsheet->getActiveSheet();
        }

        // Begin DB Transaction for Atomic Two-Pass Processing
        $pdo->beginTransaction();

        $partsCreated = 0;
        $partsUpdated = 0;
        $assembliesCreated = 0;
        $assembliesUpdated = 0;
        $componentsLinked = 0;
        $warnings = [];

        // Fast Lookup Table for Parts: normalized_name => [id, unit_cost, labor_hours]
        $partLookup = [];
        $rawExistingParts = $pdo->query("SELECT id, name, unit_cost, labor_hours FROM catalog_items WHERE catalog_id = $catalogId AND item_type != 'assembly' AND deleted_at IS NULL")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rawExistingParts as $rp) {
            $partLookup[normalizeKey($rp['name'])] = [
                'id' => (int)$rp['id'],
                'name' => $rp['name'],
                'unit_cost' => (float)$rp['unit_cost'],
                'labor_hours' => (float)$rp['labor_hours']
            ];
        }

        // =====================================================================
        // PASS 1: PROCESS PARTS / ITEMS SHEET
        // =====================================================================
        if ($partsSheet) {
            $highestRow = $partsSheet->getHighestRow();
            $headerMap = getSheetHeaderMap($partsSheet);

            for ($r = 2; $r <= $highestRow; $r++) {
                $nameCol = $headerMap['name'] ?? 4;
                $name = trim((string)($partsSheet->getCell([$nameCol, $r])->getValue() ?? ''));
                if ($name === '') continue;

                $grpCol = $headerMap['group'] ?? 2;
                $grpName = trim((string)($partsSheet->getCell([$grpCol, $r])->getValue() ?? ''));

                $typeCol = $headerMap['itemtype'] ?? $headerMap['type'] ?? 3;
                $itemType = strtolower(trim((string)($partsSheet->getCell([$typeCol, $r])->getValue() ?? 'part')));
                if (!in_array($itemType, ['part', 'labor', 'equipment', 'travel', 'material'])) {
                    $itemType = 'part';
                }

                $descCol = $headerMap['description'] ?? 5;
                $desc = trim((string)($partsSheet->getCell([$descCol, $r])->getValue() ?? ''));

                $uomCol = $headerMap['unit'] ?? $headerMap['uom'] ?? 6;
                $uom = trim((string)($partsSheet->getCell([$uomCol, $r])->getValue() ?? 'ea'));

                $costCol = $headerMap['unitcost'] ?? $headerMap['cost'] ?? 7;
                $unitCost = (float)($partsSheet->getCell([$costCol, $r])->getValue() ?? 0);

                $laborCol = $headerMap['laborhours'] ?? $headerMap['unitlaborhrs'] ?? $headerMap['labor'] ?? 8;
                $laborHours = (float)($partsSheet->getCell([$laborCol, $r])->getValue() ?? 0);

                $catNumCol = $headerMap['catalognumber'] ?? $headerMap['partnumber'] ?? 9;
                $catNum = trim((string)($partsSheet->getCell([$catNumCol, $r])->getValue() ?? ''));

                $mfgCol = $headerMap['manufacturer'] ?? 10;
                $mfg = trim((string)($partsSheet->getCell([$mfgCol, $r])->getValue() ?? ''));

                $supCol = $headerMap['supplier'] ?? 11;
                $sup = trim((string)($partsSheet->getCell([$supCol, $r])->getValue() ?? ''));

                $costCodeCol = $headerMap['costcode'] ?? 12;
                $costCode = trim((string)($partsSheet->getCell([$costCodeCol, $r])->getValue() ?? ''));

                $epdCol = $headerMap['epdurl'] ?? 13;
                $epdUrl = trim((string)($partsSheet->getCell([$epdCol, $r])->getValue() ?? ''));

                $taxCol = $headerMap['taxable'] ?? 14;
                $taxStr = strtolower(trim((string)($partsSheet->getCell([$taxCol, $r])->getValue() ?? 'yes')));
                $taxable = in_array($taxStr, ['yes', '1', 'true', 'si', 'y']) ? 1 : 0;

                $groupId = $getOrCreateGroup($grpName);

                // Upsert into catalog_items
                $find = $pdo->prepare("SELECT id FROM catalog_items WHERE catalog_id = ? AND (catalog_group_id = ? OR ? IS NULL) AND name = ? AND deleted_at IS NULL LIMIT 1");
                $find->execute([$catalogId, $groupId, $groupId, $name]);
                $existingId = $find->fetchColumn();

                if ($existingId) {
                    $partId = (int)$existingId;
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
                        $costCode, $epdUrl, $taxable, $partId
                    ]);
                    $partsUpdated++;
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
                    $partId = (int)$pdo->lastInsertId();
                    $partsCreated++;
                }

                // Register in fast lookup table immediately for Pass 2!
                $partLookup[normalizeKey($name)] = [
                    'id' => $partId,
                    'name' => $name,
                    'unit_cost' => $unitCost,
                    'labor_hours' => $laborHours
                ];
            }
        }

        // =====================================================================
        // PASS 2: PROCESS ASSEMBLIES SHEET (WITH GUARANTEED PART AVAILABILITY)
        // =====================================================================
        if ($assembliesSheet) {
            $highestRow = $assembliesSheet->getHighestRow();
            $headerMap = getSheetHeaderMap($assembliesSheet);

            $assembliesData = [];
            for ($r = 2; $r <= $highestRow; $r++) {
                $asmNameCol = $headerMap['assemblyname'] ?? $headerMap['name'] ?? 3;
                $asmName = trim((string)($assembliesSheet->getCell([$asmNameCol, $r])->getValue() ?? ''));
                if ($asmName === '') continue;

                $grpCol = $headerMap['group'] ?? 2;
                $grpName = trim((string)($assembliesSheet->getCell([$grpCol, $r])->getValue() ?? ''));

                $descCol = $headerMap['description'] ?? 4;
                $desc = trim((string)($assembliesSheet->getCell([$descCol, $r])->getValue() ?? ''));

                $uomCol = $headerMap['unit'] ?? $headerMap['uom'] ?? 5;
                $uom = trim((string)($assembliesSheet->getCell([$uomCol, $r])->getValue() ?? 'ea'));

                $measCol = $headerMap['measurementtype'] ?? 6;
                $measType = trim((string)($assembliesSheet->getCell([$measCol, $r])->getValue() ?? 'count'));

                $compNameCol = $headerMap['componentitemname'] ?? $headerMap['componentname'] ?? $headerMap['partitemname'] ?? 7;
                $compName = trim((string)($assembliesSheet->getCell([$compNameCol, $r])->getValue() ?? ''));

                $qtyCol = $headerMap['quantity'] ?? $headerMap['qty'] ?? 8;
                $qtyVal = (float)($assembliesSheet->getCell([$qtyCol, $r])->getValue() ?? 1);

                $ratioCol = $headerMap['ratiotype'] ?? 9;
                $ratioType = trim((string)($assembliesSheet->getCell([$ratioCol, $r])->getValue() ?? ''));
                if (!$ratioType) {
                    $ratioType = strtolower($measType) === 'linear' ? 'per_linear_length' : 'per_unit';
                }

                $key = normalizeKey($asmName);
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
                    $assembliesUpdated++;
                } else {
                    $ins = $pdo->prepare("INSERT INTO catalog_items (catalog_id, cost_catalog_id, catalog_group_id, name, description, item_type, cost_type, unit_of_measure, measurement_type, unit_cost, labor_hours, active, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'assembly', 'Material', ?, ?, 0.00, 0.00, 1, 1, NOW(), NOW())");
                    $ins->execute([$catalogId, $catalogId, $groupId, $asm['name'], $asm['description'], $asm['uom'], $asm['measurement_type']]);
                    $assemblyId = (int)$pdo->lastInsertId();
                    $assembliesCreated++;
                }

                // Link components
                if (!empty($asm['components'])) {
                    $pdo->prepare("DELETE FROM assembly_parts WHERE assembly_catalog_item_id = ?")->execute([$assemblyId]);

                    $totalCost = 0.0;
                    $totalLabor = 0.0;
                    $partSort = 0;

                    $partCols = catalog_io_columns($pdo, 'assembly_parts');
                    $hasSortOrder = in_array('sort_order', $partCols, true);
                    $insertCols = ['assembly_catalog_item_id', 'part_catalog_item_id', 'quantity', 'ratio_type', 'unit_cost_snapshot', 'unit_labor_time_snapshot'];
                    if ($hasSortOrder) {
                        $insertCols[] = 'sort_order';
                    }
                    $placeholders = implode(', ', array_fill(0, count($insertCols), '?'));
                    $partIns = $pdo->prepare("INSERT INTO assembly_parts (" . implode(', ', $insertCols) . ") VALUES ($placeholders)");

                    foreach ($asm['components'] as $comp) {
                        $compNorm = normalizeKey($comp['component_name']);
                        $childItem = $partLookup[$compNorm] ?? null;

                        // Fallback fuzzy search across partLookup
                        if (!$childItem) {
                            foreach ($partLookup as $k => $itemMeta) {
                                if (strpos($k, $compNorm) !== false || strpos($compNorm, $k) !== false) {
                                    $childItem = $itemMeta;
                                    break;
                                }
                            }
                        }

                        if ($childItem) {
                            $childCost = (float)$childItem['unit_cost'];
                            $childLabor = (float)$childItem['labor_hours'];
                            $params = [
                                $assemblyId,
                                (int)$childItem['id'],
                                (float)$comp['quantity'],
                                $comp['ratio_type'],
                                $childCost,
                                $childLabor
                            ];
                            if ($hasSortOrder) {
                                $params[] = $partSort++;
                            }
                            $partIns->execute($params);
                            $componentsLinked++;
                            $totalCost += ($comp['quantity'] * $childCost);
                            $totalLabor += ($comp['quantity'] * $childLabor);
                        } else {
                            $warnings[] = "Part '{$comp['component_name']}' for assembly '{$asm['name']}' not found in catalog.";
                        }
                    }

                    // Update assembly calculated unit cost and labor hours
                    $pdo->prepare("UPDATE catalog_items SET unit_cost = ?, labor_hours = ?, updated_at = NOW() WHERE id = ?")->execute([$totalCost, $totalLabor, $assemblyId]);
                }
            }
        }

        $pdo->commit();

        echo json_encode([
            'success' => true,
            'has_parts' => $partsSheet !== null,
            'has_assemblies' => $assembliesSheet !== null,
            'parts_created' => $partsCreated,
            'parts_updated' => $partsUpdated,
            'assemblies_created' => $assembliesCreated,
            'assemblies_updated' => $assembliesUpdated,
            'components_linked' => $componentsLinked,
            'warnings' => array_slice($warnings, 0, 10),
            'total_warnings' => count($warnings)
        ]);
        exit;

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
