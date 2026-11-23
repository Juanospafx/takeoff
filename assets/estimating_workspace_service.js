(function (global) {
    'use strict';

    const now = () => new Date().toISOString();
    const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const nullableNumeric = value => (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)))
        ? null : Number(value);
    const text = (value, fallback = '') => value === null || value === undefined ? fallback : String(value);
    const clone = value => JSON.parse(JSON.stringify(value));
    const CatalogSnapshot = global.EstimatingCatalogSnapshotService
        || (typeof require === 'function' ? require('./estimating_catalog_snapshot_service.js') : null);

    function projectId(value) {
        const parsed = Number(typeof value === 'string' ? value.trim() : value);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
    }

    function settings(input = {}) {
        const hasVal = value => value !== undefined && value !== null && value === '' ? false : (value !== undefined && value !== null && Number.isFinite(Number(value)));
        const globalLaborCost = hasVal(input.globalLaborCost) ? numeric(input.globalLaborCost, 36) : 36;
        const globalLaborMargin = hasVal(input.globalLaborMargin) ? numeric(input.globalLaborMargin) : 34.6;
        const computedLaborSales = globalLaborMargin < 100
            ? Number((globalLaborCost / (1 - globalLaborMargin / 100)).toFixed(2))
            : globalLaborCost;
        const result = {
            assemblyExpansionPolicy: String(input.assemblyExpansionPolicy ?? input.assembly_expansion_policy ?? 'LEGACY').toUpperCase() === 'CANONICAL'
                ? 'CANONICAL' : 'LEGACY',
            marginMode: input.marginMode === 'markup' ? 'markup' : 'margin',
            globalLaborCost,
            globalLaborSales: (hasVal(input.globalLaborSales) && Number(input.globalLaborSales) !== 110)
                ? numeric(input.globalLaborSales, computedLaborSales)
                : computedLaborSales,
            globalLaborMargin,
            materialMargin: hasVal(input.materialMargin) ? numeric(input.materialMargin) : 15,
            equipmentMargin: hasVal(input.equipmentMargin) ? numeric(input.equipmentMargin) : 15,
            laborWaste: hasVal(input.laborWaste) ? numeric(input.laborWaste) : 0,
            materialWaste: hasVal(input.materialWaste) ? numeric(input.materialWaste) : 0,
            equipmentWaste: hasVal(input.equipmentWaste) ? numeric(input.equipmentWaste) : 0,
            laborDifficulty: hasVal(input.laborDifficulty) ? numeric(input.laborDifficulty, 1) : 1,
            taxes: {
                Materials: numeric(input.taxes?.Materials),
                Labor: numeric(input.taxes?.Labor),
                Equipment: numeric(input.taxes?.Equipment)
            },
            preTaxMarkups: Array.isArray(input.preTaxMarkups) ? input.preTaxMarkups.map(markup) : [],
            postTaxMarkups: Array.isArray(input.postTaxMarkups) ? input.postTaxMarkups.map(markup) : []
        };
        if (input.squareFootage !== undefined && input.squareFootage !== null) result.squareFootage = numeric(input.squareFootage, 0);
        if (input._markupsSeeded !== undefined) result._markupsSeeded = Boolean(input._markupsSeeded);
        if (input._defaultsActivated !== undefined) result._defaultsActivated = Boolean(input._defaultsActivated);
        if (input._laborDefaultsActivated !== undefined) result._laborDefaultsActivated = Boolean(input._laborDefaultsActivated);
        if (Array.isArray(input.visibleColumns) && input.visibleColumns.length > 0) {
            result.visibleColumns = input.visibleColumns.map(col => text(col)).filter(Boolean);
        }
        if (Array.isArray(input.columnsOrder) && input.columnsOrder.length > 0) {
            result.columnsOrder = input.columnsOrder.map(col => text(col)).filter(Boolean);
        }
        if (input.columnWidths && typeof input.columnWidths === 'object' && !Array.isArray(input.columnWidths)) {
            const cleanedWidths = {};
            Object.entries(input.columnWidths).forEach(([k, v]) => {
                const key = text(k);
                const val = Number(v);
                if (key && Number.isFinite(val) && val > 0) cleanedWidths[key] = val;
            });
            if (Object.keys(cleanedWidths).length > 0) result.columnWidths = cleanedWidths;
        }
        return result;
    }

    function markup(row = {}) {
        return {
            id: text(row.id) || uid('markup'),
            name: text(row.name, 'Markup'),
            type: row.type === 'fixed_amount' ? 'fixed_amount' : 'percentage',
            percent: numeric(row.percent),
            amount: numeric(row.amount ?? row.percent),
            base: text(row.base, 'subtotal_sales'),
            operator: row.operator === 'subtract' ? 'subtract' : 'add',
            active: row.active !== false
        };
    }

    function assemblyComponentSignature(row = {}) {
        const volatileKeys = new Set([
            'id', 'parentItemId', 'parent_item_id', 'assemblyParentId',
            'createdAt', 'created_at', 'updatedAt', 'updated_at'
        ]);
        const canonicalize = (value, key = '') => {
            if (volatileKeys.has(key)) return undefined;
            if (Array.isArray(value)) return value.map(entry => canonicalize(entry));
            if (value && typeof value === 'object') {
                return Object.keys(value).sort().reduce((result, childKey) => {
                    const normalized = canonicalize(value[childKey], childKey);
                    if (normalized !== undefined) result[childKey] = normalized;
                    return result;
                }, {});
            }
            return value;
        };
        return JSON.stringify(canonicalize(row));
    }

    function uniqueAssemblyComponents(rows) {
        const seen = new Set();
        const result = [];
        let removed = 0;
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const signature = assemblyComponentSignature(row);
            if (seen.has(signature)) {
                removed += 1;
                return;
            }
            seen.add(signature);
            result.push(row);
        });
        return { rows: result, removed };
    }

    function item(row = {}) {
        const takeoffLayerId = text(row.takeoffLayerId ?? row.takeoff_layer_id ?? row.sourceTakeoffId);
        const quantity = numeric(row.quantity ?? row.originalQuantity);
        const persistedType = row.itemType ?? row.item_type ?? row.type
            ?? row.catalogSnapshot?.type ?? row.catalogMetadata?.type;
        const categoryType = String(row.costCategory ?? row.cost_category ?? '').toLowerCase() === 'assembly'
            ? 'assembly' : null;
        const itemType = text(persistedType ?? categoryType,
            (row.isAssembly || row.is_assembly) ? 'assembly' : 'part').toLowerCase();
        const childRows = row.children ?? row.assemblyItems ?? row.components
            ?? row.catalogSnapshot?.assemblyComponents ?? row.catalogMetadata?.assemblyComponents;
        const uniqueChildren = uniqueAssemblyComponents(childRows);
        const normalizedCatalogSnapshot = row.catalogSnapshot ? clone(row.catalogSnapshot) : null;
        const normalizedCatalogMetadata = row.catalogMetadata ? clone(row.catalogMetadata) : null;
        let removedDuplicateComponents = uniqueChildren.removed;
        [normalizedCatalogSnapshot, normalizedCatalogMetadata].forEach(snapshot => {
            if (!snapshot || !Array.isArray(snapshot.assemblyComponents)) return;
            const unique = uniqueAssemblyComponents(snapshot.assemblyComponents);
            snapshot.assemblyComponents = unique.rows;
            removedDuplicateComponents += unique.removed;
        });
        const snapPricing = (row.pricingSnapshot && typeof row.pricingSnapshot === 'object') ? row.pricingSnapshot : {};
        const explicitRate = nullableNumeric(row.laborRate ?? row.labor_rate);
        const hasManualZeroRate = row._manualFields?.laborRate === true || (row.overrides?.laborRate !== null && row.overrides?.laborRate !== undefined);
        const snapRate = numeric(snapPricing.laborRate, 0);
        const inferredLaborUnit = (
            row.laborHours !== undefined || row.labor_hours !== undefined || row.child_labor_hours !== undefined
            || snapPricing.laborHoursPerUnit !== undefined || row.catalogSnapshot || row.catalogMetadata
            || takeoffLayerId
        ) ? 'hrs' : 'mins';
        // The workspace snapshot is the lossless source of truth. Start from a
        // deep copy so forward-compatible fields (tags, multiplier, locks and
        // calculation extensions) survive normalization and estimate copies.
        const normalized = {
            ...clone(row),
            id: text(row.id) || uid('item'),
            takeoffLayerId: takeoffLayerId || null,
            copiedFromTakeoffLayerId: text(row.copiedFromTakeoffLayerId) || null,
            catalogItemId: row.catalogItemId ?? row.catalog_item_id ?? row.part_catalog_item_id ?? null,
            catalogRevision: row.catalogRevision ?? null,
            catalogSnapshot: normalizedCatalogSnapshot,
            catalogMetadata: normalizedCatalogMetadata,
            overrides: row.overrides ? clone(row.overrides) : null,
            lastCatalogRefresh: row.lastCatalogRefresh ? clone(row.lastCatalogRefresh) : null,
            itemType,
            isAssembly: row.isAssembly === true || Number(row.is_assembly ?? 0) === 1
                || itemType === 'assembly' || (Array.isArray(childRows) && childRows.length > 0),
            parentItemId: text(row.parentItemId ?? row.parent_item_id ?? row.assemblyParentId) || null,
            assemblyComponentId: row.assemblyComponentId ?? row.assembly_component_id ?? null,
            children: uniqueChildren.rows.map(item),
            _workspaceRepairFlags: removedDuplicateComponents > 0 ? ['duplicate-assembly-components'] : undefined,
            childrenQuantitiesExtended: row.childrenQuantitiesExtended === true,
            assemblyExpansionPolicy: String(row.assemblyExpansionPolicy ?? row.assembly_expansion_policy ?? 'LEGACY').toUpperCase() === 'CANONICAL'
                ? 'CANONICAL' : 'LEGACY',
            ratio: row.ratio !== undefined && row.ratio !== null ? numeric(row.ratio) : null,
            factorOverride: row.factorOverride !== undefined && row.factorOverride !== null ? numeric(row.factorOverride) : null,
            ratioType: text(row.ratioType ?? row.ratio_type, 'per_unit'),
            spacing: row.spacing === null || row.spacing === undefined ? null : numeric(row.spacing),
            componentWaste: numeric(row.componentWaste ?? row.wasteFactorPercent ?? row.waste_factor_percent),
            name: text(row.name ?? row.child_item_name ?? row.childItemName ?? row.componentName ?? row.catalog_item_name, 'Cost item'),
            description: text(row.description ?? row.child_description),
            budgetCode: text(row.budgetCode ?? row.budget_code),
            costCode: text(row.costCode ?? row.cost_code ?? row.budgetCode),
            costCategory: category(row.costCategory ?? row.cost_type ?? row.item_type ?? row.type),
            uom: text(row.uom ?? row.unit_of_measure ?? row.child_unit_of_measure, 'ea'),
            quantity,
            multiplier: numeric(row.multiplier, 1),
            locked: row.locked === true || Number(row.locked ?? 0) === 1,
            tags: Array.isArray(row.tags) ? clone(row.tags) : [],
            originalQuantity: numeric(row.originalQuantity, quantity),
            quantityOverride: row.quantityOverride === true || String(row.quantitySyncStatus || '').toLowerCase() === 'overridden',
            pendingTakeoffQuantity: row.pendingTakeoffQuantity === null || row.pendingTakeoffQuantity === undefined ? null : numeric(row.pendingTakeoffQuantity),
            quantitySource: takeoffLayerId ? 'takeoff' : 'manual',
            quantitySyncStatus: (row.quantityOverride === true || String(row.quantitySyncStatus || '').toLowerCase() === 'overridden')
                ? 'overridden' : (takeoffLayerId ? 'synced' : 'manual'),
            lastSyncedTakeoffQuantity: numeric(row.lastSyncedTakeoffQuantity, takeoffLayerId ? numeric(row.originalQuantity, quantity) : 0),
            unitMaterialCost: numeric(row.unitMaterialCost ?? row.unitCost ?? row.unit_cost ?? snapPricing.materialUnitCost ?? row.child_unit_cost),
            waste: nullableNumeric(row.waste ?? row.waste_percentage),
            materialMargin: nullableNumeric(row.materialMargin ?? row.margin ?? row.margin_percentage),
            unitEquipmentCost: numeric(row.unitEquipmentCost ?? row.equipment_cost ?? snapPricing.equipmentUnitCost),
            unitSubcontractorCost: numeric(row.unitSubcontractorCost ?? row.subcontractor_cost ?? snapPricing.subcontractorUnitCost),
            equipmentQuantity: numeric(row.equipmentQuantity),
            equipmentMargin: nullableNumeric(row.equipmentMargin),
            unitLabor: numeric(row.unitLabor ?? row.unit_labor_time ?? row.laborHours ?? row.labor_hours ?? snapPricing.laborHoursPerUnit ?? row.child_labor_hours),
            laborUnitType: text(row.laborUnitType ?? row.laborUnit, inferredLaborUnit),
            laborRate: (explicitRate !== null && (explicitRate > 0 || hasManualZeroRate)) ? explicitRate : (snapRate > 0 ? snapRate : null),
            difficulty: nullableNumeric(row.difficulty ?? row.difficulty_factor),
            laborWaste: nullableNumeric(row.laborWaste),
            laborMargin: nullableNumeric(row.laborMargin ?? row.labor_margin_percentage),
            taxable: row.taxable !== false && Number(row.taxable ?? 1) !== 0,
            _manualFields: (row._manualFields && typeof row._manualFields === 'object') ? { ...row._manualFields } : {},
            notes: text(row.notes),
            updatedAt: text(row.updatedAt ?? row.updated_at, now())
        };
        return CatalogSnapshot ? CatalogSnapshot.normalizeItemCatalogState(normalized) : normalized;
    }

    function consumeRepairFlags(estimateRow = {}) {
        const flags = new Set();
        const visit = candidate => {
            if (!candidate || typeof candidate !== 'object') return;
            (candidate._workspaceRepairFlags || []).forEach(flag => flags.add(String(flag)));
            delete candidate._workspaceRepairFlags;
            (candidate.children || []).forEach(visit);
        };
        (estimateRow.groups || []).forEach(groupRow => (groupRow.items || []).forEach(visit));
        return [...flags];
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
        // Early Excel/template imports persisted `linked`. It has always meant
        // the non-destructive linked-only policy; interpreting it as mirror
        // lets an empty Takeoff hydration replace the imported estimate.
        const rawTakeoffSyncMode = text(row.takeoffSyncMode ?? row.takeoffSync?.mode).toLowerCase();
        const takeoffSyncMode = rawTakeoffSyncMode === 'linked-only' || rawTakeoffSyncMode === 'linked'
            ? 'linked-only' : 'mirror';
        const explicitPrimaryId = String(row.primary_estimate_id || global.ProjectState?.projectMeta?.primary_estimate_id || '');
        const hasRowPrimaryFlag = typeof row.is_primary === 'boolean' || typeof row.isPrimary === 'boolean';
        const isPrimary = row.primary_estimate_id
            ? String(row.id) === String(row.primary_estimate_id)
            : (hasRowPrimaryFlag
                ? Boolean(row.is_primary ?? row.isPrimary)
                : (explicitPrimaryId ? String(row.id) === explicitPrimaryId : (index === 0)));
        const resolvedEstimateTotal = row.estimateTotal ?? row.totalSales ?? row.estimateSummary?.estimateTotal ?? row.estimateSummary?.total ?? null;
        return {
            id: text(row.id) || uid('estimate'),
            dbEstimateId: projectId(row.dbEstimateId) || undefined,
            isActive: row.isActive === true,
            isLocked: row.isLocked === true,
            is_primary: isPrimary,
            isPrimary: isPrimary,
            estimateTotal: resolvedEstimateTotal !== null ? numeric(resolvedEstimateTotal) : undefined,
            totalSales: resolvedEstimateTotal !== null ? numeric(resolvedEstimateTotal) : undefined,
            estimateSummary: row.estimateSummary && typeof row.estimateSummary === 'object' ? clone(row.estimateSummary) : undefined,
            revision: Math.max(0, numeric(row.revision)),
            estimateRevision: Math.max(1, numeric(row.estimateRevision, 1)),
            parentEstimateId: text(row.parentEstimateId) || null,
            sourceEstimateRevision: row.sourceEstimateRevision === null || row.sourceEstimateRevision === undefined
                ? null : Math.max(1, numeric(row.sourceEstimateRevision, 1)),
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
            })) : [],
            catalogRefreshHistory: Array.isArray(row.catalogRefreshHistory) ? clone(row.catalogRefreshHistory).slice(-50) : [],
            catalogUpdateConflicts: Array.isArray(row.catalogUpdateConflicts) ? clone(row.catalogUpdateConflicts) : [],
            catalogUpdateSourceGuard: row.catalogUpdateSourceGuard ? clone(row.catalogUpdateSourceGuard) : null
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
            deletedEstimateIds: Array.isArray(raw.deletedEstimateIds) ? [...new Set(raw.deletedEstimateIds.map(String))] : [],
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
        const sourceGroups = creationMode === 'blank' ? [] : clone(source.groups);
        const groupIds = new Map(sourceGroups.map(row => [String(row.id), uid('group')]));
        const sourceItems = [];
        const collectItems = rows => (rows || []).forEach(item => {
            sourceItems.push(item);
            collectItems(item.children);
        });
        sourceGroups.forEach(row => collectItems(row.items));
        const itemIds = new Map(sourceItems.map(item => [String(item.id), uid('item')]));
        const copyItem = item => ({
            ...item,
            id: itemIds.get(String(item.id)),
            parentItemId: item.parentItemId ? (itemIds.get(String(item.parentItemId)) || null) : null,
            children: (item.children || []).map(copyItem),
            copiedFromTakeoffLayerId: item.takeoffLayerId || null,
            takeoffLayerId: null,
            estimateItemId: null,
            dbEstimateItemId: null,
            quantitySource: 'manual',
            quantitySyncStatus: 'manual'
        });
        const groups = sourceGroups.map(row => ({
            ...row,
            id: groupIds.get(String(row.id)),
            takeoffGroupId: null,
            source: creationMode === 'all' ? 'estimate-copy' : 'manual',
            items: creationMode === 'structure' ? [] : (row.items || []).map(copyItem)
        }));
        const created = estimate({ name: text(name).trim() || 'New Estimate', groups,
            creationMode,
            sourceEstimateId: creationMode === 'all' ? (source?.id || null) : null,
            takeoffSyncMode: 'linked-only',
            settings: source?.settings ? clone(source.settings) : {},
            notes: creationMode === 'all' ? clone(source.notes) : {} }, state.projectId, state.estimates.length);
        state.estimates.push(created);
        state.activeEstimateId = created.id;
        state.estimates.forEach(row => { row.isActive = row.id === created.id; });
        state.groups = created.groups;
        return touch(state, `Created estimate "${created.name}"`);
    }

    function removeEstimate(state, estimateId) {
        if (state.estimates.length < 2) return false;
        const index = state.estimates.findIndex(row => String(row.id) === String(estimateId));
        if (index < 0) return false;
        const removingActive = String(state.activeEstimateId) === String(estimateId);
        state.estimates.splice(index, 1);
        if (removingActive) state.activeEstimateId = state.estimates[Math.max(0, index - 1)].id;
        state.estimates.forEach(row => { row.isActive = row.id === state.activeEstimateId; });
        state.groups = active(state).groups;
        return touch(state, 'Deleted estimate');
    }

    const service = { now, uid, numeric, projectId, settings, item, group, estimate, workspace, empty, active, selectEstimate, touch,
        consumeRepairFlags,
        audit, reconcileTakeoff, createEstimate, removeEstimate, clone };
    global.EstimatingWorkspaceService = service;
    if (typeof module !== 'undefined') module.exports = service;
})(typeof window !== 'undefined' ? window : globalThis);
