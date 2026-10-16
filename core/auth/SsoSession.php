<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

use InvalidArgumentException;

/**
 * Manages the local session boundary for Takeoff SSO authentication.
 *
 * Enforces strict security invariants:
 * 1. Accepts ONLY an explicitly resolved, active local identity (fails closed on invalid/missing identity).
 * 2. Configures session cookies with Secure=true, HttpOnly=true, and SameSite=Lax.
 * 3. Regenerates the session ID to prevent session fixation attacks.
 * 4. Writes only the existing Takeoff local session shape (user_id, username, role) plus
 *    non-sensitive federation metadata.
 * 5. Never writes sensitive secrets, access tokens, code verifiers, or credentials to session.
 * 6. Never assigns default user IDs or fallback roles.
 */
class SsoSession
{
    public const COOKIE_LIFETIME = 0;
    public const COOKIE_PATH = '/';
    public const COOKIE_DOMAIN = '';
    public const COOKIE_SECURE = true;
    public const COOKIE_HTTPONLY = true;
    public const COOKIE_SAMESITE = 'Lax';

    public const COOKIE_OPTIONS = [
        'lifetime' => self::COOKIE_LIFETIME,
        'path' => self::COOKIE_PATH,
        'domain' => self::COOKIE_DOMAIN,
        'secure' => self::COOKIE_SECURE,
        'httponly' => self::COOKIE_HTTPONLY,
        'samesite' => self::COOKIE_SAMESITE,
    ];

    /** @var callable|null */
    private $sessionRegenerator;

    /**
     * @param callable|null $sessionRegenerator Optional callable double for session ID regeneration in tests
     */
    public function __construct(?callable $sessionRegenerator = null)
    {
        $this->sessionRegenerator = $sessionRegenerator;
    }

    /**
     * Configures PHP session cookie parameters according to security standards:
     * - Secure: true (enforces HTTPS)
     * - HttpOnly: true (prevents client-side script access)
     * - SameSite: Lax (protects against CSRF)
     *
     * Invariant: Cookie parameters are fixed to Secure=true, HttpOnly=true, and SameSite=Lax.
     * Exposes no production parameter capable of downgrading these security attributes.
     *
     * @return bool True if configured, false if session already active or headers sent
     * @throws InvalidArgumentException If arguments are passed attempting downgrade
     */
    public static function configureCookieParams(): bool
    {
        if (func_num_args() > 0) {
            throw new InvalidArgumentException('Cookie security parameters cannot be overridden or downgraded.');
        }

        if (session_status() === PHP_SESSION_ACTIVE || headers_sent()) {
            return false;
        }

        return session_set_cookie_params(self::COOKIE_OPTIONS);
    }

    /**
     * Returns the mandatory cookie security parameter contract.
     *
     * @return array{lifetime: int, path: string, domain: string, secure: bool, httponly: bool, samesite: string}
     */
    public static function getCookieParams(): array
    {
        return self::COOKIE_OPTIONS;
    }

    /**
     * Regenerates the session ID to protect against session fixation.
     *
     * @return bool
     */
    public function regenerateSessionId(): bool
    {
        if ($this->sessionRegenerator !== null) {
            return (bool)($this->sessionRegenerator)();
        }

        if (session_status() === PHP_SESSION_ACTIVE) {
            return session_regenerate_id(true);
        }

        return true;
    }

    /**
     * Validates that the provided identity is an explicitly resolved, active local identity.
     * Fails closed if required attributes are missing or invalid.
     * Never assigns fallback users or default roles.
     *
     * @param array $identity
     * @return array{user_id: int, username: string, role: string, provider: string, hub_user_id: string}
     * @throws InvalidArgumentException
     */
    public function validateResolvedIdentity(array $identity): array
    {
        if (empty($identity)) {
            throw new InvalidArgumentException('Explicitly resolved local identity cannot be empty.');
        }

        // Resolve user_id: must be a positive integer
        $rawUserId = $identity['user_id'] ?? $identity['id'] ?? null;
        if ($rawUserId === null || (!is_int($rawUserId) && !ctype_digit((string)$rawUserId))) {
            throw new InvalidArgumentException('Resolved identity must contain a valid positive local user_id.');
        }
        $userId = (int)$rawUserId;
        if ($userId <= 0) {
            throw new InvalidArgumentException('Resolved local user_id must be greater than zero.');
        }

        // Resolve username: must be a non-empty string
        $username = $identity['username'] ?? null;
        if (!is_string($username) || trim($username) === '') {
            throw new InvalidArgumentException('Resolved identity must contain a non-empty local username.');
        }

        // Resolve role: must be a non-empty string (no default role fallback)
        $role = $identity['role'] ?? null;
        if (!is_string($role) || trim($role) === '') {
            throw new InvalidArgumentException('Resolved identity must contain an explicit, non-empty local role.');
        }

        // Active status check: if active flag is present, it must be truthy
        if (array_key_exists('active', $identity)) {
            $isActive = ($identity['active'] === true || $identity['active'] === 1 || $identity['active'] === '1');
            if (!$isActive) {
                throw new InvalidArgumentException('Cannot establish session for inactive local user.');
            }
        }

        // User active status check: if user_active flag is present, it must be truthy
        if (array_key_exists('user_active', $identity)) {
            $isUserActive = ($identity['user_active'] === true || $identity['user_active'] === 1 || $identity['user_active'] === '1');
            if (!$isUserActive) {
                throw new InvalidArgumentException('Cannot establish session for inactive local user.');
            }
        }

        // Link active status check: if link_active flag is present, it must be truthy
        if (array_key_exists('link_active', $identity)) {
            $isLinkActive = ($identity['link_active'] === true || $identity['link_active'] === 1 || $identity['link_active'] === '1');
            if (!$isLinkActive) {
                throw new InvalidArgumentException('Cannot establish session for inactive federated link.');
            }
        }

        // Provider: reject missing, non-string, or empty; never supply default
        if (!isset($identity['provider']) || !is_string($identity['provider']) || trim($identity['provider']) === '') {
            throw new InvalidArgumentException('Resolved identity must contain a non-empty provider.');
        }
        $provider = trim($identity['provider']);

        // sub: reject missing, non-string/non-int, or empty; never accept hub_user_id as fallback
        $rawSub = $identity['sub'] ?? null;
        if ($rawSub === null || (!is_string($rawSub) && !is_int($rawSub)) || trim((string)$rawSub) === '') {
            throw new InvalidArgumentException('Resolved identity must contain a non-empty sub.');
        }
        $sub = trim((string)$rawSub);

        return [
            'user_id' => $userId,
            'username' => trim($username),
            'role' => trim($role),
            'provider' => $provider,
            'sub' => $sub,
            'hub_user_id' => $sub,
        ];
    }

    /**
     * Securely establishes the local session shape for an authenticated SSO identity.
     *
     * 1. Validates the explicitly resolved local identity.
     * 2. Configures cookie parameters (Secure, HttpOnly, SameSite=Lax).
     * 3. Ensures active session and regenerates session ID.
     * 4. Clears transient SSO flow tokens (state, verifier).
     * 5. Populates the legacy/existing local session shape:
     *    $_SESSION['user_id'], $_SESSION['username'], $_SESSION['role']
     * 6. Writes non-sensitive federation metadata:
     *    auth_source, sso_provider, sso_hub_user_id, sso_authenticated_at, federation array
     *
     * @param array $resolvedIdentity Explicitly resolved local identity record
     * @param array|null $session Reference to session array (defaults to $_SESSION if null)
     * @return array Reference or copy of the established session array
     * @throws InvalidArgumentException
     */
    public function establish(array $resolvedIdentity, ?array &$session = null): array
    {
        $validated = $this->validateResolvedIdentity($resolvedIdentity);

        if ($session === null) {
            self::configureCookieParams();

            if (session_status() !== PHP_SESSION_ACTIVE) {
                session_start();
            }

            $this->regenerateSessionId();

            if (!isset($_SESSION) || !is_array($_SESSION)) {
                $_SESSION = [];
            }

            $this->writeSessionData($_SESSION, $validated);
            return $_SESSION;
        }

        // Session array provided (e.g. test isolated double)
        $this->regenerateSessionId();
        $this->writeSessionData($session, $validated);
        return $session;
    }

    /**
     * Static convenience entry point to establish SSO session.
     *
     * @param array $resolvedIdentity
     * @param array|null $session
     * @param callable|null $sessionRegenerator
     * @return array
     */
    public static function establishSession(
        array $resolvedIdentity,
        ?array &$session = null,
        ?callable $sessionRegenerator = null
    ): array {
        $instance = new self($sessionRegenerator);
        return $instance->establish($resolvedIdentity, $session);
    }

    /**
     * Clears all session data and destroys the active session if present.
     *
     * @param array|null $session
     */
    public static function destroySession(?array &$session = null): void
    {
        if ($session !== null) {
            $session = [];
        }

        if (isset($_SESSION) && is_array($_SESSION)) {
            $_SESSION = [];
        }

        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
    }

    /**
     * Writes existing session shape and non-sensitive federation metadata.
     *
     * @param array $session
     * @param array $validated
     */
    private function writeSessionData(array &$session, array $validated): void
    {
        // Remove transient SSO authorization tokens to prevent leakage
        unset(
            $session['sso_state'],
            $session['sso_state_expires_at'],
            $session['sso_code_verifier'],
            $session['code_verifier'],
            $session['state'],
            $session['code'],
            $session['access_token'],
            $session['userinfo'],
            $session['refresh_token'],
            $session['token'],
            $session['secret']
        );

        // Standard Takeoff local session shape
        $session['user_id'] = $validated['user_id'];
        $session['username'] = $validated['username'];
        $session['role'] = $validated['role'];

        // Non-sensitive federation metadata
        $now = time();
        $session['auth_source'] = 'sso';
        $session['sso_provider'] = $validated['provider'];
        $session['sso_hub_user_id'] = $validated['hub_user_id'];
        $session['sso_sub'] = $validated['sub'];
        $session['sso_authenticated_at'] = $now;
        $session['federation'] = [
            'provider' => $validated['provider'],
            'hub_user_id' => $validated['hub_user_id'],
            'sub' => $validated['sub'],
            'authenticated_at' => $now,
        ];
    }
}

// Global class alias for backward compatibility and flexible resolution
if (!class_exists('SsoSession', false)) {
    class_alias(SsoSession::class, 'SsoSession');
}
