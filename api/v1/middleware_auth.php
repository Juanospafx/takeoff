<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

function verify_hmac_auth(array $config): void
{
    $clientId = get_header_value('X-Client-Id');
    $timestamp = get_header_value('X-Timestamp');
    $signature = get_header_value('X-Signature');

    if (!$clientId || !$timestamp || !$signature) {
        error_response('UNAUTHORIZED', 'Missing authentication headers', null, 401);
    }

    if (!isset($config['CLIENTS'][$clientId])) {
        error_response('UNAUTHORIZED', 'Invalid client', null, 401);
    }

    if (!ctype_digit($timestamp)) {
        error_response('UNAUTHORIZED', 'Invalid timestamp', null, 401);
    }

    $ts = (int)$timestamp;
    $now = time();
    $maxSkew = (int)($config['MAX_TIMESTAMP_SKEW'] ?? 300);

    if (abs($now - $ts) > $maxSkew) {
        error_response('UNAUTHORIZED', 'Timestamp out of range', null, 401);
    }

    $method = get_request_method();
    $path = get_request_path();
    $rawBody = get_raw_body();

    $payload = $method . "\n" . $path . "\n" . $timestamp . "\n" . $rawBody;
    $secret = $config['CLIENTS'][$clientId];

    $expected = hash_hmac('sha256', $payload, $secret);

    if (!hash_equals($expected, $signature)) {
        error_response('UNAUTHORIZED', 'Invalid signature', null, 401);
    }

    $role = $config['CLIENT_ROLES'][$clientId] ?? 'service';
    set_client_context($clientId, $role);
}
