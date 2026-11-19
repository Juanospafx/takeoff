<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->prepare("SELECT estimate_id, COUNT(*) as cnt FROM estimate_items WHERE estimate_id IN (9, 10) GROUP BY estimate_id");
$stmt->execute();
while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
    echo "Estimate {$r['estimate_id']}: {$r['cnt']} items in estimate_items table\n";
}

