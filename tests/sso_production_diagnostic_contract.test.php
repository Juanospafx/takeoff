<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$source = (string)file_get_contents($root . '/harness/sso-production-diagnostic.php');
$migration = (string)file_get_contents($root . '/harness/project-members-migration.php');
$workflow = (string)file_get_contents($root . '/.github/workflows/deploy.yml');

$assert = static function (bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
};

try {
    $assert(str_contains($source, "REQUEST_METHOD'] ?? '') !== 'POST'"), 'Diagnostic must require POST.');
    $assert(str_contains($source, 'hash_equals(DIAGNOSTIC_TOKEN_SHA256'), 'Diagnostic token comparison must be constant-time.');
    $assert(str_contains($source, "'code' => 'intentional-invalid-diagnostic-code'"), 'OAuth check must never consume a real authorization code.');
    $assert(str_contains($source, "'oauth_client_accepted'"), 'OAuth credential result must be safely classified.');
    $assert(str_contains($source, "'links_table'"), 'Federated links table must be checked.');
    $assert(str_contains($source, "'project_members_table'"), 'Project membership table must be checked.');
    $assert(str_contains($source, "'project_members_role_column'"), 'Project membership roles must be checked.');
    $assert(str_contains($source, "'excel_runtime_supported'"), 'Excel runtime extensions must be checked.');
    $assert(str_contains($source, "'excel_export_template'"), 'Private Excel export template must be checked.');
    $assert(str_contains($source, 'unlink(__FILE__)'), 'Diagnostic endpoint must remove itself.');
    $assert(!str_contains($source, 'echo $config->getClientSecret()'), 'Client secret must never be returned.');
    $assert(str_contains($workflow, 'Prepare one-shot SSO production diagnostic'), 'Workflow must prepare the one-shot diagnostic after build.');
    $assert(str_contains($workflow, 'Run one-shot SSO production diagnostic'), 'Workflow must invoke the diagnostic after FTP deployment.');
    $assert(str_contains($workflow, 'X-Takeoff-Diagnostic-Token'), 'Workflow must authenticate the diagnostic request.');
    $assert(str_contains($migration, "REQUEST_METHOD'] ?? '') !== 'POST'"), 'Migration must require POST.');
    $assert(str_contains($migration, 'hash_equals(MIGRATION_TOKEN_SHA256'), 'Migration token comparison must be constant-time.');
    $assert(str_contains($migration, 'CREATE TABLE IF NOT EXISTS project_members'), 'Migration must create project membership storage idempotently.');
    $assert(str_contains($migration, 'INSERT IGNORE INTO project_members'), 'Migration must backfill project memberships idempotently.');
    $assert(str_contains($migration, 'unlink(__FILE__)'), 'Migration endpoint must remove itself.');
    $assert(str_contains($workflow, 'Upload one-shot project membership migration'), 'Workflow must upload the migration before application deployment.');
    $assert(str_contains($workflow, 'Apply project membership migration'), 'Workflow must apply the migration before application deployment.');
    $migrationStep = strpos($workflow, 'Apply project membership migration');
    $deployStep = strpos($workflow, 'Deploy to FTPS server');
    $assert($migrationStep !== false && $deployStep !== false && $migrationStep < $deployStep, 'Database migration must pass before application deployment.');
    $assert(str_contains($workflow, 'X-Takeoff-Migration-Token'), 'Workflow must authenticate the migration request.');
    echo "ALL SSO PRODUCTION DIAGNOSTIC CONTRACT TESTS PASSED (21/21 assertions).\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'TEST ERROR: ' . $error->getMessage() . "\n");
    exit(1);
}

