<?php
declare(strict_types=1);

/**
 * Configuration manager for WonProject integration.
 *
 * Implements strict precedence:
 *   1. Environment variables ($_ENV, $_SERVER, getenv)
 *   2. Optional private local configuration file outside document root
 *   3. Safe defaults (export disabled, timeout 30s)
 *
 * Approved configuration variables:
 *   - WON_PROJECT_EXPORT_ENABLED (bool, default false)
 *   - WON_PROJECT_HMAC_ACTIVE_KEY_ID (string, default '')
 *   - WON_PROJECT_HMAC_ACTIVE_SECRET (string, default '')
 *   - ELECTROPLAN_WON_PROJECT_ENDPOINT (string, default '')
 *   - WON_PROJECT_REQUEST_TIMEOUT_SECONDS (int, default 30)
 */
class WonProjectIntegrationConfig
{
    public const KEY_EXPORT_ENABLED = 'WON_PROJECT_EXPORT_ENABLED';
    public const KEY_HMAC_KEY_ID = 'WON_PROJECT_HMAC_ACTIVE_KEY_ID';
    public const KEY_HMAC_SECRET = 'WON_PROJECT_HMAC_ACTIVE_SECRET';
    public const KEY_ENDPOINT = 'ELECTROPLAN_WON_PROJECT_ENDPOINT';
    public const KEY_TIMEOUT_SECONDS = 'WON_PROJECT_REQUEST_TIMEOUT_SECONDS';

    public const APPROVED_VARIABLES = [
        self::KEY_EXPORT_ENABLED,
        self::KEY_HMAC_KEY_ID,
        self::KEY_HMAC_SECRET,
        self::KEY_ENDPOINT,
        self::KEY_TIMEOUT_SECONDS,
    ];

    private const DEFAULTS = [
        self::KEY_EXPORT_ENABLED => false,
        self::KEY_HMAC_KEY_ID => '',
        self::KEY_HMAC_SECRET => '',
        self::KEY_ENDPOINT => '',
        self::KEY_TIMEOUT_SECONDS => 30,
    ];

    private array $values;

    /**
     * @param array $values Explicit configuration key-value overrides
     */
    public function __construct(array $values = [])
    {
        $resolved = self::DEFAULTS;
        foreach (self::APPROVED_VARIABLES as $key) {
            if (array_key_exists($key, $values) && $values[$key] !== null) {
                $resolved[$key] = self::castValue($key, $values[$key]);
            }
        }
        $this->values = $resolved;
    }

    /**
     * Loads configuration applying environment, optional private PHP file, and safe defaults.
     *
     * @param string|null $privateConfigFile Explicit private config file path (defaults to WON_PROJECT_PRIVATE_CONFIG env var)
     * @return self
     */
    public static function load(?string $privateConfigFile = null): self
    {
        // 1. Safe defaults
        $resolved = self::DEFAULTS;

        // 2. Optional private local configuration file
        $filePath = $privateConfigFile;
        if ($filePath === null || trim($filePath) === '') {
            $filePath = self::readEnv('WON_PROJECT_PRIVATE_CONFIG');
        }

        $fileConfig = [];
        if ($filePath !== null && trim($filePath) !== '') {
            $trimmedPath = trim($filePath);

            // Extension must be PHP
            if (strtolower(pathinfo($trimmedPath, PATHINFO_EXTENSION)) !== 'php') {
                throw new InvalidArgumentException("Private configuration file must be a PHP file");
            }

            // Reject internal repository or document root paths without exposing the path
            if (self::isPathInternal($trimmedPath)) {
                throw new InvalidArgumentException("Private configuration file must be located outside repository and document root");
            }

            if (file_exists($trimmedPath)) {
                $realPath = realpath($trimmedPath);
                if ($realPath === false || !is_file($realPath)) {
                    throw new InvalidArgumentException("Invalid private configuration file");
                }

                if (self::isInsideRepoOrDocRoot($realPath)) {
                    throw new InvalidArgumentException("Private configuration file must be located outside repository and document root");
                }

                $loaded = (static function (string $file): mixed {
                    return include $file;
                })($realPath);

                if (is_array($loaded)) {
                    $fileConfig = $loaded;
                }
            }
        }

        // Apply file overrides over defaults
        foreach (self::APPROVED_VARIABLES as $key) {
            if (array_key_exists($key, $fileConfig) && $fileConfig[$key] !== null) {
                $resolved[$key] = self::castValue($key, $fileConfig[$key]);
            }
        }

        // 3. Environment overrides (highest precedence)
        foreach (self::APPROVED_VARIABLES as $key) {
            $envVal = self::readEnv($key);
            if ($envVal !== null) {
                $resolved[$key] = self::castValue($key, $envVal);
            }
        }

        $instance = new self($resolved);
        $instance->validate();

        return $instance;
    }

    /**
     * Validates configuration invariants.
     * If export is enabled, requires valid HTTPS endpoint, active key ID, non-empty secret, and positive timeout.
     *
     * @throws InvalidArgumentException
     */
    public function validate(): void
    {
        $exportEnabled = $this->values[self::KEY_EXPORT_ENABLED];
        if (!is_bool($exportEnabled)) {
            throw new InvalidArgumentException("WON_PROJECT_EXPORT_ENABLED must be a valid boolean");
        }

        if (!$exportEnabled) {
            return;
        }

        $timeout = $this->values[self::KEY_TIMEOUT_SECONDS];
        if (!is_int($timeout) || $timeout <= 0) {
            throw new InvalidArgumentException("WON_PROJECT_REQUEST_TIMEOUT_SECONDS must be a positive integer");
        }

        $endpoint = $this->getEndpoint();
        if ($endpoint === '') {
            throw new InvalidArgumentException("ELECTROPLAN_WON_PROJECT_ENDPOINT is required when WonProject export is enabled");
        }

        $scheme = parse_url($endpoint, PHP_URL_SCHEME);
        if (!is_string($scheme) || strtolower($scheme) !== 'https') {
            throw new InvalidArgumentException("ELECTROPLAN_WON_PROJECT_ENDPOINT must use HTTPS scheme. Insecure endpoints are rejected.");
        }

        $user = parse_url($endpoint, PHP_URL_USER);
        $pass = parse_url($endpoint, PHP_URL_PASS);
        if (($user !== null && $user !== false) || ($pass !== null && $pass !== false)) {
            throw new InvalidArgumentException("ELECTROPLAN_WON_PROJECT_ENDPOINT must not contain URL credentials");
        }

        $host = parse_url($endpoint, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            throw new InvalidArgumentException("ELECTROPLAN_WON_PROJECT_ENDPOINT must include a valid host");
        }

        if (trim($this->getHmacKeyId()) === '') {
            throw new InvalidArgumentException("WON_PROJECT_HMAC_ACTIVE_KEY_ID is required when WonProject export is enabled");
        }

        if (trim($this->getHmacSecret()) === '') {
            throw new InvalidArgumentException("WON_PROJECT_HMAC_ACTIVE_SECRET is required when WonProject export is enabled");
        }
    }

    public function isExportEnabled(): bool
    {
        return $this->values[self::KEY_EXPORT_ENABLED] === true;
    }

    public function getHmacKeyId(): string
    {
        return (string)$this->values[self::KEY_HMAC_KEY_ID];
    }

    public function getHmacSecret(): string
    {
        return (string)$this->values[self::KEY_HMAC_SECRET];
    }

    public function getEndpoint(): string
    {
        return (string)$this->values[self::KEY_ENDPOINT];
    }

    public function getTimeoutSeconds(): int
    {
        return (int)$this->values[self::KEY_TIMEOUT_SECONDS];
    }

    /**
     * Sanitized array representation that completely omits secret material.
     */
    public function toArray(): array
    {
        return [
            self::KEY_EXPORT_ENABLED => $this->isExportEnabled(),
            self::KEY_HMAC_KEY_ID => $this->getHmacKeyId(),
            self::KEY_ENDPOINT => $this->getEndpoint(),
            self::KEY_TIMEOUT_SECONDS => $this->getTimeoutSeconds(),
        ];
    }

    public function __debugInfo(): array
    {
        return $this->toArray();
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
        if ($val !== false && $val !== '') {
            return (string)$val;
        }
        return null;
    }

    private static function castValue(string $key, mixed $value): mixed
    {
        if ($key === self::KEY_EXPORT_ENABLED) {
            if (is_bool($value)) {
                return $value;
            }
            $filtered = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($filtered !== null) {
                return $filtered;
            }
            return $value;
        }

        if ($key === self::KEY_TIMEOUT_SECONDS) {
            if (is_int($value)) {
                return $value;
            }
            if (is_string($value) && ctype_digit(trim($value))) {
                return (int)trim($value);
            }
            if (is_numeric($value)) {
                return (int)$value;
            }
            return $value;
        }

        return trim((string)$value);
    }

    private static function isPathInternal(string $path): bool
    {
        $normalized = strtolower(str_replace('\\', '/', trim($path)));

        $internalDirs = [
            'core/', './core/',
            'contracts/', './contracts/',
            'bin/', './bin/',
            'tests/', './tests/',
            'db/', './db/',
            'api/', './api/',
            'assets/', './assets/',
            'pages/', './pages/',
        ];
        foreach ($internalDirs as $dir) {
            if (str_starts_with($normalized, $dir)) {
                return true;
            }
        }

        $repoRoot = realpath(dirname(__DIR__, 2));
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

        $repoRoot = realpath(dirname(__DIR__, 2));
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
