<?php
/**
 * Minimal aggregate test runner for Takeoff SSO client contract and runtime suites.
 */

declare(strict_types=1);

/**
 * Executes a subprocess with timeout and output capture using temporary files.
 *
 * @param array<int, string> $commandArgs
 * @param float $timeoutSeconds
 * @param string $cwd
 * @return array<string, mixed>
 */
function runTakeoffSubprocess(array $commandArgs, float $timeoutSeconds, string $cwd): array
{
    $stdoutFile = tempnam(sys_get_temp_dir(), 'sso_out_');
    $stderrFile = tempnam(sys_get_temp_dir(), 'sso_err_');

    if ($stdoutFile === false || $stderrFile === false) {
        if (is_string($stdoutFile) && file_exists($stdoutFile)) {
            @unlink($stdoutFile);
        }
        if (is_string($stderrFile) && file_exists($stderrFile)) {
            @unlink($stderrFile);
        }
        return [
            'timedOut' => false,
            'exitCode' => -1,
            'stdout' => '',
            'stderr' => 'failed to create temporary files',
            'duration' => 0.0,
            'stdoutFile' => is_string($stdoutFile) ? $stdoutFile : '',
            'stderrFile' => is_string($stderrFile) ? $stderrFile : '',
            'processStopped' => true,
            'pid' => 0,
            'error' => 'failed to create temporary files',
        ];
    }

    $isWindows = PHP_OS_FAMILY === 'Windows';
    $command = (PHP_VERSION_ID >= 70400)
        ? $commandArgs
        : implode(' ', array_map('escapeshellarg', $commandArgs));
    $options = $isWindows ? ['bypass_shell' => true] : [];

    $descriptors = [
        0 => ['pipe', 'r'],
        1 => ['file', $stdoutFile, 'w'],
        2 => ['file', $stderrFile, 'w'],
    ];

    $pipes = [];
    $process = null;
    $timedOut = false;
    $exitCode = null;
    $stdout = '';
    $stderr = '';
    $processStopped = false;
    $pid = 0;
    $startTime = microtime(true);

    try {
        $process = proc_open($command, $descriptors, $pipes, $cwd, null, $options);

        if (!is_resource($process)) {
            return [
                'timedOut' => false,
                'exitCode' => -1,
                'stdout' => '',
                'stderr' => 'failed to spawn process',
                'duration' => 0.0,
                'stdoutFile' => $stdoutFile,
                'stderrFile' => $stderrFile,
                'processStopped' => true,
                'pid' => 0,
                'error' => 'failed to spawn process',
            ];
        }

        // Close stdin immediately
        if (isset($pipes[0]) && is_resource($pipes[0])) {
            fclose($pipes[0]);
        }

        $initStatus = proc_get_status($process);
        $pid = (int) ($initStatus['pid'] ?? 0);

        while (true) {
            $status = proc_get_status($process);
            if (!$status['running']) {
                $exitCode = $status['exitcode'];
                $processStopped = true;
                break;
            }

            if ((microtime(true) - $startTime) >= $timeoutSeconds) {
                $timedOut = true;
                break;
            }

            usleep(10000);
        }

        if ($timedOut) {
            proc_terminate($process);
            $termStart = microtime(true);
            while (true) {
                $st = proc_get_status($process);
                if (!$st['running']) {
                    $processStopped = true;
                    break;
                }
                if ((microtime(true) - $termStart) >= 2.0) {
                    if (!$isWindows) {
                        @proc_terminate($process, 9);
                    }
                    $st = proc_get_status($process);
                    $processStopped = !$st['running'];
                    break;
                }
                usleep(10000);
            }
            $exitCode = -1;
        }

        $closeCode = proc_close($process);
        $process = null;

        if ($exitCode === null) {
            $exitCode = ($closeCode !== -1) ? $closeCode : 0;
        }

        if (file_exists($stdoutFile)) {
            $stdout = (string) file_get_contents($stdoutFile);
        }
        if (file_exists($stderrFile)) {
            $stderr = (string) file_get_contents($stderrFile);
        }

        $duration = round(microtime(true) - $startTime, 3);

        return [
            'timedOut' => $timedOut,
            'exitCode' => $exitCode,
            'stdout' => $stdout,
            'stderr' => $stderr,
            'duration' => $duration,
            'stdoutFile' => $stdoutFile,
            'stderrFile' => $stderrFile,
            'processStopped' => $processStopped,
            'pid' => $pid,
        ];
    } finally {
        if (isset($pipes[0]) && is_resource($pipes[0])) {
            @fclose($pipes[0]);
        }
        if (is_resource($process)) {
            @proc_terminate($process);
            @proc_close($process);
        }
        if (is_string($stdoutFile) && file_exists($stdoutFile)) {
            @unlink($stdoutFile);
            clearstatcache(true, $stdoutFile);
        }
        if (is_string($stderrFile) && file_exists($stderrFile)) {
            @unlink($stderrFile);
            clearstatcache(true, $stderrFile);
        }
    }
}

/**
 * Self-test proving the existing runner timeout behavior.
 */
function assertTakeoffTimeoutBehaviorProof(string $phpBinary, string $cwd): void
{
    $proofTimeout = 1.0;
    $stdoutMarker = '__TAKEOFF_TIMEOUT_STDOUT_PROOF__';
    $stderrMarker = '__TAKEOFF_TIMEOUT_STDERR_PROOF__';

    $inlineCode = sprintf(
        "fwrite(STDOUT, '%s' . PHP_EOL); fflush(STDOUT); fwrite(STDERR, '%s' . PHP_EOL); fflush(STDERR); usleep(4000000);",
        $stdoutMarker,
        $stderrMarker
    );

    $commandArgs = [$phpBinary, '-r', $inlineCode];
    $result = runTakeoffSubprocess($commandArgs, $proofTimeout, $cwd);

    // 1. timedOut true
    assert($result['timedOut'] === true, 'Timeout proof failed: timedOut must be true');
    if ($result['timedOut'] !== true) {
        throw new RuntimeException('Timeout proof failed: timedOut must be true');
    }

    // 2. non-zero exit code
    assert($result['exitCode'] !== 0, 'Timeout proof failed: exitCode must be non-zero');
    if ($result['exitCode'] === 0) {
        throw new RuntimeException('Timeout proof failed: exitCode must be non-zero');
    }

    // 3. bounded duration
    assert($result['duration'] >= 0.9 && $result['duration'] < 3.5, 'Timeout proof failed: duration not bounded');
    if (!($result['duration'] >= 0.9 && $result['duration'] < 3.5)) {
        throw new RuntimeException(sprintf(
            'Timeout proof failed: duration %.3fs was not bounded around timeout %.1fs (< 3.5s)',
            $result['duration'],
            $proofTimeout
        ));
    }

    // 4. both diagnostic markers recovered
    assert(strpos($result['stdout'], $stdoutMarker) !== false, 'Timeout proof failed: stdout marker not recovered');
    assert(strpos($result['stderr'], $stderrMarker) !== false, 'Timeout proof failed: stderr marker not recovered');
    if (strpos($result['stdout'], $stdoutMarker) === false || strpos($result['stderr'], $stderrMarker) === false) {
        throw new RuntimeException('Timeout proof failed: diagnostic markers not recovered from stdout/stderr');
    }

    // 5. direct process stopped
    assert($result['processStopped'] === true, 'Timeout proof failed: direct process not stopped');
    if ($result['processStopped'] !== true) {
        throw new RuntimeException('Timeout proof failed: direct process not stopped');
    }
    if (function_exists('posix_kill') && $result['pid'] > 0) {
        assert(!@posix_kill($result['pid'], 0), 'Timeout proof failed: process is still alive');
        if (@posix_kill($result['pid'], 0)) {
            throw new RuntimeException('Timeout proof failed: process is still alive');
        }
    }

    // 6. temporary stdout/stderr files deleted
    assert(is_string($result['stdoutFile']) && $result['stdoutFile'] !== '', 'Timeout proof failed: stdoutFile path missing');
    assert(is_string($result['stderrFile']) && $result['stderrFile'] !== '', 'Timeout proof failed: stderrFile path missing');
    assert(!file_exists($result['stdoutFile']), 'Timeout proof failed: stdout temp file was not deleted');
    assert(!file_exists($result['stderrFile']), 'Timeout proof failed: stderr temp file was not deleted');
    if (file_exists($result['stdoutFile']) || file_exists($result['stderrFile'])) {
        throw new RuntimeException('Timeout proof failed: temporary files were not deleted');
    }
}

$suites = [
    'sso_authorization_runtime.test.php',
    'sso_feature_flag_contract.test.php',
    'sso_identity_link_runtime.test.php',
    'sso_identity_static_contract.test.php',
    'sso_login_logout_runtime.test.php',
    'sso_state_pkce_contract.test.php',
    'sso_token_userinfo_static_contract.test.php',
];

$suiteDir = __DIR__;
$cwd = dirname(__DIR__);
$phpBinary = (defined('PHP_BINARY') && PHP_BINARY !== '') ? PHP_BINARY : 'php';

$timeoutSeconds = 15.0;
if (getenv('SSO_TEST_TIMEOUT') !== false && is_numeric(getenv('SSO_TEST_TIMEOUT'))) {
    $timeoutSeconds = (float) getenv('SSO_TEST_TIMEOUT');
}

// Execute timeout behavior proof before running aggregate suites
assertTakeoffTimeoutBehaviorProof($phpBinary, $cwd);

$passedCount = 0;
$failedCount = 0;
$totalCount = count($suites);

echo "Starting Takeoff SSO aggregate runner ({$totalCount} suites)...\n\n";

foreach ($suites as $suite) {
    $suitePath = $suiteDir . DIRECTORY_SEPARATOR . $suite;

    if (!file_exists($suitePath)) {
        $failedCount++;
        echo "[FAIL] {$suite} (file not found: {$suitePath})\n";
        continue;
    }

    $result = runTakeoffSubprocess([$phpBinary, $suitePath], $timeoutSeconds, $cwd);

    if (isset($result['error'])) {
        $failedCount++;
        echo "[FAIL] {$suite} ({$result['error']})\n";
        continue;
    }

    if ($result['timedOut']) {
        $failedCount++;
        echo "[TIMEOUT] {$suite} (exceeded {$timeoutSeconds}s)\n";
        if (trim($result['stdout']) !== '') {
            echo "--- STDOUT ({$suite}) ---\n" . rtrim($result['stdout']) . "\n";
        }
        if (trim($result['stderr']) !== '') {
            echo "--- STDERR ({$suite}) ---\n" . rtrim($result['stderr']) . "\n";
        }
    } elseif ($result['exitCode'] !== 0) {
        $failedCount++;
        echo "[FAIL] {$suite} (exit code: {$result['exitCode']}, duration: {$result['duration']}s)\n";
        if (trim($result['stdout']) !== '') {
            echo "--- STDOUT ({$suite}) ---\n" . rtrim($result['stdout']) . "\n";
        }
        if (trim($result['stderr']) !== '') {
            echo "--- STDERR ({$suite}) ---\n" . rtrim($result['stderr']) . "\n";
        }
    } else {
        $passedCount++;
        echo "[PASS] {$suite} ({$result['duration']}s)\n";
    }
}

echo "\n";
if ($passedCount === $totalCount && $failedCount === 0) {
    echo "Summary: 7/7 suites passed\n";
    exit(0);
} else {
    echo "Summary: {$passedCount}/{$totalCount} suites passed ({$failedCount} failed)\n";
    exit(1);
}
