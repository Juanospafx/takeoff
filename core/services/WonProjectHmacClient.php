<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/WonProjectIntegrationConfig.php';

/**
 * HTTPS client for WonProject export with HMAC-SHA256 signature authentication.
 *
 * Signature canonical structure:
 *   hash_hmac('sha256', METHOD . "\n" . PATH . "\n" . TIMESTAMP . "\n" . RAW_BODY, secret)
 *
 * Headers sent:
 *   - Content-Type: application/json
 *   - X-Client-Id: <active-key-id>
 *   - X-Timestamp: <unix-timestamp>
 *   - X-Signature: <hmac-sha256-hex>
 *   - X-Correlation-Id: <correlation-id> (when present)
 */
class WonProjectHmacClient
{
    public const MAX_RESPONSE_BODY_LENGTH = 4096;
    public const MAX_ERROR_LENGTH = 1000;

    private WonProjectIntegrationConfig $config;
    /** @var callable|null */
    private $transport;

    public function __construct(WonProjectIntegrationConfig $config, ?callable $transport = null)
    {
        $this->config = $config;
        $this->transport = $transport;
    }

    /**
     * Injects or clears a test transport callable.
     * Transport signature: callable(string $url, array $headers, string $rawBody, int $timeout): array
     */
    public function setTransport(?callable $transport): void
    {
        $this->transport = $transport;
    }

    /**
     * Computes the canonical HMAC-SHA256 signature:
     * POST newline path real newline timestamp newline raw body
     */
    public function sign(string $method, string $path, string|int $timestamp, string $rawJson): string
    {
        $payloadToSign = $method . "\n" . $path . "\n" . (string)$timestamp . "\n" . $rawJson;
        return hash_hmac('sha256', $payloadToSign, $this->config->getHmacSecret());
    }

    /**
     * Dispatches a raw JSON event payload to the configured HTTPS endpoint.
     *
     * @param string $rawJson Canonical JSON payload
     * @param string|null $correlationId Optional tracing correlation ID
     * @return array{status: int, status_code: int, body: string, success: bool, error: ?string}
     * @throws InvalidArgumentException When the destination endpoint is not HTTPS or contains credentials
     */
    public function send(string $rawJson, ?string $correlationId = null): array
    {
        $endpoint = $this->config->getEndpoint();
        $scheme = parse_url($endpoint, PHP_URL_SCHEME);
        if (!is_string($scheme) || strtolower($scheme) !== 'https') {
            throw new InvalidArgumentException("Insecure dispatch rejected: HTTPS scheme is strictly required.");
        }

        $user = parse_url($endpoint, PHP_URL_USER);
        $pass = parse_url($endpoint, PHP_URL_PASS);
        if (($user !== null && $user !== false) || ($pass !== null && $pass !== false)) {
            throw new InvalidArgumentException("Insecure dispatch rejected: Endpoint must not contain URL credentials.");
        }

        $parsedPath = parse_url($endpoint, PHP_URL_PATH);
        $path = (is_string($parsedPath) && $parsedPath !== '') ? $parsedPath : '/';

        $timestamp = (string)time();
        $signature = $this->sign('POST', $path, $timestamp, $rawJson);

        $headers = [
            'Content-Type: application/json',
            'X-Client-Id: ' . $this->config->getHmacKeyId(),
            'X-Timestamp: ' . $timestamp,
            'X-Signature: ' . $signature,
        ];

        if ($correlationId !== null && trim($correlationId) !== '') {
            $headers[] = 'X-Correlation-Id: ' . trim($correlationId);
        }

        $timeout = $this->config->getTimeoutSeconds();

        // 1. Injected test transport
        if ($this->transport !== null) {
            try {
                $response = ($this->transport)($endpoint, $headers, $rawJson, $timeout);
                $statusCode = (int)($response['status_code'] ?? $response['status'] ?? 200);
                $rawBody = (string)($response['body'] ?? '');
                $body = $this->limitResponseBody($rawBody);
                $error = isset($response['error']) && $response['error'] !== null
                    ? $this->sanitizeError((string)$response['error'])
                    : null;
                $success = ($statusCode >= 200 && $statusCode < 300 && $error === null);

                if (!$success && $error === null) {
                    $error = "HTTP {$statusCode} error";
                }

                return [
                    'status' => $statusCode,
                    'status_code' => $statusCode,
                    'body' => $body,
                    'success' => $success,
                    'error' => $error,
                ];
            } catch (Throwable $e) {
                return [
                    'status' => 0,
                    'status_code' => 0,
                    'body' => '',
                    'success' => false,
                    'error' => $this->sanitizeError($e->getMessage()),
                ];
            }
        }

        // 2. Production cURL transport
        if (!function_exists('curl_init')) {
            return [
                'status' => 0,
                'status_code' => 0,
                'body' => '',
                'success' => false,
                'error' => 'cURL PHP extension is not available',
            ];
        }

        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $rawJson,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
            CURLOPT_FOLLOWLOCATION => false, // Strictly prohibited from following redirects
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);

        $responseBody = curl_exec($ch);
        $statusCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        $bodyStr = is_string($responseBody) ? $this->limitResponseBody($responseBody) : '';
        $success = ($statusCode >= 200 && $statusCode < 300 && $curlError === '');

        if ($curlError !== '') {
            $errorMsg = $this->sanitizeError($curlError);
        } elseif (!$success) {
            $errorMsg = "HTTP {$statusCode} error";
        } else {
            $errorMsg = null;
        }

        return [
            'status' => $statusCode,
            'status_code' => $statusCode,
            'body' => $bodyStr,
            'success' => $success,
            'error' => $errorMsg,
        ];
    }

    /**
     * Enforces bounded response body representation.
     */
    private function limitResponseBody(string $body): string
    {
        if (strlen($body) > self::MAX_RESPONSE_BODY_LENGTH) {
            return substr($body, 0, self::MAX_RESPONSE_BODY_LENGTH) . '... [truncated]';
        }
        return $body;
    }

    /**
     * Sanitizes error messages ensuring endpoints, secrets, headers, and tokens are never leaked.
     */
    private function sanitizeError(string $error): string
    {
        $secret = $this->config->getHmacSecret();
        if ($secret !== '') {
            $error = str_replace($secret, '***REDACTED***', $error);
        }

        $keyId = $this->config->getHmacKeyId();
        if ($keyId !== '') {
            $error = str_replace($keyId, '***REDACTED***', $error);
        }

        $endpoint = $this->config->getEndpoint();
        if ($endpoint !== '') {
            $error = str_replace($endpoint, '[REDACTED_ENDPOINT]', $error);
            $host = parse_url($endpoint, PHP_URL_HOST);
            if ($host !== null && $host !== '') {
                $error = str_replace($host, '[REDACTED_HOST]', $error);
            }
        }
        $error = (string)preg_replace('/https?:\/\/[^\s\'"<>]+/i', '[REDACTED_URL]', $error);

        $error = (string)preg_replace('/(Bearer\s+)[A-Za-z0-9\-_\.]+/i', '$1***REDACTED***', $error);
        $error = (string)preg_replace('/(password|secret|key|token|authorization)=[^;&\s]+/i', '$1=***REDACTED***', $error);
        $error = (string)preg_replace('/(X-Signature|X-Client-Id|X-Timestamp|X-Correlation-Id|Authorization|Cookie|Set-Cookie):\s*[^\r\n]+/i', '$1: ***REDACTED***', $error);

        if (strlen($error) > self::MAX_ERROR_LENGTH) {
            $error = substr($error, 0, self::MAX_ERROR_LENGTH) . '... [truncated]';
        }

        return $error;
    }
}
