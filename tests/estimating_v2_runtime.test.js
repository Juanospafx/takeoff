const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const sources = ['estimate_calculation_service.js', 'takeoff_estimating_sync_service.js',
    'project_estimate_footer.js', 'estimating_workspace_service.js', 'project_estimating.js']
    .map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8'));

function runtime() {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', {
        url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
    sources.forEach(source => dom.window.eval(source));
    return dom;
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
