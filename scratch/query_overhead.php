<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, name, sku, catalog_number, unit_cost, unit_of_measure FROM catalog_items WHERE deleted_at IS NULL AND (
    item_type = 'assembly' OR
    (name LIKE '%EMT%' AND (name LIKE '%#12%' OR name LIKE '%#10%')) OR
    (name LIKE '%Overhead%')
) ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Assemblies & Overhead found: " . count($items) . "\n";
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} ({$it['catalog_number']}) \${$it['unit_cost']}/{$it['unit_of_measure']}\n";
}
