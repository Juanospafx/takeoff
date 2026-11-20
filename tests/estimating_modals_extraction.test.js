const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'assets', 'project_estimating_modals.js');
const mainSource = fs.readFileSync(path.join(root, 'assets', 'project_estimating.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'assets', 'project_estimating.css'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');
const { renderEstimatingModal } = require(modulePath);

assert.strictEqual(typeof renderEstimatingModal, 'function', 'modal module must export its classic entry point');
assert.match(mainSource, /ProjectEstimatingModals\?\.renderEstimatingModal/, 'monolith must delegate modal rendering');
assert.ok(!mainSource.includes('function studioDialog('), 'modal template implementation must remain outside monolith');

const modalIndex = pageSource.indexOf('project_estimating_modals.js');
const mainIndex = pageSource.indexOf('project_estimating.js');
assert.ok(modalIndex >= 0 && modalIndex < mainIndex, 'modal module must load before project_estimating.js');
assert.match(pageSource, /project_estimating_modals\.js\?v=<\?= filemtime/, 'module cache key must track file modification time');

for (const className of [
    'est-estimating-modal-portal', 'est-copy-dialog', 'est-copy-dialog-head', 'est-copy-dialog-icon',
    'est-copy-name-input', 'est-copy-option', 'est-copy-radio', 'est-copy-dialog-foot',
    'est-catalog-dialog', 'est-catalog-body', 'est-catalog-search', 'est-catalog-results'
]) {
    assert.ok(cssSource.includes(`.${className}`), `CSS must define .${className}`);
}
assert.match(
    cssSource,
    /\.est-estimating-modal-portal\s*\{[^}]*pointer-events:\s*auto;/s,
    'the extracted modal portal must remain interactive'
);

let appended = null;
function portalElement() {
    return {
        dataset: {},
        className: '',
        innerHTML: '',
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
}
global.document = {
    querySelector() { return null; },
    createElement() { return portalElement(); },
    body: { appendChild(node) { appended = node; } }
};

const base = {
    esc: value => String(value),
    current: () => ({ name: 'Bid A' }),
    renderCatalogChoices: () => '<button class="catalog-choice">Choice</button>'
};

for (const mode of ['new', 'export', 'catalog']) {
    appended = null;
    renderEstimatingModal({ ...base, ui: { modal: mode } });
    assert.ok(appended, `${mode} modal should append its portal`);
    assert.ok(!/\sstyle\s*=/.test(appended.innerHTML), `${mode} modal must use reusable CSS classes, not inline style attributes`);
}
assert.match(appended.innerHTML, /est-catalog-results/, 'catalog modal keeps its results container contract');

appended = null;
renderEstimatingModal({ ...base, ui: { modal: 'import', importMode: 'keep_excel', importing: false } });
assert.match(appended.innerHTML, /name="estimateImportMode"/, 'import mode radio contract must be preserved');
assert.match(appended.innerHTML, /data-import-estimate/, 'import action hook must be preserved');
assert.ok(!/\sstyle\s*=/.test(appended.innerHTML), 'import modal must not reintroduce inline styles');
assert.ok(!/[Ãâ]/.test(appended.innerHTML), 'import modal copy must not contain mojibake');

console.log('Estimating modal extraction checks passed.');
