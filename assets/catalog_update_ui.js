(function (global) {
    'use strict';

    const root = document.getElementById('estimatingModule');
    if (!root) return;

    const state = {
        open: false,
        phase: 'idle',
        prepared: null,
        selected: new Set(),
        errorCode: null,
        errorMessage: '',
        operation: 0,
        refreshTimer: null,
        returnFocus: null,
        restoreSelector: null
    };
    const money = value => Number(value || 0).toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 2
    });
    const number = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', {
        maximumFractionDigits: digits
    });
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
    const present = value => value !== null && value !== undefined;
    const currentPreview = () => state.prepared?.preview || null;
    const busy = () => ['checking', 'refreshing', 'applying'].includes(state.phase);

    function estimateItems(estimate) {
        const rows = [];
        const visit = item => { rows.push(item); (item.children || []).forEach(visit); };
        (estimate?.groups || []).forEach(group => (group.items || []).forEach(visit));
        return rows;
    }

    function itemIndex(preview) {
        return new Map(estimateItems(preview?.projectedEstimate).map(item => [
            String(item.catalogItemId ?? item.catalogSnapshot?.catalogItemId ?? item.id), item
        ]));
    }

    function impactIndex(preview) {
        return new Map((preview?.itemImpacts || []).map(impact => [String(impact.catalogItemId), impact]));
    }

    function selectable(change) {
        return ['OUTDATED', 'UNVERSIONED'].includes(String(change?.status || ''));
    }

    function applicableChanges(preview) {
        return (preview?.changeSet?.itemChanges || []).filter(selectable);
    }

    function setTriggerBusy(isBusy) {
        root.querySelectorAll('[data-est-action="catalog-update"]').forEach(button => {
            button.disabled = isBusy;
            button.setAttribute('aria-busy', String(isBusy));
            const label = button.querySelector('span');
            if (label) label.textContent = isBusy ? 'Checking Cost Catalog…' : 'Update from Cost Catalog';
        });
    }

    function humanError(code, fallback = '') {
        const messages = {
            ESTIMATE_CHANGED_SINCE_PREVIEW: 'This estimate changed after the preview was generated.',
            CATALOG_CHANGED_SINCE_PREVIEW: 'The Cost Catalog changed after this preview was generated.',
            PREVIEW_OPTIONS_CHANGED: 'The selected update options changed. Refresh the preview before continuing.',
            CATALOG_UPDATE_PERSISTENCE_FAILED: 'The update is saved as a local draft, but the database could not confirm it yet.',
            NETWORK_ERROR: 'The Cost Catalog could not be reached. Check your connection and try again.'
        };
        return messages[code] || fallback || 'The Cost Catalog update could not be completed. Try again.';
    }

    function warningText(value) {
        const code = String(value || '').split(':')[0];
        const messages = {
            MISSING_CATALOG_ITEM_PRESERVED: 'An item is no longer available in the Cost Catalog and will remain unchanged.',
            LEGACY_ITEM_NOT_REFRESHABLE: 'A legacy item has no historical snapshot and cannot be refreshed automatically.',
            REMOVED_COMPONENT_WITH_OVERRIDE: 'An Assembly component with a project override was removed; its override will be retained in update history.',
            CATALOG_REVISION_REGRESSION: 'A catalog revision appears older than the saved snapshot.',
            CONTENT_MISMATCH_AT_SAME_REVISION: 'Catalog content changed without a revision change.',
            CURRENT_CATALOG_REVISION_MISSING: 'The current catalog item has no revision number.'
        };
        return messages[code] || 'This item needs review before updating.';
    }

    function updateTriggerState() {
        setTriggerBusy(state.phase === 'checking');
    }

    async function checkCatalog() {
        if (busy()) return;
        state.returnFocus = document.activeElement;
        state.open = true;
        state.phase = 'checking';
        state.errorCode = null;
        state.errorMessage = '';
        state.prepared = null;
        state.selected.clear();
        const operation = ++state.operation;
        updateTriggerState();
        render();
        try {
            const prepared = await global.projectEstimatingPrepareCatalogUpdate();
            if (operation !== state.operation || !state.open) return;
            state.prepared = prepared;
            applicableChanges(prepared.preview).forEach(change => state.selected.add(String(change.catalogItemId)));
            state.phase = state.selected.size ? 'preview' : 'up-to-date';
        } catch (error) {
            if (operation !== state.operation || !state.open) return;
            state.phase = 'error';
            state.errorCode = error.code || 'PREPARE_FAILED';
            state.errorMessage = humanError(state.errorCode, error.message);
            console.error('[Cost Catalog update] prepare failed', error);
        } finally {
            if (operation === state.operation) {
                updateTriggerState();
                render();
            }
        }
    }

    function scheduleSelectionPreview() {
        clearTimeout(state.refreshTimer);
        state.phase = 'refreshing';
        render();
        state.refreshTimer = setTimeout(refreshSelectionPreview, 180);
    }

    async function refreshSelectionPreview() {
        const operation = ++state.operation;
        const selectedCatalogItemIds = [...state.selected];
        try {
            const prepared = await global.projectEstimatingPrepareCatalogUpdate({ selectedCatalogItemIds });
            if (operation !== state.operation || !state.open) return;
            state.prepared = prepared;
            state.phase = 'preview';
            state.errorCode = null;
        } catch (error) {
            if (operation !== state.operation || !state.open) return;
            state.phase = 'error';
            state.errorCode = error.code || 'PREPARE_FAILED';
            state.errorMessage = humanError(state.errorCode, error.message);
            console.error('[Cost Catalog update] preview refresh failed', error);
        }
        render();
    }

    async function applyUpdate() {
        if (!state.prepared || !state.selected.size || busy()) return;
        state.phase = 'applying';
        render();
        try {
            const result = await global.projectEstimatingApplyCatalogUpdate(state.prepared, {
                selectedCatalogItemIds: [...state.selected]
            });
            state.phase = 'success';
            state.prepared = { ...state.prepared, appliedResult: result };
            state.errorCode = null;
        } catch (error) {
            state.errorCode = error.code || 'APPLY_FAILED';
            state.errorMessage = humanError(state.errorCode, error.message);
            state.phase = ['ESTIMATE_CHANGED_SINCE_PREVIEW', 'CATALOG_CHANGED_SINCE_PREVIEW', 'PREVIEW_OPTIONS_CHANGED']
                .includes(state.errorCode) ? 'stale' : 'error';
            console.error('[Cost Catalog update] apply failed', error);
        }
        render();
    }

    function close() {
        if (state.phase === 'applying') return;
        clearTimeout(state.refreshTimer);
        state.operation += 1;
        state.open = false;
        state.phase = 'idle';
        document.querySelector('[data-catalog-update-portal]')?.remove();
        updateTriggerState();
        if (state.returnFocus?.isConnected) state.returnFocus.focus();
    }

    function countPills(preview) {
        const changeSet = preview.changeSet || {};
        const entries = [
            ['Items checked', changeSet.linkedItems],
            ['Items changed', changeSet.outdatedItems + changeSet.unversionedItems],
            ['Pricing changes', changeSet.changesByType?.pricing],
            ['Labor changes', changeSet.changesByType?.labor],
            ['Equipment changes', changeSet.changesByType?.equipment],
            ['Assembly changes', changeSet.changesByType?.assemblies],
            ['Missing items', changeSet.missingItems, 'warning'],
            ['Legacy items', changeSet.legacyItems, 'warning']
        ];
        return entries.filter(([, value], index) => index === 0 || Number(value) > 0).map(([label, value, tone]) =>
            `<div class="est-cu-stat ${tone || ''}"><strong>${number(value, 0)}</strong><span>${esc(label)}</span></div>`).join('');
    }

    function totals(preview) {
        const difference = preview.difference || {};
        const amount = Number(difference.amount || 0);
        const percent = difference.percent;
        const sign = amount > 0 ? '+' : '';
        return `<section class="est-cu-totals" aria-label="Estimate total comparison">
            <div><span>Current Estimate</span><strong>${money(preview.current?.total)}</strong></div>
            <div><span>Projected Estimate</span><strong>${money(preview.projected?.total)}</strong></div>
            <div class="${amount > 0 ? 'increase' : amount < 0 ? 'decrease' : ''}"><span>Difference</span><strong>${sign}${money(amount)}</strong><small>${present(percent) ? `${amount > 0 ? '+' : ''}${number(percent)}%` : 'New total'}</small></div>
        </section>`;
    }

    function valueText(field, value) {
        if (['pricing.materialUnitCost', 'pricing.equipmentUnitCost', 'pricing.subcontractorUnitCost', 'pricing.laborRate'].includes(field)) {
            return money(value);
        }
        if (field === 'pricing.laborHoursPerUnit') return `${number(value, 4)} hr`;
        return present(value) && typeof value === 'object' ? 'Changed' : String(value ?? '—');
    }

    function fieldLabel(field) {
        return ({
            'pricing.materialUnitCost': 'Material Cost',
            'pricing.equipmentUnitCost': 'Equipment Cost',
            'pricing.subcontractorUnitCost': 'Subcontractor Cost',
            'pricing.laborHoursPerUnit': 'Labor Hours',
            'pricing.laborRate': 'Labor Rate',
            uom: 'Unit of Measure', type: 'Item Type', costCategory: 'Cost Category'
        })[field] || 'Catalog information';
    }

    function componentText(componentChange) {
        const component = componentChange.currentValue || componentChange.previousValue || {};
        const identity = component.name || component.catalogItemName || component.catalogItemId || componentChange.componentKey;
        if (componentChange.change === 'ADDED') return `<span class="added"><i class="fas fa-plus" aria-hidden="true"></i> Added component ${esc(identity)}</span>`;
        if (componentChange.change === 'REMOVED') return `<span class="removed"><i class="fas fa-minus" aria-hidden="true"></i> Removed component ${esc(identity)}</span>`;
        const label = ({ quantity: 'Quantity', ratioType: 'Ratio', spacing: 'Spacing', waste: 'Waste' })[componentChange.field]
            || 'Component definition';
        return `<span><i class="fas fa-arrow-right" aria-hidden="true"></i> ${esc(label)}: ${esc(valueText(componentChange.field, componentChange.previousValue))} → ${esc(valueText(componentChange.field, componentChange.currentValue))}</span>`;
    }

    function changesHtml(change) {
        return (change.changes || []).map(row => {
            if (row.field === 'assemblyComponents') {
                const componentRows = (row.componentChanges || []).map(componentText).join('');
                return `<details class="est-cu-assembly"><summary>Assembly definition changed <small>${number(row.componentChanges?.length, 0)} component changes</small></summary><div>${componentRows}</div></details>`;
            }
            return `<div class="est-cu-field"><span>${esc(fieldLabel(row.field))}</span><strong>${esc(valueText(row.field, row.previousValue))} <i class="fas fa-arrow-right" aria-hidden="true"></i> ${esc(valueText(row.field, row.currentValue))}</strong></div>`;
        }).join('');
    }

    function overrideHtml(change) {
        const rows = (change.changes || []).filter(row => row.hasOverride);
        if (!rows.length) return '';
        return `<div class="est-cu-override"><strong><i class="fas fa-shield-halved" aria-hidden="true"></i> Project override preserved</strong>${rows.map(row =>
            `<span>Catalog ${esc(valueText(row.field, row.previousValue))} → ${esc(valueText(row.field, row.currentValue))} · Project override ${esc(valueText(row.field, row.overrideValue))} · Effective ${esc(valueText(row.field, row.effectiveValueAfterIfUpdated))}</span>`).join('')}</div>`;
    }

    function rowHtml(change, preview, items, impacts) {
        const id = String(change.catalogItemId ?? '');
        const item = items.get(id) || {};
        const impact = impacts.get(id) || {};
        const disabled = !selectable(change);
        const type = String(item.catalogSnapshot?.type || item.itemType || impact.after?.itemType || 'PART').toUpperCase();
        const category = item.catalogSnapshot?.category?.name || item.costCategory || 'Uncategorized';
        const status = String(change.status || '');
        const warning = status === 'MISSING_IN_CATALOG'
            ? '<strong>No longer available in Cost Catalog</strong><span>This item will remain unchanged in the estimate.</span>'
            : status === 'LEGACY_NO_SNAPSHOT'
                ? '<strong>Legacy item</strong><span>No historical catalog snapshot is available. This item cannot be refreshed automatically.</span>'
                : status === 'ERROR' ? '<strong>Needs review</strong><span>This item cannot be refreshed automatically.</span>' : '';
        const checked = state.selected.has(id);
        const impactAmount = Number(impact.difference || 0);
        return `<article class="est-cu-item ${disabled ? 'disabled' : ''}" data-catalog-update-item="${esc(id)}">
            <label class="est-cu-check"><input type="checkbox" data-cu-select="${esc(id)}" ${checked ? 'checked' : ''} ${disabled || busy() ? 'disabled' : ''}><span class="sr-only">Select ${esc(impact.name || item.name || `catalog item ${id}`)}</span></label>
            <div class="est-cu-item-main"><div class="est-cu-item-title"><div><strong>${esc(impact.name || item.name || `Catalog item ${id}`)}</strong><span><b>${esc(type)}</b> · ${esc(category)} · Revision ${esc(change.previousRevision ?? '—')} → ${esc(change.currentRevision ?? '—')}</span></div>${!disabled ? `<span class="est-cu-impact ${impactAmount > 0 ? 'increase' : impactAmount < 0 ? 'decrease' : ''}">Impact ${impactAmount > 0 ? '+' : ''}${money(impactAmount)}</span>` : ''}</div>
            ${warning ? `<div class="est-cu-inline-warning"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div>${warning}</div></div>` : changesHtml(change)}${overrideHtml(change)}
            ${(change.warnings || []).length ? `<div class="est-cu-row-warnings">${change.warnings.map(row => `<span>${esc(warningText(row))}</span>`).join('')}</div>` : ''}</div>
        </article>`;
    }

    function strategyHtml(prepared) {
        const strategy = prepared.strategy?.strategy;
        if (strategy === 'CREATE_REVISION') return `<section class="est-cu-strategy revision"><i class="fas fa-code-branch" aria-hidden="true"></i><div><strong>A new estimate revision will be created.</strong><span>Current revision ${number(prepared.currentEstimateRevision, 0)} · New revision ${number(prepared.projectedEstimateRevision, 0)}</span></div></section>`;
        return `<section class="est-cu-strategy"><i class="fas fa-pen-to-square" aria-hidden="true"></i><div><strong>This estimate will be updated.</strong><span>The selected Cost Catalog changes will be applied to the current estimate.</span></div></section>`;
    }

    function previewBody(prepared) {
        const preview = prepared.preview;
        const changes = (preview.changeSet?.itemChanges || []).filter(change => change.status !== 'CURRENT');
        const items = itemIndex(preview);
        const impacts = impactIndex(preview);
        const selectableRows = changes.filter(selectable);
        const allSelected = selectableRows.length > 0 && selectableRows.every(row => state.selected.has(String(row.catalogItemId)));
        return `<div class="est-cu-body ${state.phase === 'refreshing' ? 'is-refreshing' : ''}">
            <div class="est-cu-stats">${countPills(preview)}</div>
            ${totals(preview)}
            ${strategyHtml(prepared)}
            <div class="est-cu-list-head"><div><strong>Catalog changes</strong><span>${number(state.selected.size, 0)} selected</span></div><label><input type="checkbox" data-cu-select-all ${allSelected ? 'checked' : ''} ${busy() || !selectableRows.length ? 'disabled' : ''}> Select all</label></div>
            <div class="est-cu-list" role="list">${changes.map(change => rowHtml(change, preview, items, impacts)).join('') || '<div class="est-cu-empty-list">No item changes require review.</div>'}</div>
            ${(preview.warnings || []).length ? `<section class="est-cu-warnings" aria-label="Update warnings"><strong><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Review notes</strong>${preview.warnings.map(row => `<p>${esc(warningText(row))}</p>`).join('')}</section>` : ''}
            ${state.phase === 'refreshing' ? '<div class="est-cu-refreshing" role="status"><span class="est-cu-spinner"></span> Recalculating selected changes…</div>' : ''}
        </div>`;
    }

    function compactState(icon, title, description, action = '') {
        return `<div class="est-cu-compact"><i class="fas ${icon}" aria-hidden="true"></i><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
    }

    function modalHtml() {
        if (state.phase === 'checking') return compactState('fa-spinner fa-spin', 'Checking Cost Catalog…', 'Comparing this estimate with the latest catalog information.');
        if (state.phase === 'up-to-date') return compactState('fa-circle-check', 'Your estimate is up to date with the Cost Catalog.', 'No catalog-linked items require an update.');
        if (state.phase === 'success') {
            const revision = state.prepared?.appliedResult?.strategy === 'CREATE_REVISION';
            return compactState('fa-circle-check', revision ? 'Estimate revision created successfully.' : 'Estimate updated successfully.', revision ? 'The new revision is selected and ready to review.' : 'Totals and catalog snapshots have been refreshed.');
        }
        if (state.phase === 'stale') return compactState('fa-rotate', state.errorMessage, 'Generate a fresh preview before applying any changes.', '<button type="button" class="est-btn est-btn-primary" data-cu-refresh>Refresh Preview</button>');
        if (state.phase === 'error') return compactState('fa-circle-exclamation', state.errorMessage, 'Your estimate data was not modified by this screen.', '<button type="button" class="est-btn" data-cu-refresh>Try Again</button>');
        return state.prepared ? previewBody(state.prepared) : '';
    }

    function footerHtml() {
        if (['checking', 'up-to-date', 'success', 'stale', 'error'].includes(state.phase)) {
            return `<button type="button" class="est-btn" data-cu-close ${state.phase === 'checking' ? 'disabled' : ''}>Close</button>`;
        }
        const createRevision = state.prepared?.strategy?.strategy === 'CREATE_REVISION';
        const label = state.phase === 'applying'
            ? (createRevision ? 'Creating updated revision…' : 'Updating estimate…')
            : (createRevision ? 'Create Updated Revision' : 'Update Estimate');
        return `<button type="button" class="est-btn" data-cu-close ${busy() ? 'disabled' : ''}>Cancel</button><button type="button" class="est-btn est-btn-primary" data-cu-apply ${busy() || !state.selected.size ? 'disabled' : ''}>${state.phase === 'applying' ? '<span class="est-cu-spinner"></span>' : ''}${label}</button>`;
    }

    function render() {
        document.querySelector('[data-catalog-update-portal]')?.remove();
        if (!state.open) return;
        const portal = document.createElement('div');
        portal.dataset.catalogUpdatePortal = '';
        portal.className = 'est-modal-backdrop est-cu-backdrop';
        portal.innerHTML = `<section class="est-cu-dialog" role="dialog" aria-modal="true" aria-labelledby="catalogUpdateTitle" aria-describedby="catalogUpdateDescription" aria-busy="${busy()}">
            <header><div><h2 id="catalogUpdateTitle">Update from Cost Catalog</h2><p id="catalogUpdateDescription">Review changes before updating this estimate.</p></div><button type="button" class="est-cu-close" data-cu-close aria-label="Close Cost Catalog update" ${state.phase === 'applying' ? 'disabled' : ''}><i class="fas fa-xmark" aria-hidden="true"></i></button></header>
            <main>${modalHtml()}</main><footer>${footerHtml()}</footer>
            <div class="sr-only" aria-live="polite" aria-atomic="true">${esc(state.phase === 'refreshing' ? 'Recalculating preview' : state.phase === 'applying' ? 'Applying update' : state.phase)}</div>
        </section>`;
        document.body.appendChild(portal);
        const restoreTarget = state.restoreSelector ? portal.querySelector(state.restoreSelector) : null;
        state.restoreSelector = null;
        if (restoreTarget && !restoreTarget.disabled) restoreTarget.focus();
        else if (state.phase !== 'refreshing') portal.querySelector('button:not([disabled]), input:not([disabled])')?.focus();
    }

    function focusable(dialog) {
        return [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
            .filter(element => element.offsetParent !== null || element === document.activeElement);
    }

    document.addEventListener('click', event => {
        const trigger = event.target.closest('[data-est-action="catalog-update"]');
        if (trigger) { event.preventDefault(); checkCatalog(); return; }
        const portal = event.target.closest('[data-catalog-update-portal]');
        if (!portal) return;
        if (event.target === portal || event.target.closest('[data-cu-close]')) { close(); return; }
        if (event.target.closest('[data-cu-refresh]')) { close(); checkCatalog(); return; }
        if (event.target.closest('[data-cu-apply]')) applyUpdate();
    });

    document.addEventListener('change', event => {
        if (!event.target.closest('[data-catalog-update-portal]') || busy()) return;
        if (event.target.matches('[data-cu-select]')) {
            const id = String(event.target.dataset.cuSelect);
            event.target.checked ? state.selected.add(id) : state.selected.delete(id);
            state.restoreSelector = `[data-cu-select="${global.CSS?.escape ? global.CSS.escape(id) : id.replace(/["\\]/g, '\\$&')}"]`;
            scheduleSelectionPreview();
        }
        if (event.target.matches('[data-cu-select-all]')) {
            state.selected.clear();
            if (event.target.checked) applicableChanges(currentPreview()).forEach(change => state.selected.add(String(change.catalogItemId)));
            state.restoreSelector = '[data-cu-select-all]';
            scheduleSelectionPreview();
        }
    });

    document.addEventListener('keydown', event => {
        if (!state.open) return;
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key !== 'Tab') return;
        const dialog = document.querySelector('[data-catalog-update-portal] [role="dialog"]');
        const controls = dialog ? focusable(dialog) : [];
        if (!controls.length) return;
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    global.CatalogUpdateUI = { checkCatalog, close, getState: () => ({
        open: state.open, phase: state.phase, selectedCatalogItemIds: [...state.selected]
    }) };
})(typeof window !== 'undefined' ? window : globalThis);
