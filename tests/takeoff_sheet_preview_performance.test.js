const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
const source = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const overview = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/project_takeoff.css'), 'utf8');

test('sheet preview keeps its complete details and open-sheet action', () => {
    assert.match(dashboard, /id="takeoffPreviewDetails"/);
    assert.match(dashboard, /id="takeoffPreviewItemsList"/);
    assert.match(dashboard, /id="takeoffOpenSheetBtn"/);
});

test('drawing selector is portaled and centered against the viewport as a modal', () => {
    assert.match(css, /\.pro-drawing-dropdown\s*\{[\s\S]*?position:\s*fixed;/);
    assert.match(css, /\.pro-drawing-dropdown\s*\{[\s\S]*?top:\s*50%;[\s\S]*?left:\s*50%;[\s\S]*?transform:\s*translate\(-50%,\s*-50%\);/);
    assert.match(source, /function ensureDrawingDropdownPortal\(\)[\s\S]*?document\.body\.appendChild\(panel\)/);
    assert.match(source, /function positionDrawingDropdown\(\)/);
    assert.match(source, /viewportLeft \+ \(viewportWidth \/ 2\)/);
    assert.match(source, /viewportTop \+ \(viewportHeight \/ 2\)/);
    assert.doesNotMatch(source.slice(source.indexOf('function positionDrawingDropdown()'), source.indexOf("window.addEventListener('resize'")), /getBoundingClientRect|triggerRect|openAbove/);
    assert.match(source, /addEventListener\('resize',\s*positionDrawingDropdown/);
});

test('sheet preview stays inside its panel and uses a legible high-resolution thumbnail', () => {
    assert.match(css, /\.pro-drawing-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*3fr\)\s*minmax\(0,\s*4fr\)\s*minmax\(0,\s*3fr\);[\s\S]*?overflow:\s*hidden;/);
    assert.match(css, /\.pro-preview-container\s*\{[\s\S]*?grid-template-rows:\s*minmax\(170px,\s*1fr\)\s*auto;[\s\S]*?overflow-y:\s*auto;/);
    assert.match(css, /\.pro-preview-box canvas,[\s\S]*?\.pro-preview-box img\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?object-fit:\s*contain;/);
    assert.match(overview, /const THUMB_TARGET_WIDTH\s*=\s*640;/);
    assert.match(source, /const targetWidth\s*=\s*Math\.min\(960,\s*Math\.max\(480,/);
});

test('opening the dropdown loads only the visible PDF and keeps takeoff summaries stable', () => {
    const openBlock = source.slice(source.indexOf('function openDrawingDropdown()'), source.indexOf('function closeDrawingDropdown()'));
    assert.doesNotMatch(openBlock, /warmDrawingMetadata\(\)/);
    assert.doesNotMatch(source, /\(now\s*-\s*cached\.ts\)\s*<\s*220/);
    assert.match(source, /cached\.sourceRef\s*===\s*sourceRef/);
    assert.match(source, /function invalidateTakeoffSheetSummary\(docId = null\)[\s\S]*?if \(docId === null\) \{[\s\S]*?docSummaryMemo\.clear\(\)/,
        'metadata shared by multiple drawings must clear every warm summary when no document is specified');
});

test('hover preview is deliberately delayed, cancellable, and main-thread fallback waits for idle time', () => {
    assert.match(source, /activeSheetHoverTimer\s*=\s*setTimeout\([\s\S]*?\},\s*280\);/);
    assert.match(source, /addEventListener\('mouseout',[\s\S]*?cancelScheduledPreview\(\)/);
    assert.match(source, /await waitForPreviewIdle\(\)/);
    assert.match(source, /requestId\s*!==\s*drawingState\.thumbnailRequest\s*\|\|\s*!drawingState\.dropdownOpen/);
    assert.match(source, /document\.elementFromPoint\(lastSheetPointer\.x, lastSheetPointer\.y\)/);
    assert.match(source, /sheetPreviewScheduler\?\.\(pointedRow\)/);
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
