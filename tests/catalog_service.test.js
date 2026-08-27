const test = require('node:test');
const assert = require('node:assert/strict');
const Service = require('../assets/catalog_service.js');

function response(data, options = {}) {
    return {
        ok: options.ok !== false,
        status: options.status || 200,
        json: async () => data
    };
}

function fixture() {
    return { status: 'success', data: {
        catalogs: [{ id: 1, name: 'Electrical', active: 1, enabled_for_projects: 1 }],
        groups: [{ id: 2, catalog_id: 1, name: 'Devices', catalog_name: 'Electrical' }],
        allItems: [
            { id: 10, item_type: 'part', name: 'Part', unit_cost: 5 },
            { id: 11, item_type: 'material', name: 'Legacy', unit_cost: 6 },
            { id: 12, item_type: 'equipment', name: 'Lift', unit_cost: 100 },
            { id: 13, item_type: 'labor', name: 'Electrician', labor_rate: 45 },
            { id: 14, item_type: 'assembly', name: 'Assembly', unit_cost: 20 }
        ],
        assemblyParts: [{ id: 20, assembly_catalog_item_id: 14, part_catalog_item_id: 10, quantity: 2 }]
    } };
}

test('listItems returns only canonical DTOs for every supported catalog type', async () => {
    const items = await Service.listItems({ fetchImpl: async () => response(fixture()) });
    assert.deepEqual(items.map(item => item.type), ['PART', 'PART', 'EQUIPMENT', 'LABOR', 'ASSEMBLY']);
    items.forEach(item => {
        assert.ok(item.pricing);
        assert.equal(Object.hasOwn(item, 'unit_cost'), false);
        assert.equal(Object.hasOwn(item, 'item_type'), false);
    });
    assert.equal(items[2].pricing.equipmentUnitCost, 100);
    assert.equal(items[2].pricing.materialUnitCost, 0);
    assert.equal(items[3].pricing.laborRate, 45);
    assert.equal(items[4].assemblyComponents.length, 1);
});

test('getItem, searchItems and getAssembly preserve the DTO contract', async () => {
    const fetchImpl = async () => response(fixture());
    assert.equal((await Service.getItem(12, { fetchImpl })).type, 'EQUIPMENT');
    assert.deepEqual((await Service.searchItems('legacy', { fetchImpl })).map(item => item.type), ['PART']);
    assert.equal((await Service.getAssembly(14, { fetchImpl })).assemblyComponents[0].quantity, 2);
    await assert.rejects(() => Service.getAssembly(10, { fetchImpl }), error => error.code === 'NOT_AN_ASSEMBLY');
});

test('API and network failures become normalized CatalogServiceError values', async () => {
    await assert.rejects(
        () => Service.listItems({ fetchImpl: async () => response({ status: 'error', msg: 'Denied' }, { ok: false, status: 403 }) }),
        error => error.name === 'CatalogServiceError' && error.code === 'API_ERROR' && error.status === 403
    );
    await assert.rejects(
        () => Service.listItems({ fetchImpl: async () => { throw new Error('offline'); } }),
        error => error.code === 'NETWORK_ERROR' && error.cause?.message === 'offline'
    );
});

test('availability filters map to authoritative API modes', async () => {
    const urls = [];
    const fetchImpl = async url => { urls.push(url); return response(fixture()); };
    await Service.listItems({ activeOnly: true, fetchImpl });
    await Service.listItems({ enabledForProjectsOnly: true, fetchImpl });
    await Service.listItems({ includeDeleted: true, fetchImpl });
    assert.match(urls[0], /availability=active/);
    assert.match(urls[1], /availability=project/);
    assert.match(urls[2], /availability=admin/);
    assert.match(urls[2], /include_deleted=1/);
});
