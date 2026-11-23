<?php
declare(strict_types=1);

require_once __DIR__ . '/AuthorizationPolicy.php';

/** Project-scoped authorization built on the authenticated Hub shadow user. */
final class ProjectAccess
{
    public const READ = 'project.read';
    public const WRITE = 'project.write';

    public static function roleAllowsCapability(string $applicationRole, string $memberRole, string $capability): bool
    {
        $applicationRole = strtolower(trim($applicationRole));
        $memberRole = strtolower(trim($memberRole));
        if (!\Takeoff\Core\Auth\AuthorizationPolicy::allows($applicationRole, $capability)) return false;
        if ($applicationRole === 'admin') return true;
        if ($capability === self::READ) {
            return in_array($memberRole, ['owner', 'editor', 'viewer'], true);
        }
        if ($capability === self::WRITE) {
            return in_array($memberRole, ['owner', 'editor'], true);
        }
        return false;
    }

    public static function can(PDO $pdo, array $user, int $projectId, string $capability): bool
    {
        if ($projectId <= 0 || !in_array($capability, [self::READ, self::WRITE], true)) return false;
        $role = strtolower(trim((string)($user['role'] ?? '')));
        $userId = (int)($user['user_id'] ?? 0);
        if ($role === 'admin' && $userId > 0) return true;
        if ($userId <= 0 || !\Takeoff\Core\Auth\AuthorizationPolicy::allows($role, $capability)) return false;

        $memberRole = self::memberRole($pdo, $projectId, $userId);
        return $memberRole !== null && self::roleAllowsCapability($role, $memberRole, $capability);
    }

    public static function accessibleProjectIds(PDO $pdo, array $user): ?array
    {
        $role = strtolower(trim((string)($user['role'] ?? '')));
        $userId = (int)($user['user_id'] ?? 0);
        if ($role === 'admin' && $userId > 0) return null;
        if ($userId <= 0 || !\Takeoff\Core\Auth\AuthorizationPolicy::allows($role, self::READ)) return [];

        $ids = [];
        if (self::tableExists($pdo, 'project_members')) {
            $stmt = $pdo->prepare('SELECT project_id FROM project_members WHERE user_id=? AND active=1');
            $stmt->execute([$userId]);
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) ?: [] as $id) $ids[(int)$id] = true;
        }
        if (self::tableExists($pdo, 'directory')) {
            $stmt = $pdo->prepare('SELECT project_id FROM directory WHERE user_id=?');
            $stmt->execute([$userId]);
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) ?: [] as $id) $ids[(int)$id] = true;
        }
        $stmt = $pdo->prepare('SELECT id FROM projects WHERE deleted_at IS NULL AND (created_by=? OR assigned_user_id=?)');
        $stmt->execute([$userId, $userId]);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) ?: [] as $id) $ids[(int)$id] = true;
        return array_values(array_filter(array_keys($ids), static fn($id) => $id > 0));
    }

    public static function grantCreator(PDO $pdo, int $projectId, int $userId): void
    {
        if ($projectId <= 0 || $userId <= 0) return;
        if (self::tableExists($pdo, 'project_members')) {
            $stmt = $pdo->prepare(
                "INSERT INTO project_members (project_id,user_id,member_role,active)
                 VALUES (?,?,'owner',1)
                 ON DUPLICATE KEY UPDATE member_role='owner',active=1,updated_at=CURRENT_TIMESTAMP"
            );
            $stmt->execute([$projectId, $userId]);
        }
    }

    private static function memberRole(PDO $pdo, int $projectId, int $userId): ?string
    {
        if (self::tableExists($pdo, 'project_members')) {
            $stmt = $pdo->prepare('SELECT member_role FROM project_members WHERE project_id=? AND user_id=? AND active=1 LIMIT 1');
            $stmt->execute([$projectId, $userId]);
            $role = $stmt->fetchColumn();
            if (is_string($role) && trim($role) !== '') return strtolower(trim($role));
        }
        if (self::tableExists($pdo, 'directory')) {
            $stmt = $pdo->prepare('SELECT 1 FROM directory WHERE project_id=? AND user_id=? LIMIT 1');
            $stmt->execute([$projectId, $userId]);
            if ($stmt->fetchColumn()) return 'editor';
        }
        $stmt = $pdo->prepare('SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL AND (created_by=? OR assigned_user_id=?) LIMIT 1');
        $stmt->execute([$projectId, $userId, $userId]);
        return $stmt->fetchColumn() ? 'editor' : null;
    }

    private static function tableExists(PDO $pdo, string $table): bool
    {
        static $cache = [];
        $key = spl_object_hash($pdo) . ':' . $table;
        if (array_key_exists($key, $cache)) return $cache[$key];
        try {
            $stmt = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1');
            $stmt->execute([$table]);
            return $cache[$key] = (bool)$stmt->fetchColumn();
        } catch (Throwable $e) {
            return $cache[$key] = false;
        }
    }
}

function takeoff_guard_project_access(PDO $pdo, array $user, int $projectId, string $capability): void
{
    if (ProjectAccess::can($pdo, $user, $projectId, $capability)) return;
    http_response_code(403);
    if (!headers_sent()) header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'status' => 'error',
        'success' => false,
        'msg' => 'Forbidden: project membership is required.',
        'error' => ['code' => 'project_access_denied', 'message' => 'Project membership is required.'],
    ], JSON_UNESCAPED_SLASHES);
    exit;
}
