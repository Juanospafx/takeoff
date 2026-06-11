<?php
// archivos.php - Archivos Subidos al Sistema
require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/time.php';

$userName = $_SESSION['username'];

$q = trim($_GET['q'] ?? '');
$where = "f.deleted_at IS NULL";
$params = [];
if ($q !== '') {
    $where .= " AND (f.filename LIKE ? OR p.name LIKE ?)";
    $like = '%' . $q . '%';
    $params[] = $like;
    $params[] = $like;
}

$stmt = $pdo->prepare("
    SELECT f.*, p.name AS project_name
    FROM files f
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE $where
    ORDER BY f.uploaded_at DESC
");
$stmt->execute($params);
$files = $stmt->fetchAll(PDO::FETCH_ASSOC);

$pageTitle = "Files | Brightronix";
include __DIR__ . '/../views/header.php';
?>

<style>
    .table-responsive { border-radius: var(--radius-box); overflow: hidden; border: 1px solid rgba(255,255,255,0.05); }
    .table-rounded { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--bg-card); }
    .table-rounded th { background: rgba(0,0,0,0.2); color: var(--text-gray); font-weight: 600; text-transform: uppercase; font-size: 0.75rem; padding: 18px 25px; border-bottom: 1px solid rgba(255,255,255,0.05); white-space: nowrap; }
    .table-rounded td { padding: 20px 25px; color: white; vertical-align: middle; border-bottom: 1px solid rgba(255,255,255,0.02); }
    .table-rounded tr:last-child td { border-bottom: none; }
    .table-rounded tr:hover td { background: rgba(255,255,255,0.02); }

    .btn-action { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.1); color: var(--text-gray); transition: 0.2s; background: transparent; }
    .btn-action:hover { background: white; color: var(--bg-body); }

    /* Responsive cards */
    .file-cards { display: none; }
    .file-card { background: var(--bg-card); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 16px; }
    .file-card + .file-card { margin-top: 12px; }
    .file-meta { font-size: 0.8rem; color: var(--text-gray); }

    @media (max-width: 992px) {
        .table-responsive { display: none; }
        .file-cards { display: block; }
    }

    @media (max-width: 768px) {
        .header { flex-direction: column; align-items: flex-start; gap: 12px; }
        .breadcrumbs { margin-top: 4px; }
        .main-content { padding: 20px; }
        .d-flex.justify-content-between.align-items-end { flex-direction: column; align-items: flex-start; gap: 12px; }
        form.d-flex { width: 100%; }
        form.d-flex .form-control { flex: 1; }
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
                <i class="fas fa-chevron-right mx-2" style="font-size:0.7rem"></i>
                <span>Files</span>
            </div>
        </div>

        <div class="user-pill">
            <div class="avatar"><?= strtoupper(substr($userName,0,1)) ?></div>
            <span class="small fw-bold"><?= htmlspecialchars($userName) ?></span>
        </div>
    </header>

    <div class="d-flex justify-content-between align-items-end mb-4">
        <div>
            <h2 class="fw-bold mb-1">Uploaded Files</h2>
            <p class="text-gray mb-0">All files currently stored in the system.</p>
        </div>
        <form class="d-flex gap-2" method="get" action="archivos.php">
            <input type="text" name="q" class="form-control form-control-sm" style="max-width:240px" placeholder="Search file or project..." value="<?= htmlspecialchars($q) ?>">
            <button class="btn btn-outline-light btn-sm rounded-pill px-3" type="submit"><i class="fas fa-search"></i></button>
        </form>
    </div>

    <div class="table-responsive">
        <table class="table-rounded">
            <thead>
                <tr>
                    <th width="40%">File</th>
                    <th width="30%">Assigned Project</th>
                    <th width="15%">Uploaded</th>
                    <th class="text-end">Actions</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach($files as $f): 
                    $projectLabel = !empty($f['project_name']) ? $f['project_name'] : 'No assigned project';
                    $filePath = $f['filepath'] ?? '';
                    if (strpos($filePath, 'uploads/') === 0) {
                        $expected = __DIR__ . '/../' . $filePath;
                        $legacy = __DIR__ . '/../api/' . $filePath;
                        if (!file_exists($expected) && file_exists($legacy)) {
                            $filePath = 'api/' . $filePath;
                        }
                    }
                    if (strpos($filePath, 'uploads/') === 0 || strpos($filePath, 'api/uploads/') === 0) {
                        $filePath = '../' . $filePath;
                    }
                ?>
                <tr>
                    <td>
                        <div class="fw-bold"><?= htmlspecialchars($f['filename']) ?></div>
                        <div class="small text-gray">ID: #<?= (int)$f['id'] ?></div>
                    </td>
                    <td class="small text-gray"><?= htmlspecialchars($projectLabel) ?></td>
                    <td class="small text-gray"><?= !empty($f['uploaded_at']) ? date('M d, Y', strtotime($f['uploaded_at'])) : '-' ?></td>
                    <td class="text-end">
                        <a href="preview.php?id=<?= (int)$f['id'] ?>" class="btn-action me-1" title="Preview"><i class="fas fa-eye"></i></a>
                        <?php if(($_SESSION['role'] ?? '') === 'admin'): ?>
                            <button class="btn-action text-danger border-danger" title="Delete" onclick="deleteFile(<?= (int)$f['id'] ?>)"><i class="fas fa-trash"></i></button>
                        <?php endif; ?>
                        <?php if(!empty($filePath)): ?>
                            <a href="<?= htmlspecialchars($filePath) ?>" class="btn-action" title="Download" target="_blank" rel="noopener"><i class="fas fa-download"></i></a>
                        <?php endif; ?>
                    </td>
                </tr>
                <?php endforeach; ?>

                <?php if(empty($files)): ?>
                <tr>
                    <td colspan="4" class="text-center py-5 text-gray">
                        No files found.
                    </td>
                </tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>

    <div class="file-cards">
        <?php foreach($files as $f): 
            $projectLabel = !empty($f['project_name']) ? $f['project_name'] : 'No assigned project';
        ?>
            <div class="file-card">
                <div class="fw-bold"><?= htmlspecialchars($f['filename']) ?></div>
                <div class="file-meta">Project: <?= htmlspecialchars($projectLabel) ?></div>
                <div class="file-meta">Uploaded: <?= !empty($f['uploaded_at']) ? date('M d, Y', strtotime($f['uploaded_at'])) : '-' ?></div>
                <div class="d-flex gap-2 mt-3">
                    <a href="preview.php?id=<?= (int)$f['id'] ?>" class="btn-action" title="Preview"><i class="fas fa-eye"></i></a>
                    <?php if(($_SESSION['role'] ?? '') === 'admin'): ?>
                        <button class="btn-action text-danger border-danger" title="Delete" onclick="deleteFile(<?= (int)$f['id'] ?>)"><i class="fas fa-trash"></i></button>
                    <?php endif; ?>
                </div>
            </div>
        <?php endforeach; ?>

        <?php if(empty($files)): ?>
            <div class="file-card text-center text-gray">No files found.</div>
        <?php endif; ?>
    </div>
</main>

<script>
    function deleteFile(id) {
        if(!confirm("Move file to Recycle Bin?")) return;
        const fd = new FormData();
        fd.append('action', 'delete_file');
        fd.append('id', id);
        fetch('../api/api.php', { method:'POST', body: fd })
            .then(r => r.json())
            .then(d => {
                if(d.status === 'success') location.reload();
                else alert('Error deleting file: ' + (d.msg || 'Unknown'));
            })
            .catch(() => alert('Connection error'));
    }
</script>

<?php include __DIR__ . '/../views/footer.php'; ?>
