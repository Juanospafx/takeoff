const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sync = require(path.join(root, 'assets', 'takeoff_estimating_sync_service.js'));
const takeoffSource = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.js'), 'utf8');

test('Takeoff colors survive the Takeoff to Estimating projection', () => {
    const group = { id: 'group-1', name: 'Electrical' };
    const red = sync.takeoffItem({ id: 'layer-red', name: 'Red item', color: '#ef4444', quantity: 1 }, group);
    const green = sync.takeoffItem({ id: 'layer-green', name: 'Green item', color: '#22c55e', quantity: 1 }, group);

    assert.deepEqual([red.color, green.color], ['#ef4444', '#22c55e']);
});

test('the project Takeoff projection includes each layer color', () => {
    const start = takeoffSource.indexOf('function estimateLineFromLayer');
    const end = takeoffSource.indexOf('function syncTakeoffToEstimating', start);
    assert.ok(start >= 0 && end > start, 'estimateLineFromLayer must exist');
    assert.match(takeoffSource.slice(start, end), /color:\s*layer\.color/);
});
