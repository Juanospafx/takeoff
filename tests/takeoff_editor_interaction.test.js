const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');

test('existing count, linear, and area geometry remains draggable unless locked', () => {
    assert.match(source, /new Konva\.Group\(\{[^}]*draggable:\s*!isElementLocked\(marker\)/s);
    assert.match(source, /new Konva\.Line\(\{[^}]*closed:\s*isArea,[^}]*draggable:\s*!isElementLocked\(segment\)/s);
    assert.match(source, /new Konva\.Circle\(\{[^}]*draggable:\s*!isElementLocked\(segment\)/s);
});

test('dragging a segment vertex updates stored geometry, recalculates it, and persists it', () => {
    assert.match(source, /handle\.on\('dragstart',\s*\(\)\s*=>\s*snapshot\(\)\)/);
    assert.match(source, /handle\.on\('dragmove',[\s\S]*?segment\.points_json\[index\]\s*=\s*\{\s*x:\s*position\.x,\s*y:\s*position\.y\s*\};[\s\S]*?refreshSegment\(segment\)/);
    assert.match(source, /handle\.on\('dragend',\s*\(\)\s*=>\s*\{[\s\S]*?markDirty\(\);[\s\S]*?\}\)/);
    assert.match(source, /function refreshSegment\(segment\)[\s\S]*?calculateAreaQuantity\(segment\)[\s\S]*?calculateLinearLength\(segment\)/);
});

test('vertex controls keep a usable visual and hit size at fit-to-screen zoom', () => {
    assert.match(source, /handle\.radius\(6 \* factor\)/);
    assert.match(source, /handle\.hitStrokeWidth\(14 \* factor\)/);
    assert.match(source, /window\.syncTakeoffInteractionScale\s*=\s*syncTakeoffHandleScale/);
});

test('an active drawing tool receives clicks that land on existing geometry', () => {
    assert.match(source, /function applyTakeoffDrawingInteractivity\(\)[\s\S]*?marker\.node\?\.listening\(listening\)[\s\S]*?segment\.node\?\.listening\(listening\)[\s\S]*?handle\.listening\(listening\)/);
    assert.match(source, /state\.tool\s*=\s*tool;[\s\S]*?applyTakeoffDrawingInteractivity\(\);/);
    assert.match(source, /listening:\s*!isTakeoffDrawingToolActive\(\)/);
});
