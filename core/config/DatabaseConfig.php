<?php
declare(strict_types=1);

/**
 * Database configuration manager for Takeoff.
 *
 * Implements strict precedence:
 *   1. Environment variables (TAKEOFF_DB_*)
 *   2. Optional private local configuration file outside repo and document root
 *   3. Fail-closed: missing or incomplete configuration throws an exception.
 *
 * Supported variables:
 *   - TAKEOFF_DB_HOST (string, required)
 *   - TAKEOFF_DB_PORT (int, optional, default 3306)
 *   - TAKEOFF_DB_NAME (string, required)
 *   - TAKEOFF_DB_USER (string, required)
 *   - TAKEOFF_DB_PASSWORD (string, required)
 *   - TAKEOFF_DB_PRIVATE_CONFIG (string, optional path to external PHP config file)
 */
class DatabaseConfig
{
    public const KEY_HOST = 'TAKEOFF_DB_HOST';
    public const KEY_PORT = 'TAKEOFF_DB_PORT';
    public const KEY_NAME = 'TAKEOFF_DB_NAME';
    public const KEY_USER = 'TAKEOFF_DB_USER';
    public const KEY_PASSWORD = 'TAKEOFF_DB_PASSWORD';
    public const KEY_PRIVATE_CONFIG = 'TAKEOFF_DB_PRIVATE_CONFIG';

    public const APPROVED_VARIABLES = [
        self::KEY_HOST,
        self::KEY_PORT,
        self::KEY_NAME,
        self::KEY_USER,
        self::KEY_PASSWORD,
    ];

    public const REQUIRED_VARIABLES = [
        self::KEY_HOST,
        self::KEY_NAME,
        self::KEY_USER,
        self::KEY_PASSWORD,
    ];

    public const SUPPORTED_VARIABLES = [
        self::KEY_HOST,
        self::KEY_PORT,
        self::KEY_NAME,
        self::KEY_USER,
        self::KEY_PASSWORD,
        self::KEY_PRIVATE_CONFIG,
    ];

    public const DEFAULT_PORT = 3306;
    public const DEFAULT_CHARSET = 'utf8mb4';

    private array $values;
    private ?string $privateConfigFile;

    /**
     * @param array $values Explicit configuration key-value overrides
     * @param string|null $privateConfigFile Path to loaded private configuration file, if any
     */
    public function __construct(array $values = [], ?string $privateConfigFile = null)
    {
        $this->privateConfigFile = $privateConfigFile;

        $resolved = [
            self::KEY_HOST => null,
            self::KEY_PORT => self::DEFAULT_PORT,
            self::KEY_NAME => null,
            self::KEY_USER => null,
            self::KEY_PASSWORD => null,
        ];

        foreach (self::APPROVED_VARIABLES as $key) {
            if (array_key_exists($key, $values) && $values[$key] !== null) {
                $resolved[$key] = self::castValue($key, $values[$key]);
            }
        }

        $this->values = $resolved;
    }

    /**
     * Loads configuration applying private PHP file (if configured) and environment overrides.
     * Environment variables strictly take precedence over private file values.
     * Fails closed if configuration is incomplete.
     *
     * @param string|null $privateConfigFile Explicit private config file path (defaults to TAKEOFF_DB_PRIVATE_CONFIG env var)
     * @return self
     * @throws InvalidArgumentException
     */
    public static function load(?string $privateConfigFile = null): self
    {
        $filePath = $privateConfigFile;
        if ($filePath !== null && trim($filePath) === '') {
            throw new InvalidArgumentException("Private configuration file path cannot be empty");
        }

        if ($filePath === null) {
            $envPath = self::readEnv(self::KEY_PRIVATE_CONFIG);
            if ($envPath !== null) {
                if (trim((string)$envPath) === '') {
                    throw new InvalidArgumentException("Private configuration file path cannot be empty");
                }
                $filePath = (string)$envPath;
            }
        }

        $fileConfig = [];
        if ($filePath !== null) {
            $trimmedPath = trim($filePath);

            // Extension must be PHP
            if (strtolower(pathinfo($trimmedPath, PATHINFO_EXTENSION)) !== 'php') {
                throw new InvalidArgumentException("Private configuration file must be a PHP file");
            }

            // Reject internal repository or document root paths without exposing the path
            if (self::isPathInternal($trimmedPath)) {
                throw new InvalidArgumentException("Private configuration file must be located outside repository and document root");
            }

            // Must exist
            if (!file_exists($trimmedPath)) {
                throw new InvalidArgumentException("Private configuration file does not exist");
            }

            $realPath = realpath($trimmedPath);
            if ($realPath === false || !is_file($realPath)) {
                throw new InvalidArgumentException("Private configuration file must be a regular file");
            }

            if (!is_readable($realPath)) {
                throw new InvalidArgumentException("Private configuration file is not readable");
            }

            if (self::isInsideRepoOrDocRoot($realPath)) {
                throw new InvalidArgumentException("Private configuration file must be located outside repository and document root");
            }

            try {
                $loaded = (static function (string $file): mixed {
                    return include $file;
                })($realPath);
            } catch (\Throwable) {
                throw new InvalidArgumentException("Failed to load private configuration file");
            }

            if (!is_array($loaded)) {
                throw new InvalidArgumentException("Private configuration file must return a configuration array");
            }

            $fileConfig = $loaded;
        }

        $keyAliases = [
            self::KEY_HOST => [self::KEY_HOST, 'host', 'DB_HOST', 'db_host'],
            self::KEY_PORT => [self::KEY_PORT, 'port', 'DB_PORT', 'db_port'],
            self::KEY_NAME => [self::KEY_NAME, 'database', 'dbname', 'name', 'DB_NAME', 'db_name'],
            self::KEY_USER => [self::KEY_USER, 'user', 'username', 'DB_USER', 'db_user'],
            self::KEY_PASSWORD => [self::KEY_PASSWORD, 'password', 'pass', 'DB_PASSWORD', 'db_password', 'DB_PASS'],
        ];

        $resolved = [
            self::KEY_HOST => null,
            self::KEY_PORT => self::DEFAULT_PORT,
            self::KEY_NAME => null,
            self::KEY_USER => null,
            self::KEY_PASSWORD => null,
        ];

        // 1. File values
        foreach ($keyAliases as $canonicalKey => $aliases) {
            foreach ($aliases as $alias) {
                if (array_key_exists($alias, $fileConfig) && $fileConfig[$alias] !== null) {
                    $resolved[$canonicalKey] = self::castValue($canonicalKey, $fileConfig[$alias]);
                    break;
                }
            }
        }

        // 2. Environment overrides (highest precedence)
        foreach (self::APPROVED_VARIABLES as $key) {
            $envVal = self::readEnv($key);
            if ($envVal !== null) {
                $resolved[$key] = self::castValue($key, $envVal);
            }
        }

        $instance = new self($resolved, $filePath);
        $instance->validate();

        return $instance;
    }

    /**
     * Validates configuration completeness and correctness.
     * Fails closed if any required parameter is missing or invalid.
     *
     * @throws InvalidArgumentException
     */
    public function validate(): void
    {
        foreach (self::REQUIRED_VARIABLES as $requiredKey) {
            $val = $this->values[$requiredKey] ?? null;
            if ($val === null || (is_string($val) && trim($val) === '')) {
                throw new InvalidArgumentException("Database configuration is incomplete: {$requiredKey} is required");
            }
        }

        $port = $this->values[self::KEY_PORT] ?? null;
        if ($port !== null) {
            if (!is_int($port) || $port <= 0 || $port > 65535) {
                throw new InvalidArgumentException("Database configuration is invalid: " . self::KEY_PORT . " must be a valid port number (1-65535)");
            }
        }
    }

    public function getHost(): string
    {
        return (string)($this->values[self::KEY_HOST] ?? '');
    }

    public function getPort(): int
    {
        return (int)($this->values[self::KEY_PORT] ?? self::DEFAULT_PORT);
    }

    public function getName(): string
    {
        return (string)($this->values[self::KEY_NAME] ?? '');
    }

    public function getDatabase(): string
    {
        return $this->getName();
    }

    public function getUser(): string
    {
        return (string)($this->values[self::KEY_USER] ?? '');
    }

    public function getPassword(): string
    {
        return (string)($this->values[self::KEY_PASSWORD] ?? '');
    }

    public function getCharset(): string
    {
        return self::DEFAULT_CHARSET;
    }

    public function getPrivateConfigFile(): ?string
    {
        return $this->privateConfigFile;
    }

    public function getDsn(): string
    {
        $host = $this->getHost();
        $port = $this->getPort();
        $db = $this->getName();
        $charset = $this->getCharset();

        $dsn = "mysql:host={$host};";
        if ($port > 0) {
            $dsn .= "port={$port};";
        }
        $dsn .= "dbname={$db};charset={$charset}";

        return $dsn;
    }

    public function getConnectionOptions(): array
    {
        return [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
    }

    /**
     * Creates and returns a PDO connection.
     * Sanitizes errors to ensure no DSN, host, user, password, private path,
     * or original exception is leaked.
     *
     * @param callable|null $pdoFactory Optional PDO factory for testing without real DB
     * @return PDO
     * @throws PDOException
     */
    public function connect(?callable $pdoFactory = null): PDO
    {
        $this->validate();

        $dsn = $this->getDsn();
        $user = $this->getUser();
        $password = $this->getPassword();
        $options = $this->getConnectionOptions();

        try {
            if ($pdoFactory !== null) {
                return $pdoFactory($dsn, $user, $password, $options);
            }
            return new PDO($dsn, $user, $password, $options);
        } catch (\Throwable $e) {
            $sensitiveList = [
                $dsn,
                $this->getHost(),
                $this->getUser(),
                $this->getPassword(),
                $this->getName(),
                (string)$this->getPort(),
            ];
            if ($this->privateConfigFile !== null) {
                $sensitiveList[] = $this->privateConfigFile;
            }

            $sanitized = self::sanitizeErrorMessage($e->getMessage(), $sensitiveList);

            $errorMsg = 'Database connection failed';
            if ($sanitized !== '') {
                $errorMsg .= ': ' . $sanitized;
            }

            // Throw PDOException without exposing original exception ($previous is null)
            throw new PDOException($errorMsg);
        }
    }

    /**
     * Sanitizes an error message by stripping DSNs, host, user, password,
     * file paths, and any provided sensitive strings.
     *
     * @param string $message Raw message
     * @param array $sensitive Explicit sensitive strings to redact
     * @return string Sanitized message
     */
    public static function sanitizeErrorMessage(string $message, array $sensitive = []): string
    {
        $sanitized = $message;

        // Strip DSN patterns
        $sanitized = preg_replace('/mysql:[^\s;,\'"]+/i', 'mysql:[REDACTED]', $sanitized) ?? $sanitized;
        $sanitized = preg_replace('/(mysql:\/\/[^\s@]+@)[^\s\/]+/i', 'mysql://[REDACTED]', $sanitized) ?? $sanitized;

        // Strip explicit sensitive values (host, user, password, db name, port, path)
        foreach ($sensitive as $val) {
            if (is_string($val) && trim($val) !== '') {
                $sanitized = str_ireplace($val, '[REDACTED]', $sanitized);
            }
        }

        // Mask user@host patterns
        $sanitized = preg_replace('/(\'[^\']*\'|\b\w+\b)@(\'[^\']*\'|\b[a-zA-Z0-9.-]+\b)/', "'[REDACTED]'@'[REDACTED]'", $sanitized) ?? $sanitized;

        // Mask password indicators
        $sanitized = preg_replace('/(using password:\s*)(YES|NO)/i', '$1[REDACTED]', $sanitized) ?? $sanitized;
        $sanitized = preg_replace('/(password\s*[:=]\s*)[^\s;,\'"]+/i', '$1[REDACTED]', $sanitized) ?? $sanitized;

        // Mask filesystem paths
        $sanitized = preg_replace('/[a-zA-Z]:\\\\[^\s\'"]+/i', '[REDACTED_PATH]', $sanitized) ?? $sanitized;
        $sanitized = preg_replace('/(?:\/[\w.-]+)+\/[\w.-]+\.php/i', '[REDACTED_PATH]', $sanitized) ?? $sanitized;

        return trim($sanitized);
    }

    /**
     * Sanitized array representation that redacts sensitive credentials.
     */
    public function toArray(): array
    {
        return [
            self::KEY_HOST => $this->getHost(),
            self::KEY_PORT => $this->getPort(),
            self::KEY_NAME => $this->getName(),
            self::KEY_USER => $this->getUser(),
            self::KEY_PASSWORD => '******',
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
        if ($val !== false && (string)$val !== '') {
            return (string)$val;
        }
        return null;
    }

    private static function castValue(string $key, mixed $value): mixed
    {
        if ($key === self::KEY_PORT) {
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

        if ($key === self::KEY_PASSWORD) {
            return (string)$value;
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
            'docs/', './docs/',
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
