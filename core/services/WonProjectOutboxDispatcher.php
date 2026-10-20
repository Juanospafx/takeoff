<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/WonProjectIntegrationConfig.php';
require_once __DIR__ . '/WonProjectHmacClient.php';

/**
 * Transactional outbox dispatcher for WonProject export events.
 *
 * Implements:
 *   - Non-blocking global named lock (MariaDB 10.11+ / MySQL) with guaranteed release in finally
 *   - Atomic lease claiming per row compatible with MariaDB 10.11+ and SQLite
 *   - At-least-once delivery with external idempotency
 *   - Delivery marking (HTTP 200/201 -> delivered)
 *   - Deterministic exponential backoff on transient failures
 *   - Terminal failure marking on unrecoverable HTTP status (400, 401, 403, 409, 422) or exhausted attempts (5)
 *   - Strict sanitization of persisted errors (no secrets, endpoints, key IDs, payloads, SQL, or stack traces)
 *   - Operator retry method restricted strictly to concrete positive record IDs
 */
class WonProjectOutboxDispatcher
{
    public const MAX_ATTEMPTS = 5;
    public const BASE_BACKOFF_SECONDS = 30;
    public const MAX_BACKOFF_SECONDS = 3600;
    public const LEASE_MINUTES = 5;
    public const LOCK_NAME = 'won_project_outbox_dispatcher';
    public const LOCK_PREFIX = 'wp_outbox_';
    public const MAX_ERROR_LENGTH = 500;

    private PDO $pdo;
    private WonProjectIntegrationConfig $config;
    private WonProjectHmacClient $client;
    private ?string $resolvedLockName = null;

    public function __construct(
        PDO $pdo,
        ?WonProjectIntegrationConfig $config = null,
        ?WonProjectHmacClient $client = null
    ) {
        $this->pdo = $pdo;
        $this->config = $config ?? WonProjectIntegrationConfig::load();
        $this->client = $client ?? new WonProjectHmacClient($this->config);
    }

    /**
     * Claims and dispatches a batch of pending outbox events.
     *
     * @param int $limit Maximum number of events to process in this run
     * @return array Summary of batch dispatch results
     */
    public function dispatchBatch(int $limit = 50): array
    {
        if ($limit <= 0) {
            $limit = 50;
        }

        // Feature flag: disabled state bypasses all outbox claims and dispatches
        if (!$this->config->isExportEnabled()) {
            return [
                'claimed' => 0,
                'dispatched' => 0,
                'delivered' => 0,
                'failed' => 0,
                'retried' => 0,
                'status' => 'disabled',
            ];
        }

        $driver = (string)$this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        $isMySql = in_array(strtolower($driver), ['mysql', 'mariadb'], true);
        $lockAcquired = false;

        if ($isMySql) {
            $lockAcquired = $this->acquireLock();
            if (!$lockAcquired) {
                return [
                    'claimed' => 0,
                    'dispatched' => 0,
                    'delivered' => 0,
                    'failed' => 0,
                    'retried' => 0,
                    'status' => 'busy',
                ];
            }
        }

        try {
            $workerId = 'dispatcher-' . getmypid() . '-' . substr(bin2hex(random_bytes(4)), 0, 8);
            $records = $this->claimBatch($workerId, $limit);

            $claimed = count($records);
            $delivered = 0;
            $failed = 0;
            $retried = 0;

            foreach ($records as $record) {
                $recordId = (int)$record['id'];
                $rawPayload = (string)$record['payload'];
                $currentAttempts = (int)($record['attempts'] ?? 0);

                // Extract correlation ID if present in payload
                $correlationId = null;
                $decoded = json_decode($rawPayload, true);
                if (is_array($decoded) && isset($decoded['correlation_id'])) {
                    $correlationId = (string)$decoded['correlation_id'];
                }

                try {
                    $response = $this->client->send($rawPayload, $correlationId);
                    $statusCode = (int)($response['status_code'] ?? $response['status'] ?? 0);
                    $errorMsg = $response['error'] ?? null;
                } catch (Throwable $e) {
                    $statusCode = 0;
                    $errorMsg = $e->getMessage();
                }

                // HTTP 200/201: Successful delivery
                if ($statusCode === 200 || $statusCode === 201) {
                    $this->markDelivered($recordId);
                    $delivered++;
                    continue;
                }

                // Failure handling
                $newAttempts = $currentAttempts + 1;
                $rawError = $errorMsg ?: ("HTTP " . $statusCode . ($statusCode === 0 ? " Connection or client failure" : " Unexpected response"));
                $sanitizedError = $this->sanitizeError($rawError);

                // Terminal failure condition:
                // Reached MAX_ATTEMPTS or client error indicating unrecoverable request (400, 401, 403, 409, 422)
                $isTerminal = ($newAttempts >= self::MAX_ATTEMPTS) || in_array($statusCode, [400, 401, 403, 409, 422], true);

                if ($isTerminal) {
                    $this->markFailed($recordId, $newAttempts, $sanitizedError);
                    $failed++;
                } else {
                    $this->scheduleRetry($recordId, $newAttempts, $sanitizedError);
                    $retried++;
                }
            }

            return [
                'claimed' => $claimed,
                'dispatched' => $delivered + $failed + $retried,
                'delivered' => $delivered,
                'failed' => $failed,
                'retried' => $retried,
                'status' => 'completed',
            ];
        } finally {
            if ($isMySql && $lockAcquired) {
                $this->releaseLock();
            }
        }
    }

    /**
     * Resets a specific failed outbox record back to pending for manual operator retry.
     * Requires a concrete positive ID; mass retry is not permitted.
     * Cleans lease, attempts, and error details without duplicating any events.
     *
     * @param int $recordId Specific positive record ID to reset
     * @return int Number of affected rows
     * @throws InvalidArgumentException When record ID is not positive
     */
    public function retryFailed(int $recordId): int
    {
        if ($recordId <= 0) {
            throw new InvalidArgumentException("A valid positive record ID is required to retry a failed outbox event");
        }

        $stmt = $this->pdo->prepare("
            UPDATE won_project_outbox
            SET status = 'pending',
                attempts = 0,
                next_attempt_at = CURRENT_TIMESTAMP,
                locked_at = NULL,
                locked_by = NULL,
                lock_expires_at = NULL,
                last_error = NULL
            WHERE status = 'failed' AND id = ?
        ");
        $stmt->execute([$recordId]);

        return $stmt->rowCount();
    }

    /**
     * Resolves a stable, bounded lock name namespaced by the database name.
     * Prevents cross-database lock collisions on shared MariaDB/MySQL instances
     * without exposing the cleartext database name.
     * Guaranteed bounded to <= 64 characters (MariaDB / MySQL GET_LOCK length limit).
     */
    public function getLockName(): string
    {
        if ($this->resolvedLockName !== null) {
            return $this->resolvedLockName;
        }

        $dbName = '';
        try {
            $stmt = $this->pdo->query("SELECT DATABASE()");
            if ($stmt !== false) {
                $val = $stmt->fetchColumn();
                if (is_string($val)) {
                    $dbName = trim($val);
                }
            }
        } catch (Throwable) {
            $dbName = '';
        }

        // Namespace using SHA-256 hash to prevent exposing cleartext database name
        // Prefix (10 chars) + 54 hex chars = 64 chars total (bounded to MariaDB 64-char limit)
        $hash = hash('sha256', 'won_project_outbox:' . $dbName);
        $this->resolvedLockName = self::LOCK_PREFIX . substr($hash, 0, 54);

        return $this->resolvedLockName;
    }

    /**
     * Acquires a non-blocking MariaDB/MySQL named lock.
     */
    private function acquireLock(): bool
    {
        $lockName = $this->getLockName();
        $stmt = $this->pdo->prepare("SELECT GET_LOCK(?, 0)");
        $stmt->execute([$lockName]);
        return ((int)$stmt->fetchColumn() === 1);
    }

    /**
     * Releases the MariaDB/MySQL named lock.
     */
    private function releaseLock(): void
    {
        try {
            $lockName = $this->getLockName();
            $stmt = $this->pdo->prepare("SELECT RELEASE_LOCK(?)");
            $stmt->execute([$lockName]);
        } catch (Throwable) {
            // Suppress release failure during cleanup
        }
    }

    /**
     * Claims a batch of pending rows under an atomic lease.
     */
    private function claimBatch(string $workerId, int $limit): array
    {
        $driver = (string)$this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);

        if ($driver === 'sqlite') {
            // SQLite candidate selection and lease claim
            $candStmt = $this->pdo->prepare("
                SELECT id FROM won_project_outbox
                WHERE status = 'pending'
                  AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
                  AND (locked_at IS NULL OR lock_expires_at <= datetime('now'))
                ORDER BY next_attempt_at ASC, id ASC
                LIMIT " . (int)$limit . "
            ");
            $candStmt->execute();
            $candidateIds = $candStmt->fetchAll(PDO::FETCH_COLUMN) ?: [];

            if (empty($candidateIds)) {
                return [];
            }

            $inPlaceholders = implode(',', array_fill(0, count($candidateIds), '?'));
            $leaseStmt = $this->pdo->prepare("
                UPDATE won_project_outbox
                SET locked_at = datetime('now'),
                    locked_by = ?,
                    lock_expires_at = datetime('now', '+" . self::LEASE_MINUTES . " minutes')
                WHERE id IN ({$inPlaceholders})
                  AND status = 'pending'
                  AND (locked_at IS NULL OR lock_expires_at <= datetime('now'))
            ");
            $leaseStmt->execute(array_merge([$workerId], $candidateIds));
        } else {
            // MariaDB 10.11+ / MySQL 8.0+ atomic conditional lease claim (Option B)
            $leaseStmt = $this->pdo->prepare("
                UPDATE won_project_outbox
                SET locked_at = CURRENT_TIMESTAMP,
                    locked_by = :worker_id,
                    lock_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL " . self::LEASE_MINUTES . " MINUTE)
                WHERE status = 'pending'
                  AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
                  AND (locked_at IS NULL OR lock_expires_at <= CURRENT_TIMESTAMP OR locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL " . self::LEASE_MINUTES . " MINUTE))
                ORDER BY next_attempt_at ASC, id ASC
                LIMIT " . (int)$limit . "
            ");
            $leaseStmt->execute([':worker_id' => $workerId]);
        }

        // Fetch claimed records
        $fetchStmt = $this->pdo->prepare("
            SELECT id, event_id, project_id, event_type, payload, payload_hash, attempts
            FROM won_project_outbox
            WHERE locked_by = ? AND status = 'pending'
            ORDER BY id ASC
        ");
        $fetchStmt->execute([$workerId]);

        return $fetchStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    private function markDelivered(int $recordId): void
    {
        $stmt = $this->pdo->prepare("
            UPDATE won_project_outbox
            SET status = 'delivered',
                delivered_at = CURRENT_TIMESTAMP,
                locked_at = NULL,
                locked_by = NULL,
                lock_expires_at = NULL,
                last_error = NULL
            WHERE id = ?
        ");
        $stmt->execute([$recordId]);
    }

    private function markFailed(int $recordId, int $attempts, string $error): void
    {
        $stmt = $this->pdo->prepare("
            UPDATE won_project_outbox
            SET status = 'failed',
                attempts = ?,
                next_attempt_at = NULL,
                locked_at = NULL,
                locked_by = NULL,
                lock_expires_at = NULL,
                last_error = ?
            WHERE id = ?
        ");
        $stmt->execute([$attempts, $error, $recordId]);
    }

    private function scheduleRetry(int $recordId, int $attempts, string $error): void
    {
        $delay = $this->calculateBackoffDelay($attempts);
        $driver = (string)$this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);

        if ($driver === 'sqlite') {
            $stmt = $this->pdo->prepare("
                UPDATE won_project_outbox
                SET status = 'pending',
                    attempts = ?,
                    next_attempt_at = datetime('now', '+" . (int)$delay . " seconds'),
                    locked_at = NULL,
                    locked_by = NULL,
                    lock_expires_at = NULL,
                    last_error = ?
                WHERE id = ?
            ");
            $stmt->execute([$attempts, $error, $recordId]);
        } else {
            // MariaDB / MySQL: server clock CURRENT_TIMESTAMP with DATE_ADD
            $stmt = $this->pdo->prepare("
                UPDATE won_project_outbox
                SET status = 'pending',
                    attempts = ?,
                    next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL " . (int)$delay . " SECOND),
                    locked_at = NULL,
                    locked_by = NULL,
                    lock_expires_at = NULL,
                    last_error = ?
                WHERE id = ?
            ");
            $stmt->execute([$attempts, $error, $recordId]);
        }
    }

    public function calculateBackoffDelay(int $attempts): int
    {
        $delay = self::BASE_BACKOFF_SECONDS * (2 ** $attempts);
        return min(self::MAX_BACKOFF_SECONDS, $delay);
    }

    /**
     * Sanitizes errors stored in the database.
     * Prevents recording secret material, endpoints, key IDs, payloads, SQL, and stack traces.
     */
    private function sanitizeError(string $error): string
    {
        // Redact secret
        $secret = $this->config->getHmacSecret();
        if ($secret !== '') {
            $error = str_replace($secret, '***REDACTED***', $error);
        }

        // Redact key ID
        $keyId = $this->config->getHmacKeyId();
        if ($keyId !== '') {
            $error = str_replace($keyId, '***REDACTED***', $error);
        }

        // Redact endpoint & host
        $endpoint = $this->config->getEndpoint();
        if ($endpoint !== '') {
            $error = str_replace($endpoint, '[REDACTED_ENDPOINT]', $error);
            $host = parse_url($endpoint, PHP_URL_HOST);
            if ($host !== null && $host !== '') {
                $error = str_replace($host, '[REDACTED_HOST]', $error);
            }
        }
        $error = (string)preg_replace('/https?:\/\/[^\s\'"<>]+/i', '[REDACTED_URL]', $error);

        // Strip payload / body / JSON structures
        $error = (string)preg_replace('/\{[\s\S]*?\}/', '[REDACTED_BODY]', $error);
        $error = (string)preg_replace('/\[[\s\S]*?\]/', '[REDACTED_BODY]', $error);
        $error = (string)preg_replace('/(payload|body|data)=[\S]+/i', '$1=[REDACTED_BODY]', $error);

        // Strip SQL statements and SQL errors
        $error = (string)preg_replace('/(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\s+.*?(FROM|INTO|SET|TABLE)\s+.*?([;\r\n]|$)/is', '[REDACTED_SQL]', $error);
        $error = (string)preg_replace('/SQLSTATE\[[A-Z0-9]+\]:?.*/is', 'Database error occurred', $error);

        // Strip stack traces, file paths, line numbers
        $error = (string)preg_replace('/Stack trace:.*$/is', '', $error);
        $error = (string)preg_replace('/#\d+\s+.*$/m', '', $error);
        $error = (string)preg_replace('/in\s+[\/\\\\][^\s]+\s+on\s+line\s+\d+/i', '', $error);
        $error = (string)preg_replace('/([A-Za-z]:)?[\/\\\\][a-zA-Z0-9_\-\.\/\\\\]+\.php/i', '[REDACTED_PATH]', $error);

        // Strip auth tokens, credentials, headers
        $error = (string)preg_replace('/(Bearer\s+)[A-Za-z0-9\-_\.]+/i', '$1***REDACTED***', $error);
        $error = (string)preg_replace('/(password|secret|key|token|authorization)=[^;&\s]+/i', '$1=***REDACTED***', $error);
        $error = (string)preg_replace('/(X-Signature|X-Client-Id|X-Timestamp|Authorization|Cookie|Set-Cookie):\s*[^\r\n]+/i', '$1: ***REDACTED***', $error);

        $error = trim((string)preg_replace('/\s+/', ' ', $error));

        // Limit length
        if (strlen($error) > self::MAX_ERROR_LENGTH) {
            $error = substr($error, 0, self::MAX_ERROR_LENGTH) . '... [truncated]';
        }

        if ($error === '') {
            $error = 'Unknown dispatch failure';
        }

        return $error;
    }
}
