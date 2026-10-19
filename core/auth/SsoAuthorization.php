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
 * 1. Fail-closed: requires an explicitly active IdentityProfile and an exact active
 *    provider plus hub_user_id federated link resolved by FederatedIdentityRepository.
 * 2. Role preservation: preserves the persisted local role exactly; central userinfo roles
 *    never grant, map, or elevate local access.
 * 3. Role whitelist: accepts only valid Takeoff roles: 'admin', 'technician', 'viewer'.
 * 4. Zero default fallback: no missing, unknown, misspelled or central role can become
 *    admin or receive a default or fallback role.
 * 5. Sanitized errors: error messages are generic, sanitized, and reveal no sensitive
 *    tokens, secrets, credentials, or system paths.
 */
class SsoAuthorization
{
    public const ROLE_ADMIN = 'admin';
    public const ROLE_TECHNICIAN = 'technician';
    public const ROLE_VIEWER = 'viewer';

    /**
     * Complete list of valid local Takeoff roles accepted by authorization.
     */
    public const ALLOWED_ROLES = [
        self::ROLE_ADMIN,
        self::ROLE_TECHNICIAN,
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
     * Resolves and authorizes an active central identity against local persistence.
     *
     * Invariants enforced:
     * - Requires an explicitly active IdentityProfile (or valid claims array).
     * - Requires an exact active provider plus hub_user_id federated link.
     * - Requires an associated active local user.
     * - Requires an explicit local role strictly matching admin, technician, or viewer.
     * - Central userinfo roles never grant or elevate local access.
     * - No missing, unknown, or misspelled role can become admin or receive a default role.
     * - External errors are generic and sanitized.
     *
     * @param mixed $profile Central identity (IdentityProfile instance or claims array)
     * @param FederatedIdentityRepository|null $repository Optional repository override
     * @return array{user_id: int, id: int, username: string, role: string, active: bool, provider: string, hub_user_id: string, link_id: int, link_active: bool}
     * @throws InvalidArgumentException On missing profile, invalid arguments, or missing repository
     * @throws RuntimeException On inactive central user, unmapped link, inactive user, or unauthorized role
     */
    public function authorize(mixed $profile, ?FederatedIdentityRepository $repository = null): array
    {
        $repo = $repository ?? $this->repository;
        if ($repo === null) {
            throw new InvalidArgumentException('Federated identity repository is required for authorization.');
        }

        $identityProfile = $this->resolveProfileInstance($profile);

        // Invariant 1: Central identity must be explicitly active (fails closed)
        if (!$identityProfile->isActive()) {
            throw new RuntimeException('SSO authorization failed: central user account is inactive or disabled.');
        }

        // Invariant 2: Exact active link and active local user resolved via FederatedIdentityRepository
        $resolvedUser = $repo->findActiveUser($identityProfile->getProvider(), $identityProfile->getSub());
        if ($resolvedUser === null) {
            throw new RuntimeException('SSO authorization failed: unmapped or inactive federated identity link.');
        }

        // Verify active flags fail closed if explicitly present in resolved identity
        if (isset($resolvedUser['active']) && $resolvedUser['active'] !== true && $resolvedUser['active'] !== 1 && $resolvedUser['active'] !== '1') {
            throw new RuntimeException('SSO authorization failed: local user account is inactive.');
        }

        if (isset($resolvedUser['user_active']) && $resolvedUser['user_active'] !== true && $resolvedUser['user_active'] !== 1 && $resolvedUser['user_active'] !== '1') {
            throw new RuntimeException('SSO authorization failed: local user account is inactive.');
        }

        if (isset($resolvedUser['link_active']) && $resolvedUser['link_active'] !== true && $resolvedUser['link_active'] !== 1 && $resolvedUser['link_active'] !== '1') {
            throw new RuntimeException('SSO authorization failed: federated identity link is inactive.');
        }

        // Invariant 3: Preserved local role must be explicit, non-empty, and strictly in ALLOWED_ROLES
        $rawRole = $resolvedUser['role'] ?? null;
        if (!is_string($rawRole) || trim($rawRole) === '') {
            throw new RuntimeException('SSO authorization failed: local user has no explicit role assigned.');
        }

        $localRole = trim($rawRole);
        if (!in_array($localRole, self::ALLOWED_ROLES, true)) {
            throw new RuntimeException('SSO authorization failed: local role is unauthorized, unknown, or misspelled.');
        }

        // Invariant 4: Central userinfo roles never grant or elevate local access.
        // The returned identity preserves the persisted local role exactly.
        $userId = (int)($resolvedUser['user_id'] ?? $resolvedUser['id'] ?? 0);
        if ($userId <= 0) {
            throw new RuntimeException('SSO authorization failed: invalid local user identifier.');
        }

        $username = isset($resolvedUser['username']) ? (string)$resolvedUser['username'] : '';
        if (trim($username) === '') {
            throw new RuntimeException('SSO authorization failed: invalid local username.');
        }

        $rawSub = $resolvedUser['sub'] ?? null;
        if ($rawSub === null || (!is_string($rawSub) && !is_int($rawSub)) || trim((string)$rawSub) === '') {
            throw new RuntimeException('SSO authorization failed: resolved identity missing valid sub.');
        }

        $provider = (string)$resolvedUser['provider'];
        $sub = trim((string)$rawSub);
        $linkId = (int)($resolvedUser['link_id'] ?? 0);

        return [
            'user_id' => $userId,
            'id' => $userId,
            'username' => $username,
            'role' => $localRole,
            'active' => true,
            'provider' => $provider,
            'hub_user_id' => $sub,
            'sub' => $sub,
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
     * Checks if a given role is one of the valid Takeoff local roles.
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
