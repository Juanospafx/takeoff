<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/auth/session.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
$action = (string) ($_GET['action'] ?? $_POST['action'] ?? ($input['action'] ?? 'heartbeat'));
$user = takeoff_guard_api_action(
    $action,
    ['list'],
    ['heartbeat', 'leave'],
    'heartbeat',
    null,
    true,
    'project.read'
);

require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/auth/ProjectAccess.php';

function presence_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function presence_client_id($value): string
{
    $value = trim((string) $value);
    return preg_match('/^[A-Za-z0-9_-]{12,96}$/', $value) ? $value : '';
}

function presence_initials(string $name): string
{
    $parts = preg_split('/\s+/', trim($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    if (count($parts) >= 2) {
        $first = function_exists('mb_substr') ? mb_substr($parts[0], 0, 1) : substr($parts[0], 0, 1);
        $lastPart = $parts[count($parts) - 1];
        $last = function_exists('mb_substr') ? mb_substr($lastPart, 0, 1) : substr($lastPart, 0, 1);
        return strtoupper($first . $last);
    }
    return strtoupper(function_exists('mb_substr') ? mb_substr($name, 0, 2) : substr($name, 0, 2));
}

try {
    $projectId = is_numeric($input['project_id'] ?? $_GET['project_id'] ?? null)
        ? (int) ($input['project_id'] ?? $_GET['project_id']) : 0;
    if ($projectId < 1) presence_json(['status' => 'error', 'message' => 'A valid project is required.'], 422);
    takeoff_guard_project_access($pdo, $user, $projectId, ProjectAccess::READ);

    $userId = (int) $user['user_id'];
    $clientId = presence_client_id($input['client_id'] ?? $_GET['client_id'] ?? '');
    if ($action !== 'list' && $clientId === '') {
        presence_json(['status' => 'error', 'message' => 'A valid presence client is required.'], 422);
    }

    if ($action === 'leave') {
        $delete = $pdo->prepare('DELETE FROM project_presence WHERE project_id=? AND user_id=? AND client_id=?');
        $delete->execute([$projectId, $userId, $clientId]);
        presence_json(['status' => 'success']);
    }

    if ($action === 'heartbeat') {
        $displayName = trim((string) ($_SESSION['display_name'] ?? $_SESSION['name'] ?? $user['username'] ?? 'User'));
        if ($displayName === '') $displayName = trim((string) ($user['username'] ?? '')) ?: 'User';
        $role = ucfirst((string) ($user['role'] ?? 'viewer'));
        $upsert = $pdo->prepare(
            'INSERT INTO project_presence (project_id,user_id,client_id,display_name,user_role,last_seen)
             VALUES (?,?,?,?,?,NOW(6))
             ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),user_role=VALUES(user_role),last_seen=NOW(6)'
        );
        $upsert->execute([$projectId, $userId, $clientId, $displayName, $role]);
        $pdo->prepare('DELETE FROM project_presence WHERE project_id=? AND last_seen < (NOW(6) - INTERVAL 2 MINUTE)')
            ->execute([$projectId]);
    }

    $query = $pdo->prepare(
        'SELECT presence.user_id, MAX(presence.display_name) AS display_name,
                MAX(presence.user_role) AS user_role, MAX(presence.last_seen) AS last_seen
         FROM project_presence AS presence
         INNER JOIN users ON users.id = presence.user_id AND users.active = 1
         WHERE presence.project_id=? AND presence.last_seen >= (NOW(6) - INTERVAL 35 SECOND)
         GROUP BY presence.user_id
         ORDER BY last_seen DESC'
    );
    $query->execute([$projectId]);
    $users = array_map(static function (array $row) use ($userId): array {
        $name = (string) ($row['display_name'] ?? 'User');
        return [
            'id' => (int) $row['user_id'],
            'name' => $name,
            'initials' => presence_initials($name),
            'role' => (string) ($row['user_role'] ?? 'Collaborator'),
            'isSelf' => (int) $row['user_id'] === $userId,
            'lastSeen' => (string) $row['last_seen'],
        ];
    }, $query->fetchAll(PDO::FETCH_ASSOC));
    presence_json(['status' => 'success', 'users' => $users]);
} catch (Throwable $e) {
    $errorId = bin2hex(random_bytes(4));
    error_log("project_presence.php [{$errorId}]: " . $e->getMessage());
    presence_json([
        'status' => 'error',
        'message' => 'Project presence is temporarily unavailable.',
        'error_id' => $errorId,
    ], 503);
}

