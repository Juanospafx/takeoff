const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'pages/editor.php'), 'utf8');

test('Point remains active after each count while its item is selected', () => {
    const finish = editor.slice(editor.indexOf('function finishToolUse'), editor.indexOf('function addLinearPoint'));
    assert.match(finish, /state\.tool === 'takeoff_count' && activeLayer\(\)/);
    assert.match(finish, /emitToolState\(\);\s*return;/);
    assert.match(editor, /function addMarker\(pos\)[\s\S]*state\.markers\.push\(marker\)[\s\S]*finishToolUse\(\)/);
});

test('deselecting the count item clears persistence and returns to Smart', () => {
    const clear = editor.slice(editor.indexOf('window.projectTakeoffClearActiveLayer'), editor.indexOf('window.projectTakeoffSetLayerVisibility'));
    assert.match(clear, /state\.selectedLayerUid = null/);
    assert.match(clear, /state\.continuousTool = false/);
    assert.match(clear, /setTool\('select'\)/);
    assert.match(page, /editor\/takeoff\.js\?v=[a-z0-9-]+/i);
});
