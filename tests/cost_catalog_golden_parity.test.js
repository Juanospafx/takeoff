const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CatalogService = require('../assets/catalog_service.js');
const Expansion = require('../assets/assembly_expansion_service.js');

const golden = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'cost_catalog_contract.golden.json'), 'utf8'
));

const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => structuredClone(golden.api)
});

test('golden API fixture preserves catalog and category availability metadata', async () => {
    const snapshot = await CatalogService.getSnapshot({ fetchImpl });
    assert.deepEqual(snapshot.catalogs.map(({ id, active, enabledForProjects, locked }) =>
        ({ id, active, enabledForProjects, locked })), [
        { id: '1', active: true, enabledForProjects: true, locked: true },
        { id: '2', active: false, enabledForProjects: false, locked: false }
    ]);
    assert.deepEqual(snapshot.categories.map(({ id, parentId, active, enabledForProjects }) =>
        ({ id, parentId, active, enabledForProjects })), [
        { id: '5', parentId: null, active: true, enabledForProjects: true },
        { id: '6', parentId: '5', active: false, enabledForProjects: false }
    ]);
});

test('golden item contract keeps Part, Equipment, Labor, Assembly and revisions in parity', async () => {
    const { items } = await CatalogService.getSnapshot({ fetchImpl });
    assert.deepEqual(items.map(item => item.type), golden.expected.types);
    assert.deepEqual(items.map(item => item.revision), golden.expected.revisions);

    const byId = new Map(items.map(item => [item.id, item]));
    assert.deepEqual(byId.get('10').pricing, {
        materialUnitCost: 5.25, equipmentUnitCost: 0, subcontractorUnitCost: 0,
        laborHoursPerUnit: 0.125, laborRate: 0, legacyUnitCost: 0
    });
    assert.equal(byId.get('20').pricing.equipmentUnitCost, 125.5);
    assert.equal(byId.get('20').pricing.materialUnitCost, 0);
    assert.equal(byId.get('30').pricing.laborRate, 85);
    assert.equal(byId.get('30').pricing.materialUnitCost, 0);
    assert.equal(byId.get('40').assemblyComponents.length, 7);
    assert.equal(byId.get('41').assemblyComponents.length, 1);
});

test('golden nested assembly expands every supported ratio without drift', async () => {
    const { items } = await CatalogService.getSnapshot({ fetchImpl });
    const root = items.find(item => item.id === '40');
    const result = Expansion.expandAssembly(root, 3, {
        catalogIndex: items,
        linearLength: 100,
        area: 40,
        endpointCount: 2
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(Object.fromEntries(result.leaves.map(row => [
        row.catalogItemId, row.effectiveQuantity
    ])), golden.expected.rootLeafQuantities);
    assert.deepEqual(result.leaves.find(row => row.catalogItemId === '14').path, ['40', '41', '14']);
});

test('golden availability filters preserve canonical parity through authoritative modes', async () => {
    assert.equal((await CatalogService.listItems({ fetchImpl, activeOnly: true })).length, golden.api.data.allItems.length);
    assert.equal((await CatalogService.listItems({ fetchImpl, enabledForProjectsOnly: true })).length, golden.api.data.allItems.length);
});
