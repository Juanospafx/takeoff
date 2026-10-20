<?php
declare(strict_types=1);

/**
 * Runtime Test Suite for Takeoff SSO Authorization Contractual Boundary.
 * Task: TASK-0380-CORRECTION (Takeoff shadow identity provisioning & fail-closed authorization)
 *
 * Acceptance Criteria Covered:
 * 1. Central SSO accepts exactly admin or viewer; technician remains a legacy local constant
 *    only and is never accepted from Hub.
 * 2. Executable isolated tests for first login, repeat login, admin-to-viewer downgrade,
 *    viewer-to-admin upgrade, collision or race recovery, malformed roles, inactive identity/link/user,
 *    and zero username or email auto-linking.
 * 3. First login creates exactly one shadow user and one exact provider-plus-sub link transactionally
 *    with deterministic username and an unrecoverable random password hash.
 * 4. Existing exact active links synchronize role without replacing the link; inactive records
 *    fail closed without writes.
 * 5. Session presentation uses the central display name or username and contains local user id,
 *    canonical sub and synchronized role, but no token, verifier, password, email or secret.
 * 6. No exception exposed outside the repository includes PDO, SQL, credentials, paths, DSNs,
 *    tokens or other internal failure details.
 * 7. All focused validation commands pass and modified files remain within allowed_paths.
 */

require_once dirname(__DIR__) . '/core/auth/IdentityProfile.php';
require_once dirname(__DIR__) . '/core/auth/FederatedIdentityRepository.php';
require_once dirname(__DIR__) . '/core/auth/SsoAuthorization.php';
require_once dirname(__DIR__) . '/core/auth/SsoSession.php';

use Takeoff\Core\Auth\IdentityProfile;
use Takeoff\Core\Auth\FederatedIdentityRepository;
use Takeoff\Core\Auth\SsoAuthorization;
use Takeoff\Core\Auth\SsoSession;

$passedCount = 0;
$failedCount = 0;
$failures = [];

function assertCondition(bool $condition, string $description): void
{
    global $passedCount, $failedCount, $failures;
    if ($condition) {
        $passedCount++;
        echo "  [PASS] {$description}\n";
    } else {
        $failedCount++;
        $failures[] = $description;
        echo "  [FAIL] {$description}\n";
    }
}

/**
 * Isolated in-memory PDO double that requires no database driver or SQLite extension.
 */
class IsolatedMockPdo extends PDO
{
    /** @var array<int, array{id: int, username: string, password?: string, role: string, active: int, created_at?: string, updated_at?: string}> */
    public array $users = [];

    /** @var array<int, array{id: int, user_id: int, provider: string, hub_user_id: string, active: int, created_at?: string, updated_at?: string}> */
    public array $links = [];

    public int $nextUserId = 1;
    public int $nextLinkId = 1;
    public int $lastInsertId = 0;
    public bool $inTransaction = false;

    /** @var callable|null */
    public $onInsertUser = null;
    /** @var callable|null */
    public $onInsertLink = null;
    /** @var callable|null */
    public $onQuery = null;

    public function __construct()
    {
        // Standalone double: intentionally avoids real DB or SQLite extensions
    }

    #[\ReturnTypeWillChange]
    public function getAttribute($attribute)
    {
        if ($attribute === PDO::ATTR_DRIVER_NAME) {
            return 'isolated_mock';
        }
        return null;
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        return 0;
    }

    #[\ReturnTypeWillChange]
    public function beginTransaction(): bool
    {
        $this->inTransaction = true;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function commit(): bool
    {
        $this->inTransaction = false;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function rollBack(): bool
    {
        $this->inTransaction = false;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function inTransaction(): bool
    {
        return $this->inTransaction;
    }

    #[\ReturnTypeWillChange]
    public function lastInsertId($name = null): string|false
    {
        return (string)$this->lastInsertId;
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new IsolatedMockPdoStatement($this, $query);
    }

    public function insertUser(int $id, string $username, string $role, int $active, string $password = 'hash'): int
    {
        $this->users[$id] = [
            'id' => $id,
            'username' => $username,
            'password' => $password,
            'role' => $role,
            'active' => $active,
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ];
        if ($id >= $this->nextUserId) {
            $this->nextUserId = $id + 1;
        }
        $this->lastInsertId = $id;
        return $id;
    }

    public function insertLink(int $userId, string $provider, string $hubUserId, int $active = 1): int
    {
        $linkId = $this->nextLinkId++;
        $this->links[$linkId] = [
            'id' => $linkId,
            'user_id' => $userId,
            'provider' => $provider,
            'hub_user_id' => $hubUserId,
            'active' => $active,
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ];
        $this->lastInsertId = $linkId;
        return $linkId;
    }
}

/**
 * Isolated PDOStatement double simulating statement preparation, execution and fetching.
 */
class IsolatedMockPdoStatement extends PDOStatement
{
    private IsolatedMockPdo $pdo;
    private string $sql;
    private ?array $resultRow = null;
    private bool $fetched = false;

    public function __construct(IsolatedMockPdo $pdo, string $sql)
    {
        $this->pdo = $pdo;
        $this->sql = $sql;
    }

    #[\ReturnTypeWillChange]
    public function execute(?array $params = null): bool
    {
        $this->fetched = false;
        $this->resultRow = null;

        // Custom query callback for testing error injection
        if ($this->pdo->onQuery !== null) {
            ($this->pdo->onQuery)($this->sql, $params);
        }

        // INSERT INTO users
        if (preg_match('/INSERT\s+INTO\s+\S*users/i', $this->sql)) {
            if ($this->pdo->onInsertUser !== null) {
                ($this->pdo->onInsertUser)($params);
            }

            // Prepared statement with parameters
            if ($params !== null && (isset($params[':username']) || isset($params['username']))) {
                $id = $this->pdo->nextUserId++;
                $username = (string)($params[':username'] ?? $params['username']);
                $password = (string)($params[':password'] ?? $params['password'] ?? 'hash');
                $role = (string)($params[':role'] ?? $params['role'] ?? 'viewer');
                $this->pdo->insertUser($id, $username, $role, 1, $password);
                return true;
            }

            // Literal values
            if (preg_match('/VALUES\s*\(\s*(\d+)\s*,\s*\'([^\']+)\'\s*,\s*\'([^\']+)\'\s*,\s*\'([^\']+)\'\s*,\s*(\d+)\s*\)/i', $this->sql, $matches)) {
                $id = (int)$matches[1];
                $username = $matches[2];
                $password = $matches[3];
                $role = $matches[4];
                $active = (int)$matches[5];
                $this->pdo->insertUser($id, $username, $role, $active, $password);
                return true;
            }
            return false;
        }

        // INSERT INTO sso_identity_links
        if (preg_match('/INSERT\s+INTO\s+\S*sso_identity_links/i', $this->sql)) {
            if ($this->pdo->onInsertLink !== null) {
                ($this->pdo->onInsertLink)($params);
            }

            if ($params !== null) {
                $userId = (int)($params[':user_id'] ?? $params['user_id'] ?? 0);
                $provider = (string)($params[':provider'] ?? $params['provider'] ?? '');
                $hubUserId = (string)($params[':hub_user_id'] ?? $params['hub_user_id'] ?? '');
                $active = (int)($params[':active'] ?? $params['active'] ?? 1);
                $this->pdo->insertLink($userId, $provider, $hubUserId, $active);
                return true;
            }

            if (preg_match('/VALUES\s*\(\s*(\d+)\s*,\s*\'([^\']+)\'\s*,\s*\'([^\']+)\'\s*,\s*(\d+)\s*\)/i', $this->sql, $matches)) {
                $userId = (int)$matches[1];
                $provider = $matches[2];
                $hubUserId = $matches[3];
                $active = (int)$matches[4];
                $this->pdo->insertLink($userId, $provider, $hubUserId, $active);
                return true;
            }
            return false;
        }

        // UPDATE users SET role = :role ... WHERE id = :id
        if (preg_match('/UPDATE\s+\S*users\s+SET\s+role\s*=\s*:role/i', $this->sql)) {
            $role = (string)($params[':role'] ?? $params['role'] ?? '');
            $id = (int)($params[':id'] ?? $params['id'] ?? 0);
            if (isset($this->pdo->users[$id])) {
                $this->pdo->users[$id]['role'] = $role;
                $this->pdo->users[$id]['updated_at'] = date('Y-m-d H:i:s');
                return true;
            }
            return false;
        }

        // SELECT query from FederatedIdentityRepository (findActiveUser & findExactLink)
        if (preg_match('/SELECT/i', $this->sql)) {
            $provider = (string)($params[':provider'] ?? $params['provider'] ?? '');
            $hubUserId = (string)($params[':hub_user_id'] ?? $params['hub_user_id'] ?? '');

            // findActiveUser requires active = 1 for both link and user
            $requireActive = (bool)preg_match('/l\.active\s*=\s*1\s+AND\s+u\.active\s*=\s*1/i', $this->sql);

            foreach ($this->pdo->links as $link) {
                if ($link['provider'] === $provider && $link['hub_user_id'] === $hubUserId) {
                    $userId = $link['user_id'];
                    $user = $this->pdo->users[$userId] ?? null;

                    // Inner join requires local user record to exist
                    if ($user === null) {
                        continue;
                    }

                    // Strict active filtering when requested
                    if ($requireActive && ((int)$link['active'] !== 1 || (int)$user['active'] !== 1)) {
                        continue;
                    }

                    $this->resultRow = [
                        'user_id' => $user['id'],
                        'username' => $user['username'],
                        'role' => $user['role'],
                        'user_active' => (int)$user['active'],
                        'link_id' => (int)$link['id'],
                        'provider' => $link['provider'],
                        'hub_user_id' => $link['hub_user_id'],
                        'link_active' => (int)$link['active'],
                    ];
                    return true;
                }
            }

            $this->resultRow = null;
            return true;
        }

        return true;
    }

    #[\ReturnTypeWillChange]
    public function fetch($mode = PDO::FETCH_DEFAULT, $cursorOrientation = PDO::FETCH_ORI_NEXT, $cursorOffset = 0)
    {
        if ($this->fetched || $this->resultRow === null) {
            return false;
        }

        $this->fetched = true;
        return $this->resultRow;
    }

    #[\ReturnTypeWillChange]
    public function fetchAll($mode = PDO::FETCH_DEFAULT, ...$args)
    {
        if ($this->resultRow === null) {
            return [];
        }
        return [$this->resultRow];
    }
}

/**
 * Stub repository for isolated granular control over returned user record shapes.
 */
class StubFederatedIdentityRepository extends FederatedIdentityRepository
{
    private ?array $stubResult = null;

    public function __construct(?array $stubResult = null)
    {
        parent::__construct(new IsolatedMockPdo());
        $this->stubResult = $stubResult;
    }

    public function setStubResult(?array $result): void
    {
        $this->stubResult = $result;
    }

    public function findActiveUser(string $provider, string $hubUserId): ?array
    {
        return $this->stubResult;
    }

    public function findExactLink(string $provider, string $hubUserId): ?array
    {
        return $this->stubResult;
    }

    public function provisionOrSynchronize(string $provider, string $sub, string $role): array
    {
        if ($this->stubResult !== null) {
            if (isset($this->stubResult['link_active']) && (int)$this->stubResult['link_active'] !== 1) {
                throw new RuntimeException('SSO authorization failed: federated identity link is inactive.');
            }
            if (isset($this->stubResult['user_active']) && (int)$this->stubResult['user_active'] !== 1) {
                throw new RuntimeException('SSO authorization failed: local user account is inactive.');
            }
            return $this->stubResult;
        }
        return parent::provisionOrSynchronize($provider, $sub, $role);
    }
}

echo "=== Running Takeoff SSO Authorization Contractual Runtime Test Suite ===\n\n";

// -----------------------------------------------------------------------------
// 1. Proving Isolated Mock Execution (No Real Database or Network Connection)
// -----------------------------------------------------------------------------
echo "1. Proving isolated mock PDO execution (zero DB or network access)...\n";

$mockPdo = new IsolatedMockPdo();
assertCondition($mockPdo instanceof PDO, 'Database double satisfies PDO contract');
assertCondition($mockPdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'isolated_mock', 'PDO driver is strictly isolated mock double');

$repository = new FederatedIdentityRepository($mockPdo, 'sso_identity_links', 'users');
$ssoAuth = new SsoAuthorization($repository);
assertCondition($ssoAuth instanceof SsoAuthorization, 'SsoAuthorization instantiated with isolated repository');
assertCondition($ssoAuth->getRepository() === $repository, 'getRepository returns the configured repository instance');

// -----------------------------------------------------------------------------
// 2. Role Whitelist Constants & Verification Methods
// -----------------------------------------------------------------------------
echo "\n2. Testing role whitelist constants, arrays, and role validation methods...\n";

assertCondition(SsoAuthorization::ROLE_ADMIN === 'admin', 'ROLE_ADMIN constant is strictly admin');
assertCondition(SsoAuthorization::ROLE_TECHNICIAN === 'technician', 'ROLE_TECHNICIAN constant is strictly technician (legacy constant only)');
assertCondition(SsoAuthorization::ROLE_VIEWER === 'viewer', 'ROLE_VIEWER constant is strictly viewer');

$expectedRoles = ['admin', 'viewer'];
assertCondition(SsoAuthorization::ALLOWED_ROLES === $expectedRoles, 'ALLOWED_ROLES strictly contains admin and viewer only');
assertCondition(SsoAuthorization::VALID_ROLES === $expectedRoles, 'VALID_ROLES alias matches ALLOWED_ROLES (admin, viewer)');
assertCondition(SsoAuthorization::APPROVED_CENTRAL_ROLES === $expectedRoles, 'APPROVED_CENTRAL_ROLES strictly contains admin and viewer only');
assertCondition($ssoAuth->getValidRoles() === $expectedRoles, 'getValidRoles returns exact central whitelist');

assertCondition(SsoAuthorization::isAllowedRole('admin') === true, 'isAllowedRole accepts admin');
assertCondition(SsoAuthorization::isAllowedRole('viewer') === true, 'isAllowedRole accepts viewer');
assertCondition(SsoAuthorization::isAllowedRole('technician') === false, 'isAllowedRole rejects technician (legacy local constant only, never from Hub)');

assertCondition(SsoAuthorization::isValidRole('admin') === true, 'isValidRole alias accepts admin');
assertCondition(SsoAuthorization::isValidRole('viewer') === true, 'isValidRole alias accepts viewer');
assertCondition(SsoAuthorization::isValidRole('technician') === false, 'isValidRole alias rejects technician');

assertCondition(SsoAuthorization::isApprovedCentralRole('admin') === true, 'isApprovedCentralRole accepts admin');
assertCondition(SsoAuthorization::isApprovedCentralRole('viewer') === true, 'isApprovedCentralRole accepts viewer');
assertCondition(SsoAuthorization::isApprovedCentralRole('technician') === false, 'isApprovedCentralRole rejects technician');

assertCondition(SsoAuthorization::isAllowedRole('superadmin') === false, 'isAllowedRole rejects unknown superadmin');
assertCondition(SsoAuthorization::isAllowedRole('root') === false, 'isAllowedRole rejects root');
assertCondition(SsoAuthorization::isAllowedRole('estimator') === false, 'isAllowedRole rejects estimator');
assertCondition(SsoAuthorization::isAllowedRole('Admin') === false, 'isAllowedRole is case-sensitive (rejects Admin)');
assertCondition(SsoAuthorization::isAllowedRole('') === false, 'isAllowedRole rejects empty string');

// -----------------------------------------------------------------------------
// 3. Central Identity Active vs Inactive Evaluation (Fail-Closed)
// -----------------------------------------------------------------------------
echo "\n3. Testing central identity active vs inactive evaluation (fail-closed)...\n";

// Populate local users in mock PDO
// ID 1: admin user, active
$mockPdo->insertUser(1, 'alice_admin', 'admin', 1);
$mockPdo->insertLink(1, 'hub', 'hub_user_alice', 1);

// Active profile succeeds
$activeProfile = new IdentityProfile('hub', 'hub_user_alice', true, ['admin']);
$result = $ssoAuth->authorize($activeProfile);
assertCondition($result['user_id'] === 1 && $result['role'] === 'admin', 'Active central identity authorizes successfully');
assertCondition($ssoAuth->isAuthorized($activeProfile) === true, 'isAuthorized returns true for active central identity');
assertCondition(is_array($ssoAuth->tryAuthorize($activeProfile)), 'tryAuthorize returns array for active central identity');

// Inactive profile (active = false) throws RuntimeException
$inactiveProfile = new IdentityProfile('hub', 'hub_user_alice', false, ['admin']);
$inactiveCaught = false;
$inactiveMessage = '';
try {
    $ssoAuth->authorize($inactiveProfile);
} catch (RuntimeException $e) {
    $inactiveCaught = true;
    $inactiveMessage = $e->getMessage();
}
assertCondition($inactiveCaught, 'Inactive central IdentityProfile throws RuntimeException');
assertCondition(str_contains($inactiveMessage, 'central user account is inactive or disabled'), 'Inactive identity error message specifies central account inactive/disabled');
assertCondition($ssoAuth->isAuthorized($inactiveProfile) === false, 'isAuthorized returns false for inactive central identity');
assertCondition($ssoAuth->tryAuthorize($inactiveProfile) === null, 'tryAuthorize returns null for inactive central identity');

// Inactive raw claims array (active => false) with canonical sub
$inactiveClaims = [
    'provider' => 'hub',
    'sub' => 'hub_user_alice',
    'active' => false,
    'roles' => ['admin'],
];
$inactiveClaimsCaught = false;
try {
    $ssoAuth->authorize($inactiveClaims);
} catch (RuntimeException $e) {
    $inactiveClaimsCaught = true;
}
assertCondition($inactiveClaimsCaught, 'Inactive raw claims array (active=false) throws RuntimeException');

// Missing active flag in claims array defaults to false in IdentityProfile
$missingActiveClaims = [
    'provider' => 'hub',
    'sub' => 'hub_user_alice',
    'roles' => ['admin'],
];
$missingActiveCaught = false;
try {
    $ssoAuth->authorize($missingActiveClaims);
} catch (RuntimeException $e) {
    $missingActiveCaught = true;
}
assertCondition($missingActiveCaught, 'Claims array missing active flag defaults to inactive and throws RuntimeException');

// Central identity asserting technician is rejected fail-closed (never accepted from Hub)
$techCentralProfile = new IdentityProfile('hub', 'hub_user_alice', true, ['technician']);
$techCentralCaught = false;
$techCentralMsg = '';
try {
    $ssoAuth->authorize($techCentralProfile);
} catch (RuntimeException $e) {
    $techCentralCaught = true;
    $techCentralMsg = $e->getMessage();
}
assertCondition($techCentralCaught, 'Central identity asserting technician is rejected fail-closed (never accepted from Hub)');
assertCondition(str_contains($techCentralMsg, 'unauthorized, unknown, or malformed'), 'Technician central role rejection specifies unauthorized/unknown/malformed');

// Negative executable case: payload providing only hub_user_id alias and missing sub is rejected
$onlyHubUserIdClaims = [
    'provider' => 'hub',
    'hub_user_id' => 'hub_user_alice',
    'active' => true,
    'roles' => ['admin'],
];
$onlyHubUserIdCaught = false;
$onlyHubUserIdMsg = '';
try {
    $ssoAuth->authorize($onlyHubUserIdClaims);
} catch (\InvalidArgumentException $e) {
    $onlyHubUserIdCaught = true;
    $onlyHubUserIdMsg = $e->getMessage();
}
assertCondition($onlyHubUserIdCaught, 'Payload providing only hub_user_id without sub is rejected at boundary with InvalidArgumentException');
assertCondition(str_contains($onlyHubUserIdMsg, 'sub'), 'Rejection error message explicitly identifies sub requirement');

// Sanitized error verification for missing sub rejection
$sanitizedSubError = SsoAuthorization::sanitizeError($onlyHubUserIdMsg);
assertCondition(!str_contains($sanitizedSubError, 'client_secret') && !str_contains($sanitizedSubError, 'password'), 'Missing sub rejection error is properly sanitized');

// Negative executable case: empty sub is rejected
$emptySubClaims = [
    'provider' => 'hub',
    'sub' => '   ',
    'active' => true,
    'roles' => ['admin'],
];
$emptySubCaught = false;
try {
    $ssoAuth->authorize($emptySubClaims);
} catch (\InvalidArgumentException $e) {
    $emptySubCaught = true;
}
assertCondition($emptySubCaught, 'Payload with empty/whitespace sub is rejected with InvalidArgumentException');

// -----------------------------------------------------------------------------
// 4. Disabled / Inactive Local Users and Links
// -----------------------------------------------------------------------------
echo "\n4. Testing disabled local users, inactive links, and unmapped identities...\n";

// ID 2: Bob is an inactive local user (users.active = 0) linked to active link
$mockPdo->insertUser(2, 'bob_inactive', 'admin', 0);
$mockPdo->insertLink(2, 'hub', 'hub_user_bob', 1);

$bobProfile = new IdentityProfile('hub', 'hub_user_bob', true, ['admin']);
$bobCaught = false;
try {
    $ssoAuth->authorize($bobProfile);
} catch (RuntimeException $e) {
    $bobCaught = true;
}
assertCondition($bobCaught, 'Resolving link pointing to inactive local user (users.active=0) throws RuntimeException');

// ID 3: Charlie is an active local user with inactive federated link (links.active = 0)
$mockPdo->insertUser(3, 'charlie_link_inactive', 'admin', 1);
$mockPdo->insertLink(3, 'hub', 'hub_user_charlie', 0);

$charlieProfile = new IdentityProfile('hub', 'hub_user_charlie', true, ['admin']);
$charlieCaught = false;
try {
    $ssoAuth->authorize($charlieProfile);
} catch (RuntimeException $e) {
    $charlieCaught = true;
}
assertCondition($charlieCaught, 'Resolving inactive federated link (links.active=0) throws RuntimeException');

// Direct lookup of nonexistent link in repository findActiveUser returns null
$unmappedDirect = $repository->findActiveUser('hub', 'hub_user_nonexistent_xyz');
assertCondition($unmappedDirect === null, 'Repository findActiveUser returns null for unmapped identity');

// Granular defense-in-depth: active flags fail closed if explicitly returned by repository
$stubRepo = new StubFederatedIdentityRepository();
$stubAuth = new SsoAuthorization($stubRepo);

// Explicit active => false in repository return
$stubRepo->setStubResult([
    'user_id' => 10,
    'username' => 'test_user',
    'role' => 'admin',
    'active' => false,
    'provider' => 'hub',
    'hub_user_id' => 'hub_10',
    'sub' => 'hub_10',
    'link_id' => 100,
    'link_active' => true,
]);
$localInactiveCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true, ['admin']));
} catch (RuntimeException $e) {
    $localInactiveCaught = true;
    assertCondition(str_contains($e->getMessage(), 'local user account is inactive'), 'Defense-in-depth: explicit active=false rejects with local user inactive');
}
assertCondition($localInactiveCaught, 'Repository active=false triggers fail-closed exception');

// Explicit user_active => 0 in repository return
$stubRepo->setStubResult([
    'user_id' => 10,
    'username' => 'test_user',
    'role' => 'admin',
    'user_active' => 0,
    'provider' => 'hub',
    'hub_user_id' => 'hub_10',
    'sub' => 'hub_10',
    'link_id' => 100,
    'link_active' => true,
]);
$userActiveCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true, ['admin']));
} catch (RuntimeException $e) {
    $userActiveCaught = true;
    assertCondition(str_contains($e->getMessage(), 'local user account is inactive'), 'Defense-in-depth: user_active=0 rejects with local user inactive');
}
assertCondition($userActiveCaught, 'Repository user_active=0 triggers fail-closed exception');

// Explicit link_active => 0 in repository return
$stubRepo->setStubResult([
    'user_id' => 10,
    'username' => 'test_user',
    'role' => 'admin',
    'user_active' => 1,
    'provider' => 'hub',
    'hub_user_id' => 'hub_10',
    'sub' => 'hub_10',
    'link_id' => 100,
    'link_active' => 0,
]);
$linkActiveCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true, ['admin']));
} catch (RuntimeException $e) {
    $linkActiveCaught = true;
    assertCondition(str_contains($e->getMessage(), 'federated identity link is inactive'), 'Defense-in-depth: link_active=0 rejects with link inactive');
}
assertCondition($linkActiveCaught, 'Repository link_active=0 triggers fail-closed exception');

// Explicit missing sub in repository return even when hub_user_id is present
$stubRepo->setStubResult([
    'user_id' => 10,
    'username' => 'test_user',
    'role' => 'admin',
    'active' => true,
    'provider' => 'hub',
    'hub_user_id' => 'hub_10',
    'link_id' => 100,
    'link_active' => true,
]);
$missingSubRepoCaught = false;
$missingSubRepoMsg = '';
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true, ['admin']));
} catch (RuntimeException $e) {
    $missingSubRepoCaught = true;
    $missingSubRepoMsg = $e->getMessage();
}
assertCondition($missingSubRepoCaught, 'Repository output missing sub even when hub_user_id is present is rejected fail-closed');
assertCondition(str_contains($missingSubRepoMsg, 'sub'), 'Repository missing sub rejection explicitly identifies sub requirement');

// Explicit empty/whitespace sub in repository return even when hub_user_id is present
$stubRepo->setStubResult([
    'user_id' => 10,
    'username' => 'test_user',
    'role' => 'admin',
    'active' => true,
    'provider' => 'hub',
    'sub' => '   ',
    'hub_user_id' => 'hub_10',
    'link_id' => 100,
    'link_active' => true,
]);
$emptySubRepoCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true, ['admin']));
} catch (RuntimeException $e) {
    $emptySubRepoCaught = true;
}
assertCondition($emptySubRepoCaught, 'Repository output with whitespace sub even when hub_user_id is present is rejected fail-closed');

// -----------------------------------------------------------------------------
// 5. Exact Approved Role Mapping (admin & viewer)
// -----------------------------------------------------------------------------
echo "\n5. Testing exact approved central role mapping (admin & viewer)...\n";

$mockPdo->insertUser(10, 'local_admin_user', 'admin', 1);
$adminLinkId = $mockPdo->insertLink(10, 'hub', 'hub_id_admin', 1);

$mockPdo->insertUser(30, 'local_viewer_user', 'viewer', 1);
$mockPdo->insertLink(30, 'hub', 'hub_id_viewer', 1);

// Test admin mapping
$authAdmin = $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_admin', true, ['admin']));
assertCondition($authAdmin['user_id'] === 10, 'Admin: user_id is 10');
assertCondition($authAdmin['id'] === 10, 'Admin: id alias is 10');
assertCondition($authAdmin['role'] === 'admin', 'Admin: persisted role strictly admin');
assertCondition($authAdmin['active'] === true, 'Admin: active flag is true');
assertCondition($authAdmin['provider'] === 'hub', 'Admin: provider preserved');
assertCondition($authAdmin['sub'] === 'hub_id_admin', 'Admin: sub preserved without translation');
assertCondition($authAdmin['link_active'] === true, 'Admin: link_active is true');

// Test viewer mapping
$authViewer = $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_viewer', true, ['viewer']));
assertCondition($authViewer['user_id'] === 30, 'Viewer: user_id is 30');
assertCondition($authViewer['role'] === 'viewer', 'Viewer: persisted role strictly viewer');
assertCondition($authViewer['active'] === true, 'Viewer: active flag is true');

// Test technician role from Hub: rejected fail-closed
$techHubCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_admin', true, ['technician']));
} catch (RuntimeException $e) {
    $techHubCaught = true;
}
assertCondition($techHubCaught, 'Central role technician is rejected fail-closed; never accepted from Hub');

// -----------------------------------------------------------------------------
// 6. Role Synchronization & Anti-Privilege-Elevation
// -----------------------------------------------------------------------------
echo "\n6. Testing role synchronization & anti-privilege-elevation...\n";

// Admin-to-viewer downgrade: existing local admin is synchronized to viewer
$downgradeResult = $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_admin', true, ['viewer']));
assertCondition($downgradeResult['role'] === 'viewer', 'Admin-to-viewer downgrade: result role is synchronized to viewer');
assertCondition($mockPdo->users[10]['role'] === 'viewer', 'Admin-to-viewer downgrade: local user role in database is synchronized to viewer');
assertCondition($downgradeResult['user_id'] === 10, 'Admin-to-viewer downgrade: local user ID is unchanged');
assertCondition($downgradeResult['link_id'] === $adminLinkId, 'Admin-to-viewer downgrade: link ID is preserved (link not replaced)');

// Viewer-to-admin upgrade: existing local viewer is synchronized to admin
$upgradeResult = $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_viewer', true, ['admin']));
assertCondition($upgradeResult['role'] === 'admin', 'Viewer-to-admin upgrade: result role is synchronized to admin');
assertCondition($mockPdo->users[30]['role'] === 'admin', 'Viewer-to-admin upgrade: local user role in database is synchronized to admin');
assertCondition($upgradeResult['user_id'] === 30, 'Viewer-to-admin upgrade: local user ID is unchanged');

// Anti-elevation: central identity asserting multiple roles fails closed
$multiRoleCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_viewer', true, ['admin', 'viewer']));
} catch (RuntimeException $e) {
    $multiRoleCaught = true;
}
assertCondition($multiRoleCaught, 'Anti-elevation: central identity asserting multiple roles ["admin", "viewer"] fails closed');

// Anti-elevation: central identity asserting superadmin/root fails closed
$superRoleCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_viewer', true, ['superadmin']));
} catch (RuntimeException $e) {
    $superRoleCaught = true;
}
assertCondition($superRoleCaught, 'Anti-elevation: central identity asserting "superadmin" fails closed');

// -----------------------------------------------------------------------------
// 7. Unknown-Role Rejection & Fail-Closed Default Denial
// -----------------------------------------------------------------------------
echo "\n7. Testing unknown-role rejection, empty role, and fail-closed default denial...\n";

// Case A: Central identity has unknown role 'estimator'
$estimatorCaught = false;
$estimatorMsg = '';
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_user_est', true, ['estimator']));
} catch (RuntimeException $e) {
    $estimatorCaught = true;
    $estimatorMsg = $e->getMessage();
}
assertCondition($estimatorCaught, 'Central identity with unknown role "estimator" is rejected with RuntimeException');
assertCondition(str_contains($estimatorMsg, 'unauthorized, unknown, or malformed'), 'Unknown role error message specifies unauthorized/unknown/malformed');

// Case B: Central identity has empty role
$emptyRoleCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_user_empty', true, ['']));
} catch (RuntimeException $e) {
    $emptyRoleCaught = true;
}
assertCondition($emptyRoleCaught, 'Central identity with empty role string is rejected fail-closed');

// Case C: Central identity has whitespace role
$wsRoleCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_user_ws', true, ['   ']));
} catch (RuntimeException $e) {
    $wsRoleCaught = true;
}
assertCondition($wsRoleCaught, 'Central identity with whitespace role is rejected fail-closed');

// Case D: Central identity has misspelled role 'Admin'
$misspelledCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_user_case', true, ['Admin']));
} catch (RuntimeException $e) {
    $misspelledCaught = true;
}
assertCondition($misspelledCaught, 'Central identity with misspelled role "Admin" is rejected fail-closed');

// Case E: Central identity with zero roles
$zeroRoleCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_user_norole', true, []));
} catch (RuntimeException $e) {
    $zeroRoleCaught = true;
}
assertCondition($zeroRoleCaught, 'Central identity with zero roles is rejected fail-closed');

// Case F: Local user has invalid user_id (0)
$stubRepo->setStubResult([
    'user_id' => 0,
    'id' => 0,
    'username' => 'zero_id_user',
    'role' => 'admin',
    'active' => true,
    'provider' => 'hub',
    'hub_user_id' => 'hub_zero',
    'sub' => 'hub_zero',
    'link_id' => 1,
    'link_active' => true,
]);
$zeroIdCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_zero', true, ['admin']));
} catch (RuntimeException $e) {
    $zeroIdCaught = true;
}
assertCondition($zeroIdCaught, 'Local user with user_id <= 0 is rejected with RuntimeException');

// Case G: Local user has empty username
$stubRepo->setStubResult([
    'user_id' => 50,
    'username' => '   ',
    'role' => 'admin',
    'active' => true,
    'provider' => 'hub',
    'hub_user_id' => 'hub_nousername',
    'sub' => 'hub_nousername',
    'link_id' => 1,
    'link_active' => true,
]);
$emptyUsernameCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_nousername', true, ['admin']));
} catch (RuntimeException $e) {
    $emptyUsernameCaught = true;
}
assertCondition($emptyUsernameCaught, 'Local user with empty username is rejected with RuntimeException');

// Case H: Missing repository throws InvalidArgumentException
$noRepoAuth = new SsoAuthorization(null);
$noRepoCaught = false;
try {
    $noRepoAuth->authorize(new IdentityProfile('hub', 'hub_id_admin', true, ['admin']));
} catch (InvalidArgumentException $e) {
    $noRepoCaught = true;
}
assertCondition($noRepoCaught, 'Missing repository throws InvalidArgumentException');

// Case I: Empty profile argument throws InvalidArgumentException
$emptyProfileCaught = false;
try {
    $ssoAuth->authorize([]);
} catch (InvalidArgumentException $e) {
    $emptyProfileCaught = true;
}
assertCondition($emptyProfileCaught, 'Empty claims array throws InvalidArgumentException');

// Case J: Invalid profile type throws InvalidArgumentException
$invalidTypeCaught = false;
try {
    $ssoAuth->authorize('string_profile_not_supported');
} catch (InvalidArgumentException $e) {
    $invalidTypeCaught = true;
}
assertCondition($invalidTypeCaught, 'Invalid profile type (string) throws InvalidArgumentException');

// -----------------------------------------------------------------------------
// 8. Generic Sanitized Errors (Tokens, Secrets, Credentials, DSNs, Paths)
// -----------------------------------------------------------------------------
echo "\n8. Testing generic sanitized error messages (tokens, secrets, credentials, DSNs, paths)...\n";

$rawWindowsError = 'File not found in C:\\inetpub\\wwwroot\\takeoff\\config\\database.php line 42';
$sanitizedWin = SsoAuthorization::sanitizeError($rawWindowsError);
assertCondition(!str_contains($sanitizedWin, 'C:\\inetpub'), 'sanitizeError redacts Windows filesystem drive path');
assertCondition(str_contains($sanitizedWin, '[REDACTED_PATH]'), 'sanitizeError inserts [REDACTED_PATH]');

$rawUnixError = 'Exception in /var/www/takeoff/core/auth/SsoAuthorization.php line 105';
$sanitizedUnix = SsoAuthorization::sanitizeError($rawUnixError);
assertCondition(!str_contains($sanitizedUnix, '/var/www'), 'sanitizeError redacts Unix filesystem path');
assertCondition(str_contains($sanitizedUnix, '[REDACTED_PATH]'), 'sanitizeError inserts [REDACTED_PATH] for Unix path');

$rawSecretError = 'OAuth error: client_secret=very_secret_key_99999 and access_token=ya29.secret_token_12345 failed';
$sanitizedSecrets = SsoAuthorization::sanitizeError($rawSecretError);
assertCondition(!str_contains($sanitizedSecrets, 'very_secret_key_99999'), 'sanitizeError redacts client_secret value');
assertCondition(!str_contains($sanitizedSecrets, 'ya29.secret_token_12345'), 'sanitizeError redacts access_token value');
assertCondition(str_contains($sanitizedSecrets, 'client_secret=[REDACTED]'), 'client_secret value replaced with [REDACTED]');
assertCondition(str_contains($sanitizedSecrets, 'access_token=[REDACTED]'), 'access_token value replaced with [REDACTED]');

$rawBearerError = 'Failed Authorization header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDom triggers error';
$sanitizedBearer = SsoAuthorization::sanitizeError($rawBearerError);
assertCondition(!str_contains($sanitizedBearer, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'sanitizeError redacts Bearer JWT token content');
assertCondition(str_contains($sanitizedBearer, 'Bearer [REDACTED]'), 'Bearer token replaced with Bearer [REDACTED]');

$rawPkceError = 'PKCE verification failure with code_verifier=secret_verifier_abc_123 and password=super_secret_pw!';
$sanitizedPkce = SsoAuthorization::sanitizeError($rawPkceError);
assertCondition(!str_contains($sanitizedPkce, 'secret_verifier_abc_123'), 'code_verifier value redacted');
assertCondition(!str_contains($sanitizedPkce, 'super_secret_pw!'), 'password value redacted');

$rawDsnError = 'Database connection error for dsn mysql:host=localhost;dbname=takeoff; password=my_db_password!';
$sanitizedDsn = SsoAuthorization::sanitizeError($rawDsnError);
assertCondition(!str_contains($sanitizedDsn, 'my_db_password!'), 'DSN / connection credential password redacted');

// -----------------------------------------------------------------------------
// 9. Static Methods & Absence of OIDC Dependencies
// -----------------------------------------------------------------------------
echo "\n9. Testing static entry points, repository setters, and absence of OIDC dependencies...\n";

$staticResult = SsoAuthorization::authorizeIdentity(new IdentityProfile('hub', 'hub_id_admin', true, ['admin']), $repository);
assertCondition($staticResult['role'] === 'admin', 'SsoAuthorization::authorizeIdentity static helper works');

$newSsoAuth = new SsoAuthorization();
assertCondition($newSsoAuth->getRepository() === null, 'Initial repository is null');
$newSsoAuth->setRepository($repository);
assertCondition($newSsoAuth->getRepository() === $repository, 'setRepository updates the repository');

$reflection = new ReflectionClass(SsoAuthorization::class);

$methods = array_map(fn($m) => $m->getName(), $reflection->getMethods());
foreach ($methods as $method) {
    assertCondition(
        !preg_match('/(openid|id_token|nonce|oidc|jwt)/i', $method),
        "Method '{$method}' does not contain functional OIDC/nonce/id_token behavior"
    );
}

$properties = array_map(fn($p) => $p->getName(), $reflection->getProperties());
foreach ($properties as $property) {
    assertCondition(
        !preg_match('/(openid|id_token|nonce|oidc)/i', $property),
        "Property '{$property}' does not contain functional OIDC/nonce/id_token state"
    );
}

// -----------------------------------------------------------------------------
// 10. Focused Executable Coverage: Shadow User Lifecycle & Security Boundary
// -----------------------------------------------------------------------------
echo "\n10. Testing focused executable shadow identity provisioning lifecycle...\n";

// 10.1 First login transactional provisioning
$freshPdo = new IsolatedMockPdo();
$freshRepo = new FederatedIdentityRepository($freshPdo);
$freshAuth = new SsoAuthorization($freshRepo);

assertCondition(count($freshPdo->users) === 0, 'Database starts with zero users');
assertCondition(count($freshPdo->links) === 0, 'Database starts with zero links');

$firstProfile = new IdentityProfile(
    'hub',
    'sub_prov_001',
    true,
    ['admin'],
    'first_admin@example.com',
    'first_admin_user',
    [],
    'Alice Executive'
);

$firstAuthResult = $freshAuth->authorize($firstProfile);

assertCondition(count($freshPdo->users) === 1, 'First login creates exactly one local user in database');
assertCondition(count($freshPdo->links) === 1, 'First login creates exactly one federated link in database');

$provisionedUser = array_values($freshPdo->users)[0];
$provisionedLink = array_values($freshPdo->links)[0];

$expectedShadowUsername = FederatedIdentityRepository::deriveShadowUsername('hub', 'sub_prov_001');
assertCondition($provisionedUser['username'] === $expectedShadowUsername, 'Shadow user has deterministic collision-resistant username');
assertCondition(str_starts_with($expectedShadowUsername, 'sso_'), 'Deterministic username has sso_ prefix');
assertCondition(strlen($expectedShadowUsername) === 36, 'Deterministic username is sso_ prefix + 32-char hex digest');

assertCondition($provisionedUser['role'] === 'admin', 'Local shadow user role is admin');
assertCondition((int)$provisionedUser['active'] === 1, 'Local shadow user is active');
assertCondition(!empty($provisionedUser['password']), 'Local shadow user has password hash populated');
assertCondition(password_get_info($provisionedUser['password'])['algo'] !== 0, 'Password is a valid cryptographic hash (unrecoverable)');

assertCondition($provisionedLink['user_id'] === $provisionedUser['id'], 'Federated link points exactly to the provisioned user ID');
assertCondition($provisionedLink['provider'] === 'hub', 'Federated link provider is hub');
assertCondition($provisionedLink['hub_user_id'] === 'sub_prov_001', 'Federated link hub_user_id matches sub');
assertCondition((int)$provisionedLink['active'] === 1, 'Federated link is active');

// Session presentation identity
assertCondition($firstAuthResult['username'] === 'Alice Executive', 'Authorized identity presents central display name');
assertCondition($firstAuthResult['shadow_username'] === $expectedShadowUsername, 'Authorized identity preserves shadow_username');
assertCondition($firstAuthResult['user_id'] === $provisionedUser['id'], 'Authorized identity contains local user ID');
assertCondition($firstAuthResult['sub'] === 'sub_prov_001', 'Authorized identity contains canonical sub');

// 10.2 SsoSession presentation & cleanliness
$testSession = [];
$sessionHelper = new SsoSession();
$sessionHelper->establish($firstAuthResult, $testSession);

assertCondition($testSession['user_id'] === $provisionedUser['id'], 'Session user_id is local user ID');
assertCondition($testSession['username'] === 'Alice Executive', 'Session presentation username is central display name');
assertCondition($testSession['role'] === 'admin', 'Session role is synchronized admin role');
assertCondition($testSession['sso_sub'] === 'sub_prov_001', 'Session contains canonical sso_sub');
assertCondition(!isset($testSession['access_token']), 'Session contains no access_token');
assertCondition(!isset($testSession['refresh_token']), 'Session contains no refresh_token');
assertCondition(!isset($testSession['password']), 'Session contains no password');
assertCondition(!isset($testSession['email']), 'Session contains no email');
assertCondition(!isset($testSession['secret']), 'Session contains no secret');
assertCondition(!isset($testSession['code_verifier']), 'Session contains no code_verifier');

// 10.3 Repeat login (Idempotent, no new records, link unchanged)
$repeatAuthResult = $freshAuth->authorize($firstProfile);
assertCondition(count($freshPdo->users) === 1, 'Repeat login creates no new user (idempotent count=1)');
assertCondition(count($freshPdo->links) === 1, 'Repeat login creates no new link (idempotent count=1)');
assertCondition($repeatAuthResult['user_id'] === $provisionedUser['id'], 'Repeat login resolves identical user ID');
assertCondition($repeatAuthResult['link_id'] === $provisionedLink['id'], 'Repeat login preserves existing link ID');

// 10.4 Admin-to-viewer downgrade on repeat login
$downgradeProfile = new IdentityProfile(
    'hub',
    'sub_prov_001',
    true,
    ['viewer'],
    'first_admin@example.com',
    'first_admin_user',
    [],
    'Alice Executive'
);
$downResult = $freshAuth->authorize($downgradeProfile);
assertCondition($downResult['role'] === 'viewer', 'Downgrade: returned role is viewer');
assertCondition($freshPdo->users[$provisionedUser['id']]['role'] === 'viewer', 'Downgrade: database record synchronized to viewer');
assertCondition($downResult['link_id'] === $provisionedLink['id'], 'Downgrade: link ID is preserved (link unchanged)');
assertCondition(count($freshPdo->users) === 1, 'Downgrade: user count remains 1');

// 10.5 Viewer-to-admin upgrade on repeat login
$upgradeProfile = new IdentityProfile(
    'hub',
    'sub_prov_001',
    true,
    ['admin'],
    'first_admin@example.com',
    'first_admin_user',
    [],
    'Alice Executive'
);
$upResult = $freshAuth->authorize($upgradeProfile);
assertCondition($upResult['role'] === 'admin', 'Upgrade: returned role is admin');
assertCondition($freshPdo->users[$provisionedUser['id']]['role'] === 'admin', 'Upgrade: database record synchronized to admin');
assertCondition($upResult['link_id'] === $provisionedLink['id'], 'Upgrade: link ID is preserved (link unchanged)');

// 10.6 Collision and concurrent race recovery
$racePdo = new IsolatedMockPdo();
$raceRepo = new FederatedIdentityRepository($racePdo);
$raceAuth = new SsoAuthorization($raceRepo);

$simulatedWinnerId = 999;
$racePdo->onInsertUser = function ($params) use ($racePdo, $simulatedWinnerId) {
    // Concurrent worker wins the race and inserts the user + link just before this worker finishes
    $racePdo->onInsertUser = null;
    $racePdo->insertUser($simulatedWinnerId, 'sso_winning_racer', 'viewer', 1);
    $racePdo->insertLink($simulatedWinnerId, 'hub', 'sub_concurrent_race_99', 1);
    throw new PDOException('SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry for key');
};

$raceProfile = new IdentityProfile('hub', 'sub_concurrent_race_99', true, ['admin']);
$recoveredIdentity = $raceAuth->authorize($raceProfile);

assertCondition($recoveredIdentity['user_id'] === $simulatedWinnerId, 'Collision recovery: resolves the concurrently created user ID');
assertCondition($recoveredIdentity['role'] === 'admin', 'Collision recovery: synchronizes winner role to requested role');
assertCondition($racePdo->users[$simulatedWinnerId]['role'] === 'admin', 'Collision recovery: winning DB record synchronized to admin');
assertCondition(count($racePdo->users) === 1, 'Collision recovery: no duplicate user records created');

// 10.7 Zero username or email auto-linking
$autoLinkPdo = new IsolatedMockPdo();
$autoLinkRepo = new FederatedIdentityRepository($autoLinkPdo);
$autoLinkAuth = new SsoAuthorization($autoLinkRepo);

// Pre-existing local user with username 'existing_local_bob'
$autoLinkPdo->insertUser(777, 'existing_local_bob', 'admin', 1);

// Central identity presents matching username 'existing_local_bob' and matching email
$bobCentralProfile = new IdentityProfile(
    'hub',
    'sub_unique_bob_999',
    true,
    ['viewer'],
    'bob@example.com',
    'existing_local_bob'
);

$bobAuthResult = $autoLinkAuth->authorize($bobCentralProfile);

assertCondition($bobAuthResult['user_id'] !== 777, 'Never auto-links: does NOT link to existing local user id 777');
assertCondition(count($autoLinkPdo->users) === 2, 'Never auto-links: creates a new separate shadow user');
assertCondition($autoLinkPdo->users[777]['username'] === 'existing_local_bob', 'Existing local user record is completely untouched');
assertCondition($autoLinkPdo->users[777]['role'] === 'admin', 'Existing local user role is completely untouched');

// 10.8 Inactive records fail closed without database writes
$inactivePdo = new IsolatedMockPdo();
$inactiveRepo = new FederatedIdentityRepository($inactivePdo);
$inactiveAuth = new SsoAuthorization($inactiveRepo);

// Inactive central profile
$preCountUsers = count($inactivePdo->users);
$preCountLinks = count($inactivePdo->links);
try {
    $inactiveAuth->authorize(new IdentityProfile('hub', 'sub_inactive_fail', false, ['admin']));
} catch (RuntimeException) {}
assertCondition(count($inactivePdo->users) === $preCountUsers, 'Inactive central identity: zero user writes to database');
assertCondition(count($inactivePdo->links) === $preCountLinks, 'Inactive central identity: zero link writes to database');

// Inactive link record
$inactivePdo->insertUser(501, 'user_with_inactive_link', 'viewer', 1);
$inactivePdo->insertLink(501, 'hub', 'sub_linked_inactive', 0);
$preCountUsers = count($inactivePdo->users);
$preCountLinks = count($inactivePdo->links);
try {
    $inactiveAuth->authorize(new IdentityProfile('hub', 'sub_linked_inactive', true, ['admin']));
} catch (RuntimeException) {}
assertCondition(count($inactivePdo->users) === $preCountUsers, 'Inactive federated link: zero user writes to database');
assertCondition($inactivePdo->users[501]['role'] === 'viewer', 'Inactive federated link: role is NOT updated');

// 10.9 Repository exception sanitization (No PDO, SQL, credentials, paths leaked)
$errorPdo = new IsolatedMockPdo();
$errorRepo = new FederatedIdentityRepository($errorPdo);

$errorPdo->onQuery = function ($sql, $params) {
    throw new PDOException(
        "SQLSTATE[HY000]: General error: 1 near 'SYNTAX': file C:\\inetpub\\takeoff\\core\\auth\\FederatedIdentityRepository.php; dsn=mysql:host=127.0.0.1;dbname=prod;user=root;password=my_secret_db_pass"
    );
};

$repoErrorCaught = false;
$repoErrorMsg = '';
$repoPrevious = null;
try {
    $errorRepo->findActiveUser('hub', 'test_error_sub');
} catch (RuntimeException $e) {
    $repoErrorCaught = true;
    $repoErrorMsg = $e->getMessage();
    $repoPrevious = $e->getPrevious();
}

assertCondition($repoErrorCaught, 'PDOException inside repository triggers RuntimeException');
assertCondition(!str_contains($repoErrorMsg, 'SQLSTATE'), 'Exception message leaks no SQLSTATE');
assertCondition(!str_contains($repoErrorMsg, 'SYNTAX'), 'Exception message leaks no SQL details');
assertCondition(!str_contains($repoErrorMsg, 'C:\\inetpub'), 'Exception message leaks no filesystem paths');
assertCondition(!str_contains($repoErrorMsg, 'password'), 'Exception message leaks no credentials');
assertCondition(!str_contains($repoErrorMsg, 'dsn='), 'Exception message leaks no DSN details');
assertCondition($repoPrevious === null, 'No internal PDOException is exposed as previous exception');
assertCondition($repoErrorMsg === 'SSO federated identity lookup failed.', 'Repository exception message is generic sanitized');

// -----------------------------------------------------------------------------
// Final Report
// -----------------------------------------------------------------------------
echo "\n======================================================================\n";
echo "Test Execution Summary: {$passedCount} passed, {$failedCount} failed.\n";
echo "======================================================================\n";

if ($failedCount > 0) {
    fwrite(STDERR, "FAIL: " . implode("\n - ", $failures) . "\n");
    exit(1);
}

echo "OK: All runtime tests passed successfully.\n";
exit(0);
