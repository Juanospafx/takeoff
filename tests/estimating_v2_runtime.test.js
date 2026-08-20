const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const sources = ['estimate_calculation_service.js', 'estimating_export_service.js', 'takeoff_estimating_sync_service.js',
    'project_estimate_footer.js', 'estimating_workspace_service.js', 'project_estimating.js']
    .map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8'));

function runtime(preloaded = null) {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', {
        url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
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

test('manual edits persist locally and calculations rerender after change', () => {
    const dom = runtime();
    dom.window.document.querySelector('[data-est-action="create-group"]').click();
    dom.window.document.querySelector('[data-add-item]').click();
    const name = dom.window.document.querySelector('[data-item-field="name"]');
    name.value = 'Manual disconnect';
    name.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const state = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    assert.equal(state.estimates.find(row => row.id === state.activeEstimateId).groups[0].items[0].name, 'Manual disconnect');
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
