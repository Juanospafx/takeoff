<?php
// timeline.php - Historial Global V1.6 (Breadcrumbs + Estructura Fixed)
require_once __DIR__ . '/../core/auth/session.php';
$authRedirect = takeoff_require_page_auth($_SESSION ?? null);
if ($authRedirect !== null) return;
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/time.php'; 

// =========================================================
// 1. DEFINICIÓN DE USUARIO Y ROLES
// =========================================================
$userId = $_SESSION['user_id'];
$userName = $_SESSION['username'];
$userRoleRaw = $_SESSION['role'] ?? 'viewer'; 
$userRole = strtolower($userRoleRaw); 

// Definir permisos
$isAdmin = ($userRole === 'admin');
$canCreate = $isAdmin;
$canDelete = $isAdmin; 
$canUpload = $isAdmin;

// --- LOGICA DE FILTRO DE FECHA ---
$filterDate = $_GET['filter_date'] ?? '';
$params = [];

// Consulta Base
$baseSql = "
    SELECT * FROM (
        (SELECT 
            'project' as type, 
            p.id as ref_id, 
            p.name as title, 
            p.description as subtitle, 
            p.created_at as activity_date, 
            u.username as user_name,
            u.role as user_role
         FROM projects p 
         LEFT JOIN users u ON p.created_by = u.id)

        UNION

        (SELECT 
            'file' as type, 
            f.id as ref_id, 
            f.filename as title, 
            prj.name as subtitle, 
            f.uploaded_at as activity_date, 
            u.username as user_name,
            u.role as user_role
         FROM files f 
         LEFT JOIN users u ON f.uploaded_by = u.id
         LEFT JOIN projects prj ON f.project_id = prj.id)

        UNION

        (SELECT 
            'report' as type, 
            fr.file_id as ref_id, 
            'Field Report Generated' as title, 
            fr.description as subtitle, 
            fr.created_at as activity_date, 
            fr.technician_name as user_name,
            fr.technician_role as user_role
         FROM file_reports fr)
    ) AS history
";

// Aplicar Filtro si existe
if (!empty($filterDate)) {
    $baseSql .= " WHERE DATE(activity_date) = ? ";
    $params[] = $filterDate;
}

$baseSql .= " ORDER BY activity_date DESC LIMIT 50";

$stmt = $pdo->prepare($baseSql);
$stmt->execute($params);
$activities = $stmt->fetchAll(PDO::FETCH_ASSOC);

// INCLUIR CABEZAL
$pageTitle = "Timeline | Brightronix";
include __DIR__ . '/../views/header.php'; 
?>

    <main class="main-content">
        <link rel="stylesheet" href="../assets/portal_timeline.css?v=<?= filemtime(__DIR__ . '/../assets/portal_timeline.css') ?>">

        <header class="header">
            <div class="d-flex align-items-center gap-3">
                <button class="mobile-toggle" onclick="toggleSidebar()">
                    <i class="fas fa-bars"></i>
                </button>
                <div class="breadcrumbs">
                    <a href="index.php">Home</a>
                    <i class="fas fa-chevron-right mx-2" style="font-size:0.7rem"></i>
                    <span>Timeline</span>
                </div>
            </div>

            <div class="user-pill">
                <div class="avatar"><?= strtoupper(substr($userName,0,1)) ?></div>
                <span class="small fw-bold"><?= htmlspecialchars($userName) ?></span>
            </div>
        </header>

        <div class="d-flex justify-content-between align-items-end mb-5">
            <div>
                 <h2 class="fw-bold m-0">Activity Timeline</h2>
                 <p class="text-gray mb-0">Track all actions performed in the system.</p>
            </div>
            
            <form method="GET" class="d-flex align-items-center gap-2">
                <input type="date" name="filter_date" class="form-control form-control-sm bg-dark text-white border-secondary" value="<?= htmlspecialchars($filterDate) ?>">
                <button type="submit" class="btn btn-sm btn-primary"><i class="fas fa-filter"></i></button>
                <?php if(!empty($filterDate)): ?>
                    <a href="timeline.php" class="btn btn-sm btn-outline-secondary" title="Clear"><i class="fas fa-times"></i></a>
                <?php endif; ?>
            </form>
        </div>

        <div class="timeline-container">
            <?php 
            $currentDateGroup = ''; 
            
            foreach($activities as $act): 
                $icon = 'fa-circle'; $link = '#';
                if($act['type'] == 'project') { $icon = 'fa-layer-group'; $colorClass = 'text-primary'; $actionText = 'New Project Created'; $link = "index.php?project_id=" . $act['ref_id']; } 
                elseif($act['type'] == 'file') { $icon = 'fa-file-upload'; $colorClass = 'text-info'; $actionText = 'File Uploaded'; $link = "preview.php?id=" . $act['ref_id']; } 
                elseif($act['type'] == 'report') { $icon = 'fa-clipboard-check'; $colorClass = 'text-success'; $actionText = 'Field Report Submitted'; $link = "preview.php?id=" . $act['ref_id']; }
                
                // LOGICA DE AGRUPACIÓN POR DIA
                $actDateObj = new DateTime($act['activity_date']); // PHP usará el $appTimeZone definido en functions.php
                $actDateStr = $actDateObj->format('Y-m-d');
                
                if($actDateStr !== $currentDateGroup):
                    $today = date('Y-m-d');
                    $yesterday = date('Y-m-d', strtotime('-1 day'));
                    
                    if($actDateStr === $today) $label = "Today";
                    elseif($actDateStr === $yesterday) $label = "Yesterday";
                    else $label = $actDateObj->format('l, F j, Y');
                    
                    echo '<div class="date-separator"><span class="date-label">'. $label .'</span></div>';
                    $currentDateGroup = $actDateStr;
                endif;
            ?>
            
            <div class="timeline-item">
                <div class="timeline-icon"><i class="fas <?= $icon ?>"></i></div>
                <a href="<?= $link ?>" class="timeline-card d-block text-decoration-none">
                    <span class="time-badge"><i class="far fa-clock me-1"></i> <?= time_elapsed_string($act['activity_date']) ?> <span class="opacity-50 mx-1">|</span> <?= $actDateObj->format('h:i A') ?></span>
                    <div class="activity-title"><?= htmlspecialchars($act['title']) ?></div>
                    <div class="activity-desc"><?= $act['type'] == 'file' ? 'Uploaded to: ' : '' ?><?= htmlspecialchars($act['subtitle'] ?: 'No additional details.') ?></div>
                    <div class="user-mini">
                        <div class="av"><?= strtoupper(substr($act['user_name'] ?? 'U', 0, 1)) ?></div>
                        <div class="small fw-bold text-white"><?= htmlspecialchars($act['user_name'] ?? 'System') ?></div>
                        <div class="small text-muted ms-1">performed action: <span class="<?= $colorClass ?>"><?= $actionText ?></span></div>
                        <div class="user-role-badge"><?= strtoupper($act['user_role'] ?? '') ?></div>
                    </div>
                </a>
            </div>
            <?php endforeach; ?>

            <?php if(empty($activities)): ?>
                <div class="text-center py-5 text-gray">
                    <i class="fas fa-search fa-3x mb-3 opacity-25"></i>
                    <p>No activity found for this criteria.</p>
                    <?php if(!empty($filterDate)): ?><a href="timeline.php" class="text-primary small">Clear filters</a><?php endif; ?>
                </div>
            <?php endif; ?>
        </div>
    </main>

<?php include __DIR__ . '/../views/footer.php'; ?>
