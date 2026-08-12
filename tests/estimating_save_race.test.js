const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const sources = ['estimate_calculation_service.js', 'project_estimate_footer.js',
    'takeoff_estimating_sync_service.js', 'estimating_workspace_service.js', 'project_estimating.js']
    .map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8'));

test('New Estimate created during Save survives its stale response and reaches the queued save', async () => {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="42"></div>', {
        url: 'https://takeoff.test/pages/project_dashboard.php?id=42&tab=estimating', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 42, estimateItems: [], projectMeta: {} };
    let releaseFirstPost;
    const firstGate = new Promise(resolve => { releaseFirstPost = resolve; });
    const posts = [];
    dom.window.fetch = async (_url, options = {}) => {
        if (!options.method || options.method === 'GET') return { ok: true, status: 200, json: async () => ({ success: true, state: {
            activeEstimateId: 'primary', estimates: [{ id: 'primary', dbEstimateId: 7, revision: 0, name: 'Primary', groups: [], settings: {}, notes: {} }]
        } }) };
        const payload = JSON.parse(options.body);
        posts.push(payload);
        if (posts.length === 1) await firstGate;
        const responseState = JSON.parse(JSON.stringify(payload.state));
        responseState.estimates.forEach((estimate, index) => { estimate.dbEstimateId ||= 7 + index; estimate.revision = Number(estimate.revision || 0) + 1; });
        return { ok: true, status: 200, json: async () => ({ success: true, state: responseState }) };
    };
    sources.forEach(source => dom.window.eval(source));
    await new Promise(resolve => dom.window.setTimeout(resolve, 30));

    const create = name => {
        dom.window.dispatchEvent(new dom.window.CustomEvent('takeoff:estimating-action-requested', { detail: { action: 'new-estimate' } }));
        const portal = dom.window.document.querySelector('[data-estimating-modal-portal]');
        portal.querySelector('#copyEstimateName').value = name;
        portal.querySelector('[data-create-estimate]').click();
    };
    create('First option');
    await new Promise(resolve => dom.window.setTimeout(resolve, 550));
    assert.equal(posts.length, 1);
    create('Created during save');
    releaseFirstPost();
    await new Promise(resolve => dom.window.setTimeout(resolve, 650));

    const stored = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.42'));
    assert.ok(stored.estimates.some(estimate => estimate.name === 'Created during save'));
    assert.ok(posts.length >= 2);
    assert.ok(posts.at(-1).state.estimates.some(estimate => estimate.name === 'Created during save'));
    dom.window.close();
});
