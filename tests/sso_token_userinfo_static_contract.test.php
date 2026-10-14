<?php
declare(strict_types=1);

/**
 * SSO Token & UserInfo Static Contract Test
 * TASK-0240: Contrato estático token userinfo Takeoff
 *
 * Acceptance Criteria:
 * 1. Falla rojo si falta core/auth/OAuthIdentityProviderClient.php y no define adaptadores falsos.
 * 2. Exige authorization code, code_verifier, client secret, redirect URI exacta, intercambio server-to-server y userinfo.
 * 3. Rechaza persistencia/log de access_token, code, verifier, state y client_secret y exige errores sanitizados.
 */

$repoRoot = dirname(__DIR__);
$targetFile = $repoRoot . '/core/auth/OAuthIdentityProviderClient.php';

$errors = [];

// 1. Verificación de existencia del archivo objetivo (sin adaptadores falsos ni mocks de fallback)
if (!file_exists($targetFile)) {
    fwrite(STDERR, "RED TEST: core/auth/OAuthIdentityProviderClient.php no existe.\n");
    fwrite(STDERR, "El contrato exige la implementación real en core/auth/OAuthIdentityProviderClient.php sin adaptadores falsos.\n");
    exit(1);
}

$contents = file_get_contents($targetFile);
if ($contents === false || trim($contents) === '') {
    fwrite(STDERR, "RED TEST: core/auth/OAuthIdentityProviderClient.php está vacío o no es legible.\n");
    exit(1);
}

// Verificar que define la clase esperada
if (!preg_match('/\bclass\s+OAuthIdentityProviderClient\b/', $contents)) {
    $errors[] = "OAuthIdentityProviderClient.php debe definir la clase OAuthIdentityProviderClient.";
}

// 2. Exigir authorization code, code_verifier, client secret, redirect URI exacta, intercambio server-to-server y userinfo
$requiredTokens = [
    'authorization_code' => '/\bauthorization_code\b/i',
    'code' => '/\bcode\b/',
    'code_verifier' => '/\bcode_verifier\b/',
    'client_secret' => '/\bclient_secret\b/',
    'redirect_uri' => '/\bredirect_uri\b/',
    'userinfo' => '/\buserinfo\b/i',
];

foreach ($requiredTokens as $name => $pattern) {
    if (!preg_match($pattern, $contents)) {
        $errors[] = "Falta soporte explícito para '{$name}' en el flujo de autenticación.";
    }
}

// Verificar intercambio server-to-server (método HTTP POST para intercambio de tokens y petición para userinfo)
$hasServerToServerExchange = (
    (preg_match('/\bcurl_init\b/i', $contents) || preg_match('/\bstream_context_create\b/i', $contents) || preg_match('/\bfile_get_contents\b/i', $contents) || preg_match('/\bHttpClient\b/i', $contents))
    && (preg_match('/\bPOST\b/i', $contents) || preg_match('/CURLOPT_POST/i', $contents))
);

if (!$hasServerToServerExchange) {
    $errors[] = "OAuthIdentityProviderClient debe implementar intercambio de tokens server-to-server mediante petición HTTP POST segura.";
}

// Verificar método para userinfo con token Bearer
$hasUserinfoFetch = preg_match('/\b(getUserInfo|fetchUserInfo|userinfo)\b/i', $contents)
    && (preg_match('/Bearer\b/i', $contents) || preg_match('/Authorization/i', $contents));

if (!$hasUserinfoFetch) {
    $errors[] = "OAuthIdentityProviderClient debe implementar obtención de userinfo enviando el token en cabecera Authorization: Bearer.";
}

// 3. Rechazar persistencia/log de access_token, code, verifier, state y client_secret y exigir errores sanitizados
// Patrones prohibidos: logs o persistencia de secretos/tokens en texto plano
$forbiddenPatterns = [
    'log_sensitive_data' => '/(error_log|syslog|\b->log|\b->debug|\b->info|\b->error)\s*\([^)]*\$(access_token|code|verifier|code_verifier|state|client_secret)\b/i',
    'dump_sensitive_data' => '/(var_dump|print_r|var_export)\s*\([^)]*\$(access_token|code|verifier|code_verifier|state|client_secret)\b/i',
    'file_persistence_sensitive_data' => '/file_put_contents\s*\([^)]*\$(access_token|code|verifier|code_verifier|state|client_secret)\b/i',
    'plain_token_logging' => '/(error_log|syslog)\s*\([^)]*["\'].*(access_token|code_verifier|client_secret).*["\']/i',
];

foreach ($forbiddenPatterns as $rule => $pattern) {
    if (preg_match($pattern, $contents)) {
        $errors[] = "Violación de seguridad [{$rule}]: se detectó persistencia o logging de credenciales/tokens sensibles (access_token, code, verifier, state, client_secret).";
    }
}

// Exigir errores sanitizados (no exponer tokens ni client_secret en mensajes de excepción ni logs)
$hasSanitizedErrors = preg_match('/(sanitize|sanitizeError|cleanError|maskSecret|redact)/i', $contents)
    || (preg_match('/catch\s*\(\s*(Exception|\Throwable)/i', $contents) && !preg_match('/throw\s+new\s+\w*Exception\s*\([^)]*\$(access_token|client_secret|code_verifier)\b/i', $contents));

if (!$hasSanitizedErrors) {
    $errors[] = "OAuthIdentityProviderClient debe implementar manejo y sanitización de errores sin filtrar secretos ni tokens.";
}

// Verificación de adaptadores falsos o stubs dentro del archivo
if (preg_match('/\b(class\s+Fake|class\s+Mock|class\s+Dummy|interface\s+Fake)\b/i', $contents)) {
    $errors[] = "No se permiten adaptadores falsos o mocks dentro de core/auth/OAuthIdentityProviderClient.php.";
}

// Reporte de resultados
if (!empty($errors)) {
    fwrite(STDERR, "FAIL: Se encontraron " . count($errors) . " violaciones al contrato estático:\n");
    foreach ($errors as $idx => $err) {
        fwrite(STDERR, "  [" . ($idx + 1) . "] " . $err . "\n");
    }
    exit(1);
}

echo "PASS: El contrato estático para OAuthIdentityProviderClient.php es válido y cumple todas las restricciones de seguridad.\n";
exit(0);
