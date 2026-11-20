const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'assets/cost_catalog_item_inspector.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'assets/cost_catalog.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'pages/cost_catalog.php'), 'utf8');

const sandbox = { URL, window: {} };
vm.runInNewContext(moduleSource, sandbox, { filename: 'cost_catalog_item_inspector.js' });
assert.strictEqual(typeof sandbox.window.CostCatalogItemInspector?.create, 'function');

const noopClassList = { add() {}, remove() {}, contains() { return false; } };
const nodes = {
    ccItemDetailsDrawer: { classList: noopClassList, setAttribute() {} },
    ccItemDetailsTitle: { textContent: '' },
    ccItemDetailsBody: { innerHTML: '' },
    ccRowItemFloatingMenu: { hidden: true, innerHTML: '', style: {} }
};
const documentStub = {
    activeElement: null,
    documentElement: {},
    getElementById(id) { return nodes[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
};
const items = [{
    id: 7,
    name: '<Unsafe name>',
    description: 'Description',
    item_type: 'part',
    unit_of_measure: 'ea',
    labor_hours: 1.5,
    epd_url: 'javascript:alert(1)',
    attachment_url: 'https://example.test/file.pdf'
}];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const inspector = sandbox.window.CostCatalogItemInspector.create({
    canWrite: () => true,
    canonicalItemMetrics: () => ({ primary: '$1.00', secondary: 'Material' }),
    displayItemType: () => 'Material',
    document: documentStub,
    escape,
    formatLaborHours: value => Number(value || 0).toFixed(2),
    getAssemblyParts: () => [],
    getItems: () => items,
    money: value => `$${Number(value || 0).toFixed(2)}`,
    window: {
        innerHeight: 800,
        location: { href: 'https://takeoff.test/catalog' },
        getComputedStyle: () => ({ zoom: '1' })
    }
});

const detailHtml = inspector.renderItemDetails(items[0]);
assert.ok(detailHtml.includes('&lt;Unsafe name&gt;'), 'detail values remain escaped');
assert.ok(!detailHtml.includes('javascript:'), 'unsafe detail links remain blocked');
assert.ok(detailHtml.includes('https://example.test/file.pdf'), 'https detail links remain available');

assert.ok(clientSource.includes('window.CostCatalogItemInspector.create({'));
assert.ok(clientSource.includes('itemInspector.open(itemId, trigger);'));
assert.ok(clientSource.includes('itemInspector.openMenu(triggerBtn, itemId);'));
assert.ok(!clientSource.includes('function renderItemDetails(item)'));

const moduleTag = 'cost_catalog_item_inspector.js?v=<?= filemtime';
assert.ok(pageSource.includes(moduleTag), 'extracted module uses filemtime cache busting');
assert.ok(
    pageSource.indexOf('cost_catalog_item_inspector.js') < pageSource.indexOf('cost_catalog.js?v='),
    'item inspector loads before the catalog client'
);

console.log('Cost Catalog item inspector extraction contract passed.');
