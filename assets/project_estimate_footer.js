(function () {
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[ch]));

    function getEstimateTotal(estimate) {
        if (!estimate) return 0;
        if (typeof estimate.estimateTotal === 'number' && estimate.estimateTotal > 0) return estimate.estimateTotal;
        if (typeof estimate.totalSales === 'number' && estimate.totalSales > 0) return estimate.totalSales;
        if (typeof estimate.grand_total === 'number' && estimate.grand_total > 0) return estimate.grand_total;
        if (typeof estimate.total_amount === 'number' && estimate.total_amount > 0) return estimate.total_amount;
        if (typeof estimate.total === 'number' && estimate.total > 0) return estimate.total;
        if (window.EstimateCalculationService) {
            try {
                if (typeof window.EstimateCalculationService.calculateSummary === 'function') {
                    const calc = window.EstimateCalculationService.calculateSummary(estimate.groups || [], estimate.settings || {});
                    if (calc && typeof calc.estimateTotal === 'number' && calc.estimateTotal > 0) return calc.estimateTotal;
                }
                if (typeof window.EstimateCalculationService.calculateEstimate === 'function') {
                    const calc = window.EstimateCalculationService.calculateEstimate(estimate);
                    if (calc && typeof calc.estimateTotal === 'number' && calc.estimateTotal > 0) return calc.estimateTotal;
                }
            } catch (e) {}
        }
        let sum = 0;
        (estimate.groups || []).forEach(g => {
            (g.items || []).forEach(it => {
                const qty = Number(it.quantity ?? it.takeoff_quantity ?? it.qty ?? 0);
                const price = Number(it.unit_cost ?? it.unit_price ?? it.cost ?? it.unitCost ?? 0);
                sum += qty * price;
            });
        });
        return sum;
    }

    function formatMoney(val) {
        const num = Number(val || 0);
        return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function render(options = {}) {
        const rawEstimates = Array.isArray(options.estimates) ? options.estimates : [];
        const activeId = String(options.activeEstimateId || rawEstimates[0]?.id || '');
        const selectAttribute = options.selectAttribute || 'data-version';
        const actionAttribute = options.actionAttribute || 'data-est-action';
        const menuAttribute = options.menuAttribute || '';
        const itemActionAttribute = options.itemActionAttribute || 'data-estimate-action';
        const estimateLabel = `E${rawEstimates.length}`;

        // Ensure strictly ONE estimate is resolved as primary
        const metaPrimaryId = String(window.ProjectState?.projectMeta?.primary_estimate_id || '');
        let resolvedPrimaryId = '';
        if (metaPrimaryId && rawEstimates.some(e => String(e.id || '') === metaPrimaryId)) {
            resolvedPrimaryId = metaPrimaryId;
        } else {
            const explicit = rawEstimates.find(e => Boolean(e.is_primary || e.isPrimary || e.primary));
            resolvedPrimaryId = explicit ? String(explicit.id || '') : (rawEstimates[0] ? String(rawEstimates[0].id || '') : '');
        }

        const pinnedIds = new Set(Array.isArray(window.ProjectState?.projectMeta?.pinned_estimate_ids)
            ? window.ProjectState.projectMeta.pinned_estimate_ids.map(String)
            : []);

        // Sort: Primary estimate ALWAYS index 0, followed by other pinned estimates, then unpinned estimates
        const primaryEst = rawEstimates.find(e => String(e.id || '') === resolvedPrimaryId) || rawEstimates[0];
        const otherPinned = rawEstimates.filter(e => {
            const id = String(e.id || '');
            return id !== resolvedPrimaryId && (pinnedIds.has(id) || Boolean(e.isPinned || e.pinned));
        });
        const unpinned = rawEstimates.filter(e => {
            const id = String(e.id || '');
            return id !== resolvedPrimaryId && !pinnedIds.has(id) && !e.isPinned && !e.pinned;
        });
        const estimates = primaryEst ? [primaryEst, ...otherPinned, ...unpinned] : [];

        const tabs = estimates.map(estimate => {
            const estimateId = String(estimate.id || '');
            const active = estimateId === activeId;
            const isPrimary = Boolean(resolvedPrimaryId && estimateId === resolvedPrimaryId);
            const isPinned = isPrimary || pinnedIds.has(estimateId) || Boolean(estimate.isPinned || estimate.pinned);
            const totalCost = getEstimateTotal(estimate);
            const priceLabel = formatMoney(totalCost);
            const primaryStar = isPrimary
                ? `<i class="fas fa-star est-primary-star" style="color: #fb5a3a !important; font-size: 8px; vertical-align: middle; margin-left: 4px;" title="Primary estimate (Bid Board value)"></i>`
                : '';
            const pinBadge = (!isPrimary && isPinned)
                ? `<i class="fas fa-thumbtack est-pin-icon" style="color: #fb5a3a; font-size: 8px; vertical-align: middle; margin-left: 3px;" title="Pinned estimate"></i>`
                : '';
            const setPrimaryButton = `<button type="button" ${itemActionAttribute}="set-primary" data-estimate-id="${esc(estimateId)}"><i class="fas fa-star" style="color:${isPrimary ? '#fb5a3a' : 'inherit'};"></i> <span class="est-set-primary-text" style="color:var(--text-muted, #64748b); font-weight:500;">${isPrimary ? 'Primary estimate' : 'Set as primary'}</span></button>`;
            const togglePinButton = !isPrimary ? `<button type="button" ${itemActionAttribute}="toggle-pin" data-estimate-id="${esc(estimateId)}"><i class="fas fa-thumbtack" style="${isPinned ? 'color:#fb5a3a;' : ''}"></i> <span style="color:var(--text-muted, #64748b); font-weight:500;">${isPinned ? 'Unpin estimate' : 'Pin estimate'}</span></button>` : '';
            const menu = menuAttribute ? `<button type="button" class="est-version-menu-toggle" ${menuAttribute}="${esc(estimateId)}" aria-label="Actions for ${esc(estimate.name || 'Estimate')}" aria-expanded="false"><i class="fas fa-ellipsis-vertical"></i></button><div class="est-version-menu" data-estimate-actions-menu="${esc(estimateId)}" hidden>${setPrimaryButton}${togglePinButton}<button type="button" ${itemActionAttribute}="rename" data-estimate-id="${esc(estimateId)}"><i class="fas fa-pen"></i> Rename</button><button type="button" ${itemActionAttribute}="copy" data-estimate-id="${esc(estimateId)}"><i class="fas fa-copy"></i> Copy</button><button type="button" class="danger" ${itemActionAttribute}="delete" data-estimate-id="${esc(estimateId)}"><i class="fas fa-trash"></i> Delete</button></div>` : '';
            return `<span class="est-version-entry"><button type="button" class="est-version-tab${active ? ' active' : ''}" ${selectAttribute}="${esc(estimateId)}" aria-pressed="${active}"><span class="est-tab-body"><strong>${esc(estimate.name || 'Estimate')}</strong><span class="est-price-line"><small>${priceLabel}</small>${primaryStar}${pinBadge}</span></span>${estimate.isLocked ? '<i class="fas fa-lock" aria-label="Locked"></i>' : ''}</button>${menu}</span>`;
        }).join('');
        const empty = estimates.length ? '' : '<span class="est-muted">No estimates available</span>';
        const compareBtn = options.showCompare === false
            ? ''
            : `<button type="button" class="est-btn" ${actionAttribute}="compare-estimates" ${estimates.length < 2 ? 'disabled' : ''}><i class="fas fa-code-compare"></i><span>Compare</span></button>`;

        const pillMenuHtml = `
            <div class="est-pill-wrap">
                <button type="button" class="est-pill est-pill-btn" data-est-pill-toggle title="View all estimates (${rawEstimates.length})">
                    <span>${estimateLabel}</span>
                    <i class="fas fa-chevron-down est-pill-caret"></i>
                </button>
                <div class="est-version-menu est-pill-dropdown" data-est-pill-menu hidden>
                    <div class="est-pill-menu-header">All Estimates (${rawEstimates.length})</div>
                    <div class="est-pill-menu-list">
                        ${rawEstimates.map(e => {
                            const eid = String(e.id || '');
                            const isCur = eid === activeId;
                            const isPrim = eid === resolvedPrimaryId;
                            const isPin = isPrim || pinnedIds.has(eid) || Boolean(e.isPinned || e.pinned);
                            const safeName = esc(e.name || 'Estimate');
                            return `<button type="button" class="est-pill-menu-item ${isCur ? 'active' : ''}" ${selectAttribute}="${esc(eid)}" title="${safeName}">
                                <div class="est-pill-item-main">
                                    <div class="est-pill-item-name" title="${safeName}">
                                        ${isPrim ? '<i class="fas fa-star" style="color:#fb5a3a; font-size:9px; margin-right:4px;"></i>' : (isPin ? '<i class="fas fa-thumbtack" style="color:#fb5a3a; font-size:9px; margin-right:4px;"></i>' : '')}
                                        <span title="${safeName}">${safeName}</span>
                                    </div>
                                    <div class="est-pill-item-price">${formatMoney(getEstimateTotal(e))}</div>
                                </div>
                                ${isCur ? '<i class="fas fa-check est-pill-item-check"></i>' : ''}
                            </button>`;
                        }).join('')}
                    </div>
                </div>
            </div>`;

        return `${pillMenuHtml}<div class="est-version-tabs-scroll">${tabs}${empty}</div><div class="est-version-fixed-actions"><button type="button" class="est-btn est-new-estimate" ${actionAttribute}="new-estimate" title="New estimate" aria-label="New estimate"><i class="fas fa-plus"></i></button>${compareBtn}</div>`;
    }

    function getContainerBoundary(el) {
        const margin = 10;
        const boundaryEl = el?.closest?.('.workspace-shell, .pro-takeoff-workspace, .estimating-page, .proposal-workspace, body') || document.body;
        if (!boundaryEl || boundaryEl === document.body || boundaryEl === document.documentElement) {
            return {
                left: margin,
                top: margin,
                right: window.innerWidth - margin,
                bottom: window.innerHeight - margin,
                width: window.innerWidth - (margin * 2),
                height: window.innerHeight - (margin * 2)
            };
        }
        const bRect = boundaryEl.getBoundingClientRect();
        return {
            left: Math.max(margin, bRect.left + margin),
            top: Math.max(margin, bRect.top + margin),
            right: Math.min(window.innerWidth - margin, bRect.right - margin),
            bottom: Math.min(window.innerHeight - margin, bRect.bottom - margin),
            width: Math.max(0, Math.min(window.innerWidth - margin, bRect.right - margin) - Math.max(margin, bRect.left + margin)),
            height: Math.max(0, Math.min(window.innerHeight - margin, bRect.bottom - margin) - Math.max(margin, bRect.top + margin))
        };
    }

    function positionMenu(menu, anchor) {
        if (!menu || !anchor) return;
        const bounds = getContainerBoundary(anchor);
        const rect = anchor.getBoundingClientRect();

        menu.hidden = false;
        menu.style.visibility = 'hidden';
        menu.style.left = '0px';
        menu.style.top = '0px';
        menu.style.bottom = 'auto';
        menu.style.right = 'auto';

        const menuRect = menu.getBoundingClientRect();
        const menuW = menuRect.width || menu.offsetWidth || 180;
        const menuH = menuRect.height || menu.offsetHeight || 190;

        // Smart horizontal alignment within container boundaries:
        let left;
        const boundaryMidX = bounds.left + (bounds.width / 2);
        if (rect.left + menuW > bounds.right || rect.left > boundaryMidX) {
            left = rect.right - menuW;
        } else {
            left = rect.left;
        }

        // Clamp strictly within container boundary:
        if (left + menuW > bounds.right) {
            left = bounds.right - menuW;
        }
        if (left < bounds.left) {
            left = bounds.left;
        }

        // Smart vertical alignment within container boundaries:
        let top = 'auto';
        let bottom = 'auto';
        if (rect.top - menuH >= bounds.top) {
            bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
        } else {
            top = `${Math.round(Math.min(bounds.bottom - menuH, rect.bottom + 6))}px`;
        }

        menu.style.left = `${Math.round(left)}px`;
        menu.style.right = 'auto';
        menu.style.top = top;
        menu.style.bottom = bottom;
        menu.style.visibility = 'visible';
    }

    function bindMenus(container, options = {}) {
        if (!container || typeof container.addEventListener !== 'function') return;
        container.__estimateMenuOptions = options;

        const scrollContainer = container.querySelector('.est-version-tabs-scroll') || container;
        if (scrollContainer && !scrollContainer.__wheelBound) {
            scrollContainer.__wheelBound = true;
            scrollContainer.addEventListener('wheel', event => {
                if (event.deltaY !== 0) {
                    event.preventDefault();
                    scrollContainer.scrollLeft += event.deltaY;
                }
            }, { passive: false });
        }

        if (container.__estimateMenusBound) return;
        container.__estimateMenusBound = true;
        container.addEventListener('click', event => {
            const config = container.__estimateMenuOptions || {};
            const menuAttribute = config.menuAttribute || 'data-estimate-menu';
            const actionAttribute = config.itemActionAttribute || 'data-estimate-action';

            const pillToggle = event.target.closest('[data-est-pill-toggle]');
            if (pillToggle) {
                event.stopPropagation();
                const dropdown = container.querySelector('[data-est-pill-menu]');
                const opening = Boolean(dropdown?.hidden);
                container.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
                container.querySelectorAll(`[${menuAttribute}]`).forEach(row => row.setAttribute('aria-expanded', 'false'));
                if (dropdown) {
                    if (opening) {
                        positionMenu(dropdown, pillToggle);
                    } else {
                        dropdown.hidden = true;
                    }
                }
                return;
            }

            const toggle = event.target.closest(`[${menuAttribute}]`);
            if (toggle) {
                event.stopPropagation();
                const id = toggle.getAttribute(menuAttribute);
                const menu = [...container.querySelectorAll('[data-estimate-actions-menu]')]
                    .find(row => row.dataset.estimateActionsMenu === id);
                const opening = Boolean(menu?.hidden);
                container.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
                container.querySelectorAll(`[${menuAttribute}]`).forEach(row => row.setAttribute('aria-expanded', 'false'));
                const pillMenu = container.querySelector('[data-est-pill-menu]');
                if (pillMenu) pillMenu.hidden = true;

                if (menu && opening) {
                    positionMenu(menu, toggle);
                    toggle.setAttribute('aria-expanded', 'true');
                }
                return;
            }
            const pillItem = event.target.closest('.est-pill-menu-item');
            if (pillItem) {
                const pillMenu = container.querySelector('[data-est-pill-menu]');
                if (pillMenu) pillMenu.hidden = true;
            }

            const action = event.target.closest(`[${actionAttribute}]`);
            if (!action) return;
            event.stopPropagation();
            container.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
            const pillMenu = container.querySelector('[data-est-pill-menu]');
            if (pillMenu) pillMenu.hidden = true;
            config.onAction?.(action.getAttribute(actionAttribute), action.dataset.estimateId);
        });
        document.addEventListener('click', event => {
            const inPill = event.target.closest('.est-pill-wrap');
            if (!inPill) {
                const pillMenu = container.querySelector('[data-est-pill-menu]');
                if (pillMenu) pillMenu.hidden = true;
            }
            if (container.contains(event.target)) return;
            container.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            container.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
            const pillMenu = container.querySelector('[data-est-pill-menu]');
            if (pillMenu) pillMenu.hidden = true;
        });
    }

    window.ProjectEstimateFooter = Object.freeze({ render, bindMenus });
})();
