'use strict';
const assert = require('assert');
global.window = {};
const Workspace = require('../assets/estimating_workspace_service.js');

const sourceItem = {
    id: 'parent', name: 'Locked feeder', takeoffLayerId: 'layer-7', locked: true,
    tags: ['service', 'critical'], multiplier: 2.5, quantity: 12,
    customScenario: { labor: 1.2 }, totalCost: 987.65,
    children: [{ id: 'child', parentItemId: 'parent', name: 'Child', multiplier: 3, tags: ['nested'] }]
};
const state = Workspace.workspace({ estimates: [{ id: 'source', name: 'Source', groups: [{ id: 'g', name: 'G', items: [sourceItem] }] }] }, 9);
Workspace.createEstimate(state, 'Copy', 'all');
const copied = Workspace.active(state).groups[0].items[0];
assert.notStrictEqual(copied.id, 'parent');
assert.strictEqual(copied.takeoffLayerId, null);
assert.strictEqual(copied.copiedFromTakeoffLayerId, 'layer-7');
assert.strictEqual(copied.locked, true);
assert.deepStrictEqual(copied.tags, ['service', 'critical']);
assert.strictEqual(copied.multiplier, 2.5);
assert.deepStrictEqual(copied.customScenario, { labor: 1.2 });
assert.strictEqual(copied.totalCost, 987.65);
assert.strictEqual(copied.children[0].parentItemId, copied.id);
assert.deepStrictEqual(copied.children[0].tags, ['nested']);
assert.strictEqual(copied.children[0].multiplier, 3);
console.log('estimating copy fidelity test passed');
