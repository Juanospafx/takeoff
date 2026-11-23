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

test('drawing dropdown is positioned against the viewport instead of a clipped workspace ancestor', () => {
    assert.match(css, /\.pro-drawing-dropdown\s*\{[\s\S]*?position:\s*fixed;/);
    assert.match(source, /function positionDrawingDropdown\(\)/);
    assert.match(source, /Math\.min\(980,\s*Math\.max\(1,\s*window\.innerWidth\s*-\s*\(margin\s*\*\s*2\)\)\)/);
    assert.match(source, /addEventListener\('resize',\s*positionDrawingDropdown/);
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
    assert.match(source, /addEventListener\('mouseleave',\s*cancelScheduledPreview\)/);
    assert.match(source, /await waitForPreviewIdle\(\)/);
    assert.match(source, /requestId\s*!==\s*drawingState\.thumbnailRequest\s*\|\|\s*!drawingState\.dropdownOpen/);
});

test('duplicate thumbnail requests are coalesced and active worker renders can be cancelled', () => {
    assert.match(source, /drawingState\.previewPendingKey\s*===\s*key/);
    assert.match(source, /drawingState\.previewRenderedKey\s*=\s*key/);
    assert.match(overview, /activeTakeoffRenderTask\.cancel\(\)/);
    assert.match(overview, /msg\.type === 'clearTakeoff'[\s\S]*?activeTakeoffRenderTask/);
});
