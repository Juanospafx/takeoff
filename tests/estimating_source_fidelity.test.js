const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
test('Estimating CSS preserves collaborator visual contracts while allowing modular additions', () => {
    const content = fs.readFileSync(path.join(root, 'assets/project_estimating.css'), 'utf8');
    assert.match(content, /\.pro-tree-item-title\.est-item-title/);
    assert.match(content, /\.est-modal-backdrop\s*\{/);
    assert.match(content, /\.est-copy-dialog\s*\{/);
    assert.match(content, /\.est-catalog-dialog\s*\{/);
});

test('Cost Item labels retain the collaborator span markup and never become creative blue inputs', () => {
    const source = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
    assert.match(source, /<span class="pro-tree-item-title est-item-title" title="\$\{esc\(item\.name\)\}">\$\{esc\(item\.name\)\}<\/span>/);
    assert.doesNotMatch(source, /est-item-name-input/);
});

test('functional adapters do not inject new visual CSS or dynamic Cost Item widths', () => {
    const source = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
    assert.doesNotMatch(source, /longestItemLabel|widths\.cost_item\s*=\s*Math\.max/);
    assert.match(source, /resolveAssemblyComponentName/);
});
