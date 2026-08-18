const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const Service = require('../assets/estimating_workspace_service.js');
const client = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/project_estimating.php'), 'utf8');

test('workspace migration preserves estimates, notes, audit and rebinds project ownership', () => {
    const state = Service.workspace({ activeEstimateId: 'a', estimates: [{ id: 'a', projectId: 9,
        groups: [{ id: 'g', name: 'Manual', items: [{ id: 'i', name: 'Wire', quantity: 2 }] }],
        notes: { scope: 'Scope' }, auditLog: [{ action: 'Created' }] }] }, 73);
    assert.equal(state.projectId, 73);
    assert.equal(state.estimates[0].projectId, 73);
    assert.equal(state.estimates[0].groups[0].items[0].name, 'Wire');
    assert.equal(state.estimates[0].notes.scope, 'Scope');
    assert.equal(state.estimates[0].auditLog[0].action, 'Created');
});

test('New Estimate keeps stable client identity and active selection across normalization and reload', () => {
    const state = Service.workspace({ activeEstimateId: 'primary', estimates: [
        { id: 'primary', dbEstimateId: 41, name: 'Primary', groups: [] }
    ] }, 73);
    const created = Service.createEstimate(state, 'Alternate', 'blank');
    const alternate = state.estimates.find(row => row.name === 'Alternate');
    assert.ok(alternate.id.startsWith('estimate_'));
    assert.equal(alternate.dbEstimateId, undefined, 'a new estimate must not inherit the source database id');
    assert.equal(state.activeEstimateId, alternate.id);
    assert.equal(alternate.isActive, true);
    assert.equal(state.estimates.find(row => row.id === 'primary').isActive, false);

    const savedShape = JSON.parse(JSON.stringify(state));
    alternate.dbEstimateId = 99;
    const reloaded = Service.workspace(savedShape, 73);
    assert.equal(reloaded.activeEstimateId, alternate.id);
    assert.equal(Service.active(reloaded).name, 'Alternate');
    assert.equal(reloaded.estimates.filter(row => row.isActive).length, 1);
});

test('workspace falls back safely when a persisted active id no longer exists', () => {
    const state = Service.workspace({ activeEstimateId: 'deleted', estimates: [
        { id: 'remaining', name: 'Remaining', isActive: true, groups: [] }
    ] }, 73);
    assert.equal(state.activeEstimateId, 'remaining');
    assert.equal(state.estimates[0].isActive, true);
});

test('save API persists workspace activeEstimateId into snapshots and returns it unchanged', () => {
    assert.match(api, /\$requestedActiveId = \$workspace[\s\S]*?activeEstimateId/);
    assert.match(api, /\$estimate\['isActive'\][\s\S]*?\$requestedActiveId/);
    assert.match(api, /\$workspace\['activeEstimateId'\] = \$savedActiveExists \? \$requestedActiveId/);
    assert.match(api, /if \(!empty\(\$candidate\['isActive'\]\)\)/, 'reload must consume the persisted active flag');
});

test('client saves the complete workspace and retains a visible retry state', () => {
    assert.match(client, /mode: 'patch'[\s\S]*updates: sent\.estimates[\s\S]*state: sent/);
    assert.match(client, /ui\.loadState = 'error'/);
    assert.match(client, /data-retry-save/);
    assert.match(client, /localStorage\.setItem\(storageKey/);
});

test('estimate selection stays local while project save flushes dirty content', () => {
    const selection = client.slice(client.indexOf('function selectEstimate'), client.indexOf("window.addEventListener('takeoff:estimating-lines-updated'"));
    assert.match(selection, /Workspace\.selectEstimate\(state, estimateId\)/);
    assert.doesNotMatch(selection, /Workspace\.touch|scheduleSave/);
    assert.match(client, /window\.projectEstimatingSave = async function/);
    assert.match(client, /ui\.saveRequested/);
});

test('API retains lossless snapshots and relational recovery', () => {
    assert.match(api, /pew_save_workspace_state/);
    assert.match(api, /function pew_relational_groups/);
    assert.match(api, /estimate_items WHERE estimate_id = \? AND deleted_at IS NULL/);
    assert.match(api, /if \(\$recoveredGroups\) \$snapshot\['groups'\] = \$recoveredGroups/);
});
