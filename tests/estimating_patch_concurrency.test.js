const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const sources = ['estimate_calculation_service.js', 'project_estimate_footer.js',
    'takeoff_estimating_sync_service.js', 'estimating_workspace_service.js', 'project_estimating.js']
    .map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

function backend() {
    const state = { activeEstimateId: 'one', clientUiUpdatedAt: '2099-01-01T00:00:00.000Z', estimates: [
        { id: 'one', dbEstimateId: 1, revision: 1, name: 'One', groups: [], settings: {}, notes: {} },
        { id: 'two', dbEstimateId: 2, revision: 1, name: 'Two', groups: [], settings: {}, notes: {} }
    ] };
    const posts = [];
    return { state, posts, fetch: async (_url, options = {}) => {
        if (!options.method || options.method === 'GET') return { ok: true, status: 200, json: async () => ({ success: true, state: clone(state) }) };
        const payload = JSON.parse(options.body);
        posts.push(payload);
        const conflict = payload.updates.find(update => {
            const server = state.estimates.find(row => row.id === update.id);
            return server && Number(server.revision) !== Number(update.revision);
        });
        if (conflict) {
            const current = state.estimates.find(row => row.id === conflict.id);
            return { ok: false, status: 409, json: async () => ({ success: false, error: {
                code: 'revision_conflict', message: 'Changed elsewhere', conflicts: [{ id: conflict.id,
                    expectedRevision: conflict.revision, currentRevision: current.revision, current: clone(current) }]
            } }) };
        }
        const saved = payload.updates.map(update => {
            const index = state.estimates.findIndex(row => row.id === update.id);
            const next = { ...clone(update), dbEstimateId: state.estimates[index]?.dbEstimateId || state.estimates.length + 1,
                revision: Number(state.estimates[index]?.revision || 0) + 1 };
            if (index < 0) state.estimates.push(next); else state.estimates[index] = next;
            return clone(next);
        });
        state.activeEstimateId = payload.state.activeEstimateId;
        return { ok: true, status: 200, json: async () => ({ success: true, mode: 'patch', updates: saved, activeEstimateId: state.activeEstimateId }) };
    } };
}

function client(server) {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="42"></div>', {
        url: 'https://takeoff.test/project/42', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 42, estimateItems: [], projectMeta: {} };
    dom.window.fetch = server.fetch;
    sources.forEach(source => dom.window.eval(source));
    return dom;
}

test('two clients patching different estimates do not conflict or overwrite each other', async () => {
    const server = backend();
    const a = client(server);
    const b = client(server);
    await new Promise(resolve => setTimeout(resolve, 30));
    a.window.document.querySelector('[data-est-action="create-group"]').click();
    b.window.document.querySelector('[data-version="two"]').click();
    b.window.document.querySelector('[data-est-action="create-group"]').click();
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.equal(server.posts.length, 2);
    assert.deepEqual(server.posts.map(post => post.updates.map(row => row.id)), [['one'], ['two']]);
    assert.equal(server.state.estimates.find(row => row.id === 'one').groups.length, 1);
    assert.equal(server.state.estimates.find(row => row.id === 'two').groups.length, 1);
    assert.doesNotMatch(a.window.document.querySelector('.est-save-status').textContent, /failed|changed elsewhere/i);
    assert.doesNotMatch(b.window.document.querySelector('.est-save-status').textContent, /failed|changed elsewhere/i);
    a.window.close(); b.window.close();
});

test('same-estimate conflict preserves the losing client draft and structured conflict state', async () => {
    const server = backend();
    const a = client(server);
    const b = client(server);
    await new Promise(resolve => setTimeout(resolve, 30));
    a.window.document.querySelector('[data-est-action="create-group"]').click();
    b.window.document.querySelector('[data-est-action="create-group"]').click();
    await new Promise(resolve => setTimeout(resolve, 650));
    const loser = [a, b].find(dom => /changed elsewhere/i.test(dom.window.document.querySelector('.est-save-status').textContent));
    assert.ok(loser, 'one stale revision must surface a structured conflict');
    const draft = JSON.parse(loser.window.localStorage.getItem('takeoff.estimating.module.42'));
    assert.ok(draft.dirtyEstimateIds.includes('one'));
    assert.equal(draft.estimates.find(row => row.id === 'one').groups.length, 1, 'the unsaved local group must remain intact');
    assert.equal(server.state.estimates.find(row => row.id === 'one').revision, 2);
    a.window.close(); b.window.close();
});
