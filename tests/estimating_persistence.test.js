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

test('legacy imported linked mode migrates to linked-only instead of destructive mirror mode', () => {
    const state = Service.workspace({ activeEstimateId: 'imported', estimates: [{
        id: 'imported', name: 'Imported Estimate', creationMode: 'excel_import', takeoffSyncMode: 'linked',
        groups: [{ id: 'g1', name: 'Imported', items: [
            { id: 'i1', takeoffLayerId: 'layer-1', name: 'Imported item', quantity: 12 }
        ] }]
    }] }, 73);
    assert.equal(state.estimates[0].takeoffSyncMode, 'linked-only');
    assert.equal(state.estimates[0].groups[0].items.length, 1);
});

test('workspace normalization repairs exact archived assembly component duplicates', () => {
    const duplicatedChild = {
        catalogItemId: 'part-53k', assemblyComponentId: 'part-53k', name: 'Component',
        uom: 'ea', ratio: 1, quantity: 0, unitMaterialCost: 53000, unitLabor: 0
    };
    const state = Service.workspace({ activeEstimateId: 'imported', estimates: [{
        id: 'imported', name: 'Imported Estimate', groups: [{ id: 'g1', name: 'Imported', items: [{
            id: 'assembly-1', name: 'Assembly', itemType: 'assembly', isAssembly: true, quantity: 1,
            children: [
                { ...duplicatedChild, id: 'active-child' },
                { ...duplicatedChild, id: 'archived-child' }
            ]
        }] }]
    }] }, 73);
    const assembly = state.estimates[0].groups[0].items[0];

    assert.equal(assembly.children.length, 1);
    assert.deepEqual(Service.consumeRepairFlags(state.estimates[0]), ['duplicate-assembly-components']);
    assert.equal(assembly._workspaceRepairFlags, undefined, 'repair markers must not be persisted');
});

test('assembly repair preserves semantically distinct repeated components', () => {
    const base = {
        catalogItemId: 'part-1', assemblyComponentId: 'part-1', name: 'Support',
        uom: 'ea', ratio: 1, quantity: 0, unitMaterialCost: 10, unitLabor: 0
    };
    const variants = [
        { ...base, id: 'a', componentWaste: 0, notes: 'base', costCode: '16-1' },
        { ...base, id: 'b', componentWaste: 5, notes: 'base', costCode: '16-1' },
        { ...base, id: 'c', componentWaste: 0, notes: 'special', costCode: '16-1' },
        { ...base, id: 'd', componentWaste: 0, notes: 'base', costCode: '16-2' },
        { ...base, id: 'e', componentWaste: 0, notes: 'base', costCode: '16-1', spacing: 12 },
        { ...base, id: 'f', componentWaste: 0, notes: 'base', costCode: '16-1', factorOverride: 2 }
    ];
    const item = Service.item({ id: 'assembly', itemType: 'assembly', children: variants });
    assert.equal(item.children.length, variants.length);
    assert.deepEqual(Service.consumeRepairFlags({ groups: [{ items: [item] }] }), []);
});

test('save API persists workspace activeEstimateId into snapshots and returns it unchanged', () => {
    assert.match(api, /\$requestedActiveId = \$workspace[\s\S]*?activeEstimateId/);
    assert.match(api, /\$estimate\['isActive'\][\s\S]*?\$requestedActiveId/);
    assert.match(api, /\$workspace\['activeEstimateId'\] = \$savedActiveExists \? \$requestedActiveId/);
    assert.match(api, /if \(!empty\(\$candidate\['isActive'\]\)\)/, 'reload must consume the persisted active flag');
});

test('client saves the complete workspace and retains a visible retry state', () => {
    assert.match(client, /savePayload = estimates => \(\{ action: 'save', mode: 'patch'[\s\S]*updates: estimates[\s\S]*state: \{ \.\.\.sent, estimates \}/);
    assert.match(client, /ui\.loadState = 'error'/);
    assert.match(client, /data-retry-save/);
    assert.match(client, /localStorage\.setItem\(storageKey/);
});

test('server-loaded assembly repairs are marked dirty and persisted', () => {
    assert.match(client, /function consumeAndMarkWorkspaceRepairs\(\)/);
    assert.match(client, /Workspace\.consumeRepairFlags\(estimate\)/);
    assert.match(client, /repairedIds\.length[\s\S]*scheduleSave\('workspace-repair'/);
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
    assert.match(api, /!array_key_exists\('groups', \$snapshot\) \|\| !is_array\(\$snapshot\['groups'\]\)/,
        'an intentionally empty groups array must remain authoritative after refresh');
    assert.doesNotMatch(api, /!is_array\(\$snapshot\['groups'\]\) \|\| !\$snapshot\['groups'\]/);
});
