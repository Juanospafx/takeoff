const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'runtime.js'), 'utf8');
const takeoffSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');
const parentSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_takeoff.js'), 'utf8');

test('PDF zoom refresh remains silent while the existing background is visible', () => {
    assert.match(source, /const isBackgroundRefresh = !loadAnnotations && !!canvas\.backgroundImage/);
    assert.match(source, /if \(!isBackgroundRefresh\) showDrawingLoading\(true\)/);
    assert.match(source, /if \(isBackgroundRefresh\) return/);
});

test('PDF detail waits for zoom to settle and follows the visible region', () => {
    const start = source.indexOf('function pdfDetailRenderScale');
    const schedule = source.indexOf('function schedulePdfRerender');
    const policy = source.slice(start, source.indexOf('function clearPdfDetail', start))
        + source.slice(schedule, source.indexOf('function setBg', schedule));
    const pending = new Map();
    let nextTimer = 0;
    let zoom = 0.35;
    const renders = [];
    const sandbox = {
        PDF_DETAIL_MAX_DIMENSION: 4096,
        PDF_DETAIL_MAX_PIXELS: 16_000_000,
        PDF_DETAIL_IDLE_MS: 220,
        PDF_DETAIL_MIN_GAIN: 1.2,
        pdfRerenderTimer: null,
        pdfDoc: {},
        pdfWorldWidth: 2592,
        pdfWorldHeight: 1728,
        canvas: {
            backgroundImage: {}, getZoom: () => zoom, getWidth: () => 1200, getHeight: () => 800,
            viewportTransform: [1, 0, 0, 1, 0, 0]
        },
        window: { devicePixelRatio: 2 },
        document: { hidden: false },
        currentPdfRenderScale: 1.2,
        currentPdfDetail: null,
        konvaIsPanning: false,
        isRenderingPage: false,
        pageNum: 3,
        clearTimeout: id => pending.delete(id),
        setTimeout: (callback, delay) => { pending.set(++nextTimer, { callback, delay }); return nextTimer; },
        renderPage: (...args) => renders.push(args)
    };
    vm.runInNewContext(policy, sandbox);
    assert.equal(sandbox.pdfDetailRenderScale(2592, 1728, 0.6, 2), 1.2);
    const capped = sandbox.pdfDetailRenderScale(2592, 1728, 4, 2);
    assert.ok(capped < 8);
    assert.ok(2592 * 1728 * capped ** 2 <= 16_000_001);
    sandbox.schedulePdfRerender();
    assert.equal(pending.size, 0);

    zoom = 1.2;
    sandbox.schedulePdfRerender();
    zoom = 1.6;
    sandbox.schedulePdfRerender();
    assert.equal(pending.size, 1);
    const [timer] = pending.values();
    assert.equal(timer.delay, 220);
    assert.deepEqual(renders, []);
    timer.callback();
    assert.deepEqual(renders, [[3, false]]);
    zoom = 4;
    sandbox.canvas.viewportTransform[4] = -1200;
    const detail = sandbox.requestedPdfDetail();
    assert.equal(detail.scale, 8);
    assert.equal(detail.x, 276);
    assert.ok((detail.right - detail.x) * detail.scale <= 4096);
    sandbox.currentPdfDetail = detail;
    assert.equal(sandbox.requestedPdfDetail(), null);
    sandbox.canvas.viewportTransform[4] = -2200;
    assert.ok(sandbox.requestedPdfDetail().x > detail.x);
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
