const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../assets/catalog_item_contract.js');
const Workspace = require('../assets/estimating_workspace_service.js');
const Adapter = require('../assets/estimating_catalog_adapter.js');
const Calc = require('../assets/estimate_calculation_service.js');
const fs = require('node:fs');
const path = require('node:path');

function convert(raw, options = {}) {
    const dto = Contract.normalizeCatalogItem(raw, options.contract);
    return Adapter.catalogItemDtoToEstimatingItem(dto, {
        globalLaborRate: options.globalLaborRate ?? 85,
        itemsById: options.itemsById || new Map(),
        workspaceItem: Workspace.item
    });
}

test('PART preserves material cost, hours and existing total semantics', () => {
    const item = convert({ item_type: 'part', unit_cost: 5, labor_hours: 0.2 });
    assert.equal(item.unitMaterialCost, 5);
    assert.equal(item.unitLabor, 0.2);
    assert.equal(item.laborUnitType, 'hrs');
    assert.equal(item.costCategory, 'Materials');
    item.quantity = 2;
    assert.equal(Calc.calculateItem(item).materialCost, 10);
});

test('EQUIPMENT maps only to equipment pricing and retains identity', () => {
    const item = convert({ item_type: 'equipment', unit_cost: 100 });
    assert.equal(item.itemType, 'equipment');
    assert.equal(item.costCategory, 'Equipment');
    assert.equal(item.unitEquipmentCost, 100);
    assert.equal(item.unitMaterialCost, 0);
    assert.equal(item.equipmentQuantity, 0);
    item.quantity = 3;
    const calculated = Calc.calculateItem(item);
    assert.equal(calculated.equipmentQuantity, 3);
    assert.equal(calculated.equipmentCost, 300);
    assert.equal(calculated.totalCost, 300);
});

test('ordinary PART, EQUIPMENT and LABOR rows all contribute through the shared quantity', () => {
    const part = convert({ item_type: 'part', unit_cost: 10 });
    const equipment = convert({ item_type: 'equipment', unit_cost: 25 });
    const labor = convert({ item_type: 'labor', labor_rate: 40, labor_hours: 0.5 });
    [part, equipment, labor].forEach(item => { item.quantity = 4; });
    const total = Calc.calculateSummary([{ id: 'normal-items', name: 'Normal items',
        items: [part, equipment, labor] }], {});
    assert.equal(total.byCategory.Materials.materialCost, 40);
    assert.equal(total.byCategory.Equipment.equipmentCost, 100);
    assert.equal(total.byCategory.Labor.laborCost, 80);
    assert.equal(total.direct.totalCost, 220);
});

test('LABOR preserves explicit catalog rate and uses global rate only as fallback', () => {
    const explicit = convert({ item_type: 'labor', labor_rate: 45, labor_hours: 1 }, { globalLaborRate: 90 });
    const fallback = convert({ item_type: 'labor', labor_hours: 1 }, { globalLaborRate: 90 });
    assert.equal(explicit.costCategory, 'Labor');
    assert.equal(explicit.laborRate, 45);
    assert.equal(fallback.laborRate, 90);
});

test('ASSEMBLY children retain per-parent quantities and current roll-up behavior', () => {
    const child = Contract.normalizeCatalogItem({ id: 2, item_type: 'part', name: 'Conduit', unit_cost: 5, labor_hours: 0.2 });
    const item = convert({ id: 1, item_type: 'assembly', name: 'Rack', unit_cost: 10 }, {
        contract: { assemblyParts: [{ id: 3, assembly_catalog_item_id: 1, part_catalog_item_id: 2, quantity: 3 }] },
        itemsById: new Map([['2', child]])
    });
    assert.equal(item.isAssembly, true);
    assert.equal(item.costCategory, 'Assembly');
    assert.equal(item.children.length, 1);
    assert.equal(item.children[0].quantity, 3);
    assert.equal(item.childrenQuantitiesExtended, false);
    item.quantity = 2;
    assert.equal(Calc.calculateItem(item).materialCost, 30);
});

test('OTHER is never silently classified as Materials', () => {
    const item = convert({ item_type: 'future_type', name: 'Future cost' });
    assert.equal(item.itemType, 'other');
    assert.equal(item.costCategory, 'Other');
});

test('Estimating Add Item consumes CatalogService DTOs with the required load order', () => {
    const root = path.resolve(__dirname, '..');
    const page = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
    const client = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
    const names = ['catalog_item_contract.js', 'catalog_service.js', 'estimating_workspace_service.js',
        'estimating_catalog_adapter.js', 'project_estimating.js'];
    names.slice(1).forEach((name, index) => assert.ok(page.indexOf(names[index]) < page.indexOf(name)));
    const boundary = client.slice(client.indexOf('function renderCatalogChoices'), client.indexOf('async function exportEstimate'));
    assert.match(boundary, /CatalogService\.getSnapshot\(\{ enabledForProjectsOnly: true \}\)/);
    assert.match(boundary, /EstimatingCatalogAdapter\.catalogItemDtoToEstimatingItem/);
    assert.doesNotMatch(boundary, /fetch\([^)]*cost_catalog\.php/);
    assert.doesNotMatch(boundary, /normalizeCatalogItem\(/);
    assert.doesNotMatch(boundary, /catalog\.(?:unit_cost|item_type|labor_hours|labor_rate|equipment_cost)\b/);
});
