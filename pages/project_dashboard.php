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

function dash_valid_datetime(?string $value): ?DateTimeImmutable
{
    $value = trim((string)$value);
    if ($value === '') return null;
    try {
        $date = new DateTimeImmutable($value);
    } catch (Throwable $e) {
        return null;
    }
    $year = (int)$date->format('Y');
    if ($year < 2000 || $year > 2100) return null;
    return $date;
}

function dash_date_input_value(?string $value): string
{
    $date = dash_valid_datetime($value);
    return $date ? $date->format('Y-m-d') : '';
}

function dash_time_input_value(?string $value): string
{
    $date = dash_valid_datetime($value);
    return $date ? $date->format('H:i') : '';
}

function dash_due_label(?string $value): string
{
    $date = dash_valid_datetime($value);
    return $date ? $date->format('m/d/Y') : 'To be determined';
}

function dash_status_label(?string $status): string
{
    $labels = [
        'invitations' => 'Invitations',
        'to_do' => 'To Do',
        'draft' => 'To Do',
        'estimating' => 'Estimating',
        'bid_submitted' => 'Bid Submitted',
        'accepted' => 'Accepted',
        'in_progress' => 'In Progress',
        'complete' => 'Complete',
        'completed' => 'Complete',
        'estimators' => 'Estimadores',
        'estimadores' => 'Estimadores',
        'lost' => 'Lost',
        'archived' => 'Archived',
    ];
    $key = strtolower(trim((string)$status));
    $key = preg_replace('/[\s-]+/', '_', $key);
    return $labels[$key] ?? ucwords(str_replace('_', ' ', $key ?: 'to_do'));
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

$displayFolders = array_values(array_filter($folders, function ($folder) {
    $name = strtolower(trim((string)($folder['name'] ?? '')));
    return !in_array($name, ['drawings', 'attachments'], true);
}));
$statusLabel = dash_status_label($project['status'] ?? 'to_do');
$dueDateInput = dash_date_input_value($project['bid_due_at'] ?? null);
$dueTimeInput = dash_time_input_value($project['bid_due_at'] ?? null);
$dueLabel = dash_due_label($project['bid_due_at'] ?? null);
$projectNumberLabel = trim((string)($project['project_number'] ?? '')) !== '' ? (string)$project['project_number'] : '--';
$completionLabel = trim((string)($projectMeta['completion_percent'] ?? '')) !== '' ? rtrim((string)$projectMeta['completion_percent'], '%') . '% complete' : '0% complete';
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

// The Takeoff editor currently persists annotations against the legacy `files`
// record. A project_document can be previewed in Documents, but cannot be passed
// to editor.php by its unrelated id. Never leave the Takeoff iframe hidden/blank:
// fall back to the first compatible uploaded drawing for this project.
if ($activeTab === 'takeoff' && (!$selectedDoc || $selectedDoc['source'] !== 'legacy_file')) {
    foreach ($documents as $doc) {
        if ($doc['source'] === 'legacy_file' && in_array($doc['extension'], ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic'], true)) {
            $selectedDoc = $doc;
            $selectedDocumentId = (int)$doc['id'];
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
    'folders' => $displayFolders,
    'selectedDocumentId' => $selectedDocumentId,
    'selectedDrawingId' => $selectedDocumentId,
    'takeoffGroups' => [],
    'takeoffLayers' => $takeoffLayers,
    'takeoffMeasurements' => [],
    'estimateItems' => $estimateItems,
    'estimateTotals' => [
        'material' => $materialSubtotal,
        'labor' => $laborSubtotal,
        'equipment' => $equipmentSubtotal,
        'waste' => $wasteTotal,
        'markup' => $markupTotal,
        'total' => $estimateTotal,
    ],
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
    <script>
        (function () {
            try {
                var saved = localStorage.getItem('takeoff.theme');
                document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
            } catch (error) {
                document.documentElement.setAttribute('data-theme', 'light');
            }
        })();
    </script>
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
        .workspace-shell { height: calc(100dvh - 64px); min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
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
        .workspace-main { flex: 1; min-height: 0; overflow: hidden; }
        .tab-panel { display: none; padding: 24px; }
        .tab-panel.active { display: block; }
        .tab-panel.fullscreen { padding: 0; height: 100%; min-height: 0; overflow: hidden; }
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
    <link rel="stylesheet" href="../assets/project_overview.css?v=project-document-menus-20260811-1">
    <link rel="stylesheet" href="../assets/project_takeoff.css?v=workspace-takeoff-20260810-1">
    <link rel="stylesheet" href="../assets/project_estimating.css?v=estimating-modal-theme-20260812-1">
    <link rel="stylesheet" href="../assets/project_proposal.css?v=proposal-workspace-20260810-1">
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
                        <span id="projectStatusLabel"><?= htmlspecialchars($statusLabel) ?></span>
                        <i class="fas fa-chevron-down"></i>
                    </button>
                    <div class="project-status-menu" id="projectStatusMenu"></div>
                </div>
            </div>
            <p id="projectHeaderSubtitle"><?= $isDraftProject ? 'Unsaved draft' : htmlspecialchars('Project Workspace - ' . $statusLabel) ?></p>
            <div class="project-meta-line" id="projectMetaLine">
                <span><?= htmlspecialchars($completionLabel) ?></span>
                <span>Due: <?= htmlspecialchars($dueLabel) ?></span>
                <span>Estimator: <?= htmlspecialchars($estimatorName ?: 'Unassigned') ?></span>
                <span>Project #: <?= htmlspecialchars($projectNumberLabel) ?></span>
            </div>
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

    <nav class="top-tabs" aria-label="Project workspace tabs" role="tablist">
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
                                <input id="poDueDate" type="date" value="<?= htmlspecialchars($dueDateInput) ?>">
                            </label>
                            <label class="overview-field">Due Time
                                <input id="poDueTime" type="time" value="<?= htmlspecialchars($dueTimeInput) ?>">
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

        <section id="tab-documents" class="tab-panel documents-page">
            <div class="documents-layout pro-documents" id="documentsPage">
                <aside class="documents-sidebar" aria-label="Document folders">
                    <div class="documents-sidebar-head">
                        <h2>Folders</h2>
                        <div class="documents-menu-wrap">
                            <button class="documents-icon-btn" type="button" data-doc-folder-menu-toggle title="Folder options"><i class="fas fa-ellipsis-vertical"></i></button>
                            <div class="documents-menu" id="documentsFolderMenu">
                                <button type="button" data-doc-folder-action="create"><i class="fas fa-folder-plus"></i> Create folder</button>
                                <button type="button" data-doc-folder-action="rename"><i class="fas fa-pen"></i> Rename folder</button>
                                <button type="button" data-doc-folder-action="delete"><i class="fas fa-trash"></i> Delete folder</button>
                                <button type="button" data-doc-folder-action="sort"><i class="fas fa-arrow-down-a-z"></i> Sort folders</button>
                            </div>
                        </div>
                    </div>
                    <div class="documents-folder-tree" id="documentsFolderTree"></div>
                </aside>

                <section class="documents-content-panel" aria-label="Documents content">
                    <div class="documents-content-head">
                        <div>
                            <h2 id="documentsContentTitle">Custom Drawings</h2>
                            <span id="documentsContentSubtitle">Manage drawings and project attachments.</span>
                        </div>
                        <div class="documents-head-actions">
                            <button class="btn-ghost" type="button" id="documentsAutoRenameBtn"><i class="fas fa-grip"></i><span>Auto-rename</span></button>
                            <button class="btn-main" type="button" id="documentsStartTakeoffBtn"><i class="fas fa-ruler-combined"></i><span>Start Takeoff</span></button>
                            <button class="btn-main orange" type="button" id="documentsUploadBtn"><i class="fas fa-upload"></i><span>Upload</span></button>
                        </div>
                    </div>

                    <div class="documents-dropzone" id="documentsDropzone">
                        <div>
                            <strong>Drag and drop files here</strong>
                            <span>Upload drawings, attachments, specifications, or addenda for this project.</span>
                        </div>
                        <div class="documents-drop-actions">
                            <button class="btn-outline-dark" type="button" id="browseDrawingsBtn"><i class="fas fa-file-pdf"></i> Upload Drawings</button>
                            <button class="btn-outline-dark" type="button" id="browseAttachmentsBtn"><i class="fas fa-paperclip"></i> Upload Attachments</button>
                            <button class="btn-outline-dark" type="button" id="browseDocumentsBtn"><i class="fas fa-folder-open"></i> Browse files</button>
                        </div>
                    </div>

                    <div class="documents-toolbar">
                        <label class="documents-sort">
                            <span>Sort</span>
                            <select id="documentsSortBy">
                                <option value="custom">Custom</option>
                                <option value="name">Name</option>
                                <option value="uploadedAt">Upload Date</option>
                                <option value="pageCount">Page Count</option>
                                <option value="type">Type</option>
                            </select>
                        </label>
                        <button class="documents-icon-btn bordered" type="button" id="documentsSortDir" title="Toggle direction"><i class="fas fa-arrow-down-a-z"></i></button>
                        <div class="documents-search">
                            <input id="documentsSearch" type="search" placeholder="Search drawing">
                            <i class="fas fa-magnifying-glass"></i>
                        </div>
                        <label class="documents-zoom">
                            <i class="fas fa-magnifying-glass-minus"></i>
                            <input id="documentsZoom" type="range" min="0" max="2" step="1" value="1" aria-label="Document row density">
                            <i class="fas fa-magnifying-glass-plus"></i>
                        </label>
                        <div class="documents-menu-wrap">
                            <button class="documents-icon-btn bordered" type="button" data-doc-view-menu-toggle title="View options"><i class="fas fa-ellipsis-vertical"></i></button>
                            <div class="documents-menu align-right" id="documentsViewMenu">
                                <button type="button" data-doc-view-action="compact"><i class="fas fa-list"></i> Compact rows</button>
                                <button type="button" data-doc-view-action="comfortable"><i class="fas fa-table-cells-large"></i> Comfortable rows</button>
                            </div>
                        </div>
                    </div>

                    <div class="documents-list" id="documentsList"></div>
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
                        <button class="pro-icon-btn" type="button" data-takeoff-action="toggle-global-visibility" title="Show/hide all takeoffs" aria-label="Show/hide all takeoffs"><i class="fas fa-eye"></i></button>
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
                            <div class="pro-top-stat"><span>Page</span><strong id="takeoffTopPage">1 / 1</strong></div>
                            <div class="pro-top-stat"><span>Estimate</span><strong id="takeoffTopProgress">0% ready</strong></div>
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
                        <div class="pro-menu-wrap">
                            <button class="pro-actions-btn" type="button" data-takeoff-menu-toggle="takeoffWorkspaceActions">
                                <i class="fas fa-ellipsis-vertical"></i><span>Project actions</span><i class="fas fa-chevron-down"></i>
                            </button>
                            <div class="pro-menu" id="takeoffWorkspaceActions">
                                <button type="button" data-takeoff-action="upload-drawing"><i class="fas fa-cloud-arrow-up"></i> Upload drawing</button>
                                <button type="button" data-takeoff-action="save-workspace"><i class="fas fa-floppy-disk"></i> Save workspace</button>
                                <button type="button" data-takeoff-action="export-excel"><i class="fas fa-file-export"></i> Export quantities</button>
                                <button type="button" data-viewer-command="download"><i class="fas fa-download"></i> Download drawing</button>
                            </div>
                        </div>
                    </div>

                    <div class="pro-canvas-shell">
                        <?php if ($selectedDoc && $selectedDoc['source'] === 'legacy_file'): ?>
                            <iframe id="takeoffFrame" class="takeoff-frame pro-takeoff-frame" src="editor.php?id=<?= (int)$selectedDoc['id'] ?>&embedded=1&estimate_key=est_primary&inherit_legacy=1"></iframe>
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
                            <button class="pro-icon-btn" type="button" data-viewer-command="previous" title="Previous sheet"><i class="fas fa-chevron-left"></i></button>
                            <button class="pro-icon-btn" type="button" data-viewer-command="next" title="Next sheet"><i class="fas fa-chevron-right"></i></button>
                            <button class="pro-icon-btn" type="button" data-viewer-command="zoom-out" title="Zoom out"><i class="fas fa-minus"></i></button>
                            <input id="takeoffZoomSlider" type="range" min="25" max="400" value="100" aria-label="Zoom">
                            <span id="takeoffZoomPercent">100%</span>
                            <button class="pro-icon-btn" type="button" data-viewer-command="zoom-in" title="Zoom in"><i class="fas fa-plus"></i></button>
                            <button class="pro-chip-btn" type="button" data-viewer-command="fit">Fit</button>
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

                <aside class="pro-takeoff-inspector" aria-label="Takeoff tools and properties">
                    <div class="pro-inspector-head">
                        <div><strong>Takeoff inspector</strong><small>Tools & properties</small></div>
                        <button class="pro-icon-btn" type="button" id="toggleTakeoffInspector" title="Collapse inspector" aria-label="Collapse inspector">
                            <i class="fas fa-angles-right"></i>
                        </button>
                    </div>
                    <div class="pro-inspector-tools">
                        <div class="pro-tools-bar" aria-label="Takeoff tools">
                            <button class="pro-tool-btn active" type="button" data-tool-command="smart" title="Select"><i class="fas fa-mouse-pointer"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="pan" title="Pan"><i class="fas fa-hand"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="multi-select" title="Rectangle Select"><i class="fas fa-object-group"></i></button>
                            <div class="pro-tool-separator"></div>
                            <button class="pro-tool-btn" type="button" data-tool-command="count" title="Count"><i class="fas fa-circle-dot"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="linear" title="Linear"><i class="fas fa-grip-lines"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="area" title="Area"><i class="fas fa-draw-polygon"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="measure" title="Measure"><i class="fas fa-ruler-horizontal"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="freehand" title="Freehand"><i class="fas fa-signature"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="text" title="Note"><i class="fas fa-note-sticky"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="cloud" title="Cloud"><i class="fas fa-cloud"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="pin" title="Pin"><i class="fas fa-location-dot"></i></button>
                            <div class="pro-tool-separator"></div>
                            <button class="pro-tool-btn" type="button" data-tool-command="undo" title="Undo"><i class="fas fa-rotate-left"></i></button>
                            <button class="pro-tool-btn" type="button" data-tool-command="redo" title="Redo"><i class="fas fa-rotate-right"></i></button>
                            <button class="pro-tool-btn danger" type="button" data-tool-command="delete" title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                        <div class="pro-inspector-content" id="takeoffInspectorContent"></div>
                    </div>
                </aside>
                <footer class="est-version-bar" id="takeoffEstimateTypesFooter" aria-label="Available estimates">
                    <span class="est-pill">Loading estimates&hellip;</span>
                </footer>
            </div>
        </section>

        <section id="tab-estimating" class="tab-panel fullscreen estimating-page">
            <div id="estimatingModule" class="est-shell est-v2" data-project-id="<?= (int)$projectId ?>">
                <div class="est-main">
                <section class="est-left" aria-label="Estimate cost items">
                    <div class="est-toolbar">
                        <label class="est-search" for="estSearch">
                            <i class="fas fa-search"></i>
                            <input id="estSearch" type="search" placeholder="Search cost item">
                        </label>
                        <button class="est-btn est-btn-primary" type="button" data-est-action="create-group" title="Create group"><i class="fas fa-folder-plus"></i><span>Create group</span></button>
                        <div class="est-menu-wrap">
                            <button class="est-icon-btn" type="button" data-est-action="columns" title="Adjust columns"><i class="fas fa-sliders"></i></button>
                            <div class="est-menu" id="columnMenu"></div>
                        </div>
                        <button class="est-icon-btn" type="button" data-est-action="fullscreen" title="Full screen"><i class="fas fa-expand"></i></button>
                        <div class="est-menu-wrap">
                            <button class="est-icon-btn" type="button" data-est-action="options" title="Options"><i class="fas fa-ellipsis-vertical"></i></button>
                            <div class="est-menu" id="optionsMenu">
                                <button type="button" data-est-option="save"><i class="fas fa-floppy-disk"></i> Save estimate</button>
                                <button type="button" data-est-option="copy"><i class="fas fa-copy"></i> Copy estimate</button>
                                <button type="button" data-est-option="status"><i class="fas fa-circle-check"></i> Change project status</button>
                                <button type="button" data-est-option="import"><i class="fas fa-file-import"></i> Import</button>
                                <button type="button" data-est-option="export"><i class="fas fa-file-export"></i> Export</button>
                                <button type="button" data-est-option="delete-estimate" class="danger"><i class="fas fa-trash"></i> Delete estimate</button>
                            </div>
                        </div>
                        <button class="est-btn" type="button" data-est-action="reset-quantities" title="Reset quantities"><i class="fas fa-rotate-left"></i><span>Reset Quantities</span></button>
                        <button class="est-btn est-btn-danger" type="button" data-est-action="delete-selected" disabled><i class="fas fa-trash"></i><span>Delete</span></button>
                    </div>
                    <div class="est-table-wrap"><table class="est-table" aria-label="Estimate items table"><thead id="estTableHead"></thead><tbody id="estTableBody"></tbody></table></div>
                    <button class="est-create-bottom" type="button" data-est-action="create-group"><i class="fas fa-folder-plus"></i> Create new group</button>
                </section>
                <aside class="est-right" aria-label="Estimate notes and summary">
                    <div class="est-right-scroll">
                        <section class="est-card" id="notesCard">
                            <button class="est-card-header" type="button" data-collapse-card="notesCollapsed"><span><i class="fas fa-chevron-down"></i> Notes</span></button>
                            <div class="est-card-body">
                                <div class="est-field-block"><div class="est-label">Scope of Work</div><div class="est-editor-toolbar" data-toolbar="scope"><button type="button" data-editor-cmd="undo" title="Undo"><i class="fas fa-rotate-left"></i></button><button type="button" data-editor-cmd="redo" title="Redo"><i class="fas fa-rotate-right"></i></button><select data-editor-format="formatBlock" aria-label="Text style"><option value="P">Paragraph</option><option value="H3">Heading</option></select><button type="button" data-editor-cmd="bold" title="Bold"><i class="fas fa-bold"></i></button><button type="button" data-editor-cmd="italic" title="Italic"><i class="fas fa-italic"></i></button><button type="button" data-editor-cmd="insertHorizontalRule" title="Line"><i class="fas fa-minus"></i></button><button type="button" data-editor-cmd="backColor" data-editor-value="#dbeafe" title="Highlight"><i class="fas fa-fill-drip"></i></button><button type="button" data-editor-cmd="justifyLeft" title="Align left"><i class="fas fa-align-left"></i></button><button type="button" data-editor-cmd="justifyCenter" title="Align center"><i class="fas fa-align-center"></i></button><button type="button" data-editor-cmd="justifyRight" title="Align right"><i class="fas fa-align-right"></i></button><button type="button" data-editor-cmd="justifyFull" title="Justify"><i class="fas fa-align-justify"></i></button><button type="button" data-editor-cmd="insertUnorderedList" title="Bullets"><i class="fas fa-list-ul"></i></button><button type="button" data-editor-cmd="insertOrderedList" title="Numbers"><i class="fas fa-list-ol"></i></button><button type="button" data-editor-cmd="outdent" title="Outdent"><i class="fas fa-outdent"></i></button><button type="button" data-editor-cmd="indent" title="Indent"><i class="fas fa-indent"></i></button><button type="button" data-editor-cmd="removeFormat" title="Clear"><i class="fas fa-eraser"></i></button></div><div id="scopeEditor" class="est-rich-editor" contenteditable="true" data-editor="scope"></div></div>
                                <div class="est-field-block"><div class="est-list-head"><div class="est-label">Included</div><div><button class="est-small-btn" type="button" data-est-action="browse-library">Browse library</button><button class="est-small-btn" type="button" data-est-action="add-included"><i class="fas fa-plus"></i></button></div></div><div id="includedList" class="est-free-list"></div></div>
                                <div class="est-field-block"><div class="est-list-head"><div class="est-label">Excluded</div><div><button class="est-small-btn" type="button" data-est-action="browse-library">Browse library</button><button class="est-small-btn" type="button" data-est-action="add-excluded"><i class="fas fa-plus"></i></button></div></div><div id="excludedList" class="est-free-list"></div></div>
                                <div class="est-field-block"><div class="est-label">Project Notes</div><div class="est-editor-toolbar" data-toolbar="projectNotes"><button type="button" data-editor-cmd="undo" title="Undo"><i class="fas fa-rotate-left"></i></button><button type="button" data-editor-cmd="redo" title="Redo"><i class="fas fa-rotate-right"></i></button><select data-editor-format="formatBlock" aria-label="Text style"><option value="P">Paragraph</option><option value="H3">Heading</option></select><button type="button" data-editor-cmd="bold" title="Bold"><i class="fas fa-bold"></i></button><button type="button" data-editor-cmd="italic" title="Italic"><i class="fas fa-italic"></i></button><button type="button" data-editor-cmd="insertHorizontalRule" title="Line"><i class="fas fa-minus"></i></button><button type="button" data-editor-cmd="backColor" data-editor-value="#dbeafe" title="Highlight"><i class="fas fa-fill-drip"></i></button><button type="button" data-editor-cmd="justifyLeft" title="Align left"><i class="fas fa-align-left"></i></button><button type="button" data-editor-cmd="justifyCenter" title="Align center"><i class="fas fa-align-center"></i></button><button type="button" data-editor-cmd="justifyRight" title="Align right"><i class="fas fa-align-right"></i></button><button type="button" data-editor-cmd="justifyFull" title="Justify"><i class="fas fa-align-justify"></i></button><button type="button" data-editor-cmd="insertUnorderedList" title="Bullets"><i class="fas fa-list-ul"></i></button><button type="button" data-editor-cmd="insertOrderedList" title="Numbers"><i class="fas fa-list-ol"></i></button><button type="button" data-editor-cmd="outdent" title="Outdent"><i class="fas fa-outdent"></i></button><button type="button" data-editor-cmd="indent" title="Indent"><i class="fas fa-indent"></i></button><button type="button" data-editor-cmd="removeFormat" title="Clear"><i class="fas fa-eraser"></i></button></div><div id="projectNotesEditor" class="est-rich-editor" contenteditable="true" data-editor="projectNotes"></div></div>
                            </div>
                        </section>
                        <section class="est-card" id="summaryCard"><button class="est-card-header" type="button" data-collapse-card="summaryCollapsed"><span><i class="fas fa-chevron-down"></i> Summary</span></button><div class="est-card-body"><div class="est-rate-grid"><label>Global labor cost <input id="globalLaborCost" type="number" min="0" step="0.01"></label><label>Global labor sales rate <input id="globalLaborSales" type="number" min="0" step="0.01"></label><button class="est-small-btn" type="button" data-labor-unit>mins</button></div><div class="est-summary-table-wrap"><table class="est-summary-table"><thead><tr><th>Catalog Item Type</th><th>Total Labor</th><th>Difficulty</th><th>Waste</th><th>Total Cost</th><th>Margin</th><th>Total Sales</th><th>Profit</th></tr></thead><tbody id="summaryTypes"></tbody></table></div><div class="est-summary-section"><div class="est-summary-title"><span>Pre-Tax Markups</span><button type="button" data-est-action="add-pre-markup"><i class="fas fa-plus"></i></button></div><div id="preMarkupRows" class="est-markup-list"></div></div><div class="est-summary-section"><div class="est-summary-title"><span>Taxes</span><button type="button" data-est-option="taxes"><i class="fas fa-pen"></i></button></div><div id="taxRows" class="est-markup-list"></div></div><div class="est-summary-section"><div class="est-summary-title"><span>Post-Tax Markups</span><button type="button" data-est-action="add-post-markup"><i class="fas fa-plus"></i></button></div><div id="postMarkupRows" class="est-markup-list"></div></div></div></section>
                    </div>
                    <div class="est-total-box"><div class="est-total-label">Estimate Total</div><div id="estimateTotal" class="est-total-value">$0.00</div><div id="estimateSqft" class="est-total-sub">--/sq ft</div></div>
                </aside>
                </div>
                <div class="est-version-bar" id="versionBar"></div>
            </div>
        </section>
        <section id="tab-proposal" class="tab-panel proposal-page">
            <div id="proposalModule" class="proposal-shell" data-project-id="<?= (int)$projectId ?>">
                <aside class="proposal-settings" aria-label="Proposal detail settings">
                    <div class="proposal-settings-head">
                        <div>
                            <h2>Detail Settings</h2>
                            <span>Proposal</span>
                        </div>
                        <div class="proposal-export-wrap">
                            <button class="proposal-export-btn" type="button" data-proposal-export-toggle>
                                <i class="fas fa-file-export"></i><span>Export</span><i class="fas fa-chevron-down"></i>
                            </button>
                            <div class="proposal-export-menu" id="proposalExportMenu">
                                <button type="button" data-proposal-export="pdf">Export PDF</button>
                                <button type="button" data-proposal-export="docx">Export DOCX</button>
                                <button type="button" data-proposal-export="preview">Export Preview</button>
                            </div>
                        </div>
                    </div>
                    <div class="proposal-settings-scroll">
                        <div id="proposalSettingsPanel"></div>
                    </div>
                </aside>
                <main class="proposal-preview-area" aria-label="Proposal preview">
                    <div class="proposal-builder-note" id="proposalBuilderNote" hidden>Proposal Builder is ready to be connected.</div>
                    <div class="proposal-feature-banner" id="proposalFeatureBanner">
                        <span>Enhanced Itemization in Proposal tab - Easily update proposals with: itemized alternates &amp; assembly items, new customer/contact selection, and new toggles to setup proposal.</span>
                        <button type="button" data-proposal-learn>Learn More</button>
                        <button type="button" data-proposal-dismiss-banner aria-label="Dismiss">x</button>
                    </div>
                    <div class="proposal-document" id="proposalDocument"></div>
                </main>
                <footer class="est-version-bar" id="proposalEstimateTypesFooter" aria-label="Available estimates">
                    <span class="est-pill">Loading estimates&hellip;</span>
                </footer>
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

    tabs.forEach(btn => {
        const panelId = 'tab-' + btn.dataset.tab;
        btn.id = btn.id || 'workspace-tab-' + btn.dataset.tab;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-controls', panelId);
        document.getElementById(panelId)?.setAttribute('role', 'tabpanel');
        document.getElementById(panelId)?.setAttribute('aria-labelledby', btn.id);
    });

    function setActiveTab(tab, push = true) {
        ProjectState.activeTab = tab;
        const scrollTabs = ['overview'];
        document.querySelector('.workspace-shell')?.classList.toggle('workspace-scroll-mode', scrollTabs.includes(tab));
        tabs.forEach(btn => {
            const active = btn.dataset.tab === tab;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            btn.tabIndex = active ? 0 : -1;
        });
        panels.forEach(panel => {
            const active = panel.id === 'tab-' + tab;
            panel.classList.toggle('active', active);
            panel.hidden = !active;
        });
        if (push) {
            const url = new URL(window.location.href);
            url.searchParams.set('tab', tab);
            if (ProjectState.selectedDocumentId) url.searchParams.set('file_id', ProjectState.selectedDocumentId);
            history.pushState({ ...ProjectState }, '', url.toString());
        }
        if (tab === 'takeoff') {
            let drawing = selectedDocument();
            if (!drawing || drawing.source !== 'legacy_file') {
                drawing = ProjectState.documents.find(doc => doc.source === 'legacy_file' && ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic'].includes(String(doc.extension || '').toLowerCase()));
                if (drawing) {
                    ProjectState.selectedDocumentId = Number(drawing.id);
                    ProjectState.selectedDrawingId = Number(drawing.id);
                    docButtons.forEach(button => button.classList.toggle('active', Number(button.dataset.docId) === Number(drawing.id)));
                }
            }
            if (drawing && takeoffFrame) {
                const expectedSrc = window.projectTakeoffEditorUrl
                    ? window.projectTakeoffEditorUrl(drawing.id)
                    : 'editor.php?id=' + encodeURIComponent(drawing.id) + '&embedded=1';
                if (!takeoffFrame.getAttribute('src') || !takeoffFrame.getAttribute('src').includes('id=' + encodeURIComponent(drawing.id))) {
                    takeoffFrame.src = expectedSrc;
                }
                takeoffFrame.style.display = 'block';
                if (takeoffEmpty) takeoffEmpty.style.display = 'none';
            }
            requestAnimationFrame(() => {
                const frame = document.getElementById('takeoffFrame');
                frame?.contentWindow?.postMessage({ type: 'takeoff-visible' }, '*');
                setTimeout(() => window.projectTakeoffFitToScreen?.(), 220);
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
            takeoffFrame.src = window.projectTakeoffEditorUrl
                ? window.projectTakeoffEditorUrl(doc.id)
                : 'editor.php?id=' + encodeURIComponent(doc.id) + '&embedded=1';
            takeoffFrame.style.display = 'block';
            takeoffFrame.addEventListener('load', () => {
                takeoffFrame.contentWindow?.postMessage({ type: 'takeoff-visible' }, '*');
            }, { once: true });
        }
        if (takeoffEmpty) takeoffEmpty.style.display = 'none';
        setActiveTab('takeoff');
    }

    tabs.forEach((btn, index) => {
        btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
        btn.addEventListener('keydown', event => {
            let next = null;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = tabs.length - 1;
            if (next === null) return;
            event.preventDefault();
            tabs[next].focus();
            setActiveTab(tabs[next].dataset.tab);
        });
    });
    window.addEventListener('popstate', () => {
        const tab = new URL(window.location.href).searchParams.get('tab') || 'overview';
        if ([...tabs].some(btn => btn.dataset.tab === tab)) setActiveTab(tab, false);
    });
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
<script src="../assets/project_overview.js?v=project-documents-persistence-20260811-6"></script>
<script src="../assets/takeoff_estimating_sync_service.js?v=takeoff-estimating-sync-20260803-1"></script>
<script src="../assets/project_estimate_footer.js?v=estimate-footer-20260810-1"></script>
<script src="../assets/project_takeoff.js?v=takeoff-estimate-isolation-20260820-2"></script>
<script src="../assets/estimate_calculation_service.js?v=estimating-calculation-audit-20260811-1"></script>
<script src="../assets/estimating_export_service.js?v=estimating-boq-export-20260820-1"></script>
<script src="../assets/estimating_workspace_service.js?v=estimating-delete-20260820-3"></script>
<script src="../assets/project_estimating.js?v=estimating-delete-20260820-3"></script>
<script src="../assets/project_proposal.js?v=proposal-workspace-20260810-4"></script>
<script src="../assets/global_tools.js"></script>
</body>
</html>
