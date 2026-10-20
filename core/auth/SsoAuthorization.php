<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

use InvalidArgumentException;
use RuntimeException;

require_once __DIR__ . '/IdentityProfile.php';
require_once __DIR__ . '/FederatedIdentityRepository.php';

/**
 * Fail-closed Authorization Boundary for Takeoff SSO.
 *
 * Enforces strict authorization security invariants:
 * 1. Fail-closed: requires an explicitly active IdentityProfile with exactly one
 *    approved central role, admin or viewer.
 * 2. Identity matching uses only exact provider plus sub; username and email are never
 *    used for lookup, linking, or authorization.
 * 3. An existing exact active link synchronizes the local shadow user's role to the central
 *    approved role and keeps the immutable link unchanged. Authorization no longer trusts
 *    a stale local role over the approved central role.
 * 4. First login provisions an active local shadow user and exact active link transactionally.
 * 5. Inactive central identities, inactive local users, and inactive links fail closed and
 *    create or update nothing.
 * 6. Unknown, empty, multiple, or malformed central roles fail closed and create or update nothing.
 * 7. Sanitized errors: error messages are generic, sanitized, and reveal no sensitive
 *    tokens, secrets, credentials, or system paths.
 */
class SsoAuthorization
{
    public const ROLE_ADMIN = 'admin';
    public const ROLE_TECHNICIAN = 'technician';
    public const ROLE_VIEWER = 'viewer';

    /**
     * Approved central roles eligible for provisioning, synchronization, and authorization.
     */
    public const APPROVED_CENTRAL_ROLES = [
        self::ROLE_ADMIN,
        self::ROLE_VIEWER,
    ];

    /**
     * Complete list of valid Takeoff SSO roles accepted by authorization.
     */
    public const ALLOWED_ROLES = [
        self::ROLE_ADMIN,
        self::ROLE_VIEWER,
    ];

    /**
     * Alias for ALLOWED_ROLES to conform with contract conventions.
     */
    public const VALID_ROLES = self::ALLOWED_ROLES;

    private ?FederatedIdentityRepository $repository;

    /**
     * @param FederatedIdentityRepository|null $repository Accepted federated repository
     */
    public function __construct(?FederatedIdentityRepository $repository = null)
    {
        $this->repository = $repository;
    }

    /**
     * Returns the configured federated identity repository.
     */
    public function getRepository(): ?FederatedIdentityRepository
    {
        return $this->repository;
    }

    /**
     * Injects or overrides the federated identity repository.
     */
    public function setRepository(FederatedIdentityRepository $repository): void
    {
        $this->repository = $repository;
    }

    /**
     * Returns the array of accepted Takeoff local roles.
     *
     * @return array<string>
     */
    public function getValidRoles(): array
    {
        return self::ALLOWED_ROLES;
    }

    /**
     * Resolves, provisions, synchronizes, and authorizes an active central identity.
     *
     * Invariants enforced:
     * - Requires an explicitly active IdentityProfile (or valid claims array).
     * - Requires exactly one approved central role ('admin' or 'viewer').
     * - Fails closed on unknown, empty, multiple, or malformed central roles.
     * - Uses exact provider plus sub for identity resolution and linking.
     * - Synchronizes local shadow user's role to the approved central role.
     * - Inactive central, local, or link records fail closed and create or update nothing.
     * - Established session presentation uses central display name or username.
     * - External errors are generic and sanitized.
     *
     * @param mixed $profile Central identity (IdentityProfile instance or claims array)
     * @param FederatedIdentityRepository|null $repository Optional repository override
     * @return array{user_id: int, id: int, username: string, shadow_username: string, role: string, active: bool, provider: string, hub_user_id: string, sub: string, link_id: int, link_active: bool}
     * @throws InvalidArgumentException On missing profile, invalid arguments, or missing repository
     * @throws RuntimeException On inactive central user, unapproved/malformed role, inactive records, or failure
     */
    public function authorize(mixed $profile, ?FederatedIdentityRepository $repository = null): array
    {
        $repo = $repository ?? $this->repository;
        if ($repo === null) {
            throw new InvalidArgumentException('Federated identity repository is required for authorization.');
        }

        // Strict role payload validation if raw claims array provided
        if (is_array($profile) && array_key_exists('roles', $profile)) {
            if (!is_array($profile['roles']) || count($profile['roles']) !== 1) {
                throw new RuntimeException('SSO authorization failed: central identity must provide exactly one approved role.');
            }
            $rawRole = $profile['roles'][0];
            if (!is_string($rawRole) || trim($rawRole) === '') {
                throw new RuntimeException('SSO authorization failed: central role is malformed.');
            }
        }

        $identityProfile = $this->resolveProfileInstance($profile);

        // Invariant 1: Central identity must be explicitly active (fails closed)
        if (!$identityProfile->isActive()) {
            throw new RuntimeException('SSO authorization failed: central user account is inactive or disabled.');
        }

        // Invariant 2: Central identity must have exactly one approved role ('admin' or 'viewer')
        $roles = $identityProfile->getRoles();
        if (count($roles) !== 1) {
            throw new RuntimeException('SSO authorization failed: central identity must have exactly one approved role.');
        }

        $centralRole = $roles[0];
        if (!in_array($centralRole, self::APPROVED_CENTRAL_ROLES, true)) {
            throw new RuntimeException('SSO authorization failed: central role is unauthorized, unknown, or malformed.');
        }

        $provider = $identityProfile->getProvider();
        $sub = $identityProfile->getSub();

        // Invariant 3: Provision or synchronize shadow user using exact provider plus sub
        $resolvedUser = $repo->provisionOrSynchronize($provider, $sub, $centralRole);
        if ($resolvedUser === null) {
            throw new RuntimeException('SSO authorization failed: unmapped or inactive federated identity link.');
        }

        // Invariant 4: Verify active flags fail closed if explicitly present in resolved identity
        if (isset($resolvedUser['active']) && $resolvedUser['active'] !== true && $resolvedUser['active'] !== 1 && $resolvedUser['active'] !== '1') {
            throw new RuntimeException('SSO authorization failed: local user account is inactive.');
        }

        if (isset($resolvedUser['user_active']) && $resolvedUser['user_active'] !== true && $resolvedUser['user_active'] !== 1 && $resolvedUser['user_active'] !== '1') {
            throw new RuntimeException('SSO authorization failed: local user account is inactive.');
        }

        if (isset($resolvedUser['link_active']) && $resolvedUser['link_active'] !== true && $resolvedUser['link_active'] !== 1 && $resolvedUser['link_active'] !== '1') {
            throw new RuntimeException('SSO authorization failed: federated identity link is inactive.');
        }

        $userId = (int)($resolvedUser['user_id'] ?? $resolvedUser['id'] ?? 0);
        if ($userId <= 0) {
            throw new RuntimeException('SSO authorization failed: invalid local user identifier.');
        }

        $shadowUsername = isset($resolvedUser['username']) ? (string)$resolvedUser['username'] : '';
        if (trim($shadowUsername) === '') {
            throw new RuntimeException('SSO authorization failed: invalid local username.');
        }

        $rawSub = $resolvedUser['sub'] ?? null;
        if ($rawSub === null || (!is_string($rawSub) && !is_int($rawSub)) || trim((string)$rawSub) === '') {
            throw new RuntimeException('SSO authorization failed: resolved identity missing valid sub.');
        }

        // Presentation identity: use central display name or username if available; fallback to shadow username
        $displayName = $identityProfile->getDisplayName() ?? $identityProfile->getUsername();
        $presentationUsername = ($displayName !== null && trim($displayName) !== '')
            ? trim($displayName)
            : $shadowUsername;

        $linkId = (int)($resolvedUser['link_id'] ?? 0);

        return [
            'user_id' => $userId,
            'id' => $userId,
            'username' => $presentationUsername,
            'shadow_username' => $shadowUsername,
            'role' => $centralRole,
            'active' => true,
            'provider' => (string)$resolvedUser['provider'],
            'hub_user_id' => (string)$rawSub,
            'sub' => (string)$rawSub,
            'link_id' => $linkId,
            'link_active' => true,
        ];
    }

    /**
     * Resolves an IdentityProfile instance from either an IdentityProfile or raw claims array.
     *
     * @param mixed $profile
     * @return IdentityProfile
     * @throws InvalidArgumentException
     */
    private function resolveProfileInstance(mixed $profile): IdentityProfile
    {
        if ($profile instanceof IdentityProfile) {
            return $profile;
        }

        if (is_array($profile) && !empty($profile)) {
            return IdentityProfile::fromArray($profile);
        }

        throw new InvalidArgumentException('SSO authorization requires an IdentityProfile or valid claims array.');
    }

    /**
     * Checks if the identity is authorized, returning boolean true or false.
     * Fails closed without throwing exceptions.
     *
     * @param mixed $profile
     * @param FederatedIdentityRepository|null $repository
     * @return bool
     */
    public function isAuthorized(mixed $profile, ?FederatedIdentityRepository $repository = null): bool
    {
        try {
            $this->authorize($profile, $repository);
            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Attempts authorization, returning the authorized identity array or null on denial.
     * Fails closed without throwing exceptions.
     *
     * @param mixed $profile
     * @param FederatedIdentityRepository|null $repository
     * @return array|null
     */
    public function tryAuthorize(mixed $profile, ?FederatedIdentityRepository $repository = null): ?array
    {
        try {
            return $this->authorize($profile, $repository);
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Static convenience entry point for authorization.
     *
     * @param mixed $profile
     * @param FederatedIdentityRepository $repository
     * @return array
     */
    public static function authorizeIdentity(mixed $profile, FederatedIdentityRepository $repository): array
    {
        $instance = new self($repository);
        return $instance->authorize($profile);
    }

    /**
     * Checks if a given role is an approved central role ('admin' or 'viewer').
     *
     * @param string $role
     * @return bool
     */
    public static function isApprovedCentralRole(string $role): bool
    {
        return in_array(trim($role), self::APPROVED_CENTRAL_ROLES, true);
    }

    /**
     * Checks if a given role is one of the valid Takeoff SSO roles ('admin' or 'viewer').
     *
     * @param string $role
     * @return bool
     */
    public static function isAllowedRole(string $role): bool
    {
        return in_array(trim($role), self::ALLOWED_ROLES, true);
    }

    /**
     * Alias for isAllowedRole to conform with naming conventions.
     *
     * @param string $role
     * @return bool
     */
    public static function isValidRole(string $role): bool
    {
        return self::isAllowedRole($role);
    }

    /**
     * Sanitizes external error messages by redacting sensitive tokens, secrets,
     * credentials, and file system paths.
     *
     * @param string $message
     * @return string
     */
    public static function sanitizeError(string $message): string
    {
        $sanitized = $message;

        // Redact Windows and Unix file paths
        $sanitized = preg_replace('/[a-zA-Z]:\\\\[^\s\'"]+/i', '[REDACTED_PATH]', $sanitized) ?? $sanitized;
        $sanitized = preg_replace('/(?:\/[\w.-]+)+\/[\w.-]+\.php/i', '[REDACTED_PATH]', $sanitized) ?? $sanitized;

        // Redact tokens, secrets, codes, and credentials
        $sanitized = preg_replace('/(code|verifier|code_verifier|client_secret|access_token|refresh_token|password|secret)\s*=\s*[^\s&;]+/i', '$1=[REDACTED]', $sanitized) ?? $sanitized;
        $sanitized = preg_replace('/Bearer\s+[a-zA-Z0-9._~+\/-]+=*/i', 'Bearer [REDACTED]', $sanitized) ?? $sanitized;

        return trim($sanitized);
    }
}

// Global class alias for backward compatibility and flexible resolution
if (!class_exists('SsoAuthorization', false)) {
    class_alias(SsoAuthorization::class, 'SsoAuthorization');
}
