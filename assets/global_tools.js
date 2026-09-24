(function () {
    const COMPANY_KEY = 'takeoff.favorite_tools';
    const APPS_KEY = 'takeoff.favorite_apps';
    const MAX_COMPANY_FAVORITES = 5;
    const MAX_APP_FAVORITES = 3;

    const DEFAULT_COMPANY_FAVORITES = [
        { id: 'bid_board', label: 'Bid Board', path: 'bid_board.php', icon: 'fas fa-chart-column' },
        { id: 'cost_catalog', label: 'Cost Catalog', path: 'cost_catalog.php', icon: 'fas fa-boxes-stacked' },
        { id: 'archivos', label: 'Documents', path: 'archivos.php', icon: 'fas fa-folder' }
    ];

    const DEFAULT_APP_FAVORITES = [
        { id: 'takeoff', label: 'Material Extraction', path: 'project_dashboard.php?tab=takeoff', icon: 'fas fa-cubes' },
        { id: 'editor', label: 'Room Designer', path: 'editor.php', icon: 'fas fa-draw-polygon' }
    ];

    function getStorageFavs(key, defaultList, maxLimit) {
        try {
            const raw = localStorage.getItem(key);
            if (raw !== null) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.slice(0, maxLimit);
                }
            }
        } catch (e) {
            console.warn('Could not read ' + key, e);
        }
        const defaults = defaultList.slice(0, maxLimit);
        saveStorageFavs(key, defaults, maxLimit);
        return defaults;
    }

    function saveStorageFavs(key, list, maxLimit) {
        try {
            localStorage.setItem(key, JSON.stringify(list.slice(0, maxLimit)));
        } catch (e) {
            console.warn('Could not save ' + key, e);
        }
    }

    function syncUI() {
        const currentPath = window.location.pathname.split('/').pop() || 'bid_board.php';

        // 1. Company Favorites (Left side - max 5)
        const compFavs = getStorageFavs(COMPANY_KEY, DEFAULT_COMPANY_FAVORITES, MAX_COMPANY_FAVORITES);
        document.querySelectorAll('[data-tool-fav-btn]').forEach(btn => {
            const toolId = btn.getAttribute('data-tool-id');
            const isFav = compFavs.some(f => f.id === toolId);
            btn.classList.toggle('active', isFav);
            btn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
        });

        const compContainer = document.getElementById('btFavTabs');
        const moreWrap = document.getElementById('btFavMoreWrap');
        const moreMenu = document.getElementById('btFavMoreMenu');
        const mobileList = document.getElementById('btFavMobileList');

        if (compContainer) {
            compContainer.innerHTML = '';
            const width = window.innerWidth;
            // Responsive visible threshold:
            // > 1200px: up to 4 tabs, then + more
            // 960px - 1200px: 2 tabs, then + more
            // < 960px: tabs hidden by CSS, accessible via star button dropdown
            const maxVisible = width < 1000 ? 1 : (width < 1240 ? 2 : 4);
            const visible = compFavs.slice(0, maxVisible);
            const overflow = compFavs.slice(maxVisible);

            visible.forEach(fav => {
                const a = document.createElement('a');
                a.href = fav.path;
                a.className = 'bt-fav-tab';
                const favFileName = (fav.path || '').split('/').pop();
                if (currentPath === favFileName) {
                    a.classList.add('active');
                }
                a.setAttribute('data-fav-id', fav.id);
                a.textContent = fav.label;
                compContainer.appendChild(a);
            });

            if (moreWrap && moreMenu) {
                if (overflow.length > 0) {
                    moreWrap.style.display = 'inline-flex';
                    const moreBtn = moreWrap.querySelector('.bt-fav-more-btn');
                    if (moreBtn) {
                        moreBtn.innerHTML = `<i class="fas fa-plus"></i><span class="bt-more-count">${overflow.length}</span>`;
                    }
                    moreMenu.innerHTML = `
                        <div class="bt-tools-eyebrow" style="margin: 4px 10px 8px;">More Favorites</div>
                        <nav style="display: grid; gap: 2px;">
                            ${overflow.map(fav => `
                                <a class="bt-tool-link ${currentPath === (fav.path || '').split('/').pop() ? 'active' : ''}" href="${fav.path}">
                                    <i class="${fav.icon || 'fas fa-star'}"></i>
                                    <span>${fav.label}</span>
                                </a>
                            `).join('')}
                        </nav>
                    `;
                } else {
                    moreWrap.style.display = 'none';
                    moreMenu.innerHTML = '';
                }
            }
        }

        // Populate tablet/mobile complete favorites list
        if (mobileList) {
            mobileList.innerHTML = compFavs.map(fav => `
                <a class="bt-tool-link ${currentPath === (fav.path || '').split('/').pop() ? 'active' : ''}" href="${fav.path}">
                    <i class="${fav.icon || 'fas fa-star'}"></i>
                    <span>${fav.label}</span>
                </a>
            `).join('');
        }

        // 2. Apps Favorites (Right side - max 3)
        const appFavs = getStorageFavs(APPS_KEY, DEFAULT_APP_FAVORITES, MAX_APP_FAVORITES);
        document.querySelectorAll('[data-app-fav-btn]').forEach(btn => {
            const toolId = btn.getAttribute('data-tool-id');
            const isFav = appFavs.some(f => f.id === toolId);
            btn.classList.toggle('active', isFav);
            btn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
        });

        const appContainer = document.getElementById('btAppFavTabs');
        if (appContainer) {
            appContainer.innerHTML = '';
            appFavs.forEach(fav => {
                const a = document.createElement('a');
                a.href = fav.path;
                a.className = 'bt-fav-tab';
                const favFileName = (fav.path || '').split('/').pop();
                if (currentPath === favFileName || (fav.path && window.location.href.indexOf(fav.path) !== -1)) {
                    a.classList.add('active');
                }
                a.setAttribute('data-app-fav-id', fav.id);
                a.textContent = fav.label;
                appContainer.appendChild(a);
            });
        }
    }

    function toggleCompanyFav(tool) {
        let favs = getStorageFavs(COMPANY_KEY, DEFAULT_COMPANY_FAVORITES, MAX_COMPANY_FAVORITES);
        const index = favs.findIndex(f => f.id === tool.id);
        if (index >= 0) {
            favs.splice(index, 1);
        } else {
            if (favs.length >= MAX_COMPANY_FAVORITES) {
                alert('Has alcanzado el límite máximo de ' + MAX_COMPANY_FAVORITES + ' favoritos. Desmarca uno para agregar este.');
                return;
            }
            favs.push(tool);
        }
        saveStorageFavs(COMPANY_KEY, favs, MAX_COMPANY_FAVORITES);
        syncUI();
    }

    function toggleAppFav(tool) {
        let favs = getStorageFavs(APPS_KEY, DEFAULT_APP_FAVORITES, MAX_APP_FAVORITES);
        const index = favs.findIndex(f => f.id === tool.id);
        if (index >= 0) {
            favs.splice(index, 1);
        } else {
            if (favs.length >= MAX_APP_FAVORITES) {
                alert('Has alcanzado el límite máximo de ' + MAX_APP_FAVORITES + ' herramientas favoritas. Desmarca una para agregar esta.');
                return;
            }
            favs.push(tool);
        }
        saveStorageFavs(APPS_KEY, favs, MAX_APP_FAVORITES);
        syncUI();
    }

    function menuFor(button) {
        const name = button.getAttribute('data-global-menu-toggle');
        const header = button.closest('[data-global-tools-header]');
        return header ? header.querySelector('[data-global-menu="' + name + '"]') : null;
    }

    function closeMenus(exceptMenu) {
        document.querySelectorAll('[data-global-menu].open').forEach(menu => {
            if (menu !== exceptMenu) menu.classList.remove('open');
        });

        document.querySelectorAll('[data-global-menu-toggle][aria-expanded="true"]').forEach(button => {
            if (menuFor(button) !== exceptMenu) {
                button.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function keepMenuOnScreen(menu) {
        menu.style.left = '';
        menu.style.right = '';

        const rect = menu.getBoundingClientRect();
        const margin = 12;

        if (rect.right > window.innerWidth - margin) {
            menu.style.left = 'auto';
            menu.style.right = '0';
        }

        if (rect.left < margin) {
            menu.style.left = '0';
            menu.style.right = 'auto';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Initialize and sync both Favorites sets from localStorage
        syncUI();

        // Favorite star button clicks: use capture phase and stop immediate propagation
        // so the dropdown menus stay open when starring multiple items
        document.addEventListener('click', event => {
            const favBtn = event.target.closest('[data-tool-fav-btn]');
            if (favBtn) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                const tool = {
                    id: favBtn.getAttribute('data-tool-id'),
                    label: favBtn.getAttribute('data-tool-label'),
                    path: favBtn.getAttribute('data-tool-path'),
                    icon: favBtn.getAttribute('data-tool-icon') || 'fas fa-circle'
                };
                toggleCompanyFav(tool);
                return;
            }

            const appFavBtn = event.target.closest('[data-app-fav-btn]');
            if (appFavBtn) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                const tool = {
                    id: appFavBtn.getAttribute('data-tool-id'),
                    label: appFavBtn.getAttribute('data-tool-label'),
                    path: appFavBtn.getAttribute('data-tool-path'),
                    icon: appFavBtn.getAttribute('data-tool-icon') || 'fas fa-circle'
                };
                toggleAppFav(tool);
                return;
            }
        }, true);

        // Dropdown menu toggles
        document.querySelectorAll('[data-global-menu-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const menu = menuFor(button);
                if (!menu) return;

                const willOpen = !menu.classList.contains('open');
                closeMenus(menu);
                menu.classList.toggle('open', willOpen);
                button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');

                if (willOpen) {
                    keepMenuOnScreen(menu);
                }
            });
        });

        // Click inside menus
        document.querySelectorAll('[data-global-menu]').forEach(menu => {
            menu.addEventListener('click', event => {
                // If clicking any favorite star button, NEVER close menu and stop propagation
                if (event.target.closest('[data-tool-fav-btn]') || event.target.closest('[data-app-fav-btn]')) {
                    event.stopPropagation();
                    return;
                }
                const link = event.target.closest('a');
                const action = event.target.closest('.bt-menu-action');
                if (link || action) {
                    closeMenus(null);
                    return;
                }
                event.stopPropagation();
            });
        });

        document.addEventListener('click', () => closeMenus(null));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeMenus(null);
        });
        let resizeTimer;
        window.addEventListener('resize', () => {
            closeMenus(null);
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(syncUI, 120);
        });
    });
})();
