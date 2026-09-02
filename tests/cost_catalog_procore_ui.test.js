const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pages/cost_catalog.php'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/cost_catalog.css'), 'utf8');
const client = fs.readFileSync(path.join(root, 'assets/cost_catalog.js'), 'utf8');

test('Cost Catalog uses the same global shell and hierarchy as Bid Board', () => {
    assert.match(page, /global_tools\.css/);
    assert.match(page, /global_tools_header\.php/);
    assert.doesNotMatch(page, /class="cc-app-nav"/);
    assert.match(page, /class="cc-module-icon"/);
    assert.match(page, /class="cc-table-controls"/);
    assert.match(page, /procore-catalog-20260824-1/);
});

test('Cost Catalog exposes compact searchable sortable table controls', () => {
    assert.match(page, /id="ccSearch"/);
    assert.match(page, /id="ccSortBy"/);
    assert.match(page, /id="ccResultCount"[^>]*aria-live="polite"/);
    assert.match(client, /itemQuery/);
    assert.match(client, /itemSortDirection/);
    assert.match(client, /normalizedQuery/);
});

test('row actions use an accessible overflow menu without losing commands', () => {
    assert.match(client, /data-item-menu=/);
    assert.match(client, /aria-expanded="false"/);
    ['edit', 'duplicate', 'move', 'assembly', 'delete', 'restore'].forEach(action => {
        assert.match(client, new RegExp(`data-item-action="${action}"`));
    });
    assert.doesNotMatch(client, /data-item-action="(?:takeoff|history)"/);
    assert.match(client, /event\.key === 'Escape'/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /\[data-theme="dark"\]/);
});
