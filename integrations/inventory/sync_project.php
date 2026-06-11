<?php
declare(strict_types=1);

/**
 * Sync one Electroplan project to Inventory integration endpoint.
 *
 * Usage:
 *   php integrations/inventory/sync_project.php <project_id>
 *
 * Required env vars:
 *   ELECTROPLAN_API_BASE       e.g. http://127.0.0.1
 *   ELECTROPLAN_CLIENT_ID      e.g. crm
 *   ELECTROPLAN_CLIENT_SECRET  hmac secret
 *   INVENTORY_UPSERT_URL       full URL to inventory upsert endpoint
 * Optional env vars:
 *   INVENTORY_SHARED_KEY       sent as X-Integration-Key when present
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Run this script from CLI only.\n");
    exit(1);
}

$projectId = isset($argv[1]) ? (int)$argv[1] : 0;
if ($projectId <= 0) {
    fwrite(STDERR, "Usage: php integrations/inventory/sync_project.php <project_id>\n");
    exit(1);
}

$electroplanBase = rtrim((string)getenv('ELECTROPLAN_API_BASE'), '/');
$electroplanClientId = (string)getenv('ELECTROPLAN_CLIENT_ID');
$electroplanSecret = (string)getenv('ELECTROPLAN_CLIENT_SECRET');
$inventoryUpsertUrl = (string)getenv('INVENTORY_UPSERT_URL');
$inventorySharedKey = (string)getenv('INVENTORY_SHARED_KEY');

if ($electroplanBase === '' || $electroplanClientId === '' || $electroplanSecret === '' || $inventoryUpsertUrl === '') {
    fwrite(STDERR, "Missing required env vars.\n");
    exit(1);
}

$exportPath = '/api/v1/projects/' . $projectId . '/export';
$exportUrl = $electroplanBase . $exportPath;
$timestamp = (string)time();
$rawBody = '';
$signaturePayload = "GET\n{$exportPath}\n{$timestamp}\n{$rawBody}";
$signature = hash_hmac('sha256', $signaturePayload, $electroplanSecret);

[$exportCode, $exportBody, $exportErr] = http_request(
    'GET',
    $exportUrl,
    [
        'X-Client-Id: ' . $electroplanClientId,
        'X-Timestamp: ' . $timestamp,
        'X-Signature: ' . $signature,
    ],
    null
);

if ($exportErr !== null) {
    fwrite(STDERR, "Export request failed: {$exportErr}\n");
    exit(2);
}

if ($exportCode !== 200) {
    fwrite(STDERR, "Export request HTTP {$exportCode}: {$exportBody}\n");
    exit(2);
}

$parsed = json_decode($exportBody, true);
if (!is_array($parsed) || !isset($parsed['ok']) || $parsed['ok'] !== true) {
    fwrite(STDERR, "Invalid export payload: {$exportBody}\n");
    exit(2);
}

$payload = $parsed['data']['export'] ?? null;
if (!is_array($payload)) {
    fwrite(STDERR, "Export payload missing data.export: {$exportBody}\n");
    exit(2);
}

$inventoryHeaders = [
    'Content-Type: application/json',
];
if ($inventorySharedKey !== '') {
    $inventoryHeaders[] = 'X-Integration-Key: ' . $inventorySharedKey;
}

$inventoryJson = json_encode($payload);
[$inventoryCode, $inventoryBody, $inventoryErr] = http_request(
    'POST',
    $inventoryUpsertUrl,
    $inventoryHeaders,
    $inventoryJson === false ? '{}' : $inventoryJson
);

if ($inventoryErr !== null) {
    fwrite(STDERR, "Inventory request failed: {$inventoryErr}\n");
    exit(3);
}

if ($inventoryCode < 200 || $inventoryCode >= 300) {
    fwrite(STDERR, "Inventory request HTTP {$inventoryCode}: {$inventoryBody}\n");
    exit(3);
}

fwrite(STDOUT, "Sync OK project_id={$projectId} inventory_http={$inventoryCode}\n");
fwrite(STDOUT, $inventoryBody . "\n");
exit(0);

function http_request(string $method, string $url, array $headers, ?string $body): array
{
    $ch = curl_init($url);
    if ($ch === false) {
        return [0, '', 'curl_init failed'];
    }

    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }

    $response = curl_exec($ch);
    $error = curl_error($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false) {
        return [$httpCode, '', $error !== '' ? $error : 'unknown curl error'];
    }

    return [$httpCode, $response, null];
}
