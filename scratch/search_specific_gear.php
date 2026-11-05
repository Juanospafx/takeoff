<?php
require_once __DIR__ . '/../core/db/connection.php';

echo "=== LIGHTING ITEMS ===\n";
$stmt = $pdo->query("SELECT id, sku, name, description, unit_of_measure, unit_cost, catalog_number FROM catalog_items WHERE deleted_at IS NULL AND (catalog_number LIKE '%LIGHT%' OR name LIKE '%Type A%' OR name LIKE '%Type B%' OR name LIKE '%Type C%' OR name LIKE '%Type D%' OR name LIKE '%Type E%' OR name LIKE '%Type F%' OR name LIKE '%Fixture%') ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} | {$it['catalog_number']} | \${$it['unit_cost']}\n";
}

echo "\n=== CONTROLS (OS, Dimmer, Power Pack) ===\n";
$stmt = $pdo->query("SELECT id, sku, name, description, unit_of_measure, unit_cost, catalog_number FROM catalog_items WHERE deleted_at IS NULL AND (name LIKE '%OS%' OR name LIKE '%Dimmer%' OR name LIKE '%Power Pack%' OR catalog_number LIKE '%CTRL%') ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} | {$it['catalog_number']} | \${$it['unit_cost']}\n";
}

echo "\n=== GEAR (Pad, 800A/600A, CT, 200A meters, Panel M/L w/ breakers, Photocell, Time clock, Contactor) ===\n";
$stmt = $pdo->query("SELECT id, sku, name, description, unit_of_measure, unit_cost, catalog_number FROM catalog_items WHERE deleted_at IS NULL AND (
    name LIKE '%Transformer Pad%' OR 
    name LIKE '%800%' OR 
    name LIKE '%600%' OR 
    name LIKE '%CT %' OR 
    name LIKE '%CT Meter%' OR 
    name LIKE '%200A%Meter%' OR 
    name LIKE '%200 Amp%Meter%' OR 
    name LIKE '%Meter%' OR 
    name LIKE '%Panel%' OR 
    name LIKE '%Photocell%' OR 
    name LIKE '%Time Clock%' OR 
    name LIKE '%Contactor%'
) AND deleted_at IS NULL ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} | {$it['catalog_number']} | \${$it['unit_cost']}\n";
}
