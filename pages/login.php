<?php
declare(strict_types=1);

/**
 * Takeoff Local and Federated SSO Login Entry Point.
 *
 * Implements:
 * 1. Safe local-login rollback path with parameterized database lookup,
 *    password_verify, active-user check, and explicit role validation.
 * 2. CSRF protection on POST submissions.
 * 3. Session ID regeneration upon successful local login.
 * 4. Conditional SSO button visible only when SSO is explicitly enabled.
 * 5. Sanitized error messages and seamless fallback when central Hub is unavailable.
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
require_once dirname(__DIR__) . '/core/auth/SsoSession.php';
require_once dirname(__DIR__) . '/core/auth/SsoAuthorization.php';
require_once dirname(__DIR__) . '/core/auth/LoginRateLimiter.php';

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

// Generate CSRF token for the local login form
if (empty($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
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

// Feature flag conditioning for SSO button
$ssoEnabled = ($ssoConfig instanceof \Takeoff\Config\SsoConfig) ? $ssoConfig->isEnabled() : (defined('SSO_ENABLED') && SSO_ENABLED);

$error = null;
$message = null;

// Parse messages and errors from query string (e.g. from callback or logout)
if (isset($_GET['logged_out']) && (string)$_GET['logged_out'] === '1') {
    $message = 'Ha cerrado sesión correctamente.';
}

if (isset($_GET['error'])) {
    $errorCode = (string)$_GET['error'];
    if ($errorCode === 'sso_disabled') {
        $error = 'El inicio de sesión SSO está deshabilitado. Por favor inicie sesión con sus credenciales locales.';
    } elseif ($errorCode === 'sso_failed') {
        $error = 'El servicio de autenticación central no está disponible. Por favor inicie sesión con sus credenciales locales.';
    } elseif ($errorCode === 'unauthorized') {
        $error = 'Acceso no autorizado: la cuenta de usuario central o el vínculo local no está activo o carece de permisos.';
    } else {
        $error = 'Ocurrió un error durante la autenticación. Por favor intente con sus credenciales locales.';
    }
}

// Process local login POST
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $submittedCsrf = $_POST['csrf_token'] ?? null;
    $sessionCsrf = $_SESSION['csrf_token'] ?? '';

    if (!is_string($submittedCsrf) || !is_string($sessionCsrf) || $sessionCsrf === '' || !hash_equals($sessionCsrf, $submittedCsrf)) {
        $error = 'Error de validación de seguridad (CSRF). Por favor intente nuevamente.';
    } else {
        $username = trim((string)($_POST['username'] ?? ''));
        $password = (string)($_POST['password'] ?? '');

        if ($username === '' || $password === '') {
            $error = 'Por favor ingrese su nombre de usuario y contraseña.';
        } else {
            $clientAddress = trim((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
            try {
                if (PHP_SAPI !== 'cli' && \Takeoff\Core\Auth\LoginRateLimiter::isBlocked($clientAddress, $username)) {
                    $error = 'Demasiados intentos de inicio de sesión. Espere 15 minutos e intente nuevamente.';
                }

                if ($error !== null) {
                    throw new \RuntimeException('Login throttled.');
                }

                // Resolve database connection (injected mock or production connection)
                $pdo = $GLOBALS['__TAKEOFF_TEST_PDO__'] ?? $GLOBALS['__TAKEOFF_PDO__'] ?? null;
                if ($pdo === null) {
                    require_once dirname(__DIR__) . '/core/db/connection.php';
                }

                // Newer installations expose users.active, while the canonical
                // legacy schema has only id, username, password and role.
                try {
                    $stmt = $pdo->prepare('SELECT id, username, password, role, active FROM users WHERE username = :username LIMIT 1');
                    $stmt->execute([':username' => $username]);
                } catch (\PDOException $queryError) {
                    $sqlState = (string)($queryError->errorInfo[0] ?? $queryError->getCode());
                    $driverCode = (int)($queryError->errorInfo[1] ?? $queryError->getCode());
                    if ($sqlState !== '42S22' && $driverCode !== 1054) {
                        throw $queryError;
                    }
                    $stmt = $pdo->prepare('SELECT id, username, password, role FROM users WHERE username = :username LIMIT 1');
                    $stmt->execute([':username' => $username]);
                }
                $user = $stmt->fetch(\PDO::FETCH_ASSOC);

                if (!$user || !password_verify($password, (string)$user['password'])) {
                    if (PHP_SAPI !== 'cli') {
                        \Takeoff\Core\Auth\LoginRateLimiter::registerFailure($clientAddress, $username);
                    }
                    $error = 'Nombre de usuario o contraseña incorrectos.';
                } elseif (array_key_exists('active', $user) && (int)$user['active'] !== 1) {
                    $error = 'La cuenta de usuario se encuentra inactiva.';
                } else {
                    $localRole = trim((string)$user['role']);
                    if (!\Takeoff\Core\Auth\SsoAuthorization::isAllowedRole($localRole)) {
                        $error = 'La cuenta de usuario no tiene un rol válido asignado.';
                    } else {
                        if (PHP_SAPI !== 'cli') {
                            \Takeoff\Core\Auth\LoginRateLimiter::clear($clientAddress, $username);
                        }
                        // Regenerate session ID to prevent session fixation
                        if (isset($GLOBALS['__TAKEOFF_SESSION_REGENERATOR__']) && is_callable($GLOBALS['__TAKEOFF_SESSION_REGENERATOR__'])) {
                            ($GLOBALS['__TAKEOFF_SESSION_REGENERATOR__'])();
                        } elseif (session_status() === PHP_SESSION_ACTIVE) {
                            @session_regenerate_id(true);
                        }

                        // Establish local application session
                        $_SESSION['user_id'] = (int)$user['id'];
                        $_SESSION['username'] = (string)$user['username'];
                        $_SESSION['role'] = $localRole;
                        $_SESSION['auth_source'] = 'local';

                        // Clean up any stale SSO transient flow data
                        unset(
                            $_SESSION['sso_state'],
                            $_SESSION['sso_state_expires_at'],
                            $_SESSION['sso_code_verifier']
                        );

                        // Rotate CSRF token
                        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

                        takeoff_redirect('/pages/takeoff.php');
                        return;
                    }
                }
            } catch (\Throwable $e) {
                if ($e->getMessage() !== 'Login throttled.') {
                    $error = 'Error de conexión o base de datos. Por favor intente más tarde.';
                }
            }
        }
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Iniciar Sesión - Takeoff</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../assets/design_system.css?v=<?= filemtime(__DIR__ . '/../assets/design_system.css') ?>">
    <style>
        *, *::before, *::after { box-sizing: border-box; }
        body {
            font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg-body, #f5f6f8);
            color: var(--text-main, #0f172a);
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .login-card {
            background: var(--bg-panel, #ffffff);
            border: 1px solid var(--border, #d5d8dc);
            border-radius: 10px;
            box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
            width: 100%;
            max-width: 420px;
            padding: 32px;
            margin: 16px;
        }
        .login-header {
            text-align: center;
            margin-bottom: 24px;
        }
        .login-header h1 {
            margin: 0 0 8px 0;
            font-size: 24px;
            font-weight: 700;
            color: var(--text-main, #0f172a);
        }
        .login-header p {
            margin: 0;
            color: var(--text-muted, #64748b);
            font-size: 14px;
        }
        .alert {
            padding: 12px 16px;
            border-radius: 6px;
            font-size: 14px;
            margin-bottom: 20px;
            line-height: 1.4;
        }
        .alert-danger {
            background-color: #fef2f2;
            border: 1px solid #fecaca;
            color: #991b1b;
        }
        .alert-success {
            background-color: #ecfdf5;
            border: 1px solid #a7f3d0;
            color: #065f46;
        }
        .form-group {
            margin-bottom: 18px;
        }
        .form-group label {
            display: block;
            margin-bottom: 6px;
            font-size: 13px;
            font-weight: 600;
            color: var(--text-main, #0f172a);
        }
        .form-group input {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--border, #d5d8dc);
            border-radius: 6px;
            font-size: 14px;
            color: var(--text-main, #0f172a);
            background: var(--bg-panel, #ffffff);
            transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
        }
        .form-group input:focus {
            outline: none;
            border-color: var(--primary, #fb5a3a);
            box-shadow: 0 0 0 3px rgba(251, 90, 58, 0.18);
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            min-height: 40px;
            padding: 10px 16px;
            font-size: 14.5px;
            font-weight: 700;
            text-align: center;
            border-radius: 6px;
            cursor: pointer;
            text-decoration: none;
            transition: background-color 0.15s ease-in-out, transform 0.15s ease;
            border: none;
        }
        .btn-primary {
            background-color: var(--primary, #fb5a3a);
            color: #ffffff;
        }
        .btn-primary:hover {
            background-color: var(--primary-hover, #e14e32);
        }
        <?php if ($ssoEnabled): ?>
        .sso-divider {
            display: flex;
            align-items: center;
            text-align: center;
            margin: 24px 0 20px 0;
            color: var(--text-muted, #64748b);
            font-size: 13px;
        }
        .sso-divider::before, .sso-divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid var(--border, #d5d8dc);
        }
        .sso-divider span {
            padding: 0 10px;
        }
        .btn-sso {
            background-color: #242a38;
            color: #ffffff;
            display: inline-flex;
        }
        .btn-sso:hover {
            background-color: #1b212d;
            color: #ffffff;
        }
        <?php endif; ?>
    </style>
</head>
<body>
    <div class="login-card">
        <div class="login-header">
            <h1>Takeoff</h1>
            <p>Acceso a la plataforma de estimaciones</p>
        </div>

        <?php if (!empty($error)): ?>
            <div class="alert alert-danger" role="alert">
                <?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?>
            </div>
        <?php endif; ?>

        <?php if (!empty($message)): ?>
            <div class="alert alert-success" role="alert">
                <?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?>
            </div>
        <?php endif; ?>

        <form method="POST" action="/pages/login.php" autocomplete="off">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($_SESSION['csrf_token'] ?? '', ENT_QUOTES, 'UTF-8') ?>">

            <div class="form-group">
                <label for="username">Usuario o Correo</label>
                <input type="text" id="username" name="username" required autofocus placeholder="Nombre de usuario">
            </div>

            <div class="form-group">
                <label for="password">Contraseña</label>
                <input type="password" id="password" name="password" required placeholder="Contraseña">
            </div>

            <button type="submit" class="btn btn-primary">Iniciar sesión</button>
        </form>

        <?php if ($ssoEnabled): ?>
            <div class="sso-divider">
                <span>o</span>
            </div>
            <div class="sso-container">
                <a href="/pages/sso-login.php" class="btn btn-sso">Iniciar sesión con Hub (Single Sign-On)</a>
            </div>
        <?php endif; ?>
    </div>
</body>
</html>
