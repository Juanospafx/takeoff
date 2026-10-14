<?php
declare(strict_types=1);

/**
 * Takeoff Local Logout Endpoint.
 *
 * Implements:
 * 1. Destroys exclusively the local application session and secure session cookie.
 * 2. Makes ZERO central or external network requests.
 * 3. Safely redirects to the local login page with logged-out confirmation.
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

require_once dirname(__DIR__) . '/core/auth/SsoSession.php';

// Configure session cookies with Secure, HttpOnly, and SameSite=Lax
\Takeoff\Core\Auth\SsoSession::configureCookieParams();

if (session_status() !== PHP_SESSION_ACTIVE) {
    if (PHP_SAPI !== 'cli' || !isset($_SESSION)) {
        @session_start();
    }
}

// Clear all session attributes
$_SESSION = [];

// Destroy session data in storage
if (session_status() === PHP_SESSION_ACTIVE) {
    @session_destroy();
}

// Invalidate session cookie with Secure, HttpOnly, and SameSite=Lax
$cookieName = session_name();
if (!empty($cookieName) && !headers_sent()) {
    setcookie($cookieName, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'domain' => '',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

// Local logout makes zero external or central network requests
takeoff_redirect('/pages/login.php?logged_out=1');
return;
