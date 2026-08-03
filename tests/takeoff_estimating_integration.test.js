const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../assets/takeoff_estimating_sync_service.js');
const Calc = require('../assets/estimate_calculation_service.js');

function snapshot(quantity = 10, unitCost = 25) {
    return [{
        id: 'group-electrical',
        name: 'Electrical',
        layers: [{ id: 'layer-copper', name: 'Copper THHN', quantity, unitCost, uom: 'ft' }]
    }];
}

test('one Takeoff group/layer becomes one Estimating group/item', () => {
    const groups = Sync.reconcile([], snapshot());
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 1);
    assert.equal(groups[0].items[0].takeoffLayerId, 'layer-copper');
    assert.equal(groups[0].items[0].quantity, 10);
});

test('a new Takeoff quantity updates the linked item without duplicating it', () => {
    const initial = Sync.reconcile([], snapshot(10));
    const updated = Sync.reconcile(initial, snapshot(362.98));
    assert.equal(updated.length, 1);
    assert.equal(updated[0].items.length, 1);
    assert.equal(updated[0].items[0].quantity, 362.98);
    assert.equal(updated[0].items[0].lastSyncedTakeoffQuantity, 362.98);
});

test('linked stale groups/items are removed when absent from Takeoff', () => {
    const initial = Sync.reconcile([], snapshot());
    assert.deepEqual(Sync.reconcile(initial, []), []);
});

test('manual Estimating items survive Takeoff reconciliation', () => {
    const existing = [{
        id: 'manual-group',
        name: 'Manual adjustments',
        items: [{ id: 'manual-1', name: 'Permit', quantity: 1, unitMaterialCost: 50, quantitySource: 'manual' }]
    }];
    const groups = Sync.reconcile(existing, snapshot());
    assert.equal(groups.length, 2);
    assert.equal(groups.flatMap(group => group.items).filter(item => item.id === 'manual-1').length, 1);
});

test('empty Takeoff folders are mirrored and same-name manual items stay separate', () => {
    const existing = [{
        id: 'manual-default',
        name: 'Default Group',
        items: [{ id: 'manual-fee', name: 'Permit', quantity: 1, quantitySource: 'manual' }]
    }];
    const takeoff = [
        { id: 'default', name: 'Default Group', layers: [] },
        { id: 'empty', name: 'Empty Folder', layers: [] }
    ];
    const groups = Sync.reconcile(existing, takeoff);
    assert.equal(groups.filter(group => group.takeoffMirror).length, 2);
    assert.equal(groups.filter(group => group.takeoffMirror).flatMap(group => group.items).length, 0);
    assert.equal(groups.find(group => !group.takeoffMirror).items[0].id, 'manual-fee');
});

test('Takeoff unit cost maps to monetary totals used by Estimating', () => {
    const groups = Sync.reconcile([], snapshot(10, 25));
    const summary = Calc.calculateSummary(groups, { marginMode: 'margin' });
    assert.equal(groups[0].items[0].unitMaterialCost, 25);
    assert.equal(summary.direct.materialCost, 250);
    assert.equal(summary.direct.totalCost, 250);
    assert.equal(summary.estimateTotal, 250);
});
