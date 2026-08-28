const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Calc = require('../assets/estimate_calculation_service.js');

const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'estimating_assembly_policy.golden.json'), 'utf8'
));
const group = (id, items) => ({ id, name: id, items });
const part = (id, quantity, unitMaterialCost, extra = {}) => ({
    id, itemType: 'part', quantity, unitMaterialCost, laborUnitType: 'hrs', ...extra
});
const assembly = (id, quantity, children, extra = {}) => ({
    id, itemType: 'assembly', isAssembly: true, quantity, children, ...extra
});

test('unmarked assemblies remain LEGACY and explicit CANONICAL retains basic parity', () => {
    const f = fixture.basic;
    const legacy = assembly('a', f.rootQuantity, [part('p', f.childQuantity, f.unitCost)]);
    const canonical = { ...legacy, assemblyExpansionPolicy: 'CANONICAL' };
    assert.equal(Calc.calculateSummary([group('g', [legacy])]).direct.materialCost, f.expectedMaterialCost);
    assert.equal(Calc.calculateSummary([group('g', [canonical])]).direct.materialCost, f.expectedMaterialCost);
});

test('CANONICAL expands nested embedded assemblies while financial formulas remain authoritative', () => {
    const f = fixture.nested;
    const root = assembly('a', f.rootQuantity, [
        assembly('b', f.middleQuantity, [part('p', f.leafQuantity, f.unitCost)])
    ], { assemblyExpansionPolicy: 'CANONICAL' });
    const summary = Calc.calculateSummary([group('g', [root])]);
    assert.equal(summary.direct.materialCost, f.expectedMaterialCost);
    assert.deepEqual(summary.rows[0].calc.expansion, { policy: 'CANONICAL', errors: [], warnings: [], limitations: [] });
});

test('CANONICAL resolves flat children globally across groups and does not double count them', () => {
    const root = assembly('root', 2, [], { assemblyExpansionPolicy: 'CANONICAL' });
    const child = part('child', 3, 10, { parentItemId: 'root' });
    const summary = Calc.calculateSummary([group('parents', [root]), group('other', [child])]);
    assert.equal(summary.rows.length, 1);
    assert.equal(summary.direct.materialCost, 60);
});

test('childrenQuantitiesExtended and zero root quantity preserve exact quantities', () => {
    const e = fixture.extended;
    const extended = assembly('extended', e.rootQuantity, [part('ep', e.childQuantity, e.unitCost)], {
        assemblyExpansionPolicy: 'CANONICAL', childrenQuantitiesExtended: true
    });
    assert.equal(Calc.calculateSummary([group('g', [extended])]).direct.materialCost, e.expectedMaterialCost);
    const z = fixture.quantityZero;
    const zero = assembly('zero', z.rootQuantity, [part('zp', z.childQuantity, z.unitCost)], {
        assemblyExpansionPolicy: 'CANONICAL'
    });
    const result = Calc.calculateSummary([group('g', [zero])]).rows[0].calc;
    assert.equal(result.materialCost, z.expectedMaterialCost);
    assert.ok(Number.isFinite(result.unitMaterialCost));
});

test('cycles and missing catalog references surface structured diagnostics', () => {
    const cyclic = assembly('a', 1, [], {
        assemblyExpansionPolicy: 'CANONICAL',
        catalogSnapshot: { assemblyComponents: [{ id: 'ab', catalogItemId: 'b', quantity: 1 }] }
    });
    const b = assembly('b', 1, [], {
        parentItemId: 'detached',
        catalogSnapshot: { assemblyComponents: [
            { id: 'ba', catalogItemId: 'a', quantity: 1 },
            { id: 'missing', catalogItemId: '404', quantity: 1 }
        ] }
    });
    const calc = Calc.calculateSummary([group('g1', [cyclic]), group('g2', [b])]).rows[0].calc;
    assert.equal(calc.expansion.fallback, 'LEGACY');
    assert.ok(calc.expansion.errors.some(error => error.code === 'ASSEMBLY_CYCLE'));
    assert.ok(calc.expansion.warnings.some(warning => warning.code === 'MISSING_CATALOG_ITEM'));
});

test('equipment leaf uses canonical effective quantity and mixed financial buckets stay exact', () => {
    const root = assembly('mixed', 2, [
        part('material', 3, 10),
        { id: 'lift', itemType: 'equipment', quantity: 4, unitEquipmentCost: 25, equipmentQuantity: 0 }
    ], { assemblyExpansionPolicy: 'CANONICAL' });
    const calc = Calc.calculateSummary([group('g', [root])]).rows[0].calc;
    assert.equal(calc.materialCost, 60);
    assert.equal(calc.equipmentCost, 200);
});

test('canonical taxes are calculated at leaf level', () => {
    const root = assembly('tax-root', 1, [part('tax-child', 1, 100, { taxable: false })], {
        assemblyExpansionPolicy: 'CANONICAL', taxable: true
    });
    const summary = Calc.calculateSummary([group('g', [root])], { taxes: { Materials: 10 } });
    assert.equal(summary.totalTax, 0);
    assert.deepEqual(summary.rows[0].calc.expansion.limitations, []);
});

test('catalog DTO survives adapter, workspace normalization, calculation and JSON reload', () => {
    const Contract = require('../assets/catalog_item_contract.js');
    const EstimatingAdapter = require('../assets/estimating_catalog_adapter.js');
    const Workspace = require('../assets/estimating_workspace_service.js');
    const childDto = Contract.normalizeCatalogItem({ id: 52, revision: 3, item_type: 'part', unit_cost: 7 });
    const rootDto = Contract.normalizeCatalogItem({ id: 51, revision: 4, item_type: 'assembly' }, {
        assemblyParts: [{ id: 1, assembly_catalog_item_id: 51, part_catalog_item_id: 52, quantity: 2 }]
    });
    const adapted = EstimatingAdapter.catalogItemDtoToEstimatingItem(rootDto, {
        itemsById: new Map([['52', childDto]]), workspaceItem: Workspace.item
    });
    const reloaded = Workspace.item(JSON.parse(JSON.stringify({ ...adapted,
        quantity: 3, assemblyExpansionPolicy: 'CANONICAL' })));
    const summary = Calc.calculateSummary([group('g', [reloaded])]);
    assert.equal(reloaded.assemblyExpansionPolicy, 'CANONICAL');
    assert.equal(reloaded.catalogRevision, 4);
    assert.equal(summary.direct.materialCost, 42);
});

test('workspace normalization persists policy and ratio metadata', () => {
    const Workspace = require('../assets/estimating_workspace_service.js');
    const normalized = Workspace.item({ assemblyExpansionPolicy: 'CANONICAL', ratioType: 'per_area',
        spacing: 12, componentWaste: 5 });
    assert.equal(normalized.assemblyExpansionPolicy, 'CANONICAL');
    assert.equal(normalized.ratioType, 'per_area');
    assert.equal(normalized.spacing, 12);
    assert.equal(normalized.componentWaste, 5);
    assert.equal(Workspace.settings({ assemblyExpansionPolicy: 'CANONICAL' }).assemblyExpansionPolicy, 'CANONICAL');
});

test('dashboard loads expansion engine and adapter before calculation service', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'project_dashboard.php'), 'utf8');
    assert.ok(page.indexOf('assembly_expansion_service.js') < page.indexOf('estimating_assembly_expansion_adapter.js'));
    assert.ok(page.indexOf('estimating_assembly_expansion_adapter.js') < page.indexOf('estimate_calculation_service.js'));
});
