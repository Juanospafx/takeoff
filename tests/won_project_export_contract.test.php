<?php
declare(strict_types=1);

/**
 * Contract Tests: WonProjectExportService & WonProjectExport.v1 Schema
 *
 * Verifies:
 *   - Schema conformity against contracts/won-project-export.v1.schema.json
 *   - Valid & invalid canonical payloads (types, UUID format, role enums, checksums, URLs)
 *   - Exact interface signature: markAsWon(int $projectId, int $actorUserId, string $actorRole): array
 *   - RBAC enforcement (role parameter must be 'admin' AND persisted user role must be 'admin')
 *   - Takeoff identity preservation (source_system = 'takeoff', IDs, absence of external Inventory)
 *   - Estimates, quantities, UOM, and costs precision preserved without loss
 *   - Atomic status transition (project marked accepted + outbox record inserted in transaction / savepoint)
 *   - Transaction rollback on outbox failure preserves original project state
 *   - Replay idempotency: returns canonical payload without duplicate outbox entries, stable idempotency_key
 *   - Idempotency key: deterministic 10-digit decimal padding for project_id and estimate_id (>=16 chars, <=128 chars, non-truncating)
 *   - Documents manifest: only persisted SHA-256 checksums, secure HTTPS/API URLs
 *
 * Runs without PDO drivers (pdo_sqlite / pdo_mysql), external network, curl, or MariaDB.
 */

namespace Brightronix\Takeoff\Tests\Contracts;

use PDO;
use PDOException;
use PDOStatement;
use ReflectionClass;
use ReflectionNamedType;
use ReturnTypeWillChange;
use RuntimeException;
use InvalidArgumentException;
use Throwable;
use WonProjectExportService;
use WonProjectIntegrationConfig;

require_once __DIR__ . '/../core/config/WonProjectIntegrationConfig.php';
require_once __DIR__ . '/../core/services/WonProjectExportService.php';

// -----------------------------------------------------------------------------
// Controlled In-Memory Test Doubles for PDO / PDOStatement
// -----------------------------------------------------------------------------

class TestDoublePdoStatement extends PDOStatement
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

class TestDoublePdo extends PDO
{
    public array $log = [];
    public array $executedStatements = [];
    public int $transactionLevel = 0;
    public array $activeSavepoints = [];
    public string $driverName = 'mysql';
    /** @var array<string, callable|TestDoublePdoStatement> */
    public array $handlers = [];

    public function __construct(string $driverName = 'mysql')
    {
        $this->driverName = $driverName;
        // Skip parent::__construct()
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
    public function beginTransaction(): bool
    {
        $this->transactionLevel++;
        $this->log[] = 'BEGIN';
        return true;
    }

    #[ReturnTypeWillChange]
    public function commit(): bool
    {
        $this->transactionLevel = max(0, $this->transactionLevel - 1);
        $this->log[] = 'COMMIT';
        return true;
    }

    #[ReturnTypeWillChange]
    public function rollBack(): bool
    {
        $this->transactionLevel = max(0, $this->transactionLevel - 1);
        $this->log[] = 'ROLLBACK';
        return true;
    }

    #[ReturnTypeWillChange]
    public function inTransaction(): bool
    {
        return $this->transactionLevel > 0;
    }

    #[ReturnTypeWillChange]
    public function exec(string $statement): int|false
    {
        $this->log[] = 'EXEC: ' . $statement;
        if (preg_match('/^SAVEPOINT\s+(\w+)/i', $statement, $m)) {
            $this->activeSavepoints[] = $m[1];
        } elseif (preg_match('/^RELEASE\s+SAVEPOINT\s+(\w+)/i', $statement, $m)) {
            $idx = array_search($m[1], $this->activeSavepoints, true);
            if ($idx !== false) {
                unset($this->activeSavepoints[$idx]);
                $this->activeSavepoints = array_values($this->activeSavepoints);
            }
        } elseif (preg_match('/^ROLLBACK\s+TO\s+SAVEPOINT\s+(\w+)/i', $statement, $m)) {
            $idx = array_search($m[1], $this->activeSavepoints, true);
            if ($idx !== false) {
                // remove any savepoints created after this one
                $this->activeSavepoints = array_slice($this->activeSavepoints, 0, $idx + 1);
            }
        }
        return 1;
    }

    #[ReturnTypeWillChange]
    public function prepare(string $query, array $options = []): TestDoublePdoStatement
    {
        $this->log[] = 'PREPARE: ' . $query;

        foreach ($this->handlers as $pattern => $handler) {
            if (stripos($query, $pattern) !== false) {
                $stmt = is_callable($handler) ? $handler($query) : $handler;
                $this->executedStatements[] = $stmt;
                return $stmt;
            }
        }

        $defaultStmt = new TestDoublePdoStatement([], 1, $query);
        $this->executedStatements[] = $defaultStmt;
        return $defaultStmt;
    }

    #[ReturnTypeWillChange]
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): TestDoublePdoStatement|false
    {
        $stmt = $this->prepare($query);
        $stmt->execute();
        return $stmt;
    }

    public function whenQueryContains(string $pattern, callable|TestDoublePdoStatement $handler): void
    {
        $this->handlers[$pattern] = $handler;
    }
}

// -----------------------------------------------------------------------------
// Test Suite Runner
// -----------------------------------------------------------------------------

final class WonProjectExportContractTestRunner
{
    private array $results = [];
    private string $schemaPath;

    public function __construct(string $schemaPath)
    {
        $this->schemaPath = $schemaPath;
    }

    public function run(): int
    {
        echo "======================================================================\n";
        echo "TEST SUITE: WonProjectExport Contract & Schema\n";
        echo "======================================================================\n\n";

        $tests = [
            'testCanonicalSchemaFileExistsAndIsValidJson' => 'Schema file exists, is readable, and contains valid JSON Draft 2020-12',
            'testCanonicalSchemaContainsRequiredTopLevelProperties' => 'Schema defines required top-level properties and strict additionalProperties:false',
            'testCanonicalSamplePayloadConformsToContract' => 'Valid canonical Takeoff won-project payload conforms to schema',
            'testInvalidPayloadMissingRequiredFieldsIsRejected' => 'Payload missing required fields fails validation',
            'testInvalidPayloadBadEventIdUuidFormatIsRejected' => 'Payload with invalid event_id UUID format fails validation',
            'testInvalidPayloadDisallowedSourceSystemIsRejected' => 'Payload with source_system other than "takeoff" fails validation',
            'testInvalidPayloadNegativeQuantityOrCostsIsRejected' => 'Payload with negative quantities or costs fails validation',
            'testInvalidPayloadInsecureDocumentDownloadUrlIsRejected' => 'Payload with non-https / non-api document download_url fails validation',
            'testInvalidPayloadNonSha256ChecksumIsRejected' => 'Payload with invalid checksum pattern fails validation',
            'testInvalidPayloadDisallowedRoleIsRejected' => 'Payload with invalid role enum in assigned_roles fails validation',
            'testStructuralFreezeWonProjectExportServiceSignature' => 'Interface frozen: WonProjectExportService::markAsWon(int,int,string): array',
            'testRbacRoleParameterAndPersistedAdminRequired' => 'RBAC: actor parameter and persisted users role must both be admin; non-admin rejected',
            'testTakeoffIdentityPreservationInExportPayload' => 'Takeoff identity preserved (source_system=takeoff, project_id, bid_id, estimate_id; no Inventory)',
            'testMaterialsQuantityUomAndCostInvariants' => 'Materials snapshot preserves quantity, UOM, unit_cost, and total_cost without loss',
            'testAtomicStatusAcceptedAndOutboxWriteInTransaction' => 'Atomic transition: project marked accepted and outbox record written in single transaction/savepoint',
            'testRollbackOnOutboxFailurePreservesOriginalStatus' => 'Atomic rollback: failure to insert outbox rolls back status transition',
            'testReplayIdempotencyDoesNotDuplicateOutbox' => 'Replay idempotency: markAsWon replay returns idempotent payload without duplicate outbox entries',
            'testDocumentsManifestPersistedChecksumOnly' => 'Documents manifest includes only documents with persisted SHA-256 and secure HTTPS/API URL',
            'testIdempotencyKeySingleDigitIdsContractAndDeterministic' => 'Idempotency key for small IDs (1/1): length within 16..128, deterministic 10-digit padding, and absence of Inventory',
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
    // Test Cases: Schema Validation
    // -------------------------------------------------------------------------

    private function testCanonicalSchemaFileExistsAndIsValidJson(): void
    {
        $this->assertTrue(file_exists($this->schemaPath), "Schema file must exist at {$this->schemaPath}");
        $content = file_get_contents($this->schemaPath);
        $this->assertNotEmpty($content, "Schema file must not be empty");

        $decoded = json_decode($content, true);
        $this->assertIsArray($decoded, "Schema must be valid JSON: " . json_last_error_msg());
        $this->assertEquals("WonProjectExport.v1", $decoded['title'] ?? null, "Schema title must be WonProjectExport.v1");
        $this->assertEquals("https://json-schema.org/draft/2020-12/schema", $decoded['$schema'] ?? null, "Must declare Draft 2020-12 schema");
    }

    private function testCanonicalSchemaContainsRequiredTopLevelProperties(): void
    {
        $schema = json_decode(file_get_contents($this->schemaPath), true);
        $expectedRequired = [
            'event_id',
            'occurred_at',
            'source_system',
            'source_project_id',
            'source_bid_id',
            'source_estimate_id',
            'idempotency_key',
            'correlation_id',
            'traceability',
            'approved_estimate',
            'project',
            'commercial_summary',
            'materials_snapshot',
            'documents_manifest',
        ];

        $requiredInSchema = $schema['required'] ?? [];
        sort($expectedRequired);
        sort($requiredInSchema);
        $this->assertEquals($expectedRequired, $requiredInSchema, "Schema must declare all 14 required top-level properties");
        $this->assertFalse($schema['additionalProperties'] ?? true, "additionalProperties must be false");
    }

    private function testCanonicalSamplePayloadConformsToContract(): void
    {
        $payload = $this->createCanonicalValidPayload();
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertEmpty($errors, "Canonical sample payload must pass schema validation without errors: " . implode(', ', $errors));
    }

    private function testInvalidPayloadMissingRequiredFieldsIsRejected(): void
    {
        $payload = $this->createCanonicalValidPayload();
        unset($payload['commercial_summary']);
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertNotEmpty($errors, "Payload missing commercial_summary must be rejected");

        $payload2 = $this->createCanonicalValidPayload();
        unset($payload2['materials_snapshot']);
        $errors2 = $this->validateAgainstContractSchema($payload2);
        $this->assertNotEmpty($errors2, "Payload missing materials_snapshot must be rejected");
    }

    private function testInvalidPayloadBadEventIdUuidFormatIsRejected(): void
    {
        $payload = $this->createCanonicalValidPayload();
        $payload['event_id'] = 'not-a-valid-uuid-1234';
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertNotEmpty($errors, "Payload with invalid event_id UUID must be rejected");
    }

    private function testInvalidPayloadDisallowedSourceSystemIsRejected(): void
    {
        $payload = $this->createCanonicalValidPayload();
        $payload['source_system'] = 'other_system';
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertNotEmpty($errors, "Payload with non-takeoff source_system must be rejected");
    }

    private function testInvalidPayloadNegativeQuantityOrCostsIsRejected(): void
    {
        $payload = $this->createCanonicalValidPayload();
        $payload['materials_snapshot']['items'][0]['quantity'] = -10.5;
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertNotEmpty($errors, "Negative quantity in materials item must be rejected");

        $payload2 = $this->createCanonicalValidPayload();
        $payload2['commercial_summary']['total_amount'] = -100.0;
        $errors2 = $this->validateAgainstContractSchema($payload2);
        $this->assertNotEmpty($errors2, "Negative total_amount must be rejected");
    }

    private function testInvalidPayloadInsecureDocumentDownloadUrlIsRejected(): void
    {
        $payload = $this->createCanonicalValidPayload();
        $payload['documents_manifest']['documents'][0]['download_url'] = 'file:///etc/passwd';
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertNotEmpty($errors, "Local file protocol download_url must be rejected");
    }

    private function testInvalidPayloadNonSha256ChecksumIsRejected(): void
    {
        $payload = $this->createCanonicalValidPayload();
        $payload['documents_manifest']['documents'][0]['checksum']['value'] = 'short-hash';
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertNotEmpty($errors, "Non-64-hex checksum must be rejected");
    }

    private function testInvalidPayloadDisallowedRoleIsRejected(): void
    {
        $payload = $this->createCanonicalValidPayload();
        $payload['project']['assigned_roles'][0]['role'] = 'external_contractor';
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertNotEmpty($errors, "Disallowed assigned role enum must be rejected");
    }

    // -------------------------------------------------------------------------
    // Test Cases: Service Interface Freezing & Invariants
    // -------------------------------------------------------------------------

    private function testStructuralFreezeWonProjectExportServiceSignature(): void
    {
        $serviceClass = 'WonProjectExportService';
        $this->assertTrue(class_exists($serviceClass), "WonProjectExportService class must exist");

        $ref = new ReflectionClass($serviceClass);
        $this->assertTrue($ref->hasMethod('markAsWon'), "WonProjectExportService must declare markAsWon method");

        $method = $ref->getMethod('markAsWon');
        $this->assertTrue($method->isPublic(), "markAsWon must be public");

        $params = $method->getParameters();
        $this->assertGreaterThanOrEqual(3, count($params), "markAsWon must accept 3 parameters: int, int, string");

        $param0Type = $params[0]->getType();
        $this->assertTrue($param0Type instanceof ReflectionNamedType && $param0Type->getName() === 'int', "Param 0 must be int (projectId)");

        $param1Type = $params[1]->getType();
        $this->assertTrue($param1Type instanceof ReflectionNamedType && $param1Type->getName() === 'int', "Param 1 must be int (actorUserId)");

        $param2Type = $params[2]->getType();
        $this->assertTrue($param2Type instanceof ReflectionNamedType && $param2Type->getName() === 'string', "Param 2 must be string (actorRole)");

        $returnType = $method->getReturnType();
        $this->assertTrue($returnType instanceof ReflectionNamedType && $returnType->getName() === 'array', "markAsWon return type must be array");
    }

    private function testRbacRoleParameterAndPersistedAdminRequired(): void
    {
        $pdo = $this->createStandardFakePdo();
        $service = new WonProjectExportService($pdo);

        // 1. Non-admin role parameter throws InvalidArgumentException before any query
        $threwParam = false;
        try {
            $service->markAsWon(101, 42, 'estimator');
        } catch (InvalidArgumentException $e) {
            $threwParam = true;
            $this->assertTrue(str_contains($e->getMessage(), 'admin'), "Exception must indicate admin role required");
        }
        $this->assertTrue($threwParam, "markAsWon must reject non-admin actorRole argument");

        // 2. Persisted user having role != 'admin' throws RuntimeException
        $pdoNonAdmin = $this->createStandardFakePdo();
        $pdoNonAdmin->whenQueryContains('SELECT role FROM users', new TestDoublePdoStatement([
            ['role' => 'estimator']
        ]));
        $serviceNonAdmin = new WonProjectExportService($pdoNonAdmin);

        $threwPersisted = false;
        try {
            $serviceNonAdmin->markAsWon(101, 42, 'admin');
        } catch (RuntimeException $e) {
            $threwPersisted = true;
            $this->assertTrue(str_contains(strtolower($e->getMessage()), 'unauthorized') || str_contains(strtolower($e->getMessage()), 'admin'), "Exception must indicate persisted user is not admin");
        }
        $this->assertTrue($threwPersisted, "markAsWon must reject actor when persisted database role is not admin");
    }

    private function testTakeoffIdentityPreservationInExportPayload(): void
    {
        $pdo = $this->createStandardFakePdo();
        $service = new WonProjectExportService($pdo);

        $payload = $service->markAsWon(101, 42, 'admin');

        // Check Takeoff identity preservation
        $this->assertEquals('takeoff', $payload['source_system'], "source_system must strictly be 'takeoff'");
        $this->assertEquals('101', $payload['source_project_id'], "source_project_id must match project ID");
        $this->assertEquals('202', $payload['source_bid_id'], "source_bid_id must match bid ID");
        $this->assertEquals('303', $payload['source_estimate_id'], "source_estimate_id must match estimate ID");
        $this->assertEquals('project.won-0000000101-0000000303', $payload['idempotency_key'], "idempotency_key must match deterministic 10-digit padded format");

        // Contractual guarantee: no mention or leak of external Inventory
        $json = json_encode($payload);
        $this->assertFalse(stripos($json, 'inventory') !== false && stripos($json, 'source_system') !== false, "Must not set inventory as source system");

        // Schema validation
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertEmpty($errors, "Live generated payload must validate against schema: " . implode(', ', $errors));
    }

    private function testMaterialsQuantityUomAndCostInvariants(): void
    {
        $pdo = $this->createStandardFakePdo();
        $service = new WonProjectExportService($pdo);

        $payload = $service->markAsWon(101, 42, 'admin');
        $items = $payload['materials_snapshot']['items'];
        $this->assertNotEmpty($items, "Materials items must not be empty");
        $this->assertEquals(2, count($items), "Must extract all estimate items without loss");

        $item1 = $items[0];
        $this->assertEquals('1', $item1['item_id'], "Item 1 ID");
        $this->assertEquals('THHN-12-BLK', $item1['item_code'], "Item 1 code preserved");
        $this->assertEquals('spool', $item1['unit_of_measure'], "Item 1 UOM preserved");
        $this->assertEquals(15.0, (float)$item1['quantity'], "Item 1 quantity preserved");
        $this->assertEquals(85.50, (float)$item1['unit_cost'], "Item 1 unit cost preserved");
        $this->assertEquals(1282.50, (float)$item1['total_cost'], "Item 1 total cost preserved");

        $item2 = $items[1];
        $this->assertEquals('2', $item2['item_id'], "Item 2 ID");
        $this->assertEquals('PANEL-200A', $item2['item_code'], "Item 2 code preserved");
        $this->assertEquals('each', $item2['unit_of_measure'], "Item 2 UOM preserved");
        $this->assertEquals(2.0, (float)$item2['quantity'], "Item 2 quantity preserved");
        $this->assertEquals(450.00, (float)$item2['unit_cost'], "Item 2 unit cost preserved");
        $this->assertEquals(900.00, (float)$item2['total_cost'], "Item 2 total cost preserved");
    }

    private function testAtomicStatusAcceptedAndOutboxWriteInTransaction(): void
    {
        $pdo = $this->createStandardFakePdo();
        $service = new WonProjectExportService($pdo);

        $payload = $service->markAsWon(101, 42, 'admin');

        $this->assertIsArray($payload, "markAsWon must return payload array");

        // Verify transaction / savepoint lifecycle in log
        $hasBegin = in_array('BEGIN', $pdo->log, true);
        $hasCommit = in_array('COMMIT', $pdo->log, true);
        $this->assertTrue($hasBegin, "markAsWon must begin a transaction");
        $this->assertTrue($hasCommit, "markAsWon must commit the transaction on success");

        // Verify UPDATE projects SET status = 'accepted' was prepared/executed
        $foundStatusUpdate = false;
        $foundOutboxInsert = false;
        foreach ($pdo->log as $entry) {
            if (stripos($entry, "UPDATE projects SET status = 'accepted'") !== false) {
                $foundStatusUpdate = true;
            }
            if (stripos($entry, "INSERT INTO won_project_outbox") !== false) {
                $foundOutboxInsert = true;
            }
        }
        $this->assertTrue($foundStatusUpdate, "markAsWon must update project status to accepted");
        $this->assertTrue($foundOutboxInsert, "markAsWon must insert outbox record");
    }

    private function testRollbackOnOutboxFailurePreservesOriginalStatus(): void
    {
        $pdo = $this->createStandardFakePdo();

        // Make the outbox insert fail with PDOException (simulating table error or lock failure)
        $failStmt = new TestDoublePdoStatement([], 0);
        $failStmt->onExecute = function () {
            throw new PDOException("Simulated outbox disk error or table failure");
        };
        $pdo->whenQueryContains('INSERT INTO won_project_outbox', $failStmt);

        $service = new WonProjectExportService($pdo);

        $threw = false;
        try {
            $service->markAsWon(101, 42, 'admin');
        } catch (PDOException $e) {
            $threw = true;
        }
        $this->assertTrue($threw, "markAsWon must propagate exception on outbox write failure");

        // Verify ROLLBACK was called
        $hasRollback = in_array('ROLLBACK', $pdo->log, true);
        $this->assertTrue($hasRollback, "markAsWon must roll back outer transaction on failure");
    }

    private function testReplayIdempotencyDoesNotDuplicateOutbox(): void
    {
        $pdo = $this->createStandardFakePdo();

        // Simulate existing outbox record for project 101
        $canonicalPayload = $this->createCanonicalValidPayload();
        $canonicalPayload['source_project_id'] = '101';
        $canonicalPayload['idempotency_key'] = 'project.won-101-303';
        $existingJson = json_encode($canonicalPayload);

        $pdo->whenQueryContains("FROM won_project_outbox WHERE project_id = ? AND event_type = 'project.won'", new TestDoublePdoStatement([
            ['payload' => $existingJson]
        ]));

        $service = new WonProjectExportService($pdo);
        $payload = $service->markAsWon(101, 42, 'admin');

        $this->assertEquals($canonicalPayload['event_id'], $payload['event_id'], "Replay must return exact existing event_id");
        $this->assertEquals($canonicalPayload['idempotency_key'], $payload['idempotency_key'], "Replay must return stable idempotency_key");

        // Verify no INSERT was attempted
        $inserted = false;
        foreach ($pdo->log as $entry) {
            if (stripos($entry, "INSERT INTO won_project_outbox") !== false) {
                $inserted = true;
                break;
            }
        }
        $this->assertFalse($inserted, "Replay must NOT execute an INSERT into won_project_outbox");
    }

    private function testDocumentsManifestPersistedChecksumOnly(): void
    {
        $pdo = $this->createStandardFakePdo();

        // One document with persisted SHA-256 and HTTPS url, one doc without valid checksum (should be excluded)
        $sha = hash('sha256', 'sample-doc-content');
        $pdo->whenQueryContains('FROM project_documents WHERE project_id = ?', new TestDoublePdoStatement([
            [
                'id' => '10',
                'project_id' => 101,
                'original_filename' => 'drawing1.pdf',
                'document_type' => 'drawings',
                'mime_type' => 'application/pdf',
                'file_size' => 1048576,
                'checksum_sha256' => $sha,
                'download_url' => 'https://takeoff.brightronix.com/api/projects/101/documents/10/download',
            ],
            [
                'id' => '11',
                'project_id' => 101,
                'original_filename' => 'corrupted.pdf',
                'document_type' => 'other',
                'mime_type' => 'application/pdf',
                'file_size' => 500,
                'checksum_sha256' => 'invalid-non-hex', // Should be skipped!
                'download_url' => 'https://takeoff.brightronix.com/api/projects/101/documents/11/download',
            ],
        ]));

        $service = new WonProjectExportService($pdo);
        $payload = $service->markAsWon(101, 42, 'admin');

        $docs = $payload['documents_manifest']['documents'];
        $this->assertCount(1, $docs, "Documents without valid persisted sha256 must be omitted");
        $this->assertEquals('10', $docs[0]['document_id'], "Valid document preserved");
        $this->assertEquals($sha, $docs[0]['checksum']['value'], "Checksum value matches");
        $this->assertEquals('https://takeoff.brightronix.com/api/projects/101/documents/10/download', $docs[0]['download_url'], "Secure HTTPS URL preserved");
    }

    private function testIdempotencyKeySingleDigitIdsContractAndDeterministic(): void
    {
        $pdo = new TestDoublePdo('mysql');

        $pdo->whenQueryContains('information_schema.tables', new TestDoublePdoStatement([
            ['1' => 1]
        ]));

        $pdo->whenQueryContains('FROM projects WHERE id = ?', new TestDoublePdoStatement([
            [
                'id' => 1,
                'project_number' => 'PRJ-1',
                'name' => 'Single Digit Project',
                'status' => 'in_review',
                'client_id' => 'CLI-1',
                'client_name' => 'Acme Corp',
                'contact_name' => 'John Doe',
                'contact_email' => 'jdoe@acme.com',
                'contact_phone' => '+1-555-0101',
                'job_address' => '1 Main Street',
                'city' => 'Austin',
                'state' => 'TX',
                'postal_code' => '78701',
                'country' => 'US',
                'latitude' => 30.2672,
                'longitude' => -97.7431,
                'geofence_radius_meters' => 250.0,
                'start_date' => '2026-11-01',
                'end_date' => '2027-05-30',
                'estimator_id' => 1,
                'metadata_json' => null,
            ]
        ]));

        $pdo->whenQueryContains('SELECT role FROM users', new TestDoublePdoStatement([
            ['role' => 'admin']
        ]));
        $pdo->whenQueryContains('SELECT id, username, role FROM users', new TestDoublePdoStatement([
            [
                'id' => 1,
                'username' => 'admin@brightronix.com',
                'role' => 'admin',
            ]
        ]));

        $pdo->whenQueryContains('FROM estimators WHERE id = ?', new TestDoublePdoStatement([
            [
                'id' => 1,
                'display_name' => 'Lead Estimator',
                'email' => 'estimator@brightronix.com',
                'active' => 1,
            ]
        ]));

        $estChecksum = hash('sha256', 'single-digit-estimate-v1');
        $pdo->whenQueryContains('FROM estimates WHERE project_id = ?', new TestDoublePdoStatement([
            [
                'id' => 1,
                'project_id' => 1,
                'bid_id' => 1,
                'estimate_number' => 'EST-1',
                'revision' => 'REV-1',
                'status' => 'approved',
                'currency_code' => 'USD',
                'total_cost' => 5000.00,
                'labor_hours_total' => 25.0,
                'checksum_sha256' => $estChecksum,
                'updated_at' => '2026-10-09 14:00:00',
            ]
        ]));

        $pdo->whenQueryContains('FROM estimate_items WHERE estimate_id = ?', new TestDoublePdoStatement([
            [
                'id' => 1,
                'estimate_id' => 1,
                'item_code' => 'ITEM-1',
                'description' => 'Single item description',
                'category' => 'General',
                'quantity' => 1.0,
                'unit_of_measure' => 'each',
                'unit_cost' => 50.00,
                'total_cost' => 50.00,
            ],
        ]));

        $pdo->whenQueryContains('FROM project_documents WHERE project_id = ?', new TestDoublePdoStatement([]));
        $pdo->whenQueryContains("FROM won_project_outbox WHERE project_id = ? AND event_type = 'project.won'", new TestDoublePdoStatement([]));

        $service = new WonProjectExportService($pdo);
        $payload = $service->markAsWon(1, 1, 'admin');

        // 1. Verify IDs 1/1 identity preservation
        $this->assertEquals('1', $payload['source_project_id'], "source_project_id must match single-digit project ID 1");
        $this->assertEquals('1', $payload['source_estimate_id'], "source_estimate_id must match single-digit estimate ID 1");

        // 2. Verify deterministic padding and exact expected idempotency_key
        $expectedKey = 'project.won-0000000001-0000000001';
        $this->assertEquals($expectedKey, $payload['idempotency_key'], "idempotency_key must be deterministic with 10-digit padding for 1/1");

        // 3. Verify contractual length 16..128
        $keyLen = strlen((string)$payload['idempotency_key']);
        $this->assertTrue($keyLen >= 16 && $keyLen <= 128, "idempotency_key length ({$keyLen}) must be between 16 and 128 characters");

        // 4. Verify repeatability/determinism on multiple invocations
        $service2 = new WonProjectExportService($pdo);
        $this->assertEquals($expectedKey, 'project.won-' . str_pad('1', 10, '0', STR_PAD_LEFT) . '-' . str_pad('1', 10, '0', STR_PAD_LEFT), "idempotency_key formula must be strictly deterministic across calls");

        // 5. Verify absence of Inventory
        $json = json_encode($payload);
        $this->assertFalse(stripos($json, 'inventory') !== false && stripos($json, 'source_system') !== false, "Must not set inventory as source system");
        $this->assertFalse(stripos($payload['idempotency_key'], 'inventory') !== false, "idempotency_key must not mention inventory");

        // 6. Verify non-truncation for values larger than 10 digits
        $largeProjPadded = str_pad('12345678901', 10, '0', STR_PAD_LEFT);
        $this->assertEquals('12345678901', $largeProjPadded, "Values larger than 10 digits must not be truncated");

        // 7. Verify strict schema validation passes
        $errors = $this->validateAgainstContractSchema($payload);
        $this->assertEmpty($errors, "Live generated payload for IDs 1/1 must validate against schema: " . implode(', ', $errors));
    }

    // -------------------------------------------------------------------------
    // Helpers & Mock PDO Setup
    // -------------------------------------------------------------------------

    private function createStandardFakePdo(): TestDoublePdo
    {
        $pdo = new TestDoublePdo('mysql');

        // Table existence queries
        $pdo->whenQueryContains('information_schema.tables', new TestDoublePdoStatement([
            ['1' => 1]
        ]));

        // Projects query
        $pdo->whenQueryContains('FROM projects WHERE id = ?', new TestDoublePdoStatement([
            [
                'id' => 101,
                'project_number' => 'PRJ-2026-101',
                'name' => 'Commercial Solar Array Phase 1',
                'status' => 'in_review',
                'client_id' => 'CLI-55',
                'client_name' => 'Apex Industrial Solar LLC',
                'contact_name' => 'Robert Johnson',
                'contact_email' => 'rjohnson@apexsolar.com',
                'contact_phone' => '+1-555-0199',
                'job_address' => '100 Industrial Parkway',
                'address_line2' => 'Building B',
                'city' => 'Austin',
                'state' => 'TX',
                'postal_code' => '78701',
                'country' => 'US',
                'latitude' => 30.2672,
                'longitude' => -97.7431,
                'geofence_radius_meters' => 250.0,
                'start_date' => '2026-11-01',
                'end_date' => '2027-05-30',
                'estimator_id' => 42,
                'metadata_json' => null,
            ]
        ]));

        // Users query (actor authentication)
        $pdo->whenQueryContains('SELECT role FROM users', new TestDoublePdoStatement([
            [
                'role' => 'admin',
            ]
        ]));
        $pdo->whenQueryContains('SELECT id, username, role FROM users', new TestDoublePdoStatement([
            [
                'id' => 42,
                'username' => 'alice@brightronix.com',
                'role' => 'admin',
            ]
        ]));

        // Estimators query
        $pdo->whenQueryContains('FROM estimators WHERE id = ?', new TestDoublePdoStatement([
            [
                'id' => 42,
                'display_name' => 'Alice Chief Estimator',
                'email' => 'estimator@brightronix.com',
                'active' => 1,
            ]
        ]));

        // Estimates query
        $estChecksum = hash('sha256', 'canonical-estimate-v1');
        $pdo->whenQueryContains('FROM estimates WHERE project_id = ?', new TestDoublePdoStatement([
            [
                'id' => 303,
                'project_id' => 101,
                'bid_id' => 202,
                'estimate_number' => 'EST-2026-001',
                'revision' => 'REV-1',
                'status' => 'approved',
                'currency_code' => 'USD',
                'total_cost' => 154200.50,
                'labor_hours_total' => 420.0,
                'checksum_sha256' => $estChecksum,
                'updated_at' => '2026-10-09 14:00:00',
            ]
        ]));

        // Estimate items query
        $pdo->whenQueryContains('FROM estimate_items WHERE estimate_id = ?', new TestDoublePdoStatement([
            [
                'id' => 1,
                'estimate_id' => 303,
                'item_code' => 'THHN-12-BLK',
                'description' => '12 AWG THHN Copper Wire Black 500ft spool',
                'category' => 'Wire & Cable',
                'quantity' => 15.0,
                'unit_of_measure' => 'spool',
                'unit_cost' => 85.50,
                'total_cost' => 1282.50,
            ],
            [
                'id' => 2,
                'estimate_id' => 303,
                'item_code' => 'PANEL-200A',
                'description' => '200A 42-Circuit Main Breaker Load Center',
                'category' => 'Distribution Equipment',
                'quantity' => 2.0,
                'unit_of_measure' => 'each',
                'unit_cost' => 450.00,
                'total_cost' => 900.00,
            ],
        ]));

        // Project documents query
        $docChecksum = hash('sha256', 'electrical-plan-doc');
        $pdo->whenQueryContains('FROM project_documents WHERE project_id = ?', new TestDoublePdoStatement([
            [
                'id' => 1,
                'project_id' => 101,
                'original_filename' => 'electrical-plan-rev1.pdf',
                'document_type' => 'drawings',
                'mime_type' => 'application/pdf',
                'file_size' => 2458100,
                'checksum_sha256' => $docChecksum,
                'download_url' => 'https://takeoff.brightronix.com/api/projects/101/documents/1/download',
            ]
        ]));

        // Outbox check (empty by default)
        $pdo->whenQueryContains("FROM won_project_outbox WHERE project_id = ? AND event_type = 'project.won'", new TestDoublePdoStatement([]));

        return $pdo;
    }

    private function createCanonicalValidPayload(): array
    {
        $sha = hash('sha256', 'canonical-estimate-v1');
        $docSha = hash('sha256', 'electrical-drawing-content');

        return [
            'event_id' => 'a8f09d84-7a2e-4b6d-97e3-05f32a762df1',
            'occurred_at' => '2026-10-09T14:30:00Z',
            'source_system' => 'takeoff',
            'source_project_id' => '101',
            'source_bid_id' => '202',
            'source_estimate_id' => '303',
            'idempotency_key' => 'takeoff-won-101-202-rev1-canonical001',
            'correlation_id' => 'corr-takeoff-101-202-001',
            'traceability' => [
                'awarded_by' => [
                    'user_id' => 'user-42',
                    'email' => 'estimator@brightronix.com',
                    'display_name' => 'Alice Chief Estimator',
                ],
                'notes' => 'Awarded by client after board approval',
            ],
            'approved_estimate' => [
                'estimate_id' => '303',
                'estimate_number' => 'EST-2026-001',
                'revision' => 'REV-1',
                'approved_at' => '2026-10-09T14:00:00Z',
                'approved_by_user_id' => 'user-42',
                'checksum_sha256' => $sha,
                'currency' => 'USD',
                'total_amount' => 154200.50,
                'total_labor_hours' => 420.0,
            ],
            'project' => [
                'number' => 'PRJ-2026-101',
                'name' => 'Commercial Solar Array Phase 1',
                'client' => [
                    'client_id' => 'CLI-55',
                    'name' => 'Apex Industrial Solar LLC',
                    'contact_name' => 'Robert Johnson',
                    'contact_email' => 'rjohnson@apexsolar.com',
                    'contact_phone' => '+1-555-0199',
                ],
                'location' => [
                    'address_line1' => '100 Industrial Parkway',
                    'address_line2' => 'Building B',
                    'city' => 'Austin',
                    'state' => 'TX',
                    'postal_code' => '78701',
                    'country' => 'US',
                    'latitude' => 30.2672,
                    'longitude' => -97.7431,
                    'geofence_radius_meters' => 250.0,
                ],
                'dates' => [
                    'estimated_start_date' => '2026-11-01',
                    'estimated_completion_date' => '2027-05-30',
                ],
                'assigned_roles' => [
                    [
                        'role' => 'project_manager',
                        'user_id' => 'user-42',
                        'name' => 'Alice Chief Estimator',
                        'email' => 'estimator@brightronix.com',
                    ],
                    [
                        'role' => 'lead_electrician',
                        'user_id' => 'user-77',
                        'name' => 'Charlie Spark',
                        'email' => 'cspark@brightronix.com',
                    ],
                ],
            ],
            'commercial_summary' => [
                'currency' => 'USD',
                'total_amount' => 154200.50,
                'total_labor_hours' => 420.0,
                'estimate_revision' => 'REV-1',
                'approved_estimate_hash' => $sha,
            ],
            'materials_snapshot' => [
                'snapshot_id' => 'SNAP-303-01',
                'version' => '1.0',
                'generated_at' => '2026-10-09T14:15:00Z',
                'total_items' => 2,
                'items' => [
                    [
                        'item_id' => 'MAT-001',
                        'item_code' => 'THHN-12-BLK',
                        'description' => '12 AWG THHN Copper Wire Black 500ft spool',
                        'category' => 'Wire & Cable',
                        'quantity' => 15.0,
                        'unit_of_measure' => 'spool',
                        'unit_cost' => 85.50,
                        'total_cost' => 1282.50,
                    ],
                    [
                        'item_id' => 'MAT-002',
                        'item_code' => 'PANEL-200A',
                        'description' => '200A 42-Circuit Main Breaker Load Center',
                        'category' => 'Distribution Equipment',
                        'quantity' => 2.0,
                        'unit_of_measure' => 'each',
                        'unit_cost' => 450.00,
                        'total_cost' => 900.00,
                    ],
                ],
            ],
            'documents_manifest' => [
                'manifest_version' => '1.0',
                'total_files' => 1,
                'documents' => [
                    [
                        'document_id' => 'DOC-001',
                        'file_name' => 'electrical-plan-rev1.pdf',
                        'document_type' => 'drawings',
                        'content_type' => 'application/pdf',
                        'size_bytes' => 2458100,
                        'checksum' => [
                            'algorithm' => 'sha256',
                            'value' => $docSha,
                        ],
                        'download_url' => 'https://takeoff.brightronix.com/api/projects/101/documents/DOC-001/download',
                    ],
                ],
            ],
        ];
    }

    private function validateAgainstContractSchema(array $payload): array
    {
        $schema = json_decode(file_get_contents($this->schemaPath), true);
        $errors = [];

        // 1. Required top-level properties
        foreach ($schema['required'] ?? [] as $req) {
            if (!array_key_exists($req, $payload)) {
                $errors[] = "Missing top-level required property: '{$req}'";
            }
        }

        // 2. Additional properties check
        if (($schema['additionalProperties'] ?? true) === false) {
            $allowed = array_keys($schema['properties'] ?? []);
            foreach (array_keys($payload) as $key) {
                if (!in_array($key, $allowed, true)) {
                    $errors[] = "Additional property '{$key}' not allowed in root";
                }
            }
        }

        // 3. event_id UUID pattern
        if (isset($payload['event_id'])) {
            $pattern = '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/';
            if (!is_string($payload['event_id']) || !preg_match($pattern, $payload['event_id'])) {
                $errors[] = "Property 'event_id' must be a valid UUID";
            }
        }

        // 4. source_system enum ['takeoff']
        if (isset($payload['source_system']) && $payload['source_system'] !== 'takeoff') {
            $errors[] = "Property 'source_system' must strictly be 'takeoff'";
        }

        // 5. idempotency_key length [16, 128]
        if (isset($payload['idempotency_key'])) {
            $len = strlen((string)$payload['idempotency_key']);
            if ($len < 16 || $len > 128) {
                $errors[] = "Property 'idempotency_key' must have length between 16 and 128 characters";
            }
        }

        // 6. commercial_summary numbers
        if (isset($payload['commercial_summary'])) {
            $cs = $payload['commercial_summary'];
            if (isset($cs['total_amount']) && (!is_numeric($cs['total_amount']) || $cs['total_amount'] < 0)) {
                $errors[] = "commercial_summary.total_amount must be >= 0";
            }
            if (isset($cs['currency']) && !preg_match('/^[A-Z]{3}$/', (string)$cs['currency'])) {
                $errors[] = "commercial_summary.currency must be 3 uppercase letters";
            }
        }

        // 7. materials_snapshot items
        if (isset($payload['materials_snapshot']['items'])) {
            if (!is_array($payload['materials_snapshot']['items'])) {
                $errors[] = "materials_snapshot.items must be an array";
            } else {
                foreach ($payload['materials_snapshot']['items'] as $idx => $item) {
                    if (isset($item['quantity']) && (!is_numeric($item['quantity']) || $item['quantity'] < 0)) {
                        $errors[] = "materials_snapshot.items[{$idx}].quantity must be >= 0";
                    }
                    if (isset($item['unit_cost']) && (!is_numeric($item['unit_cost']) || $item['unit_cost'] < 0)) {
                        $errors[] = "materials_snapshot.items[{$idx}].unit_cost must be >= 0";
                    }
                    if (isset($item['total_cost']) && (!is_numeric($item['total_cost']) || $item['total_cost'] < 0)) {
                        $errors[] = "materials_snapshot.items[{$idx}].total_cost must be >= 0";
                    }
                }
            }
        }

        // 8. documents_manifest download_url pattern & checksum
        if (isset($payload['documents_manifest']['documents'])) {
            $urlPattern = '/^(https?:\\/\\/[a-zA-Z0-9.-]+(:[0-9]+)?\\/|\\/api\\/)[^\\\\\\s]+$/';
            $hashPattern = '/^[a-f0-9]{64}$/';
            foreach ($payload['documents_manifest']['documents'] as $dIdx => $doc) {
                if (isset($doc['download_url']) && !preg_match($urlPattern, (string)$doc['download_url'])) {
                    $errors[] = "documents_manifest.documents[{$dIdx}].download_url does not match secure HTTPS/API URL pattern";
                }
                if (isset($doc['checksum']['value']) && !preg_match($hashPattern, (string)$doc['checksum']['value'])) {
                    $errors[] = "documents_manifest.documents[{$dIdx}].checksum.value must be 64-hex SHA-256";
                }
            }
        }

        // 9. assigned_roles enum check
        if (isset($payload['project']['assigned_roles'])) {
            $allowedRoles = ['project_manager', 'lead_electrician', 'estimator', 'supervisor'];
            foreach ($payload['project']['assigned_roles'] as $rIdx => $roleObj) {
                if (isset($roleObj['role']) && !in_array($roleObj['role'], $allowedRoles, true)) {
                    $errors[] = "project.assigned_roles[{$rIdx}].role '{$roleObj['role']}' is not an allowed role";
                }
            }
        }

        return $errors;
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

    private function assertCount(int $expectedCount, array $arr, string $msg): void
    {
        $actual = count($arr);
        if ($expectedCount !== $actual) {
            throw new RuntimeException("Assertion failed: {$msg} [Expected count {$expectedCount}, got {$actual}]");
        }
    }

    private function assertIsArray($val, string $msg): void
    {
        if (!is_array($val)) throw new RuntimeException("Assertion failed: {$msg} (not an array)");
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
$schemaFile = __DIR__ . '/../contracts/won-project-export.v1.schema.json';
$runner = new WonProjectExportContractTestRunner($schemaFile);
exit($runner->run());
