<?php
// search.php - Buscador Global V1.0
require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/time.php';

$term = $_GET['q'] ?? '';
$results = ['projects'=>[], 'folders'=>[], 'files'=>[]];

// Lógica de Búsqueda
if (!empty($term)) {
    $searchTerm = "%$term%";

    // 1. Buscar Proyectos (Solo activos)
    $stmtP = $pdo->prepare("SELECT * FROM projects WHERE (name LIKE ? OR description LIKE ?) AND deleted_at IS NULL LIMIT 5");
    $stmtP->execute([$searchTerm, $searchTerm]);
    $results['projects'] = $stmtP->fetchAll(PDO::FETCH_ASSOC);

    // 2. Buscar Carpetas
    $stmtF = $pdo->prepare("SELECT f.*, p.name as project_name FROM folders f LEFT JOIN projects p ON f.project_id = p.id WHERE f.name LIKE ? AND f.deleted_at IS NULL LIMIT 5");
    $stmtF->execute([$searchTerm]);
    $results['folders'] = $stmtF->fetchAll(PDO::FETCH_ASSOC);

    // 3. Buscar Archivos
    $stmtFi = $pdo->prepare("SELECT f.*, p.name as project_name, fo.name as folder_name FROM files f LEFT JOIN projects p ON f.project_id = p.id LEFT JOIN folders fo ON f.folder_id = fo.id WHERE f.filename LIKE ? AND f.deleted_at IS NULL LIMIT 20");
    $stmtFi->execute([$searchTerm]);
    $results['files'] = $stmtFi->fetchAll(PDO::FETCH_ASSOC);
}

$pageTitle = "Search: " . htmlspecialchars($term);
include __DIR__ . '/../views/header.php';
?>

<main class="main-content">
    <header class="header">
        <h2 class="fw-bold m-0">Global Search</h2>
        <div class="user-pill">
            <div class="avatar"><?= strtoupper(substr($_SESSION['username'],0,1)) ?></div>
            <span class="small fw-bold"><?= htmlspecialchars($_SESSION['username']) ?></span>
        </div>
    </header>

    <div class="row justify-content-center mb-5">
        <div class="col-md-8">
            <form action="search.php" method="GET" class="position-relative">
                <i class="fas fa-search position-absolute text-gray" style="top:18px; left:20px; font-size:1.2rem;"></i>
                <input type="text" name="q" class="form-control" value="<?= htmlspecialchars($term) ?>" placeholder="Search files, projects, folders..." style="padding: 15px 15px 15px 55px; border-radius: 50px; background: #1e293b; border: 1px solid rgba(255,255,255,0.1); color: white; font-size: 1.1rem;">
                <button type="submit" class="btn btn-main position-absolute" style="top:6px; right:6px; border-radius: 40px; padding: 10px 30px;">Search</button>
            </form>
        </div>
    </div>

    <?php if(!empty($term)): ?>
        <h5 class="text-gray mb-4">Results for "<span class="text-white"><?= htmlspecialchars($term) ?></span>"</h5>

        <?php if(empty($results['projects']) && empty($results['folders']) && empty($results['files'])): ?>
            <div class="text-center py-5 opacity-50">
                <i class="fas fa-ghost fa-3x mb-3"></i>
                <p>No results found.</p>
            </div>
        <?php endif; ?>

        <?php if(!empty($results['projects'])): ?>
        <h6 class="fw-bold text-primary mb-3 ps-2 border-start border-4 border-primary">Projects</h6>
        <div class="row g-3 mb-5">
            <?php foreach($results['projects'] as $p): ?>
            <div class="col-md-4">
                <a href="../pages/index.php?project_id=<?= $p['id'] ?>" class="box-card d-block text-decoration-none">
                    <div class="d-flex align-items-center gap-3">
                        <div class="bg-primary bg-opacity-10 p-3 rounded text-primary"><i class="fas fa-folder"></i></div>
                        <div>
                            <div class="fw-bold text-white"><?= htmlspecialchars($p['name']) ?></div>
                            <div class="small text-gray text-truncate" style="max-width:200px"><?= htmlspecialchars($p['description']) ?></div>
                        </div>
                    </div>
                </a>
            </div>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>

        <?php if(!empty($results['folders'])): ?>
        <h6 class="fw-bold text-warning mb-3 ps-2 border-start border-4 border-warning">Folders</h6>
        <div class="row g-3 mb-5">
            <?php foreach($results['folders'] as $f): ?>
            <div class="col-md-3">
                <a href="../pages/index.php?project_id=<?= $f['project_id'] ?>&folder_id=<?= $f['id'] ?>" class="box-card d-block text-decoration-none py-3">
                    <div class="d-flex align-items-center gap-2">
                        <i class="fas fa-folder-open text-warning"></i>
                        <span class="text-white fw-bold"><?= htmlspecialchars($f['name']) ?></span>
                    </div>
                    <small class="text-gray d-block mt-1 ps-4">in <?= htmlspecialchars($f['project_name']) ?></small>
                </a>
            </div>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>

        <?php if(!empty($results['files'])): ?>
        <h6 class="fw-bold text-info mb-3 ps-2 border-start border-4 border-info">Files</h6>
        <div class="row g-3">
            <?php foreach($results['files'] as $f): 
                $ft = strtolower(pathinfo($f['filename'], PATHINFO_EXTENSION));
                $icon = 'fa-file'; $col = 'text-gray';
                if($ft==='pdf'){$icon='fa-file-pdf'; $col='text-danger';}
                elseif(in_array($ft,['jpg','png','jpeg'])){$icon='fa-image'; $col='text-info';}
            ?>
            <div class="col-md-6">
                <div class="box-card p-3 d-flex align-items-center justify-content-between">
                    <div class="d-flex align-items-center gap-3 overflow-hidden">
                        <div class="p-2 bg-dark rounded"><i class="fas <?= $icon ?> <?= $col ?> fa-lg"></i></div>
                        <div class="text-truncate">
                            <div class="fw-bold text-white text-truncate"><?= htmlspecialchars($f['filename']) ?></div>
                            <div class="small text-gray">
                                in <?= htmlspecialchars($f['project_name']) ?> 
                                <?= $f['folder_name'] ? '/ '.htmlspecialchars($f['folder_name']) : '' ?>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex gap-2">
                        <a href="../pages/preview.php?id=<?= $f['id'] ?>" class="btn-icon" style="width:35px;height:35px"><i class="fas fa-eye"></i></a>
                        <?php if($_SESSION['role'] !== 'viewer'): ?>
                        <a href="../pages/editor.php?id=<?= $f['id'] ?>" class="btn-icon text-primary border-primary" style="width:35px;height:35px"><i class="fas fa-pen"></i></a>
                        <?php endif; ?>
                    </div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>

    <?php endif; ?>
</main>
<?php include __DIR__ . '/../views/footer.php'; ?>
