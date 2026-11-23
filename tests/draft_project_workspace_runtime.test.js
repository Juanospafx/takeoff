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
const dialogs = fs.readFileSync(path.join(root, 'assets/project_overview_dialogs.js'), 'utf8');
const notesTasks = fs.readFileSync(path.join(root, 'assets/project_overview_notes_tasks.js'), 'utf8');

const draftWorkspace = {
    activeEstimateId: 'draft-estimate',
    estimates: [{
        id: 'draft-estimate', name: 'Draft estimate', status: 'draft', projectId: 0,
        dbEstimateId: 999, estimateItemId: 999, revision: 7,
        updatedAt: '2026-08-11T12:00:00.000Z', groups: [], notes: {}, settings: {}
    }]
};

test('draft save persists the workspace before redirect and leaves no pending handoff', async () => {
    const virtualConsole = new VirtualConsole();
    const draftDom = new JSDOM('<!doctype html><button id="saveProjectBtn">Save</button><input id="poEstimateName" value="Draft project">', {
        url: 'https://takeoff.test/pages/project_dashboard.php?tab=overview', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
    });
    draftDom.window.ProjectState = { projectId: 0, projectInfo: {}, projectMeta: {}, documents: [] };
    draftDom.window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify(draftWorkspace));
    const persistedDrafts = [];
    draftDom.window.projectEstimatingPersistDraft = async projectId => {
        persistedDrafts.push(projectId);
        const persisted = {
            ...draftWorkspace, projectId,
            estimates: draftWorkspace.estimates.map(row => ({ ...row, projectId, revision: 1, dbEstimateId: 501 }))
        };
        draftDom.window.localStorage.setItem(`takeoff.estimating.module.${projectId}`, JSON.stringify(persisted));
        return { persisted: true, projectId };
    };
    draftDom.window.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'success', id: 42, project_id: 42, project: { id: 42 }, data: { project: { id: 42 } } })
    });
    draftDom.window.eval(dialogs);
    draftDom.window.eval(notesTasks);
    draftDom.window.eval(overview);
    draftDom.window.document.dispatchEvent(new draftDom.window.Event('DOMContentLoaded'));
    draftDom.window.document.getElementById('saveProjectBtn').click();
    await new Promise(resolve => draftDom.window.setTimeout(resolve, 0));

    const migratedRaw = draftDom.window.localStorage.getItem('takeoff.estimating.module.42');
    assert.deepEqual(persistedDrafts, [42], 'the new project ID must be persisted before navigation');
    assert.ok(migratedRaw, 'the acknowledged workspace cache must exist before redirect');
    assert.equal(draftDom.window.localStorage.getItem('takeoff.estimating.module.draft'), null);
    const migrated = JSON.parse(migratedRaw);
    assert.equal(migrated.estimates[0].projectId, 42);
    assert.equal(migrated.estimates[0].revision, 1);
    assert.equal(migrated.estimates[0].dbEstimateId, 501);
    assert.equal('pendingProjectCreationSync' in migrated, false);
    assert.equal(migrated.activeEstimateId, 'draft-estimate');
    draftDom.window.close();
});
