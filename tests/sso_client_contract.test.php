<?php
/**
 * Minimal aggregate test runner for Takeoff SSO client contract and runtime suites.
 */

declare(strict_types=1);

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

    $stdoutFile = tempnam(sys_get_temp_dir(), 'sso_out_');
    $stderrFile = tempnam(sys_get_temp_dir(), 'sso_err_');

    if ($stdoutFile === false || $stderrFile === false) {
        $failedCount++;
        echo "[FAIL] {$suite} (failed to create temporary files)\n";
        if (is_string($stdoutFile) && file_exists($stdoutFile)) {
            @unlink($stdoutFile);
        }
        if (is_string($stderrFile) && file_exists($stderrFile)) {
            @unlink($stderrFile);
        }
        continue;
    }

    $isWindows = PHP_OS_FAMILY === 'Windows';
    $command = (PHP_VERSION_ID >= 70400)
        ? [$phpBinary, $suitePath]
        : escapeshellarg($phpBinary) . ' ' . escapeshellarg($suitePath);
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
    $startTime = microtime(true);

    try {
        $process = proc_open($command, $descriptors, $pipes, $cwd, null, $options);

        if (!is_resource($process)) {
            $failedCount++;
            echo "[FAIL] {$suite} (failed to spawn process)\n";
            continue;
        }

        // Close stdin immediately
        if (isset($pipes[0]) && is_resource($pipes[0])) {
            fclose($pipes[0]);
        }

        while (true) {
            $status = proc_get_status($process);
            if (!$status['running']) {
                $exitCode = $status['exitcode'];
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
                    break;
                }
                if ((microtime(true) - $termStart) >= 2.0) {
                    if (!$isWindows) {
                        @proc_terminate($process, 9);
                    }
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

        if ($timedOut) {
            $failedCount++;
            echo "[TIMEOUT] {$suite} (exceeded {$timeoutSeconds}s)\n";
            if (trim($stdout) !== '') {
                echo "--- STDOUT ({$suite}) ---\n" . rtrim($stdout) . "\n";
            }
            if (trim($stderr) !== '') {
                echo "--- STDERR ({$suite}) ---\n" . rtrim($stderr) . "\n";
            }
        } elseif ($exitCode !== 0) {
            $failedCount++;
            echo "[FAIL] {$suite} (exit code: {$exitCode}, duration: {$duration}s)\n";
            if (trim($stdout) !== '') {
                echo "--- STDOUT ({$suite}) ---\n" . rtrim($stdout) . "\n";
            }
            if (trim($stderr) !== '') {
                echo "--- STDERR ({$suite}) ---\n" . rtrim($stderr) . "\n";
            }
        } else {
            $passedCount++;
            echo "[PASS] {$suite} ({$duration}s)\n";
        }
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
        }
        if (is_string($stderrFile) && file_exists($stderrFile)) {
            @unlink($stderrFile);
        }
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
