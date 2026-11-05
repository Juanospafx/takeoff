<?php
require_once __DIR__ . '/../core/db/connection.php';

echo "--- LIGHTING ITEMS ---\n";
$stmt = $pdo->query("SELECT id, name, description, item_type, cost_type, unit_of_measure, unit_cost, catalog_number FROM catalog_items WHERE deleted_at IS NULL AND (name LIKE '%Type%' OR name LIKE '%Light%' OR name LIKE '%Fixture%' OR name LIKE '%EM%' OR name LIKE '%Exit%' OR catalog_number LIKE '%LIGHT%') ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} | {$it['catalog_number']} | \${$it['unit_cost']}\n";
}

echo "\n--- CONTROLS ITEMS ---\n";
$stmt = $pdo->query("SELECT id, name, description, item_type, cost_type, unit_of_measure, unit_cost, catalog_number FROM catalog_items WHERE deleted_at IS NULL AND (name LIKE '%OS%' OR name LIKE '%Occupancy%' OR name LIKE '%Dimmer%' OR name LIKE '%Power Pack%' OR name LIKE '%Sensor%' OR catalog_number LIKE '%CTRL%') ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} | {$it['catalog_number']} | \${$it['unit_cost']}\n";
}

echo "\n--- GEAR ITEMS ---\n";
$stmt = $pdo->query("SELECT id, name, description, item_type, cost_type, unit_of_measure, unit_cost, catalog_number FROM catalog_items WHERE deleted_at IS NULL AND (name LIKE '%Pad%' OR name LIKE '%800A%' OR name LIKE '%600A%' OR name LIKE '%CT%' OR name LIKE '%Meter%' OR name LIKE '%Panel%' OR name LIKE '%Photocell%' OR name LIKE '%Time Clock%' OR name LIKE '%Contactor%' OR catalog_number LIKE '%GEAR%') ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} | {$it['catalog_number']} | \${$it['unit_cost']}\n";
}
