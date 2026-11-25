const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'takeoff.php'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');

test('Takeoff autosave identifies only pages changed by this client', () => {
    assert.match(editor, /const dirtyTakeoffPages = new Set\(\)/);
    assert.match(editor, /dirtyTakeoffPages\.add\(Number\(pageNum \|\| 1\)\)/);
    assert.match(editor, /dirty_page_numbers: fallbackPages/);
    assert.match(editor, /dirtyTakeoffPageGenerations/);
});

test('server serializes and merges dirty pages without replacing other sheets', () => {
    assert.match(api, /function merge_takeoff_pages/);
    assert.match(api, /SELECT state_json FROM takeoff_estimate_states WHERE estimate_key = \? AND drawing_id = \? LIMIT 1 FOR UPDATE/);
    assert.match(api, /merge_takeoff_pages\(\$currentSnapshot, \$snapshot, \$dirtyPages\)/);
    assert.ok(api.indexOf('FOR UPDATE') < api.indexOf('DELETE FROM takeoff_count_markers WHERE layer_id IN'));
});

test('same-page saves merge by stable object id and detect same-object conflicts', () => {
    assert.match(editor, /dirty_object_ids: \[\.\.\.dirtyTakeoffObjects\.keys\(\)\]/);
    assert.match(editor, /deleted_object_ids: \[\.\.\.deletedTakeoffObjects\.keys\(\)\]/);
    assert.match(api, /function merge_takeoff_objects/);
    assert.match(api, /function assert_takeoff_object_versions/);
    assert.match(api, /code' => 'object_conflict'/);
    assert.match(api, /if \(\$dirtyObjectIds \|\| \$deletedObjectIds\)[\s\S]{0,120}merge_takeoff_objects/);
});

test('server makes placement retries idempotent before calculating quantities', () => {
    assert.match(api, /function normalize_takeoff_snapshot_objects/);
    assert.match(api, /placement_operation_id/);
    assert.match(api, /seenGeometrySignatures/);
    assert.match(api, /geometrySignature/);
    assert.match(api, /\$row\['points_json'\]/);
    assert.match(api, /\$snapshot = normalize_takeoff_snapshot_objects\(\$snapshot\)/);
    assert.ok(
        api.indexOf('$snapshot = normalize_takeoff_snapshot_objects($snapshot)')
            < api.indexOf('$snapshot = recalculate_takeoff_snapshot_quantities($snapshot)'),
        'duplicate operations must be removed before quantity calculation'
    );
});
