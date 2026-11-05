<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, name, unit_cost, unit_of_measure FROM catalog_items WHERE deleted_at IS NULL AND name LIKE '1/2\" EMT%' ORDER BY name");
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
    echo "  [ID {$r['id']}] {$r['name']} (\${$r['unit_cost']}/{$r['unit_of_measure']})\n";
}
