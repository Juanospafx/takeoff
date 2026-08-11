const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const overview = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');
const estimating = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
const calculation = fs.readFileSync(path.join(root, 'assets/estimate_calculation_service.js'), 'utf8');
const footer = fs.readFileSync(path.join(root, 'assets/project_estimate_footer.js'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'assets/estimating_workspace_service.js'), 'utf8');

const draftWorkspace = {
    activeEstimateId: 'draft-estimate',
    estimates: [{
        id: 'draft-estimate', name: 'Draft estimate', status: 'draft', projectId: 0,
        dbEstimateId: 999, estimateItemId: 999, revision: 7,
        updatedAt: '2026-08-11T12:00:00.000Z', groups: [], notes: {}, settings: {}
    }]
};

test('draft save migrates workspace and the reloaded Estimating module performs its first server save', async () => {
    const virtualConsole = new VirtualConsole();
    const draftDom = new JSDOM('<!doctype html><button id="saveProjectBtn">Save</button><input id="poEstimateName" value="Draft project">', {
        url: 'https://takeoff.test/pages/project_dashboard.php?tab=overview', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
    });
    draftDom.window.ProjectState = { projectId: 0, projectInfo: {}, projectMeta: {}, documents: [] };
    draftDom.window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify(draftWorkspace));
    draftDom.window.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'success', id: 42, project_id: 42, project: { id: 42 }, data: { project: { id: 42 } } })
    });
    draftDom.window.eval(overview);
    draftDom.window.document.dispatchEvent(new draftDom.window.Event('DOMContentLoaded'));
    draftDom.window.document.getElementById('saveProjectBtn').click();
    await new Promise(resolve => draftDom.window.setTimeout(resolve, 0));

    const migratedRaw = draftDom.window.localStorage.getItem('takeoff.estimating.module.42');
    assert.ok(migratedRaw, 'new project key must exist before redirect');
    assert.equal(draftDom.window.localStorage.getItem('takeoff.estimating.module.draft'), null);
    const migrated = JSON.parse(migratedRaw);
    assert.equal(migrated.estimates[0].projectId, 42);
    assert.equal(migrated.estimates[0].revision, 0);
    assert.equal(migrated.pendingProjectCreationSync, true);
    assert.equal(migrated.activeEstimateId, 'draft-estimate');
    assert.ok(Date.parse(migrated.clientUiUpdatedAt));
    assert.equal(migrated.estimates[0].updatedAt, migrated.clientUiUpdatedAt);
    assert.equal('dbEstimateId' in migrated.estimates[0], false);
    draftDom.window.close();

    const reloadDom = new JSDOM('<!doctype html><div id="estimatingModule" data-project-id="42"></div>', {
        url: 'https://takeoff.test/pages/project_dashboard.php?id=42&tab=estimating', runScripts: 'outside-only', pretendToBeVisual: true
    });
    reloadDom.window.ProjectState = { projectId: 42, projectInfo: {}, projectMeta: {}, estimateItems: [] };
    reloadDom.window.localStorage.setItem('takeoff.estimating.module.42', migratedRaw);
    const calls = [];
    reloadDom.window.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (!options.method || options.method === 'GET') {
            return { ok: true, status: 200, json: async () => ({ success: true, state: {
                activeEstimateId: 'server-seed',
                estimates: [{ id: 'server-seed', name: 'Server seed', status: 'draft', updatedAt: '2099-01-01T00:00:00.000Z', groups: [] }]
            } }) };
        }
        const sent = JSON.parse(options.body);
        return { ok: true, status: 200, json: async () => ({ success: true, state: sent.state }) };
    };
    reloadDom.window.eval(calculation);
    reloadDom.window.eval(footer);
    reloadDom.window.eval(workspace);
    reloadDom.window.eval(estimating);
    assert.equal(JSON.parse(reloadDom.window.localStorage.getItem('takeoff.estimating.module.42')).pendingProjectCreationSync, true,
        'initial render must retain the marker if navigation/load is interrupted');
    await new Promise(resolve => reloadDom.window.setTimeout(resolve, 900));

    const post = calls.find(call => call.options.method === 'POST');
    assert.ok(post, 'newer migrated draft must be saved after the initial server load');
    const payload = JSON.parse(post.options.body);
    assert.equal(payload.project_id, 42);
    assert.equal(payload.state.estimates[0].id, 'draft-estimate');
    assert.equal(payload.state.estimates[0].revision, 0);
    assert.equal('dbEstimateId' in payload.state.estimates[0], false);
    assert.equal('pendingProjectCreationSync' in payload.state, false, 'one-time migration marker must not be sent back to the server');
    assert.equal(reloadDom.window.localStorage.getItem('takeoff.estimating.module.42').includes('pendingProjectCreationSync'), false,
        'successful first save clears the local handoff marker');
    reloadDom.window.close();
});
