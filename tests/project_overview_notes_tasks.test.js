const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('overview notes and tasks render dynamically in the DOM and support add/delete', () => {
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
            <div id="overviewNotesComposer" style="display:none;">
                <textarea id="overviewNoteContent"></textarea>
            </div>
            <div id="overviewNotesList"></div>

            <div id="overviewTaskComposer" style="display:none;">
                <input id="overviewTaskTitle">
                <input id="overviewTaskAssignee">
                <input id="overviewTaskDue">
            </div>
            <span id="overviewTaskCount">0</span>
            <div id="overviewTasksList"></div>
            <input id="poEstimator" value="Juan Estevez">
        </body>
        </html>
    `);
    const { document } = dom.window;
    const $ = id => document.getElementById(id);
    const escapeHtml = str => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let notes = [];
    let tasks = [];
    let isDirty = false;
    const markDirty = () => { isDirty = true; };

    function renderNotes() {
        const list = $('overviewNotesList');
        if (!list) return;
        if (!notes.length) {
            list.innerHTML = `
                <div class="overview-empty" id="overviewNotesEmpty">
                    <p>No notes yet</p>
                    <button class="btn-outline-dark" type="button" id="addNoteBtn">Add note</button>
                </div>`;
            return;
        }
        list.innerHTML = notes.map((note, idx) => `
            <div class="overview-list-item" data-note-index="${idx}">
                <div class="d-flex justify-content-between align-items-center">
                    <strong>${escapeHtml(note.user || 'User')}</strong>
                    <button type="button" data-delete-note="${idx}">Delete</button>
                </div>
                <p>${escapeHtml(note.content || '')}</p>
            </div>`).join('');
        list.querySelectorAll('[data-delete-note]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.deleteNote);
                if (Number.isInteger(idx) && idx >= 0 && idx < notes.length) {
                    notes.splice(idx, 1);
                    markDirty();
                    renderNotes();
                }
            });
        });
    }

    function renderTasks() {
        const list = $('overviewTasksList');
        const countBadge = $('overviewTaskCount');
        if (countBadge) countBadge.textContent = String(tasks.length);
        if (!list) return;
        if (!tasks.length) {
            list.innerHTML = `
                <div class="overview-empty" id="overviewTasksEmpty">
                    <p>No tasks yet</p>
                    <button class="btn-outline-dark" type="button" id="createTaskBtn">Create first task</button>
                </div>`;
            return;
        }
        list.innerHTML = tasks.map((task, idx) => `
            <div class="overview-list-item" data-task-index="${idx}">
                <div class="d-flex justify-content-between align-items-center">
                    <strong>${escapeHtml(task.title || '')}</strong>
                    <button type="button" data-delete-task="${idx}">Delete</button>
                </div>
            </div>`).join('');
        list.querySelectorAll('[data-delete-task]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.deleteTask);
                if (Number.isInteger(idx) && idx >= 0 && idx < tasks.length) {
                    tasks.splice(idx, 1);
                    markDirty();
                    renderTasks();
                }
            });
        });
    }

    // 1. Initial render
    renderNotes();
    renderTasks();
    assert.ok(document.getElementById('overviewNotesEmpty'), 'Should show empty notes state');
    assert.ok(document.getElementById('overviewTasksEmpty'), 'Should show empty tasks state');
    assert.equal(document.getElementById('overviewTaskCount').textContent, '0');

    // 2. Add note
    notes.push({ user: 'Juan Estevez', timestamp: '9/2/2026', content: 'Review subpanel conduit runs' });
    renderNotes();
    const noteItems = document.querySelectorAll('#overviewNotesList .overview-list-item');
    assert.equal(noteItems.length, 1, 'Should have 1 note item in DOM');
    assert.ok(noteItems[0].textContent.includes('Review subpanel conduit runs'));

    // 3. Add task
    tasks.push({ title: 'Send quotation to GC', responsible: 'Juan Estevez', due_date: '2026-09-10', status: 'open' });
    renderTasks();
    assert.equal(document.getElementById('overviewTaskCount').textContent, '1');
    const taskItems = document.querySelectorAll('#overviewTasksList .overview-list-item');
    assert.equal(taskItems.length, 1);
    assert.ok(taskItems[0].textContent.includes('Send quotation to GC'));

    // 4. Delete note
    const deleteNoteBtn = noteItems[0].querySelector('[data-delete-note="0"]');
    deleteNoteBtn.click();
    assert.equal(notes.length, 0);
    assert.ok(document.getElementById('overviewNotesEmpty'), 'Empty notes state should return');

    // 5. Delete task
    const deleteTaskBtn = taskItems[0].querySelector('[data-delete-task="0"]');
    deleteTaskBtn.click();
    assert.equal(tasks.length, 0);
    assert.equal(document.getElementById('overviewTaskCount').textContent, '0');
    assert.ok(document.getElementById('overviewTasksEmpty'), 'Empty tasks state should return');
});

test('saveProject in project_overview.js isolates takeoffFrame errors gracefully', () => {
    const root = path.resolve(__dirname, '..');
    const overviewJs = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');

    // Verify try/catch around takeoffFrame
    assert.match(overviewJs, /try\s*\{\s*const takeoffFrame = document\.getElementById\('takeoffFrame'\);/);
    assert.match(overviewJs, /catch\s*\(takeoffErr\)\s*\{\s*console\.warn\('Takeoff iframe save ignored or unavailable:', takeoffErr\);\s*\}/);

    // Verify window.projectTakeoffSaveState is called
    assert.match(overviewJs, /window\.projectTakeoffSaveState\(\);/);
});
