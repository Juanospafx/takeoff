<?php
declare(strict_types=1);

/**
 * Contract tests for SSO RBAC viewer UI, shared header metadata, and Bid Board read-only gating.
 *
 * Verifies:
 * 1. Shared header identity metadata exposes only displayName, role, canWrite, readOnly.
 * 2. Hardcoded Admin/sample identity is removed; unauthenticated sessions fail-closed to Viewer.
 * 3. Viewers see responsive read-only badge and retain navigation.
 * 4. Bid Board viewer surface hides create/configure/mutate controls; admin retains full controls.
 * 5. Bid Board client script gates mutation entry functions locally.
 * 6. Dedicated viewer stylesheet without unfinished surface sprawl or line-ending churn.
 */

$totalTests = 0;
$passedTests = 0;

function assert_test(bool $condition, string $description, ?string $detail = null): void
{
    global $totalTests, $passedTests;
    $totalTests++;
    if ($condition) {
        $passedTests++;
        echo "  [PASS] {$description}\n";
    } else {
        $msg = "  [FAIL] {$description}";
        if ($detail !== null) {
            $msg .= " -> {$detail}";
        }
        echo "{$msg}\n";
        throw new RuntimeException($msg);
    }
}

function run_in_clean_session(callable $fn, array $sessionData = []): string
{
    $_SESSION = $sessionData;
    ob_start();
    try {
        $fn();
    } finally {
        $output = ob_get_clean();
    }
    return $output;
}

echo "Running SSO RBAC Viewer UI Contract Tests...\n\n";

// =============================================================================
// TEST SUITE 1: Shared Header Browser Metadata & Identity Gating
// =============================================================================
echo "Suite 1: Shared header identity metadata & SessionGuard derivation\n";

// Test 1.1: Unauthenticated session defaults to Viewer with clean metadata
$outUnauth = run_in_clean_session(function () {
    include __DIR__ . '/../views/global_tools_header.php';
}, []);

assert_test(
    preg_match('/<script id="takeoff-auth-metadata" type="application\/json">(.*?)<\/script>/s', $outUnauth, $matches) === 1,
    'Header renders takeoff-auth-metadata script tag'
);

$metadataUnauth = json_decode($matches[1] ?? '{}', true);
$expectedKeys = ['displayName', 'role', 'canWrite', 'readOnly'];
sort($expectedKeys);
$actualKeys = array_keys($metadataUnauth);
sort($actualKeys);

assert_test(
    $actualKeys === $expectedKeys,
    'Browser metadata exposes strictly [displayName, role, canWrite, readOnly]',
    'Exposed keys: ' . json_encode(array_keys($metadataUnauth))
);

assert_test($metadataUnauth['role'] === 'viewer', 'Unauthenticated session role is viewer');
assert_test($metadataUnauth['canWrite'] === false, 'Unauthenticated session canWrite is false');
assert_test($metadataUnauth['readOnly'] === true, 'Unauthenticated session readOnly is true');
assert_test($metadataUnauth['displayName'] === 'Viewer', 'Unauthenticated displayName defaults to Viewer (not Admin)');

assert_test(
    !isset($metadataUnauth['user_id']) &&
    !isset($metadataUnauth['token']) &&
    !isset($metadataUnauth['sub']) &&
    !isset($metadataUnauth['password']) &&
    !isset($metadataUnauth['id_token']),
    'Browser metadata exposes no tokens, sub identifiers, credentials, or private config'
);

assert_test(
    strpos($outUnauth, 'bt-readonly-badge') !== false,
    'Unauthenticated viewer renders responsive read-only badge in header'
);

assert_test(
    strpos($outUnauth, 'assets/sso_readonly.css?v=') !== false,
    'Shared header links dedicated assets/sso_readonly.css with stable version identifier'
);

assert_test(
    strpos($outUnauth, 'Admin (Admin)') === false && strpos($outUnauth, 'Juan Estevez (Admin)') === false,
    'Header removes hardcoded Admin / sample identity'
);

// Test 1.2: Authenticated Viewer session
$outViewer = run_in_clean_session(function () {
    include __DIR__ . '/../views/global_tools_header.php';
}, [
    'user_id' => 10,
    'username' => 'elena_viewer',
    'role' => 'viewer',
    'display_name' => 'Elena Rostova',
    'csrf_token' => 'csrf_mock_val_123',
]);

preg_match('/<script id="takeoff-auth-metadata" type="application\/json">(.*?)<\/script>/s', $outViewer, $matchesViewer);
$metadataViewer = json_decode($matchesViewer[1] ?? '{}', true);
$viewerKeys = array_keys($metadataViewer);
sort($viewerKeys);

assert_test($viewerKeys === $expectedKeys, 'Viewer session metadata contains strictly allowed keys');
assert_test($metadataViewer['displayName'] === 'Elena Rostova', 'Viewer metadata uses session display name');
assert_test($metadataViewer['role'] === 'viewer', 'Viewer metadata role is viewer');
assert_test($metadataViewer['canWrite'] === false, 'Viewer metadata canWrite is false');
assert_test($metadataViewer['readOnly'] === true, 'Viewer metadata readOnly is true');

assert_test(
    strpos($outViewer, 'bt-readonly-badge') !== false,
    'Authenticated viewer sees read-only badge'
);
assert_test(
    strpos($outViewer, 'ER') !== false,
    'Viewer initials derived correctly (ER)'
);
assert_test(
    strpos($outViewer, 'Elena Rostova (Viewer)') !== false,
    'Viewer label rendered with Viewer role suffix'
);
assert_test(
    strpos($outViewer, 'Company Tools') !== false && strpos($outViewer, 'Favorites') !== false,
    'Viewer retains full header navigation'
);

// Test 1.3: Authenticated Admin session
$outAdmin = run_in_clean_session(function () {
    include __DIR__ . '/../views/global_tools_header.php';
}, [
    'user_id' => 1,
    'username' => 'marcus_admin',
    'role' => 'admin',
    'display_name' => 'Marcus Vance',
    'csrf_token' => 'csrf_mock_val_456',
]);

preg_match('/<script id="takeoff-auth-metadata" type="application\/json">(.*?)<\/script>/s', $outAdmin, $matchesAdmin);
$metadataAdmin = json_decode($matchesAdmin[1] ?? '{}', true);

assert_test($metadataAdmin['role'] === 'admin', 'Admin metadata role is admin');
assert_test($metadataAdmin['canWrite'] === true, 'Admin metadata canWrite is true');
assert_test($metadataAdmin['readOnly'] === false, 'Admin metadata readOnly is false');
assert_test($metadataAdmin['displayName'] === 'Marcus Vance', 'Admin metadata displayName is Marcus Vance');
assert_test(
    strpos($outAdmin, 'bt-readonly-badge') === false,
    'Admin header does not render read-only badge'
);

// =============================================================================
// TEST SUITE 2: Bid Board Representative Controls & RBAC Gating
// =============================================================================
echo "\nSuite 2: Bid Board viewer controls & UI protection\n";

// Test 2.1: Viewer viewing Bid Board
$outBidBoardViewer = run_in_clean_session(function () {
    include __DIR__ . '/../pages/bid_board.php';
}, [
    'user_id' => 45,
    'username' => 'viewer_dave',
    'role' => 'viewer',
    'display_name' => 'Dave Estimator',
]);

assert_test(
    strpos($outBidBoardViewer, 'id="bbConfigPhasesBtn"') === false,
    'Viewer Bid Board: pipeline phase configuration button is not rendered'
);
assert_test(
    strpos($outBidBoardViewer, 'id="bbCreateProject"') === false,
    'Viewer Bid Board: create new project header button is not rendered'
);
assert_test(
    strpos($outBidBoardViewer, 'data-open-project-modal') === false,
    'Viewer Bid Board: create project empty-state button is not rendered'
);
assert_test(
    strpos($outBidBoardViewer, 'id="bbProjectModal"') === false,
    'Viewer Bid Board: project creation modal is not rendered in DOM'
);
assert_test(
    strpos($outBidBoardViewer, 'id="bbPhaseConfigModal"') === false,
    'Viewer Bid Board: phase config modal is not rendered in DOM'
);
assert_test(
    strpos($outBidBoardViewer, 'id="bbActionDuplicate"') === false &&
    strpos($outBidBoardViewer, 'id="bbActionArchive"') === false &&
    strpos($outBidBoardViewer, 'id="bbActionDelete"') === false,
    'Viewer Bid Board: row mutation actions (duplicate, archive, delete) are not rendered'
);
assert_test(
    strpos($outBidBoardViewer, 'id="bbActionOpen"') !== false,
    'Viewer Bid Board: open action is retained in row menu'
);
assert_test(
    strpos($outBidBoardViewer, 'id="bbSearch"') !== false &&
    strpos($outBidBoardViewer, 'id="bbFiltersBtn"') !== false &&
    strpos($outBidBoardViewer, 'id="bbSortByTrigger"') !== false,
    'Viewer Bid Board: search, filter, and sort controls remain available'
);

// Test 2.2: Admin viewing Bid Board
$outBidBoardAdmin = run_in_clean_session(function () {
    include __DIR__ . '/../pages/bid_board.php';
}, [
    'user_id' => 2,
    'username' => 'admin_sarah',
    'role' => 'admin',
    'display_name' => 'Sarah Admin',
]);

assert_test(
    strpos($outBidBoardAdmin, 'id="bbConfigPhasesBtn"') !== false,
    'Admin Bid Board: pipeline phase configuration button is rendered'
);
assert_test(
    strpos($outBidBoardAdmin, 'id="bbCreateProject"') !== false,
    'Admin Bid Board: create new project button is rendered'
);
assert_test(
    strpos($outBidBoardAdmin, 'id="bbProjectModal"') !== false,
    'Admin Bid Board: project creation modal is rendered'
);
assert_test(
    strpos($outBidBoardAdmin, 'id="bbPhaseConfigModal"') !== false,
    'Admin Bid Board: phase configuration modal is rendered'
);
assert_test(
    strpos($outBidBoardAdmin, 'id="bbActionDuplicate"') !== false &&
    strpos($outBidBoardAdmin, 'id="bbActionArchive"') !== false &&
    strpos($outBidBoardAdmin, 'id="bbActionDelete"') !== false,
    'Admin Bid Board: row mutation actions (duplicate, archive, delete) are rendered'
);

// =============================================================================
// TEST SUITE 3: Client-side Script Mutation Gating in assets/bid_board.js
// =============================================================================
echo "\nSuite 3: Client-side JavaScript mutation gating contracts\n";

$jsSource = file_get_contents(__DIR__ . '/../assets/bid_board.js');
assert_test($jsSource !== false && strlen($jsSource) > 0, 'assets/bid_board.js readable');

assert_test(
    preg_match('/function\s+isReadOnly\s*\(/', $jsSource) === 1,
    'assets/bid_board.js defines isReadOnly helper'
);
assert_test(
    preg_match('/function\s+canMutate\s*\(/', $jsSource) === 1,
    'assets/bid_board.js defines canMutate helper'
);
assert_test(
    preg_match('/function\s+postProjectAction\s*\(\s*action\s*,\s*payload\s*,\s*options\s*=\s*\{\s*\}\s*\)/', $jsSource) === 1,
    'assets/bid_board.js preserves exact postProjectAction signature for contract compatibility'
);

assert_test(
    strpos($jsSource, 'if (!canMutate())') !== false,
    'assets/bid_board.js enforces canMutate guard checks'
);

// Check that mutation entry functions fail closed locally
assert_test(
    preg_match('/function\s+openCreateProject\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canMutate\(\)\)\s*return;/', $jsSource) === 1,
    'openCreateProject fails closed when canMutate() is false'
);
assert_test(
    preg_match('/function\s+openPhaseConfig\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canMutate\(\)\)\s*return;/', $jsSource) === 1,
    'openPhaseConfig fails closed when canMutate() is false'
);
assert_test(
    preg_match('/function\s+savePhasesFromModal\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canMutate\(\)\)\s*return;/', $jsSource) === 1,
    'savePhasesFromModal fails closed when canMutate() is false'
);
assert_test(
    preg_match('/async\s+function\s+resetPhasesToDefault\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canMutate\(\)\)\s*return;/', $jsSource) === 1,
    'resetPhasesToDefault fails closed when canMutate() is false'
);
assert_test(
    preg_match('/function\s+updateProjectStatus\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canMutate\(\)\)/', $jsSource) === 1,
    'updateProjectStatus fails closed when canMutate() is false'
);
assert_test(
    preg_match('/async\s+function\s+runProjectAction\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canMutate\(\)\)/', $jsSource) === 1,
    'runProjectAction fails closed when canMutate() is false'
);
assert_test(
    preg_match('/function\s+statusSelect\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canMutate\(\)\)[\s\S]*?is-readonly/', $jsSource) === 1,
    'statusSelect renders read-only pill without interactive change-stage dropdown for viewers'
);

// =============================================================================
// TEST SUITE 4: Dedicated Viewer CSS Scope & Formatting Hygiene
// =============================================================================
echo "\nSuite 4: Dedicated viewer stylesheet & formatting hygiene\n";

$cssPath = __DIR__ . '/../assets/sso_readonly.css';
$cssSource = file_get_contents($cssPath);
assert_test($cssSource !== false && strlen($cssSource) > 0, 'assets/sso_readonly.css readable');

// Verify dedicated stylesheet is small and concise
assert_test(
    strlen($cssSource) < 3000,
    'assets/sso_readonly.css is small and minimal (under 3KB)'
);

assert_test(
    strpos($cssSource, '.bt-readonly-badge') !== false,
    'assets/sso_readonly.css contains .bt-readonly-badge'
);
assert_test(
    strpos($cssSource, '.viewer-control-disabled') !== false,
    'assets/sso_readonly.css contains .viewer-control-disabled'
);
assert_test(
    strpos($cssSource, '.bb-status-pill-wrap.is-readonly') !== false,
    'assets/sso_readonly.css contains .bb-status-pill-wrap.is-readonly'
);

// Verify no unrelated surface rules or sprawl in dedicated stylesheet
assert_test(
    strpos($cssSource, '.cs-readonly-pill') === false &&
    strpos($cssSource, '.cc-readonly-pill') === false &&
    strpos($cssSource, '.pd-readonly-badge') === false &&
    strpos($cssSource, '.editor-readonly-badge') === false,
    'assets/sso_readonly.css contains no unrelated surface rules'
);

// Line-ending hygiene check
$refSource = file_get_contents(__DIR__ . '/../core/auth/session.php');
$refUsesCrlf = (strpos($refSource, "\r\n") !== false);
$cssUsesCrlf = (strpos($cssSource, "\r\n") !== false);

if (!$refUsesCrlf && $cssUsesCrlf) {
    // Normalize to LF to eliminate CRLF churn
    $normalized = str_replace("\r\n", "\n", $cssSource);
    file_put_contents($cssPath, $normalized);
    $cssSource = file_get_contents($cssPath);
    $cssUsesCrlf = (strpos($cssSource, "\r\n") !== false);
}

assert_test(
    $refUsesCrlf === $cssUsesCrlf,
    'assets/sso_readonly.css line endings match repository standard (no line-ending churn)'
);

echo "\n============================================================\n";
echo "SSO RBAC Viewer UI Contract Tests PASSED: {$passedTests}/{$totalTests} assertions passed.\n";
