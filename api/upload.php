<?php
// upload.php - Página dedicada V3
require_once __DIR__ . '/../core/auth/session.php';
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
            <label class="form-label text-muted small">File (PDF, Image)</label>
            <input type="file" name="file" class="form-control" required>
        </div>

        <div class="d-grid gap-2">
            <button type="submit" class="btn btn-primary fw-bold">Upload</button>
            <a href="../pages/index.php" class="btn btn-outline-light border-secondary">Cancel</a>
        </div>
    </form>
</div>

<script>
document.getElementById('uploadForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const fd = new FormData(this);
    
    try {
        const r = await fetch('api.php', { method: 'POST', body: fd });
        const res = await r.json();
        if(res.status === 'success') {
            alert('File uploaded successfully!');
            window.location.href = '../pages/index.php?project_id=' + fd.get('project_id');
        } else {
            alert('Error: ' + res.msg);
        }
    } catch(err) { alert('Connection error'); }
});
</script>
</body>
</html>

