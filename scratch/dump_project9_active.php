<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->prepare("SELECT * FROM estimate_items WHERE estimate_id IN (13, 15) AND deleted_at IS NULL");
$stmt->execute();
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Active items: " . count($items) . "\n";
foreach (array_slice($items, 0, 5) as $idx => $it) {
    echo "Item $idx: id={$it['id']}, name={$it['name']}, group_name={$it['group_name']}, cost_type={$it['cost_type']}, item_type={$it['item_type']}\n";
    if (!empty($it['metadata_json'])) {
        $meta = json_decode($it['metadata_json'], true);
        echo "   metadata keys: " . json_encode(array_keys($meta)) . "\n";
    }
}

