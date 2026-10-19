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
            try {
                // Resolve database connection (injected mock or production connection)
                $pdo = $GLOBALS['__TAKEOFF_TEST_PDO__'] ?? $GLOBALS['__TAKEOFF_PDO__'] ?? null;
                if ($pdo === null) {
                    require_once dirname(__DIR__) . '/core/db/connection.php';
                }

                // Parameterized lookup against users table
                $stmt = $pdo->prepare('SELECT id, username, password, role, active FROM users WHERE username = :username LIMIT 1');
                $stmt->execute([':username' => $username]);
                $user = $stmt->fetch(\PDO::FETCH_ASSOC);

                if (!$user || !password_verify($password, (string)$user['password'])) {
                    $error = 'Nombre de usuario o contraseña incorrectos.';
                } elseif ((int)$user['active'] !== 1) {
                    $error = 'La cuenta de usuario se encuentra inactiva.';
                } else {
                    $localRole = trim((string)$user['role']);
                    if (!\Takeoff\Core\Auth\SsoAuthorization::isAllowedRole($localRole)) {
                        $error = 'La cuenta de usuario no tiene un rol válido asignado.';
                    } else {
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
                $error = 'Error de conexión o base de datos. Por favor intente más tarde.';
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
    <style>
        *, *::before, *::after { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
            background-color: #f4f6f8;
            color: #333333;
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .login-card {
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
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
            font-weight: 600;
            color: #1a202c;
        }
        .login-header p {
            margin: 0;
            color: #718096;
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
            background-color: #feebc8;
            border: 1px solid #fbd38d;
            color: #742a2a;
        }
        .alert-success {
            background-color: #c6f6d5;
            border: 1px solid #9ae6b4;
            color: #22543d;
        }
        .form-group {
            margin-bottom: 18px;
        }
        .form-group label {
            display: block;
            margin-bottom: 6px;
            font-size: 14px;
            font-weight: 500;
            color: #4a5568;
        }
        .form-group input {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            font-size: 14px;
            color: #2d3748;
            transition: border-color 0.15s ease-in-out;
        }
        .form-group input:focus {
            outline: none;
            border-color: #3182ce;
            box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.15);
        }
        .btn {
            display: inline-block;
            width: 100%;
            padding: 11px 16px;
            font-size: 15px;
            font-weight: 600;
            text-align: center;
            border-radius: 6px;
            cursor: pointer;
            text-decoration: none;
            transition: background-color 0.15s ease-in-out;
            border: none;
        }
        .btn-primary {
            background-color: #3182ce;
            color: #ffffff;
        }
        .btn-primary:hover {
            background-color: #2b6cb0;
        }
        <?php if ($ssoEnabled): ?>
        .sso-divider {
            display: flex;
            align-items: center;
            text-align: center;
            margin: 24px 0 20px 0;
            color: #a0aec0;
            font-size: 13px;
        }
        .sso-divider::before, .sso-divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid #e2e8f0;
        }
        .sso-divider span {
            padding: 0 10px;
        }
        .btn-sso {
            background-color: #2d3748;
            color: #ffffff;
            display: block;
        }
        .btn-sso:hover {
            background-color: #1a202c;
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
