const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const parent = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const layerModal = fs.readFileSync(path.join(root, 'assets/takeoff_layer_modal.js'), 'utf8');
const viewerController = fs.readFileSync(path.join(root, 'assets/takeoff_viewer_controller.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'pages/editor.php'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'assets/editor/runtime.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');

test('existing Takeoff geometry remains interactive while repeated Count placement stays armed', () => {
    const gate = editor.slice(editor.indexOf('function isTakeoffObjectInteractionBlocked'),
        editor.indexOf('function applyMarkerLockVisual'));
    assert.doesNotMatch(gate, /takeoff_count/);
    assert.match(gate, /takeoff_linear/);
    assert.match(editor, /listening: !isTakeoffObjectInteractionBlocked\(\)/);
    assert.match(editor, /group\.on\('click tap'[\s\S]*?setTool\('smart'\)[\s\S]*?selectElement\('marker'/);
    assert.match(editor, /line\.on\('click tap'[\s\S]*?setTool\('smart'\)[\s\S]*?selectElement\('segment'/);
});

test('item three-dot menu opens size and thickness properties that update existing objects', () => {
    assert.match(viewerController, /Item properties & size/);
    assert.match(layerModal, /id="layerDiameterInput"/);
    assert.match(layerModal, /id="layerStrokeInput"/);
    assert.match(layerModal, /projectTakeoffUpdateLayerObjects/);
    assert.match(editor, /window\.projectTakeoffUpdateLayerObjects/);
    assert.match(editor, /const nextSize = Math\.max[\s\S]*?ref\.symbol_size = nextSize/);
    assert.match(editor, /ref\.stroke_width = Math\.max/);
    assert.match(editor, /metadata_json[\s\S]*?diameter/);
    assert.match(editor, /trackTakeoffObjects\(targets/);
    assert.match(editor, /markDirty\(\{ objectsTracked: true \}\)/);
});

test('measurement labels stay hidden without removing measured model values', () => {
    assert.match(editor, /const label = new Konva\.Text\([\s\S]*?visible: false/);
    assert.match(editor, /lengthLabel: new Konva\.Text\([\s\S]*?visible: false/);
    assert.match(editor, /s\.labelNode\.visible\(false\)/);
    assert.match(editor, /let segLabelText = isArea \? formatAreaLabel\(segment\.total_area\) : formatFeetLabel\(segment\.total_length\)/);
    assert.match(editor, /segment\.labelNode\.text\(segLabelText\)/);
});

test('deleting a marker removes its transformer and fallback notes start editable', () => {
    assert.match(editor, /function deleteTakeoffSelection[\s\S]*?destroyMarkerNodes\(ref\)/);
    assert.match(runtime, /Newly placed fallback annotations must remain movable\/resizable/);
    assert.match(runtime, /unlockObject\(t\)/);
    assert.match(runtime, /hasControls: true, lockScalingX: false, lockScalingY: false/);
});

test('dashboard and editor bypass the previous cached Takeoff scripts', () => {
    assert.match(dashboard, /project_takeoff\.js\?v=<\?=\s*filemtime\(/);
    assert.match(page, /editor\/takeoff\.js\?v=<\?=\s*filemtime\(/);
});
