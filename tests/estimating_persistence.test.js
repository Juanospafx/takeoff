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

test('client saves the complete workspace and retains a visible retry state', () => {
    assert.match(client, /body: JSON\.stringify\(\{ action: 'save', project_id: projectId, state: sent, summary: summary\(\) \}\)/);
    assert.match(client, /ui\.loadState = 'error'/);
    assert.match(client, /data-retry-save/);
    assert.match(client, /localStorage\.setItem\(storageKey/);
});

test('API retains lossless snapshots and relational recovery', () => {
    assert.match(api, /pew_save_workspace_state/);
    assert.match(api, /function pew_relational_groups/);
    assert.match(api, /estimate_items WHERE estimate_id = \? AND deleted_at IS NULL/);
    assert.match(api, /if \(\$recoveredGroups\) \$snapshot\['groups'\] = \$recoveredGroups/);
});
