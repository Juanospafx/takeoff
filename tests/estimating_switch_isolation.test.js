const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const Workspace = require('../assets/estimating_workspace_service.js');
const sources = ['quantity_format_service.js', 'estimate_calculation_service.js', 'project_estimate_footer.js',
    'takeoff_estimating_sync_service.js', 'estimating_workspace_service.js', 'project_estimating_modals.js',
    'project_estimating.js']
    .map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8'));

test('persisted and temporary estimates switch without sharing groups, notes, or active flags', () => {
    const state = Workspace.workspace({ activeEstimateId: 'persisted', estimates: [
        { id: 'persisted', dbEstimateId: 81, name: 'Persisted', groups: [{ id: 'p', items: [{ id: 'pi', name: 'Persisted item' }] }], notes: { scope: 'Persisted scope' }, settings: { taxes: { Materials: 5 } } },
        { id: 'temporary', name: 'Temporary', groups: [{ id: 't', items: [{ id: 'ti', name: 'Temporary item' }] }], notes: { scope: 'Temporary scope' }, settings: { taxes: { Materials: 9 } } }
    ] }, 42);
    const temporary = Workspace.selectEstimate(state, 'temporary');
    assert.equal(state.groups, temporary.groups);
    assert.deepEqual(state.estimates.map(row => row.isActive), [false, true]);
    temporary.groups[0].items[0].name = 'Edited temporary item';
    temporary.notes.scope = 'Edited temporary scope';
    assert.equal(state.estimates[0].groups[0].items[0].name, 'Persisted item');
    assert.equal(state.estimates[0].notes.scope, 'Persisted scope');
    Workspace.selectEstimate(state, 'persisted');
    assert.equal(state.groups[0].items[0].name, 'Persisted item');
    assert.equal(state.estimates[1].groups[0].items[0].name, 'Edited temporary item');
});

test('estimate selection intent is handled by the sole Estimating workspace owner', async () => {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', {
        url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
    dom.window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify({ activeEstimateId: 'one', estimates: [
        { id: 'one', name: 'One', groups: [{ id: 'g1', items: [{ id: 'i1', name: 'One item' }] }] },
        { id: 'two', name: 'Two', groups: [{ id: 'g2', items: [{ id: 'i2', name: 'Old two item' }] }] }
    ] }));
    sources.forEach(source => dom.window.eval(source));

    dom.window.dispatchEvent(new dom.window.CustomEvent('takeoff:active-estimate-changed', {
        detail: { projectId: '', estimateId: 'two' }
    }));
    await new Promise(resolve => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)));
    await Promise.resolve();

    const saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    assert.equal(saved.activeEstimateId, 'two');
    assert.equal(saved.estimates.find(row => row.id === 'two').groups[0].items[0].name, 'Old two item');
    assert.equal(saved.estimates.find(row => row.id === 'one').groups[0].items[0].name, 'One item');
    assert.deepEqual(saved.estimates.map(row => row.isActive), [false, true]);
    assert.equal(dom.window.document.querySelector('[data-item-id="i2"] .est-item-title')?.textContent, 'Old two item');
    dom.window.close();
});

test('New Estimate saves immediately and survives a remote load response already in flight', async () => {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="42"></div>', {
        url: 'https://takeoff.test/project/42', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 42, estimateItems: [], projectMeta: {} };
    let releaseLoad;
    const loadGate = new Promise(resolve => { releaseLoad = resolve; });
    const posts = [];
    dom.window.fetch = async (_url, options = {}) => {
        if (!options.method || options.method === 'GET') {
            await loadGate;
            return { ok: true, status: 200, json: async () => ({ success: true, state: { clientUiUpdatedAt: '2099-01-01T00:00:00.000Z', activeEstimateId: 'remote', estimates: [{ id: 'remote', name: 'Remote', groups: [] }] } }) };
        }
        const payload = JSON.parse(options.body);
        posts.push(payload);
        return { ok: true, status: 200, json: async () => ({ success: true, state: payload.state }) };
    };
    sources.forEach(source => dom.window.eval(source));
    dom.window.dispatchEvent(new dom.window.CustomEvent('takeoff:estimating-action-requested', { detail: { action: 'new-estimate' } }));
    const portal = dom.window.document.querySelector('[data-estimating-modal-portal]');
    portal.querySelector('#copyEstimateName').value = 'Local during load';
    portal.querySelector('[data-create-estimate]').click();
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
    assert.equal(posts.length, 1, 'creation must POST without waiting for the debounce timer');
    releaseLoad();
    await new Promise(resolve => dom.window.setTimeout(resolve, 30));
    const stored = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.42'));
    assert.ok(stored.estimates.some(row => row.name === 'Local during load'));
    assert.ok(posts.at(-1).state.estimates.some(row => row.name === 'Local during load'));
    dom.window.close();
});

test('switching paints the loader first and conceals chunked rows until the latest estimate finishes rendering', async () => {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', {
        url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
    });
    try {
        const { window } = dom;
        const frames = [];
        window.requestAnimationFrame = callback => frames.push(callback);
        const advanceFrame = async () => frames.splice(0).forEach(callback => callback());
        const estimate = (id, count) => ({
            id, name: id,
            groups: [{ id: `${id}-group`, items: Array.from({ length: count }, (_, index) => ({
                id: `${id}-${index}`, name: `${id} item ${index}`
            })) }]
        });
        window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
        window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify({
            activeEstimateId: 'first', estimates: [estimate('first', 1), estimate('second', 180), estimate('third', 180)]
        }));
        sources.forEach(source => window.eval(source));
        const select = estimateId => window.dispatchEvent(new window.CustomEvent('takeoff:active-estimate-changed', {
            detail: { estimateId }
        }));
        const getItem = id => window.document.querySelector(`[data-item-id="${id}"]`);
        select('second');
        const overlay = window.document.getElementById('estLoadingOverlay');
        const main = overlay.parentElement;
        assert.equal(overlay.hidden, false);
        assert.ok(main.classList.contains('is-switching-estimate'));
        assert.equal(getItem('second-0'), null);
        assert.equal(getItem('second-179'), null);

        await advanceFrame();
        select('third');
        while (frames.length && !getItem('third-179')) {
            await advanceFrame();
            assert.equal(overlay.hidden, false);
        }
        assert.ok(getItem('third-179'));
        assert.equal(getItem('second-179'), null);
        await advanceFrame();
        await advanceFrame();
        assert.equal(overlay.hidden, true);
        assert.equal(main.classList.contains('is-switching-estimate'), false);
    } finally {
        dom.window.close();
    }
});

test('the three-dot copy action opens immediately and uses the chosen source without activating it', () => {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', {
        url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
    });
    try {
        const { window } = dom;
        const key = 'takeoff.estimating.module.draft';
        window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
        window.localStorage.setItem(key, JSON.stringify({ activeEstimateId: 'one', estimates: [
            { id: 'one', name: 'One', groups: [] },
            { id: 'two', name: 'Two', notes: { scope: 'Source scope' }, groups: [
                { id: 'g2', items: [{ id: 'i2', name: 'Source item', quantity: 7 }] }
            ] }
        ] }));
        sources.forEach(source => window.eval(source));
        const events = [];
        const cloneSources = [];
        window.cloneTakeoffWorkspaceForEstimate = sourceId => { cloneSources.push(sourceId); };
        window.addEventListener('takeoff:active-estimate-changed', event => events.push(event.detail.estimateId));
        window.dispatchEvent(new window.CustomEvent('takeoff:estimating-estimate-action-requested', {
            detail: { action: 'copy', estimateId: 'two' }
        }));
        const name = window.document.getElementById('copyEstimateName');
        assert.equal(name.value, 'Two Copy');
        assert.equal(JSON.parse(window.localStorage.getItem(key)).activeEstimateId, 'one');
        assert.deepEqual(events, []);
        name.value = 'My copy';
        window.dispatchEvent(new window.StorageEvent('storage', {
            key, newValue: window.localStorage.getItem(key)
        }));
        assert.equal(window.document.getElementById('copyEstimateName'), name);
        window.document.querySelector('[data-create-estimate]').click();
        const saved = JSON.parse(window.localStorage.getItem(key));
        const copy = saved.estimates.find(estimate => estimate.id === saved.activeEstimateId);
        assert.equal(copy.name, 'My copy');
        assert.deepEqual(cloneSources, ['two']);
        assert.equal(copy.groups[0].items[0].quantity, 7);
        assert.notEqual(copy.groups[0].items[0].id, 'i2');
        assert.equal(copy.notes.scope, 'Source scope');
        assert.deepEqual(events, [copy.id]);
    } finally {
        dom.window.close();
    }
});
