(function () {
    const root = document.getElementById('estimatingModule');
    if (!root) return;

    const Calc = window.EstimateCalculationService;
    const projectId = Number(root.dataset.projectId || window.ProjectState?.projectId || 0);
    const storageKey = `takeoff.estimating.module.${projectId || 'draft'}`;
    const columnPrefKey = `takeoff.estimating.columns.${projectId || 'draft'}`;
    const takeoffKey = `takeoff.quantification.${projectId || 'draft'}`;
    const estimatingApi = '../api/project_estimating.php';
    const saveDelay = 750;
    const squareFootage = Number(window.ProjectState?.projectMeta?.square_footage || 0);
    let serverReady = !projectId;
    let saveTimer = null;
    let saveInFlight = false;
    let saveRequested = false;
    let changeRevision = 0;
    let localCacheFound = false;

    const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value || 0));
    const number = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
    const id = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const columns = [
        ['select', '', true],
        ['name', 'Item Name', true],
        ['description', 'Description', true],
        ['budgetCode', 'Budget Code', true],
        ['costCode', 'Cost Code', true],
        ['costCategory', 'Cost Category', true],
        ['uom', 'UoM', true],
        ['quantity', 'Quantity', true],
        ['quantitySource', 'Quantity Source', true],
        ['unitMaterialCost', 'Unit Material Cost', true],
        ['waste', 'Waste %', true],
        ['materialCost', 'Subtotal Material Cost', true],
        ['materialMargin', 'Material Margin %', true],
        ['unitMaterialSales', 'Unit Material Sales', false],
        ['materialSales', 'Subtotal Material Sales', true],
        ['unitEquipmentCost', 'Unit Equipment Cost', false],
        ['equipmentQuantity', 'Equipment Quantity', false],
        ['equipmentCost', 'Equipment Cost', false],
        ['equipmentMargin', 'Equipment Margin %', false],
        ['equipmentSales', 'Equipment Sales', false],
        ['unitLabor', 'Unit Labor', true],
        ['laborUnitType', 'Labor Unit Type', true],
        ['laborRate', 'Labor Rate', true],
        ['difficulty', 'Difficulty Factor', true],
        ['laborHours', 'Total Labor Hours', true],
        ['laborCost', 'Total Labor Cost', true],
        ['laborMargin', 'Labor Margin %', true],
        ['laborSales', 'Total Labor Sales', true],
        ['totalCost', 'Total Cost', true],
        ['totalSales', 'Total Sales', true],
        ['profit', 'Profit', true],
        ['marginPercent', 'Margin %', true],
        ['taxable', 'Tax', true],
        ['notes', 'Notes', false],
        ['catalogStatus', 'Catalog Item Status', true],
        ['takeoffStatus', 'Takeoff Link Status', true],
        ['updatedAt', 'Last Updated', true]
    ];

    const state = loadState();

    function normalizeType(value) {
        const raw = String(value || '').toLowerCase();
        if (raw.includes('labor')) return 'Labor';
        if (raw.includes('equip')) return 'Equipment';
        return 'Materials';
    }

    function defaultSettings() {
        return {
            marginMode: 'margin',
            globalLaborCost: 85,
            globalLaborSales: 110,
            taxes: { Materials: 0, Labor: 0, Equipment: 0 },
            preTaxMarkups: [
                { id: id('mk'), name: 'Overhead', type: 'percentage', percent: 4, base: 'subtotal_sales', active: true },
                { id: id('mk'), name: 'Discount', type: 'percentage', percent: 0, base: 'subtotal_sales', active: true }
            ],
            postTaxMarkups: [
                { id: id('mk'), name: 'Bonding', type: 'percentage', percent: 0, base: 'subtotal_sales', active: true },
                { id: id('mk'), name: 'Permit Impact Fee', type: 'percentage', percent: 0, base: 'subtotal_sales', active: true }
            ]
        };
    }

    function defaultEstimate(name = 'Primary Estimate') {
        return {
            id: id('est'),
            projectId,
            name,
            code: '',
            description: '',
            status: 'draft',
            version: 1,
            isActive: true,
            isLocked: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: 'Current user',
            groups: seedGroups(),
            notes: {
                scope: 'Describe the scope of work for this estimate.',
                projectNotes: '',
                included: ['Furnish and install listed materials', 'Labor during normal business hours', 'Coordination with project drawings'],
                excluded: ['Permit fees unless noted', 'Utility company charges', 'Work not shown in documents']
            },
            settings: defaultSettings(),
            auditLog: []
        };
    }

    function normalizeItem(item = {}) {
        const qty = Number(item.quantity ?? item.originalQuantity ?? 0);
        const source = item.quantitySource || (item.takeoffLayerId ? 'takeoff' : (item.sourceType || item.source_type || 'manual'));
        return {
            id: String(item.id || id('item')),
            estimateItemId: item.estimateItemId || null,
            parentId: item.parentId || item.parent_estimate_item_id || null,
            rowType: item.rowType || item.type === 'assembly' ? 'item' : (item.rowType || 'item'),
            isAssembly: Boolean(item.isAssembly || item.assemblyId || item.assembly_id || String(item.itemType || item.item_type || '').toLowerCase() === 'assembly'),
            assemblyId: item.assemblyId || item.assembly_id || null,
            takeoffLayerId: item.takeoffLayerId || item.sourceTakeoffId || item.takeoff_layer_id || null,
            catalogItemId: item.catalogItemId || item.catalog_item_id || null,
            name: item.name || item.catalog_item_name || item.takeoff_layer_name || 'Cost item',
            description: item.description || '',
            budgetCode: item.budgetCode || item.budget_code || '',
            costCode: item.costCode || item.cost_code || item.budgetCode || '',
            costCategory: normalizeType(item.costCategory || item.cost_type || item.item_type || item.type),
            uom: item.uom || item.unit_of_measure || 'ea',
            quantity: qty,
            originalQuantity: Number(item.originalQuantity ?? qty),
            quantityOverride: Boolean(item.quantityOverride || item.quantity_override),
            quantitySource: source,
            quantitySyncStatus: item.quantitySyncStatus || item.quantity_sync_status || (source === 'takeoff' ? 'synced' : 'manual'),
            lastSyncedTakeoffQuantity: Number(item.lastSyncedTakeoffQuantity ?? item.last_synced_takeoff_quantity ?? (source === 'takeoff' ? qty : 0)),
            pendingTakeoffQuantity: item.pendingTakeoffQuantity ?? null,
            catalogSnapshot: item.catalogSnapshot || item.catalog_snapshot || null,
            catalogVersion: item.catalogVersion || item.catalog_version || '',
            catalogLastSyncedAt: item.catalogLastSyncedAt || item.catalog_last_synced_at || null,
            catalogSyncStatus: item.catalogSyncStatus || item.catalog_sync_status || (item.catalogItemId || item.catalog_item_id ? 'synced' : 'detached'),
            itemType: item.itemType || item.item_type || '',
            unitMaterialCost: Number(item.unitMaterialCost ?? item.unitCost ?? item.unit_cost ?? 0),
            waste: Number(item.waste ?? item.waste_percentage ?? 0),
            materialMargin: Number(item.materialMargin ?? item.margin ?? item.margin_percentage ?? 0),
            unitEquipmentCost: Number(item.unitEquipmentCost ?? item.equipment_cost ?? 0),
            equipmentQuantity: Number(item.equipmentQuantity ?? 0),
            equipmentMargin: Number(item.equipmentMargin ?? 0),
            unitLabor: Number(item.unitLabor ?? item.unit_labor_time ?? item.laborHours ?? item.labor_hours ?? 0),
            laborUnitType: item.laborUnitType || item.laborUnit || 'mins',
            laborRate: Number(item.laborRate ?? item.labor_rate ?? 85),
            difficulty: Number(item.difficulty ?? item.difficulty_factor ?? 1),
            laborMargin: Number(item.laborMargin ?? item.labor_margin_percentage ?? 0),
            taxable: item.taxable !== false && Number(item.taxable ?? 1) !== 0,
            taxMaterial: item.taxMaterial !== false,
            taxLabor: item.taxLabor !== false,
            taxEquipment: item.taxEquipment !== false,
            notes: item.notes || '',
            locked: Boolean(item.locked),
            validation: [],
            updatedAt: item.updatedAt || item.updated_at || new Date().toISOString()
        };
    }

    function seedGroups() {
        const sourceItems = Array.isArray(window.ProjectState?.estimateItems) ? window.ProjectState.estimateItems : [];
        const map = new Map();
        sourceItems.forEach(item => {
            const name = item.group_name || item.cost_type || normalizeType(item.item_type || item.source_type || 'Materials');
            if (!map.has(name)) map.set(name, { id: id('grp'), name, parentId: null, expanded: true, sortOrder: map.size, items: [] });
            map.get(name).items.push(normalizeItem(item));
        });
        return Array.from(map.values());
    }

    function normalizeGroup(group = {}, index = 0) {
        return {
            id: String(group.id || id('grp')),
            name: group.name || group.groupName || 'Default Group',
            parentId: group.parentId || null,
            expanded: group.expanded !== false,
            sortOrder: Number(group.sortOrder ?? index),
            items: (group.items || []).map(normalizeItem)
        };
    }

    function migrateState(parsed) {
        const hiddenColumns = Array.isArray(parsed?.hiddenColumns) ? parsed.hiddenColumns : readColumnPreference();
        if (parsed?.estimates?.length) {
            const estimates = parsed.estimates.map(est => ({
                ...defaultEstimate(est.name || 'Estimate'),
                ...est,
                groups: (est.groups || parsed.groups || []).map(normalizeGroup),
                settings: { ...defaultSettings(), ...(est.settings || {}) },
                notes: { ...defaultEstimate().notes, ...(est.notes || {}) },
                auditLog: Array.isArray(est.auditLog) ? est.auditLog : []
            }));
            return { ...parsed, estimates, hiddenColumns, selected: [], search: parsed.search || '', columnSearch: '', dirty: false, catalogItems: [], catalogLoaded: false };
        }
        const estimate = defaultEstimate('Primary Estimate');
        estimate.groups = (parsed?.groups || estimate.groups).map(normalizeGroup);
        estimate.settings = {
            ...estimate.settings,
            globalLaborCost: Number(parsed?.globalLaborCost || estimate.settings.globalLaborCost),
            globalLaborSales: Number(parsed?.globalLaborSales || estimate.settings.globalLaborSales),
            taxes: parsed?.taxes || estimate.settings.taxes,
            preTaxMarkups: (parsed?.preTaxMarkups || estimate.settings.preTaxMarkups).map(m => ({ type: 'percentage', base: 'subtotal_sales', active: true, ...m })),
            postTaxMarkups: (parsed?.postTaxMarkups || estimate.settings.postTaxMarkups).map(m => ({ type: 'percentage', base: 'subtotal_sales', active: true, ...m }))
        };
        estimate.notes = {
            scope: parsed?.scope || estimate.notes.scope,
            projectNotes: parsed?.projectNotes || '',
            included: Array.isArray(parsed?.included) ? parsed.included : estimate.notes.included,
            excluded: Array.isArray(parsed?.excluded) ? parsed.excluded : estimate.notes.excluded
        };
        return {
            activeEstimateId: parsed?.activeEstimateId || estimate.id,
            estimates: [estimate],
            selected: [],
            search: '',
            columnSearch: '',
            hiddenColumns,
            dirty: false,
            tableSettingsOpen: false,
            rightCollapsed: false,
            notesCollapsed: Boolean(parsed?.notesCollapsed),
            summaryCollapsed: Boolean(parsed?.summaryCollapsed),
            catalogItems: [],
            catalogLoaded: false,
            importPreview: null,
            reviewOpen: false,
            copyEstimateOpen: false
        };
    }

    function loadState() {
        try {
            const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (parsed) {
                localCacheFound = true;
                return migrateState(parsed);
            }
        } catch (e) {}
        const estimate = defaultEstimate();
        return migrateState({ activeEstimateId: estimate.id, estimates: [estimate] });
    }

    function readColumnPreference() {
        try {
            const saved = JSON.parse(localStorage.getItem(columnPrefKey) || 'null');
            if (Array.isArray(saved)) return saved;
        } catch (e) {}
        return columns.filter(([, , visible]) => !visible).map(([key]) => key);
    }

    function activeEstimate() {
        let estimate = state.estimates.find(est => est.id === state.activeEstimateId);
        if (!estimate) {
            estimate = state.estimates[0] || defaultEstimate();
            state.activeEstimateId = estimate.id;
        }
        return estimate;
    }

    function activeSettings() {
        return activeEstimate().settings || defaultSettings();
    }

    function allItems(estimate = activeEstimate()) {
        return estimate.groups.flatMap(group => group.items.map(item => ({ ...item, groupId: group.id, groupName: group.name })));
    }

    function findItem(itemId) {
        for (const group of activeEstimate().groups) {
            const item = group.items.find(row => row.id === itemId);
            if (item) return { group, item };
        }
        return null;
    }

    function audit(action, before, after, entity = 'estimate') {
        activeEstimate().auditLog.unshift({
            id: id('audit'),
            user: 'Current user',
            at: new Date().toISOString(),
            action,
            entity,
            before,
            after
        });
        activeEstimate().auditLog = activeEstimate().auditLog.slice(0, 200);
    }

    function markDirty() {
        state.dirty = true;
        changeRevision += 1;
        activeEstimate().updatedAt = new Date().toISOString();
    }

    function serializableState() {
        const estimate = activeEstimate();
        const summary = publicEstimateSummary();
        return {
            activeEstimateId: state.activeEstimateId,
            estimates: state.estimates,
            selected: state.selected,
            search: state.search,
            hiddenColumns: state.hiddenColumns,
            rightCollapsed: state.rightCollapsed,
            notesCollapsed: state.notesCollapsed,
            summaryCollapsed: state.summaryCollapsed,
            groups: estimate.groups,
            estimateSummary: summary,
            globalLaborCost: estimate.settings.globalLaborCost,
            globalLaborSales: estimate.settings.globalLaborSales,
            taxes: estimate.settings.taxes,
            preTaxMarkups: estimate.settings.preTaxMarkups,
            postTaxMarkups: estimate.settings.postTaxMarkups,
            scope: estimate.notes.scope,
            projectNotes: estimate.notes.projectNotes,
            included: estimate.notes.included,
            excluded: estimate.notes.excluded,
            clientUpdatedAt: estimate.updatedAt
        };
    }

    function persist(options = {}) {
        const estimate = activeEstimate();
        const summary = publicEstimateSummary();
        const payload = serializableState();
        localStorage.setItem(storageKey, JSON.stringify(payload));
        if (window.ProjectState) {
            window.ProjectState.estimateSummary = summary;
            window.ProjectState.estimateItems = allItems(estimate);
        }
        window.dispatchEvent(new CustomEvent('takeoff:estimate-summary-updated', { detail: summary }));
        if ((state.dirty || options.forceServer) && serverReady && projectId) scheduleServerSave(Boolean(options.immediate));
    }

    function scheduleServerSave(immediate = false) {
        if (!projectId) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flushServerSave, immediate ? 0 : saveDelay);
    }

    async function flushServerSave() {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (saveInFlight) {
            saveRequested = true;
            return;
        }
        saveInFlight = true;
        const savedRevision = changeRevision;
        try {
            const response = await fetch(estimatingApi, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                keepalive: true,
                body: JSON.stringify({ action: 'save', project_id: projectId, state: serializableState() })
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || result?.success === false) throw new Error(result?.message || `HTTP ${response.status}`);
            if (savedRevision === changeRevision) state.dirty = false;
        } catch (error) {
            state.dirty = true;
            console.warn('Estimating server save failed; local cache retained.', error);
        } finally {
            saveInFlight = false;
            if (saveRequested || savedRevision !== changeRevision) {
                saveRequested = false;
                scheduleServerSave();
            }
        }
    }

    function newestStateTimestamp(candidate) {
        const estimates = Array.isArray(candidate?.estimates) ? candidate.estimates : [];
        return Math.max(0, ...estimates.map(estimate => Date.parse(estimate.updatedAt || estimate.updated_at || '') || 0));
    }

    async function loadServerState() {
        if (!projectId) return;
        const startingRevision = changeRevision;
        try {
            const response = await fetch(`${estimatingApi}?action=load&project_id=${encodeURIComponent(projectId)}`, {
                headers: { Accept: 'application/json' }
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || result?.success === false) throw new Error(result?.message || `HTTP ${response.status}`);
            const remote = result?.state || result?.data?.state || result?.data || (Array.isArray(result?.estimates) ? result : null);
            if (!remote || !Array.isArray(remote.estimates)) {
                state.dirty = true;
                return;
            }

            // Changes made while the request was pending always win. Otherwise use
            // the newest copy so an unsent local draft is never silently discarded.
            const local = serializableState();
            if (startingRevision === changeRevision && (!localCacheFound || newestStateTimestamp(remote) >= newestStateTimestamp(local))) {
                const hydrated = migrateState(remote);
                Object.keys(state).forEach(key => delete state[key]);
                Object.assign(state, hydrated);
                localStorage.setItem(storageKey, JSON.stringify(serializableState()));
                render();
            }
        } catch (error) {
            console.warn('Estimating server load failed; using local cache.', error);
        } finally {
            serverReady = true;
            if (state.dirty || startingRevision !== changeRevision) scheduleServerSave();
        }
    }

    function publicEstimateSummary() {
        const estimate = activeEstimate();
        const summary = Calc.calculateSummary(estimate.groups, estimate.settings);
        return {
            estimateId: estimate.id,
            estimateName: estimate.name,
            status: estimate.status,
            subtotal: summary.direct.totalSales,
            preTaxMarkup: summary.preTaxTotal,
            taxes: summary.totalTax,
            postTaxMarkup: summary.postTaxTotal,
            total: summary.estimateTotal,
            material: summary.byCategory.Materials.materialSales,
            labor: summary.direct.laborSales,
            equipment: summary.byCategory.Equipment.equipmentSales,
            profit: summary.profit,
            marginPercent: summary.marginPercent,
            laborHours: summary.direct.adjustedLaborHours,
            updatedAt: estimate.updatedAt
        };
    }

    function validateItem(item) {
        const errors = [];
        if (Number(item.quantity) < 0) errors.push('Quantity is negative.');
        if (Number(item.waste) < 0) errors.push('Waste cannot be below 0.');
        if (Number(item.materialMargin) >= 100 || Number(item.laborMargin) >= 100 || Number(item.equipmentMargin) >= 100) errors.push('Margin must be below 100%.');
        if (Number(item.laborRate) < 0) errors.push('Labor rate cannot be negative.');
        if (Number(item.difficulty) <= 0) errors.push('Difficulty factor must be greater than 0.');
        if (item.quantitySource === 'takeoff' && !item.takeoffLayerId) errors.push('Takeoff source is missing.');
        if (item.catalogSyncStatus === 'catalog_item_missing') errors.push('Catalog item is missing.');
        item.validation = errors;
        return errors;
    }

    function statusPill(item) {
        const q = item.quantitySyncStatus || 'manual';
        const c = item.catalogSyncStatus || 'detached';
        const qText = {
            synced: 'Synced with Takeoff',
            modified: 'Manual quantity override',
            missing_takeoff: 'Missing Takeoff',
            takeoff_changed: `Takeoff changed to ${number(item.pendingTakeoffQuantity || 0)}`,
            detached: 'Detached'
        }[q] || q;
        const cText = {
            synced: 'Catalog synced',
            catalog_updated: 'Catalog updated',
            catalog_item_missing: 'Catalog item missing',
            detached: 'Detached from catalog'
        }[c] || c;
        return `<span class="est-status ${esc(q)}" title="${esc(qText)}">${esc(qText)}</span><span class="est-status ${esc(c)}" title="${esc(cText)}">${esc(cText)}</span>`;
    }

    function render() {
        const estimate = activeEstimate();
        const summary = Calc.calculateSummary(estimate.groups, estimate.settings);
        root.classList.toggle('est-fullscreen', Boolean(state.fullscreen));
        root.innerHTML = `
            <header class="est-header">
                <div class="est-title-block">
                    <strong>${esc(window.ProjectState?.projectInfo?.name || document.querySelector('.project-title h1')?.textContent || 'Project')}</strong>
                    <span>${esc(estimate.name)} · ${esc(estimate.status.replace('_', ' '))} · Updated ${new Date(estimate.updatedAt).toLocaleString()}</span>
                </div>
                <div class="est-header-actions">
                    <span class="est-save-state ${state.dirty ? 'dirty' : ''}">${state.dirty ? 'Unsaved changes' : 'Saved'}</span>
                    <select class="est-estimate-select" data-estimate-select>${state.estimates.map(est => `<option value="${esc(est.id)}" ${est.id === estimate.id ? 'selected' : ''}>${esc(est.name)}</option>`).join('')}</select>
                    <button class="est-btn est-btn-primary" data-est-action="save"><i class="fas fa-floppy-disk"></i><span>Save</span></button>
                    ${menuButton('actions', 'Actions', [
                        ['refresh-takeoff', 'Refresh Estimate Quantities from Takeoff'],
                        ['refresh-catalog', 'Refresh Costs from Global Cost Catalog'],
                        ['recalculate', 'Recalculate Estimate'],
                        ['duplicate-estimate', 'Duplicate Estimate'],
                        ['rename-estimate', 'Rename Estimate'],
                        [estimate.isLocked ? 'unlock-estimate' : 'lock-estimate', estimate.isLocked ? 'Unlock Estimate' : 'Lock Estimate'],
                        ['show-proposal', 'Show Proposal'],
                        ['delete-estimate', 'Delete Estimate', 'danger']
                    ])}
                    ${menuButton('import', 'Import', [
                        ['import-bom', 'Import Bill of Materials from Excel'],
                        ['download-template', 'Download import template'],
                        ['validate-import', 'Validate import file']
                    ])}
                    ${menuButton('export', 'Export', [
                        ['export-estimate', 'Export Estimate to Excel'],
                        ['export-bom', 'Export Bill of Materials'],
                        ['export-summary', 'Export Estimate Summary'],
                        ['export-proposal', 'Export Proposal PDF']
                    ])}
                </div>
            </header>
            ${takeoffAlert()}
            <main class="est-main">
                <section class="est-left ${state.tableSettingsOpen ? 'has-table-settings' : ''}">
                    <div class="est-toolbar">
                        <label class="est-search"><i class="fas fa-search"></i><input id="estSearch" value="${esc(state.search)}" type="search" placeholder="Search cost item"></label>
                        <button class="est-btn est-btn-primary" data-est-action="add-catalog"><i class="fas fa-book"></i><span>Add from Catalog</span></button>
                        <button class="est-btn" data-est-action="create-group"><i class="fas fa-folder-plus"></i><span>Create group</span></button>
                        <button class="est-btn" data-est-action="create-item"><i class="fas fa-plus"></i><span>Manual item</span></button>
                        <button class="est-icon-btn" data-est-action="columns" title="Table Settings"><i class="fas fa-sliders"></i></button>
                        <button class="est-icon-btn" data-est-action="fullscreen" title="Full screen"><i class="fas fa-expand"></i></button>
                        <button class="est-btn est-btn-danger" data-est-action="delete-selected" ${state.selected.length ? '' : 'disabled'}><i class="fas fa-trash"></i><span>Delete</span></button>
                    </div>
                    ${state.tableSettingsOpen ? renderTableSettings() : ''}
                    <div class="est-table-wrap"><table class="est-table"><thead>${renderTableHead()}</thead><tbody>${renderTableBody(summary)}</tbody></table></div>
                    <button class="est-create-bottom" data-est-action="create-group"><i class="fas fa-folder-plus"></i> Create new group</button>
                </section>
                <aside class="est-right ${state.rightCollapsed ? 'collapsed' : ''}">
                    ${renderRightPanel(summary)}
                </aside>
            </main>
            ${renderVersionBar(summary)}
            ${renderModals()}
            <div class="est-row-menu" id="estRowMenu" hidden></div>
        `;
        bindEvents();
        persist();
    }

    function menuButton(idValue, label, items) {
        return `<div class="est-menu-wrap"><button class="est-btn" data-menu-toggle="${idValue}">${esc(label)} <i class="fas fa-chevron-down"></i></button><div class="est-menu" id="estMenu-${idValue}">${items.map(([action, text, cls]) => `<button class="${cls || ''}" data-est-action="${action}">${esc(text)}</button>`).join('')}</div></div>`;
    }

    function takeoffAlert() {
        const changed = allItems().filter(item => item.quantitySyncStatus === 'takeoff_changed');
        if (!changed.length) return '';
        return `<div class="est-sync-alert"><strong>${changed.length} estimate item(s) have updated Takeoff quantities.</strong><button data-est-action="review-takeoff">Review Changes</button><button data-est-action="sync-all">Sync All</button><button data-est-action="ignore-takeoff">Ignore</button></div>`;
    }

    function renderTableHead() {
        return `<tr>${columns.map(([key, label]) => `<th class="${colClass(key)}">${esc(label)}</th>`).join('')}<th class="est-actions-col"></th></tr>`;
    }

    function colClass(key) {
        return state.hiddenColumns.includes(key) ? 'est-col-hidden' : `est-col-${key}`;
    }

    function renderTableBody() {
        const estimate = activeEstimate();
        const query = state.search.trim().toLowerCase();
        const rows = [];
        estimate.groups.sort((a, b) => a.sortOrder - b.sortOrder).forEach(group => {
            const visibleItems = group.items.filter(item => !query || [item.name, item.description, item.costCode, item.budgetCode, item.notes].join(' ').toLowerCase().includes(query));
            if (query && !visibleItems.length && !group.name.toLowerCase().includes(query)) return;
            rows.push(groupRow(group, visibleItems));
            if (group.expanded !== false) visibleItems.forEach(item => rows.push(itemRow(group, item)));
        });
        return rows.join('') || `<tr><td colspan="${columns.length + 1}" class="est-empty">No cost items found.</td></tr>`;
    }

    function groupRow(group, visibleItems) {
        const totals = Calc.calculateSummary([{ ...group, items: group.items }], activeSettings()).direct;
        return `<tr class="est-row-group" data-group-id="${esc(group.id)}">
            ${cell('select', `<input type="checkbox" data-select-group="${esc(group.id)}">`)}
            ${cell('name', `<div class="est-group-name"><button class="est-icon-btn" data-toggle-group="${esc(group.id)}"><i class="fas ${group.expanded === false ? 'fa-chevron-right' : 'fa-chevron-down'}"></i></button><i class="fas fa-folder"></i><span><strong>${esc(group.name)}</strong><small>${group.items.length} item(s)</small></span></div>`)}
            ${cell('description', '')}${cell('budgetCode', '')}${cell('costCode', '')}${cell('costCategory', '')}${cell('uom', '')}
            ${cell('quantity', number(group.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)), 'est-number')}
            ${cell('quantitySource', 'calculated')}${cell('unitMaterialCost', '')}${cell('waste', '')}
            ${cell('materialCost', money(totals.materialCost), 'est-money')}${cell('materialMargin', '')}${cell('unitMaterialSales', '')}
            ${cell('materialSales', money(totals.materialSales), 'est-money')}${cell('unitEquipmentCost', '')}${cell('equipmentQuantity', '')}
            ${cell('equipmentCost', money(totals.equipmentCost), 'est-money')}${cell('equipmentMargin', '')}${cell('equipmentSales', money(totals.equipmentSales), 'est-money')}
            ${cell('unitLabor', '')}${cell('laborUnitType', '')}${cell('laborRate', '')}${cell('difficulty', '')}
            ${cell('laborHours', number(totals.adjustedLaborHours), 'est-number')}${cell('laborCost', money(totals.laborCost), 'est-money')}${cell('laborMargin', '')}${cell('laborSales', money(totals.laborSales), 'est-money')}
            ${cell('totalCost', money(totals.totalCost), 'est-money')}${cell('totalSales', money(totals.totalSales), 'est-money')}${cell('profit', money(totals.profit), 'est-money')}${cell('marginPercent', `${number(totals.marginPercent)}%`, 'est-number')}
            ${cell('taxable', '')}${cell('notes', '')}${cell('catalogStatus', '')}${cell('takeoffStatus', '')}${cell('updatedAt', '')}
            <td class="est-actions-col"><button class="est-icon-btn" data-add-item="${esc(group.id)}"><i class="fas fa-plus"></i></button><button class="est-icon-btn" data-row-menu="group:${esc(group.id)}"><i class="fas fa-ellipsis-vertical"></i></button></td>
        </tr>`;
    }

    function cell(key, html, extra = '') {
        return `<td class="${colClass(key)} ${extra}">${html}</td>`;
    }

    function itemRow(group, item) {
        validateItem(item);
        const calc = Calc.calculateItem(item, activeSettings());
        const selected = state.selected.includes(item.id);
        const locked = activeEstimate().isLocked || item.locked;
        const readonly = locked ? 'disabled' : '';
        const error = item.validation.length ? `<i class="fas fa-triangle-exclamation est-error" title="${esc(item.validation.join(' '))}"></i>` : '';
        return `<tr class="est-row-item ${item.quantitySyncStatus === 'takeoff_changed' ? 'takeoff-changed' : ''}" data-item-id="${esc(item.id)}" data-group-id="${esc(group.id)}">
            ${cell('select', `<input type="checkbox" ${selected ? 'checked' : ''} data-select-item="${esc(item.id)}">`)}
            ${cell('name', `<div class="est-name-main">${error}<input class="est-cell-input" value="${esc(item.name)}" data-field="name" ${readonly}></div>`)}
            ${cell('description', `<input class="est-cell-input" value="${esc(item.description)}" data-field="description" ${readonly}>`)}
            ${cell('budgetCode', input(item, 'budgetCode', readonly))}
            ${cell('costCode', input(item, 'costCode', readonly))}
            ${cell('costCategory', select(item, 'costCategory', ['Materials', 'Labor', 'Equipment'], readonly))}
            ${cell('uom', input(item, 'uom', readonly))}
            ${cell('quantity', input(item, 'quantity', readonly, 'number'))}
            ${cell('quantitySource', `<span class="est-source">${esc(item.quantitySource)}</span>`)}
            ${cell('unitMaterialCost', input(item, 'unitMaterialCost', readonly, 'number'))}
            ${cell('waste', input(item, 'waste', readonly, 'number'))}
            ${cell('materialCost', money(calc.materialCost), 'est-money')}
            ${cell('materialMargin', input(item, 'materialMargin', readonly, 'number'))}
            ${cell('unitMaterialSales', money(calc.unitMaterialSales), 'est-money')}
            ${cell('materialSales', money(calc.materialSales), 'est-money')}
            ${cell('unitEquipmentCost', input(item, 'unitEquipmentCost', readonly, 'number'))}
            ${cell('equipmentQuantity', input(item, 'equipmentQuantity', readonly, 'number'))}
            ${cell('equipmentCost', money(calc.equipmentCost), 'est-money')}
            ${cell('equipmentMargin', input(item, 'equipmentMargin', readonly, 'number'))}
            ${cell('equipmentSales', money(calc.equipmentSales), 'est-money')}
            ${cell('unitLabor', input(item, 'unitLabor', readonly, 'number'))}
            ${cell('laborUnitType', select(item, 'laborUnitType', ['mins', 'hrs'], readonly))}
            ${cell('laborRate', input(item, 'laborRate', readonly, 'number'))}
            ${cell('difficulty', input(item, 'difficulty', readonly, 'number'))}
            ${cell('laborHours', number(calc.adjustedLaborHours), 'est-number')}
            ${cell('laborCost', money(calc.laborCost), 'est-money')}
            ${cell('laborMargin', input(item, 'laborMargin', readonly, 'number'))}
            ${cell('laborSales', money(calc.laborSales), 'est-money')}
            ${cell('totalCost', money(calc.totalCost), 'est-money')}
            ${cell('totalSales', money(calc.totalSales), 'est-money')}
            ${cell('profit', money(calc.profit), 'est-money')}
            ${cell('marginPercent', `${number(calc.marginPercent)}%`, 'est-number')}
            ${cell('taxable', `<button class="est-toggle ${item.taxable ? 'on' : ''}" data-toggle-tax ${readonly}>${item.taxable ? 'Yes' : 'No'}</button>`)}
            ${cell('notes', input(item, 'notes', readonly))}
            ${cell('catalogStatus', `<span class="est-status ${esc(item.catalogSyncStatus)}">${esc(item.catalogSyncStatus)}</span>`)}
            ${cell('takeoffStatus', statusPill(item))}
            ${cell('updatedAt', new Date(item.updatedAt).toLocaleDateString())}
            <td class="est-actions-col"><button class="est-icon-btn" data-row-menu="item:${esc(group.id)}:${esc(item.id)}"><i class="fas fa-ellipsis-vertical"></i></button></td>
        </tr>`;
    }

    function input(item, field, readonly = '', type = 'text') {
        return `<input class="est-cell-input ${type === 'number' ? 'number' : ''}" type="${type}" step="0.01" value="${esc(item[field] ?? '')}" data-field="${field}" ${readonly}>`;
    }

    function select(item, field, values, readonly = '') {
        return `<select class="est-cell-select" data-field="${field}" ${readonly}>${values.map(value => `<option ${String(item[field]) === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select>`;
    }

    function renderTableSettings() {
        const query = state.columnSearch || '';
        const filtered = columns.filter(([, label]) => !query || label.toLowerCase().includes(query.toLowerCase()));
        return `<div class="est-table-settings">
            <div class="est-settings-head"><strong>Table Settings</strong><input type="search" data-column-search value="${esc(query)}" placeholder="Search columns"></div>
            <div class="est-settings-actions"><button data-est-action="columns-all">Select All</button><button data-est-action="columns-clear">Clear All</button><button data-est-action="columns-reset">Reset to Default</button><button data-est-action="columns-save">Save as User Preference</button></div>
            <div class="est-column-grid">${filtered.map(([key, label]) => `<label><input type="checkbox" data-column-toggle="${esc(key)}" ${state.hiddenColumns.includes(key) ? '' : 'checked'}> ${esc(label || 'Select')}</label>`).join('')}</div>
        </div>`;
    }

    function renderRightPanel(summary) {
        return `<div class="est-right-scroll">
            <section class="est-card ${state.notesCollapsed ? 'collapsed' : ''}">
                <button class="est-card-header" data-collapse-card="notesCollapsed"><span><i class="fas fa-chevron-down"></i> Notes</span><small>Autosaved · Current user</small></button>
                <div class="est-card-body">
                    <label class="est-field-block"><span>Scope of Work</span><div class="est-editor-toolbar"><button data-editor-cmd="bold"><i class="fas fa-bold"></i></button><button data-editor-cmd="italic"><i class="fas fa-italic"></i></button><button data-editor-cmd="insertUnorderedList"><i class="fas fa-list-ul"></i></button></div><div class="est-rich-editor" contenteditable="true" data-note-field="scope">${activeEstimate().notes.scope || ''}</div></label>
                    ${noteList('included', 'Included')}
                    ${noteList('excluded', 'Excluded')}
                    <label class="est-field-block"><span>Project Notes</span><div class="est-rich-editor" contenteditable="true" data-note-field="projectNotes">${activeEstimate().notes.projectNotes || ''}</div></label>
                </div>
            </section>
            <section class="est-card ${state.summaryCollapsed ? 'collapsed' : ''}">
                <button class="est-card-header" data-collapse-card="summaryCollapsed"><span><i class="fas fa-chevron-down"></i> Summary</span><small>${activeSettings().marginMode}</small></button>
                <div class="est-card-body">
                    <div class="est-rate-grid"><label>Global labor cost <input data-setting="globalLaborCost" type="number" step="0.01" value="${activeSettings().globalLaborCost}"></label><label>Global labor sales rate <input data-setting="globalLaborSales" type="number" step="0.01" value="${activeSettings().globalLaborSales}"></label><label>Margin mode <select data-setting="marginMode"><option ${activeSettings().marginMode === 'margin' ? 'selected' : ''}>margin</option><option ${activeSettings().marginMode === 'markup' ? 'selected' : ''}>markup</option></select></label></div>
                    ${summaryTable(summary)}
                    ${markupEditor('preTaxMarkups', 'Pre-Tax Markups', summary.preTaxMarkups)}
                    ${taxEditor(summary)}
                    ${markupEditor('postTaxMarkups', 'Post-Tax Markups', summary.postTaxMarkups)}
                </div>
            </section>
            <section class="est-card"><button class="est-card-header"><span><i class="fas fa-clock"></i> Audit</span></button><div class="est-card-body est-audit-list">${activeEstimate().auditLog.slice(0, 8).map(log => `<div><strong>${esc(log.action)}</strong><span>${new Date(log.at).toLocaleString()}</span></div>`).join('') || '<span class="est-muted">No audit events yet.</span>'}</div></section>
        </div>
        <div class="est-total-box"><span>Estimate Total</span><strong>${money(summary.estimateTotal)}</strong><small>Cost ${money(summary.direct.totalCost)} · Profit ${money(summary.profit)} · Margin ${number(summary.marginPercent)}%</small><small>Labor ${number(summary.direct.adjustedLaborHours)} hrs · Tax ${money(summary.totalTax)} · Markups ${money(summary.totalMarkups)}</small><small>${squareFootage > 0 ? `${money(summary.direct.totalCost / squareFootage)} cost/sq ft · ${money(summary.estimateTotal / squareFootage)} sales/sq ft` : 'No project square footage configured'}</small></div>`;
    }

    function noteList(key, label) {
        return `<div class="est-field-block"><div class="est-list-head"><span>${label}</span><button class="est-small-btn" data-note-add="${key}"><i class="fas fa-plus"></i></button></div>${activeEstimate().notes[key].map((value, index) => `<div class="est-note-row"><input class="est-note-input" value="${esc(value)}" data-note-list="${key}" data-note-index="${index}"><button class="est-icon-btn danger" data-note-remove="${key}:${index}"><i class="fas fa-times"></i></button></div>`).join('')}</div>`;
    }

    function summaryTable(summary) {
        const rows = [['Materials', summary.byCategory.Materials], ['Labor', summary.byCategory.Labor], ['Equipment', summary.byCategory.Equipment], ['Totals', summary.direct]];
        return `<div class="est-summary-table-wrap"><table class="est-summary-table"><thead><tr><th>Type</th><th>Labor</th><th>Cost</th><th>Sales</th><th>Profit</th><th>Margin</th></tr></thead><tbody>${rows.map(([label, row]) => `<tr class="${label === 'Totals' ? 'est-summary-total' : ''}"><td>${label}</td><td>${number(row.adjustedLaborHours)}</td><td>${money(row.totalCost)}</td><td>${money(row.totalSales)}</td><td>${money(row.profit)}</td><td>${number(row.marginPercent)}%</td></tr>`).join('')}</tbody></table></div>`;
    }

    function markupEditor(key, title, rows) {
        return `<div class="est-summary-section"><div class="est-summary-title"><span>${title}</span><button data-markup-add="${key}"><i class="fas fa-plus"></i></button></div><div class="est-markup-list">${rows.map(row => `<div class="est-markup-row"><input value="${esc(row.name)}" data-markup-field="${key}:${row.id}:name"><select data-markup-field="${key}:${row.id}:type"><option ${row.type === 'percentage' ? 'selected' : ''}>percentage</option><option ${row.type === 'fixed_amount' ? 'selected' : ''}>fixed_amount</option></select><input type="number" step="0.01" value="${esc(row.percent ?? row.amount ?? 0)}" data-markup-field="${key}:${row.id}:percent"><select data-markup-field="${key}:${row.id}:base"><option ${row.base === 'subtotal_sales' ? 'selected' : ''}>subtotal_sales</option><option ${row.base === 'total_cost' ? 'selected' : ''}>total_cost</option><option ${row.base === 'material_cost' ? 'selected' : ''}>material_cost</option><option ${row.base === 'labor_cost' ? 'selected' : ''}>labor_cost</option><option ${row.base === 'equipment_cost' ? 'selected' : ''}>equipment_cost</option></select><strong>${money(row.value)}</strong><button class="est-icon-btn danger" data-markup-remove="${key}:${row.id}"><i class="fas fa-times"></i></button></div>`).join('')}</div></div>`;
    }

    function taxEditor(summary) {
        return `<div class="est-summary-section"><div class="est-summary-title"><span>Taxes</span></div><div class="est-markup-list">${['Materials', 'Labor', 'Equipment'].map(type => `<div class="est-markup-row"><span>${type}</span><input type="number" step="0.01" value="${activeSettings().taxes[type] || 0}" data-tax-rate="${type}"><strong>${money(summary.taxes[type])}</strong></div>`).join('')}</div></div>`;
    }

    function renderVersionBar(summary) {
        return `<footer class="est-version-bar"><span class="est-pill">${state.estimates.length} estimates</span>${state.estimates.map(est => `<button class="est-version-tab ${est.id === state.activeEstimateId ? 'active' : ''}" data-version="${esc(est.id)}"><span><strong>${esc(est.name)}</strong><small>${esc(est.status)} · ${est.groups.reduce((sum, group) => sum + group.items.length, 0)} items</small></span>${est.isLocked ? '<i class="fas fa-lock"></i>' : ''}</button>`).join('')}<button class="est-btn est-new-estimate" data-est-action="new-estimate"><i class="fas fa-plus"></i><span>New estimate</span></button><button class="est-btn" data-est-action="compare-estimates" ${state.estimates.length < 2 ? 'disabled' : ''}><i class="fas fa-code-compare"></i><span>Compare</span></button></footer>`;
    }

    function renderModals() {
        return `${state.catalogOpen ? catalogModal() : ''}${state.importOpen ? importModal() : ''}${state.reviewOpen ? reviewModal() : ''}${state.compareOpen ? compareModal() : ''}${state.copyEstimateOpen ? copyEstimateModal() : ''}`;
    }

    function copyEstimateModal() {
        const current = activeEstimate();
        return `<div class="est-modal-backdrop" data-copy-estimate-backdrop>
            <section class="est-copy-modal" role="dialog" aria-modal="true" aria-labelledby="copyEstimateTitle">
                <header>
                    <div><strong id="copyEstimateTitle">Create estimate</strong><span>Each estimate is an independent workspace.</span></div>
                    <button class="est-icon-btn" data-est-action="close-copy-estimate" aria-label="Close"><i class="fas fa-times"></i></button>
                </header>
                <div class="est-copy-body">
                    <label class="est-copy-name"><span>Estimate name</span><input id="copyEstimateName" value="${esc(`${current.name} Copy`)}" autocomplete="off"></label>
                    <fieldset>
                        <legend>What should be copied?</legend>
                        <label class="est-copy-option">
                            <input type="radio" name="copyEstimateMode" value="all" checked>
                            <span><strong>Complete estimate</strong><small>Copies every layer, item, price, note and estimate setting.</small></span>
                        </label>
                        <label class="est-copy-option">
                            <input type="radio" name="copyEstimateMode" value="structure">
                            <span><strong>Layers only</strong><small>Copies group/layer structure without cost items.</small></span>
                        </label>
                        <label class="est-copy-option">
                            <input type="radio" name="copyEstimateMode" value="blank">
                            <span><strong>Blank estimate</strong><small>Starts empty so new layers and items can be added independently.</small></span>
                        </label>
                    </fieldset>
                </div>
                <footer>
                    <button class="est-btn" data-est-action="close-copy-estimate">Cancel</button>
                    <button class="est-btn est-btn-primary" data-est-action="create-estimate-copy"><i class="fas fa-copy"></i>Create estimate</button>
                </footer>
            </section>
        </div>`;
    }

    function bindEvents() {
        root.querySelector('#estSearch')?.addEventListener('input', e => { state.search = e.target.value; render(); });
        root.querySelectorAll('[data-menu-toggle]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); root.querySelector(`#estMenu-${btn.dataset.menuToggle}`)?.classList.toggle('open'); }));
        root.querySelectorAll('[data-est-action]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); handleAction(btn.dataset.estAction); }));
        root.querySelector('[data-estimate-select]')?.addEventListener('change', e => { state.activeEstimateId = e.target.value; state.selected = []; render(); });
        root.querySelectorAll('[data-version]').forEach(btn => btn.addEventListener('click', () => { state.activeEstimateId = btn.dataset.version; state.selected = []; render(); }));
        root.querySelectorAll('[data-toggle-group]').forEach(btn => btn.addEventListener('click', () => { const group = activeEstimate().groups.find(g => g.id === btn.dataset.toggleGroup); if (group) group.expanded = group.expanded === false; markDirty(); render(); }));
        root.querySelectorAll('[data-add-item]').forEach(btn => btn.addEventListener('click', () => addManualItem(btn.dataset.addItem)));
        root.querySelectorAll('[data-select-item]').forEach(box => box.addEventListener('change', () => { state.selected = box.checked ? [...new Set([...state.selected, box.dataset.selectItem])] : state.selected.filter(row => row !== box.dataset.selectItem); render(); }));
        root.querySelectorAll('[data-select-group]').forEach(box => box.addEventListener('change', () => toggleGroupSelection(box.dataset.selectGroup, box.checked)));
        root.querySelectorAll('[data-field]').forEach(input => input.addEventListener('change', () => updateField(input)));
        root.querySelectorAll('[data-toggle-tax]').forEach(btn => btn.addEventListener('click', () => { const found = findItem(btn.closest('[data-item-id]')?.dataset.itemId); if (found) { found.item.taxable = !found.item.taxable; audit('Tax toggled', null, found.item, 'item'); markDirty(); render(); } }));
        root.querySelectorAll('[data-row-menu]').forEach(btn => btn.addEventListener('click', e => openRowMenu(e, btn.dataset.rowMenu)));
        root.querySelectorAll('[data-column-toggle]').forEach(box => box.addEventListener('change', () => { state.hiddenColumns = box.checked ? state.hiddenColumns.filter(col => col !== box.dataset.columnToggle) : [...new Set([...state.hiddenColumns, box.dataset.columnToggle])]; render(); }));
        root.querySelector('[data-column-search]')?.addEventListener('input', e => { state.columnSearch = e.target.value; render(); });
        root.querySelectorAll('[data-collapse-card]').forEach(btn => btn.addEventListener('click', () => { state[btn.dataset.collapseCard] = !state[btn.dataset.collapseCard]; render(); }));
        root.querySelectorAll('[data-note-field]').forEach(editor => editor.addEventListener('input', () => { activeEstimate().notes[editor.dataset.noteField] = editor.innerHTML; markDirty(); persist(); }));
        root.querySelectorAll('[data-note-list]').forEach(input => input.addEventListener('change', () => { activeEstimate().notes[input.dataset.noteList][Number(input.dataset.noteIndex)] = input.value; markDirty(); render(); }));
        root.querySelectorAll('[data-note-add]').forEach(btn => btn.addEventListener('click', () => { activeEstimate().notes[btn.dataset.noteAdd].push(''); markDirty(); render(); }));
        root.querySelectorAll('[data-note-remove]').forEach(btn => btn.addEventListener('click', () => { const [key, index] = btn.dataset.noteRemove.split(':'); activeEstimate().notes[key].splice(Number(index), 1); markDirty(); render(); }));
        root.querySelectorAll('[data-setting]').forEach(input => input.addEventListener('change', () => { activeSettings()[input.dataset.setting] = input.type === 'number' ? Number(input.value || 0) : input.value; markDirty(); render(); }));
        root.querySelectorAll('[data-tax-rate]').forEach(input => input.addEventListener('change', () => { activeSettings().taxes[input.dataset.taxRate] = Number(input.value || 0); markDirty(); render(); }));
        root.querySelectorAll('[data-markup-field]').forEach(input => input.addEventListener('change', () => updateMarkupField(input)));
        root.querySelectorAll('[data-markup-add]').forEach(btn => btn.addEventListener('click', () => { activeSettings()[btn.dataset.markupAdd].push({ id: id('mk'), name: 'Custom markup', type: 'percentage', percent: 0, base: 'subtotal_sales', active: true }); markDirty(); render(); }));
        root.querySelectorAll('[data-markup-remove]').forEach(btn => btn.addEventListener('click', () => { const [key, rowId] = btn.dataset.markupRemove.split(':'); activeSettings()[key] = activeSettings()[key].filter(row => row.id !== rowId); markDirty(); render(); }));
        root.querySelector('[data-copy-estimate-backdrop]')?.addEventListener('click', event => {
            if (event.target === event.currentTarget) {
                state.copyEstimateOpen = false;
                render();
            }
        });
        root.querySelector('#copyEstimateName')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') createEstimateCopy();
        });
        root.querySelectorAll('[data-editor-cmd]').forEach(btn => btn.addEventListener('click', () => document.execCommand(btn.dataset.editorCmd, false, null)));
        document.addEventListener('click', closeFloatingMenus, { once: true });
    }

    function closeFloatingMenus() {
        root.querySelectorAll('.est-menu').forEach(menu => menu.classList.remove('open'));
        root.querySelector('#estRowMenu')?.setAttribute('hidden', '');
    }

    function updateField(input) {
        const found = findItem(input.closest('[data-item-id]')?.dataset.itemId);
        if (!found || activeEstimate().isLocked || found.item.locked) return;
        const field = input.dataset.field;
        const before = { ...found.item };
        const numeric = ['quantity', 'unitMaterialCost', 'waste', 'materialMargin', 'unitEquipmentCost', 'equipmentQuantity', 'equipmentMargin', 'unitLabor', 'laborRate', 'difficulty', 'laborMargin'];
        found.item[field] = numeric.includes(field) ? Number(input.value || 0) : input.value;
        if (field === 'quantity' && found.item.quantitySource === 'takeoff') {
            found.item.quantityOverride = true;
            found.item.quantitySyncStatus = 'modified';
        }
        found.item.updatedAt = new Date().toISOString();
        audit('Item edited', before, found.item, 'item');
        markDirty();
        render();
    }

    function toggleGroupSelection(groupId, checked) {
        const group = activeEstimate().groups.find(row => row.id === groupId);
        if (!group) return;
        const ids = group.items.map(item => item.id);
        state.selected = checked ? [...new Set([...state.selected, ...ids])] : state.selected.filter(itemId => !ids.includes(itemId));
        render();
    }

    function handleAction(action) {
        const estimate = activeEstimate();
        if (action === 'save') {
            audit('Estimate saved', null, estimate, 'estimate');
            markDirty();
            render();
            persist({ forceServer: true, immediate: true });
            return;
        }
        if (action === 'create-group') return createGroup();
        if (action === 'create-item') return addManualItem(estimate.groups[0]?.id);
        if (action === 'delete-selected') return deleteSelected();
        if (action === 'columns') { state.tableSettingsOpen = !state.tableSettingsOpen; return render(); }
        if (action === 'columns-all') { state.hiddenColumns = []; return render(); }
        if (action === 'columns-clear') { state.hiddenColumns = columns.filter(([key]) => key !== 'name' && key !== 'select').map(([key]) => key); return render(); }
        if (action === 'columns-reset') { localStorage.removeItem(columnPrefKey); state.hiddenColumns = readColumnPreference(); return render(); }
        if (action === 'columns-save') { localStorage.setItem(columnPrefKey, JSON.stringify(state.hiddenColumns)); return toast('Column preference saved.'); }
        if (action === 'fullscreen') { state.fullscreen = !state.fullscreen; return render(); }
        if (action === 'add-catalog') return openCatalog();
        if (action === 'refresh-takeoff') return refreshTakeoffQuantities(true);
        if (action === 'refresh-catalog') return refreshCostsFromCatalog();
        if (action === 'recalculate') return render();
        if (action === 'duplicate-estimate' || action === 'new-estimate') { state.copyEstimateOpen = true; return render(); }
        if (action === 'close-copy-estimate') { state.copyEstimateOpen = false; return render(); }
        if (action === 'create-estimate-copy') return createEstimateCopy();
        if (action === 'rename-estimate') return renameEstimate();
        if (action === 'lock-estimate') { estimate.isLocked = true; audit('Estimate locked', false, true, 'estimate'); markDirty(); return render(); }
        if (action === 'unlock-estimate') { estimate.isLocked = false; audit('Estimate unlocked', true, false, 'estimate'); markDirty(); return render(); }
        if (action === 'delete-estimate') return deleteEstimate();
        if (action === 'show-proposal') return showProposal();
        if (action === 'compare-estimates') { state.compareOpen = true; return render(); }
        if (action === 'review-takeoff') { state.reviewOpen = true; return render(); }
        if (action === 'sync-all') return syncAllPendingTakeoff();
        if (action === 'ignore-takeoff') return ignorePendingTakeoff();
        if (action === 'import-bom' || action === 'validate-import') { state.importOpen = true; return render(); }
        if (action === 'download-template') return downloadTemplate();
        if (action === 'export-estimate') return exportTable('estimate');
        if (action === 'export-bom') return exportTable('bom');
        if (action === 'export-summary') return exportSummary();
        if (action === 'export-proposal') return showProposal();
    }

    function createGroup() {
        const name = prompt('Group name', 'New Group');
        if (!name) return;
        activeEstimate().groups.push({ id: id('grp'), name, parentId: null, expanded: true, sortOrder: activeEstimate().groups.length, items: [] });
        audit('Group created', null, name, 'group');
        markDirty();
        render();
    }

    function addManualItem(groupId, data = {}) {
        const group = activeEstimate().groups.find(row => row.id === groupId) || activeEstimate().groups[0] || { id: id('grp'), name: 'Default Group', expanded: true, sortOrder: 0, items: [] };
        if (!activeEstimate().groups.includes(group)) activeEstimate().groups.push(group);
        group.items.push(normalizeItem({ id: id('item'), name: 'New cost item', quantity: 1, quantitySource: 'manual', quantitySyncStatus: 'manual', catalogSyncStatus: 'detached', ...data }));
        group.expanded = true;
        audit('Item created', null, data, 'item');
        markDirty();
        render();
    }

    function deleteSelected() {
        if (!state.selected.length || !confirm(`Delete ${state.selected.length} selected item(s)?`)) return;
        activeEstimate().groups.forEach(group => { group.items = group.items.filter(item => !state.selected.includes(item.id)); });
        audit('Item deleted', state.selected, null, 'item');
        state.selected = [];
        markDirty();
        render();
    }

    function createEstimateCopy() {
        const current = activeEstimate();
        const nameInput = root.querySelector('#copyEstimateName');
        const modeInput = root.querySelector('input[name="copyEstimateMode"]:checked');
        const name = String(nameInput?.value || '').trim();
        const mode = modeInput?.value || 'all';
        if (!name) {
            nameInput?.focus();
            return toast('Enter an estimate name.');
        }
        const copy = mode === 'blank'
            ? defaultEstimate(name)
            : JSON.parse(JSON.stringify(current));
        copy.id = id('est');
        copy.name = name;
        copy.status = 'draft';
        copy.isLocked = false;
        copy.createdAt = new Date().toISOString();
        copy.updatedAt = copy.createdAt;
        copy.auditLog = [];
        if (mode === 'blank') copy.groups = [];
        else {
            const groupIds = new Map();
            const itemIds = new Map();
            copy.groups.forEach(group => {
                const oldId = group.id;
                group.id = id('grp');
                groupIds.set(oldId, group.id);
                if (mode === 'structure') group.items = [];
                else group.items.forEach(item => {
                    const oldItemId = item.id;
                    item.id = id('item');
                    itemIds.set(oldItemId, item.id);
                });
            });
            copy.groups.forEach(group => {
                group.parentId = group.parentId ? groupIds.get(group.parentId) || null : null;
                group.items.forEach(item => {
                    item.parentId = item.parentId ? itemIds.get(item.parentId) || null : null;
                });
            });
        }
        copy.auditLog.unshift({
            id: id('audit'),
            user: 'Current user',
            at: new Date().toISOString(),
            action: mode === 'all' ? 'Estimate copied with all items' : (mode === 'structure' ? 'Estimate copied with layers only' : 'Blank estimate created'),
            entity: 'estimate',
            before: current.id,
            after: copy.id
        });
        state.estimates.push(copy);
        state.activeEstimateId = copy.id;
        state.selected = [];
        state.copyEstimateOpen = false;
        markDirty();
        persist();
        render();
    }

    function renameEstimate() {
        const name = prompt('Estimate name', activeEstimate().name);
        if (!name) return;
        audit('Estimate renamed', activeEstimate().name, name, 'estimate');
        activeEstimate().name = name;
        markDirty();
        render();
    }

    function deleteEstimate() {
        if (state.estimates.length <= 1 || !confirm('Delete this estimate?')) return;
        const old = activeEstimate();
        state.estimates = state.estimates.filter(est => est.id !== old.id);
        state.activeEstimateId = state.estimates[0].id;
        audit('Estimate deleted', old.id, null, 'estimate');
        markDirty();
        render();
    }

    function showProposal() {
        persist();
        if (typeof window.setActiveTab === 'function') window.setActiveTab('proposal');
        else document.querySelector('[data-tab="proposal"]')?.click();
    }

    function updateMarkupField(input) {
        const [key, rowId, field] = input.dataset.markupField.split(':');
        const row = activeSettings()[key].find(item => item.id === rowId);
        if (!row) return;
        row[field] = field === 'percent' ? Number(input.value || 0) : input.value;
        markDirty();
        render();
    }

    function openRowMenu(event, token) {
        event.stopPropagation();
        const menu = root.querySelector('#estRowMenu');
        if (!menu) return;
        const [type, groupId, itemId] = token.split(':');
        menu.innerHTML = type === 'group' ? groupMenu(groupId) : itemMenu(groupId, itemId);
        menu.hidden = false;
        const rect = event.currentTarget.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        menu.style.left = `${Math.min(rect.left - rootRect.left, rootRect.width - 260)}px`;
        menu.style.top = `${rect.bottom - rootRect.top + 6}px`;
        menu.querySelectorAll('[data-row-action]').forEach(btn => btn.addEventListener('click', () => runRowAction(btn.dataset.rowAction, groupId, itemId)));
    }

    function groupMenu() {
        return ['Create Item', 'Rename', 'Copy', 'Move To', 'Delete'].map(label => `<button data-row-action="${label.toLowerCase().replaceAll(' ', '-')}">${label}</button>`).join('');
    }

    function itemMenu() {
        return ['Edit Item', 'Replace Item', 'Copy Item', 'Duplicate Item', 'Move To', 'Reset Quantity from Takeoff', 'Refresh Cost from Catalog', 'Detach from Takeoff', 'Link to Takeoff', 'Reset Budget Code', 'Convert to Manual Item', 'Open Catalog Item', 'Open Related Takeoff', 'Add Note', 'Lock Item', 'Delete Item'].map(label => `<button data-row-action="${label.toLowerCase().replaceAll(' ', '-')}">${label}</button>`).join('');
    }

    function runRowAction(action, groupId, itemId) {
        const group = activeEstimate().groups.find(row => row.id === groupId);
        const item = group?.items.find(row => row.id === itemId);
        if (action === 'create-item') return addManualItem(groupId);
        if (action === 'rename' && group) { const name = prompt('Group name', group.name); if (name) group.name = name; }
        if (action === 'copy' && group) activeEstimate().groups.push({ ...JSON.parse(JSON.stringify(group)), id: id('grp'), name: `${group.name} Copy` });
        if (action === 'delete' && group && !item && confirm('Delete this group and its items?')) activeEstimate().groups = activeEstimate().groups.filter(row => row.id !== group.id);
        if (!item) { markDirty(); return render(); }
        if (action === 'duplicate-item' || action === 'copy-item') group.items.push({ ...JSON.parse(JSON.stringify(item)), id: id('item'), name: `${item.name} Copy` });
        if (action === 'delete-item' && confirm('Delete this item?')) group.items = group.items.filter(row => row.id !== item.id);
        if (action === 'reset-quantity-from-takeoff') resetItemFromTakeoff(item);
        if (action === 'refresh-cost-from-catalog') refreshItemCost(item);
        if (action === 'detach-from-takeoff') { item.quantitySource = 'manual'; item.quantitySyncStatus = 'detached'; item.takeoffLayerId = null; }
        if (action === 'convert-to-manual-item') { item.quantitySource = 'manual'; item.quantitySyncStatus = 'manual'; item.quantityOverride = true; }
        if (action === 'lock-item') item.locked = !item.locked;
        if (action === 'add-note') item.notes = prompt('Note', item.notes || '') || item.notes;
        if (action === 'replace-item') { state.catalogOpen = true; state.replaceItemId = item.id; return render(); }
        if (action === 'move-to') moveItemToGroup(group, item);
        if (action === 'open-related-takeoff') document.querySelector('[data-tab="takeoff"]')?.click();
        if (action === 'open-catalog-item') window.open('/pages/cost_catalog.php', '_blank', 'noopener');
        audit(action, null, item, 'item');
        markDirty();
        render();
    }

    function moveItemToGroup(group, item) {
        const name = prompt('Move to group', activeEstimate().groups.map(row => row.name).join(', '));
        const target = activeEstimate().groups.find(row => row.name.toLowerCase() === String(name || '').toLowerCase());
        if (!target || target === group) return;
        group.items = group.items.filter(row => row.id !== item.id);
        target.items.push(item);
    }

    function resetItemFromTakeoff(item) {
        if (!item.takeoffLayerId) return toast('This item is not linked to Takeoff.');
        const qty = findTakeoffQuantity(item.takeoffLayerId);
        if (qty == null) {
            item.quantitySyncStatus = 'missing_takeoff';
            return toast('The linked Takeoff no longer exists.');
        }
        item.quantity = qty;
        item.quantityOverride = false;
        item.lastSyncedTakeoffQuantity = qty;
        item.pendingTakeoffQuantity = null;
        item.quantitySyncStatus = 'synced';
        item.updatedAt = new Date().toISOString();
        audit('Quantity reset from Takeoff', null, qty, 'item');
    }

    function findTakeoffQuantity(layerId) {
        try {
            const takeoff = JSON.parse(localStorage.getItem(takeoffKey) || 'null');
            const layer = (takeoff?.groups || []).flatMap(group => group.layers || []).find(row => String(row.id) === String(layerId));
            return layer ? Number(layer.quantity || 0) : null;
        } catch (e) {
            return null;
        }
    }

    function refreshTakeoffQuantities(forceReview = false) {
        try {
            const takeoff = JSON.parse(localStorage.getItem(takeoffKey) || 'null');
            const layers = (takeoff?.groups || []).flatMap(group => (group.layers || []).map(layer => ({ ...layer, groupName: group.name })));
            mergeTakeoffLayers(layers, forceReview);
            toast('Takeoff quantities refreshed.');
        } catch (e) {
            toast('No Takeoff data found.');
        }
        markDirty();
        render();
    }

    function mergeTakeoffLayers(layers, forceReview = false) {
        const seen = new Set();
        layers.forEach(layer => {
            seen.add(String(layer.id));
            const qty = Number(layer.quantity || 0);
            let found = allItems().find(item => String(item.takeoffLayerId || '') === String(layer.id));
            if (!found) {
                const groupName = layer.catalogItemId || layer.catalog_item_id ? (layer.groupName || 'Default Group') : 'Default Group';
                let group = activeEstimate().groups.find(row => row.name === groupName);
                if (!group) {
                    group = { id: id('grp'), name: groupName, expanded: true, sortOrder: activeEstimate().groups.length, items: [] };
                    activeEstimate().groups.push(group);
                }
                group.items.push(normalizeItem({
                    id: `takeoff_${layer.id}`,
                    name: layer.name,
                    description: layer.description,
                    quantity: qty,
                    uom: layer.uom || layer.unit_of_measure,
                    takeoffLayerId: layer.id,
                    catalogItemId: layer.catalogItemId || layer.catalog_item_id,
                    unitMaterialCost: layer.unitCost || layer.unit_cost,
                    unitLabor: layer.laborHours || layer.labor_hours,
                    quantitySource: 'takeoff',
                    quantitySyncStatus: 'synced',
                    lastSyncedTakeoffQuantity: qty,
                    catalogSyncStatus: layer.catalogItemId || layer.catalog_item_id ? 'synced' : 'detached'
                }));
                return;
            }
            const target = findItem(found.id)?.item;
            if (!target) return;
            if (forceReview || target.quantityOverride || target.quantitySyncStatus === 'modified') {
                if (Number(target.quantity) !== qty) {
                    target.pendingTakeoffQuantity = qty;
                    target.quantitySyncStatus = 'takeoff_changed';
                }
                return;
            }
            target.quantity = qty;
            target.lastSyncedTakeoffQuantity = qty;
            target.quantitySyncStatus = 'synced';
            target.updatedAt = new Date().toISOString();
        });
        allItems().filter(item => item.takeoffLayerId && !seen.has(String(item.takeoffLayerId))).forEach(item => {
            const target = findItem(item.id)?.item;
            if (target) target.quantitySyncStatus = 'missing_takeoff';
        });
    }

    function syncAllPendingTakeoff() {
        allItems().filter(item => item.quantitySyncStatus === 'takeoff_changed').forEach(item => {
            const target = findItem(item.id)?.item;
            if (!target) return;
            target.quantity = Number(target.pendingTakeoffQuantity || target.quantity);
            target.lastSyncedTakeoffQuantity = target.quantity;
            target.pendingTakeoffQuantity = null;
            target.quantityOverride = false;
            target.quantitySyncStatus = 'synced';
        });
        audit('Takeoff quantities synced', null, null, 'estimate');
        markDirty();
        render();
    }

    function ignorePendingTakeoff() {
        allItems().filter(item => item.quantitySyncStatus === 'takeoff_changed').forEach(item => {
            const target = findItem(item.id)?.item;
            if (target) target.quantitySyncStatus = 'modified';
        });
        markDirty();
        render();
    }

    async function ensureCatalogLoaded() {
        if (state.catalogLoaded) return;
        try {
            const response = await fetch('../api/cost_catalog.php?action=list&view=all', { headers: { Accept: 'application/json' } });
            const json = await response.json();
            state.catalogItems = json.data?.allItems || json.data?.items || [];
            state.assemblyParts = json.data?.assemblyParts || json.data?.assembly_parts || [];
            state.catalogLoaded = true;
        } catch (e) {
            state.catalogError = 'Unable to load Cost Catalog.';
        }
    }

    async function openCatalog() {
        state.catalogOpen = true;
        render();
        await ensureCatalogLoaded();
        render();
    }

    function catalogModal() {
        const q = state.catalogQuery || '';
        const items = (state.catalogItems || []).filter(item => !q || [item.name, item.description, item.sku, item.catalog_number, item.cost_code, item.group_name, item.item_type, item.unit_of_measure].join(' ').toLowerCase().includes(q.toLowerCase())).slice(0, 120);
        return `<div class="est-modal-backdrop"><div class="est-catalog-modal"><header><strong>Select Catalog Item</strong><button class="est-icon-btn" data-modal-close="catalogOpen"><i class="fas fa-times"></i></button></header><div class="est-catalog-filters"><input type="search" value="${esc(q)}" data-catalog-query placeholder="Search by name, SKU, code, description, tags"><button class="est-btn" data-est-action="catalog-add-selected">Add selected</button><a class="est-btn" href="/pages/cost_catalog.php" target="_blank">Open detail</a></div><div class="est-catalog-list">${state.catalogError ? esc(state.catalogError) : items.map(item => `<label class="est-catalog-row"><input type="checkbox" data-catalog-select="${esc(item.id)}"><span><strong>${esc(item.name)}</strong><small>${esc(item.description || item.group_name || '')}</small></span><span>${esc(item.unit_of_measure || 'ea')}</span><span>${money(item.unit_cost)}</span><span>${Number(item.labor_hours || 0).toFixed(4)}</span><span>${esc(item.catalog_number || item.sku || item.cost_code || '')}</span><span>${esc(item.item_type || 'material')}</span></label>`).join('') || '<div class="est-empty">No catalog items found.</div>'}</div></div></div>`;
    }

    function addCatalogItem(item) {
        const target = state.replaceItemId ? findItem(state.replaceItemId)?.item : null;
        const payload = normalizeItem({
            name: item.name,
            description: item.description,
            catalogItemId: item.id,
            costCode: item.cost_code,
            budgetCode: item.cost_code,
            costCategory: normalizeType(item.item_type),
            uom: item.unit_of_measure,
            unitMaterialCost: item.unit_cost,
            unitLabor: item.labor_hours,
            itemType: item.item_type,
            quantity: target?.quantity || 1,
            quantitySource: target?.quantitySource || 'manual',
            takeoffLayerId: target?.takeoffLayerId || null,
            catalogSnapshot: { ...item },
            catalogSyncStatus: 'synced'
        });
        if (target) Object.assign(target, payload, { id: target.id });
        else addManualItem(activeEstimate().groups[0]?.id, payload);
    }

    async function refreshCostsFromCatalog() {
        await ensureCatalogLoaded();
        allItems().forEach(item => refreshItemCost(findItem(item.id)?.item));
        audit('Costs refreshed from catalog', null, null, 'estimate');
        markDirty();
        render();
    }

    function refreshItemCost(item) {
        if (!item || !item.catalogItemId) return;
        const catalog = (state.catalogItems || []).find(row => String(row.id) === String(item.catalogItemId));
        if (!catalog) {
            item.catalogSyncStatus = 'catalog_item_missing';
            return;
        }
        item.unitMaterialCost = Number(catalog.unit_cost || 0);
        item.unitLabor = Number(catalog.labor_hours || 0);
        item.description = catalog.description || item.description;
        item.costCode = catalog.cost_code || item.costCode;
        item.costCategory = normalizeType(catalog.item_type || item.costCategory);
        item.uom = catalog.unit_of_measure || item.uom;
        item.catalogSnapshot = { ...catalog };
        item.catalogLastSyncedAt = new Date().toISOString();
        item.catalogSyncStatus = 'synced';
    }

    function importModal() {
        const preview = state.importPreview;
        return `<div class="est-modal-backdrop"><div class="est-import-modal"><header><strong>Import Bill of Materials</strong><button class="est-icon-btn" data-modal-close="importOpen"><i class="fas fa-times"></i></button></header><div class="est-card-body"><input type="file" accept=".csv,.txt" data-import-file><p class="est-muted">CSV columns: name,description,uom,quantity,unitMaterialCost,unitLabor,costCode,costCategory</p>${preview ? `<div class="est-import-preview"><strong>${preview.valid.length} valid · ${preview.invalid.length} invalid</strong><button class="est-btn est-btn-primary" data-est-action="commit-import">Import valid rows</button><table>${preview.valid.slice(0, 20).map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.quantity)}</td><td>${esc(row.unitMaterialCost)}</td></tr>`).join('')}</table></div>` : ''}</div></div></div>`;
    }

    function reviewModal() {
        const rows = allItems().filter(item => item.quantitySyncStatus === 'takeoff_changed');
        return `<div class="est-modal-backdrop"><div class="est-review-modal"><header><strong>Review Takeoff Changes</strong><button class="est-icon-btn" data-modal-close="reviewOpen"><i class="fas fa-times"></i></button></header><table class="est-review-table"><thead><tr><th>Item</th><th>Previous</th><th>New Takeoff</th><th>Diff</th><th>Cost Impact</th><th>Sales Impact</th><th></th></tr></thead><tbody>${rows.map(item => {
            const current = Calc.calculateItem(item, activeSettings());
            const next = Calc.calculateItem({ ...item, quantity: item.pendingTakeoffQuantity }, activeSettings());
            return `<tr><td>${esc(item.name)}</td><td>${number(item.quantity)}</td><td>${number(item.pendingTakeoffQuantity)}</td><td>${number(Number(item.pendingTakeoffQuantity || 0) - Number(item.quantity || 0))}</td><td>${money(next.totalCost - current.totalCost)}</td><td>${money(next.totalSales - current.totalSales)}</td><td><button data-sync-one="${esc(item.id)}">Sync</button></td></tr>`;
        }).join('')}</tbody></table><footer><button class="est-btn est-btn-primary" data-est-action="sync-all">Sync All</button></footer></div></div>`;
    }

    function compareModal() {
        const current = activeEstimate();
        const other = state.estimates.find(est => est.id !== current.id);
        const currentSummary = Calc.calculateSummary(current.groups, current.settings);
        const otherSummary = other ? Calc.calculateSummary(other.groups, other.settings) : null;
        return `<div class="est-modal-backdrop"><div class="est-review-modal"><header><strong>Compare Estimates</strong><button class="est-icon-btn" data-modal-close="compareOpen"><i class="fas fa-times"></i></button></header>${otherSummary ? `<div class="est-compare-grid"><div><strong>${esc(current.name)}</strong><span>${money(currentSummary.estimateTotal)}</span></div><div><strong>${esc(other.name)}</strong><span>${money(otherSummary.estimateTotal)}</span></div><div><strong>Difference</strong><span>${money(currentSummary.estimateTotal - otherSummary.estimateTotal)}</span></div></div>` : '<div class="est-empty">Create another estimate to compare.</div>'}</div></div>`;
    }

    function downloadTemplate() {
        downloadBlob('estimate-import-template.csv', 'name,description,uom,quantity,unitMaterialCost,unitLabor,costCode,costCategory\n');
    }

    function exportTable(kind) {
        const rows = allItems();
        const header = columns.filter(([key]) => key !== 'select').map(([, label]) => label);
        const html = `<table><thead><tr>${header.map(label => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(item => {
            const calc = Calc.calculateItem(item, activeSettings());
            return `<tr><td>${esc(item.name)}</td><td>${esc(item.description)}</td><td>${esc(item.budgetCode)}</td><td>${esc(item.costCode)}</td><td>${esc(item.costCategory)}</td><td>${esc(item.uom)}</td><td>${item.quantity}</td><td>${esc(item.quantitySource)}</td><td>${item.unitMaterialCost}</td><td>${item.waste}</td><td>${calc.materialCost}</td><td>${item.materialMargin}</td><td>${calc.unitMaterialSales}</td><td>${calc.materialSales}</td><td>${item.unitEquipmentCost}</td><td>${item.equipmentQuantity}</td><td>${calc.equipmentCost}</td><td>${item.equipmentMargin}</td><td>${calc.equipmentSales}</td><td>${item.unitLabor}</td><td>${esc(item.laborUnitType)}</td><td>${item.laborRate}</td><td>${item.difficulty}</td><td>${calc.adjustedLaborHours}</td><td>${calc.laborCost}</td><td>${item.laborMargin}</td><td>${calc.laborSales}</td><td>${calc.totalCost}</td><td>${calc.totalSales}</td><td>${calc.profit}</td><td>${calc.marginPercent}</td><td>${item.taxable ? 'Yes' : 'No'}</td><td>${esc(item.notes)}</td><td>${esc(item.catalogSyncStatus)}</td><td>${esc(item.quantitySyncStatus)}</td><td>${esc(item.updatedAt)}</td></tr>`;
        }).join('')}</tbody></table>`;
        downloadBlob(`${kind}-${Date.now()}.xls`, html, 'application/vnd.ms-excel;charset=utf-8');
        audit('Estimate exported', null, kind, 'estimate');
    }

    function exportSummary() {
        const summary = Calc.calculateSummary(activeEstimate().groups, activeSettings());
        downloadBlob(`estimate-summary-${Date.now()}.csv`, `Metric,Value\nEstimate Total,${summary.estimateTotal}\nTotal Cost,${summary.direct.totalCost}\nProfit,${summary.profit}\nTax,${summary.totalTax}\nMarkups,${summary.totalMarkups}\nLabor Hours,${summary.direct.adjustedLaborHours}\n`);
    }

    function downloadBlob(filename, content, type = 'text/csv;charset=utf-8') {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function toast(message) {
        document.querySelector('.toast-lite')?.remove();
        const node = document.createElement('div');
        node.className = 'toast-lite';
        node.textContent = message;
        document.body.appendChild(node);
        setTimeout(() => node.remove(), 2400);
    }

    root.addEventListener('input', event => {
        if (event.target.matches('[data-catalog-query]')) {
            state.catalogQuery = event.target.value;
            render();
        }
    });

    root.addEventListener('change', event => {
        if (event.target.matches('[data-import-file]')) {
            const file = event.target.files?.[0];
            if (!file) return;
            file.text().then(text => {
                const lines = text.split(/\r?\n/).filter(Boolean);
                const headers = lines.shift().split(',').map(h => h.trim());
                const valid = [];
                const invalid = [];
                lines.forEach(line => {
                    const cells = line.split(',');
                    const row = Object.fromEntries(headers.map((h, i) => [h, cells[i] || '']));
                    if (!row.name || Number(row.quantity || 0) < 0) invalid.push(row);
                    else valid.push(row);
                });
                state.importPreview = { valid, invalid };
                render();
            });
        }
    });

    root.addEventListener('click', event => {
        const close = event.target.closest('[data-modal-close]');
        if (close) {
            state[close.dataset.modalClose] = false;
            state.replaceItemId = null;
            render();
            return;
        }
        if (event.target.closest('[data-est-action="catalog-add-selected"]')) {
            root.querySelectorAll('[data-catalog-select]:checked').forEach(box => {
                const item = state.catalogItems.find(row => String(row.id) === String(box.dataset.catalogSelect));
                if (item) addCatalogItem(item);
            });
            state.catalogOpen = false;
            state.replaceItemId = null;
            markDirty();
            render();
            return;
        }
        if (event.target.closest('[data-est-action="commit-import"]')) {
            (state.importPreview?.valid || []).forEach(row => addManualItem(activeEstimate().groups[0]?.id, { ...row, quantitySource: 'imported', catalogSyncStatus: 'detached' }));
            state.importOpen = false;
            state.importPreview = null;
            markDirty();
            render();
            return;
        }
        const syncOne = event.target.closest('[data-sync-one]');
        if (syncOne) {
            const item = findItem(syncOne.dataset.syncOne)?.item;
            if (item) {
                item.quantity = Number(item.pendingTakeoffQuantity || item.quantity);
                item.lastSyncedTakeoffQuantity = item.quantity;
                item.pendingTakeoffQuantity = null;
                item.quantityOverride = false;
                item.quantitySyncStatus = 'synced';
            }
            markDirty();
            render();
        }
    });

    window.addEventListener('takeoff:estimating-lines-updated', () => {
        try {
            const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null');
            const linked = (parsed?.groups || []).flatMap(group => (group.items || []).filter(item => item.takeoffLayerId));
            mergeTakeoffLayers(linked.map(item => ({
                id: item.takeoffLayerId,
                name: item.name,
                description: item.description,
                quantity: item.quantity,
                uom: item.uom,
                groupName: item.groupName,
                catalogItemId: item.catalogItemId,
                unitCost: item.unitCost,
                laborHours: item.unitLabor
            })), false);
            markDirty();
            render();
        } catch (e) {
            console.warn('Unable to refresh estimating from Takeoff', e);
        }
    });

    render();
    loadServerState();
})();
