const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const estimating = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
const takeoff = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/takeoff.php'), 'utf8');
const Workspace = require(path.join(root, 'assets/estimating_workspace_service.js'));

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
    assert.match(estimating, /takeoff:estimating-link-requested/);
    assert.match(takeoff, /takeoff:estimating-links-requested/);
    assert.match(estimating, /takeoff:estimating-links-requested/);
    assert.match(takeoff, /const pendingLinks = \[\]/);
    assert.match(estimating, /Linked \$\{linked\} item\(s\) to Takeoff/);
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

test('Copy everything regenerates mutable identities and never shares a Takeoff layer binding', () => {
    const state = Workspace.workspace({ activeEstimateId: 'estimate-a', estimates: [{
        id: 'estimate-a', name: 'A', groups: [{ id: 'group-a', name: 'Electrical', items: [{
            id: 'item-a', name: 'Receptacle', takeoffLayerId: 'layer-a', catalogItemId: 77, quantity: 12
        }] }]
    }] }, 42);
    const source = state.estimates[0];
    Workspace.createEstimate(state, 'B', 'all');
    const copy = Workspace.active(state);
    assert.notEqual(copy.groups[0].id, source.groups[0].id);
    assert.notEqual(copy.groups[0].items[0].id, source.groups[0].items[0].id);
    assert.equal(copy.groups[0].items[0].takeoffLayerId, null);
    assert.equal(copy.groups[0].items[0].copiedFromTakeoffLayerId, 'layer-a');
    assert.equal(source.groups[0].items[0].takeoffLayerId, 'layer-a');
});

test('Takeoff state, canvas payloads and groups are estimate-scoped while scale is sheet-scoped', () => {
    assert.match(takeoff, /function groupBelongsToEstimate/);
    assert.match(takeoff, /filter\(group => groupBelongsToEstimate\(group, estimateId\)\)/);
    assert.match(takeoff, /String\(row\.estimateId \|\| ''\) === estimateId/);
    assert.match(takeoff, /filter\(layer => layerBelongsToEstimate\(layer\)\)\.map\(layerCanvasPayload\)/);
    assert.match(editor, /estimate_key: currentEstimateKey\(\)/);
    assert.match(api, /CREATE TABLE IF NOT EXISTS takeoff_estimate_states/);
    assert.match(api, /CREATE TABLE IF NOT EXISTS takeoff_estimate_scales/);
    assert.match(api, /FROM takeoff_sheet_scales WHERE drawing_id = \? AND page_number = \?/);
    assert.match(api, /estimate_key is required/);
});

test('Blank synchronization cannot migrate legacy groups or accept another estimate canvas snapshot', () => {
    assert.match(takeoff, /function scopeLegacyTakeoffGroupsOnce\(\)/);
    assert.match(takeoff, /scopeLegacyTakeoffGroupsOnce\(\);[\s\S]*ensureEstimateTakeoffWorkspace\(\)/);
    assert.doesNotMatch(takeoff, /function ensureEstimateTakeoffWorkspace[\s\S]*?takeoffState\.groups\.forEach[\s\S]*?function scopeLegacyTakeoffGroupsOnce/);
    assert.match(editor, /estimateKey: currentEstimateKey\(\)/);
    assert.match(takeoff, /estimateId !== activeEstimateId\(\)\) return/);
    assert.match(takeoff, /canvasSnapshots\[`\$\{estimateId\}:\$\{documentId\}`\]/);
});

test('queued Takeoff snapshots preserve their estimate destination', () => {
    assert.match(estimating, /pendingTakeoffByEstimate = new Map\(\)/);
    assert.match(estimating, /pendingTakeoffByEstimate\.set\(String\(estimateId/);
    assert.match(estimating, /reconcileGroups\(event\.detail\?\.activeEstimateId/);
});
