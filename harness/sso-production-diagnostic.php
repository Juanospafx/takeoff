<?php

declare(strict_types=1);

const DIAGNOSTIC_TOKEN_SHA256 = '__DIAGNOSTIC_TOKEN_SHA256__';

function diagnosticResponse(int $status, array $payload): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    diagnosticResponse(405, ['ok' => false]);
}

$providedToken = (string)($_SERVER['HTTP_X_TAKEOFF_DIAGNOSTIC_TOKEN'] ?? '');
if (
    preg_match('/^[a-f0-9]{64}$/D', DIAGNOSTIC_TOKEN_SHA256) !== 1
    || $providedToken === ''
    || !hash_equals(DIAGNOSTIC_TOKEN_SHA256, hash('sha256', $providedToken))
) {
    diagnosticResponse(401, ['ok' => false]);
}

$result = [
    'ok' => true,
    'config_loaded' => false,
    'oauth_client_accepted' => false,
    'oauth_classification' => 'not_checked',
    'database_connected' => false,
    'users_table' => false,
    'users_active_column' => false,
    'users_timestamps' => false,
    'links_table' => false,
    'links_active_column' => false,
    'cleanup' => false,
];

try {
    $root = __DIR__;
    require_once $root . '/vendor/autoload.php';
    require_once $root . '/config/SsoConfig.php';

    $config = \Takeoff\Config\SsoConfig::load();
    $result['config_loaded'] = $config->isEnabled();

    try {
        $client = new \GuzzleHttp\Client([
            'timeout' => $config->getTimeout(),
            'http_errors' => false,
        ]);
        $response = $client->request('POST', $config->getTokenUrl(), [
            'form_params' => [
                'grant_type' => 'authorization_code',
                'client_id' => $config->getClientId(),
                'client_secret' => $config->getClientSecret(),
                'redirect_uri' => $config->getRedirectUri(),
                'code' => 'intentional-invalid-diagnostic-code',
                'code_verifier' => str_repeat('A', 64),
            ],
        ]);
        $payload = json_decode((string)$response->getBody(), true);
        $classification = is_array($payload) ? (string)($payload['error'] ?? 'unexpected_response') : 'invalid_json';
        $result['oauth_classification'] = $classification;
        $result['oauth_client_accepted'] = $classification === 'invalid_grant';
    } catch (\Throwable) {
        $result['oauth_classification'] = 'transport_error';
    }

    try {
        require $root . '/core/db/connection.php';
        $result['database_connected'] = $pdo instanceof \PDO;

        $checks = [
            'users_table' => 'SELECT 1 FROM users LIMIT 0',
            'users_active_column' => 'SELECT active FROM users WHERE 1 = 0',
            'users_timestamps' => 'SELECT created_at, updated_at FROM users WHERE 1 = 0',
            'links_table' => 'SELECT 1 FROM sso_identity_links LIMIT 0',
            'links_active_column' => 'SELECT active FROM sso_identity_links WHERE 1 = 0',
        ];
        foreach ($checks as $key => $sql) {
            try {
                $statement = $pdo->prepare($sql);
                $statement->execute();
                $result[$key] = true;
            } catch (\Throwable) {
                $result[$key] = false;
            }
        }
    } catch (\Throwable) {
        $result['database_connected'] = false;
    }
} catch (\Throwable) {
    $result['ok'] = false;
} finally {
    $result['cleanup'] = @unlink(__FILE__);
}

diagnosticResponse(200, $result);

