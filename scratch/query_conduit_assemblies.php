<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, name, sku, catalog_number, unit_cost, unit_of_measure FROM catalog_items WHERE deleted_at IS NULL AND id BETWEEN 8800 AND 9050 ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Conduit assemblies found: " . count($items) . "\n";
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} \${$it['unit_cost']}/{$it['unit_of_measure']}\n";
}
