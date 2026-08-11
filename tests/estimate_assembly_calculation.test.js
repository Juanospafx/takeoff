const assert = require('node:assert/strict');
const Calc = require('../assets/estimate_calculation_service.js');
const Workspace = require('../assets/estimating_workspace_service.js');

function near(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 0.000001, `${label}: expected ${expected}, got ${actual}`);
}

const assembly = Workspace.item({
    id: 'assembly-1', itemType: 'assembly', quantity: 2,
    children: [
        { id: 'conduit', quantity: 3, unitMaterialCost: 10, materialMargin: 20, unitLabor: 10, laborRate: 60, laborMargin: 20 },
        { id: 'strap', quantity: 4, unitMaterialCost: 2.5, materialMargin: 20, unitLabor: 5, laborRate: 60, laborMargin: 20 }
    ]
});

assert.equal(assembly.isAssembly, true, 'workspace retains assembly identity');
assert.equal(assembly.children.length, 2, 'workspace retains normalized children');
const rolled = Calc.calculateItem(assembly);
near(rolled.materialCost, 80, 'assembly material cost rolls up extended children');
near(rolled.materialSales, 100, 'assembly material sales rolls up children');
near(rolled.adjustedLaborHours, 5 / 3, 'assembly labor hours roll up children');
near(rolled.laborCost, 100, 'assembly labor cost rolls up children');
near(rolled.laborSales, 125, 'assembly labor sales rolls up children');
near(rolled.unitMaterialCost, 40, 'assembly display unit cost');

const flatParent = Workspace.item({ id: 'a', isAssembly: true, quantity: 2 });
const flatChild = Workspace.item({ id: 'c', parentItemId: 'a', quantity: 3, unitMaterialCost: 10, materialMargin: 20 });
const summary = Calc.calculateSummary([{ id: 'g', name: 'G', items: [flatParent, flatChild] }]);
assert.equal(summary.rows.length, 1, 'flat assembly children are not also aggregate rows');
near(summary.direct.materialCost, 60, 'flat children are multiplied by assembly quantity once');
near(summary.direct.materialSales, 75, 'flat child sales are counted once');

const zero = Calc.calculateItem(Workspace.item({ isAssembly: true, quantity: 0, children: [{ quantity: 2, unitMaterialCost: 5 }] }));
assert.equal(zero.unitMaterialCost, 0, 'zero quantity has safe unit cost');
assert.ok(Number.isFinite(zero.totalCost), 'zero quantity never creates NaN/Infinity');

console.log('estimate assembly calculation tests passed');
