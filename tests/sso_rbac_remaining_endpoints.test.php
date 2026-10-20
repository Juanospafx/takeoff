<?php
declare(strict_types=1);

/**
 * Test Suite: SSO & RBAC Fail-Closed Authorization for Remaining Takeoff Endpoints
 *
 * Verifies Acceptance Criteria for TASK-0381C:
 * 1. Every listed entry point requires a valid centralized Takeoff session and denies
 *    anonymous access with 401 before database, filesystem, upload, or service initialization.
 * 2. Authenticated viewers may execute declared read-only actions and routes, but every mutation
 *    is denied with 403 before any database, filesystem, upload, schema-repair, or logging side effect.
 * 3. Authenticated admins retain the existing mutation behavior and all creator, updater,
 *    uploader, and assignee attribution uses the authenticated local shadow user id.
 * 4. Action endpoints use explicit disjoint read and mutation allowlists and unknown actions fail closed;
 *    REST v1 routes classify authorization from the exact matched method and route before controller construction.
 * 5. No role may be accepted from request parameters and no default identity or role is invented.
 * 6. Isolated static and subprocess contract tests prove 401 anonymous, 403 viewer mutations,
 *    admitted viewer reads, unknown-action denial, and pre-side-effect ordering for every entry point.
 */

require_once __DIR__ . '/../core/auth/session.php';

$testCount = 0;
$failureCount = 0;

function assert_true(bool $condition, string $message): void
{
    global $testCount, $failureCount;
    $testCount++;
    if (!$condition) {
        $failureCount++;
        echo "[FAIL] {$message}\n";
    } else {
        echo "[PASS] {$message}\n";
    }
}

function assert_equals($expected, $actual, string $message): void
{
    assert_true($expected === $actual, "{$message} (expected: " . var_export($expected, true) . ", got: " . var_export($actual, true) . ")");
}

echo "=== Running Remaining Endpoints SSO & RBAC Guard Tests ===\n\n";

$adminSession = ['user_id' => 10, 'username' => 'admin_user', 'role' => 'admin'];
$viewerSession = ['user_id' => 20, 'username' => 'viewer_user', 'role' => 'viewer'];

// =========================================================================
// Group 1: Static Architecture & Security Invariants
// =========================================================================
echo "--- Group 1: Static Architecture & Security Invariants ---\n";

$endpointFiles = [
    'api/project_documents.php',
    'api/project_document_takeoff.php',
    'api/project_estimating.php',
    'api/takeoff_layers.php',
    'api/takeoff.php',
    'api/upload.php',
    'api/v1/index.php',
];

foreach ($endpointFiles as $relPath) {
    $fullPath = __DIR__ . '/../' . $relPath;
    assert_true(file_exists($fullPath), "Entrypoint file exists: {$relPath}");
    $code = file_get_contents($fullPath);

    // Invariant 1: Session guard required before database connection
    $posGuard = strpos($code, 'takeoff_guard_api_action');
    $posDb = strpos($code, 'core/db/connection.php');
    assert_true($posGuard !== false, "Entrypoint {$relPath} calls takeoff_guard_api_action");
    assert_true($posDb !== false, "Entrypoint {$relPath} references db connection");
    assert_true($posGuard < $posDb, "Entrypoint {$relPath} enforces guard BEFORE database connection");

    // Invariant 2: Explicit read & mutation allowlists (or router classification)
    if ($relPath !== 'api/v1/index.php') {
        assert_true(strpos($code, '$readActions') !== false, "Entrypoint {$relPath} declares \$readActions");
        assert_true(strpos($code, '$mutationActions') !== false, "Entrypoint {$relPath} declares \$mutationActions");
    }

    // Invariant 3: Never default to user_id 1 or sample fallback identities
    assert_true(strpos($code, "['user_id'] : 1") === false, "Entrypoint {$relPath} does not fallback to default user_id 1");
    assert_true(strpos($code, "['user_id'] ? (int)\$_SESSION['user_id'] : 1") === false, "Entrypoint {$relPath} does not fallback to user 1");
}

// Check Controllers attribution and no fallback admin queries
$projectsControllerCode = file_get_contents(__DIR__ . '/../api/v1/controllers/ProjectsController.php');
assert_true(strpos($projectsControllerCode, 'SessionGuard::getAuthenticatedUser()') !== false,
    'ProjectsController uses SessionGuard::getAuthenticatedUser for attribution');
assert_true(strpos($projectsControllerCode, 'get_default_admin_user_id') === false,
    'ProjectsController never falls back to get_default_admin_user_id');
assert_true(strpos($projectsControllerCode, 'require_client_role') === false,
    'ProjectsController does not fall back to require_client_role');
assert_true(strpos($projectsControllerCode, "(int)\$user['user_id']") !== false,
    'ProjectsController always uses authenticated user id for created_by and default assigned_user_id');

$filesControllerCode = file_get_contents(__DIR__ . '/../api/v1/controllers/FilesController.php');
assert_true(strpos($filesControllerCode, 'SessionGuard::getAuthenticatedUser()') !== false,
    'FilesController uses SessionGuard::getAuthenticatedUser for uploaded_by attribution');
assert_true(strpos($filesControllerCode, 'require_client_role') === false,
    'FilesController does not fall back to require_client_role');
assert_true(strpos($filesControllerCode, "(int)\$user['user_id']") !== false,
    'FilesController always uses authenticated user id for uploaded_by');

$uploadedByCount = preg_match_all('/\$uploadedBy\s*=\s*([^;]+);/s', $filesControllerCode, $uploadedByMatches);
assert_true(
    $uploadedByCount === 1 && preg_match('/\(int\)\s*\$user\[(?:\'|")user_id(?:\'|")\]/', $uploadedByMatches[1][0]) === 1,
    'FilesController explicitly requires uploadedBy to be assigned from the authenticated user_id'
);
$hasNullFallback = false;
if ($uploadedByCount > 0) {
    foreach ($uploadedByMatches[1] as $expr) {
        if (strpos($expr, '??') !== false || strpos($expr, '?') !== false || strpos($expr, ':') !== false || preg_match('/\bnull\b/i', $expr)) {
            $hasNullFallback = true;
            break;
        }
    }
}
assert_true(
    $uploadedByCount > 0 && !$hasNullFallback,
    'FilesController rejects ternary, coalescing, or direct null fallback in the uploadedBy assignment only'
);

$directoryControllerCode = file_get_contents(__DIR__ . '/../api/v1/controllers/DirectoryController.php');
assert_true(strpos($directoryControllerCode, 'SessionGuard::getAuthenticatedUser()') !== false,
    'DirectoryController uses SessionGuard::getAuthenticatedUser');
assert_true(strpos($directoryControllerCode, 'require_client_role') === false,
    'DirectoryController does not fall back to require_client_role');

// Mutating controller methods fail closed on SessionGuard (401 unauthenticated, 403 non-admin)
foreach ([
    'ProjectsController' => $projectsControllerCode,
    'FilesController' => $filesControllerCode,
    'DirectoryController' => $directoryControllerCode,
] as $cName => $cCode) {
    assert_true(strpos($cCode, 'UNAUTHORIZED') !== false && strpos($cCode, '401') !== false,
        "{$cName} fails with 401 when unauthenticated");
    assert_true(strpos($cCode, 'FORBIDDEN') !== false && strpos($cCode, '403') !== false,
        "{$cName} fails with 403 when not admin");
}

// =========================================================================
// Group 2: Action Allowlists Disjointness & Pure Action Resolution
// =========================================================================
echo "\n--- Group 2: Action Allowlists Disjointness & Action Evaluation ---\n";

$endpointActions = [
    'project_documents' => [
        'read' => ['get', 'download', 'start_takeoff'],
        'mutation' => ['rename', 'delete'],
        'default' => 'get',
    ],
    'project_document_takeoff' => [
        'read' => [],
        'mutation' => ['prepare_takeoff', 'start_takeoff'],
        'default' => 'prepare_takeoff',
    ],
    'project_estimating' => [
        'read' => ['list', 'load'],
        'mutation' => ['save', 'create', 'delete'],
        'default' => 'load',
    ],
    'takeoff_layers' => [
        'read' => ['list'],
        'mutation' => ['save_layer', 'duplicate_layer', 'delete_layer', 'update_layer', 'sync_layer_estimate', 'save_estimate_item', 'delete_estimate_item'],
        'default' => 'list',
    ],
    'takeoff' => [
        'read' => ['bootstrap', 'state', 'scale'],
        'mutation' => ['save_scale', 'delete_scale', 'save_state', 'save_catalog_item', 'delete_catalog_item', 'save_assembly', 'delete_assembly'],
        'default' => null,
    ],
    'upload' => [
        'read' => ['view', 'form', 'upload_page'],
        'mutation' => ['upload', 'upload_file'],
        'default' => 'view',
    ],
];

foreach ($endpointActions as $name => $cfg) {
    $intersect = array_intersect($cfg['read'], $cfg['mutation']);
    assert_equals([], array_values($intersect), "Endpoint {$name} has strictly disjoint read and mutation allowlists");

    // Anonymous check
    foreach ($cfg['mutation'] as $mutAction) {
        $anonRes = takeoff_check_api_access($mutAction, $cfg['read'], $cfg['mutation'], $cfg['default'], []);
        assert_equals(false, $anonRes['allowed'], "Pure: {$name} anonymous {$mutAction} denied");
        assert_equals(401, $anonRes['status'], "Pure: {$name} anonymous {$mutAction} returns 401");
    }

    // Viewer read admission
    foreach ($cfg['read'] as $readAction) {
        $vRead = takeoff_check_api_access($readAction, $cfg['read'], $cfg['mutation'], $cfg['default'], $viewerSession);
        assert_equals(true, $vRead['allowed'], "Pure: {$name} viewer read '{$readAction}' admitted");
        assert_equals(200, $vRead['status'], "Pure: {$name} viewer read '{$readAction}' returns 200");
    }

    // Viewer mutation denial
    foreach ($cfg['mutation'] as $mutAction) {
        $vMut = takeoff_check_api_access($mutAction, $cfg['read'], $cfg['mutation'], $cfg['default'], $viewerSession);
        assert_equals(false, $vMut['allowed'], "Pure: {$name} viewer mutation '{$mutAction}' denied");
        assert_equals(403, $vMut['status'], "Pure: {$name} viewer mutation '{$mutAction}' returns 403");
        assert_equals('viewer_mutation_denied', $vMut['reason'], "Pure: {$name} viewer mutation reason matches");
    }

    // Admin mutation admission
    foreach ($cfg['mutation'] as $mutAction) {
        $aMut = takeoff_check_api_access($mutAction, $cfg['read'], $cfg['mutation'], $cfg['default'], $adminSession);
        assert_equals(true, $aMut['allowed'], "Pure: {$name} admin mutation '{$mutAction}' admitted");
        assert_equals(200, $aMut['status'], "Pure: {$name} admin mutation '{$mutAction}' returns 200");
    }

    // Unknown action denial
    $unknownRes = takeoff_check_api_access('unrecognized_action_random', $cfg['read'], $cfg['mutation'], $cfg['default'], $adminSession);
    assert_equals(false, $unknownRes['allowed'], "Pure: {$name} unknown action denied");
    assert_equals(403, $unknownRes['status'], "Pure: {$name} unknown action returns 403");
}

// =========================================================================
// Group 3: Subprocess End-to-End Entry Point Tests
// =========================================================================
echo "\n--- Group 3: Subprocess End-to-End Entry Point Tests ---\n";

function run_remaining_entrypoint_subprocess(
    string $relativePath,
    array $sessionData,
    string $method = 'GET',
    array $query = [],
    array $post = [],
    ?array $jsonBody = null,
    array $serverOverrides = []
): array {
    $scriptPath = realpath(__DIR__ . '/../' . $relativePath);
    if (!$scriptPath || !file_exists($scriptPath)) {
        throw new RuntimeException("Target file not found: {$relativePath}");
    }

    $sessionEncoded = base64_encode(json_encode($sessionData));
    $getExport = var_export($query, true);
    $postExport = var_export($post, true);
    $methodExport = var_export($method, true);
    $scriptExport = var_export($scriptPath, true);
    $jsonEncoded = $jsonBody !== null ? json_encode($jsonBody) : '';

    $defaultUri = '/' . ltrim($relativePath, '/');
    if (!empty($query)) {
        $defaultUri .= '?' . http_build_query($query);
    }
    $uri = $serverOverrides['REQUEST_URI'] ?? $defaultUri;
    $uriExport = var_export($uri, true);

    $code = <<<PHP
putenv('TAKEOFF_DB_HOST=127.0.0.1');
putenv('TAKEOFF_DB_NAME=takeoff_mock');
putenv('TAKEOFF_DB_USER=takeoff_user');
putenv('TAKEOFF_DB_PASSWORD=takeoff_pass');

if (!class_exists('SubprocessTestMockPdo', false)) {
    class SubprocessTestMockPdo extends PDO {
        public function __construct() {
            parent::__construct('sqlite::memory:');
        }
        public function exec(string \$statement): int|false {
            try { return parent::exec(\$statement); } catch (\Throwable \$e) { return 0; }
        }
        public function query(string \$query, ?int \$fetchMode = null, mixed ...\$fetchModeArgs): PDOStatement|false {
            try {
                \$stmt = parent::query(\$query, \$fetchMode, ...\$fetchModeArgs);
                if (\$stmt !== false) return \$stmt;
            } catch (\Throwable \$e) {}
            return parent::query('SELECT 1 WHERE 1=0');
        }
        public function prepare(string \$query, array \$options = []): PDOStatement|false {
            try {
                \$stmt = parent::prepare(\$query, \$options);
                if (\$stmt !== false) return \$stmt;
            } catch (\Throwable \$e) {}
            return parent::prepare('SELECT 1 WHERE 1=0');
        }
    }
}

\$GLOBALS['__TAKEOFF_PDO_FACTORY__'] = function() {
    echo "\n__POST_GUARD_DB_INIT__:1\n";
    return new SubprocessTestMockPdo();
};

if (session_status() !== PHP_SESSION_ACTIVE) {
    @session_start();
}
\$_SESSION = json_decode(base64_decode('{$sessionEncoded}'), true) ?? [];
\$_GET = {$getExport};
\$_POST = {$postExport};
\$_SERVER['REQUEST_METHOD'] = {$methodExport};
\$_SERVER['REQUEST_URI'] = {$uriExport};

register_shutdown_function(function() {
    \$statusCode = http_response_code();
    if (!is_int(\$statusCode) || \$statusCode < 100) {
        \$statusCode = 200;
    }
    echo "\n__HTTP_STATUS__:" . \$statusCode;
});

require {$scriptExport};
PHP;

    $evalSnippet = 'eval(base64_decode(\'' . base64_encode($code) . '\'));';

    $descriptors = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];

    $cmd = [PHP_BINARY, '-r', $evalSnippet];
    $process = @proc_open($cmd, $descriptors, $pipes);
    if (!is_resource($process)) {
        $cmdString = escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($evalSnippet);
        $process = proc_open($cmdString, $descriptors, $pipes);
    }
    if (!is_resource($process)) {
        throw new RuntimeException("Failed to launch PHP subprocess for {$relativePath}");
    }

    if ($jsonEncoded !== '') {
        fwrite($pipes[0], $jsonEncoded);
    }
    fclose($pipes[0]);
    $rawStdout = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[2]);
    proc_close($process);

    $dbInitialized = (strpos($rawStdout, '__POST_GUARD_DB_INIT__:1') !== false);
    $httpStatus = null;
    $body = $rawStdout;
    if (preg_match('/__HTTP_STATUS__:(\d+)/', $rawStdout, $matches)) {
        $httpStatus = (int)$matches[1];
        $body = trim((string)preg_replace('/__HTTP_STATUS__:(\d+)/', '', $rawStdout));
    }

    $json = json_decode($body, true);

    return [
        'httpStatus' => $httpStatus,
        'body' => $body,
        'json' => is_array($json) ? $json : null,
        'stderr' => $stderr,
        'dbInitialized' => $dbInitialized,
    ];
}

$subprocessMatrix = [
    'api/project_documents.php' => [
        'read' => ['get' => ['action' => 'get', 'project_id' => 1, 'document_id' => 1, 'source' => 'project_document']],
        'mutation' => ['post' => ['action' => 'delete', 'project_id' => 1, 'document_id' => 1, 'source' => 'project_document']],
        'unknown' => ['action' => 'unknown_doc_xyz'],
    ],
    'api/project_document_takeoff.php' => [
        'read' => null, // mutation-only
        'mutation' => ['post' => ['project_id' => 1, 'document_id' => 1, 'source' => 'project_document']],
        'unknown' => ['action' => 'unknown_takeoff_xyz'],
    ],
    'api/project_estimating.php' => [
        'read' => ['get' => ['action' => 'load', 'project_id' => 1]],
        'mutation' => ['post' => ['action' => 'save'], 'json' => ['project_id' => 1, 'state' => ['estimates' => []]]],
        'unknown' => ['action' => 'unknown_estimating_xyz'],
    ],
    'api/takeoff_layers.php' => [
        'read' => ['get' => ['action' => 'list', 'project_id' => 1]],
        'mutation' => ['post' => ['action' => 'delete_layer'], 'json' => ['id' => 1]],
        'unknown' => ['action' => 'unknown_layers_xyz'],
    ],
    'api/takeoff.php' => [
        'read' => ['get' => ['action' => 'bootstrap']],
        'mutation' => ['post' => ['action' => 'save_state'], 'json' => ['drawing_id' => 1, 'estimate_key' => 'est1']],
        'unknown' => ['action' => 'unknown_takeoff_xyz'],
    ],
    'api/upload.php' => [
        'read' => ['get' => ['action' => 'view']],
        'mutation' => ['post' => ['action' => 'upload_file']],
        'unknown' => ['action' => 'unknown_upload_xyz'],
    ],
    'api/v1/index.php' => [
        'read' => ['uri' => '/api/v1/projects', 'method' => 'GET'],
        'mutation' => ['uri' => '/api/v1/projects', 'method' => 'POST', 'json' => ['name' => 'New Project']],
        'unknown' => null,
    ],
];

foreach ($subprocessMatrix as $endpoint => $cases) {
    echo "Testing endpoint in subprocess: {$endpoint}...\n";

    $mutPost = $cases['mutation']['post'] ?? [];
    $mutJson = $cases['mutation']['json'] ?? null;
    $mutMethod = $cases['mutation']['method'] ?? 'POST';
    $serverOverrides = [];
    if (!empty($cases['mutation']['uri'])) {
        $serverOverrides['REQUEST_URI'] = $cases['mutation']['uri'];
    }

    // 1. Anonymous Access -> HTTP 401 & NO DB initialization
    $resAnon = run_remaining_entrypoint_subprocess($endpoint, [], $mutMethod, [], $mutPost, $mutJson, $serverOverrides);
    assert_equals(401, $resAnon['httpStatus'], "Subprocess: Anonymous access to {$endpoint} returns HTTP 401");
    assert_equals('error', $resAnon['json']['status'] ?? null, "Subprocess: Anonymous {$endpoint} returns error status");
    assert_equals(401, $resAnon['json']['code'] ?? null, "Subprocess: Anonymous {$endpoint} payload includes code 401");
    assert_equals(false, $resAnon['dbInitialized'], "Subprocess: Anonymous {$endpoint} denies BEFORE database initialization");

    // 2. Viewer Mutation -> HTTP 403 & NO DB initialization
    $resViewerMut = run_remaining_entrypoint_subprocess($endpoint, $viewerSession, $mutMethod, [], $mutPost, $mutJson, $serverOverrides);
    assert_equals(403, $resViewerMut['httpStatus'], "Subprocess: Viewer mutation on {$endpoint} returns HTTP 403");
    assert_equals('error', $resViewerMut['json']['status'] ?? null, "Subprocess: Viewer mutation {$endpoint} returns error status");
    assert_equals(403, $resViewerMut['json']['code'] ?? null, "Subprocess: Viewer mutation {$endpoint} payload includes code 403");
    assert_equals(false, $resViewerMut['dbInitialized'], "Subprocess: Viewer mutation {$endpoint} denies BEFORE database initialization");

    // 3. Viewer Read Admission (if endpoint supports reads)
    if ($cases['read'] !== null) {
        $readGet = $cases['read']['get'] ?? [];
        $readMethod = $cases['read']['method'] ?? 'GET';
        $readServer = [];
        if (!empty($cases['read']['uri'])) {
            $readServer['REQUEST_URI'] = $cases['read']['uri'];
        }
        $resViewerRead = run_remaining_entrypoint_subprocess($endpoint, $viewerSession, $readMethod, $readGet, [], null, $readServer);
        assert_true($resViewerRead['httpStatus'] !== 401 && $resViewerRead['httpStatus'] !== 403,
            "Subprocess: Viewer read on {$endpoint} admitted by guard (got HTTP {$resViewerRead['httpStatus']})");
    }

    // 4. Admin Mutation Admission
    $resAdminMut = run_remaining_entrypoint_subprocess($endpoint, $adminSession, $mutMethod, [], $mutPost, $mutJson, $serverOverrides);
    assert_true($resAdminMut['httpStatus'] !== 401 && $resAdminMut['httpStatus'] !== 403,
        "Subprocess: Admin mutation on {$endpoint} admitted past guard (got HTTP {$resAdminMut['httpStatus']})");

    // 5. Unknown Action Denial
    if ($cases['unknown'] !== null) {
        $unknownPost = $cases['unknown'];
        $resUnknown = run_remaining_entrypoint_subprocess($endpoint, $adminSession, 'POST', $unknownPost, $unknownPost, $unknownPost);
        assert_equals(403, $resUnknown['httpStatus'], "Subprocess: Unknown action on {$endpoint} returns HTTP 403");
        assert_equals('error', $resUnknown['json']['status'] ?? null, "Subprocess: Unknown action on {$endpoint} returns error status");
        assert_equals(false, $resUnknown['dbInitialized'], "Subprocess: Unknown action on {$endpoint} denies BEFORE database initialization");
    }
}

echo "\n=======================================================\n";
echo "Remaining Endpoints Test Completed.\n";
echo "Total assertions: {$testCount}\n";
echo "Failures: {$failureCount}\n";
echo "=======================================================\n";

if ($failureCount > 0) {
    exit(1);
}

exit(0);
