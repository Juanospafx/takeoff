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
        restoreSelector: null,
        searchQuery: '',
        activeFilter: 'all'
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
        state.searchQuery = '';
        state.activeFilter = 'all';
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
        state.searchQuery = '';
        state.activeFilter = 'all';
        document.body.classList.remove('has-est-cu-open');
        document.documentElement.classList.remove('has-est-cu-open');
        document.querySelector('[data-catalog-update-portal]')?.remove();
        updateTriggerState();
        if (state.returnFocus?.isConnected) state.returnFocus.focus();
    }

    function countPills(preview) {
        const changeSet = preview.changeSet || {};
        const entries = [
            ['Items checked', changeSet.linkedItems, 'fa-list-check', ''],
            ['Items changed', (changeSet.outdatedItems || 0) + (changeSet.unversionedItems || 0), 'fa-pen-to-square', 'highlight'],
            ['Pricing changes', changeSet.changesByType?.pricing, 'fa-tag', ''],
            ['Labor changes', changeSet.changesByType?.labor, 'fa-user-clock', ''],
            ['Equipment changes', changeSet.changesByType?.equipment, 'fa-truck-front', ''],
            ['Assembly changes', changeSet.changesByType?.assemblies, 'fa-cubes', ''],
            ['Missing in catalog', changeSet.missingItems, 'fa-triangle-exclamation', 'warning'],
            ['Legacy items', changeSet.legacyItems, 'fa-clock-rotate-left', 'warning']
        ];
        return entries.filter(([, value], index) => index === 0 || Number(value) > 0).map(([label, value, icon, tone]) =>
            `<div class="est-cu-stat ${tone || ''}">
                <i class="fas ${icon}" aria-hidden="true"></i>
                <div class="est-cu-stat-info">
                    <strong>${number(value, 0)}</strong>
                    <span>${esc(label)}</span>
                </div>
            </div>`).join('');
    }

    function totals(preview) {
        const difference = preview.difference || {};
        const amount = Number(difference.amount || 0);
        const percent = difference.percent;
        const sign = amount > 0 ? '+' : '';
        const trendIcon = amount > 0 ? 'fa-arrow-trend-up' : amount < 0 ? 'fa-arrow-trend-down' : 'fa-equals';
        const toneClass = amount > 0 ? 'increase' : amount < 0 ? 'decrease' : 'neutral';

        return `<section class="est-cu-totals" aria-label="Estimate total comparison">
            <div class="est-cu-total-card">
                <span class="est-cu-total-label"><i class="fas fa-file-invoice-dollar" aria-hidden="true"></i> Current Estimate</span>
                <strong class="est-cu-total-value">${money(preview.current?.total)}</strong>
                <span class="est-cu-total-sub">Active estimate total</span>
            </div>
            <div class="est-cu-total-card">
                <span class="est-cu-total-label"><i class="fas fa-chart-line" aria-hidden="true"></i> Projected Estimate</span>
                <strong class="est-cu-total-value">${money(preview.projected?.total)}</strong>
                <span class="est-cu-total-sub">With selected catalog updates</span>
            </div>
            <div class="est-cu-total-card est-cu-total-diff ${toneClass}">
                <span class="est-cu-total-label"><i class="fas fa-scale-balanced" aria-hidden="true"></i> Net Cost Difference</span>
                <strong class="est-cu-total-value">${sign}${money(amount)}</strong>
                <div class="est-cu-total-diff-pill">
                    <i class="fas ${trendIcon}" aria-hidden="true"></i>
                    <span>${present(percent) ? `${amount > 0 ? '+' : ''}${number(percent, 2)}%` : 'New total'}</span>
                </div>
            </div>
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
        })[field] || 'Catalog Information';
    }

    function componentText(componentChange) {
        const component = componentChange.currentValue || componentChange.previousValue || {};
        const identity = component.name || component.catalogItemName || component.catalogItemId || componentChange.componentKey;
        if (componentChange.change === 'ADDED') return `<span class="est-cu-comp-item added"><i class="fas fa-plus-circle" aria-hidden="true"></i> Added component: <b>${esc(identity)}</b></span>`;
        if (componentChange.change === 'REMOVED') return `<span class="est-cu-comp-item removed"><i class="fas fa-minus-circle" aria-hidden="true"></i> Removed component: <b>${esc(identity)}</b></span>`;
        const label = ({ quantity: 'Quantity', ratioType: 'Ratio', spacing: 'Spacing', waste: 'Waste' })[componentChange.field]
            || 'Component definition';
        return `<span class="est-cu-comp-item modified"><i class="fas fa-arrow-right" aria-hidden="true"></i> ${esc(label)}: <s>${esc(valueText(componentChange.field, componentChange.previousValue))}</s> <i class="fas fa-arrow-right"></i> <b>${esc(valueText(componentChange.field, componentChange.currentValue))}</b></span>`;
    }

    function changesHtml(change) {
        return (change.changes || []).map(row => {
            if (row.field === 'assemblyComponents') {
                const componentRows = (row.componentChanges || []).map(componentText).join('');
                return `<details class="est-cu-assembly">
                    <summary>
                        <div class="est-cu-asm-summary-left">
                            <i class="fas fa-cubes" aria-hidden="true"></i>
                            <span>Assembly Recipe Updated</span>
                        </div>
                        <span class="est-cu-asm-badge">${number(row.componentChanges?.length, 0)} component changes</span>
                    </summary>
                    <div class="est-cu-asm-details">${componentRows}</div>
                </details>`;
            }
            return `<div class="est-cu-field">
                <span class="est-cu-field-name">${esc(fieldLabel(row.field))}</span>
                <div class="est-cu-field-diff">
                    <span class="est-cu-diff-old">${esc(valueText(row.field, row.previousValue))}</span>
                    <i class="fas fa-arrow-right-long" aria-hidden="true"></i>
                    <span class="est-cu-diff-new">${esc(valueText(row.field, row.currentValue))}</span>
                </div>
            </div>`;
        }).join('');
    }

    function overrideHtml(change) {
        const rows = (change.changes || []).filter(row => row.hasOverride);
        if (!rows.length) return '';
        return `<div class="est-cu-override">
            <div class="est-cu-override-head">
                <i class="fas fa-shield-halved" aria-hidden="true"></i>
                <strong>Project Override Preserved</strong>
            </div>
            <p class="est-cu-override-desc">Your customized estimate values will be maintained. Catalog updates are referenced below:</p>
            <div class="est-cu-override-list">
                ${rows.map(row => `
                <div class="est-cu-override-row">
                    <span>${esc(fieldLabel(row.field))}: Catalog <s>${esc(valueText(row.field, row.previousValue))}</s> → ${esc(valueText(row.field, row.currentValue))}</span>
                    <b>Project Value: ${esc(valueText(row.field, row.overrideValue))} (Effective: ${esc(valueText(row.field, row.effectiveValueAfterIfUpdated))})</b>
                </div>`).join('')}
            </div>
        </div>`;
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
        const impactType = impactAmount > 0.001 ? 'increase' : impactAmount < -0.001 ? 'decrease' : 'neutral';
        const isAssembly = type === 'ASSEMBLY' || (change.changes || []).some(row => row.field === 'assemblyComponents');
        const hasOverride = (change.changes || []).some(row => row.hasOverride);
        const searchTerms = `${impact.name || item.name || id} ${category} ${type} ${id}`.toLowerCase();

        return `<article class="est-cu-item ${disabled ? 'disabled' : ''} ${checked ? 'is-selected' : ''}"
            data-catalog-update-item="${esc(id)}"
            data-impact-type="${impactType}"
            data-is-assembly="${isAssembly}"
            data-has-override="${hasOverride}"
            data-search-terms="${esc(searchTerms)}">
            <label class="est-cu-check">
                <input type="checkbox" data-cu-select="${esc(id)}" ${checked ? 'checked' : ''} ${disabled || busy() ? 'disabled' : ''}>
                <span class="sr-only">Select ${esc(impact.name || item.name || `catalog item ${id}`)}</span>
            </label>
            <div class="est-cu-item-main">
                <div class="est-cu-item-title">
                    <div class="est-cu-item-ident">
                        <strong class="est-cu-item-name">${esc(impact.name || item.name || `Catalog item ${id}`)}</strong>
                        <div class="est-cu-item-meta">
                            <span class="est-cu-pill-type type-${type.toLowerCase()}">${esc(type)}</span>
                            <span class="est-cu-meta-cat"><i class="fas fa-folder" aria-hidden="true"></i> ${esc(category)}</span>
                            <span class="est-cu-meta-rev"><i class="fas fa-clock-rotate-left" aria-hidden="true"></i> Rev ${esc(change.previousRevision ?? '—')} → ${esc(change.currentRevision ?? '—')}</span>
                        </div>
                    </div>
                    ${!disabled ? `
                    <div class="est-cu-impact-wrap">
                        <span class="est-cu-impact ${impactType}">
                            <i class="fas ${impactAmount > 0 ? 'fa-arrow-trend-up' : impactAmount < 0 ? 'fa-arrow-trend-down' : 'fa-equals'}" aria-hidden="true"></i>
                            ${impactAmount > 0 ? '+' : ''}${money(impactAmount)}
                        </span>
                    </div>` : ''}
                </div>
                ${warning ? `<div class="est-cu-inline-warning"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div>${warning}</div></div>` : changesHtml(change)}
                ${overrideHtml(change)}
                ${(change.warnings || []).length ? `<div class="est-cu-row-warnings">${change.warnings.map(row => `<span><i class="fas fa-circle-exclamation" aria-hidden="true"></i> ${esc(warningText(row))}</span>`).join('')}</div>` : ''}
            </div>
        </article>`;
    }

    function strategyHtml(prepared) {
        const strategy = prepared.strategy?.strategy;
        if (strategy === 'CREATE_REVISION') {
            return `<section class="est-cu-strategy revision">
                <div class="est-cu-strategy-icon"><i class="fas fa-code-branch" aria-hidden="true"></i></div>
                <div class="est-cu-strategy-content">
                    <strong>Safe Update: A new estimate revision will be created</strong>
                    <span>Current revision ${number(prepared.currentEstimateRevision, 0)} will remain preserved in audit history. Changes will be saved to Revision ${number(prepared.projectedEstimateRevision, 0)}.</span>
                </div>
            </section>`;
        }
        return `<section class="est-cu-strategy">
            <div class="est-cu-strategy-icon"><i class="fas fa-pen-to-square" aria-hidden="true"></i></div>
            <div class="est-cu-strategy-content">
                <strong>Direct Update to Active Draft</strong>
                <span>The selected Cost Catalog changes will be applied directly to the active estimate draft.</span>
            </div>
        </section>`;
    }

    function previewBody(prepared) {
        const preview = prepared.preview;
        const changes = (preview.changeSet?.itemChanges || []).filter(change => change.status !== 'CURRENT');
        const items = itemIndex(preview);
        const impacts = impactIndex(preview);
        const selectableRows = changes.filter(selectable);
        const allSelected = selectableRows.length > 0 && selectableRows.every(row => state.selected.has(String(row.catalogItemId)));

        let increaseCount = 0;
        let decreaseCount = 0;
        let assemblyCount = 0;
        let overrideCount = 0;

        changes.forEach(change => {
            const id = String(change.catalogItemId ?? '');
            const item = items.get(id) || {};
            const impact = impacts.get(id) || {};
            const type = String(item.catalogSnapshot?.type || item.itemType || impact.after?.itemType || 'PART').toUpperCase();
            const impactAmount = Number(impact.difference || 0);
            const isAssembly = type === 'ASSEMBLY' || (change.changes || []).some(row => row.field === 'assemblyComponents');
            const hasOverride = (change.changes || []).some(row => row.hasOverride);

            if (impactAmount > 0.001) increaseCount++;
            else if (impactAmount < -0.001) decreaseCount++;
            if (isAssembly) assemblyCount++;
            if (hasOverride) overrideCount++;
        });

        return `<div class="est-cu-body ${state.phase === 'refreshing' ? 'is-refreshing' : ''}">
            <div class="est-cu-stats">${countPills(preview)}</div>
            ${totals(preview)}
            ${strategyHtml(prepared)}

            <div class="est-cu-toolbar">
                <div class="est-cu-search-box">
                    <i class="fas fa-magnifying-glass est-cu-search-icon" aria-hidden="true"></i>
                    <input type="search" class="est-cu-search-input" data-cu-search placeholder="Search changes by item name, category, or type..." value="${esc(state.searchQuery)}">
                    <button type="button" class="est-cu-search-clear" data-cu-clear-search aria-label="Clear search" ${state.searchQuery ? '' : 'style="display:none;"'}>
                        <i class="fas fa-circle-xmark" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="est-cu-filter-chips" role="tablist" aria-label="Filter changes">
                    <button type="button" class="est-cu-filter-chip ${state.activeFilter === 'all' ? 'is-active' : ''}" data-cu-filter="all">
                        <span>All Changes</span>
                        <span class="est-cu-chip-count">${number(changes.length, 0)}</span>
                    </button>
                    ${increaseCount > 0 ? `
                    <button type="button" class="est-cu-filter-chip est-cu-chip-increase ${state.activeFilter === 'increase' ? 'is-active' : ''}" data-cu-filter="increase">
                        <i class="fas fa-arrow-trend-up" aria-hidden="true"></i>
                        <span>Price Increases</span>
                        <span class="est-cu-chip-count">${number(increaseCount, 0)}</span>
                    </button>` : ''}
                    ${decreaseCount > 0 ? `
                    <button type="button" class="est-cu-filter-chip est-cu-chip-decrease ${state.activeFilter === 'decrease' ? 'is-active' : ''}" data-cu-filter="decrease">
                        <i class="fas fa-arrow-trend-down" aria-hidden="true"></i>
                        <span>Price Decreases</span>
                        <span class="est-cu-chip-count">${number(decreaseCount, 0)}</span>
                    </button>` : ''}
                    ${assemblyCount > 0 ? `
                    <button type="button" class="est-cu-filter-chip ${state.activeFilter === 'assemblies' ? 'is-active' : ''}" data-cu-filter="assemblies">
                        <i class="fas fa-cubes" aria-hidden="true"></i>
                        <span>Assemblies</span>
                        <span class="est-cu-chip-count">${number(assemblyCount, 0)}</span>
                    </button>` : ''}
                    ${overrideCount > 0 ? `
                    <button type="button" class="est-cu-filter-chip est-cu-chip-override ${state.activeFilter === 'overrides' ? 'is-active' : ''}" data-cu-filter="overrides">
                        <i class="fas fa-shield-halved" aria-hidden="true"></i>
                        <span>With Overrides</span>
                        <span class="est-cu-chip-count">${number(overrideCount, 0)}</span>
                    </button>` : ''}
                </div>
            </div>

            <div class="est-cu-list-head">
                <div class="est-cu-list-head-info">
                    <strong>Item Changes</strong>
                    <span class="est-cu-list-count">Showing <b>${number(changes.length, 0)}</b> of <b>${number(changes.length, 0)}</b> changes · <b>${number(state.selected.size, 0)}</b> selected</span>
                </div>
                <div class="est-cu-list-head-actions">
                    <button type="button" class="est-cu-link-btn" data-cu-toggle-filtered title="Toggle selection of visible items">
                        <i class="fas fa-check-double" aria-hidden="true"></i> <span>Toggle Visible</span>
                    </button>
                    <label class="est-cu-select-all-label">
                        <input type="checkbox" data-cu-select-all ${allSelected ? 'checked' : ''} ${busy() || !selectableRows.length ? 'disabled' : ''}>
                        <span>Select All (${number(selectableRows.length, 0)})</span>
                    </label>
                </div>
            </div>

            <div class="est-cu-list" role="list">
                ${changes.map(change => rowHtml(change, preview, items, impacts)).join('') || '<div class="est-cu-empty-list"><i class="fas fa-circle-check"></i><p>No item changes require review.</p></div>'}
                <div class="est-cu-empty-search" style="display:none;">
                    <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                    <h4>No matching changes</h4>
                    <p>Try adjusting your search query or filter selection.</p>
                    <button type="button" class="est-btn est-btn-sm" data-cu-clear-search>Clear Search</button>
                </div>
            </div>

            ${(preview.warnings || []).length ? `<section class="est-cu-warnings" aria-label="Update warnings">
                <strong><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Review Notes</strong>
                ${preview.warnings.map(row => `<p>${esc(warningText(row))}</p>`).join('')}
            </section>` : ''}

            ${state.phase === 'refreshing' ? '<div class="est-cu-refreshing" role="status"><span class="est-cu-spinner"></span> Recalculating selected changes…</div>' : ''}
        </div>`;
    }

    function compactState(icon, title, description, action = '') {
        return `<div class="est-cu-compact">
            <div class="est-cu-compact-icon"><i class="fas ${icon}" aria-hidden="true"></i></div>
            <h3>${esc(title)}</h3>
            <p>${esc(description)}</p>
            ${action}
        </div>`;
    }

    function modalHtml() {
        if (state.phase === 'checking') return compactState('fa-spinner fa-spin', 'Checking Cost Catalog…', 'Comparing estimate items against latest catalog versions and specifications.');
        if (state.phase === 'up-to-date') return compactState('fa-circle-check', 'Your estimate is up to date with the Cost Catalog', 'All linked materials, labor rates, and assembly compositions match current catalog definitions.');
        if (state.phase === 'success') {
            const revision = state.prepared?.appliedResult?.strategy === 'CREATE_REVISION';
            return compactState('fa-circle-check', revision ? 'Estimate revision created successfully' : 'Estimate updated successfully', revision ? 'The new revision is ready and active for review.' : 'Estimate totals and catalog snapshots have been refreshed.');
        }
        if (state.phase === 'stale') return compactState('fa-rotate', state.errorMessage, 'Please generate a fresh preview before applying catalog changes.', '<button type="button" class="est-btn est-btn-primary" data-cu-refresh>Refresh Preview</button>');
        if (state.phase === 'error') return compactState('fa-circle-exclamation', state.errorMessage, 'Your estimate was not modified.', '<button type="button" class="est-btn" data-cu-refresh>Try Again</button>');
        return state.prepared ? previewBody(state.prepared) : '';
    }

    function footerHtml() {
        if (['checking', 'up-to-date', 'success', 'stale', 'error'].includes(state.phase)) {
            return `<div class="est-cu-footer-summary"></div><button type="button" class="est-btn" data-cu-close ${state.phase === 'checking' ? 'disabled' : ''}>Close</button>`;
        }
        const createRevision = state.prepared?.strategy?.strategy === 'CREATE_REVISION';
        const label = state.phase === 'applying'
            ? (createRevision ? 'Creating updated revision…' : 'Updating estimate…')
            : (createRevision ? 'Create Updated Revision' : 'Update Estimate');
        const count = state.selected.size;
        return `
            <div class="est-cu-footer-summary">
                <i class="fas fa-circle-check" aria-hidden="true"></i>
                <span><b>${number(count, 0)}</b> items selected for update</span>
            </div>
            <div class="est-cu-footer-actions">
                <button type="button" class="est-btn" data-cu-close ${busy() ? 'disabled' : ''}>Cancel</button>
                <button type="button" class="est-btn est-btn-primary" data-cu-apply ${busy() || !count ? 'disabled' : ''}>
                    ${state.phase === 'applying' ? '<span class="est-cu-spinner"></span> ' : (createRevision ? '<i class="fas fa-code-branch" aria-hidden="true"></i> ' : '<i class="fas fa-check" aria-hidden="true"></i> ')}${label}
                </button>
            </div>`;
    }

    function applyClientFilters(portal) {
        if (!portal) portal = document.querySelector('[data-catalog-update-portal]');
        if (!portal) return;

        const query = (state.searchQuery || '').trim().toLowerCase();
        const filter = state.activeFilter || 'all';
        const items = portal.querySelectorAll('.est-cu-item');
        let visibleCount = 0;
        let visibleSelectable = 0;
        let visibleSelected = 0;

        items.forEach(item => {
            const searchTerms = (item.dataset.searchTerms || item.textContent || '').toLowerCase();
            const matchesQuery = !query || searchTerms.includes(query);

            const isIncrease = item.dataset.impactType === 'increase';
            const isDecrease = item.dataset.impactType === 'decrease';
            const isAssembly = item.dataset.isAssembly === 'true';
            const hasOverride = item.dataset.hasOverride === 'true';

            let matchesFilter = true;
            if (filter === 'increase') matchesFilter = isIncrease;
            else if (filter === 'decrease') matchesFilter = isDecrease;
            else if (filter === 'assemblies') matchesFilter = isAssembly;
            else if (filter === 'overrides') matchesFilter = hasOverride;

            const visible = matchesQuery && matchesFilter;
            item.style.display = visible ? '' : 'none';

            if (visible) {
                visibleCount++;
                const cb = item.querySelector('[data-cu-select]');
                if (cb && !cb.disabled) {
                    visibleSelectable++;
                    if (cb.checked) visibleSelected++;
                }
            }
        });

        const countLabel = portal.querySelector('.est-cu-list-count');
        if (countLabel) {
            countLabel.innerHTML = `Showing <b>${number(visibleCount, 0)}</b> of <b>${number(items.length, 0)}</b> changes · <b>${number(state.selected.size, 0)}</b> selected`;
        }

        const emptyMsg = portal.querySelector('.est-cu-empty-search');
        if (emptyMsg) {
            emptyMsg.style.display = (visibleCount === 0 && items.length > 0) ? 'flex' : 'none';
        }

        const clearBtn = portal.querySelector('[data-cu-clear-search]');
        if (clearBtn) {
            clearBtn.style.display = query ? '' : 'none';
        }

        portal.querySelectorAll('[data-cu-filter]').forEach(chip => {
            chip.classList.toggle('is-active', chip.dataset.cuFilter === filter);
        });
    }

    function render() {
        document.querySelector('[data-catalog-update-portal]')?.remove();
        if (!state.open) {
            document.body.classList.remove('has-est-cu-open');
            document.documentElement.classList.remove('has-est-cu-open');
            return;
        }

        document.body.classList.add('has-est-cu-open');
        document.documentElement.classList.add('has-est-cu-open');

        const portal = document.createElement('div');
        portal.dataset.catalogUpdatePortal = '';
        portal.className = 'est-modal-backdrop est-cu-backdrop';

        const changesCount = (state.prepared?.preview?.changeSet?.outdatedItems || 0) + (state.prepared?.preview?.changeSet?.unversionedItems || 0);
        const isRevisionStrategy = state.prepared?.strategy?.strategy === 'CREATE_REVISION';

        portal.innerHTML = `<section class="est-cu-dialog" role="dialog" aria-modal="true" aria-labelledby="catalogUpdateTitle" aria-describedby="catalogUpdateDescription" aria-busy="${busy()}">
            <header class="est-cu-header">
                <div class="est-cu-header-left">
                    <div class="est-cu-header-icon">
                        <i class="fas fa-arrows-rotate" aria-hidden="true"></i>
                    </div>
                    <div class="est-cu-header-text">
                        <div class="est-cu-header-title-row">
                            <h2 id="catalogUpdateTitle">Update from Cost Catalog</h2>
                            ${changesCount > 0 ? `<span class="est-cu-badge est-cu-badge-primary"><i class="fas fa-layer-group" aria-hidden="true"></i> ${number(changesCount, 0)} Changes</span>` : ''}
                            ${isRevisionStrategy ? `<span class="est-cu-badge est-cu-badge-revision"><i class="fas fa-code-branch" aria-hidden="true"></i> Rev ${number(state.prepared.currentEstimateRevision, 0)} → Rev ${number(state.prepared.projectedEstimateRevision, 0)}</span>` : ''}
                        </div>
                        <p id="catalogUpdateDescription">Review item price, labor, and assembly changes before updating this estimate.</p>
                    </div>
                </div>
                <button type="button" class="est-cu-close" data-cu-close aria-label="Close Cost Catalog update" ${state.phase === 'applying' ? 'disabled' : ''}>
                    <i class="fas fa-xmark" aria-hidden="true"></i>
                </button>
            </header>
            <main>${modalHtml()}</main>
            <footer>${footerHtml()}</footer>
            <div class="sr-only" aria-live="polite" aria-atomic="true">${esc(state.phase === 'refreshing' ? 'Recalculating preview' : state.phase === 'applying' ? 'Applying update' : state.phase)}</div>
        </section>`;

        document.body.appendChild(portal);
        applyClientFilters(portal);

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
        if (event.target.closest('[data-cu-apply]')) { applyUpdate(); return; }

        const filterChip = event.target.closest('[data-cu-filter]');
        if (filterChip) {
            state.activeFilter = filterChip.dataset.cuFilter || 'all';
            applyClientFilters(portal);
            return;
        }

        if (event.target.closest('[data-cu-clear-search]')) {
            state.searchQuery = '';
            const searchInput = portal.querySelector('[data-cu-search]');
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
            }
            applyClientFilters(portal);
            return;
        }

        if (event.target.closest('[data-cu-toggle-filtered]')) {
            const visibleItems = [...portal.querySelectorAll('.est-cu-item')].filter(el => el.style.display !== 'none');
            const visibleCheckboxes = visibleItems.map(el => el.querySelector('[data-cu-select]')).filter(cb => cb && !cb.disabled);
            const allVisibleChecked = visibleCheckboxes.length > 0 && visibleCheckboxes.every(cb => cb.checked);

            visibleCheckboxes.forEach(cb => {
                const id = String(cb.dataset.cuSelect);
                if (allVisibleChecked) {
                    cb.checked = false;
                    state.selected.delete(id);
                } else {
                    cb.checked = true;
                    state.selected.add(id);
                }
            });
            scheduleSelectionPreview();
            return;
        }
    });

    document.addEventListener('input', event => {
        const searchInput = event.target.closest('[data-cu-search]');
        if (!searchInput) return;
        state.searchQuery = searchInput.value;
        const portal = searchInput.closest('[data-catalog-update-portal]');
        applyClientFilters(portal);
    });

    document.addEventListener('change', event => {
        const portal = event.target.closest('[data-catalog-update-portal]');
        if (!portal || busy()) return;

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

    global.CatalogUpdateUI = {
        checkCatalog,
        close,
        getState: () => ({
            open: state.open,
            phase: state.phase,
            selectedCatalogItemIds: [...state.selected]
        })
    };
})(typeof window !== 'undefined' ? window : globalThis);
