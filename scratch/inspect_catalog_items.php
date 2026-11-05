<?php
require_once __DIR__ . '/../core/db/connection.php';

echo "--- catalog_items columns ---\n";
$cols = $pdo->query("DESCRIBE catalog_items")->fetchAll(PDO::FETCH_ASSOC);
foreach ($cols as $c) {
    echo "  {$c['Field']} ({$c['Type']})\n";
}

$count = $pdo->query("SELECT COUNT(*) FROM catalog_items WHERE deleted_at IS NULL")->fetchColumn();
echo "Total active catalog items: $count\n\n";

echo "--- estimate_workspace_states ---\n";
$cols = $pdo->query("DESCRIBE estimate_workspace_states")->fetchAll(PDO::FETCH_ASSOC);
foreach ($cols as $c) {
    echo "  {$c['Field']} ({$c['Type']})\n";
}

$rows = $pdo->query("SELECT * FROM estimate_workspace_states")->fetchAll(PDO::FETCH_ASSOC);
echo "estimate_workspace_states count: " . count($rows) . "\n";
foreach ($rows as $r) {
    echo "Project ID: {$r['project_id']}, updated_at: {$r['updated_at']}\n";
    $json = json_decode($r['workspace_state_json'] ?? '', true);
    if ($json) {
        echo "  Estimates count: " . count($json['estimates'] ?? []) . "\n";
        foreach ($json['estimates'] ?? [] as $est) {
            echo "    Estimate: {$est['name']}, Groups: " . count($est['groups'] ?? []) . "\n";
            foreach ($est['groups'] ?? [] as $g) {
                echo "      Group: {$g['name']} (items: " . count($g['items'] ?? []) . ")\n";
            }
        }
    }
}
