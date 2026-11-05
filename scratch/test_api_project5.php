<?php
$_GET['project_id'] = 5;
$_SERVER['REQUEST_METHOD'] = 'GET';
ob_start();
require __DIR__ . '/../api/project_estimating.php';
$response = ob_get_clean();
$data = json_decode($response, true);
echo "API response status: " . ($data['status'] ?? 'unknown') . "\n";
echo "Estimates count: " . count($data['workspace']['estimates'] ?? []) . "\n";
if (!empty($data['workspace']['estimates'])) {
    $est = $data['workspace']['estimates'][0];
    echo "First estimate name: {$est['name']}\n";
    echo "Groups count: " . count($est['groups']) . "\n";
    foreach ($est['groups'] as $g) {
        echo "  - {$g['name']} (" . count($g['items']) . " items)\n";
    }
}
