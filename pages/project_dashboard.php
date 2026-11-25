<?php
require_once __DIR__ . '/../core/auth/session.php';
$authRedirect = takeoff_require_page_auth($_SESSION ?? null);
if ($authRedirect !== null) return;
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/auth/ProjectAccess.php';
require_once __DIR__ . '/../core/config/WonProjectIntegrationConfig.php';

if (empty($_SESSION['won_project_csrf_token'])) {
    $_SESSION['won_project_csrf_token'] = bin2hex(random_bytes(32));
}
$wonProjectCsrfToken = (string) $_SESSION['won_project_csrf_token'];
$authUser = SessionGuard::getAuthenticatedUser($_SESSION ?? null);
$authRole = $authUser['role'] ?? SessionGuard::ROLE_VIEWER;
$isAdminUser = $authRole === SessionGuard::ROLE_ADMIN;
$canWrite = $isAdminUser;
$authDisplayName = trim((string) ($_SESSION['display_name'] ?? $_SESSION['name'] ?? $authUser['username'] ?? ''));
if ($authDisplayName === '') {
    $authDisplayName = $isAdminUser ? 'Admin' : 'Viewer';
}
$parts = preg_split('/\s+/', $authDisplayName, -1, PREG_SPLIT_NO_EMPTY);
if (count($parts) >= 2) {
    $firstChar = function_exists('mb_substr') ? mb_substr($parts[0], 0, 1) : substr($parts[0], 0, 1);
    $lastChar = function_exists('mb_substr') ? mb_substr(end($parts), 0, 1) : substr(end($parts), 0, 1);
    $selfInitials = strtoupper($firstChar . $lastChar);
} else {
    $selfInitials = strtoupper(function_exists('mb_substr') ? mb_substr($authDisplayName, 0, 2) : substr($authDisplayName, 0, 2));
}
if ($selfInitials === '') {
    $selfInitials = $isAdminUser ? 'AD' : 'VW';
}
$selfName = $authDisplayName;
$selfRole = ucfirst($authRole ?: 'Estimator');

$clientAuthMetadata = [
    'displayName' => $authDisplayName,
    'role' => $authRole,
    'canWrite' => $canWrite,
    'readOnly' => !$canWrite,
];

$integrationEnabled = false;
try {
    $wonConfig = WonProjectIntegrationConfig::load();
    $integrationEnabled = $wonConfig->isExportEnabled();
} catch (Throwable) {
    $integrationEnabled = false;
}

$projectId = (int) ($_GET['id'] ?? $_GET['project_id'] ?? 0);
$isDraftProject = $projectId <= 0 && isset($_GET['draft']);
$canWrite = $isDraftProject
    ? in_array($authRole, ['admin', 'estimator'], true)
    : ($projectId > 0 && ProjectAccess::can($pdo, $authUser, $projectId, ProjectAccess::WRITE));
if ($projectId > 0) {
    takeoff_guard_project_access($pdo, $authUser, $projectId, ProjectAccess::READ);
}
$clientAuthMetadata['canWrite'] = $canWrite;
$clientAuthMetadata['readOnly'] = !$canWrite;
$activeTab = $_GET['tab'] ?? 'overview';
$selectedDocumentId = (int) ($_GET['file_id'] ?? $_GET['document_id'] ?? 0);

if (!function_exists('dash_table_exists')) {
    function dash_table_exists(PDO $pdo, string $table): bool
    {
        static $tableCache = [];
        $cacheKey = spl_object_id($pdo) . ':' . $table;
        if (array_key_exists($cacheKey, $tableCache)) {
            return $tableCache[$cacheKey];
        }
        try {
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?");
            $stmt->execute([$table]);
            return $tableCache[$cacheKey] = ((int) $stmt->fetchColumn() > 0);
        } catch (Throwable $e) {
            return $tableCache[$cacheKey] = false;
        }
    }
}

if (!function_exists('dash_column_exists')) {
    function dash_column_exists(PDO $pdo, string $table, string $column): bool
    {
        static $colCache = [];
        $cacheKey = spl_object_id($pdo) . ':' . $table . '.' . $column;
        if (array_key_exists($cacheKey, $colCache)) {
            return $colCache[$cacheKey];
        }
        try {
            $stmt = $pdo->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
            $stmt->execute([$column]);
            return $colCache[$cacheKey] = (bool) $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $e) {
            return $colCache[$cacheKey] = false;
        }
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
        'templates' => 'Templates',
        'template' => 'Templates',
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
$catalogItemMetaMap = [];
if ($projectId > 0 && dash_table_exists($pdo, 'takeoff_layers') && dash_table_exists($pdo, 'takeoffs')) {
    $hasLayerProjectId = dash_column_exists($pdo, 'takeoff_layers', 'project_id');
    $stmt = $pdo->prepare($hasLayerProjectId ? "
        SELECT tl.*, COALESCE(NULLIF(tl.drawing_id, 0), t.drawing_id) AS resolved_drawing_id
        FROM takeoff_layers tl
        LEFT JOIN takeoffs t ON t.id = tl.takeoff_id AND t.deleted_at IS NULL
        WHERE (tl.project_id = ? OR t.project_id = ?) AND tl.deleted_at IS NULL
        ORDER BY tl.sort_order ASC, tl.id DESC
    " : "
        SELECT tl.*, t.drawing_id AS resolved_drawing_id
        FROM takeoff_layers tl
        INNER JOIN takeoffs t ON t.id = tl.takeoff_id
        WHERE t.project_id = ? AND t.deleted_at IS NULL
        ORDER BY tl.sort_order ASC, tl.id DESC
    ");
    $catalogItemMetaMap = [];
    $stmt->execute($hasLayerProjectId ? [$projectId, $projectId] : [$projectId]);
    $takeoffLayers = array_map(function ($tl) use (&$catalogItemMetaMap) {
        if (empty($tl['drawing_id']) && !empty($tl['resolved_drawing_id'])) {
            $tl['drawing_id'] = (int) $tl['resolved_drawing_id'];
        }
        unset($tl['resolved_drawing_id']);
        if (!empty($tl['metadata_json'])) {
            $meta = is_array($tl['metadata_json']) ? $tl['metadata_json'] : json_decode((string) $tl['metadata_json'], true);
            if (is_array($meta)) {
                if (isset($meta['difficulty']) && !isset($tl['difficulty'])) {
                    $tl['difficulty'] = (float) $meta['difficulty'];
                }
                if (isset($meta['multiplier']) && !isset($tl['multiplier'])) {
                    $tl['multiplier'] = (float) $meta['multiplier'];
                }
                if (empty($tl['drawing_id']) && !empty($meta['file_drawing_id'])) {
                    $tl['drawing_id'] = (int) $meta['file_drawing_id'];
                }
                if (!empty($meta['catalog_item']) && is_array($meta['catalog_item'])) {
                    $ciJson = json_encode($meta['catalog_item'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                    $ciId = trim((string) ($meta['catalog_item']['catalogItemId'] ?? $meta['catalog_item']['id'] ?? $tl['catalog_item_id'] ?? 'anon'));
                    if ($ciId === '') {
                        $ciId = 'anon';
                    }
                    $refKey = $ciId . ':' . substr(sha1((string) $ciJson), 0, 10);
                    if (!isset($catalogItemMetaMap[$refKey])) {
                        $catalogItemMetaMap[$refKey] = $meta['catalog_item'];
                    }
                    unset($meta['catalog_item']);
                    $meta['catalog_item_ref'] = $refKey;
                    $tl['metadata_json'] = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                }
            }
        }
        return $tl;
    }, $stmt->fetchAll(PDO::FETCH_ASSOC));
}

$takeoffDrawingStates = [];
if ($projectId > 0 && dash_table_exists($pdo, 'takeoff_estimate_states')) {
    try {
        $stmtStates = $pdo->prepare("
            SELECT estimate_key, drawing_id, state_json, updated_at
            FROM takeoff_estimate_states
            WHERE project_id = ? AND drawing_id > 0
            ORDER BY updated_at ASC
        ");
        $stmtStates->execute([$projectId]);
        foreach ($stmtStates->fetchAll(PDO::FETCH_ASSOC) as $stRow) {
            $estKey = trim((string) ($stRow['estimate_key'] ?? ''));
            $did = (int) ($stRow['drawing_id'] ?? 0);
            if ($estKey === '' || $did <= 0)
                continue;
            $decoded = json_decode((string) ($stRow['state_json'] ?? '{}'), true);
            if (!is_array($decoded))
                continue;
            $rawLayers = is_array($decoded['layers'] ?? null) ? $decoded['layers'] : [];
            $rawMarkers = is_array($decoded['markers'] ?? null) ? $decoded['markers'] : [];
            $rawSegments = is_array($decoded['segments'] ?? null) ? $decoded['segments'] : [];
            $shapesByLayer = [];
            foreach ($rawMarkers as $m) {
                if (!is_array($m))
                    continue;
                $lid = (string) ($m['layer_client_uid'] ?? $m['layer_id'] ?? '');
                if ($lid === '')
                    continue;
                $mult = isset($m['multiplier']) && $m['multiplier'] !== '' ? (float) $m['multiplier'] : 1.0;
                $qVal = isset($m['quantity']) && $m['quantity'] !== '' ? (float) $m['quantity'] : $mult;
                $shapesByLayer[$lid][] = [
                    'id' => (string) ($m['client_uid'] ?? $m['id'] ?? ''),
                    'client_uid' => (string) ($m['client_uid'] ?? $m['id'] ?? ''),
                    'layerId' => $lid,
                    'documentId' => (string) $did,
                    'pageNumber' => max(1, (int) ($m['page_number'] ?? 1)),
                    'type' => 'Count',
                    'quantityValue' => $qVal,
                    'quantity' => $qVal,
                ];
            }
            foreach ($rawSegments as $s) {
                if (!is_array($s))
                    continue;
                $lid = (string) ($s['layer_client_uid'] ?? $s['layer_id'] ?? '');
                if ($lid === '')
                    continue;
                $isArea = strtolower((string) ($s['takeoff_type'] ?? $s['type'] ?? '')) === 'area';
                $qVal = (float) ($isArea
                    ? ($s['total_area'] ?? $s['measured_area'] ?? $s['total_length'] ?? 0)
                    : ($s['total_length'] ?? $s['measured_length'] ?? 0));
                $shapesByLayer[$lid][] = [
                    'id' => (string) ($s['client_uid'] ?? $s['id'] ?? ''),
                    'client_uid' => (string) ($s['client_uid'] ?? $s['id'] ?? ''),
                    'layerId' => $lid,
                    'documentId' => (string) $did,
                    'pageNumber' => max(1, (int) ($s['page_number'] ?? 1)),
                    'type' => $isArea ? 'Area' : 'Linear',
                    'quantityValue' => $qVal,
                    'quantity' => $qVal,
                ];
            }
            $compactLayers = [];
            $seenCompactLayerIds = [];
            foreach ($rawLayers as $rl) {
                if (!is_array($rl))
                    continue;
                $lid = (string) ($rl['client_uid'] ?? $rl['id'] ?? '');
                if ($lid === '' || isset($seenCompactLayerIds[$lid]))
                    continue;
                $seenCompactLayerIds[$lid] = true;
                $meta = is_array($rl['metadata_json'] ?? null) ? $rl['metadata_json'] : [];
                $baseQty = (float) ($rl['baseQuantity'] ?? $rl['base_quantity'] ?? $rl['seed_quantity'] ?? $meta['base_quantity'] ?? 0);
                $compactLayers[] = [
                    'id' => $lid,
                    'layerId' => $lid,
                    'client_uid' => $lid,
                    'name' => (string) ($rl['name'] ?? ''),
                    'color' => (string) ($rl['color'] ?? '#2563eb'),
                    'symbol' => (string) ($rl['symbol'] ?? 'circle'),
                    'type' => (string) ($rl['takeoff_type'] ?? $rl['type'] ?? 'count'),
                    'unit_of_measure' => (string) ($rl['unit_of_measure'] ?? 'ea'),
                    'quantity' => (float) ($rl['quantity'] ?? 0),
                    'baseQuantity' => $baseQty,
                    'base_quantity' => $baseQty,
                    'seed_quantity' => $baseQty,
                    'shapes' => $shapesByLayer[$lid] ?? [],
                ];
            }
            $takeoffDrawingStates[] = [
                'estimateId' => $estKey,
                'estimateKey' => $estKey,
                'drawingId' => $did,
                'documentId' => (string) $did,
                'updatedAt' => (string) ($stRow['updated_at'] ?? ''),
                'layers' => $compactLayers,
            ];
        }
    } catch (Throwable $e) {
        // Tolerate missing migration table in older environments
    }
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
                SELECT layer_id, page_number, COUNT(id) AS mark_count, SUM(quantity) AS total_qty
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
                SELECT layer_id, page_number, COUNT(id) AS mark_count, SUM(total_length) AS total_qty
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

$projectMeta = [];
if (!empty($project['metadata_json'])) {
    $decodedMeta = json_decode((string) $project['metadata_json'], true);
    if (is_array($decodedMeta)) {
        $projectMeta = $decodedMeta;
    }
}

$dashEstimatesSummary = [];
$hasPopulatedWorkspaceState = false;
$resolvedActiveEstimateId = trim((string) ($projectMeta['primary_estimate_id'] ?? ''));
if ($projectId > 0 && dash_table_exists($pdo, 'estimates')) {
    try {
        $hasWsState = dash_table_exists($pdo, 'estimate_workspace_states');
        $estSql = $hasWsState
            ? "SELECT e.id, e.name, e.total_cost, ws.client_estimate_id, ws.state_json FROM estimates e LEFT JOIN estimate_workspace_states ws ON ws.estimate_id = e.id WHERE e.project_id = ? AND e.deleted_at IS NULL ORDER BY e.id ASC"
            : "SELECT e.id, e.name, e.total_cost, NULL AS client_estimate_id, NULL AS state_json FROM estimates e WHERE e.project_id = ? AND e.deleted_at IS NULL ORDER BY e.id ASC";
        $estRowsStmt = $pdo->prepare($estSql);
        $estRowsStmt->execute([$projectId]);
        $estRows = $estRowsStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $activeCandidate = '';
        $primaryCandidate = '';
        foreach ($estRows as $er) {
            $snap = !empty($er['state_json']) ? json_decode((string) $er['state_json'], true) : [];
            if (!is_array($snap))
                $snap = [];
            if (!empty($snap) && isset($snap['groups']) && is_array($snap['groups'])) {
                $hasPopulatedWorkspaceState = true;
            }
            $estItemCount = 0;
            foreach (($snap['groups'] ?? []) as $wsGroup) {
                if (is_array($wsGroup) && !empty($wsGroup['items']) && is_array($wsGroup['items'])) {
                    $estItemCount += count($wsGroup['items']);
                }
            }
            $cid = trim((string) ($er['client_estimate_id'] ?: ($snap['id'] ?? $er['id'])));
            $isPrim = !empty($snap['isPrimary']) || !empty($snap['is_primary']);
            $isAct = !empty($snap['isActive']);
            $estVal = (float) ($snap['estimateTotal'] ?? $snap['totalSales'] ?? $er['total_cost'] ?? 0);
            $dashEstimatesSummary[] = [
                'id' => $cid,
                'dbEstimateId' => (int) $er['id'],
                'name' => (string) ($snap['name'] ?? $er['name'] ?? 'Estimate'),
                'isPrimary' => $isPrim,
                'is_primary' => $isPrim,
                'isActive' => $isAct,
                'estimateTotal' => $estVal,
                'totalSales' => $estVal,
                'itemCount' => $estItemCount,
            ];
            if ($isAct && $activeCandidate === '')
                $activeCandidate = $cid;
            if ($isPrim && $primaryCandidate === '')
                $primaryCandidate = $cid;
        }
        if ($activeCandidate !== '') {
            $resolvedActiveEstimateId = $activeCandidate;
        } elseif ($primaryCandidate !== '') {
            $resolvedActiveEstimateId = $primaryCandidate;
        } elseif (!empty($dashEstimatesSummary)) {
            $resolvedActiveEstimateId = (string) $dashEstimatesSummary[0]['id'];
        }
        if ($resolvedActiveEstimateId === '' && !empty($takeoffLayers[0]['estimate_key'])) {
            $resolvedActiveEstimateId = (string) $takeoffLayers[0]['estimate_key'];
        }
        if ($primaryCandidate !== '') {
            $projectMeta['primary_estimate_id'] = $primaryCandidate;
        } elseif ($resolvedActiveEstimateId !== '' && empty($projectMeta['primary_estimate_id'])) {
            $projectMeta['primary_estimate_id'] = $resolvedActiveEstimateId;
        }
    } catch (Throwable $e) {
    }
}
if ($resolvedActiveEstimateId === '' && !empty($takeoffLayers[0]['estimate_key'])) {
    $resolvedActiveEstimateId = (string) $takeoffLayers[0]['estimate_key'];
}
if ($resolvedActiveEstimateId === '') {
    $resolvedActiveEstimateId = 'est_primary';
}

$estimateItems = [];
$estimateItemAggTotals = null;
if ($projectId > 0 && dash_table_exists($pdo, 'estimate_items') && dash_table_exists($pdo, 'estimates')) {
    if ($hasPopulatedWorkspaceState) {
        try {
            $aggStmt = $pdo->prepare("
                SELECT
                    COALESCE(SUM(ei.material_cost), 0) AS material_subtotal,
                    COALESCE(SUM(ei.labor_cost), 0) AS labor_subtotal,
                    COALESCE(SUM(ei.equipment_cost), 0) AS equipment_subtotal,
                    COALESCE(SUM(COALESCE(ei.total_cost, ei.subtotal_cost, 0)), 0) AS estimate_total,
                    COALESCE(SUM(COALESCE(ei.subtotal_cost, 0) * (COALESCE(ei.waste_factor_percent, ei.waste_percentage, 0) / 100)), 0) AS waste_total,
                    COALESCE(SUM(COALESCE(ei.subtotal_cost, 0) * (COALESCE(ei.markup_percent, ei.margin_percentage, 0) / 100)), 0) AS markup_total
                FROM estimate_items ei
                INNER JOIN estimates e ON e.id = ei.estimate_id
                WHERE e.project_id = ? AND ei.deleted_at IS NULL AND e.deleted_at IS NULL
            ");
            $aggStmt->execute([$projectId]);
            $estimateItemAggTotals = $aggStmt->fetch(PDO::FETCH_ASSOC) ?: null;
        } catch (Throwable $e) {
            $estimateItemAggTotals = null;
        }
    }
    if ($estimateItemAggTotals === null) {
        $stmt = $pdo->prepare("
            SELECT ei.*, ci.name AS catalog_item_name
            FROM estimate_items ei
            INNER JOIN estimates e ON e.id = ei.estimate_id
            LEFT JOIN catalog_items ci ON ci.id = ei.catalog_item_id
            WHERE e.project_id = ? AND ei.deleted_at IS NULL AND e.deleted_at IS NULL
            ORDER BY ei.sort_order ASC, ei.id DESC
        ");
        $stmt->execute([$projectId]);
        $estimateItems = array_map(function ($ei) {
            if (!empty($ei['metadata_json'])) {
                $meta = is_array($ei['metadata_json']) ? $ei['metadata_json'] : json_decode($ei['metadata_json'], true);
                if (is_array($meta)) {
                    $ws = isset($meta['workspace']) && is_array($meta['workspace']) ? $meta['workspace'] : $meta;
                    if (isset($ws['difficulty']) && !isset($ei['difficulty'])) {
                        $ei['difficulty'] = (float) $ws['difficulty'];
                    }
                    if (isset($ws['laborWaste']) && !isset($ei['laborWaste'])) {
                        $ei['laborWaste'] = (float) $ws['laborWaste'];
                    }
                    if (isset($ws['laborMargin']) && !isset($ei['laborMargin'])) {
                        $ei['laborMargin'] = (float) $ws['laborMargin'];
                    }
                    if (isset($ws['factorOverride']) && !isset($ei['factorOverride'])) {
                        $ei['factorOverride'] = (float) $ws['factorOverride'];
                    }
                    if (isset($ws['ratio']) && !isset($ei['ratio'])) {
                        $ei['ratio'] = (float) $ws['ratio'];
                    }
                    if (isset($ws['children']) && !isset($ei['children'])) {
                        $ei['children'] = $ws['children'];
                    }
                }
            }
            return $ei;
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }
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
    } catch (Throwable $e) {
    }
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
    } catch (Throwable $e) {
    }
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
if ($estimateItemAggTotals !== null) {
    $materialSubtotal = (float) ($estimateItemAggTotals['material_subtotal'] ?? 0);
    $laborSubtotal = (float) ($estimateItemAggTotals['labor_subtotal'] ?? 0);
    $equipmentSubtotal = (float) ($estimateItemAggTotals['equipment_subtotal'] ?? 0);
    $estimateTotal = (float) ($estimateItemAggTotals['estimate_total'] ?? 0);
    $wasteTotal = (float) ($estimateItemAggTotals['waste_total'] ?? 0);
    $markupTotal = (float) ($estimateItemAggTotals['markup_total'] ?? 0);
} else {
    foreach ($estimateItems as $item) {
        $materialSubtotal += (float) ($item['material_cost'] ?? 0);
        $laborSubtotal += (float) ($item['labor_cost'] ?? 0);
        $equipmentSubtotal += (float) ($item['equipment_cost'] ?? 0);
        $estimateTotal += (float) ($item['total_cost'] ?? $item['subtotal_cost'] ?? 0);
        $wasteTotal += ((float) ($item['subtotal_cost'] ?? 0)) * ((float) ($item['waste_factor_percent'] ?? $item['waste_percentage'] ?? 0) / 100);
        $markupTotal += ((float) ($item['subtotal_cost'] ?? 0)) * ((float) ($item['markup_percent'] ?? $item['margin_percentage'] ?? 0) / 100);
    }
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
    'activeEstimateId' => $resolvedActiveEstimateId,
    'estimatesSummary' => $dashEstimatesSummary,
    'projectInfo' => $project,
    'projectMeta' => $projectMeta,
    'documents' => $documents,
    'folders' => $displayFolders,
    'selectedDocumentId' => $selectedDocumentId,
    'selectedDrawingId' => $selectedDocumentId,
    'takeoffGroups' => [],
    'takeoffLayers' => $takeoffLayers,
    'catalogItemMetaMap' => $catalogItemMetaMap,
    'takeoffLocations' => $takeoffLocations,
    'takeoffDrawingStates' => $takeoffDrawingStates,
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
    <link rel="stylesheet"
        href="../assets/global_tools.css?v=<?= filemtime(__DIR__ . '/../assets/global_tools.css') ?>">
    <link rel="stylesheet"
        href="../assets/design_system.css?v=<?= filemtime(__DIR__ . '/../assets/design_system.css') ?>">
    <link rel="stylesheet"
        href="../assets/project_dashboard.css?v=<?= filemtime(__DIR__ . '/../assets/project_dashboard.css') ?>">
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
    <link rel="stylesheet"
        href="../assets/project_overview.css?v=<?= filemtime(__DIR__ . '/../assets/project_overview.css') ?>">
    <link rel="stylesheet"
        href="../assets/project_takeoff.css?v=<?= filemtime(__DIR__ . '/../assets/project_takeoff.css') ?>">
    <link rel="stylesheet"
        href="../assets/project_estimating.css?v=<?= filemtime(__DIR__ . '/../assets/project_estimating.css') ?>">
    <link rel="stylesheet"
        href="../assets/project_proposal.css?v=<?= filemtime(__DIR__ . '/../assets/project_proposal.css') ?>">
    <link rel="stylesheet"
        href="../assets/won_project_export.css?v=<?= filemtime(__DIR__ . '/../assets/won_project_export.css') ?>">
</head>

<body data-user-role="<?= htmlspecialchars($authRole, ENT_QUOTES, 'UTF-8') ?>"
    data-can-write="<?= $canWrite ? 'true' : 'false' ?>" data-read-only="<?= $canWrite ? 'false' : 'true' ?>">
    <?php include __DIR__ . '/../views/global_tools_header.php'; ?>
    <div class="workspace-shell">
        <div
            class="project-subhead-wrapper <?= $activeTab === 'takeoff' ? 'is-takeoff-tab' : ($activeTab === 'documents' ? 'is-documents-tab' : ($activeTab === 'estimating' ? 'is-estimating-tab' : '')) ?>">
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
                        <?php if ($projectId > 0): ?>
                            <div class="won-export-container" id="wonProjectExportContainer">
                                <?php if ($isAdminUser): ?>
                                    <button type="button" class="btn-retry-export" id="retryWonExportBtn" style="display:none;">
                                        <i class="fas fa-arrows-rotate"></i>
                                        <span>Retry Export</span>
                                    </button>
                                <?php endif; ?>
                                <span class="won-export-status-badge" id="wonExportStatusBadge" style="display:none;">
                                    <span class="won-export-dot"></span>
                                    <span class="won-export-label" id="wonExportStatusLabel"></span>
                                    <span class="won-export-meta" id="wonExportStatusMeta"></span>
                                </span>
                                <div class="won-export-alert" id="wonProjectAlert" role="alert" aria-live="polite"
                                    style="display:none;"></div>
                            </div>
                        <?php endif; ?>
                        <!-- Active Takeoff Item info with quick actions -->
                        <div class="takeoff-subhead-item-info" id="takeoffSubheadItemInfo" style="display:none;"
                            title="Active Takeoff Item">
                            <div class="takeoff-subhead-item-main">
                                <span class="pro-active-layer-dot" id="takeoffSubheadItemDot"></span>
                                <strong class="takeoff-subhead-item-name" id="takeoffSubheadItemName"></strong>
                                <span class="takeoff-subhead-item-meta" id="takeoffSubheadItemMeta"></span>
                            </div>
                            <div class="takeoff-subhead-item-divider"></div>
                            <div class="takeoff-subhead-item-actions">
                                <button type="button" class="subhead-item-act-btn" data-subhead-item-action="copy"
                                    title="Copy item or selection">
                                    <i class="fas fa-copy"></i><span>Copy</span>
                                </button>
                                <button type="button" class="subhead-item-act-btn" data-subhead-item-action="move"
                                    title="Move item to group">
                                    <i class="fas fa-folder-tree"></i><span>Move to</span>
                                </button>
                                <button type="button" class="subhead-item-act-btn danger"
                                    data-subhead-item-action="delete" title="Delete item or selection">
                                    <i class="fas fa-trash"></i><span>Delete</span>
                                </button>
                            </div>
                        </div>
                        <!-- Selected Documents info with quick actions (Independent from Takeoff) -->
                        <div class="takeoff-subhead-item-info documents-subhead-item-info" id="documentsSubheadItemInfo"
                            style="display:none;" title="Selected Documents">
                            <div class="takeoff-subhead-item-main">
                                <span class="pro-active-layer-dot" id="documentsSubheadItemDot"><i class="fas fa-folder"
                                        style="color: #f59e0b; font-size: 11.5px;"></i></span>
                                <strong class="takeoff-subhead-item-name" id="documentsSubheadItemName"></strong>
                                <span class="takeoff-subhead-item-meta" id="documentsSubheadItemMeta"></span>
                            </div>
                            <div class="takeoff-subhead-item-divider"></div>
                            <div class="takeoff-subhead-item-actions" id="documentsSubheadItemActions">
                                <button type="button" class="subhead-item-act-btn"
                                    data-doc-subhead-action="move-takeoff" title="Move selected documents to Takeoff">
                                    <i class="fas fa-folder-tree"></i><span>Move to Takeoff</span>
                                </button>
                                <button type="button" class="subhead-item-act-btn danger"
                                    data-doc-subhead-action="delete-all" title="Delete selected documents">
                                    <i class="fas fa-trash"></i><span>Delete All</span>
                                </button>
                            </div>
                        </div>
                        <!-- Selected Estimating Items info with quick actions (Independent from Takeoff & Documents) -->
                        <div class="takeoff-subhead-item-info estimating-subhead-item-info"
                            id="estimatingSubheadItemInfo" style="display:none;" title="Selected Estimate Items">
                            <div class="takeoff-subhead-item-main">
                                <span class="pro-active-layer-dot" id="estimatingSubheadItemDot"><i
                                        class="fas fa-list-check" style="color: #fb5a3a; font-size: 11.5px;"></i></span>
                                <strong class="takeoff-subhead-item-name" id="estimatingSubheadItemName"></strong>
                                <span class="takeoff-subhead-item-meta" id="estimatingSubheadItemMeta"></span>
                            </div>
                            <div class="takeoff-subhead-item-divider"></div>
                            <div class="takeoff-subhead-item-actions" id="estimatingSubheadItemActions">
                                <button type="button" class="subhead-item-act-btn" data-est-subhead-action="copy"
                                    title="Copy selected items">
                                    <i class="fas fa-copy"></i><span>Copy</span>
                                </button>
                                <button type="button" class="subhead-item-act-btn" data-est-subhead-action="move"
                                    title="Move selected items to group">
                                    <i class="fas fa-folder-tree"></i><span>Move to</span>
                                </button>
                                <button type="button" class="subhead-item-act-btn danger"
                                    data-est-subhead-action="delete" title="Delete selected items">
                                    <i class="fas fa-trash"></i><span>Delete</span>
                                </button>
                            </div>
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
                                title="<?= htmlspecialchars($selfName) ?> (You) - <?= htmlspecialchars($selfRole) ?>">
                                <span><?= htmlspecialchars($selfInitials) ?></span>
                                <span class="pd-presence-dot" title="Active now"></span>
                            </div>
                        </div>
                        <div class="pd-presence-menu" id="pdPresenceMenu">
                            <div class="pd-presence-menu-head">
                                <span>Active in Project</span>
                                <span class="pd-presence-count" id="pdPresenceCount">1 active</span>
                            </div>
                            <div class="pd-presence-list" id="pdPresenceList">
                                <div class="pd-presence-user-row">
                                    <div class="pd-presence-avatar self"
                                        style="background: #5b4364; width: 24px; height: 24px; font-size: 9.5px; margin: 0;">
                                        <span><?= htmlspecialchars($selfInitials) ?></span>
                                    </div>
                                    <div class="pd-presence-user-info">
                                        <span class="pd-presence-user-name"><?= htmlspecialchars($selfName) ?>
                                            (You)</span>
                                        <span class="pd-presence-user-role"><?= htmlspecialchars($selfRole) ?> &bull;
                                            Active now</span>
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
                            <button type="button" data-project-action="copy"><i class="fas fa-copy"></i> Copy
                                Project</button>
                            <button type="button" data-project-action="convert-template"><i
                                    class="fas fa-layer-group"></i> Convert to Template</button>
                            <button type="button" data-project-action="apply-template"><i
                                    class="fas fa-wand-magic-sparkles"></i> Apply Template</button>
                            <button type="button" data-project-action="archive"><i class="fas fa-box-archive"></i>
                                Archive Project</button>
                            <button type="button" class="danger" data-project-action="delete"><i
                                    class="fas fa-trash"></i> Delete Project</button>
                        </div>
                    </div>
                </div>
            </header>

            <nav class="top-tabs" aria-label="Project workspace tabs" role="tablist">
                <div class="top-tabs-nav">
                    <button type="button" data-tab="overview" class="active">Overview</button>
                    <button type="button" data-tab="documents">Documents</button>
                    <button type="button" data-tab="takeoff">Takeoff</button>
                    <button type="button" data-tab="estimating">Estimating</button>
                    <button type="button" data-tab="proposal">Proposal</button>
                </div>
                <!-- Drawings & Sheets + Page Count (Point 7: right next to proposal tab) -->
                <div class="takeoff-subhead-sheet-group" id="takeoffSubheadSheetGroup">
                    <div class="takeoff-subhead-nav-arrows">
                        <button class="pro-icon-btn takeoff-subhead-nav-btn" type="button"
                            data-viewer-command="previous" title="Previous drawing / sheet"
                            aria-label="Previous drawing or sheet"><i class="fas fa-chevron-left"></i></button>
                        <button class="pro-icon-btn takeoff-subhead-nav-btn" type="button" data-viewer-command="next"
                            title="Next drawing / sheet" aria-label="Next drawing or sheet"><i
                                class="fas fa-chevron-right"></i></button>
                    </div>
                    <div class="takeoff-subhead-drawing-wrap">
                        <div class="pro-drawing-selector">
                            <button class="pro-sheet-select pro-sheet-trigger" id="takeoffSheetSelect" type="button"
                                aria-expanded="false">
                                <span
                                    id="takeoffSheetLabel"><?= htmlspecialchars($selectedDoc['filename'] ?? 'No drawing selected') ?></span>
                                <i class="fas fa-chevron-down"></i>
                            </button>
                            <div class="pro-drawing-dropdown" id="takeoffDrawingDropdown" aria-label="Drawing selector"
                                role="dialog" aria-modal="true" aria-labelledby="takeoffDrawingDialogTitle">
                                <div class="pro-drawing-dropdown-head">
                                    <div>
                                        <strong id="takeoffDrawingDialogTitle">Drawings &amp; Sheets</strong>
                                    </div>
                                    <button class="pro-icon-btn" type="button" data-drawing-close
                                        aria-label="Close drawing selector"><i class="fas fa-times"></i></button>
                                </div>
                                <div class="pro-drawing-active-bar" id="takeoffDrawingActiveBar"
                                    style="display: none !important;" hidden>
                                    <div class="pro-drawing-active-info" id="takeoffDrawingActiveInfo">
                                        <span class="pro-drawing-active-label">Item Activo:</span>
                                        <span class="pro-drawing-active-pill" id="takeoffDrawingActivePill">
                                            <span class="pro-drawing-active-dot" id="takeoffDrawingActiveDot"></span>
                                            <span id="takeoffDrawingActiveText">Ning&uacute;n item seleccionado</span>
                                        </span>
                                    </div>
                                    <div class="pro-drawing-filters">
                                        <button class="pro-drawing-filter-btn" id="takeoffFilterAllSheets" type="button"
                                            data-drawing-filter="all">Todas las Hojas</button>
                                        <button class="pro-drawing-filter-btn" id="takeoffFilterItemSheets"
                                            type="button" data-drawing-filter="item">Solo con este Item <span
                                                class="pro-filter-count" id="takeoffFilterItemCount">0</span></button>
                                    </div>
                                </div>
                                <div class="pro-drawing-search">
                                    <div class="pro-drawing-search-wrap">
                                        <input id="takeoffDrawingSearch" type="search"
                                            placeholder="Search drawing or sheet...">
                                        <i class="fas fa-magnifying-glass"></i>
                                    </div>
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
                                        <div class="pro-drawing-col-title">Preview</div>
                                        <div class="pro-preview-container">
                                            <div id="takeoffSheetPreview" class="pro-preview-box">
                                                <span>Select a sheet</span>
                                            </div>
                                            <div id="takeoffPreviewDetails" class="pro-preview-details">
                                                <div class="pro-preview-sheet-header">
                                                    <h4 id="takeoffPreviewTitle">Select a sheet</h4>
                                                    <span id="takeoffPreviewSub" class="pro-preview-sheet-sub"></span>
                                                </div>
                                                <section class="pro-preview-takeoff-section" aria-label="Takeoff items on this sheet">
                                                    <div class="pro-preview-section-title">
                                                        <span>Takeoff Items</span>
                                                        <span id="takeoffPreviewItemCount" class="pro-preview-item-count">0 items (0 marks)</span>
                                                    </div>
                                                    <div id="takeoffPreviewItemsList" class="pro-preview-items-list">
                                                        <div class="pro-preview-empty-takeoff">Select a sheet to inspect its takeoff items.</div>
                                                    </div>
                                                </section>
                                                <button id="takeoffOpenSheetBtn" class="pro-open-sheet-btn" type="button" disabled>
                                                    <i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i>
                                                    Open Sheet
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <button class="pro-actions-btn takeoff-subhead-compare-btn" id="takeoffCompareBtn" type="button"
                        title="Compare drawings">
                        <i class="fas fa-code-compare"></i><span>Compare</span>
                    </button>
                </div>
                <!-- Right tools: Drawing Scale aligned directly underneath Save Project -->
                <div class="takeoff-subhead-tabs-tools" id="takeoffSubheadTabsTools">
                    <div class="takeoff-subhead-scale-slot" id="takeoffSubheadScaleSlot">
                        <div class="pro-scale-wrap">
                            <button class="pro-scale-status" id="takeoffScaleStatus" type="button" data-scale-toggle
                                aria-expanded="false">
                                <span class="pro-scale-dot"></span>
                                <i class="fas fa-triangle-exclamation" style="display:none;"></i>
                                <span id="takeoffScaleLabel">Not Drawing Scale</span>
                            </button>
                            <div class="pro-scale-panel" id="takeoffScalePanel" aria-label="Takeoff scale calibration">
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
                                <div class="pro-scale-scope-row"
                                    style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--tk-border, #e2e8f0); display: flex; align-items: center; justify-content: space-between; gap: 7px;">
                                    <label
                                        style="cursor: pointer; user-select: none; font-size: 0.72rem; color: var(--tk-text-muted, #64748b); margin: 0; font-weight: 500; display: flex; align-items: center; gap: 7px;">
                                        <input type="checkbox" id="takeoffScaleApplyAll"
                                            style="cursor: pointer; width: 14px; height: 14px; accent-color: var(--tk-primary, #fb5a3a);">
                                        <span>Aplicar a todas las p&aacute;ginas</span>
                                    </label>
                                    <button type="button" id="takeoffScaleApplyBtn" class="pro-toolbar-btn"
                                        style="height: 25px; min-height: 25px; padding: 0 12px; font-size: 0.74rem; border-radius: 4px; background: var(--tk-primary, #fb5a3a); color: #fff; border: none; cursor: pointer; font-weight: 600;">Aplicar</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- Overview: Move to Portfolio centered right under Save Project button in top-tabs -->
                <?php if ($projectId > 0 && $isAdminUser): ?>
                    <div class="overview-subhead-tabs-tools <?= $activeTab === 'overview' ? 'is-overview-tab' : '' ?>"
                        id="overviewSubheadTabsTools" <?= $activeTab !== 'overview' ? 'style="display:none !important;"' : '' ?>>
                        <button type="button" class="btn-mark-won" id="markAsWonBtn" title="Move to Portfolio"
                            aria-label="Move to Portfolio" <?= ($project['status'] ?? '') === 'accepted' ? 'disabled' : '' ?>>
                            <span>Move to Portfolio</span>
                        </button>
                    </div>
                <?php endif; ?>
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
                                    <span>Project Name</span>
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
                                        <select id="poEstimator" class="pd-composer-input"
                                            data-initial-value="<?= htmlspecialchars($estimatorName) ?>">
                                            <option value="">-- Select an Estimator --</option>
                                            <?php foreach ($availableEstimators as $est): ?>
                                                <option value="<?= htmlspecialchars($est['name']) ?>"
                                                    <?= strtolower(trim($estimatorName)) === strtolower(trim($est['name'])) ? 'selected' : '' ?>>
                                                    <?= htmlspecialchars($est['name']) ?>
                                                    (<?= htmlspecialchars($est['role'] ?? 'Estimator') ?>)
                                                </option>
                                            <?php endforeach; ?>
                                            <?php if (!empty($estimatorName) && $estimatorName !== 'Unassigned' && !in_array(strtolower(trim($estimatorName)), array_map(fn($u) => strtolower(trim($u['name'])), $availableEstimators))): ?>
                                                <option value="<?= htmlspecialchars($estimatorName) ?>" selected>
                                                    <?= htmlspecialchars($estimatorName) ?> (Custom)
                                                </option>
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
                        $displayCompany = trim((string) ($customerCompany ?? ''));
                        $displayContact = trim((string) ($primaryContact ?? ''));
                        $displayPhone = trim((string) ($customerPhone ?? ''));
                        $displayEmail = trim((string) ($customerEmail ?? ''));
                        $displayAddress = trim((string) ($project['job_address'] ?? ''));
                        $hasCustomer = ($displayCompany !== '' || $displayContact !== '');
                        $companyInitial = $displayCompany !== '' ? strtoupper(substr($displayCompany, 0, 1)) : 'C';
                        $contactSummaryParts = array_filter([$displayContact, $displayPhone, $displayEmail]);
                        $displayContactSummary = implode(', ', $contactSummaryParts);
                        ?>
                        <section class="overview-card">
                            <div class="overview-card-head">
                                <h2>Customer Information</h2>
                            </div>

                            <!-- Customer Details Display -->
                            <div class="pd-customer-body" id="customerDisplayBlock">
                                <!-- Customer Info: Company Name + Contact Summary + Edit button, or Add Customer -->
                                <div class="pd-customer-section">
                                    <div class="pd-customer-row" id="customerFilledRow"
                                        style="cursor: pointer; <?= $hasCustomer ? 'display:flex;' : 'display:none;' ?>">
                                        <div class="pd-company-avatar" id="customerAvatarLetter">
                                            <?= htmlspecialchars($companyInitial) ?>
                                        </div>
                                        <div class="pd-customer-details"
                                            style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
                                            <div class="pd-customer-name" id="displayCustomerCompany"
                                                style="font-weight: 700; font-size: 13.5px; color: var(--text-main); line-height: 1.25;">
                                                <?= htmlspecialchars($displayCompany ?: 'Customer') ?>
                                            </div>
                                            <div class="pd-contact-sub-line" id="displayContactSummary"
                                                style="font-size: 11.5px; color: var(--text-muted); line-height: 1.25; margin-top: 1px;">
                                                <?= htmlspecialchars($displayContactSummary ?: '') ?>
                                            </div>
                                        </div>
                                        <button class="pd-row-dots-btn" type="button" id="editCustomerInfoBtn"
                                            title="Edit Customer Information"><i class="fas fa-pen"></i></button>
                                    </div>
                                    <button class="pd-add-address-bar" type="button" id="addCustomerBtn"
                                        style="<?= $hasCustomer ? 'display:none;' : 'display:flex;' ?>">
                                        <i class="fas fa-plus"></i> Add Customer
                                    </button>
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
                                                    <?= htmlspecialchars($displayAddress) ?>
                                                </div>
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
                                        $author = $note['user'] ?? 'Isaac De Jesus';
                                        $initial = strtoupper(substr($author, 0, 1)) ?: 'I';
                                        ?>
                                        <div class="pd-note-item" data-note-index="<?= $idx ?>">
                                            <div class="pd-note-avatar"><?= htmlspecialchars($initial) ?></div>
                                            <div class="pd-note-content-wrap">
                                                <div class="pd-note-author"><?= htmlspecialchars($author) ?></div>
                                                <div class="pd-note-time">
                                                    <?= htmlspecialchars($note['timestamp'] ?? 'just now') ?>
                                                </div>
                                                <div class="pd-note-bubble">
                                                    <?= nl2br(htmlspecialchars($note['content'] ?? '')) ?>
                                                </div>
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
                                                <div class="pd-task-meta-row">
                                                    <div class="pd-task-assignee">For
                                                        <?= htmlspecialchars($task['responsible'] ?? 'Isaac De Jesus') ?>
                                                    </div>
                                                    <?php if (!empty($task['due_date'])): ?>
                                                        <div class="pd-task-due-badge">Due
                                                            <?= htmlspecialchars($task['due_date']) ?></div>
                                                    <?php endif; ?>
                                                </div>
                                            </div>
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
                        <svg class="doc-empty-icon" width="130" height="120" viewBox="0 0 130 120" fill="none"
                            xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <!-- Radiating spark rays -->
                            <path d="M52 14L48 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
                            <path d="M65 11V4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
                            <path d="M78 14L82 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />

                            <!-- Blue folders inside box -->
                            <path
                                d="M36 29C36 27.5 37.2 26.5 38.8 26.5H58L62 30H92C93.5 30 94.5 31.2 94.5 32.5V45H36V29Z"
                                fill="#004b9e" />
                            <path
                                d="M38 34C38 32.5 39.2 31.5 40.8 31.5H62L66 35H95C96.5 35 97.5 36.2 97.5 37.5V48H38V34Z"
                                fill="#0055b8" />

                            <!-- Shadow under box -->
                            <ellipse cx="65" cy="114" rx="46" ry="5" class="doc-svg-shadow" />

                            <!-- Box body -->
                            <rect x="33" y="44" width="64" height="64" rx="2" class="doc-svg-box" stroke-width="2.4" />

                            <!-- Top lip line -->
                            <line x1="33" y1="46" x2="97" y2="46" stroke="currentColor" stroke-width="2" />

                            <!-- Handle cutout -->
                            <rect x="57" y="52" width="16" height="7" rx="3.5" fill="currentColor" />

                            <!-- Left corner bracket -->
                            <path d="M34 50V108H46" stroke="currentColor" stroke-width="3" stroke-linecap="square" />

                            <!-- Front label paper with orange border -->
                            <rect x="49" y="66" width="36" height="28" rx="1.5" class="doc-svg-label" stroke="#fb5a3a"
                                stroke-width="2" />
                            <!-- Text lines on label -->
                            <line x1="54" y1="73" x2="78" y2="73" stroke="#cbd5e1" stroke-width="2"
                                stroke-linecap="round" class="doc-svg-line" />
                            <line x1="54" y1="78" x2="74" y2="78" stroke="#cbd5e1" stroke-width="2"
                                stroke-linecap="round" class="doc-svg-line" />
                            <line x1="54" y1="83" x2="68" y2="83" stroke="#cbd5e1" stroke-width="2"
                                stroke-linecap="round" class="doc-svg-line" />
                        </svg>

                        <h2 class="doc-empty-title">Upload Documents to Get Started</h2>
                        <p class="doc-empty-desc">Drag and drop your PDF or image documents into this area to load them
                            onto the page, or click the button below to select files from your computer.</p>
                        <div class="doc-empty-drop-hint">
                            <i class="fas fa-cloud-arrow-up"></i>
                            <span>Drag &amp; drop files here (PDF, PNG, JPG, WEBP)</span>
                        </div>
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
                            <h2>Documents</h2>
                            <div class="documents-menu-wrap">
                                <button class="btn-ghost icon-only" type="button" data-doc-folder-menu-toggle
                                    title="Drawing group options"><i class="fas fa-ellipsis-vertical"></i></button>
                                <div class="documents-menu" id="documentsFolderMenu">
                                    <button type="button" data-doc-folder-action="expand-all"><i
                                            class="fas fa-up-right-and-down-left-from-center"></i> Expand all
                                        groups</button>
                                    <button type="button" data-doc-folder-action="collapse-all"><i
                                            class="fas fa-down-left-and-up-right-to-center"></i> Collapse all
                                        groups</button>
                                    <button type="button" data-doc-folder-action="sort"><i
                                            class="fas fa-arrow-down-a-z"></i> Sort drawings A–Z</button>
                                </div>
                            </div>
                        </div>
                        <div class="documents-folder-tree" id="documentsFolderTree"></div>
                    </aside>

                    <div class="documents-sidebar-resizer" id="docSidebarResizer" title="Drag to resize sidebar">
                        <div class="doc-resizer-handle"></div>
                    </div>

                    <section class="documents-content-panel" aria-label="Documents content">
                        <!-- Top title bar with density slider -->
                        <div class="doc-main-topbar">
                            <h2 id="documentsContentTitle">Custom Drawings</h2>
                            <div class="doc-topbar-actions">
                                <div class="doc-slider-wrap" title="Adjust row density">
                                    <input id="documentsZoom" class="doc-density-slider" type="range" min="0" max="2"
                                        step="1" value="1" aria-label="Document row density">
                                </div>
                            </div>
                        </div>

                        <!-- Toolbar: Custom dropdown, Upload, Search, More -->
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
                        <footer class="documents-content-footer" id="documentsContentFooter">
                            <i class="fas fa-cloud-arrow-up"></i>
                            <span>Drag and drop your documents here to upload them</span>
                        </footer>
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
                            <div class="pro-takeoff-searchbar">
                                <div class="pro-search-input">
                                    <input id="takeoffItemSearch" type="search" placeholder="Search Takeoffs">
                                    <i class="fas fa-magnifying-glass"></i>
                                </div>
                            </div>
                        </div>
                        <div class="pro-takeoff-actions-row">
                            <button class="pro-visibility-btn pro-global-eye-btn" type="button"
                                data-takeoff-action="toggle-global-visibility" title="Show/hide all takeoffs"
                                aria-label="Show/hide all takeoffs"><i class="fas fa-eye"></i></button>
                            <button class="pro-row-action-btn" type="button" data-takeoff-action="create-group"
                                title="New Group" aria-label="New Group"><i class="fas fa-folder-plus"></i></button>
                            <button class="pro-row-action-btn" type="button" data-takeoff-action="collapse-all"
                                title="Collapse All Groups" aria-label="Collapse All Groups"><i
                                    class="fas fa-down-left-and-up-right-to-center"></i></button>
                            <button class="pro-row-action-btn" id="takeoffDownloadDrawingBtn" type="button"
                                title="Download current drawing" aria-label="Download current drawing"><i
                                    class="fas fa-download"></i></button>
                            <button class="pro-row-action-btn excel" type="button" data-takeoff-action="export-excel"
                                title="Takeoff Quantities to Excel" aria-label="Takeoff Quantities to Excel"><i
                                    class="fas fa-file-excel"></i></button>
                            <button class="pro-add-btn" type="button" data-takeoff-action="create-layer"
                                title="Create New Takeoff Layer" aria-label="Create New Takeoff Layer"><i
                                    class="fas fa-plus"></i></button>
                        </div>
                        <div class="pro-takeoff-tree" id="takeoffItemsTree"></div>
                    </aside>

                    <!-- Draggable Resizer & Collapse Flap Tab -->
                    <div class="pro-sidebar-resizer" id="takeoffSidebarResizer" title="Drag to resize sidebar">
                        <div class="pro-resizer-handle"></div>
                        <button class="pro-sidebar-collapse-tab" id="takeoffSidebarCollapseTab" type="button"
                            title="Hide Sidebar" aria-label="Hide Sidebar">
                            <i class="fas fa-chevron-left"></i>
                        </button>
                    </div>

                    <!-- Takeoff Layer Drawer Sub-Panel (Option B) -->
                    <aside class="pro-layer-drawer" id="takeoffLayerModal" aria-label="Takeoff Layer Details" hidden>
                    </aside>

                    <section class="pro-takeoff-viewer">
                        <div class="pro-viewer-toolbar" style="display:none;"></div>

                        <div class="pro-canvas-shell">
                            <!-- Floating tool buttons inside canvas (Point 5) -->
                            <div class="pro-floating-tools" id="takeoffFloatingTools" aria-label="Takeoff tools">
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
                                <button class="pro-tool-btn" type="button" data-tool-command="text" title="Note"><i
                                        class="fas fa-note-sticky"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="cloud" title="Cloud"><i
                                        class="fas fa-cloud"></i></button>
                                <div class="pro-tool-separator"></div>
                                <button class="pro-tool-btn" type="button" data-tool-command="undo" title="Undo"><i
                                        class="fas fa-rotate-left"></i></button>
                                <button class="pro-tool-btn" type="button" data-tool-command="redo" title="Redo"><i
                                        class="fas fa-rotate-right"></i></button>
                                <div class="pro-tool-separator"></div>
                                <button class="pro-tool-btn" type="button" id="takeoffToolsDockToggle"
                                    title="Dock left / right" aria-label="Dock left or right"><i
                                        class="fas fa-right-left"></i></button>
                            </div>

                            <?php if ($selectedDoc && $selectedDoc['source'] === 'legacy_file' && $activeTab === 'takeoff'): ?>
                                <iframe id="takeoffFrame" class="takeoff-frame pro-takeoff-frame"
                                    src="editor.php?id=<?= (int) $selectedDoc['id'] ?>&embedded=1&estimate_key=<?= htmlspecialchars(urlencode($resolvedActiveEstimateId)) ?>&inherit_legacy=1&_v=<?= time() ?>"></iframe>
                            <?php else: ?>
                                <div id="takeoffEmpty" class="takeoff-empty pro-takeoff-empty" <?= ($selectedDoc && $selectedDoc['source'] === 'legacy_file') ? 'style="display:none;"' : '' ?>>
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
                                <button class="pro-icon-btn pro-controls-collapse-toggle" type="button"
                                    id="takeoffControlsCollapseToggle" title="Collapse floating controls"
                                    aria-label="Collapse floating controls" aria-expanded="true"><i
                                        class="fas fa-chevron-right"></i></button>
                                <button class="pro-icon-btn" type="button" id="takeoffControlsDockToggle"
                                    title="Dock left / right" aria-label="Dock left or right"><i
                                        class="fas fa-right-left"></i></button>
                                <button class="pro-icon-btn" type="button" data-viewer-command="zoom-out"
                                    title="Zoom out"><i class="fas fa-minus"></i></button>
                                <input id="takeoffZoomSlider" type="range" min="25" max="400" value="100"
                                    aria-label="Zoom">
                                <span id="takeoffZoomPercent" style="display:none;">100%</span>
                                <button class="pro-icon-btn" type="button" data-viewer-command="zoom-in"
                                    title="Zoom in"><i class="fas fa-plus"></i></button>
                                <div class="takeoff-subhead-page-wrap" id="takeoffFloatingPageWrap">
                                    <span class="takeoff-subhead-page-badge" title="Sheet Page Count">
                                        <span id="takeoffTopPage">1 / 1</span>
                                    </span>
                                    <span id="takeoffTopProgress" style="display:none;"></span>
                                </div>
                                <button class="pro-chip-btn pro-floating-fit-btn" type="button"
                                    data-viewer-command="fit" title="Fit to view">Fit</button>
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
                    <footer class="est-version-bar" id="takeoffEstimateTypesFooter" aria-label="Available estimates">
                        <span class="est-pill">Loading estimates&hellip;</span>
                    </footer>
                </div>
            </section>

            <section id="tab-estimating" class="tab-panel fullscreen estimating-page">
                <div id="estimatingModule" class="est-shell est-v2" data-project-id="<?= (int) $projectId ?>">
                    <div class="est-main">
                        <!-- Table Settings Drawer (Aside sliding from left displacing table to right) -->
                        <aside class="est-table-settings-drawer" id="estTableSettingsDrawer" aria-label="Table Settings"
                            hidden></aside>

                        <section class="est-left" aria-label="Estimate cost items">
                            <div class="est-toolbar">
                                <div class="bb-search-field-procore cc-search-procore est-search-box">
                                    <input id="estSearch" type="search" placeholder="Search estimate items..."
                                        autocomplete="off">
                                </div>
                                <div class="est-toolbar-actions"
                                    style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
                                    <button class="btn-main est-toolbar-btn est-btn-import" id="estBtnImport"
                                        type="button" data-est-option="import"
                                        title="Import Project Estimate (.xlsx)"><i class="fas fa-file-import"></i>
                                        <span>Import</span></button>
                                    <button class="btn-main est-toolbar-btn est-btn-export" id="estBtnExport"
                                        type="button" data-est-option="export" title="Export Estimate"><i
                                            class="fas fa-file-export"></i> <span>Export</span></button>
                                    <button class="est-icon-btn" id="estBtnCreateGroup" type="button"
                                        data-est-action="create-group" title="Create Group"><i
                                            class="fas fa-folder-plus"></i></button>
                                    <button class="est-icon-btn" id="estBtnTableSettings" type="button"
                                        data-est-action="table-settings" title="Table Settings"><i
                                            class="fas fa-sliders"></i></button>
                                    <button class="est-icon-btn" id="estBtnFullscreen" type="button"
                                        data-est-action="fullscreen" title="Full screen"><i
                                            class="fas fa-expand"></i></button>
                                    <div class="est-menu-wrap">
                                        <button class="est-icon-btn" id="estBtnMoreOptions" type="button"
                                            data-est-action="options" title="Options"><i
                                                class="fas fa-ellipsis-vertical"></i></button>
                                        <div class="est-menu" id="optionsMenu">
                                            <button type="button" data-est-action="catalog-update"><i
                                                    class="fas fa-arrows-rotate"></i> Update from Cost Catalog</button>
                                            <button type="button" data-est-action="reset-quantities"><i
                                                    class="fas fa-rotate-left"></i> Reset Quantities</button>
                                        </div>
                                    </div>
                                    <button class="est-icon-btn est-toggle-right-btn" id="estToolbarToggleRight"
                                        type="button" data-est-action="toggle-right" title="Hide summary panel"><i
                                            class="fas fa-chevron-right"></i></button>
                                </div>
                            </div>
                            <div class="est-table-wrap bb-table-scroll">
                                <table class="est-table bb-table" id="estMainTable" aria-label="Estimate items table">
                                    <thead id="estTableHead"></thead>
                                    <tbody id="estTableBody"></tbody>
                                </table>
                            </div>
                        </section>
                        <div class="pro-sidebar-resizer est-sidebar-resizer" id="estSplitResizer" role="separator"
                            aria-orientation="vertical" title="Drag to resize panels">
                            <div class="pro-resizer-handle"></div>
                        </div>
                        <aside class="est-right" aria-label="Estimate notes and summary">
                            <div class="est-right-scroll" id="estRightScroll"></div>
                            <div class="est-total-box">
                                <div id="estimateTotal" class="est-total-value">$0.00</div>
                                <div class="est-total-label">Estimate Total</div>
                                <div id="estimateSqft" class="est-total-sub">--/sq ft</div>
                            </div>
                        </aside>
                    </div>
                    <footer class="est-version-bar" id="versionBar" aria-label="Available estimates"></footer>
                </div>
            </section>
            <section id="tab-proposal" class="tab-panel proposal-page">
                <div id="proposalModule" class="proposal-shell" data-project-id="<?= (int) $projectId ?>">
                    <aside class="proposal-settings" aria-label="Proposal detail settings">
                        <div class="proposal-settings-head">
                            <div>
                                <h2>Detail Settings</h2>
                                <span class="proposal-head-badge">Proposal</span>
                            </div>
                            <div class="proposal-export-wrap">
                                <button class="proposal-export-btn" type="button" data-proposal-export-toggle>
                                    <i class="fas fa-file-export"></i><span>Export</span><i
                                        class="fas fa-chevron-down"></i>
                                </button>
                                <div class="proposal-export-menu" id="proposalExportMenu">
                                    <button type="button" data-proposal-export="pdf"><i class="fas fa-file-pdf"
                                            style="color:#ef4444; width:16px; margin-right:6px;"></i> Download PDF
                                        (.pdf)</button>
                                    <button type="button" data-proposal-export="docx"><i class="fas fa-file-word"
                                            style="color:#2563eb; width:16px; margin-right:6px;"></i> Download Word
                                        (.doc)</button>
                                    <button type="button" data-proposal-export="print"><i class="fas fa-print"
                                            style="color:#64748b; width:16px; margin-right:6px;"></i> Print / System
                                        Dialog</button>
                                </div>
                            </div>
                        </div>
                        <div class="proposal-settings-scroll">
                            <div id="proposalSettingsPanel"></div>
                        </div>
                    </aside>
                    <div class="proposal-preview-area" role="main" aria-label="Proposal preview">
                        <div class="proposal-builder-note" id="proposalBuilderNote" hidden>Proposal Builder is ready to
                            be connected.</div>
                        <div class="proposal-document" id="proposalDocument"></div>
                    </div>
                    <footer class="est-version-bar project-estimate-footer" id="proposalEstimateTypesFooter"
                        aria-label="Available estimates">
                        <span class="est-pill">Loading estimates&hellip;</span>
                    </footer>
                </div>
            </section>
        </main>
    </div>

    <input type="file" id="projectUploadInput" class="d-none" multiple
        accept=".pdf,image/*,application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp,image/tiff">
    <input type="file" id="documentsBrowseInput" class="d-none" multiple
        accept=".pdf,image/*,application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp,image/tiff">

    <!-- Customer Information Modal -->
    <div class="pd-modal-backdrop" id="pdCustomerModal" role="dialog" aria-modal="true"
        aria-labelledby="customerModalTitle">
        <div class="pd-modal pd-customer-modal">
            <div class="pd-modal-head">
                <h3 id="customerModalTitle"><i class="far fa-id-badge" style="color: var(--primary);"></i> Customer
                    Information</h3>
                <div class="pd-modal-head-actions">
                    <button type="button" class="pd-customer-head-dir-btn" id="openCustomerDirectoryBtn"
                        title="Open Customer Directory (View, Edit &amp; Delete)">
                        <i class="fas fa-address-book"></i> <span>Directory</span>
                    </button>
                    <button class="pd-modal-head-close" type="button" data-close-modal="pdCustomerModal"
                        aria-label="Close">&times;</button>
                </div>
            </div>
            <div class="pd-modal-body" id="pdCustomerFormView">
                <div class="pd-customer-edit-banner overview-field full" id="pdCustomerEditBanner" hidden>
                    <span><i class="fas fa-pen-to-square"></i> Editing directory record: <strong
                            id="pdCustomerEditBannerName"></strong></span>
                    <button type="button" class="pd-customer-edit-cancel" id="cancelEditDirectoryCustomerBtn">Cancel
                        Edit</button>
                </div>
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
            <div class="pd-modal-body pd-customer-directory-body" id="pdCustomerDirectoryView" hidden>
                <div class="pd-customer-dir-toolbar">
                    <div class="pd-customer-dir-search-wrap">
                        <i class="fas fa-search"></i>
                        <input type="text" id="poCustomerDirectorySearch"
                            placeholder="Search company, contact, phone, email...">
                    </div>
                    <span class="pd-customer-dir-count" id="poCustomerDirectoryCount">0 customers</span>
                </div>
                <div class="pd-customer-dir-list" id="poCustomerDirectoryList"></div>
            </div>
            <div class="pd-modal-foot pd-customer-foot-between" id="pdCustomerFormFoot">
                <button type="button" class="btn-ghost" id="saveCustomerBtn"
                    title="Save this customer to database directory for use in other projects"
                    style="color: var(--primary, #ea580c); font-weight: 600;">
                    <i class="fas fa-bookmark"></i> Save to Directory
                </button>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button type="button" class="btn-ghost" data-close-modal="pdCustomerModal">Cancel</button>
                    <button type="button" class="btn-main orange" id="applyCustomerModalBtn"><i
                            class="fas fa-check"></i>
                        Apply &amp; Close</button>
                </div>
            </div>
            <div class="pd-modal-foot pd-customer-foot-between" id="pdCustomerDirectoryFoot" hidden>
                <button type="button" class="btn-ghost" id="customerDirectoryBackBtn">
                    <i class="fas fa-arrow-left"></i> Back to Form
                </button>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button type="button" class="btn-ghost" id="customerDirectoryNewBtn">
                        <i class="fas fa-plus"></i> New Customer
                    </button>
                    <button type="button" class="btn-main orange" data-close-modal="pdCustomerModal">Done</button>
                </div>
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
    <div class="pd-modal-backdrop" id="pdDocRenameModal" role="dialog" aria-modal="true"
        aria-labelledby="docRenameModalTitle">
        <div class="pd-modal" style="width: min(460px, 100%);">
            <div class="pd-modal-head">
                <h3 id="docRenameModalTitle"><i class="fas fa-pen" style="color: var(--primary);"></i> Rename</h3>
                <button class="pd-modal-head-close" type="button" data-close-modal="pdDocRenameModal"
                    aria-label="Close">&times;</button>
            </div>
            <div class="pd-modal-body" style="grid-template-columns: 1fr;">
                <label class="overview-field full">
                    <span id="docRenameInputLabel">Name</span>
                    <input id="modalDocRenameInput" class="pd-composer-input" placeholder="Enter name..."
                        autocomplete="off">
                </label>
            </div>
            <div class="pd-modal-foot">
                <button type="button" class="btn-ghost" data-close-modal="pdDocRenameModal">Cancel</button>
                <button type="button" class="btn-main orange" id="modalSaveDocRenameBtn"><i class="fas fa-check"></i>
                    Save</button>
            </div>
        </div>
    </div>

    <!-- Real-Time Document Upload Progress Modal -->
    <div class="pd-modal-backdrop doc-upload-modal-backdrop" id="pdDocumentUploadModal" role="dialog" aria-modal="true"
        aria-labelledby="docUploadModalTitle" aria-live="polite">
        <div class="pd-modal doc-upload-modal" style="width: min(480px, 100%);">
            <div class="pd-modal-head">
                <h3 id="docUploadModalTitle">
                    <i class="fas fa-cloud-arrow-up doc-upload-modal-icon" id="docUploadModalIcon"
                        style="color: var(--primary);"></i>
                    <span id="docUploadModalHeading">Uploading Documents...</span>
                </h3>
                <span class="doc-upload-modal-counter" id="docUploadModalCounter">0 / 0</span>
            </div>
            <div class="pd-modal-body doc-upload-modal-body" style="grid-template-columns: 1fr; gap: 14px;">
                <div class="doc-upload-current-card">
                    <div class="doc-upload-file-row">
                        <div class="doc-upload-file-meta">
                            <i class="far fa-file-pdf doc-upload-file-icon" id="docUploadFileIcon"></i>
                            <span class="doc-upload-file-name" id="docUploadFileName">Preparing upload...</span>
                        </div>
                        <span class="doc-upload-file-percent" id="docUploadFilePercent">0%</span>
                    </div>
                    <div class="doc-upload-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                        aria-valuenow="0" id="docUploadProgressTrack">
                        <div class="doc-upload-progress-bar" id="docUploadProgressBar" style="width: 0%;"></div>
                    </div>
                    <div class="doc-upload-status-line">
                        <span class="doc-upload-status-text" id="docUploadStatusText">Uploading file...</span>
                    </div>
                </div>
                <div class="doc-upload-file-list" id="docUploadFileList" style="display: none;"></div>
            </div>
        </div>
    </div>

    <!-- Item Options Floating Menu for Notes & Tasks -->
    <div class="pd-floating-options-menu" id="pdItemContextMenu" style="display:none;">
        <button type="button" id="pdItemActionEdit"><i class="fas fa-pen"></i> Edit</button>
        <button type="button" class="danger" id="pdItemActionDelete"><i class="fas fa-trash"></i> Delete</button>
    </div>

    <!-- Takeoff Group Create / Rename Modal (System Standard pd-modal style) -->
    <div class="pd-modal-backdrop" id="takeoffGroupModal" role="dialog" aria-modal="true"
        aria-labelledby="takeoffGroupModalTitle" hidden style="display:none;">
        <div class="pd-modal" style="width: min(480px, 100%);">
            <div class="pd-modal-head">
                <h3 id="takeoffGroupModalTitle"><i class="fas fa-folder-plus" id="takeoffGroupModalIcon"
                        style="color: var(--primary);"></i> <span id="takeoffGroupModalHeading">Create new group</span>
                </h3>
                <button class="pd-modal-head-close" type="button" data-group-modal-close aria-label="Close dialog"><i
                        class="fas fa-times"></i></button>
            </div>
            <form id="takeoffGroupForm" novalidate>
                <div class="pd-modal-body" style="grid-template-columns: 1fr; gap: 14px;">
                    <div class="pd-field">
                        <label class="pro-group-field" for="takeoffGroupName" id="takeoffGroupNameLabel">Group
                            Name</label>
                        <input id="takeoffGroupName" name="groupName" class="pd-composer-input" type="text"
                            maxlength="120" autocomplete="off" placeholder="For example, Lighting" required
                            aria-describedby="takeoffGroupNameHint takeoffGroupNameError">
                    </div>
                    <div
                        style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--text-muted, #64748b); margin-top: -6px;">
                        <span id="takeoffGroupNameHint">Use a clear scope or system name.</span>
                        <span id="takeoffGroupNameCount">0 / 120</span>
                    </div>
                    <div class="pro-group-error" id="takeoffGroupNameError" role="alert" hidden
                        style="color: #ef4444; font-size: 12px; margin-top: -4px;"></div>
                </div>
                <div class="pd-modal-foot">
                    <button type="button" class="btn-ghost" data-group-modal-close>Cancel</button>
                    <button type="submit" class="btn-main orange" id="takeoffGroupCreateSubmit">
                        <i class="fas fa-check" id="takeoffGroupSubmitIcon"></i> <span
                            id="takeoffGroupSubmitText">Create group</span>
                    </button>
                </div>
            </form>
        </div>
    </div>

    <script id="takeoff-auth-metadata"
        type="application/json"><?= json_encode($clientAuthMetadata, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
    <script>
        (function () {
            var fallback = { displayName: 'Viewer', role: 'viewer', canWrite: false, readOnly: true };
            try {
                var node = document.getElementById('takeoff-auth-metadata');
                var parsed = node ? JSON.parse(node.textContent || '{}') : fallback;
                window.TakeoffAuth = Object.freeze({
                    displayName: String(parsed.displayName || fallback.displayName),
                    role: String(parsed.role || fallback.role),
                    canWrite: parsed.canWrite === true,
                    readOnly: parsed.canWrite !== true
                });
            } catch (_) { window.TakeoffAuth = Object.freeze(fallback); }

            window.TakeoffAuthorization = Object.freeze({
                canWrite: function () { return window.TakeoffAuth?.canWrite === true; },
                requireWrite: function () {
                    if (window.TakeoffAuth?.canWrite === true) return true;
                    window.TakeoffAnnouncement?.show?.('Read-only access: this action requires an administrator.', { type: 'warning' });
                    return false;
                }
            });

            if (window.TakeoffAuth.canWrite !== true) {
                var nativeFetch = window.fetch.bind(window);
                window.fetch = function (input, init) {
                    var method = String(init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
                    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
                        return Promise.reject(new Error('Read-only access: mutation request blocked.'));
                    }
                    return nativeFetch(input, init);
                };
                document.addEventListener('DOMContentLoaded', function () {
                    var mutationSelectors = [
                        '#saveProjectBtn', '#projectStatusButton', '#markAsWonBtn', '#retryWonExportBtn',
                        '#saveCustomerBtn', '#clearCustomerBtn', '#customerDirectoryNewBtn', '#editCustomerInfoBtn', '#editProjectAddressBtn', '#addProjectAddressBtn', '#addNoteBtnHead',
                        '#docUploadArrowBtn', '[data-doc-folder-action]', '[data-doc-action="delete"]', '[data-doc-action="move"]',
                        '[data-subhead-item-action]', '[data-est-subhead-action]', '[data-scale-apply-manual]', '[data-scale-clear-line]', '#takeoffScaleApplyBtn',
                        '[data-takeoff-action="create-layer"]', '[data-takeoff-action="create-group"]',
                        '[data-tool-command="count"]', '[data-tool-command="linear"]', '[data-tool-command="area"]',
                        '[data-tool-command="measure"]', '[data-tool-command="text"]', '[data-tool-command="cloud"]',
                        '[data-tool-command="undo"]', '[data-tool-command="redo"]',
                        '[data-est-action="create-group"]', '[data-est-action="reset-quantities"]', '#optionsMenu button[data-est-action]',
                        '#estBtnImport', '[data-est-option="import"]', '[data-editor-cmd]', '[data-project-action]'
                    ];
                    document.querySelectorAll(mutationSelectors.join(',')).forEach(function (element) {
                        element.hidden = true;
                        element.setAttribute('aria-hidden', 'true');
                        if ('disabled' in element) element.disabled = true;
                    });
                });
                document.addEventListener('click', function (event) {
                    var target = event.target?.closest?.('[data-project-action],[data-subhead-item-action],[data-est-subhead-action],[data-doc-folder-action],[data-takeoff-action],[data-scale-apply-manual],[data-scale-clear-line],[data-est-action],[data-est-option],[data-editor-cmd],#saveProjectBtn,#projectStatusButton,#markAsWonBtn,#retryWonExportBtn,#docUploadArrowBtn');
                    if (!target) return;
                    event.preventDefault(); event.stopImmediatePropagation();
                }, true);
            }
        })();

        window.ProjectState = <?= json_encode($state, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;
        window.ProjectPresenceUser = {
            id: <?= json_encode((int) ($authUser['user_id'] ?? 0)) ?>,
            name: <?= json_encode($selfName . ' (You)') ?>,
            role: <?= json_encode($selfRole) ?>,
            initials: <?= json_encode($selfInitials) ?>,
            color: '#5b4364',
            isSelf: true
        };
        window.WonProjectConfig = <?= json_encode([
            'projectId' => (int) $projectId,
            'token' => $wonProjectCsrfToken,
            'isAdmin' => $isAdminUser,
            'integrationEnabled' => $integrationEnabled,
        ]) ?>;
        <?php
        $effectiveReturnStage = !empty($project['status'])
            ? dash_status_label($project['status'])
            : (!empty($_GET['stage']) ? $_GET['stage'] : '');
        ?>
        <?php if ($effectiveReturnStage !== ''): ?>
            try {
                localStorage.setItem('takeoff.bidBoardStage', <?= json_encode($effectiveReturnStage) ?>);
                sessionStorage.setItem('takeoff.bidBoardStage', <?= json_encode($effectiveReturnStage) ?>);
            } catch (e) { }
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
            const isTakeoff = (tab === 'takeoff');
            const isDocuments = (tab === 'documents');
            const isEstimating = (tab === 'estimating');
            document.querySelector('.project-subhead-wrapper')?.classList.toggle('is-takeoff-tab', isTakeoff);
            document.querySelector('.workspace-shell')?.classList.toggle('is-takeoff-tab', isTakeoff);
            document.body.classList.toggle('is-takeoff-tab', isTakeoff);
            document.querySelector('.project-subhead-wrapper')?.classList.toggle('is-documents-tab', isDocuments);
            document.querySelector('.workspace-shell')?.classList.toggle('is-documents-tab', isDocuments);
            document.body.classList.toggle('is-documents-tab', isDocuments);
            document.querySelector('.project-subhead-wrapper')?.classList.toggle('is-estimating-tab', isEstimating);
            document.querySelector('.workspace-shell')?.classList.toggle('is-estimating-tab', isEstimating);
            document.body.classList.toggle('is-estimating-tab', isEstimating);
            const footer = document.querySelector('.bb-brightronix-footer');
            if (footer) footer.style.display = isTakeoff ? 'none' : '';
            window.onDocumentsTabVisibilityChange?.(isDocuments);
            if (!isTakeoff) {
                const info = document.getElementById('takeoffSubheadItemInfo');
                if (info) {
                    info.style.display = 'none';
                    info.classList.remove('is-visible');
                }
            }
            if (!isDocuments) {
                const docInfo = document.getElementById('documentsSubheadItemInfo');
                if (docInfo) {
                    docInfo.style.display = 'none';
                    docInfo.classList.remove('is-visible');
                }
            }
            if (!isEstimating) {
                const estInfo = document.getElementById('estimatingSubheadItemInfo');
                if (estInfo) {
                    estInfo.style.display = 'none';
                    estInfo.classList.remove('is-visible');
                }
                document.getElementById('estimatingSubheadMovePopover')?.remove();
            }
            if (isDocuments) {
                setTimeout(() => {
                    window.syncDocumentsSubheadInfo?.();
                }, 0);
            } else if (isEstimating) {
                setTimeout(() => {
                    window.syncEstimatingSubheadInfo?.();
                }, 0);
            } else if (isTakeoff) {
                setTimeout(() => {
                    window.updateTakeoffSubheadInfo?.();
                    window.syncTakeoffLayout?.();
                }, 0);
            }
            const wonWrap = document.getElementById('overviewSubheadTabsTools');
            if (wonWrap) {
                const isOverview = (tab === 'overview');
                wonWrap.classList.toggle('is-overview-tab', isOverview);
                wonWrap.style.setProperty('display', isOverview ? 'inline-flex' : 'none', 'important');
                if (isOverview) requestAnimationFrame(alignOverviewWonBtn);
            }
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
            if (tab === 'documents') {
                window.ensureDashboardFeature?.('pdfjs').then(function () {
                    if (window.pdfjsLib) {
                        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                    }
                    window.onDocumentsTabVisibilityChange?.(true);
                });
            } else if (tab === 'proposal') {
                window.ensureDashboardFeature?.('proposal').then(function () {
                    window.dispatchEvent(new CustomEvent('takeoff:tab-activated', { detail: { tab: 'proposal' } }));
                });
            }
            if (tab === 'takeoff') {
                if (window._pendingTakeoffDrawingId) {
                    const pendingId = Number(window._pendingTakeoffDrawingId);
                    window._pendingTakeoffDrawingId = null;
                    if (pendingId > 0) {
                        ProjectState.selectedDocumentId = pendingId;
                        ProjectState.selectedDrawingId = pendingId;
                    }
                    if (typeof window.projectTakeoffRefreshDrawings === 'function') {
                        window.projectTakeoffRefreshDrawings(pendingId || null);
                    }
                } else if (window._pendingTakeoffSync) {
                    window._pendingTakeoffSync = false;
                    if (typeof window.projectTakeoffRefreshDrawings === 'function') {
                        window.projectTakeoffRefreshDrawings(ProjectState.selectedDocumentId || null);
                    }
                }
                let drawing = selectedDocument();
                if (!drawing || drawing.source !== 'legacy_file') {
                    drawing = ProjectState.documents.find(doc => doc.source === 'legacy_file' && ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg', 'heic'].includes(String(doc.extension || '').toLowerCase()));
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
                        const drawingLabel = drawing.filename || drawing.title || 'plano';
                        if (typeof window.showTakeoffCanvasLoader === 'function') {
                            window.showTakeoffCanvasLoader(`Renderizando y cargando plano (${drawingLabel}) en Takeoff...`);
                        }
                        const hideLoaderFallback = setTimeout(() => {
                            if (typeof window.hideTakeoffCanvasLoader === 'function') window.hideTakeoffCanvasLoader();
                        }, 6000);
                        takeoffFrame.addEventListener('load', () => {
                            clearTimeout(hideLoaderFallback);
                            setTimeout(() => {
                                if (typeof window.hideTakeoffCanvasLoader === 'function') window.hideTakeoffCanvasLoader();
                            }, 280);
                        }, { once: true });
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

        const MAX_PROJECT_FILE_BYTES = 10737418240;

        function uploadProjectFile(file, onProgress) {
            return new Promise((resolve, reject) => {
                const fd = new FormData();
                fd.append('action', 'upload_file');
                fd.append('project_id', ProjectState.projectId);
                fd.append('file', file, file.name);
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '../api/api.php');
                xhr.upload.onprogress = event => {
                    if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
                };
                xhr.onload = () => {
                    let result = null;
                    try { result = JSON.parse(xhr.responseText); } catch (_) { }
                    if (xhr.status >= 200 && xhr.status < 300 && result?.status === 'success') resolve(result);
                    else reject(new Error(result?.msg || `Upload failed (HTTP ${xhr.status || 0}).`));
                };
                xhr.onerror = () => reject(new Error('Connection error.'));
                xhr.send(fd);
            });
        }

        document.getElementById('projectUploadInput')?.addEventListener('change', async function () {
            const files = Array.from(this.files || []);
            this.value = '';
            if (!files.length) return;
            if (typeof window.uploadProjectDocumentsWithModal === 'function') {
                await window.uploadProjectDocumentsWithModal(files);
                return;
            }

            const allowedExts = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg']);
            const validFiles = [];
            const invalidFiles = [];
            for (const file of files) {
                const ext = String(file.name.split('.').pop() || '').toLowerCase();
                if (allowedExts.has(ext)) validFiles.push(file);
                else invalidFiles.push(file);
            }
            if (invalidFiles.length) {
                alert('Cannot process unsupported file(s): ' + invalidFiles.map(f => f.name).join(', ') + '. Only PDF and image files are allowed.');
            }
            if (!validFiles.length) return;

            const modal = document.getElementById('pdDocumentUploadModal');
            const label = document.getElementById('docUploadFileName');
            const count = document.getElementById('docUploadModalCounter');
            const percentEl = document.getElementById('docUploadFilePercent');
            const bar = document.getElementById('docUploadProgressBar');
            const statusText = document.getElementById('docUploadStatusText');
            if (modal) modal.classList.add('open');

            const errors = [];
            let completed = 0;
            let succeeded = 0;
            for (const file of validFiles) {
                if (label) label.textContent = file.name;
                if (count) count.textContent = `${completed + 1} / ${validFiles.length}`;
                if (percentEl) percentEl.textContent = '0%';
                if (bar) bar.style.width = '0%';
                if (file.size > MAX_PROJECT_FILE_BYTES) {
                    errors.push({ filename: file.name, message: 'File exceeds the 10 GB limit.' });
                    completed++;
                    continue;
                }
                try {
                    await uploadProjectFile(file, percent => {
                        if (percentEl) percentEl.textContent = `${percent}%`;
                        if (bar) bar.style.width = `${percent}%`;
                    });
                    if (percentEl) percentEl.textContent = '100%';
                    if (bar) bar.style.width = '100%';
                    succeeded++;
                } catch (error) {
                    errors.push({ filename: file.name, message: error.message || 'Upload failed.' });
                }
                completed++;
            }
            if (bar) bar.style.width = '100%';
            if (percentEl) percentEl.textContent = '100%';
            if (statusText) statusText.textContent = errors.length ? `${succeeded} uploaded, ${errors.length} failed` : 'Upload completed';
            await new Promise(r => setTimeout(r, 2000));
            if (modal) modal.classList.remove('open');
            if (errors.length) {
                alert(errors.map(e => `${e.filename}: ${e.message}`).join('\n'));
            } else {
                location.reload();
            }
        });

        function alignOverviewWonBtn() {
            const wonWrap = document.getElementById('overviewSubheadTabsTools');
            const wonBtn = document.getElementById('markAsWonBtn');
            const saveBtn = document.getElementById('saveProjectBtn');
            const topTabs = document.querySelector('.top-tabs');
            if (!wonWrap || !wonBtn || !saveBtn || !topTabs) return;
            if (wonWrap.style.display === 'none' || !wonWrap.classList.contains('is-overview-tab')) return;

            const saveRect = saveBtn.getBoundingClientRect();
            const tabsRect = topTabs.getBoundingClientRect();
            const wonRect = wonBtn.getBoundingClientRect();
            if (saveRect.width > 0 && tabsRect.width > 0 && wonRect.width > 0) {
                const saveCenterFromRight = tabsRect.right - (saveRect.left + saveRect.width / 2);
                const targetMarginRight = Math.max(0, Math.round(saveCenterFromRight - (wonRect.width / 2) - 23));
                wonWrap.style.marginRight = `${targetMarginRight}px`;
            }
        }
        window.addEventListener('resize', alignOverviewWonBtn);

        setActiveTab(ProjectState.activeTab || 'overview', false);
        setTimeout(alignOverviewWonBtn, 60);
    </script>
    <?php if ($activeTab === 'documents'): ?>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>
        <script>if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';</script>
    <?php endif; ?>
    <script src="../assets/project_overview_dialogs.js?v=<?= filemtime(__DIR__ . '/../assets/project_overview_dialogs.js') ?>"></script>
    <script src="../assets/project_overview_notes_tasks.js?v=<?= filemtime(__DIR__ . '/../assets/project_overview_notes_tasks.js') ?>"></script>
    <script src="../assets/project_overview.js?v=<?= filemtime(__DIR__ . '/../assets/project_overview.js') ?>"></script>
    <script src="../assets/estimating_catalog_snapshot_service.js?v=estimating-catalog-snapshot-20260827-1"></script>
    <script src="../assets/takeoff_estimating_sync_service.js?v=<?= filemtime(__DIR__ . '/../assets/takeoff_estimating_sync_service.js') ?>"></script>
    <script
        src="../assets/project_estimate_footer.js?v=<?= filemtime(__DIR__ . '/../assets/project_estimate_footer.js') ?>"></script>
    <script src="../assets/catalog_item_contract.js?v=catalog-item-contract-20260826-1"></script>
    <script src="../assets/catalog_metadata.js?v=<?= filemtime(__DIR__ . '/../assets/catalog_metadata.js') ?>"></script>
    <script src="../assets/catalog_service.js?v=<?= filemtime(__DIR__ . '/../assets/catalog_service.js') ?>"></script>
    <script src="../assets/boq_catalog_adapter.js?v=boq-catalog-boundary-20260826-1"></script>
    <script src="../assets/takeoff_catalog_adapter.js?v=takeoff-catalog-boundary-20260826-1"></script>
    <script src="../assets/takeoff_color_palette.js?v=takeoff-duplicate-color-20260831-1"></script>
    <script src="../assets/takeoff_layer_modal.js?v=<?= filemtime(__DIR__ . '/../assets/takeoff_layer_modal.js') ?>"></script>
    <script src="../assets/takeoff_catalog_browser.js?v=<?= filemtime(__DIR__ . '/../assets/takeoff_catalog_browser.js') ?>"></script>
    <script src="../assets/takeoff_viewer_controller.js?v=<?= filemtime(__DIR__ . '/../assets/takeoff_viewer_controller.js') ?>"></script>
    <script src="../assets/takeoff_scale_controller.js?v=<?= filemtime(__DIR__ . '/../assets/takeoff_scale_controller.js') ?>"></script>
    <script src="../assets/project_takeoff.js?v=<?= filemtime(__DIR__ . '/../assets/project_takeoff.js') ?>"></script>
    <script src="../assets/assembly_expansion_service.js?v=assembly-expansion-20260828-1"></script>
    <script src="../assets/estimating_assembly_expansion_adapter.js?v=estimating-assembly-adapter-20260828-1"></script>
    <script src="../assets/quantity_format_service.js?v=quantity-context-format-20260831-1"></script>
    <script src="../assets/estimate_calculation_service.js?v=estimating-normal-item-quantity-20260831-1"></script>
    <script>
        (function () {
            window.DASHBOARD_LAZY_SCRIPTS = Object.assign(window.DASHBOARD_LAZY_SCRIPTS || {}, {
                'estimating-export': [
                    '../assets/estimating_export_service.js?v=estimating-boq-export-20260820-1'
                ],
                'catalog-update': [
                    '../assets/catalog_change_detection_service.js?v=catalog-change-detection-20260827-1',
                    '../assets/catalog_update_preview_service.js?v=catalog-update-preview-20260827-1',
                    '../assets/catalog_update_application_service.js?v=catalog-update-application-20260827-2',
                    '../assets/catalog_update_ui.js?v=<?= filemtime(__DIR__ . '/../assets/catalog_update_ui.js') ?>'
                ],
                'pdfjs': [
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'
                ],
                'proposal': [
                    '../assets/project_proposal.js?v=<?= filemtime(__DIR__ . '/../assets/project_proposal.js') ?>'
                ]
            });

            const featurePromises = new Map();
            const scriptPromises = new Map();

            function loadSequentialScript(src) {
                if (scriptPromises.has(src)) return scriptPromises.get(src);
                const base = src.split('?')[0].split('/').pop();
                if (base === 'pdf.min.js' && window.pdfjsLib) {
                    const p = Promise.resolve();
                    scriptPromises.set(src, p);
                    return p;
                }
                if (base === 'project_proposal.js' && window.__proposalModuleLoaded) {
                    const p = Promise.resolve();
                    scriptPromises.set(src, p);
                    return p;
                }
                const promise = new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = src;
                    script.async = false;
                    script.onload = () => {
                        if (base === 'project_proposal.js') window.__proposalModuleLoaded = true;
                        if (base === 'pdf.min.js' && window.pdfjsLib) {
                            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                        }
                        resolve();
                    };
                    script.onerror = () => reject(new Error('Failed to load dashboard module: ' + src));
                    document.body.appendChild(script);
                });
                scriptPromises.set(src, promise);
                return promise;
            }

            window.ensureDashboardFeature = function (featureName) {
                const key = String(featureName || '');
                if (!key) return Promise.resolve();
                if (key === 'estimating-export' && window.EstimatingExportService) return Promise.resolve();
                if (key === 'catalog-update' && window.CatalogUpdateUI) return Promise.resolve();
                if (key === 'proposal' && window.__proposalModuleLoaded) return Promise.resolve();
                if (key === 'pdfjs' && window.pdfjsLib) return Promise.resolve();
                if (featurePromises.has(key)) return featurePromises.get(key);
                const list = (window.DASHBOARD_LAZY_SCRIPTS && window.DASHBOARD_LAZY_SCRIPTS[key]) || [];
                const chain = list.reduce((prev, src) => prev.then(() => loadSequentialScript(src)), Promise.resolve())
                    .catch((err) => {
                        featurePromises.delete(key);
                        throw err;
                    });
                featurePromises.set(key, chain);
                return chain;
            };

            // Keep ProjectState.estimateSummary updated even while Proposal script is deferred
            window.addEventListener('takeoff:estimate-summary-updated', function (event) {
                if (window.__proposalModuleLoaded || !window.ProjectState) return;
                const detail = event.detail;
                window.ProjectState.estimateSummary = detail ? {
                    direct: detail.direct,
                    byCategory: detail.byCategory,
                    preTaxTotal: detail.preTaxTotal,
                    preTaxMarkup: detail.preTaxTotal,
                    totalTax: detail.totalTax,
                    taxes: detail.totalTax,
                    profit: detail.profit,
                    estimateTotal: detail.estimateTotal,
                    material: detail.direct?.materialSales,
                    labor: detail.direct?.laborSales,
                    equipment: detail.direct?.equipmentSales,
                    total: detail.estimateTotal
                } : {};
            });

            // Lazy-load Catalog Update stack on first click with loading blur card
            document.addEventListener('click', async function (event) {
                const trigger = event.target?.closest?.('[data-est-action]');
                if (!trigger || trigger.dataset?.estAction !== 'catalog-update' || window.CatalogUpdateUI) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                document.querySelectorAll('#optionsMenu.open, .est-menu.open').forEach((menu) => menu.classList.remove('open'));
                const estMain = document.querySelector('#estimatingModule .est-main');
                let overlay = estMain?.querySelector('#estLoadingOverlay');
                let createdTemp = false;
                if (estMain && !overlay) {
                    overlay = document.createElement('div');
                    overlay.id = 'estLoadingOverlay';
                    overlay.className = 'est-loading-overlay';
                    overlay.setAttribute('role', 'status');
                    overlay.setAttribute('aria-live', 'polite');
                    overlay.innerHTML = '<div class="est-loading-card"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i><span id="estLoadingOverlayText">Cargando actualización desde Cost Catalog...</span></div>';
                    estMain.appendChild(overlay);
                    createdTemp = true;
                } else if (overlay) {
                    const txt = overlay.querySelector('#estLoadingOverlayText');
                    if (txt) txt.textContent = 'Cargando actualización desde Cost Catalog...';
                    overlay.hidden = false;
                }
                try {
                    await window.ensureDashboardFeature('catalog-update');
                    if (overlay && !createdTemp) overlay.hidden = true;
                    if (overlay && createdTemp) overlay.remove();
                    if (window.CatalogUpdateUI && typeof window.CatalogUpdateUI.checkCatalog === 'function') {
                        window.CatalogUpdateUI.checkCatalog();
                    }
                } catch (err) {
                    if (overlay && !createdTemp) overlay.hidden = true;
                    if (overlay && createdTemp) overlay.remove();
                    console.error('Failed to load Catalog Update tools:', err);
                    alert('Unable to load Cost Catalog Update tools. Please try again.');
                }
            }, true);
        })();
    </script>
    <script
        src="../assets/estimating_workspace_service.js?v=<?= filemtime(__DIR__ . '/../assets/estimating_workspace_service.js') ?>"></script>
    <script src="../assets/estimating_catalog_adapter.js?v=estimating-catalog-snapshot-20260827-1"></script>
    <script
        src="../assets/project_estimating_modals.js?v=<?= filemtime(__DIR__ . '/../assets/project_estimating_modals.js') ?>"></script>
    <script
        src="../assets/project_estimating.js?v=<?= filemtime(__DIR__ . '/../assets/project_estimating.js') ?>"></script>
    <?php if ($activeTab === 'proposal'): ?>
        <script>window.__proposalModuleLoaded = true;</script>
        <script src="../assets/project_proposal.js?v=<?= filemtime(__DIR__ . '/../assets/project_proposal.js') ?>"></script>
    <?php endif; ?>
    <script defer
        src="../assets/won_project_export.js?v=<?= filemtime(__DIR__ . '/../assets/won_project_export.js') ?>"></script>
    <script src="../assets/global_tools.js?v=<?= filemtime(__DIR__ . '/../assets/global_tools.js') ?>"></script>
</body>

</html>
