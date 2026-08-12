<?php
/**
 * Persistent API for the project Estimating workspace.
 *
 * Requires the 2026 estimating-workspace migration (not created at runtime).
 * The JSON snapshot is the lossless UI representation; estimates,
 * estimate_items and estimate_markups remain the relational integration layer.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$pewRequestId = substr(sha1(uniqid('estimating-', true)), 0, 12);
$pewStage = 'bootstrap';
header('X-Request-ID: ' . $pewRequestId);

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = array();
$action = isset($_GET['action']) ? (string)$_GET['action'] : (isset($body['action']) ? (string)$body['action'] : 'load');

function pew_json($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function pew_error($message, $status = 400, $code = 'invalid_request') {
    global $pewRequestId, $pewStage;
    $error = array('code' => $code, 'message' => $message);
    if ($status >= 500) {
        $error['request_id'] = $pewRequestId;
        $error['stage'] = $pewStage;
    }
    pew_json(array('ok' => false, 'success' => false, 'error' => $error), $status);
}
function pew_int($value) { return is_numeric($value) ? (int)$value : 0; }
function pew_request_project_id(array $query, array $payload) {
    foreach (array('project_id', 'projectId', 'id') as $key) {
        if (isset($query[$key])) {
            $id = pew_int($query[$key]);
            if ($id > 0) return $id;
        }
        if (isset($payload[$key])) {
            $id = pew_int($payload[$key]);
            if ($id > 0) return $id;
        }
    }
    return 0;
}
function pew_num($value) { return is_numeric($value) ? (float)$value : 0.0; }
function pew_text($value, $max = 191) {
    $value = trim((string)($value === null ? '' : $value));
    if (function_exists('mb_substr')) return mb_substr($value, 0, $max);
    return substr($value, 0, $max);
}
function pew_bool($value) { return filter_var($value, FILTER_VALIDATE_BOOLEAN) ? 1 : 0; }
function pew_method($expected) {
    if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') !== $expected) {
        header('Allow: ' . $expected);
        pew_error('Method not allowed.', 405, 'method_not_allowed');
    }
}
function pew_project(PDO $pdo, $projectId) {
    if ($projectId < 1) pew_error('project_id is required.');
    $stmt = $pdo->prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1');
    $stmt->execute(array($projectId));
    if (!$stmt->fetchColumn()) pew_error('Project not found.', 404, 'project_not_found');
}
function pew_decode($json, $fallback = array()) {
    $decoded = json_decode((string)$json, true);
    return is_array($decoded) ? $decoded : $fallback;
}
function pew_table_columns(PDO $pdo, $table) {
    static $cache = array();
    if (isset($cache[$table])) return $cache[$table];
    $allowed = array('estimates', 'estimate_items', 'estimate_markups', 'estimate_workspace_states');
    if (!in_array($table, $allowed, true)) throw new RuntimeException('Unsupported schema table.');
    $rows = $pdo->query('SHOW COLUMNS FROM `' . $table . '`')->fetchAll(PDO::FETCH_ASSOC);
    $cache[$table] = array_fill_keys(array_map(function ($row) { return (string)$row['Field']; }, $rows), true);
    return $cache[$table];
}
function pew_ensure_columns(PDO $pdo, $table, array $definitions) {
    $columns = pew_table_columns($pdo, $table);
    foreach ($definitions as $column => $definition) {
        if (isset($columns[$column])) continue;
        $pdo->exec('ALTER TABLE `' . $table . '` ADD COLUMN `' . $column . '` ' . $definition);
        $columns[$column] = true;
    }
}
function pew_best_effort($label, PDO $pdo, $callback) {
    static $sequence = 0;
    $savepoint = null;
    if ($pdo->inTransaction()) {
        $savepoint = 'pew_optional_' . (++$sequence);
        $pdo->exec('SAVEPOINT ' . $savepoint);
    }
    try {
        $callback();
        if ($savepoint !== null) $pdo->exec('RELEASE SAVEPOINT ' . $savepoint);
        return true;
    } catch (Throwable $e) {
        if ($savepoint !== null && $pdo->inTransaction()) {
            try {
                $pdo->exec('ROLLBACK TO SAVEPOINT ' . $savepoint);
                $pdo->exec('RELEASE SAVEPOINT ' . $savepoint);
            } catch (Throwable $rollbackError) {
                error_log('project_estimating.php savepoint rollback warning: ' . $rollbackError->getMessage());
            }
        }
        error_log('project_estimating.php compatibility warning (' . $label . '): ' . $e->getMessage());
        return false;
    }
}
function pew_assert_schema(PDO $pdo, $repair = false) {
    $stmt = $pdo->query("SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='estimate_workspace_states' LIMIT 1");
    if (!$stmt->fetchColumn()) {
        pew_error('Estimating workspace migration has not been applied.', 503, 'migration_required');
    }
    $workspaceColumns = pew_table_columns($pdo, 'estimate_workspace_states');
    foreach (array('estimate_id', 'project_id', 'client_estimate_id', 'state_json', 'revision') as $requiredColumn) {
        if (!isset($workspaceColumns[$requiredColumn])) {
            pew_error('Estimating workspace migration is incomplete.', 503, 'migration_required');
        }
    }
    // GET/list must remain read-only. Production application users commonly
    // have DML privileges but no ALTER privilege; attempting repair on load
    // made every request fail with 500 before any estimate was read.
    if (!$repair) return;
    // Older Takeoff installations created a smaller estimate schema at runtime.
    // Complete only the additive columns used by this API so load/save cannot
    // fail with an opaque 500 while the durable migration is being deployed.
    pew_best_effort('relational schema repair', $pdo, function () use ($pdo) {
    pew_ensure_columns($pdo, 'estimates', array(
        'settings_json' => 'JSON NULL', 'notes_json' => 'JSON NULL', 'metadata_json' => 'JSON NULL',
        'markup_total' => 'DECIMAL(18,4) NOT NULL DEFAULT 0', 'tax_total' => 'DECIMAL(18,4) NOT NULL DEFAULT 0',
        'labor_hours_total' => 'DECIMAL(18,4) NOT NULL DEFAULT 0'
    ));
    pew_ensure_columns($pdo, 'estimate_items', array(
        'takeoff_layer_id' => 'BIGINT UNSIGNED NULL', 'catalog_item_id' => 'BIGINT UNSIGNED NULL',
        'source_layer_key' => 'VARCHAR(191) NULL', 'source_type' => "VARCHAR(50) NOT NULL DEFAULT 'manual'",
        'is_manual' => 'TINYINT(1) NOT NULL DEFAULT 1', 'is_quantity_locked_from_takeoff' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'item_type' => "VARCHAR(50) NOT NULL DEFAULT 'line_item'", 'group_name' => 'VARCHAR(191) NULL',
        'budget_code' => 'VARCHAR(100) NULL', 'cost_type' => 'VARCHAR(100) NULL', 'description' => 'TEXT NULL',
        'unit_labor_time' => 'DECIMAL(18,4) NOT NULL DEFAULT 0', 'labor_hours' => 'DECIMAL(18,4) NOT NULL DEFAULT 0',
        'material_cost' => 'DECIMAL(18,4) NOT NULL DEFAULT 0', 'labor_cost' => 'DECIMAL(18,4) NOT NULL DEFAULT 0',
        'equipment_cost' => 'DECIMAL(18,4) NOT NULL DEFAULT 0', 'waste_percentage' => 'DECIMAL(9,4) NOT NULL DEFAULT 0',
        'margin_percentage' => 'DECIMAL(9,4) NOT NULL DEFAULT 0', 'taxable' => 'TINYINT(1) NOT NULL DEFAULT 1',
        'subtotal_cost' => 'DECIMAL(18,4) NOT NULL DEFAULT 0', 'total_cost' => 'DECIMAL(18,4) NOT NULL DEFAULT 0',
        'sort_order' => 'INT NOT NULL DEFAULT 0', 'metadata_json' => 'JSON NULL'
    ));
    pew_ensure_columns($pdo, 'estimate_markups', array('metadata_json' => 'JSON NULL'));
    pew_ensure_columns($pdo, 'estimate_workspace_states', array(
        'project_id' => 'BIGINT UNSIGNED NULL', 'client_estimate_id' => 'VARCHAR(191) NULL',
        'state_json' => 'JSON NULL', 'revision' => 'BIGINT UNSIGNED NOT NULL DEFAULT 1',
        'updated_at' => 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    ));
    $pdo->exec('UPDATE estimate_workspace_states ws INNER JOIN estimates e ON e.id=ws.estimate_id SET ws.project_id=e.project_id WHERE ws.project_id IS NULL');
    $pdo->exec("UPDATE estimate_workspace_states SET client_estimate_id=CONCAT('db-estimate-', estimate_id) WHERE client_estimate_id IS NULL OR client_estimate_id=''");
    });
}
function pew_owned_estimate(PDO $pdo, $estimateId, $projectId, $forUpdate = false) {
    $sql = 'SELECT * FROM estimates WHERE id = ? AND project_id = ? AND deleted_at IS NULL LIMIT 1';
    if ($forUpdate) $sql .= ' FOR UPDATE';
    $stmt = $pdo->prepare($sql);
    $stmt->execute(array($estimateId, $projectId));
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) pew_error('Estimate not found in this project.', 404, 'estimate_not_found');
    return $row;
}
function pew_owned_estimate_id(PDO $pdo, $estimateId, $projectId, $forUpdate = false) {
    if ($estimateId < 1) return 0;
    $sql = 'SELECT id FROM estimates WHERE id = ? AND project_id = ? AND deleted_at IS NULL LIMIT 1';
    if ($forUpdate) $sql .= ' FOR UPDATE';
    $stmt = $pdo->prepare($sql);
    $stmt->execute(array($estimateId, $projectId));
    return (int)$stmt->fetchColumn();
}
function pew_resolve_estimate_id(PDO $pdo, $projectId, $clientId, $hintEstimateId = 0) {
    // Stable client identity wins over a numeric id cached by an older session.
    $find = $pdo->prepare('SELECT ws.estimate_id FROM estimate_workspace_states ws
        INNER JOIN estimates e ON e.id=ws.estimate_id AND e.project_id=? AND e.deleted_at IS NULL
        WHERE ws.project_id=? AND ws.client_estimate_id=? ORDER BY ws.estimate_id ASC LIMIT 1 FOR UPDATE');
    $find->execute(array($projectId, $projectId, $clientId));
    $mapped = (int)$find->fetchColumn();
    if ($mapped) return $mapped;

    // Some earlier saves wrote the stable id only to estimates.metadata_json.
    $estimateColumns = pew_table_columns($pdo, 'estimates');
    if (isset($estimateColumns['metadata_json'])) {
        pew_best_effort('estimate metadata recovery', $pdo, function () use ($pdo, $projectId, $clientId, &$mapped) {
            $stmt = $pdo->prepare("SELECT id FROM estimates WHERE project_id=? AND deleted_at IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.workspaceClientId'))=? ORDER BY id ASC LIMIT 1 FOR UPDATE");
            $stmt->execute(array($projectId, $clientId));
            $mapped = (int)$stmt->fetchColumn();
        });
        if ($mapped) return $mapped;
    }

    $hintEstimateId = pew_owned_estimate_id($pdo, $hintEstimateId, $projectId, true);
    if (!$hintEstimateId) return 0;
    $hintState = pew_state_row($pdo, $hintEstimateId);
    if ($hintState && (string)$hintState['client_estimate_id'] !== (string)$clientId) return 0;
    return $hintEstimateId;
}
function pew_state_row(PDO $pdo, $estimateId) {
    $columns = pew_table_columns($pdo, 'estimate_workspace_states');
    $select = array(
        isset($columns['client_estimate_id']) ? 'client_estimate_id' : "CONCAT('db-estimate-', estimate_id) AS client_estimate_id",
        isset($columns['revision']) ? 'revision' : '0 AS revision',
        isset($columns['state_json']) ? 'state_json' : 'NULL AS state_json',
        isset($columns['updated_at']) ? 'updated_at' : 'NULL AS updated_at'
    );
    $stmt = $pdo->prepare('SELECT ' . implode(',', $select) . ' FROM estimate_workspace_states WHERE estimate_id = ?');
    $stmt->execute(array($estimateId));
    return $stmt->fetch(PDO::FETCH_ASSOC);
}
function pew_save_workspace_state(PDO $pdo, $estimateId, $projectId, $clientId, $encoded) {
    $columns = pew_table_columns($pdo, 'estimate_workspace_states');
    $touch = isset($columns['updated_at']) ? ',updated_at=CURRENT_TIMESTAMP' : '';
    // Remove only mappings whose target no longer represents a live estimate.
    // This prevents a stale unique (project_id, client_estimate_id) row from
    // blocking recovery, while never stealing a mapping from a valid estimate.
    $cleanup = $pdo->prepare('DELETE ws FROM estimate_workspace_states ws LEFT JOIN estimates e ON e.id=ws.estimate_id
        WHERE ws.project_id=? AND ws.client_estimate_id=? AND ws.estimate_id<>?
          AND (e.id IS NULL OR e.deleted_at IS NOT NULL OR e.project_id<>?)');
    $cleanup->execute(array($projectId, $clientId, $estimateId, $projectId));
    // Do not depend on a legacy table having a uniqueness constraint.
    // The locked estimate row serializes saves for this id.
    $stmt = $pdo->prepare('UPDATE estimate_workspace_states SET project_id=?,client_estimate_id=?,state_json=?,revision=COALESCE(revision,0)+1' . $touch . ' WHERE estimate_id=?');
    $stmt->execute(array($projectId, $clientId, $encoded, $estimateId));
    if ($stmt->rowCount() > 0) return;
    $stmt = $pdo->prepare('INSERT INTO estimate_workspace_states (estimate_id,project_id,client_estimate_id,state_json,revision) VALUES (?,?,?,?,1)');
    $stmt->execute(array($estimateId, $projectId, $clientId, $encoded));
}
function pew_relational_groups(PDO $pdo, $estimateId) {
    $columns = pew_table_columns($pdo, 'estimate_items');
    $active = isset($columns['deleted_at']) ? ' AND deleted_at IS NULL' : '';
    $order = isset($columns['sort_order']) ? 'sort_order ASC, id ASC' : 'id ASC';
    $stmt = $pdo->prepare('SELECT * FROM estimate_items WHERE estimate_id = ?' . $active . ' ORDER BY ' . $order);
    $stmt->execute(array($estimateId));
    $groups = array();
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $meta = pew_decode(isset($row['metadata_json']) ? $row['metadata_json'] : null);
        $item = isset($meta['workspace']) && is_array($meta['workspace']) ? $meta['workspace'] : array();
        $clientId = !empty($meta['workspaceClientId']) ? (string)$meta['workspaceClientId'] : 'db-item-' . (int)$row['id'];
        $item['id'] = $clientId;
        $item['estimateItemId'] = (int)$row['id'];
        if (!isset($item['name'])) $item['name'] = (string)$row['name'];
        if (!isset($item['description'])) $item['description'] = (string)$row['description'];
        if (!isset($item['quantity'])) $item['quantity'] = (float)$row['quantity'];
        if (!isset($item['uom'])) $item['uom'] = (string)$row['unit_of_measure'];
        if (!isset($item['unitMaterialCost'])) $item['unitMaterialCost'] = (float)$row['unit_cost'];
        if (!isset($item['quantitySource'])) $item['quantitySource'] = isset($row['source_type']) ? (string)$row['source_type'] : 'manual';
        if (!isset($item['takeoffLayerId']) && !empty($row['source_layer_key'])) $item['takeoffLayerId'] = (string)$row['source_layer_key'];
        $groupName = trim((string)(isset($row['group_name']) ? $row['group_name'] : '')) ?: 'Default Group';
        if (!isset($groups[$groupName])) {
            $groups[$groupName] = array(
                'id' => 'db-group-' . substr(sha1($groupName), 0, 12),
                'name' => $groupName,
                'parentId' => null,
                'expanded' => true,
                'sortOrder' => count($groups),
                'source' => 'recovered',
                'takeoffMirror' => false,
                'items' => array()
            );
        }
        $groups[$groupName]['items'][] = $item;
    }
    return array_values($groups);
}
function pew_load_one(PDO $pdo, array $estimate) {
    $state = pew_state_row($pdo, (int)$estimate['id']);
    $snapshot = $state ? pew_decode($state['state_json']) : array();
    // Relational rows are the durable integration layer. Recover them when a
    // legacy/malformed workspace snapshot has no group payload instead of
    // rendering an empty estimate after refresh.
    if (!isset($snapshot['groups']) || !is_array($snapshot['groups']) || !$snapshot['groups']) {
        $recoveredGroups = pew_relational_groups($pdo, (int)$estimate['id']);
        if ($recoveredGroups) $snapshot['groups'] = $recoveredGroups;
    }
    $snapshot['id'] = $state && $state['client_estimate_id'] !== '' ? $state['client_estimate_id'] : (string)$estimate['id'];
    $snapshot['estimateItemId'] = (int)$estimate['id'];
    $snapshot['dbEstimateId'] = (int)$estimate['id'];
    $snapshot['projectId'] = (int)$estimate['project_id'];
    $snapshot['name'] = (string)$estimate['name'];
    $snapshot['code'] = isset($estimate['estimate_number']) ? (string)$estimate['estimate_number'] : '';
    $snapshot['status'] = (string)$estimate['status'];
    $snapshot['revision'] = $state ? (int)$state['revision'] : 0;
    $snapshot['updatedAt'] = (string)$estimate['updated_at'];
    return $snapshot;
}
function pew_item_metadata(array $item, $clientId) {
    return json_encode(array('workspaceClientId' => $clientId, 'workspace' => $item), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}
function pew_existing_items(PDO $pdo, $estimateId) {
    $stmt = $pdo->prepare('SELECT id, source_layer_key, metadata_json FROM estimate_items WHERE estimate_id = ? AND deleted_at IS NULL');
    $stmt->execute(array($estimateId));
    $map = array();
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $meta = pew_decode($row['metadata_json']);
        $key = !empty($meta['workspaceClientId']) ? $meta['workspaceClientId'] : (!empty($row['source_layer_key']) ? $row['source_layer_key'] : null);
        if ($key !== null) $map[(string)$key] = (int)$row['id'];
    }
    return $map;
}
function pew_takeoff_layer_id(PDO $pdo, $projectId, $layerKey) {
    $layerKey = pew_text($layerKey, 191);
    if ($layerKey === '') return null;
    $stmt = $pdo->prepare('SELECT tl.id FROM takeoff_layers tl LEFT JOIN takeoffs t ON t.id=tl.takeoff_id
        WHERE tl.deleted_at IS NULL AND (tl.integration_key=? OR tl.id=?)
          AND (tl.project_id=? OR t.project_id=?) LIMIT 1');
    $stmt->execute(array($layerKey, pew_int($layerKey), $projectId, $projectId));
    $id = (int)$stmt->fetchColumn();
    return $id > 0 ? $id : null;
}
function pew_catalog_item_id(PDO $pdo, $value) {
    static $cache = array();
    $id = pew_int($value);
    if ($id < 1) return null;
    if (array_key_exists($id, $cache)) return $cache[$id];
    $stmt = $pdo->prepare('SELECT id FROM catalog_items WHERE id=? AND deleted_at IS NULL LIMIT 1');
    $stmt->execute(array($id));
    $found = (int)$stmt->fetchColumn();
    $cache[$id] = $found > 0 ? $found : null;
    return $cache[$id];
}
function pew_save_items(PDO $pdo, $projectId, $estimateId, array $groups) {
    $existing = pew_existing_items($pdo, $estimateId);
    $kept = array();
    $insert = $pdo->prepare('INSERT INTO estimate_items
        (estimate_id, takeoff_layer_id, catalog_item_id, source_layer_key, source_type, is_manual, is_quantity_locked_from_takeoff,
         item_type, group_name, budget_code, cost_type, name, description, quantity, unit_of_measure, unit_cost,
         unit_labor_time, labor_hours, material_cost, labor_cost, equipment_cost, waste_percentage,
         margin_percentage, taxable, subtotal_cost, total_cost, sort_order, metadata_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $update = $pdo->prepare('UPDATE estimate_items SET takeoff_layer_id=?, catalog_item_id=?, source_layer_key=?, source_type=?, is_manual=?,
        is_quantity_locked_from_takeoff=?, item_type=?, group_name=?, budget_code=?, cost_type=?, name=?, description=?,
        quantity=?, unit_of_measure=?, unit_cost=?, unit_labor_time=?, labor_hours=?, material_cost=?, labor_cost=?,
        equipment_cost=?, waste_percentage=?, margin_percentage=?, taxable=?, subtotal_cost=?, total_cost=?, sort_order=?,
        metadata_json=?, deleted_at=NULL WHERE id=? AND estimate_id=?');
    $position = 0;
    foreach ($groups as $group) {
        if (!is_array($group)) continue;
        $groupName = pew_text(isset($group['name']) ? $group['name'] : 'Default Group');
        $items = isset($group['items']) && is_array($group['items']) ? $group['items'] : array();
        foreach ($items as $item) {
            if (!is_array($item)) continue;
            $clientId = pew_text(isset($item['id']) ? $item['id'] : '', 191);
            if ($clientId === '') pew_error('Every item must have an id.', 422, 'invalid_item');
            $source = pew_text(isset($item['quantitySource']) ? $item['quantitySource'] : (isset($item['sourceType']) ? $item['sourceType'] : 'manual'), 50);
            $sourceLayerKey = !empty($item['takeoffLayerId']) ? pew_text($item['takeoffLayerId'], 191) : null;
            $takeoffLayerId = $sourceLayerKey ? pew_takeoff_layer_id($pdo, $projectId, $sourceLayerKey) : null;
            $qty = pew_num(isset($item['quantity']) ? $item['quantity'] : 0);
            $unitCost = pew_num(isset($item['unitMaterialCost']) ? $item['unitMaterialCost'] : 0);
            $waste = pew_num(isset($item['waste']) ? $item['waste'] : 0);
            $materialCost = pew_num(isset($item['materialCost']) ? $item['materialCost'] : ($qty * $unitCost * (1 + $waste / 100)));
            $laborHours = pew_num(isset($item['laborHours']) ? $item['laborHours'] : 0);
            $laborCost = pew_num(isset($item['laborCost']) ? $item['laborCost'] : ($laborHours * pew_num(isset($item['laborRate']) ? $item['laborRate'] : 0)));
            $equipmentCost = pew_num(isset($item['equipmentCost']) ? $item['equipmentCost'] : (pew_num(isset($item['unitEquipmentCost']) ? $item['unitEquipmentCost'] : 0) * pew_num(isset($item['equipmentQuantity']) ? $item['equipmentQuantity'] : 0)));
            $subtotal = pew_num(isset($item['totalCost']) ? $item['totalCost'] : ($materialCost + $laborCost + $equipmentCost));
            $values = array(
                $takeoffLayerId,
                pew_catalog_item_id($pdo, isset($item['catalogItemId']) ? $item['catalogItemId'] : null),
                $sourceLayerKey, $source, $source === 'manual' ? 1 : 0, $source === 'takeoff' && empty($item['quantityOverride']) ? 1 : 0,
                !empty($item['isAssembly']) ? 'assembly' : 'line_item', $groupName,
                pew_text(isset($item['budgetCode']) ? $item['budgetCode'] : '', 100),
                pew_text(isset($item['costCategory']) ? $item['costCategory'] : '', 100),
                pew_text(isset($item['name']) ? $item['name'] : 'Cost item'),
                isset($item['description']) ? (string)$item['description'] : null, $qty,
                pew_text(isset($item['uom']) ? $item['uom'] : 'ea', 50), $unitCost,
                pew_num(isset($item['unitLabor']) ? $item['unitLabor'] : 0), $laborHours, $materialCost, $laborCost,
                $equipmentCost, $waste, pew_num(isset($item['materialMargin']) ? $item['materialMargin'] : 0),
                !isset($item['taxable']) || $item['taxable'] ? 1 : 0, $subtotal,
                pew_num(isset($item['totalSales']) ? $item['totalSales'] : $subtotal), $position++, pew_item_metadata($item, $clientId)
            );
            if (isset($existing[$clientId])) {
                $id = $existing[$clientId];
                $update->execute(array_merge($values, array($id, $estimateId)));
            } else {
                $insert->execute(array_merge(array($estimateId), $values));
                $id = (int)$pdo->lastInsertId();
            }
            $kept[] = $id;
        }
    }
    if ($kept) {
        $marks = implode(',', array_fill(0, count($kept), '?'));
        $stmt = $pdo->prepare("UPDATE estimate_items SET deleted_at=CURRENT_TIMESTAMP WHERE estimate_id=? AND deleted_at IS NULL AND id NOT IN ($marks)");
        $stmt->execute(array_merge(array($estimateId), $kept));
    } else {
        $pdo->prepare('UPDATE estimate_items SET deleted_at=CURRENT_TIMESTAMP WHERE estimate_id=? AND deleted_at IS NULL')->execute(array($estimateId));
    }
}
function pew_save_markups(PDO $pdo, $estimateId, array $settings) {
    $pdo->prepare('UPDATE estimate_markups SET deleted_at=CURRENT_TIMESTAMP WHERE estimate_id=? AND deleted_at IS NULL')->execute(array($estimateId));
    $stmt = $pdo->prepare('INSERT INTO estimate_markups (estimate_id,name,markup_type,basis,value,amount,sort_order,metadata_json) VALUES (?,?,?,?,?,?,?,?)');
    $order = 0;
    foreach (array('preTaxMarkups' => 'pre_tax', 'postTaxMarkups' => 'post_tax') as $key => $phase) {
        $rows = isset($settings[$key]) && is_array($settings[$key]) ? $settings[$key] : array();
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            $requestedType = isset($row['type']) ? (string)$row['type'] : 'percentage';
            $type = in_array($requestedType, array('fixed', 'fixed_amount'), true) ? 'fixed' : 'percentage';
            $value = $type === 'fixed' ? pew_num(isset($row['amount']) ? $row['amount'] : 0) : pew_num(isset($row['percent']) ? $row['percent'] : 0);
            $meta = json_encode(array('phase' => $phase, 'workspace' => $row), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $stmt->execute(array($estimateId, pew_text(isset($row['name']) ? $row['name'] : 'Markup'), $type, 'subtotal', $value, 0, $order++, $meta));
        }
    }
}

function pew_save_estimate(PDO $pdo, $projectId, array $estimate, array $summary = array(), $expectedRevision = null) {
    $encoded = json_encode($estimate, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encoded === false || strlen($encoded) > 8 * 1024 * 1024) pew_error('Estimate snapshot is invalid or too large.', 413, 'snapshot_too_large');
    $clientId = pew_text(isset($estimate['id']) ? $estimate['id'] : '', 191);
    if ($clientId === '') pew_error('Every estimate must have an id.', 422, 'invalid_estimate');
    // Local drafts can outlive a deleted/recreated server estimate. Treat a
    // stale dbEstimateId as a cache hint, never as authoritative identity.
    $estimateId = pew_resolve_estimate_id($pdo, $projectId, $clientId,
        pew_int(isset($estimate['dbEstimateId']) ? $estimate['dbEstimateId'] : 0));
    if (!$estimateId) {
        $createdExtended = pew_best_effort('extended estimate insert', $pdo, function () use ($pdo, $projectId, $estimate) {
            $stmt = $pdo->prepare('INSERT INTO estimates (project_id,estimate_number,name,status,currency_code) VALUES (?,?,?,?,?)');
            $stmt->execute(array($projectId, pew_text(isset($estimate['code']) ? $estimate['code'] : '', 100) ?: null,
                pew_text(isset($estimate['name']) ? $estimate['name'] : 'Estimate'), pew_text(isset($estimate['status']) ? $estimate['status'] : 'draft', 50), 'USD'));
        });
        if (!$createdExtended) {
            $pdo->prepare('INSERT INTO estimates (project_id,name,status) VALUES (?,?,?)')->execute(array(
                $projectId, pew_text(isset($estimate['name']) ? $estimate['name'] : 'Estimate'),
                pew_text(isset($estimate['status']) ? $estimate['status'] : 'draft', 50)
            ));
        }
        $estimateId = (int)$pdo->lastInsertId();
    }
    $current = pew_state_row($pdo, $estimateId);
    if ($expectedRevision !== null && $current && (int)$expectedRevision !== (int)$current['revision']) {
        pew_error('The estimate was changed by another client.', 409, 'revision_conflict');
    }
    if (isset($estimate['estimateSummary']) && is_array($estimate['estimateSummary'])) $summary = $estimate['estimateSummary'];
    $extendedValues = array(pew_text(isset($estimate['code']) ? $estimate['code'] : '', 100) ?: null, pew_text(isset($estimate['name']) ? $estimate['name'] : 'Estimate'),
        pew_text(isset($estimate['status']) ? $estimate['status'] : 'draft', 50), pew_num(isset($summary['subtotal']) ? $summary['subtotal'] : 0),
        pew_num(isset($summary['preTaxMarkup']) ? $summary['preTaxMarkup'] : 0) + pew_num(isset($summary['postTaxMarkup']) ? $summary['postTaxMarkup'] : 0),
        pew_num(isset($summary['taxes']) ? $summary['taxes'] : 0), pew_num(isset($summary['total']) ? $summary['total'] : 0),
        pew_num(isset($summary['laborHours']) ? $summary['laborHours'] : 0),
        json_encode(isset($estimate['settings']) && is_array($estimate['settings']) ? $estimate['settings'] : array(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        json_encode(isset($estimate['notes']) && is_array($estimate['notes']) ? $estimate['notes'] : array(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        json_encode(array('workspaceClientId' => $clientId), JSON_UNESCAPED_SLASHES), $estimateId, $projectId);
    $extendedSaved = pew_best_effort('extended estimate fields', $pdo, function () use ($pdo, $extendedValues) {
        $stmt = $pdo->prepare('UPDATE estimates SET estimate_number=?,name=?,status=?,subtotal_cost=?,markup_total=?,tax_total=?,total_cost=?,labor_hours_total=?,settings_json=?,notes_json=?,metadata_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?');
        $stmt->execute($extendedValues);
    });
    if (!$extendedSaved) {
        $pdo->prepare('UPDATE estimates SET name=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?')->execute(array(
            pew_text(isset($estimate['name']) ? $estimate['name'] : 'Estimate'),
            pew_text(isset($estimate['status']) ? $estimate['status'] : 'draft', 50), $estimateId, $projectId
        ));
    }
    // The JSON snapshot is lossless and authoritative. Store it before the
    // optional relational mirror so legacy item/markup schemas cannot roll it back.
    pew_save_workspace_state($pdo, $estimateId, $projectId, $clientId, $encoded);
    pew_best_effort('estimate items mirror', $pdo, function () use ($pdo, $projectId, $estimateId, $estimate) {
        pew_save_items($pdo, $projectId, $estimateId, isset($estimate['groups']) && is_array($estimate['groups']) ? $estimate['groups'] : array());
    });
    pew_best_effort('estimate markups mirror', $pdo, function () use ($pdo, $estimateId, $estimate) {
        pew_save_markups($pdo, $estimateId, isset($estimate['settings']) && is_array($estimate['settings']) ? $estimate['settings'] : array());
    });
    $saved = pew_state_row($pdo, $estimateId);
    $result = pew_load_one($pdo, pew_owned_estimate($pdo, $estimateId, $projectId));
    $result['revision'] = (int)$saved['revision'];
    return $result;
}

try {
    $pewStage = 'database_connection';
    require __DIR__ . '/../core/db/connection.php';
    $pewStage = 'schema_validation';
    pew_assert_schema($pdo);
    $projectId = pew_request_project_id($_GET, $body);
    $pewStage = 'project_validation';
    pew_project($pdo, $projectId);

    if ($action === 'list' || $action === 'load') {
        $pewStage = 'workspace_load';
        pew_method('GET');
        $estimateId = pew_int(isset($_GET['estimate_id']) ? $_GET['estimate_id'] : 0);
        if ($estimateId) {
            $estimate = pew_owned_estimate($pdo, $estimateId, $projectId);
            $loaded = pew_load_one($pdo, $estimate);
            pew_json(array('ok' => true, 'success' => true, 'estimate' => $loaded, 'state' => $loaded));
        }
        $stmt = $pdo->prepare('SELECT * FROM estimates WHERE project_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC');
        $stmt->execute(array($projectId));
        $estimates = array();
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) $estimates[] = pew_load_one($pdo, $row);
        $activeEstimateId = $estimates ? $estimates[0]['id'] : null;
        foreach ($estimates as $candidate) {
            if (!empty($candidate['isActive'])) { $activeEstimateId = $candidate['id']; break; }
        }
        pew_json(array('ok' => true, 'success' => true, 'projectId' => $projectId, 'estimates' => $estimates,
            'state' => array('activeEstimateId' => $activeEstimateId, 'estimates' => $estimates)));
    }

    if ($action === 'save') {
        $pewStage = 'workspace_save';
        pew_method('POST');
        $workspace = isset($body['state']) && is_array($body['state']) ? $body['state'] : null;
        $incoming = $workspace && isset($workspace['estimates']) && is_array($workspace['estimates'])
            ? $workspace['estimates']
            : (isset($body['estimate']) && is_array($body['estimate']) ? array($body['estimate']) : array());
        if (!$incoming) pew_error('state.estimates is required.', 422, 'invalid_workspace');
        $pdo->beginTransaction();
        $savedEstimates = array();
        $keptIds = array();
        $requestedActiveId = $workspace && isset($workspace['activeEstimateId']) ? (string)$workspace['activeEstimateId'] : '';
        foreach ($incoming as $estimate) {
            if (!is_array($estimate)) pew_error('Invalid estimate in workspace.', 422, 'invalid_estimate');
            // activeEstimateId is the workspace-level source of truth. Persist a
            // single flag in each lossless estimate snapshot so GET/list can
            // restore the same selection after a full page reload.
            if ($workspace) $estimate['isActive'] = $requestedActiveId !== '' && (string)(isset($estimate['id']) ? $estimate['id'] : '') === $requestedActiveId;
            $expected = isset($estimate['revision']) ? pew_int($estimate['revision']) : null;
            $summary = isset($body['summary']) && is_array($body['summary']) && isset($workspace['activeEstimateId']) && $workspace['activeEstimateId'] === $estimate['id'] ? $body['summary'] : array();
            $savedEstimate = pew_save_estimate($pdo, $projectId, $estimate, $summary, $expected);
            $savedEstimates[] = $savedEstimate;
            $keptIds[] = (int)$savedEstimate['dbEstimateId'];
        }
        // Only estimates previously owned by this workspace API are eligible for omission deletion.
        if ($workspace && $keptIds) {
            $marks = implode(',', array_fill(0, count($keptIds), '?'));
            $stmt = $pdo->prepare("UPDATE estimates e INNER JOIN estimate_workspace_states ws ON ws.estimate_id=e.id
                SET e.deleted_at=CURRENT_TIMESTAMP WHERE e.project_id=? AND e.deleted_at IS NULL AND e.id NOT IN ($marks)");
            $stmt->execute(array_merge(array($projectId), $keptIds));
        }
        $pdo->commit();
        if ($workspace) {
            $workspace['estimates'] = $savedEstimates;
            $savedActiveExists = false;
            foreach ($savedEstimates as $savedEstimate) {
                if ((string)$savedEstimate['id'] === $requestedActiveId) { $savedActiveExists = true; break; }
            }
            $workspace['activeEstimateId'] = $savedActiveExists ? $requestedActiveId : ($savedEstimates ? $savedEstimates[0]['id'] : null);
            pew_json(array('ok' => true, 'success' => true, 'state' => $workspace));
        }
        $savedEstimate = $savedEstimates[0];
        pew_json(array('ok' => true, 'success' => true, 'estimateId' => $savedEstimate['dbEstimateId'],
            'clientEstimateId' => $savedEstimate['id'], 'revision' => $savedEstimate['revision'], 'state' => $savedEstimate));
    }

    if ($action === 'delete') {
        $pewStage = 'workspace_delete';
        pew_method('POST');
        $estimateId = pew_int(isset($body['estimate_id']) ? $body['estimate_id'] : 0);
        $pdo->beginTransaction();
        pew_owned_estimate($pdo, $estimateId, $projectId, true);
        $pdo->prepare('UPDATE estimates SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=?')->execute(array($estimateId, $projectId));
        $pdo->commit();
        pew_json(array('ok' => true, 'success' => true, 'estimateId' => $estimateId));
    }
    pew_error('Unknown action.', 404, 'unknown_action');
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    error_log(sprintf('project_estimating.php request=%s stage=%s type=%s message=%s',
        $pewRequestId, $pewStage, get_class($e), $e->getMessage()));
    $schemaFailure = $pewStage === 'schema_validation' || preg_match('/unknown column|base table.*not found|alter command denied/i', $e->getMessage());
    pew_json(array('ok' => false, 'success' => false, 'error' => array(
        'code' => $schemaFailure ? 'schema_incompatible' : 'server_error',
        'message' => $schemaFailure
            ? 'Estimating database schema is incomplete. Apply the estimating workspace migration, then retry.'
            : 'Unable to process estimating workspace request.',
        'request_id' => $pewRequestId, 'stage' => $pewStage
    )), 500);
}
