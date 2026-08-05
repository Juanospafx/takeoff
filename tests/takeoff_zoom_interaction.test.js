const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editor = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.php'), 'utf8');
const takeoff = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');
const project = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_takeoff.js'), 'utf8');

function bodyAfter(source, marker, endMarker) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing ${marker}`);
    const end = source.indexOf(endMarker, start + marker.length);
    assert.notEqual(end, -1, `missing ${endMarker} after ${marker}`);
    return source.slice(start, end);
}

test('wheel, trackpad pinch, fit, and the parent API report the resulting zoom', () => {
    assert.match(bodyAfter(editor, "addEventListener('wheel'", "}, { passive: false })"), /notifyTakeoffZoomChanged\('wheel'\)/);
    assert.match(bodyAfter(editor, "addEventListener('touchmove'", "}, { passive: false })"), /notifyTakeoffZoomChanged\('pinch'\)/);
    assert.match(bodyAfter(editor, 'function centerPdfAtZoom', 'function pdfRenderScaleForZoom'), /notifyTakeoffZoomChanged\('fit'\)/);
    assert.match(bodyAfter(editor, "canvas.on('mouse:wheel'", "window.addEventListener('beforeunload'"), /notifyTakeoffZoomChanged\('wheel'\)/);
    assert.match(bodyAfter(takeoff, 'window.projectTakeoffSetZoom = function', 'window.projectTakeoffGetZoom'), /notifyTakeoffZoomChanged\?\.\('parent-api'\)/);
});

test('zoom notifications use one throttled channel and never toggle the document loader', () => {
    const notifier = bodyAfter(editor, 'function notifyTakeoffZoomChanged', 'window.notifyTakeoffZoomChanged');
    assert.match(notifier, /requestAnimationFrame/);
    assert.match(notifier, /project-takeoff-zoom-changed/);
    assert.doesNotMatch(notifier, /showDrawingLoading/);
    assert.equal((editor.match(/type:\s*'project-takeoff-zoom-changed'/g) || []).length, 1);
    assert.equal((editor.match(/type:\s*'project-takeoff-zoom-state'/g) || []).length, 0);
});

test('the parent mirrors editor zoom into controls without feeding it back to the editor', () => {
    const handler = bodyAfter(project, "if (event.data?.type === 'project-takeoff-zoom-changed')", "if (event.data?.type !== 'takeoff-editor-ready')");
    assert.match(handler, /event\.source\s*!==\s*takeoffWindow\(\)/);
    assert.match(handler, /updateZoomUi\(/);
    assert.doesNotMatch(handler, /^\s*setZoom\(/m, 'an editor notification must not recursively set editor zoom');

    const updateUi = bodyAfter(project, 'function updateZoomUi', 'function currentZoomPercent');
    assert.match(updateUi, /takeoffZoomSlider/);
    assert.match(updateUi, /takeoffZoomPercent/);
    assert.doesNotMatch(updateUi, /projectTakeoffSetZoom|setZoom\(/);
});

test('buttons and slider remain command paths into the editor', () => {
    const commands = bodyAfter(project, 'function runViewerCommand', 'function showPrepared');
    assert.match(commands, /zoom-out[\s\S]*setZoom\(currentZoomPercent\(\)\s*-\s*10\)/);
    assert.match(commands, /zoom-in[\s\S]*setZoom\(currentZoomPercent\(\)\s*\+\s*10\)/);
    assert.match(project, /takeoffZoomSlider[\s\S]*addEventListener\('input',\s*event\s*=>\s*setZoom\(event\.target\.value\)\)/);
});
