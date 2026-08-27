const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pages/cost_catalog.php'), 'utf8');
const client = fs.readFileSync(path.join(root, 'assets/cost_catalog.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/cost_catalog.css'), 'utf8');

test('phase 1 exposes catalog/category breadcrumb and type filtering', () => {
    assert.match(page, /id="ccBreadcrumb"[^>]*aria-label="Catalog breadcrumb"/);
    assert.match(page, /id="ccTypeFilter"/);
    assert.match(client, /role="treeitem"/);
    assert.match(client, /aria-label="Category:/);
    assert.match(client, /function renderBreadcrumb/);
    assert.match(client, /itemTypeFilter/);
});

test('CatalogItemRow uses canonical display metrics without pricing formulas', () => {
    assert.match(client, /function CatalogItemRow/);
    assert.match(client, /function canonicalItemMetrics/);
    const metrics = client.slice(client.indexOf('function canonicalItemMetrics'), client.indexOf('function CatalogItemRow'));
    assert.doesNotMatch(metrics, /unit_cost\s*[*+\/-]/);
    assert.doesNotMatch(metrics, /labor_hours\s*[*+\/-]/);
});

test('phase 1 meets touch, responsive, dark and reduced motion contracts', () => {
    assert.match(css, /min-height:44px/);
    assert.match(css, /@media\(max-width:400px\)/);
    assert.match(css, /\[data-theme="dark"\] \.cc-breadcrumb/);
    assert.match(css, /prefers-reduced-motion:reduce/);
});
