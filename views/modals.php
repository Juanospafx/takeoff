<?php if(isset($canCreate) && $canCreate): ?>
<div class="modal fade" id="newProjectModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">New Project</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form method="POST" action="index.php"> <input type="hidden" name="action" value="create_project">
                <div class="modal-body">
                    <label class="text-gray small mb-2">Project Name</label>
                    <input type="text" name="name" class="form-control mb-3" required>
                    <label class="text-gray small mb-2">Description</label>
                    <textarea name="description" class="form-control" rows="3"></textarea>

                    <label class="text-gray small mb-2 mt-3">Assign Users</label>
                    <div class="border rounded p-2" style="max-height:180px; overflow:auto;">
                        <?php foreach(($createUsers ?? []) as $u): ?>
                            <label class="d-flex align-items-center gap-2 small text-gray mb-2">
                                <input type="checkbox" name="user_ids[]" value="<?= (int)$u['id'] ?>">
                                <span><?= htmlspecialchars($u['username']) ?> (<?= htmlspecialchars($u['role']) ?>)</span>
                            </label>
                        <?php endforeach; ?>
                        <?php if(empty($createUsers)): ?>
                            <div class="text-gray small">No users available.</div>
                        <?php endif; ?>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-main w-100">Create Project</button>
                </div>
            </form>
        </div>
    </div>
</div>

<div class="modal fade" id="newFolderModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">New Folder</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form method="POST" action="index.php">
                <input type="hidden" name="action" value="create_folder">
                <input type="hidden" name="project_id" value="<?= isset($projectId) ? $projectId : '' ?>">
                <div class="modal-body">
                    <label class="text-gray small mb-2">Folder Name</label>
                    <input type="text" name="new_folder_name" class="form-control" required>
                </div>
                <div class="modal-footer">
                    <button class="btn-main w-100">Create</button>
                </div>
            </form>
        </div>
    </div>
</div>
<?php endif; ?>

<div class="modal fade" id="moveFileModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-4" style="background: var(--bg-card); border: 1px solid rgba(255,255,255,0.1);">
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h5 class="fw-bold m-0 text-white">Move Item</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" style="filter: invert(1);"></button>
            </div>
            <form id="moveFileForm">
                <input type="hidden" name="action" value="move_entity">
                <input type="hidden" name="type" id="move_type" value="file">
                <input type="hidden" name="id" id="move_id" value="">
                
                <div class="mb-3">
                    <label class="small text-gray mb-2">Destination Project</label>
                    <select name="target_project_id" id="move_project_select" class="form-select text-white bg-dark border-secondary" onchange="loadFoldersForMove(this.value)" required>
                        <option value="">Loading projects...</option>
                    </select>
                </div>

                <div class="mb-3">
                    <label class="small text-gray mb-2">Destination Folder</label>
                    <select name="target_folder_id" id="move_folder_select" class="form-select text-white bg-dark border-secondary">
                        <option value="">Root Folder (No specific folder)</option>
                    </select>
                </div>

                <button type="submit" class="btn-main w-100">Move Item</button>
            </form>
        </div>
    </div>
</div>

<div id="drop-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(11,17,32,0.95); z-index:9999; justify-content:center; align-items:center; flex-direction:column; backdrop-filter:blur(5px);">
    <div style="pointer-events: none; border: 3px dashed #6366f1; padding: 60px; border-radius: 30px; text-align: center; background: rgba(99,102,241,0.1);">
        <i class="fas fa-cloud-upload-alt fa-5x text-primary mb-4"></i>
        <h2 class="text-white fw-bold mb-2">Drop files here</h2>
        <p class="text-gray">Release mouse to upload</p>
    </div>
</div>

<input type="file" id="globalFileInput" style="display:none" multiple>
