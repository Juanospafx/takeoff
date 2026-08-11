const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'assets/bid_board.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/bid_board.css'), 'utf8');

test('project action menu floats outside the scrolling project table', () => {
    assert.match(css, /\.bb-row-menu-panel\s*\{[\s\S]*position:\s*fixed;[\s\S]*z-index:\s*5000/);
    assert.match(client, /function positionRowMenu\(panel, trigger\)/);
    assert.match(client, /positionRowMenu\(panel, activeButton\)/);
});
