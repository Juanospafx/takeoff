<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$source = (string)file_get_contents($root . '/harness/sso-production-diagnostic.php');
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
    $assert(str_contains($source, 'unlink(__FILE__)'), 'Diagnostic endpoint must remove itself.');
    $assert(!str_contains($source, 'echo $config->getClientSecret()'), 'Client secret must never be returned.');
    $assert(str_contains($workflow, 'Prepare one-shot SSO production diagnostic'), 'Workflow must prepare the one-shot diagnostic after build.');
    $assert(str_contains($workflow, 'Run one-shot SSO production diagnostic'), 'Workflow must invoke the diagnostic after FTP deployment.');
    $assert(str_contains($workflow, 'X-Takeoff-Diagnostic-Token'), 'Workflow must authenticate the diagnostic request.');
    echo "ALL SSO PRODUCTION DIAGNOSTIC CONTRACT TESTS PASSED (10/10 assertions).\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'TEST ERROR: ' . $error->getMessage() . "\n");
    exit(1);
}

