<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$files = [
    'htaccess' => file_get_contents($root . '/.htaccess'),
    'api' => file_get_contents($root . '/api/api.php'),
    'takeoffApi' => file_get_contents($root . '/api/project_document_takeoff.php'),
    'uploadPage' => file_get_contents($root . '/api/upload.php'),
    'overview' => file_get_contents($root . '/assets/project_overview.js'),
    'overviewCss' => file_get_contents($root . '/assets/project_overview.css'),
    'takeoffJs' => file_get_contents($root . '/assets/project_takeoff.js'),
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
expect(str_contains($files['overview'], 'pdDocumentUploadModal'), 'Documents workspace must expose a visible upload progress modal');
expect(!str_contains($files['overview'], 'multi-upload-progress'), 'Documents workspace must not use the obsolete multi-upload-progress element');
expect(str_contains($files['overview'], 'UPLOAD_MODAL_HOLD_MS = 2000'), 'Documents upload modal must remain visible for 2s after completion');
expect(str_contains($files['overview'], 'resolveDuplicateDocumentName'), 'Documents workspace must prefix duplicate uploads with #(count)_(filename)');
expect(str_contains($files['overview'], 'syncDocumentsSubheadInfo'), 'Documents workspace must sync selected checkboxes with documentsSubheadItemInfo');
expect(str_contains($files['dashboard'], 'documentsSubheadItemInfo'), 'Dashboard must provide an independent documentsSubheadItemInfo container');
expect(str_contains($files['overview'], 'subhead-item-act-btn'), 'Documents subhead actions must use Takeoff subhead-item-act-btn styling');
expect(str_contains($files['overview'], 'DRAWING_DISCIPLINES'), 'Documents workspace must group drawings by smart discipline');
expect(str_contains($files['overview'], 'renderDisciplinePill'), 'Drawing groups must render as colored bb-status-pill-wrap pills without icons');
expect(str_contains($files['overview'], 'canDropDocumentsInCurrentView'), 'Documents content panel must restrict drag-and-drop when viewing an open document');
expect(str_contains($files['overview'], 'openAttachmentPreviewModal'), 'Attachment thumbnails must open a large preview modal on click');
expect(str_contains($files['overview'], 'navigateAttachmentPreview'), 'Attachment preview modal must support side arrow navigation between attachments');
expect(str_contains($files['overviewCss'], '.doc-attachment-nav-btn'), 'Attachment preview modal must style side navigation buttons');
expect(str_contains($files['takeoffJs'], 'data-drawing-doc="attachment"'), 'Takeoff drawing dropdown must group image files into an Attachment folder');
expect(str_contains($files['overviewCss'], '.doc-horizontal-list.zoom-2::-webkit-scrollbar'), 'doc-horizontal-list zoom-2 must render a visible system vertical scrollbar');
expect(str_contains($files['dashboard'], 'documentsContentFooter'), 'Documents content panel must include drag-and-drop footer');
expect(str_contains($files['overview'], '__SharedPdfThumbCache'), 'Documents workspace must share PDF thumbnail cache across views');
expect(str_contains($files['overview'], 'disableAutoFetch: true'), 'Documents PDF loader must disable full-file autoFetch to prevent lag');
expect(str_contains($files['overview'], 'enqueuePdfPageCount'), 'Documents folder tree must throttle background PDF page-count inspection');
expect(str_contains($files['overview'], 'ensureImageThumbnailUrl'), 'Attachment image thumbnails must be downscaled and cached to prevent UI lag');
expect(str_contains($files['overview'], 'getPdfThumbWorker'), 'Documents workspace must rasterize PDF thumbnails in a background Web Worker');
expect(str_contains($files['overview'], 'isDocumentsTabActive'), 'Documents thumbnail rendering must only run when the Documents tab is active');
expect(str_contains($files['dashboard'], 'onDocumentsTabVisibilityChange'), 'Dashboard tab switcher must notify Documents workspace to pause/resume background work');
expect(str_contains($files['overview'], '__TakeoffThumbService'), 'Documents worker must expose __TakeoffThumbService for off-thread Takeoff dropdown previews');
expect(str_contains($files['takeoffJs'], 'bindDropdownScrollGuards'), 'Takeoff drawing dropdown must suppress hover preview renders while scrolling');
expect(str_contains($files['takeoffJs'], 'getDocTakeoffPageMap'), 'Takeoff drawing dropdown must memoize per-document sheet summaries in O(1)');
expect(str_contains($files['takeoffJs'], 'activePreviewRenderTask'), 'Takeoff sheet preview must cancel stale PDF.js render tasks on hover');
expect(!str_contains($files['dashboard'], 'id="docMoveToTakeoffBtn"'), 'Obsolete topbar Move to Takeoff button must be removed from dashboard');
expect(!str_contains($files['overview'], 'data-doc-subhead-action="move-takeoff"'), 'Obsolete subhead Move to Takeoff button must be removed from Documents');
expect(str_contains($files['overview'], '_pendingTakeoffDrawingId'), 'Documents upload must defer Takeoff canvas rendering until Takeoff tab is active');
expect(str_contains($files['dashboard'], 'showTakeoffCanvasLoader'), 'Dashboard Takeoff tab switcher must display loading overlay while rendering new blueprint');
expect(str_contains($files['overview'], "norm.startsWith('Drawings:')"), 'inferCategory must preserve Drawings category and discipline groups after page refresh');
expect(str_contains($files['takeoffApi'], 'requestedFolderName'), 'Upload endpoint must persist drawing group folder assignment in database');

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

