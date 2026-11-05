<?php
require_once __DIR__ . '/../core/db/connection.php';

$projectId = 5;
$stmt = $pdo->prepare("SELECT * FROM projects WHERE id = ?");
$stmt->execute([$projectId]);
$proj = $stmt->fetch(PDO::FETCH_ASSOC);

echo "Project Name: {$proj['name']} ({$proj['project_number']})\n";

$ws = $pdo->prepare("SELECT * FROM estimate_workspace_states WHERE project_id = ?");
$ws->execute([$projectId]);
$wsRow = $ws->fetch(PDO::FETCH_ASSOC);

if ($wsRow) {
    $data = json_decode($wsRow['state_json'], true);
    echo "Estimate in State: {$data['name']} (Client ID: {$data['id']})\n";
    echo "Groups:\n";
    foreach ($data['groups'] as $g) {
        echo "  [Group] {$g['name']} - Items: " . count($g['items']) . "\n";
        foreach (array_slice($g['items'], 0, 3) as $it) {
            echo "     - {$it['name']} ({$it['costCode']}) | \${$it['unitMaterialCost']}/{$it['uom']}\n";
        }
        if (count($g['items']) > 3) {
            echo "     ... (" . (count($g['items']) - 3) . " more items)\n";
        }
    }
}
