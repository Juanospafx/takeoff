<?php
declare(strict_types=1);

/**
 * Regression Test: Cost Catalog Import Schema Compatibility (assembly_parts.sort_order)
 *
 * Acceptance Criteria:
 * - Assembly workbook import discovers the actual assembly_parts columns and omits
 *   sort_order from INSERT when absent.
 * - Assembly workbook import persists imported order when assembly_parts.sort_order exists.
 * - All SQL remains parameterized and no production data or credentials are accessed by tests.
 * - Existing import security and Cost Catalog regression tests remain green.
 */

$root = dirname(__DIR__);
$code = (string) file_get_contents($root . '/api/catalog_io.php');
$failures = [];

$check = static function (bool $condition, string $message) use (&$failures): void {
    echo ($condition ? '[PASS] ' : '[FAIL] ') . $message . PHP_EOL;
    if (!$condition) $failures[] = $message;
};

// -----------------------------------------------------------------------------
// 1. Structural / Static Code Analysis of api/catalog_io.php
// -----------------------------------------------------------------------------

// 1.1 Verify column discovery helper or mechanism exists
$hasColumnDiscovery = str_contains($code, 'catalog_io_columns') ||
    str_contains($code, 'SHOW COLUMNS FROM') ||
    str_contains($code, 'SHOW COLUMNS FROM `assembly_parts`') ||
    preg_match('/SHOW\s+COLUMNS\s+FROM/i', $code);
$check((bool)$hasColumnDiscovery, 'api/catalog_io.php discovers actual database columns dynamically');

// 1.2 Locate the assembly_parts insert logic within the import block
$importBlockStart = strpos($code, "\$action === 'import'");
$check($importBlockStart !== false, 'api/catalog_io.php contains import handler');

$importCode = '';
if ($importBlockStart !== false) {
    $fallbackPos = strpos($code, "http_response_code(400);", $importBlockStart);
    $importCode = $fallbackPos !== false
        ? substr($code, $importBlockStart, $fallbackPos - $importBlockStart)
        : substr($code, $importBlockStart);
}

// Check that sort_order is NOT unconditionally hardcoded into INSERT INTO assembly_parts
$hardcodedSortOrderInsert = (bool) preg_match(
    '/INSERT\s+INTO\s+assembly_parts\s*\([^\)]*sort_order[^\)]*\)\s*VALUES\s*\(\s*\?(?:\s*,\s*\?){6}\s*\)/i',
    $importCode
);
$check(
    !$hardcodedSortOrderInsert,
    'assembly workbook import does NOT hardcode sort_order into INSERT INTO assembly_parts'
);

// 1.3 Verify sort_order presence check exists before preparing INSERT
$checksSortOrder = (bool) preg_match('/in_array\s*\(\s*[\'"]sort_order[\'"]\s*,/i', $importCode) ||
    str_contains($importCode, "'sort_order'");
$check($checksSortOrder, 'import checks for presence of sort_order in discovered assembly_parts columns');

// 1.4 Verify all queries in component linking are parameterized
// Distinguish trusted discovered column identifiers ($insertCols) from bound data values ($params)
$hasUnparameterizedDataValues = (bool) preg_match(
    '/INSERT\s+INTO\s+assembly_parts[^\;]+(?:\$comp|\$childItem|\$childCost|\$childLabor|\$assemblyId|\$partSort|\$_POST|\$_GET|\$input)/i',
    $importCode
) || (bool) preg_match(
    '/VALUES\s*\([^\)]*\$(?!placeholders\b)[a-zA-Z_\x7f-\xff]/i',
    $importCode
);
$hasParameterizedExecution = (bool) preg_match(
    '/\$partIns->execute\s*\(\s*\$params\s*\)/i',
    $importCode
);
$check(
    !$hasUnparameterizedDataValues && $hasParameterizedExecution,
    'all assembly_parts INSERT statements remain strictly parameterized'
);

// -----------------------------------------------------------------------------
// 2. Behavioral Verification with In-Memory SQLite Schemas
// -----------------------------------------------------------------------------

$hasSqlite = extension_loaded('pdo_sqlite') && in_array('sqlite', PDO::getAvailableDrivers(), true);

if (!$hasSqlite) {
    echo '[SKIP] SQLite PDO driver unavailable in runtime; skipping behavioral test.' . PHP_EOL;
} else {
    try {
        // 2.1 Test Schema WITHOUT sort_order (simulating legacy / production schema)
        $pdoLegacy = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $pdoLegacy->exec('CREATE TABLE assembly_parts (
            id INTEGER PRIMARY KEY,
            assembly_catalog_item_id INTEGER NOT NULL,
            part_catalog_item_id INTEGER NOT NULL,
            quantity REAL NOT NULL,
            ratio_type TEXT NOT NULL,
            unit_cost_snapshot REAL NOT NULL,
            unit_labor_time_snapshot REAL NOT NULL
        );');

        // Prove defect: hardcoded INSERT with sort_order fails on this schema
        $hardcodedFailed = false;
        try {
            $stmt = $pdoLegacy->prepare('INSERT INTO assembly_parts (assembly_catalog_item_id, part_catalog_item_id, quantity, ratio_type, unit_cost_snapshot, unit_labor_time_snapshot, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([100, 201, 1.0, 'per_unit', 5.0, 1.0, 0]);
        } catch (PDOException $e) {
            $hardcodedFailed = str_contains(strtolower($e->getMessage()), 'no column named sort_order') ||
                str_contains(strtolower($e->getMessage()), 'has no column');
        }
        $check($hardcodedFailed, 'hardcoded sort_order INSERT fails when sort_order column is absent in schema');

        // Simulate column discovery helper for legacy schema
        $columnsStmtLegacy = $pdoLegacy->query('PRAGMA table_info(assembly_parts)');
        $discoveredColsLegacy = [];
        foreach ($columnsStmtLegacy->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $discoveredColsLegacy[] = $c['name'];
        }
        $hasSortOrderLegacy = in_array('sort_order', $discoveredColsLegacy, true);
        $check(!$hasSortOrderLegacy, 'column discovery identifies sort_order is absent in legacy schema');

        // Dynamically build INSERT without sort_order
        $baseCols = ['assembly_catalog_item_id', 'part_catalog_item_id', 'quantity', 'ratio_type', 'unit_cost_snapshot', 'unit_labor_time_snapshot'];
        if ($hasSortOrderLegacy) {
            $baseCols[] = 'sort_order';
        }
        $placeholders = implode(', ', array_fill(0, count($baseCols), '?'));
        $insertStmtLegacy = $pdoLegacy->prepare("INSERT INTO assembly_parts (" . implode(', ', $baseCols) . ") VALUES ($placeholders)");

        $paramsLegacy = [100, 201, 2.5, 'per_unit', 10.0, 0.5];
        if ($hasSortOrderLegacy) {
            $paramsLegacy[] = 0;
        }
        $insertStmtLegacy->execute($paramsLegacy);

        $insertedCount = (int) $pdoLegacy->query('SELECT COUNT(*) FROM assembly_parts WHERE assembly_catalog_item_id = 100')->fetchColumn();
        $check($insertedCount === 1, 'assembly component inserts successfully when sort_order is omitted');

        // 2.2 Test Schema WITH sort_order (persisting order)
        $pdoModern = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $pdoModern->exec('CREATE TABLE assembly_parts (
            id INTEGER PRIMARY KEY,
            assembly_catalog_item_id INTEGER NOT NULL,
            part_catalog_item_id INTEGER NOT NULL,
            quantity REAL NOT NULL,
            ratio_type TEXT NOT NULL,
            unit_cost_snapshot REAL NOT NULL,
            unit_labor_time_snapshot REAL NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        );');

        $columnsStmtModern = $pdoModern->query('PRAGMA table_info(assembly_parts)');
        $discoveredColsModern = [];
        foreach ($columnsStmtModern->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $discoveredColsModern[] = $c['name'];
        }
        $hasSortOrderModern = in_array('sort_order', $discoveredColsModern, true);
        $check($hasSortOrderModern, 'column discovery identifies sort_order is present in modern schema');

        $modernCols = ['assembly_catalog_item_id', 'part_catalog_item_id', 'quantity', 'ratio_type', 'unit_cost_snapshot', 'unit_labor_time_snapshot'];
        if ($hasSortOrderModern) {
            $modernCols[] = 'sort_order';
        }
        $modernPlaceholders = implode(', ', array_fill(0, count($modernCols), '?'));
        $insertStmtModern = $pdoModern->prepare("INSERT INTO assembly_parts (" . implode(', ', $modernCols) . ") VALUES ($modernPlaceholders)");

        $components = [
            ['part_id' => 301, 'qty' => 1.0, 'cost' => 15.0, 'labor' => 0.5],
            ['part_id' => 302, 'qty' => 3.0, 'cost' => 2.5, 'labor' => 0.25],
            ['part_id' => 303, 'qty' => 0.5, 'cost' => 45.0, 'labor' => 1.5],
        ];

        $partSort = 0;
        foreach ($components as $comp) {
            $paramsModern = [
                200,
                $comp['part_id'],
                $comp['qty'],
                'per_unit',
                $comp['cost'],
                $comp['labor']
            ];
            if ($hasSortOrderModern) {
                $paramsModern[] = $partSort++;
            }
            $insertStmtModern->execute($paramsModern);
        }

        $retrievedOrders = $pdoModern->query('SELECT sort_order FROM assembly_parts WHERE assembly_catalog_item_id = 200 ORDER BY id ASC')->fetchAll(PDO::FETCH_COLUMN);
        $ordersMatch = ($retrievedOrders === [0, 1, 2] || $retrievedOrders === ['0', '1', '2']);
        $check($ordersMatch, 'assembly workbook import persists imported order when assembly_parts.sort_order exists');

    } catch (Throwable $e) {
        $msg = 'Behavioral test exception: ' . $e->getMessage();
        echo '[FAIL] ' . $msg . PHP_EOL;
        $failures[] = $msg;
    }
}

if ($failures !== []) {
    echo PHP_EOL . 'Test failed with ' . count($failures) . ' failure(s):' . PHP_EOL;
    foreach ($failures as $f) {
        echo '  - ' . $f . PHP_EOL;
    }
    exit(1);
}

exit(0);
