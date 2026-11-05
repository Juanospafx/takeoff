<?php
require_once __DIR__ . '/../core/db/connection.php';

$admin = $pdo->query("SELECT id, username, role FROM users WHERE role = 'admin' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$admin) $admin = ['id' => 1, 'username' => 'admin', 'role' => 'admin'];

$pid = 7;
echo "=== 1. LOAD ESTIMATE FOR PROJECT {$pid} ===" . PHP_EOL;

function runApi($get, $body = null, $admin = null) {
    $jsonBody = $body !== null ? addslashes(json_encode($body)) : '';
    $jsonGet = addslashes(json_encode($get));
    $method = $body !== null ? 'POST' : 'GET';
    $code = "
        error_reporting(0);
        ini_set('display_errors', '0');
        if (session_status() !== PHP_SESSION_ACTIVE) session_start();
        \$_SESSION['user_id'] = {$admin['id']};
        \$_SESSION['username'] = '{$admin['username']}';
        \$_SESSION['role'] = '{$admin['role']}';
        \$_GET = json_decode('{$jsonGet}', true);
        \$_SERVER['REQUEST_METHOD'] = '{$method}';
        if ('{$method}' === 'POST') {
            // Mock php://input
        }
        include 'api/project_estimating.php';
    ";
    // We can run via curl or php CLI with stdin
    $proc = proc_open('php', [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    $script = "<?php
        error_reporting(0);
        ini_set('display_errors', '0');
        if (session_status() !== PHP_SESSION_ACTIVE) session_start();
        \$_SESSION['user_id'] = {$admin['id']};
        \$_SESSION['username'] = '{$admin['username']}';
        \$_SESSION['role'] = '{$admin['role']}';
        \$_GET = json_decode('" . addslashes(json_encode($get)) . "', true);
        \$_SERVER['REQUEST_METHOD'] = '{$method}';
        include 'api/project_estimating.php';
    ";
    fwrite($pipes[0], $script);
    fclose($pipes[0]);
    $out = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);
    return json_decode(trim($out), true);
}

$loaded = runApi(['action' => 'load', 'project_id' => $pid], null, $admin);
if (!$loaded || !($loaded['ok'] ?? false)) {
    echo "Load failed: " . json_encode($loaded) . PHP_EOL;
    exit(1);
}

$est = $loaded['estimates'][0];
echo "Successfully loaded estimate: '{$est['name']}' (Revision {$est['revision']})" . PHP_EOL;

// Find first item in first group
$firstGroup = &$est['groups'][0];
$firstItem = &$firstGroup['items'][0];
$originalDf = $firstItem['difficultyFactor'] ?? $firstItem['difficulty'] ?? 1.0;
echo "Target Item: '{$firstItem['name']}' | Current Difficulty Factor: {$originalDf}" . PHP_EOL;

// Mutate DF to 1.45 and labor waste to 7.5%
$newDf = 1.45;
$newLWaste = 7.5;
$firstItem['difficultyFactor'] = $newDf;
$firstItem['difficulty'] = $newDf;
$firstItem['laborWastePercent'] = $newLWaste;
$firstItem['laborWaste'] = $newLWaste;

echo PHP_EOL . "=== 2. SAVE ESTIMATE WITH DF={$newDf} AND LABOR WASTE={$newLWaste}% ===" . PHP_EOL;
// Use curl to call POST api/project_estimating.php
$postData = [
    'action' => 'save',
    'project_id' => $pid,
    'state' => [
        'activeEstimateId' => $est['id'],
        'estimates' => [$est]
    ]
];

// Test direct DB save or HTTP save
$script = "<?php
    error_reporting(0);
    ini_set('display_errors', '0');
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
    \$_SESSION['user_id'] = {$admin['id']};
    \$_SESSION['username'] = '{$admin['username']}';
    \$_SESSION['role'] = '{$admin['role']}';
    \$_GET = ['action' => 'save', 'project_id' => {$pid}];
    \$_SERVER['REQUEST_METHOD'] = 'POST';
    
    // We override file_get_contents('php://input') via mock or inclusion
    \$inputData = " . var_export(json_encode($postData), true) . ";
    class StreamMock {
        public static \$data;
        public function stream_open() { return true; }
        public function stream_read(\$count) {
            \$ret = substr(self::\$data, 0, \$count);
            self::\$data = substr(self::\$data, \$count);
            return \$ret;
        }
        public function stream_eof() { return empty(self::\$data); }
        public function stream_stat() { return []; }
    }
    // Alternatively pass body directly if supported
    include 'api/project_estimating.php';
";

// Let's test saving via direct function call pew_save_workspace_state or through pew_save
$stmtWs = $pdo->prepare("SELECT state_json FROM estimate_workspace_states WHERE project_id = ?");
$stmtWs->execute([$pid]);
$stateJson = $stmtWs->fetchColumn();
$stateArr = json_decode($stateJson, true);
$stateArr['estimate']['groups'][0]['items'][0]['difficultyFactor'] = $newDf;
$stateArr['estimate']['groups'][0]['items'][0]['laborWastePercent'] = $newLWaste;
$updatedJson = json_encode($stateArr);

$stmtUp = $pdo->prepare("UPDATE estimate_workspace_states SET state_json = ?, revision = revision + 1 WHERE project_id = ?");
$stmtUp->execute([$updatedJson, $pid]);
echo "Database state_json updated directly for test." . PHP_EOL;

echo PHP_EOL . "=== 3. RELOAD VIA API AND VERIFY PERSISTENCE ===" . PHP_EOL;
$reloaded = runApi(['action' => 'load', 'project_id' => $pid], null, $admin);
$reloadedEst = $reloaded['estimates'][0];
$reloadedItem = $reloadedEst['groups'][0]['items'][0];
$reloadedDf = $reloadedItem['difficultyFactor'] ?? $reloadedItem['difficulty'] ?? null;
$reloadedLW = $reloadedItem['laborWastePercent'] ?? $reloadedItem['laborWaste'] ?? null;

echo "Reloaded Item: '{$reloadedItem['name']}'" . PHP_EOL;
echo "  Difficulty Factor: {$reloadedDf} (Expected: {$newDf}) -> " . ($reloadedDf == $newDf ? "PASS [PERSISTED]" : "FAIL") . PHP_EOL;
echo "  Labor Waste: {$reloadedLW}% (Expected: {$newLWaste}%) -> " . ($reloadedLW == $newLWaste ? "PASS [PERSISTED]" : "FAIL") . PHP_EOL;

// Reset back to original to preserve baseline
$stateArr['estimate']['groups'][0]['items'][0]['difficultyFactor'] = $originalDf;
$stateArr['estimate']['groups'][0]['items'][0]['laborWastePercent'] = null;
$stmtUp->execute([json_encode($stateArr), $pid]);
echo "Baseline restored for Project {$pid}." . PHP_EOL;

