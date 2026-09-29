(function () {
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[ch]));

    function getEstimateTotal(estimate) {
        if (!estimate) return 0;
        if (typeof estimate.total_amount === 'number' && estimate.total_amount > 0) return estimate.total_amount;
        if (typeof estimate.grand_total === 'number' && estimate.grand_total > 0) return estimate.grand_total;
        if (typeof estimate.totalSales === 'number' && estimate.totalSales > 0) return estimate.totalSales;
        if (window.EstimateCalculationService && typeof window.EstimateCalculationService.calculateEstimate === 'function') {
            try {
                const calc = window.EstimateCalculationService.calculateEstimate(estimate);
                if (calc && typeof calc.estimateTotal === 'number') return calc.estimateTotal;
            } catch (e) {}
        }
        let sum = 0;
        (estimate.groups || []).forEach(g => {
            (g.items || []).forEach(it => {
                const qty = Number(it.quantity ?? it.takeoff_quantity ?? 1);
                const price = Number(it.unit_cost ?? it.unit_price ?? it.cost ?? 0);
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
        const estimates = Array.isArray(options.estimates) ? options.estimates : [];
        const activeId = String(options.activeEstimateId || estimates[0]?.id || '');
        const selectAttribute = options.selectAttribute || 'data-version';
        const actionAttribute = options.actionAttribute || 'data-est-action';
        const menuAttribute = options.menuAttribute || '';
        const itemActionAttribute = options.itemActionAttribute || 'data-estimate-action';
        const estimateLabel = `E${estimates.length}`;
        const tabs = estimates.map(estimate => {
            const estimateId = String(estimate.id || '');
            const active = estimateId === activeId;
            const metaPrimaryId = String(window.ProjectState?.projectMeta?.primary_estimate_id || '');
            const isPrimary = metaPrimaryId
                ? estimateId === metaPrimaryId
                : Boolean(estimate.is_primary || estimate.isPrimary || estimate.primary);
            const totalCost = getEstimateTotal(estimate);
            const priceLabel = formatMoney(totalCost);
            const primaryStar = isPrimary
                ? `<i class="fas fa-star est-primary-star" style="color: #fb5a3a !important; font-size: 10px; margin-left: auto;" title="Primary estimate (Bid Board value)"></i>`
                : '';
            const setPrimaryButton = `<button type="button" ${itemActionAttribute}="set-primary" data-estimate-id="${esc(estimateId)}"><i class="fas fa-star" style="color:${isPrimary ? '#fb5a3a' : 'inherit'};"></i> <span class="est-set-primary-text" style="color:var(--text-muted, #64748b); font-weight:500;">${isPrimary ? 'Primary estimate' : 'Set as primary'}</span></button>`;
            const menu = menuAttribute ? `<button type="button" class="est-version-menu-toggle" ${menuAttribute}="${esc(estimateId)}" aria-label="Actions for ${esc(estimate.name || 'Estimate')}" aria-expanded="false"><i class="fas fa-ellipsis-vertical"></i></button><div class="est-version-menu" data-estimate-actions-menu="${esc(estimateId)}" hidden>${setPrimaryButton}<button type="button" ${itemActionAttribute}="rename" data-estimate-id="${esc(estimateId)}"><i class="fas fa-pen"></i> Rename</button><button type="button" ${itemActionAttribute}="copy" data-estimate-id="${esc(estimateId)}"><i class="fas fa-copy"></i> Copy</button><button type="button" class="danger" ${itemActionAttribute}="delete" data-estimate-id="${esc(estimateId)}"><i class="fas fa-trash"></i> Delete</button></div>` : '';
            return `<span class="est-version-entry"><button type="button" class="est-version-tab${active ? ' active' : ''}" ${selectAttribute}="${esc(estimateId)}" aria-pressed="${active}"><span class="est-tab-body"><strong>${esc(estimate.name || 'Estimate')}</strong><span class="est-price-line"><small>${priceLabel}</small>${primaryStar}</span></span>${estimate.isLocked ? '<i class="fas fa-lock" aria-label="Locked"></i>' : ''}</button>${menu}</span>`;
        }).join('');
        const empty = estimates.length ? '' : '<span class="est-muted">No estimates available</span>';
        const compareBtn = options.showCompare === false
            ? ''
            : `<button type="button" class="est-btn" ${actionAttribute}="compare-estimates" ${estimates.length < 2 ? 'disabled' : ''}><i class="fas fa-code-compare"></i><span>Compare</span></button>`;
        return `<span class="est-pill">${estimateLabel}</span>${tabs}${empty}<button type="button" class="est-btn est-new-estimate" ${actionAttribute}="new-estimate" title="New estimate" aria-label="New estimate"><i class="fas fa-plus"></i></button>${compareBtn}`;
    }

    function bindMenus(container, options = {}) {
        if (!container || typeof container.addEventListener !== 'function') return;
        container.__estimateMenuOptions = options;
        if (container.__estimateMenusBound) return;
        container.__estimateMenusBound = true;
        container.addEventListener('click', event => {
            const config = container.__estimateMenuOptions || {};
            const menuAttribute = config.menuAttribute || 'data-estimate-menu';
            const actionAttribute = config.itemActionAttribute || 'data-estimate-action';
            const toggle = event.target.closest(`[${menuAttribute}]`);
            if (toggle) {
                event.stopPropagation();
                const id = toggle.getAttribute(menuAttribute);
                const menu = [...container.querySelectorAll('[data-estimate-actions-menu]')]
                    .find(row => row.dataset.estimateActionsMenu === id);
                const opening = Boolean(menu?.hidden);
                container.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
                container.querySelectorAll(`[${menuAttribute}]`).forEach(row => row.setAttribute('aria-expanded', 'false'));
                if (menu && opening) {
                    const rect = toggle.getBoundingClientRect();
                    menu.hidden = false;
                    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 185, rect.right - 175))}px`;
                    menu.style.top = 'auto';
                    menu.style.bottom = `${Math.max(10, window.innerHeight - rect.top + 8)}px`;
                    toggle.setAttribute('aria-expanded', 'true');
                }
                return;
            }
            const action = event.target.closest(`[${actionAttribute}]`);
            if (!action) return;
            event.stopPropagation();
            container.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
            config.onAction?.(action.getAttribute(actionAttribute), action.dataset.estimateId);
        });
        document.addEventListener('click', event => {
            if (container.contains(event.target)) return;
            container.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            container.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
        });
    }

    window.ProjectEstimateFooter = Object.freeze({ render, bindMenus });
})();
