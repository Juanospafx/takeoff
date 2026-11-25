const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
const source = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const overview = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets/editor/runtime.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/project_takeoff.css'), 'utf8');

test('sheet preview keeps its complete details and open-sheet action', () => {
    assert.match(dashboard, /id="takeoffPreviewDetails"/);
    assert.match(dashboard, /id="takeoffPreviewItemsList"/);
    assert.match(dashboard, /id="takeoffOpenSheetBtn"/);
});

test('drawing selector is centered by CSS inside the live Takeoff viewer', () => {
    assert.match(css, /\.pro-takeoff-viewer\s*\{[\s\S]*?position:\s*relative;/);
    assert.match(css, /\.pro-drawing-modal-overlay\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?place-items:\s*center;/);
    assert.match(css, /\.pro-takeoff-viewer\s*>\s*\.pro-drawing-modal-overlay[\s\S]*?\.pro-drawing-dropdown\s*\{[\s\S]*?position:\s*relative;[\s\S]*?width:\s*min\(840px,\s*100%\);[\s\S]*?height:\s*min\(400px,\s*100%\);/);
    assert.match(source, /function ensureDrawingDropdownPortal\(\)[\s\S]*?querySelector\('\.pro-takeoff-viewer'\)[\s\S]*?overlay\.appendChild\(panel\)/);
    assert.doesNotMatch(source, /document\.body\.appendChild\(panel\)/);
    assert.doesNotMatch(source, /visualViewport|viewportLeft|viewportTop/);
    assert.doesNotMatch(source, /panel\.style\.(left|top|width|height|transform)/);
});

test('sheet preview preserves the document colors on white and keeps Open Sheet visible', () => {
    assert.match(css, /\.pro-drawing-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*3fr\)\s*minmax\(0,\s*4fr\)\s*minmax\(0,\s*3fr\);[\s\S]*?overflow:\s*hidden;/);
    assert.match(css, /\.pro-preview-container\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)\s*auto;[\s\S]*?overflow-y:\s*auto;/);
    assert.match(css, /\.pro-preview-box canvas,[\s\S]*?\.pro-preview-box img\s*\{[\s\S]*?object-fit:\s*contain;[\s\S]*?object-position:\s*center;[\s\S]*?background:\s*#ffffff\s*!important;[\s\S]*?filter:\s*none\s*!important;/);
    assert.match(css, /\.pro-open-sheet-btn\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?bottom:\s*0;/);
    assert.match(source, /page\.render\(\{\s*canvasContext:\s*ctx,\s*viewport,\s*background:\s*'#ffffff'\s*\}\)/);
    assert.match(overview, /if \(isTakeoffJob\) renderParams\.background = '#ffffff';[\s\S]*?page\.render\(renderParams\)/);
});

test('opening the dropdown loads only the visible PDF and keeps takeoff summaries stable', () => {
    const openBlock = source.slice(source.indexOf('function openDrawingDropdown()'), source.indexOf('function closeDrawingDropdown()'));
    assert.doesNotMatch(openBlock, /warmDrawingMetadata\(\)/);
    assert.doesNotMatch(source, /\(now\s*-\s*cached\.ts\)\s*<\s*220/);
    assert.match(source, /cached\.sourceRef\s*===\s*sourceRef/);
    assert.match(source, /function invalidateTakeoffSheetSummary\(docId = null\)[\s\S]*?if \(docId === null\) \{[\s\S]*?docSummaryMemo\.clear\(\)/,
        'metadata shared by multiple drawings must clear every warm summary when no document is specified');
});

test('preview rendering is lazy, debounced, cancellable, and stale-safe', () => {
    assert.match(source, /const PREVIEW_DEBOUNCE_MS\s*=\s*200;/);
    assert.match(source, /activeSheetHoverTimer\s*=\s*setTimeout\([\s\S]*?\},\s*200\);/);
    assert.match(source, /addEventListener\('mouseout',[\s\S]*?cancelScheduledPreview\(\)/);
    assert.match(source, /new IntersectionObserver\(/);
    assert.match(source, /loading="lazy"\s+decoding="async"/);
    assert.match(source, /await waitForPreviewIdle\(\)/);
    assert.match(source, /requestId\s*!==\s*drawingState\.thumbnailRequest\s*\|\|\s*!drawingState\.dropdownOpen/);
    assert.match(source, /function cancelPreviewRendering\(\)[\s\S]*?activePreviewRenderTask\.cancel\(\)[\s\S]*?takeoffCancelThumbnailRender[\s\S]*?cancelTakeoffJobs/);
    assert.match(source, /document\.elementFromPoint\(lastSheetPointer\.x, lastSheetPointer\.y\)/);
    assert.match(source, /sheetPreviewScheduler\?\.\(pointedRow\)/);
});

test('preview reuses the loaded viewer PDF and renders only one low-resolution page', () => {
    assert.match(source, /getViewerPreviewThumb\(doc, targetPage, requestId\)/);
    assert.match(source, /callEditor\('takeoffRenderThumbnail',\s*targetPage,\s*PREVIEW_THUMB_MAX_DIMENSION\)/);
    assert.match(source, /const PREVIEW_THUMB_MAX_DIMENSION\s*=\s*800;/);
    assert.match(overview, /const TAKEOFF_PREVIEW_MAX_DIMENSION\s*=\s*800;/);
    assert.match(editor, /const THUMBNAIL_MAX_DIMENSION\s*=\s*800;/);
    assert.match(editor, /const page = await pdfDoc\.getPage\(pg\)/);
    assert.doesNotMatch(editor.slice(editor.indexOf('async function takeoffRenderThumbnail'), editor.indexOf('function takeoffGetDocumentInfo')), /for\s*\(/);
});

test('thumbnail caches are versioned LRU caches with bounded memory', () => {
    assert.match(source, /const PREVIEW_THUMB_CACHE_VERSION\s*=\s*'white-v3'/);
    assert.match(source, /doc\?\.version[\s\S]*Number\(pageNumber\)/);
    assert.match(source, /thumbnailCacheLimit:\s*40/);
    assert.match(source, /const oldestKey = drawingState\.thumbnailCache\.keys\(\)\.next\(\)\.value;[\s\S]*?thumbnailCache\.delete\(oldestKey\)/);
    assert.match(overview, /const TAKEOFF_PREVIEW_CACHE_LIMIT\s*=\s*80;/);
    assert.match(overview, /const TAKEOFF_PREVIEW_CACHE_VERSION\s*=\s*'white-v3'/);
    assert.match(overview, /URL\.revokeObjectURL\(oldestUrl\)/);
});

test('large drawing sheet lists are virtualized and use delegated events', () => {
    assert.match(source, /const SHEET_VIRTUAL_THRESHOLD\s*=\s*60;/);
    assert.match(source, /function renderVirtualSheetWindow\(force = false\)/);
    assert.match(source, /model\.items\.slice\(start, end\)/);
    assert.match(source, /function bindSheetListDelegation\(\)/);
    assert.doesNotMatch(source, /querySelectorAll\('\[data-drawing-page\]'\)\.forEach/);
    assert.match(css, /\.pro-drawing-list\.is-virtualized\s*\{[\s\S]*?overflow-anchor:\s*none;/);
});

test('sheet preview details are not rebuilt when only the virtual window changes', () => {
    assert.match(source, /drawingState\.previewDetailsSummary !== summary/);
    assert.match(source, /drawingState\.previewDetailsActiveId !== previewActiveId/);
});

test('duplicate thumbnail requests are coalesced and active worker renders can be cancelled', () => {
    assert.match(source, /drawingState\.previewPendingKey\s*===\s*key/);
    assert.match(source, /drawingState\.previewRenderedKey\s*=\s*key/);
    assert.match(overview, /activeTakeoffRenderTask\.cancel\(\)/);
    assert.match(overview, /msg\.type === 'clearTakeoff'[\s\S]*?activeTakeoffRenderTask/);
});
