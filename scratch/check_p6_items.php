<?php
$_GET['project_id'] = 6;
$_SERVER['REQUEST_METHOD'] = 'GET';
ob_start();
require __DIR__ . '/../api/project_estimating.php';
$response = ob_get_clean();
$data = json_decode($response, true);
$ests = $data['estimates'] ?? [];
echo "Estimates count: " . count($ests) . "\n";
foreach ($ests as $e) {
    echo "ID: " . $e['id'] . ", Name: " . $e['name'] . ", isActive: " . (($e['isActive'] ?? false) ? 'YES' : 'NO') . ", isPrimary: " . (($e['isPrimary'] ?? false) ? 'YES' : 'NO') . "\n";
    $groups = $e['groups'] ?? [];
    echo "  Groups count: " . count($groups) . "\n";
    $totalItems = 0;
    foreach ($groups as $g) {
        $cnt = count($g['items'] ?? []);
        $totalItems += $cnt;
        echo "    Group: " . $g['name'] . ", Items: " . $cnt . ", expanded: " . (($g['expanded'] ?? false) ? 'YES' : 'NO') . "\n";
    }
    echo "  Total items: $totalItems\n";
}

