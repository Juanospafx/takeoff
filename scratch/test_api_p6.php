<?php
$_GET['project_id'] = 6;
$_SERVER['REQUEST_METHOD'] = 'GET';
ob_start();
require __DIR__ . '/../api/project_estimating.php';
$response = ob_get_clean();
$data = json_decode($response, true);
echo "API response status: " . ($data['status'] ?? 'unknown') . "\n";
echo "Estimates count: " . count($data['data']['state']['estimates'] ?? []) . "\n";
foreach ($data['data']['state']['estimates'] ?? [] as $est) {
    echo "  - Estimate: {$est['name']}, Groups: " . count($est['groups'] ?? []) . ", Total Sales: \${$est['totalSales']}\n";
}
