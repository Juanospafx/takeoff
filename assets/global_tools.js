(function () {
    const COMPANY_KEY = 'takeoff.favorite_tools';
    const APPS_KEY = 'takeoff.favorite_apps';
    const MAX_COMPANY_FAVORITES = 3;
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

    function syncHeaderZoomFavorites() {
        const header = document.querySelector('.bt-global-header');
        if (!header) return;

        const dpr = window.devicePixelRatio || 1;
        const outerRatio = (window.outerWidth && window.innerWidth) ? (window.outerWidth / window.innerWidth) : 1;
        // Activate starting at 125% zoom (>= 1.24) or viewport width <= 1360px
        const isZoom125 = (dpr >= 1.24) || (outerRatio >= 1.24) || (window.innerWidth <= 1360);

        header.classList.toggle('zoom-favs-collapsed', isZoom125);
        const compFavs = document.getElementById('btCompanyFavorites');
        const appFavs = document.getElementById('btAppFavorites');
        if (compFavs) compFavs.classList.toggle('collapsed', isZoom125);
        if (appFavs) appFavs.classList.toggle('collapsed', isZoom125);
    }

    function syncUI() {
        syncHeaderZoomFavorites();
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
            const maxVisible = width < 1000 ? 1 : (width < 1240 ? 2 : 3);
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
                if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.warning === 'function') {
                    window.TakeoffAnnouncement.warning('Límite de Favoritos', 'Has alcanzado el límite máximo de ' + MAX_COMPANY_FAVORITES + ' favoritos. Desmarca uno para agregar este.');
                } else {
                    alert('Has alcanzado el límite máximo de ' + MAX_COMPANY_FAVORITES + ' favoritos. Desmarca uno para agregar este.');
                }
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
                if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.warning === 'function') {
                    window.TakeoffAnnouncement.warning('Límite de Favoritos', 'Has alcanzado el límite máximo de ' + MAX_APP_FAVORITES + ' herramientas favoritas. Desmarca una para agregar esta.');
                } else {
                    alert('Has alcanzado el límite máximo de ' + MAX_APP_FAVORITES + ' herramientas favoritas. Desmarca una para agregar esta.');
                }
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
        if (typeof closeAllOpenPopouts === 'function') {
            closeAllOpenPopouts(exceptMenu);
        } else {
            document.querySelectorAll('[data-global-menu].open').forEach(menu => {
                if (menu !== exceptMenu) menu.classList.remove('open');
            });
            document.querySelectorAll('[data-global-menu-toggle][aria-expanded="true"]').forEach(button => {
                if (menuFor(button) !== exceptMenu) {
                    button.setAttribute('aria-expanded', 'false');
                }
            });
        }
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
                // If it is a favorite star button and the header is extended (favorites container is visible), do nothing
                if (button.classList.contains('bt-fav-star-btn')) {
                    const favContainer = button.closest('.bt-favorites')?.querySelector('.bt-fav-container');
                    const isCollapsed = button.closest('.bt-favorites')?.classList.contains('collapsed') ||
                                        document.querySelector('.bt-global-header')?.classList.contains('zoom-favs-collapsed') ||
                                        (favContainer && window.getComputedStyle(favContainer).display === 'none');
                    if (!isCollapsed) {
                        return;
                    }
                }
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
        const handleResize = () => {
            closeMenus(null);
            syncHeaderZoomFavorites();
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(syncUI, 100);
        };
        window.addEventListener('resize', handleResize);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleResize);
        }
    });

    /* ==========================================================
       UNIFIED PRO CUSTOM SELECT ENGINE
       Transforms native <select> elements into pro custom dropdowns
       ========================================================== */
    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function enhanceSelect(selectEl) {
        if (!selectEl || selectEl.dataset.customEnhanced === 'true') {
            if (selectEl && typeof selectEl._syncCustom === 'function') {
                selectEl._syncCustom();
            }
            return;
        }

        // Exclusions:
        // 1. Visually hidden / screen-reader only elements with their own custom UI (e.g. bbSortBy, ccSortBy)
        // 2. Elements with explicit opt-out
        // 3. Raw selects or editor toolbar format selects
        if (selectEl.classList.contains('bb-visually-hidden') ||
            selectEl.hasAttribute('data-no-custom-select') ||
            selectEl.classList.contains('native-raw-select') ||
            selectEl.hasAttribute('data-editor-format')) {
            return;
        }

        // Special hidden control exclusions
        if (selectEl.id === 'bbProjectStage' || selectEl.id === 'bbSortBy' || selectEl.id === 'ccSortBy') {
            return;
        }

        // Do not enhance selects that are already inside a custom dropdown or custom modal selector.
        // The Cost Catalog selector row intentionally keeps the shared enhancer.
        if (selectEl.closest('.pro-custom-dropdown') ||
            selectEl.closest('.pro-create-layer-modal') ||
            selectEl.closest('.pro-layer-modal') ||
            selectEl.closest('.pro-edit-selectors-row') ||
            (selectEl.closest('.pro-create-selectors-row') && !selectEl.closest('.cc-takeoff-selectors-row'))) {
            return;
        }

        selectEl.dataset.customEnhanced = 'true';

        // Keep native select accessible for form submissions and native events while hidden
        selectEl.style.cssText = 'position: absolute !important; opacity: 0 !important; pointer-events: none !important; width: 0 !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: none !important;';

        const wrap = document.createElement('div');
        wrap.className = 'pro-custom-dropdown cc-custom-select pro-custom-select';
        if (selectEl.id) wrap.setAttribute('data-for-select', selectEl.id);

        if (selectEl.style.flex) {
            wrap.style.flex = selectEl.style.flex;
        }

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'pro-custom-dropdown-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');

        const textSpan = document.createElement('span');
        textSpan.className = 'pcd-trigger-text';

        const caretSpan = document.createElement('span');
        caretSpan.className = 'pcd-caret';

        trigger.appendChild(textSpan);
        trigger.appendChild(caretSpan);

        const menu = document.createElement('div');
        menu.className = 'pro-custom-dropdown-menu pcd-select-menu';
        menu.setAttribute('role', 'listbox');

        wrap.appendChild(trigger);
        wrap.appendChild(menu);

        const parentBox = selectEl.closest('.pro-create-control-box');
        const parentWithActions = selectEl.closest('.pd-input-with-actions');
        const parentPricing = selectEl.closest('.pd-pricing-wrap');

        if (parentBox) {
            const oldCaret = parentBox.querySelector('.pd-field-caret');
            if (oldCaret) oldCaret.style.display = 'none';
            parentBox.classList.add('has-custom-dropdown');
            parentBox.style.border = 'none';
            parentBox.style.background = 'transparent';
            parentBox.style.padding = '0';
            parentBox.appendChild(wrap);
        } else {
            if (parentWithActions) {
                const oldCaret = parentWithActions.querySelector('.pd-field-caret');
                if (oldCaret) oldCaret.style.display = 'none';
            }
            if (parentPricing) {
                const oldCaret = parentPricing.querySelector('.pd-field-caret');
                if (oldCaret) oldCaret.style.display = 'none';
            }
            selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);
        }

        function renderOptions() {
            if (selectEl.disabled) {
                trigger.disabled = true;
                wrap.classList.add('is-disabled');
            } else {
                trigger.disabled = false;
                wrap.classList.remove('is-disabled');
            }

            const options = Array.from(selectEl.options);
            const selectedOpt = selectEl.options[selectEl.selectedIndex] || options.find(o => String(o.value) === String(selectEl.value)) || options[0];
            textSpan.textContent = selectedOpt ? selectedOpt.text : '';

            let lastGroup = null;
            let menuHtml = '';
            for (const opt of options) {
                const parent = opt.parentElement;
                if (parent && parent.tagName === 'OPTGROUP' && parent.label && parent.label !== lastGroup) {
                    lastGroup = parent.label;
                    menuHtml += `<div class="pcd-select-group-header" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;padding:6px 10px 2px 10px;user-select:none;">${esc(lastGroup)}</div>`;
                }
                const isSel = String(opt.value) === String(selectEl.value);
                const isDis = opt.disabled;
                menuHtml += `
                    <div class="pcd-select-item ${isSel ? 'is-selected' : ''} ${isDis ? 'is-disabled' : ''}" data-val="${esc(opt.value)}" role="option" aria-selected="${isSel}" ${isDis ? 'style="opacity:0.5;pointer-events:none;"' : ''}>
                        <span class="pcd-select-text">${esc(opt.text)}</span>
                        ${isSel ? '<i class="fas fa-check pcd-check" aria-hidden="true"></i>' : ''}
                    </div>
                `;
            }
            menu.innerHTML = menuHtml;

            menu.querySelectorAll('.pcd-select-item:not(.is-disabled)').forEach(itemEl => {
                itemEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = itemEl.dataset.val;
                    if (selectEl.value !== val) {
                        selectEl.value = val;
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    renderOptions();
                    wrap.classList.remove('is-open');
                    trigger.setAttribute('aria-expanded', 'false');
                    trigger.focus();
                });
            });
        }

        selectEl._syncCustom = renderOptions;

        // Shadow prototype setters so programmatic select.value = 'x' automatically updates custom UI
        try {
            const protoValDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
            if (protoValDesc && protoValDesc.set) {
                Object.defineProperty(selectEl, 'value', {
                    get() {
                        return protoValDesc.get.call(this);
                    },
                    set(v) {
                        protoValDesc.set.call(this, v);
                        renderOptions();
                    },
                    configurable: true
                });
            }
            const protoIdxDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
            if (protoIdxDesc && protoIdxDesc.set) {
                Object.defineProperty(selectEl, 'selectedIndex', {
                    get() {
                        return protoIdxDesc.get.call(this);
                    },
                    set(i) {
                        protoIdxDesc.set.call(this, i);
                        renderOptions();
                    },
                    configurable: true
                });
            }
        } catch (e) {
            // Fallback silently if restricted
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectEl.disabled) return;
            const wasOpen = wrap.classList.contains('is-open');
            document.querySelectorAll('.pro-custom-dropdown.is-open').forEach(d => {
                d.classList.remove('is-open');
                const tr = d.querySelector('.pro-custom-dropdown-trigger');
                if (tr) tr.setAttribute('aria-expanded', 'false');
            });
            if (!wasOpen) {
                renderOptions();
                wrap.classList.add('is-open');
                trigger.setAttribute('aria-expanded', 'true');
            }
        });

        selectEl.addEventListener('change', renderOptions);

        const observer = new MutationObserver(() => {
            renderOptions();
        });
        observer.observe(selectEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

        renderOptions();
        return wrap;
    }

    function initCustomSelects(root = document) {
        const scope = (typeof root === 'string') ? document.querySelector(root) : root;
        if (!scope) return;
        const selects = scope.querySelectorAll('select:not([data-custom-enhanced="true"])');
        selects.forEach(enhanceSelect);
    }

    window.enhanceSelect = enhanceSelect;
    window.initCustomSelects = initCustomSelects;

    // ==========================================================
    // UNIVERSAL MUTUAL EXCLUSION POPOUT & DROPDOWN MANAGER
    // Ensures only ONE menu, popover, or dropdown is open at a time.
    // ==========================================================
    function isElementVisible(el) {
        if (!el) return false;
        if (el.hidden) return false;
        if (el.hasAttribute('hidden')) return false;
        if (el.style.display === 'none') return false;
        if (el.classList.contains('takeoff-hidden')) return false;
        return true;
    }

    function closeAllOpenPopouts(exceptElement = null) {
        const shouldKeep = (el) => {
            if (!el || !exceptElement) return false;
            return el === exceptElement || el.contains(exceptElement);
        };

        // 0. Header Dropdown Menus
        document.querySelectorAll('[data-global-menu].open').forEach(menu => {
            if (!shouldKeep(menu)) {
                menu.classList.remove('open');
            }
        });
        document.querySelectorAll('[data-global-menu-toggle][aria-expanded="true"]').forEach(btn => {
            if (!shouldKeep(btn)) {
                btn.setAttribute('aria-expanded', 'false');
            }
        });

        // 1. Takeoff Group context menu
        const groupMenu = document.getElementById('takeoffGroupContextMenu');
        if (groupMenu && isElementVisible(groupMenu) && !shouldKeep(groupMenu)) {
            groupMenu.style.display = 'none';
        }

        // 2. Takeoff Estimate picker popup
        const estPicker = document.getElementById('takeoffEstimatePickerPopup');
        if (estPicker && !shouldKeep(estPicker)) {
            estPicker.remove();
        }

        // 3. Project overview item context menu (tasks, notes)
        const pdMenu = document.getElementById('pdItemContextMenu');
        if (pdMenu && isElementVisible(pdMenu) && !shouldKeep(pdMenu)) {
            pdMenu.style.display = 'none';
        }

        // 4. Cost catalog row & tree floating menus
        const ccRowMenu = document.getElementById('ccRowItemFloatingMenu');
        if (ccRowMenu && isElementVisible(ccRowMenu) && !shouldKeep(ccRowMenu)) {
            ccRowMenu.hidden = true;
            ccRowMenu.style.display = 'none';
            document.querySelectorAll('.cc-row-menu-toggle.is-active').forEach(b => {
                b.classList.remove('is-active');
                b.setAttribute('aria-expanded', 'false');
            });
        }
        const ccTreeMenu = document.getElementById('ccTreeMoreMenu') || document.getElementById('ccTreeMoreFloatingMenu');
        if (ccTreeMenu && isElementVisible(ccTreeMenu) && !shouldKeep(ccTreeMenu)) {
            ccTreeMenu.hidden = true;
            ccTreeMenu.style.display = 'none';
            document.querySelectorAll('.cc-tree-more-btn.is-active').forEach(b => {
                b.classList.remove('is-active');
                b.setAttribute('aria-expanded', 'false');
            });
        }

        // 5. Bid Board floating row menu & status panel
        const bbRowMenu = document.getElementById('bbFloatingRowMenu');
        if (bbRowMenu && isElementVisible(bbRowMenu) && !shouldKeep(bbRowMenu)) {
            bbRowMenu.hidden = true;
            bbRowMenu.style.display = 'none';
            bbRowMenu.removeAttribute('data-current-project');
            document.querySelectorAll('.bb-row-menu-toggle.active').forEach(b => b.classList.remove('active'));
        }
        document.querySelectorAll('.bb-status-menu-panel.open, [data-status-panel].open').forEach(p => {
            if (!shouldKeep(p)) {
                p.classList.remove('open');
                document.querySelectorAll('.bb-status-pill-wrap.active').forEach(w => w.classList.remove('active'));
            }
        });

        // 6. Estimate footer action menus & dropdown
        document.querySelectorAll('[data-estimate-actions-menu]').forEach(m => {
            if (isElementVisible(m) && !shouldKeep(m)) {
                m.hidden = true;
            }
        });
        document.querySelectorAll('.est-version-menu-toggle[aria-expanded="true"]').forEach(b => {
            if (!shouldKeep(b)) {
                b.setAttribute('aria-expanded', 'false');
            }
        });
        const estPillMenu = document.querySelector('[data-est-pill-menu]');
        if (estPillMenu && isElementVisible(estPillMenu) && !shouldKeep(estPillMenu)) {
            estPillMenu.hidden = true;
        }

        // 7. Takeoff tool panels & popovers
        const toolsPanel = document.getElementById('takeoffMoreToolsPanel');
        if (toolsPanel && !toolsPanel.hasAttribute('hidden') && !shouldKeep(toolsPanel)) {
            toolsPanel.setAttribute('hidden', '');
        }
        const drawDropdown = document.getElementById('takeoffDrawingDropdown');
        if (drawDropdown && drawDropdown.classList.contains('open') && !shouldKeep(drawDropdown)) {
            drawDropdown.classList.remove('open');
        }
        const scalePanel = document.getElementById('takeoffScalePanel');
        if (scalePanel && scalePanel.classList.contains('open') && !shouldKeep(scalePanel)) {
            scalePanel.classList.remove('open');
        }
        const layersPopover = document.getElementById('takeoffViewerLayersPopover');
        if (layersPopover && layersPopover.classList.contains('open') && !shouldKeep(layersPopover)) {
            layersPopover.classList.remove('open');
        }

        // 8. Generic .pro-menu, .pro-row-menu, .takeoff-menu, .dropdown-menu, .documents-menu
        document.querySelectorAll('.pro-menu.open, .pro-row-menu.open, .takeoff-menu.open, .dropdown-menu.show, .documents-menu.open').forEach(m => {
            if (!shouldKeep(m)) {
                m.classList.remove('open', 'show');
                m.style.display = '';
                if (m.__trigger && !shouldKeep(m.__trigger)) {
                    m.__trigger.classList.remove('active', 'is-active');
                    m.__trigger.setAttribute('aria-expanded', 'false');
                    m.__trigger = null;
                }
            }
        });
        document.querySelectorAll('[data-doc-sidebar-more].active, [data-doc-action="menu"].active, [data-doc-action="sheet-menu"].active, [data-doc-folder-more].active, [data-doc-folder-menu-toggle].active, [data-doc-view-menu-toggle].active, #docSortMenuBtn.active, .doc-tree-item-more.active').forEach(b => {
            if (!shouldKeep(b)) {
                b.classList.remove('active', 'is-active');
                b.setAttribute('aria-expanded', 'false');
            }
        });

        // 9. Custom dropdowns
        document.querySelectorAll('.pro-custom-dropdown.is-open').forEach(d => {
            if (!shouldKeep(d)) {
                d.classList.remove('is-open');
                const tr = d.querySelector('.pro-custom-dropdown-trigger');
                if (tr) tr.setAttribute('aria-expanded', 'false');
            }
        });

        // 10. Document sidebar action menus
        document.querySelectorAll('#docSidebarActionMenu, .doc-sidebar-menu').forEach(m => {
            if (!shouldKeep(m)) {
                m.remove();
            }
        });

        // 11. Any other buttons with aria-expanded="true"
        document.querySelectorAll('[data-takeoff-menu-toggle][aria-expanded="true"]').forEach(b => {
            if (!shouldKeep(b)) {
                b.setAttribute('aria-expanded', 'false');
            }
        });
    }

    window.closeAllOpenPopouts = closeAllOpenPopouts;
    window.closeAllOpenMenus = closeAllOpenPopouts;

    let justClosedToggle = null;
    let justClosedTime = 0;

    const toggleSelector = (
        '[data-global-menu-toggle], [data-group-menu], [data-layer-menu], [data-task-menu], ' +
        '[data-note-menu], [data-doc-sidebar-more], [data-doc-folder-more], [data-doc-action="menu"], ' +
        '[data-doc-action="sheet-menu"], [data-doc-folder-menu-toggle], [data-doc-view-menu-toggle], ' +
        '#docSortMenuBtn, [data-doc-sort-toggle], .doc-tree-item-more, ' +
        '.cc-row-menu-toggle, [data-item-menu], .cc-tree-more-btn, [data-tree-more-catalog], ' +
        '[data-tree-more-group], .bb-row-menu-toggle, [data-row-menu], [data-status-trigger], ' +
        '[data-estimate-menu], .est-version-menu-toggle, [data-est-pill-toggle], ' +
        '#takeoffDrawingBtn, #takeoffScaleStatus, #takeoffMoreToolsBtn, [data-viewer-command="layers"], ' +
        '.pro-row-menu-btn, .pd-row-dots-btn, .pro-custom-dropdown-trigger'
    );

    function handleUniversalCapture(event) {
        const target = event.target;
        if (!target) return;

        // If this click closely follows a pointerdown that toggled off this switch, swallow it
        if (event.type === 'click' && justClosedToggle && (Date.now() - justClosedTime < 500)) {
            const isTargetOfClosedToggle = (
                justClosedToggle === target ||
                justClosedToggle.contains(target) ||
                Boolean(target.closest && target.closest(toggleSelector) === justClosedToggle)
            );
            if (isTargetOfClosedToggle) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                justClosedToggle = null;
                justClosedTime = 0;
                return;
            }
        }

        // 1. Check if clicking INSIDE any active open menu
        const activePopout = target.closest(
            '[data-global-menu].open, #takeoffGroupContextMenu, #takeoffEstimatePickerPopup, #pdItemContextMenu, ' +
            '#ccRowItemFloatingMenu, #ccTreeMoreMenu, #ccTreeMoreFloatingMenu, #bbFloatingRowMenu, ' +
            '.bb-status-menu-panel.open, [data-status-panel].open, ' +
            '[data-estimate-actions-menu]:not([hidden]), [data-est-pill-menu]:not([hidden]), ' +
            '#takeoffMoreToolsPanel:not([hidden]), #takeoffDrawingDropdown.open, #takeoffScalePanel.open, ' +
            '#takeoffViewerLayersPopover.open, .pro-menu.open, .pro-row-menu.open, .takeoff-menu.open, ' +
            '.documents-menu.open, .pro-custom-dropdown.is-open, .dropdown-menu.show, #docSidebarActionMenu, .doc-sidebar-menu'
        );
        if (activePopout && isElementVisible(activePopout)) {
            // User clicked inside this menu item/button. Keep this popout, close all others!
            closeAllOpenPopouts(activePopout);
            return;
        }

        // 2. Check if clicking on ANY 3-dots or menu toggle button
        const clickedToggle = target.closest(toggleSelector);

        if (clickedToggle) {
            // Check if this toggle was the trigger of an ALREADY OPEN menu
            const openDocMenu = document.querySelector('.documents-menu.open');
            const isDocMenuTrigger = Boolean(
                openDocMenu && (
                    openDocMenu.__trigger === clickedToggle ||
                    openDocMenu.__trigger?.contains(clickedToggle) ||
                    clickedToggle.contains(openDocMenu.__trigger) ||
                    (clickedToggle.dataset && clickedToggle.dataset.docSidebarMore && openDocMenu.id === 'docSidebarMenu' && openDocMenu.__activeTarget === clickedToggle.dataset.docSidebarMore) ||
                    (clickedToggle.dataset && clickedToggle.dataset.docId && openDocMenu.dataset && openDocMenu.dataset.docMenu === String(clickedToggle.dataset.docId)) ||
                    (clickedToggle.id === 'docSortMenuBtn' && document.getElementById('docSortMenu')?.classList.contains('open')) ||
                    (clickedToggle.matches && clickedToggle.matches('[data-doc-view-menu-toggle]') && document.getElementById('documentsViewMenu')?.classList.contains('open')) ||
                    (clickedToggle.matches && clickedToggle.matches('[data-doc-folder-menu-toggle]') && document.getElementById('docSidebarMenu')?.classList.contains('open') && document.getElementById('docSidebarMenu')?.__activeTarget === 'header:folders')
                )
            );

            const isAlreadyActiveToggle = (
                clickedToggle.classList.contains('is-active') ||
                clickedToggle.classList.contains('active') ||
                clickedToggle.getAttribute('aria-expanded') === 'true' ||
                isDocMenuTrigger ||
                (clickedToggle.id === 'takeoffDrawingBtn' && document.getElementById('takeoffDrawingDropdown')?.classList.contains('open')) ||
                (clickedToggle.id === 'takeoffScaleStatus' && document.getElementById('takeoffScalePanel')?.classList.contains('open')) ||
                (clickedToggle.id === 'takeoffMoreToolsBtn' && !document.getElementById('takeoffMoreToolsPanel')?.hasAttribute('hidden'))
            );

            if (isAlreadyActiveToggle) {
                // The user clicked the same toggle that opened the menu, to toggle it off!
                justClosedToggle = clickedToggle;
                justClosedTime = Date.now();
                clickedToggle.__wasOpenAtPointerDown = Date.now();
                closeAllOpenPopouts();
                if (event.type === 'click') {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                }
                return;
            }

            // The user clicked a DIFFERENT 3-dots button or menu toggle!
            // Close any currently open menu immediately, so the new one can open fresh without overlap:
            closeAllOpenPopouts();
            return;
        }

        // 3. The user clicked anywhere else on the page (subheader, canvas, table, card, blank area):
        // Close all open popouts!
        closeAllOpenPopouts();
    }

    document.addEventListener('pointerdown', handleUniversalCapture, true);
    document.addEventListener('click', handleUniversalCapture, true);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeAllOpenPopouts();
        }
    }, true);

    // Auto-init on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initCustomSelects());
    } else {
        initCustomSelects();
    }

    // Auto-detect dynamically inserted selects (e.g. modals, ajax panels)
    if (window.MutationObserver) {
        const globalSelectObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.addedNodes && m.addedNodes.length) {
                    m.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            if (node.tagName === 'SELECT') {
                                enhanceSelect(node);
                            } else if (typeof node.querySelectorAll === 'function') {
                                node.querySelectorAll('select:not([data-custom-enhanced="true"])').forEach(enhanceSelect);
                            }
                        }
                    });
                }
            }
        });
        if (document.body) {
            globalSelectObserver.observe(document.body, { childList: true, subtree: true });
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                if (document.body) globalSelectObserver.observe(document.body, { childList: true, subtree: true });
            });
        }
    }
})();
