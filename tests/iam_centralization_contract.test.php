<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require_once $root . '/core/auth/session.php';
require_once $root . '/core/auth/SsoAuthorization.php';
require_once $root . '/config/SsoConfig.php';

$failures = [];
$check = static function (bool $condition, string $message) use (&$failures): void {
    if (!$condition) $failures[] = $message;
};

$check(class_exists('Takeoff\\Core\\Auth\\AuthorizationPolicy'), 'central AuthorizationPolicy must exist');
$check(defined('SessionGuard::ROLE_ESTIMATOR'), 'SessionGuard must expose estimator role');
$estimatorSession = SessionGuard::getAuthenticatedUser([
    'user_id' => 8, 'username' => 'Estimator', 'role' => 'estimator', 'active' => 1,
]);
$check(($estimatorSession['role'] ?? null) === 'estimator', 'estimator session must authenticate');
$check(\Takeoff\Core\Auth\SsoAuthorization::isAllowedRole('estimator'), 'Hub estimator role must be accepted');
$estimatorWrite = SessionGuard::checkApiAccess(
    'save', ['list'], ['save'], 'list',
    ['user_id' => 8, 'username' => 'Estimator', 'role' => 'estimator', 'active' => 1],
    'estimating.write'
);
$estimatorGlobalMutation = SessionGuard::checkApiAccess(
    'save', ['list'], ['save'], 'list',
    ['user_id' => 8, 'username' => 'Estimator', 'role' => 'estimator', 'active' => 1]
);
$check($estimatorWrite['allowed'] === true, 'estimator capability admits project-scoped writes');
$check($estimatorGlobalMutation['allowed'] === false, 'estimator remains denied for default global mutations');

$disabledSso = new \Takeoff\Config\SsoConfig(['TAKEOFF_SSO_ENABLED' => false]);
$ssoOnly = new \Takeoff\Config\SsoConfig(['TAKEOFF_SSO_ENABLED' => true]);
$breakGlass = new \Takeoff\Config\SsoConfig([
    'TAKEOFF_SSO_ENABLED' => true,
    'TAKEOFF_SSO_LOCAL_LOGIN_ENABLED' => true,
]);
$check($disabledSso->isLocalLoginEnabled(), 'local login remains available while SSO is disabled');
$check($ssoOnly->isSsoOnly(), 'enabling SSO defaults to central-only login');
$check($breakGlass->isLocalLoginEnabled(), 'explicit private flag enables break-glass login');

if (class_exists('Takeoff\\Core\\Auth\\AuthorizationPolicy')) {
    $policy = 'Takeoff\\Core\\Auth\\AuthorizationPolicy';
    $check($policy::allows('estimator', 'project.write'), 'estimator must write assigned projects');
    $check($policy::allows('estimator', 'estimating.write'), 'estimator must write estimates');
    $check(!$policy::allows('estimator', 'catalog.manage'), 'estimator must not manage catalog');
    $check($policy::allows('viewer', 'project.read'), 'viewer must read assigned projects');
    $check(!$policy::allows('viewer', 'project.write'), 'viewer must remain read-only');
    $check($policy::allows('admin', 'users.manage'), 'admin must manage assignments');
}

$config = (string)file_get_contents($root . '/config/SsoConfig.php');
$login = (string)file_get_contents($root . '/pages/login.php');
$settings = (string)file_get_contents($root . '/admin/settings.php');
$workflow = (string)file_get_contents($root . '/.github/workflows/deploy.yml');

$check(str_contains($config, 'TAKEOFF_SSO_LOCAL_LOGIN_ENABLED'), 'SSO config must expose explicit local break-glass flag');
$check(str_contains($login, 'isLocalLoginEnabled'), 'local login must honor SSO-only policy');
$check(str_contains($settings, 'centralIdentityReadOnly'), 'settings must expose central read-only user mode');
$check(str_contains($workflow, '.users_active_column == true'), 'deploy must require users.active');
$check(str_contains($workflow, '.links_table == true'), 'deploy must require identity links table');
$check(str_contains($workflow, '.project_members_table == true'), 'deploy must require project membership table');
$check(str_contains($workflow, '.project_members_role_column == true'), 'deploy must require project membership role column');
$check(str_contains($workflow, '.links_active_column == true'), 'deploy must require active identity links');

if ($failures) {
    fwrite(STDERR, "FAIL:\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}

echo "IAM centralization contract passed\n";
