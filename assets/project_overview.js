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
    let customFolders = loadDocumentFolders();
    let selectedDocumentsFolder = 'drawings';
    let selectedDocumentsId = null;
    let documentSortBy = 'custom';
    let documentSortDir = 'asc';
    let documentDensity = 'comfortable';
    const sessionFiles = new Map();
    const sessionFileUrls = new Map();
    let startTakeoffInFlight = false;

    const $ = (id) => document.getElementById(id);
    const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    function markDirty() {
        isDirty = true;
    }

    async function request(action, payload = {}) {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        });

        let data;
        try {
            data = await response.json();
        } catch (error) {
            throw new Error(response.ok
                ? 'The project server returned an invalid response.'
                : `Project request failed (${response.status}).`);
        }
        if (!response.ok || data?.status !== 'success') {
            throw new Error(data?.msg || `Project request failed (${response.status}).`);
        }
        return data;
    }

    function savedProjectId(result) {
        const value = result?.project_id ?? result?.id ?? result?.project?.id ?? result?.data?.project?.id;
        const id = Number(value);
        return Number.isSafeInteger(id) && id > 0 ? id : 0;
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

    async function saveProject() {
        const payload = collectProjectPayload();
        if (!payload.name.trim()) {
            showToast('Estimate Name is required.');
            return;
        }

        const saveButton = $('saveProjectBtn');
        const previousLabel = saveButton?.textContent;
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = 'Saving...';
        }

        try {
            const takeoffFrame = document.getElementById('takeoffFrame');
            const saveTakeoff = takeoffFrame?.contentWindow?.projectTakeoffSave;
            if (typeof saveTakeoff === 'function') {
                await saveTakeoff.call(takeoffFrame.contentWindow);
            }
            if (typeof window.projectEstimatingSave === 'function') {
                await window.projectEstimatingSave();
            }
            const wasDraft = Number(window.ProjectState?.projectId || 0) === 0;
            const result = await request('save', payload);
            const projectId = savedProjectId(result);
            if (!projectId) throw new Error('The project was saved without a valid project ID.');

            const uploadResult = await persistPendingDocuments(projectId);

            isDirty = false;
            localStorage.removeItem('takeoff.projectDraft');
            showToast(uploadResult.failed
                ? `Project saved. ${uploadResult.failed} document${uploadResult.failed === 1 ? '' : 's'} still need to be re-selected.`
                : 'Project and documents saved.');
            if (wasDraft) {
                migrateDraftWorkspace(projectId);
                window.location.href = `project_dashboard.php?id=${encodeURIComponent(projectId)}&tab=overview`;
                return;
            }

            window.ProjectState.projectId = projectId;
            window.ProjectState.projectInfo = result.project || result.data?.project || window.ProjectState.projectInfo;
            if ($('projectHeaderName')) $('projectHeaderName').textContent = payload.name;
            renderProjectHeaderMeta();
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Project save failed.');
        } finally {
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = previousLabel || 'Save Project';
            }
        }
    }

    async function persistPendingDocuments(projectId) {
        const pending = localDocuments.filter(doc => sessionFiles.has(String(doc.id)));
        let failed = 0;
        for (const doc of pending) {
            const file = sessionFiles.get(String(doc.id));
            try {
                const form = new FormData();
                form.append('project_id', projectId);
                form.append('file', file, file.name);
                const response = await fetch('../api/project_document_takeoff.php', {
                    method: 'POST', body: form, headers: { Accept: 'application/json' }
                });
                const result = await response.json().catch(() => null);
                if (!response.ok || !result?.success || !result.file?.id) {
                    throw new Error(result?.message || `HTTP ${response.status}`);
                }
                const stored = {
                    id: Number(result.file.id), source: 'legacy_file', filename: result.file.filename,
                    title: result.file.filename, path: `../${result.file.filepath}`,
                    extension: doc.extension, mime_type: doc.type, uploaded_at: new Date().toISOString()
                };
                window.ProjectState.documents = (window.ProjectState.documents || [])
                    .filter(row => !(row.source === 'local_metadata' && String(row.id) === String(doc.id)));
                window.ProjectState.documents.push(stored);
                localDocuments = localDocuments.filter(row => String(row.id) !== String(doc.id));
                sessionFiles.delete(String(doc.id));
                const objectUrl = sessionFileUrls.get(String(doc.id));
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                sessionFileUrls.delete(String(doc.id));
            } catch (error) {
                failed += 1;
            }
        }
        persistLocalDocuments();
        return { uploaded: pending.length - failed, failed };
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
            })
            .catch(err => showToast(err.message));
    }

    function renderProjectHeaderMeta() {
        const subtitle = $('projectHeaderSubtitle');
        if (subtitle) subtitle.textContent = `Project Workspace - ${statusLabel()}`;
        const metaLine = $('projectMetaLine');
        if (!metaLine) return;
        const projectNumber = $('poProjectNumber')?.value || window.ProjectState?.projectInfo?.project_number || '--';
        const estimator = $('poEstimator')?.value || 'Unassigned';
        const completion = window.ProjectState?.projectMeta?.completion_percent ? `${String(window.ProjectState.projectMeta.completion_percent).replace('%', '')}% complete` : '0% complete';
        metaLine.innerHTML = `<span>${escapeHtml(completion)}</span><span>Due: ${escapeHtml(dueLabel())}</span><span>Estimator: ${escapeHtml(estimator || 'Unassigned')}</span><span>Project #: ${escapeHtml(projectNumber || '--')}</span>`;
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

    function documentsFolderStorageKey() {
        const id = Number(window.ProjectState?.projectId || 0);
        return `takeoff.projectDocumentFolders.${id || 'draft'}`;
    }

    function migrateDraftWorkspace(projectId) {
        const numericProjectId = Number(projectId || 0);
        if (numericProjectId < 1) return;
        const prefixes = [
            'takeoff.projectDocuments',
            'takeoff.projectDocumentFolders',
            'takeoff.quantification',
            'takeoff.estimating.columns',
            'takeoff.proposal.settings',
            'takeoff.proposal.banner'
        ];
        prefixes.forEach(prefix => {
            const draftKey = `${prefix}.draft`;
            const value = localStorage.getItem(draftKey);
            if (value === null) return;
            localStorage.setItem(`${prefix}.${numericProjectId}`, value);
            localStorage.removeItem(draftKey);
        });

        const estimatingDraftKey = 'takeoff.estimating.module.draft';
        const rawEstimate = localStorage.getItem(estimatingDraftKey);
        if (rawEstimate !== null) {
            try {
                const workspace = JSON.parse(rawEstimate);
                const migratedAt = new Date().toISOString();
                workspace.projectId = numericProjectId;
                workspace.pendingProjectCreationSync = true;
                workspace.estimates = (workspace.estimates || []).map(estimate => {
                    const migrated = { ...estimate, projectId: numericProjectId, revision: 0, updatedAt: migratedAt };
                    delete migrated.dbEstimateId;
                    delete migrated.estimateItemId;
                    return migrated;
                });
                const migratedIds = new Set(workspace.estimates.map(estimate => String(estimate.id)));
                if (!migratedIds.has(String(workspace.activeEstimateId || ''))) {
                    workspace.activeEstimateId = workspace.estimates[0]?.id || null;
                }
                workspace.clientUiUpdatedAt = migratedAt;
                localStorage.setItem(`takeoff.estimating.module.${numericProjectId}`, JSON.stringify(workspace));
            } catch (error) {
                // Preserve even an older snapshot shape; migrateState will
                // normalize it after the redirect.
                localStorage.setItem(`takeoff.estimating.module.${numericProjectId}`, rawEstimate);
            }
            localStorage.removeItem(estimatingDraftKey);
        }
    }

    function loadLocalDocuments() {
        try {
            const stored = JSON.parse(localStorage.getItem(documentsStorageKey()) || '[]');
            const rows = Array.isArray(stored) ? stored : Array.isArray(stored.documents) ? stored.documents : [];
            return rows.map(normalizeStoredDocument).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    function loadDocumentFolders() {
        try {
            const rows = JSON.parse(localStorage.getItem(documentsFolderStorageKey()) || '[]');
            return Array.isArray(rows) ? rows : [];
        } catch (e) {
            return [];
        }
    }

    function persistLocalDocuments() {
        localStorage.setItem(documentsStorageKey(), JSON.stringify(localDocuments));
    }

    function persistDocumentFolders() {
        localStorage.setItem(documentsFolderStorageKey(), JSON.stringify(customFolders));
    }

    function normalizeStoredDocument(doc) {
        if (!doc || !doc.id) return null;
        const name = doc.name || doc.filename || 'Document';
        const category = doc.category || inferCategory({ name }, null);
        return {
            id: String(doc.id),
            name,
            filename: name,
            category,
            folderId: doc.folderId || '',
            size: Number(doc.size || 0),
            uploadedAt: doc.uploadedAt || '',
            uploadedBy: doc.uploadedBy || $('poEstimator')?.value || 'Juan Estevez',
            type: doc.type || '',
            extension: String(doc.extension || name.split('.').pop() || '').toLowerCase(),
            source: 'local',
            path: '',
            pageCount: Number(doc.pageCount || 0) || null,
            pages: Array.isArray(doc.pages) ? doc.pages : [],
            order: Number(doc.order || 0)
        };
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
        incoming.forEach((file, index) => {
            const id = String(Date.now() + index);
            const ext = String(file.name.split('.').pop() || '').toLowerCase();
            const inferredCategory = inferCategory(file, category);
            sessionFiles.set(id, file);
            sessionFileUrls.set(id, URL.createObjectURL(file));
            localDocuments.push({
                id,
                name: file.name,
                filename: file.name,
                category: inferredCategory,
                folderId: selectedDocumentsFolder.startsWith('custom:') ? selectedDocumentsFolder.replace('custom:', '') : '',
                size: file.size,
                uploadedAt: now,
                uploadedBy: $('poEstimator')?.value || 'Juan Estevez',
                type: file.type || '',
                extension: ext,
                source: 'local',
                pageCount: null,
                pages: [],
                order: Date.now()
            });
        });
        persistLocalDocuments();
        syncDocumentsToProjectState();
        renderDocumentsPage();
        showToast(`${incoming.length} file${incoming.length === 1 ? '' : 's'} added locally.`);
    }

    function existingDocumentRows() {
        return (window.ProjectState?.documents || []).map(doc => ({
            id: `existing-${doc.source}-${doc.id}`,
            backendId: doc.id,
            name: doc.source === 'project_document' ? (doc.title || doc.filename || 'Document') : (doc.filename || doc.title || 'Document'),
            filename: doc.filename || doc.title || 'Document',
            category: inferCategory({ name: doc.filename || doc.title || '' }, null),
            size: '',
            uploadedAt: doc.uploaded_at || '',
            uploadedBy: 'System',
            path: doc.path || '',
            source: 'existing',
            originalSource: doc.source || '',
            folderId: doc.folder_id ? String(doc.folder_id) : '',
            extension: doc.extension || String(doc.filename || '').split('.').pop().toLowerCase(),
            type: doc.mime_type || '',
            pageCount: Number(doc.page_count || 0) || null,
            pages: Array.isArray(doc.pages) ? doc.pages : [],
            order: Number(doc.id || 0)
        }));
    }

    function allDocumentRows() {
        return [...existingDocumentRows(), ...localDocuments.map(doc => ({ ...doc, path: sessionFileUrls.get(doc.id) || '' }))];
    }

    function syncDocumentsToProjectState() {
        if (!window.ProjectState) return;
        const backendRows = window.ProjectState.documents || [];
        const localRows = localDocuments.map(doc => ({
            id: doc.id,
            source: 'local_metadata',
            folder_id: doc.folderId || null,
            folder_name: doc.category,
            title: doc.name,
            filename: doc.name,
            path: sessionFileUrls.get(doc.id) || '',
            mime_type: doc.type || '',
            extension: doc.extension || '',
            uploaded_at: doc.uploadedAt || null,
            pageCount: doc.pageCount || null
        }));
        const backendOnly = backendRows.filter(doc => doc.source !== 'local_metadata');
        window.ProjectState.documents = [...backendOnly, ...localRows];
    }

    function drawingDocuments() {
        return allDocumentRows().filter(doc => doc.category === 'Drawings');
    }

    function attachmentDocuments() {
        return allDocumentRows().filter(doc => doc.category !== 'Drawings');
    }

    function categoryForSelectedFolder() {
        if (selectedDocumentsFolder === 'attachments') return 'Attachments';
        return 'Drawings';
    }

    function documentsForSelectedFolder() {
        const all = allDocumentRows();
        if (selectedDocumentsFolder === 'attachments') return all.filter(doc => doc.category !== 'Drawings');
        if (selectedDocumentsFolder.startsWith('custom:')) {
            const folderId = selectedDocumentsFolder.replace('custom:', '');
            return all.filter(doc => String(doc.folderId || '') === folderId);
        }
        if (selectedDocumentsFolder.startsWith('document:')) {
            const docId = selectedDocumentsFolder.replace('document:', '');
            const doc = all.find(row => row.id === docId);
            if (!doc) return [];
            return doc.pages.length ? doc.pages.map(page => ({ ...page, parentId: doc.id, category: 'Drawings', source: 'sheet' })) : [doc];
        }
        return all.filter(doc => doc.category === 'Drawings');
    }

    function folderCounts() {
        const drawings = drawingDocuments();
        const attachments = attachmentDocuments();
        return { drawings: drawings.length, attachments: attachments.length };
    }

    function renderDocumentsPage() {
        if (!$('documentsPage')) return;
        renderDocumentFolderTree();
        renderDocumentsContent();
    }

    function renderDocumentFolderTree() {
        const tree = $('documentsFolderTree');
        if (!tree) return;
        const counts = folderCounts();
        const drawings = drawingDocuments();
        const customRows = customFolders.map(folder => {
            const count = allDocumentRows().filter(doc => String(doc.folderId || '') === String(folder.id)).length;
            return `<button class="documents-folder-row ${selectedDocumentsFolder === `custom:${folder.id}` ? 'active' : ''}" type="button" data-doc-folder="custom:${escapeHtml(folder.id)}">
                <i class="fas fa-folder"></i><span>${escapeHtml(folder.name)}</span><strong>${count}</strong>
            </button>`;
        }).join('');

        tree.innerHTML = `
            <button class="documents-folder-row parent ${selectedDocumentsFolder === 'drawings' ? 'active' : ''}" type="button" data-doc-folder="drawings">
                <i class="fas fa-layer-group"></i><span>Drawings</span><strong>${counts.drawings}</strong>
            </button>
            <div class="documents-folder-children">
                ${drawings.map(doc => `
                    <button class="documents-folder-row child ${selectedDocumentsFolder === `document:${doc.id}` ? 'active' : ''}" type="button" data-doc-folder="document:${escapeHtml(doc.id)}">
                        <i class="fas ${doc.extension === 'pdf' ? 'fa-file-pdf' : 'fa-file'}"></i>
                        <span>${escapeHtml(doc.name)}</span>
                        <strong>${doc.pageCount || doc.pages.length || '-'}</strong>
                    </button>
                `).join('')}
            </div>
            <button class="documents-folder-row parent ${selectedDocumentsFolder === 'attachments' ? 'active' : ''}" type="button" data-doc-folder="attachments">
                <i class="fas fa-paperclip"></i><span>Attachments</span><strong>${counts.attachments}</strong>
            </button>
            ${customRows}
        `;

        tree.querySelectorAll('[data-doc-folder]').forEach(button => {
            button.addEventListener('click', () => {
                selectedDocumentsFolder = button.dataset.docFolder;
                renderDocumentsPage();
            });
        });
    }

    function renderDocumentsContent() {
        const list = $('documentsList');
        if (!list) return;
        const title = $('documentsContentTitle');
        const subtitle = $('documentsContentSubtitle');
        const docs = sortedDocuments(filteredDocuments(documentsForSelectedFolder()));
        const allCount = allDocumentRows().length;
        const isDrawings = selectedDocumentsFolder === 'drawings' || selectedDocumentsFolder.startsWith('document:');
        const isAttachments = selectedDocumentsFolder === 'attachments';

        if (title) title.textContent = selectedDocumentsFolder === 'attachments' ? 'Attachments' : selectedDocumentsFolder.startsWith('document:') ? selectedFolderDocumentName() : 'Custom Drawings';
        if (subtitle) subtitle.textContent = `${docs.length} item${docs.length === 1 ? '' : 's'} shown`;

        if (!allCount) {
            list.innerHTML = emptyDocumentsState('No documents uploaded yet', 'Upload drawings and attachments to start managing project files.', true);
            bindDocumentListActions(list);
            return;
        }
        if (!docs.length) {
            const message = isAttachments ? 'No attachments uploaded yet' : isDrawings ? 'No drawings uploaded yet' : 'No documents in this folder yet';
            list.innerHTML = emptyDocumentsState(message, 'Use Upload or drag and drop files here.', false);
            bindDocumentListActions(list);
            return;
        }

        list.className = `documents-list density-${documentDensity}`;
        list.innerHTML = docs.map(doc => renderDocumentRow(doc)).join('');
        bindDocumentListActions(list);
    }

    function selectedFolderDocumentName() {
        const docId = selectedDocumentsFolder.replace('document:', '');
        return allDocumentRows().find(doc => doc.id === docId)?.name || 'Drawing package';
    }

    function filteredDocuments(rows) {
        const query = String($('documentsSearch')?.value || '').trim().toLowerCase();
        if (!query) return rows;
        return rows.filter(doc => `${doc.name || ''} ${doc.filename || ''} ${doc.extension || ''}`.toLowerCase().includes(query));
    }

    function sortedDocuments(rows) {
        const copy = [...rows];
        const direction = documentSortDir === 'desc' ? -1 : 1;
        if (documentSortBy === 'custom') return copy.sort((a, b) => ((a.order || 0) - (b.order || 0)) * direction);
        return copy.sort((a, b) => {
            const av = documentSortBy === 'pageCount' ? (a.pageCount || 0) : documentSortBy === 'type' ? (a.extension || '') : documentSortBy === 'uploadedAt' ? (a.uploadedAt || '') : (a.name || '');
            const bv = documentSortBy === 'pageCount' ? (b.pageCount || 0) : documentSortBy === 'type' ? (b.extension || '') : documentSortBy === 'uploadedAt' ? (b.uploadedAt || '') : (b.name || '');
            return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * direction;
        });
    }

    function emptyDocumentsState(title, subtitle, showButtons) {
        return `<div class="documents-empty-state">
            <i class="fas fa-folder-open"></i>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(subtitle)}</span>
            ${showButtons ? '<div><button class="btn-main" type="button" data-doc-upload="Drawings"><i class="fas fa-file-pdf"></i> Upload Drawings</button><button class="btn-ghost" type="button" data-doc-upload="Attachments"><i class="fas fa-paperclip"></i> Upload Attachments</button></div>' : ''}
        </div>`;
    }

    function renderDocumentRow(doc) {
        const isSheet = doc.source === 'sheet';
        const meta = isSheet
            ? `Sheet ${escapeHtml(doc.pageNumber || '')}`
            : `${escapeHtml(doc.category || 'Document')} · ${doc.pageCount ? `${doc.pageCount} pages · ` : ''}${doc.size ? `${formatBytes(doc.size)} · ` : ''}${escapeHtml(doc.uploadedAt || 'Not uploaded')}`;
        return `<div class="documents-row ${selectedDocumentsId === doc.id ? 'active' : ''}" data-doc-id="${escapeHtml(doc.id)}">
            <button class="documents-row-main" type="button" data-doc-action="select" data-doc-id="${escapeHtml(doc.id)}">
                <i class="fas ${doc.category === 'Drawings' ? (doc.extension === 'pdf' ? 'fa-file-pdf' : 'fa-drafting-compass') : 'fa-paperclip'}"></i>
                <span><strong>${escapeHtml(doc.name || doc.title || 'Document')}</strong><small>${meta}</small></span>
            </button>
            <div class="documents-row-actions">
                <button class="documents-icon-btn" type="button" data-doc-action="view" data-doc-id="${escapeHtml(doc.id)}" title="View"><i class="fas fa-eye"></i></button>
                <button class="documents-icon-btn" type="button" data-doc-action="menu" data-doc-id="${escapeHtml(doc.id)}" title="Options"><i class="fas fa-ellipsis-vertical"></i></button>
                <div class="documents-menu row-menu" data-doc-menu="${escapeHtml(doc.id)}">
                    <button type="button" data-doc-action="view" data-doc-id="${escapeHtml(doc.id)}">View</button>
                    <button type="button" data-doc-action="rename" data-doc-id="${escapeHtml(doc.id)}">Rename</button>
                    <button type="button" data-doc-action="move" data-doc-id="${escapeHtml(doc.id)}">Move</button>
                    <button type="button" data-doc-action="download" data-doc-id="${escapeHtml(doc.id)}">Download</button>
                    <button type="button" data-doc-action="delete" data-doc-id="${escapeHtml(doc.id)}">Delete</button>
                </div>
            </div>
        </div>`;
    }

    function bindDocumentListActions(root) {
        if (root.dataset.documentActionsBound === '1') return;
        root.dataset.documentActionsBound = '1';
        root.addEventListener('click', event => {
            const upload = event.target.closest('[data-doc-upload]');
            if (upload) return openDocumentPicker(upload.dataset.docUpload);
            const button = event.target.closest('[data-doc-action]');
            if (!button) return;
            event.stopPropagation();
            handleDocumentAction(button.dataset.docAction, button.dataset.docId, button);
        });
    }

    function findDocumentById(id) {
        return allDocumentRows().find(row => row.id === id);
    }

    async function handleDocumentAction(action, id, trigger = null) {
        if (action === 'menu') {
            document.querySelectorAll('.documents-menu.row-menu').forEach(menu => {
                menu.classList.toggle('open', menu.dataset.docMenu === id && !menu.classList.contains('open'));
            });
            const menu = [...document.querySelectorAll('.documents-menu.row-menu')]
                .find(candidate => candidate.dataset.docMenu === String(id));
            if (menu?.classList.contains('open') && trigger) positionFloatingMenu(menu, trigger);
            return;
        }
        const doc = findDocumentById(id);
        if (!doc) return;
        document.querySelectorAll('.documents-menu.row-menu').forEach(menu => menu.classList.remove('open'));
        if (action === 'select') {
            selectedDocumentsId = doc.id;
            if (doc.category === 'Drawings') {
                window.ProjectState.selectedDocumentId = doc.backendId || doc.id;
                window.ProjectState.selectedDrawingId = doc.backendId || doc.id;
            }
            renderDocumentsContent();
            return;
        }
        if (doc.source === 'existing') {
            if ((action === 'view' || action === 'download') && doc.path) {
                const link = document.createElement('a');
                link.href = doc.path;
                if (action === 'download') link.download = doc.name;
                link.target = '_blank';
                link.click();
                return;
            }
            const projectId = Number(window.ProjectState?.projectId || 0);
            let payload = { project_id: projectId, id: doc.backendId, source: doc.originalSource, operation: action };
            if (action === 'delete') {
                if (!confirm(`Delete "${doc.name}"? This removes it from the project.`)) return;
            } else if (action === 'rename') {
                const name = prompt('Rename document', doc.name);
                if (!name || name === doc.name) return;
                payload.name = name;
            } else if (action === 'move') {
                const folder = prompt('Move to folder ID (leave blank for no folder)', doc.folderId || '');
                if (folder === null) return;
                if (folder.trim() && !/^\d+$/.test(folder.trim())) return showToast('Folder ID must be numeric.');
                payload.folder_id = folder.trim() ? Number(folder) : null;
            } else return;
            if (trigger) trigger.disabled = true;
            try {
                await request('document_action', payload);
                if (action === 'delete') {
                    window.ProjectState.documents = (window.ProjectState.documents || []).filter(row => !(String(row.id) === String(doc.backendId) && row.source === doc.originalSource));
                    if (selectedDocumentsId === id) selectedDocumentsId = null;
                } else {
                    window.ProjectState.documents = (window.ProjectState.documents || []).map(row => {
                        if (String(row.id) !== String(doc.backendId) || row.source !== doc.originalSource) return row;
                        if (action === 'rename') return { ...row, title: payload.name, filename: payload.name };
                        return { ...row, folder_id: payload.folder_id };
                    });
                }
                renderDocumentsPage();
                window.projectTakeoffRefreshDrawings?.();
                showToast(action === 'delete' ? 'Document deleted.' : action === 'rename' ? 'Document renamed.' : 'Document moved.');
            } catch (error) {
                showToast(error.message || 'Document action failed.');
                if (trigger?.isConnected) trigger.disabled = false;
            }
            return;
        }
        if (action === 'rename') {
            const nextName = prompt('Rename document', doc.name);
            if (!nextName || nextName === doc.name) return;
            localDocuments = localDocuments.map(row => row.id === id ? { ...row, name: nextName, filename: nextName, extension: String(nextName.split('.').pop() || row.extension || '').toLowerCase() } : row);
            persistLocalDocuments();
            renderDocumentsPage();
            return;
        }
        if (action === 'move') {
            const next = prompt('Move to folder/category: Drawings, Attachments, or custom folder name', doc.category);
            if (!next) return;
            const normalized = next.toLowerCase().startsWith('attach') ? 'Attachments' : 'Drawings';
            localDocuments = localDocuments.map(row => row.id === id ? { ...row, category: normalized } : row);
            persistLocalDocuments();
            renderDocumentsPage();
            return;
        }
        if (action === 'delete' && confirm('Delete this local document metadata?')) {
            localDocuments = localDocuments.filter(row => row.id !== id);
            sessionFiles.delete(id);
            persistLocalDocuments();
            renderDocumentsPage();
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

    function positionFloatingMenu(menu, trigger) {
        const rect = trigger.getBoundingClientRect();
        const width = Math.max(180, menu.offsetWidth || 180);
        const height = Math.max(190, menu.offsetHeight || 190);
        const margin = 8;
        menu.style.left = `${Math.max(margin, Math.min(window.innerWidth - width - margin, rect.right - width))}px`;
        menu.style.right = 'auto';
        menu.style.top = `${rect.bottom + height + margin <= window.innerHeight ? rect.bottom + 4 : Math.max(margin, rect.top - height - 4)}px`;
    }

    function createDocumentFolder() {
        const name = prompt('Folder name');
        if (!name) return;
        customFolders.push({ id: `folder-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, order: Date.now() });
        persistDocumentFolders();
        renderDocumentsPage();
    }

    function renameDocumentFolder() {
        if (!selectedDocumentsFolder.startsWith('custom:')) {
            showToast('Select a custom folder first.');
            return;
        }
        const id = selectedDocumentsFolder.replace('custom:', '');
        const folder = customFolders.find(row => row.id === id);
        if (!folder) return;
        const name = prompt('Rename folder', folder.name);
        if (!name || name === folder.name) return;
        folder.name = name;
        persistDocumentFolders();
        renderDocumentsPage();
    }

    function deleteDocumentFolder() {
        if (!selectedDocumentsFolder.startsWith('custom:')) {
            showToast('Base folders cannot be deleted.');
            return;
        }
        const id = selectedDocumentsFolder.replace('custom:', '');
        const hasDocs = allDocumentRows().some(doc => String(doc.folderId || '') === id);
        if (hasDocs) {
            showToast('Folder must be empty before deleting it.');
            return;
        }
        customFolders = customFolders.filter(row => row.id !== id);
        selectedDocumentsFolder = 'drawings';
        persistDocumentFolders();
        renderDocumentsPage();
    }

    function sortDocumentFolders() {
        customFolders.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
        persistDocumentFolders();
        renderDocumentsPage();
    }

    async function startDocumentsTakeoff() {
        if (startTakeoffInFlight) return;
        startTakeoffInFlight = true;
        const startButton = $('documentsStartTakeoffBtn');
        if (startButton) startButton.disabled = true;
        try {
        const drawings = drawingDocuments();
        if (!drawings.length) {
            showToast('Upload drawings before starting takeoff.');
            return;
        }
        const doc = findDocumentById(selectedDocumentsId) || drawings[0];
        selectedDocumentsId = doc.id;
        let takeoffFileId = doc.backendId || doc.id;
        if (doc.source === 'local') {
            const file = sessionFiles.get(String(doc.id));
            if (!file) {
                showToast('Select this PDF again so it can be uploaded for Takeoff.');
                return;
            }
            try {
                const form = new FormData();
                form.append('project_id', window.ProjectState?.projectId || '');
                form.append('file', file, file.name);
                const response = await fetch('../api/project_document_takeoff.php', { method: 'POST', body: form, headers: { Accept: 'application/json' } });
                const result = await response.json().catch(() => null);
                if (!response.ok || !result?.success || !result.file?.id) throw new Error(result?.message || `HTTP ${response.status}`);
                takeoffFileId = Number(result.file.id);
                const alias = { id: takeoffFileId, source: 'legacy_file', filename: result.file.filename, title: result.file.filename, path: `../${result.file.filepath}`, extension: doc.extension, mime_type: doc.type };
                window.ProjectState.documents = (window.ProjectState.documents || []).filter(row =>
                    !(row.source === 'local_metadata' && String(row.id) === String(doc.id)) &&
                    !(row.source === 'legacy_file' && Number(row.id) === takeoffFileId)
                );
                window.ProjectState.documents.push(alias);
                localDocuments = localDocuments.filter(row => String(row.id) !== String(doc.id));
                sessionFiles.delete(String(doc.id));
                const objectUrl = sessionFileUrls.get(String(doc.id));
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                sessionFileUrls.delete(String(doc.id));
                persistLocalDocuments();
            } catch (error) {
                showToast(error.message || 'Unable to upload this PDF for Takeoff.');
                return;
            }
        }
        if (doc.source === 'existing') {
            try {
                if (doc.originalSource === 'project_document') {
                    // project_document_takeoff.php creates or reuses the files-table identity required by editor.php.
                }
                const response = await fetch('../api/project_document_takeoff.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        document_id: doc.backendId,
                        project_id: window.ProjectState?.projectId,
                        source: doc.originalSource || 'legacy_file'
                    })
                });
                const result = await response.json().catch(() => null);
                if (!response.ok || !result?.success || !result.file?.id) throw new Error(result?.message || `HTTP ${response.status}`);
                takeoffFileId = Number(result.file.id);
                const sourceRow = window.ProjectState.documents.find(row => row.source === doc.originalSource && Number(row.id) === Number(doc.backendId));
                const alias = {
                    ...sourceRow,
                    id: takeoffFileId,
                    source: 'legacy_file',
                    filename: result.file.filename || sourceRow?.filename || doc.filename,
                    title: result.file.filename || sourceRow?.title || doc.name,
                    path: `../${result.file.filepath}`,
                    extension: doc.extension,
                    mime_type: doc.type
                };
                if (!window.ProjectState.documents.some(row => row.source === 'legacy_file' && Number(row.id) === takeoffFileId)) window.ProjectState.documents.push(alias);
            } catch (error) {
                showToast(error.message || 'Unable to prepare this PDF for Takeoff.');
                return;
            }
        }
        window.ProjectState.selectedDocumentId = takeoffFileId;
        window.ProjectState.selectedDrawingId = takeoffFileId;
        if (typeof window.setActiveTab === 'function') window.setActiveTab('takeoff');
        if (typeof window.projectTakeoffRefreshDrawings === 'function') window.projectTakeoffRefreshDrawings();
        const frame = $('takeoffFrame');
        const empty = $('takeoffEmpty');
        if (frame) {
            frame.src = `editor.php?id=${encodeURIComponent(takeoffFileId)}&embedded=1`;
            frame.style.display = 'block';
        }
        if (empty) empty.style.display = 'none';
        } finally {
            startTakeoffInFlight = false;
            if (startButton) startButton.disabled = false;
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
        syncDocumentsToProjectState();
        renderDocumentsPage();

        document.querySelectorAll('[data-menu-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                toggleMenu(button.dataset.menuToggle);
            });
        });
        document.addEventListener('click', () => {
            document.querySelectorAll('.project-menu').forEach(menu => menu.classList.remove('open'));
            document.querySelectorAll('.documents-menu').forEach(menu => menu.classList.remove('open'));
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
        $('browseDrawingsBtn')?.addEventListener('click', () => openDocumentPicker('Drawings'));
        $('browseAttachmentsBtn')?.addEventListener('click', () => openDocumentPicker('Attachments'));
        $('documentsUploadBtn')?.addEventListener('click', () => openDocumentPicker(categoryForSelectedFolder()));
        $('documentsAutoRenameBtn')?.addEventListener('click', () => showToast('Auto-rename is ready to be connected.'));
        $('documentsStartTakeoffBtn')?.addEventListener('click', startDocumentsTakeoff);
        $('documentsSearch')?.addEventListener('input', renderDocumentsContent);
        $('documentsSortBy')?.addEventListener('change', event => {
            documentSortBy = event.target.value;
            renderDocumentsContent();
        });
        $('documentsSortDir')?.addEventListener('click', () => {
            documentSortDir = documentSortDir === 'asc' ? 'desc' : 'asc';
            $('documentsSortDir').querySelector('i').className = documentSortDir === 'asc' ? 'fas fa-arrow-down-a-z' : 'fas fa-arrow-up-z-a';
            renderDocumentsContent();
        });
        $('documentsZoom')?.addEventListener('input', event => {
            documentDensity = event.target.value === '0' ? 'compact' : event.target.value === '2' ? 'large' : 'comfortable';
            renderDocumentsContent();
        });
        document.querySelector('[data-doc-folder-menu-toggle]')?.addEventListener('click', event => {
            event.stopPropagation();
            $('documentsFolderMenu')?.classList.toggle('open');
        });
        document.querySelector('[data-doc-view-menu-toggle]')?.addEventListener('click', event => {
            event.stopPropagation();
            $('documentsViewMenu')?.classList.toggle('open');
        });
        document.querySelectorAll('[data-doc-folder-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.docFolderAction;
                if (action === 'create') createDocumentFolder();
                if (action === 'rename') renameDocumentFolder();
                if (action === 'delete') deleteDocumentFolder();
                if (action === 'sort') sortDocumentFolders();
                $('documentsFolderMenu')?.classList.remove('open');
            });
        });
        document.querySelectorAll('[data-doc-view-action]').forEach(button => {
            button.addEventListener('click', () => {
                documentDensity = button.dataset.docViewAction === 'compact' ? 'compact' : 'comfortable';
                $('documentsZoom').value = documentDensity === 'compact' ? '0' : '1';
                $('documentsViewMenu')?.classList.remove('open');
                renderDocumentsContent();
            });
        });
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

        const closeDocumentRowMenus = () => {
            document.querySelectorAll('.documents-menu.row-menu.open').forEach(menu => menu.classList.remove('open'));
        };
        window.addEventListener('scroll', closeDocumentRowMenus, true);
        window.addEventListener('resize', closeDocumentRowMenus);

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
