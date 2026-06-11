<?php
require_once __DIR__ . '/../core/db/connection.php';

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = array();
$action = isset($_GET['action']) ? $_GET['action'] : (isset($_POST['action']) ? $_POST['action'] : (isset($input['action']) ? $input['action'] : 'list'));

function tl_json($payload, $status = 200)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function tl_int($value)
{
    return is_numeric($value) ? (int)$value : 0;
}

function tl_float($value)
{
    return is_numeric($value) ? (float)$value : 0.0;
}

function tl_str($value)
{
    $value = trim((string)($value === null ? '' : $value));
    return $value === '' ? null : $value;
}

function tl_columns($pdo, $table)
{
    try {
        return $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
    } catch (Throwable $e) {
        return array();
    }
}

function tl_add_column($pdo, $table, $column, $sql)
{
    $columns = tl_columns($pdo, $table);
    if (!in_array($column, $columns, true)) {
        $pdo->exec($sql);
    }
}

function tl_table_exists($pdo, $table)
{
    $stmt = $pdo->prepare("SHOW TABLES LIKE ?");
    $stmt->execute(array($table));
    return (bool)$stmt->fetchColumn();
}

function tl_item_type_for_db($pdo, $value)
{
    $value = strtolower(trim((string)$value));
    if ($value === '') $value = 'material';
    try {
        $stmt = $pdo->query("SHOW COLUMNS FROM catalog_items LIKE 'item_type'");
        $column = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
        $type = strtolower((string)(isset($column['Type']) ? $column['Type'] : ''));
        if ($value === 'material' && strpos($type, "'material'") === false && strpos($type, 'enum') !== false) {
            return 'part';
        }
    } catch (Throwable $ignored) {
    }
    return $value;
}

function tl_ensure_schema($pdo)
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS projects (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS catalogs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS catalog_groups (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        catalog_id BIGINT UNSIGNED NOT NULL,
        parent_group_id BIGINT UNSIGNED NULL,
        name VARCHAR(191) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_catalog_groups_catalog (catalog_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS catalog_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        catalog_id BIGINT UNSIGNED NOT NULL,
        catalog_group_id BIGINT UNSIGNED NULL,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        item_type VARCHAR(50) NOT NULL DEFAULT 'material',
        unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea',
        unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        labor_hours DECIMAL(18,4) NOT NULL DEFAULT 0,
        color VARCHAR(50) NULL,
        symbol VARCHAR(50) NULL,
        manufacturer VARCHAR(191) NULL,
        catalog_number VARCHAR(100) NULL,
        cost_code VARCHAR(100) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_catalog_items_catalog (catalog_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    tl_add_column($pdo, 'catalog_items', 'catalog_group_id', "ALTER TABLE catalog_items ADD COLUMN catalog_group_id BIGINT UNSIGNED NULL");
    tl_add_column($pdo, 'catalog_items', 'item_type', "ALTER TABLE catalog_items ADD COLUMN item_type VARCHAR(50) NOT NULL DEFAULT 'material'");
    tl_add_column($pdo, 'catalog_items', 'unit_of_measure', "ALTER TABLE catalog_items ADD COLUMN unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea'");
    tl_add_column($pdo, 'catalog_items', 'unit_cost', "ALTER TABLE catalog_items ADD COLUMN unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0");
    tl_add_column($pdo, 'catalog_items', 'labor_hours', "ALTER TABLE catalog_items ADD COLUMN labor_hours DECIMAL(18,4) NOT NULL DEFAULT 0");
    tl_add_column($pdo, 'catalog_items', 'color', "ALTER TABLE catalog_items ADD COLUMN color VARCHAR(50) NULL");
    tl_add_column($pdo, 'catalog_items', 'symbol', "ALTER TABLE catalog_items ADD COLUMN symbol VARCHAR(50) NULL");
    tl_add_column($pdo, 'catalog_items', 'manufacturer', "ALTER TABLE catalog_items ADD COLUMN manufacturer VARCHAR(191) NULL");
    tl_add_column($pdo, 'catalog_items', 'catalog_number', "ALTER TABLE catalog_items ADD COLUMN catalog_number VARCHAR(100) NULL");
    tl_add_column($pdo, 'catalog_items', 'cost_code', "ALTER TABLE catalog_items ADD COLUMN cost_code VARCHAR(100) NULL");
    tl_add_column($pdo, 'catalog_items', 'deleted_at', "ALTER TABLE catalog_items ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL");
    try {
        $pdo->exec("ALTER TABLE catalog_items MODIFY item_type ENUM('part','material','assembly','labor','equipment','subcontractor','travel','custom') NOT NULL DEFAULT 'material'");
    } catch (Throwable $ignored) {
    }

    $pdo->exec("CREATE TABLE IF NOT EXISTS takeoffs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        project_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(191) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_takeoffs_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS takeoff_layers (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        takeoff_id BIGINT UNSIGNED NULL,
        project_id BIGINT UNSIGNED NULL,
        group_name VARCHAR(191) NULL,
        name VARCHAR(191) NOT NULL,
        takeoff_type VARCHAR(50) NOT NULL DEFAULT 'count',
        unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea',
        catalog_item_id BIGINT UNSIGNED NULL,
        color VARCHAR(50) NOT NULL DEFAULT '#2563eb',
        symbol VARCHAR(50) NOT NULL DEFAULT 'circle',
        symbol_size VARCHAR(50) NULL,
        quantity DECIMAL(18,6) NOT NULL DEFAULT 0,
        visible TINYINT(1) NOT NULL DEFAULT 1,
        locked TINYINT(1) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_takeoff_layers_takeoff (takeoff_id),
        KEY idx_takeoff_layers_project (project_id),
        KEY idx_takeoff_layers_catalog_item (catalog_item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    tl_add_column($pdo, 'takeoff_layers', 'takeoff_id', "ALTER TABLE takeoff_layers ADD COLUMN takeoff_id BIGINT UNSIGNED NULL");
    tl_add_column($pdo, 'takeoff_layers', 'drawing_id', "ALTER TABLE takeoff_layers ADD COLUMN drawing_id BIGINT UNSIGNED NULL");
    tl_add_column($pdo, 'takeoff_layers', 'page_number', "ALTER TABLE takeoff_layers ADD COLUMN page_number INT UNSIGNED NOT NULL DEFAULT 1");
    tl_add_column($pdo, 'takeoff_layers', 'project_id', "ALTER TABLE takeoff_layers ADD COLUMN project_id BIGINT UNSIGNED NULL");
    tl_add_column($pdo, 'takeoff_layers', 'group_name', "ALTER TABLE takeoff_layers ADD COLUMN group_name VARCHAR(191) NULL");
    tl_add_column($pdo, 'takeoff_layers', 'type', "ALTER TABLE takeoff_layers ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'mixed'");
    tl_add_column($pdo, 'takeoff_layers', 'assembly_id', "ALTER TABLE takeoff_layers ADD COLUMN assembly_id BIGINT UNSIGNED NULL");
    tl_add_column($pdo, 'takeoff_layers', 'tag', "ALTER TABLE takeoff_layers ADD COLUMN tag VARCHAR(100) NULL");
    tl_add_column($pdo, 'takeoff_layers', 'takeoff_type', "ALTER TABLE takeoff_layers ADD COLUMN takeoff_type VARCHAR(50) NOT NULL DEFAULT 'count'");
    tl_add_column($pdo, 'takeoff_layers', 'unit_of_measure', "ALTER TABLE takeoff_layers ADD COLUMN unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea'");
    tl_add_column($pdo, 'takeoff_layers', 'symbol_size', "ALTER TABLE takeoff_layers ADD COLUMN symbol_size VARCHAR(50) NULL");
    tl_add_column($pdo, 'takeoff_layers', 'quantity', "ALTER TABLE takeoff_layers ADD COLUMN quantity DECIMAL(18,6) NOT NULL DEFAULT 0");
    tl_add_column($pdo, 'takeoff_layers', 'sort_order', "ALTER TABLE takeoff_layers ADD COLUMN sort_order INT NOT NULL DEFAULT 0");
    tl_add_column($pdo, 'takeoff_layers', 'metadata_json', "ALTER TABLE takeoff_layers ADD COLUMN metadata_json JSON NULL");
    tl_add_column($pdo, 'takeoff_layers', 'deleted_at', "ALTER TABLE takeoff_layers ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL");
    try {
        $pdo->exec("ALTER TABLE takeoff_layers MODIFY type VARCHAR(50) NOT NULL DEFAULT 'mixed'");
    } catch (Throwable $ignored) {
    }

    $pdo->exec("CREATE TABLE IF NOT EXISTS estimates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        project_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(191) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        currency_code CHAR(3) NOT NULL DEFAULT 'USD',
        total_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_estimates_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS estimate_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        estimate_id BIGINT UNSIGNED NOT NULL,
        takeoff_layer_id BIGINT UNSIGNED NULL,
        catalog_item_id BIGINT UNSIGNED NULL,
        source_type VARCHAR(50) NOT NULL DEFAULT 'manual',
        is_manual TINYINT(1) NOT NULL DEFAULT 1,
        is_quantity_locked_from_takeoff TINYINT(1) NOT NULL DEFAULT 0,
        group_name VARCHAR(191) NULL,
        budget_code VARCHAR(100) NULL,
        cost_type VARCHAR(100) NULL,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        quantity DECIMAL(18,6) NOT NULL DEFAULT 0,
        unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea',
        unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        unit_labor_time DECIMAL(18,4) NOT NULL DEFAULT 0,
        labor_hours DECIMAL(18,4) NOT NULL DEFAULT 0,
        waste_percentage DECIMAL(9,4) NOT NULL DEFAULT 0,
        margin_percentage DECIMAL(9,4) NOT NULL DEFAULT 0,
        taxable TINYINT(1) NOT NULL DEFAULT 1,
        subtotal_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        labor_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        total_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_estimate_items_estimate (estimate_id),
        KEY idx_estimate_items_takeoff_layer (takeoff_layer_id),
        KEY idx_estimate_items_catalog_item (catalog_item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $estimateColumns = array(
        'takeoff_layer_id' => "ALTER TABLE estimate_items ADD COLUMN takeoff_layer_id BIGINT UNSIGNED NULL",
        'source_type' => "ALTER TABLE estimate_items ADD COLUMN source_type VARCHAR(50) NOT NULL DEFAULT 'manual'",
        'is_manual' => "ALTER TABLE estimate_items ADD COLUMN is_manual TINYINT(1) NOT NULL DEFAULT 1",
        'is_quantity_locked_from_takeoff' => "ALTER TABLE estimate_items ADD COLUMN is_quantity_locked_from_takeoff TINYINT(1) NOT NULL DEFAULT 0",
        'group_name' => "ALTER TABLE estimate_items ADD COLUMN group_name VARCHAR(191) NULL",
        'budget_code' => "ALTER TABLE estimate_items ADD COLUMN budget_code VARCHAR(100) NULL",
        'cost_type' => "ALTER TABLE estimate_items ADD COLUMN cost_type VARCHAR(100) NULL",
        'unit_labor_time' => "ALTER TABLE estimate_items ADD COLUMN unit_labor_time DECIMAL(18,4) NOT NULL DEFAULT 0",
        'waste_percentage' => "ALTER TABLE estimate_items ADD COLUMN waste_percentage DECIMAL(9,4) NOT NULL DEFAULT 0",
        'margin_percentage' => "ALTER TABLE estimate_items ADD COLUMN margin_percentage DECIMAL(9,4) NOT NULL DEFAULT 0",
        'taxable' => "ALTER TABLE estimate_items ADD COLUMN taxable TINYINT(1) NOT NULL DEFAULT 1",
        'subtotal_cost' => "ALTER TABLE estimate_items ADD COLUMN subtotal_cost DECIMAL(18,4) NOT NULL DEFAULT 0",
        'labor_cost' => "ALTER TABLE estimate_items ADD COLUMN labor_cost DECIMAL(18,4) NOT NULL DEFAULT 0"
    );
    foreach ($estimateColumns as $column => $sql) tl_add_column($pdo, 'estimate_items', $column, $sql);

    $pdo->exec("INSERT INTO projects (id, name, description, status)
        VALUES (1, 'Uploads Test Project', 'Temporary project for takeoff module testing', 'active')
        ON DUPLICATE KEY UPDATE name = VALUES(name)");
    $pdo->exec("INSERT INTO takeoffs (id, project_id, name, status)
        VALUES (1, 1, 'Default Takeoff', 'draft')
        ON DUPLICATE KEY UPDATE name = VALUES(name)");
    $pdo->exec("INSERT INTO estimates (id, project_id, name, status, currency_code)
        VALUES (1, 1, 'Default Estimate', 'draft', 'USD')
        ON DUPLICATE KEY UPDATE name = VALUES(name)");

    tl_seed_catalog($pdo);
}

function tl_seed_catalog($pdo)
{
    $count = 0;
    try {
        $count = (int)$pdo->query("SELECT COUNT(*) FROM catalog_items WHERE deleted_at IS NULL")->fetchColumn();
    } catch (Throwable $e) {
        return;
    }
    if ($count > 0) return;

    $pdo->exec("INSERT INTO catalogs (id, name, description, active) VALUES (1, 'Electrical Demo Catalog', 'Seed catalog for takeoff testing', 1)
        ON DUPLICATE KEY UPDATE name = VALUES(name)");
    $pdo->exec("INSERT INTO catalog_groups (id, catalog_id, name, active) VALUES
        (1, 1, 'Lighting', 1),
        (2, 1, 'Controls', 1)
        ON DUPLICATE KEY UPDATE name = VALUES(name)");
    $stmt = $pdo->prepare("INSERT INTO catalog_items
        (catalog_id, catalog_group_id, name, description, item_type, unit_of_measure, unit_cost, labor_hours, color, symbol, manufacturer, catalog_number, cost_code, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)");
    $rows = array(
        array(1, 1, '2x4 LED Panel', 'Lay-in LED fixture', tl_item_type_for_db($pdo, 'material'), 'ea', 148.00, 0.35, '#2563eb', 'square', 'Lithonia', 'CPX-2X4', '26-51-00'),
        array(1, 1, 'Exit Sign', 'LED exit sign with battery backup', tl_item_type_for_db($pdo, 'material'), 'ea', 92.00, 0.25, '#16a34a', 'triangle', 'Sure-Lites', 'EX-LED', '26-52-00'),
        array(1, 2, 'Occupancy Sensor', 'Ceiling mounted control sensor', tl_item_type_for_db($pdo, 'material'), 'ea', 64.50, 0.20, '#f59e0b', 'circle', 'Leviton', 'OSC10', '26-09-00')
    );
    foreach ($rows as $row) $stmt->execute($row);
}

function tl_catalog_items($pdo)
{
    $sql = "SELECT ci.id, ci.catalog_id, ci.catalog_group_id, ci.name, ci.description, ci.item_type,
            ci.unit_of_measure, ci.unit_cost, ci.labor_hours, ci.color, ci.symbol, ci.manufacturer,
            ci.catalog_number, ci.cost_code, c.name AS catalog_name, g.name AS group_name
        FROM catalog_items ci
        LEFT JOIN catalogs c ON c.id = ci.catalog_id
        LEFT JOIN catalog_groups g ON g.id = ci.catalog_group_id
        WHERE ci.deleted_at IS NULL
        ORDER BY ci.updated_at DESC, ci.name";
    return $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
}

function tl_layers($pdo)
{
    $sql = "SELECT tl.*, ci.name AS catalog_item_name, ci.unit_cost AS catalog_unit_cost, ci.labor_hours AS catalog_labor_hours
        FROM takeoff_layers tl
        LEFT JOIN catalog_items ci ON ci.id = tl.catalog_item_id
        WHERE tl.deleted_at IS NULL
        ORDER BY COALESCE(tl.group_name, 'Ungrouped'), tl.sort_order, tl.name";
    return $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
}

function tl_estimate_items($pdo)
{
    $sql = "SELECT ei.*, tl.name AS takeoff_layer_name, ci.name AS catalog_item_name
        FROM estimate_items ei
        LEFT JOIN takeoff_layers tl ON tl.id = ei.takeoff_layer_id
        LEFT JOIN catalog_items ci ON ci.id = ei.catalog_item_id
        WHERE ei.deleted_at IS NULL
        ORDER BY ei.sort_order, ei.id";
    return $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
}

function tl_list_payload($pdo)
{
    return array(
        'layers' => tl_layers($pdo),
        'catalogItems' => tl_catalog_items($pdo),
        'estimateItems' => tl_estimate_items($pdo),
        'project' => array('id' => 1, 'name' => 'Uploads Test Project')
    );
}

function tl_calc_estimate_values($quantity, $unitCost, $unitLaborTime, $waste, $margin)
{
    $subtotal = $quantity * $unitCost;
    if ($waste > 0) $subtotal += $subtotal * ($waste / 100);
    $laborHours = $quantity * $unitLaborTime;
    $total = $subtotal;
    if ($margin > 0) $total += $total * ($margin / 100);
    return array($subtotal, $laborHours, $total);
}

function tl_sync_layer_estimate($pdo, $layerId)
{
    $stmt = $pdo->prepare("SELECT tl.*, ci.unit_cost, ci.labor_hours, ci.description, ci.cost_code, ci.item_type
        FROM takeoff_layers tl
        LEFT JOIN catalog_items ci ON ci.id = tl.catalog_item_id
        WHERE tl.id = ? AND tl.deleted_at IS NULL");
    $stmt->execute(array($layerId));
    $layer = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$layer) return;

    $quantity = tl_float($layer['quantity']);
    $unitCost = tl_float($layer['unit_cost']);
    $unitLabor = tl_float($layer['labor_hours']);
    $values = tl_calc_estimate_values($quantity, $unitCost, $unitLabor, 0, 0);
    $existing = $pdo->prepare("SELECT id FROM estimate_items WHERE takeoff_layer_id = ? AND source_type = 'takeoff' AND deleted_at IS NULL LIMIT 1");
    $existing->execute(array($layerId));
    $estimateItemId = (int)$existing->fetchColumn();

    if ($estimateItemId > 0) {
        $stmt = $pdo->prepare("UPDATE estimate_items SET
            catalog_item_id = ?, name = ?, description = ?, quantity = ?, unit_of_measure = ?, unit_cost = ?,
            unit_labor_time = ?, labor_hours = ?, subtotal_cost = ?, total_cost = ?, group_name = ?,
            budget_code = ?, cost_type = ?, is_quantity_locked_from_takeoff = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?");
        $stmt->execute(array(
            $layer['catalog_item_id'], $layer['name'], $layer['description'], $quantity, $layer['unit_of_measure'],
            $unitCost, $unitLabor, $values[1], $values[0], $values[2], $layer['group_name'],
            $layer['cost_code'], $layer['item_type'], $estimateItemId
        ));
    } else {
        $stmt = $pdo->prepare("INSERT INTO estimate_items
            (estimate_id, takeoff_layer_id, catalog_item_id, source_type, is_manual, is_quantity_locked_from_takeoff,
             group_name, budget_code, cost_type, name, description, quantity, unit_of_measure, unit_cost,
             unit_labor_time, labor_hours, subtotal_cost, total_cost, taxable)
            VALUES (1, ?, ?, 'takeoff', 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)");
        $stmt->execute(array(
            $layerId, $layer['catalog_item_id'], $layer['group_name'], $layer['cost_code'], $layer['item_type'],
            $layer['name'], $layer['description'], $quantity, $layer['unit_of_measure'], $unitCost,
            $unitLabor, $values[1], $values[0], $values[2]
        ));
    }
}

try {
    tl_ensure_schema($pdo);

    if ($action === 'list') {
        tl_json(array('status' => 'success', 'data' => tl_list_payload($pdo)));
    }

    if ($action === 'save_layer') {
        $id = tl_int(isset($input['id']) ? $input['id'] : 0);
        $name = tl_str(isset($input['name']) ? $input['name'] : '');
        $type = tl_str(isset($input['takeoff_type']) ? $input['takeoff_type'] : 'count');
        $uom = tl_str(isset($input['unit_of_measure']) ? $input['unit_of_measure'] : 'ea');
        if (!$name || !$type || !$uom) tl_json(array('status' => 'error', 'msg' => 'Name, type and UOM are required'), 422);

        $catalogItemId = tl_int(isset($input['catalog_item_id']) ? $input['catalog_item_id'] : 0);
        $groupName = tl_str(isset($input['group_name']) ? $input['group_name'] : 'Ungrouped');
        $color = tl_str(isset($input['color']) ? $input['color'] : '#2563eb');
        $symbol = tl_str(isset($input['symbol']) ? $input['symbol'] : 'circle');
        $symbolSize = tl_str(isset($input['symbol_size']) ? $input['symbol_size'] : 'Medium');
        $quantity = tl_float(isset($input['quantity']) ? $input['quantity'] : 0);

        if ($id > 0) {
            $stmt = $pdo->prepare("UPDATE takeoff_layers SET
                catalog_item_id = ?, group_name = ?, name = ?, takeoff_type = ?, unit_of_measure = ?,
                color = ?, symbol = ?, symbol_size = ?, quantity = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?");
            $stmt->execute(array($catalogItemId ?: null, $groupName, $name, $type, $uom, $color, $symbol, $symbolSize, $quantity, $id));
        } else {
            $stmt = $pdo->prepare("INSERT INTO takeoff_layers
                (takeoff_id, project_id, catalog_item_id, group_name, name, takeoff_type, unit_of_measure, color, symbol, symbol_size, quantity, visible, locked)
                VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)");
            $stmt->execute(array($catalogItemId ?: null, $groupName, $name, $type, $uom, $color, $symbol, $symbolSize, $quantity));
            $id = (int)$pdo->lastInsertId();
        }
        tl_sync_layer_estimate($pdo, $id);
        tl_json(array('status' => 'success', 'data' => tl_list_payload($pdo)));
    }

    if ($action === 'duplicate_layer') {
        $id = tl_int($input['id']);
        $stmt = $pdo->prepare("INSERT INTO takeoff_layers
            (takeoff_id, project_id, catalog_item_id, group_name, name, takeoff_type, unit_of_measure, color, symbol, symbol_size, quantity, visible, locked, sort_order)
            SELECT takeoff_id, project_id, catalog_item_id, group_name, CONCAT(name, ' Copy'), takeoff_type, unit_of_measure, color, symbol, symbol_size, quantity, visible, locked, sort_order + 1
            FROM takeoff_layers WHERE id = ? AND deleted_at IS NULL");
        $stmt->execute(array($id));
        $newId = (int)$pdo->lastInsertId();
        if ($newId > 0) tl_sync_layer_estimate($pdo, $newId);
        tl_json(array('status' => 'success', 'data' => tl_list_payload($pdo)));
    }

    if ($action === 'delete_layer') {
        $id = tl_int($input['id']);
        $pdo->prepare("UPDATE takeoff_layers SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")->execute(array($id));
        $pdo->prepare("UPDATE estimate_items SET deleted_at = CURRENT_TIMESTAMP WHERE takeoff_layer_id = ? AND source_type = 'takeoff'")->execute(array($id));
        tl_json(array('status' => 'success', 'data' => tl_list_payload($pdo)));
    }

    if ($action === 'update_layer') {
        $id = tl_int($input['id']);
        $field = isset($input['field']) ? (string)$input['field'] : '';
        $allowed = array('visible', 'locked', 'group_name', 'color', 'symbol', 'quantity');
        if (!in_array($field, $allowed, true)) tl_json(array('status' => 'error', 'msg' => 'Unsupported layer update'), 422);
        $value = isset($input['value']) ? $input['value'] : null;
        $stmt = $pdo->prepare("UPDATE takeoff_layers SET `$field` = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        $stmt->execute(array($value, $id));
        if ($field === 'quantity') tl_sync_layer_estimate($pdo, $id);
        tl_json(array('status' => 'success', 'data' => tl_list_payload($pdo)));
    }

    if ($action === 'sync_layer_estimate') {
        tl_sync_layer_estimate($pdo, tl_int($input['id']));
        tl_json(array('status' => 'success', 'data' => tl_list_payload($pdo)));
    }

    if ($action === 'save_estimate_item') {
        $id = tl_int(isset($input['id']) ? $input['id'] : 0);
        $sourceType = tl_str(isset($input['source_type']) ? $input['source_type'] : 'manual');
        $takeoffLayerId = tl_int(isset($input['takeoff_layer_id']) ? $input['takeoff_layer_id'] : 0);
        $catalogItemId = tl_int(isset($input['catalog_item_id']) ? $input['catalog_item_id'] : 0);
        $name = tl_str(isset($input['name']) ? $input['name'] : '');
        if (!$name) tl_json(array('status' => 'error', 'msg' => 'Estimate item name is required'), 422);

        $quantity = tl_float(isset($input['quantity']) ? $input['quantity'] : 0);
        if ($sourceType === 'takeoff' && $takeoffLayerId > 0) {
            $q = $pdo->prepare("SELECT quantity FROM takeoff_layers WHERE id = ? AND deleted_at IS NULL");
            $q->execute(array($takeoffLayerId));
            $quantity = tl_float($q->fetchColumn());
        }
        $unitCost = tl_float(isset($input['unit_cost']) ? $input['unit_cost'] : 0);
        $unitLabor = tl_float(isset($input['unit_labor_time']) ? $input['unit_labor_time'] : 0);
        $waste = tl_float(isset($input['waste_percentage']) ? $input['waste_percentage'] : 0);
        $margin = tl_float(isset($input['margin_percentage']) ? $input['margin_percentage'] : 0);
        $values = tl_calc_estimate_values($quantity, $unitCost, $unitLabor, $waste, $margin);

        $params = array(
            $takeoffLayerId ?: null,
            $catalogItemId ?: null,
            $sourceType,
            $sourceType === 'manual' ? 1 : 0,
            $sourceType === 'takeoff' ? 1 : 0,
            tl_str(isset($input['group_name']) ? $input['group_name'] : ''),
            tl_str(isset($input['budget_code']) ? $input['budget_code'] : ''),
            tl_str(isset($input['cost_type']) ? $input['cost_type'] : ''),
            $name,
            tl_str(isset($input['description']) ? $input['description'] : ''),
            $quantity,
            tl_str(isset($input['unit_of_measure']) ? $input['unit_of_measure'] : 'ea'),
            $unitCost,
            $unitLabor,
            $values[1],
            $waste,
            $margin,
            tl_int(isset($input['taxable']) ? $input['taxable'] : 1),
            $values[0],
            $values[2]
        );
        if ($id > 0) {
            $params[] = $id;
            $stmt = $pdo->prepare("UPDATE estimate_items SET
                takeoff_layer_id = ?, catalog_item_id = ?, source_type = ?, is_manual = ?, is_quantity_locked_from_takeoff = ?,
                group_name = ?, budget_code = ?, cost_type = ?, name = ?, description = ?, quantity = ?, unit_of_measure = ?,
                unit_cost = ?, unit_labor_time = ?, labor_hours = ?, waste_percentage = ?, margin_percentage = ?,
                taxable = ?, subtotal_cost = ?, total_cost = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?");
            $stmt->execute($params);
        } else {
            $stmt = $pdo->prepare("INSERT INTO estimate_items
                (estimate_id, takeoff_layer_id, catalog_item_id, source_type, is_manual, is_quantity_locked_from_takeoff,
                 group_name, budget_code, cost_type, name, description, quantity, unit_of_measure, unit_cost,
                 unit_labor_time, labor_hours, waste_percentage, margin_percentage, taxable, subtotal_cost, total_cost)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute($params);
        }
        tl_json(array('status' => 'success', 'data' => tl_list_payload($pdo)));
    }

    if ($action === 'delete_estimate_item') {
        $id = tl_int($input['id']);
        $pdo->prepare("UPDATE estimate_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")->execute(array($id));
        tl_json(array('status' => 'success', 'data' => tl_list_payload($pdo)));
    }

    tl_json(array('status' => 'error', 'msg' => 'Unknown action'), 404);
} catch (Throwable $e) {
    tl_json(array('status' => 'error', 'msg' => $e->getMessage()), 500);
}
