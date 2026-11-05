<?php
require_once __DIR__ . '/../core/db/connection.php';

$row = $pdo->query("SELECT * FROM estimate_workspace_states WHERE project_id = 3 ORDER BY updated_at DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if ($row) {
    echo "Project 3 state_json (sample keys and structure):\n";
    $data = json_decode($row['state_json'], true);
    if ($data) {
        echo "Root keys: " . implode(', ', array_keys($data)) . "\n";
        echo "Active estimate ID: " . ($data['activeEstimateId'] ?? 'none') . "\n";
        if (isset($data['estimates'])) {
            echo "Estimates count: " . count($data['estimates']) . "\n";
            $first = $data['estimates'][0] ?? [];
            echo "First estimate keys: " . implode(', ', array_keys($first)) . "\n";
            echo "First estimate name: " . ($first['name'] ?? '') . "\n";
            echo "Groups count: " . count($first['groups'] ?? []) . "\n";
            foreach ($first['groups'] ?? [] as $g) {
                echo "  Group: " . ($g['name'] ?? '') . " (items: " . count($g['items'] ?? []) . ")\n";
                if (!empty($g['items'])) {
                    $item = $g['items'][0];
                    echo "    Sample item keys: " . implode(', ', array_keys($item)) . "\n";
                    echo "    Sample item: " . ($item['name'] ?? '') . " | code: " . ($item['costCode'] ?? $item['catalogSnapshot']['catalog_number'] ?? '') . "\n";
                }
            }
        }
    }
}
