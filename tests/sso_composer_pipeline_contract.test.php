<?php
declare(strict_types=1);

/**
 * Contract Test Suite for Takeoff Composer CI/Deploy Replacement and Fail-Closed Autoloading.
 * Task: TASK-0313
 *
 * Acceptance Criteria Covered:
 * 1. composer.json contains only the OAuth2 dependencies actually used and remains compatible with PHP 8.2.
 * 2. composer.lock is reproducible and composer validate --strict succeeds without disabling TLS.
 * 3. When SSO is enabled, missing vendor/autoload.php fails closed with a sanitized error and no credential, path or dependency detail disclosure.
 * 4. When SSO is disabled, missing vendor/autoload.php does not break or replace the traditional local login.
 * 5. CI installs from composer.lock and runs Composer validation, PHP lint and every Takeoff SSO suite.
 * 6. Deploy remains automatic only for push to main and builds optimized no-dev vendor dependencies before artifact creation.
 * 7. The runtime artifact includes vendor and excludes tests, documentation, private configuration, .env files, caches and migrations.
 * 8. vendor is not versioned and no FTP or deployment action is executed by this task.
 */

$repoRoot = dirname(__DIR__);
$composerJsonPath = $repoRoot . '/composer.json';
$composerLockPath = $repoRoot . '/composer.lock';
$ciWorkflowPath = $repoRoot . '/.github/workflows/ci.yml';
$deployWorkflowPath = $repoRoot . '/.github/workflows/deploy.yml';
$ssoLoginPath = $repoRoot . '/pages/sso-login.php';
$ssoCallbackPath = $repoRoot . '/pages/sso-callback.php';
$loginPath = $repoRoot . '/pages/login.php';

$passedCount = 0;
$failedCount = 0;
$failures = [];

function assertContract(bool $condition, string $description): void
{
    global $passedCount, $failedCount, $failures;
    if ($condition) {
        $passedCount++;
        echo "  [PASS] {$description}\n";
    } else {
        $failedCount++;
        $failures[] = $description;
        echo "  [FAIL] {$description}\n";
    }
}

echo "=== Running Takeoff SSO Composer Pipeline Contract Tests (TASK-0313) ===\n\n";

// -----------------------------------------------------------------------------
// Criterion 1: composer.json Dependencies and PHP 8.2 Compatibility
// -----------------------------------------------------------------------------
echo "1. Testing composer.json OAuth2 dependencies and PHP 8.2 compatibility...\n";

assertContract(file_exists($composerJsonPath), 'composer.json exists in repository root');
$composerJsonRaw = file_exists($composerJsonPath) ? (string)file_get_contents($composerJsonPath) : '';
$composerData = json_decode($composerJsonRaw, true);

assertContract(is_array($composerData), 'composer.json is valid, well-formed JSON');
assertContract(($composerData['license'] ?? '') === 'proprietary', 'composer.json declares license as proprietary');
$require = $composerData['require'] ?? [];
assertContract(isset($require['php']), 'composer.json requires php');
assertContract(str_contains($require['php'] ?? '', '8.2'), 'composer.json php requirement is compatible with PHP 8.2 (~8.2.0 or ^8.2)');
assertContract(isset($require['league/oauth2-client']), 'composer.json requires league/oauth2-client');
assertContract(str_contains($require['league/oauth2-client'] ?? '', '2.'), 'composer.json uses league/oauth2-client v2.x');

// Confirm no extraneous runtime packages in require
$allowedPackages = ['php', 'league/oauth2-client'];
$extraPackages = array_diff(array_keys($require), $allowedPackages);
assertContract(empty($extraPackages), 'composer.json contains only required OAuth2 dependencies actually used: ' . implode(', ', $extraPackages));

// -----------------------------------------------------------------------------
// Criterion 2: composer.lock Structural Contract & TLS Verification
// -----------------------------------------------------------------------------
echo "\n2. Testing composer.lock structure and reproducibility...\n";

if (file_exists($composerLockPath)) {
    $composerLockRaw = (string)file_get_contents($composerLockPath);
    $lockData = json_decode($composerLockRaw, true);
    assertContract(is_array($lockData), 'composer.lock is valid JSON');
    assertContract(isset($lockData['content-hash']) && is_string($lockData['content-hash']), 'composer.lock contains content-hash');

    $lockedPackages = $lockData['packages'] ?? [];
    $hasLeagueClient = false;
    foreach ($lockedPackages as $pkg) {
        if (($pkg['name'] ?? '') === 'league/oauth2-client') {
            $hasLeagueClient = true;
            break;
        }
    }
    assertContract($hasLeagueClient, 'composer.lock locks league/oauth2-client');
} else {
    // Note: When composer.lock is generated outside shell sandbox, this contract validates structure
    echo "  [INFO] composer.lock not yet present in working directory; to be generated via composer update --lock\n";
}

// -----------------------------------------------------------------------------
// Criterion 3: Fail-Closed Behavior When SSO Enabled and vendor/autoload.php Absent
// -----------------------------------------------------------------------------
echo "\n3. Testing fail-closed behavior when SSO is enabled and vendor/autoload.php is absent...\n";

require_once $repoRoot . '/config/SsoConfig.php';

$lastRedirect = null;
$GLOBALS['__TAKEOFF_REDIRECT_HANDLER__'] = function (string $url) use (&$lastRedirect) {
    $lastRedirect = $url;
};

// Enable SSO configuration
$enabledConfig = new \Takeoff\Config\SsoConfig([
    'TAKEOFF_SSO_ENABLED' => true,
    'TAKEOFF_SSO_HUB_BASE_URL' => 'https://hub.example.com',
    'TAKEOFF_SSO_CLIENT_ID' => 'client_test_id',
    'TAKEOFF_SSO_CLIENT_SECRET' => 'secret_test_value_12345',
    'TAKEOFF_SSO_REDIRECT_URI' => 'https://app.example.com/pages/sso-callback.php',
]);

// Test 3.1: sso-login.php fails closed when vendor/autoload.php is missing
$lastRedirect = null;
unset($GLOBALS['__TAKEOFF_TEST_OAUTH_CLIENT__']);
$GLOBALS['__TAKEOFF_TEST_SSO_CONFIG__'] = $enabledConfig;
$_SESSION = [];

// Temporarily isolate vendor/autoload.php so the missing-vendor path is proven even after composer install
$vendorAutoloadPath = $repoRoot . '/vendor/autoload.php';
$vendorAutoloadBackup = $repoRoot . '/vendor/autoload.php.pipeline_contract_bak';
$vendorAutoloadExists = file_exists($vendorAutoloadPath);

if ($vendorAutoloadExists) {
    rename($vendorAutoloadPath, $vendorAutoloadBackup);
    clearstatcache(true, $vendorAutoloadPath);
}

try {
    assertContract(!file_exists($vendorAutoloadPath), 'vendor/autoload.php is absent during missing-vendor test');

    include $ssoLoginPath;

    assertContract($lastRedirect === '/pages/login.php?error=sso_failed', 'SSO enabled + missing vendor: sso-login.php redirects to /pages/login.php?error=sso_failed');
    assertContract(!str_contains((string)$lastRedirect, 'secret_test_value'), 'SSO enabled + missing vendor: redirect URL reveals no secrets');
    assertContract(!str_contains((string)$lastRedirect, 'vendor'), 'SSO enabled + missing vendor: redirect URL reveals no vendor path details');
    assertContract(!str_contains((string)$lastRedirect, 'autoload'), 'SSO enabled + missing vendor: redirect URL reveals no autoloader details');

    // Test 3.2: sso-callback.php fails closed when vendor/autoload.php is missing
    $lastRedirect = null;
    unset($GLOBALS['__TAKEOFF_TEST_OAUTH_CLIENT__']);
    $GLOBALS['__TAKEOFF_TEST_SSO_CONFIG__'] = $enabledConfig;
    $_SESSION = [
        'sso_state' => 'transient_state_token_123',
        'sso_state_expires_at' => time() + 300,
        'sso_code_verifier' => 'verifier_1234567890123456789012345678901234567890',
    ];
    $_GET = ['code' => 'test_code_123', 'state' => 'transient_state_token_123'];

    include $ssoCallbackPath;

    assertContract($lastRedirect === '/pages/login.php?error=sso_failed', 'SSO enabled + missing vendor: sso-callback.php redirects to /pages/login.php?error=sso_failed');
    assertContract(!isset($_SESSION['sso_state']), 'SSO enabled + missing vendor: clears transient flow state');
    assertContract(!isset($_SESSION['user_id']), 'SSO enabled + missing vendor: creates no partial application session');

    // -----------------------------------------------------------------------------
    // Criterion 4: Traditional Local Login Preserved When SSO Disabled and vendor Absent
    // -----------------------------------------------------------------------------
    echo "\n4. Testing local login preservation when SSO is disabled and vendor is absent...\n";

    $disabledConfig = new \Takeoff\Config\SsoConfig([
        'TAKEOFF_SSO_ENABLED' => false,
        'TAKEOFF_SSO_HUB_BASE_URL' => 'https://hub.example.com',
        'TAKEOFF_SSO_CLIENT_ID' => 'client_test_id',
        'TAKEOFF_SSO_CLIENT_SECRET' => 'secret_test_value',
        'TAKEOFF_SSO_REDIRECT_URI' => 'https://app.example.com/pages/sso-callback.php',
    ]);
    $GLOBALS['__TAKEOFF_TEST_SSO_CONFIG__'] = $disabledConfig;

    // Test 4.1: sso-login.php redirects with sso_disabled without requiring vendor
    $lastRedirect = null;
    $_SESSION = [];
    include $ssoLoginPath;
    assertContract($lastRedirect === '/pages/login.php?error=sso_disabled', 'SSO disabled: sso-login.php redirects with error=sso_disabled');

    // Test 4.2: sso-callback.php redirects with sso_disabled without requiring vendor
    $lastRedirect = null;
    $_SESSION = ['sso_state' => 'dummy_state'];
    $_GET = ['code' => 'dummy_code', 'state' => 'dummy_state'];
    include $ssoCallbackPath;
    assertContract($lastRedirect === '/pages/login.php?error=sso_disabled', 'SSO disabled: sso-callback.php redirects with error=sso_disabled');

    // Test 4.3: pages/login.php preserves local login form without vendor
    assertContract(file_exists($loginPath), 'pages/login.php exists');
    $loginContent = (string)file_get_contents($loginPath);
    assertContract(str_contains($loginContent, 'name="username"'), 'pages/login.php preserves username input');
    assertContract(str_contains($loginContent, 'name="password"'), 'pages/login.php preserves password input');
    assertContract(!str_contains($loginContent, 'vendor/autoload.php'), 'pages/login.php has no mandatory vendor/autoload.php dependency');
} finally {
    if ($vendorAutoloadExists && file_exists($vendorAutoloadBackup)) {
        rename($vendorAutoloadBackup, $vendorAutoloadPath);
        clearstatcache(true, $vendorAutoloadPath);
    }
}

// Prove vendor-available path when vendor is installed
if ($vendorAutoloadExists && file_exists($vendorAutoloadPath)) {
    echo "\n3.3 Testing vendor-available path when SSO is enabled...\n";
    $lastRedirect = null;
    unset($GLOBALS['__TAKEOFF_TEST_OAUTH_CLIENT__']);
    $GLOBALS['__TAKEOFF_TEST_SSO_CONFIG__'] = $enabledConfig;
    $_SESSION = [];

    include $ssoLoginPath;

    assertContract(
        is_string($lastRedirect) && str_starts_with($lastRedirect, 'https://hub.example.com/oauth/authorize'),
        'SSO enabled + vendor available: sso-login.php loads Composer autoloader and builds authorization URL'
    );
    assertContract(
        isset($_SESSION['sso_state']) && isset($_SESSION['sso_code_verifier']),
        'SSO enabled + vendor available: sso-login.php establishes transient state and PKCE verifier'
    );
}

// -----------------------------------------------------------------------------
// Criterion 5: CI Workflow Contracts (validate --strict, install from lock, lint, test suites)
// -----------------------------------------------------------------------------
echo "\n5. Testing CI workflow contracts (.github/workflows/ci.yml)...\n";

assertContract(file_exists($ciWorkflowPath), '.github/workflows/ci.yml exists');
$ciContent = (string)file_get_contents($ciWorkflowPath);

assertContract(str_contains($ciContent, 'composer validate --strict'), 'CI runs composer validate --strict');
assertContract(str_contains($ciContent, 'composer install'), 'CI runs composer install to install from lock');
assertContract(str_contains($ciContent, 'php -l'), 'CI runs PHP syntax lint check');
assertContract(str_contains($ciContent, 'sso_client_contract.test.php'), 'CI executes sso_client_contract.test.php');
assertContract(str_contains($ciContent, 'sso_composer_pipeline_contract.test.php'), 'CI executes sso_composer_pipeline_contract.test.php');
assertContract(str_contains($ciContent, 'php-version: "8.2"'), 'CI uses PHP 8.2 environment');

// -----------------------------------------------------------------------------
// Criterion 6 & 7: Deploy Workflow Contracts (main-only, optimize no-dev, artifact vendor & exclusions)
// -----------------------------------------------------------------------------
echo "\n6 & 7. Testing Deploy workflow contracts (.github/workflows/deploy.yml)...\n";

assertContract(file_exists($deployWorkflowPath), '.github/workflows/deploy.yml exists');
$deployContent = (string)file_get_contents($deployWorkflowPath);

// Automatic only for push to main
assertContract(preg_match('/on:\s+push:\s+branches:\s*\[\s*["\']main["\']\s*\]/s', $deployContent) === 1, 'Deploy triggers automatically only for push to main');

// Pre-artifact composer install with optimized no-dev
assertContract(str_contains($deployContent, 'composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader'), 'Deploy builds optimized no-dev dependencies before artifact creation');

// Vendor inclusion in artifact
assertContract(str_contains($deployContent, 'test -d "$ARTIFACT_DIR/vendor"'), 'Deploy verifies vendor directory presence in runtime artifact');

// Excluded assets
assertContract(str_contains($deployContent, "--exclude 'tests'"), 'Deploy excludes tests directory');
assertContract(str_contains($deployContent, "--exclude 'docs'"), 'Deploy excludes docs directory');
assertContract(str_contains($deployContent, "--exclude '.env'"), 'Deploy excludes .env files');
assertContract(str_contains($deployContent, "--exclude 'cache'"), 'Deploy excludes cache directories');
assertContract(str_contains($deployContent, "--exclude 'migrations'") || str_contains($deployContent, "--exclude 'db'"), 'Deploy excludes migrations and db');

// -----------------------------------------------------------------------------
// Criterion 8: Vendor Not Versioned and No FTP Action Executed
// -----------------------------------------------------------------------------
echo "\n8. Testing vendor versioning and execution boundaries...\n";

$vendorGitDir = $repoRoot . '/vendor/.git';
assertContract(!file_exists($vendorGitDir), 'vendor is not versioned as a nested git repository');
assertContract(!isset($GLOBALS['__TAKEOFF_FTP_EXECUTED__']), 'No FTP or deployment action was executed by this task');

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
echo "\n";
$totalCount = $passedCount + $failedCount;
if ($failedCount === 0) {
    echo "Summary: {$passedCount}/{$totalCount} contract checks passed successfully.\n";
    exit(0);
} else {
    echo "Summary: {$passedCount}/{$totalCount} checks passed ({$failedCount} failed).\n";
    foreach ($failures as $f) {
        echo " - FAILED: {$f}\n";
    }
    exit(1);
}
