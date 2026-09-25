<?php
require_once __DIR__ . '/../core/db/connection.php';

$projectId = (int) ($_GET['id'] ?? $_GET['project_id'] ?? 0);
$isDraftProject = $projectId <= 0 && isset($_GET['draft']);
$activeTab = $_GET['tab'] ?? 'overview';
$selectedDocumentId = (int) ($_GET['file_id'] ?? $_GET['document_id'] ?? 0);

function dash_table_exists(PDO $pdo, string $table): bool
{
    try {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?");
        $stmt->execute([$table]);
        return (int) $stmt->fetchColumn() > 0;
    } catch (Throwable $e) {
        return false;
    }
}

function dash_column_exists(PDO $pdo, string $table, string $column): bool
{
    try {
        $stmt = $pdo->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
        $stmt->execute([$column]);
        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return false;
    }
}

function dash_public_path(?string $path): string
{
    $path = str_replace('\\', '/', (string) $path);
    if ($path === '')
        return '';
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
    $value = trim((string) $value);
    if ($value === '')
        return null;
    try {
        $date = new DateTimeImmutable($value);
    } catch (Throwable $e) {
        return null;
    }
    $year = (int) $date->format('Y');
    if ($year < 2000 || $year > 2100)
        return null;
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
    $key = strtolower(trim((string) $status));
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
        'project_template_id' => isset($_GET['template_id']) ? (int) $_GET['template_id'] : null,
        'project_number' => '',
        'name' => trim((string) ($_GET['name'] ?? '')) ?: 'New Project',
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
        $ext = strtolower(pathinfo((string) $file['filename'], PATHINFO_EXTENSION));
        $documents[] = [
            'id' => (int) $file['id'],
            'source' => 'legacy_file',
            'folder_id' => isset($file['folder_id']) ? (int) $file['folder_id'] : null,
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
        $ext = strtolower(pathinfo((string) $doc['original_filename'], PATHINFO_EXTENSION));
        $documents[] = [
            'id' => (int) $doc['id'],
            'source' => 'project_document',
            'folder_id' => isset($doc['document_folder_id']) ? (int) $doc['document_folder_id'] : null,
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
            $selectedDocumentId = (int) $doc['id'];
            break;
        }
    }
    if ($selectedDocumentId === 0) {
        $selectedDocumentId = (int) $documents[0]['id'];
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

$takeoffLocations = [];
if (!empty($takeoffLayers)) {
    $layerMapById = [];
    foreach ($takeoffLayers as $tl) {
        $layerMapById[(int) $tl['id']] = $tl;
    }
    $layerIds = array_keys($layerMapById);
    $inPlaceholders = implode(',', array_fill(0, count($layerIds), '?'));

    if (dash_table_exists($pdo, 'takeoff_count_markers')) {
        try {
            $stmtM = $pdo->prepare("
                SELECT layer_id, page_number, COUNT(id) AS mark_count, SUM(quantity * COALESCE(multiplier, 1)) AS total_qty
                FROM takeoff_count_markers
                WHERE layer_id IN ($inPlaceholders)
                GROUP BY layer_id, page_number
            ");
            $stmtM->execute($layerIds);
            foreach ($stmtM->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $lid = (int) $row['layer_id'];
                $pg = (int) $row['page_number'];
                if (!isset($takeoffLocations[$lid])) {
                    $tl = $layerMapById[$lid] ?? [];
                    $takeoffLocations[$lid] = [
                        'layerId' => $lid,
                        'drawingId' => (int) ($tl['drawing_id'] ?? 0),
                        'name' => $tl['name'] ?? '',
                        'color' => $tl['color'] ?? '#2563eb',
                        'symbol' => $tl['symbol'] ?? 'circle',
                        'type' => $tl['type'] ?? 'count',
                        'uom' => $tl['unit_of_measure'] ?? 'ea',
                        'pages' => []
                    ];
                }
                $takeoffLocations[$lid]['pages'][$pg] = [
                    'count' => (int) $row['mark_count'],
                    'quantity' => (float) $row['total_qty']
                ];
            }
        } catch (Throwable $e) {
            // Tolerate schema variations in older environments
        }
    }

    if (dash_table_exists($pdo, 'takeoff_linear_segments')) {
        try {
            $stmtS = $pdo->prepare("
                SELECT layer_id, page_number, COUNT(id) AS mark_count, SUM(total_length * COALESCE(multiplier, 1)) AS total_qty
                FROM takeoff_linear_segments
                WHERE layer_id IN ($inPlaceholders)
                GROUP BY layer_id, page_number
            ");
            $stmtS->execute($layerIds);
            foreach ($stmtS->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $lid = (int) $row['layer_id'];
                $pg = (int) $row['page_number'];
                if (!isset($takeoffLocations[$lid])) {
                    $tl = $layerMapById[$lid] ?? [];
                    $takeoffLocations[$lid] = [
                        'layerId' => $lid,
                        'drawingId' => (int) ($tl['drawing_id'] ?? 0),
                        'name' => $tl['name'] ?? '',
                        'color' => $tl['color'] ?? '#2563eb',
                        'symbol' => $tl['symbol'] ?? 'circle',
                        'type' => $tl['type'] ?? 'linear',
                        'uom' => $tl['unit_of_measure'] ?? 'ft',
                        'pages' => []
                    ];
                }
                if (isset($takeoffLocations[$lid]['pages'][$pg])) {
                    $takeoffLocations[$lid]['pages'][$pg]['count'] += (int) $row['mark_count'];
                    $takeoffLocations[$lid]['pages'][$pg]['quantity'] += (float) $row['total_qty'];
                } else {
                    $takeoffLocations[$lid]['pages'][$pg] = [
                        'count' => (int) $row['mark_count'],
                        'quantity' => (float) $row['total_qty']
                    ];
                }
            }
        } catch (Throwable $e) {
            // Tolerate schema variations in older environments
        }
    }
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
    $stmt->execute([(int) $project['estimator_id']]);
    $estimatorName = $stmt->fetchColumn() ?: 'Unassigned';
}

$availableEstimators = [];
if (dash_table_exists($pdo, 'estimators')) {
    try {
        $stmt = $pdo->query("SELECT id, display_name AS name, trade AS role FROM estimators WHERE deleted_at IS NULL ORDER BY display_name ASC");
        $availableEstimators = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable $e) {}
}
if (dash_table_exists($pdo, 'users')) {
    try {
        $stmt = $pdo->query("SELECT id, username AS name, role FROM users ORDER BY username ASC");
        $uRows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
        $existing = array_map(fn($e) => strtolower(trim($e['name'])), $availableEstimators);
        foreach ($uRows as $ur) {
            if (!in_array(strtolower(trim($ur['name'])), $existing, true)) {
                $availableEstimators[] = [
                    'id' => (int) $ur['id'],
                    'name' => $ur['name'],
                    'role' => ucfirst($ur['role'] ?? 'Member')
                ];
            }
        }
    } catch (Throwable $e) {}
}
if (empty($availableEstimators)) {
    $availableEstimators = [
        ['id' => 1, 'name' => 'Isaac Diaz', 'role' => 'Lead Estimator'],
        ['id' => 2, 'name' => 'Juan Estevez', 'role' => 'Chief Estimator'],
        ['id' => 3, 'name' => 'Carlos Rodriguez', 'role' => 'Project Manager'],
        ['id' => 4, 'name' => 'Sarah Jenkins', 'role' => 'Senior Estimator'],
        ['id' => 5, 'name' => 'Michael Chang', 'role' => 'Civil Estimator'],
        ['id' => 6, 'name' => 'Elena Rostova', 'role' => 'Electrical Estimator'],
        ['id' => 7, 'name' => 'David Miller', 'role' => 'Mechanical Estimator'],
        ['id' => 8, 'name' => 'Amanda Brooks', 'role' => 'Commercial Estimator'],
        ['id' => 9, 'name' => 'Marcus Vance', 'role' => 'Structural Estimator'],
        ['id' => 10, 'name' => 'Ana Lopez', 'role' => 'Estimating Coordinator']
    ];
}

$projectMeta = [];
if (!empty($project['metadata_json'])) {
    $decodedMeta = json_decode((string) $project['metadata_json'], true);
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
$customerAddress = $projectMeta['customer_address'] ?? '';
$projectNotes = is_array($projectMeta['notes'] ?? null) ? $projectMeta['notes'] : [];
$projectTasks = is_array($projectMeta['tasks'] ?? null) ? $projectMeta['tasks'] : [];

$materialSubtotal = 0.0;
$laborSubtotal = 0.0;
$equipmentSubtotal = 0.0;
$wasteTotal = 0.0;
$markupTotal = 0.0;
$estimateTotal = 0.0;
foreach ($estimateItems as $item) {
    $materialSubtotal += (float) ($item['material_cost'] ?? 0);
    $laborSubtotal += (float) ($item['labor_cost'] ?? 0);
    $equipmentSubtotal += (float) ($item['equipment_cost'] ?? 0);
    $estimateTotal += (float) ($item['total_cost'] ?? $item['subtotal_cost'] ?? 0);
    $wasteTotal += ((float) ($item['subtotal_cost'] ?? 0)) * ((float) ($item['waste_factor_percent'] ?? $item['waste_percentage'] ?? 0) / 100);
    $markupTotal += ((float) ($item['subtotal_cost'] ?? 0)) * ((float) ($item['markup_percent'] ?? $item['margin_percentage'] ?? 0) / 100);
}

$displayFolders = array_values(array_filter($folders, function ($folder) {
    $name = strtolower(trim((string) ($folder['name'] ?? '')));
    return !in_array($name, ['drawings', 'attachments'], true);
}));
$statusLabel = dash_status_label($project['status'] ?? 'to_do');
$dueDateInput = dash_date_input_value($project['bid_due_at'] ?? null);
$dueTimeInput = dash_time_input_value($project['bid_due_at'] ?? null);
$dueLabel = dash_due_label($project['bid_due_at'] ?? null);
$projectNumberLabel = trim((string) ($project['project_number'] ?? '')) !== '' ? (string) $project['project_number'] : '--';
$completionLabel = trim((string) ($projectMeta['completion_percent'] ?? '')) !== '' ? rtrim((string) $projectMeta['completion_percent'], '%') . '% complete' : '0% complete';
$proposalStatus = $proposals[0]['status'] ?? 'Not started';
$selectedDoc = null;
foreach ($documents as $doc) {
    if ((int) $doc['id'] === $selectedDocumentId && $doc['source'] === 'legacy_file') {
        $selectedDoc = $doc;
        break;
    }
}
if (!$selectedDoc) {
    foreach ($documents as $doc) {
        if ((int) $doc['id'] === $selectedDocumentId) {
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
            $selectedDocumentId = (int) $doc['id'];
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
    'takeoffLocations' => $takeoffLocations,
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
    'availableEstimators' => $availableEstimators,
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
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap"
        rel="stylesheet">
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
        a {
            color: inherit;
        }

        .grid {
            display: grid;
            gap: 16px;
        }

        .overview-grid {
            grid-template-columns: repeat(12, minmax(0, 1fr));
        }

        .card-panel {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 18px;
            min-width: 0;
        }

        .card-panel h2,
        .card-panel h3 {
            margin: 0 0 14px;
            font-size: 1rem;
            font-weight: 800;
        }

        .span-3 {
            grid-column: span 3;
        }

        .span-4 {
            grid-column: span 4;
        }

        .span-6 {
            grid-column: span 6;
        }

        .span-8 {
            grid-column: span 8;
        }

        .span-12 {
            grid-column: span 12;
        }

        .metric-value {
            font-size: 1.6rem;
            font-weight: 800;
            color: #60a5fa;
        }

        .label {
            color: var(--muted);
            font-size: .78rem;
            text-transform: uppercase;
            letter-spacing: .04em;
        }

        .value {
            font-weight: 700;
            color: var(--text);
        }

        .info-list {
            display: grid;
            gap: 12px;
        }

        .info-row {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            border-bottom: 1px solid rgba(255, 255, 255, .06);
            padding-bottom: 10px;
        }

        .btn-main,
        .btn-ghost {
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

        .btn-main {
            background: var(--primary);
            color: #fff;
        }

        .btn-ghost {
            background: rgba(255, 255, 255, .07);
            color: var(--text);
            border: 1px solid var(--line);
        }

        .btn-ghost:disabled {
            opacity: .45;
            cursor: not-allowed;
        }

        .quick-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .documents-layout {
            display: grid;
            grid-template-columns: 260px minmax(280px, 430px) 1fr;
            gap: 16px;
            height: calc(100vh - 177px);
            min-height: 580px;
        }

        .folder-list,
        .document-list {
            overflow: auto;
        }

        .folder-item,
        .doc-item {
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

        .folder-item:hover,
        .doc-item:hover {
            background: rgba(255, 255, 255, .05);
        }

        .folder-item.active,
        .doc-item.active {
            background: rgba(37, 99, 235, .18);
            border-color: rgba(96, 165, 250, .35);
        }

        .doc-title {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 700;
        }

        .doc-meta {
            color: var(--muted);
            font-size: .78rem;
        }

        .preview-frame,
        .takeoff-frame {
            width: 100%;
            height: 100%;
            border: 0;
            background: #0f172a;
            border-radius: 8px;
        }

        .preview-empty,
        .takeoff-empty {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            color: var(--muted);
            border: 1px dashed var(--line);
            border-radius: 8px;
        }

        .takeoff-workspace {
            height: 100%;
            background: #0f172a;
        }

        .estimating-toolbar {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 16px;
        }

        .estimating-toolbar input,
        .estimating-toolbar select {
            background: var(--card);
            color: var(--text);
            border: 1px solid var(--line);
            border-radius: 6px;
            padding: 10px 12px;
        }

        .table-wrap {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 8px;
            overflow: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            min-width: 980px;
        }

        th,
        td {
            padding: 12px 14px;
            border-bottom: 1px solid rgba(255, 255, 255, .07);
            text-align: left;
            vertical-align: middle;
        }

        th {
            color: #93c5fd;
            background: rgba(37, 99, 235, .16);
            font-size: .78rem;
            text-transform: uppercase;
        }

        td {
            color: #e2e8f0;
        }

        .totals-grid {
            grid-template-columns: repeat(6, minmax(150px, 1fr));
            margin-top: 16px;
        }

        .proposal-sheet {
            max-width: 920px;
            margin: 0 auto;
            background: #f8fafc;
            color: #0f172a;
            border-radius: 8px;
            padding: 32px;
        }

        .proposal-sheet h2 {
            margin: 0;
            font-weight: 800;
        }

        .proposal-line {
            border-bottom: 1px solid #cbd5e1;
            padding: 12px 0;
        }

        @media (max-width: 1100px) {
            .documents-layout {
                grid-template-columns: 220px 1fr;
                height: auto;
            }

            .documents-layout .preview-card {
                grid-column: 1 / -1;
                min-height: 560px;
            }

            .span-3,
            .span-4,
            .span-6,
            .span-8 {
                grid-column: span 12;
            }

            .totals-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (max-width: 720px) {
            .project-header {
                align-items: flex-start;
                flex-direction: column;
            }

            .tab-panel {
                padding: 16px;
            }

            .documents-layout {
                grid-template-columns: 1fr;
            }

            .totals-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
    <link rel="stylesheet" href="../assets/project_overview.css?v=doc-modal-confirm-20260925-4">
    <link rel="stylesheet" href="../assets/project_takeoff.css?v=takeoff-group-modal-20260831-1">
    <link rel="stylesheet" href="../assets/project_estimating.css?v=estimating-assembly-hierarchy-20260902-1">
    <link rel="stylesheet" href="../assets/project_proposal.css?v=proposal-workspace-20260810-1">
</head>

<body>
    <?php include __DIR__ . '/../views/global_tools_header.php'; ?>
    <div class="workspace-shell">
        <div class="project-subhead-wrapper">
            <header class="project-header">
                <div class="pd-header-left">
                    <?php
                    $bbStatus = $project['status'] ?? 'to_do';
                    ?>
                    <div class="project-title-row">
                        <h1 id="projectHeaderName" class="pd-project-title"><?= htmlspecialchars($project['name']) ?>
                        </h1>
                        <div class="project-status-wrap bb-status-pill-container">
                            <button class="bb-status-pill-wrap status-<?= htmlspecialchars($bbStatus) ?>"
                                id="projectStatusButton" type="button"
                                data-status="<?= htmlspecialchars($project['status'] ?? 'to_do') ?>">
                                <span class="bb-status-dot"></span>
                                <span class="bb-status-pill-label"
                                    id="projectStatusLabel"><?= htmlspecialchars(strtoupper($statusLabel)) ?></span>
                                <i class="fas fa-caret-down bb-status-pill-caret"></i>
                            </button>
                            <div class="bb-status-menu-panel project-status-menu" id="projectStatusMenu"></div>
                        </div>
                    </div>
                    <!-- Keep hidden for script hooks -->
                    <p id="projectHeaderSubtitle" style="display:none;">
                        <?= $isDraftProject ? 'Unsaved draft' : htmlspecialchars('Project Workspace - ' . $statusLabel) ?>
                    </p>
                    <div class="project-meta-line" id="projectMetaLine" style="display:none;">
                        <span><?= htmlspecialchars($completionLabel) ?></span>
                        <span>Due: <?= htmlspecialchars($dueLabel) ?></span>
                        <span>Estimator: <?= htmlspecialchars($estimatorName ?: 'Unassigned') ?></span>
                        <span>Project #: <?= htmlspecialchars($projectNumberLabel) ?></span>
                    </div>
                </div>
                <div class="project-header-actions">
                    <div class="pd-presence-wrap">
                        <div class="pd-presence-stack" id="pdPresenceStack"
                            title="Active users in this project (Click to view collaborators)">
                            <div class="pd-presence-avatar self" style="background: #5b4364; z-index: 4;"
                                title="Isaac Diaz (You) - Lead Estimator">
                                <span>ID</span>
                                <span class="pd-presence-dot"></span>
                            </div>
                        </div>
                        <div class="pd-presence-menu" id="pdPresenceMenu">
                            <div class="pd-presence-menu-head">
                                <span>Active in Project</span>
                                <span class="pd-presence-count" id="pdPresenceCount">1 active</span>
                            </div>
                            <div class="pd-presence-list" id="pdPresenceList">
                                <div class="pd-presence-user-row">
                                    <div class="pd-presence-avatar"
                                        style="background: #5b4364; width: 24px; height: 24px; font-size: 9.5px; margin: 0;">
                                        <span>ID</span>
                                    </div>
                                    <div class="pd-presence-user-info">
                                        <span class="pd-presence-user-name">Isaac Diaz (You)</span>
                                        <span class="pd-presence-user-role">Lead Estimator • Active now</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <button class="btn-main" type="button" id="saveProjectBtn"><i class="fas fa-floppy-disk"></i> Save
                        Project</button>
                    <div class="dropdown-wrap">
                        <button class="btn-ghost icon-only" type="button" data-menu-toggle="projectActionsMenu"
                            aria-label="Project actions"><i class="fas fa-ellipsis-vertical"></i></button>
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
                </div>
            </header>

            <nav class="top-tabs" aria-label="Project workspace tabs" role="tablist">
                <button type="button" data-tab="overview" class="active">Overview</button>
                <button type="button" data-tab="documents">Documents</button>
                <button type="button" data-tab="takeoff">Takeoff</button>
                <button type="button" data-tab="estimating">Estimating</button>
                <button type="button" data-tab="proposal">Proposal</button>
            </nav>
        </div>

        <main class="workspace-main">
            <section id="tab-overview" class="tab-panel active">
                <div class="project-overview-layout">
                    <!-- Left Column -->
                    <div class="overview-column">
                        <!-- Estimate Overview Card -->
                        <section class="overview-card">
                            <div class="overview-card-head">
                                <h2>Estimate Overview</h2>
                            </div>
                            <div class="overview-form-grid">
                                <label class="overview-field">
                                    <span>Estimate Name</span>
                                    <input id="poEstimateName"
                                        value="<?= htmlspecialchars($project['name'] ?? 'New Project') ?>">
                                </label>
                                <label class="overview-field">
                                    <span>Project Number</span>
                                    <input id="poProjectNumber"
                                        value="<?= htmlspecialchars($project['project_number'] ?? '') ?>">
                                </label>
                                <label class="overview-field full">
                                    <span>Project Description</span>
                                    <div class="pd-desc-wrap">
                                        <textarea id="poProjectDescription" rows="2" class="pd-desc-textarea"
                                            placeholder="ETAPA 3 [ FEEDERS, ELBOWS, LOW VOLTAGE ]"><?= htmlspecialchars($project['description'] ?? '') ?></textarea>
                                    </div>
                                </label>
                                <label class="overview-field">
                                    <span>Estimator</span>
                                    <div class="pd-input-with-actions">
                                        <select id="poEstimator" class="pd-composer-input" data-initial-value="<?= htmlspecialchars($estimatorName) ?>">
                                            <option value="">-- Select an Estimator --</option>
                                            <?php foreach ($availableEstimators as $est): ?>
                                                <option value="<?= htmlspecialchars($est['name']) ?>" <?= strtolower(trim($estimatorName)) === strtolower(trim($est['name'])) ? 'selected' : '' ?>>
                                                    <?= htmlspecialchars($est['name']) ?> (<?= htmlspecialchars($est['role'] ?? 'Estimator') ?>)
                                                </option>
                                            <?php endforeach; ?>
                                            <?php if (!empty($estimatorName) && $estimatorName !== 'Unassigned' && !in_array(strtolower(trim($estimatorName)), array_map(fn($u) => strtolower(trim($u['name'])), $availableEstimators))): ?>
                                                <option value="<?= htmlspecialchars($estimatorName) ?>" selected><?= htmlspecialchars($estimatorName) ?> (Custom)</option>
                                            <?php endif; ?>
                                        </select>
                                        <span class="pd-field-caret"><i class="fas fa-chevron-down"></i></span>
                                    </div>
                                </label>
                                <!-- Office input removed from layout but retained as hidden input for state saving compatibility -->
                                <input type="hidden" id="poOffice" value="<?= htmlspecialchars($projectOffice) ?>">
                                <label class="overview-field">
                                    <span>Measurement System</span>
                                    <div class="pd-pricing-wrap">
                                        <select id="poMeasurementSystem" style="padding-left: 8px !important;">
                                            <option value="US" <?= $measurementSystem === 'US' ? 'selected' : '' ?>>US
                                            </option>
                                            <option value="Metric" <?= $measurementSystem === 'Metric' ? 'selected' : '' ?>>Metric</option>
                                        </select>
                                        <span class="pd-field-caret"><i class="fas fa-chevron-down"></i></span>
                                    </div>
                                </label>
                                <label class="overview-field">
                                    <span>Square Footage</span>
                                    <input id="poSquareFootage" inputmode="numeric"
                                        value="<?= htmlspecialchars((string) $squareFootage) ?>">
                                </label>
                                <label class="overview-field">
                                    <span>Due Date</span>
                                    <div class="pd-input-icon-wrap">
                                        <input id="poDueDate" type="date"
                                            value="<?= htmlspecialchars($dueDateInput) ?>">
                                        <i class="far fa-calendar pd-input-icon-right"></i>
                                    </div>
                                </label>
                                <label class="overview-field">
                                    <span>Due Time</span>
                                    <div class="pd-input-icon-wrap">
                                        <input id="poDueTime" type="time" step="600"
                                            value="<?= htmlspecialchars($dueTimeInput) ?>">
                                        <i class="far fa-clock pd-input-icon-right"></i>
                                    </div>
                                </label>
                                <label class="overview-field">
                                    <span>Estimate pricing</span>
                                    <div class="pd-pricing-wrap">
                                        <span class="pd-pricing-status-icon">
                                            <i class="fas <?= $estimatePricing === 'Locked' ? 'fa-lock' : 'fa-lock-open' ?>"
                                                style="color: <?= $estimatePricing === 'Locked' ? '#ef4444' : '#10b981' ?>;"></i>
                                        </span>
                                        <select id="poEstimatePricing">
                                            <option value="Unlocked" <?= $estimatePricing === 'Unlocked' ? 'selected' : '' ?>>Unlocked</option>
                                            <option value="Locked" <?= $estimatePricing === 'Locked' ? 'selected' : '' ?>>
                                                Locked</option>
                                        </select>
                                        <span class="pd-field-caret"><i class="fas fa-chevron-down"></i></span>
                                    </div>
                                </label>
                            </div>
                        </section>

                        <!-- Customer Information Card -->
                        <?php
                        $displayCompany = $customerCompany ?: 'GP Construction';
                        $displayContact = $primaryContact ?: 'GP Construction';
                        $displayPhone = $customerPhone ?: '3212002278';
                        $displayEmail = $customerEmail ?: 'Paul@gpconstructioncompany.com';
                        $displayAddress = $project['job_address'] ?: '';
                        $companyInitial = strtoupper(substr($displayCompany, 0, 1)) ?: 'G';
                        ?>
                        <section class="overview-card">
                            <div class="overview-card-head">
                                <h2>Customer Information</h2>
                                <div class="d-flex align-items-center gap-2">
                                    <button class="pd-btn-sm-text" type="button" id="saveCustomerBtn"
                                        title="Save current customer to directory"><i class="fas fa-bookmark"></i>
                                        Save</button>
                                </div>
                            </div>

                            <!-- Customer Details Display -->
                            <div class="pd-customer-body" id="customerDisplayBlock">
                                <!-- Customer Info: Company Name (Title) + Contact Summary (Subtitle) + Single Edit Button -->
                                <div class="pd-customer-section">
                                    <div class="pd-customer-row">
                                        <div class="pd-company-avatar" id="customerAvatarLetter">
                                            <?= htmlspecialchars($companyInitial) ?></div>
                                        <div class="pd-customer-details" style="flex: 1; min-width: 0;">
                                            <div class="pd-customer-name" id="displayCustomerCompany"
                                                style="font-weight: 700; font-size: 13.5px;">
                                                <?= htmlspecialchars($displayCompany) ?></div>
                                            <div class="pd-contact-sub-line" id="displayContactSummary"
                                                style="font-size: 11.5px; color: var(--text-muted); margin-top: 1px;">
                                                <?= htmlspecialchars($displayContact . ', ' . $displayPhone . ', ' . $displayEmail) ?>
                                            </div>
                                        </div>
                                        <button class="pd-row-dots-btn" type="button" id="editCustomerInfoBtn"
                                            title="Edit Customer Information"><i class="fas fa-pen"></i></button>
                                    </div>
                                </div>

                                <!-- Project Address Section: Shows Address + Single Edit button, or Add Address -->
                                <div class="pd-customer-section">
                                    <div class="pd-customer-label">Project Address</div>
                                    <div id="projectAddressDisplayWrap">
                                        <div class="pd-customer-row"
                                            style="cursor: pointer; <?= empty($displayAddress) ? 'display:none;' : 'display:flex;' ?>"
                                            id="editProjectAddressRow">
                                            <div class="pd-contact-icon-box"><i class="fas fa-location-dot"></i></div>
                                            <div class="pd-contact-details" style="flex: 1; min-width: 0;">
                                                <div class="pd-contact-main-line" id="displayProjectAddressText">
                                                    <?= htmlspecialchars($displayAddress) ?></div>
                                            </div>
                                            <button class="pd-row-dots-btn" type="button" id="editProjectAddressBtn"
                                                title="Edit project address"><i class="fas fa-pen"></i></button>
                                        </div>
                                        <button class="pd-add-address-bar" type="button" id="addProjectAddressBtn"
                                            style="<?= empty($displayAddress) ? 'display:flex;' : 'display:none;' ?>">
                                            <i class="fas fa-plus"></i> Add Address
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>

                    <!-- Right Column -->
                    <div class="overview-column">
                        <!-- Notes Card -->
                        <section class="overview-card pd-card-notes">
                            <div class="overview-card-head">
                                <h2 id="overviewNotesCardTitle">Notes (<?= count($projectNotes) ?>)</h2>
                                <button class="pd-card-add-btn" type="button" id="addNoteBtnHead" title="Add note"><i
                                        class="fas fa-plus"></i></button>
                            </div>
                            <div id="overviewNotesList" class="overview-list"
                                style="flex: 1 1 auto; display: flex; flex-direction: column;">
                                <?php if (empty($projectNotes)): ?>
                                    <div class="pd-empty-card-state" id="overviewNotesEmpty" role="button" tabindex="0">
                                        <div class="pd-empty-graphic">
                                            <svg width="72" height="52" viewBox="0 0 72 52" fill="none"
                                                xmlns="http://www.w3.org/2000/svg">
                                                <rect x="18" y="10" width="46" height="36" rx="4" fill="rgba(0,0,0,0.08)" />
                                                <rect x="14" y="6" width="46" height="36" rx="4" fill="var(--bg-panel)"
                                                    stroke="var(--border)" stroke-width="1.5" />
                                                <path d="M14 10C14 7.79 15.79 6 18 6H56C58.21 6 60 7.79 60 10V15H14V10Z"
                                                    fill="#0055b8" />
                                                <circle cx="20" cy="10.5" r="1.5" fill="#ffffff" opacity="0.8" />
                                                <circle cx="25" cy="10.5" r="1.5" fill="#ffffff" opacity="0.8" />
                                                <rect x="20" y="21" width="18" height="2" rx="1" fill="var(--border)" />
                                                <rect x="20" y="26" width="26" height="2" rx="1" fill="var(--border)" />
                                                <rect x="20" y="31" width="14" height="2" rx="1" fill="var(--border)" />
                                                <path d="M10 28H18M14 24V32" stroke="#fb5a3a" stroke-width="2.5"
                                                    stroke-linecap="round" />
                                                <path
                                                    d="M14 20L15 22L17 22L15.5 23.5L16 25.5L14 24.5L12 25.5L12.5 23.5L11 22L13 22L14 20Z"
                                                    fill="#fb5a3a" />
                                            </svg>
                                        </div>
                                        <div class="pd-empty-title">Create a Note</div>
                                        <div class="pd-empty-subtitle">Take notes to help organize thoughts and information
                                            with your team.</div>
                                    </div>
                                <?php else: ?>
                                    <div class="pd-list-month-header">September</div>
                                    <?php foreach ($projectNotes as $idx => $note):
                                        $author = $note['user'] ?? 'Isaac De Jesús';
                                        $initial = strtoupper(substr($author, 0, 1)) ?: 'I';
                                        ?>
                                        <div class="pd-note-item" data-note-index="<?= $idx ?>">
                                            <div class="pd-note-avatar"><?= htmlspecialchars($initial) ?></div>
                                            <div class="pd-note-content-wrap">
                                                <div class="pd-note-author"><?= htmlspecialchars($author) ?></div>
                                                <div class="pd-note-time">
                                                    <?= htmlspecialchars($note['timestamp'] ?? 'just now') ?></div>
                                                <div class="pd-note-bubble">
                                                    <?= nl2br(htmlspecialchars($note['content'] ?? '')) ?></div>
                                            </div>
                                            <div class="pd-item-menu-wrap">
                                                <button type="button" class="pd-row-dots-btn" data-note-menu="<?= $idx ?>"
                                                    title="Note options"><i class="fas fa-ellipsis-vertical"></i></button>
                                            </div>
                                        </div>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </div>
                        </section>

                        <!-- Tasks Card -->
                        <section class="overview-card pd-card-tasks">
                            <div class="overview-card-head">
                                <h2 id="overviewTasksCardTitle">Tasks (<?= count($projectTasks) ?>)</h2>
                                <button class="pd-card-add-btn" type="button" id="createTaskBtnHead" title="New task"><i
                                        class="fas fa-plus"></i></button>
                            </div>
                            <div id="overviewTasksList" class="overview-list"
                                style="flex: 1 1 auto; display: flex; flex-direction: column;">
                                <?php if (empty($projectTasks)): ?>
                                    <div class="pd-empty-card-state" id="overviewTasksEmpty" role="button" tabindex="0">
                                        <div class="pd-empty-graphic">
                                            <svg width="72" height="52" viewBox="0 0 72 52" fill="none"
                                                xmlns="http://www.w3.org/2000/svg">
                                                <rect x="18" y="10" width="46" height="36" rx="4" fill="rgba(0,0,0,0.08)" />
                                                <rect x="14" y="6" width="46" height="36" rx="4" fill="var(--bg-panel)"
                                                    stroke="var(--border)" stroke-width="1.5" />
                                                <path d="M14 10C14 7.79 15.79 6 18 6H56C58.21 6 60 7.79 60 10V15H14V10Z"
                                                    fill="#0055b8" />
                                                <circle cx="20" cy="10.5" r="1.5" fill="#ffffff" opacity="0.8" />
                                                <circle cx="25" cy="10.5" r="1.5" fill="#ffffff" opacity="0.8" />
                                                <rect x="20" y="21" width="18" height="2" rx="1" fill="var(--border)" />
                                                <rect x="20" y="26" width="26" height="2" rx="1" fill="var(--border)" />
                                                <rect x="20" y="31" width="14" height="2" rx="1" fill="var(--border)" />
                                                <path d="M10 28H18M14 24V32" stroke="#fb5a3a" stroke-width="2.5"
                                                    stroke-linecap="round" />
                                                <path
                                                    d="M14 20L15 22L17 22L15.5 23.5L16 25.5L14 24.5L12 25.5L12.5 23.5L11 22L13 22L14 20Z"
                                                    fill="#fb5a3a" />
                                            </svg>
                                        </div>
                                        <div class="pd-empty-title">Create a Task</div>
                                        <div class="pd-empty-subtitle">Assign a task with a due date to yourself or someone
                                            else on your team.</div>
                                    </div>
                                <?php else: ?>
                                    <?php foreach ($projectTasks as $idx => $task): ?>
                                        <div class="pd-task-item" data-task-index="<?= $idx ?>">
                                            <div class="pd-task-icon-box"><i class="fas fa-clipboard"></i></div>
                                            <div class="pd-task-content-wrap">
                                                <div class="pd-task-title"><?= htmlspecialchars($task['title'] ?? '') ?></div>
                                                <div class="pd-task-assignee">For
                                                    <?= htmlspecialchars($task['responsible'] ?? 'Isaac De Jesús') ?></div>
                                            </div>
                                            <?php if (!empty($task['due_date'])): ?>
                                                <div class="pd-task-due-badge">Due <?= htmlspecialchars($task['due_date']) ?></div>
                                            <?php endif; ?>
                                            <div class="pd-item-menu-wrap">
                                                <button type="button" class="pd-row-dots-btn" data-task-menu="<?= $idx ?>"
                                                    title="Task options"><i class="fas fa-ellipsis-vertical"></i></button>
                                            </div>
                                        </div>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </div>
                        </section>
                    </div>
                </div>
            </section>

            <section id="tab-documents" class="tab-panel documents-page">
                <!-- State 1: Empty View (Image 1) -->
                <div class="documents-empty-view" id="documentsEmptyView">
                    <div class="doc-empty-card" id="docEmptyDropzone">
                        <svg class="doc-empty-icon" width="130" height="120" viewBox="0 0 130 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <!-- Radiating spark rays -->
                            <path d="M52 14L48 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                            <path d="M65 11V4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                            <path d="M78 14L82 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>

                            <!-- Blue folders inside box -->
                            <path d="M36 29C36 27.5 37.2 26.5 38.8 26.5H58L62 30H92C93.5 30 94.5 31.2 94.5 32.5V45H36V29Z" fill="#004b9e"/>
                            <path d="M38 34C38 32.5 39.2 31.5 40.8 31.5H62L66 35H95C96.5 35 97.5 36.2 97.5 37.5V48H38V34Z" fill="#0055b8"/>

                            <!-- Shadow under box -->
                            <ellipse cx="65" cy="114" rx="46" ry="5" class="doc-svg-shadow"/>

                            <!-- Box body -->
                            <rect x="33" y="44" width="64" height="64" rx="2" class="doc-svg-box" stroke-width="2.4"/>

                            <!-- Top lip line -->
                            <line x1="33" y1="46" x2="97" y2="46" stroke="currentColor" stroke-width="2"/>

                            <!-- Handle cutout -->
                            <rect x="57" y="52" width="16" height="7" rx="3.5" fill="currentColor"/>

                            <!-- Left corner bracket -->
                            <path d="M34 50V108H46" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>

                            <!-- Front label paper with orange border -->
                            <rect x="49" y="66" width="36" height="28" rx="1.5" class="doc-svg-label" stroke="#fb5a3a" stroke-width="2"/>
                            <!-- Text lines on label -->
                            <line x1="54" y1="73" x2="78" y2="73" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" class="doc-svg-line"/>
                            <line x1="54" y1="78" x2="74" y2="78" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" class="doc-svg-line"/>
                            <line x1="54" y1="83" x2="68" y2="83" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" class="doc-svg-line"/>
                        </svg>

                        <h2 class="doc-empty-title">Upload Documents to Get Started</h2>
                        <p class="doc-empty-desc">Once you upload, you and your team can manage documents here.</p>
                        <button type="button" class="btn-main orange doc-empty-upload-btn" id="docEmptyUploadBtn">
                            <i class="fas fa-upload"></i>
                            <span>Upload</span>
                        </button>
                    </div>
                </div>

                <!-- State 2: Populated View (Image 2) -->
                <div class="documents-layout pro-documents" id="documentsPageView" style="display: none;">
                    <aside class="documents-sidebar" id="documentsSidebar" aria-label="Document folders">
                        <div class="documents-sidebar-head">
                            <h2>Folders</h2>
                            <div class="documents-menu-wrap">
                                <button class="btn-ghost icon-only" type="button" data-doc-folder-menu-toggle
                                    title="Folder options"><i class="fas fa-ellipsis-vertical"></i></button>
                                <div class="documents-menu" id="documentsFolderMenu">
                                    <button type="button" data-doc-folder-action="create"><i
                                            class="fas fa-folder-plus"></i> Create folder</button>
                                    <button type="button" data-doc-folder-action="rename"><i class="fas fa-pen"></i>
                                        Rename folder</button>
                                    <button type="button" data-doc-folder-action="delete"><i class="fas fa-trash"></i>
                                        Delete folder</button>
                                    <button type="button" data-doc-folder-action="sort"><i
                                            class="fas fa-arrow-down-a-z"></i> Sort folders</button>
                                </div>
                            </div>
                        </div>
                        <div class="documents-folder-tree" id="documentsFolderTree"></div>
                    </aside>

                    <div class="documents-sidebar-resizer" id="docSidebarResizer" title="Drag to resize sidebar">
                        <div class="doc-resizer-handle"></div>
                    </div>

                    <section class="documents-content-panel" aria-label="Documents content">
                        <!-- Top title bar with density slider & Move to Takeoff -->
                        <div class="doc-main-topbar">
                            <h2 id="documentsContentTitle">Custom Drawings</h2>
                            <div class="doc-topbar-actions">
                                <button type="button" class="btn-main orange doc-move-takeoff-btn" id="docMoveToTakeoffBtn" title="Move current document to Takeoff workspace">
                                    <i class="fas fa-ruler-combined"></i>
                                    <span>Move to Takeoff</span>
                                </button>
                                <div class="doc-slider-wrap" title="Adjust row density">
                                    <input id="documentsZoom" class="doc-density-slider" type="range" min="0" max="2" step="1" value="1"
                                        aria-label="Document row density">
                                </div>
                            </div>
                        </div>

                        <!-- Toolbar: Custom ▾, Upload, Search, ⋮ -->
                        <div class="documents-toolbar">
                            <div class="doc-toolbar-left">
                                <div class="doc-sort-dropdown-wrap">
                                    <button class="btn-outline-dark doc-custom-btn" type="button" id="docSortMenuBtn">
                                        <i class="fas fa-bars"></i>
                                        <span id="docSortLabel">Custom</span>
                                        <i class="fas fa-caret-down"></i>
                                    </button>
                                    <div class="documents-menu" id="docSortMenu">
                                        <button type="button" data-doc-sort="custom">Custom</button>
                                        <button type="button" data-doc-sort="name">Name</button>
                                        <button type="button" data-doc-sort="uploadedAt">Upload Date</button>
                                        <button type="button" data-doc-sort="pageCount">Page Count</button>
                                        <button type="button" data-doc-sort="type">Type</button>
                                    </div>
                                </div>
                                <button class="btn-main orange doc-upload-btn-full" type="button" id="docUploadArrowBtn"
                                    title="Upload file">
                                    <i class="fas fa-upload"></i>
                                    <span>Upload</span>
                                </button>
                            </div>

                            <div class="doc-toolbar-right">
                                <div class="documents-search">
                                    <input id="documentsSearch" type="search" placeholder="Search drawing">
                                    <i class="fas fa-magnifying-glass"></i>
                                </div>
                                <div class="documents-menu-wrap">
                                    <button class="btn-ghost icon-only" type="button" data-doc-view-menu-toggle
                                        title="View options"><i class="fas fa-ellipsis-vertical"></i></button>
                                    <div class="documents-menu align-right" id="documentsViewMenu">
                                        <button type="button" data-doc-view-action="compact"><i class="fas fa-list"></i>
                                            Compact rows</button>
                                        <button type="button" data-doc-view-action="comfortable"><i
                                                class="fas fa-table-cells-large"></i> Comfortable rows</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="documents-list" id="documentsList"></div>
                    </section>
                    <!-- Universal Sidebar Context Menu -->
                    <div class="documents-menu" id="docSidebarMenu" style="display: none;"></div>
                </div>
            </section>

            <section id="tab-takeoff" class="tab-panel fullscreen">
                <div class="takeoff-workspace pro-takeoff-workspace" id="takeoffWorkspace">
                    <aside class="pro-takeoff-items" id="takeoffItemsPanel">
                        <div class="pro-takeoff-panel-head">
                            <div>
                                <h2 id="takeoffPanelTitle">Takeoffs (0)</h2>
                            </div>
                            <button class="pro-icon-btn" type="button" data-takeoff-action="toggle-global-visibility"
                                title="Show/hide all takeoffs" aria-label="Show/hide all takeoffs"><i
                                    class="fas fa-eye"></i></button>
                            <button class="pro-add-btn" type="button" data-takeoff-action="create-layer"
                                title="Create New Takeoff Layer" aria-label="Create New Takeoff Layer"><i
                                    class="fas fa-plus"></i></button>
                            <button class="pro-icon-btn" type="button" id="toggleTakeoffItemsPanel"
                                title="Collapse panel" aria-label="Collapse items panel">
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
                                <button class="pro-actions-btn" type="button"
                                    data-takeoff-menu-toggle="takeoffItemsActions" aria-label="Takeoff actions">
                                    Actions <i class="fas fa-chevron-down"></i>
                                </button>
                                <div class="pro-menu" id="takeoffItemsActions">
                                    <button type="button" data-takeoff-action="create-layer"><i class="fas fa-plus"></i>
                                        Create New Layer</button>
                                    <button type="button" data-takeoff-action="collapse-all"><i
                                            class="fas fa-down-left-and-up-right-to-center"></i> Collapse All</button>
                                    <button type="button" class="excel" data-takeoff-action="export-excel"><i
                                            class="fas fa-file-excel"></i> Takeoff Quantities to Excel</button>
                                </div>
                            </div>
                            <button class="pro-create-group-btn" type="button" data-takeoff-action="create-group"><i
                                    class="fas fa-folder-plus"></i><span>Create new group</span></button>
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
                                    <button class="pro-sheet-select pro-sheet-trigger" id="takeoffSheetSelect"
                                        type="button" aria-expanded="false">
                                        <span
                                            id="takeoffSheetLabel"><?= htmlspecialchars($selectedDoc['filename'] ?? 'No drawing selected') ?></span>
                                        <i class="fas fa-chevron-down"></i>
                                    </button>
                                    <div class="pro-drawing-dropdown" id="takeoffDrawingDropdown"
                                        aria-label="Drawing selector">
                                        <div class="pro-drawing-dropdown-head">
                                            <div>
                                                <div class="pro-drawing-crumbs">Drawing Sources <i
                                                        class="fas fa-chevron-right"></i> Estimating Tool</div>
                                                <strong>Drawings &amp; Sheets</strong>
                                            </div>
                                            <button class="pro-icon-btn" type="button" data-drawing-close
                                                aria-label="Close drawing selector"><i
                                                    class="fas fa-times"></i></button>
                                        </div>
                                        <div class="pro-drawing-active-bar" id="takeoffDrawingActiveBar">
                                            <div class="pro-drawing-active-info" id="takeoffDrawingActiveInfo">
                                                <span class="pro-drawing-active-label">Item Activo:</span>
                                                <span class="pro-drawing-active-pill" id="takeoffDrawingActivePill"
                                                    title="Item actualmente seleccionado para cotización">
                                                    <span class="pro-drawing-active-dot"
                                                        id="takeoffDrawingActiveDot"></span>
                                                    <span id="takeoffDrawingActiveText">Ningún item seleccionado</span>
                                                </span>
                                            </div>
                                            <div class="pro-drawing-filters">
                                                <button class="pro-drawing-filter-btn active"
                                                    id="takeoffFilterAllSheets" type="button"
                                                    data-drawing-filter="all">Todas las Hojas</button>
                                                <button class="pro-drawing-filter-btn" id="takeoffFilterItemSheets"
                                                    type="button" data-drawing-filter="item">Solo con este Item <span
                                                        class="pro-filter-count"
                                                        id="takeoffFilterItemCount">0</span></button>
                                            </div>
                                        </div>
                                        <div class="pro-drawing-search">
                                            <input id="takeoffDrawingSearch" type="search"
                                                placeholder="Search drawing or sheet...">
                                            <i class="fas fa-magnifying-glass"></i>
                                        </div>
                                        <div class="pro-drawing-grid">
                                            <div class="pro-drawing-col">
                                                <div class="pro-drawing-col-title">Directory <span class="pro-col-badge"
                                                        id="takeoffDocTotalCount">0</span></div>
                                                <div id="takeoffDocumentList" class="pro-drawing-list"></div>
                                            </div>
                                            <div class="pro-drawing-col">
                                                <div class="pro-drawing-col-title">Sheets <span class="pro-col-badge"
                                                        id="takeoffSheetTotalCount">0</span></div>
                                                <div id="takeoffSheetList" class="pro-drawing-list"></div>
                                            </div>
                                            <div class="pro-drawing-preview">
                                                <div class="pro-drawing-col-title">Preview &amp; Takeoff</div>
                                                <div class="pro-preview-container">
                                                    <div id="takeoffSheetPreview" class="pro-preview-box">
                                                        <span>Select a sheet</span>
                                                    </div>
                                                    <div class="pro-preview-details" id="takeoffPreviewDetails">
                                                        <div class="pro-preview-sheet-header">
                                                            <h4 id="takeoffPreviewTitle">Sheet Preview</h4>
                                                            <span class="pro-preview-sheet-sub"
                                                                id="takeoffPreviewSub">Selecciona una hoja para ver sus
                                                                marcas</span>
                                                        </div>
                                                        <div class="pro-preview-takeoff-section">
                                                            <div class="pro-preview-section-title">
                                                                <span><i class="fas fa-layer-group"></i> Items en esta
                                                                    hoja</span>
                                                                <span class="pro-preview-item-count"
                                                                    id="takeoffPreviewItemCount">0 items</span>
                                                            </div>
                                                            <div class="pro-preview-items-list"
                                                                id="takeoffPreviewItemsList">
                                                                <div class="pro-preview-empty-takeoff">Sin marcas en
                                                                    esta hoja</div>
                                                            </div>
                                                        </div>
                                                        <button class="pro-open-sheet-btn" id="takeoffOpenSheetBtn"
                                                            type="button" disabled>
                                                            <i class="fas fa-arrow-right-to-bracket"></i> Abrir Hoja
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="pro-toolbar-group center">
                                <div class="pro-top-stat"><span>Page</span><strong id="takeoffTopPage">1 / 1</strong>
                                </div>
                                <div class="pro-top-stat"><span>Estimate</span><strong id="takeoffTopProgress">0%
                                        ready</strong></div>
                            </div>
                            <div class="pro-scale-wrap">
                                <button class="pro-scale-status" id="takeoffScaleStatus" type="button" data-scale-toggle
                                    aria-expanded="false">
                                    <i class="fas fa-triangle-exclamation"></i>
                                    <span>Drawing Scale: not defined yet</span>
                                </button>
                                <div class="pro-scale-panel" id="takeoffScalePanel"
                                    aria-label="Takeoff scale calibration">
                                    <div class="pro-scale-panel-head">
                                        <strong>Drawing Scale</strong>
                                        <button class="pro-icon-btn" type="button" data-scale-close
                                            aria-label="Close scale panel"><i class="fas fa-times"></i></button>
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
                                            <input id="takeoffManualFeet" type="number" min="0.1" step="0.1"
                                                placeholder="ft">
                                            <button type="button" class="pro-toolbar-btn"
                                                data-scale-apply-manual>Apply</button>
                                        </div>
                                        <button type="button" class="pro-chip-btn" data-scale-clear-line><i
                                                class="fas fa-trash"></i> Clear line</button>
                                    </div>
                                    <div class="pro-scale-hint" id="takeoffScaleHint">Choose a preset scale or calibrate
                                        manually.</div>
                                </div>
                            </div>
                            <div class="pro-menu-wrap">
                                <button class="pro-actions-btn" type="button"
                                    data-takeoff-menu-toggle="takeoffWorkspaceActions">
                                    <i class="fas fa-ellipsis-vertical"></i><span>Project actions</span><i
                                        class="fas fa-chevron-down"></i>
                                </button>
                                <div class="pro-menu" id="takeoffWorkspaceActions">
                                    <button type="button" data-takeoff-action="upload-drawing"><i
                                            class="fas fa-cloud-arrow-up"></i> Upload drawing</button>
                                    <button type="button" data-takeoff-action="save-workspace"><i
                                            class="fas fa-floppy-disk"></i> Save workspace</button>
                                    <button type="button" data-takeoff-action="export-excel"><i
                                            class="fas fa-file-export"></i> Export quantities</button>
                                    <button type="button" data-viewer-command="download"><i class="fas fa-download"></i>
                                        Download drawing</button>
                                </div>
                            </div>
                        </div>

                        <div class="pro-canvas-shell">
                            <?php if ($selectedDoc && $selectedDoc['source'] === 'legacy_file'): ?>
                                <iframe id="takeoffFrame" class="takeoff-frame pro-takeoff-frame"
                                    src="editor.php?id=<?= (int) $selectedDoc['id'] ?>&embedded=1&estimate_key=est_primary&inherit_legacy=1"></iframe>
                            <?php else: ?>
                                <div id="takeoffEmpty" class="takeoff-empty pro-takeoff-empty">
                                    <div>
                                        <i class="fas fa-file-pdf fa-3x mb-3"></i>
                                        <h3>No drawing selected</h3>
                                        <p>Upload drawings in Documents to start takeoff.</p>
                                    </div>
                                </div>
                                <iframe id="takeoffFrame" class="takeoff-frame pro-takeoff-frame"
                                    style="display:none;"></iframe>
                            <?php endif; ?>

                            <div class="pro-floating-controls">
                                <button class="pro-icon-btn" type="button" data-viewer-command="previous"
                                    title="Previous sheet"><i class="fas fa-chevron-left"></i></button>
                                <button class="pro-icon-btn" type="button" data-viewer-command="next"
                                    title="Next sheet"><i class="fas fa-chevron-right"></i></button>
                                <button class="pro-icon-btn" type="button" data-viewer-command="zoom-out"
                                    title="Zoom out"><i class="fas fa-minus"></i></button>
                                <input id="takeoffZoomSlider" type="range" min="25" max="400" value="100"
                                    aria-label="Zoom">
                                <span id="takeoffZoomPercent">100%</span>
                                <button class="pro-icon-btn" type="button" data-viewer-command="zoom-in"
                                    title="Zoom in"><i class="fas fa-plus"></i></button>
                                <button class="pro-chip-btn" type="button" data-viewer-command="fit">Fit</button>
                                <button class="pro-icon-btn" type="button" data-viewer-command="fullscreen"
                                    title="Fullscreen"><i class="fas fa-expand"></i></button>
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
                            <button class="pro-icon-btn" type="button" id="toggleTakeoffInspector"
                                title="Collapse inspector" aria-label="Collapse inspector">
                                <i class="fas fa-angles-right"></i>
                            </button>
                        </div>
                        <div class="pro-inspector-tools">
                            <div class="pro-tools-bar" aria-label="Takeoff tools">
                                <button class="pro-tool-btn active" type="button" data-tool-command="smart"
                                    title="Select"><i class="fas fa-mouse-pointer"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="pan" title="Pan"><i
                                        class="fas fa-hand"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="multi-select"
                                    title="Rectangle Select"><i class="fas fa-object-group"></i></button>
                                <div class="pro-tool-separator"></div>
                                <button class="pro-tool-btn" type="button" data-tool-command="count" title="Count"><i
                                        class="fas fa-circle-dot"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="linear" title="Linear"><i
                                        class="fas fa-grip-lines"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="area" title="Area"><i
                                        class="fas fa-draw-polygon"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="measure"
                                    title="Measure"><i class="fas fa-ruler-horizontal"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="freehand"
                                    title="Freehand"><i class="fas fa-signature"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="text" title="Note"><i
                                        class="fas fa-note-sticky"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="cloud" title="Cloud"><i
                                        class="fas fa-cloud"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="pin" title="Pin"><i
                                        class="fas fa-location-dot"></i></button>
                                <div class="pro-tool-separator"></div>
                                <button class="pro-tool-btn" type="button" data-tool-command="undo" title="Undo"><i
                                        class="fas fa-rotate-left"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="redo" title="Redo"><i
                                        class="fas fa-rotate-right"></i></button>
                                <button class="pro-tool-btn danger" type="button" data-tool-command="delete"
                                    title="Delete"><i class="fas fa-trash"></i></button>
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
                <div id="estimatingModule" class="est-shell est-v2" data-project-id="<?= (int) $projectId ?>">
                    <div class="est-main">
                        <section class="est-left" aria-label="Estimate cost items">
                            <div class="est-toolbar">
                                <label class="est-search" for="estSearch">
                                    <i class="fas fa-search"></i>
                                    <input id="estSearch" type="search" placeholder="Search cost item">
                                </label>
                                <button class="est-btn est-btn-primary" type="button" data-est-action="create-group"
                                    title="Create group"><i class="fas fa-folder-plus"></i><span>Create
                                        group</span></button>
                                <button class="est-btn est-catalog-update-trigger" type="button"
                                    data-est-action="catalog-update"
                                    title="Check this estimate against the Cost Catalog"><i class="fas fa-arrows-rotate"
                                        aria-hidden="true"></i><span>Update from Cost Catalog</span></button>
                                <div class="est-menu-wrap">
                                    <button class="est-icon-btn" type="button" data-est-action="columns"
                                        title="Adjust columns"><i class="fas fa-sliders"></i></button>
                                    <div class="est-menu" id="columnMenu"></div>
                                </div>
                                <button class="est-icon-btn" type="button" data-est-action="fullscreen"
                                    title="Full screen"><i class="fas fa-expand"></i></button>
                                <div class="est-menu-wrap">
                                    <button class="est-icon-btn" type="button" data-est-action="options"
                                        title="Options"><i class="fas fa-ellipsis-vertical"></i></button>
                                    <div class="est-menu" id="optionsMenu">
                                        <button type="button" data-est-option="save"><i class="fas fa-floppy-disk"></i>
                                            Save estimate</button>
                                        <button type="button" data-est-option="copy"><i class="fas fa-copy"></i> Copy
                                            estimate</button>
                                        <button type="button" data-est-option="status"><i
                                                class="fas fa-circle-check"></i> Change project status</button>
                                        <button type="button" data-est-option="import"><i
                                                class="fas fa-file-import"></i> Import</button>
                                        <button type="button" data-est-option="export"><i
                                                class="fas fa-file-export"></i> Export</button>
                                        <button type="button" data-est-option="export-bom"><i
                                                class="fas fa-file-excel"></i> Export BOM (Excel)</button>
                                        <button type="button" data-est-option="delete-estimate" class="danger"><i
                                                class="fas fa-trash"></i> Delete estimate</button>
                                    </div>
                                </div>
                                <button class="est-btn" type="button" data-est-action="reset-quantities"
                                    title="Reset quantities"><i class="fas fa-rotate-left"></i><span>Reset
                                        Quantities</span></button>
                                <button class="est-btn est-btn-danger" type="button" data-est-action="delete-selected"
                                    disabled><i class="fas fa-trash"></i><span>Delete</span></button>
                            </div>
                            <div class="est-table-wrap">
                                <table class="est-table" aria-label="Estimate items table">
                                    <thead id="estTableHead"></thead>
                                    <tbody id="estTableBody"></tbody>
                                </table>
                            </div>
                            <button class="est-create-bottom" type="button" data-est-action="create-group"><i
                                    class="fas fa-folder-plus"></i> Create new group</button>
                        </section>
                        <aside class="est-right" aria-label="Estimate notes and summary">
                            <div class="est-right-scroll">
                                <section class="est-card" id="notesCard">
                                    <button class="est-card-header" type="button"
                                        data-collapse-card="notesCollapsed"><span><i class="fas fa-chevron-down"></i>
                                            Notes</span></button>
                                    <div class="est-card-body">
                                        <div class="est-field-block">
                                            <div class="est-label">Scope of Work</div>
                                            <div class="est-editor-toolbar" data-toolbar="scope"><button type="button"
                                                    data-editor-cmd="undo" title="Undo"><i
                                                        class="fas fa-rotate-left"></i></button><button type="button"
                                                    data-editor-cmd="redo" title="Redo"><i
                                                        class="fas fa-rotate-right"></i></button><select
                                                    data-editor-format="formatBlock" aria-label="Text style">
                                                    <option value="P">Paragraph</option>
                                                    <option value="H3">Heading</option>
                                                </select><button type="button" data-editor-cmd="bold" title="Bold"><i
                                                        class="fas fa-bold"></i></button><button type="button"
                                                    data-editor-cmd="italic" title="Italic"><i
                                                        class="fas fa-italic"></i></button><button type="button"
                                                    data-editor-cmd="insertHorizontalRule" title="Line"><i
                                                        class="fas fa-minus"></i></button><button type="button"
                                                    data-editor-cmd="backColor" data-editor-value="#dbeafe"
                                                    title="Highlight"><i class="fas fa-fill-drip"></i></button><button
                                                    type="button" data-editor-cmd="justifyLeft" title="Align left"><i
                                                        class="fas fa-align-left"></i></button><button type="button"
                                                    data-editor-cmd="justifyCenter" title="Align center"><i
                                                        class="fas fa-align-center"></i></button><button type="button"
                                                    data-editor-cmd="justifyRight" title="Align right"><i
                                                        class="fas fa-align-right"></i></button><button type="button"
                                                    data-editor-cmd="justifyFull" title="Justify"><i
                                                        class="fas fa-align-justify"></i></button><button type="button"
                                                    data-editor-cmd="insertUnorderedList" title="Bullets"><i
                                                        class="fas fa-list-ul"></i></button><button type="button"
                                                    data-editor-cmd="insertOrderedList" title="Numbers"><i
                                                        class="fas fa-list-ol"></i></button><button type="button"
                                                    data-editor-cmd="outdent" title="Outdent"><i
                                                        class="fas fa-outdent"></i></button><button type="button"
                                                    data-editor-cmd="indent" title="Indent"><i
                                                        class="fas fa-indent"></i></button><button type="button"
                                                    data-editor-cmd="removeFormat" title="Clear"><i
                                                        class="fas fa-eraser"></i></button></div>
                                            <div id="scopeEditor" class="est-rich-editor" contenteditable="true"
                                                data-editor="scope"></div>
                                        </div>
                                        <div class="est-field-block">
                                            <div class="est-list-head">
                                                <div class="est-label">Included</div>
                                                <div><button class="est-small-btn" type="button"
                                                        data-est-action="browse-library">Browse library</button><button
                                                        class="est-small-btn" type="button"
                                                        data-est-action="add-included"><i
                                                            class="fas fa-plus"></i></button></div>
                                            </div>
                                            <div id="includedList" class="est-free-list"></div>
                                        </div>
                                        <div class="est-field-block">
                                            <div class="est-list-head">
                                                <div class="est-label">Excluded</div>
                                                <div><button class="est-small-btn" type="button"
                                                        data-est-action="browse-library">Browse library</button><button
                                                        class="est-small-btn" type="button"
                                                        data-est-action="add-excluded"><i
                                                            class="fas fa-plus"></i></button></div>
                                            </div>
                                            <div id="excludedList" class="est-free-list"></div>
                                        </div>
                                        <div class="est-field-block">
                                            <div class="est-label">Project Notes</div>
                                            <div class="est-editor-toolbar" data-toolbar="projectNotes"><button
                                                    type="button" data-editor-cmd="undo" title="Undo"><i
                                                        class="fas fa-rotate-left"></i></button><button type="button"
                                                    data-editor-cmd="redo" title="Redo"><i
                                                        class="fas fa-rotate-right"></i></button><select
                                                    data-editor-format="formatBlock" aria-label="Text style">
                                                    <option value="P">Paragraph</option>
                                                    <option value="H3">Heading</option>
                                                </select><button type="button" data-editor-cmd="bold" title="Bold"><i
                                                        class="fas fa-bold"></i></button><button type="button"
                                                    data-editor-cmd="italic" title="Italic"><i
                                                        class="fas fa-italic"></i></button><button type="button"
                                                    data-editor-cmd="insertHorizontalRule" title="Line"><i
                                                        class="fas fa-minus"></i></button><button type="button"
                                                    data-editor-cmd="backColor" data-editor-value="#dbeafe"
                                                    title="Highlight"><i class="fas fa-fill-drip"></i></button><button
                                                    type="button" data-editor-cmd="justifyLeft" title="Align left"><i
                                                        class="fas fa-align-left"></i></button><button type="button"
                                                    data-editor-cmd="justifyCenter" title="Align center"><i
                                                        class="fas fa-align-center"></i></button><button type="button"
                                                    data-editor-cmd="justifyRight" title="Align right"><i
                                                        class="fas fa-align-right"></i></button><button type="button"
                                                    data-editor-cmd="justifyFull" title="Justify"><i
                                                        class="fas fa-align-justify"></i></button><button type="button"
                                                    data-editor-cmd="insertUnorderedList" title="Bullets"><i
                                                        class="fas fa-list-ul"></i></button><button type="button"
                                                    data-editor-cmd="insertOrderedList" title="Numbers"><i
                                                        class="fas fa-list-ol"></i></button><button type="button"
                                                    data-editor-cmd="outdent" title="Outdent"><i
                                                        class="fas fa-outdent"></i></button><button type="button"
                                                    data-editor-cmd="indent" title="Indent"><i
                                                        class="fas fa-indent"></i></button><button type="button"
                                                    data-editor-cmd="removeFormat" title="Clear"><i
                                                        class="fas fa-eraser"></i></button></div>
                                            <div id="projectNotesEditor" class="est-rich-editor" contenteditable="true"
                                                data-editor="projectNotes"></div>
                                        </div>
                                    </div>
                                </section>
                                <section class="est-card" id="summaryCard"><button class="est-card-header" type="button"
                                        data-collapse-card="summaryCollapsed"><span><i class="fas fa-chevron-down"></i>
                                            Summary</span></button>
                                    <div class="est-card-body">
                                        <div class="est-rate-grid"><label>Global labor cost <input id="globalLaborCost"
                                                    type="number" min="0" step="0.01"></label><label>Global labor sales
                                                rate <input id="globalLaborSales" type="number" min="0"
                                                    step="0.01"></label><button class="est-small-btn" type="button"
                                                data-labor-unit>mins</button></div>
                                        <div class="est-summary-table-wrap">
                                            <table class="est-summary-table">
                                                <thead>
                                                    <tr>
                                                        <th>Catalog Item Type</th>
                                                        <th>Total Labor</th>
                                                        <th>Difficulty</th>
                                                        <th>Waste</th>
                                                        <th>Total Cost</th>
                                                        <th>Margin</th>
                                                        <th>Total Sales</th>
                                                        <th>Profit</th>
                                                    </tr>
                                                </thead>
                                                <tbody id="summaryTypes"></tbody>
                                            </table>
                                        </div>
                                        <div class="est-summary-section">
                                            <div class="est-summary-title"><span>Pre-Tax Markups</span><button
                                                    type="button" data-est-action="add-pre-markup"><i
                                                        class="fas fa-plus"></i></button></div>
                                            <div id="preMarkupRows" class="est-markup-list"></div>
                                        </div>
                                        <div class="est-summary-section">
                                            <div class="est-summary-title"><span>Taxes</span><button type="button"
                                                    data-est-option="taxes"><i class="fas fa-pen"></i></button></div>
                                            <div id="taxRows" class="est-markup-list"></div>
                                        </div>
                                        <div class="est-summary-section">
                                            <div class="est-summary-title"><span>Post-Tax Markups</span><button
                                                    type="button" data-est-action="add-post-markup"><i
                                                        class="fas fa-plus"></i></button></div>
                                            <div id="postMarkupRows" class="est-markup-list"></div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                            <div class="est-total-box">
                                <div class="est-total-label">Estimate Total</div>
                                <div id="estimateTotal" class="est-total-value">$0.00</div>
                                <div id="estimateSqft" class="est-total-sub">--/sq ft</div>
                            </div>
                        </aside>
                    </div>
                    <div class="est-version-bar" id="versionBar"></div>
                </div>
            </section>
            <section id="tab-proposal" class="tab-panel proposal-page">
                <div id="proposalModule" class="proposal-shell" data-project-id="<?= (int) $projectId ?>">
                    <aside class="proposal-settings" aria-label="Proposal detail settings">
                        <div class="proposal-settings-head">
                            <div>
                                <h2>Detail Settings</h2>
                                <span>Proposal</span>
                            </div>
                            <div class="proposal-export-wrap">
                                <button class="proposal-export-btn" type="button" data-proposal-export-toggle>
                                    <i class="fas fa-file-export"></i><span>Export</span><i
                                        class="fas fa-chevron-down"></i>
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
                        <div class="proposal-builder-note" id="proposalBuilderNote" hidden>Proposal Builder is ready to
                            be connected.</div>
                        <div class="proposal-feature-banner" id="proposalFeatureBanner">
                            <span>Enhanced Itemization in Proposal tab - Easily update proposals with: itemized
                                alternates &amp; assembly items, new customer/contact selection, and new toggles to
                                setup proposal.</span>
                            <button type="button" data-proposal-learn>Learn More</button>
                            <button type="button" data-proposal-dismiss-banner aria-label="Dismiss">x</button>
                        </div>
                        <div class="proposal-document" id="proposalDocument"></div>
                    </main>
                    <footer class="est-version-bar" id="proposalEstimateTypesFooter" aria-label="Available estimates">
                        <span class="est-pill">Loading estimates&hellip;</span>
                    </footer>
                </div>
        </main>
        <footer class="bb-brightronix-footer">
            <span>All Rights Reserved by Brightronix &copy; 2026</span>
        </footer>
    </div>

    <input type="file" id="projectUploadInput" class="d-none">
    <input type="file" id="documentsBrowseInput" class="d-none" multiple>

    <!-- Customer Information Modal -->
    <div class="pd-modal-backdrop" id="pdCustomerModal" role="dialog" aria-modal="true"
        aria-labelledby="customerModalTitle">
        <div class="pd-modal">
            <div class="pd-modal-head">
                <h3 id="customerModalTitle"><i class="far fa-id-badge" style="color: var(--primary);"></i> Customer
                    Information</h3>
                <button class="pd-modal-head-close" type="button" data-close-modal="pdCustomerModal"
                    aria-label="Close">&times;</button>
            </div>
            <div class="pd-modal-body">
                <label class="overview-field full">
                    <span>Select Saved Customer</span>
                    <div style="display: flex; gap: 8px; align-items: center; margin-top: 2px;">
                        <select id="poCustomerSelector" style="flex: 1;">
                            <option value="">-- Choose a saved customer --</option>
                        </select>
                        <button class="pd-card-add-btn" type="button" id="clearCustomerBtn"
                            title="Clear customer fields"><i class="fas fa-eraser"></i></button>
                    </div>
                </label>
                <label class="overview-field">
                    <span>Customer Company</span>
                    <input id="poCustomerCompany" value="<?= htmlspecialchars($customerCompany) ?>">
                </label>
                <label class="overview-field">
                    <span>Primary Contact</span>
                    <input id="poPrimaryContact" value="<?= htmlspecialchars($primaryContact) ?>">
                </label>
                <label class="overview-field">
                    <span>Phone</span>
                    <input id="poCustomerPhone" value="<?= htmlspecialchars($customerPhone) ?>">
                </label>
                <label class="overview-field">
                    <span>Email</span>
                    <input id="poCustomerEmail" type="email" value="<?= htmlspecialchars($customerEmail) ?>">
                </label>
                <label class="overview-field full">
                    <span>Company Address</span>
                    <input id="poCustomerAddress" value="<?= htmlspecialchars($customerAddress) ?>">
                </label>
            </div>
            <div class="pd-modal-foot">
                <button type="button" class="btn-ghost" data-close-modal="pdCustomerModal">Cancel</button>
                <button type="button" class="btn-main orange" id="applyCustomerModalBtn"><i class="fas fa-check"></i>
                    Apply &amp; Close</button>
            </div>
        </div>
    </div>

    <!-- Project Address Modal -->
    <div class="pd-modal-backdrop" id="pdAddressModal" role="dialog" aria-modal="true"
        aria-labelledby="addressModalTitle">
        <div class="pd-modal" style="width: min(480px, 100%);">
            <div class="pd-modal-head">
                <h3 id="addressModalTitle"><i class="fas fa-location-dot" style="color: var(--primary);"></i> Project
                    Jobsite Address</h3>
                <button class="pd-modal-head-close" type="button" data-close-modal="pdAddressModal"
                    aria-label="Close">&times;</button>
            </div>
            <div class="pd-modal-body" style="grid-template-columns: 1fr;">
                <label class="overview-field full">
                    <span>Project Jobsite Address</span>
                    <textarea id="poProjectAddress" rows="3" class="pd-composer-textarea"
                        placeholder="Enter full project job address..."><?= htmlspecialchars($project['job_address'] ?? '') ?></textarea>
                </label>
            </div>
            <div class="pd-modal-foot">
                <button type="button" class="btn-ghost" data-close-modal="pdAddressModal">Cancel</button>
                <button type="button" class="btn-main orange" id="applyAddressModalBtn"><i class="fas fa-check"></i>
                    Apply Address</button>
            </div>
        </div>
    </div>

    <!-- Note Creation / Edit Modal -->
    <div class="pd-modal-backdrop" id="pdNoteModal" role="dialog" aria-modal="true" aria-labelledby="noteModalTitle">
        <div class="pd-modal" style="width: min(480px, 100%);">
            <div class="pd-modal-head">
                <h3 id="noteModalTitle"><i class="fas fa-sticky-note" style="color: var(--primary);"></i> Add Note</h3>
                <button class="pd-modal-head-close" type="button" data-close-modal="pdNoteModal"
                    aria-label="Close">&times;</button>
            </div>
            <div class="pd-modal-body" style="grid-template-columns: 1fr;">
                <input type="hidden" id="modalNoteIndex" value="-1">
                <label class="overview-field full">
                    <span>Note Content</span>
                    <textarea id="modalNoteContent" rows="4" class="pd-composer-textarea"
                        placeholder="Write a note..."></textarea>
                </label>
            </div>
            <div class="pd-modal-foot">
                <button type="button" class="btn-ghost" data-close-modal="pdNoteModal">Cancel</button>
                <button type="button" class="btn-main orange" id="modalSaveNoteBtn"><i class="fas fa-check"></i> Save
                    Note</button>
            </div>
        </div>
    </div>

    <!-- Task Creation / Edit Modal -->
    <div class="pd-modal-backdrop" id="pdTaskModal" role="dialog" aria-modal="true" aria-labelledby="taskModalTitle">
        <div class="pd-modal" style="width: min(500px, 100%);">
            <div class="pd-modal-head">
                <h3 id="taskModalTitle"><i class="fas fa-tasks" style="color: var(--primary);"></i> Create Task</h3>
                <button class="pd-modal-head-close" type="button" data-close-modal="pdTaskModal"
                    aria-label="Close">&times;</button>
            </div>
            <div class="pd-modal-body" style="grid-template-columns: 1fr;">
                <input type="hidden" id="modalTaskIndex" value="-1">
                <label class="overview-field full">
                    <span>Task Title</span>
                    <input id="modalTaskTitle" class="pd-composer-input" placeholder="Task title..." required>
                </label>
                <label class="overview-field full">
                    <span>Assignee (System Users)</span>
                    <div class="pd-input-with-actions">
                        <select id="modalTaskAssignee" class="pd-composer-input">
                            <option value="">-- Select a User --</option>
                        </select>
                        <span class="pd-field-caret"><i class="fas fa-chevron-down"></i></span>
                    </div>
                </label>
                <label class="overview-field full">
                    <span>Due Date &amp; Time</span>
                    <div class="pd-input-icon-wrap">
                        <input id="modalTaskDue" class="pd-composer-input" type="datetime-local">
                        <i class="far fa-calendar-plus pd-input-icon-right" style="pointer-events: none;"></i>
                    </div>
                </label>
            </div>
            <div class="pd-modal-foot">
                <button type="button" class="btn-ghost" data-close-modal="pdTaskModal">Cancel</button>
                <button type="button" class="btn-main orange" id="modalSaveTaskBtn"><i class="fas fa-check"></i> Save
                    Task</button>
            </div>
        </div>
    </div>

    <!-- Document / Folder Rename Modal (Same styling as Note Modal) -->
    <div class="pd-modal-backdrop" id="pdDocRenameModal" role="dialog" aria-modal="true" aria-labelledby="docRenameModalTitle">
        <div class="pd-modal" style="width: min(460px, 100%);">
            <div class="pd-modal-head">
                <h3 id="docRenameModalTitle"><i class="fas fa-pen" style="color: var(--primary);"></i> Rename</h3>
                <button class="pd-modal-head-close" type="button" data-close-modal="pdDocRenameModal"
                    aria-label="Close">&times;</button>
            </div>
            <div class="pd-modal-body" style="grid-template-columns: 1fr;">
                <label class="overview-field full">
                    <span id="docRenameInputLabel">Name</span>
                    <input id="modalDocRenameInput" class="pd-composer-input" placeholder="Enter name..." autocomplete="off">
                </label>
            </div>
            <div class="pd-modal-foot">
                <button type="button" class="btn-ghost" data-close-modal="pdDocRenameModal">Cancel</button>
                <button type="button" class="btn-main orange" id="modalSaveDocRenameBtn"><i class="fas fa-check"></i> Save</button>
            </div>
        </div>
    </div>

    <!-- Item Options Floating Menu for Notes & Tasks -->
    <div class="pd-floating-options-menu" id="pdItemContextMenu" style="display:none;">
        <button type="button" id="pdItemActionEdit"><i class="fas fa-pen"></i> Edit</button>
        <button type="button" class="danger" id="pdItemActionDelete"><i class="fas fa-trash"></i> Delete</button>
    </div>

    <div class="pro-group-modal" id="takeoffGroupModal" hidden>
        <div class="pro-group-dialog" role="dialog" aria-modal="true" aria-labelledby="takeoffGroupModalTitle"
            aria-describedby="takeoffGroupModalDescription">
            <div class="pro-group-dialog-head">
                <div class="pro-group-dialog-icon" aria-hidden="true"><i class="fas fa-folder-plus"></i></div>
                <div>
                    <h2 id="takeoffGroupModalTitle">Create new group</h2>
                    <p id="takeoffGroupModalDescription">Organize related takeoff layers and measurements in one group.
                    </p>
                </div>
                <button class="pro-icon-btn" type="button" data-group-modal-close
                    aria-label="Close create group dialog"><i class="fas fa-times"></i></button>
            </div>
            <form id="takeoffGroupForm" novalidate>
                <label class="pro-group-field" for="takeoffGroupName">
                    <span>Group name</span>
                    <input id="takeoffGroupName" name="groupName" type="text" maxlength="120" autocomplete="off"
                        placeholder="For example, Lighting" required
                        aria-describedby="takeoffGroupNameHint takeoffGroupNameError">
                </label>
                <div class="pro-group-field-meta">
                    <small id="takeoffGroupNameHint">Use a clear scope or system name.</small>
                    <small id="takeoffGroupNameCount">0 / 120</small>
                </div>
                <div class="pro-group-error" id="takeoffGroupNameError" role="alert" hidden></div>
                <div class="pro-group-dialog-actions">
                    <button class="pro-dialog-secondary" type="button" data-group-modal-close>Cancel</button>
                    <button class="pro-dialog-primary" id="takeoffGroupCreateSubmit" type="submit"><i
                            class="fas fa-folder-plus" aria-hidden="true"></i> Create group</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        window.ProjectState = <?= json_encode($state, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;
        <?php if (!empty($_GET['stage'])): ?>
        try {
            localStorage.setItem('takeoff.bidBoardStage', <?= json_encode($_GET['stage']) ?>);
            sessionStorage.setItem('takeoff.bidBoardStage', <?= json_encode($_GET['stage']) ?>);
        } catch (e) {}
        <?php elseif (!empty($project['status'])): ?>
        try {
            localStorage.setItem('takeoff.bidBoardStage', <?= json_encode(dash_status_label($project['status'])) ?>);
            sessionStorage.setItem('takeoff.bidBoardStage', <?= json_encode(dash_status_label($project['status'])) ?>);
        } catch (e) {}
        <?php endif; ?>

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

        document.getElementById('projectUploadInput')?.addEventListener('change', function () {
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
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>
    <script>if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';</script>
    <script src="../assets/project_overview.js?v=doc-modal-confirm-20260925-4"></script>
    <script src="../assets/estimating_catalog_snapshot_service.js?v=estimating-catalog-snapshot-20260827-1"></script>
    <script src="../assets/catalog_change_detection_service.js?v=catalog-change-detection-20260827-1"></script>
    <script src="../assets/takeoff_estimating_sync_service.js?v=estimating-linked-part-20260831-1"></script>
    <script src="../assets/project_estimate_footer.js?v=estimate-menu-all-tabs-20260820-5"></script>
    <script src="../assets/catalog_item_contract.js?v=catalog-item-contract-20260826-1"></script>
    <script src="../assets/catalog_metadata.js?v=catalog-metadata-20260826-1"></script>
    <script src="../assets/catalog_service.js?v=catalog-service-20260826-1"></script>
    <script src="../assets/boq_catalog_adapter.js?v=boq-catalog-boundary-20260826-1"></script>
    <script src="../assets/takeoff_catalog_adapter.js?v=takeoff-catalog-boundary-20260826-1"></script>
    <script src="../assets/takeoff_color_palette.js?v=takeoff-duplicate-color-20260831-1"></script>
    <script src="../assets/project_takeoff.js?v=takeoff-duplicate-edit-persistence-20260831-1"></script>
    <script src="../assets/assembly_expansion_service.js?v=assembly-expansion-20260828-1"></script>
    <script src="../assets/estimating_assembly_expansion_adapter.js?v=estimating-assembly-adapter-20260828-1"></script>
    <script src="../assets/quantity_format_service.js?v=quantity-context-format-20260831-1"></script>
    <script src="../assets/estimate_calculation_service.js?v=estimating-normal-item-quantity-20260831-1"></script>
    <script src="../assets/catalog_update_preview_service.js?v=catalog-update-preview-20260827-1"></script>
    <script src="../assets/estimating_export_service.js?v=estimating-boq-export-20260820-1"></script>
    <script src="../assets/estimating_workspace_service.js?v=estimating-catalog-snapshot-20260827-1"></script>
    <script src="../assets/catalog_update_application_service.js?v=catalog-update-application-20260827-2"></script>
    <script src="../assets/estimating_catalog_adapter.js?v=estimating-catalog-snapshot-20260827-1"></script>
    <script src="../assets/project_estimating.js?v=estimating-assembly-hierarchy-20260902-1"></script>
    <script src="../assets/catalog_update_ui.js?v=catalog-update-ui-20260827-1"></script>
    <script src="../assets/project_proposal.js?v=quantity-context-format-20260831-1"></script>
    <script src="../assets/global_tools.js"></script>
</body>

</html>