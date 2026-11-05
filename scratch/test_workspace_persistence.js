const Workspace = require('../assets/estimating_workspace_service.js');
const Calc = require('../assets/estimate_calculation_service.js');
const Adapter = require('../assets/estimating_assembly_expansion_adapter.js');

console.log('Testing Workspace Service Persistence & Normalization:');

// 1. Verify markup operator persistence
const rawMarkup = {
    id: 'm1',
    name: 'Discount',
    type: 'percent',
    percent: 10,
    amount: 0,
    base: 'subtotal_sales',
    operator: 'subtract',
    active: true
};

const normSettings = Workspace.settings({ preTaxMarkups: [rawMarkup] });
const normMarkup = normSettings.preTaxMarkups[0];
console.log('1. Normalized Markup operator:', normMarkup.operator, '(Expected: "subtract")');
if (normMarkup.operator !== 'subtract') throw new Error('Markup operator was stripped!');

// 2. Verify item laborWaste, ratio, factorOverride persistence
const rawItem = {
    id: 'it1',
    name: 'EMT Conduit',
    quantity: 50,
    laborWaste: 15,
    ratio: 2.5,
    factorOverride: 2.5,
    difficulty: 1.25
};

const normItem = Workspace.item(rawItem);
console.log('2. Normalized Item laborWaste:', normItem.laborWaste, '(Expected: 15)');
console.log('   Normalized Item ratio:', normItem.ratio, '(Expected: 2.5)');
console.log('   Normalized Item factorOverride:', normItem.factorOverride, '(Expected: 2.5)');
console.log('   Normalized Item difficulty:', normItem.difficulty, '(Expected: 1.25)');
if (normItem.laborWaste !== 15 || normItem.ratio !== 2.5 || normItem.difficulty !== 1.25) {
    throw new Error('Item properties were stripped!');
}

// 3. Verify settings laborWaste persistence
const rawSettings = {
    globalLaborCost: 40,
    laborWaste: 12.5,
    preTaxMarkups: [normMarkup]
};
const normFullSettings = Workspace.settings(rawSettings);
console.log('3. Normalized Settings laborWaste:', normFullSettings.laborWaste, '(Expected: 12.5)');
console.log('   Normalized Settings preTaxMarkups[0].operator:', normFullSettings.preTaxMarkups[0].operator, '(Expected: "subtract")');
if (normFullSettings.laborWaste !== 12.5 || normFullSettings.preTaxMarkups[0].operator !== 'subtract') {
    throw new Error('Settings properties were stripped!');
}

console.log('\nAll Workspace Normalization and Persistence Tests Passed 100%!');
