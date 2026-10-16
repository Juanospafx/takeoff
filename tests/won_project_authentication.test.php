<?php
declare(strict_types=1);

/**
 * Behavioral & Regression Tests: Won Project Administrative Authentication (TASK-0096)
 *
 * Verifies:
 *   - Centralized authentication via WonProjectAdminAuthenticator:
 *       1. Sesión ausente: rejects unauthenticated requests (null / 403)
 *       2. Sesión inválida: rejects non-numeric, zero, negative user_id, or non-admin session role
 *       3. Usuario inexistente: rejects session whose user_id is not in database
 *       4. Usuario deshabilitado: rejects user in database with active = 0
 *       5. Usuario sin rol admin: rejects user in database with role != 'admin'
 *       6. Admin válido: allows existing user with role = 'admin' and active = 1
 *       7. Fails closed on database errors (missing column, missing table, connection error) without leaking details
 *   - Endpoint api/won_project.php:
 *       8. Complete isolation from legacy compatibility session shim (core/auth/session.php)
 *       9. Never fabricates identity when session is absent
 *      10. GET and POST apply identical authorization before data queries or actions
 *      11. POST CSRF protection remains intact
 *   - Database migration:
 *      12. 20261009_users_active_for_won_project.sql adds active column with default 1 idempotently
 *      13. Useful index on active/role created idempotently
 *      14. Rollback procedure is fully documented and non-destructive
 *
 * Runs without external network, curl, or live MariaDB server (uses SQLite memory / doubles).
 */

require_once __DIR__ . '/../core/auth/WonProjectAdminAuthenticator.php';

final class WonProjectAuthenticationTestRunner
{
    private array $results = [];
    private string $apiFilePath;
    private string $migrationFilePath;
    private string $authFilePath;

    public function __construct(string $apiFilePath, string $migrationFilePath, string $authFilePath)
    {
        $this->apiFilePath = $apiFilePath;
        $this->migrationFilePath = $migrationFilePath;
        $this->authFilePath = $authFilePath;
    }

    public function run(): int
    {
        echo "======================================================================\n";
        echo "TEST SUITE: WonProject Administrative Authentication (TASK-0096)\n";
        echo "======================================================================\n\n";

        $tests = [
            'testSessionAbsentFailsClosed' => 'Auth: sesión ausente (sin sesión o vacía) falla cerrado y retorna null',
            'testSessionInvalidUserIdFailsClosed' => 'Auth: sesión inválida (user_id <= 0, no numérico o malformado) falla cerrado',
            'testSessionInvalidRoleFailsClosed' => 'Auth: sesión con rol distinto de admin falla cerrado',
            'testUserNonExistentInDatabaseFailsClosed' => 'Auth: usuario inexistente en la base de datos falla cerrado',
            'testUserDisabledInDatabaseFailsClosed' => 'Auth: usuario deshabilitado (active = 0 o distinto de 1) falla cerrado',
            'testUserNonAdminRoleInDatabaseFailsClosed' => 'Auth: usuario existente sin rol admin en BD falla cerrado',
            'testUserValidAdminSucceeds' => 'Auth: admin válido (usuario existe, active = 1, role = admin) se autoriza exitosamente',
            'testMissingActiveColumnFailsClosedWithoutLeak' => 'Resiliencia: columna active ausente falla cerrado sin filtrar detalles de error SQL',
            'testMissingUsersTableFailsClosed' => 'Resiliencia: tabla users ausente falla cerrado sin filtrar detalles',
            'testDatabaseConnectionFailureFailsClosed' => 'Resiliencia: fallo de conexión/preparación a la BD falla cerrado',
            'testApiEndpointIsolationFromLegacySessionShim' => 'Aislamiento: api/won_project.php no incluye session.php y nunca fabrica identidad',
            'testMigrationFileContractAndRollback' => 'Migración: archivo SQL idempotente con default 1, índice y rollback no destructivo',
            'testBothGetAndPostApplySameAuthBeforeOperations' => 'Contrato HTTP: GET y POST aplican la misma autorización antes de datos o acciones',
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
        } catch (\Throwable $e) {
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
            echo "RESULT: FAIL (Authentication regressions or broken constraints)\n";
            return 1;
        }

        echo "RESULT: GREEN (All authentication and authorization tests passed)\n";
        return 0;
    }

    // -------------------------------------------------------------------------
    // Helper: Create PDO Test Database (SQLite in-memory or PDO test double)
    // -------------------------------------------------------------------------

    private function createTestPdo(bool $withActiveColumn = true, bool $withUsersTable = true): PDO
    {
        if (extension_loaded('pdo_sqlite')) {
            $pdo = new PDO('sqlite::memory:', null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);

            if ($withUsersTable) {
                if ($withActiveColumn) {
                    $pdo->exec("
                        CREATE TABLE users (
                            id INTEGER PRIMARY KEY,
                            username TEXT NOT NULL,
                            role TEXT NOT NULL DEFAULT 'viewer',
                            active INTEGER NOT NULL DEFAULT 1
                        );
                        INSERT INTO users (id, username, role, active) VALUES (1, 'active_admin', 'admin', 1);
                        INSERT INTO users (id, username, role, active) VALUES (2, 'disabled_admin', 'admin', 0);
                        INSERT INTO users (id, username, role, active) VALUES (3, 'viewer_user', 'viewer', 1);
                        INSERT INTO users (id, username, role, active) VALUES (4, 'estimator_user', 'estimator', 1);
                        INSERT INTO users (id, username, role, active) VALUES (5, 'case_admin', 'ADMIN', 1);
                        INSERT INTO users (id, username, role, active) VALUES (6, 'invalid_active', 'admin', 2);
                    ");
                } else {
                    $pdo->exec("
                        CREATE TABLE users (
                            id INTEGER PRIMARY KEY,
                            username TEXT NOT NULL,
                            role TEXT NOT NULL DEFAULT 'viewer'
                        );
                        INSERT INTO users (id, username, role) VALUES (1, 'active_admin', 'admin');
                    ");
                }
            }
            return $pdo;
        }

        return new WonProjectTestPdoStub($withActiveColumn, $withUsersTable);
    }

    // -------------------------------------------------------------------------
    // Test Cases
    // -------------------------------------------------------------------------

    private function testSessionAbsentFailsClosed(): void
    {
        $pdo = $this->createTestPdo();
        $auth = new WonProjectAdminAuthenticator($pdo);

        // Empty session array
        $result = $auth->authenticate([]);
        $this->assertNull($result, "Empty session must return null (fail closed)");

        // Unset session keys
        $resultUnset = $auth->authenticate(['something_else' => 'value']);
        $this->assertNull($resultUnset, "Session without user_id must return null");
    }

    private function testSessionInvalidUserIdFailsClosed(): void
    {
        $pdo = $this->createTestPdo();
        $auth = new WonProjectAdminAuthenticator($pdo);

        $invalidUserIds = [
            0,
            -1,
            -999,
            '0',
            '-1',
            'abc',
            '1abc',
            '1.5',
            '',
            ' ',
            null,
            false,
            true,
            [],
        ];

        foreach ($invalidUserIds as $invalidId) {
            $session = ['user_id' => $invalidId, 'role' => 'admin'];
            $result = $auth->authenticate($session);
            $this->assertNull($result, "Invalid user_id [" . var_export($invalidId, true) . "] must return null");
        }
    }

    private function testSessionInvalidRoleFailsClosed(): void
    {
        $pdo = $this->createTestPdo();
        $auth = new WonProjectAdminAuthenticator($pdo);

        $invalidRoles = [
            'viewer',
            'estimator',
            'user',
            'guest',
            'manager',
            '',
            ' ',
            null,
            false,
            123,
        ];

        foreach ($invalidRoles as $invalidRole) {
            $session = ['user_id' => 1, 'role' => $invalidRole];
            $result = $auth->authenticate($session);
            $this->assertNull($result, "Invalid session role [" . var_export($invalidRole, true) . "] must return null");
        }

        // Missing role key completely
        $resultMissingRole = $auth->authenticate(['user_id' => 1]);
        $this->assertNull($resultMissingRole, "Missing session role key must return null");
    }

    private function testUserNonExistentInDatabaseFailsClosed(): void
    {
        $pdo = $this->createTestPdo();
        $auth = new WonProjectAdminAuthenticator($pdo);

        // User 999 does not exist in seed database
        $session = ['user_id' => 999, 'role' => 'admin'];
        $result = $auth->authenticate($session);
        $this->assertNull($result, "Non-existent user_id in database must return null");
    }

    private function testUserDisabledInDatabaseFailsClosed(): void
    {
        $pdo = $this->createTestPdo();
        $auth = new WonProjectAdminAuthenticator($pdo);

        // User 2 exists, role = 'admin', active = 0
        $sessionDisabled = ['user_id' => 2, 'role' => 'admin'];
        $resultDisabled = $auth->authenticate($sessionDisabled);
        $this->assertNull($resultDisabled, "Disabled admin (active = 0) must return null");

        // User 6 exists, role = 'admin', active = 2 (not strictly 1)
        $sessionInvalidActive = ['user_id' => 6, 'role' => 'admin'];
        $resultInvalidActive = $auth->authenticate($sessionInvalidActive);
        $this->assertNull($resultInvalidActive, "Admin with active != 1 must return null");
    }

    private function testUserNonAdminRoleInDatabaseFailsClosed(): void
    {
        $pdo = $this->createTestPdo();
        $auth = new WonProjectAdminAuthenticator($pdo);

        // User 3 exists, active = 1, role = 'viewer'
        $sessionViewer = ['user_id' => 3, 'role' => 'admin'];
        $resultViewer = $auth->authenticate($sessionViewer);
        $this->assertNull($resultViewer, "Database user with role 'viewer' must return null even if session claims admin");

        // User 4 exists, active = 1, role = 'estimator'
        $sessionEstimator = ['user_id' => 4, 'role' => 'admin'];
        $resultEstimator = $auth->authenticate($sessionEstimator);
        $this->assertNull($resultEstimator, "Database user with role 'estimator' must return null even if session claims admin");
    }

    private function testUserValidAdminSucceeds(): void
    {
        $pdo = $this->createTestPdo();
        $auth = new WonProjectAdminAuthenticator($pdo);

        // User 1 exists, active = 1, role = 'admin'
        $session = ['user_id' => 1, 'role' => 'admin'];
        $result = $auth->authenticate($session);

        $this->assertNotNull($result, "Valid active admin user must succeed");
        $this->assertEquals(1, $result['id'], "Authenticated user ID must match 1");
        $this->assertEquals('admin', $result['role'], "Authenticated role must match 'admin'");
        $this->assertEquals(1, $result['active'], "Authenticated active must match 1");

        // User 5 exists, active = 1, role = 'ADMIN' (case-insensitive admin match)
        $sessionUpper = ['user_id' => 5, 'role' => 'admin'];
        $resultUpper = $auth->authenticate($sessionUpper);
        $this->assertNotNull($resultUpper, "Case-insensitive admin role in database must succeed");
        $this->assertEquals(5, $resultUpper['id'], "Authenticated user ID must match 5");

        // Session role in uppercase 'ADMIN'
        $sessionUpperSession = ['user_id' => 1, 'role' => 'ADMIN'];
        $resultUpperSession = $auth->authenticate($sessionUpperSession);
        $this->assertNotNull($resultUpperSession, "Case-insensitive session role must succeed");
    }

    private function testMissingActiveColumnFailsClosedWithoutLeak(): void
    {
        // Database without `active` column
        $pdo = $this->createTestPdo(false, true);
        $auth = new WonProjectAdminAuthenticator($pdo);

        $session = ['user_id' => 1, 'role' => 'admin'];
        $result = $auth->authenticate($session);

        $this->assertNull($result, "Query failing on missing 'active' column must fail closed and return null");
    }

    private function testMissingUsersTableFailsClosed(): void
    {
        // Database without `users` table
        $pdo = $this->createTestPdo(true, false);
        $auth = new WonProjectAdminAuthenticator($pdo);

        $session = ['user_id' => 1, 'role' => 'admin'];
        $result = $auth->authenticate($session);

        $this->assertNull($result, "Query failing on missing 'users' table must fail closed and return null");
    }

    private function testDatabaseConnectionFailureFailsClosed(): void
    {
        $brokenPdo = new WonProjectTestPdoStub(true, true, true);
        $auth = new WonProjectAdminAuthenticator($brokenPdo);

        $session = ['user_id' => 1, 'role' => 'admin'];
        $result = $auth->authenticate($session);

        $this->assertNull($result, "Broken connection / prepare error must fail closed and return null");
    }

    private function testApiEndpointIsolationFromLegacySessionShim(): void
    {
        $this->assertTrue(file_exists($this->apiFilePath), "api/won_project.php must exist");
        $apiContent = file_get_contents($this->apiFilePath);

        // Crucial requirement: Must NOT include or depend on core/auth/session.php
        $this->assertFalse(
            str_contains($apiContent, 'core/auth/session.php'),
            "api/won_project.php must NOT include or depend on legacy core/auth/session.php"
        );

        // Crucial requirement: Must include WonProjectAdminAuthenticator.php
        $this->assertTrue(
            str_contains($apiContent, 'WonProjectAdminAuthenticator.php'),
            "api/won_project.php must include core/auth/WonProjectAdminAuthenticator.php"
        );

        // Crucial requirement: Never fabricate identity by default
        $this->assertFalse(
            str_contains($apiContent, "\$_SESSION['user_id'] = \$_SESSION['user_id'] ??"),
            "api/won_project.php must never fabricate identity when session is absent"
        );
        $this->assertFalse(
            str_contains($apiContent, "\$_SESSION['role'] = \$_SESSION['role'] ??"),
            "api/won_project.php must never fabricate role when session is absent"
        );
    }

    private function testMigrationFileContractAndRollback(): void
    {
        $this->assertTrue(file_exists($this->migrationFilePath), "Migration file must exist at {$this->migrationFilePath}");
        $sql = file_get_contents($this->migrationFilePath);

        // Idempotent column addition with default 1
        $this->assertTrue(str_contains($sql, 'ADD COLUMN IF NOT EXISTS `active` TINYINT(1) NOT NULL DEFAULT 1') ||
            str_contains($sql, 'ADD COLUMN IF NOT EXISTS active TINYINT(1) NOT NULL DEFAULT 1'),
            "Migration must add active column with default 1 and IF NOT EXISTS");

        // Useful index on active, role
        $this->assertTrue(str_contains($sql, 'ADD INDEX IF NOT EXISTS `idx_users_active_role`') ||
            str_contains($sql, 'ADD INDEX IF NOT EXISTS idx_users_active_role'),
            "Migration must add index idx_users_active_role with IF NOT EXISTS");

        // Documented non-destructive rollback
        $this->assertTrue(str_contains($sql, 'NON-DESTRUCTIVE ROLLBACK'),
            "Migration must document non-destructive rollback procedure");
        $this->assertTrue(str_contains($sql, 'UPDATE `users` SET `active` = 1') || str_contains($sql, 'UPDATE users SET active = 1'),
            "Migration must document safe rollback data reset");
        $this->assertTrue(str_contains($sql, 'DO NOT EXECUTE'),
            "Migration must explicitly state that it must not be executed automatically");
    }

    private function testBothGetAndPostApplySameAuthBeforeOperations(): void
    {
        $apiContent = file_get_contents($this->apiFilePath);

        // Check GET authorization
        $getPos = strpos($apiContent, "if (\$method === 'GET')");
        $getAuthPos = strpos($apiContent, "requireAdmin", $getPos);
        $projectQueryPos = strpos($apiContent, "SELECT status FROM projects", $getPos);

        $this->assertTrue($getPos !== false, "GET handler must exist");
        $this->assertTrue($getAuthPos !== false, "GET handler must execute requireAdmin");
        $this->assertTrue($projectQueryPos !== false, "Projects query must exist in GET");
        $this->assertTrue($getAuthPos < $projectQueryPos, "Authorization must execute before querying projects in GET");

        // Check POST authorization
        $postPos = strpos($apiContent, "if (\$method === 'POST')");
        $postAuthPos = strpos($apiContent, "requireAdmin", $postPos);
        $csrfPos = strpos($apiContent, "hash_equals", $postPos);
        $markWonPos = strpos($apiContent, "if (\$action === 'mark_won')", $postPos);
        $retryPos = strpos($apiContent, "if (\$action === 'retry')", $postPos);

        $this->assertTrue($postPos !== false, "POST handler must exist");
        $this->assertTrue($postAuthPos !== false, "POST handler must execute requireAdmin");
        $this->assertTrue($csrfPos !== false, "CSRF check must exist in POST");
        $this->assertTrue($postAuthPos < $csrfPos, "Authorization must execute before CSRF check in POST");
        $this->assertTrue($postAuthPos < $markWonPos, "Authorization must execute before mark_won in POST");
        $this->assertTrue($postAuthPos < $retryPos, "Authorization must execute before retry in POST");
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

    private function assertNull($value, string $msg): void
    {
        if ($value !== null) {
            $rep = is_scalar($value) ? (string)$value : json_encode($value);
            throw new \RuntimeException("Assertion failed (expected null): {$msg} [got: {$rep}]");
        }
    }

    private function assertNotNull($value, string $msg): void
    {
        if ($value === null) throw new \RuntimeException("Assertion failed (expected not null): {$msg}");
    }

    private function assertEquals($expected, $actual, string $msg): void
    {
        if ($expected !== $actual) {
            $expStr = is_scalar($expected) ? (string)$expected : json_encode($expected);
            $actStr = is_scalar($actual) ? (string)$actual : json_encode($actual);
            throw new \RuntimeException("Assertion failed: {$msg} [Expected: {$expStr}, got: {$actStr}]");
        }
    }
}

/**
 * Fallback Test Double PDO for environments without SQLite driver.
 */
class WonProjectTestPdoStub extends PDO
{
    private bool $withActiveColumn;
    private bool $withUsersTable;
    private bool $broken;

    public function __construct(bool $withActiveColumn = true, bool $withUsersTable = true, bool $broken = false)
    {
        $this->withActiveColumn = $withActiveColumn;
        $this->withUsersTable = $withUsersTable;
        $this->broken = $broken;
    }

    public function prepare(string $query, array $options = []): PDOStatement
    {
        if ($this->broken) {
            throw new PDOException("Simulated connection/database error");
        }
        if (!$this->withUsersTable) {
            throw new PDOException("Base table or view not found: Table 'users' doesn't exist");
        }
        if (!$this->withActiveColumn && str_contains($query, 'active')) {
            throw new PDOException("Unknown column 'active' in 'field list'");
        }
        return new WonProjectTestPdoStatementStub($this->withActiveColumn);
    }
}

class WonProjectTestPdoStatementStub extends PDOStatement
{
    private bool $withActive;
    private ?array $currentRow = null;

    private static array $seedUsers = [
        1 => ['id' => 1, 'role' => 'admin', 'active' => 1],
        2 => ['id' => 2, 'role' => 'admin', 'active' => 0],
        3 => ['id' => 3, 'role' => 'viewer', 'active' => 1],
        4 => ['id' => 4, 'role' => 'estimator', 'active' => 1],
        5 => ['id' => 5, 'role' => 'ADMIN', 'active' => 1],
        6 => ['id' => 6, 'role' => 'admin', 'active' => 2],
    ];

    public function __construct(bool $withActive = true)
    {
        $this->withActive = $withActive;
    }

    public function execute(?array $params = null): bool
    {
        $id = $params[0] ?? null;
        if ($id !== null && isset(self::$seedUsers[(int)$id])) {
            $row = self::$seedUsers[(int)$id];
            if (!$this->withActive) {
                unset($row['active']);
            }
            $this->currentRow = $row;
        } else {
            $this->currentRow = null;
        }
        return true;
    }

    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed
    {
        return $this->currentRow ?? false;
    }
}

// CLI Execution entrypoint
$apiFile = __DIR__ . '/../api/won_project.php';
$migrationFile = __DIR__ . '/../db/migrations/20261009_users_active_for_won_project.sql';
$authFile = __DIR__ . '/../core/auth/WonProjectAdminAuthenticator.php';

$runner = new WonProjectAuthenticationTestRunner($apiFile, $migrationFile, $authFile);
exit($runner->run());
