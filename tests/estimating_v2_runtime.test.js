const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const sources = ['catalog_item_contract.js', 'catalog_service.js', 'estimate_calculation_service.js',
    'estimating_export_service.js', 'takeoff_estimating_sync_service.js', 'project_estimate_footer.js',
    'estimating_workspace_service.js', 'estimating_catalog_adapter.js', 'project_estimating.js']
    .map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8'));

function runtime(preloaded = null) {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', {
        url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
    dom.window.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', data: {
        items: [{ id: 77, name: 'Catalog Disconnect', item_type: 'part', unit_of_measure: 'ea',
            unit_cost: 25, labor_hours: 0.5, cost_code: '26-28-16', group_name: 'Devices', catalog_name: 'Electrical' }],
        allItems: [], assemblyParts: []
    } }) });
    if (preloaded) dom.window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify(preloaded));
    sources.forEach(source => dom.window.eval(source));
    return dom;
}

function takeoffSnapshot(window) {
    window.dispatchEvent(new window.CustomEvent('takeoff:estimating-lines-updated', { detail: {
        projectId: '', authoritative: true, groups: [{ id: 'takeoff_group_g1', takeoffGroupId: 'g1',
            source: 'takeoff', name: 'Lighting', items: [{ id: 'takeoff_l1', takeoffLayerId: 'l1',
                name: 'Fixture', quantity: 12, uom: 'ea', unitMaterialCost: 40 }] }]
    } }));
}

test('authoritative Takeoff event replaces mirrored rows without corrupting layer identity', () => {
    const dom = runtime();
    dom.window.dispatchEvent(new dom.window.CustomEvent('takeoff:estimating-lines-updated', { detail: {
        projectId: '', authoritative: true, groups: [{ id: 'takeoff_group_g1', takeoffGroupId: 'g1',
            source: 'takeoff', name: 'Lighting', items: [{ id: 'takeoff_l1', takeoffLayerId: 'l1',
                name: 'Fixture', quantity: 12, uom: 'ea', unitMaterialCost: 40 }] }]
    } }));
    const state = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    const item = state.estimates.find(row => row.id === state.activeEstimateId).groups[0].items[0];
    assert.equal(item.takeoffLayerId, 'l1');
    assert.equal(item.quantity, 12);
    assert.equal(item.unitMaterialCost, 40);
    assert.equal(dom.window.document.querySelector('[data-item-id="takeoff_l1"]') !== null, true);
    dom.window.close();
});

test('Blank estimate stays empty after Takeoff synchronization and browser reload', () => {
    const first = runtime();
    first.window.dispatchEvent(new first.window.CustomEvent('takeoff:estimating-action-requested', {
        detail: { action: 'new-estimate' }
    }));
    first.window.document.querySelector('[name="copyEstimateMode"][value="blank"]').click();
    first.window.document.querySelector('#copyEstimateName').value = 'Blank Bid';
    first.window.document.querySelector('[data-create-estimate]').click();
    takeoffSnapshot(first.window);
    const saved = JSON.parse(first.window.localStorage.getItem('takeoff.estimating.module.draft'));
    let active = saved.estimates.find(row => row.id === saved.activeEstimateId);
    assert.equal(active.name, 'Blank Bid');
    assert.deepEqual(active.groups, []);
    assert.equal(active.takeoffSyncMode, 'linked-only');
    first.window.close();

    const reloaded = runtime(saved);
    takeoffSnapshot(reloaded.window);
    const afterReload = JSON.parse(reloaded.window.localStorage.getItem('takeoff.estimating.module.draft'));
    active = afterReload.estimates.find(row => row.id === afterReload.activeEstimateId);
    assert.equal(active.name, 'Blank Bid');
    assert.deepEqual(active.groups, [], 'initial Takeoff event after reload must not repopulate Blank');
    reloaded.window.close();
});

test('linked-only estimates update existing Takeoff bindings without importing new rows', () => {
    const dom = runtime({ activeEstimateId: 'alternate', estimates: [{ id: 'alternate', name: 'Alternate',
        takeoffSyncMode: 'linked-only', groups: [{ id: 'g1', name: 'Lighting', items: [
            { id: 'existing', takeoffLayerId: 'l1', name: 'Old fixture', quantity: 1 }
        ] }] }] });
    takeoffSnapshot(dom.window);
    const saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    const items = saved.estimates[0].groups[0].items;
    assert.equal(items.length, 1);
    assert.equal(items[0].takeoffLayerId, 'l1');
    assert.equal(items[0].quantity, 12);
    dom.window.close();
});

test('a versioned estimate-scoped Takeoff snapshot imports a new Part into linked-only', () => {
    const dom = runtime({ activeEstimateId: 'copy', estimates: [{ id: 'copy', name: 'Copy',
        takeoffSyncMode: 'linked-only', groups: [{ id: 'g1', name: 'Electrical', items: [
            { id: 'copper', takeoffLayerId: 'l1', name: 'Copper', quantity: 0 }
        ] }] }] });
    dom.window.dispatchEvent(new dom.window.CustomEvent('takeoff:estimating-lines-updated', { detail: {
        version: 2, projectId: '', activeEstimateId: 'copy', authoritative: true, complete: true,
        groups: [{ id: 'g1', takeoffGroupId: 'tg1', name: 'Electrical', items: [
            { id: 'l1', takeoffLayerId: 'l1', name: 'Copper', quantity: 0 },
            { id: 'l2', takeoffLayerId: 'l2', itemType: 'part', name: 'Duplex Receptacle',
                quantity: 5, unitMaterialCost: 12, uom: 'ea' }
        ] }]
    } }));
    const saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    const items = saved.estimates[0].groups.flatMap(group => group.items);
    assert.equal(items.find(item => item.takeoffLayerId === 'l2')?.quantity, 5);
    assert.ok(dom.window.document.querySelector('[data-item-id="takeoff_l2"]'));
    dom.window.close();
});

test('Add Item opens Cost Catalog and the selected item persists with its catalog identity', async () => {
    const dom = runtime();
    dom.window.document.querySelector('[data-est-action="create-group"]').click();
    dom.window.document.querySelector('[data-add-item]').click();
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
    dom.window.document.querySelector('[data-est-catalog-item="77"]').click();
    const name = dom.window.document.querySelector('[data-item-field="name"]');
    const state = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    const item = state.estimates.find(row => row.id === state.activeEstimateId).groups[0].items[0];
    assert.equal(name.value, 'Catalog Disconnect');
    assert.equal(item.name, 'Catalog Disconnect');
    assert.equal(item.catalogItemId, 77);
    assert.equal(item.costCode, '26-28-16');
    assert.equal(item.unitMaterialCost, 25);
    dom.window.close();
});

test('project notes persist while the user is typing without rerendering the editor', () => {
    const dom = runtime();
    const editor = dom.window.document.querySelector('[data-note-field="projectNotes"]');
    editor.value = 'Coordinate shutdown with the owner.';
    editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(dom.window.document.activeElement === editor || dom.window.document.contains(editor), true);
    const state = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    const estimate = state.estimates.find(row => row.id === state.activeEstimateId);
    assert.equal(estimate.notes.projectNotes, 'Coordinate shutdown with the owner.');
    dom.window.close();
});
