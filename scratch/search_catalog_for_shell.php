<?php
require_once __DIR__ . '/../core/db/connection.php';

function findItems($pdo, $query, $limit = 20) {
    $stmt = $pdo->prepare("SELECT id, sku, name, description, item_type, cost_type, unit_of_measure, unit_cost, labor_hours, material_cost, labor_cost, color, symbol, catalog_number FROM catalog_items WHERE deleted_at IS NULL AND (name LIKE ? OR description LIKE ? OR sku LIKE ? OR catalog_number LIKE ?) LIMIT $limit");
    $term = "%$query%";
    $stmt->execute([$term, $term, $term, $term]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

$searches = [
    'Lighting A-F, EM, X' => ['Type A', 'Type B', 'Type C', 'Type D', 'Type E', 'Type F', 'Fixture A', 'Fixture B', 'Fixture', 'EM', 'Exit', 'Type X'],
    'Controls' => ['Switch OS', 'Occupancy', 'Dimmer', 'Power Pack', 'Sensor'],
    'Gear' => ['Transformer', '800A', '600A', 'CT', 'Meter', 'Panel', 'Photocell', 'Time Clock', 'Contactor'],
    'Rough In' => ['J Box', 'J-Box', 'Junction', 'Single Pole', 'Receptacle', '30A', '60A', 'Disconnect'],
    'Overhead / EMT Assemblies' => ['EMT', '#12', '#10', '1/2" EMT', '3/4" EMT'],
    'Underground PVC' => ['PVC', 'Underground'],
    'Feeders' => ['Feeder'],
    'Rental' => ['Rental', 'Lift', 'Scissor']
];

foreach ($searches as $cat => $terms) {
    echo "==================== $cat ====================\n";
    foreach ($terms as $t) {
        $items = findItems($pdo, $t, 5);
        echo "--- Search: '$t' (" . count($items) . " found) ---\n";
        foreach ($items as $it) {
            echo "  [ID {$it['id']}] {$it['name']} | type: {$it['item_type']} | uom: {$it['unit_of_measure']} | cost: \${$it['unit_cost']} | sku: {$it['sku']} | catNo: {$it['catalog_number']}\n";
        }
    }
}
