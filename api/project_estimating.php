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
require_once __DIR__ . '/../core/auth/session.php';
header('X-Request-ID: ' . $pewRequestId);

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = array();
$readActions = array('list', 'load');
$mutationActions = array('save', 'create', 'delete');
$action = (string)(isset($_GET['action']) ? $_GET['action'] : (isset($body['action']) ? $body['action'] : (isset($_POST['action']) ? $_POST['action'] : '')));
$user = takeoff_guard_api_action($action, $readActions, $mutationActions, 'load');
$userId = (int)$user['user_id'];
if ($action === '') {
    $action = 'load';
}

class PewRevisionConflict extends RuntimeException {
    public $conflicts;
    public function __construct(array $conflicts) {
        parent::__construct('The estimate was changed by another client.');
        $this->conflicts = $conflicts;
    }
}
class PewCatalogUpdateStale extends RuntimeException {
    public $details;
    public function __construct(array $details) {
        parent::__construct('The source estimate changed after the Cost Catalog preview.');
        $this->details = $details;
    }
}

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
    $allowed = array(
        'estimates', 'estimate_items', 'estimate_markups', 'estimate_workspace_states',
        'takeoff_layers', 'takeoff_count_markers', 'takeoff_linear_segments',
        'takeoff_estimate_states', 'takeoff_estimate_scales'
    );
    if (!in_array($table, $allowed, true)) throw new RuntimeException('Unsupported schema table.');
    $existsStmt = $pdo->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1');
    $existsStmt->execute(array($table));
    if (!$existsStmt->fetchColumn()) {
        $cache[$table] = array();
        return $cache[$table];
    }
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
    // Takeoff owns this server-side registry. Preserve it when Estimating
    // replaces its workspace JSON so stale drawing saves stay serialized by
    // the same estimate-scoped authority without changing client revisions.
    $registryStmt = $pdo->prepare('SELECT state_json FROM estimate_workspace_states WHERE estimate_id=? LIMIT 1 FOR UPDATE');
    $registryStmt->execute(array($estimateId));
    $storedWorkspace = json_decode((string)($registryStmt->fetchColumn() ?: '{}'), true);
    $incomingWorkspace = json_decode((string)$encoded, true);
    if (is_array($storedWorkspace) && isset($storedWorkspace['takeoffLayerNames']) && is_array($incomingWorkspace)) {
        $incomingWorkspace['takeoffLayerNames'] = $storedWorkspace['takeoffLayerNames'];
        $preserved = json_encode($incomingWorkspace, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($preserved !== false) $encoded = $preserved;
    }
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
        if (!isset($item['difficulty'])) $item['difficulty'] = isset($meta['workspace']['difficulty']) ? (float)$meta['workspace']['difficulty'] : (isset($meta['difficulty']) ? (float)$meta['difficulty'] : 1.0);
        if (!isset($item['laborWaste'])) $item['laborWaste'] = isset($meta['workspace']['laborWaste']) ? (float)$meta['workspace']['laborWaste'] : (isset($meta['laborWaste']) ? (float)$meta['laborWaste'] : null);
        if (!isset($item['factorOverride']) && isset($meta['workspace']['factorOverride'])) $item['factorOverride'] = (float)$meta['workspace']['factorOverride'];
        if (!isset($item['ratio']) && isset($meta['workspace']['ratio'])) $item['ratio'] = (float)$meta['workspace']['ratio'];
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
    if (!array_key_exists('groups', $snapshot) || !is_array($snapshot['groups'])) {
        $recoveredGroups = pew_relational_groups($pdo, (int)$estimate['id']);
        if ($recoveredGroups) $snapshot['groups'] = $recoveredGroups;
    }
    if ((empty($snapshot['settings']) || !is_array($snapshot['settings'])) && !empty($estimate['settings_json'])) {
        $recoveredSettings = pew_decode($estimate['settings_json']);
        if ($recoveredSettings) $snapshot['settings'] = $recoveredSettings;
    }
    if ((empty($snapshot['notes']) || !is_array($snapshot['notes'])) && !empty($estimate['notes_json'])) {
        $recoveredNotes = pew_decode($estimate['notes_json']);
        if ($recoveredNotes) $snapshot['notes'] = $recoveredNotes;
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
function pew_flatten_workspace_items(array $items) {
    $flat = array();
    foreach ($items as $item) {
        if (!is_array($item)) continue;
        $flat[] = $item;
        $children = isset($item['children']) && is_array($item['children']) ? $item['children'] : array();
        if ($children) $flat = array_merge($flat, pew_flatten_workspace_items($children));
    }
    return $flat;
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
        $items = pew_flatten_workspace_items(isset($group['items']) && is_array($group['items']) ? $group['items'] : array());
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

function pew_extract_estimate_summary(array $summary, array $estimate) {
    $direct = isset($summary['direct']) && is_array($summary['direct']) ? $summary['direct'] : array();
    $subtotal = isset($summary['subtotal']) ? pew_num($summary['subtotal'])
        : (isset($direct['totalCost']) ? pew_num($direct['totalCost']) : 0);
    $preTaxMarkup = isset($summary['preTaxMarkup']) ? pew_num($summary['preTaxMarkup'])
        : (isset($summary['preTaxTotal']) ? pew_num($summary['preTaxTotal']) : 0);
    $postTaxMarkup = isset($summary['postTaxMarkup']) ? pew_num($summary['postTaxMarkup'])
        : (isset($summary['postTaxTotal']) ? pew_num($summary['postTaxTotal']) : 0);
    $taxes = isset($summary['taxes']) ? pew_num($summary['taxes'])
        : (isset($summary['totalTax']) ? pew_num($summary['totalTax']) : 0);
    $laborHours = isset($summary['laborHours']) ? pew_num($summary['laborHours'])
        : (isset($direct['adjustedLaborHours']) ? pew_num($direct['adjustedLaborHours']) : 0);
    $total = isset($summary['estimateTotal']) ? pew_num($summary['estimateTotal'])
        : (isset($summary['total']) ? pew_num($summary['total'])
        : (isset($estimate['estimateTotal']) ? pew_num($estimate['estimateTotal'])
        : (isset($estimate['totalSales']) ? pew_num($estimate['totalSales']) : 0)));
    return array(
        'subtotal' => $subtotal,
        'markup' => $preTaxMarkup + $postTaxMarkup,
        'taxes' => $taxes,
        'total' => $total,
        'laborHours' => $laborHours,
    );
}

function pew_resolve_estimate_total(array $estimateRow, array $snapshot) {
    if (isset($snapshot['estimateSummary']) && is_array($snapshot['estimateSummary'])) {
        if (array_key_exists('estimateTotal', $snapshot['estimateSummary'])) {
            return array(true, pew_num($snapshot['estimateSummary']['estimateTotal']));
        }
        if (array_key_exists('total', $snapshot['estimateSummary'])) {
            return array(true, pew_num($snapshot['estimateSummary']['total']));
        }
    }
    if (array_key_exists('estimateTotal', $snapshot)) {
        return array(true, pew_num($snapshot['estimateTotal']));
    }
    if (array_key_exists('totalSales', $snapshot)) {
        return array(true, pew_num($snapshot['totalSales']));
    }
    $dbTotal = pew_num(isset($estimateRow['total_cost']) ? $estimateRow['total_cost'] : 0);
    if ($dbTotal > 0) return array(true, $dbTotal);
    return array(false, 0.0);
}

function pew_sync_project_primary_estimate_metadata(PDO $pdo, $projectId) {
    $stmt = $pdo->prepare('SELECT metadata_json FROM projects WHERE id=? AND deleted_at IS NULL LIMIT 1');
    $stmt->execute(array($projectId));
    $rawMeta = $stmt->fetchColumn();
    $meta = is_string($rawMeta) ? pew_decode($rawMeta) : array();
    if (!is_array($meta)) $meta = array();
    $previousPrimaryId = isset($meta['primary_estimate_id']) ? (string)$meta['primary_estimate_id'] : '';

    $estStmt = $pdo->prepare(
        'SELECT e.id, e.total_cost, e.updated_at, ws.client_estimate_id, ws.state_json, ws.updated_at AS ws_updated_at
         FROM estimates e
         LEFT JOIN estimate_workspace_states ws ON ws.estimate_id = e.id
         WHERE e.project_id = ? AND e.deleted_at IS NULL
         ORDER BY e.id ASC'
    );
    $estStmt->execute(array($projectId));
    $rows = $estStmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) return;

    $primaryCandidates = array();
    $metaMatch = null;
    foreach ($rows as $idx => $row) {
        $snap = isset($row['state_json']) ? pew_decode($row['state_json']) : array();
        if (!is_array($snap)) $snap = array();
        $rows[$idx]['_snapshot'] = $snap;
        $cid = !empty($row['client_estimate_id']) ? (string)$row['client_estimate_id'] : (string)$row['id'];
        $rows[$idx]['_client_id'] = $cid;
        if (!empty($snap['is_primary']) || !empty($snap['isPrimary'])) {
            $primaryCandidates[] = $rows[$idx];
        }
        if ($previousPrimaryId !== '' && ($cid === $previousPrimaryId || (string)$row['id'] === $previousPrimaryId)) {
            $metaMatch = $rows[$idx];
        }
    }

    $chosen = null;
    if (count($primaryCandidates) === 1) {
        $chosen = $primaryCandidates[0];
    } elseif (count($primaryCandidates) > 1) {
        usort($primaryCandidates, function ($a, $b) {
            $ta = (string)($a['ws_updated_at'] ?: $a['updated_at'] ?: '');
            $tb = (string)($b['ws_updated_at'] ?: $b['updated_at'] ?: '');
            $cmp = strcmp($tb, $ta);
            return $cmp !== 0 ? $cmp : ((int)$b['id'] - (int)$a['id']);
        });
        $chosen = $primaryCandidates[0];
    } elseif ($metaMatch) {
        $chosen = $metaMatch;
    } else {
        $chosen = $rows[0];
    }

    $chosenId = $chosen['_client_id'];
    list($hasExplicitTotal, $resolvedTotal) = pew_resolve_estimate_total($chosen, $chosen['_snapshot']);
    $meta['primary_estimate_id'] = $chosenId;
    if ($hasExplicitTotal || ($previousPrimaryId !== '' && $previousPrimaryId !== $chosenId)) {
        $meta['primary_estimate_total'] = $resolvedTotal;
        $meta['primary_quote_value'] = $resolvedTotal;
        $meta['total_sales'] = $resolvedTotal;
        $meta['estimate_total'] = $resolvedTotal;
        $meta['primary_estimate_updated_at'] = gmdate('c');
    }
    $encodedMeta = json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encodedMeta !== false) {
        $upd = $pdo->prepare('UPDATE projects SET metadata_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
        $upd->execute(array($encodedMeta, $projectId));
    }
}

function pew_clone_takeoff_uid($prefix) {
    try {
        return $prefix . '_' . bin2hex(random_bytes(8));
    } catch (Throwable $e) {
        return $prefix . '_' . str_replace('.', '_', uniqid('', true));
    }
}
function pew_clone_takeoff_workspace_for_estimate(PDO $pdo, $projectId, array &$estimate) {
    $sourceKey = pew_text(isset($estimate['cloneTakeoffFromEstimateId']) ? $estimate['cloneTakeoffFromEstimateId'] : '', 191);
    $targetKey = pew_text(isset($estimate['id']) ? $estimate['id'] : '', 191);
    $layerMap = (isset($estimate['cloneTakeoffLayerMap']) && is_array($estimate['cloneTakeoffLayerMap']))
        ? $estimate['cloneTakeoffLayerMap'] : array();
    $groupMap = (isset($estimate['cloneTakeoffGroupMap']) && is_array($estimate['cloneTakeoffGroupMap']))
        ? $estimate['cloneTakeoffGroupMap'] : array();
    $itemMap = (isset($estimate['cloneTakeoffItemMap']) && is_array($estimate['cloneTakeoffItemMap']))
        ? $estimate['cloneTakeoffItemMap'] : array();

    unset($estimate['cloneTakeoffFromEstimateId'], $estimate['cloneTakeoffLayerMap'], $estimate['cloneTakeoffGroupMap'], $estimate['cloneTakeoffItemMap']);

    if ($sourceKey === '' || $targetKey === '' || $sourceKey === $targetKey || $projectId < 1) {
        return;
    }

    if (pew_table_columns($pdo, 'takeoff_estimate_states')) {
        $chk = $pdo->prepare('SELECT 1 FROM takeoff_estimate_states WHERE estimate_key=? AND project_id=? LIMIT 1');
        $chk->execute(array($targetKey, $projectId));
        if ($chk->fetchColumn()) return;
    }

    if (pew_table_columns($pdo, 'takeoff_estimate_scales')) {
        $scaleStmt = $pdo->prepare('SELECT * FROM takeoff_estimate_scales WHERE estimate_key=? AND project_id=?');
        $scaleStmt->execute(array($sourceKey, $projectId));
        foreach ($scaleStmt->fetchAll(PDO::FETCH_ASSOC) as $sc) {
            unset($sc['created_at'], $sc['updated_at']);
            $sc['estimate_key'] = $targetKey;
            $sc['project_id'] = $projectId;
            $cols = array_keys($sc);
            $ins = $pdo->prepare('INSERT IGNORE INTO takeoff_estimate_scales (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')');
            $ins->execute(array_values($sc));
        }
    }

    $dbLayerIdMap = array();
    if (pew_table_columns($pdo, 'takeoff_layers')) {
        $layerStmt = $pdo->prepare('SELECT tl.* FROM takeoff_layers tl LEFT JOIN takeoffs t ON t.id=tl.takeoff_id WHERE tl.estimate_key=? AND (tl.project_id=? OR t.project_id=?) AND tl.deleted_at IS NULL ORDER BY tl.id ASC');
        $layerStmt->execute(array($sourceKey, $projectId, $projectId));
        foreach ($layerStmt->fetchAll(PDO::FETCH_ASSOC) as $ly) {
            $oldDbId = (int)$ly['id'];
            $oldIntKey = (string)(isset($ly['integration_key']) ? $ly['integration_key'] : '');
            $meta = !empty($ly['metadata_json']) ? pew_decode($ly['metadata_json'], array()) : array();
            if (!is_array($meta)) $meta = array();
            $oldProjKey = (string)(isset($meta['project_layer_id']) ? $meta['project_layer_id'] : '');

            $newClientKey = '';
            foreach (array($oldIntKey, $oldProjKey, (string)$oldDbId) as $candidate) {
                if ($candidate !== '' && isset($layerMap[$candidate])) {
                    $newClientKey = (string)$layerMap[$candidate];
                    break;
                }
            }
            if ($newClientKey === '') {
                $newClientKey = pew_clone_takeoff_uid('layer');
                if ($oldIntKey !== '') $layerMap[$oldIntKey] = $newClientKey;
                if ($oldProjKey !== '') $layerMap[$oldProjKey] = $newClientKey;
                $layerMap[(string)$oldDbId] = $newClientKey;
            }

            $meta['estimate_id'] = $targetKey;
            $meta['project_layer_id'] = $newClientKey;
            if (!empty($meta['estimating_group_id']) && isset($groupMap[(string)$meta['estimating_group_id']])) {
                $meta['estimating_group_id'] = (string)$groupMap[(string)$meta['estimating_group_id']];
            }
            if (!empty($meta['estimating_item_id']) && isset($itemMap[(string)$meta['estimating_item_id']])) {
                $meta['estimating_item_id'] = (string)$itemMap[(string)$meta['estimating_item_id']];
            }

            unset($ly['id'], $ly['created_at'], $ly['updated_at'], $ly['deleted_at']);
            $ly['estimate_key'] = $targetKey;
            if (array_key_exists('integration_key', $ly)) $ly['integration_key'] = $newClientKey;
            if (array_key_exists('metadata_json', $ly)) $ly['metadata_json'] = json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (array_key_exists('estimate_item_id', $ly)) $ly['estimate_item_id'] = null;

            $cols = array_keys($ly);
            $ins = $pdo->prepare('INSERT INTO takeoff_layers (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')');
            $ins->execute(array_values($ly));
            $dbLayerIdMap[$oldDbId] = (int)$pdo->lastInsertId();
        }

        if ($dbLayerIdMap && pew_table_columns($pdo, 'takeoff_count_markers')) {
            $oldIds = array_keys($dbLayerIdMap);
            $in = implode(',', array_fill(0, count($oldIds), '?'));
            $mkStmt = $pdo->prepare("SELECT * FROM takeoff_count_markers WHERE layer_id IN ($in) ORDER BY id ASC");
            $mkStmt->execute($oldIds);
            foreach ($mkStmt->fetchAll(PDO::FETCH_ASSOC) as $mk) {
                $oldLayerId = (int)$mk['layer_id'];
                if (empty($dbLayerIdMap[$oldLayerId])) continue;
                unset($mk['id'], $mk['created_at'], $mk['updated_at']);
                $mk['layer_id'] = $dbLayerIdMap[$oldLayerId];
                if (array_key_exists('client_uid', $mk)) $mk['client_uid'] = pew_clone_takeoff_uid('m');
                $cols = array_keys($mk);
                $ins = $pdo->prepare('INSERT INTO takeoff_count_markers (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')');
                $ins->execute(array_values($mk));
            }
        }

        if ($dbLayerIdMap && pew_table_columns($pdo, 'takeoff_linear_segments')) {
            $oldIds = array_keys($dbLayerIdMap);
            $in = implode(',', array_fill(0, count($oldIds), '?'));
            $sgStmt = $pdo->prepare("SELECT * FROM takeoff_linear_segments WHERE layer_id IN ($in) ORDER BY id ASC");
            $sgStmt->execute($oldIds);
            foreach ($sgStmt->fetchAll(PDO::FETCH_ASSOC) as $sg) {
                $oldLayerId = (int)$sg['layer_id'];
                if (empty($dbLayerIdMap[$oldLayerId])) continue;
                unset($sg['id'], $sg['created_at'], $sg['updated_at']);
                $sg['layer_id'] = $dbLayerIdMap[$oldLayerId];
                if (array_key_exists('client_uid', $sg)) $sg['client_uid'] = pew_clone_takeoff_uid('s');
                $cols = array_keys($sg);
                $ins = $pdo->prepare('INSERT INTO takeoff_linear_segments (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')');
                $ins->execute(array_values($sg));
            }
        }
    }

    if (pew_table_columns($pdo, 'takeoff_estimate_states')) {
        $stStmt = $pdo->prepare('SELECT drawing_id, project_id, state_json FROM takeoff_estimate_states WHERE estimate_key=? AND project_id=?');
        $stStmt->execute(array($sourceKey, $projectId));
        $insState = $pdo->prepare('INSERT IGNORE INTO takeoff_estimate_states (estimate_key, drawing_id, project_id, state_json, revision) VALUES (?, ?, ?, ?, 1)');
        foreach ($stStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $snap = pew_decode($row['state_json'], array());
            if (is_array($snap)) {
                if (isset($snap['layers']) && is_array($snap['layers'])) {
                    foreach ($snap['layers'] as &$sLayer) {
                        if (!is_array($sLayer)) continue;
                        $oldKey = (string)(isset($sLayer['client_uid']) ? $sLayer['client_uid'] : (isset($sLayer['id']) ? $sLayer['id'] : ''));
                        $meta = (isset($sLayer['metadata_json']) && is_array($sLayer['metadata_json'])) ? $sLayer['metadata_json'] : array();
                        $metaProjKey = (string)(isset($meta['project_layer_id']) ? $meta['project_layer_id'] : '');
                        $mappedKey = '';
                        foreach (array($oldKey, $metaProjKey, isset($sLayer['id']) ? (string)$sLayer['id'] : '') as $cand) {
                            if ($cand !== '' && isset($layerMap[$cand])) { $mappedKey = (string)$layerMap[$cand]; break; }
                        }
                        if ($mappedKey === '') {
                            $mappedKey = pew_clone_takeoff_uid('layer');
                            if ($oldKey !== '') $layerMap[$oldKey] = $mappedKey;
                            if ($metaProjKey !== '') $layerMap[$metaProjKey] = $mappedKey;
                        }
                        $sLayer['client_uid'] = $mappedKey;
                        $sLayer['integration_key'] = $mappedKey;
                        if (isset($sLayer['id']) && !is_numeric($sLayer['id'])) $sLayer['id'] = $mappedKey;
                        if (isset($sLayer['id']) && is_numeric($sLayer['id']) && isset($dbLayerIdMap[(int)$sLayer['id']])) {
                            $sLayer['id'] = $dbLayerIdMap[(int)$sLayer['id']];
                        }
                        $meta['project_layer_id'] = $mappedKey;
                        $meta['estimate_id'] = $targetKey;
                        if (!empty($meta['estimating_group_id']) && isset($groupMap[(string)$meta['estimating_group_id']])) {
                            $meta['estimating_group_id'] = (string)$groupMap[(string)$meta['estimating_group_id']];
                        }
                        if (!empty($meta['estimating_item_id']) && isset($itemMap[(string)$meta['estimating_item_id']])) {
                            $meta['estimating_item_id'] = (string)$itemMap[(string)$meta['estimating_item_id']];
                        }
                        $sLayer['metadata_json'] = $meta;
                    }
                    unset($sLayer);
                }
                if (isset($snap['markers']) && is_array($snap['markers'])) {
                    foreach ($snap['markers'] as &$mRow) {
                        if (!is_array($mRow)) continue;
                        $mRow['client_uid'] = pew_clone_takeoff_uid('m');
                        $oldLKey = (string)(isset($mRow['layer_client_uid']) ? $mRow['layer_client_uid'] : (isset($mRow['layer_id']) ? $mRow['layer_id'] : ''));
                        if ($oldLKey !== '' && isset($layerMap[$oldLKey])) $mRow['layer_client_uid'] = (string)$layerMap[$oldLKey];
                        $oldLId = pew_int(isset($mRow['layer_id']) ? $mRow['layer_id'] : 0);
                        if ($oldLId > 0 && isset($dbLayerIdMap[$oldLId])) $mRow['layer_id'] = $dbLayerIdMap[$oldLId];
                    }
                    unset($mRow);
                }
                if (isset($snap['segments']) && is_array($snap['segments'])) {
                    foreach ($snap['segments'] as &$sgRow) {
                        if (!is_array($sgRow)) continue;
                        $sgRow['client_uid'] = pew_clone_takeoff_uid('s');
                        $oldLKey = (string)(isset($sgRow['layer_client_uid']) ? $sgRow['layer_client_uid'] : (isset($sgRow['layer_id']) ? $sgRow['layer_id'] : ''));
                        if ($oldLKey !== '' && isset($layerMap[$oldLKey])) $sgRow['layer_client_uid'] = (string)$layerMap[$oldLKey];
                        $oldLId = pew_int(isset($sgRow['layer_id']) ? $sgRow['layer_id'] : 0);
                        if ($oldLId > 0 && isset($dbLayerIdMap[$oldLId])) $sgRow['layer_id'] = $dbLayerIdMap[$oldLId];
                    }
                    unset($sgRow);
                }
                if (isset($snap['summary']) && is_array($snap['summary'])) {
                    foreach ($snap['summary'] as &$sumRow) {
                        if (!is_array($sumRow)) continue;
                        $u = (string)(isset($sumRow['layerUid']) ? $sumRow['layerUid'] : '');
                        if ($u !== '' && isset($layerMap[$u])) $sumRow['layerUid'] = (string)$layerMap[$u];
                    }
                    unset($sumRow);
                }
            }
            $insState->execute(array($targetKey, (int)$row['drawing_id'], $projectId, json_encode($snap, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)));
        }
    }

    // Remap copied item takeoffLayerId references when created without pre-populated Takeoff map
    if ($layerMap && !empty($estimate['groups']) && is_array($estimate['groups'])) {
        foreach ($estimate['groups'] as &$grp) {
            if (empty($grp['items']) || !is_array($grp['items'])) continue;
            foreach ($grp['items'] as &$it) {
                if (!is_array($it)) continue;
                $oldRef = (string)(isset($it['copiedFromTakeoffLayerId']) ? $it['copiedFromTakeoffLayerId'] : '');
                if (empty($it['takeoffLayerId']) && $oldRef !== '' && isset($layerMap[$oldRef])) {
                    $it['takeoffLayerId'] = (string)$layerMap[$oldRef];
                    $it['source_layer_key'] = (string)$layerMap[$oldRef];
                }
            }
            unset($it);
        }
        unset($grp);
    }
}

function pew_save_estimate(PDO $pdo, $projectId, array $estimate, array $summary = array(), $expectedRevision = null) {
    pew_best_effort('clone Takeoff workspace for copied estimate', $pdo, function () use ($pdo, $projectId, &$estimate) {
        pew_clone_takeoff_workspace_for_estimate($pdo, $projectId, $estimate);
    });
    $encoded = json_encode($estimate, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encoded === false || strlen($encoded) > 8 * 1024 * 1024) pew_error('Estimate snapshot is invalid or too large.', 413, 'snapshot_too_large');
    $clientId = pew_text(isset($estimate['id']) ? $estimate['id'] : '', 191);
    if ($clientId === '') pew_error('Every estimate must have an id.', 422, 'invalid_estimate');
    // Local drafts can outlive a deleted/recreated server estimate. Treat a
    // stale dbEstimateId as a cache hint, never as authoritative identity.
    $estimateId = pew_resolve_estimate_id($pdo, $projectId, $clientId,
        pew_int(isset($estimate['dbEstimateId']) ? $estimate['dbEstimateId'] : 0));
    // A historical Estimate refresh creates a new row, so its own revision is
    // necessarily zero. Validate the source row explicitly inside this same
    // transaction to prevent creating a revision from a stale preview. Once
    // the revision exists, its normal optimistic revision check is sufficient.
    if (!$estimateId && isset($estimate['catalogUpdateSourceGuard']) && is_array($estimate['catalogUpdateSourceGuard'])) {
        $guard = $estimate['catalogUpdateSourceGuard'];
        $sourceClientId = pew_text(isset($guard['sourceEstimateId']) ? $guard['sourceEstimateId'] : '', 191);
        $sourceDbHint = pew_int(isset($guard['sourceDbEstimateId']) ? $guard['sourceDbEstimateId'] : 0);
        $sourceEstimateId = $sourceClientId !== ''
            ? pew_resolve_estimate_id($pdo, $projectId, $sourceClientId, $sourceDbHint)
            : $sourceDbHint;
        $sourceRow = $sourceEstimateId > 0 ? pew_state_row($pdo, $sourceEstimateId) : null;
        $expectedSourceRevision = pew_int(isset($guard['sourceServerRevision']) ? $guard['sourceServerRevision'] : -1);
        if (!$sourceRow || (int)$sourceRow['revision'] !== $expectedSourceRevision) {
            throw new PewCatalogUpdateStale(array(
                'sourceEstimateId' => $sourceClientId,
                'sourceDbEstimateId' => $sourceEstimateId ?: $sourceDbHint,
                'expectedRevision' => $expectedSourceRevision,
                'currentRevision' => $sourceRow ? (int)$sourceRow['revision'] : null
            ));
        }
    }
    if (!$estimateId) {
        // Capture the generated id immediately after execute. Some production
        // PDO/MySQL combinations clear lastInsertId after RELEASE SAVEPOINT;
        // reading it after pew_best_effort returned produced id=0, followed by
        // a misleading estimate_not_found 404 and a rolled-back transaction.
        $createdEstimateId = 0;
        $createdExtended = pew_best_effort('extended estimate insert', $pdo, function () use ($pdo, $projectId, $estimate, &$createdEstimateId) {
            $stmt = $pdo->prepare('INSERT INTO estimates (project_id,estimate_number,name,status,currency_code) VALUES (?,?,?,?,?)');
            $stmt->execute(array($projectId, pew_text(isset($estimate['code']) ? $estimate['code'] : '', 100) ?: null,
                pew_text(isset($estimate['name']) ? $estimate['name'] : 'Estimate'), pew_text(isset($estimate['status']) ? $estimate['status'] : 'draft', 50), 'USD'));
            $createdEstimateId = (int)$pdo->lastInsertId();
        });
        if (!$createdExtended) {
            $pdo->prepare('INSERT INTO estimates (project_id,name,status) VALUES (?,?,?)')->execute(array(
                $projectId, pew_text(isset($estimate['name']) ? $estimate['name'] : 'Estimate'),
                pew_text(isset($estimate['status']) ? $estimate['status'] : 'draft', 50)
            ));
            $createdEstimateId = (int)$pdo->lastInsertId();
        }
        if ($createdEstimateId < 1) throw new RuntimeException('Database did not return the created estimate identity.');
        $estimateId = $createdEstimateId;
    }
    $current = pew_state_row($pdo, $estimateId);
    if ($expectedRevision !== null && $current && (int)$expectedRevision !== (int)$current['revision']) {
        $serverEstimate = pew_load_one($pdo, pew_owned_estimate($pdo, $estimateId, $projectId));
        throw new PewRevisionConflict(array(array(
            'id' => $clientId,
            'dbEstimateId' => $estimateId,
            'expectedRevision' => (int)$expectedRevision,
            'currentRevision' => (int)$current['revision'],
            'current' => $serverEstimate
        )));
    }
    if (isset($estimate['estimateSummary']) && is_array($estimate['estimateSummary'])) $summary = $estimate['estimateSummary'];
    $normalizedSummary = pew_extract_estimate_summary($summary, $estimate);
    if (!isset($estimate['estimateTotal'])) $estimate['estimateTotal'] = $normalizedSummary['total'];
    if (!isset($estimate['totalSales'])) $estimate['totalSales'] = $normalizedSummary['total'];
    $reencoded = json_encode($estimate, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($reencoded !== false) $encoded = $reencoded;
    $extendedValues = array(pew_text(isset($estimate['code']) ? $estimate['code'] : '', 100) ?: null, pew_text(isset($estimate['name']) ? $estimate['name'] : 'Estimate'),
        pew_text(isset($estimate['status']) ? $estimate['status'] : 'draft', 50), $normalizedSummary['subtotal'],
        $normalizedSummary['markup'],
        $normalizedSummary['taxes'], $normalizedSummary['total'],
        $normalizedSummary['laborHours'],
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

    // `create` is the stale-browser recovery form of the same atomic save
    // contract. Normalize it here so the established save path remains the
    // single persistence implementation.
    $createByClientIdentity = $action === 'create';
    if ($createByClientIdentity) $action = 'save';
    if ($action === 'save') {
        $pewStage = 'workspace_save';
        pew_method('POST');
        $workspace = isset($body['state']) && is_array($body['state']) ? $body['state'] : null;
        $mode = (isset($body['mode']) && $body['mode'] === 'patch') || !empty($body['partial']) ? 'patch' : 'replace';
        if ($mode === 'patch') {
            $patchRows = isset($body['updates']) && is_array($body['updates'])
                ? $body['updates']
                : ($workspace && isset($workspace['estimates']) && is_array($workspace['estimates']) ? $workspace['estimates'] : array());
            $incoming = array_map(function ($update) {
                return is_array($update) && isset($update['snapshot']) && is_array($update['snapshot'])
                    ? $update['snapshot'] : $update;
            }, $patchRows);
            // Canonical identity order keeps concurrent PATCH requests from
            // acquiring estimate locks in opposite orders.
            usort($incoming, function ($a, $b) {
                return strcmp((string)(is_array($a) && isset($a['id']) ? $a['id'] : ''),
                    (string)(is_array($b) && isset($b['id']) ? $b['id'] : ''));
            });
        } else {
            $incoming = $workspace && isset($workspace['estimates']) && is_array($workspace['estimates'])
                ? $workspace['estimates']
                : (isset($body['estimate']) && is_array($body['estimate']) ? array($body['estimate']) : array());
        }
        if (!$incoming) pew_error('state.estimates is required.', 422, 'invalid_workspace');
        $pdo->beginTransaction();
        $savedEstimates = array();
        $keptIds = array();
        $requestedActiveId = $workspace && isset($workspace['activeEstimateId']) ? (string)$workspace['activeEstimateId'] : '';
        foreach ($incoming as $estimate) {
            if (!is_array($estimate)) pew_error('Invalid estimate in workspace.', 422, 'invalid_estimate');
            // Recovery endpoint for a browser draft whose former numeric row no
            // longer exists. The stable client id remains authoritative; never
            // reuse the stale numeric hint. If another request already created
            // the client id, its revision check below still prevents overwrite.
            if ($createByClientIdentity) $estimate['dbEstimateId'] = null;
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
        if ($mode === 'replace' && $workspace && $keptIds) {
            $marks = implode(',', array_fill(0, count($keptIds), '?'));
            $stmt = $pdo->prepare("UPDATE estimates e INNER JOIN estimate_workspace_states ws ON ws.estimate_id=e.id
                SET e.deleted_at=CURRENT_TIMESTAMP WHERE e.project_id=? AND e.deleted_at IS NULL AND e.id NOT IN ($marks)");
            $stmt->execute(array_merge(array($projectId), $keptIds));
        }
        if (isset($body['project_estimating_table_settings']) && is_array($body['project_estimating_table_settings'])) {
            pew_best_effort('save project estimating table settings metadata', $pdo, function () use ($pdo, $projectId, $body) {
                $stmtMeta = $pdo->prepare('SELECT metadata_json FROM projects WHERE id=? AND deleted_at IS NULL LIMIT 1');
                $stmtMeta->execute(array($projectId));
                $rawMeta = $stmtMeta->fetchColumn();
                $meta = is_string($rawMeta) ? pew_decode($rawMeta) : array();
                if (!is_array($meta)) $meta = array();
                $meta['estimatingTableSettings'] = $body['project_estimating_table_settings'];
                $encodedMeta = json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                if ($encodedMeta !== false) {
                    $pdo->prepare('UPDATE projects SET metadata_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')->execute(array($encodedMeta, $projectId));
                }
            });
        }
        pew_best_effort('sync project primary estimate metadata', $pdo, function () use ($pdo, $projectId) {
            pew_sync_project_primary_estimate_metadata($pdo, $projectId);
        });
        $pdo->commit();
        if ($mode === 'patch') {
            pew_json(array('ok' => true, 'success' => true, 'mode' => 'patch', 'updates' => $savedEstimates,
                'activeEstimateId' => $requestedActiveId !== '' ? $requestedActiveId : null,
                'state' => array('activeEstimateId' => $requestedActiveId !== '' ? $requestedActiveId : null,
                    'estimates' => $savedEstimates)));
        }
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
        $estimateIdHint = pew_int(isset($body['estimate_id']) ? $body['estimate_id'] : 0);
        $clientEstimateIdInput = trim((string)(isset($body['client_estimate_id']) ? $body['client_estimate_id'] : ''));
        $pdo->beginTransaction();
        // Lock the complete project set first so concurrent deletes cannot deadlock
        // by locking different target rows in opposite order.
        $countStmt = $pdo->prepare('SELECT id FROM estimates WHERE project_id=? AND deleted_at IS NULL ORDER BY id ASC FOR UPDATE');
        $countStmt->execute(array($projectId));
        $activeEstimateIds = array_map('intval', $countStmt->fetchAll(PDO::FETCH_COLUMN));
        if (count($activeEstimateIds) <= 1) {
            $pdo->rollBack();
            pew_error('At least one estimate must remain in the project.', 409, 'last_estimate');
        }
        $estimateId = $clientEstimateIdInput !== ''
            ? pew_resolve_estimate_id($pdo, $projectId, $clientEstimateIdInput, $estimateIdHint)
            : (in_array($estimateIdHint, $activeEstimateIds, true) ? $estimateIdHint : 0);
        // Never delete a different estimate merely because a stale client called
        // the target "original". Explicit identities must resolve exactly.
        if ($estimateId <= 0 && !empty($body['delete_original']) && $estimateIdHint <= 0 && $clientEstimateIdInput === '') {
            $estimateId = $activeEstimateIds[0];
        }
        if ($estimateId <= 0 || !in_array($estimateId, $activeEstimateIds, true)) {
            $pdo->rollBack();
            pew_error('Estimate could not be resolved for deletion.', 404, 'estimate_not_found');
        }
        $clientStmt = $pdo->prepare('SELECT client_estimate_id FROM estimate_workspace_states WHERE estimate_id=? AND project_id=? LIMIT 1');
        $clientStmt->execute(array($estimateId, $projectId));
        $clientEstimateId = (string)($clientStmt->fetchColumn() ?: $clientEstimateIdInput);
        $deleteStmt = $pdo->prepare('UPDATE estimates SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=? AND deleted_at IS NULL');
        $deleteStmt->execute(array($estimateId, $projectId));
        if ($deleteStmt->rowCount() !== 1) {
            $pdo->rollBack();
            pew_error('Estimate changed before deletion could be completed.', 409, 'estimate_delete_conflict');
        }
        if ($clientEstimateId !== '') pew_best_effort('delete estimate Takeoff workspace', $pdo, function () use ($pdo, $projectId, $clientEstimateId) {
            $layerStmt = $pdo->prepare('SELECT tl.id FROM takeoff_layers tl INNER JOIN takeoffs t ON t.id=tl.takeoff_id WHERE tl.estimate_key=? AND t.project_id=?');
            $layerStmt->execute(array($clientEstimateId, $projectId));
            $layerIds = $layerStmt->fetchAll(PDO::FETCH_COLUMN);
            if ($layerIds) {
                $marks = implode(',', array_fill(0, count($layerIds), '?'));
                $pdo->prepare("DELETE FROM takeoff_count_markers WHERE layer_id IN ($marks)")->execute($layerIds);
                $pdo->prepare("DELETE FROM takeoff_linear_segments WHERE layer_id IN ($marks)")->execute($layerIds);
                $pdo->prepare("DELETE FROM takeoff_layers WHERE id IN ($marks)")->execute($layerIds);
            }
            $pdo->prepare('DELETE FROM takeoff_estimate_states WHERE estimate_key=? AND project_id=?')->execute(array($clientEstimateId, $projectId));
            $pdo->prepare('DELETE FROM takeoff_estimate_scales WHERE estimate_key=? AND project_id=?')->execute(array($clientEstimateId, $projectId));
        });
        if (isset($body['project_estimating_table_settings']) && is_array($body['project_estimating_table_settings'])) {
            pew_best_effort('save project estimating table settings metadata', $pdo, function () use ($pdo, $projectId, $body) {
                $stmtMeta = $pdo->prepare('SELECT metadata_json FROM projects WHERE id=? AND deleted_at IS NULL LIMIT 1');
                $stmtMeta->execute(array($projectId));
                $rawMeta = $stmtMeta->fetchColumn();
                $meta = is_string($rawMeta) ? pew_decode($rawMeta) : array();
                if (!is_array($meta)) $meta = array();
                $meta['estimatingTableSettings'] = $body['project_estimating_table_settings'];
                $encodedMeta = json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                if ($encodedMeta !== false) {
                    $pdo->prepare('UPDATE projects SET metadata_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')->execute(array($encodedMeta, $projectId));
                }
            });
        }
        pew_best_effort('sync project primary estimate metadata', $pdo, function () use ($pdo, $projectId) {
            pew_sync_project_primary_estimate_metadata($pdo, $projectId);
        });
        $pdo->commit();
        $remainingStmt = $pdo->prepare('SELECT * FROM estimates WHERE project_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC');
        $remainingStmt->execute(array($projectId));
        $remainingEstimates = array();
        foreach ($remainingStmt->fetchAll(PDO::FETCH_ASSOC) as $remainingRow) $remainingEstimates[] = pew_load_one($pdo, $remainingRow);
        $remainingActiveId = $remainingEstimates ? $remainingEstimates[0]['id'] : null;
        foreach ($remainingEstimates as $remainingCandidate) {
            if (!empty($remainingCandidate['isActive'])) { $remainingActiveId = $remainingCandidate['id']; break; }
        }
        pew_json(array('ok' => true, 'success' => true, 'estimateId' => $estimateId,
            'clientEstimateId' => $clientEstimateId,
            'deleted' => array('dbEstimateId' => $estimateId, 'clientEstimateId' => $clientEstimateId),
            'activeEstimateId' => $remainingActiveId,
            'state' => array('activeEstimateId' => $remainingActiveId, 'estimates' => $remainingEstimates)));
    }
    pew_error('Unknown action.', 404, 'unknown_action');
} catch (PewCatalogUpdateStale $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    pew_json(array('ok' => false, 'success' => false, 'error' => array(
        'code' => 'ESTIMATE_CHANGED_SINCE_PREVIEW',
        'message' => 'The source estimate changed after the Cost Catalog preview.',
        'details' => $e->details
    )), 409);
} catch (PewRevisionConflict $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    pew_json(array('ok' => false, 'success' => false, 'error' => array(
        'code' => 'revision_conflict',
        'message' => 'The estimate was changed by another client.',
        'conflicts' => $e->conflicts
    )), 409);
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
