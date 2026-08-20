(function (global) {
    'use strict';

    const now = () => new Date().toISOString();
    const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const text = (value, fallback = '') => value === null || value === undefined ? fallback : String(value);
    const clone = value => JSON.parse(JSON.stringify(value));

    function projectId(value) {
        const parsed = Number(typeof value === 'string' ? value.trim() : value);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
    }

    function settings(input = {}) {
        return {
            marginMode: input.marginMode === 'markup' ? 'markup' : 'margin',
            globalLaborCost: numeric(input.globalLaborCost, 85),
            globalLaborSales: numeric(input.globalLaborSales, 110),
            globalLaborMargin: numeric(input.globalLaborMargin),
            taxes: {
                Materials: numeric(input.taxes?.Materials),
                Labor: numeric(input.taxes?.Labor),
                Equipment: numeric(input.taxes?.Equipment)
            },
            preTaxMarkups: Array.isArray(input.preTaxMarkups) ? input.preTaxMarkups.map(markup) : [],
            postTaxMarkups: Array.isArray(input.postTaxMarkups) ? input.postTaxMarkups.map(markup) : []
        };
    }

    function markup(row = {}) {
        return {
            id: text(row.id) || uid('markup'),
            name: text(row.name, 'Markup'),
            type: row.type === 'fixed_amount' ? 'fixed_amount' : 'percentage',
            percent: numeric(row.percent),
            amount: numeric(row.amount ?? row.percent),
            base: text(row.base, 'subtotal_sales'),
            active: row.active !== false
        };
    }

    function item(row = {}) {
        const takeoffLayerId = text(row.takeoffLayerId ?? row.takeoff_layer_id ?? row.sourceTakeoffId);
        const quantity = numeric(row.quantity ?? row.originalQuantity);
        const itemType = text(row.itemType ?? row.item_type, row.isAssembly ? 'assembly' : 'part').toLowerCase();
        const childRows = row.children ?? row.assemblyItems ?? row.components;
        return {
            id: text(row.id) || uid('item'),
            takeoffLayerId: takeoffLayerId || null,
            catalogItemId: row.catalogItemId ?? row.catalog_item_id ?? null,
            itemType,
            isAssembly: row.isAssembly === true || itemType === 'assembly',
            parentItemId: text(row.parentItemId ?? row.parent_item_id ?? row.assemblyParentId) || null,
            children: Array.isArray(childRows) ? childRows.map(item) : [],
            childrenQuantitiesExtended: row.childrenQuantitiesExtended === true,
            name: text(row.name ?? row.catalog_item_name, 'Cost item'),
            description: text(row.description),
            budgetCode: text(row.budgetCode ?? row.budget_code),
            costCode: text(row.costCode ?? row.cost_code ?? row.budgetCode),
            costCategory: category(row.costCategory ?? row.cost_type ?? row.item_type ?? row.type),
            uom: text(row.uom ?? row.unit_of_measure, 'ea'),
            quantity,
            originalQuantity: numeric(row.originalQuantity, quantity),
            quantitySource: takeoffLayerId ? 'takeoff' : 'manual',
            quantitySyncStatus: takeoffLayerId ? 'synced' : 'manual',
            lastSyncedTakeoffQuantity: numeric(row.lastSyncedTakeoffQuantity, takeoffLayerId ? quantity : 0),
            unitMaterialCost: numeric(row.unitMaterialCost ?? row.unitCost ?? row.unit_cost),
            waste: numeric(row.waste ?? row.waste_percentage),
            materialMargin: numeric(row.materialMargin ?? row.margin ?? row.margin_percentage),
            unitEquipmentCost: numeric(row.unitEquipmentCost ?? row.equipment_cost),
            equipmentQuantity: numeric(row.equipmentQuantity),
            equipmentMargin: numeric(row.equipmentMargin),
            unitLabor: numeric(row.unitLabor ?? row.unit_labor_time ?? row.laborHours ?? row.labor_hours),
            laborUnitType: text(row.laborUnitType ?? row.laborUnit, 'mins'),
            laborRate: numeric(row.laborRate ?? row.labor_rate, 85),
            difficulty: numeric(row.difficulty ?? row.difficulty_factor, 1),
            laborMargin: row.laborMargin === '' || row.labor_margin_percentage === '' ? null
                : (row.laborMargin ?? row.labor_margin_percentage ?? null),
            taxable: row.taxable !== false && Number(row.taxable ?? 1) !== 0,
            notes: text(row.notes),
            updatedAt: text(row.updatedAt ?? row.updated_at, now())
        };
    }

    function category(value) {
        const normalized = text(value).toLowerCase();
        if (normalized.includes('labor')) return 'Labor';
        if (normalized.includes('equip')) return 'Equipment';
        return 'Materials';
    }

    function group(row = {}, index = 0) {
        return {
            id: text(row.id) || uid('group'),
            takeoffGroupId: text(row.takeoffGroupId) || null,
            source: row.source === 'takeoff' || row.takeoffMirror ? 'takeoff' : 'manual',
            name: text(row.name ?? row.groupName, 'Default Group'),
            expanded: row.expanded !== false,
            sortOrder: numeric(row.sortOrder, index),
            items: Array.isArray(row.items) ? row.items.map(item) : []
        };
    }

    function estimate(row = {}, currentProjectId = 0, index = 0) {
        const creationMode = ['primary', 'all', 'structure', 'blank'].includes(row.creationMode)
            ? row.creationMode : (index ? 'all' : 'primary');
        const takeoffSyncMode = row.takeoffSyncMode === 'linked-only'
            || row.takeoffSync?.mode === 'linked-only' ? 'linked-only' : 'mirror';
        return {
            id: text(row.id) || uid('estimate'),
            dbEstimateId: projectId(row.dbEstimateId) || undefined,
            isActive: row.isActive === true,
            revision: Math.max(0, numeric(row.revision)),
            projectId: currentProjectId,
            name: text(row.name, index ? `Estimate ${index + 1}` : 'Primary Estimate'),
            status: text(row.status, 'draft'),
            creationMode,
            takeoffSyncMode,
            createdAt: text(row.createdAt, now()),
            updatedAt: text(row.updatedAt, now()),
            groups: Array.isArray(row.groups) ? row.groups.map(group) : [],
            notes: {
                scope: text(row.notes?.scope),
                included: Array.isArray(row.notes?.included) ? row.notes.included.map(String) : [],
                excluded: Array.isArray(row.notes?.excluded) ? row.notes.excluded.map(String) : [],
                projectNotes: text(row.notes?.projectNotes)
            },
            settings: settings(row.settings),
            auditLog: Array.isArray(row.auditLog) ? row.auditLog.slice(-100).map(entry => ({
                id: text(entry.id) || uid('audit'),
                at: text(entry.at ?? entry.timestamp, now()),
                action: text(entry.action ?? entry.message, 'Updated estimate')
            })) : []
        };
    }

    function empty(currentProjectId = 0, seedItems = []) {
        const groups = seedGroups(seedItems);
        const primary = estimate({ name: 'Primary Estimate', groups }, currentProjectId);
        return workspace({ activeEstimateId: primary.id, estimates: [primary] }, currentProjectId);
    }

    function seedGroups(rows) {
        const groups = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const name = text(row.group_name ?? row.cost_type, category(row.item_type ?? row.source_type));
            if (!groups.has(name)) groups.set(name, group({ name, items: [] }, groups.size));
            groups.get(name).items.push(item(row));
        });
        return [...groups.values()];
    }

    function workspace(raw = {}, currentProjectId = 0, seedItems = []) {
        const estimates = Array.isArray(raw.estimates) && raw.estimates.length
            ? raw.estimates.map((row, index) => estimate(row, currentProjectId, index))
            : [estimate({ groups: seedGroups(seedItems) }, currentProjectId)];
        const requestedActive = text(raw.activeEstimateId);
        const activeEstimateId = estimates.some(row => row.id === requestedActive) ? requestedActive : estimates[0].id;
        estimates.forEach(row => { row.isActive = row.id === activeEstimateId; });
        const active = estimates.find(row => row.id === activeEstimateId);
        return {
            schemaVersion: 2,
            projectId: currentProjectId,
            activeEstimateId,
            estimates,
            groups: active.groups,
            dirtyEstimateIds: Array.isArray(raw.dirtyEstimateIds) ? raw.dirtyEstimateIds.map(String) : [],
            takeoffSyncDirtyIds: Array.isArray(raw.takeoffSyncDirtyIds) ? raw.takeoffSyncDirtyIds.map(String) : [],
            clientUiUpdatedAt: text(raw.clientUiUpdatedAt, now()),
            pendingProjectCreationSync: raw.pendingProjectCreationSync === true
        };
    }

    function active(state) {
        return state.estimates.find(row => row.id === state.activeEstimateId) || state.estimates[0];
    }

    function selectEstimate(state, estimateId) {
        const requested = text(estimateId);
        const selected = state.estimates.find(row => row.id === requested);
        if (!selected) return null;
        state.activeEstimateId = selected.id;
        state.estimates.forEach(row => { row.isActive = row.id === selected.id; });
        state.groups = selected.groups;
        return selected;
    }

    function audit(state, action) {
        const current = active(state);
        current.auditLog.push({ id: uid('audit'), at: now(), action });
        current.auditLog = current.auditLog.slice(-100);
    }

    function touch(state, action) {
        const current = active(state);
        current.updatedAt = now();
        state.clientUiUpdatedAt = current.updatedAt;
        state.groups = current.groups;
        if (action) audit(state, action);
        return state;
    }

    function reconcileTakeoff(state, takeoffGroups = []) {
        const current = active(state);
        const Sync = global.TakeoffEstimatingSyncService;
        if (!Sync?.reconcile) return state;
        current.groups = Sync.reconcile(current.groups, takeoffGroups).map(group);
        return touch(state, 'Synchronized items from Takeoff');
    }

    function createEstimate(state, name, mode = 'blank') {
        const source = active(state);
        const creationMode = ['all', 'structure', 'blank'].includes(mode) ? mode : 'blank';
        const groups = creationMode === 'all' ? clone(source.groups) : creationMode === 'structure'
            ? source.groups.map(row => ({ ...clone(row), items: [] })) : [];
        const created = estimate({ name: text(name).trim() || 'New Estimate', groups,
            creationMode,
            takeoffSyncMode: creationMode === 'all' ? source.takeoffSyncMode : 'linked-only',
            settings: creationMode === 'all' ? clone(source.settings) : {},
            notes: creationMode === 'all' ? clone(source.notes) : {} }, state.projectId, state.estimates.length);
        state.estimates.push(created);
        state.activeEstimateId = created.id;
        state.estimates.forEach(row => { row.isActive = row.id === created.id; });
        state.groups = created.groups;
        return touch(state, `Created estimate “${created.name}”`);
    }

    function removeEstimate(state, estimateId) {
        if (state.estimates.length < 2) return false;
        const index = state.estimates.findIndex(row => row.id === estimateId);
        if (index < 0) return false;
        state.estimates.splice(index, 1);
        state.activeEstimateId = state.estimates[Math.max(0, index - 1)].id;
        state.estimates.forEach(row => { row.isActive = row.id === state.activeEstimateId; });
        return touch(state, 'Deleted estimate');
    }

    const service = { now, uid, numeric, projectId, item, group, estimate, workspace, empty, active, selectEstimate, touch,
        audit, reconcileTakeoff, createEstimate, removeEstimate, clone };
    global.EstimatingWorkspaceService = service;
    if (typeof module !== 'undefined') module.exports = service;
})(typeof window !== 'undefined' ? window : globalThis);
