<?php
// Standalone Takeoff entry point. No auth/session dependency.
$recentFiles = [];
$projects = [];

try {
    require_once __DIR__ . '/../core/db/connection.php';

    $recentStmt = $pdo->query(
        "SELECT f.id, f.filename, f.file_type, f.uploaded_at, p.name AS project_name, fo.name AS folder_name
         FROM files f
         LEFT JOIN projects p ON p.id = f.project_id
         LEFT JOIN folders fo ON fo.id = f.folder_id
         WHERE f.deleted_at IS NULL
         ORDER BY f.uploaded_at DESC
         LIMIT 24"
    );
    $recentFiles = $recentStmt->fetchAll(PDO::FETCH_ASSOC);

    $projectStmt = $pdo->query(
        "SELECT p.id, p.name, COUNT(f.id) AS file_count
         FROM projects p
         LEFT JOIN files f ON f.project_id = p.id AND f.deleted_at IS NULL
         WHERE p.deleted_at IS NULL
         GROUP BY p.id, p.name
         ORDER BY p.created_at DESC
         LIMIT 12"
    );
    $projects = $projectStmt->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    $loadError = $e->getMessage();
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Takeoff | Brightronix</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0b1120;
            --panel: #111827;
            --card: #1e293b;
            --line: rgba(148, 163, 184, .2);
            --text: #f8fafc;
            --muted: #94a3b8;
            --primary: #2563eb;
            --accent: #0ea5e9;
        }
        body {
            margin: 0;
            min-height: 100vh;
            background: var(--bg);
            color: var(--text);
            font-family: Outfit, system-ui, sans-serif;
        }
        .shell {
            min-height: 100vh;
            display: grid;
            grid-template-columns: 280px 1fr;
        }
        .side {
            background: var(--panel);
            border-right: 1px solid var(--line);
            padding: 28px 22px;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
            font-weight: 800;
            font-size: 1.2rem;
            margin-bottom: 32px;
        }
        .brand-icon {
            width: 40px;
            height: 40px;
            display: grid;
            place-items: center;
            border-radius: 8px;
            background: linear-gradient(135deg, var(--primary), var(--accent));
        }
        .nav-link-takeoff {
            display: flex;
            align-items: center;
            gap: 12px;
            color: var(--muted);
            padding: 12px 14px;
            border-radius: 8px;
            text-decoration: none;
            margin-bottom: 6px;
        }
        .nav-link-takeoff.active,
        .nav-link-takeoff:hover {
            color: #fff;
            background: rgba(37, 99, 235, .22);
        }
        .main {
            padding: 34px;
            min-width: 0;
        }
        .topbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 20px;
            margin-bottom: 28px;
        }
        .title h1 {
            font-size: 1.8rem;
            font-weight: 800;
            margin: 0 0 4px;
        }
        .title p {
            margin: 0;
            color: var(--muted);
        }
        .card-takeoff {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 18px;
            height: 100%;
        }
        .file-row {
            display: grid;
            grid-template-columns: 42px 1fr auto;
            align-items: center;
            gap: 12px;
            padding: 12px;
            border: 1px solid var(--line);
            border-radius: 8px;
            background: rgba(15, 23, 42, .75);
            margin-bottom: 10px;
        }
        .file-icon {
            width: 42px;
            height: 42px;
            display: grid;
            place-items: center;
            border-radius: 8px;
            background: rgba(14, 165, 233, .14);
            color: #38bdf8;
        }
        .file-name {
            font-weight: 700;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .meta {
            color: var(--muted);
            font-size: .82rem;
        }
        .btn-open {
            background: var(--primary);
            border: 0;
            color: #fff;
            border-radius: 999px;
            padding: 8px 14px;
            text-decoration: none;
            font-weight: 700;
            white-space: nowrap;
        }
        .btn-open:hover {
            color: #fff;
            background: #1d4ed8;
        }
        @media (max-width: 900px) {
            .shell { grid-template-columns: 1fr; }
            .side { border-right: 0; border-bottom: 1px solid var(--line); }
            .main { padding: 22px; }
            .file-row { grid-template-columns: 42px 1fr; }
            .file-row .btn-open { grid-column: 1 / -1; text-align: center; }
        }
    </style>
</head>
<body>
<div class="shell">
    <aside class="side">
        <div class="brand">
            <div class="brand-icon"><i class="fas fa-ruler-combined"></i></div>
            <span>Brightronix Takeoff</span>
        </div>
        <a class="nav-link-takeoff active" href="/"><i class="fas fa-file-lines"></i><span>Drawings</span></a>
        <a class="nav-link-takeoff" href="/pages/takeoff.php"><i class="fas fa-folder-tree"></i><span>Takeoff Home</span></a>
        <a class="nav-link-takeoff" href="/takeoff_mysql_schema.sql"><i class="fas fa-database"></i><span>Schema</span></a>
    </aside>

    <main class="main">
        <div class="topbar">
            <div class="title">
                <h1>Takeoff Module</h1>
                <p>Select a drawing to open the Konva-based Takeoff editor.</p>
            </div>
        </div>

        <?php if (!empty($loadError)): ?>
            <div class="alert alert-danger">Database error: <?= htmlspecialchars($loadError) ?></div>
        <?php endif; ?>

        <div class="row g-4">
            <div class="col-xl-8">
                <div class="card-takeoff">
                    <h5 class="fw-bold mb-3">Recent Drawings</h5>
                    <?php if (empty($recentFiles)): ?>
                        <div class="meta">No drawings found. Upload drawings in the workspace first.</div>
                    <?php endif; ?>
                    <?php foreach ($recentFiles as $file): ?>
                        <?php
                            $ext = strtolower(pathinfo((string)$file['filename'], PATHINFO_EXTENSION));
                            $icon = $ext === 'pdf' ? 'fa-file-pdf' : 'fa-file-image';
                        ?>
                        <div class="file-row">
                            <div class="file-icon"><i class="fas <?= $icon ?>"></i></div>
                            <div class="min-width-0">
                                <div class="file-name"><?= htmlspecialchars($file['filename']) ?></div>
                                <div class="meta">
                                    <?= htmlspecialchars($file['project_name'] ?? 'No project') ?>
                                    <?php if (!empty($file['folder_name'])): ?>
                                        · <?= htmlspecialchars($file['folder_name']) ?>
                                    <?php endif; ?>
                                    · <?= !empty($file['uploaded_at']) ? date('M d, Y', strtotime($file['uploaded_at'])) : 'No date' ?>
                                </div>
                            </div>
                            <a class="btn-open" href="/pages/editor.php?id=<?= (int)$file['id'] ?>">
                                <i class="fas fa-pen-ruler me-1"></i> Open Takeoff
                            </a>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>

            <div class="col-xl-4">
                <div class="card-takeoff">
                    <h5 class="fw-bold mb-3">Projects</h5>
                    <?php if (empty($projects)): ?>
                        <div class="meta">No projects found.</div>
                    <?php endif; ?>
                    <?php foreach ($projects as $project): ?>
                        <a class="file-row text-decoration-none text-white" href="/pages/project_dashboard.php?id=<?= (int)$project['id'] ?>">
                            <div class="file-icon"><i class="fas fa-folder"></i></div>
                            <div>
                                <div class="file-name"><?= htmlspecialchars($project['name']) ?></div>
                                <div class="meta"><?= (int)$project['file_count'] ?> drawings</div>
                            </div>
                        </a>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
    </main>
</div>
</body>
</html>
