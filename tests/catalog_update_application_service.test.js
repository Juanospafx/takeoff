const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../assets/catalog_item_contract.js');
const Snapshot = require('../assets/estimating_catalog_snapshot_service.js');
const Workspace = require('../assets/estimating_workspace_service.js');
const Adapter = require('../assets/estimating_catalog_adapter.js');
const Calc = require('../assets/estimate_calculation_service.js');
const Application = require('../assets/catalog_update_application_service.js');
const fs = require('node:fs');
const path = require('node:path');

const dto = raw => Contract.normalizeCatalogItem(raw);
function catalogItem(raw) {
    const current = dto(raw);
    return Adapter.catalogItemDtoToEstimatingItem(current, {
        globalLaborRate: raw.labor_rate || 0,
        workspaceItem: Workspace.item,
        itemsById: raw.itemsById || new Map()
    });
}
function estimate(items, extra = {}) {
    return Workspace.estimate({
        id: 'estimate-1', dbEstimateId: 41, revision: 7, estimateRevision: 3,
        status: 'draft', groups: [{ id: 'group-1', items }],
        settings: { marginMode: 'margin', globalLaborCost: 0, globalLaborMargin: 0,
            taxes: { Materials: 0, Labor: 0, Equipment: 0 } },
        ...extra
    }, 9);
}
const options = prepared => ({ preparedPreview: prepared, previewGuard: prepared.guard,
    now: () => '2026-08-27T12:00:00.000Z' });
function businessProjection(value) {
    const copy = Workspace.clone(value);
    const visit = item => { delete item.lastCatalogRefresh; (item.children || []).forEach(visit); };
    (copy.groups || []).forEach(group => (group.items || []).forEach(visit));
    delete copy.catalogRefreshHistory; delete copy.catalogUpdateConflicts;
    delete copy.catalogUpdateSourceGuard; delete copy.updatedAt; delete copy.auditLog;
    return copy;
}

test('strategy uses actual editable and historical states conservatively', () => {
    assert.equal(Application.resolveCatalogUpdateStrategy({ status: 'draft' }).strategy, 'UPDATE_IN_PLACE');
    assert.equal(Application.resolveCatalogUpdateStrategy({ status: 'ready' }).strategy, 'UPDATE_IN_PLACE');
    for (const status of ['submitted', 'approved', 'locked', 'closed', 'archived', 'custom-final']) {
        assert.equal(Application.resolveCatalogUpdateStrategy({ status }).strategy, 'CREATE_REVISION');
    }
    assert.equal(Application.resolveCatalogUpdateStrategy({ status: 'draft', isLocked: true }).strategy, 'CREATE_REVISION');
});

test('editable PART update stays on the same Estimate and matches preview totals', () => {
    const item = catalogItem({ id: 1, revision: 1, item_type: 'part', unit_cost: 10 }); item.quantity = 10;
    const source = estimate([item]);
    const catalog = [dto({ id: 1, revision: 2, item_type: 'part', unit_cost: 12 })];
    const prepared = Application.prepareCatalogUpdate(source, catalog);
    const result = Application.applyCatalogUpdate(source, catalog, options(prepared));
    assert.equal(result.strategy, 'UPDATE_IN_PLACE');
    assert.equal(result.appliedEstimate.id, source.id);
    assert.equal(result.appliedEstimate.revision, 7);
    assert.equal(result.appliedEstimate.groups[0].items[0].catalogRevision, 2);
    assert.equal(result.appliedEstimate.groups[0].items[0].catalogSnapshot.pricing.materialUnitCost, 12);
    assert.equal(result.newTotals.total, 120);
    assert.equal(result.newTotals.total, prepared.preview.projected.total);
    assert.deepEqual(businessProjection(result.appliedEstimate), businessProjection(prepared.preview.projectedEstimate));
});

test('price override remains effective while the canonical snapshot advances', () => {
    const item = catalogItem({ id: 2, revision: 1, item_type: 'part', unit_cost: 10 }); item.quantity = 10;
    Snapshot.setCatalogOverride(item, 'materialUnitCost', 9);
    const source = estimate([item]);
    const catalog = [dto({ id: 2, revision: 2, item_type: 'part', unit_cost: 12 })];
    const prepared = Application.prepareCatalogUpdate(source, catalog);
    const result = Application.applyCatalogUpdate(source, catalog, options(prepared));
    const appliedItem = result.appliedEstimate.groups[0].items[0];
    assert.equal(appliedItem.catalogSnapshot.pricing.materialUnitCost, 12);
    assert.equal(appliedItem.overrides.materialUnitCost, 9);
    assert.equal(result.newTotals.total, 90);
    assert.equal(result.catalogRefreshMetadata.preservedOverrides, 1);
});

test('historical Estimate creates a business revision and leaves its source byte-identical', () => {
    const item = catalogItem({ id: 3, revision: 1, item_type: 'part', unit_cost: 10 }); item.quantity = 2;
    item.takeoffLayerId = 'layer-3'; item.quantitySource = 'takeoff';
    const source = estimate([item], { status: 'approved', isLocked: true });
    const before = JSON.stringify(source);
    const catalog = [dto({ id: 3, revision: 2, item_type: 'part', unit_cost: 15 })];
    const prepared = Application.prepareCatalogUpdate(source, catalog);
    const result = Application.applyCatalogUpdate(source, catalog, {
        ...options(prepared), idFactory: () => 'estimate-revision-4'
    });
    assert.equal(JSON.stringify(source), before);
    assert.equal(result.strategy, 'CREATE_REVISION');
    assert.equal(result.appliedEstimate.id, 'estimate-revision-4');
    assert.equal(result.appliedEstimate.estimateRevision, 4);
    assert.equal(result.appliedEstimate.parentEstimateId, 'estimate-1');
    assert.equal(result.appliedEstimate.sourceEstimateRevision, 3);
    assert.equal(result.appliedEstimate.revision, 0);
    assert.equal(result.appliedEstimate.groups[0].items[0].takeoffLayerId, null);
    assert.equal(result.appliedEstimate.groups[0].items[0].copiedFromTakeoffLayerId, 'layer-3');
    assert.ok(result.warnings.some(row => row.startsWith('TAKEOFF_BINDING_REQUIRES_RELINK:')));
});

test('partial update refreshes only selected Catalog Items', () => {
    const first = catalogItem({ id: 10, revision: 1, item_type: 'part', unit_cost: 10 });
    const second = catalogItem({ id: 11, revision: 1, item_type: 'part', unit_cost: 20 });
    const source = estimate([first, second]);
    const catalog = [dto({ id: 10, revision: 2, item_type: 'part', unit_cost: 12 }),
        dto({ id: 11, revision: 2, item_type: 'part', unit_cost: 25 })];
    const updateOptions = { selectedCatalogItemIds: [10] };
    const prepared = Application.prepareCatalogUpdate(source, catalog, updateOptions);
    const result = Application.applyCatalogUpdate(source, catalog, { ...options(prepared), ...updateOptions });
    const items = result.appliedEstimate.groups[0].items;
    assert.equal(items[0].catalogRevision, 2);
    assert.equal(items[1].catalogRevision, 1);
    assert.equal(result.appliedChanges.length, 1);
    assert.ok(result.skippedItems.some(row => String(row.catalogItemId) === '11' && row.reason === 'NOT_SELECTED'));
});

test('missing, legacy and manual rows remain intact', () => {
    const missing = catalogItem({ id: 20, revision: 1, item_type: 'part', unit_cost: 7 });
    const legacy = Workspace.item({ id: 'legacy', catalogItemId: 21, quantity: 2, unitMaterialCost: 8 });
    const manual = Workspace.item({ id: 'manual', quantity: 3, unitMaterialCost: 9, notes: 'Project row' });
    const source = estimate([missing, legacy, manual]);
    const prepared = Application.prepareCatalogUpdate(source, []);
    const result = Application.applyCatalogUpdate(source, [], options(prepared));
    assert.deepEqual(result.appliedEstimate.groups, source.groups);
    assert.ok(result.warnings.some(row => row.startsWith('MISSING_CATALOG_ITEM_PRESERVED:')));
    assert.ok(result.warnings.some(row => row.startsWith('LEGACY_ITEM_NOT_REFRESHABLE:')));
});

test('Assembly removal preserves overridden child as structured conflict metadata', () => {
    const childDto = dto({ id: 31, revision: 1, item_type: 'part', unit_cost: 10 });
    const assemblyDto = Contract.normalizeCatalogItem({ id: 30, revision: 1, item_type: 'assembly' }, {
        assemblyParts: [{ id: 300, assembly_catalog_item_id: 30, part_catalog_item_id: 31, quantity: 2 }]
    });
    const assembly = Adapter.catalogItemDtoToEstimatingItem(assemblyDto, {
        globalLaborRate: 0, workspaceItem: Workspace.item, itemsById: new Map([['31', childDto]])
    });
    Snapshot.setCatalogOverride(assembly.children[0], 'materialUnitCost', 6);
    const source = estimate([assembly]);
    const catalog = [dto({ id: 30, revision: 2, item_type: 'assembly', assemblyComponents: [] }), childDto];
    const prepared = Application.prepareCatalogUpdate(source, catalog);
    const result = Application.applyCatalogUpdate(source, catalog, options(prepared));
    assert.equal(result.appliedEstimate.groups[0].items[0].children.length, 0);
    assert.equal(result.conflicts[0].code, 'REMOVED_COMPONENT_WITH_OVERRIDE');
    assert.equal(result.conflicts[0].overrides.materialUnitCost, 6);
    assert.equal(result.appliedEstimate.catalogUpdateConflicts[0].catalogItemId, '31');
});

test('Estimate and Catalog mutations after preview are rejected', () => {
    const item = catalogItem({ id: 40, revision: 1, item_type: 'part', unit_cost: 10 });
    const source = estimate([item]);
    const catalog = [dto({ id: 40, revision: 2, item_type: 'part', unit_cost: 12 })];
    const prepared = Application.prepareCatalogUpdate(source, catalog);
    const edited = Workspace.clone(source); edited.notes.scope = 'Changed after preview';
    assert.throws(() => Application.applyCatalogUpdate(edited, catalog, options(prepared)),
        error => error.code === 'ESTIMATE_CHANGED_SINCE_PREVIEW');
    const newerCatalog = [dto({ id: 40, revision: 3, item_type: 'part', unit_cost: 14 })];
    assert.throws(() => Application.applyCatalogUpdate(source, newerCatalog, options(prepared)),
        error => error.code === 'CATALOG_CHANGED_SINCE_PREVIEW');
});

test('save/reload normalization preserves snapshots, trace, lineage, overrides and totals', () => {
    const item = catalogItem({ id: 50, revision: 1, item_type: 'equipment', unit_cost: 100 });
    item.equipmentQuantity = 2;
    Snapshot.setCatalogOverride(item, 'equipmentUnitCost', 90);
    const source = estimate([item], { status: 'closed' });
    const catalog = [dto({ id: 50, revision: 2, item_type: 'equipment', unit_cost: 125 })];
    const prepared = Application.prepareCatalogUpdate(source, catalog);
    const applied = Application.applyCatalogUpdate(source, catalog, {
        ...options(prepared), idFactory: () => 'revision-copy'
    }).appliedEstimate;
    const restored = Workspace.estimate(JSON.parse(JSON.stringify(applied)), 9, 1);
    assert.equal(restored.estimateRevision, 4);
    assert.equal(restored.parentEstimateId, 'estimate-1');
    assert.equal(restored.catalogUpdateSourceGuard.sourceServerRevision, 7);
    assert.equal(restored.groups[0].items[0].catalogSnapshot.pricing.equipmentUnitCost, 125);
    assert.equal(restored.groups[0].items[0].overrides.equipmentUnitCost, 90);
    assert.equal(restored.groups[0].items[0].lastCatalogRefresh.currentCatalogRevision, 2);
    assert.equal(restored.catalogRefreshHistory.length, 1);
    assert.equal(Calc.calculateSummary(restored.groups, restored.settings).estimateTotal,
        Calc.calculateSummary(applied.groups, applied.settings).estimateTotal);
});

test('category filters preserve excluded Equipment and Labor pricing while advancing metadata', () => {
    const equipment = catalogItem({ id: 60, revision: 1, item_type: 'equipment', unit_cost: 100 });
    equipment.equipmentQuantity = 1;
    const labor = catalogItem({ id: 61, revision: 1, item_type: 'labor', labor_hours: 1, labor_rate: 40 });
    const source = estimate([equipment, labor]);
    const catalog = [dto({ id: 60, revision: 2, item_type: 'equipment', unit_cost: 150 }),
        dto({ id: 61, revision: 2, item_type: 'labor', labor_hours: 2, labor_rate: 60 })];
    const filter = { includeEquipment: false, includeLabor: false };
    const prepared = Application.prepareCatalogUpdate(source, catalog, filter);
    const result = Application.applyCatalogUpdate(source, catalog, { ...options(prepared), ...filter });
    const [nextEquipment, nextLabor] = result.appliedEstimate.groups[0].items;
    assert.equal(nextEquipment.catalogRevision, 2);
    assert.equal(nextEquipment.catalogSnapshot.pricing.equipmentUnitCost, 100);
    assert.equal(nextLabor.catalogRevision, 2);
    assert.equal(nextLabor.catalogSnapshot.pricing.laborHoursPerUnit, 1);
    assert.equal(nextLabor.catalogSnapshot.pricing.laborRate, 40);
    assert.equal(result.previousTotals.total, result.newTotals.total);
});

test('existing persistence path exposes guarded prepare/apply without adding a parallel endpoint', () => {
    const root = path.join(__dirname, '..');
    const client = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
    const api = fs.readFileSync(path.join(root, 'api/project_estimating.php'), 'utf8');
    assert.match(client, /projectEstimatingPrepareCatalogUpdate/);
    assert.match(client, /projectEstimatingApplyCatalogUpdate/);
    assert.match(client, /Catalog\.getSnapshot\(\)/);
    assert.match(client, /await window\.projectEstimatingSave\(\)/);
    assert.match(api, /catalogUpdateSourceGuard/);
    assert.match(api, /if \(!\$estimateId && isset\(\$estimate\['catalogUpdateSourceGuard'\]\)/);
    assert.match(api, /sourceServerRevision/);
    assert.match(api, /ESTIMATE_CHANGED_SINCE_PREVIEW/);
    assert.doesNotMatch(api, /action\s*===\s*['"]apply_catalog_update['"]/);
});
