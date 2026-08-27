const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../assets/catalog_item_contract.js');
const Snapshot = require('../assets/estimating_catalog_snapshot_service.js');
const Detection = require('../assets/catalog_change_detection_service.js');

const dto = raw => Contract.normalizeCatalogItem(raw);
function linked(raw) {
    const current = dto(raw);
    const item = { catalogItemId: current.id, catalogRevision: current.revision, catalogSnapshot: null,
        overrides: Snapshot.emptyOverrides() };
    Snapshot.attachCatalogSnapshot(item, current);
    return { item, current };
}

test('same revision and content is CURRENT', () => {
    const { item, current } = linked({ id: 1, revision: 8, item_type: 'part', unit_cost: 10 });
    const result = Detection.compareCatalogItem(item, current);
    assert.equal(result.status, Detection.STATUS.CURRENT);
    assert.equal(result.outdated, false);
    assert.deepEqual(result.changes, []);
});

test('material price change without override affects the effective value', () => {
    const { item } = linked({ id: 1, revision: 7, item_type: 'part', unit_cost: 10 });
    const result = Detection.compareCatalogItem(item, dto({ id: 1, revision: 8, item_type: 'part', unit_cost: 12 }));
    const change = result.changes.find(row => row.field === 'pricing.materialUnitCost');
    assert.equal(result.status, Detection.STATUS.OUTDATED);
    assert.equal(change.previousValue, 10);
    assert.equal(change.currentValue, 12);
    assert.equal(change.effectiveValueBefore, 10);
    assert.equal(change.effectiveValueAfterIfUpdated, 12);
    assert.equal(change.impact, Detection.IMPACT.EFFECTIVE_VALUE_CHANGE);
});

test('material price change with override is reported but has no effective impact', () => {
    const { item } = linked({ id: 1, revision: 7, item_type: 'part', unit_cost: 10 });
    Snapshot.setCatalogOverride(item, 'materialUnitCost', 9);
    const result = Detection.compareCatalogItem(item, dto({ id: 1, revision: 8, item_type: 'part', unit_cost: 12 }));
    const change = result.changes.find(row => row.field === 'pricing.materialUnitCost');
    assert.equal(change.hasOverride, true);
    assert.equal(change.overrideValue, 9);
    assert.equal(change.effectiveValueBefore, 9);
    assert.equal(change.effectiveValueAfterIfUpdated, 9);
    assert.equal(change.impact, Detection.IMPACT.OVERRIDDEN_NO_EFFECT);
});

test('equipment, labor rate and labor hours changes retain their semantic fields', () => {
    const { item } = linked({ id: 2, revision: 1, item_type: 'equipment', unit_cost: 100,
        labor_hours: 0.25, labor_rate: 45 });
    const result = Detection.compareCatalogItem(item, dto({ id: 2, revision: 2, item_type: 'equipment',
        unit_cost: 125, labor_hours: 0.3, labor_rate: 50 }));
    assert.deepEqual(result.changes.filter(row => row.field.startsWith('pricing.')).map(row => row.field).sort(), [
        'pricing.equipmentUnitCost', 'pricing.laborHoursPerUnit', 'pricing.laborRate'
    ]);
});

test('UOM change is structural even when revision is unchanged', () => {
    const { item } = linked({ id: 3, revision: 'v1', item_type: 'part', unit_cost: 2, uom: 'ea' });
    const result = Detection.compareCatalogItem(item, dto({ id: 3, revision: 'v1', item_type: 'part', unit_cost: 2, uom: 'ft' }));
    assert.equal(result.status, Detection.STATUS.OUTDATED);
    assert.equal(result.changes.find(row => row.field === 'uom').impact, Detection.IMPACT.STRUCTURAL_CHANGE);
    assert.ok(result.warnings.includes('CONTENT_MISMATCH_AT_SAME_REVISION'));
});

test('assembly detects component additions, removals and quantity changes structurally', () => {
    const original = dto({ id: 10, revision: 1, item_type: 'assembly', assemblyComponents: [
        { id: 'a', catalogItemId: 20, quantity: 2 }, { id: 'b', catalogItemId: 21, quantity: 1 }
    ] });
    const item = { overrides: Snapshot.emptyOverrides() };
    Snapshot.attachCatalogSnapshot(item, original);
    const current = dto({ id: 10, revision: 2, item_type: 'assembly', assemblyComponents: [
        { id: 'a', catalogItemId: 20, quantity: 3 }, { id: 'c', catalogItemId: 22, quantity: 1 }
    ] });
    const result = Detection.compareCatalogItem(item, current);
    const assembly = result.changes.find(row => row.field === 'assemblyComponents');
    assert.equal(assembly.impact, Detection.IMPACT.STRUCTURAL_CHANGE);
    assert.ok(assembly.componentChanges.some(row => row.change === 'ADDED'));
    assert.ok(assembly.componentChanges.some(row => row.change === 'REMOVED'));
    assert.ok(assembly.componentChanges.some(row => row.change === 'CHANGED' && row.field === 'quantity'));
});

test('legacy assembly fallback identity reports ratio changes explicitly', () => {
    const changes = Detection.compareAssemblyComponents(
        [{ catalogItemId: 20, quantity: 1, ratioType: 'per_unit' }],
        [{ catalogItemId: 20, quantity: 1, ratioType: 'fixed' }]
    );
    assert.equal(changes.length, 1);
    assert.equal(changes[0].change, 'CHANGED');
    assert.equal(changes[0].field, 'ratioType');
});

test('missing, legacy and unversioned states remain explicit', () => {
    const { item } = linked({ id: 4, revision: 1, item_type: 'part', unit_cost: 1 });
    assert.equal(Detection.compareCatalogItem(item, null).status, Detection.STATUS.MISSING_IN_CATALOG);
    assert.equal(Detection.compareCatalogItem({ catalogItemId: 4, catalogSnapshot: null },
        dto({ id: 4, revision: 2, item_type: 'part' })).status, Detection.STATUS.LEGACY_NO_SNAPSHOT);
    const unversioned = Detection.compareCatalogItem(item, dto({ id: 4, item_type: 'part', unit_cost: 2 }));
    assert.equal(unversioned.status, Detection.STATUS.UNVERSIONED);
    assert.equal(unversioned.outdated, true);
});

test('estimate summary counts current, outdated, missing and legacy items exactly', () => {
    const catalog = new Map();
    const items = [];
    for (let id = 1; id <= 2; id += 1) {
        const pair = linked({ id, revision: 1, item_type: 'part', unit_cost: id });
        items.push(pair.item); catalog.set(String(id), pair.current);
    }
    for (let id = 3; id <= 5; id += 1) {
        const pair = linked({ id, revision: 1, item_type: 'part', unit_cost: id });
        items.push(pair.item); catalog.set(String(id), dto({ id, revision: 2, item_type: 'part', unit_cost: id + 1 }));
    }
    const missing = linked({ id: 6, revision: 1, item_type: 'part', unit_cost: 6 }).item;
    items.push(missing);
    items.push({ catalogItemId: 7, catalogSnapshot: null, unitMaterialCost: 7 });
    catalog.set('7', dto({ id: 7, revision: 2, item_type: 'part', unit_cost: 8 }));
    const result = Detection.compareEstimate({ groups: [{ items }] }, catalog);
    assert.equal(result.totalItems, 7);
    assert.equal(result.linkedItems, 7);
    assert.equal(result.currentItems, 2);
    assert.equal(result.outdatedItems, 3);
    assert.equal(result.missingItems, 1);
    assert.equal(result.legacyItems, 1);
});

test('comparison is mutation-safe for item, snapshot, overrides and current DTO', () => {
    const { item } = linked({ id: 9, revision: 1, item_type: 'part', unit_cost: 10 });
    Snapshot.setCatalogOverride(item, 'materialUnitCost', 9);
    const current = dto({ id: 9, revision: 2, item_type: 'part', unit_cost: 12 });
    const beforeItem = JSON.stringify(item);
    const beforeCurrent = JSON.stringify(current);
    Detection.compareCatalogItem(item, current);
    assert.equal(JSON.stringify(item), beforeItem);
    assert.equal(JSON.stringify(current), beforeCurrent);
});
