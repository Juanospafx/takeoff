const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/project_estimating.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');

test('v2 renders functional notes, summary and audit cards', () => {
    assert.match(js, /card\('notes', 'Notes'/);
    assert.match(js, /card\('summary', 'Summary'/);
    assert.match(js, /card\('audit', 'Audit'/);
    assert.match(js, /data-note-field/);
    assert.match(js, /Calc\.calculateSummary/);
    assert.match(js, /data-audit-export/);
    assert.match(js, /data-audit-clear/);
});

test('dashboard loads the new state service before the v2 controller', () => {
    assert.match(page, /estimating_export_service\.js\?v=[^"']+/);
    assert.match(page, /estimating_workspace_service\.js\?v=[^"']+/);
    assert.match(page, /project_estimating\.js\?v=[^"']+/);
    assert.ok(page.indexOf('estimating_workspace_service.js') < page.indexOf('project_estimating.js'));
    assert.ok(page.indexOf('estimating_export_service.js') < page.indexOf('project_estimating.js'));
    assert.match(page, /project_estimating\.css\?v=[^"']+/);
    assert.match(css, /Estimating v2/);
    assert.match(css, /\.est-v2 \.est-right-scroll\s*\{[\s\S]*?display:\s*block;[\s\S]*?overflow-y:\s*auto;/);
    assert.match(css, /\.est-v2 \.est-card-body\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*hidden;/);
    assert.match(css, /\.est-summary-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
});

test('Estimating export offers normal and flattened supplier BOQ modes', () => {
    assert.match(js, /data-download-estimate/);
    assert.match(js, /value="normal"/);
    assert.match(js, /value="flat"/);
    assert.match(js, /Exporter\.normalRows\(estimate\)/);
    assert.match(js, /Exporter\.flatRows\(estimate\)/);
    assert.match(js, /text\/csv;charset=utf-8/);
});
