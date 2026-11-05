<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, name, sku, catalog_number, unit_cost FROM catalog_items WHERE deleted_at IS NULL AND (
    catalog_number LIKE '%LIGHT%' OR 
    catalog_number LIKE '%FIXTURE%' OR
    name LIKE 'Type %' OR
    name LIKE '%Fixture%' OR
    name LIKE '%Emergency%' OR
    name LIKE '%Exit%'
) ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Lighting items found: " . count($items) . "\n";
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} (Cat: {$it['catalog_number']}) \${$it['unit_cost']}\n";
}
