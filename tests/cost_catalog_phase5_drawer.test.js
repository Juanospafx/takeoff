const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pages/cost_catalog.php'), 'utf8');
const js = fs.readFileSync(path.join(root, 'assets/cost_catalog.js'), 'utf8');
const inspectorJs = fs.readFileSync(path.join(root, 'assets/cost_catalog_item_inspector.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/cost_catalog.css'), 'utf8');

test('phase 5 provides a read-only details drawer with accessible identity', () => {
    assert.match(page, /id="ccItemDetailsDrawer"[^>]*aria-labelledby="ccItemDetailsTitle"/);
    assert.match(page, /id="ccCloseItemDetails"[^>]*aria-label="Close item details"/);
    assert.match(js, /function openItemDetails/);
    assert.match(js, /function closeItemDetails/);
    assert.match(inspectorJs, /detailsReturnFocus/);
    assert.match(js, /event\.key === 'Tab'/);
    assert.match(js, /event\.key === 'Escape'/);
});

test('drawer uses canonical display values and safe external links', () => {
    assert.match(inspectorJs, /function renderItemDetails/);
    assert.match(inspectorJs, /function safeExternalUrl/);
    assert.match(inspectorJs, /\['http:', 'https:'\]/);
    assert.match(inspectorJs, /rel="noopener noreferrer"/);
    assert.match(inspectorJs, /Included items/);
    const renderer = inspectorJs.slice(inspectorJs.indexOf('function renderItemDetails'), inspectorJs.indexOf('function open\('));
    assert.doesNotMatch(renderer, /unit_cost\s*[*+\/-]/);
});

test('drawer is desktop aside and mobile modal with responsive dark styling', () => {
    assert.match(css, /\.cc-details-drawer/);
    assert.match(css, /\.cc-details-drawer\s*\{/);
    assert.match(css, /@media\s*\(max-width:\s*900px\)/);
    assert.match(css, /\[data-theme="dark"\] \.cc-details-drawer/);
    assert.match(js, /setAttribute\('role', 'dialog'\)/);
    assert.match(js, /setAttribute\('aria-modal', 'true'\)/);
});
