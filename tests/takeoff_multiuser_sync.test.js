const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'takeoff.php'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');
const project = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.js'), 'utf8');
const editorPage = fs.readFileSync(path.join(root, 'pages', 'editor.php'), 'utf8');

test('Takeoff exposes a lightweight authenticated revision probe', () => {
    assert.match(api, /\$readActions = \['bootstrap', 'state', 'revision', 'scale'\]/);
    assert.match(api, /case 'revision':/);
    assert.match(api, /SELECT revision FROM takeoff_estimate_states WHERE estimate_key = \? AND drawing_id = \?/);
    assert.match(api, /ProjectAccess::READ/);
});

test('editors reconcile remote revisions without reloading the full canvas', () => {
    assert.match(editorPage, /takeoff_collaboration_reconciler\.js[\s\S]*assets\/editor\/takeoff\.js/);
    assert.match(editor, /request\('revision',[\s\S]*remoteRevision > takeoffAppliedServerRevision/);
    assert.match(editor, /request\('state',[\s\S]*applyRemoteTakeoffSnapshot/);
    assert.match(editor, /setInterval\(pollTakeoffRemoteRevision, 2500\)/);
    assert.match(editor, /res\.data\?\.revision/);
    assert.match(editor, /data\.revision/);
    assert.match(editor, /takeoffKnownServerRevision/);
    assert.match(editor, /takeoffAppliedServerRevision/);
    assert.match(editor, /reconcileCollection\(state\.markers/);
    assert.match(editor, /reconcileCollection\(state\.segments/);
    assert.doesNotMatch(editor, /await loadTakeoff\(\{ remoteSync: true \}\)/);
    assert.match(project, /payload\?\.remoteSync !== true[\s\S]{0,120}syncAllLayersToCanvas/);
});

test('remote synchronization runs with pending work and protects dirty identities', () => {
    assert.match(editor, /function hasPendingTakeoffMutation\(\)/);
    assert.match(editor, /dirtyTakeoffObjects\.size > 0/);
    assert.match(editor, /deletedTakeoffObjects\.size > 0/);
    assert.match(editor, /state\.draftLine/);
    assert.match(editor, /state\.selectionDrag/);
    assert.match(editor, /document\.hidden/);
    assert.doesNotMatch(editor, /takeoffRemoteSyncInFlight \|\| document\.hidden \|\| hasPendingTakeoffMutation/);
    assert.match(editor, /dirtyIds: dirtyObjectIds/);
    assert.match(editor, /deletedIds: deletedObjectIds/);
    assert.match(editor, /if \(!nextObjectRefs\.has\(marker\)\) destroyMarkerNodes\(marker\)/);
});

test('save acknowledgements are serialized and reconciled as canonical state', () => {
    assert.match(editor, /takeoffSaveQueue = takeoffSaveQueue\.catch\(\(\) => \{\}\)\.then\(queuedSave\)/);
    assert.match(editor, /applyRemoteTakeoffSnapshot\(res\.data, \{ remoteSync: true, saveAck: true \}\)/);
});

