<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->prepare("SELECT estimate_id, client_estimate_id, state_json FROM estimate_workspace_states WHERE project_id = 6");
$stmt->execute();
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

foreach ($rows as $r) {
    echo "====================================\n";
    echo "Estimate DB ID: {$r['estimate_id']}, Client ID: {$r['client_estimate_id']}\n";
    $json = json_decode($r['state_json'], true);
    if ($json) {
        $groups = $json['groups'] ?? [];
        $totalItems = 0;
        echo "Groups count: " . count($groups) . "\n";
        foreach ($groups as $g) {
            $items = $g['items'] ?? [];
            $totalItems += count($items);
            echo "  Group '{$g['name']}': " . count($items) . " items\n";
        }
        echo "Total items: $totalItems\n";
    } else {
        echo "state_json could not be decoded or is empty\n";
    }
}
