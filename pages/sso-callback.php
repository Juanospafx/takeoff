<?php
declare(strict_types=1);

/**
 * Takeoff SSO OAuth 2.0 Callback Endpoint.
 *
 * Implements strict order of operations:
 * 1. Validates single-use state and consumes PKCE code verifier (SsoFlow).
 * 2. Obtains identity through server-to-server token exchange + userinfo (OAuthIdentityProviderClient).
 * 3. Resolves exact active local link and active local user (FederatedIdentityRepository).
 * 4. Applies authorization boundary with role whitelist and anti-elevation (SsoAuthorization).
 * 5. Establishes session shape and non-sensitive federation metadata (SsoSession).
 * 6. Fail-closed: any failure produces no partial session and redirects to local login with sanitized error.
 */

if (!function_exists('takeoff_redirect')) {
    function takeoff_redirect(string $url): void
    {
        $GLOBALS['__TAKEOFF_LAST_REDIRECT__'] = $url;
        if (isset($GLOBALS['__TAKEOFF_REDIRECT_HANDLER__']) && is_callable($GLOBALS['__TAKEOFF_REDIRECT_HANDLER__'])) {
            ($GLOBALS['__TAKEOFF_REDIRECT_HANDLER__'])($url);
            return;
        }
        if (!headers_sent()) {
            header('Location: ' . $url);
        }
        if (PHP_SAPI !== 'cli') {
            exit;
        }
    }
}

require_once dirname(__DIR__) . '/config/SsoConfig.php';
require_once dirname(__DIR__) . '/core/auth/IdentityProviderClient.php';
require_once dirname(__DIR__) . '/core/auth/SsoFlow.php';
require_once dirname(__DIR__) . '/core/auth/OAuthIdentityProviderClient.php';
require_once dirname(__DIR__) . '/core/auth/FederatedIdentityRepository.php';
require_once dirname(__DIR__) . '/core/auth/SsoAuthorization.php';
require_once dirname(__DIR__) . '/core/auth/SsoSession.php';

// Configure session cookies with Secure, HttpOnly, and SameSite=Lax
\Takeoff\Core\Auth\SsoSession::configureCookieParams();

if (session_status() !== PHP_SESSION_ACTIVE) {
    if (PHP_SAPI !== 'cli' || !isset($_SESSION)) {
        @session_start();
    }
}
if (!isset($_SESSION) || !is_array($_SESSION)) {
    $_SESSION = [];
}

// Load SSO Configuration (injected double or production load)
$ssoConfig = $GLOBALS['__TAKEOFF_TEST_SSO_CONFIG__'] ?? $GLOBALS['__TAKEOFF_SSO_CONFIG__'] ?? null;
if ($ssoConfig === null) {
    try {
        $ssoConfig = \Takeoff\Config\SsoConfig::load();
    } catch (\Throwable) {
        $ssoConfig = new \Takeoff\Config\SsoConfig();
    }
}

$flow = $GLOBALS['__TAKEOFF_TEST_SSO_FLOW__'] ?? new \Takeoff\Core\Auth\SsoFlow();

// Fail closed if SSO is disabled: clear any flow state and redirect to local login
if (!$ssoConfig->isEnabled()) {
    $flow->clearFlowSession($_SESSION);
    takeoff_redirect('/pages/login.php?error=sso_disabled');
    return;
}

try {
    // Step 1: Validate state parameter and consume PKCE code verifier from session
    $validated = $flow->validateCallback($_SESSION, $_GET);
    $code = $validated['code'];
    $verifier = $validated['code_verifier'];

    // Step 2: Server-to-server token exchange and userinfo claim retrieval
    $client = $GLOBALS['__TAKEOFF_TEST_OAUTH_CLIENT__'] ?? new \Takeoff\Core\Auth\OAuthIdentityProviderClient($ssoConfig);
    $identityProfile = $client->authenticate($code, $verifier);

    // Step 3: Resolve repository and apply fail-closed SsoAuthorization boundary
    $pdo = $GLOBALS['__TAKEOFF_TEST_PDO__'] ?? $GLOBALS['__TAKEOFF_PDO__'] ?? null;
    if ($pdo === null) {
        require_once dirname(__DIR__) . '/core/db/connection.php';
    }
    $repository = $GLOBALS['__TAKEOFF_TEST_FEDERATED_REPO__'] ?? new \Takeoff\Core\Auth\FederatedIdentityRepository($pdo);
    $authorizer = $GLOBALS['__TAKEOFF_TEST_SSO_AUTH__'] ?? new \Takeoff\Core\Auth\SsoAuthorization($repository);
    $authorizedIdentity = $authorizer->authorize($identityProfile, $repository);

    // Step 4: Establish SsoSession (regenerate session ID, local shape, federation metadata)
    $sessionRegenerator = $GLOBALS['__TAKEOFF_SESSION_REGENERATOR__'] ?? null;
    $ssoSession = $GLOBALS['__TAKEOFF_TEST_SSO_SESSION__'] ?? new \Takeoff\Core\Auth\SsoSession($sessionRegenerator);
    $ssoSession->establish($authorizedIdentity, $_SESSION);

    // Step 5: Successful authorization - redirect to application entry point
    takeoff_redirect('/pages/takeoff.php');
    return;
} catch (\Throwable $e) {
    // Fail closed: clear flow session and ensure absolutely no partial session exists
    $flow->clearFlowSession($_SESSION);

    unset(
        $_SESSION['user_id'],
        $_SESSION['username'],
        $_SESSION['role'],
        $_SESSION['auth_source'],
        $_SESSION['sso_provider'],
        $_SESSION['sso_sub'],
        $_SESSION['sso_hub_user_id'],
        $_SESSION['sso_authenticated_at'],
        $_SESSION['federation']
    );

    // Select sanitized generic error parameter
    $msg = $e->getMessage();
    if (str_contains($msg, 'unmapped') || str_contains($msg, 'unauthorized') || str_contains($msg, 'inactive') || str_contains($msg, 'role')) {
        takeoff_redirect('/pages/login.php?error=unauthorized');
    } else {
        takeoff_redirect('/pages/login.php?error=sso_failed');
    }
    return;
}
