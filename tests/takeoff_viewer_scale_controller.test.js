const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const projectSource = read('assets/project_takeoff.js');
const viewerSource = read('assets/takeoff_viewer_controller.js');
const scaleSource = read('assets/takeoff_scale_controller.js');
const dashboardSource = read('pages/project_dashboard.php');

test('workspace shortcuts route to the tools and respect editing and dialog context', () => {
    const dom = new JSDOM(`
        <header id="projectWorkspaceHeader"></header><button id="bt-header-collapse-btn"></button>
        <section id="tab-takeoff" class="active"></section><div id="takeoffWorkspace"></div>
        <input id="field"><div role="dialog" aria-modal="true"><button data-keyboard-accept>OK</button></div>
    `);
    try {
        const { window } = dom;
        const { document } = window;
        const $ = id => document.getElementById(id);
        const viewerState = {};
        const selectionState = { selectedGroupIds: [], selectedObjectIds: [] };
        const calls = [];
        const noop = () => {};
        $('takeoffWorkspace').requestFullscreen = async () => { calls.push('fullscreen'); };
        const controller = require('../assets/takeoff_viewer_controller.js').create({
            dom: { document, window, getElement: $ },
            state: { viewerState, selectionState, takeoffState: {} },
            actions: {
                callEditor: name => { calls.push(name); return true; },
                esc: String,
                clearActiveTakeoffLayer: noop, renderTakeoffPanel: noop,
                patchTakeoffSelectionClassesDom: () => true,
                updateSubheadSelectedItem: noop, renderInspector: noop, pushTakeoffHistory: noop,
                syncTakeoffFromCanvasSnapshot: noop,
                undoTakeoff: () => calls.push('undo'), redoTakeoff: () => calls.push('redo')
            }
        });
        const handle = controller.bindKeyboardShortcuts(noop);
        const press = (key, options = {}) => handle({ key, target: document.body, ...options });
        for (const [key, tool] of Object.entries({ v: 'smart', m: 'measure', c: 'cloud', n: 'text', a: 'multi-select' })) {
            assert.equal(press(key), true);
            assert.equal(viewerState.activeTool, tool);
        }
        assert.equal(press('z', { ctrlKey: true }), true);
        assert.equal(press('Z', { ctrlKey: true, shiftKey: true }), true);
        assert.deepEqual(calls.slice(-2), ['undo', 'redo']);
        assert.equal(press('f'), true);
        assert.equal(calls.at(-1), 'fullscreen');
        assert.equal(press('h'), true);
        assert.equal($('projectWorkspaceHeader').hidden, true);
        assert.equal(press('h'), true);
        assert.equal($('projectWorkspaceHeader').hidden, false);
        assert.equal(press('Enter'), true);
        assert.equal(calls.at(-1), 'projectTakeoffFinishActiveDraft');
        selectionState.selectedObjectIds = ['item'];
        assert.equal(press('Delete'), true);
        assert.deepEqual(calls.slice(-2), ['projectTakeoffDeleteSelection', 'projectTakeoffSnapshot']);
        assert.equal(press('Delete', { target: $('field') }), false);
        assert.equal(press('z', { target: $('field'), ctrlKey: true }), false);
        document.body.dataset.readOnly = 'true';
        assert.equal(press('Delete'), false);
        assert.equal(press('c'), false);
        $('tab-takeoff').classList.remove('active');
        assert.equal(press('v'), false);
        const dialog = document.querySelector('[role="dialog"]');
        const accept = dialog.querySelector('button');
        dialog.getClientRects = accept.getClientRects = () => [{}];
        accept.addEventListener('click', () => calls.push('accept'));
        assert.equal(press('Enter'), true);
        assert.equal(calls.at(-1), 'accept');
        accept.disabled = true;
        assert.equal(press('Enter'), false);
    } finally {
        dom.window.close();
    }
});

test('project takeoff stays below the 512 KiB Phase 3 target', () => {
    const bytes = Buffer.byteLength(projectSource.replace(/\r\n/g, '\n'), 'utf8');
    assert.ok(bytes < 512 * 1024, `project_takeoff.js is ${bytes} bytes`);
});

test('dashboard loads both classic controllers before project_takeoff with filemtime cache keys', () => {
    const viewerIndex = dashboardSource.indexOf('takeoff_viewer_controller.js');
    const scaleIndex = dashboardSource.indexOf('takeoff_scale_controller.js');
    const projectIndex = dashboardSource.indexOf('project_takeoff.js');

    assert.ok(viewerIndex >= 0 && viewerIndex < projectIndex);
    assert.ok(scaleIndex >= 0 && scaleIndex < projectIndex);
    assert.match(dashboardSource, /takeoff_viewer_controller\.js\?v=<\?= filemtime/);
    assert.match(dashboardSource, /takeoff_scale_controller\.js\?v=<\?= filemtime/);
});

test('dashboard loads the save coordinator before project_takeoff with a filemtime cache key', () => {
    const coordinatorIndex = dashboardSource.indexOf('takeoff_save_coordinator.js');
    const projectIndex = dashboardSource.indexOf('project_takeoff.js');
    assert.ok(coordinatorIndex >= 0 && coordinatorIndex < projectIndex);
    assert.match(dashboardSource, /takeoff_save_coordinator\.js\?v=<\?= filemtime/);
});

test('main file keeps thin compatibility wrappers and grouped dependency injection', () => {
    assert.match(projectSource, /window\.TakeoffViewerController\.create\(\{[\s\S]*state:\s*\{[\s\S]*actions:\s*\{/);
    assert.match(projectSource, /window\.TakeoffScaleController\.create\(\{[\s\S]*dom:\s*\{[\s\S]*actions:\s*\{/);
    assert.match(projectSource, /function runViewerCommand\(\.\.\.args\)\s*\{\s*return takeoffViewerController\.runViewerCommand\(\.\.\.args\)/);
    assert.match(projectSource, /function openScalePanel\(\.\.\.args\)\s*\{\s*return takeoffScaleController\.openScalePanel\(\.\.\.args\)/);
    assert.doesNotMatch(projectSource, /function ensureViewerLayersPopover\(\)\s*\{\s*if \(\$\('takeoffViewerLayersPopover'\)\)/);
    assert.doesNotMatch(projectSource, /function editorDocument\(\)\s*\{\s*const win = takeoffWindow\(\)/);
});

test('viewer and scale modules preserve controller behavior and iframe port calls', () => {
    assert.match(viewerSource, /function runTool\(command\)[\s\S]*callEditor\('projectTakeoffSetTool'/);
    assert.match(viewerSource, /function runViewerCommand\(command\)[\s\S]*callEditor\('projectTakeoffFitToView'/);
    assert.match(viewerSource, /function showPrepared\(command, type = 'info'\)[\s\S]*postMessage\(\{ type: 'editor-show-toast'/);
    assert.match(scaleSource, /function applyScalePreset\(value\)[\s\S]*callEditor\('applyScalePreset'/);
    assert.match(scaleSource, /function applyManualScale\(\)[\s\S]*callEditor\('finishCal', true, applyAll\)/);
});

test('controller factories expose the legacy entry points', () => {
    const viewer = require('../assets/takeoff_viewer_controller.js');
    const scale = require('../assets/takeoff_scale_controller.js');
    assert.equal(typeof viewer.create, 'function');
    assert.equal(typeof scale.create, 'function');

    const fakeDocument = { querySelectorAll: () => [], addEventListener: () => {} };
    const controller = viewer.create({
        state: { viewerState: {}, takeoffState: {}, selectionState: {}, drawingState: {} },
        dom: { getElement: () => null, document: fakeDocument, window: {} },
        actions: {}
    });
    controller.setActiveTool('pan');
    assert.equal(typeof controller.runViewerCommand, 'function');
    assert.equal(typeof controller.clearActiveRowMenuAnchor, 'function');
});

