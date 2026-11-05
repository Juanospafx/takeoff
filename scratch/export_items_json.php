<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->prepare("SELECT * FROM estimate_items WHERE estimate_id = 13 AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC");
$stmt->execute();
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Output as JSON to a file so we can run JS tests on it
file_put_contents(__DIR__ . '/estimate_items_13.json', json_encode($items, JSON_PRETTY_PRINT));
echo "Saved " . count($items) . " items to estimate_items_13.json\n";

