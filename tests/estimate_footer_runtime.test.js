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

function proposalFooterRuntime(savedState) {
    const start = proposal.indexOf('function readEstimatingModule');
    const end = proposal.indexOf('function totals', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const footer = { innerHTML: '' };
    const sandbox = {
        savedState,
        footer,
        localStorage: { getItem: () => JSON.stringify(savedState), setItem: () => {} }
    };
    vm.runInNewContext(`
        const estimatingKey = 'takeoff.estimating.module.2';
        const estimateFooter = footer;
        const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
        ${proposal.slice(start, end)}
        renderEstimateFooter();
    `, sandbox);
    return footer.innerHTML;
}

const sharedState = {
    activeEstimateId: 'est-2',
    estimates: [
        { id: 'est-1', name: 'Base <Estimate>', status: 'Draft', isLocked: true, groups: [{ items: [{ id: 'one' }] }] },
        { id: 'est-2', name: 'Alternate', status: 'Approved', groups: [{ items: [{ id: 'two' }, { id: 'three' }] }] }
    ]
};

function assertFooterParity(html, idAttribute) {
    assert.match(html, /2 estimates/);
    assert.match(html, new RegExp(`${idAttribute}="est-1"`));
    assert.match(html, new RegExp(`est-version-tab active[^>]*${idAttribute}="est-2"`));
    assert.match(html, /Base &lt;Estimate&gt;/);
    assert.match(html, /Draft · 1 items/);
    assert.match(html, /Approved · 2 items/);
    assert.match(html, /fa-lock/);
    assert.match(html, /New estimate/);
    assert.match(html, /Compare/);
    assert.doesNotMatch(html, /compare-estimates" disabled/);
}

test('Takeoff footer render executes and fills the real footer without an undefined helper', () => {
    const html = takeoffFooterRuntime(sharedState);
    assertFooterParity(html, 'data-takeoff-estimate-id');
    assert.doesNotMatch(takeoff, /escapeHtml\(/, 'project_takeoff only defines esc(), not escapeHtml()');
});

test('Proposal footer runtime has the same estimate metadata and actions', () => {
    assertFooterParity(proposalFooterRuntime(sharedState), 'data-proposal-estimate-id');
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

test('footer actions and active estimate selection are wired through shared events', () => {
    assert.match(takeoff, /data-takeoff-estimating-action[\s\S]*takeoff:estimating-action-requested/);
    assert.match(proposal, /data-proposal-estimating-action[\s\S]*takeoff:estimating-action-requested/);
    assert.match(takeoff, /takeoff:active-estimate-changed/);
    assert.match(proposal, /takeoff:active-estimate-changed/);
});
