const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const files = ['estimate_calculation_service.js', 'project_estimate_footer.js', 'estimating_workspace_service.js', 'project_estimating.js']
    .map(name => fs.readFileSync(path.join(root, 'assets', name), 'utf8'));

test('all details cards collapse and reopen through delegated events', () => {
    const dom = new JSDOM('<div id="estimatingModule" data-project-id="0"></div>', { url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true });
    dom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {} };
    files.forEach(source => dom.window.eval(source));
    for (const key of ['notes', 'summary', 'audit']) {
        let button = dom.window.document.querySelector(`[data-collapse-card="${key}"]`);
        assert.equal(button.getAttribute('aria-expanded'), 'true');
        button.querySelector('span').click();
        button = dom.window.document.querySelector(`[data-collapse-card="${key}"]`);
        assert.equal(button.getAttribute('aria-expanded'), 'false');
        button.click();
        assert.equal(dom.window.document.querySelector(`[data-collapse-card="${key}"]`).getAttribute('aria-expanded'), 'true');
    }
    dom.window.close();
});
