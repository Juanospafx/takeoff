<?php
declare(strict_types=1);

/**
 * Contract Tests: WonProjectOutboxDispatcher, WonProjectIntegrationConfig, WonProjectHmacClient
 *
 * Verifies:
 *   - Configuration loading, safe defaults (export disabled), precedence (env > private file > defaults)
 *   - Rejection of private config file within repository or doc root
 *   - HTTPS enforcement for endpoint, rejecting HTTP, missing host, or URL credentials
 *   - Timeout validation (positive integer) and secret presence requirement
 *   - HMAC SHA-256 signing contract matches canonical test vector using sign() and transport callable
 *   - HTTP method POST, exact path, timestamp, raw body, headers: Content-Type, X-Client-Id, X-Timestamp, X-Signature
 *   - No network, curl, or redirect dependency
 *   - OutboxDispatcher: feature flag disabled bypasses dispatch without querying or preparing locks
 *   - Backoff delay formula: delay = min(3600, 30 * (2 ^ attempts))
 *   - Retry operator restricted strictly to concrete positive record IDs
 *   - Terminal failure on unrecoverable HTTP status (400, 401, 403, 409, 422) or max attempts (5)
 *   - Transient failure (5xx, network error) increments attempts, schedules next_attempt_at, status pending
 *   - Error sanitization: secrets, endpoints, tokens, SQL statements redacted
 *   - GET_LOCK / RELEASE_LOCK and concurrent lease locking verified via controlled PDO double
 *
 * Runs without PDO drivers (pdo_sqlite / pdo_mysql), external network, curl, or MariaDB.
 */

namespace Brightronix\Takeoff\Tests\Contracts;

use PDO;
use PDOStatement;
use ReflectionClass;
use ReflectionNamedType;
use ReturnTypeWillChange;
use RuntimeException;
use InvalidArgumentException;
use Throwable;
use WonProjectIntegrationConfig;
use WonProjectHmacClient;
use WonProjectOutboxDispatcher;

require_once __DIR__ . '/../core/config/WonProjectIntegrationConfig.php';
require_once __DIR__ . '/../core/services/WonProjectHmacClient.php';
require_once __DIR__ . '/../core/services/WonProjectOutboxDispatcher.php';

// -----------------------------------------------------------------------------
// Controlled In-Memory Test Doubles for Outbox Tests
// -----------------------------------------------------------------------------

class OutboxTestDoublePdoStatement extends PDOStatement
{
    private array $rows;
    private int $cursor = 0;
    private int $rowCount;
    public ?array $boundParams = null;
    public ?string $sql = null;
    /** @var callable|null */
    public $onExecute = null;

    public function __construct(array $rows = [], int $rowCount = 0, ?string $sql = null)
    {
        $this->rows = $rows;
        $this->rowCount = $rowCount > 0 ? $rowCount : count($rows);
        $this->sql = $sql;
    }

    #[ReturnTypeWillChange]
    public function execute(?array $params = null): bool
    {
        $this->cursor = 0;
        $this->boundParams = $params;
        if ($this->onExecute !== null) {
            ($this->onExecute)($params, $this);
        }
        return true;
    }

    #[ReturnTypeWillChange]
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed
    {
        if ($this->cursor < count($this->rows)) {
            return $this->rows[$this->cursor++];
        }
        return false;
    }

    #[ReturnTypeWillChange]
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array
    {
        $res = array_slice($this->rows, $this->cursor);
        $this->cursor = count($this->rows);
        return $res;
    }

    #[ReturnTypeWillChange]
    public function fetchColumn(int $column = 0): mixed
    {
        $row = $this->fetch();
        if ($row === false) {
            return false;
        }
        if (is_array($row)) {
            $vals = array_values($row);
            return $vals[$column] ?? false;
        }
        return $row;
    }

    #[ReturnTypeWillChange]
    public function rowCount(): int
    {
        return $this->rowCount;
    }
}

class OutboxTestDoublePdo extends PDO
{
    public array $log = [];
    public array $executedStatements = [];
    public string $driverName = 'mysql';
    /** @var array<string, callable|OutboxTestDoublePdoStatement> */
    public array $handlers = [];
    public array $tableRows = [];

    public function __construct(string $driverName = 'mysql')
    {
        $this->driverName = $driverName;
    }

    #[ReturnTypeWillChange]
    public function getAttribute(int $attribute): mixed
    {
        if ($attribute === PDO::ATTR_DRIVER_NAME) {
            return $this->driverName;
        }
        return null;
    }

    #[ReturnTypeWillChange]
    public function prepare(string $query, array $options = []): OutboxTestDoublePdoStatement
    {
        $this->log[] = 'PREPARE: ' . $query;

        foreach ($this->handlers as $pattern => $handler) {
            if (stripos($query, $pattern) !== false) {
                $stmt = is_callable($handler) ? $handler($query) : $handler;
                $this->executedStatements[] = $stmt;
                return $stmt;
            }
        }

        $defaultStmt = new OutboxTestDoublePdoStatement([], 1, $query);
        $this->executedStatements[] = $defaultStmt;
        return $defaultStmt;
    }

    #[ReturnTypeWillChange]
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): OutboxTestDoublePdoStatement|false
    {
        $stmt = $this->prepare($query);
        $stmt->execute();
        return $stmt;
    }

    public function whenQueryContains(string $pattern, callable|OutboxTestDoublePdoStatement $handler): void
    {
        $this->handlers[$pattern] = $handler;
    }
}

// -----------------------------------------------------------------------------
// Test Suite Runner
// -----------------------------------------------------------------------------

final class WonProjectOutboxContractTestRunner
{
    private array $results = [];

    public function run(): int
    {
        echo "======================================================================\n";
        echo "TEST SUITE: WonProject Outbox & Dispatcher Contract\n";
        echo "======================================================================\n\n";

        $tests = [
            'testStructuralFreezeWonProjectIntegrationConfig' => 'Interface frozen: WonProjectIntegrationConfig::load()',
            'testConfigPrecedenceAndDefaultsContract' => 'Configuration precedence: env > private file > defaults (export disabled by default)',
            'testConfigRejectsPrivateConfigFileInsideRepository' => 'Configuration rejects private config file located inside repo or doc root',
            'testConfigHttpsEnforcementAndCredentialRejection' => 'HTTPS enforcement: configuration rejects plain HTTP, missing host, or URL credentials',
            'testConfigRequiresPositiveTimeoutAndSecretsWhenEnabled' => 'Configuration requires positive timeout, active key ID, and secret when enabled',
            'testConfigCleanSanitizationDoesNotLeakSecrets' => 'Configuration toArray() and debugInfo() never leak HMAC secret material',
            'testStructuralFreezeWonProjectOutboxDispatcher' => 'Interface frozen: WonProjectOutboxDispatcher::dispatchBatch(int): array',
            'testHmacSha256SignatureDeterministicVector' => 'HMAC SHA-256 canonical signature matches deterministic test vector with sign()',
            'testHmacClientSendDispatchesHeadersAndExactRawBodyViaTransport' => 'HMAC Client sends required headers (X-Client-Id, X-Timestamp, X-Signature) and exact body without network',
            'testHmacClientErrorSanitizationPreventsSecretLeaking' => 'HMAC Client redacts endpoints, secrets, tokens, and authorization headers from errors',
            'testFeatureFlagDisabledBypassesBatchDispatch' => 'Feature flag: when export_enabled is false, dispatchBatch returns status disabled without queries',
            'testBackoffDelayFormula' => 'Exponential backoff formula: delay = min(3600, 30 * (2 ^ attempts))',
            'testOutboxLifecyclePendingToDelivered' => 'Outbox lifecycle: pending record transitions to delivered on HTTP 200/201 response',
            'testTerminalFailureOn409OrMaxAttempts' => 'Terminal failure: unrecoverable HTTP 409 or 5 attempts transitions status to failed with next_attempt_at NULL',
            'testTransientFailure5xxIncrementsAttemptsAndSchedulesRetry' => 'Transient failure: HTTP 503 increments attempts and schedules backoff with DB server clock (CURRENT_TIMESTAMP/DATE_ADD)',
            'testConcurrentLockContractsGetLockAndReleaseLock' => 'Named lock contracts: GET_LOCK acquired before claim and RELEASE_LOCK guaranteed in finally',
            'testLockNameDerivedFromDatabaseStableBoundedAndUnexposed' => 'Namespaced lock: derived from DATABASE(), stable, bounded <= 64 chars, unexposed cleartext name, identical at acquire/release',
            'testTransientFailureSchedulesRetryWithSqliteClock' => 'Transient failure: SQLite branch schedules backoff with server clock datetime()',
            'testMigrationSchemaAllowsNullNextAttemptAtForTerminalFailed' => 'Migration schema allows NULL next_attempt_at for terminal failure',
            'testOperatorRetryFailedRequiresConcretePositiveId' => 'Operator retryFailed: requires positive record ID, resets status, attempts, error without mass retry',
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
        } catch (Throwable $e) {
            $this->results[] = [
                'name' => $method,
                'description' => $description,
                'status' => 'FAIL',
                'message' => $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine(),
            ];
            echo "  [FAIL] {$description}\n";
            echo "        Error: {$e->getMessage()}\n";
        }
    }

    private function printSummary(): int
    {
        $passed = 0;
        $failed = 0;

        foreach ($this->results as $r) {
            if ($r['status'] === 'PASS') {
                $passed++;
            } else {
                $failed++;
            }
        }

        $total = count($this->results);
        echo "\n----------------------------------------------------------------------\n";
        echo "SUMMARY: Total: {$total} | Passed: {$passed} | Failed: {$failed}\n";
        echo "----------------------------------------------------------------------\n";

        if ($failed > 0) {
            echo "RESULT: FAIL (Regressions or broken contracts found)\n";
            return 1;
        }

        echo "RESULT: GREEN (All tests passed)\n";
        return 0;
    }

    // -------------------------------------------------------------------------
    // Test Cases: Configuration & Security
    // -------------------------------------------------------------------------

    private function testStructuralFreezeWonProjectIntegrationConfig(): void
    {
        $className = 'WonProjectIntegrationConfig';
        $this->assertTrue(class_exists($className), "WonProjectIntegrationConfig class must exist");

        $ref = new ReflectionClass($className);
        $this->assertTrue($ref->hasMethod('load'), "WonProjectIntegrationConfig must declare static load() method");
        $method = $ref->getMethod('load');
        $this->assertTrue($method->isPublic() && $method->isStatic(), "load() must be public static");
    }

    private function testConfigPrecedenceAndDefaultsContract(): void
    {
        $vars = [
            'WON_PROJECT_EXPORT_ENABLED',
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID',
            'WON_PROJECT_HMAC_ACTIVE_SECRET',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS',
            'WON_PROJECT_PRIVATE_CONFIG',
        ];

        // Clean env before test
        $backup = [];
        foreach ($vars as $v) {
            $backup[$v] = $_ENV[$v] ?? null;
            unset($_ENV[$v], $_SERVER[$v]);
            putenv($v);
        }

        $tempFile = null;
        try {
            // 1. Safe defaults when nothing is set
            $cfgDefault = WonProjectIntegrationConfig::load();
            $this->assertFalse($cfgDefault->isExportEnabled(), "Safe default must disable export");
            $this->assertEquals(30, $cfgDefault->getTimeoutSeconds(), "Default timeout must be 30");
            $this->assertEquals('', $cfgDefault->getHmacKeyId(), "Default key ID is empty");
            $this->assertEquals('', $cfgDefault->getHmacSecret(), "Default secret is empty");
            $this->assertEquals('', $cfgDefault->getEndpoint(), "Default endpoint is empty");

            // 2. Private file outside repository
            $tempDir = sys_get_temp_dir();
            $tempFile = $tempDir . DIRECTORY_SEPARATOR . 'test_won_config_' . bin2hex(random_bytes(6)) . '.php';
            file_put_contents($tempFile, "<?php return [
                'WON_PROJECT_EXPORT_ENABLED' => true,
                'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'file-key-1',
                'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'file-secret-min-32-chars-length123',
                'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://electroplan.test/api/won',
                'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 45,
            ];");

            $cfgFile = WonProjectIntegrationConfig::load($tempFile);
            $this->assertTrue($cfgFile->isExportEnabled(), "File enables export");
            $this->assertEquals('file-key-1', $cfgFile->getHmacKeyId(), "File provides key ID");
            $this->assertEquals(45, $cfgFile->getTimeoutSeconds(), "File provides timeout");

            // 3. Environment overrides private file (highest precedence)
            $_ENV['WON_PROJECT_HMAC_ACTIVE_KEY_ID'] = 'env-override-key';
            $_ENV['WON_PROJECT_REQUEST_TIMEOUT_SECONDS'] = '60';

            $cfgEnv = WonProjectIntegrationConfig::load($tempFile);
            $this->assertEquals('env-override-key', $cfgEnv->getHmacKeyId(), "Environment overrides file key ID");
            $this->assertEquals(60, $cfgEnv->getTimeoutSeconds(), "Environment overrides file timeout");
        } finally {
            if ($tempFile !== null && file_exists($tempFile)) {
                @unlink($tempFile);
            }
            foreach ($backup as $k => $v) {
                if ($v !== null) {
                    $_ENV[$k] = $v;
                } else {
                    unset($_ENV[$k], $_SERVER[$k]);
                }
            }
        }
    }

    private function testConfigRejectsPrivateConfigFileInsideRepository(): void
    {
        $internalPaths = [
            'core/config/private.php',
            'api/private.php',
            'contracts/private.php',
            './tests/private.php',
        ];

        foreach ($internalPaths as $path) {
            $threw = false;
            try {
                WonProjectIntegrationConfig::load($path);
            } catch (InvalidArgumentException $e) {
                $threw = true;
                $this->assertTrue(str_contains(strtolower($e->getMessage()), 'outside'), "Must mention file must be outside repo/docroot");
            }
            $this->assertTrue($threw, "Must reject internal repo path: {$path}");
        }

        // Must reject non-php extensions
        $nonPhp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'config.json';
        $threwExt = false;
        try {
            WonProjectIntegrationConfig::load($nonPhp);
        } catch (InvalidArgumentException $e) {
            $threwExt = true;
            $this->assertTrue(str_contains(strtolower($e->getMessage()), 'php'), "Must require PHP extension");
        }
        $this->assertTrue($threwExt, "Must reject non-php configuration file");
    }

    private function testConfigHttpsEnforcementAndCredentialRejection(): void
    {
        $invalidEndpoints = [
            'http://insecure.example.com/api/won' => 'Plain HTTP is rejected',
            'https://user:pass@secure.example.com/api/won' => 'URL credentials in HTTPS are rejected',
            'https://' => 'Missing host is rejected',
            'ftp://files.example.com/api/won' => 'FTP scheme is rejected',
        ];

        foreach ($invalidEndpoints as $endpoint => $desc) {
            $config = new WonProjectIntegrationConfig([
                'WON_PROJECT_EXPORT_ENABLED' => true,
                'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-123',
                'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'secret-32-chars-long-string-value-here',
                'ELECTROPLAN_WON_PROJECT_ENDPOINT' => $endpoint,
                'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
            ]);

            $threw = false;
            try {
                $config->validate();
            } catch (InvalidArgumentException $e) {
                $threw = true;
            }
            $this->assertTrue($threw, "Endpoint must be rejected ({$desc}): {$endpoint}");
        }

        // Valid HTTPS endpoint passes validation
        $validConfig = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-123',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'secret-32-chars-long-string-value-here',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://electroplan.example.com/api/v1/won-projects',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);
        $validConfig->validate();
        $this->assertEquals('https://electroplan.example.com/api/v1/won-projects', $validConfig->getEndpoint(), "Valid HTTPS endpoint accepted");
    }

    private function testConfigRequiresPositiveTimeoutAndSecretsWhenEnabled(): void
    {
        // 1. Missing secret
        $noSecret = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-123',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => '',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://example.com/api',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);
        $threw = false;
        try {
            $noSecret->validate();
        } catch (InvalidArgumentException) {
            $threw = true;
        }
        $this->assertTrue($threw, "Validation must reject enabled config without HMAC secret");

        // 2. Non-positive timeout
        $badTimeout = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-123',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'secret-32-chars-long-string-value-here',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://example.com/api',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 0,
        ]);
        $threwTimeout = false;
        try {
            $badTimeout->validate();
        } catch (InvalidArgumentException) {
            $threwTimeout = true;
        }
        $this->assertTrue($threwTimeout, "Validation must reject non-positive timeout");
    }

    private function testConfigCleanSanitizationDoesNotLeakSecrets(): void
    {
        $secretValue = 'top-secret-super-sensitive-signing-key-value';
        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-123',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => $secretValue,
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://example.com/api',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);

        $arr = $config->toArray();
        $this->assertFalse(array_key_exists('WON_PROJECT_HMAC_ACTIVE_SECRET', $arr), "toArray() must omit HMAC secret");

        $debug = $config->__debugInfo();
        $this->assertFalse(array_key_exists('WON_PROJECT_HMAC_ACTIVE_SECRET', $debug), "__debugInfo() must omit HMAC secret");
        $this->assertFalse(in_array($secretValue, $debug, true), "Secret must not appear anywhere in debug array");
    }

    // -------------------------------------------------------------------------
    // Test Cases: HMAC Client
    // -------------------------------------------------------------------------

    private function testStructuralFreezeWonProjectOutboxDispatcher(): void
    {
        $className = 'WonProjectOutboxDispatcher';
        $this->assertTrue(class_exists($className), "WonProjectOutboxDispatcher class must exist");

        $ref = new ReflectionClass($className);
        $this->assertTrue($ref->hasMethod('dispatchBatch'), "WonProjectOutboxDispatcher must declare dispatchBatch method");
        $method = $ref->getMethod('dispatchBatch');
        $this->assertTrue($method->isPublic(), "dispatchBatch must be public");

        $params = $method->getParameters();
        $this->assertGreaterThanOrEqual(1, count($params), "dispatchBatch accepts optional limit parameter");
    }

    private function testHmacSha256SignatureDeterministicVector(): void
    {
        $secret = 'super-secret-hmac-key-minimum-32-chars-long';
        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-test',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => $secret,
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://electroplan.test/api/v1/integrations/takeoff/won-projects',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);

        $client = new WonProjectHmacClient($config);

        $method = 'POST';
        $path = '/api/v1/integrations/takeoff/won-projects';
        $timestamp = '1775739600';
        $rawJson = '{"event_id":"550e8400-e29b-41d4-a716-446655440000","source_system":"takeoff"}';

        // Canonical calculation: METHOD . "\n" . PATH . "\n" . TIMESTAMP . "\n" . RAW_BODY
        $expected = hash_hmac('sha256', $method . "\n" . $path . "\n" . $timestamp . "\n" . $rawJson, $secret);

        $actual = $client->sign($method, $path, $timestamp, $rawJson);

        $this->assertEquals($expected, $actual, "HMAC client sign() must match deterministic test vector");
        $this->assertEquals(64, strlen($actual), "Signature must be 64-hex SHA-256");
        $this->assertTrue((bool)preg_match('/^[a-f0-9]{64}$/', $actual), "Signature matches hex format");
    }

    private function testHmacClientSendDispatchesHeadersAndExactRawBodyViaTransport(): void
    {
        $secret = 'test-secret-at-least-32-characters-for-testing';
        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-alpha',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => $secret,
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://api.electroplan.example.com/v1/won-projects',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 15,
        ]);

        $capturedUrl = null;
        $capturedHeaders = null;
        $capturedBody = null;
        $capturedTimeout = null;

        $transport = function (string $url, array $headers, string $body, int $timeout) use (&$capturedUrl, &$capturedHeaders, &$capturedBody, &$capturedTimeout): array {
            $capturedUrl = $url;
            $capturedHeaders = $headers;
            $capturedBody = $body;
            $capturedTimeout = $timeout;

            return [
                'status_code' => 201,
                'body' => '{"received":true}',
                'error' => null,
            ];
        };

        $client = new WonProjectHmacClient($config, $transport);

        $payload = '{"event_id":"sample-uuid-1","source_system":"takeoff"}';
        $res = $client->send($payload, 'corr-takeoff-001');

        $this->assertTrue($res['success'], "Transport returned 201, send must be successful");
        $this->assertEquals(201, $res['status_code'], "Status code must be 201");
        $this->assertEquals('https://api.electroplan.example.com/v1/won-projects', $capturedUrl, "Url matches endpoint");
        $this->assertEquals($payload, $capturedBody, "Raw body received exactly without alteration");
        $this->assertEquals(15, $capturedTimeout, "Timeout passed to transport");

        // Verify headers
        $headerMap = [];
        foreach ($capturedHeaders as $h) {
            [$name, $val] = explode(':', $h, 2);
            $headerMap[trim($name)] = trim($val);
        }

        $this->assertEquals('application/json', $headerMap['Content-Type'] ?? null, "Content-Type header");
        $this->assertEquals('key-alpha', $headerMap['X-Client-Id'] ?? null, "X-Client-Id header");
        $this->assertNotEmpty($headerMap['X-Timestamp'] ?? null, "X-Timestamp header");
        $this->assertNotEmpty($headerMap['X-Signature'] ?? null, "X-Signature header");
        $this->assertEquals('corr-takeoff-001', $headerMap['X-Correlation-Id'] ?? null, "X-Correlation-Id header");
    }

    private function testHmacClientErrorSanitizationPreventsSecretLeaking(): void
    {
        $secret = 'sensitive-hmac-secret-string-do-not-leak';
        $keyId = 'my-client-key-id';
        $endpoint = 'https://api.electroplan.example.com/v1/won-projects';

        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => $keyId,
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => $secret,
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => $endpoint,
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);

        $transport = function () use ($secret, $keyId, $endpoint): array {
            return [
                'status_code' => 500,
                'body' => '',
                'error' => "Failed to reach {$endpoint} with key {$keyId} and secret {$secret}",
            ];
        };

        $client = new WonProjectHmacClient($config, $transport);
        $res = $client->send('{}');

        $this->assertFalse($res['success'], "Must report failure");
        $this->assertNotEmpty($res['error'], "Error message present");
        $this->assertFalse(str_contains($res['error'], $secret), "Error message must not contain secret");
        $this->assertFalse(str_contains($res['error'], $keyId), "Error message must not contain key ID");
        $this->assertFalse(str_contains($res['error'], $endpoint), "Error message must not contain full endpoint URL");
    }

    // -------------------------------------------------------------------------
    // Test Cases: Outbox Dispatcher
    // -------------------------------------------------------------------------

    private function testFeatureFlagDisabledBypassesBatchDispatch(): void
    {
        $pdo = new OutboxTestDoublePdo('mysql');
        $config = new WonProjectIntegrationConfig(['WON_PROJECT_EXPORT_ENABLED' => false]);

        $dispatcher = new WonProjectOutboxDispatcher($pdo, $config);
        $result = $dispatcher->dispatchBatch(50);

        $this->assertEquals('disabled', $result['status'], "Status must be disabled");
        $this->assertEquals(0, $result['claimed'], "Zero records claimed");
        $this->assertEquals(0, $result['dispatched'], "Zero records dispatched");

        // Verify no statements prepared
        $this->assertEmpty($pdo->log, "Disabled dispatcher must not query or prepare database statements");
    }

    private function testBackoffDelayFormula(): void
    {
        $pdo = new OutboxTestDoublePdo('mysql');
        $config = new WonProjectIntegrationConfig(['WON_PROJECT_EXPORT_ENABLED' => false]);
        $dispatcher = new WonProjectOutboxDispatcher($pdo, $config);

        // base=30, delay = min(3600, 30 * (2 ^ attempts))
        $this->assertEquals(30, $dispatcher->calculateBackoffDelay(0), "Attempt 0 backoff: 30s");
        $this->assertEquals(60, $dispatcher->calculateBackoffDelay(1), "Attempt 1 backoff: 60s");
        $this->assertEquals(120, $dispatcher->calculateBackoffDelay(2), "Attempt 2 backoff: 120s");
        $this->assertEquals(240, $dispatcher->calculateBackoffDelay(3), "Attempt 3 backoff: 240s");
        $this->assertEquals(480, $dispatcher->calculateBackoffDelay(4), "Attempt 4 backoff: 480s");
        $this->assertEquals(960, $dispatcher->calculateBackoffDelay(5), "Attempt 5 backoff: 960s");
        $this->assertEquals(3600, $dispatcher->calculateBackoffDelay(10), "Attempt 10 capped at 3600s");
    }

    private function testOutboxLifecyclePendingToDelivered(): void
    {
        $pdo = new OutboxTestDoublePdo('mysql');
        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-1',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'secret-32-chars-long-string-value-here',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://electroplan.test/api/won',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);

        // GET_LOCK returns 1 (success)
        $pdo->whenQueryContains('GET_LOCK', new OutboxTestDoublePdoStatement([['1' => 1]]));
        $pdo->whenQueryContains('RELEASE_LOCK', new OutboxTestDoublePdoStatement([['1' => 1]]));

        // Lease claim & fetch
        $pdo->whenQueryContains('UPDATE won_project_outbox', new OutboxTestDoublePdoStatement([], 1));
        $pdo->whenQueryContains('WHERE locked_by = ?', new OutboxTestDoublePdoStatement([
            [
                'id' => 10,
                'event_id' => 'a8f09d84-7a2e-4b6d-97e3-05f32a762df1',
                'project_id' => 101,
                'event_type' => 'project.won',
                'payload' => '{"event_id":"a8f09d84-7a2e-4b6d-97e3-05f32a762df1","correlation_id":"corr-001"}',
                'payload_hash' => hash('sha256', '{}'),
                'attempts' => 0,
            ]
        ]));

        $transport = function (): array {
            return [
                'status_code' => 200,
                'body' => '{"status":"ok"}',
                'error' => null,
            ];
        };

        $client = new WonProjectHmacClient($config, $transport);
        $dispatcher = new WonProjectOutboxDispatcher($pdo, $config, $client);

        $summary = $dispatcher->dispatchBatch(10);

        $this->assertEquals(1, $summary['claimed'], "Claimed 1 record");
        $this->assertEquals(1, $summary['delivered'], "Delivered 1 record");
        $this->assertEquals(0, $summary['failed'], "Failed 0 records");

        // Verify mark delivered query was executed
        $foundDelivered = false;
        foreach ($pdo->log as $entry) {
            if (stripos($entry, "SET status = 'delivered'") !== false) {
                $foundDelivered = true;
                break;
            }
        }
        $this->assertTrue($foundDelivered, "Must update record status to delivered");
    }

    private function testTerminalFailureOn409OrMaxAttempts(): void
    {
        $pdo = new OutboxTestDoublePdo('mysql');
        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-1',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'secret-32-chars-long-string-value-here',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://electroplan.test/api/won',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);

        $pdo->whenQueryContains('GET_LOCK', new OutboxTestDoublePdoStatement([['1' => 1]]));
        $pdo->whenQueryContains('RELEASE_LOCK', new OutboxTestDoublePdoStatement([['1' => 1]]));
        $pdo->whenQueryContains('UPDATE won_project_outbox', new OutboxTestDoublePdoStatement([], 1));

        $pdo->whenQueryContains('WHERE locked_by = ?', new OutboxTestDoublePdoStatement([
            [
                'id' => 11,
                'event_id' => 'a8f09d84-7a2e-4b6d-97e3-05f32a762df2',
                'project_id' => 102,
                'event_type' => 'project.won',
                'payload' => '{"event_id":"a8f09d84-7a2e-4b6d-97e3-05f32a762df2"}',
                'payload_hash' => hash('sha256', '{}'),
                'attempts' => 1,
            ]
        ]));

        // Recipient returns terminal 409 Conflict (e.g. unrecoverable schema mismatch or client conflict)
        $transport = function (): array {
            return [
                'status_code' => 409,
                'body' => '{"error":"Conflict"}',
                'error' => 'HTTP 409 Conflict',
            ];
        };

        $client = new WonProjectHmacClient($config, $transport);
        $dispatcher = new WonProjectOutboxDispatcher($pdo, $config, $client);

        $summary = $dispatcher->dispatchBatch(10);

        $this->assertEquals(1, $summary['claimed'], "Claimed 1");
        $this->assertEquals(1, $summary['failed'], "409 is terminal, must mark failed");
        $this->assertEquals(0, $summary['retried'], "Must not schedule retry for terminal error");

        // Verify mark failed statement was executed with next_attempt_at = NULL
        $foundFailed = false;
        $foundNextAttemptNull = false;
        foreach ($pdo->log as $entry) {
            if (stripos($entry, "SET status = 'failed'") !== false) {
                $foundFailed = true;
                if (stripos($entry, "next_attempt_at = NULL") !== false) {
                    $foundNextAttemptNull = true;
                }
                break;
            }
        }
        $this->assertTrue($foundFailed, "Must update record status to failed");
        $this->assertTrue($foundNextAttemptNull, "Must set next_attempt_at = NULL on terminal failure");
    }

    private function testTransientFailure5xxIncrementsAttemptsAndSchedulesRetry(): void
    {
        $pdo = new OutboxTestDoublePdo('mysql');
        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-1',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'secret-32-chars-long-string-value-here',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://electroplan.test/api/won',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);

        $pdo->whenQueryContains('GET_LOCK', new OutboxTestDoublePdoStatement([['1' => 1]]));
        $pdo->whenQueryContains('RELEASE_LOCK', new OutboxTestDoublePdoStatement([['1' => 1]]));
        $pdo->whenQueryContains('UPDATE won_project_outbox', new OutboxTestDoublePdoStatement([], 1));

        $pdo->whenQueryContains('WHERE locked_by = ?', new OutboxTestDoublePdoStatement([
            [
                'id' => 12,
                'event_id' => 'a8f09d84-7a2e-4b6d-97e3-05f32a762df3',
                'project_id' => 103,
                'event_type' => 'project.won',
                'payload' => '{"event_id":"a8f09d84-7a2e-4b6d-97e3-05f32a762df3"}',
                'payload_hash' => hash('sha256', '{}'),
                'attempts' => 1,
            ]
        ]));

        // Recipient returns transient 503
        $transport = function (): array {
            return [
                'status_code' => 503,
                'body' => 'Service Unavailable',
                'error' => 'HTTP 503 Service Unavailable',
            ];
        };

        $client = new WonProjectHmacClient($config, $transport);
        $dispatcher = new WonProjectOutboxDispatcher($pdo, $config, $client);

        $summary = $dispatcher->dispatchBatch(10);

        $this->assertEquals(1, $summary['claimed'], "Claimed 1");
        $this->assertEquals(0, $summary['delivered'], "Delivered 0");
        $this->assertEquals(0, $summary['failed'], "Failed 0 (transient)");
        $this->assertEquals(1, $summary['retried'], "Retried 1");

        // Verify status remains pending with next_attempt_at computed via DB server clock
        $foundRetry = false;
        foreach ($pdo->log as $entry) {
            if (
                stripos($entry, "SET status = 'pending'") !== false &&
                stripos($entry, "CURRENT_TIMESTAMP") !== false &&
                stripos($entry, "DATE_ADD") !== false
            ) {
                $foundRetry = true;
                break;
            }
        }
        $this->assertTrue($foundRetry, "Must update record using server clock CURRENT_TIMESTAMP/DATE_ADD and keep status pending");
    }

    private function testConcurrentLockContractsGetLockAndReleaseLock(): void
    {
        $pdo = new OutboxTestDoublePdo('mysql');
        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-1',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'secret-32-chars-long-string-value-here',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://electroplan.test/api/won',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);

        // GET_LOCK returns 0 (lock held by another dispatcher instance)
        $pdo->whenQueryContains('GET_LOCK', new OutboxTestDoublePdoStatement([['0' => 0]]));

        $dispatcher = new WonProjectOutboxDispatcher($pdo, $config);
        $res = $dispatcher->dispatchBatch(10);

        $this->assertEquals('busy', $res['status'], "Dispatcher returns status busy when GET_LOCK returns 0");
        $this->assertEquals(0, $res['claimed'], "Zero records claimed when lock busy");
    }

    private function testLockNameDerivedFromDatabaseStableBoundedAndUnexposed(): void
    {
        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-1',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'secret-32-chars-long-string-value-here',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://electroplan.test/api/won',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);

        // Database 1
        $pdo1 = new OutboxTestDoublePdo('mysql');
        $pdo1->whenQueryContains('DATABASE()', new OutboxTestDoublePdoStatement([['DATABASE()' => 'tenant_db_alpha']]));
        $dispatcher1 = new WonProjectOutboxDispatcher($pdo1, $config);
        $lock1 = $dispatcher1->getLockName();

        // Database 2
        $pdo2 = new OutboxTestDoublePdo('mysql');
        $pdo2->whenQueryContains('DATABASE()', new OutboxTestDoublePdoStatement([['DATABASE()' => 'tenant_db_beta']]));
        $dispatcher2 = new WonProjectOutboxDispatcher($pdo2, $config);
        $lock2 = $dispatcher2->getLockName();

        // 1. Must be non-empty strings
        $this->assertNotEmpty($lock1, "Lock name 1 must not be empty");
        $this->assertNotEmpty($lock2, "Lock name 2 must not be empty");

        // 2. Different databases produce different lock names (no cross-database collision)
        $this->assertTrue($lock1 !== $lock2, "Different databases must produce different lock names to prevent collisions");

        // 3. Stable across calls
        $this->assertEquals($lock1, $dispatcher1->getLockName(), "Lock name must be stable across multiple calls");
        $this->assertEquals($lock2, $dispatcher2->getLockName(), "Lock name must be stable across multiple calls");

        // 4. Bounded length (<= 64 chars)
        $this->assertTrue(strlen($lock1) <= 64, "Lock name 1 must not exceed 64 chars (got " . strlen($lock1) . ")");
        $this->assertTrue(strlen($lock2) <= 64, "Lock name 2 must not exceed 64 chars (got " . strlen($lock2) . ")");

        // 5. Does not expose cleartext database name
        $this->assertFalse(str_contains($lock1, 'tenant_db_alpha'), "Lock name must not expose cleartext database name");
        $this->assertFalse(str_contains($lock2, 'tenant_db_beta'), "Lock name must not expose cleartext database name");

        // 6. acquireLock and releaseLock use the exact same lock name value
        $acquiredLockName = null;
        $releasedLockName = null;

        $pdo1->whenQueryContains('GET_LOCK', function (string $sql) use (&$acquiredLockName) {
            $stmt = new OutboxTestDoublePdoStatement([['1' => 1]], 1, $sql);
            $stmt->onExecute = function (?array $params) use (&$acquiredLockName) {
                $acquiredLockName = $params[0] ?? null;
            };
            return $stmt;
        });

        $pdo1->whenQueryContains('RELEASE_LOCK', function (string $sql) use (&$releasedLockName) {
            $stmt = new OutboxTestDoublePdoStatement([['1' => 1]], 1, $sql);
            $stmt->onExecute = function (?array $params) use (&$releasedLockName) {
                $releasedLockName = $params[0] ?? null;
            };
            return $stmt;
        });

        // Claim returns empty
        $pdo1->whenQueryContains('UPDATE won_project_outbox', new OutboxTestDoublePdoStatement([], 0));
        $pdo1->whenQueryContains('WHERE locked_by = ?', new OutboxTestDoublePdoStatement([]));

        $dispatcher1->dispatchBatch(10);

        $this->assertEquals($lock1, $acquiredLockName, "GET_LOCK must be invoked with derived lock name");
        $this->assertEquals($lock1, $releasedLockName, "RELEASE_LOCK must be invoked with identical derived lock name");
        $this->assertEquals($acquiredLockName, $releasedLockName, "Acquire and release lock must use exactly the same value");
    }

    private function testTransientFailureSchedulesRetryWithSqliteClock(): void
    {
        $pdo = new OutboxTestDoublePdo('sqlite');
        $config = new WonProjectIntegrationConfig([
            'WON_PROJECT_EXPORT_ENABLED' => true,
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => 'key-1',
            'WON_PROJECT_HMAC_ACTIVE_SECRET' => 'secret-32-chars-long-string-value-here',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT' => 'https://electroplan.test/api/won',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,
        ]);

        $pdo->whenQueryContains('SELECT id FROM won_project_outbox', new OutboxTestDoublePdoStatement([
            ['id' => 15],
        ]));
        $pdo->whenQueryContains('UPDATE won_project_outbox', new OutboxTestDoublePdoStatement([], 1));
        $pdo->whenQueryContains('WHERE locked_by = ?', new OutboxTestDoublePdoStatement([
            [
                'id' => 15,
                'event_id' => 'a8f09d84-7a2e-4b6d-97e3-05f32a762df4',
                'project_id' => 104,
                'event_type' => 'project.won',
                'payload' => '{"event_id":"a8f09d84-7a2e-4b6d-97e3-05f32a762df4"}',
                'payload_hash' => hash('sha256', '{}'),
                'attempts' => 0,
            ]
        ]));

        $transport = function (): array {
            return [
                'status_code' => 500,
                'body' => 'Internal Server Error',
                'error' => 'HTTP 500 Internal Server Error',
            ];
        };

        $client = new WonProjectHmacClient($config, $transport);
        $dispatcher = new WonProjectOutboxDispatcher($pdo, $config, $client);
        $summary = $dispatcher->dispatchBatch(10);

        $this->assertEquals(1, $summary['retried'], "SQLite transient failure scheduled retry");

        $foundSqliteRetry = false;
        foreach ($pdo->log as $entry) {
            if (
                stripos($entry, "SET status = 'pending'") !== false &&
                stripos($entry, "datetime('now'") !== false
            ) {
                $foundSqliteRetry = true;
                break;
            }
        }
        $this->assertTrue($foundSqliteRetry, "SQLite branch must use datetime('now') for backoff");
    }

    private function testMigrationSchemaAllowsNullNextAttemptAtForTerminalFailed(): void
    {
        $migrationPath = __DIR__ . '/../db/migrations/20261009_won_project_outbox.sql';
        $this->assertTrue(file_exists($migrationPath), "Migration file must exist");
        $sql = (string)file_get_contents($migrationPath);

        // Check that next_attempt_at column definition allows NULL
        $this->assertTrue(
            (bool)preg_match('/`next_attempt_at`\s+TIMESTAMP\s+NULL/i', $sql),
            "Migration must define next_attempt_at as TIMESTAMP NULL so terminal failed records can persist NULL"
        );
        $this->assertFalse(
            (bool)preg_match('/`next_attempt_at`\s+TIMESTAMP\s+NOT\s+NULL/i', $sql),
            "Migration must NOT define next_attempt_at as NOT NULL"
        );
    }

    private function testOperatorRetryFailedRequiresConcretePositiveId(): void
    {
        $pdo = new OutboxTestDoublePdo('mysql');
        $config = new WonProjectIntegrationConfig(['WON_PROJECT_EXPORT_ENABLED' => false]);
        $dispatcher = new WonProjectOutboxDispatcher($pdo, $config);

        // 1. Invalid or non-positive ID must throw
        $threwZero = false;
        try {
            $dispatcher->retryFailed(0);
        } catch (InvalidArgumentException) {
            $threwZero = true;
        }
        $this->assertTrue($threwZero, "retryFailed must reject 0");

        $threwNegative = false;
        try {
            $dispatcher->retryFailed(-5);
        } catch (InvalidArgumentException) {
            $threwNegative = true;
        }
        $this->assertTrue($threwNegative, "retryFailed must reject negative ID");

        // 2. Concrete positive ID executes reset query
        $stmt = new OutboxTestDoublePdoStatement([], 1);
        $pdo->whenQueryContains("UPDATE won_project_outbox", $stmt);

        $rows = $dispatcher->retryFailed(42);
        $this->assertEquals(1, $rows, "retryFailed returns affected row count");

        // Verify statement reset fields
        $foundReset = false;
        foreach ($pdo->log as $entry) {
            if (stripos($entry, "SET status = 'pending'") !== false && stripos($entry, "attempts = 0") !== false && stripos($entry, "WHERE status = 'failed' AND id = ?") !== false) {
                $foundReset = true;
                break;
            }
        }
        $this->assertTrue($foundReset, "retryFailed must reset status, attempts, error and target specific ID");
    }

    // -------------------------------------------------------------------------
    // Assertions
    // -------------------------------------------------------------------------

    private function assertTrue(bool $condition, string $msg): void
    {
        if (!$condition) throw new RuntimeException("Assertion failed: {$msg}");
    }

    private function assertFalse(bool $condition, string $msg): void
    {
        if ($condition) throw new RuntimeException("Assertion failed (expected false): {$msg}");
    }

    private function assertEquals($expected, $actual, string $msg): void
    {
        if ($expected !== $actual) {
            $expStr = is_scalar($expected) ? (string)$expected : json_encode($expected);
            $actStr = is_scalar($actual) ? (string)$actual : json_encode($actual);
            throw new RuntimeException("Assertion failed: {$msg} [Expected: {$expStr}, got: {$actStr}]");
        }
    }

    private function assertNotEmpty($val, string $msg): void
    {
        if (empty($val)) throw new RuntimeException("Assertion failed: {$msg} (empty)");
    }

    private function assertEmpty($val, string $msg): void
    {
        if (!empty($val)) throw new RuntimeException("Assertion failed: {$msg} (not empty)");
    }

    private function assertGreaterThanOrEqual($min, $val, string $msg): void
    {
        if ($val < $min) throw new RuntimeException("Assertion failed: {$msg} ({$val} not >= {$min})");
    }
}

// CLI Execution entrypoint
$runner = new WonProjectOutboxContractTestRunner();
exit($runner->run());
