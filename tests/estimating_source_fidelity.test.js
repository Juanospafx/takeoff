const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
test('Estimating CSS remains byte-for-byte faithful to collaborator commit 9ce9f5a', () => {
    const content = fs.readFileSync(path.join(root, 'assets/project_estimating.css'));
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(actualHash, 'f4cdfafb51aaeef0ad4034212309544e93bfc0498e76ded14b754b6f40f57f1b');
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
