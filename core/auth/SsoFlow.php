<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

/**
 * Takeoff SSO Flow - Single-Use State, PKCE S256 & Callback Validation.
 *
 * Implements the security contract for Takeoff SSO authentication flow:
 * 1. Single-use, short-lived, constant-time compared State eliminated after callback.
 * 2. High-entropy PKCE Code Verifier stored exclusively in session.
 * 3. PKCE Code Challenge computed as BASE64URL(SHA256(verifier)) with S256 method.
 * 4. Explicit rejection of 'plain' PKCE method.
 * 5. Deterministic, zero external dependencies (no network, no database, no local session creation).
 * 6. Downstream identity contract references for provider, hub_user_id, active, local user,
 *    roles, central_disabled, and app_unauthorized without default role fallbacks.
 */
class SsoFlow
{
    /**
     * Error identifier for central disabled user account.
     */
    public const ERROR_CENTRAL_DISABLED = 'central_disabled';

    /**
     * Error identifier for application unauthorized access.
     */
    public const ERROR_APP_UNAUTHORIZED = 'app_unauthorized';

    /**
     * Generates a cryptographically secure, high-entropy state token.
     *
     * @param int $length Number of random bytes (minimum 16 for >= 128-bit entropy).
     * @return string Hexadecimal state token (minimum 32 characters).
     */
    public function generateState(int $length = 32): string
    {
        if ($length < 16) {
            throw new \InvalidArgumentException('State length must be at least 16 bytes for sufficient entropy.');
        }

        return bin2hex(random_bytes($length));
    }

    /**
     * Creates a state token, stores it in session with an expiration timestamp, and returns it.
     *
     * @param array $session Reference to session array.
     * @param int $ttl Time-to-live in seconds (default 300s).
     * @param int|null $currentTime Optional fixed timestamp for deterministic testing.
     * @return string The generated state token.
     */
    public function createState(array &$session, int $ttl = 300, ?int $currentTime = null): string
    {
        $state = $this->generateState();
        $now = $currentTime ?? time();

        $session['sso_state'] = $state;
        $session['sso_state_expires_at'] = $now + $ttl;

        return $state;
    }

    /**
     * Validates and consumes the state token from session in constant time.
     * Eliminates state and metadata upon consumption (single-use).
     * If validation fails (tampered, expired, or empty), eliminates both state and verifier.
     *
     * @param array $session Reference to session array.
     * @param string|null $state State parameter from callback.
     * @param int|null $currentTime Optional fixed timestamp for deterministic testing.
     * @return bool True if valid and consumed; false otherwise.
     */
    public function validateAndConsumeState(array &$session, ?string $state, ?int $currentTime = null): bool
    {
        $storedState = $session['sso_state'] ?? null;
        $expiresAt = $session['sso_state_expires_at'] ?? null;

        // Eliminate state from session immediately to ensure single-use
        unset($session['sso_state'], $session['sso_state_expires_at']);

        if (!is_string($storedState) || $storedState === '' || !is_int($expiresAt)) {
            // No stored state or invalid format; eliminate verifier on failure
            unset($session['sso_code_verifier']);
            return false;
        }

        if (!is_string($state) || $state === '') {
            // Empty or invalid state parameter provided; eliminate verifier on failure
            unset($session['sso_code_verifier']);
            return false;
        }

        $now = $currentTime ?? time();
        if ($now > $expiresAt) {
            // State expired; eliminate verifier on failure
            unset($session['sso_code_verifier']);
            return false;
        }

        // Constant-time comparison
        if (!hash_equals($storedState, $state)) {
            // Tampered or mismatched state; eliminate verifier on failure
            unset($session['sso_code_verifier']);
            return false;
        }

        return true;
    }

    /**
     * Generates a high-entropy PKCE code verifier (RFC 7636).
     *
     * @param int $length Desired string length between 43 and 128 characters (default 64).
     * @return string Base64URL-encoded unreserved character string.
     */
    public function generateCodeVerifier(int $length = 64): string
    {
        if ($length < 43 || $length > 128) {
            throw new \InvalidArgumentException('PKCE code verifier length must be between 43 and 128 characters.');
        }

        // Generate sufficient random bytes and base64url-encode
        $bytes = random_bytes($length);
        $encoded = rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');

        return substr($encoded, 0, $length);
    }

    /**
     * Computes the PKCE code challenge from the code verifier (RFC 7636).
     * Exclusively supports the S256 method; rejects plain and unsupported methods.
     *
     * @param string $codeVerifier The PKCE code verifier.
     * @param string $method The PKCE transformation method ('S256' only).
     * @return string Base64URL-encoded SHA-256 digest without padding.
     * @throws \InvalidArgumentException When method is not 'S256' or verifier is empty.
     */
    public function generateCodeChallenge(string $codeVerifier, string $method = 'S256'): string
    {
        if ($method !== 'S256') {
            throw new \InvalidArgumentException(
                sprintf("Unsupported PKCE method '%s'. Exclusively 'S256' is accepted; 'plain' is strictly prohibited.", $method)
            );
        }

        if ($codeVerifier === '') {
            throw new \InvalidArgumentException('PKCE code verifier cannot be empty.');
        }

        $hash = hash('sha256', $codeVerifier, true);
        return rtrim(strtr(base64_encode($hash), '+/', '-_'), '=');
    }

    /**
     * Initiates the authorization request by generating state and PKCE S256 parameters.
     * Stores state, expiration, and code_verifier in session.
     * Never exposes code_verifier in the returned public authorization parameters.
     *
     * @param array $session Reference to session array.
     * @param int $ttl State time-to-live in seconds (default 300s).
     * @param int|null $currentTime Optional fixed timestamp for deterministic testing.
     * @return array Public authorization parameters (state, code_challenge, code_challenge_method).
     */
    public function initiateAuth(array &$session, int $ttl = 300, ?int $currentTime = null): array
    {
        $state = $this->createState($session, $ttl, $currentTime);
        $verifier = $this->generateCodeVerifier();
        $challenge = $this->generateCodeChallenge($verifier, 'S256');

        // Store verifier exclusively in session
        $session['sso_code_verifier'] = $verifier;

        return [
            'state' => $state,
            'code_challenge' => $challenge,
            'code_challenge_method' => 'S256',
            'response_type' => 'code',
        ];
    }

    /**
     * Consumes the PKCE code verifier from session for token exchange.
     * Removes the verifier from session to enforce one-time usage.
     *
     * @param array $session Reference to session array.
     * @return string|null The verifier string if present; null otherwise.
     */
    public function consumeCodeVerifier(array &$session): ?string
    {
        if (!isset($session['sso_code_verifier']) || !is_string($session['sso_code_verifier'])) {
            return null;
        }

        $verifier = $session['sso_code_verifier'];
        unset($session['sso_code_verifier']);

        return $verifier;
    }

    /**
     * Validates OAuth2 callback parameters and consumes state/PKCE verifier.
     * Fails closed if code is missing, state is missing/invalid/expired/reused, or verifier is absent.
     * Never performs HTTP, SQL, or local session initialization.
     * External errors are generic and do not leak state, code, or verifier tokens.
     *
     * @param array $session Reference to the current session array.
     * @param array $params Query/callback parameters (e.g., $_GET).
     * @param int|null $currentTime Optional timestamp for deterministic time evaluation.
     * @return array Array containing validated 'code' and consumed 'code_verifier'.
     * @throws \InvalidArgumentException On missing or invalid parameters without leaking tokens.
     */
    public function validateCallback(array &$session, array $params, ?int $currentTime = null): array
    {
        // Fail-closed on authorization server error response
        if (!empty($params['error'])) {
            $this->clearFlowSession($session);
            throw new \InvalidArgumentException('Authentication failed: authorization server returned an error.');
        }

        // Fail-closed on missing or empty authorization code
        if (!isset($params['code']) || !is_string($params['code']) || trim($params['code']) === '') {
            $this->clearFlowSession($session);
            throw new \InvalidArgumentException('Authentication failed: missing authorization code.');
        }

        // Fail-closed on missing or empty state parameter
        if (!isset($params['state']) || !is_string($params['state']) || trim($params['state']) === '') {
            $this->clearFlowSession($session);
            throw new \InvalidArgumentException('Authentication failed: missing state parameter.');
        }

        // Validate and consume state token in constant time
        $isStateValid = $this->validateAndConsumeState($session, $params['state'], $currentTime);
        if (!$isStateValid) {
            $this->clearFlowSession($session);
            throw new \InvalidArgumentException('Authentication failed: invalid, expired, or reused state.');
        }

        // Consume PKCE code verifier from session
        $verifier = $this->consumeCodeVerifier($session);
        if ($verifier === null || $verifier === '') {
            $this->clearFlowSession($session);
            throw new \InvalidArgumentException('Authentication failed: PKCE code verifier missing or already consumed.');
        }

        return [
            'code' => $params['code'],
            'code_verifier' => $verifier,
        ];
    }

    /**
     * Alias for validateCallback to conform with parameter validation conventions.
     *
     * @param array $session Reference to the session array.
     * @param array $params Query/callback parameters.
     * @param int|null $currentTime Optional timestamp.
     * @return array Validated callback parameters.
     */
    public function validateCallbackParameters(array &$session, array $params, ?int $currentTime = null): array
    {
        return $this->validateCallback($session, $params, $currentTime);
    }

    /**
     * Clears all SSO flow state and verifier data from session.
     *
     * @param array $session Reference to session array.
     */
    public function clearFlowSession(array &$session): void
    {
        unset(
            $session['sso_state'],
            $session['sso_state_expires_at'],
            $session['sso_code_verifier']
        );
    }

    /**
     * Contractual reference for central identity payload evaluation.
     *
     * Connects with downstream integration tasks requiring:
     * - provider: Central identity provider identifier.
     * - hub_user_id: Central user ID.
     * - active: Account active flag; rejects central disabled accounts.
     * - local user: Direct mapping to the local user model.
     * - roles: Explicit user roles required; rejects app unauthorized access.
     *
     * Fails closed: Never assigns default administrator or fallback roles.
     *
     * @param array $identity Central identity payload from Hub provider.
     * @return array Validated identity contract payload for local user resolution.
     * @throws \DomainException If user is central_disabled or app_unauthorized.
     * @throws \InvalidArgumentException If required claims are missing.
     */
    public function validateIdentityClaimsContract(array $identity): array
    {
        if (empty($identity['provider']) || !is_string($identity['provider'])) {
            throw new \InvalidArgumentException('Identity contract violation: missing or invalid provider.');
        }

        $rawSub = $identity['sub'] ?? null;
        if ($rawSub === null || (!is_string($rawSub) && !is_int($rawSub)) || trim((string)$rawSub) === '') {
            throw new \InvalidArgumentException('Identity contract violation: missing or invalid sub.');
        }
        $sub = trim((string)$rawSub);

        // Validate active status: reject central disabled users
        $isActive = isset($identity['active']) && $identity['active'] === true;
        if (!$isActive) {
            throw new \DomainException(self::ERROR_CENTRAL_DISABLED . ': Central account is disabled or inactive.');
        }

        // Validate explicit roles for authorization: reject app unauthorized users
        $roles = $identity['roles'] ?? null;
        if (!is_array($roles) || empty($roles)) {
            throw new \DomainException(self::ERROR_APP_UNAUTHORIZED . ': User has no authorized roles for this application.');
        }

        // Downstream tasks will resolve the local user mapping from hub_user_id and explicit roles.
        // No default or fallback role assignment is performed.
        $subValue = $sub;
        return [
            'provider' => (string)$identity['provider'],
            'sub' => $subValue,
            'hub_user_id' => $subValue,
            'active' => true,
            'roles' => array_values($roles),
            'local_user_mapping_required' => true,
        ];
    }
}

// Global class alias for backward compatibility and flexible resolution
if (!class_exists('SsoFlow', false)) {
    class_alias(SsoFlow::class, 'SsoFlow');
}
