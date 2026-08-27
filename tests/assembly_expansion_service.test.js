const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Service = require('../assets/assembly_expansion_service.js');

const part = (id, extra = {}) => ({ id: String(id), type: 'PART', costCategory: 'material',
    uom: 'ea', pricing: { materialUnitCost: 5 }, assemblyComponents: [], ...extra });
const assembly = (id, components) => ({ id: String(id), type: 'ASSEMBLY', costCategory: 'assembly',
    uom: 'ea', pricing: {}, assemblyComponents: components });
const component = (id, catalogItemId, quantity, ratioType = 'per_unit', extra = {}) => ({
    id: String(id), catalogItemId: String(catalogItemId), quantity, ratioType, spacing: null, waste: 0,
    pricingSnapshot: { materialUnitCost: 4 }, overrides: {}, ...extra
});

function expand(root, measuredQuantity, catalog, context = {}) {
    return Service.expandAssembly(root, measuredQuantity, { catalogIndex: catalog, ...context });
}

test('PER_UNIT extends component quantity by measured assembly quantity', () => {
    const child = part(2);
    const result = expand(assembly(1, [component(10, 2, 2)]), 10, [child]);
    assert.equal(result.leaves[0].baseQuantity, 10);
    assert.equal(result.leaves[0].effectiveQuantity, 20);
});

test('FIXED ignores measured assembly quantity', () => {
    const result = expand(assembly(1, [component(10, 2, 2, 'fixed')]), 10, [part(2)]);
    assert.equal(result.leaves[0].baseQuantity, 1);
    assert.equal(result.leaves[0].effectiveQuantity, 2);
});

test('PER_LINEAR and PER_AREA consume only their explicit measurement drivers', () => {
    const root = assembly(1, [component(10, 2, 0.5, 'per_linear_length'), component(11, 3, 0.25, 'per_area')]);
    const result = expand(root, 999, [part(2), part(3)], { linearLength: 100, area: 200 });
    assert.equal(result.components[0].effectiveQuantity, 50);
    assert.equal(result.components[1].effectiveQuantity, 50);
});

test('PER_ENDPOINT uses explicit endpointCount instead of vertices or a fixed assumption', () => {
    const result = expand(assembly(1, [component(10, 2, 2, 'per_endpoint')]), 100, [part(2)], { endpointCount: 8 });
    assert.equal(result.leaves[0].effectiveQuantity, 16);
});

test('SPACING preserves the legacy ceil formula at exact, remainder, zero, and clamped boundaries', () => {
    const root = assembly(1, [component(10, 2, 2, 'spacing_based', { spacing: 25 })]);
    assert.equal(expand(root, 0, [part(2)], { linearLength: 100 }).leaves[0].effectiveQuantity, 8);
    assert.equal(expand(root, 0, [part(2)], { linearLength: 101 }).leaves[0].effectiveQuantity, 10);
    assert.equal(expand(root, 0, [part(2)], { linearLength: 0 }).leaves[0].effectiveQuantity, 0);
    const invalidSpacing = assembly(1, [component(10, 2, 2, 'spacing', { spacing: 0 })]);
    assert.equal(expand(invalidSpacing, 0, [part(2)], { linearLength: 3 }).leaves[0].effectiveQuantity, 6);
});

test('component waste is represented and applied exactly once', () => {
    const root = assembly(1, [component(10, 2, 2, 'per_unit', { waste: 10 })]);
    const row = expand(root, 10, [part(2)]).leaves[0];
    assert.equal(row.effectiveQuantity, 20);
    assert.equal(row.wasteQuantity, 2);
    assert.equal(row.pricedQuantity, 22);
});

test('nested A to B to Part retains depth, path, and extended quantity', () => {
    const leaf = part(3);
    const nested = assembly(2, [component(20, 3, 4)]);
    const root = assembly(1, [component(10, 2, 3)]);
    const result = expand(root, 2, [nested, leaf]);
    assert.equal(result.components[0].effectiveQuantity, 6);
    assert.equal(result.leaves[0].effectiveQuantity, 24);
    assert.equal(result.leaves[0].depth, 1);
    assert.deepEqual(result.leaves[0].path, ['1', '2', '3']);
});

test('self and indirect cycles return structured ASSEMBLY_CYCLE errors', () => {
    const self = assembly(1, [component(10, 1, 1)]);
    assert.deepEqual(expand(self, 1, [self]).errors[0], {
        code: 'ASSEMBLY_CYCLE', componentId: '10', catalogItemId: '1', path: ['1', '1']
    });
    const a = assembly(1, [component(10, 2, 1)]);
    const b = assembly(2, [component(20, 1, 1)]);
    assert.deepEqual(expand(a, 1, [a, b]).errors[0].path, ['1', '2', '1']);
});

test('missing children retain snapshots as OTHER and emit a warning', () => {
    const root = assembly(1, [component(10, 999, 2, 'per_unit', {
        pricingSnapshot: { materialUnitCost: 7, laborHoursPerUnit: 0.5 }
    })]);
    const result = expand(root, 3, []);
    assert.equal(result.leaves[0].type, 'OTHER');
    assert.equal(result.leaves[0].costCategory, 'other');
    assert.equal(result.leaves[0].pricing.materialUnitCost, 7);
    assert.equal(result.warnings[0].code, 'MISSING_CATALOG_ITEM');
});

test('pricing policy and overrides are preserved without choosing a global override policy', () => {
    const child = part(2, { pricing: { materialUnitCost: 9 } });
    const root = assembly(1, [component(10, 2, 1, 'per_unit', {
        pricingSnapshot: { materialUnitCost: 4 }, overrides: { materialUnitCost: 12 }
    })]);
    assert.equal(expand(root, 1, [child]).leaves[0].pricing.materialUnitCost, 9);
    const snapshot = expand(root, 1, [child], { pricingSource: 'SNAPSHOT' }).leaves[0];
    assert.equal(snapshot.pricing.materialUnitCost, 4);
    assert.deepEqual(snapshot.overrides, { materialUnitCost: 12 });
});

test('precision is never rounded during expansion or consolidation', () => {
    const root = assembly(1, [component(10, 2, 1 / 3, 'per_unit', { waste: 17 })]);
    const row = expand(root, 3, [part(2)], { precision: 2 }).leaves[0];
    assert.equal(row.effectiveQuantity, 1);
    assert.equal(row.wasteQuantity, 0.17);
    assert.equal(row.pricedQuantity, 1.17);
});

test('consolidation sums quantities while retaining every source path', () => {
    const leaf = part(3);
    const root = assembly(1, [component(10, 3, 2), component(11, 3, 4)]);
    const result = expand(root, 2, [leaf]);
    const consolidated = Service.consolidateComponents(result.components);
    assert.equal(consolidated.length, 1);
    assert.equal(consolidated[0].effectiveQuantity, 12);
    assert.equal(consolidated[0].sources.length, 2);
});

test('missing ratio inputs are explicit errors and legacy aliases normalize centrally', () => {
    assert.equal(Service.normalizeRatioType('per-linear-length'), Service.RATIO_TYPES.PER_LINEAR);
    const result = expand(assembly(1, [component(10, 2, 1, 'per_area')]), 10, [part(2)]);
    assert.equal(result.leaves[0].effectiveQuantity, 0);
    assert.equal(result.errors[0].code, 'MISSING_RATIO_INPUT');
    assert.equal(result.errors[0].field, 'area');
});

test('parity fixtures reproduce legacy Takeoff and Estimating formulas', () => {
    const legacyTakeoff = (ratio, quantity, base, spacing) => {
        if (ratio === 'fixed') return quantity;
        if (ratio === 'per_endpoint') return quantity * 2;
        if (ratio === 'spacing_based') return Math.ceil(base / Math.max(spacing, 1)) * quantity;
        return quantity * base;
    };
    const child = part(2);
    const fixtures = [
        { ratio: 'fixed', quantity: 2, measured: 10, context: {}, expected: legacyTakeoff('fixed', 2, 10, 0) },
        { ratio: 'per_unit', quantity: 2, measured: 10, context: {}, expected: 20 },
        { ratio: 'per_endpoint', quantity: 2, measured: 10, context: { endpointCount: 2 }, expected: legacyTakeoff('per_endpoint', 2, 10, 0) },
        { ratio: 'spacing_based', quantity: 2, measured: 100, context: { linearLength: 100 }, spacing: 30,
            expected: legacyTakeoff('spacing_based', 2, 100, 30) }
    ];
    fixtures.forEach((fixture, index) => {
        const root = assembly(1, [component(index, 2, fixture.quantity, fixture.ratio, { spacing: fixture.spacing })]);
        assert.equal(expand(root, fixture.measured, [child], fixture.context).leaves[0].effectiveQuantity, fixture.expected);
    });
});

test('shared engine remains a pure boundary and current consumers are not migrated prematurely', () => {
    const root = path.join(__dirname, '..');
    const service = fs.readFileSync(path.join(root, 'assets', 'assembly_expansion_service.js'), 'utf8');
    const editor = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');
    const calculation = fs.readFileSync(path.join(root, 'assets', 'estimate_calculation_service.js'), 'utf8');
    const exporter = fs.readFileSync(path.join(root, 'assets', 'estimating_export_service.js'), 'utf8');
    assert.doesNotMatch(service, /fetch\s*\(|document\.|ProjectState|localStorage|sessionStorage/);
    assert.match(editor, /function calculateAssemblyQuantity/);
    assert.match(calculation, /function calculateAssembly/);
    assert.match(exporter, /function flattenItem/);
    assert.doesNotMatch(editor + calculation + exporter, /AssemblyExpansionService/);
});
