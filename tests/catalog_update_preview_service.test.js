const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../assets/catalog_item_contract.js');
const Snapshot = require('../assets/estimating_catalog_snapshot_service.js');
const Workspace = require('../assets/estimating_workspace_service.js');
const Adapter = require('../assets/estimating_catalog_adapter.js');
const Calc = require('../assets/estimate_calculation_service.js');
const Preview = require('../assets/catalog_update_preview_service.js');

const dto = raw => Contract.normalizeCatalogItem(raw);
function itemFrom(raw) {
    const current = dto(raw);
    const item = Adapter.catalogItemDtoToEstimatingItem(current, {
        globalLaborRate: raw.labor_rate || 0, workspaceItem: Workspace.item,
        itemsById: raw.itemsById || new Map()
    });
    return { item, current };
}
function estimate(items, settings = {}) {
    return Workspace.estimate({ id: 'e1', groups: [{ id: 'g1', items }], settings: {
        marginMode: 'margin', globalLaborCost: 0, globalLaborMargin: 0,
        taxes: { Materials: 0, Labor: 0, Equipment: 0 }, ...settings
    } }, 1);
}

test('PART price preview uses the real engine and preserves current parity', () => {
    const pair = itemFrom({ id: 1, revision: 1, item_type: 'part', unit_cost: 10 });
    pair.item.quantity = 10;
    const original = estimate([pair.item]);
    const preview = Preview.previewEstimateUpdate(original,
        new Map([['1', dto({ id: 1, revision: 2, item_type: 'part', unit_cost: 12 })]]));
    const direct = Calc.calculateSummary(original.groups, original.settings);
    assert.deepEqual(preview.current.raw, direct);
    assert.equal(preview.current.total, 100);
    assert.equal(preview.projected.total, 120);
    assert.equal(preview.difference.amount, 20);
    assert.equal(preview.categoryImpact.materialDifference.cost, 20);
    assert.equal(preview.projectedEstimate.groups[0].items[0].catalogRevision, 2);
    assert.equal(preview.projectedEstimate.groups[0].items[0].catalogSnapshot.pricing.materialUnitCost, 12);
});

test('project override is preserved and protects the effective total', () => {
    const pair = itemFrom({ id: 1, revision: 1, item_type: 'part', unit_cost: 10 });
    pair.item.quantity = 10;
    Snapshot.setCatalogOverride(pair.item, 'materialUnitCost', 9);
    const preview = Preview.previewEstimateUpdate(estimate([pair.item]),
        [{ ...dto({ id: 1, revision: 2, item_type: 'part', unit_cost: 12 }) }]);
    assert.equal(preview.current.total, 90);
    assert.equal(preview.projected.total, 90);
    assert.equal(preview.difference.amount, 0);
    assert.equal(preview.projectedEstimate.groups[0].items[0].overrides.materialUnitCost, 9);
});

test('Equipment preview updates equipment totals only', () => {
    const pair = itemFrom({ id: 2, revision: 1, item_type: 'equipment', unit_cost: 100 });
    pair.item.quantity = 1;
    pair.item.equipmentQuantity = 2;
    const preview = Preview.previewEstimateUpdate(estimate([pair.item]),
        [dto({ id: 2, revision: 2, item_type: 'equipment', unit_cost: 125 })]);
    assert.equal(preview.current.equipment, 200);
    assert.equal(preview.projected.equipment, 250);
    assert.equal(preview.categoryImpact.equipmentDifference.cost, 50);
    assert.equal(preview.categoryImpact.materialDifference.cost, 0);
});

test('Labor rate and labor hours use the existing calculation engine', () => {
    const pair = itemFrom({ id: 3, revision: 1, item_type: 'labor', labor_hours: 0.25, labor_rate: 45 });
    pair.item.quantity = 4;
    const preview = Preview.previewEstimateUpdate(estimate([pair.item]),
        [dto({ id: 3, revision: 2, item_type: 'labor', labor_hours: 0.3, labor_rate: 50 })]);
    assert.equal(preview.current.labor, 45);
    assert.equal(preview.projected.labor, 60);
    assert.equal(preview.categoryImpact.laborDifference.cost, 15);
});

test('Assembly component quantity change updates only the projected clone', () => {
    const childOld = dto({ id: 20, revision: 1, item_type: 'part', name: 'Part', unit_cost: 10 });
    const oldAssembly = Contract.normalizeCatalogItem({ id: 10, revision: 1, item_type: 'assembly', name: 'Assembly' }, {
        assemblyParts: [{ id: 100, assembly_catalog_item_id: 10, part_catalog_item_id: 20, quantity: 2 }]
    });
    const assembly = Adapter.catalogItemDtoToEstimatingItem(oldAssembly, {
        globalLaborRate: 0, workspaceItem: Workspace.item, itemsById: new Map([['20', childOld]])
    });
    assembly.quantity = 2;
    const currentAssembly = Contract.normalizeCatalogItem({ id: 10, revision: 2, item_type: 'assembly', name: 'Assembly' }, {
        assemblyParts: [{ id: 100, assembly_catalog_item_id: 10, part_catalog_item_id: 20, quantity: 3 }]
    });
    const original = estimate([assembly]);
    const preview = Preview.previewEstimateUpdate(original,
        new Map([['10', currentAssembly], ['20', childOld]]));
    assert.equal(preview.current.total, 40);
    assert.equal(preview.projected.total, 60);
    assert.equal(preview.categoryImpact.assemblyDifference, 20);
    assert.equal(original.groups[0].items[0].children[0].quantity, 2);
    assert.equal(preview.projectedEstimate.groups[0].items[0].children[0].quantity, 3);
});

test('removed Assembly child with an override produces an explicit warning', () => {
    const child = dto({ id: 20, revision: 1, item_type: 'part', unit_cost: 10 });
    const originalDto = Contract.normalizeCatalogItem({ id: 10, revision: 1, item_type: 'assembly' }, {
        assemblyParts: [{ id: 100, assembly_catalog_item_id: 10, part_catalog_item_id: 20, quantity: 1 }]
    });
    const assembly = Adapter.catalogItemDtoToEstimatingItem(originalDto, {
        globalLaborRate: 0, workspaceItem: Workspace.item, itemsById: new Map([['20', child]])
    });
    Snapshot.setCatalogOverride(assembly.children[0], 'materialUnitCost', 8);
    const current = dto({ id: 10, revision: 2, item_type: 'assembly', assemblyComponents: [] });
    const preview = Preview.previewEstimateUpdate(estimate([assembly]), new Map([['10', current], ['20', child]]));
    assert.ok(preview.warnings.some(warning => warning.startsWith('REMOVED_COMPONENT_WITH_OVERRIDE:')));
    assert.equal(preview.projectedEstimate.groups[0].items[0].children.length, 0);
});

test('missing and legacy items stay financially unchanged with warnings', () => {
    const missingPair = itemFrom({ id: 30, revision: 1, item_type: 'part', unit_cost: 10 });
    missingPair.item.quantity = 2;
    const legacy = Workspace.item({ id: 'legacy', catalogItemId: 31, quantity: 3, unitMaterialCost: 5 });
    const original = estimate([missingPair.item, legacy]);
    const preview = Preview.previewEstimateUpdate(original, new Map([['31', dto({ id: 31, revision: 2, item_type: 'part', unit_cost: 8 })]]));
    assert.equal(preview.difference.amount, 0);
    assert.ok(preview.warnings.some(warning => warning.startsWith('MISSING_CATALOG_ITEM_PRESERVED:')));
    assert.ok(preview.warnings.some(warning => warning.startsWith('LEGACY_ITEM_NOT_REFRESHABLE:')));
});

test('mixed estimate returns item and category impacts without mutating any input', () => {
    const currentPair = itemFrom({ id: 1, revision: 1, item_type: 'part', unit_cost: 2 });
    const part = itemFrom({ id: 2, revision: 1, item_type: 'part', unit_cost: 10 }); part.item.quantity = 2;
    const equipment = itemFrom({ id: 3, revision: 1, item_type: 'equipment', unit_cost: 100 }); equipment.item.equipmentQuantity = 1;
    const labor = itemFrom({ id: 4, revision: 1, item_type: 'labor', labor_hours: 1, labor_rate: 20 }); labor.item.quantity = 1;
    const overridden = itemFrom({ id: 5, revision: 1, item_type: 'part', unit_cost: 10 });
    Snapshot.setCatalogOverride(overridden.item, 'materialUnitCost', 7);
    const missing = itemFrom({ id: 6, revision: 1, item_type: 'part', unit_cost: 3 });
    const original = estimate([currentPair.item, part.item, equipment.item, labor.item, overridden.item, missing.item]);
    const catalog = new Map([
        ['1', currentPair.current], ['2', dto({ id: 2, revision: 2, item_type: 'part', unit_cost: 12 })],
        ['3', dto({ id: 3, revision: 2, item_type: 'equipment', unit_cost: 125 })],
        ['4', dto({ id: 4, revision: 2, item_type: 'labor', labor_hours: 1.5, labor_rate: 25 })],
        ['5', dto({ id: 5, revision: 2, item_type: 'part', unit_cost: 15 })]
    ]);
    const beforeEstimate = JSON.stringify(original);
    const beforeCatalog = JSON.stringify([...catalog.entries()]);
    const preview = Preview.previewEstimateUpdate(original, catalog);
    assert.equal(JSON.stringify(original), beforeEstimate);
    assert.equal(JSON.stringify([...catalog.entries()]), beforeCatalog);
    assert.equal(preview.itemImpacts.length, 6);
    assert.equal(preview.changeSet.currentItems, 1);
    assert.equal(preview.changeSet.outdatedItems, 4);
    assert.equal(preview.changeSet.missingItems, 1);
    assert.equal(preview.itemImpacts.find(row => String(row.catalogItemId) === '5').difference, 0);
});

test('applyCatalogChangesToClone also leaves its supplied clone unchanged', () => {
    const pair = itemFrom({ id: 8, revision: 1, item_type: 'part', unit_cost: 10 });
    const input = estimate([pair.item]);
    const before = JSON.stringify(input);
    const index = new Map([['8', dto({ id: 8, revision: 2, item_type: 'part', unit_cost: 12 })]]);
    const changes = require('../assets/catalog_change_detection_service.js').compareEstimate(input, index);
    Preview.applyCatalogChangesToClone(input, changes, index);
    assert.equal(JSON.stringify(input), before);
});
