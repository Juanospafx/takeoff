(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ProjectOverviewNotesTasks = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const DEFAULT_USERS = [
        { id: 1, name: 'Isaac Diaz', role: 'Lead Estimator', initials: 'ID', avatarColor: '#5b4364' },
        { id: 2, name: 'Juan Estevez', role: 'Chief Estimator', initials: 'JE', avatarColor: '#1d5cc9' },
        { id: 3, name: 'Carlos Rodriguez', role: 'Project Manager', initials: 'CR', avatarColor: '#059669' },
        { id: 4, name: 'Sarah Jenkins', role: 'Senior Estimator', initials: 'SJ', avatarColor: '#d97706' },
        { id: 5, name: 'Michael Chang', role: 'Civil Estimator', initials: 'MC', avatarColor: '#0284c7' },
        { id: 6, name: 'Elena Rostova', role: 'Electrical Estimator', initials: 'ER', avatarColor: '#7c3aed' },
        { id: 7, name: 'David Miller', role: 'Mechanical Estimator', initials: 'DM', avatarColor: '#059669' },
        { id: 8, name: 'Amanda Brooks', role: 'Commercial Estimator', initials: 'AB', avatarColor: '#ea580c' },
        { id: 9, name: 'Marcus Vance', role: 'Structural Estimator', initials: 'MV', avatarColor: '#dc2626' },
        { id: 10, name: 'Ana Lopez', role: 'Estimating Coordinator', initials: 'AL', avatarColor: '#d97706' }
    ];

    function create(dependencies = {}) {
        const state = dependencies.state || {};
        const dom = dependencies.dom || {};
        const services = dependencies.services || {};
        const environment = dependencies.environment || {};
        const notes = state.notes || [];
        const tasks = state.tasks || [];
        const documentRef = dom.document || (typeof document !== 'undefined' ? document : null);
        const $ = dom.getElement || (id => documentRef?.getElementById(id));
        const escapeHtml = services.escapeHtml || (value => String(value ?? ''));
        const markDirty = services.markDirty || (() => {});
        const showToast = services.showToast || (() => {});
        const windowRef = environment.window || (typeof window !== 'undefined' ? window : globalThis);
        const getComputedStyleRef = environment.getComputedStyle || windowRef.getComputedStyle?.bind(windowRef);
        const setTimeoutRef = environment.setTimeout || windowRef.setTimeout?.bind(windowRef) || setTimeout;
        const now = environment.now || (() => Date.now());
        let contextMenuTarget = null;
        let bindingsReady = false;
        let systemUsers = DEFAULT_USERS.map(user => ({ ...user }));

        function renderNotes() {
            const list = $('overviewNotesList');
            const cardTitle = $('overviewNotesCardTitle');
            if (cardTitle) cardTitle.textContent = `Notes (${notes.length})`;
            if (!list) return;
            if (!notes.length) {
                list.innerHTML = `
                    <div class="pd-empty-card-state" id="overviewNotesEmpty" role="button" tabindex="0">
                        <div class="pd-empty-graphic">
                            <svg width="72" height="52" viewBox="0 0 72 52" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="18" y="10" width="46" height="36" rx="4" fill="rgba(0,0,0,0.08)" />
                                <rect x="14" y="6" width="46" height="36" rx="4" fill="var(--bg-panel)" stroke="var(--border)" stroke-width="1.5" />
                                <path d="M14 10C14 7.79 15.79 6 18 6H56C58.21 6 60 7.79 60 10V15H14V10Z" fill="#0055b8" />
                                <circle cx="20" cy="10.5" r="1.5" fill="#ffffff" opacity="0.8" />
                                <circle cx="25" cy="10.5" r="1.5" fill="#ffffff" opacity="0.8" />
                                <rect x="20" y="21" width="18" height="2" rx="1" fill="var(--border)" />
                                <rect x="20" y="26" width="26" height="2" rx="1" fill="var(--border)" />
                                <rect x="20" y="31" width="14" height="2" rx="1" fill="var(--border)" />
                                <path d="M10 28H18M14 24V32" stroke="#fb5a3a" stroke-width="2.5" stroke-linecap="round" />
                                <path d="M14 20L15 22L17 22L15.5 23.5L16 25.5L14 24.5L12 25.5L12.5 23.5L11 22L13 22L14 20Z" fill="#fb5a3a" />
                            </svg>
                        </div>
                        <div class="pd-empty-title">Create a Note</div>
                        <div class="pd-empty-subtitle">Take notes to help organize thoughts and information with your team.</div>
                    </div>`;
                $('overviewNotesEmpty')?.addEventListener('click', () => openNoteModal());
                return;
            }

            list.innerHTML = `
                <div class="pd-list-month-header">September</div>
                ${notes.map((note, idx) => {
                const author = note.user || 'Isaac De Jes\u00fas';
                const initial = (author[0] || 'I').toUpperCase();
                return `
                        <div class="pd-note-item" data-note-index="${idx}">
                            <div class="pd-note-avatar">${escapeHtml(initial)}</div>
                            <div class="pd-note-content-wrap">
                                <div class="pd-note-author">${escapeHtml(author)}</div>
                                <div class="pd-note-time">${escapeHtml(note.timestamp || 'in less than a minute')}</div>
                                <div class="pd-note-bubble">${escapeHtml(note.content || '').replace(/\n/g, '<br>')}</div>
                            </div>
                            <div class="pd-item-menu-wrap">
                                <button type="button" class="pd-row-dots-btn" data-note-menu="${idx}" title="Note options"><i class="fas fa-ellipsis-vertical"></i></button>
                            </div>
                        </div>
                    `;
            }).join('')}
            `;

            list.querySelectorAll('[data-note-menu]').forEach(button => {
                button.addEventListener('click', event => {
                    event.stopPropagation();
                    openItemContextMenu(button, 'note', Number(button.dataset.noteMenu));
                });
            });
        }

        function openNoteModal(index = -1) {
            const modal = $('pdNoteModal');
            const titleElement = $('noteModalTitle');
            const indexInput = $('modalNoteIndex');
            const contentInput = $('modalNoteContent');
            if (!modal) return;

            if (index >= 0 && index < notes.length) {
                if (titleElement) titleElement.innerHTML = '<i class="fas fa-sticky-note" style="color: var(--primary);"></i> Edit Note';
                if (indexInput) indexInput.value = String(index);
                if (contentInput) contentInput.value = notes[index].content || '';
            } else {
                if (titleElement) titleElement.innerHTML = '<i class="fas fa-sticky-note" style="color: var(--primary);"></i> Add Note';
                if (indexInput) indexInput.value = '-1';
                if (contentInput) contentInput.value = '';
            }

            modal.classList.add('open');
            setTimeoutRef(() => contentInput?.focus(), 50);
        }

        function saveNoteFromModal() {
            const indexInput = $('modalNoteIndex');
            const contentInput = $('modalNoteContent');
            const content = contentInput?.value.trim();
            if (!content) return;

            const index = Number(indexInput?.value ?? -1);
            if (index >= 0 && index < notes.length) {
                notes[index].content = content;
                notes[index].timestamp = 'just now';
            } else {
                notes.push({
                    user: $('poEstimator')?.value || 'Isaac De Jes\u00fas',
                    timestamp: 'in less than a minute',
                    content
                });
            }

            $('pdNoteModal')?.classList.remove('open');
            markDirty();
            renderNotes();
            showToast('Note saved locally. Press Save Project to persist it.');
        }

        function renderTasks() {
            const list = $('overviewTasksList');
            const cardTitle = $('overviewTasksCardTitle');
            if (cardTitle) cardTitle.textContent = `Tasks (${tasks.length})`;
            const countBadge = $('overviewTaskCount');
            if (countBadge) countBadge.textContent = String(tasks.length);
            if (!list) return;
            if (!tasks.length) {
                list.innerHTML = `
                    <div class="pd-empty-card-state" id="overviewTasksEmpty" role="button" tabindex="0">
                        <div class="pd-empty-graphic">
                            <svg width="72" height="52" viewBox="0 0 72 52" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="18" y="10" width="46" height="36" rx="4" fill="rgba(0,0,0,0.08)" />
                                <rect x="14" y="6" width="46" height="36" rx="4" fill="var(--bg-panel)" stroke="var(--border)" stroke-width="1.5" />
                                <path d="M14 10C14 7.79 15.79 6 18 6H56C58.21 6 60 7.79 60 10V15H14V10Z" fill="#0055b8" />
                                <circle cx="20" cy="10.5" r="1.5" fill="#ffffff" opacity="0.8" />
                                <circle cx="25" cy="10.5" r="1.5" fill="#ffffff" opacity="0.8" />
                                <rect x="20" y="21" width="18" height="2" rx="1" fill="var(--border)" />
                                <rect x="20" y="26" width="26" height="2" rx="1" fill="var(--border)" />
                                <rect x="20" y="31" width="14" height="2" rx="1" fill="var(--border)" />
                                <path d="M10 28H18M14 24V32" stroke="#fb5a3a" stroke-width="2.5" stroke-linecap="round" />
                                <path d="M14 20L15 22L17 22L15.5 23.5L16 25.5L14 24.5L12 25.5L12.5 23.5L11 22L13 22L14 20Z" fill="#fb5a3a" />
                            </svg>
                        </div>
                        <div class="pd-empty-title">Create a Task</div>
                        <div class="pd-empty-subtitle">Assign a task with a due date to yourself or someone else on your team.</div>
                    </div>`;
                $('overviewTasksEmpty')?.addEventListener('click', () => openTaskModal());
                return;
            }

            list.innerHTML = tasks.map((task, idx) => {
                const dueText = task.due_date ? formatTaskDue(task.due_date) : '';
                return `
                    <div class="pd-task-item" data-task-index="${idx}">
                        <div class="pd-task-icon-box"><i class="fas fa-clipboard"></i></div>
                        <div class="pd-task-content-wrap">
                            <div class="pd-task-title">${escapeHtml(task.title || '')}</div>
                            <div class="pd-task-meta-row">
                                <div class="pd-task-assignee">For ${escapeHtml(task.responsible || 'Isaac De Jes\u00fas')}</div>
                                ${dueText ? `<div class="pd-task-due-badge">${escapeHtml(dueText)}</div>` : ''}
                            </div>
                        </div>
                        <div class="pd-item-menu-wrap">
                            <button type="button" class="pd-row-dots-btn" data-task-menu="${idx}" title="Task options"><i class="fas fa-ellipsis-vertical"></i></button>
                        </div>
                    </div>`;
            }).join('');

            list.querySelectorAll('[data-task-menu]').forEach(button => {
                button.addEventListener('click', event => {
                    event.stopPropagation();
                    openItemContextMenu(button, 'task', Number(button.dataset.taskMenu));
                });
            });
        }

        function formatTaskDue(dateValue) {
            if (!dateValue) return '';
            try {
                const date = new Date(dateValue);
                if (Number.isNaN(date.getTime())) return `Due ${dateValue}`;
                const diffHours = Math.round((date.getTime() - now()) / (1000 * 60 * 60));
                if (diffHours > 0 && diffHours < 48) {
                    return `Due in about ${diffHours} hour${diffHours === 1 ? '' : 's'}`;
                }
                return `Due ${date.toLocaleDateString()}`;
            } catch (error) {
                return `Due ${dateValue}`;
            }
        }

        function loadSystemUsers() {
            if (windowRef.ProjectState && Array.isArray(windowRef.ProjectState.availableEstimators) && windowRef.ProjectState.availableEstimators.length) {
                systemUsers = windowRef.ProjectState.availableEstimators;
            }
            populateAssigneeSelector();
            populateEstimatorSelector();
        }

        function populateAssigneeSelector(selectedAssignee = null) {
            const select = $('modalTaskAssignee');
            if (!select) return;
            const current = (selectedAssignee || select.value || '').trim();
            select.innerHTML = '<option value="">-- Choose an Assignee --</option>' + systemUsers.map(user => {
                const selected = current && (current === user.name || current.toLowerCase() === user.name.toLowerCase()) ? 'selected' : '';
                return `<option value="${escapeHtml(user.name)}" ${selected}>${escapeHtml(user.name)} (${escapeHtml(user.role || 'Member')})</option>`;
            }).join('');
            if (current && !systemUsers.some(user => user.name.toLowerCase() === current.toLowerCase())) {
                const option = documentRef.createElement('option');
                option.value = current;
                option.textContent = `${current} (Custom)`;
                option.selected = true;
                select.appendChild(option);
            }
        }

        function populateEstimatorSelector(selectedEstimator = null) {
            const select = $('poEstimator');
            if (!select) return;
            const current = (selectedEstimator !== null ? selectedEstimator : (select.value || select.dataset.initialValue || '')).trim();
            select.innerHTML = '<option value="">-- Select an Estimator --</option>' + systemUsers.map(user => {
                const selected = current && (current === user.name || current.toLowerCase() === user.name.toLowerCase()) ? 'selected' : '';
                return `<option value="${escapeHtml(user.name)}" ${selected}>${escapeHtml(user.name)} (${escapeHtml(user.role || 'Estimator')})</option>`;
            }).join('');
            if (current && current !== 'Unassigned' && !systemUsers.some(user => user.name.toLowerCase() === current.toLowerCase())) {
                const option = documentRef.createElement('option');
                option.value = current;
                option.textContent = `${current} (Custom)`;
                option.selected = true;
                select.appendChild(option);
            }
        }

        function openTaskModal(index = -1) {
            const modal = $('pdTaskModal');
            const titleElement = $('taskModalTitle');
            const indexInput = $('modalTaskIndex');
            const taskTitleInput = $('modalTaskTitle');
            const dueInput = $('modalTaskDue');
            if (!modal) return;

            if (index >= 0 && index < tasks.length) {
                if (titleElement) titleElement.innerHTML = '<i class="fas fa-tasks" style="color: var(--primary);"></i> Edit Task';
                if (indexInput) indexInput.value = String(index);
                if (taskTitleInput) taskTitleInput.value = tasks[index].title || '';
                populateAssigneeSelector(tasks[index].responsible || 'Isaac Diaz');
                if (dueInput) dueInput.value = tasks[index].due_date || '';
            } else {
                if (titleElement) titleElement.innerHTML = '<i class="fas fa-tasks" style="color: var(--primary);"></i> Create Task';
                if (indexInput) indexInput.value = '-1';
                if (taskTitleInput) taskTitleInput.value = '';
                populateAssigneeSelector($('poEstimator')?.value || 'Isaac Diaz');
                if (dueInput) dueInput.value = '';
            }
            modal.classList.add('open');
            setTimeoutRef(() => taskTitleInput?.focus(), 50);
        }

        function saveTaskFromModal() {
            const title = $('modalTaskTitle')?.value.trim();
            if (!title) return;
            const responsible = $('modalTaskAssignee')?.value.trim() || $('poEstimator')?.value || 'Isaac Diaz';
            const due = $('modalTaskDue')?.value || '';
            const index = Number($('modalTaskIndex')?.value ?? -1);
            if (index >= 0 && index < tasks.length) {
                tasks[index].title = title;
                tasks[index].responsible = responsible;
                tasks[index].due_date = due;
            } else {
                tasks.push({ title, responsible, due_date: due, status: 'open' });
            }
            $('pdTaskModal')?.classList.remove('open');
            markDirty();
            renderTasks();
            showToast('Task saved locally. Press Save Project to persist it.');
        }

        function openItemContextMenu(button, type, index) {
            const menu = $('pdItemContextMenu');
            if (!menu) return;
            const isOpen = menu.style.display === 'flex' && contextMenuTarget?.type === type && contextMenuTarget?.index === index;
            closeItemContextMenu();
            if (isOpen) return;
            contextMenuTarget = { type, index };
            const rect = button.getBoundingClientRect();
            const zoom = parseFloat(getComputedStyleRef(documentRef.documentElement).zoom) || 1;
            menu.__trigger = button;
            button.classList.add('is-active');
            button.setAttribute('aria-expanded', 'true');
            menu.style.display = 'flex';
            menu.style.position = 'fixed';
            menu.style.zIndex = '99999';
            const boundaryElement = button.closest('#overviewTab, .workspace-shell, body') || documentRef.body;
            const margin = 10;
            const boundaryRect = boundaryElement !== documentRef.body ? boundaryElement.getBoundingClientRect() : {
                left: 0, top: 0, right: windowRef.innerWidth, bottom: windowRef.innerHeight
            };
            const minLeft = Math.max(margin, (boundaryRect.left / zoom) + margin);
            const maxRight = Math.min((windowRef.innerWidth / zoom) - margin, (boundaryRect.right / zoom) - margin);
            const maxBottom = Math.min((windowRef.innerHeight / zoom) - margin, (boundaryRect.bottom / zoom) - margin);
            const menuWidth = menu.offsetWidth || 130;
            const menuHeight = menu.offsetHeight || 140;
            let left = (rect.right / zoom) - menuWidth;
            if (left < minLeft) left = rect.left / zoom;
            left = Math.max(minLeft, Math.min(left, maxRight - menuWidth));
            let top = (rect.bottom / zoom) + 4;
            if (top + menuHeight > maxBottom) top = Math.max(margin, (rect.top / zoom) - menuHeight - 4);
            menu.style.left = `${Math.round(left)}px`;
            menu.style.top = `${Math.round(top)}px`;
        }

        function closeItemContextMenu() {
            const menu = $('pdItemContextMenu');
            if (menu) {
                menu.style.display = 'none';
                if (menu.__trigger) {
                    menu.__trigger.classList.remove('active', 'is-active');
                    menu.__trigger.setAttribute('aria-expanded', 'false');
                }
                menu.__trigger = null;
            }
            contextMenuTarget = null;
        }

        function deleteContextItem() {
            if (!contextMenuTarget) return;
            const { type, index } = contextMenuTarget;
            closeItemContextMenu();
            if (type === 'note' && index >= 0 && index < notes.length) {
                notes.splice(index, 1);
                markDirty();
                renderNotes();
                showToast('Note deleted.');
            } else if (type === 'task' && index >= 0 && index < tasks.length) {
                tasks.splice(index, 1);
                markDirty();
                renderTasks();
                showToast('Task deleted.');
            }
        }

        function editContextItem() {
            if (!contextMenuTarget) return;
            const { type, index } = contextMenuTarget;
            closeItemContextMenu();
            if (type === 'note') openNoteModal(index);
            else if (type === 'task') openTaskModal(index);
        }

        function bindEvents() {
            if (bindingsReady) return;
            bindingsReady = true;
            $('addNoteBtn')?.addEventListener('click', () => openNoteModal(-1));
            $('addNoteBtnHead')?.addEventListener('click', () => openNoteModal(-1));
            $('modalSaveNoteBtn')?.addEventListener('click', saveNoteFromModal);
            $('createTaskBtn')?.addEventListener('click', () => openTaskModal(-1));
            $('createTaskBtnHead')?.addEventListener('click', () => openTaskModal(-1));
            $('modalSaveTaskBtn')?.addEventListener('click', saveTaskFromModal);
            $('pdItemActionEdit')?.addEventListener('click', editContextItem);
            $('pdItemActionDelete')?.addEventListener('click', deleteContextItem);
            documentRef?.addEventListener('click', event => {
                if (!event.target.closest('#pdItemContextMenu') && !event.target.closest('.pd-item-menu-wrap')) {
                    closeItemContextMenu();
                }
            });
        }

        function getUsers() { return systemUsers; }
        function setUsers(list) {
            if (Array.isArray(list)) systemUsers = list;
            populateAssigneeSelector();
            populateEstimatorSelector();
        }

        return Object.freeze({
            renderNotes,
            openNoteModal,
            saveNoteFromModal,
            renderTasks,
            formatTaskDue,
            openTaskModal,
            saveTaskFromModal,
            loadSystemUsers,
            populateAssigneeSelector,
            populateEstimatorSelector,
            closeItemContextMenu,
            bindEvents,
            getUsers,
            setUsers
        });
    }

    return Object.freeze({ create });
});
