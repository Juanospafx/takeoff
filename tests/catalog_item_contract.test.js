const assert = require('node:assert/strict');
const test = require('node:test');
const Contract = require('../assets/catalog_item_contract.js');

test('PART maps generic unit cost and labor hours into canonical pricing', () => {
    const item = Contract.normalizeCatalogItem({ item_type: 'part', unit_cost: 5, labor_hours: 0.25 });
    assert.equal(item.type, Contract.ITEM_TYPES.PART);
    assert.equal(item.costCategory, Contract.COST_CATEGORIES.MATERIAL);
    assert.equal(item.pricing.materialUnitCost, 5);
    assert.equal(item.pricing.laborHoursPerUnit, 0.25);
});

test('legacy material normalizes to PART without losing the legacy value', () => {
    const item = Contract.normalizeCatalogItem({ item_type: 'material' });
    assert.equal(item.type, Contract.ITEM_TYPES.PART);
    assert.equal(item.legacy.itemType, 'material');
});

test('EQUIPMENT maps generic unit cost only to equipment pricing', () => {
    const item = Contract.normalizeCatalogItem({ item_type: 'equipment', unit_cost: 100 });
    assert.equal(item.type, Contract.ITEM_TYPES.EQUIPMENT);
    assert.equal(item.costCategory, Contract.COST_CATEGORIES.EQUIPMENT);
    assert.equal(item.pricing.equipmentUnitCost, 100);
    assert.equal(item.pricing.materialUnitCost, 0);
});

test('LABOR retains an explicit labor rate and is not normalized as a part', () => {
    const item = Contract.normalizeCatalogItem({ item_type: 'labor', labor_rate: 45 });
    assert.equal(item.type, Contract.ITEM_TYPES.LABOR);
    assert.equal(item.costCategory, Contract.COST_CATEGORIES.LABOR);
    assert.equal(item.pricing.laborRate, 45);
    assert.equal(item.pricing.materialUnitCost, 0);
});

test('ASSEMBLY always exposes components and normalizes current assembly_parts', () => {
    const empty = Contract.normalizeCatalogItem({ id: 9, item_type: 'assembly' });
    assert.equal(empty.type, Contract.ITEM_TYPES.ASSEMBLY);
    assert.deepEqual(empty.assemblyComponents, []);

    const populated = Contract.normalizeCatalogItem({ id: 9, item_type: 'assembly' }, { assemblyParts: [{
        id: 3, assembly_catalog_item_id: 9, part_catalog_item_id: 12,
        quantity: '2.5', unit_cost_snapshot: '4.25', unit_labor_time_snapshot: '0.125'
    }] });
    assert.deepEqual(populated.assemblyComponents[0], {
        id: '3', catalogItemId: '12', quantity: 2.5, ratioType: 'per_unit', spacing: null, waste: 0,
        pricingSnapshot: { materialUnitCost: 4.25, equipmentUnitCost: 0,
            subcontractorUnitCost: 0, laborHoursPerUnit: 0.125, laborRate: 0 },
        overrides: {}
    });
});

test('snake_case API fields populate nested canonical metadata', () => {
    const item = Contract.fromApi({
        id: 77, revision: 4, item_type: 'part', name: 'Conduit', description: 'EMT', unit_of_measure: 'ft',
        catalog_id: 2, catalog_name: 'Electrical', catalog_group_id: 8, group_name: 'Raceway',
        masterformat: '26 05 33', uniformat: 'D5010', cost_code: '260533', sub_job_code: 'E1', sub_job_name: 'Power',
        manufacturer: 'Maker', supplier: 'Supply Co', catalog_number: 'EMT-1',
        taxable: 0, color: '#2563eb', symbol: 'line', attributes_json: '{"tradeSize":"1 in"}', tags_json: '["emt"]'
    });
    assert.equal(item.id, '77');
    assert.deepEqual(item.catalog, { id: '2', name: 'Electrical' });
    assert.deepEqual(item.category, { id: '8', name: 'Raceway' });
    assert.equal(item.classification.masterformat, '26 05 33');
    assert.equal(item.classification.uniformat, 'D5010');
    assert.equal(item.classification.costCode, '260533');
    assert.equal(item.supplier.supplier, 'Supply Co');
    assert.equal(item.taxable, false);
    assert.deepEqual(item.attributes, { tradeSize: '1 in' });
    assert.deepEqual(item.tags, ['emt']);
});

test('unknown types and categories remain OTHER instead of silently becoming Materials', () => {
    const item = Contract.normalizeCatalogItem({ item_type: 'future_type', cost_type: 'unrecognized' });
    assert.equal(item.type, Contract.ITEM_TYPES.OTHER);
    assert.equal(item.costCategory, Contract.COST_CATEGORIES.OTHER);
    assert.equal(item.pricing.materialUnitCost, 0);
});
