<?php
require_once __DIR__ . '/../core/db/connection.php';

$projectId = (int)($_GET['id'] ?? $_GET['project_id'] ?? 0);
$isDraftProject = $projectId <= 0 && isset($_GET['draft']);
$activeTab = $_GET['tab'] ?? 'overview';
$selectedDocumentId = (int)($_GET['file_id'] ?? $_GET['document_id'] ?? 0);

function dash_table_exists(PDO $pdo, string $table): bool
{
    try {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?");
        $stmt->execute([$table]);
        return (int)$stmt->fetchColumn() > 0;
    } catch (Throwable $e) {
        return false;
    }
}

function dash_column_exists(PDO $pdo, string $table, string $column): bool
{
    try {
        $stmt = $pdo->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
        $stmt->execute([$column]);
        return (bool)$stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return false;
    }
}

function dash_public_path(?string $path): string
{
    $path = str_replace('\\', '/', (string)$path);
    if ($path === '') return '';
    if (preg_match('~(api/)?uploads/[^\\s]+$~', $path, $m)) {
        $path = $m[0];
    }
    if (strpos($path, 'uploads/') === 0 || strpos($path, 'api/uploads/') === 0) {
        return '../' . $path;
    }
    return $path;
}

function money_fmt(float $value): string
{
    return '$' . number_format($value, 2);
}

$project = null;
if ($projectId > 0) {
    $stmt = $pdo->prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL");
    $stmt->execute([$projectId]);
    $project = $stmt->fetch(PDO::FETCH_ASSOC);
}

if (!$project && $isDraftProject) {
    $project = [
        'id' => 0,
        'project_template_id' => isset($_GET['template_id']) ? (int)$_GET['template_id'] : null,
        'project_number' => '',
        'name' => 'New Project',
        'description' => '',
        'status' => 'to_do',
        'client_name' => '',
        'job_address' => '',
        'city' => '',
        'state' => '',
        'postal_code' => '',
        'country' => '',
        'bid_due_at' => '',
        'metadata_json' => json_encode([
            'estimator' => 'Juan Estevez',
            'measurement_system' => 'US',
            'estimate_pricing' => 'Unlocked',
            'office' => '',
            'square_footage' => '',
            'customer_company' => '',
            'primary_contact' => '',
            'customer_phone' => '',
            'customer_email' => '',
            'notes' => [],
            'tasks' => [],
            'unsaved_draft' => true,
        ], JSON_UNESCAPED_SLASHES),
        'created_at' => null,
        'updated_at' => null,
    ];
}

if (!$project) {
    http_response_code(404);
    die('Project not found');
}

$folders = [];
if ($projectId > 0 && dash_table_exists($pdo, 'folders')) {
    $stmt = $pdo->prepare("SELECT id, name FROM folders WHERE project_id = ? AND deleted_at IS NULL ORDER BY name ASC");
    $stmt->execute([$projectId]);
    $folders = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

$documents = [];
if ($projectId > 0 && dash_table_exists($pdo, 'files')) {
    $stmt = $pdo->prepare("
        SELECT f.*, fo.name AS folder_name
        FROM files f
        LEFT JOIN folders fo ON fo.id = f.folder_id
        WHERE f.project_id = ? AND f.deleted_at IS NULL
        ORDER BY f.uploaded_at DESC, f.id DESC
    ");
    $stmt->execute([$projectId]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $file) {
        $ext = strtolower(pathinfo((string)$file['filename'], PATHINFO_EXTENSION));
        $documents[] = [
            'id' => (int)$file['id'],
            'source' => 'legacy_file',
            'folder_id' => isset($file['folder_id']) ? (int)$file['folder_id'] : null,
            'folder_name' => $file['folder_name'] ?: 'Documents',
            'title' => $file['filename'],
            'filename' => $file['filename'],
            'path' => dash_public_path($file['filepath'] ?? ''),
            'mime_type' => $file['file_type'] ?? '',
            'extension' => $ext,
            'uploaded_at' => $file['uploaded_at'] ?? $file['created_at'] ?? null,
        ];
    }
}

if ($projectId > 0 && dash_table_exists($pdo, 'project_documents')) {
    $hasDocumentFolders = dash_table_exists($pdo, 'document_folders');
    $stmt = $pdo->prepare($hasDocumentFolders ? "
        SELECT pd.*, df.name AS folder_name
        FROM project_documents pd
        LEFT JOIN document_folders df ON df.id = pd.document_folder_id
        WHERE pd.project_id = ? AND pd.deleted_at IS NULL
        ORDER BY pd.created_at DESC, pd.id DESC
    " : "
        SELECT pd.*, NULL AS folder_name
        FROM project_documents pd
        WHERE pd.project_id = ? AND pd.deleted_at IS NULL
        ORDER BY pd.created_at DESC, pd.id DESC
    ");
    $stmt->execute([$projectId]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $doc) {
        $ext = strtolower(pathinfo((string)$doc['original_filename'], PATHINFO_EXTENSION));
        $documents[] = [
            'id' => (int)$doc['id'],
            'source' => 'project_document',
            'folder_id' => isset($doc['document_folder_id']) ? (int)$doc['document_folder_id'] : null,
            'folder_name' => $doc['folder_name'] ?: 'Documents',
            'title' => $doc['title'],
            'filename' => $doc['original_filename'],
            'path' => dash_public_path($doc['storage_path'] ?? ''),
            'mime_type' => $doc['mime_type'] ?? '',
            'extension' => $ext,
            'uploaded_at' => $doc['created_at'] ?? null,
        ];
    }
}

if ($selectedDocumentId === 0 && !empty($documents)) {
    foreach ($documents as $doc) {
        if ($doc['source'] === 'legacy_file' && in_array($doc['extension'], ['pdf', 'png', 'jpg', 'jpeg', 'webp'], true)) {
            $selectedDocumentId = (int)$doc['id'];
            break;
        }
    }
    if ($selectedDocumentId === 0) {
        $selectedDocumentId = (int)$documents[0]['id'];
    }
}

$drawings = [];
if ($projectId > 0 && dash_table_exists($pdo, 'drawings')) {
    $stmt = $pdo->prepare("SELECT * FROM drawings WHERE project_id = ? AND deleted_at IS NULL ORDER BY drawing_number ASC, id DESC");
    $stmt->execute([$projectId]);
    $drawings = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

$takeoffLayers = [];
if ($projectId > 0 && dash_table_exists($pdo, 'takeoff_layers')) {
    $stmt = $pdo->prepare(dash_column_exists($pdo, 'takeoff_layers', 'project_id') ? "
        SELECT * FROM takeoff_layers
        WHERE project_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id DESC
    " : "
        SELECT tl.*
        FROM takeoff_layers tl
        INNER JOIN takeoffs t ON t.id = tl.takeoff_id
        WHERE t.project_id = ? AND tl.deleted_at IS NULL
        ORDER BY tl.sort_order ASC, tl.id DESC
    ");
    $stmt->execute([$projectId]);
    $takeoffLayers = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

$estimateItems = [];
if ($projectId > 0 && dash_table_exists($pdo, 'estimate_items') && dash_table_exists($pdo, 'estimates')) {
    $stmt = $pdo->prepare("
        SELECT ei.*, ci.name AS catalog_item_name
        FROM estimate_items ei
        INNER JOIN estimates e ON e.id = ei.estimate_id
        LEFT JOIN catalog_items ci ON ci.id = ei.catalog_item_id
        WHERE e.project_id = ? AND ei.deleted_at IS NULL AND e.deleted_at IS NULL
        ORDER BY ei.sort_order ASC, ei.id DESC
    ");
    $stmt->execute([$projectId]);
    $estimateItems = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

$proposals = [];
if ($projectId > 0 && dash_table_exists($pdo, 'proposals')) {
    $stmt = $pdo->prepare("SELECT * FROM proposals WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC");
    $stmt->execute([$projectId]);
    $proposals = $stmt->fetchAll(PDO::FETCH_ASSOC);
}

$estimatorName = 'Unassigned';
if (!empty($project['estimator_id']) && dash_table_exists($pdo, 'estimators')) {
    $stmt = $pdo->prepare("SELECT display_name FROM estimators WHERE id = ? LIMIT 1");
    $stmt->execute([(int)$project['estimator_id']]);
    $estimatorName = $stmt->fetchColumn() ?: 'Unassigned';
}

$projectMeta = [];
if (!empty($project['metadata_json'])) {
    $decodedMeta = json_decode((string)$project['metadata_json'], true);
    if (is_array($decodedMeta)) {
        $projectMeta = $decodedMeta;
    }
}
$estimatorName = $projectMeta['estimator'] ?? $estimatorName;
$measurementSystem = $projectMeta['measurement_system'] ?? 'US';
$estimatePricing = $projectMeta['estimate_pricing'] ?? 'Unlocked';
$projectOffice = $projectMeta['office'] ?? '';
$squareFootage = $projectMeta['square_footage'] ?? '';
$customerCompany = $projectMeta['customer_company'] ?? ($project['client_name'] ?? '');
$primaryContact = $projectMeta['primary_contact'] ?? '';
$customerPhone = $projectMeta['customer_phone'] ?? '';
$customerEmail = $projectMeta['customer_email'] ?? '';
$projectNotes = is_array($projectMeta['notes'] ?? null) ? $projectMeta['notes'] : [];
$projectTasks = is_array($projectMeta['tasks'] ?? null) ? $projectMeta['tasks'] : [];

$materialSubtotal = 0.0;
$laborSubtotal = 0.0;
$equipmentSubtotal = 0.0;
$wasteTotal = 0.0;
$markupTotal = 0.0;
$estimateTotal = 0.0;
foreach ($estimateItems as $item) {
    $materialSubtotal += (float)($item['material_cost'] ?? 0);
    $laborSubtotal += (float)($item['labor_cost'] ?? 0);
    $equipmentSubtotal += (float)($item['equipment_cost'] ?? 0);
    $estimateTotal += (float)($item['total_cost'] ?? $item['subtotal_cost'] ?? 0);
    $wasteTotal += ((float)($item['subtotal_cost'] ?? 0)) * ((float)($item['waste_factor_percent'] ?? $item['waste_percentage'] ?? 0) / 100);
    $markupTotal += ((float)($item['subtotal_cost'] ?? 0)) * ((float)($item['markup_percent'] ?? $item['margin_percentage'] ?? 0) / 100);
}

$proposalStatus = $proposals[0]['status'] ?? 'Not started';
$selectedDoc = null;
foreach ($documents as $doc) {
    if ((int)$doc['id'] === $selectedDocumentId && $doc['source'] === 'legacy_file') {
        $selectedDoc = $doc;
        break;
    }
}
if (!$selectedDoc) {
    foreach ($documents as $doc) {
        if ((int)$doc['id'] === $selectedDocumentId) {
            $selectedDoc = $doc;
            break;
        }
    }
}

$state = [
    'projectId' => $projectId,
    'isDraftProject' => $isDraftProject,
    'activeTab' => $activeTab,
    'projectInfo' => $project,
    'projectMeta' => $projectMeta,
    'documents' => $documents,
    'folders' => $folders,
    'selectedDocumentId' => $selectedDocumentId,
    'selectedDrawingId' => $selectedDocumentId,
    'takeoffGroups' => [],
    'takeoffLayers' => $takeoffLayers,
    'takeoffMeasurements' => [],
    'estimateItems' => $estimateItems,
    'proposalDraft' => $proposals[0] ?? null,
];
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= htmlspecialchars($project['name']) ?> - Project Workspace</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../assets/global_tools.css">
    <style>
        :root {
            --bg: #0b1120;
            --panel: #111827;
            --card: #182235;
            --card-2: #1f2a3d;
            --line: rgba(148, 163, 184, 0.22);
            --text: #f8fafc;
            --muted: #94a3b8;
            --primary: #2563eb;
            --accent: #0ea5e9;
            --success: #16a34a;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            background: var(--bg);
            color: var(--text);
            font-family: Outfit, system-ui, sans-serif;
        }
        a { color: inherit; }
        .workspace-shell { min-height: 100vh; display: flex; flex-direction: column; }
        .project-header {
            padding: 18px 24px;
            border-bottom: 1px solid var(--line);
            background: #0f172a;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }
        .project-header h1 { margin: 0; font-size: 1.35rem; font-weight: 800; }
        .project-header p { margin: 4px 0 0; color: var(--muted); font-size: .9rem; }
        .top-tabs {
            display: flex;
            gap: 2px;
            padding: 0 18px;
            background: var(--panel);
            border-bottom: 1px solid var(--line);
            overflow-x: auto;
        }
        .top-tabs button {
            height: 52px;
            padding: 0 18px;
            border: 0;
            border-bottom: 2px solid transparent;
            background: transparent;
            color: var(--muted);
            font-weight: 700;
            white-space: nowrap;
        }
        .top-tabs button:hover { color: var(--text); background: rgba(255,255,255,.04); }
        .top-tabs button.active {
            color: #60a5fa;
            border-bottom-color: var(--primary);
            background: rgba(37, 99, 235, .14);
        }
        .workspace-main { flex: 1; min-height: 0; }
        .tab-panel { display: none; padding: 24px; }
        .tab-panel.active { display: block; }
        .tab-panel.fullscreen { padding: 0; height: calc(100vh - 193px); min-height: 620px; overflow: hidden; }
        .grid { display: grid; gap: 16px; }
        .overview-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
        .card-panel {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 18px;
            min-width: 0;
        }
        .card-panel h2, .card-panel h3 { margin: 0 0 14px; font-size: 1rem; font-weight: 800; }
        .span-3 { grid-column: span 3; }
        .span-4 { grid-column: span 4; }
        .span-6 { grid-column: span 6; }
        .span-8 { grid-column: span 8; }
        .span-12 { grid-column: span 12; }
        .metric-value { font-size: 1.6rem; font-weight: 800; color: #60a5fa; }
        .label { color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
        .value { font-weight: 700; color: var(--text); }
        .info-list { display: grid; gap: 12px; }
        .info-row { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid rgba(255,255,255,.06); padding-bottom: 10px; }
        .btn-main, .btn-ghost {
            border: 0;
            border-radius: 6px;
            padding: 10px 14px;
            font-weight: 700;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
        }
        .btn-main { background: var(--primary); color: #fff; }
        .btn-ghost { background: rgba(255,255,255,.07); color: var(--text); border: 1px solid var(--line); }
        .btn-ghost:disabled { opacity: .45; cursor: not-allowed; }
        .quick-actions { display: flex; flex-wrap: wrap; gap: 10px; }
        .documents-layout {
            display: grid;
            grid-template-columns: 260px minmax(280px, 430px) 1fr;
            gap: 16px;
            height: calc(100vh - 177px);
            min-height: 580px;
        }
        .folder-list, .document-list { overflow: auto; }
        .folder-item, .doc-item {
            width: 100%;
            border: 1px solid transparent;
            background: transparent;
            color: var(--text);
            text-align: left;
            padding: 10px 12px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
        }
        .folder-item:hover, .doc-item:hover { background: rgba(255,255,255,.05); }
        .folder-item.active, .doc-item.active { background: rgba(37, 99, 235, .18); border-color: rgba(96,165,250,.35); }
        .doc-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
        .doc-meta { color: var(--muted); font-size: .78rem; }
        .preview-frame, .takeoff-frame {
            width: 100%;
            height: 100%;
            border: 0;
            background: #0f172a;
            border-radius: 8px;
        }
        .preview-empty, .takeoff-empty {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            color: var(--muted);
            border: 1px dashed var(--line);
            border-radius: 8px;
        }
        .takeoff-workspace { height: 100%; background: #0f172a; }
        .estimating-toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .estimating-toolbar input, .estimating-toolbar select {
            background: var(--card);
            color: var(--text);
            border: 1px solid var(--line);
            border-radius: 6px;
            padding: 10px 12px;
        }
        .table-wrap { background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: auto; }
        table { width: 100%; border-collapse: collapse; min-width: 980px; }
        th, td { padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,.07); text-align: left; vertical-align: middle; }
        th { color: #93c5fd; background: rgba(37, 99, 235, .16); font-size: .78rem; text-transform: uppercase; }
        td { color: #e2e8f0; }
        .totals-grid { grid-template-columns: repeat(6, minmax(150px, 1fr)); margin-top: 16px; }
        .proposal-sheet {
            max-width: 920px;
            margin: 0 auto;
            background: #f8fafc;
            color: #0f172a;
            border-radius: 8px;
            padding: 32px;
        }
        .proposal-sheet h2 { margin: 0; font-weight: 800; }
        .proposal-line { border-bottom: 1px solid #cbd5e1; padding: 12px 0; }
        @media (max-width: 1100px) {
            .documents-layout { grid-template-columns: 220px 1fr; height: auto; }
            .documents-layout .preview-card { grid-column: 1 / -1; min-height: 560px; }
            .span-3, .span-4, .span-6, .span-8 { grid-column: span 12; }
            .totals-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 720px) {
            .project-header { align-items: flex-start; flex-direction: column; }
            .tab-panel { padding: 16px; }
            .documents-layout { grid-template-columns: 1fr; }
            .totals-grid { grid-template-columns: 1fr; }
        }
    </style>
    <link rel="stylesheet" href="../assets/project_overview.css">
    <link rel="stylesheet" href="../assets/project_takeoff.css">
</head>
<body>
<?php include __DIR__ . '/../views/global_tools_header.php'; ?>
<div class="workspace-shell">
    <header class="project-header">
        <div class="project-title-block">
            <div class="project-title-row">
                <h1 id="projectHeaderName"><?= htmlspecialchars($project['name']) ?></h1>
                <div class="project-status-wrap">
                    <button class="project-status-badge" id="projectStatusButton" type="button" data-status="<?= htmlspecialchars($project['status'] ?? 'to_do') ?>">
                        <span id="projectStatusLabel"><?= htmlspecialchars(strtoupper(str_replace('_', ' ', $project['status'] ?? 'to_do'))) ?></span>
                        <i class="fas fa-chevron-down"></i>
                    </button>
                    <div class="project-status-menu" id="projectStatusMenu"></div>
                </div>
            </div>
            <p><?= $isDraftProject ? 'Unsaved draft' : htmlspecialchars(($project['status'] ?? 'draft') . ' project workspace') ?></p>
        </div>
        <div class="project-header-actions">
            <div class="dropdown-wrap">
                <button class="btn-main orange" type="button" data-menu-toggle="uploadMenu"><i class="fas fa-upload"></i> Upload</button>
                <div class="project-menu" id="uploadMenu">
                    <button type="button" data-upload-category="Drawings"><i class="fas fa-file-pdf"></i> Upload Drawings</button>
                    <button type="button" data-upload-category="Attachments"><i class="fas fa-paperclip"></i> Upload Attachments</button>
                </div>
            </div>
            <button class="btn-main" type="button" id="saveProjectBtn"><i class="fas fa-floppy-disk"></i> Save Project</button>
            <div class="dropdown-wrap">
                <button class="btn-ghost icon-only" type="button" data-menu-toggle="projectActionsMenu" aria-label="Project actions"><i class="fas fa-ellipsis-vertical"></i></button>
                <div class="project-menu align-right" id="projectActionsMenu">
                    <button type="button"><i class="fas fa-briefcase"></i> Add to Portfolio</button>
                    <button type="button"><i class="fas fa-copy"></i> Copy Project</button>
                    <button type="button"><i class="fas fa-layer-group"></i> Convert to Template</button>
                    <button type="button"><i class="fas fa-wand-magic-sparkles"></i> Apply Template</button>
                    <button type="button"><i class="fas fa-box-archive"></i> Archive Project</button>
                    <button type="button" class="danger"><i class="fas fa-trash"></i> Delete Project</button>
                    <button type="button"><i class="fas fa-file-lines"></i> Support Documentation</button>
                    <button type="button"><i class="fas fa-book-open"></i> User Guide</button>
                </div>
            </div>
            <a class="btn-ghost" href="bid_board.php"><i class="fas fa-arrow-left"></i> Bid Board</a>
        </div>
    </header>

    <nav class="top-tabs" aria-label="Project workspace tabs">
        <button type="button" data-tab="overview">Overview</button>
        <button type="button" data-tab="documents">Documents</button>
        <button type="button" data-tab="takeoff">Takeoff</button>
        <button type="button" data-tab="estimating">Estimating</button>
        <button type="button" data-tab="proposal">Proposal</button>
    </nav>

    <main class="workspace-main">
        <section id="tab-overview" class="tab-panel">
            <div class="project-overview-layout">
                <div class="overview-column">
                    <section class="overview-card">
                        <div class="overview-card-head">
                            <h2>Estimate Overview</h2>
                        </div>
                        <div class="overview-form-grid">
                            <label class="overview-field full">Estimate Name
                                <input id="poEstimateName" value="<?= htmlspecialchars($project['name'] ?? 'New Project') ?>">
                            </label>
                            <label class="overview-field full">Project Description
                                <textarea id="poProjectDescription" rows="3"><?= htmlspecialchars($project['description'] ?? '') ?></textarea>
                            </label>
                            <label class="overview-field">Estimator
                                <input id="poEstimator" value="<?= htmlspecialchars($estimatorName) ?>">
                            </label>
                            <label class="overview-field">Measurement System
                                <select id="poMeasurementSystem">
                                    <option value="US" <?= $measurementSystem === 'US' ? 'selected' : '' ?>>US</option>
                                    <option value="Metric" <?= $measurementSystem === 'Metric' ? 'selected' : '' ?>>Metric</option>
                                </select>
                            </label>
                            <label class="overview-field">Due Date
                                <input id="poDueDate" type="date" value="<?= !empty($project['bid_due_at']) ? htmlspecialchars(date('Y-m-d', strtotime($project['bid_due_at']))) : '' ?>">
                            </label>
                            <label class="overview-field">Due Time
                                <input id="poDueTime" type="time" value="<?= !empty($project['bid_due_at']) ? htmlspecialchars(date('H:i', strtotime($project['bid_due_at']))) : '' ?>">
                            </label>
                            <label class="overview-field">Estimate Pricing
                                <select id="poEstimatePricing">
                                    <option value="Unlocked" <?= $estimatePricing === 'Unlocked' ? 'selected' : '' ?>>Unlocked</option>
                                    <option value="Locked" <?= $estimatePricing === 'Locked' ? 'selected' : '' ?>>Locked</option>
                                </select>
                            </label>
                            <label class="overview-field">Project Number
                                <input id="poProjectNumber" value="<?= htmlspecialchars($project['project_number'] ?? '') ?>">
                            </label>
                            <label class="overview-field">Office
                                <input id="poOffice" value="<?= htmlspecialchars($projectOffice) ?>">
                            </label>
                            <label class="overview-field">Square Footage
                                <input id="poSquareFootage" inputmode="numeric" value="<?= htmlspecialchars((string)$squareFootage) ?>">
                            </label>
                        </div>
                    </section>

                    <section class="overview-card">
                        <div class="overview-card-head">
                            <h2>Customer Information</h2>
                        </div>
                        <div id="customerEmpty" class="overview-empty" <?= $customerCompany || $primaryContact || $customerPhone || $customerEmail || $project['job_address'] ? 'hidden' : '' ?>>
                            <button class="btn-outline-dark" type="button" id="addCustomerBtn"><i class="fas fa-plus"></i> Add Customer</button>
                            <button class="btn-outline-dark" type="button" id="addProjectAddressBtn"><i class="fas fa-location-dot"></i> Add Project Address</button>
                        </div>
                        <div class="overview-form-grid" id="customerFields" <?= $customerCompany || $primaryContact || $customerPhone || $customerEmail || $project['job_address'] ? '' : 'hidden' ?>>
                            <label class="overview-field">Customer Company
                                <input id="poCustomerCompany" value="<?= htmlspecialchars($customerCompany) ?>">
                            </label>
                            <label class="overview-field">Primary Contact
                                <input id="poPrimaryContact" value="<?= htmlspecialchars($primaryContact) ?>">
                            </label>
                            <label class="overview-field">Phone
                                <input id="poCustomerPhone" value="<?= htmlspecialchars($customerPhone) ?>">
                            </label>
                            <label class="overview-field">Email
                                <input id="poCustomerEmail" type="email" value="<?= htmlspecialchars($customerEmail) ?>">
                            </label>
                            <label class="overview-field full">Address
                                <input id="poCustomerAddress" value="<?= htmlspecialchars($project['job_address'] ?? '') ?>">
                            </label>
                            <label class="overview-field full">Project Address
                                <input id="poProjectAddress" value="<?= htmlspecialchars($project['job_address'] ?? '') ?>">
                            </label>
                        </div>
                    </section>
                </div>

                <div class="overview-column">
                    <section class="overview-card">
                        <div class="overview-card-head">
                            <h2>Notes</h2>
                        </div>
                        <?php if (empty($projectNotes)): ?>
                            <div class="overview-empty">
                                <p>No notes yet</p>
                                <button class="btn-outline-dark" type="button" id="addNoteBtn"><i class="fas fa-plus"></i> Add note</button>
                            </div>
                        <?php else: ?>
                            <div class="overview-list">
                                <?php foreach ($projectNotes as $note): ?>
                                    <div class="overview-list-item">
                                        <strong><?= htmlspecialchars($note['user'] ?? 'User') ?></strong>
                                        <span><?= htmlspecialchars($note['timestamp'] ?? '') ?></span>
                                        <p><?= htmlspecialchars($note['content'] ?? '') ?></p>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        <?php endif; ?>
                    </section>

                    <section class="overview-card">
                        <div class="overview-card-head">
                            <h2>Tasks</h2>
                            <span class="overview-count"><?= count($projectTasks) ?></span>
                        </div>
                        <?php if (empty($projectTasks)): ?>
                            <div class="overview-empty">
                                <p>No tasks yet</p>
                                <button class="btn-outline-dark" type="button" id="createTaskBtn"><i class="fas fa-plus"></i> Create first task</button>
                            </div>
                        <?php else: ?>
                            <div class="overview-list">
                                <?php foreach ($projectTasks as $task): ?>
                                    <div class="overview-list-item">
                                        <strong><?= htmlspecialchars($task['title'] ?? '') ?></strong>
                                        <span><?= htmlspecialchars($task['responsible'] ?? '') ?> <?= htmlspecialchars($task['due_date'] ?? '') ?></span>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        <?php endif; ?>
                    </section>
                </div>
            </div>
        </section>

        <section id="tab-documents" class="tab-panel">
            <div class="documents-layout">
                <aside class="card-panel folder-list">
                    <h2>Folders</h2>
                    <button class="folder-item active" data-folder="all"><i class="fas fa-layer-group text-info"></i> All Documents</button>
                    <button class="folder-item" data-folder="drawings"><i class="fas fa-file-pdf text-danger"></i> Drawings</button>
                    <button class="folder-item" data-folder="attachments"><i class="fas fa-paperclip text-warning"></i> Attachments</button>
                    <?php foreach ($folders as $folder): ?>
                        <button class="folder-item" data-folder="<?= (int)$folder['id'] ?>"><i class="fas fa-folder text-warning"></i> <?= htmlspecialchars($folder['name']) ?></button>
                    <?php endforeach; ?>
                    <div class="quick-actions mt-3">
                        <button class="btn-main" type="button" id="documentsSidebarUploadBtn"><i class="fas fa-upload"></i> Upload</button>
                        <button class="btn-ghost" onclick="openNewFolderModal()"><i class="fas fa-folder-plus"></i> Create Folder</button>
                    </div>
                </aside>

                <aside class="card-panel document-list">
                    <h2>Documents</h2>
                    <?php if (empty($documents)): ?>
                        <p class="text-secondary">No documents uploaded yet.</p>
                    <?php endif; ?>
                    <?php foreach ($documents as $doc): ?>
                        <button class="doc-item <?= (int)$doc['id'] === $selectedDocumentId ? 'active' : '' ?>"
                                data-doc-id="<?= (int)$doc['id'] ?>"
                                data-source="<?= htmlspecialchars($doc['source']) ?>"
                                data-folder-id="<?= htmlspecialchars((string)($doc['folder_id'] ?? '')) ?>"
                                data-extension="<?= htmlspecialchars($doc['extension']) ?>"
                                data-path="<?= htmlspecialchars($doc['path']) ?>">
                            <i class="fas <?= $doc['extension'] === 'pdf' ? 'fa-file-pdf text-danger' : 'fa-file text-info' ?>"></i>
                            <span style="min-width:0;">
                                <span class="doc-title"><?= htmlspecialchars($doc['filename']) ?></span>
                                <span class="doc-meta d-block"><?= htmlspecialchars($doc['folder_name']) ?></span>
                            </span>
                        </button>
                    <?php endforeach; ?>
                </aside>

                <section class="card-panel preview-card">
                    <div class="d-flex justify-content-between align-items-center gap-2 mb-3">
                        <h2 class="mb-0">Preview</h2>
                        <div class="quick-actions">
                            <a id="downloadDocBtn" class="btn-ghost" href="<?= htmlspecialchars($selectedDoc['path'] ?? '#') ?>" download><i class="fas fa-download"></i> Download</a>
                            <button id="setActiveDrawingBtn" class="btn-ghost"><i class="fas fa-thumbtack"></i> Set Active</button>
                            <button id="renameDocBtn" class="btn-ghost"><i class="fas fa-pen"></i> Rename</button>
                            <button id="deleteDocBtn" class="btn-ghost"><i class="fas fa-trash"></i> Delete</button>
                            <button id="openTakeoffBtn" class="btn-main"><i class="fas fa-ruler-combined"></i> Open in Takeoff</button>
                        </div>
                    </div>
                    <div class="documents-dropzone" id="documentsDropzone">
                        <div>
                            <strong>Drag and drop files here</strong>
                            <span>Upload drawings, attachments, specifications, or addenda for this project.</span>
                        </div>
                        <button class="btn-outline-dark" type="button" id="browseDocumentsBtn"><i class="fas fa-folder-open"></i> Browse files</button>
                    </div>
                    <div class="documents-local-list" id="documentsLocalList">
                        <div class="documents-empty" id="documentsEmptyState">
                            <strong>No documents uploaded yet</strong>
                            <span>Drag and drop files here or use the Upload button to add drawings and attachments.</span>
                        </div>
                        <div class="documents-table-wrap" id="documentsTableWrap" hidden>
                            <table class="documents-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Category</th>
                                        <th>Size</th>
                                        <th>Uploaded</th>
                                        <th>User</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="documentsLocalBody"></tbody>
                            </table>
                        </div>
                    </div>
                    <div style="height: calc(100% - 260px); min-height: 360px;">
                        <?php if ($selectedDoc && !empty($selectedDoc['path'])): ?>
                            <iframe id="documentPreviewFrame" class="preview-frame" src="<?= htmlspecialchars($selectedDoc['path']) ?>"></iframe>
                        <?php else: ?>
                            <div id="documentPreviewEmpty" class="preview-empty">Select a PDF or document to preview it here.</div>
                            <iframe id="documentPreviewFrame" class="preview-frame" style="display:none;"></iframe>
                        <?php endif; ?>
                    </div>
                </section>
            </div>
        </section>

        <section id="tab-takeoff" class="tab-panel fullscreen">
            <div class="takeoff-workspace pro-takeoff-workspace" id="takeoffWorkspace">
                <aside class="pro-takeoff-items" id="takeoffItemsPanel">
                    <div class="pro-takeoff-panel-head">
                        <div>
                            <h2 id="takeoffPanelTitle">Takeoffs (0)</h2>
                        </div>
                        <button class="pro-add-btn" type="button" data-takeoff-action="create-layer" title="Create New Takeoff Layer" aria-label="Create New Takeoff Layer"><i class="fas fa-plus"></i></button>
                        <button class="pro-icon-btn" type="button" id="toggleTakeoffItemsPanel" title="Collapse panel" aria-label="Collapse items panel">
                            <i class="fas fa-angles-left"></i>
                        </button>
                    </div>
                    <div class="pro-takeoff-searchbar">
                        <div class="pro-search-input">
                            <input id="takeoffItemSearch" type="search" placeholder="Search Takeoffs">
                            <i class="fas fa-magnifying-glass"></i>
                        </div>
                    </div>
                    <div class="pro-takeoff-actions-row">
                        <div class="pro-menu-wrap">
                            <button class="pro-actions-btn" type="button" data-takeoff-menu-toggle="takeoffItemsActions" aria-label="Takeoff actions">
                                Actions <i class="fas fa-chevron-down"></i>
                            </button>
                            <div class="pro-menu" id="takeoffItemsActions">
                                <button type="button" data-takeoff-action="create-group"><i class="fas fa-folder-plus"></i> Create New Group</button>
                                <button type="button" data-takeoff-action="create-layer"><i class="fas fa-plus"></i> Create New Layer</button>
                                <button type="button" data-takeoff-action="collapse-all"><i class="fas fa-down-left-and-up-right-to-center"></i> Collapse All</button>
                                <button type="button" class="excel" data-takeoff-action="export-excel"><i class="fas fa-file-excel"></i> Takeoff Quantities to Excel</button>
                            </div>
                        </div>
                    </div>
                    <div class="pro-takeoff-tree" id="takeoffItemsTree"></div>
                    <div class="pro-takeoff-footer">
                        <div>
                            <span>Active Layer</span>
                            <strong id="takeoffActiveLayerLabel">None</strong>
                            <small><i class="fas fa-circle-check"></i> Ready for estimating</small>
                        </div>
                    </div>
                </aside>

                <section class="pro-takeoff-viewer">
                    <div class="pro-viewer-toolbar">
                        <div class="pro-toolbar-group">
                            <button class="pro-icon-btn" type="button" data-viewer-command="previous" title="Previous sheet"><i class="fas fa-chevron-left"></i></button>
                            <button class="pro-icon-btn" type="button" data-viewer-command="next" title="Next sheet"><i class="fas fa-chevron-right"></i></button>
                            <div class="pro-drawing-selector">
                                <button class="pro-sheet-select pro-sheet-trigger" id="takeoffSheetSelect" type="button" aria-expanded="false">
                                    <span id="takeoffSheetLabel"><?= htmlspecialchars($selectedDoc['filename'] ?? 'No drawing selected') ?></span>
                                    <i class="fas fa-chevron-down"></i>
                                </button>
                                <div class="pro-drawing-dropdown" id="takeoffDrawingDropdown" aria-label="Drawing selector">
                                    <div class="pro-drawing-dropdown-head">
                                        <div>
                                            <div class="pro-drawing-crumbs">Drawing Sources <i class="fas fa-chevron-right"></i> Estimating Tool</div>
                                            <strong>Drawings</strong>
                                        </div>
                                        <button class="pro-icon-btn" type="button" data-drawing-close aria-label="Close drawing selector"><i class="fas fa-times"></i></button>
                                    </div>
                                    <div class="pro-drawing-search">
                                        <input id="takeoffDrawingSearch" type="search" placeholder="Search drawing">
                                        <i class="fas fa-magnifying-glass"></i>
                                    </div>
                                    <div class="pro-drawing-grid">
                                        <div class="pro-drawing-col">
                                            <div class="pro-drawing-col-title">Directory</div>
                                            <div id="takeoffDocumentList" class="pro-drawing-list"></div>
                                        </div>
                                        <div class="pro-drawing-col">
                                            <div class="pro-drawing-col-title">Sheets</div>
                                            <div id="takeoffSheetList" class="pro-drawing-list"></div>
                                        </div>
                                        <div class="pro-drawing-preview">
                                            <div class="pro-drawing-col-title">Preview</div>
                                            <div id="takeoffSheetPreview" class="pro-preview-box">
                                                <span>Select a sheet</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="pro-toolbar-group center">
                            <button type="button" class="pro-toolbar-btn" data-viewer-command="compare"><i class="fas fa-code-compare"></i> Compare</button>
                            <button type="button" class="pro-toolbar-btn" data-viewer-command="popout"><i class="fas fa-up-right-from-square"></i> Pop out</button>
                            <button type="button" class="pro-toolbar-btn" data-viewer-command="download"><i class="fas fa-download"></i> Download</button>
                        </div>
                        <div class="pro-scale-wrap">
                            <button class="pro-scale-status" id="takeoffScaleStatus" type="button" data-scale-toggle aria-expanded="false">
                                <i class="fas fa-triangle-exclamation"></i>
                                <span>Drawing Scale: not defined yet</span>
                            </button>
                            <div class="pro-scale-panel" id="takeoffScalePanel" aria-label="Takeoff scale calibration">
                                <div class="pro-scale-panel-head">
                                    <strong>Drawing Scale</strong>
                                    <button class="pro-icon-btn" type="button" data-scale-close aria-label="Close scale panel"><i class="fas fa-times"></i></button>
                                </div>
                                <label for="takeoffScaleMode">Calibration mode</label>
                                <select id="takeoffScaleMode">
                                    <option value="preset">Preset scale</option>
                                    <option value="manual">Manual rule</option>
                                </select>
                                <div id="takeoffPresetWrap">
                                    <label for="takeoffScalePreset">Scale preset</label>
                                    <select id="takeoffScalePreset">
                                        <option value="">Loading scales...</option>
                                    </select>
                                </div>
                                <div id="takeoffManualWrap" class="pro-scale-manual" hidden>
                                    <p>Draw a known line on the plan, enter its real length in feet, then apply.</p>
                                    <div class="pro-scale-manual-row">
                                        <input id="takeoffManualFeet" type="number" min="0.1" step="0.1" placeholder="ft">
                                        <button type="button" class="pro-toolbar-btn" data-scale-apply-manual>Apply</button>
                                    </div>
                                    <button type="button" class="pro-chip-btn" data-scale-clear-line><i class="fas fa-trash"></i> Clear line</button>
                                </div>
                                <div class="pro-scale-hint" id="takeoffScaleHint">Choose a preset scale or calibrate manually.</div>
                            </div>
                        </div>
                    </div>

                    <div class="pro-canvas-shell">
                        <?php if ($selectedDoc && $selectedDoc['source'] === 'legacy_file'): ?>
                            <iframe id="takeoffFrame" class="takeoff-frame pro-takeoff-frame" src="editor.php?id=<?= (int)$selectedDoc['id'] ?>&embedded=1"></iframe>
                        <?php else: ?>
                            <div id="takeoffEmpty" class="takeoff-empty pro-takeoff-empty">
                                <div>
                                    <i class="fas fa-file-pdf fa-3x mb-3"></i>
                                    <h3>No drawing selected</h3>
                                    <p>Upload drawings in Documents to start takeoff.</p>
                                </div>
                            </div>
                            <iframe id="takeoffFrame" class="takeoff-frame pro-takeoff-frame" style="display:none;"></iframe>
                        <?php endif; ?>

                        <div class="pro-floating-controls">
                            <button class="pro-icon-btn" type="button" data-viewer-command="zoom-out" title="Zoom out"><i class="fas fa-minus"></i></button>
                            <input id="takeoffZoomSlider" type="range" min="25" max="400" value="100" aria-label="Zoom">
                            <span id="takeoffZoomPercent">100%</span>
                            <button class="pro-icon-btn" type="button" data-viewer-command="zoom-in" title="Zoom in"><i class="fas fa-plus"></i></button>
                            <button class="pro-chip-btn" type="button" data-viewer-command="fit">Fit</button>
                            <button class="pro-chip-btn" type="button" data-viewer-command="grid">Grid</button>
                            <button class="pro-chip-btn" type="button" data-viewer-command="layers">Layers</button>
                            <button class="pro-icon-btn" type="button" data-viewer-command="fullscreen" title="Fullscreen"><i class="fas fa-expand"></i></button>
                        </div>
                    </div>

                    <div class="pro-row-menu" id="takeoffRowMenu">
                        <button type="button"><i class="fas fa-pen"></i> Rename</button>
                        <button type="button"><i class="fas fa-copy"></i> Duplicate</button>
                        <button type="button"><i class="fas fa-sliders"></i> Edit Properties</button>
                        <button type="button"><i class="fas fa-palette"></i> Change Color</button>
                        <button type="button" class="danger"><i class="fas fa-trash"></i> Delete</button>
                    </div>
                </section>

                <aside class="pro-tools-bar" aria-label="Takeoff tools">
                    <button class="pro-tool-btn active" type="button" data-tool-command="smart" title="Select"><i class="fas fa-mouse-pointer"></i></button>
                    <button class="pro-tool-btn" type="button" data-tool-command="pan" title="Pan"><i class="fas fa-hand"></i></button>
                    <div class="pro-tool-separator"></div>
                    <button class="pro-tool-btn" type="button" data-tool-command="count" title="Count"><i class="fas fa-circle-dot"></i></button>
                    <button class="pro-tool-btn" type="button" data-tool-command="linear" title="Linear"><i class="fas fa-grip-lines"></i></button>
                    <button class="pro-tool-btn" type="button" data-tool-command="area" title="Area"><i class="fas fa-draw-polygon"></i></button>
                    <button class="pro-tool-btn" type="button" data-tool-command="measure" title="Measure"><i class="fas fa-ruler-horizontal"></i></button>
                    <button class="pro-tool-btn" type="button" data-tool-command="text" title="Text"><i class="fas fa-font"></i></button>
                    <div class="pro-tool-separator"></div>
                    <button class="pro-tool-btn" type="button" data-tool-command="undo" title="Undo"><i class="fas fa-rotate-left"></i></button>
                    <button class="pro-tool-btn" type="button" data-tool-command="redo" title="Redo"><i class="fas fa-rotate-right"></i></button>
                    <button class="pro-tool-btn danger" type="button" data-tool-command="delete" title="Delete"><i class="fas fa-trash"></i></button>
                </aside>
            </div>
        </section>

        <section id="tab-estimating" class="tab-panel">
            <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3">
                <h2 class="mb-0 fw-bold">Estimating</h2>
                <div class="quick-actions">
                    <button class="btn-main"><i class="fas fa-plus"></i> Add Item</button>
                    <button class="btn-ghost"><i class="fas fa-link"></i> Link Takeoff Layer</button>
                    <button class="btn-ghost"><i class="fas fa-wand-magic-sparkles"></i> Create From Takeoff</button>
                    <button class="btn-ghost"><i class="fas fa-rotate"></i> Refresh Totals</button>
                    <button class="btn-ghost"><i class="fas fa-file-export"></i> Export</button>
                </div>
            </div>
            <div class="estimating-toolbar">
                <input type="search" placeholder="Search item" id="estimateSearch">
                <select><option>Group</option></select>
                <select><option>Source Type</option><option>takeoff</option><option>manual</option><option>catalog</option><option>assembly</option></select>
                <select><option>Cost Type</option></select>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Item</th><th>Assembly</th><th>Type</th><th>Unit</th><th>Qty</th><th>Unit Cost</th><th>Labor Hours</th><th>Material</th><th>Labor</th><th>Total</th><th>Waste</th><th>Markup</th><th>Source</th>
                        </tr>
                    </thead>
                    <tbody>
                    <?php if (empty($estimateItems)): ?>
                        <tr><td colspan="13" class="text-center text-secondary">No estimate items yet. Create estimate items from takeoff layers or add a manual item.</td></tr>
                    <?php else: ?>
                        <?php foreach ($estimateItems as $item): ?>
                            <tr>
                                <td><?= htmlspecialchars($item['name'] ?? '') ?></td>
                                <td><?= htmlspecialchars($item['catalog_item_name'] ?? $item['assembly_catalog_item_id'] ?? '') ?></td>
                                <td><?= htmlspecialchars($item['item_type'] ?? '') ?></td>
                                <td><?= htmlspecialchars($item['unit_of_measure'] ?? '') ?></td>
                                <td><?= number_format((float)($item['quantity'] ?? 0), 2) ?><?= ($item['source_type'] ?? '') === 'takeoff' ? ' locked' : '' ?></td>
                                <td><?= money_fmt((float)($item['unit_cost'] ?? 0)) ?></td>
                                <td><?= number_format((float)($item['labor_hours'] ?? 0), 2) ?></td>
                                <td><?= money_fmt((float)($item['material_cost'] ?? 0)) ?></td>
                                <td><?= money_fmt((float)($item['labor_cost'] ?? 0)) ?></td>
                                <td><strong><?= money_fmt((float)($item['total_cost'] ?? 0)) ?></strong></td>
                                <td><?= number_format((float)($item['waste_factor_percent'] ?? $item['waste_percentage'] ?? 0), 2) ?>%</td>
                                <td><?= number_format((float)($item['markup_percent'] ?? $item['margin_percentage'] ?? 0), 2) ?>%</td>
                                <td><?= htmlspecialchars($item['source_type'] ?? 'manual') ?></td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                    </tbody>
                </table>
            </div>
            <div class="grid totals-grid">
                <div class="card-panel"><div class="label">Material subtotal</div><div class="metric-value"><?= money_fmt($materialSubtotal) ?></div></div>
                <div class="card-panel"><div class="label">Labor subtotal</div><div class="metric-value"><?= money_fmt($laborSubtotal) ?></div></div>
                <div class="card-panel"><div class="label">Equipment subtotal</div><div class="metric-value"><?= money_fmt($equipmentSubtotal) ?></div></div>
                <div class="card-panel"><div class="label">Waste total</div><div class="metric-value"><?= money_fmt($wasteTotal) ?></div></div>
                <div class="card-panel"><div class="label">Markup total</div><div class="metric-value"><?= money_fmt($markupTotal) ?></div></div>
                <div class="card-panel"><div class="label">Estimate total</div><div class="metric-value"><?= money_fmt($estimateTotal) ?></div></div>
            </div>
        </section>

        <section id="tab-proposal" class="tab-panel">
            <div class="proposal-sheet">
                <div class="d-flex justify-content-between gap-3 flex-wrap">
                    <div>
                        <h2><?= htmlspecialchars($project['name']) ?></h2>
                        <div>Client: <?= htmlspecialchars($project['client_name'] ?? '') ?></div>
                    </div>
                    <div class="text-end">
                        <div><strong>Quote Number:</strong> <?= htmlspecialchars($proposals[0]['proposal_number'] ?? 'Draft') ?></div>
                        <div><strong>Date:</strong> <?= date('M d, Y') ?></div>
                    </div>
                </div>
                <div class="proposal-line mt-4"><strong>Scope of Work</strong><br>Placeholder for proposal scope.</div>
                <div class="proposal-line"><strong>Included</strong><br>Placeholder for included work and materials.</div>
                <div class="proposal-line"><strong>Excluded</strong><br>Placeholder for exclusions and assumptions.</div>
                <div class="proposal-line"><strong>Total Quoted Amount</strong><br><span style="font-size:1.6rem;font-weight:800;"><?= money_fmt($estimateTotal) ?></span></div>
                <div class="proposal-line"><strong>Acceptance / Signature</strong><br><br>Signature: ______________________________ Date: _______________</div>
            </div>
        </section>
    </main>
</div>

<input type="file" id="projectUploadInput" class="d-none">
<input type="file" id="documentsBrowseInput" class="d-none" multiple>

<script>
    window.ProjectState = <?= json_encode($state, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;

    const tabs = document.querySelectorAll('[data-tab]');
    const panels = document.querySelectorAll('.tab-panel');
    const docButtons = document.querySelectorAll('.doc-item');
    const previewFrame = document.getElementById('documentPreviewFrame');
    const downloadDocBtn = document.getElementById('downloadDocBtn');
    const takeoffFrame = document.getElementById('takeoffFrame');
    const takeoffEmpty = document.getElementById('takeoffEmpty');

    function setActiveTab(tab, push = true) {
        ProjectState.activeTab = tab;
        tabs.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
        panels.forEach(panel => panel.classList.toggle('active', panel.id === 'tab-' + tab));
        if (push) {
            const url = new URL(window.location.href);
            url.searchParams.set('tab', tab);
            if (ProjectState.selectedDocumentId) url.searchParams.set('file_id', ProjectState.selectedDocumentId);
            history.replaceState(ProjectState, '', url.toString());
        }
        if (tab === 'takeoff') {
            requestAnimationFrame(() => {
                const frame = document.getElementById('takeoffFrame');
                frame?.contentWindow?.postMessage({ type: 'takeoff-visible' }, '*');
            });
        }
    }

    function selectedDocument() {
        return ProjectState.documents.find(doc => Number(doc.id) === Number(ProjectState.selectedDocumentId));
    }

    function selectDocument(id) {
        ProjectState.selectedDocumentId = Number(id);
        ProjectState.selectedDrawingId = Number(id);
        const doc = selectedDocument();
        docButtons.forEach(btn => btn.classList.toggle('active', Number(btn.dataset.docId) === Number(id)));
        if (doc && previewFrame) {
            previewFrame.src = doc.path || 'about:blank';
            previewFrame.style.display = doc.path ? 'block' : 'none';
        }
        if (downloadDocBtn && doc) downloadDocBtn.href = doc.path || '#';
    }

    function setActiveDrawing() {
        const doc = selectedDocument();
        if (!doc) return;
        ProjectState.selectedDocumentId = Number(doc.id);
        ProjectState.selectedDrawingId = Number(doc.id);
        alert('Active drawing set to: ' + doc.filename);
    }

    function renameSelectedDocument() {
        const doc = selectedDocument();
        if (!doc) return;
        const nextName = prompt('Rename document', doc.filename);
        if (!nextName || nextName === doc.filename) return;
        alert('Rename is not wired to the API yet. Requested name: ' + nextName);
    }

    function deleteSelectedDocument() {
        const doc = selectedDocument();
        if (!doc) return;
        if (doc.source !== 'legacy_file') {
            alert('Delete is currently available for uploaded project files only.');
            return;
        }
        if (!confirm('Move this document to Recycle Bin?')) return;
        const fd = new FormData();
        fd.append('action', 'delete_entity');
        fd.append('type', 'file');
        fd.append('id', doc.id);
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if (res.status === 'success') location.reload();
                else alert('Delete failed: ' + (res.msg || 'Unknown error'));
            })
            .catch(() => alert('Delete failed.'));
    }

    function openSelectedInTakeoff() {
        const doc = selectedDocument();
        if (!doc || doc.source !== 'legacy_file') {
            alert('Select an uploaded drawing file to open in Takeoff.');
            return;
        }
        if (takeoffFrame) {
            takeoffFrame.src = 'editor.php?id=' + encodeURIComponent(doc.id) + '&embedded=1';
            takeoffFrame.style.display = 'block';
        }
        if (takeoffEmpty) takeoffEmpty.style.display = 'none';
        setActiveTab('takeoff');
    }

    tabs.forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.tab)));
    document.querySelectorAll('[data-action-tab]').forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.actionTab)));
    docButtons.forEach(btn => btn.addEventListener('click', () => selectDocument(btn.dataset.docId)));
    document.getElementById('openTakeoffBtn')?.addEventListener('click', openSelectedInTakeoff);
    document.getElementById('setActiveDrawingBtn')?.addEventListener('click', setActiveDrawing);
    document.getElementById('renameDocBtn')?.addEventListener('click', renameSelectedDocument);
    document.getElementById('deleteDocBtn')?.addEventListener('click', deleteSelectedDocument);

    document.querySelectorAll('.folder-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.folder-item').forEach(item => item.classList.remove('active'));
            btn.classList.add('active');
            const folder = btn.dataset.folder;
            docButtons.forEach(doc => {
                const isDrawing = ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(doc.dataset.extension);
                const visible = folder === 'all'
                    || (folder === 'drawings' && isDrawing)
                    || (folder === 'attachments' && !isDrawing)
                    || doc.dataset.folderId === folder;
                doc.style.display = visible ? 'flex' : 'none';
            });
        });
    });

    function openUploadModal() {
        if (!ProjectState.projectId) {
            alert('Save Project before uploading documents.');
            return;
        }
        const input = document.getElementById('projectUploadInput');
        if (input) input.click();
    }

    function openNewFolderModal() {
        if (!ProjectState.projectId) {
            alert('Save Project before creating folders.');
            return;
        }
        const name = prompt('Folder name');
        if (!name) return;
        const fd = new FormData();
        fd.append('action', 'create_folder');
        fd.append('project_id', ProjectState.projectId);
        fd.append('name', name);
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if (res.status === 'success') location.reload();
                else alert('Create folder failed: ' + (res.msg || 'Unknown error'));
            })
            .catch(() => alert('Create folder failed.'));
    }

    document.getElementById('projectUploadInput')?.addEventListener('change', function() {
        if (!this.files || !this.files.length) return;
        const fd = new FormData();
        fd.append('action', 'upload_file');
        fd.append('project_id', ProjectState.projectId);
        fd.append('file', this.files[0]);
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if (res.status === 'success') location.reload();
                else alert('Upload failed: ' + (res.msg || 'Unknown error'));
            })
            .catch(() => alert('Upload failed.'));
    });

    setActiveTab(ProjectState.activeTab || 'overview', false);
</script>
<script src="../assets/project_overview.js"></script>
<script src="../assets/project_takeoff.js"></script>
<script src="../assets/global_tools.js"></script>
</body>
</html>
