const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/project_estimating.css'), 'utf8');

test('New Estimate uses the structured copy modal controls', () => {
    assert.match(js, /est-dialog est-copy-modal/);
    assert.match(js, /class="est-copy-body"/);
    assert.match(js, /class="est-copy-name"/);
    assert.match(js, /class="est-copy-option"/);
    assert.match(js, /aria-label="Close"/);
});

test('portaled estimating modal owns accessible light and dark theme tokens', () => {
    assert.match(css, /\.est-modal-backdrop\s*\{[\s\S]*?--est-surface:\s*#ffffff;[\s\S]*?--est-text:\s*#172033;/);
    assert.match(css, /\[data-theme="dark"\] \.est-modal-backdrop\s*\{[\s\S]*?--est-surface:\s*#1e293b;[\s\S]*?--est-text:\s*#f8fafc;/);
    assert.match(css, /\.est-dialog input\[type="radio"\][\s\S]*?accent-color:\s*var\(--est-primary\)/);
    assert.match(css, /\.est-dialog footer \.est-btn-primary[\s\S]*?color:\s*#fff/);
});
