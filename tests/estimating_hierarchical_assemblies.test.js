const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const sources = [
    'quantity_format_service.js', 'assembly_expansion_service.js', 'estimating_assembly_expansion_adapter.js',
    'estimate_calculation_service.js', 'project_estimate_footer.js', 'takeoff_estimating_sync_service.js',
    'estimating_workspace_service.js', 'project_estimating.js'
].map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8'));

const assemblyState = () => ({ activeEstimateId: 'estimate-a', estimates: [{
    id: 'estimate-a', name: 'Estimate A', groups: [{ id: 'group-a', name: 'Electrical', expanded: true, items: [{
        id: 'assembly-a', itemType: 'assembly', isAssembly: true, name: 'EMT Branch Assembly', uom: 'ft', quantity: 175,
        childrenQuantitiesExtended: false, children: [
            { id: 'conduit', catalogItemId: 11, name: 'EMT Conduit', uom: 'ft', quantity: 1, unitMaterialCost: 2 },
            { id: 'strap', catalogItemId: 12, name: 'One Hole Strap', uom: 'ea', quantity: 0.1, unitMaterialCost: 1 },
            { id: 'connector', catalogItemId: 13, name: 'Connector', uom: 'ea', quantity: 0.02, unitMaterialCost: 3 },
            { id: 'wire', catalogItemId: 14, name: 'THHN Wire', uom: 'ft', quantity: 3.3, unitMaterialCost: 0.5 }
        ]
    }] }] }], settings: {} });

function runtime(state = assemblyState()) {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', {
        url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
    dom.window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify(state));
    sources.forEach(source => dom.window.eval(source));
    return dom;
}

const values = dom => [...dom.window.document.querySelectorAll('[data-assembly-component-row]')]
    .map(row => ({ name: row.children[1].textContent.trim(), quantity: row.children[5].textContent.trim(), uom: row.children[4].textContent.trim() }));

test('assembly chevron expands inline component rows and supports multiple open assemblies', () => {
    const state = assemblyState();
    state.estimates[0].groups[0].items.push({ ...structuredClone(state.estimates[0].groups[0].items[0]), id: 'assembly-b', name: 'Second Assembly' });
    const dom = runtime(state);
    assert.equal(dom.window.document.querySelectorAll('[data-assembly-component-row]').length, 0);
    dom.window.document.querySelector('[data-toggle-assembly="assembly-a"]').click();
    dom.window.document.querySelector('[data-toggle-assembly="assembly-b"]').click();
    assert.equal(dom.window.document.querySelectorAll('[data-assembly-component-row]').length, 8);
    assert.equal(dom.window.document.querySelectorAll('[data-toggle-assembly][aria-expanded="true"]').length, 2);
    dom.window.document.querySelector('[data-toggle-assembly="assembly-a"]').click();
    assert.equal(dom.window.document.querySelectorAll('[data-assembly-component-row]').length, 4);
    dom.window.close();
});

test('component quantities are derived live from parent quantity while ratios stay persisted', () => {
    const dom = runtime();
    dom.window.document.querySelector('[data-toggle-assembly]').click();
    assert.deepEqual(values(dom).map(row => row.quantity), ['175', '17.5', '3.5', '577.5']);
    assert.deepEqual(values(dom).map(row => row.uom), ['ft', 'ea', 'ea', 'ft']);
    const quantity = dom.window.document.querySelector('[data-item-id="assembly-a"] [data-item-field="quantity"]');
    quantity.value = '200';
    quantity.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.deepEqual(values(dom).map(row => row.quantity), ['200', '20', '4', '660']);
    const saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    assert.deepEqual(saved.estimates[0].groups[0].items[0].children.map(child => child.quantity), [1, 0.1, 0.02, 3.3]);
    dom.window.close();
});

test('expanding is UI-only and never changes assembly totals', () => {
    const dom = runtime();
    const before = dom.window.document.getElementById('estimateTotal').textContent;
    dom.window.document.querySelector('[data-toggle-assembly]').click();
    assert.equal(dom.window.document.getElementById('estimateTotal').textContent, before);
    const saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    assert.equal(JSON.stringify(saved).includes('expandedAssemblies'), false);
    dom.window.close();
});

test('removing a component removes only its persisted relation and duplication deep-copies the assembly', () => {
    const dom = runtime();
    dom.window.document.querySelector('[data-toggle-assembly]').click();
    dom.window.document.querySelector('[data-remove-assembly-component="strap"]').click();
    let saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    assert.deepEqual(saved.estimates[0].groups[0].items[0].children.map(child => child.id), ['conduit', 'connector', 'wire']);
    dom.window.document.querySelector('[data-duplicate-item="assembly-a"]').click();
    saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    const [original, duplicate] = saved.estimates[0].groups[0].items;
    assert.notEqual(duplicate.id, original.id);
    assert.equal(duplicate.name, 'EMT Branch Assembly Copy');
    assert.deepEqual(duplicate.children.map(child => child.quantity), original.children.map(child => child.quantity));
    assert.ok(duplicate.children.every((child, index) => child.id !== original.children[index].id));
    duplicate.children[0].quantity = 99;
    assert.equal(original.children[0].quantity, 1);
    dom.window.close();
});

test('zero quantity and empty assemblies render safely', () => {
    const state = assemblyState();
    state.estimates[0].groups[0].items[0].quantity = 0;
    state.estimates[0].groups[0].items.push({ id: 'empty', itemType: 'assembly', isAssembly: true, name: 'Empty', quantity: 1, children: [] });
    const dom = runtime(state);
    dom.window.document.querySelector('[data-toggle-assembly="assembly-a"]').click();
    assert.deepEqual(values(dom).map(row => row.quantity), ['0', '0', '0', '0']);
    dom.window.document.querySelector('[data-toggle-assembly="empty"]').click();
    assert.equal(dom.window.document.querySelectorAll('[data-assembly-component-row]').length, 4);
    dom.window.close();
});
