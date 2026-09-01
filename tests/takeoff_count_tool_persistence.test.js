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
    assert.match(clear, /deactivateLayerForInsert\(\)/);
    const deactivate = editor.slice(editor.indexOf('function deactivateLayerForInsert'), editor.indexOf('function openTakeoffMenu'));
    assert.match(deactivate, /state\.selectedLayerUid = null/);
    assert.match(deactivate, /state\.continuousTool = false/);
    assert.match(deactivate, /setTool\('smart'\)/);
    assert.match(page, /editor\/takeoff\.js\?v=[a-z0-9-]+/i);
});

test('canvas placement requires matching drawing mode, active layer, and no pan state', () => {
    const guard = editor.slice(editor.indexOf('function activePlacementLayer'), editor.indexOf('function calculateCountQuantity'));
    assert.match(guard, /state\.panMode \|\| state\.temporaryPan \|\| state\.annotationPlacement/);
    assert.match(guard, /const layer = activeLayer\(\)/);
    assert.match(guard, /return state\.tool === expectedTool \? layer : null/);
    const click = editor.slice(editor.indexOf("konvaStage.on('click tap'"), editor.indexOf("konvaStage.on('dblclick dbltap'"));
    assert.match(click, /const layer = activePlacementLayer\(\)/);
    assert.doesNotMatch(click, /const layer = activeLayer\(\)/);
});

test('internal layer checkbox deselects instead of reactivating the stale Count layer', () => {
    const start = editor.lastIndexOf("el.querySelectorAll('[data-layer-check]')");
    const handlers = editor.slice(start, editor.indexOf("el.querySelectorAll('[data-layer-action]')", start));
    assert.match(handlers, /if \(box\.checked\) activateLayerForInsert/);
    assert.match(handlers, /else if[\s\S]*deactivateLayerForInsert\(\)/);
});
