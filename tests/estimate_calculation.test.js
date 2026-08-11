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
near(calc.baseLaborHours, 5, 'labor uses base quantity, not material waste quantity');
near(calc.adjustedLaborHours, 6.25, 'difficulty factor');
near(calc.laborCost, 500, 'labor cost');
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

// Prompt verification cases A-D. Internal values retain full precision.
const caseA = Calc.calculateItem({ quantity: 10, unitMaterialCost: 80, waste: 0, materialMargin: 20 });
near(caseA.materialCost, 800, 'case A material cost');
near(caseA.unitMaterialSales, 100, 'case A unit sales');
near(caseA.materialSales, 1000, 'case A material sales');
near(caseA.profit, 200, 'case A profit');

const caseB = Calc.calculateItem({ quantity: 10, unitMaterialCost: 80, waste: 10, materialMargin: 20 });
near(caseB.materialCost, 880, 'case B material cost');
near(caseB.materialSales, 1100, 'case B material sales');
near(caseB.profit, 220, 'case B profit');

const cable = Calc.calculateItem({ quantity: 500, uom: 'ft', unitMaterialCost: 1.25, waste: 5, materialMargin: 20 });
near(cable.materialCost, 656.25, 'case C cable uses Part cost pipeline');
near(cable.materialSales, 820.3125, 'case C cable uses Part sales pipeline');

const labor = Calc.calculateItem({ quantity: 100, unitLabor: 3, laborUnitType: 'mins', difficulty: 1.2, laborRate: 40, laborMargin: 20 });
near(labor.adjustedLaborHours, 6, 'case D labor hours');
near(labor.laborCost, 240, 'case D labor cost');
near(labor.laborSales, 300, 'case D labor sales');

const categorySummary = Calc.calculateSummary([{ items: [item] }]);
near(categorySummary.byCategory.Materials.totalSales, calc.materialSales, 'material roll-up contains material only');
near(categorySummary.byCategory.Labor.totalSales, calc.laborSales, 'labor roll-up contains labor only');
near(categorySummary.byCategory.Equipment.totalSales, calc.equipmentSales, 'equipment roll-up contains equipment only');

const sequential = Calc.calculateSummary([{ items: [{ quantity: 1, unitMaterialCost: 100 }] }], {
    preTaxMarkups: [
        { type: 'percentage', percent: 10, base: 'subtotal_sales' },
        { type: 'percentage', percent: 10, base: 'subtotal_plus_previous_adjustments' }
    ]
});
near(sequential.preTaxMarkups[0].value, 10, 'first markup base');
near(sequential.preTaxMarkups[1].value, 11, 'markup can include previous adjustments');

const highValidMargin = Calc.calculateItem({ quantity: 1, unitMaterialCost: 10, materialMargin: 99.9 });
near(highValidMargin.materialSales, 10000, 'valid margin below 100 is not silently neutralized');
const invalidMargin = Calc.calculateItem({ quantity: 1, unitMaterialCost: 10, materialMargin: 100 });
assert.equal(invalidMargin.validation[0].field, 'materialMargin', 'margin >= 100 is explicitly invalid');
assert.ok(Number.isFinite(invalidMargin.materialSales), 'invalid margin never produces Infinity');

console.log('estimate_calculation tests passed');
