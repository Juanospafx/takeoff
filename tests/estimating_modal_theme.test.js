const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const js = [
    fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'assets/project_estimating_modals.js'), 'utf8')
].join('\n');
const css = fs.readFileSync(path.join(root, 'assets/project_estimating.css'), 'utf8');

test('New Estimate uses the structured copy modal controls', () => {
    assert.match(js, /est-dialog est-copy-modal/);
    assert.match(js, /est-copy-dialog-body/);
    assert.match(js, /est-copy-name est-display-contents/);
    assert.match(js, /bb-studio-card est-copy-option est-modal-card/);
    assert.match(js, /aria-label="Close"/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'assets/project_estimating_modals.js'), 'utf8'), /\sstyle=/);
});

test('portaled estimating modal owns accessible light and dark theme tokens', () => {
    assert.match(css, /:root,[\s\S]*?--est-surface:\s*#ffffff;/);
    assert.match(css, /\[data-theme="dark"\],[\s\S]*?--est-text:\s*#f8fafc;/);
    assert.match(css, /\.est-copy-radio\s*\{[^}]*accent-color:\s*#fb5a3a/);
    assert.match(css, /\.est-copy-submit\s*\{[\s\S]*?color:\s*#fff/);
    assert.match(css, /\.est-estimating-modal-portal\s*\{[\s\S]*?backdrop-filter:\s*blur\(4px\)/);
});
