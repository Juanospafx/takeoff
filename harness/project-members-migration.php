<?php

declare(strict_types=1);

const MIGRATION_TOKEN_SHA256 = '__MIGRATION_TOKEN_SHA256__';

function migrationResponse(int $status, array $payload): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    migrationResponse(405, ['ok' => false]);
}

$providedToken = (string)($_SERVER['HTTP_X_TAKEOFF_MIGRATION_TOKEN'] ?? '');
if (
    preg_match('/^[a-f0-9]{64}$/D', MIGRATION_TOKEN_SHA256) !== 1
    || $providedToken === ''
    || !hash_equals(MIGRATION_TOKEN_SHA256, hash('sha256', $providedToken))
) {
    migrationResponse(401, ['ok' => false]);
}

$result = [
    'ok' => false,
    'migration' => '20261123_project_members',
    'database_connected' => false,
    'project_members_table' => false,
    'project_members_role_column' => false,
    'backfilled_rows' => 0,
    'cleanup' => false,
];

try {
    require __DIR__ . '/core/db/connection.php';
    if (!isset($pdo) || !$pdo instanceof PDO) {
        throw new RuntimeException('Database connection unavailable.');
    }
    $result['database_connected'] = true;

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS project_members (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            project_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            member_role VARCHAR(32) NOT NULL DEFAULT 'viewer',
            active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_project_members_project_user (project_id, user_id),
            KEY idx_project_members_user_active (user_id, active),
            CONSTRAINT fk_project_members_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            CONSTRAINT fk_project_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            CONSTRAINT chk_project_members_role CHECK (member_role IN ('owner','editor','viewer'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $tableExists = $pdo->query("SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='project_members' LIMIT 1")->fetchColumn();
    $roleColumnExists = $pdo->query("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='project_members' AND column_name='member_role' LIMIT 1")->fetchColumn();
    $activeColumnExists = $pdo->query("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='project_members' AND column_name='active' LIMIT 1")->fetchColumn();
    if (!$tableExists || !$roleColumnExists || !$activeColumnExists) {
        throw new RuntimeException('Project membership schema is incomplete.');
    }

    $backfilledRows = 0;
    $directoryExists = $pdo->query("SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='directory' LIMIT 1")->fetchColumn();
    if ($directoryExists) {
        $backfilledRows += (int)$pdo->exec(
            "INSERT IGNORE INTO project_members (project_id,user_id,member_role,active)
             SELECT project_id,user_id,'editor',1 FROM directory"
        );
    }

    $projectColumns = $pdo->query("SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='projects'")->fetchAll(PDO::FETCH_COLUMN);
    if (in_array('created_by', $projectColumns, true)) {
        $backfilledRows += (int)$pdo->exec(
            "INSERT IGNORE INTO project_members (project_id,user_id,member_role,active)
             SELECT id,created_by,'owner',1 FROM projects WHERE created_by IS NOT NULL"
        );
    }
    if (in_array('assigned_user_id', $projectColumns, true)) {
        $backfilledRows += (int)$pdo->exec(
            "INSERT IGNORE INTO project_members (project_id,user_id,member_role,active)
             SELECT id,assigned_user_id,'editor',1 FROM projects WHERE assigned_user_id IS NOT NULL"
        );
    }

    $result['project_members_table'] = true;
    $result['project_members_role_column'] = true;
    $result['backfilled_rows'] = $backfilledRows;
    $result['ok'] = true;
} catch (Throwable) {
    $result['ok'] = false;
} finally {
    $result['cleanup'] = @unlink(__FILE__);
}

migrationResponse(200, $result);
