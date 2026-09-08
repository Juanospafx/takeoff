const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
const parentJs = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const parentCss = fs.readFileSync(path.join(root, 'assets/project_takeoff.css'), 'utf8');

test('project_dashboard.php calculates takeoffLocations for project layers across sheets', () => {
    assert.match(dashboard, /\$takeoffLocations\s*=\s*\[\];/);
    assert.match(dashboard, /takeoff_count_markers[\s\S]*GROUP BY layer_id, page_number/);
    assert.match(dashboard, /takeoff_linear_segments[\s\S]*GROUP BY layer_id, page_number/);
    assert.match(dashboard, /'takeoffLocations'\s*=>\s*\$takeoffLocations/);
});

test('project_dashboard.php markup contains List of Drawings elements and preview breakdown', () => {
    assert.match(dashboard, /id="takeoffDrawingActiveBar"/);
    assert.match(dashboard, /id="takeoffDrawingActivePill"/);
    assert.match(dashboard, /id="takeoffFilterAllSheets"/);
    assert.match(dashboard, /id="takeoffFilterItemSheets"/);
    assert.match(dashboard, /id="takeoffPreviewDetails"/);
    assert.match(dashboard, /id="takeoffPreviewItemsList"/);
    assert.match(dashboard, /id="takeoffOpenSheetBtn"/);
});

test('project_takeoff.js implements getSheetTakeoffSummary and updates buildSheets', () => {
    assert.match(parentJs, /function getSheetTakeoffSummary\(docId,\s*pageNumber\)/);
    assert.match(parentJs, /liveSnapshot\.layers\.forEach/);
    assert.match(parentJs, /window\.ProjectState\?\.takeoffLocations/);
    assert.match(parentJs, /hasActiveItem:\s*activeItemMarks\s*>\s*0/);
    assert.match(parentJs, /takeoffSummary:\s*summary/);
    assert.match(parentJs, /hasTakeoffs:\s*summary\.hasAnyTakeoff \|\| Boolean\(saved\.hasTakeoffs\)/);
});

test('project_takeoff.js updates active item bar and provides List of Drawings sheet marks and filtering', () => {
    assert.match(parentJs, /function renderActiveDrawingItemBar\(\)/);
    assert.match(parentJs, /takeoffDrawingActiveDot/);
    assert.match(parentJs, /takeoffFilterItemCount/);
    assert.match(parentJs, /pro-sheet-item-mark/);
    assert.match(parentJs, /drawingState\.filterMode === 'item'/);
    assert.match(parentJs, /takeoffOpenSheetBtn/);
    assert.match(parentJs, /takeoffPreviewItemsList/);
});

test('project_takeoff.css eliminates curved bracket borders and styles List of Drawings badges', () => {
    // Flat vertical pill accent bar via ::before instead of border-left on rounded button
    assert.match(parentCss, /\.pro-drawing-row::before,\s*\.pro-sheet-row::before\s*\{[\s\S]*width:\s*3\.5px;/);
    assert.match(parentCss, /\.pro-drawing-row\.active::before,\s*\.pro-sheet-row\.active::before\s*\{\s*background:\s*#1f6fb2;\s*\}/);
    // Badges and active bar
    assert.match(parentCss, /\.pro-sheet-item-mark/);
    assert.match(parentCss, /\.pro-mark-dot/);
    assert.match(parentCss, /\.pro-drawing-active-bar/);
    assert.match(parentCss, /\.pro-preview-takeoff-section/);
    assert.match(parentCss, /\.pro-open-sheet-btn/);
    // Dark theme support
    assert.match(parentCss, /\[data-theme="dark"\] \.pro-drawing-dropdown/);
});
