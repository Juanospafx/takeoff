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
        { id: 'primary', dbEstimateId: 41, name: 'Primary', takeoffSyncMode: 'mirror',
            groups: [{ id: 'g1', name: 'Electrical', items: [{ id: 'i1', name: 'Wire', quantity: 2 }] }],
            notes: { projectNotes: 'Source note' } }
    ] }, 73);
    const created = Service.createEstimate(state, 'Alternate', 'blank');
    const alternate = state.estimates.find(row => row.name === 'Alternate');
    assert.ok(alternate.id.startsWith('estimate_'));
    assert.equal(alternate.dbEstimateId, undefined, 'a new estimate must not inherit the source database id');
    assert.equal(state.activeEstimateId, alternate.id);
    assert.equal(alternate.isActive, true);
    assert.deepEqual(alternate.groups, [], 'Blank must not inherit source groups or items');
    assert.equal(alternate.creationMode, 'blank');
    assert.equal(alternate.takeoffSyncMode, 'linked-only');
    assert.equal(state.estimates.find(row => row.id === 'primary').isActive, false);

    const savedShape = JSON.parse(JSON.stringify(state));
    alternate.dbEstimateId = 99;
    const reloaded = Service.workspace(savedShape, 73);
    assert.equal(reloaded.activeEstimateId, alternate.id);
    assert.equal(Service.active(reloaded).name, 'Alternate');
    assert.deepEqual(Service.active(reloaded).groups, [], 'Blank must remain empty after normalization/reload');
    assert.equal(Service.active(reloaded).takeoffSyncMode, 'linked-only');
    assert.equal(reloaded.estimates.filter(row => row.isActive).length, 1);
});

test('New Estimate starting points are isolated and preserve their Takeoff policy', () => {
    const seed = () => Service.workspace({ activeEstimateId: 'primary', estimates: [{
        id: 'primary', name: 'Primary', takeoffSyncMode: 'mirror',
        groups: [{ id: 'g1', name: 'Electrical', expanded: false,
            items: [{ id: 'i1', name: 'Wire', quantity: 2 }] }],
        settings: { globalLaborCost: 85 }, notes: { projectNotes: 'Source note' }
    }] }, 73);

    const structureState = seed();
    Service.createEstimate(structureState, 'Structure', 'structure');
    const structure = Service.active(structureState);
    assert.equal(structure.creationMode, 'structure');
    assert.equal(structure.takeoffSyncMode, 'linked-only');
    assert.equal(structure.groups.length, 1);
    assert.deepEqual(structure.groups[0].items, []);

    const copyState = seed();
    Service.createEstimate(copyState, 'Copy', 'all');
    const copy = Service.active(copyState);
    assert.equal(copy.creationMode, 'all');
    assert.equal(copy.takeoffSyncMode, 'linked-only');
    assert.equal(copy.groups[0].items[0].name, 'Wire');
    copy.groups[0].items[0].name = 'Changed in copy';
    copy.notes.projectNotes = 'Changed note';
    assert.equal(copyState.estimates[0].groups[0].items[0].name, 'Wire');
    assert.equal(copyState.estimates[0].notes.projectNotes, 'Source note');
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
