<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, name, sku, catalog_number, unit_cost, description FROM catalog_items WHERE deleted_at IS NULL AND (
    catalog_number LIKE '%CTRL%' OR
    name LIKE '%OS%' OR
    name LIKE '%Dimmer%' OR
    name LIKE '%Power Pack%' OR
    name LIKE '%Occupancy%' OR
    name LIKE '%Sensor%'
) ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Controls items found: " . count($items) . "\n";
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} (Cat: {$it['catalog_number']}) \${$it['unit_cost']}\n";
}
