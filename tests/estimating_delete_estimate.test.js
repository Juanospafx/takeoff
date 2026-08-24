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
    assert.match(client, /client_estimate_id: String\(estimate\.id\)/);
    assert.match(client, /deleteAck = await request\('delete'/);
    assert.match(client, /deleteAck\?\.clientEstimateId/);
    assert.match(client, /deleteAck\?\.estimateId/);
    assert.match(client, /if \(!removed\)[\s\S]*await request\('list'\)/);
    assert.match(client, /deletedEstimateIds/);
    assert.match(client, /applyDeletedEstimateTombstones/);
    assert.match(client, /state\.estimates = state\.estimates\.filter/);
    const storageStart = client.indexOf("window.addEventListener('storage'");
    const storageFlow = client.slice(storageStart, client.indexOf('window.projectEstimatingSave', storageStart));
    assert.match(storageFlow, /applyDeletedEstimateTombstones\(incoming\)[\s\S]*render\(\)[\s\S]*publish\(\)/);
    assert.doesNotMatch(storageFlow, /localStorage\.setItem/);
    assert.match(client, /delete_original: original/);
    assert.match(client, /const unpersistedIds = state\.estimates/);
    assert.match(client, /while \(ui\.saving\)/);
    assert.match(client, /identityAttempted/);
    assert.match(client, /deleteCurrentEstimate\(estimateId, true, true\)/);
    assert.match(client, /database did not confirm every estimate identity/);
    assert.match(client, /ui\.saveRequested = dirtyEstimateIds\.size > 0/);
    const deleteFlow = client.slice(client.indexOf('async function deleteCurrentEstimate'), client.indexOf('function handleEstimateCardAction'));
    assert.match(deleteFlow, /await saveServer\(\)[\s\S]*?return;[\s\S]*?await request\('delete'/);
    assert.match(api, /Estimate could not be resolved for deletion/);
    assert.match(api, /ORDER BY id ASC LIMIT 1/);
    assert.match(api, /ORDER BY id ASC FOR UPDATE/);
    assert.match(client, /state\.estimates\.length <= 1/);
    assert.match(client, /confirm\(deleteMessage\)/);
    assert.match(client, /request\('delete'/);
    assert.match(client, /menuAttribute: 'data-estimate-menu'/);
    assert.match(client, /data-estimate-actions-menu/);
    assert.match(client, /actionName === 'rename'/);
    assert.match(client, /actionName === 'copy'/);
    assert.match(client, /actionName === 'delete'/);
});

test('removing an estimate accepts the string identity emitted by footer cards', () => {
    const state = Workspace.workspace({ projectId: 42, activeEstimateId: 101, estimates: [
        { id: 101, name: 'Original', groups: [] }, { id: 202, name: 'Copy', groups: [] }
    ] }, 42);
    assert.ok(Workspace.removeEstimate(state, '202'));
    assert.deepEqual(state.estimates.map(row => String(row.id)), ['101']);
});

test('new estimates wait for a database acknowledgement and protect pending navigation', () => {
    assert.match(client, /await window\.projectEstimatingSave\(\)/);
    assert.match(client, /Creating estimate in database/);
    assert.match(client, /beforeunload/);
    assert.match(client, /dirtyEstimateIds\.size/);
    assert.match(page, /project_estimating\.js\?v=estimating-storage-loop-stop-20260824-13/);
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
    assert.match(api, /rowCount\(\) !== 1/);
    assert.match(api, /DELETE FROM takeoff_estimate_states WHERE estimate_key=\?/);
    assert.match(api, /DELETE FROM takeoff_estimate_scales WHERE estimate_key=\?/);
});
