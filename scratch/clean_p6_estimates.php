<?php
require_once __DIR__ . '/../core/db/connection.php';

// 1. Soft delete estimate 10
$pdo->prepare("UPDATE estimates SET deleted_at = NOW() WHERE id = 10")->execute();
$pdo->prepare("DELETE FROM estimate_workspace_states WHERE estimate_id = 10")->execute();
$pdo->prepare("DELETE FROM estimate_items WHERE estimate_id = 10")->execute();

// 2. Ensure estimate 9 is active, primary and updated_at = NOW()
$pdo->prepare("UPDATE estimates SET updated_at = NOW(), name = 'Primary Shell Estimate', status = 'approved' WHERE id = 9")->execute();

// Check estimate_workspace_states for estimate 9
$stmt = $pdo->prepare("SELECT estimate_id, client_estimate_id, state_json FROM estimate_workspace_states WHERE estimate_id = 9");
$stmt->execute();
$row = $stmt->fetch(PDO::FETCH_ASSOC);

if ($row) {
    $data = json_decode($row['state_json'], true);
    $data['isActive'] = true;
    $data['is_primary'] = true;
    $data['isPrimary'] = true;
    $encoded = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $upStmt = $pdo->prepare("UPDATE estimate_workspace_states SET state_json = ?, updated_at = NOW() WHERE estimate_id = 9");
    $upStmt->execute([$encoded]);
    echo "Updated estimate_workspace_states for estimate 9 with isActive=true\n";
}

echo "Cleaned project 6 estimates.\n";

