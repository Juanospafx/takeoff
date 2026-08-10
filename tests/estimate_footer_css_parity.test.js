const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'assets', 'project_estimating.css'), 'utf8');
const legacyCss = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.css'), 'utf8');
const footerScript = fs.readFileSync(path.join(root, 'assets', 'project_estimate_footer.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');

const state = {
    activeEstimateId: 'alternate',
    estimates: [
        { id: 'primary', name: 'Primary', status: 'Draft', isLocked: true, groups: [{ items: [{ id: 'one' }] }] },
        { id: 'alternate', name: 'Alternate', status: 'Ready', groups: [] }
    ]
};

function normalizeAttributes(html) {
    return html
        .replace(/data-(?:takeoff-estimate-id|proposal-estimate-id|version)=/g, 'data-select=')
        .replace(/data-(?:takeoff-estimating-action|proposal-estimating-action|est-action)=/g, 'data-action=');
}

test('shared estimate footer has identical DOM and resolved theme variables inside and outside Estimating', () => {
    assert.match(page, /class="est-version-bar" id="takeoffEstimateTypesFooter"/);
    assert.match(page, /class="est-version-bar" id="proposalEstimateTypesFooter"/);
    const dom = new JSDOM('<!doctype html><style></style><section class="estimating-page"><footer id="inside" class="est-version-bar"></footer></section><section class="takeoff-shell"><footer id="outside" class="est-version-bar"></footer></section>', {
        runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.document.querySelector('style').textContent = `${css}\n${legacyCss}`;
    dom.window.eval(footerScript);
    const inside = dom.window.document.getElementById('inside');
    const outside = dom.window.document.getElementById('outside');
    inside.innerHTML = dom.window.ProjectEstimateFooter.render({ ...state, selectAttribute: 'data-version', actionAttribute: 'data-est-action' });
    outside.innerHTML = dom.window.ProjectEstimateFooter.render({ ...state, selectAttribute: 'data-takeoff-estimate-id', actionAttribute: 'data-takeoff-estimating-action' });

    assert.equal(normalizeAttributes(outside.innerHTML), normalizeAttributes(inside.innerHTML));
    assert.equal(outside.querySelectorAll('.project-estimate-footer, .project-estimate-option, .project-estimate-action').length, 0, 'legacy footer selectors must not match shared markup');

    const insideStyle = dom.window.getComputedStyle(inside);
    const outsideStyle = dom.window.getComputedStyle(outside);
    for (const variable of ['--est-surface', '--est-line', '--est-text', '--est-muted', '--est-primary', '--est-primary-soft']) {
        assert.notEqual(outsideStyle.getPropertyValue(variable).trim(), '', `${variable} must resolve outside .estimating-page`);
        assert.equal(outsideStyle.getPropertyValue(variable), insideStyle.getPropertyValue(variable), `${variable} must have parity`);
    }
    for (const property of ['display', 'gap', 'padding', 'border-top-width', 'min-height', 'height', 'position', 'overflow-x']) {
        assert.equal(outsideStyle.getPropertyValue(property), insideStyle.getPropertyValue(property), `${property} must have parity`);
    }
    dom.window.close();
});
