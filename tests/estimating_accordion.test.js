const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
const calculation = fs.readFileSync(path.join(root, 'assets/estimate_calculation_service.js'), 'utf8');
const footer = fs.readFileSync(path.join(root, 'assets/project_estimate_footer.js'), 'utf8');

function browserWithState(collapsed = {}) {
    const dom = new JSDOM('<!doctype html><div id="estimatingModule" data-project-id="0"></div>', {
        url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {}, projectInfo: { name: 'Accordion test' } };
    dom.window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify({
        activeEstimateId: 'primary',
        estimates: [{ id: 'primary', name: 'Primary', status: 'draft', groups: [] }],
        ...collapsed
    }));
    dom.window.eval(calculation);
    dom.window.eval(footer);
    dom.window.eval(client);
    return dom;
}

test('legacy string false does not collapse estimating panels', () => {
    const dom = browserWithState({ notesCollapsed: 'false', summaryCollapsed: 'false', auditCollapsed: 'false' });
    for (const key of ['notesCollapsed', 'summaryCollapsed', 'auditCollapsed']) {
        const button = dom.window.document.querySelector(`[data-collapse-card="${key}"]`);
        assert.equal(button.getAttribute('aria-expanded'), 'true');
        assert.equal(button.closest('.est-card').classList.contains('collapsed'), false);
    }
    dom.window.close();
});

test('accordion remains interactive across innerHTML rerenders', () => {
    const dom = browserWithState();
    let button = dom.window.document.querySelector('[data-collapse-card="notesCollapsed"]');
    button.querySelector('i').click();
    button = dom.window.document.querySelector('[data-collapse-card="notesCollapsed"]');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.closest('.est-card').classList.contains('collapsed'), true);
    button.querySelector('small').click();
    button = dom.window.document.querySelector('[data-collapse-card="notesCollapsed"]');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(button.closest('.est-card').classList.contains('collapsed'), false);
    dom.window.close();
});

test('one delegated listener handles every accordion from nested click targets', () => {
    const dom = browserWithState();
    for (const key of ['notesCollapsed', 'summaryCollapsed', 'auditCollapsed']) {
        let button = dom.window.document.querySelector(`[data-collapse-card="${key}"]`);
        button.querySelector('span').click();
        button = dom.window.document.querySelector(`[data-collapse-card="${key}"]`);
        assert.equal(button.getAttribute('aria-expanded'), 'false', `${key} must collapse from a nested target`);
    }
    assert.doesNotMatch(client, /querySelectorAll\('\[data-collapse-card\]'\)\.forEach/);
    assert.match(client, /root\.addEventListener\('click',[\s\S]*closest\('\[data-collapse-card\]'\)/);
    dom.window.close();
});
