<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title><?= isset($pageTitle) ? $pageTitle : 'Brightronix | Workspace' ?></title>
    
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    
    <style>
        /* --- 1. VARIABLES Y BASE --- */
        :root { --bg-body: #0b1120; --bg-sidebar: #111827; --bg-card: #1e293b; --bg-card-hover: #334155; --primary: #6366f1; --primary-hover: #4f46e5; --accent: #0ea5e9; --text-white: #ffffff; --text-gray: #94a3b8; --radius-box: 20px; --radius-btn: 50px; }
        body { background-color: var(--bg-body); color: var(--text-white); font-family: 'Outfit', sans-serif; overflow-x: hidden; }
        a { text-decoration: none; color: inherit; }
        
        /* Wrapper principal */
        .d-flex-wrapper { display: flex; min-height: 100vh; width: 100%; }
        
        /* --- 2. SIDEBAR (MODIFICADO PARA RESPONSIVE) --- */
        .sidebar { 
            width: 260px; 
            background: var(--bg-sidebar); 
            padding: 30px 20px; 
            display: flex; 
            flex-direction: column; 
            border-right: 1px solid rgba(255,255,255,0.05); 
            position: fixed; 
            top: 0; left: 0;
            height: 100vh; 
            z-index: 1050;
            overflow-y: auto; 
            transition: transform 0.3s ease, width 0.25s ease, padding 0.25s ease;
            transform: translateX(0);
        }

        .brand { font-size: 1.5rem; font-weight: 700; margin-bottom: 50px; display: flex; align-items: center; gap: 12px; color: white; }
        .brand-icon { width: 40px; height: 40px; background: linear-gradient(135deg, var(--primary), var(--accent)); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        
        .menu-item { padding: 14px 20px; border-radius: var(--radius-box); color: var(--text-gray); font-weight: 500; font-size: 0.95rem; margin-bottom: 8px; display: flex; align-items: center; gap: 15px; transition: all 0.3s ease; }
        .menu-item:hover { background: rgba(255,255,255,0.05); color: white; transform: translateX(5px); }
        .menu-item.active { background: var(--primary); color: white; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3); }
        .menu-item i { width: 20px; text-align: center; }
        .menu-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .sidebar-toggle {
            position: fixed;
            top: 14px;
            left: 274px;
            z-index: 1200;
            width: 36px;
            height: 36px;
            border-radius: 999px;
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(17,24,39,.92);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: left .25s ease;
        }

        body.sidebar-collapsed .sidebar { width: 78px; padding: 24px 10px; }
        body.sidebar-collapsed .brand { justify-content: center; }
        body.sidebar-collapsed .brand-text,
        body.sidebar-collapsed .menu-label { display: none; }
        body.sidebar-collapsed .menu-item { justify-content: center; padding: 14px 10px; gap: 0; }
        body.sidebar-collapsed .menu-item i { margin-right: 0 !important; }
        body.sidebar-collapsed .main-content { margin-left: 78px; width: calc(100% - 78px); }
        body.sidebar-collapsed .sidebar-toggle { left: 92px; }

        /* --- 3. LAYOUT PRINCIPAL (MODIFICADO PARA RESPONSIVE) --- */
        .main-content { 
            margin-left: 260px; /* Espacio para el sidebar fijo */
            width: calc(100% - 260px); /* Ancho restante */
            padding: 40px; 
            padding-bottom: 100px; 
            min-height: 100vh; 
            transition: margin-left 0.3s ease, width 0.3s ease;
        }

        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
        .breadcrumbs { color: var(--text-gray); font-size: 0.9rem; }
        .breadcrumbs span { color: white; font-weight: 600; }
        
        .user-pill { background: var(--bg-card); padding: 8px 15px; border-radius: var(--radius-btn); display: flex; align-items: center; gap: 10px; border: 1px solid rgba(255,255,255,0.1); }
        .avatar { width: 32px; height: 32px; background: var(--accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: bold; }
        .role-badge { font-size: 0.65rem; text-transform: uppercase; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; color: var(--accent); margin-left: 5px; }

        /* --- 4. COMPONENTES GLOBALES --- */
        .box-card { background: var(--bg-card); border-radius: var(--radius-box); padding: 25px; height: 100%; border: 1px solid rgba(255,255,255,0.05); transition: 0.3s; position: relative; overflow: hidden; }
        .box-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); background: var(--bg-card-hover); }
        .box-card.selected { border: 2px solid var(--primary); background: rgba(99, 102, 241, 0.1); }
        .selection-check { position: absolute; top: 15px; right: 15px; width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; }
        .box-card.selected .selection-check { background: var(--primary); border-color: var(--primary); }
        .box-card.selected .selection-check::after { content: '\f00c'; font-family: "Font Awesome 6 Free"; font-weight: 900; font-size: 0.7rem; color: white; }

        .btn-main { background: var(--primary); color: white; padding: 10px 25px; border-radius: var(--radius-btn); font-weight: 600; border: none; transition: 0.3s; }
        .btn-main:hover { background: var(--primary-hover); transform: translateY(-2px); }
        .btn-icon { width: 35px; height: 35px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); color: white; display: flex; align-items: center; justify-content: center; background: transparent; transition: 0.2s; }
        .btn-icon:hover { background: white; color: var(--bg-body); border-color: white; }
        .btn-back { width: 45px; height: 45px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.15); color: white; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); transition: 0.2s; font-size: 1.1rem; }
        .btn-back:hover { background: var(--primary); border-color: var(--primary); }

        .modal-content { background: var(--bg-card); border-radius: var(--radius-box); border: 1px solid rgba(255,255,255,0.1); color: white; }
        .form-control { background: var(--bg-body); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: white; padding: 12px; }
        .btn-close { filter: invert(1); }
        
        /* --- 5. COMPONENTES GRÁFICOS RESTAURADOS --- */
        .stat-num { font-size: 2.5rem; font-weight: 700; color: white; line-height: 1; margin-bottom: 5px; }
        .stat-label { color: var(--text-gray); font-size: 0.9rem; font-weight: 500; }
        .stat-icon-bg { position: absolute; right: -10px; bottom: -10px; font-size: 5rem; opacity: 0.05; transform: rotate(-15deg); }
        .proj-status { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #4ade80; background: rgba(74, 222, 128, 0.1); padding: 4px 10px; border-radius: 10px; display: inline-block; margin-bottom: 15px; }
        .proj-title { font-size: 1.2rem; font-weight: 700; color: white; margin-bottom: 8px; }
        .proj-desc { color: var(--text-gray); font-size: 0.9rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .box-card-dashed { background: transparent; border: 2px dashed rgba(255,255,255,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-gray); cursor: pointer; }
        .box-card-dashed:hover { border-color: var(--primary); color: var(--primary); background: rgba(99, 102, 241, 0.05); }
        .folder-card { cursor: pointer; transition: 0.2s; text-decoration: none; }
        .folder-card:hover .folder-icon { transform: scale(1.1); color: #facc15; }
        .folder-icon { transition: 0.2s; color: #eab308; } 
        .file-tile { width: 70px; height: 85px; margin: 0 auto 15px auto; border-radius: 12px; display: flex; align-items: center; justify-content: center; position: relative; }
        .file-tile.pdf { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); } .file-tile.pdf i { color: #f87171; font-size: 2.2rem; }
        .file-tile.img { background: rgba(14, 165, 233, 0.15); border: 1px solid rgba(14, 165, 233, 0.3); } .file-tile.img i { color: #38bdf8; font-size: 2.2rem; }
        .file-tile.file-gen { background: rgba(148, 163, 184, 0.15); border: 1px solid rgba(148, 163, 184, 0.3); } .file-tile.file-gen i { color: #cbd5e1; font-size: 2.2rem; }
        .version-badge { position: absolute; top: -5px; right: -5px; background: #6366f1; color: white; font-size: 0.65rem; font-weight: bold; padding: 2px 6px; border-radius: 10px; border: 2px solid var(--bg-card); box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
        
        .bulk-actions-bar { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(150%); background: var(--bg-sidebar); border: 1px solid rgba(255,255,255,0.1); padding: 15px 30px; border-radius: 50px; display: flex; align-items: center; gap: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); z-index: 1000; transition: 0.3s; }
        .bulk-actions-bar.visible { transform: translateX(-50%) translateY(0); }

        /* --- 6. MOBILE RESPONSIVE LOGIC (NUEVO) --- */
        .mobile-toggle { display: none; border: none; background: none; color: white; font-size: 1.5rem; cursor: pointer; }
        .sidebar-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 1040; backdrop-filter: blur(3px); }
        .sidebar-overlay.show { display: block; }

        @media (max-width: 991.98px) {
            .sidebar { transform: translateX(-100%); width: 280px; }
            .sidebar.show { transform: translateX(0); box-shadow: 10px 0 30px rgba(0,0,0,0.5); }
            .main-content { margin-left: 0 !important; width: 100% !important; padding: 20px; }
            .mobile-toggle { display: block; }
            .sidebar-toggle { display: none; }
        }
    </style>
</head>
<body>

<div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleSidebar()"></div>
<button id="sidebarCollapseBtn" class="sidebar-toggle" type="button" onclick="toggleSidebarDesktop()" aria-label="Toggle sidebar">
    <i class="fas fa-angle-left"></i>
</button>

<script>
    function toggleSidebar() {
        document.querySelector('.sidebar').classList.toggle('show');
        document.getElementById('sidebarOverlay').classList.toggle('show');
    }

    function syncSidebarToggleIcon() {
        const btn = document.getElementById('sidebarCollapseBtn');
        if (!btn) return;
        const icon = btn.querySelector('i');
        const collapsed = document.body.classList.contains('sidebar-collapsed');
        if (icon) icon.className = collapsed ? 'fas fa-angle-right' : 'fas fa-angle-left';
    }

    function toggleSidebarDesktop() {
        document.body.classList.toggle('sidebar-collapsed');
        try {
            localStorage.setItem('mainSidebarCollapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
        } catch (e) {}
        syncSidebarToggleIcon();
    }

    document.addEventListener('DOMContentLoaded', function() {
        if (window.matchMedia('(min-width: 992px)').matches) {
            try {
                if (localStorage.getItem('mainSidebarCollapsed') === '1') {
                    document.body.classList.add('sidebar-collapsed');
                }
            } catch (e) {}
        }
        syncSidebarToggleIcon();
    });
</script>

<div class="d-flex-wrapper">
    <?php include __DIR__ . '/sidebar.php'; ?>
