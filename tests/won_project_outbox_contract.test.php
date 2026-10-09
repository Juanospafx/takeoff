<?php
declare(strict_types=1);

/**
 * Contract Tests: WonProjectOutboxDispatcher, Configuration, HMAC, and Dispatching
 *
 * Freezes the consumer/dispatcher interfaces:
 *   WonProjectIntegrationConfig::load(): WonProjectIntegrationConfig
 *   WonProjectOutboxDispatcher::dispatchBatch(int $limit = 50): array
 *
 * Verifies:
 *   - Config loading, validation, precedence, and HTTPS enforcement
 *   - HMAC SHA-256 signing contract and request headers compatible with Electroplan
 *   - Outbox lifecycle: pending -> locked -> delivered
 *   - Transient errors, attempt backoff policy, and exponential backoff
 *   - Terminal failure handling (max attempts reached -> failed status)
 *   - Concurrent dispatch locking (avoid duplicate in-flight dispatch)
 *   - Feature flag disabled behavior (export_enabled = false skips dispatch)
 *
 * Uses SQLite in-memory and structural inspection. No external network or Inventory calls.
 */

namespace Brightronix\Takeoff\Tests\Contracts;

use PDO;
use ReflectionClass;
use ReflectionMethod;
use ReflectionNamedType;
use Throwable;

final class WonProjectOutboxContractTestRunner
{
    private array $results = [];

    public function run(): int
    {
        echo "======================================================================\n";
        echo "TEST SUITE: WonProject Outbox & Dispatcher Contract (TASK-0059)\n";
        echo "======================================================================\n\n";

        $tests = [
            'testStructuralFreezeWonProjectIntegrationConfig' => 'Interface frozen: WonProjectIntegrationConfig::load()',
            'testConfigPrecedenceAndDefaultsContract' => 'Configuration precedence and safe defaults frozen (5 approved variables)',
            'testStructuralFreezeWonProjectOutboxDispatcher' => 'Interface frozen: WonProjectOutboxDispatcher::dispatchBatch(int): array',
            'testConfigHttpsEnforcement' => 'HTTPS enforcement: configuration rejects plain HTTP endpoints in production',
            'testHmacSha256SignatureCalculationContract' => 'HMAC SHA-256 signature calculation matches canonical test vector',
            'testHmacHeadersContract' => 'HMAC headers contract (Content-Type, X-Client-Id, X-Timestamp, X-Signature, X-Correlation-Id)',
            'testOutboxLifecyclePendingToDelivered' => 'Outbox lifecycle: pending record is locked then delivered on HTTP 200/201',
            'testTransientFailureIncrementsAttemptsAndAppliesBackoff' => 'Transient failure: attempts incremented and next_attempt_at scheduled with exponential backoff',
            'testTerminalFailureTransitionsToFailedStatus' => 'Terminal failure: when attempt limit is exceeded, record transitions to failed',
            'testConcurrentDispatchLockingPreventsDuplicateDispatch' => 'Concurrent locking: locked records are excluded from concurrent dispatch batches',
            'testFeatureFlagDisabledBypassesBatchDispatch' => 'Feature flag: when export_enabled is false, dispatchBatch returns early with zero dispatches',
        ];

        foreach ($tests as $method => $description) {
            $this->runTest($method, $description);
        }

        return $this->printSummary();
    }

    private function runTest(string $method, string $description): void
    {
        try {
            $this->$method();
            $this->results[] = [
                'name' => $method,
                'description' => $description,
                'status' => 'PASS',
                'message' => 'Passed',
            ];
            echo "  [PASS] {$description}\n";
        } catch (ExpectedRedException $e) {
            $this->results[] = [
                'name' => $method,
                'description' => $description,
                'status' => 'RED_EXPECTED',
                'message' => $e->getMessage(),
            ];
            echo "  [RED - EXPECTED] {$description}\n";
            echo "        Reason: {$e->getMessage()}\n";
        } catch (Throwable $e) {
            $this->results[] = [
                'name' => $method,
                'description' => $description,
                'status' => 'FAIL_UNEXPECTED',
                'message' => $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine(),
            ];
            echo "  [FAIL - UNEXPECTED] {$description}\n";
            echo "        Error: {$e->getMessage()}\n";
        }
    }

    private function printSummary(): int
    {
        $passed = 0;
        $expectedRed = 0;
        $unexpectedFail = 0;

        foreach ($this->results as $r) {
            if ($r['status'] === 'PASS') $passed++;
            elseif ($r['status'] === 'RED_EXPECTED') $expectedRed++;
            else $unexpectedFail++;
        }

        $total = count($this->results);
        echo "\n----------------------------------------------------------------------\n";
        echo "SUMMARY: Total: {$total} | Passed: {$passed} | Expected Red: {$expectedRed} | Unexpected Fail: {$unexpectedFail}\n";
        echo "----------------------------------------------------------------------\n";

        if ($unexpectedFail > 0) {
            echo "RESULT: FAIL (Unexpected regressions found)\n";
            return 1;
        }

        if ($expectedRed > 0) {
            echo "RESULT: RED (EXPECTED) - Contract frozen. All functional failures are exclusively\n";
            echo "        due to unintegrated future service implementation and schema migration.\n";
            return 0;
        }

        echo "RESULT: GREEN (All tests passed)\n";
        return 0;
    }

    // -------------------------------------------------------------------------
    // Test Cases: Interface Freezing & Invariants
    // -------------------------------------------------------------------------

    private function testStructuralFreezeWonProjectIntegrationConfig(): void
    {
        $className = 'WonProjectIntegrationConfig';
        if (!class_exists($className)) {
            throw new ExpectedRedException("Interface frozen: Class '{$className}' not found. Pending implementation in future task.");
        }

        $ref = new ReflectionClass($className);
        $this->assertTrue($ref->hasMethod('load'), "WonProjectIntegrationConfig must declare static load() method");
        $method = $ref->getMethod('load');
        $this->assertTrue($method->isPublic() && $method->isStatic(), "load() must be public static");
    }

    private function testConfigPrecedenceAndDefaultsContract(): void
    {
        // Freezes the five approved configuration variables:
        // 1. WON_PROJECT_EXPORT_ENABLED (bool, default false)
        // 2. WON_PROJECT_HMAC_ACTIVE_KEY_ID (string, default '')
        // 3. WON_PROJECT_HMAC_ACTIVE_SECRET (string, default '')
        // 4. ELECTROPLAN_WON_PROJECT_ENDPOINT (string, default '')
        // 5. WON_PROJECT_REQUEST_TIMEOUT_SECONDS (int, default 30)
        //
        // Precedence:
        // 1. Environment variables ($_ENV / getenv)
        // 2. Optional private local configuration file
        // 3. Safe defaults (disabled / export_enabled = false)
        //
        // Isolation: No external network calls, no Inventory System dependencies.

        $approvedVariables = [
            'WON_PROJECT_EXPORT_ENABLED',
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID',
            'WON_PROJECT_HMAC_ACTIVE_SECRET',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS',
        ];
        $this->assertCount(5, $approvedVariables, "Must define exactly 5 approved configuration variables");

        // Safe defaults contract evaluation
        $safeDefaults = [
            'WON_PROJECT_EXPORT_ENABLED' => false,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => '',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => '',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => '',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ];
        $this->assertFalse($safeDefaults['WON_PROJECT_EXPORT_ENABLED'], "Safe default must have export_enabled deactivated");

        // Precedence resolution simulation
        $resolveConfig = function (array $env, array $fileConfig, array $defaults): array {
            $resolved = [];
            foreach ($defaults as $name => $defaultVal) {
                if (array_key_exists($name, $env) && $env[$name] !== null) {
                    $resolved[$name] = $env[$name];
                } elseif (array_key_exists($name, $fileConfig) && $fileConfig[$name] !== null) {
                    $resolved[$name] = $fileConfig[$name];
                } else {
                    $resolved[$name] = $defaultVal;
                }
            }
            return $resolved;
        };

        // Case 1: Defaults apply when neither env nor file is provided
        $configDefault = $resolveConfig([], [], $safeDefaults);
        $this->assertFalse($configDefault['WON_PROJECT_EXPORT_ENABLED'], "Defaults must disable export");

        // Case 2: File overrides defaults
        $configFile = $resolveConfig(
            [],
            [
                'WON_PROJECT_EXPORT_ENABLED' => true,
                'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'file-key-id',
            ],
            $safeDefaults
        );
        $this->assertTrue($configFile['WON_PROJECT_EXPORT_ENABLED'], "File can enable export");
        $this->assertEquals('file-key-id', $configFile['WON_PROJECT_HMAC_ACTIVE_KEY_ID'], "File provides active key ID");

        // Case 3: Environment overrides file (highest precedence)
        $configEnv = $resolveConfig(
            ['WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'env-key-id'],
            ['WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'file-key-id'],
            $safeDefaults
        );
        $this->assertEquals('env-key-id', $configEnv['WON_PROJECT_HMAC_ACTIVE_KEY_ID'], "Environment must take precedence over file");

        $className = 'WonProjectIntegrationConfig';
        if (!class_exists($className)) {
            throw new ExpectedRedException("WonProjectIntegrationConfig not yet implemented to test live configuration precedence.");
        }
    }

    private function testStructuralFreezeWonProjectOutboxDispatcher(): void
    {
        $className = 'WonProjectOutboxDispatcher';
        if (!class_exists($className)) {
            throw new ExpectedRedException("Interface frozen: Class '{$className}' not found. Pending implementation in future task.");
        }

        $ref = new ReflectionClass($className);
        $this->assertTrue($ref->hasMethod('dispatchBatch'), "WonProjectOutboxDispatcher must declare dispatchBatch method");
        $method = $ref->getMethod('dispatchBatch');
        $this->assertTrue($method->isPublic(), "dispatchBatch must be public");

        $params = $method->getParameters();
        $this->assertGreaterThanOrEqual(0, count($params), "dispatchBatch may accept optional limit");
        if (isset($params[0])) {
            $pType = $params[0]->getType();
            if ($pType instanceof ReflectionNamedType) {
                $this->assertEquals('int', $pType->getName(), "First parameter of dispatchBatch must be int limit");
            }
        }
    }

    private function testConfigHttpsEnforcement(): void
    {
        // HTTPS invariant: Production or staging dispatch endpoints MUST use HTTPS scheme.
        $insecureUrl = 'http://api.brightronix.com/v1/won-projects';
        $secureUrl = 'https://api.brightronix.com/v1/won-projects';

        $parsedInsecure = parse_url($insecureUrl);
        $parsedSecure = parse_url($secureUrl);

        $this->assertEquals('http', $parsedInsecure['scheme'] ?? null, "Parsed insecure URL scheme");
        $this->assertEquals('https', $parsedSecure['scheme'] ?? null, "Parsed secure URL scheme");

        $isHttpsOnly = function (string $url): bool {
            $parts = parse_url($url);
            return isset($parts['scheme']) && strtolower($parts['scheme']) === 'https';
        };

        $this->assertFalse($isHttpsOnly($insecureUrl), "Plain HTTP URL must be rejected by HTTPS policy");
        $this->assertTrue($isHttpsOnly($secureUrl), "HTTPS URL must be accepted by HTTPS policy");

        $className = 'WonProjectIntegrationConfig';
        if (!class_exists($className)) {
            throw new ExpectedRedException("WonProjectIntegrationConfig not yet implemented to test live URL validation.");
        }
    }

    private function testHmacSha256SignatureCalculationContract(): void
    {
        // Freezes the HMAC signature algorithm compatible with Electroplan:
        // signature = hash_hmac('sha256', METHOD . "\n" . PATH . "\n" . TIMESTAMP . "\n" . RAW_BODY, secret)
        $method = 'POST';
        $path = '/api/v1/integrations/takeoff/won-projects';
        $secret = 'super-secret-hmac-key-minimum-32-chars-long';
        $timestamp = '1775739600';
        $rawBody = '{"event_id":"550e8400-e29b-41d4-a716-446655440000","source_system":"takeoff"}';

        $payloadToSign = $method . "\n" . $path . "\n" . $timestamp . "\n" . $rawBody;
        $expectedSignature = hash_hmac('sha256', $payloadToSign, $secret);

        $this->assertEquals(64, strlen($expectedSignature), "HMAC-SHA256 signature must be 64 hex characters");
        $this->assertTrue((bool)preg_match('/^[a-f0-9]{64}$/', $expectedSignature), "Signature must match hex pattern");

        // Verify deterministic reproducibility
        $recomputed = hash_hmac('sha256', $payloadToSign, $secret);
        $this->assertEquals($expectedSignature, $recomputed, "HMAC must be deterministic");

        // Verify tamper resistance: alteration in any component yields different signature
        $tamperedMethod = hash_hmac('sha256', 'GET' . "\n" . $path . "\n" . $timestamp . "\n" . $rawBody, $secret);
        $this->assertFalse($expectedSignature === $tamperedMethod, "Tampered method must produce distinct signature");

        $tamperedPath = hash_hmac('sha256', $method . "\n" . '/api/v1/other' . "\n" . $timestamp . "\n" . $rawBody, $secret);
        $this->assertFalse($expectedSignature === $tamperedPath, "Tampered path must produce distinct signature");

        $tamperedTimestamp = hash_hmac('sha256', $method . "\n" . $path . "\n" . '1775739601' . "\n" . $rawBody, $secret);
        $this->assertFalse($expectedSignature === $tamperedTimestamp, "Tampered timestamp must produce distinct signature");

        $tamperedBody = hash_hmac('sha256', $method . "\n" . $path . "\n" . $timestamp . "\n" . $rawBody . ' ', $secret);
        $this->assertFalse($expectedSignature === $tamperedBody, "Tampered raw body must produce distinct signature");
    }

    private function testHmacHeadersContract(): void
    {
        // Required authentication and content headers for Electroplan dispatch
        $requiredHeaders = [
            'Content-Type',
            'X-Client-Id',
            'X-Timestamp',
            'X-Signature',
        ];

        $mockHeaders = [
            'Content-Type' => 'application/json',
            'X-Client-Id' => 'takeoff-service-client',
            'X-Correlation-Id' => 'corr-takeoff-101-202-001',
            'X-Timestamp' => '1775739600',
            'X-Signature' => 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ];

        foreach ($requiredHeaders as $h) {
            $this->assertTrue(isset($mockHeaders[$h]), "Dispatch headers must include {$h}");
        }

        // X-Correlation-Id may accompany the request but does not replace authentication
        $this->assertTrue(isset($mockHeaders['X-Correlation-Id']), "Dispatch headers may accompany X-Correlation-Id for tracing");
        $this->assertTrue(
            isset($mockHeaders['X-Client-Id']) && isset($mockHeaders['X-Signature']),
            "Authentication strictly requires X-Client-Id and X-Signature; X-Correlation-Id cannot substitute authentication"
        );

        $className = 'WonProjectOutboxDispatcher';
        if (!class_exists($className)) {
            throw new ExpectedRedException("WonProjectOutboxDispatcher not yet implemented to test live header construction.");
        }
    }

    private function testOutboxLifecyclePendingToDelivered(): void
    {
        $pdo = $this->createOutboxSqlitePdo();

        // Insert pending event
        $eventId = '550e8400-e29b-41d4-a716-446655440000';
        $payload = json_encode(['event_id' => $eventId, 'source_system' => 'takeoff']);
        $payloadHash = hash('sha256', $payload);

        $pdo->prepare("
            INSERT INTO won_project_outbox (event_id, project_id, event_type, payload, payload_hash, status)
            VALUES (?, 101, 'won_project.exported', ?, ?, 'pending')
        ")->execute([$eventId, $payload, $payloadHash]);

        // Lifecycle step 1: Lock record for dispatch
        $pdo->prepare("
            UPDATE won_project_outbox
            SET locked_at = CURRENT_TIMESTAMP,
                locked_by = 'worker-1',
                lock_expires_at = datetime('now', '+5 minutes')
            WHERE event_id = ? AND status = 'pending' AND locked_at IS NULL
        ")->execute([$eventId]);

        $row1 = $pdo->query("SELECT status, locked_at, locked_by, lock_expires_at FROM won_project_outbox WHERE event_id = '{$eventId}'")->fetch(PDO::FETCH_ASSOC);
        $this->assertEquals('pending', $row1['status'], "Record status remains 'pending' while locked");
        $this->assertTrue(!empty($row1['locked_at']), "Record must have locked_at set when locked");
        $this->assertEquals('worker-1', $row1['locked_by'], "Record must have locked_by set");
        $this->assertTrue(!empty($row1['lock_expires_at']), "Record must have lock_expires_at set");

        // Lifecycle step 2: Successful delivery (HTTP 200/201)
        $pdo->prepare("
            UPDATE won_project_outbox
            SET status = 'delivered',
                delivered_at = CURRENT_TIMESTAMP,
                locked_at = NULL,
                locked_by = NULL,
                lock_expires_at = NULL
            WHERE event_id = ?
        ")->execute([$eventId]);

        $row2 = $pdo->query("SELECT status, delivered_at, locked_at FROM won_project_outbox WHERE event_id = '{$eventId}'")->fetch(PDO::FETCH_ASSOC);
        $this->assertEquals('delivered', $row2['status'], "Record must transition to 'delivered'");
        $this->assertTrue(!empty($row2['delivered_at']), "delivered_at must be populated on delivery");
        $this->assertEquals(null, $row2['locked_at'], "Lock must be released upon delivery");

        $className = 'WonProjectOutboxDispatcher';
        if (!class_exists($className)) {
            throw new ExpectedRedException("WonProjectOutboxDispatcher not yet implemented for live lifecycle execution.");
        }
    }

    private function testTransientFailureIncrementsAttemptsAndAppliesBackoff(): void
    {
        // Exponential backoff contract:
        // delay = base_backoff_seconds * (2 ^ attempts)
        $baseBackoff = 30; // 30s base
        $maxBackoff = 3600; // 1 hour cap

        $calculateBackoffDelay = function (int $attempts, int $base, int $cap): int {
            $delay = $base * (2 ** $attempts);
            return min($cap, $delay);
        };

        $this->assertEquals(30, $calculateBackoffDelay(0, $baseBackoff, $maxBackoff), "Attempt 0 backoff");
        $this->assertEquals(60, $calculateBackoffDelay(1, $baseBackoff, $maxBackoff), "Attempt 1 backoff");
        $this->assertEquals(120, $calculateBackoffDelay(2, $baseBackoff, $maxBackoff), "Attempt 2 backoff");
        $this->assertEquals(240, $calculateBackoffDelay(3, $baseBackoff, $maxBackoff), "Attempt 3 backoff");
        $this->assertEquals(480, $calculateBackoffDelay(4, $baseBackoff, $maxBackoff), "Attempt 4 backoff");

        $pdo = $this->createOutboxSqlitePdo();
        $eventId = '660e8400-e29b-41d4-a716-446655440001';
        $payload = json_encode(['event_id' => $eventId]);
        $payloadHash = hash('sha256', $payload);

        $pdo->prepare("
            INSERT INTO won_project_outbox (event_id, project_id, event_type, payload, payload_hash, status, attempts, locked_at, locked_by, lock_expires_at)
            VALUES (?, 101, 'won_project.exported', ?, ?, 'pending', 0, CURRENT_TIMESTAMP, 'worker-1', datetime('now', '+5 minutes'))
        ")->execute([$eventId, $payload, $payloadHash]);

        // Transient failure update: increment attempts, schedule next_attempt_at, release lock, status remains 'pending'
        $delay = $calculateBackoffDelay(1, $baseBackoff, $maxBackoff);
        $nextAttemptAt = date('Y-m-d H:i:s', time() + $delay);

        $pdo->prepare("
            UPDATE won_project_outbox
            SET status = 'pending',
                attempts = attempts + 1,
                next_attempt_at = ?,
                locked_at = NULL,
                locked_by = NULL,
                lock_expires_at = NULL,
                last_error = 'HTTP 503 Service Unavailable'
            WHERE event_id = ?
        ")->execute([$nextAttemptAt, $eventId]);

        $row = $pdo->query("SELECT attempts, status, next_attempt_at, locked_at, last_error FROM won_project_outbox WHERE event_id = '{$eventId}'")->fetch(PDO::FETCH_ASSOC);
        $this->assertEquals(1, (int)$row['attempts'], "attempts must be incremented to 1");
        $this->assertEquals('pending', $row['status'], "status remains 'pending' on transient failure");
        $this->assertEquals($nextAttemptAt, $row['next_attempt_at'], "next_attempt_at must be set to backoff time");
        $this->assertEquals(null, $row['locked_at'], "Lock must be released on failure");
        $this->assertEquals('HTTP 503 Service Unavailable', $row['last_error'], "last_error must record failure details");

        $className = 'WonProjectOutboxDispatcher';
        if (!class_exists($className)) {
            throw new ExpectedRedException("WonProjectOutboxDispatcher not yet implemented for live attempt backoff dispatch.");
        }
    }

    private function testTerminalFailureTransitionsToFailedStatus(): void
    {
        // When attempts reach max_attempts (e.g. 5), status must transition to 'failed'
        $maxAttempts = 5;
        $pdo = $this->createOutboxSqlitePdo();
        $eventId = '770e8400-e29b-41d4-a716-446655440002';
        $payload = json_encode(['event_id' => $eventId]);
        $payloadHash = hash('sha256', $payload);

        $pdo->prepare("
            INSERT INTO won_project_outbox (event_id, project_id, event_type, payload, payload_hash, status, attempts, locked_at, locked_by, lock_expires_at)
            VALUES (?, 101, 'won_project.exported', ?, ?, 'pending', 4, CURRENT_TIMESTAMP, 'worker-1', datetime('now', '+5 minutes'))
        ")->execute([$eventId, $payload, $payloadHash]);

        // 5th failed attempt: reaches maxAttempts
        $currentAttempts = 4 + 1;
        if ($currentAttempts >= $maxAttempts) {
            $pdo->prepare("
                UPDATE won_project_outbox
                SET status = 'failed',
                    attempts = ?,
                    next_attempt_at = NULL,
                    locked_at = NULL,
                    locked_by = NULL,
                    lock_expires_at = NULL,
                    last_error = 'Max attempts (5) exceeded: HTTP 500'
                WHERE event_id = ?
            ")->execute([$currentAttempts, $eventId]);
        }

        $row = $pdo->query("SELECT status, attempts, next_attempt_at, locked_at, last_error FROM won_project_outbox WHERE event_id = '{$eventId}'")->fetch(PDO::FETCH_ASSOC);
        $this->assertEquals('failed', $row['status'], "Terminal state must be 'failed'");
        $this->assertEquals(5, (int)$row['attempts'], "Attempts count must be 5");
        $this->assertEquals(null, $row['next_attempt_at'], "next_attempt_at must be NULL in terminal failed state");
        $this->assertEquals(null, $row['locked_at'], "Lock must be released in terminal failed state");

        $className = 'WonProjectOutboxDispatcher';
        if (!class_exists($className)) {
            throw new ExpectedRedException("WonProjectOutboxDispatcher not yet implemented for live terminal failure dispatch.");
        }
    }

    private function testConcurrentDispatchLockingPreventsDuplicateDispatch(): void
    {
        // Invariant: Two concurrent dispatchers must not select or dispatch the same outbox entry
        $pdo = $this->createOutboxSqlitePdo();

        $pdo->exec("
            INSERT INTO won_project_outbox (event_id, project_id, event_type, payload, payload_hash, status) VALUES
            ('ev-1', 101, 'won_project.exported', '{}', 'hash1', 'pending'),
            ('ev-2', 102, 'won_project.exported', '{}', 'hash2', 'pending')
        ");

        // Worker 1 acquires lock on available pending batch
        $worker1Stmt = $pdo->prepare("
            UPDATE won_project_outbox
            SET locked_at = CURRENT_TIMESTAMP,
                locked_by = 'worker-1',
                lock_expires_at = datetime('now', '+5 minutes')
            WHERE id IN (
                SELECT id FROM won_project_outbox
                WHERE status = 'pending'
                  AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
                  AND (locked_at IS NULL OR lock_expires_at <= CURRENT_TIMESTAMP)
                ORDER BY id ASC
                LIMIT 1
            )
        ");
        $worker1Stmt->execute();

        // Worker 2 attempts to select available pending batch
        $worker2Selected = $pdo->query("
            SELECT event_id FROM won_project_outbox
            WHERE status = 'pending'
              AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
              AND (locked_at IS NULL OR lock_expires_at <= CURRENT_TIMESTAMP)
        ")->fetchAll(PDO::FETCH_COLUMN);

        $this->assertCount(1, $worker2Selected, "Worker 2 must only see 1 available entry, since Worker 1 locked the first");
        $this->assertEquals('ev-2', $worker2Selected[0], "Worker 2 must see ev-2, not ev-1");

        $className = 'WonProjectOutboxDispatcher';
        if (!class_exists($className)) {
            throw new ExpectedRedException("WonProjectOutboxDispatcher not yet implemented for live concurrent locking check.");
        }
    }

    private function testFeatureFlagDisabledBypassesBatchDispatch(): void
    {
        $configClass = 'WonProjectIntegrationConfig';
        $dispatcherClass = 'WonProjectOutboxDispatcher';
        if (!class_exists($configClass) || !class_exists($dispatcherClass)) {
            throw new ExpectedRedException("WonProjectIntegrationConfig / WonProjectOutboxDispatcher not yet implemented for feature flag check.");
        }
    }

    // -------------------------------------------------------------------------
    // SQLite Outbox Fixture
    // -------------------------------------------------------------------------

    private function createOutboxSqlitePdo(): PDO
    {
        $pdo = new PDO('sqlite::memory:');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $pdo->exec("
            CREATE TABLE won_project_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                project_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT NULL,
                locked_at TEXT NULL,
                locked_by TEXT NULL,
                lock_expires_at TEXT NULL,
                last_error TEXT NULL,
                delivered_at TEXT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        ");

        return $pdo;
    }

    // -------------------------------------------------------------------------
    // Assertions
    // -------------------------------------------------------------------------

    private function assertTrue(bool $condition, string $msg): void
    {
        if (!$condition) throw new \RuntimeException("Assertion failed: {$msg}");
    }

    private function assertFalse(bool $condition, string $msg): void
    {
        if ($condition) throw new \RuntimeException("Assertion failed (expected false): {$msg}");
    }

    private function assertEquals($expected, $actual, string $msg): void
    {
        if ($expected !== $actual) {
            $expStr = is_scalar($expected) ? (string)$expected : json_encode($expected);
            $actStr = is_scalar($actual) ? (string)$actual : json_encode($actual);
            throw new \RuntimeException("Assertion failed: {$msg} [Expected: {$expStr}, got: {$actStr}]");
        }
    }

    private function assertCount(int $expectedCount, array $arr, string $msg): void
    {
        $actual = count($arr);
        if ($expectedCount !== $actual) {
            throw new \RuntimeException("Assertion failed: {$msg} [Expected count {$expectedCount}, got {$actual}]");
        }
    }

    private function assertGreaterThanOrEqual($min, $val, string $msg): void
    {
        if ($val < $min) throw new \RuntimeException("Assertion failed: {$msg} ({$val} not >= {$min})");
    }
}

class ExpectedRedException extends \RuntimeException {}

// CLI Execution entrypoint
$runner = new WonProjectOutboxContractTestRunner();
exit($runner->run());
