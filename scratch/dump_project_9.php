<?php
require_once __DIR__ . '/../core/db/connection.php';
$stmt = $pdo->query("SELECT state_json FROM estimate_workspace_states WHERE project_id = 9 ORDER BY updated_at DESC LIMIT 1");
$row = $stmt->fetch(PDO::FETCH_ASSOC);
if ($row) {
    file_put_contents(__DIR__ . '/project_9_workspace_state.json', $row['state_json']);
    echo "Saved project 9 state (" . strlen($row['state_json']) . " bytes)\n";
} else {
    echo "No state found for project 9\n";
}

