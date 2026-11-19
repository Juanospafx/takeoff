<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->prepare("SELECT id, project_id, name, status, created_at FROM estimates WHERE project_id = 6 AND deleted_at IS NULL");
$stmt->execute();
$estimates = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Estimates for Project 6 in DB:\n";
foreach ($estimates as $e) {
    echo "  Estimate ID: {$e['id']}, Name: {$e['name']}, Status: {$e['status']}\n";
    $cStmt = $pdo->prepare("SELECT COUNT(*) FROM estimate_items WHERE estimate_id = ?");
    $cStmt->execute([$e['id']]);
    echo "    Estimate items count: " . $cStmt->fetchColumn() . "\n";
}
