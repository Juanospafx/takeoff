<?php
declare(strict_types=1);

/**
 * Fail-closed Takeoff session authentication and RBAC authorization core.
 *
 * Invariants:
 * 1. Never invents user_id, username, or role; never defaults to admin or fallback identities.
 * 2. Authenticates sessions using strictly server-side session values.
 * 3. Exact role normalization: only 'admin' and 'viewer' are recognized, and only 'admin' may mutate.
 * 4. Fails closed on missing or malformed authentication (HTTP 401).
 * 5. Fails closed on viewer mutations, unknown actions, and missing actions without safe defaults (HTTP 403).
 * 6. Explicit read action allowlists admit authenticated viewers.
 */

require_once __DIR__ . '/SsoSession.php';

// Configure session cookies and start session if not already active
if (session_status() !== PHP_SESSION_ACTIVE && !headers_sent()) {
    if (class_exists(\Takeoff\Core\Auth\SsoSession::class)) {
        \Takeoff\Core\Auth\SsoSession::configureCookieParams();
    }
    @session_start();
}

class SessionGuard
{
    public const ROLE_ADMIN = 'admin';
    public const ROLE_VIEWER = 'viewer';

    public const ALLOWED_ROLES = [
        self::ROLE_ADMIN,
        self::ROLE_VIEWER,
    ];

    /**
     * Normalizes a role string through trimming and lowercasing.
     *
     * @param mixed $role
     * @return string
     */
    public static function normalizeRole($role): string
    {
        if (!is_string($role)) {
            return '';
        }
        return strtolower(trim($role));
    }

    /**
     * Identifies a valid authenticated session using server session values only.
     * Returns the validated user record or null if unauthenticated or malformed.
     *
     * Invariants enforced:
     * - user_id must be a positive integer.
     * - username must be a non-empty string.
     * - role must be exactly 'admin' or 'viewer' after normalization.
     * - Never trusts request-supplied parameters ($_GET, $_POST, headers).
     * - Never falls back to default user IDs or roles.
     *
     * @param array|null $session Optional session array double (defaults to $_SESSION)
     * @return array{user_id: int, username: string, role: string}|null
     */
    public static function getAuthenticatedUser(?array $session = null): ?array
    {
        $data = $session !== null ? $session : (isset($_SESSION) && is_array($_SESSION) ? $_SESSION : []);

        // Validate user_id: must be a positive integer
        $rawUserId = $data['user_id'] ?? null;
        if ($rawUserId === null || (!is_int($rawUserId) && !ctype_digit((string)$rawUserId))) {
            return null;
        }
        $userId = (int)$rawUserId;
        if ($userId <= 0) {
            return null;
        }

        // Validate username: must be a non-empty string
        $rawUsername = $data['username'] ?? null;
        if (!is_string($rawUsername) || trim($rawUsername) === '') {
            return null;
        }
        $username = trim($rawUsername);

        // Validate role: must be a known role after normalization
        $rawRole = $data['role'] ?? null;
        if (!is_string($rawRole)) {
            return null;
        }
        $normalizedRole = self::normalizeRole($rawRole);
        if (!in_array($normalizedRole, self::ALLOWED_ROLES, true)) {
            return null;
        }

        // If active flag is explicitly present, it must be truthy
        if (array_key_exists('active', $data)) {
            $isActive = ($data['active'] === true || $data['active'] === 1 || $data['active'] === '1');
            if (!$isActive) {
                return null;
            }
        }

        return [
            'user_id' => $userId,
            'username' => $username,
            'role' => $normalizedRole,
        ];
    }

    /**
     * Checks if the session has a valid authenticated identity.
     *
     * @param array|null $session
     * @return bool
     */
    public static function isAuthenticated(?array $session = null): bool
    {
        return self::getAuthenticatedUser($session) !== null;
    }

    /**
     * Checks if the authenticated session has the 'admin' role.
     *
     * @param array|null $session
     * @return bool
     */
    public static function isAdmin(?array $session = null): bool
    {
        $user = self::getAuthenticatedUser($session);
        return $user !== null && $user['role'] === self::ROLE_ADMIN;
    }

    /**
     * Checks if the authenticated session has the 'viewer' role.
     *
     * @param array|null $session
     * @return bool
     */
    public static function isViewer(?array $session = null): bool
    {
        $user = self::getAuthenticatedUser($session);
        return $user !== null && $user['role'] === self::ROLE_VIEWER;
    }

    /**
     * Verifies that the authenticated user matches the expected role(s).
     * Role comparison is exact after normalization.
     *
     * @param string|array $expectedRole
     * @param array|null $session
     * @return bool
     */
    public static function hasRole($expectedRole, ?array $session = null): bool
    {
        $user = self::getAuthenticatedUser($session);
        if ($user === null) {
            return false;
        }

        $userRole = $user['role'];
        if (is_array($expectedRole)) {
            foreach ($expectedRole as $r) {
                if ($userRole === self::normalizeRole($r)) {
                    return true;
                }
            }
            return false;
        }

        return $userRole === self::normalizeRole((string)$expectedRole);
    }

    /**
     * Pure evaluator for API access control.
     * Evaluates authentication, action validity, and role permissions without side effects.
     *
     * Returns structured evaluation result including:
     * - allowed: bool
     * - status: int (200, 401, 403)
     * - reason: string description of policy decision
     * - error: ?string
     * - action: string
     * - user: ?array
     * - is_mutation: bool
     * - payload: array (standard JSON error or success response payload)
     *
     * @param string|null $action Requested action
     * @param array $readActions Explicit allowlist of read actions
     * @param array $mutationActions Explicit allowlist of mutation actions
     * @param string|null $defaultAction Optional safe default read action if action is missing/empty
     * @param array|null $session Optional session array double (defaults to $_SESSION)
     * @return array
     */
    public static function checkApiAccess(
        ?string $action,
        array $readActions = [],
        array $mutationActions = [],
        ?string $defaultAction = null,
        ?array $session = null
    ): array {
        // Step 1: Authentication check (server-side session only)
        $user = self::getAuthenticatedUser($session);
        if ($user === null) {
            return [
                'allowed' => false,
                'status' => 401,
                'reason' => 'unauthenticated',
                'error' => 'Authentication required',
                'action' => (string)$action,
                'user' => null,
                'is_mutation' => false,
                'payload' => [
                    'status' => 'error',
                    'msg' => 'Authentication required.',
                    'message' => 'Authentication required.',
                    'code' => 401,
                ],
            ];
        }

        // Step 2: Action resolution
        $resolvedAction = is_string($action) ? trim($action) : '';
        if ($resolvedAction === '' && $defaultAction !== null && trim($defaultAction) !== '') {
            $resolvedAction = trim($defaultAction);
        }

        // Missing or empty action fails closed unless a safe default was resolved
        if ($resolvedAction === '') {
            return [
                'allowed' => false,
                'status' => 403,
                'reason' => 'missing_action',
                'error' => 'Action cannot be empty',
                'action' => '',
                'user' => $user,
                'is_mutation' => false,
                'payload' => [
                    'status' => 'error',
                    'msg' => 'Forbidden: Action is required and cannot be empty.',
                    'message' => 'Forbidden: Action is required and cannot be empty.',
                    'code' => 403,
                ],
            ];
        }

        // Step 3: Authorization checks against explicit allowlists
        $isReadAction = in_array($resolvedAction, $readActions, true);
        $isMutationAction = in_array($resolvedAction, $mutationActions, true);

        // Read actions admit both authenticated viewers and admins
        if ($isReadAction) {
            return [
                'allowed' => true,
                'status' => 200,
                'reason' => 'authorized_read',
                'error' => null,
                'action' => $resolvedAction,
                'user' => $user,
                'is_mutation' => false,
                'payload' => [
                    'status' => 'success',
                ],
            ];
        }

        // Mutation actions require admin role; viewers are denied with HTTP 403
        if ($isMutationAction) {
            if ($user['role'] !== self::ROLE_ADMIN) {
                return [
                    'allowed' => false,
                    'status' => 403,
                    'reason' => 'viewer_mutation_denied',
                    'error' => 'Viewer role cannot perform mutations',
                    'action' => $resolvedAction,
                    'user' => $user,
                    'is_mutation' => true,
                    'payload' => [
                        'status' => 'error',
                        'msg' => 'Forbidden: Viewer role cannot perform mutations.',
                        'message' => 'Forbidden: Viewer role cannot perform mutations.',
                        'code' => 403,
                    ],
                ];
            }

            return [
                'allowed' => true,
                'status' => 200,
                'reason' => 'authorized_mutation',
                'error' => null,
                'action' => $resolvedAction,
                'user' => $user,
                'is_mutation' => true,
                'payload' => [
                    'status' => 'success',
                ],
            ];
        }

        // Unknown actions fail closed with HTTP 403
        return [
            'allowed' => false,
            'status' => 403,
            'reason' => 'unknown_action',
            'error' => 'Unknown action: ' . $resolvedAction,
            'action' => $resolvedAction,
            'user' => $user,
            'is_mutation' => false,
            'payload' => [
                'status' => 'error',
                'msg' => 'Forbidden: Action not allowed or unknown.',
                'message' => 'Forbidden: Action not allowed or unknown.',
                'code' => 403,
            ],
        ];
    }

    /**
     * Reusable API guard enforcing fail-closed authentication and authorization.
     * Emits standard HTTP 401/403 JSON responses and terminates execution on access denial.
     *
     * @param string|null $action Requested action
     * @param array $readActions Explicit allowlist of read actions
     * @param array $mutationActions Explicit allowlist of mutation actions
     * @param string|null $defaultAction Optional safe default read action
     * @param array|null $session Optional session array double
     * @param bool $exitOnError Whether to terminate execution on denial (default true)
     * @return array{user_id: int, username: string, role: string}|null Returns user record on success
     */
    public static function guardApiAction(
        ?string $action,
        array $readActions = [],
        array $mutationActions = [],
        ?string $defaultAction = null,
        ?array $session = null,
        bool $exitOnError = true
    ): ?array {
        $result = self::checkApiAccess($action, $readActions, $mutationActions, $defaultAction, $session);

        if (!$result['allowed']) {
            if (!headers_sent()) {
                header('Content-Type: application/json; charset=utf-8');
            }
            http_response_code($result['status']);
            echo json_encode($result['payload'], JSON_UNESCAPED_SLASHES);
            if ($exitOnError) {
                exit;
            }
            return null;
        }

        return $result['user'];
    }
}

// Global class aliases for flexible referencing
if (!class_exists('Takeoff\\Core\\Auth\\SessionGuard', false)) {
    class_alias(SessionGuard::class, 'Takeoff\\Core\\Auth\\SessionGuard');
}
if (!class_exists('TakeoffSessionGuard', false)) {
    class_alias(SessionGuard::class, 'TakeoffSessionGuard');
}

/**
 * Legacy compatibility shim for requireRole.
 * Never returns true unconditionally. Fails closed if session is invalid or role mismatch.
 *
 * @param string|array $role
 * @param array|null $session
 * @return bool
 */
function requireRole($role, ?array $session = null): bool
{
    return SessionGuard::hasRole($role, $session);
}

/**
 * Reusable helper: role normalization.
 *
 * @param mixed $role
 * @return string
 */
function takeoff_normalize_role($role): string
{
    return SessionGuard::normalizeRole($role);
}

/**
 * Reusable helper: get authenticated user record from server session.
 *
 * @param array|null $session
 * @return array{user_id: int, username: string, role: string}|null
 */
function takeoff_get_authenticated_user(?array $session = null): ?array
{
    return SessionGuard::getAuthenticatedUser($session);
}

/**
 * Reusable helper: check if session is authenticated.
 *
 * @param array|null $session
 * @return bool
 */
function takeoff_is_authenticated(?array $session = null): bool
{
    return SessionGuard::isAuthenticated($session);
}

/**
 * Reusable helper: check if session is authenticated admin.
 *
 * @param array|null $session
 * @return bool
 */
function takeoff_is_admin(?array $session = null): bool
{
    return SessionGuard::isAdmin($session);
}

/**
 * Reusable helper: check if session is authenticated viewer.
 *
 * @param array|null $session
 * @return bool
 */
function takeoff_is_viewer(?array $session = null): bool
{
    return SessionGuard::isViewer($session);
}

/**
 * Reusable helper: check if session has expected role.
 *
 * @param string|array $role
 * @param array|null $session
 * @return bool
 */
function takeoff_has_role($role, ?array $session = null): bool
{
    return SessionGuard::hasRole($role, $session);
}

/**
 * Reusable helper: pure evaluator for API action access.
 *
 * @param string|null $action
 * @param array $readActions
 * @param array $mutationActions
 * @param string|null $defaultAction
 * @param array|null $session
 * @return array
 */
function takeoff_check_api_access(
    ?string $action,
    array $readActions = [],
    array $mutationActions = [],
    ?string $defaultAction = null,
    ?array $session = null
): array {
    return SessionGuard::checkApiAccess($action, $readActions, $mutationActions, $defaultAction, $session);
}

/**
 * Reusable API guard: enforces fail-closed authentication and authorization.
 *
 * @param string|null $action
 * @param array $readActions
 * @param array $mutationActions
 * @param string|null $defaultAction
 * @param array|null $session
 * @param bool $exitOnError
 * @return array{user_id: int, username: string, role: string}|null
 */
function takeoff_guard_api_action(
    ?string $action,
    array $readActions = [],
    array $mutationActions = [],
    ?string $defaultAction = null,
    ?array $session = null,
    bool $exitOnError = true
): ?array {
    return SessionGuard::guardApiAction($action, $readActions, $mutationActions, $defaultAction, $session, $exitOnError);
}
