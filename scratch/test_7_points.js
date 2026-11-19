const Calc = require('../assets/estimate_calculation_service.js');

console.log('Testing 7 Points in estimate_calculation_service:');

// 1. Test Assembly Ratio vs Double Calculation
const assemblyItem = {
    id: 'ass-1',
    name: 'Interior Wall Partition',
    type: 'assembly',
    quantity: 100, // Parent Qty = 100
    children: [
        {
            id: 'comp-1',
            name: 'Drywall 4x8',
            ratio: 0.05, // 0.05 sheets per 1 LF of wall
            unitCost: 15.00,
            unitLabor: 0.2
        },
        {
            id: 'comp-2',
            name: 'Metal Stud',
            ratio: 0.1, // 0.1 studs per 1 LF of wall
            unitCost: 8.00,
            unitLabor: 0.1
        }
    ]
};

const resultAss = Calc.calculateAssembly(assemblyItem, { globalLaborCost: 40 });
console.log('\n--- 1. Assembly Calculation ---');
console.log('Parent Qty:', assemblyItem.quantity);
console.log('Comp 1 ratio 0.05 -> computed quantity:', resultAss.childRows[0].item.quantity, '(Expected 5)');
console.log('Comp 2 ratio 0.1 -> computed quantity:', resultAss.childRows[1].item.quantity, '(Expected 10)');
console.log('Total Material Cost:', resultAss.materialCost, '(Expected: 5*15 + 10*8 = 75 + 80 = 155)');
console.log('Unit Material Cost:', resultAss.unitMaterialCost, '(Expected: 155 / 100 = 1.55)');

// Test Assembly with 0 Parent Qty (Point 5)
const assemblyZeroQty = { ...assemblyItem, quantity: 0 };
const resultZero = Calc.calculateAssembly(assemblyZeroQty, { globalLaborCost: 40 });
console.log('\n--- 5. Unit Cost with Qty = 0 ---');
console.log('Assembly Qty: 0');
console.log('Unit Material Cost with Qty=0:', resultZero.unitMaterialCost, '(Expected: 1.55, NOT 0)');

// 2. Test Post-tax Markups (Add vs Subtract)
console.log('\n--- 2. Post-Tax Markups (Add vs Subtract) ---');
const dummyEstimate = {
    groups: [
        {
            items: [
                {
                    id: 'it-1',
                    quantity: 10,
                    unitMaterialCost: 100,
                    margin: 0
                }
            ]
        }
    ],
    settings: {
        globalLaborCost: 35,
        preTaxMarkups: [],
        taxes: { Labor: 0, Materials: 0, Equipment: 0 },
        postTaxMarkups: [
            { id: 'm-add', name: 'Contingency', type: 'percent', percent: 10, operator: 'add', base: 'all_costs', active: true },
            { id: 'm-sub', name: 'Contract Discount', type: 'percent', percent: 5, operator: 'subtract', base: 'all_costs', active: true }
        ]
    }
};

const sumResult = Calc.calculateSummary(dummyEstimate.groups, dummyEstimate.settings);
console.log('Direct Total Sales:', sumResult.direct.totalSales);
const addMarkup = sumResult.postTaxMarkups.find(m => m.id === 'm-add');
const subMarkup = sumResult.postTaxMarkups.find(m => m.id === 'm-sub');
console.log('Add Markup Value:', addMarkup.value, '(Expected: positive 100)');
console.log('Subtract Markup (Discount) Value:', subMarkup.value, '(Expected: negative -50)');
console.log('Post Tax Total:', sumResult.postTaxTotal, '(Expected: 100 - 50 = 50)');
console.log('Estimate Total:', sumResult.estimateTotal, '(Expected: 1000 + 50 = 1050)');

// 3. Test Labor Waste %
console.log('\n--- 3. Labor Waste % ---');
const itemNoWaste = { id: 'it-l1', quantity: 10, unitLabor: 2, laborUnitType: 'hrs', difficulty: 1, waste: 0 };
const calcNoWaste = Calc.calculateItem(itemNoWaste, { globalLaborCost: 35 });
console.log('Labor Hours (0% waste):', calcNoWaste.adjustedLaborHours, '(Expected: 20)');

const itemWithWaste = { id: 'it-l2', quantity: 10, unitLabor: 2, laborUnitType: 'hrs', difficulty: 1, laborWaste: 10 };
const calcWithWaste = Calc.calculateItem(itemWithWaste, { globalLaborCost: 35 });
console.log('Labor Hours (10% labor waste):', calcWithWaste.adjustedLaborHours, '(Expected: 22)');
console.log('Labor Cost with 10% waste:', calcWithWaste.laborCost, '(Expected: 22 * 35 = 770)');

console.log('\nAll Calculation Service Tests Passed Successfully!');
