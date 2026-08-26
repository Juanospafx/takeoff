const test = require('node:test');
const assert = require('node:assert/strict');
const Adapter = require('../assets/takeoff_catalog_adapter.js');
const Contract = require('../assets/catalog_item_contract.js');
const fs = require('node:fs');
const path = require('node:path');

test('PART crosses the boundary with material cost, labor and type intact', () => {
    const dto = Contract.normalizeCatalogItem({ id: 1, item_type: 'part', unit_cost: 12.5, labor_hours: 0.25 });
    const legacy = Adapter.catalogItemDtoToLegacyLayerMeta(dto);
    assert.equal(dto.type, 'PART');
    assert.equal(legacy.unitCost, 12.5);
    assert.equal(legacy.laborHours, 0.25);
    assert.equal(legacy.itemType, 'PART');
});

test('legacy material is normalized to PART', () => {
    const dto = Contract.normalizeCatalogItem({ item_type: 'material', unit_cost: 4 });
    assert.equal(dto.type, 'PART');
    assert.equal(Adapter.catalogItemDtoToLegacyLayerMeta(dto).itemType, 'PART');
});

test('EQUIPMENT retains its semantic identity and canonical cost bucket', () => {
    const dto = Contract.normalizeCatalogItem({ id: 2, item_type: 'equipment', unit_cost: 100 });
    const legacy = Adapter.catalogItemDtoToLegacyLayerMeta(dto);
    assert.equal(dto.pricing.equipmentUnitCost, 100);
    assert.equal(dto.pricing.materialUnitCost, 0);
    assert.equal(legacy.itemType, 'EQUIPMENT');
    assert.equal(legacy.equipmentUnitCost, 100);
    assert.equal(legacy.catalogMetadata.type, 'EQUIPMENT');
});

test('LABOR keeps rate and never becomes material', () => {
    const dto = Contract.normalizeCatalogItem({ item_type: 'labor', labor_rate: 45, labor_hours: 1.5 });
    const legacy = Adapter.catalogItemDtoToLegacyLayerMeta(dto);
    assert.equal(dto.type, 'LABOR');
    assert.equal(legacy.laborRate, 45);
    assert.equal(legacy.laborHours, 1.5);
    assert.equal(legacy.costCategory, 'labor');
});

test('ASSEMBLY keeps components through selection boundary', () => {
    const dto = Contract.normalizeCatalogItem({ id: 9, item_type: 'assembly', unit_cost: 20 }, { assemblyParts: [
        { id: 3, assembly_catalog_item_id: 9, part_catalog_item_id: 4, quantity: 2 }
    ] });
    const legacy = Adapter.catalogItemDtoToLegacyLayerMeta(dto);
    assert.equal(dto.type, 'ASSEMBLY');
    assert.equal(dto.assemblyComponents.length, 1);
    assert.equal(legacy.catalogMetadata.assemblyComponents.length, 1);
    assert.equal(legacy.unitCost, 20);
});

test('canonical measurement type wins and UoM fallback remains available', () => {
    const canonical = Contract.normalizeCatalogItem({ item_type: 'part', unit_of_measure: 'ea', measurement_type: 'linear' });
    const fallback = Contract.normalizeCatalogItem({ item_type: 'part', unit_of_measure: 'ft' });
    assert.equal(Adapter.measurementType(canonical, 'Count'), 'Linear');
    assert.equal(Adapter.measurementType(fallback, 'Linear'), 'Linear');
});

test('Browse Catalog loads the contract before Takeoff and consumes canonical fields', () => {
    const root = path.resolve(__dirname, '..');
    const page = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
    const takeoff = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
    assert.ok(page.indexOf('catalog_item_contract.js') < page.indexOf('catalog_service.js'));
    assert.ok(page.indexOf('catalog_service.js') < page.indexOf('takeoff_catalog_adapter.js'));
    assert.ok(page.indexOf('takeoff_catalog_adapter.js') < page.indexOf('project_takeoff.js'));
    const boundary = takeoff.slice(takeoff.indexOf('function catalogItemMeta'), takeoff.indexOf('function createTakeoffGroup'));
    assert.doesNotMatch(boundary, /item\.(?:unit_cost|labor_hours|item_type|cost_type|catalog_group_id|unit_of_measure|group_name|catalog_name)\b/);
    assert.match(boundary, /CatalogService\.getSnapshot\(\)/);
    assert.doesNotMatch(boundary, /fetch\([^)]*cost_catalog\.php/);
    assert.doesNotMatch(boundary, /normalizeCatalogItem\(/);
});
