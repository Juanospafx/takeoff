const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/project_module.php'), 'utf8');

function documentsBrowser() {
    const dom = new JSDOM(`<!doctype html><div id="documentsPage"><div id="documentsFolderTree"></div><h2 id="documentsContentTitle"></h2><span id="documentsContentSubtitle"></span><div id="documentsList"></div></div>`, {
        url: 'https://takeoff.test/project/2', runScripts: 'outside-only', pretendToBeVisual: true
    });
    dom.window.ProjectState = {
        projectId: 2, projectInfo: {}, projectMeta: {},
        documents: [{ id: 17, source: 'legacy_file', filename: 'Plan.pdf', path: '/uploads/plan.pdf', extension: 'pdf' }]
    };
    dom.window.confirm = () => true;
    dom.window.prompt = () => null;
    dom.window.URL.createObjectURL = () => 'blob:test';
    const requests = [];
    dom.window.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
    };
    dom.window.eval(client);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    return { dom, requests };
}

test('nested menu click opens and delegated delete calls the backend then removes the row', async () => {
    const { dom, requests } = documentsBrowser();
    dom.window.document.querySelector('[data-doc-action="menu"] i').click();
    assert.equal(dom.window.document.querySelector('[data-doc-menu]').classList.contains('open'), true);
    dom.window.document.querySelector('[data-doc-action="delete"]').click();
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
    assert.deepEqual(requests[0], {
        action: 'document_action', project_id: 2, id: 17, source: 'legacy_file', operation: 'delete'
    });
    assert.equal(dom.window.ProjectState.documents.length, 0);
    assert.equal(dom.window.document.querySelector('[data-doc-id="existing-legacy_file-17"]'), null);
    dom.window.close();
});

test('document API scopes every mutation to source, document and project', () => {
    assert.match(api, /case 'document_action'/);
    assert.match(api, /SELECT \* FROM \{\$config\['table'\]\} WHERE id=\? AND project_id=\? AND deleted_at IS NULL/);
    assert.match(api, /UPDATE \{\$config\['table'\]\} SET deleted_at=CURRENT_TIMESTAMP WHERE id=\? AND project_id=\?/);
    assert.match(client, /if \(!confirm\(`Delete "\$\{doc\.name\}"\? This removes it from the project\.`\)\) return/);
});

test('project document mutations keep the Takeoff files mirror consistent', () => {
    assert.match(api, /\$mirrorPaths[\s\S]*storage_path/);
    assert.match(api, /UPDATE project_documents SET title=\?,original_filename=\?/);
    assert.match(api, /UPDATE files SET filename=\? WHERE project_id=\?/);
    assert.match(api, /UPDATE files SET deleted_at=CURRENT_TIMESTAMP WHERE project_id=\?/);
});

test('row actions use a viewport-level menu so later PDF actions are not clipped', () => {
    const css = fs.readFileSync(path.join(root, 'assets/project_overview.css'), 'utf8');
    assert.match(css, /\.documents-menu\.row-menu\s*\{[\s\S]*position:\s*fixed;[\s\S]*z-index:\s*5000/);
    assert.match(client, /positionFloatingMenu\(menu, trigger\)/);
});
