<?php
declare(strict_types=1);

/**
 * Runtime Test Suite for Takeoff SSO Flagged Login, Callback, Local Logout and Rollback Wiring.
 * Task: TASK-0272
 *
 * Acceptance Criteria Covered:
 * 1. SSO disabled/unconfigured: no automatic Hub redirect, SSO endpoints fail closed,
 *    local login preserved as immediate rollback path.
 * 2. SSO enabled: single-use state, PKCE S256, redirects only to HTTPS authorize endpoint.
 * 3. Callback: exact order (validate state, consume verifier, token+userinfo, resolve link,
 *    SsoAuthorization, SsoSession); failures create no partial session.
 * 4. Local login: parameterized lookup, password_verify, active-user, explicit-role,
 *    session ID regeneration; injected doubles, no real database.
 * 5. CSRF protection on POST, callback relies on mandatory OAuth state, local logout
 *    destroys only app session and cookie, Hub unavailability falls back with sanitized message.
 * 6. SSO button visible only when enabled, logout makes no central/network request,
 *    disabling flag immediately restores local-only flow, .htaccess routing contract.
 * 7. Tests cover flag off, successful initiation and callback, rejected callback,
 *    inactive identity/user, disallowed role, sanitized errors, local session, logout,
 *    local fallback/rollback, and zero OIDC/openid/id_token/nonce behavior.
 */

// Minimum namespaced League GenericProvider, Token, and HTTP doubles for standalone testing without vendor
if (!interface_exists('League\OAuth2\Client\Token\AccessTokenInterface', false)) {
    eval('
        namespace League\OAuth2\Client\Token;

        interface AccessTokenInterface
        {
            public function getToken(): string;
            public function __toString(): string;
        }

        class AccessToken implements AccessTokenInterface
        {
            protected array $values;

            public function __construct(array $options = [])
            {
                $this->values = $options;
            }

            public function getToken(): string
            {
                return (string)($this->values["access_token"] ?? $this->values["token"] ?? "");
            }

            public function getValues(): array
            {
                return $this->values;
            }

            public function getExpires(): ?int
            {
                return isset($this->values["expires_in"]) ? time() + (int)$this->values["expires_in"] : null;
            }

            public function hasExpired(): bool
            {
                return false;
            }

            public function __toString(): string
            {
                return $this->getToken();
            }
        }
    ');
}

if (!class_exists('League\OAuth2\Client\Provider\Exception\IdentityProviderException', false)) {
    eval('
        namespace League\OAuth2\Client\Provider\Exception;

        class IdentityProviderException extends \Exception
        {
            protected mixed $response;

            public function __construct(string $message = "", int $code = 0, mixed $response = null)
            {
                $this->response = $response;
                parent::__construct($message, $code);
            }

            public function getResponseBody(): mixed
            {
                return $this->response;
            }
        }
    ');
}

if (!class_exists('League\OAuth2\Client\Provider\GenericProvider', false)) {
    eval('
        namespace League\OAuth2\Client\Provider;

        use League\OAuth2\Client\Token\AccessToken;
        use League\OAuth2\Client\Token\AccessTokenInterface;

        class GenericProvider
        {
            protected array $options;
            protected array $collaborators;

            public static ?\Throwable $mockException = null;
            public static ?AccessTokenInterface $mockAccessToken = null;
            public static ?array $mockUserInfo = null;

            public function __construct(array $options = [], array $collaborators = [])
            {
                $this->options = $options;
                $this->collaborators = $collaborators;
            }

            public function getAuthorizationUrl(array $options = []): string
            {
                if (self::$mockException !== null) {
                    throw self::$mockException;
                }

                $baseUrl = $this->options["urlAuthorize"] ?? "https://hub.example.com/oauth/authorize";
                $params = array_merge([
                    "client_id" => $this->options["clientId"] ?? "",
                    "redirect_uri" => $this->options["redirectUri"] ?? "",
                    "response_type" => "code",
                ], $options);

                $separator = str_contains($baseUrl, "?") ? "&" : "?";
                return $baseUrl . $separator . http_build_query($params);
            }

            public function getAccessToken(mixed $grant, array $options = []): AccessTokenInterface
            {
                if (self::$mockException !== null) {
                    throw self::$mockException;
                }

                if (self::$mockAccessToken !== null) {
                    return self::$mockAccessToken;
                }

                $code = (string)($options["code"] ?? "test_auth_code");
                return new AccessToken([
                    "access_token" => "mock_access_token_" . hash("sha256", $code),
                    "token_type" => "Bearer",
                    "expires_in" => 3600,
                ]);
            }

            public function getAuthenticatedRequest(string $method, string $url, mixed $token, array $options = []): mixed
            {
                if (self::$mockException !== null) {
                    throw self::$mockException;
                }

                $tokenString = ($token instanceof AccessTokenInterface) ? $token->getToken() : (string)$token;
                return [
                    "method" => $method,
                    "url" => $url,
                    "token" => $tokenString,
                    "options" => $options,
                ];
            }

            public function getParsedResponse(mixed $request): array
            {
                if (self::$mockException !== null) {
                    throw self::$mockException;
                }

                if (self::$mockUserInfo !== null) {
                    return self::$mockUserInfo;
                }

                return [
                    "sub" => "hub_alice_001",
                    "username" => "alice_admin",
                    "display_name" => "Alice Admin",
                    "email" => "alice@example.com",
                    "active" => true,
                    "roles" => ["admin"],
                ];
            }

            public function getState(): ?string
            {
                return null;
            }

            public static function setMockUserInfo(?array $info): void
            {
                self::$mockUserInfo = $info;
            }

            public static function setMockException(?\Throwable $e): void
            {
                self::$mockException = $e;
            }

            public static function setMockAccessToken(?AccessTokenInterface $token): void
            {
                self::$mockAccessToken = $token;
            }

            public static function reset(): void
            {
                self::$mockException = null;
                self::$mockAccessToken = null;
                self::$mockUserInfo = null;
            }
        }
    ');
}

if (!interface_exists('GuzzleHttp\ClientInterface', false)) {
    eval('
        namespace GuzzleHttp;

        interface ClientInterface
        {
            public const MAJOR_VERSION = 7;
        }
    ');
}

require_once dirname(__DIR__) . '/config/SsoConfig.php';
require_once dirname(__DIR__) . '/core/auth/IdentityProfile.php';
require_once dirname(__DIR__) . '/core/auth/IdentityProviderClient.php';
require_once dirname(__DIR__) . '/core/auth/SsoFlow.php';
require_once dirname(__DIR__) . '/core/auth/OAuthIdentityProviderClient.php';
require_once dirname(__DIR__) . '/core/auth/FederatedIdentityRepository.php';
require_once dirname(__DIR__) . '/core/auth/SsoAuthorization.php';
require_once dirname(__DIR__) . '/core/auth/SsoSession.php';

use Takeoff\Config\SsoConfig;
use Takeoff\Core\Auth\IdentityProfile;
use Takeoff\Core\Auth\IdentityProviderClient;
use Takeoff\Core\Auth\SsoFlow;
use Takeoff\Core\Auth\OAuthIdentityProviderClient;
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
 * Isolated in-memory PDO double satisfying the PDO contract without real database or SQLite extension.
 */
class IsolatedMockPdo extends PDO
{
    /** @var array<int, array{id: int, username: string, password: string, role: string, active: int}> */
    public array $users = [];

    /** @var array<int, array{id: int, user_id: int, provider: string, hub_user_id: string, active: int}> */
    public array $links = [];

    public int $nextLinkId = 1;

    public function __construct()
    {
        // Standalone double: avoids real DB or SQLite extensions
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

    public function insertUser(int $id, string $username, string $passwordHash, string $role, int $active): void
    {
        $this->users[$id] = [
            'id' => $id,
            'username' => $username,
            'password' => $passwordHash,
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
 * Isolated PDOStatement double simulating statement execution and fetching.
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

        // Local login query: SELECT id, username, password, role, active FROM users WHERE username = :username
        if (preg_match('/SELECT\s+.*FROM\s+users\s+WHERE\s+username\s*=\s*:username/i', $this->sql)) {
            $username = (string)($params[':username'] ?? $params['username'] ?? '');
            foreach ($this->pdo->users as $u) {
                if ($u['username'] === $username) {
                    $this->resultRow = [
                        'id' => $u['id'],
                        'username' => $u['username'],
                        'password' => $u['password'],
                        'role' => $u['role'],
                        'active' => $u['active'],
                    ];
                    return true;
                }
            }
            $this->resultRow = null;
            return true;
        }

        // Federated identity link query: SELECT ... FROM sso_identity_links l INNER JOIN users u ...
        if (preg_match('/SELECT\s+.*FROM\s+\S*sso_identity_links/is', $this->sql)) {
            $provider = (string)($params[':provider'] ?? $params['provider'] ?? '');
            $hubUserId = (string)($params[':hub_user_id'] ?? $params['hub_user_id'] ?? '');

            foreach ($this->pdo->links as $link) {
                if ($link['provider'] === $provider && $link['hub_user_id'] === $hubUserId) {
                    $userId = $link['user_id'];
                    $user = $this->pdo->users[$userId] ?? null;

                    if ($user === null) {
                        continue;
                    }

                    if ((int)$link['active'] !== 1 || (int)$user['active'] !== 1) {
                        continue;
                    }

                    $this->resultRow = [
                        'user_id' => $user['id'],
                        'id' => $user['id'],
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
 * Mock OAuth Identity Provider Client double avoiding network requests.
 */
class MockOAuthClient extends OAuthIdentityProviderClient
{
    private ?IdentityProfile $mockProfile = null;
    private ?\Throwable $mockException = null;

    public function setMockProfile(?IdentityProfile $profile): void
    {
        $this->mockProfile = $profile;
    }

    public function setMockException(?\Throwable $e): void
    {
        $this->mockException = $e;
    }

    public function getAuthorizationUrl(string $state, string $codeChallenge, array $options = []): string
    {
        if ($this->mockException !== null) {
            throw $this->mockException;
        }
        $hubUrl = $this->getConfig()->getAuthorizeUrl();
        $query = http_build_query([
            'client_id' => $this->getConfig()->getClientId(),
            'redirect_uri' => $this->getConfig()->getRedirectUri(),
            'response_type' => 'code',
            'state' => $state,
            'code_challenge' => $codeChallenge,
            'code_challenge_method' => 'S256',
        ]);
        return $hubUrl . '?' . $query;
    }

    public function authenticate(string $code, string $codeVerifier): IdentityProfile
    {
        if ($this->mockException !== null) {
            throw $this->mockException;
        }
        if ($this->mockProfile === null) {
            throw new \RuntimeException('OAuth authentication failed: no profile configured.');
        }
        return $this->mockProfile;
    }
}

echo "=== Running Takeoff SSO D Flagged Login, Callback, Logout & Rollback Runtime Test Suite ===\n\n";

// Helper to reset and capture test harness state
$lastRedirect = null;
$GLOBALS['__TAKEOFF_REDIRECT_HANDLER__'] = function (string $url) use (&$lastRedirect) {
    $lastRedirect = $url;
};

$sessionRegenerated = false;
$GLOBALS['__TAKEOFF_SESSION_REGENERATOR__'] = function () use (&$sessionRegenerated): bool {
    $sessionRegenerated = true;
    return true;
};

// -----------------------------------------------------------------------------
// Section 1: Feature Flag OFF & Immediate Rollback Path
// -----------------------------------------------------------------------------
echo "1. Testing SSO feature flag OFF, fail-closed endpoints & rollback path...\n";

$disabledConfig = new SsoConfig([
    'TAKEOFF_SSO_ENABLED' => false,
    'TAKEOFF_SSO_HUB_BASE_URL' => 'https://hub.example.com',
    'TAKEOFF_SSO_CLIENT_ID' => 'client_id_test',
    'TAKEOFF_SSO_CLIENT_SECRET' => 'secret_test',
    'TAKEOFF_SSO_REDIRECT_URI' => 'https://app.example.com/pages/sso-callback.php',
]);
$GLOBALS['__TAKEOFF_TEST_SSO_CONFIG__'] = $disabledConfig;

// Test 1.1: login.php HTML output with flag off contains local form and hides SSO button
$_SESSION = [];
$_SERVER['REQUEST_METHOD'] = 'GET';
ob_start();
include dirname(__DIR__) . '/pages/login.php';
$loginHtmlDisabled = ob_get_clean();

assertCondition(str_contains($loginHtmlDisabled, 'name="username"'), 'Flag OFF: login page preserves username field');
assertCondition(str_contains($loginHtmlDisabled, 'name="password"'), 'Flag OFF: login page preserves password field');
assertCondition(str_contains($loginHtmlDisabled, 'name="csrf_token"'), 'Flag OFF: login page contains CSRF token');
assertCondition(!str_contains($loginHtmlDisabled, 'btn-sso') && !str_contains($loginHtmlDisabled, 'Single Sign-On'), 'Flag OFF: SSO button is strictly NOT rendered in login page');

// Test 1.2: sso-login.php with flag off fails closed
$lastRedirect = null;
$_SESSION = [];
include dirname(__DIR__) . '/pages/sso-login.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_disabled', 'Flag OFF: sso-login.php redirects to login with sso_disabled');
assertCondition(!isset($_SESSION['sso_state']), 'Flag OFF: sso-login.php does not write state to session');
assertCondition(!isset($_SESSION['sso_code_verifier']), 'Flag OFF: sso-login.php does not write verifier to session');

// Test 1.3: sso-callback.php with flag off fails closed
$lastRedirect = null;
$_SESSION = ['sso_state' => 'transient_state', 'sso_code_verifier' => 'verifier_123'];
$_GET = ['code' => 'auth_code_123', 'state' => 'transient_state'];
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_disabled', 'Flag OFF: sso-callback.php redirects to login with sso_disabled');
assertCondition(!isset($_SESSION['sso_state']), 'Flag OFF: sso-callback.php eliminates transient state');
assertCondition(!isset($_SESSION['user_id']), 'Flag OFF: sso-callback.php creates no user session');

// -----------------------------------------------------------------------------
// Section 2: Local Login Flow (Users Store, Parameterized, password_verify, Active, Roles, CSRF)
// -----------------------------------------------------------------------------
echo "\n2. Testing local login with parameterized lookup, password_verify, active & role checks...\n";

$mockPdo = new IsolatedMockPdo();
$mockPdo->insertUser(1, 'alice_admin', password_hash('SecretPass123!', PASSWORD_DEFAULT), 'admin', 1);
$mockPdo->insertUser(2, 'bob_tech', password_hash('TechPass456!', PASSWORD_DEFAULT), 'technician', 1);
$mockPdo->insertUser(3, 'charlie_viewer', password_hash('ViewerPass789!', PASSWORD_DEFAULT), 'viewer', 1);
$mockPdo->insertUser(4, 'dan_inactive', password_hash('DanPass111!', PASSWORD_DEFAULT), 'admin', 0);
$mockPdo->insertUser(5, 'eve_disallowed_role', password_hash('EvePass222!', PASSWORD_DEFAULT), 'custom_manager', 1);

$GLOBALS['__TAKEOFF_TEST_PDO__'] = $mockPdo;

// Test 2.1: Missing or invalid CSRF token rejected
$_SESSION = ['csrf_token' => 'valid_csrf_token_123'];
$_SERVER['REQUEST_METHOD'] = 'POST';
$_POST = ['csrf_token' => 'tampered_token', 'username' => 'alice_admin', 'password' => 'SecretPass123!'];
ob_start();
include dirname(__DIR__) . '/pages/login.php';
$csrfFailHtml = ob_get_clean();
assertCondition(!isset($_SESSION['user_id']), 'Local login: invalid CSRF establishes no session');
assertCondition(str_contains($csrfFailHtml, 'CSRF'), 'Local login: invalid CSRF returns CSRF validation error');

// Test 2.2: Invalid password rejected
$_SESSION = ['csrf_token' => 'valid_csrf_token_123'];
$_POST = ['csrf_token' => 'valid_csrf_token_123', 'username' => 'alice_admin', 'password' => 'WrongPassword!'];
ob_start();
include dirname(__DIR__) . '/pages/login.php';
$wrongPassHtml = ob_get_clean();
assertCondition(!isset($_SESSION['user_id']), 'Local login: wrong password establishes no session');
assertCondition(str_contains($wrongPassHtml, 'incorrectos'), 'Local login: wrong password displays credentials error');

// Test 2.3: Inactive local user rejected
$_SESSION = ['csrf_token' => 'valid_csrf_token_123'];
$_POST = ['csrf_token' => 'valid_csrf_token_123', 'username' => 'dan_inactive', 'password' => 'DanPass111!'];
ob_start();
include dirname(__DIR__) . '/pages/login.php';
$inactiveHtml = ob_get_clean();
assertCondition(!isset($_SESSION['user_id']), 'Local login: inactive user (active=0) establishes no session');
assertCondition(str_contains($inactiveHtml, 'inactiva'), 'Local login: inactive user displays inactive account error');

// Test 2.4: Disallowed role rejected
$_SESSION = ['csrf_token' => 'valid_csrf_token_123'];
$_POST = ['csrf_token' => 'valid_csrf_token_123', 'username' => 'eve_disallowed_role', 'password' => 'EvePass222!'];
ob_start();
include dirname(__DIR__) . '/pages/login.php';
$disallowedRoleHtml = ob_get_clean();
assertCondition(!isset($_SESSION['user_id']), 'Local login: disallowed role establishes no session');
assertCondition(str_contains($disallowedRoleHtml, 'rol'), 'Local login: disallowed role displays invalid role error');

// Test 2.5: Successful local login
$sessionRegenerated = false;
$lastRedirect = null;
$_SESSION = ['csrf_token' => 'valid_csrf_token_123'];
$_POST = ['csrf_token' => 'valid_csrf_token_123', 'username' => 'alice_admin', 'password' => 'SecretPass123!'];
ob_start();
include dirname(__DIR__) . '/pages/login.php';
ob_end_clean();

assertCondition($sessionRegenerated === true, 'Local login: session ID regenerated upon success');
assertCondition($_SESSION['user_id'] === 1, 'Local login: session user_id populated (id=1)');
assertCondition($_SESSION['username'] === 'alice_admin', 'Local login: session username populated');
assertCondition($_SESSION['role'] === 'admin', 'Local login: session role populated (admin)');
assertCondition($_SESSION['auth_source'] === 'local', 'Local login: session auth_source set to local');
assertCondition($lastRedirect === '/pages/takeoff.php', 'Local login: redirects to /pages/takeoff.php');

// -----------------------------------------------------------------------------
// Section 3: SSO Enabled - Login Button, State, PKCE S256 & HTTPS Authorization URL
// -----------------------------------------------------------------------------
echo "\n3. Testing SSO enabled flow: login button, single-use state & PKCE S256...\n";

$enabledConfig = new SsoConfig([
    'TAKEOFF_SSO_ENABLED' => true,
    'TAKEOFF_SSO_HUB_BASE_URL' => 'https://hub.example.com',
    'TAKEOFF_SSO_CLIENT_ID' => 'client_takeoff_123',
    'TAKEOFF_SSO_CLIENT_SECRET' => 'client_secret_xyz789',
    'TAKEOFF_SSO_REDIRECT_URI' => 'https://app.example.com/pages/sso-callback.php',
]);
$GLOBALS['__TAKEOFF_TEST_SSO_CONFIG__'] = $enabledConfig;

$mockOAuthClient = new MockOAuthClient($enabledConfig);
$GLOBALS['__TAKEOFF_TEST_OAUTH_CLIENT__'] = $mockOAuthClient;

// Test 3.1: SSO button rendered when flag is enabled
$_SESSION = [];
$_SERVER['REQUEST_METHOD'] = 'GET';
ob_start();
include dirname(__DIR__) . '/pages/login.php';
$loginHtmlEnabled = ob_get_clean();

assertCondition(str_contains($loginHtmlEnabled, 'btn-sso') || str_contains($loginHtmlEnabled, 'Single Sign-On'), 'Flag ON: SSO button is visible in login page');
assertCondition(str_contains($loginHtmlEnabled, '/pages/sso-login.php'), 'Flag ON: SSO button links to /pages/sso-login.php');

// Test 3.2: sso-login.php creates single-use state and PKCE S256 verifier/challenge
$lastRedirect = null;
$_SESSION = [];
include dirname(__DIR__) . '/pages/sso-login.php';

assertCondition(isset($_SESSION['sso_state']) && strlen($_SESSION['sso_state']) >= 32, 'SSO initiation: generates high-entropy state (>= 32 chars)');
assertCondition(isset($_SESSION['sso_state_expires_at']) && $_SESSION['sso_state_expires_at'] > time(), 'SSO initiation: sets future state expiration');
assertCondition(isset($_SESSION['sso_code_verifier']) && strlen($_SESSION['sso_code_verifier']) >= 43, 'SSO initiation: stores PKCE code verifier (>= 43 chars) in session');

assertCondition($lastRedirect !== null && str_starts_with($lastRedirect, 'https://hub.example.com/oauth/authorize'), 'SSO initiation: redirects to configured HTTPS authorize URL');
assertCondition(str_contains($lastRedirect, 'state=' . $_SESSION['sso_state']), 'SSO initiation: authorization URL contains generated state parameter');
assertCondition(str_contains($lastRedirect, 'code_challenge='), 'SSO initiation: authorization URL contains code_challenge');
assertCondition(str_contains($lastRedirect, 'code_challenge_method=S256'), 'SSO initiation: authorization URL specifies PKCE S256 method');
assertCondition(!str_contains($lastRedirect, 'code_verifier='), 'SSO initiation: PKCE code_verifier is NEVER exposed in authorize URL');
assertCondition(!str_contains($lastRedirect, 'client_secret_xyz789'), 'SSO initiation: client_secret is NEVER exposed in authorize URL');

// Test 3.3: Real OAuthIdentityProviderClient with isolated League GenericProvider double
$realOAuthClient = new OAuthIdentityProviderClient($enabledConfig);
assertCondition($realOAuthClient->getProvider() instanceof \League\OAuth2\Client\Provider\GenericProvider, 'Real client: instantiates with League GenericProvider double');

$realAuthUrl = $realOAuthClient->getAuthorizationUrl('state_real_test_123', 'challenge_real_test_456');
assertCondition(str_starts_with($realAuthUrl, 'https://hub.example.com/oauth/authorize'), 'Real client + double: builds HTTPS authorization URL');
assertCondition(str_contains($realAuthUrl, 'state=state_real_test_123'), 'Real client + double: contains state parameter');
assertCondition(str_contains($realAuthUrl, 'code_challenge=challenge_real_test_456'), 'Real client + double: contains code_challenge');
assertCondition(str_contains($realAuthUrl, 'code_challenge_method=S256'), 'Real client + double: contains code_challenge_method=S256');

$realToken = $realOAuthClient->exchangeCode('test_auth_code_789', 'verifier_real_test_1234567890123456789012345678901234567890');
assertCondition(str_starts_with($realToken, 'mock_access_token_'), 'Real client + double: exchanges code for token without vendor or network');

$realClaims = $realOAuthClient->getUserInfo($realToken);
assertCondition(isset($realClaims['sub']) && $realClaims['sub'] === 'hub_alice_001', 'Real client + double: retrieves userinfo claims without vendor or network');

$realProfile = $realOAuthClient->authenticate('test_auth_code_789', 'verifier_real_test_1234567890123456789012345678901234567890');
assertCondition($realProfile instanceof IdentityProfile, 'Real client + double: authenticate returns IdentityProfile');
assertCondition($realProfile->getSub() === 'hub_alice_001', 'Real client + double: profile has expected sub');
assertCondition($realProfile->getHubUserId() === 'hub_alice_001', 'Real client + double: profile preserves hub_user_id alias');
assertCondition($realProfile->isActive() === true, 'Real client + double: profile is active');

// Verify error handling with IdentityProviderException on token failure
\League\OAuth2\Client\Provider\GenericProvider::setMockException(new \League\OAuth2\Client\Provider\Exception\IdentityProviderException('Invalid grant', 400));
$tokenExceptionCaught = false;
try {
    $realOAuthClient->exchangeCode('invalid_code', 'verifier_real_test_1234567890123456789012345678901234567890');
} catch (\RuntimeException $e) {
    $tokenExceptionCaught = true;
} finally {
    \League\OAuth2\Client\Provider\GenericProvider::reset();
}
assertCondition($tokenExceptionCaught, 'Real client + double: fail-closes on provider exception during token exchange');

// -----------------------------------------------------------------------------
// Section 4: Callback Failures & Rejections (Fail-Closed, No Partial Session)
// -----------------------------------------------------------------------------
echo "\n4. Testing callback validation failures, invalid state & fail-closed behavior...\n";

// Test 4.1: Missing code parameter
$lastRedirect = null;
$_SESSION = ['sso_state' => 'valid_state_abc', 'sso_state_expires_at' => time() + 300, 'sso_code_verifier' => 'verifier_12345678901234567890123456789012345678901234'];
$_GET = ['state' => 'valid_state_abc']; // No code
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_failed', 'Callback: missing code redirects with error');
assertCondition(!isset($_SESSION['sso_state']), 'Callback: missing code clears flow state');
assertCondition(!isset($_SESSION['user_id']), 'Callback: missing code creates no partial session');

// Test 4.2: Missing state parameter
$lastRedirect = null;
$_SESSION = ['sso_state' => 'valid_state_abc', 'sso_state_expires_at' => time() + 300, 'sso_code_verifier' => 'verifier_12345678901234567890123456789012345678901234'];
$_GET = ['code' => 'auth_code_xyz']; // No state
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_failed', 'Callback: missing state redirects with error');
assertCondition(!isset($_SESSION['user_id']), 'Callback: missing state creates no partial session');

// Test 4.3: Tampered/mismatched state token
$lastRedirect = null;
$_SESSION = ['sso_state' => 'valid_state_abc', 'sso_state_expires_at' => time() + 300, 'sso_code_verifier' => 'verifier_12345678901234567890123456789012345678901234'];
$_GET = ['code' => 'auth_code_xyz', 'state' => 'tampered_state_xyz'];
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_failed', 'Callback: mismatched state redirects with error');
assertCondition(!isset($_SESSION['sso_state']), 'Callback: mismatched state eliminates state');
assertCondition(!isset($_SESSION['sso_code_verifier']), 'Callback: mismatched state eliminates code_verifier');
assertCondition(!isset($_SESSION['user_id']), 'Callback: mismatched state creates no partial session');

// Test 4.4: Expired state token
$lastRedirect = null;
$_SESSION = ['sso_state' => 'valid_state_abc', 'sso_state_expires_at' => time() - 10, 'sso_code_verifier' => 'verifier_12345678901234567890123456789012345678901234'];
$_GET = ['code' => 'auth_code_xyz', 'state' => 'valid_state_abc'];
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_failed', 'Callback: expired state redirects with error');
assertCondition(!isset($_SESSION['user_id']), 'Callback: expired state creates no partial session');

// Test 4.5: Missing PKCE verifier in session
$lastRedirect = null;
$_SESSION = ['sso_state' => 'valid_state_abc', 'sso_state_expires_at' => time() + 300]; // No verifier
$_GET = ['code' => 'auth_code_xyz', 'state' => 'valid_state_abc'];
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_failed', 'Callback: missing PKCE verifier redirects with error');
assertCondition(!isset($_SESSION['user_id']), 'Callback: missing PKCE verifier creates no partial session');

// Test 4.6: Authorization server returned error
$lastRedirect = null;
$_SESSION = ['sso_state' => 'valid_state_abc', 'sso_state_expires_at' => time() + 300, 'sso_code_verifier' => 'verifier_12345678901234567890123456789012345678901234'];
$_GET = ['error' => 'access_denied', 'error_description' => 'User denied access'];
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_failed', 'Callback: server error response redirects with error');
assertCondition(!isset($_SESSION['sso_state']), 'Callback: server error response eliminates state');
assertCondition(!isset($_SESSION['user_id']), 'Callback: server error response creates no partial session');

// Test 4.7: Userinfo payload missing sub (provides only hub_user_id alias or missing sub) fails closed
$lastRedirect = null;
$_SESSION = [
    'sso_state' => 'valid_state_missing_sub',
    'sso_state_expires_at' => time() + 300,
    'sso_code_verifier' => 'verifier_12345678901234567890123456789012345678901234',
];
$_GET = ['code' => 'auth_code_missing_sub', 'state' => 'valid_state_missing_sub'];
$mockOAuthClient->setMockException(new \InvalidArgumentException('Identity profile requires a valid non-empty sub.'));
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_failed', 'Callback: missing sub redirects to login with sanitized sso_failed error');
assertCondition(!isset($_SESSION['user_id']), 'Callback: missing sub creates no partial session');
assertCondition(!isset($_SESSION['sso_state']), 'Callback: missing sub eliminates transient state');
$mockOAuthClient->setMockException(null);

// -----------------------------------------------------------------------------
// Section 5: Callback Success, Federated Link Resolution & SsoSession
// -----------------------------------------------------------------------------
echo "\n5. Testing callback order of operations, link resolution, SsoAuthorization & SsoSession...\n";

// Set up federated link in mock PDO
// User 1 (Alice, admin) linked to hub user 'hub_alice_001'
$mockPdo->insertLink(1, 'hub', 'hub_alice_001', 1);

// User 2 (Bob, technician) linked to hub user 'hub_bob_002'
$mockPdo->insertLink(2, 'hub', 'hub_bob_002', 1);

// User 3 (Charlie, viewer) linked to hub user 'hub_charlie_003'
$mockPdo->insertLink(3, 'hub', 'hub_charlie_003', 1);

// Inactive link for User 1
$mockPdo->insertLink(1, 'hub', 'hub_alice_inactive_link', 0);

// Link for inactive user (Dan)
$mockPdo->insertLink(4, 'hub', 'hub_dan_inactive_user', 1);

// Link for disallowed role user (Eve)
$mockPdo->insertLink(5, 'hub', 'hub_eve_disallowed_role', 1);

// Test 5.1: Successful full SSO callback
$testState = 'secure_single_use_state_token_1234567890';
$testVerifier = 'secure_pkce_code_verifier_1234567890123456789012345678901234567890';
$_SESSION = [
    'sso_state' => $testState,
    'sso_state_expires_at' => time() + 300,
    'sso_code_verifier' => $testVerifier,
];
$_GET = ['code' => 'auth_code_success', 'state' => $testState];

$mockOAuthClient->setMockException(null);
$mockOAuthClient->setMockProfile(IdentityProfile::fromArray([
    'sub' => 'hub_alice_001',
    'username' => 'alice_admin',
    'display_name' => 'Alice Admin',
    'email' => 'alice@example.com',
    'active' => true,
    'roles' => ['admin'],
]));

$lastRedirect = null;
include dirname(__DIR__) . '/pages/sso-callback.php';

assertCondition($lastRedirect === '/pages/takeoff.php', 'SSO Callback: redirects to /pages/takeoff.php on success');
assertCondition($_SESSION['user_id'] === 1, 'SSO Callback: establishes local user_id (1)');
assertCondition($_SESSION['username'] === 'Alice Admin', 'SSO Callback: presents central display name without exposing the shadow username');
assertCondition($_SESSION['role'] === 'admin', 'SSO Callback: preserves local role (admin)');
assertCondition($_SESSION['auth_source'] === 'sso', 'SSO Callback: auth_source is sso');
assertCondition($_SESSION['sso_provider'] === 'hub', 'SSO Callback: federation provider is hub');
assertCondition($_SESSION['sso_hub_user_id'] === 'hub_alice_001', 'SSO Callback: federation hub_user_id is hub_alice_001');
assertCondition($_SESSION['sso_sub'] === 'hub_alice_001', 'SSO Callback: federation sso_sub is hub_alice_001');
assertCondition($_SESSION['federation']['sub'] === 'hub_alice_001', 'SSO Callback: federation array sub is hub_alice_001');
assertCondition(isset($_SESSION['sso_authenticated_at']), 'SSO Callback: federation timestamp recorded');
assertCondition(!isset($_SESSION['sso_state']), 'SSO Callback: transient sso_state eliminated');
assertCondition(!isset($_SESSION['sso_code_verifier']), 'SSO Callback: transient sso_code_verifier eliminated');

// Test 5.2: Inactive central identity rejected
$_SESSION = [
    'sso_state' => 'state_inactive_central',
    'sso_state_expires_at' => time() + 300,
    'sso_code_verifier' => 'verifier_1234567890123456789012345678901234567890',
];
$_GET = ['code' => 'code_123', 'state' => 'state_inactive_central'];
$mockOAuthClient->setMockProfile(new IdentityProfile('hub', 'hub_alice_001', false, ['admin'])); // Inactive central

$lastRedirect = null;
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=unauthorized', 'SSO Callback: inactive central identity redirects with unauthorized error');
assertCondition(!isset($_SESSION['user_id']), 'SSO Callback: inactive central identity establishes no session');

// Test 5.3: Inactive federated link rejected
$_SESSION = [
    'sso_state' => 'state_inactive_link',
    'sso_state_expires_at' => time() + 300,
    'sso_code_verifier' => 'verifier_1234567890123456789012345678901234567890',
];
$_GET = ['code' => 'code_123', 'state' => 'state_inactive_link'];
$mockOAuthClient->setMockProfile(new IdentityProfile('hub', 'hub_alice_inactive_link', true, ['admin']));

$lastRedirect = null;
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=unauthorized', 'SSO Callback: inactive link redirects with unauthorized error');
assertCondition(!isset($_SESSION['user_id']), 'SSO Callback: inactive link establishes no session');

// Test 5.4: Inactive local user rejected
$_SESSION = [
    'sso_state' => 'state_inactive_user',
    'sso_state_expires_at' => time() + 300,
    'sso_code_verifier' => 'verifier_1234567890123456789012345678901234567890',
];
$_GET = ['code' => 'code_123', 'state' => 'state_inactive_user'];
$mockOAuthClient->setMockProfile(new IdentityProfile('hub', 'hub_dan_inactive_user', true, ['admin']));

$lastRedirect = null;
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=unauthorized', 'SSO Callback: inactive user redirects with unauthorized error');
assertCondition(!isset($_SESSION['user_id']), 'SSO Callback: inactive user establishes no session');

// Test 5.5: Accepted central role synchronizes a stale/disallowed local role
$_SESSION = [
    'sso_state' => 'state_disallowed_role',
    'sso_state_expires_at' => time() + 300,
    'sso_code_verifier' => 'verifier_1234567890123456789012345678901234567890',
];
$_GET = ['code' => 'code_123', 'state' => 'state_disallowed_role'];
$mockOAuthClient->setMockProfile(new IdentityProfile('hub', 'hub_eve_disallowed_role', true, ['admin']));

$lastRedirect = null;
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/takeoff.php', 'SSO Callback: accepted central role authorizes linked identity');
assertCondition(($_SESSION['role'] ?? null) === 'admin', 'SSO Callback: central admin role replaces stale disallowed local role');

// Test 5.6: Ambiguous central roles fail closed
$_SESSION = [
    'sso_state' => 'state_anti_elevation',
    'sso_state_expires_at' => time() + 300,
    'sso_code_verifier' => 'verifier_1234567890123456789012345678901234567890',
];
$_GET = ['code' => 'code_123', 'state' => 'state_anti_elevation'];
// Charlie is locally a viewer; central identity claims ['admin', 'superadmin']
$mockOAuthClient->setMockProfile(new IdentityProfile('hub', 'hub_charlie_003', true, ['admin', 'superadmin']));

$lastRedirect = null;
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=unauthorized', 'SSO Callback: multiple/unknown central roles are rejected');
assertCondition(!isset($_SESSION['user_id']) && !isset($_SESSION['role']), 'Anti-elevation: ambiguous central roles establish no session');

// -----------------------------------------------------------------------------
// Section 6: Hub Unavailability, Network Failures & Sanitized Generic Errors
// -----------------------------------------------------------------------------
echo "\n6. Testing Hub unavailability, network exceptions & sanitized generic error messages...\n";

// Test 6.1: Hub unavailability during callback token exchange
$_SESSION = [
    'sso_state' => 'state_hub_down',
    'sso_state_expires_at' => time() + 300,
    'sso_code_verifier' => 'verifier_1234567890123456789012345678901234567890',
];
$_GET = ['code' => 'code_hub_down', 'state' => 'state_hub_down'];
$mockOAuthClient->setMockException(new \RuntimeException('Connection refused to https://hub.example.com/oauth/token with client_secret=client_secret_xyz789'));

$lastRedirect = null;
include dirname(__DIR__) . '/pages/sso-callback.php';
assertCondition($lastRedirect === '/pages/login.php?error=sso_failed', 'Hub unavailability: redirects to login with generic sso_failed');
assertCondition(!isset($_SESSION['user_id']), 'Hub unavailability: establishes no session');
assertCondition(!isset($_SESSION['sso_state']), 'Hub unavailability: clears flow state');

// Test 6.2: Login page displays sanitized fallback message
$_SESSION = [];
$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET = ['error' => 'sso_failed'];
ob_start();
include dirname(__DIR__) . '/pages/login.php';
$loginFallbackHtml = ob_get_clean();

assertCondition(str_contains($loginFallbackHtml, 'credenciales locales'), 'Fallback: login page informs user to use local credentials');
assertCondition(!str_contains($loginFallbackHtml, 'client_secret'), 'Sanitization: no client_secret in error output');
assertCondition(!str_contains($loginFallbackHtml, 'https://hub'), 'Sanitization: no Hub URLs in error output');
assertCondition(!str_contains($loginFallbackHtml, 'C:\\') && !str_contains($loginFallbackHtml, '/var/www'), 'Sanitization: no file paths in error output');
assertCondition(!str_contains($loginFallbackHtml, 'hub_user_id'), 'Sanitization: no internal payload keys in fallback error output');
assertCondition(!str_contains($loginFallbackHtml, 'sub='), 'Sanitization: no claim parameter names in fallback error output');

// -----------------------------------------------------------------------------
// Section 7: Local Logout Flow (POST Only, CSRF Validation, Zero Network Request)
// -----------------------------------------------------------------------------
echo "\n7. Testing local logout flow: POST-only, CSRF validation, destroys session & cookie, makes zero network requests...\n";

// Test 7.1: GET request cannot terminate a local or federated session
$_SESSION = [
    'user_id' => 1,
    'username' => 'alice_admin',
    'role' => 'admin',
    'auth_source' => 'sso',
    'sso_provider' => 'hub',
    'csrf_token' => 'active_session_csrf_token_123',
];
$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET = [];
$_POST = [];
$lastRedirect = null;
ob_start();
include dirname(__DIR__) . '/pages/logout.php';
$getLogoutOut = ob_get_clean();

assertCondition(isset($_SESSION['user_id']) && $_SESSION['user_id'] === 1, 'GET logout: cannot terminate local or federated session ($_SESSION preserved)');
assertCondition($lastRedirect === null, 'GET logout: does not redirect to logged-out confirmation');
assertCondition(str_contains($getLogoutOut, 'POST'), 'GET logout: fails closed informing POST is required');

// Test 7.2: POST with missing CSRF fails closed with sanitized response
$_SESSION = [
    'user_id' => 1,
    'username' => 'alice_admin',
    'role' => 'admin',
    'auth_source' => 'sso',
    'sso_provider' => 'hub',
    'csrf_token' => 'active_session_csrf_token_123',
];
$_SERVER['REQUEST_METHOD'] = 'POST';
$_POST = []; // No csrf_token
$lastRedirect = null;
ob_start();
include dirname(__DIR__) . '/pages/logout.php';
$missingCsrfOut = ob_get_clean();

assertCondition(isset($_SESSION['user_id']) && $_SESSION['user_id'] === 1, 'POST logout without CSRF: fails closed without terminating session');
assertCondition($lastRedirect === null, 'POST logout without CSRF: does not redirect to logged-out confirmation');
assertCondition(str_contains($missingCsrfOut, 'CSRF'), 'POST logout without CSRF: outputs sanitized CSRF validation error');
assertCondition(!str_contains($missingCsrfOut, 'alice_admin') && !str_contains($missingCsrfOut, 'active_session_csrf_token_123'), 'POST logout without CSRF: exposes no session data');

// Test 7.3: POST with invalid/mismatched CSRF fails closed with sanitized response
$_SESSION = [
    'user_id' => 1,
    'username' => 'alice_admin',
    'role' => 'admin',
    'auth_source' => 'sso',
    'sso_provider' => 'hub',
    'csrf_token' => 'active_session_csrf_token_123',
];
$_SERVER['REQUEST_METHOD'] = 'POST';
$_POST = ['csrf_token' => 'tampered_invalid_csrf_token'];
$lastRedirect = null;
ob_start();
include dirname(__DIR__) . '/pages/logout.php';
$invalidCsrfOut = ob_get_clean();

assertCondition(isset($_SESSION['user_id']) && $_SESSION['user_id'] === 1, 'POST logout with invalid CSRF: fails closed without terminating session');
assertCondition($lastRedirect === null, 'POST logout with invalid CSRF: does not redirect to logged-out confirmation');
assertCondition(str_contains($invalidCsrfOut, 'CSRF'), 'POST logout with invalid CSRF: outputs sanitized CSRF validation error');
assertCondition(!str_contains($invalidCsrfOut, 'alice_admin'), 'POST logout with invalid CSRF: exposes no session data');

// Test 7.4: POST with valid session-bound CSRF token destroys session and cookie
$_SESSION = [
    'user_id' => 1,
    'username' => 'alice_admin',
    'role' => 'admin',
    'auth_source' => 'sso',
    'sso_provider' => 'hub',
    'csrf_token' => 'active_session_csrf_token_123',
];
$_SERVER['REQUEST_METHOD'] = 'POST';
$_POST = ['csrf_token' => 'active_session_csrf_token_123'];
$lastRedirect = null;
ob_start();
include dirname(__DIR__) . '/pages/logout.php';
$validLogoutOut = ob_get_clean();

assertCondition(empty($_SESSION), 'POST logout with valid CSRF: empties application session array');
assertCondition($lastRedirect === '/pages/login.php?logged_out=1', 'POST logout with valid CSRF: redirects to login page with logged_out=1');

// Test 7.5: Verify login page displays logout confirmation
$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET = ['logged_out' => '1'];
ob_start();
include dirname(__DIR__) . '/pages/login.php';
$logoutConfirmHtml = ob_get_clean();
assertCondition(str_contains($logoutConfirmHtml, 'cerrado sesión correctamente'), 'Logout confirmation displayed on login page');

// Test 7.6: Verify visible logout control in global_tools_header.php submits POST form without exposing session data
$_SESSION = [
    'user_id' => 1,
    'username' => 'alice_admin',
    'role' => 'admin',
    'auth_source' => 'sso',
    'sso_provider' => 'hub',
    'csrf_token' => 'visible_control_csrf_token_456',
];
$_SERVER['REQUEST_URI'] = '/pages/bid_board.php';
ob_start();
include dirname(__DIR__) . '/views/global_tools_header.php';
$headerHtml = ob_get_clean();

assertCondition(preg_match('/<form[^>]+method=[\'"]POST[\'"][^>]+action=[\'"][^\'"]*logout\.php[\'"]/i', $headerHtml) === 1, 'Header: visible logout control contains POST form targeting logout.php');
assertCondition(preg_match('/<input[^>]+type=[\'"]hidden[\'"][^>]+name=[\'"]csrf_token[\'"][^>]+value=[\'"]visible_control_csrf_token_456[\'"]/i', $headerHtml) === 1, 'Header: logout form contains session-bound CSRF token');
assertCondition(str_contains($headerHtml, 'Sign out'), 'Header: logout form contains visible Sign out control');
assertCondition(
    !preg_match('/sso_sub|hub_user_id|access_token|refresh_token|password|client_secret/i', $headerHtml),
    'Header: logout control exposes no sensitive federation or credential data'
);

// Test 7.7: Disabling SSO immediately restores existing traditional login and does not force Hub redirect
$GLOBALS['__TAKEOFF_TEST_SSO_CONFIG__'] = new SsoConfig(['TAKEOFF_SSO_ENABLED' => false]);
$_SESSION = [];
$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET = [];
$lastRedirect = null;
ob_start();
include dirname(__DIR__) . '/pages/login.php';
$disabledLoginHtml = ob_get_clean();

assertCondition($lastRedirect === null, 'SSO disabled: login page does not force any redirect');
assertCondition(str_contains($disabledLoginHtml, 'name="username"'), 'SSO disabled: traditional username field present');
assertCondition(str_contains($disabledLoginHtml, 'name="password"'), 'SSO disabled: traditional password field present');
assertCondition(!str_contains($disabledLoginHtml, 'btn-sso') && !str_contains($disabledLoginHtml, 'Single Sign-On'), 'SSO disabled: SSO Hub button not rendered');
assertCondition(!str_contains($disabledLoginHtml, 'hub.example.com'), 'SSO disabled: Hub URL not rendered');

// -----------------------------------------------------------------------------
// Section 8: Absence of OIDC / openid / id_token / nonce Behavior
// -----------------------------------------------------------------------------
echo "\n8. Verifying strict absence of OIDC, openid, id_token, and nonce behavior...\n";

$authFiles = [
    'login.php' => dirname(__DIR__) . '/pages/login.php',
    'sso-login.php' => dirname(__DIR__) . '/pages/sso-login.php',
    'sso-callback.php' => dirname(__DIR__) . '/pages/sso-callback.php',
    'logout.php' => dirname(__DIR__) . '/pages/logout.php',
];

foreach ($authFiles as $name => $filePath) {
    $content = file_get_contents($filePath);
    assertCondition($content !== false, "Auth page {$name} exists and is readable");

    // Must not use openid scope
    assertCondition(!preg_match('/[\'"]scope[\'"]\s*=>\s*[\'"][^\'"]*openid/i', (string)$content), "{$name}: no openid scope requested");

    // Must not parse or use id_token
    assertCondition(!preg_match('/id_token/i', (string)$content), "{$name}: no id_token handling");

    // Must not use nonce
    assertCondition(!preg_match('/\bnonce\b/i', (string)$content), "{$name}: no nonce handling");

    // Must not reference OIDC
    assertCondition(!preg_match('/(?:oidc|openidconnect)/i', (string)$content), "{$name}: no OIDC protocol coupling");
}

// Check logout makes no external network requests
$logoutContent = file_get_contents(dirname(__DIR__) . '/pages/logout.php');
assertCondition(
    !preg_match('/(?:curl_|Guzzle|file_get_contents\s*\(\s*[\'"]http|stream_context)/i', (string)$logoutContent),
    'logout.php makes strictly zero network or central requests'
);

// Check .htaccess routing exposes auth pages and keeps takeoff rewrites
$htaccessContent = file_get_contents(dirname(__DIR__) . '/.htaccess');
assertCondition(
    !str_contains((string)$htaccessContent, 'RewriteRule ^pages/(login|logout|index)\.php$ /pages/takeoff.php'),
    '.htaccess no longer blocks login and logout pages with takeoff rewrite'
);
assertCondition(
    str_contains((string)$htaccessContent, 'RewriteRule ^pages/index\.php$ /pages/takeoff.php [L]'),
    '.htaccess preserves index rewrite to takeoff'
);

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

echo "OK: All runtime and contract tests passed successfully.\n";
exit(0);
