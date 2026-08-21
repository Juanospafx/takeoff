const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
const client = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/project_estimating.php'), 'utf8');
const Workspace = require(path.join(root, 'assets/estimating_workspace_service.js'));

test('Estimating exposes a confirmed delete action and keeps one estimate', () => {
    assert.match(page, /data-est-option="delete-estimate"/);
    assert.match(client, /function deleteCurrentEstimate/);
    assert.match(client, /is the original estimate/);
    assert.match(client, /state\.estimates\.length <= 1/);
    assert.match(client, /confirm\(`Delete/);
    assert.match(client, /request\('delete'/);
    assert.match(client, /menuAttribute: 'data-estimate-menu'/);
    assert.match(client, /data-estimate-actions-menu/);
    assert.match(client, /actionName === 'rename'/);
    assert.match(client, /actionName === 'copy'/);
    assert.match(client, /actionName === 'delete'/);
});

test('removing an estimate selects another isolated workspace', () => {
    const state = Workspace.workspace({ activeEstimateId: 'b', estimates: [
        { id: 'a', name: 'A', groups: [{ id: 'ga', name: 'A group', items: [] }] },
        { id: 'b', name: 'B', groups: [{ id: 'gb', name: 'B group', items: [] }] }
    ] }, 42);
    Workspace.removeEstimate(state, 'b');
    assert.equal(state.activeEstimateId, 'a');
    assert.equal(state.estimates.length, 1);
    assert.equal(state.groups[0].id, 'ga');
});

test('deleting an inactive estimate keeps the current estimate selected', () => {
    const state = Workspace.workspace({ activeEstimateId: 'a', estimates: [
        { id: 'a', name: 'A', groups: [] }, { id: 'b', name: 'B', groups: [] }
    ] }, 42);
    Workspace.removeEstimate(state, 'b');
    assert.equal(state.activeEstimateId, 'a');
});

test('server soft-deletes the estimate and cleans its scoped Takeoff workspace', () => {
    assert.match(api, /action === 'delete'/);
    assert.match(api, /At least one estimate must remain/);
    assert.match(api, /UPDATE estimates SET deleted_at=CURRENT_TIMESTAMP/);
    assert.match(api, /DELETE FROM takeoff_estimate_states WHERE estimate_key=\?/);
    assert.match(api, /DELETE FROM takeoff_estimate_scales WHERE estimate_key=\?/);
});
