<?php
require_once __DIR__ . '/company_tools_data.php';
$companyToolsCategories = company_tools_existing_categories();
$favoriteTools = company_tools_favorites();
$bidBoardPath = company_tools_bid_board_path();
$currentPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
?>
<header class="bt-global-header" data-global-tools-header>
    <div class="bt-global-left">
        <a class="bt-brand" href="<?= htmlspecialchars($bidBoardPath) ?>" aria-label="Open Bid Board">
            <span class="bt-brand-mark">B</span>
            <span>Brightronix</span>
        </a>
        <div class="bt-menu-wrap">
            <button class="bt-selector" type="button" data-global-menu-toggle="company" aria-expanded="false" aria-label="Select company or project">
                <span>Brightronix Electric</span>
                <strong>Select a Project</strong>
                <i class="fas fa-chevron-down"></i>
            </button>
            <div class="bt-small-menu" data-global-menu="company">
                <a href="/pages/index.php">
                    <i class="fas fa-building"></i>
                    <span>Brightronix Electric</span>
                </a>
                <a href="/pages/project_module.php">
                    <i class="fas fa-folder-open"></i>
                    <span>Select a Project</span>
                </a>
                <a href="/pages/company_settings.php">
                    <i class="fas fa-gear"></i>
                    <span>Company Settings</span>
                </a>
            </div>
        </div>
        <div class="bt-menu-wrap bt-tools-wrap">
            <button class="bt-selector bt-company-tools-trigger" type="button" data-global-menu-toggle="tools" aria-expanded="false">
                <span>Company Tools</span>
                <strong>Preconstruction</strong>
                <i class="fas fa-chevron-down"></i>
            </button>
            <div class="bt-tools-mega" data-global-menu="tools">
                <div class="bt-tools-eyebrow">Select a tool</div>
                <div class="bt-tools-grid">
                    <?php foreach ($companyToolsCategories as $category): ?>
                        <section class="bt-tools-col">
                            <h2><?= htmlspecialchars($category['title']) ?></h2>
                            <div class="bt-tools-rule"></div>
                            <nav>
                                <?php foreach ($category['links'] as $link): ?>
                                    <?php $isActive = $currentPath === ($link['path'] ?? ''); ?>
                                    <a class="<?= $isActive ? 'active' : '' ?>" href="<?= htmlspecialchars($link['path']) ?>">
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
        <div class="bt-menu-wrap">
            <button class="bt-nav-trigger" type="button" data-global-menu-toggle="favorites" aria-expanded="false">
                <i class="fas fa-star"></i>
                <span>Favorites</span>
            </button>
            <div class="bt-small-menu" data-global-menu="favorites">
                <?php if (count($favoriteTools) > 0): ?>
                    <?php foreach ($favoriteTools as $link): ?>
                        <a class="<?= $currentPath === ($link['path'] ?? '') ? 'active' : '' ?>" href="<?= htmlspecialchars($link['path']) ?>">
                            <i class="<?= htmlspecialchars($link['icon'] ?? 'fas fa-star') ?>"></i>
                            <span><?= htmlspecialchars($link['label']) ?></span>
                        </a>
                    <?php endforeach; ?>
                <?php else: ?>
                    <div class="bt-empty-menu">No favorites yet</div>
                <?php endif; ?>
            </div>
        </div>
        <div class="bt-menu-wrap">
            <button class="bt-nav-trigger" type="button" data-global-menu-toggle="recent" aria-expanded="false">Recent</button>
            <div class="bt-small-menu" data-global-menu="recent">
                <div class="bt-empty-menu">No recent tools yet</div>
            </div>
        </div>
        <div class="bt-menu-wrap">
            <button class="bt-nav-trigger" type="button" data-global-menu-toggle="pinned" aria-expanded="false">Pinned</button>
            <div class="bt-small-menu" data-global-menu="pinned">
                <div class="bt-empty-menu">No pinned tools yet</div>
            </div>
        </div>
    </div>
    <div class="bt-global-right">
        <div class="bt-menu-wrap">
            <button class="bt-selector" type="button" data-global-menu-toggle="apps" aria-expanded="false" aria-label="Select app">
                <span>Apps</span>
                <strong>Select an App</strong>
                <i class="fas fa-chevron-down"></i>
            </button>
            <div class="bt-small-menu bt-align-right" data-global-menu="apps">
                <a href="/pages/company_tools.php">
                    <i class="fas fa-grip"></i>
                    <span>Company Tools</span>
                </a>
                <a href="/pages/project_module.php">
                    <i class="fas fa-briefcase"></i>
                    <span>Portfolio</span>
                </a>
            </div>
        </div>
        <div class="bt-menu-wrap">
            <button class="bt-icon" type="button" data-global-menu-toggle="help" aria-expanded="false" aria-label="Help"><i class="far fa-circle-question"></i></button>
            <div class="bt-small-menu bt-align-right" data-global-menu="help">
                <button class="bt-menu-action" type="button">
                    <i class="fas fa-book-open"></i>
                    <span>Support Documentation</span>
                </button>
                <button class="bt-menu-action" type="button">
                    <i class="fas fa-circle-info"></i>
                    <span>User Guide</span>
                </button>
            </div>
        </div>
        <div class="bt-menu-wrap">
            <button class="bt-icon" type="button" data-global-menu-toggle="notifications" aria-expanded="false" aria-label="Notifications"><i class="far fa-bell"></i></button>
            <div class="bt-small-menu bt-align-right" data-global-menu="notifications">
                <div class="bt-empty-menu">No notifications</div>
            </div>
        </div>
        <div class="bt-menu-wrap">
            <button class="bt-avatar" type="button" data-global-menu-toggle="user" aria-expanded="false" aria-label="User menu">JE</button>
            <div class="bt-small-menu bt-align-right" data-global-menu="user">
                <button class="bt-menu-action" type="button">
                    <i class="fas fa-user"></i>
                    <span>Profile</span>
                </button>
                <button class="bt-menu-action" type="button" data-theme-toggle>
                    <i class="fas fa-moon"></i>
                    <span>Dark Mode</span>
                </button>
                <a href="/pages/company_settings.php">
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
    var saved = localStorage.getItem(key);
    var preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var theme = saved || preferred;
    document.documentElement.setAttribute('data-theme', theme);
    function syncThemeButton() {
        document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
            var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            button.querySelector('span').textContent = isDark ? 'Light Mode' : 'Dark Mode';
            var icon = button.querySelector('i');
            if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        });
    }
    document.addEventListener('click', function (event) {
        var button = event.target.closest('[data-theme-toggle]');
        if (!button) return;
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(key, next);
        syncThemeButton();
    });
    document.addEventListener('DOMContentLoaded', syncThemeButton);
})();
</script>
