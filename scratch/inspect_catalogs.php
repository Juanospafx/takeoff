<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, name, active FROM cost_catalogs WHERE deleted_at IS NULL");
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    echo "Catalog ID: {$row['id']}, Name: {$row['name']}, Active: {$row['active']}\n";
    $count = $pdo->query("SELECT COUNT(*) FROM catalog_items WHERE catalog_id = {$row['id']} AND deleted_at IS NULL")->fetchColumn();
    echo "  Items: $count\n";
}

$types = $pdo->query("SELECT item_type, COUNT(*) as cnt FROM catalog_items WHERE deleted_at IS NULL GROUP BY item_type");
echo "Item types in catalog_items:\n";
while ($t = $types->fetch(PDO::FETCH_ASSOC)) {
    echo "  - {$t['item_type']}: {$t['cnt']}\n";
}
