<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/db/connection.php';

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
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
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_catalog_items_catalog (catalog_id),
        KEY idx_catalog_items_group (catalog_group_id)
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
    cc_add_column($pdo, 'catalog_items', 'active', "ALTER TABLE catalog_items ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1");
    cc_add_column($pdo, 'catalog_items', 'deleted_at', "ALTER TABLE catalog_items ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL");

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
                [$electricalId, $emtGroup, 'EMT Conduit 1/2 inch', 'Electrical metallic tubing', 'ft', 0.85, 0.0100],
                [$electricalId, $emtGroup, 'EMT Connector 1/2 inch', 'Compression connector', 'ea', 1.15, 0.0200],
                [$electricalId, $lightingGroup, 'Lighting Fixture A Assembly', 'Fixture package placeholder', 'ea', 125.00, 0.7500],
            ];
            $stmt = $pdo->prepare("INSERT INTO catalog_items (catalog_id, catalog_group_id, name, description, unit_of_measure, unit_cost, labor_hours, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)");
            foreach ($items as $item) $stmt->execute($item);
        }
    }
}

function cc_payload(PDO $pdo, string $view = 'all', int $catalogId = 0, int $groupId = 0): array
{
    $catalogs = $pdo->query(
        "SELECT c.*,
            (SELECT COUNT(*) FROM catalog_items ci WHERE ci.catalog_id = c.id AND ci.deleted_at IS NULL) AS item_count
         FROM catalogs c
         WHERE c.deleted_at IS NULL
         ORDER BY c.name"
    )->fetchAll(PDO::FETCH_ASSOC);

    $groups = $pdo->query(
        "SELECT g.*,
            c.name AS catalog_name,
            (SELECT COUNT(*) FROM catalog_items ci WHERE ci.catalog_group_id = g.id AND ci.deleted_at IS NULL) AS item_count
         FROM catalog_groups g
         JOIN catalogs c ON c.id = g.catalog_id
         WHERE g.deleted_at IS NULL AND c.deleted_at IS NULL
         ORDER BY c.name, g.parent_group_id IS NOT NULL, g.sort_order, g.name"
    )->fetchAll(PDO::FETCH_ASSOC);

    $where = ["ci.deleted_at IS NULL"];
    $params = [];
    if ($view === 'catalog' && $catalogId > 0) {
        $where[] = 'ci.catalog_id = ?';
        $params[] = $catalogId;
    }
    if ($view === 'group' && $groupId > 0) {
        $where[] = 'ci.catalog_group_id = ?';
        $params[] = $groupId;
    }
    $order = $view === 'recent' ? 'ci.updated_at DESC' : 'c.name, g.name, ci.name';
    $stmt = $pdo->prepare(
        "SELECT ci.*, c.name AS catalog_name, g.name AS group_name
         FROM catalog_items ci
         JOIN catalogs c ON c.id = ci.catalog_id
         LEFT JOIN catalog_groups g ON g.id = ci.catalog_group_id
         WHERE " . implode(' AND ', $where) . "
         ORDER BY $order
         LIMIT 250"
    );
    $stmt->execute($params);
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    return compact('catalogs', 'groups', 'items');
}

try {
    cc_ensure_schema($pdo);

    switch ($action) {
        case 'list':
            cc_json(['status' => 'success', 'data' => cc_payload($pdo, (string)($_GET['view'] ?? 'all'), cc_int($_GET['catalog_id'] ?? 0), cc_int($_GET['group_id'] ?? 0))]);

        case 'save_catalog':
            $id = cc_int($input['id'] ?? 0);
            $name = cc_str($input['name'] ?? null);
            if (!$name) cc_json(['status' => 'error', 'msg' => 'Catalog name is required'], 422);
            $data = [
                $name,
                cc_str($input['description'] ?? null),
                cc_str($input['trade'] ?? null),
                !empty($input['active']) ? 1 : 0,
                !empty($input['locked']) ? 1 : 0,
                !empty($input['enabled_for_projects']) ? 1 : 0,
            ];
            if ($id > 0) {
                $stmt = $pdo->prepare("UPDATE catalogs SET name = ?, description = ?, trade = ?, active = ?, locked = ?, enabled_for_projects = ? WHERE id = ?");
                $stmt->execute(array_merge($data, [$id]));
            } else {
                $stmt = $pdo->prepare("INSERT INTO catalogs (name, description, trade, active, locked, enabled_for_projects) VALUES (?, ?, ?, ?, ?, ?)");
                $stmt->execute($data);
                $id = (int)$pdo->lastInsertId();
                $pdo->prepare("INSERT INTO cost_catalogs (catalog_id, name, currency_code, active) VALUES (?, ?, 'USD', 1)")->execute([$id, $name . ' Cost Book']);
            }
            cc_json(['status' => 'success', 'id' => $id, 'data' => cc_payload($pdo, 'catalog', $id)]);

        case 'copy_catalog':
            $id = cc_int($input['id'] ?? 0);
            $stmt = $pdo->prepare("SELECT * FROM catalogs WHERE id = ? AND deleted_at IS NULL");
            $stmt->execute([$id]);
            $catalog = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$catalog) cc_json(['status' => 'error', 'msg' => 'Catalog not found'], 404);
            $pdo->prepare("INSERT INTO catalogs (name, description, trade, active, locked, enabled_for_projects, metadata_json) VALUES (?, ?, ?, ?, 0, ?, ?)")
                ->execute([$catalog['name'] . ' Copy', $catalog['description'], $catalog['trade'], $catalog['active'], $catalog['enabled_for_projects'] ?? 1, $catalog['metadata_json']]);
            $newId = (int)$pdo->lastInsertId();
            $groupMap = [];
            $groups = $pdo->prepare("SELECT * FROM catalog_groups WHERE catalog_id = ? AND deleted_at IS NULL ORDER BY parent_group_id IS NOT NULL, id");
            $groups->execute([$id]);
            foreach ($groups->fetchAll(PDO::FETCH_ASSOC) as $group) {
                $parent = $group['parent_group_id'] ? ($groupMap[(int)$group['parent_group_id']] ?? null) : null;
                $pdo->prepare("INSERT INTO catalog_groups (catalog_id, parent_group_id, name, description, sort_order, active, enabled_for_projects, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                    ->execute([$newId, $parent, $group['name'], $group['description'], $group['sort_order'], $group['active'] ?? 1, $group['enabled_for_projects'] ?? 1, $group['metadata_json']]);
                $groupMap[(int)$group['id']] = (int)$pdo->lastInsertId();
            }
            cc_json(['status' => 'success', 'id' => $newId, 'data' => cc_payload($pdo, 'catalog', $newId)]);

        case 'delete_catalog':
            $id = cc_int($input['id'] ?? 0);
            $pdo->prepare("UPDATE catalogs SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND locked = 0")->execute([$id]);
            cc_json(['status' => 'success', 'data' => cc_payload($pdo)]);

        case 'toggle_catalog':
            $id = cc_int($input['id'] ?? 0);
            $field = ($input['field'] ?? '') === 'enabled_for_projects' ? 'enabled_for_projects' : 'active';
            $pdo->prepare("UPDATE catalogs SET $field = IF($field = 1, 0, 1) WHERE id = ? AND locked = 0")->execute([$id]);
            cc_json(['status' => 'success', 'data' => cc_payload($pdo, 'catalog', $id)]);

        case 'save_group':
            $id = cc_int($input['id'] ?? 0);
            $catalogId = cc_int($input['catalog_id'] ?? 0);
            $name = cc_str($input['name'] ?? null);
            if (!$catalogId || !$name) cc_json(['status' => 'error', 'msg' => 'Catalog and group name are required'], 422);
            $parentId = cc_int($input['parent_group_id'] ?? 0) ?: null;
            $data = [$catalogId, $parentId, $name, cc_str($input['description'] ?? null), cc_int($input['sort_order'] ?? 0), !empty($input['active']) ? 1 : 0, !empty($input['enabled_for_projects']) ? 1 : 0];
            if ($id > 0) {
                $stmt = $pdo->prepare("UPDATE catalog_groups SET catalog_id = ?, parent_group_id = ?, name = ?, description = ?, sort_order = ?, active = ?, enabled_for_projects = ? WHERE id = ?");
                $stmt->execute(array_merge($data, [$id]));
            } else {
                $stmt = $pdo->prepare("INSERT INTO catalog_groups (catalog_id, parent_group_id, name, description, sort_order, active, enabled_for_projects) VALUES (?, ?, ?, ?, ?, ?, ?)");
                $stmt->execute($data);
                $id = (int)$pdo->lastInsertId();
            }
            cc_json(['status' => 'success', 'id' => $id, 'data' => cc_payload($pdo, 'group', 0, $id)]);

        case 'copy_group':
            $id = cc_int($input['id'] ?? 0);
            $stmt = $pdo->prepare("SELECT * FROM catalog_groups WHERE id = ? AND deleted_at IS NULL");
            $stmt->execute([$id]);
            $group = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$group) cc_json(['status' => 'error', 'msg' => 'Group not found'], 404);
            $pdo->prepare("INSERT INTO catalog_groups (catalog_id, parent_group_id, name, description, sort_order, active, enabled_for_projects, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                ->execute([$group['catalog_id'], $group['parent_group_id'], $group['name'] . ' Copy', $group['description'], $group['sort_order'], $group['active'] ?? 1, $group['enabled_for_projects'] ?? 1, $group['metadata_json']]);
            cc_json(['status' => 'success', 'id' => (int)$pdo->lastInsertId(), 'data' => cc_payload($pdo, 'catalog', (int)$group['catalog_id'])]);

        case 'delete_group':
            $id = cc_int($input['id'] ?? 0);
            $pdo->prepare("UPDATE catalog_groups SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")->execute([$id]);
            cc_json(['status' => 'success', 'data' => cc_payload($pdo)]);

        case 'toggle_group':
            $id = cc_int($input['id'] ?? 0);
            $field = ($input['field'] ?? '') === 'enabled_for_projects' ? 'enabled_for_projects' : 'active';
            $pdo->prepare("UPDATE catalog_groups SET $field = IF($field = 1, 0, 1) WHERE id = ?")->execute([$id]);
            cc_json(['status' => 'success', 'data' => cc_payload($pdo, 'group', 0, $id)]);

        default:
            cc_json(['status' => 'error', 'msg' => 'Invalid action'], 404);
    }
} catch (Throwable $e) {
    cc_json(['status' => 'error', 'msg' => $e->getMessage()], 500);
}
