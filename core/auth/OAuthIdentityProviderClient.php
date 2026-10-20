<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

use GuzzleHttp\ClientInterface as HttpClient;
use InvalidArgumentException;
use League\OAuth2\Client\Provider\Exception\IdentityProviderException;
use League\OAuth2\Client\Provider\GenericProvider;
use League\OAuth2\Client\Token\AccessToken;
use League\OAuth2\Client\Token\AccessTokenInterface;
use RuntimeException;
use Takeoff\Config\SsoConfig;
use Throwable;

/**
 * OAuth 2.0 Identity Provider Client for Takeoff.
 *
 * Implements the authorization_code grant with PKCE S256 code_verifier,
 * confidential client_secret, exact redirect_uri, and Bearer userinfo retrieval.
 *
 * Security invariants:
 * 1. Confidential client: client_secret is securely held and never logged or exposed.
 * 2. PKCE verification: exchanges authorization_code with code_verifier via server-to-server HTTP POST.
 * 3. Exact redirect_uri: redirect_uri matches central registration strictly.
 * 4. UserInfo: retrieved server-to-server using HTTP header Authorization: Bearer <token>.
 * 5. Provider-neutral output: produces a normalized IdentityProfile from userinfo claims.
 * 6. Zero persistence/logging: tokens, codes, verifiers, and secrets are strictly in-memory.
 * 7. Sanitized errors: external error details and credentials are redacted on failure.
 */
class OAuthIdentityProviderClient implements IdentityProviderClient
{
    private SsoConfig $config;
    private ?GenericProvider $provider;
    private ?HttpClient $httpClient;

    /**
     * @param SsoConfig|array $config SsoConfig instance or configuration array
     * @param GenericProvider|null $provider Optional pre-configured League GenericProvider
     * @param HttpClient|null $httpClient Optional PSR-18 / Guzzle HTTP client for server-to-server exchange
     */
    public function __construct(
        SsoConfig|array $config,
        ?GenericProvider $provider = null,
        ?HttpClient $httpClient = null
    ) {
        if ($config instanceof SsoConfig) {
            $this->config = $config;
        } else {
            $this->config = new SsoConfig($config);
        }

        $this->httpClient = $httpClient;
        $this->provider = $provider;

        if ($this->provider === null && $this->config->isEnabled()) {
            $this->provider = $this->createGenericProvider();
        }
    }

    /**
     * Returns the SSO configuration instance.
     */
    public function getConfig(): SsoConfig
    {
        return $this->config;
    }

    /**
     * Returns the underlying League GenericProvider, initializing it if necessary.
     */
    public function getProvider(): GenericProvider
    {
        if ($this->provider === null) {
            $this->provider = $this->createGenericProvider();
        }
        return $this->provider;
    }

    /**
     * Injects an alternate GenericProvider (e.g. for testing).
     */
    public function setProvider(GenericProvider $provider): void
    {
        $this->provider = $provider;
    }

    /**
     * Builds the authorization URL for user redirection using PKCE S256 parameters.
     * Enforces HTTPS on the generated URL.
     *
     * @param string $state High-entropy, single-use state parameter
     * @param string $codeChallenge PKCE S256 code challenge
     * @param array $options Additional query parameters
     * @return string Secure HTTPS authorization URL
     * @throws RuntimeException If SSO is disabled or URL generation fails
     * @throws InvalidArgumentException If state or code_challenge is invalid
     */
    public function getAuthorizationUrl(string $state, string $codeChallenge, array $options = []): string
    {
        if (!$this->config->isEnabled()) {
            throw new RuntimeException('SSO is disabled in configuration.');
        }

        if (trim($state) === '') {
            throw new InvalidArgumentException('State parameter cannot be empty.');
        }

        if (trim($codeChallenge) === '') {
            throw new InvalidArgumentException('PKCE code challenge cannot be empty.');
        }

        $authOptions = array_merge([
            'state' => $state,
            'code_challenge' => $codeChallenge,
            'code_challenge_method' => 'S256',
            'response_type' => 'code',
        ], $options);

        try {
            $url = $this->getProvider()->getAuthorizationUrl($authOptions);
        } catch (Throwable $e) {
            throw new RuntimeException('Failed to generate authorization URL.');
        }

        if (!self::isHttpsUrl($url)) {
            throw new RuntimeException('Generated authorization URL must use the HTTPS scheme.');
        }

        return $url;
    }

    /**
     * Performs server-to-server HTTP POST exchange of authorization_code and code_verifier
     * for an access token using confidential client_secret and exact redirect_uri.
     *
     * @param string $code Authorization code from callback
     * @param string $codeVerifier PKCE code verifier from session
     * @return string Access token string (never logged or persisted)
     * @throws RuntimeException On token exchange failure
     * @throws InvalidArgumentException On missing code or code_verifier
     */
    public function exchangeCode(string $code, string $codeVerifier): string
    {
        $token = $this->requestAccessToken($code, $codeVerifier);
        return $token->getToken();
    }

    /**
     * Internal server-to-server token exchange request returning AccessTokenInterface.
     *
     * @param string $code Authorization code from callback
     * @param string $codeVerifier High-entropy PKCE code verifier
     * @return AccessTokenInterface
     * @throws RuntimeException
     * @throws InvalidArgumentException
     */
    public function requestAccessToken(string $code, string $codeVerifier): AccessTokenInterface
    {
        if (!$this->config->isEnabled()) {
            throw new RuntimeException('SSO is disabled in configuration.');
        }

        if (trim($code) === '') {
            throw new InvalidArgumentException('Authorization code cannot be empty.');
        }

        if (trim($codeVerifier) === '') {
            throw new InvalidArgumentException('PKCE code_verifier cannot be empty.');
        }

        try {
            // Server-to-server HTTP POST exchange:
            // authorization_code grant with code, code_verifier, client_secret, and exact redirect_uri
            /** @var AccessTokenInterface $token */
            $token = $this->getProvider()->getAccessToken('authorization_code', [
                'code' => $code,
                'code_verifier' => $codeVerifier,
                'client_secret' => $this->config->getClientSecret(),
                'redirect_uri' => $this->config->getRedirectUri(),
            ]);

            return $token;
        } catch (IdentityProviderException $e) {
            throw new RuntimeException('OAuth token exchange failed.');
        } catch (Throwable $e) {
            throw new RuntimeException('OAuth token exchange failed.');
        }
    }

    /**
     * Retrieves userinfo claims server-to-server by sending the access token
     * in the HTTP Authorization: Bearer header.
     *
     * @param string|AccessTokenInterface $accessToken Access token
     * @return array Userinfo claims payload
     * @throws RuntimeException On network, HTTP, or userinfo response failure
     * @throws InvalidArgumentException If access token is empty
     */
    public function getUserInfo(string|AccessTokenInterface $accessToken): array
    {
        if (!$this->config->isEnabled()) {
            throw new RuntimeException('SSO is disabled in configuration.');
        }

        $token = is_string($accessToken) ? new AccessToken(['access_token' => $accessToken]) : $accessToken;
        if (trim($token->getToken()) === '') {
            throw new InvalidArgumentException('Access token cannot be empty.');
        }

        $userInfoUrl = $this->config->getUserInfoUrl();
        if (!self::isHttpsUrl($userInfoUrl)) {
            throw new RuntimeException('Userinfo URL must use the HTTPS scheme.');
        }

        try {
            // Server-to-server GET request with Authorization: Bearer <token>
            $request = $this->getProvider()->getAuthenticatedRequest('GET', $userInfoUrl, $token);
            $response = $this->getProvider()->getParsedResponse($request);

            if (!is_array($response)) {
                throw new RuntimeException('OAuth userinfo fetch failed.');
            }

            return $response;
        } catch (IdentityProviderException $e) {
            throw new RuntimeException('OAuth userinfo fetch failed.');
        } catch (Throwable $e) {
            throw new RuntimeException('OAuth userinfo fetch failed.');
        }
    }

    /**
     * Alias for getUserInfo to satisfy contract conventions.
     *
     * @param string|AccessTokenInterface $accessToken
     * @return array
     */
    public function fetchUserInfo(string|AccessTokenInterface $accessToken): array
    {
        return $this->getUserInfo($accessToken);
    }

    /**
     * Completes full authentication flow:
     * 1. Server-to-server POST exchange (code + code_verifier -> access token)
     * 2. Server-to-server userinfo fetch with Authorization: Bearer <token>
     * 3. Construct and return provider-neutral IdentityProfile
     *
     * @param string $code Authorization code
     * @param string $codeVerifier PKCE code verifier
     * @return IdentityProfile
     * @throws RuntimeException
     */
    public function authenticate(string $code, string $codeVerifier): IdentityProfile
    {
        $accessToken = $this->exchangeCode($code, $codeVerifier);
        $claims = $this->getUserInfo($accessToken);

        return IdentityProfile::fromArray($claims, 'hub');
    }

    /**
     * Alias for authenticate.
     */
    public function getIdentityProfile(string $code, string $codeVerifier): IdentityProfile
    {
        return $this->authenticate($code, $codeVerifier);
    }

    /**
     * Sanitizes error messages by redacting sensitive tokens, secrets, codes,
     * verifiers, and filesystem paths to prevent information leakage.
     *
     * @param string $message Raw error message
     * @return string Sanitized and redacted error message
     */
    public function sanitizeError(string $message): string
    {
        $sanitized = $message;

        $sensitive = [
            $this->config->getClientSecret(),
            $this->config->getClientId(),
        ];

        foreach ($sensitive as $val) {
            if (is_string($val) && trim($val) !== '') {
                $sanitized = str_ireplace($val, '[REDACTED]', $sanitized);
            }
        }

        // Redact authorization headers and Bearer tokens
        $sanitized = preg_replace('/Bearer\s+[a-zA-Z0-9._~+\/-]+=*/i', 'Bearer [REDACTED]', $sanitized) ?? $sanitized;
        $sanitized = preg_replace('/(code|verifier|code_verifier|client_secret|access_token|refresh_token)\s*=\s*[^\s&;]+/i', '$1=[REDACTED]', $sanitized) ?? $sanitized;

        // Redact URL query strings that might carry parameters
        $sanitized = preg_replace('/\b(https?:\/\/[^\s?#]+)\?[^\s]*/i', '$1?[REDACTED_QUERY]', $sanitized) ?? $sanitized;

        // Redact filesystem paths
        $sanitized = preg_replace('/[a-zA-Z]:\\\\[^\s\'"]+/i', '[REDACTED_PATH]', $sanitized) ?? $sanitized;
        $sanitized = preg_replace('/(?:\/[\w.-]+)+\/[\w.-]+\.php/i', '[REDACTED_PATH]', $sanitized) ?? $sanitized;

        return trim($sanitized);
    }

    /**
     * Alias for sanitizeError.
     */
    public function cleanError(string $message): string
    {
        return $this->sanitizeError($message);
    }

    /**
     * Creates and configures the League GenericProvider instance.
     */
    private function createGenericProvider(): GenericProvider
    {
        $this->config->validate();

        $collaborators = [];
        if ($this->httpClient !== null) {
            $collaborators['httpClient'] = $this->httpClient;
        } elseif (class_exists(\GuzzleHttp\Client::class)) {
            $collaborators['httpClient'] = new \GuzzleHttp\Client([
                'timeout' => $this->config->getTimeout(),
            ]);
        }

        $providerOptions = [
            'clientId'                => $this->config->getClientId(),
            'clientSecret'            => $this->config->getClientSecret(),
            'redirectUri'             => $this->config->getRedirectUri(),
            'urlAuthorize'            => $this->config->getAuthorizeUrl(),
            'urlAccessToken'          => $this->config->getTokenUrl(),
            'urlResourceOwnerDetails' => $this->config->getUserInfoUrl(),
        ];

        return new GenericProvider($providerOptions, $collaborators);
    }

    private static function isHttpsUrl(string $url): bool
    {
        return SsoConfig::isHttpsUrl($url);
    }
}

// Global class alias for backward compatibility and flexible resolution
if (!class_exists('OAuthIdentityProviderClient', false)) {
    class_alias(OAuthIdentityProviderClient::class, 'OAuthIdentityProviderClient');
}
