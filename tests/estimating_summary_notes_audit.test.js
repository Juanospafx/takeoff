const test = require('node:test');
const assert = require('node:assert/strict');
const Service = require('../assets/estimating_workspace_service.js');
const Calc = require('../assets/estimate_calculation_service.js');

test('fixed and percentage markups calculate from normalized settings', () => {
    const state = Service.empty(5);
    const estimate = Service.active(state);
    estimate.groups = [{ id: 'g', name: 'G', items: [Service.item({ quantity: 2, unitMaterialCost: 50, materialMargin: 0 })] }];
    estimate.settings.preTaxMarkups = [{ id: 'm1', name: 'Fee', type: 'fixed_amount', amount: 25, active: true }];
    estimate.settings.postTaxMarkups = [{ id: 'm2', name: 'OH', type: 'percentage', percent: 10, active: true }];
    const summary = Calc.calculateSummary(estimate.groups, estimate.settings);
    assert.equal(summary.preTaxTotal, 25);
    assert.equal(summary.postTaxTotal, 12.5);
    assert.equal(summary.estimateTotal, 137.5);
});

test('notes and audit survive normalization', () => {
    const state = Service.workspace({ activeEstimateId: 'x', estimates: [{ id: 'x', notes: {
        scope: 'Install', included: ['Fixtures'], excluded: ['Permits'], projectNotes: 'Night work'
    }, auditLog: [{ action: 'Note edited', at: '2026-08-11T00:00:00Z' }] }] }, 8);
    const estimate = Service.active(state);
    assert.deepEqual(estimate.notes.included, ['Fixtures']);
    assert.equal(estimate.auditLog[0].action, 'Note edited');
});
