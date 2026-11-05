<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->prepare("SELECT DISTINCT group_name FROM estimate_items WHERE estimate_id IN (13, 15) AND deleted_at IS NULL");
$stmt->execute();
$groups = $stmt->fetchAll(PDO::FETCH_COLUMN);
echo "Distinct group names in DB: " . json_encode($groups) . "\n";

