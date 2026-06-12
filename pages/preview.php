<?php
// preview.php - Preview Profesional V8.2 (UI Update: Header & Floating Controls Position)
require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/db/connection.php';

// 1. NORMALIZAR ROL
$userRoleRaw = $_SESSION['role'] ?? 'viewer';
$userRole = strtolower($userRoleRaw); 

$id = $_GET['id'] ?? 0;

// 2. Obtener Datos del Archivo
$stmt = $pdo->prepare("SELECT * FROM files WHERE id=?");
$stmt->execute([$id]);
$file = $stmt->fetch(PDO::FETCH_ASSOC);
if(!$file) die("File not found");

$projectId = $file['project_id'];
$folderId = $file['folder_id'] ?? null;
$backUrl = "project_dashboard.php?id={$projectId}";
$backUrl .= "&tab=takeoff";

// 3. Historial (Solo activos)
$stmtRep = $pdo->prepare("SELECT * FROM file_reports WHERE file_id=? AND is_deleted = 0 ORDER BY created_at DESC");
$stmtRep->execute([$id]);
$reports = $stmtRep->fetchAll(PDO::FETCH_ASSOC);

$latestJson = count($reports) > 0 ? $reports[0]['annotations_json'] : '{}';
$annotations = (empty($latestJson) || $latestJson === 'null') ? '{}' : $latestJson;

// 4. Determinar extension
$fileExt = strtolower(pathinfo($file['filename'], PATHINFO_EXTENSION));
if ($fileExt === '' && !empty($file['file_type'])) {
    $ft = strtolower($file['file_type']);
    if (strpos($ft, '/') !== false) {
        $fileExt = substr($ft, strrpos($ft, '/') + 1);
    } else {
        $fileExt = $ft;
    }
}
// 5. Normalizar ruta publica
$filePath = str_replace('\\', '/', (string)($file['filepath'] ?? ''));
if ($filePath !== '') {
    // Si es ruta absoluta, recortar desde uploads/
    if (preg_match('~(api/)?uploads/[^\\s]+$~', $filePath, $m)) {
        $filePath = $m[0];
    }
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
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Preview V8 | <?= htmlspecialchars($file['filename']) ?></title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    
    <script src="https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js"></script>

    <style>
        /* --- TEMA MIDNIGHT BLUE (V5.0) --- */
        :root { 
            --bg-body: #0b1120;       
            --bg-panel: #111827;      
            --bg-header: rgba(11, 17, 32, 0.95);
            --border: rgba(255,255,255,0.05);        
            --text-main: #ffffff;     
            --text-muted: #c5cad1;
            --primary: #6366f1;        
            --accent: #0ea5e9;
            --danger: #ef4444;
            --success: #10b981;
            --radius-box: 20px;
            --radius-btn: 50px;
        }

        body { 
            background: var(--bg-body); height: 100vh; overflow: hidden; 
            color: var(--text-main); font-family: 'Outfit', sans-serif; 
            margin: 0; display: flex; flex-direction: column; 
            touch-action: none; /* CRÍTICO: Prevenir gestos nativos */
        }

        .app-container {
            display: grid;
            grid-template-columns: 280px 1fr 320px; 
            grid-template-rows: 70px 1fr;
            height: 100vh; width: 100vw;
        }

        /* HEADER */
        .app-header {
            grid-column: 1 / -1; background: var(--bg-header); border-bottom: 1px solid var(--border);
            display: flex; align-items: center; justify-content: space-between; padding: 0 20px; z-index: 50;
            backdrop-filter: blur(10px);
        }
        
        .brand-logo { font-weight: 700; font-size: 1.2rem; color: white; display:flex; align-items: center; gap: 10px; }
        .file-info { border-left: 1px solid var(--border); padding-left: 20px; margin-left: 20px; font-size: 0.9rem; color: var(--text-muted); }
        .file-info span { color: white; font-weight: 600; display: block; }

        /* SIDEBARS */
        .sidebar { background: var(--bg-panel); display: flex; flex-direction: column; padding: 25px; overflow-y: auto; }
        .sidebar-left { 
            grid-row: 2; grid-column: 1; background: var(--bg-panel); 
            border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 25px; 
            height: 100%; overflow: hidden; z-index: 1000;
            transition: transform 0.3s ease;
        }        
        .sidebar-right { 
            grid-row: 2; grid-column: 3; border-left: 1px solid var(--border); padding: 0; 
            z-index: 1000; transition: transform 0.3s ease; background: var(--bg-panel);
            display: flex; flex-direction: column;
        }

        .sidebar-title { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 20px; display: block; letter-spacing: 1px; }
        
        #page-list-container { flex-grow: 1; overflow-y: auto; min-height: 0; padding-right: 5px; }
        #page-list-container::-webkit-scrollbar { width: 6px; }
        #page-list-container::-webkit-scrollbar-track { background: transparent; }
        #page-list-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

        .page-item { 
            padding: 12px 15px; margin-bottom: 8px; border-radius: 12px; cursor: pointer; 
            color: var(--text-muted); font-size: 0.9rem; display: flex; justify-content: space-between; font-weight: 500;
            transition: 0.2s;
        }
        .page-item:hover { background: rgba(255,255,255,0.05); color: white; }
        .page-item.active { background: var(--primary); color: white; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3); }

        /* HISTORY LOG */
        .history-header { padding: 20px 25px; border-bottom: 1px solid var(--border); font-weight: 700; font-size: 0.9rem; display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.1); justify-content: space-between; }
        .history-list { padding: 20px; overflow-y: auto; flex-grow: 1; }
        
        .report-card { 
            background: #1e293b; border: 1px solid var(--border); border-radius: 15px; 
            padding: 15px; margin-bottom: 15px; transition: 0.3s ease; 
            position: relative; overflow: hidden; 
        }
        .report-card:hover { border-color: var(--accent); transform: scale(1.02); }
        .report-role { color: var(--accent); font-size: 0.7rem; text-transform: uppercase; font-weight: 800; }
        .report-desc { color: var(--text-muted); font-size: 0.85rem; margin: 10px 0; line-height: 1.4; font-style: italic; }
        .report-meta { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; margin-top: 10px; }
        .report-date { font-size: 0.7rem; color: var(--text-muted); }

        .btn-del-report {
            background: transparent; border: none; color: var(--text-muted); 
            font-size: 0.8rem; cursor: pointer; transition: 0.2s;
            display: flex; align-items: center; justify-content: center;
            width: 25px; height: 25px; border-radius: 50%;
        }
        .btn-del-report:hover { color: var(--danger); background: rgba(239, 68, 68, 0.1); }
        .btn-del-report:disabled { opacity: 0.5; cursor: not-allowed; }

        /* CANVAS AREA */
        .canvas-area { grid-row: 2; grid-column: 2; background: #0f172a; position: relative; overflow: hidden; }
        #map { width: 100%; height: 100%; background: #0f172a; position: relative; overflow: hidden; }
        .viewer-content { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
        #pdf-canvas { display: none; }
        #img-view { display: none; max-width: none; max-height: none; }

        /* FLOATING CONTROLS */
        .floating-controls {
            position: absolute; bottom: 30px; right: 30px;
            background: var(--bg-panel); border: 1px solid var(--border);
            border-radius: 50px; padding: 8px 15px; display: flex; gap: 15px; align-items: center;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); color: white;
            z-index: 100; pointer-events: auto;
        }
        .float-btn { background: transparent; border: none; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
        .float-btn:hover { background: rgba(255,255,255,0.1); }

        .badge-read { background: rgba(234, 179, 8, 0.1); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.2); font-weight: 700; }
        
        /* BOTÓN DE ACCIÓN (Estilo Editor) */
        .btn-action { 
            background: var(--primary); color: white; padding: 10px 25px; border-radius: 50px; 
            font-weight: 600; border: none; display: flex; align-items: center; gap: 10px; transition: 0.3s; white-space: nowrap; text-decoration: none; font-size: 0.9rem;
        }
        .btn-action:hover { background: #4f46e5; transform: translateY(-2px); box-shadow: 0 5px 15px rgba(99, 102, 241, 0.3); color: white; }

        .btn-close-custom { 
            width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border); 
            background: transparent; color: var(--danger); display: flex; align-items: center; justify-content: center; 
            text-decoration: none; transition: 0.2s;
        }
        .btn-close-custom:hover { background: var(--danger); color: white; border-color: var(--danger); }
        
        #toast-container { position: absolute; bottom: 80px; left: 30px; z-index: 1100; pointer-events: none; }
        .toast-msg { background: var(--bg-panel); border: 1px solid var(--border); padding: 12px 20px; border-radius: 12px; margin-top: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); color: white; display: flex; align-items: center; gap: 10px; animation: slideIn 0.3s; }
        @keyframes slideIn { from { transform: translateX(-50px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

        /* OVERLAY MÓVIL */
        .sidebar-overlay { 
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            background: rgba(0,0,0,0.5); z-index: 900; backdrop-filter: blur(2px); 
        }
        .mobile-bottom-bar { display: none; }
        .mobile-toggle-header { display: none; background: transparent; border: none; color: white; font-size: 1.2rem; }

        /* --- V8.2 MOBILE HYBRID LAYOUT --- */
        @media (max-width: 991px) {
            .app-container {
                grid-template-columns: 1fr;
                /* Header / Canvas / BottomNav */
                grid-template-rows: 60px 1fr 60px;
            }
            
            /* Header adjustments */
            .app-header { padding: 0 15px; }
            .brand-logo span, .file-info { display: none; }
            .badge-read { display: none; }
            .mobile-toggle-header { display: block; } 

            /* Botón Edit Plan en versión reducida (Círculo) */
            .btn-action { 
                width: 40px; height: 40px; padding: 0; border-radius: 50%; justify-content: center; 
            }
            /* Ocultar texto del botón edit con !important para forzar */
            .btn-action span { display: none !important; }

            /* Sidebar Izquierdo (Sheets) */
            .sidebar-left { 
                position: fixed; top: 0; left: 0; bottom: 0; 
                width: 280px; transform: translateX(-100%); 
                box-shadow: 10px 0 30px rgba(0,0,0,0.5);
                border-right: 1px solid rgba(255,255,255,0.1);
            }
            .sidebar-left.show { transform: translateX(0); }

            /* Sidebar Derecho (History) - Offcanvas desde derecha */
            .sidebar-right {
                position: fixed; top: 0; right: 0; bottom: 0;
                width: 300px; transform: translateX(100%);
                box-shadow: -10px 0 30px rgba(0,0,0,0.5);
                border-left: 1px solid rgba(255,255,255,0.1);
            }
            .sidebar-right.show { transform: translateX(0); }

            .sidebar-overlay.show { display: block; }
            
            .canvas-area { grid-row: 2; grid-column: 1; }
            
            /* Controles Flotantes ajustados al Bottom Bar */
            .floating-controls { 
                bottom: 70px; /* Ajustado para estar justo encima de la barra de 60px */
                right: 15px; 
                padding: 5px 12px;
            } 

            /* Barra Inferior de Navegación */
            .mobile-bottom-bar {
                grid-row: 3; grid-column: 1; background: var(--bg-panel);
                border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-around;
                z-index: 500;
            }
            .nav-icon-btn { color: var(--text-muted); background: none; border: none; font-size: 1.2rem; padding: 10px; width: 100%; }
            .nav-icon-btn.active { color: var(--primary); background: rgba(255,255,255,0.05); }
        }
    </style>
</head>
<body>

<div class="sidebar-overlay" id="sidebarOverlay" onclick="closeAllSidebars()"></div>

<div class="app-container">
    
    <header class="app-header">
        <div class="d-flex align-items-center">
            <a href="<?= $backUrl ?>" class="text-white me-3 d-md-none"><i class="fas fa-chevron-left"></i></a>
            
            <button class="mobile-toggle-header me-2" onclick="toggleSidebar('left')">
                <i class="far fa-file-alt"></i>
            </button>

            <div class="brand-logo">
                <i class="fas fa-bolt text-warning"></i> <span class="d-none d-md-inline ms-2">Brightronix</span>
            </div>
            <div class="file-info d-none d-md-block">
                <small>Viewing Mode</small>
                <span><?= htmlspecialchars($file['filename']) ?></span>
            </div>
            <span class="badge badge-read ms-4 px-3 py-2 d-none d-md-inline"><i class="fas fa-eye me-1"></i> READ ONLY</span>
        </div>

        <div class="d-flex align-items-center gap-2">
            
            <?php if($userRole !== 'viewer'): ?>
                <a href="editor.php?id=<?= $id ?>" class="btn-action">
                    <i class="fas fa-pen"></i>
                    <span class="d-none d-lg-inline">Edit Plan</span>
                </a>
            <?php endif; ?>

            <a href="<?= $backUrl ?>" class="btn-close-custom ms-2">
                <i class="fas fa-times"></i>
            </a>
        </div>
    </header>

    <aside class="sidebar sidebar-left" id="sidebarLeft">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <span class="sidebar-title mb-0"><i class="far fa-file-alt me-2"></i>Sheets</span>
            <button class="btn-close btn-close-white d-md-none" onclick="closeAllSidebars()"></button>
        </div>
        <div id="page-list-container">
            <div class="page-item active">Loading Pages...</div>
        </div>
        
        <div class="mt-auto pt-4 border-top border-secondary">
            <span class="sidebar-title">File Details</span>
            <div class="d-flex justify-content-between small mb-2">
                <span>Format:</span> <span class="text-white fw-bold"><?= strtoupper($fileExt) ?></span>
            </div>
            <div class="d-flex justify-content-between small">
                <span>Last Activity:</span> 
                <span class="text-white"><?= count($reports)>0 ? date('M d, Y', strtotime($reports[0]['created_at'])) : 'Initial upload' ?></span>
            </div>
        </div>
    </aside>

    <main class="canvas-area" id="canvas-wrapper">
        <div id="map">
            <canvas id="pdf-canvas" class="viewer-content"></canvas>
            <img id="img-view" class="viewer-content" alt="Preview">
        </div>
        
        <div class="floating-controls">
            <button class="float-btn text-warning" id="btn-pan" onclick="togglePan()" title="Toggle Pan/Hand"><i class="fas fa-hand-paper"></i></button>
            <div class="border-start border-secondary h-75 mx-2 opacity-50"></div>
            
            <button class="float-btn" onclick="changePage(-1)"><i class="fas fa-chevron-left"></i></button>
            <span class="small fw-bold">Page <span id="p-curr">1</span> / <span id="p-total">--</span></span>
            <button class="float-btn" onclick="changePage(1)"><i class="fas fa-chevron-right"></i></button>
            <div class="border-start border-secondary h-75 mx-2 opacity-50"></div>
            <span class="small text-accent fw-bold" id="zoom-disp">100%</span>
        </div>
    </main>

    <aside class="sidebar sidebar-right" id="sidebarRight">
        <div class="history-header">
            <span><i class="fas fa-history text-accent me-2"></i> Activity Log</span>
            <button class="btn-close btn-close-white d-md-none" onclick="closeAllSidebars()"></button>
        </div>
        <div class="history-list" id="reports-container">
            <?php if(count($reports) > 0): ?>
                <?php foreach($reports as $r): ?>
                <div class="report-card" id="rep-card-<?= $r['id'] ?>">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <div class="d-flex align-items-center gap-2">
                            <span class="fw-bold text-white small"><?= htmlspecialchars($r['technician_name']) ?></span>
                            <?php if($userRole !== 'viewer'): ?>
                                <button class="btn-del-report" onclick="deleteReport(<?= $r['id'] ?>, this)" title="Move to Recycle Bin">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            <?php endif; ?>
                        </div>
                        <span class="report-role"><?= htmlspecialchars($r['technician_role']) ?></span>
                    </div>
                    <div class="report-desc">
                        "<?= htmlspecialchars($r['description']) ?>"
                    </div>
                    <?php
                        $attachments = [];
                        if (!empty($r['attachments_json'])) {
                            $decoded = json_decode($r['attachments_json'], true);
                            if (is_array($decoded)) $attachments = $decoded;
                        }
                    ?>
                    <?php if (!empty($attachments)): ?>
                        <div class="mb-2">
                            <div class="small text-muted mb-1"><i class="fas fa-paperclip me-1"></i>Attachments</div>
                            <div class="d-flex flex-column gap-1">
                                <?php foreach($attachments as $att): ?>
                                    <?php
                                        $attName = $att['name'] ?? 'attachment';
                                        $attPath = $att['path'] ?? '';
                                        $attMime = strtolower((string)($att['mime'] ?? ''));
                                        $attHref = $attPath;
                                        if ($attHref && strpos($attHref, 'uploads/') === 0) $attHref = '../' . $attHref;
                                        $isImage = strpos($attMime, 'image/') === 0;
                                    ?>
                                    <?php if ($attHref): ?>
                                        <a href="<?= htmlspecialchars($attHref) ?>" target="_blank" class="small text-decoration-none">
                                            <?php if ($isImage): ?>
                                                <span class="d-flex align-items-center gap-2">
                                                    <img src="<?= htmlspecialchars($attHref) ?>" alt="<?= htmlspecialchars($attName) ?>" style="width:34px;height:34px;object-fit:cover;border-radius:6px;">
                                                    <span class="text-white"><?= htmlspecialchars($attName) ?></span>
                                                </span>
                                            <?php else: ?>
                                                <span class="text-accent"><i class="fas fa-file me-1"></i><?= htmlspecialchars($attName) ?></span>
                                            <?php endif; ?>
                                        </a>
                                    <?php endif; ?>
                                <?php endforeach; ?>
                            </div>
                        </div>
                    <?php endif; ?>
                    <div class="report-meta">
                        <span class="report-date"><i class="far fa-clock me-1"></i> <?= date('M d, H:i', strtotime($r['created_at'])) ?></span>
                        <?php if($r['report_pdf_path']): ?>
                            <?php
                                $reportPath = $r['report_pdf_path'];
                                if (strpos($reportPath, 'uploads/') === 0) {
                                    $reportExpected = __DIR__ . '/../' . $reportPath;
                                    $reportLegacy = __DIR__ . '/../api/' . $reportPath;
                                    if (!file_exists($reportExpected) && file_exists($reportLegacy)) {
                                        $reportPath = 'api/' . $reportPath;
                                    }
                                }
                                if (strpos($reportPath, 'uploads/') === 0 || strpos($reportPath, 'api/uploads/') === 0) {
                                    $reportPath = '../' . $reportPath;
                                }
                            ?>
                            <a href="<?= htmlspecialchars($reportPath) ?>" target="_blank" class="btn btn-sm btn-outline-success border-0 p-0" title="Download Report">
                                <i class="fas fa-file-pdf fa-lg"></i>
                            </a>
                        <?php endif; ?>
                    </div>
                </div>
                <?php endforeach; ?>
            <?php else: ?>
                <div class="text-center text-muted py-5 px-3">
                    <i class="fas fa-clipboard-check fa-3x mb-3 opacity-25"></i><br>
                    <p class="small">No reports have been generated for this file yet.</p>
                </div>
            <?php endif; ?>
        </div>
    </aside>

    <div class="mobile-bottom-bar">
        <button class="nav-icon-btn" onclick="toggleSidebar('left')">
            <i class="far fa-file-alt"></i>
        </button>
        <button class="nav-icon-btn active">
            <i class="fas fa-eye"></i>
        </button>
        <button class="nav-icon-btn" onclick="toggleSidebar('right')">
            <i class="fas fa-history"></i>
        </button>
    </div>

</div>

<div id="toast-container"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>

<script>
    // --- UI HELPERS (Mobile) ---
    function toggleSidebar(side) {
        closeAllSidebars();
        if(side === 'left') document.getElementById('sidebarLeft').classList.add('show');
        if(side === 'right') document.getElementById('sidebarRight').classList.add('show');
        document.getElementById('sidebarOverlay').classList.add('show');
    }
    
    function closeAllSidebars() {
        document.getElementById('sidebarLeft').classList.remove('show');
        document.getElementById('sidebarRight').classList.remove('show');
        document.getElementById('sidebarOverlay').classList.remove('show');
    }

    // --- SETUP ---
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

    // --- Lightweight Viewer (PDF.js + Image) ---
    const viewer = {
        container: document.getElementById('map'),
        canvas: document.getElementById('pdf-canvas'),
        img: document.getElementById('img-view'),
        mode: null,
        scale: 1,
        minScale: 0.1,
        maxScale: 6,
        translateX: 0,
        translateY: 0,
        naturalW: 0,
        naturalH: 0,
        isPanningMode: false,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        startTx: 0,
        startTy: 0
    };

    function setZoomDisplay() {
        const disp = document.getElementById('zoom-disp');
        if (disp) disp.innerText = Math.round(viewer.scale * 100) + '%';
    }

    function applyTransform() {
        const el = viewer.mode === 'pdf' ? viewer.canvas : viewer.img;
        if (!el) return;
        el.style.transform = `translate(${viewer.translateX}px, ${viewer.translateY}px) scale(${viewer.scale})`;
        setZoomDisplay();
    }

    function fitToContainer() {
        const cw = viewer.container.clientWidth;
        const ch = viewer.container.clientHeight;
        if (!cw || !ch || !viewer.naturalW || !viewer.naturalH) return;

        const scaleX = cw / viewer.naturalW;
        const scaleY = ch / viewer.naturalH;
        viewer.scale = Math.min(scaleX, scaleY);
        viewer.scale = Math.max(viewer.minScale, Math.min(viewer.maxScale, viewer.scale));

        viewer.translateX = Math.round((cw - viewer.naturalW * viewer.scale) / 2);
        viewer.translateY = Math.round((ch - viewer.naturalH * viewer.scale) / 2);
        applyTransform();
    }

    function setMode(mode) {
        viewer.mode = mode;
        viewer.canvas.style.display = mode === 'pdf' ? 'block' : 'none';
        viewer.img.style.display = mode === 'image' ? 'block' : 'none';
    }

    function zoomAt(clientX, clientY, delta) {
        const rect = viewer.container.getBoundingClientRect();
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        const prevScale = viewer.scale;
        const nextScale = Math.max(viewer.minScale, Math.min(viewer.maxScale, viewer.scale * delta));
        if (nextScale === prevScale) return;

        // Mantener el punto bajo el cursor
        const nx = (px - viewer.translateX) / prevScale;
        const ny = (py - viewer.translateY) / prevScale;
        viewer.scale = nextScale;
        viewer.translateX = px - nx * viewer.scale;
        viewer.translateY = py - ny * viewer.scale;
        applyTransform();
    }

    viewer.container.addEventListener('wheel', (e) => {
        if (!viewer.mode) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.1 : 0.9;
        zoomAt(e.clientX, e.clientY, delta);
    }, { passive: false });

    viewer.container.addEventListener('mousedown', (e) => {
        if (!viewer.isPanningMode || !viewer.mode) return;
        viewer.isDragging = true;
        viewer.dragStartX = e.clientX;
        viewer.dragStartY = e.clientY;
        viewer.startTx = viewer.translateX;
        viewer.startTy = viewer.translateY;
        viewer.container.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
        if (!viewer.isDragging) return;
        const dx = e.clientX - viewer.dragStartX;
        const dy = e.clientY - viewer.dragStartY;
        viewer.translateX = viewer.startTx + dx;
        viewer.translateY = viewer.startTy + dy;
        applyTransform();
    });
    window.addEventListener('mouseup', () => {
        viewer.isDragging = false;
        viewer.container.style.cursor = viewer.isPanningMode ? 'grab' : 'default';
    });

    // --- Touch Support (Mobile) ---
    let lastTouchDist = 0;
    let lastTouchCenter = null;

    function getTouchCenter(t1, t2) {
        return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
    }

    function getTouchDistance(t1, t2) {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.hypot(dx, dy);
    }

    viewer.container.addEventListener('touchstart', (e) => {
        if (!viewer.mode) return;
        if (e.touches.length === 1) {
            if (!viewer.isPanningMode) return;
            const t = e.touches[0];
            viewer.isDragging = true;
            viewer.dragStartX = t.clientX;
            viewer.dragStartY = t.clientY;
            viewer.startTx = viewer.translateX;
            viewer.startTy = viewer.translateY;
            viewer.container.style.cursor = 'grabbing';
            e.preventDefault();
        } else if (e.touches.length === 2) {
            lastTouchDist = getTouchDistance(e.touches[0], e.touches[1]);
            lastTouchCenter = getTouchCenter(e.touches[0], e.touches[1]);
            e.preventDefault();
        }
    }, { passive: false });

    viewer.container.addEventListener('touchmove', (e) => {
        if (!viewer.mode) return;
        if (e.touches.length === 1) {
            if (!viewer.isPanningMode || !viewer.isDragging) return;
            const t = e.touches[0];
            const dx = t.clientX - viewer.dragStartX;
            const dy = t.clientY - viewer.dragStartY;
            viewer.translateX = viewer.startTx + dx;
            viewer.translateY = viewer.startTy + dy;
            applyTransform();
            e.preventDefault();
        } else if (e.touches.length === 2) {
            const dist = getTouchDistance(e.touches[0], e.touches[1]);
            const center = getTouchCenter(e.touches[0], e.touches[1]);
            if (lastTouchDist > 0) {
                const scaleDelta = dist / lastTouchDist;
                zoomAt(center.x, center.y, scaleDelta);
            }
            lastTouchDist = dist;
            lastTouchCenter = center;
            e.preventDefault();
        }
    }, { passive: false });

    viewer.container.addEventListener('touchend', (e) => {
        if (e.touches.length === 0) {
            viewer.isDragging = false;
            lastTouchDist = 0;
            lastTouchCenter = null;
            viewer.container.style.cursor = viewer.isPanningMode ? 'grab' : 'default';
        }
    }, { passive: false });

    // VARIABLES
    const fileUrlRaw = "<?= $filePath ?>";
    const fileUrl = encodeURI(fileUrlRaw);
    const fileExt = "<?= $fileExt ?>";
    let allAnnotations = <?= $annotations ?>; 
    if(typeof allAnnotations !== 'object' || allAnnotations === null) allAnnotations = {};

    let pdfDoc = null, pageNum = 1, pdfScale = 2.0; // Scale alto para nitidez en canvas
    
    // --- DELETE REPORT LOGIC ---
    async function deleteReport(reportId, btn) {
        if(!confirm("Are you sure you want to move this report to the Recycle Bin?")) return;
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        const formData = new FormData();
        formData.append('action', 'soft_delete_report');
        formData.append('report_id', reportId);

        try {
            const res = await fetch('../api/api.php', { method: 'POST', body: formData });
            const data = await res.json();
            if(data.status === 'success') {
                const card = document.getElementById('rep-card-' + reportId);
                card.style.transition = 'all 0.4s ease'; card.style.opacity = '0'; card.style.transform = 'translateX(20px)';
                card.style.marginBottom = '0'; card.style.paddingTop = '0'; card.style.paddingBottom = '0';
                card.style.height = card.offsetHeight + 'px'; card.offsetHeight; card.style.height = '0px'; 
                setTimeout(() => { card.remove(); showToast("Report moved to Recycle Bin", "success"); }, 400);
            } else { showToast("Error: " + data.msg, "error"); btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-alt"></i>'; }
        } catch (e) { console.error(e); showToast("Connection error", "error"); btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-alt"></i>'; }
    }

    function showToast(msg, type) {
        const box = document.getElementById('toast-container'); 
        const el = document.createElement('div'); el.className = `toast-msg`;
        el.style.borderLeft = `4px solid ${type==='success'?'#10b981':'#ef4444'}`;
        el.innerHTML = (type==='success'?'<i class="fas fa-check-circle text-success"></i>':'<i class="fas fa-exclamation-circle text-danger"></i>')+`<span>${msg}</span>`;
        box.appendChild(el); setTimeout(() => el.remove(), 4000);
    }

    // Resize
    function resize() { 
        if (viewer.mode) fitToContainer();
    }
    window.addEventListener('resize', resize);
    resize(); 

    // LOAD DOCUMENT
    const imageExts = ['jpg','jpeg','png','gif','webp','bmp','tiff','tif','heic'];

    if(fileExt === 'pdf') {
        setMode('pdf');
        pdfjsLib.getDocument(fileUrl).promise.then(pdf => {
            pdfDoc = pdf; document.getElementById('p-total').textContent = pdf.numPages;
            renderPageList(pdf.numPages); renderPage(pageNum);
        }).catch(err => {
            console.error(err);
            showToast("Error loading PDF", "error");
        });
    } else if (fileExt === 'heic') {
        setMode('image');
        document.getElementById('p-total').textContent = '1'; renderPageList(1);
        fetch(fileUrl).then(res => res.blob()).then(blob => heic2any({ blob, toType: "image/jpeg" })).then(conversionResult => {
            const blob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
            const url = URL.createObjectURL(blob);
            loadSingleImage(url);
        }).catch(e => console.error(e));
    } else if (imageExts.includes(fileExt)) {
        setMode('image');
        document.getElementById('p-total').textContent = '1'; renderPageList(1);
        loadSingleImage(fileUrl);
    } else {
        showToast("Unsupported file type", "error");
    }

    function loadSingleImage(url) {
        // Obtener dimensiones reales de imagen
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() {
            viewer.img.src = url;
            viewer.naturalW = this.width;
            viewer.naturalH = this.height;
            fitToContainer();
            loadPageAnnotations(1);
        }
        img.onerror = function() {
            fetch(url)
                .then(r => r.blob())
                .then(b => {
                    const objUrl = URL.createObjectURL(b);
                    const img2 = new Image();
                    img2.onload = function() {
                        viewer.img.src = objUrl;
                        viewer.naturalW = this.width;
                        viewer.naturalH = this.height;
                        fitToContainer();
                        loadPageAnnotations(1);
                    };
                    img2.src = objUrl;
                })
                .catch(e => console.error(e));
        };
        img.src = url;
    }

    function renderPageList(total) {
        const container = document.getElementById('page-list-container'); container.innerHTML = '';
        for(let i=1; i<=total; i++) {
            const div = document.createElement('div'); div.className = `page-item ${i === pageNum ? 'active' : ''}`;
            div.innerHTML = `<span>Page ${i}</span> <i class="fas fa-chevron-right small opacity-50"></i>`;
            div.onclick = () => jumpToPage(i); div.id = `plist-${i}`; container.appendChild(div);
        }
    }
    function updatePageListUI(curr) {
        document.querySelectorAll('.page-item').forEach(el => el.classList.remove('active'));
        const activeEl = document.getElementById(`plist-${curr}`); if(activeEl) activeEl.classList.add('active');
        document.getElementById('p-curr').innerText = curr;
    }
    async function renderPage(num) {
        if(pdfDoc) {
            const page = await pdfDoc.getPage(num); const viewport = page.getViewport({ scale: pdfScale });
            const canvas = viewer.canvas;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            viewer.naturalW = viewport.width;
            viewer.naturalH = viewport.height;
            fitToContainer();
            loadPageAnnotations(num);
        }
        updatePageListUI(num);
    }
    function changePage(offset) {
        const max = pdfDoc ? pdfDoc.numPages : 1; const newPage = pageNum + offset;
        if(newPage < 1 || newPage > max) return; jumpToPage(newPage);
    }
    function jumpToPage(targetPage) {
        pageNum = targetPage; if(pdfDoc) renderPage(pageNum); else loadPageAnnotations(pageNum);
    }
    
    function loadPageAnnotations(pg) {
        if(allAnnotations[pg]) {
            console.log("TODO: Implementar adaptador Fabric->OL para página " + pg);
            // Aquí irá la lógica de la Fase 2/8
        }
    }

    // --- V8.0: PANNING LOGIC (MANUAL TOGGLE) ---
    function togglePan() {
        viewer.isPanningMode = !viewer.isPanningMode;
        const btn = document.getElementById('btn-pan');
        if(viewer.isPanningMode) {
            btn.classList.add('text-white', 'bg-primary');
            btn.classList.remove('text-warning');
            viewer.container.style.cursor = 'grab';
        } else {
            btn.classList.remove('text-white', 'bg-primary');
            btn.classList.add('text-warning');
            viewer.container.style.cursor = 'default';
        }
    }

</script>
</body>
</html>
