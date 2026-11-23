const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const notesTasksModule = require('../assets/project_overview_notes_tasks.js');

function createHarness({ notes = [], tasks = [], availableEstimators = [] } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>
        <button id="addNoteBtn"></button><button id="addNoteBtnHead"></button>
        <strong id="overviewNotesCardTitle"></strong><div id="overviewNotesList"></div>
        <div id="pdNoteModal"><h2 id="noteModalTitle"></h2><input id="modalNoteIndex"><textarea id="modalNoteContent"></textarea><button id="modalSaveNoteBtn"></button></div>
        <button id="createTaskBtn"></button><button id="createTaskBtnHead"></button>
        <strong id="overviewTasksCardTitle"></strong><span id="overviewTaskCount"></span><div id="overviewTasksList"></div>
        <div id="pdTaskModal"><h2 id="taskModalTitle"></h2><input id="modalTaskIndex"><input id="modalTaskTitle"><select id="modalTaskAssignee"></select><input id="modalTaskDue"><button id="modalSaveTaskBtn"></button></div>
        <select id="poEstimator" data-initial-value="Juan Estevez"><option value="Juan Estevez" selected>Juan Estevez</option></select>
        <div id="pdItemContextMenu" style="display:none"><button id="pdItemActionEdit"></button><button id="pdItemActionDelete"></button></div>
    </body></html>`, { pretendToBeVisual: true });
    const dirtyCalls = [];
    const toastCalls = [];
    dom.window.ProjectState = { availableEstimators };
    const controller = notesTasksModule.create({
        state: { notes, tasks },
        dom: { document: dom.window.document, getElement: id => dom.window.document.getElementById(id) },
        services: {
            escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
            markDirty: () => dirtyCalls.push(true),
            showToast: message => toastCalls.push(message)
        },
        environment: {
            window: dom.window,
            getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
            setTimeout: callback => callback(),
            now: () => new Date('2026-09-09T12:00:00Z').getTime()
        }
    });
    return { dom, document: dom.window.document, controller, notes, tasks, dirtyCalls, toastCalls };
}

test('notes/tasks controller renders, saves and deletes through production event bindings', () => {
    const harness = createHarness();
    const { document, controller, notes, tasks, dirtyCalls, toastCalls } = harness;
    controller.bindEvents();
    controller.renderNotes();
    controller.renderTasks();

    assert.ok(document.getElementById('overviewNotesEmpty'));
    assert.ok(document.getElementById('overviewTasksEmpty'));
    assert.equal(document.getElementById('overviewTaskCount').textContent, '0');

    document.getElementById('addNoteBtn').click();
    assert.ok(document.getElementById('pdNoteModal').classList.contains('open'));
    document.getElementById('modalNoteContent').value = '<review> feeder schedule';
    document.getElementById('modalSaveNoteBtn').click();
    assert.equal(notes.length, 1);
    assert.match(document.getElementById('overviewNotesList').textContent, /<review> feeder schedule/);
    assert.doesNotMatch(document.getElementById('overviewNotesList').innerHTML, /<review>/);

    document.getElementById('createTaskBtn').click();
    document.getElementById('modalTaskTitle').value = 'Send quotation to GC';
    document.getElementById('modalTaskDue').value = '2026-09-10';
    document.getElementById('modalSaveTaskBtn').click();
    assert.equal(tasks.length, 1);
    assert.equal(document.getElementById('overviewTaskCount').textContent, '1');
    assert.match(document.getElementById('overviewTasksList').textContent, /Send quotation to GC/);

    document.querySelector('[data-note-menu="0"]').click();
    assert.equal(document.getElementById('pdItemContextMenu').style.display, 'flex');
    document.getElementById('pdItemActionDelete').click();
    assert.equal(notes.length, 0);
    assert.ok(document.getElementById('overviewNotesEmpty'));

    document.querySelector('[data-task-menu="0"]').click();
    document.getElementById('pdItemActionDelete').click();
    assert.equal(tasks.length, 0);
    assert.ok(document.getElementById('overviewTasksEmpty'));
    assert.equal(dirtyCalls.length, 4);
    assert.deepEqual(toastCalls, [
        'Note saved locally. Press Save Project to persist it.',
        'Task saved locally. Press Save Project to persist it.',
        'Note deleted.',
        'Task deleted.'
    ]);
});

test('users contract keeps ProjectState estimators and supports runtime replacement', () => {
    const harness = createHarness({
        availableEstimators: [{ id: 91, name: 'Production Estimator', role: 'Lead' }]
    });
    harness.controller.loadSystemUsers();
    assert.equal(harness.controller.getUsers()[0].name, 'Production Estimator');
    assert.match(harness.document.getElementById('poEstimator').textContent, /Production Estimator/);

    harness.controller.setUsers([{ id: 92, name: 'Replacement Estimator', role: 'Chief' }]);
    assert.equal(harness.controller.getUsers()[0].name, 'Replacement Estimator');
    assert.match(harness.document.getElementById('modalTaskAssignee').textContent, /Replacement Estimator/);
});

test('dashboard loads the extracted classic module before overview with filemtime cache keys', () => {
    const root = path.resolve(__dirname, '..');
    const dashboard = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
    const overview = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');
    const moduleIndex = dashboard.indexOf('project_overview_notes_tasks.js');
    const overviewIndex = dashboard.indexOf('project_overview.js');

    assert.ok(moduleIndex >= 0 && moduleIndex < overviewIndex);
    assert.match(dashboard, /project_overview_notes_tasks\.js\?v=<\?= filemtime\(__DIR__ \. '\/\.\.\/assets\/project_overview_notes_tasks\.js'\) \?>/);
    assert.match(overview, /window\.ProjectOverviewNotesTasks\.create\(\{[\s\S]*state: \{ notes, tasks \}[\s\S]*dom: \{ getElement: \$, document \}[\s\S]*services: \{ escapeHtml, markDirty, showToast \}/);
    assert.match(overview, /window\.TakeoffUsers = \{\s*getUsers: overviewNotesTasks\.getUsers,\s*setUsers: overviewNotesTasks\.setUsers,\s*load: loadSystemUsers/);
});

test('saveProject propagates Takeoff and Estimating persistence failures', () => {
    const root = path.resolve(__dirname, '..');
    const overview = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');
    assert.match(overview, /await saveTakeoff\.call\(takeoffFrame\.contentWindow\)/);
    assert.match(overview, /await window\.projectTakeoffSaveState\(\)/);
    assert.match(overview, /await window\.projectEstimatingSave\(\)/);
    assert.doesNotMatch(overview, /save ignored|save warning|save error/);
});
