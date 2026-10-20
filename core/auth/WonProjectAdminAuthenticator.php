<?php
declare(strict_types=1);

/**
 * WonProjectAdminAuthenticator
 *
 * Centralized authenticator and authorizer for the Won Project flow (TASK-0096).
 *
 * Isolates the Won Project export workflow from the legacy compatibility session shim
 * (core/auth/session.php), ensuring no fabricated identities are accepted.
 *
 * Strict authorization rules:
 *   1. Must have an active session with valid, positive integer user_id.
 *   2. Must have session role explicitly matching 'admin'.
 *   3. Must query persisted user in database via parameterized query:
 *      SELECT id, role, active FROM users WHERE id = ? LIMIT 1
 *   4. Persisted user must exist, have active === 1, and role === 'admin'.
 *   5. Any table, column, or connection failure MUST fail closed (deny access) without leaking
 *      database schema or error details to the client.
 */
class WonProjectAdminAuthenticator
{
    private PDO $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    /**
     * Authenticates and authorizes that the given session belongs to an active, persisted admin user.
     *
     * Fails closed on any error, missing user, inactive user, or non-admin role.
     *
     * @param array|null $session Session array (defaults to $_SESSION if null)
     * @return array{id: int, role: string, active: int}|null Authenticated user data, or null on failure
     */
    public function authenticate(?array $session = null): ?array
    {
        if ($session === null) {
            $session = $_SESSION ?? [];
        }

        // 1. Session user_id validation: must be a positive integer
        $rawUserId = $session['user_id'] ?? null;
        if ($rawUserId === null || (!is_int($rawUserId) && !is_string($rawUserId))) {
            return null;
        }

        $userIdString = trim((string)$rawUserId);
        if ($userIdString === '' || !ctype_digit($userIdString)) {
            return null;
        }

        $userId = (int)$userIdString;
        if ($userId <= 0) {
            return null;
        }

        // 2. Session role validation: must be 'admin'
        $sessionRole = strtolower(trim((string)($session['role'] ?? '')));
        if ($sessionRole !== 'admin') {
            return null;
        }

        // 3. Database query: parameterized query for persisted user
        try {
            $stmt = $this->pdo->prepare('SELECT id, role, active FROM users WHERE id = ? LIMIT 1');
            $executed = $stmt->execute([$userId]);
            if (!$executed) {
                return null;
            }

            $user = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!is_array($user)) {
                return null;
            }

            // 4. Validate persisted role: must strictly be 'admin'
            $persistedRole = strtolower(trim((string)($user['role'] ?? '')));
            if ($persistedRole !== 'admin') {
                return null;
            }

            // 5. Validate persisted active flag: must strictly be 1
            $rawActive = $user['active'] ?? null;
            if ($rawActive === null || (int)$rawActive !== 1) {
                return null;
            }

            return [
                'id' => (int)($user['id'] ?? $userId),
                'role' => 'admin',
                'active' => 1,
            ];
        } catch (\Throwable) {
            // Fail closed on any DB error, missing table/column, or connection error.
            // Never leak internal exception, SQL details, or schema structure.
            return null;
        }
    }

    /**
     * Enforces admin authentication. If authentication succeeds, returns the user array.
     * If authentication fails, renders 403 Forbidden JSON response and terminates execution.
     *
     * @param array|null $session Session array (defaults to $_SESSION if null)
     * @return array{id: int, role: string, active: int}
     */
    public function requireAdmin(?array $session = null): array
    {
        $user = $this->authenticate($session);
        if ($user === null) {
            self::deny();
        }
        return $user;
    }

    /**
     * Renders standardized 403 Forbidden JSON response and terminates.
     */
    public static function deny(): void
    {
        http_response_code(403);
        echo json_encode([
            'status' => 'error',
            'code' => 'forbidden',
            'message' => 'Admin role and active session required to perform this action.'
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }
}
