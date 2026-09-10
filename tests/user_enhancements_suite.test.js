const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('Feature 1: Customer Directory and Selector in Overview', () => {
    const customersPhp = fs.readFileSync(path.join(root, 'api/customers.php'), 'utf8');
    const dashboardPhp = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
    const overviewJs = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');

    // API exists and handles list / save with safety
    assert.match(customersPhp, /CREATE TABLE IF NOT EXISTS customers/);
    assert.match(customersPhp, /case\s+'save':/);
    assert.match(customersPhp, /case\s+'list':/);

    // Dashboard has customer selector and buttons
    assert.match(dashboardPhp, /id="poCustomerSelector"/);
    assert.match(dashboardPhp, /id="saveCustomerBtn"/);
    assert.match(dashboardPhp, /id="clearCustomerBtn"/);

    // Overview JS loads and handles customer directory
    assert.match(overviewJs, /function loadCustomersDirectory/);
    assert.match(overviewJs, /function populateCustomerSelector/);
    assert.match(overviewJs, /function saveCurrentCustomerToDirectory/);
    assert.match(overviewJs, /api\/customers\.php/);
});

test('Feature 2: Project Deep Clone with Takeoff and Estimates', () => {
    const projectModulePhp = fs.readFileSync(path.join(root, 'api/project_module.php'), 'utf8');

    // Checks for deep clone implementation and table duplication
    assert.match(projectModulePhp, /function project_deep_clone/);
    assert.match(projectModulePhp, /INSERT INTO folders/);
    assert.match(projectModulePhp, /INSERT INTO files/);
    assert.match(projectModulePhp, /INSERT INTO takeoffs/);
    assert.match(projectModulePhp, /INSERT INTO takeoff_layers/);
    assert.match(projectModulePhp, /INSERT INTO takeoff_count_markers/);
    assert.match(projectModulePhp, /INSERT INTO takeoff_linear_segments/);
    assert.match(projectModulePhp, /INSERT INTO estimates/);
    assert.match(projectModulePhp, /INSERT INTO estimate_items/);
    assert.match(projectModulePhp, /project_deep_clone\(\$pdo,\s*\$id,\s*\$newId\)/);
});

test('Feature 3: Bid Board Navigation & Highlighting', () => {
    const dashboardPhp = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
    const bidBoardJs = fs.readFileSync(path.join(root, 'assets/bid_board.js'), 'utf8');
    const bidBoardCss = fs.readFileSync(path.join(root, 'assets/bid_board.css'), 'utf8');

    // Dashboard Bid Board URL includes status and project_id
    assert.match(dashboardPhp, /bid_board\.php/);
    assert.match(dashboardPhp, /\?status='\s*\.\s*urlencode\(\$bbStatus\)\s*\.\s*'&project_id='\s*\.\s*\$bbPid/);

    // Bid Board JS parses params and highlights row
    assert.match(bidBoardJs, /applyUrlInitialFilter/);
    assert.match(bidBoardJs, /highlightTargetProject/);
    assert.match(bidBoardJs, /bb-row-highlight/);
    assert.match(bidBoardJs, /data-project-id/);

    // Bid Board CSS defines highlight animation
    assert.match(bidBoardCss, /\.bb-row-highlight/);
});

test('Feature 4: Primary Estimate & Bid Board Quote Value', () => {
    const footerJs = fs.readFileSync(path.join(root, 'assets/project_estimate_footer.js'), 'utf8');
    const estimatingJs = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
    const bidBoardJs = fs.readFileSync(path.join(root, 'assets/bid_board.js'), 'utf8');
    const bidBoardCss = fs.readFileSync(path.join(root, 'assets/bid_board.css'), 'utf8');

    // Footer renders Primary badge and Set as primary menu action
    assert.match(footerJs, /isPrimary/);
    assert.match(footerJs, /set-primary/);
    assert.match(footerJs, /Set as primary/);

    // Estimating handles set-primary action and persists metadata
    assert.match(estimatingJs, /actionName === 'set-primary'/);
    assert.match(estimatingJs, /primary_estimate_id/);
    assert.match(estimatingJs, /primary_quote_value/);
    assert.match(estimatingJs, /takeoff:primary-estimate-changed/);

    // Bid Board displays primary badge with quote value
    assert.match(bidBoardJs, /bb-primary-badge/);
    assert.match(bidBoardJs, /primaryQuoteValue/);
    assert.match(bidBoardCss, /\.bb-primary-badge/);
});

test('Feature 5: Download Drawings with Flattened Marks', () => {
    const editorPhp = fs.readFileSync(path.join(root, 'pages/editor.php'), 'utf8');
    const takeoffJs = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');

    // Editor exposes window.projectTakeoffDownloadAnnotatedDrawing
    assert.match(editorPhp, /window\.projectTakeoffDownloadAnnotatedDrawing/);
    assert.match(editorPhp, /page\.render/);
    assert.match(editorPhp, /konvaLayer/);
    assert.match(editorPhp, /window\.jspdf/);

    // Takeoff calls projectTakeoffDownloadAnnotatedDrawing on download
    assert.match(takeoffJs, /projectTakeoffDownloadAnnotatedDrawing/);
});

test('Feature 6: Estimating Parameters in Procore Order', () => {
    const estimatingJs = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');

    const expectedColumnKeys = [
        'name',
        'description',
        'costCode',
        'costCategory',
        'quantity',
        'uom',
        'unitMaterialCost',
        'waste',
        'materialMargin',
        'unitLabor',
        'laborRate',
        'difficulty',
        'laborMargin',
        'unitEquipmentCost',
        'equipmentQuantity',
        'equipmentMargin'
    ];

    expectedColumnKeys.forEach((key) => {
        const regex = new RegExp(`\\['${key}',`);
        assert.match(estimatingJs, regex);
    });

    // Ensure costCode comes before costCategory and quantity before uom
    const codeIdx = estimatingJs.indexOf("['costCode',");
    const catIdx = estimatingJs.indexOf("['costCategory',");
    const qtyIdx = estimatingJs.indexOf("['quantity',");
    const uomIdx = estimatingJs.indexOf("['uom',");

    assert.ok(codeIdx < catIdx, 'costCode must precede costCategory');
    assert.ok(catIdx < qtyIdx, 'costCategory must precede quantity');
    assert.ok(qtyIdx < uomIdx, 'quantity must precede uom');
});

test('Feature 7: Pre-saved Exclusions Presets Library', () => {
    const estimatingJs = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
    const estimatingCss = fs.readFileSync(path.join(root, 'assets/project_estimating.css'), 'utf8');

    // Storage key and helpers exist
    assert.match(estimatingJs, /EXCLUSION_PRESETS_KEY = 'takeoff\.exclusions\.presets'/);
    assert.match(estimatingJs, /function getExclusionPresets/);
    assert.match(estimatingJs, /function saveExclusionPresets/);
    assert.match(estimatingJs, /function addExclusionPreset/);
    assert.match(estimatingJs, /function deleteExclusionPreset/);

    // UI elements exist in listEditor
    assert.match(estimatingJs, /data-toggle-exclusion-presets/);
    assert.match(estimatingJs, /data-apply-exclusion-preset/);
    assert.match(estimatingJs, /data-save-as-exclusion-preset/);
    assert.match(estimatingJs, /est-presets-panel/);
    assert.match(estimatingJs, /est-preset-chip/);

    // CSS defines presets classes
    assert.match(estimatingCss, /\.est-presets-panel/);
    assert.match(estimatingCss, /\.est-preset-chip/);
});

test('Feature 8: Proposal Quantity-Only Mode Suppresses Group Subtotals and Prices', () => {
    const proposalJs = fs.readFileSync(path.join(root, 'assets/project_proposal.js'), 'utf8');

    // Defaults include quantityOnly
    assert.match(proposalJs, /quantityOnly:\s*false/);

    // Quick Simplification renders Quantity Only toggle
    assert.match(proposalJs, /renderToggle\('Quantity Only',\s*'quantityOnly'\)/);

    // Group subtotals in proposal-group-row are suppressed when quantityOnly or no cost columns
    assert.match(proposalJs, /const isQtyOnly = Boolean\(proposalSettings\.quantityOnly\);/);
    assert.match(proposalJs, /const hasCostColumns = !isQtyOnly && Boolean\(proposalSettings\.material\.itemTotalCost \|\| proposalSettings\.material\.combinedUnitCost\);/);
    assert.match(proposalJs, /const showGroupCost = hasCostColumns && Boolean\(proposalSettings\.costItems\.groupSubtotals \|\| proposalSettings\.material\.groupSubtotals\);/);
    assert.match(proposalJs, /\$\{showGroupCost \? `<span class="amount" style="float:right;">\$\{money\(group\.total\)\}<\/span>` : ''\}/);

    // Financial Summary and Total Box are hidden in quantityOnly mode
    assert.match(proposalJs, /\$\{isQtyOnly \? '' : renderSummary\(totalData\)\}/);
    assert.match(proposalJs, /\$\{!isQtyOnly && proposalSettings\.costItems\.estimateTotal \?/);
});
