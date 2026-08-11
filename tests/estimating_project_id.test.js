const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'assets', 'project_estimating.js'), 'utf8');
const calculation = fs.readFileSync(path.join(root, 'assets', 'estimate_calculation_service.js'), 'utf8');
const footer = fs.readFileSync(path.join(root, 'assets', 'project_estimate_footer.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'project_estimating.php'), 'utf8');

test('Estimating resolves the project id from dashboard URL aliases when DOM state is absent', async () => {
    const dom = new JSDOM('<!doctype html><div id="estimatingModule"></div>', {
        url: 'https://takeoff.test/pages/project_dashboard.php?id=73&tab=estimating',
        runScripts: 'outside-only', pretendToBeVisual: true
    });
    const calls = [];
    dom.window.fetch = async url => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({ success: true, state: { estimates: [] } }) };
    };
    dom.window.eval(calculation);
    dom.window.eval(footer);
    dom.window.eval(client);
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
    assert.ok(calls.some(url => url.includes('project_id=73')));
    assert.ok(dom.window.localStorage.getItem('takeoff.estimating.module.73'));
    dom.window.close();
});

test('a local estimate snapshot is rebound to the authoritative dashboard project id', () => {
    const dom = new JSDOM('<!doctype html><div id="estimatingModule" data-project-id="73"></div>', {
        url: 'https://takeoff.test/pages/project_dashboard.php?id=73&tab=estimating',
        runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 73, projectInfo: {}, projectMeta: {}, estimateItems: [] };
    dom.window.localStorage.setItem('takeoff.estimating.module.73', JSON.stringify({
        activeEstimateId: 'estimate-a',
        estimates: [{ id: 'estimate-a', projectId: 9, name: 'Copied', groups: [], settings: {}, notes: {} }]
    }));
    dom.window.fetch = async () => new Promise(() => {});
    dom.window.eval(calculation);
    dom.window.eval(footer);
    dom.window.eval(client);
    const saved = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.73'));
    assert.equal(saved.estimates[0].projectId, 73);
    dom.window.close();
});

test('Estimating API accepts the project id aliases used by dashboard clients', () => {
    assert.match(api, /function pew_request_project_id/);
    assert.match(api, /array\('project_id', 'projectId', 'id'\)/);
    assert.match(api, /\$projectId = pew_request_project_id\(\$_GET, \$body\)/);
});
