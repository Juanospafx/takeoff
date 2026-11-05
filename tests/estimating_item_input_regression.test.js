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

function runtime() {
  const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', {
    url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
  });
  dom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
  dom.window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify({
    activeEstimateId: 'estimate-a', estimates: [{ id: 'estimate-a', name: 'Estimate A', groups: [{
      id: 'group-a', name: 'Electrical', expanded: true, items: [
        { id: 'long-item', name: 'Extremely Long Electrical Catalog Item Name That Must Remain Fully Visible', quantity: 1, unitMaterialCost: 10 },
        { id: 'assembly-a', name: 'Branch Assembly', itemType: 'assembly', quantity: 2,
          children: [{ id: 'component-a', item_name: 'Three Quarter Inch EMT Compression Connector', quantity: 1, uom: 'ea' }] }
      ]
    }] }]
  }));
  sources.forEach(source => dom.window.eval(source));
  return dom;
}

test('full item and assembly component names are rendered', () => {
  const dom = runtime();
  const longName = dom.window.document.querySelector('[data-item-id="long-item"] .est-item-title');
  assert.equal(longName.textContent, 'Extremely Long Electrical Catalog Item Name That Must Remain Fully Visible');
  assert.equal(longName.tagName, 'SPAN');
  dom.window.document.querySelector('[data-toggle-assembly="assembly-a"]').click();
  const component = dom.window.document.querySelector('[data-assembly-component-row] .est-item-title');
  assert.equal(component.textContent, 'Three Quarter Inch EMT Compression Connector');
  assert.equal(component.tagName, 'SPAN');
  dom.window.close();
});

test('numeric input preserves multi-character typing before focusout', () => {
  const dom = runtime();
  const price = dom.window.document.querySelector('[data-item-id="long-item"] [data-item-field="unitMaterialCost"]');
  for (const value of ['1', '12', '123', '123.5']) {
    price.value = value;
    price.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(price.value, value, `input must not normalize ${value} while typing`);
  }
  const saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.draft'));
  assert.equal(saved.estimates[0].groups[0].items[0].unitMaterialCost, 123.5);
  dom.window.close();
});

