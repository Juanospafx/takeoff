const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editor = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');
const parent = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_takeoff.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.php'), 'utf8');

function section(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return source.slice(start, end);
}

test('Rectangle select is wired from the parent toolbar into the Konva editor', () => {
    assert.match(parent, /command === 'multi-select'[\s\S]*projectTakeoffSetTool', 'multi-select'[\s\S]*setActiveTool\(command\)/);
    assert.match(editor, /normalized === 'multi-select' \|\| normalized === 'select-rect'[\s\S]*setTool\('multi-select'\)/);
    assert.match(editor, /konvaStage\.on\('mousedown touchstart'[\s\S]*new Konva\.Rect/);
    assert.match(editor, /konvaStage\.on\('mousemove touchmove'[\s\S]*selectionRectDraft\.node\.size/);
    assert.match(editor, /konvaStage\.on\('mouseup touchend'[\s\S]*finishRectangleSelection\(\)/);
});

test('Rectangle selection includes count, linear, and area objects but excludes hidden and off-page geometry', () => {
    const finish = section(editor, 'const finishRectangleSelection', "konvaStage.on('mousedown touchstart'");
    assert.match(finish, /state\.markers\.filter\(marker => marker\.page_number === pageNum && marker\.node\?\.visible\(\)\)/);
    assert.match(finish, /state\.segments\.filter\(segment => segment\.page_number === pageNum && segment\.node\?\.visible\(\)\)/);
    assert.match(finish, /Konva\.Util\.haveIntersection\(rect,[\s\S]*marker\.node\.getClientRect/);
    assert.match(finish, /Konva\.Util\.haveIntersection\(rect,[\s\S]*segment\.node\.getClientRect/);
    assert.match(finish, /state\.selectedObjectUids = new Set\(targets\.map/);
    assert.match(finish, /emitSelectionState\(\)/);
});

test('Dragging any selected marker, line, or area applies one common delta and persists once', () => {
    const begin = section(editor, 'function beginTakeoffSelectionDrag', 'function updateTakeoffSelectionDrag');
    const update = section(editor, 'function updateTakeoffSelectionDrag', 'function finishTakeoffSelectionDrag');
    const finish = section(editor, 'function finishTakeoffSelectionDrag', 'function applySegmentLockVisual');
    assert.match(begin, /selectedTakeoffObjectIds\(\).*findTakeoffObjectByUid/);
    assert.match(begin, /targets\.some\(target => isElementLocked\(target\.ref\)\)/);
    assert.match(begin, /snapshot\(\)/);
    assert.match(update, /const dx = ref\.node\.x\(\) - drag\.start\.x/);
    assert.match(update, /const dy = ref\.node\.y\(\) - drag\.start\.y/);
    assert.match(finish, /target\.ref\.x = target\.markerX \+ dx/);
    assert.match(finish, /target\.ref\.points_json = target\.points\.map/);
    assert.match(finish, /refreshSegment\(target\.ref\)/);
    assert.equal((finish.match(/markDirty\(\)/g) || []).length, 1, 'group drag must autosave/emit once');
    assert.match(editor, /group\.on\('dragstart',[\s\S]*beginTakeoffSelectionDrag\('marker', marker\)/);
    assert.match(editor, /line\.on\('dragstart',[\s\S]*beginTakeoffSelectionDrag\('segment', segment\)/);
});

test('Delete and trash reuse the authoritative selection deletion flow', () => {
    const action = section(parent, 'function runSelectionAction', 'function runLayerTool');
    assert.match(action, /action === 'delete'[\s\S]*projectTakeoffDeleteSelection/);
    assert.match(parent, /event\.key === 'Delete'[\s\S]*runSelectionAction\('delete'\)/);
    assert.match(shell, /projectTakeoffHandleDeleteKey\?\.\(e\)[\s\S]*stopImmediatePropagation\(\)/);
    const deletion = section(editor, 'function deleteTakeoffSelection', 'function deleteSelected');
    assert.match(deletion, /selectedTakeoffObjectIds\(\)/);
    assert.match(deletion, /state\.markers = state\.markers\.filter/);
    assert.match(deletion, /state\.segments = state\.segments\.filter/);
    assert.match(deletion, /markDirty\(\)/);
    assert.match(editor, /projectTakeoffDeleteSelection = function[\s\S]*deleteTakeoffSelection\(objectIds\)/);
});
