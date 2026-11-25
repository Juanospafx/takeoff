<?php
// editor.php - Takeoff editor with central SSO capability enforcement.
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/files/upload_storage.php';
require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/auth/ProjectAccess.php';
$authRedirect = takeoff_require_page_auth($_SESSION ?? null);
if ($authRedirect !== null) return;

$authUser = SessionGuard::getAuthenticatedUser($_SESSION ?? null);
$authRole = $authUser['role'] ?? SessionGuard::ROLE_VIEWER;

$id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$id = $id === false ? 0 : (int) $id;

$stmt = $pdo->prepare("SELECT * FROM files WHERE id=?");
$stmt->execute([$id]);
$file = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$file) {
    http_response_code(404);
    die('File not found.');
}

$projectId = $file['project_id'];
$projectId = (int) $projectId;
takeoff_guard_project_access($pdo, $authUser, $projectId, ProjectAccess::READ);
$canWrite = ProjectAccess::can($pdo, $authUser, $projectId, ProjectAccess::WRITE);
$authDisplayName = trim((string) ($authUser['username'] ?? ''));
if ($authDisplayName === '') {
    $authDisplayName = $canWrite ? 'Editor' : 'Viewer';
}
$clientAuthMetadata = [
    'displayName' => $authDisplayName,
    'role' => $authRole,
    'canWrite' => $canWrite,
    'readOnly' => !$canWrite,
];
$folderId = $file['folder_id'];
$projectDashboardUrl = "project_dashboard.php?id={$projectId}";
$backUrl = $projectDashboardUrl . "&tab=takeoff";
$embedded = ($_GET['embedded'] ?? '') === '1';

$stmtRep = $pdo->prepare("SELECT annotations_json FROM file_reports WHERE file_id=? ORDER BY created_at DESC LIMIT 1");
$stmtRep->execute([$id]);
$lastReport = $stmtRep->fetchColumn();
$annotations = ($lastReport && $lastReport !== 'null') ? $lastReport : '{}';

$fileExt = strtolower(pathinfo($file['filename'], PATHINFO_EXTENSION));
if ($fileExt === '' && !empty($file['file_type'])) {
    $ft = strtolower($file['file_type']);
    if (strpos($ft, '/') !== false) {
        $fileExt = substr($ft, strrpos($ft, '/') + 1);
    } else {
        $fileExt = $ft;
    }
}
$resolvedDrawing = takeoff_resolve_stored_file((string) ($file['filepath'] ?? ''));
if (!$resolvedDrawing) {
    http_response_code(404);
    die("<div style='color:white;text-align:center;padding:50px;font-family:sans-serif;'>Error: The uploaded drawing file is missing. Please upload it again.</div>");
}
$filePath = implode('/', array_map('rawurlencode', explode('/', $resolvedDrawing['public_path'])));
$runtimeAnnotations = json_decode($annotations);
if (!is_object($runtimeAnnotations) && !is_array($runtimeAnnotations)) {
    $runtimeAnnotations = new stdClass();
}
$editorRuntimeConfig = [
    'fileUrl' => $filePath,
    'fileExt' => $fileExt,
    'fileId' => (int) $id,
    'projectId' => (int) $projectId,
    'annotations' => $runtimeAnnotations,
    'filename' => (string) ($file['filename'] ?? 'drawing.pdf'),
];
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Editor V9.6 | <?= htmlspecialchars($file['filename']) ?></title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">

    <script src="https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js"></script>
    <script src="../assets/editor/theme_bridge.js?v=<?= filemtime(__DIR__ . '/../assets/editor/theme_bridge.js') ?>"></script>

    <link rel="stylesheet"
        href="../assets/design_system.css?v=<?= filemtime(__DIR__ . '/../assets/design_system.css') ?>">
    <link rel="stylesheet" href="../assets/editor/editor.css?v=<?= filemtime(__DIR__ . '/../assets/editor/editor.css') ?>">
    <link rel="stylesheet" href="../assets/editor/takeoff.css?v=<?= filemtime(__DIR__ . '/../assets/editor/takeoff.css') ?>">

    <link rel="stylesheet" href="../assets/editor/shell.css?v=<?= filemtime(__DIR__ . '/../assets/editor/shell.css') ?>">
</head>

<body class="<?= $embedded ? 'embedded-editor' : '' ?>"
    data-user-role="<?= htmlspecialchars($authRole, ENT_QUOTES, 'UTF-8') ?>"
    data-can-write="<?= $canWrite ? 'true' : 'false' ?>" data-read-only="<?= $canWrite ? 'false' : 'true' ?>">
    <script id="takeoff-auth-metadata"
        type="application/json"><?= json_encode($clientAuthMetadata, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
    <script src="../assets/editor/authorization.js?v=<?= filemtime(__DIR__ . '/../assets/editor/authorization.js') ?>"></script>

    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeAllOverlays()"></div>

    <div class="stamp-menu" id="stamp-menu">
        <div class="stamp-item text-success" onclick="addStamp('APPROVED', '#22c55e')"><i
                class="fas fa-check-circle me-2"></i>Approved</div>
        <div class="stamp-item text-danger" onclick="addStamp('REJECTED', '#ef4444')"><i
                class="fas fa-times-circle me-2"></i>Rejected</div>
        <div class="stamp-item text-warning" onclick="addStamp('REVIEW', '#eab308')"><i
                class="fas fa-exclamation-circle me-2"></i>Review</div>
        <div class="stamp-item text-info" onclick="addStamp('DRAFT', '#3b82f6')"><i
                class="fas fa-file-alt me-2"></i>Draft</div>
    </div>

    <div class="app-container">
        <?php if (!$embedded): ?>
            <nav class="project-flow-nav" aria-label="Project navigation">
                <a href="<?= $projectDashboardUrl ?>&tab=overview">Overview</a>
                <a href="<?= $projectDashboardUrl ?>&tab=documents">Documents</a>
                <a href="<?= $projectDashboardUrl ?>&tab=takeoff" class="active" aria-current="page">Takeoff</a>
                <a href="<?= $projectDashboardUrl ?>&tab=estimating">Estimating</a>
                <a href="<?= $projectDashboardUrl ?>&tab=proposal">Proposal</a>
            </nav>
        <?php endif; ?>

        <header class="app-header">
            <div class="header-left">
                <a href="<?= $backUrl ?>" class="text-white me-3 d-md-none"><i class="fas fa-chevron-left"></i></a>

                <button class="toggle-icon-btn" onclick="toggleSheets()" title="Show Sheets">
                    <i class="far fa-file-alt"></i>
                </button>

                <button class="toggle-icon-btn d-lg-none" id="btn-toggle-tools" onclick="toggleMobileTools()"
                    title="Tools">
                    <i class="fas fa-tools"></i>
                </button>

                <div class="brand-logo ms-2 me-3">
                    <i class="fas fa-bolt text-warning"></i> <span class="d-none d-md-inline">Brightronix</span>
                </div>

                <div class="file-info d-none d-lg-flex">
                    <small>Editing File</small>
                    <span><?= htmlspecialchars($file['filename']) ?></span>
                </div>
            </div>

            <div class="properties-bar d-none d-md-flex">
                <div id="prop-smart" class="prop-section active">
                    <i class="fas fa-mouse-pointer text-accent me-2"></i>
                    <span class="text-white small fw-bold">Selection Mode</span>
                </div>

                <div id="prop-draw" class="prop-section">
                    <span class="prop-label">Color</span>
                    <div class="d-flex gap-2 mx-2">
                        <div class="color-dot active" style="background:#ef4444" onclick="setPenColor('#ef4444', this)">
                        </div>
                        <div class="color-dot" style="background:#3b82f6" onclick="setPenColor('#3b82f6', this)"></div>
                        <div class="color-dot" style="background:#22c55e" onclick="setPenColor('#22c55e', this)"></div>
                        <div class="color-dot" style="background:#eab308" onclick="setPenColor('#eab308', this)"></div>
                    </div>
                    <div class="border-start border-secondary mx-2 h-50"></div>
                    <span class="prop-label">Size</span>
                    <input type="range" class="form-range" style="width:80px" min="1" max="10" value="3"
                        oninput="setPenWidth(this.value)">
                </div>

                <div id="prop-text" class="prop-section">
                    <span class="prop-label">Color</span>
                    <div class="d-flex gap-2 mx-2" id="text-color-container">
                        <div class="color-dot" data-col="#ef4444" style="background:#ef4444"
                            onclick="setTextFixedColor('#ef4444', this)"></div>
                        <div class="color-dot" data-col="#3b82f6" style="background:#3b82f6"
                            onclick="setTextFixedColor('#3b82f6', this)"></div>
                        <div class="color-dot" data-col="#22c55e" style="background:#22c55e"
                            onclick="setTextFixedColor('#22c55e', this)"></div>
                        <div class="color-dot" data-col="#eab308" style="background:#eab308"
                            onclick="setTextFixedColor('#eab308', this)"></div>
                    </div>
                    <div class="border-start border-secondary mx-2 h-50"></div>
                    <span class="prop-label">Size</span>
                    <input type="number" id="text-size-input" class="form-control py-0 px-2 text-center" value="60"
                        min="8" max="100" style="width:60px; height:30px;"
                        onchange="updateTextProp('fontSize', parseInt(this.value))">
                </div>

                <div id="prop-cloud" class="prop-section">
                    <span class="prop-label"><i class="fas fa-cloud me-1"></i>Cloud stroke</span>
                    <select id="cloud-stroke" class="form-select form-select-sm ms-2" style="width:180px; height:30px;"
                        onchange="setCloudStrokeWidth(this.value)">
                        <option value="1.5">Fina (0.5px)</option>
                        <option value="3" selected>Normal (1px)</option>
                        <option value="6">Gruesa (2px)</option>
                        <option value="9">Extra gruesa (3px)</option>
                    </select>
                </div>

                <div id="prop-measure" class="prop-section">
                    <span class="prop-label text-success"><i class="fas fa-ruler me-2"></i>Measurement</span>
                    <span class="text-white small">Drag nodes to adjust. Dbl-Tap to move.</span>
                </div>

                <div id="prop-cal" class="prop-section">
                    <span class="prop-label text-warning"><i class="fas fa-ruler-combined me-2"></i>Calibration in
                        ft</span>
                    <div id="cal-mode-wrap" class="align-items-center gap-2 ms-2 d-flex">
                        <select id="cal-mode" class="form-select form-select-sm" style="width:110px; height:30px;"
                            onchange="setCalMode(this.value)">
                            <option value="manual">Manual</option>
                            <option value="preset" selected>Preset</option>
                        </select>
                        <select id="cal-preset" class="form-select form-select-sm" style="width:190px; height:30px;"
                            onchange="applyScalePreset(this.value)">
                            <option value="">Preset scale...</option>
                        </select>
                    </div>
                    <div id="cal-actions" style="display:none;" class="align-items-center gap-2 ms-2">
                        <input type="number" id="cal-val" class="form-control py-0 px-2" placeholder="ft"
                            style="width:60px; height:30px;" min="0.1" step="0.1">
                        <button class="btn btn-sm btn-success rounded-circle" style="width:30px;height:30px"
                            onclick="finishCal(true)"><i class="fas fa-check"></i></button>
                        <button class="btn btn-sm btn-secondary rounded-circle" style="width:30px;height:30px"
                            onclick="finishCal(false)"><i class="fas fa-times"></i></button>
                        <button class="btn btn-sm btn-danger rounded-circle ms-2" id="btn-del-cal"
                            style="display:none; width:30px;height:30px" onclick="clearCalLine()" title="Delete Line"><i
                                class="fas fa-trash"></i></button>
                    </div>
                    <span id="cal-hint" class="text-main small ms-2">Draw a known line...</span>
                </div>

                <div id="scale-display-wrap" class="prop-section active">
                    <span class="prop-label text-warning">Scale</span>
                    <span id="scale-display" class="text-white small fw-bold ms-2">--</span>
                </div>
            </div>

            <div class="header-right">
                <button
                    class="btn btn-outline-danger rounded-circle d-inline-flex align-items-center justify-content-center"
                    id="btn-delete-selection" style="width:35px;height:35px;border-color:var(--danger);"
                    onclick="deleteSelected()" title="Delete Selected">
                    <i class="fas fa-trash"></i>
                </button>

                <div class="d-flex gap-1 ms-2">
                    <button class="btn btn-outline-light rounded-circle" id="btn-undo"
                        style="width:35px;height:35px;border-color:var(--border);" onclick="undo()" title="Undo"><i
                            class="fas fa-undo"></i></button>
                    <button class="btn btn-outline-light rounded-circle" id="btn-redo"
                        style="width:35px;height:35px;border-color:var(--border);" onclick="redo()" title="Redo"><i
                            class="fas fa-redo"></i></button>
                </div>

                <button class="btn-action" id="btn-save" onclick="openReportModal()" title="Save and Report">
                    <i class="fas fa-save"></i> <span>Save</span>
                </button>

                <a href="<?= $backUrl ?>" class="btn-close-custom d-none d-md-flex">
                    <i class="fas fa-times"></i>
                </a>
            </div>
        </header>

        <aside class="sidebar-left" id="sidebarLeft">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <span class="sidebar-title mb-0"><i class="far fa-file-alt me-2"></i>Sheets</span>
                <button class="btn-close btn-close-white" onclick="toggleSheets()"></button>
            </div>

            <div id="page-list-container">
                <div class="page-item active">Loading Pages...</div>
            </div>

            <div class="mt-auto pt-4 border-top border-secondary">
                <span class="sidebar-title">Details</span>
                <div class="d-flex justify-content-between small mb-2">
                    <span>Format:</span> <span class="text-white"><?= strtoupper($fileExt) ?></span>
                </div>
                <div class="d-flex justify-content-between small mb-2">
                    <span>Uploaded:</span> <span
                        class="text-white"><?= date('M d', strtotime($file['uploaded_at'])) ?></span>
                </div>
            </div>
        </aside>

        <main class="canvas-area" id="canvas-wrapper">
            <canvas id="c"></canvas>
            <div id="konva-overlay"></div>
            <div class="drawing-loading" id="drawingLoading">
                <div class="drawing-loading-pill">
                    <i class="fas fa-circle-notch fa-spin"></i>
                    <span>Loading drawing...</span>
                </div>
            </div>

            <div class="floating-controls">
                <button class="float-btn" onclick="changePage(-1)"><i class="fas fa-chevron-left"></i></button>
                <span class="small fw-bold"><span id="p-curr">1</span>/<span id="p-total">-</span></span>
                <button class="float-btn" onclick="changePage(1)"><i class="fas fa-chevron-right"></i></button>
                <div class="border-start border-secondary h-75 mx-2 opacity-50"></div>
                <span class="small text-accent fw-bold" id="zoom-disp">100%</span>
            </div>
        </main>

        <aside class="sidebar-right" id="sidebarRight">
            <button class="tool-btn active" id="btn-smart" onclick="setMode('smart')" title="Pointer"><i
                    class="fas fa-mouse-pointer"></i></button>
            <button class="tool-btn" id="btn-draw" onclick="setMode('draw')" title="Pen Tool"><i
                    class="fas fa-pencil-alt"></i></button>
            <button class="tool-btn" id="btn-text" onclick="addText()" title="Add Text"><i
                    class="fas fa-font"></i></button>
            <button class="tool-btn" id="btn-cloud" onclick="addCloud()" title="Cloud Mark"><i
                    class="fas fa-cloud"></i></button>

            <button class="tool-btn" id="btn-stamp" onclick="toggleStampMenu()" title="Stamps"><i
                    class="fas fa-stamp"></i></button>

            <div class="tool-separator"></div>
            <button class="tool-btn" id="btn-measure" onclick="setMode('measure')" title="Ruler"><i
                    class="fas fa-ruler"></i></button>
            <button class="tool-btn text-warning" id="btn-cal" onclick="setMode('cal')" title="Calibrate"><i
                    class="fas fa-ruler-combined"></i></button>
        </aside>

    </div>

    <div class="modal fade" id="mobileCalModal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content p-2">
                <div class="modal-header">
                    <h6 class="modal-title fw-bold"><i class="fas fa-ruler-combined text-warning me-2"></i>Plan Scale
                    </h6>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <label class="form-label small mb-1">Mode</label>
                    <select id="mobile-cal-mode" class="form-select form-select-sm mb-2"
                        onchange="mobileCalModeChanged(this.value)">
                        <option value="manual">Manual</option>
                        <option value="preset">Preset</option>
                    </select>

                    <div id="mobile-cal-preset-wrap" class="mb-2">
                        <label class="form-label small mb-1">Preset scale</label>
                        <select id="mobile-cal-preset" class="form-select form-select-sm"
                            onchange="mobileCalPresetChanged(this.value)">
                            <option value="">Preset scale...</option>
                        </select>
                    </div>

                    <div id="mobile-cal-manual-wrap" class="mb-2 d-none">
                        <label class="form-label small mb-1">Distance (ft)</label>
                        <input type="number" id="mobile-cal-val" class="form-control form-control-sm" min="0.1"
                            step="0.1" placeholder="e.g. 10">
                        <div class="small text-muted mt-1">Draw a known line on the plan, then apply.</div>
                    </div>

                    <div class="small text-muted">Current scale: <span id="mobile-cal-current">--</span></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Close</button>
                    <button type="button" class="btn btn-sm btn-success" onclick="mobileApplyManualCal()">Apply</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="reportModal" data-bs-backdrop="static" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content p-3">
                <div class="modal-header">
                    <h5 class="modal-title fw-bold">Save Field Report</h5>
                    <button type="button"
                        class="btn btn-outline-danger rounded-circle d-flex align-items-center justify-content-center p-0"
                        data-bs-dismiss="modal" style="width: 30px; height: 30px; border-width: 2px;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="mb-3">
                        <label class="form-label small fw-bold">Technician Name</label>
                        <input type="text" id="rep-name" class="form-control"
                            value="<?= htmlspecialchars($_SESSION['username'] ?? 'Takeoff') ?>">
                    </div>
                    <div class="mb-3">
                        <label class="form-label small fw-bold">Role / Title</label>
                        <input type="text" id="rep-role" class="form-control"
                            value="<?= htmlspecialchars($_SESSION['role'] ?? 'Estimator') ?>">
                    </div>
                    <div class="mb-3">
                        <label class="form-label small fw-bold">Activity Description</label>
                        <textarea id="rep-desc" class="form-control" rows="3"
                            placeholder="e.g. Added conduit path to room 102..."></textarea>
                    </div>

                    <div class="mb-2">
                        <label class="form-label small fw-bold">Attachments</label>
                        <div id="rep-attach-dropzone" class="border rounded-3 p-3 text-center"
                            style="border-style:dashed !important; border-color:#475569 !important; background:#0f172a;">
                            <div class="small text-muted mb-2"><i class="fas fa-paperclip me-1"></i>Drag &amp; drop
                                files here or</div>
                            <button type="button" class="btn btn-sm btn-outline-light"
                                onclick="document.getElementById('rep-attachments').click()">Browse files</button>
                            <input type="file" id="rep-attachments" class="d-none" multiple>
                            <div class="small text-muted mt-2">Accepted: Images, PDF, DOC, XLS</div>
                            <div class="small text-muted">Max: 10MB per file · Up to 5 files</div>
                        </div>
                        <div id="rep-attachments-preview" class="mt-2 d-flex flex-column gap-2"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-action" id="btn-generate" onclick="submitReport()">
                        <i class="fas fa-check"></i> Generate Report
                    </button>
                </div>
            </div>
        </div>
    </div>

    <div id="toast-container"></div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/konva@9.3.3/konva.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>

    <script id="editor-runtime-config" type="application/json"><?= json_encode(
        $editorRuntimeConfig,
        JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    ) ?></script>
    <script src="../assets/editor/runtime.js?v=<?= filemtime(__DIR__ . '/../assets/editor/runtime.js') ?>"></script>
    <script src="../assets/catalog_metadata.js?v=<?= filemtime(__DIR__ . '/../assets/catalog_metadata.js') ?>"></script>
    <script src="../assets/takeoff_color_palette.js?v=<?= filemtime(__DIR__ . '/../assets/takeoff_color_palette.js') ?>"></script>
    <script src="../assets/takeoff_placement_guard.js?v=<?= filemtime(__DIR__ . '/../assets/takeoff_placement_guard.js') ?>"></script>
    <script src="../assets/takeoff_object_repair_service.js?v=<?= filemtime(__DIR__ . '/../assets/takeoff_object_repair_service.js') ?>"></script>
    <script src="../assets/editor/takeoff.js?v=<?= filemtime(__DIR__ . '/../assets/editor/takeoff.js') ?>"></script>
</body>

</html>
