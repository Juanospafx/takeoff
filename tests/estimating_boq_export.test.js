const test = require('node:test');
const assert = require('node:assert/strict');
const Exporter = require('../assets/estimating_export_service.js');

const estimate = { name: 'Electrical Bid', groups: [{ id: 'g1', name: 'Floor 1', items: [
    { id: 'assembly-a', itemType: 'assembly', isAssembly: true, name: 'Device Assembly', quantity: 2,
        children: [
            { id: 'part-a', catalogItemId: 101, name: 'Duplex Receptacle', description: '20A white',
                costCode: '26-27-26', budgetCode: 'DEV', costCategory: 'Materials', uom: 'ea',
                quantity: 3, unitMaterialCost: 8.5, unitLabor: 10, laborUnitType: 'mins', laborRate: 85 },
            { id: 'part-b', catalogItemId: 102, name: 'Device Plate', uom: 'ea', quantity: 1, unitMaterialCost: 1.5 }
        ] },
    { id: 'loose-a', catalogItemId: 101, name: 'Duplex Receptacle', description: '20A white',
        costCode: '26-27-26', budgetCode: 'DEV', costCategory: 'Materials', uom: 'ea',
        quantity: 4, unitMaterialCost: 8.5, unitLabor: 10, laborUnitType: 'mins', laborRate: 85 }
] }] };

test('BOQ normal preserves assembly rows without duplicating embedded components', () => {
    const rows = Exporter.normalRows(estimate);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].Type, 'Assembly');
    assert.equal(rows[0].Item, 'Device Assembly');
    assert.equal(rows[0].Quantity, 2);
});

test('BOQ Flat removes assemblies and consolidates catalog parts at project quantity', () => {
    const rows = Exporter.flatRows(estimate);
    assert.equal(rows.length, 2);
    assert.equal(rows.some(row => row.Item === 'Device Assembly'), false);
    const receptacle = rows.find(row => row['Catalog Item ID'] === '101');
    assert.equal(receptacle.Quantity, 10);
    assert.equal(receptacle['Unit Material Cost'], 8.5);
    assert.equal(receptacle['Cost Code'], '26-27-26');
    assert.equal(receptacle.Description, '20A white');
    assert.equal(rows.find(row => row['Catalog Item ID'] === '102').Quantity, 2);
});

test('BOQ Flat expands sibling and nested assemblies exactly once', () => {
    const rows = Exporter.flatRows({ groups: [{ name: 'G', items: [
        { id: 'outer', isAssembly: true, quantity: 2, children: [
            { id: 'inner', isAssembly: true, quantity: 3, children: [
                { catalogItemId: 7, name: 'Fastener', uom: 'ea', quantity: 4 }
            ] }
        ] },
        { id: 'flat-parent', isAssembly: true, quantity: 5 },
        { id: 'flat-child', parentItemId: 'flat-parent', catalogItemId: 8, name: 'Bracket', uom: 'ea', quantity: 2 }
    ] }] });
    assert.equal(rows.find(row => row['Catalog Item ID'] === '7').Quantity, 24);
    assert.equal(rows.find(row => row['Catalog Item ID'] === '8').Quantity, 10);
});

test('CSV is Excel-friendly UTF-8 and safely escapes supplier text', () => {
    const csv = Exporter.csv([{ Item: 'Caja, "grande"', Description: 'Línea 1\nLínea 2', Quantity: 2 }]);
    assert.equal(csv.startsWith('\uFEFF'), true);
    assert.match(csv, /"Caja, ""grande"""/);
    assert.match(csv, /"Línea 1\nLínea 2"/);
    assert.match(csv, /\r\n/);
});

test('BOQ Flat hydrates aggregate assemblies from current Cost Catalog components', () => {
    const hydrated = Exporter.withCatalog({ groups: [{ name: 'G', items: [
        { id: 'estimate-assembly', catalogItemId: 50, isAssembly: true, quantity: 3, name: 'Old name' }
    ] }] }, {
        allItems: [
            { id: 50, name: 'Catalog Assembly', item_type: 'assembly', unit_of_measure: 'ea' },
            { id: 51, name: 'Catalog Part', item_type: 'part', unit_of_measure: 'ft', unit_cost: 4.25,
                description: 'Current catalog description', cost_code: 'C-51' }
        ],
        assemblyParts: [{ id: 9, assembly_catalog_item_id: 50, part_catalog_item_id: 51,
            quantity: 2, unit_cost_snapshot: 4 }]
    });
    const rows = Exporter.flatRows(hydrated);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Item, 'Catalog Part');
    assert.equal(rows[0].Quantity, 6);
    assert.equal(rows[0]['Catalog Item ID'], '51');
    assert.equal(rows[0]['Unit Material Cost'], 4.25, 'export shows the current Cost Catalog information');
    assert.equal(rows[0]['Cost Code'], 'C-51');
    assert.equal(Exporter.needsCatalog({ groups: [{ items: [{ isAssembly: true, catalogItemId: 50 }] }] }), true);
});

test('BOQ Flat identifies assemblies that cannot be safely broken down', () => {
    const unresolved = Exporter.unresolvedAssemblies({ groups: [{ items: [
        { id: 'legacy', isAssembly: true, name: 'Legacy aggregate' },
        { id: 'valid', isAssembly: true, children: [{ id: 'part', quantity: 1 }] }
    ] }] });
    assert.deepEqual(unresolved.map(item => item.id), ['legacy']);
});
