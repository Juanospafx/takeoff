<?php
declare(strict_types=1);

$source = file_get_contents(__DIR__ . '/../pages/editor.php');
if ($source === false) throw new RuntimeException('Unable to read editor source.');

$guardedFunctions = [
    'saveCalibrationForPage' => 'takeoffCanWrite',
    'saveCurrentPageAnnotations' => 'takeoffCanWrite',
    'removeKonvaNote' => 'takeoffRequireWrite',
    'createKonvaNote' => 'takeoffRequireWrite',
    'createKonvaCloud' => 'takeoffRequireWrite',
    'createKonvaPin' => 'takeoffRequireWrite',
    'deleteKonvaSelection' => 'takeoffRequireWrite',
    'deleteSelected' => 'takeoffRequireWrite',
    'addStamp' => 'takeoffRequireWrite',
    'clearCalLine' => 'takeoffRequireWrite',
    'finishCal' => 'takeoffRequireWrite',
    'addText' => 'takeoffRequireWrite',
    'addCloud' => 'takeoffRequireWrite',
    'addPin' => 'takeoffRequireWrite',
    'addReportAttachments' => 'takeoffRequireWrite',
    'submitReport' => 'takeoffRequireWrite',
];

$checks = [
    'editor derives identity through SessionGuard' => str_contains($source, 'SessionGuard::getAuthenticatedUser'),
    'editor defaults unknown roles to viewer' => str_contains($source, 'SessionGuard::ROLE_VIEWER'),
    'editor only grants write to admin' => str_contains($source, '$canWrite = $authRole === SessionGuard::ROLE_ADMIN;'),
    'editor publishes strict capability' => str_contains($source, 'parsed.canWrite === true'),
    'editor blocks viewer non-read fetch' => str_contains($source, "!['GET', 'HEAD', 'OPTIONS'].includes(method)"),
    'scale request guards before fetch' => preg_match('/function takeoffScaleRequest.*?if \(method !== \'GET\' && !window\.takeoffRequireWrite\(\)\).*?fetch\(/s', $source) === 1,
    'draft persistence fails closed' => preg_match('/function persistDraftAnnotations\(\)\s*\{\s*if \(!window\.takeoffCanWrite\(\)\) return false;.*?localStorage\.setItem/s', $source) === 1,
    'save control hidden for viewer' => str_contains($source, "'#btn-save"),
    'drawing controls hidden for viewer' => str_contains($source, '#btn-draw'),
    'navigation controls retained' => str_contains($source, 'onclick="changePage(-1)"'),
    'browser metadata excludes secrets' => !preg_match('/clientAuthMetadata\s*=\s*\[[^\]]*(token|secret|password|subject|\bsub\b)/is', $source),
];

foreach ($guardedFunctions as $function => $guard) {
    $checks["{$function} guarded before side effects"] = preg_match('/(?:async\s+)?function\s+' . preg_quote($function, '/') . '\s*\([^)]*\)\s*\{\s*if \(!window\.' . preg_quote($guard, '/') . '\(\)\) return false;/s', $source) === 1;
}

$passed = 0;
foreach ($checks as $label => $ok) {
    if (!$ok) throw new RuntimeException("FAIL: {$label}");
    $passed++;
    echo "PASS: {$label}\n";
}
echo "Editor RBAC UI: {$passed}/" . count($checks) . " passed.\n";

