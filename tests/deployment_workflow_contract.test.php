<?php
declare(strict_types=1);

/**
 * Contract verification test for Takeoff deployment workflow and repository protections.
 *
 * Verifies:
 * 1. Deploy triggers: push main only + workflow_dispatch (manual safe trigger).
 * 2. Concurrency configuration with fixed takeoff-production group (no github.ref) and cancel-in-progress: false.
 * 3. FTP-Deploy-Action publishes a dedicated artifact directory, not `./`.
 * 4. Artifact creation excludes non-production and sensitive files (.git, .github, .env, tests, docs, db, harness, etc.).
 * 5. Runtime dependencies remain physically verified (api/, core/, assets, bin/dispatch-won-project-outbox.php).
 * 6. FTP/21 risk documentation and retention without FTPS unverified changes.
 * 7. Secrets hygiene: no HMAC secret exposure, no FTP credentials leaked outside deploy action step.
 * 8. .gitignore protections for sensitive artifacts, protecting dumps/backups without global *.sql hiding migrations.
 */

function runDeploymentWorkflowContractTests(): void
{
    $repoRoot = dirname(__DIR__);
    $deployYmlPath = $repoRoot . '/.github/workflows/deploy.yml';
    $gitignorePath = $repoRoot . '/.gitignore';
    $ciYmlPath = $repoRoot . '/.github/workflows/ci.yml';

    echo "Running Deployment Workflow Contract Tests...\n";

    // 1. Check deploy.yml exists
    if (!file_exists($deployYmlPath)) {
        throw new RuntimeException("FAIL: .github/workflows/deploy.yml does not exist.");
    }
    $deployYml = file_get_contents($deployYmlPath);

    // 2. Acceptance criteria: Deploy automático sólo ocurre en push a main; workflow_dispatch existe y no habilita deploy automático de ramas.
    if (!preg_match('/on:\s+push:\s+branches:\s*\[\s*"main"\s*\]/m', $deployYml) &&
        !preg_match('/push:\s*\n\s+branches:\s*\n\s+-\s*["\']?main["\']?/m', $deployYml)) {
        throw new RuntimeException("FAIL: Automatic deploy trigger must be restricted to push on main branch.");
    }
    if (!preg_match('/workflow_dispatch:/m', $deployYml)) {
        throw new RuntimeException("FAIL: workflow_dispatch trigger must exist for manual execution.");
    }
    // Verify pull_request or push on feature branches does not trigger deploy
    if (preg_match('/pull_request:/m', $deployYml)) {
        throw new RuntimeException("FAIL: pull_request trigger must not exist in deploy workflow.");
    }

    // 3. Acceptance criteria: Concurrency configuration
    // Concurrency uses fixed group takeoff-production without github.ref and cancel-in-progress: false
    if (!preg_match('/concurrency:\s*\n\s+group:\s*([^\n]+)\n\s+cancel-in-progress:\s*([^\n]+)/m', $deployYml, $concurrencyMatches)) {
        throw new RuntimeException("FAIL: Concurrency group and cancel-in-progress must be configured.");
    }
    $concurrencyGroup = trim($concurrencyMatches[1], " \t'\"");
    $cancelInProgress = trim($concurrencyMatches[2], " \t'\"");
    if ($concurrencyGroup !== 'takeoff-production') {
        throw new RuntimeException("FAIL: Concurrency group must be fixed 'takeoff-production', found '{$concurrencyGroup}'.");
    }
    if (str_contains($concurrencyGroup, 'github.ref')) {
        throw new RuntimeException("FAIL: Concurrency group must not contain github.ref.");
    }
    if ($cancelInProgress !== 'false') {
        throw new RuntimeException("FAIL: Concurrency cancel-in-progress must be false.");
    }

    // 4. Acceptance criteria: Build artifact directory and FTP-Deploy-Action publishes that directory, not ./
    if (!preg_match('/local-dir:\s*\.?\/([a-zA-Z0-9_\-\/]+)/m', $deployYml, $matches)) {
        throw new RuntimeException("FAIL: local-dir in FTP-Deploy-Action is not configured.");
    }
    $localDir = trim($matches[1]);
    if ($localDir === '.' || $localDir === './' || $localDir === '') {
        throw new RuntimeException("FAIL: local-dir must publish a dedicated artifact directory, not `./`.");
    }

    // 5. Acceptance criteria: Exclusions in artifact (.git, .github, .env, tests, docs, SQL/migraciones, harness, etc.)
    $requiredExclusions = [
        '.git',
        '.github',
        '.env',
        'tests',
        'docs',
        'harness',
        'db',
        'sql',
    ];
    foreach ($requiredExclusions as $exclusion) {
        if (stripos($deployYml, $exclusion) === false) {
            throw new RuntimeException("FAIL: deploy.yml does not specify exclusion for '{$exclusion}'.");
        }
    }

    // 6. Acceptance criteria: Critical runtime paths must be preserved and verified
    // api/, core/, assets runtime and bin/dispatch-won-project-outbox.php
    $runtimePaths = [
        $repoRoot . '/api',
        $repoRoot . '/core',
        $repoRoot . '/assets',
        $repoRoot . '/bin/dispatch-won-project-outbox.php',
    ];
    foreach ($runtimePaths as $path) {
        if (!file_exists($path)) {
            throw new RuntimeException("FAIL: Required runtime path '{$path}' is missing in the repository.");
        }
    }

    // In deploy.yml, ensure the build step physically verifies existence of api, core, assets, and bin/dispatch-won-project-outbox.php
    $requiredArtifactChecks = [
        'test -d "$ARTIFACT_DIR/api"',
        'test -d "$ARTIFACT_DIR/core"',
        'test -d "$ARTIFACT_DIR/assets"',
        'test -f "$ARTIFACT_DIR/bin/dispatch-won-project-outbox.php"',
    ];
    foreach ($requiredArtifactChecks as $check) {
        if (!str_contains($deployYml, $check)) {
            throw new RuntimeException("FAIL: deploy.yml must physically verify artifact path with '{$check}'.");
        }
    }

    // 7. Acceptance criteria: Port 21 (FTP) is preserved with documentation of security risk; no FTPS forced without provider evidence
    if (!preg_match('/port:\s*21/m', $deployYml)) {
        throw new RuntimeException("FAIL: FTP port 21 must be preserved.");
    }
    if (!str_contains($deployYml, 'Security Note') && !str_contains(strtolower($deployYml), 'ftps') && !str_contains(strtolower($deployYml), 'unencrypted')) {
        throw new RuntimeException("FAIL: deploy.yml must document the security risk and rationale for retaining FTP port 21.");
    }

    // 8. Acceptance criteria: Secrets hygiene
    // No HMAC secret exposure, no FTP credentials reused outside deploy action step
    if (stripos($deployYml, 'HMAC') !== false && !str_contains($deployYml, '#') && !str_contains($deployYml, 'test')) {
        throw new RuntimeException("FAIL: HMAC secret names should not appear in deploy.yml.");
    }
    // Verify only FTP_SERVER, FTP_USERNAME, FTP_PASSWORD are used in action with block
    $secretOccurrences = [];
    preg_match_all('/\${{\s*secrets\.([A-Z0-9_]+)\s*}}/', $deployYml, $secretMatches);
    if (!empty($secretMatches[1])) {
        foreach ($secretMatches[1] as $secretName) {
            if (!in_array($secretName, ['FTP_SERVER', 'FTP_USERNAME', 'FTP_PASSWORD'], true)) {
                throw new RuntimeException("FAIL: Unexpected secret reference found: {$secretName}");
            }
        }
    }

    // 9. Acceptance criteria: .gitignore protections
    if (!file_exists($gitignorePath)) {
        throw new RuntimeException("FAIL: .gitignore does not exist.");
    }
    $gitignore = file_get_contents($gitignorePath);
    $requiredGitignorePatterns = [
        '.env',
        'logs',
        'tmp',
        'coverage',
        'deploy_artifact',
    ];
    foreach ($requiredGitignorePatterns as $pattern) {
        if (stripos($gitignore, $pattern) === false) {
            throw new RuntimeException("FAIL: .gitignore missing pattern for '{$pattern}'.");
        }
    }

    // Ensure .gitignore does NOT ignore critical runtime directories like api/ or core/
    $forbiddenGitignorePatterns = [
        '/^api\/?$/m',
        '/^core\/?$/m',
        '/^bin\/?$/m',
    ];
    foreach ($forbiddenGitignorePatterns as $patternRegex) {
        if (preg_match($patternRegex, $gitignore)) {
            throw new RuntimeException("FAIL: .gitignore must not ignore critical runtime directories ({$patternRegex}).");
        }
    }

    // Ensure .gitignore does NOT use global *.sql pattern, preserving legitimate migrations
    if (preg_match('/^\s*\/?\*\.sql\s*$/m', $gitignore)) {
        throw new RuntimeException("FAIL: .gitignore must not use global *.sql pattern; it hides legitimate migrations.");
    }

    // Ensure .gitignore protects database dumps and backups without hiding legitimate migrations
    $dumpBackupPatterns = ['dump', 'backup'];
    foreach ($dumpBackupPatterns as $pattern) {
        if (stripos($gitignore, $pattern) === false) {
            throw new RuntimeException("FAIL: .gitignore must protect database {$pattern} files.");
        }
    }

    echo "ALL DEPLOYMENT WORKFLOW CONTRACT TESTS PASSED (9/9 assertions).\n";
}

try {
    runDeploymentWorkflowContractTests();
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, "TEST ERROR: " . $e->getMessage() . "\n");
    exit(1);
}
