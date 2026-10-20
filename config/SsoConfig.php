<?php
declare(strict_types=1);

namespace Takeoff\Config;

use InvalidArgumentException;

/**
 * SSO Configuration manager for Takeoff.
 *
 * Implements strict precedence:
 *   1. Environment variables (TAKEOFF_SSO_*)
 *   2. Optional private local configuration file outside repo and document root
 *   3. Safe defaults: SSO is disabled by default (fail-closed).
 *
 * Security rules:
 *   - SSO remains disabled by default until explicitly provisioned and enabled.
 *   - All endpoints (Hub base URL, redirect URI, authorize, token, userinfo) MUST use HTTPS.
 *   - Configuration and timeout validation fails closed without exposing values.
 *   - No credentials or private paths are exposed in exceptions or string representations.
 */
class SsoConfig
{
    public const SSO_ENABLED = false;
    public const KEY_ENABLED = 'TAKEOFF_SSO_ENABLED';
    public const KEY_HUB_BASE_URL = 'TAKEOFF_SSO_HUB_BASE_URL';
    public const KEY_CLIENT_ID = 'TAKEOFF_SSO_CLIENT_ID';
    public const KEY_CLIENT_SECRET = 'TAKEOFF_SSO_CLIENT_SECRET';
    public const KEY_REDIRECT_URI = 'TAKEOFF_SSO_REDIRECT_URI';
    public const KEY_TIMEOUT = 'TAKEOFF_SSO_TIMEOUT';
    public const KEY_PRIVATE_CONFIG = 'TAKEOFF_SSO_PRIVATE_CONFIG';
    public const KEY_AUTHORIZE_URL = 'TAKEOFF_SSO_AUTHORIZE_URL';
    public const KEY_TOKEN_URL = 'TAKEOFF_SSO_TOKEN_URL';
    public const KEY_USERINFO_URL = 'TAKEOFF_SSO_USERINFO_URL';

    public const APPROVED_VARIABLES = [
        self::KEY_ENABLED,
        self::KEY_HUB_BASE_URL,
        self::KEY_CLIENT_ID,
        self::KEY_CLIENT_SECRET,
        self::KEY_REDIRECT_URI,
        self::KEY_TIMEOUT,
        self::KEY_AUTHORIZE_URL,
        self::KEY_TOKEN_URL,
        self::KEY_USERINFO_URL,
    ];

    public const REQUIRED_WHEN_ENABLED = [
        self::KEY_HUB_BASE_URL,
        self::KEY_CLIENT_ID,
        self::KEY_CLIENT_SECRET,
        self::KEY_REDIRECT_URI,
    ];

    public const DEFAULT_TIMEOUT = 10;

    private bool $enabled;
    private string $hubBaseUrl;
    private string $clientId;
    private string $clientSecret;
    private string $redirectUri;
    private int $timeout;
    private ?string $authorizeUrl;
    private ?string $tokenUrl;
    private ?string $userInfoUrl;
    private ?string $privateConfigFile;

    /**
     * @param array $values Explicit configuration key-value pairs or overrides
     * @param string|null $privateConfigFile Path to loaded private configuration file, if any
     */
    public function __construct(array $values = [], ?string $privateConfigFile = null)
    {
        $this->privateConfigFile = $privateConfigFile;

        $lookup = static function (array $aliases) use ($values): mixed {
            foreach ($aliases as $alias) {
                if (array_key_exists($alias, $values) && $values[$alias] !== null) {
                    return $values[$alias];
                }
            }
            return null;
        };

        $rawEnabled = $lookup([self::KEY_ENABLED, 'enabled', 'sso_enabled']);
        $this->enabled = $rawEnabled !== null ? self::castBool($rawEnabled) : false;

        $rawHubBaseUrl = $lookup([self::KEY_HUB_BASE_URL, 'hub_base_url', 'hub_url', 'sso_hub_base_url']);
        $this->hubBaseUrl = $rawHubBaseUrl !== null ? trim((string)$rawHubBaseUrl) : '';

        $rawClientId = $lookup([self::KEY_CLIENT_ID, 'client_id', 'sso_client_id']);
        $this->clientId = $rawClientId !== null ? trim((string)$rawClientId) : '';

        $rawClientSecret = $lookup([self::KEY_CLIENT_SECRET, 'client_secret', 'sso_client_secret']);
        $this->clientSecret = $rawClientSecret !== null ? (string)$rawClientSecret : '';

        $rawRedirectUri = $lookup([self::KEY_REDIRECT_URI, 'redirect_uri', 'sso_redirect_uri']);
        $this->redirectUri = $rawRedirectUri !== null ? trim((string)$rawRedirectUri) : '';

        $rawTimeout = $lookup([self::KEY_TIMEOUT, 'timeout', 'sso_timeout']);
        $this->timeout = $rawTimeout !== null ? self::castInt($rawTimeout, self::DEFAULT_TIMEOUT) : self::DEFAULT_TIMEOUT;

        $rawAuthUrl = $lookup([self::KEY_AUTHORIZE_URL, 'authorize_url', 'urlAuthorize']);
        $this->authorizeUrl = ($rawAuthUrl !== null && trim((string)$rawAuthUrl) !== '') ? trim((string)$rawAuthUrl) : null;

        $rawTokenUrl = $lookup([self::KEY_TOKEN_URL, 'token_url', 'urlAccessToken']);
        $this->tokenUrl = ($rawTokenUrl !== null && trim((string)$rawTokenUrl) !== '') ? trim((string)$rawTokenUrl) : null;

        $rawUserInfoUrl = $lookup([self::KEY_USERINFO_URL, 'userinfo_url', 'urlResourceOwnerDetails']);
        $this->userInfoUrl = ($rawUserInfoUrl !== null && trim((string)$rawUserInfoUrl) !== '') ? trim((string)$rawUserInfoUrl) : null;
    }

    /**
     * Loads SSO configuration with environment variables having strict precedence over
     * an optional private PHP file located outside the repository and document root.
     * Fails closed if configuration is invalid or incomplete when enabled.
     *
     * @param string|null $privateConfigFile Explicit path to external private PHP configuration file
     * @return self
     * @throws InvalidArgumentException
     */
    public static function load(?string $privateConfigFile = null): self
    {
        $filePath = $privateConfigFile;
        if ($filePath !== null && trim($filePath) === '') {
            throw new InvalidArgumentException('Private configuration file path cannot be empty');
        }

        if ($filePath === null) {
            $envPath = self::readEnv(self::KEY_PRIVATE_CONFIG);
            if ($envPath !== null) {
                if (trim($envPath) === '') {
                    throw new InvalidArgumentException('Private configuration file path cannot be empty');
                }
                $filePath = $envPath;
            }
        }

        $fileConfig = [];
        if ($filePath !== null) {
            $trimmedPath = trim($filePath);

            // Extension must be PHP
            if (strtolower(pathinfo($trimmedPath, PATHINFO_EXTENSION)) !== 'php') {
                throw new InvalidArgumentException('Private configuration file must be a PHP file');
            }

            // Reject paths inside repository or document root without exposing path value
            if (self::isPathInternal($trimmedPath)) {
                throw new InvalidArgumentException('Private configuration file must be located outside repository and document root');
            }

            if (!file_exists($trimmedPath)) {
                throw new InvalidArgumentException('Private configuration file does not exist');
            }

            $realPath = realpath($trimmedPath);
            if ($realPath === false || !is_file($realPath)) {
                throw new InvalidArgumentException('Private configuration file must be a regular file');
            }

            if (!is_readable($realPath)) {
                throw new InvalidArgumentException('Private configuration file is not readable');
            }

            if (self::isInsideRepoOrDocRoot($realPath)) {
                throw new InvalidArgumentException('Private configuration file must be located outside repository and document root');
            }

            try {
                $loaded = (static function (string $file): mixed {
                    return include $file;
                })($realPath);
            } catch (\Throwable) {
                throw new InvalidArgumentException('Failed to load private configuration file');
            }

            if (!is_array($loaded)) {
                throw new InvalidArgumentException('Private configuration file must return a configuration array');
            }

            $fileConfig = $loaded;
        }

        $keyAliases = [
            self::KEY_ENABLED => [self::KEY_ENABLED, 'enabled', 'sso_enabled'],
            self::KEY_HUB_BASE_URL => [self::KEY_HUB_BASE_URL, 'hub_base_url', 'hub_url', 'sso_hub_base_url'],
            self::KEY_CLIENT_ID => [self::KEY_CLIENT_ID, 'client_id', 'sso_client_id'],
            self::KEY_CLIENT_SECRET => [self::KEY_CLIENT_SECRET, 'client_secret', 'sso_client_secret'],
            self::KEY_REDIRECT_URI => [self::KEY_REDIRECT_URI, 'redirect_uri', 'sso_redirect_uri'],
            self::KEY_TIMEOUT => [self::KEY_TIMEOUT, 'timeout', 'sso_timeout'],
            self::KEY_AUTHORIZE_URL => [self::KEY_AUTHORIZE_URL, 'authorize_url', 'urlAuthorize'],
            self::KEY_TOKEN_URL => [self::KEY_TOKEN_URL, 'token_url', 'urlAccessToken'],
            self::KEY_USERINFO_URL => [self::KEY_USERINFO_URL, 'userinfo_url', 'urlResourceOwnerDetails'],
        ];

        $resolved = [];

        // 1. File values
        foreach ($keyAliases as $canonicalKey => $aliases) {
            foreach ($aliases as $alias) {
                if (array_key_exists($alias, $fileConfig) && $fileConfig[$alias] !== null) {
                    $resolved[$canonicalKey] = $fileConfig[$alias];
                    break;
                }
            }
        }

        // 2. Environment overrides (strict highest precedence)
        foreach (self::APPROVED_VARIABLES as $key) {
            $envVal = self::readEnv($key);
            if ($envVal !== null) {
                $resolved[$key] = $envVal;
            }
        }

        $instance = new self($resolved, $filePath);
        $instance->validate();

        return $instance;
    }

    /**
     * Validates configuration completeness and HTTPS scheme enforcement.
     * Fails closed without exposing secret or URL values in exception messages.
     *
     * @throws InvalidArgumentException
     */
    public function validate(): void
    {
        if ($this->timeout <= 0) {
            throw new InvalidArgumentException('SSO configuration is invalid: timeout must be a positive integer');
        }

        if ($this->enabled) {
            if ($this->hubBaseUrl === '') {
                throw new InvalidArgumentException('SSO configuration is incomplete: Hub base URL is required when SSO is enabled');
            }
            if (!self::isHttpsUrl($this->hubBaseUrl)) {
                throw new InvalidArgumentException('SSO configuration is invalid: Hub base URL must use the HTTPS scheme');
            }

            if ($this->clientId === '') {
                throw new InvalidArgumentException('SSO configuration is incomplete: Client ID is required when SSO is enabled');
            }

            if ($this->clientSecret === '') {
                throw new InvalidArgumentException('SSO configuration is incomplete: Client Secret is required when SSO is enabled');
            }

            if ($this->redirectUri === '') {
                throw new InvalidArgumentException('SSO configuration is incomplete: Redirect URI is required when SSO is enabled');
            }
            if (!self::isHttpsUrl($this->redirectUri)) {
                throw new InvalidArgumentException('SSO configuration is invalid: Redirect URI must use the HTTPS scheme');
            }

            $authUrl = $this->getAuthorizeUrl();
            if ($authUrl === '' || !self::isHttpsUrl($authUrl)) {
                throw new InvalidArgumentException('SSO configuration is invalid: Authorize URL must use the HTTPS scheme');
            }

            $tokenUrl = $this->getTokenUrl();
            if ($tokenUrl === '' || !self::isHttpsUrl($tokenUrl)) {
                throw new InvalidArgumentException('SSO configuration is invalid: Token URL must use the HTTPS scheme');
            }

            $userInfoUrl = $this->getUserInfoUrl();
            if ($userInfoUrl === '' || !self::isHttpsUrl($userInfoUrl)) {
                throw new InvalidArgumentException('SSO configuration is invalid: UserInfo URL must use the HTTPS scheme');
            }
        } else {
            // Even when disabled, any explicitly configured URL must use HTTPS
            if ($this->hubBaseUrl !== '' && !self::isHttpsUrl($this->hubBaseUrl)) {
                throw new InvalidArgumentException('SSO configuration is invalid: Hub base URL must use the HTTPS scheme');
            }
            if ($this->redirectUri !== '' && !self::isHttpsUrl($this->redirectUri)) {
                throw new InvalidArgumentException('SSO configuration is invalid: Redirect URI must use the HTTPS scheme');
            }
            if ($this->authorizeUrl !== null && !self::isHttpsUrl($this->authorizeUrl)) {
                throw new InvalidArgumentException('SSO configuration is invalid: Authorize URL must use the HTTPS scheme');
            }
            if ($this->tokenUrl !== null && !self::isHttpsUrl($this->tokenUrl)) {
                throw new InvalidArgumentException('SSO configuration is invalid: Token URL must use the HTTPS scheme');
            }
            if ($this->userInfoUrl !== null && !self::isHttpsUrl($this->userInfoUrl)) {
                throw new InvalidArgumentException('SSO configuration is invalid: UserInfo URL must use the HTTPS scheme');
            }
        }
    }

    public function isEnabled(): bool
    {
        return $this->enabled;
    }

    public function getHubBaseUrl(): string
    {
        return $this->hubBaseUrl;
    }

    public function getClientId(): string
    {
        return $this->clientId;
    }

    public function getClientSecret(): string
    {
        return $this->clientSecret;
    }

    public function getRedirectUri(): string
    {
        return $this->redirectUri;
    }

    public function getTimeout(): int
    {
        return $this->timeout;
    }

    public function getAuthorizeUrl(): string
    {
        if ($this->authorizeUrl !== null && $this->authorizeUrl !== '') {
            return $this->authorizeUrl;
        }
        if ($this->hubBaseUrl !== '') {
            return rtrim($this->hubBaseUrl, '/') . '/oauth/authorize';
        }
        return '';
    }

    public function getTokenUrl(): string
    {
        if ($this->tokenUrl !== null && $this->tokenUrl !== '') {
            return $this->tokenUrl;
        }
        if ($this->hubBaseUrl !== '') {
            return rtrim($this->hubBaseUrl, '/') . '/oauth/token';
        }
        return '';
    }

    public function getUserInfoUrl(): string
    {
        if ($this->userInfoUrl !== null && $this->userInfoUrl !== '') {
            return $this->userInfoUrl;
        }
        if ($this->hubBaseUrl !== '') {
            return rtrim($this->hubBaseUrl, '/') . '/oauth/userinfo';
        }
        return '';
    }

    public function getPrivateConfigFile(): ?string
    {
        return $this->privateConfigFile;
    }

    /**
     * Sanitized array representation masking sensitive secrets.
     */
    public function toArray(): array
    {
        return [
            self::KEY_ENABLED => $this->isEnabled(),
            self::KEY_HUB_BASE_URL => $this->getHubBaseUrl(),
            self::KEY_CLIENT_ID => $this->getClientId(),
            self::KEY_CLIENT_SECRET => $this->clientSecret !== '' ? '******' : '',
            self::KEY_REDIRECT_URI => $this->getRedirectUri(),
            self::KEY_TIMEOUT => $this->getTimeout(),
            self::KEY_AUTHORIZE_URL => $this->getAuthorizeUrl(),
            self::KEY_TOKEN_URL => $this->getTokenUrl(),
            self::KEY_USERINFO_URL => $this->getUserInfoUrl(),
        ];
    }

    public function __debugInfo(): array
    {
        return $this->toArray();
    }

    /**
     * Validates that a string is a valid URL with the HTTPS scheme.
     */
    public static function isHttpsUrl(string $url): bool
    {
        $trimmed = trim($url);
        if ($trimmed === '' || filter_var($trimmed, FILTER_VALIDATE_URL) === false) {
            return false;
        }

        $scheme = parse_url($trimmed, PHP_URL_SCHEME);
        return is_string($scheme) && strtolower($scheme) === 'https';
    }

    private static function readEnv(string $key): ?string
    {
        if (isset($_ENV[$key]) && (string)$_ENV[$key] !== '') {
            return (string)$_ENV[$key];
        }
        if (isset($_SERVER[$key]) && (string)$_SERVER[$key] !== '') {
            return (string)$_SERVER[$key];
        }
        $val = getenv($key);
        if ($val !== false && (string)$val !== '') {
            return (string)$val;
        }
        return null;
    }

    private static function castBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }
        if (is_string($value)) {
            $lower = strtolower(trim($value));
            return in_array($lower, ['true', '1', 'yes', 'on'], true);
        }
        return false;
    }

    private static function castInt(mixed $value, int $default): int
    {
        if (is_int($value)) {
            return $value;
        }
        if (is_string($value) && ctype_digit(trim($value))) {
            return (int)trim($value);
        }
        if (is_numeric($value)) {
            return (int)$value;
        }
        return $default;
    }

    private static function isPathInternal(string $path): bool
    {
        $normalized = strtolower(str_replace('\\', '/', trim($path)));

        $internalDirs = [
            'core/', './core/',
            'config/', './config/',
            'contracts/', './contracts/',
            'bin/', './bin/',
            'tests/', './tests/',
            'db/', './db/',
            'api/', './api/',
            'assets/', './assets/',
            'pages/', './pages/',
            'docs/', './docs/',
            'vendor/', './vendor/',
            'harness/', './harness/',
        ];
        foreach ($internalDirs as $dir) {
            if (str_starts_with($normalized, $dir)) {
                return true;
            }
        }

        $repoRoot = realpath(dirname(__DIR__));
        if ($repoRoot !== false) {
            $normRepo = strtolower(str_replace('\\', '/', $repoRoot));
            if ($normalized === $normRepo || str_starts_with($normalized, rtrim($normRepo, '/') . '/')) {
                return true;
            }
        }

        if (!empty($_SERVER['DOCUMENT_ROOT'])) {
            $docRoot = realpath($_SERVER['DOCUMENT_ROOT']);
            if ($docRoot !== false) {
                $normDoc = strtolower(str_replace('\\', '/', $docRoot));
                if ($normalized === $normDoc || str_starts_with($normalized, rtrim($normDoc, '/') . '/')) {
                    return true;
                }
            }
        }

        return false;
    }

    private static function isInsideRepoOrDocRoot(string $realPath): bool
    {
        $normalized = strtolower(str_replace('\\', '/', $realPath));

        $repoRoot = realpath(dirname(__DIR__));
        if ($repoRoot !== false) {
            $normRepo = strtolower(str_replace('\\', '/', $repoRoot));
            if ($normalized === $normRepo || str_starts_with($normalized, rtrim($normRepo, '/') . '/')) {
                return true;
            }
        }

        if (!empty($_SERVER['DOCUMENT_ROOT'])) {
            $docRoot = realpath($_SERVER['DOCUMENT_ROOT']);
            if ($docRoot !== false) {
                $normDoc = strtolower(str_replace('\\', '/', $docRoot));
                if ($normalized === $normDoc || str_starts_with($normalized, rtrim($normDoc, '/') . '/')) {
                    return true;
                }
            }
        }

        return false;
    }
}

// Global class alias for backward compatibility and flexible resolution
if (!class_exists('SsoConfig', false)) {
    class_alias(SsoConfig::class, 'SsoConfig');
}

if (!defined('SSO_ENABLED')) {
    define('SSO_ENABLED', false);
}
