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

function catalog_payload(PDO $pdo): array
{
    $catalogs = $pdo->query("SELECT * FROM catalogs ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    $categories = $pdo->query("SELECT * FROM catalog_categories ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    $items = $pdo->query("SELECT * FROM catalog_items WHERE active = 1 ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    return [
        'catalogs' => $catalogs,
        'categories' => $categories,
        'items' => decode_json_fields($items, ['tags', 'attributes_json']),
    ];
}

function assemblies_payload(PDO $pdo): array
{
    $assemblies = $pdo->query("SELECT * FROM assemblies WHERE active = 1 ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    $items = $pdo->query(
        "SELECT ai.*, ci.name AS catalog_item_name, ci.unit_of_measure, ci.unit_cost, ci.material_cost, ci.labor_cost, ci.labor_hours
         FROM assembly_items ai
         JOIN catalog_items ci ON ci.id = ai.catalog_item_id
         ORDER BY ai.assembly_id, ai.id"
    )->fetchAll(PDO::FETCH_ASSOC);
    return ['assemblies' => $assemblies, 'items' => $items];
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
                $pdo->prepare("DELETE FROM takeoff_layers WHERE id IN ($in)")->execute($oldIds);
            }

            $layerMap = [];
            $layerStmt = $pdo->prepare(
                "INSERT INTO takeoff_layers
                 (drawing_id, page_number, name, type, catalog_item_id, assembly_id, color, symbol, visible, locked, tag, metadata_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            foreach ($layers as $layer) {
                if (!is_array($layer)) continue;
                $layerStmt->execute([
                    $drawingId,
                    i($layer['page_number'] ?? 1, 1),
                    trim((string)($layer['name'] ?? 'Takeoff Layer')) ?: 'Takeoff Layer',
                    $layer['type'] ?? 'mixed',
                    !empty($layer['catalog_item_id']) ? (int)$layer['catalog_item_id'] : null,
                    !empty($layer['assembly_id']) ? (int)$layer['assembly_id'] : null,
                    $layer['color'] ?? '#2563eb',
                    $layer['symbol'] ?? 'circle',
                    !empty($layer['visible']) ? 1 : 0,
                    !empty($layer['locked']) ? 1 : 0,
                    $layer['tag'] ?? null,
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
