<?php
require_once __DIR__ . '/company_tools_data.php';
$companyToolsCategories = company_tools_existing_categories();
$favoriteTools = company_tools_favorites();
$bidBoardPath = company_tools_bid_board_path();
$currentPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
?>
<header class="bt-global-header" data-global-tools-header>
    <div class="bt-global-left">
        <a class="bt-brand" href="bid_board.php" aria-label="Brightronix Home">
            <img src="../assets/logo-text.png" alt="Brightronix" class="bt-brand-logo" onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src='../assets/images/logo-text.png';}else{this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='inline';}">
            <span class="bt-brand-text" style="display:none;">Brightronix</span>
        </a>
        <div class="bt-nav-divider"></div>
        <div class="bt-menu-wrap">
            <button class="bt-selector" type="button" data-global-menu-toggle="company" aria-expanded="false" aria-label="Select company or project">
                <div class="bt-picker-lines">
                    <span class="bt-picker-top">Brightronix LLC</span>
                    <strong class="bt-picker-bottom">Select a Project</strong>
                </div>
                <i class="fas fa-caret-down bt-picker-caret"></i>
            </button>
            <div class="bt-small-menu" data-global-menu="company">
                <a href="index.php">
                    <i class="fas fa-building"></i>
                    <span>Brightronix LLC</span>
                </a>
                <a href="projects.php">
                    <i class="fas fa-folder-open"></i>
                    <span>Select a Project</span>
                </a>
                <a href="company_settings.php">
                    <i class="fas fa-gear"></i>
                    <span>Company Settings</span>
                </a>
            </div>
        </div>
        <div class="bt-nav-divider"></div>
        <div class="bt-menu-wrap bt-tools-wrap">
            <button class="bt-selector bt-company-tools-trigger" type="button" data-global-menu-toggle="tools" aria-expanded="false">
                <div class="bt-picker-lines">
                    <span class="bt-picker-top">Company Tools</span>
                    <strong class="bt-picker-bottom">Bid Board</strong>
                </div>
                <i class="fas fa-caret-down bt-picker-caret"></i>
            </button>
            <div class="bt-tools-mega bt-tools-limited" data-global-menu="tools">
                <div class="bt-tools-eyebrow">Select a tool</div>
                <div class="bt-tools-grid">
                    <?php foreach ($companyToolsCategories as $category): ?>
                        <section class="bt-tools-col">
                            <h2><?= htmlspecialchars($category['title']) ?></h2>
                            <div class="bt-tools-rule"></div>
                            <nav>
                                <?php foreach ($category['links'] as $link): ?>
                                    <?php 
                                        $linkPath = $link['path'] ?? '';
                                        $resolvedPath = (strpos($linkPath, '/pages/') === 0) ? basename($linkPath) : $linkPath;
                                        $isActive = $currentPath === $linkPath || basename($currentPath) === $resolvedPath; 
                                    ?>
                                    <a class="<?= $isActive ? 'active' : '' ?>" href="<?= htmlspecialchars($resolvedPath) ?>">
                                        <i class="<?= htmlspecialchars($link['icon'] ?? 'fas fa-circle') ?>"></i>
                                        <span><?= htmlspecialchars($link['label']) ?></span>
                                    </a>
                                <?php endforeach; ?>
                            </nav>
                        </section>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
        <div class="bt-nav-divider"></div>
        <!-- Favorites horizontal tab bar (Procore style) -->
        <div class="bt-favorites-procore">
            <div class="bt-fav-star"><i class="fas fa-star"></i></div>
            <div class="bt-fav-container">
                <div class="bt-fav-label">Favorites</div>
                <nav class="bt-fav-tabs" aria-label="Favorites navigation">
                    <a href="bid_board.php" class="bt-fav-tab <?= (strpos($currentPath, 'bid_board') !== false || $currentPath === '/' || $currentPath === '') ? 'active' : '' ?>">Bid Board</a>
                    <a href="cost_catalog.php" class="bt-fav-tab <?= strpos($currentPath, 'cost_catalog') !== false ? 'active' : '' ?>">Cost Catalog</a>
                    <a href="project_dashboard.php?id=1" class="bt-fav-tab <?= strpos($currentPath, 'project_dashboard') !== false ? 'active' : '' ?>">Equipment</a>
                    <a href="projects.php" class="bt-fav-tab <?= strpos($currentPath, 'projects.php') !== false ? 'active' : '' ?>">360 Reporting</a>
                    <a href="archivos.php" class="bt-fav-tab <?= strpos($currentPath, 'archivos') !== false ? 'active' : '' ?>">Documents</a>
                </nav>
            </div>
        </div>
    </div>
    <div class="bt-global-right">
        <div class="bt-menu-wrap">
            <button class="bt-selector" type="button" data-global-menu-toggle="apps" aria-expanded="false" aria-label="Select tool">
                <div class="bt-picker-lines">
                    <span class="bt-picker-top">Tools</span>
                    <strong class="bt-picker-bottom">Select a Tool</strong>
                </div>
                <i class="fas fa-caret-down bt-picker-caret"></i>
            </button>
            <div class="bt-small-menu bt-align-right" data-global-menu="apps">
                <a href="cost_catalog.php">
                    <i class="fas fa-box-archive"></i>
                    <span>Catalog update</span>
                </a>
                <a href="project_dashboard.php?tab=takeoff">
                    <i class="fas fa-cubes"></i>
                    <span>Material Extraction</span>
                </a>
                <a href="editor.php">
                    <i class="fas fa-draw-polygon"></i>
                    <span>Room Designer</span>
                </a>
                <div style="height: 1px; background: rgba(0,0,0,0.08); margin: 4px 0;"></div>
                <a href="company_tools.php">
                    <i class="fas fa-grip"></i>
                    <span>Company Tools</span>
                </a>
                <a href="projects.php">
                    <i class="fas fa-briefcase"></i>
                    <span>Portfolio</span>
                </a>
            </div>
        </div>
        <button class="bt-icon-procore" type="button" title="Support & Feedback" aria-label="Support & Feedback"><i class="far fa-circle-question"></i></button>
        <a href="directorio.php" class="bt-icon-procore" title="My Open Items" aria-label="My Open Items"><i class="fas fa-list-check"></i></a>
        <button class="bt-icon-procore" type="button" title="Announcements" aria-label="Announcements"><i class="far fa-bell"></i></button>
        <div class="bt-menu-wrap">
            <button class="bt-avatar-procore" type="button" data-global-menu-toggle="user" aria-expanded="false" aria-label="Account & Profile">
                <span>ID</span>
            </button>
            <div class="bt-small-menu bt-align-right" data-global-menu="user">
                <button class="bt-menu-action" type="button">
                    <i class="fas fa-user"></i>
                    <span>Profile (Admin)</span>
                </button>
                <button class="bt-menu-action" type="button" data-theme-toggle>
                    <i class="fas fa-moon"></i>
                    <span>Dark Mode</span>
                </button>
                <a href="company_settings.php">
                    <i class="fas fa-sliders"></i>
                    <span>Settings</span>
                </a>
                <button class="bt-menu-action" type="button">
                    <i class="fas fa-right-from-bracket"></i>
                    <span>Sign out</span>
                </button>
            </div>
        </div>
    </div>
</header>
<script>
(function () {
    var key = 'takeoff.theme';
    var saved = null;
    try {
        saved = localStorage.getItem(key);
    } catch (error) {}
    var theme = saved === 'dark' || saved === 'light' ? saved : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    if (document.body) {
        document.body.classList.toggle('theme-light', theme === 'light');
        document.body.classList.toggle('theme-dark', theme === 'dark');
    }

    function syncThemeButton() {
        var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (document.body) {
            document.body.classList.toggle('theme-light', !isDark);
            document.body.classList.toggle('theme-dark', isDark);
        }
        document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
            var label = button.querySelector('span');
            if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
            var icon = button.querySelector('i');
            if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        });
    }

    document.addEventListener('click', function (event) {
        var button = event.target.closest('[data-theme-toggle]');
        if (!button) return;
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        if (document.body) {
            document.body.classList.toggle('theme-light', next === 'light');
            document.body.classList.toggle('theme-dark', next === 'dark');
        }
        try {
            localStorage.setItem(key, next);
        } catch (error) {}
        syncThemeButton();
    });

    document.addEventListener('DOMContentLoaded', syncThemeButton);
    syncThemeButton();
})();
</script>
