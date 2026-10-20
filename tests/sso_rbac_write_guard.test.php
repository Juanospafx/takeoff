<?php
declare(strict_types=1);

/**
 * Test Suite: SSO & RBAC Fail-Closed Session Authorization Core
 *
 * Verifies Acceptance Criteria for TASK-0381A:
 * 1. The shim never invents user_id, username, or admin role; never returns true unconditionally.
 * 2. Identifies authenticated admin and viewer sessions using server session values only.
 * 3. Reusable API guard returns HTTP 401 JSON for missing/malformed auth and HTTP 403 JSON for viewer mutations.
 * 4. Explicit read action allowlists admit viewers; empty/unknown actions fail closed unless safe default declared.
 * 5. Role comparison is exact after normalization; only admin can mutate.
 * 6. Isolated subprocesses and pure function tests prove anonymous denial, viewer read admission,
 *    viewer write denial, admin write admission, and unknown-action denial.
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

echo "=== Running Fail-Closed Session & RBAC Guard Tests ===\n\n";

// =========================================================================
// Group 1: Legacy Shim Fail-Closed Invariants
// =========================================================================
echo "--- Group 1: Legacy Shim Fail-Closed Invariants ---\n";

$emptySession = [];
assert_equals(null, takeoff_get_authenticated_user($emptySession), 'Shim returns null user for empty session');
assert_equals(false, takeoff_is_authenticated($emptySession), 'Shim reports unauthenticated for empty session');
assert_equals(false, takeoff_is_admin($emptySession), 'Shim does not assume admin for empty session');
assert_equals(false, takeoff_is_viewer($emptySession), 'Shim does not assume viewer for empty session');
assert_equals(false, requireRole('admin', $emptySession), 'requireRole(admin) returns false for empty session');
assert_equals(false, requireRole('viewer', $emptySession), 'requireRole(viewer) returns false for empty session');
assert_equals(false, requireRole(['admin', 'viewer'], $emptySession), 'requireRole([admin, viewer]) returns false for empty session');

// Verify session was not mutated / no values invented
assert_equals([], $emptySession, 'Empty session array is never modified or populated with default identity');

// =========================================================================
// Group 2: Malformed Session Detection
// =========================================================================
echo "\n--- Group 2: Malformed Session Detection ---\n";

$malformedCases = [
    'missing user_id' => ['username' => 'alice', 'role' => 'admin'],
    'zero user_id' => ['user_id' => 0, 'username' => 'alice', 'role' => 'admin'],
    'negative user_id' => ['user_id' => -5, 'username' => 'alice', 'role' => 'admin'],
    'string non-digit user_id' => ['user_id' => 'abc', 'username' => 'alice', 'role' => 'admin'],
    'missing username' => ['user_id' => 1, 'role' => 'admin'],
    'empty username' => ['user_id' => 1, 'username' => '', 'role' => 'admin'],
    'whitespace username' => ['user_id' => 1, 'username' => '   ', 'role' => 'admin'],
    'missing role' => ['user_id' => 1, 'username' => 'alice'],
    'unrecognized role' => ['user_id' => 1, 'username' => 'alice', 'role' => 'superadmin'],
    'role manager' => ['user_id' => 1, 'username' => 'alice', 'role' => 'manager'],
    'inactive user flag' => ['user_id' => 1, 'username' => 'alice', 'role' => 'admin', 'active' => false],
];

foreach ($malformedCases as $label => $sessionDouble) {
    assert_equals(null, takeoff_get_authenticated_user($sessionDouble), "Malformed case ({$label}) returns null user");
    assert_equals(false, takeoff_is_authenticated($sessionDouble), "Malformed case ({$label}) is not authenticated");
    assert_equals(false, takeoff_is_admin($sessionDouble), "Malformed case ({$label}) is not admin");
}

// =========================================================================
// Group 3: Server Session Exclusivity (Ignore Request-Supplied Identity)
// =========================================================================
echo "\n--- Group 3: Server Session Exclusivity ---\n";

$_GET['role'] = 'admin';
$_POST['role'] = 'admin';
$_GET['user_id'] = '1';
$_POST['user_id'] = '1';
$_GET['username'] = 'admin';

$viewerSession = ['user_id' => 42, 'username' => 'bob_viewer', 'role' => 'viewer'];
assert_equals(false, takeoff_is_admin($viewerSession), 'Request-supplied role=admin cannot elevate viewer session');
assert_equals(true, takeoff_is_viewer($viewerSession), 'Viewer session retains exact server role despite request parameters');

unset($_GET['role'], $_POST['role'], $_GET['user_id'], $_POST['user_id'], $_GET['username']);

// =========================================================================
// Group 4: Exact Role Normalization
// =========================================================================
echo "\n--- Group 4: Exact Role Normalization ---\n";

assert_equals('admin', takeoff_normalize_role('admin'), 'Normalizes admin');
assert_equals('admin', takeoff_normalize_role('ADMIN'), 'Normalizes uppercase ADMIN');
assert_equals('admin', takeoff_normalize_role('  Admin  '), 'Normalizes whitespace Admin');
assert_equals('viewer', takeoff_normalize_role('viewer'), 'Normalizes viewer');
assert_equals('viewer', takeoff_normalize_role('VIEWER'), 'Normalizes uppercase VIEWER');
assert_equals('viewer', takeoff_normalize_role('  Viewer  '), 'Normalizes whitespace Viewer');
assert_equals('', takeoff_normalize_role(null), 'Null role normalizes to empty string');

$adminSessionMixedCase = ['user_id' => 1, 'username' => 'admin_user', 'role' => '  ADMIN  '];
assert_equals(true, takeoff_is_admin($adminSessionMixedCase), 'Session with uppercase whitespace role matches admin');
assert_equals(false, takeoff_is_viewer($adminSessionMixedCase), 'Session with uppercase whitespace admin does not match viewer');
assert_equals(true, requireRole('admin', $adminSessionMixedCase), 'requireRole matches admin after normalization');

$viewerSessionMixedCase = ['user_id' => 2, 'username' => 'viewer_user', 'role' => '  Viewer  '];
assert_equals(true, takeoff_is_viewer($viewerSessionMixedCase), 'Session with mixed-case whitespace role matches viewer');
assert_equals(false, takeoff_is_admin($viewerSessionMixedCase), 'Session with viewer role does not match admin');
assert_equals(true, requireRole('viewer', $viewerSessionMixedCase), 'requireRole matches viewer after normalization');

// =========================================================================
// Group 5: Pure Function API Guard Matrix
// =========================================================================
echo "\n--- Group 5: Pure Function API Guard Matrix ---\n";

$readActions = ['bootstrap', 'state', 'scale'];
$mutationActions = ['save_scale', 'delete_scale', 'save_state'];

$adminSession = ['user_id' => 1, 'username' => 'admin_one', 'role' => 'admin'];
$viewerSession = ['user_id' => 2, 'username' => 'viewer_one', 'role' => 'viewer'];

// 5.1 Anonymous denial (HTTP 401 JSON)
$anonResult = takeoff_check_api_access('state', $readActions, $mutationActions, null, []);
assert_equals(false, $anonResult['allowed'], 'Anonymous request is denied');
assert_equals(401, $anonResult['status'], 'Anonymous request returns HTTP 401');
assert_equals(401, $anonResult['payload']['code'], 'Anonymous payload contains code 401');
assert_equals('error', $anonResult['payload']['status'], 'Anonymous payload status is error');

$anonMutationResult = takeoff_check_api_access('save_state', $readActions, $mutationActions, null, []);
assert_equals(false, $anonMutationResult['allowed'], 'Anonymous mutation request is denied');
assert_equals(401, $anonMutationResult['status'], 'Anonymous mutation request returns HTTP 401');

// 5.2 Viewer read admission
foreach ($readActions as $action) {
    $viewerReadResult = takeoff_check_api_access($action, $readActions, $mutationActions, null, $viewerSession);
    assert_equals(true, $viewerReadResult['allowed'], "Viewer is admitted for read action '{$action}'");
    assert_equals(200, $viewerReadResult['status'], "Viewer read action '{$action}' returns HTTP 200");
    assert_equals(false, $viewerReadResult['is_mutation'], "Viewer read action '{$action}' is not marked mutation");
}

// 5.3 Viewer write denial (HTTP 403 JSON)
foreach ($mutationActions as $action) {
    $viewerWriteResult = takeoff_check_api_access($action, $readActions, $mutationActions, null, $viewerSession);
    assert_equals(false, $viewerWriteResult['allowed'], "Viewer is denied for mutation action '{$action}'");
    assert_equals(403, $viewerWriteResult['status'], "Viewer mutation action '{$action}' returns HTTP 403");
    assert_equals('viewer_mutation_denied', $viewerWriteResult['reason'], "Viewer mutation failure reason recorded");
    assert_equals('error', $viewerWriteResult['payload']['status'], "Viewer mutation payload status is error");
}

// 5.4 Admin write admission
foreach ($mutationActions as $action) {
    $adminWriteResult = takeoff_check_api_access($action, $readActions, $mutationActions, null, $adminSession);
    assert_equals(true, $adminWriteResult['allowed'], "Admin is admitted for mutation action '{$action}'");
    assert_equals(200, $adminWriteResult['status'], "Admin mutation action '{$action}' returns HTTP 200");
    assert_equals(true, $adminWriteResult['is_mutation'], "Admin mutation action '{$action}' is marked mutation");
}

// 5.5 Admin read admission
foreach ($readActions as $action) {
    $adminReadResult = takeoff_check_api_access($action, $readActions, $mutationActions, null, $adminSession);
    assert_equals(true, $adminReadResult['allowed'], "Admin is admitted for read action '{$action}'");
    assert_equals(200, $adminReadResult['status'], "Admin read action '{$action}' returns HTTP 200");
}

// 5.6 Unknown-action denial (HTTP 403 JSON for both viewer and admin)
$unknownActions = ['drop_all', 'unknown_cmd', 'export_secret'];
foreach ($unknownActions as $unknown) {
    $viewerUnknown = takeoff_check_api_access($unknown, $readActions, $mutationActions, null, $viewerSession);
    assert_equals(false, $viewerUnknown['allowed'], "Viewer denied for unknown action '{$unknown}'");
    assert_equals(403, $viewerUnknown['status'], "Viewer unknown action '{$unknown}' returns HTTP 403");
    assert_equals('unknown_action', $viewerUnknown['reason'], "Viewer unknown action failure reason is unknown_action");

    $adminUnknown = takeoff_check_api_access($unknown, $readActions, $mutationActions, null, $adminSession);
    assert_equals(false, $adminUnknown['allowed'], "Admin denied for unknown action '{$unknown}'");
    assert_equals(403, $adminUnknown['status'], "Admin unknown action '{$unknown}' returns HTTP 403");
    assert_equals('unknown_action', $adminUnknown['reason'], "Admin unknown action failure reason is unknown_action");
}

// 5.7 Empty/missing action handling and safe default read action
$viewerEmptyNoDefault = takeoff_check_api_access('', $readActions, $mutationActions, null, $viewerSession);
assert_equals(false, $viewerEmptyNoDefault['allowed'], 'Empty action without safe default is denied for viewer');
assert_equals(403, $viewerEmptyNoDefault['status'], 'Empty action without safe default returns HTTP 403');

$viewerNullNoDefault = takeoff_check_api_access(null, $readActions, $mutationActions, null, $viewerSession);
assert_equals(false, $viewerNullNoDefault['allowed'], 'Null action without safe default is denied for viewer');
assert_equals(403, $viewerNullNoDefault['status'], 'Null action without safe default returns HTTP 403');

$viewerEmptyWithSafeDefault = takeoff_check_api_access('', $readActions, $mutationActions, 'state', $viewerSession);
assert_equals(true, $viewerEmptyWithSafeDefault['allowed'], 'Empty action with safe default read action is admitted for viewer');
assert_equals(200, $viewerEmptyWithSafeDefault['status'], 'Empty action with safe default read action returns HTTP 200');
assert_equals('state', $viewerEmptyWithSafeDefault['action'], 'Empty action resolved to declared safe default read action');

$viewerEmptyWithUnsafeDefault = takeoff_check_api_access('', $readActions, $mutationActions, 'save_state', $viewerSession);
assert_equals(false, $viewerEmptyWithUnsafeDefault['allowed'], 'Empty action defaulting to mutation fails for viewer');
assert_equals(403, $viewerEmptyWithUnsafeDefault['status'], 'Empty action defaulting to mutation returns HTTP 403');

// =========================================================================
// Group 6: Subprocess End-to-End API Guard Tests
// =========================================================================
echo "\n--- Group 6: Subprocess End-to-End API Guard Tests ---\n";

function run_guard_in_subprocess(array $sessionData, ?string $action, array $readActions, array $mutationActions, ?string $defaultAction = null): array
{
    $sessionFile = __DIR__ . '/../core/auth/session.php';
    $sessionEncoded = base64_encode(json_encode($sessionData));
    $actionExport = var_export($action, true);
    $defaultExport = var_export($defaultAction, true);
    $readExport = var_export($readActions, true);
    $mutationExport = var_export($mutationActions, true);
    $sessionFileExport = var_export($sessionFile, true);

    $code = <<<PHP
require_once {$sessionFileExport};
\$_SESSION = json_decode(base64_decode('{$sessionEncoded}'), true) ?? [];

register_shutdown_function(function() {
    \$statusCode = http_response_code();
    if (!is_int(\$statusCode) || \$statusCode < 100) {
        \$statusCode = 200;
    }
    echo "\n__HTTP_STATUS__:" . \$statusCode;
});

takeoff_guard_api_action({$actionExport}, {$readExport}, {$mutationExport}, {$defaultExport});
echo json_encode(['status' => 'success', 'msg' => 'admitted']);
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
        $process = @proc_open($cmdString, $descriptors, $pipes, null, null, ['bypass_shell' => true]);
    }
    if (!is_resource($process)) {
        $cmdString = escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($evalSnippet);
        $process = proc_open($cmdString, $descriptors, $pipes);
    }
    if (!is_resource($process)) {
        throw new RuntimeException("Failed to launch PHP subprocess for guard testing.");
    }

    fclose($pipes[0]);
    $rawStdout = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[2]);
    proc_close($process);

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
    ];
}

// 6.1 Subprocess: Anonymous request -> HTTP 401 JSON
$subAnon = run_guard_in_subprocess([], 'state', $readActions, $mutationActions);
assert_equals(401, $subAnon['httpStatus'], 'Subprocess: Anonymous access returns HTTP 401');
assert_equals('error', $subAnon['json']['status'] ?? null, 'Subprocess: Anonymous response is error JSON');
assert_equals(401, $subAnon['json']['code'] ?? null, 'Subprocess: Anonymous response payload includes code 401');

// 6.2 Subprocess: Viewer read request -> HTTP 200 JSON
$subViewerRead = run_guard_in_subprocess($viewerSession, 'state', $readActions, $mutationActions);
assert_equals(200, $subViewerRead['httpStatus'], 'Subprocess: Viewer read access returns HTTP 200');
assert_equals('success', $subViewerRead['json']['status'] ?? null, 'Subprocess: Viewer read access admitted');

// 6.3 Subprocess: Viewer write request -> HTTP 403 JSON
$subViewerWrite = run_guard_in_subprocess($viewerSession, 'save_state', $readActions, $mutationActions);
assert_equals(403, $subViewerWrite['httpStatus'], 'Subprocess: Viewer write access returns HTTP 403');
assert_equals('error', $subViewerWrite['json']['status'] ?? null, 'Subprocess: Viewer write response is error JSON');
assert_equals(403, $subViewerWrite['json']['code'] ?? null, 'Subprocess: Viewer write response payload includes code 403');

// 6.4 Subprocess: Admin write request -> HTTP 200 JSON
$subAdminWrite = run_guard_in_subprocess($adminSession, 'save_state', $readActions, $mutationActions);
assert_equals(200, $subAdminWrite['httpStatus'], 'Subprocess: Admin write access returns HTTP 200');
assert_equals('success', $subAdminWrite['json']['status'] ?? null, 'Subprocess: Admin write access admitted');

// 6.5 Subprocess: Unknown-action denial -> HTTP 403 JSON
$subUnknown = run_guard_in_subprocess($adminSession, 'non_existent_action', $readActions, $mutationActions);
assert_equals(403, $subUnknown['httpStatus'], 'Subprocess: Unknown action returns HTTP 403');
assert_equals('error', $subUnknown['json']['status'] ?? null, 'Subprocess: Unknown action response is error JSON');

// 6.6 Subprocess: Empty action with declared safe default read action
$subDefault = run_guard_in_subprocess($viewerSession, '', $readActions, $mutationActions, 'state');
assert_equals(200, $subDefault['httpStatus'], 'Subprocess: Safe default read action admits viewer with HTTP 200');
assert_equals('success', $subDefault['json']['status'] ?? null, 'Subprocess: Safe default read action admitted');

// 6.7 Subprocess: Empty action without safe default fails closed
$subEmptyNoDefault = run_guard_in_subprocess($viewerSession, '', $readActions, $mutationActions);
assert_equals(403, $subEmptyNoDefault['httpStatus'], 'Subprocess: Empty action without safe default returns HTTP 403');
assert_equals('error', $subEmptyNoDefault['json']['status'] ?? null, 'Subprocess: Empty action without safe default returns error JSON');

echo "\n=======================================================\n";
echo "Test Execution Completed.\n";
echo "Total assertions: {$testCount}\n";
echo "Failures: {$failureCount}\n";
echo "=======================================================\n";

if ($failureCount > 0) {
    exit(1);
}

exit(0);
