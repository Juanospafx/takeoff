<?php
// upload.php - Página dedicada V3
require_once __DIR__ . '/../core/auth/session.php';

$readActions = ['view', 'form', 'upload_page'];
$mutationActions = ['upload', 'upload_file'];

$rawBody = file_get_contents('php://input');
$body = json_decode($rawBody ?: '', true);
if (!is_array($body)) {
    $body = [];
}
$action = (string)($_GET['action'] ?? $_POST['action'] ?? ($body['action'] ?? ''));

$user = takeoff_guard_api_action($action, $readActions, $mutationActions, 'view');
$userId = (int)$user['user_id'];

require_once __DIR__ . '/../core/db/connection.php';

// Obtener Proyectos para el dropdown
$projects = $pdo->query("SELECT id, name FROM projects ORDER BY created_at DESC")->fetchAll();
$project_id_pre = $_GET['project_id'] ?? '';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Upload Plan | Brightronix</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #0f172a; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; }
        .upload-card { background: #1e293b; border: 1px solid #475569; padding: 40px; border-radius: 10px; width: 100%; max-width: 500px; }
        .form-control, .form-select { background: #0f172a; border: 1px solid #475569; color: white; }
        .upload-progress { display: none; margin-bottom: 1rem; }
        .upload-progress.is-active { display: block; }
        .upload-progress-label { display: flex; justify-content: space-between; gap: 1rem; font-size: .85rem; margin-bottom: .35rem; }
        .upload-progress-track { height: .55rem; overflow: hidden; border-radius: 999px; background: #334155; }
        .upload-progress-bar { width: 0; height: 100%; background: #3b82f6; transition: width .15s ease; }
        .upload-results { max-height: 9rem; overflow: auto; font-size: .85rem; }
    </style>
</head>
<body>

<div class="upload-card">
    <h3 class="fw-bold mb-4 text-center">Upload File</h3>
    
    <form id="uploadForm">
        <input type="hidden" name="action" value="upload_file">
        
        <div class="mb-3">
            <label class="form-label text-muted small">Project</label>
            <select name="project_id" class="form-select" required>
                <option value="">Select Project...</option>
                <?php foreach($projects as $p): ?>
                    <option value="<?= $p['id'] ?>" <?= $project_id_pre == $p['id'] ? 'selected' : '' ?>>
                        <?= htmlspecialchars($p['name']) ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>

        <div class="mb-4">
            <label class="form-label text-muted small">Files (PDF, Images)</label>
            <input type="file" name="files[]" class="form-control" multiple required>
        </div>

        <div id="uploadProgress" class="upload-progress" aria-live="polite">
            <div class="upload-progress-label"><span id="uploadActiveFile">Preparing…</span><span id="uploadProgressText">0 / 0</span></div>
            <div class="upload-progress-track"><div id="uploadProgressBar" class="upload-progress-bar"></div></div>
        </div>
        <div id="uploadResults" class="upload-results mb-3" aria-live="polite"></div>

        <div class="d-grid gap-2">
            <button type="submit" class="btn btn-primary fw-bold">Upload</button>
            <a href="../pages/index.php" class="btn btn-outline-light border-secondary">Cancel</a>
        </div>
    </form>
</div>

<script>
const MAX_FILE_BYTES = 10737418240;

function uploadOne(file, projectId, onProgress) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('action', 'upload_file');
        form.append('project_id', projectId);
        form.append('file', file, file.name);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'api.php');
        xhr.upload.onprogress = event => {
            if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
            let result = null;
            try { result = JSON.parse(xhr.responseText); } catch (_) {}
            if (xhr.status >= 200 && xhr.status < 300 && result?.status === 'success') resolve(result);
            else reject(new Error(result?.msg || `Upload failed (HTTP ${xhr.status || 0}).`));
        };
        xhr.onerror = () => reject(new Error('Connection error.'));
        xhr.send(form);
    });
}

document.getElementById('uploadForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const projectId = this.elements.project_id.value;
    const files = Array.from(this.elements['files[]'].files || []);
    if (!projectId || !files.length) return;

    const progress = document.getElementById('uploadProgress');
    const active = document.getElementById('uploadActiveFile');
    const text = document.getElementById('uploadProgressText');
    const bar = document.getElementById('uploadProgressBar');
    const results = document.getElementById('uploadResults');
    const submit = this.querySelector('button[type="submit"]');
    const errors = [];
    let completed = 0;
    let succeeded = 0;
    progress.classList.add('is-active');
    results.replaceChildren();
    submit.disabled = true;

    for (const file of files) {
        active.textContent = file.name;
        text.textContent = `${completed} / ${files.length} · 0%`;
        bar.style.width = `${Math.round((completed / files.length) * 100)}%`;
        if (file.size > MAX_FILE_BYTES) {
            errors.push({ filename: file.name, message: 'File exceeds the 10 GB limit.' });
            completed++;
            continue;
        }
        try {
            await uploadOne(file, projectId, percent => {
                text.textContent = `${completed} / ${files.length} · ${percent}%`;
                bar.style.width = `${Math.round(((completed + percent / 100) / files.length) * 100)}%`;
            });
            succeeded++;
        } catch (error) {
            errors.push({ filename: file.name, message: error.message || 'Upload failed.' });
        }
        completed++;
    }

    bar.style.width = '100%';
    text.textContent = `${completed} / ${files.length}`;
    active.textContent = errors.length ? `${succeeded} uploaded, ${errors.length} failed` : `${succeeded} uploaded`;
    for (const error of errors) {
        const row = document.createElement('div');
        row.className = 'text-danger';
        row.textContent = `${error.filename}: ${error.message}`;
        results.appendChild(row);
    }
    submit.disabled = false;
    if (!errors.length) window.location.href = '../pages/index.php?project_id=' + encodeURIComponent(projectId);
});
</script>
</body>
</html>
