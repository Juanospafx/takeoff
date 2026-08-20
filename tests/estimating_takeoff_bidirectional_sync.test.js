const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const estimating = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
const takeoff = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/takeoff.php'), 'utf8');

test('Estimating publishes active estimate items and Takeoff consumes the scoped snapshot', () => {
    assert.match(estimating, /takeoff:estimating-items-updated/);
    assert.match(estimating, /activeEstimateId: String\(state\.activeEstimateId\)/);
    assert.match(estimating, /groups: Workspace\.clone\(current\(\)\.groups\)/);
    assert.match(takeoff, /function syncEstimatingItemsToTakeoff/);
    assert.match(takeoff, /estimateId !== activeEstimateId\(\)/);
    assert.match(takeoff, /window\.addEventListener\('takeoff:estimating-items-updated'/);
});

test('manual estimate items create one deterministic Takeoff layer preserving group and catalog links', () => {
    assert.match(takeoff, /estitem_\$\{estimateId\}_\$\{itemId\}/);
    assert.match(takeoff, /estimatingItemId: itemId/);
    assert.match(takeoff, /catalogItemId: item\.catalogItemId \|\| null/);
    assert.match(takeoff, /estimatingGroupId: groupKey/);
    assert.match(takeoff, /takeoff:estimating-link-requested/);
    assert.match(estimating, /takeoff:estimating-link-requested/);
    assert.match(estimating, /found\.item\.takeoffLayerId = String\(detail\.layerId\)/);
});

test('Takeoff quantity snapshots are estimate-addressed and inactive estimates reject them', () => {
    assert.match(takeoff, /activeEstimateId: String\(state\.activeEstimateId \|\| ''\)/);
    assert.match(estimating, /event\.detail\?\.activeEstimateId[\s\S]*?state\.activeEstimateId[\s\S]*?return/);
    assert.match(takeoff, /layerBelongsToEstimate\(layer, targetEstimateId\)/);
});

test('Takeoff persists estimate and item bindings in layer metadata', () => {
    assert.match(takeoff, /estimate_id: layer\.estimateId/);
    assert.match(takeoff, /estimating_item_id: layer\.estimatingItemId/);
    assert.match(editor, /estimate_id: payload\.estimate_id/);
    assert.match(editor, /estimating_item_id: payload\.estimating_item_id/);
    assert.match(editor, /estimating_item_id: layer\.metadata_json\?\.estimating_item_id/);
});

test('Takeoff API no longer writes silently into the first project estimate', () => {
    const saveBlock = api.slice(api.indexOf("case 'save_state'"));
    assert.doesNotMatch(saveBlock, /ensure_project_estimate\(/);
    assert.doesNotMatch(saveBlock, /sync_estimate_items\(/);
    assert.match(saveBlock, /Estimating is the sole writer of estimate_items/);
});
