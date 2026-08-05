const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');

test('marker and segment drags share the multi-selection movement pipeline', () => {
    assert.match(source, /group\.on\('dragstart', \(\) => beginTakeoffSelectionDrag\('marker', marker\)\)/);
    assert.match(source, /line\.on\('dragstart', \(\) => beginTakeoffSelectionDrag\('segment', segment\)\)/);
    assert.match(source, /selectedTakeoffObjectIds\(\)\.map\(findTakeoffObjectByUid\)/);
});

test('group movement preserves relative marker and segment geometry with one delta', () => {
    assert.match(source, /target\.ref\.x = target\.markerX \+ dx/);
    assert.match(source, /target\.ref\.y = target\.markerY \+ dy/);
    assert.match(source, /target\.points\.map\(point => \(\{ x: point\.x \+ dx, y: point\.y \+ dy \}\)\)/);
});

test('group movement is atomic for locks, undo, and persistence', () => {
    assert.match(source, /targets\.some\(target => isElementLocked\(target\.ref\)\)/);
    assert.match(source, /snapshot\(\);[\s\S]*?state\.selectionDrag =/);
    assert.match(source, /state\.selectionDrag = null;[\s\S]*?markDirty\(\)/);
});
