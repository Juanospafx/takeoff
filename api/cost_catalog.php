<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/services/CatalogAdminService.php';

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
$input['request_id'] = catalog_ra_request_id($input);
$action = $_GET['action'] ?? $_POST['action'] ?? $input['action'] ?? 'list';

function cc_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function cc_int($value): int
{
    return is_numeric($value) ? (int)$value : 0;
}

function cc_str($value): ?string
{
    $value = trim((string)($value ?? ''));
    return $value === '' ? null : $value;
}

function cc_columns(PDO $pdo, string $table): array
{
    return $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
}

function cc_add_column(PDO $pdo, string $table, string $column, string $sql): void
{
    if (!in_array($column, cc_columns($pdo, $table), true)) {
        $pdo->exec($sql);
    }
}

function cc_item_type_for_db(PDO $pdo, $value): string
{
    $value = strtolower(trim((string)($value ?? 'material')));
    $allowed = ['material', 'labor', 'equipment', 'assembly', 'subcontractor', 'travel', 'custom', 'part'];
    if (!in_array($value, $allowed, true)) $value = 'material';

    $stmt = $pdo->query("SHOW COLUMNS FROM catalog_items LIKE 'item_type'");
    $column = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
    $type = strtolower((string)($column['Type'] ?? ''));
    if ($value === 'material' && strpos($type, "'material'") === false && strpos($type, 'enum') !== false) {
        return 'part';
    }
    return $value;
}

function cc_hex_or_null($value): ?string
{
    $value = trim((string)($value ?? ''));
    if ($value === '') return null;
    return preg_match('/^#[0-9a-fA-F]{6}$/', $value) ? $value : null;
}

function cc_recalculate_assembly(PDO $pdo, int $assemblyItemId, array $input = [], string $action = 'assembly.recalculated'): void
{
    if ($assemblyItemId <= 0) return;
    $stmt = $pdo->prepare(
        "SELECT
            COALESCE(SUM(quantity * unit_cost_snapshot), 0) AS unit_cost,
            COALESCE(SUM(quantity * unit_labor_time_snapshot), 0) AS labor_hours
         FROM assembly_parts
         WHERE assembly_catalog_item_id = ? AND deleted_at IS NULL"
    );
    $stmt->execute([$assemblyItemId]);
    $totals = $stmt->fetch(PDO::FETCH_ASSOC) ?: ['unit_cost' => 0, 'labor_hours' => 0];
    catalog_ra_update($pdo, 'catalog_items', 'item', $assemblyItemId, [
        'item_type' => cc_item_type_for_db($pdo, 'assembly'),
        'unit_cost' => (float)$totals['unit_cost'],
        'labor_hours' => (float)$totals['labor_hours']
    ], $action, $input, null, true);
}

function cc_ensure_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS catalogs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        trade VARCHAR(100) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_catalogs_active_deleted (active, deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS cost_catalogs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        catalog_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        currency_code CHAR(3) NOT NULL DEFAULT 'USD',
        effective_from DATE NULL,
        effective_to DATE NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_cost_catalogs_catalog (catalog_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS catalog_groups (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        catalog_id BIGINT UNSIGNED NOT NULL,
        parent_group_id BIGINT UNSIGNED NULL,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_catalog_groups_catalog (catalog_id),
        KEY idx_catalog_groups_parent (parent_group_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS catalog_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        catalog_id BIGINT UNSIGNED NOT NULL,
        cost_catalog_id BIGINT UNSIGNED NULL,
        catalog_group_id BIGINT UNSIGNED NULL,
        sku VARCHAR(100) NULL,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        item_type ENUM('part','assembly','labor','equipment','subcontractor','travel','custom') NOT NULL DEFAULT 'part',
        cost_type VARCHAR(100) NULL,
        unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea',
        unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        labor_hours DECIMAL(18,4) NOT NULL DEFAULT 0,
        color VARCHAR(50) NULL,
        symbol VARCHAR(50) NULL,
        taxable TINYINT(1) NOT NULL DEFAULT 1,
        manufacturer VARCHAR(191) NULL,
        supplier VARCHAR(191) NULL,
        catalog_number VARCHAR(100) NULL,
        sub_job_code VARCHAR(100) NULL,
        sub_job_name VARCHAR(191) NULL,
        epd_url VARCHAR(1024) NULL,
        attachment_url VARCHAR(1024) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_catalog_items_catalog (catalog_id),
        KEY idx_catalog_items_group (catalog_group_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS assembly_parts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        assembly_catalog_item_id BIGINT UNSIGNED NOT NULL,
        part_catalog_item_id BIGINT UNSIGNED NOT NULL,
        quantity DECIMAL(18,6) NOT NULL DEFAULT 1,
        unit_cost_snapshot DECIMAL(18,4) NOT NULL DEFAULT 0,
        unit_labor_time_snapshot DECIMAL(18,4) NOT NULL DEFAULT 0,
        ratio_type ENUM('fixed','per_unit','per_linear_length','per_area','per_endpoint','spacing_based') NOT NULL DEFAULT 'per_unit',
        spacing_value DECIMAL(18,6) NULL,
        waste_factor_percent DECIMAL(9,4) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_assembly_parts_assembly (assembly_catalog_item_id),
        KEY idx_assembly_parts_part (part_catalog_item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    cc_add_column($pdo, 'catalogs', 'trade', "ALTER TABLE catalogs ADD COLUMN trade VARCHAR(100) NULL");
    cc_add_column($pdo, 'catalogs', 'active', "ALTER TABLE catalogs ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1");
    cc_add_column($pdo, 'catalogs', 'locked', "ALTER TABLE catalogs ADD COLUMN locked TINYINT(1) NOT NULL DEFAULT 0");
    cc_add_column($pdo, 'catalogs', 'enabled_for_projects', "ALTER TABLE catalogs ADD COLUMN enabled_for_projects TINYINT(1) NOT NULL DEFAULT 1");
    cc_add_column($pdo, 'catalogs', 'metadata_json', "ALTER TABLE catalogs ADD COLUMN metadata_json JSON NULL");
    cc_add_column($pdo, 'catalogs', 'deleted_at', "ALTER TABLE catalogs ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL");

    cc_add_column($pdo, 'catalog_groups', 'parent_group_id', "ALTER TABLE catalog_groups ADD COLUMN parent_group_id BIGINT UNSIGNED NULL");
    cc_add_column($pdo, 'catalog_groups', 'sort_order', "ALTER TABLE catalog_groups ADD COLUMN sort_order INT NOT NULL DEFAULT 0");
    cc_add_column($pdo, 'catalog_groups', 'active', "ALTER TABLE catalog_groups ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1");
    cc_add_column($pdo, 'catalog_groups', 'enabled_for_projects', "ALTER TABLE catalog_groups ADD COLUMN enabled_for_projects TINYINT(1) NOT NULL DEFAULT 1");
    cc_add_column($pdo, 'catalog_groups', 'metadata_json', "ALTER TABLE catalog_groups ADD COLUMN metadata_json JSON NULL");
    cc_add_column($pdo, 'catalog_groups', 'deleted_at', "ALTER TABLE catalog_groups ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL");

    cc_add_column($pdo, 'catalog_items', 'cost_catalog_id', "ALTER TABLE catalog_items ADD COLUMN cost_catalog_id BIGINT UNSIGNED NULL");
    cc_add_column($pdo, 'catalog_items', 'catalog_group_id', "ALTER TABLE catalog_items ADD COLUMN catalog_group_id BIGINT UNSIGNED NULL");
    cc_add_column($pdo, 'catalog_items', 'sku', "ALTER TABLE catalog_items ADD COLUMN sku VARCHAR(100) NULL");
    cc_add_column($pdo, 'catalog_items', 'item_type', "ALTER TABLE catalog_items ADD COLUMN item_type VARCHAR(50) NOT NULL DEFAULT 'part'");
    cc_add_column($pdo, 'catalog_items', 'unit_of_measure', "ALTER TABLE catalog_items ADD COLUMN unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea'");
    cc_add_column($pdo, 'catalog_items', 'unit_cost', "ALTER TABLE catalog_items ADD COLUMN unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0");
    cc_add_column($pdo, 'catalog_items', 'labor_hours', "ALTER TABLE catalog_items ADD COLUMN labor_hours DECIMAL(18,4) NOT NULL DEFAULT 0");
    cc_add_column($pdo, 'catalog_items', 'cost_code', "ALTER TABLE catalog_items ADD COLUMN cost_code VARCHAR(100) NULL");
    cc_add_column($pdo, 'catalog_items', 'color', "ALTER TABLE catalog_items ADD COLUMN color VARCHAR(50) NULL");
    cc_add_column($pdo, 'catalog_items', 'symbol', "ALTER TABLE catalog_items ADD COLUMN symbol VARCHAR(50) NULL");
    cc_add_column($pdo, 'catalog_items', 'taxable', "ALTER TABLE catalog_items ADD COLUMN taxable TINYINT(1) NOT NULL DEFAULT 1");
    cc_add_column($pdo, 'catalog_items', 'manufacturer', "ALTER TABLE catalog_items ADD COLUMN manufacturer VARCHAR(191) NULL");
    cc_add_column($pdo, 'catalog_items', 'supplier', "ALTER TABLE catalog_items ADD COLUMN supplier VARCHAR(191) NULL");
    cc_add_column($pdo, 'catalog_items', 'catalog_number', "ALTER TABLE catalog_items ADD COLUMN catalog_number VARCHAR(100) NULL");
    cc_add_column($pdo, 'catalog_items', 'sub_job_code', "ALTER TABLE catalog_items ADD COLUMN sub_job_code VARCHAR(100) NULL");
    cc_add_column($pdo, 'catalog_items', 'sub_job_name', "ALTER TABLE catalog_items ADD COLUMN sub_job_name VARCHAR(191) NULL");
    cc_add_column($pdo, 'catalog_items', 'epd_url', "ALTER TABLE catalog_items ADD COLUMN epd_url VARCHAR(1024) NULL");
    cc_add_column($pdo, 'catalog_items', 'attachment_url', "ALTER TABLE catalog_items ADD COLUMN attachment_url VARCHAR(1024) NULL");
    cc_add_column($pdo, 'catalog_items', 'active', "ALTER TABLE catalog_items ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1");
    cc_add_column($pdo, 'catalog_items', 'deleted_at', "ALTER TABLE catalog_items ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL");

    try {
        $pdo->exec("ALTER TABLE catalog_items MODIFY item_type ENUM('part','material','assembly','labor','equipment','subcontractor','travel','custom') NOT NULL DEFAULT 'material'");
    } catch (Throwable $ignored) {
        // Existing installations may keep the older ENUM; saves map material to part when needed.
    }

    cc_add_column($pdo, 'assembly_parts', 'unit_cost_snapshot', "ALTER TABLE assembly_parts ADD COLUMN unit_cost_snapshot DECIMAL(18,4) NOT NULL DEFAULT 0");
    cc_add_column($pdo, 'assembly_parts', 'unit_labor_time_snapshot', "ALTER TABLE assembly_parts ADD COLUMN unit_labor_time_snapshot DECIMAL(18,4) NOT NULL DEFAULT 0");
    cc_add_column($pdo, 'assembly_parts', 'deleted_at', "ALTER TABLE assembly_parts ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL");

    $count = (int)$pdo->query("SELECT COUNT(*) FROM catalogs WHERE deleted_at IS NULL")->fetchColumn();
    if ($count === 0) {
        $catalogs = ['Electrical', 'Plumbing', 'Fire Sprinkler', 'Low Voltage', 'Residential Electrical'];
        $stmt = $pdo->prepare("INSERT INTO catalogs (name, description, trade, active, locked, enabled_for_projects) VALUES (?, ?, ?, 1, 0, 1)");
        foreach ($catalogs as $name) {
            $stmt->execute([$name, $name . ' cost catalog', $name]);
            $catalogId = (int)$pdo->lastInsertId();
            $pdo->prepare("INSERT INTO cost_catalogs (catalog_id, name, description, currency_code, active) VALUES (?, ?, ?, 'USD', 1)")
                ->execute([$catalogId, $name . ' Cost Book', 'Default cost book']);
        }
    }

    $electricalId = (int)$pdo->query("SELECT id FROM catalogs WHERE name = 'Electrical' AND deleted_at IS NULL LIMIT 1")->fetchColumn();
    if ($electricalId > 0) {
        $stmtCount = $pdo->prepare("SELECT COUNT(*) FROM catalog_groups WHERE catalog_id = ? AND deleted_at IS NULL");
        $stmtCount->execute([$electricalId]);
        if ((int)$stmtCount->fetchColumn() === 0) {
            $groups = ['EMT', 'EMT Assemblies', 'EMT Extras', 'PVC', 'RMC', 'Feeders Assemblies', 'Fire Alarm', 'Gear and Panelboards', 'General Controls', 'Lighting', 'Controls', 'Rough-in'];
            $stmt = $pdo->prepare("INSERT INTO catalog_groups (catalog_id, name, sort_order, active, enabled_for_projects) VALUES (?, ?, ?, 1, 1)");
            foreach ($groups as $index => $name) $stmt->execute([$electricalId, $name, ($index + 1) * 10]);
        }

        $itemCountStmt = $pdo->prepare("SELECT COUNT(*) FROM catalog_items WHERE catalog_id = ? AND deleted_at IS NULL");
        $itemCountStmt->execute([$electricalId]);
        if ((int)$itemCountStmt->fetchColumn() === 0) {
            $emtGroup = (int)$pdo->query("SELECT id FROM catalog_groups WHERE catalog_id = $electricalId AND name = 'EMT' LIMIT 1")->fetchColumn();
            $lightingGroup = (int)$pdo->query("SELECT id FROM catalog_groups WHERE catalog_id = $electricalId AND name = 'Lighting' LIMIT 1")->fetchColumn();
            $items = [
                [$electricalId, $emtGroup, 'EMT Conduit 1/2 inch', 'Electrical metallic tubing', 'ft', 0.85, 0.0100, cc_item_type_for_db($pdo, 'material'), '#2563eb', 'line'],
                [$electricalId, $emtGroup, 'EMT Connector 1/2 inch', 'Compression connector', 'ea', 1.15, 0.0200, cc_item_type_for_db($pdo, 'material'), '#16a34a', 'circle'],
                [$electricalId, $lightingGroup, 'Lighting Fixture A Assembly', 'Fixture package placeholder', 'ea', 125.00, 0.7500, cc_item_type_for_db($pdo, 'assembly'), '#f59e0b', 'square'],
            ];
            $stmt = $pdo->prepare("INSERT INTO catalog_items (catalog_id, catalog_group_id, name, description, unit_of_measure, unit_cost, labor_hours, item_type, color, symbol, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)");
            foreach ($items as $item) $stmt->execute($item);
        }
    }
}

function cc_item_input(PDO $pdo, array $input): array
{
    $catalogId = cc_int($input['catalog_id'] ?? 0);
    $groupId = cc_int($input['catalog_group_id'] ?? 0);
    $name = cc_str($input['name'] ?? null);
    $uom = cc_str($input['unit_of_measure'] ?? null);
    $unitCost = is_numeric($input['unit_cost'] ?? null) ? (float)$input['unit_cost'] : -1;
    $laborHours = is_numeric($input['labor_hours'] ?? null) ? (float)$input['labor_hours'] : -1;
    $color = cc_hex_or_null($input['color'] ?? null);

    if (!$catalogId) cc_json(['status' => 'error', 'msg' => 'Catalog is required'], 422);
    if (!$name) cc_json(['status' => 'error', 'msg' => 'Name is required'], 422);
    if (!$uom) cc_json(['status' => 'error', 'msg' => 'Unit of Measure is required'], 422);
    if ($unitCost < 0) cc_json(['status' => 'error', 'msg' => 'Unit Cost must be a number >= 0'], 422);
    if ($laborHours < 0) cc_json(['status' => 'error', 'msg' => 'Unit Labor Time must be a number >= 0'], 422);
    if (cc_str($input['color'] ?? null) && !$color) cc_json(['status' => 'error', 'msg' => 'Color must be a valid hex value'], 422);

    return [
        'catalog_id' => $catalogId,
        'catalog_group_id' => $groupId ?: null,
        'name' => $name,
        'description' => cc_str($input['description'] ?? null),
        'unit_of_measure' => $uom,
        'unit_cost' => $unitCost,
        'labor_hours' => $laborHours,
        'taxable' => !empty($input['taxable']) ? 1 : 0,
        'color' => $color,
        'symbol' => cc_str($input['symbol'] ?? null),
        'manufacturer' => cc_str($input['manufacturer'] ?? null),
        'supplier' => cc_str($input['supplier'] ?? null),
        'catalog_number' => cc_str($input['catalog_number'] ?? null),
        'masterformat' => cc_str($input['masterformat'] ?? null),
        'uniformat' => cc_str($input['uniformat'] ?? null),
        'sub_job_code' => cc_str($input['sub_job_code'] ?? null),
        'sub_job_name' => cc_str($input['sub_job_name'] ?? null),
        'cost_code' => cc_str($input['cost_code'] ?? null),
        'epd_url' => cc_str($input['epd_url'] ?? null),
        'attachment_url' => cc_str($input['attachment_url'] ?? null),
        'item_type' => cc_item_type_for_db($pdo, $input['item_type'] ?? 'material'),
    ];
}

function cc_availability_mode($value): string
{
    $mode = strtolower(trim((string)$value));
    return in_array($mode, ['admin', 'active', 'project'], true) ? $mode : 'admin';
}

function cc_group_availability_cte(string $mode): string
{
    if ($mode === 'admin') return '';
    $enabled = $mode === 'project' ? ' AND g.enabled_for_projects=1' : '';
    $childEnabled = $mode === 'project' ? ' AND child.enabled_for_projects=1' : '';
    return "WITH RECURSIVE group_availability AS (
        SELECT g.id,g.parent_group_id,
          CASE WHEN g.deleted_at IS NULL AND g.active=1$enabled THEN 1 ELSE 0 END AS available
        FROM catalog_groups g WHERE g.parent_group_id IS NULL
        UNION ALL
        SELECT child.id,child.parent_group_id,
          CASE WHEN parent.available=1 AND child.deleted_at IS NULL AND child.active=1$childEnabled THEN 1 ELSE 0 END
        FROM catalog_groups child
        JOIN group_availability parent ON parent.id=child.parent_group_id
    ) ";
}

function cc_payload(PDO $pdo, string $view = 'all', int $catalogId = 0, int $groupId = 0,
    string $availability = 'admin', bool $includeDeleted = false): array
{
    $availability = cc_availability_mode($availability);
    $includeDeleted = $availability === 'admin' && $includeDeleted;
    $cte = cc_group_availability_cte($availability);
    $catalogWhere = [];
    if (!$includeDeleted) $catalogWhere[] = 'c.deleted_at IS NULL';
    if ($availability !== 'admin') $catalogWhere[] = 'c.active=1';
    if ($availability === 'project') $catalogWhere[] = 'c.enabled_for_projects=1';
    $catalogSql = 'SELECT c.*,0 AS item_count FROM catalogs c'
        . ($catalogWhere ? ' WHERE '.implode(' AND ',$catalogWhere) : '')
        . ' ORDER BY c.name';
    $catalogs = $pdo->query($catalogSql)->fetchAll(PDO::FETCH_ASSOC);

    if ($availability === 'admin') {
        $groupWhere = [];
        if (!$includeDeleted) $groupWhere[] = 'g.deleted_at IS NULL AND c.deleted_at IS NULL';
        $groupSql = "SELECT g.*,c.name AS catalog_name,0 AS item_count
            FROM catalog_groups g JOIN catalogs c ON c.id=g.catalog_id"
            . ($groupWhere ? ' WHERE '.implode(' AND ',$groupWhere) : '')
            . ' ORDER BY c.name,g.parent_group_id IS NOT NULL,g.sort_order,g.name';
    } else {
        $groupCatalog = $availability === 'project'
            ? 'c.deleted_at IS NULL AND c.active=1 AND c.enabled_for_projects=1'
            : 'c.deleted_at IS NULL AND c.active=1';
        $groupSql = $cte . "SELECT g.*,c.name AS catalog_name,0 AS item_count
            FROM catalog_groups g JOIN group_availability ga ON ga.id=g.id AND ga.available=1
            JOIN catalogs c ON c.id=g.catalog_id AND $groupCatalog
            ORDER BY c.name,g.parent_group_id IS NOT NULL,g.sort_order,g.name";
    }
    $groups = $pdo->query($groupSql)->fetchAll(PDO::FETCH_ASSOC);

    $joins = " JOIN catalogs c ON c.id=ci.catalog_id
        LEFT JOIN catalog_groups g ON g.id=ci.catalog_group_id
        LEFT JOIN cost_catalogs cc ON cc.id=ci.cost_catalog_id";
    $where = [];
    if (!$includeDeleted) $where[] = 'ci.deleted_at IS NULL';
    if ($availability !== 'admin') {
        $joins .= ' LEFT JOIN group_availability ga ON ga.id=ci.catalog_group_id';
        $where[] = 'ci.active=1';
        $where[] = 'c.deleted_at IS NULL AND c.active=1';
        $where[] = '(ci.catalog_group_id IS NULL OR ga.available=1)';
        $where[] = '(ci.cost_catalog_id IS NULL OR (cc.deleted_at IS NULL AND cc.active=1))';
    }
    if ($availability === 'project') {
        $where[] = 'c.enabled_for_projects=1';
        $where[] = "(ci.cost_catalog_id IS NULL OR (
            (cc.effective_from IS NULL OR cc.effective_from<=CURRENT_DATE)
            AND (cc.effective_to IS NULL OR cc.effective_to>=CURRENT_DATE)
        ))";
    }
    $itemSql = $cte . "SELECT ci.*,c.name AS catalog_name,g.name AS group_name
        FROM catalog_items ci $joins"
        . ($where ? ' WHERE '.implode(' AND ',$where) : '')
        . ' ORDER BY c.name,g.name,ci.name LIMIT 1000';
    $allItems = $pdo->query($itemSql)->fetchAll(PDO::FETCH_ASSOC);

    $pdfAttachments = [];
    $pdfAttachmentCapable = catalog_ra_table_exists($pdo, 'catalog_item_attachments');
    if ($pdfAttachmentCapable) {
        foreach ($pdo->query('SELECT catalog_item_id,original_name,size_bytes,updated_at FROM catalog_item_attachments')->fetchAll(PDO::FETCH_ASSOC) as $attachment) {
            $pdfAttachments[(string)$attachment['catalog_item_id']] = [
                'present'=>true,
                'originalName'=>$attachment['original_name'],
                'sizeBytes'=>(int)$attachment['size_bytes'],
                'updatedAt'=>$attachment['updated_at'],
                'viewUrl'=>'../api/catalog_item_attachment.php?action=view&item_id='.(int)$attachment['catalog_item_id']
            ];
        }
    }
    foreach ($allItems as &$itemRow) $itemRow['pdf_attachment']=$pdfAttachments[(string)$itemRow['id']]??null;
    unset($itemRow);

    $partWhere = $includeDeleted ? '1=1' : 'ap.deleted_at IS NULL';
    $assemblyPartOrder = in_array('sort_order', cc_columns($pdo, 'assembly_parts'), true) ? 'ap.sort_order,ap.id' : 'ap.id';
    $assemblyParts = $pdo->query(
        "SELECT ap.*,child.name AS child_item_name,child.unit_of_measure AS child_unit_of_measure,
            child.unit_cost AS child_unit_cost,child.labor_hours AS child_labor_hours,
            assembly.name AS assembly_item_name
         FROM assembly_parts ap
         JOIN catalog_items child ON child.id=ap.part_catalog_item_id
         JOIN catalog_items assembly ON assembly.id=ap.assembly_catalog_item_id
         WHERE $partWhere ORDER BY assembly.name,$assemblyPartOrder"
    )->fetchAll(PDO::FETCH_ASSOC);

    $blockedAssemblies = [];
    if ($availability === 'project') {
        $availableIds = array_fill_keys(array_map(static fn($row)=>(string)$row['id'],$allItems),true);
        $partsByAssembly = [];
        foreach ($assemblyParts as $part) $partsByAssembly[(string)$part['assembly_catalog_item_id']][] = (string)$part['part_catalog_item_id'];
        $blocked = [];
        do {
            $changed = false;
            foreach ($partsByAssembly as $assemblyId => $childIds) {
                if (isset($blocked[$assemblyId]) || !isset($availableIds[$assemblyId])) continue;
                $unavailable = array_values(array_unique(array_filter($childIds,
                    static fn($childId)=>!isset($availableIds[$childId]) || isset($blocked[$childId]))));
                if ($unavailable) { $blocked[$assemblyId]=$unavailable; $changed=true; }
            }
        } while ($changed);
        foreach ($blocked as $id=>$unavailableIds) $blockedAssemblies[] = [
            'id'=>$id,'availability'=>'blocked','unavailableComponentIds'=>$unavailableIds
        ];
        if ($blocked) {
            $allItems = array_values(array_filter($allItems,static fn($row)=>!isset($blocked[(string)$row['id']])));
            $availableIds = array_fill_keys(array_map(static fn($row)=>(string)$row['id'],$allItems),true);
            $assemblyParts = array_values(array_filter($assemblyParts,static fn($part)=>
                isset($availableIds[(string)$part['assembly_catalog_item_id']])
                && isset($availableIds[(string)$part['part_catalog_item_id']])));
        }
    }

    $catalogCounts=[];$groupCounts=[];
    foreach ($allItems as $row) {
        $catalogCounts[(string)$row['catalog_id']] = ($catalogCounts[(string)$row['catalog_id']]??0)+1;
        if (!empty($row['catalog_group_id'])) $groupCounts[(string)$row['catalog_group_id']] = ($groupCounts[(string)$row['catalog_group_id']]??0)+1;
    }
    foreach ($catalogs as &$row) $row['item_count']=$catalogCounts[(string)$row['id']]??0; unset($row);
    foreach ($groups as &$row) $row['item_count']=$groupCounts[(string)$row['id']]??0; unset($row);

    $items = array_values(array_filter($allItems, static function($row) use($view,$catalogId,$groupId) {
        if ($view==='catalog' && $catalogId>0) return (int)$row['catalog_id']===$catalogId;
        if ($view==='group' && $groupId>0) return (int)$row['catalog_group_id']===$groupId;
        return true;
    }));
    if ($view==='recent') usort($items,static fn($a,$b)=>strcmp((string)$b['updated_at'],(string)$a['updated_at']));
    $items=array_slice($items,0,250);

    $revisioning = isset(catalog_ra_columns($pdo,'catalog_items')['revision']);
    $capabilities = ['availabilityFiltering'=>true,'revisioning'=>$revisioning,'itemPdfAttachments'=>$pdfAttachmentCapable,
        'availabilityModes'=>['admin','active','project'],'projectAssemblies'=>'exclude_blocked'];
    return compact('catalogs','groups','items','allItems','assemblyParts','blockedAssemblies','capabilities','availability');
}
try {
    cc_ensure_schema($pdo);

    // Backwards-compatible adapter: the legacy UI keeps its action names and
    // response payload, while every mutation is executed by the same domain
    // service used by api/catalog_admin.php.
    $legacyCommands = [
        'copy_catalog'=>'catalog.copy','delete_catalog'=>'catalog.archive','toggle_catalog'=>'catalog.toggle',
        'copy_group'=>'category.copy','delete_group'=>'category.archive','toggle_group'=>'category.toggle',
        'duplicate_item'=>'item.duplicate','delete_item'=>'item.archive','move_item'=>'item.move',
        'convert_item_assembly'=>'item.convert_assembly','add_assembly_part'=>'assembly_component.add',
        'update_assembly_part'=>'assembly_component.update',
        'reorder_assembly_parts'=>'assembly_component.reorder',
        'delete_assembly_part'=>'assembly_component.remove'
    ];
    if ($action === 'save_catalog') $legacyCommands[$action] = cc_int($input['id'] ?? 0) ? 'catalog.update' : 'catalog.create';
    if ($action === 'save_group') $legacyCommands[$action] = cc_int($input['id'] ?? 0) ? 'category.update' : 'category.create';
    if ($action === 'save_item') $legacyCommands[$action] = cc_int($input['id'] ?? 0) ? 'item.update' : 'item.create';
    if (isset($legacyCommands[$action])) {
        try {
            $result = (new CatalogAdminService($pdo))->execute($legacyCommands[$action], $input);
            $resultId = (int)($result['id'] ?? $input['id'] ?? 0);
            $view = (string)($input['view'] ?? 'all');
            $catalogId = cc_int($input['catalog_id'] ?? ($result['entity']['catalog_id'] ?? 0));
            $groupId = cc_int($input['group_id'] ?? $input['catalog_group_id'] ?? ($result['entity']['catalog_group_id'] ?? 0));
            cc_json(['status'=>'success','id'=>$resultId,'revision'=>$result['entity']['revision'] ?? null,
                'data'=>cc_payload($pdo, $view, $catalogId, $groupId)]);
        } catch (CatalogRevisionConflict $e) {
            cc_json(['status'=>'error','code'=>'revision_conflict','msg'=>$e->getMessage(),'current'=>$e->current],409);
        } catch (CatalogAdminException $e) {
            cc_json(['status'=>'error','code'=>strtolower($e->errorCode),'msg'=>$e->getMessage(),'details'=>$e->details],$e->httpStatus);
        }
    }

    switch ($action) {
        case 'list':
            $availability = cc_availability_mode($_GET['availability'] ?? 'admin');
            $includeDeleted = $availability === 'admin' && filter_var($_GET['include_deleted'] ?? false, FILTER_VALIDATE_BOOLEAN);
            cc_json(['status' => 'success', 'data' => cc_payload($pdo, (string)($_GET['view'] ?? 'all'),
                cc_int($_GET['catalog_id'] ?? 0), cc_int($_GET['group_id'] ?? 0), $availability, $includeDeleted)]);

        default:
            cc_json(['status' => 'error', 'msg' => 'Invalid action'], 404);
    }
} catch (CatalogRevisionConflict $e) {
    cc_json(['status' => 'error', 'code' => 'revision_conflict',
        'msg' => $e->getMessage(), 'current' => $e->current], 409);
} catch (Throwable $e) {
    cc_json(['status' => 'error', 'msg' => $e->getMessage()], 500);
}
