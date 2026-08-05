<?php
// editor.php - Takeoff editor. Runs independently from auth/roles.
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
require_once __DIR__ . '/../core/db/connection.php';

$id = $_GET['id'] ?? 0;

$stmt = $pdo->prepare("SELECT * FROM files WHERE id=?");
$stmt->execute([$id]);
$file = $stmt->fetch(PDO::FETCH_ASSOC);

if(!$file) {
    die("<div style='color:white;text-align:center;padding:50px;font-family:sans-serif;'>Error: File not found. ID: $id</div>");
}

$projectId = $file['project_id'];
$folderId = $file['folder_id'];
$projectDashboardUrl = "project_dashboard.php?id={$projectId}";
$backUrl = $projectDashboardUrl . "&tab=takeoff";
$embedded = ($_GET['embedded'] ?? '') === '1';

$stmtRep = $pdo->prepare("SELECT annotations_json FROM file_reports WHERE file_id=? ORDER BY created_at DESC LIMIT 1");
$stmtRep->execute([$id]);
$lastReport = $stmtRep->fetchColumn();
$annotations = ($lastReport && $lastReport !== 'null') ? $lastReport : '{}';

$fileExt = strtolower(pathinfo($file['filename'], PATHINFO_EXTENSION));
if ($fileExt === '' && !empty($file['file_type'])) {
    $ft = strtolower($file['file_type']);
    if (strpos($ft, '/') !== false) {
        $fileExt = substr($ft, strrpos($ft, '/') + 1);
    } else {
        $fileExt = $ft;
    }
}
$filePath = str_replace('\\', '/', (string)($file['filepath'] ?? ''));
if ($filePath !== '') {
    if (preg_match('~(api/)?uploads/.+$~s', $filePath, $m)) {
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
    $filePath = implode('/', array_map('rawurlencode', explode('/', $filePath)));
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Editor V9.6 | <?= htmlspecialchars($file['filename']) ?></title>
    
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    
    <script src="https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js"></script>

    <link rel="stylesheet" href="../assets/editor/editor.css?v=takeoff-editor-20260611-4">
    <link rel="stylesheet" href="../assets/editor/takeoff.css?v=takeoff-locking-20260804-1">

    <style>
        :root {
            --project-nav-height: <?= $embedded ? '0px' : '48px' ?>;
            --header-height: 60px;
            --sb-right-w: 70px; /* Ancho Desktop */
            --sb-mobile-h: 65px; /* Alto Mobile */
            --bg-dark: #0f172a;
            --border-color: #334155;
        }

        body { overflow: hidden; background: var(--bg-dark); }
        body.embedded-editor .app-container {
            grid-template-columns: 1fr;
            grid-template-rows: 1fr;
            grid-template-areas: "canvas";
        }
        body.embedded-editor .app-header,
        body.embedded-editor .sidebar-right,
        body.embedded-editor .project-flow-nav,
        body.embedded-editor .floating-controls,
        body.embedded-editor .takeoff-panel,
        body.embedded-editor .takeoff-props {
            display: none !important;
        }
        body.embedded-editor .canvas-area {
            grid-area: canvas;
            background: #dfe4ea;
        }

        /* --- LAYOUT GRID (Desktop Default) --- */
        .app-container {
            display: grid;
            height: 100vh;
            width: 100vw;
            grid-template-columns: 1fr var(--sb-right-w); 
            grid-template-rows: var(--project-nav-height) var(--header-height) 1fr;
            grid-template-areas: 
                "projectnav projectnav"
                "header header"
                "canvas right";
        }

        .project-flow-nav {
            grid-area: projectnav;
            z-index: 60;
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 0 16px;
            background: #0b1120;
            border-bottom: 1px solid var(--border-color);
            overflow-x: auto;
            white-space: nowrap;
        }
        .project-flow-nav a {
            display: inline-flex;
            align-items: center;
            height: 100%;
            padding: 0 14px;
            color: rgba(255,255,255,0.68);
            text-decoration: none;
            border-bottom: 2px solid transparent;
            font-size: 0.9rem;
            font-weight: 700;
            transition: color .2s, background .2s, border-color .2s;
        }
        .project-flow-nav a:hover {
            color: #fff;
            background: rgba(255,255,255,0.04);
        }
        .project-flow-nav a.active {
            color: #60a5fa;
            border-bottom-color: #3b82f6;
            background: rgba(59, 130, 246, 0.12);
        }
        .app-header { grid-area: header; z-index: 50; border-bottom: 1px solid var(--border-color); }
        .canvas-area { grid-area: canvas; position: relative; overflow: hidden; background: #343a40; }
        .canvas-area .canvas-container {
            box-shadow: 0 18px 45px rgba(0,0,0,0.34);
        }
        #konva-overlay { position: absolute; inset: 0; z-index: 25; pointer-events: none; }
        .drawing-loading {
            position: absolute;
            inset: 0;
            z-index: 35;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #343a40;
            color: #e2e8f0;
            font-weight: 700;
            letter-spacing: .01em;
        }
        .drawing-loading.hidden {
            display: none;
        }

        /* --- SIDEBAR IZQUIERDA (Overlay Universal) --- */
        .sidebar-left {
            position: fixed !important;
            top: calc(var(--project-nav-height) + var(--header-height)); left: 0; bottom: 0; width: 260px;
            background: var(--bg-dark); border-right: 1px solid var(--border-color);
            z-index: 1000; transform: translateX(-100%);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex; flex-direction: column;
        }
        .sidebar-left.show { transform: translateX(0); }
        .sidebar-overlay {
            position: fixed; top: calc(var(--project-nav-height) + var(--header-height)); left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); z-index: 999; display: none; opacity: 0; transition: opacity 0.3s;
        }
        .sidebar-overlay.show { display: block; opacity: 1; }

        /* --- SIDEBAR DERECHA (Herramientas) --- */
        .sidebar-right {
            grid-area: right;
            border-left: 1px solid var(--border-color);
            background: var(--bg-dark);
            z-index: 40;
            display: flex;
            flex-direction: column; /* Desktop: Vertical */
            align-items: center;
            padding-top: 15px;
            gap: 10px;
        }

        /* --- CONTROLES FLOTANTES (Zoom/Paginas) --- */
        .floating-controls {
            position: absolute;
            bottom: 20px; right: 20px;
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid var(--border-color);
            border-radius: 50px;
            padding: 5px 15px;
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 30;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease; /* TransiciÃ³n suave para ocultar/mostrar */
            color: white;
        }

        .float-btn {
            background: none; border: none; color: white;
            padding: 5px; cursor: pointer; opacity: 0.8;
            transition: opacity 0.2s;
        }
        .float-btn:hover { opacity: 1; }

        /* --- UI ELEMENTS (Botones Icono Grande) --- */
        .toggle-icon-btn {
            background: none !important;
            border: none !important;
            color: rgba(255,255,255,0.7);
            font-size: 1.5rem; /* Icono Grande */
            padding: 0 10px;
            margin-right: 5px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s;
        }
        .toggle-icon-btn:hover, .toggle-icon-btn.active {
            color: #fff;
            text-shadow: 0 0 8px rgba(255,255,255,0.3);
        }

        /* --- STAMP MENU (FIXED POSITION) --- */
        .stamp-menu {
            position: fixed; /* Fix para Mobile overflow */
            z-index: 2000;
            display: none;
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 10px;
            gap: 8px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            backdrop-filter: blur(5px);
        }
        
        .stamp-item {
            padding: 8px 15px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 500;
            transition: background 0.2s;
            color: white;
            white-space: nowrap;
            display: flex;
            align-items: center;
        }
        .stamp-item:hover { background: rgba(255,255,255,0.1); }

        /* Desktop: A la izquierda del sidebar */
        @media (min-width: 992px) {
            .stamp-menu {
                right: 80px; /* 70px sidebar + 10px gap */
                top: 50%;
                transform: translateY(-50%);
                flex-direction: column;
            }
        }

        /* --- BOTÃ“N SAVE (MORADO Y RESPONSIVE) --- */
        #btn-save {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            height: 40px !important;
            padding: 0 20px !important; /* Estilo pÃ­ldora en Desktop */
            border-radius: 50px !important;
            
            /* COLOR MORADO FUERTE */
            background: #8b5cf6 !important; 
            color: white !important;
            border: none;
            
            min-width: unset;
            transition: transform 0.2s, background 0.2s;
            box-shadow: 0 4px 6px rgba(139, 92, 246, 0.25);
        }
        #btn-save:hover { 
            transform: scale(1.05); 
            background: #7c3aed !important; /* Morado un poco mÃ¡s oscuro al pasar mouse */
        }
        #btn-save span { display: inline-block; font-weight: 600; font-size: 0.9rem; }
        #btn-save i { font-size: 1rem; }

        /* --- MOBILE LAYOUT (Responsive) --- */
        @media (max-width: 991px) {
            .app-container {
                grid-template-columns: 1fr; /* Una sola columna */
                grid-template-areas: 
                    "projectnav"
                    "header"
                    "canvas";
            }

            /* Transformar Sidebar Derecho en Barra Inferior */
            .sidebar-right {
                position: fixed;
                bottom: 0; left: 0; right: 0;
                height: var(--sb-mobile-h);
                width: 100%;
                border-left: none;
                border-top: 1px solid var(--border-color);
                flex-direction: row; /* Mobile: Horizontal */
                justify-content: center; /* Centrar herramientas */
                padding-top: 0;
                gap: 15px;
                transform: translateY(100%); /* Oculto por defecto (abajo) */
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                overflow-x: auto; /* Scroll si hay muchas herramientas */
                padding-left: 10px; padding-right: 10px;
            }

            .sidebar-right.show-mobile {
                transform: translateY(0); /* Mostrar al subir */
            }

            /* Fix Stamp Menu Mobile (Arriba de la barra) */
            .stamp-menu {
                bottom: 80px; /* 65px barra + 15px gap */
                left: 50%;
                transform: translateX(-50%);
                flex-direction: row; /* Horizontal en mobile */
                flex-wrap: wrap;
                justify-content: center;
                width: 90%;
                max-width: 350px;
            }

            /* BotÃ³n Save en Mobile: Solo Icono (CÃ­rculo mÃ¡s grande) */
            #btn-save {
                width: 40px !important;
                height: 40px !important;
                padding: 0 !important;
                border-radius: 50% !important;
            }
            /* OCULTAR EL TEXTO "SAVE" EN MOBILE */
            #btn-save span { display: none !important; }

            /* Ajustar controles flotantes en Mobile */
            .floating-controls {
                bottom: 20px; right: 15px; /* Ajuste de posiciÃ³n */
                transform: scale(0.85); /* Reducir tamaÃ±o un 15% */
                transform-origin: bottom right; 
                padding: 4px 12px;
            }

            /* Clase para ocultar los controles cuando sube la barra */
            .floating-controls.hide-ui {
                opacity: 0;
                pointer-events: none;
                transform: translateY(20px) scale(0.85); /* Se desplaza un poco hacia abajo */
            }

            /* Ajustar separadores en horizontal */
            .tool-separator {
                width: 1px; height: 30px; margin: 0 5px;
                border-bottom: none; border-left: 1px solid #475569;
            }
        }

    </style>
</head>
<body class="<?= $embedded ? 'embedded-editor' : '' ?>">

<div class="sidebar-overlay" id="sidebarOverlay" onclick="closeAllOverlays()"></div>

<div class="stamp-menu" id="stamp-menu">
    <div class="stamp-item text-success" onclick="addStamp('APPROVED', '#22c55e')"><i class="fas fa-check-circle me-2"></i>Approved</div>
    <div class="stamp-item text-danger" onclick="addStamp('REJECTED', '#ef4444')"><i class="fas fa-times-circle me-2"></i>Rejected</div>
    <div class="stamp-item text-warning" onclick="addStamp('REVIEW', '#eab308')"><i class="fas fa-exclamation-circle me-2"></i>Review</div>
    <div class="stamp-item text-info" onclick="addStamp('DRAFT', '#3b82f6')"><i class="fas fa-file-alt me-2"></i>Draft</div>
</div>

<div class="app-container">
    <?php if (!$embedded): ?>
    <nav class="project-flow-nav" aria-label="Project navigation">
        <a href="<?= $projectDashboardUrl ?>&tab=overview">Overview</a>
        <a href="<?= $projectDashboardUrl ?>&tab=documents">Documents</a>
        <a href="<?= $projectDashboardUrl ?>&tab=takeoff" class="active" aria-current="page">Takeoff</a>
        <a href="<?= $projectDashboardUrl ?>&tab=estimating">Estimating</a>
        <a href="<?= $projectDashboardUrl ?>&tab=proposal">Proposal</a>
    </nav>
    <?php endif; ?>
    
    <header class="app-header">
        <div class="header-left">
            <a href="<?= $backUrl ?>" class="text-white me-3 d-md-none"><i class="fas fa-chevron-left"></i></a>
            
            <button class="toggle-icon-btn" onclick="toggleSheets()" title="Show Sheets">
                <i class="far fa-file-alt"></i>
            </button>

            <button class="toggle-icon-btn d-lg-none" id="btn-toggle-tools" onclick="toggleMobileTools()" title="Tools">
                <i class="fas fa-tools"></i>
            </button>

            <div class="brand-logo ms-2 me-3">
                <i class="fas fa-bolt text-warning"></i> <span class="d-none d-md-inline">Brightronix</span>
            </div>

            <div class="file-info d-none d-lg-flex">
                <small>Editing File</small>
                <span><?= htmlspecialchars($file['filename']) ?></span>
            </div>
        </div>

        <div class="properties-bar d-none d-md-flex">
            <div id="prop-smart" class="prop-section active">
                <i class="fas fa-mouse-pointer text-accent me-2"></i>
                <span class="text-white small fw-bold">Selection Mode</span>
            </div>
            
            <div id="prop-draw" class="prop-section">
                <span class="prop-label">Color</span>
                <div class="d-flex gap-2 mx-2">
                    <div class="color-dot active" style="background:#ef4444" onclick="setPenColor('#ef4444', this)"></div>
                    <div class="color-dot" style="background:#3b82f6" onclick="setPenColor('#3b82f6', this)"></div>
                    <div class="color-dot" style="background:#22c55e" onclick="setPenColor('#22c55e', this)"></div>
                    <div class="color-dot" style="background:#eab308" onclick="setPenColor('#eab308', this)"></div>
                </div>
                <div class="border-start border-secondary mx-2 h-50"></div>
                <span class="prop-label">Size</span>
                <input type="range" class="form-range" style="width:80px" min="1" max="10" value="3" oninput="setPenWidth(this.value)">
            </div>
            
            <div id="prop-text" class="prop-section">
                <span class="prop-label">Color</span>
                <div class="d-flex gap-2 mx-2" id="text-color-container">
                    <div class="color-dot" data-col="#ef4444" style="background:#ef4444" onclick="setTextFixedColor('#ef4444', this)"></div>
                    <div class="color-dot" data-col="#3b82f6" style="background:#3b82f6" onclick="setTextFixedColor('#3b82f6', this)"></div>
                    <div class="color-dot" data-col="#22c55e" style="background:#22c55e" onclick="setTextFixedColor('#22c55e', this)"></div>
                    <div class="color-dot" data-col="#eab308" style="background:#eab308" onclick="setTextFixedColor('#eab308', this)"></div>
                </div>
                <div class="border-start border-secondary mx-2 h-50"></div>
                <span class="prop-label">Size</span>
                <input type="number" id="text-size-input" class="form-control py-0 px-2 text-center" value="60" min="8" max="100" style="width:60px; height:30px;" onchange="updateTextProp('fontSize', parseInt(this.value))">
            </div>

            <div id="prop-cloud" class="prop-section">
                <span class="prop-label"><i class="fas fa-cloud me-1"></i>Cloud stroke</span>
                <select id="cloud-stroke" class="form-select form-select-sm ms-2" style="width:180px; height:30px;" onchange="setCloudStrokeWidth(this.value)">
                    <option value="1.5">Fina (0.5px)</option>
                    <option value="3" selected>Normal (1px)</option>
                    <option value="6">Gruesa (2px)</option>
                    <option value="9">Extra gruesa (3px)</option>
                </select>
            </div>

            <div id="prop-measure" class="prop-section">
                <span class="prop-label text-success"><i class="fas fa-ruler me-2"></i>Measurement</span>
                <span class="text-white small">Drag nodes to adjust. Dbl-Tap to move.</span>
            </div>
            
            <div id="prop-cal" class="prop-section">
                <span class="prop-label text-warning"><i class="fas fa-ruler-combined me-2"></i>Calibration in ft</span>
                <div id="cal-mode-wrap" class="align-items-center gap-2 ms-2 d-flex">
                    <select id="cal-mode" class="form-select form-select-sm" style="width:110px; height:30px;" onchange="setCalMode(this.value)">
                        <option value="manual">Manual</option>
                        <option value="preset" selected>Preset</option>
                    </select>
                    <select id="cal-preset" class="form-select form-select-sm" style="width:190px; height:30px;" onchange="applyScalePreset(this.value)">
                        <option value="">Preset scale...</option>
                    </select>
                </div>
                <div id="cal-actions" style="display:none;" class="align-items-center gap-2 ms-2">
                    <input type="number" id="cal-val" class="form-control py-0 px-2" placeholder="ft" style="width:60px; height:30px;" min="0.1" step="0.1">
                    <button class="btn btn-sm btn-success rounded-circle" style="width:30px;height:30px" onclick="finishCal(true)"><i class="fas fa-check"></i></button>
                    <button class="btn btn-sm btn-secondary rounded-circle" style="width:30px;height:30px" onclick="finishCal(false)"><i class="fas fa-times"></i></button>
                    <button class="btn btn-sm btn-danger rounded-circle ms-2" id="btn-del-cal" style="display:none; width:30px;height:30px" onclick="clearCalLine()" title="Delete Line"><i class="fas fa-trash"></i></button>
                </div>
                <span id="cal-hint" class="text-main small ms-2">Draw a known line...</span>
            </div>

            <div id="scale-display-wrap" class="prop-section active">
                <span class="prop-label text-warning">Scale</span>
                <span id="scale-display" class="text-white small fw-bold ms-2">--</span>
            </div>
        </div>

        <div class="header-right">
            <button class="btn btn-outline-danger rounded-circle d-inline-flex align-items-center justify-content-center" 
                    id="btn-delete-selection" 
                    style="width:35px;height:35px;border-color:var(--danger);" 
                    onclick="deleteSelected()" 
                    title="Delete Selected">
                <i class="fas fa-trash"></i>
            </button>

            <div class="d-flex gap-1 ms-2">
                <button class="btn btn-outline-light rounded-circle" id="btn-undo" style="width:35px;height:35px;border-color:var(--border);" onclick="undo()" title="Undo"><i class="fas fa-undo"></i></button>
                <button class="btn btn-outline-light rounded-circle" id="btn-redo" style="width:35px;height:35px;border-color:var(--border);" onclick="redo()" title="Redo"><i class="fas fa-redo"></i></button>
            </div>
            
            <button class="btn-action" id="btn-save" onclick="openReportModal()" title="Save and Report">
                <i class="fas fa-save"></i> <span>Save</span>
            </button>
            
            <a href="<?= $backUrl ?>" class="btn-close-custom d-none d-md-flex">
                <i class="fas fa-times"></i>
            </a>
        </div>
    </header>

    <aside class="sidebar-left" id="sidebarLeft">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <span class="sidebar-title mb-0"><i class="far fa-file-alt me-2"></i>Sheets</span>
            <button class="btn-close btn-close-white" onclick="toggleSheets()"></button>
        </div>

        <div id="page-list-container">
            <div class="page-item active">Loading Pages...</div>
        </div>
        
        <div class="mt-auto pt-4 border-top border-secondary">
            <span class="sidebar-title">Details</span>
            <div class="d-flex justify-content-between small mb-2">
                <span>Format:</span> <span class="text-white"><?= strtoupper($fileExt) ?></span>
            </div>
            <div class="d-flex justify-content-between small mb-2">
                <span>Uploaded:</span> <span class="text-white"><?= date('M d', strtotime($file['uploaded_at'])) ?></span>
            </div>
        </div>
    </aside>

    <main class="canvas-area" id="canvas-wrapper">
        <canvas id="c"></canvas>
        <div id="konva-overlay"></div>
        <div class="drawing-loading" id="drawingLoading">
            <span><i class="fas fa-spinner fa-spin me-2"></i>Loading drawing...</span>
        </div>
        
        <div class="floating-controls">
            <button class="float-btn" onclick="changePage(-1)"><i class="fas fa-chevron-left"></i></button>
            <span class="small fw-bold"><span id="p-curr">1</span>/<span id="p-total">-</span></span>
            <button class="float-btn" onclick="changePage(1)"><i class="fas fa-chevron-right"></i></button>
            <div class="border-start border-secondary h-75 mx-2 opacity-50"></div>
            <span class="small text-accent fw-bold" id="zoom-disp">100%</span>
        </div>
    </main>

    <aside class="sidebar-right" id="sidebarRight">
        <button class="tool-btn active" id="btn-smart" onclick="setMode('smart')" title="Pointer"><i class="fas fa-mouse-pointer"></i></button>
        <button class="tool-btn" id="btn-draw" onclick="setMode('draw')" title="Pen Tool"><i class="fas fa-pencil-alt"></i></button>
        <button class="tool-btn" id="btn-text" onclick="addText()" title="Add Text"><i class="fas fa-font"></i></button>
        <button class="tool-btn" id="btn-cloud" onclick="addCloud()" title="Cloud Mark"><i class="fas fa-cloud"></i></button>
        
        <button class="tool-btn" id="btn-stamp" onclick="toggleStampMenu()" title="Stamps"><i class="fas fa-stamp"></i></button>
        
        <div class="tool-separator"></div>
        <button class="tool-btn" id="btn-measure" onclick="setMode('measure')" title="Ruler"><i class="fas fa-ruler"></i></button>
        <button class="tool-btn text-warning" id="btn-cal" onclick="setMode('cal')" title="Calibrate"><i class="fas fa-ruler-combined"></i></button>
    </aside>

</div>

<div class="modal fade" id="mobileCalModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content p-2">
            <div class="modal-header">
                <h6 class="modal-title fw-bold"><i class="fas fa-ruler-combined text-warning me-2"></i>Plan Scale</h6>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <label class="form-label small mb-1">Mode</label>
                <select id="mobile-cal-mode" class="form-select form-select-sm mb-2" onchange="mobileCalModeChanged(this.value)">
                    <option value="manual">Manual</option>
                    <option value="preset">Preset</option>
                </select>

                <div id="mobile-cal-preset-wrap" class="mb-2">
                    <label class="form-label small mb-1">Preset scale</label>
                    <select id="mobile-cal-preset" class="form-select form-select-sm" onchange="mobileCalPresetChanged(this.value)">
                        <option value="">Preset scale...</option>
                    </select>
                </div>

                <div id="mobile-cal-manual-wrap" class="mb-2 d-none">
                    <label class="form-label small mb-1">Distance (ft)</label>
                    <input type="number" id="mobile-cal-val" class="form-control form-control-sm" min="0.1" step="0.1" placeholder="e.g. 10">
                    <div class="small text-muted mt-1">Draw a known line on the plan, then apply.</div>
                </div>

                <div class="small text-muted">Current scale: <span id="mobile-cal-current">--</span></div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Close</button>
                <button type="button" class="btn btn-sm btn-success" onclick="mobileApplyManualCal()">Apply</button>
            </div>
        </div>
    </div>
</div>

<div class="modal fade" id="reportModal" data-bs-backdrop="static" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content p-3">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Save Field Report</h5>
                <button type="button" class="btn btn-outline-danger rounded-circle d-flex align-items-center justify-content-center p-0" data-bs-dismiss="modal" style="width: 30px; height: 30px; border-width: 2px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="mb-3">
                    <label class="form-label small fw-bold">Technician Name</label>
                    <input type="text" id="rep-name" class="form-control" value="<?= htmlspecialchars($_SESSION['username'] ?? 'Takeoff') ?>">
                </div>
                <div class="mb-3">
                    <label class="form-label small fw-bold">Role / Title</label>
                    <input type="text" id="rep-role" class="form-control" value="<?= htmlspecialchars($_SESSION['role'] ?? 'Estimator') ?>">
                </div>
                <div class="mb-3">
                    <label class="form-label small fw-bold">Activity Description</label>
                    <textarea id="rep-desc" class="form-control" rows="3" placeholder="e.g. Added conduit path to room 102..."></textarea>
                </div>

                <div class="mb-2">
                    <label class="form-label small fw-bold">Attachments</label>
                    <div id="rep-attach-dropzone" class="border rounded-3 p-3 text-center" style="border-style:dashed !important; border-color:#475569 !important; background:#0f172a;">
                        <div class="small text-muted mb-2"><i class="fas fa-paperclip me-1"></i>Drag &amp; drop files here or</div>
                        <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('rep-attachments').click()">Browse files</button>
                        <input type="file" id="rep-attachments" class="d-none" multiple>
                        <div class="small text-muted mt-2">Accepted: Images, PDF, DOC, XLS</div>
                        <div class="small text-muted">Max: 10MB per file · Up to 5 files</div>
                    </div>
                    <div id="rep-attachments-preview" class="mt-2 d-flex flex-column gap-2"></div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-action" id="btn-generate" onclick="submitReport()">
                    <i class="fas fa-check"></i> Generate Report
                </button>
            </div>
        </div>
    </div>
</div>

<div id="toast-container"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/konva@9.3.3/konva.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>

<script>
    // --- UI HELPERS ---
    
    // Toggle Sidebar Izquierda (Sheets)
    function toggleSheets() {
        document.getElementById('sidebarLeft').classList.toggle('show');
        updateOverlay();
        // Cerrar herramientas si abrimos sheets
        closeTools();
    }

    // Toggle Herramientas (Mobile)
    function toggleMobileTools() {
        const sbRight = document.getElementById('sidebarRight');
        const btn = document.getElementById('btn-toggle-tools');
        const floatControls = document.querySelector('.floating-controls'); // SelecciÃ³n de controles flotantes

        sbRight.classList.toggle('show-mobile');
        btn.classList.toggle('active');
        
        // Logica para ocultar controles flotantes
        if (sbRight.classList.contains('show-mobile')) {
            if(floatControls) floatControls.classList.add('hide-ui');
        } else {
            if(floatControls) floatControls.classList.remove('hide-ui');
        }

        // Cerrar sheets si abrimos herramientas
        document.getElementById('sidebarLeft').classList.remove('show');
        updateOverlay();
    }

    function closeTools() {
        document.getElementById('sidebarRight').classList.remove('show-mobile');
        document.getElementById('btn-toggle-tools').classList.remove('active');
        
        // Mostrar de nuevo los controles flotantes si se cerrÃ³ la barra
        const floatControls = document.querySelector('.floating-controls');
        if(floatControls) floatControls.classList.remove('hide-ui');
    }

    function updateOverlay() {
        const overlay = document.getElementById('sidebarOverlay');
        const sheetsOpen = document.getElementById('sidebarLeft').classList.contains('show');
        if(sheetsOpen) overlay.classList.add('show'); else overlay.classList.remove('show');
    }

    function closeAllOverlays() {
        document.getElementById('sidebarLeft').classList.remove('show');
        updateOverlay();
    }

    function openMobileCalModal() {
        if (window.innerWidth > 991) return;
        const desktopMode = document.getElementById('cal-mode');
        const desktopPreset = document.getElementById('cal-preset');
        const mMode = document.getElementById('mobile-cal-mode');
        const mPreset = document.getElementById('mobile-cal-preset');
        const mCurrent = document.getElementById('mobile-cal-current');

        if (desktopMode && mMode) mMode.value = desktopMode.value || 'preset';

        if (desktopPreset && mPreset) {
            mPreset.innerHTML = desktopPreset.innerHTML;
            mPreset.value = desktopPreset.value || '';
        }

        const scaleText = (document.getElementById('scale-display')?.textContent || '--').trim();
        if (mCurrent) mCurrent.textContent = scaleText || '--';

        mobileCalModeChanged(mMode ? mMode.value : 'preset');
        new bootstrap.Modal(document.getElementById('mobileCalModal')).show();
    }

    function mobileCalModeChanged(mode) {
        const desktopMode = document.getElementById('cal-mode');
        if (desktopMode) desktopMode.value = mode;
        setCalMode(mode);

        document.getElementById('mobile-cal-preset-wrap')?.classList.toggle('d-none', mode !== 'preset');
        document.getElementById('mobile-cal-manual-wrap')?.classList.toggle('d-none', mode !== 'manual');
    }

    function mobileCalPresetChanged(value) {
        const desktopPreset = document.getElementById('cal-preset');
        if (desktopPreset) desktopPreset.value = value;
        applyScalePreset(value);
        const scaleText = (document.getElementById('scale-display')?.textContent || '--').trim();
        const mCurrent = document.getElementById('mobile-cal-current');
        if (mCurrent) mCurrent.textContent = scaleText || '--';
    }

    function mobileApplyManualCal() {
        const v = document.getElementById('mobile-cal-val')?.value;
        const desktopVal = document.getElementById('cal-val');
        if (desktopVal) desktopVal.value = v || '';
        finishCal(true);
        const scaleText = (document.getElementById('scale-display')?.textContent || '--').trim();
        const mCurrent = document.getElementById('mobile-cal-current');
        if (mCurrent) mCurrent.textContent = scaleText || '--';
    }

    // --- SETUP ---
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

    // SERVER VARIABLES
    const fileUrl = "<?= $filePath ?>";
    const fileExt = "<?= $fileExt ?>"; 
    const fileId = <?= $id ?>;
    const projectId = <?= (int)$projectId ?>;
    let allAnnotations = <?= $annotations ?>;
    if(typeof allAnnotations !== 'object' || allAnnotations === null) allAnnotations = {};

    const draftAnnotationsKey = `ep_annotations_draft_file_${fileId}`;
    function loadDraftAnnotations() {
        try {
            const raw = localStorage.getItem(draftAnnotationsKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                allAnnotations = { ...allAnnotations, ...parsed };
            }
        } catch (e) {
            console.warn('Draft annotations could not be loaded', e);
        }
    }
    function persistDraftAnnotations() {
        try {
            localStorage.setItem(draftAnnotationsKey, JSON.stringify(allAnnotations));
        } catch (e) {
            console.warn('Draft annotations could not be saved', e);
        }
    }
    loadDraftAnnotations();

    // FABRIC INIT
    let canvas = new fabric.Canvas('c', { 
        preserveObjectStacking: true,
        fireRightClick: true,  
        stopContextMenu: true,
        allowTouchScrolling: false,
        renderOnAddRemove: true, // Mantener renderizado automÃ¡tico
        stateful: false // OptimizaciÃ³n de rendimiento
    });
    const useKonvaRuler = true;
    const konvaOverlay = document.getElementById('konva-overlay');
    let konvaStage = null;
    let konvaLayer = null;
    let konvaRulers = [];
    let konvaNotes = [];
    let konvaClouds = [];
    const konvaRulersByPage = {};
    let konvaTransformer = null;
    let konvaEditingTextarea = null;
    let konvaSelectedNote = null;
    let konvaSelectedNode = null;
    let konvaDrawing = null;
    let konvaIsPanning = false;
    let konvaPanMode = false;
    let konvaTemporaryPan = false;
    const isMobileViewport = window.innerWidth <= 768;
    const dpr = window.devicePixelRatio || 1;
    const PDF_PADDING = isMobileViewport ? 18 : 36;
    const MAX_PDF_RENDER_SCALE = 6;
    let pdfDoc = null, pageNum = 1;
    let pdfWorldWidth = 0;
    let pdfWorldHeight = 0;
    let pdfFitZoom = 1;
    let currentPdfRenderZoom = 0;
    let currentPdfRenderScale = 0;
    let renderToken = 0;
    let activePdfRenderTask = null;
    let pdfRerenderTimer = null;
    let zoomNotificationFrame = null;
    let pendingZoomNotification = null;
    const pdfBitmapCache = new Map();
    const PDF_BITMAP_CACHE_LIMIT = 8;
    const drawingLoading = document.getElementById('drawingLoading');

    function notifyTakeoffZoomChanged(source = 'editor') {
        const zoom = Number(canvas?.getZoom?.() || 1);
        const percent = Math.round(zoom * 100);
        const zoomEl = document.getElementById('zoom-disp');
        if (zoomEl) zoomEl.innerText = percent + '%';
        pendingZoomNotification = { zoom, percent, source };
        if (zoomNotificationFrame !== null) return;
        zoomNotificationFrame = requestAnimationFrame(() => {
            zoomNotificationFrame = null;
            const payload = pendingZoomNotification;
            pendingZoomNotification = null;
            try {
                window.parent?.postMessage({ type: 'project-takeoff-zoom-changed', payload }, '*');
            } catch (e) {}
        });
    }
    window.notifyTakeoffZoomChanged = notifyTakeoffZoomChanged;

    // STATES
    let pixelsPerFoot = 0;
    let currentMode = 'smart';
    let pendingPlacementTool = null;
    let pendingPlacementStart = null;
    let pendingPlacementPreview = null;
    let lineState = 0, activeLine = null, startPoint = null;
    let calLineObject = null; 
    let calMode = 'preset';
    let cloudStrokeWidth = 3; // default actual behavior

    // Calibration Persistence
    function getCalKey(suffix) {
        return `cal_${suffix}_file_${fileId}_page_${pageNum}`;
    }

    function getLegacyCalKey(suffix) {
        return `cal_${suffix}_file_${fileId}`;
    }

    function loadCalibrationForPage(showNotice) {
        try {
            let savedCal = localStorage.getItem(getCalKey('data'));
            if (savedCal === null) savedCal = localStorage.getItem(getLegacyCalKey('data'));
            if (savedCal && !isNaN(parseFloat(savedCal))) {
                pixelsPerFoot = parseFloat(savedCal);
                if (showNotice) setTimeout(() => showToast("Saved calibration loaded", "success"), 800);
            } else {
                pixelsPerFoot = 0;
            }
        } catch(e) { console.error("Storage error:", e); pixelsPerFoot = 0; }
        loadScaleDisplay();
    }

    function setScaleDisplay(text) {
        const el = document.getElementById('scale-display');
        if (el) el.textContent = text || '';
    }

    function keepScaleDisplayVisible() {
        const wrap = document.getElementById('scale-display-wrap');
        if (wrap) wrap.classList.add('active');
    }

    function loadScaleDisplay() {
        let savedLabel = localStorage.getItem(getCalKey('scale_label'));
        if (!savedLabel) savedLabel = localStorage.getItem(getLegacyCalKey('scale_label'));
        if (savedLabel) {
            setScaleDisplay(savedLabel);
        } else {
            setScaleDisplay('');
        }
    }

    function getActiveScaleLabel() {
        const el = document.getElementById('scale-display');
        return (el?.textContent || '').trim();
    }

    function gcd(a, b) {
        let x = Math.abs(a);
        let y = Math.abs(b);
        while (y) {
            const t = y;
            y = x % y;
            x = t;
        }
        return x || 1;
    }

    function getArchitecturalInchStep(scaleLabel) {
        const parsed = parseScaleLabel(scaleLabel || '');
        if (!parsed) return 1 / 16;

        // Civil scales (ej. 1" = 10') se muestran en pies enteros
        if (parsed.feet > 1) return null;

        const inchesPerFoot = parsed.inches;
        if (inchesPerFoot <= (1 / 8)) return 1;      // 1/8" o menor -> 1"
        if (inchesPerFoot <= (1 / 4)) return 1 / 2;  // 3/16", 1/4" -> 1/2"
        if (inchesPerFoot <= (1 / 2)) return 1 / 4;  // 3/8", 1/2" -> 1/4"
        if (inchesPerFoot < 1) return 1 / 8;         // 3/4" -> 1/8"
        return 1 / 16;                                // 1" o mayor -> 1/16"
    }

    function formatFeetForDisplay(feetDecimal) {
        if (!isFinite(feetDecimal)) return '--';

        const step = getArchitecturalInchStep(getActiveScaleLabel());

        // Civil: solo pies enteros redondeados
        if (step === null) {
            return `${Math.round(feetDecimal)}'`;
        }

        let feetWhole = Math.floor(feetDecimal);
        let inches = (feetDecimal - feetWhole) * 12;
        inches = Math.round(inches / step) * step;

        if (inches >= 12 - 1e-9) {
            feetWhole += 1;
            inches = 0;
        }

        let wholeInches = Math.floor(inches + 1e-9);
        const frac = inches - wholeInches;

        if (frac < 1e-9) {
            return `${feetWhole}' ${wholeInches}"`;
        }

        let den = Math.round(1 / step);
        let num = Math.round(frac * den);

        if (num === den) {
            wholeInches += 1;
            num = 0;
        }
        if (wholeInches >= 12) {
            feetWhole += 1;
            wholeInches = 0;
        }
        if (num === 0) {
            return `${feetWhole}' ${wholeInches}"`;
        }

        const factor = gcd(num, den);
        num /= factor;
        den /= factor;

        return `${feetWhole}' ${wholeInches} ${num}/${den}"`;
    }

    // --- SCALE PRESETS ---
    const RAW_SCALE_PRESETS = [
        { category: 'Architectural', label: '1/128" = 1\'' },
        { category: 'Architectural', label: '1/64" = 1\'' },
        { category: 'Architectural', label: '1/32" = 1\'' },
        { category: 'Architectural', label: '1/16" = 1\'' },
        { category: 'Architectural', label: '3/32" = 1\'' },
        { category: 'Architectural', label: '1/8" = 1\'' },
        { category: 'Architectural', label: '3/16" = 1\'' },
        { category: 'Architectural', label: '1/4" = 1\'' },
        { category: 'Architectural', label: '3/8" = 1\'' },
        { category: 'Architectural', label: '1/2" = 1\'' },
        { category: 'Architectural', label: '3/4" = 1\'' },
        { category: 'Architectural', label: '1" = 1\'' },
        { category: 'Architectural', label: '1 1/2" = 1\'' },
        { category: 'Architectural', label: '3" = 1\'' },
        { category: 'Civil', label: '1" = 10\'' },
        { category: 'Civil', label: '1" = 20\'' },
        { category: 'Civil', label: '1" = 30\'' },
        { category: 'Civil', label: '1" = 40\'' },
        { category: 'Civil', label: '1" = 50\'' },
        { category: 'Civil', label: '1" = 60\'' },
        { category: 'Civil', label: '1" = 70\'' },
        { category: 'Civil', label: '1" = 80\'' },
        { category: 'Civil', label: '1" = 90\'' },
        { category: 'Civil', label: '1" = 100\'' },
        { category: 'Civil', label: '1" = 300\'' },
        { category: 'Civil', label: '1" = 500\'' },
        { category: 'Civil', label: '1" = 1000\'' }
    ];

    function parseFraction(value) {
        const match = value.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
        if (!match) return NaN;
        const numerator = parseFloat(match[1]);
        const denominator = parseFloat(match[2]);
        if (!isFinite(numerator) || !isFinite(denominator) || denominator === 0) return NaN;
        return numerator / denominator;
    }

    function parseMixedNumber(value) {
        const parts = value.trim().split(/\s+/);
        if (parts.length === 1) {
            if (parts[0].includes('/')) return parseFraction(parts[0]);
            return parseFloat(parts[0]);
        }
        if (parts.length === 2) {
            const whole = parseFloat(parts[0]);
            const fraction = parseFraction(parts[1]);
            if (!isFinite(whole) || !isFinite(fraction)) return NaN;
            return whole + fraction;
        }
        return NaN;
    }

    function parseScaleLabel(label) {
        const match = label.match(/^(.+)"\s*=\s*(.+)'$/);
        if (!match) return null;
        const inches = parseMixedNumber(match[1].trim());
        const feet = parseMixedNumber(match[2].trim());
        if (!isFinite(inches) || !isFinite(feet) || inches <= 0 || feet <= 0) return null;
        return { inches, feet, feetPerInch: feet / inches };
    }

    function buildScalePresets() {
        const presets = [];
        RAW_SCALE_PRESETS.forEach(raw => {
            const parsed = parseScaleLabel(raw.label);
            if (!parsed || !isFinite(parsed.feetPerInch) || parsed.feetPerInch <= 0) {
                console.warn("Invalid scale preset:", raw);
                return;
            }
            presets.push({ ...raw, ...parsed });
        });
        return presets;
    }

    const SCALE_PRESETS = buildScalePresets();

    function populateScalePresets() {
        const select = document.getElementById('cal-preset');
        if (!select) return;
        SCALE_PRESETS.forEach((preset, index) => {
            let group = select.querySelector(`optgroup[label="${preset.category}"]`);
            if (!group) {
                group = document.createElement('optgroup');
                group.label = preset.category;
                select.appendChild(group);
            }
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = preset.label;
            group.appendChild(option);
        });
    }

    async function getPdfPixelsPerInch() {
        if (!pdfDoc) return null;
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        if (!viewport.width) return null;
        return 72;
    }

    async function applyScalePreset(value) {
        if (!value) return;
        const index = parseInt(value, 10);
        const preset = SCALE_PRESETS[index];
        if (!preset) { showToast("Invalid preset", "error"); return; }
        const pixelsPerInch = await getPdfPixelsPerInch();
        if (!pixelsPerInch) { showToast("Scale presets require a PDF background", "error"); return; }
        const nextPixelsPerFoot = pixelsPerInch / preset.feetPerInch;
        if (!isFinite(nextPixelsPerFoot) || nextPixelsPerFoot <= 0) { showToast("Invalid preset calculation", "error"); return; }
        pixelsPerFoot = nextPixelsPerFoot;
        localStorage.setItem(getCalKey('data'), pixelsPerFoot);
        localStorage.setItem(getCalKey('scale_label'), preset.label);
        setScaleDisplay(preset.label);
        showToast(`Calibrated! 1 ft = ${pixelsPerFoot.toFixed(2)} px`, "success");
        refreshMeasureLabels();
    }

    function resetScalePresetSelection() {
        const preset = document.getElementById('cal-preset');
        if (preset) preset.value = '';
    }

    function updateCalHint() {
        const hint = document.getElementById('cal-hint');
        if (!hint) return;
        hint.textContent = (calMode === 'preset') ? 'Select a preset scale...' : 'Draw a known line...';
    }

    function setCalMode(mode) {
        calMode = (mode === 'preset') ? 'preset' : 'manual';
        const modeSelect = document.getElementById('cal-mode');
        if (modeSelect) modeSelect.value = calMode;
        const preset = document.getElementById('cal-preset');
        if (preset) preset.disabled = (calMode !== 'preset');
        const actions = document.getElementById('cal-actions');
        if (actions) {
            actions.style.display = (calMode === 'manual' && calLineObject) ? 'flex' : 'none';
        }
        const btnDel = document.getElementById('btn-del-cal');
        if (btnDel) btnDel.style.display = (calMode === 'manual' && calLineObject) ? 'inline-block' : 'none';
        if (calMode !== 'preset') resetScalePresetSelection();
        updateCalHint();
        keepScaleDisplayVisible();
    }

    function refreshMeasureLabels() {
        canvas.getObjects().forEach(obj => {
            if (obj.isMeasureLine && obj.label) updateMeasureLabel(obj);
        });
        if (useKonvaRuler) {
            konvaRulers.forEach(r => updateKonvaLabel(r));
            syncKonvaToFabric();
        }
        canvas.requestRenderAll();
    }

    function syncCloudStrokeControl(value = cloudStrokeWidth) {
        const ctrl = document.getElementById('cloud-stroke');
        if (ctrl) ctrl.value = String(value);
    }

    function setCloudStrokeWidth(value) {
        const next = parseFloat(value);
        if (!isFinite(next) || next <= 0) return;
        cloudStrokeWidth = next;
        syncCloudStrokeControl(cloudStrokeWidth);

        if (konvaSelectedNode?.type === 'cloud' && konvaSelectedNode.ref?.shape) {
            konvaSelectedNode.ref.shape.strokeWidth(cloudStrokeWidth);
            if (konvaLayer) konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
        }
    }

    function runScalePresetSelfCheck() {
        const cases = [
            { label: '1/8" = 1\'', expected: 8 },
            { label: '1 1/2" = 1\'', expected: 1 / 1.5 },
            { label: '1" = 500\'', expected: 500 }
        ];
        return cases.map(testCase => {
            const parsed = parseScaleLabel(testCase.label);
            const actual = parsed ? parsed.feetPerInch : null;
            const ok = parsed ? Math.abs(actual - testCase.expected) < 1e-6 : false;
            return { label: testCase.label, feetPerInch: actual, ok };
        });
    }

    window.__scalePresetSelfCheck = runScalePresetSelfCheck;
    populateScalePresets();
    setCalMode(calMode);
    loadCalibrationForPage(true);
    keepScaleDisplayVisible();
    syncCloudStrokeControl();

    // HISTORY
    const MAX_HISTORY = 21;
    let undoStack = [];
    let historyIndex = -1;  
    let historyProcessing = false; 

    window.addEventListener('contextmenu', e => e.preventDefault());

    function resize() {
        const w = document.getElementById('canvas-wrapper');
        if(w && w.clientWidth > 0 && w.clientHeight > 0) {
            canvas.setWidth(w.clientWidth);
            canvas.setHeight(w.clientHeight);
        }
        if (konvaStage && w) {
            konvaStage.width(w.clientWidth);
            konvaStage.height(w.clientHeight);
            konvaStage.draw();
        }
        if (pdfDoc && pdfWorldWidth && pdfWorldHeight) {
            fitPdfToView(false);
            schedulePdfRerender();
        }
    }
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 120);
    });
    // The wrapper can still be at 0x0 here if this editor is embedded in a tab/panel
    // that hasn't been made visible by the parent page yet, so poll instead of a single check.
    waitForWrapperSize();
    window.addEventListener('message', event => {
        if (!event.data || event.data.type !== 'takeoff-visible') return;
        resize();
        if (pdfDoc && !canvas.backgroundImage) {
            renderPage(pageNum, true);
        } else if (pdfDoc) {
            fitPdfToView(false);
            schedulePdfRerender();
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            resize();
            if (pdfDoc) schedulePdfRerender();
        }
    });

    function setKonvaActive(active) {
        if (!konvaOverlay) return;
        konvaOverlay.style.pointerEvents = active ? 'auto' : 'none';
        konvaOverlay.style.display = 'block';
        if (active) syncKonvaToFabric();
    }

    function getFabricVpt() {
        const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        return { scaleX: vpt[0], scaleY: vpt[3], translateX: vpt[4], translateY: vpt[5] };
    }

    function screenToWorld(pos) {
        const vpt = getFabricVpt();
        return {
            x: (pos.x - vpt.translateX) / vpt.scaleX,
            y: (pos.y - vpt.translateY) / vpt.scaleY
        };
    }

    function syncKonvaToFabric() {
        if (!konvaLayer) return;
        const vpt = getFabricVpt();
        konvaLayer.position({ x: vpt.translateX, y: vpt.translateY });
        konvaLayer.scale({ x: vpt.scaleX, y: vpt.scaleY });
        const invScale = vpt.scaleX ? 1 / vpt.scaleX : 1;
        konvaRulers.forEach(r => {
            r.line.strokeWidth(4 * invScale);
            r.a1.radius(6 * invScale);
            r.a2.radius(6 * invScale);
            r.label.fontSize(16 * invScale);
            r.label.padding(4 * invScale);
        });
        window.syncTakeoffInteractionScale?.(invScale);
        konvaLayer.batchDraw();
    }

    function updateKonvaLabel(r) {
        const p1 = r.a1.position();
        const p2 = r.a2.position();
        const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        let textVal = "";
        if (pixelsPerFoot > 0) {
            const feet = distPx / pixelsPerFoot;
            textVal = formatFeetForDisplay(feet);
        } else {
            textVal = Math.round(distPx) + " px";
        }
        r.label.text(textVal);
        const vpt = getFabricVpt();
        const invScale = vpt.scaleX ? 1 / vpt.scaleX : 1;
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2 - (15 * invScale);
        r.label.position({ x: midX, y: midY });
    }

    function serializeKonvaForPage(pg) {
        const notes = konvaNotes
            .filter(n => n.page === pg)
            .map(n => ({ x: n.group.x(), y: n.group.y(), text: n.label.text(), fill: n.label.fill(), fontSize: n.label.fontSize() }));
        const rulers = konvaRulers
            .filter(r => r.page === pg)
            .map(r => ({ p1: r.a1.position(), p2: r.a2.position() }));
        const clouds = konvaClouds
            .filter(c => c.page === pg)
            .map(c => ({
                x: c.group.x(),
                y: c.group.y(),
                scaleX: c.group.scaleX(),
                scaleY: c.group.scaleY(),
                strokeWidth: c.shape ? c.shape.strokeWidth() : cloudStrokeWidth
            }));
        return { notes, rulers, clouds };
    }

    function clearKonvaPage(pg) {
        konvaNotes.filter(n => n.page === pg).forEach(n => n.group.destroy());
        konvaRulers.filter(r => r.page === pg).forEach(r => r.group.destroy());
        konvaClouds.filter(c => c.page === pg).forEach(c => c.group.destroy());
        konvaNotes = konvaNotes.filter(n => n.page !== pg);
        konvaRulers = konvaRulers.filter(r => r.page !== pg);
        konvaClouds = konvaClouds.filter(c => c.page !== pg);
    }

    function loadKonvaForPage(pg, data) {
        if (!useKonvaRuler) return;
        initKonvaRuler();
        clearKonvaPage(pg);
        if (!data || typeof data !== 'object') return;
        (data.rulers || []).forEach(r => createKonvaRuler(r.p1, r.p2, pg));
        (data.notes || []).forEach(n => {
            const note = createKonvaNote({ x: n.x, y: n.y }, n.text || 'annotation', pg);
            if (n.fill) note.label.fill(n.fill);
            if (n.fontSize) note.label.fontSize(n.fontSize);
        });
        (data.clouds || []).forEach(c => {
            const cloud = createKonvaCloud({ x: c.x, y: c.y }, pg, c.strokeWidth || cloudStrokeWidth);
            cloud.group.scaleX(c.scaleX || 1);
            cloud.group.scaleY(c.scaleY || 1);
        });
        setKonvaPage(pg);
    }

    function saveCurrentPageAnnotations() {
        const fabricJson = JSON.stringify(canvas.toJSON(['isMeasureLine','labelId','labelOffsetX','labelOffsetY']));
        if (!useKonvaRuler) {
            allAnnotations[pageNum] = fabricJson;
            persistDraftAnnotations();
            return;
        }
        allAnnotations[pageNum] = {
            fabric: fabricJson,
            konva: serializeKonvaForPage(pageNum)
        };
        persistDraftAnnotations();
    }

    function getSavedPageState(pg) {
        const raw = allAnnotations[pg];
        if (!raw) return { fabric: null, konva: null };
        if (typeof raw === 'string') return { fabric: raw, konva: null };
        return { fabric: raw.fabric || null, konva: raw.konva || null };
    }

    function updateKonvaInteractivity() {
        const allowEdit = (currentMode === 'smart');
        konvaRulers.forEach(r => {
            r.group.draggable(allowEdit);
            r.a1.draggable(allowEdit);
            r.a2.draggable(allowEdit);
            const selected = allowEdit && konvaSelectedNode?.type === 'ruler' && konvaSelectedNode.ref === r;
            r.a1.visible(selected);
            r.a2.visible(selected);
        });
        konvaNotes.forEach(n => {
            n.group.draggable(allowEdit);
        });
        konvaClouds.forEach(c => {
            c.group.draggable(allowEdit);
        });
        if (konvaTransformer) {
            if (!allowEdit) konvaTransformer.nodes([]);
        }
        if (konvaLayer) konvaLayer.batchDraw();
    }

    function setKonvaPage(page) {
        konvaRulers.forEach(r => {
            r.group.visible(r.page === page);
        });
        konvaNotes.forEach(n => {
            n.group.visible(n.page === page);
        });
        konvaClouds.forEach(c => {
            c.group.visible(c.page === page);
        });
        if (konvaTransformer) {
            konvaTransformer.nodes([]);
        }
        konvaSelectedNode = null;
        konvaRulers.forEach(r => {
            r.a1.visible(false);
            r.a2.visible(false);
        });
        if (konvaLayer) konvaLayer.batchDraw();
    }

    function createKonvaRuler(p1, p2, targetPage = pageNum) {
        const group = new Konva.Group({ draggable: true });
        const line = new Konva.Line({
            points: [p1.x, p1.y, p2.x, p2.y],
            stroke: '#22c55e',
            strokeWidth: 4
        });
        const a1 = new Konva.Circle({
            x: p1.x, y: p1.y,
            radius: 6,
            fill: '#ffffff',
            stroke: '#22c55e',
            strokeWidth: 2,
            draggable: true,
            visible: false
        });
        const a2 = new Konva.Circle({
            x: p2.x, y: p2.y,
            radius: 6,
            fill: '#ffffff',
            stroke: '#22c55e',
            strokeWidth: 2,
            draggable: true,
            visible: false
        });
        const label = new Konva.Text({
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2 - 15,
            text: '',
            fontSize: 16,
            fill: '#22c55e',
            padding: 4
        });

        group.add(line, a1, a2, label);
        konvaLayer.add(group);

        const ruler = { group, line, a1, a2, label, page: targetPage };
        konvaRulers.push(ruler);
        if (!konvaRulersByPage[targetPage]) konvaRulersByPage[targetPage] = [];
        konvaRulersByPage[targetPage].push(ruler);

        const updateLine = () => {
            const p1c = a1.position();
            const p2c = a2.position();
            line.points([p1c.x, p1c.y, p2c.x, p2c.y]);
            updateKonvaLabel(ruler);
            konvaLayer.batchDraw();
        };

        a1.on('dragmove', updateLine);
        a2.on('dragmove', updateLine);
        a1.on('dragend', saveCurrentPageAnnotations);
        a2.on('dragend', saveCurrentPageAnnotations);
        group.on('dragmove', () => {
            updateKonvaLabel(ruler);
            konvaLayer.batchDraw();
        });
        group.on('dragend', saveCurrentPageAnnotations);
        group.on('click tap', () => {
            if (currentMode !== 'smart') return;
            if (konvaTransformer) konvaTransformer.nodes([]);
            konvaSelectedNode = { type: 'ruler', ref: ruler };
            konvaRulers.forEach(r => {
                const active = r === ruler;
                r.a1.visible(active);
                r.a2.visible(active);
            });
            konvaLayer.batchDraw();
        });

        updateKonvaLabel(ruler);
        updateKonvaInteractivity();
        return ruler;
    }

    function isKonvaNoteEmpty(note) {
        if (!note || !note.label) return true;
        const raw = String(note.label.text() || '');
        const trimmed = raw.trim();
        return trimmed === '';
    }

    function removeKonvaNote(note) {
        if (!note) return;
        if (konvaSelectedNote === note) konvaSelectedNote = null;
        if (konvaSelectedNode && konvaSelectedNode.type === 'note' && konvaSelectedNode.ref === note) {
            konvaSelectedNode = null;
        }
        if (konvaTransformer) konvaTransformer.nodes([]);
        note.group.destroy();
        konvaNotes = konvaNotes.filter(n => n !== note);
        if (konvaLayer) konvaLayer.batchDraw();
        saveCurrentPageAnnotations();
    }

    function discardEmptyActiveKonvaNote() {
        if (!konvaSelectedNote) return false;
        if (!isKonvaNoteEmpty(konvaSelectedNote)) return false;
        removeKonvaNote(konvaSelectedNote);
        showToast("Empty note discarded", "warning");
        return true;
    }

    function getResponsiveNotePreset() {
        const width = window.innerWidth || 1280;
        if (width <= 640) return { fontSize: 42, minEditW: 180, minEditH: 52 };
        if (width <= 1024) return { fontSize: 54, minEditW: 220, minEditH: 64 };
        return { fontSize: 64, minEditW: 260, minEditH: 72 };
    }

    function createKonvaNote(pos, text = 'annotation', targetPage = pageNum) {
        const preset = getResponsiveNotePreset();
        const group = new Konva.Group({ x: pos.x, y: pos.y, draggable: true });
        const label = new Konva.Text({
            x: 0,
            y: 0,
            text,
            fontSize: preset.fontSize,
            fill: '#ef4444',
            fontFamily: 'Arial',
            wrap: 'word'
        });
        group.add(label);
        konvaLayer.add(group);

        const note = { group, label, page: targetPage };
        konvaNotes.push(note);

        group.on('click tap', () => {
            if (currentMode !== 'smart') setMode('smart');
            konvaSelectedNote = note;
            showPropSection('text');
            const sizeInput = document.getElementById('text-size-input');
            if (sizeInput) sizeInput.value = Math.round(note.label.fontSize());
            if (konvaTransformer) konvaTransformer.nodes([group]);
            konvaSelectedNode = { type: 'note', ref: note };
        });
        group.on('dragend', saveCurrentPageAnnotations);
        label.on('dblclick dbltap', () => {
            if (currentMode !== 'smart') setMode('smart');
            konvaSelectedNote = note;
            if (konvaTransformer) konvaTransformer.nodes([group]);
            konvaSelectedNode = { type: 'note', ref: note };
            startInlineNoteEdit(note);
        });
        group.on('dblclick dbltap', () => {
            if (currentMode !== 'smart') setMode('smart');
            konvaSelectedNote = note;
            if (konvaTransformer) konvaTransformer.nodes([group]);
            konvaSelectedNode = { type: 'note', ref: note };
            startInlineNoteEdit(note);
        });

        updateKonvaInteractivity();
        return note;
    }

    function createKonvaCloud(pos, targetPage = pageNum, strokeWidth = cloudStrokeWidth) {
        const group = new Konva.Group({ x: pos.x, y: pos.y, draggable: true });

        const w = 180;
        const h = 120;
        const pad = 12;
        const stroke = '#ef4444';

        const cloudShape = new Konva.Shape({
            sceneFunc: (ctx, shape) => {
                const left = -w / 2;
                const top = -h / 2;
                const right = w / 2;
                const bottom = h / 2;
                const scallop = 9;

                ctx.beginPath();

                // Top
                let x = left;
                ctx.moveTo(x, top);
                while (x < right) {
                    const nx = Math.min(x + scallop, right);
                    const mid = (x + nx) / 2;
                    ctx.quadraticCurveTo(mid, top - 7, nx, top);
                    x = nx;
                }
                // Right
                let y = top;
                while (y < bottom) {
                    const ny = Math.min(y + scallop, bottom);
                    const mid = (y + ny) / 2;
                    ctx.quadraticCurveTo(right + 7, mid, right, ny);
                    y = ny;
                }
                // Bottom
                x = right;
                while (x > left) {
                    const nx = Math.max(x - scallop, left);
                    const mid = (x + nx) / 2;
                    ctx.quadraticCurveTo(mid, bottom + 7, nx, bottom);
                    x = nx;
                }
                // Left
                y = bottom;
                while (y > top) {
                    const ny = Math.max(y - scallop, top);
                    const mid = (y + ny) / 2;
                    ctx.quadraticCurveTo(left - 7, mid, left, ny);
                    y = ny;
                }

                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
            stroke,
            strokeWidth,
            fill: 'transparent',
            shadowColor: '#ef4444',
            shadowBlur: 8,
            shadowOpacity: 0.18
        });

        const hitBox = new Konva.Rect({
            x: -(w / 2) - pad,
            y: -(h / 2) - pad,
            width: w + (pad * 2),
            height: h + (pad * 2),
            fill: 'rgba(0,0,0,0.001)',
            strokeWidth: 0
        });

        group.add(cloudShape);
        group.add(hitBox);
        konvaLayer.add(group);

        const cloud = { group, shape: cloudShape, page: targetPage };
        konvaClouds.push(cloud);

        group.on('click tap', () => {
            if (currentMode !== 'smart') setMode('smart');
            if (konvaTransformer) konvaTransformer.nodes([group]);
            konvaSelectedNode = { type: 'cloud', ref: cloud };
            cloudStrokeWidth = cloud.shape.strokeWidth();
            syncCloudStrokeControl(cloudStrokeWidth);
            showPropSection('cloud');
        });
        group.on('dblclick dbltap', () => {
            if (currentMode !== 'smart') setMode('smart');
            if (konvaTransformer) konvaTransformer.nodes([group]);
            konvaSelectedNode = { type: 'cloud', ref: cloud };
            cloudStrokeWidth = cloud.shape.strokeWidth();
            syncCloudStrokeControl(cloudStrokeWidth);
            showPropSection('cloud');
        });
        group.on('dragend', saveCurrentPageAnnotations);

        updateKonvaInteractivity();
        return cloud;
    }

    function ensureKonvaTransformer() {
        if (!konvaLayer) return;
        if (!konvaTransformer) {
            konvaTransformer = new Konva.Transformer({
                enabledAnchors: ['top-left','top-right','bottom-left','bottom-right'],
                rotateEnabled: false,
                keepRatio: false,
                boundBoxFunc: (oldBox, newBox) => {
                    if (newBox.width < 20 || newBox.height < 20) return oldBox;
                    return newBox;
                }
            });
            konvaTransformer.on('transformend', saveCurrentPageAnnotations);
            konvaLayer.add(konvaTransformer);
        }
    }

    function deleteKonvaSelection() {
        if (!konvaSelectedNode) return false;
        const { type, ref } = konvaSelectedNode;
        if (type === 'ruler') {
            ref.group.destroy();
            konvaRulers = konvaRulers.filter(r => r !== ref);
            if (konvaRulersByPage[ref.page]) {
                konvaRulersByPage[ref.page] = konvaRulersByPage[ref.page].filter(r => r !== ref);
            }
        } else if (type === 'note') {
            if (konvaSelectedNote === ref) konvaSelectedNote = null;
            ref.group.destroy();
            konvaNotes = konvaNotes.filter(n => n !== ref);
        } else if (type === 'cloud') {
            ref.group.destroy();
            konvaClouds = konvaClouds.filter(c => c !== ref);
        }
        konvaSelectedNode = null;
        if (konvaTransformer) konvaTransformer.nodes([]);
        if (konvaLayer) konvaLayer.batchDraw();
        saveCurrentPageAnnotations();
        return true;
    }

    function startInlineNoteEdit(note) {
        if (!note || !konvaStage || !konvaLayer) return;
        konvaSelectedNote = note;
        const container = konvaStage.container();
        const rect = container.getBoundingClientRect();
        const vpt = getFabricVpt();

        const textNode = note.label;
        const absPos = textNode.getAbsolutePosition();

        const areaPosition = {
            x: rect.left + absPos.x * vpt.scaleX + vpt.translateX,
            y: rect.top + absPos.y * vpt.scaleY + vpt.translateY
        };

        const fontSize = textNode.fontSize();

        if (!konvaEditingTextarea) {
            konvaEditingTextarea = document.createElement('textarea');
            konvaEditingTextarea.style.position = 'absolute';
            konvaEditingTextarea.style.zIndex = '3000';
            konvaEditingTextarea.style.resize = 'none';
            konvaEditingTextarea.style.border = '1px solid #475569';
            konvaEditingTextarea.style.borderRadius = '6px';
            konvaEditingTextarea.style.padding = '6px 8px';
            konvaEditingTextarea.style.outline = 'none';
            konvaEditingTextarea.style.background = '#0f172a';
            konvaEditingTextarea.style.color = '#ffffff';
            container.appendChild(konvaEditingTextarea);
        }

        const fontSizePx = fontSize * vpt.scaleX;
        konvaEditingTextarea.style.fontSize = fontSizePx + 'px';
        konvaEditingTextarea.style.lineHeight = '1.2';
        konvaEditingTextarea.style.left = (absPos.x * vpt.scaleX + vpt.translateX) + 'px';
        konvaEditingTextarea.style.top = (absPos.y * vpt.scaleY + vpt.translateY) + 'px';
        const preset = getResponsiveNotePreset();
        konvaEditingTextarea.style.width = Math.max(preset.minEditW, textNode.width() * vpt.scaleX) + 'px';
        konvaEditingTextarea.style.height = Math.max(preset.minEditH, textNode.height() * vpt.scaleY) + 'px';
        konvaEditingTextarea.style.background = 'transparent';
        konvaEditingTextarea.style.border = 'none';
        konvaEditingTextarea.style.color = 'transparent';
        konvaEditingTextarea.style.caretColor = '#ffffff';
        konvaEditingTextarea.value = textNode.text();
        konvaEditingTextarea.focus();

        const finish = () => {
            if (!konvaEditingTextarea) return;
            const next = konvaEditingTextarea.value.trim();
            if (next !== '') {
                textNode.text(next);
            }
            konvaEditingTextarea.remove();
            konvaEditingTextarea = null;
            if (isKonvaNoteEmpty(note)) {
                removeKonvaNote(note);
                showToast("Empty note discarded", "warning");
                saveCurrentPageAnnotations();
                return;
            }
            konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
        };

        const onInput = () => {
            textNode.text(konvaEditingTextarea.value);
            konvaLayer.batchDraw();
        };
        const onKey = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finish();
            }
        };
        const onBlur = () => finish();
        konvaEditingTextarea.addEventListener('input', onInput);
        konvaEditingTextarea.addEventListener('keydown', onKey);
        konvaEditingTextarea.addEventListener('blur', onBlur);
    }

    function initKonvaRuler() {
        if (!useKonvaRuler || konvaStage) return;
        const w = document.getElementById('canvas-wrapper');
        if (!w) return;
        konvaStage = new Konva.Stage({
            container: 'konva-overlay',
            width: w.clientWidth,
            height: w.clientHeight
        });
        konvaLayer = new Konva.Layer();
        konvaStage.add(konvaLayer);
        ensureKonvaTransformer();

        // Zoom desde Konva -> Fabric (para no bloquear zoom)
        konvaStage.container().addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY;
            let zoom = canvas.getZoom() * (0.999 ** delta);
            if (zoom > 20) zoom = 20; if (zoom < 0.05) zoom = 0.05;
            const rect = konvaStage.container().getBoundingClientRect();
            const point = new fabric.Point(e.clientX - rect.left, e.clientY - rect.top);
            canvas.zoomToPoint(point, zoom);
            notifyTakeoffZoomChanged('wheel');
            updateTextScales(zoom);
            syncKonvaToFabric();
            schedulePdfRerender();
        }, { passive: false });

        // Pan desde Konva -> Fabric (ALT o botón derecho)
        let panStart = null;
        let backgroundPanCandidate = null;
        let backgroundPanGestureActive = false;
        const emitBackgroundPanState = (active) => {
            try {
                window.parent?.postMessage({
                    type: 'project-takeoff-pan-state',
                    payload: { active: Boolean(active), source: 'background-gesture' }
                }, '*');
            } catch (e) {}
        };
        const releaseCanvasPointerState = () => {
            const notifyGestureEnd = backgroundPanGestureActive;
            konvaIsPanning = false;
            panStart = null;
            backgroundPanCandidate = null;
            backgroundPanGestureActive = false;
            if (canvas) {
                canvas.isDragging = false;
                canvas.selection = currentMode === 'smart';
                canvas.defaultCursor = 'default';
                canvas.setCursor('default');
            }
            if (konvaStage?.container()) {
                konvaStage.container().style.cursor = (konvaPanMode || konvaTemporaryPan) ? 'grab' : 'default';
            }
            if (notifyGestureEnd) emitBackgroundPanState(false);
        };
        window.releaseTakeoffPointerState = releaseCanvasPointerState;
        window.setTakeoffPanMode = (enabled, temporary = false) => {
            releaseCanvasPointerState();
            if (temporary) konvaTemporaryPan = Boolean(enabled);
            else konvaPanMode = Boolean(enabled);
            if (konvaStage?.container()) {
                konvaStage.container().style.cursor = (konvaPanMode || konvaTemporaryPan) ? 'grab' : 'default';
            }
        };
        const panContainer = konvaStage.container();
        if (!panContainer._takeoffPanPointerBound) {
            panContainer._takeoffPanPointerBound = true;
            panContainer.addEventListener('pointerdown', evt => {
                const panActive = konvaPanMode || konvaTemporaryPan
                    || Boolean(window.projectTakeoffIsPanModeActive?.());
                if (!panActive || (evt.button !== 0 && evt.button !== 1 && evt.button !== 2)) return;
                evt.preventDefault();
                evt.stopImmediatePropagation();
                panStart = { x: evt.clientX, y: evt.clientY };
                konvaIsPanning = true;
                panContainer.style.cursor = 'grabbing';
                try { panContainer.setPointerCapture(evt.pointerId); } catch (e) {}
            }, true);
            panContainer.addEventListener('pointermove', evt => {
                if (!konvaIsPanning || !panStart) return;
                evt.preventDefault();
                evt.stopImmediatePropagation();
                const vpt = canvas.viewportTransform;
                vpt[4] += evt.clientX - panStart.x;
                vpt[5] += evt.clientY - panStart.y;
                panStart = { x: evt.clientX, y: evt.clientY };
                canvas.requestRenderAll();
                syncKonvaToFabric();
            }, true);
            const finishPointerPan = evt => {
                if (!konvaIsPanning) return;
                try { panContainer.releasePointerCapture(evt.pointerId); } catch (e) {}
                releaseCanvasPointerState();
            };
            panContainer.addEventListener('pointerup', finishPointerPan, true);
            panContainer.addEventListener('pointercancel', finishPointerPan, true);
        }
        konvaStage.on('mousedown', (e) => {
            const evt = e.evt;
            const target = e.target;
            const isEmpty = !target || target === konvaStage;
            if (pendingPlacementTool) return;
            const explicitPan = evt && (evt.altKey || evt.button === 2);
            const takeoffDrawing = Boolean(window.projectTakeoffIsDrawingToolActive?.());
            // Modifier navigation only starts on the plan background. When a
            // takeoff node owns the gesture, its object/vertex drag wins.
            const requestedPan = konvaPanMode || konvaTemporaryPan || (explicitPan && isEmpty);
            // Space temporarily suspends placement without discarding its
            // draft, so navigation remains available while drawing.
            if (evt && requestedPan && (!takeoffDrawing || konvaTemporaryPan)) {
                e.cancelBubble = true;
                panStart = { x: evt.clientX, y: evt.clientY };
                konvaIsPanning = true;
                konvaStage.container().style.cursor = 'grabbing';
                return;
            }
            const primaryBackgroundGesture = evt && evt.button === 0 && currentMode === 'smart'
                && isEmpty && !takeoffDrawing && !pendingPlacementTool;
            if (primaryBackgroundGesture) {
                backgroundPanCandidate = { x: evt.clientX, y: evt.clientY };
            }
        });
        konvaStage.on('click tap', (e) => {
            const target = e.target;
            const isEmpty = !target || target === konvaStage;

            if (currentMode === 'smart' && konvaSelectedNote && isKonvaNoteEmpty(konvaSelectedNote)) {
                const clickedInsideSelectedNote = target && (
                    target === konvaSelectedNote.group ||
                    target === konvaSelectedNote.label ||
                    target.getParent?.() === konvaSelectedNote.group
                );
                if (!clickedInsideSelectedNote) {
                    removeKonvaNote(konvaSelectedNote);
                    showToast("Empty note discarded", "warning");
                }
            }

            if (currentMode === 'smart' && isEmpty && konvaTransformer) {
                konvaTransformer.nodes([]);
                konvaLayer.batchDraw();
            }
            if (currentMode === 'smart' && isEmpty) {
                konvaSelectedNode = null;
                konvaRulers.forEach(r => {
                    r.a1.visible(false);
                    r.a2.visible(false);
                });
                if (konvaLayer) konvaLayer.batchDraw();
            }
        });
        konvaStage.on('mousemove', (e) => {
            if (pendingPlacementTool) return;
            const evt = e.evt;
            if (!konvaIsPanning && backgroundPanCandidate) {
                const distance = Math.hypot(
                    evt.clientX - backgroundPanCandidate.x,
                    evt.clientY - backgroundPanCandidate.y
                );
                if (distance >= 5) {
                    panStart = { ...backgroundPanCandidate };
                    backgroundPanCandidate = null;
                    backgroundPanGestureActive = true;
                    konvaIsPanning = true;
                    konvaStage.container().style.cursor = 'grabbing';
                    emitBackgroundPanState(true);
                }
            }
            if (!konvaIsPanning || !panStart) return;
            const vpt = canvas.viewportTransform;
            vpt[4] += evt.clientX - panStart.x;
            vpt[5] += evt.clientY - panStart.y;
            panStart = { x: evt.clientX, y: evt.clientY };
            canvas.requestRenderAll();
            syncKonvaToFabric();
        });
        konvaStage.on('mouseup touchend', releaseCanvasPointerState);
        konvaStage.container().addEventListener('mouseleave', releaseCanvasPointerState);
        konvaStage.container().addEventListener('pointercancel', releaseCanvasPointerState);
        window.addEventListener('pointerup', releaseCanvasPointerState);
        window.addEventListener('mouseup', releaseCanvasPointerState);
        window.addEventListener('touchend', releaseCanvasPointerState, { passive: true });
        window.addEventListener('touchcancel', releaseCanvasPointerState, { passive: true });
        window.addEventListener('blur', releaseCanvasPointerState);

        konvaStage.on('mousedown touchstart', (e) => {
            const target = e.target;
            const isEmpty = !target || target === konvaStage;
            const pos = konvaStage.getPointerPosition();
            if (pendingPlacementTool && isEmpty) {
                if (!pos) return;
                pendingPlacementStart = screenToWorld(pos);
                if (pendingPlacementPreview) pendingPlacementPreview.destroy();
                pendingPlacementPreview = new Konva.Rect({
                    x: pendingPlacementStart.x,
                    y: pendingPlacementStart.y,
                    width: 1,
                    height: 1,
                    stroke: '#22c55e',
                    strokeWidth: 1.5,
                    dash: [6, 4]
                });
                konvaLayer.add(pendingPlacementPreview);
                konvaLayer.batchDraw();
                return;
            }
            if (currentMode !== 'measure') return;
            if (!pos) return;
            const world = screenToWorld(pos);
            konvaDrawing = createKonvaRuler(world, world);
            syncKonvaToFabric();
        });

        konvaStage.on('mousemove touchmove', () => {
            const pos = konvaStage.getPointerPosition();
            if (pendingPlacementTool && pendingPlacementStart && pendingPlacementPreview && pos) {
                const world = screenToWorld(pos);
                const x = Math.min(pendingPlacementStart.x, world.x);
                const y = Math.min(pendingPlacementStart.y, world.y);
                const w = Math.max(1, Math.abs(world.x - pendingPlacementStart.x));
                const h = Math.max(1, Math.abs(world.y - pendingPlacementStart.y));
                pendingPlacementPreview.position({ x, y });
                pendingPlacementPreview.size({ width: w, height: h });
                konvaLayer.batchDraw();
                return;
            }
            if (!konvaDrawing) return;
            if (!pos) return;
            const world = screenToWorld(pos);
            konvaDrawing.a2.position(world);
            konvaDrawing.line.points([
                konvaDrawing.a1.x(), konvaDrawing.a1.y(),
                world.x, world.y
            ]);
            updateKonvaLabel(konvaDrawing);
            konvaLayer.batchDraw();
        });

        konvaStage.on('mouseup touchend', () => {
            if (pendingPlacementTool && pendingPlacementStart) {
                const pos = konvaStage.getPointerPosition();
                const end = pos ? screenToWorld(pos) : pendingPlacementStart;
                const minX = Math.min(pendingPlacementStart.x, end.x);
                const minY = Math.min(pendingPlacementStart.y, end.y);
                const width = Math.max(10, Math.abs(end.x - pendingPlacementStart.x));
                const height = Math.max(10, Math.abs(end.y - pendingPlacementStart.y));
                const cx = minX + (width / 2);
                const cy = minY + (height / 2);

                if (pendingPlacementPreview) {
                    pendingPlacementPreview.destroy();
                    pendingPlacementPreview = null;
                }

                if (pendingPlacementTool === 'note') {
                    const note = createKonvaNote({ x: cx, y: cy }, 'annotation');
                    const baseW = Math.max(1, note.label.width());
                    const baseH = Math.max(1, note.label.height());
                    note.group.scaleX(Math.max(0.35, width / baseW));
                    note.group.scaleY(Math.max(0.35, height / baseH));
                    if (konvaTransformer) konvaTransformer.nodes([note.group]);
                    konvaSelectedNode = { type: 'note', ref: note };
                    konvaSelectedNote = note;
                    startInlineNoteEdit(note);
                } else if (pendingPlacementTool === 'cloud') {
                    const cloud = createKonvaCloud({ x: cx, y: cy });
                    cloud.group.scaleX(Math.max(0.35, width / 180));
                    cloud.group.scaleY(Math.max(0.35, height / 120));
                    if (konvaTransformer) konvaTransformer.nodes([cloud.group]);
                    konvaSelectedNode = { type: 'cloud', ref: cloud };
                }

                clearPlacementTool();
                saveCurrentPageAnnotations();
                return;
            }

            if (!konvaDrawing) return;
            const p1 = konvaDrawing.a1.position();
            const p2 = konvaDrawing.a2.position();
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (dist < 10) {
                konvaDrawing.group.destroy();
                konvaRulers = konvaRulers.filter(r => r !== konvaDrawing);
                if (konvaRulersByPage[pageNum]) {
                    konvaRulersByPage[pageNum] = konvaRulersByPage[pageNum].filter(r => r !== konvaDrawing);
                }
                konvaLayer.draw();
            }
            konvaDrawing = null;
            saveCurrentPageAnnotations();
        });

        setKonvaPage(pageNum);
        setKonvaActive(currentMode === 'smart' || currentMode === 'measure');
        updateKonvaInteractivity();
    }

    // --- DOUBLE TAP & NODE LOGIC ---
    let lastTapTime = 0;
    let lastTapTarget = null;
    const DOUBLE_TAP_DELAY = 400;
    
    // Estado para control de modificaciÃ³n de vÃ©rtices de regla
    let controlEditMode = false; // Modo de ediciÃ³n activado con doble clic
    let activeControlPoint = null; // Punto de control activo ('p1' o 'p2')
    let renderAnimationFrame = null; // Para renderizado suave

    // --- CUSTOM CONTROLS FOR LINES (POSITION HANDLER FIXED) ---
    // Variable para rastrear si estamos manipulando un control
    let isDraggingControl = false;
    let controlDragStart = null;
    
    function createLineControls(line) {
        function linePositionHandler(pointName) {
            return function(dim, finalMatrix, fabricObject) {
                const points = fabricObject.calcLinePoints();
                const pt = (pointName === 'p1') ? new fabric.Point(points.x1, points.y1) : new fabric.Point(points.x2, points.y2);
                return fabric.util.transformPoint(pt, finalMatrix);
            };
        }
        
        function lineActionHandler(pointName) {
            return function(e, transform, x, y) {
                const target = transform.target;
                
                // Solo permitir modificaciÃ³n si el modo de ediciÃ³n estÃ¡ activado (doble clic)
                if (currentMode !== 'measure') {
                    if (!controlEditMode || activeControlPoint !== pointName) {
                        return false;
                    }
                }
                
                // Si el objeto estÃ¡ en modo "moving" (movimiento libre), no permitir modificar controles
                if (target.isMoving && !isDraggingControl) {
                    return false;
                }
                
                // Estamos manipulando un control - permitir la acciÃ³n
                let localPoint = null;
                if (fabric.controlsUtils && typeof fabric.controlsUtils.getLocalPoint === 'function') {
                    localPoint = fabric.controlsUtils.getLocalPoint(transform, target.originX || 'center', target.originY || 'center', x, y);
                } else {
                    const pt = new fabric.Point(x, y);
                    localPoint = target.toLocalPoint(pt, target.originX || 'center', target.originY || 'center');
                }
                if (!localPoint) return false;
                
                // Actualizar las coordenadas del punto correspondiente
                if (pointName === 'p1') { 
                    target.set({ x1: localPoint.x, y1: localPoint.y }); 
                } else { 
                    target.set({ x2: localPoint.x, y2: localPoint.y }); 
                }
                
                // Forzar actualizaciÃ³n de coordenadas antes de actualizar la etiqueta
                target.setCoords();
                
                // Usar requestAnimationFrame para renderizado suave sin trazos impresos
                if (renderAnimationFrame) {
                    cancelAnimationFrame(renderAnimationFrame);
                }
                renderAnimationFrame = requestAnimationFrame(() => {
                    // Actualizar la etiqueta de mediciÃ³n inmediatamente
                    updateMeasureLabel(target);
                    // Renderizado suave usando requestRenderAll en lugar de renderAll
                    canvas.requestRenderAll();
                    renderAnimationFrame = null;
                });
                
                return true;
            };
        }
        
        // Crear controles con Ã¡rea de detecciÃ³n mÃ¡s precisa
        const controlSize = 20; // TamaÃ±o del Ã¡rea de detecciÃ³n del control (mÃ¡s grande para facilitar el clic)
        
        // FunciÃ³n para verificar si el clic fue sobre un control
        function isControlClick(opt) {
            if (!opt.target || !opt.target.isMeasureLine) return false;
            if (!opt.control) return false;
            return opt.control === 'p1' || opt.control === 'p2';
        }
        
        line.controls = {
            p1: new fabric.Control({ 
                positionHandler: linePositionHandler('p1'), 
                actionHandler: lineActionHandler('p1'), 
                cursorStyle: 'crosshair', 
                render: renderCircleControl,
                sizeX: controlSize,
                sizeY: controlSize,
                // Asegurar que el control solo se active cuando se hace clic directamente sobre Ã©l
                mouseUpHandler: function(e, transformData, x, y) {
                    isDraggingControl = false;
                    controlDragStart = null;
                    return true;
                }
            }),
            p2: new fabric.Control({ 
                positionHandler: linePositionHandler('p2'), 
                actionHandler: lineActionHandler('p2'), 
                cursorStyle: 'crosshair', 
                render: renderCircleControl,
                sizeX: controlSize,
                sizeY: controlSize,
                mouseUpHandler: function(e, transformData, x, y) {
                    isDraggingControl = false;
                    controlDragStart = null;
                    return true;
                }
            })
        };
    }

    function renderCircleControl(ctx, left, top, styleOverride, fabricObject) {
        ctx.save(); ctx.translate(left, top); ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2, false); 
        ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#22c55e"; ctx.lineWidth = 2;
        ctx.fill(); ctx.stroke(); ctx.restore();
    }

    // --- LOCK HELPERS ---
    function lockObject(obj) {
        if(!obj) return;
        obj.set({
            lockMovementX: obj.isMeasureLine ? false : true,
            lockMovementY: obj.isMeasureLine ? false : true,
            lockRotation: true, lockScalingX: true, lockScalingY: true,
            borderColor: '#22c55e', cornerColor: 'transparent', hasBorders: false, hasControls: true
        });
        if (obj.isMeasureLine) {
            createLineControls(obj);
            // Asegurar que el objeto puede moverse normalmente cuando no se estÃ¡ manipulando un control
            obj.set({ lockMovementX: false, lockMovementY: false });
        }
    }

    function unlockObject(obj) {
        if(!obj) return;
        obj.set({
            lockMovementX: false, lockMovementY: false, lockRotation: true,
            borderColor: '#ef4444', hasBorders: true, hasControls: false, borderDashArray: [5, 5]
        });
    }

    // --- DELETE FUNCTIONALITY ---
    function deleteSelected() {
        const takeoffSelectionIds = window.projectTakeoffGetSelectionIds?.() || [];
        if (window.projectTakeoffDeleteCurrentSelection?.()) {
            showToast("Selection deleted", "success");
            return;
        }
        // A locked Takeoff selection is still authoritative. Do not fall through
        // and accidentally delete an unrelated Fabric annotation.
        if (takeoffSelectionIds.length) return;
        if (useKonvaRuler && deleteKonvaSelection()) {
            showToast("Selection deleted", "success");
            return;
        }
        const activeObjects = canvas.getActiveObjects();
        if(!activeObjects.length) return;
        
        // MODIFICADO: Eliminado confirm() y agrupado el historial
        historyProcessing = true; // Pausar guardado automÃ¡tico por objeto para agrupar la acciÃ³n
        
        canvas.discardActiveObject(); // Limpiar selecciÃ³n visual
        
        activeObjects.forEach(obj => {
            // Limpieza de dependencias (Etiquetas de medidas)
            if(obj.isMeasureLine && obj.label) canvas.remove(obj.label);
            
            // Limpieza inversa (Si borro etiqueta, buscar y borrar linea)
            if(obj.isMeasureLabel) {
                 const line = canvas.getObjects().find(o => o.labelId === obj.id);
                 if(line) canvas.remove(line);
            }
            canvas.remove(obj);
        });
        
        historyProcessing = false; // Reactivar historial
        saveHistory(); // Guardar el estado UNA vez con todos los objetos borrados
        showToast("Selection deleted", "success");
    }

    // --- PINCH ZOOM & PAN (GESTOS TÃCTILES MEJORADOS) ---
    const canvasWrapper = document.querySelector('.upper-canvas');
    let lastDist = 0;
    let lastClientX = 0;
    let lastClientY = 0;

    if(canvasWrapper) {
        canvasWrapper.addEventListener('touchstart', function(e) {
            if (e.touches.length === 2) {
                // Calcular distancia inicial
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lastDist = Math.sqrt(dx * dx + dy * dy);
                
                // Calcular centro inicial para el Pan
                lastClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                lastClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                
                e.preventDefault(); 
            }
        }, { passive: false });

        canvasWrapper.addEventListener('touchmove', function(e) {
            if (e.touches.length === 2) {
                e.preventDefault();
                
                // 1. CALCULAR ZOOM (Escala)
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                // 2. CALCULAR PAN (Movimiento)
                const currentClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const currentClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

                const deltaX = currentClientX - lastClientX;
                const deltaY = currentClientY - lastClientY;

                // Aplicar Pan (Mover el canvas)
                const vpt = canvas.viewportTransform;
                vpt[4] += deltaX;
                vpt[5] += deltaY;

                // Aplicar Zoom
                if(lastDist > 0) {
                    const scale = dist / lastDist;
                    let newZoom = canvas.getZoom() * scale;
                    if (newZoom > 20) newZoom = 20; if (newZoom < 0.1) newZoom = 0.1;
                    
                    // Zoom hacia el punto central de los dedos
                    const point = new fabric.Point(currentClientX, currentClientY);
                    canvas.zoomToPoint(point, newZoom);
                    notifyTakeoffZoomChanged('pinch');
                    updateTextScales(newZoom);
                    if (useKonvaRuler) syncKonvaToFabric();
                    schedulePdfRerender();
                }

                // Actualizar referencias para el siguiente frame
                lastDist = dist;
                lastClientX = currentClientX;
                lastClientY = currentClientY;

                canvas.requestRenderAll();
            }
        }, { passive: false });
    }

    canvas.on('mouse:up', function(opt) {
        this.setViewportTransform(this.viewportTransform);
        this.isDragging = false;
        if (currentMode === 'smart') this.selection = true;
        if(this.isDrawingModeWasOn) { canvas.isDrawingMode = true; this.isDrawingModeWasOn = false; }
        
        // MODIFICADO: Refuerzo contra falsos positivos (lÃ­neas cortas/basura)
        if (lineState === 1 && activeLine) {
            const ptr = canvas.getPointer(opt.e);
            const dist = Math.sqrt(Math.pow(ptr.x - startPoint.x, 2) + Math.pow(ptr.y - startPoint.y, 2));
            
            if (dist > 10) {
                finishLineLogic();
            } else {
                // BUG FIX: Si la distancia es muy corta (misclick), limpiar el objeto temporal
                canvas.remove(activeLine);
                activeLine = null;
                lineState = 0;
                canvas.requestRenderAll();
            }
        }
        canvas.setCursor('default');
    });

    // --- LOAD LOGIC ---
    if(fileExt === 'pdf') {
        const loadingTask = pdfjsLib.getDocument({
            url: fileUrl,
            rangeChunkSize: 262144,
            disableStream: false,
            disableAutoFetch: true
        });
        loadingTask.promise.then(pdf => {
            pdfDoc = pdf;
            document.getElementById('p-total').textContent = pdf.numPages;
            renderPageList(pdf.numPages);
            notifyTakeoffReady();
            renderPage(pageNum);
        }).catch(error => {
            console.error(error);
            showDrawingError('Unable to load this sheet');
            showToast("Error loading PDF", "error");
        });
    } else if (fileExt === 'heic') {
        document.getElementById('p-total').textContent = '1'; renderPageList(1);
        notifyTakeoffReady();
        fetch(fileUrl).then(res => res.blob()).then(blob => heic2any({ blob, toType: "image/jpeg" })).then(conversionResult => {
            const blob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
            const url = URL.createObjectURL(blob);
            fabric.Image.fromURL(url, img => { setBg(img); loadPageAnnotations(1); });
        }).catch(e => { console.error(e); showToast("Error loading HEIC", "error"); });
    } else {
        document.getElementById('p-total').textContent = '1'; renderPageList(1);
        notifyTakeoffReady();
        fabric.Image.fromURL(fileUrl, img => { 
            if(!img) { showToast("Error loading image", "error"); return; }
            setBg(img); loadPageAnnotations(1); 
        });
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
        const activeEl = document.getElementById(`plist-${curr}`);
        if(activeEl) activeEl.classList.add('active');
        document.getElementById('p-curr').innerText = curr;
    }

    function showDrawingLoading(show) {
        if (!drawingLoading) return;
        if (show) {
            drawingLoading.innerHTML = '<span><i class="fas fa-spinner fa-spin me-2"></i>Loading drawing...</span>';
        }
        drawingLoading.classList.toggle('hidden', !show);
    }

    function showDrawingError(message = 'Unable to load this sheet') {
        if (!drawingLoading) return;
        drawingLoading.innerHTML = `<div class="text-center">
            <div class="mb-2"><i class="fas fa-triangle-exclamation me-2"></i>${message}</div>
            <button type="button" class="btn btn-sm btn-light" onclick="renderPage(pageNum)">Retry</button>
        </div>`;
        drawingLoading.classList.remove('hidden');
    }

    function getCanvasWrapper() {
        return document.getElementById('canvas-wrapper');
    }

    function wrapperHasSize() {
        const w = getCanvasWrapper();
        return !!(w && w.clientWidth > 0 && w.clientHeight > 0);
    }

    function waitForWrapperSize() {
        return new Promise(resolve => {
            const tick = () => {
                if (wrapperHasSize()) {
                    resize();
                    resolve();
                } else {
                    requestAnimationFrame(tick);
                }
            };
            tick();
        });
    }

    function fitPdfToView(force = false) {
        if (!pdfWorldWidth || !pdfWorldHeight || !wrapperHasSize()) return;
        const w = getCanvasWrapper();
        const availableW = Math.max(120, w.clientWidth - PDF_PADDING * 2);
        const availableH = Math.max(120, w.clientHeight - PDF_PADDING * 2);
        const nextFit = Math.min(availableW / pdfWorldWidth, availableH / pdfWorldHeight);
        if (!isFinite(nextFit) || nextFit <= 0) return;
        pdfFitZoom = nextFit;
        if (force || Math.abs(canvas.getZoom() - nextFit) < 0.02 || canvas.getZoom() === 1) {
            centerPdfAtZoom(nextFit);
        }
    }

    function centerPdfAtZoom(zoom) {
        const w = getCanvasWrapper();
        if (!w || !pdfWorldWidth || !pdfWorldHeight) return;
        const left = Math.max(PDF_PADDING, (w.clientWidth - pdfWorldWidth * zoom) / 2);
        const top = Math.max(PDF_PADDING, (w.clientHeight - pdfWorldHeight * zoom) / 2);
        canvas.setViewportTransform([zoom, 0, 0, zoom, left, top]);
        notifyTakeoffZoomChanged('fit');
        if (useKonvaRuler) syncKonvaToFabric();
        updateTextScales(zoom);
        canvas.requestRenderAll();
    }

    function pdfRenderScaleForZoom(zoom) {
        // Never round down: a bitmap slightly below the viewport zoom is
        // immediately blurred by Fabric. Quarter-step ceilings balance crisp
        // line work with cache reuse while DPR supplies display density.
        return Math.min(MAX_PDF_RENDER_SCALE, Math.max(1, Math.ceil((Number(zoom) || 1) * 4) / 4));
    }

    function pdfBitmapCacheKey(num, zoom) {
        return `${num}@${pdfRenderScaleForZoom(zoom)}@${dpr}`;
    }

    function touchPdfBitmapCache(key, bitmap) {
        if (pdfBitmapCache.has(key)) pdfBitmapCache.delete(key);
        pdfBitmapCache.set(key, bitmap);
        while (pdfBitmapCache.size > PDF_BITMAP_CACHE_LIMIT) {
            const firstKey = pdfBitmapCache.keys().next().value;
            const old = pdfBitmapCache.get(firstKey);
            if (old?.url) URL.revokeObjectURL(old.url);
            pdfBitmapCache.delete(firstKey);
        }
    }

    function cancelActivePdfRender() {
        if (activePdfRenderTask && typeof activePdfRenderTask.cancel === 'function') {
            try { activePdfRenderTask.cancel(); } catch (e) {}
        }
        activePdfRenderTask = null;
    }

    async function renderPageToBitmap(num, zoom, token) {
        const cacheKey = pdfBitmapCacheKey(num, zoom);
        const cached = pdfBitmapCache.get(cacheKey);
        if (cached) {
            touchPdfBitmapCache(cacheKey, cached);
            return cached;
        }
        const page = await pdfDoc.getPage(num);
        if (token !== renderToken) return null;
        const baseViewport = page.getViewport({ scale: 1 });
        pdfWorldWidth = baseViewport.width;
        pdfWorldHeight = baseViewport.height;

        const outputScale = dpr;
        const viewportScale = pdfRenderScaleForZoom(zoom);
        const viewport = page.getViewport({ scale: viewportScale });
        const renderCanvas = document.createElement('canvas');
        const renderCtx = renderCanvas.getContext('2d', { alpha: false });

        renderCanvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        renderCanvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        renderCanvas.style.width = viewport.width + 'px';
        renderCanvas.style.height = viewport.height + 'px';
        renderCtx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        renderCtx.fillStyle = '#ffffff';
        renderCtx.fillRect(0, 0, viewport.width, viewport.height);
        cancelActivePdfRender();
        const renderTask = page.render({ canvasContext: renderCtx, viewport });
        activePdfRenderTask = renderTask;
        await renderTask.promise;
        if (activePdfRenderTask === renderTask) activePdfRenderTask = null;
        if (token !== renderToken) return null;

        const bitmap = await new Promise(resolve => {
            renderCanvas.toBlob(blob => {
                if (!blob) {
                    resolve(null);
                    return;
                }
                resolve({
                    url: URL.createObjectURL(blob),
                    bitmapWidth: renderCanvas.width,
                    bitmapHeight: renderCanvas.height,
                    worldWidth: baseViewport.width,
                    worldHeight: baseViewport.height,
                    renderScale: viewportScale,
                    requestedZoom: Number(zoom) || 1
                });
            }, 'image/png');
        });
        if (bitmap) touchPdfBitmapCache(cacheKey, bitmap);
        return bitmap;
    }

    function applyPdfBackground(bitmap, token, loadAnnotations) {
        fabric.Image.fromURL(bitmap.url, img => {
            if (token !== renderToken) return;
            setBg(img, bitmap.worldWidth, bitmap.worldHeight);
            currentPdfRenderZoom = bitmap.requestedZoom;
            currentPdfRenderScale = bitmap.renderScale;
            showDrawingLoading(false);
            if (loadAnnotations) loadPageAnnotations(pageNum);
            // The user may have continued zooming while PDF.js rendered. Keep
            // this bitmap visible, then silently refine again if necessary.
            if (pdfRenderScaleForZoom(canvas.getZoom()) > currentPdfRenderScale) {
                schedulePdfRerender();
            }
        });
    }

    async function renderPage(num, loadAnnotations = true) {
        updatePageListUI(num);
        if(!pdfDoc) return;
        const isBackgroundRefresh = !loadAnnotations && !!canvas.backgroundImage;
        // Zoom only refreshes the PDF bitmap resolution. Keep the current
        // background visible and reserve the loader for real document/page loads.
        if (!isBackgroundRefresh) showDrawingLoading(true);
        try {
            await waitForWrapperSize();
            renderToken++;
            const token = renderToken;
            cancelActivePdfRender();
            const page = await pdfDoc.getPage(num);
            if (token !== renderToken) return;
            const baseViewport = page.getViewport({ scale: 1 });
            pdfWorldWidth = baseViewport.width;
            pdfWorldHeight = baseViewport.height;
            fitPdfToView(loadAnnotations);
            const bitmap = await renderPageToBitmap(num, canvas.getZoom(), token);
            if (token !== renderToken) return;
            if (!bitmap) throw new Error('PDF bitmap generation failed');
            applyPdfBackground(bitmap, token, loadAnnotations);
        } catch (error) {
            if (error?.name === 'RenderingCancelledException') return;
            console.error(error);
            if (isBackgroundRefresh) return;
            showDrawingError('Unable to load this sheet');
            showToast("Error rendering PDF page", "error");
        }
    }

    function schedulePdfRerender() {
        if (!pdfDoc) return;
        clearTimeout(pdfRerenderTimer);
        pdfRerenderTimer = setTimeout(() => {
            const z = canvas.getZoom();
            const desiredScale = pdfRenderScaleForZoom(z);
            if (desiredScale > currentPdfRenderScale || Math.abs(z - currentPdfRenderZoom) > 0.5) {
                renderPage(pageNum, false);
            }
        }, 180);
    }

    function setBg(img, worldWidth = img.width, worldHeight = img.height) {
        img.excludeFromHistory = true;
        img.set({
            originX: 'left',
            originY: 'top',
            left: 0,
            top: 0,
            scaleX: worldWidth / img.width,
            scaleY: worldHeight / img.height,
            selectable: false,
            evented: false
        });
        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
        showDrawingLoading(false);
    }

    function jumpToPage(targetPage) {
        saveCurrentPageAnnotations();
        canvas.clear(); undoStack = []; historyIndex = -1;
        pageNum = targetPage; 
        loadCalibrationForPage(false);
        if (useKonvaRuler) setKonvaPage(pageNum);
        if(pdfDoc) renderPage(pageNum); else loadPageAnnotations(pageNum);
        
        // AUTO-HIDE SIDEBAR ON PAGE SELECT (Universal)
        const sb = document.getElementById('sidebarLeft');
        if(sb.classList.contains('show')) {
            toggleSheets();
        }
    }

    function changePage(offset) {
        let max = pdfDoc ? pdfDoc.numPages : 1;
        const newPage = pageNum + offset;
        if(newPage < 1 || newPage > max) return;
        jumpToPage(newPage);
    }

    function notifyTakeoffReady() {
        try {
            window.parent?.postMessage({
                type: 'takeoff-editor-ready',
                fileId,
                pageCount: pdfDoc ? pdfDoc.numPages : 1,
                pageNum
            }, '*');
        } catch (e) {}
    }

    const thumbnailCache = new Map();
    const THUMBNAIL_CACHE_LIMIT = 24;

    function touchThumbnailCache(key, dataUrl) {
        if (thumbnailCache.has(key)) thumbnailCache.delete(key);
        thumbnailCache.set(key, dataUrl);
        while (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
            thumbnailCache.delete(thumbnailCache.keys().next().value);
        }
    }

    async function takeoffRenderThumbnail(targetPage = pageNum) {
        if (!pdfDoc) return null;
        const pg = Math.max(1, Math.min(pdfDoc.numPages, Number(targetPage) || 1));
        const key = String(pg);
        if (thumbnailCache.has(key)) return thumbnailCache.get(key);
        const page = await pdfDoc.getPage(pg);
        const viewport = page.getViewport({ scale: 0.18 });
        const thumbCanvas = document.createElement('canvas');
        const ctx = thumbCanvas.getContext('2d', { alpha: false });
        thumbCanvas.width = Math.max(1, Math.floor(viewport.width));
        thumbCanvas.height = Math.max(1, Math.floor(viewport.height));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.68);
        touchThumbnailCache(key, dataUrl);
        return dataUrl;
    }

    function takeoffGetDocumentInfo() {
        return {
            fileId,
            pageCount: pdfDoc ? pdfDoc.numPages : 1,
            pageNum,
            fileUrl,
            fileExt
        };
    }

    function takeoffJumpToPage(targetPage) {
        const max = pdfDoc ? pdfDoc.numPages : 1;
        const pg = Math.max(1, Math.min(max, Number(targetPage) || 1));
        jumpToPage(pg);
        notifyTakeoffReady();
        return takeoffGetDocumentInfo();
    }

    window.takeoffGetDocumentInfo = takeoffGetDocumentInfo;
    window.takeoffJumpToPage = takeoffJumpToPage;
    window.takeoffRenderThumbnail = takeoffRenderThumbnail;

    function loadPageAnnotations(pg) {
        historyProcessing = true;
        const state = getSavedPageState(pg);
        if(state.fabric) {
            canvas.loadFromJSON(state.fabric, function() { 
                const objects = canvas.getObjects();
                objects.forEach(obj => {
                    if (obj.isMeasureLine) {
                        lockObject(obj);
                        if(obj.labelId) {
                            const lbl = objects.find(o => o.isMeasureLabel && o.id === obj.labelId);
                            if(lbl) { obj.label = lbl; lbl.selectable = false; lbl.evented = false; }
                        }
                    } else if (!obj.isMeasureLabel) {
                        obj.set({ lockMovementX:true, lockMovementY:true, borderColor:'#22c55e' });
                    }
                });
                  if (useKonvaRuler) loadKonvaForPage(pg, state.konva);
                  updateTextScales(canvas.getZoom()); 
                  canvas.requestRenderAll(); 
                  refreshMeasureLabels();
                  historyProcessing = false; 
                  saveHistory(); 
              });
        } else {
            if (useKonvaRuler) loadKonvaForPage(pg, state.konva);
            historyProcessing = false;
            saveHistory(); 
        }
    }

    // --- HISTORY ---
    function saveHistory() {
        if(historyProcessing) return;
        if (historyIndex < undoStack.length - 1) { undoStack = undoStack.slice(0, historyIndex + 1); }
        const json = JSON.stringify(canvas.toJSON(['isMeasureLine', 'isMeasureLabel', 'labelId', 'id']));
        undoStack.push(json);
        historyIndex++;
        if (undoStack.length > MAX_HISTORY) { undoStack.shift(); historyIndex--; }
        updateHistoryButtons();
    }

    function undo() {
        if (historyIndex > 0) {
            historyProcessing = true; historyIndex--;
            const state = undoStack[historyIndex];
            canvas.loadFromJSON(state, () => {
                reLinkObjects(); historyProcessing = false; updateTextScales(canvas.getZoom()); updateHistoryButtons();
            });
        }
    }

    function redo() {
        if (historyIndex < undoStack.length - 1) {
            historyProcessing = true; historyIndex++;
            const state = undoStack[historyIndex];
            canvas.loadFromJSON(state, () => {
                reLinkObjects(); historyProcessing = false; updateTextScales(canvas.getZoom()); updateHistoryButtons();
            });
        }
    }

    function updateHistoryButtons() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        if(historyIndex > 0) btnUndo.classList.remove('btn-disabled'); else btnUndo.classList.add('btn-disabled');
        if(historyIndex < undoStack.length - 1) btnRedo.classList.remove('btn-disabled'); else btnRedo.classList.add('btn-disabled');
    }

    function reLinkObjects() {
        const objects = canvas.getObjects();
        objects.forEach(obj => {
            if (obj.isMeasureLine) {
                lockObject(obj);
                if(obj.labelId) {
                    const lbl = objects.find(o => o.isMeasureLabel && o.id === obj.labelId);
                    if(lbl) { obj.label = lbl; lbl.selectable = false; lbl.evented = false; }
                }
            }
        });
        canvas.requestRenderAll();
    }

    // --- EVENTS ---
    canvas.on('object:added', e => { if(!e.target.excludeFromHistory) saveHistory(); });
    canvas.on('object:modified', saveHistory);
    canvas.on('object:removed', e => {
        if(e.target.isMeasureLine && e.target.label) canvas.remove(e.target.label);
        saveHistory();
    });

    // Auto-remove empty text on creation
    canvas.on('text:editing:exited', function(e) {
        const obj = e.target;
        if(obj && obj.isNew) {
            if((obj.text || '').trim() === '') {
                canvas.remove(obj);
                canvas.requestRenderAll();
                showToast("Empty note discarded", "warning");
            } else {
                delete obj.isNew;
            }
        }
    });

    function updateMeasureLabel(line) {
        if (!line || !line.label) return;
        const points = line.calcLinePoints();
        const matrix = line.calcTransformMatrix();
        const p1 = fabric.util.transformPoint(new fabric.Point(points.x1, points.y1), matrix);
        const p2 = fabric.util.transformPoint(new fabric.Point(points.x2, points.y2), matrix);
        const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        let textVal = "";
        if (pixelsPerFoot > 0) { 
            const feet = distPx / pixelsPerFoot; 
            textVal = formatFeetForDisplay(feet);
        } else { 
            textVal = Math.round(distPx) + " px"; 
        }
        line.label.set({ text: textVal });
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        line.label.set({ left: midX, top: midY - 15 });
        line.setCoords(); 
        line.label.setCoords();
        // NO llamar requestRenderAll aquÃ­ - se maneja en los eventos con requestAnimationFrame
    }

    canvas.on('object:moving', function(e) {
        const obj = e.target;
        if (obj.isMeasureLine && obj.label) {
            // Cuando se mueve el objeto completo, solo actualizar posiciÃ³n de la etiqueta
            // No actualizar el valor porque la distancia no cambia
            const center = obj.getCenterPoint();
            obj.label.set({ left: center.x, top: center.y - 15 });
            obj.label.setCoords();
            // Renderizado suave durante el movimiento
            if (renderAnimationFrame) cancelAnimationFrame(renderAnimationFrame);
            renderAnimationFrame = requestAnimationFrame(() => {
                canvas.requestRenderAll();
                renderAnimationFrame = null;
            });
        }
    });

    // --- TOOL SWITCHING ---
    function setMode(mode) {
        if (calLineObject && mode !== 'cal') clearCalLine(); 

        discardEmptyActiveKonvaNote();

        // FIX: Check for new note before switching tool
        const activeObj = canvas.getActiveObject();
        if(activeObj && activeObj.isNew && (activeObj.type === 'i-text' || activeObj.type === 'text' || activeObj.type === 'textbox')) {
             canvas.remove(activeObj);
             canvas.requestRenderAll();
             showToast("Empty note discarded", "warning");
        }

        if (mode !== 'smart' && pendingPlacementTool) clearPlacementTool();
        resetToolState();
        currentMode = mode;
        canvas.discardActiveObject(); canvas.requestRenderAll();
        canvas.isDrawingMode = (mode === 'draw');
        canvas.selection = (mode === 'smart'); 
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        if(mode !== 'smart') {
            const btn = document.getElementById('btn-' + mode);
            if(btn) btn.classList.add('active'); 
        } else { document.getElementById('btn-smart').classList.add('active'); }
        document.querySelectorAll('.prop-section').forEach(p => p.classList.remove('active'));
        const propEl = document.getElementById('prop-' + mode);
        if(propEl) propEl.classList.add('active');
        document.getElementById('stamp-menu').style.display = 'none';
        
        // CURSOR LOGIC SIMPLIFIED (No 'pan' mode check needed for cursor style here)
        if(mode === 'draw') { canvas.freeDrawingBrush.color = '#ef4444'; canvas.freeDrawingBrush.width = 3; canvas.defaultCursor = 'crosshair'; } 
        else if(mode === 'measure') {
            if(pixelsPerFoot <= 0) { showToast("Please calibrate first!", "error"); setMode('cal'); return; }
            canvas.defaultCursor = 'crosshair';
        } else if(mode === 'cal') {
            updateCalHint();
            if (window.innerWidth <= 991) {
                openMobileCalModal();
            }
        } 
        else { canvas.defaultCursor = 'default'; }

        if (useKonvaRuler) {
            if (mode === 'measure' || mode === 'smart') {
                initKonvaRuler();
                setKonvaActive(true);
            } else {
                setKonvaActive(false);
            }
            updateKonvaInteractivity();
        }
        
        if(mode === 'smart') {
            const active = canvas.getActiveObject();
            if(active && (active.type === 'i-text' || active.type === 'text' || active.type === 'textbox')) showPropSection('text');
        }
        
        // Auto-close tools on mobile after selecting a tool (Optional UX improvement)
        if(window.innerWidth <= 991 && mode !== 'stamp') {
             // setTimeout(toggleMobileTools, 300); // Uncomment if you prefer auto-close
        }
    }

    function resetToolState() {
        if (activeLine && !calLineObject) { canvas.remove(activeLine); activeLine = null; }
        if(currentMode !== 'cal') {
             document.getElementById('cal-actions').style.display = 'none';
             document.getElementById('cal-hint').style.display = 'block';
             document.getElementById('cal-val').value = '';
             resetScalePresetSelection();
             updateCalHint();
        }
        lineState = 0;
    }
    
    function showPropSection(idPart) {
        document.querySelectorAll('.prop-section').forEach(p => p.classList.remove('active'));
        const el = document.getElementById('prop-' + idPart);
        if(el) el.classList.add('active');
        keepScaleDisplayVisible();
    }

    function toggleStampMenu() {
        const m = document.getElementById('stamp-menu');
        m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
    }

    function addStamp(text, color) {
        setMode('smart');
        const center = canvas.getVpCenter();
        const rect = new fabric.Rect({ width: 200, height: 80, rx: 10, ry: 10, fill: 'transparent', stroke: color, strokeWidth: 5, originX: 'center', originY: 'center' });
        const lbl = new fabric.Text(text, { fontSize: 40, fill: color, fontWeight: 'bold', fontFamily: 'Arial', originX: 'center', originY: 'center' });
        const group = new fabric.Group([rect, lbl], { left: center.x, top: center.y, opacity: 0.8 });
        lockObject(group);
        canvas.add(group); canvas.setActiveObject(group);
        document.getElementById('stamp-menu').style.display = 'none';
        saveHistory();
    }

    // --- CANVAS INPUTS ---
    canvas.on('mouse:down', function(opt) {
        const evt = opt.e;
        const now = new Date().getTime();

        if (currentMode === 'measure' && useKonvaRuler) {
            return;
        }
        
        // Verificar si el clic fue sobre un control de una lÃ­nea de medida
        if (opt.target && opt.target.isMeasureLine) {
            const activeControl = opt.control;
            
                        // Verificar si es clic en un control (vértice)
            if (activeControl && (activeControl === 'p1' || activeControl === 'p2')) {
                if (currentMode === 'measure') {
                    // En modo medida, permitir editar directamente sin doble clic
                    controlEditMode = true;
                    activeControlPoint = activeControl;
                    isDraggingControl = true;
                    controlDragStart = { 
                        x: evt.clientX || (evt.touches && evt.touches[0].clientX), 
                        y: evt.clientY || (evt.touches && evt.touches[0].clientY) 
                    };
                    opt.target.set({ lockMovementX: true, lockMovementY: true });
                    opt.target.isMoving = false;
                    showToast("Edit mode: Drag vertex to resize", "success");
                } else {
                    const isDoubleClick = (lastTapTarget === opt.target && 
                                          lastTapTarget.control === activeControl && 
                                          (now - lastTapTime < DOUBLE_TAP_DELAY));
                    
                    if (isDoubleClick) {
                        // Doble clic en vértice - activar modo de edición
                        controlEditMode = true;
                        activeControlPoint = activeControl;
                        isDraggingControl = true;
                        controlDragStart = { 
                            x: evt.clientX || (evt.touches && evt.touches[0].clientX), 
                            y: evt.clientY || (evt.touches && evt.touches[0].clientY) 
                        };
                        // Prevenir que el objeto se mueva cuando arrastramos un control
                        opt.target.set({ lockMovementX: true, lockMovementY: true });
                        opt.target.isMoving = false;
                        showToast("Edit mode: Drag vertex to resize", "success");
                    } else {
                        // Primer clic en control - solo seleccionar, no activar edición
                        controlEditMode = false;
                        activeControlPoint = null;
                        isDraggingControl = false;
                    }
                }
            } else {
                // El clic fue sobre el cuerpo de la lÃ­nea, no sobre un control
                controlEditMode = false;
                activeControlPoint = null;
                isDraggingControl = false;
                controlDragStart = null;
                opt.target.set({ lockMovementX: false, lockMovementY: false });
            }
        } else {
            // No es una lÃ­nea de medida, resetear estado
            controlEditMode = false;
            activeControlPoint = null;
            isDraggingControl = false;
            controlDragStart = null;
        }
        
        if (opt.target && currentMode === 'smart') {
            if (lastTapTarget === opt.target && (now - lastTapTime < DOUBLE_TAP_DELAY)) {
                // Si no es un control de regla, permitir desbloqueo normal
                if (!opt.target.isMeasureLine || !opt.control) {
                    unlockObject(opt.target);
                    showToast("Movement Unlocked", "warning"); 
                    canvas.requestRenderAll();
                    opt.target.isMoving = true;
                }
            } else {
                if(opt.target.isMeasureLine) { 
                    lockObject(opt.target); 
                    canvas.requestRenderAll(); 
                } else { 
                    lockObject(opt.target); 
                }
            }
            lastTapTarget = opt.target; 
            lastTapTime = now;
        }
        const isTouch = evt.type.startsWith('touch');
        let clientX, clientY;
        if(isTouch) { clientX = evt.touches[0].clientX; clientY = evt.touches[0].clientY; } else { clientX = evt.clientX; clientY = evt.clientY; }

        if(evt.button === 2 || (currentMode === 'smart' && evt.altKey)) {
            evt.preventDefault(); evt.stopPropagation();
            this.isDragging = true; this.selection = false;
            this.lastPosX = clientX; this.lastPosY = clientY;
            if(canvas.isDrawingMode) { canvas.isDrawingMode = false; this.isDrawingModeWasOn = true; }
            canvas.setCursor('grabbing'); 
            return;
        }

        if(currentMode === 'cal' || currentMode === 'measure') {
            if(currentMode === 'cal' && calMode === 'preset') { showToast("Switch to Manual to draw a calibration line", "warning"); return; }
            if(currentMode === 'cal' && calLineObject) { showToast("Delete existing line first", "error"); return; }
            const ptr = canvas.getPointer(evt);
            if (lineState === 0) {
                startPoint = ptr;
                activeLine = new fabric.Line([ptr.x, ptr.y, ptr.x, ptr.y], {
                    stroke: (currentMode === 'cal' ? '#eab308' : '#22c55e'), strokeWidth: 3, 
                    selectable: false, evented: false, excludeFromHistory: true, originX: 'center', originY: 'center' 
                });
                canvas.add(activeLine); lineState = 1; 
            } else finishLineLogic();
            return;
        }
        if(currentMode === 'smart' && (!opt.target || evt.altKey)) {
            this.isDragging = true; this.selection = false;
            this.lastPosX = clientX; this.lastPosY = clientY; canvas.defaultCursor = 'grabbing';
        }
    });

    canvas.on('mouse:move', function(opt) {
        const evt = opt.e;
        const isTouch = evt.type.startsWith('touch');
        if (currentMode === 'measure' && useKonvaRuler) return;
        if(this.isDragging) {
            let clientX, clientY;
            if(isTouch) { evt.preventDefault(); clientX = evt.touches[0].clientX; clientY = evt.touches[0].clientY; } 
            else { clientX = evt.clientX; clientY = evt.clientY; }
                const vpt = this.viewportTransform;
                vpt[4] += clientX - this.lastPosX; vpt[5] += clientY - this.lastPosY;
                this.requestRenderAll();
                this.lastPosX = clientX; this.lastPosY = clientY;
                if (useKonvaRuler) syncKonvaToFabric();
            } else if (lineState === 1 && activeLine) {
            const ptr = canvas.getPointer(evt);
            activeLine.set({ x2: ptr.x, y2: ptr.y });
            // Usar requestAnimationFrame para renderizado suave durante el dibujo
            if (renderAnimationFrame) cancelAnimationFrame(renderAnimationFrame);
            renderAnimationFrame = requestAnimationFrame(() => {
                canvas.requestRenderAll();
                renderAnimationFrame = null;
            });
        }
    });

    canvas.on('mouse:up', function(opt) {
        this.setViewportTransform(this.viewportTransform);
        this.isDragging = false;
        if (currentMode === 'measure' && useKonvaRuler) return;
        
        // Resetear el estado de arrastre de control y restaurar movimiento del objeto
        if (isDraggingControl && opt.target && opt.target.isMeasureLine) {
            // Restaurar el movimiento del objeto
            opt.target.set({ lockMovementX: false, lockMovementY: false });
            // Desactivar modo de ediciÃ³n
            controlEditMode = false;
            activeControlPoint = null;
        }
        
        isDraggingControl = false;
        controlDragStart = null;
        
        // Cancelar cualquier renderizado pendiente
        if (renderAnimationFrame) {
            cancelAnimationFrame(renderAnimationFrame);
            renderAnimationFrame = null;
        }
        
        if (currentMode === 'smart') this.selection = true;
        if(this.isDrawingModeWasOn) { canvas.isDrawingMode = true; this.isDrawingModeWasOn = false; }
        if (lineState === 1 && activeLine) {
            const ptr = canvas.getPointer(opt.e);
            const dist = Math.sqrt(Math.pow(ptr.x - startPoint.x, 2) + Math.pow(ptr.y - startPoint.y, 2));
            if (dist > 10) finishLineLogic();
        }
        canvas.setCursor('default');
    });

    function finishLineLogic() {
        if (currentMode === 'measure' && useKonvaRuler) {
            lineState = 0;
            activeLine = null;
            return;
        }
        lineState = 0;
        const dx = activeLine.x2 - activeLine.x1; const dy = activeLine.y2 - activeLine.y1;
        const distPx = Math.sqrt(dx*dx + dy*dy);
        if (currentMode === 'cal') {
            document.getElementById('cal-actions').style.display = 'flex';
            document.getElementById('cal-hint').style.display = 'none';
            document.getElementById('btn-del-cal').style.display = 'inline-block';
            document.getElementById('cal-val').focus();
            canvas.tempDist = distPx; calLineObject = activeLine; 
        } else if (currentMode === 'measure') {
            const feet = distPx / pixelsPerFoot;
            const textVal = formatFeetForDisplay(feet);
            const midX = (activeLine.x1 + activeLine.x2) / 2;
            const midY = (activeLine.y1 + activeLine.y2) / 2;
            const uniqueId = Date.now();
            const lbl = new fabric.Text(textVal, { left: midX, top: midY - 15, fontSize: 24, fill: '#22c55e', backgroundColor: '#0f172a', originX: 'center', originY: 'center', selectable: false, evented: false, isMeasureLabel: true, id: uniqueId + '_lbl' });
            const line = new fabric.Line([activeLine.x1, activeLine.y1, activeLine.x2, activeLine.y2], { stroke: '#22c55e', strokeWidth: 4, selectable: true, evented: true, originX: 'center', originY: 'center', isMeasureLine: true, labelId: lbl.id, label: lbl, id: uniqueId + '_line' });
            canvas.remove(activeLine); canvas.add(line); canvas.add(lbl);
            lockObject(line); canvas.setActiveObject(line);
            activeLine = null; saveHistory();
        }
    }

    function clearCalLine() {
        if(calLineObject) { canvas.remove(calLineObject); calLineObject = null; }
        document.getElementById('cal-actions').style.display = 'none';
        document.getElementById('cal-hint').style.display = 'block';
        document.getElementById('cal-val').value = '';
        resetScalePresetSelection();
        updateCalHint();
        lineState = 0; activeLine = null; canvas.requestRenderAll();
    }
    
    function finishCal(save) {
        if(save) {
            const val = parseFloat(document.getElementById('cal-val').value);
            if(val > 0) {
                pixelsPerFoot = canvas.tempDist / val;
                localStorage.setItem(getCalKey('data'), pixelsPerFoot);
                localStorage.setItem(getCalKey('scale_label'), 'Custom');
                setScaleDisplay('Custom');
                showToast(`Calibrated! 1 ft = ${pixelsPerFoot.toFixed(2)} px`, "success");
                refreshMeasureLabels();
                clearCalLine();
            } else { showToast("Invalid value", "error"); return; }
        } else clearCalLine();
        resetToolState(); setMode('smart');
    }

    // --- UTILS ---
    function setPenColor(c, el) { canvas.freeDrawingBrush.color = c; document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active')); el.classList.add('active'); }
    function setPenWidth(w) { canvas.freeDrawingBrush.width = parseInt(w); }

    function startPlacementTool(tool) {
        pendingPlacementTool = tool;
        setMode('smart');
        if (!useKonvaRuler) return;
        initKonvaRuler();
        setKonvaActive(true);
        updateKonvaInteractivity();
        if (konvaStage && konvaStage.container()) konvaStage.container().style.cursor = 'crosshair';
        showToast(tool === 'note' ? 'Click where you want to place the note' : 'Click where you want to place the cloud', 'success');
    }

    function clearPlacementTool() {
        pendingPlacementTool = null;
        pendingPlacementStart = null;
        if (pendingPlacementPreview) {
            pendingPlacementPreview.destroy();
            pendingPlacementPreview = null;
            if (konvaLayer) konvaLayer.batchDraw();
        }
        if (konvaStage && konvaStage.container()) konvaStage.container().style.cursor = 'default';
    }

    function addText() {
        setMode('smart');
        if (useKonvaRuler) {
            startPlacementTool('note');
            return;
        }
        const center = canvas.getVpCenter();
        const preset = getResponsiveNotePreset();
        const t = new fabric.Textbox('annotation', {
            left: center.x,
            top: center.y,
            fill: '#ef4444',
            fontSize: preset.fontSize,
            fontWeight: 'normal',
            originX: 'center',
            originY: 'center',
            isNew: true
        });
        lockObject(t); canvas.add(t); canvas.setActiveObject(t); t.selectAll(); t.enterEditing();
        showPropSection('text');
        document.getElementById('text-size-input').value = preset.fontSize;
        document.querySelectorAll('#prop-text .color-dot').forEach(d => d.classList.remove('active'));
        document.querySelector('#prop-text .color-dot[data-col="#ef4444"]').classList.add('active');
    }

    function addCloud() {
        setMode('smart');
        showPropSection('cloud');
        syncCloudStrokeControl();
        if (!useKonvaRuler) return;
        startPlacementTool('cloud');
    }

    function setTextFixedColor(color, el) {
        document.querySelectorAll('#prop-text .color-dot').forEach(d => d.classList.remove('active'));
        el.classList.add('active');
        updateTextProp('fill', color);
    }

    const REPORT_ATTACH_MAX_FILES = 5;
    const REPORT_ATTACH_MAX_BYTES = 10 * 1024 * 1024;
    const REPORT_ATTACH_ALLOWED = [
        /^image\//,
        /^application\/pdf$/,
        /^application\/msword$/,
        /^application\/vnd\.openxmlformats-officedocument\./,
        /^application\/vnd\.ms-excel$/
    ];
    let reportAttachments = [];

    function isAllowedAttachmentType(file) {
        return REPORT_ATTACH_ALLOWED.some(rx => rx.test(file.type || ''));
    }

    function formatBytes(bytes) {
        if (!isFinite(bytes) || bytes <= 0) return '0 B';
        const units = ['B','KB','MB','GB'];
        let i = 0;
        let val = bytes;
        while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
        return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function getAttachmentIcon(file) {
        const type = (file.type || '').toLowerCase();
        if (type.startsWith('image/')) return 'fa-file-image';
        if (type === 'application/pdf') return 'fa-file-pdf';
        if (type.includes('word') || type.includes('officedocument.word')) return 'fa-file-word';
        if (type.includes('excel') || type.includes('spreadsheet')) return 'fa-file-excel';
        return 'fa-file';
    }

    function renderAttachmentPreview() {
        const box = document.getElementById('rep-attachments-preview');
        if (!box) return;
        box.innerHTML = '';
        reportAttachments.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.className = 'd-flex align-items-center justify-content-between p-2 rounded';
            row.style.background = '#111827';
            row.style.border = '1px solid #334155';

            const left = document.createElement('div');
            left.className = 'd-flex align-items-center gap-2';

            if (entry.previewUrl) {
                const img = document.createElement('img');
                img.src = entry.previewUrl;
                img.alt = entry.file.name;
                img.style.width = '44px';
                img.style.height = '44px';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '6px';
                left.appendChild(img);
            } else {
                const icon = document.createElement('i');
                icon.className = `fas ${getAttachmentIcon(entry.file)} text-accent`;
                left.appendChild(icon);
            }

            const meta = document.createElement('div');
            meta.className = 'small';
            meta.innerHTML = `<div class="text-white">${entry.file.name}</div><div class="text-muted">${formatBytes(entry.file.size)}</div>`;
            left.appendChild(meta);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-sm btn-outline-danger';
            btn.innerHTML = '<i class="fas fa-times"></i>';
            btn.onclick = () => {
                if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
                reportAttachments.splice(idx, 1);
                renderAttachmentPreview();
            };

            row.appendChild(left);
            row.appendChild(btn);
            box.appendChild(row);
        });
    }

    function addReportAttachments(fileList) {
        const files = Array.from(fileList || []);
        for (const file of files) {
            if (reportAttachments.length >= REPORT_ATTACH_MAX_FILES) {
                showToast('Maximum 5 attachments per report', 'warning');
                break;
            }
            if (!isAllowedAttachmentType(file)) {
                showToast(`Unsupported file type: ${file.name}`, 'error');
                continue;
            }
            if (file.size > REPORT_ATTACH_MAX_BYTES) {
                showToast(`File exceeds 10MB: ${file.name}`, 'error');
                continue;
            }
            const previewUrl = (file.type || '').startsWith('image/') ? URL.createObjectURL(file) : null;
            reportAttachments.push({ file, previewUrl });
        }
        renderAttachmentPreview();
    }

    function initReportAttachmentUI() {
        const input = document.getElementById('rep-attachments');
        const drop = document.getElementById('rep-attach-dropzone');
        if (!input || !drop || input.dataset.bound === '1') return;

        input.addEventListener('change', (e) => {
            addReportAttachments(e.target.files);
            input.value = '';
        });

        ['dragenter', 'dragover'].forEach(evt => {
            drop.addEventListener(evt, (e) => {
                e.preventDefault();
                e.stopPropagation();
                drop.style.borderColor = '#22c55e';
            });
        });

        ['dragleave', 'drop'].forEach(evt => {
            drop.addEventListener(evt, (e) => {
                e.preventDefault();
                e.stopPropagation();
                drop.style.borderColor = '#475569';
            });
        });

        drop.addEventListener('drop', (e) => {
            addReportAttachments(e.dataTransfer?.files || []);
        });

        input.dataset.bound = '1';
    }

    function resetReportAttachments() {
        reportAttachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
        reportAttachments = [];
        renderAttachmentPreview();
    }

    function openReportModal() {
        saveCurrentPageAnnotations();
        initReportAttachmentUI();
        resetReportAttachments();
        new bootstrap.Modal(document.getElementById('reportModal')).show();
    }

    async function submitReport() {
        const btn = document.getElementById('btn-generate');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Generating...';
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            doc.setFontSize(22); doc.text("Field Activity Report", 20, 20);
            doc.setFontSize(12);
            doc.text(`Project File: <?= $file['filename'] ?>`, 20, 35);
            doc.text(`Technician: ${document.getElementById('rep-name').value}`, 20, 45);
            doc.text(`Role: ${document.getElementById('rep-role').value}`, 20, 55);
            doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 65);
            doc.setFontSize(14); doc.text("Activity Description:", 20, 80);
            doc.setFontSize(11);
            const desc = document.getElementById('rep-desc').value;
            const splitText = doc.splitTextToSize(desc, 170);
            doc.text(splitText, 20, 90);
            if (reportAttachments.length > 0) {
                const names = reportAttachments.map(a => `- ${a.file.name}`);
                doc.setFontSize(12);
                doc.text('Attachments:', 20, 118);
                doc.setFontSize(10);
                doc.text(doc.splitTextToSize(names.join('\n'), 170), 20, 126);
            }
            const dataUrl = canvas.toDataURL({ format: 'jpeg', quality: 0.8 });
            doc.addPage();
            doc.text("Plan Snapshot (Current View)", 20, 20);
            const imgProps = doc.getImageProperties(dataUrl);
            const pdfWidth = doc.internal.pageSize.getWidth() - 40;
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            doc.addImage(dataUrl, 'JPEG', 20, 30, pdfWidth, pdfHeight);
            const pdfBlob = doc.output('blob');
            const annotationsJson = JSON.stringify(allAnnotations);
            const fd = new FormData();
            fd.append('action', 'save_report_flow');
            fd.append('file_id', fileId);
            fd.append('pdf_file', pdfBlob);
            fd.append('annotations_json', annotationsJson);
            fd.append('tech_name', document.getElementById('rep-name').value);
            fd.append('tech_role', document.getElementById('rep-role').value);
            fd.append('description', desc);
            reportAttachments.forEach(a => fd.append('attachments[]', a.file, a.file.name));
            const res = await fetch('../api/api.php', { method: 'POST', body: fd });
            const d = await res.json();
            if(d.status === 'success') {
                showToast("Report saved successfully!", "success");
                setTimeout(() => location.href = "preview.php?id=" + fileId, 1500);
            } else { showToast("Error saving report: " + d.msg, "error"); btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Generate Report'; }
        } catch (e) { console.error(e); showToast("Critical Error generating report", "error"); btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Generate Report'; }
    }

    function showToast(msg, type) {
        const box = document.getElementById('toast-container');
        if (!box) return;
        const key = `${type || 'info'}:${msg}`;
        const duplicate = [...box.querySelectorAll('.toast-msg')].find(item => item.dataset.toastKey === key);
        if (duplicate) return;
        if (type === 'warning') box.querySelectorAll('.toast-msg[data-toast-type="warning"]').forEach(item => item.remove());
        while (box.children.length >= 2) box.firstElementChild.remove();
        const el = document.createElement('div'); el.className = `toast-msg`;
        el.dataset.toastKey = key;
        el.dataset.toastType = type || 'info';
        el.style.borderLeft = `4px solid ${type==='success'?'#10b981': (type==='warning'?'#eab308':'#ef4444')}`;
        let icon = '<i class="fas fa-check-circle text-success"></i>';
        if(type === 'error') icon = '<i class="fas fa-exclamation-circle text-danger"></i>';
        if(type === 'warning') icon = '<i class="fas fa-lock-open text-warning"></i>';
        el.innerHTML = icon;
        const message = document.createElement('span');
        message.textContent = msg;
        el.appendChild(message);
        box.appendChild(el); setTimeout(() => el.remove(), 4000);
    }

    function updateTextProp(prop, val) {
        if (konvaSelectedNote && konvaSelectedNote.label) {
            if (prop === 'fill') konvaSelectedNote.label.fill(val);
            if (prop === 'fontSize') konvaSelectedNote.label.fontSize(parseInt(val, 10) || konvaSelectedNote.label.fontSize());
            if (konvaLayer) konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
            return;
        }
        const active = canvas.getActiveObject();
        if(active && (active.type === 'i-text' || active.type === 'text' || active.type === 'textbox')) { active.set(prop, val); canvas.requestRenderAll(); }
    }

    function updateTextScales(zoom) {
        const scale = Math.min(1.5, Math.max(0.2, 1 / zoom));
        canvas.getObjects().forEach(obj => {
            if (obj.isMeasureLabel) { obj.set({ scaleX: scale, scaleY: scale }); }
            if (obj.isMeasureLine) { obj.set({ strokeWidth: 4 * scale }); }
        });
        canvas.requestRenderAll();
        if (useKonvaRuler) syncKonvaToFabric();
    }

    function handleSelectionChange() {
        const active = canvas.getActiveObject();
        if (active) {
            if(active.type === 'i-text' || active.type === 'text' || active.type === 'textbox') {
                const sInp = document.getElementById('text-size-input');
                if(sInp) sInp.value = active.fontSize;
                const currentColor = active.fill;
                document.querySelectorAll('#prop-text .color-dot').forEach(d => {
                    d.classList.remove('active');
                    if(d.getAttribute('data-col').toLowerCase() === currentColor.toLowerCase()) { d.classList.add('active'); }
                });
                showPropSection('text');
            } else { showPropSection('smart'); }
        } else { showPropSection(currentMode); }
        keepScaleDisplayVisible();
    }

    canvas.on('selection:created', handleSelectionChange);
    canvas.on('selection:updated', handleSelectionChange);
    canvas.on('selection:cleared', handleSelectionChange);
    
    // Interceptar transformaciones para verificar si estamos manipulando un control
    canvas.on('before:transform', function(e) {
        const obj = e.target;
        if (obj && obj.isMeasureLine) {
            // Asegurar que las transformaciones no deseadas estÃ©n bloqueadas
            obj.set({ lockRotation: true, lockScalingX: true, lockScalingY: true });
            
            // Si estamos en modo de ediciÃ³n (doble clic en vÃ©rtice), bloquear movimiento del objeto
            if (isDraggingControl && controlEditMode) {
                obj.set({ lockMovementX: true, lockMovementY: true });
            } else {
                // Si no es modo de ediciÃ³n, permitir movimiento del objeto
                obj.set({ lockMovementX: false, lockMovementY: false });
            }
        }
    });
    
    // Detectar cuando se estÃ¡ modificando (durante el arrastre)
    canvas.on('object:modifying', function(e) {
        const obj = e.target;
        if (obj && obj.isMeasureLine && isDraggingControl && controlEditMode) {
            // Cancelar renderizado anterior si existe
            if (renderAnimationFrame) {
                cancelAnimationFrame(renderAnimationFrame);
            }
            
            // Usar requestAnimationFrame para renderizado suave sin trazos impresos
            renderAnimationFrame = requestAnimationFrame(() => {
                // Actualizar la etiqueta de mediciÃ³n en tiempo real mientras se arrastra un control
                updateMeasureLabel(obj);
                // Usar requestRenderAll para renderizado suave
                canvas.requestRenderAll();
                renderAnimationFrame = null;
            });
        }
    });
    
    // Detectar cuando se completa una transformaciÃ³n para restaurar el estado
    canvas.on('object:modified', function(e) {
        const obj = e.target;
        if (obj && obj.isMeasureLine) {
            // Cancelar cualquier renderizado pendiente
            if (renderAnimationFrame) {
                cancelAnimationFrame(renderAnimationFrame);
                renderAnimationFrame = null;
            }
            
            // Actualizar la etiqueta final con renderizado suave
            requestAnimationFrame(() => {
                updateMeasureLabel(obj);
                canvas.requestRenderAll();
            });
            
            // Restaurar el movimiento del objeto despuÃ©s de modificar
            obj.set({ lockMovementX: false, lockMovementY: false });
            
            // Guardar en historial si fue una modificaciÃ³n de control
            if (isDraggingControl && controlEditMode) {
                saveHistory();
            }
            
            // Resetear estado de ediciÃ³n
            controlEditMode = false;
            activeControlPoint = null;
            isDraggingControl = false;
            controlDragStart = null;
        }
    }); 

    window.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
        if(e.key === 'Delete' || e.key === 'Backspace') {
            if (window.projectTakeoffHandleDeleteKey?.(e)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            const activeObj = canvas.getActiveObject();
            if (activeObj && activeObj.isEditing) return; 
            if (e.target?.matches?.('input, textarea, select, option, [contenteditable="true"], [role="textbox"]')) return;
            e.preventDefault(); deleteSelected(); 
        }
    });

    canvas.on('mouse:wheel', function(opt) {
        let delta = opt.e.deltaY; let zoom = canvas.getZoom() * (0.999 ** delta);
        if (zoom > 20) zoom = 20; if (zoom < 0.05) zoom = 0.05;
        canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        notifyTakeoffZoomChanged('wheel');
        if (useKonvaRuler) syncKonvaToFabric();
        updateTextScales(zoom);
        schedulePdfRerender();
        opt.e.preventDefault(); opt.e.stopPropagation();
    });

    window.addEventListener('beforeunload', () => {
        saveCurrentPageAnnotations();
        pdfBitmapCache.forEach(bitmap => { if (bitmap?.url) URL.revokeObjectURL(bitmap.url); });
        pdfBitmapCache.clear();
    });
    window.addEventListener('pagehide', () => {
        saveCurrentPageAnnotations();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveCurrentPageAnnotations();
    });

</script>
<script src="../assets/editor/takeoff.js?v=takeoff-zoom-notify-20260805-1"></script>
</body>
</html>

