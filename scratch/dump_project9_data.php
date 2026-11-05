<?php
require_once __DIR__ . '/../core/db/connection.php';

// Check estimate_items
$stmt2 = $pdo->prepare("
    SELECT *
    FROM estimate_items
    WHERE estimate_id IN (13, 15)
    LIMIT 5
");
$stmt2->execute();
$items = $stmt2->fetchAll(PDO::FETCH_ASSOC);
echo "Items count: " . count($items) . "\n";
if (!empty($items)) {
    echo "Item 1:\n";
    foreach ($items[0] as $k => $v) {
        if ($v !== null && $v !== '') {
            echo "  $k: " . (strlen((string)$v) > 60 ? substr((string)$v, 0, 60) . '...' : $v) . "\n";
        }
    }
}
