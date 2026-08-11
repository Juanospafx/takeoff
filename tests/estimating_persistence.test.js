const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const client = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_estimating.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'project_estimating.php'), 'utf8');

function persistenceHelpers() {
    const start = client.indexOf('function estimateItemIds');
    const end = client.indexOf('async function flushServerSave', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const sandbox = {};
    vm.runInNewContext(`${client.slice(start, end)}; this.check = serverStateContainsSavedItems;`, sandbox);
    return sandbox.check;
}

function workspace(itemIds) {
    return {
        estimates: [{ id: 'estimate-1', groups: [{ id: 'group-1', items: itemIds.map(id => ({ id })) }] }]
    };
}

test('a save response cannot replace the local estimate when it omitted an item', () => {
    const contains = persistenceHelpers();
    assert.equal(contains(workspace(['manual-1', 'manual-2']), workspace(['manual-1'])), false);
    assert.equal(contains(workspace(['manual-1']), workspace(['manual-1', 'server-extra'])), true);
    assert.equal(contains(workspace([]), null), false, 'even an empty save requires a valid workspace response');
});

test('the exact snapshot sent to the API is the snapshot validated on response', () => {
    assert.match(client, /const sentState = serializableState\(\)/);
    assert.match(client, /body: JSON\.stringify\(\{ action: 'save', project_id: projectId, state: sentState \}\)/);
    assert.match(client, /serverStateContainsSavedItems\(sentState, remote\)/);
    assert.match(client, /Server save response omitted estimate items; local draft retained/);
});

test('server loading cannot overwrite edits made while its request was pending', () => {
    assert.match(client, /const startingRevision = changeRevision/);
    assert.match(client, /startingRevision === changeRevision[\s\S]*newestStateTimestamp\(remote\)/);
    assert.match(client, /state\.dirty \|\| startingRevision !== changeRevision[\s\S]*scheduleServerSave\(\)/);
});

test('client diagnostics include safe API stage and correlation reference', () => {
    assert.match(client, /function apiErrorMessage\(result, response, fallback\)/);
    assert.match(client, /error\.stage \? `stage: \$\{error\.stage\}`/);
    assert.match(client, /error\.request_id \? `ref: \$\{error\.request_id\}`/);
    assert.match(client, /apiErrorMessage\(result, response, 'Unable to load estimating workspace\.'\)/);
});

test('API reconstructs active relational estimate items when a workspace snapshot is absent or empty', () => {
    assert.match(api, /function pew_relational_groups\(PDO \$pdo, \$estimateId\)/);
    assert.match(api, /estimate_items WHERE estimate_id = \? AND deleted_at IS NULL/);
    assert.match(api, /\$meta\['workspace'\]/);
    assert.match(api, /\$item\['id'\] = \$clientId/);
    assert.match(api, /!isset\(\$snapshot\['groups'\]\) \|\| !is_array\(\$snapshot\['groups'\]\) \|\| !\$snapshot\['groups'\]/);
    assert.match(api, /if \(\$recoveredGroups\) \$snapshot\['groups'\] = \$recoveredGroups/);
});
