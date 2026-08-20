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

test('two-click placement tracks an anchor and only then creates/persists the annotation', () => {
    assert.match(editor, /konvaStage\.on\('mousedown touchstart'[\s\S]*pendingPlacementTool[\s\S]*pendingPlacementStart = world/);
    assert.match(editor, /pendingPlacementPreview = new Konva\.Rect/);
    assert.match(editor, /if \(pendingPlacementStart\)[\s\S]*completePendingPlacement\(world\)[\s\S]*pendingPlacementStart = world/);
    const complete = section(editor, 'function completePendingPlacement', 'function initKonvaRuler');
    assert.match(complete, /tool === 'note'[\s\S]*createKonvaNote[\s\S]*startInlineNoteEdit\(note/);
    assert.match(complete, /tool === 'cloud'[\s\S]*createKonvaCloud/);
    assert.match(complete, /clearPlacementTool\(\)[\s\S]*saveCurrentPageAnnotations\(\)/);
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

test('the first click only anchors placement over the background or an existing Konva node', () => {
    const downStart = editor.indexOf("konvaStage.on('mousedown touchstart'", editor.indexOf('pendingPlacementTool'));
    assert.notEqual(downStart, -1);
    const downEnd = editor.indexOf("konvaStage.on('mousemove touchmove'", downStart);
    assert.notEqual(downEnd, -1);
    const pointerDown = editor.slice(downStart, downEnd);
    assert.match(pointerDown, /if \(pendingPlacementTool\)/);
    assert.doesNotMatch(pointerDown, /pendingPlacementTool\s*&&\s*isEmpty/,
        'an existing annotation/takeoff node must not consume the first placement click');
    assert.match(pointerDown, /e\.cancelBubble = true/);
    assert.match(pointerDown, /const world = screenToWorld\(pos\)/);
    assert.match(pointerDown, /if \(pendingPlacementStart\)[\s\S]*completePendingPlacement\(world\)[\s\S]*return[\s\S]*pendingPlacementStart = world/,
        'an existing anchor confirms; otherwise this click only stores the anchor');
});

test('first pointerup cannot create, while second click creates exactly one requested annotation', () => {
    const upStart = editor.indexOf("konvaStage.on('mouseup touchend', () =>", editor.indexOf('pendingPlacementStart'));
    assert.notEqual(upStart, -1);
    const upEnd = editor.indexOf("if (!konvaDrawing) return", upStart);
    assert.notEqual(upEnd, -1);
    const pointerUp = editor.slice(upStart, upEnd);
    assert.equal((pointerUp.match(/createKonva(?:Note|Cloud)\(/g) || []).length, 0,
        'the release paired with the first click only keeps the preview alive');
    assert.match(pointerUp, /if \(pendingPlacementTool && pendingPlacementStart\)[\s\S]*return/);
    const complete = section(editor, 'function completePendingPlacement', 'function initKonvaRuler');
    assert.equal((complete.match(/createKonvaNote\(/g) || []).length, 1);
    assert.equal((complete.match(/createKonvaCloud\(/g) || []).length, 1);
    assert.match(complete, /tool === 'note'[\s\S]*clearPlacementTool\(\)[\s\S]*startInlineNoteEdit/);
    assert.match(complete, /tool === 'cloud'[\s\S]*createKonvaCloud[\s\S]*clearPlacementTool\(\)/);
});

test('activation arms pending placement after smart-mode reset and tool-state cannot cancel it', () => {
    const start = section(editor, 'function startPlacementTool', 'function clearPlacementTool');
    assert.match(start, /setMode\('smart'\)[\s\S]*pendingPlacementTool = tool/,
        'smart reset must happen before arming placement');
    assert.doesNotMatch(start, /pendingPlacementTool = tool[\s\S]*setMode\('smart'\)/,
        'arming before setMode immediately clears the tool');
    assert.match(start, /projectTakeoffSetAnnotationPlacement\?\.\(true\)[\s\S]*pendingPlacementTool = tool/,
        'existing takeoff nodes must stop listening before the first placement click');
    const clear = section(editor, 'function clearPlacementTool', 'function addText');
    assert.match(clear, /projectTakeoffSetAnnotationPlacement\?\.\(false\)/,
        'takeoff node interaction must be restored when placement ends or is cancelled');
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8'),
        /annotationPlacement[\s\S]*const listening = !isTakeoffObjectInteractionBlocked\(\) && !panning && !state\.annotationPlacement/);
    const toolState = section(parent, "if (event.data?.type === 'project-takeoff-tool-state')", "if (event.data?.type === 'project-annotation-tool-state')");
    assert.match(toolState, /annotationPlacementActive/);
    assert.match(toolState, /reportedTool === 'smart' && annotationPlacementActive[\s\S]*viewerState\.activeTool/);
});
