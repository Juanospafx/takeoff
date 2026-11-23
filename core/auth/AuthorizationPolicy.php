<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

/** Central application-role to capability policy. Project membership is enforced separately. */
final class AuthorizationPolicy
{
    public const ROLE_ADMIN = 'admin';
    public const ROLE_ESTIMATOR = 'estimator';
    public const ROLE_VIEWER = 'viewer';

    private const ROLE_CAPABILITIES = [
        self::ROLE_ADMIN => [
            'project.read', 'project.write', 'project.manage',
            'estimating.write', 'takeoff.write', 'documents.write', 'proposal.write',
            'catalog.manage', 'templates.manage', 'users.manage', 'won_project.approve',
        ],
        self::ROLE_ESTIMATOR => [
            'project.read', 'project.write',
            'estimating.write', 'takeoff.write', 'documents.write', 'proposal.write',
        ],
        self::ROLE_VIEWER => ['project.read'],
    ];

    public static function normalizeRole(mixed $role): string
    {
        return is_string($role) ? strtolower(trim($role)) : '';
    }

    public static function roles(): array
    {
        return array_keys(self::ROLE_CAPABILITIES);
    }

    public static function capabilitiesForRole(mixed $role): array
    {
        return self::ROLE_CAPABILITIES[self::normalizeRole($role)] ?? [];
    }

    public static function allows(mixed $role, string $capability): bool
    {
        $capability = trim($capability);
        return $capability !== ''
            && in_array($capability, self::capabilitiesForRole($role), true);
    }
}
