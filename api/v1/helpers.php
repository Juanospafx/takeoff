<?php
declare(strict_types=1);

function json_response(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($payload);
    exit;
}

function ok_response($data, array $meta = null, int $status = 200): void
{
    $payload = ['ok' => true, 'data' => $data];
    if ($meta !== null) {
        $payload['meta'] = $meta;
    }
    json_response($status, $payload);
}

function error_response(string $code, string $message, $details = null, int $status = 400): void
{
    $error = ['code' => $code, 'message' => $message];
    if ($details !== null) {
        $error['details'] = $details;
    }
    json_response($status, ['ok' => false, 'error' => $error]);
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function get_raw_body(): string
{
    $raw = file_get_contents('php://input');
    return $raw === false ? '' : $raw;
}

function get_header_value(string $name): ?string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return $_SERVER[$key] ?? null;
}

function require_int($value): ?int
{
    if (is_numeric($value)) {
        $intVal = (int)$value;
        return $intVal > 0 ? $intVal : null;
    }
    return null;
}

function require_string($value): ?string
{
    if (!is_string($value)) return null;
    $trim = trim($value);
    return $trim === '' ? null : $trim;
}

function get_request_path(): string
{
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $path = parse_url($uri, PHP_URL_PATH);
    return $path ?: '/';
}

function get_request_method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function set_client_context(string $clientId, string $role): void
{
    $GLOBALS['API_CLIENT_ID'] = $clientId;
    $GLOBALS['API_CLIENT_ROLE'] = $role;
}

function get_client_id(): ?string
{
    return $GLOBALS['API_CLIENT_ID'] ?? null;
}

function get_client_role(): ?string
{
    return $GLOBALS['API_CLIENT_ROLE'] ?? null;
}

function require_client_role(string $role): void
{
    if (get_client_role() !== $role) {
        error_response('FORBIDDEN', 'Insufficient privileges', null, 403);
    }
}
