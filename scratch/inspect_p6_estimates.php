<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->prepare("SELECT id, name, status, created_at, updated_at FROM estimates WHERE project_id = 6 AND deleted_at IS NULL");
$stmt->execute();
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

foreach ($rows as $r) {
    echo "ID: {$r['id']}, Name: {$r['name']}, Created: {$r['created_at']}, Updated: {$r['updated_at']}\n";
    $ws = $pdo->prepare("SELECT client_estimate_id, revision, state_json FROM estimate_workspace_states WHERE estimate_id = ?");
    $ws->execute([$r['id']]);
    $state = $ws->fetch(PDO::FETCH_ASSOC);
    if ($state) {
        $json = json_decode($state['state_json'], true);
        $groups = $json['groups'] ?? [];
        $totalItems = 0;
        foreach ($groups as $g) {
            $totalItems += count($g['items'] ?? []);
        }
        echo "  Client ID: {$state['client_estimate_id']}, Groups: " . count($groups) . ", Items: $totalItems\n";
    }
}

