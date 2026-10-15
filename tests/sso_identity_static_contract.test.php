<?php
declare(strict_types=1);

/**
 * Test de contrato estático para el vínculo SSO de Takeoff (core/auth/SsoFlow.php).
 *
 * Criterios de aceptación:
 * 1. Sólo lee core/auth/SsoFlow.php y falla rojo si no existe; no define clases de producto ni fixtures.
 * 2. Exige referencias a hub_user_id, provider, active, local user, roles explícitos y rechazos de central disabled/app unauthorized.
 * 3. Exige que no exista asignación literal de admin como fallback o default; no usa red ni DB.
 */

$targetFile = dirname(__DIR__) . '/core/auth/SsoFlow.php';

// Criterio 1: Falla rojo si el archivo no existe
if (!file_exists($targetFile)) {
    fwrite(STDERR, "FAIL: Archivo objetivo no encontrado: core/auth/SsoFlow.php\n");
    exit(1);
}

$content = file_get_contents($targetFile);
if ($content === false) {
    fwrite(STDERR, "FAIL: No se pudo leer core/auth/SsoFlow.php\n");
    exit(1);
}

$errors = [];

// Criterio 2: Exige referencias obligatorias
$requiredPatterns = [
    'hub_user_id' => [
        'pattern' => '/hub_user_id/',
        'description' => 'Referencia a identificador central hub_user_id',
    ],
    'provider' => [
        'pattern' => '/provider/',
        'description' => 'Referencia a proveedor de identidad (provider)',
    ],
    'active' => [
        'pattern' => '/active/',
        'description' => 'Referencia al estado active del usuario central',
    ],
    'local user' => [
        'pattern' => '/local[_\s]?user/i',
        'description' => 'Referencia a vinculación con usuario local (local user)',
    ],
    'roles explícitos' => [
        'pattern' => '/roles?/i',
        'description' => 'Referencia y manejo explícito de roles',
    ],
    'central disabled' => [
        'pattern' => '/(central[_\s]?disabled|disabled)/i',
        'description' => 'Rechazo o manejo de cuenta central inactiva/deshabilitada (central disabled)',
    ],
    'app unauthorized' => [
        'pattern' => '/(app[_\s]?unauthorized|unauthorized)/i',
        'description' => 'Rechazo por falta de autorización en la aplicación (app unauthorized)',
    ],
    'sub' => [
        'pattern' => '/[\'"]sub[\'"]/',
        'description' => 'Referencia a identificador canónico sub',
    ],
];

foreach ($requiredPatterns as $key => $check) {
    if (!preg_match($check['pattern'], $content)) {
        $errors[] = "Falta referencia requerida a '{$key}': {$check['description']}";
    }
}

// Criterio 3: Prohíbe asignación literal de admin como fallback o default
$forbiddenAdminPatterns = [
    'Fallback con ??: ?? \'admin\'' => '/\?\?\s*[\'"]admin[\'"]/i',
    'Fallback ternario: ?: \'admin\'' => '/\?:\s*[\'"]admin[\'"]/i',
    'Caso default asignando admin' => '/default\s*:\s*[^;]*[\'"]admin[\'"]/i',
    'Asignación directa de admin a rol' => '/\$role\s*=\s*[\'"]admin[\'"]/i',
    'Variable default/fallback a admin' => '/\$(default|fallback)_[a-zA-Z0-9_]*\s*=\s*[\'"]admin[\'"]/i',
    'Clave de array default/fallback a admin' => '/[\'"](default|fallback)(_role)?[\'"]\s*=>\s*[\'"]admin[\'"]/i',
];

foreach ($forbiddenAdminPatterns as $desc => $pattern) {
    if (preg_match($pattern, $content)) {
        $errors[] = "Violación de seguridad: existe asignación literal de 'admin' como default o fallback ({$desc})";
    }
}

// Criterio 4: Prohíbe expresiones de fallback de sub a hub_user_id
$forbiddenSubFallbackPatterns = [
    'Fallback con ?? hacia hub_user_id' => '/\?\?\s*[^;]*hub_user_id/i',
    'Fallback ternario ?: hacia hub_user_id' => '/\?:\s*[^;]*hub_user_id/i',
];

foreach ($forbiddenSubFallbackPatterns as $desc => $pattern) {
    if (preg_match($pattern, $content)) {
        $errors[] = "Violación de seguridad: existe fallback de sub a hub_user_id ({$desc})";
    }
}

if (!empty($errors)) {
    fwrite(STDERR, "FAIL: Violaciones en contrato estático de core/auth/SsoFlow.php:\n");
    foreach ($errors as $error) {
        fwrite(STDERR, " - {$error}\n");
    }
    exit(1);
}

echo "OK: Contrato estático de core/auth/SsoFlow.php verificado con éxito.\n";
exit(0);
