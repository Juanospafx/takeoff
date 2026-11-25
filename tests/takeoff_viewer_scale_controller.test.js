const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const projectSource = read('assets/project_takeoff.js');
const viewerSource = read('assets/takeoff_viewer_controller.js');
const scaleSource = read('assets/takeoff_scale_controller.js');
const dashboardSource = read('pages/project_dashboard.php');

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

