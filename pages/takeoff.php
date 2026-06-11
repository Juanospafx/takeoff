<?php
// Standalone Takeoff entry point. No auth/session dependency.
$recentFiles = [];
$projects = [];
$syncedUploadCount = 0;

try {
    require_once __DIR__ . '/../core/db/connection.php';

    function ensure_takeoff_base_tables(PDO $pdo): void
    {
        $pdo->exec("CREATE TABLE IF NOT EXISTS projects (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(191) NOT NULL,
            description TEXT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'Active',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP NULL DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_projects_deleted (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        $pdo->exec("CREATE TABLE IF NOT EXISTS folders (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            project_id BIGINT UNSIGNED NOT NULL,
            name VARCHAR(191) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP NULL DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_folders_project (project_id),
            KEY idx_folders_deleted (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        $pdo->exec("CREATE TABLE IF NOT EXISTS files (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            project_id BIGINT UNSIGNED NULL,
            folder_id BIGINT UNSIGNED NULL,
            sub_folder_id BIGINT UNSIGNED NULL,
            filename VARCHAR(255) NOT NULL,
            filepath VARCHAR(1024) NOT NULL,
            file_type VARCHAR(100) NULL,
            uploaded_by BIGINT UNSIGNED NULL,
            version_group_id VARCHAR(100) NULL,
            version_number INT UNSIGNED NOT NULL DEFAULT 1,
            uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP NULL DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_files_project (project_id),
            KEY idx_files_folder (folder_id),
            KEY idx_files_deleted (deleted_at),
            KEY idx_files_uploaded (uploaded_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        $pdo->exec("CREATE TABLE IF NOT EXISTS file_reports (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            file_id BIGINT UNSIGNED NOT NULL,
            technician_name VARCHAR(191) NULL,
            technician_role VARCHAR(191) NULL,
            description TEXT NULL,
            report_pdf_path VARCHAR(1024) NULL,
            annotations_json JSON NULL,
            attachments_json JSON NULL,
            is_deleted TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_file_reports_file (file_id),
            KEY idx_file_reports_deleted (is_deleted)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    function ensure_upload_test_project(PDO $pdo): array
    {
        $pdo->exec("INSERT INTO projects (id, name, description, status)
            VALUES (1, 'Uploads Test Project', 'Temporary project generated from the local uploads folder', 'Active')
            ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)");
        $pdo->exec("INSERT INTO folders (id, project_id, name)
            VALUES (1, 1, 'Uploads')
            ON DUPLICATE KEY UPDATE name = VALUES(name)");
        return [1, 1];
    }

    function sync_uploads_to_files(PDO $pdo, int $projectId, int $folderId): int
    {
        $roots = [
            'uploads' => realpath(__DIR__ . '/../uploads'),
            'api/uploads' => realpath(__DIR__ . '/../api/uploads'),
        ];
        $allowed = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'];
        $count = 0;
        $exists = $pdo->prepare("SELECT id FROM files WHERE filepath = ? AND deleted_at IS NULL LIMIT 1");
        $insert = $pdo->prepare("INSERT INTO files (project_id, folder_id, filename, filepath, file_type, uploaded_by, version_group_id, version_number, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");

        foreach ($roots as $publicRoot => $diskRoot) {
            if (!$diskRoot || !is_dir($diskRoot)) continue;
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($diskRoot, FilesystemIterator::SKIP_DOTS)
            );
            foreach ($iterator as $file) {
                if (!$file->isFile()) continue;
                $ext = strtolower($file->getExtension());
                if (!in_array($ext, $allowed, true)) continue;
                $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($diskRoot) + 1));
                $publicPath = $publicRoot . '/' . $relative;
                $exists->execute([$publicPath]);
                if ($exists->fetchColumn()) continue;
                $uploadedAt = date('Y-m-d H:i:s', max(1, $file->getMTime()));
                $insert->execute([
                    $projectId,
                    $folderId,
                    $file->getFilename(),
                    $publicPath,
                    $ext,
                    1,
                    'uploads_' . md5($publicPath),
                    1,
                    $uploadedAt,
                ]);
                $count++;
            }
        }
        return $count;
    }

    ensure_takeoff_base_tables($pdo);
    [$testProjectId, $testFolderId] = ensure_upload_test_project($pdo);
    $syncedUploadCount = sync_uploads_to_files($pdo, $testProjectId, $testFolderId);

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
        <a class="nav-link-takeoff active" href="/"><i class="fas fa-file-lines"></i><span>Uploads</span></a>
    </aside>

    <main class="main">
        <div class="topbar">
            <div class="title">
                <h1>Takeoff Module</h1>
                <p>Testing mode: PDFs and images are loaded from the local uploads folders.</p>
            </div>
        </div>

        <?php if (!empty($loadError)): ?>
            <div class="alert alert-danger">Database error: <?= htmlspecialchars($loadError) ?></div>
        <?php endif; ?>
        <?php if ($syncedUploadCount > 0): ?>
            <div class="alert alert-info">Synced <?= (int)$syncedUploadCount ?> new upload file(s) for testing.</div>
        <?php endif; ?>

        <div class="row g-4">
            <div class="col-12">
                <div class="card-takeoff">
                    <h5 class="fw-bold mb-3">Uploads</h5>
                    <?php if (empty($recentFiles)): ?>
                        <div class="meta">No PDF or image files were found in uploads/ or api/uploads/.</div>
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
                                    <?= htmlspecialchars($file['project_name'] ?? 'Uploads Test Project') ?>
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
        </div>
    </main>
</div>
</body>
</html>
