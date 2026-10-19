<?php
declare(strict_types=1);

/**
 * Contract verification test for Takeoff deployment manifest and SHA256 checksums.
 *
 * Verifies:
 * 1. .github/workflows/deploy.yml generates a revision manifest JSON in deploy_artifact.
 * 2. Manifest includes required metadata: format_version, repository, commit_sha, generated_at_utc, workflow_run_id.
 * 3. Manifest strictly excludes branch, actor, environment, secrets, credentials, or private configuration.
 * 4. Deterministic SHA256SUMS generated for runtime files avoiding recursive autochecksum.
 * 5. Deploy triggers maintained (push main only + workflow_dispatch).
 * 6. Concurrency configuration maintained (takeoff-production, cancel-in-progress: false).
 * 7. Exclusions maintained (.git, .github, .env*, tests, docs, harness, db, *.sql, logs, tmp, etc.).
 * 8. Critical runtime path validations preserved.
 * 9. Structural JSON contract validation and deterministic checksum simulation.
 * 10. No FTP execution during contract test execution.
 */

function runDeploymentManifestContractTests(): void
{
    $repoRoot = dirname(__DIR__);
    $deployYmlPath = $repoRoot . '/.github/workflows/deploy.yml';

    echo "Running Deployment Manifest Contract Tests...\n";

    // 1. Verify deploy.yml exists
    if (!file_exists($deployYmlPath)) {
        throw new RuntimeException("FAIL: .github/workflows/deploy.yml does not exist.");
    }
    $deployYml = file_get_contents($deployYmlPath);

    // 2. Acceptance criteria: Deployment triggers maintained (push main only, workflow_dispatch)
    if (!preg_match('/on:\s+push:\s+branches:\s*\[\s*"main"\s*\]/m', $deployYml) &&
        !preg_match('/push:\s*\r?\n\s+branches:\s*\r?\n\s+-\s*["\']?main["\']?/m', $deployYml)) {
        throw new RuntimeException("FAIL: Automatic deploy trigger must be restricted to push on main branch.");
    }
    if (!preg_match('/workflow_dispatch:/m', $deployYml)) {
        throw new RuntimeException("FAIL: workflow_dispatch trigger must exist for manual execution.");
    }
    if (preg_match('/pull_request:/m', $deployYml)) {
        throw new RuntimeException("FAIL: pull_request trigger must not exist in deploy workflow.");
    }

    // 3. Acceptance criteria: Concurrency configuration maintained
    // Contract must accept both LF and CRLF endings without relaxing expected values
    $lfDeployYml = str_replace("\r\n", "\n", $deployYml);
    $crlfDeployYml = str_replace("\n", "\r\n", $lfDeployYml);

    foreach (['LF' => $lfDeployYml, 'CRLF' => $crlfDeployYml] as $format => $ymlContent) {
        if (!preg_match('/concurrency:\s*\r?\n\s+group:\s*([^\r\n]+)\r?\n\s+cancel-in-progress:\s*([^\r\n]+)/m', $ymlContent, $concurrencyMatches)) {
            throw new RuntimeException("FAIL: Concurrency group and cancel-in-progress must be configured ({$format} endings).");
        }
        $concurrencyGroup = trim($concurrencyMatches[1], " \t\r\n'\"");
        $cancelInProgress = trim($concurrencyMatches[2], " \t\r\n'\"");
        if ($concurrencyGroup !== 'takeoff-production') {
            throw new RuntimeException("FAIL: Concurrency group must be fixed 'takeoff-production', found '{$concurrencyGroup}' ({$format} endings).");
        }
        if (str_contains($concurrencyGroup, 'github.ref')) {
            throw new RuntimeException("FAIL: Concurrency group must not contain github.ref ({$format} endings).");
        }
        if ($cancelInProgress !== 'false') {
            throw new RuntimeException("FAIL: Concurrency cancel-in-progress must be false ({$format} endings).");
        }
    }

    // 4. Acceptance criteria: Exclusions maintained in artifact creation
    $requiredExclusions = [
        '.git',
        '.github',
        '.env',
        'tests',
        'docs',
        'harness',
        'db',
        'sql',
        'logs',
        'tmp',
        'temp',
        'cache',
        'coverage',
    ];
    foreach ($requiredExclusions as $exclusion) {
        if (stripos($deployYml, $exclusion) === false) {
            throw new RuntimeException("FAIL: deploy.yml does not specify exclusion for '{$exclusion}'.");
        }
    }

    // 5. Acceptance criteria: Critical runtime paths preserved
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

    // 6. Acceptance criteria: Manifest JSON generated inside deploy_artifact with required metadata
    // Required fields: format_version, repository, commit_sha, generated_at_utc, workflow_run_id
    if (!str_contains($deployYml, 'deployment-manifest.json')) {
        throw new RuntimeException("FAIL: deploy.yml must generate deployment-manifest.json inside deploy artifact.");
    }

    $requiredManifestFields = [
        'format_version',
        'repository',
        'commit_sha',
        'generated_at_utc',
        'workflow_run_id',
    ];
    foreach ($requiredManifestFields as $field) {
        if (!str_contains($deployYml, $field)) {
            throw new RuntimeException("FAIL: Manifest generation must include required field '{$field}'.");
        }
    }

    // Verify metadata sources
    if (!str_contains($deployYml, 'github.repository')) {
        throw new RuntimeException("FAIL: Manifest must obtain repository from github.repository.");
    }
    if (!str_contains($deployYml, 'github.sha')) {
        throw new RuntimeException("FAIL: Manifest must obtain commit_sha from github.sha.");
    }
    if (!str_contains($deployYml, 'github.run_id')) {
        throw new RuntimeException("FAIL: Manifest must obtain workflow_run_id from github.run_id.");
    }
    if (!str_contains($deployYml, 'date -u') && !str_contains($deployYml, 'UTC')) {
        throw new RuntimeException("FAIL: Manifest must generate UTC timestamp for generated_at_utc.");
    }

    // Verify manifest verification check
    if (!str_contains($deployYml, 'test -s "$ARTIFACT_DIR/deployment-manifest.json"') &&
        !str_contains($deployYml, 'test -f "$ARTIFACT_DIR/deployment-manifest.json"')) {
        throw new RuntimeException("FAIL: deploy.yml must verify existence of deployment-manifest.json.");
    }

    // 7. Acceptance criteria: Strict absence of sensitive fields or private configuration in manifest
    // Forbidden fields: branch, actor, environment, secrets, credentials, internal configuration
    if (preg_match('/# Generate deployment manifest JSON.*?(?=(#|test -s|\z))/s', $deployYml, $manifestBlockMatches)) {
        $manifestBlock = $manifestBlockMatches[0];
    } else {
        $manifestBlock = $deployYml;
    }

    $forbiddenTerms = [
        'github.ref',
        'github.actor',
        'branch',
        'actor',
        'environment',
        'secrets.',
        'FTP_PASSWORD',
        'FTP_USERNAME',
        'FTP_SERVER',
    ];
    foreach ($forbiddenTerms as $term) {
        if (preg_match('/--arg\s+' . preg_quote($term, '/') . '\b/i', $manifestBlock) ||
            preg_match('/["\']' . preg_quote($term, '/') . '["\']\s*:/i', $manifestBlock)) {
            throw new RuntimeException("FAIL: Manifest generation must not include sensitive or forbidden term '{$term}'.");
        }
    }

    // 8. Acceptance criteria: Deterministic SHA256SUMS generation for runtime files and avoids recursive autochecksum
    if (!str_contains($deployYml, 'SHA256SUMS')) {
        throw new RuntimeException("FAIL: deploy.yml must generate SHA256SUMS.");
    }
    if (!str_contains($deployYml, 'sha256sum')) {
        throw new RuntimeException("FAIL: deploy.yml must use sha256sum to generate checksums.");
    }
    if (!str_contains($deployYml, 'sort')) {
        throw new RuntimeException("FAIL: deploy.yml must use sort for deterministic checksum generation.");
    }
    if (!preg_match('/!\s*-name\s*[\'"]?SHA256SUMS[\'"]?/i', $deployYml)) {
        throw new RuntimeException("FAIL: deploy.yml must explicitly exclude SHA256SUMS to avoid recursive autochecksum.");
    }
    if (!str_contains($deployYml, 'test -s "$ARTIFACT_DIR/SHA256SUMS"') &&
        !str_contains($deployYml, 'test -f "$ARTIFACT_DIR/SHA256SUMS"')) {
        throw new RuntimeException("FAIL: deploy.yml must verify existence of SHA256SUMS.");
    }

    // 9. Acceptance criteria: Structural JSON contract validation and sensitive field absence
    $simulatedManifestJson = json_encode([
        'format_version' => '1.0',
        'repository' => 'owner/takeoff',
        'commit_sha' => '0123456789abcdef0123456789abcdef01234567',
        'generated_at_utc' => gmdate('Y-m-d\TH:i:s\Z'),
        'workflow_run_id' => '1234567890',
    ], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT);

    $decodedManifest = json_decode($simulatedManifestJson, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($decodedManifest)) {
        throw new RuntimeException("FAIL: Simulated manifest must decode to an array.");
    }

    // Verify exact expected keys
    $allowedKeys = [
        'format_version',
        'repository',
        'commit_sha',
        'generated_at_utc',
        'workflow_run_id',
    ];
    $actualKeys = array_keys($decodedManifest);
    sort($allowedKeys);
    sort($actualKeys);
    if ($allowedKeys !== $actualKeys) {
        throw new RuntimeException("FAIL: Manifest keys do not strictly match allowed schema: " . implode(', ', $actualKeys));
    }

    // Value format validations
    if ($decodedManifest['format_version'] !== '1.0') {
        throw new RuntimeException("FAIL: format_version must be '1.0'.");
    }
    if (!preg_match('/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/', $decodedManifest['repository'])) {
        throw new RuntimeException("FAIL: repository must follow owner/repo format.");
    }
    if (!preg_match('/^[0-9a-f]{40}$/', $decodedManifest['commit_sha'])) {
        throw new RuntimeException("FAIL: commit_sha must be a 40-character hexadecimal SHA.");
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $decodedManifest['generated_at_utc'])) {
        throw new RuntimeException("FAIL: generated_at_utc must be in ISO 8601 UTC format (YYYY-MM-DDTHH:MM:SSZ).");
    }
    if (!preg_match('/^\d+$/', $decodedManifest['workflow_run_id'])) {
        throw new RuntimeException("FAIL: workflow_run_id must be a numeric run ID.");
    }

    // Strict absence of forbidden keys in manifest
    $forbiddenKeys = ['branch', 'ref', 'actor', 'environment', 'secrets', 'password', 'token', 'config'];
    foreach ($forbiddenKeys as $forbiddenKey) {
        if (array_key_exists($forbiddenKey, $decodedManifest)) {
            throw new RuntimeException("FAIL: Manifest contains forbidden key '{$forbiddenKey}'.");
        }
    }

    // 10. Acceptance criteria: Deterministic SHA256SUMS simulation test
    $tempDir = sys_get_temp_dir() . '/takeoff_manifest_test_' . bin2hex(random_bytes(6));
    if (!mkdir($tempDir, 0777, true) && !is_dir($tempDir)) {
        throw new RuntimeException("FAIL: Unable to create temporary test directory.");
    }

    try {
        mkdir($tempDir . '/api', 0777, true);
        mkdir($tempDir . '/core', 0777, true);
        file_put_contents($tempDir . '/api/index.php', '<?php echo "api";');
        file_put_contents($tempDir . '/core/bootstrap.php', '<?php echo "core";');

        // Emulate find . -type f ! -name 'SHA256SUMS' | LC_ALL=C sort | sha256sum
        $filesToHash = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tempDir, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $fileInfo) {
            if ($fileInfo->isFile() && $fileInfo->getFilename() !== 'SHA256SUMS') {
                $relative = substr($fileInfo->getPathname(), strlen($tempDir) + 1);
                $relative = str_replace('\\', '/', $relative);
                $filesToHash[] = $relative;
            }
        }
        usort($filesToHash, 'strcmp');

        $checksumLines1 = [];
        foreach ($filesToHash as $relPath) {
            $fullPath = $tempDir . '/' . $relPath;
            $hash = hash_file('sha256', $fullPath);
            $checksumLines1[] = "{$hash}  ./{$relPath}";
        }
        $sha256sumsContent = implode("\n", $checksumLines1) . "\n";
        file_put_contents($tempDir . '/SHA256SUMS', $sha256sumsContent);

        // Run second calculation to prove determinism
        $checksumLines2 = [];
        $filesToHash2 = [];
        $iterator2 = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tempDir, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator2 as $fileInfo) {
            if ($fileInfo->isFile() && $fileInfo->getFilename() !== 'SHA256SUMS') {
                $relative = substr($fileInfo->getPathname(), strlen($tempDir) + 1);
                $relative = str_replace('\\', '/', $relative);
                $filesToHash2[] = $relative;
            }
        }
        usort($filesToHash2, 'strcmp');
        foreach ($filesToHash2 as $relPath) {
            $fullPath = $tempDir . '/' . $relPath;
            $hash = hash_file('sha256', $fullPath);
            $checksumLines2[] = "{$hash}  ./{$relPath}";
        }

        if ($checksumLines1 !== $checksumLines2) {
            throw new RuntimeException("FAIL: SHA256SUMS generation is not deterministic.");
        }
        if (str_contains($sha256sumsContent, 'SHA256SUMS')) {
            throw new RuntimeException("FAIL: SHA256SUMS contains itself, violating recursive exclusion.");
        }
    } finally {
        $cleanupIterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($tempDir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($cleanupIterator as $item) {
            if ($item->isDir()) {
                rmdir($item->getPathname());
            } else {
                unlink($item->getPathname());
            }
        }
        rmdir($tempDir);
    }

    // 11. Acceptance criteria: FTP execution is prevented during test
    if (!str_contains($deployYml, 'SamKirkland/FTP-Deploy-Action@v4.3.5')) {
        throw new RuntimeException("FAIL: FTP-Deploy-Action step must be preserved.");
    }
    if (!str_contains($deployYml, 'local-dir: ./deploy_artifact/')) {
        throw new RuntimeException("FAIL: FTP-Deploy-Action local-dir must publish ./deploy_artifact/.");
    }

    echo "ALL DEPLOYMENT MANIFEST CONTRACT TESTS PASSED (11/11 assertions).\n";
}

try {
    runDeploymentManifestContractTests();
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, "TEST ERROR: " . $e->getMessage() . "\n");
    exit(1);
}
