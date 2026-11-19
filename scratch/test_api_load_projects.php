<?php
require_once __DIR__ . '/../core/db/connection.php';

$admin = $pdo->query("SELECT id, username, role FROM users WHERE role = 'admin' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$admin) $admin = ['id' => 1, 'username' => 'admin', 'role' => 'admin'];

foreach ([7, 8, 9, 10] as $pid) {
    echo PHP_EOL . "=== TESTING API LOAD FOR PROJECT {$pid} ===" . PHP_EOL;
    $authCode = "
        error_reporting(0);
        ini_set('display_errors', '0');
        if (session_status() !== PHP_SESSION_ACTIVE) session_start();
        \$_SESSION['user_id'] = {$admin['id']};
        \$_SESSION['username'] = '{$admin['username']}';
        \$_SESSION['role'] = '{$admin['role']}';
        \$_GET = ['action' => 'load', 'project_id' => {$pid}];
        \$_SERVER['REQUEST_METHOD'] = 'GET';
        include 'api/project_estimating.php';
    ";
    
    $proc = proc_open('php', [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    fwrite($pipes[0], "<?php " . $authCode);
    fclose($pipes[0]);
    $output = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);
    
    $data = json_decode(trim($output), true);
    if ($data && ($data['ok'] ?? false)) {
        $estimates = $data['estimates'] ?? [];
        echo "  STATUS: SUCCESS (HTTP 200) | Found " . count($estimates) . " estimate(s)" . PHP_EOL;
        foreach ($estimates as $idx => $est) {
            $groups = $est['groups'] ?? [];
            $itemCount = 0;
            $itemsWithDiff = 0;
            $itemsWithLWaste = 0;
            $itemsWithMWaste = 0;
            foreach ($groups as $g) {
                foreach ($g['items'] ?? [] as $it) {
                    $itemCount++;
                    if (isset($it['difficultyFactor']) || isset($it['difficulty'])) $itemsWithDiff++;
                    if (!empty($it['laborWastePercent']) || !empty($it['laborWaste'])) $itemsWithLWaste++;
                    if (!empty($it['wastePercent']) || !empty($it['materialWaste'])) $itemsWithMWaste++;
                }
            }
            echo "  - Estimate [{$idx}] '{$est['name']}': Groups: " . count($groups) . ", Items: {$itemCount}, Revision: " . ($est['revision'] ?? '0') . PHP_EOL;
            echo "    Difficulty Factors loaded: {$itemsWithDiff} | Material Waste: {$itemsWithMWaste} | Labor Waste: {$itemsWithLWaste}" . PHP_EOL;
        }
    } else {
        echo "  STATUS: FAIL" . PHP_EOL;
        echo "  Output: " . substr($output, 0, 300) . PHP_EOL;
    }
}
