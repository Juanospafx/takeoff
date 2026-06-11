<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/db/connection.php';

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
$action = $_GET['action'] ?? $_POST['action'] ?? $input['action'] ?? '';

function out_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function n($value, float $default = 0.0): float
{
    return is_numeric($value) ? (float)$value : $default;
}

function i($value, int $default = 0): int
{
    return is_numeric($value) ? (int)$value : $default;
}

function json_value($value): ?string
{
    if ($value === null || $value === '') return null;
    if (is_string($value)) {
        json_decode($value, true);
        if (json_last_error() === JSON_ERROR_NONE) return $value;
    }
    $encoded = json_encode($value, JSON_UNESCAPED_SLASHES);
    return $encoded === false ? null : $encoded;
}

function decode_json_fields(array $rows, array $fields): array
{
    foreach ($rows as &$row) {
        foreach ($fields as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = $row[$field] ? json_decode((string)$row[$field], true) : null;
            }
        }
    }
    return $rows;
}

function takeoff_columns(PDO $pdo, string $table): array
{
    try {
        return $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
    } catch (Throwable $e) {
        return [];
    }
}

function takeoff_add_column(PDO $pdo, string $table, string $column, string $sql): void
{
    if (!in_array($column, takeoff_columns($pdo, $table), true)) {
        $pdo->exec($sql);
    }
}

function takeoff_table_exists(PDO $pdo, string $table): bool
{
    try {
        $stmt = $pdo->prepare("SHOW TABLES LIKE ?");
        $stmt->execute([$table]);
        return (bool)$stmt->fetchColumn();
    } catch (Throwable $e) {
        return false;
    }
}

function ensure_takeoff_layer_columns(PDO $pdo): void
{
    takeoff_add_column($pdo, 'takeoff_layers', 'drawing_id', "ALTER TABLE takeoff_layers ADD COLUMN drawing_id BIGINT UNSIGNED NULL");
    takeoff_add_column($pdo, 'takeoff_layers', 'page_number', "ALTER TABLE takeoff_layers ADD COLUMN page_number INT UNSIGNED NOT NULL DEFAULT 1");
    takeoff_add_column($pdo, 'takeoff_layers', 'type', "ALTER TABLE takeoff_layers ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'mixed'");
    takeoff_add_column($pdo, 'takeoff_layers', 'group_name', "ALTER TABLE takeoff_layers ADD COLUMN group_name VARCHAR(191) NULL");
    takeoff_add_column($pdo, 'takeoff_layers', 'takeoff_type', "ALTER TABLE takeoff_layers ADD COLUMN takeoff_type VARCHAR(50) NOT NULL DEFAULT 'count'");
    takeoff_add_column($pdo, 'takeoff_layers', 'unit_of_measure', "ALTER TABLE takeoff_layers ADD COLUMN unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea'");
    takeoff_add_column($pdo, 'takeoff_layers', 'assembly_id', "ALTER TABLE takeoff_layers ADD COLUMN assembly_id BIGINT UNSIGNED NULL");
    takeoff_add_column($pdo, 'takeoff_layers', 'color', "ALTER TABLE takeoff_layers ADD COLUMN color VARCHAR(50) NOT NULL DEFAULT '#2563eb'");
    takeoff_add_column($pdo, 'takeoff_layers', 'symbol', "ALTER TABLE takeoff_layers ADD COLUMN symbol VARCHAR(50) NOT NULL DEFAULT 'circle'");
    takeoff_add_column($pdo, 'takeoff_layers', 'symbol_size', "ALTER TABLE takeoff_layers ADD COLUMN symbol_size VARCHAR(50) NULL");
    takeoff_add_column($pdo, 'takeoff_layers', 'quantity', "ALTER TABLE takeoff_layers ADD COLUMN quantity DECIMAL(18,6) NOT NULL DEFAULT 0");
    takeoff_add_column($pdo, 'takeoff_layers', 'visible', "ALTER TABLE takeoff_layers ADD COLUMN visible TINYINT(1) NOT NULL DEFAULT 1");
    takeoff_add_column($pdo, 'takeoff_layers', 'locked', "ALTER TABLE takeoff_layers ADD COLUMN locked TINYINT(1) NOT NULL DEFAULT 0");
    takeoff_add_column($pdo, 'takeoff_layers', 'tag', "ALTER TABLE takeoff_layers ADD COLUMN tag VARCHAR(100) NULL");
    takeoff_add_column($pdo, 'takeoff_layers', 'estimate_item_id', "ALTER TABLE takeoff_layers ADD COLUMN estimate_item_id BIGINT UNSIGNED NULL");
    takeoff_add_column($pdo, 'takeoff_layers', 'metadata_json', "ALTER TABLE takeoff_layers ADD COLUMN metadata_json JSON NULL");
}

function ensure_estimate_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS estimates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        project_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(191) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        currency_code CHAR(3) NOT NULL DEFAULT 'USD',
        subtotal_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
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
        is_quantity_locked_from_takeoff TINYINT(1) NOT NULL DEFAULT 0,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        group_name VARCHAR(191) NULL,
        cost_type VARCHAR(100) NULL,
        quantity DECIMAL(18,6) NOT NULL DEFAULT 0,
        unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'ea',
        unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        unit_labor_time DECIMAL(18,4) NOT NULL DEFAULT 0,
        labor_hours DECIMAL(18,4) NOT NULL DEFAULT 0,
        material_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        labor_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        waste_percentage DECIMAL(9,4) NOT NULL DEFAULT 0,
        markup_percent DECIMAL(9,4) NOT NULL DEFAULT 0,
        taxable TINYINT(1) NOT NULL DEFAULT 1,
        subtotal_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        total_cost DECIMAL(18,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_estimate_items_estimate (estimate_id),
        KEY idx_estimate_items_takeoff_layer (takeoff_layer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    foreach ([
        'takeoff_layer_id' => "ALTER TABLE estimate_items ADD COLUMN takeoff_layer_id BIGINT UNSIGNED NULL",
        'catalog_item_id' => "ALTER TABLE estimate_items ADD COLUMN catalog_item_id BIGINT UNSIGNED NULL",
        'source_type' => "ALTER TABLE estimate_items ADD COLUMN source_type VARCHAR(50) NOT NULL DEFAULT 'manual'",
        'is_quantity_locked_from_takeoff' => "ALTER TABLE estimate_items ADD COLUMN is_quantity_locked_from_takeoff TINYINT(1) NOT NULL DEFAULT 0",
        'group_name' => "ALTER TABLE estimate_items ADD COLUMN group_name VARCHAR(191) NULL",
        'unit_labor_time' => "ALTER TABLE estimate_items ADD COLUMN unit_labor_time DECIMAL(18,4) NOT NULL DEFAULT 0",
        'material_cost' => "ALTER TABLE estimate_items ADD COLUMN material_cost DECIMAL(18,4) NOT NULL DEFAULT 0",
        'subtotal_cost' => "ALTER TABLE estimate_items ADD COLUMN subtotal_cost DECIMAL(18,4) NOT NULL DEFAULT 0",
    ] as $column => $sql) {
        takeoff_add_column($pdo, 'estimate_items', $column, $sql);
    }
}

function catalog_payload(PDO $pdo): array
{
    $catalogColumns = takeoff_columns($pdo, 'catalogs');
    $catalogWhere = in_array('deleted_at', $catalogColumns, true) ? "WHERE deleted_at IS NULL" : "";
    $catalogs = takeoff_table_exists($pdo, 'catalogs')
        ? $pdo->query("SELECT * FROM catalogs $catalogWhere ORDER BY name")->fetchAll(PDO::FETCH_ASSOC)
        : [];
    $groupColumns = takeoff_columns($pdo, 'catalog_groups');
    $groupWhere = in_array('deleted_at', $groupColumns, true) ? "WHERE g.deleted_at IS NULL" : "";
    $categories = takeoff_table_exists($pdo, 'catalog_groups')
        ? $pdo->query("SELECT g.*, c.name AS catalog_name FROM catalog_groups g LEFT JOIN catalogs c ON c.id = g.catalog_id $groupWhere ORDER BY c.name, g.name")->fetchAll(PDO::FETCH_ASSOC)
        : (takeoff_table_exists($pdo, 'catalog_categories') ? $pdo->query("SELECT * FROM catalog_categories ORDER BY name")->fetchAll(PDO::FETCH_ASSOC) : []);
    $itemColumns = takeoff_columns($pdo, 'catalog_items');
    $itemDeleted = in_array('deleted_at', $itemColumns, true) ? "AND ci.deleted_at IS NULL" : "";
    $itemActive = in_array('active', $itemColumns, true) ? "ci.active = 1" : "1 = 1";
    $hasGroups = takeoff_table_exists($pdo, 'catalog_groups') && in_array('catalog_group_id', $itemColumns, true);
    $groupJoin = $hasGroups ? "LEFT JOIN catalog_groups g ON g.id = ci.catalog_group_id" : "";
    $groupNameSelect = $hasGroups ? "g.name AS group_name" : "NULL AS group_name";
    $groupOrder = $hasGroups ? "g.name," : "";
    $items = takeoff_table_exists($pdo, 'catalog_items')
        ? $pdo->query(
            "SELECT ci.*, c.name AS catalog_name, $groupNameSelect
             FROM catalog_items ci
             LEFT JOIN catalogs c ON c.id = ci.catalog_id
             $groupJoin
             WHERE $itemActive $itemDeleted
             ORDER BY c.name, $groupOrder ci.name"
        )->fetchAll(PDO::FETCH_ASSOC)
        : [];
    return [
        'catalogs' => $catalogs,
        'categories' => $categories,
        'groups' => $categories,
        'items' => decode_json_fields($items, ['tags', 'attributes_json']),
    ];
}

function assemblies_payload(PDO $pdo): array
{
    if (takeoff_table_exists($pdo, 'assemblies')) {
        $assemblies = $pdo->query("SELECT * FROM assemblies WHERE active = 1 ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
        $items = takeoff_table_exists($pdo, 'assembly_items') ? $pdo->query(
            "SELECT ai.*, ci.name AS catalog_item_name, ci.unit_of_measure, ci.unit_cost, ci.material_cost, ci.labor_cost, ci.labor_hours
             FROM assembly_items ai
             JOIN catalog_items ci ON ci.id = ai.catalog_item_id
             ORDER BY ai.assembly_id, ai.id"
        )->fetchAll(PDO::FETCH_ASSOC) : [];
        return ['assemblies' => $assemblies, 'items' => $items];
    }

    $assemblies = takeoff_table_exists($pdo, 'catalog_items')
        ? $pdo->query("SELECT * FROM catalog_items WHERE active = 1 AND deleted_at IS NULL AND item_type = 'assembly' ORDER BY name")->fetchAll(PDO::FETCH_ASSOC)
        : [];
    $items = takeoff_table_exists($pdo, 'assembly_parts') ? $pdo->query(
        "SELECT ap.*, ap.assembly_catalog_item_id AS assembly_id, ap.part_catalog_item_id AS catalog_item_id,
                ci.name AS catalog_item_name, ci.unit_of_measure, ci.unit_cost, ci.material_cost, ci.labor_cost, ci.labor_hours
         FROM assembly_parts ap
         JOIN catalog_items ci ON ci.id = ap.part_catalog_item_id
         WHERE ap.deleted_at IS NULL
         ORDER BY ap.assembly_catalog_item_id, ap.id"
    )->fetchAll(PDO::FETCH_ASSOC) : [];
    return ['assemblies' => $assemblies, 'items' => $items];
}

function project_id_for_file(PDO $pdo, int $fileId, int $fallback = 0): int
{
    if ($fallback > 0) return $fallback;
    if (!takeoff_table_exists($pdo, 'files')) return 1;
    $stmt = $pdo->prepare("SELECT project_id FROM files WHERE id = ?");
    $stmt->execute([$fileId]);
    return (int)($stmt->fetchColumn() ?: 1);
}

function ensure_project_estimate(PDO $pdo, int $projectId): int
{
    $stmt = $pdo->prepare("SELECT id FROM estimates WHERE project_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1");
    $stmt->execute([$projectId]);
    $id = (int)$stmt->fetchColumn();
    if ($id > 0) return $id;
    $stmt = $pdo->prepare("INSERT INTO estimates (project_id, name, status, currency_code) VALUES (?, ?, 'draft', 'USD')");
    $stmt->execute([$projectId, 'Takeoff Estimate']);
    return (int)$pdo->lastInsertId();
}

function sync_estimate_items(PDO $pdo, int $estimateId, array $summary, array $layerMap): void
{
    if (!$summary) return;
    $insert = $pdo->prepare(
        "INSERT INTO estimate_items
         (estimate_id, takeoff_layer_id, catalog_item_id, source_type, is_quantity_locked_from_takeoff, name, group_name, quantity, unit_of_measure, unit_cost, unit_labor_time, labor_hours, material_cost, labor_cost, subtotal_cost, total_cost)
         VALUES (?, ?, ?, 'takeoff', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $update = $pdo->prepare(
        "UPDATE estimate_items SET catalog_item_id = ?, source_type = 'takeoff', is_quantity_locked_from_takeoff = 1, name = ?, group_name = ?, quantity = ?, unit_of_measure = ?, unit_cost = ?, unit_labor_time = ?, labor_hours = ?, material_cost = ?, labor_cost = ?, subtotal_cost = ?, total_cost = ?, deleted_at = NULL WHERE estimate_id = ? AND takeoff_layer_id = ?"
    );
    foreach ($summary as $row) {
        if (!is_array($row)) continue;
        $clientUid = (string)($row['layerUid'] ?? '');
        $layerId = $layerMap[$clientUid] ?? 0;
        if ($layerId <= 0) continue;
        $qty = n($row['quantity'] ?? 0);
        $unitCost = n($row['unitCost'] ?? 0);
        $laborHours = n($row['laborHours'] ?? 0);
        $material = n($row['material'] ?? ($qty * $unitCost));
        $labor = n($row['labor'] ?? 0);
        $total = n($row['total'] ?? ($material + $labor));
        $common = [
            !empty($row['itemId']) ? (int)$row['itemId'] : null,
            trim((string)($row['item'] ?? 'Takeoff Item')) ?: 'Takeoff Item',
            $row['group'] ?? null,
            $qty,
            $row['unit'] ?? 'ea',
            $unitCost,
            $qty > 0 ? $laborHours / $qty : 0,
            $laborHours,
            $material,
            $labor,
            $material + $labor,
            $total,
        ];
        $exists = $pdo->prepare("SELECT id FROM estimate_items WHERE estimate_id = ? AND takeoff_layer_id = ? LIMIT 1");
        $exists->execute([$estimateId, $layerId]);
        if ($exists->fetchColumn()) {
            $update->execute(array_merge($common, [$estimateId, $layerId]));
        } else {
            $insert->execute(array_merge([$estimateId, $layerId], $common));
        }
    }
    $pdo->prepare("UPDATE estimates SET subtotal_cost = (SELECT COALESCE(SUM(subtotal_cost),0) FROM estimate_items WHERE estimate_id = ? AND deleted_at IS NULL), total_cost = (SELECT COALESCE(SUM(total_cost),0) FROM estimate_items WHERE estimate_id = ? AND deleted_at IS NULL) WHERE id = ?")
        ->execute([$estimateId, $estimateId, $estimateId]);
}

function state_payload(PDO $pdo, int $drawingId): array
{
    $stmt = $pdo->prepare("SELECT * FROM takeoff_layers WHERE drawing_id = ? ORDER BY page_number, id");
    $stmt->execute([$drawingId]);
    $layers = decode_json_fields($stmt->fetchAll(PDO::FETCH_ASSOC), ['metadata_json']);

    $markers = [];
    $segments = [];
    if ($layers) {
        $ids = array_column($layers, 'id');
        $in = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare("SELECT * FROM takeoff_count_markers WHERE layer_id IN ($in) ORDER BY id");
        $stmt->execute($ids);
        $markers = decode_json_fields($stmt->fetchAll(PDO::FETCH_ASSOC), ['metadata_json']);

        $stmt = $pdo->prepare("SELECT * FROM takeoff_linear_segments WHERE layer_id IN ($in) ORDER BY id");
        $stmt->execute($ids);
        $segments = decode_json_fields($stmt->fetchAll(PDO::FETCH_ASSOC), ['points_json', 'metadata_json']);
    }

    $stmt = $pdo->prepare("SELECT summary_json FROM takeoff_measurement_summaries WHERE drawing_id = ? ORDER BY created_at DESC LIMIT 1");
    $stmt->execute([$drawingId]);
    $summary = $stmt->fetchColumn();

    return [
        'layers' => $layers,
        'markers' => $markers,
        'segments' => $segments,
        'summary' => $summary ? json_decode((string)$summary, true) : [],
    ];
}

try {
    ensure_takeoff_layer_columns($pdo);
    ensure_estimate_schema($pdo);

    switch ($action) {
        case 'bootstrap':
            out_json([
                'status' => 'success',
                'catalog' => catalog_payload($pdo),
                'assemblies' => assemblies_payload($pdo),
            ]);

        case 'state':
            $drawingId = i($_GET['drawing_id'] ?? $input['drawing_id'] ?? 0);
            if ($drawingId <= 0) out_json(['status' => 'error', 'msg' => 'drawing_id is required'], 422);
            out_json(['status' => 'success', 'data' => state_payload($pdo, $drawingId)]);

        case 'save_state':
            $drawingId = i($input['drawing_id'] ?? 0);
            if ($drawingId <= 0) out_json(['status' => 'error', 'msg' => 'drawing_id is required'], 422);
            $projectId = project_id_for_file($pdo, $drawingId, i($input['project_id'] ?? 0));
            $layers = is_array($input['layers'] ?? null) ? $input['layers'] : [];
            $markers = is_array($input['markers'] ?? null) ? $input['markers'] : [];
            $segments = is_array($input['segments'] ?? null) ? $input['segments'] : [];
            $summary = is_array($input['summary'] ?? null) ? $input['summary'] : [];

            $pdo->beginTransaction();
            $old = $pdo->prepare("SELECT id FROM takeoff_layers WHERE drawing_id = ?");
            $old->execute([$drawingId]);
            $oldIds = $old->fetchAll(PDO::FETCH_COLUMN);
            if ($oldIds) {
                $in = implode(',', array_fill(0, count($oldIds), '?'));
                $pdo->prepare("DELETE FROM takeoff_count_markers WHERE layer_id IN ($in)")->execute($oldIds);
                $pdo->prepare("DELETE FROM takeoff_linear_segments WHERE layer_id IN ($in)")->execute($oldIds);
                $pdo->prepare("UPDATE estimate_items SET deleted_at = CURRENT_TIMESTAMP WHERE source_type = 'takeoff' AND takeoff_layer_id IN ($in)")->execute($oldIds);
                $pdo->prepare("DELETE FROM takeoff_layers WHERE id IN ($in)")->execute($oldIds);
            }

            $layerMap = [];
            $layerStmt = $pdo->prepare(
                "INSERT INTO takeoff_layers
                 (drawing_id, page_number, name, type, takeoff_type, unit_of_measure, group_name, catalog_item_id, assembly_id, color, symbol, symbol_size, quantity, visible, locked, tag, estimate_item_id, metadata_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            foreach ($layers as $layer) {
                if (!is_array($layer)) continue;
                $layerClientId = (string)($layer['client_uid'] ?? $layer['id'] ?? '');
                $layerQty = 0.0;
                foreach ($markers as $markerRow) {
                    if ((string)($markerRow['layer_client_uid'] ?? $markerRow['layer_id'] ?? '') === $layerClientId) {
                        $layerQty += n($markerRow['quantity'] ?? $markerRow['multiplier'] ?? 1);
                    }
                }
                foreach ($segments as $segmentRow) {
                    if ((string)($segmentRow['layer_client_uid'] ?? $segmentRow['layer_id'] ?? '') === $layerClientId) {
                        $layerQty += n($segmentRow['total_length'] ?? $segmentRow['measured_length'] ?? 0);
                    }
                }
                $layerStmt->execute([
                    $drawingId,
                    i($layer['page_number'] ?? 1, 1),
                    trim((string)($layer['name'] ?? 'Takeoff Layer')) ?: 'Takeoff Layer',
                    $layer['type'] ?? 'mixed',
                    $layer['takeoff_type'] ?? $layer['type'] ?? 'count',
                    $layer['unit_of_measure'] ?? (($layer['takeoff_type'] ?? $layer['type'] ?? '') === 'linear' ? 'ft' : 'ea'),
                    $layer['group_name'] ?? $layer['tag'] ?? null,
                    !empty($layer['catalog_item_id']) ? (int)$layer['catalog_item_id'] : null,
                    !empty($layer['assembly_id']) ? (int)$layer['assembly_id'] : null,
                    $layer['color'] ?? '#2563eb',
                    $layer['symbol'] ?? 'circle',
                    $layer['symbol_size'] ?? null,
                    $layerQty,
                    !empty($layer['visible']) ? 1 : 0,
                    !empty($layer['locked']) ? 1 : 0,
                    $layer['tag'] ?? null,
                    !empty($layer['estimate_item_id']) && is_numeric($layer['estimate_item_id']) ? (int)$layer['estimate_item_id'] : null,
                    json_value($layer['metadata_json'] ?? null),
                ]);
                $clientId = (string)($layer['client_uid'] ?? $layer['id'] ?? '');
                if ($clientId !== '') $layerMap[$clientId] = (int)$pdo->lastInsertId();
            }

            $markerStmt = $pdo->prepare(
                "INSERT INTO takeoff_count_markers
                 (client_uid, layer_id, catalog_item_id, assembly_id, page_number, x, y, symbol, color, label, multiplier, quantity, notes, metadata_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            foreach ($markers as $marker) {
                if (!is_array($marker)) continue;
                $layerKey = (string)($marker['layer_client_uid'] ?? $marker['layer_id'] ?? '');
                $layerId = $layerMap[$layerKey] ?? i($marker['layer_id'] ?? 0);
                if ($layerId <= 0) continue;
                $markerStmt->execute([
                    $marker['client_uid'] ?? null,
                    $layerId,
                    !empty($marker['catalog_item_id']) ? (int)$marker['catalog_item_id'] : null,
                    !empty($marker['assembly_id']) ? (int)$marker['assembly_id'] : null,
                    i($marker['page_number'] ?? 1, 1),
                    n($marker['x'] ?? 0),
                    n($marker['y'] ?? 0),
                    $marker['symbol'] ?? 'circle',
                    $marker['color'] ?? '#2563eb',
                    $marker['label'] ?? null,
                    n($marker['multiplier'] ?? 1, 1),
                    n($marker['quantity'] ?? 1, 1),
                    $marker['notes'] ?? null,
                    json_value($marker['metadata_json'] ?? null),
                ]);
            }

            $segmentStmt = $pdo->prepare(
                "INSERT INTO takeoff_linear_segments
                 (client_uid, layer_id, catalog_item_id, assembly_id, page_number, points_json, measured_length, multiplier, total_length, unit, color, stroke_width, label, metadata_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            foreach ($segments as $segment) {
                if (!is_array($segment)) continue;
                $layerKey = (string)($segment['layer_client_uid'] ?? $segment['layer_id'] ?? '');
                $layerId = $layerMap[$layerKey] ?? i($segment['layer_id'] ?? 0);
                if ($layerId <= 0) continue;
                $segmentStmt->execute([
                    $segment['client_uid'] ?? null,
                    $layerId,
                    !empty($segment['catalog_item_id']) ? (int)$segment['catalog_item_id'] : null,
                    !empty($segment['assembly_id']) ? (int)$segment['assembly_id'] : null,
                    i($segment['page_number'] ?? 1, 1),
                    json_value($segment['points_json'] ?? []),
                    n($segment['measured_length'] ?? 0),
                    n($segment['multiplier'] ?? 1, 1),
                    n($segment['total_length'] ?? 0),
                    $segment['unit'] ?? 'ft',
                    $segment['color'] ?? '#2563eb',
                    n($segment['stroke_width'] ?? 4, 4),
                    $segment['label'] ?? null,
                    json_value($segment['metadata_json'] ?? null),
                ]);
            }

            $stmt = $pdo->prepare("INSERT INTO takeoff_measurement_summaries (drawing_id, summary_json) VALUES (?, ?)");
            $stmt->execute([$drawingId, json_value($summary) ?? '[]']);
            $estimateId = ensure_project_estimate($pdo, $projectId);
            sync_estimate_items($pdo, $estimateId, $summary, $layerMap);
            $pdo->commit();
            out_json(['status' => 'success', 'data' => state_payload($pdo, $drawingId)]);

        case 'save_catalog_item':
            $item = is_array($input['item'] ?? null) ? $input['item'] : $input;
            $id = i($item['id'] ?? 0);
            if (trim((string)($item['name'] ?? '')) === '') out_json(['status' => 'error', 'msg' => 'name is required'], 422);
            if ($id > 0) {
                $stmt = $pdo->prepare(
                    "UPDATE catalog_items SET catalog_id=?, category_id=?, name=?, description=?, sku=?, item_type=?, cost_type=?,
                     unit_of_measure=?, unit_cost=?, material_cost=?, labor_cost=?, equipment_cost=?, subcontractor_cost=?,
                     labor_hours=?, labor_rate=?, markup=?, waste_factor=?, size=?, diameter=?, trade_size=?, thickness=?,
                     gauge=?, material=?, color=?, symbol=?, cost_code=?, masterformat=?, uniformat=?, attachment_url=?,
                     tags=?, attributes_json=?, active=? WHERE id=?"
                );
                $stmt->execute([
                    i($item['catalog_id'] ?? 1, 1), !empty($item['category_id']) ? (int)$item['category_id'] : null,
                    trim((string)$item['name']), $item['description'] ?? null, $item['sku'] ?? null, $item['item_type'] ?? 'Part',
                    $item['cost_type'] ?? null, $item['unit_of_measure'] ?? 'ea', n($item['unit_cost'] ?? 0),
                    n($item['material_cost'] ?? 0), n($item['labor_cost'] ?? 0), n($item['equipment_cost'] ?? 0),
                    n($item['subcontractor_cost'] ?? 0), n($item['labor_hours'] ?? 0), n($item['labor_rate'] ?? 0),
                    n($item['markup'] ?? 0), n($item['waste_factor'] ?? 0), $item['size'] ?? null, $item['diameter'] ?? null,
                    $item['trade_size'] ?? null, $item['thickness'] ?? null, $item['gauge'] ?? null, $item['material'] ?? null,
                    $item['color'] ?? '#2563eb', $item['symbol'] ?? 'circle', $item['cost_code'] ?? null,
                    $item['masterformat'] ?? null, $item['uniformat'] ?? null, $item['attachment_url'] ?? null,
                    json_value($item['tags'] ?? null), json_value($item['attributes_json'] ?? null), !empty($item['active']) ? 1 : 0,
                    $id,
                ]);
            } else {
                $stmt = $pdo->prepare(
                    "INSERT INTO catalog_items
                     (catalog_id, category_id, name, description, sku, item_type, cost_type, unit_of_measure, unit_cost,
                      material_cost, labor_cost, equipment_cost, subcontractor_cost, labor_hours, labor_rate, markup,
                      waste_factor, size, diameter, trade_size, thickness, gauge, material, color, symbol, cost_code,
                      masterformat, uniformat, attachment_url, tags, attributes_json, active)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                );
                $stmt->execute([
                    i($item['catalog_id'] ?? 1, 1), !empty($item['category_id']) ? (int)$item['category_id'] : null,
                    trim((string)$item['name']), $item['description'] ?? null, $item['sku'] ?? null, $item['item_type'] ?? 'Part',
                    $item['cost_type'] ?? null, $item['unit_of_measure'] ?? 'ea', n($item['unit_cost'] ?? 0),
                    n($item['material_cost'] ?? 0), n($item['labor_cost'] ?? 0), n($item['equipment_cost'] ?? 0),
                    n($item['subcontractor_cost'] ?? 0), n($item['labor_hours'] ?? 0), n($item['labor_rate'] ?? 0),
                    n($item['markup'] ?? 0), n($item['waste_factor'] ?? 0), $item['size'] ?? null, $item['diameter'] ?? null,
                    $item['trade_size'] ?? null, $item['thickness'] ?? null, $item['gauge'] ?? null, $item['material'] ?? null,
                    $item['color'] ?? '#2563eb', $item['symbol'] ?? 'circle', $item['cost_code'] ?? null,
                    $item['masterformat'] ?? null, $item['uniformat'] ?? null, $item['attachment_url'] ?? null,
                    json_value($item['tags'] ?? null), json_value($item['attributes_json'] ?? null), !empty($item['active']) ? 1 : 0,
                ]);
                $id = (int)$pdo->lastInsertId();
            }
            out_json(['status' => 'success', 'id' => $id, 'catalog' => catalog_payload($pdo)]);

        case 'delete_catalog_item':
            $id = i($input['id'] ?? $_POST['id'] ?? 0);
            if ($id <= 0) out_json(['status' => 'error', 'msg' => 'id is required'], 422);
            $stmt = $pdo->prepare("UPDATE catalog_items SET active = 0 WHERE id = ?");
            $stmt->execute([$id]);
            out_json(['status' => 'success']);

        case 'save_assembly':
            $assembly = is_array($input['assembly'] ?? null) ? $input['assembly'] : $input;
            $components = is_array($assembly['items'] ?? null) ? $assembly['items'] : [];
            $id = i($assembly['id'] ?? 0);
            if (trim((string)($assembly['name'] ?? '')) === '') out_json(['status' => 'error', 'msg' => 'name is required'], 422);
            $pdo->beginTransaction();
            if ($id > 0) {
                $stmt = $pdo->prepare("UPDATE assemblies SET name=?, description=?, unit_of_measure=?, override_cost=?, active=? WHERE id=?");
                $stmt->execute([
                    trim((string)$assembly['name']), $assembly['description'] ?? null, $assembly['unit_of_measure'] ?? 'ea',
                    ($assembly['override_cost'] ?? '') === '' ? null : n($assembly['override_cost']), !empty($assembly['active']) ? 1 : 0, $id,
                ]);
                $pdo->prepare("DELETE FROM assembly_items WHERE assembly_id = ?")->execute([$id]);
            } else {
                $stmt = $pdo->prepare("INSERT INTO assemblies (name, description, unit_of_measure, override_cost, active) VALUES (?, ?, ?, ?, ?)");
                $stmt->execute([
                    trim((string)$assembly['name']), $assembly['description'] ?? null, $assembly['unit_of_measure'] ?? 'ea',
                    ($assembly['override_cost'] ?? '') === '' ? null : n($assembly['override_cost']), !empty($assembly['active']) ? 1 : 0,
                ]);
                $id = (int)$pdo->lastInsertId();
            }
            $stmt = $pdo->prepare(
                "INSERT INTO assembly_items (assembly_id, catalog_item_id, quantity, ratio_type, spacing_value, waste_factor, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            );
            foreach ($components as $component) {
                if (!is_array($component) || empty($component['catalog_item_id'])) continue;
                $stmt->execute([
                    $id,
                    (int)$component['catalog_item_id'],
                    n($component['quantity'] ?? 1, 1),
                    $component['ratio_type'] ?? 'per_unit',
                    ($component['spacing_value'] ?? '') === '' ? null : n($component['spacing_value']),
                    n($component['waste_factor'] ?? 0),
                    $component['notes'] ?? null,
                ]);
            }
            $pdo->commit();
            out_json(['status' => 'success', 'id' => $id, 'assemblies' => assemblies_payload($pdo)]);

        case 'delete_assembly':
            $id = i($input['id'] ?? $_POST['id'] ?? 0);
            if ($id <= 0) out_json(['status' => 'error', 'msg' => 'id is required'], 422);
            $stmt = $pdo->prepare("UPDATE assemblies SET active = 0 WHERE id = ?");
            $stmt->execute([$id]);
            out_json(['status' => 'success']);

        default:
            out_json(['status' => 'error', 'msg' => 'Invalid action'], 404);
    }
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    out_json(['status' => 'error', 'msg' => $e->getMessage()], 500);
}
