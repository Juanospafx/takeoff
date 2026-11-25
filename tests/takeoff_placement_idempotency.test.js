const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('one physical placement accepts only one click/tap compatibility event', () => {
    const guard = require(path.join(root, 'assets', 'takeoff_placement_guard.js'));
    const placements = guard.createPlacementGuard({ windowMs: 500, coordinateTolerance: 0.5 });
    const base = { layerId: 'fixture', pageNumber: 1, pointerId: 7, x: 100, y: 200 };

    const first = placements.begin({ ...base, eventType: 'tap', eventTimestamp: 1000 });
    const duplicate = placements.begin({ ...base, pointerId: '', eventType: 'click', eventTimestamp: 1020 });
    const deliberateSecondClick = placements.begin({ ...base, eventType: 'click', eventTimestamp: 1300 });

    assert.ok(first, 'the first event creates an operation id');
    assert.equal(duplicate, null, 'the compatibility event is rejected');
    assert.ok(deliberateSecondClick, 'a distinct same-type click remains a valid placement');
    assert.notEqual(deliberateSecondClick, first);
});

test('placement operations remain stable when the same native event is delivered twice', () => {
    const guard = require(path.join(root, 'assets', 'takeoff_placement_guard.js'));
    const placements = guard.createPlacementGuard();
    const event = {
        layerId: 'fixture', pageNumber: 1, pointerId: 3,
        eventType: 'click', eventTimestamp: 5000, x: 20, y: 30
    };

    assert.ok(placements.begin(event));
    assert.equal(placements.begin(event), null);
});

test('editor persists the placement operation on every new count marker', () => {
    const editor = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'pages', 'editor.php'), 'utf8');

    assert.match(page, /takeoff_placement_guard\.js/);
    assert.match(editor, /placement_operation_id:\s*placementOperationId/);
    assert.match(editor, /countPlacementGuard\?\.begin/);
    assert.match(editor, /function assignNewPlacementIdentity/);
    assert.equal((editor.match(/assignNewPlacementIdentity\(copy\)/g) || []).length, 2,
        'clipboard paste and parent-driven copy must receive fresh placement identities');
});
