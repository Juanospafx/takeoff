<?php
declare(strict_types=1);

/**
 * Test suite for externalized database configuration (TASK-0127).
 *
 * Verifies:
 *  1. Ausencia (Missing config fails closed)
 *  2. Ruta inexistente (Non-existent private config path fails closed)
 *  3. Archivo mal formado y restricciones de ruta (Invalid ext, inside repo, syntax error, non-array)
 *  4. Variables válidas (Env vars, private file, getters, DSN, redaction)
 *  5. Precedencia (Environment variables override private file)
 *  6. Mensajes sanitizados (PDO connection failure sanitization, no DSN/credentials/paths/original exception)
 *
 * Runs without real database connection.
 */

require_once __DIR__ . '/../core/config/DatabaseConfig.php';

final class DatabasePrivateConfigTest
{
    private array $envBackup = [];
    private array $serverBackup = [];
    private array $createdTempFiles = [];
    private int $assertions = 0;
    private int $testsRun = 0;

    public function run(): void
    {
        $this->backupEnvironment();

        try {
            // Group 1: Ausencia
            $this->testAbsenceOfConfigurationFailsClosed();
            $this->testIncompleteConfigurationMissingPassword();
            $this->testIncompleteConfigurationMissingUser();
            $this->testIncompleteConfigurationMissingHost();
            $this->testIncompleteConfigurationMissingDatabase();
            $this->testEmptyStringEnvironmentVariablesTreatedAsMissing();

            // Group 2: Ruta inexistente
            $this->testNonExistentPrivateConfigFileDirectPath();
            $this->testNonExistentPrivateConfigFileViaEnv();
            $this->testEmptyPrivateConfigFilePathThrows();

            // Group 3: Archivo mal formado y restricciones
            $this->testNonPhpFileExtensionThrows();
            $this->testFileInsideRepoRootThrows();
            $this->testFileInsideDocumentRootThrows();
            $this->testDirectoryPathThrows();
            $this->testFileReturningNonArrayThrows();
            $this->testFileThrowingExceptionThrowsSanitized();

            // Group 4: Variables válidas
            $this->testValidConfigurationFromEnvironment();
            $this->testValidConfigurationFromPrivateFile();
            $this->testPortHandlingAndDefault();
            $this->testDsnGeneration();
            $this->testRedactionInToArrayAndDebugInfo();

            // Group 5: Precedencia
            $this->testEnvironmentOverridesPrivateFile();
            $this->testEnvironmentOverridesPort();

            // Group 6: Mensajes sanitizados
            $this->testSanitizeErrorMessageDirect();
            $this->testConnectFailureSanitizesPdoException();
            $this->testConnectionPhpIntegrationWithMockFactory();

            echo "\n✓ All {$this->testsRun} tests passed successfully ({$this->assertions} assertions verified).\n";
        } finally {
            $this->cleanupTempFiles();
            $this->restoreEnvironment();
        }
    }

    private function testAbsenceOfConfigurationFailsClosed(): void
    {
        $this->startTest('Ausencia: falta total de configuracion falla cerrado');
        $this->clearEnvVars();

        $this->assertThrows(
            static fn() => DatabaseConfig::load(),
            InvalidArgumentException::class,
            'TAKEOFF_DB_HOST is required'
        );
    }

    private function testIncompleteConfigurationMissingPassword(): void
    {
        $this->startTest('Ausencia: configuracion incompleta sin password falla cerrado');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_HOST'] = '127.0.0.1';
        $_ENV['TAKEOFF_DB_NAME'] = 'test_db';
        $_ENV['TAKEOFF_DB_USER'] = 'test_user';

        $this->assertThrows(
            static fn() => DatabaseConfig::load(),
            InvalidArgumentException::class,
            'TAKEOFF_DB_PASSWORD is required'
        );
    }

    private function testIncompleteConfigurationMissingUser(): void
    {
        $this->startTest('Ausencia: configuracion incompleta sin user falla cerrado');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_HOST'] = '127.0.0.1';
        $_ENV['TAKEOFF_DB_NAME'] = 'test_db';
        $_ENV['TAKEOFF_DB_PASSWORD'] = 'secret';

        $this->assertThrows(
            static fn() => DatabaseConfig::load(),
            InvalidArgumentException::class,
            'TAKEOFF_DB_USER is required'
        );
    }

    private function testIncompleteConfigurationMissingHost(): void
    {
        $this->startTest('Ausencia: configuracion incompleta sin host falla cerrado');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_NAME'] = 'test_db';
        $_ENV['TAKEOFF_DB_USER'] = 'test_user';
        $_ENV['TAKEOFF_DB_PASSWORD'] = 'secret';

        $this->assertThrows(
            static fn() => DatabaseConfig::load(),
            InvalidArgumentException::class,
            'TAKEOFF_DB_HOST is required'
        );
    }

    private function testIncompleteConfigurationMissingDatabase(): void
    {
        $this->startTest('Ausencia: configuracion incompleta sin db name falla cerrado');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_HOST'] = '127.0.0.1';
        $_ENV['TAKEOFF_DB_USER'] = 'test_user';
        $_ENV['TAKEOFF_DB_PASSWORD'] = 'secret';

        $this->assertThrows(
            static fn() => DatabaseConfig::load(),
            InvalidArgumentException::class,
            'TAKEOFF_DB_NAME is required'
        );
    }

    private function testEmptyStringEnvironmentVariablesTreatedAsMissing(): void
    {
        $this->startTest('Ausencia: variables vacias en entorno son tratadas como faltantes');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_HOST'] = '   ';
        $_ENV['TAKEOFF_DB_NAME'] = 'test_db';
        $_ENV['TAKEOFF_DB_USER'] = 'test_user';
        $_ENV['TAKEOFF_DB_PASSWORD'] = 'secret';

        $this->assertThrows(
            static fn() => DatabaseConfig::load(),
            InvalidArgumentException::class,
            'TAKEOFF_DB_HOST is required'
        );
    }

    private function testNonExistentPrivateConfigFileDirectPath(): void
    {
        $this->startTest('Ruta inexistente: argumento directo con archivo no existente');
        $this->clearEnvVars();
        $fakePath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'non_existent_file_' . uniqid() . '.php';

        $this->assertThrows(
            static fn() => DatabaseConfig::load($fakePath),
            InvalidArgumentException::class,
            'Private configuration file does not exist'
        );
    }

    private function testNonExistentPrivateConfigFileViaEnv(): void
    {
        $this->startTest('Ruta inexistente: TAKEOFF_DB_PRIVATE_CONFIG con archivo no existente');
        $this->clearEnvVars();
        $fakePath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'non_existent_file_' . uniqid() . '.php';
        $_ENV['TAKEOFF_DB_PRIVATE_CONFIG'] = $fakePath;

        $this->assertThrows(
            static fn() => DatabaseConfig::load(),
            InvalidArgumentException::class,
            'Private configuration file does not exist'
        );
    }

    private function testEmptyPrivateConfigFilePathThrows(): void
    {
        $this->startTest('Ruta inexistente: ruta vacia lanza excepcion');
        $this->clearEnvVars();

        $this->assertThrows(
            static fn() => DatabaseConfig::load('   '),
            InvalidArgumentException::class,
            'Private configuration file path cannot be empty'
        );
    }

    private function testNonPhpFileExtensionThrows(): void
    {
        $this->startTest('Archivo mal formado: extension no php es rechazada');
        $this->clearEnvVars();
        $tempJson = $this->createTempFile('.json', json_encode(['host' => '127.0.0.1']));

        $this->assertThrows(
            static fn() => DatabaseConfig::load($tempJson),
            InvalidArgumentException::class,
            'Private configuration file must be a PHP file'
        );
    }

    private function testFileInsideRepoRootThrows(): void
    {
        $this->startTest('Archivo mal formado: archivo dentro del repositorio es rechazado');
        $this->clearEnvVars();
        $internalPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'core' . DIRECTORY_SEPARATOR . 'connection.php';

        $this->assertThrows(
            static fn() => DatabaseConfig::load($internalPath),
            InvalidArgumentException::class,
            'Private configuration file must be located outside repository and document root'
        );
    }

    private function testFileInsideDocumentRootThrows(): void
    {
        $this->startTest('Archivo mal formado: archivo dentro de document root es rechazado');
        $this->clearEnvVars();
        $tempFile = $this->createTempFile('.php', "<?php return [];");
        $docRoot = dirname($tempFile);
        $_SERVER['DOCUMENT_ROOT'] = $docRoot;

        $this->assertThrows(
            static fn() => DatabaseConfig::load($tempFile),
            InvalidArgumentException::class,
            'Private configuration file must be located outside repository and document root'
        );
    }

    private function testDirectoryPathThrows(): void
    {
        $this->startTest('Archivo mal formado: ruta a directorio es rechazada');
        $this->clearEnvVars();
        $tempDir = sys_get_temp_dir();

        $this->assertThrows(
            static fn() => DatabaseConfig::load($tempDir),
            InvalidArgumentException::class,
            'Private configuration file must be a PHP file'
        );
    }

    private function testFileReturningNonArrayThrows(): void
    {
        $this->startTest('Archivo mal formado: archivo que devuelve no-array es rechazado');
        $this->clearEnvVars();
        $tempFile = $this->createTempFile('.php', "<?php return 'invalid_string';");

        $this->assertThrows(
            static fn() => DatabaseConfig::load($tempFile),
            InvalidArgumentException::class,
            'Private configuration file must return a configuration array'
        );
    }

    private function testFileThrowingExceptionThrowsSanitized(): void
    {
        $this->startTest('Archivo mal formado: archivo con error de ejecucion lanza excepcion');
        $this->clearEnvVars();
        $tempFile = $this->createTempFile('.php', "<?php throw new RuntimeException('Syntax or execution fault');");

        $this->assertThrows(
            static fn() => DatabaseConfig::load($tempFile),
            InvalidArgumentException::class,
            'Failed to load private configuration file'
        );
    }

    private function testValidConfigurationFromEnvironment(): void
    {
        $this->startTest('Variables validas: configuracion completa cargada desde entorno');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_HOST'] = '10.0.0.15';
        $_ENV['TAKEOFF_DB_PORT'] = '3307';
        $_ENV['TAKEOFF_DB_NAME'] = 'production_db';
        $_ENV['TAKEOFF_DB_USER'] = 'prod_user';
        $_ENV['TAKEOFF_DB_PASSWORD'] = 'prod_secret_pass';

        $config = DatabaseConfig::load();

        $this->assertSame('10.0.0.15', $config->getHost());
        $this->assertSame(3307, $config->getPort());
        $this->assertSame('production_db', $config->getName());
        $this->assertSame('production_db', $config->getDatabase());
        $this->assertSame('prod_user', $config->getUser());
        $this->assertSame('prod_secret_pass', $config->getPassword());
    }

    private function testValidConfigurationFromPrivateFile(): void
    {
        $this->startTest('Variables validas: configuracion completa cargada desde archivo privado');
        $this->clearEnvVars();
        $tempFile = $this->createTempFile('.php', "<?php return [
            'TAKEOFF_DB_HOST' => 'db.private.net',
            'TAKEOFF_DB_PORT' => 3306,
            'TAKEOFF_DB_NAME' => 'private_takeoff_db',
            'TAKEOFF_DB_USER' => 'private_user',
            'TAKEOFF_DB_PASSWORD' => 'private_pass_123',
        ];");

        $config = DatabaseConfig::load($tempFile);

        $this->assertSame('db.private.net', $config->getHost());
        $this->assertSame(3306, $config->getPort());
        $this->assertSame('private_takeoff_db', $config->getName());
        $this->assertSame('private_user', $config->getUser());
        $this->assertSame('private_pass_123', $config->getPassword());
    }

    private function testPortHandlingAndDefault(): void
    {
        $this->startTest('Variables validas: puerto por defecto (3306) y validacion de rango');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_HOST'] = '127.0.0.1';
        $_ENV['TAKEOFF_DB_NAME'] = 'test_db';
        $_ENV['TAKEOFF_DB_USER'] = 'test_user';
        $_ENV['TAKEOFF_DB_PASSWORD'] = 'pass';

        $config = DatabaseConfig::load();
        $this->assertSame(3306, $config->getPort());

        // Invalid port
        $_ENV['TAKEOFF_DB_PORT'] = '999999';
        $this->assertThrows(
            static fn() => DatabaseConfig::load(),
            InvalidArgumentException::class,
            'must be a valid port number'
        );
    }

    private function testDsnGeneration(): void
    {
        $this->startTest('Variables validas: generacion de DSN con host, port, dbname y charset');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_HOST'] = 'localhost';
        $_ENV['TAKEOFF_DB_PORT'] = '3306';
        $_ENV['TAKEOFF_DB_NAME'] = 'takeoff_test';
        $_ENV['TAKEOFF_DB_USER'] = 'usr';
        $_ENV['TAKEOFF_DB_PASSWORD'] = 'pwd';

        $config = DatabaseConfig::load();
        $dsn = $config->getDsn();

        $this->assertSame('mysql:host=localhost;port=3306;dbname=takeoff_test;charset=utf8mb4', $dsn);
    }

    private function testRedactionInToArrayAndDebugInfo(): void
    {
        $this->startTest('Variables validas: toArray() y __debugInfo() no exponen contrasenas');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_HOST'] = 'localhost';
        $_ENV['TAKEOFF_DB_NAME'] = 'takeoff_test';
        $_ENV['TAKEOFF_DB_USER'] = 'usr';
        $_ENV['TAKEOFF_DB_PASSWORD'] = 'super_secret_credentials_do_not_leak';

        $config = DatabaseConfig::load();
        $arr = $config->toArray();
        $debug = $config->__debugInfo();

        $this->assertNotContains('super_secret_credentials_do_not_leak', json_encode($arr));
        $this->assertNotContains('super_secret_credentials_do_not_leak', json_encode($debug));
        $this->assertSame('******', $arr['TAKEOFF_DB_PASSWORD']);
    }

    private function testEnvironmentOverridesPrivateFile(): void
    {
        $this->startTest('Precedencia: variables de entorno prevalecen sobre archivo privado');
        $this->clearEnvVars();
        $tempFile = $this->createTempFile('.php', "<?php return [
            'TAKEOFF_DB_HOST' => 'file-host.internal',
            'TAKEOFF_DB_PORT' => 3306,
            'TAKEOFF_DB_NAME' => 'file_db',
            'TAKEOFF_DB_USER' => 'file_user',
            'TAKEOFF_DB_PASSWORD' => 'file_password',
        ];");

        // Environment overrides host and user only
        $_ENV['TAKEOFF_DB_HOST'] = 'env-override-host.internal';
        $_ENV['TAKEOFF_DB_USER'] = 'env-override-user';

        $config = DatabaseConfig::load($tempFile);

        $this->assertSame('env-override-host.internal', $config->getHost(), 'Host must come from environment');
        $this->assertSame('env-override-user', $config->getUser(), 'User must come from environment');
        $this->assertSame('file_db', $config->getName(), 'Database must come from private file');
        $this->assertSame('file_password', $config->getPassword(), 'Password must come from private file');
        $this->assertSame(3306, $config->getPort(), 'Port must come from private file');
    }

    private function testEnvironmentOverridesPort(): void
    {
        $this->startTest('Precedencia: TAKEOFF_DB_PORT en entorno sobreescribe el puerto de archivo');
        $this->clearEnvVars();
        $tempFile = $this->createTempFile('.php', "<?php return [
            'TAKEOFF_DB_HOST' => 'db.internal',
            'TAKEOFF_DB_PORT' => 3306,
            'TAKEOFF_DB_NAME' => 'db',
            'TAKEOFF_DB_USER' => 'usr',
            'TAKEOFF_DB_PASSWORD' => 'pwd',
        ];");

        $_ENV['TAKEOFF_DB_PORT'] = '3308';
        $config = DatabaseConfig::load($tempFile);

        $this->assertSame(3308, $config->getPort());
    }

    private function testSanitizeErrorMessageDirect(): void
    {
        $this->startTest('Mensajes sanitizados: sanitizeErrorMessage redacta DSN, credenciales y rutas');
        $rawMessage = "Failed connecting to mysql:host=db.internal;dbname=testdb;charset=utf8mb4 with user 'db_admin'@'db.internal' (using password: YES) file C:\\secret\\path\\database.private.php";
        $sensitive = ['db_admin', 'db.internal', 'testdb', 'C:\\secret\\path\\database.private.php'];

        $sanitized = DatabaseConfig::sanitizeErrorMessage($rawMessage, $sensitive);

        $this->assertNotContains('db.internal', $sanitized);
        $this->assertNotContains('db_admin', $sanitized);
        $this->assertNotContains('testdb', $sanitized);
        $this->assertNotContains('C:\\secret\\path\\database.private.php', $sanitized);
        $this->assertNotContains('mysql:host=db.internal;dbname=testdb;charset=utf8mb4', $sanitized);
        $this->assertNotContains('password: YES', $sanitized);
    }

    private function testConnectFailureSanitizesPdoException(): void
    {
        $this->startTest('Mensajes sanitizados: connect() falla sin exponer DSN, host, usuario, password ni ruta ni excepcion original');
        $this->clearEnvVars();
        $secretHost = 'sensitive-db-host.internal';
        $secretUser = 'sensitive-app-user';
        $secretPass = 'ultra_secret_production_password_xyz!';
        $secretDb   = 'sensitive_prod_takeoff_db';

        $tempFile = $this->createTempFile('.php', "<?php return [
            'TAKEOFF_DB_HOST' => '{$secretHost}',
            'TAKEOFF_DB_PORT' => 3306,
            'TAKEOFF_DB_NAME' => '{$secretDb}',
            'TAKEOFF_DB_USER' => '{$secretUser}',
            'TAKEOFF_DB_PASSWORD' => '{$secretPass}',
        ];");

        $config = DatabaseConfig::load($tempFile);

        // Mock factory simulating a PDO connection failure that includes raw DSN and credentials
        $mockFailingFactory = static function (string $dsn, string $user, string $pass) use ($tempFile) {
            $msg = "SQLSTATE[HY000] [1045] Access denied for user '{$user}'@'{$dsn}' using password {$pass} at {$tempFile}";
            throw new PDOException($msg, 1045);
        };

        try {
            $config->connect($mockFailingFactory);
            $this->fail('Expected PDOException was not thrown');
        } catch (PDOException $e) {
            $message = $e->getMessage();

            // Verify NO sensitive information is leaked
            $this->assertNotContains($secretHost, $message, 'Host must not appear in exception');
            $this->assertNotContains($secretUser, $message, 'User must not appear in exception');
            $this->assertNotContains($secretPass, $message, 'Password must not appear in exception');
            $this->assertNotContains($secretDb, $message, 'DB name must not appear in exception');
            $this->assertNotContains($tempFile, $message, 'Private config path must not appear in exception');
            $this->assertNotContains($config->getDsn(), $message, 'DSN must not appear in exception');

            // Verify original exception is NOT chained
            $this->assertNull($e->getPrevious(), 'Original exception must NOT be attached to prevent leak via getPrevious()');
        }
    }

    private function testConnectionPhpIntegrationWithMockFactory(): void
    {
        $this->startTest('Mensajes sanitizados: integracion connection.php usando factory de prueba');
        $this->clearEnvVars();
        $_ENV['TAKEOFF_DB_HOST'] = '127.0.0.1';
        $_ENV['TAKEOFF_DB_PORT'] = '3306';
        $_ENV['TAKEOFF_DB_NAME'] = 'test_db';
        $_ENV['TAKEOFF_DB_USER'] = 'test_user';
        $_ENV['TAKEOFF_DB_PASSWORD'] = 'test_password';

        // 1. Success case using mock factory returning dummy PDO-like object
        $mockPdo = new class extends PDO {
            public function __construct() {}
        };

        $GLOBALS['__TAKEOFF_PDO_FACTORY__'] = static function () use ($mockPdo) {
            return $mockPdo;
        };

        require dirname(__DIR__) . '/core/db/connection.php';
        $this->assertSame($mockPdo, $pdo, 'connection.php must expose $pdo instance from factory');

        // 2. Failure case using mock factory
        $GLOBALS['__TAKEOFF_PDO_FACTORY__'] = static function () {
            throw new PDOException("SQLSTATE[HY000] [2002] Connection refused to 127.0.0.1:3306 for user test_user password test_password");
        };

        try {
            // Re-evaluating connection logic
            $cfg = DatabaseConfig::load();
            $cfg->connect($GLOBALS['__TAKEOFF_PDO_FACTORY__']);
            $this->fail('Expected sanitized PDOException was not thrown');
        } catch (PDOException $e) {
            $msg = $e->getMessage();
            $this->assertNotContains('test_password', $msg);
            $this->assertNotContains('test_user', $msg);
            $this->assertNull($e->getPrevious());
        } finally {
            unset($GLOBALS['__TAKEOFF_PDO_FACTORY__']);
        }
    }

    // --- Helper Methods ---

    private function startTest(string $description): void
    {
        $this->testsRun++;
        echo "  [TEST {$this->testsRun}] {$description} ... ";
    }

    private function pass(): void
    {
        echo "OK\n";
    }

    private function fail(string $message): void
    {
        echo "FAILED\n";
        throw new RuntimeException("Test failure: {$message}");
    }

    private function assertSame(mixed $expected, mixed $actual, string $message = ''): void
    {
        $this->assertions++;
        if ($expected !== $actual) {
            $msg = $message !== '' ? $message . ' - ' : '';
            $this->fail("{$msg}Expected " . var_export($expected, true) . ", got " . var_export($actual, true));
        }
        $this->pass();
    }

    private function assertNull(mixed $actual, string $message = ''): void
    {
        $this->assertions++;
        if ($actual !== null) {
            $msg = $message !== '' ? $message . ' - ' : '';
            $this->fail("{$msg}Expected null, got " . var_export($actual, true));
        }
        $this->pass();
    }

    private function assertNotContains(string $needle, string $haystack, string $message = ''): void
    {
        $this->assertions++;
        if (str_contains($haystack, $needle)) {
            $msg = $message !== '' ? $message . ' - ' : '';
            $this->fail("{$msg}Found sensitive string '{$needle}' in sanitized text: '{$haystack}'");
        }
        $this->pass();
    }

    private function assertThrows(callable $callable, string $expectedExceptionClass, string $expectedMessageSubstring = ''): void
    {
        $this->assertions++;
        try {
            $callable();
            $this->fail("Expected exception {$expectedExceptionClass} was not thrown");
        } catch (Throwable $e) {
            if (!($e instanceof $expectedExceptionClass)) {
                $actualClass = get_class($e);
                $this->fail("Expected exception {$expectedExceptionClass}, got {$actualClass}: " . $e->getMessage());
            }

            if ($expectedMessageSubstring !== '' && !str_contains($e->getMessage(), $expectedMessageSubstring)) {
                $this->fail("Exception message '{$e->getMessage()}' does not contain '{$expectedMessageSubstring}'");
            }

            $this->pass();
        }
    }

    private function backupEnvironment(): void
    {
        $this->envBackup = $_ENV;
        $this->serverBackup = $_SERVER;
    }

    private function restoreEnvironment(): void
    {
        $this->clearEnvVars();
        $_ENV = $this->envBackup;
        $_SERVER = $this->serverBackup;
    }

    private function clearEnvVars(): void
    {
        $keys = [
            DatabaseConfig::KEY_HOST,
            DatabaseConfig::KEY_PORT,
            DatabaseConfig::KEY_NAME,
            DatabaseConfig::KEY_USER,
            DatabaseConfig::KEY_PASSWORD,
            DatabaseConfig::KEY_PRIVATE_CONFIG,
            'DB_HOST',
            'DB_PORT',
            'DB_NAME',
            'DB_USER',
            'DB_PASSWORD',
        ];

        foreach ($keys as $key) {
            unset($_ENV[$key], $_SERVER[$key]);
            putenv($key);
        }

        unset($_SERVER['DOCUMENT_ROOT']);
    }

    private function createTempFile(string $extension, string $content): string
    {
        $tempPath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'takeoff_test_' . uniqid('', true) . $extension;
        file_put_contents($tempPath, $content);
        $this->createdTempFiles[] = $tempPath;
        return $tempPath;
    }

    private function cleanupTempFiles(): void
    {
        foreach ($this->createdTempFiles as $file) {
            if (file_exists($file)) {
                @unlink($file);
            }
        }
        $this->createdTempFiles = [];
    }
}

// Execute test suite when run directly
$suite = new DatabasePrivateConfigTest();
$suite->run();
