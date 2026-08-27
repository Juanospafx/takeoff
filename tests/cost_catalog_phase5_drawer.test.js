const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pages/cost_catalog.php'), 'utf8');
const js = fs.readFileSync(path.join(root, 'assets/cost_catalog.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/cost_catalog.css'), 'utf8');

test('phase 5 provides a read-only details drawer with accessible identity', () => {
    assert.match(page, /id="ccItemDetailsDrawer"[^>]*aria-labelledby="ccItemDetailsTitle"/);
    assert.match(page, /id="ccCloseItemDetails"[^>]*aria-label="Close item details"/);
    assert.match(js, /function openItemDetails/);
    assert.match(js, /function closeItemDetails/);
    assert.match(js, /detailsReturnFocus/);
    assert.match(js, /event\.key === 'Tab'/);
    assert.match(js, /event\.key === 'Escape'/);
});

test('drawer uses canonical display values and safe external links', () => {
    assert.match(js, /function renderItemDetails/);
    assert.match(js, /function safeExternalUrl/);
    assert.match(js, /\['http:', 'https:'\]/);
    assert.match(js, /rel="noopener noreferrer"/);
    assert.match(js, /Included items/);
    const renderer = js.slice(js.indexOf('function renderItemDetails'), js.indexOf('function openItemDetails'));
    assert.doesNotMatch(renderer, /unit_cost\s*[*+\/-]/);
});

test('drawer is desktop aside and mobile modal with responsive dark styling', () => {
    assert.match(css, /\.cc-details-drawer/);
    assert.match(css, /@media\(min-width:761px\)/);
    assert.match(css, /@media\(max-width:760px\)/);
    assert.match(css, /\[data-theme="dark"\] \.cc-details-drawer/);
    assert.match(js, /setAttribute\('role', 'dialog'\)/);
    assert.match(js, /setAttribute\('aria-modal', 'true'\)/);
});
