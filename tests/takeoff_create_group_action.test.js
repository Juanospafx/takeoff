const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.js'), 'utf8');

function actionRuntime() {
    const dom = new JSDOM(`
        <button type="button" data-takeoff-action="create-group"><span>Create New Group</span></button>
        <div id="takeoffGroupModal" hidden style="display:none">
            <form id="takeoffGroupForm"><input id="takeoffGroupName"><button type="submit">Create group</button></form>
            <span id="takeoffGroupNameCount"></span><div id="takeoffGroupNameError" hidden></div>
            <span id="takeoffGroupModalHeading"></span><i id="takeoffGroupModalIcon"></i><span id="takeoffGroupSubmitText"></span>
        </div>`, {
        url: 'https://takeoff.test/pages/project_dashboard.php?id=1',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    dom.window.ProjectState = { projectId: 1, estimates: [{ id: 'primary', name: 'Primary Estimate' }] };
    dom.window.TakeoffAuth = { canWrite: true };
    dom.window.TakeoffAuthorization = { requireWrite: () => true };
    dom.window.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', data: {} }) });
    dom.window.eval(source);
    return dom;
}

test('Takeoff actions use one delegated click path that survives workspace rerenders', () => {
    assert.match(source, /function bindTakeoffActionDelegation\(\)[\s\S]*document\.addEventListener\('click',[\s\S]*closest\?\.\('\[data-takeoff-action\]'\)[\s\S]*handleTakeoffAction\(button\.dataset\.takeoffAction\)/);
    assert.match(source, /bindTakeoffActionDelegation\(\);[\s\S]*document\.addEventListener\('DOMContentLoaded'/);
    assert.doesNotMatch(source, /querySelectorAll\('\[data-takeoff-action\]'\)\.forEach\(button => \{\s*button\.addEventListener/);
});

test('Create New Group routes to the existing authorized dialog', () => {
    assert.match(source, /if \(action === 'create-group'\) return openTakeoffGroupModal\(document\.activeElement\)/);
    assert.match(source, /function openTakeoffGroupModal\([\s\S]*if \(!requireWrite\(\)\) return false;[\s\S]*modal\.hidden = false;[\s\S]*modal\.style\.display = 'flex'/);
});

test('the production click target opens the dialog even before DOMContentLoaded initialization', () => {
    const dom = actionRuntime();
    const buttonLabel = dom.window.document.querySelector('[data-takeoff-action="create-group"] span');
    buttonLabel.click();
    const modal = dom.window.document.getElementById('takeoffGroupModal');
    assert.equal(modal.hidden, false);
    assert.equal(modal.style.display, 'flex');
    dom.window.document.getElementById('takeoffGroupName').value = 'Lighting';
    dom.window.document.getElementById('takeoffGroupForm').dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true })
    );
    const saved = JSON.parse(dom.window.localStorage.getItem('takeoff_project_groups_1'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'Lighting');
    assert.equal(modal.hidden, true);
    dom.window.close();
});

test('group form submission is delegated and creates only through the guarded path', () => {
    assert.match(source, /document\.addEventListener\('submit',[\s\S]*event\.target\?\.id !== 'takeoffGroupForm'[\s\S]*submitTakeoffGroupModal\(event\)/);
    assert.match(source, /function submitTakeoffGroupModal\(event\)[\s\S]*if \(!requireWrite\(\)\) return false;[\s\S]*if \(createTakeoffGroup\(name\)\) closeTakeoffGroupModal\(\)/);
    assert.match(source, /function createTakeoffGroup\(name\)[\s\S]*if \(!requireWrite\(\)\) return false;/);
});
