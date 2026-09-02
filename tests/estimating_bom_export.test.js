const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Exporter = require('../assets/estimating_export_service.js');

const root = path.resolve(__dirname, '..');
const dashboardHtml = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
const estimatingJs = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');

const sampleEstimate = {
    name: 'Office Electrical Expansion',
    settings: { globalLaborCost: 75 },
    groups: [
        {
            id: 'g1',
            name: '1.0 Conduit & Rough-in',
            items: [
                {
                    id: 'asm-1',
                    name: '1/2" EMT Conduit Overhead Branch Run',
                    description: 'Complete run with conduit, straps, couplings and wire',
                    itemType: 'assembly',
                    isAssembly: true,
                    costCode: '26-05-33.1',
                    costCategory: 'Rough-in',
                    uom: 'ft',
                    quantity: 100,
                    children: [
                        {
                            id: 'part-1',
                            catalogItemId: 101,
                            name: '1/2" EMT Conduit',
                            description: '10ft length',
                            costCode: '26-05-33',
                            costCategory: 'Material',
                            uom: 'ft',
                            quantity: 1.0, // 1 ft per assembly ft
                            unitMaterialCost: 2.20,
                            unitLabor: 0.05,
                            laborRate: 75,
                            notes: 'Allied tube'
                        },
                        {
                            id: 'part-2',
                            catalogItemId: 102,
                            name: '1/2" Steel One Hole Strap',
                            description: 'EMT support strap',
                            costCode: '26-05-29',
                            costCategory: 'Hardware',
                            uom: 'ea',
                            quantity: 0.2, // 1 every 5 ft
                            unitMaterialCost: 0.85,
                            unitLabor: 0.02,
                            laborRate: 75
                        },
                        {
                            id: 'part-3',
                            catalogItemId: 103,
                            name: '#12 THHN Copper Wire',
                            description: 'Single conductor wire',
                            costCode: '26-05-19',
                            costCategory: 'Wire',
                            uom: 'ft',
                            quantity: 3.2, // 3 conductors + ground allowance
                            unitMaterialCost: 0.38,
                            unitLabor: 0.01,
                            laborRate: 75
                        }
                    ]
                },
                {
                    id: 'item-1',
                    catalogItemId: 104,
                    name: '4" Square Steel Junction Box',
                    description: '2-1/8 in deep box',
                    itemType: 'part',
                    costCode: '26-05-33.2',
                    costCategory: 'Boxes',
                    uom: 'ea',
                    quantity: 25,
                    unitMaterialCost: 3.50,
                    unitLabor: 0.25,
                    laborRate: 75,
                    unitEquipmentCost: 0,
                    notes: 'Surface mount'
                }
            ]
        },
        {
            id: 'g2',
            name: '2.0 Distribution & Equipment',
            items: [
                {
                    id: 'equip-1',
                    catalogItemId: 201,
                    name: '100A 3-Phase Main Breaker Panel',
                    description: 'NEMA 1 indoor panelboard',
                    itemType: 'equipment',
                    costCode: '26-24-16',
                    costCategory: 'Panels',
                    uom: 'ea',
                    quantity: 2,
                    unitMaterialCost: 850.00,
                    unitLabor: 4.5,
                    laborRate: 85,
                    unitEquipmentCost: 50.00,
                    notes: 'Square D QO'
                }
            ]
        }
    ]
};

test('BOM Export - bomRows separates items by groups and positions children below assembly parent', () => {
    const rows = Exporter.bomRows(sampleEstimate, sampleEstimate.settings);

    // Group 1 has 1 assembly (1 parent + 3 children = 4 rows) + 1 regular item (1 row) = 5 rows
    // Group 2 has 1 equipment item (1 row) = 1 row
    // Total = 6 rows
    assert.equal(rows.length, 6);

    // Group 1 Rows
    assert.equal(rows[0].groupName, '1.0 Conduit & Rough-in');
    assert.equal(rows[0].rowType, 'assembly');
    assert.equal(rows[0].name, '1/2" EMT Conduit Overhead Branch Run');
    assert.equal(rows[0].displayName, '[Assembly] 1/2" EMT Conduit Overhead Branch Run');
    assert.equal(rows[0].quantity, 100);
    assert.equal(rows[0].uom, 'ft');

    // Assembly children immediately follow
    assert.equal(rows[1].groupName, '1.0 Conduit & Rough-in');
    assert.equal(rows[1].rowType, 'component');
    assert.equal(rows[1].parentName, '1/2" EMT Conduit Overhead Branch Run');
    assert.equal(rows[1].name, '1/2" EMT Conduit');
    assert.match(rows[1].displayName, /↳ 1\/2" EMT Conduit/);
    assert.equal(rows[1].ratio, 1.0);
    assert.equal(rows[1].quantity, 100); // 100 * 1.0
    assert.equal(rows[1].totalMaterialCost, 220); // 100 * 2.20

    assert.equal(rows[2].rowType, 'component');
    assert.equal(rows[2].name, '1/2" Steel One Hole Strap');
    assert.equal(rows[2].ratio, 0.2);
    assert.equal(rows[2].quantity, 20); // 100 * 0.2
    assert.equal(rows[2].totalMaterialCost, 17); // 20 * 0.85

    assert.equal(rows[3].rowType, 'component');
    assert.equal(rows[3].name, '#12 THHN Copper Wire');
    assert.equal(rows[3].ratio, 3.2);
    assert.equal(rows[3].quantity, 320); // 100 * 3.2

    // Parent assembly cost must match sum of its components
    const expectedAssemblyCost = rows[1].totalCost + rows[2].totalCost + rows[3].totalCost;
    assert.equal(rows[0].totalCost, expectedAssemblyCost);

    // Regular item in Group 1
    assert.equal(rows[4].groupName, '1.0 Conduit & Rough-in');
    assert.equal(rows[4].rowType, 'item');
    assert.equal(rows[4].name, '4" Square Steel Junction Box');
    assert.equal(rows[4].quantity, 25);
    assert.equal(rows[4].totalMaterialCost, 87.5); // 25 * 3.50
    assert.equal(rows[4].totalLaborHours, 6.25); // 25 * 0.25
    assert.equal(rows[4].totalLaborCost, 468.75); // 6.25 * 75

    // Group 2 Item
    assert.equal(rows[5].groupName, '2.0 Distribution & Equipment');
    assert.equal(rows[5].rowType, 'item');
    assert.equal(rows[5].name, '100A 3-Phase Main Breaker Panel');
    assert.equal(rows[5].quantity, 2);
    assert.equal(rows[5].totalMaterialCost, 1700);
    assert.equal(rows[5].totalEquipmentCost, 100);
    assert.equal(rows[5].totalLaborCost, 765); // 2 * 4.5 * 85
});

test('BOM Export - excelXml generates valid SpreadsheetML with styles and numeric cells', () => {
    const xml = Exporter.excelXml(sampleEstimate, sampleEstimate.settings);

    // XML declaration and Excel sheet processing instruction
    assert.match(xml, /<\?xml version="1\.0"/);
    assert.match(xml, /<\?mso-application progid="Excel\.Sheet"\?>/);
    assert.match(xml, /xmlns="urn:schemas-microsoft-com:office:spreadsheet"/);

    // Document Properties & Title
    assert.match(xml, /BILL OF MATERIALS \(BOM\) — Office Electrical Expansion/);

    // Group Banners
    assert.match(xml, /GROUP: 1\.0 Conduit &amp; Rough-in/);
    assert.match(xml, /GROUP: 2\.0 Distribution &amp; Equipment/);

    // Hierarchy & formatting (quotes escaped as &quot;)
    assert.match(xml, /\[Assembly\] 1\/2&quot; EMT Conduit Overhead Branch Run/);
    assert.match(xml, /↳ 1\/2&quot; EMT Conduit/);

    // Styles present
    assert.match(xml, /ss:ID="sGroupBanner"/);
    assert.match(xml, /ss:ID="sAsmText"/);
    assert.match(xml, /ss:ID="sCompItemName"/);
    assert.match(xml, /ss:ID="sGrandTotalLabel"/);

    // Numbers must use ss:Type="Number" for spreadsheet arithmetic
    assert.match(xml, /<Data ss:Type="Number">100<\/Data>/);
    assert.match(xml, /<Data ss:Type="Number">220<\/Data>/);

    // Grand Total Row
    assert.match(xml, /GRAND TOTAL \(Excluding component duplicates\)/);
});

test('BOM Export - bomCsv generates formatted UTF-8 CSV with hierarchical indentation', () => {
    const rows = Exporter.bomRows(sampleEstimate, sampleEstimate.settings);
    const csv = Exporter.bomCsv(rows);

    assert.equal(csv.startsWith('\uFEFF'), true);
    assert.match(csv, /Group,Type,Cost Code,Item,Description/);
    assert.match(csv, /1\.0 Conduit & Rough-in,Assembly,26-05-33\.1,"\[Assembly\] 1\/2"" EMT Conduit Overhead Branch Run"/);
    assert.match(csv, /1\.0 Conduit & Rough-in,Assembly Component,26-05-33,"  ↳ 1\/2"" EMT Conduit"/);
    assert.match(csv, /2\.0 Distribution & Equipment,Equipment,26-24-16,100A 3-Phase Main Breaker Panel/);
});

test('BOM Export UI - project_dashboard.php exposes Export BOM (Excel) option in options menu', () => {
    assert.match(dashboardHtml, /data-est-option="export-bom"/);
    assert.match(dashboardHtml, /fa-file-excel/);
    assert.match(dashboardHtml, /Export BOM \(Excel\)/);
});

test('BOM Export UI - project_estimating.js handles bom-excel and bom-csv export modes', () => {
    assert.match(estimatingJs, /option === 'export-bom'/);
    assert.match(estimatingJs, /Bill of Materials \(BOM - Excel\)/);
    assert.match(estimatingJs, /estimateExportMode/);
    assert.match(estimatingJs, /mode === 'bom-excel'/);
    assert.match(estimatingJs, /mode === 'bom-csv'/);
    assert.match(estimatingJs, /Exporter\.excelXml/);
    assert.match(estimatingJs, /Exporter\.bomRows/);
    assert.match(estimatingJs, /_BOM\.xls/);
});
