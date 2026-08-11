const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_estimating.js'), 'utf8');

test('fixed amount markups edit their amount instead of a stale percent field', () => {
    assert.match(js, /const valueField = row\.type === 'fixed_amount' \? 'amount' : 'percent'/);
    assert.match(js, /field === 'percent' \|\| field === 'amount'/);
});

test('note changes create persisted audit events', () => {
    assert.match(js, /audit\('Note edited'/);
    assert.match(js, /audit\('Note added'/);
    assert.match(js, /audit\('Note removed'/);
    assert.match(js, /editor\.addEventListener\('blur'[\s\S]*persist\(\)/);
});

test('audit history can be exported and intentionally cleared', () => {
    assert.match(js, /data-est-action="export-audit"/);
    assert.match(js, /data-est-action="clear-audit"/);
    assert.match(js, /function exportAudit\(\)[\s\S]*application\/json/);
    assert.match(js, /action === 'clear-audit'[\s\S]*confirm\('Clear the audit history/);
});
