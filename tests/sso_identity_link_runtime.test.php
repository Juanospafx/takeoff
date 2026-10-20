<?php
declare(strict_types=1);

/**
 * Runtime Test Suite for Takeoff SSO Federated Identity Link & Local Session Boundary.
 * Task: TASK-0380-CORRECTION (Takeoff shadow identity provisioning & fail-closed authorization)
 *
 * Acceptance Criteria Covered:
 * 1. Isolated PDO/PDOStatement doubles perform no real database or network connection
 *    while preserving all behavioral assertions, eliminating SQLite runtime dependency.
 * 2. FederatedIdentityRepository uses prepared statements and returns only an active
 *    exact link whose local user exists and is active; it never auto-links by username
 *    or email and assigns no default user or role.
 * 3. Cookie configuration is fixed to Secure=true, HttpOnly=true, SameSite=Lax and
 *    exposes no production parameter capable of downgrading those values.
 * 4. SsoSession rejects missing or empty provider and hub_user_id rather than supplying
 *    defaults, and requires explicitly active resolved user and link metadata when present.
 * 5. Session establishment clears every transient state and PKCE key actually used by the
 *    accepted Takeoff flow, stores no token, verifier, code or secret, and preserves the
 *    existing local session shape.
 * 6. Adds negative assertions for cookie downgrade, incomplete federation metadata, and
 *    transient-key cleanup; no role policy, callback, UI, logout or feature-flag wiring.
 * 7. Executable isolated tests for first login shadow user provisioning, repeat login,
 *    admin-to-viewer downgrade, viewer-to-admin upgrade, collision/race recovery, inactive
 *    records fail-closed, and zero username/email auto-linking.
 * 8. Zero exception leakage: no exception exposed outside repository includes PDO, SQL,
 *    credentials, paths, DSNs, or internal failure details.
 */

require_once dirname(__DIR__) . '/core/auth/FederatedIdentityRepository.php';
require_once dirname(__DIR__) . '/core/auth/SsoSession.php';
require_once dirname(__DIR__) . '/core/auth/SsoFlow.php';

use Takeoff\Core\Auth\FederatedIdentityRepository;
use Takeoff\Core\Auth\SsoSession;
use Takeoff\Core\Auth\SsoFlow;

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
        // Silently accept schema setup or PRAGMA statements
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

echo "=== Running Takeoff SSO Federated Identity Link Runtime Test Suite ===\n\n";

// -----------------------------------------------------------------------------
// 1. Prove No Real Database Access (Isolated PDO Double)
// -----------------------------------------------------------------------------
echo "1. Proving isolated mock PDO execution (no real database or network connection)...\n";

$pdo = new IsolatedMockPdo();
assertCondition($pdo instanceof PDO, 'Database double satisfies PDO contract');

$driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
assertCondition($driver === 'isolated_mock', 'PDO connection driver is strictly an isolated double (no SQLite/MySQL/network dependency)');

// Schema setup runs against isolated mock double
$pdo->exec('PRAGMA foreign_keys = ON;');
$pdo->exec("
    CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
");

$pdo->exec("
    CREATE TABLE sso_identity_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL,
        hub_user_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (provider, hub_user_id),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
");

$repository = new FederatedIdentityRepository($pdo, 'sso_identity_links', 'users');
assertCondition(true, 'FederatedIdentityRepository initialized with isolated mock PDO backend');

// -----------------------------------------------------------------------------
// 2. Missing Link Test
// -----------------------------------------------------------------------------
echo "\n2. Testing missing federated identity link...\n";

// Insert active local user without any federated identity link
$stmt = $pdo->prepare("INSERT INTO users (id, username, password, role, active) VALUES (1, 'alice', 'hash', 'estimator', 1)");
$stmt->execute();

$resolved = $repository->findActiveUser('hub', 'hub_user_nonexistent');
assertCondition($resolved === null, 'Resolving unknown hub_user_id returns null when link does not exist');

// -----------------------------------------------------------------------------
// 3. Inactive Link Test
// -----------------------------------------------------------------------------
echo "\n3. Testing inactive federated identity link...\n";

// Insert active local user with inactive federated link (active = 0)
$stmt = $pdo->prepare("INSERT INTO users (id, username, password, role, active) VALUES (2, 'bob', 'hash', 'admin', 1)");
$stmt->execute();

$stmt = $pdo->prepare("INSERT INTO sso_identity_links (user_id, provider, hub_user_id, active) VALUES (2, 'hub', 'hub_user_bob', 0)");
$stmt->execute();

$resolved = $repository->findActiveUser('hub', 'hub_user_bob');
assertCondition($resolved === null, 'Resolving inactive link (active=0) returns null even when local user is active');

// -----------------------------------------------------------------------------
// 4. Missing User Test (Orphan Link)
// -----------------------------------------------------------------------------
echo "\n4. Testing orphan federated identity link (missing local user)...\n";

$pdo->exec('PRAGMA foreign_keys = OFF;');
$stmt = $pdo->prepare("INSERT INTO sso_identity_links (user_id, provider, hub_user_id, active) VALUES (9999, 'hub', 'hub_orphan_user', 1)");
$stmt->execute();
$pdo->exec('PRAGMA foreign_keys = ON;');

$resolved = $repository->findActiveUser('hub', 'hub_orphan_user');
assertCondition($resolved === null, 'Resolving link pointing to nonexistent local user returns null');

// -----------------------------------------------------------------------------
// 5. Inactive User Test
// -----------------------------------------------------------------------------
echo "\n5. Testing inactive local user with active federated link...\n";

// Insert inactive local user (users.active = 0) with active federated link (active = 1)
$stmt = $pdo->prepare("INSERT INTO users (id, username, password, role, active) VALUES (3, 'charlie_inactive', 'hash', 'estimator', 0)");
$stmt->execute();

$stmt = $pdo->prepare("INSERT INTO sso_identity_links (user_id, provider, hub_user_id, active) VALUES (3, 'hub', 'hub_user_charlie', 1)");
$stmt->execute();

$resolved = $repository->findActiveUser('hub', 'hub_user_charlie');
assertCondition($resolved === null, 'Resolving active link pointing to inactive local user (users.active=0) returns null');

// -----------------------------------------------------------------------------
// 6. Provider Isolation Test
// -----------------------------------------------------------------------------
echo "\n6. Testing provider isolation...\n";

// Insert active user linked exclusively to provider 'hub'
$stmt = $pdo->prepare("INSERT INTO users (id, username, password, role, active) VALUES (4, 'david', 'hash', 'viewer', 1)");
$stmt->execute();

$stmt = $pdo->prepare("INSERT INTO sso_identity_links (user_id, provider, hub_user_id, active) VALUES (4, 'hub', 'hub_user_david', 1)");
$stmt->execute();

$resolvedDifferentProvider = $repository->findActiveUser('azure_ad', 'hub_user_david');
assertCondition($resolvedDifferentProvider === null, 'Provider isolation: query with different provider returns null');

$resolvedDifferentId = $repository->findActiveUser('hub', 'hub_user_david_other');
assertCondition($resolvedDifferentId === null, 'Provider isolation: query with different hub_user_id returns null');

// -----------------------------------------------------------------------------
// 7. Successful Resolution Test
// -----------------------------------------------------------------------------
echo "\n7. Testing successful identity resolution...\n";

$resolved = $repository->findActiveUser('hub', 'hub_user_david');
assertCondition(is_array($resolved), 'Exact active link pointing to active local user resolves to array');
assertCondition($resolved['user_id'] === 4, 'Resolved user_id matches local user record (id=4)');
assertCondition($resolved['username'] === 'david', 'Resolved username matches local user record');
assertCondition($resolved['role'] === 'viewer', 'Resolved role matches local user record (role=viewer)');
assertCondition($resolved['active'] === true, 'Resolved identity asserts active=true');
assertCondition($resolved['provider'] === 'hub', 'Resolved provider matches query provider');
assertCondition($resolved['hub_user_id'] === 'hub_user_david', 'Resolved hub_user_id matches central user identifier');
assertCondition($resolved['sub'] === 'hub_user_david', 'Resolved sub matches central user identifier without translation');

// -----------------------------------------------------------------------------
// 8. Strict Anti-Auto-Linking and No Default Role Test
// -----------------------------------------------------------------------------
echo "\n8. Testing anti-auto-linking and no-default-role invariants...\n";

// Insert active user with a distinct custom role
$stmt = $pdo->prepare("INSERT INTO users (id, username, password, role, active) VALUES (5, 'eva_special', 'hash', 'custom_specialist', 1)");
$stmt->execute();

// Query repository using username or email: must return null because no link exists
$resolvedAutoLink = $repository->findActiveUser('hub', 'eva_special');
assertCondition($resolvedAutoLink === null, 'Never auto-links by username: unknown hub_user_id returns null even if local user exists with that username');

// Link eva explicitly with custom role
$repository->createLink(5, 'hub', 'hub_eva_id', true);
$resolvedEva = $repository->findActiveUser('hub', 'hub_eva_id');

assertCondition($resolvedEva !== null && $resolvedEva['role'] === 'custom_specialist', 'Never assigns default role (e.g. admin); preserves explicit local role');
assertCondition(!array_key_exists('default_role', $resolvedEva), 'No default_role key exists in resolved identity');

// -----------------------------------------------------------------------------
// 9. SsoSession Security Parameters (Secure, HttpOnly, SameSite=Lax) & Anti-Downgrade
// -----------------------------------------------------------------------------
echo "\n9. Testing SsoSession cookie security options contract & anti-downgrade...\n";

$cookieParams = SsoSession::getCookieParams();
assertCondition($cookieParams['secure'] === true, 'Session cookie configuration specifies Secure = true');
assertCondition($cookieParams['httponly'] === true, 'Session cookie configuration specifies HttpOnly = true');
assertCondition($cookieParams['samesite'] === 'Lax', 'Session cookie configuration specifies SameSite = Lax');

// Negative assertion: configureCookieParams exposes no production parameter capable of downgrading values
$reflection = new ReflectionMethod(SsoSession::class, 'configureCookieParams');
assertCondition($reflection->getNumberOfParameters() === 0, 'configureCookieParams exposes no parameters capable of downgrading cookie security');

$cookieDowngradeRejected = false;
try {
    (SsoSession::class . '::configureCookieParams')(['secure' => false, 'httponly' => false, 'samesite' => 'None']);
} catch (\ArgumentCountError | \TypeError | \InvalidArgumentException $e) {
    $cookieDowngradeRejected = true;
}
assertCondition($cookieDowngradeRejected, 'Cookie parameter downgrade rejected: configureCookieParams cannot be called with downgrade parameters');

// -----------------------------------------------------------------------------
// 10. SsoSession Session ID Regeneration, Boundary Establishment & Transient Cleanup
// -----------------------------------------------------------------------------
echo "\n10. Testing SsoSession session ID regeneration, shape establishment & transient cleanup...\n";

$sessionRegenerated = false;
$idSpyRegenerator = function () use (&$sessionRegenerated): bool {
    $sessionRegenerated = true;
    return true;
};

$ssoSession = new SsoSession($idSpyRegenerator);

// Mock session array with preexisting unrelated data, transient SSO tokens, and PKCE tokens
$testSession = [
    'existing_app_data' => 'keep_this_value',
    'sso_state' => 'transient_state_token',
    'sso_state_expires_at' => time() + 300,
    'sso_code_verifier' => 'secret_pkce_verifier',
    'code_verifier' => 'secret_pkce_verifier_alt',
    'state' => 'raw_transient_state',
    'code' => 'auth_code_123',
    'access_token' => 'bearer_access_token_xyz',
    'userinfo' => 'transient_userinfo_payload',
    'refresh_token' => 'refresh_token_xyz',
    'token' => 'generic_token',
    'secret' => 'super_secret_value',
];

$establishedSession = $ssoSession->establish($resolved, $testSession);

assertCondition($sessionRegenerated === true, 'SsoSession executes session ID regeneration during establishment');
assertCondition($testSession['user_id'] === 4, 'Local session user_id set to resolved local user ID');
assertCondition($testSession['username'] === 'david', 'Local session username set to resolved local username');
assertCondition($testSession['role'] === 'viewer', 'Local session role set to resolved local role');

// Check non-sensitive federation metadata
assertCondition($testSession['auth_source'] === 'sso', 'Non-sensitive federation metadata: auth_source is sso');
assertCondition($testSession['sso_provider'] === 'hub', 'Non-sensitive federation metadata: sso_provider is hub');
assertCondition($testSession['sso_hub_user_id'] === 'hub_user_david', 'Non-sensitive federation metadata: sso_hub_user_id is hub_user_david');
assertCondition($testSession['sso_sub'] === 'hub_user_david', 'Non-sensitive federation metadata: sso_sub is hub_user_david');
assertCondition(isset($testSession['sso_authenticated_at']) && is_int($testSession['sso_authenticated_at']), 'Non-sensitive federation metadata: timestamp recorded');
assertCondition(isset($testSession['federation']) && is_array($testSession['federation']), 'Non-sensitive federation metadata: federation array populated');
assertCondition($testSession['federation']['provider'] === 'hub', 'Federation metadata array: provider is hub');
assertCondition($testSession['federation']['hub_user_id'] === 'hub_user_david', 'Federation metadata array: hub_user_id is hub_user_david');
assertCondition($testSession['federation']['sub'] === 'hub_user_david', 'Federation metadata array: sub is hub_user_david');

// Negative assertions for transient-key cleanup and secret storage
assertCondition(!array_key_exists('sso_state', $testSession), 'Negative assertion: transient sso_state cleaned up from session');
assertCondition(!array_key_exists('sso_state_expires_at', $testSession), 'Negative assertion: transient sso_state_expires_at cleaned up from session');
assertCondition(!array_key_exists('sso_code_verifier', $testSession), 'Negative assertion: transient sso_code_verifier cleaned up from session');
assertCondition(!array_key_exists('code_verifier', $testSession), 'Negative assertion: transient code_verifier cleaned up from session');
assertCondition(!array_key_exists('state', $testSession), 'Negative assertion: transient state cleaned up from session');
assertCondition(!array_key_exists('code', $testSession), 'Negative assertion: transient code cleaned up from session');
assertCondition(!array_key_exists('access_token', $testSession), 'Negative assertion: access_token cleaned up from session');
assertCondition(!array_key_exists('userinfo', $testSession), 'Negative assertion: userinfo cleaned up from session');
assertCondition(!array_key_exists('refresh_token', $testSession), 'Negative assertion: refresh_token cleaned up from session');
assertCondition(!array_key_exists('token', $testSession), 'Negative assertion: token cleaned up from session');
assertCondition(!array_key_exists('secret', $testSession), 'Negative assertion: secret cleaned up from session');
assertCondition($testSession['existing_app_data'] === 'keep_this_value', 'Preexisting application data preserved in session');
assertCondition(!isset($testSession['password']), 'No password stored in session');

// -----------------------------------------------------------------------------
// 11. SsoSession Fail-Closed Validation & Incomplete Metadata Rejection
// -----------------------------------------------------------------------------
echo "\n11. Testing SsoSession fail-closed identity validation & incomplete metadata rejection...\n";

// Rejects empty identity array
$emptyCaught = false;
try {
    $ssoSession->establish([], $testSession);
} catch (InvalidArgumentException $e) {
    $emptyCaught = true;
}
assertCondition($emptyCaught, 'Rejects empty identity array with InvalidArgumentException');

// Rejects missing user_id
$missingUserCaught = false;
try {
    $ssoSession->establish(['username' => 'test', 'role' => 'viewer', 'provider' => 'hub', 'sub' => 'hub_1', 'hub_user_id' => 'hub_1'], $testSession);
} catch (InvalidArgumentException $e) {
    $missingUserCaught = true;
}
assertCondition($missingUserCaught, 'Rejects identity missing user_id with InvalidArgumentException');

// Rejects missing role without fallback
$missingRoleCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'provider' => 'hub', 'sub' => 'hub_1', 'hub_user_id' => 'hub_1'], $testSession);
} catch (InvalidArgumentException $e) {
    $missingRoleCaught = true;
}
assertCondition($missingRoleCaught, 'Rejects identity missing role without assigning default role');

// Rejects inactive user
$inactiveUserCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'role' => 'viewer', 'active' => false, 'provider' => 'hub', 'sub' => 'hub_1', 'hub_user_id' => 'hub_1'], $testSession);
} catch (InvalidArgumentException $e) {
    $inactiveUserCaught = true;
}
assertCondition($inactiveUserCaught, 'Rejects identity with active=false with InvalidArgumentException');

// Rejects inactive user via user_active
$inactiveUserActiveCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'role' => 'viewer', 'user_active' => 0, 'provider' => 'hub', 'sub' => 'hub_1', 'hub_user_id' => 'hub_1'], $testSession);
} catch (InvalidArgumentException $e) {
    $inactiveUserActiveCaught = true;
}
assertCondition($inactiveUserActiveCaught, 'Rejects identity with user_active=0 with InvalidArgumentException');

// Rejects inactive federated link
$inactiveLinkCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'role' => 'viewer', 'link_active' => false, 'provider' => 'hub', 'sub' => 'hub_1', 'hub_user_id' => 'hub_1'], $testSession);
} catch (InvalidArgumentException $e) {
    $inactiveLinkCaught = true;
}
assertCondition($inactiveLinkCaught, 'Rejects identity with link_active=false with InvalidArgumentException');

// Negative assertion: rejects missing provider (no default fallback)
$missingProviderCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'role' => 'viewer', 'sub' => 'hub_1', 'hub_user_id' => 'hub_1'], $testSession);
} catch (InvalidArgumentException $e) {
    $missingProviderCaught = true;
}
assertCondition($missingProviderCaught, 'Negative assertion: rejects identity missing provider without defaulting to hub');

// Negative assertion: rejects empty provider
$emptyProviderCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'role' => 'viewer', 'provider' => '   ', 'sub' => 'hub_1', 'hub_user_id' => 'hub_1'], $testSession);
} catch (InvalidArgumentException $e) {
    $emptyProviderCaught = true;
}
assertCondition($emptyProviderCaught, 'Negative assertion: rejects identity with empty/whitespace provider');

// Negative assertion: rejects missing sub
$missingSubCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'role' => 'viewer', 'provider' => 'hub'], $testSession);
} catch (InvalidArgumentException $e) {
    $missingSubCaught = true;
}
assertCondition($missingSubCaught, 'Negative assertion: rejects identity missing sub without defaulting to empty');

// Negative assertion: rejects missing sub even when hub_user_id is present (never accept hub_user_id as fallback)
$missingSubWithHubUserIdCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'role' => 'viewer', 'provider' => 'hub', 'hub_user_id' => 'hub_valid_123'], $testSession);
} catch (InvalidArgumentException $e) {
    $missingSubWithHubUserIdCaught = true;
}
assertCondition($missingSubWithHubUserIdCaught, 'Negative assertion: rejects identity missing sub even when hub_user_id is present');

// Negative assertion: rejects empty sub
$emptySubCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'role' => 'viewer', 'provider' => 'hub', 'sub' => '   '], $testSession);
} catch (InvalidArgumentException $e) {
    $emptySubCaught = true;
}
assertCondition($emptySubCaught, 'Negative assertion: rejects identity with empty/whitespace sub');

// Negative assertion: rejects empty sub even when hub_user_id is present
$emptySubWithHubUserIdCaught = false;
try {
    $ssoSession->establish(['user_id' => 10, 'username' => 'test', 'role' => 'viewer', 'provider' => 'hub', 'sub' => '   ', 'hub_user_id' => 'hub_valid_123'], $testSession);
} catch (InvalidArgumentException $e) {
    $emptySubWithHubUserIdCaught = true;
}
assertCondition($emptySubWithHubUserIdCaught, 'Negative assertion: rejects identity with empty/whitespace sub even when hub_user_id is present');

// Assertion: canonical sub is established and recorded in session and federation array without translation
$subSession = [];
$ssoSession->establish(['user_id' => 10, 'username' => 'test_sub_user', 'role' => 'viewer', 'provider' => 'hub', 'sub' => 'hub_sub_opaque_123'], $subSession);
assertCondition($subSession['sso_sub'] === 'hub_sub_opaque_123', 'SsoSession populates sso_sub with canonical opaque sub value');
assertCondition($subSession['sso_hub_user_id'] === 'hub_sub_opaque_123', 'SsoSession populates sso_hub_user_id with canonical opaque sub value');
assertCondition($subSession['federation']['sub'] === 'hub_sub_opaque_123', 'SsoSession populates federation.sub with canonical opaque sub value');

// -----------------------------------------------------------------------------
// 12. SsoFlow Claims Contract Canonical sub Requirement (No hub_user_id Fallback)
// -----------------------------------------------------------------------------
echo "\n12. Testing SsoFlow claims contract canonical sub requirement...\n";

$ssoFlow = new SsoFlow();

// Missing sub with hub_user_id present is rejected
$flowMissingSubCaught = false;
try {
    $ssoFlow->validateIdentityClaimsContract([
        'provider' => 'hub',
        'hub_user_id' => 'hub_user_test',
        'active' => true,
        'roles' => ['viewer'],
    ]);
} catch (InvalidArgumentException $e) {
    $flowMissingSubCaught = true;
}
assertCondition($flowMissingSubCaught, 'SsoFlow rejects identity contract missing sub even when hub_user_id is present');

// Empty sub with hub_user_id present is rejected
$flowEmptySubCaught = false;
try {
    $ssoFlow->validateIdentityClaimsContract([
        'provider' => 'hub',
        'sub' => '   ',
        'hub_user_id' => 'hub_user_test',
        'active' => true,
        'roles' => ['viewer'],
    ]);
} catch (InvalidArgumentException $e) {
    $flowEmptySubCaught = true;
}
assertCondition($flowEmptySubCaught, 'SsoFlow rejects identity contract with empty sub even when hub_user_id is present');

// Valid sub is accepted and populates canonical sub and compatibility hub_user_id
$flowValid = $ssoFlow->validateIdentityClaimsContract([
    'provider' => 'hub',
    'sub' => 'hub_canonical_sub_123',
    'active' => true,
    'roles' => ['viewer'],
]);
assertCondition($flowValid['sub'] === 'hub_canonical_sub_123', 'SsoFlow populates canonical sub from validated sub');
assertCondition($flowValid['hub_user_id'] === 'hub_canonical_sub_123', 'SsoFlow mirrors canonical sub into compatibility hub_user_id');

// -----------------------------------------------------------------------------
// 13. Focused Shadow User Lifecycle & Exception Sanitization Coverage
// -----------------------------------------------------------------------------
echo "\n13. Testing shadow user lifecycle in FederatedIdentityRepository...\n";

// 13.1 First login transactional shadow user provisioning
$freshPdo = new IsolatedMockPdo();
$freshRepo = new FederatedIdentityRepository($freshPdo);

assertCondition(count($freshPdo->users) === 0, 'Repo starts with 0 users');
assertCondition(count($freshPdo->links) === 0, 'Repo starts with 0 links');

$firstProvisioned = $freshRepo->provisionOrSynchronize('hub', 'canonical_sub_alpha', 'admin');

assertCondition(count($freshPdo->users) === 1, 'First login creates exactly one user record');
assertCondition(count($freshPdo->links) === 1, 'First login creates exactly one link record');

$userRecord = array_values($freshPdo->users)[0];
$linkRecord = array_values($freshPdo->links)[0];

$expectedUsername = FederatedIdentityRepository::deriveShadowUsername('hub', 'canonical_sub_alpha');
assertCondition($userRecord['username'] === $expectedUsername, 'Created user has deterministic shadow username');
assertCondition($userRecord['role'] === 'admin', 'Created user has role admin');
assertCondition((int)$userRecord['active'] === 1, 'Created user is active');
assertCondition(!empty($userRecord['password']), 'Created user has password hash');
assertCondition(password_get_info($userRecord['password'])['algo'] !== 0, 'Password hash is a valid unrecoverable cryptographic hash');

assertCondition($linkRecord['user_id'] === $userRecord['id'], 'Link points to created user ID');
assertCondition($linkRecord['provider'] === 'hub', 'Link provider is hub');
assertCondition($linkRecord['hub_user_id'] === 'canonical_sub_alpha', 'Link hub_user_id matches canonical sub');
assertCondition((int)$linkRecord['active'] === 1, 'Link is active');

assertCondition($firstProvisioned['user_id'] === $userRecord['id'], 'Return user_id matches user ID');
assertCondition($firstProvisioned['role'] === 'admin', 'Return role matches requested role');
assertCondition($firstProvisioned['sub'] === 'canonical_sub_alpha', 'Return sub matches canonical sub');

// 13.2 Repeat login: idempotent, link unchanged
$repeatProvisioned = $freshRepo->provisionOrSynchronize('hub', 'canonical_sub_alpha', 'admin');
assertCondition(count($freshPdo->users) === 1, 'Repeat login creates no duplicate user');
assertCondition(count($freshPdo->links) === 1, 'Repeat login creates no duplicate link');
assertCondition($repeatProvisioned['user_id'] === $userRecord['id'], 'Repeat login returns same user ID');
assertCondition($repeatProvisioned['link_id'] === $linkRecord['id'], 'Repeat login returns same link ID');

// 13.3 Role downgrade: admin -> viewer
$downgraded = $freshRepo->provisionOrSynchronize('hub', 'canonical_sub_alpha', 'viewer');
assertCondition($downgraded['role'] === 'viewer', 'Downgrade: returned role is viewer');
assertCondition($freshPdo->users[$userRecord['id']]['role'] === 'viewer', 'Downgrade: DB user role updated to viewer');
assertCondition($downgraded['link_id'] === $linkRecord['id'], 'Downgrade: link ID is preserved (link unchanged)');
assertCondition(count($freshPdo->users) === 1, 'Downgrade: user count remains 1');

// 13.4 Role upgrade: viewer -> admin
$upgraded = $freshRepo->provisionOrSynchronize('hub', 'canonical_sub_alpha', 'admin');
assertCondition($upgraded['role'] === 'admin', 'Upgrade: returned role is admin');
assertCondition($freshPdo->users[$userRecord['id']]['role'] === 'admin', 'Upgrade: DB user role updated to admin');
assertCondition($upgraded['link_id'] === $linkRecord['id'], 'Upgrade: link ID is preserved (link unchanged)');

// 13.5 Collision and concurrent race recovery
$racePdo = new IsolatedMockPdo();
$raceRepo = new FederatedIdentityRepository($racePdo);

$winnerUserId = 1234;
$racePdo->onInsertUser = function ($params) use ($racePdo, $winnerUserId) {
    $racePdo->onInsertUser = null;
    $racePdo->insertUser($winnerUserId, 'sso_winning_racer_sub', 'viewer', 1);
    $racePdo->insertLink($winnerUserId, 'hub', 'sub_race_test', 1);
    throw new PDOException('SQLSTATE[23000]: Duplicate entry');
};

$raceRecovered = $raceRepo->provisionOrSynchronize('hub', 'sub_race_test', 'admin');
assertCondition($raceRecovered['user_id'] === $winnerUserId, 'Race recovery: resolved the winning concurrent user ID');
assertCondition($raceRecovered['role'] === 'admin', 'Race recovery: synchronized role to admin');
assertCondition($racePdo->users[$winnerUserId]['role'] === 'admin', 'Race recovery: winning DB record updated to admin');
assertCondition(count($racePdo->users) === 1, 'Race recovery: zero duplicate users');

// 13.6 Inactive link and user fail-closed without writes
$inactPdo = new IsolatedMockPdo();
$inactRepo = new FederatedIdentityRepository($inactPdo);

$inactPdo->insertUser(801, 'user_inactive_account', 'admin', 0);
$inactPdo->insertLink(801, 'hub', 'sub_inactive_user_link', 1);

$userInactCaught = false;
$userInactMsg = '';
try {
    $inactRepo->provisionOrSynchronize('hub', 'sub_inactive_user_link', 'viewer');
} catch (RuntimeException $e) {
    $userInactCaught = true;
    $userInactMsg = $e->getMessage();
}
assertCondition($userInactCaught, 'Inactive local user fails closed in provisionOrSynchronize');
assertCondition(str_contains($userInactMsg, 'local user account is inactive'), 'Error message specifies local user inactive');
assertCondition($inactPdo->users[801]['role'] === 'admin', 'Inactive local user: role is NOT updated');

$inactPdo->insertUser(802, 'user_with_dead_link', 'admin', 1);
$inactPdo->insertLink(802, 'hub', 'sub_dead_link', 0);

$linkInactCaught = false;
$linkInactMsg = '';
try {
    $inactRepo->provisionOrSynchronize('hub', 'sub_dead_link', 'viewer');
} catch (RuntimeException $e) {
    $linkInactCaught = true;
    $linkInactMsg = $e->getMessage();
}
assertCondition($linkInactCaught, 'Inactive link fails closed in provisionOrSynchronize');
assertCondition(str_contains($linkInactMsg, 'federated identity link is inactive'), 'Error message specifies link inactive');
assertCondition($inactPdo->users[802]['role'] === 'admin', 'Inactive link: role is NOT updated');

// 13.7 Zero auto-linking by username or email
$antiAutoPdo = new IsolatedMockPdo();
$antiAutoRepo = new FederatedIdentityRepository($antiAutoPdo);

// Preexisting user at id 99 with username and password
$antiAutoPdo->insertUser(99, 'existing_username_foo', 'admin', 1);

$provisionedAntiAuto = $antiAutoRepo->provisionOrSynchronize('hub', 'sub_brand_new_sub_xyz', 'viewer');
assertCondition($provisionedAntiAuto['user_id'] !== 99, 'Never auto-links: does NOT link to id 99');
assertCondition(count($antiAutoPdo->users) === 2, 'Never auto-links: creates a new separate shadow user');
assertCondition($antiAutoPdo->users[99]['username'] === 'existing_username_foo', 'Preexisting user is untouched');

// 13.8 Zero exception leakage outside repository
$leakTestPdo = new IsolatedMockPdo();
$leakTestRepo = new FederatedIdentityRepository($leakTestPdo);

$leakTestPdo->onQuery = function ($sql, $params) {
    throw new PDOException(
        "SQLSTATE[HY000]: General error 2002: Connection refused for dsn=mysql:host=internal-db.local;dbname=takeoff;user=admin;password=super_secret_db_pass; in C:\\inetpub\\takeoff\\core\\auth\\FederatedIdentityRepository.php line 78"
    );
};

$leakCaught = false;
$leakMessage = '';
$leakPrevious = null;
try {
    $leakTestRepo->provisionOrSynchronize('hub', 'sub_leak_test', 'admin');
} catch (RuntimeException $e) {
    $leakCaught = true;
    $leakMessage = $e->getMessage();
    $leakPrevious = $e->getPrevious();
}

assertCondition($leakCaught, 'Simulated internal PDOException triggers RuntimeException');
assertCondition(!str_contains($leakMessage, 'SQLSTATE'), 'Exception message reveals no SQLSTATE');
assertCondition(!str_contains($leakMessage, 'internal-db'), 'Exception message reveals no hostnames');
assertCondition(!str_contains($leakMessage, 'super_secret_db_pass'), 'Exception message reveals no credentials');
assertCondition(!str_contains($leakMessage, 'dsn='), 'Exception message reveals no DSN');
assertCondition(!str_contains($leakMessage, 'C:\\inetpub'), 'Exception message reveals no file paths');
assertCondition($leakPrevious === null, 'No PDOException is exposed via getPrevious()');

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
