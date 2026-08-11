const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'assets', 'project_estimating.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'project_estimating.css'), 'utf8');

test('details inspector can always be reopened and collapsed cards expose state', () => {
    assert.match(js, /data-est-action="toggle-details"[\s\S]*aria-controls="estDetailsPanel"/);
    assert.match(js, /action === 'toggle-details'[\s\S]*rightCollapsed = !state\.rightCollapsed/);
    assert.match(js, /data-collapse-card="notesCollapsed" aria-expanded=/);
    assert.match(js, /data-collapse-card="summaryCollapsed" aria-expanded=/);
    assert.match(js, /data-collapse-card="auditCollapsed" aria-expanded=/);
    assert.match(css, /\.est-main\.details-collapsed\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) 0/);
});

test('notes persist edits, summary is calculated and audit rows are meaningful', () => {
    assert.match(js, /\[data-note-field\][\s\S]*activeEstimate\(\)\.notes[\s\S]*markDirty\(\); persist\(\)/);
    assert.match(js, /data-editor-cmd[\s\S]*mousedown[\s\S]*preventDefault/);
    assert.match(js, /function renderRightPanel\(summary\)[\s\S]*summaryTable\(summary\)/);
    assert.match(js, /Summary<\/span><small>[\s\S]*money\(summary\.estimateTotal\)/);
    assert.match(js, /log\.entity[\s\S]*log\.user[\s\S]*new Date\(log\.at\)/);
    assert.match(js, /auditCollapsed:\s*stateBool\(parsed(?:\?\.|\.)auditCollapsed\)/);
});
