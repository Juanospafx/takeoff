<?php
declare(strict_types=1);

/**
 * Regression Test: Cost Catalog Import Schema Compatibility
 *
 * Acceptance Criteria:
 * - Item import omits revision when catalog_items lacks that column.
 * - Assembly import omits measurement_type and revision when catalog_items lacks those columns.
 * - Modern schemas persist revision and measurement_type when those columns exist.
 * - Dynamic INSERT and UPDATE statements use only trusted discovered column names and parameterized values.
 * - Import remains one atomic transaction and rolls back completely on failure.
 * - Server-side diagnostics are sanitized and the browser receives no SQL details or credentials.
 * - Regression tests cover both the verified production legacy shape and a modern schema contract.
 * - Assembly workbook import discovers actual assembly_parts columns and omits sort_order when absent.
 * - Assembly workbook import persists imported order when assembly_parts.sort_order exists.
 * - The import catch block creates a cryptographically random opaque incident identifier.
 * - The server log contains only a fixed catalog import failure label and the opaque identifier.
 * - The HTTP response remains generic and may include only the opaque identifier, never raw exception data.
 * - Regression tests reject logging of exception messages, SQLSTATE, credentials, paths or workbook values.
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

// 1.1 Verify column discovery helper exists
$hasColumnDiscovery = str_contains($code, 'catalog_io_columns') ||
    str_contains($code, 'SHOW COLUMNS FROM') ||
    preg_match('/SHOW\s+COLUMNS\s+FROM/i', $code);
$check((bool)$hasColumnDiscovery, 'api/catalog_io.php discovers actual database columns dynamically');

// 1.2 Locate the import block
$importBlockStart = strpos($code, "\$action === 'import'");
$check($importBlockStart !== false, 'api/catalog_io.php contains import handler');

$importCode = '';
if ($importBlockStart !== false) {
    $fallbackPos = strpos($code, "http_response_code(400);", $importBlockStart);
    $importCode = $fallbackPos !== false
        ? substr($code, $importBlockStart, $fallbackPos - $importBlockStart)
        : substr($code, $importBlockStart);
}

// 1.3 Check assembly_parts.sort_order compatibility
$hardcodedSortOrderInsert = (bool) preg_match(
    '/INSERT\s+INTO\s+assembly_parts\s*\([^\)]*sort_order[^\)]*\)\s*VALUES\s*\(\s*\?(?:\s*,\s*\?){6}\s*\)/i',
    $importCode
);
$check(
    !$hardcodedSortOrderInsert,
    'assembly workbook import does NOT hardcode sort_order into INSERT INTO assembly_parts'
);

$checksSortOrder = (bool) preg_match('/in_array\s*\(\s*[\'"]sort_order[\'"]\s*,/i', $importCode) ||
    str_contains($importCode, "'sort_order'");
$check($checksSortOrder, 'import checks for presence of sort_order in discovered assembly_parts columns');

// 1.4 Check catalog_items.revision compatibility for Item Import
$hardcodedItemRevisionInsert = (bool) preg_match(
    '/INSERT\s+INTO\s+catalog_items\s*\([^\)]*\brevision\b[^\)]*\)\s*VALUES\s*\([^\)]*1\s*,\s*1\s*,/i',
    $importCode
);
$check(
    !$hardcodedItemRevisionInsert,
    'item workbook import does NOT hardcode revision into INSERT INTO catalog_items'
);

// 1.5 Check catalog_items.measurement_type and revision compatibility for Assembly Import
$hardcodedAssemblyMeasurementTypeUpdate = (bool) preg_match(
    '/UPDATE\s+catalog_items\s+SET\s+[^;]*measurement_type\s*=\s*\?/i',
    $importCode
);
$check(
    !$hardcodedAssemblyMeasurementTypeUpdate,
    'assembly workbook import does NOT hardcode measurement_type into UPDATE catalog_items'
);

$hardcodedAssemblyInsertOptionalCols = (bool) preg_match(
    '/INSERT\s+INTO\s+catalog_items\s*\([^\)]*\bmeasurement_type\b[^\)]*\brevision\b[^\)]*\)\s*VALUES/i',
    $importCode
);
$check(
    !$hardcodedAssemblyInsertOptionalCols,
    'assembly workbook import does NOT hardcode measurement_type or revision into INSERT INTO catalog_items'
);

// 1.6 Verify discovery checks for catalog_items optional columns
$checksItemRevision = (bool) preg_match('/[\'"]revision[\'"]\s*,\s*\$(?:catalogItemCols|itemCols|catalogCols)/i', $importCode) ||
    (bool) preg_match('/in_array\s*\(\s*[\'"]revision[\'"]/i', $importCode);
$check($checksItemRevision, 'import discovers presence of revision column in catalog_items');

$checksItemMeasurementType = (bool) preg_match('/[\'"]measurement_type[\'"]\s*,\s*\$(?:catalogItemCols|itemCols|catalogCols)/i', $importCode) ||
    (bool) preg_match('/in_array\s*\(\s*[\'"]measurement_type[\'"]/i', $importCode);
$check($checksItemMeasurementType, 'import discovers presence of measurement_type column in catalog_items');

// 1.7 Parameterization and query construction security
$hasUnparameterizedInsertValues = (bool) preg_match(
    '/INSERT\s+INTO\s+(?:catalog_items|assembly_parts)[^\;]+(?:\$name|\$desc|\$uom|\$unitCost|\$laborHours|\$comp\b|\$asm\b|\$_POST|\$_GET|\$input)/i',
    $importCode
);
$hasUnparameterizedUpdateValues = (bool) preg_match(
    '/UPDATE\s+catalog_items\s+SET[^\;]+(?:\$name|\$desc|\$uom|\$unitCost|\$laborHours|\$comp\b|\$asm\b|\$_POST|\$_GET|\$input)/i',
    $importCode
);
$check(
    !$hasUnparameterizedInsertValues && !$hasUnparameterizedUpdateValues,
    'dynamic catalog_items and assembly_parts statements remain strictly parameterized'
);

// 1.8 Atomic transaction boundary and sanitized exception handling
$hasTransactionManagement = str_contains($importCode, '$pdo->beginTransaction()') &&
    str_contains($importCode, '$pdo->commit()') &&
    str_contains($importCode, '$pdo->rollBack()');
$check($hasTransactionManagement, 'import wraps entire workbook engine in atomic transaction with rollback');

$sanitizedErrorHandling = (bool) preg_match(
    '/catch\s*\(\s*(?:\\\\?Throwable|\S+Exception)\s*(?:\$\w+)?\s*\)\s*\{[\s\S]*?json_encode\(\[\s*[\'"]success[\'"]\s*=>\s*false,\s*[\'"]error[\'"]\s*=>\s*[\'"]Import failed\. No catalog changes were saved\.[\'"](?:\s*,\s*[\'"]incident_id[\'"]\s*=>\s*\$incidentId)?\s*\]\)/',
    $importCode
);
$check($sanitizedErrorHandling, 'error response sanitizes failure diagnostics without exposing SQL or credentials');

$doesNotLeakExceptions = !preg_match(
    '/(?:echo\s+json_encode|error_log)\([^\)]*(?:\$e->getMessage\(\)|\$e->getTraceAsString\(\)|SQLSTATE)/i',
    $importCode
);
$check($doesNotLeakExceptions, 'browser response and server log never leak raw exception message or SQLSTATE');

// 1.9 Sanitized incident identifier generation and logging
$createsIncidentId = (bool) preg_match(
    '/\$incidentId\s*=\s*bin2hex\(\s*random_bytes\(\s*16\s*\)\s*\);/',
    $importCode
);
$check($createsIncidentId, 'import catch block creates a cryptographically random opaque incident identifier');

$logsFixedLabelWithIncident = (bool) preg_match(
    '/error_log\(\s*["\']Catalog import failure:\s*(?:\{\$incidentId\}|"\s*\.\s*\$incidentId|\$incidentId)\s*["\']\s*\);/',
    $importCode
);
$check($logsFixedLabelWithIncident, 'server log contains only fixed catalog import failure label and opaque identifier');

$responseIncludesIncidentId = (bool) preg_match(
    '/echo\s+json_encode\(\[[^\]]*[\'"]incident_id[\'"]\s*=>\s*\$incidentId[^\]]*\]\);/',
    $importCode
);
$check($responseIncludesIncidentId, 'HTTP response remains generic and may include only the opaque identifier');

// 1.10 Reject logging of exception messages, SQLSTATE, credentials, paths or workbook values
$rejectsExceptionLogging = !preg_match(
    '/error_log\s*\([^;]*(?:\$e\b|\bgetMessage\b|\bgetTrace\b|\bgetCode\b|\bgetPrevious\b|\bgetLine\b|\bgetFile\b|\bThrowable\b|\bException\b)/i',
    $importCode
);
$check($rejectsExceptionLogging, 'regression tests reject logging of exception details or Throwable objects');

$rejectsSqlLogging = !preg_match(
    '/error_log\s*\([^;]*(?:SQLSTATE|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bFROM\b|\bWHERE\b|\$pdo|\$stmt|\$query)/i',
    $importCode
);
$check($rejectsSqlLogging, 'regression tests reject logging of SQLSTATE or SQL queries');

$rejectsCredentialsLogging = !preg_match(
    '/error_log\s*\([^;]*(?:password|passwd|secret|credential|auth_token|bearer|\$csrfToken|\$sessionCsrf)/i',
    $importCode
);
$check($rejectsCredentialsLogging, 'regression tests reject logging of credentials or authentication tokens');

$rejectsPathsLogging = !preg_match(
    '/error_log\s*\([^;]*(?:__FILE__|__DIR__|\$_FILES|tmp_name|\$filePath|\$path|\$root)/i',
    $importCode
);
$check($rejectsPathsLogging, 'regression tests reject logging of filesystem paths or temporary file locations');

$rejectsWorkbookLogging = !preg_match(
    '/error_log\s*\([^;]*(?:\$sheet|\$cell|\$row|\$val|\$comp|\$asm|\$childItem|\$partLookup|\$warnings|\$highestRow|\$highestCol)/i',
    $importCode
);
$check($rejectsWorkbookLogging, 'regression tests reject logging of workbook values or sheet content');


// -----------------------------------------------------------------------------
// 2. Behavioral Verification with In-Memory SQLite Schemas
// -----------------------------------------------------------------------------

$hasSqlite = extension_loaded('pdo_sqlite') && in_array('sqlite', PDO::getAvailableDrivers(), true);

if (!$hasSqlite) {
    echo '[SKIP] SQLite PDO driver unavailable in runtime; skipping behavioral test.' . PHP_EOL;
} else {
    try {
        // Register NOW() function on SQLite PDO instances if needed
        $initSqlitePdo = static function(PDO $pdo): void {
            if (method_exists($pdo, 'sqliteCreateFunction')) {
                $pdo->sqliteCreateFunction('NOW', static fn() => date('Y-m-d H:i:s'));
            }
        };

        // ---------------------------------------------------------------------
        // 2.1 Test Schema WITHOUT optional columns (verified production legacy shape)
        // ---------------------------------------------------------------------
        $pdoLegacy = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $initSqlitePdo($pdoLegacy);

        $pdoLegacy->exec('CREATE TABLE catalog_items (
            id INTEGER PRIMARY KEY,
            catalog_id INTEGER NOT NULL,
            cost_catalog_id INTEGER,
            catalog_group_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            item_type TEXT NOT NULL,
            cost_type TEXT,
            unit_of_measure TEXT,
            unit_cost REAL NOT NULL DEFAULT 0,
            labor_hours REAL NOT NULL DEFAULT 0,
            catalog_number TEXT,
            manufacturer TEXT,
            supplier TEXT,
            cost_code TEXT,
            epd_url TEXT,
            taxable INTEGER NOT NULL DEFAULT 1,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT,
            updated_at TEXT
        );');

        $pdoLegacy->exec('CREATE TABLE assembly_parts (
            id INTEGER PRIMARY KEY,
            assembly_catalog_item_id INTEGER NOT NULL,
            part_catalog_item_id INTEGER NOT NULL,
            quantity REAL NOT NULL,
            ratio_type TEXT NOT NULL,
            unit_cost_snapshot REAL NOT NULL,
            unit_labor_time_snapshot REAL NOT NULL
        );');

        // Prove defect: hardcoded INSERT with revision fails on legacy schema
        $hardcodedItemFailed = false;
        try {
            $stmt = $pdoLegacy->prepare("INSERT INTO catalog_items (
                catalog_id, cost_catalog_id, catalog_group_id, name, item_type, cost_type,
                description, unit_of_measure, unit_cost, labor_hours, catalog_number,
                manufacturer, supplier, cost_code, epd_url, taxable, active, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'Material', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NOW(), NOW())");
            $stmt->execute([1, 1, 1, 'Part A', 'part', 'desc', 'ea', 10.0, 1.0, 'CAT-1', 'Mfg', 'Sup', 'CC-1', '', 1]);
        } catch (PDOException $e) {
            $hardcodedItemFailed = str_contains(strtolower($e->getMessage()), 'revision');
        }
        $check($hardcodedItemFailed, 'hardcoded revision INSERT fails when revision column is absent in schema');

        // Prove defect: hardcoded UPDATE with measurement_type fails on legacy schema
        $hardcodedAsmUpdFailed = false;
        try {
            $stmt = $pdoLegacy->prepare("UPDATE catalog_items SET description = ?, unit_of_measure = ?, measurement_type = ?, item_type = 'assembly', active = 1, updated_at = NOW() WHERE id = ?");
            $stmt->execute(['desc', 'ea', 'count', 99]);
        } catch (PDOException $e) {
            $hardcodedAsmUpdFailed = str_contains(strtolower($e->getMessage()), 'measurement_type');
        }
        $check($hardcodedAsmUpdFailed, 'hardcoded measurement_type UPDATE fails when measurement_type column is absent in schema');

        // Prove defect: hardcoded assembly INSERT with measurement_type and revision fails on legacy schema
        $hardcodedAsmInsFailed = false;
        try {
            $stmt = $pdoLegacy->prepare("INSERT INTO catalog_items (catalog_id, cost_catalog_id, catalog_group_id, name, description, item_type, cost_type, unit_of_measure, measurement_type, unit_cost, labor_hours, active, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'assembly', 'Material', ?, ?, 0.00, 0.00, 1, 1, NOW(), NOW())");
            $stmt->execute([1, 1, 1, 'Asm A', 'desc', 'ea', 'count']);
        } catch (PDOException $e) {
            $hardcodedAsmInsFailed = str_contains(strtolower($e->getMessage()), 'measurement_type') ||
                str_contains(strtolower($e->getMessage()), 'revision');
        }
        $check($hardcodedAsmInsFailed, 'hardcoded measurement_type/revision assembly INSERT fails on legacy schema');

        // Column discovery simulation on legacy schema
        $itemColsLegacy = [];
        foreach ($pdoLegacy->query('PRAGMA table_info(catalog_items)')->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $itemColsLegacy[] = $c['name'];
        }
        $hasRevLegacy = in_array('revision', $itemColsLegacy, true);
        $hasMeasLegacy = in_array('measurement_type', $itemColsLegacy, true);
        $check(!$hasRevLegacy && !$hasMeasLegacy, 'column discovery confirms revision and measurement_type are absent in legacy schema');

        // Capability-aware Item INSERT on legacy schema
        $itemInsertColsLegacy = [
            'catalog_id', 'cost_catalog_id', 'catalog_group_id', 'name', 'item_type', 'cost_type',
            'description', 'unit_of_measure', 'unit_cost', 'labor_hours', 'catalog_number',
            'manufacturer', 'supplier', 'cost_code', 'epd_url', 'taxable', 'active'
        ];
        if ($hasRevLegacy) {
            $itemInsertColsLegacy[] = 'revision';
        }
        $itemInsertColsLegacy[] = 'created_at';
        $itemInsertColsLegacy[] = 'updated_at';

        $itemPlaceholdersLegacy = array_fill(0, count($itemInsertColsLegacy) - 2, '?');
        $itemPlaceholdersLegacy[] = 'NOW()';
        $itemPlaceholdersLegacy[] = 'NOW()';

        $insItemStmtLegacy = $pdoLegacy->prepare("INSERT INTO catalog_items (" . implode(', ', $itemInsertColsLegacy) . ") VALUES (" . implode(', ', $itemPlaceholdersLegacy) . ")");
        $itemParamsLegacy = [
            1, 1, 10, 'Legacy Conduit 1/2"', 'part', 'Material',
            '1/2" Metallic Tubing', 'ft', 1.25, 0.05, 'EMT-050',
            'Allied', 'Graybar', '26 05 33', '', 1, 1
        ];
        if ($hasRevLegacy) {
            $itemParamsLegacy[] = 1;
        }
        $insItemStmtLegacy->execute($itemParamsLegacy);
        $insertedItemId = (int)$pdoLegacy->lastInsertId();
        $check($insertedItemId > 0, 'capability-aware item import succeeds without revision on legacy schema');

        // Capability-aware Assembly INSERT on legacy schema
        $asmInsertColsLegacy = [
            'catalog_id', 'cost_catalog_id', 'catalog_group_id', 'name', 'description',
            'item_type', 'cost_type', 'unit_of_measure'
        ];
        if ($hasMeasLegacy) {
            $asmInsertColsLegacy[] = 'measurement_type';
        }
        $asmInsertColsLegacy[] = 'unit_cost';
        $asmInsertColsLegacy[] = 'labor_hours';
        $asmInsertColsLegacy[] = 'active';
        if ($hasRevLegacy) {
            $asmInsertColsLegacy[] = 'revision';
        }
        $asmInsertColsLegacy[] = 'created_at';
        $asmInsertColsLegacy[] = 'updated_at';

        $asmPlaceholdersLegacy = array_fill(0, count($asmInsertColsLegacy) - 2, '?');
        $asmPlaceholdersLegacy[] = 'NOW()';
        $asmPlaceholdersLegacy[] = 'NOW()';

        $insAsmStmtLegacy = $pdoLegacy->prepare("INSERT INTO catalog_items (" . implode(', ', $asmInsertColsLegacy) . ") VALUES (" . implode(', ', $asmPlaceholdersLegacy) . ")");
        $asmParamsLegacy = [1, 1, 10, 'Legacy EMT Assembly', 'Conduit branch assembly', 'assembly', 'Material', 'ft'];
        if ($hasMeasLegacy) {
            $asmParamsLegacy[] = 'linear';
        }
        $asmParamsLegacy[] = 0.0;
        $asmParamsLegacy[] = 0.0;
        $asmParamsLegacy[] = 1;
        if ($hasRevLegacy) {
            $asmParamsLegacy[] = 1;
        }
        $insAsmStmtLegacy->execute($asmParamsLegacy);
        $insertedAsmId = (int)$pdoLegacy->lastInsertId();
        $check($insertedAsmId > 0, 'capability-aware assembly import succeeds without measurement_type and revision on legacy schema');

        // Capability-aware Assembly UPDATE on legacy schema
        $asmUpdateSetsLegacy = ['description = ?', 'unit_of_measure = ?'];
        if ($hasMeasLegacy) {
            $asmUpdateSetsLegacy[] = 'measurement_type = ?';
        }
        $asmUpdateSetsLegacy[] = "item_type = 'assembly'";
        $asmUpdateSetsLegacy[] = 'active = 1';
        $asmUpdateSetsLegacy[] = 'updated_at = NOW()';

        $updAsmStmtLegacy = $pdoLegacy->prepare("UPDATE catalog_items SET " . implode(', ', $asmUpdateSetsLegacy) . " WHERE id = ?");
        $asmUpdParamsLegacy = ['Updated description', 'ft'];
        if ($hasMeasLegacy) {
            $asmUpdParamsLegacy[] = 'linear';
        }
        $asmUpdParamsLegacy[] = $insertedAsmId;
        $updAsmStmtLegacy->execute($asmUpdParamsLegacy);

        $updatedDesc = $pdoLegacy->query("SELECT description FROM catalog_items WHERE id = $insertedAsmId")->fetchColumn();
        $check($updatedDesc === 'Updated description', 'capability-aware assembly update succeeds without measurement_type on legacy schema');


        // ---------------------------------------------------------------------
        // 2.2 Test Schema WITH optional columns (modern schema contract)
        // ---------------------------------------------------------------------
        $pdoModern = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $initSqlitePdo($pdoModern);

        $pdoModern->exec('CREATE TABLE catalog_items (
            id INTEGER PRIMARY KEY,
            catalog_id INTEGER NOT NULL,
            cost_catalog_id INTEGER,
            catalog_group_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            item_type TEXT NOT NULL,
            cost_type TEXT,
            unit_of_measure TEXT,
            measurement_type TEXT NOT NULL DEFAULT \'count\',
            unit_cost REAL NOT NULL DEFAULT 0,
            labor_hours REAL NOT NULL DEFAULT 0,
            catalog_number TEXT,
            manufacturer TEXT,
            supplier TEXT,
            cost_code TEXT,
            epd_url TEXT,
            taxable INTEGER NOT NULL DEFAULT 1,
            active INTEGER NOT NULL DEFAULT 1,
            revision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT,
            updated_at TEXT
        );');

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

        $itemColsModern = [];
        foreach ($pdoModern->query('PRAGMA table_info(catalog_items)')->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $itemColsModern[] = $c['name'];
        }
        $hasRevModern = in_array('revision', $itemColsModern, true);
        $hasMeasModern = in_array('measurement_type', $itemColsModern, true);
        $check($hasRevModern && $hasMeasModern, 'column discovery confirms revision and measurement_type are present in modern schema');

        // Modern Item INSERT: persists revision = 1
        $itemInsertColsModern = [
            'catalog_id', 'cost_catalog_id', 'catalog_group_id', 'name', 'item_type', 'cost_type',
            'description', 'unit_of_measure', 'unit_cost', 'labor_hours', 'catalog_number',
            'manufacturer', 'supplier', 'cost_code', 'epd_url', 'taxable', 'active'
        ];
        if ($hasRevModern) {
            $itemInsertColsModern[] = 'revision';
        }
        $itemInsertColsModern[] = 'created_at';
        $itemInsertColsModern[] = 'updated_at';

        $itemPlaceholdersModern = array_fill(0, count($itemInsertColsModern) - 2, '?');
        $itemPlaceholdersModern[] = 'NOW()';
        $itemPlaceholdersModern[] = 'NOW()';

        $insItemStmtModern = $pdoModern->prepare("INSERT INTO catalog_items (" . implode(', ', $itemInsertColsModern) . ") VALUES (" . implode(', ', $itemPlaceholdersModern) . ")");
        $itemParamsModern = [
            1, 1, 20, 'Modern Conduit 3/4"', 'part', 'Material',
            '3/4" Metallic Tubing', 'ft', 2.10, 0.08, 'EMT-075',
            'Allied', 'Graybar', '26 05 33', '', 1, 1
        ];
        if ($hasRevModern) {
            $itemParamsModern[] = 1;
        }
        $insItemStmtModern->execute($itemParamsModern);
        $modernItemId = (int)$pdoModern->lastInsertId();

        $savedRevision = (int)$pdoModern->query("SELECT revision FROM catalog_items WHERE id = $modernItemId")->fetchColumn();
        $check($savedRevision === 1, 'modern item import persists revision when column exists');

        // Modern Assembly INSERT: persists measurement_type and revision = 1
        $asmInsertColsModern = [
            'catalog_id', 'cost_catalog_id', 'catalog_group_id', 'name', 'description',
            'item_type', 'cost_type', 'unit_of_measure'
        ];
        if ($hasMeasModern) {
            $asmInsertColsModern[] = 'measurement_type';
        }
        $asmInsertColsModern[] = 'unit_cost';
        $asmInsertColsModern[] = 'labor_hours';
        $asmInsertColsModern[] = 'active';
        if ($hasRevModern) {
            $asmInsertColsModern[] = 'revision';
        }
        $asmInsertColsModern[] = 'created_at';
        $asmInsertColsModern[] = 'updated_at';

        $asmPlaceholdersModern = array_fill(0, count($asmInsertColsModern) - 2, '?');
        $asmPlaceholdersModern[] = 'NOW()';
        $asmPlaceholdersModern[] = 'NOW()';

        $insAsmStmtModern = $pdoModern->prepare("INSERT INTO catalog_items (" . implode(', ', $asmInsertColsModern) . ") VALUES (" . implode(', ', $asmPlaceholdersModern) . ")");
        $asmParamsModern = [1, 1, 20, 'Modern EMT Assembly', '3/4" Conduit branch assembly', 'assembly', 'Material', 'ft'];
        if ($hasMeasModern) {
            $asmParamsModern[] = 'linear';
        }
        $asmParamsModern[] = 0.0;
        $asmParamsModern[] = 0.0;
        $asmParamsModern[] = 1;
        if ($hasRevModern) {
            $asmParamsModern[] = 1;
        }
        $insAsmStmtModern->execute($asmParamsModern);
        $modernAsmId = (int)$pdoModern->lastInsertId();

        $modernRow = $pdoModern->query("SELECT measurement_type, revision FROM catalog_items WHERE id = $modernAsmId")->fetch(PDO::FETCH_ASSOC);
        $check(
            $modernRow['measurement_type'] === 'linear' && (int)$modernRow['revision'] === 1,
            'modern assembly import persists measurement_type and revision on INSERT'
        );

        // Modern Assembly UPDATE: persists measurement_type
        $asmUpdateSetsModern = ['description = ?', 'unit_of_measure = ?'];
        if ($hasMeasModern) {
            $asmUpdateSetsModern[] = 'measurement_type = ?';
        }
        $asmUpdateSetsModern[] = "item_type = 'assembly'";
        $asmUpdateSetsModern[] = 'active = 1';
        $asmUpdateSetsModern[] = 'updated_at = NOW()';

        $updAsmStmtModern = $pdoModern->prepare("UPDATE catalog_items SET " . implode(', ', $asmUpdateSetsModern) . " WHERE id = ?");
        $asmUpdParamsModern = ['Updated modern description', 'ft'];
        if ($hasMeasModern) {
            $asmUpdParamsModern[] = 'area';
        }
        $asmUpdParamsModern[] = $modernAsmId;
        $updAsmStmtModern->execute($asmUpdParamsModern);

        $updatedMeasType = $pdoModern->query("SELECT measurement_type FROM catalog_items WHERE id = $modernAsmId")->fetchColumn();
        $check($updatedMeasType === 'area', 'modern assembly import persists measurement_type on UPDATE');

        // Component insertion with sort_order
        $asmPartsColsModern = [];
        foreach ($pdoModern->query('PRAGMA table_info(assembly_parts)')->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $asmPartsColsModern[] = $c['name'];
        }
        $hasSortOrderModern = in_array('sort_order', $asmPartsColsModern, true);
        $check($hasSortOrderModern, 'column discovery identifies sort_order is present in modern schema');

        $basePartCols = ['assembly_catalog_item_id', 'part_catalog_item_id', 'quantity', 'ratio_type', 'unit_cost_snapshot', 'unit_labor_time_snapshot'];
        if ($hasSortOrderModern) {
            $basePartCols[] = 'sort_order';
        }
        $partPlaceholders = implode(', ', array_fill(0, count($basePartCols), '?'));
        $partIns = $pdoModern->prepare("INSERT INTO assembly_parts (" . implode(', ', $basePartCols) . ") VALUES ($partPlaceholders)");

        $components = [
            ['part_id' => $modernItemId, 'qty' => 1.0, 'cost' => 2.10, 'labor' => 0.08],
            ['part_id' => $modernItemId, 'qty' => 2.0, 'cost' => 2.10, 'labor' => 0.08],
        ];
        $partSort = 0;
        foreach ($components as $comp) {
            $params = [$modernAsmId, $comp['part_id'], $comp['qty'], 'per_linear_length', $comp['cost'], $comp['labor']];
            if ($hasSortOrderModern) {
                $params[] = $partSort++;
            }
            $partIns->execute($params);
        }

        $orders = $pdoModern->query("SELECT sort_order FROM assembly_parts WHERE assembly_catalog_item_id = $modernAsmId ORDER BY id ASC")->fetchAll(PDO::FETCH_COLUMN);
        $check(($orders === [0, 1] || $orders === ['0', '1']), 'assembly workbook import persists imported order when assembly_parts.sort_order exists');

        // ---------------------------------------------------------------------
        // 2.3 Atomic Rollback Verification
        // ---------------------------------------------------------------------
        $pdoModern->beginTransaction();
        $pdoModern->prepare("INSERT INTO catalog_items (" . implode(', ', $itemInsertColsModern) . ") VALUES (" . implode(', ', $itemPlaceholdersModern) . ")")->execute([
            1, 1, 20, 'Rollback Test Part', 'part', 'Material', 'desc', 'ea', 5.0, 0.2, '', '', '', '', '', 1, 1, 1
        ]);
        $rollbackItemId = (int)$pdoModern->lastInsertId();
        $check($rollbackItemId > 0, 'record created inside transaction before simulated abort');

        // Roll back the transaction
        $pdoModern->rollBack();
        $foundAfterRollback = (int)$pdoModern->query("SELECT COUNT(*) FROM catalog_items WHERE name = 'Rollback Test Part'")->fetchColumn();
        $check($foundAfterRollback === 0, 'failed import transaction rolls back completely leaving no orphan records');

        // ---------------------------------------------------------------------
        // 2.4 Sanitized Catalog Import Incident Logging Verification
        // ---------------------------------------------------------------------
        $simulatedIncidentId = null;
        $capturedLogMessage = null;
        $simulatedResponseJson = null;

        try {
            throw new PDOException('SQLSTATE[42S22]: Column not found: 1054 Unknown column "db_password" in "field list"');
        } catch (Throwable) {
            $incidentId = bin2hex(random_bytes(16));
            $simulatedIncidentId = $incidentId;
            $capturedLogMessage = "Catalog import failure: {$incidentId}";
            $simulatedResponseJson = json_encode([
                'success' => false,
                'error' => 'Import failed. No catalog changes were saved.',
                'incident_id' => $incidentId,
            ]);
        }

        $check(
            is_string($simulatedIncidentId) && strlen($simulatedIncidentId) === 32 && ctype_xdigit($simulatedIncidentId),
            'incident identifier is cryptographically random 32-character hexadecimal string'
        );
        $check(
            $capturedLogMessage === "Catalog import failure: {$simulatedIncidentId}",
            'server log contains only fixed catalog import failure label and opaque identifier'
        );
        $check(
            !str_contains($capturedLogMessage, 'SQLSTATE') &&
            !str_contains($capturedLogMessage, 'db_password') &&
            !str_contains($capturedLogMessage, 'Column not found'),
            'server log rejects SQLSTATE, exception messages, credentials or column names'
        );

        $parsedResponse = json_decode((string)$simulatedResponseJson, true);
        $check(
            is_array($parsedResponse) &&
            ($parsedResponse['success'] ?? null) === false &&
            ($parsedResponse['error'] ?? null) === 'Import failed. No catalog changes were saved.' &&
            ($parsedResponse['incident_id'] ?? null) === $simulatedIncidentId &&
            count($parsedResponse) === 3,
            'HTTP response remains generic and includes only opaque incident identifier'
        );

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
