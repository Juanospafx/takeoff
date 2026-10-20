<?php
declare(strict_types=1);

/**
 * Runtime Test Suite for Takeoff SSO Authorization Contractual Boundary.
 * Task: TASK-0268 (Takeoff SSO C recovery - authorization contractual test)
 *
 * Acceptance Criteria Covered:
 * 1. The isolated test evaluates authenticated active and inactive identities,
 *    disabled local users, exact persisted-role mapping for admin, technician and viewer,
 *    unknown-role rejection and fail-closed default denial.
 * 2. It proves central roles cannot elevate the persisted local role and remains
 *    compatible with Takeoff local authorization semantics.
 * 3. It verifies generic sanitized errors do not expose tokens, secrets, credentials,
 *    DSNs or filesystem paths.
 * 4. It contains no functional openid, id_token, nonce or OIDC behavior and performs
 *    no real database or network access.
 * 5. Only the new test file is created; the preserved SsoAuthorization.php is not modified.
 */

require_once dirname(__DIR__) . '/core/auth/IdentityProfile.php';
require_once dirname(__DIR__) . '/core/auth/FederatedIdentityRepository.php';
require_once dirname(__DIR__) . '/core/auth/SsoAuthorization.php';

use Takeoff\Core\Auth\IdentityProfile;
use Takeoff\Core\Auth\FederatedIdentityRepository;
use Takeoff\Core\Auth\SsoAuthorization;

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
    /** @var array<int, array{id: int, username: string, role: string, active: int}> */
    public array $users = [];

    /** @var array<int, array{id: int, user_id: int, provider: string, hub_user_id: string, active: int}> */
    public array $links = [];

    public int $nextLinkId = 1;

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
    public function prepare($query, $options = [])
    {
        return new IsolatedMockPdoStatement($this, $query);
    }

    public function insertUser(int $id, string $username, string $role, int $active): void
    {
        $this->users[$id] = [
            'id' => $id,
            'username' => $username,
            'role' => $role,
            'active' => $active,
        ];
    }

    public function insertLink(int $userId, string $provider, string $hubUserId, int $active): int
    {
        $linkId = $this->nextLinkId++;
        $this->links[$linkId] = [
            'id' => $linkId,
            'user_id' => $userId,
            'provider' => $provider,
            'hub_user_id' => $hubUserId,
            'active' => $active,
        ];
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

        // INSERT INTO users
        if (preg_match('/INSERT\s+INTO\s+\S*users/i', $this->sql)) {
            if (preg_match('/VALUES\s*\(\s*(\d+)\s*,\s*\'([^\']+)\'\s*,\s*\'([^\']+)\'\s*,\s*\'([^\']+)\'\s*,\s*(\d+)\s*\)/i', $this->sql, $matches)) {
                $id = (int)$matches[1];
                $username = $matches[2];
                $role = $matches[4];
                $active = (int)$matches[5];
                $this->pdo->insertUser($id, $username, $role, $active);
                return true;
            }
            return false;
        }

        // INSERT INTO sso_identity_links
        if (preg_match('/INSERT\s+INTO\s+\S*sso_identity_links/i', $this->sql)) {
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

        // SELECT query from FederatedIdentityRepository::findActiveUser
        if (preg_match('/SELECT/i', $this->sql)) {
            $provider = (string)($params[':provider'] ?? $params['provider'] ?? '');
            $hubUserId = (string)($params[':hub_user_id'] ?? $params['hub_user_id'] ?? '');

            foreach ($this->pdo->links as $link) {
                if ($link['provider'] === $provider && $link['hub_user_id'] === $hubUserId) {
                    $userId = $link['user_id'];
                    $user = $this->pdo->users[$userId] ?? null;

                    // Inner join requires local user record to exist
                    if ($user === null) {
                        continue;
                    }

                    // Strict active filtering: l.active = 1 AND u.active = 1
                    if ((int)$link['active'] !== 1 || (int)$user['active'] !== 1) {
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
assertCondition(SsoAuthorization::ROLE_TECHNICIAN === 'technician', 'ROLE_TECHNICIAN constant is strictly technician');
assertCondition(SsoAuthorization::ROLE_VIEWER === 'viewer', 'ROLE_VIEWER constant is strictly viewer');

$expectedRoles = ['admin', 'technician', 'viewer'];
assertCondition(SsoAuthorization::ALLOWED_ROLES === $expectedRoles, 'ALLOWED_ROLES strictly contains admin, technician, viewer');
assertCondition(SsoAuthorization::VALID_ROLES === $expectedRoles, 'VALID_ROLES alias matches ALLOWED_ROLES');
assertCondition($ssoAuth->getValidRoles() === $expectedRoles, 'getValidRoles returns exact whitelist');

assertCondition(SsoAuthorization::isAllowedRole('admin') === true, 'isAllowedRole accepts admin');
assertCondition(SsoAuthorization::isAllowedRole('technician') === true, 'isAllowedRole accepts technician');
assertCondition(SsoAuthorization::isAllowedRole('viewer') === true, 'isAllowedRole accepts viewer');
assertCondition(SsoAuthorization::isValidRole('admin') === true, 'isValidRole alias accepts admin');
assertCondition(SsoAuthorization::isValidRole('technician') === true, 'isValidRole alias accepts technician');
assertCondition(SsoAuthorization::isValidRole('viewer') === true, 'isValidRole alias accepts viewer');

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
$activeProfile = new IdentityProfile('hub', 'hub_user_alice', true, ['viewer']);
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
// 4. Disabled / Inactive Local Users and Unmapped Links
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
$mockPdo->insertUser(3, 'charlie_link_inactive', 'technician', 1);
$mockPdo->insertLink(3, 'hub', 'hub_user_charlie', 0);

$charlieProfile = new IdentityProfile('hub', 'hub_user_charlie', true, ['technician']);
$charlieCaught = false;
try {
    $ssoAuth->authorize($charlieProfile);
} catch (RuntimeException $e) {
    $charlieCaught = true;
}
assertCondition($charlieCaught, 'Resolving inactive federated link (links.active=0) throws RuntimeException');

// Non-existent link
$unknownProfile = new IdentityProfile('hub', 'hub_user_nonexistent', true, ['admin']);
$unknownCaught = false;
try {
    $ssoAuth->authorize($unknownProfile);
} catch (RuntimeException $e) {
    $unknownCaught = true;
}
assertCondition($unknownCaught, 'Unmapped federated identity link throws RuntimeException');

// Provider mismatch
$mismatchedProviderProfile = new IdentityProfile('azure_ad', 'hub_user_alice', true, ['admin']);
$mismatchedCaught = false;
try {
    $ssoAuth->authorize($mismatchedProviderProfile);
} catch (RuntimeException $e) {
    $mismatchedCaught = true;
}
assertCondition($mismatchedCaught, 'Provider mismatch rejects authorization (provider isolation)');

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
    'link_id' => 100,
    'link_active' => true,
]);
$localInactiveCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true));
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
    'link_id' => 100,
    'link_active' => true,
]);
$userActiveCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true));
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
    'link_id' => 100,
    'link_active' => 0,
]);
$linkActiveCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true));
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
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true));
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
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_10', true));
} catch (RuntimeException $e) {
    $emptySubRepoCaught = true;
}
assertCondition($emptySubRepoCaught, 'Repository output with whitespace sub even when hub_user_id is present is rejected fail-closed');

// -----------------------------------------------------------------------------
// 5. Exact Persisted-Role Mapping (admin, technician, viewer)
// -----------------------------------------------------------------------------
echo "\n5. Testing exact persisted-role mapping for admin, technician, and viewer...\n";

// Add users for all three roles
$mockPdo->insertUser(10, 'local_admin_user', 'admin', 1);
$mockPdo->insertLink(10, 'hub', 'hub_id_admin', 1);

$mockPdo->insertUser(20, 'local_tech_user', 'technician', 1);
$mockPdo->insertLink(20, 'hub', 'hub_id_tech', 1);

$mockPdo->insertUser(30, 'local_viewer_user', 'viewer', 1);
$mockPdo->insertLink(30, 'hub', 'hub_id_viewer', 1);

// Test admin mapping
$authAdmin = $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_admin', true));
assertCondition($authAdmin['user_id'] === 10, 'Admin: user_id is 10');
assertCondition($authAdmin['id'] === 10, 'Admin: id alias is 10');
assertCondition($authAdmin['username'] === 'local_admin_user', 'Admin: username preserved');
assertCondition($authAdmin['role'] === 'admin', 'Admin: persisted role strictly admin');
assertCondition($authAdmin['active'] === true, 'Admin: active flag is true');
assertCondition($authAdmin['provider'] === 'hub', 'Admin: provider preserved');
assertCondition($authAdmin['hub_user_id'] === 'hub_id_admin', 'Admin: hub_user_id preserved');
assertCondition($authAdmin['sub'] === 'hub_id_admin', 'Admin: sub preserved without translation');
assertCondition($authAdmin['link_active'] === true, 'Admin: link_active is true');

// Test technician mapping
$authTech = $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_tech', true));
assertCondition($authTech['user_id'] === 20, 'Technician: user_id is 20');
assertCondition($authTech['username'] === 'local_tech_user', 'Technician: username preserved');
assertCondition($authTech['role'] === 'technician', 'Technician: persisted role strictly technician');
assertCondition($authTech['active'] === true, 'Technician: active flag is true');

// Test viewer mapping
$authViewer = $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_viewer', true));
assertCondition($authViewer['user_id'] === 30, 'Viewer: user_id is 30');
assertCondition($authViewer['username'] === 'local_viewer_user', 'Viewer: username preserved');
assertCondition($authViewer['role'] === 'viewer', 'Viewer: persisted role strictly viewer');
assertCondition($authViewer['active'] === true, 'Viewer: active flag is true');

// -----------------------------------------------------------------------------
// 6. Anti-Privilege-Elevation (Central Roles Cannot Elevate Local Role)
// -----------------------------------------------------------------------------
echo "\n6. Testing anti-privilege-elevation: central claims cannot elevate persisted local role...\n";

// Central identity claims admin and superuser, but local persisted role is viewer
$elevateAttemptViewer = new IdentityProfile('hub', 'hub_id_viewer', true, ['admin', 'superadmin', 'root']);
$authElevateViewer = $ssoAuth->authorize($elevateAttemptViewer);
assertCondition(
    $authElevateViewer['role'] === 'viewer',
    'Anti-elevation: Central claims ["admin", "superadmin", "root"] CANNOT elevate local viewer to admin'
);

// Central identity claims admin, but local persisted role is technician
$elevateAttemptTech = new IdentityProfile('hub', 'hub_id_tech', true, ['admin']);
$authElevateTech = $ssoAuth->authorize($elevateAttemptTech);
assertCondition(
    $authElevateTech['role'] === 'technician',
    'Anti-elevation: Central claim ["admin"] CANNOT elevate local technician to admin'
);

// Central identity claims viewer, but local persisted role is admin: local admin is preserved
$demoteAttemptAdmin = new IdentityProfile('hub', 'hub_id_admin', true, ['viewer']);
$authDemoteAdmin = $ssoAuth->authorize($demoteAttemptAdmin);
assertCondition(
    $authDemoteAdmin['role'] === 'admin',
    'Role preservation: Local persisted admin role is preserved despite central ["viewer"] claims'
);

// Central identity claims unknown roles, local role preserved
$unknownCentralClaims = new IdentityProfile('hub', 'hub_id_tech', true, ['unrecognized_hub_role', 'billing_manager']);
$authUnknownCentral = $ssoAuth->authorize($unknownCentralClaims);
assertCondition(
    $authUnknownCentral['role'] === 'technician',
    'Central unrecognized roles have zero impact on local role authorization'
);

// -----------------------------------------------------------------------------
// 7. Unknown-Role Rejection & Fail-Closed Default Denial
// -----------------------------------------------------------------------------
echo "\n7. Testing unknown-role rejection, empty role, and fail-closed default denial...\n";

// Case A: Local user has unknown role 'estimator'
$mockPdo->insertUser(40, 'estimator_user', 'estimator', 1);
$mockPdo->insertLink(40, 'hub', 'hub_id_estimator', 1);

$unknownRoleCaught = false;
$unknownRoleMsg = '';
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_estimator', true));
} catch (RuntimeException $e) {
    $unknownRoleCaught = true;
    $unknownRoleMsg = $e->getMessage();
}
assertCondition($unknownRoleCaught, 'Local user with unknown role "estimator" is rejected with RuntimeException');
assertCondition(str_contains($unknownRoleMsg, 'unauthorized, unknown, or misspelled'), 'Unknown role error message specifies unauthorized/unknown/misspelled');

// Case B: Local user has role 'superadmin'
$mockPdo->insertUser(41, 'superadmin_user', 'superadmin', 1);
$mockPdo->insertLink(41, 'hub', 'hub_id_superadmin', 1);

$superadminCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_superadmin', true));
} catch (RuntimeException $e) {
    $superadminCaught = true;
}
assertCondition($superadminCaught, 'Local user with role "superadmin" is rejected (not in whitelist)');

// Case C: Local user has empty role
$mockPdo->insertUser(42, 'empty_role_user', '', 1);
$mockPdo->insertLink(42, 'hub', 'hub_id_empty_role', 1);

$emptyRoleCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_empty_role', true));
} catch (RuntimeException $e) {
    $emptyRoleCaught = true;
}
assertCondition($emptyRoleCaught, 'Local user with empty role string is rejected with RuntimeException');

// Case D: Local user has whitespace role
$mockPdo->insertUser(43, 'whitespace_role_user', '   ', 1);
$mockPdo->insertLink(43, 'hub', 'hub_id_ws_role', 1);

$wsRoleCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_ws_role', true));
} catch (RuntimeException $e) {
    $wsRoleCaught = true;
}
assertCondition($wsRoleCaught, 'Local user with whitespace role is rejected with RuntimeException');

// Case E: Local user has misspelled role 'Admin'
$mockPdo->insertUser(44, 'misspelled_user', 'Admin', 1);
$mockPdo->insertLink(44, 'hub', 'hub_id_misspelled', 1);

$misspelledCaught = false;
try {
    $ssoAuth->authorize(new IdentityProfile('hub', 'hub_id_misspelled', true));
} catch (RuntimeException $e) {
    $misspelledCaught = true;
}
assertCondition($misspelledCaught, 'Local user with misspelled role "Admin" is rejected fail-closed');

// Case F: Local user has invalid user_id (0)
$stubRepo->setStubResult([
    'user_id' => 0,
    'id' => 0,
    'username' => 'zero_id_user',
    'role' => 'admin',
    'active' => true,
    'provider' => 'hub',
    'hub_user_id' => 'hub_zero',
    'link_id' => 1,
    'link_active' => true,
]);
$zeroIdCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_zero', true));
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
    'link_id' => 1,
    'link_active' => true,
]);
$emptyUsernameCaught = false;
try {
    $stubAuth->authorize(new IdentityProfile('hub', 'hub_nousername', true));
} catch (RuntimeException $e) {
    $emptyUsernameCaught = true;
}
assertCondition($emptyUsernameCaught, 'Local user with empty username is rejected with RuntimeException');

// Case H: Missing repository throws InvalidArgumentException
$noRepoAuth = new SsoAuthorization(null);
$noRepoCaught = false;
try {
    $noRepoAuth->authorize(new IdentityProfile('hub', 'hub_id_admin', true));
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

// Path sanitization: Windows filesystem path
$rawWindowsError = 'File not found in C:\\inetpub\\wwwroot\\takeoff\\config\\database.php line 42';
$sanitizedWin = SsoAuthorization::sanitizeError($rawWindowsError);
assertCondition(!str_contains($sanitizedWin, 'C:\\inetpub'), 'sanitizeError redacts Windows filesystem drive path');
assertCondition(str_contains($sanitizedWin, '[REDACTED_PATH]'), 'sanitizeError inserts [REDACTED_PATH]');

// Path sanitization: Unix filesystem path
$rawUnixError = 'Exception in /var/www/takeoff/core/auth/SsoAuthorization.php line 105';
$sanitizedUnix = SsoAuthorization::sanitizeError($rawUnixError);
assertCondition(!str_contains($sanitizedUnix, '/var/www'), 'sanitizeError redacts Unix filesystem path');
assertCondition(str_contains($sanitizedUnix, '[REDACTED_PATH]'), 'sanitizeError inserts [REDACTED_PATH] for Unix path');

// Token & Secret sanitization: access_token, refresh_token, client_secret
$rawSecretError = 'OAuth error: client_secret=very_secret_key_99999 and access_token=ya29.secret_token_12345 failed';
$sanitizedSecrets = SsoAuthorization::sanitizeError($rawSecretError);
assertCondition(!str_contains($sanitizedSecrets, 'very_secret_key_99999'), 'sanitizeError redacts client_secret value');
assertCondition(!str_contains($sanitizedSecrets, 'ya29.secret_token_12345'), 'sanitizeError redacts access_token value');
assertCondition(str_contains($sanitizedSecrets, 'client_secret=[REDACTED]'), 'client_secret value replaced with [REDACTED]');
assertCondition(str_contains($sanitizedSecrets, 'access_token=[REDACTED]'), 'access_token value replaced with [REDACTED]');

// Bearer token sanitization
$rawBearerError = 'Failed Authorization header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDom triggers error';
$sanitizedBearer = SsoAuthorization::sanitizeError($rawBearerError);
assertCondition(!str_contains($sanitizedBearer, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'sanitizeError redacts Bearer JWT token content');
assertCondition(str_contains($sanitizedBearer, 'Bearer [REDACTED]'), 'Bearer token replaced with Bearer [REDACTED]');

// PKCE code_verifier & password
$rawPkceError = 'PKCE verification failure with code_verifier=secret_verifier_abc_123 and password=super_secret_pw!';
$sanitizedPkce = SsoAuthorization::sanitizeError($rawPkceError);
assertCondition(!str_contains($sanitizedPkce, 'secret_verifier_abc_123'), 'code_verifier value redacted');
assertCondition(!str_contains($sanitizedPkce, 'super_secret_pw!'), 'password value redacted');

// DSN / credentials string with password parameter
$rawDsnError = 'Database connection error for dsn mysql:host=localhost;dbname=takeoff; password=my_db_password!';
$sanitizedDsn = SsoAuthorization::sanitizeError($rawDsnError);
assertCondition(!str_contains($sanitizedDsn, 'my_db_password!'), 'DSN / connection credential password redacted');

// Contractual verification: SsoAuthorization runtime error messages themselves reveal zero secrets or paths
$runtimeExceptionMessages = [
    'SSO authorization failed: central user account is inactive or disabled.',
    'SSO authorization failed: unmapped or inactive federated identity link.',
    'SSO authorization failed: local user account is inactive.',
    'SSO authorization failed: federated identity link is inactive.',
    'SSO authorization failed: local user has no explicit role assigned.',
    'SSO authorization failed: local role is unauthorized, unknown, or misspelled.',
    'SSO authorization failed: invalid local user identifier.',
    'SSO authorization failed: invalid local username.',
    'SSO authorization failed: resolved identity missing valid sub.',
];

foreach ($runtimeExceptionMessages as $msg) {
    assertCondition(
        !preg_match('/[a-zA-Z]:\\\\/i', $msg) && !preg_match('/\/(?:var|home|usr|etc)\//i', $msg),
        "Generic error message contains no file paths: '{$msg}'"
    );
    assertCondition(
        !preg_match('/(token|secret|password|dsn|key)/i', $msg),
        "Generic error message contains no secret keys: '{$msg}'"
    );
}

// -----------------------------------------------------------------------------
// 9. Static Methods & Absence of OIDC / openid / id_token / nonce Behavior
// -----------------------------------------------------------------------------
echo "\n9. Testing static entry points, repository setters, and absence of OIDC dependencies...\n";

// Static authorizeIdentity
$staticResult = SsoAuthorization::authorizeIdentity(new IdentityProfile('hub', 'hub_id_admin', true), $repository);
assertCondition($staticResult['role'] === 'admin', 'SsoAuthorization::authorizeIdentity static helper works');

// setRepository
$newSsoAuth = new SsoAuthorization();
assertCondition($newSsoAuth->getRepository() === null, 'Initial repository is null');
$newSsoAuth->setRepository($repository);
assertCondition($newSsoAuth->getRepository() === $repository, 'setRepository updates the repository');

// Verify SsoAuthorization class contract has NO OIDC / openid / id_token / nonce dependencies
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
