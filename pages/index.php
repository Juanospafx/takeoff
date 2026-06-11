<?php
// index.php - V8.4 (Updated for New Project Structure)
require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/time.php'; 

// ---------------------------------------------------------
// 1. DEFINICIÓN DE USUARIO Y ROLES
// ---------------------------------------------------------
$userId = $_SESSION['user_id'];
$userName = $_SESSION['username'];
$userRoleRaw = $_SESSION['role'] ?? 'viewer'; 
$userRole = strtolower($userRoleRaw); 
$isAdmin = ($userRole === 'admin'); $canCreate = $isAdmin; $canDelete = $isAdmin; $canUpload = $isAdmin;

// ---------------------------------------------------------
// 2. LÓGICA DE ACCIONES (POST y GET)
// ---------------------------------------------------------
// Nota: La creación de proyectos ahora se maneja en 'api/create_project.php'
// Mantenemos la lógica de carpetas por si acaso, aunque el dashboard nuevo la gestionará.
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    // CREAR CARPETA (Legacy support / Quick create)
    if ($_POST['action'] === 'create_folder' && $isAdmin) {
        $name = trim($_POST['new_folder_name']);
        $pId = $_POST['project_id'];
        if(!empty($name) && !empty($pId)){
            $check = $pdo->prepare("SELECT id FROM folders WHERE name=? AND project_id=? AND deleted_at IS NULL");
            $check->execute([$name, $pId]);
            if(!$check->fetch()) {
                $stmt = $pdo->prepare("INSERT INTO folders (name, project_id) VALUES (?, ?)");
                $stmt->execute([$name, $pId]);
            }
        }
        // Redirigir al nuevo dashboard si se crea desde ahí
        header("Location: project_dashboard.php?id=$pId"); 
        exit;
    }
}

// BORRAR CARPETA
if (isset($_GET['action']) && $_GET['action'] === 'delete_folder' && isset($_GET['id']) && $isAdmin) {
    $folderIdDel = $_GET['id'];
    $stmt = $pdo->prepare("UPDATE folders SET deleted_at = NOW() WHERE id = ?");
    $stmt->execute([$folderIdDel]);
    if(isset($_SERVER['HTTP_REFERER'])) { header("Location: " . $_SERVER['HTTP_REFERER']); } else { header("Location: index.php"); }
    exit;
}

// ---------------------------------------------------------
// 3. INICIALIZAR VARIABLES Y VISTAS
// ---------------------------------------------------------
$projectId = $_GET['project_id'] ?? null;
$folderId = $_GET['folder_id'] ?? null;
$viewTrash = isset($_GET['view']) && $_GET['view'] === 'trash' && $isAdmin;

$viewLevel = 'dashboard';
$pageTitle = "Dashboard"; 
$project = null; $folder = null;
$folders = []; $subFolders = []; $files = []; $recentFiles = []; 
$stats = []; $recentProjects = []; $trashProjects = []; $trashFiles = []; $trashReports = []; 
$assignUsers = []; $assignedUserIds = [];

// ---------------------------------------------------------
// 4. CONSULTAS DE DATOS
// ---------------------------------------------------------

if ($viewTrash) {
    $pageTitle = "Recycle Bin";
    $viewLevel = 'trash';
    $trashProjects = $pdo->query("SELECT * FROM projects WHERE deleted_at IS NOT NULL")->fetchAll(PDO::FETCH_ASSOC);
    $trashFiles = $pdo->query("SELECT * FROM files WHERE deleted_at IS NOT NULL")->fetchAll(PDO::FETCH_ASSOC);
    $trashReports = $pdo->query("SELECT r.*, f.filename FROM file_reports r LEFT JOIN files f ON r.file_id = f.id WHERE r.is_deleted = 1 ORDER BY r.created_at DESC")->fetchAll(PDO::FETCH_ASSOC);
}
elseif (!$projectId) {
    // VISTA PRINCIPAL (HOME)
    $stats['total_projects'] = $pdo->query("SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL")->fetchColumn();
    $stats['total_files'] = $pdo->query("SELECT COUNT(*) FROM files WHERE deleted_at IS NULL")->fetchColumn();
    
    // Obtener proyectos recientes
    $recentProjects = $pdo->query("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);
    
    // Obtener archivos recientes globalmente
    $recentFiles = $pdo->query("SELECT f.*, p.name as project_name, fo.name as folder_name FROM files f LEFT JOIN projects p ON f.project_id = p.id LEFT JOIN folders fo ON f.folder_id = fo.id WHERE f.deleted_at IS NULL ORDER BY f.uploaded_at DESC LIMIT 8")->fetchAll(PDO::FETCH_ASSOC);
}
else {
    // VISTA LEGACY (Si alguien entra por un link antiguo) - Redirigir al nuevo dashboard recomendado
    // Descomenta la siguiente linea si quieres forzar la redirección:
    // header("Location: project_dashboard.php?id=$projectId"); exit;

    $project = $pdo->query("SELECT * FROM projects WHERE id=$projectId")->fetch(PDO::FETCH_ASSOC);
    if(!$project) die("Project not found");
    $pageTitle = $project['name'];
    
    if (!$folderId) {
        $viewLevel = 'project';
        $folders = $pdo->prepare("SELECT * FROM folders WHERE project_id=? AND deleted_at IS NULL ORDER BY id DESC"); 
        $folders->execute([$projectId]); $folders = $folders->fetchAll(PDO::FETCH_ASSOC);
        $stmtFiles = $pdo->prepare("SELECT f.*, fo.name as folder_name FROM files f LEFT JOIN folders fo ON f.folder_id = fo.id WHERE f.project_id = ? AND f.deleted_at IS NULL ORDER BY f.uploaded_at DESC");
        $stmtFiles->execute([$projectId]); $files = $stmtFiles->fetchAll(PDO::FETCH_ASSOC);

        if ($isAdmin) {
            $assignUsers = $pdo->query("SELECT id, username, role FROM users ORDER BY username ASC")->fetchAll(PDO::FETCH_ASSOC);
            $stmtAssigned = $pdo->prepare("SELECT user_id FROM directory WHERE project_id = ?");
            $stmtAssigned->execute([$projectId]);
            $assignedUserIds = array_map('intval', $stmtAssigned->fetchAll(PDO::FETCH_COLUMN));
        }
    } else {
        $viewLevel = 'folder';
        $folder = $pdo->query("SELECT * FROM folders WHERE id=$folderId")->fetch(PDO::FETCH_ASSOC);
        if($folder) {
            $pageTitle .= " / " . $folder['name'];
            $subFolders = $pdo->prepare("SELECT * FROM sub_folders WHERE folder_id=? AND deleted_at IS NULL ORDER BY id DESC"); 
            $subFolders->execute([$folderId]); $subFolders = $subFolders->fetchAll(PDO::FETCH_ASSOC);
            $stmtFiles = $pdo->prepare("SELECT f.*, fo.name as folder_name FROM files f LEFT JOIN folders fo ON f.folder_id = fo.id WHERE f.folder_id = ? AND f.sub_folder_id IS NULL AND f.deleted_at IS NULL ORDER BY f.uploaded_at DESC");
            $stmtFiles->execute([$folderId]); $files = $stmtFiles->fetchAll(PDO::FETCH_ASSOC);
        } else { die("Folder not found"); }
    }
}

// INCLUYE HEADER (Trae CSS, Sidebar y abre el d-flex-wrapper)
include __DIR__ . '/../views/header.php'; 
?>

<style>
    @media (max-width: 992px) {
        .proj-actions { flex-wrap: wrap; gap: 8px; }
        .proj-actions .btn,
        .proj-actions .btn-main { width: 100%; }
        .folder-grid .col-md-3,
        .file-grid .col-md-3 { flex: 0 0 100%; max-width: 100%; }
        .box-card { padding: 16px; }
        .file-card-item { padding: 16px; }
    }
    @media (max-width: 768px) {
        .header { flex-direction: column; align-items: flex-start; gap: 12px; }
        .breadcrumbs { margin-top: 4px; }
        .main-content { padding: 20px; }
        .d-flex.justify-content-between.align-items-end { flex-direction: column; align-items: flex-start; gap: 12px; }
    }
</style>

    <main class="main-content">
        
        <header class="header">
            <div class="d-flex align-items-center gap-3">
                <button class="mobile-toggle" onclick="toggleSidebar()">
                    <i class="fas fa-bars"></i>
                </button>

                <div class="breadcrumbs">
                    <a href="index.php">Home</a>
                    <?php if($viewTrash): ?> <i class="fas fa-chevron-right mx-2" style="font-size:0.7rem"></i><span>Recycle Bin</span> <?php endif; ?>
                    <?php if($projectId && !$viewTrash): ?>
                        <i class="fas fa-chevron-right mx-2" style="font-size:0.7rem"></i><span><?= htmlspecialchars($project['name']) ?></span>
                        <?php if($folderId && $folder): ?><i class="fas fa-chevron-right mx-2" style="font-size:0.7rem"></i><span class="text-primary"><?= htmlspecialchars($folder['name']) ?></span><?php endif; ?>
                    <?php endif; ?>
                </div>
            </div>

            <div class="user-pill">
                <div class="avatar"><?= strtoupper(substr($userName,0,1)) ?></div>
                <div class="d-flex flex-column" style="line-height:1">
                    <span class="small fw-bold"><?= htmlspecialchars($userName) ?></span>
                    <span class="role-badge"><?= ucfirst($userRole) ?></span>
                </div>
            </div>
        </header>

        <?php if(!$projectId && !$viewTrash): ?>
            <div class="d-flex justify-content-between align-items-end mb-5">
                <div><h1 class="fw-bold mb-2">Welcome Back!</h1><p class="text-gray mb-0">Here is the latest activity.</p></div>
                <?php if($canCreate): ?>
                    <a href="project_create.php" class="btn-main text-decoration-none">
                        <i class="fas fa-plus me-2"></i> New Project
                    </a>
                <?php endif; ?>
            </div>

            <div class="row g-4 mb-5 justify-content-center">
                <div class="col-md-10"><div class="box-card"><i class="fas fa-file-pdf stat-icon-bg"></i><div class="stat-num"><?= $stats['total_files'] ?></div><div class="stat-label">Total Active PDFs & Blueprints</div></div></div>
            </div>
            
            <h5 class="fw-bold mb-4">Recent Projects (Latest 10)</h5>
            <div class="row g-4 mb-5">
                <?php foreach($recentProjects as $p): ?>
                <div class="col-md-4 col-xl-3">
                    <a href="project_dashboard.php?id=<?= $p['id'] ?>" class="box-card d-block">
                        <div class="proj-status">Active</div>
                        <div class="proj-title"><?= htmlspecialchars($p['name']) ?></div>
                        <div class="proj-desc"><?= htmlspecialchars($p['description'] ?: 'No description.') ?></div>
                        <div class="mt-4 pt-3 border-top border-secondary d-flex justify-content-between align-items-center text-gray small">
                            <span><?= date('M d', strtotime($p['created_at'])) ?></span>
                            <i class="fas fa-arrow-right"></i>
                        </div>
                    </a>
                </div>
                <?php endforeach; ?>
                
                <?php if($canCreate): ?>
                <div class="col-md-4 col-xl-3">
                    <a href="project_create.php" class="text-decoration-none">
                        <div class="box-card box-card-dashed h-100 d-flex flex-column align-items-center justify-content-center">
                            <div class="mb-2 p-3 rounded-circle bg-dark"><i class="fas fa-plus fa-lg text-white"></i></div>
                            <div class="fw-bold text-white">Create New Project</div>
                        </div>
                    </a>
                </div>
                <?php endif; ?>
            </div>

            <?php if(!empty($recentFiles)): ?>
            <h5 class="fw-bold mb-4">Recently Uploaded Files</h5>
            <div class="row g-3">
                <?php foreach($recentFiles as $f): 
                    $ft = strtolower(pathinfo($f['filename'], PATHINFO_EXTENSION));
                    $isPdf = ($ft === 'pdf'); $isImg = in_array($ft, ['jpg', 'jpeg', 'png', 'webp', 'gif']);
                    $tileClass = 'file-gen'; $iconClass = 'fa-file';
                    if($isPdf) { $tileClass='pdf'; $iconClass='fa-file-pdf'; } elseif($isImg) { $tileClass='img'; $iconClass='fa-image'; }
                ?>
                <div class="col-md-3 col-xl-2">
                    <div class="box-card text-center p-3">
                        <div class="file-tile <?= $tileClass ?>" style="width:50px; height:60px;">
                            <i class="fas <?= $iconClass ?>" style="font-size:1.5rem"></i>
                            <?php if(isset($f['version_number']) && $f['version_number'] > 1): ?>
                                <span class="version-badge" style="font-size:0.55rem; padding:1px 4px;">V<?= $f['version_number'] ?></span>
                            <?php endif; ?>
                        </div>
                        <h6 class="fw-bold text-truncate w-100 mb-1" style="font-size:0.9rem"><?= htmlspecialchars($f['filename']) ?></h6>
                        <small class="text-accent d-block mb-1 text-truncate" style="font-size:0.7rem"><i class="fas fa-layer-group me-1"></i> <?= htmlspecialchars($f['project_name']) ?></small>
                        <small class="text-gray d-block mb-3" style="font-size:0.75rem"><?= date('M d, Y', strtotime($f['uploaded_at'])) ?></small>
                        
                        <div class="d-flex justify-content-center gap-2">
                            <a href="preview.php?id=<?= $f['id'] ?>" class="btn-icon" style="width:30px;height:30px;font-size:0.8rem"><i class="fas fa-eye"></i></a>
                            <?php if($userRole !== 'viewer'): ?><a href="editor.php?id=<?= $f['id'] ?>" class="btn-icon text-primary border-primary" style="width:30px;height:30px;font-size:0.8rem"><i class="fas fa-pen"></i></a><?php endif; ?>
                        </div>
                    </div>
                </div>
                <?php endforeach; ?>
            </div>
            <?php endif; ?>

        <?php elseif($viewTrash): ?>
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h4 class="text-danger mb-0"><i class="fas fa-trash-alt me-2"></i> Recycle Bin</h4>
                <button class="btn btn-sm btn-outline-danger rounded-pill px-3" onclick="selectAllTrash()">
                    <i class="fas fa-check-double me-2"></i> Select All
                </button>
            </div>

            <div class="row g-3">
                <?php if(empty($trashProjects) && empty($trashFiles) && empty($trashReports)): ?>
                    <div class="col-12 text-center text-gray py-5">Recycle bin is empty.</div>
                <?php endif; ?>
                <?php foreach($trashProjects as $tp): ?>
                    <div class="col-md-4">
                        <div class="box-card border-danger cursor-pointer" id="t-card-project-<?= $tp['id'] ?>" onclick="toggleTrashSelect('project', <?= $tp['id'] ?>)">
                            <div class="selection-check" id="t-check-project-<?= $tp['id'] ?>"></div>
                            <h5 class="text-white"><?= htmlspecialchars($tp['name']) ?> <small>(Project)</small></h5>
                            <small class="text-muted">Deleted: <?= $tp['deleted_at'] ?></small>
                        </div>
                    </div>
                <?php endforeach; ?>
                <?php foreach($trashFiles as $tf): ?>
                    <div class="col-md-3">
                        <div class="box-card border-danger text-center cursor-pointer" id="t-card-file-<?= $tf['id'] ?>" onclick="toggleTrashSelect('file', <?= $tf['id'] ?>)">
                            <div class="selection-check" id="t-check-file-<?= $tf['id'] ?>"></div>
                            <i class="fas fa-file fa-2x mb-2 text-danger"></i>
                            <h6 class="text-truncate"><?= htmlspecialchars($tf['filename']) ?></h6>
                            <small class="text-muted">Deleted: <?= $tf['deleted_at'] ?></small>
                        </div>
                    </div>
                <?php endforeach; ?>
                <?php foreach($trashReports as $tr): ?>
                    <div class="col-md-4">
                        <div class="box-card border-warning cursor-pointer" id="t-card-report-<?= $tr['id'] ?>" onclick="toggleTrashSelect('report', <?= $tr['id'] ?>)">
                            <div class="selection-check" id="t-check-report-<?= $tr['id'] ?>"></div>
                            <div class="d-flex align-items-center gap-2 mb-2"><i class="fas fa-clipboard-list text-warning"></i><span class="fw-bold text-white small">Report</span></div>
                            <div class="small text-gray mb-2">File: <span class="text-white"><?= htmlspecialchars($tr['filename'] ?? 'Unknown File') ?></span></div>
                            <div class="small text-gray mb-2">Tech: <span class="text-white"><?= htmlspecialchars($tr['technician_name']) ?></span></div>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
            
            <div class="bulk-actions-bar" id="trash-bulk-bar">
                <div class="d-flex align-items-center gap-3">
                    <div class="bg-danger rounded-circle d-flex align-items-center justify-content-center" style="width:30px;height:30px;font-weight:bold" id="trash-bulk-count">0</div><span class="fw-bold">Selected</span>
                </div>
                <button class="btn btn-outline-success rounded-pill px-4 btn-sm" onclick="restoreSelected()"><i class="fas fa-trash-restore me-2"></i> Restore</button>
                <button class="btn btn-outline-danger rounded-pill px-4 btn-sm" onclick="hardDeleteSelected()"><i class="fas fa-fire me-2"></i> Delete Forever</button>
                <button class="btn btn-sm btn-outline-secondary border-0" onclick="clearTrashSelection()"><i class="fas fa-times"></i></button>
            </div>

        <?php else: ?>
            <?php $backUrl = ($viewLevel === 'folder') ? "index.php?project_id=$projectId" : "index.php"; ?>
            <div class="d-flex justify-content-between align-items-center mb-5">
                <div class="d-flex align-items-center gap-4"><a href="<?= $backUrl ?>" class="btn-back"><i class="fas fa-arrow-left"></i></a><div><h2 class="fw-bold mb-1"><?= htmlspecialchars($viewLevel === 'project' ? $project['name'] : $folder['name']) ?></h2><p class="text-gray mb-0">Project Files</p></div></div>
                <div class="d-flex gap-3 proj-actions">
                    <?php if($viewLevel === 'project' && $canCreate): ?><button class="btn btn-outline-light rounded-pill px-4 fw-bold" data-bs-toggle="modal" data-bs-target="#newFolderModal"><i class="fas fa-folder-plus me-2"></i> Folder</button><?php endif; ?>
                    <?php if($viewLevel === 'project' && $isAdmin): ?><button class="btn btn-outline-info rounded-pill px-4 fw-bold" onclick="openAssignUsersModal()"><i class="fas fa-user-plus me-2"></i> Assign Users</button><?php endif; ?>
                    <?php if($canUpload): ?><button class="btn-main" onclick="openUploadModal()"><i class="fas fa-cloud-upload-alt me-2"></i> Upload</button><?php endif; ?>
                </div>
            </div>

            <?php if(!empty($folders)): ?>
            <div class="row g-3 mb-5 folder-grid">
                <?php foreach($folders as $item): $isRep = ($item['name'] === 'Reports'); ?>
                <div class="col-md-3">
                    <div class="box-card p-3 d-flex align-items-center justify-content-between">
                        <a href="index.php?project_id=<?= $projectId . "&folder_id=" . $item['id'] ?>" class="d-flex align-items-center gap-3 w-100 folder-card">
                            <i class="fas <?= $isRep ? 'fa-clipboard-list text-success' : 'fa-folder folder-icon' ?> fa-2x"></i>
                            <span class="fw-bold fs-5 text-white"><?= htmlspecialchars($item['name']) ?></span>
                        </a>
                        <?php if(!$isRep && $canDelete): ?>
                            <a href="index.php?action=delete_folder&id=<?= $item['id'] ?>" class="text-danger opacity-25 hover-opacity-100 ms-2" onclick="return confirm('Delete folder?')"><i class="fas fa-trash"></i></a>
                        <?php endif; ?>
                    </div>
                </div>
                <?php endforeach; ?>
            </div>
            <?php endif; ?>

            <div class="d-flex justify-content-between align-items-center mb-3"><h6 class="text-gray fw-bold small ls-1 mb-0">Files</h6><?php if(!empty($files) && $canDelete): ?><button class="btn btn-sm btn-outline-light rounded-pill px-3" onclick="selectAll()"><i class="fas fa-check-double me-2"></i> Select All</button><?php endif; ?></div>
            <div class="row g-3 file-grid">
                <?php foreach($files as $f): 
                    $ft = strtolower(pathinfo($f['filename'], PATHINFO_EXTENSION));
                    $isPdf = ($ft === 'pdf'); 
                    $isImg = in_array($ft, ['jpg', 'jpeg', 'png', 'webp', 'gif']);
                    $folderLabel = !empty($f['folder_name']) ? $f['folder_name'] : 'Root';
                    $tileClass = 'file-gen'; 
                    $iconClass = 'fa-file';
                    if($isPdf) { $tileClass='pdf'; $iconClass='fa-file-pdf'; } elseif($isImg) { $tileClass='img'; $iconClass='fa-image'; }
                ?>
                <div class="col-md-3">
                    <div class="box-card text-center p-4 file-card-item" id="card-<?= $f['id'] ?>" <?= $canDelete ? "onclick=\"toggleSelect({$f['id']})\"" : '' ?>>
                        <?php if($canDelete): ?><div class="selection-check" id="check-<?= $f['id'] ?>"></div><?php endif; ?>
                        
                        <div class="file-tile <?= $tileClass ?>">
                            <i class="fas <?= $iconClass ?>"></i>
                            <?php if(isset($f['version_number']) && $f['version_number'] > 1): ?>
                                <span class="version-badge">V<?= $f['version_number'] ?></span>
                            <?php endif; ?>
                        </div>
                        
                        <h6 class="fw-bold text-truncate w-100 mb-1"><?= htmlspecialchars($f['filename']) ?></h6>
                        <small class="text-accent d-block mb-3"><i class="fas fa-folder-open me-1"></i> <?= htmlspecialchars($folderLabel) ?></small>
                        <small class="text-gray d-block mb-3"><?= date('M d, Y', strtotime($f['uploaded_at'])) ?></small>
                        
                        <div class="d-flex justify-content-center gap-2" onclick="event.stopPropagation()">
                            <a href="preview.php?id=<?= $f['id'] ?>" class="btn-icon" title="View"><i class="fas fa-eye"></i></a>
                            
                            <?php if($userRole !== 'viewer'): ?>
                                <a href="editor.php?id=<?= $f['id'] ?>" class="btn-icon text-primary border-primary" title="Edit"><i class="fas fa-pen"></i></a>
                            <?php endif; ?>
                            
                            <?php if($canDelete): ?>
                                <button class="btn-icon text-warning border-warning" onclick="openMoveModal(<?= $f['id'] ?>, 'file')" title="Move"><i class="fas fa-exchange-alt"></i></button>
                                <button class="btn-icon text-danger border-danger" onclick="deleteFile(<?= $f['id'] ?>)" title="Delete"><i class="fas fa-trash"></i></button>
                            <?php endif; ?>
                        </div>
                    </div>
                </div>
                <?php endforeach; ?>
                <?php if(empty($files) && empty($folders)): ?><div class="col-12 py-5 text-center text-gray"><i class="fas fa-box-open fa-3x mb-3 opacity-25"></i><p>Empty Folder</p></div><?php endif; ?>
            </div>
            
            <?php if($canDelete): ?>
            <div class="bulk-actions-bar" id="bulk-bar">
                <div class="d-flex align-items-center gap-3"><div class="bg-primary rounded-circle d-flex align-items-center justify-content-center" style="width:30px;height:30px;font-weight:bold" id="bulk-count">0</div><span class="fw-bold">Selected</span></div>
                <button class="btn btn-outline-danger rounded-pill px-4 btn-sm" onclick="deleteBulk()"><i class="fas fa-trash-alt me-2"></i> Move to Trash</button>
                <button class="btn btn-sm btn-outline-secondary border-0" onclick="clearSelection()"><i class="fas fa-times"></i></button>
            </div>
            <?php endif; ?>
        <?php endif; ?>
    </main>

</div> <?php include __DIR__ . '/../views/modals.php'; ?>

<?php if($viewLevel === 'project' && $isAdmin): ?>
<div class="modal fade" id="assignUsersModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Assign Users to Project</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form id="assignUsersForm">
                <input type="hidden" name="action" value="assign_project_users">
                <input type="hidden" name="project_id" value="<?= (int)$projectId ?>">
                <div class="modal-body">
                    <label class="text-gray small mb-2">Assign Users</label>
                    <div class="border rounded p-2" style="max-height:200px; overflow:auto;">
                        <?php foreach($assignUsers as $u): ?>
                            <label class="d-flex align-items-center gap-2 small text-gray mb-2">
                                <input type="checkbox" name="user_ids[]" value="<?= (int)$u['id'] ?>" data-role="<?= htmlspecialchars($u['role']) ?>" <?= in_array((int)$u['id'], $assignedUserIds, true) ? 'checked' : '' ?>>
                                <span><?= htmlspecialchars($u['username']) ?> (<?= htmlspecialchars($u['role']) ?>)</span>
                            </label>
                        <?php endforeach; ?>
                        <?php if(empty($assignUsers)): ?>
                            <div class="text-gray small">No users available.</div>
                        <?php endif; ?>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn-main w-100">Assign Selected Users</button>
                </div>
            </form>
        </div>
    </div>
</div>
<?php endif; ?>

<script>
    // Variables Globales PHP -> JS
    const pId = <?= json_encode($projectId) ?>;
    const fId = <?= json_encode($folderId) ?>;
    const allFiles = <?= !empty($files) ? json_encode(array_column($files, 'id')) : '[]' ?>;
    const canUpload = <?= $canUpload ? 'true' : 'false' ?>;
    
    // Variables de Papelera para Select All
    const isTrashView = <?= $viewTrash ? 'true' : 'false' ?>;
    const trashProjects = <?= $viewTrash ? json_encode(array_column($trashProjects, 'id')) : '[]' ?>;
    const trashFiles = <?= $viewTrash ? json_encode(array_column($trashFiles, 'id')) : '[]' ?>;
    const trashReports = <?= $viewTrash ? json_encode(array_column($trashReports, 'id')) : '[]' ?>;


    // ==========================================
    // 1. DRAG & DROP PROFESIONAL
    // ==========================================
    // (Asumiendo que dropOverlay existe en header o footer)
    const dropOverlay = document.getElementById('drop-overlay'); 
    let dragCounter = 0; 

    if (canUpload && pId && dropOverlay) {
        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                dragCounter++;
                dropOverlay.style.display = 'flex';
            }
        });
        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) { dropOverlay.style.display = 'none'; dragCounter = 0; }
        });
        window.addEventListener('dragover', (e) => { e.preventDefault(); });
        window.addEventListener('drop', (e) => {
            e.preventDefault(); dragCounter = 0; dropOverlay.style.display = 'none';
            if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
        });
    }

    // Input Manual
    function openUploadModal() { if(canUpload) document.getElementById('globalFileInput').click(); }
    const gInput = document.getElementById('globalFileInput');
    if(gInput) gInput.addEventListener('change', function() { handleFiles(this.files); });

    // Procesador de Subida
    async function handleFiles(fileList) {
        if(fileList.length === 0) return;
        if(!pId) { alert("Error: No project selected."); return; }

        const btnUp = document.querySelector('.btn-main'); 
        if(btnUp) { btnUp.disabled = true; btnUp.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...'; }

        const MAX_SIZE = 1073741824; // 1GB
        const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];
        
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            
            if (file.size > MAX_SIZE) {
                alert(`Error: El archivo "${file.name}" supera el límite de 1GB.`);
                continue; 
            }

            if (!ALLOWED_TYPES.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|gif|webp|pdf|bmp|tiff)$/i)) {
                 alert(`Error: El archivo "${file.name}" no es válido. Solo se permiten PDF e Imágenes.`);
                 continue; 
            }

            const fd = new FormData(); 
            fd.append('action', 'upload_file'); fd.append('file', file); fd.append('project_id', pId); 
            if(fId) fd.append('folder_id', fId);
            
            try { 
                let response = await fetch('../api/api.php', { method: 'POST', body: fd }); 
                let data = await response.json();
                if(data.status === 'error') {
                    alert(`Error subiendo ${file.name}: ${data.msg}`);
                }
            } catch (e) { 
                console.error(e); 
                alert(`Error de conexión subiendo ${file.name}`);
            }
        }
        location.reload();
    }


    // ==========================================
    // 2. LOGICA MOVER ARCHIVOS
    // ==========================================
    function openMoveModal(id, type) {
        document.getElementById('move_id').value = id;
        document.getElementById('move_type').value = type;
        const projSelect = document.getElementById('move_project_select');
        const folderSelect = document.getElementById('move_folder_select');
        
        projSelect.innerHTML = '<option value="">Loading projects...</option>';
        folderSelect.innerHTML = '<option value="">Root Folder</option>';

        const modalEl = document.getElementById('moveFileModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        const fd = new FormData(); fd.append('action', 'get_projects_list');
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if(res.status === 'success') {
                    projSelect.innerHTML = '<option value="">Select Target Project...</option>';
                    res.data.forEach(p => { projSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`; });
                } else { projSelect.innerHTML = '<option value="">Error loading</option>'; }
            })
            .catch(err => { projSelect.innerHTML = '<option value="">Connection Error</option>'; });
    }

    function loadFoldersForMove(projId) {
        const folderSel = document.getElementById('move_folder_select');
        folderSel.innerHTML = '<option value="">Loading...</option>';
        if(!projId) { folderSel.innerHTML = '<option value="">Root Folder</option>'; return; }

        const fd = new FormData(); fd.append('action', 'get_folders_list'); fd.append('project_id', projId);
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                folderSel.innerHTML = '<option value="">Root Folder (No specific folder)</option>';
                if(res.status === 'success') { res.data.forEach(f => { folderSel.innerHTML += `<option value="${f.id}">${f.name}</option>`; }); }
            });
    }

    const moveForm = document.getElementById('moveFileForm');
    if(moveForm) {
        moveForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const btn = this.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Moving...'; btn.disabled = true;

            const fd = new FormData(this);
            fetch('../api/api.php', { method: 'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if(d.status === 'success') location.reload();
                    else { alert("Error moving item: " + d.msg); btn.innerHTML = originalText; btn.disabled = false; }
                })
                .catch(e => { alert("Connection error"); btn.innerHTML = originalText; btn.disabled = false; });
        });
    }

    // ==========================================
    // 3. SELECCION Y BULK ACTIONS
    // ==========================================
    let selectedIds = new Set();
    function toggleSelect(id) { 
        const c = document.getElementById(`card-${id}`); 
        if(selectedIds.has(id)) { selectedIds.delete(id); c.classList.remove('selected'); } 
        else { selectedIds.add(id); c.classList.add('selected'); } 
        updateBulkUI(); 
    }
    
    function selectAll() { 
        const all = allFiles.length > 0 && allFiles.every(id => selectedIds.has(id)); 
        if(all) clearSelection(); 
        else { allFiles.forEach(id => { selectedIds.add(id); document.getElementById(`card-${id}`)?.classList.add('selected'); }); updateBulkUI(); } 
    }
    
    function updateBulkUI() { 
        const b = document.getElementById('bulk-bar'); 
        if(b) { if(selectedIds.size>0) { b.classList.add('visible'); document.getElementById('bulk-count').innerText=selectedIds.size; } else b.classList.remove('visible'); } 
    }
    
    function clearSelection() { 
        selectedIds.forEach(id => document.getElementById(`card-${id}`)?.classList.remove('selected')); 
        selectedIds.clear(); updateBulkUI(); 
    }
    
    function deleteBulk() {
        if(!confirm(`Move ${selectedIds.size} files to Recycle Bin?`)) return;
        const ids = Array.from(selectedIds); 
        const fd = new FormData(); fd.append('action', 'delete_bulk'); fd.append('ids', JSON.stringify(ids));
        fetch('../api/api.php', { method: 'POST', body: fd }).then(r=>r.json()).then(d => { if(d.status === 'success') location.reload(); });
    }

    function deleteFile(id) {
        if(confirm("Move to Recycle Bin?")) {
            const fd = new FormData(); fd.append('action', 'delete_entity'); fd.append('type', 'file'); fd.append('id', id);
            fetch('../api/api.php', { method:'POST', body:fd }).then(r=>r.json()).then(d=>{ if(d.status==='success') location.reload(); });
        }
    }

    // --- PAPELERA ---
    let selectedTrash = new Set();
    function toggleTrashSelect(type, id) {
        const compositeId = `${type}_${id}`; const cardId = `t-card-${type}-${id}`; const cardEl = document.getElementById(cardId);
        if (selectedTrash.has(compositeId)) { selectedTrash.delete(compositeId); if(cardEl) cardEl.classList.remove('selected'); } 
        else { selectedTrash.add(compositeId); if(cardEl) cardEl.classList.add('selected'); }
        updateTrashBulkUI();
    }
    
    function updateTrashBulkUI() { const bar = document.getElementById('trash-bulk-bar'); const count = document.getElementById('trash-bulk-count'); if (bar && count) { if (selectedTrash.size > 0) { bar.classList.add('visible'); count.innerText = selectedTrash.size; } else { bar.classList.remove('visible'); } } }
    
    function clearTrashSelection() { selectedTrash.forEach(comp => { const [type, id] = comp.split('_'); const el = document.getElementById(`t-card-${type}-${id}`); if(el) el.classList.remove('selected'); }); selectedTrash.clear(); updateTrashBulkUI(); }
    
    // NUEVA FUNCION: SELECT ALL EN PAPELERA
    function selectAllTrash() {
        const totalItems = trashProjects.length + trashFiles.length + trashReports.length;
        if (totalItems === 0) return;

        // Si ya está todo seleccionado, deseleccionar
        if (selectedTrash.size === totalItems) {
            clearTrashSelection();
            return;
        }

        // Seleccionar todo
        trashProjects.forEach(id => {
            const comp = `project_${id}`;
            selectedTrash.add(comp);
            document.getElementById(`t-card-project-${id}`)?.classList.add('selected');
        });
        trashFiles.forEach(id => {
            const comp = `file_${id}`;
            selectedTrash.add(comp);
            document.getElementById(`t-card-file-${id}`)?.classList.add('selected');
        });
        trashReports.forEach(id => {
            const comp = `report_${id}`;
            selectedTrash.add(comp);
            document.getElementById(`t-card-report-${id}`)?.classList.add('selected');
        });

        updateTrashBulkUI();
    }
    
    async function restoreSelected() { 
        if (!confirm(`Restore ${selectedTrash.size} items?`)) return; 
        const promises = Array.from(selectedTrash).map(comp => { const [type, id] = comp.split('_'); const fd = new FormData(); fd.append('action', 'restore_entity'); fd.append('type', type); fd.append('id', id); return fetch('../api/api.php', { method: 'POST', body: fd }); }); 
        try { await Promise.all(promises); location.reload(); } catch (e) { alert("Error processing request"); } 
    }
    
    async function hardDeleteSelected() { 
        if (!confirm(`WARNING: This will permanently delete ${selectedTrash.size} items.`)) return; 
        const promises = Array.from(selectedTrash).map(comp => { const [type, id] = comp.split('_'); const fd = new FormData(); fd.append('action', 'hard_delete_entity'); fd.append('type', type); fd.append('id', id); return fetch('../api/api.php', { method: 'POST', body: fd }); }); 
        try { await Promise.all(promises); location.reload(); } catch (e) { alert("Error processing request"); } 
    }

    // --- ASIGNAR USUARIOS A PROYECTO ---
    function openAssignUsersModal() {
        const modalEl = document.getElementById('assignUsersModal');
        if (!modalEl) return;
        new bootstrap.Modal(modalEl).show();
    }
    const assignUsersForm = document.getElementById('assignUsersForm');
    if (assignUsersForm) {
        assignUsersForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const checked = Array.from(this.querySelectorAll('input[name="user_ids[]"]:checked'));
            const hasAdmin = checked.some(i => i.dataset.role === 'admin');
            if (checked.length === 0 || !hasAdmin) {
                alert('At least one admin must be assigned to the project.');
                return;
            }
            const fd = new FormData(this);
            fetch('../api/api.php', { method:'POST', body:fd })
                .then(r => r.json())
                .then(d => {
                    if (d.status === 'success') location.reload();
                    else alert('Error assigning users: ' + (d.msg || 'Unknown'));
                })
                .catch(() => alert('Connection error'));
        });
    }
</script>

<?php include __DIR__ . '/../views/footer.php'; ?>
