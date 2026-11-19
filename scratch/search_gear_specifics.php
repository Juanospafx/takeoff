<?php
require_once __DIR__ . '/../core/db/connection.php';

echo "=== SEARCH GEAR SPECIFICS ===\n";
$terms = [
    'CT Meter / Cabinet' => "name LIKE '%CT%' OR description LIKE '%CT%'",
    '200A Meter' => "name LIKE '%Meter%' AND (name LIKE '%200%' OR description LIKE '%200%')",
    'Panels Medium & Large' => "name LIKE '%Panel%' AND (name LIKE '%Medium%' OR name LIKE '%Large%' OR name LIKE '%Breaker%' OR catalog_number LIKE '%PANEL%')",
    'Photocell' => "name LIKE '%Photo%' OR description LIKE '%Photo%'",
    'Contactor' => "name LIKE '%Contactor%' OR description LIKE '%Contactor%'",
    'Disconnect 800A / 600A' => "(name LIKE '%600%' OR name LIKE '%800%') AND (name LIKE '%Disconnect%' OR name LIKE '%Safety Switch%')"
];

foreach ($terms as $label => $where) {
    echo "--- $label ---\n";
    $stmt = $pdo->query("SELECT id, name, sku, catalog_number, unit_cost FROM catalog_items WHERE deleted_at IS NULL AND ($where) LIMIT 15");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $r) {
        echo "  [ID {$r['id']}] {$r['name']} ({$r['catalog_number']}) \${$r['unit_cost']}\n";
    }
}
