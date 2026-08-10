(function () {
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[ch]));

    function render(options = {}) {
        const estimates = Array.isArray(options.estimates) ? options.estimates : [];
        const activeId = String(options.activeEstimateId || estimates[0]?.id || '');
        const selectAttribute = options.selectAttribute || 'data-version';
        const actionAttribute = options.actionAttribute || 'data-est-action';
        const estimateLabel = `${estimates.length} ${estimates.length === 1 ? 'estimate' : 'estimates'}`;
        const tabs = estimates.map(estimate => {
            const estimateId = String(estimate.id || '');
            const active = estimateId === activeId;
            const itemCount = (estimate.groups || []).reduce((sum, group) => sum + (group.items || []).length, 0);
            const itemLabel = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
            return `<button type="button" class="est-version-tab${active ? ' active' : ''}" ${selectAttribute}="${esc(estimateId)}" aria-pressed="${active}"><span><strong>${esc(estimate.name || 'Estimate')}</strong><small>${esc(estimate.status || 'Draft')} · ${itemLabel}</small></span>${estimate.isLocked ? '<i class="fas fa-lock" aria-label="Locked"></i>' : ''}</button>`;
        }).join('');
        const empty = estimates.length ? '' : '<span class="est-muted">No estimates available</span>';
        return `<span class="est-pill">${estimateLabel}</span>${tabs}${empty}<button type="button" class="est-btn est-new-estimate" ${actionAttribute}="new-estimate"><i class="fas fa-plus"></i><span>New estimate</span></button><button type="button" class="est-btn" ${actionAttribute}="compare-estimates" ${estimates.length < 2 ? 'disabled' : ''}><i class="fas fa-code-compare"></i><span>Compare</span></button>`;
    }

    window.ProjectEstimateFooter = Object.freeze({ render });
})();
