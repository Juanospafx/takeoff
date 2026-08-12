const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');
const between = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a) + a.length));

test('count markers expose bounded corner resize handles', () => {
    const body = between('function createMarkerNode', 'function refreshSegment');
    assert.match(body, /new Konva\.Group\(\{ name: 'takeoff-count-symbol'/);
    assert.match(body, /new Konva\.Transformer/);
    assert.match(body, /enabledAnchors: \['top-left', 'top-right', 'bottom-left', 'bottom-right'\]/);
    assert.match(body, /rotateEnabled: false/);
    assert.match(body, /side < 8 \|\| side > 192/);
});

test('resize respects locks and persists normalized numeric size', () => {
    const body = between('function createMarkerNode', 'function refreshSegment');
    assert.match(body, /transformstart'[\s\S]*isElementLocked\(marker\)[\s\S]*snapshot\(\)/);
    assert.match(body, /transformend'[\s\S]*Math\.max\(4, Math\.min\(96/);
    assert.match(body, /symbol\.scale\(\{ x: 1, y: 1 \}\)/);
    assert.match(body, /metadata_json = [\s\S]*symbol_size/);
    assert.match(body, /markDirty\(\)/);
    assert.match(source, /symbol_size: m\.symbol_size \?\? m\.metadata_json\?\.symbol_size/);
});

test('handles show only for one unlocked selected marker', () => {
    const visuals = between('function applyObjectSelectionVisuals', 'function findTakeoffObjectByUid');
    assert.match(visuals, /state\.selectedObjectUids\.size === 1/);
    assert.match(visuals, /!isElementLocked\(marker\)/);
    assert.match(visuals, /marker\.page_number === pageNum/);
    assert.match(source, /marker\.transformer\?\.listening\(listening && !panning && !isElementLocked\(marker\)\)/);
});
