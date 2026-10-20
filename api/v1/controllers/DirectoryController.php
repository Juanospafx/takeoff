<?php
declare(strict_types=1);

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../../../core/auth/session.php';

class DirectoryController
{
    private $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    public function index(): void
    {
        try {
            $stmt = $this->pdo->query(
                "SELECT
                    p.id AS project_id,
                    p.name AS project_name,
                    p.description AS project_description,
                    p.status AS project_status,
                    p.assigned_user_id AS primary_user_id,
                    u.id AS user_id,
                    u.username AS username,
                    u.role AS user_role
                 FROM projects p
                 LEFT JOIN directory d ON d.project_id = p.id
                 LEFT JOIN users u ON u.id = d.user_id
                 WHERE p.deleted_at IS NULL
                 ORDER BY p.created_at DESC, u.username ASC"
            );
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            ok_response($rows);
        } catch (Exception $e) {
            error_response('INTERNAL_ERROR', 'Unexpected error', null, 500);
        }
    }

    public function assign(array $params): void
    {
        $user = SessionGuard::getAuthenticatedUser();
        if ($user === null) {
            error_response('UNAUTHORIZED', 'Authentication required', null, 401);
        }
        if ($user['role'] !== SessionGuard::ROLE_ADMIN) {
            error_response('FORBIDDEN', 'Insufficient privileges', null, 403);
        }

        $projectId = require_int($params['id'] ?? null);
        if (!$projectId) {
            error_response('VALIDATION_ERROR', 'Invalid project id', ['field' => 'id'], 422);
        }

        $data = read_json_body();
        $userIds = $data['user_ids'] ?? null;
        $userId = require_int($data['user_id'] ?? null);

        if (is_array($userIds)) {
            $cleanIds = [];
            foreach ($userIds as $uid) {
                $uid = require_int($uid);
                if ($uid) $cleanIds[] = $uid;
            }
            $userIds = array_values(array_unique($cleanIds));
        } else {
            $userIds = [];
            if ($userId) $userIds[] = $userId;
        }

        if (empty($userIds)) {
            error_response('VALIDATION_ERROR', 'Invalid user_id(s)', null, 422);
        }

        try {
            $stmt = $this->pdo->prepare("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL");
            $stmt->execute([$projectId]);
            if (!$stmt->fetch()) {
                error_response('NOT_FOUND', 'Project not found', null, 404);
            }

            $in = implode(',', array_fill(0, count($userIds), '?'));
            $stmtUsers = $this->pdo->prepare("SELECT id, role FROM users WHERE id IN ($in)");
            $stmtUsers->execute($userIds);
            $rows = $stmtUsers->fetchAll(PDO::FETCH_ASSOC);
            if (count($rows) !== count($userIds)) {
                error_response('VALIDATION_ERROR', 'Invalid users', null, 422);
            }

            $adminIds = [];
            foreach ($rows as $r) {
                if ($r['role'] === 'admin') $adminIds[] = (int)$r['id'];
            }
            if (empty($adminIds)) {
                error_response('VALIDATION_ERROR', 'At least one admin must be assigned', null, 422);
            }

            $this->pdo->beginTransaction();
            $this->pdo->prepare("DELETE FROM directory WHERE project_id = ?")->execute([$projectId]);
            $dir = $this->pdo->prepare("INSERT IGNORE INTO directory (project_id, user_id) VALUES (?, ?)");
            foreach ($userIds as $uid) {
                $dir->execute([$projectId, $uid]);
            }

            $primaryId = $adminIds[0];
            $update = $this->pdo->prepare("UPDATE projects SET assigned_user_id = ? WHERE id = ?");
            $update->execute([$primaryId, $projectId]);
            $this->pdo->commit();

            ok_response(['assigned' => true, 'count' => count($userIds)]);
        } catch (Exception $e) {
            error_response('INTERNAL_ERROR', 'Unexpected error', null, 500);
        }
    }
}
