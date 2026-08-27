const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Contract = require('../assets/catalog_item_contract.js');
const Adapter = require('../assets/boq_catalog_adapter.js');
const Exporter = require('../assets/estimating_export_service.js');

function dto(raw) {
    return Contract.normalizeCatalogItem(raw);
}

test('PART maps canonical material pricing and catalog identity into BOQ', () => {
    const item = Adapter.catalogItemDtoToBoqItem(dto({ id: 1, item_type: 'part', name: 'Conduit',
        description: 'EMT', unit_of_measure: 'ft', unit_cost: 5, manufacturer: 'Maker',
        catalog_number: 'EMT-1', cost_code: '26-05', catalog_name: 'Electrical', group_name: 'Raceway' }));
    assert.equal(item.type, 'PART');
    assert.equal(item.costCategory, 'material');
    assert.equal(item.unitMaterialCost, 5);
    assert.equal(item.catalogItemId, '1');
    assert.equal(item.manufacturer, 'Maker');
    assert.equal(item.catalogNumber, 'EMT-1');
    assert.equal(item.catalogPath, 'Electrical / Raceway');
});

test('EQUIPMENT preserves equipment semantics and is never mapped to Material', () => {
    const item = Adapter.catalogItemDtoToBoqItem(dto({ id: 2, item_type: 'equipment', unit_cost: 100 }));
    assert.equal(item.type, 'EQUIPMENT');
    assert.equal(item.costCategory, 'equipment');
    assert.equal(item.unitEquipmentCost, 100);
    assert.equal(Object.hasOwn(item, 'unitMaterialCost'), false);
});

test('LABOR uses canonical rate and hours without inferring type from UOM', () => {
    const item = Adapter.catalogItemDtoToBoqItem(dto({ id: 3, item_type: 'labor', unit_of_measure: 'ea',
        labor_rate: 45, labor_hours: 0.5 }));
    assert.equal(item.type, 'LABOR');
    assert.equal(item.costCategory, 'labor');
    assert.equal(item.laborRate, 45);
    assert.equal(item.unitLabor, 0.5);
    assert.equal(item.laborUnitType, 'hrs');
});

test('ASSEMBLY expands canonical assemblyComponents at the existing quantity rule', () => {
    const child = dto({ id: 11, item_type: 'part', name: 'Bracket', unit_cost: 5 });
    const assembly = dto({ id: 10, item_type: 'assembly', name: 'Assembly', assemblyComponents: [
        { id: 'component-1', catalogItemId: 11, quantity: 2 }
    ] });
    const hydrated = Adapter.hydrateEstimate({ groups: [{ name: 'G', items: [
        { id: 'estimate-assembly', catalogItemId: 10, itemType: 'assembly', isAssembly: true, quantity: 10 }
    ] }] }, { items: [assembly, child] });
    const rows = Exporter.flatRows(hydrated);
    assert.equal(hydrated.groups[0].items[0].children[0].assemblyComponent.catalogItemId, '11');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Quantity, 20);
    assert.equal(rows[0]['Unit Material Cost'], 5);
});

test('OTHER remains Other when an assembly component cannot be enriched', () => {
    const component = Adapter.assemblyComponentDtoToBoqLine({ catalogItemId: 999, quantity: 2,
        pricingSnapshot: { materialUnitCost: 4 } }, { itemsById: new Map() });
    assert.equal(component.type, 'OTHER');
    assert.equal(component.costCategory, 'other');
});

test('canonical BOQ boundary has no fetch, raw assembly parts, or direct normalization', () => {
    const root = path.join(__dirname, '..');
    const adapter = fs.readFileSync(path.join(root, 'assets', 'boq_catalog_adapter.js'), 'utf8');
    const consumer = fs.readFileSync(path.join(root, 'assets', 'project_estimating.js'), 'utf8');
    const dashboard = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');
    const exportStart = consumer.indexOf('async function exportEstimate');
    const exportEnd = consumer.indexOf("root.addEventListener('input'", exportStart);
    const exportFlow = consumer.slice(exportStart, exportEnd);
    assert.doesNotMatch(adapter, /fetch\s*\(/);
    assert.doesNotMatch(adapter, /assembly_parts|assemblyParts|unit_cost|labor_hours|normalizeCatalogItem\s*\(/);
    assert.match(exportFlow, /CatalogService\.getSnapshot\(\{ enabledForProjectsOnly: true \}\)/);
    assert.match(exportFlow, /BoqCatalogAdapter\.hydrateEstimate/);
    assert.doesNotMatch(exportFlow, /cost_catalog\.php|fetch\s*\(|normalizeCatalogItem/);
    const contractAt = dashboard.indexOf('catalog_item_contract.js');
    const serviceAt = dashboard.indexOf('catalog_service.js');
    const adapterAt = dashboard.indexOf('boq_catalog_adapter.js');
    const exporterAt = dashboard.indexOf('estimating_export_service.js');
    assert.ok(contractAt < serviceAt && serviceAt < adapterAt && adapterAt < exporterAt);
});

test('canonical hydration retains the existing assembly fixture quantities and costs', () => {
    const part = dto({ id: 51, item_type: 'part', name: 'Catalog Part', unit_of_measure: 'ft',
        unit_cost: 4.25, labor_hours: 0.2, labor_rate: 45 });
    const assembly = dto({ id: 50, item_type: 'assembly', name: 'Catalog Assembly', assemblyComponents: [
        { id: 9, catalogItemId: 51, quantity: 2 }
    ] });
    const hydrated = Adapter.hydrateEstimate({ groups: [{ name: 'G', items: [
        { id: 'estimate-assembly', catalogItemId: 50, isAssembly: true, quantity: 3 }
    ] }] }, { items: [assembly, part] });
    assert.deepEqual(Exporter.flatRows(hydrated), [{
        Group: 'G', Type: 'Part', 'Catalog Item ID': '51', Item: 'Catalog Part', Description: '',
        'Budget Code': '', 'Cost Code': '', Category: 'material', UOM: 'ft', Quantity: 6,
        'Unit Material Cost': 4.25, 'Unit Labor': 0.2, 'Labor Unit': 'hrs', 'Labor Rate': 45, Notes: ''
    }]);
});
