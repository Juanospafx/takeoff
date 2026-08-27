const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../assets/catalog_item_contract.js');
const Snapshot = require('../assets/estimating_catalog_snapshot_service.js');
const Workspace = require('../assets/estimating_workspace_service.js');
const Adapter = require('../assets/estimating_catalog_adapter.js');
const TakeoffSync = require('../assets/takeoff_estimating_sync_service.js');

const dto = raw => Contract.normalizeCatalogItem(raw);
const itemFrom = (raw, options = {}) => Adapter.catalogItemDtoToEstimatingItem(dto(raw), {
    globalLaborRate: options.globalLaborRate ?? 85,
    itemsById: options.itemsById || new Map(),
    workspaceItem: Workspace.item
});

test('catalog PART snapshot, override and clear preserve the original catalog value', () => {
    const source = dto({ id: 7, revision: 7, item_type: 'part', unit_cost: 10 });
    const item = Adapter.catalogItemDtoToEstimatingItem(source, { globalLaborRate: 85, workspaceItem: Workspace.item });
    assert.equal(item.catalogRevision, 7);
    assert.equal(item.catalogSnapshot.pricing.materialUnitCost, 10);
    assert.equal(item.overrides.materialUnitCost, null);
    assert.equal(Snapshot.effectiveMaterialUnitCost(item), 10);
    Snapshot.setCatalogOverride(item, 'materialUnitCost', 9);
    assert.equal(item.catalogSnapshot.pricing.materialUnitCost, 10);
    assert.equal(item.overrides.materialUnitCost, 9);
    assert.equal(item.unitMaterialCost, 9);
    Snapshot.clearCatalogOverride(item, 'materialUnitCost');
    assert.equal(item.overrides.materialUnitCost, null);
    assert.equal(item.unitMaterialCost, 10);
    item.catalogSnapshot.pricing.materialUnitCost = 99;
    assert.equal(source.pricing.materialUnitCost, 10);
});

test('equipment, labor hours and labor rate use typed canonical buckets', () => {
    const equipment = itemFrom({ id: 8, revision: 2, item_type: 'equipment', unit_cost: 100, labor_hours: 0.25, labor_rate: 45 });
    assert.equal(equipment.catalogSnapshot.pricing.equipmentUnitCost, 100);
    assert.equal(equipment.unitEquipmentCost, 100);
    assert.equal(equipment.unitMaterialCost, 0);
    Snapshot.setCatalogOverride(equipment, 'equipmentUnitCost', 90);
    Snapshot.setCatalogOverride(equipment, 'laborHoursPerUnit', 0.2);
    Snapshot.setCatalogOverride(equipment, 'laborRate', 50);
    assert.equal(equipment.unitEquipmentCost, 90);
    assert.equal(equipment.unitLabor, 0.2);
    assert.equal(equipment.laborRate, 50);
    assert.equal(equipment.catalogSnapshot.pricing.laborHoursPerUnit, 0.25);
    assert.equal(equipment.catalogSnapshot.pricing.laborRate, 45);
});

test('assembly and identifiable children retain independent canonical snapshots', () => {
    const childDto = dto({ id: 2, revision: 4, item_type: 'part', name: 'Conduit', unit_cost: 5 });
    const assemblyDto = Contract.normalizeCatalogItem({ id: 1, revision: 9, item_type: 'assembly', name: 'Rack' }, {
        assemblyParts: [{ assembly_catalog_item_id: 1, part_catalog_item_id: 2, quantity: 3 }]
    });
    const item = Adapter.catalogItemDtoToEstimatingItem(assemblyDto, {
        globalLaborRate: 85, itemsById: new Map([['2', childDto]]), workspaceItem: Workspace.item
    });
    assert.equal(item.catalogRevision, 9);
    assert.equal(item.catalogSnapshot.assemblyComponents.length, 1);
    assert.equal(item.children[0].catalogRevision, 4);
    assert.equal(String(item.children[0].catalogSnapshot.catalogItemId), '2');
    item.children[0].catalogSnapshot.pricing.materialUnitCost = 20;
    assert.equal(item.catalogSnapshot.assemblyComponents[0].pricingSnapshot.materialUnitCost, 0);
});

test('manual and historical legacy items remain legacy-authoritative', () => {
    const manual = Workspace.item({ unitMaterialCost: 12, unitLabor: 0.5, laborRate: 40 });
    assert.equal(manual.catalogItemId, null);
    assert.equal(manual.catalogRevision, null);
    assert.equal(manual.catalogSnapshot, null);
    assert.equal(Snapshot.effectiveMaterialUnitCost(manual), 12);
    assert.equal(Snapshot.effectiveLaborHoursPerUnit(manual), 0.5);
});

test('canonical snapshot and override survive workspace save/reload', () => {
    const item = itemFrom({ id: 12, revision: 8, item_type: 'part', unit_cost: 12 });
    Snapshot.setCatalogOverride(item, 'materialUnitCost', 11);
    const saved = Workspace.workspace({ projectId: 42, estimates: [{ id: 'e1', groups: [{ id: 'g1', items: [item] }] }] });
    const restored = Workspace.workspace(JSON.parse(JSON.stringify(saved))).estimates[0].groups[0].items[0];
    assert.equal(restored.catalogRevision, 8);
    assert.equal(restored.catalogSnapshot.pricing.materialUnitCost, 12);
    assert.equal(restored.overrides.materialUnitCost, 11);
    assert.equal(restored.unitMaterialCost, 11);
});

test('Takeoff catalogMetadata restores snapshot and preserves project overrides', () => {
    const previous = itemFrom({ id: 20, revision: 3, item_type: 'part', unit_cost: 10 });
    Snapshot.setCatalogOverride(previous, 'materialUnitCost', 9);
    const item = TakeoffSync.takeoffItem({ id: 'l1', quantity: 4, catalogMetadata: {
        schema: 'CatalogItemDTO/v1', catalogItemId: 20, catalogRevision: 3, type: 'PART',
        costCategory: 'MATERIAL', pricing: { materialUnitCost: 10, laborHoursPerUnit: 0.1, laborRate: 45 },
        assemblyComponents: []
    } }, { id: 'g1', name: 'Group' }, previous);
    assert.equal(item.catalogRevision, 3);
    assert.equal(item.catalogSnapshot.pricing.materialUnitCost, 10);
    assert.equal(item.overrides.materialUnitCost, 9);
    assert.equal(item.unitMaterialCost, 9);
    assert.equal(item.quantity, 4);
});
