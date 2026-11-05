<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$files = [
    'htaccess' => file_get_contents($root . '/.htaccess'),
    'api' => file_get_contents($root . '/api/api.php'),
    'takeoffApi' => file_get_contents($root . '/api/project_document_takeoff.php'),
    'uploadPage' => file_get_contents($root . '/api/upload.php'),
    'overview' => file_get_contents($root . '/assets/project_overview.js'),
    'index' => file_get_contents($root . '/pages/index.php'),
    'dashboard' => file_get_contents($root . '/pages/project_dashboard.php'),
];

$assertions = 0;
$failures = [];

function expect(bool $condition, string $message): void
{
    global $assertions, $failures;
    $assertions++;
    if (!$condition) $failures[] = $message;
}

foreach (['api', 'takeoffApi', 'uploadPage', 'overview', 'index', 'dashboard'] as $key) {
    expect(str_contains($files[$key], '10737418240'), "{$key} must enforce the exact 10 GB boundary");
}

expect(substr_count($files['htaccess'], 'upload_max_filesize 10240M') === 3, '.htaccess must configure 10 GB for every supported mod_php variant');
expect(substr_count($files['htaccess'], 'post_max_size 10300M') === 3, '.htaccess must leave multipart overhead above 10 GB');

expect((bool)preg_match('/id="documentsBrowseInput"[^>]*\bmultiple\b/', $files['dashboard']), 'Documents picker must allow multiple files');
expect((bool)preg_match('/id="projectUploadInput"[^>]*\bmultiple\b/', $files['dashboard']), 'Legacy project picker must allow multiple files');
expect((bool)preg_match('/name="files\[\]"[^>]*\bmultiple\b/', $files['uploadPage']), 'Dedicated picker must allow multiple files');

foreach (['uploadPage', 'overview', 'index', 'dashboard'] as $key) {
    expect(str_contains($files[$key], 'XMLHttpRequest'), "{$key} must use XMLHttpRequest for real upload progress");
    expect(str_contains($files[$key], '.upload.onprogress'), "{$key} must subscribe to upload progress events");
    expect((bool)preg_match('/completed\s*\+\+|completed\s*\+=\s*1/', $files[$key]), "{$key} must advance aggregate progress after each file");
}

expect(str_contains($files['overview'], 'uploadDocumentFile'), 'Documents workspace must persist saved-project files through its upload helper');
expect(str_contains($files['overview'], 'window.ProjectState?.projectId'), 'Documents workspace must distinguish saved projects from drafts');
expect(str_contains($files['overview'], 'MAX_PDF_PREVIEW_BYTES'), 'Documents workspace must avoid loading very large PDFs entirely into memory');
expect(str_contains($files['overview'], 'multi-upload-progress'), 'Documents workspace must expose a visible progress component');

foreach (['uploadPage', 'index', 'dashboard'] as $key) {
    expect((bool)preg_match('/for\s*\([^)]*(?:files|fileList|incoming)[^)]*\)/s', $files[$key]), "{$key} must iterate through the whole selection");
    expect(str_contains($files[$key], 'errors.push'), "{$key} must preserve per-file failures");
}

expect(str_contains($files['api'], "fopen(\$targetPath, 'x')"), 'Legacy API storage reservation must be atomic');
expect(str_contains($files['takeoffApi'], "fopen(\$targetPath, 'x')"), 'Documents endpoint storage reservation must be atomic');
expect(str_contains($files['api'], 'UPLOAD_ERR_INI_SIZE'), 'Legacy API must translate PHP upload-limit failures');
expect(str_contains($files['takeoffApi'], 'MAX_DOCUMENT_BYTES'), 'Documents endpoint must enforce its own 10 GB limit');

if ($failures) {
    fwrite(STDERR, "Multi-document upload contract failed:\n- " . implode("\n- ", $failures) . "\n");
    exit(1);
}

echo "Multi-document upload contract passed ({$assertions} assertions).\n";

