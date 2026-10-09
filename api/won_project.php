<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/services/WonProjectExportService.php';
require_once __DIR__ . '/../core/services/WonProjectOutboxDispatcher.php';
require_once __DIR__ . '/../core/config/WonProjectIntegrationConfig.php';

if (!isset($pdo) || !($pdo instanceof PDO)) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'code' => 'database_unavailable',
        'message' => 'Database connection is unavailable.'
    ], JSON_UNESCAPED_SLASHES);
    exit;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$config = null;
$integrationEnabled = false;
try {
    $config = WonProjectIntegrationConfig::load();
    $integrationEnabled = $config->isExportEnabled();
} catch (Throwable) {
    $config = null;
    $integrationEnabled = false;
}

$userId = (int)($_SESSION['user_id'] ?? 0);
$userRole = strtolower(trim((string)($_SESSION['role'] ?? '')));
$isAdmin = ($userRole === 'admin');

if ($method === 'GET') {
    if ($userId <= 0 || !$isAdmin) {
        http_response_code(403);
        echo json_encode([
            'status' => 'error',
            'code' => 'forbidden',
            'message' => 'Admin role and active session required to perform this action.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    try {
        $uStmt = $pdo->prepare("SELECT role FROM users WHERE id=? LIMIT 1");
        $uStmt->execute([$userId]);
        $persistedRole = $uStmt->fetchColumn();
    } catch (Throwable) {
        $persistedRole = false;
    }

    if ($persistedRole === false || strtolower(trim((string)$persistedRole)) !== 'admin') {
        http_response_code(403);
        echo json_encode([
            'status' => 'error',
            'code' => 'forbidden',
            'message' => 'Admin role and active session required to perform this action.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    $action = trim((string)($_GET['action'] ?? 'status'));
    if ($action !== 'status') {
        http_response_code(405);
        echo json_encode([
            'status' => 'error',
            'code' => 'method_not_allowed',
            'message' => 'Method not allowed for requested action.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    $projectId = (int)($_GET['project_id'] ?? $_GET['id'] ?? 0);
    if ($projectId <= 0) {
        http_response_code(422);
        echo json_encode([
            'status' => 'error',
            'code' => 'invalid_project_id',
            'message' => 'A valid positive project ID is required.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    try {
        $pStmt = $pdo->prepare("SELECT status FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $pStmt->execute([$projectId]);
        $projectRow = $pStmt->fetch(PDO::FETCH_ASSOC);

        if (!$projectRow) {
            http_response_code(422);
            echo json_encode([
                'status' => 'error',
                'code' => 'project_not_found',
                'message' => 'Project not found.'
            ], JSON_UNESCAPED_SLASHES);
            exit;
        }

        $projectStatus = (string)$projectRow['status'];

        $outboxData = null;
        $driver = (string)$pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        $hasOutboxTable = false;
        try {
            if ($driver === 'sqlite') {
                $tStmt = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'won_project_outbox'");
                $tStmt->execute();
                $hasOutboxTable = (bool)$tStmt->fetchColumn();
            } else {
                $tStmt = $pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'won_project_outbox'");
                $tStmt->execute();
                $hasOutboxTable = (bool)$tStmt->fetchColumn();
            }
        } catch (Throwable) {
            $hasOutboxTable = false;
        }

        if ($hasOutboxTable) {
            $oStmt = $pdo->prepare("
                SELECT id, event_id, status, attempts, next_attempt_at, delivered_at,
                       (CASE WHEN last_error IS NOT NULL AND last_error != '' THEN 1 ELSE 0 END) AS has_error
                FROM won_project_outbox
                WHERE project_id = ? AND event_type = 'project.won'
                ORDER BY id DESC
                LIMIT 1
            ");
            $oStmt->execute([$projectId]);
            $oRow = $oStmt->fetch(PDO::FETCH_ASSOC);

            if ($oRow) {
                $outboxData = [
                    'id' => (int)$oRow['id'],
                    'event_id' => (string)$oRow['event_id'],
                    'status' => (string)$oRow['status'],
                    'attempts' => (int)$oRow['attempts'],
                    'next_attempt_at' => $oRow['next_attempt_at'],
                    'delivered_at' => $oRow['delivered_at'],
                    'has_error' => (bool)$oRow['has_error'],
                ];
            }
        }

        http_response_code(200);
        echo json_encode([
            'status' => 'success',
            'project_status' => $projectStatus,
            'integration_enabled' => $integrationEnabled,
            'outbox' => $outboxData,
        ], JSON_UNESCAPED_SLASHES);
        exit;
    } catch (Throwable) {
        http_response_code(500);
        echo json_encode([
            'status' => 'error',
            'code' => 'internal_error',
            'message' => 'Unable to fetch project export status.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }
}

if ($method === 'POST') {
    if ($userId <= 0 || !$isAdmin) {
        http_response_code(403);
        echo json_encode([
            'status' => 'error',
            'code' => 'forbidden',
            'message' => 'Admin role and active session required to perform this action.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    try {
        $uStmt = $pdo->prepare("SELECT role FROM users WHERE id=? LIMIT 1");
        $uStmt->execute([$userId]);
        $persistedRole = $uStmt->fetchColumn();
    } catch (Throwable) {
        $persistedRole = false;
    }

    if ($persistedRole === false || strtolower(trim((string)$persistedRole)) !== 'admin') {
        http_response_code(403);
        echo json_encode([
            'status' => 'error',
            'code' => 'forbidden',
            'message' => 'Admin role and active session required to perform this action.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    $rawInput = file_get_contents('php://input');
    $jsonData = [];
    if (!empty($rawInput)) {
        $decoded = json_decode($rawInput, true);
        if (is_array($decoded)) {
            $jsonData = $decoded;
        }
    }

    $action = trim((string)($_POST['action'] ?? $jsonData['action'] ?? ''));
    $projectId = (int)($_POST['project_id'] ?? $_POST['id'] ?? $jsonData['project_id'] ?? $jsonData['id'] ?? 0);
    $csrfToken = trim((string)($_POST['csrf_token'] ?? $jsonData['csrf_token'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''));

    $sessionCsrf = (string)($_SESSION['won_project_csrf_token'] ?? '');
    if ($csrfToken === '' || $sessionCsrf === '' || !hash_equals($sessionCsrf, $csrfToken)) {
        http_response_code(403);
        echo json_encode([
            'status' => 'error',
            'code' => 'invalid_csrf_token',
            'message' => 'Invalid or missing CSRF token.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    if ($projectId <= 0) {
        http_response_code(422);
        echo json_encode([
            'status' => 'error',
            'code' => 'invalid_project_id',
            'message' => 'A valid positive project ID is required.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    if (!in_array($action, ['mark_won', 'retry'], true)) {
        if ($action === 'status') {
            http_response_code(405);
            echo json_encode([
                'status' => 'error',
                'code' => 'method_not_allowed',
                'message' => 'Status queries must use GET method.'
            ], JSON_UNESCAPED_SLASHES);
            exit;
        }
        http_response_code(422);
        echo json_encode([
            'status' => 'error',
            'code' => 'invalid_action',
            'message' => 'Unsupported action requested.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    if ($action === 'mark_won') {
        try {
            $service = new WonProjectExportService($pdo, $config);
            $eventRecord = $service->markAsWon($projectId, $userId, 'admin');

            $outboxData = null;
            $oStmt = $pdo->prepare("
                SELECT id, event_id, status, attempts, next_attempt_at, delivered_at,
                       (CASE WHEN last_error IS NOT NULL AND last_error != '' THEN 1 ELSE 0 END) AS has_error
                FROM won_project_outbox
                WHERE project_id = ? AND event_type = 'project.won'
                ORDER BY id DESC
                LIMIT 1
            ");
            $oStmt->execute([$projectId]);
            $oRow = $oStmt->fetch(PDO::FETCH_ASSOC);
            if ($oRow) {
                $outboxData = [
                    'id' => (int)$oRow['id'],
                    'event_id' => (string)$oRow['event_id'],
                    'status' => (string)$oRow['status'],
                    'attempts' => (int)$oRow['attempts'],
                    'next_attempt_at' => $oRow['next_attempt_at'],
                    'delivered_at' => $oRow['delivered_at'],
                    'has_error' => (bool)$oRow['has_error'],
                ];
            }

            http_response_code(200);
            echo json_encode([
                'status' => 'success',
                'action' => 'mark_won',
                'project_status' => 'accepted',
                'event_id' => (string)($eventRecord['event_id'] ?? ($outboxData['event_id'] ?? '')),
                'integration_enabled' => $integrationEnabled,
                'outbox' => $outboxData,
            ], JSON_UNESCAPED_SLASHES);
            exit;
        } catch (InvalidArgumentException) {
            http_response_code(422);
            echo json_encode([
                'status' => 'error',
                'code' => 'validation_error',
                'message' => 'Please verify project and actor details before proceeding.'
            ], JSON_UNESCAPED_SLASHES);
            exit;
        } catch (RuntimeException) {
            http_response_code(422);
            echo json_encode([
                'status' => 'error',
                'code' => 'missing_prerequisites',
                'message' => 'Project is missing required details to mark as won. Please complete the project, approved estimate, client, and location details.'
            ], JSON_UNESCAPED_SLASHES);
            exit;
        } catch (Throwable) {
            http_response_code(500);
            echo json_encode([
                'status' => 'error',
                'code' => 'internal_error',
                'message' => 'An internal error occurred while processing Mark as Won.'
            ], JSON_UNESCAPED_SLASHES);
            exit;
        }
    }

    if ($action === 'retry') {
        if (!$integrationEnabled) {
            http_response_code(422);
            echo json_encode([
                'status' => 'error',
                'code' => 'integration_disabled',
                'message' => 'Integration export is currently disabled.'
            ], JSON_UNESCAPED_SLASHES);
            exit;
        }

        try {
            $findStmt = $pdo->prepare("
                SELECT id FROM won_project_outbox
                WHERE project_id = ? AND event_type = 'project.won' AND status = 'failed'
                ORDER BY id DESC
                LIMIT 1
            ");
            $findStmt->execute([$projectId]);
            $failedId = $findStmt->fetchColumn();

            if ($failedId === false || $failedId === null || (int)$failedId <= 0) {
                http_response_code(422);
                echo json_encode([
                    'status' => 'error',
                    'code' => 'no_failed_event',
                    'message' => 'No failed export event found for this project to retry.'
                ], JSON_UNESCAPED_SLASHES);
                exit;
            }

            $dispatcher = new WonProjectOutboxDispatcher($pdo, $config);
            $dispatcher->retryFailed((int)$failedId);

            $oStmt = $pdo->prepare("
                SELECT id, event_id, status, attempts, next_attempt_at, delivered_at,
                       (CASE WHEN last_error IS NOT NULL AND last_error != '' THEN 1 ELSE 0 END) AS has_error
                FROM won_project_outbox
                WHERE id = ?
                LIMIT 1
            ");
            $oStmt->execute([(int)$failedId]);
            $oRow = $oStmt->fetch(PDO::FETCH_ASSOC);

            $outboxData = null;
            if ($oRow) {
                $outboxData = [
                    'id' => (int)$oRow['id'],
                    'event_id' => (string)$oRow['event_id'],
                    'status' => (string)$oRow['status'],
                    'attempts' => (int)$oRow['attempts'],
                    'next_attempt_at' => $oRow['next_attempt_at'],
                    'delivered_at' => $oRow['delivered_at'],
                    'has_error' => (bool)$oRow['has_error'],
                ];
            }

            http_response_code(200);
            echo json_encode([
                'status' => 'success',
                'action' => 'retry',
                'project_status' => 'accepted',
                'integration_enabled' => true,
                'outbox' => $outboxData,
            ], JSON_UNESCAPED_SLASHES);
            exit;
        } catch (Throwable) {
            http_response_code(500);
            echo json_encode([
                'status' => 'error',
                'code' => 'internal_error',
                'message' => 'An internal error occurred while retrying export.'
            ], JSON_UNESCAPED_SLASHES);
            exit;
        }
    }
}

http_response_code(405);
echo json_encode([
    'status' => 'error',
    'code' => 'method_not_allowed',
    'message' => 'Method not allowed.'
], JSON_UNESCAPED_SLASHES);
exit;
