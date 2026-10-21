<?php
declare(strict_types=1);

$dashboard = file_get_contents(__DIR__ . '/../pages/project_dashboard.php');
$client = file_get_contents(__DIR__ . '/../assets/project_takeoff.js');
if ($dashboard === false || $client === false) {
    throw new RuntimeException('Unable to read dashboard RBAC sources.');
}

$checks = [
    'dashboard derives identity through SessionGuard' => str_contains($dashboard, 'SessionGuard::getAuthenticatedUser'),
    'dashboard defaults unknown roles to viewer' => str_contains($dashboard, "SessionGuard::ROLE_VIEWER"),
    'dashboard only grants write to admin role' => str_contains($dashboard, '$canWrite = $isAdminUser;'),
    'dashboard publishes strict canWrite boolean' => str_contains($dashboard, 'canWrite: parsed.canWrite === true'),
    'dashboard publishes read-only state' => str_contains($dashboard, 'data-read-only='),
    'dashboard blocks non-read fetch for viewers' => str_contains($dashboard, "!['GET', 'HEAD', 'OPTIONS'].includes(method)"),
    'dashboard hides project save for viewers' => str_contains($dashboard, "'#saveProjectBtn'"),
    'dashboard hides document upload for viewers' => str_contains($dashboard, "'#docUploadArrowBtn'"),
    'dashboard hides takeoff creation for viewers' => str_contains($dashboard, "'[data-takeoff-action=\"create-layer\"]'"),
    'dashboard hides estimate mutations for viewers' => str_contains($dashboard, "'[data-est-action=\"create-group\"]'"),
    'dashboard retains download behavior' => str_contains($dashboard, 'downloadDocBtn'),
    'dashboard retains viewer navigation commands' => str_contains($dashboard, 'data-viewer-command="zoom-in"'),
    'takeoff client has strict capability helper' => preg_match('/function canWrite\(\)\s*\{\s*return window\.TakeoffAuth\?\.canWrite === true;/s', $client) === 1,
    'state persistence is guarded before storage' => preg_match('/function saveTakeoffState\(\)\s*\{\s*if \(!canWrite\(\)\) return false;.*?localStorage\.setItem/s', $client) === 1,
    'layer creation is guarded' => preg_match('/function submitCreateLayerModal\(\)\s*\{\s*if \(!requireWrite\(\)\) return false;/s', $client) === 1,
    'layer save is guarded' => preg_match('/async function submitLayerModal\(\)\s*\{\s*if \(!requireWrite\(\)\) return false;/s', $client) === 1,
    'group creation is guarded' => preg_match('/function createTakeoffGroup\(name\)\s*\{\s*if \(!requireWrite\(\)\) return false;/s', $client) === 1,
    'group deletion is guarded' => preg_match('/async function deleteGroup\(groupId\)\s*\{\s*if \(!requireWrite\(\)\) return false;/s', $client) === 1,
    'layer deletion is guarded' => preg_match('/async function deleteLayer\(layerId\)\s*\{\s*if \(!requireWrite\(\)\) return false;/s', $client) === 1,
    'scale editing is guarded' => preg_match('/function openScalePanel\(mode\)\s*\{\s*if \(!requireWrite\(\)\) return false;/s', $client) === 1,
    'browser metadata does not expose token fields' => !preg_match('/clientAuthMetadata\s*=\s*\[[^\]]*(token|secret|password|subject|\bsub\b)/is', $dashboard),
];

$passed = 0;
foreach ($checks as $label => $ok) {
    if (!$ok) throw new RuntimeException("FAIL: {$label}");
    $passed++;
    echo "PASS: {$label}\n";
}
echo "Project Dashboard RBAC UI: {$passed}/" . count($checks) . " passed.\n";

