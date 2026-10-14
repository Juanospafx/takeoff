<?php
declare(strict_types=1);

/**
 * Takeoff SSO Authorization Initiation Endpoint.
 *
 * Implements:
 * 1. Fail-closed: if SSO is disabled or unconfigured, redirects to local login with error.
 * 2. Generates single-use state token and PKCE S256 code challenge via SsoFlow.
 * 3. Stores verifier and state strictly in session with TTL.
 * 4. Builds and redirects exclusively to the configured HTTPS authorization endpoint.
 * 5. Sanitizes errors without exposing secrets or filesystem paths.
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

// Fail closed if SSO is disabled
if (!$ssoConfig->isEnabled()) {
    takeoff_redirect('/pages/login.php?error=sso_disabled');
    return;
}

$flow = $GLOBALS['__TAKEOFF_TEST_SSO_FLOW__'] ?? new \Takeoff\Core\Auth\SsoFlow();

try {
    // Generate single-use state and PKCE S256 challenge; stores verifier in $_SESSION
    $authParams = $flow->initiateAuth($_SESSION);

    // Build secure HTTPS authorization URL
    $client = $GLOBALS['__TAKEOFF_TEST_OAUTH_CLIENT__'] ?? new \Takeoff\Core\Auth\OAuthIdentityProviderClient($ssoConfig);
    $authUrl = $client->getAuthorizationUrl($authParams['state'], $authParams['code_challenge']);

    takeoff_redirect($authUrl);
    return;
} catch (\Throwable $e) {
    // Fail-closed on any initiation failure: clear transient flow tokens
    $flow->clearFlowSession($_SESSION);
    takeoff_redirect('/pages/login.php?error=sso_failed');
    return;
}
