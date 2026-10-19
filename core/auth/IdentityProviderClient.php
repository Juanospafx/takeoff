<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

/**
 * Provider-neutral Identity Provider Client Interface for Takeoff SSO.
 *
 * Defines the contract for initiating authorization, performing server-to-server
 * token exchanges, retrieving userinfo claims, and constructing normalized IdentityProfile instances.
 */
interface IdentityProviderClient
{
    /**
     * Builds the authorization URL for user redirection.
     *
     * @param string $state High-entropy, single-use state token
     * @param string $codeChallenge PKCE S256 code challenge
     * @param array $options Additional query parameters
     * @return string Secure HTTPS authorization URL
     */
    public function getAuthorizationUrl(string $state, string $codeChallenge, array $options = []): string;

    /**
     * Exchanges an authorization code and PKCE code_verifier for an access token via server-to-server POST.
     *
     * @param string $code Authorization code from callback
     * @param string $codeVerifier PKCE code verifier from session
     * @return string Access token string (never persisted or logged)
     */
    public function exchangeCode(string $code, string $codeVerifier): string;

    /**
     * Retrieves userinfo claims from the identity provider using Bearer token authentication.
     *
     * @param string $accessToken Access token
     * @return array Claims array from userinfo endpoint
     */
    public function getUserInfo(string $accessToken): array;

    /**
     * Executes the complete exchange and profile resolution flow.
     *
     * @param string $code Authorization code from callback
     * @param string $codeVerifier PKCE code verifier from session
     * @return IdentityProfile Normalized identity profile
     */
    public function authenticate(string $code, string $codeVerifier): IdentityProfile;
}

// Global class alias for backward compatibility and flexible resolution
if (!interface_exists('IdentityProviderClient', false)) {
    class_alias(IdentityProviderClient::class, 'IdentityProviderClient');
}
