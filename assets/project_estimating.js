(function () {
    'use strict';
    const root = document.getElementById('estimatingModule');
    if (!root) return;

    const Workspace = window.EstimatingWorkspaceService;
    const Calc = window.EstimateCalculationService;
    const getExporter = () => window.EstimatingExportService;
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
    const ui = {
        search: '', selected: new Set(), saving: false, saveRequested: false, saveTimer: null, pendingDeleteId: null, lastErrorCode: null, loadState: projectId ? 'loading' : 'local',
        message: projectId ? 'Loading estimate' : 'Local draft', collapsed: { notes: true, audit: true }, expandedAssemblies: new Set(), modal: null,
        notesLibraryModal: null, notesLibrarySearch: '', activeMarkupPopover: null, summaryColWidths: (() => { try { return JSON.parse(localStorage.getItem('takeoff.summaryColWidths') || '{}'); } catch (_) { return {}; } })(),
        catalogTargetGroupId: null, catalogData: null, catalogLoading: false, catalogError: '',
        importFile: null, importMode: 'keep_excel', importName: '', importError: '', importing: false
    };
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
    let estimatingHasUnsavedCheckpoint = false;
    let estimatingTableDirty = false;
    const estimatingLoadingMessages = new Map();
    let estimatingTableRenderGeneration = 0;
    const ESTIMATING_TABLE_CHUNK_SIZE = 60;
    const ESTIMATING_TABLE_CHUNK_THRESHOLD = 120;

    function isEstimatingTabActive() {
        const tab = document.getElementById('tab-estimating');
        return !tab || (!tab.hidden && tab.classList.contains('active'));
    }

    function setEstimatingLoading(visible, message = 'Loading estimate...', reason = 'workspace') {
        const main = root.querySelector('.est-main');
        if (!main) return;
        if (visible) estimatingLoadingMessages.set(reason, message);
        else estimatingLoadingMessages.delete(reason);
        const switching = estimatingLoadingMessages.has('switch');
        const activeMessage = estimatingLoadingMessages.get('switch')
            || estimatingLoadingMessages.values().next().value;
        main.classList.toggle('is-switching-estimate', switching);
        let overlay = main.querySelector('#estLoadingOverlay');
        if (!overlay && activeMessage) {
            overlay = document.createElement('div');
            overlay.id = 'estLoadingOverlay';
            overlay.className = 'est-loading-overlay';
            overlay.setAttribute('role', 'status');
            overlay.setAttribute('aria-live', 'polite');
            overlay.innerHTML = '<div class="est-loading-card"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i><span id="estLoadingOverlayText"></span></div>';
            main.appendChild(overlay);
        }
        if (!overlay) return;
        if (activeMessage) {
            const textEl = overlay.querySelector('#estLoadingOverlayText');
            if (textEl) textEl.textContent = activeMessage;
        }
        overlay.hidden = !activeMessage;
    }

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
        root.innerHTML = `<div class="est-main"><aside class="est-table-settings-drawer" id="estTableSettingsDrawer" aria-label="Table Settings" hidden></aside><section class="est-left"><div class="est-toolbar"><div class="bb-search-field-procore cc-search-procore est-search-box"><input id="estSearch" type="search" placeholder="Search estimate items..." autocomplete="off"></div><div class="est-toolbar-actions"><button class="btn-main est-toolbar-btn est-btn-import" id="estBtnImport" type="button" data-est-option="import" title="Import Project Estimate (.xlsx)"><i class="fas fa-file-import"></i> <span>Import</span></button><button class="btn-main est-toolbar-btn est-btn-export" id="estBtnExport" type="button" data-est-option="export" title="Export Estimate"><i class="fas fa-file-export"></i> <span>Export</span></button><button class="est-icon-btn" id="estBtnCreateGroup" type="button" data-est-action="create-group" title="Create Group"><i class="fas fa-folder-plus"></i></button><button class="est-icon-btn" id="estBtnTableSettings" type="button" data-est-action="table-settings" title="Table Settings"><i class="fas fa-sliders"></i></button><button class="est-icon-btn" id="estBtnFullscreen" type="button" data-est-action="fullscreen" title="Full screen"><i class="fas fa-expand"></i></button><div class="est-menu-wrap"><button class="est-icon-btn" id="estBtnMoreOptions" type="button" data-est-action="options" title="Options"><i class="fas fa-ellipsis-vertical"></i></button><div class="est-menu" id="optionsMenu"><button type="button" data-est-action="catalog-update"><i class="fas fa-arrows-rotate"></i> Update from Cost Catalog</button><button type="button" data-est-action="reset-quantities"><i class="fas fa-rotate-left"></i> Reset Quantities</button></div></div><button class="est-icon-btn est-toggle-right-btn" id="estToolbarToggleRight" type="button" data-est-action="toggle-right" title="Hide summary panel"><i class="fas fa-chevron-right"></i></button></div></div><div class="est-table-wrap bb-table-scroll"><table class="est-table bb-table" id="estMainTable"><thead id="estTableHead"></thead><tbody id="estTableBody"></tbody></table></div></section><div class="pro-sidebar-resizer est-sidebar-resizer" id="estSplitResizer" role="separator" aria-orientation="vertical" title="Drag to resize panels"><div class="pro-resizer-handle"></div></div><aside class="est-right"><div class="est-right-scroll"></div><div class="est-total-box"><div id="estimateTotal" class="est-total-value"></div><div class="est-total-label">Estimate Total</div><div id="estimateSqft" class="est-total-sub"></div></div></aside></div><footer class="est-version-bar" id="versionBar"></footer>`;
    }

    function safeSetLocalStorage(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (err) {
            try {
                const currentProjectStr = String(projectId || 'draft');
                const evictable = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (!k || k === key) continue;
                    if ((k.startsWith('takeoff.estimating.module.') && k !== `takeoff.estimating.module.${currentProjectStr}`)
                        || (k.startsWith('takeoff_project_groups_') && k !== `takeoff_project_groups_${currentProjectStr}`)) {
                        evictable.push(k);
                    }
                }
                evictable.forEach(k => { try { localStorage.removeItem(k); } catch (_) { } });
                localStorage.setItem(key, value);
                return true;
            } catch (_) {
                return false;
            }
        }
    }

    function readLocal() {
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) { }
        if (!raw && projectId > 0) {
            const psActiveId = String(window.ProjectState?.activeEstimateId || '');
            const psSummary = Array.isArray(window.ProjectState?.estimatesSummary) ? window.ProjectState.estimatesSummary : [];
            const seedItems = window.ProjectState?.estimateItems || [];
            if (psSummary.length > 0) {
                raw = {
                    activeEstimateId: (psActiveId && psActiveId !== 'est_primary') ? psActiveId : psSummary[0].id,
                    estimates: psSummary.map((row, idx) => ({
                        id: String(row.id),
                        dbEstimateId: row.dbEstimateId || null,
                        name: row.name || (idx === 0 ? 'Primary Estimate' : `Estimate ${idx + 1}`),
                        isPrimary: Boolean(row.isPrimary || row.is_primary),
                        is_primary: Boolean(row.isPrimary || row.is_primary),
                        isActive: Boolean(row.isActive || String(row.id) === psActiveId),
                        estimateTotal: Number(row.estimateTotal || row.totalSales || 0),
                        totalSales: Number(row.totalSales || row.estimateTotal || 0),
                        groups: idx === 0 && seedItems.length ? undefined : []
                    }))
                };
            } else if (psActiveId && psActiveId !== 'est_primary') {
                raw = {
                    activeEstimateId: psActiveId,
                    estimates: [{ id: psActiveId, name: 'Primary Estimate', isPrimary: true, is_primary: true, isActive: true }]
                };
            }
        }
        return Workspace.workspace(raw || {}, projectId, window.ProjectState?.estimateItems || []);
    }

    function ensureDefaultMarkups(estimate) {
        if (!estimate) return estimate;
        if (!estimate.settings) estimate.settings = {};
        const hasVal = v => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
        if (!hasVal(estimate.settings.globalLaborCost)) estimate.settings.globalLaborCost = 36;
        if (!hasVal(estimate.settings.globalLaborMargin)) estimate.settings.globalLaborMargin = 34.6;
        if (!hasVal(estimate.settings.materialMargin)) estimate.settings.materialMargin = 15;
        if (!hasVal(estimate.settings.equipmentMargin)) estimate.settings.equipmentMargin = 15;
        if (!hasVal(estimate.settings.laborWaste)) estimate.settings.laborWaste = 0;
        if (!hasVal(estimate.settings.materialWaste)) estimate.settings.materialWaste = 0;
        if (!hasVal(estimate.settings.equipmentWaste)) estimate.settings.equipmentWaste = 0;
        if (!hasVal(estimate.settings.laborDifficulty)) estimate.settings.laborDifficulty = 1;
        const gCost = Number(estimate.settings.globalLaborCost);
        const gMargin = Number(estimate.settings.globalLaborMargin);
        if (!hasVal(estimate.settings.globalLaborSales) || Number(estimate.settings.globalLaborSales) === 110) {
            estimate.settings.globalLaborSales = gMargin < 100
                ? Number((gCost / (1 - gMargin / 100)).toFixed(2))
                : gCost;
        }
        if (projectId > 0 && (!estimate.settings._defaultsActivated || !estimate.settings._laborDefaultsActivated)) {
            const unlockMargins = !estimate.settings._defaultsActivated;
            const unlockLabor = !estimate.settings._laborDefaultsActivated;
            const unlockLegacyDefaults = items => {
                (items || []).forEach(it => {
                    if (!it || typeof it !== 'object') return;
                    const manual = it._manualFields || {};
                    if (unlockMargins) {
                        if (!manual.materialMargin && it.materialMargin === 0) {
                            it.materialMargin = null;
                            if (it.margin === 0) delete it.margin;
                        }
                        if (!manual.equipmentMargin && it.equipmentMargin === 0) it.equipmentMargin = null;
                        if (!manual.laborMargin && it.laborMargin === 0) it.laborMargin = null;
                        if (!manual.waste && it.waste === 0) it.waste = null;
                        if (!manual.difficulty && it.difficulty === 1) it.difficulty = null;
                    }
                    if (unlockLabor) {
                        const snapRate = Number(it.catalogSnapshot?.pricing?.laborRate || 0);
                        if (!manual.laborRate) {
                            if (Number(it.laborRate) === 0 && !(snapRate > 0)) {
                                it.laborRate = null;
                                if (it.overrides && Number(it.overrides.laborRate) === 0) it.overrides.laborRate = null;
                            } else if (Number(it.laborRate) === 85 && !(snapRate === 85) && gCost !== 85) {
                                it.laborRate = null;
                                if (it.overrides && Number(it.overrides.laborRate) === 85) it.overrides.laborRate = null;
                            }
                        }
                        if (String(it.laborUnitType || '').toLowerCase() === 'mins' && !manual.laborUnitType
                            && (it.catalogSnapshot || it.catalogItemId || it.takeoffLayerId || it.laborHours !== undefined || it.labor_hours !== undefined || it.parentItemId || it.assemblyComponentId)) {
                            it.laborUnitType = 'hrs';
                        }
                    }
                    if (Array.isArray(it.children) && it.children.length) unlockLegacyDefaults(it.children);
                    if (Array.isArray(it.assemblyItems) && it.assemblyItems.length) unlockLegacyDefaults(it.assemblyItems);
                });
            };
            (estimate.groups || []).forEach(g => unlockLegacyDefaults(g.items));
            estimate.settings._defaultsActivated = true;
            estimate.settings._laborDefaultsActivated = true;
        }
        if (!estimate.settings._markupsSeeded) {
            if (!Array.isArray(estimate.settings.preTaxMarkups) || estimate.settings.preTaxMarkups.length === 0) {
                estimate.settings.preTaxMarkups = [
                    { id: Workspace.uid('m'), name: 'Overhead', type: 'percent', percent: 6, amount: 0, base: 'subtotal_sales', operator: 'add', active: true },
                    { id: Workspace.uid('m'), name: 'Discount', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', operator: 'subtract', active: true }
                ];
            }
            if (!Array.isArray(estimate.settings.postTaxMarkups) || estimate.settings.postTaxMarkups.length === 0) {
                estimate.settings.postTaxMarkups = [
                    { id: Workspace.uid('m'), name: 'Bonding', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', operator: 'add', active: true },
                    { id: Workspace.uid('m'), name: 'Permit Impact Fee', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', operator: 'add', active: true },
                    { id: Workspace.uid('m'), name: 'Low Voltage Box', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', operator: 'add', active: true },
                    { id: Workspace.uid('m'), name: 'Discount', type: 'percent', percent: 0, amount: 0, base: 'subtotal_sales', operator: 'subtract', active: true }
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

    function openSquareFootageModal() {
        const currentSqft = resolveSquareFootage();
        document.querySelector('[data-est-sqft-portal]')?.remove();
        const portal = document.createElement('div');
        portal.className = 'pd-modal-backdrop open';
        portal.dataset.estSqftPortal = 'true';
        portal.style.cssText = 'position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); z-index: 999999;';
        portal.innerHTML = `
            <div class="pd-modal bb-create-project-modal bb-studio-modal notes-lib-modal" style="width: min(440px, 100%); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column;" role="dialog" aria-modal="true">
                <div class="pd-modal-head bb-studio-modal-header" style="padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div class="notes-lib-badge" style="width: 36px; height: 36px; border-radius: 8px; background: rgba(37,99,235,0.12); color: #3b82f6; display: flex; align-items: center; justify-content: center; font-size: 16px;">
                            <i class="fas fa-ruler-combined"></i>
                        </div>
                        <div>
                            <h3 style="margin: 0; font-size: 15px; font-weight: 600;">Project Square Footage</h3>
                            <p class="est-modal-sub" style="margin: 2px 0 0; font-size: 12px;">Gross area for $/sq ft cost and sales metrics</p>
                        </div>
                    </div>
                    <button type="button" class="pd-modal-head-close" data-close-sqft-modal style="border: none; background: transparent; font-size: 20px; line-height: 1; cursor: pointer;">&times;</button>
                </div>
                <div class="pd-modal-body" style="padding: 20px;">
                    <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px;">Total Gross Area (sq ft)</label>
                    <div style="position: relative; display: flex; align-items: center;">
                        <input id="estSqftModalInput" class="est-modal-input" type="number" step="any" min="0" value="${currentSqft > 0 ? currentSqft : ''}" placeholder="e.g. 5000" style="width: 100%; height: 42px; border-radius: 8px; padding: 0 54px 0 12px; font-size: 15px; font-weight: 600; outline: none;">
                        <span style="position: absolute; right: 12px; font-size: 12px; font-weight: 600; color: #3b82f6; background: rgba(37,99,235,0.12); padding: 2px 6px; border-radius: 4px;">sq ft</span>
                    </div>
                    <div class="est-modal-sub" style="margin-top: 10px; font-size: 11.5px;">
                        Updating this value recalculates the price per square foot across the entire estimate summary without altering item costs.
                    </div>
                </div>
                <div class="pd-modal-foot" style="padding: 12px 20px; display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                    <button type="button" class="btn-ghost pd-btn pd-btn-secondary" data-close-sqft-modal style="padding: 7px 14px; font-size: 13px; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button type="button" class="btn-main orange pd-btn pd-btn-primary" id="estSaveSqftBtn" style="padding: 7px 16px; font-size: 13px; border-radius: 6px; background: #ea580c; color: #fff; border: none; font-weight: 600; cursor: pointer;">Save Area</button>
                </div>
            </div>`;
        document.body.appendChild(portal);
        const input = portal.querySelector('#estSqftModalInput');
        input?.focus();
        input?.select();

        const close = () => portal.remove();
        portal.querySelectorAll('[data-close-sqft-modal]').forEach(b => b.addEventListener('click', close));
        portal.addEventListener('click', e => { if (e.target === portal) close(); });
        input?.addEventListener('keydown', e => { if (e.key === 'Enter') portal.querySelector('#estSaveSqftBtn')?.click(); });
        portal.querySelector('#estSaveSqftBtn')?.addEventListener('click', () => {
            const rawVal = input?.value || '0';
            const parsed = parseFloat(String(rawVal).replace(/[^0-9.]/g, '')) || 0;
            current().settings.squareFootage = parsed;
            if (window.ProjectState) {
                if (!window.ProjectState.projectMeta) window.ProjectState.projectMeta = {};
                window.ProjectState.projectMeta.square_footage = parsed > 0 ? String(parsed) : '';
            }
            const poInput = document.getElementById('poSquareFootage');
            if (poInput) poInput.value = parsed > 0 ? String(parsed) : '';
            close();
            changed(`Updated Project Square Footage (${number(currentSqft, 0)} sq ft -> ${number(parsed, 0)} sq ft)`);
        });
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
            || Number(item.is_assembly ?? 0) === 1
            || String(item.itemType ?? item.item_type ?? '').toLowerCase() === 'assembly'
            || String(item.type ?? item.costCategory ?? item.cost_category ?? '').toLowerCase() === 'assembly'
            || String(item.catalogSnapshot?.type ?? item.catalogSnapshot?.item_type ?? '').toLowerCase() === 'assembly'
            || String(item.catalogMetadata?.type ?? item.catalogMetadata?.item_type ?? '').toLowerCase() === 'assembly'
            || (Array.isArray(item.children) && item.children.length > 0)
            || (Array.isArray(item.assemblyItems) && item.assemblyItems.length > 0)
            || (Array.isArray(item.catalogSnapshot?.assemblyComponents) && item.catalogSnapshot.assemblyComponents.length > 0)
            || (Array.isArray(item.catalogMetadata?.assemblyComponents) && item.catalogMetadata.assemblyComponents.length > 0)
            || ui.expandedAssemblies.has(String(item.id));
    }
    function isEquipmentItem(item) {
        if (!item) return false;
        return [item.itemType, item.item_type, item.type, item.costCategory, item.cost_category,
        item.catalogSnapshot?.type, item.catalogMetadata?.type]
            .some(value => String(value || '').toLowerCase().includes('equip'));
    }
    function duplicateAssembly(item) {
        const copyTree = (source, parentItemId = null) => {
            const copy = Workspace.item({
                ...Workspace.clone(source), id: Workspace.uid('item'), parentItemId,
                takeoffLayerId: null, copiedFromTakeoffLayerId: source.takeoffLayerId || null,
                quantitySource: 'manual', quantitySyncStatus: 'manual'
            });
            if (source.catalogSnapshot) copy.catalogSnapshot = Workspace.clone(source.catalogSnapshot);
            if (source.catalogMetadata) copy.catalogMetadata = Workspace.clone(source.catalogMetadata);
            copy.children = (source.children || []).map(child => copyTree(child, copy.id));
            return copy;
        };
        const duplicate = copyTree(item);
        duplicate.name = `${item.name} Copy`;
        return duplicate;
    }
    function duplicateEstimatingItem(item) {
        if (!item) return null;
        if (isAssemblyItem(item)) return duplicateAssembly(item);
        return Workspace.item({
            ...Workspace.clone(item),
            id: Workspace.uid('item'),
            takeoffLayerId: null,
            copiedFromTakeoffLayerId: item.takeoffLayerId || null,
            quantitySource: 'manual',
            quantitySyncStatus: 'manual',
            name: `${item.name} (Copy)`
        });
    }
    function collectEstimatingItemTakeoffKeys(items, estimateId = state.activeEstimateId) {
        const estId = String(estimateId || state.activeEstimateId || '').trim();
        const itemIds = new Set();
        const layerKeys = new Set();
        const addKey = (val) => {
            const s = String(val || '').trim();
            if (!s) return;
            layerKeys.add(s);
            if (s.startsWith('takeoff_') && s.length > 8) layerKeys.add(s.slice(8));
        };
        (Array.isArray(items) ? items : []).forEach(item => {
            if (!item || typeof item !== 'object') return;
            const id = String(item.id || '').trim();
            if (id) {
                itemIds.add(id);
                addKey(id);
                if (estId) layerKeys.add(`estitem_${estId}_${id}`);
            }
            addKey(item.takeoffLayerId);
            addKey(item.source_layer_key);
        });
        return { itemIds: [...itemIds], layerKeys: [...layerKeys] };
    }
    function notifyTakeoffDeletedEstimatingItems(removedItems, estimateId = state.activeEstimateId) {
        const list = Array.isArray(removedItems) ? removedItems.filter(Boolean) : [];
        if (!list.length) return;
        const estId = String(estimateId || state.activeEstimateId || '').trim();
        const { itemIds, layerKeys } = collectEstimatingItemTakeoffKeys(list, estId);
        if (!itemIds.length && !layerKeys.length) return;
        window.dispatchEvent(new CustomEvent('takeoff:estimating-items-deleted', {
            detail: {
                version: 1,
                origin: 'estimating',
                projectId: String(projectId),
                estimateId: estId,
                itemIds,
                layerKeys
            }
        }));
    }
    function markEstimateDirty(estimateId = state.activeEstimateId) {
        const id = String(estimateId || '');
        if (!id) return;
        dirtyEstimateIds.add(id);
        dirtyGenerations.set(id, ++dirtyGeneration);
        state.dirtyEstimateIds = [...dirtyEstimateIds];
        state.takeoffSyncDirtyIds = [...takeoffSyncDirtyIds];
    }
    function consumeAndMarkWorkspaceRepairs() {
        if (typeof Workspace.consumeRepairFlags !== 'function') return [];
        const repairedIds = [];
        (state.estimates || []).forEach(estimate => {
            const flags = Workspace.consumeRepairFlags(estimate);
            if (!flags.length) return;
            markEstimateDirty(estimate.id);
            repairedIds.push(String(estimate.id));
        });
        return repairedIds;
    }
    function buildEstimateSummaryPayload(est) {
        if (!est) {
            return { subtotal: 0, directSales: 0, preTaxMarkup: 0, postTaxMarkup: 0, taxes: 0, total: 0, estimateTotal: 0, laborHours: 0 };
        }
        const calc = Calc.calculateSummary(est.groups || [], est.settings || {});
        const total = Number(calc.estimateTotal || 0);
        return {
            subtotal: Number(calc.direct?.totalCost || 0),
            directSales: Number(calc.direct?.totalSales || 0),
            preTaxMarkup: Number(calc.preTaxTotal || 0),
            postTaxMarkup: Number(calc.postTaxTotal || 0),
            taxes: Number(calc.totalTax || 0),
            total,
            estimateTotal: total,
            laborHours: Number(calc.direct?.adjustedLaborHours || 0)
        };
    }

    function syncPrimaryEstimateProjectMeta() {
        const list = Array.isArray(state?.estimates) ? state.estimates : [];
        if (!list.length) return null;
        const metaPrimaryId = String(window.ProjectState?.projectMeta?.primary_estimate_id || '');
        const primaryEst = list.find(row => Boolean(row.is_primary || row.isPrimary))
            || list.find(row => metaPrimaryId && String(row.id) === metaPrimaryId)
            || list[0];
        if (!primaryEst) return null;
        const primarySummary = buildEstimateSummaryPayload(primaryEst);
        primaryEst.is_primary = true;
        primaryEst.isPrimary = true;
        primaryEst.estimateSummary = primarySummary;
        primaryEst.estimateTotal = primarySummary.estimateTotal;
        primaryEst.totalSales = primarySummary.estimateTotal;
        primaryEst.grand_total = primarySummary.estimateTotal;
        primaryEst.total_amount = primarySummary.estimateTotal;
        if (window.ProjectState) {
            if (!window.ProjectState.projectMeta) window.ProjectState.projectMeta = {};
            window.ProjectState.projectMeta.primary_estimate_id = primaryEst.id;
            window.ProjectState.projectMeta.primary_estimate_total = primarySummary.estimateTotal;
            window.ProjectState.projectMeta.primary_quote_value = primarySummary.estimateTotal;
            window.ProjectState.projectMeta.total_sales = primarySummary.estimateTotal;
            window.ProjectState.projectMeta.estimate_total = primarySummary.estimateTotal;
            window.ProjectState.projectMeta.primary_estimate_updated_at = state.clientUiUpdatedAt || Workspace.now();
        }
        return primaryEst;
    }

    function saveLocal(options = {}) {
        state.groups = current().groups;
        const curEst = current();
        if (curEst) {
            const curSummary = buildEstimateSummaryPayload(curEst);
            curEst.estimateSummary = curSummary;
            curEst.estimateTotal = curSummary.estimateTotal;
            curEst.totalSales = curSummary.estimateTotal;
            curEst.grand_total = curSummary.estimateTotal;
            curEst.total_amount = curSummary.estimateTotal;
        }
        if (options.targetEstimateId && String(options.targetEstimateId) !== String(curEst?.id || '')) {
            const targetEst = state.estimates.find(row => String(row.id) === String(options.targetEstimateId));
            if (targetEst) {
                const targetSummary = buildEstimateSummaryPayload(targetEst);
                targetEst.estimateSummary = targetSummary;
                targetEst.estimateTotal = targetSummary.estimateTotal;
                targetEst.totalSales = targetSummary.estimateTotal;
                targetEst.grand_total = targetSummary.estimateTotal;
                targetEst.total_amount = targetSummary.estimateTotal;
            }
        }
        syncPrimaryEstimateProjectMeta();
        state.dirtyEstimateIds = [...dirtyEstimateIds];
        state.takeoffSyncDirtyIds = [...takeoffSyncDirtyIds];
        state.clientUiUpdatedAt = Workspace.now();
        const stored = Workspace.clone(state);
        if (!stored.pendingProjectCreationSync) delete stored.pendingProjectCreationSync;
        safeSetLocalStorage(storageKey, JSON.stringify(stored));
        if (options.publish !== false) publish(options);
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

    function publish(options = {}) {
        const total = summary();
        const syncSource = options.syncSource || 'estimating';
        window.dispatchEvent(new CustomEvent('takeoff:estimating-state-updated', {
            detail: {
                projectId: String(projectId), activeEstimateId: state.activeEstimateId,
                syncSource,
                estimates: state.estimates.map(row => ({
                    id: row.id,
                    name: row.name,
                    status: row.status,
                    is_primary: Boolean(row.is_primary || row.isPrimary),
                    isPrimary: Boolean(row.is_primary || row.isPrimary),
                    groups: row.groups,
                    settings: row.settings
                })),
                summary: {
                    material: total.direct.materialSales, labor: total.direct.laborSales,
                    equipment: total.direct.equipmentSales, preTaxMarkup: total.preTaxTotal,
                    taxes: total.totalTax, total: total.estimateTotal, profit: total.profit
                }
            }
        }));
        const currentGroups = current().groups || [];
        const currentSummaryRow = (window.ProjectState?.estimatesSummary || []).find(
            row => String(row?.id || '') === String(state.activeEstimateId || '')
        );
        const isUnloadedShell = ui.loadState === 'loading'
            && currentGroups.length === 0
            && Number(currentSummaryRow?.itemCount || 0) > 0;
        if (!isUnloadedShell && options.publishItems !== false) {
            window.dispatchEvent(new CustomEvent('takeoff:estimating-items-updated', {
                detail: {
                    version: 1, origin: 'estimating', syncSource, projectId: String(projectId),
                    activeEstimateId: String(state.activeEstimateId), revision: Number(current().revision || 0),
                    groups: Workspace.clone(currentGroups)
                }
            }));
        }
        window.dispatchEvent(new CustomEvent('takeoff:estimate-summary-updated', { detail: total }));
    }

    function changed(action, options = {}) {
        const activeId = String(state.activeEstimateId || '');
        if (action === 'Synchronized items from Takeoff') takeoffSyncDirtyIds.add(activeId);
        else takeoffSyncDirtyIds.delete(activeId);
        if (action && action !== 'Synchronized items from Takeoff') {
            estimatingHasUnsavedCheckpoint = true;
        }
        conflictedEstimateIds.delete(activeId);
        conflictRemoteEstimates.delete(activeId);
        Workspace.touch(state, action);
        // Server-side persistence rejects non-empty -> empty replacements by
        // default. Only a deliberate Estimating delete may carry the one-shot
        // intent that authorizes clearing the final item; Takeoff hydration and
        // synchronization never set this flag.
        if (options.allowEmptyGroupsReplace === true
            && !(current()?.groups || []).some(group => (group.items || []).length > 0)) {
            current().allowEmptyGroupsReplace = true;
        }
        saveLocal();
        scheduleSave(action === 'Synchronized items from Takeoff' ? 'takeoff' : 'manual');
        render();
    }

    function reactiveChanged(target) {
        estimatingHasUnsavedCheckpoint = true;
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

    function resolvedCategorySummaryMargin(catName, settings = {}, total = {}) {
        const cat = total?.byCategory?.[catName];
        if (cat && Math.abs(Number(cat.totalSales || 0)) > 0.0001 && Math.abs(Number(cat.totalCost || 0)) > 0.0001) {
            return Number(cat.marginPercent || 0);
        }
        if (catName === 'Labor') return Number(settings.globalLaborMargin ?? 34.6);
        if (catName === 'Equipment') return Number(settings.equipmentMargin ?? 15);
        return Number(settings.materialMargin ?? 15);
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
            const setSummaryInput = (selector, formatted) => {
                const el = aside.querySelector(selector);
                if (el && document.activeElement !== el) {
                    el.value = formatted;
                    el.dataset.auditPrevValue = formatted;
                }
            };
            const settings = current()?.settings || {};
            const gCost = Number(settings.globalLaborCost ?? 36);
            const gMargin = resolvedCategorySummaryMargin('Labor', settings, total);
            const effMatMargin = resolvedCategorySummaryMargin('Materials', settings, total);
            const effEqMargin = resolvedCategorySummaryMargin('Equipment', settings, total);
            const gSales = gMargin < 100 ? (gCost / (1 - gMargin / 100)) : gCost;
            setSummaryInput('[data-summary-rate="globalLaborCost"]', gCost.toFixed(2));
            setLive('global-labor-sales', gSales.toFixed(2));
            setSummaryInput('[data-summary-type="Labor"][data-field="margin"]', gMargin.toFixed(1));
            setSummaryInput('[data-summary-type="Labor"][data-field="difficulty"]', String(Number(settings.laborDifficulty ?? 1)));
            setSummaryInput('[data-summary-type="Labor"][data-field="waste"]', String(Number(settings.laborWaste ?? 0)));
            setSummaryInput('[data-summary-type="Materials"][data-field="margin"]', effMatMargin.toFixed(1));
            setSummaryInput('[data-summary-type="Materials"][data-field="waste"]', String(Number(settings.materialWaste ?? 0)));
            setSummaryInput('[data-summary-type="Equipment"][data-field="margin"]', effEqMargin.toFixed(1));
            setSummaryInput('[data-summary-type="Equipment"][data-field="waste"]', String(Number(settings.equipmentWaste ?? 0)));
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
            const updateRowCells = (tr, rowItem, rowCalc) => {
                if (!tr || !rowCalc) return;
                const setCell = (colKey, textVal, colorVal = '') => {
                    const cell = tr.querySelector(`[data-live-item-cell="${colKey}"]`);
                    if (cell) {
                        cell.textContent = textVal;
                        if (colorVal) cell.style.color = colorVal;
                    }
                };
                const eqRow = isEquipmentItem(rowItem);
                const unitSalesVal = eqRow && !rowCalc.unitMaterialSales
                    ? ((rowCalc.equipmentSales || 0) / (rowCalc.equipmentQuantity || rowCalc.baseQuantity || 1))
                    : (rowCalc.unitMaterialSales || 0);
                setCell('subtotal_item_cost', number(rowCalc.materialCost || 0, 2));
                setCell('unit_sales', number(unitSalesVal, 2));
                setCell('subtotal_item_sales', number(rowCalc.materialSales || 0, 2));
                const profitVal = rowCalc.profit || 0;
                setCell('profit', number(profitVal, 2), profitVal >= 0 ? '#10b981' : '#ef4444');
                setCell('total_labor_hrs', number(rowCalc.adjustedLaborHours || 0, 2));
                setCell('total_labor_cost', number(rowCalc.laborCost || 0, 2));
                setCell('total_cost', number(rowCalc.totalCost || 0, 2));
                const pct = totalSummaryCost > 0 ? ((rowCalc.totalCost || 0) / totalSummaryCost) * 100 : 0;
                setCell('total_cost_percent', `${number(pct, 1)}%`);
                setCell('total_sales', number(rowCalc.totalSales || 0, 2));
            };
            total.rows.forEach(({ item: rowItem, calc: rowCalc }) => {
                const tr = tableBody.querySelector(`tr[data-item-id="${selectorValue(rowItem.id)}"]`);
                updateRowCells(tr, rowItem, rowCalc);
                if (Array.isArray(rowCalc?.childRows) && rowCalc.childRows.length) {
                    rowCalc.childRows.forEach((childEntry, idx) => {
                        const childSource = findDirectAssemblyChild(rowItem, childEntry.item, idx);
                        const childKey = `${rowItem.id}:component:${childSource?.id || idx}`;
                        const childTr = tableBody.querySelector(`tr[data-item-id="${selectorValue(childKey)}"]`);
                        updateRowCells(childTr, childEntry.item, childEntry.calc);
                    });
                }
            });
            const grpLaborMargin = resolvedCategorySummaryMargin('Labor', current()?.settings || {}, total);
            (current()?.groups || []).forEach(grp => {
                const subCell = tableBody.querySelector(`[data-live-group-subtotal="${selectorValue(grp.id)}"]`);
                if (subCell) {
                    const grpSum = (grp.items || []).reduce((acc, it) => {
                        if (it.parentItemId || it.parent_item_id || it.assemblyParentId) return acc;
                        const c = calcById.get(String(it.id)) || Calc.calculateItem(it, current().settings);
                        return acc + (c.materialCost || 0);
                    }, 0);
                    subCell.textContent = number(grpSum, 2);
                }
                const grpLmCell = tableBody.querySelector(`[data-live-group-labor-margin="${selectorValue(grp.id)}"]`);
                if (grpLmCell) {
                    grpLmCell.textContent = `${Number(current()?.settings?.globalLaborMargin ?? grpLaborMargin).toFixed(1)}%`;
                }
            });
        }
        const cur = current();
        if (cur) {
            cur.estimateSummary = {
                subtotal: Number(total.direct?.totalCost || 0),
                directSales: Number(total.direct?.totalSales || 0),
                preTaxMarkup: Number(total.preTaxTotal || 0),
                postTaxMarkup: Number(total.postTaxTotal || 0),
                taxes: Number(total.totalTax || 0),
                total: Number(total.estimateTotal || 0),
                estimateTotal: Number(total.estimateTotal || 0),
                laborHours: Number(total.direct?.adjustedLaborHours || 0)
            };
            cur.estimateTotal = total.estimateTotal;
            cur.totalSales = total.estimateTotal;
            cur.grand_total = total.estimateTotal;
            cur.total_amount = total.estimateTotal;
        }
        syncPrimaryEstimateProjectMeta();
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

    function scheduleSave(source = 'manual', targetEstimateId = null) {
        if (!projectId) return;
        const activeId = String(targetEstimateId || state.activeEstimateId || '');
        if (source === 'takeoff') takeoffSyncDirtyIds.add(activeId);
        else takeoffSyncDirtyIds.delete(activeId);
        conflictedEstimateIds.delete(activeId);
        markEstimateDirty(activeId);
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

    function showSaveProgressModal(step = 1, message = 'Saving...') {
        let portal = document.querySelector('[data-est-save-progress-portal]');
        if (step === 0 || step === 4) {
            if (portal) {
                if (step === 4) {
                    const icon = portal.querySelector('.est-save-spinner');
                    if (icon) icon.innerHTML = '<i class="fas fa-circle-check" style="font-size: 32px; color: #10b981;"></i>';
                    const text = portal.querySelector('#estSaveProgressStep');
                    if (text) text.textContent = 'All changes saved successfully!';
                    const bar = portal.querySelector('#estSaveProgressBar');
                    if (bar) bar.style.width = '100%';
                    setTimeout(() => portal?.remove(), 650);
                } else {
                    portal.remove();
                }
            }
            return;
        }
        if (!portal) {
            portal = document.createElement('div');
            portal.className = 'pd-modal-backdrop open';
            portal.dataset.estSaveProgressPortal = 'true';
            portal.style.cssText = 'position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 9999999;';
            portal.innerHTML = `
                <div class="pd-modal bb-studio-modal" style="width: min(380px, 92vw); background: var(--bg-panel, #ffffff); border: 1px solid var(--border, #cbd5e1); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); padding: 24px 20px; text-align: center;" role="dialog" aria-modal="true">
                    <div class="est-save-spinner" style="margin-bottom: 12px;"><i class="fas fa-circle-notch fa-spin" style="font-size: 30px; color: var(--primary, #fb5a3a);"></i></div>
                    <h3 style="margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--text-main, #0f172a);">Saving Project</h3>
                    <div id="estSaveProgressStep" style="font-size: 13px; color: var(--text-muted, #64748b); min-height: 20px;">${esc(message)}</div>
                    <div style="margin-top: 16px; background: rgba(148,163,184,0.18); height: 5px; border-radius: 3px; overflow: hidden;">
                        <div id="estSaveProgressBar" style="width: ${step === 1 ? '30%' : (step === 2 ? '65%' : '90%')}; height: 100%; background: var(--primary, #fb5a3a); transition: width 0.35s ease;"></div>
                    </div>
                </div>`;
            document.body.appendChild(portal);
        } else {
            const text = portal.querySelector('#estSaveProgressStep');
            if (text) text.textContent = message;
            const bar = portal.querySelector('#estSaveProgressBar');
            if (bar) bar.style.width = step === 1 ? '30%' : (step === 2 ? '65%' : '90%');
        }
    }
    async function saveServer(options = {}) {
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
        ui.message = 'Saving...';
        renderStatus();
        const showModal = Boolean(options.showModal || ui.explicitSaveRequested);
        ui.explicitSaveRequested = false;
        if (showModal) showSaveProgressModal(1, 'Saving Estimating workspace...');
        const sentGenerations = new Map(sentIds.map(id => [id, dirtyGenerations.get(id) || 0]));
        const savePayload = estimates => buildEstimatePatchPayload(estimates);
        const sent = savePayload(sentIds);
        try {
            let result;
            try {
                result = await request('save', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(sent)
                });
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
                    body: JSON.stringify({ ...sent, updates: recoverable, estimates: recoverable, state: { ...sent.state, estimates: recoverable } })
                });
            }
            const activeBeforeSaveId = String(state.activeEstimateId || '');
            const activeBeforeSaveSig = groupsContentSignature(current()?.groups || []);
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
            syncPrimaryEstimateProjectMeta();
            if (showModal || ui.explicitSaveRequested) {
                estimatingHasUnsavedCheckpoint = false;
                ui.explicitSaveRequested = false;
            }
            ui.loadState = dirtyEstimateIds.size ? 'pending' : 'saved';
            ui.message = dirtyEstimateIds.size ? 'Unsaved changes' : 'Saved';
            const activeItemsUnchangedOnAck = String(state.activeEstimateId || '') === activeBeforeSaveId
                && activeBeforeSaveSig === groupsContentSignature(current()?.groups || []);
            sentIds.forEach(id => window.flushTakeoffDeletedLayersForEstimate?.(id));
            saveLocal({ publish: !activeEditingElement(), publishItems: !activeItemsUnchangedOnAck });
            if (showModal) {
                showSaveProgressModal(3, 'Updating Audit & Summaryâ€¦');
                setTimeout(() => showSaveProgressModal(4, 'Saved!'), 200);
            }
        } catch (error) {
            if (showModal) showSaveProgressModal(0);
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
        setEstimatingLoading(true, 'Loading estimate...');
        const requestLocalTimestamp = state.clientUiUpdatedAt;
        const forceMigratedLocal = state.pendingProjectCreationSync === true;
        try {
            const result = await request('list');
            const remoteSource = result.state || {};
            const remote = applyDeletedEstimateTombstones(Workspace.workspace(remoteSource, projectId));
            const local = state;
            const changedDuringLoad = local.clientUiUpdatedAt !== requestLocalTimestamp;

            // If local draft is empty but remote server has full estimates, adopt remote immediately
            const localHasContent = (state.estimates || []).some(est =>
                (est.groups || []).some(g => (g.items || []).length > 0)
            );
            const remoteHasContent = (remote.estimates || []).some(est =>
                (est.groups || []).some(g => (g.items || []).length > 0)
            );
            if (!localHasContent && remoteHasContent) {
                dirtyEstimateIds.clear();
                state = remote;
                try {
                    const pendingEstId = sessionStorage.getItem(`takeoff.pendingActivateEstimateId.${projectId}`);
                    if (pendingEstId) {
                        sessionStorage.removeItem(`takeoff.pendingActivateEstimateId.${projectId}`);
                        if (state.estimates.some(row => String(row.id) === String(pendingEstId))) {
                            Workspace.selectEstimate(state, pendingEstId);
                        }
                    }
                } catch (_) { }
                restoreDirtyTracking();
                const repairedIds = consumeAndMarkWorkspaceRepairs();
                saveLocal();
                ui.loadState = 'saved';
                ui.message = repairedIds.length ? 'Loaded and repaired duplicate assembly components' : 'Loaded from server';
                render();
                drainPendingTakeoff();
                hydrateBrokenAssembliesInCurrentEstimate();
                if (repairedIds.length) scheduleSave('workspace-repair', repairedIds[0]);
                return;
            }
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
                try {
                    const pendingEstId = sessionStorage.getItem(`takeoff.pendingActivateEstimateId.${projectId}`);
                    if (pendingEstId) {
                        sessionStorage.removeItem(`takeoff.pendingActivateEstimateId.${projectId}`);
                        if (state.estimates.some(row => String(row.id) === String(pendingEstId))) {
                            Workspace.selectEstimate(state, pendingEstId);
                        }
                    }
                } catch (_) { }
                restoreDirtyTracking();
                const repairedIds = consumeAndMarkWorkspaceRepairs();
                if (repairedIds.length) {
                    ui.message = 'Loaded and repaired duplicate assembly components';
                    scheduleSave('workspace-repair', repairedIds[0]);
                }
            }
            ui.loadState = 'saved';
            if (!ui.message.includes('repaired duplicate assembly components')) ui.message = 'Loaded from server';
            saveLocal();
        } catch (error) {
            ui.loadState = 'error';
            ui.message = `Offline: ${error.message}`;
        } finally {
            setEstimatingLoading(false);
        }
        render();
        drainPendingTakeoff();
        hydrateBrokenAssembliesInCurrentEstimate();
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
        remote.auditLog.push({
            id: Workspace.uid('audit'), at: remote.updatedAt,
            action: 'Merged Takeoff changes with concurrent server changes'
        });
        remote.auditLog = remote.auditLog.slice(-100);
        return remote;
    }

    function reconcileExistingTakeoffBindings(existingGroups, incomingGroups, importNewLayers = false, removeMissing = false) {
        if (importNewLayers && window.TakeoffEstimatingSyncService?.reconcileLinkedOnly) {
            return window.TakeoffEstimatingSyncService.reconcileLinkedOnly(existingGroups, incomingGroups, {
                removeMissing
            })
                .map(Workspace.group);
        }
        const incomingByLayer = new Map();
        const incomingGroupById = new Map();
        const incomingGroupByTakeoffId = new Map();
        (incomingGroups || []).forEach(group => {
            if (group?.id) incomingGroupById.set(String(group.id), group);
            if (group?.takeoffGroupId) incomingGroupByTakeoffId.set(String(group.takeoffGroupId), group);
            (group.items || group.layers || []).forEach(item => {
                const layerId = String(item.takeoffLayerId ?? item.id ?? '');
                if (layerId) incomingByLayer.set(layerId, { item, group });
            });
        });
        return (existingGroups || []).map((group, groupIndex) => {
            const matchedById = (group?.id && incomingGroupById.get(String(group.id)))
                || (group?.takeoffGroupId && incomingGroupByTakeoffId.get(String(group.takeoffGroupId)))
                || null;
            let matchedIncomingGroup = matchedById;
            const items = (group.items || []).flatMap(existing => {
                if (!existing.takeoffLayerId) return [existing];
                const incoming = incomingByLayer.get(String(existing.takeoffLayerId));
                // A drawing can publish before every sheet/layer has hydrated.
                // Missing bindings are not deletion intent. Destructive removal
                // must travel through an explicit Estimating delete operation.
                if (!incoming) return removeMissing ? [] : [existing];
                if (!matchedIncomingGroup && incoming.group) matchedIncomingGroup = incoming.group;
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
            });
            const isTakeoffLinked = Boolean(
                group.source === 'takeoff'
                || group.takeoffMirror
                || group.takeoffGroupId
                || String(group.id || '').startsWith('takeoff_')
            );
            return Workspace.group({
                ...Workspace.clone(group),
                name: (isTakeoffLinked && matchedIncomingGroup?.name) ? matchedIncomingGroup.name : group.name,
                items
            }, groupIndex);
        });
    }

    function preserveQuantityOverrides(existingGroups, nextGroups) {
        const preservedByKey = new Map();
        (existingGroups || []).forEach(grp => {
            (grp.items || []).forEach(it => {
                if (it.quantityOverride === true || String(it.quantitySyncStatus || '') === 'overridden' || (Array.isArray(it.children) && it.children.length > 0) || it.factorOverride !== undefined) {
                    if (it.id) preservedByKey.set(`id:${it.id}`, it);
                    if (it.takeoffLayerId) preservedByKey.set(`layer:${it.takeoffLayerId}`, it);
                }
            });
        });
        if (!preservedByKey.size) return nextGroups;
        return (nextGroups || []).map(grp => ({
            ...grp,
            items: (grp.items || []).map(it => {
                const match = (it.takeoffLayerId && preservedByKey.get(`layer:${it.takeoffLayerId}`))
                    || (it.id && preservedByKey.get(`id:${it.id}`));
                if (!match) return it;
                const isOverridden = Boolean(match.quantityOverride === true || String(match.quantitySyncStatus || '') === 'overridden');
                const measured = Workspace.numeric(it.lastSyncedTakeoffQuantity ?? it.originalQuantity ?? it.quantity);
                const updated = {
                    ...it,
                    ...(Array.isArray(match.children) && match.children.length > 0 ? { children: Workspace.clone(match.children), isAssembly: true } : {}),
                    ...(match.factorOverride !== undefined && match.factorOverride !== null ? { factorOverride: match.factorOverride } : {})
                };
                if (isOverridden) {
                    updated.quantity = Workspace.numeric(match.quantity);
                    updated.originalQuantity = measured;
                    updated.lastSyncedTakeoffQuantity = measured;
                    updated.pendingTakeoffQuantity = measured;
                    updated.quantityOverride = true;
                    updated.quantitySyncStatus = 'overridden';
                    if (match.quantityOverrideSource) updated.quantityOverrideSource = match.quantityOverrideSource;
                    if (match.origin) updated.origin = match.origin;
                }
                return updated;
            })
        }));
    }

    function cloneCopiedChildrenTree(children = [], parentItemId = null) {
        if (!Array.isArray(children) || !children.length) return [];
        return children.map(child => {
            const nextId = Workspace.uid('item');
            const cloned = Workspace.clone(child || {});
            delete cloned.dbEstimateItemId;
            delete cloned.estimateItemId;
            const nested = Array.isArray(cloned.children) && cloned.children.length ? cloned.children : [];
            cloned.id = nextId;
            cloned.parentItemId = parentItemId || null;
            cloned.children = nested.length ? cloneCopiedChildrenTree(nested, nextId) : [];
            return cloned;
        });
    }

    function inheritCopiedTakeoffAssemblyChildren(existingGroups, nextGroups) {
        const sourceByLayerId = new Map();
        (existingGroups || []).forEach(grp => {
            (grp.items || []).forEach(it => {
                if (it.takeoffLayerId) sourceByLayerId.set(String(it.takeoffLayerId), it);
                if (it.id && String(it.id).startsWith('takeoff_')) {
                    sourceByLayerId.set(String(it.id).slice(8), it);
                }
            });
        });
        if (!sourceByLayerId.size) return nextGroups;
        return (nextGroups || []).map(grp => ({
            ...grp,
            items: (grp.items || []).map(it => {
                if (!it.copiedFromTakeoffLayerId) return it;
                if (Array.isArray(it.children) && it.children.length > 0) return it;
                const src = sourceByLayerId.get(String(it.copiedFromTakeoffLayerId));
                if (!src) return it;
                const srcChildren = getItemChildren(src);
                if (!srcChildren.length && !isAssemblyItem(src)) return it;
                return Workspace.item({
                    ...it,
                    itemType: 'assembly',
                    isAssembly: true,
                    ...(src.catalogItemId && !it.catalogItemId ? { catalogItemId: src.catalogItemId } : {}),
                    ...(src.catalogSnapshot && !it.catalogSnapshot ? { catalogSnapshot: Workspace.clone(src.catalogSnapshot) } : {}),
                    children: srcChildren.length ? cloneCopiedChildrenTree(srcChildren, it.id) : []
                });
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
        const currentHasItems = (currentEstimate.groups || []).some(group => (group.items || []).length > 0);
        if (currentHasItems && groups.length === 0 && options.allowDestructiveReplacement !== true) {
            return;
        }
        let reconciled;
        if (currentEstimate.takeoffSyncMode === 'linked-only') {
            reconciled = reconcileExistingTakeoffBindings(currentEstimate.groups, groups,
                options.importNewLayers === true, options.allowMissingRemoval === true);
        } else if (groups.some(group => Array.isArray(group.items))) {
            reconciled = groups.map(Workspace.group);
        } else if (window.TakeoffEstimatingSyncService?.reconcile) {
            reconciled = window.TakeoffEstimatingSyncService.reconcile(currentEstimate.groups,
                groups).map(Workspace.group);
        } else {
            reconciled = groups.map(Workspace.group);
        }
        reconciled = preserveQuantityOverrides(currentEstimate.groups, reconciled);
        reconciled = inheritCopiedTakeoffAssemblyChildren(currentEstimate.groups, reconciled);
        if (groupsContentSignature(currentEstimate.groups) === groupsContentSignature(reconciled)) return;
        currentEstimate.groups = reconciled;
        currentEstimate.updatedAt = Workspace.now();
        const lastAudit = currentEstimate.auditLog[currentEstimate.auditLog.length - 1];
        if (lastAudit && lastAudit.action === 'Synchronized items from Takeoff') {
            lastAudit.at = currentEstimate.updatedAt;
        } else {
            currentEstimate.auditLog.push({
                id: Workspace.uid('audit'), at: currentEstimate.updatedAt,
                action: 'Synchronized items from Takeoff'
            });
            currentEstimate.auditLog = currentEstimate.auditLog.slice(-100);
        }
        takeoffSyncDirtyIds.add(activeId);
        markEstimateDirty(activeId);
        saveLocal({ syncSource: 'takeoff-sync', targetEstimateId: activeId });
        scheduleSave('takeoff', activeId);
        if (!options.backgroundEstimate) {
            render();
            if (reconciled.some(g => (g.items || []).some(assemblyNeedsHydration))) {
                hydrateBrokenAssembliesInCurrentEstimate();
            }
        }
    }

    function render(forceTable = false) {
        if (!forceTable && !isEstimatingTabActive()) {
            estimatingTableDirty = true;
            renderFooter();
            renderStatus();
            renderModal();
            return;
        }
        estimatingTableDirty = false;
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
        { id: 'waste', label: 'Material Waste (%)', align: 'right', minWidth: '95px' },
        { id: 'labor_waste', label: 'Labor Waste (%)', align: 'right', minWidth: '95px' },
        { id: 'subtotal_item_cost', label: 'Subtotal Item Cost ($)', align: 'right', minWidth: '135px' },
        { id: 'margin', label: 'Margin (%)', align: 'right', minWidth: '95px' },
        { id: 'labor_margin', label: 'Labor Margin (%)', align: 'right', minWidth: '110px' },
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
        } catch (_) { }
        return {
            cost_item: 320,
            budget_code: 120,
            quantity: 105,
            unit_cost: 110,
            waste: 95,
            labor_waste: 95,
            subtotal_item_cost: 135,
            margin: 95,
            labor_margin: 105,
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
            const saveCol = safeSetLocalStorage(COLUMNS_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
            void saveCol;
        } catch (_) { }
    }

    function filterValidColumnIds(raw) {
        if (!Array.isArray(raw) || raw.length === 0) return null;
        const validIds = new Set(ALL_CONFIG_COLUMNS.map(c => c.id));
        const filtered = raw.map(String).filter(id => validIds.has(id));
        return filtered.length > 0 ? filtered : null;
    }

    function getVisibleColumns() {
        const est = current();
        const fromEst = filterValidColumnIds(est?.settings?.visibleColumns);
        if (fromEst) return new Set(fromEst);
        const fromProjectMeta = filterValidColumnIds(window.ProjectState?.projectMeta?.estimatingTableSettings?.visibleColumns);
        if (fromProjectMeta) return new Set(fromProjectMeta);
        const perEstKey = est?.id ? `${COLUMNS_STORAGE_KEY}.${est.id}` : '';
        try {
            for (const key of [perEstKey, COLUMNS_STORAGE_KEY, 'takeoff.estimating.columns.default']) {
                if (!key) continue;
                const stored = localStorage.getItem(key);
                if (!stored) continue;
                const filtered = filterValidColumnIds(JSON.parse(stored));
                if (filtered) return new Set(filtered);
            }
        } catch (_) { }
        return new Set(DEFAULT_VISIBLE_COLUMNS);
    }

    function saveVisibleColumns(colSet, applyAll = false) {
        const list = Array.from(colSet);
        const active = current();
        const prevVisible = Array.from(getVisibleColumns());
        const currentOrder = (active?.settings?.columnsOrder && Array.isArray(active.settings.columnsOrder))
            ? [...active.settings.columnsOrder]
            : null;

        if (applyAll) {
            (state.estimates || []).forEach(est => {
                if (!est) return;
                est.settings = est.settings || {};
                est.settings.visibleColumns = list.slice();
                est.settings.tableSettingsApplyAll = true;
                if (currentOrder) est.settings.columnsOrder = currentOrder.slice();
                markEstimateDirty(est.id);
                safeSetLocalStorage(`${COLUMNS_STORAGE_KEY}.${est.id}`, JSON.stringify(list));
            });
            safeSetLocalStorage(COLUMNS_STORAGE_KEY, JSON.stringify(list));
            safeSetLocalStorage('takeoff.estimating.columns.default', JSON.stringify(list));
            if (window.ProjectState) {
                window.ProjectState.projectMeta = window.ProjectState.projectMeta || {};
                window.ProjectState.projectMeta.estimatingTableSettings = {
                    visibleColumns: list.slice(),
                    columnsOrder: currentOrder ? currentOrder.slice() : [],
                    applyAll: true
                };
            }
            estimatingHasUnsavedCheckpoint = true;
            saveLocal();
            scheduleSave('manual');
            if (projectId > 0) {
                setTimeout(() => { saveServer().catch(() => {}); }, 0);
            }
            return;
        }

        // Preserve previous column set on sibling estimates that never explicitly stored visibleColumns
        (state.estimates || []).forEach(est => {
            if (!est || String(est.id) === String(active?.id || '')) return;
            est.settings = est.settings || {};
            if (!filterValidColumnIds(est.settings.visibleColumns)) {
                est.settings.visibleColumns = prevVisible.slice();
                safeSetLocalStorage(`${COLUMNS_STORAGE_KEY}.${est.id}`, JSON.stringify(prevVisible));
                markEstimateDirty(est.id);
            }
        });
        if (active) {
            active.settings = active.settings || {};
            active.settings.visibleColumns = list.slice();
            delete active.settings.tableSettingsApplyAll;
            markEstimateDirty(active.id);
            safeSetLocalStorage(`${COLUMNS_STORAGE_KEY}.${active.id}`, JSON.stringify(list));
        } else {
            safeSetLocalStorage(COLUMNS_STORAGE_KEY, JSON.stringify(list));
        }
        if (window.ProjectState?.projectMeta?.estimatingTableSettings?.applyAll) {
            window.ProjectState.projectMeta.estimatingTableSettings = {
                ...window.ProjectState.projectMeta.estimatingTableSettings,
                applyAll: false
            };
        }
        estimatingHasUnsavedCheckpoint = true;
        saveLocal();
        scheduleSave('manual');
        if (projectId > 0) {
            setTimeout(() => { saveServer().catch(() => {}); }, 0);
        }
    }

    function getOrderedActiveColumns() {
        const visibleCols = getVisibleColumns();
        const est = current();
        let order = [];
        if (Array.isArray(est?.settings?.columnsOrder) && est.settings.columnsOrder.length > 0) {
            order = est.settings.columnsOrder;
        } else if (Array.isArray(window.ProjectState?.projectMeta?.estimatingTableSettings?.columnsOrder)
            && window.ProjectState.projectMeta.estimatingTableSettings.columnsOrder.length > 0) {
            order = window.ProjectState.projectMeta.estimatingTableSettings.columnsOrder;
        } else {
            const perEstOrderKey = est?.id ? `${COLUMNS_ORDER_STORAGE_KEY}.${est.id}` : '';
            try {
                for (const key of [perEstOrderKey, COLUMNS_ORDER_STORAGE_KEY]) {
                    if (!key) continue;
                    const stored = localStorage.getItem(key);
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            order = parsed;
                            break;
                        }
                    }
                }
            } catch (_) {}
        }

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
        const cleanOrder = Array.isArray(orderedIds) ? orderedIds.map(String) : [];
        const active = current();
        const applyAllActive = Boolean(active?.settings?.tableSettingsApplyAll || window.ProjectState?.projectMeta?.estimatingTableSettings?.applyAll);
        if (active) {
            active.settings = active.settings || {};
            active.settings.columnsOrder = cleanOrder.slice();
            safeSetLocalStorage(`${COLUMNS_ORDER_STORAGE_KEY}.${active.id}`, JSON.stringify(cleanOrder));
            markEstimateDirty(active.id);
        }
        if (applyAllActive) {
            (state.estimates || []).forEach(est => {
                if (!est) return;
                est.settings = est.settings || {};
                est.settings.columnsOrder = cleanOrder.slice();
                safeSetLocalStorage(`${COLUMNS_ORDER_STORAGE_KEY}.${est.id}`, JSON.stringify(cleanOrder));
                markEstimateDirty(est.id);
            });
            safeSetLocalStorage(COLUMNS_ORDER_STORAGE_KEY, JSON.stringify(cleanOrder));
            if (window.ProjectState?.projectMeta?.estimatingTableSettings) {
                window.ProjectState.projectMeta.estimatingTableSettings.columnsOrder = cleanOrder.slice();
            }
        }
        saveLocal();
        scheduleSave('manual');
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
        } catch (_) { }
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

    const PLACEHOLDER_COMPONENT_NAMES = new Set(['assembly part', 'assembly component', 'cost item', 'item']);

    function isPlaceholderComponentName(name) {
        const clean = String(name || '').trim().toLowerCase();
        return !clean || PLACEHOLDER_COMPONENT_NAMES.has(clean);
    }

    function resolveAssemblyComponentName(component, catalogItem = null) {
        const candidates = [
            component?.itemName, component?.item_name,
            component?.child_item_name, component?.childItemName, component?.child_name,
            component?.catalogItem?.name, component?.catalog_item?.name,
            component?.catalogSnapshot?.name,
            catalogItem?.itemName, catalogItem?.item_name, catalogItem?.name
        ];
        const resolved = candidates.find(value => {
            const trimmed = String(value || '').trim();
            return trimmed && !PLACEHOLDER_COMPONENT_NAMES.has(trimmed.toLowerCase());
        });
        if (resolved) return String(resolved).trim();
        const currentName = String(component?.name || '').trim();
        return currentName && !PLACEHOLDER_COMPONENT_NAMES.has(currentName.toLowerCase())
            ? currentName
            : 'Assembly component';
    }

    function assemblyComponentNeedsHydration(child) {
        if (!child || typeof child !== 'object') return false;
        if (isPlaceholderComponentName(child.name)) return true;
        const hasAnyCostOrLabor = Number(child.unitMaterialCost || 0) > 0
            || Number(child.unitEquipmentCost || 0) > 0
            || Number(child.unitSubcontractorCost || 0) > 0
            || Number(child.unitLabor || 0) > 0;
        return !hasAnyCostOrLabor && Boolean(child.catalogItemId || child.catalog_item_id || child.pricingSnapshot);
    }

    function repairAssemblyChildrenFromSnapshot(item) {
        if (!item || !Array.isArray(item.children) || !item.children.length) return false;
        const snapComps = Array.isArray(item.catalogSnapshot?.assemblyComponents)
            ? item.catalogSnapshot.assemblyComponents
            : (Array.isArray(item.catalogMetadata?.assemblyComponents) ? item.catalogMetadata.assemblyComponents : []);
        let changedAny = false;
        item.children.forEach((child, idx) => {
            const snapComp = snapComps.find(sc =>
                (child.assemblyComponentId && String(sc.id) === String(child.assemblyComponentId))
                || (child.catalogItemId && String(sc.catalogItemId ?? sc.part_catalog_item_id ?? '') === String(child.catalogItemId))
            ) || snapComps[idx] || null;
            const snap = child.pricingSnapshot || snapComp?.pricingSnapshot || {};
            if (isPlaceholderComponentName(child.name) && snapComp?.name && !isPlaceholderComponentName(snapComp.name)) {
                child.name = String(snapComp.name).trim();
                changedAny = true;
            }
            if (!child.uom && snapComp?.uom) {
                child.uom = String(snapComp.uom);
                changedAny = true;
            }
            if (!Number(child.unitMaterialCost || 0) && Number(snap.materialUnitCost || 0) > 0) {
                child.unitMaterialCost = Number(snap.materialUnitCost);
                child.unitCost = Number(snap.materialUnitCost);
                changedAny = true;
            }
            if (!Number(child.unitEquipmentCost || 0) && Number(snap.equipmentUnitCost || 0) > 0) {
                child.unitEquipmentCost = Number(snap.equipmentUnitCost);
                changedAny = true;
            }
            if (!Number(child.unitSubcontractorCost || 0) && Number(snap.subcontractorUnitCost || 0) > 0) {
                child.unitSubcontractorCost = Number(snap.subcontractorUnitCost);
                changedAny = true;
            }
            if (!Number(child.unitLabor || 0) && Number(snap.laborHoursPerUnit || 0) > 0) {
                child.unitLabor = Number(snap.laborHoursPerUnit);
                child.laborUnitType = 'hrs';
                changedAny = true;
            }
            if ((!Number(child.laborRate || 0)) && Number(snap.laborRate || 0) > 0) {
                child.laborRate = Number(snap.laborRate);
                changedAny = true;
            }
        });
        return changedAny;
    }

    function assemblyNeedsHydration(item) {
        if (!item || !isAssemblyItem(item)) return false;
        const children = getItemChildren(item);
        if (children.length === 0) return true;
        return children.some(assemblyComponentNeedsHydration);
    }

    async function fetchCatalogHydrationBundle() {
        if (ui._catalogHydrationCache) return ui._catalogHydrationCache;
        if (ui._catalogHydrationPromise) return ui._catalogHydrationPromise;
        ui._catalogHydrationPromise = (async () => {
            try {
                if (window.CatalogService?.getSnapshot) {
                    const snapshot = await window.CatalogService.getSnapshot({ enabledForProjectsOnly: false });
                    if (snapshot && Array.isArray(snapshot.items) && snapshot.items.length) {
                        const items = snapshot.items;
                        const itemsById = new Map(items.map(it => [String(it.id), it]));
                        ui._catalogHydrationCache = { mode: 'dto', items, itemsById };
                        return ui._catalogHydrationCache;
                    }
                }
                const res = await fetch('../api/cost_catalog.php?action=snapshot');
                const data = await res.json();
                if (data?.status === 'success') {
                    const items = Array.isArray(data.data?.items) ? data.data.items : [];
                    const assemblyParts = Array.isArray(data.data?.assemblyParts) ? data.data.assemblyParts : [];
                    const itemsById = new Map(items.map(it => [String(it.id), it]));
                    ui._catalogHydrationCache = { mode: 'raw', items, assemblyParts, itemsById };
                    return ui._catalogHydrationCache;
                }
            } catch (err) {
                console.warn('Could not load catalog snapshot for assembly hydration:', err);
            } finally {
                ui._catalogHydrationPromise = null;
            }
            return null;
        })();
        return ui._catalogHydrationPromise;
    }

    function applyHydratedChildFields(existingChild, resolved) {
        const next = { ...existingChild };
        if (isPlaceholderComponentName(next.name) && resolved.name) next.name = resolved.name;
        if (!next.description && resolved.description) next.description = resolved.description;
        if ((!next.uom || next.uom === 'ea') && resolved.uom) next.uom = resolved.uom;
        if (!next.costCode && resolved.costCode) next.costCode = resolved.costCode;
        if (resolved.itemType && (!next.itemType || next.itemType === 'part')) next.itemType = resolved.itemType;
        if (resolved.costCategory && (!next.costCategory || next.costCategory === 'Materials' || next.costCategory === 'Other')) {
            next.costCategory = resolved.costCategory;
        }
        if (!Number(next.unitMaterialCost || 0) && Number(resolved.unitMaterialCost || 0) > 0) {
            next.unitMaterialCost = Number(resolved.unitMaterialCost);
            next.unitCost = Number(resolved.unitMaterialCost);
        }
        if (!Number(next.unitEquipmentCost || 0) && Number(resolved.unitEquipmentCost || 0) > 0) {
            next.unitEquipmentCost = Number(resolved.unitEquipmentCost);
        }
        if (!Number(next.unitSubcontractorCost || 0) && Number(resolved.unitSubcontractorCost || 0) > 0) {
            next.unitSubcontractorCost = Number(resolved.unitSubcontractorCost);
        }
        if (!Number(next.unitLabor || 0) && Number(resolved.unitLabor || 0) > 0) {
            next.unitLabor = Number(resolved.unitLabor);
            next.laborUnitType = 'hrs';
        }
        if ((!Number(next.laborRate || 0)) && Number(resolved.laborRate || 0) > 0) {
            next.laborRate = Number(resolved.laborRate);
        }
        return next;
    }

    async function hydrateAssemblyPartsFromCatalog(item, catalogId) {
        if (!item) return false;
        const snapshotPatched = repairAssemblyChildrenFromSnapshot(item);
        const existingChildren = getItemChildren(item);
        if (existingChildren.length > 0 && !existingChildren.some(assemblyComponentNeedsHydration)) {
            if (snapshotPatched) saveLocal({ publish: false });
            return snapshotPatched;
        }
        if (typeof fetch !== 'function') return snapshotPatched;
        try {
            const bundle = await fetchCatalogHydrationBundle();
            if (!bundle) return snapshotPatched;
            const { mode, items, itemsById, assemblyParts = [] } = bundle;
            const defaultLaborRate = Number(current()?.settings?.globalLaborCost || 36);
            let hydratedAny = snapshotPatched;

            const buildResolvedFromDto = (partDto, comp = {}) => {
                const snap = comp.pricingSnapshot || {};
                const partType = String(partDto?.type || comp.itemType || 'PART').toUpperCase();
                return {
                    catalogItemId: partDto?.id ?? comp.catalogItemId,
                    name: resolveAssemblyComponentName(comp, partDto),
                    description: partDto?.description || comp.description || '',
                    uom: partDto?.uom || comp.uom || 'ea',
                    costCode: partDto?.classification?.costCode || comp.costCode || '',
                    itemType: partType.toLowerCase(),
                    costCategory: partType === 'EQUIPMENT' ? 'Equipment' : (partType === 'LABOR' ? 'Labor' : 'Materials'),
                    quantity: Number(comp.quantity || 1),
                    unitMaterialCost: Number(partDto?.pricing?.materialUnitCost ?? snap.materialUnitCost ?? 0),
                    unitEquipmentCost: Number(partDto?.pricing?.equipmentUnitCost ?? snap.equipmentUnitCost ?? 0),
                    unitSubcontractorCost: Number(partDto?.pricing?.subcontractorUnitCost ?? snap.subcontractorUnitCost ?? 0),
                    unitLabor: Number(partDto?.pricing?.laborHoursPerUnit ?? snap.laborHoursPerUnit ?? 0),
                    laborUnitType: 'hrs',
                    laborRate: (Number(partDto?.pricing?.laborRate || snap.laborRate || 0) > 0)
                        ? Number(partDto?.pricing?.laborRate || snap.laborRate)
                        : null,
                    waste: Number(comp.waste || 0)
                };
            };

            if (existingChildren.length > 0) {
                const targetCatalogId = catalogId || item.catalogItemId || item.catalog_item_id || item.catalogSnapshot?.catalogItemId || item.catalogSnapshot?.id;
                const catItem = targetCatalogId
                    ? itemsById.get(String(targetCatalogId))
                    : items.find(it => it.name && it.name.trim().toLowerCase() === String(item.name || '').trim().toLowerCase());
                const catComps = Array.isArray(catItem?.assemblyComponents) ? catItem.assemblyComponents : [];

                item.children = existingChildren.map((child, idx) => {
                    const childCatId = String(child.catalogItemId ?? child.catalog_item_id ?? catComps[idx]?.catalogItemId ?? '');
                    const partDto = childCatId ? itemsById.get(childCatId) : null;
                    if (!partDto) return child;
                    if (mode === 'dto') {
                        const resolved = buildResolvedFromDto(partDto, catComps[idx] || child);
                        hydratedAny = true;
                        return applyHydratedChildFields(child, resolved);
                    }
                    const resolved = {
                        name: resolveAssemblyComponentName(child, partDto),
                        description: partDto.description || '',
                        uom: partDto.unit_of_measure || 'ea',
                        costCode: partDto.cost_code || '',
                        itemType: String(partDto.item_type || 'part').toLowerCase(),
                        costCategory: String(partDto.cost_type || 'Materials'),
                        unitMaterialCost: Number(partDto.material_cost || partDto.unit_cost || 0),
                        unitEquipmentCost: Number(partDto.equipment_cost || 0),
                        unitSubcontractorCost: Number(partDto.subcontractor_cost || 0),
                        unitLabor: Number(partDto.labor_hours || 0),
                        laborUnitType: 'hrs',
                        laborRate: Number(partDto.labor_rate || 0) > 0 ? Number(partDto.labor_rate) : null
                    };
                    hydratedAny = true;
                    return applyHydratedChildFields(child, resolved);
                });
                if (hydratedAny) saveLocal({ publish: false });
                return hydratedAny;
            }

            if (mode === 'dto') {
                const catItem = items.find(it => (catalogId && String(it.id) === String(catalogId))
                    || (it.name && it.name.trim().toLowerCase() === String(item.name || '').trim().toLowerCase()));
                if (catItem && Array.isArray(catItem.assemblyComponents) && catItem.assemblyComponents.length > 0) {
                    item.children = catItem.assemblyComponents.map(comp => {
                        const partDto = itemsById.get(String(comp.catalogItemId));
                        const resolved = buildResolvedFromDto(partDto, comp);
                        return {
                            id: Workspace.uid('item'),
                            catalogItemId: resolved.catalogItemId,
                            name: resolved.name,
                            description: resolved.description,
                            quantity: resolved.quantity,
                            uom: resolved.uom,
                            costCode: resolved.costCode,
                            itemType: resolved.itemType,
                            costCategory: resolved.costCategory,
                            unitCost: resolved.unitMaterialCost,
                            unitMaterialCost: resolved.unitMaterialCost,
                            unitEquipmentCost: resolved.unitEquipmentCost,
                            unitSubcontractorCost: resolved.unitSubcontractorCost,
                            waste: resolved.waste,
                            unitLabor: resolved.unitLabor,
                            laborUnitType: 'hrs',
                            laborRate: resolved.laborRate
                        };
                    });
                    saveLocal({ publish: false });
                    return true;
                }
                return snapshotPatched;
            }

            let resolvedCatId = catalogId;
            if (!resolvedCatId && item.name) {
                const matchedItem = items.find(ci => ci.name && ci.name.trim().toLowerCase() === String(item.name).trim().toLowerCase());
                if (matchedItem) resolvedCatId = matchedItem.id;
            }
            const matchingParts = assemblyParts.filter(p => String(p.assembly_catalog_item_id) === String(resolvedCatId));
            if (matchingParts.length > 0) {
                item.children = matchingParts.map(p => ({
                    id: Workspace.uid('item'),
                    catalogItemId: p.part_catalog_item_id,
                    name: resolveAssemblyComponentName(p, itemsById.get(String(p.part_catalog_item_id))),
                    description: p.child_description || '',
                    quantity: Number(p.quantity || 1),
                    uom: p.child_unit_of_measure || 'ea',
                    unitCost: Number(p.child_unit_cost || p.unit_cost_snapshot || 0),
                    unitMaterialCost: Number(p.child_unit_cost || p.unit_cost_snapshot || 0),
                    waste: Number(p.waste_percent || 0),
                    unitLabor: Number(p.child_labor_hours || p.labor_hours_snapshot || 0),
                    laborUnitType: 'hrs',
                    laborRate: Number(p.labor_rate || 0) > 0 ? Number(p.labor_rate) : null
                }));
                saveLocal({ publish: false });
                return true;
            }
            return snapshotPatched;
        } catch (err) {
            console.warn('Could not hydrate assembly components:', err);
            return snapshotPatched;
        }
    }

    async function hydrateBrokenAssembliesInCurrentEstimate() {
        const broken = allItems()
            .map(r => r.item)
            .filter(it => assemblyNeedsHydration(it));
        if (!broken.length) return;
        let updatedAny = false;
        for (const it of broken) {
            const catId = it.catalogItemId || it.catalog_item_id || it.catalogSnapshot?.catalogItemId || it.catalogSnapshot?.id || it.catalog_id;
            if (await hydrateAssemblyPartsFromCatalog(it, catId)) updatedAny = true;
        }
        if (updatedAny) {
            renderTable();
            renderDetails();
        }
    }

    function toggleAssemblyExpansion(itemId) {
        const id = String(itemId);
        if (ui.expandedAssemblies.has(id)) {
            ui.expandedAssemblies.delete(id);
            renderTable();
            return;
        }
        const found = findItem(id);
        const it = found?.item;
        if (it && assemblyNeedsHydration(it)) {
            const catId = it.catalogItemId || it.catalog_item_id || it.catalogSnapshot?.catalogItemId || it.catalogSnapshot?.id || it.catalog_id;
            repairAssemblyChildrenFromSnapshot(it);
            hydrateAssemblyPartsFromCatalog(it, catId).finally(() => {
                ui.expandedAssemblies.add(id);
                renderTable();
            });
            return;
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
                        <label class="est-col-toggle-card">
                            <span class="proposal-switch est-switch">
                                <input type="checkbox" data-col-switch="${col.id}" ${visibleCols.has(col.id) ? 'checked' : ''}>
                                <span class="proposal-slider est-switch-slider"></span>
                            </span>
                            <span class="est-col-toggle-label">${esc(col.label)}</span>
                        </label>
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
                <button type="button" class="btn-ghost est-drawer-cancel-btn" data-drawer-cancel>Cancel</button>
                <button type="button" class="btn-main est-drawer-save-btn" data-drawer-save>Save Changes</button>
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

    function zeroEstimatingItemQuantity(item) {
        if (!item || typeof item !== 'object') return item;
        const isTakeoffLinked = Boolean(item.takeoffLayerId);
        const measuredTakeoffQuantity = isTakeoffLinked
            ? Workspace.numeric(item.lastSyncedTakeoffQuantity ?? item.originalQuantity ?? item.quantity)
            : null;
        item.quantity = 0;
        item._manualFields = item._manualFields && typeof item._manualFields === 'object'
            ? item._manualFields : {};
        item._manualFields.quantity = true;
        if (isTakeoffLinked) {
            // Zero is an intentional Estimating override. Keep the latest
            // measured Takeoff value available for review/restore without
            // allowing the next canvas snapshot to bounce the quantity back.
            item.quantityOverride = true;
            item.pendingTakeoffQuantity = measuredTakeoffQuantity;
            item.quantitySyncStatus = 'overridden';
            item.quantityOverrideSource = 'reset_zero';
        } else {
            item.quantityOverride = false;
            item.pendingTakeoffQuantity = null;
            item.quantitySyncStatus = 'manual';
            delete item.quantityOverrideSource;
        }
        return item;
    }

    function handleActionPopoverClick(event) {
        const target = event.target;
        const popGroupAction = target.closest('[data-popover-group-action]');
        if (popGroupAction) {
            const act = popGroupAction.dataset.popoverGroupAction;
            const grpId = popGroupAction.dataset.groupId;
            hideActionPopover();
            if (act === 'create-item') {
                addItem(grpId);
            } else if (act === 'reset-quantity') {
                const grp = current().groups.find(g => String(g.id) === String(grpId));
                if (grp) {
                    grp.items.forEach(item => zeroEstimatingItemQuantity(item));
                    changed(`Reset quantities for group "${grp.name}"`);
                }
            } else if (act === 'rename-group') {
                const input = root.querySelector(`input[data-group-name="${selectorValue(grpId)}"]`);
                input?.focus();
                input?.select();
            } else if (act === 'copy-group') {
                const grp = current().groups.find(g => String(g.id) === String(grpId));
                if (grp) {
                    const copy = Workspace.clone(grp);
                    copy.id = Workspace.uid('group');
                    copy.name = `${grp.name} (Copy)`;
                    copy.items = (grp.items || []).map(it => duplicateEstimatingItem(it)).map(it => {
                        if (it && it.name.endsWith(' (Copy)')) it.name = it.name.slice(0, -7);
                        return it;
                    });
                    const idx = current().groups.indexOf(grp);
                    current().groups.splice(idx + 1, 0, copy);
                    changed(`Copied ${grp.name}`);
                }
            } else if (act === 'export-bom') {
                exportEstimate('bom-excel');
            } else if (act === 'delete-group') {
                if (confirm('Delete this group and its items?')) {
                    const targetGroup = current().groups.find(row => String(row.id) === String(grpId));
                    const removedItems = targetGroup?.items || [];
                    current().groups = current().groups.filter(row => String(row.id) !== String(grpId));
                    notifyTakeoffDeletedEstimatingItems(removedItems);
                    changed('Deleted group', { allowEmptyGroupsReplace: true });
                }
            }
            return true;
        }
        const popItemAction = target.closest('[data-popover-item-action]');
        if (popItemAction) {
            const act = popItemAction.dataset.popoverItemAction;
            const itId = popItemAction.dataset.itemId;
            hideActionPopover();
            const found = findItem(itId);
            if (!found) return true;
            if (act === 'edit-item') {
                openProjectItemEditModal(found.item, found.group);
            } else if (act === 'copy-item') {
                const index = found.group.items.indexOf(found.item);
                const duplicate = duplicateEstimatingItem(found.item);
                if (duplicate) {
                    found.group.items.splice(index + 1, 0, duplicate);
                    changed(isAssemblyItem(found.item) ? `Duplicated ${found.item.name}` : `Copied ${found.item.name}`);
                }
            } else if (act === 'replace-item') {
                ui.catalogTargetGroupId = found.group.id;
                ui.replaceTargetItemId = found.item.id;
                ui.modal = 'catalog';
                renderModal();
            } else if (act === 'reset-quantity') {
                const prevQty = found.item.quantity;
                zeroEstimatingItemQuantity(found.item);
                changed(`Reset quantity for "${found.item.name}" (${formatAuditVal(prevQty, 'qty', found.item.uom)} -> ${formatAuditVal(0, 'qty', found.item.uom)})`);
            } else if (act === 'reset-budget-code') {
                found.item.costCode = '16-1...';
                found.item.budgetCode = '16-1...';
                changed(`Reset budget code for "${found.item.name}"`);
            } else if (act === 'delete-item') {
                const removedItem = found.item;
                found.group.items = found.group.items.filter(row => String(row.id) !== String(itId));
                ui.expandedAssemblies.delete(String(itId));
                notifyTakeoffDeletedEstimatingItems([removedItem]);
                changed(`Deleted ${removedItem.name}`, { allowEmptyGroupsReplace: true });
            }
            return true;
        }
        return false;
    }
    function showActionPopover(triggerBtn, htmlContent, triggerKey = '') {
        let pop = $('estActionPopover');
        if (!pop) {
            pop = document.createElement('div');
            pop.id = 'estActionPopover';
            pop.className = 'est-popover-menu';
            pop.addEventListener('click', handleActionPopoverClick);
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
            } catch (_) { }

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
                    } catch (_) { }
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
        let draggedRowItemId = null;
        let lastDragRow = null;

        table.addEventListener('dragstart', e => {
            if (resizingCol || e.target.closest('.est-col-resizer') || document.body.style.cursor === 'col-resize') {
                e.preventDefault();
                return false;
            }
            const grip = e.target.closest('.est-row-grip');
            if (grip) {
                const row = grip.closest('tr.est-item-row');
                if (!row) { e.preventDefault(); return false; }
                draggedRowItemId = row.dataset.itemId;
                e.dataTransfer.setData('text/plain', draggedRowItemId);
                e.dataTransfer.setData('application/x-est-item', draggedRowItemId);
                e.dataTransfer.effectAllowed = 'move';
                row.classList.add('est-row-dragging');
                return;
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
            if (draggedRowItemId) {
                const itemRow = e.target.closest('tr.est-item-row');
                const groupRow = e.target.closest('tr.est-group-row');
                if (itemRow && itemRow.dataset.itemId !== draggedRowItemId) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const rect = itemRow.getBoundingClientRect();
                    const isTop = e.clientY < rect.top + rect.height / 2;
                    if (lastDragRow && lastDragRow !== itemRow) {
                        lastDragRow.classList.remove('est-row-drag-over-top', 'est-row-drag-over-bottom', 'est-group-drag-over');
                    }
                    lastDragRow = itemRow;
                    itemRow.classList.toggle('est-row-drag-over-top', isTop);
                    itemRow.classList.toggle('est-row-drag-over-bottom', !isTop);
                    return;
                }
                if (groupRow) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (lastDragRow && lastDragRow !== groupRow) {
                        lastDragRow.classList.remove('est-row-drag-over-top', 'est-row-drag-over-bottom', 'est-group-drag-over');
                    }
                    lastDragRow = groupRow;
                    groupRow.classList.add('est-group-drag-over');
                    return;
                }
                return;
            }

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
            if (draggedRowItemId) {
                const row = e.target.closest('tr.est-item-row, tr.est-group-row');
                if (row && e.relatedTarget && !row.contains(e.relatedTarget)) {
                    row.classList.remove('est-row-drag-over-top', 'est-row-drag-over-bottom', 'est-group-drag-over');
                    if (lastDragRow === row) lastDragRow = null;
                }
                return;
            }
            const th = e.target.closest('.est-th-draggable');
            if (th && e.relatedTarget && !th.contains(e.relatedTarget)) {
                th.classList.remove('est-th-drag-over-left', 'est-th-drag-over-right');
                if (lastDragTh === th) lastDragTh = null;
            }
        });

        table.addEventListener('drop', e => {
            if (draggedRowItemId) {
                e.preventDefault();
                const itemRow = e.target.closest('tr.est-item-row');
                const groupRow = e.target.closest('tr.est-group-row');
                if (itemRow && itemRow.dataset.itemId !== draggedRowItemId) {
                    const rect = itemRow.getBoundingClientRect();
                    const isBefore = e.clientY < rect.top + rect.height / 2;
                    moveEstimatingItem(draggedRowItemId, itemRow.dataset.itemId, null, isBefore);
                } else if (groupRow) {
                    moveEstimatingItem(draggedRowItemId, null, groupRow.dataset.groupId, false);
                }
                table.querySelectorAll('.est-row-dragging, .est-row-drag-over-top, .est-row-drag-over-bottom, .est-group-drag-over').forEach(el => {
                    el.classList.remove('est-row-dragging', 'est-row-drag-over-top', 'est-row-drag-over-bottom', 'est-group-drag-over');
                });
                draggedRowItemId = null;
                lastDragRow = null;
                return;
            }

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
            draggedRowItemId = null;
            lastDragRow = null;
            if (dragOverRaf) { cancelAnimationFrame(dragOverRaf); dragOverRaf = null; }
            table.querySelectorAll('.est-th-draggable, .est-row-dragging, .est-row-drag-over-top, .est-row-drag-over-bottom, .est-group-drag-over').forEach(el => {
                el.classList.remove('est-th-dragging', 'est-th-drag-over-left', 'est-th-drag-over-right', 'est-row-dragging', 'est-row-drag-over-top', 'est-row-drag-over-bottom', 'est-group-drag-over');
            });
        });
    }

    function finalizeEstimatingTableRender(generation) {
        if (generation !== estimatingTableRenderGeneration) return;
        root.querySelectorAll('input[type="checkbox"][data-indeterminate="true"]').forEach(cb => {
            cb.indeterminate = true;
        });
        if (estimatingLoadingMessages.has('switch')) {
            const reveal = () => {
                if (generation === estimatingTableRenderGeneration) {
                    setEstimatingLoading(false, undefined, 'switch');
                }
            };
            // Let the loader paint even when the new table fits in a single render.
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => requestAnimationFrame(reveal));
            } else {
                setTimeout(reveal, 0);
            }
        }
    }

    function renderEstimatingRows(body, rows, emptyHtml, generation) {
        if (!rows.length) {
            body.innerHTML = emptyHtml;
            finalizeEstimatingTableRender(generation);
            return;
        }
        const canChunk = rows.length > ESTIMATING_TABLE_CHUNK_THRESHOLD
            && typeof requestAnimationFrame === 'function';
        if (!canChunk) {
            body.innerHTML = rows.join('');
            finalizeEstimatingTableRender(generation);
            return;
        }

        body.innerHTML = rows.slice(0, ESTIMATING_TABLE_CHUNK_SIZE).join('');
        let offset = ESTIMATING_TABLE_CHUNK_SIZE;
        const appendChunk = () => {
            if (generation !== estimatingTableRenderGeneration || !body.isConnected) return;
            const nextOffset = Math.min(offset + ESTIMATING_TABLE_CHUNK_SIZE, rows.length);
            body.insertAdjacentHTML('beforeend', rows.slice(offset, nextOffset).join(''));
            offset = nextOffset;
            if (offset < rows.length) {
                requestAnimationFrame(appendChunk);
                return;
            }
            finalizeEstimatingTableRender(generation);
        };
        requestAnimationFrame(appendChunk);
    }

    function renderTable() {
        const head = $('estTableHead');
        const body = $('estTableBody');
        if (!head || !body) return;
        const renderGeneration = ++estimatingTableRenderGeneration;

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
                    return `<td class="text-right"><span class="est-group-item-count">${visible.length} x</span></td>`;
                }
                if (col.id === 'subtotal_item_cost') {
                    return `<td class="text-right est-money est-group-subtotal" data-live-group-subtotal="${esc(group.id)}">${number(groupSubtotalCost, 2)}</td>`;
                }
                if (col.id === 'labor_margin') {
                    const gMargin = Number(current()?.settings?.globalLaborMargin ?? 34.6);
                    return `<td class="text-right est-group-labor-margin" data-live-group-labor-margin="${esc(group.id)}">${gMargin.toFixed(1)}%</td>`;
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
                                <span class="est-assembly-empty-note">No components defined in this assembly</span>
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

        renderEstimatingRows(
            body,
            html,
            `<tr><td colspan="${activeColumns.length + 3}" class="est-empty">No estimate items. Create a group or add items in Takeoff.</td></tr>`,
            renderGeneration
        );

        const deleteButton = root.querySelector('[data-est-action="delete-selected"]');
        if (deleteButton) deleteButton.disabled = ui.selected.size === 0;
        syncEstimatingSubheadInfo();

        attachTableResizeAndDragOnce();
    }

    function closeEstimatingSubheadMovePopover() {
        document.getElementById('estimatingSubheadMovePopover')?.remove();
        document.getElementById('estimatingSubheadCopyPopover')?.remove();
    }

    function selectedEstimatingSubheadRows() {
        return allItems().filter(({ item }) =>
            !item.parentItemId && !item.parent_item_id && !item.assemblyParentId
            && (ui.selected.has(item.id) || ui.selected.has(String(item.id)))
        );
    }

    function collectDescendantIds(groupItems, rootIds) {
        const ids = new Set(rootIds.map(String));
        let added = true;
        while (added) {
            added = false;
            (groupItems || []).forEach(it => {
                const pid = it.parentItemId ?? it.parent_item_id ?? it.assemblyParentId;
                if (pid !== null && pid !== undefined && ids.has(String(pid)) && !ids.has(String(it.id))) {
                    ids.add(String(it.id));
                    added = true;
                }
            });
        }
        return ids;
    }

    async function confirmEstimatingSubheadAction(options = {}) {
        if (typeof window.showConfirmDialog === 'function') {
            return await window.showConfirmDialog(options);
        }
        return window.confirm(options.message || 'Are you sure you want to proceed?');
    }

    async function deleteSelectedEstimatingItems() {
        const selectedRows = selectedEstimatingSubheadRows();
        const selectedCount = selectedRows.length;
        if (!selectedCount) return;
        closeEstimatingSubheadMovePopover();
        const confirmed = await confirmEstimatingSubheadAction({
            title: selectedCount === 1 ? 'Delete Selected Item' : 'Delete Selected Items',
            message: `Delete ${selectedCount} selected item${selectedCount === 1 ? '' : 's'} from this estimate?`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            type: 'error',
            badge: 'CONFIRM DELETE',
            icon: 'fas fa-trash',
            primaryDanger: true
        });
        if (!confirmed) return;

        const rootIds = selectedRows.map(({ item }) => item.id);
        const removedItems = [];
        current().groups.forEach(group => {
            const removeIds = collectDescendantIds(group.items || [], rootIds);
            group.items = (group.items || []).filter(item => {
                if (removeIds.has(String(item.id)) || ui.selected.has(item.id) || ui.selected.has(String(item.id))) {
                    ui.expandedAssemblies.delete(String(item.id));
                    removedItems.push(item);
                    return false;
                }
                return true;
            });
        });
        ui.selected.clear();
        notifyTakeoffDeletedEstimatingItems(removedItems);
        changed('Deleted selected items', { allowEmptyGroupsReplace: true });
    }

    async function copySelectedEstimatingItemsToGroup(targetGroupId) {
        const groups = current().groups || [];
        const targetGroup = groups.find(g => String(g.id) === String(targetGroupId));
        if (!targetGroup) return;
        const selectedRows = selectedEstimatingSubheadRows();
        if (!selectedRows.length) return;
        closeEstimatingSubheadMovePopover();

        const count = selectedRows.length;
        const targetName = targetGroup.name || 'Untitled Group';
        const confirmed = await confirmEstimatingSubheadAction({
            title: count === 1 ? 'Copy Item to Group' : 'Copy Items to Group',
            message: `Copy ${count} selected item${count === 1 ? '' : 's'} to "${targetName}"?`,
            confirmText: 'Copy',
            cancelText: 'Cancel',
            type: 'info',
            badge: 'COPY ITEMS',
            icon: 'fas fa-copy',
            primaryDanger: false
        });
        if (!confirmed) return;

        const assignGroupMeta = (node, grp) => {
            node.groupId = grp.id;
            node.groupName = grp.name;
            if (Array.isArray(node.children)) {
                node.children.forEach(child => assignGroupMeta(child, grp));
            }
            return node;
        };

        let copied = 0;
        targetGroup.items = targetGroup.items || [];
        selectedRows.forEach(({ item }) => {
            const copy = duplicateEstimatingItem(item);
            if (!copy) return;
            assignGroupMeta(copy, targetGroup);
            const srcIdx = targetGroup.items.indexOf(item);
            if (srcIdx >= 0) targetGroup.items.splice(srcIdx + 1, 0, copy);
            else targetGroup.items.push(copy);
            copied += 1;
        });
        if (copied > 0) {
            targetGroup.expanded = true;
            changed(`Copied ${copied} item${copied === 1 ? '' : 's'} to "${targetName}"`);
        }
    }

    async function moveSelectedEstimatingItemsToGroup(targetGroupId) {
        const groups = current().groups || [];
        const targetGroup = groups.find(g => String(g.id) === String(targetGroupId));
        if (!targetGroup) return;
        const selectedRows = selectedEstimatingSubheadRows();
        if (!selectedRows.length) return;
        closeEstimatingSubheadMovePopover();

        const count = selectedRows.length;
        const targetName = targetGroup.name || 'Untitled Group';
        const confirmed = await confirmEstimatingSubheadAction({
            title: count === 1 ? 'Move Item to Group' : 'Move Items to Group',
            message: `Move ${count} selected item${count === 1 ? '' : 's'} to "${targetName}"?`,
            confirmText: 'Move',
            cancelText: 'Cancel',
            type: 'warning',
            badge: 'MOVE ITEMS',
            icon: 'fas fa-folder-tree',
            primaryDanger: false
        });
        if (!confirmed) return;

        const rootIds = selectedRows.map(({ item }) => item.id);
        const moving = [];
        groups.forEach(group => {
            const moveIds = collectDescendantIds(group.items || [], rootIds);
            group.items = (group.items || []).filter(item => {
                if (moveIds.has(String(item.id)) || ui.selected.has(item.id) || ui.selected.has(String(item.id))) {
                    moving.push(item);
                    return false;
                }
                return true;
            });
        });
        if (!moving.length) return;
        targetGroup.items = targetGroup.items || [];
        moving.forEach(item => {
            item.groupId = targetGroup.id;
            item.groupName = targetGroup.name;
            targetGroup.items.push(item);
        });
        targetGroup.expanded = true;
        changed(`Moved ${count} item${count === 1 ? '' : 's'} to "${targetName}"`);
    }

    function openEstimatingSubheadGroupPopover(anchorBtn, mode = 'move') {
        const isCopy = mode === 'copy';
        const popId = isCopy ? 'estimatingSubheadCopyPopover' : 'estimatingSubheadMovePopover';
        const existing = document.getElementById(popId);
        if (existing) {
            existing.remove();
            return;
        }
        closeEstimatingSubheadMovePopover();
        const groups = current().groups || [];
        if (!groups.length) return;
        const pop = document.createElement('div');
        pop.id = popId;
        pop.className = 'est-subhead-move-popover';
        pop.innerHTML = `
            <div class="est-subhead-move-popover-head">${isCopy ? 'Copy selected to group:' : 'Move selected to group:'}</div>
            ${groups.map(grp => `
                <button type="button" data-est-target-group="${esc(grp.id)}">
                    <i class="fas ${isCopy ? 'fa-copy' : 'fa-folder'}"></i>
                    <span>${esc(grp.name || 'Untitled Group')}</span>
                </button>
            `).join('')}
        `;
        document.body.appendChild(pop);
        const rect = anchorBtn.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 4;
        if (left + popRect.width > window.innerWidth - 12) {
            left = Math.max(12, window.innerWidth - popRect.width - 12);
        }
        if (top + popRect.height > window.innerHeight - 12) {
            top = Math.max(12, rect.top - popRect.height - 4);
        }
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
        pop.querySelectorAll('[data-est-target-group]').forEach(btn => {
            btn.addEventListener('click', event => {
                event.stopPropagation();
                const targetGroupId = btn.dataset.estTargetGroup;
                if (isCopy) copySelectedEstimatingItemsToGroup(targetGroupId);
                else moveSelectedEstimatingItemsToGroup(targetGroupId);
            });
        });
    }

    function bindEstimatingSubheadActions() {
        const info = document.getElementById('estimatingSubheadItemInfo');
        if (!info || info.dataset.bound === '1') return;
        info.dataset.bound = '1';
        info.addEventListener('click', event => {
            const btn = event.target.closest('[data-est-subhead-action]');
            if (!btn) return;
            event.stopPropagation();
            const act = btn.dataset.estSubheadAction;
            if (act === 'copy') return openEstimatingSubheadGroupPopover(btn, 'copy');
            if (act === 'move') return openEstimatingSubheadGroupPopover(btn, 'move');
            if (act === 'delete') return deleteSelectedEstimatingItems();
        });
    }

    function syncEstimatingSubheadInfo() {
        const info = document.getElementById('estimatingSubheadItemInfo');
        if (!info) return;
        bindEstimatingSubheadActions();
        const isEstTab = document.body?.classList.contains('is-estimating-tab')
            || document.querySelector('.project-subhead-wrapper')?.classList.contains('is-estimating-tab')
            || window.ProjectState?.activeTab === 'estimating';
        if (!isEstTab) {
            info.classList.remove('is-visible');
            info.style.display = 'none';
            info.setAttribute('aria-hidden', 'true');
            closeEstimatingSubheadMovePopover();
            return;
        }
        const selectedRows = allItems().filter(({ item }) =>
            !item.parentItemId && !item.parent_item_id && !item.assemblyParentId
            && (ui.selected.has(item.id) || ui.selected.has(String(item.id)))
        );
        if (!selectedRows.length) {
            info.classList.remove('is-visible');
            info.style.display = 'none';
            info.setAttribute('aria-hidden', 'true');
            closeEstimatingSubheadMovePopover();
            return;
        }
        const dot = document.getElementById('estimatingSubheadItemDot');
        const nameEl = document.getElementById('estimatingSubheadItemName');
        const metaEl = document.getElementById('estimatingSubheadItemMeta');
        const count = selectedRows.length;
        const settings = current().settings;
        const totalSales = selectedRows.reduce((sum, { item }) => {
            const calc = Calc.calculateItem(item, settings);
            return sum + Number(calc?.totalSales ?? 0);
        }, 0);

        if (dot) {
            const shapeHtml = count === 1 ? getItemLayerShapeSvg(selectedRows[0].item, 13) : '';
            dot.style.background = 'transparent';
            dot.style.boxShadow = 'none';
            dot.innerHTML = shapeHtml || '<i class="fas fa-list-check" style="color: #fb5a3a; font-size: 11.5px;"></i>';
        }
        if (nameEl) {
            nameEl.textContent = count === 1
                ? (selectedRows[0].item.name || '1 item selected')
                : `${count} items selected`;
            nameEl.title = selectedRows.map(({ item }) => item.name || 'Item').join(', ');
        }
        if (metaEl) {
            if (count === 1) {
                const singleItem = selectedRows[0].item;
                const calc = Calc.calculateItem(singleItem, settings);
                const qty = calc?.baseQuantity ?? singleItem.quantity ?? 0;
                metaEl.textContent = `${number(qty, 2)} ${singleItem.uom || 'ea'} · ${money(totalSales)}`;
            } else {
                metaEl.textContent = money(totalSales);
            }
        }
        info.classList.add('is-visible');
        info.style.display = 'inline-flex';
        info.setAttribute('aria-hidden', 'false');
    }
    window.syncEstimatingSubheadInfo = syncEstimatingSubheadInfo;

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
        const displayName = component ? resolveAssemblyComponentName(options.sourceChild, item) : String(item.name || 'Unnamed item');
        const assembly = isAssemblyItem(item);
        const invalid = (calc.validation || []).length > 0;
        const rowId = component ? `${options.parent.id}:component:${options.sourceChild?.id || options.index}` : item.id;
        const widths = getColumnWidths();

        const colCells = activeColumns.map(col => {
            return renderItemCell(item, calc, col.id, totalSummaryCost, component, options);
        }).join('');

        const actions = component
            ? (options.sourceChild ? `<div class="est-sticky-actions-cell"><button type="button" class="est-action-icon-btn est-btn-delete" data-remove-assembly-component="${esc(options.sourceChild.id)}" data-parent-assembly-id="${esc(options.parent.id)}" title="Remove component"><i class="fas fa-trash"></i></button></div>` : '')
            : `<div class="est-sticky-actions-cell"><button type="button" class="est-action-icon-btn est-btn-more" data-item-menu-btn="${esc(item.id)}" title="More options"><i class="fas fa-ellipsis-vertical"></i></button><button type="button" data-duplicate-item="${esc(item.id)}" hidden aria-hidden="true"></button><button type="button" data-delete-item="${esc(item.id)}" hidden aria-hidden="true"></button></div>`;

        if (component) {
            const sourceRatio = Number(options.sourceChild?.factorOverride ?? options.sourceChild?.ratio ?? options.sourceChild?.quantity ?? 0);
            const compatibilityQuantity = options.parent?.childrenQuantitiesExtended
                ? Number(options.sourceChild?.quantity || 0)
                : Number(options.parent?.quantity || 0) * sourceRatio;
            const compatibilityUom = options.sourceChild?.uom || item.uom || 'ea';
            return `<tr class="est-item-row est-assembly-component-row ${invalid ? 'est-invalid-row' : ''}" data-item-id="${esc(rowId)}" data-parent-assembly-id="${esc(options.parent.id)}" data-assembly-component-row ${invalid ? 'title="This item has calculation validation errors"' : ''}>
                <td class="col-check">
                    <div class="est-col-check-cell"></div>
                </td>
                <td class="col-cost-item">
                    <div class="est-item-cell-singleline is-component">
                        <span class="est-assembly-branch-line" aria-hidden="true">&#8627;</span>
                        <span class="pro-tree-item-title est-item-title" title="${esc(displayName)}">${esc(displayName)}</span>
                    </div>
                </td>
                <td hidden aria-hidden="true"></td><td hidden aria-hidden="true"></td><td hidden aria-hidden="true"></td>
                <td hidden aria-hidden="true">${number(compatibilityQuantity, 4)}</td>
                <td hidden aria-hidden="true">${esc(compatibilityUom)}</td>
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
                    <span class="est-row-grip" draggable="true" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
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

    function renderItemCell(item, calc, colId, totalSummaryCost, readonly = false, options = {}) {
        if (colId === 'budget_code') {
            const code = item.costCode || item.budgetCode || item.cost_code || '16-1...';
            return `<td><span class="est-budget-code-pill">${esc(code)} <span class="est-budget-code-clear">âœ•</span></span></td>`;
        }
        if (colId === 'quantity') {
            const qty = calc.baseQuantity !== undefined ? calc.baseQuantity : item.quantity;
            const uom = item.uom || 'ea';
            const formattedQty = Number(qty || 0).toFixed(2);
            if (options.component && options.sourceChild) {
                const sourceChild = options.sourceChild;
                const parentAssembly = options.parent;
                const hasFormulaOverride = sourceChild.factorOverride !== undefined && sourceChild.factorOverride !== null && sourceChild.factorOverride !== '';
                const ratioDisplay = hasFormulaOverride ? sourceChild.factorOverride : (sourceChild.ratio !== undefined ? sourceChild.ratio : (sourceChild.quantity || 1));
                const calcBtnHtml = `<button type="button" class="est-assembly-calc-btn ${hasFormulaOverride ? 'has-override' : ''}" data-assembly-calc-btn="${esc(sourceChild.id || '')}" data-parent-assembly-id="${esc(parentAssembly?.id || '')}" title="${hasFormulaOverride ? `Custom formula: ${ratioDisplay} per ${parentAssembly?.uom || 'assembly unit'}` : 'Edit component formula for this estimate'}"><i class="fas fa-calculator"></i></button>`;
                return `<td class="text-right"><div class="est-component-qty-wrap" style="display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;">${calcBtnHtml}<span class="est-editable-num-wrap"><input class="est-cell-input is-component-qty-locked" readonly type="text" value="${esc(formattedQty)}" style="width: ${Math.max(2, String(formattedQty).length)}ch; text-align: right; background: transparent; border: 1px dashed transparent; cursor: default;" title="Formula calculated quantity: ${number(qty, 2)} ${esc(uom)} (${ratioDisplay} per ${esc(parentAssembly?.uom || 'unit')}). Click calculator to change ratio."><span class="est-editable-unit" style="font-size: 11px; color: #2563eb; margin-left: 3px; font-weight: 600;">${esc(uom)}</span></span></div></td>`;
            }
            if (readonly) return `<td class="text-right"><span>${number(qty, 2)} ${esc(uom)}</span></td>`;
            const takeoffQty = Number(item.lastSyncedTakeoffQuantity ?? item.originalQuantity ?? qty ?? 0);
            const isOverridden = Boolean(item.quantityOverride || item.quantitySyncStatus === 'overridden');
            const qtyTooltip = isOverridden
                ? `Custom quantity override: ${number(qty, 2)} ${uom} (Takeoff: ${number(takeoffQty, 2)} ${uom})`
                : (item.takeoffLayerId ? `Synced from Takeoff (${number(takeoffQty, 2)} ${uom}) — edit to override` : 'Enter item quantity');
            return `<td class="text-right"><span class="est-editable-num-wrap"><input class="est-cell-input is-editable ${isOverridden ? 'is-qty-overridden is-val-overridden' : ''}" data-item-field="quantity" type="number" step="0.01" value="${esc(formattedQty)}" style="width: ${Math.max(2, String(formattedQty).length)}ch; text-align: right;" title="${esc(qtyTooltip)}"><span class="est-editable-unit" style="font-size: 11px; color: ${isOverridden ? '#ea580c' : '#2563eb'}; margin-left: 3px; font-weight: 600;">${esc(uom)}</span></span></td>`;
        }
        if (colId === 'unit_cost') {
            const equipment = isEquipmentItem(item);
            const itemBaseCost = equipment
                ? Number(item.overrides?.equipmentUnitCost ?? item.unitEquipmentCost
                    ?? item.catalogSnapshot?.pricing?.equipmentUnitCost ?? item.unitMaterialCost ?? item.unitCost ?? 0)
                : Number(item.unitMaterialCost ?? item.unitCost ?? item.catalogSnapshot?.material_cost
                    ?? item.catalogSnapshot?.pricing?.materialUnitCost ?? item.catalogSnapshot?.unit_cost ?? 0);
            const unitCost = equipment
                ? itemBaseCost
                : ((calc.unitMaterialCost !== undefined && calc.unitMaterialCost > 0)
                    ? calc.unitMaterialCost
                    : (itemBaseCost > 0 ? itemBaseCost : (calc.unitMaterialCost || 0)));
            const formattedCost = Number(unitCost || 0).toFixed(2);
            if (readonly) return `<td class="text-right est-money"><span>${number(unitCost, 2)}</span></td>`;
            const isCostOverridden = Boolean(
                (equipment
                    ? (item.overrides?.equipmentUnitCost !== null && item.overrides?.equipmentUnitCost !== undefined)
                    : (item.overrides?.materialUnitCost !== null && item.overrides?.materialUnitCost !== undefined))
                || item._manualFields?.[equipment ? 'unitEquipmentCost' : 'unitMaterialCost']
            );
            return `<td class="text-right"><span class="est-editable-num-wrap"><span class="est-editable-unit" style="font-size: 11px; color: ${isCostOverridden ? '#ea580c' : '#2563eb'}; margin-right: 1px; font-weight: 600;">$</span><input class="est-cell-input is-editable est-cell-blue-input ${isCostOverridden ? 'is-val-overridden' : ''}" data-item-field="unitMaterialCost" type="number" step="0.01" value="${esc(formattedCost)}" style="width: ${Math.max(4, formattedCost.length)}ch; text-align: right;"></span></td>`;
        }
        if (colId === 'waste') {
            const equipment = isEquipmentItem(item);
            const fallbackWaste = Number(equipment ? (current().settings.equipmentWaste ?? 0) : (current().settings.materialWaste ?? 0));
            const waste = (item.waste !== undefined && item.waste !== null && item.waste !== '') ? Number(item.waste) : fallbackWaste;
            const formattedWaste = Number(waste || 0).toFixed(2);
            if (readonly) return `<td class="text-right"><span>${number(waste, 2)}</span></td>`;
            const isWasteOverridden = Boolean(item._manualFields?.waste);
            return `<td class="text-right"><span class="est-editable-num-wrap"><input class="est-cell-input is-editable est-cell-blue-input ${isWasteOverridden ? 'is-val-overridden' : ''}" data-item-field="waste" type="number" step="0.01" value="${esc(formattedWaste)}" style="width: ${Math.max(3, formattedWaste.length)}ch; text-align: right;"><span class="est-editable-unit" style="font-size: 11px; color: ${isWasteOverridden ? '#ea580c' : '#2563eb'}; margin-left: 2px; font-weight: 600;">%</span></span></td>`;
        }
        if (colId === 'labor_waste') {
            const fallbackLaborWaste = Number(current().settings.laborWaste ?? 0);
            const laborWaste = (item.laborWaste !== undefined && item.laborWaste !== null && item.laborWaste !== '')
                ? Number(item.laborWaste)
                : ((item.itemType === 'labor' && item.waste !== undefined && item.waste !== null && item.waste !== '') ? Number(item.waste) : fallbackLaborWaste);
            const formattedLaborWaste = Number(laborWaste || 0).toFixed(2);
            if (readonly) return `<td class="text-right"><span>${number(laborWaste, 2)}</span></td>`;
            const isLaborWasteOverridden = Boolean(item._manualFields?.laborWaste);
            return `<td class="text-right"><span class="est-editable-num-wrap"><input class="est-cell-input is-editable est-cell-blue-input ${isLaborWasteOverridden ? 'is-val-overridden' : ''}" data-item-field="laborWaste" type="number" step="0.01" value="${esc(formattedLaborWaste)}" style="width: ${Math.max(3, formattedLaborWaste.length)}ch; text-align: right;"><span class="est-editable-unit" style="font-size: 11px; color: ${isLaborWasteOverridden ? '#ea580c' : '#2563eb'}; margin-left: 2px; font-weight: 600;">%</span></span></td>`;
        }
        if (colId === 'subtotal_item_cost') {
            return `<td class="text-right est-money" data-live-item-cell="subtotal_item_cost">${number(calc.materialCost || 0, 2)}</td>`;
        }
        if (colId === 'margin') {
            const equipment = isEquipmentItem(item);
            const fallbackMargin = equipment
                ? Number(current().settings.equipmentMargin ?? 15)
                : Number(current().settings.materialMargin ?? 15);
            const rawMargin = equipment ? item.equipmentMargin : (item.materialMargin ?? item.margin);
            const hasExplicitMargin = rawMargin !== undefined && rawMargin !== null && rawMargin !== '';
            const isAssemblyRow = isAssemblyItem(item) && !options.component;
            const margin = hasExplicitMargin
                ? Number(rawMargin)
                : (isAssemblyRow && Number(calc.materialSales || 0) > 0 && Number(calc.materialCost || 0) > 0
                    ? (((calc.materialSales - calc.materialCost) / calc.materialSales) * 100)
                    : fallbackMargin);
            const formattedMargin = Number(margin || 0).toFixed(2);
            const invalid = Number(margin) >= 100;
            if (readonly) return `<td class="text-right"><span>${number(margin, 2)}</span></td>`;
            const overrideKey = equipment ? 'equipmentMargin' : 'materialMargin';
            const isMarginOverridden = Boolean(item._manualFields?.[overrideKey]);
            return `<td class="text-right"><span class="est-editable-num-wrap"><input class="est-cell-input is-editable est-cell-blue-input ${isMarginOverridden ? 'is-val-overridden' : ''}" data-item-field="${overrideKey}" type="number" step="0.01" max="99.99" value="${esc(formattedMargin)}" ${invalid ? 'aria-invalid="true" title="Margin must be below 100%"' : ''} style="width: ${Math.max(3, formattedMargin.length)}ch; text-align: right;"><span class="est-editable-unit" style="font-size: 11px; color: ${isMarginOverridden ? '#ea580c' : '#2563eb'}; margin-left: 2px; font-weight: 600;">%</span></span></td>`;
        }
        if (colId === 'labor_margin') {
            const hasExplicitLaborMargin = item.laborMargin !== undefined && item.laborMargin !== null && item.laborMargin !== '';
            const isAssemblyRow = isAssemblyItem(item) && !options.component;
            const laborMargin = hasExplicitLaborMargin
                ? Number(item.laborMargin)
                : (isAssemblyRow && Number(calc.laborSales || 0) > 0 && Number(calc.laborCost || 0) > 0
                    ? Number(calc.laborMargin ?? current().settings.globalLaborMargin ?? 34.6)
                    : Number(current().settings.globalLaborMargin ?? 34.6));
            const formattedLaborMargin = laborMargin.toFixed(1);
            const invalid = laborMargin >= 100;
            if (readonly) return `<td class="text-right"><span>${formattedLaborMargin}%</span></td>`;
            const isLaborMarginOverridden = Boolean(item._manualFields?.laborMargin);
            return `<td class="text-right"><span class="est-editable-num-wrap"><input class="est-cell-input is-editable est-cell-blue-input ${isLaborMarginOverridden ? 'is-val-overridden' : ''}" data-item-field="laborMargin" type="number" step="0.1" max="99.99" value="${esc(formattedLaborMargin)}" ${invalid ? 'aria-invalid="true" title="Margin must be below 100%"' : ''} style="width: ${Math.max(3, formattedLaborMargin.length)}ch; text-align: right;"><span class="est-editable-unit" style="font-size: 11px; color: ${isLaborMarginOverridden ? '#ea580c' : '#2563eb'}; margin-left: 2px; font-weight: 600;">%</span></span></td>`;
        }
        if (colId === 'unit_sales') {
            const eqRow = isEquipmentItem(item);
            const unitSalesVal = eqRow && !calc.unitMaterialSales
                ? ((calc.equipmentSales || 0) / (calc.equipmentQuantity || calc.baseQuantity || 1))
                : (calc.unitMaterialSales || 0);
            return `<td class="text-right est-money" data-live-item-cell="unit_sales">${number(unitSalesVal, 2)}</td>`;
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
            const unitLabel = String(item.laborUnitType || item.laborUnit || 'hrs').toLowerCase().includes('hr') ? 'hrs' : 'mins';
            const formattedUl = Number(ul || 0).toFixed(2);
            if (readonly) return `<td class="text-right"><span>${number(ul, 2)}</span></td>`;
            const isUlOverridden = Boolean(
                (item.overrides?.laborHoursPerUnit !== null && item.overrides?.laborHoursPerUnit !== undefined)
                || item._manualFields?.unitLabor
            );
            return `<td class="text-right"><span class="est-editable-num-wrap"><input class="est-cell-input is-editable est-cell-blue-input ${isUlOverridden ? 'is-val-overridden' : ''}" data-item-field="unitLabor" type="number" step="0.01" value="${esc(formattedUl)}" style="width: ${Math.max(3, formattedUl.length)}ch; text-align: right;"><span class="est-editable-unit" style="font-size: 11px; color: ${isUlOverridden ? '#ea580c' : '#2563eb'}; margin-left: 2px; font-weight: 600;">${unitLabel}</span></span></td>`;
        }
        if (colId === 'difficulty_factor') {
            const fallbackDiff = Number(current().settings.laborDifficulty ?? 1);
            const diff = (item.difficulty !== undefined && item.difficulty !== null && item.difficulty !== '') ? Number(item.difficulty) : fallbackDiff;
            const formattedDiff = Number(diff || 1).toFixed(2);
            if (readonly) return `<td class="text-right"><span>${number(diff, 2)}</span></td>`;
            const isDiffOverridden = Boolean(item._manualFields?.difficulty);
            return `<td class="text-right"><span class="est-editable-num-wrap"><input class="est-cell-input is-editable est-cell-blue-input ${isDiffOverridden ? 'is-val-overridden' : ''}" data-item-field="difficulty" type="number" step="0.01" value="${esc(formattedDiff)}" style="width: ${Math.max(3, formattedDiff.length)}ch; text-align: right;"><span class="est-editable-unit" style="font-size: 11px; color: ${isDiffOverridden ? '#ea580c' : '#2563eb'}; margin-left: 2px; font-weight: 600;">x</span></span></td>`;
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
        } catch (_) { }
        return [...DEFAULT_EXCLUSIONS];
    }

    function saveExclusionPresets(list) {
        try {
            safeSetLocalStorage(EXCLUSION_PRESETS_KEY, JSON.stringify(list));
        } catch (_) { }
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
        } catch (_) { }
        return [...DEFAULT_INCLUSIONS];
    }

    function saveInclusionPresets(list) {
        try {
            safeSetLocalStorage(INCLUSION_PRESETS_KEY, JSON.stringify(list));
        } catch (_) { }
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
        const globalLaborMargin = resolvedCategorySummaryMargin('Labor', settings, total);
        const globalLaborSales = globalLaborMargin < 100
            ? (globalLaborCost / (1 - globalLaborMargin / 100))
            : globalLaborCost;

        const materialMargin = resolvedCategorySummaryMargin('Materials', settings, total);
        const equipmentMargin = resolvedCategorySummaryMargin('Equipment', settings, total);
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
                <div class="est-summary-rate-line">
                    <span class="est-summary-rate-label">Global labor cost</span>
                    <div class="est-summary-rate-val-wrap">
                        <span class="est-rate-num-col"><input class="est-rate-inline-input" data-summary-rate="globalLaborCost" type="number" step="0.01" min="0" value="${globalLaborCost.toFixed(2)}"></span>
                        <span class="est-rate-unit-col">$/hr</span>
                    </div>
                </div>
                <div class="est-summary-rate-line">
                    <span class="est-summary-rate-label">Global labor sales rate</span>
                    <div class="est-summary-rate-val-wrap">
                        <span class="est-rate-num-col"><span class="est-rate-readonly-val" data-live-summary="global-labor-sales">${globalLaborSales.toFixed(2)}</span></span>
                        <span class="est-rate-unit-col est-rate-unit-readonly">$/hr</span>
                    </div>
                </div>
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
                                    <span class="est-markup-title">${esc(row.name)}${row.operator === 'subtract' ? ' <span style="font-size: 10px; color: #ef4444; font-weight: 600;">(-)</span>' : ''}</span>
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
                                    <span class="est-markup-title">${esc(row.name)}${row.operator === 'subtract' ? ' <span style="font-size: 10px; color: #ef4444; font-weight: 600;">(-)</span>' : ''}</span>
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
        const allLogs = (estimate.auditLog || []).slice().reverse();
        const maxVisible = ui.showAllAudit ? allLogs.length : 20;
        const logs = allLogs.slice(0, maxVisible);
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
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' • ' +
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
                ${allLogs.length > 20 ? `
                <div class="est-audit-footer" style="padding-top: 10px; text-align: center; border-top: 1px solid var(--border, #e2e8f0); margin-top: 8px;">
                    <button type="button" class="est-small-btn" data-toggle-audit-limit style="font-size: 11px; padding: 4px 12px; cursor: pointer; border-radius: 4px; background: var(--bg-surface, #f1f5f9); border: 1px solid var(--border, #cbd5e1); color: var(--text-main, #334155);">
                        <i class="fas ${ui.showAllAudit ? 'fa-chevron-up' : 'fa-chevron-down'}"></i> ${ui.showAllAudit ? 'Show less (recent 20)' : `Show all (${allLogs.length} events)`}
                    </button>
                </div>` : ''}
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
        backdrop.innerHTML = `
            <div class="bb-create-project-modal bb-studio-modal pd-modal notes-lib-modal" style="width: min(720px, 95vw); max-height: min(84vh, 740px); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column;" role="dialog" aria-modal="true" aria-labelledby="notesLibModalTitle">
                <div class="pd-modal-head bb-modal-head" style="padding: 14px 22px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div class="bb-modal-icon-badge" style="width: 36px; height: 36px; border-radius: 8px; background: rgba(37, 99, 235, 0.12); border: 1px solid rgba(37, 99, 235, 0.28); color: #3b82f6; display: grid; place-items: center; font-size: 16px; flex: 0 0 36px;">
                            <i class="fas fa-clipboard-list"></i>
                        </div>
                        <div>
                            <h3 id="notesLibModalTitle" style="margin: 0; font-size: 15px; font-weight: 700; line-height: 1.3;">Notes Library & Presets</h3>
                            <span class="est-modal-sub" style="font-size: 12px;">Manage and insert reusable note templates for inclusions and exclusions</span>
                        </div>
                    </div>
                    <button class="pd-modal-head-close" type="button" data-close-notes-lib aria-label="Close" style="border: none; background: transparent; font-size: 18px; cursor: pointer;">&times;</button>
                </div>
                
                <!-- Category switch & Search bar (Matching Procore / Bid Board) -->
                <div class="notes-lib-subhead" style="padding: 12px 22px; border-bottom: 1px solid var(--est-line-soft, #e2e8f0); display: flex; flex-direction: column; gap: 10px; flex-shrink: 0;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                        <div class="bb-filter-pills" style="display: inline-flex; gap: 6px; padding: 3px; background: var(--bg-input, #f1f5f9); border: 1px solid var(--border, #cbd5e1); border-radius: 8px;">
                            <button type="button" class="notes-lib-pill ${!isExcluded ? 'is-active' : ''}" data-notes-lib-tab="included">
                                <i class="fas fa-check-circle" style="color: ${!isExcluded ? '#2563eb' : '#64748b'};"></i> Included Presets <span class="notes-lib-count-badge">${getInclusionPresets().length}</span>
                            </button>
                            <button type="button" class="notes-lib-pill ${isExcluded ? 'is-active' : ''}" data-notes-lib-tab="excluded">
                                <i class="fas fa-ban" style="color: ${isExcluded ? '#ef4444' : '#64748b'};"></i> Excluded Presets <span class="notes-lib-count-badge">${getExclusionPresets().length}</span>
                            </button>
                        </div>
                    </div>
                    <div class="bb-search-field-procore cc-search-procore" style="position: relative; width: 100%;">
                        <i class="fas fa-magnifying-glass" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted, #64748b); font-size: 13px;"></i>
                        <input type="search" id="notesLibSearchInput" placeholder="Search preset notes..." value="${esc(ui.notesLibrarySearch || '')}" style="width: 100%; box-sizing: border-box; height: 36px; padding: 0 12px 0 34px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                    </div>
                </div>

                <!-- Presets list -->
                <div class="notes-lib-list" style="flex: 1 1 auto; overflow-y: auto; padding: 14px 22px; display: flex; flex-direction: column; gap: 10px; background: var(--bg-panel, #ffffff);">
                    ${filtered.map((preset, idx) => `
                        <div class="notes-lib-card" style="display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; background: var(--bg-panel, #ffffff); border: 1px solid var(--border-soft, #e2e8f0); border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: border-color 0.15s ease, box-shadow 0.15s ease;">
                            <span class="notes-lib-num-badge" style="width: 24px; height: 24px; border-radius: 6px; background: var(--bg-subtle, #f1f5f9); color: var(--text-muted, #64748b); font-size: 11px; font-weight: 700; display: grid; place-items: center; flex: 0 0 24px; margin-top: 2px;">${idx + 1}</span>
                            <div style="flex: 1; font-size: 12.5px; line-height: 1.5; color: var(--text-main, #1e293b); white-space: pre-wrap;">${esc(preset)}</div>
                            <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                                <button type="button" class="btn-main orange small" data-insert-preset="${targetKey}" data-preset-text="${esc(preset)}" title="Insert note into estimate ${label.toLowerCase()} list" style="height: 28px; padding: 0 10px; font-size: 11.5px; font-weight: 700; border-radius: 5px; border: none; background: var(--tk-primary, #fb5a3a); color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 1px 3px rgba(251,90,58,0.25);">
                                    <i class="fas fa-plus"></i> Insert
                                </button>
                                <button type="button" class="btn-ghost small" data-copy-preset="${esc(preset)}" title="Copy text to clipboard" style="height: 28px; padding: 0 8px; font-size: 11.5px; border: 1px solid var(--border, #cbd5e1); border-radius: 5px; background: transparent; cursor: pointer; color: var(--text-muted, #64748b);">
                                    <i class="fas fa-copy"></i>
                                </button>
                                <button type="button" class="btn-ghost small danger" data-delete-lib-preset="${targetKey}" data-index="${idx}" title="Delete from library" style="height: 28px; padding: 0 8px; border: 1px solid transparent; border-radius: 5px; background: transparent; cursor: pointer; color: #ef4444;">
                                    <i class="fas fa-trash-can"></i>
                                </button>
                            </div>
                        </div>
                    `).join('') || `<div style="text-align: center; padding: 36px 20px; color: var(--text-muted, #94a3b8); font-size: 13px;">No presets found matching search.</div>`}
                </div>

                <!-- Add new preset footer section -->
                <div class="notes-lib-add-section" style="padding: 12px 22px; border-top: 1px solid var(--border-soft, #e2e8f0); background: var(--bg-subtle, #f8fafc); display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;">
                    <div style="font-size: 11px; font-weight: 700; color: var(--text-muted, #64748b); text-transform: uppercase; letter-spacing: 0.04em;">Add new preset to ${label} library</div>
                    <div style="display: flex; gap: 10px; align-items: flex-start;">
                        <textarea id="newPresetTextInput" placeholder="Enter preset note text here..." rows="2" style="flex: 1; padding: 8px 12px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; line-height: 1.45; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a); resize: vertical; box-sizing: border-box;"></textarea>
                        <button type="button" class="btn-main orange" data-save-new-preset="${targetKey}" style="height: 34px; padding: 0 16px; font-size: 12px; font-weight: 700; border-radius: 6px; border: none; background: var(--tk-primary, #fb5a3a); color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; box-shadow: 0 1px 3px rgba(251,90,58,0.3);">
                            <i class="fas fa-bookmark"></i> Save
                        </button>
                    </div>
                </div>

                <div class="pd-modal-foot bb-modal-foot" style="padding: 12px 22px; display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0;">
                    <button type="button" class="btn-ghost" data-close-notes-lib style="height: 32px; padding: 0 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">Close</button>
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
                    <span>Operation / Effect</span>
                    <select data-popover-markup-prop="operator" style="width: 100%; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; font-size: 12px; box-sizing: border-box;">
                        <option value="add" ${markup.operator !== 'subtract' ? 'selected' : ''}>Add (+ Markup)</option>
                        <option value="subtract" ${markup.operator === 'subtract' ? 'selected' : ''}>Subtract (- Discount)</option>
                    </select>
                </label>
                <label style="display: grid; gap: 3px; font-size: 11px; font-weight: 600; color: #475569;">
                    <span>Calculation Base</span>
                    <select data-popover-markup-prop="base" data-markup-base="${markup.id}" style="width: 100%; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; font-size: 12px; box-sizing: border-box;">
                        ${bases.map(b => `<option value="${b.id}" ${markup.base === b.id ? 'selected' : ''}>${b.label}</option>`).join('')}
                    </select>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #334155; cursor: pointer; margin-top: 4px;">
                    <input type="checkbox" data-popover-markup-prop="active" data-markup-active="${markup.id}" ${markup.active !== false ? 'checked' : ''}>
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
            bar.innerHTML = Footer.render({
                estimates: state.estimates, activeEstimateId: state.activeEstimateId,
                selectAttribute: 'data-version', actionAttribute: 'data-estimating-action',
                menuAttribute: 'data-estimate-menu', itemActionAttribute: 'data-estimate-action',
                showCompare: false
            });
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
        const modalRenderer = window.ProjectEstimatingModals?.renderEstimatingModal;
        if (typeof modalRenderer !== 'function') {
            console.error('ProjectEstimatingModals must load before project_estimating.js');
            return;
        }
        return modalRenderer({ ui, esc, current, renderCatalogChoices });
    }
    function moveEstimatingItem(draggedItemId, targetItemId, targetGroupId, isBefore = true) {
        if (!draggedItemId) return;
        if (targetItemId && String(draggedItemId) === String(targetItemId)) return;

        let srcGroup = null, srcIndex = -1, draggedItem = null;
        for (const g of current().groups) {
            const idx = (g.items || []).findIndex(it => String(it.id) === String(draggedItemId));
            if (idx !== -1) {
                srcGroup = g;
                srcIndex = idx;
                draggedItem = g.items[idx];
                break;
            }
        }
        if (!draggedItem || !srcGroup) return;

        if (targetItemId) {
            let tgtGroup = null, tgtIndex = -1;
            for (const g of current().groups) {
                const idx = (g.items || []).findIndex(it => String(it.id) === String(targetItemId));
                if (idx !== -1) {
                    tgtGroup = g;
                    tgtIndex = idx;
                    break;
                }
            }
            if (!tgtGroup || tgtIndex === -1) return;

            srcGroup.items.splice(srcIndex, 1);
            if (srcGroup === tgtGroup && srcIndex < tgtIndex) {
                tgtIndex--;
            }
            const insertIdx = isBefore ? tgtIndex : tgtIndex + 1;
            tgtGroup.items.splice(insertIdx, 0, draggedItem);
            changed(`Moved ${draggedItem.name || 'item'}`);

            if (draggedItem.takeoffLayerId) {
                window.dispatchEvent(new CustomEvent('estimating:takeoff-item-moved', {
                    detail: {
                        projectId: String(projectId),
                        estimateId: String(state.activeEstimateId),
                        layerId: draggedItem.takeoffLayerId,
                        targetGroupId: tgtGroup.takeoffGroupId || tgtGroup.id
                    }
                }));
            }
        } else if (targetGroupId) {
            const tgtGroup = current().groups.find(g => String(g.id) === String(targetGroupId) || String(g.takeoffGroupId) === String(targetGroupId));
            if (!tgtGroup) return;
            srcGroup.items.splice(srcIndex, 1);
            tgtGroup.items.push(draggedItem);
            changed(`Moved ${draggedItem.name || 'item'} to ${tgtGroup.name}`);

            if (draggedItem.takeoffLayerId) {
                window.dispatchEvent(new CustomEvent('estimating:takeoff-item-moved', {
                    detail: {
                        projectId: String(projectId),
                        estimateId: String(state.activeEstimateId),
                        layerId: draggedItem.takeoffLayerId,
                        targetGroupId: tgtGroup.takeoffGroupId || tgtGroup.id
                    }
                }));
            }
        }
    }

    function createGroup() {
        const group = Workspace.group({ name: `Group ${current().groups.length + 1}`, items: [] }, current().groups.length);
        current().groups.push(group);
        changed(`Created group "${group.name}"`);
        requestAnimationFrame(() => {
            const row = document.querySelector(`.est-group-row[data-group-id="${group.id}"]`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                row.classList.add('group-highlight-pulse');
                setTimeout(() => row.classList.remove('group-highlight-pulse'), 3600);
            }
            const input = document.querySelector(`.est-group-name-input[data-group-name="${group.id}"]`);
            if (input) {
                input.focus();
                input.select();
            }
        });
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
        const targetGroup = current().groups.find(row => String(row.id) === String(groupId));
        if (!targetGroup) return;
        ui.catalogTargetGroupId = groupId;
        if (typeof window.openTakeoffCatalogModal === 'function') {
            window.openTakeoffCatalogModal({
                groupId,
                onSelect: (selectedItems) => {
                    if (!Array.isArray(selectedItems) || !selectedItems.length) return;
                    selectedItems.forEach(catItem => {
                        const item = window.EstimatingCatalogAdapter.catalogItemDtoToEstimatingItem(catItem, {
                            itemsById: new Map([[String(catItem.id), catItem]]),
                            globalLaborRate: current().settings.globalLaborCost,
                            workspaceItem: Workspace.item
                        });
                        item.addedFromEstimating = true;
                        item.origin = 'estimating';
                        targetGroup.items.push(item);
                    });
                    targetGroup.expanded = true;
                    changed(`Added ${selectedItems.length} item(s) from Cost Catalog`);
                }
            });
            return;
        }
        ui.catalogLoading = true; ui.catalogError = ''; ui.modal = 'catalog'; renderModal();
        try {
            ui.catalogData = await window.CatalogService.getSnapshot({ enabledForProjectsOnly: true });
        } catch (error) { ui.catalogError = error.message; }
        ui.catalogLoading = false; renderModal();
    }

    function catalogEstimateItem(catalog) {
        const itemsById = new Map((ui.catalogData?.items || []).map(item => [String(item.id), item]));
        const item = window.EstimatingCatalogAdapter.catalogItemDtoToEstimatingItem(catalog, {
            itemsById,
            globalLaborRate: current().settings.globalLaborCost,
            workspaceItem: Workspace.item
        });
        item.addedFromEstimating = true;
        item.origin = 'estimating';
        return item;
    }

    function triggerFileDownload(blobOrUrl, filename, revokeBlob = true) {
        const anchor = document.createElement('a');
        const url = revokeBlob ? URL.createObjectURL(blobOrUrl) : String(blobOrUrl);
        anchor.href = url;
        anchor.download = filename;
        anchor.dataset.noNavGuard = '1';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => {
            anchor.remove();
            if (revokeBlob) URL.revokeObjectURL(url);
        }, 1500);
        return true;
    }

    function buildExcelSummary(estimate) {
        const settings = estimate.settings || {};
        const total = Calc.calculateSummary(estimate.groups || [], settings);
        const category = (name, waste, difficulty = 0) => {
            const values = total.byCategory[name];
            return {
                laborHours: values.adjustedLaborHours,
                difficulty,
                waste,
                cost: values.totalCost,
                margin: resolvedCategorySummaryMargin(name, settings, total),
                sales: values.totalSales,
                profit: values.profit
            };
        };
        return {
            labor: category('Labor', Number(settings.laborWaste ?? 0), Number(settings.laborDifficulty ?? 1)),
            materials: category('Materials', Number(settings.materialWaste ?? 0)),
            equipment: category('Equipment', Number(settings.equipmentWaste ?? 0)),
            direct: {
                cost: total.direct.totalCost,
                margin: total.direct.marginPercent,
                sales: total.direct.totalSales,
                profit: total.direct.profit
            },
            preTax: total.preTaxTotal,
            tax: total.totalTax,
            postTax: total.postTaxTotal,
            total: total.estimateTotal
        };
    }

    async function exportEstimate(mode = 'estimate-xlsx') {
        let Exporter = getExporter();
        if (!Exporter && typeof window.ensureDashboardFeature === 'function') {
            await window.ensureDashboardFeature('estimating-export');
            Exporter = getExporter();
        }
        if (!Exporter && mode !== 'estimate-xlsx') return false;
        let estimate = Workspace.clone(current());
        // Capture the same state the Summary panel uses before enriching the export detail.
        const excelSummary = mode === 'estimate-xlsx' ? buildExcelSummary(estimate) : null;
        if ((mode === 'estimate-xlsx' || mode === 'flat' || mode === 'bom-excel' || mode === 'bom-csv' || mode === 'summary-csv') && Exporter?.needsCatalog?.(estimate)) {
            try {
                const catalogSnapshot = await window.CatalogService.getSnapshot({ enabledForProjectsOnly: true });
                estimate = window.BoqCatalogAdapter.hydrateEstimate(estimate, catalogSnapshot);
            } catch (error) {
                console.warn('Could not hydrate estimate from catalog snapshot:', error);
                if (mode === 'flat') {
                    alert(`BOQ Flat could not load the Cost Catalog: ${error.message}`);
                    return false;
                }
            }
        }
        if (mode === 'flat') {
            const unresolved = Exporter.unresolvedAssemblies(estimate);
            if (unresolved.length) {
                alert(`BOQ Flat cannot expand these assemblies because they have no Cost Catalog components: ${unresolved.map(item => item.name).join(', ')}`);
                return false;
            }
        }

        const cleanFilePart = value => String(value ?? '').trim()
            .replace(/[^a-z0-9.-]+/gi, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
        const projectNameRaw = window.ProjectState?.projectInfo?.name
            || document.getElementById('projectHeaderName')?.childNodes?.[0]?.textContent
            || '';
        const projectPart = cleanFilePart(projectNameRaw);
        const estimatePart = cleanFilePart(current().name || '');
        const safeName = (projectPart && estimatePart)
            ? `${projectPart}_${estimatePart}`
            : (projectPart || estimatePart || 'Project_Estimate');

        if (mode === 'estimate-xlsx') {
            try {
                const resp = await fetch(`../api/project_estimate_excel.php?action=export_estimate&project_id=${encodeURIComponent(projectId)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        project_id: projectId,
                        estimate_id: estimate.id || '',
                        estimate,
                        summary: excelSummary
                    })
                });
                if (!resp.ok) {
                    const errJson = await resp.json().catch(() => null);
                    throw new Error(errJson?.msg || `Export failed (${resp.status})`);
                }
                const blob = await resp.blob();
                return triggerFileDownload(blob, `${safeName}.xlsx`);
            } catch (err) {
                alert(err?.message || 'Could not export Estimate Excel.');
                return false;
            }
        }

        if (mode === 'bom-excel') {
            const xml = Exporter.excelXml(estimate, current().settings);
            return triggerFileDownload(new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }), `${safeName}_BOM.xls`);
        }

        if (mode === 'bom-csv') {
            const rows = Exporter.bomRows(estimate, current().settings);
            return triggerFileDownload(new Blob([Exporter.bomCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${safeName}_BOM.csv`);
        }

        if (mode === 'summary-csv') {
            const csvText = Exporter.summaryCsv(estimate, current().settings);
            return triggerFileDownload(new Blob([csvText], { type: 'text/csv;charset=utf-8' }), `${safeName}_Summary.csv`);
        }

        const rows = mode === 'flat' ? Exporter.flatRows(estimate) : Exporter.normalRows(estimate);
        return triggerFileDownload(new Blob([Exporter.csv(rows)], { type: 'text/csv;charset=utf-8' }), `${safeName}_${mode === 'flat' ? 'BOQ_Flat' : 'BOQ'}.csv`);
    }

    root.addEventListener('input', event => {
        if (event.target.id === 'estSearch') { ui.search = event.target.value; renderTable(); return; }
        const estimate = current();
        const itemRow = event.target.closest('[data-item-id]');
        const itemField = event.target.dataset.itemField;
        if (itemRow && itemField && event.target.type === 'number') {
            // Adjust input width dynamically on input without premature recalculation or child re-rendering
            const valLen = String(event.target.value || '').length;
            if (event.target.style) {
                event.target.style.width = `${Math.max(2, valLen)}ch`;
            }
            event.target.classList.add('is-val-overridden');
            const unitEl = event.target.parentElement?.querySelector('.est-editable-unit');
            if (unitEl) unitEl.style.color = '#ea580c';
            const liveCommit = new Event('change', { bubbles: true });
            liveCommit.estimatingLiveInput = true;
            event.target.dispatchEvent(liveCommit);
            return;
        }
        if (event.target.dataset.summaryRate) {
            const rateField = event.target.dataset.summaryRate;
            const val = Workspace.numeric(event.target.value);
            applySummaryRateSetting(estimate, rateField, val);
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
            const nextCost = Math.max(0, Number(val || 0));
            const gMargin = Number(estimate.settings.globalLaborMargin ?? 34.6);
            estimate.settings.globalLaborCost = nextCost;
            estimate.settings.globalLaborSales = gMargin < 100
                ? Number((nextCost / (1 - gMargin / 100)).toFixed(2))
                : nextCost;
            forEachEstimateItem(estimate, it => {
                it.laborRate = nextCost;
                if (it._manualFields) delete it._manualFields.laborRate;
                if (it.catalogSnapshot && window.EstimatingCatalogSnapshotService) {
                    window.EstimatingCatalogSnapshotService.setCatalogOverride(it, 'laborRate', nextCost);
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
                    if (it._manualFields) delete it._manualFields.laborMargin;
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
                const gCost = Number(estimate.settings.globalLaborCost ?? 36);
                estimate.settings.globalLaborMargin = clamped;
                estimate.settings.globalLaborSales = clamped < 100
                    ? Number((gCost / (1 - clamped / 100)).toFixed(2))
                    : gCost;
                forEachEstimateItem(estimate, it => {
                    it.laborMargin = clamped;
                    if (it._manualFields) delete it._manualFields.laborMargin;
                    if (it.itemType === 'labor' || it.type === 'labor') it.margin = clamped;
                });
            } else if (type === 'Materials') {
                estimate.settings.materialMargin = clamped;
                forEachEstimateItem(estimate, it => {
                    if (isEquipmentItem(it)) return;
                    it.materialMargin = clamped;
                    if (it._manualFields) delete it._manualFields.materialMargin;
                    if (it.itemType === 'material' || it.type === 'material' || (!it.itemType && !it.type)) it.margin = clamped;
                });
            } else if (type === 'Equipment') {
                estimate.settings.equipmentMargin = clamped;
                forEachEstimateItem(estimate, it => {
                    it.equipmentMargin = clamped;
                    if (it._manualFields) delete it._manualFields.equipmentMargin;
                });
            }
        } else if (field === 'waste') {
            const clamped = Math.max(0, val);
            if (type === 'Materials') {
                estimate.settings.materialWaste = clamped;
                forEachEstimateItem(estimate, it => {
                    if (isEquipmentItem(it)) return;
                    it.waste = clamped;
                    if (it._manualFields) delete it._manualFields.waste;
                });
            } else if (type === 'Labor') {
                estimate.settings.laborWaste = clamped;
                forEachEstimateItem(estimate, it => {
                    it.laborWaste = clamped;
                    if (it._manualFields) delete it._manualFields.laborWaste;
                    if (it.itemType === 'labor' || it.type === 'labor') it.waste = clamped;
                });
            } else if (type === 'Equipment') {
                estimate.settings.equipmentWaste = clamped;
                forEachEstimateItem(estimate, it => {
                    if (isEquipmentItem(it)) {
                        it.waste = clamped;
                        if (it._manualFields) delete it._manualFields.waste;
                    }
                });
            }
        } else if (field === 'difficulty') {
            const clamped = Math.max(0.1, val);
            estimate.settings.laborDifficulty = clamped;
            forEachEstimateItem(estimate, it => {
                it.difficulty = clamped;
                if (it._manualFields) delete it._manualFields.difficulty;
            });
            window.dispatchEvent(new CustomEvent('estimating:global-difficulty-updated', {
                detail: { difficulty: clamped }
            }));
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
            if (target.dataset.itemField === 'quantity') {
                target.dataset.estFocusQty = target.value;
            }
            if (target.matches?.('input.is-editable, input.est-cell-input, input.est-rate-inline-input, input[data-item-field], input[data-summary-rate], input[data-field], input[data-markup-quick-val], input[data-group-name]')) {
                setTimeout(() => {
                    if (document.activeElement === target) {
                        try { target.select(); } catch (_) { }
                    }
                }, 10);
            }
        }
    });

    root.addEventListener('change', event => {
        const isLiveTypingCommit = event.estimatingLiveInput === true;
        const compChildId = event.target.dataset.componentChildId;
        const parentAssemblyId = event.target.dataset.parentAssemblyId;
        const compField = event.target.dataset.itemField;
        if (compChildId && parentAssemblyId && compField) {
            const parentItem = current().groups.flatMap(g => g.items || []).find(it => String(it.id) === String(parentAssemblyId));
            if (parentItem) {
                const children = getItemChildren(parentItem);
                const child = children.find(c => String(c.id) === String(compChildId) || String(c.catalogItemId || c.catalog_item_id) === String(compChildId)) || children[0];
                if (child) {
                    const newVal = Workspace.numeric(event.target.value);
                    const prevVal = child[compField] ?? child.quantity;
                    if (compField === 'quantity') {
                        const parentQty = Number(parentItem.quantity || 1) || 1;
                        child.quantity = newVal;
                        child.ratio = newVal / parentQty;
                        child.factorOverride = newVal / parentQty;
                        if (Array.isArray(parentItem.catalogSnapshot?.assemblyComponents)) {
                            const snapComp = parentItem.catalogSnapshot.assemblyComponents.find(sc => String(sc.id) === String(child.id) || String(sc.catalogItemId) === String(child.catalogItemId));
                            if (snapComp) {
                                snapComp.ratio = child.ratio;
                                snapComp.factorOverride = child.factorOverride;
                                snapComp.quantity = newVal;
                            }
                        }
                    } else {
                        child[compField] = newVal;
                    }
                    parentItem.children = children;
                    parentItem.updatedAt = Workspace.now();
                    changed(`Updated ${child.name || 'component'} (${prevVal} -> ${newVal})`);
                    renderTable();
                    publish();
                    return;
                }
            }
        }

        if (event.target.dataset.summaryRate) {
            const field = event.target.dataset.summaryRate;
            const val = Workspace.numeric(event.target.value);
            applySummaryRateSetting(current(), field, val);
            changed(`Updated ${field === 'globalLaborCost' ? 'Global labor cost' : 'Global labor sales rate'} (${val.toFixed(2)})`);
            return;
        }

        const row = event.target.closest('[data-item-id]');
        const field = event.target.dataset.itemField;
        if (row && field) {
            const found = findItem(row.dataset.itemId);
            if (!found) return;
            const equipmentRow = isEquipmentItem(found.item);
            const equipmentUnitCostEdit = field === 'unitMaterialCost' && equipmentRow;
            const equipmentMarginEdit = field === 'materialMargin' && equipmentRow;
            const effectiveField = equipmentUnitCostEdit
                ? 'unitEquipmentCost'
                : (equipmentMarginEdit ? 'equipmentMargin' : field);
            const prevRaw = getAuditPrevValue(event.target);
            const nextRaw = event.target.value;
            const catalogFields = {
                unitMaterialCost: 'materialUnitCost', unitEquipmentCost: 'equipmentUnitCost',
                unitSubcontractorCost: 'subcontractorUnitCost', unitLabor: 'laborHoursPerUnit', laborRate: 'laborRate'
            };
            found.item._manualFields = found.item._manualFields || {};
            if (event.target.type === 'number' && found.item.catalogSnapshot && catalogFields[effectiveField]
                && window.EstimatingCatalogSnapshotService) {
                const parsedVal = Number(event.target.value);
                window.EstimatingCatalogSnapshotService.setCatalogOverride(found.item,
                    catalogFields[effectiveField], parsedVal);
                found.item[effectiveField] = parsedVal;
                if (effectiveField === 'unitLabor') {
                    found.item.laborUnitType = 'hrs';
                    const unitEl = event.target.parentElement?.querySelector('.est-editable-unit');
                    if (unitEl) unitEl.textContent = 'hrs';
                }
                found.item._manualFields[effectiveField] = true;
                event.target.classList.add('is-val-overridden');
                const unitEl = event.target.parentElement?.querySelector('.est-editable-unit');
                if (unitEl) unitEl.style.color = '#ea580c';
                if (!isLiveTypingCommit && !isNaN(parsedVal)) event.target.value = parsedVal.toFixed(2);
            } else {
                const parsedVal = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
                if (field === 'quantity') {
                    const origQty = Workspace.numeric(found.item.lastSyncedTakeoffQuantity ?? found.item.originalQuantity ?? found.item.takeoffQuantity ?? 0);
                    const liveLayer = findTakeoffLayer(found.item);
                    const liveCanvasQty = liveLayer ? Workspace.numeric(liveLayer.quantity || 0) : 0;
                    const effectiveCanvasQty = Math.max(origQty, liveCanvasQty);
                    const numParsed = Workspace.numeric(parsedVal);
                    if (Math.abs(numParsed - origQty) < 0.0001) {
                        found.item.quantityOverride = false;
                        found.item.quantitySyncStatus = found.item.takeoffLayerId ? 'synced' : 'manual';
                        delete found.item.pendingTakeoffQuantity;
                        delete found.item.quantityOverrideSource;
                        delete found.item._manualFields.quantity;
                        event.target.classList.remove('is-qty-overridden', 'is-val-overridden');
                        const unitEl = event.target.parentElement?.querySelector('.est-editable-unit');
                        if (unitEl) unitEl.style.color = '#2563eb';
                    } else {
                        if (found.item.lastSyncedTakeoffQuantity === undefined || found.item.lastSyncedTakeoffQuantity === null) {
                            found.item.lastSyncedTakeoffQuantity = origQty;
                        }
                        if (found.item.originalQuantity === undefined || found.item.originalQuantity === null) {
                            found.item.originalQuantity = origQty;
                        }
                        found.item.quantityOverride = true;
                        found.item.quantitySyncStatus = 'overridden';
                        found.item.pendingTakeoffQuantity = origQty;
                        found.item._manualFields.quantity = true;
                        found.item.quantityOverrideSource = effectiveCanvasQty > 0 ? 'canvas_overridden' : 'estimating_first';
                        event.target.classList.add('is-qty-overridden', 'is-val-overridden');
                        const unitEl = event.target.parentElement?.querySelector('.est-editable-unit');
                        if (unitEl) unitEl.style.color = '#ea580c';
                        if (!isLiveTypingCommit && effectiveCanvasQty > 0) {
                            const focusQtyRaw = event.target.dataset.estFocusQty;
                            const focusQtyNum = focusQtyRaw !== undefined ? Workspace.numeric(focusQtyRaw) : origQty;
                            if (Math.abs(numParsed - focusQtyNum) >= 0.0001) {
                                event.target.dataset.estFocusQty = String(numParsed);
                                if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.show === 'function') {
                                    const uomLabel = found.item.uom || 'ea';
                                    window.TakeoffAnnouncement.show({
                                        id: 'user_alert_canvas_overridden_in_estimating',
                                        perUser: true,
                                        force: false,
                                        type: 'warning',
                                        badge: 'QUANTITY OVERRIDE',
                                        icon: 'fas fa-triangle-exclamation',
                                        title: 'Canvas Value Will Not Be Used',
                                        message: `You overrode the quantity for "${found.item.name || 'this item'}" manually in Estimating. The quantity counted on the Takeoff canvas (${effectiveCanvasQty} ${uomLabel}) will not be taken into account while this override is active.`,
                                        primaryText: 'Got It',
                                        showDontShow: true,
                                        dontShowLabel: "Don't show this warning again"
                                    });
                                }
                            }
                        }
                    }
                } else {
                    found.item._manualFields[effectiveField] = true;
                    event.target.classList.add('is-val-overridden');
                    const unitEl = event.target.parentElement?.querySelector('.est-editable-unit');
                    if (unitEl) unitEl.style.color = '#ea580c';
                    if (field === 'difficulty' && found.item.takeoffLayerId) {
                        window.dispatchEvent(new CustomEvent('estimating:item-difficulty-updated', {
                            detail: { layerId: found.item.takeoffLayerId, difficulty: parsedVal }
                        }));
                    }
                }
                found.item[effectiveField] = parsedVal;
                if (effectiveField === 'unitLabor') {
                    found.item.laborUnitType = 'hrs';
                    const unitEl = event.target.parentElement?.querySelector('.est-editable-unit');
                    if (unitEl) unitEl.textContent = 'hrs';
                }
                if (effectiveField === 'materialMargin') found.item.margin = parsedVal;
                if (!isLiveTypingCommit && event.target.type === 'number' && !isNaN(parsedVal)) {
                    event.target.value = effectiveField === 'laborMargin' ? parsedVal.toFixed(1) : parsedVal.toFixed(2);
                }
                if (field === 'quantity' && isAssemblyItem(found.item)) {
                    const newParentQty = Workspace.numeric(parsedVal);
                    const children = getItemChildren(found.item);
                    children.forEach(child => {
                        const ratio = (child.factorOverride !== undefined && child.factorOverride !== null && child.factorOverride !== '')
                            ? Number(child.factorOverride)
                            : (child.ratio !== undefined && child.ratio !== null ? Number(child.ratio) : Number(child.unitQuantity ?? child.quantity ?? 1));
                        child.ratio = ratio;
                    });
                    found.item.children = children;
                } else if (isAssemblyItem(found.item) && ['materialMargin', 'equipmentMargin', 'laborMargin', 'waste', 'laborWaste', 'difficulty', 'laborRate'].includes(effectiveField)) {
                    const children = getItemChildren(found.item);
                    children.forEach(child => {
                        child[effectiveField] = parsedVal;
                        if (effectiveField === 'materialMargin') child.margin = parsedVal;
                        if (effectiveField === 'laborRate' && child.catalogSnapshot && window.EstimatingCatalogSnapshotService) {
                            window.EstimatingCatalogSnapshotService.setCatalogOverride(child, 'laborRate', parsedVal);
                        }
                    });
                    found.item.children = children;
                }
            }
            found.item.updatedAt = Workspace.now();
            const fieldMeta = {
                quantity: { label: 'Quantity', kind: 'qty' },
                unitMaterialCost: { label: 'Unit Cost', kind: 'money' },
                unitEquipmentCost: { label: 'Equipment Cost', kind: 'money' },
                unitSubcontractorCost: { label: 'Subcontractor Cost', kind: 'money' },
                waste: { label: 'Material Waste', kind: 'percent' },
                laborWaste: { label: 'Labor Waste', kind: 'percent' },
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
            Workspace.touch(state, `Updated ${fieldMeta.label} for "${found.item.name}" (${oldFmt} -> ${newFmt})`);
            scheduleSave();
            renderLiveSummary();
            saveLocal({ publish: !isLiveTypingCommit && field === 'quantity' });
            if (!isLiveTypingCommit && isAssemblyItem(found.item) && (field === 'quantity' || ['materialMargin', 'equipmentMargin', 'laborMargin', 'waste', 'laborWaste', 'difficulty', 'laborRate'].includes(effectiveField))) renderTable();
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
            portal.innerHTML = `<div class="pd-modal" style="width: min(460px, 100%); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column;" role="dialog" aria-modal="true" aria-labelledby="deleteEstimateTitle">
                <div class="pd-modal-head" style="padding: 14px 18px; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-trash-can" style="color: #ef4444; font-size: 1.1rem;"></i>
                        <h3 id="deleteEstimateTitle" style="margin: 0; font-size: 1.05rem; font-weight: 600;">Delete Estimate</h3>
                    </div>
                    <button class="pd-modal-head-close" type="button" data-delete-cancel aria-label="Close" style="border: none; background: transparent; font-size: 18px; cursor: pointer;">&times;</button>
                </div>
                <div class="pd-modal-body" style="padding: 18px 20px; font-size: .88rem; line-height: 1.5;">
                    <p style="margin: 0 0 10px;">${esc(message)}</p>
                    <div class="est-danger-callout" style="border-left: 3px solid #ef4444; padding: 8px 12px; border-radius: 4px; font-size: .8rem;">
                        <strong>Warning:</strong> This action is permanent and cannot be undone.
                    </div>
                </div>
                <div class="pd-modal-foot" style="display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px;">
                    <button type="button" class="btn-ghost" data-delete-cancel style="padding: 7px 14px; border-radius: 6px; cursor: pointer;">Cancel</button>
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
                ack = await request('delete', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'delete', project_id: projectId,
                        estimate_id: requestedDbId, client_estimate_id: requestedId,
                        delete_original: original
                    })
                });
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
        if (actionName === 'copy' && selectEstimate(estimateId)) { ui.modal = 'new'; renderModal(); }
        if (actionName === 'delete') deleteEstimateAuthoritative(estimateId);
        if (actionName === 'set-primary') {
            state.estimates.forEach(row => {
                const nextPrimary = String(row.id) === String(estimateId);
                const wasPrimary = Boolean(row.is_primary || row.isPrimary);
                row.is_primary = nextPrimary;
                row.isPrimary = nextPrimary;
                if (wasPrimary !== nextPrimary || nextPrimary) {
                    markEstimateDirty(row.id);
                }
            });
            const targetEst = state.estimates.find(row => String(row.id) === String(estimateId)) || current();
            const primarySummary = buildEstimateSummaryPayload(targetEst);
            const totalSales = primarySummary.estimateTotal;
            syncPrimaryEstimateProjectMeta();
            saveLocal();
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


    function showAssemblyFormulaPopover(sourceChild, parentAssembly, triggerBtn) {
        let pop = $('estAssemblyFormulaPopover');
        if (!pop) {
            pop = document.createElement('div');
            pop.id = 'estAssemblyFormulaPopover';
            pop.className = 'est-assembly-formula-popover';
            document.body.appendChild(pop);
        }
        if (!pop.hidden && pop.dataset.activeChildId === String(sourceChild.id)) {
            pop.hidden = true;
            pop.dataset.activeChildId = '';
            return;
        }

        hideActionPopover();
        closeMarkupPopovers();

        const currentRatio = (sourceChild.factorOverride !== undefined && sourceChild.factorOverride !== null && sourceChild.factorOverride !== '')
            ? Number(sourceChild.factorOverride)
            : Number(sourceChild.quantity || 1);
        const parentQty = Number(parentAssembly.quantity || 1) || 1;
        const parentUom = parentAssembly.uom || 'assembly unit';
        const compUom = sourceChild.uom || 'ea';

        pop.dataset.activeChildId = String(sourceChild.id);
        pop.innerHTML = `
            <div class="formula-pop-head">
                <span><i class="fas fa-calculator" style="color: #2563eb;"></i> Component Formula</span>
                <button type="button" data-close-formula-pop style="border: none; background: transparent; font-size: 16px; cursor: pointer; color: var(--text-muted);">&times;</button>
            </div>
            <div style="font-size: 12px; font-weight: 600; color: var(--text-main); line-height: 1.3;">
                ${esc(sourceChild.name)}
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">
                Parent Assembly: <strong>${esc(parentAssembly.name)}</strong> (${number(parentQty, 2)} ${esc(parentUom)})
            </div>
            <div>
                <label for="assemblyFormulaInput" style="display: block; font-size: 11px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">
                    Qty per ${esc(parentUom)}
                </label>
                <div style="position: relative; display: flex; align-items: center;">
                    <input id="assemblyFormulaInput" type="number" step="0.001" min="0" value="${currentRatio}" style="width: 100%; box-sizing: border-box; height: 32px; padding: 4px 50px 4px 8px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; font-weight: 600; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                    <span style="position: absolute; right: 8px; font-size: 11px; color: var(--text-muted); pointer-events: none;">${esc(compUom)}</span>
                </div>
            </div>
            <div style="font-size: 11.5px; color: var(--text-muted); background: var(--bg-subtle, #f8fafc); border: 1px solid var(--border-soft, #e2e8f0); border-radius: 4px; padding: 6px 8px;">
                Calculated: <strong id="assemblyFormulaLivePreview" style="color: #2563eb;">${number(currentRatio * parentQty, 2)} ${esc(compUom)}</strong>
            </div>
            <div class="formula-pop-foot">
                <button type="button" class="btn-ghost small" data-reset-formula style="padding: 4px 10px; font-size: 11px; border: 1px solid var(--border, #cbd5e1); border-radius: 4px; background: transparent; cursor: pointer;">Reset Catalog</button>
                <button type="button" class="btn-main orange small" data-apply-formula style="padding: 4px 12px; font-size: 11px; font-weight: 700; border: none; border-radius: 4px; background: var(--tk-primary, #fb5a3a); color: #fff; cursor: pointer;">Apply</button>
            </div>
        `;
        pop.hidden = false;

        const rect = triggerBtn.getBoundingClientRect();
        const popW = 290;
        let left = rect.left;
        let top = rect.bottom + 6;
        if (left + popW > window.innerWidth - 10) left = Math.max(10, window.innerWidth - popW - 10);
        if (top + 280 > window.innerHeight - 10) top = Math.max(10, rect.top - 280);
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;

        const input = pop.querySelector('#assemblyFormulaInput');
        const preview = pop.querySelector('#assemblyFormulaLivePreview');

        input?.addEventListener('input', () => {
            const val = Workspace.numeric(input.value);
            if (preview) preview.textContent = `${number(val * parentQty, 2)} ${compUom}`;
        });

        pop.querySelector('[data-close-formula-pop]')?.addEventListener('click', () => {
            pop.hidden = true;
            pop.dataset.activeChildId = '';
        });

        pop.querySelector('[data-apply-formula]')?.addEventListener('click', () => {
            const val = Workspace.numeric(input.value);
            const parentQty = Number(parentAssembly.quantity || 1) || 1;
            sourceChild.ratio = val;
            sourceChild.factorOverride = val;
            sourceChild.quantity = val * parentQty;
            const children = getItemChildren(parentAssembly);
            const match = children.find(c => String(c.id) === String(sourceChild.id) || String(c.catalogItemId) === String(sourceChild.catalogItemId));
            if (match) {
                match.ratio = val;
                match.factorOverride = val;
                match.quantity = val * parentQty;
            }
            if (Array.isArray(parentAssembly.catalogSnapshot?.assemblyComponents)) {
                const snapComp = parentAssembly.catalogSnapshot.assemblyComponents.find(sc => String(sc.id) === String(sourceChild.id) || String(sc.catalogItemId) === String(sourceChild.catalogItemId));
                if (snapComp) {
                    snapComp.ratio = val;
                    snapComp.factorOverride = val;
                    snapComp.quantity = val * parentQty;
                }
            }
            parentAssembly.children = children;
            parentAssembly.updatedAt = Workspace.now();
            pop.hidden = true;
            pop.dataset.activeChildId = '';
            changed(`Updated component formula for "${sourceChild.name}" to ${val} per ${parentUom}`);
            renderTable();
            publish();
        });

        pop.querySelector('[data-reset-formula]')?.addEventListener('click', () => {
            delete sourceChild.factorOverride;
            delete sourceChild.ratio;
            const children = getItemChildren(parentAssembly);
            const match = children.find(c => String(c.id) === String(sourceChild.id) || String(c.catalogItemId) === String(sourceChild.catalogItemId));
            if (match) {
                delete match.factorOverride;
                delete match.ratio;
            }
            if (Array.isArray(parentAssembly.catalogSnapshot?.assemblyComponents)) {
                const snapComp = parentAssembly.catalogSnapshot.assemblyComponents.find(sc => String(sc.id) === String(sourceChild.id) || String(sc.catalogItemId) === String(sourceChild.catalogItemId));
                if (snapComp) {
                    delete snapComp.factorOverride;
                    delete snapComp.ratio;
                }
            }
            parentAssembly.children = children;
            parentAssembly.updatedAt = Workspace.now();
            pop.hidden = true;
            pop.dataset.activeChildId = '';
            changed(`Reset component formula for "${sourceChild.name}" to catalog default`);
            renderTable();
            publish();
        });
    }

    function openProjectItemEditModal(item, group) {
        document.querySelector('[data-estimating-modal-portal]')?.remove();
        const portal = document.createElement('div');
        portal.dataset.estimatingModalPortal = '';
        portal.className = 'pd-modal-backdrop open';

        const unitCost = Number(item.unitMaterialCost ?? item.unitCost ?? 0).toFixed(2);
        const laborHours = Number(item.unitLabor ?? item.laborHours ?? 0).toFixed(2);
        const equipCost = Number(item.unitEquipmentCost ?? 0).toFixed(2);
        const subCost = Number(item.unitSubcontractorCost ?? 0).toFixed(2);
        const isAss = isAssemblyItem(item);
        const children = isAss ? getItemChildren(item) : [];
        children.forEach((c, idx) => { if (!c.id) c.id = Workspace.uid('comp'); });

        let totalCompCost = 0;
        let totalCompLabor = 0;
        children.forEach(c => {
            const ratio = (c.factorOverride !== undefined && c.factorOverride !== null && c.factorOverride !== '')
                ? Number(c.factorOverride) : Number(c.quantity || 1);
            const cCost = Number(c.unitMaterialCost ?? c.unitCost ?? 0);
            const cLabor = Number(c.unitLabor ?? c.laborHours ?? 0);
            totalCompCost += (ratio * cCost);
            totalCompLabor += (ratio * cLabor);
        });

        const assemblyComponentsHtml = isAss && children.length > 0 ? `
            <section class="cc-assembly-section full is-open" style="grid-column: 1 / -1; margin-top: 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 10px; overflow: hidden; background: var(--bg-panel, #ffffff);">
                <div class="cc-section-head" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--bg-subtle, #f8fafc); border-bottom: 1px solid var(--border-soft, #e2e8f0);">
                    <div class="cc-section-head-title" style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-boxes-stacked" style="color: var(--primary, #fb5a3a);"></i>
                        <strong style="font-size: 13px; color: var(--text-main, #0f172a);">Assembly Components Kit</strong>
                    </div>
                    <span id="projAssemblyTotals" class="cc-assembly-totals-pill" style="padding: 3px 12px; border-radius: 999px; background: rgba(37, 99, 235, 0.12); border: 1px solid rgba(37, 99, 235, 0.3); color: #2563eb; font-size: 11.5px; font-weight: 700;">
                        Cost ${money(totalCompCost)} · Labor ${totalCompLabor.toFixed(2)} hr
                    </span>
                </div>

                <div class="cc-assembly-selected-header" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border-soft, #e2e8f0); background: var(--bg-panel, #ffffff);">
                    <div class="cc-assembly-selected-title" style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-list-check" style="color: var(--primary, #fb5a3a);"></i>
                        <strong style="font-size: 12px; color: var(--text-main, #0f172a);">Configured Components</strong>
                        <span class="cc-selected-count-badge" id="projSelectedCount" style="background: #2563eb; color: #ffffff; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 700;">${children.length}</span>
                        <small style="color: var(--text-muted, #64748b); margin-left: 6px;">(Configured per 1 ${esc(item.uom || 'assembly unit')})</small>
                    </div>
                </div>

                <div class="cc-assembly-table-wrap" style="max-height: 240px; overflow-y: auto;">
                    <table class="cc-mini-table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                        <thead>
                            <tr style="background: var(--bg-subtle, #f1f5f9);">
                                <th style="width: 34px; text-align: center; padding: 8px 10px; border-bottom: 1px solid var(--border, #cbd5e1);"><i class="fas fa-grip-vertical" style="opacity: 0.5;"></i></th>
                                <th style="width: 95px; text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--border, #cbd5e1); font-size: 11.5px; font-weight: 600;">Quantity</th>
                                <th style="text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border, #cbd5e1); font-size: 11.5px; font-weight: 600;">Item Name</th>
                                <th style="width: 60px; text-align: center; padding: 8px 10px; border-bottom: 1px solid var(--border, #cbd5e1); font-size: 11.5px; font-weight: 600;">UoM</th>
                                <th style="width: 95px; text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--border, #cbd5e1); font-size: 11.5px; font-weight: 600;">Unit Cost</th>
                                <th style="width: 95px; text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--border, #cbd5e1); font-size: 11.5px; font-weight: 600;">Labor Time</th>
                                <th style="width: 50px; text-align: center; padding: 8px 10px; border-bottom: 1px solid var(--border, #cbd5e1); font-size: 11.5px; font-weight: 600;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${children.map((comp, idx) => {
            const compRatio = (comp.factorOverride !== undefined && comp.factorOverride !== null && comp.factorOverride !== '')
                ? comp.factorOverride : (comp.quantity || 1);
            const compCost = Number(comp.unitMaterialCost ?? comp.unitCost ?? 0);
            const compLabor = Number(comp.unitLabor ?? comp.laborHours ?? 0);
            return `<tr data-proj-comp-row="${idx}" style="border-bottom: 1px solid var(--border-soft, #e2e8f0);">
                                    <td style="text-align: center; color: var(--text-muted, #94a3b8); padding: 8px 10px;"><i class="fas fa-grip-vertical"></i></td>
                                    <td style="text-align: right; padding: 8px 10px;">
                                        <input type="number" step="0.001" min="0" class="cc-qty-input proj-comp-ratio-input" data-comp-idx="${idx}" data-comp-id="${esc(comp.id || '')}" data-unit-cost="${compCost}" data-labor-hours="${compLabor}" value="${Number(compRatio)}" style="width: 78px; height: 28px; padding: 0 6px; text-align: right; font-weight: 600; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12px; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                                    </td>
                                    <td style="padding: 8px 12px;">
                                        <div style="font-weight: 600; font-size: 12.5px; color: var(--text-main, #0f172a);">${esc(comp.name || 'Component')}</div>
                                        ${comp.description ? `<div style="font-size: 11px; color: var(--text-muted, #64748b);">${esc(comp.description)}</div>` : ''}
                                    </td>
                                    <td style="text-align: center; padding: 8px 10px;">
                                        <span class="cc-uom-pill" style="padding: 2px 7px; border-radius: 4px; background: var(--bg-subtle, #f1f5f9); font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b);">${esc(comp.uom || 'ea')}</span>
                                    </td>
                                    <td style="text-align: right; font-weight: 600; font-size: 12px; padding: 8px 10px; color: var(--text-main, #0f172a);">${money(compCost)}</td>
                                    <td style="text-align: right; font-size: 12px; padding: 8px 10px; color: var(--text-muted, #64748b);">${compLabor.toFixed(2)} hr</td>
                                    <td style="text-align: center; padding: 8px 10px;">
                                        <button type="button" class="est-icon-action-btn danger" data-proj-remove-comp="${idx}" title="Remove component from this assembly" style="color: #ef4444; border: none; background: transparent; cursor: pointer; padding: 4px;">
                                            <i class="fas fa-trash-can"></i>
                                        </button>
                                    </td>
                                </tr>`;
        }).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        ` : '';

        portal.innerHTML = `
            <div class="cc-modal pd-modal cc-item-modal-lg" style="width: min(840px, 95vw); max-height: min(80vh, 700px); background: var(--bg-panel, #ffffff); border: 1px solid var(--border, #cbd5e1); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); overflow: hidden; display: flex; flex-direction: column;" role="dialog" aria-modal="true" aria-labelledby="projItemModalTitle">
                <div class="pd-modal-head cc-modal-head" style="padding: 14px 24px; border-bottom: 1px solid var(--border-soft, #e2e8f0); display: flex; align-items: center; justify-content: space-between; background: var(--bg-panel, #ffffff);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(37, 99, 235, 0.25); color: #2563eb; display: grid; place-items: center; font-size: 14px; flex: 0 0 32px;">
                            <i class="fas fa-${isAss ? 'boxes-stacked' : 'cube'}"></i>
                        </div>
                        <div>
                            <h3 id="projItemModalTitle" style="margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-main, #0f172a); line-height: 1.25;">Edit ${isAss ? 'Assembly' : 'Item'} (Estimate Project Level)</h3>
                            <span style="font-size: 11.5px; color: var(--text-muted, #64748b);">Group: <strong>${esc(group?.name || 'Group')}</strong></span>
                        </div>
                    </div>
                    <button class="pd-modal-head-close" type="button" data-close-proj-item-modal aria-label="Close" style="border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--text-muted, #64748b);">&times;</button>
                </div>
                <div class="pd-modal-body cc-modal-body" style="padding: 18px 24px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; max-height: calc(80vh - 120px); background: var(--bg-panel, #ffffff);">
                    
                    <!-- Notice Banner required by user -->
                    <div class="est-item-project-edit-banner" style="margin-bottom: 4px;">
                        <i class="fas fa-info-circle"></i>
                        <div>
                            <strong>Project-Level Item Edit</strong>: You are modifying this ${isAss ? 'assembly' : 'item'} only for this project estimate (<strong>${esc(current().name || 'Estimate')}</strong>). These changes are local and will <strong>NOT</strong> modify or affect the global master catalog.
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;">
                        <div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 4px;">
                            <label for="projEditName" style="font-size: 11.5px; font-weight: 700; color: var(--text-main, #0f172a);">Item Name <span style="color:#ef4444;">*</span></label>
                            <input id="projEditName" type="text" value="${esc(item.name || '')}" required style="width: 100%; box-sizing: border-box; height: 34px; padding: 6px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 13px; font-weight: 600; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                        </div>

                        <div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 4px;">
                            <label for="projEditDesc" style="font-size: 11.5px; font-weight: 700; color: var(--text-main, #0f172a);">Description</label>
                            <textarea id="projEditDesc" rows="2" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a); resize: vertical;">${esc(item.description || '')}</textarea>
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label for="projEditUom" style="font-size: 11.5px; font-weight: 700; color: var(--text-main, #0f172a);">Unit of Measure (UoM)</label>
                            <input id="projEditUom" type="text" value="${esc(item.uom || 'ea')}" style="width: 100%; box-sizing: border-box; height: 34px; padding: 6px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label for="projEditCostCode" style="font-size: 11.5px; font-weight: 700; color: var(--text-main, #0f172a);">Cost Code / Budget Code</label>
                            <input id="projEditCostCode" type="text" value="${esc(item.costCode || item.budgetCode || '')}" placeholder="e.g. 16-100" style="width: 100%; box-sizing: border-box; height: 34px; padding: 6px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                        </div>

                        ${!isAss ? `
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label for="projEditUnitCost" style="font-size: 11.5px; font-weight: 700; color: var(--text-main, #0f172a);">Unit Material Cost ($)</label>
                            <input id="projEditUnitCost" type="number" step="0.01" min="0" value="${esc(unitCost)}" style="width: 100%; box-sizing: border-box; height: 34px; padding: 6px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; font-weight: 600; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label for="projEditLaborHours" style="font-size: 11.5px; font-weight: 700; color: var(--text-main, #0f172a);">Labor Time (hrs / unit)</label>
                            <input id="projEditLaborHours" type="number" step="0.01" min="0" value="${esc(laborHours)}" style="width: 100%; box-sizing: border-box; height: 34px; padding: 6px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; font-weight: 600; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label for="projEditEquipCost" style="font-size: 11.5px; font-weight: 700; color: var(--text-main, #0f172a);">Equipment Cost ($)</label>
                            <input id="projEditEquipCost" type="number" step="0.01" min="0" value="${esc(equipCost)}" style="width: 100%; box-sizing: border-box; height: 34px; padding: 6px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label for="projEditSubCost" style="font-size: 11.5px; font-weight: 700; color: var(--text-main, #0f172a);">Subcontractor Cost ($)</label>
                            <input id="projEditSubCost" type="number" step="0.01" min="0" value="${esc(subCost)}" style="width: 100%; box-sizing: border-box; height: 34px; padding: 6px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                        </div>
                        ` : ''}

                        ${assemblyComponentsHtml}

                        <div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 4px;">
                            <label for="projEditNotes" style="font-size: 11.5px; font-weight: 700; color: var(--text-main, #0f172a);">Item Notes</label>
                            <input id="projEditNotes" type="text" value="${esc(item.notes || '')}" placeholder="Estimate notes for this item..." style="width: 100%; box-sizing: border-box; height: 34px; padding: 6px 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; font-size: 12.5px; background: var(--bg-panel, #ffffff); color: var(--text-main, #0f172a);">
                        </div>
                    </div>
                </div>
                <div class="pd-modal-foot cc-modal-foot" style="padding: 14px 24px; border-top: 1px solid var(--border-soft, #e2e8f0); display: flex; align-items: center; justify-content: flex-end; gap: 10px; background: var(--bg-card, #f8fafc);">
                    <button type="button" class="btn-ghost" data-close-proj-item-modal style="height: 32px; padding: 0 16px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; background: transparent; cursor: pointer; font-size: 12px; font-weight: 600;">Cancel</button>
                    <button type="button" class="btn-main orange" id="projSaveItemBtn" style="height: 32px; padding: 0 18px; border: none; border-radius: 6px; background: var(--tk-primary, #fb5a3a); color: #ffffff; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(251, 90, 58, 0.3);">
                        <i class="fas fa-check"></i> Save Project Changes
                    </button>
                </div>
            </div>`;

        document.body.appendChild(portal);

        const closeModal = () => portal.remove();
        portal.querySelectorAll('[data-close-proj-item-modal]').forEach(b => b.addEventListener('click', closeModal));
        portal.addEventListener('click', e => { if (e.target === portal) closeModal(); });
        portal.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeModal();
                return;
            }
            if (event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                if (event.target?.tagName === 'TEXTAREA' || event.target?.tagName === 'BUTTON') return;
                event.preventDefault();
                portal.querySelector('#projSaveItemBtn')?.click();
            }
        });

        portal.querySelectorAll('.proj-comp-ratio-input').forEach(input => {
            input.addEventListener('input', () => {
                let liveCost = 0;
                let liveLabor = 0;
                portal.querySelectorAll('.proj-comp-ratio-input').forEach(inp => {
                    const r = Workspace.numeric(inp.value);
                    const c = parseFloat(inp.dataset.unitCost || '0');
                    const l = parseFloat(inp.dataset.laborHours || '0');
                    liveCost += (r * c);
                    liveLabor += (r * l);
                });
                const totalsEl = portal.querySelector('#projAssemblyTotals');
                if (totalsEl) {
                    totalsEl.textContent = `Cost ${money(liveCost)} · Labor ${liveLabor.toFixed(2)} hr`;
                }
            });
        });

        portal.querySelectorAll('[data-proj-remove-comp]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.projRemoveComp, 10);
                const tr = btn.closest('tr');
                if (tr) tr.remove();
                children.splice(idx, 1);
                const countBadge = portal.querySelector('#projSelectedCount');
                if (countBadge) countBadge.textContent = String(children.length);
                let liveCost = 0;
                let liveLabor = 0;
                portal.querySelectorAll('.proj-comp-ratio-input').forEach(inp => {
                    const r = Workspace.numeric(inp.value);
                    const c = parseFloat(inp.dataset.unitCost || '0');
                    const l = parseFloat(inp.dataset.laborHours || '0');
                    liveCost += (r * c);
                    liveLabor += (r * l);
                });
                const totalsEl = portal.querySelector('#projAssemblyTotals');
                if (totalsEl) {
                    totalsEl.textContent = `Cost ${money(liveCost)} · Labor ${liveLabor.toFixed(2)} hr`;
                }
            });
        });

        portal.querySelector('#projSaveItemBtn')?.addEventListener('click', () => {
            const newName = portal.querySelector('#projEditName')?.value.trim() || item.name;
            const newDesc = portal.querySelector('#projEditDesc')?.value.trim() || '';
            const newUom = portal.querySelector('#projEditUom')?.value.trim() || item.uom || 'ea';
            const newCostCode = portal.querySelector('#projEditCostCode')?.value.trim() || '';
            const newNotes = portal.querySelector('#projEditNotes')?.value.trim() || '';

            const oldName = item.name;
            item.name = newName;
            item.description = newDesc;
            item.uom = newUom;
            item.costCode = newCostCode;
            item.budgetCode = newCostCode;
            item.notes = newNotes;

            if (isAss && children.length > 0) {
                const parentQty = Number(item.quantity || 1) || 1;
                portal.querySelectorAll('.proj-comp-ratio-input').forEach(inp => {
                    const idx = Number(inp.dataset.compIdx);
                    const comp = children[idx];
                    if (comp) {
                        const val = Workspace.numeric(inp.value);
                        comp.ratio = val;
                        comp.factorOverride = val;
                        comp.quantity = val * parentQty;
                        if (Array.isArray(item.catalogSnapshot?.assemblyComponents)) {
                            const snapComp = item.catalogSnapshot.assemblyComponents.find(sc => String(sc.id) === String(comp.id) || String(sc.catalogItemId) === String(comp.catalogItemId)) || item.catalogSnapshot.assemblyComponents[idx];
                            if (snapComp) {
                                snapComp.ratio = val;
                                snapComp.factorOverride = val;
                                snapComp.quantity = val * parentQty;
                            }
                        }
                    }
                });
                item.children = children;
            } else {
                const newUnitCost = Workspace.numeric(portal.querySelector('#projEditUnitCost')?.value);
                const newLaborHours = Workspace.numeric(portal.querySelector('#projEditLaborHours')?.value);
                const newEquipCost = Workspace.numeric(portal.querySelector('#projEditEquipCost')?.value);
                const newSubCost = Workspace.numeric(portal.querySelector('#projEditSubCost')?.value);

                item.unitMaterialCost = newUnitCost;
                item.unitCost = newUnitCost;
                item.unitLabor = newLaborHours;
                item.laborHours = newLaborHours;
                item.laborUnitType = 'hrs';
                item.unitEquipmentCost = newEquipCost;
                item.unitSubcontractorCost = newSubCost;

                if (item.catalogSnapshot && window.EstimatingCatalogSnapshotService) {
                    window.EstimatingCatalogSnapshotService.setCatalogOverride(item, 'materialUnitCost', newUnitCost);
                    window.EstimatingCatalogSnapshotService.setCatalogOverride(item, 'laborHoursPerUnit', newLaborHours);
                    window.EstimatingCatalogSnapshotService.setCatalogOverride(item, 'equipmentUnitCost', newEquipCost);
                    window.EstimatingCatalogSnapshotService.setCatalogOverride(item, 'subcontractorUnitCost', newSubCost);
                }
            }

            item.updatedAt = Workspace.now();
            closeModal();
            changed(`Edited ${isAss ? 'assembly' : 'item'} "${oldName}" (Project estimate level)`);
            renderTable();
            publish();
        });
    }

    root.addEventListener('click', event => {
        const target = event.target;

        const editSqft = target.closest('[data-edit-sqft]');
        if (editSqft) {
            openSquareFootageModal();
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
                    grp.items.forEach(item => zeroEstimatingItemQuantity(item));
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
                    copy.items = (grp.items || []).map(it => duplicateEstimatingItem(it)).map(it => {
                        if (it && it.name.endsWith(' (Copy)')) it.name = it.name.slice(0, -7);
                        return it;
                    });
                    const idx = current().groups.indexOf(grp);
                    current().groups.splice(idx + 1, 0, copy);
                    changed(`Copied ${grp.name}`);
                }
            } else if (act === 'export-bom') {
                exportEstimate('bom-excel');
            } else if (act === 'delete-group') {
                if (confirm('Delete this group and its items?')) {
                    const targetGroup = current().groups.find(row => row.id === grpId);
                    const removedItems = targetGroup?.items || [];
                    current().groups = current().groups.filter(row => row.id !== grpId);
                    notifyTakeoffDeletedEstimatingItems(removedItems);
                    changed('Deleted group', { allowEmptyGroupsReplace: true });
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
                if (found) {
                    openProjectItemEditModal(found.item, found.group);
                }
                return;
            } else if (act === 'copy-item') {
                if (found) {
                    const index = found.group.items.indexOf(found.item);
                    const duplicate = duplicateEstimatingItem(found.item);
                    if (duplicate) {
                        found.group.items.splice(index + 1, 0, duplicate);
                        changed(isAssemblyItem(found.item) ? `Duplicated ${found.item.name}` : `Copied ${found.item.name}`);
                    }
                }
            } else if (act === 'reset-quantity') {
                if (found) {
                    const prevQty = found.item.quantity;
                    zeroEstimatingItemQuantity(found.item);
                    changed(`Reset quantity for "${found.item.name}" (${formatAuditVal(prevQty, 'qty', found.item.uom)} -> ${formatAuditVal(0, 'qty', found.item.uom)})`);
                }
            } else if (act === 'delete-item') {
                if (found) {
                    const removedItem = found.item;
                    found.group.items = found.group.items.filter(row => row.id !== itId);
                    ui.expandedAssemblies.delete(String(itId));
                    notifyTakeoffDeletedEstimatingItems([removedItem]);
                    changed(`Deleted ${removedItem.name}`, { allowEmptyGroupsReplace: true });
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
            deleteSelectedEstimatingItems();
        }
        if (action === 'reset-quantities') {
            allItems().forEach(({ item }) => zeroEstimatingItemQuantity(item));
            changed('Reset quantities');
        }
        if (action === 'fullscreen') {
            toggleEstimatingFullscreen();
            return;
        }
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
        if (option === 'export') { ui.modal = 'export'; renderModal(); }
        if (option === 'import') {
            ui.importFile = null;
            ui.importMode = 'keep_excel';
            ui.importName = '';
            ui.importError = '';
            ui.importing = false;
            ui.modal = 'import';
            renderModal();
        }
        const collapse = target.closest('[data-collapse-card]')?.dataset.collapseCard;
        if (collapse) { ui.collapsed[collapse] = !ui.collapsed[collapse]; renderDetails(); }
        const toggle = target.closest('[data-toggle-group]')?.dataset.toggleGroup;
        if (toggle) { const group = current().groups.find(row => row.id === toggle); group.expanded = !group.expanded; changed(); }
        const calcBtn = target.closest('[data-assembly-calc-btn]');
        if (calcBtn) {
            event.preventDefault();
            event.stopPropagation();
            const childId = calcBtn.dataset.assemblyCalcBtn;
            const parentAssemblyId = calcBtn.dataset.parentAssemblyId;
            const foundParent = findItem(parentAssemblyId);
            const parentAssembly = foundParent?.item;
            if (parentAssembly) {
                const children = getItemChildren(parentAssembly);
                const sourceChild = children.find(c => String(c.id) === String(childId) || String(c.catalogItemId || c.catalog_item_id) === String(childId)) || children[0];
                if (sourceChild) {
                    showAssemblyFormulaPopover(sourceChild, parentAssembly, calcBtn);
                }
            }
            return;
        }

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
            if (found) {
                const removedItem = found.item;
                found.group.items = found.group.items.filter(row => row.id !== deleteItem);
                ui.expandedAssemblies.delete(String(deleteItem));
                notifyTakeoffDeletedEstimatingItems([removedItem]);
                changed(`Deleted ${removedItem.name}`, { allowEmptyGroupsReplace: true });
            }
        }
        const duplicateItem = target.closest('[data-duplicate-item]')?.dataset.duplicateItem;
        if (duplicateItem) {
            const found = findItem(duplicateItem);
            if (found) {
                const index = found.group.items.indexOf(found.item);
                const duplicate = duplicateEstimatingItem(found.item);
                if (duplicate) {
                    found.group.items.splice(index + 1, 0, duplicate);
                    changed(isAssemblyItem(found.item) ? `Duplicated ${found.item.name}` : `Copied ${found.item.name}`);
                }
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
        if (deleteGroup && confirm('Delete this group and its items?')) {
            const targetGroup = current().groups.find(row => row.id === deleteGroup);
            const removedItems = targetGroup?.items || [];
            current().groups = current().groups.filter(row => row.id !== deleteGroup);
            notifyTakeoffDeletedEstimatingItems(removedItems);
            changed('Deleted group', { allowEmptyGroupsReplace: true });
        }
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

    function commitEstimatingGroupRename(inputEl) {
        if (!inputEl) return false;
        const groupId = inputEl.dataset.groupName;
        const group = current().groups.find(row => String(row.id) === String(groupId));
        if (!group) return false;
        const nextName = String(inputEl.value || '').trim().replace(/\s+/g, ' ') || 'Untitled Group';
        if (nextName === String(group.name || '')) {
            inputEl.value = nextName;
            return false;
        }
        group.name = nextName;
        (group.items || []).forEach(it => { it.groupName = nextName; });
        changed('Renamed group');
        return true;
    }

    root.addEventListener('change', event => {
        if (!event.target.matches('[data-group-name]')) return;
        commitEstimatingGroupRename(event.target);
    });

    document.addEventListener('click', async event => {
        const target = event.target;
        if (!target.closest('#estAssemblyFormulaPopover') && !target.closest('[data-assembly-calc-btn]')) {
            const pop = $('estAssemblyFormulaPopover');
            if (pop) { pop.hidden = true; pop.dataset.activeChildId = ''; }
        }
        if (!target.closest('.est-markup-popover') && !target.closest('[data-markup-menu-btn]')) {
            closeMarkupPopovers();
        }
        if (!target.closest('#optionsMenu') && !target.closest('[data-est-action="options"]')) {
            closeOptionsMenu();
        }
        if (!target.closest('#estimatingSubheadMovePopover') && !target.closest('[data-est-subhead-action="move"]')) {
            closeEstimatingSubheadMovePopover();
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
        if (target.closest('[data-toggle-audit-limit]')) {
            ui.showAllAudit = !ui.showAllAudit;
            renderDetails();
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
            try { navigator.clipboard.writeText(copyPreset.dataset.copyPreset); } catch (_) { }
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
            if (pop.contains(event.target)) {
                if (handleActionPopoverClick(event)) return;
            } else if (!event.target.closest('[data-group-menu-btn]') && !event.target.closest('[data-item-menu-btn]')) {
                hideActionPopover();
            }
        }
        const portal = event.target.closest('[data-estimating-modal-portal]');
        if (!portal) return;
        if (event.target.closest('[data-close-modal]') || event.target === portal) {
            if (!ui.importing) {
                ui.modal = null;
                renderModal();
            }
            return;
        }
        if (event.target.closest('[data-download-estimate]')) {
            const downloadButton = event.target.closest('[data-download-estimate]');
            if (downloadButton.disabled) return;
            const mode = portal.querySelector('input[name="estimateExportMode"]:checked')?.value || 'estimate-xlsx';
            downloadButton.disabled = true;
            try {
                const exported = await exportEstimate(mode);
                if (exported !== false) {
                    ui.modal = null;
                    renderModal();
                }
            } finally {
                downloadButton.disabled = false;
            }
            return;
        }
        if (event.target.closest('[data-import-estimate]')) {
            const importBtn = event.target.closest('[data-import-estimate]');
            if (importBtn.disabled || ui.importing) return;
            const mode = portal.querySelector('input[name="estimateImportMode"]:checked')?.value || ui.importMode || 'keep_excel';
            const customName = (portal.querySelector('#estImportName')?.value || ui.importName || '').trim();
            if (!ui.importFile) {
                ui.importError = 'Please select a valid .xlsx workbook exported from a project estimate.';
                renderModal();
                return;
            }
            if (!projectId) {
                ui.importError = 'Save or open a persisted project before importing an estimate workbook.';
                renderModal();
                return;
            }
            ui.importing = true;
            ui.importError = '';
            ui.importMode = mode;
            ui.importName = customName;
            renderModal();
            try {
                const formData = new FormData();
                formData.append('action', 'import_estimate');
                formData.append('project_id', String(projectId));
                formData.append('estimate_name', customName);
                formData.append('import_mode', mode);
                formData.append('file', ui.importFile);
                const resp = await fetch('../api/project_estimate_excel.php?action=import_estimate', {
                    method: 'POST',
                    body: formData
                });
                const payload = await resp.json().catch(() => null);
                if (!resp.ok || !payload || payload.status !== 'success' || !payload.estimate) {
                    throw new Error(payload?.msg || payload?.message || `Import failed (${resp.status})`);
                }
                const imported = Workspace.estimate(payload.estimate, projectId, state.estimates.length);
                state.estimates.forEach(row => { row.isActive = false; });
                imported.isActive = true;
                state.estimates.push(imported);
                state.activeEstimateId = imported.id;
                Workspace.selectEstimate(state, imported.id);
                ui.modal = null;
                ui.importFile = null;
                ui.importError = '';
                ui.importing = false;
                ui.loadState = 'saved';
                const importWarning = Array.isArray(payload.warnings) ? payload.warnings[0] : null;
                ui.message = importWarning
                    ? `Imported ${imported.name} (${payload.items_count || 0} items). Takeoff setup warning: ${importWarning.message || importWarning.code}`
                    : `Imported ${imported.name} (${payload.items_count || 0} items)`;
                saveLocal();
                render();
                if (window.ProjectState) {
                    window.ProjectState.activeEstimateId = String(imported.id);
                }
                window.dispatchEvent(new CustomEvent('takeoff:active-estimate-changed', {
                    detail: { projectId: String(projectId || ''), estimateId: imported.id, cloned: false, importedFromExcel: true }
                }));
                if (mode === 'keep_excel_open_takeoff') {
                    document.querySelector('[data-pd-tab="takeoff"], [data-tab="takeoff"], .pd-tab-btn[data-tab="takeoff"]')?.click();
                }
            } catch (err) {
                ui.importing = false;
                ui.importError = err?.message || 'Could not import Excel estimate.';
                renderModal();
            }
            return;
        }
        if (event.target.closest('[data-create-estimate]')) {
            const createButton = event.target.closest('[data-create-estimate]');
            if (createButton.disabled) return;
            const sourceEstimateId = String(current()?.id || '');
            const name = portal.querySelector('#copyEstimateName')?.value;
            const mode = portal.querySelector('input[name="copyEstimateMode"]:checked')?.value || 'blank';
            Workspace.createEstimate(state, name, mode);
            ui.modal = null;
            renderModal();
            saveLocal();
            const createdEstimate = current();
            const projTbl = window.ProjectState?.projectMeta?.estimatingTableSettings;
            if (createdEstimate && projTbl?.applyAll && Array.isArray(projTbl.visibleColumns) && projTbl.visibleColumns.length > 0) {
                createdEstimate.settings = createdEstimate.settings || {};
                createdEstimate.settings.visibleColumns = projTbl.visibleColumns.slice();
                createdEstimate.settings.tableSettingsApplyAll = true;
                if (Array.isArray(projTbl.columnsOrder) && projTbl.columnsOrder.length > 0) {
                    createdEstimate.settings.columnsOrder = projTbl.columnsOrder.slice();
                }
            }
            if (mode === 'all' && createdEstimate && typeof window.cloneTakeoffWorkspaceForEstimate === 'function') {
                const cloneResult = window.cloneTakeoffWorkspaceForEstimate(sourceEstimateId, createdEstimate.id, createdEstimate);
                if (cloneResult) {
                    createdEstimate.cloneTakeoffFromEstimateId = cloneResult.sourceEstimateId;
                    createdEstimate.cloneTakeoffLayerMap = cloneResult.layerIdMap || {};
                    createdEstimate.cloneTakeoffGroupMap = cloneResult.groupIdMap || {};
                    createdEstimate.cloneTakeoffItemMap = cloneResult.itemIdMap || {};
                }
            }
            markEstimateDirty();
            saveLocal();
            render();
            if (createdEstimate) {
                if (window.ProjectState) {
                    window.ProjectState.activeEstimateId = String(createdEstimate.id);
                }
                window.dispatchEvent(new CustomEvent('takeoff:active-estimate-changed', {
                    detail: { projectId: String(projectId || ''), estimateId: createdEstimate.id, cloned: false }
                }));
            }
            if (projectId) {
                createButton.disabled = true;
                ui.loadState = 'saving';
                ui.message = 'Creating estimate in database...';
                renderStatus();
                try {
                    await window.projectEstimatingSave();
                    if (createdEstimate) {
                        delete createdEstimate.cloneTakeoffFromEstimateId;
                        delete createdEstimate.cloneTakeoffLayerMap;
                        delete createdEstimate.cloneTakeoffGroupMap;
                        delete createdEstimate.cloneTakeoffItemMap;
                    }
                    ui.message = 'Estimate created';
                    renderStatus();
                    if (mode === 'all' && createdEstimate) {
                        window.dispatchEvent(new CustomEvent('takeoff:active-estimate-changed', {
                            detail: { projectId: String(projectId || ''), estimateId: createdEstimate.id, cloned: true }
                        }));
                    }
                } catch (error) {
                    ui.loadState = 'error';
                    ui.message = `Estimate was not confirmed by the database: ${error.message}`;
                    renderStatus();
                } finally {
                    createButton.disabled = false;
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

    root.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target.matches('.est-group-name-input')) {
            event.preventDefault();
            const committed = commitEstimatingGroupRename(event.target);
            if (!committed) event.target.blur();
            return;
        }
        if (event.key === 'Enter' && event.target.matches('input[data-item-field], input[data-summary-rate], .est-rate-inline-input')) {
            event.target.blur();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            const formulaPop = $('estAssemblyFormulaPopover');
            if (formulaPop) { formulaPop.hidden = true; formulaPop.dataset.activeChildId = ''; }
        }
        if (event.key === 'Escape' && ui.notesLibraryModal) { ui.notesLibraryModal = null; renderNotesLibraryModal(); }
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
        } catch (_) { }
    }

    function selectEstimate(estimateId) {
        const prevActiveId = String(state.activeEstimateId || '');
        if (prevActiveId !== String(estimateId) && window.canChangeTakeoffDrawing?.() === false) return false;
        const selected = Workspace.selectEstimate(state, estimateId);
        if (!selected) return false;
        const switched = prevActiveId !== String(selected.id);
        if (switched && isEstimatingTabActive()) {
            setEstimatingLoading(true, 'Loading estimate...', 'switch');
        }
        // Selecting a tab is local UI state, not an estimate content edit. It
        // must not increment the estimate revision or conflict with another
        // estimator editing that same estimate.
        try {
            ui.selected.clear();
            syncEstimatingSubheadInfo();
            saveLocal();
            render();
            publish();
        } catch (error) {
            setEstimatingLoading(false, undefined, 'switch');
            throw error;
        }
        if (switched) {
            window.dispatchEvent(new CustomEvent('takeoff:active-estimate-changed', {
                detail: { projectId, estimateId: selected.id, source: 'estimating' }
            }));
        }
        return true;
    }

    function refreshTableIfActive() {
        if (!isEstimatingTabActive()) {
            estimatingTableDirty = true;
            return;
        }
        estimatingTableDirty = false;
        renderTable();
    }

    function flushEstimatingTabView() {
        const hasPendingSync = typeof window.hasPendingTakeoffEstimatingSync === 'function' && window.hasPendingTakeoffEstimatingSync();
        if (!estimatingTableDirty && !hasPendingSync) {
            if (allItems().some(r => assemblyNeedsHydration(r.item))) {
                hydrateBrokenAssembliesInCurrentEstimate();
            }
            return;
        }
        setEstimatingLoading(true, 'Synchronizing estimate items...', 'sync');
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : cb => setTimeout(cb, 0);
        raf(() => setTimeout(() => {
            try {
                if (typeof window.flushTakeoffEstimatingSync === 'function') {
                    window.flushTakeoffEstimatingSync();
                }
                render(true);
                if (allItems().some(r => assemblyNeedsHydration(r.item))) {
                    hydrateBrokenAssembliesInCurrentEstimate();
                }
            } finally {
                setEstimatingLoading(false, undefined, 'sync');
            }
        }, 0));
    }

    window.addEventListener('takeoff:estimating-lines-updated', event => {
        if (event.detail?.projectId && String(event.detail.projectId) !== String(projectId)) return;
        const incomingEstId = String(event.detail?.activeEstimateId || '');
        const isBackgroundEstimate = Boolean(event.detail?.allowBackgroundEstimate);
        if (!isBackgroundEstimate && incomingEstId && incomingEstId !== String(state.activeEstimateId)) return;
        if (!(event.detail?.groups || []).length && event.detail?.complete !== true) return;
        const scopedSnapshot = Boolean(incomingEstId)
            && Number(event.detail?.version || 0) >= 2;
        reconcileGroups(incomingEstId || state.activeEstimateId,
            event.detail?.groups || [], {
            importNewLayers: scopedSnapshot,
            backgroundEstimate: isBackgroundEstimate && incomingEstId !== String(state.activeEstimateId)
        });
    });
    window.addEventListener('takeoff:layer-updated', refreshTableIfActive);
    window.addEventListener('takeoff:layers-updated', refreshTableIfActive);
    window.addEventListener('takeoff:layer-visuals-updated', refreshTableIfActive);
    window.addEventListener('takeoff:project-state-updated', refreshTableIfActive);
    window.addEventListener('takeoff:tab-activated', event => {
        if (event.detail?.tab === 'estimating') flushEstimatingTabView();
        else syncEstimatingSubheadInfo();
    });
    document.addEventListener('click', e => {
        if (e.target.closest('#tabBtnEstimating, [data-tab="estimating"], [href="#tab-estimating"]')) {
            setTimeout(flushEstimatingTabView, 0);
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
        if (event.detail?.source === 'estimating') return;
        if (String(state.activeEstimateId || '') === String(event.detail?.estimateId || '')) return;
        selectEstimate(event.detail?.estimateId);
    });
    window.addEventListener('takeoff:layer-properties-updated', event => {
        const detail = event.detail || {};
        if (!detail.layerId) return;
        const est = current();
        if (!est) return;
        let updated = 0;
        (est.groups || []).forEach(group => {
            (group.items || []).forEach(item => {
                if (String(item.takeoffLayerId || '') === String(detail.layerId)) {
                    if (detail.difficulty !== undefined) {
                        const dVal = Workspace.numeric(detail.difficulty);
                        if (dVal > 0 && item.difficulty !== dVal) {
                            item.difficulty = dVal;
                            updated++;
                        }
                    }
                }
            });
        });
        if (updated > 0) {
            changed(`Updated difficulty factor from Takeoff layer (${detail.difficulty})`);
            renderTable();
            publish();
        }
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
        changed(`Deleted ${removedCount} Takeoff group(s)`, { allowEmptyGroupsReplace: true });
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
    window.addEventListener('takeoff:estimating-group-rename-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (detail.estimateId && String(detail.estimateId) !== String(state.activeEstimateId)) return;
        const nextName = String(detail.name || '').trim().replace(/\s+/g, ' ');
        if (!nextName) return;
        const estimate = current();
        const rawGroupId = String(detail.groupId || '');
        const rawTakeoffGroupId = String(detail.takeoffGroupId || '');
        const oldName = String(detail.oldName || '').trim();
        const group = (estimate.groups || []).find(row =>
            (rawGroupId && (String(row.id) === rawGroupId || String(row.takeoffGroupId || '') === rawGroupId))
            || (rawTakeoffGroupId && (String(row.takeoffGroupId || '') === rawTakeoffGroupId
                || String(row.id) === `takeoff_group_${rawTakeoffGroupId}`
                || String(row.id) === rawTakeoffGroupId))
            || (oldName && String(row.name || '').trim() === oldName)
        );
        if (!group || group.name === nextName) return;
        group.name = nextName;
        (group.items || []).forEach(it => { it.groupName = nextName; });
        changed(`Renamed group "${nextName}"`);
    });
    window.addEventListener('takeoff:estimating-items-reorder-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId)) return;
        const { sourceLayerId, targetLayerId, targetGroupId } = detail;
        let draggedItem = null;
        for (const g of current().groups) {
            const item = (g.items || []).find(it => String(it.takeoffLayerId || it.id) === String(sourceLayerId));
            if (item) { draggedItem = item; break; }
        }
        if (!draggedItem) return;
        let targetItemId = null;
        if (targetLayerId) {
            for (const g of current().groups) {
                const item = (g.items || []).find(it => String(it.takeoffLayerId || it.id) === String(targetLayerId));
                if (item) { targetItemId = item.id; break; }
            }
        }
        let tgtGroupId = null;
        if (targetGroupId) {
            const grp = current().groups.find(g => String(g.takeoffGroupId || g.id) === String(targetGroupId) || String(g.id) === `takeoff_group_${targetGroupId}`);
            if (grp) tgtGroupId = grp.id;
        }
        moveEstimatingItem(draggedItem.id, targetItemId, tgtGroupId, true);
    });

    window.addEventListener('takeoff:estimating-groups-reorder-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId) || !Array.isArray(detail.groupIds)) return;
        const order = new Map(detail.groupIds.map((id, index) => [String(id), index]));
        const estimate = current();
        let renamedDuringReorder = false;
        if (Array.isArray(detail.groupNames)) {
            const nameById = new Map(detail.groupNames.map(entry => [String(entry.id), entry.name]));
            const nameByTakeoffId = new Map(detail.groupNames.map(entry => [String(entry.takeoffGroupId), entry.name]));
            estimate.groups.forEach(group => {
                const candidateName = nameById.get(String(group.id))
                    || (group.takeoffGroupId ? nameByTakeoffId.get(String(group.takeoffGroupId)) : null);
                if (candidateName && candidateName !== group.name) {
                    group.name = candidateName;
                    (group.items || []).forEach(it => { it.groupName = candidateName; });
                    renamedDuringReorder = true;
                }
            });
        }
        const before = estimate.groups.map(group => String(group.id)).join('|');
        estimate.groups.sort((a, b) => (order.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));
        estimate.groups.forEach((group, index) => { group.sortOrder = index; });
        if (!renamedDuringReorder && before === estimate.groups.map(group => String(group.id)).join('|')) return;
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

    window.projectEstimatingPersistDraft = async function (targetProjectId) {
        const persistedProjectId = Number(targetProjectId || 0);
        if (!Number.isSafeInteger(persistedProjectId) || persistedProjectId <= 0) {
            throw new Error('A persisted project ID is required before saving the Estimate workspace.');
        }
        const estimates = Workspace.clone(state.estimates || []).map(estimate => {
            estimate.projectId = String(persistedProjectId);
            estimate.revision = 0;
            delete estimate.dbEstimateId;
            delete estimate.estimateItemId;
            return estimate;
        });
        if (!estimates.length) throw new Error('The draft Estimate workspace is empty.');
        const activeEstimateId = estimates.some(row => String(row.id) === String(state.activeEstimateId || ''))
            ? state.activeEstimateId : estimates[0].id;
        estimates.forEach(row => { row.isActive = String(row.id) === String(activeEstimateId); });
        const draftPayload = {
            action: 'save', mode: 'replace', project_id: persistedProjectId,
            state: {
                schemaVersion: state.schemaVersion,
                projectId: persistedProjectId,
                activeEstimateId,
                clientUiUpdatedAt: state.clientUiUpdatedAt,
                estimates
            },
            summary: buildEstimateSummaryPayload(estimates.find(row => String(row.id) === String(activeEstimateId)) || estimates[0])
        };
        const response = await fetch(`${apiUrl}?action=create&project_id=${encodeURIComponent(persistedProjectId)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftPayload)
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
            const error = new Error(result?.error?.message || result?.message || `Estimate persistence failed (HTTP ${response.status}).`);
            error.code = result?.error?.code || result?.code || 'draft_persistence_failed';
            throw error;
        }
        const acknowledged = result.state?.estimates || result.estimates || [];
        if (!acknowledged.length) throw new Error('Estimate persistence returned no database acknowledgement.');
        const persistedWorkspace = Workspace.workspace({
            ...state,
            projectId: persistedProjectId,
            activeEstimateId: result.state?.activeEstimateId || activeEstimateId,
            estimates: acknowledged
        }, persistedProjectId);
        delete persistedWorkspace.pendingProjectCreationSync;
        safeSetLocalStorage(`takeoff.estimating.module.${persistedProjectId}`, JSON.stringify(persistedWorkspace));
        estimatingHasUnsavedCheckpoint = false;
        return { persisted: true, projectId: persistedProjectId, state: result.state };
    };

    window.projectEstimatingSave = async function () {
        if (!projectId) {
            const persistedProjectId = Number(window.ProjectState?.projectId || 0);
            if (persistedProjectId > 0) return window.projectEstimatingPersistDraft(persistedProjectId);
            throw new Error('Save the project record before persisting its Estimate workspace.');
        }
        const started = Date.now();
        ui.saveRequested = true;
        ui.explicitSaveRequested = true;
        while (ui.saving || ui.saveRequested) {
            if (Date.now() - started > 15000) throw new Error('Estimating save timed out.');
            if (ui.saving) {
                await new Promise(resolve => setTimeout(resolve, 50));
                continue;
            }
            clearTimeout(ui.saveTimer);
            await saveServer({ showModal: false });
            if (ui.loadState === 'error') {
                const error = new Error(ui.message);
                error.code = ui.lastErrorCode || 'save_failed';
                throw error;
            }
        }
        estimatingHasUnsavedCheckpoint = false;
        ui.explicitSaveRequested = false;
        return true;
    };

    function catalogDomainOptions(options = {}) {
        const result = {
            matchUnlinkedByCodeOrName: true,
            forceInPlace: true,
            ...options
        };
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
        const strategy = Application.resolveCatalogUpdateStrategy(estimate, domainOptions);
        return {
            ...prepared,
            estimateName: estimate.name || 'Active Estimate',
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

    window.isEstimatingDirty = () => Boolean(ui.saving || ui.saveRequested || dirtyEstimateIds.size || estimatingHasUnsavedCheckpoint);

    function buildEstimatePatchPayload(sentIds) {
        const estimates = Workspace.clone(state.estimates.filter(estimate => sentIds.includes(String(estimate.id)))).map(estimate => {
            const estSummary = buildEstimateSummaryPayload(estimate);
            return {
                ...estimate,
                is_primary: Boolean(estimate.is_primary || estimate.isPrimary),
                isPrimary: Boolean(estimate.is_primary || estimate.isPrimary),
                estimateSummary: estSummary,
                estimateTotal: estSummary.estimateTotal,
                totalSales: estSummary.estimateTotal
            };
        });
        return {
            action: 'save',
            mode: 'patch',
            project_id: projectId,
            updates: estimates,
            estimates,
            project_estimating_table_settings: window.ProjectState?.projectMeta?.estimatingTableSettings || null,
            state: {
                schemaVersion: state.schemaVersion,
                projectId: state.projectId,
                activeEstimateId: state.activeEstimateId,
                clientUiUpdatedAt: state.clientUiUpdatedAt,
                estimates
            },
            summary: buildEstimateSummaryPayload(current())
        };
    }

    function flushDirtyEstimatesKeepalive() {
        if (!projectId || ui.saving || !dirtyEstimateIds.size || calculationErrors().length) return;
        const sentIds = [...dirtyEstimateIds].filter(id => !conflictedEstimateIds.has(id)
            && state.estimates.some(estimate => String(estimate.id) === id));
        if (!sentIds.length) return;
        const payload = buildEstimatePatchPayload(sentIds);
        try {
            fetch(`${apiUrl}?action=save&project_id=${projectId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            });
        } catch (_) { }
    }

    window.addEventListener('pagehide', flushDirtyEstimatesKeepalive);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushDirtyEstimatesKeepalive();
    });

    window.addEventListener('beforeunload', event => {
        const hasPendingBuffer = Boolean(ui.saving || ui.saveRequested || dirtyEstimateIds.size);
        if (hasPendingBuffer) flushDirtyEstimatesKeepalive();
        if (!hasPendingBuffer && !estimatingHasUnsavedCheckpoint) return;
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

        safeSetLocalStorage('takeoff.estimatingRightCollapsed', willCollapse ? '1' : '0');
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
                } else if (prop === 'operator') {
                    markup.operator = target.value;
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
                } else if (prop === 'operator') {
                    const prevOp = markup.operator || 'add';
                    markup.operator = target.value;
                    changed(`Updated "${markup.name}" operator (${prevOp} -> ${target.value})`);
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
            try { resizer.setPointerCapture(e.pointerId); } catch (_) { }
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
            safeSetLocalStorage('takeoff.summaryColWidths', JSON.stringify(ui.summaryColWidths || {}));
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
        const estMain = root.querySelector('.est-main');
        const toolbarToggle = $('estToolbarToggleRight');
        if (!resizer || !estRight) return;

        try {
            const saved = localStorage.getItem('takeoff.estimatingRightWidth');
            if (saved) {
                const parsed = parseInt(saved, 10);
                if (parsed >= 260 && parsed <= 850) {
                    estRight.style.setProperty('--est-right-w', `${parsed}px`);
                    estRight.style.width = `${parsed}px`;
                    estRight.style.flexBasis = `${parsed}px`;
                }
            }
            const savedCollapsed = localStorage.getItem('takeoff.estimatingRightCollapsed');
            if (savedCollapsed === '1') {
                toggleEstimatingRight(true);
            }
        } catch (_) { }

        toolbarToggle?.addEventListener('click', e => {
            e.stopPropagation();
            toggleEstimatingRight();
        });

        let isDragging = false;
        let startX = 0;
        let startWidth = 0;

        const onPointerDown = e => {
            if (estMain?.classList.contains('details-collapsed')) return;

            isDragging = true;
            startX = e.clientX;
            const currentComputed = parseInt(getComputedStyle(estRight).width, 10) || 420;
            startWidth = currentComputed;
            resizer.classList.add('is-dragging');
            estMain?.classList.add('is-resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            try { resizer.setPointerCapture(e.pointerId); } catch (_) { }
            e.preventDefault();
        };

        const onPointerMove = e => {
            if (!isDragging) return;
            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            const deltaX = (e.clientX - startX) / zoom;
            const newWidth = Math.max(260, Math.min(850, Math.round(startWidth - deltaX)));
            estRight.style.setProperty('--est-right-w', `${newWidth}px`);
            estRight.style.width = `${newWidth}px`;
            estRight.style.flexBasis = `${newWidth}px`;
        };

        const stopDragging = e => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('is-dragging');
            estMain?.classList.remove('is-resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try {
                if (e?.pointerId) resizer.releasePointerCapture(e.pointerId);
            } catch (_) { }

            const finalWidth = parseInt(getComputedStyle(estRight).width, 10) || 420;
            safeSetLocalStorage('takeoff.estimatingRightWidth', String(finalWidth));
        };

        resizer.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', stopDragging);
        window.addEventListener('pointercancel', stopDragging);
    }

    function showEstCanvasToast(text, type = 'info') {
        const container = document.fullscreenElement || document.body;
        document.querySelectorAll('.toast-lite').forEach(el => el.remove());
        const toast = document.createElement('div');
        toast.className = 'toast-lite';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.style.cssText = 'position:fixed !important; top:16px !important; bottom:auto !important; left:50% !important; right:auto !important; transform:translateX(-50%) !important; z-index:999999 !important; border-radius:9999px !important; padding:4px 14px !important; height:28px !important; font-size:12px !important; display:inline-flex !important; align-items:center !important; gap:7px !important; pointer-events:none !important; white-space:nowrap !important;';
        const iconClass = type === 'error' ? 'fa-circle-exclamation' : (type === 'success' ? 'fa-circle-check' : 'fa-info-circle');
        const iconColor = type === 'error' ? '#ef4444' : (type === 'success' ? '#22c55e' : '#38bdf8');
        toast.innerHTML = `<i class="fas ${iconClass}" style="color:${iconColor}; font-size:12px; margin-right:4px;"></i><span>${esc(text)}</span>`;
        container.appendChild(toast);
        setTimeout(() => { try { toast.remove(); } catch (_) {} }, 3400);
    }

    function syncEstimatingFullscreenUi() {
        const isNativeFs = Boolean(document.fullscreenElement === root || (document.fullscreenElement && root && document.fullscreenElement.contains(root)));
        const isFallbackFs = root.classList.contains('est-fullscreen') && !document.fullscreenElement;
        const isFs = Boolean(isNativeFs || isFallbackFs);
        root.classList.toggle('is-fullscreen', isFs);
        document.body.classList.toggle('est-is-fullscreen', isFs);
        const fsBtn = $('estBtnFullscreen');
        if (fsBtn) {
            fsBtn.classList.toggle('is-active', isFs);
            fsBtn.setAttribute('aria-pressed', isFs ? 'true' : 'false');
            fsBtn.setAttribute('title', isFs ? 'Exit full screen' : 'Full screen');
            const icon = fsBtn.querySelector('i');
            if (icon) icon.className = isFs ? 'fas fa-compress' : 'fas fa-expand';
        }
        return isFs;
    }

    async function toggleEstimatingFullscreen() {
        const currentlyNative = document.fullscreenElement === root;
        const currentlyFallback = root.classList.contains('est-fullscreen');
        if (currentlyNative) {
            try { await document.exitFullscreen?.(); } catch (_) {}
            root.classList.remove('est-fullscreen', 'is-fullscreen');
            document.body.classList.remove('est-is-fullscreen');
            syncEstimatingFullscreenUi();
            return;
        }
        if (currentlyFallback) {
            root.classList.remove('est-fullscreen', 'is-fullscreen');
            document.body.classList.remove('est-is-fullscreen');
            syncEstimatingFullscreenUi();
            return;
        }
        if (typeof root.requestFullscreen === 'function') {
            try {
                await root.requestFullscreen();
                syncEstimatingFullscreenUi();
                showEstCanvasToast('Fullscreen active — press the Full screen button again (or Esc) to exit', 'info');
                return;
            } catch (_) { }
        }
        root.classList.add('est-fullscreen', 'is-fullscreen');
        document.body.classList.add('est-is-fullscreen');
        syncEstimatingFullscreenUi();
        showEstCanvasToast('Fullscreen active — press the Full screen button again to exit', 'info');
    }

    document.addEventListener('fullscreenchange', () => {
        const isFs = Boolean(document.fullscreenElement === root);
        if (!isFs) root.classList.remove('est-fullscreen');
        syncEstimatingFullscreenUi();
    });

    const hasInitialGroups = (current()?.groups || []).length > 0;
    if (!projectId || hasInitialGroups || dirtyEstimateIds.size > 0) {
        saveLocal();
    } else {
        saveLocal({ publish: false });
    }
    render();
    initEstimatingResizer();
    loadServer();
})();
