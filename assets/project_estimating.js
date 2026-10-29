(function () {
    'use strict';
    const root = document.getElementById('estimatingModule');
    if (!root) return;

    const Workspace = window.EstimatingWorkspaceService;
    const Calc = window.EstimateCalculationService;
    const Exporter = window.EstimatingExportService;
    const Footer = window.ProjectEstimateFooter;
    if (!Workspace || !Calc) {
        root.innerHTML = '<div class="est-fatal">Estimating could not start. Required services are unavailable.</div>';
        return;
    }

    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    const selectorValue = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const money = value => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const number = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
    const resolveProjectId = () => {
        const query = new URLSearchParams(window.location.search);
        return [root.dataset.projectId, window.ProjectState?.projectId, window.EstimateProjectId,
            query.get('project_id'), query.get('projectId'), query.get('id')]
            .map(Workspace.projectId).find(Boolean) || 0;
    };

    const projectId = resolveProjectId();
    const storageKey = `takeoff.estimating.module.${projectId || 'draft'}`;
    const apiUrl = '../api/project_estimating.php';
    const ui = { search: '', selected: new Set(), saving: false, saveRequested: false, saveTimer: null, pendingDeleteId: null, lastErrorCode: null, loadState: projectId ? 'loading' : 'local',
        message: projectId ? 'Loading estimate' : 'Local draft', collapsed: { notes: true, audit: true }, expandedAssemblies: new Set(), modal: null,
        notesLibraryModal: null, notesLibrarySearch: '', activeMarkupPopover: null, summaryColWidths: (()=>{ try { return JSON.parse(localStorage.getItem('takeoff.summaryColWidths')||'{}'); } catch(_){ return {}; } })(),
        catalogTargetGroupId: null, catalogData: null, catalogLoading: false, catalogError: '' };
    let state = readLocal();
    const dirtyEstimateIds = new Set(state.dirtyEstimateIds || []);
    const takeoffSyncDirtyIds = new Set(state.takeoffSyncDirtyIds || []);
    const conflictedEstimateIds = new Set();
    const conflictRemoteEstimates = new Map();
    const dirtyGenerations = new Map();
    const automaticRebaseKeys = new Set();
    const deletingEstimateIds = new Set();
    let dirtyGeneration = 0;
    const pendingTakeoffByEstimate = new Map();

    function restoreDirtyTracking() {
        dirtyEstimateIds.clear();
        dirtyGenerations.clear();
        (state.dirtyEstimateIds || []).forEach(id => {
            const normalized = String(id);
            if (!state.estimates.some(estimate => String(estimate.id) === normalized)) return;
            dirtyEstimateIds.add(normalized);
            dirtyGenerations.set(normalized, ++dirtyGeneration);
        });
    }

    root.classList.add('est-v2');
    if (!$('estTableHead')) {
        root.innerHTML = `<div class="est-main"><aside class="est-table-settings-drawer" id="estTableSettingsDrawer" aria-label="Table Settings" hidden></aside><section class="est-left"><div class="est-toolbar"><div class="bb-search-field-procore cc-search-procore est-search-box"><input id="estSearch" type="search" placeholder="Search estimate items..." autocomplete="off"></div><div class="est-toolbar-actions" style="display: flex; align-items: center; gap: 8px; margin-left: auto;"><button class="est-icon-btn" id="estBtnCreateGroup" type="button" data-est-action="create-group" title="Create Group"><i class="fas fa-folder-plus"></i></button><button class="est-icon-btn" id="estBtnTableSettings" type="button" data-est-action="table-settings" title="Table Settings"><i class="fas fa-sliders"></i></button><button class="est-icon-btn" id="estBtnFullscreen" type="button" data-est-action="fullscreen" title="Full screen"><i class="fas fa-expand"></i></button><div class="est-menu-wrap"><button class="est-icon-btn" id="estBtnMoreOptions" type="button" data-est-action="options" title="Options"><i class="fas fa-ellipsis-vertical"></i></button><div class="est-menu" id="optionsMenu"><button type="button" data-est-action="catalog-update"><i class="fas fa-arrows-rotate"></i> Update from Cost Catalog</button><button type="button" data-est-action="reset-quantities"><i class="fas fa-rotate-left"></i> Reset Quantities</button><button type="button" data-est-action="delete-selected" id="estBtnDeleteSelected" disabled><i class="fas fa-trash"></i> Delete Selected</button><div class="est-menu-divider" style="height: 1px; background: var(--border, #e2e8f0); margin: 4px 0;"></div><button type="button" data-est-option="save"><i class="fas fa-floppy-disk"></i> Save estimate</button><button type="button" data-est-option="copy"><i class="fas fa-copy"></i> Copy estimate</button><button type="button" data-est-option="status"><i class="fas fa-circle-check"></i> Change project status</button><button type="button" data-est-option="import"><i class="fas fa-file-import"></i> Import</button><button type="button" data-est-option="export"><i class="fas fa-file-export"></i> Export</button><button type="button" data-est-option="export-bom"><i class="fas fa-file-excel"></i> Export BOM (Excel)</button><button type="button" data-est-option="delete-estimate" class="danger"><i class="fas fa-trash"></i> Delete estimate</button></div></div><button class="est-icon-btn est-toggle-right-btn" id="estToolbarToggleRight" type="button" data-est-action="toggle-right" title="Hide summary panel"><i class="fas fa-chevron-right"></i></button></div></div><div class="est-table-wrap bb-table-scroll"><table class="est-table bb-table" id="estMainTable"><thead id="estTableHead"></thead><tbody id="estTableBody"></tbody></table></div></section><div class="pro-sidebar-resizer est-sidebar-resizer" id="estSplitResizer" role="separator" aria-orientation="vertical" title="Drag to resize panels"><div class="pro-resizer-handle"></div></div><aside class="est-right"><div class="est-right-scroll"></div><div class="est-total-box"><div id="estimateTotal" class="est-total-value"></div><div class="est-total-label">Estimate Total</div><div id="estimateSqft" class="est-total-sub"></div></div></aside></div><footer class="est-version-bar" id="versionBar"></footer>`;
    }

    function readLocal() {
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) {}
        return Workspace.workspace(raw || {}, projectId, window.ProjectState?.estimateItems || []);
    }

    function ensureDefaultMarkups(estimate) {
        if (!estimate) return estimate;
        if (!estimate.settings) estimate.settings = {};
        if (!estimate.settings._markupsSeeded) {
            if (!Array.isArray(estimate.settings.preTaxMarkups) || estimate.settings.preTaxMarkups.length === 0) {
                estimate.settings.preTaxMarkups = [
                    { id: Workspace.uid('m'), name: 'Overhead', type: 'percent', percent: 6, amount: 0, base: 'subtotal_sales', active: true },
                    { id: Workspace.uid('m'), name: 'Discount', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', active: true }
                ];
            }
            if (!Array.isArray(estimate.settings.postTaxMarkups) || estimate.settings.postTaxMarkups.length === 0) {
                estimate.settings.postTaxMarkups = [
                    { id: Workspace.uid('m'), name: 'Bonding', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', active: true },
                    { id: Workspace.uid('m'), name: 'Permit Impact Fee', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', active: true },
                    { id: Workspace.uid('m'), name: 'Low Voltage Box', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', active: true },
                    { id: Workspace.uid('m'), name: 'Discount', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', active: true }
                ];
            }
            estimate.settings._markupsSeeded = true;
        }
        return estimate;
    }

    function resolveSquareFootage() {
        const est = Workspace.active(state);
        const raw = est?.settings?.squareFootage
            || document.getElementById('poSquareFootage')?.value
            || window.ProjectState?.projectMeta?.square_footage
            || window.ProjectState?.projectInfo?.square_footage
            || '';
        const cleaned = String(raw).replace(/[^0-9.]/g, '');
        return parseFloat(cleaned) || 0;
    }

    function renderSqftDisplay(total) {
        const sqftElement = $('estimateSqft');
        if (!sqftElement) return;
        const sqft = resolveSquareFootage();
        const perSqft = sqft > 0 ? (Number(total?.estimateTotal || 0) / sqft) : 0;
        sqftElement.innerHTML = sqft > 0
            ? `<span class="est-sqft-trigger" data-edit-sqft title="Area: ${number(sqft, 0)} sq ft ? Click to change">${money(perSqft)}/sq ft <small style="opacity:0.7;">(${number(sqft, 0)} sq ft)</small></span>`
            : `<span class="est-sqft-trigger is-unset" data-edit-sqft title="Click to set project square footage">${money(0)}/sq ft <span class="est-sqft-set-badge">Set sq ft</span></span>`;
    }

    function current() { return ensureDefaultMarkups(Workspace.active(state)); }
    function summary() { return Calc.calculateSummary(current().groups, current().settings); }
    function allItems() { return current().groups.flatMap(group => group.items.map(item => ({ group, item }))); }
    function calculationErrors() {
        return allItems().flatMap(({ item }) => (Calc.calculateItem(item, current().settings).validation || [])
            .map(error => ({ ...error, itemId: item.id, itemName: item.name })));
    }
    function findItem(itemId) { return allItems().find(row => row.item.id === itemId) || null; }
    function isAssemblyItem(item) {
        if (!item) return false;
        return item.isAssembly === true
            || String(item.itemType ?? item.item_type ?? '').toLowerCase() === 'assembly'
            || String(item.catalogSnapshot?.type ?? item.catalogSnapshot?.item_type ?? '').toLowerCase() === 'assembly'
            || (Array.isArray(item.children) && item.children.length > 0)
            || ui.expandedAssemblies.has(String(item.id));
    }
    function duplicateAssembly(item) {
        const copyTree = (source, parentItemId = null) => {
            const copy = Workspace.item({ ...Workspace.clone(source), id: Workspace.uid('item'), parentItemId,
                takeoffLayerId: null, copiedFromTakeoffLayerId: source.takeoffLayerId || null,
                quantitySource: 'manual', quantitySyncStatus: 'manual' });
            if (source.catalogSnapshot) copy.catalogSnapshot = Workspace.clone(source.catalogSnapshot);
            if (source.catalogMetadata) copy.catalogMetadata = Workspace.clone(source.catalogMetadata);
            copy.children = (source.children || []).map(child => copyTree(child, copy.id));
            return copy;
        };
        const duplicate = copyTree(item);
        duplicate.name = `${item.name} Copy`;
        return duplicate;
    }
    function markEstimateDirty(estimateId = state.activeEstimateId) {
        const id = String(estimateId || '');
        if (!id) return;
        dirtyEstimateIds.add(id);
        dirtyGenerations.set(id, ++dirtyGeneration);
        state.dirtyEstimateIds = [...dirtyEstimateIds];
        state.takeoffSyncDirtyIds = [...takeoffSyncDirtyIds];
    }
    function saveLocal(options = {}) {
        state.groups = current().groups;
        state.dirtyEstimateIds = [...dirtyEstimateIds];
        state.takeoffSyncDirtyIds = [...takeoffSyncDirtyIds];
        state.clientUiUpdatedAt = Workspace.now();
        const stored = Workspace.clone(state);
        if (!stored.pendingProjectCreationSync) delete stored.pendingProjectCreationSync;
        localStorage.setItem(storageKey, JSON.stringify(stored));
        if (options.publish !== false) publish();
    }

    function applyDeletedEstimateTombstones(workspace, additionalIds = []) {
        const deletedIds = new Set([
            ...(state?.deletedEstimateIds || []),
            ...(workspace?.deletedEstimateIds || []),
            ...additionalIds
        ].map(String));
        workspace.deletedEstimateIds = [...deletedIds].sort();
        if (!deletedIds.size) return workspace;
        workspace.estimates = workspace.estimates.filter(estimate => !deletedIds.has(String(estimate.id)));
        if (!workspace.estimates.length) return workspace;
        if (!workspace.estimates.some(estimate => String(estimate.id) === String(workspace.activeEstimateId))) {
            workspace.activeEstimateId = workspace.estimates[0].id;
        }
        Workspace.selectEstimate(workspace, workspace.activeEstimateId);
        return workspace;
    }

    function publish() {
        const total = summary();
        window.dispatchEvent(new CustomEvent('takeoff:estimating-state-updated', { detail: {
            projectId: String(projectId), activeEstimateId: state.activeEstimateId,
            estimates: state.estimates.map(row => ({
                id: row.id,
                name: row.name,
                status: row.status,
                is_primary: Boolean(row.is_primary || row.isPrimary),
                isPrimary: Boolean(row.is_primary || row.isPrimary),
                groups: row.groups,
                settings: row.settings
            })),
            summary: { material: total.direct.materialSales, labor: total.direct.laborSales,
                equipment: total.direct.equipmentSales, preTaxMarkup: total.preTaxTotal,
                taxes: total.totalTax, total: total.estimateTotal, profit: total.profit }
        } }));
        window.dispatchEvent(new CustomEvent('takeoff:estimating-items-updated', { detail: {
            version: 1, origin: 'estimating', projectId: String(projectId),
            activeEstimateId: String(state.activeEstimateId), revision: Number(current().revision || 0),
            groups: Workspace.clone(current().groups)
        } }));
        window.dispatchEvent(new CustomEvent('takeoff:estimate-summary-updated', { detail: total }));
    }

    function changed(action) {
        const activeId = String(state.activeEstimateId || '');
        if (action === 'Synchronized items from Takeoff') takeoffSyncDirtyIds.add(activeId);
        else takeoffSyncDirtyIds.delete(activeId);
        conflictedEstimateIds.delete(activeId);
        conflictRemoteEstimates.delete(activeId);
        Workspace.touch(state, action);
        saveLocal();
        scheduleSave(action === 'Synchronized items from Takeoff' ? 'takeoff' : 'manual');
        render();
    }

    function reactiveChanged(target) {
        takeoffSyncDirtyIds.delete(String(state.activeEstimateId || ''));
        conflictedEstimateIds.delete(String(state.activeEstimateId || ''));
        conflictRemoteEstimates.delete(String(state.activeEstimateId || ''));
        Workspace.touch(state);
        // Persist locally without broadcasting an incomplete field value or
        // rebuilding the editor on every keystroke.
        saveLocal({ publish: false });
        scheduleSave();
        renderLiveSummary();
    }

    function activeEditingElement() {
        const active = document.activeElement;
        if (!active) return null;
        if (root.contains(active) && active.matches('input, textarea, select, [contenteditable="true"]')) return active;
        if (active.closest?.('[role="dialog"]')) return active;
        return null;
    }

    function renderLiveSummary() {
        const total = summary();
        const totalElement = $('estimateTotal');
        if (totalElement) totalElement.textContent = money(total.estimateTotal);
        renderSqftDisplay(total);
        const aside = root.querySelector('.est-right-scroll');
        if (aside) {
            const byCat = total?.byCategory || {};
            const direct = total?.direct || {};
            const setLive = (key, val) => {
                const el = aside.querySelector(`[data-live-summary="${key}"]`);
                if (el) el.textContent = val;
            };
            const settings = current()?.settings || {};
            const gCost = Number(settings.globalLaborCost ?? 36);
            const gMargin = Number(settings.globalLaborMargin ?? 34.6);
            const gSales = gMargin < 100 ? (gCost / (1 - gMargin / 100)) : gCost;
            const salesInput = aside.querySelector('[data-summary-rate="globalLaborSales"]');
            if (salesInput && document.activeElement !== salesInput) {
                salesInput.value = gSales.toFixed(2);
                salesInput.dataset.auditPrevValue = salesInput.value;
            }
            const laborMarginInput = aside.querySelector('[data-summary-type="Labor"][data-field="margin"]');
            if (laborMarginInput && document.activeElement !== laborMarginInput) {
                laborMarginInput.value = gMargin.toFixed(1);
                laborMarginInput.dataset.auditPrevValue = laborMarginInput.value;
            }
            setLive('labor-hrs', `${number(byCat.Labor?.adjustedLaborHours || 0, 2)} hrs`);
            setLive('labor-cost', money(byCat.Labor?.totalCost || 0));
            setLive('labor-sales', money(byCat.Labor?.totalSales || 0));
            setLive('labor-profit', money(byCat.Labor?.profit || 0));
            setLive('mat-cost', money(byCat.Materials?.totalCost || 0));
            setLive('mat-sales', money(byCat.Materials?.totalSales || 0));
            setLive('mat-profit', money(byCat.Materials?.profit || 0));
            setLive('eq-cost', money(byCat.Equipment?.totalCost || 0));
            setLive('eq-sales', money(byCat.Equipment?.totalSales || 0));
            setLive('eq-profit', money(byCat.Equipment?.profit || 0));
            setLive('direct-cost', money(direct.totalCost || 0));
            setLive('direct-margin', direct.marginPercent ? direct.marginPercent.toFixed(2) : '0.00');
            setLive('direct-sales', money(direct.totalSales || 0));
            setLive('direct-profit', money(direct.profit || 0));
            (total.preTaxMarkups || []).forEach(m => setLive(`markup-${m.id}`, money(m.value || 0)));
            setLive('preTaxTotal', money(total.preTaxTotal || 0));
            ['Labor', 'Materials', 'Equipment'].forEach(t => setLive(`tax-${t}`, money(total.taxes?.[t] || 0)));
            setLive('totalTax', money(total.totalTax || 0));
            (total.postTaxMarkups || []).forEach(m => setLive(`markup-${m.id}`, money(m.value || 0)));
            setLive('postTaxTotal', money(total.postTaxTotal || 0));
        }
        const tableBody = $('estTableBody');
        if (tableBody && Array.isArray(total?.rows)) {
            const totalSummaryCost = total?.direct?.totalCost || 0;
            const calcById = new Map(total.rows.map(r => [String(r.item.id), r.calc]));
            total.rows.forEach(({ item: rowItem, calc: rowCalc }) => {
                const tr = tableBody.querySelector(`tr[data-item-id="${selectorValue(rowItem.id)}"]`);
                if (!tr) return;
                const setCell = (colKey, textVal, colorVal = '') => {
                    const cell = tr.querySelector(`[data-live-item-cell="${colKey}"]`);
                    if (cell) {
                        cell.textContent = textVal;
                        if (colorVal) cell.style.color = colorVal;
                    }
                };
                setCell('subtotal_item_cost', number(rowCalc.materialCost || 0, 2));
                setCell('unit_sales', number(rowCalc.unitMaterialSales || 0, 2));
                setCell('subtotal_item_sales', number(rowCalc.materialSales || 0, 2));
                const profitVal = rowCalc.profit || 0;
                setCell('profit', number(profitVal, 2), profitVal >= 0 ? '#10b981' : '#ef4444');
                setCell('total_labor_hrs', number(rowCalc.adjustedLaborHours || 0, 2));
                setCell('total_labor_cost', number(rowCalc.laborCost || 0, 2));
                setCell('total_cost', number(rowCalc.totalCost || 0, 2));
                const pct = totalSummaryCost > 0 ? ((rowCalc.totalCost || 0) / totalSummaryCost) * 100 : 0;
                setCell('total_cost_percent', `${number(pct, 1)}%`);
                setCell('total_sales', number(rowCalc.totalSales || 0, 2));
            });
            (current()?.groups || []).forEach(grp => {
                const subCell = tableBody.querySelector(`[data-live-group-subtotal="${selectorValue(grp.id)}"]`);
                if (!subCell) return;
                const grpSum = (grp.items || []).reduce((acc, it) => {
                    if (it.parentItemId || it.parent_item_id || it.assemblyParentId) return acc;
                    const c = calcById.get(String(it.id)) || Calc.calculateItem(it, current().settings);
                    return acc + (c.materialCost || 0);
                }, 0);
                subCell.textContent = number(grpSum, 2);
            });
        }
        const cur = current();
        if (cur) {
            cur.estimateTotal = total.estimateTotal;
            cur.totalSales = total.estimateTotal;
            cur.grand_total = total.estimateTotal;
            cur.total_amount = total.estimateTotal;
        }
        if (cur && window.ProjectState) {
            if (!window.ProjectState.projectMeta) window.ProjectState.projectMeta = {};
            const metaPrimaryId = String(window.ProjectState.projectMeta.primary_estimate_id || '');
            const isCurPrimary = metaPrimaryId ? String(cur.id) === metaPrimaryId : Boolean(cur.is_primary || cur.isPrimary);
            if (isCurPrimary) {
                window.ProjectState.projectMeta.primary_estimate_id = cur.id;
                window.ProjectState.projectMeta.primary_estimate_total = total.estimateTotal;
                window.ProjectState.projectMeta.primary_quote_value = total.estimateTotal;
                window.ProjectState.projectMeta.total_sales = total.estimateTotal;
                window.ProjectState.projectMeta.estimate_total = total.estimateTotal;
            }
        }
        renderFooter();
        renderStatus();
    }

    function renderAfterAsyncSave() {
        if (activeEditingElement()) {
            renderLiveSummary();
            return;
        }
        render();
    }

    function renderPreservingInput(target) {
        const rowId = target.closest('[data-item-id]')?.dataset.itemId;
        const identity = rowId && target.dataset.itemField
            ? { rowId, key: 'itemField', value: target.dataset.itemField }
            : ['setting', 'tax', 'markupValue'].map(key => target.dataset[key] !== undefined
                ? { key, value: target.dataset[key] } : null).find(Boolean);
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const rawValue = target.value;
        renderTable();
        renderDetails();
        renderFooter();
        renderStatus();
        if (!identity) return;
        const scope = identity.rowId
            ? root.querySelector(`[data-item-id="${selectorValue(identity.rowId)}"]`)
            : root;
        const replacement = scope?.querySelector(`[data-${identity.key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}="${selectorValue(identity.value)}"]`);
        if (replacement && rawValue !== undefined) replacement.value = rawValue;
        replacement?.focus();
        if (replacement?.setSelectionRange && replacement.type !== 'number' && start !== null && end !== null) {
            replacement.setSelectionRange(start, end);
        }
    }

    function scheduleSave(source = 'manual') {
        if (!projectId) return;
        const activeId = String(state.activeEstimateId || '');
        if (source === 'takeoff') takeoffSyncDirtyIds.add(activeId);
        else takeoffSyncDirtyIds.delete(activeId);
        conflictedEstimateIds.delete(activeId);
        markEstimateDirty();
        ui.saveRequested = true;
        clearTimeout(ui.saveTimer);
        ui.loadState = 'pending';
        ui.message = 'Unsaved changes';
        ui.saveTimer = setTimeout(saveServer, 500);
    }

    async function request(action, options = {}) {
        const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}&project_id=${projectId}`, options);
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
            const error = new Error(result?.error?.message || result?.message || `HTTP ${response.status}`);
            error.code = result?.error?.code || result?.code || (response.status === 409 ? 'revision_conflict' : 'request_failed');
            error.status = response.status;
            error.payload = result;
            throw error;
        }
        return result;
    }

    async function saveServer() {
        if (!projectId) return;
        if (ui.saving) {
            ui.saveRequested = true;
            return;
        }
        if (calculationErrors().length) {
            ui.loadState = 'error';
            ui.message = 'Cannot save: every margin must be below 100%.';
            renderStatus();
            return;
        }
        const sentIds = [...dirtyEstimateIds].filter(id => !conflictedEstimateIds.has(id)
            && state.estimates.some(estimate => String(estimate.id) === id));
        if (!sentIds.length) {
            if (conflictedEstimateIds.size) {
                ui.saveRequested = false;
                ui.loadState = 'error';
                ui.message = 'This estimate has concurrent manual changes. Your local draft is preserved; review the latest version before saving.';
                renderStatus();
                return;
            }
            ui.saveRequested = false;
            ui.loadState = 'saved';
            ui.message = 'Saved';
            renderStatus();
            return;
        }
        ui.saving = true;
        ui.lastErrorCode = null;
        ui.saveRequested = false;
        ui.loadState = 'saving';
        ui.message = 'Savingâ€¦';
        renderStatus();
        const sentGenerations = new Map(sentIds.map(id => [id, dirtyGenerations.get(id) || 0]));
        const sent = {
            schemaVersion: state.schemaVersion,
            projectId: state.projectId,
            activeEstimateId: state.activeEstimateId,
            clientUiUpdatedAt: state.clientUiUpdatedAt,
            estimates: Workspace.clone(state.estimates.filter(estimate => sentIds.includes(String(estimate.id))))
        };
        try {
            const savePayload = estimates => ({ action: 'save', mode: 'patch', project_id: projectId,
                updates: estimates, state: { ...sent, estimates }, summary: summary() });
            let result;
            try {
                result = await request('save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(savePayload(sent.estimates)) });
            } catch (error) {
                if (error.status !== 404 || !['estimate_not_found', 'stale_estimate_id'].includes(error.code)) throw error;
                // Reconcile against the database before retrying. A 404 can mean
                // either a stale numeric hint or a browser-only draft. Blindly
                // retrying the same local identity caused repeated 404 requests.
                const remote = await request('list');
                const remoteRows = remote.state?.estimates || remote.estimates || [];
                const remoteByClientId = new Map(remoteRows.map(estimate => [String(estimate.id), estimate]));
                const recoverable = sent.estimates.map(estimate => {
                    const canonical = remoteByClientId.get(String(estimate.id));
                    return canonical
                        ? { ...estimate, dbEstimateId: canonical.dbEstimateId, revision: canonical.revision }
                        : { ...estimate, dbEstimateId: null };
                });
                const hasNewDraft = recoverable.some(estimate => !remoteByClientId.has(String(estimate.id)));
                result = await request(hasNewDraft ? 'create' : 'save', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(savePayload(recoverable))
                });
            }
            const acknowledgedRows = result.updates || result.state?.estimates || result.estimates || [];
            const acknowledgements = new Map(acknowledgedRows.map(estimate => [String(estimate.id), estimate]));
            sentIds.forEach(id => {
                const currentIndex = state.estimates.findIndex(estimate => String(estimate.id) === id);
                const ack = acknowledgements.get(id);
                if (currentIndex < 0 || !ack) return;
                if ((dirtyGenerations.get(id) || 0) === sentGenerations.get(id)) {
                    state.estimates[currentIndex] = Workspace.estimate(ack, projectId, currentIndex);
                    dirtyEstimateIds.delete(id);
                    dirtyGenerations.delete(id);
                    takeoffSyncDirtyIds.delete(id);
                    conflictedEstimateIds.delete(id);
                    conflictRemoteEstimates.delete(id);
                    [...automaticRebaseKeys].filter(key => key.startsWith(`${id}:`)).forEach(key => automaticRebaseKeys.delete(key));
                } else {
                    state.estimates[currentIndex].dbEstimateId = ack.dbEstimateId;
                    state.estimates[currentIndex].revision = ack.revision;
                    ui.saveRequested = true;
                }
            });
            Workspace.selectEstimate(state, state.activeEstimateId);
            ui.loadState = dirtyEstimateIds.size ? 'pending' : 'saved';
            ui.message = dirtyEstimateIds.size ? 'Unsaved changes' : 'Saved';
            saveLocal({ publish: !activeEditingElement() });
        } catch (error) {
            ui.lastErrorCode = error.code || 'request_failed';
            ui.loadState = 'error';
            ui.message = error.code === 'revision_conflict'
                ? 'This estimate changed elsewhere. Your draft is saved locally; reload or retry after reviewing the latest version.'
                : `Save failed: ${error.message}`;
            if (error.code === 'revision_conflict') {
                const conflicts = error.payload?.error?.conflicts || [];
                let rebasedTakeoff = false;
                conflicts.forEach(conflict => {
                    const id = String(conflict.id || '');
                    const localIndex = state.estimates.findIndex(estimate => String(estimate.id) === id);
                    if (localIndex < 0 || !conflict.current) return;
                    const currentRevision = Number(conflict.currentRevision ?? conflict.current?.revision ?? 0);
                    const rebaseKey = `${id}:${currentRevision}`;
                    if (takeoffSyncDirtyIds.has(id) && !automaticRebaseKeys.has(rebaseKey)) {
                        automaticRebaseKeys.add(rebaseKey);
                        state.estimates[localIndex] = rebaseTakeoffChanges(state.estimates[localIndex], conflict.current, localIndex);
                        markEstimateDirty(id);
                        rebasedTakeoff = true;
                    } else {
                        if (conflict.current) {
                            state.estimates[localIndex].dbEstimateId = conflict.current.dbEstimateId ?? conflict.dbEstimateId ?? state.estimates[localIndex].dbEstimateId;
                            state.estimates[localIndex].revision = currentRevision;
                        }
                        conflictedEstimateIds.add(id);
                        conflictRemoteEstimates.set(id, Workspace.clone(conflict.current));
                    }
                });
                ui.saveRequested = rebasedTakeoff;
                if (rebasedTakeoff) {
                    ui.loadState = 'pending';
                    ui.message = 'Merged with the latest server revision; saving againâ€¦';
                }
            }
            if (error.code !== 'revision_conflict') ui.saveRequested = false;
            saveLocal({ publish: !activeEditingElement() });
        } finally {
            ui.saving = false;
            renderAfterAsyncSave();
            if (ui.pendingDeleteId && ui.loadState !== 'error') {
                const pendingDeleteId = ui.pendingDeleteId;
                ui.pendingDeleteId = null;
                clearTimeout(ui.saveTimer);
                ui.saveTimer = setTimeout(() => deleteEstimateAuthoritative(pendingDeleteId, true), 0);
            } else if (ui.pendingDeleteId) {
                ui.message = 'Delete paused because pending estimates could not be saved. Retry after resolving the save error.';
                renderStatus();
            } else if (ui.saveRequested) {
                clearTimeout(ui.saveTimer);
                ui.saveTimer = setTimeout(saveServer, 0);
            }
        }
    }

    async function loadServer() {
        if (!projectId) { render(); return; }
        const requestLocalTimestamp = state.clientUiUpdatedAt;
        const forceMigratedLocal = state.pendingProjectCreationSync === true;
        try {
            const result = await request('list');
            const remoteSource = result.state || {};
            const remote = applyDeletedEstimateTombstones(Workspace.workspace(remoteSource, projectId));
            const local = state;
            const changedDuringLoad = local.clientUiUpdatedAt !== requestLocalTimestamp;
            // A newer local timestamp alone does not prove there are unsaved edits:
            // localStorage can retain a successfully saved snapshot from an older
            // browser session while another client has advanced the DB revision.
            // Only explicit dirty tracking (or an edit made during this request)
            // is allowed to push local data back to the server on startup.
            const hasExplicitLocalChanges = dirtyEstimateIds.size > 0;
            if (forceMigratedLocal || hasExplicitLocalChanges) {
                delete state.pendingProjectCreationSync;
                if (forceMigratedLocal) {
                    state.estimates.forEach(estimate => markEstimateDirty(estimate.id));
                }
                const remoteById = new Map(remote.estimates.map(estimate => [String(estimate.id), estimate]));
                state.estimates = state.estimates.map((localEstimate, index) => {
                    const id = String(localEstimate.id);
                    const remoteEstimate = remoteById.get(id);
                    if (!dirtyEstimateIds.has(id) || !remoteEstimate) return localEstimate;
                    if (Number(localEstimate.revision) === Number(remoteEstimate.revision)) return localEstimate;
                    if (takeoffSyncDirtyIds.has(id)) return rebaseTakeoffChanges(localEstimate, remoteEstimate, index);
                    conflictedEstimateIds.add(id);
                    conflictRemoteEstimates.set(id, Workspace.clone(remoteEstimate));
                    return localEstimate;
                });
                saveLocal();
                await saveServer();
                render();
                drainPendingTakeoff();
                return;
            }
            if (changedDuringLoad) {
                // A real edit/new estimate completed while GET was in flight.
                // Its save lifecycle owns the newer local state; never replace it
                // with the now-stale GET snapshot.
                ui.loadState = 'saved';
                ui.message = 'Loaded; local changes preserved';
                saveLocal();
            } else if (Array.isArray(remoteSource.estimates) && remoteSource.estimates.length) {
                state = remote;
                restoreDirtyTracking();
            }
            ui.loadState = 'saved';
            ui.message = 'Loaded from server';
            saveLocal();
        } catch (error) {
            ui.loadState = 'error';
            ui.message = `Offline: ${error.message}`;
        }
        render();
        drainPendingTakeoff();
    }

    function groupsContentSignature(groups) {
        return JSON.stringify(groups, (key, value) => key === 'updatedAt' ? undefined : value);
    }

    function rebaseTakeoffChanges(localEstimate, remoteEstimate, index = 0) {
        const remote = Workspace.estimate(remoteEstimate, projectId, index);
        const takeoffGroups = (localEstimate.groups || []).map((group, groupIndex) => ({
            id: group.takeoffGroupId || group.id || `takeoff_group_${groupIndex}`,
            name: group.name || 'Default Group',
            expanded: group.expanded !== false,
            layers: (group.items || []).filter(item => item.takeoffLayerId).map(item => ({
                ...Workspace.clone(item), id: item.takeoffLayerId
            }))
        })).filter(group => group.layers.length || String(group.id).startsWith('takeoff_'));
        if (window.TakeoffEstimatingSyncService?.reconcile) {
            remote.groups = window.TakeoffEstimatingSyncService.reconcile(remote.groups, takeoffGroups).map(Workspace.group);
        }
        remote.updatedAt = Workspace.now();
        remote.auditLog.push({ id: Workspace.uid('audit'), at: remote.updatedAt,
            action: 'Merged Takeoff changes with concurrent server changes' });
        remote.auditLog = remote.auditLog.slice(-100);
        return remote;
    }

    function reconcileExistingTakeoffBindings(existingGroups, incomingGroups, importNewLayers = false) {
        if (importNewLayers && window.TakeoffEstimatingSyncService?.reconcileLinkedOnly) {
            return window.TakeoffEstimatingSyncService.reconcileLinkedOnly(existingGroups, incomingGroups)
                .map(Workspace.group);
        }
        const incomingByLayer = new Map();
        (incomingGroups || []).forEach(group => (group.items || group.layers || []).forEach(item => {
            const layerId = String(item.takeoffLayerId ?? item.id ?? '');
            if (layerId) incomingByLayer.set(layerId, { item, group });
        }));
        return (existingGroups || []).map((group, groupIndex) => Workspace.group({
            ...Workspace.clone(group),
            items: (group.items || []).flatMap(existing => {
                if (!existing.takeoffLayerId) return [existing];
                const incoming = incomingByLayer.get(String(existing.takeoffLayerId));
                if (!incoming) return [];
                if (window.TakeoffEstimatingSyncService?.takeoffItem) {
                    return [window.TakeoffEstimatingSyncService.takeoffItem({
                        ...incoming.item, id: existing.takeoffLayerId
                    }, incoming.group, existing)];
                }
                const isOverridden = Boolean(existing.quantityOverride || existing.quantitySyncStatus === 'overridden');
                return [{
                    ...existing,
                    quantity: isOverridden ? existing.quantity : incoming.item.quantity,
                    originalQuantity: incoming.item.quantity,
                    lastSyncedTakeoffQuantity: incoming.item.quantity,
                    pendingTakeoffQuantity: isOverridden ? incoming.item.quantity : null,
                    quantityOverride: isOverridden,
                    quantitySyncStatus: isOverridden ? 'overridden' : 'synced'
                }];
            })
        }, groupIndex));
    }

    function preserveQuantityOverrides(existingGroups, nextGroups) {
        const overriddenByKey = new Map();
        (existingGroups || []).forEach(grp => {
            (grp.items || []).forEach(it => {
                if (it.quantityOverride === true || String(it.quantitySyncStatus || '') === 'overridden') {
                    if (it.id) overriddenByKey.set(`id:${it.id}`, it);
                    if (it.takeoffLayerId) overriddenByKey.set(`layer:${it.takeoffLayerId}`, it);
                }
            });
        });
        if (!overriddenByKey.size) return nextGroups;
        return (nextGroups || []).map(grp => ({
            ...grp,
            items: (grp.items || []).map(it => {
                const match = (it.takeoffLayerId && overriddenByKey.get(`layer:${it.takeoffLayerId}`))
                    || (it.id && overriddenByKey.get(`id:${it.id}`));
                if (!match) return it;
                const measured = Workspace.numeric(it.lastSyncedTakeoffQuantity ?? it.originalQuantity ?? it.quantity);
                return {
                    ...it,
                    quantity: Workspace.numeric(match.quantity),
                    originalQuantity: measured,
                    lastSyncedTakeoffQuantity: measured,
                    pendingTakeoffQuantity: measured,
                    quantityOverride: true,
                    quantitySyncStatus: 'overridden'
                };
            })
        }));
    }

    function drainPendingTakeoff() {
        const queued = [...pendingTakeoffByEstimate.entries()];
        pendingTakeoffByEstimate.clear();
        queued.forEach(([estimateId, pending]) => reconcileGroups(estimateId,
            pending?.groups || pending || [], pending?.options || {}));
    }

    function reconcileGroups(estimateId, groups, options = {}) {
        if (!Array.isArray(groups)) return;
        // The iframe commonly publishes its initial snapshot while the current
        // estimate revision is still loading. Apply that snapshot only after the
        // server state is authoritative, otherwise it dirties a stale revision.
        if (ui.loadState === 'loading') {
            pendingTakeoffByEstimate.set(String(estimateId || ''), {
                groups: Workspace.clone(groups), options: { ...options }
            });
            return;
        }
        const activeId = String(estimateId || '');
        const estimateIndex = state.estimates.findIndex(row => String(row.id) === activeId);
        if (estimateIndex < 0) return;
        if (conflictedEstimateIds.has(activeId) && conflictRemoteEstimates.has(activeId)) {
            const index = state.estimates.findIndex(estimate => String(estimate.id) === activeId);
            state.estimates[index] = rebaseTakeoffChanges(state.estimates[index], conflictRemoteEstimates.get(activeId), index);
            conflictedEstimateIds.delete(activeId);
            conflictRemoteEstimates.delete(activeId);
            takeoffSyncDirtyIds.add(activeId);
        }
        const currentEstimate = state.estimates[estimateIndex];
        let reconciled;
        if (currentEstimate.takeoffSyncMode === 'linked-only') {
            reconciled = reconcileExistingTakeoffBindings(currentEstimate.groups, groups,
                options.importNewLayers === true);
        } else if (groups.some(group => Array.isArray(group.items))) {
            reconciled = groups.map(Workspace.group);
        } else if (window.TakeoffEstimatingSyncService?.reconcile) {
            reconciled = window.TakeoffEstimatingSyncService.reconcile(currentEstimate.groups,
                groups).map(Workspace.group);
        } else {
            reconciled = groups.map(Workspace.group);
        }
        reconciled = preserveQuantityOverrides(currentEstimate.groups, reconciled);
        if (groupsContentSignature(currentEstimate.groups) === groupsContentSignature(reconciled)) return;
        currentEstimate.groups = reconciled;
        currentEstimate.updatedAt = Workspace.now();
        currentEstimate.auditLog.push({ id: Workspace.uid('audit'), at: currentEstimate.updatedAt,
            action: 'Synchronized items from Takeoff' });
        currentEstimate.auditLog = currentEstimate.auditLog.slice(-100);
        takeoffSyncDirtyIds.add(activeId);
        markEstimateDirty(activeId);
        saveLocal();
        scheduleSave('takeoff');
        render();
    }

    function render() {
        renderTable();
        renderDetails();
        renderFooter();
        renderStatus();
        renderModal();
    }

    const ALL_CONFIG_COLUMNS = [
        { id: 'budget_code', label: 'Budget Code', align: 'left', minWidth: '120px' },
        { id: 'quantity', label: 'Quantity', align: 'right', minWidth: '95px' },
        { id: 'unit_cost', label: 'Unit Cost ($)', align: 'right', minWidth: '105px' },
        { id: 'waste', label: 'Waste (%)', align: 'right', minWidth: '90px' },
        { id: 'subtotal_item_cost', label: 'Subtotal Item Cost ($)', align: 'right', minWidth: '135px' },
        { id: 'margin', label: 'Margin (%)', align: 'right', minWidth: '95px' },
        { id: 'unit_sales', label: 'Unit Sales ($)', align: 'right', minWidth: '105px' },
        { id: 'subtotal_item_sales', label: 'Subtotal Item Sales ($)', align: 'right', minWidth: '135px' },
        { id: 'profit', label: 'Profit ($)', align: 'right', minWidth: '105px' },
        { id: 'unit_labor', label: 'Unit Labor (hrs)', align: 'right', minWidth: '115px' },
        { id: 'difficulty_factor', label: 'Difficulty Factor', align: 'right', minWidth: '115px' },
        { id: 'total_labor_hrs', label: 'Total Labor (hrs)', align: 'right', minWidth: '115px' },
        { id: 'total_labor_cost', label: 'Total Labor Cost ($)', align: 'right', minWidth: '135px' },
        { id: 'total_cost', label: 'Total Cost ($)', align: 'right', minWidth: '115px' },
        { id: 'total_cost_percent', label: 'Total Cost (%)', align: 'right', minWidth: '105px' },
        { id: 'total_sales', label: 'Total Sales ($)', align: 'right', minWidth: '115px' },
        { id: 'notes', label: 'Notes', align: 'left', minWidth: '150px' },
        { id: 'tax', label: 'Tax', align: 'center', minWidth: '70px' }
    ];

    const DEFAULT_VISIBLE_COLUMNS = [
        'budget_code',
        'quantity',
        'unit_cost',
        'waste',
        'subtotal_item_cost',
        'margin',
        'unit_sales',
        'subtotal_item_sales',
        'profit'
    ];

    const COLUMNS_STORAGE_KEY = `takeoff.estimating.columns.${projectId || 'default'}`;
    const COLUMNS_ORDER_STORAGE_KEY = `takeoff.estimating.columns_order.${projectId || 'default'}`;
    const COLUMNS_WIDTHS_STORAGE_KEY = `takeoff.estimating.columns_widths.${projectId || 'default'}`;

    function getColumnWidths() {
        try {
            const raw = localStorage.getItem(COLUMNS_WIDTHS_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        } catch (_) {}
        return {
            cost_item: 320,
            budget_code: 120,
            quantity: 105,
            unit_cost: 110,
            waste: 90,
            subtotal_item_cost: 135,
            margin: 95,
            unit_sales: 110,
            subtotal_item_sales: 135,
            profit: 105,
            unit_labor: 115,
            difficulty_factor: 115,
            total_labor_hrs: 115,
            total_labor_cost: 135,
            total_cost: 115,
            total_cost_percent: 105,
            total_sales: 115,
            notes: 150,
            tax: 70
        };
    }

    function saveColumnWidth(colId, widthPx) {
        const widths = getColumnWidths();
        widths[colId] = Math.max(60, Math.round(widthPx));
        try {
            localStorage.setItem(COLUMNS_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
        } catch (_) {}
    }

    function getVisibleColumns() {
        try {
            const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const validIds = new Set(ALL_CONFIG_COLUMNS.map(c => c.id));
                    const filtered = parsed.filter(id => validIds.has(id));
                    if (filtered.length > 0) return new Set(filtered);
                }
            }
        } catch (_) {}
        return new Set(DEFAULT_VISIBLE_COLUMNS);
    }

    function saveVisibleColumns(colSet, applyAll = false) {
        const list = Array.from(colSet);
        try {
            localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(list));
            if (applyAll) {
                localStorage.setItem('takeoff.estimating.columns.default', JSON.stringify(list));
            }
        } catch (_) {}
    }

    function getOrderedActiveColumns() {
        const visibleCols = getVisibleColumns();
        let order = [];
        try {
            const stored = localStorage.getItem(COLUMNS_ORDER_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) order = parsed;
            }
        } catch (_) {}

        const colMap = new Map(ALL_CONFIG_COLUMNS.map(c => [c.id, c]));
        const ordered = [];
        const seen = new Set();
        order.forEach(id => {
            if (visibleCols.has(id) && colMap.has(id)) {
                ordered.push(colMap.get(id));
                seen.add(id);
            }
        });
        ALL_CONFIG_COLUMNS.forEach(col => {
            if (visibleCols.has(col.id) && !seen.has(col.id)) {
                ordered.push(col);
            }
        });
        return ordered;
    }

    function saveColumnsOrder(orderedIds) {
        try {
            localStorage.setItem(COLUMNS_ORDER_STORAGE_KEY, JSON.stringify(orderedIds));
        } catch (_) {}
    }

    function findTakeoffLayer(item) {
        if (!item) return null;
        const layerId = item.takeoffLayerId || item.layerId || item.id;

        // 1. Check window.getTakeoffLayerById
        if (typeof window.getTakeoffLayerById === 'function') {
            const l = window.getTakeoffLayerById(layerId);
            if (l) return l;
        }
        // 2. Check window.takeoffState.groups
        if (window.takeoffState?.groups) {
            for (const g of window.takeoffState.groups) {
                const l = (g.layers || []).find(x => String(x.id) === String(layerId) || (x.name && x.name === item.name));
                if (l) return l;
            }
        }
        // 3. Check window.getTakeoffLayerByName
        if (typeof window.getTakeoffLayerByName === 'function') {
            const l = window.getTakeoffLayerByName(item.name);
            if (l) return l;
        }
        // 4. Check localStorage
        try {
            const pId = String(projectId || window.ProjectState?.projectId || 0);
            const raw = localStorage.getItem('takeoff_project_groups_' + pId);
            if (raw) {
                const groups = JSON.parse(raw);
                for (const g of groups) {
                    const l = (g.layers || []).find(x => String(x.id) === String(layerId) || (x.name && x.name === item.name));
                    if (l) return l;
                }
            }
        } catch (_) {}
        // 5. Check window.ProjectState.takeoffLayers
        if (Array.isArray(window.ProjectState?.takeoffLayers)) {
            const l = window.ProjectState.takeoffLayers.find(x => String(x.id) === String(layerId) || (x.name && x.name === item.name));
            if (l) return l;
        }
        return null;
    }

    function getItemLayerColor(item) {
        const layer = findTakeoffLayer(item);
        if (layer?.color) return layer.color;
        if (item.color) return item.color;
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1'];
        let hash = 0;
        const str = String(item.name || 'item');
        for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    }

    function getItemLayerShapeSvg(item, size = 14) {
        const layer = findTakeoffLayer(item);
        const color = layer?.color || item.color || getItemLayerColor(item);
        const rawType = String(layer?.type || layer?.takeoff_type || item.type || item.measurementType || 'Count');
        const symbol = String(layer?.symbol || item.symbol || '').toLowerCase();

        // Exact parity with Takeoff sidebar getLayerBadgeSvg
        const isCount = rawType === 'Count' || rawType === 'count' || rawType === 'Count by distance' || Boolean(layer?.symbol && !rawType.startsWith('Linear') && !rawType.includes('Area'));

        if (!isCount) {
            if (rawType.startsWith('Linear') || rawType === 'linear') {
                return `<span class="est-item-shape-wrap" title="Linear"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none">
                    <line x1="3" y1="12" x2="21" y2="12" stroke="${esc(color)}" stroke-width="3.5" stroke-linecap="round"/>
                    <circle cx="5" cy="12" r="2.5" fill="${esc(color)}"/>
                    <circle cx="19" cy="12" r="2.5" fill="${esc(color)}"/>
                </svg></span>`;
            }
            return `<span class="est-item-shape-wrap" title="Area"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none">
                <polygon points="4 5, 20 5, 20 19, 4 19" stroke="${esc(color)}" stroke-width="2.2" stroke-linejoin="round" fill="${esc(color)}" fill-opacity="0.35"/>
            </svg></span>`;
        }

        if (symbol.includes('check')) {
            return `<span class="est-item-shape-wrap" title="Checkmark"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${esc(color)}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
            </svg></span>`;
        }
        if (symbol.includes('square')) {
            return `<span class="est-item-shape-wrap" title="Square"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                <rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/>
            </svg></span>`;
        }
        if (symbol.includes('triangle')) {
            return `<span class="est-item-shape-wrap" title="Triangle"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                <polygon points="12 2.5 22 21.5 2 21.5"/>
            </svg></span>`;
        }
        if (symbol.includes('octagon')) {
            return `<span class="est-item-shape-wrap" title="Octagon"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"/>
            </svg></span>`;
        }
        if (symbol.includes('cross') || symbol.includes('plus')) {
            return `<span class="est-item-shape-wrap" title="Cross"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                <path d="M19 10.5h-5.5V5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v5.5H5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5h5.5V19c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-5.5H19c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5z"/>
            </svg></span>`;
        }
        if (symbol.includes('pentagon')) {
            return `<span class="est-item-shape-wrap" title="Pentagon"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                <polygon points="12 2 22 9.5 18.2 21.5 5.8 21.5 2 9.5"/>
            </svg></span>`;
        }
        if (symbol.includes('target') || symbol.includes('concentric')) {
            return `<span class="est-item-shape-wrap" title="Target"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${esc(color)}" stroke-width="2.5">
                <circle cx="12" cy="12" r="9"/>
                <circle cx="12" cy="12" r="4.5" fill="${esc(color)}"/>
            </svg></span>`;
        }
        if (symbol.includes('hollow')) {
            return `<span class="est-item-shape-wrap" title="Hollow Circle"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${esc(color)}" stroke-width="3">
                <circle cx="12" cy="12" r="8"/>
            </svg></span>`;
        }
        if (symbol.includes('diamond')) {
            return `<span class="est-item-shape-wrap" title="Diamond"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                <polygon points="12 2 22 12 12 22 2 12"/>
            </svg></span>`;
        }
        if (symbol.includes('dimension')) {
            return `<span class="est-item-shape-wrap" title="Dimension"><svg viewBox="0 0 28 20" width="${Math.round(size * 1.15)}" height="${Math.round(size * 0.85)}" fill="none" stroke="${esc(color)}" stroke-width="2">
                <text x="14" y="8" text-anchor="middle" font-size="9" font-family="sans-serif" font-weight="bold" fill="${esc(color)}" stroke="none">x</text>
                <line x1="3" y1="11" x2="3" y2="18"/>
                <line x1="25" y1="11" x2="25" y2="18"/>
                <line x1="3" y1="15" x2="25" y2="15"/>
            </svg></span>`;
        }
        return `<span class="est-item-shape-wrap" title="Solid Circle"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
            <circle cx="12" cy="12" r="8.5"/>
        </svg></span>`;
    }

    function getItemChildren(item) {
        if (!item) return [];
        if (Array.isArray(item.children) && item.children.length > 0) return item.children;
        if (Array.isArray(item.assemblyItems) && item.assemblyItems.length > 0) return item.assemblyItems;
        const id = String(item.id || '');
        const flat = allItems().map(r => r.item).filter(other => {
            const pId = String(other.parentItemId ?? other.parent_item_id ?? other.assemblyParentId ?? '');
            return Boolean(pId && pId === id);
        });
        if (flat.length > 0) return flat;
        return [];
    }

    async function hydrateAssemblyPartsFromCatalog(item, catalogId) {
        if (!item) return;
        if (getItemChildren(item).length > 0) return;
        try {
            // First try CatalogService snapshot
            if (window.CatalogService?.getSnapshot) {
                const snapshot = await window.CatalogService.getSnapshot({ enabledForProjectsOnly: false });
                const items = snapshot?.items || [];
                const catItem = items.find(it => (catalogId && String(it.id) === String(catalogId)) || (it.name && it.name.trim().toLowerCase() === String(item.name || '').trim().toLowerCase()));
                if (catItem && Array.isArray(catItem.assemblyComponents) && catItem.assemblyComponents.length > 0) {
                    const itemsById = new Map(items.map(it => [String(it.id), it]));
                    item.children = catItem.assemblyComponents.map(comp => {
                        const partDto = itemsById.get(String(comp.catalogItemId));
                        const snap = comp.pricingSnapshot || {};
                        return {
                            id: Workspace.uid('item'),
                            catalogItemId: comp.catalogItemId,
                            name: partDto?.name || comp.name || 'Assembly part',
                            description: partDto?.description || comp.description || '',
                            quantity: Number(comp.quantity || 1),
                            uom: partDto?.uom || comp.uom || 'ea',
                            unitCost: Number(partDto?.pricing?.materialUnitCost ?? snap.materialUnitCost ?? 0),
                            unitMaterialCost: Number(partDto?.pricing?.materialUnitCost ?? snap.materialUnitCost ?? 0),
                            waste: Number(comp.waste || 0),
                            unitLabor: Number(partDto?.pricing?.laborHoursPerUnit ?? snap.laborHoursPerUnit ?? 0),
                            laborRate: Number(partDto?.pricing?.laborRate ?? snap.laborRate ?? 0)
                        };
                    });
                    saveLocal({ publish: false });
                    return;
                }
            }

            // Fallback: direct fetch from api/cost_catalog.php?action=snapshot
            const res = await fetch('../api/cost_catalog.php?action=snapshot');
            const data = await res.json();
            if (data?.status === 'success') {
                const assemblyParts = Array.isArray(data.data?.assemblyParts) ? data.data.assemblyParts : [];
                const catalogItems = Array.isArray(data.data?.items) ? data.data.items : [];
                let resolvedCatId = catalogId;
                if (!resolvedCatId && item.name) {
                    const matchedItem = catalogItems.find(ci => ci.name && ci.name.trim().toLowerCase() === String(item.name).trim().toLowerCase());
                    if (matchedItem) resolvedCatId = matchedItem.id;
                }
                const matchingParts = assemblyParts.filter(p => String(p.assembly_catalog_item_id) === String(resolvedCatId));
                if (matchingParts.length > 0) {
                    item.children = matchingParts.map(p => ({
                        id: Workspace.uid('item'),
                        catalogItemId: p.part_catalog_item_id,
                        name: p.child_item_name || 'Assembly part',
                        description: p.child_description || '',
                        quantity: Number(p.quantity || 1),
                        uom: p.child_unit_of_measure || 'ea',
                        unitCost: Number(p.child_unit_cost || p.unit_cost_snapshot || 0),
                        unitMaterialCost: Number(p.child_unit_cost || p.unit_cost_snapshot || 0),
                        waste: Number(p.waste_percent || 0),
                        unitLabor: Number(p.child_labor_hours || p.labor_hours_snapshot || 0)
                    }));
                    saveLocal({ publish: false });
                }
            }
        } catch (err) {
            console.warn('Could not hydrate assembly components:', err);
        }
    }

    async function toggleAssemblyExpansion(itemId) {
        const id = String(itemId);
        if (ui.expandedAssemblies.has(id)) {
            ui.expandedAssemblies.delete(id);
            renderTable();
            return;
        }
        const found = findItem(id);
        const it = found?.item;
        if (it && getItemChildren(it).length === 0) {
            const catId = it.catalogItemId || it.catalog_item_id || it.catalogSnapshot?.id || it.catalog_id;
            await hydrateAssemblyPartsFromCatalog(it, catId);
        }
        ui.expandedAssemblies.add(id);
        renderTable();
    }

    function renderTableSettingsDrawer() {
        const drawer = $('estTableSettingsDrawer');
        if (!drawer) return;
        const visibleCols = getVisibleColumns();

        drawer.innerHTML = `
            <div class="est-drawer-header">
                <h3 class="est-drawer-title">Table Settings</h3>
                <button type="button" class="est-drawer-close" data-drawer-close aria-label="Close settings"><i class="fas fa-times"></i></button>
            </div>
            <div class="est-drawer-body">
                <div class="est-drawer-section-title">Configure Columns</div>
                <div class="est-columns-toggle-list">
                    ${ALL_CONFIG_COLUMNS.map(col => `
                        <div class="est-col-toggle-card">
                            <label class="est-switch">
                                <input type="checkbox" data-col-switch="${col.id}" ${visibleCols.has(col.id) ? 'checked' : ''}>
                                <span class="est-switch-slider"></span>
                            </label>
                            <span class="est-col-toggle-label">${esc(col.label)}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="est-apply-all-wrap">
                    <label class="est-apply-all-label">
                        <input type="checkbox" id="estApplyAllEstimates">
                        <span>Apply to all estimates in this project</span>
                    </label>
                </div>
            </div>
            <div class="est-drawer-footer">
                <button type="button" class="est-drawer-cancel-btn" data-drawer-cancel>Cancel</button>
                <button type="button" class="est-drawer-save-btn" data-drawer-save>Save Changes</button>
            </div>
        `;
    }

    function openTableSettings() {
        renderTableSettingsDrawer();
        const drawer = $('estTableSettingsDrawer');
        const main = root.querySelector('.est-main');
        if (drawer) drawer.removeAttribute('hidden');
        if (main) main.classList.add('has-table-settings-drawer');
    }

    function closeTableSettings() {
        const drawer = $('estTableSettingsDrawer');
        const main = root.querySelector('.est-main');
        if (drawer) drawer.setAttribute('hidden', '');
        if (main) main.classList.remove('has-table-settings-drawer');
    }

    function toggleTableSettings() {
        const drawer = $('estTableSettingsDrawer');
        if (drawer && drawer.hasAttribute('hidden')) {
            openTableSettings();
        } else {
            closeTableSettings();
        }
    }

    function closeOptionsMenu() {
        const menu = $('optionsMenu');
        if (menu) menu.classList.remove('open');
        const btn = $('estBtnMoreOptions') || root.querySelector('[data-est-action="options"]');
        if (btn) {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-expanded', 'false');
        }
    }

    function closeMarkupPopovers() {
        document.querySelectorAll('.est-markup-popover').forEach(el => el.remove());
        root.querySelectorAll('[data-markup-menu-btn]').forEach(btn => {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-expanded', 'false');
        });
    }

    function hideActionPopover() {
        const pop = $('estActionPopover');
        if (pop) {
            pop.hidden = true;
            pop.innerHTML = '';
            pop.dataset.activeTriggerKey = '';
        }
        root.querySelectorAll('[data-group-menu-btn], [data-item-menu-btn]').forEach(btn => {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-expanded', 'false');
        });
    }

    function showActionPopover(triggerBtn, htmlContent, triggerKey = '') {
        let pop = $('estActionPopover');
        if (!pop) {
            pop = document.createElement('div');
            pop.id = 'estActionPopover';
            pop.className = 'est-popover-menu';
            document.body.appendChild(pop);
        }
        if (!pop.hidden && triggerKey && pop.dataset.activeTriggerKey === triggerKey) {
            hideActionPopover();
            return;
        }
        hideActionPopover();
        closeMarkupPopovers();
        closeOptionsMenu();

        pop.dataset.activeTriggerKey = triggerKey;
        pop.innerHTML = htmlContent;
        pop.hidden = false;
        if (triggerBtn) {
            triggerBtn.classList.add('is-active');
            triggerBtn.setAttribute('aria-expanded', 'true');
        }

        const rect = triggerBtn.getBoundingClientRect();
        const popW = 220;
        let left = rect.right - popW;
        if (left < 10) left = 10;
        let top = rect.bottom + 4;
        const popH = pop.offsetHeight || 260;
        if (top + popH > window.innerHeight - 10) {
            top = Math.max(10, rect.top - popH - 4);
        }
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
    }

    function openGroupMenu(groupId, triggerBtn) {
        const html = `
            <button type="button" data-popover-group-action="create-item" data-group-id="${esc(groupId)}"><i class="fas fa-plus"></i> Create Item</button>
            <button type="button" data-popover-group-action="reset-quantity" data-group-id="${esc(groupId)}"><i class="fas fa-rotate-left"></i> Reset Quantity</button>
            <button type="button" data-popover-group-action="reset-budget-codes" data-group-id="${esc(groupId)}"><i class="fas fa-rotate-left"></i> Reset Budget Codes</button>
            <div class="est-popover-divider"></div>
            <button type="button" data-popover-group-action="rename-group" data-group-id="${esc(groupId)}"><i class="fas fa-pen"></i> Rename</button>
            <button type="button" data-popover-group-action="copy-group" data-group-id="${esc(groupId)}"><i class="fas fa-copy"></i> Copy</button>
            <button type="button" data-popover-group-action="copy-other-est" data-group-id="${esc(groupId)}"><i class="fas fa-file-export"></i> Copy to other estimate</button>
            <button type="button" data-popover-group-action="move-other-est" data-group-id="${esc(groupId)}"><i class="fas fa-arrow-right-arrow-left"></i> Move to other estimate</button>
            <button type="button" data-popover-group-action="copy-other-proj" data-group-id="${esc(groupId)}"><i class="fas fa-share-nodes"></i> Copy to another project</button>
            <button type="button" data-popover-group-action="move-items-to" data-group-id="${esc(groupId)}"><i class="fas fa-arrows-split-up-and-left"></i> Move Cost items To</button>
            <div class="est-popover-divider"></div>
            <div class="est-popover-heading">Bill Of Materials (BoM)</div>
            <button type="button" data-popover-group-action="export-bom" data-group-id="${esc(groupId)}"><i class="fas fa-file-excel"></i> Export Bill of Materials</button>
            <div class="est-popover-divider"></div>
            <button type="button" class="danger" data-popover-group-action="delete-group" data-group-id="${esc(groupId)}"><i class="fas fa-trash"></i> Delete</button>
        `;
        showActionPopover(triggerBtn, html, `group:${groupId}`);
    }

    function openItemMenu(itemId, triggerBtn) {
        const html = `
            <button type="button" data-popover-item-action="edit-item" data-item-id="${esc(itemId)}"><i class="fas fa-pen"></i> Edit Item</button>
            <button type="button" data-popover-item-action="replace-item" data-item-id="${esc(itemId)}"><i class="fas fa-arrows-rotate"></i> Replace Item</button>
            <button type="button" data-popover-item-action="copy-item" data-item-id="${esc(itemId)}"><i class="fas fa-copy"></i> Copy Item</button>
            <button type="button" data-popover-item-action="move-item" data-item-id="${esc(itemId)}"><i class="fas fa-folder-tree"></i> Move To</button>
            <button type="button" data-popover-item-action="reset-quantity" data-item-id="${esc(itemId)}"><i class="fas fa-rotate-left"></i> Reset Quantity</button>
            <button type="button" data-popover-item-action="reset-budget-code" data-item-id="${esc(itemId)}"><i class="fas fa-rotate-left"></i> Reset Budget Code</button>
            <div class="est-popover-divider"></div>
            <button type="button" class="danger" data-popover-item-action="delete-item" data-item-id="${esc(itemId)}"><i class="fas fa-trash"></i> Delete</button>
        `;
        showActionPopover(triggerBtn, html, `item:${itemId}`);
    }

    let tableResizeAndDragAttached = false;
    function attachTableResizeAndDragOnce() {
        if (tableResizeAndDragAttached) return;
        const table = $('estMainTable');
        if (!table) return;
        tableResizeAndDragAttached = true;

        let resizingCol = null;
        let resizerStartX = 0;
        let resizerStartWidth = 0;
        let currentWidth = 0;
        let resizeRaf = null;

        table.addEventListener('pointerdown', e => {
            const resizer = e.target.closest('.est-col-resizer');
            if (!resizer) return;

            const th = resizer.closest('th');
            if (!th) return;

            const colId = th.dataset.colId || resizer.dataset.resizerCol;
            if (!colId) return;

            e.preventDefault();
            e.stopPropagation();

            resizingCol = colId;
            resizerStartX = e.clientX;
            resizerStartWidth = th.getBoundingClientRect().width;
            currentWidth = resizerStartWidth;
            resizer.classList.add('est-col-resizing', 'is-dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            try {
                resizer.setPointerCapture(e.pointerId);
            } catch (_) {}

            table.classList.add('is-resizing-col');

            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;

            const onPointerMove = moveEvent => {
                if (!resizingCol) return;
                moveEvent.preventDefault();
                const delta = (moveEvent.clientX - resizerStartX) / zoom;
                const minW = resizingCol === 'cost_item' ? 180 : 50;
                currentWidth = Math.max(minW, Math.round(resizerStartWidth + delta));

                if (resizeRaf) cancelAnimationFrame(resizeRaf);
                resizeRaf = requestAnimationFrame(() => {
                    if (resizingCol === 'cost_item') {
                        table.style.setProperty('--est-col-cost-item-w', `${currentWidth}px`);
                    } else {
                        th.style.width = `${currentWidth}px`;
                        th.style.minWidth = `${currentWidth}px`;
                    }
                });
            };

            const onPointerUp = upEvent => {
                if (resizeRaf) cancelAnimationFrame(resizeRaf);
                table.classList.remove('is-resizing-col');
                if (resizingCol) {
                    saveColumnWidth(resizingCol, currentWidth);
                    if (resizingCol === 'cost_item') {
                        table.style.setProperty('--est-col-cost-item-w', `${currentWidth}px`);
                    }
                    resizer.classList.remove('est-col-resizing', 'is-dragging');
                    try {
                        if (upEvent?.pointerId) resizer.releasePointerCapture(upEvent.pointerId);
                    } catch (_) {}
                    resizingCol = null;
                }
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
            };

            window.addEventListener('pointermove', onPointerMove, { passive: false });
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        });

        let draggedColId = null;
        let dragOverRaf = null;
        let lastDragTh = null;

        table.addEventListener('dragstart', e => {
            if (resizingCol || e.target.closest('.est-col-resizer') || document.body.style.cursor === 'col-resize') {
                e.preventDefault();
                return false;
            }
            const th = e.target.closest('.est-th-draggable');
            if (!th || th.classList.contains('col-cost-item')) {
                e.preventDefault();
                return false;
            }
            draggedColId = th.dataset.colId;
            e.dataTransfer.setData('text/plain', draggedColId);
            e.dataTransfer.effectAllowed = 'move';
            th.classList.add('est-th-dragging');
        });

        table.addEventListener('dragover', e => {
            const th = e.target.closest('.est-th-draggable');
            if (!th || !draggedColId || th.dataset.colId === draggedColId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (dragOverRaf) return;
            dragOverRaf = requestAnimationFrame(() => {
                dragOverRaf = null;
                const rect = th.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                const isLeft = e.clientX < midX;
                if (lastDragTh && lastDragTh !== th) {
                    lastDragTh.classList.remove('est-th-drag-over-left', 'est-th-drag-over-right');
                }
                lastDragTh = th;
                if (isLeft) {
                    if (!th.classList.contains('est-th-drag-over-left')) {
                        th.classList.add('est-th-drag-over-left');
                        th.classList.remove('est-th-drag-over-right');
                    }
                } else {
                    if (!th.classList.contains('est-th-drag-over-right')) {
                        th.classList.add('est-th-drag-over-right');
                        th.classList.remove('est-th-drag-over-left');
                    }
                }
            });
        });

        table.addEventListener('dragleave', e => {
            const th = e.target.closest('.est-th-draggable');
            if (th && e.relatedTarget && !th.contains(e.relatedTarget)) {
                th.classList.remove('est-th-drag-over-left', 'est-th-drag-over-right');
                if (lastDragTh === th) lastDragTh = null;
            }
        });

        table.addEventListener('drop', e => {
            const th = e.target.closest('.est-th-draggable');
            if (!th || !draggedColId || th.dataset.colId === draggedColId) return;
            e.preventDefault();

            const targetColId = th.dataset.colId;
            const rect = th.getBoundingClientRect();
            const insertBefore = e.clientX < (rect.left + rect.width / 2);

            th.classList.remove('est-th-drag-over-left', 'est-th-drag-over-right');
            lastDragTh = null;

            const activeCols = getOrderedActiveColumns().map(c => c.id);
            const fromIdx = activeCols.indexOf(draggedColId);
            if (fromIdx !== -1) {
                activeCols.splice(fromIdx, 1);
                let toIdx = activeCols.indexOf(targetColId);
                if (!insertBefore) toIdx++;
                activeCols.splice(toIdx, 0, draggedColId);
                saveColumnsOrder(activeCols);
                renderTable();
            }
        });

        table.addEventListener('dragend', () => {
            draggedColId = null;
            lastDragTh = null;
            if (dragOverRaf) { cancelAnimationFrame(dragOverRaf); dragOverRaf = null; }
            table.querySelectorAll('.est-th-draggable').forEach(th => {
                th.classList.remove('est-th-dragging', 'est-th-drag-over-left', 'est-th-drag-over-right');
            });
        });
    }

    function renderTable() {
        const head = $('estTableHead');
        const body = $('estTableBody');
        if (!head || !body) return;

        const widths = getColumnWidths();
        const activeColumns = getOrderedActiveColumns();
        const costItemWidth = widths.cost_item || 340;
        const table = $('estMainTable');
        if (table) {
            table.style.setProperty('--est-col-cost-item-w', `${costItemWidth}px`);
        }

        const allSelectableItems = allItems().map(r => r.item).filter(it => !it.parentItemId && !it.parent_item_id && !it.assemblyParentId);
        const totalSelectableCount = allSelectableItems.length;
        const totalSelectedCount = allSelectableItems.filter(it => ui.selected.has(String(it.id)) || ui.selected.has(it.id)).length;
        const isAllChecked = totalSelectableCount > 0 && totalSelectedCount === totalSelectableCount;
        const isAllIndeterminate = totalSelectedCount > 0 && totalSelectedCount < totalSelectableCount;

        head.innerHTML = `<tr>
            <th class="col-check">
                <div class="est-col-check-cell">
                    <input type="checkbox" data-select-all ${isAllChecked ? 'checked' : ''} ${isAllIndeterminate ? 'data-indeterminate="true"' : ''} aria-label="Select all">
                </div>
            </th>
            <th class="col-cost-item" data-col-id="cost_item">
                <span class="est-th-label">Cost Item</span>
                <div class="est-col-resizer" data-resizer-col="cost_item"></div>
            </th>
            ${activeColumns.map(col => {
                const colWidth = widths[col.id] || parseInt(col.minWidth, 10) || 110;
                return `<th class="est-th-draggable ${col.align === 'right' ? 'text-right' : (col.align === 'center' ? 'text-center' : '')}"
                            data-col-id="${esc(col.id)}"
                            draggable="true"
                            style="width: ${colWidth}px; min-width: ${col.minWidth};">
                    <span class="est-th-label">${esc(col.label)}</span>
                    <div class="est-col-resizer" data-resizer-col="${esc(col.id)}"></div>
                </th>`;
            }).join('')}
            <th class="col-actions-sticky"></th>
        </tr>`;

        const query = ui.search.trim().toLowerCase();
        const html = [];
        const summaryData = Calc.calculateSummary(current().groups, current().settings);
        const calculatedRows = summaryData.rows;
        const calculatedByItem = new Map(calculatedRows.map(row => [String(row.item.id), row.calc]));
        const totalSummaryCost = summaryData.direct?.totalCost || 0;

        current().groups.forEach(group => {
            const visible = (group.items || []).filter(item => {
                const pId = item.parentItemId ?? item.parent_item_id ?? item.assemblyParentId;
                if (pId) return false;
                return !query || itemMatchesQuery(item, query);
            });
            const groupSubtotalCost = visible.reduce((sum, it) => {
                const c = calculatedByItem.get(String(it.id)) || Calc.calculateItem(it, current().settings);
                return sum + (c.materialCost || 0);
            }, 0);

            const groupSelectableItems = visible;
            const groupSelectedCount = groupSelectableItems.filter(it => ui.selected.has(String(it.id)) || ui.selected.has(it.id)).length;
            const isGroupChecked = groupSelectableItems.length > 0 && groupSelectedCount === groupSelectableItems.length;
            const isGroupIndeterminate = groupSelectedCount > 0 && groupSelectedCount < groupSelectableItems.length;

            html.push(`<tr class="est-group-row" data-group-id="${esc(group.id)}">
                <td class="col-check">
                    <div class="est-col-check-cell">
                        <input type="checkbox" data-group-check="${esc(group.id)}" ${isGroupChecked ? 'checked' : ''} ${isGroupIndeterminate ? 'data-indeterminate="true"' : ''} aria-label="Select group">
                    </div>
                </td>
                <td class="col-cost-item">
                    <div class="est-group-header-cell">
                        <button type="button" class="est-group-toggle-btn" data-toggle-group="${esc(group.id)}"><i class="fas fa-chevron-${group.expanded ? 'down' : 'right'}"></i></button>
                        <input class="est-group-name-input" data-group-name="${esc(group.id)}" value="${esc(group.name)}">
                    </div>
                </td>
                ${activeColumns.map(col => {
                    if (col.id === 'budget_code') {
                        const bCode = group.costCode || '16-1...';
                        return `<td><span class="est-budget-code-pill">${esc(bCode)} <span class="est-budget-code-clear">âœ•</span></span></td>`;
                    }
                    if (col.id === 'quantity') {
                        return `<td class="text-right"><span style="color: #2563eb; font-size: 12px; font-weight: 600;">${visible.length} x</span></td>`;
                    }
                    if (col.id === 'subtotal_item_cost') {
                        return `<td class="text-right est-money" style="font-weight: 700;" data-live-group-subtotal="${esc(group.id)}">${number(groupSubtotalCost, 2)}</td>`;
                    }
                    return `<td></td>`;
                }).join('')}
                <td class="col-actions-sticky">
                    <div class="est-sticky-actions-cell">
                        <button type="button" class="est-action-icon-btn est-btn-add" data-add-item="${esc(group.id)}" title="Create Item"><i class="fas fa-plus"></i></button>
                        <button type="button" class="est-action-icon-btn est-btn-more" data-group-menu-btn="${esc(group.id)}" title="More options"><i class="fas fa-ellipsis-vertical"></i></button>
                    </div>
                </td>
            </tr>`);

            if (!group.expanded) return;
            visible.forEach(item => {
                const calc = calculatedByItem.get(String(item.id)) || Calc.calculateItem(item, current().settings);
                html.push(renderItemRow(item, calc, activeColumns, totalSummaryCost));
                if (!isAssemblyItem(item) || !ui.expandedAssemblies.has(String(item.id))) return;
                const directChildren = getItemChildren(item);
                const matchingChildIds = query ? new Set(directChildren.filter(child => itemMatchesQuery(child, query)).map(child => String(child.id))) : null;
                const childrenToRender = (calc.childRows && calc.childRows.length > 0)
                    ? calc.childRows
                    : directChildren.map(child => ({
                        item: child,
                        calc: Calc.calculateItem(child, current().settings)
                    }));
                if (childrenToRender.length === 0) {
                    html.push(`<tr class="est-item-row est-assembly-component-row" data-parent-assembly-id="${esc(item.id)}">
                        <td class="col-check"><div class="est-col-check-cell"></div></td>
                        <td class="col-cost-item">
                            <div class="est-item-cell-singleline is-component">
                                <span class="est-assembly-branch-line" aria-hidden="true">&#8627;</span>
                                <span style="font-style: italic; color: var(--text-muted, #94a3b8); font-size: 11px;">No components defined in this assembly</span>
                            </div>
                        </td>
                        ${activeColumns.map(() => `<td></td>`).join('')}
                        <td class="col-actions-sticky"></td>
                    </tr>`);
                } else {
                    childrenToRender.forEach((childRow, index) => {
                        const sourceChild = findDirectAssemblyChild(item, childRow.item, index) || childRow.item;
                        if (matchingChildIds && !itemMatchesQuery(item, query) && sourceChild && !matchingChildIds.has(String(sourceChild.id))) return;
                        html.push(renderItemRow(childRow.item, childRow.calc, activeColumns, totalSummaryCost, { component: true, parent: item, sourceChild, index }));
                    });
                }
            });
        });

        body.innerHTML = html.join('') || `<tr><td colspan="${activeColumns.length + 3}" class="est-empty">No estimate items. Create a group or add items in Takeoff.</td></tr>`;

        // Apply indeterminate state to checkboxes
        root.querySelectorAll('input[type="checkbox"][data-indeterminate="true"]').forEach(cb => {
            cb.indeterminate = true;
        });

        const deleteButton = root.querySelector('[data-est-action="delete-selected"]');
        if (deleteButton) deleteButton.disabled = ui.selected.size === 0;

        attachTableResizeAndDragOnce();
    }

    function itemMatchesQuery(item, query) {
        const ownMatch = `${item.name || ''} ${item.description || ''} ${item.costCode || ''} ${item.catalogNumber || ''}`.toLowerCase().includes(query);
        return ownMatch || getItemChildren(item).some(child => itemMatchesQuery(child, query));
    }

    function findDirectAssemblyChild(parent, calculatedChild, index) {
        const children = getItemChildren(parent);
        const id = String(calculatedChild.id || '');
        const catalogId = String(calculatedChild.catalogItemId || calculatedChild.catalog_item_id || '');
        return children.find(child => id && String(child.id) === id)
            || children.find(child => catalogId && String(child.catalogItemId || child.catalog_item_id) === catalogId)
            || children[index] || null;
    }

    function renderItemRow(item, calc, activeColumns, totalSummaryCost, options = {}) {
        const component = options.component === true;
        const assembly = isAssemblyItem(item);
        const invalid = (calc.validation || []).length > 0;
        const rowId = component ? `${options.parent.id}:component:${options.sourceChild?.id || options.index}` : item.id;
        const widths = getColumnWidths();

        const colCells = activeColumns.map(col => {
            return renderItemCell(item, calc, col.id, totalSummaryCost, component);
        }).join('');

        const actions = component
            ? (options.sourceChild ? `<div class="est-sticky-actions-cell"><button type="button" class="est-action-icon-btn est-btn-delete" data-remove-assembly-component="${esc(options.sourceChild.id)}" data-parent-assembly-id="${esc(options.parent.id)}" title="Remove component"><i class="fas fa-trash"></i></button></div>` : '')
            : `<div class="est-sticky-actions-cell"><button type="button" class="est-action-icon-btn est-btn-more" data-item-menu-btn="${esc(item.id)}" title="More options"><i class="fas fa-ellipsis-vertical"></i></button></div>`;

        if (component) {
            return `<tr class="est-item-row est-assembly-component-row ${invalid ? 'est-invalid-row' : ''}" data-item-id="${esc(rowId)}" data-parent-assembly-id="${esc(options.parent.id)}" data-assembly-component-row ${invalid ? 'title="This item has calculation validation errors"' : ''}>
                <td class="col-check">
                    <div class="est-col-check-cell"></div>
                </td>
                <td class="col-cost-item">
                    <div class="est-item-cell-singleline is-component">
                        <span class="est-assembly-branch-line" aria-hidden="true">&#8627;</span>
                        <span class="pro-tree-item-title est-item-title" title="${esc(item.name)}">${esc(item.name)}</span>
                    </div>
                </td>
                ${colCells}
                <td class="col-actions-sticky">${actions}</td>
            </tr>`;
        }

        const layer = findTakeoffLayer(item);
        const itemTag = String(layer?.tag || item.tag || item.layerTag || '').trim();
        const tagHtml = itemTag ? `<span class="est-item-tag-pill" title="Tag: ${esc(itemTag)}"><i class="fas fa-tag"></i> ${esc(itemTag)}</span>` : '';
        const shapeSvg = getItemLayerShapeSvg(item, 14);

        const chevronBtnHtml = assembly
            ? `<button type="button" class="est-assembly-toggle-btn" data-toggle-assembly="${esc(item.id)}" aria-expanded="${ui.expandedAssemblies.has(String(item.id))}" aria-label="${ui.expandedAssemblies.has(String(item.id)) ? 'Collapse' : 'Expand'} ${esc(item.name)}"><i class="fas fa-chevron-${ui.expandedAssemblies.has(String(item.id)) ? 'down' : 'right'}" aria-hidden="true"></i></button>`
            : '';

        const isItemSelected = ui.selected.has(String(item.id)) || ui.selected.has(item.id);

        return `<tr class="est-item-row ${assembly ? 'est-assembly-parent-row' : ''} ${isItemSelected ? 'selected' : ''} ${invalid ? 'est-invalid-row' : ''}" data-item-id="${esc(rowId)}" ${invalid ? 'title="This item has calculation validation errors"' : ''}>
            <td class="col-check">
                <div class="est-col-check-cell">
                    <input type="checkbox" data-item-check="${esc(item.id)}" ${isItemSelected ? 'checked' : ''}>
                </div>
            </td>
            <td class="col-cost-item">
                <div class="est-item-cell-intelligent ${assembly ? 'is-assembly' : ''}">
                    <div class="est-item-chevron-col">
                        ${chevronBtnHtml}
                    </div>
                    <div class="est-item-shape-col">
                        ${shapeSvg}
                    </div>
                    <div class="est-item-text-col ${itemTag ? 'has-tag' : 'no-tag'}">
                        <span class="pro-tree-item-title est-item-title" title="${esc(item.name)}">${esc(item.name)}</span>
                        ${tagHtml}
                    </div>
                </div>
            </td>
            ${colCells}
            <td class="col-actions-sticky">${actions}</td>
        </tr>`;
    }

    function renderItemCell(item, calc, colId, totalSummaryCost, readonly = false) {
        if (colId === 'budget_code') {
            const code = item.costCode || item.budgetCode || item.cost_code || '16-1...';
            return `<td><span class="est-budget-code-pill">${esc(code)} <span class="est-budget-code-clear">âœ•</span></span></td>`;
        }
        if (colId === 'quantity') {
            const qty = calc.baseQuantity !== undefined ? calc.baseQuantity : item.quantity;
            const uom = item.uom || 'ea';
            const formattedQty = Number(qty || 0).toFixed(2);
            if (readonly) return `<td class="text-right"><span>${number(qty, 2)} ${esc(uom)}</span></td>`;
            const isOverridden = Boolean(item.quantityOverride || item.quantitySyncStatus === 'overridden');
            const takeoffQty = Number(item.lastSyncedTakeoffQuantity ?? item.originalQuantity ?? qty ?? 0);
            const qtyTooltip = isOverridden
                ? `Custom quantity override: ${number(qty, 2)} ${uom} (Takeoff: ${number(takeoffQty, 2)} ${uom})`
                : (item.takeoffLayerId ? `Synced from Takeoff (${number(takeoffQty, 2)} ${uom}) — edit to override` : 'Enter item quantity');
            return `<td class="text-right"><input class="est-cell-input is-editable ${isOverridden ? 'is-qty-overridden' : ''}" data-item-field="quantity" type="number" step="0.01" value="${esc(formattedQty)}" style="width: 55px; text-align: center;" title="${esc(qtyTooltip)}"> <span style="font-size: 11px; color: #64748b; margin-left: 2px;">${esc(uom)}</span></td>`;
        }
        if (colId === 'unit_cost') {
            const unitCost = calc.unitMaterialCost !== undefined ? calc.unitMaterialCost : (item.unitMaterialCost ?? item.unitCost ?? 0);
            const formattedCost = Number(unitCost || 0).toFixed(2);
            if (readonly) return `<td class="text-right est-money"><span>${number(unitCost, 2)}</span></td>`;
            return `<td class="text-right"><input class="est-cell-input is-editable" data-item-field="unitMaterialCost" type="number" step="0.01" value="${esc(formattedCost)}" style="width: 62px; text-align: center;"></td>`;
        }
        if (colId === 'waste') {
            const waste = item.waste ?? 0;
            const formattedWaste = Number(waste || 0).toFixed(2);
            if (readonly) return `<td class="text-right"><span>${number(waste, 2)}</span></td>`;
            return `<td class="text-right"><input class="est-cell-input is-editable" data-item-field="waste" type="number" step="0.01" value="${esc(formattedWaste)}" style="width: 48px; text-align: center;"></td>`;
        }
        if (colId === 'subtotal_item_cost') {
            return `<td class="text-right est-money" data-live-item-cell="subtotal_item_cost">${number(calc.materialCost || 0, 2)}</td>`;
        }
        if (colId === 'margin') {
            const margin = item.materialMargin ?? calc.marginPercent ?? 0;
            const formattedMargin = Number(margin || 0).toFixed(2);
            if (readonly) return `<td class="text-right"><span>${number(margin, 2)}</span></td>`;
            return `<td class="text-right"><input class="est-cell-input is-editable" data-item-field="materialMargin" type="number" step="0.01" max="99.99" value="${esc(formattedMargin)}" style="width: 48px; text-align: center;"></td>`;
        }
        if (colId === 'unit_sales') {
            return `<td class="text-right est-money" data-live-item-cell="unit_sales">${number(calc.unitMaterialSales || 0, 2)}</td>`;
        }
        if (colId === 'subtotal_item_sales') {
            return `<td class="text-right est-money" data-live-item-cell="subtotal_item_sales">${number(calc.materialSales || 0, 2)}</td>`;
        }
        if (colId === 'profit') {
            const profit = calc.profit || 0;
            return `<td class="text-right est-money" data-live-item-cell="profit" style="font-weight: 600; color: ${profit >= 0 ? '#10b981' : '#ef4444'};">${number(profit, 2)}</td>`;
        }
        if (colId === 'unit_labor') {
            const ul = item.unitLabor ?? 0;
            const formattedUl = Number(ul || 0).toFixed(2);
            if (readonly) return `<td class="text-right"><span>${number(ul, 2)}</span></td>`;
            return `<td class="text-right"><input class="est-cell-input is-editable" data-item-field="unitLabor" type="number" step="0.01" value="${esc(formattedUl)}" style="width: 52px; text-align: center;"></td>`;
        }
        if (colId === 'difficulty_factor') {
            const diff = item.difficulty ?? 1;
            const formattedDiff = Number(diff || 1).toFixed(2);
            if (readonly) return `<td class="text-right"><span>${number(diff, 2)}</span></td>`;
            return `<td class="text-right"><input class="est-cell-input is-editable" data-item-field="difficulty" type="number" step="0.01" value="${esc(formattedDiff)}" style="width: 48px; text-align: center;"></td>`;
        }
        if (colId === 'total_labor_hrs') {
            return `<td class="text-right" data-live-item-cell="total_labor_hrs">${number(calc.adjustedLaborHours || 0, 2)}</td>`;
        }
        if (colId === 'total_labor_cost') {
            return `<td class="text-right est-money" data-live-item-cell="total_labor_cost">${number(calc.laborCost || 0, 2)}</td>`;
        }
        if (colId === 'total_cost') {
            return `<td class="text-right est-money" data-live-item-cell="total_cost" style="font-weight: 600;">${number(calc.totalCost || 0, 2)}</td>`;
        }
        if (colId === 'total_cost_percent') {
            const pct = totalSummaryCost > 0 ? ((calc.totalCost || 0) / totalSummaryCost) * 100 : 0;
            return `<td class="text-right" data-live-item-cell="total_cost_percent">${number(pct, 1)}%</td>`;
        }
        if (colId === 'total_sales') {
            return `<td class="text-right est-money" data-live-item-cell="total_sales" style="font-weight: 600;">${number(calc.totalSales || 0, 2)}</td>`;
        }
        if (colId === 'notes') {
            const desc = item.description || item.notes || '';
            return `<td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${esc(desc)}">${esc(desc || '-')}</td>`;
        }
        if (colId === 'tax') {
            return `<td class="text-center">${item.taxable !== false ? '<i class="fas fa-check" style="color: #10b981;"></i>' : '<span style="color: #94a3b8;">-</span>'}</td>`;
        }
        return `<td></td>`;
    }

    function renderDetails() {
        const aside = root.querySelector('.est-right-scroll');
        if (!aside) return;
        const savedAsideScrollTop = aside.scrollTop;
        const savedTableScrolls = Array.from(aside.querySelectorAll('.est-summary-table-scroll')).map(el => ({
            scrollLeft: el.scrollLeft,
            scrollTop: el.scrollTop
        }));
        const estimate = current();
        const total = summary();
        aside.innerHTML = `${card('notes', 'Notes', notesHtml(estimate))}${card('summary', 'Summary', summaryHtml(total))}${card('audit', 'Audit', auditHtml(estimate))}`;
        const totalElement = $('estimateTotal');
        if (totalElement) totalElement.textContent = money(total.estimateTotal);
        renderSqftDisplay(total);

        // Restore scroll positions so Table 1 and right sidebar never jump on re-render
        aside.scrollTop = savedAsideScrollTop;
        const newTableScrolls = aside.querySelectorAll('.est-summary-table-scroll');
        savedTableScrolls.forEach((pos, idx) => {
            if (newTableScrolls[idx]) {
                newTableScrolls[idx].scrollLeft = pos.scrollLeft;
                newTableScrolls[idx].scrollTop = pos.scrollTop;
            }
        });

        // Auto-adjust textarea heights for notes (max 180px with internal scroll)
        aside.querySelectorAll('.est-note-auto-textarea').forEach(tx => {
            tx.style.height = 'auto';
            const h = Math.min(180, Math.max(38, tx.scrollHeight));
            tx.style.height = `${h}px`;
            tx.style.overflowY = tx.scrollHeight > 180 ? 'auto' : 'hidden';
        });
    }

    function card(key, title, content) {
        const collapsed = ui.collapsed[key] === true;
        return `<section class="est-card ${collapsed ? 'collapsed' : ''}" id="${key}Card"><button class="est-card-header" type="button" data-collapse-card="${key}" aria-expanded="${!collapsed}"><span><i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i> ${title}</span></button>${collapsed ? '' : `<div class="est-card-body">${content}</div>`}</section>`;
    }

    function notesHtml(estimate) {
        const notes = estimate.notes || {};
        return `
            <div class="est-note-block-card">
                <div class="est-note-card-head">Scope of Work</div>
                ${richEditorToolbar('scope')}
                <div class="est-rich-editor-box" contenteditable="true" data-note-field="scope" id="scopeEditor">${notes.scope || ''}</div>
            </div>

            ${listEditor('included', 'Included', notes.included || [])}
            ${listEditor('excluded', 'Excluded', notes.excluded || [])}

            <div class="est-note-block-card">
                <div class="est-note-card-head">Project Notes</div>
                ${richEditorToolbar('projectNotes')}
                <div class="est-rich-editor-box" contenteditable="true" data-note-field="projectNotes" id="projectNotesEditor">${notes.projectNotes || ''}</div>
            </div>
        `;
    }

    function richEditorToolbar(id) {
        return `<div class="est-rte-toolbar" data-toolbar-target="${id}">
            <button type="button" class="est-rte-btn" data-rte-cmd="bold" title="Bold"><b>B</b></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="italic" title="Italic"><i>I</i></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="underline" title="Underline"><u>U</u></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
            <span class="est-rte-divider"></span>
            <button type="button" class="est-rte-btn" data-rte-cmd="justifyLeft" title="Align left"><i class="fas fa-align-left"></i></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="justifyCenter" title="Align center"><i class="fas fa-align-center"></i></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="justifyRight" title="Align right"><i class="fas fa-align-right"></i></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="justifyFull" title="Justify"><i class="fas fa-align-justify"></i></button>
            <span class="est-rte-divider"></span>
            <button type="button" class="est-rte-btn" data-rte-cmd="insertUnorderedList" title="Bullets"><i class="fas fa-list-ul"></i></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="insertOrderedList" title="Numbered list"><i class="fas fa-list-ol"></i></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="outdent" title="Outdent"><i class="fas fa-outdent"></i></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="indent" title="Indent"><i class="fas fa-indent"></i></button>
            <span class="est-rte-divider"></span>
            <button type="button" class="est-rte-btn" data-rte-cmd="cut" title="Cut"><i class="fas fa-scissors"></i></button>
            <button type="button" class="est-rte-btn" data-rte-cmd="copy" title="Copy"><i class="fas fa-copy"></i></button>
        </div>`;
    }

    const EXCLUSION_PRESETS_KEY = 'takeoff.exclusions.presets';
    const DEFAULT_EXCLUSIONS = [
        'Low Voltage Wiring (We Estimate separate)',
        'General Exclusion:\nThe correction of any existing concealed defects, code violations, or plan conflicts is not included.\n\nFire Alarm System, Tele/Data wiring, Nurse Call System, Lightning Protection System, Fire Alarm Monitoring, CATV/CCTV System, Security System, Sound System, Access Controls, Camera System, or any other system, its wiring, equipment, and devices are NOT included in this proposal.\n\nPower Company fees, metering equipment, transformer lugs, primary conduits, and conductors are not included in this proposal.\n\nDirectional boring, cutting, removal, and patching of concrete, asphalt, and compacted road base are not included.\n\nThird-party testing of any equipment or system if required is not included.\n\nLocating, identifying, marking, and/or tagging existing underground systems is not included in this proposal.\n\nAll work is performed during normal Brightronix LLC working hours.\n\nPayment and Performance Bonds are not included.\n\nThis proposal is valid for thirty (30) days from the above date.\n\nif there are changes on the lighting or gear package after the approval of the project may incur in additional freight charges.',
        'Permits, testing, inspections and municipal fees',
        'Hazardous material abatement or remediation',
        'Overtime or weekend work unless specified',
        'Demolition of existing structures not shown on plans',
        'Bonds (performance / payment bond) unless requested',
        'Architectural / engineering design fees and stamped drawings',
        'Trash disposal dumpster fees by others',
        'Temporary power, water, and sanitary facilities'
    ];

    const INCLUSION_PRESETS_KEY = 'takeoff.inclusions.presets';
    const DEFAULT_INCLUSIONS = [
        'Complete Wiring and termination of New items per Electrical plans dated on XX/XX/XXXX',
        'Gears Package Square D',
        'Lighting Package subject to approval (Enter the included Lighting Fixtures Names Here)',
        'Low Voltage Wiring (We Estimate separate)',
        'Branch circuits wiring and conduit per plan',
        'Panels and disconnects installation'
    ];

    function getExclusionPresets() {
        try {
            const raw = localStorage.getItem(EXCLUSION_PRESETS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length) return parsed;
            }
        } catch (_) {}
        return [...DEFAULT_EXCLUSIONS];
    }

    function saveExclusionPresets(list) {
        try {
            localStorage.setItem(EXCLUSION_PRESETS_KEY, JSON.stringify(list));
        } catch (_) {}
    }

    function addExclusionPreset(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return;
        const currentPresets = getExclusionPresets();
        if (!currentPresets.includes(trimmed)) {
            currentPresets.push(trimmed);
            saveExclusionPresets(currentPresets);
        }
    }

    function deleteExclusionPreset(index) {
        const currentPresets = getExclusionPresets();
        if (index >= 0 && index < currentPresets.length) {
            currentPresets.splice(index, 1);
            saveExclusionPresets(currentPresets);
        }
    }

    function getInclusionPresets() {
        try {
            const raw = localStorage.getItem(INCLUSION_PRESETS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length) return parsed;
            }
        } catch (_) {}
        return [...DEFAULT_INCLUSIONS];
    }

    function saveInclusionPresets(list) {
        try {
            localStorage.setItem(INCLUSION_PRESETS_KEY, JSON.stringify(list));
        } catch (_) {}
    }

    function addInclusionPreset(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return;
        const currentPresets = getInclusionPresets();
        if (!currentPresets.includes(trimmed)) {
            currentPresets.push(trimmed);
            saveInclusionPresets(currentPresets);
        }
    }

    function deleteInclusionPreset(index) {
        const currentPresets = getInclusionPresets();
        if (index >= 0 && index < currentPresets.length) {
            currentPresets.splice(index, 1);
            saveInclusionPresets(currentPresets);
        }
    }

    function listEditor(key, label, values) {
        return `
            <div class="est-note-block-card">
                <div class="est-note-card-head">${label}</div>
                <div class="est-note-items-list" data-note-key="${key}">
                    ${(values || []).map((value, index) => `
                        <div class="est-note-row" data-note-key="${key}" data-index="${index}" draggable="true">
                            <span class="est-note-drag" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
                            <span class="est-note-idx">${index + 1}.</span>
                            <textarea class="est-note-auto-textarea" data-note-list="${key}" data-index="${index}" placeholder="Enter ${label.toLowerCase()} note...">${esc(value)}</textarea>
                            <button type="button" class="est-note-trash-btn" data-remove-note-row="${key}" data-index="${index}" title="Remove note">
                                <i class="fas fa-trash-can"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                <div class="est-note-card-footer">
                    <button type="button" class="est-note-add-round-btn" data-add-note-row="${key}" title="Add ${label} note">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button type="button" class="est-browse-lib-btn" data-browse-library="${key}">
                        <i class="fas fa-bars-staggered"></i> Browse library
                    </button>
                </div>
            </div>
        `;
    }

    function summaryHtml(total = {}) {
        const settings = current().settings || {};
        const globalLaborCost = Number(settings.globalLaborCost ?? 36);
        const globalLaborMargin = Number(settings.globalLaborMargin ?? 34.6);
        const globalLaborSales = globalLaborMargin < 100
            ? (globalLaborCost / (1 - globalLaborMargin / 100))
            : globalLaborCost;

        const materialMargin = Number(settings.materialMargin ?? 15);
        const equipmentMargin = Number(settings.equipmentMargin ?? 15);
        const laborWaste = Number(settings.laborWaste ?? 0);
        const materialWaste = Number(settings.materialWaste ?? 0);
        const equipmentWaste = Number(settings.equipmentWaste ?? 0);
        const laborDifficulty = Number(settings.laborDifficulty ?? 1);

        const byCat = total?.byCategory || {};
        const catLabor = byCat.Labor || {};
        const catMaterials = byCat.Materials || {};
        const catEquipment = byCat.Equipment || {};
        const direct = total?.direct || {};

        return `
            <!-- Top Global Labor Rates Bar (Stacked vertically: Cost on top, Sales Rate below) -->
            <div class="est-summary-rates-bar">
                <div class="est-summary-rate-line">Global labor cost <input class="est-rate-inline-input" data-summary-rate="globalLaborCost" type="number" step="0.01" min="0" value="${globalLaborCost.toFixed(2)}"> $/hr</div>
                <div class="est-summary-rate-line">Global labor sales rate <input class="est-rate-inline-input" data-summary-rate="globalLaborSales" type="number" step="0.01" min="0" value="${globalLaborSales.toFixed(2)}"> $/hr</div>
            </div>

            <!-- Table 1: Catalog Item Type Table (Fixed columns + Horizontal Scroll + Sticky Col 1) -->
            <div class="est-summary-table-card">
                <div class="est-summary-table-scroll est-summary-hscroll">
                    <table class="est-summary-subtable est-summary-main-table">
                        <colgroup>
                            <col style="width: 145px; min-width: 145px;">
                            <col style="width: 118px; min-width: 118px;">
                            <col style="width: 112px; min-width: 112px;">
                            <col style="width: 92px; min-width: 92px;">
                            <col style="width: 108px; min-width: 108px;">
                            <col style="width: 98px; min-width: 98px;">
                            <col style="width: 112px; min-width: 112px;">
                            <col style="width: 102px; min-width: 102px;">
                        </colgroup>
                        <thead>
                            <tr>
                                <th class="col-summary-sticky" style="width: 145px; min-width: 145px; max-width: 145px;">
                                    <span class="est-th-label">Catalog Item Type</span>
                                </th>
                                <th class="text-right" style="width: 118px; min-width: 118px;">
                                    <span class="est-th-label">Total Labor (hrs)</span>
                                </th>
                                <th class="text-center" style="width: 112px; min-width: 112px;">
                                    <span class="est-th-label">Difficulty Factor</span>
                                </th>
                                <th class="text-center" style="width: 92px; min-width: 92px;">
                                    <span class="est-th-label">Waste (%)</span>
                                </th>
                                <th class="text-right" style="width: 108px; min-width: 108px;">
                                    <span class="est-th-label">Total Cost ($)</span>
                                </th>
                                <th class="text-center" style="width: 98px; min-width: 98px; text-decoration: underline;">
                                    <span class="est-th-label">Margin (%)</span>
                                </th>
                                <th class="text-right" style="width: 112px; min-width: 112px;">
                                    <span class="est-th-label">Total Sales ($)</span>
                                </th>
                                <th class="text-right" style="width: 102px; min-width: 102px;">
                                    <span class="est-th-label">Profit ($)</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <!-- Labor -->
                            <tr>
                                <td class="est-type-name col-summary-sticky">Labor</td>
                                <td class="text-right" data-live-summary="labor-hrs">${number(catLabor.adjustedLaborHours || 0, 2)} hrs</td>
                                <td class="text-center">
                                    <span class="est-blue-cell-box"><input class="est-cell-blue-input" data-summary-type="Labor" data-field="difficulty" type="number" step="0.1" min="0.1" value="${laborDifficulty}"> x</span>
                                </td>
                                <td class="text-center">
                                    <span class="est-blue-cell-box"><input class="est-cell-blue-input" data-summary-type="Labor" data-field="waste" type="number" step="1" min="0" value="${laborWaste}"> %</span>
                                </td>
                                <td class="text-right est-money" data-live-summary="labor-cost">${money(catLabor.totalCost || 0)}</td>
                                <td class="text-center">
                                    <span class="est-blue-cell-box"><input class="est-cell-blue-input" data-summary-type="Labor" data-field="margin" type="number" step="0.1" max="99.9" value="${globalLaborMargin.toFixed(1)}"> %</span>
                                </td>
                                <td class="text-right est-money" data-live-summary="labor-sales">${money(catLabor.totalSales || 0)}</td>
                                <td class="text-right est-money" data-live-summary="labor-profit">${money(catLabor.profit || 0)}</td>
                            </tr>
                            <!-- Materials -->
                            <tr>
                                <td class="est-type-name col-summary-sticky">Materials</td>
                                <td class="text-right" style="color: #94a3b8;">--</td>
                                <td class="text-center" style="color: #94a3b8;">--</td>
                                <td class="text-center">
                                    <span class="est-blue-cell-box"><input class="est-cell-blue-input" data-summary-type="Materials" data-field="waste" type="number" step="1" min="0" value="${materialWaste}"> %</span>
                                </td>
                                <td class="text-right est-money" data-live-summary="mat-cost">${money(catMaterials.totalCost || 0)}</td>
                                <td class="text-center">
                                    <span class="est-blue-cell-box"><input class="est-cell-blue-input" data-summary-type="Materials" data-field="margin" type="number" step="0.1" max="99.9" value="${materialMargin.toFixed(1)}"> %</span>
                                </td>
                                <td class="text-right est-money" data-live-summary="mat-sales">${money(catMaterials.totalSales || 0)}</td>
                                <td class="text-right est-money" data-live-summary="mat-profit">${money(catMaterials.profit || 0)}</td>
                            </tr>
                            <!-- Equipment -->
                            <tr>
                                <td class="est-type-name col-summary-sticky">Equipment</td>
                                <td class="text-right" style="color: #94a3b8;">--</td>
                                <td class="text-center" style="color: #94a3b8;">--</td>
                                <td class="text-center">
                                    <span class="est-blue-cell-box"><input class="est-cell-blue-input" data-summary-type="Equipment" data-field="waste" type="number" step="1" min="0" value="${equipmentWaste}"> %</span>
                                </td>
                                <td class="text-right est-money" data-live-summary="eq-cost">${money(catEquipment.totalCost || 0)}</td>
                                <td class="text-center">
                                    <span class="est-blue-cell-box"><input class="est-cell-blue-input" data-summary-type="Equipment" data-field="margin" type="number" step="0.1" max="99.9" value="${equipmentMargin.toFixed(1)}"> %</span>
                                </td>
                                <td class="text-right est-money" data-live-summary="eq-sales">${money(catEquipment.totalSales || 0)}</td>
                                <td class="text-right est-money" data-live-summary="eq-profit">${money(catEquipment.profit || 0)}</td>
                            </tr>
                            <!-- Subtotal -->
                            <tr class="est-summary-subtotal-row">
                                <td class="col-summary-sticky">Subtotal</td>
                                <td class="text-right" style="color: #94a3b8;">--</td>
                                <td class="text-center" style="color: #94a3b8;">--</td>
                                <td class="text-center" style="color: #94a3b8;">--</td>
                                <td class="text-right est-money" data-live-summary="direct-cost">${money(direct.totalCost || 0)}</td>
                                <td class="text-center" data-live-summary="direct-margin">${direct.marginPercent ? direct.marginPercent.toFixed(2) : '0.00'}</td>
                                <td class="text-right est-money" data-live-summary="direct-sales">${money(direct.totalSales || 0)}</td>
                                <td class="text-right est-money" data-live-summary="direct-profit">${money(direct.profit || 0)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Table 2: Pre-Tax Markups Table -->
            <div class="est-summary-table-card">
                <div class="est-summary-card-head">
                    <span class="est-th-label">Pre-Tax Markups</span>
                    <button type="button" class="est-btn est-new-estimate est-summary-plus-btn" data-add-markup="preTaxMarkups" title="Add Pre-Tax Markup">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <div class="est-summary-table-scroll">
                    <table class="est-summary-subtable est-summary-compact-table">
                        <tbody>
                            ${(total.preTaxMarkups || []).map((row, idx) => `
                            <tr class="est-markup-table-row" data-markup-id="${row.id}" data-markup-type="preTaxMarkups" data-index="${idx}" draggable="true">
                                <td class="est-markup-grip-cell">
                                    <span class="est-markup-drag" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
                                </td>
                                <td class="est-markup-name-col">
                                    <span class="est-markup-title">${esc(row.name)}</span>
                                </td>
                                <td class="est-markup-rate-col">
                                    <span class="est-blue-cell-box">
                                        <input class="est-cell-blue-input" data-markup-quick-val="${row.id}" type="number" step="0.1" value="${row.type === 'fixed_amount' ? row.amount : row.percent}">
                                        <span>${row.type === 'fixed_amount' ? '$' : '%'}</span>
                                    </span>
                                    <span class="est-tilde-sep">~</span>
                                </td>
                                <td class="text-right est-money est-markup-val-col" data-live-summary="markup-${row.id}">${money(row.value || 0)}</td>
                                <td class="est-markup-actions-col">
                                    <button type="button" class="est-row-more-btn" data-markup-menu-btn="${row.id}" title="Edit markup options">
                                        <i class="fas fa-ellipsis-vertical"></i>
                                    </button>
                                </td>
                            </tr>`).join('') || `<tr><td colspan="5" class="est-empty-sub">No pre-tax markups defined</td></tr>`}
                            <tr class="est-summary-subtotal-row">
                                <td colspan="3" class="est-compact-subtotal-label">Subtotal</td>
                                <td class="text-right est-money" data-live-summary="preTaxTotal">${money(total.preTaxTotal || 0)}</td>
                                <td></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Table 3: Taxes Table -->
            <div class="est-summary-table-card">
                <div class="est-summary-card-head">
                    <span class="est-th-label">Taxes</span>
                    <button type="button" class="est-head-action-btn" data-taxes-modal-toggle title="Tax settings">
                        <i class="fas fa-wand-magic-sparkles"></i>
                    </button>
                </div>
                <div class="est-summary-table-scroll">
                    <table class="est-summary-subtable est-summary-compact-table">
                        <tbody>
                            ${['Labor', 'Materials', 'Equipment'].map(type => `
                            <tr>
                                <td class="est-markup-grip-cell"></td>
                                <td class="est-markup-name-col">${type} Tax</td>
                                <td class="est-markup-rate-col">
                                    <span class="est-blue-cell-box">
                                        <input class="est-cell-blue-input" data-tax="${type}" type="number" step="0.1" min="0" value="${settings.taxes?.[type] ?? 0}">
                                        <span>%</span>
                                    </span>
                                    <span class="est-tilde-sep">~</span>
                                </td>
                                <td class="text-right est-money est-markup-val-col" data-live-summary="tax-${type}">${money(total.taxes?.[type] || 0)}</td>
                                <td class="est-markup-actions-col"></td>
                            </tr>`).join('')}
                            <tr class="est-summary-subtotal-row">
                                <td colspan="3" class="est-compact-subtotal-label">Subtotal</td>
                                <td class="text-right est-money" data-live-summary="totalTax">${money(total.totalTax || 0)}</td>
                                <td></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Table 4: Post-Tax Markups Table -->
            <div class="est-summary-table-card">
                <div class="est-summary-card-head">
                    <span class="est-th-label">Post-Tax Markups</span>
                    <button type="button" class="est-btn est-new-estimate est-summary-plus-btn" data-add-markup="postTaxMarkups" title="Add Post-Tax Markup">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <div class="est-summary-table-scroll">
                    <table class="est-summary-subtable est-summary-compact-table">
                        <tbody>
                            ${(total.postTaxMarkups || []).map((row, idx) => `
                            <tr class="est-markup-table-row" data-markup-id="${row.id}" data-markup-type="postTaxMarkups" data-index="${idx}" draggable="true">
                                <td class="est-markup-grip-cell">
                                    <span class="est-markup-drag" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
                                </td>
                                <td class="est-markup-name-col">
                                    <span class="est-markup-title">${esc(row.name)}</span>
                                </td>
                                <td class="est-markup-rate-col">
                                    <span class="est-blue-cell-box">
                                        <input class="est-cell-blue-input" data-markup-quick-val="${row.id}" type="number" step="0.1" value="${row.type === 'fixed_amount' ? row.amount : row.percent}">
                                        <span>${row.type === 'fixed_amount' ? '$' : '%'}</span>
                                    </span>
                                    <span class="est-tilde-sep">~</span>
                                </td>
                                <td class="text-right est-money est-markup-val-col" data-live-summary="markup-${row.id}">${money(row.value || 0)}</td>
                                <td class="est-markup-actions-col">
                                    <button type="button" class="est-row-more-btn" data-markup-menu-btn="${row.id}" title="Edit markup options">
                                        <i class="fas fa-ellipsis-vertical"></i>
                                    </button>
                                </td>
                            </tr>`).join('') || `<tr><td colspan="5" class="est-empty-sub">No post-tax markups defined</td></tr>`}
                            <tr class="est-summary-subtotal-row">
                                <td colspan="3" class="est-compact-subtotal-label">Subtotal</td>
                                <td class="text-right est-money" data-live-summary="postTaxTotal">${money(total.postTaxTotal || 0)}</td>
                                <td></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function auditHtml(estimate) {
        const logs = (estimate.auditLog || []).slice().reverse();
        const getBadgeInfo = (action = '') => {
            const lower = action.toLowerCase();
            if (lower.includes('add') || lower.includes('create') || lower.includes('copy')) {
                return { icon: 'fa-plus', cls: 'is-add' };
            }
            if (lower.includes('delete') || lower.includes('remove') || lower.includes('clear') || lower.includes('reset')) {
                return { icon: 'fa-trash-can', cls: 'is-delete' };
            }
            if (lower.includes('sync') || lower.includes('catalog')) {
                return { icon: 'fa-arrows-rotate', cls: 'is-sync' };
            }
            return { icon: 'fa-pen', cls: 'is-update' };
        };
        const formatAuditDate = (iso) => {
            try {
                const d = new Date(iso);
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ? ' +
                       d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            } catch (_) {
                return String(iso || '');
            }
        };
        return `
            <div class="est-audit-card-wrap">
                <div class="est-audit-toolbar">
                    <span class="est-audit-count-badge">
                        <i class="fas fa-clock-rotate-left"></i> ${logs.length} ${logs.length === 1 ? 'event' : 'events'}
                    </span>
                    <div class="est-audit-btn-group">
                        <button type="button" class="est-audit-action-btn" data-audit-export title="Export audit log as JSON">
                            <i class="fas fa-file-export"></i> Export JSON
                        </button>
                        <button type="button" class="est-audit-action-btn is-danger" data-audit-clear title="Clear audit history">
                            <i class="fas fa-broom"></i> Clear
                        </button>
                    </div>
                </div>
                <div class="est-audit-timeline">
                    ${logs.map(row => {
                        const badge = getBadgeInfo(row.action);
                        const rawAction = String(row.action || '');
                        const diffMatch = rawAction.match(/^(.*?)\s*\(([^()]+?)\s*(?:->|→)\s*([^()]+?)\)\s*$/);
                        const actionHtml = diffMatch
                            ? `<span>${esc(diffMatch[1])}</span> <span class="est-audit-diff-pill"><span class="est-audit-old-val">${esc(diffMatch[2].trim())}</span><i class="fas fa-arrow-right"></i><span class="est-audit-new-val">${esc(diffMatch[3].trim())}</span></span>`
                            : esc(rawAction);
                        return `
                        <div class="est-audit-item">
                            <div class="est-audit-dot ${badge.cls}">
                                <i class="fas ${badge.icon}"></i>
                            </div>
                            <div class="est-audit-content">
                                <div class="est-audit-action-text">${actionHtml}</div>
                                <time class="est-audit-time"><i class="far fa-clock"></i> ${esc(formatAuditDate(row.at))}</time>
                            </div>
                        </div>`;
                    }).join('') || `
                        <div class="est-audit-empty">
                            <i class="fas fa-clipboard-check"></i>
                            <span>No activity recorded yet for this estimate.</span>
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    function renderNotesLibraryModal() {
        document.getElementById('notesLibraryModalBackdrop')?.remove();
        if (!ui.notesLibraryModal) return;
        const targetKey = ui.notesLibraryModal; // 'included' or 'excluded'
        const isExcluded = targetKey === 'excluded';
        const label = isExcluded ? 'Excluded' : 'Included';
        const presets = isExcluded ? getExclusionPresets() : getInclusionPresets();
        const search = (ui.notesLibrarySearch || '').toLowerCase().trim();
        const filtered = presets.filter(p => !search || p.toLowerCase().includes(search));

        const backdrop = document.createElement('div');
        backdrop.id = 'notesLibraryModalBackdrop';
        backdrop.className = 'pd-modal-backdrop open';
        backdrop.style.cssText = 'position: fixed; inset: 0; z-index: 1050; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(2px);';
        backdrop.innerHTML = `
            <div class="pd-modal" style="width: min(680px, 95vw); max-height: 85vh; display: flex; flex-direction: column; background: var(--bg-surface, #ffffff); border-radius: 8px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); overflow: hidden;">
                <div class="pd-modal-header" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border-color, #e2e8f0); background: #ecedee;">
                    <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13.5px; color: #334155;">
                        <i class="fas fa-clipboard-list" style="color: #2563eb;"></i>
                        <span>Notes Library & Clipboard</span>
                    </div>
                    <button type="button" class="est-icon-action-btn" data-close-notes-lib style="font-size: 18px; border: none; background: transparent; cursor: pointer; color: #64748b;">&times;</button>
                </div>
                
                <!-- Category switch & Search bar -->
                <div style="padding: 12px 18px; background: var(--bg-surface-2, #f8fafc); border-bottom: 1px solid var(--border-color, #e2e8f0); display: flex; flex-direction: column; gap: 10px;">
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="est-btn ${!isExcluded ? 'primary' : 'secondary'}" data-notes-lib-tab="included" style="padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-check"></i> Included Presets (${getInclusionPresets().length})
                        </button>
                        <button type="button" class="est-btn ${isExcluded ? 'primary' : 'secondary'}" data-notes-lib-tab="excluded" style="padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-ban"></i> Excluded Presets (${getExclusionPresets().length})
                        </button>
                    </div>
                    <div style="position: relative;">
                        <input type="search" id="notesLibSearchInput" class="est-rate-inline-input" placeholder="Search library presets..." value="${esc(ui.notesLibrarySearch || '')}" style="width: 100%; text-align: left; padding: 7px 12px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12.5px; font-weight: normal; color: inherit; box-sizing: border-box;">
                    </div>
                </div>

                <!-- Presets list -->
                <div class="notes-lib-list" style="flex: 1; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;">
                    ${filtered.map((preset, idx) => `
                        <div class="notes-lib-card" style="display: flex; gap: 12px; align-items: flex-start; padding: 12px; background: var(--bg-surface, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 6px; transition: all .15s ease;">
                            <div style="font-weight: 700; color: #64748b; font-size: 12px; min-width: 20px; margin-top: 2px;">${idx + 1}.</div>
                            <div style="flex: 1; font-size: 12.5px; line-height: 1.5; color: var(--text-color, #1e293b); white-space: pre-wrap;">${esc(preset)}</div>
                            <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                                <button type="button" class="est-btn primary" data-insert-preset="${targetKey}" data-preset-text="${esc(preset)}" title="Insert note into estimate ${label.toLowerCase()} list" style="padding: 5px 10px; font-size: 11.5px; font-weight: 600; border-radius: 4px; cursor: pointer;">
                                    <i class="fas fa-plus"></i> Insert
                                </button>
                                <button type="button" class="est-btn secondary" data-copy-preset="${esc(preset)}" title="Copy text to clipboard" style="padding: 5px 8px; font-size: 11.5px; border-radius: 4px; cursor: pointer;">
                                    <i class="fas fa-copy"></i>
                                </button>
                                <button type="button" class="est-icon-action-btn danger" data-delete-lib-preset="${targetKey}" data-index="${idx}" title="Delete from library" style="color: #ef4444; border: none; background: transparent; cursor: pointer; padding: 5px;">
                                    <i class="fas fa-trash-can"></i>
                                </button>
                            </div>
                        </div>
                    `).join('') || `<div style="text-align: center; padding: 30px; color: #94a3b8; font-size: 13px;">No presets found matching search.</div>`}
                </div>

                <!-- Add new preset footer section -->
                <div style="padding: 12px 18px; border-top: 1px solid var(--border-color, #e2e8f0); background: var(--bg-surface-2, #f8fafc); display: flex; flex-direction: column; gap: 8px;">
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Add new preset to ${label} library</div>
                    <div style="display: flex; gap: 8px;">
                        <textarea id="newPresetTextInput" placeholder="Enter preset note text here..." rows="2" style="flex: 1; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 5px; font-size: 12.5px; line-height: 1.4; resize: vertical; box-sizing: border-box;"></textarea>
                        <button type="button" class="est-btn primary" data-save-new-preset="${targetKey}" style="align-self: flex-end; padding: 8px 14px; font-size: 12px; font-weight: 600; white-space: nowrap; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-bookmark"></i> Save
                        </button>
                    </div>
                </div>

                <div class="pd-modal-footer" style="padding: 10px 18px; border-top: 1px solid var(--border-color, #e2e8f0); display: flex; justify-content: flex-end;">
                    <button type="button" class="est-btn secondary" data-close-notes-lib style="padding: 6px 14px; border-radius: 4px; cursor: pointer;">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);
    }

    function openMarkupPopover(markupId, anchorBtn) {
        const existing = document.querySelector('.est-markup-popover');
        const wasOpenForSame = Boolean(existing && String(existing.dataset.activePopoverMarkupId) === String(markupId));
        closeMarkupPopovers();
        if (wasOpenForSame) return;
        if (!markupId || !anchorBtn) return;
        const rows = [...current().settings.preTaxMarkups, ...current().settings.postTaxMarkups];
        const markup = rows.find(m => String(m.id) === String(markupId));
        if (!markup) return;
        hideActionPopover();
        closeOptionsMenu();
        const isPreTax = (current().settings.preTaxMarkups || []).some(m => String(m.id) === String(markupId));

        anchorBtn.classList.add('is-active');
        anchorBtn.setAttribute('aria-expanded', 'true');

        const rect = anchorBtn.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.className = 'est-markup-popover';
        pop.dataset.activePopoverMarkupId = markup.id;

        // Base options
        const preBases = [
            { id: 'total_cost', label: 'Total Direct Cost' },
            { id: 'material_cost', label: 'Materials Cost' },
            { id: 'labor_cost', label: 'Labor Cost' },
            { id: 'equipment_cost', label: 'Equipment Cost' },
            { id: 'subtotal_sales', label: 'Subtotal Sales' }
        ];
        const postBases = [
            { id: 'subtotal_sales', label: 'Subtotal Sales' },
            { id: 'total_cost', label: 'Total Direct Cost' }
        ];
        const bases = isPreTax ? preBases : postBases;

        pop.innerHTML = `
            <div class="est-markup-popover-head">
                <span>Options: ${esc(markup.name)}</span>
                <button type="button" class="est-markup-popover-close" data-close-markup-popover>&times;</button>
            </div>
            <div style="display: grid; gap: 8px;">
                <label style="display: grid; gap: 3px; font-size: 11px; font-weight: 600; color: #475569;">
                    <span>Markup Name</span>
                    <input type="text" class="est-rate-inline-input" data-popover-markup-prop="name" value="${esc(markup.name)}" style="width: 100%; text-align: left; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; font-size: 12px; box-sizing: border-box;">
                </label>
                <label style="display: grid; gap: 3px; font-size: 11px; font-weight: 600; color: #475569;">
                    <span>Type</span>
                    <select data-popover-markup-prop="type" style="width: 100%; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; font-size: 12px; box-sizing: border-box;">
                        <option value="percent" ${markup.type !== 'fixed_amount' ? 'selected' : ''}>Percentage (%)</option>
                        <option value="fixed_amount" ${markup.type === 'fixed_amount' ? 'selected' : ''}>Fixed Amount ($)</option>
                    </select>
                </label>
                <label style="display: grid; gap: 3px; font-size: 11px; font-weight: 600; color: #475569;">
                    <span>Value (${markup.type === 'fixed_amount' ? '$' : '%'})</span>
                    <input type="number" step="0.1" data-popover-markup-prop="val" value="${markup.type === 'fixed_amount' ? markup.amount : markup.percent}" style="width: 100%; text-align: left; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; font-size: 12px; box-sizing: border-box;">
                </label>
                <label style="display: grid; gap: 3px; font-size: 11px; font-weight: 600; color: #475569;">
                    <span>Calculation Base</span>
                    <select data-popover-markup-prop="base" style="width: 100%; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; font-size: 12px; box-sizing: border-box;">
                        ${bases.map(b => `<option value="${b.id}" ${markup.base === b.id ? 'selected' : ''}>${b.label}</option>`).join('')}
                    </select>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #334155; cursor: pointer; margin-top: 4px;">
                    <input type="checkbox" data-popover-markup-prop="active" ${markup.active !== false ? 'checked' : ''}>
                    <span>Active in calculations</span>
                </label>
                <div style="border-top: 1px solid #f1f5f9; padding-top: 8px; margin-top: 4px;">
                    <button type="button" class="est-btn danger" data-popover-delete-markup="${markup.id}" style="width: 100%; justify-content: center; padding: 6px; font-size: 11.5px; border-radius: 4px; cursor: pointer; color: #ef4444; border: 1px solid #fca5a5; background: #fef2f2;">
                        <i class="fas fa-trash-can"></i> Delete Markup
                    </button>
                </div>
            </div>
        `;

        pop.style.position = 'fixed';
        pop.style.left = '0px';
        pop.style.top = '0px';
        pop.style.visibility = 'hidden';
        document.body.appendChild(pop);

        const btnRect = anchorBtn.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        const panelEl = anchorBtn.closest('.est-right') || document.body;
        const panelRect = panelEl.getBoundingClientRect();
        const scale = (pop.offsetWidth > 0 && popRect.width > 0) ? (popRect.width / pop.offsetWidth) : 1;

        const pad = 10;
        const viewLeft = Math.max(pad, panelRect.left + pad);
        const viewRight = Math.min(window.innerWidth - pad, panelRect.right - pad);
        const viewTop = Math.max(pad, panelRect.top + pad);
        const viewBottom = Math.min(window.innerHeight - pad, panelRect.bottom - pad);

        // Align to the left of the 3-dots button so it stays well inside .est-right
        let targetLeft = btnRect.right - popRect.width;
        if (targetLeft + popRect.width > viewRight) targetLeft = viewRight - popRect.width;
        if (targetLeft < viewLeft) targetLeft = Math.max(pad, viewLeft);

        let targetTop = btnRect.bottom + 6;
        if (targetTop + popRect.height > viewBottom) {
            targetTop = btnRect.top - popRect.height - 6;
        }
        if (targetTop < viewTop) targetTop = viewTop;
        if (targetTop + popRect.height > window.innerHeight - pad) {
            targetTop = Math.max(pad, window.innerHeight - pad - popRect.height);
        }

        pop.style.left = `${Math.round(targetLeft / scale)}px`;
        pop.style.top = `${Math.round(targetTop / scale)}px`;

        // Second-pass verification in visual coordinates to compensate for any CSS zoom offset
        const checkRect = pop.getBoundingClientRect();
        if (checkRect.right > viewRight) {
            const currentLeft = parseFloat(pop.style.left) || 0;
            pop.style.left = `${Math.round(currentLeft - (checkRect.right - viewRight) / scale)}px`;
        }
        if (checkRect.left < pad) {
            const currentLeft = parseFloat(pop.style.left) || 0;
            pop.style.left = `${Math.round(currentLeft + (pad - checkRect.left) / scale)}px`;
        }
        if (checkRect.bottom > viewBottom) {
            const currentTop = parseFloat(pop.style.top) || 0;
            pop.style.top = `${Math.round(currentTop - (checkRect.bottom - viewBottom) / scale)}px`;
        }
        if (checkRect.top < pad) {
            const currentTop = parseFloat(pop.style.top) || 0;
            pop.style.top = `${Math.round(currentTop + (pad - checkRect.top) / scale)}px`;
        }
        pop.style.visibility = 'visible';
    }
function renderFooter() {
        const bar = $('versionBar');
        if (!bar) return;
        if (Footer?.render) {
            bar.innerHTML = Footer.render({ estimates: state.estimates, activeEstimateId: state.activeEstimateId,
                selectAttribute: 'data-version', actionAttribute: 'data-estimating-action',
                menuAttribute: 'data-estimate-menu', itemActionAttribute: 'data-estimate-action',
                showCompare: false });
            Footer.bindMenus?.(bar, {
                menuAttribute: 'data-estimate-menu',
                itemActionAttribute: 'data-estimate-action',
                onAction: (action, estimateId) => {
                    handleEstimateCardAction(action, estimateId);
                }
            });
        } else {
            bar.innerHTML = state.estimates.map(row => `<button data-version="${row.id}" class="${row.id === state.activeEstimateId ? 'active' : ''}">${esc(row.name)}</button>`).join('');
        }
    }

    function renderStatus() {
        let status = root.querySelector('.est-save-status');
        if (status) {
            status.style.display = 'none';
        }
    }

    function renderModal() {
        document.querySelector('[data-estimating-modal-portal]')?.remove();
        if (!ui.modal) return;
        const portal = document.createElement('div');
        portal.dataset.estimatingModalPortal = '';
        portal.className = 'pd-modal-backdrop open';
        portal.style.cssText = 'position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); z-index: 999999;';
        if (ui.modal === 'new') {
            portal.innerHTML = `<div class="bb-create-project-modal bb-studio-modal pd-modal" style="width: min(480px, 92vw); border-radius: 12px; overflow: hidden; background: var(--bg-panel, #ffffff); border: 1px solid var(--border, #cbd5e1); box-shadow: 0 20px 60px rgba(15, 23, 42, 0.28); display: flex; flex-direction: column;" role="dialog" aria-modal="true" aria-labelledby="copyEstimateTitle">
                <div class="bb-modal-head" style="padding: 12px 18px; border-bottom: 1px solid var(--border, #e2e8f0); display: flex; align-items: center; justify-content: space-between; background: var(--bg-panel, #ffffff);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div class="bb-modal-icon-badge" style="width: 34px; height: 34px; border-radius: 8px; background: #fff7ed; border: 1px solid #fed7aa; color: #fb5a3a; display: grid; place-items: center; font-size: 15px; flex: 0 0 34px;">
                            <i class="fas fa-calculator"></i>
                        </div>
                        <div>
                            <strong id="copyEstimateTitle" class="bb-modal-heading" style="display: block; font-size: 14.5px; font-weight: 700; color: var(--text-main, #0f172a); line-height: 1.25;">New Estimate Version</strong>
                            <span class="bb-modal-subheading" style="display: block; font-size: 11.5px; color: var(--text-muted, #64748b); margin-top: 1px;">Create an independent bid estimate version for this project</span>
                        </div>
                    </div>
                    <button class="bb-icon-btn bordered" type="button" data-close-modal aria-label="Close" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border, #e2e8f0); background: transparent; cursor: pointer; color: var(--text-muted, #64748b); display: grid; place-items: center; font-size: 13px; transition: all .15s ease;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="bb-modal-body" style="padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; background: var(--bg-panel, #ffffff);">
                    <div class="bb-form-group" style="display: flex; flex-direction: column; gap: 4px;">
                        <label class="bb-form-label" for="copyEstimateName" style="font-size: 11.5px; font-weight: 600; color: var(--text-main, #0f172a); display: flex; align-items: center; gap: 4px;">
                            <span>Estimate Name</span>
                            <span style="color: #fb5a3a; font-weight: 700;">*</span>
                        </label>
                        <div class="bb-input-icon-wrap" style="position: relative; display: flex; align-items: center;">
                            <i class="fas fa-file-invoice-dollar" style="position: absolute; left: 11px; color: var(--text-muted, #94a3b8); font-size: 13px; pointer-events: none;"></i>
                            <input id="copyEstimateName" class="bb-input-control" type="text" value="${esc(current().name)} Copy" autocomplete="off" placeholder="e.g. Base Bid Copy" style="width: 100%; box-sizing: border-box; height: 35px; padding: 6px 10px 6px 33px; border: 1px solid var(--border, #cbd5e1); border-radius: 7px; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a); font-size: 12.5px; outline: none; transition: border-color .15s ease, box-shadow .15s ease;">
                        </div>
                        <div class="bb-input-hint" style="font-size: 10.5px; color: var(--text-muted, #64748b);">Unique name displayed across tabs, client summaries, and proposals.</div>
                    </div>

                    <div class="bb-form-group" style="display: flex; flex-direction: column; gap: 6px;">
                        <label class="bb-form-label" style="font-size: 11.5px; font-weight: 600; color: var(--text-main, #0f172a); display: flex; align-items: center; gap: 5px;">
                            <i class="fas fa-shapes" style="color: #fb5a3a; font-size: 12px;"></i>
                            <span>Starting Configuration</span>
                        </label>
                        <div class="bb-studio-mode-stack" style="display: flex; flex-direction: column; gap: 7px;">
                            <label class="est-copy-option bb-studio-card" style="position: relative; border: 1.5px solid var(--border, #cbd5e1); border-radius: 8px; padding: 8px 12px; background: var(--bg-panel, #ffffff); cursor: pointer; display: flex; align-items: flex-start; gap: 10px; transition: all .15s ease;">
                                <input type="radio" name="copyEstimateMode" value="all" checked style="margin-top: 2px; accent-color: #fb5a3a; width: 14px; height: 14px;">
                                <div style="flex: 1;">
                                    <div style="display: flex; align-items: center; gap: 7px;">
                                        <strong style="font-size: 12.5px; color: var(--text-main, #0f172a);">Copy everything</strong>
                                        <span style="display: inline-block; font-size: 9.5px; font-weight: 700; color: #fb5a3a; background: #fff7ed; border: 1px solid #fed7aa; padding: 1px 6px; border-radius: 999px;">Recommended</span>
                                    </div>
                                    <small style="display: block; font-size: 11px; color: var(--text-muted, #64748b); margin-top: 1px; line-height: 1.3;">Start with a complete clone of groups, items, quantities, notes, materials and markups.</small>
                                </div>
                            </label>
                            <label class="est-copy-option bb-studio-card" style="position: relative; border: 1.5px solid var(--border, #cbd5e1); border-radius: 8px; padding: 8px 12px; background: var(--bg-panel, #ffffff); cursor: pointer; display: flex; align-items: flex-start; gap: 10px; transition: all .15s ease;">
                                <input type="radio" name="copyEstimateMode" value="structure" style="margin-top: 2px; accent-color: #fb5a3a; width: 14px; height: 14px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 12.5px; color: var(--text-main, #0f172a);">Groups only</strong>
                                    <small style="display: block; font-size: 11px; color: var(--text-muted, #64748b); margin-top: 1px; line-height: 1.3;">Keep the exact group hierarchy; items from Takeoff are not automatically pre-populated.</small>
                                </div>
                            </label>
                            <label class="est-copy-option bb-studio-card" style="position: relative; border: 1.5px solid var(--border, #cbd5e1); border-radius: 8px; padding: 8px 12px; background: var(--bg-panel, #ffffff); cursor: pointer; display: flex; align-items: flex-start; gap: 10px; transition: all .15s ease;">
                                <input type="radio" name="copyEstimateMode" value="blank" style="margin-top: 2px; accent-color: #fb5a3a; width: 14px; height: 14px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 12.5px; color: var(--text-main, #0f172a);">Blank estimate</strong>
                                    <small style="display: block; font-size: 11px; color: var(--text-muted, #64748b); margin-top: 1px; line-height: 1.3;">Start with a fresh empty estimate. Ideal for value engineering alternates or custom bids.</small>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="bb-modal-foot" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 18px; border-top: 1px solid var(--border, #e2e8f0); background: var(--bg-subtle, #f8fafc);">
                    <div class="bb-modal-foot-info" style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted, #64748b);">
                        <i class="fas fa-circle-check" style="color: #16a34a; font-size: 13px;"></i>
                        <span>Independent version with separate totals</span>
                    </div>
                    <div class="bb-modal-foot-actions" style="display: flex; align-items: center; gap: 8px;">
                        <button class="bb-btn-procore-secondary" type="button" data-close-modal style="height: 32px; padding: 0 14px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; background: var(--bg-panel, #ffffff); color: var(--text-main, #334155); font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s ease;">Cancel</button>
                        <button class="bb-btn-procore-primary" type="button" data-create-estimate data-est-action="create-estimate-copy" style="height: 32px; padding: 0 16px; border: none; border-radius: 6px; background: var(--tk-primary, #fb5a3a); color: #ffffff; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(251, 90, 58, 0.3); transition: all .15s ease;">
                            <i class="fas fa-plus"></i> Create Estimate
                        </button>
                    </div>
                </div>
            </div>`;
        }
        if (ui.modal === 'export') {
            portal.innerHTML = `<div class="pd-modal" style="width: min(520px, 100%); background: var(--bg-panel, #ffffff); border: 1px solid var(--border, #cbd5e1); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); overflow: hidden; display: flex; flex-direction: column;" role="dialog" aria-modal="true" aria-labelledby="exportEstimateTitle">
                <div class="pd-modal-head" style="padding: 14px 18px; border-bottom: 1px solid var(--border, #e2e8f0); display: flex; align-items: center; justify-content: space-between; background: var(--bg-panel, #ffffff);">
                    <div>
                        <h3 id="exportEstimateTitle" style="margin: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-file-export" style="color: var(--primary, #fb5a3a);"></i> Export Estimate
                        </h3>
                        <span style="font-size: .78rem; color: var(--text-muted, #64748b); display: block; margin-top: 2px;">Download a supplier-ready bill of materials or bill of quantities</span>
                    </div>
                    <button class="pd-modal-head-close" type="button" aria-label="Close" data-close-modal style="border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--text-muted, #64748b);">&times;</button>
                </div>
                <div class="pd-modal-body" style="padding: 18px 20px; background: var(--bg-panel, #ffffff);">
                    <fieldset style="border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 12px 14px; margin: 0; display: flex; flex-direction: column; gap: 8px; background: var(--bg-card, #f8fafc);">
                        <legend style="font-size: .75rem; font-weight: 700; color: var(--text-muted, #64748b); padding: 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">Export format</legend>
                        <label class="est-copy-option" style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 8px 10px; border-radius: 6px; border: 1px solid transparent; background: transparent; transition: all 0.15s ease;">
                            <input type="radio" name="estimateExportMode" value="bom-excel" checked style="margin-top: 3px;">
                            <span><strong style="display: block; font-size: .83rem;">Bill of Materials (BOM - Excel)</strong><small style="font-size: .75rem; color: var(--text-muted, #64748b); display: block; margin-top: 2px;">Summary of all items separated by groups, with hierarchical assemblies and components formatted for Excel (.xls).</small></span>
                        </label>
                        <label class="est-copy-option" style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 8px 10px; border-radius: 6px; border: 1px solid transparent; background: transparent; transition: all 0.15s ease;">
                            <input type="radio" name="estimateExportMode" value="bom-csv" style="margin-top: 3px;">
                            <span><strong style="display: block; font-size: .83rem;">Bill of Materials (BOM - CSV)</strong><small style="font-size: .75rem; color: var(--text-muted, #64748b); display: block; margin-top: 2px;">Hierarchical BOM with group headers and assembly components as CSV.</small></span>
                        </label>
                        <label class="est-copy-option" style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 8px 10px; border-radius: 6px; border: 1px solid transparent; background: transparent; transition: all 0.15s ease;">
                            <input type="radio" name="estimateExportMode" value="normal" style="margin-top: 3px;">
                            <span><strong style="display: block; font-size: .83rem;">BOQ normal (CSV)</strong><small style="font-size: .75rem; color: var(--text-muted, #64748b); display: block; margin-top: 2px;">Export the estimate as organized, keeping assemblies as assembly rows.</small></span>
                        </label>
                        <label class="est-copy-option" style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 8px 10px; border-radius: 6px; border: 1px solid transparent; background: transparent; transition: all 0.15s ease;">
                            <input type="radio" name="estimateExportMode" value="flat" style="margin-top: 3px;">
                            <span><strong style="display: block; font-size: .83rem;">BOQ Flat (CSV)</strong><small style="font-size: .75rem; color: var(--text-muted, #64748b); display: block; margin-top: 2px;">Break assemblies into parts and consolidate the total quantity of each catalog item.</small></span>
                        </label>
                    </fieldset>
                </div>
                <div class="pd-modal-foot" style="display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--border, #e2e8f0); background: var(--bg-card, #f8fafc);">
                    <button type="button" class="btn-ghost" data-close-modal style="padding: 7px 14px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; background: transparent; cursor: pointer;">Cancel</button>
                    <button type="button" class="btn-main orange" data-download-estimate style="padding: 7px 16px; border: none; border-radius: 6px; background: var(--primary, #fb5a3a); color: #fff; font-weight: 600; cursor: pointer;"><i class="fas fa-download"></i> Export</button>
                </div>
            </div>`;
        }
        if (ui.modal === 'catalog') {
            portal.innerHTML = `<div class="pd-modal" style="width: min(580px, 100%); background: var(--bg-panel, #ffffff); border: 1px solid var(--border, #cbd5e1); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); overflow: hidden; display: flex; flex-direction: column;" role="dialog" aria-modal="true" aria-labelledby="estimateCatalogTitle">
                <div class="pd-modal-head" style="padding: 14px 18px; border-bottom: 1px solid var(--border, #e2e8f0); display: flex; align-items: center; justify-content: space-between; background: var(--bg-panel, #ffffff);">
                    <div>
                        <h3 id="estimateCatalogTitle" style="margin: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-book-open" style="color: var(--primary, #fb5a3a);"></i> Add Cost Catalog Item
                        </h3>
                        <span style="font-size: .78rem; color: var(--text-muted, #64748b); display: block; margin-top: 2px;">Select an existing catalog item for this estimate group</span>
                    </div>
                    <button class="pd-modal-head-close" type="button" aria-label="Close" data-close-modal style="border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--text-muted, #64748b);">&times;</button>
                </div>
                <div class="pd-modal-body" style="padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; background: var(--bg-panel, #ffffff);">
                    <input type="search" data-est-catalog-search placeholder="Search Cost Catalog..." autocomplete="off" style="width: 100%; box-sizing: border-box; height: 36px; padding: 6px 12px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; background: var(--bg-card, #f8fafc); color: inherit;">
                    <div data-est-catalog-results style="max-height: 320px; overflow-y: auto;">
                        ${ui.catalogLoading ? '<div class="est-empty" style="padding: 24px; text-align: center; color: var(--text-muted, #64748b);">Loading Cost Catalogâ€¦</div>' : (ui.catalogError ? `<div class="est-empty" style="padding: 24px; text-align: center; color: #ef4444;">${esc(ui.catalogError)}</div>` : renderCatalogChoices(''))}
                    </div>
                </div>
                <div class="pd-modal-foot" style="display: flex; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid var(--border, #e2e8f0); background: var(--bg-card, #f8fafc);">
                    <button type="button" class="btn-ghost" data-close-modal style="padding: 7px 16px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; background: transparent; cursor: pointer;">Cancel</button>
                </div>
            </div>`;
        }
        document.body.appendChild(portal);
        portal.querySelector('input, button')?.focus();
    }

    function createGroup() {
        const group = Workspace.group({ name: `Group ${current().groups.length + 1}`, items: [] }, current().groups.length);
        current().groups.push(group);
        changed(`Created group â€œ${group.name}â€`);
    }

    function renderCatalogChoices(query = '') {
        const rows = ui.catalogData?.items || [];
        const normalized = String(query).trim().toLowerCase();
        const visible = rows.filter(item => !normalized || [item.name, item.description, item.supplier.catalogNumber,
            item.classification.costCode, item.catalog.name, item.category.name].join(' ').toLowerCase().includes(normalized));
        return visible.map(item => `<button type="button" class="est-copy-option" data-est-catalog-item="${esc(item.id)}"><span><strong>${esc(item.name)}</strong><small>${esc(item.catalog.name || '')} Â· ${esc(item.category.name || '')} Â· ${esc(item.uom || 'ea')} Â· ${money(item.pricing.materialUnitCost || item.pricing.equipmentUnitCost || item.pricing.legacyUnitCost || 0)}</small></span></button>`).join('')
            || '<div class="est-empty">No catalog items found.</div>';
    }

    async function addItem(groupId) {
        if (!current().groups.some(row => row.id === groupId)) return;
        ui.catalogTargetGroupId = groupId;
        ui.catalogLoading = true; ui.catalogError = ''; ui.modal = 'catalog'; renderModal();
        try {
            ui.catalogData = await window.CatalogService.getSnapshot({ enabledForProjectsOnly: true });
        } catch (error) { ui.catalogError = error.message; }
        ui.catalogLoading = false; renderModal();
    }

    function catalogEstimateItem(catalog) {
        const itemsById = new Map((ui.catalogData?.items || []).map(item => [String(item.id), item]));
        return window.EstimatingCatalogAdapter.catalogItemDtoToEstimatingItem(catalog, {
            itemsById,
            globalLaborRate: current().settings.globalLaborCost,
            workspaceItem: Workspace.item
        });
    }

    async function exportEstimate(mode = 'bom-excel') {
        if (!Exporter) return;
        let estimate = Workspace.clone(current());
        if ((mode === 'flat' || mode === 'bom-excel' || mode === 'bom-csv') && Exporter.needsCatalog(estimate)) {
            try {
                const catalogSnapshot = await window.CatalogService.getSnapshot({ enabledForProjectsOnly: true });
                estimate = window.BoqCatalogAdapter.hydrateEstimate(estimate, catalogSnapshot);
            } catch (error) {
                console.warn('Could not hydrate estimate from catalog snapshot:', error);
                if (mode === 'flat') {
                    alert(`BOQ Flat could not load the Cost Catalog: ${error.message}`);
                    return;
                }
            }
        }
        if (mode === 'flat') {
            const unresolved = Exporter.unresolvedAssemblies(estimate);
            if (unresolved.length) {
                alert(`BOQ Flat cannot expand these assemblies because they have no Cost Catalog components: ${unresolved.map(item => item.name).join(', ')}`);
                return;
            }
        }

        const safeName = current().name.replace(/[^a-z0-9_-]+/gi, '_');

        if (mode === 'bom-excel') {
            const xml = Exporter.excelXml(estimate, current().settings);
            const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
            const anchor = document.createElement('a');
            anchor.href = URL.createObjectURL(blob);
            anchor.download = `${safeName}_BOM.xls`;
            anchor.click();
            URL.revokeObjectURL(anchor.href);
            return;
        }

        if (mode === 'bom-csv') {
            const rows = Exporter.bomRows(estimate, current().settings);
            const blob = new Blob([Exporter.bomCsv(rows)], { type: 'text/csv;charset=utf-8' });
            const anchor = document.createElement('a');
            anchor.href = URL.createObjectURL(blob);
            anchor.download = `${safeName}_BOM.csv`;
            anchor.click();
            URL.revokeObjectURL(anchor.href);
            return;
        }

        const rows = mode === 'flat' ? Exporter.flatRows(estimate) : Exporter.normalRows(estimate);
        const blob = new Blob([Exporter.csv(rows)], { type: 'text/csv;charset=utf-8' });
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = `${safeName}_${mode === 'flat' ? 'BOQ_Flat' : 'BOQ'}.csv`;
        anchor.click();
        URL.revokeObjectURL(anchor.href);
    }

    root.addEventListener('input', event => {
        if (event.target.id === 'estSearch') { ui.search = event.target.value; renderTable(); return; }
        const estimate = current();
        const itemRow = event.target.closest('[data-item-id]');
        const itemField = event.target.dataset.itemField;
        if (itemRow && itemField && event.target.type === 'number') {
            const found = findItem(itemRow.dataset.itemId);
            if (!found) return;
            const catalogFields = {
                unitMaterialCost: 'materialUnitCost',
                unitEquipmentCost: 'equipmentUnitCost',
                unitSubcontractorCost: 'subcontractorUnitCost',
                unitLabor: 'laborHoursPerUnit',
                laborRate: 'laborRate'
            };
            if (itemField === 'quantity') {
                if (found.item.takeoffLayerId && (found.item.lastSyncedTakeoffQuantity === undefined || found.item.lastSyncedTakeoffQuantity === null)) {
                    found.item.lastSyncedTakeoffQuantity = Workspace.numeric(found.item.originalQuantity ?? found.item.quantity);
                }
                found.item.quantity = Workspace.numeric(event.target.value);
                found.item.quantityOverride = true;
                found.item.quantitySyncStatus = 'overridden';
                found.item.pendingTakeoffQuantity = Workspace.numeric(found.item.lastSyncedTakeoffQuantity ?? found.item.originalQuantity ?? 0);
                event.target.classList.add('is-qty-overridden');
            } else if (found.item.catalogSnapshot && catalogFields[itemField]
                && window.EstimatingCatalogSnapshotService) {
                window.EstimatingCatalogSnapshotService.setCatalogOverride(found.item,
                    catalogFields[itemField], Workspace.numeric(event.target.value));
            } else {
                found.item[itemField] = Workspace.numeric(event.target.value);
            }
            found.item.updatedAt = Workspace.now();
            reactiveChanged(event.target);
            if (itemField === 'quantity' && isAssemblyItem(found.item) && ui.expandedAssemblies.has(String(found.item.id))) {
                renderPreservingInput(event.target);
            }
            return;
        }
        if (event.target.dataset.summaryRate) {
            const field = event.target.dataset.summaryRate;
            const val = Workspace.numeric(event.target.value);
            applySummaryRateSetting(estimate, field, val);
            reactiveChanged(event.target);
            renderTable();
            return;
        }
        if (event.target.dataset.summaryType) {
            const type = event.target.dataset.summaryType;
            const field = event.target.dataset.field;
            const val = Workspace.numeric(event.target.value);
            applySummaryCategorySetting(estimate, type, field, val);
            reactiveChanged(event.target);
            renderTable();
            return;
        }
        if (event.target.dataset.markupQuickVal) {
            const mId = event.target.dataset.markupQuickVal;
            const rows = [...current().settings.preTaxMarkups, ...current().settings.postTaxMarkups];
            const row = rows.find(candidate => candidate.id === mId);
            if (row) {
                const val = Workspace.numeric(event.target.value);
                if (row.type === 'fixed_amount') row.amount = val;
                else row.percent = val;
                reactiveChanged(event.target);
            }
            return;
        }
        if (event.target.classList.contains('est-note-auto-textarea')) {
            const tx = event.target;
            tx.style.height = 'auto';
            const h = Math.min(180, Math.max(38, tx.scrollHeight));
            tx.style.height = `${h}px`;
            tx.style.overflowY = tx.scrollHeight > 180 ? 'auto' : 'hidden';
        }
        if (event.target.classList.contains('est-rich-editor-box')) {
            const field = event.target.dataset.noteField;
            if (field) {
                estimate.notes[field] = event.target.innerHTML;
                estimate.updatedAt = Workspace.now();
                saveLocal({ publish: false });
                scheduleSave();
                return;
            }
        }
        if (event.target.dataset.setting) {
            estimate.settings[event.target.dataset.setting] = Workspace.numeric(event.target.value);
            reactiveChanged(event.target);
            return;
        }
        if (event.target.dataset.tax) {
            estimate.settings.taxes[event.target.dataset.tax] = Workspace.numeric(event.target.value);
            reactiveChanged(event.target);
            return;
        }
        if (event.target.dataset.markupValue) {
            updateMarkupValue(event.target);
            reactiveChanged(event.target);
            return;
        }
        if (event.target.dataset.noteField) {
            estimate.notes[event.target.dataset.noteField] = event.target.value;
            estimate.updatedAt = Workspace.now();
            saveLocal({ publish: false });
            scheduleSave();
            return;
        }
        if (event.target.dataset.noteList) {
            estimate.notes[event.target.dataset.noteList][Number(event.target.dataset.index)] = event.target.value;
            estimate.updatedAt = Workspace.now();
            saveLocal({ publish: false });
            scheduleSave();
        }
    });

    function forEachEstimateItem(estimate, callback) {
        const visit = items => {
            (items || []).forEach(it => {
                callback(it);
                if (Array.isArray(it.children) && it.children.length) visit(it.children);
                if (Array.isArray(it.assemblyItems) && it.assemblyItems.length) visit(it.assemblyItems);
            });
        };
        (estimate?.groups || []).forEach(g => visit(g.items));
    }

    function applySummaryRateSetting(estimate, field, val) {
        if (!estimate?.settings) return;
        if (field === 'globalLaborCost') {
            estimate.settings.globalLaborCost = val;
            forEachEstimateItem(estimate, it => {
                it.laborRate = val;
                if (it.catalogSnapshot && window.EstimatingCatalogSnapshotService) {
                    window.EstimatingCatalogSnapshotService.setCatalogOverride(it, 'laborRate', val);
                }
            });
        } else if (field === 'globalLaborSales') {
            const cost = Number(estimate.settings.globalLaborCost ?? 36);
            if (val > 0) {
                const margin = val > cost ? ((1 - cost / val) * 100) : 0;
                const clamped = Math.min(99.9, Math.max(0, margin));
                estimate.settings.globalLaborSales = val;
                estimate.settings.globalLaborMargin = clamped;
                forEachEstimateItem(estimate, it => {
                    it.laborMargin = clamped;
                    if (it.itemType === 'labor' || it.type === 'labor') it.margin = clamped;
                });
            }
        }
    }

    function applySummaryCategorySetting(estimate, type, field, val) {
        if (!estimate?.settings) return;
        if (field === 'margin') {
            const clamped = Math.min(99.9, Math.max(-999, val));
            if (type === 'Labor') {
                estimate.settings.globalLaborMargin = clamped;
                forEachEstimateItem(estimate, it => {
                    it.laborMargin = clamped;
                    if (it.itemType === 'labor' || it.type === 'labor') it.margin = clamped;
                });
            } else if (type === 'Materials') {
                estimate.settings.materialMargin = clamped;
                forEachEstimateItem(estimate, it => {
                    it.materialMargin = clamped;
                    if (it.itemType === 'material' || it.type === 'material' || (!it.itemType && !it.type)) it.margin = clamped;
                });
            } else if (type === 'Equipment') {
                estimate.settings.equipmentMargin = clamped;
                forEachEstimateItem(estimate, it => {
                    it.equipmentMargin = clamped;
                });
            }
        } else if (field === 'waste') {
            const clamped = Math.max(0, val);
            if (type === 'Materials') {
                estimate.settings.materialWaste = clamped;
                forEachEstimateItem(estimate, it => {
                    it.waste = clamped;
                });
            } else if (type === 'Labor') {
                estimate.settings.laborWaste = clamped;
            } else if (type === 'Equipment') {
                estimate.settings.equipmentWaste = clamped;
            }
        } else if (field === 'difficulty') {
            const clamped = Math.max(0.1, val);
            estimate.settings.laborDifficulty = clamped;
            forEachEstimateItem(estimate, it => {
                it.difficulty = clamped;
            });
        }
    }

    function getAuditPrevValue(target) {
        if (!target) return '';
        if (target.dataset.auditPrevValue !== undefined) return target.dataset.auditPrevValue;
        return target.defaultValue ?? '';
    }

    function commitAuditPrevValue(target) {
        if (target && target.dataset) {
            target.dataset.auditPrevValue = target.value;
        }
    }

    function formatAuditVal(val, kind = 'number', uom = '') {
        const num = Workspace.numeric(val);
        if (kind === 'money') return money(num);
        if (kind === 'rate_hr') return `${money(num)}/hr`;
        if (kind === 'percent') return `${number(num, 1)}%`;
        if (kind === 'multiplier') return `${number(num, 2)}x`;
        if (kind === 'qty') return uom ? `${number(num, 2)} ${uom}` : number(num, 2);
        return number(num, 2);
    }

    document.addEventListener('focusin', event => {
        const target = event.target;
        if (!target || !target.matches?.('input')) return;
        if (root.contains(target) || target.closest('.est-markup-popover')) {
            if (target.dataset.auditPrevValue === undefined) {
                target.dataset.auditPrevValue = target.value;
            }
        }
    });

    root.addEventListener('change', event => {
        const row = event.target.closest('[data-item-id]');
        const field = event.target.dataset.itemField;
        if (row && field) {
            const found = findItem(row.dataset.itemId);
            if (!found) return;
            const prevRaw = getAuditPrevValue(event.target);
            const nextRaw = event.target.value;
            const catalogFields = {
                unitMaterialCost: 'materialUnitCost', unitEquipmentCost: 'equipmentUnitCost',
                unitSubcontractorCost: 'subcontractorUnitCost', unitLabor: 'laborHoursPerUnit', laborRate: 'laborRate'
            };
            if (event.target.type === 'number' && found.item.catalogSnapshot && catalogFields[field]
                && window.EstimatingCatalogSnapshotService) {
                const parsedVal = Number(event.target.value);
                window.EstimatingCatalogSnapshotService.setCatalogOverride(found.item,
                    catalogFields[field], parsedVal);
                if (!isNaN(parsedVal)) event.target.value = parsedVal.toFixed(2);
            } else {
                const parsedVal = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
                if (field === 'quantity') {
                    if (found.item.takeoffLayerId && (found.item.lastSyncedTakeoffQuantity === undefined || found.item.lastSyncedTakeoffQuantity === null)) {
                        found.item.lastSyncedTakeoffQuantity = Workspace.numeric(found.item.originalQuantity ?? prevRaw);
                    }
                    found.item.quantityOverride = true;
                    found.item.quantitySyncStatus = 'overridden';
                    found.item.pendingTakeoffQuantity = Workspace.numeric(found.item.lastSyncedTakeoffQuantity ?? found.item.originalQuantity ?? 0);
                }
                found.item[field] = parsedVal;
                if (event.target.type === 'number' && !isNaN(parsedVal)) event.target.value = parsedVal.toFixed(2);
            }
            found.item.updatedAt = Workspace.now();
            const fieldMeta = {
                quantity: { label: 'Quantity', kind: 'qty' },
                unitMaterialCost: { label: 'Unit Cost', kind: 'money' },
                unitEquipmentCost: { label: 'Equipment Cost', kind: 'money' },
                unitSubcontractorCost: { label: 'Subcontractor Cost', kind: 'money' },
                waste: { label: 'Waste', kind: 'percent' },
                materialMargin: { label: 'Margin', kind: 'percent' },
                equipmentMargin: { label: 'Equipment Margin', kind: 'percent' },
                laborMargin: { label: 'Labor Margin', kind: 'percent' },
                unitLabor: { label: 'Unit Labor', kind: 'number' },
                laborRate: { label: 'Labor Rate', kind: 'rate_hr' },
                difficulty: { label: 'Difficulty Factor', kind: 'multiplier' }
            }[field] || { label: field, kind: 'number' };
            const oldFmt = formatAuditVal(prevRaw, fieldMeta.kind, found.item.uom);
            const newFmt = formatAuditVal(nextRaw, fieldMeta.kind, found.item.uom);
            commitAuditPrevValue(event.target);
            changed(`Updated ${fieldMeta.label} for "${found.item.name}" (${oldFmt} -> ${newFmt})`);
            return;
        }
        if (event.target.matches('[data-item-check]')) {
            const itemIdStr = String(event.target.dataset.itemCheck);
            if (event.target.checked) {
                ui.selected.add(itemIdStr);
            } else {
                ui.selected.delete(itemIdStr);
                ui.selected.delete(Number(itemIdStr));
            }
            renderTable();
            return;
        }
        if (event.target.matches('[data-group-check]')) {
            const grpId = String(event.target.dataset.groupCheck);
            const grp = current().groups.find(g => String(g.id) === grpId);
            if (grp) {
                const shouldCheck = event.target.checked;
                (grp.items || []).forEach(it => {
                    const idStr = String(it.id);
                    if (shouldCheck) {
                        ui.selected.add(idStr);
                    } else {
                        ui.selected.delete(idStr);
                        ui.selected.delete(it.id);
                    }
                });
                renderTable();
            }
            return;
        }
        if (event.target.matches('[data-select-all]')) {
            const shouldCheck = event.target.checked;
            if (shouldCheck) {
                ui.selected = new Set(allItems().map(row => String(row.item.id)));
            } else {
                ui.selected.clear();
            }
            renderTable();
            return;
        }
        if (event.target.dataset.summaryRate) {
            const field = event.target.dataset.summaryRate;
            const prevRaw = getAuditPrevValue(event.target);
            const val = Workspace.numeric(event.target.value);
            applySummaryRateSetting(current(), field, val);
            const oldFmt = formatAuditVal(prevRaw, 'rate_hr');
            const newFmt = formatAuditVal(val, 'rate_hr');
            commitAuditPrevValue(event.target);
            const label = field === 'globalLaborCost' ? 'Global Labor Cost' : 'Global Labor Sales Rate';
            changed(`Updated ${label} (${oldFmt} -> ${newFmt})`);
            return;
        }
        if (event.target.dataset.summaryType) {
            const type = event.target.dataset.summaryType;
            const field = event.target.dataset.field;
            const prevRaw = getAuditPrevValue(event.target);
            const val = Workspace.numeric(event.target.value);
            applySummaryCategorySetting(current(), type, field, val);
            const kind = field === 'difficulty' ? 'multiplier' : 'percent';
            const oldFmt = formatAuditVal(prevRaw, kind);
            const newFmt = formatAuditVal(val, kind);
            commitAuditPrevValue(event.target);
            const fieldLabel = field === 'margin' ? 'Margin' : (field === 'waste' ? 'Waste' : 'Difficulty Factor');
            changed(`Updated ${type} ${fieldLabel} (${oldFmt} -> ${newFmt})`);
            return;
        }
        if (event.target.dataset.markupQuickVal) {
            const mId = event.target.dataset.markupQuickVal;
            const rows = [...(current().settings.preTaxMarkups || []), ...(current().settings.postTaxMarkups || [])];
            const rowObj = rows.find(candidate => String(candidate.id) === String(mId));
            const prevRaw = getAuditPrevValue(event.target);
            const val = Workspace.numeric(event.target.value);
            const kind = rowObj?.type === 'fixed_amount' ? 'money' : 'percent';
            const oldFmt = formatAuditVal(prevRaw, kind);
            const newFmt = formatAuditVal(val, kind);
            commitAuditPrevValue(event.target);
            changed(`Updated "${rowObj?.name || 'Markup'}" (${oldFmt} -> ${newFmt})`);
            return;
        }
        const estimate = current();
        if (event.target.dataset.noteField) { estimate.notes[event.target.dataset.noteField] = event.target.value; changed('Updated notes'); return; }
        if (event.target.dataset.noteList) { estimate.notes[event.target.dataset.noteList][Number(event.target.dataset.index)] = event.target.value; changed('Updated notes'); return; }
        if (event.target.dataset.setting) {
            const prevRaw = getAuditPrevValue(event.target);
            const val = Number(event.target.value);
            estimate.settings[event.target.dataset.setting] = val;
            commitAuditPrevValue(event.target);
            changed(`Updated ${event.target.dataset.setting} (${number(prevRaw, 2)} -> ${number(val, 2)})`);
            return;
        }
        if (event.target.dataset.tax) {
            const taxType = event.target.dataset.tax;
            const prevRaw = getAuditPrevValue(event.target);
            const val = Number(event.target.value);
            estimate.settings.taxes[taxType] = val;
            commitAuditPrevValue(event.target);
            changed(`Updated ${taxType} Tax (${formatAuditVal(prevRaw, 'percent')} -> ${formatAuditVal(val, 'percent')})`);
            return;
        }
        updateMarkup(event.target);
    });

    root.addEventListener('focusout', event => {
        if (event.target && event.target.dataset && event.target.dataset.itemField) {
            const num = parseFloat(event.target.value);
            if (!isNaN(num)) {
                event.target.value = num.toFixed(2);
            }
        }
    });

    function updateMarkup(target) {
        const id = target.dataset.markupName || target.dataset.markupType || target.dataset.markupValue;
        if (!id) return;
        const rows = [...current().settings.preTaxMarkups, ...current().settings.postTaxMarkups];
        const row = rows.find(candidate => candidate.id === id);
        if (!row) return;
        if (target.dataset.markupName) row.name = target.value;
        if (target.dataset.markupType) row.type = target.value;
        if (target.dataset.markupBase) row.base = target.value;
        if (target.dataset.markupActive) row.active = target.checked;
        if (target.dataset.markupValue) row[row.type === 'fixed_amount' ? 'amount' : 'percent'] = Workspace.numeric(target.value);
        changed('Updated markup');
    }

    function updateMarkupValue(target) {
        const rows = [...current().settings.preTaxMarkups, ...current().settings.postTaxMarkups];
        const row = rows.find(candidate => candidate.id === target.dataset.markupValue);
        if (row) row[row.type === 'fixed_amount' ? 'amount' : 'percent'] = Workspace.numeric(target.value);
    }

    function confirmEstimateDeletion(message) {
        if (typeof window.showConfirmDialog === 'function') {
            return window.showConfirmDialog({
                title: 'Delete Estimate',
                message: message,
                confirmText: 'Delete Estimate',
                cancelText: 'Cancel',
                primaryDanger: true,
                badge: 'CONFIRM DELETION',
                icon: 'fas fa-trash'
            });
        }
        return new Promise(resolve => {
            document.querySelector('[data-estimate-delete-confirm]')?.remove();
            const portal = document.createElement('div');
            portal.className = 'pd-modal-backdrop open';
            portal.dataset.estimateDeleteConfirm = 'true';
            portal.style.cssText = 'position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); z-index: 999999;';
            portal.innerHTML = `<div class="pd-modal" style="width: min(460px, 100%); background: var(--bg-panel, #ffffff); border: 1px solid var(--border, #cbd5e1); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); overflow: hidden; display: flex; flex-direction: column;" role="dialog" aria-modal="true" aria-labelledby="deleteEstimateTitle">
                <div class="pd-modal-head" style="padding: 14px 18px; border-bottom: 1px solid var(--border, #e2e8f0); display: flex; align-items: center; justify-content: space-between; background: var(--bg-panel, #ffffff);">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-trash-can" style="color: #ef4444; font-size: 1.1rem;"></i>
                        <h3 id="deleteEstimateTitle" style="margin: 0; font-size: 1.05rem; font-weight: 600;">Delete Estimate</h3>
                    </div>
                    <button class="pd-modal-head-close" type="button" data-delete-cancel aria-label="Close" style="border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--text-muted, #64748b);">&times;</button>
                </div>
                <div class="pd-modal-body" style="padding: 18px 20px; font-size: .88rem; color: var(--text-main, #334155); line-height: 1.5; background: var(--bg-panel, #ffffff);">
                    <p style="margin: 0 0 10px;">${esc(message)}</p>
                    <div style="background: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444; padding: 8px 12px; border-radius: 4px; font-size: .8rem; color: #b91c1c;">
                        <strong>Warning:</strong> This action is permanent and cannot be undone.
                    </div>
                </div>
                <div class="pd-modal-foot" style="display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--border, #e2e8f0); background: var(--bg-card, #f8fafc);">
                    <button type="button" class="btn-ghost" data-delete-cancel style="padding: 7px 14px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; background: transparent; cursor: pointer;">Cancel</button>
                    <button type="button" class="btn-main" data-delete-confirm style="padding: 7px 16px; border: none; border-radius: 6px; background: #ef4444; color: #fff; font-weight: 600; cursor: pointer;"><i class="fas fa-trash"></i> Delete Estimate</button>
                </div>
            </div>`;
            const finish = value => { portal.remove(); resolve(value); };
            portal.addEventListener('click', event => {
                if (event.target === portal || event.target.closest('[data-delete-cancel]')) finish(false);
                if (event.target.closest('[data-delete-confirm]')) finish(true);
            });
            document.body.appendChild(portal);
            portal.querySelector('[data-delete-confirm]')?.focus();
        });
    }


    async function deleteEstimateAuthoritative(estimateId = state.activeEstimateId, confirmed = false) {
        const requestedId = String(estimateId || '');
        if (!requestedId || deletingEstimateIds.has(requestedId)) return;

        let estimate = state.estimates.find(row => String(row.id) === requestedId);
        if (!estimate && projectId) {
            try {
                const latest = await request('list');
                state = applyDeletedEstimateTombstones(Workspace.workspace(latest.state || {}, projectId));
                restoreDirtyTracking();
                saveLocal();
                render();
                estimate = state.estimates.find(row => String(row.id) === requestedId);
            } catch (error) {
                ui.loadState = 'error';
                ui.message = `Could not refresh estimates: ${error.message}`;
                renderStatus();
                return;
            }
            if (!estimate) {
                ui.loadState = 'saved';
                ui.message = 'That estimate was already removed.';
                renderStatus();
                return;
            }
        }
        if (!estimate) return;
        if (state.estimates.length <= 1) {
            alert('At least one estimate must remain in the project.');
            return;
        }

        const original = String(state.estimates[0]?.id || '') === requestedId
            || String(estimate.creationMode || '') === 'primary';
        const message = original
            ? `WARNING: "${estimate.name}" is the original estimate. Its Takeoff data will also be permanently removed. Delete it?`
            : `Delete "${estimate.name}"? This will also delete its Takeoff items and cannot be undone.`;
        if (!confirmed && !(await confirmEstimateDeletion(message))) return;

        deletingEstimateIds.add(requestedId);
        const backup = Workspace.clone(state);
        const requestedDbId = Number(estimate.dbEstimateId || 0);

        // Optimistic catalog removal is intentional: all three footers consume
        // this one published state and the stale card becomes non-actionable
        // immediately. A failed server transaction restores the exact backup.
        state.deletedEstimateIds = [...new Set([...(state.deletedEstimateIds || []), requestedId])].sort();
        state.estimates = state.estimates.filter(row => String(row.id) !== requestedId);
        if (!state.estimates.some(row => String(row.id) === String(state.activeEstimateId))) {
            state.activeEstimateId = state.estimates[0]?.id || null;
        }
        if (state.estimates.length) Workspace.selectEstimate(state, state.activeEstimateId);
        dirtyEstimateIds.delete(requestedId);
        dirtyGenerations.delete(requestedId);
        takeoffSyncDirtyIds.delete(requestedId);
        conflictedEstimateIds.delete(requestedId);
        conflictRemoteEstimates.delete(requestedId);
        clearTimeout(ui.saveTimer);
        ui.saveRequested = false;
        ui.loadState = 'saving';
        ui.message = 'Deleting estimate...';
        saveLocal();
        render();

        try {
            // A request already in flight may contain the target. Wait for that
            // one request only; never start a save/delete recursion.
            const waitStarted = Date.now();
            while (ui.saving && Date.now() - waitStarted < 15000) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (ui.saving) throw new Error('The current save did not finish in time.');

            let ack = { success: true, state };
            if (projectId) {
                ack = await request('delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete', project_id: projectId,
                        estimate_id: requestedDbId, client_estimate_id: requestedId,
                        delete_original: original }) });
            }
            const acknowledgedId = String(ack?.deleted?.clientEstimateId || ack?.clientEstimateId || requestedId);
            const localDrafts = state.estimates.filter(row => !Number(row.dbEstimateId || 0)
                && String(row.id) !== requestedId && String(row.id) !== acknowledgedId);
            const authoritative = Workspace.workspace(ack?.state || state, projectId);
            const serverIds = new Set(authoritative.estimates.map(row => String(row.id)));
            localDrafts.forEach(row => { if (!serverIds.has(String(row.id))) authoritative.estimates.push(row); });
            state = applyDeletedEstimateTombstones(authoritative, [requestedId, acknowledgedId]);
            restoreDirtyTracking();
            saveLocal();
            render();
            ui.loadState = projectId ? 'saved' : 'local';
            ui.message = 'Estimate deleted';
            renderStatus();
        } catch (error) {
            if (!requestedDbId && ['estimate_not_found', 'last_estimate'].includes(error.code)) {
                saveLocal();
                render();
                ui.loadState = projectId ? 'saved' : 'local';
                ui.message = 'Estimate deleted';
                renderStatus();
            } else {
                state = Workspace.workspace(backup, projectId);
                restoreDirtyTracking();
                saveLocal();
                render();
                ui.loadState = 'error';
                ui.message = `Delete failed: ${error.message}`;
                renderStatus();
            }
        } finally {
            deletingEstimateIds.delete(requestedId);
        }
    }

    function handleEstimateCardAction(actionName, estimateId) {
        if (actionName === 'rename') {
            const estimate = state.estimates.find(row => String(row.id) === String(estimateId));
            if (!estimate) return;
            if (typeof window.openRenameModal === 'function') {
                window.openRenameModal({
                    title: 'Rename Estimate',
                    label: 'Estimate Name',
                    currentName: estimate.name,
                    onSave: (newName) => {
                        const name = newName?.trim();
                        if (name && name !== estimate.name) {
                            estimate.name = name;
                            estimate.updatedAt = Workspace.now();
                            estimate.auditLog.push({ id: Workspace.uid('audit'), at: estimate.updatedAt, action: 'Renamed estimate' });
                            markEstimateDirty(estimate.id);
                            saveLocal();
                            ui.saveRequested = true;
                            clearTimeout(ui.saveTimer);
                            ui.saveTimer = setTimeout(saveServer, 0);
                            render();
                            publish();
                        }
                    }
                });
            } else {
                const name = prompt('Estimate name', estimate.name);
                if (name?.trim()) {
                    estimate.name = name.trim();
                    estimate.updatedAt = Workspace.now();
                    estimate.auditLog.push({ id: Workspace.uid('audit'), at: estimate.updatedAt, action: 'Renamed estimate' });
                    markEstimateDirty(estimate.id);
                    saveLocal();
                    ui.saveRequested = true;
                    clearTimeout(ui.saveTimer);
                    ui.saveTimer = setTimeout(saveServer, 0);
                    render();
                    publish();
                }
            }
        }
        if (actionName === 'copy') { selectEstimate(estimateId); ui.modal = 'new'; renderModal(); }
        if (actionName === 'delete') deleteEstimateAuthoritative(estimateId);
        if (actionName === 'set-primary') {
            state.estimates.forEach(row => {
                row.is_primary = String(row.id) === String(estimateId);
                row.isPrimary = row.is_primary;
            });
            const targetEst = state.estimates.find(row => String(row.id) === String(estimateId)) || current();
            const estSummary = Calc.calculateSummary(targetEst.groups, targetEst.settings);
            const totalSales = estSummary.estimateTotal;
            if (window.ProjectState) {
                if (!window.ProjectState.projectMeta) window.ProjectState.projectMeta = {};
                window.ProjectState.projectMeta.primary_estimate_id = estimateId;
                window.ProjectState.projectMeta.primary_estimate_total = totalSales;
                window.ProjectState.projectMeta.primary_quote_value = totalSales;
            }
            saveLocal();
            markEstimateDirty(estimateId);
            ui.saveRequested = true;
            clearTimeout(ui.saveTimer);
            ui.saveTimer = setTimeout(saveServer, 0);
            render();
            publish();
            window.dispatchEvent(new CustomEvent('takeoff:primary-estimate-changed', {
                detail: { estimateId, total: totalSales, projectId }
            }));
            if (typeof showToast === 'function') showToast(`Estimate "${targetEst.name}" set as Primary.`);
        }
        if (actionName === 'toggle-pin') {
            const targetEst = state.estimates.find(row => String(row.id) === String(estimateId));
            if (targetEst) {
                targetEst.isPinned = !targetEst.isPinned;
                if (window.ProjectState) {
                    if (!window.ProjectState.projectMeta) window.ProjectState.projectMeta = {};
                    const pinnedSet = new Set(Array.isArray(window.ProjectState.projectMeta.pinned_estimate_ids)
                        ? window.ProjectState.projectMeta.pinned_estimate_ids.map(String) : []);
                    if (targetEst.isPinned) pinnedSet.add(String(estimateId));
                    else pinnedSet.delete(String(estimateId));
                    window.ProjectState.projectMeta.pinned_estimate_ids = Array.from(pinnedSet);
                }
                saveLocal();
                render();
                publish();
                if (typeof showToast === 'function') showToast(targetEst.isPinned ? `Estimate "${targetEst.name}" pinned.` : `Estimate "${targetEst.name}" unpinned.`);
            }
        }
    }

    root.addEventListener('click', event => {
        const target = event.target;
        
        const editSqft = target.closest('[data-edit-sqft]');
        if (editSqft) {
            const currentSqft = resolveSquareFootage();
            const input = prompt('Enter project area in Square Feet (sq ft):', currentSqft > 0 ? String(currentSqft) : '');
            if (input !== null) {
                const parsed = parseFloat(String(input).replace(/[^0-9.]/g, '')) || 0;
                current().settings.squareFootage = parsed;
                if (window.ProjectState) {
                    if (!window.ProjectState.projectMeta) window.ProjectState.projectMeta = {};
                    window.ProjectState.projectMeta.square_footage = parsed > 0 ? String(parsed) : '';
                }
                const poInput = document.getElementById('poSquareFootage');
                if (poInput) poInput.value = parsed > 0 ? String(parsed) : '';
                changed(`Updated Project Square Footage (${number(currentSqft, 0)} sq ft -> ${number(parsed, 0)} sq ft)`);
            }
            return;
        }
        const browseLib = target.closest('[data-browse-library]');
        if (browseLib) {
            ui.notesLibraryModal = browseLib.dataset.browseLibrary;
            renderNotesLibraryModal();
            return;
        }
        const addMarkup = target.closest('[data-add-markup]');
        if (addMarkup) {
            const key = addMarkup.dataset.addMarkup;
            const isPre = key === 'preTaxMarkups';
            current().settings[key] = current().settings[key] || [];
            const newM = {
                id: Workspace.uid('m'),
                name: 'New Markup',
                type: 'percent',
                percent: 0,
                amount: 0,
                base: 'subtotal_sales',
                active: true
            };
            current().settings[key].push(newM);
            changed(`Added ${isPre ? 'pre-tax' : 'post-tax'} markup`);
            return;
        }
        const markupMenuBtn = target.closest('[data-markup-menu-btn]');
        if (markupMenuBtn) {
            event.stopPropagation();
            openMarkupPopover(markupMenuBtn.dataset.markupMenuBtn, markupMenuBtn);
            return;
        }
const estimateMenu = target.closest('[data-estimate-menu]');
        if (estimateMenu) {
            const id = estimateMenu.dataset.estimateMenu;
            const menu = root.querySelector(`[data-estimate-actions-menu="${selectorValue(id)}"]`);
            const opening = Boolean(menu?.hidden);
            root.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
            root.querySelectorAll('[data-estimate-menu]').forEach(row => row.setAttribute('aria-expanded', 'false'));
            if (menu && opening) {
                const margin = 10;
                const boundaryEl = estimateMenu.closest('.estimating-page, .workspace-shell, body') || document.body;
                let bounds = {
                    left: margin,
                    top: margin,
                    right: window.innerWidth - margin,
                    bottom: window.innerHeight - margin,
                    width: window.innerWidth - (margin * 2),
                    height: window.innerHeight - (margin * 2)
                };
                if (boundaryEl && boundaryEl !== document.body && boundaryEl !== document.documentElement) {
                    const bRect = boundaryEl.getBoundingClientRect();
                    bounds = {
                        left: Math.max(margin, bRect.left + margin),
                        top: Math.max(margin, bRect.top + margin),
                        right: Math.min(window.innerWidth - margin, bRect.right - margin),
                        bottom: Math.min(window.innerHeight - margin, bRect.bottom - margin),
                        width: Math.max(0, Math.min(window.innerWidth - margin, bRect.right - margin) - Math.max(margin, bRect.left + margin)),
                        height: Math.max(0, Math.min(window.innerHeight - margin, bRect.bottom - margin) - Math.max(margin, bRect.top + margin))
                    };
                }

                const rect = estimateMenu.getBoundingClientRect();
                menu.hidden = false;
                menu.style.visibility = 'hidden';
                menu.style.left = '0px';
                menu.style.top = '0px';
                menu.style.bottom = 'auto';
                menu.style.right = 'auto';

                const menuRect = menu.getBoundingClientRect();
                const menuW = menuRect.width || menu.offsetWidth || 180;
                const menuH = menuRect.height || menu.offsetHeight || 190;

                const midX = bounds.left + (bounds.width / 2);
                let left = (rect.left + menuW > bounds.right || rect.left > midX)
                    ? (rect.right - menuW)
                    : rect.left;

                if (left + menuW > bounds.right) {
                    left = bounds.right - menuW;
                }
                if (left < bounds.left) {
                    left = bounds.left;
                }

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
                estimateMenu.setAttribute('aria-expanded', 'true');
            }
            return;
        }
        const estimateAction = target.closest('[data-estimate-action]');
        if (estimateAction) {
            const estimateId = estimateAction.dataset.estimateId;
            const actionName = estimateAction.dataset.estimateAction;
            root.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
            handleEstimateCardAction(actionName, estimateId);
            return;
        }
        if (target.closest('[data-drawer-close]') || target.closest('[data-drawer-cancel]')) {
            closeTableSettings();
            return;
        }
        if (target.closest('[data-drawer-save]')) {
            const drawer = $('estTableSettingsDrawer');
            if (drawer) {
                const checked = new Set();
                drawer.querySelectorAll('input[data-col-switch]:checked').forEach(input => {
                    checked.add(input.dataset.colSwitch);
                });
                const applyAll = $('estApplyAllEstimates')?.checked || false;
                saveVisibleColumns(checked, applyAll);
                closeTableSettings();
                renderTable();
            }
            return;
        }
        const groupMenuBtn = target.closest('[data-group-menu-btn]');
        if (groupMenuBtn) {
            event.stopPropagation();
            openGroupMenu(groupMenuBtn.dataset.groupMenuBtn, groupMenuBtn);
            return;
        }
        const itemMenuBtn = target.closest('[data-item-menu-btn]');
        if (itemMenuBtn) {
            event.stopPropagation();
            openItemMenu(itemMenuBtn.dataset.itemMenuBtn, itemMenuBtn);
            return;
        }
        const popGroupAction = target.closest('[data-popover-group-action]');
        if (popGroupAction) {
            const act = popGroupAction.dataset.popoverGroupAction;
            const grpId = popGroupAction.dataset.groupId;
            hideActionPopover();
            if (act === 'create-item') {
                addItem(grpId);
            } else if (act === 'reset-quantity') {
                const grp = current().groups.find(g => g.id === grpId);
                if (grp) {
                    grp.items.forEach(item => {
                        item.quantity = item.takeoffLayerId ? Workspace.numeric(item.lastSyncedTakeoffQuantity ?? item.originalQuantity) : Workspace.numeric(item.originalQuantity);
                        item.quantityOverride = false;
                        item.pendingTakeoffQuantity = null;
                        item.quantitySyncStatus = item.takeoffLayerId ? 'synced' : 'manual';
                    });
                    changed(`Reset quantities for group "${grp.name}"`);
                }
            } else if (act === 'rename-group') {
                const input = root.querySelector(`input[data-group-name="${selectorValue(grpId)}"]`);
                input?.focus();
                input?.select();
            } else if (act === 'copy-group') {
                const grp = current().groups.find(g => g.id === grpId);
                if (grp) {
                    const copy = Workspace.clone(grp);
                    copy.id = Workspace.uid('group');
                    copy.name = `${grp.name} (Copy)`;
                    copy.items = (grp.items || []).map(it => {
                        const itemCopy = Workspace.clone(it);
                        itemCopy.id = Workspace.uid('item');
                        return itemCopy;
                    });
                    const idx = current().groups.indexOf(grp);
                    current().groups.splice(idx + 1, 0, copy);
                    changed(`Copied ${grp.name}`);
                }
            } else if (act === 'export-bom') {
                exportEstimate('bom-excel');
            } else if (act === 'delete-group') {
                if (confirm('Delete this group and its items?')) {
                    current().groups = current().groups.filter(row => row.id !== grpId);
                    changed('Deleted group');
                }
            }
            // Advanced actions: copy-other-est, move-other-est, copy-other-proj, move-items-to, reset-budget-codes
            // rendered in popover but not connected to backend yet
            return;
        }
        const popItemAction = target.closest('[data-popover-item-action]');
        if (popItemAction) {
            const act = popItemAction.dataset.popoverItemAction;
            const itId = popItemAction.dataset.itemId;
            hideActionPopover();
            const found = findItem(itId);
            if (act === 'edit-item') {
                const row = root.querySelector(`[data-item-id="${selectorValue(itId)}"]`);
                const input = row?.querySelector('input:not([type="checkbox"])');
                input?.focus();
            } else if (act === 'copy-item') {
                if (found) {
                    if (isAssemblyItem(found.item)) {
                        const index = found.group.items.indexOf(found.item);
                        const duplicate = duplicateAssembly(found.item);
                        found.group.items.splice(index + 1, 0, duplicate);
                        changed(`Duplicated ${found.item.name}`);
                    } else {
                        const index = found.group.items.indexOf(found.item);
                        const duplicate = Workspace.clone(found.item);
                        duplicate.id = Workspace.uid('item');
                        duplicate.name = `${found.item.name} (Copy)`;
                        found.group.items.splice(index + 1, 0, duplicate);
                        changed(`Copied ${found.item.name}`);
                    }
                }
            } else if (act === 'reset-quantity') {
                if (found) {
                    const prevQty = found.item.quantity;
                    const nextQty = found.item.takeoffLayerId
                        ? Workspace.numeric(found.item.lastSyncedTakeoffQuantity ?? found.item.originalQuantity)
                        : Workspace.numeric(found.item.originalQuantity);
                    found.item.quantity = nextQty;
                    found.item.quantityOverride = false;
                    found.item.pendingTakeoffQuantity = null;
                    found.item.quantitySyncStatus = found.item.takeoffLayerId ? 'synced' : 'manual';
                    changed(`Reset quantity for "${found.item.name}" (${formatAuditVal(prevQty, 'qty', found.item.uom)} -> ${formatAuditVal(nextQty, 'qty', found.item.uom)})`);
                }
            } else if (act === 'delete-item') {
                if (found) {
                    found.group.items = found.group.items.filter(row => row.id !== itId);
                    ui.expandedAssemblies.delete(String(itId));
                    changed(`Deleted ${found.item.name}`);
                }
            }
            // Advanced actions: replace-item, move-item, reset-budget-code
            // rendered in popover but not connected to backend yet
            return;
        }
        const action = target.closest('[data-est-action]')?.dataset.estAction;
        if (action === 'table-settings') toggleTableSettings();
        if (action === 'create-group') createGroup();
        if (action === 'delete-selected') {
            current().groups.forEach(group => {
                group.items = group.items.filter(item => {
                    if (ui.selected.has(item.id) || ui.selected.has(String(item.id))) {
                        ui.expandedAssemblies.delete(String(item.id));
                        return false;
                    }
                    return true;
                });
            });
            ui.selected.clear(); changed('Deleted selected items');
        }
        if (action === 'reset-quantities') {
            allItems().forEach(({ item }) => {
                item.quantity = item.takeoffLayerId
                    ? Workspace.numeric(item.lastSyncedTakeoffQuantity ?? item.originalQuantity)
                    : Workspace.numeric(item.originalQuantity);
                item.quantityOverride = false;
                item.pendingTakeoffQuantity = null;
                item.quantitySyncStatus = item.takeoffLayerId ? 'synced' : 'manual';
            });
            changed('Reset quantities');
        }
        if (action === 'fullscreen') document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.();
        if (action === 'options') {
            event.stopPropagation();
            const menu = $('optionsMenu');
            const btn = target.closest('[data-est-action="options"]') || $('estBtnMoreOptions');
            const willOpen = menu ? !menu.classList.contains('open') : false;
            hideActionPopover();
            closeMarkupPopovers();
            if (menu) menu.classList.toggle('open', willOpen);
            if (btn) {
                btn.classList.toggle('is-active', willOpen);
                btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            }
            return;
        }
        const option = target.closest('[data-est-option]')?.dataset.estOption;
        if (option) closeOptionsMenu();
        if (option === 'save') saveServer();
        if (option === 'copy') { ui.modal = 'new'; renderModal(); }
        if (option === 'export') { ui.modal = 'export'; renderModal(); }
        if (option === 'export-bom') exportEstimate('bom-excel');
        if (option === 'delete-estimate') deleteEstimateAuthoritative();
        if (target.closest('[data-download-estimate]')) {
            const mode = document.querySelector('[name="estimateExportMode"]:checked')?.value || 'bom-excel';
            exportEstimate(mode); ui.modal = null; renderModal();
        }
        const collapse = target.closest('[data-collapse-card]')?.dataset.collapseCard;
        if (collapse) { ui.collapsed[collapse] = !ui.collapsed[collapse]; renderDetails(); }
        const toggle = target.closest('[data-toggle-group]')?.dataset.toggleGroup;
        if (toggle) { const group = current().groups.find(row => row.id === toggle); group.expanded = !group.expanded; changed(); }
        const assemblyToggle = target.closest('[data-toggle-assembly]')?.dataset.toggleAssembly;
        if (assemblyToggle) {
            toggleAssemblyExpansion(assemblyToggle);
            return;
        }
        const add = target.closest('[data-add-item]')?.dataset.addItem;
        if (add) addItem(add);
        const deleteItem = target.closest('[data-delete-item]')?.dataset.deleteItem;
        if (deleteItem) {
            const found = findItem(deleteItem);
            found.group.items = found.group.items.filter(row => row.id !== deleteItem);
            ui.expandedAssemblies.delete(String(deleteItem));
            changed(`Deleted ${found.item.name}`);
        }
        const duplicateItem = target.closest('[data-duplicate-item]')?.dataset.duplicateItem;
        if (duplicateItem) {
            const found = findItem(duplicateItem);
            if (isAssemblyItem(found?.item)) {
                const index = found.group.items.indexOf(found.item);
                const duplicate = duplicateAssembly(found.item);
                found.group.items.splice(index + 1, 0, duplicate);
                changed(`Duplicated ${found.item.name}`);
            }
        }
        const removeComponent = target.closest('[data-remove-assembly-component]');
        if (removeComponent) {
            const found = findItem(removeComponent.dataset.parentAssemblyId);
            if (isAssemblyItem(found?.item)) {
                const componentId = String(removeComponent.dataset.removeAssemblyComponent);
                const childIndex = (found.item.children || []).findIndex(child => String(child.id) === componentId);
                const removed = childIndex >= 0 ? found.item.children[childIndex] : null;
                found.item.children = (found.item.children || []).filter(child => String(child.id) !== componentId);
                const spliceMatching = components => {
                    if (!Array.isArray(components)) return;
                    const matchIndex = removed?.assemblyComponentId !== null && removed?.assemblyComponentId !== undefined
                        ? components.findIndex(component => String(component.id ?? '') === String(removed.assemblyComponentId))
                        : (removed?.catalogItemId !== null && removed?.catalogItemId !== undefined
                            ? components.findIndex(c => String(c.catalogItemId ?? c.part_catalog_item_id ?? '') === String(removed.catalogItemId))
                            : childIndex);
                    if (matchIndex >= 0) components.splice(matchIndex, 1);
                };
                if (found.item.catalogSnapshot?.assemblyComponents) {
                    spliceMatching(found.item.catalogSnapshot.assemblyComponents);
                }
                if (found.item.catalogMetadata?.assemblyComponents) {
                    spliceMatching(found.item.catalogMetadata.assemblyComponents);
                }
                changed(`Removed assembly component from ${found.item.name}`);
            }
        }
        const deleteGroup = target.closest('[data-delete-group]')?.dataset.deleteGroup;
        if (deleteGroup && confirm('Delete this group and its items?')) { current().groups = current().groups.filter(row => row.id !== deleteGroup); changed('Deleted group'); }
        const toggleExclusions = target.closest('[data-toggle-exclusion-presets]');
        if (toggleExclusions) {
            ui.showingExclusionPresets = !ui.showingExclusionPresets;
            renderDetails();
            return;
        }
        const deletePresetBtn = target.closest('[data-delete-exclusion-preset]');
        if (deletePresetBtn) {
            event.stopPropagation();
            const idx = Number(deletePresetBtn.dataset.deleteExclusionPreset);
            deleteExclusionPreset(idx);
            renderDetails();
            return;
        }
        const applyPresetBtn = target.closest('[data-apply-exclusion-preset]');
        if (applyPresetBtn) {
            const presetVal = applyPresetBtn.dataset.applyExclusionPreset;
            if (presetVal) {
                if (!current().notes.excluded) current().notes.excluded = [];
                if (!current().notes.excluded.includes(presetVal)) {
                    if (current().notes.excluded.length === 1 && !current().notes.excluded[0].trim()) {
                        current().notes.excluded[0] = presetVal;
                    } else {
                        current().notes.excluded.push(presetVal);
                    }
                    changed('Added exclusion from preset');
                }
            }
            return;
        }
        const saveAsPresetBtn = target.closest('[data-save-as-exclusion-preset]');
        if (saveAsPresetBtn) {
            const idx = Number(saveAsPresetBtn.dataset.saveAsExclusionPreset);
            const val = current().notes.excluded?.[idx];
            if (val && val.trim()) {
                addExclusionPreset(val.trim());
                ui.showingExclusionPresets = true;
                renderDetails();
            }
            return;
        }
        const addRow = target.closest('[data-add-note-row]')?.dataset.addNoteRow;
        if (addRow) { current().notes[addRow].push(''); changed(`Added ${addRow} note`); }
        const removeRow = target.closest('[data-remove-note-row]');
        if (removeRow) { current().notes[removeRow.dataset.removeNoteRow].splice(Number(removeRow.dataset.index), 1); changed('Removed note'); }

        const deleteMarkup = target.closest('[data-delete-markup]')?.dataset.deleteMarkup;
        if (deleteMarkup) { ['preTaxMarkups', 'postTaxMarkups'].forEach(key => { current().settings[key] = current().settings[key].filter(row => row.id !== deleteMarkup); }); changed('Deleted markup'); }
        if (target.closest('[data-audit-clear]') && confirm('Clear audit history?')) { current().auditLog = []; changed(); }
        if (target.closest('[data-audit-export]')) {
            const blob = new Blob([JSON.stringify(current().auditLog, null, 2)], { type: 'application/json' });
            const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = 'estimate-audit.json'; anchor.click(); URL.revokeObjectURL(anchor.href);
        }
        const version = target.closest('[data-version]')?.dataset.version;
        if (version) selectEstimate(version);
        const footerAction = target.closest('[data-estimating-action]')?.dataset.estimatingAction;
        if (footerAction === 'new-estimate') { ui.modal = 'new'; renderModal(); }
        if (target.closest('[data-retry-save]')) saveServer();
    });

    root.addEventListener('change', event => {
        if (!event.target.matches('[data-group-name]')) return;
        const group = current().groups.find(row => row.id === event.target.dataset.groupName);
        if (group) { group.name = event.target.value.trim() || 'Untitled Group'; changed('Renamed group'); }
    });

    document.addEventListener('click', async event => {
        const target = event.target;
        if (!target.closest('.est-markup-popover') && !target.closest('[data-markup-menu-btn]')) {
            closeMarkupPopovers();
        }
        if (!target.closest('#optionsMenu') && !target.closest('[data-est-action="options"]')) {
            closeOptionsMenu();
        }
        if (target.closest('[data-close-markup-popover]')) {
            closeMarkupPopovers();
            return;
        }
        if (target.closest('[data-popover-delete-markup]')) {
            const mId = target.closest('[data-popover-delete-markup]').dataset.popoverDeleteMarkup;
            current().settings.preTaxMarkups = (current().settings.preTaxMarkups || []).filter(m => String(m.id) !== String(mId));
            current().settings.postTaxMarkups = (current().settings.postTaxMarkups || []).filter(m => String(m.id) !== String(mId));
            closeMarkupPopovers();
            changed('Deleted markup');
            return;
        }
        if (target.closest('[data-close-notes-lib]')) {
            ui.notesLibraryModal = null;
            renderNotesLibraryModal();
            return;
        }
        const notesLibTab = target.closest('[data-notes-lib-tab]');
        if (notesLibTab) {
            ui.notesLibraryModal = notesLibTab.dataset.notesLibTab;
            renderNotesLibraryModal();
            return;
        }
        const insertPreset = target.closest('[data-insert-preset]');
        if (insertPreset) {
            const key = insertPreset.dataset.insertPreset;
            const text = insertPreset.dataset.presetText;
            current().notes[key] = current().notes[key] || [];
            current().notes[key].push(text);
            changed(`Inserted note into ${key}`);
            return;
        }
        const copyPreset = target.closest('[data-copy-preset]');
        if (copyPreset) {
            try { navigator.clipboard.writeText(copyPreset.dataset.copyPreset); } catch (_) {}
            const orig = copyPreset.innerHTML;
            copyPreset.innerHTML = '<i class="fas fa-check" style="color: #10b981;"></i>';
            setTimeout(() => { copyPreset.innerHTML = orig; }, 1200);
            return;
        }
        const deleteLibPreset = target.closest('[data-delete-lib-preset]');
        if (deleteLibPreset) {
            const key = deleteLibPreset.dataset.deleteLibPreset;
            const idx = parseInt(deleteLibPreset.dataset.index, 10);
            if (key === 'excluded') deleteExclusionPreset(idx);
            else deleteInclusionPreset(idx);
            renderNotesLibraryModal();
            return;
        }
        const saveNewPreset = target.closest('[data-save-new-preset]');
        if (saveNewPreset) {
            const key = saveNewPreset.dataset.saveNewPreset;
            const val = document.getElementById('newPresetTextInput')?.value;
            if (val && val.trim()) {
                if (key === 'excluded') addExclusionPreset(val);
                else addInclusionPreset(val);
                renderNotesLibraryModal();
            }
            return;
        }

        const pop = $('estActionPopover');
        if (pop && !pop.hidden) {
            if (!pop.contains(event.target) && !event.target.closest('[data-group-menu-btn]') && !event.target.closest('[data-item-menu-btn]')) {
                hideActionPopover();
            }
        }
        const portal = event.target.closest('[data-estimating-modal-portal]');
        if (!portal) return;
        if (event.target.closest('[data-close-modal]') || event.target === portal) { ui.modal = null; renderModal(); return; }
        if (event.target.closest('[data-create-estimate]')) {
            const createButton = event.target.closest('[data-create-estimate]');
            const name = portal.querySelector('#copyEstimateName')?.value;
            const mode = portal.querySelector('input[name="copyEstimateMode"]:checked')?.value || 'blank';
            Workspace.createEstimate(state, name, mode); ui.modal = null; saveLocal();
            markEstimateDirty();
            saveLocal();
            render();
            if (projectId) {
                createButton.disabled = true;
                ui.loadState = 'saving';
                ui.message = 'Creating estimate in databaseâ€¦';
                renderStatus();
                try {
                    await window.projectEstimatingSave();
                    ui.message = 'Estimate created';
                    renderStatus();
                } catch (error) {
                    ui.loadState = 'error';
                    ui.message = `Estimate was not confirmed by the database: ${error.message}`;
                    renderStatus();
                }
            }
        }
        const catalogId = event.target.closest('[data-est-catalog-item]')?.dataset.estCatalogItem;
        if (catalogId) {
            const group = current().groups.find(row => String(row.id) === String(ui.catalogTargetGroupId));
            const catalog = (ui.catalogData?.items || []).find(row => String(row.id) === String(catalogId));
            if (!group || !catalog) return;
            const item = catalogEstimateItem(catalog);
            group.items.push(item); group.expanded = true; ui.modal = null;
            changed(`Added ${item.name} from Cost Catalog`);
        }
    });

    document.addEventListener('input', event => {
        if (!event.target.matches('[data-est-catalog-search]')) return;
        const results = document.querySelector('[data-est-catalog-results]');
        if (results) results.innerHTML = renderCatalogChoices(event.target.value);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && ui.modal) { ui.modal = null; renderModal(); }
        if (event.key === 'Escape') {
            hideActionPopover();
            closeMarkupPopovers();
            closeOptionsMenu();
            root.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
            root.querySelectorAll('[data-estimate-menu]').forEach(row => row.setAttribute('aria-expanded', 'false'));
        }
    });

    document.addEventListener('click', event => {
        if (event.target.closest('[data-estimate-menu], [data-estimate-actions-menu]')) return;
        root.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
        root.querySelectorAll('[data-estimate-menu]').forEach(row => row.setAttribute('aria-expanded', 'false'));
    });

    function refreshEstimateFromStorage(estimateId) {
        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (stored?.estimates?.some(row => String(row.id) === String(estimateId))) {
                state = Workspace.workspace(stored, projectId);
                restoreDirtyTracking();
            }
        } catch (_) {}
    }

    function selectEstimate(estimateId) {
        const selected = Workspace.selectEstimate(state, estimateId);
        if (!selected) return;
        // Selecting a tab is local UI state, not an estimate content edit. It
        // must not increment the estimate revision or conflict with another
        // estimator editing that same estimate.
        ui.selected.clear(); saveLocal(); render(); publish();
    }

    window.addEventListener('takeoff:estimating-lines-updated', event => {
        if (event.detail?.projectId && String(event.detail.projectId) !== String(projectId)) return;
        if (event.detail?.activeEstimateId && String(event.detail.activeEstimateId) !== String(state.activeEstimateId)) return;
        if (!(event.detail?.groups || []).length && event.detail?.complete !== true) return;
        const scopedSnapshot = Boolean(event.detail?.activeEstimateId)
            && Number(event.detail?.version || 0) >= 2;
        reconcileGroups(event.detail?.activeEstimateId || state.activeEstimateId,
            event.detail?.groups || [], { importNewLayers: scopedSnapshot });
    });
    window.addEventListener('takeoff:layer-updated', () => renderTable());
    window.addEventListener('takeoff:layers-updated', () => renderTable());
    window.addEventListener('takeoff:layer-visuals-updated', () => renderTable());
    window.addEventListener('takeoff:project-state-updated', () => renderTable());
    window.addEventListener('takeoff:tab-activated', event => {
        if (event.detail?.tab === 'estimating') renderTable();
    });
    document.addEventListener('click', e => {
        if (e.target.closest('#tabBtnEstimating, [data-tab="estimating"], [href="#tab-estimating"]')) {
            setTimeout(renderTable, 40);
        }
    });
    window.addEventListener('takeoff:estimating-link-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId)) return;
        const found = allItems().find(row => String(row.item.id) === String(detail.itemId));
        if (!found || !detail.layerId) return;
        if (found.item.takeoffLayerId && String(found.item.takeoffLayerId) === String(detail.layerId)) return;
        found.item.takeoffLayerId = String(detail.layerId);
        found.item.quantitySource = 'takeoff';
        found.item.quantitySyncStatus = found.item.quantityOverride ? 'overridden' : 'synced';
        changed(`Linked ${found.item.name} to Takeoff`);
    });
    window.addEventListener('takeoff:estimating-links-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId) || !Array.isArray(detail.links)) return;
        const itemsById = new Map(allItems().map(row => [String(row.item.id), row.item]));
        let linked = 0;
        detail.links.forEach(link => {
            const item = itemsById.get(String(link.itemId || ''));
            if (!item || !link.layerId || String(item.takeoffLayerId || '') === String(link.layerId)) return;
            item.takeoffLayerId = String(link.layerId);
            item.quantitySource = 'takeoff';
            item.quantitySyncStatus = item.quantityOverride ? 'overridden' : 'synced';
            linked += 1;
        });
        if (linked) changed(`Linked ${linked} item(s) to Takeoff`);
    });
    window.addEventListener('takeoff:active-estimate-changed', event => {
        if (event.detail?.projectId && String(event.detail.projectId) !== String(projectId)) return;
        selectEstimate(event.detail?.estimateId);
    });
    window.addEventListener('takeoff:layer-visuals-updated', () => {
        renderTable();
    });
    window.addEventListener('takeoff:layers-updated', () => {
        renderTable();
    });
    window.addEventListener('takeoff:layer-updated', () => {
        renderTable();
    });
    window.addEventListener('takeoff:estimating-groups-delete-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId) || !Array.isArray(detail.groupIds)) return;
        const ids = new Set(detail.groupIds.map(String));
        const estimate = current();
        const next = estimate.groups.filter(group => !ids.has(String(group.id)));
        if (next.length === estimate.groups.length) return;
        const removedCount = estimate.groups.length - next.length;
        estimate.groups = next;
        changed(`Deleted ${removedCount} Takeoff group(s)`);
    });
    window.addEventListener('takeoff:estimating-group-create-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId) || !detail.group) return;
        const estimate = current();
        if (estimate.groups.some(group => String(group.id) === String(detail.group.id))) return;
        estimate.groups.push(Workspace.group(detail.group));
        changed(`Created Takeoff group ${detail.group.name || ''}`.trim());
    });
    window.addEventListener('takeoff:estimating-groups-reorder-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId) || !Array.isArray(detail.groupIds)) return;
        const order = new Map(detail.groupIds.map((id, index) => [String(id), index]));
        const estimate = current();
        const before = estimate.groups.map(group => String(group.id)).join('|');
        estimate.groups.sort((a, b) => (order.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));
        estimate.groups.forEach((group, index) => { group.sortOrder = index; });
        if (before === estimate.groups.map(group => String(group.id)).join('|')) return;
        changed('Reordered Takeoff groups');
    });
    window.addEventListener('takeoff:estimating-action-requested', event => {
        if (event.detail?.action === 'new-estimate') ui.modal = 'new';
        renderModal();
    });
    window.addEventListener('takeoff:estimating-estimate-action-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        handleEstimateCardAction(detail.action, detail.estimateId);
    });
    window.addEventListener('storage', event => {
        if (event.key !== storageKey || !event.newValue) return;
        const incoming = Workspace.workspace(JSON.parse(event.newValue), projectId);
        state = applyDeletedEstimateTombstones(incoming);
        restoreDirtyTracking();
        // Storage events are notifications only. Never write the same workspace
        // key from inside its handler: two tabs can otherwise bounce normalized
        // snapshots forever and monopolize the browser main thread.
        state.groups = current().groups;
        state.dirtyEstimateIds = [...dirtyEstimateIds];
        state.takeoffSyncDirtyIds = [...takeoffSyncDirtyIds];
        render();
        publish();
    });

    window.projectEstimatingSave = async function () {
        if (!projectId) return true;
        const started = Date.now();
        ui.saveRequested = true;
        while (ui.saving || ui.saveRequested) {
            if (Date.now() - started > 15000) throw new Error('Estimating save timed out.');
            if (ui.saving) {
                await new Promise(resolve => setTimeout(resolve, 50));
                continue;
            }
            clearTimeout(ui.saveTimer);
            await saveServer();
            if (ui.loadState === 'error') {
                const error = new Error(ui.message);
                error.code = ui.lastErrorCode || 'save_failed';
                throw error;
            }
        }
        return true;
    };

    function catalogDomainOptions(options = {}) {
        const result = { ...options };
        delete result.estimateId;
        return result;
    }

    window.projectEstimatingPrepareCatalogUpdate = async function (options = {}) {
        const Application = window.CatalogUpdateApplicationService;
        const Catalog = window.CatalogService;
        if (!Application || !Catalog) throw new Error('Catalog update services are unavailable.');
        await window.projectEstimatingSave();
        const estimateId = String(options.estimateId || state.activeEstimateId || '');
        const estimate = state.estimates.find(row => String(row.id) === estimateId);
        if (!estimate) throw new Application.CatalogUpdateApplicationError(
            'ESTIMATE_NOT_FOUND', 'The Estimate selected for refresh no longer exists.');
        const catalog = await Catalog.getSnapshot();
        const domainOptions = catalogDomainOptions(options);
        const prepared = Application.prepareCatalogUpdate(Workspace.clone(estimate), catalog, domainOptions);
        const strategy = Application.resolveCatalogUpdateStrategy(estimate);
        return {
            ...prepared,
            strategy,
            currentEstimateRevision: Number(estimate.estimateRevision || 1),
            projectedEstimateRevision: Number(estimate.estimateRevision || 1)
                + (strategy.strategy === Application.STRATEGY.CREATE_REVISION ? 1 : 0)
        };
    };

    window.projectEstimatingApplyCatalogUpdate = async function (prepared, options = {}) {
        const Application = window.CatalogUpdateApplicationService;
        const Catalog = window.CatalogService;
        if (!Application || !Catalog) throw new Error('Catalog update services are unavailable.');
        if (!prepared?.guard) throw new Application.CatalogUpdateApplicationError(
            'PREVIEW_GUARD_REQUIRED', 'Generate a Cost Catalog preview before applying it.');
        const sourceId = String(prepared.guard.estimateId || '');
        const sourceIndex = state.estimates.findIndex(row => String(row.id) === sourceId);
        if (sourceIndex < 0) throw new Application.CatalogUpdateApplicationError(
            'ESTIMATE_CHANGED_SINCE_PREVIEW', 'The Estimate no longer exists.');
        const catalog = await Catalog.getSnapshot();
        const result = Application.applyCatalogUpdate(Workspace.clone(state.estimates[sourceIndex]), catalog, {
            ...catalogDomainOptions(prepared.options || {}),
            ...catalogDomainOptions(options),
            previewGuard: prepared.guard
        });
        const normalized = Workspace.estimate(result.appliedEstimate, projectId,
            result.strategy === Application.STRATEGY.CREATE_REVISION ? state.estimates.length : sourceIndex);
        if (result.strategy === Application.STRATEGY.CREATE_REVISION) {
            state.estimates.forEach(row => { row.isActive = false; });
            state.estimates.push(normalized);
            state.activeEstimateId = normalized.id;
        } else {
            state.estimates[sourceIndex] = normalized;
        }
        Workspace.selectEstimate(state, state.activeEstimateId);
        markEstimateDirty(normalized.id);
        saveLocal();
        render();
        try {
            await window.projectEstimatingSave();
        } catch (cause) {
            throw new Application.CatalogUpdateApplicationError(
                cause.code === 'ESTIMATE_CHANGED_SINCE_PREVIEW'
                    ? 'ESTIMATE_CHANGED_SINCE_PREVIEW' : 'CATALOG_UPDATE_PERSISTENCE_FAILED',
                cause.message,
                { cause, estimateId: normalized.id, localDraftPreserved: true }
            );
        }
        const persisted = state.estimates.find(row => String(row.id) === String(normalized.id));
        return {
            ...result,
            estimateId: persisted?.id || result.estimateId,
            dbEstimateId: persisted?.dbEstimateId || null,
            serverRevision: Number(persisted?.revision || 0),
            appliedEstimate: Workspace.clone(persisted || normalized),
            persisted: true
        };
    };

    window.isEstimatingDirty = () => Boolean(ui.saving || ui.saveRequested || dirtyEstimateIds.size);

    window.addEventListener('beforeunload', event => {
        if (!ui.saving && !ui.saveRequested && !dirtyEstimateIds.size) return;
        event.preventDefault();
        event.returnValue = '';
    });

    function toggleEstimatingRight(forceState = null) {
        const estMain = root.querySelector('.est-main');
        const estRight = root.querySelector('.est-right');
        if (!estMain || !estRight) return;

        const willCollapse = forceState !== null ? Boolean(forceState) : !estMain.classList.contains('details-collapsed');
        estMain.classList.toggle('details-collapsed', willCollapse);
        estRight.classList.toggle('collapsed', willCollapse);

        const tabBtn = $('estRightCollapseTab');
        if (tabBtn) {
            const icon = tabBtn.querySelector('i');
            if (icon) {
                icon.className = willCollapse ? 'fas fa-chevron-left' : 'fas fa-chevron-right';
            }
            tabBtn.title = willCollapse ? 'Show summary panel' : 'Hide summary panel';
            tabBtn.setAttribute('aria-label', willCollapse ? 'Show summary panel' : 'Hide summary panel');
        }

        const toolbarBtn = $('estToolbarToggleRight');
        if (toolbarBtn) {
            const icon = toolbarBtn.querySelector('i');
            if (icon) {
                icon.className = willCollapse ? 'fas fa-chevron-left' : 'fas fa-chevron-right';
            }
            toolbarBtn.title = willCollapse ? 'Show summary panel' : 'Hide summary panel';
        }

        try {
            localStorage.setItem('takeoff.estimatingRightCollapsed', willCollapse ? '1' : '0');
        } catch (_) {}
    }

    
    let draggedNoteInfo = null;
    let draggedMarkupInfo = null;

    root.addEventListener('dragstart', event => {
        const noteRow = event.target.closest('.est-note-row');
        if (noteRow) {
            draggedNoteInfo = {
                key: noteRow.dataset.noteKey,
                index: parseInt(noteRow.dataset.index, 10)
            };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', 'note-' + noteRow.dataset.index);
            noteRow.classList.add('is-dragging');
            return;
        }
        const markupRow = event.target.closest('.est-markup-table-row');
        if (markupRow) {
            draggedMarkupInfo = {
                type: markupRow.dataset.markupType,
                index: parseInt(markupRow.dataset.index, 10)
            };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', 'markup-' + markupRow.dataset.index);
            markupRow.classList.add('is-dragging');
            return;
        }
    });

    root.addEventListener('dragover', event => {
        const noteRow = event.target.closest('.est-note-row');
        if (noteRow && draggedNoteInfo && noteRow.dataset.noteKey === draggedNoteInfo.key) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            noteRow.classList.add('drag-over');
            return;
        }
        const markupRow = event.target.closest('.est-markup-table-row');
        if (markupRow && draggedMarkupInfo && markupRow.dataset.markupType === draggedMarkupInfo.type) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            markupRow.classList.add('drag-over');
            return;
        }
    });

    root.addEventListener('dragleave', event => {
        const noteRow = event.target.closest('.est-note-row');
        if (noteRow) noteRow.classList.remove('drag-over');
        const markupRow = event.target.closest('.est-markup-table-row');
        if (markupRow) markupRow.classList.remove('drag-over');
    });

    root.addEventListener('drop', event => {
        const noteRow = event.target.closest('.est-note-row');
        if (noteRow && draggedNoteInfo && noteRow.dataset.noteKey === draggedNoteInfo.key) {
            event.preventDefault();
            noteRow.classList.remove('drag-over');
            const targetIndex = parseInt(noteRow.dataset.index, 10);
            if (!isNaN(draggedNoteInfo.index) && !isNaN(targetIndex) && draggedNoteInfo.index !== targetIndex) {
                const list = current().notes[draggedNoteInfo.key] || [];
                const [moved] = list.splice(draggedNoteInfo.index, 1);
                list.splice(targetIndex, 0, moved);
                changed(`Reordered ${draggedNoteInfo.key} notes`);
            }
            return;
        }
        const markupRow = event.target.closest('.est-markup-table-row');
        if (markupRow && draggedMarkupInfo && markupRow.dataset.markupType === draggedMarkupInfo.type) {
            event.preventDefault();
            markupRow.classList.remove('drag-over');
            const targetIndex = parseInt(markupRow.dataset.index, 10);
            if (!isNaN(draggedMarkupInfo.index) && !isNaN(targetIndex) && draggedMarkupInfo.index !== targetIndex) {
                const list = current().settings[draggedMarkupInfo.type] || [];
                const [moved] = list.splice(draggedMarkupInfo.index, 1);
                list.splice(targetIndex, 0, moved);
                changed(`Reordered ${draggedMarkupInfo.type}`);
            }
            return;
        }
    });

    root.addEventListener('dragend', () => {
        root.querySelectorAll('.is-dragging, .drag-over').forEach(el => el.classList.remove('is-dragging', 'drag-over'));
        draggedNoteInfo = null;
        draggedMarkupInfo = null;
    });

    // Handle inputs/selects inside the markup popover
    document.addEventListener('input', event => {
        const target = event.target;
        if (target.id === 'notesLibSearchInput') {
            ui.notesLibrarySearch = target.value;
            renderNotesLibraryModal();
            return;
        }
        const popover = target.closest('.est-markup-popover');
        if (popover && target.dataset.popoverMarkupProp) {
            const mId = popover.dataset.activePopoverMarkupId;
            const rows = [...(current().settings.preTaxMarkups || []), ...(current().settings.postTaxMarkups || [])];
            const markup = rows.find(m => String(m.id) === String(mId));
            if (markup) {
                const prop = target.dataset.popoverMarkupProp;
                if (prop === 'name') markup.name = target.value.trim() || 'Untitled Markup';
                else if (prop === 'val') {
                    const num = Workspace.numeric(target.value);
                    if (markup.type === 'fixed_amount') markup.amount = num;
                    else markup.percent = num;
                }
                reactiveChanged(target);
            }
        }
    });

    document.addEventListener('change', event => {
        const target = event.target;
        const popover = target.closest('.est-markup-popover');
        if (popover && target.dataset.popoverMarkupProp) {
            const mId = popover.dataset.activePopoverMarkupId;
            const rows = [...(current().settings.preTaxMarkups || []), ...(current().settings.postTaxMarkups || [])];
            const markup = rows.find(m => String(m.id) === String(mId));
            if (markup) {
                const prop = target.dataset.popoverMarkupProp;
                if (prop === 'name') {
                    const prevName = getAuditPrevValue(target) || markup.name;
                    const nextName = target.value.trim() || 'Untitled Markup';
                    markup.name = nextName;
                    commitAuditPrevValue(target);
                    changed(`Renamed markup (${prevName} -> ${nextName})`);
                    return;
                } else if (prop === 'val') {
                    const prevRaw = getAuditPrevValue(target);
                    const nextVal = Workspace.numeric(target.value);
                    const kind = markup.type === 'fixed_amount' ? 'money' : 'percent';
                    commitAuditPrevValue(target);
                    changed(`Updated "${markup.name}" (${formatAuditVal(prevRaw, kind)} -> ${formatAuditVal(nextVal, kind)})`);
                    return;
                } else if (prop === 'type') {
                    markup.type = target.value;
                    const valInput = popover.querySelector('[data-popover-markup-prop="val"]');
                    if (valInput) {
                        valInput.value = markup.type === 'fixed_amount' ? markup.amount : markup.percent;
                        valInput.dataset.auditPrevValue = valInput.value;
                    }
                } else if (prop === 'base') {
                    markup.base = target.value;
                } else if (prop === 'active') {
                    markup.active = target.checked;
                }
                changed(`Updated "${markup.name}" settings`);
            }
        }
    });

    function initSummaryTableResizers() {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        let activeCol = null;
        let activeTh = null;

        root.addEventListener('pointerdown', e => {
            const resizer = e.target.closest('[data-summary-col-resizer]');
            if (!resizer) return;
            const th = resizer.closest('th');
            if (!th) return;

            e.preventDefault();
            e.stopPropagation();
            isResizing = true;
            activeCol = resizer.dataset.summaryColResizer;
            activeTh = th;
            startX = e.clientX;
            startWidth = th.offsetWidth;
            resizer.classList.add('is-dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
        });

        const onPointerMove = e => {
            if (!isResizing || !activeTh) return;
            const delta = e.clientX - startX;
            const newW = Math.max(75, Math.round(startWidth + delta));
            activeTh.style.width = `${newW}px`;
            activeTh.style.minWidth = `${newW}px`;
            ui.summaryColWidths = ui.summaryColWidths || {};
            ui.summaryColWidths[activeCol] = newW;
        };

        const onPointerUp = e => {
            if (!isResizing) return;
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            root.querySelectorAll('[data-summary-col-resizer].is-dragging').forEach(r => r.classList.remove('is-dragging'));
            try {
                localStorage.setItem('takeoff.summaryColWidths', JSON.stringify(ui.summaryColWidths || {}));
            } catch (_) {}
            activeCol = null;
            activeTh = null;
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    }
function initEstimatingResizer() {
        const resizer = $('estSplitResizer');
        const estRight = root.querySelector('.est-right');
        const collapseTab = $('estRightCollapseTab');
        const toolbarToggle = $('estToolbarToggleRight');
        if (!resizer || !estRight) return;

        try {
            const saved = localStorage.getItem('takeoff.estimatingRightWidth');
            if (saved) {
                const parsed = parseInt(saved, 10);
                if (parsed >= 260 && parsed <= 800) {
                    estRight.style.setProperty('--est-right-w', `${parsed}px`);
                    estRight.style.width = `${parsed}px`;
                    estRight.style.flexBasis = `${parsed}px`;
                }
            }
            const savedCollapsed = localStorage.getItem('takeoff.estimatingRightCollapsed');
            if (savedCollapsed === '1') {
                toggleEstimatingRight(true);
            }
        } catch (_) {}

        toolbarToggle?.addEventListener('click', e => {
            e.stopPropagation();
            toggleEstimatingRight();
        });

        let isDragging = false;
        let startX = 0;
        let startWidth = 0;

        resizer.addEventListener('pointerdown', e => {
            const estMain = root.querySelector('.est-main');
            if (estMain?.classList.contains('details-collapsed')) return;

            isDragging = true;
            startX = e.clientX;
            const currentComputed = parseInt(getComputedStyle(estRight).width, 10) || 420;
            startWidth = currentComputed;
            resizer.classList.add('is-dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
        });

        resizer.addEventListener('pointermove', e => {
            if (!isDragging) return;
            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            const deltaX = (e.clientX - startX) / zoom;
            const newWidth = Math.max(260, Math.min(800, Math.round(startWidth - deltaX)));
            estRight.style.setProperty('--est-right-w', `${newWidth}px`);
            estRight.style.width = `${newWidth}px`;
            estRight.style.flexBasis = `${newWidth}px`;
        });

        const stopDragging = e => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('is-dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try {
                if (e?.pointerId) resizer.releasePointerCapture(e.pointerId);
            } catch (_) {}

            const finalWidth = parseInt(getComputedStyle(estRight).width, 10) || 420;
            try {
                localStorage.setItem('takeoff.estimatingRightWidth', finalWidth);
            } catch (_) {}
        };

        resizer.addEventListener('pointerup', stopDragging);
        resizer.addEventListener('pointercancel', stopDragging);
    }

    saveLocal();
    render();
    initEstimatingResizer();
    loadServer();
})();
