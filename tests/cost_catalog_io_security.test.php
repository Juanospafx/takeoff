<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$api = (string) file_get_contents($root . '/api/catalog_io.php');
$page = (string) file_get_contents($root . '/pages/cost_catalog.php');
$js = (string) file_get_contents($root . '/assets/cost_catalog.js');
$deploy = (string) file_get_contents($root . '/.github/workflows/deploy.yml');
$failures = [];

$check = static function (bool $condition, string $message) use (&$failures): void {
    echo ($condition ? '[PASS] ' : '[FAIL] ') . $message . PHP_EOL;
    if (!$condition) $failures[] = $message;
};

$check(str_contains($api, 'WonProjectAdminAuthenticator'), 'uses persisted admin authentication');
$guardPos = strpos($api, 'takeoff_guard_api_action') !== false ? strpos($api, 'takeoff_guard_api_action') : strpos($api, 'SessionGuard::guardApiAction');
$dbPos = strpos($api, 'core/db/connection.php');
$check(str_contains($api, 'core/auth/session.php') && $guardPos !== false && $dbPos !== false && $guardPos < $dbPos, 'requires centralized session guard before database connection');
$check(preg_match('/\$mutationActions\s*=\s*\[[^\]]*\'import\'[^\]]*\];/s', $api) === 1, 'explicitly classifies import as mutation action');
$check(str_contains($api, "'import' => 'POST'"), 'import is POST-only');
$check(str_contains($api, 'hash_equals($sessionCsrf, $csrfToken)'), 'validates CSRF in constant time');
$check(str_contains($page, 'catalog_io_csrf_token') && str_contains($js, "formData.append('csrf_token'"), 'page issues and client submits catalog CSRF token');
$check(str_contains($api, '5 * 1024 * 1024'), 'limits upload to 5 MB');
$check(str_contains($api, '$highestRow > 5001'), 'limits imports to 5,000 data rows');
$check(str_contains($api, '$pdo->beginTransaction()') && str_contains($api, '$pdo->commit()') && str_contains($api, '$pdo->rollBack()'), 'wraps import writes in a transaction');
$check(!str_contains($api, '$e->getMessage()'), 'does not disclose exception details');
$check(str_contains($deploy, "--exclude '/templates/'") && str_contains($deploy, 'test ! -d "$ARTIFACT_DIR/templates"'), 'excludes source XLSX templates from public deployment artifact');

exit($failures === [] ? 0 : 1);
