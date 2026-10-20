<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

use InvalidArgumentException;
use PDO;
use RuntimeException;

/**
 * Repository for federated identity links in Takeoff SSO.
 *
 * Enforces strict persistence boundary security invariants:
 * 1. Prepared statements for all queries; zero string concatenation for values.
 * 2. Exact match on provider and hub_user_id (sub).
 * 3. Resolves only when both the federated link is active (active = 1) AND
 *    the associated local user exists and is active (users.active = 1).
 * 4. Never auto-links by username or email.
 * 5. Assigns no default user or fallback role.
 * 6. Transactionally provisions local shadow user and exact link on first login with
 *    deterministic collision-resistant username and unrecoverable random password hash.
 * 7. Synchronizes local role to central approved role on repeat login while keeping
 *    immutable link unchanged.
 * 8. Resolves concurrent first-login races safely without duplicate identities or elevation.
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
     * @param string $hubUserId Central user identifier (hub_user_id / sub)
     * @return array{user_id: int, id: int, username: string, role: string, active: bool, provider: string, hub_user_id: string, sub: string, link_id: int, link_active: bool}|null
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

        try {
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
        } catch (InvalidArgumentException $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new RuntimeException('SSO federated identity lookup failed.');
        }
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
     * Finds an exact federated identity link and joined local user without active filtering.
     * Used to determine whether a link exists, and whether existing link/user records are inactive.
     * Never performs fallback lookup by email or username.
     *
     * @param string $provider Identity provider identifier
     * @param string $hubUserId Central user identifier (hub_user_id or sub)
     * @return array{user_id: int, id: int, username: string, role: string, active: bool, user_active: int, provider: string, hub_user_id: string, sub: string, link_id: int, link_active: int}|null
     * @throws InvalidArgumentException If provider or hub_user_id is empty
     */
    public function findExactLink(string $provider, string $hubUserId): ?array
    {
        $trimmedProvider = trim($provider);
        $trimmedHubUserId = trim($hubUserId);

        if ($trimmedProvider === '') {
            throw new InvalidArgumentException('Provider cannot be empty.');
        }

        if ($trimmedHubUserId === '') {
            throw new InvalidArgumentException('hub_user_id cannot be empty.');
        }

        try {
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

            // Strict verification: exact string match (defense against case-insensitive collation)
            if ($row['provider'] !== $trimmedProvider || (string)$row['hub_user_id'] !== $trimmedHubUserId) {
                return null;
            }

            $isLinkActive = ((int)$row['link_active'] === 1);
            $isUserActive = ((int)$row['user_active'] === 1);

            return [
                'user_id' => (int)$row['user_id'],
                'id' => (int)$row['user_id'],
                'username' => (string)$row['username'],
                'role' => (string)$row['role'],
                'active' => ($isLinkActive && $isUserActive),
                'user_active' => (int)$row['user_active'],
                'provider' => (string)$row['provider'],
                'hub_user_id' => (string)$row['hub_user_id'],
                'sub' => (string)$row['hub_user_id'],
                'link_id' => (int)$row['link_id'],
                'link_active' => (int)$row['link_active'],
            ];
        } catch (InvalidArgumentException $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new RuntimeException('SSO federated identity lookup failed.');
        }
    }

    /**
     * Synchronizes a local shadow user's role to match the approved central role.
     * Leaves the immutable federated identity link unchanged.
     *
     * @param int $userId Local user ID
     * @param string $role Central approved role to synchronize
     * @return bool
     * @throws InvalidArgumentException
     */
    public function synchronizeUserRole(int $userId, string $role): bool
    {
        if ($userId <= 0) {
            throw new InvalidArgumentException('User ID must be a positive integer.');
        }

        $trimmedRole = trim($role);
        if ($trimmedRole === '') {
            throw new InvalidArgumentException('Role cannot be empty.');
        }

        try {
            $sql = "UPDATE {$this->usersTable}
                    SET role = :role, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :id";

            $stmt = $this->pdo->prepare($sql);
            return $stmt->execute([
                ':role' => $trimmedRole,
                ':id' => $userId,
            ]);
        } catch (InvalidArgumentException $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new RuntimeException('SSO user role synchronization failed.');
        }
    }

    /**
     * Derives a deterministic collision-resistant local shadow username from provider plus sub.
     *
     * @param string $provider
     * @param string $sub
     * @return string
     */
    public static function deriveShadowUsername(string $provider, string $sub): string
    {
        $hash = hash('sha256', trim($provider) . ':' . trim($sub));
        return 'sso_' . substr($hash, 0, 32);
    }

    /**
     * Generates an unrecoverable random local password hash.
     * Never returned, logged, or stored in session. Prevents local-login fallback.
     *
     * @return string
     */
    private function generateUnrecoverablePasswordHash(): string
    {
        return password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT);
    }

    /**
     * Transactionally provisions a new active local shadow user and exact active federated link.
     * Resolves concurrent first-login races by re-reading the exact link.
     *
     * @param string $provider Identity provider identifier
     * @param string $sub Central user subject identifier
     * @param string $role Approved central role ('admin' or 'viewer')
     * @return array{user_id: int, id: int, username: string, role: string, active: bool, provider: string, hub_user_id: string, sub: string, link_id: int, link_active: bool}
     * @throws InvalidArgumentException If arguments are empty
     * @throws RuntimeException If provisioning fails or inactive records encountered
     */
    public function provisionShadowUser(string $provider, string $sub, string $role): array
    {
        $trimmedProvider = trim($provider);
        $trimmedSub = trim($sub);
        $trimmedRole = trim($role);

        if ($trimmedProvider === '') {
            throw new InvalidArgumentException('Provider cannot be empty.');
        }

        if ($trimmedSub === '') {
            throw new InvalidArgumentException('sub cannot be empty.');
        }

        if ($trimmedRole === '') {
            throw new InvalidArgumentException('Role cannot be empty.');
        }

        $derivedUsername = self::deriveShadowUsername($trimmedProvider, $trimmedSub);
        $passwordHash = $this->generateUnrecoverablePasswordHash();

        $inTransaction = false;
        try {
            if (!$this->pdo->inTransaction()) {
                $this->pdo->beginTransaction();
                $inTransaction = true;
            }

            // Insert active local shadow user
            $userSql = "INSERT INTO {$this->usersTable}
                        (username, password, role, active, created_at, updated_at)
                        VALUES
                        (:username, :password, :role, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)";
            $userStmt = $this->pdo->prepare($userSql);
            $userStmt->execute([
                ':username' => $derivedUsername,
                ':password' => $passwordHash,
                ':role' => $trimmedRole,
            ]);

            $userId = (int)$this->pdo->lastInsertId();

            // Insert exact active federated link
            $linkSql = "INSERT INTO {$this->tableName}
                        (user_id, provider, hub_user_id, active, created_at, updated_at)
                        VALUES
                        (:user_id, :provider, :hub_user_id, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)";
            $linkStmt = $this->pdo->prepare($linkSql);
            $linkStmt->execute([
                ':user_id' => $userId,
                ':provider' => $trimmedProvider,
                ':hub_user_id' => $trimmedSub,
            ]);

            $linkId = (int)$this->pdo->lastInsertId();

            if ($inTransaction) {
                $this->pdo->commit();
            }

            return [
                'user_id' => $userId,
                'id' => $userId,
                'username' => $derivedUsername,
                'role' => $trimmedRole,
                'active' => true,
                'provider' => $trimmedProvider,
                'hub_user_id' => $trimmedSub,
                'sub' => $trimmedSub,
                'link_id' => $linkId,
                'link_active' => true,
            ];
        } catch (\Throwable $e) {
            if ($inTransaction && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            // Concurrent first-login races resolve by re-reading the exact provider plus sub link
            try {
                $existing = $this->findActiveUser($trimmedProvider, $trimmedSub);
                if ($existing !== null) {
                    // Link was created concurrently by winning request; synchronize role if needed
                    if ($existing['role'] !== $trimmedRole) {
                        $this->synchronizeUserRole($existing['user_id'], $trimmedRole);
                        $existing['role'] = $trimmedRole;
                    }
                    return $existing;
                }

                // Inactive link or user must fail closed
                $inactiveLink = $this->findExactLink($trimmedProvider, $trimmedSub);
                if ($inactiveLink !== null) {
                    throw new RuntimeException('SSO authorization failed: federated identity link or user account is inactive.');
                }
            } catch (RuntimeException $re) {
                if (str_contains($re->getMessage(), 'inactive')) {
                    throw $re;
                }
            }

            throw new RuntimeException('SSO shadow user provisioning failed.');
        }
    }

    /**
     * Provisions or synchronizes a Takeoff shadow user from an active central identity.
     *
     * Invariants:
     * - Uses exact provider plus sub only; username and email are never used for lookup or linking.
     * - If active link exists, synchronizes local user's role to central role and keeps link unchanged.
     * - If link or user is inactive, fails closed.
     * - If no link exists, creates shadow user and link transactionally.
     * - Concurrent races re-read exact link and never duplicate identities or elevate privileges.
     *
     * @param string $provider Identity provider identifier
     * @param string $sub Central subject identifier
     * @param string $role Approved central role ('admin' or 'viewer')
     * @return array{user_id: int, id: int, username: string, role: string, active: bool, provider: string, hub_user_id: string, sub: string, link_id: int, link_active: bool}
     * @throws InvalidArgumentException On empty arguments
     * @throws RuntimeException On inactive records or failure
     */
    public function provisionOrSynchronize(string $provider, string $sub, string $role): array
    {
        $trimmedProvider = trim($provider);
        $trimmedSub = trim($sub);
        $trimmedRole = trim($role);

        if ($trimmedProvider === '') {
            throw new InvalidArgumentException('Provider cannot be empty.');
        }

        if ($trimmedSub === '') {
            throw new InvalidArgumentException('sub cannot be empty.');
        }

        if ($trimmedRole === '') {
            throw new InvalidArgumentException('Role cannot be empty.');
        }

        // 1. Check if exact link exists (active or inactive)
        $existingLink = $this->findExactLink($trimmedProvider, $trimmedSub);
        if ($existingLink !== null) {
            // Inactive local user or inactive federated link must fail closed
            if ((int)$existingLink['link_active'] !== 1) {
                throw new RuntimeException('SSO authorization failed: federated identity link is inactive.');
            }
            if ((int)$existingLink['user_active'] !== 1) {
                throw new RuntimeException('SSO authorization failed: local user account is inactive.');
            }

            // Synchronize local role to approved central role; keep immutable link unchanged
            if ($existingLink['role'] !== $trimmedRole) {
                $this->synchronizeUserRole($existingLink['user_id'], $trimmedRole);
                $existingLink['role'] = $trimmedRole;
            }

            return [
                'user_id' => $existingLink['user_id'],
                'id' => $existingLink['user_id'],
                'username' => $existingLink['username'],
                'role' => $trimmedRole,
                'active' => true,
                'provider' => $existingLink['provider'],
                'hub_user_id' => $existingLink['hub_user_id'],
                'sub' => $existingLink['sub'],
                'link_id' => $existingLink['link_id'],
                'link_active' => true,
            ];
        }

        // 2. First login: provision local shadow user and exact link transactionally
        return $this->provisionShadowUser($trimmedProvider, $trimmedSub, $trimmedRole);
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

        try {
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
        } catch (InvalidArgumentException $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new RuntimeException('SSO federated identity link creation failed.');
        }
    }
}

// Global class alias for backward compatibility and flexible resolution
if (!class_exists('FederatedIdentityRepository', false)) {
    class_alias(FederatedIdentityRepository::class, 'FederatedIdentityRepository');
}
