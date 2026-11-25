const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'takeoff.php'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');
const project = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.js'), 'utf8');

test('Takeoff exposes a lightweight authenticated revision probe', () => {
    assert.match(api, /\$readActions = \['bootstrap', 'state', 'revision', 'scale'\]/);
    assert.match(api, /case 'revision':/);
    assert.match(api, /SELECT revision FROM takeoff_estimate_states WHERE estimate_key = \? AND drawing_id = \?/);
    assert.match(api, /ProjectAccess::READ/);
});

test('clean editors reload when another user advances the server revision', () => {
    assert.match(editor, /request\('revision',[\s\S]*remoteRevision > takeoffServerRevision/);
    assert.match(editor, /await loadTakeoff\(\{ remoteSync: true \}\)/);
    assert.match(editor, /setInterval\(pollTakeoffRemoteRevision, 2500\)/);
    assert.match(editor, /res\.data\?\.revision/);
    assert.match(editor, /data\.revision/);
    assert.match(editor, /clearNodes\(\);[\s\S]{0,120}state\.selectedObjectUids\.clear\(\)/);
    assert.match(editor, /remoteSync: options\.remoteSync === true/);
    assert.match(project, /payload\?\.remoteSync !== true[\s\S]{0,120}syncAllLayersToCanvas/);
});

test('remote synchronization never overwrites pending local work', () => {
    assert.match(editor, /function hasPendingTakeoffMutation\(\)/);
    assert.match(editor, /dirtyTakeoffObjects\.size > 0/);
    assert.match(editor, /deletedTakeoffObjects\.size > 0/);
    assert.match(editor, /state\.draftLine/);
    assert.match(editor, /state\.selectionDrag/);
    assert.match(editor, /document\.hidden/);
});

