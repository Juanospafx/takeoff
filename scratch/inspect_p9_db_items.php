<?php
require_once __DIR__ . '/../core/db/connection.php';
$stmt = $pdo->prepare("
    SELECT ei.*, ci.name AS catalog_item_name
    FROM estimate_items ei
    INNER JOIN estimates e ON e.id = ei.estimate_id
    LEFT JOIN catalog_items ci ON ci.id = ei.catalog_item_id
    WHERE e.project_id = 9 AND ei.deleted_at IS NULL AND e.deleted_at IS NULL
    ORDER BY ei.sort_order ASC, ei.id DESC
");
$stmt->execute();
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo "Total DB items for project 9: " . count($items) . "\n";
foreach (array_slice($items, 0, 5) as $it) {
    echo "Item: id={$it['id']}, name={$it['name']}, group_name={$it['group_name']}, cost_group={$it['cost_group']}, item_type={$it['item_type']}, budget_code={$it['budget_code']}\n";
}

