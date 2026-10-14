<?php
/**
 * Test de contrato para el feature flag de SSO en Takeoff.
 *
 * Criterios de aceptacion:
 * 1. No define clases de producto, usuarios, passwords, hashes, tokens o secretos.
 * 2. Si falta config/SsoConfig.php, falla rojo inmediatamente con diagnostico.
 *    Cuando exista, exige SSO_ENABLED false por defecto.
 * 3. Inspecciona pages/login.php real para exigir login local preservado
 *    y boton SSO condicionado al flag, sin red ni DB.
 */

declare(strict_types=1);

$ssoConfigFile = dirname(__DIR__) . '/config/SsoConfig.php';
$loginPageFile = dirname(__DIR__) . '/pages/login.php';

// Criterio 2: Si falta config/SsoConfig.php, fallar rojo inmediatamente con diagnóstico
if (!file_exists($ssoConfigFile)) {
    fwrite(STDERR, "FAIL: Falta el archivo de configuracion config/SsoConfig.php requerido para el feature flag SSO.\n");
    exit(1);
}

// Criterio 2: Cuando exista, exigir SSO_ENABLED false por defecto
require_once $ssoConfigFile;

$flagFound = false;
$flagValue = null;

if (defined('SSO_ENABLED')) {
    $flagFound = true;
    $flagValue = constant('SSO_ENABLED');
} elseif (class_exists('SsoConfig', false)) {
    if (defined('SsoConfig::SSO_ENABLED')) {
        $flagFound = true;
        $flagValue = constant('SsoConfig::SSO_ENABLED');
    } elseif (property_exists('SsoConfig', 'SSO_ENABLED')) {
        $prop = new ReflectionProperty('SsoConfig', 'SSO_ENABLED');
        if ($prop->isStatic()) {
            $flagFound = true;
            $flagValue = SsoConfig::$SSO_ENABLED;
        }
    } elseif (method_exists('SsoConfig', 'isEnabled')) {
        $flagFound = true;
        $flagValue = SsoConfig::isEnabled();
    }
}

if (!$flagFound) {
    $configContent = file_get_contents($ssoConfigFile);
    if ($configContent !== false && preg_match('/(?:const\s+SSO_ENABLED\s*=\s*|define\(\s*[\'"]SSO_ENABLED[\'"]\s*,\s*)(false|true|[01])/i', $configContent, $matches)) {
        $flagFound = true;
        $rawVal = strtolower(trim($matches[1]));
        $flagValue = ($rawVal === 'true' || $rawVal === '1');
    }
}

if (!$flagFound) {
    fwrite(STDERR, "FAIL: config/SsoConfig.php existe pero no define la constante o configuracion SSO_ENABLED.\n");
    exit(1);
}

if ($flagValue !== false) {
    fwrite(STDERR, "FAIL: SSO_ENABLED debe ser false por defecto en config/SsoConfig.php. Valor actual: " . var_export($flagValue, true) . "\n");
    exit(1);
}

// Criterio 3: Inspeccionar pages/login.php real para exigir login local preservado y botón SSO condicionado al flag, sin red ni DB
if (!file_exists($loginPageFile)) {
    fwrite(STDERR, "FAIL: Falta el archivo pages/login.php para verificar la integracion de login.\n");
    exit(1);
}

$loginContent = file_get_contents($loginPageFile);
if ($loginContent === false) {
    fwrite(STDERR, "FAIL: No se pudo leer el contenido de pages/login.php.\n");
    exit(1);
}

// 1. Exigir login local preservado (campos de usuario y contraseña)
$hasUsername = (bool)preg_match('/name=["\'](?:username|user|email|login)["\']/i', $loginContent);
$hasPassword = (bool)preg_match('/type=["\']password["\']|name=["\']password["\']/i', $loginContent);

if (!$hasUsername || !$hasPassword) {
    fwrite(STDERR, "FAIL: pages/login.php no preserva el login local (se requieren campos de usuario y contraseña).\n");
    exit(1);
}

// 2. Exigir botón SSO definido
$hasSsoButton = (bool)preg_match('/<(?:a|button|input)[^>]*?(?:sso|single\s*sign[\s-]on)[^>]*?>|<(?:a|button)[^>]*?>[\s\S]*?(?:sso|single\s*sign[\s-]on)[\s\S]*?<\/(?:a|button)>/i', $loginContent);
if (!$hasSsoButton) {
    fwrite(STDERR, "FAIL: pages/login.php no define un boton o enlace para inicio de sesion SSO.\n");
    exit(1);
}

// 3. Exigir que el botón SSO esté condicionado al feature flag (SSO_ENABLED o SsoConfig)
$conditionedDirect = (bool)preg_match('/if\s*\([^)]*?(?:SSO_ENABLED|SsoConfig)[^)]*?\)[\s\S]*?(?:<(?:a|button|input)[\s\S]*?(?:sso|single\s*sign[\s-]on)[\s\S]*?<\/(?:a|button)>|<(?:a|button|input)[^>]*?(?:sso|single\s*sign[\s-]on)[^>]*?>)[\s\S]*?(?:endif|\})/i', $loginContent);

$conditionedVar = false;
if (preg_match('/(\$[a-zA-Z0-9_]*sso[a-zA-Z0-9_]*)\s*=\s*[^;]*?(?:SSO_ENABLED|SsoConfig)/i', $loginContent, $varMatches)) {
    $escapedVar = preg_quote($varMatches[1], '/');
    $conditionedVar = (bool)preg_match('/if\s*\([^)]*?' . $escapedVar . '[^)]*?\)[\s\S]*?(?:<(?:a|button|input)[\s\S]*?(?:sso|single\s*sign[\s-]on)[\s\S]*?<\/(?:a|button)>|<(?:a|button|input)[^>]*?(?:sso|single\s*sign[\s-]on)[^>]*?>)[\s\S]*?(?:endif|\})/i', $loginContent);
}

if (!$conditionedDirect && !$conditionedVar) {
    fwrite(STDERR, "FAIL: El boton SSO en pages/login.php no esta condicionado al feature flag SSO_ENABLED o SsoConfig.\n");
    exit(1);
}

echo "PASS: Contrato de feature flag SSO verificado correctamente.\n";
exit(0);
