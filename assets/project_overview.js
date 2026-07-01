(function () {
    const apiUrl = '../api/project_module.php';
    const PROJECT_STATUSES = ['Invitations', 'To Do', 'Estimating', 'Bid Submitted', 'Accepted', 'In Progress', 'Complete', 'Estimadores', 'Lost', 'Archived'];
    const STATUS_VALUES = {
        'Invitations': 'invitations',
        'To Do': 'to_do',
        'Estimating': 'estimating',
        'Bid Submitted': 'bid_submitted',
        'Accepted': 'accepted',
        'In Progress': 'in_progress',
        'Complete': 'complete',
        'Estimadores': 'estimadores',
        'Lost': 'lost',
        'Archived': 'archived'
    };
    const STATUS_LABELS = Object.fromEntries(Object.entries(STATUS_VALUES).map(([label, value]) => [value, label]));
    STATUS_LABELS.draft = 'To Do';
    STATUS_LABELS.estimators = 'Estimadores';

    let isDirty = false;
    let notes = Array.isArray(window.ProjectState?.projectMeta?.notes) ? [...window.ProjectState.projectMeta.notes] : [];
    let tasks = Array.isArray(window.ProjectState?.projectMeta?.tasks) ? [...window.ProjectState.projectMeta.tasks] : [];
    let currentStatus = normalizeStatus(window.ProjectState?.projectInfo?.status || 'to_do');
    let uploadCategory = null;
    let localDocuments = loadLocalDocuments();
    const sessionFiles = new Map();

    const $ = (id) => document.getElementById(id);
    const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    function markDirty() {
        isDirty = true;
    }

    function request(action, payload = {}) {
        return fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        }).then(r => r.json()).then(data => {
            if (data.status !== 'success') throw new Error(data.msg || 'Project request failed');
            return data;
        });
    }

    function collectProjectPayload() {
        const dueDate = dateInputValue($('poDueDate')?.value || '');
        const dueTime = $('poDueTime')?.value || '';
        const bidDueAt = dueDate ? `${dueDate} ${dueTime || '00:00'}:00` : '';
        const metadata = {
            estimator: $('poEstimator')?.value || 'Juan Estevez',
            measurement_system: $('poMeasurementSystem')?.value || 'US',
            estimate_pricing: $('poEstimatePricing')?.value || 'Unlocked',
            office: $('poOffice')?.value || '',
            square_footage: $('poSquareFootage')?.value || '',
            customer_company: $('poCustomerCompany')?.value || '',
            primary_contact: $('poPrimaryContact')?.value || '',
            customer_phone: $('poCustomerPhone')?.value || '',
            customer_email: $('poCustomerEmail')?.value || '',
            notes,
            tasks
        };

        return {
            id: Number(window.ProjectState?.projectId || 0) || 0,
            project_template_id: window.ProjectState?.projectInfo?.project_template_id || '',
            name: $('poEstimateName')?.value.trim() || 'New Project',
            description: $('poProjectDescription')?.value || '',
            status: currentStatus,
            project_number: $('poProjectNumber')?.value || '',
            client_name: $('poCustomerCompany')?.value || '',
            job_address: $('poProjectAddress')?.value || $('poCustomerAddress')?.value || '',
            bid_due_at: bidDueAt,
            metadata_json: JSON.stringify(metadata)
        };
    }

    function saveProject() {
        const payload = collectProjectPayload();
        if (!payload.name.trim()) {
            showToast('Estimate Name is required.');
            return;
        }

        request('save', payload)
            .then(data => {
                isDirty = false;
                localStorage.removeItem('takeoff.projectDraft');
                showToast('Project saved.');
                if (Number(window.ProjectState?.projectId || 0) === 0) {
                    migrateDraftDocuments(data.id);
                    window.location.href = `project_dashboard.php?id=${encodeURIComponent(data.id)}&tab=overview`;
                } else {
                    window.ProjectState.projectId = data.id;
                    window.ProjectState.projectInfo = data.data?.project || window.ProjectState.projectInfo;
                    $('projectHeaderName').textContent = payload.name;
                    renderProjectHeaderMeta();
                    renderStatusStepper();
                }
            })
            .catch(err => showToast(err.message));
    }

    function normalizeStatus(value) {
        const raw = String(value || 'to_do').trim();
        const lower = raw.toLowerCase().replace(/[\s-]+/g, '_');
        if (STATUS_LABELS[lower]) return lower;
        const upper = raw.toUpperCase().replace(/[_-]+/g, ' ');
        return STATUS_VALUES[upper] || 'to_do';
    }

    function statusLabel(value = currentStatus) {
        return STATUS_LABELS[normalizeStatus(value)] || 'To Do';
    }

    function dateInputValue(value) {
        const text = String(value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
        const year = Number(text.slice(0, 4));
        if (year < 2000 || year > 2100) return '';
        return text;
    }

    function dueLabel(value = $('poDueDate')?.value || '') {
        const text = dateInputValue(value);
        if (!text) return 'To be determined';
        const [year, month, day] = text.split('-');
        return `${month}/${day}/${year}`;
    }

    function renderStatusDropdown() {
        const button = $('projectStatusButton');
        const label = $('projectStatusLabel');
        const menu = $('projectStatusMenu');
        if (!button || !label || !menu) return;

        const activeLabel = statusLabel();
        button.className = `project-status-badge status-${slug(activeLabel)}`;
        button.dataset.status = currentStatus;
        label.textContent = activeLabel;
        renderProjectHeaderMeta();
        renderStatusStepper();
        menu.innerHTML = PROJECT_STATUSES.map(status => `
            <button class="project-status-option" type="button" data-project-status="${STATUS_VALUES[status]}">
                <span class="status-pill status-${slug(status)}">${status}</span>
            </button>
        `).join('');

        menu.querySelectorAll('[data-project-status]').forEach(option => {
            option.addEventListener('click', event => {
                event.stopPropagation();
                changeProjectStatus(option.dataset.projectStatus);
            });
        });
    }

    function changeProjectStatus(status) {
        currentStatus = normalizeStatus(status);
        if (window.ProjectState?.projectInfo) {
            window.ProjectState.projectInfo.status = currentStatus;
        }
        renderStatusDropdown();
        $('projectStatusMenu')?.classList.remove('open');

        if (Number(window.ProjectState?.projectId || 0) === 0) {
            markDirty();
            showToast(`Status set to ${statusLabel()}. Press Save Project to persist it.`);
            return;
        }

        request('save', collectProjectPayload())
            .then(data => {
                isDirty = false;
                window.ProjectState.projectInfo = data.data?.project || window.ProjectState.projectInfo;
                showToast(`Project moved to ${statusLabel()}.`);
                renderProjectHeaderMeta();
                renderStatusStepper();
            })
            .catch(err => showToast(err.message));
    }

    function renderProjectHeaderMeta() {
        const subtitle = $('projectHeaderSubtitle');
        if (subtitle) subtitle.textContent = `Project Workspace · ${statusLabel()}`;
        const metaLine = $('projectMetaLine');
        if (!metaLine) return;
        const projectNumber = $('poProjectNumber')?.value || window.ProjectState?.projectInfo?.project_number || '--';
        const estimator = $('poEstimator')?.value || 'Unassigned';
        const completion = window.ProjectState?.projectMeta?.completion_percent ? `${String(window.ProjectState.projectMeta.completion_percent).replace('%', '')}% complete` : '0% complete';
        metaLine.innerHTML = `<span>${escapeHtml(completion)}</span><span>Due: ${escapeHtml(dueLabel())}</span><span>Estimator: ${escapeHtml(estimator || 'Unassigned')}</span><span>Project #: ${escapeHtml(projectNumber || '--')}</span>`;
    }

    function renderStatusStepper() {
        const stepper = $('projectStatusStepper');
        if (!stepper) return;
        const currentIndex = PROJECT_STATUSES.findIndex(label => STATUS_VALUES[label] === normalizeStatus(currentStatus));
        stepper.innerHTML = PROJECT_STATUSES.map((label, index) => {
            const stateClass = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'next';
            return `<span class="project-step ${stateClass}">${escapeHtml(label)}</span>`;
        }).join('');
    }

    function toggleMenu(id) {
        document.querySelectorAll('.project-menu').forEach(menu => {
            if (menu.id !== id) menu.classList.remove('open');
        });
        $(id)?.classList.toggle('open');
    }

    function showCustomerFields() {
        $('customerEmpty')?.setAttribute('hidden', 'hidden');
        $('customerFields')?.removeAttribute('hidden');
        markDirty();
    }

    function addNote() {
        const content = prompt('Add note');
        if (!content) return;
        notes.push({
            user: $('poEstimator')?.value || 'Juan Estevez',
            timestamp: new Date().toLocaleString(),
            content
        });
        markDirty();
        showToast('Note added locally. Press Save Project to persist it.');
    }

    function createTask() {
        const title = prompt('Task title');
        if (!title) return;
        tasks.push({
            title,
            responsible: $('poEstimator')?.value || 'Juan Estevez',
            due_date: '',
            status: 'open'
        });
        markDirty();
        showToast('Task added locally. Press Save Project to persist it.');
    }

    function showToast(message) {
        const old = document.querySelector('.toast-lite');
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.className = 'toast-lite';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3200);
    }

    function documentsStorageKey() {
        const id = Number(window.ProjectState?.projectId || 0);
        return `takeoff.projectDocuments.${id || 'draft'}`;
    }

    function migrateDraftDocuments(projectId) {
        const draftKey = 'takeoff.projectDocuments.draft';
        const projectKey = `takeoff.projectDocuments.${projectId}`;
        const draftDocs = localStorage.getItem(draftKey);
        if (!draftDocs) return;
        localStorage.setItem(projectKey, draftDocs);
        localStorage.removeItem(draftKey);
    }

    function loadLocalDocuments() {
        try {
            const rows = JSON.parse(localStorage.getItem(documentsStorageKey()) || '[]');
            return Array.isArray(rows) ? rows : [];
        } catch (e) {
            return [];
        }
    }

    function persistLocalDocuments() {
        localStorage.setItem(documentsStorageKey(), JSON.stringify(localDocuments));
    }

    function inferCategory(file, forcedCategory = null) {
        if (forcedCategory) return forcedCategory;
        const ext = String(file.name.split('.').pop() || '').toLowerCase();
        return ['pdf', 'dwg', 'dxf'].includes(ext) ? 'Drawings' : 'Attachments';
    }

    function formatBytes(bytes) {
        const value = Number(bytes || 0);
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${(value / 1024 / 1024).toFixed(1)} MB`;
    }

    function addFiles(files, category = null) {
        const incoming = Array.from(files || []);
        if (!incoming.length) return;
        const now = new Date().toLocaleString();
        incoming.forEach(file => {
            const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            sessionFiles.set(id, file);
            localDocuments.push({
                id,
                name: file.name,
                category: inferCategory(file, category),
                size: file.size,
                uploadedAt: now,
                uploadedBy: $('poEstimator')?.value || 'Juan Estevez',
                type: file.type || '',
                source: 'local'
            });
        });
        persistLocalDocuments();
        renderLocalDocuments();
        showToast(`${incoming.length} file${incoming.length === 1 ? '' : 's'} added locally.`);
    }

    function existingDocumentRows() {
        return (window.ProjectState?.documents || []).map(doc => ({
            id: `existing-${doc.source}-${doc.id}`,
            name: doc.filename || doc.title || 'Document',
            category: inferCategory({ name: doc.filename || '' }, null),
            size: '',
            uploadedAt: doc.uploaded_at || '',
            uploadedBy: 'System',
            path: doc.path || '',
            source: 'existing'
        }));
    }

    function renderLocalDocuments() {
        const body = $('documentsLocalBody');
        const empty = $('documentsEmptyState');
        const table = $('documentsTableWrap');
        if (!body || !empty || !table) return;
        const allDocuments = [...existingDocumentRows(), ...localDocuments];
        empty.hidden = allDocuments.length > 0;
        table.hidden = allDocuments.length === 0;
        body.innerHTML = allDocuments.map(doc => `
            <tr>
                <td><strong>${escapeHtml(doc.name)}</strong></td>
                <td><span class="doc-category-pill">${escapeHtml(doc.category)}</span></td>
                <td>${doc.size === '' ? '-' : formatBytes(doc.size)}</td>
                <td>${escapeHtml(doc.uploadedAt)}</td>
                <td>${escapeHtml(doc.uploadedBy)}</td>
                <td>
                    <div class="doc-row-actions">
                        <button type="button" data-doc-action="view" data-doc-id="${escapeHtml(doc.id)}">View</button>
                        <button type="button" data-doc-action="download" data-doc-id="${escapeHtml(doc.id)}">Download</button>
                        <button type="button" data-doc-action="delete" data-doc-id="${escapeHtml(doc.id)}">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');

        body.querySelectorAll('[data-doc-action]').forEach(button => {
            button.addEventListener('click', () => handleDocumentAction(button.dataset.docAction, button.dataset.docId));
        });
    }

    function handleDocumentAction(action, id) {
        const doc = [...existingDocumentRows(), ...localDocuments].find(row => row.id === id);
        if (!doc) return;
        if (doc.source === 'existing') {
            if ((action === 'view' || action === 'download') && doc.path) {
                const link = document.createElement('a');
                link.href = doc.path;
                if (action === 'download') link.download = doc.name;
                link.target = '_blank';
                link.click();
                return;
            }
            showToast('This document action is ready for the backend document API.');
            return;
        }
        if (action === 'delete') {
            localDocuments = localDocuments.filter(row => row.id !== id);
            sessionFiles.delete(id);
            persistLocalDocuments();
            renderLocalDocuments();
            return;
        }
        if (action === 'view' || action === 'download') {
            const file = sessionFiles.get(id);
            if (!file) {
                showToast('This local file metadata is stored. Re-select the file to view or download before backend storage is connected.');
                return;
            }
            const url = URL.createObjectURL(file);
            const link = document.createElement('a');
            link.href = url;
            if (action === 'download') link.download = doc.name;
            link.target = '_blank';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[ch]));
    }

    function openDocumentPicker(category = null) {
        uploadCategory = category;
        $('documentsBrowseInput')?.click();
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderStatusDropdown();
        renderLocalDocuments();

        document.querySelectorAll('[data-menu-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                toggleMenu(button.dataset.menuToggle);
            });
        });
        document.addEventListener('click', () => {
            document.querySelectorAll('.project-menu').forEach(menu => menu.classList.remove('open'));
            $('projectStatusMenu')?.classList.remove('open');
        });

        $('projectStatusButton')?.addEventListener('click', event => {
            event.stopPropagation();
            $('projectStatusMenu')?.classList.toggle('open');
        });

        $('saveProjectBtn')?.addEventListener('click', saveProject);
        $('addCustomerBtn')?.addEventListener('click', showCustomerFields);
        $('addProjectAddressBtn')?.addEventListener('click', showCustomerFields);
        $('addNoteBtn')?.addEventListener('click', addNote);
        $('createTaskBtn')?.addEventListener('click', createTask);

        document.querySelectorAll('[data-upload-category]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                document.querySelectorAll('.project-menu').forEach(menu => menu.classList.remove('open'));
                if (typeof window.setActiveTab === 'function') window.setActiveTab('documents');
                openDocumentPicker(button.dataset.uploadCategory);
            });
        });

        $('browseDocumentsBtn')?.addEventListener('click', () => openDocumentPicker(null));
        $('documentsSidebarUploadBtn')?.addEventListener('click', () => openDocumentPicker(null));
        $('documentsBrowseInput')?.addEventListener('change', function () {
            addFiles(this.files, uploadCategory);
            this.value = '';
            uploadCategory = null;
        });

        const dropzone = $('documentsDropzone');
        if (dropzone) {
            ['dragenter', 'dragover'].forEach(eventName => {
                dropzone.addEventListener(eventName, event => {
                    event.preventDefault();
                    dropzone.classList.add('is-dragover');
                });
            });
            ['dragleave', 'drop'].forEach(eventName => {
                dropzone.addEventListener(eventName, event => {
                    event.preventDefault();
                    dropzone.classList.remove('is-dragover');
                });
            });
            dropzone.addEventListener('drop', event => addFiles(event.dataTransfer?.files, null));
        }

        document.querySelectorAll('.overview-field input, .overview-field select, .overview-field textarea').forEach(input => {
            input.addEventListener('input', markDirty);
            input.addEventListener('change', () => {
                markDirty();
                renderProjectHeaderMeta();
            });
        });

        window.addEventListener('beforeunload', event => {
            if (!isDirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
    });
})();
