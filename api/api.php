<?php
// api.php - Backend Enterprise V6.3 (Strict File Validation)
require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../funciones/file_names.php';
header('Content-Type: application/json');

$userId = $_SESSION['user_id'] ?? 1;
$userRoleRaw = $_SESSION['role'] ?? 'viewer';
$userRole = strtolower($userRoleRaw); 

$action = $_POST['action'] ?? '';
$input = json_decode(file_get_contents('php://input'), true);
if(isset($input['action'])) $action = $input['action'];

function cleanName($name) {
    return clean_filename($name);
}

function db_has_column(PDO $pdo, string $table, string $column): bool {
    static $cache = [];
    $key = $table . '.' . $column;
    if (array_key_exists($key, $cache)) return $cache[$key];
    try {
        $stmt = $pdo->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
        $stmt->execute([$column]);
        $cache[$key] = ($stmt->rowCount() > 0);
    } catch (Throwable $e) {
        $cache[$key] = false;
    }
    return $cache[$key];
}

function ensure_report_attachments_table(PDO $pdo): void {
    static $done = false;
    if ($done) return;
    $done = true;
    $sql = "CREATE TABLE IF NOT EXISTS field_report_attachments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        field_report_id BIGINT UNSIGNED NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(191) NOT NULL,
        file_size BIGINT UNSIGNED NOT NULL,
        storage_path VARCHAR(1024) NOT NULL,
        public_url VARCHAR(1024) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_fra_report (field_report_id),
        CONSTRAINT fk_fra_report FOREIGN KEY (field_report_id) REFERENCES file_reports(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    try { $pdo->exec($sql); } catch (Throwable $e) { /* migration not guaranteed at runtime */ }
}

function inventory_sync_log_line(string $line): void {
    $dir = __DIR__ . '/../integrations/logs';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $file = $dir . '/inventory_sync.log';
    $entry = '[' . gmdate('c') . '] ' . $line . PHP_EOL;
    @file_put_contents($file, $entry, FILE_APPEND);
}

function sync_project_to_inventory_from_api(PDO $pdo, int $projectId): void {
    $inventoryUpsertUrl = trim((string)getenv('INVENTORY_UPSERT_URL'));
    if ($inventoryUpsertUrl === '') {
        return;
    }

    try {
        $stmt = $pdo->prepare("SELECT id, name, status, created_at, updated_at FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $stmt->execute([$projectId]);
        $project = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$project) {
            return;
        }

        $payload = [
            'project_id' => (string)$projectId,
            'name' => (string)($project['name'] ?? ''),
            'status' => isset($project['status']) ? (string)$project['status'] : null,
            'updated_at' => $project['updated_at'] ?? $project['created_at'] ?? null,
            'metadata' => [
                'source' => 'electroplan',
                'electroplan_project_id' => $projectId,
            ],
        ];

        $json = json_encode($payload);
        if ($json === false) {
            inventory_sync_log_line("project_id={$projectId} exception=json_encode_failed");
            return;
        }

        $headers = ['Content-Type: application/json'];
        $sharedKey = trim((string)getenv('INVENTORY_SHARED_KEY'));
        if ($sharedKey !== '') {
            $headers[] = 'X-Integration-Key: ' . $sharedKey;
        }

        $ch = curl_init($inventoryUpsertUrl);
        if ($ch === false) {
            inventory_sync_log_line("project_id={$projectId} curl_error=curl_init_failed");
            return;
        }

        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        curl_setopt($ch, CURLOPT_TIMEOUT, 6);

        $response = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno !== 0) {
            inventory_sync_log_line("project_id={$projectId} curl_error code={$errno} msg=" . $error);
            return;
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            $body = is_string($response) ? substr(preg_replace('/\\s+/', ' ', $response), 0, 500) : '';
            inventory_sync_log_line("project_id={$projectId} http_error code={$httpCode} body=" . $body);
            return;
        }

        inventory_sync_log_line("project_id={$projectId} sync_ok code={$httpCode}");
    } catch (Throwable $e) {
        inventory_sync_log_line("project_id={$projectId} exception=" . $e->getMessage());
    }
}

switch($action) {
    
    // --- 1. CREAR PROYECTO (ADMIN ONLY) ---
    case 'create_project':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }
        
        $name = trim($_POST['name'] ?? '');
        $desc = trim($_POST['description'] ?? '');
        $status = $_POST['status'] ?? 'Active';
        $userIds = $_POST['user_ids'] ?? [];

        try {
            if ($name === '') {
                echo json_encode(['status'=>'error', 'msg'=>'Project name required']); exit;
            }

            $selectedIds = [];
            $adminSelectedIds = [];
            if (is_array($userIds)) {
                foreach ($userIds as $uid) {
                    $uid = (int)$uid;
                    if ($uid > 0) $selectedIds[] = $uid;
                }
                $selectedIds = array_values(array_unique($selectedIds));
            }
            $hasUserSelection = !empty($selectedIds);
            if (!empty($selectedIds)) {
                $in = implode(',', array_fill(0, count($selectedIds), '?'));
                $stmtUsers = $pdo->prepare("SELECT id, role FROM users WHERE id IN ($in)");
                $stmtUsers->execute($selectedIds);
                $rows = $stmtUsers->fetchAll(PDO::FETCH_ASSOC);
                if (count($rows) !== count($selectedIds)) {
                    echo json_encode(['status'=>'error', 'msg'=>'Invalid users']); exit;
                }
                foreach ($rows as $row) {
                    if ($row['role'] === 'admin') $adminSelectedIds[] = (int)$row['id'];
                }
                if ($hasUserSelection && empty($adminSelectedIds)) {
                    echo json_encode(['status'=>'error', 'msg'=>'At least one admin must be assigned']); exit;
                }
            }

            $creatorId = (int)$userId;
            $selectedIds[] = $creatorId;
            $selectedIds = array_values(array_unique($selectedIds));
            $assignedUserId = !empty($adminSelectedIds) ? (int)$adminSelectedIds[0] : $creatorId;

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("INSERT INTO projects (name, description, status, created_by, assigned_user_id) VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([$name, $desc, $status, $creatorId, $assignedUserId]);
            $projectId = (int)$pdo->lastInsertId();

            if (!empty($selectedIds)) {
                $stmtDir = $pdo->prepare("INSERT IGNORE INTO directory (project_id, user_id) VALUES (?, ?)");
                foreach ($selectedIds as $uid) {
                    $stmtDir->execute([$projectId, $uid]);
                }
            }
            $pdo->commit();
            sync_project_to_inventory_from_api($pdo, $projectId);
            echo json_encode(['status'=>'success', 'id'=>$projectId]);
        } catch(Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            echo json_encode(['status'=>'error', 'msg'=>$e->getMessage()]);
        }
        break;

    // --- 1.1 ACTUALIZAR PROYECTO (ADMIN ONLY) ---
    case 'update_project':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }
        
        $id = $_POST['id'];
        $name = $_POST['name'];
        $desc = $_POST['description'];
        $status = $_POST['status']; 

        try {
            $stmt = $pdo->prepare("UPDATE projects SET name=?, description=?, status=? WHERE id=?");
            $stmt->execute([$name, $desc, $status, $id]);
            sync_project_to_inventory_from_api($pdo, (int)$id);
            echo json_encode(['status'=>'success']);
        } catch(Exception $e) { echo json_encode(['status'=>'error', 'msg'=>$e->getMessage()]); }
        break;

    // --- 1.2 ASIGNAR USUARIO A PROYECTO (ADMIN ONLY) ---
    case 'assign_project_user':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        $projectId = (int)($_POST['project_id'] ?? 0);
        $targetUserId = (int)($_POST['user_id'] ?? 0);

        if($projectId <= 0 || $targetUserId <= 0) { echo json_encode(['status'=>'error', 'msg'=>'Invalid data']); exit; }

        try {
            $stmt = $pdo->prepare("UPDATE projects SET assigned_user_id = ? WHERE id = ?");
            $stmt->execute([$targetUserId, $projectId]);

            $stmtDir = $pdo->prepare("INSERT IGNORE INTO directory (project_id, user_id) VALUES (?, ?)");
            $stmtDir->execute([$projectId, $targetUserId]);

            echo json_encode(['status'=>'success']);
        } catch(Exception $e) { echo json_encode(['status'=>'error', 'msg'=>$e->getMessage()]); }
        break;

    // --- 1.1.1 ACTUALIZAR INFO DE PROYECTO (ADMIN ONLY) ---
    case 'update_project_info':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        $id = (int)($_POST['id'] ?? 0);
        if ($id <= 0) { echo json_encode(['status'=>'error', 'msg'=>'Invalid project']); exit; }

        try {
            $cols = $pdo->query("DESCRIBE projects")->fetchAll(PDO::FETCH_COLUMN);
            $allowed = [
                'name','status','description','notes','address',
                'contact_name','contact_phone',
                'company_name','company_phone','company_address',
                'date_bid_sent','date_bid_awarded','date_started','date_finished','date_warranty_end'
            ];

            $set = [];
            $params = [];
            foreach ($allowed as $col) {
                if (in_array($col, $cols, true) && array_key_exists($col, $_POST)) {
                    $set[] = "$col = ?";
                    $val = $_POST[$col];
                    if ($val === '') $val = null;
                    $params[] = $val;
                }
            }
            if (empty($set)) { echo json_encode(['status'=>'error', 'msg'=>'No valid fields']); exit; }

            $params[] = $id;
            $sql = "UPDATE projects SET " . implode(', ', $set) . " WHERE id = ?";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            sync_project_to_inventory_from_api($pdo, $id);
            echo json_encode(['status'=>'success']);
        } catch(Exception $e) { echo json_encode(['status'=>'error', 'msg'=>$e->getMessage()]); }
        break;

    // --- 1.1.2 AGREGAR CARPETAS A PROYECTO (ADMIN ONLY) ---
    case 'add_project_folders':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }
        $projectId = (int)($_POST['project_id'] ?? 0);
        $folders = $_POST['folders'] ?? [];
        if($projectId <= 0 || !is_array($folders)) { echo json_encode(['status'=>'error', 'msg'=>'Invalid data']); exit; }

        $folderNames = [
            'bom' => 'BoM',
            'schedule_values' => 'Schedule of Values',
            'rfi' => 'RFI',
            'drawings' => 'Drawings',
            'photos' => 'Photos',
            'panel_schedule' => 'Panel Schedule',
            'panel_tags' => 'Panel Tags',
            'noc' => 'NOC',
            'submittal' => 'Submittal',
            'permit' => 'Permit',
            'acknowledgement' => 'Acknowledgement',
            'payapp' => 'Payapp',
            'insurance' => 'Certificate of Insurance',
            'fault_calc' => 'Fault Current Calc',
            'labor_record' => 'Labor Record',
            'expenses' => 'Expenses',
            'warranty_sup' => 'Warranty Supplier',
            'clock_in' => 'Clock In'
        ];

        try {
            $stmtExisting = $pdo->prepare("SELECT name FROM folders WHERE project_id = ? AND deleted_at IS NULL");
            $stmtExisting->execute([$projectId]);
            $existing = array_map('strtolower', $stmtExisting->fetchAll(PDO::FETCH_COLUMN));

            $stmtIns = $pdo->prepare("INSERT INTO folders (project_id, name) VALUES (?, ?)");
            foreach ($folders as $key) {
                if (!isset($folderNames[$key])) continue;
                $name = $folderNames[$key];
                if (in_array(strtolower($name), $existing, true)) continue;
                $stmtIns->execute([$projectId, $name]);
                $existing[] = strtolower($name);
            }
            echo json_encode(['status'=>'success']);
        } catch(Exception $e) { echo json_encode(['status'=>'error', 'msg'=>$e->getMessage()]); }
        break;

    // --- 12.1 MOVER CARPETA (ADMIN ONLY) ---
    case 'move_folder':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }
        $folderId = (int)($_POST['folder_id'] ?? 0);
        $targetProjectId = (int)($_POST['target_project_id'] ?? 0);
        $targetParentId = (int)($_POST['target_parent_folder_id'] ?? 0);

        if($folderId <= 0 || $targetProjectId <= 0) { echo json_encode(['status'=>'error', 'msg'=>'Invalid data']); exit; }

        try {
            $stmtFolder = $pdo->prepare("SELECT id, name, project_id FROM folders WHERE id = ? AND deleted_at IS NULL");
            $stmtFolder->execute([$folderId]);
            $folder = $stmtFolder->fetch(PDO::FETCH_ASSOC);
            if(!$folder) { echo json_encode(['status'=>'error', 'msg'=>'Folder not found']); exit; }

            if ($targetParentId > 0) {
                $stmtParent = $pdo->prepare("SELECT id FROM folders WHERE id = ? AND project_id = ? AND deleted_at IS NULL");
                $stmtParent->execute([$targetParentId, $targetProjectId]);
                if(!$stmtParent->fetch()) { echo json_encode(['status'=>'error', 'msg'=>'Target parent not found']); exit; }
            }

            $pdo->beginTransaction();

            if ($targetParentId > 0) {
                // Create/locate subfolder in target parent
                $stmtSub = $pdo->prepare("SELECT id FROM sub_folders WHERE folder_id = ? AND name = ? AND deleted_at IS NULL");
                $stmtSub->execute([$targetParentId, $folder['name']]);
                $subId = (int)$stmtSub->fetchColumn();
                if ($subId <= 0) {
                    $stmtInsSub = $pdo->prepare("INSERT INTO sub_folders (folder_id, name) VALUES (?, ?)");
                    $stmtInsSub->execute([$targetParentId, $folder['name']]);
                    $subId = (int)$pdo->lastInsertId();
                }

                // Move files into new subfolder
                $stmtFiles = $pdo->prepare("UPDATE files SET project_id = ?, folder_id = ?, sub_folder_id = ? WHERE folder_id = ?");
                $stmtFiles->execute([$targetProjectId, $targetParentId, $subId, $folderId]);

                // Move any subfolders to target parent
                $stmtMoveSub = $pdo->prepare("UPDATE sub_folders SET folder_id = ? WHERE folder_id = ?");
                $stmtMoveSub->execute([$targetParentId, $folderId]);

                // Soft delete original folder
                $pdo->prepare("UPDATE folders SET deleted_at = NOW() WHERE id = ?")->execute([$folderId]);
            } else {
                // Move folder to another project (top-level)
                $pdo->prepare("UPDATE folders SET project_id = ? WHERE id = ?")->execute([$targetProjectId, $folderId]);
                $pdo->prepare("UPDATE files SET project_id = ? WHERE folder_id = ?")->execute([$targetProjectId, $folderId]);
            }

            $pdo->commit();
            echo json_encode(['status'=>'success']);
        } catch(Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            echo json_encode(['status'=>'error', 'msg'=>$e->getMessage()]);
        }
        break;

    // --- 1.3 ASIGNAR MULTIPLES USUARIOS A PROYECTO (ADMIN ONLY) ---
    case 'assign_project_users':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        $projectId = (int)($_POST['project_id'] ?? 0);
        $userIds = $_POST['user_ids'] ?? [];

        if($projectId <= 0 || !is_array($userIds) || empty($userIds)) {
            echo json_encode(['status'=>'error', 'msg'=>'Invalid data']); exit;
        }

        try {
            $cleanIds = [];
            foreach($userIds as $uid) {
                $uid = (int)$uid;
                if($uid > 0) $cleanIds[] = $uid;
            }
            $cleanIds = array_values(array_unique($cleanIds));
            if(empty($cleanIds)) { echo json_encode(['status'=>'error', 'msg'=>'Invalid users']); exit; }

            $in = implode(',', array_fill(0, count($cleanIds), '?'));
            $stmtUsers = $pdo->prepare("SELECT id, role FROM users WHERE id IN ($in)");
            $stmtUsers->execute($cleanIds);
            $rows = $stmtUsers->fetchAll(PDO::FETCH_ASSOC);
            if (count($rows) !== count($cleanIds)) {
                echo json_encode(['status'=>'error', 'msg'=>'Invalid users']); exit;
            }
            $adminIds = [];
            foreach ($rows as $r) {
                if ($r['role'] === 'admin') $adminIds[] = (int)$r['id'];
            }
            if (empty($adminIds)) {
                echo json_encode(['status'=>'error', 'msg'=>'At least one admin must be assigned']); exit;
            }

            $pdo->beginTransaction();
            $pdo->prepare("DELETE FROM directory WHERE project_id = ?")->execute([$projectId]);
            $stmtDir = $pdo->prepare("INSERT IGNORE INTO directory (project_id, user_id) VALUES (?, ?)");
            foreach($cleanIds as $uid) {
                $stmtDir->execute([$projectId, $uid]);
            }
            $primaryId = $adminIds[0];
            $pdo->prepare("UPDATE projects SET assigned_user_id = ? WHERE id = ?")->execute([$primaryId, $projectId]);
            $pdo->commit();

            echo json_encode(['status'=>'success']);
        } catch(Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            echo json_encode(['status'=>'error', 'msg'=>$e->getMessage()]);
        }
        break;

    // --- 2. CREAR CARPETA (ADMIN ONLY) ---
    case 'create_folder':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        $projectId = (int)($_POST['project_id'] ?? 0);
        $name = trim((string)($_POST['name'] ?? ''));

        if ($projectId <= 0) {
            echo json_encode(['status'=>'error', 'msg'=>'Invalid project.']);
            exit;
        }
        if ($name === '') {
            echo json_encode(['status'=>'error', 'msg'=>'Folder name is required.']);
            exit;
        }
        if (mb_strlen($name) > 255) {
            echo json_encode(['status'=>'error', 'msg'=>'Folder name is too long (max 255 chars).']);
            exit;
        }

        try {
            $stmt = $pdo->prepare("INSERT INTO folders (project_id, name) VALUES (?, ?)");
            $stmt->execute([$projectId, $name]);
            echo json_encode(['status'=>'success']);
        } catch(Exception $e) { echo json_encode(['status'=>'error', 'msg'=>$e->getMessage()]); }
        break;

    // --- 3. SUBIR ARCHIVO CON VERSIONADO (ADMIN ONLY + VALIDACIONES) ---
    case 'upload_file':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        if (!isset($_FILES['file'])) { echo json_encode(['status'=>'error', 'msg'=>'No file']); exit; }
        
        // 3.1 Validar Tamaño (1GB = 1,073,741,824 bytes)
        $maxSize = 1073741824;
        if ($_FILES['file']['size'] > $maxSize) {
            echo json_encode(['status'=>'error', 'msg'=>'File exceeds 1GB limit']); 
            exit;
        }

        // 3.2 Validar Extensiones (PDF e Imágenes)
        $allowedExts = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'];
        $origName = $_FILES["file"]["name"];
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

        if (!in_array($ext, $allowedExts)) {
            echo json_encode(['status'=>'error', 'msg'=>'Invalid file type. Only PDF and Images allowed.']);
            exit;
        }

        $projectId = $_POST['project_id'];
        $folderId = !empty($_POST['folder_id']) ? $_POST['folder_id'] : NULL;
        $subFolderId = !empty($_POST['sub_folder_id']) ? $_POST['sub_folder_id'] : NULL;

        if ($subFolderId && !$folderId) {
            echo json_encode(['status'=>'error', 'msg'=>'Select a folder before choosing a subfolder.']);
            exit;
        }

        // Default folder: Drawings (create if missing)
        if (!$folderId) {
            $defaultFolderName = 'Drawings';
            $stmtDef = $pdo->prepare("SELECT id FROM folders WHERE project_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1");
            $stmtDef->execute([$projectId, $defaultFolderName]);
            $folderId = $stmtDef->fetchColumn();
            if (!$folderId) {
                $stmtCreate = $pdo->prepare("INSERT INTO folders (project_id, name) VALUES (?, ?)");
                $stmtCreate->execute([$projectId, $defaultFolderName]);
                $folderId = (int)$pdo->lastInsertId();
            }
        }
        
        $sqlCheck = "SELECT id, version_group_id, version_number FROM files 
                     WHERE project_id = ? AND filename = ? AND deleted_at IS NULL ";
        $params = [$projectId, $origName];
        
        if($folderId) { $sqlCheck .= " AND folder_id = ?"; $params[] = $folderId; } 
        else { $sqlCheck .= " AND folder_id IS NULL"; }

        if($subFolderId) { $sqlCheck .= " AND sub_folder_id = ?"; $params[] = $subFolderId; }
        else { $sqlCheck .= " AND sub_folder_id IS NULL"; }
        
        $sqlCheck .= " ORDER BY version_number DESC LIMIT 1";

        $stmtCheck = $pdo->prepare($sqlCheck);
        $stmtCheck->execute($params);
        $existing = $stmtCheck->fetch(PDO::FETCH_ASSOC);

        $versionGroup = uniqid('vgroup_'); 
        $versionNum = 1;

        if ($existing) {
            $versionGroup = $existing['version_group_id'] ?: uniqid('vgroup_');
            $versionNum = $existing['version_number'] + 1;
            if(!$existing['version_group_id']) {
                $pdo->prepare("UPDATE files SET version_group_id = ? WHERE id = ?")->execute([$versionGroup, $existing['id']]);
            }
        }

        $fileName = time() . '_' . cleanName($origName);
        $targetDir = __DIR__ . "/../uploads/";
        if (!file_exists($targetDir)) mkdir($targetDir, 0755, true);
        $targetPath = $targetDir . $fileName;
        $type = $ext; // Usamos la extensión validada
        
        if(move_uploaded_file($_FILES["file"]["tmp_name"], $targetPath)){
            $publicPath = "uploads/" . $fileName;
            $stmt = $pdo->prepare("INSERT INTO files (project_id, folder_id, sub_folder_id, filename, filepath, file_type, uploaded_by, version_group_id, version_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([$projectId, $folderId, $subFolderId, $origName, $publicPath, $type, $userId, $versionGroup, $versionNum]);
            echo json_encode(['status'=>'success']);
        } else echo json_encode(['status'=>'error', 'msg'=>'Upload failed']);
        break;

    // --- 4. SOFT DELETE (PAPELERA) ---
    case 'delete_entity':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        $type = $_POST['type']; 
        $id = $_POST['id'];
        $tableMap = ['project' => 'projects', 'folder' => 'folders', 'subfolder' => 'sub_folders', 'file' => 'files'];
        
        if(!isset($tableMap[$type])) { echo json_encode(['status'=>'error']); exit; }
        
        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare("UPDATE {$tableMap[$type]} SET deleted_at = ? WHERE id = ?");
        
        if($stmt->execute([$now, $id])) echo json_encode(['status'=>'success']);
        else echo json_encode(['status'=>'error']);
        break;

    // --- 4.1 ELIMINAR ARCHIVO (SOFT DELETE) ---
    case 'delete_file':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }
        $id = $_POST['id'] ?? 0;
        if(!$id) { echo json_encode(['status'=>'error', 'msg'=>'Invalid data']); exit; }
        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare("UPDATE files SET deleted_at = ? WHERE id = ?");
        if($stmt->execute([$now, $id])) echo json_encode(['status'=>'success']);
        else echo json_encode(['status'=>'error']);
        break;

    // --- 5. RESTAURAR (DE PAPELERA - UPDATED FOR REPORTS) ---
    case 'restore_entity':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        $type = $_POST['type']; 
        $id = $_POST['id'];
        
        // Manejo especial para Reportes (usan is_deleted)
        if ($type === 'report') {
            $stmt = $pdo->prepare("UPDATE file_reports SET is_deleted = 0 WHERE id = ?");
            if($stmt->execute([$id])) echo json_encode(['status'=>'success']);
            else echo json_encode(['status'=>'error']);
            exit;
        }

        // Manejo normal (deleted_at)
        $tableMap = ['project' => 'projects', 'folder' => 'folders', 'subfolder' => 'sub_folders', 'file' => 'files'];

        if(!isset($tableMap[$type])) { echo json_encode(['status'=>'error']); exit; }

        $stmt = $pdo->prepare("UPDATE {$tableMap[$type]} SET deleted_at = NULL WHERE id = ?");
        if($stmt->execute([$id])) echo json_encode(['status'=>'success']);
        else echo json_encode(['status'=>'error']);
        break;

    // --- 6. BORRADO MASIVO (SOFT DELETE) ---
    case 'delete_bulk':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        $ids = json_decode($_POST['ids'], true);
        if (is_array($ids)) {
            $now = date('Y-m-d H:i:s');
            $inQuery = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("UPDATE files SET deleted_at = ? WHERE id IN ($inQuery)");
            $params = array_merge([$now], $ids);
            $stmt->execute($params);
            
            echo json_encode(['status' => 'success']);
        } else {
            echo json_encode(['status' => 'error', 'msg' => 'Invalid data']);
        }
        break;
        
    // --- 7. HARD DELETE (PERMANENTE - UPDATED FOR REPORTS) ---
    case 'hard_delete_entity':
        if($userRole !== 'admin') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        $type = $_POST['type'];
        $id = (int)$_POST['id'];

        if ($type === 'file') {
            $stmt = $pdo->prepare("SELECT filepath FROM files WHERE id = ?");
            $stmt->execute([$id]);
            $file = $stmt->fetch();

            if ($file) {
                $path = $file['filepath'];
                $diskPath = $path;
                if (!empty($path) && strpos($path, 'uploads/') === 0) {
                    $diskPath = __DIR__ . '/../' . $path;
                }
                if (!empty($diskPath) && file_exists($diskPath)) {
                    unlink($diskPath);
                }
                $pdo->prepare("DELETE FROM files WHERE id = ?")->execute([$id]);
                $pdo->prepare("DELETE FROM file_reports WHERE file_id = ?")->execute([$id]);
            }
        } 
        elseif ($type === 'project') {
            $pdo->prepare("DELETE FROM projects WHERE id = ?")->execute([$id]);
        }
        // NUEVO: Borrar reporte individualmente
        elseif ($type === 'report') {
            // Borrar PDF y adjuntos físicos si existen
            $stmt = $pdo->prepare("SELECT report_pdf_path, attachments_json FROM file_reports WHERE id = ?");
            $stmt->execute([$id]);
            $rep = $stmt->fetch();
            if ($rep) {
                if (!empty($rep['report_pdf_path'])) {
                    $repPath = $rep['report_pdf_path'];
                    $repDiskPath = $repPath;
                    if (strpos($repPath, 'uploads/') === 0) {
                        $repDiskPath = __DIR__ . '/../' . $repPath;
                    }
                    if (file_exists($repDiskPath)) {
                        unlink($repDiskPath);
                    }
                }
                if (!empty($rep['attachments_json'])) {
                    $arr = json_decode($rep['attachments_json'], true);
                    if (is_array($arr)) {
                        foreach ($arr as $a) {
                            $p = $a['path'] ?? '';
                            if ($p && strpos($p, 'uploads/') === 0) {
                                $disk = __DIR__ . '/../' . $p;
                                if (file_exists($disk)) @unlink($disk);
                            }
                        }
                    }
                }
            }
            try {
                $pdo->prepare("DELETE FROM field_report_attachments WHERE field_report_id = ?")->execute([$id]);
            } catch (Throwable $e) {
                // optional table
            }
            $pdo->prepare("DELETE FROM file_reports WHERE id = ?")->execute([$id]);
        }

        echo json_encode(['status' => 'success']);
        break;

    // --- 8. GUARDAR REPORTE ---
    case 'save_report_flow':
        if($userRole === 'viewer') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        try {
            if (!isset($_POST['file_id']) || !isset($_FILES['pdf_file'])) {
                throw new Exception("Missing data (ID or PDF)");
            }

            $fileId = (int)$_POST['file_id'];
            $json = $_POST['annotations_json'] ?? '{}';
            $techName = trim((string)($_POST['tech_name'] ?? ''));
            $techRole = trim((string)($_POST['tech_role'] ?? ''));
            $desc = trim((string)($_POST['description'] ?? ''));

            $reportDir = __DIR__ . '/../uploads/reports/';
            if (!is_dir($reportDir)) { mkdir($reportDir, 0777, true); }

            $fileName = 'Report_F' . $fileId . '_' . time() . '.pdf';
            $destPath = $reportDir . $fileName;

            if (!move_uploaded_file($_FILES['pdf_file']['tmp_name'], $destPath)) {
                throw new Exception("Failed to save PDF file to server");
            }

            $allowedMimes = [
                'application/pdf',
                'application/msword',
                'application/vnd.ms-excel'
            ];
            $allowedPrefix = [
                'image/',
                'application/vnd.openxmlformats-officedocument.'
            ];
            $maxFiles = 5;
            $maxBytes = 10 * 1024 * 1024;
            $attachments = [];
            $attachmentsInput = $_FILES['attachments'] ?? null;

            if ($attachmentsInput && is_array($attachmentsInput['name'] ?? null)) {
                $count = count($attachmentsInput['name']);
                if ($count > $maxFiles) {
                    throw new Exception('Maximum 5 attachments per report');
                }

                $attachDir = __DIR__ . '/../uploads/report_attachments/';
                if (!is_dir($attachDir)) { mkdir($attachDir, 0777, true); }

                for ($i = 0; $i < $count; $i++) {
                    $err = (int)($attachmentsInput['error'][$i] ?? UPLOAD_ERR_NO_FILE);
                    if ($err === UPLOAD_ERR_NO_FILE) continue;
                    if ($err !== UPLOAD_ERR_OK) throw new Exception('Attachment upload error');

                    $tmp = $attachmentsInput['tmp_name'][$i] ?? '';
                    $orig = (string)($attachmentsInput['name'][$i] ?? 'attachment');
                    $size = (int)($attachmentsInput['size'][$i] ?? 0);
                    $mime = (string)($attachmentsInput['type'][$i] ?? 'application/octet-stream');

                    if ($size <= 0 || $size > $maxBytes) {
                        throw new Exception('Attachment exceeds 10MB: ' . $orig);
                    }

                    $mimeAllowed = in_array($mime, $allowedMimes, true);
                    if (!$mimeAllowed) {
                        foreach ($allowedPrefix as $prefix) {
                            if (strpos($mime, $prefix) === 0) { $mimeAllowed = true; break; }
                        }
                    }
                    if (!$mimeAllowed) {
                        throw new Exception('Unsupported attachment type: ' . $orig);
                    }

                    $safeBase = preg_replace('/[^A-Za-z0-9._-]/', '_', basename($orig));
                    if ($safeBase === '' || $safeBase === '.' || $safeBase === '..') $safeBase = 'attachment';
                    $stored = 'R' . $fileId . '_' . time() . '_' . $i . '_' . $safeBase;
                    $target = $attachDir . $stored;

                    if (!move_uploaded_file($tmp, $target)) {
                        throw new Exception('Failed to save attachment: ' . $orig);
                    }

                    $attachments[] = [
                        'name' => $orig,
                        'mime' => $mime,
                        'size' => $size,
                        'path' => 'uploads/report_attachments/' . $stored,
                        'url' => '../uploads/report_attachments/' . $stored
                    ];
                }
            }

            $publicReportPath = 'uploads/reports/' . $fileName;
            $hasAttachmentsJson = db_has_column($pdo, 'file_reports', 'attachments_json');

            if ($hasAttachmentsJson) {
                $stmt = $pdo->prepare("INSERT INTO file_reports (file_id, technician_name, technician_role, description, report_pdf_path, annotations_json, attachments_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
                $stmt->execute([$fileId, $techName, $techRole, $desc, $publicReportPath, $json, json_encode($attachments)]);
            } else {
                $stmt = $pdo->prepare("INSERT INTO file_reports (file_id, technician_name, technician_role, description, report_pdf_path, annotations_json) VALUES (?, ?, ?, ?, ?, ?)");
                $stmt->execute([$fileId, $techName, $techRole, $desc, $publicReportPath, $json]);
            }

            $reportId = (int)$pdo->lastInsertId();

            if (!empty($attachments)) {
                ensure_report_attachments_table($pdo);
                try {
                    $ins = $pdo->prepare("INSERT INTO field_report_attachments (field_report_id, original_name, mime_type, file_size, storage_path, public_url) VALUES (?, ?, ?, ?, ?, ?)");
                    foreach ($attachments as $a) {
                        $ins->execute([$reportId, $a['name'], $a['mime'], $a['size'], $a['path'], $a['url']]);
                    }
                } catch (Throwable $e) {
                    // optional relational table may not exist yet; keep attachments_json fallback
                }
            }

            echo json_encode(['status' => 'success', 'msg' => 'Report saved']);

        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['status' => 'error', 'msg' => $e->getMessage()]);
        }
        break;    

    // --- 9. ELIMINAR REPORTE (SOFT DELETE) ---
    case 'soft_delete_report':
        if($userRole === 'viewer') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }

        $reportId = $_POST['report_id'] ?? 0;

        try {
            $stmt = $pdo->prepare("UPDATE file_reports SET is_deleted = 1 WHERE id = ?");
            $stmt->execute([$reportId]);
            echo json_encode(['status'=>'success']);
        } catch(Exception $e) {
            echo json_encode(['status'=>'error', 'msg'=>$e->getMessage()]);
        }
        break;

    // --- 10. OBTENER LISTA DE PROYECTOS (Reforzado) ---
    case 'get_projects_list':
        // Quitamos la restricción estricta de 'viewer' para permitir cargar la lista, 
        // pero la acción de mover seguirá bloqueada para viewers en el frontend y backend.
        try {
            $stmt = $pdo->query("SELECT id, name FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC");
            $projects = $stmt->fetchAll(PDO::FETCH_ASSOC);
            echo json_encode(['status' => 'success', 'data' => $projects]);
        } catch (Exception $e) {
            echo json_encode(['status' => 'error', 'msg' => $e->getMessage()]);
        }
        break;

    // --- 11. OBTENER CARPETAS (Reforzado) ---
    case 'get_folders_list':
        $pid = $_POST['project_id'] ?? 0;
        try {
            $stmt = $pdo->prepare("SELECT id, name FROM folders WHERE project_id = ? AND deleted_at IS NULL ORDER BY name ASC");
            $stmt->execute([$pid]);
            $folders = $stmt->fetchAll(PDO::FETCH_ASSOC);
            echo json_encode(['status' => 'success', 'data' => $folders]);
        } catch (Exception $e) {
            echo json_encode(['status' => 'error', 'msg' => $e->getMessage()]);
        }
        break;

    // --- 12. MOVER ENTIDAD (Reforzado) ---
    case 'move_entity':
        if($userRole === 'viewer') { echo json_encode(['status'=>'error', 'msg'=>'Access Denied']); exit; }
        
        $id = $_POST['id'];
        $type = $_POST['type']; 
        $targetProj = $_POST['target_project_id'];
        $targetFolder = !empty($_POST['target_folder_id']) ? $_POST['target_folder_id'] : NULL;

        if ($type === 'file') {
            try {
                $stmt = $pdo->prepare("UPDATE files SET project_id = ?, folder_id = ? WHERE id = ?");
                $stmt->execute([$targetProj, $targetFolder, $id]);
                echo json_encode(['status' => 'success']);
            } catch (Exception $e) {
                echo json_encode(['status' => 'error', 'msg' => $e->getMessage()]);
            }
        } else {
            echo json_encode(['status' => 'error', 'msg' => 'Invalid type']);
        }
        break;    

    default: echo json_encode(['status'=>'error', 'msg'=>'Invalid action']);
}
?>
