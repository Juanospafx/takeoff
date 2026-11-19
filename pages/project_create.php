<?php
// pages/project_create.php
require_once __DIR__ . '/../core/auth/session.php';
$authRedirect = takeoff_require_page_auth($_SESSION ?? null);
if ($authRedirect !== null) return;
require_once __DIR__ . '/../core/db/connection.php';

// Solo administradores
if (!SessionGuard::isAdmin($_SESSION ?? null)) {
    http_response_code(403);
    echo 'Forbidden';
    exit;
}

$editId = (int)($_GET['id'] ?? 0);
$isEdit = $editId > 0;

$project = [];
if ($isEdit) {
    $stmtProj = $pdo->prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL");
    $stmtProj->execute([$editId]);
    $project = $stmtProj->fetch(PDO::FETCH_ASSOC) ?: [];
    if (empty($project)) { header("Location: index.php"); exit; }
}

$createUsers = [];
$stmtUsers = $pdo->query("SELECT id, username, role FROM users ORDER BY username ASC");
$createUsers = $stmtUsers->fetchAll(PDO::FETCH_ASSOC);

$existingFolders = [];
if ($isEdit) {
    $stmtFolders = $pdo->prepare("SELECT name FROM folders WHERE project_id = ? AND deleted_at IS NULL");
    $stmtFolders->execute([$editId]);
    $existingFolders = array_map('strtolower', $stmtFolders->fetchAll(PDO::FETCH_COLUMN));
}

$folderMap = [
    'bom' => 'bom',
    'schedule_values' => 'schedule of values',
    'rfi' => 'rfi',
    'drawings' => 'drawings',
    'photos' => 'photos',
    'panel_schedule' => 'panel schedule',
    'panel_tags' => 'panel tags',
    'noc' => 'noc',
    'submittal' => 'submittal',
    'permit' => 'permit',
    'acknowledgement' => 'acknowledgement',
    'payapp' => 'payapp',
    'insurance' => 'certificate of insurance',
    'fault_calc' => 'fault current calc',
    'labor_record' => 'labor record',
    'expenses' => 'expenses',
    'warranty_sup' => 'warranty supplier',
    'clock_in' => 'clock in'
];

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

$pageTitle = $isEdit ? "Edit Project" : "Create New Project";
include __DIR__ . '/../views/header.php'; 
?>

<link rel="stylesheet" href="../assets/portal_project_create.css?v=<?= filemtime(__DIR__ . '/../assets/portal_project_create.css') ?>">

<div class="main-content p-3">
    
    <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="fw-bold text-white mb-0"><?= $isEdit ? 'Edit Project' : 'Create Project' ?></h5>
        <a href="<?= $isEdit ? 'project_dashboard.php?id=' . (int)$editId : 'index.php' ?>" class="text-gray text-decoration-none small hover-white"><i class="fas fa-times me-1"></i> Cancel</a>
    </div>

    <form id="createProjectForm">
        <input type="hidden" name="is_edit" value="<?= $isEdit ? '1' : '0' ?>">
        <?php if($isEdit): ?>
            <input type="hidden" name="project_id" value="<?= (int)$editId ?>">
        <?php endif; ?>
        <div class="row g-3">
            
            <div class="col-lg-8">
                
                <div class="box-card-compact">
                    <div class="section-header">
                        <i class="fas fa-info-circle section-icon"></i>
                        <span class="section-title">General Info</span>
                    </div>
                    <div class="row g-2">
                        <div class="col-md-8">
                            <label class="form-label">Project Name *</label>
                            <input type="text" name="project_name" class="form-control" required placeholder="Project Title" value="<?= htmlspecialchars($project['name'] ?? '') ?>">
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">Job Address</label>
                            <input type="text" name="address" class="form-control" placeholder="City, State" value="<?= htmlspecialchars($projectAddress) ?>">
                        </div>
                        <div class="col-12">
                            <label class="form-label">Description</label>
                            <textarea name="notes" class="form-control" rows="2" placeholder="Brief scope..."><?= htmlspecialchars($projectNotes) ?></textarea>
                        </div>
                    </div>
                </div>

                <div class="box-card-compact">
                    <div class="section-header">
                        <i class="fas fa-users section-icon text-info"></i>
                        <span class="section-title">Contacts</span>
                    </div>
                    <div class="row g-2">
                        <div class="col-md-6">
                            <label class="form-label text-white opacity-75">Site Contact Name</label>
                            <input type="text" name="contact_name" class="form-control" placeholder="Name" value="<?= htmlspecialchars($projectContactName) ?>">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label text-white opacity-75">Site Contact Phone</label>
                            <input type="text" name="contact_phone" class="form-control" placeholder="Phone" value="<?= htmlspecialchars($projectContactPhone) ?>">
                        </div>
                        
                        <div class="col-12"><div style="border-top:1px dashed rgba(255,255,255,0.05); margin: 5px 0;"></div></div>

                        <div class="col-md-4">
                            <label class="form-label text-warning opacity-75">Company (GC)</label>
                            <input type="text" name="company_name" class="form-control" placeholder="Company" value="<?= htmlspecialchars($projectCompanyName) ?>">
                        </div>
                        <div class="col-md-4">
                            <label class="form-label text-warning opacity-75">Office Phone</label>
                            <input type="text" name="company_phone" class="form-control" placeholder="Phone" value="<?= htmlspecialchars($projectCompanyPhone) ?>">
                        </div>
                        <div class="col-md-4">
                            <label class="form-label text-warning opacity-75">HQ Address</label>
                            <input type="text" name="company_address" class="form-control" placeholder="Address" value="<?= htmlspecialchars($projectCompanyAddress) ?>">
                        </div>
                    </div>
                </div>

                <?php if(!$isEdit): ?>
                <div class="box-card-compact">
                    <div class="section-header">
                        <i class="fas fa-user-plus section-icon text-success"></i>
                        <span class="section-title">Assign Users</span>
                    </div>
                    <label class="form-label">Select Users</label>
                    <div class="border rounded p-2" style="max-height:180px; overflow:auto;">
                        <?php foreach($createUsers as $u): ?>
                            <label class="check-item d-flex align-items-center gap-2 small text-gray mb-2">
                                <input class="form-check-input" type="checkbox" name="user_ids[]" value="<?= (int)$u['id'] ?>" data-role="<?= htmlspecialchars($u['role']) ?>">
                                <span><?= htmlspecialchars($u['username']) ?> (<?= htmlspecialchars($u['role']) ?>)</span>
                            </label>
                        <?php endforeach; ?>
                        <?php if(empty($createUsers)): ?>
                            <div class="text-gray small">No users available.</div>
                        <?php endif; ?>
                    </div>
                    <small class="text-muted d-block mt-2" style="font-size:0.7rem;">At least one admin must be assigned when selecting users.</small>
                </div>
                <?php endif; ?>

                <div class="box-card-compact mb-0"> <div class="section-header">
                        <i class="fas fa-calendar-alt section-icon text-warning"></i>
                        <span class="section-title">Timeline</span>
                    </div>
                    <div class="row g-2">
                        <div class="col-4 col-md-2">
                            <label class="form-label">Bid Sent</label>
                            <input type="date" name="date_bid_send" class="form-control" value="<?= htmlspecialchars($project['date_bid_sent'] ?? '') ?>">
                        </div>
                        <div class="col-4 col-md-2">
                            <label class="form-label">Awarded</label>
                            <input type="date" name="date_bid_awarded" class="form-control" value="<?= htmlspecialchars($project['date_bid_awarded'] ?? '') ?>">
                        </div>
                        <div class="col-4 col-md-2">
                            <label class="form-label">Start</label>
                            <input type="date" name="date_started" class="form-control" value="<?= htmlspecialchars($project['date_started'] ?? '') ?>">
                        </div>
                        <div class="col-6 col-md-3">
                            <label class="form-label">Target Finish</label>
                            <input type="date" name="date_finished" class="form-control" value="<?= htmlspecialchars($project['date_finished'] ?? '') ?>">
                        </div>
                        <div class="col-6 col-md-3">
                            <label class="form-label">Warranty End</label>
                            <input type="date" name="date_warranty_end" class="form-control" value="<?= htmlspecialchars($project['date_warranty_end'] ?? '') ?>">
                        </div>
                    </div>
                </div>

            </div>

            <div class="col-lg-4">
                <div class="box-card-compact h-100 d-flex flex-column">
                    <div class="section-header">
                        <i class="fas fa-folder-tree section-icon text-success"></i>
                        <span class="section-title"><?= $isEdit ? 'Folders' : 'Folders' ?></span>
                        <small class="ms-auto text-muted" style="font-size:0.65rem"><?= $isEdit ? 'Select to (re)create' : 'Uncheck unused' ?></small>
                    </div>

                    <div class="folder-list flex-grow-1">
                        <div class="d-flex flex-column gap-1">
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="bom" <?= $isEdit ? (in_array($folderMap['bom'], $existingFolders, true) ? 'checked' : '') : 'checked' ?>> <span class="small">BoM</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="schedule_values" <?= $isEdit ? (in_array($folderMap['schedule_values'], $existingFolders, true) ? 'checked' : '') : 'checked' ?>> <span class="small">Schedule of Values</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="rfi" <?= $isEdit ? (in_array($folderMap['rfi'], $existingFolders, true) ? 'checked' : '') : 'checked' ?>> <span class="small">RFI</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="drawings" <?= $isEdit ? (in_array($folderMap['drawings'], $existingFolders, true) ? 'checked' : '') : 'checked' ?>> <span class="small">Drawings</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="photos" <?= $isEdit ? (in_array($folderMap['photos'], $existingFolders, true) ? 'checked' : '') : 'checked' ?>> <span class="small">Photos</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="panel_schedule" <?= $isEdit ? (in_array($folderMap['panel_schedule'], $existingFolders, true) ? 'checked' : '') : 'checked' ?>> <span class="small">Panel Schedule</span>
                            </label>
                            <div class="my-1 border-top border-secondary opacity-25"></div>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="panel_tags" <?= $isEdit ? (in_array($folderMap['panel_tags'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Panel/Meter Tags</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="noc" <?= $isEdit ? (in_array($folderMap['noc'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">NOC</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="submittal" <?= $isEdit ? (in_array($folderMap['submittal'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Submittal</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="permit" <?= $isEdit ? (in_array($folderMap['permit'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Permit</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="acknowledgement" <?= $isEdit ? (in_array($folderMap['acknowledgement'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Acknowledgement</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="payapp" <?= $isEdit ? (in_array($folderMap['payapp'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Payapp</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="insurance" <?= $isEdit ? (in_array($folderMap['insurance'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Insurance</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="fault_calc" <?= $isEdit ? (in_array($folderMap['fault_calc'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Fault Calc</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="labor_record" <?= $isEdit ? (in_array($folderMap['labor_record'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Labor Record</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="expenses" <?= $isEdit ? (in_array($folderMap['expenses'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Expenses</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="warranty_sup" <?= $isEdit ? (in_array($folderMap['warranty_sup'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Warranty Sup</span>
                            </label>
                            <label class="check-item d-flex align-items-center gap-2">
                                <input class="form-check-input" type="checkbox" name="folders[]" value="clock_in" <?= $isEdit ? (in_array($folderMap['clock_in'], $existingFolders, true) ? 'checked' : '') : '' ?>> <span class="small">Clock in</span>
                            </label>
                        </div>
                    </div>

                    <div class="mt-3">
                        <?php if($isEdit): ?>
                            <div class="text-muted small">Folders are shown for reference. To add folders, use "Add Folder" in the project dashboard.</div>
                        <?php endif; ?>
                        <button type="submit" class="btn btn-create-submit w-100 py-2">
                            <i class="fas <?= $isEdit ? 'fa-save' : 'fa-rocket' ?> me-2"></i> <?= $isEdit ? 'Save Changes' : 'Create Project' ?>
                        </button>
                    </div>
                </div>
            </div>

        </div>
    </form>
</div>

<script>
document.getElementById('createProjectForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const btn = this.querySelector('button[type="submit"]');
    const original = btn.innerHTML;

    const checked = Array.from(this.querySelectorAll('input[name="user_ids[]"]:checked'));
    const hasAdmin = checked.some(i => i.dataset.role === 'admin');
    if (checked.length > 0 && !hasAdmin) {
        alert('At least one admin must be assigned to the project.');
        return;
    }
    
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Creating...';
    btn.disabled = true;

    const fd = new FormData(this);
    const isEdit = this.querySelector('input[name="is_edit"]')?.value === '1';
    if (isEdit) {
        const projectId = fd.get('project_id');
        fd.append('action', 'update_project_info');
        fetch('../api/api.php', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if(res.status !== 'success') {
                    alert('Error: ' + res.msg);
                    btn.innerHTML = original;
                    btn.disabled = false;
                    return;
                }
                const folders = Array.from(document.querySelectorAll('input[name="folders[]"]:checked')).map(i => i.value);
                if (folders.length === 0) {
                    window.location.href = 'project_dashboard.php?id=' + projectId;
                    return;
                }
                const fd2 = new FormData();
                fd2.append('action', 'add_project_folders');
                fd2.append('project_id', projectId);
                folders.forEach(f => fd2.append('folders[]', f));
                fetch('../api/api.php', { method: 'POST', body: fd2 })
                    .then(r => r.json())
                    .then(r2 => {
                        if(r2.status === 'success') window.location.href = 'project_dashboard.php?id=' + projectId;
                        else {
                            alert('Error: ' + (r2.msg || 'Unknown'));
                            btn.innerHTML = original;
                            btn.disabled = false;
                        }
                    })
                    .catch(() => {
                        alert('Connection Error');
                        btn.innerHTML = original;
                        btn.disabled = false;
                    });
            })
            .catch(() => {
                alert('Connection Error');
                btn.innerHTML = original;
                btn.disabled = false;
            });
        return;
    }

    fetch('../api/create_project.php', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(res => {
            if(res.status === 'success') {
                window.location.href = 'project_dashboard.php?id=' + res.id;
            } else {
                alert('Error: ' + res.msg);
                btn.innerHTML = original;
                btn.disabled = false;
            }
        })
        .catch(() => {
            alert('Connection Error');
            btn.innerHTML = original;
            btn.disabled = false;
        });
});
</script>

<?php include __DIR__ . '/../views/footer.php'; ?>
