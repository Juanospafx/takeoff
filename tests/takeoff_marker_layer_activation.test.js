const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const parent = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');

test('marker hover displays its Takeoff item name in a non-interactive Konva tooltip', () => {
    const createMarker = editor.slice(editor.indexOf('function createMarkerNode'), editor.indexOf('function refreshSegment'));
    assert.match(createMarker, /markerLayer\?\.name \|\| marker\.label \|\| 'Takeoff item'/);
    assert.match(createMarker, /new Konva\.Label[\s\S]*name: 'takeoff-marker-tooltip'/);
    assert.match(createMarker, /group\.on\('mouseenter'[\s\S]*tooltip\.visible\(true\)/);
    assert.match(createMarker, /group\.on\('mouseleave'[\s\S]*tooltip\.visible\(false\)/);
});

test('marker double-click requests activation through the existing selection message contract', () => {
    const createMarker = editor.slice(editor.indexOf('function createMarkerNode'), editor.indexOf('function refreshSegment'));
    assert.match(createMarker, /group\.on\('dblclick dbltap'/);
    assert.match(createMarker, /type: 'project-takeoff-selection'[\s\S]*activateLayer: true/);
    assert.match(createMarker, /layerId: String\(marker\.layer_client_uid\)/);
});

test('parent activates, expands, and reveals the requested sidebar layer', () => {
    const handler = parent.slice(parent.indexOf("if (event.data?.type === 'project-takeoff-selection')"), parent.indexOf("if (event.data?.type === 'project-takeoff-tool-state')"));
    assert.match(handler, /payload\.activateLayer === true/);
    assert.match(handler, /group\.isExpanded = true/);
    assert.match(handler, /setActiveTakeoffLayer\(payload\.layerId\)/);
    assert.match(handler, /scrollIntoView\(\{ block: 'nearest', behavior: 'smooth' \}\)/);
});
