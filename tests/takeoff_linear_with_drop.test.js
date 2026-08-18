const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');

function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(from, -1, `missing ${start}`);
    assert.notEqual(to, -1, `missing ${end}`);
    return source.slice(from, to);
}

test('project layer activation preserves linear-with-drop as a linear subtype', () => {
    const normalize = section('function normalizeEditorLayerType', 'function getPlanScale');
    assert.match(normalize, /linear with drop/);
    assert.match(normalize, /linear avg\. with drop/);
    assert.match(normalize, /type: 'linear', subtype: normalizeLinearSubtype/);
    const activate = section('window.projectTakeoffActivateLayer', 'window.projectTakeoffSyncLayers');
    assert.match(activate, /normalizeEditorLayerType\(normalizedType\)/);
    assert.match(activate, /takeoff_subtype: normalizedLayerType\.subtype/);
    assert.match(activate, /drop_length: Math\.max\(0, num\(payload\.drop_length \?\? payload\.dropLength\)\)/);
});

test('finished segment retains subtype and configured drop length', () => {
    const finish = section('function finishLinear', 'function destroyLinearDraftNodes');
    assert.match(finish, /normalizeLinearSubtype\(layer\.takeoff_subtype/);
    assert.match(finish, /takeoff_subtype: subtype/);
    assert.match(finish, /drop_length: subtype === 'linear' \? 0/);
});

test('linear-with-drop total combines horizontal run and one drop per editable vertex', () => {
    const calculate = section('function calculateLinearLength', 'function normalizeLinearSubtype');
    assert.match(calculate, /const dropCount = subtype === 'linear' \? 0 : points\.length/);
    assert.match(calculate, /const drops = dropLength \* dropCount/);
    assert.match(calculate, /const measured = horizontal \+ drops/);
    assert.match(calculate, /segment\.drop_count = dropCount/);
    assert.match(source, /handle\.on\('dragmove'[\s\S]*refreshSegment\(segment\)/);
    assert.match(source, /handle\.on\('dblclick dbltap'[\s\S]*segment\.points_json\.splice/);
});

test('drop subtype and length survive API metadata persistence', () => {
    assert.match(source, /metadata_json: \{ [\s\S]*takeoff_subtype: normalizeLinearSubtype\(segment\.takeoff_subtype/);
    assert.match(source, /drop_length: Math\.max\(0, num\(segment\.drop_length \?\? segment\.dropLength\)\)/);
    assert.match(source, /takeoff_subtype: s\.takeoff_subtype \|\| s\.metadata_json\?\.takeoff_subtype/);
    assert.match(source, /drop_length: Math\.max\(0, num\(s\.drop_length \?\? s\.metadata_json\?\.drop_length\)\)/);
});

test('selected runs support adding and dragging editable vertices', () => {
    assert.match(source, /function insertSegmentVertex\(segment, point\)/);
    assert.match(source, /line\.on\('dblclick dbltap'[\s\S]*?insertSegmentVertex\(segment, screenToWorld\(pointer\)\)/);
    assert.match(source, /handle\.on\('dragmove'[\s\S]*?segment\.points_json\[index\]/);
    assert.match(source, /Vertex added\. Drag the handles to refine the run\./);
});
