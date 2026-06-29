<?php
// sidebar.php - Barra lateral centralizada e inteligente
// Detectamos el script actual y los parámetros
$currentScript = basename($_SERVER['PHP_SELF']);
$pId   = $_GET['project_id'] ?? null;
$view  = $_GET['view'] ?? '';

// Lógica de Estado Activo (Calculamos qué botón encender)
$isTrash     = ($view === 'trash');
$isTimeline  = ($currentScript === 'timeline.php');
$isSettings  = ($currentScript === 'settings.php');
$isProjects  = ($currentScript === 'projects.php' || ($currentScript === 'index.php' && $pId));
$isDirectory = ($currentScript === 'directorio.php');
$isFiles     = ($currentScript === 'archivos.php');
$isTools     = ($currentScript === 'company_tools.php');
// Dashboard solo se enciende si es index.php Y no hay proyecto Y no es papelera
$isDashboard = ($currentScript === 'index.php' && !$pId && !$isTrash);

// Definimos si el usuario es admin (asumiendo que $isAdmin viene del archivo padre, si no, lo recalculamos seguro)
$userRoleRawSidebar = $_SESSION['role'] ?? 'viewer';
$isAdminSidebar = (strtolower($userRoleRawSidebar) === 'admin');
?>

<nav class="sidebar" id="mainSidebar">
    <div class="brand">
        <div class="brand-icon"><i class="fas fa-bolt"></i></div>
        <span class="brand-text">Brightronix</span>
    </div>
    
    <div class="flex-grow-1">
        <a href="../pages/company_tools.php" class="menu-item <?= $isTools ? 'active' : '' ?>">
            <i class="fas fa-grip"></i><span class="menu-label">Company Tools</span>
        </a>

        <a href="../pages/takeoff.php" class="menu-item <?= $isDashboard ? 'active' : '' ?>">
            <i class="fas fa-ruler-combined"></i><span class="menu-label">Takeoff</span>
        </a>
        
        <a href="../pages/archivos.php" class="menu-item <?= $isFiles ? 'active' : '' ?>">
            <i class="fas fa-file-pdf"></i><span class="menu-label">All PDFs</span>
        </a>
    </div>
</nav>
