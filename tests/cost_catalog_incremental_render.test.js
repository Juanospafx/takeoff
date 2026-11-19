const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'assets/cost_catalog.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/cost_catalog.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'pages/cost_catalog.php'), 'utf8');

test('large catalog table rendering is chunked and stale work is cancelled', () => {
    const helper = client.slice(
        client.indexOf('function renderTableRowsIncrementally'),
        client.indexOf('const MEASUREMENT_DEFAULT_UOM')
    );
    assert.match(client, /const TABLE_RENDER_CHUNK_SIZE = 12/);
    assert.match(helper, /const generation = \+\+tableRenderGeneration/);
    assert.match(helper, /if \(generation !== tableRenderGeneration\) return/);
    assert.match(helper, /insertAdjacentHTML\('beforeend'/);
    assert.match(helper, /window\.requestAnimationFrame/);
    assert.match(helper, /ccSelectAll[\s\S]*?disabled = true[\s\S]*?disabled = false/);
});

test('all catalog table variants use the shared renderer and preserve empty states', () => {
    const renderItems = client.slice(
        client.indexOf('function renderItems()'),
        client.indexOf('function updateSelectAllCheckbox')
    );
    assert.match(renderItems, /renderedRows = \(state\.archivedCatalogs \|\| \[\]\)\.map\(CatalogArchivedRow\)/);
    assert.match(renderItems, /renderedRows = \(state\.archivedGroups \|\| \[\]\)\.map\(GroupArchivedRow\)/);
    assert.match(renderItems, /renderedRows = pagedItems\.map\(CatalogItemRow\)/);
    assert.match(renderItems, /renderTableRowsIncrementally\(body, renderedRows, emptyRowsHtml/);
    assert.match(renderItems, /updateSelectAllCheckbox\(\)[\s\S]*?updateBulkToolbar\(\)/);
    assert.doesNotMatch(renderItems, /body\.innerHTML = pagedItems\.map/);
});

test('static cost catalog modal styling is consolidated in CSS', () => {
    assert.match(css, /\.cc-io-modal-title\s*\{/);
    assert.match(css, /#ccItemsBody\.is-rendering[\s\S]*?pointer-events:\s*none/);
    const inlineStyles = page.match(/style=/g) || [];
    assert.equal(inlineStyles.length, 1, 'only the dynamic item color swatch should remain inline');
    assert.match(page, /id="ccItemColorSwatch" style="background:#2563eb;"/);
});
