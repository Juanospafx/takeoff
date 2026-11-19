const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'assets', 'project_overview_dialogs.js');
const dashboard = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');
const dialogs = require(modulePath);

function fixture() {
    const dom = new JSDOM(`
        <div id="pdDocRenameModal"><h2 id="docRenameModalTitle"></h2>
            <label id="docRenameInputLabel"></label><input id="modalDocRenameInput">
            <button id="modalSaveDocRenameBtn">Save</button></div>`);
    const { document } = dom.window;
    const messages = [];
    const controller = dialogs.create({
        getElement: id => document.getElementById(id),
        window: dom.window,
        escapeHtml: value => String(value).replaceAll('<', '&lt;'),
        showToast: message => messages.push(message)
    });
    return { dom, document, controller, messages };
}

test('rename dialog binds once and submits the first edited value', () => {
    const { document, controller } = fixture();
    const values = [];
    controller.bindRenameForm();
    controller.bindRenameForm();
    controller.openRenameModal({ title: 'Rename Document', label: 'Name', currentName: 'Old.pdf', onSave: value => values.push(value) });
    document.getElementById('modalDocRenameInput').value = 'New.pdf';
    document.getElementById('modalSaveDocRenameBtn').click();
    assert.deepEqual(values, ['New.pdf']);
    assert.equal(document.getElementById('pdDocRenameModal').classList.contains('open'), false);
});

test('confirmation dialog preserves announcement semantics', async () => {
    const { dom, controller } = fixture();
    let options = null;
    dom.window.TakeoffAnnouncement = { show(value) { options = value; } };
    const result = controller.showConfirmDialog({ title: 'Delete file', message: 'Delete?', confirmText: 'Delete' });
    assert.equal(options.primaryDanger, true);
    assert.equal(options.cancelText, 'Cancel');
    options.onPrimary();
    assert.equal(await result, true);
});

test('dashboard loads overview dialogs before project overview with filemtime keys', () => {
    const dialogsIndex = dashboard.indexOf('project_overview_dialogs.js');
    const overviewIndex = dashboard.indexOf('project_overview.js');
    assert.ok(dialogsIndex >= 0 && dialogsIndex < overviewIndex);
    assert.match(dashboard, /project_overview_dialogs\.js\?v=<\?=\s*filemtime\(/);
});
