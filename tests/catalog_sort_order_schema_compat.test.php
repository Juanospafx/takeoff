<?php
declare(strict_types=1);

/**
 * Regression Test: Catalog and Group sort_order Schema Compatibility
 *
 * Acceptance Criteria:
 * - Catalog creation omits sort_order when catalogs lacks that column.
 * - Catalog creation persists sort_order when the column exists.
 * - Catalog and category create, update and copy operations filter optional values against trusted table metadata.
 * - Catalog and category ordering queries fall back deterministically to id when sort_order is absent.
 * - Reorder commands do not issue writes to sort_order when the target table lacks the column and return an explicit capability-safe result.
 * - Regression tests cover legacy and modern schema contracts without accessing production data.
 */

$root = dirname(__DIR__);
$adminCode = (string) file_get_contents($root . '/core/services/CatalogAdminService.php');
$failures = [];

$check = static function (bool $condition, string $message) use (&$failures): void {
    echo ($condition ? '[PASS] ' : '[FAIL] ') . $message . PHP_EOL;
    if (!$condition) {
        $failures[] = $message;
    }
};

/**
 * Test PDO subclass providing in-memory SQLite compatibility for MySQL-specific queries
 * used in CatalogAdminService and catalog_revision_audit helpers.
 */
class CompatTestPDO extends PDO
{
    public function __construct()
    {
        parent::__construct('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $this->sqliteCreateFunction('DATABASE', static fn() => 'main');
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        $rewritten = $this->rewriteQuery($query);
        return parent::query($rewritten, ...$fetchModeArgs);
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $rewritten = $this->rewriteQuery($query);
        return parent::prepare($rewritten, $options);
    }

    private function rewriteQuery(string $sql): string
    {
        if (preg_match('/SHOW\s+COLUMNS\s+FROM\s+[`\'"]?(\w+)[`\'"]?/i', $sql, $m)) {
            return "SELECT name FROM pragma_table_info('{$m[1]}')";
        }
        $sql = preg_replace('/\s+FOR\s+UPDATE\b/i', '', $sql);
        $sql = preg_replace('/INSERT\s+IGNORE\s+INTO\b/i', 'INSERT OR IGNORE INTO', $sql);
        if (preg_match('/information_schema\.tables/i', $sql)) {
            if (preg_match('/table_name\s*=\s*[\'"](\w+)[\'"]/i', $sql, $m)) {
                return "SELECT 1 FROM sqlite_master WHERE type='table' AND name='{$m[1]}' LIMIT 1";
            }
            return "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1";
        }
        return $sql;
    }
}

function setupTestDatabase(bool $withSortOrder): CompatTestPDO
{
    $pdo = new CompatTestPDO();

    $sortCol = $withSortOrder ? 'sort_order INTEGER NOT NULL DEFAULT 0,' : '';

    $pdo->exec("CREATE TABLE catalogs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        trade TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        locked INTEGER NOT NULL DEFAULT 0,
        enabled_for_projects INTEGER NOT NULL DEFAULT 1,
        $sortCol
        metadata_json TEXT,
        deleted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0
    );");

    $pdo->exec("CREATE TABLE cost_catalogs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        currency_code TEXT NOT NULL DEFAULT 'USD',
        active INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0
    );");

    $pdo->exec("CREATE TABLE catalog_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_id INTEGER NOT NULL,
        parent_group_id INTEGER,
        name TEXT NOT NULL,
        description TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        enabled_for_projects INTEGER NOT NULL DEFAULT 1,
        $sortCol
        metadata_json TEXT,
        deleted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0
    );");

    $pdo->exec("CREATE TABLE catalog_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_id INTEGER NOT NULL,
        catalog_group_id INTEGER,
        cost_catalog_id INTEGER,
        sku TEXT,
        name TEXT NOT NULL,
        description TEXT,
        item_type TEXT NOT NULL DEFAULT 'part',
        cost_type TEXT,
        unit_of_measure TEXT NOT NULL DEFAULT 'ea',
        measurement_type TEXT NOT NULL DEFAULT 'count',
        unit_cost REAL NOT NULL DEFAULT 0,
        material_cost REAL NOT NULL DEFAULT 0,
        labor_cost REAL NOT NULL DEFAULT 0,
        equipment_cost REAL NOT NULL DEFAULT 0,
        subcontractor_cost REAL NOT NULL DEFAULT 0,
        labor_hours REAL NOT NULL DEFAULT 0,
        labor_rate REAL NOT NULL DEFAULT 0,
        markup_percent REAL NOT NULL DEFAULT 0,
        waste_factor_percent REAL NOT NULL DEFAULT 0,
        taxable INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0
    );");

    $pdo->exec("CREATE TABLE assembly_parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assembly_catalog_item_id INTEGER NOT NULL,
        part_catalog_item_id INTEGER NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        ratio_type TEXT NOT NULL DEFAULT 'per_unit',
        spacing_value REAL,
        waste_factor_percent REAL NOT NULL DEFAULT 0,
        $sortCol
        unit_cost_snapshot REAL NOT NULL DEFAULT 0,
        unit_labor_time_snapshot REAL NOT NULL DEFAULT 0,
        notes TEXT,
        deleted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0
    );");

    $pdo->exec("CREATE TABLE catalog_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT,
        actor_user_id INTEGER,
        action TEXT,
        entity_type TEXT,
        entity_id INTEGER,
        catalog_id INTEGER,
        revision_before INTEGER,
        revision_after INTEGER,
        before_json TEXT,
        after_json TEXT,
        changes_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );");

    return $pdo;
}

function runLegacyBehavioralTests(callable $check): void
{
    require_once dirname(__DIR__) . '/core/services/CatalogAdminService.php';
    $pdo = setupTestDatabase(false);
    $service = new CatalogAdminService($pdo);

    // 1. Create catalog on schema lacking sort_order
    $catRes = $service->execute('catalog.create', [
        'name' => 'Legacy Catalog 1',
        'description' => 'A catalog without sort_order column',
        'sort_order' => 10,
    ]);
    $catId = (int)$catRes['id'];
    $check($catId > 0, 'legacy schema: catalog.create succeeds and returns generated ID');
    $check(!array_key_exists('sort_order', $catRes['entity']), 'legacy schema: catalog entity omits sort_order');

    // 2. Create second catalog for reorder tests
    $catRes2 = $service->execute('catalog.create', [
        'name' => 'Legacy Catalog 2',
        'sort_order' => 20,
    ]);
    $catId2 = (int)$catRes2['id'];

    // 3. Create group on schema lacking sort_order
    $grpRes = $service->execute('category.create', [
        'catalog_id' => $catId,
        'name' => 'Legacy Category 1',
        'sort_order' => 5,
    ]);
    $grpId = (int)$grpRes['id'];
    $check($grpId > 0, 'legacy schema: category.create succeeds and returns generated ID');
    $check(!array_key_exists('sort_order', $grpRes['entity']), 'legacy schema: category entity omits sort_order');

    $grpRes2 = $service->execute('category.create', [
        'catalog_id' => $catId,
        'name' => 'Legacy Category 2',
        'sort_order' => 6,
    ]);
    $grpId2 = (int)$grpRes2['id'];

    // 4. Update catalog and category with optional sort_order in payload
    $upCat = $service->execute('catalog.update', [
        'id' => $catId,
        'name' => 'Legacy Catalog Renamed',
        'sort_order' => 99,
    ]);
    $check($upCat['entity']['name'] === 'Legacy Catalog Renamed', 'legacy schema: catalog.update succeeds when payload has sort_order');

    $upGrp = $service->execute('category.update', [
        'id' => $grpId,
        'name' => 'Legacy Category Renamed',
        'sort_order' => 99,
    ]);
    $check($upGrp['entity']['name'] === 'Legacy Category Renamed', 'legacy schema: category.update succeeds when payload has sort_order');

    // 5. Copy catalog and category
    $copyCat = $service->execute('catalog.copy', ['id' => $catId]);
    $check((int)$copyCat['id'] > 0, 'legacy schema: catalog.copy succeeds');

    $copyGrp = $service->execute('category.copy', ['id' => $grpId]);
    $check((int)$copyGrp['id'] > 0, 'legacy schema: category.copy succeeds');

    // 6. Reorder catalogs: ordering query must fall back to id and return explicit capability-safe result
    $allCats = array_map('intval', $pdo->query('SELECT id FROM catalogs WHERE deleted_at IS NULL ORDER BY id')->fetchAll(PDO::FETCH_COLUMN));
    $reversedCats = array_reverse($allCats);
    $reorderCatRes = $service->execute('catalog.reorder', ['ordered_ids' => $reversedCats]);
    $check($reorderCatRes['ordered_ids'] === $reversedCats, 'legacy schema: catalog.reorder accepts valid catalog list');
    $check(isset($reorderCatRes['supported']) && $reorderCatRes['supported'] === false, 'legacy schema: catalog.reorder returns supported=false');

    // 7. Reorder categories: ordering query must fall back to id and return explicit capability-safe result
    $allGrps = array_map('intval', $pdo->query("SELECT id FROM catalog_groups WHERE catalog_id=$catId AND parent_group_id IS NULL AND deleted_at IS NULL ORDER BY id")->fetchAll(PDO::FETCH_COLUMN));
    $reversedGrps = array_reverse($allGrps);
    $reorderGrpRes = $service->execute('category.reorder', ['catalog_id' => $catId, 'ordered_ids' => $reversedGrps]);
    $check($reorderGrpRes['ordered_ids'] === $reversedGrps, 'legacy schema: category.reorder accepts valid category list');
    $check(isset($reorderGrpRes['supported']) && $reorderGrpRes['supported'] === false, 'legacy schema: category.reorder returns supported=false');
}

function runModernBehavioralTests(callable $check): void
{
    require_once dirname(__DIR__) . '/core/services/CatalogAdminService.php';
    $pdo = setupTestDatabase(true);
    $service = new CatalogAdminService($pdo);

    // 1. Create catalog persisting sort_order
    $catRes = $service->execute('catalog.create', [
        'name' => 'Modern Catalog 1',
        'sort_order' => 15,
    ]);
    $catId = (int)$catRes['id'];
    $check($catId > 0, 'modern schema: catalog.create succeeds');
    $check(isset($catRes['entity']['sort_order']) && (int)$catRes['entity']['sort_order'] === 15, 'modern schema: catalog.create persists sort_order');

    $catRes2 = $service->execute('catalog.create', [
        'name' => 'Modern Catalog 2',
        'sort_order' => 25,
    ]);
    $catId2 = (int)$catRes2['id'];

    // 2. Create category persisting sort_order
    $grpRes = $service->execute('category.create', [
        'catalog_id' => $catId,
        'name' => 'Modern Category 1',
        'sort_order' => 7,
    ]);
    $grpId = (int)$grpRes['id'];
    $check($grpId > 0, 'modern schema: category.create succeeds');
    $check(isset($grpRes['entity']['sort_order']) && (int)$grpRes['entity']['sort_order'] === 7, 'modern schema: category.create persists sort_order');

    $grpRes2 = $service->execute('category.create', [
        'catalog_id' => $catId,
        'name' => 'Modern Category 2',
        'sort_order' => 8,
    ]);
    $grpId2 = (int)$grpRes2['id'];

    // 3. Update catalog and category persisting sort_order
    $upCat = $service->execute('catalog.update', [
        'id' => $catId,
        'sort_order' => 42,
    ]);
    $check((int)$upCat['entity']['sort_order'] === 42, 'modern schema: catalog.update updates sort_order');

    $upGrp = $service->execute('category.update', [
        'id' => $grpId,
        'sort_order' => 33,
    ]);
    $check((int)$upGrp['entity']['sort_order'] === 33, 'modern schema: category.update updates sort_order');

    // 4. Reorder catalogs writes sort_order and returns supported=true
    $reorderCat = $service->execute('catalog.reorder', ['ordered_ids' => [$catId2, $catId]]);
    $check($reorderCat['ordered_ids'] === [$catId2, $catId], 'modern schema: catalog.reorder returns ordered_ids');
    $check(isset($reorderCat['supported']) && $reorderCat['supported'] === true, 'modern schema: catalog.reorder returns supported=true');

    $storedCat2Order = (int)$pdo->query("SELECT sort_order FROM catalogs WHERE id=$catId2")->fetchColumn();
    $storedCat1Order = (int)$pdo->query("SELECT sort_order FROM catalogs WHERE id=$catId")->fetchColumn();
    $check($storedCat2Order === 0 && $storedCat1Order === 1, 'modern schema: catalog.reorder persists updated sort_orders to database');

    // 5. Reorder categories writes sort_order and returns supported=true
    $reorderGrp = $service->execute('category.reorder', ['catalog_id' => $catId, 'ordered_ids' => [$grpId2, $grpId]]);
    $check($reorderGrp['ordered_ids'] === [$grpId2, $grpId], 'modern schema: category.reorder returns ordered_ids');
    $check(isset($reorderGrp['supported']) && $reorderGrp['supported'] === true, 'modern schema: category.reorder returns supported=true');

    $storedGrp2Order = (int)$pdo->query("SELECT sort_order FROM catalog_groups WHERE id=$grpId2")->fetchColumn();
    $storedGrp1Order = (int)$pdo->query("SELECT sort_order FROM catalog_groups WHERE id=$grpId")->fetchColumn();
    $check($storedGrp2Order === 0 && $storedGrp1Order === 1, 'modern schema: category.reorder persists updated sort_orders to database');
}

// -----------------------------------------------------------------------------
// Dispatch CLI Subtests if requested for process-level isolation
// -----------------------------------------------------------------------------
if (isset($argv[1]) && $argv[1] === '--legacy') {
    runLegacyBehavioralTests($check);
    exit($failures !== [] ? 1 : 0);
}
if (isset($argv[1]) && $argv[1] === '--modern') {
    runModernBehavioralTests($check);
    exit($failures !== [] ? 1 : 0);
}

// -----------------------------------------------------------------------------
// 1. Static / Structural Code Analysis of CatalogAdminService.php
// -----------------------------------------------------------------------------

// 1.1 Verify createCatalog inspects columns and does not unconditionally insert sort_order
$hardcodedCatalogSortOrder = (bool) preg_match(
    '/public\s+function\s+createCatalog[\s\S]*?\$this->insert\s*\(\s*[\'"]catalogs[\'"]\s*,\s*\[[^\;]*?[\'"]sort_order[\'"]\s*=>/i',
    $adminCode
);
$check(!$hardcodedCatalogSortOrder, 'CatalogAdminService createCatalog does NOT hardcode sort_order into catalogs insert');

// 1.2 Verify createCategory inspects columns and does not unconditionally insert sort_order
$hardcodedCategorySortOrder = (bool) preg_match(
    '/public\s+function\s+createCategory[\s\S]*?\$this->insert\s*\(\s*[\'"]catalog_groups[\'"]\s*,\s*\[[^\;]*?[\'"]sort_order[\'"]\s*=>/i',
    $adminCode
);
$check(!$hardcodedCategorySortOrder, 'CatalogAdminService createCategory does NOT hardcode sort_order into catalog_groups insert');

// 1.3 Verify updateCatalog and updateCategory filter values against table metadata
$updateCatalogFilters = (bool) preg_match(
    '/public\s+function\s+updateCatalog[\s\S]*?array_intersect_key\s*\(\s*\$values\s*,\s*\$columns\s*\)/i',
    $adminCode
) || (bool) preg_match(
    '/public\s+function\s+updateCatalog[\s\S]*?array_intersect_key/i',
    $adminCode
);
$check($updateCatalogFilters, 'CatalogAdminService updateCatalog filters values against trusted table metadata');

$updateCategoryFilters = (bool) preg_match(
    '/public\s+function\s+updateCategory[\s\S]*?array_intersect_key\s*\(\s*\$values\s*,\s*\$columns\s*\)/i',
    $adminCode
) || (bool) preg_match(
    '/public\s+function\s+updateCategory[\s\S]*?array_intersect_key/i',
    $adminCode
);
$check($updateCategoryFilters, 'CatalogAdminService updateCategory filters values against trusted table metadata');

// 1.4 Verify ordering queries fall back to id when sort_order is absent
$catalogReorderFallback = (bool) preg_match(
    '/reorderCatalogs[\s\S]*?ORDER BY id/i',
    $adminCode
);
$check($catalogReorderFallback, 'CatalogAdminService reorderCatalogs falls back to ORDER BY id when sort_order is absent');

$categoryReorderFallback = (bool) preg_match(
    '/reorderCategories[\s\S]*?ORDER BY id/i',
    $adminCode
);
$check($categoryReorderFallback, 'CatalogAdminService reorderCategories falls back to ORDER BY id when sort_order is absent');

// 1.5 Verify reorder returns capability result
$reorderHasSupported = (bool) preg_match(
    '/reorderCatalogs[\s\S]*?[\'"]supported[\'"]\s*=>/i',
    $adminCode
) && (bool) preg_match(
    '/reorderCategories[\s\S]*?[\'"]supported[\'"]\s*=>/i',
    $adminCode
);
$check($reorderHasSupported, 'CatalogAdminService reorder methods return explicit capability status');

// -----------------------------------------------------------------------------
// 2. Behavioral Verification in Isolated Sub-Processes
// -----------------------------------------------------------------------------

$hasSqlite = extension_loaded('pdo_sqlite') && in_array('sqlite', PDO::getAvailableDrivers(), true);

if (!$hasSqlite) {
    echo '[SKIP] SQLite PDO driver unavailable; skipping behavioral tests.' . PHP_EOL;
} else {
    // Run legacy subtest
    $legacyOut = [];
    $legacyCode = 0;
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --legacy', $legacyOut, $legacyCode);
    foreach ($legacyOut as $line) {
        echo '  ' . $line . PHP_EOL;
    }
    $check($legacyCode === 0, 'legacy schema contracts behavioral suite passed');

    // Run modern subtest
    $modernOut = [];
    $modernCode = 0;
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --modern', $modernOut, $modernCode);
    foreach ($modernOut as $line) {
        echo '  ' . $line . PHP_EOL;
    }
    $check($modernCode === 0, 'modern schema contracts behavioral suite passed');
}

if ($failures !== []) {
    echo PHP_EOL . 'Test failed with ' . count($failures) . ' failure(s):' . PHP_EOL;
    foreach ($failures as $f) {
        echo '  - ' . $f . PHP_EOL;
    }
    exit(1);
}

echo PHP_EOL . 'All catalog sort_order schema compatibility tests passed.' . PHP_EOL;
exit(0);
