<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

use InvalidArgumentException;
use PDO;

/**
 * Repository for federated identity links in Takeoff SSO.
 *
 * Enforces strict persistence boundary security invariants:
 * 1. Prepared statements for all queries; zero string concatenation for values.
 * 2. Exact match on provider and hub_user_id.
 * 3. Resolves only when both the federated link is active (active = 1) AND
 *    the associated local user exists and is active (users.active = 1).
 * 4. Never auto-links by username or email.
 * 5. Assigns no default user or fallback role (e.g. no default 'admin').
 */
class FederatedIdentityRepository
{
    private PDO $pdo;
    private string $tableName;
    private string $usersTable;

    /**
     * @param PDO $pdo Active database connection
     * @param string $tableName Identity links table name (default 'sso_identity_links')
     * @param string $usersTable Local users table name (default 'users')
     */
    public function __construct(PDO $pdo, string $tableName = 'sso_identity_links', string $usersTable = 'users')
    {
        $this->pdo = $pdo;

        // Whitelist table identifiers to prevent identifier manipulation
        $this->tableName = preg_match('/^[a-zA-Z0-9_]+$/', $tableName) ? $tableName : 'sso_identity_links';
        $this->usersTable = preg_match('/^[a-zA-Z0-9_]+$/', $usersTable) ? $usersTable : 'users';
    }

    /**
     * Resolves an existing, active local user through an exact active provider plus hub_user_id link.
     *
     * Invariants:
     * - Returns an array representing the local user identity only if:
     *   a) An exact link exists matching provider AND hub_user_id.
     *   b) The link is active (active = 1).
     *   c) The associated local user exists.
     *   d) The local user is active (users.active = 1).
     * - Returns null if the link does not exist, either record is inactive, or user is missing.
     * - Never performs fallback lookup by email or username.
     * - Assigns no default role or fallback privileges.
     *
     * @param string $provider Identity provider identifier (e.g. 'hub')
     * @param string $hubUserId Central user identifier (hub_user_id)
     * @return array{user_id: int, id: int, username: string, role: string, active: bool, provider: string, hub_user_id: string, link_id: int, link_active: bool}|null
     * @throws InvalidArgumentException If provider or hub_user_id is empty
     */
    public function findActiveUser(string $provider, string $hubUserId): ?array
    {
        $trimmedProvider = trim($provider);
        $trimmedHubUserId = trim($hubUserId);

        if ($trimmedProvider === '') {
            throw new InvalidArgumentException('Provider cannot be empty.');
        }

        if ($trimmedHubUserId === '') {
            throw new InvalidArgumentException('hub_user_id cannot be empty.');
        }

        $sql = "SELECT
                    u.id AS user_id,
                    u.username,
                    u.role,
                    u.active AS user_active,
                    l.id AS link_id,
                    l.provider,
                    l.hub_user_id,
                    l.active AS link_active
                FROM {$this->tableName} l
                INNER JOIN {$this->usersTable} u ON u.id = l.user_id
                WHERE l.provider = :provider
                  AND l.hub_user_id = :hub_user_id
                  AND l.active = 1
                  AND u.active = 1
                LIMIT 1";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            ':provider' => $trimmedProvider,
            ':hub_user_id' => $trimmedHubUserId,
        ]);

        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }

        // Strict verification: link and local user active flags must be strictly active (1)
        if ((int)$row['link_active'] !== 1 || (int)$row['user_active'] !== 1) {
            return null;
        }

        // Strict verification: exact string match (defense against case-insensitive collation)
        if ($row['provider'] !== $trimmedProvider || (string)$row['hub_user_id'] !== $trimmedHubUserId) {
            return null;
        }

        // Return resolved local user identity without assigning any fallback or default role
        return [
            'user_id' => (int)$row['user_id'],
            'id' => (int)$row['user_id'],
            'username' => (string)$row['username'],
            'role' => (string)$row['role'],
            'active' => true,
            'provider' => (string)$row['provider'],
            'hub_user_id' => (string)$row['hub_user_id'],
            'sub' => (string)$row['hub_user_id'],
            'link_id' => (int)$row['link_id'],
            'link_active' => true,
        ];
    }

    /**
     * Alias for findActiveUser.
     */
    public function resolveActiveUser(string $provider, string $hubUserId): ?array
    {
        return $this->findActiveUser($provider, $hubUserId);
    }

    /**
     * Alias for findActiveUser.
     */
    public function findLinkedUser(string $provider, string $hubUserId): ?array
    {
        return $this->findActiveUser($provider, $hubUserId);
    }

    /**
     * Alias for findActiveUser.
     */
    public function resolveLocalUser(string $provider, string $hubUserId): ?array
    {
        return $this->findActiveUser($provider, $hubUserId);
    }

    /**
     * Alias for findActiveUser.
     */
    public function findActiveUserByFederatedIdentity(string $provider, string $hubUserId): ?array
    {
        return $this->findActiveUser($provider, $hubUserId);
    }

    /**
     * Resolves an IdentityProfile instance if active.
     *
     * @param IdentityProfile $profile
     * @return array|null
     */
    public function resolveProfile(IdentityProfile $profile): ?array
    {
        if (!$profile->isActive()) {
            return null;
        }

        return $this->findActiveUser($profile->getProvider(), $profile->getSub());
    }

    /**
     * Explicitly inserts an exact federated identity link for a known local user.
     * Never performs auto-linking by username or email.
     *
     * @param int $userId Local user ID
     * @param string $provider Provider identifier
     * @param string $hubUserId Hub user identifier
     * @param bool $active Initial link active state
     * @return bool
     * @throws InvalidArgumentException
     */
    public function createLink(int $userId, string $provider, string $hubUserId, bool $active = true): bool
    {
        if ($userId <= 0) {
            throw new InvalidArgumentException('User ID must be a positive integer.');
        }

        $trimmedProvider = trim($provider);
        $trimmedHubUserId = trim($hubUserId);

        if ($trimmedProvider === '' || $trimmedHubUserId === '') {
            throw new InvalidArgumentException('Provider and hub_user_id must not be empty.');
        }

        $sql = "INSERT INTO {$this->tableName}
                (user_id, provider, hub_user_id, active, created_at, updated_at)
                VALUES
                (:user_id, :provider, :hub_user_id, :active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)";

        $stmt = $this->pdo->prepare($sql);
        return $stmt->execute([
            ':user_id' => $userId,
            ':provider' => $trimmedProvider,
            ':hub_user_id' => $trimmedHubUserId,
            ':active' => $active ? 1 : 0,
        ]);
    }
}

// Global class alias for backward compatibility and flexible resolution
if (!class_exists('FederatedIdentityRepository', false)) {
    class_alias(FederatedIdentityRepository::class, 'FederatedIdentityRepository');
}
