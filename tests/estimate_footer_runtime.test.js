const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const takeoff = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_takeoff.js'), 'utf8');
const proposal = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_proposal.js'), 'utf8');

function takeoffFooterRuntime(savedState) {
    const start = takeoff.indexOf('function estimatingStoreKey');
    const end = takeoff.indexOf('function estimateLineFromLayer', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const footer = { innerHTML: '' };
    const sandbox = {
        window: { ProjectState: { projectId: 2 } },
        localStorage: { getItem: () => JSON.stringify(savedState), setItem: () => {} },
        CustomEvent: class CustomEvent {},
        $: id => id === 'takeoffEstimateTypesFooter' ? footer : null,
        esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]))
    };
    vm.runInNewContext(`${takeoff.slice(start, end)}; renderTakeoffEstimateFooter();`, sandbox);
    return footer.innerHTML;
}

test('Takeoff footer render executes and fills the real footer without an undefined helper', () => {
    const html = takeoffFooterRuntime({
        activeEstimateId: 'est-2',
        estimates: [
            { id: 'est-1', name: 'Base <Estimate>', status: 'Draft' },
            { id: 'est-2', name: 'Alternate', status: 'Approved' }
        ]
    });
    assert.match(html, /data-takeoff-estimate-id="est-1"/);
    assert.match(html, /data-takeoff-estimate-id="est-2"/);
    assert.match(html, /project-estimate-option is-active[^>]*data-takeoff-estimate-id="est-2"/);
    assert.match(html, /Base &lt;Estimate&gt;/);
    assert.doesNotMatch(takeoff, /escapeHtml\(/, 'project_takeoff only defines esc(), not escapeHtml()');
});

test('Proposal initial render always includes its estimate footer render', () => {
    assert.match(proposal, /function renderAll\(\)[\s\S]*renderSettings\(\)[\s\S]*renderPreview\(\)[\s\S]*renderEstimateFooter\(\)/);
    assert.match(proposal, /estimateFooter\.innerHTML\s*=/);
    assert.match(proposal, /renderAll\(\);\s*\}\)\(\);/);
});

test('both footers refresh when Estimating publishes complete state', () => {
    assert.match(takeoff, /takeoff:estimating-state-updated',\s*renderTakeoffEstimateFooter/);
    assert.match(proposal, /takeoff:estimating-state-updated'[\s\S]*renderEstimateFooter\(\)/);
});
