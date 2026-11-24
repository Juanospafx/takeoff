const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'runtime.js'), 'utf8');
const takeoffSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');
const parentSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_takeoff.js'), 'utf8');

test('PDF zoom refresh remains silent while the existing background is visible', () => {
    assert.match(source, /const isBackgroundRefresh = !loadAnnotations && !!canvas\.backgroundImage/);
    assert.match(source, /if \(!isBackgroundRefresh\) showDrawingLoading\(true\)/);
    assert.match(source, /if \(isBackgroundRefresh\) return/);
});

test('page switching uses a bounded screen-resolution raster without PNG transcoding', () => {
    assert.match(source, /const PAGE_SWITCH_MAX_DIMENSION = 3072/);
    assert.match(source, /function pdfRenderScaleForViewport\(baseViewport\)[\s\S]*?PAGE_SWITCH_MAX_DIMENSION \/ largestSide/);
    assert.match(source, /renderScale,/);
    assert.match(source, /currentPdfRenderScale = bitmap\.renderScale/);
    const raster = source.slice(source.indexOf('async function renderPageToBitmap'), source.indexOf('function pageSwitchPercentile'));
    assert.doesNotMatch(raster, /toBlob|toDataURL|image\/png/);
    assert.match(raster, /canvas:\s*renderCanvas/);
    assert.match(source, /commit\(new fabric\.Image\(bitmap\.canvas\)\)/);
    assert.match(source, /img\.excludeFromExport = true/);
});

test('stale PDF renders are cancelled or rejected before replacing the background', () => {
    assert.match(source, /cancelActivePdfRender\(\)/);
    assert.match(source, /if \(token !== renderToken\) return/);
    assert.match(source, /if \(error\?\.name === 'RenderingCancelledException'\) return/);
    assert.match(source, /if \(isRenderingPage\)[\s\S]*?renderToken\+\+;[\s\S]*?cancelActivePdfRender\(\)/);
});

test('page-switch completion reports latency and the parent hides its loader only for the latest sheet', () => {
    assert.match(source, /type:\s*'takeoff-page-rendered'/);
    assert.match(source, /p50:[\s\S]*?p95:[\s\S]*?p99:/);
    assert.match(parentSource, /type === 'takeoff-page-rendered'[\s\S]*?renderedPage !== Number\(drawingState\.selectedPage/);
    assert.match(parentSource, /drawingState\.pendingCanvasPage = null;[\s\S]*?hideTakeoffCanvasLoader\(\)/);
    const selection = parentSource.slice(parentSource.indexOf('function selectDrawingSheet'), parentSource.indexOf('function orderedDirectoryDocuments'));
    assert.doesNotMatch(selection, /frame\.addEventListener\('load'/);
    assert.doesNotMatch(selection, /syncEditorInfo\(\)/);
});

test('entering a sheet triggers exactly one navigation path and skips discarded preview work', () => {
    const sheetDelegation = parentSource.slice(parentSource.indexOf('function bindSheetListDelegation'), parentSource.indexOf('function bindDocumentListDelegation'));
    const clickPath = sheetDelegation.slice(sheetDelegation.indexOf("box.addEventListener('click'"));
    assert.match(clickPath, /selectDrawingSheet\(target\.doc, target\.page\)/);
    assert.doesNotMatch(clickPath, /renderSheetPreview\(target\.doc, target\.page\)/);
    const bindings = parentSource.slice(parentSource.indexOf('function bindDrawingDropdown'), parentSource.indexOf('window.cloneTakeoffWorkspaceForEstimate'));
    assert.doesNotMatch(bindings, /takeoffOpenSheetBtn[\s\S]*?addEventListener\('click'/);
    assert.match(parentSource, /openBtn\.onclick = \(\) => selectDrawingSheet\(doc, targetPage\)/);
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

test('PDF loading falls back from range requests and Retry restarts the document load', () => {
    assert.match(source, /function loadPdfDocument\(forceFullDownload = false\)/);
    assert.match(source, /disableRange:\s*forceFullDownload/);
    assert.match(source, /disableStream:\s*forceFullDownload/);
    assert.match(source, /if \(!forceFullDownload\)[\s\S]*loadPdfDocument\(true\)/,
        'a failed ranged load must retry once using a complete download');
    assert.match(source, /function retryPdfLoad\(\)[\s\S]*pdfDoc = null[\s\S]*loadPdfDocument\(true\)/);
    assert.match(source, /onclick="retryPdfLoad\(\)"/,
        'Retry must reload the PDF document instead of rendering with a null pdfDoc');
});

test('recoverable malformed TrueType hints do not flood the production console', () => {
    assert.match(source, /verbosity:\s*pdfjsLib\.VerbosityLevel\?\.ERRORS \?\? 0/);
});
