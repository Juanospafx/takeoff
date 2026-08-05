const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.php'), 'utf8');
const takeoffSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');
const parentSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_takeoff.js'), 'utf8');

test('PDF zoom refresh remains silent while the existing background is visible', () => {
    assert.match(source, /const isBackgroundRefresh = !loadAnnotations && !!canvas\.backgroundImage/);
    assert.match(source, /if \(!isBackgroundRefresh\) showDrawingLoading\(true\)/);
    assert.match(source, /if \(isBackgroundRefresh\) return/);
});

test('PDF quality tracks rendered resolution rather than a later canvas zoom', () => {
    assert.match(source, /Math\.ceil\(\(Number\(zoom\) \|\| 1\) \* 4\) \/ 4/);
    assert.match(source, /renderScale: viewportScale/);
    assert.match(source, /currentPdfRenderScale = bitmap\.renderScale/);
    assert.match(source, /pdfRenderScaleForZoom\(canvas\.getZoom\(\)\) > currentPdfRenderScale/);
});

test('stale PDF renders are cancelled or rejected before replacing the background', () => {
    assert.match(source, /cancelActivePdfRender\(\)/);
    assert.match(source, /if \(token !== renderToken\) return/);
    assert.match(source, /if \(error\?\.name === 'RenderingCancelledException'\) return/);
});

test('all editor zoom paths publish one authoritative zoom-change event', () => {
    assert.match(source, /type: 'project-takeoff-zoom-changed'/);
    assert.match(source, /notifyTakeoffZoomChanged\('wheel'\)/);
    assert.match(source, /notifyTakeoffZoomChanged\('pinch'\)/);
    assert.match(source, /notifyTakeoffZoomChanged\('fit'\)/);
    assert.match(source, /if \(zoomNotificationFrame !== null\) return/);
    assert.match(takeoffSource, /notifyTakeoffZoomChanged\?\.\('parent-api'\)/);
    assert.match(parentSource, /type === 'project-takeoff-zoom-changed'[\s\S]*?updateZoomUi\([^)]*Percent\)/);
});
