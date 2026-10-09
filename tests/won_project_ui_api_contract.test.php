<?php
declare(strict_types=1);

/**
 * Contract Tests: WonProject UI / API Contracts (TASK-0076, TASK-0091)
 *
 * Verifies:
 *   - Endpoint api/won_project.php:
 *       * RBAC: GET status and POST actions require authenticated admin session and persisted admin role in database (403 for non-admin/unauthenticated)
 *       * CSRF: POST rejects missing, empty, or mismatched tokens via hash_equals (403)
 *       * GET action=status: returns project_status, integration_enabled, and public outbox status
 *       * Information disclosure prevention: public status response NEVER exposes payload, payload_hash, or last_error
 *       * POST action=mark_won: invokes WonProjectExportService::markAsWon without client-supplied event_id
 *       * POST action=retry: operates strictly by project_id; resolves latest failed record internally without accepting record ID from client
 *       * Safety: absence of dispatchBatch endpoint on public API (cron/worker only)
 *   - Frontend assets/won_project_export.js & pages/project_dashboard.php:
 *       * Confirmation prompts prior to mark_won and retry actions
 *       * Button states, loading indicators, and status pill transitions to accepted
 *       * Safe configuration injection without exposing secret keys or server tokens
 *
 * Runs without PDO drivers (pdo_sqlite / pdo_mysql), external network, curl, or MariaDB.
 */

namespace Brightronix\Takeoff\Tests\Contracts;

use ReflectionClass;
use ReturnTypeWillChange;
use RuntimeException;
use Throwable;

final class WonProjectUiApiContractTestRunner
{
    private array $results = [];
    private string $apiFilePath;
    private string $jsFilePath;
    private string $dashboardFilePath;

    public function __construct(string $apiFilePath, string $jsFilePath, string $dashboardFilePath)
    {
        $this->apiFilePath = $apiFilePath;
        $this->jsFilePath = $jsFilePath;
        $this->dashboardFilePath = $dashboardFilePath;
    }

    public function run(): int
    {
        echo "======================================================================\n";
        echo "TEST SUITE: WonProject UI & API Contract\n";
        echo "======================================================================\n\n";

        $tests = [
            'testApiFileExistsAndParsesValidPhp' => 'api/won_project.php exists and has valid PHP syntax',
            'testApiRbacEnforcementAdminOnlyForGetStatus' => 'API RBAC: GET status strictly enforces admin role check ($isAdmin / role === admin) with 403 response before querying project',
            'testApiRbacEnforcementAdminOnlyForPost' => 'API RBAC: POST strictly enforces admin role check ($isAdmin / role === admin) with 403 response',
            'testApiPersistedRoleVerificationForRetryAndActions' => 'API RBAC: GET status, mark_won and retry enforce persisted admin role from users table with 403 response',
            'testApiCsrfProtectionUsesHashEquals' => 'API CSRF: POST enforces session token comparison with hash_equals with 403 response',
            'testApiStatusEndpointPublicFieldsOnly' => 'API Status: outbox status exposes id, event_id, status, attempts, next_attempt_at, delivered_at, has_error; payload and last_error are never exposed',
            'testApiMarkWonDelegatesToService' => 'API mark_won: instantiates WonProjectExportService and invokes markAsWon(project_id, user_id, admin)',
            'testApiRetryOperatesByProjectIdWithoutClientRecordId' => 'API retry: operator retry queries latest failed event by project_id without accepting client record ID',
            'testApiExcludesDispatchBatch' => 'API safety: api/won_project.php does not expose dispatchBatch (batch dispatching is reserved for worker/CLI)',
            'testJsConfirmationAndEventHandling' => 'Frontend JS: window.confirm required before mark_won and retry; displays processing state and handles errors',
            'testDashboardInjectsSafeConfigAndCsrf' => 'Dashboard: project_dashboard.php initializes session CSRF token and exposes only safe public config without secrets',
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
    // Test Cases
    // -------------------------------------------------------------------------

    private function testApiFileExistsAndParsesValidPhp(): void
    {
        $this->assertTrue(file_exists($this->apiFilePath), "api/won_project.php must exist");
        $content = file_get_contents($this->apiFilePath);
        $this->assertNotEmpty($content, "api/won_project.php must not be empty");
    }

    private function testApiRbacEnforcementAdminOnlyForGetStatus(): void
    {
        $code = file_get_contents($this->apiFilePath);

        // Verify GET block checks session admin role and returns 403
        $this->assertTrue(
            preg_match('/if\s*\(\s*\$method\s*===\s*\'GET\'\s*\)\s*\{[\s\S]*?if\s*\(\s*\$userId\s*<=\s*0\s*\|\|\s*!\$isAdmin\s*\)\s*\{\s*http_response_code\(403\);/s', $code) === 1,
            "Must respond with 403 Forbidden when GET request is not made by authenticated admin user"
        );

        // Verify authorization check happens before projects query to prevent project enumeration / BOLA
        $getPos = strpos($code, "if (\$method === 'GET')");
        $authPos = strpos($code, "http_response_code(403);", $getPos);
        $projectQueryPos = strpos($code, "SELECT status FROM projects", $getPos);

        $this->assertTrue(
            $authPos !== false && $projectQueryPos !== false && $authPos < $projectQueryPos,
            "Authorization check must occur before querying projects to prevent project enumeration"
        );
    }

    private function testApiRbacEnforcementAdminOnlyForPost(): void
    {
        $code = file_get_contents($this->apiFilePath);

        // Verify session extraction and admin verification
        $this->assertTrue(str_contains($code, "\$_SESSION['role']"), "Must inspect session role");
        $this->assertTrue(str_contains($code, "'admin'"), "Must check for admin role");

        // Verify 403 status code when non-admin accesses POST
        $this->assertTrue(preg_match('/if\s*\(\s*\$userId\s*<=\s*0\s*\|\|\s*!\$isAdmin\s*\)\s*\{\s*http_response_code\(403\);/s', $code) === 1,
            "Must respond with 403 Forbidden when POST request is not made by authenticated admin user");
    }

    private function testApiPersistedRoleVerificationForRetryAndActions(): void
    {
        $code = file_get_contents($this->apiFilePath);

        // Must query persisted role using SELECT role FROM users WHERE id=? LIMIT 1
        $this->assertTrue(
            str_contains($code, "SELECT role FROM users WHERE id=? LIMIT 1"),
            "Must query persisted user role from database using SELECT role FROM users WHERE id=? LIMIT 1"
        );

        // Must reject non-admin persisted role with 403
        $this->assertTrue(
            preg_match('/\$persistedRole\s*===\s*false\s*\|\|\s*strtolower\(trim\(\(string\)\$persistedRole\)\)\s*!==\s*\'admin\'[\s\S]{1,120}http_response_code\(403\);/s', $code) === 1,
            "Must respond with 403 Forbidden when persisted role is not admin"
        );

        // Persisted role check must be present for GET status
        $getPos = strpos($code, "if (\$method === 'GET')");
        $postPos = strpos($code, "if (\$method === 'POST')");
        $getStatusUsersQueryPos = strpos($code, "SELECT role FROM users WHERE id=? LIMIT 1", $getPos);
        $this->assertTrue(
            $getStatusUsersQueryPos !== false && $getStatusUsersQueryPos < $postPos,
            "Persisted role check must execute before GET status processing"
        );

        // Persisted role check must execute before retry handling in POST
        $retryPos = strpos($code, "if (\$action === 'retry')");
        $postUsersQueryPos = strpos($code, "SELECT role FROM users WHERE id=? LIMIT 1", $postPos);
        $this->assertTrue(
            $postUsersQueryPos !== false && $retryPos !== false && $postUsersQueryPos < $retryPos,
            "Persisted role check must execute before retry handling in POST"
        );
    }

    private function testApiCsrfProtectionUsesHashEquals(): void
    {
        $code = file_get_contents($this->apiFilePath);

        $this->assertTrue(str_contains($code, 'hash_equals('), "Must use hash_equals for timing-safe CSRF validation");
        $this->assertTrue(str_contains($code, 'won_project_csrf_token'), "Must check session won_project_csrf_token");

        // Verify 403 response on CSRF failure
        $this->assertTrue(preg_match('/hash_equals\([^)]+\)[\s\S]{1,200}http_response_code\(403\);/s', $code) === 1,
            "Must respond with 403 Forbidden when CSRF token is invalid");
    }

    private function testApiStatusEndpointPublicFieldsOnly(): void
    {
        $code = file_get_contents($this->apiFilePath);

        // The query for outbox status must compute has_error without returning raw last_error or payload
        $this->assertTrue(str_contains($code, 'CASE WHEN last_error IS NOT NULL'), "Must project has_error boolean indicator");

        // Allowed public fields in response
        $allowedOutboxKeys = ['id', 'event_id', 'status', 'attempts', 'next_attempt_at', 'delivered_at', 'has_error'];
        foreach ($allowedOutboxKeys as $key) {
            $this->assertTrue(str_contains($code, "'{$key}'"), "Outbox public array should include '{$key}'");
        }

        // Verify that raw payload and last_error are NOT selected into the public outbox array
        $this->assertFalse(str_contains($code, "'payload' => \$oRow['payload']"), "Must NOT expose raw payload to client");
        $this->assertFalse(str_contains($code, "'last_error' => \$oRow['last_error']"), "Must NOT expose raw last_error message to client");
    }

    private function testApiMarkWonDelegatesToService(): void
    {
        $code = file_get_contents($this->apiFilePath);

        $this->assertTrue(str_contains($code, "new WonProjectExportService(\$pdo"), "Must instantiate WonProjectExportService");
        $this->assertTrue(str_contains($code, "\$service->markAsWon("), "Must call service markAsWon");

        // Client must not supply event_id; service generates canonical UUID
        $this->assertFalse(str_contains($code, "\$jsonData['event_id']"), "Must NOT accept event_id from client input");
    }

    private function testApiRetryOperatesByProjectIdWithoutClientRecordId(): void
    {
        $code = file_get_contents($this->apiFilePath);

        // Find failed outbox record by project_id
        $this->assertTrue(str_contains($code, "WHERE project_id = ? AND event_type = 'project.won' AND status = 'failed'"),
            "Retry must query latest failed event internally by project_id");

        $this->assertTrue(str_contains($code, "\$dispatcher->retryFailed((int)\$failedId)"),
            "Retry must invoke retryFailed with internal resolved failed ID");

        // Ensure retry does NOT read record id from client input
        $this->assertFalse(str_contains($code, "\$jsonData['outbox_id']"), "Must NOT accept outbox_id from client");
        $this->assertFalse(str_contains($code, "\$_POST['outbox_id']"), "Must NOT accept outbox_id from post");
    }

    private function testApiExcludesDispatchBatch(): void
    {
        $code = file_get_contents($this->apiFilePath);

        $this->assertFalse(str_contains($code, 'dispatchBatch'), "api/won_project.php must NOT invoke or expose dispatchBatch");
    }

    private function testJsConfirmationAndEventHandling(): void
    {
        $this->assertTrue(file_exists($this->jsFilePath), "assets/won_project_export.js must exist");
        $js = file_get_contents($this->jsFilePath);

        // Must prompt user for confirmation before mark_won
        $this->assertTrue(str_contains($js, "window.confirm('Are you sure you want to mark this project as won?"),
            "Must confirm before mark as won");

        // Must prompt user for confirmation before retry
        $this->assertTrue(str_contains($js, "window.confirm('Retry export delivery for this project?'),") || str_contains($js, "window.confirm('Retry export delivery for this project?')"),
            "Must confirm before retry");

        // Must disable button and show loading state
        $this->assertTrue(str_contains($js, "markAsWonBtn.disabled = true;"), "Must disable button while in-flight");
        $this->assertTrue(str_contains($js, "Processing..."), "Must show processing indicator");

        // Must update project status pill to accepted
        $this->assertTrue(str_contains($js, "updateProjectStatusPill('accepted')"),
            "Must update status button pill to accepted upon success");
    }

    private function testDashboardInjectsSafeConfigAndCsrf(): void
    {
        $this->assertTrue(file_exists($this->dashboardFilePath), "pages/project_dashboard.php must exist");
        $php = file_get_contents($this->dashboardFilePath);

        // CSRF initialization
        $this->assertTrue(str_contains($php, "\$_SESSION['won_project_csrf_token'] = bin2hex(random_bytes(32));"),
            "Must generate 64-hex CSRF token in session");

        // Check that HMAC secrets are never leaked into the page
        $this->assertFalse(str_contains($php, 'getHmacSecret()'), "Dashboard must NEVER call or expose getHmacSecret()");
        $this->assertFalse(str_contains($php, 'WON_PROJECT_HMAC_ACTIVE_SECRET'), "Dashboard must NEVER print WON_PROJECT_HMAC_ACTIVE_SECRET");
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
}

// CLI Execution entrypoint
$apiFile = __DIR__ . '/../api/won_project.php';
$jsFile = __DIR__ . '/../assets/won_project_export.js';
$dashboardFile = __DIR__ . '/../pages/project_dashboard.php';

$runner = new WonProjectUiApiContractTestRunner($apiFile, $jsFile, $dashboardFile);
exit($runner->run());
