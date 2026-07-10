const assert = require('node:assert/strict');
const Calc = require('../assets/estimate_calculation_service.js');

function near(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: expected ${expected}, got ${actual}`);
}

const item = {
    quantity: 10,
    unitMaterialCost: 100,
    waste: 10,
    materialMargin: 20,
    unitLabor: 30,
    laborUnitType: 'mins',
    laborRate: 80,
    difficulty: 1.25,
    laborMargin: 10,
    unitEquipmentCost: 25,
    equipmentQuantity: 2,
    equipmentMargin: 10,
    taxable: true
};

const calc = Calc.calculateItem(item, { marginMode: 'margin', globalLaborCost: 80 });
near(calc.adjustedQuantity, 11, 'waste adjusted quantity');
near(calc.materialCost, 1100, 'material cost');
near(calc.materialSales, 1375, 'material sales by margin');
near(calc.baseLaborHours, 5.5, 'labor minutes converted to hours');
near(calc.adjustedLaborHours, 6.875, 'difficulty factor');
near(calc.laborCost, 550, 'labor cost');
near(calc.equipmentCost, 50, 'equipment cost');

const summary = Calc.calculateSummary([{ id: 'g1', name: 'Group', items: [item] }], {
    marginMode: 'margin',
    globalLaborCost: 80,
    taxes: { Materials: 5, Labor: 2, Equipment: 0 },
    preTaxMarkups: [{ id: 'm1', name: 'Overhead', type: 'percentage', percent: 10, base: 'subtotal_sales', active: true }],
    postTaxMarkups: [{ id: 'm2', name: 'Bond', type: 'fixed_amount', amount: 100, base: 'subtotal_sales', active: true }]
});

assert.ok(summary.preTaxTotal > 0, 'pre-tax markup is calculated');
assert.ok(summary.totalTax > 0, 'tax is calculated');
assert.equal(summary.postTaxTotal, 100, 'fixed post-tax markup is calculated');
assert.ok(summary.estimateTotal > summary.direct.totalSales, 'estimate total includes markups and taxes');

const markup = Calc.calculateItem({ quantity: 2, unitMaterialCost: 50, materialMargin: 10 }, { marginMode: 'markup' });
near(markup.materialSales, 110, 'markup mode uses cost times markup');

console.log('estimate_calculation tests passed');
