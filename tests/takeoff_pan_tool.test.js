const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_takeoff.js'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.php'), 'utf8');

test('pointer and hand are mutually exclusive visual tools', () => {
    assert.match(dashboard, /function setActiveTool\(command\)[\s\S]*?button\.classList\.toggle\('active',\s*button\.dataset\.toolCommand\s*===\s*command\)/);
    assert.match(dashboard, /if \(command === 'smart' \|\| command === 'pan'\)[\s\S]*?projectTakeoffSetTool[\s\S]*?setActiveTool\(command\)[\s\S]*?setMode',\s*'smart'/);
});

test('holding Space activates the hand visually and restores the prior tool on release', () => {
    assert.match(dashboard, /event\.code === 'Space'[\s\S]*?temporaryPanPreviousTool\s*=\s*viewerState\.activeTool[\s\S]*?projectTakeoffSetTemporaryPan',\s*true[\s\S]*?setActiveTool\('pan'\)/);
    assert.match(dashboard, /addEventListener\('keyup'[\s\S]*?projectTakeoffSetTemporaryPan',\s*false[\s\S]*?setActiveTool\(restoreTool\)/);
});

test('permanent and temporary hand modes drive the real Konva pan state', () => {
    assert.match(editor, /normalized === 'pan'[\s\S]*?state\.panMode\s*=\s*true[\s\S]*?setTakeoffPanMode\?\.\(true,\s*false\)/);
    assert.match(editor, /projectTakeoffSetTemporaryPan[\s\S]*?state\.temporaryPan\s*=\s*Boolean\(enabled\)[\s\S]*?setTakeoffPanMode\?\.\(state\.temporaryPan,\s*true\)/);
    assert.match(shell, /const requestedPan\s*=\s*konvaPanMode\s*\|\|\s*konvaTemporaryPan[\s\S]*?requestedPan\s*&&\s*\(!takeoffDrawing\s*\|\|\s*konvaTemporaryPan\)/);
});

test('runtime pointer movement changes the viewport and always releases capture', () => {
    assert.match(shell, /addEventListener\('pointerdown'[\s\S]*?panActive[\s\S]*?setPointerCapture\(evt\.pointerId\)/);
    assert.match(shell, /addEventListener\('pointermove'[\s\S]*?vpt\[4\]\s*\+=\s*evt\.clientX\s*-\s*panStart\.x[\s\S]*?vpt\[5\]\s*\+=\s*evt\.clientY\s*-\s*panStart\.y[\s\S]*?syncKonvaToFabric\(\)/);
    assert.match(shell, /addEventListener\('pointerup',\s*finishPointerPan[\s\S]*?addEventListener\('pointercancel',\s*finishPointerPan/);
});

test('background drag activates Hand only after threshold and never claims object or drawing gestures', () => {
    assert.match(shell, /primaryBackgroundGesture\s*=\s*evt[\s\S]*?evt\.button === 0[\s\S]*?currentMode === 'smart'[\s\S]*?isEmpty[\s\S]*?!takeoffDrawing[\s\S]*?!pendingPlacementTool/);
    assert.match(shell, /if \(!konvaIsPanning && backgroundPanCandidate\)[\s\S]*?Math\.hypot[\s\S]*?distance >= 5[\s\S]*?backgroundPanGestureActive\s*=\s*true[\s\S]*?emitBackgroundPanState\(true\)/);
    assert.match(shell, /releaseCanvasPointerState[\s\S]*?backgroundPanCandidate\s*=\s*null[\s\S]*?backgroundPanGestureActive\s*=\s*false[\s\S]*?emitBackgroundPanState\(false\)/);
    assert.match(dashboard, /project-takeoff-pan-state[\s\S]*?setActiveTool\('pan'\)[\s\S]*?setActiveTool\(restoreTool\)/);
});

test('pan mode and takeoff object dragging are mutually exclusive', () => {
    assert.match(editor, /const listening = !isTakeoffDrawingToolActive\(\) && !panning/);
    assert.match(editor, /window\.projectTakeoffSetTemporaryPan = function \(enabled\)/);
    assert.match(shell, /konvaPanMode \|\| konvaTemporaryPan \|\| \(explicitPan && isEmpty\)/);
    assert.match(shell, /!takeoffDrawing \|\| konvaTemporaryPan/);
    assert.doesNotMatch(shell, /const smartPan = currentMode === 'smart'/);
});
