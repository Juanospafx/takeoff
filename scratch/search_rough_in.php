<?php
require_once __DIR__ . '/../core/db/connection.php';

echo "=== ROUGH IN SPECIFICS ===\n";
$terms = [
    'J-Box / Junction' => "catalog_number LIKE '%ROUGH%' AND (name LIKE '%Box%' OR name LIKE '%Junction%')",
    'Switches Single Pole' => "name LIKE '%Switch%' AND (name LIKE '%Single Pole%' OR name LIKE '%1-Pole%' OR name LIKE '%Toggle%')",
    'Receptacles' => "name LIKE '%Receptacle%' AND (name LIKE '%Duplex%' OR name LIKE '%GFCI%' OR name LIKE '%Commercial%')",
    'Disconnects 30A & 60A' => "(name LIKE '%30A%' OR name LIKE '%60A%' OR name LIKE '%30 Amp%' OR name LIKE '%60 Amp%') AND (name LIKE '%Disconnect%' OR name LIKE '%Safety Switch%')"
];

foreach ($terms as $label => $where) {
    echo "--- $label ---\n";
    $stmt = $pdo->query("SELECT id, name, sku, catalog_number, unit_cost FROM catalog_items WHERE deleted_at IS NULL AND ($where) LIMIT 10");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $r) {
        echo "  [ID {$r['id']}] {$r['name']} ({$r['catalog_number']}) \${$r['unit_cost']}\n";
    }
}
