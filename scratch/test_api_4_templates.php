<?php
foreach ([7, 8, 9, 10] as $pid) {
    $_GET['project_id'] = $pid;
    $_SERVER['REQUEST_METHOD'] = 'GET';
    ob_start();
    require __DIR__ . '/../api/project_estimating.php';
    $response = ob_get_clean();
    $data = json_decode($response, true);
    echo "========================================\n";
    echo "Project ID: {$pid}\n";
    echo "API Status: " . ($data['status'] ?? 'unknown') . "\n";
    $estimates = $data['data']['state']['estimates'] ?? [];
    echo "Estimates Count: " . count($estimates) . "\n";
    foreach ($estimates as $est) {
        $groups = $est['groups'] ?? [];
        $itemCount = 0;
        $assCount = 0;
        foreach ($groups as $g) {
            foreach ($g['items'] ?? [] as $it) {
                $itemCount++;
                if (!empty($it['children']) || ($it['itemType'] ?? '') === 'assembly' || ($it['isAssembly'] ?? false)) {
                    $assCount++;
                }
            }
        }
        echo "  - Estimate: '{$est['name']}'\n";
        echo "    Groups: " . count($groups) . ", Items: {$itemCount}, Assemblies: {$assCount}\n";
        echo "    Total Sales: \$" . number_format($est['totalSales'] ?? 0, 2) . "\n";
    }
}

