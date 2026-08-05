const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'pages', 'project_dashboard.php'), 'utf8');
const parent = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_takeoff.js'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.php'), 'utf8');

function section(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return source.slice(start, end);
}

test('Notes and Cloud have distinct toolbar buttons and activate their placement APIs', () => {
    assert.match(dashboard, /data-tool-command="text"[^>]*title="Note"[\s\S]*?fa-note-sticky/);
    assert.match(dashboard, /data-tool-command="cloud"[^>]*title="Cloud"[\s\S]*?fa-cloud/);
    const tools = section(parent, 'function runTool', 'function runViewerCommand');
    const textBranch = section(tools, "if (command === 'text')", "if (command === 'cloud')");
    const cloudBranch = section(tools, "if (command === 'cloud')", "if (command === 'stamp')");
    assert.match(textBranch, /projectTakeoffSetTool', 'select'/);
    assert.match(textBranch, /callEditor\('addText'\)/);
    assert.doesNotMatch(textBranch, /projectTakeoffSetTool[^;]+\|\|/, 'truthy select must not short-circuit Notes');
    assert.match(cloudBranch, /projectTakeoffSetTool', 'select'/);
    assert.match(cloudBranch, /callEditor\('addCloud'\)/);
});

test('drag placement creates the requested annotation, persists it, and clears pending state', () => {
    assert.match(editor, /konvaStage\.on\('mousedown touchstart'[\s\S]*pendingPlacementTool[\s\S]*pendingPlacementStart = screenToWorld\(pos\)/);
    assert.match(editor, /pendingPlacementPreview = new Konva\.Rect/);
    assert.match(editor, /pendingPlacementTool === 'note'[\s\S]*createKonvaNote[\s\S]*startInlineNoteEdit\(note/);
    assert.match(editor, /pendingPlacementTool === 'cloud'[\s\S]*createKonvaCloud/);
    assert.match(editor, /clearPlacementTool\(\)[\s\S]*saveCurrentPageAnnotations\(\)/);
    const clear = section(editor, 'function clearPlacementTool', 'function addText');
    assert.match(clear, /pendingPlacementTool = null/);
    assert.match(clear, /pendingPlacementStart = null/);
    assert.match(clear, /pendingPlacementPreview\.destroy\(\)/);
    assert.match(clear, /project-annotation-tool-state/);
});

test('Notes transition from drag area to inline editing and persist or discard deterministically', () => {
    const edit = section(editor, 'function startInlineNoteEdit', 'function initKonvaRuler');
    assert.match(edit, /document\.createElement\('textarea'\)/);
    assert.match(edit, /const onInput[\s\S]*textNode\.text\(konvaEditingTextarea\.value\)/);
    assert.match(edit, /e\.key === 'Enter'[\s\S]*finish\(\)/);
    assert.match(edit, /const onBlur = \(\) => finish\(\)/);
    assert.match(edit, /const next[\s\S]*textNode\.text\([^;]*next\)[\s\S]*saveCurrentPageAnnotations\(\)/);
    assert.match(edit, /removeKonvaNote\(note\)/, 'an empty note must not persist');
});

test('Select, Pan, and Escape cancel pending annotation placement and restore the pointer', () => {
    const tools = section(parent, 'function runTool', 'function runViewerCommand');
    const selectPan = section(tools, "if (command === 'smart' || command === 'pan')", 'const modeMap');
    assert.match(selectPan, /callEditor\('clearPlacementTool'\)/);
    const escapeHandler = section(parent, "if (event.key === 'Escape')", "if ((event.ctrlKey || event.metaKey)");
    assert.match(escapeHandler, /callEditor\('clearPlacementTool'\)/);
    const clear = section(editor, 'function clearPlacementTool', 'function addText');
    assert.match(clear, /style\.cursor = 'default'/);
});
