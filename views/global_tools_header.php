<?php
require_once __DIR__ . '/company_tools_data.php';
$companyToolsCategories = company_tools_existing_categories();
$favoriteTools = array_slice(company_tools_favorites(), 0, 5);
$bidBoardPath = company_tools_bid_board_path();
$currentPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
?>
<header class="bt-global-header bt-floating-header" data-global-tools-header>
    <div class="bt-global-left">
        <div class="bt-menu-wrap bt-tools-wrap">
            <button class="bt-selector bt-company-tools-trigger" type="button" data-global-menu-toggle="tools" aria-expanded="false" aria-label="Company Tools">
                <div class="bt-picker-lines">
                    <span class="bt-picker-top">Brightronix LLC</span>
                    <strong class="bt-picker-bottom">Company Tools</strong>
                </div>
                <i class="fas fa-caret-down bt-picker-caret"></i>
            </button>
            <div class="bt-tools-mega bt-tools-limited" data-global-menu="tools">
                <div class="bt-tools-eyebrow">Company Tools</div>
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
                                        $toolId = $link['id'] ?? basename($resolvedPath, '.php');
                                        $isFav = false;
                                        foreach ($favoriteTools as $fav) {
                                            if (($fav['id'] ?? '') === $toolId || ($fav['label'] ?? '') === ($link['label'] ?? '')) {
                                                $isFav = true;
                                                break;
                                            }
                                        }
                                    ?>
                                    <div class="bt-tool-row <?= $isActive ? 'active' : '' ?>" data-tool-row="<?= htmlspecialchars($toolId) ?>">
                                        <a class="bt-tool-link" href="<?= htmlspecialchars($resolvedPath) ?>">
                                            <i class="<?= htmlspecialchars($link['icon'] ?? 'fas fa-circle') ?>"></i>
                                            <span><?= htmlspecialchars($link['label']) ?></span>
                                        </a>
                                        <button type="button" class="bt-tool-fav-btn <?= $isFav ? 'active' : '' ?>" data-tool-fav-btn data-tool-id="<?= htmlspecialchars($toolId) ?>" data-tool-label="<?= htmlspecialchars($link['label']) ?>" data-tool-path="<?= htmlspecialchars($resolvedPath) ?>" data-tool-icon="<?= htmlspecialchars($link['icon'] ?? 'fas fa-circle') ?>" title="<?= $isFav ? 'Remove from favorites' : 'Add to favorites' ?>" aria-label="Toggle favorite for <?= htmlspecialchars($link['label']) ?>">
                                            <i class="fas fa-star"></i>
                                        </button>
                                    </div>
                                <?php endforeach; ?>
                            </nav>
                        </section>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
        <div class="bt-nav-divider"></div>
        <!-- Favorites horizontal tab bar (Dynamic from Company Tools, Max 5) -->
        <div class="bt-favorites" id="btCompanyFavorites">
            <button class="bt-fav-star-btn" type="button" data-global-menu-toggle="favs" aria-expanded="false" title="Favorites">
                <i class="fas fa-star"></i>
            </button>
            <div class="bt-fav-container">
                <div class="bt-fav-label">Favorites</div>
                <nav class="bt-fav-tabs" id="btFavTabs" aria-label="Favorites navigation">
                    <?php foreach ($favoriteTools as $fav): ?>
                        <?php 
                            $favPath = $fav['path'] ?? '';
                            $resolvedFavPath = (strpos($favPath, '/pages/') === 0) ? basename($favPath) : $favPath;
                            $isFavActive = $currentPath === $favPath || basename($currentPath) === $resolvedFavPath;
                            $favId = $fav['id'] ?? basename($resolvedFavPath, '.php');
                        ?>
                        <a href="<?= htmlspecialchars($resolvedFavPath) ?>" class="bt-fav-tab <?= $isFavActive ? 'active' : '' ?>" data-fav-id="<?= htmlspecialchars($favId) ?>"><?= htmlspecialchars($fav['label']) ?></a>
                    <?php endforeach; ?>
                </nav>
                <div class="bt-fav-more-wrap" id="btFavMoreWrap" style="display: none;">
                    <button class="bt-fav-more-btn" type="button" data-global-menu-toggle="favs_more" aria-expanded="false" title="More favorites">
                        <i class="fas fa-plus"></i>
                    </button>
                    <div class="bt-small-menu bt-fav-more-menu" data-global-menu="favs_more" id="btFavMoreMenu"></div>
                </div>
            </div>
            <!-- Tablet/Mobile Dropdown for favorites -->
            <div class="bt-small-menu bt-fav-mobile-menu" data-global-menu="favs" id="btFavMobileMenu">
                <div class="bt-tools-eyebrow" style="margin: 4px 10px 8px;">Favorites</div>
                <nav id="btFavMobileList" style="display: grid; gap: 2px;">
                    <?php foreach ($favoriteTools as $fav): ?>
                        <?php 
                            $favPath = $fav['path'] ?? '';
                            $resolvedFavPath = (strpos($favPath, '/pages/') === 0) ? basename($favPath) : $favPath;
                        ?>
                        <a class="bt-tool-link" href="<?= htmlspecialchars($resolvedFavPath) ?>">
                            <i class="<?= htmlspecialchars($fav['icon'] ?? 'fas fa-star') ?>"></i>
                            <span><?= htmlspecialchars($fav['label']) ?></span>
                        </a>
                    <?php endforeach; ?>
                </nav>
            </div>
        </div>
    </div>

    <!-- Center: Brand Logo & Subtitle Centered Vertically & Horizontally -->
    <div class="bt-global-center">
        <a class="bt-brand" href="bid_board.php" aria-label="Brightronix Estimating Hub">
            <div class="bt-brand-block">
                <img src="../assets/logo-text.png" alt="Brightronix" class="bt-brand-logo" onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src='../assets/images/logo-text.png';}else{this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='inline';}">
                <span class="bt-brand-text" style="display:none;">Brightronix</span>
                <span class="bt-brand-subtitle">Estimating Hub</span>
            </div>
        </a>
    </div>

    <div class="bt-global-right">
        <?php
        $quickToolsList = [
            ['id' => 'cost_catalog', 'label' => 'Catalog Update', 'path' => 'cost_catalog.php', 'icon' => 'fas fa-box-archive'],
            ['id' => 'takeoff', 'label' => 'Material Extraction', 'path' => 'project_dashboard.php?tab=takeoff', 'icon' => 'fas fa-cubes'],
            ['id' => 'editor', 'label' => 'Room Designer', 'path' => 'editor.php', 'icon' => 'fas fa-draw-polygon'],
            ['id' => 'projects', 'label' => 'Portfolio', 'path' => 'projects.php', 'icon' => 'fas fa-briefcase'],
        ];
        $defaultAppFavorites = [
            $quickToolsList[1],
            $quickToolsList[2]
        ];
        ?>
        <!-- Tools Favorites Bar (Symmetrically on the left of Tools, balancing the header, Max 3) -->
        <div class="bt-favorites bt-app-favorites" id="btAppFavorites">
            <button class="bt-fav-star-btn" type="button" data-global-menu-toggle="app_favs" aria-expanded="false" title="Tools Favorites">
                <i class="fas fa-star"></i>
            </button>
            <div class="bt-fav-container">
                <div class="bt-fav-label">Favorites</div>
                <nav class="bt-fav-tabs" id="btAppFavTabs" aria-label="Tools Favorites navigation">
                    <?php foreach ($defaultAppFavorites as $fav): ?>
                        <?php 
                            $favPath = $fav['path'] ?? '';
                            $isFavActive = strpos($currentPath, $favPath) !== false;
                        ?>
                        <a href="<?= htmlspecialchars($fav['path']) ?>" class="bt-fav-tab <?= $isFavActive ? 'active' : '' ?>" data-app-fav-id="<?= htmlspecialchars($fav['id']) ?>"><?= htmlspecialchars($fav['label']) ?></a>
                    <?php endforeach; ?>
                </nav>
            </div>
            <!-- Dropdown when right favorites is reduced to star -->
            <div class="bt-small-menu bt-align-right bt-app-fav-menu" data-global-menu="app_favs" id="btAppFavMenu">
                <div class="bt-tools-eyebrow" style="margin: 4px 10px 8px;">Tools Favorites</div>
                <nav style="display: grid; gap: 2px;">
                    <?php foreach ($defaultAppFavorites as $fav): ?>
                        <a class="bt-tool-link" href="<?= htmlspecialchars($fav['path']) ?>">
                            <i class="<?= htmlspecialchars($fav['icon'] ?? 'fas fa-star') ?>"></i>
                            <span><?= htmlspecialchars($fav['label']) ?></span>
                        </a>
                    <?php endforeach; ?>
                </nav>
            </div>
        </div>
        <div class="bt-nav-divider"></div>
        <div class="bt-menu-wrap">
            <button class="bt-selector" type="button" data-global-menu-toggle="apps" aria-expanded="false" aria-label="Select tool">
                <div class="bt-picker-lines">
                    <span class="bt-picker-top">Tools</span>
                    <strong class="bt-picker-bottom">Select a Tool</strong>
                </div>
                <i class="fas fa-caret-down bt-picker-caret"></i>
            </button>
            <div class="bt-small-menu bt-align-right bt-apps-menu" data-global-menu="apps">
                <div class="bt-tools-eyebrow" style="margin: 4px 10px 8px;">Tools</div>
                <nav style="display: grid; gap: 2px;">
                    <?php foreach ($quickToolsList as $app): ?>
                        <?php 
                            $isAppActive = strpos($currentPath, $app['path']) !== false;
                            $isAppFav = false;
                            foreach ($defaultAppFavorites as $af) {
                                if ($af['id'] === $app['id']) { $isAppFav = true; break; }
                            }
                        ?>
                        <div class="bt-tool-row <?= $isAppActive ? 'active' : '' ?>" data-app-tool-row="<?= htmlspecialchars($app['id']) ?>">
                            <a class="bt-tool-link" href="<?= htmlspecialchars($app['path']) ?>">
                                <i class="<?= htmlspecialchars($app['icon']) ?>"></i>
                                <span><?= htmlspecialchars($app['label']) ?></span>
                            </a>
                            <button type="button" class="bt-tool-fav-btn bt-app-fav-btn <?= $isAppFav ? 'active' : '' ?>" data-app-fav-btn data-tool-id="<?= htmlspecialchars($app['id']) ?>" data-tool-label="<?= htmlspecialchars($app['label']) ?>" data-tool-path="<?= htmlspecialchars($app['path']) ?>" data-tool-icon="<?= htmlspecialchars($app['icon']) ?>" title="<?= $isAppFav ? 'Remove from favorites' : 'Add to favorites' ?>" aria-label="Toggle favorite for <?= htmlspecialchars($app['label']) ?>">
                                <i class="fas fa-star"></i>
                            </button>
                        </div>
                    <?php endforeach; ?>
                </nav>
            </div>
        </div>
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
