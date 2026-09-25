<?php
require_once __DIR__ . '/company_tools_data.php';
$companyToolsCategories = company_tools_existing_categories();
$favoriteTools = array_slice(company_tools_favorites(), 0, 5);
$bidBoardPath = company_tools_bid_board_path();
$currentPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
?>
<header class="bt-global-header bt-floating-header" data-global-tools-header>
    <div class="bt-global-left">
        <button class="bt-icon-procore bt-header-theme-toggle" type="button" data-theme-toggle
            title="Toggle Dark/Light Mode" aria-label="Toggle Theme">
            <i class="fas fa-moon"></i>
        </button>
        <div class="bt-menu-wrap bt-tools-wrap">
            <button class="bt-selector bt-company-tools-trigger" type="button" data-global-menu-toggle="tools"
                aria-expanded="false" aria-label="Company Tools">
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
                                    <div class="bt-tool-row <?= $isActive ? 'active' : '' ?>"
                                        data-tool-row="<?= htmlspecialchars($toolId) ?>">
                                        <a class="bt-tool-link" href="<?= htmlspecialchars($resolvedPath) ?>">
                                            <i class="<?= htmlspecialchars($link['icon'] ?? 'fas fa-circle') ?>"></i>
                                            <span><?= htmlspecialchars($link['label']) ?></span>
                                        </a>
                                        <button type="button" class="bt-tool-fav-btn <?= $isFav ? 'active' : '' ?>"
                                            data-tool-fav-btn data-tool-id="<?= htmlspecialchars($toolId) ?>"
                                            data-tool-label="<?= htmlspecialchars($link['label']) ?>"
                                            data-tool-path="<?= htmlspecialchars($resolvedPath) ?>"
                                            data-tool-icon="<?= htmlspecialchars($link['icon'] ?? 'fas fa-circle') ?>"
                                            title="<?= $isFav ? 'Remove from favorites' : 'Add to favorites' ?>"
                                            aria-label="Toggle favorite for <?= htmlspecialchars($link['label']) ?>">
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
            <button class="bt-fav-star-btn" type="button" data-global-menu-toggle="favs" aria-expanded="false"
                title="Favorites">
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
                        <a href="<?= htmlspecialchars($resolvedFavPath) ?>"
                            class="bt-fav-tab <?= $isFavActive ? 'active' : '' ?>"
                            data-fav-id="<?= htmlspecialchars($favId) ?>"><?= htmlspecialchars($fav['label']) ?></a>
                    <?php endforeach; ?>
                </nav>
                <div class="bt-fav-more-wrap" id="btFavMoreWrap" style="display: none;">
                    <button class="bt-fav-more-btn" type="button" data-global-menu-toggle="favs_more"
                        aria-expanded="false" title="More favorites">
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
        <?php
        $navReturnStage = $_GET['stage'] ?? $_GET['status'] ?? '';
        $navBidBoardHref = 'bid_board.php' . (!empty($navReturnStage) ? '?status=' . urlencode($navReturnStage) : '');
        ?>
        <a class="bt-brand" href="<?= htmlspecialchars($navBidBoardHref) ?>" id="btHeaderBrandLink" aria-label="Brightronix Estimating Hub">
            <div class="bt-brand-block">
                <img src="../assets/logo-text.png" alt="Brightronix" class="bt-brand-logo"
                    onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src='../assets/images/logo-text.png';}else{this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='inline';}">
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
            <button class="bt-fav-star-btn" type="button" data-global-menu-toggle="app_favs" aria-expanded="false"
                title="Tools Favorites">
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
                        <a href="<?= htmlspecialchars($fav['path']) ?>"
                            class="bt-fav-tab <?= $isFavActive ? 'active' : '' ?>"
                            data-app-fav-id="<?= htmlspecialchars($fav['id']) ?>"><?= htmlspecialchars($fav['label']) ?></a>
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
            <button class="bt-selector" type="button" data-global-menu-toggle="apps" aria-expanded="false"
                aria-label="Select tool">
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
                            if ($af['id'] === $app['id']) {
                                $isAppFav = true;
                                break;
                            }
                        }
                        ?>
                        <div class="bt-tool-row <?= $isAppActive ? 'active' : '' ?>"
                            data-app-tool-row="<?= htmlspecialchars($app['id']) ?>">
                            <a class="bt-tool-link" href="<?= htmlspecialchars($app['path']) ?>">
                                <i class="<?= htmlspecialchars($app['icon']) ?>"></i>
                                <span><?= htmlspecialchars($app['label']) ?></span>
                            </a>
                            <button type="button" class="bt-tool-fav-btn bt-app-fav-btn <?= $isAppFav ? 'active' : '' ?>"
                                data-app-fav-btn data-tool-id="<?= htmlspecialchars($app['id']) ?>"
                                data-tool-label="<?= htmlspecialchars($app['label']) ?>"
                                data-tool-path="<?= htmlspecialchars($app['path']) ?>"
                                data-tool-icon="<?= htmlspecialchars($app['icon']) ?>"
                                title="<?= $isAppFav ? 'Remove from favorites' : 'Add to favorites' ?>"
                                aria-label="Toggle favorite for <?= htmlspecialchars($app['label']) ?>">
                                <i class="fas fa-star"></i>
                            </button>
                        </div>
                    <?php endforeach; ?>
                </nav>
            </div>
        </div>
        <button class="bt-icon-procore" id="btGlobalAnnouncementsBtn" type="button" title="Announcements"
            aria-label="Announcements">
            <i class="far fa-bell"></i>
            <span class="bt-notif-dot" id="btAnnouncementNotifDot"></span>
        </button>
        <div class="bt-menu-wrap">
            <button class="bt-avatar-procore" type="button" data-global-menu-toggle="user" aria-expanded="false"
                aria-label="Account & Profile">
                <span>ID</span>
            </button>
            <div class="bt-small-menu bt-align-right" data-global-menu="user">
                <button class="bt-menu-action" type="button">
                    <i class="fas fa-user"></i>
                    <span>Profile (Admin)</span>
                </button>
                <a href="company_settings.php">
                    <i class="fas fa-sliders"></i>
                    <span>Settings</span>
                </a>
                <div style="height: 1px; background: rgba(0,0,0,0.08); margin: 4px 0;"></div>
                <a href="../logout.php">
                    <i class="fas fa-sign-out-alt"></i>
                    <span>Sign out</span>
                </a>
            </div>
        </div>
        <button class="bt-header-collapse-btn" id="btHeaderCollapseBtn" type="button" title="Hide Header"
            aria-label="Hide Header">
            <i class="fas fa-chevron-up"></i>
        </button>
    </div>
</header>
<button class="bt-header-slide-toggle" id="btHeaderSlideToggle" type="button" title="Show Header"
    aria-label="Show Header" style="display: none;">
    <i class="fas fa-chevron-down"></i>
</button>

<!-- Global System & Browser Announcements Modal -->
<div class="g-announcement-backdrop" id="globalAnnouncementModal" role="dialog" aria-modal="true"
    aria-labelledby="globalAnnouncementTitle">
    <div class="g-announcement-dialog">
        <div class="g-announcement-banner" id="globalAnnouncementBanner">
            <div class="g-announcement-badge-wrap">
                <span class="g-announcement-badge" id="globalAnnouncementBadge">SYSTEM UPDATE</span>
                <span class="g-announcement-date" id="globalAnnouncementDate">September 24, 2026</span>
            </div>
            <div class="g-announcement-icon-bubble" id="globalAnnouncementIcon">
                <i class="fas fa-bullhorn"></i>
            </div>
        </div>
        <div class="g-announcement-body">
            <h2 class="g-announcement-title" id="globalAnnouncementTitle">Brightronix Takeoff Platform Update</h2>
            <div class="g-announcement-content" id="globalAnnouncementBody">
                <p>Welcome to the enhanced <strong>Brightronix Takeoff & Estimating Platform</strong>. We have updated
                    your workflow with high-performance tools:</p>
                <ul>
                    <li><strong>Smart 10-Minute Clock & Calendar:</strong> Standardized due dates and due times with
                        fast 10-minute intervals across all project inputs.</li>
                    <li><strong>Live Multi-User Project Presence:</strong> Real-time indicator displaying up to 4
                        concurrent estimators actively working on this specific project.</li>
                    <li><strong>Adaptive Dark & Light Theme:</strong> Instant theme switching with synchronized stage
                        pills, badges, and glassmorphism styling.</li>
                    <li><strong>Global Broadcast Alerts:</strong> Stay informed of system announcements, releases, and
                        collaborative project actions anywhere across the workspace.</li>
                </ul>
                <div class="g-announcement-highlight-box">
                    <strong>Tip:</strong> You can access this announcement anytime by clicking the bell icon in the top
                    header.
                </div>
            </div>
        </div>
        <div class="g-announcement-footer">
            <label class="g-announcement-checkbox-wrap" id="globalAnnouncementDontShowWrap">
                <input type="checkbox" id="globalAnnouncementDontShow">
                <span>Don't show this announcement again</span>
            </label>
            <div class="g-announcement-actions">
                <button type="button" class="g-announcement-btn cancel" id="globalAnnouncementCancelBtn"
                    style="display:none;">Stay on Page</button>
                <button type="button" class="g-announcement-btn sec" id="globalAnnouncementSecBtn"
                    style="display:none;">Dismiss</button>
                <button type="button" class="g-announcement-btn prim" id="globalAnnouncementPrimBtn">Got It</button>
            </div>
        </div>
    </div>
</div>
<script>
    (function () {
        var key = 'takeoff.theme';
        var saved = null;
        try {
            saved = localStorage.getItem(key);
        } catch (error) { }
        var urlTheme = null;
        try {
            urlTheme = new URLSearchParams(window.location.search).get('theme');
        } catch (e) { }
        var theme = urlTheme === 'dark' || urlTheme === 'light' ? urlTheme : (saved === 'dark' || saved === 'light' ? saved : 'light');
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
                button.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
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
            } catch (error) { }
            syncThemeButton();
        });

        document.addEventListener('DOMContentLoaded', syncThemeButton);
        syncThemeButton();

        // Header Slide Up / Down Animation
        var collapseBtn = document.getElementById('btHeaderCollapseBtn');
        var slideToggle = document.getElementById('btHeaderSlideToggle');
        var globalHeader = document.querySelector('.bt-global-header');

        if (collapseBtn && globalHeader) {
            collapseBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                globalHeader.classList.add('header-collapsed');
                document.body.classList.add('header-is-collapsed');
                var shell = document.querySelector('.workspace-shell') || document.querySelector('.bid-board-shell');
                if (shell) shell.classList.add('header-is-collapsed');
                if (slideToggle) slideToggle.style.display = 'flex';
            });
        }

        if (slideToggle && globalHeader) {
            slideToggle.addEventListener('click', function (e) {
                e.stopPropagation();
                globalHeader.classList.remove('header-collapsed');
                document.body.classList.remove('header-is-collapsed');
                var shell = document.querySelector('.workspace-shell') || document.querySelector('.bid-board-shell');
                if (shell) shell.classList.remove('header-is-collapsed');
                slideToggle.style.display = 'none';
            });
        }

        try {
            if (new URLSearchParams(window.location.search).get('collapsed') === '1' && globalHeader) {
                globalHeader.classList.add('header-collapsed');
                document.body.classList.add('header-is-collapsed');
                var shell = document.querySelector('.workspace-shell') || document.querySelector('.bid-board-shell');
                if (shell) shell.classList.add('header-is-collapsed');
                if (slideToggle) slideToggle.style.display = 'flex';
            }
        } catch (e) { }

        // Global Announcements Controller
        var modalBackdrop = document.getElementById('globalAnnouncementModal');
        var closeBtn = document.getElementById('globalAnnouncementCloseBtn');
        var primBtn = document.getElementById('globalAnnouncementPrimBtn');
        var secBtn = document.getElementById('globalAnnouncementSecBtn');
        var cancelBtn = document.getElementById('globalAnnouncementCancelBtn');
        var dontShowCheck = document.getElementById('globalAnnouncementDontShow');
        var notifBellBtn = document.getElementById('btGlobalAnnouncementsBtn');
        var notifDot = document.getElementById('btAnnouncementNotifDot');

        var currentAnnouncementId = 'takeoff_system_announcement_v1';
        var primaryCallback = null;
        var secondaryCallback = null;
        var cancelCallback = null;

        function getDismissedList() {
            try {
                var raw = localStorage.getItem('takeoff.dismissedAnnouncements');
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        }

        function isDismissed(id) {
            return getDismissedList().indexOf(id) !== -1;
        }

        function markDismissed(id) {
            try {
                var list = getDismissedList();
                if (list.indexOf(id) === -1) {
                    list.push(id);
                    localStorage.setItem('takeoff.dismissedAnnouncements', JSON.stringify(list));
                }
            } catch (e) { }
            updateNotifDot();
        }

        function updateNotifDot() {
            if (!notifDot) return;
            if (!isDismissed(currentAnnouncementId)) {
                notifDot.classList.add('visible');
            } else {
                notifDot.classList.remove('visible');
            }
        }

        function showAnnouncement(options) {
            options = options || {};
            var id = options.id || currentAnnouncementId;
            currentAnnouncementId = id;

            if (!options.force && isDismissed(id)) {
                return;
            }

            var type = options.type || 'system'; // 'system' | 'success' | 'error' | 'warning' | 'info'
            var bannerEl = document.getElementById('globalAnnouncementBanner');
            if (bannerEl) {
                bannerEl.className = 'g-announcement-banner type-' + type;
            }

            var defaultBadges = {
                system: 'SYSTEM UPDATE',
                success: 'SUCCESS',
                error: 'SYSTEM ERROR',
                warning: 'WARNING',
                info: 'INFO NOTICE'
            };
            var defaultIcons = {
                system: 'fas fa-bullhorn',
                success: 'fas fa-circle-check',
                error: 'fas fa-circle-xmark',
                warning: 'fas fa-triangle-exclamation',
                info: 'fas fa-circle-info'
            };

            if (options.title) {
                var titleEl = document.getElementById('globalAnnouncementTitle');
                if (titleEl) titleEl.textContent = options.title;
            }

            var badgeEl = document.getElementById('globalAnnouncementBadge');
            if (badgeEl) {
                badgeEl.textContent = options.badge || defaultBadges[type] || 'NOTICE';
            }

            var dateEl = document.getElementById('globalAnnouncementDate');
            if (dateEl) {
                dateEl.textContent = options.date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }

            var iconWrap = document.getElementById('globalAnnouncementIcon');
            if (iconWrap) {
                var iconClass = options.icon || defaultIcons[type] || 'fas fa-bell';
                iconWrap.innerHTML = '<i class="' + iconClass + '"></i>';
            }

            var bodyEl = document.getElementById('globalAnnouncementBody');
            if (bodyEl) {
                if (options.content) {
                    bodyEl.innerHTML = typeof options.content === 'string' ? options.content : String(options.content);
                } else if (options.message) {
                    bodyEl.innerHTML = '<p>' + options.message + '</p>';
                }
            }

            if (primBtn) {
                primBtn.textContent = options.primaryText || (type === 'error' ? 'Close' : 'Got It');
                if (options.primaryDanger || (type === 'error' && options.cancelText)) {
                    primBtn.style.background = '#ef4444';
                    primBtn.style.boxShadow = '0 2px 6px rgba(239, 68, 68, 0.35)';
                } else {
                    primBtn.style.background = '';
                    primBtn.style.boxShadow = '';
                }
            }
            primaryCallback = typeof options.onPrimary === 'function' ? options.onPrimary : null;

            if (secBtn) {
                if (options.secondaryText) {
                    secBtn.textContent = options.secondaryText;
                    secBtn.style.display = 'inline-block';
                } else {
                    secBtn.style.display = 'none';
                }
            }
            secondaryCallback = typeof options.onSecondary === 'function' ? options.onSecondary : null;

            if (cancelBtn) {
                if (options.cancelText) {
                    cancelBtn.textContent = options.cancelText;
                    cancelBtn.style.display = 'inline-block';
                } else {
                    cancelBtn.style.display = 'none';
                }
            }
            cancelCallback = typeof options.onCancel === 'function' ? options.onCancel : null;

            var dontShowWrap = document.getElementById('globalAnnouncementDontShowWrap');
            if (dontShowWrap) {
                if (options.showDontShow === true || (options.showDontShow !== false && type === 'system')) {
                    dontShowWrap.style.display = 'inline-flex';
                } else {
                    dontShowWrap.style.display = 'none';
                }
            }

            if (dontShowCheck) {
                dontShowCheck.checked = false;
            }

            if (modalBackdrop) {
                modalBackdrop.classList.add('open');
            }
        }

        function closeAnnouncement() {
            if (dontShowCheck && dontShowCheck.checked) {
                markDismissed(currentAnnouncementId);
            }
            if (modalBackdrop) {
                modalBackdrop.classList.remove('open');
            }
        }

        function handleCancelDismiss() {
            var cb = cancelCallback;
            primaryCallback = null;
            secondaryCallback = null;
            cancelCallback = null;
            if (cb) cb();
            closeAnnouncement();
        }

        if (closeBtn) closeBtn.addEventListener('click', handleCancelDismiss);
        if (primBtn) {
            primBtn.addEventListener('click', function () {
                var cb = primaryCallback;
                primaryCallback = null;
                secondaryCallback = null;
                cancelCallback = null;
                if (cb) cb();
                closeAnnouncement();
            });
        }
        if (secBtn) {
            secBtn.addEventListener('click', function () {
                var cb = secondaryCallback;
                primaryCallback = null;
                secondaryCallback = null;
                cancelCallback = null;
                if (cb) cb();
                closeAnnouncement();
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                var cb = cancelCallback;
                primaryCallback = null;
                secondaryCallback = null;
                cancelCallback = null;
                if (cb) cb();
                closeAnnouncement();
            });
        }

        if (modalBackdrop) {
            modalBackdrop.addEventListener('click', function (e) {
                if (e.target === modalBackdrop) {
                    handleCancelDismiss();
                }
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modalBackdrop && modalBackdrop.classList.contains('open')) {
                handleCancelDismiss();
            }
        });

        if (notifBellBtn) {
            notifBellBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                showAnnouncement({ force: true, type: 'system' });
            });
        }

        updateNotifDot();

        window.TakeoffAnnouncement = {
            show: showAnnouncement,
            hide: closeAnnouncement,
            close: closeAnnouncement,
            isDismissed: isDismissed,
            markDismissed: markDismissed,
            success: function (titleOrOpts, message) {
                var opts = typeof titleOrOpts === 'object' ? titleOrOpts : { title: titleOrOpts, message: message };
                opts.type = 'success';
                opts.force = true;
                opts.showDontShow = false;
                showAnnouncement(opts);
            },
            error: function (titleOrOpts, message) {
                var opts = typeof titleOrOpts === 'object' ? titleOrOpts : { title: titleOrOpts, message: message };
                opts.type = 'error';
                opts.force = true;
                opts.showDontShow = false;
                showAnnouncement(opts);
            },
            warning: function (titleOrOpts, message) {
                var opts = typeof titleOrOpts === 'object' ? titleOrOpts : { title: titleOrOpts, message: message };
                opts.type = 'warning';
                opts.force = true;
                opts.showDontShow = false;
                showAnnouncement(opts);
            },
            info: function (titleOrOpts, message) {
                var opts = typeof titleOrOpts === 'object' ? titleOrOpts : { title: titleOrOpts, message: message };
                opts.type = 'info';
                opts.force = true;
                opts.showDontShow = false;
                showAnnouncement(opts);
            }
        };
    })();
</script>
<link rel="stylesheet" href="../assets/global_datetime_picker.css?v=20260924-3">
<script src="../assets/global_datetime_picker.js?v=20260924-3"></script>