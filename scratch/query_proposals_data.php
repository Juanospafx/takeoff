<?php
require_once __DIR__ . '/../core/db/connection.php';
$stmt = $pdo->query("SELECT * FROM proposals ORDER BY id DESC LIMIT 5");
echo "=== PROPOSALS ===\n";
echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC), JSON_PRETTY_PRINT);

$stmt2 = $pdo->query("SELECT project_id, updated_at, LENGTH(state_json) as len FROM estimate_workspace_states");
echo "\n=== ESTIMATE_WORKSPACE_STATES ===\n";
echo json_encode($stmt2->fetchAll(PDO::FETCH_ASSOC), JSON_PRETTY_PRINT);

