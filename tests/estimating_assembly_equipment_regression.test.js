const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const sources = [
    'quantity_format_service.js', 'assembly_expansion_service.js',
    'estimating_assembly_expansion_adapter.js', 'estimate_calculation_service.js',
    'project_estimate_footer.js', 'takeoff_estimating_sync_service.js',
    'estimating_workspace_service.js', 'project_estimating.js'
].map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8'));

function runtime(items) {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', {
        url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
    dom.window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify({
        activeEstimateId: 'estimate-a', estimates: [{ id: 'estimate-a', name: 'Estimate A', groups: [{
            id: 'group-a', name: 'Electrical', expanded: true, items
        }] }]
    }));
    sources.forEach(source => dom.window.eval(source));
    return dom;
}

test('snapshot-backed persisted assemblies expose the accepted chevron and component rows', () => {
    const dom = runtime([{
        id: 'legacy-assembly', name: 'EMT Branch Assembly', costCategory: 'Assembly', is_assembly: 1,
        quantity: 10, catalogSnapshot: { type: 'ASSEMBLY', assemblyComponents: [
            { id: 'component-1', catalogItemId: 101, name: 'EMT Conduit', quantity: 1, uom: 'ft', unitMaterialCost: 2 },
            { id: 'component-2', catalogItemId: 102, name: 'Steel Strap', quantity: 0.1, uom: 'ea', unitMaterialCost: 1 }
        ] }
    }]);
    const toggle = dom.window.document.querySelector('[data-toggle-assembly="legacy-assembly"]');
    assert.ok(toggle, 'assembly chevron must render');
    toggle.click();
    const rows = [...dom.window.document.querySelectorAll('[data-assembly-component-row]')];
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.querySelector('.est-item-title').textContent), ['EMT Conduit', 'Steel Strap']);
    dom.window.close();
});

test('Equipment Unit Cost edits immediately drive Equipment Summary and persistence', () => {
    const dom = runtime([{
        id: 'lift', itemType: 'equipment', costCategory: 'Equipment', name: 'Scissor Lift',
        quantity: 2, unitMaterialCost: 0, unitEquipmentCost: 1500, equipmentQuantity: 0,
        equipmentMargin: 0, materialMargin: 0
    }]);
    const input = dom.window.document.querySelector('[data-item-id="lift"] [data-item-field="unitMaterialCost"]');
    assert.equal(Number(input.value), 1500, 'the accepted Unit Cost column displays equipment cost');
    input.value = '2000';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
    const item = saved.estimates[0].groups[0].items[0];
    assert.equal(item.unitEquipmentCost, 2000);
    assert.equal(item.unitMaterialCost, 0);
    assert.equal(dom.window.document.querySelector('[data-live-summary="eq-cost"]').textContent, '$4,000.00');
    assert.equal(dom.window.document.querySelector('[data-live-summary="mat-cost"]').textContent, '$0.00');
    dom.window.close();
});
