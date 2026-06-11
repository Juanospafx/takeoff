<?php
// pages/project_dashboard.php
// CORRECCIÓN: Agregado "/.." en las rutas para salir de 'pages' y encontrar 'core'
require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/db/connection.php';

$projectId = $_GET['id'] ?? 0;

// 1. Obtener Datos del Proyecto
$stmt = $pdo->prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL");
$stmt->execute([$projectId]);
$project = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$project) {
    header("Location: index.php");
    exit;
}

$projectDesc = $project['description'] ?? '';
if ($projectDesc === '' && !empty($project['notes'])) $projectDesc = $project['notes'];
$projectNotes = $project['notes'] ?? '';
if ($projectNotes === '' && !empty($project['description'])) $projectNotes = $project['description'];
$projectAddress = $project['address'] ?? ($project['job_address'] ?? '');
$projectContactName = $project['contact_name'] ?? ($project['site_contact_name'] ?? '');
$projectContactPhone = $project['contact_phone'] ?? ($project['site_contact_phone'] ?? '');
$projectCompanyName = $project['company_name'] ?? ($project['gc_company'] ?? '');
$projectCompanyPhone = $project['company_phone'] ?? ($project['office_phone'] ?? '');
$projectCompanyAddress = $project['company_address'] ?? ($project['hq_address'] ?? '');

$assignUsers = [];
$assignedUserIds = [];
if (($_SESSION['role'] ?? '') === 'admin') {
    $assignUsers = $pdo->query("SELECT id, username, role FROM users ORDER BY username ASC")->fetchAll(PDO::FETCH_ASSOC);
    $stmtAssigned = $pdo->prepare("SELECT user_id FROM directory WHERE project_id = ?");
    $stmtAssigned->execute([$projectId]);
    $assignedUserIds = array_map('intval', $stmtAssigned->fetchAll(PDO::FETCH_COLUMN));
}

$pageTitle = $project['name'];
$currentView = 'files'; // Forzamos la vista de archivos únicamente
$currentFolderId = $_GET['folder_id'] ?? null;

// 2. Consulta de Carpetas (Para el menú lateral y la vista de archivos)
$foldersStmt = $pdo->prepare("SELECT * FROM folders WHERE project_id = ? AND deleted_at IS NULL ORDER BY name ASC");
$foldersStmt->execute([$projectId]);
$allFolders = $foldersStmt->fetchAll(PDO::FETCH_ASSOC);

// 3. Consulta de Estadísticas Rápidas (Para el Summary)
$fileCount = $pdo->query("SELECT COUNT(*) FROM files WHERE project_id = $projectId AND deleted_at IS NULL")->fetchColumn();
$lastActivity = $pdo->query("SELECT uploaded_at FROM files WHERE project_id = $projectId ORDER BY uploaded_at DESC LIMIT 1")->fetchColumn();
$recentFiles = $pdo->prepare("SELECT id, filename, uploaded_at FROM files WHERE project_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC LIMIT 6");
$recentFiles->execute([$projectId]);
$recentFiles = $recentFiles->fetchAll(PDO::FETCH_ASSOC);

// CORRECCIÓN: Agregado "/.." para encontrar las vistas
include __DIR__ . '/../views/header.php'; 
?>

<div class="main-content d-flex flex-column h-100">
    
    <div class="bg-header border-bottom border-secondary p-4 d-flex justify-content-between align-items-center">
        <div>
            <div class="d-flex align-items-center gap-3 mb-1">
                <a href="index.php" class="text-muted"><i class="fas fa-arrow-left"></i></a>
                <h2 class="fw-bold mb-0 text-white"><?= htmlspecialchars($project['name']) ?></h2>
                <span class="badge bg-success rounded-pill px-3"><?= $project['status'] ?></span>
            </div>
            <div class="d-flex gap-4 text-gray small mt-2">
                <span><i class="fas fa-map-marker-alt me-1 text-accent"></i> <?= htmlspecialchars($project['address'] ?: 'No address') ?></span>
                <span><i class="fas fa-building me-1 text-warning"></i> <?= htmlspecialchars($project['company_name'] ?: 'No Company') ?></span>
                <span><i class="fas fa-calendar me-1"></i> Start: <?= $project['date_started'] ? date('M d, Y', strtotime($project['date_started'])) : 'TBD' ?></span>
            </div>
        </div>
        
        <div class="d-flex gap-2">
            <button id="toggleProjectSidebarBtn" class="btn btn-outline-light btn-sm rounded-pill" type="button" onclick="toggleProjectSidebar()">
                <i class="fas fa-folder-tree me-2"></i><span id="toggleProjectSidebarText">Folders</span>
            </button>
            <button class="btn btn-primary rounded-pill btn-sm px-4" onclick="openUploadModal()"><i class="fas fa-cloud-upload-alt me-2"></i> Upload PDF</button>
        </div>
    </div>

    <div id="projectLayout" class="flex-grow-1 d-flex overflow-hidden project-layout">
        
        <aside id="projectSidebar" class="project-sidebar bg-panel border-end border-secondary" style="width: 320px; overflow-y: auto;">
            <div class="p-3">
                <p class="text-muted small fw-bold text-uppercase ls-1 mb-3 ps-2">Blueprints Folders</p>
                
                <nav class="nav flex-column gap-1 nav-pills custom-pills">
                    
                    <?php foreach($allFolders as $folder): ?>
                        <div class="d-flex align-items-start justify-content-between folder-row gap-2">
                            <a href="?id=<?= $projectId ?>&view=files&folder_id=<?= $folder['id'] ?>" class="nav-link folder-link <?= ($currentView=='files' && $currentFolderId==$folder['id'])?'active':'' ?>" title="<?= htmlspecialchars($folder['name']) ?>">
                                <i class="fas fa-folder me-2 text-warning opacity-75"></i><span class="folder-link-text"><?= htmlspecialchars($folder['name']) ?></span>
                            </a>
                            <?php if(($_SESSION['role'] ?? '') === 'admin' && $folder['name'] !== 'Reports'): ?>
                                <div class="d-flex gap-1 folder-actions">
                                    <button class="btn btn-sm btn-outline-warning border-0" onclick="openMoveFolderModal(<?= (int)$folder['id'] ?>)" title="Move Folder"><i class="fas fa-exchange-alt"></i></button>
                                    <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteFolder(<?= (int)$folder['id'] ?>)" title="Delete Folder"><i class="fas fa-trash"></i></button>
                                </div>
                            <?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                </nav>
            </div>
        </aside>

        <main class="project-content flex-grow-1 p-4 overflow-auto">
            
            <?php if($currentView === 'summary'): ?>
                <h4 class="fw-bold mb-4">Project Summary</h4>
                <div class="row g-4">
                    <div class="col-md-3">
                        <div class="box-card p-4 text-center">
                            <h1 class="fw-bold text-primary mb-0"><?= $fileCount ?></h1>
                            <p class="text-gray">Total Files</p>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="box-card p-4 text-center">
                            <h1 class="fw-bold text-success mb-0"><?= count($allFolders) ?></h1>
                            <p class="text-gray">Active Folders</p>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="box-card p-4">
                            <h6 class="text-white mb-2">Last Activity</h6>
                            <p class="text-gray mb-0"><?= $lastActivity ? date('F d, Y h:i A', strtotime($lastActivity)) : 'No activity yet' ?></p>
                        </div>
                    </div>
                </div>

                <div class="mt-5">
                    <h5 class="fw-bold mb-3">Recent Uploads</h5>
                    <?php if(empty($recentFiles)): ?>
                        <div class="text-gray">No files uploaded yet.</div>
                    <?php else: ?>
                        <div class="row g-3">
                            <?php foreach($recentFiles as $rf): ?>
                                <div class="col-md-4 col-xl-3">
                                    <div class="box-card p-3 d-flex align-items-center justify-content-between recent-upload-card">
                                        <div class="me-3 recent-upload-info">
                                            <div class="fw-bold text-truncate"><?= htmlspecialchars($rf['filename']) ?></div>
                                            <div class="small text-gray"><?= date('M d, Y', strtotime($rf['uploaded_at'])) ?></div>
                                        </div>
                                        <div class="d-flex gap-2 recent-upload-actions">
                                            <a href="preview.php?id=<?= (int)$rf['id'] ?>" class="btn-icon" title="Preview"><i class="fas fa-eye"></i></a>
                                            <?php if(($_SESSION['role'] ?? '') !== 'viewer'): ?>
                                                <a href="editor.php?id=<?= (int)$rf['id'] ?>" class="btn-icon text-primary border-primary" title="Edit"><i class="fas fa-pen"></i></a>
                                            <?php endif; ?>
                                            <?php if(($_SESSION['role'] ?? '') === 'admin'): ?>
                                                <button class="btn-icon text-danger border-danger" title="Delete" onclick="deleteFile(<?= (int)$rf['id'] ?>)"><i class="fas fa-trash"></i></button>
                                            <?php endif; ?>
                                        </div>
                                    </div>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>

            <?php elseif($currentView === 'desc'): ?>
                <h4 class="fw-bold mb-4">Description of Work</h4>
                <div class="box-card p-4">
                    <p class="text-white mb-4"><?= nl2br(htmlspecialchars($project['notes'] ?: 'No detailed description available.')) ?></p>
                    
                    <hr class="border-secondary opacity-25 my-4">
                    
                    <h6 class="fw-bold text-accent mb-3">Contact Information</h6>
                    <div class="row">
                        <div class="col-md-6">
                            <p class="small text-gray mb-1">Site Contact</p>
                            <p class="text-white"><?= htmlspecialchars($project['contact_name']) ?> <br> <?= htmlspecialchars($project['contact_phone']) ?></p>
                        </div>
                        <div class="col-md-6">
                            <p class="small text-gray mb-1">Company Contact</p>
                            <p class="text-white"><?= htmlspecialchars($project['company_name']) ?> <br> <?= htmlspecialchars($project['company_phone']) ?></p>
                        </div>
                    </div>
                </div>

            <?php elseif($currentView === 'files'): 
                // Lógica para obtener archivos de la carpeta seleccionada
                $files = [];
                $folderName = "Select a Folder";
                if($currentFolderId) {
                    $fStmt = $pdo->prepare("SELECT * FROM files WHERE folder_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC");
                    $fStmt->execute([$currentFolderId]);
                    $files = $fStmt->fetchAll(PDO::FETCH_ASSOC);
                    
                    // Buscar nombre de la carpeta actual
                    $currFolder = array_filter($allFolders, fn($f) => $f['id'] == $currentFolderId);
                    $folderName = !empty($currFolder) ? reset($currFolder)['name'] : "Unknown Folder";
                }
            ?>
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h4 class="fw-bold mb-0"><i class="fas fa-folder-open text-warning me-2"></i> <?= htmlspecialchars($folderName) ?></h4>
                    <span class="badge bg-secondary"><?= count($files) ?> files</span>
                </div>

                <?php if(empty($files)): ?>
                    <div class="text-center py-5">
                        <i class="fas fa-cloud-upload-alt fa-3x text-gray mb-3 opacity-25"></i>
                        <p class="text-gray">This folder is empty.</p>
                        <button class="btn btn-outline-primary btn-sm rounded-pill" onclick="openUploadModal()">Upload Here</button>
                    </div>
                <?php else: ?>
                    <div class="row g-3">
                        <?php foreach($files as $f): 
                             $ft = strtolower(pathinfo($f['filename'], PATHINFO_EXTENSION));
                             $icon = ($ft === 'pdf') ? 'fa-file-pdf text-danger' : 'fa-file-image text-primary';
                        ?>
                        <div class="col-md-3 col-xl-2">
                            <div class="box-card p-3 text-center h-100 file-hover">
                                <i class="fas <?= $icon ?> fa-3x mb-3"></i>
                                <h6 class="text-truncate small mb-1"><?= htmlspecialchars($f['filename']) ?></h6>
                                <small class="text-gray d-block mb-2"><?= date('M d', strtotime($f['uploaded_at'])) ?></small>
                                <div class="d-flex justify-content-center gap-2 file-actions-row">
                                    <a href="preview.php?id=<?= $f['id'] ?>" class="btn btn-sm btn-dark rounded-circle"><i class="fas fa-eye"></i></a>
                                    <a href="editor.php?id=<?= $f['id'] ?>" class="btn btn-sm btn-dark rounded-circle text-primary"><i class="fas fa-pen"></i></a>
                                    <?php if(($_SESSION['role'] ?? '') === 'admin'): ?>
                                        <button class="btn btn-sm btn-dark rounded-circle text-warning" onclick="openMoveModal(<?= (int)$f['id'] ?>)" title="Move"><i class="fas fa-exchange-alt"></i></button>
                                        <button class="btn btn-sm btn-dark rounded-circle text-danger" onclick="deleteFile(<?= (int)$f['id'] ?>)" title="Delete"><i class="fas fa-trash"></i></button>
                                    <?php endif; ?>
                                </div>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>

            <?php else: ?>
                <div class="text-center py-5">
                    <p class="text-gray">Module under development.</p>
                </div>
            <?php endif; ?>

        </main>
    </div>
</div>

<style>
    .project-sidebar .nav-link {
        color: var(--text-muted);
        border-radius: 8px;
        padding: 10px 15px;
        transition: 0.2s;
        font-size: 0.95rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .project-sidebar .nav-link:hover {
        background: rgba(255,255,255,0.05);
        color: white;
    }
    .project-sidebar .nav-link.active {
        background: var(--primary);
        color: white;
        font-weight: 500;
        box-shadow: 0 4px 10px rgba(99, 102, 241, 0.3);
    }
    .project-layout { min-width: 0; }
    .project-sidebar { flex: 0 0 320px; min-width: 320px; transition: all .25s ease; }
    .project-content { min-width: 0; }
    .project-layout.sidebar-collapsed .project-sidebar { display: none; }

    .project-sidebar .p-3 { min-width: 0; }
    .folder-row { min-width: 0; align-items: center !important; }
    .folder-link {
        min-width: 0;
        max-width: calc(100% - 64px);
        flex: 1 1 auto;
        white-space: nowrap;
        line-height: 1.35;
        display: flex;
        align-items: center;
        overflow: hidden;
    }
    .folder-link-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
        max-width: 100%;
    }
    .folder-actions { flex: 0 0 56px; width: 56px; padding-top: 0; justify-content: flex-end; }
    .file-hover {
        position: relative;
        overflow: hidden;
        min-height: 214px;
        padding-bottom: 54px !important;
    }
    .file-actions-row {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 10px;
        min-height: 34px;
        align-items: center;
        justify-content: center;
        flex-wrap: nowrap;
        z-index: 2;
    }
    .file-actions-row .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
        line-height: 1;
    }
    .file-hover:hover {
        background: rgba(255,255,255,0.05);
        transform: translateY(-2px);
    }

    @media (max-width: 992px) {
        .bg-header { flex-direction: column; align-items: flex-start; gap: 12px; }
        .bg-header .d-flex.gap-2 { width: 100%; flex-wrap: wrap; }
        .project-sidebar {
            width: 100% !important;
            min-width: 100%;
            border-right: 0;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .project-content { padding: 20px !important; }
        .project-layout { flex-direction: column; }
    }

    .recent-upload-card { gap: 12px; }
    .recent-upload-info { min-width: 0; }
    .recent-upload-actions { flex-shrink: 0; }
    @media (max-width: 768px) {
        .recent-upload-card { flex-wrap: wrap; }
        .recent-upload-actions { width: 100%; justify-content: flex-end; }
    }
</style>

<?php include __DIR__ . '/../views/modals.php'; ?>

<div class="modal fade" id="uploadFileModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Upload File</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form id="uploadFileForm">
                <div class="modal-body">
                    <label class="text-gray small mb-2">Select File</label>
                    <input type="file" name="file" id="upload_file_input" class="form-control mb-3" required>

                    <label class="text-gray small mb-2">Select Folder</label>
                    <select name="folder_id" id="upload_folder_select" class="form-select text-white bg-dark border-secondary" required>
                        <option value="">Select a folder...</option>
                        <?php foreach($allFolders as $folder): ?>
                            <option value="<?= (int)$folder['id'] ?>"><?= htmlspecialchars($folder['name']) ?></option>
                        <?php endforeach; ?>
                    </select>
                    <?php if(empty($allFolders)): ?>
                        <div class="text-muted small mt-2">No folders available. Create a folder first.</div>
                    <?php endif; ?>
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn-main w-100">Upload</button>
                </div>
            </form>
        </div>
    </div>
</div>

<div id="uploadProgressWrap" class="position-fixed bottom-0 end-0 m-3" style="z-index: 2000; width: 280px; display:none;">
    <div class="box-card p-3">
        <div class="small text-gray mb-2">Uploading file...</div>
        <div class="progress" style="height:8px;">
            <div id="uploadProgressBar" class="progress-bar" role="progressbar" style="width:0%"></div>
        </div>
        <div class="small text-gray mt-2" id="uploadProgressText">0%</div>
    </div>
</div>

<?php if(($_SESSION['role'] ?? '') === 'admin'): ?>
<div class="modal fade" id="moveFolderModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Move Folder</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form id="moveFolderForm">
                <input type="hidden" name="action" value="move_folder">
                <input type="hidden" name="folder_id" id="move_folder_id" value="">
                <div class="modal-body">
                    <label class="text-gray small mb-2">Target Project</label>
                    <select name="target_project_id" id="move_folder_project_select" class="form-select text-white bg-dark border-secondary" onchange="loadFoldersForFolderMove(this.value)" required>
                        <option value="">Loading projects...</option>
                    </select>

                    <label class="text-gray small mb-2 mt-3">Move Into Folder (Optional)</label>
                    <select name="target_parent_folder_id" id="move_folder_parent_select" class="form-select text-white bg-dark border-secondary">
                        <option value="">Keep as top-level</option>
                    </select>
                    <div class="text-muted small mt-2">Select a parent folder to create a subfolder with the current name.</div>
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn-main w-100">Move Folder</button>
                </div>
            </form>
        </div>
    </div>
</div>

<div class="modal fade" id="newFolderModalDash" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Add Folder</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form id="newFolderFormDash">
                <div class="modal-body">
                    <div id="newFolderError" class="alert alert-danger py-2 px-3 mb-3 d-none" role="alert"></div>
                    <label class="text-gray small mb-2">Folder Name</label>
                    <input type="text" name="name" class="form-control" required maxlength="255">
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn-main w-100">Create</button>
                </div>
            </form>
        </div>
    </div>
</div>

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

<input type="file" id="projectUploadInput" class="d-none">

<script>
    const pId = <?= $projectId ?>;
    const fId = <?= $currentFolderId ?? 'null' ?>;

    function applyProjectSidebarState(collapsed) {
        const layout = document.getElementById('projectLayout');
        const text = document.getElementById('toggleProjectSidebarText');
        if (!layout) return;
        layout.classList.toggle('sidebar-collapsed', collapsed);
        if (text) text.textContent = collapsed ? 'Show Menu' : 'Hide Menu';
    }

    function toggleProjectSidebar() {
        const layout = document.getElementById('projectLayout');
        if (!layout) return;
        const collapsed = !layout.classList.contains('sidebar-collapsed');
        applyProjectSidebarState(collapsed);
        try { localStorage.setItem('projectSidebarCollapsed', collapsed ? '1' : '0'); } catch (e) {}
    }

    document.addEventListener('DOMContentLoaded', function() {
        let collapsed = false;
        try { collapsed = localStorage.getItem('projectSidebarCollapsed') === '1'; } catch (e) {}
        applyProjectSidebarState(collapsed);
    });

    function openUploadModal() {
        if (fId) {
            const input = document.getElementById('projectUploadInput');
            if (input) input.click();
            return;
        }
        const modalEl = document.getElementById('uploadFileModal');
        if (modalEl) new bootstrap.Modal(modalEl).show();
    }

    const projectUploadInput = document.getElementById('projectUploadInput');
    if (projectUploadInput) {
        projectUploadInput.addEventListener('change', function() {
            if (!this.files || this.files.length === 0) return;
            if (!fId) return;
            const fd = new FormData();
            fd.append('action', 'upload_file');
            fd.append('project_id', pId);
            if (fId) fd.append('folder_id', fId);
            fd.append('file', this.files[0]);
            fetch('../api/api.php', { method:'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if (d.status === 'success') location.reload();
                    else alert('Error uploading file: ' + (d.msg || 'Unknown'));
                })
                .catch(() => alert('Connection error'));
        });
    }

    function showUploadProgress() {
        const wrap = document.getElementById('uploadProgressWrap');
        const bar = document.getElementById('uploadProgressBar');
        const txt = document.getElementById('uploadProgressText');
        if (!wrap || !bar || !txt) return;
        wrap.style.display = 'block';
        bar.style.width = '0%';
        txt.textContent = '0%';
    }

    function updateUploadProgress(pct) {
        const bar = document.getElementById('uploadProgressBar');
        const txt = document.getElementById('uploadProgressText');
        if (!bar || !txt) return;
        const clamped = Math.max(0, Math.min(100, Math.round(pct)));
        bar.style.width = clamped + '%';
        txt.textContent = clamped + '%';
    }

    function hideUploadProgress(delay = 1200) {
        const wrap = document.getElementById('uploadProgressWrap');
        if (!wrap) return;
        setTimeout(() => { wrap.style.display = 'none'; }, delay);
    }

    function uploadWithProgress(fd) {
        showUploadProgress();
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '../api/api.php', true);
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    updateUploadProgress((e.loaded / e.total) * 100);
                }
            });
            xhr.addEventListener('load', () => {
                updateUploadProgress(100);
                try {
                    const res = JSON.parse(xhr.responseText);
                    resolve(res);
                } catch (err) {
                    reject(err);
                }
            });
            xhr.addEventListener('error', () => reject(new Error('Upload failed')));
            xhr.send(fd);
        });
    }

    const uploadFileForm = document.getElementById('uploadFileForm');
    if (uploadFileForm) {
        uploadFileForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const fileInput = document.getElementById('upload_file_input');
            const folderSelect = document.getElementById('upload_folder_select');
            if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
                alert('Please select a file.');
                return;
            }
            if (!folderSelect || !folderSelect.value) {
                alert('Please select a folder.');
                return;
            }
            const fd = new FormData();
            fd.append('action', 'upload_file');
            fd.append('project_id', pId);
            fd.append('folder_id', folderSelect.value);
            fd.append('file', fileInput.files[0]);
            const modalEl = document.getElementById('uploadFileModal');
            if (modalEl) {
                const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
                inst.hide();
            }
            uploadWithProgress(fd)
                .then(d => {
                    if (d.status === 'success') {
                        hideUploadProgress(800);
                        location.reload();
                    } else {
                        hideUploadProgress(1500);
                        alert('Error uploading file: ' + (d.msg || 'Unknown'));
                    }
                })
                .catch(() => {
                    hideUploadProgress(1500);
                    alert('Upload failed. The file may still finish uploading in the background.');
                });
        });
    }


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

    function deleteFile(id) {
        if(!confirm("Move file to Recycle Bin?")) return;
        const fd = new FormData();
        fd.append('action', 'delete_entity');
        fd.append('type', 'file');
        fd.append('id', id);
        fetch('../api/api.php', { method:'POST', body: fd })
            .then(r => r.json())
            .then(d => {
                if(d.status === 'success') location.reload();
                else alert('Error deleting file: ' + (d.msg || 'Unknown'));
            })
            .catch(() => alert('Connection error'));
    }

    function deleteFolder(id) {
        if(!confirm("Move folder to Recycle Bin?")) return;
        const fd = new FormData();
        fd.append('action', 'delete_entity');
        fd.append('type', 'folder');
        fd.append('id', id);
        fetch('../api/api.php', { method:'POST', body: fd })
            .then(r => r.json())
            .then(d => {
                if(d.status === 'success') location.reload();
                else alert('Error deleting folder: ' + (d.msg || 'Unknown'));
            })
            .catch(() => alert('Connection error'));
    }

    function openMoveModal(fileId) {
        const moveId = document.getElementById('move_id');
        const moveType = document.getElementById('move_type');
        const projSelect = document.getElementById('move_project_select');
        const folderSelect = document.getElementById('move_folder_select');
        if (!moveId || !moveType || !projSelect || !folderSelect) return;

        moveId.value = fileId;
        moveType.value = 'file';
        projSelect.innerHTML = '<option value="">Loading projects...</option>';
        folderSelect.innerHTML = '<option value="">Root Folder</option>';

        const modalEl = document.getElementById('moveFileModal');
        if (modalEl) new bootstrap.Modal(modalEl).show();

        const fd = new FormData();
        fd.append('action', 'get_projects_list');
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if(res.status === 'success') {
                    projSelect.innerHTML = '<option value="">Select Target Project...</option>';
                    res.data.forEach(p => { projSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`; });
                } else {
                    projSelect.innerHTML = '<option value="">Error loading</option>';
                }
            })
            .catch(() => { projSelect.innerHTML = '<option value="">Connection Error</option>'; });
    }

    function loadFoldersForMove(projId) {
        const folderSel = document.getElementById('move_folder_select');
        if (!folderSel) return;
        folderSel.innerHTML = '<option value="">Loading...</option>';
        if(!projId) { folderSel.innerHTML = '<option value="">Root Folder</option>'; return; }

        const fd = new FormData();
        fd.append('action', 'get_folders_list');
        fd.append('project_id', projId);
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                folderSel.innerHTML = '<option value="">Root Folder (No specific folder)</option>';
                if(res.status === 'success') {
                    res.data.forEach(f => { folderSel.innerHTML += `<option value="${f.id}">${f.name}</option>`; });
                }
            })
            .catch(() => { folderSel.innerHTML = '<option value="">Connection Error</option>'; });
    }

    const moveForm = document.getElementById('moveFileForm');
    if (moveForm) {
        moveForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const fd = new FormData(this);
            fetch('../api/api.php', { method: 'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if(d.status === 'success') location.reload();
                    else alert('Error moving file: ' + (d.msg || 'Unknown'));
                })
                .catch(() => alert('Connection error'));
        });
    }

    function openMoveFolderModal(folderId) {
        const moveFolderId = document.getElementById('move_folder_id');
        const projSelect = document.getElementById('move_folder_project_select');
        const parentSelect = document.getElementById('move_folder_parent_select');
        if (!moveFolderId || !projSelect || !parentSelect) return;

        moveFolderId.value = folderId;
        projSelect.innerHTML = '<option value="">Loading projects...</option>';
        parentSelect.innerHTML = '<option value="">Keep as top-level</option>';

        const modalEl = document.getElementById('moveFolderModal');
        if (modalEl) new bootstrap.Modal(modalEl).show();

        const fd = new FormData();
        fd.append('action', 'get_projects_list');
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if(res.status === 'success') {
                    projSelect.innerHTML = '<option value="">Select Target Project...</option>';
                    res.data.forEach(p => { projSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`; });
                } else {
                    projSelect.innerHTML = '<option value="">Error loading</option>';
                }
            })
            .catch(() => { projSelect.innerHTML = '<option value="">Connection Error</option>'; });
    }

    function loadFoldersForFolderMove(projId) {
        const parentSel = document.getElementById('move_folder_parent_select');
        if (!parentSel) return;
        parentSel.innerHTML = '<option value="">Loading...</option>';
        if(!projId) { parentSel.innerHTML = '<option value="">Keep as top-level</option>'; return; }

        const currentFolderId = parseInt(document.getElementById('move_folder_id').value || '0', 10);
        const fd = new FormData();
        fd.append('action', 'get_folders_list');
        fd.append('project_id', projId);
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                parentSel.innerHTML = '<option value="">Keep as top-level</option>';
                if(res.status === 'success') {
                    res.data.forEach(f => {
                        if (parseInt(f.id, 10) === currentFolderId) return;
                        parentSel.innerHTML += `<option value="${f.id}">${f.name}</option>`;
                    });
                }
            })
            .catch(() => { parentSel.innerHTML = '<option value="">Connection Error</option>'; });
    }

    const moveFolderForm = document.getElementById('moveFolderForm');
    if (moveFolderForm) {
        moveFolderForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const fd = new FormData(this);
            fetch('../api/api.php', { method: 'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if(d.status === 'success') location.reload();
                    else alert('Error moving folder: ' + (d.msg || 'Unknown'));
                })
                .catch(() => alert('Connection error'));
        });
    }

    function openNewFolderModal() {
        const modalEl = document.getElementById('newFolderModalDash');
        if (!modalEl) return;
        if (typeof clearNewFolderError === 'function') clearNewFolderError();
        new bootstrap.Modal(modalEl).show();
    }
    const newFolderFormDash = document.getElementById('newFolderFormDash');
    const newFolderError = document.getElementById('newFolderError');
    const showNewFolderError = (msg) => {
        if (!newFolderError) return;
        newFolderError.textContent = msg;
        newFolderError.classList.remove('d-none');
    };
    const clearNewFolderError = () => {
        if (!newFolderError) return;
        newFolderError.textContent = '';
        newFolderError.classList.add('d-none');
    };

    if (newFolderFormDash) {
        newFolderFormDash.addEventListener('submit', function(e) {
            e.preventDefault();
            clearNewFolderError();
            const fd = new FormData(this);
            fd.append('action', 'create_folder');
            fd.append('project_id', pId);
            fetch('../api/api.php', { method:'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if (d.status === 'success') {
                        location.reload();
                    } else {
                        showNewFolderError('Error creating folder: ' + (d.msg || 'Unknown'));
                    }
                })
                .catch(() => showNewFolderError('Connection error while creating folder.'));
        });
    }
</script>

<?php include __DIR__ . '/../views/footer.php'; ?>
