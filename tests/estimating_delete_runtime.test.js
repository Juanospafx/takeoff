const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const sources = ['estimate_calculation_service.js', 'project_estimate_footer.js',
    'takeoff_estimating_sync_service.js', 'estimating_workspace_service.js', 'project_estimating.js']
    .map(file => fs.readFileSync(path.join(root, 'assets', file), 'utf8'));

const waitFor = async (predicate, timeout = 4000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('Timed out waiting for runtime state');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};

async function scenario(deleteOriginal) {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="42"></div>', {
        url: 'https://takeoff.test/pages/project_dashboard.php?id=42&tab=estimating',
        runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 42, estimateItems: [], projectMeta: {} };
    dom.window.confirm = () => true;
    let nextDbId = 102;
    const actions = [];
    let activeId = 'primary';
    let estimates = [{ id: 'primary', dbEstimateId: 101, revision: 1, name: 'Primary Estimate', groups: [], settings: {}, notes: {}, creationMode: 'primary' }];
    const responseState = () => ({ activeEstimateId: activeId, estimates: JSON.parse(JSON.stringify(estimates)) });
    dom.window.fetch = async (url, options = {}) => {
        const action = new URL(url, dom.window.location.href).searchParams.get('action');
        actions.push(action);
        if (action === 'list') return { ok: true, status: 200, json: async () => ({ success: true, state: responseState() }) };
        const body = JSON.parse(options.body || '{}');
        if (action === 'save') {
            const acknowledgements = (body.updates || body.state?.estimates || []).map(update => {
                const index = estimates.findIndex(row => String(row.id) === String(update.id));
                const saved = { ...JSON.parse(JSON.stringify(update)), dbEstimateId: index >= 0 ? estimates[index].dbEstimateId : nextDbId++, revision: Number(index >= 0 ? estimates[index].revision : 0) + 1 };
                if (index >= 0) estimates[index] = saved; else estimates.push(saved);
                activeId = body.state?.activeEstimateId || activeId;
                return saved;
            });
            return { ok: true, status: 200, json: async () => ({ success: true, updates: acknowledgements, activeEstimateId: activeId }) };
        }
        if (action === 'delete') {
            const index = estimates.findIndex(row => Number(row.dbEstimateId) === Number(body.estimate_id)
                || String(row.id) === String(body.client_estimate_id));
            const [deleted] = estimates.splice(index, 1);
            if (String(activeId) === String(deleted.id)) activeId = estimates[0].id;
            return { ok: true, status: 200, json: async () => ({ success: true, estimateId: deleted.dbEstimateId, clientEstimateId: deleted.id }) };
        }
        throw new Error(`Unexpected action ${action}`);
    };
    sources.forEach(source => dom.window.eval(source));
    await waitFor(() => {
        const stored = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.42') || '{}');
        return stored.estimates?.length === 1 && stored.estimates[0].id === 'primary'
            && dom.window.document.querySelectorAll('.est-version-entry').length === 1;
    });

    dom.window.dispatchEvent(new dom.window.CustomEvent('takeoff:estimating-action-requested', { detail: { action: 'new-estimate' } }));
    const portal = dom.window.document.querySelector('[data-estimating-modal-portal]');
    portal.querySelector('#copyEstimateName').value = 'Primary Estimate Copy';
    portal.querySelector('[data-create-estimate]').click();
    await waitFor(() => estimates.length === 2 && dom.window.document.querySelectorAll('.est-version-entry').length === 2)
        .catch(error => { throw new Error(`${error.message}; remote=${estimates.length}; cards=${dom.window.document.querySelectorAll('.est-version-entry').length}; status=${dom.window.document.querySelector('.est-save-status')?.textContent}`); });

    // Reproduce the real Takeoff condition: a persisted estimate becomes dirty
    // again while its autosave is still debounced. This must not starve DELETE.
    const activeStored = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.42'));
    dom.window.dispatchEvent(new dom.window.CustomEvent('takeoff:estimating-group-create-requested', { detail: {
        projectId: '42', estimateId: activeStored.activeEstimateId,
        group: { id: 'runtime-dirty-group', name: 'Runtime dirty group', items: [] }
    } }));
    await waitFor(() => JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.42')).dirtyEstimateIds?.length > 0);

    const target = deleteOriginal ? estimates.find(row => row.creationMode === 'primary') : estimates.find(row => row.creationMode !== 'primary');
    dom.window.dispatchEvent(new dom.window.CustomEvent('takeoff:estimating-estimate-action-requested', { detail: {
        action: 'delete', estimateId: target.id, sourceTab: 'takeoff', projectId: '42'
    } }));
    await waitFor(() => dom.window.document.querySelector('[data-estimate-delete-confirm]'));
    dom.window.document.querySelector('[data-estimate-delete-confirm] [data-delete-confirm]').click();
    await waitFor(() => estimates.length === 1 && dom.window.document.querySelectorAll('.est-version-entry').length === 1)
        .catch(error => { const local = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.42')); throw new Error(`${error.message}; actions=${actions.join(',')}; remote=${estimates.map(row => row.id).join(',')}; local=${local.estimates.map(row => `${row.id}:${row.dbEstimateId || 0}`).join(',')}; dirty=${local.dirtyEstimateIds}; cards=${[...dom.window.document.querySelectorAll('[data-version]')].map(row => row.dataset.version).join(',')}; status=${dom.window.document.querySelector('.est-save-status')?.textContent}`); });
    assert.equal(dom.window.document.querySelector(`[data-version="${target.id}"]`), null);
    const stored = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.42'));
    assert.equal(stored.estimates.some(row => String(row.id) === String(target.id)), false);
    dom.window.close();
}

test('runtime delete removes the original estimate card after creating a copy', async () => scenario(true));
test('runtime delete removes the copied estimate card', async () => scenario(false));
