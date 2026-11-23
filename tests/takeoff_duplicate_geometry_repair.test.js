const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repair = require(path.join(root, 'assets', 'takeoff_object_repair_service.js'));
const editor = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'pages', 'editor.php'), 'utf8');

test('persisted count markers with different IDs but identical geometry collapse to one', () => {
    const base = { layer_client_uid: 'fixture-f2', page_number: 2, x: 123.5, y: 88.25,
        symbol: 'circle', color: '#2563eb', multiplier: 1, quantity: 1 };
    const result = repair.repair([
        { ...base, client_uid: 'original' },
        { ...base, client_uid: 'duplicate-1', updated_at: '2026-11-22T10:00:00Z' },
        { ...base, client_uid: 'duplicate-2', updated_at: '2026-11-23T10:00:00Z' }
    ], []);

    assert.equal(result.markers.length, 1);
    assert.equal(result.removedMarkers.length, 2);
    assert.deepEqual(result.affectedPages, [2]);
    assert.equal(result.changed, true);
    assert.equal(repair.repair(result.markers, result.segments).changed, false, 'repair must be idempotent');
});

test('nearby or functionally different objects are preserved', () => {
    const base = { layer_client_uid: 'fixture-f2', page_number: 2, x: 10, y: 20,
        symbol: 'circle', color: '#2563eb', multiplier: 1, quantity: 1 };
    const result = repair.repair([
        { ...base, client_uid: 'a' },
        { ...base, client_uid: 'b', x: 10.01 },
        { ...base, client_uid: 'c', quantity: 2 },
        { ...base, client_uid: 'd', color: '#ef4444' }
    ], []);

    assert.equal(result.markers.length, 4);
    assert.equal(result.changed, false);
});

test('editor loads the repair service and persists every repaired page', () => {
    assert.ok(page.indexOf('takeoff_object_repair_service.js') < page.indexOf('editor/takeoff.js'));
    assert.match(editor, /TakeoffObjectRepairService\?\.repair\(state\.markers, state\.segments\)/);
    assert.match(editor, /repairResult\.removedMarkers\.map\(ref => \(\{ type: 'marker', ref \}\)\)/);
    assert.match(editor, /repairResult\.removedSegments\.map\(ref => \(\{ type: 'segment', ref \}\)\)/);
    assert.match(editor, /trackTakeoffObjects\(removedObjects, true\)/,
        'duplicates must be persisted as explicit deletion tombstones');
    assert.match(editor, /repairResult\.affectedPages\.forEach\(page =>/);
    assert.match(editor, /scheduleTakeoffAutosave\(200\)/);
});
