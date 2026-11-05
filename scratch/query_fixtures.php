<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, name, sku, catalog_number, unit_cost FROM catalog_items WHERE deleted_at IS NULL AND (
    name LIKE 'Lighting Fixture \"A\"%' OR
    name LIKE 'Lighting Fixture \"B\"%' OR
    name LIKE 'Lighting Fixture \"C\"%' OR
    name LIKE 'Lighting Fixture \"D\"%' OR
    name LIKE 'Lighting Fixture \"E\"%' OR
    name LIKE 'Lighting Fixture \"F\"%' OR
    name LIKE 'Lighting Fixture \"EM%' OR
    name LIKE 'Lighting Fixture \"X%' OR
    name LIKE '%Fixture \"A%' OR
    name LIKE '%Fixture \"B%' OR
    name LIKE '%Fixture \"C%' OR
    name LIKE '%Fixture \"D%' OR
    name LIKE '%Fixture \"E%' OR
    name LIKE '%Fixture \"F%' OR
    name LIKE '%Fixture \"EM%' OR
    name LIKE '%Fixture \"X%'
) ORDER BY name");
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Lighting fixtures found: \n";
foreach ($items as $it) {
    echo "  [ID {$it['id']}] {$it['name']} (Cat: {$it['catalog_number']}) \${$it['unit_cost']}\n";
}
