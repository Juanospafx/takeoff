<?php
declare(strict_types=1);

/**
 * CLI runner for WonProject transactional outbox dispatcher (cron / worker).
 *
 * Usage:
 *   php bin/dispatch-won-project-outbox.php [--limit=50] [--retry-id=N]
 */

if (php_sapi_name() !== 'cli') {
    if (!headers_sent()) {
        http_response_code(403);
    }
    fwrite(STDERR, "Forbidden: CLI invocation only.\n");
    exit(1);
}

require_once __DIR__ . '/../core/config/WonProjectIntegrationConfig.php';
require_once __DIR__ . '/../core/services/WonProjectHmacClient.php';
require_once __DIR__ . '/../core/services/WonProjectOutboxDispatcher.php';
require_once __DIR__ . '/../core/db/connection.php';

try {
    if (!isset($pdo) || !($pdo instanceof PDO)) {
        throw new RuntimeException("Database connection instance (\$pdo) could not be initialized from core/db/connection.php");
    }

    $config = WonProjectIntegrationConfig::load();

    if (!$config->isExportEnabled()) {
        echo json_encode([
            'status' => 'disabled',
            'message' => 'WonProject export is disabled by configuration',
            'timestamp' => date('Y-m-d H:i:s'),
        ], JSON_UNESCAPED_SLASHES) . "\n";
        exit(0);
    }

    $client = new WonProjectHmacClient($config);
    $dispatcher = new WonProjectOutboxDispatcher($pdo, $config, $client);

    $limit = 50;
    $retryId = null;

    if (isset($argv) && is_array($argv)) {
        foreach ($argv as $arg) {
            if (str_starts_with($arg, '--limit=')) {
                $val = (int)substr($arg, 8);
                if ($val > 0) {
                    $limit = $val;
                }
            } elseif (str_starts_with($arg, '--retry-id=')) {
                $rawId = substr($arg, 11);
                if (!ctype_digit($rawId) || (int)$rawId <= 0) {
                    fwrite(STDERR, "Error: --retry-id requires a positive integer ID.\n");
                    exit(1);
                }
                $retryId = (int)$rawId;
            }
        }
    }

    $retriedCount = 0;
    if ($retryId !== null) {
        $retriedCount = $dispatcher->retryFailed($retryId);
    }

    $summary = $dispatcher->dispatchBatch($limit);
    if ($retryId !== null) {
        $summary['retried_manual'] = $retriedCount;
        $summary['retried_id'] = $retryId;
    }
    $summary['timestamp'] = date('Y-m-d H:i:s');

    echo json_encode($summary, JSON_UNESCAPED_SLASHES) . "\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, "Fatal outbox dispatcher error: ERR_OUTBOX_DISPATCHER_FAILED\n");
    exit(1);
}
