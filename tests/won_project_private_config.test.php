<?php
declare(strict_types=1);

/**
 * Behavioral & Security Tests: WonProject Private Configuration Loader (TASK-0106)
 *
 * Verifies:
 *   - Six supported configuration variables:
 *       1. WON_PROJECT_EXPORT_ENABLED (bool, default false)
 *       2. WON_PROJECT_HMAC_ACTIVE_KEY_ID (string, default '')
 *       3. WON_PROJECT_HMAC_ACTIVE_SECRET (string, default '')
 *       4. ELECTROPLAN_WON_PROJECT_ENDPOINT (string, default '')
 *       5. WON_PROJECT_REQUEST_TIMEOUT_SECONDS (int, default 30)
 *       6. WON_PROJECT_PRIVATE_CONFIG (string, optional path to outside PHP file)
 *   - Strict precedence order:
 *       Environment variables ($_ENV, $_SERVER, getenv) > Private config file > Safe defaults
 *   - Safe default state when unconfigured (export disabled, timeout 30s)
 *   - Private file loading and hardening:
 *       * Requires .php extension (rejects .json, .ini, .txt, etc.)
 *       * Rejects paths inside repository or document root
 *       * Rejects empty path
 *       * Fails closed on absent file
 *       * Rejects non-regular files / directories
 *       * Fails closed when file does not return an array
 *       * Fails closed on syntax errors / include throwables without leaking details
 *   - Validation invariants when export is enabled:
 *       * Strict HTTPS scheme enforcement (rejects HTTP, invalid hosts, credentials)
 *       * Positive integer timeout enforcement (> 0)
 *       * Non-empty HMAC key ID and secret
 *   - Information disclosure prevention:
 *       * toArray() strictly omits secret and private file path
 *       * __debugInfo() strictly omits secret and private file path
 *       * Exception messages never leak secret material or private file paths
 *   - Safe execution:
 *       * All temporary files created outside repository in system temp dir
 *       * Only fictitious/dummy credentials and endpoints used
 */

require_once __DIR__ . '/../core/config/WonProjectIntegrationConfig.php';

final class WonProjectPrivateConfigTestRunner
{
    private array $results = [];
    private array $createdTempFiles = [];
    private array $savedEnv = [];
    private array $savedServer = [];

    private const CONFIG_VARS = [
        WonProjectIntegrationConfig::KEY_EXPORT_ENABLED,
        WonProjectIntegrationConfig::KEY_HMAC_KEY_ID,
        WonProjectIntegrationConfig::KEY_HMAC_SECRET,
        WonProjectIntegrationConfig::KEY_ENDPOINT,
        WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS,
        WonProjectIntegrationConfig::KEY_PRIVATE_CONFIG,
    ];

    public function run(): int
    {
        echo "======================================================================\n";
        echo "TEST SUITE: WonProject Private Configuration Loader (TASK-0106)\n";
        echo "======================================================================\n\n";

        $tests = [
            'testSixVariablesDeclaredAndRecognized' => 'Variables: declara y reconoce las 6 variables aprobadas y soportadas',
            'testSafeDefaultsWhenNoConfigProvided' => 'Defaults: valores seguros por defecto (export disabled, timeout 30, strings vacíos)',
            'testLoadFromValidPrivatePhpConfigFile' => 'Loader: carga exitosamente archivo PHP privado válido fuera del repo',
            'testLoadFromPrivateConfigViaEnvironmentVariable' => 'Loader: resolución automática vía variable de entorno WON_PROJECT_PRIVATE_CONFIG',
            'testEnvironmentPrecedenceOverFileAndDefaults' => 'Precedencia: entorno sobrescribe archivo y archivo sobrescribe defaults',
            'testMissingPrivateConfigFileThrowsAndDoesNotLeakPath' => 'Resiliencia: archivo inexistente lanza excepción sin exponer la ruta privada',
            'testInvalidFileExtensionNonPhpThrowsAndDoesNotLeak' => 'Seguridad: archivo con extensión no PHP (.json/.ini) es rechazado sin exponer ruta',
            'testEmptyPrivateConfigPathThrows' => 'Validación: ruta vacía o de sólo espacios lanza InvalidArgumentException',
            'testPrivateConfigFileInsideRepoThrowsAndDoesNotLeakPath' => 'Seguridad: rechaza rutas dentro del repositorio sin filtrar detalles de ruta',
            'testPrivateConfigFileReturningNonArrayThrows' => 'Validación: archivo privado que retorna tipo no-array (string/int/null/bool) es rechazado',
            'testPrivateConfigFileWithSyntaxErrorThrowsAndDoesNotLeak' => 'Resiliencia: error de inclusión o sintaxis lanza InvalidArgumentException sin filtrar secretos',
            'testHttpsEndpointValidationWhenExportEnabled' => 'Validación HTTPS: endpoint seguro requerido cuando export está habilitado (rechaza HTTP, credenciales)',
            'testTimeoutSecondsValidation' => 'Validación timeout: requiere entero positivo cuando export está habilitado (rechaza 0 y negativos)',
            'testHmacKeyAndSecretValidationWhenExportEnabled' => 'Validación credenciales: HMAC key y secret obligatorios no vacíos al activar export',
            'testTypeCastingOfExportEnabledAndTimeout' => 'Casting: parseo robusto de booleanos ("true", "1", "0") y enteros numéricos',
            'testToArrayAndDebugInfoNeverExposeSecretNorPrivatePath' => 'Confidencialidad: toArray() y __debugInfo() omiten secret y ruta privada',
            'testExceptionMessagesNeverContainSecretNorPrivatePath' => 'Confidencialidad: mensajes de excepción nunca contienen secreto ficticio ni ruta privada',
        ];

        foreach ($tests as $method => $description) {
            $this->runTest($method, $description);
        }

        return $this->printSummary();
    }

    private function runTest(string $method, string $description): void
    {
        $this->setUp();
        try {
            $this->$method();
            $this->results[] = [
                'name' => $method,
                'description' => $description,
                'status' => 'PASS',
                'message' => 'Passed',
            ];
            echo "  [PASS] {$description}\n";
        } catch (\Throwable $e) {
            $this->results[] = [
                'name' => $method,
                'description' => $description,
                'status' => 'FAIL',
                'message' => $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine(),
            ];
            echo "  [FAIL] {$description}\n";
            echo "        Error: {$e->getMessage()}\n";
        } finally {
            $this->tearDown();
        }
    }

    private function setUp(): void
    {
        $this->savedEnv = [];
        $this->savedServer = [];

        foreach (self::CONFIG_VARS as $var) {
            if (array_key_exists($var, $_ENV)) {
                $this->savedEnv[$var] = $_ENV[$var];
            }
            if (array_key_exists($var, $_SERVER)) {
                $this->savedServer[$var] = $_SERVER[$var];
            }

            unset($_ENV[$var], $_SERVER[$var]);
            putenv($var);
        }
    }

    private function tearDown(): void
    {
        // Limpiar variables de prueba
        foreach (self::CONFIG_VARS as $var) {
            unset($_ENV[$var], $_SERVER[$var]);
            putenv($var);
        }

        // Restaurar estado previo
        foreach ($this->savedEnv as $var => $val) {
            $_ENV[$var] = $val;
            putenv("{$var}={$val}");
        }
        foreach ($this->savedServer as $var => $val) {
            $_SERVER[$var] = $val;
        }

        // Limpiar archivos temporales fuera del repositorio
        foreach ($this->createdTempFiles as $file) {
            if (is_file($file)) {
                @unlink($file);
            }
        }
        $this->createdTempFiles = [];
    }

    private function createTempConfigFile(string $content, string $extension = 'php'): string
    {
        $tempDir = sys_get_temp_dir();
        $randomName = 'won_test_cfg_' . bin2hex(random_bytes(8)) . '.' . ltrim($extension, '.');
        $filePath = $tempDir . DIRECTORY_SEPARATOR . $randomName;

        $written = file_put_contents($filePath, $content);
        if ($written === false) {
            throw new \RuntimeException("Failed to create temporary test file at {$filePath}");
        }

        $this->createdTempFiles[] = $filePath;
        return $filePath;
    }

    private function setEnvVar(string $key, string $value): void
    {
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
        putenv("{$key}={$value}");
    }

    // -------------------------------------------------------------------------
    // Test Methods
    // -------------------------------------------------------------------------

    public function testSixVariablesDeclaredAndRecognized(): void
    {
        $expectedVars = [
            'WON_PROJECT_EXPORT_ENABLED',
            'WON_PROJECT_HMAC_ACTIVE_KEY_ID',
            'WON_PROJECT_HMAC_ACTIVE_SECRET',
            'ELECTROPLAN_WON_PROJECT_ENDPOINT',
            'WON_PROJECT_REQUEST_TIMEOUT_SECONDS',
            'WON_PROJECT_PRIVATE_CONFIG',
        ];

        $this->assertEquals(6, count(WonProjectIntegrationConfig::SUPPORTED_VARIABLES), 'Debe tener exactamente 6 variables soportadas');

        foreach ($expectedVars as $expectedVar) {
            $this->assertTrue(
                in_array($expectedVar, WonProjectIntegrationConfig::SUPPORTED_VARIABLES, true),
                "Variable {$expectedVar} debe estar presente en SUPPORTED_VARIABLES"
            );
        }

        // 5 variables operativas aprobadas (excluyendo la ruta del cargador privado)
        $this->assertEquals(5, count(WonProjectIntegrationConfig::APPROVED_VARIABLES), 'APPROVED_VARIABLES debe tener 5 variables');
        $this->assertFalse(
            in_array(WonProjectIntegrationConfig::KEY_PRIVATE_CONFIG, WonProjectIntegrationConfig::APPROVED_VARIABLES, true),
            'WON_PROJECT_PRIVATE_CONFIG no debe estar en APPROVED_VARIABLES para evitar fuga en overrides internos'
        );
    }

    public function testSafeDefaultsWhenNoConfigProvided(): void
    {
        $config = WonProjectIntegrationConfig::load();

        $this->assertFalse($config->isExportEnabled(), 'Por defecto export debe estar desactivado');
        $this->assertEquals('', $config->getHmacKeyId(), 'Key ID por defecto debe ser string vacío');
        $this->assertEquals('', $config->getHmacSecret(), 'Secret por defecto debe ser string vacío');
        $this->assertEquals('', $config->getEndpoint(), 'Endpoint por defecto debe ser string vacío');
        $this->assertEquals(30, $config->getTimeoutSeconds(), 'Timeout por defecto debe ser 30 segundos');
    }

    public function testLoadFromValidPrivatePhpConfigFile(): void
    {
        $dummyKey = 'dummy-key-takeoff-001';
        $dummySecret = 'fictitious-secret-takeoff-alpha-999';
        $dummyEndpoint = 'https://takeoff.test-endpoint.local/api/v1/won';

        $fileContent = "<?php\nreturn [\n"
            . "    'WON_PROJECT_EXPORT_ENABLED' => true,\n"
            . "    'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => '{$dummyKey}',\n"
            . "    'WON_PROJECT_HMAC_ACTIVE_SECRET' => '{$dummySecret}',\n"
            . "    'ELECTROPLAN_WON_PROJECT_ENDPOINT' => '{$dummyEndpoint}',\n"
            . "    'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 45,\n"
            . "];\n";

        $tempFile = $this->createTempConfigFile($fileContent, 'php');

        $config = WonProjectIntegrationConfig::load($tempFile);

        $this->assertTrue($config->isExportEnabled(), 'Export debe estar activado desde archivo privado');
        $this->assertEquals($dummyKey, $config->getHmacKeyId(), 'Key ID cargado debe coincidir');
        $this->assertEquals($dummySecret, $config->getHmacSecret(), 'Secret cargado debe coincidir');
        $this->assertEquals($dummyEndpoint, $config->getEndpoint(), 'Endpoint cargado debe coincidir');
        $this->assertEquals(45, $config->getTimeoutSeconds(), 'Timeout de 45 segundos debe coincidir');
    }

    public function testLoadFromPrivateConfigViaEnvironmentVariable(): void
    {
        $dummyKey = 'dummy-env-loader-key';
        $dummySecret = 'fictitious-env-loader-secret';
        $dummyEndpoint = 'https://env-takeoff.example.com/v1/won';

        $fileContent = "<?php\nreturn [\n"
            . "    'WON_PROJECT_EXPORT_ENABLED' => true,\n"
            . "    'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => '{$dummyKey}',\n"
            . "    'WON_PROJECT_HMAC_ACTIVE_SECRET' => '{$dummySecret}',\n"
            . "    'ELECTROPLAN_WON_PROJECT_ENDPOINT' => '{$dummyEndpoint}',\n"
            . "    'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 15,\n"
            . "];\n";

        $tempFile = $this->createTempConfigFile($fileContent, 'php');
        $this->setEnvVar(WonProjectIntegrationConfig::KEY_PRIVATE_CONFIG, $tempFile);

        $config = WonProjectIntegrationConfig::load(null);

        $this->assertTrue($config->isExportEnabled(), 'Debe cargar configuración indicada en variable de entorno');
        $this->assertEquals($dummyKey, $config->getHmacKeyId(), 'Key ID debe coincidir');
        $this->assertEquals($dummySecret, $config->getHmacSecret(), 'Secret debe coincidir');
        $this->assertEquals($dummyEndpoint, $config->getEndpoint(), 'Endpoint debe coincidir');
        $this->assertEquals(15, $config->getTimeoutSeconds(), 'Timeout debe ser 15');
    }

    public function testEnvironmentPrecedenceOverFileAndDefaults(): void
    {
        $fileKey = 'dummy-file-key';
        $fileSecret = 'fictitious-file-secret';
        $fileEndpoint = 'https://file.example.test/v1/won';

        $fileContent = "<?php\nreturn [\n"
            . "    'WON_PROJECT_EXPORT_ENABLED' => true,\n"
            . "    'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => '{$fileKey}',\n"
            . "    'WON_PROJECT_HMAC_ACTIVE_SECRET' => '{$fileSecret}',\n"
            . "    'ELECTROPLAN_WON_PROJECT_ENDPOINT' => '{$fileEndpoint}',\n"
            . "    'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 50,\n"
            . "];\n";

        $tempFile = $this->createTempConfigFile($fileContent, 'php');

        // Entorno sobrescribe parcialmente: cambia Key ID y Timeout, preserva Secret y Endpoint del archivo
        $envKey = 'override-env-key-id';
        $this->setEnvVar(WonProjectIntegrationConfig::KEY_HMAC_KEY_ID, $envKey);
        $this->setEnvVar(WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS, '22');

        $config = WonProjectIntegrationConfig::load($tempFile);

        $this->assertEquals($envKey, $config->getHmacKeyId(), 'Entorno debe tener precedencia sobre archivo en Key ID');
        $this->assertEquals(22, $config->getTimeoutSeconds(), 'Entorno debe tener precedencia sobre archivo en Timeout');
        $this->assertEquals($fileSecret, $config->getHmacSecret(), 'Secret debe mantenerse desde archivo cuando entorno no lo define');
        $this->assertEquals($fileEndpoint, $config->getEndpoint(), 'Endpoint debe mantenerse desde archivo');
    }

    public function testMissingPrivateConfigFileThrowsAndDoesNotLeakPath(): void
    {
        $fakeNonExistentPath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'missing_takeoff_' . bin2hex(random_bytes(6)) . '.php';

        $caught = false;
        try {
            WonProjectIntegrationConfig::load($fakeNonExistentPath);
        } catch (\InvalidArgumentException $e) {
            $caught = true;
            $msg = $e->getMessage();
            $this->assertEquals('Private configuration file does not exist', $msg, 'Mensaje exacto para archivo ausente');
            $this->assertFalse(str_contains($msg, $fakeNonExistentPath), 'El mensaje de error no debe contener la ruta');
        }

        $this->assertTrue($caught, 'Debe lanzar InvalidArgumentException cuando el archivo no existe');
    }

    public function testInvalidFileExtensionNonPhpThrowsAndDoesNotLeak(): void
    {
        $tempJson = $this->createTempConfigFile('{"WON_PROJECT_EXPORT_ENABLED": false}', 'json');

        $caught = false;
        try {
            WonProjectIntegrationConfig::load($tempJson);
        } catch (\InvalidArgumentException $e) {
            $caught = true;
            $msg = $e->getMessage();
            $this->assertEquals('Private configuration file must be a PHP file', $msg, 'Mensaje exacto para extensión no-php');
            $this->assertFalse(str_contains($msg, $tempJson), 'El mensaje de error no debe contener la ruta');
        }

        $this->assertTrue($caught, 'Debe rechazar archivos que no tengan extensión .php');
    }

    public function testEmptyPrivateConfigPathThrows(): void
    {
        $caughtExplicit = false;
        try {
            WonProjectIntegrationConfig::load('   ');
        } catch (\InvalidArgumentException $e) {
            $caughtExplicit = true;
            $this->assertEquals('Private configuration file path cannot be empty', $e->getMessage(), 'Mensaje exacto ruta vacía');
        }
        $this->assertTrue($caughtExplicit, 'Ruta explícita vacía debe lanzar excepción');

        $caughtEnv = false;
        $this->setEnvVar(WonProjectIntegrationConfig::KEY_PRIVATE_CONFIG, '   ');
        try {
            WonProjectIntegrationConfig::load(null);
        } catch (\InvalidArgumentException $e) {
            $caughtEnv = true;
            $this->assertEquals('Private configuration file path cannot be empty', $e->getMessage(), 'Mensaje exacto variable entorno vacía');
        }
        $this->assertTrue($caughtEnv, 'Variable WON_PROJECT_PRIVATE_CONFIG vacía debe lanzar excepción');
    }

    public function testPrivateConfigFileInsideRepoThrowsAndDoesNotLeakPath(): void
    {
        $forbiddenRelativePaths = [
            'core/config/dummy_private.php',
            './core/dummy_private.php',
            'tests/dummy_private.php',
            'api/dummy_private.php',
        ];

        foreach ($forbiddenRelativePaths as $internalPath) {
            $caught = false;
            try {
                WonProjectIntegrationConfig::load($internalPath);
            } catch (\InvalidArgumentException $e) {
                $caught = true;
                $msg = $e->getMessage();
                $this->assertEquals(
                    'Private configuration file must be located outside repository and document root',
                    $msg,
                    "Debe rechazar ruta interna: {$internalPath}"
                );
                $this->assertFalse(str_contains($msg, $internalPath), 'No debe filtrar la ruta interna');
            }
            $this->assertTrue($caught, "Ruta interna {$internalPath} debe ser rechazada");
        }
    }

    public function testPrivateConfigFileReturningNonArrayThrows(): void
    {
        $nonArrayCases = [
            "'solo un string'",
            "12345",
            "false",
            "null",
        ];

        foreach ($nonArrayCases as $caseContent) {
            $tempFile = $this->createTempConfigFile("<?php\nreturn {$caseContent};\n", 'php');

            $caught = false;
            try {
                WonProjectIntegrationConfig::load($tempFile);
            } catch (\InvalidArgumentException $e) {
                $caught = true;
                $msg = $e->getMessage();
                $this->assertEquals('Private configuration file must return a configuration array', $msg, 'Mensaje exacto para no-array');
                $this->assertFalse(str_contains($msg, $tempFile), 'No debe filtrar la ruta');
            }
            $this->assertTrue($caught, "Retorno {$caseContent} debe lanzar InvalidArgumentException");
        }
    }

    public function testPrivateConfigFileWithSyntaxErrorThrowsAndDoesNotLeak(): void
    {
        $fictitiousSecretLeak = 'secret_should_not_leak_via_exception_123';
        $badContent = "<?php\nthrow new \\RuntimeException('{$fictitiousSecretLeak}');\n";
        $tempFile = $this->createTempConfigFile($badContent, 'php');

        $caught = false;
        try {
            WonProjectIntegrationConfig::load($tempFile);
        } catch (\InvalidArgumentException $e) {
            $caught = true;
            $msg = $e->getMessage();
            $this->assertEquals('Failed to load private configuration file', $msg, 'Mensaje seguro para fallas al incluir archivo');
            $this->assertFalse(str_contains($msg, $fictitiousSecretLeak), 'El mensaje no debe contener el contenido del error interno');
            $this->assertFalse(str_contains($msg, $tempFile), 'El mensaje no debe contener la ruta');
        }

        $this->assertTrue($caught, 'Debe capturar errores de ejecución/inclusión del archivo privado');
    }

    public function testHttpsEndpointValidationWhenExportEnabled(): void
    {
        $validSecret = 'fictitious-valid-secret';
        $validKey = 'dummy-key-01';

        // 1. Export desactivado con endpoint inseguro: no falla (modo pasivo seguro)
        $disabledConfig = new WonProjectIntegrationConfig([
            WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => false,
            WonProjectIntegrationConfig::KEY_ENDPOINT => 'http://insecure.test/api',
        ]);
        $disabledConfig->validate();
        $this->assertFalse($disabledConfig->isExportEnabled(), 'Export desactivado no valida endpoint obligatorio');

        // 2. Export activado con HTTP inseguro: debe ser rechazado
        $caughtHttp = false;
        try {
            $insecureConfig = new WonProjectIntegrationConfig([
                WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
                WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => $validKey,
                WonProjectIntegrationConfig::KEY_HMAC_SECRET => $validSecret,
                WonProjectIntegrationConfig::KEY_ENDPOINT => 'http://insecure.example.com/api',
                WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 30,
            ]);
            $insecureConfig->validate();
        } catch (\InvalidArgumentException $e) {
            $caughtHttp = true;
            $this->assertTrue(str_contains($e->getMessage(), 'HTTPS scheme'), 'Debe rechazar esquema HTTP inseguro');
        }
        $this->assertTrue($caughtHttp, 'HTTP inseguro debe lanzar InvalidArgumentException');

        // 3. Export activado con endpoint vacío: debe ser rechazado
        $caughtEmpty = false;
        try {
            $emptyEndpointConfig = new WonProjectIntegrationConfig([
                WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
                WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => $validKey,
                WonProjectIntegrationConfig::KEY_HMAC_SECRET => $validSecret,
                WonProjectIntegrationConfig::KEY_ENDPOINT => '',
                WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 30,
            ]);
            $emptyEndpointConfig->validate();
        } catch (\InvalidArgumentException $e) {
            $caughtEmpty = true;
            $this->assertTrue(str_contains($e->getMessage(), 'required when WonProject export is enabled'), 'Endpoint vacío debe ser rechazado');
        }
        $this->assertTrue($caughtEmpty, 'Endpoint vacío debe lanzar excepción');

        // 4. Export activado con credenciales en la URL: debe ser rechazado
        $caughtCreds = false;
        try {
            $credsConfig = new WonProjectIntegrationConfig([
                WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
                WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => $validKey,
                WonProjectIntegrationConfig::KEY_HMAC_SECRET => $validSecret,
                WonProjectIntegrationConfig::KEY_ENDPOINT => 'https://user:pass@api.example.com/api',
                WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 30,
            ]);
            $credsConfig->validate();
        } catch (\InvalidArgumentException $e) {
            $caughtCreds = true;
            $this->assertTrue(str_contains($e->getMessage(), 'must not contain URL credentials'), 'Debe rechazar credenciales en URL');
        }
        $this->assertTrue($caughtCreds, 'URL con credenciales embebidas debe ser rechazada');

        // 5. Export activado con HTTPS válido: pasa validación
        $validConfig = new WonProjectIntegrationConfig([
            WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
            WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => $validKey,
            WonProjectIntegrationConfig::KEY_HMAC_SECRET => $validSecret,
            WonProjectIntegrationConfig::KEY_ENDPOINT => 'https://api.example.com/api/v1/won',
            WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 30,
        ]);
        $validConfig->validate();
        $this->assertTrue($validConfig->isExportEnabled(), 'HTTPS válido se valida correctamente');
    }

    public function testTimeoutSecondsValidation(): void
    {
        $validSecret = 'fictitious-valid-secret';
        $validKey = 'dummy-key-01';
        $validEndpoint = 'https://api.example.com/api';

        // 1. Timeout cero: rechazado
        $caughtZero = false;
        try {
            $cfg = new WonProjectIntegrationConfig([
                WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
                WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => $validKey,
                WonProjectIntegrationConfig::KEY_HMAC_SECRET => $validSecret,
                WonProjectIntegrationConfig::KEY_ENDPOINT => $validEndpoint,
                WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 0,
            ]);
            $cfg->validate();
        } catch (\InvalidArgumentException $e) {
            $caughtZero = true;
            $this->assertEquals('WON_PROJECT_REQUEST_TIMEOUT_SECONDS must be a positive integer', $e->getMessage());
        }
        $this->assertTrue($caughtZero, 'Timeout 0 debe ser rechazado');

        // 2. Timeout negativo: rechazado
        $caughtNeg = false;
        try {
            $cfg = new WonProjectIntegrationConfig([
                WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
                WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => $validKey,
                WonProjectIntegrationConfig::KEY_HMAC_SECRET => $validSecret,
                WonProjectIntegrationConfig::KEY_ENDPOINT => $validEndpoint,
                WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => -15,
            ]);
            $cfg->validate();
        } catch (\InvalidArgumentException $e) {
            $caughtNeg = true;
            $this->assertEquals('WON_PROJECT_REQUEST_TIMEOUT_SECONDS must be a positive integer', $e->getMessage());
        }
        $this->assertTrue($caughtNeg, 'Timeout negativo debe ser rechazado');

        // 3. Timeout positivo válido: aceptado
        $validCfg = new WonProjectIntegrationConfig([
            WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
            WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => $validKey,
            WonProjectIntegrationConfig::KEY_HMAC_SECRET => $validSecret,
            WonProjectIntegrationConfig::KEY_ENDPOINT => $validEndpoint,
            WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 45,
        ]);
        $validCfg->validate();
        $this->assertEquals(45, $validCfg->getTimeoutSeconds());
    }

    public function testHmacKeyAndSecretValidationWhenExportEnabled(): void
    {
        $validEndpoint = 'https://api.example.com/api';

        // 1. Key ID ausente o vacío
        $caughtKey = false;
        try {
            $cfg = new WonProjectIntegrationConfig([
                WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
                WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => '   ',
                WonProjectIntegrationConfig::KEY_HMAC_SECRET => 'secret-test',
                WonProjectIntegrationConfig::KEY_ENDPOINT => $validEndpoint,
                WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 30,
            ]);
            $cfg->validate();
        } catch (\InvalidArgumentException $e) {
            $caughtKey = true;
            $this->assertEquals('WON_PROJECT_HMAC_ACTIVE_KEY_ID is required when WonProject export is enabled', $e->getMessage());
        }
        $this->assertTrue($caughtKey, 'Key ID vacío debe ser rechazado al habilitar export');

        // 2. Secret ausente o vacío
        $caughtSecret = false;
        try {
            $cfg = new WonProjectIntegrationConfig([
                WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
                WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => 'key-test',
                WonProjectIntegrationConfig::KEY_HMAC_SECRET => '   ',
                WonProjectIntegrationConfig::KEY_ENDPOINT => $validEndpoint,
                WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 30,
            ]);
            $cfg->validate();
        } catch (\InvalidArgumentException $e) {
            $caughtSecret = true;
            $this->assertEquals('WON_PROJECT_HMAC_ACTIVE_SECRET is required when WonProject export is enabled', $e->getMessage());
        }
        $this->assertTrue($caughtSecret, 'Secret vacío debe ser rechazado al habilitar export');
    }

    public function testTypeCastingOfExportEnabledAndTimeout(): void
    {
        // Boolean casts
        $boolTrueCases = [true, 'true', '1', 'yes', 'on'];
        foreach ($boolTrueCases as $c) {
            $cfg = new WonProjectIntegrationConfig([WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => $c]);
            $this->assertTrue($cfg->isExportEnabled(), "Valor " . var_export($c, true) . " debe castear a true");
        }

        $boolFalseCases = [false, 'false', '0', 'no', 'off'];
        foreach ($boolFalseCases as $c) {
            $cfg = new WonProjectIntegrationConfig([WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => $c]);
            $this->assertFalse($cfg->isExportEnabled(), "Valor " . var_export($c, true) . " debe castear a false");
        }

        // Timeout casts
        $timeoutCases = [
            '10' => 10,
            ' 60 ' => 60,
            15 => 15,
        ];
        foreach ($timeoutCases as $input => $expected) {
            $cfg = new WonProjectIntegrationConfig([WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => $input]);
            $this->assertEquals($expected, $cfg->getTimeoutSeconds(), "Timeout {$input} debe castear a {$expected}");
        }
    }

    public function testToArrayAndDebugInfoNeverExposeSecretNorPrivatePath(): void
    {
        $dummyKey = 'safe-public-key-id-99';
        $dummySecret = 'ultra-sensitive-fictitious-secret-xyz888';
        $dummyEndpoint = 'https://api.example.com/endpoint';
        $privatePath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'secret_private_takeoff_config.php';

        $fileContent = "<?php\nreturn [\n"
            . "    'WON_PROJECT_EXPORT_ENABLED' => true,\n"
            . "    'WON_PROJECT_HMAC_ACTIVE_KEY_ID' => '{$dummyKey}',\n"
            . "    'WON_PROJECT_HMAC_ACTIVE_SECRET' => '{$dummySecret}',\n"
            . "    'ELECTROPLAN_WON_PROJECT_ENDPOINT' => '{$dummyEndpoint}',\n"
            . "    'WON_PROJECT_REQUEST_TIMEOUT_SECONDS' => 30,\n"
            . "];\n";

        $tempFile = $this->createTempConfigFile($fileContent, 'php');

        $config = WonProjectIntegrationConfig::load($tempFile);

        // 1. toArray()
        $arrayRep = $config->toArray();

        $this->assertFalse(array_key_exists(WonProjectIntegrationConfig::KEY_HMAC_SECRET, $arrayRep), 'toArray no debe contener KEY_HMAC_SECRET');
        $this->assertFalse(array_key_exists(WonProjectIntegrationConfig::KEY_PRIVATE_CONFIG, $arrayRep), 'toArray no debe contener KEY_PRIVATE_CONFIG');
        $this->assertFalse(in_array($dummySecret, $arrayRep, true), 'toArray no debe contener el valor del secreto');
        $this->assertFalse(in_array($tempFile, $arrayRep, true), 'toArray no debe contener la ruta del archivo privado');

        $expectedKeys = [
            WonProjectIntegrationConfig::KEY_EXPORT_ENABLED,
            WonProjectIntegrationConfig::KEY_HMAC_KEY_ID,
            WonProjectIntegrationConfig::KEY_ENDPOINT,
            WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS,
        ];
        $this->assertEquals($expectedKeys, array_keys($arrayRep), 'toArray sólo debe exponer los 4 campos públicos seguros');

        // 2. __debugInfo()
        $debugRep = $config->__debugInfo();

        $this->assertFalse(array_key_exists(WonProjectIntegrationConfig::KEY_HMAC_SECRET, $debugRep), '__debugInfo no debe contener KEY_HMAC_SECRET');
        $this->assertFalse(array_key_exists(WonProjectIntegrationConfig::KEY_PRIVATE_CONFIG, $debugRep), '__debugInfo no debe contener KEY_PRIVATE_CONFIG');
        $this->assertFalse(in_array($dummySecret, $debugRep, true), '__debugInfo no debe contener el valor del secreto');
        $this->assertFalse(in_array($tempFile, $debugRep, true), '__debugInfo no debe contener la ruta del archivo');

        // 3. String representation (print_r / var_export)
        $printOutput = print_r($config, true);
        $this->assertFalse(str_contains($printOutput, $dummySecret), 'print_r del objeto no debe exponer el secreto');
        $this->assertFalse(str_contains($printOutput, $tempFile), 'print_r del objeto no debe exponer la ruta privada');
    }

    public function testExceptionMessagesNeverContainSecretNorPrivatePath(): void
    {
        $dummySecret = 'fictitious-leak-check-secret-444';
        $dummyPath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'fake_path_leak_check_' . bin2hex(random_bytes(4)) . '.php';

        // Escenario 1: Archivo ausente
        try {
            WonProjectIntegrationConfig::load($dummyPath);
            $this->fail('Debió lanzar excepción para archivo inexistente');
        } catch (\InvalidArgumentException $e) {
            $msg = $e->getMessage();
            $this->assertFalse(str_contains($msg, $dummyPath), 'Excepción de archivo ausente no debe contener la ruta');
            $this->assertFalse(str_contains($msg, $dummySecret), 'Excepción no debe contener secretos');
        }

        // Escenario 2: Extensión no PHP
        $dummyJsonPath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'fake_json_' . bin2hex(random_bytes(4)) . '.json';
        try {
            WonProjectIntegrationConfig::load($dummyJsonPath);
            $this->fail('Debió lanzar excepción para extensión no PHP');
        } catch (\InvalidArgumentException $e) {
            $msg = $e->getMessage();
            $this->assertFalse(str_contains($msg, $dummyJsonPath), 'Excepción de extensión inválida no debe contener la ruta');
        }

        // Escenario 3: Archivo no-array
        $tempNonArray = $this->createTempConfigFile("<?php\nreturn 'secret_scalar_leak';\n", 'php');
        try {
            WonProjectIntegrationConfig::load($tempNonArray);
            $this->fail('Debió lanzar excepción para contenido no array');
        } catch (\InvalidArgumentException $e) {
            $msg = $e->getMessage();
            $this->assertFalse(str_contains($msg, $tempNonArray), 'Excepción no-array no debe contener la ruta');
            $this->assertFalse(str_contains($msg, 'secret_scalar_leak'), 'Excepción no-array no debe contener valor del archivo');
        }

        // Escenario 4: Endpoint inválido con secreto configurado
        try {
            $cfg = new WonProjectIntegrationConfig([
                WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
                WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => 'test-key',
                WonProjectIntegrationConfig::KEY_HMAC_SECRET => $dummySecret,
                WonProjectIntegrationConfig::KEY_ENDPOINT => 'http://insecure.test/api',
                WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 30,
            ]);
            $cfg->validate();
            $this->fail('Debió lanzar excepción para HTTP inseguro');
        } catch (\InvalidArgumentException $e) {
            $msg = $e->getMessage();
            $this->assertFalse(str_contains($msg, $dummySecret), 'Excepción de validación de endpoint no debe contener el secret');
        }

        // Escenario 5: Timeout inválido con secreto configurado
        try {
            $cfg = new WonProjectIntegrationConfig([
                WonProjectIntegrationConfig::KEY_EXPORT_ENABLED => true,
                WonProjectIntegrationConfig::KEY_HMAC_KEY_ID => 'test-key',
                WonProjectIntegrationConfig::KEY_HMAC_SECRET => $dummySecret,
                WonProjectIntegrationConfig::KEY_ENDPOINT => 'https://secure.test/api',
                WonProjectIntegrationConfig::KEY_TIMEOUT_SECONDS => 0,
            ]);
            $cfg->validate();
            $this->fail('Debió lanzar excepción para timeout inválido');
        } catch (\InvalidArgumentException $e) {
            $msg = $e->getMessage();
            $this->assertFalse(str_contains($msg, $dummySecret), 'Excepción de timeout no debe contener el secret');
        }
    }

    // -------------------------------------------------------------------------
    // Assertions and Summary Helpers
    // -------------------------------------------------------------------------

    private function assertTrue(bool $condition, string $msg = 'Expected true'): void
    {
        if (!$condition) {
            throw new \RuntimeException("Assertion failed: {$msg}");
        }
    }

    private function assertFalse(bool $condition, string $msg = 'Expected false'): void
    {
        if ($condition) {
            throw new \RuntimeException("Assertion failed: {$msg}");
        }
    }

    private function assertEquals(mixed $expected, mixed $actual, string $msg = 'Values must match'): void
    {
        if ($expected !== $actual) {
            $expStr = is_scalar($expected) ? (string)$expected : json_encode($expected);
            $actStr = is_scalar($actual) ? (string)$actual : json_encode($actual);
            throw new \RuntimeException("Assertion failed: {$msg} [Expected: {$expStr}, got: {$actStr}]");
        }
    }

    private function fail(string $msg): void
    {
        throw new \RuntimeException("Test failure: {$msg}");
    }

    private function printSummary(): int
    {
        $passed = 0;
        $failed = 0;

        foreach ($this->results as $r) {
            if ($r['status'] === 'PASS') {
                $passed++;
            } else {
                $failed++;
            }
        }

        $total = count($this->results);
        echo "\n----------------------------------------------------------------------\n";
        echo "SUMMARY: Total: {$total} | Passed: {$passed} | Failed: {$failed}\n";
        echo "----------------------------------------------------------------------\n";

        if ($failed > 0) {
            echo "RESULT: FAIL (Private config regressions or security violations)\n";
            return 1;
        }

        echo "RESULT: GREEN (All private configuration loader tests passed)\n";
        return 0;
    }
}

// CLI Execution entrypoint
$runner = new WonProjectPrivateConfigTestRunner();
exit($runner->run());
