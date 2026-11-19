<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$failures = [];

function security_assert(bool $condition, string $message): void
{
    global $failures;
    if (!$condition) {
        $failures[] = $message;
        echo "[FAIL] {$message}\n";
        return;
    }
    echo "[PASS] {$message}\n";
}

foreach (['admin/fix_password.php', 'admin/reset_admin.php', 'pages/check_db.php', 'api/v1/config.php'] as $removed) {
    security_assert(!file_exists($root . '/' . $removed), "Dangerous legacy endpoint removed: {$removed}");
}

$protectedPages = [
    'archivos.php', 'bid_board.php', 'company_settings.php', 'company_tools.php',
    'cost_catalog.php', 'directorio.php', 'editor.php', 'estimate_module.php',
    'index.php', 'preview.php', 'projects.php', 'project_create.php',
    'project_dashboard.php', 'project_module.php', 'timeline.php',
];
foreach ($protectedPages as $page) {
    $source = (string)file_get_contents($root . '/pages/' . $page);
    security_assert(str_contains($source, 'takeoff_require_page_auth'), "Page authentication guard present: {$page}");
}

$settings = (string)file_get_contents($root . '/admin/settings.php');
security_assert(str_contains($settings, "SessionGuard::ROLE_ADMIN"), 'Admin settings requires the admin role');
security_assert(str_contains($settings, 'hash_equals($csrfToken'), 'Admin settings verifies CSRF in constant time');
security_assert(!str_contains($settings, "\$_GET['delete_id']"), 'User deletion is no longer performed through GET');
security_assert(str_contains($settings, "\$_POST['action'] === 'delete_user'"), 'User deletion requires POST');
security_assert(str_contains($settings, 'password_verify($currentPass'), 'Password change verifies the current password');

$schema = (string)file_get_contents($root . '/db/takeoff_unified_schema.sql');
security_assert(!str_contains($schema, 'admin123'), 'Unified schema contains no predictable administrator password');
security_assert(str_contains($schema, '`active` TINYINT(1) NOT NULL DEFAULT 1'), 'Unified users schema includes active state');

$composer = json_decode((string)file_get_contents($root . '/composer.json'), true, 512, JSON_THROW_ON_ERROR);
security_assert(($composer['require']['php'] ?? '') === '>=8.4.27 <8.5', 'Composer requires patched PHP 8.4.27 or newer in the 8.4 line');

$deploy = (string)file_get_contents($root . '/.github/workflows/deploy.yml');
security_assert(str_contains($deploy, 'php-version: "8.4.27"'), 'Deployment workflow installs PHP 8.4.27');
security_assert(str_contains($deploy, "--exclude 'scratch'"), 'Deployment artifact excludes scratch tooling');
security_assert(str_contains($deploy, '.php_runtime_supported == true'), 'Production diagnostic rejects an outdated or incomplete PHP runtime');

$htaccess = (string)file_get_contents($root . '/.htaccess');
security_assert(str_contains($htaccess, 'api/download.php?scope=uploads'), 'Uploaded files route through authenticated download');
security_assert(str_contains($htaccess, 'core|config|db|docs|tests|bin|scratch'), 'Internal source directories are denied over HTTP');

require_once $root . '/core/auth/LoginRateLimiter.php';
$username = 'security-test-' . bin2hex(random_bytes(8));
$address = '192.0.2.10';
for ($i = 0; $i < 5; $i++) {
    \Takeoff\Core\Auth\LoginRateLimiter::registerFailure($address, $username);
}
security_assert(\Takeoff\Core\Auth\LoginRateLimiter::isBlocked($address, $username), 'Local login blocks repeated failures');
\Takeoff\Core\Auth\LoginRateLimiter::clear($address, $username);
security_assert(!\Takeoff\Core\Auth\LoginRateLimiter::isBlocked($address, $username), 'Successful login can clear throttling state');

if ($failures !== []) {
    fwrite(STDERR, sprintf("Security hardening contract failed: %d failure(s).\n", count($failures)));
    exit(1);
}

echo "Security hardening contract: PASS\n";
