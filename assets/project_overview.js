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
        if (!isDirty) {
            isDirty = true;
            try {
                if (!window._historyDirtyGuarded) {
                    window._historyDirtyGuarded = true;
                    window.history.pushState({ takeoffDirtyGuard: true }, '', window.location.href);
                }
            } catch (e) { }
        }
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
            customer_address: $('poCustomerAddress')?.value || '',
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
            job_address: $('poProjectAddress')?.value || '',
            bid_due_at: bidDueAt,
            metadata_json: JSON.stringify(metadata)
        };
    }

    async function saveProject() {
        const payload = collectProjectPayload();
        if (!payload.name.trim()) {
            if (window.TakeoffAnnouncement) {
                window.TakeoffAnnouncement.warning({
                    title: 'Estimate Name Required',
                    badge: 'REQUIRED FIELD',
                    content: '<p>Please enter an <strong>Estimate Name</strong> before saving the project.</p>',
                    primaryText: 'Understood'
                });
            } else {
                showToast('Estimate Name is required.');
            }
            return;
        }

        const saveButton = $('saveProjectBtn');
        const previousLabel = saveButton?.textContent;
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = 'Saving...';
        }

        try {
            try {
                const takeoffFrame = document.getElementById('takeoffFrame');
                const saveTakeoff = takeoffFrame?.contentWindow?.projectTakeoffSave;
                if (typeof saveTakeoff === 'function') {
                    await saveTakeoff.call(takeoffFrame.contentWindow);
                }
            } catch (takeoffErr) {
                console.warn('Takeoff iframe save ignored or unavailable:', takeoffErr);
            }
            if (typeof window.projectTakeoffSaveState === 'function') {
                try {
                    window.projectTakeoffSaveState();
                } catch (stateErr) {
                    console.warn('Takeoff state save warning:', stateErr);
                }
            }
            if (typeof window.projectEstimatingSave === 'function') {
                try {
                    await window.projectEstimatingSave();
                } catch (estErr) {
                    console.warn('Estimating save error:', estErr);
                }
            }
            const wasDraft = Number(window.ProjectState?.projectId || 0) === 0;
            const result = await request('save', payload);
            const projectId = savedProjectId(result);
            if (!projectId) throw new Error('The project was saved without a valid project ID.');

            const uploadResult = await persistPendingDocuments(projectId);

            isDirty = false;
            window._historyDirtyGuarded = false;
            localStorage.removeItem('takeoff.projectDraft');

            if (window.TakeoffAnnouncement) {
                window.TakeoffAnnouncement.success({
                    title: 'Project Saved Successfully',
                    badge: 'PROJECT SAVED',
                    content: `<p>All changes to <strong>${escapeHtml(payload.name)}</strong> have been persisted.</p>` +
                        (uploadResult.failed ? `<div class="g-announcement-highlight-box" style="border-left-color: #f59e0b;"><strong>Note:</strong> ${uploadResult.failed} document(s) still need to be re-selected.</div>` : '') +
                        `<div class="g-announcement-highlight-box">
                                <strong>Stage:</strong> ${escapeHtml(statusLabel())}<br>
                                <strong>Due Date:</strong> ${escapeHtml(dueLabel())}<br>
                                <strong>Estimator:</strong> ${escapeHtml($('poEstimator')?.value || 'Isaac Diaz')}
                             </div>`,
                    primaryText: 'Continue'
                });
            }

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
            const errText = error instanceof Error ? error.message : 'Project save failed.';
            if (window.TakeoffAnnouncement) {
                window.TakeoffAnnouncement.error({
                    title: 'Project Save Error',
                    badge: 'SYSTEM ERROR',
                    content: `<p>An unexpected error occurred while saving the project:</p><div class="g-announcement-highlight-box" style="border-left-color: #ef4444; color: #ef4444;"><strong>${escapeHtml(errText)}</strong></div><p>Please verify all required fields or check your database connection and try again.</p>`,
                    primaryText: 'Dismiss'
                });
            }
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

    const defaultPhaseConfig = {
        'Invitations': { label: 'Invitations', color: '#b45309' },
        'To Do': { label: 'To Do', color: '#1d5cc9' },
        'Estimating': { label: 'Estimating', color: '#d97706' },
        'Bid Submitted': { label: 'Bid Submitted', color: '#ea580c' },
        'Accepted': { label: 'Accepted', color: '#059669' },
        'In Progress': { label: 'In Progress', color: '#2563eb' },
        'Complete': { label: 'Complete', color: '#10b981' },
        'Estimadores': { label: 'Estimadores', color: '#7c3aed' },
        'Lost': { label: 'Lost', color: '#dc2626' },
        'Archived': { label: 'Archived', color: '#64748b' }
    };

    function getPhase(key) {
        try {
            const raw = localStorage.getItem('takeoff.pipelineConfig');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed[key]) return parsed[key];
            }
        } catch (e) { }
        return defaultPhaseConfig[key] || { label: key, color: '#1d5cc9' };
    }

    function hexToRgba(hex, alpha = 0.14) {
        if (!hex || typeof hex !== 'string') return `rgba(29, 92, 201, ${alpha})`;
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        if (isNaN(num)) return `rgba(29, 92, 201, ${alpha})`;
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function getDarkerShade(hex) {
        if (!hex || typeof hex !== 'string') return '#1d5cc9';
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        if (isNaN(num)) return '#1e293b';
        const r = Math.max(0, Math.min(255, Math.round(((num >> 16) & 255) * 0.72)));
        const g = Math.max(0, Math.min(255, Math.round(((num >> 8) & 255) * 0.72)));
        const b = Math.max(0, Math.min(255, Math.round((num & 255) * 0.72)));
        return `rgb(${r}, ${g}, ${b})`;
    }

    function renderStatusDropdown() {
        const button = $('projectStatusButton');
        const label = $('projectStatusLabel');
        const menu = $('projectStatusMenu');
        if (!button || !label || !menu) return;

        const activeLabel = statusLabel();
        const currentPhase = getPhase(activeLabel);
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body?.classList.contains('theme-dark');
        const bgAlpha = isDark ? 0.26 : 0.12;
        const borderAlpha = isDark ? 0.52 : 0.35;
        const bgPale = hexToRgba(currentPhase.color, bgAlpha);
        const borderPale = hexToRgba(currentPhase.color, borderAlpha);
        const textPale = isDark ? '#ffffff' : getDarkerShade(currentPhase.color);

        button.className = 'bb-status-pill-wrap';
        button.style.backgroundColor = bgPale;
        button.style.borderColor = borderPale;
        button.style.color = textPale;
        button.dataset.status = currentStatus;

        const dot = button.querySelector('.bb-status-dot');
        if (dot) dot.style.backgroundColor = currentPhase.color;
        label.textContent = currentPhase.label.toUpperCase();
        label.style.color = textPale;
        const caret = button.querySelector('.bb-status-pill-caret');
        if (caret) caret.style.color = textPale;

        renderProjectHeaderMeta();

        menu.innerHTML = `
            <div class="bb-status-menu-eyebrow">Change Stage</div>
            <div class="bb-status-menu-list">
                ${PROJECT_STATUSES.map(status => {
            const phase = getPhase(status);
            const isCurrent = status === activeLabel;
            const itemBg = hexToRgba(phase.color, bgAlpha);
            const itemBorder = hexToRgba(phase.color, borderAlpha);
            const itemText = isDark ? '#ffffff' : getDarkerShade(phase.color);
            return `
                        <button class="bb-status-menu-option ${isCurrent ? 'selected' : ''}" type="button" data-project-status="${STATUS_VALUES[status]}">
                            <span class="bb-status-option-pill" style="background-color: ${itemBg}; border: 1px solid ${itemBorder}; color: ${itemText};">
                                <span class="bb-status-dot-sm" style="background-color: ${phase.color};"></span>
                                <span class="bb-status-option-name" style="color: ${itemText};">${phase.label.toUpperCase()}</span>
                            </span>
                            ${isCurrent ? `<i class="fas fa-check bb-status-option-check" style="color: ${phase.color};"></i>` : ''}
                        </button>
                    `;
        }).join('')}
            </div>
        `;

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
        const target = $(id);
        if (target) {
            target.classList.toggle('open');
            const subhead = document.querySelector('.project-subhead-wrapper');
            if (subhead) {
                const anyOpen = !!document.querySelector('.project-menu.open, .bb-status-menu-panel.open');
                subhead.classList.toggle('has-open-menu', anyOpen);
            }
        }
    }

    let savedCustomers = [];

    async function loadCustomersDirectory() {
        const selector = $('poCustomerSelector');
        if (!selector) return;
        try {
            const res = await fetch('../api/customers.php?action=list');
            const data = await res.json();
            if (data?.status === 'success' && Array.isArray(data.data)) {
                savedCustomers = data.data;
                populateCustomerSelector();
            }
        } catch (e) {
            console.warn('Could not load customers directory:', e);
        }
    }

    function populateCustomerSelector(selectedCompany = null) {
        const selector = $('poCustomerSelector');
        if (!selector) return;
        const currentCompany = (selectedCompany || $('poCustomerCompany')?.value || '').trim().toLowerCase();
        selector.innerHTML = '<option value="">-- Choose a saved customer --</option>' +
            savedCustomers.map((c, i) => {
                const label = c.company + (c.contact_name ? ` (${c.contact_name})` : '');
                const isMatch = currentCompany && c.company.toLowerCase() === currentCompany;
                return `<option value="${i}" ${isMatch ? 'selected' : ''}>${escapeHtml(label)}</option>`;
            }).join('');
    }

    function selectCustomerByIndex(index) {
        const c = savedCustomers[index];
        if (!c) return;
        if ($('poCustomerCompany')) $('poCustomerCompany').value = c.company || '';
        if ($('poPrimaryContact')) $('poPrimaryContact').value = c.contact_name || '';
        if ($('poCustomerPhone')) $('poCustomerPhone').value = c.phone || '';
        if ($('poCustomerEmail')) $('poCustomerEmail').value = c.email || '';
        if ($('poCustomerAddress')) $('poCustomerAddress').value = c.address || '';
        syncCustomerDisplayCard();
        markDirty();
        renderProjectHeaderMeta();
        showToast(`Customer "${c.company}" selected.`);
    }

    function clearCustomerFields() {
        if ($('poCustomerCompany')) $('poCustomerCompany').value = '';
        if ($('poPrimaryContact')) $('poPrimaryContact').value = '';
        if ($('poCustomerPhone')) $('poCustomerPhone').value = '';
        if ($('poCustomerEmail')) $('poCustomerEmail').value = '';
        if ($('poCustomerAddress')) $('poCustomerAddress').value = '';
        if ($('poCustomerSelector')) $('poCustomerSelector').value = '';
        syncCustomerDisplayCard();
        markDirty();
        renderProjectHeaderMeta();
    }

    async function saveCurrentCustomerToDirectory() {
        const company = $('poCustomerCompany')?.value?.trim();
        if (!company) {
            showToast('Please enter a Customer Company name first.');
            $('poCustomerCompany')?.focus();
            return;
        }
        const payload = {
            company,
            contact_name: $('poPrimaryContact')?.value?.trim() || '',
            phone: $('poCustomerPhone')?.value?.trim() || '',
            email: $('poCustomerEmail')?.value?.trim() || '',
            address: $('poCustomerAddress')?.value?.trim() || ''
        };
        const saveBtn = $('saveCustomerBtn');
        if (saveBtn) saveBtn.disabled = true;
        try {
            const res = await fetch('../api/customers.php?action=save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data?.status === 'success') {
                if (Array.isArray(data.customers)) {
                    savedCustomers = data.customers;
                } else if (data.data) {
                    const existingIdx = savedCustomers.findIndex(c => c.company.toLowerCase() === company.toLowerCase());
                    if (existingIdx >= 0) savedCustomers[existingIdx] = data.data;
                    else savedCustomers.push(data.data);
                }
                populateCustomerSelector(company);
                showToast(`Customer "${company}" saved to directory!`);
            } else {
                showToast(data?.msg || 'Failed to save customer.');
            }
        } catch (e) {
            showToast('Error saving customer to directory.');
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    function syncCustomerDisplayCard() {
        const company = $('poCustomerCompany')?.value?.trim() || 'GP Construction';
        const contact = $('poPrimaryContact')?.value?.trim() || company;
        const phone = $('poCustomerPhone')?.value?.trim() || '3212002278';
        const email = $('poCustomerEmail')?.value?.trim() || 'Paul@gpconstructioncompany.com';
        const projectAddress = $('poProjectAddress')?.value?.trim() || '';

        const avatar = $('customerAvatarLetter');
        if (avatar) avatar.textContent = (company[0] || 'G').toUpperCase();
        const displayComp = $('displayCustomerCompany');
        if (displayComp) displayComp.textContent = company;
        const displayContactSummary = $('displayContactSummary');
        if (displayContactSummary) {
            const parts = [contact, phone, email].filter(Boolean);
            displayContactSummary.textContent = parts.join(', ');
        }

        const displayProjectAddressText = $('displayProjectAddressText');
        const editProjectAddressRow = $('editProjectAddressRow');
        const addProjectAddressBtn = $('addProjectAddressBtn');
        if (displayProjectAddressText) {
            displayProjectAddressText.textContent = projectAddress;
        }
        if (editProjectAddressRow && addProjectAddressBtn) {
            if (projectAddress) {
                editProjectAddressRow.style.display = 'flex';
                addProjectAddressBtn.style.display = 'none';
            } else {
                editProjectAddressRow.style.display = 'none';
                addProjectAddressBtn.style.display = 'flex';
            }
        }
    }

    function showCustomerFields() {
        const fields = $('customerFields');
        if (fields) {
            fields.style.display = 'grid';
            fields.removeAttribute('hidden');
        }
        markDirty();
    }

    let contextMenuTarget = null; // { type: 'note' | 'task', index: number }

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
            const author = note.user || 'Isaac De Jesús';
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

        list.querySelectorAll('[data-note-menu]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = Number(btn.dataset.noteMenu);
                openItemContextMenu(btn, 'note', idx);
            });
        });
    }

    function openNoteModal(index = -1) {
        const modal = $('pdNoteModal');
        const titleEl = $('noteModalTitle');
        const indexInput = $('modalNoteIndex');
        const contentInput = $('modalNoteContent');
        if (!modal) return;

        if (index >= 0 && index < notes.length) {
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-sticky-note" style="color: var(--primary);"></i> Edit Note';
            if (indexInput) indexInput.value = String(index);
            if (contentInput) contentInput.value = notes[index].content || '';
        } else {
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-sticky-note" style="color: var(--primary);"></i> Add Note';
            if (indexInput) indexInput.value = '-1';
            if (contentInput) contentInput.value = '';
        }

        modal.classList.add('open');
        setTimeout(() => contentInput?.focus(), 50);
    }

    function saveNoteFromModal() {
        const indexInput = $('modalNoteIndex');
        const contentInput = $('modalNoteContent');
        const content = contentInput?.value.trim();
        if (!content) return;

        const idx = Number(indexInput?.value ?? -1);
        if (idx >= 0 && idx < notes.length) {
            notes[idx].content = content;
            notes[idx].timestamp = 'just now';
        } else {
            notes.push({
                user: $('poEstimator')?.value || 'Isaac De Jesús',
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
                        <div class="pd-task-assignee">For ${escapeHtml(task.responsible || 'Isaac De Jesús')}</div>
                    </div>
                    ${dueText ? `<div class="pd-task-due-badge">${escapeHtml(dueText)}</div>` : ''}
                    <div class="pd-item-menu-wrap">
                        <button type="button" class="pd-row-dots-btn" data-task-menu="${idx}" title="Task options"><i class="fas fa-ellipsis-vertical"></i></button>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('[data-task-menu]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = Number(btn.dataset.taskMenu);
                openItemContextMenu(btn, 'task', idx);
            });
        });
    }

    function formatTaskDue(dateVal) {
        if (!dateVal) return '';
        try {
            const d = new Date(dateVal);
            if (isNaN(d.getTime())) return `Due ${dateVal}`;
            const diffHours = Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60));
            if (diffHours > 0 && diffHours < 48) {
                return `Due in about ${diffHours} hour${diffHours === 1 ? '' : 's'}`;
            }
            return `Due ${d.toLocaleDateString()}`;
        } catch (e) {
            return `Due ${dateVal}`;
        }
    }

    let systemUsers = [
        { id: 1, name: 'Isaac Diaz', role: 'Lead Estimator', initials: 'ID', avatarColor: '#5b4364' },
        { id: 2, name: 'Juan Estevez', role: 'Chief Estimator', initials: 'JE', avatarColor: '#1d5cc9' },
        { id: 3, name: 'Carlos Rodriguez', role: 'Project Manager', initials: 'CR', avatarColor: '#059669' },
        { id: 4, name: 'Ana Lopez', role: 'Estimating Coordinator', initials: 'AL', avatarColor: '#d97706' },
        { id: 5, name: 'Paul Construction', role: 'Client Representative', initials: 'PC', avatarColor: '#7c3aed' }
    ];

    async function loadSystemUsers() {
        try {
            const res = await fetch('../api/users.php?action=list');
            if (res.ok) {
                const data = await res.json();
                if (data?.status === 'success' && Array.isArray(data.data) && data.data.length) {
                    systemUsers = data.data;
                }
            }
        } catch (e) {
            // Keep default system users
        }
        populateAssigneeSelector();
    }

    function populateAssigneeSelector(selectedAssignee = null) {
        const select = $('modalTaskAssignee');
        if (!select) return;
        const current = (selectedAssignee || select.value || '').trim();

        select.innerHTML = '<option value="">-- Choose an Assignee --</option>' +
            systemUsers.map(u => {
                const isSel = (current && (current === u.name || current.toLowerCase() === u.name.toLowerCase())) ? 'selected' : '';
                return `<option value="${escapeHtml(u.name)}" ${isSel}>${escapeHtml(u.name)} (${escapeHtml(u.role || 'Member')})</option>`;
            }).join('');

        if (current && !systemUsers.some(u => u.name.toLowerCase() === current.toLowerCase())) {
            const opt = document.createElement('option');
            opt.value = current;
            opt.textContent = `${current} (Custom)`;
            opt.selected = true;
            select.appendChild(opt);
        }
    }

    function openTaskModal(index = -1) {
        const modal = $('pdTaskModal');
        const titleEl = $('taskModalTitle');
        const indexInput = $('modalTaskIndex');
        const taskTitleInput = $('modalTaskTitle');
        const assigneeInput = $('modalTaskAssignee');
        const dueInput = $('modalTaskDue');
        if (!modal) return;

        if (index >= 0 && index < tasks.length) {
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-tasks" style="color: var(--primary);"></i> Edit Task';
            if (indexInput) indexInput.value = String(index);
            if (taskTitleInput) taskTitleInput.value = tasks[index].title || '';
            const assignee = tasks[index].responsible || 'Isaac Diaz';
            populateAssigneeSelector(assignee);
            if (dueInput) dueInput.value = tasks[index].due_date || '';
        } else {
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-tasks" style="color: var(--primary);"></i> Create Task';
            if (indexInput) indexInput.value = '-1';
            if (taskTitleInput) taskTitleInput.value = '';
            const defaultAssignee = $('poEstimator')?.value || 'Isaac Diaz';
            populateAssigneeSelector(defaultAssignee);
            if (dueInput) dueInput.value = '';
        }

        modal.classList.add('open');
        setTimeout(() => taskTitleInput?.focus(), 50);
    }

    function saveTaskFromModal() {
        const indexInput = $('modalTaskIndex');
        const taskTitleInput = $('modalTaskTitle');
        const assigneeInput = $('modalTaskAssignee');
        const dueInput = $('modalTaskDue');

        const title = taskTitleInput?.value.trim();
        if (!title) return;
        const responsible = assigneeInput?.value.trim() || $('poEstimator')?.value || 'Isaac Diaz';
        const due = dueInput?.value || '';

        const idx = Number(indexInput?.value ?? -1);
        if (idx >= 0 && idx < tasks.length) {
            tasks[idx].title = title;
            tasks[idx].responsible = responsible;
            tasks[idx].due_date = due;
        } else {
            tasks.push({
                title,
                responsible,
                due_date: due,
                status: 'open'
            });
        }

        $('pdTaskModal')?.classList.remove('open');
        markDirty();
        renderTasks();
        showToast('Task saved locally. Press Save Project to persist it.');
    }

    function openItemContextMenu(button, type, index) {
        const menu = $('pdItemContextMenu');
        if (!menu) return;

        contextMenuTarget = { type, index };
        const rect = button.getBoundingClientRect();
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;

        menu.style.display = 'flex';
        menu.style.position = 'fixed';
        menu.style.zIndex = '99999';

        const menuWidth = 130;
        const leftPos = (rect.right / zoom) - menuWidth;
        const topPos = (rect.bottom / zoom) + 4;

        menu.style.left = `${Math.max(10, leftPos)}px`;
        menu.style.top = `${topPos}px`;
    }

    function closeItemContextMenu() {
        const menu = $('pdItemContextMenu');
        if (menu) menu.style.display = 'none';
        contextMenuTarget = null;
    }

    function showToast(message, type = 'success') {
        if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.show === 'function') {
            window.TakeoffAnnouncement.show({
                type: type === 'error' ? 'error' : (type === 'warning' ? 'warning' : 'success'),
                title: type === 'error' ? 'System Alert' : (type === 'warning' ? 'Notice' : 'Project Update'),
                badge: type === 'error' ? 'ERROR' : (type === 'warning' ? 'NOTICE' : 'ALERT'),
                message: message,
                primaryText: 'Continue',
                force: true,
                showDontShow: false
            });
            return;
        }
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

        // Immediately update status pill when theme changes (Light / Dark)
        const themeObserver = new MutationObserver(() => {
            renderStatusDropdown();
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-theme-toggle]')) {
                setTimeout(renderStatusDropdown, 50);
            }
        });

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
            $('pdPresenceMenu')?.classList.remove('open');
            document.querySelector('.project-subhead-wrapper')?.classList.remove('has-open-menu');
        });

        // Multi-User Presence System (supports up to 4 simultaneous avatars)
        const initialCollaborators = [
            { id: 1, name: 'Isaac Diaz (You)', initials: 'ID', color: '#5b4364', role: 'Lead Estimator', isSelf: true }
        ];

        window.ProjectPresence = {
            users: [...initialCollaborators],
            getUsers() { return this.users; },
            setUsers(newUsers) {
                this.users = Array.isArray(newUsers) ? newUsers : [];
                this.render();
            },
            addUser(user) {
                if (!this.users.some(u => u.id === user.id)) {
                    this.users.push(user);
                    this.render();
                }
            },
            removeUser(userId) {
                this.users = this.users.filter(u => u.id !== userId);
                this.render();
            },
            render() {
                const stack = $('pdPresenceStack');
                const list = $('pdPresenceList');
                const count = $('pdPresenceCount');
                if (!stack) return;

                const visible = this.users.slice(0, 4);
                const overflow = this.users.length - 4;

                let html = '';
                visible.forEach((u, i) => {
                    const z = 10 - i;
                    const tooltip = `${escapeHtml(u.name)} (${escapeHtml(u.role || 'Collaborator')})`;
                    html += `
                        <div class="pd-presence-avatar ${u.isSelf ? 'self' : ''}" style="background: ${u.color || '#5b4364'}; z-index: ${z};" title="${tooltip}">
                            <span>${escapeHtml(u.initials || u.name.slice(0, 2).toUpperCase())}</span>
                            <span class="pd-presence-dot" title="Active in project"></span>
                        </div>
                    `;
                });

                if (overflow > 0) {
                    html += `<div class="pd-presence-overflow" title="${overflow} more users active">+${overflow}</div>`;
                }

                stack.innerHTML = html;

                if (count) {
                    count.textContent = `${this.users.length} active`;
                }

                if (list) {
                    list.innerHTML = this.users.map(u => `
                        <div class="pd-presence-user-row">
                            <div class="pd-presence-avatar" style="background: ${u.color || '#5b4364'}; width: 24px; height: 24px; font-size: 9.5px; margin: 0;">
                                <span>${escapeHtml(u.initials || u.name.slice(0, 2).toUpperCase())}</span>
                            </div>
                            <div class="pd-presence-user-info">
                                <span class="pd-presence-user-name">${escapeHtml(u.name)}</span>
                                <span class="pd-presence-user-role">${escapeHtml(u.role || 'Collaborator')} • Active now</span>
                            </div>
                        </div>
                    `).join('');
                }
            }
        };

        window.ProjectPresence.render();

        $('pdPresenceStack')?.addEventListener('click', (e) => {
            e.stopPropagation();
            $('pdPresenceMenu')?.classList.toggle('open');
        });

        $('projectStatusButton')?.addEventListener('click', event => {
            event.stopPropagation();
            $('projectStatusMenu')?.classList.toggle('open');
        });

        function syncCustomerDisplayCard() {
            const company = $('poCustomerCompany')?.value?.trim() || 'GP Construction';
            const contact = $('poPrimaryContact')?.value?.trim() || 'GP Construction';
            const phone = $('poCustomerPhone')?.value?.trim() || '3212002278';
            const email = $('poCustomerEmail')?.value?.trim() || 'Paul@gpconstructioncompany.com';
            const address = $('poCustomerAddress')?.value?.trim() || '';
            const projAddress = $('poProjectAddress')?.value?.trim() || '';

            const avatar = $('customerAvatarLetter');
            if (avatar) avatar.textContent = company.charAt(0).toUpperCase() || 'G';

            const compEl = $('displayCustomerCompany');
            if (compEl) compEl.textContent = company;

            const summaryEl = $('displayContactSummary');
            if (summaryEl) summaryEl.textContent = `${contact}, ${phone}, ${email}`;

            const addrEl = $('displayContactAddress');
            if (addrEl) addrEl.textContent = address || 'No address set';

            const projText = $('displayProjectAddressText');
            const projRow = $('editProjectAddressRow');
            const addBtn = $('addProjectAddressBtn');
            if (projAddress) {
                if (projText) projText.textContent = projAddress;
                if (projRow) projRow.style.display = 'flex';
                if (addBtn) addBtn.style.display = 'none';
            } else {
                if (projRow) projRow.style.display = 'none';
                if (addBtn) addBtn.style.display = 'flex';
            }
        }

        function openCustomerModal() {
            $('pdCustomerModal')?.classList.add('open');
        }
        function closeCustomerModal() {
            $('pdCustomerModal')?.classList.remove('open');
            syncCustomerDisplayCard();
        }

        function openAddressModal() {
            $('pdAddressModal')?.classList.add('open');
            setTimeout(() => $('poProjectAddress')?.focus(), 50);
        }
        function closeAddressModal() {
            $('pdAddressModal')?.classList.remove('open');
            syncCustomerDisplayCard();
        }

        function updatePricingLockIcon() {
            const select = $('poEstimatePricing');
            const wrap = select?.closest('.pd-pricing-wrap');
            const icon = wrap?.querySelector('.pd-pricing-status-icon i');
            if (!select || !icon) return;
            const isLocked = select.value === 'Locked';
            icon.className = isLocked ? 'fas fa-lock' : 'fas fa-lock-open';
            icon.style.color = isLocked ? '#ef4444' : '#10b981';
        }

        $('saveProjectBtn')?.addEventListener('click', saveProject);
        $('addCustomerBtn')?.addEventListener('click', openCustomerModal);
        $('toggleCustomerDrawerBtn')?.addEventListener('click', openCustomerModal);
        $('editCustomerInfoBtn')?.addEventListener('click', openCustomerModal);
        $('addProjectAddressBtn')?.addEventListener('click', openAddressModal);
        $('editProjectAddressBtn')?.addEventListener('click', openAddressModal);
        $('editProjectAddressRow')?.addEventListener('click', openAddressModal);
        $('applyCustomerModalBtn')?.addEventListener('click', closeCustomerModal);
        $('applyAddressModalBtn')?.addEventListener('click', closeAddressModal);

        document.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.closeModal;
                $(modalId)?.classList.remove('open');
                syncCustomerDisplayCard();
            });
        });

        document.querySelectorAll('.pd-modal-backdrop').forEach(backdrop => {
            backdrop.addEventListener('click', e => {
                if (e.target === backdrop) {
                    backdrop.classList.remove('open');
                    syncCustomerDisplayCard();
                }
            });
        });

        $('poEstimatePricing')?.addEventListener('change', () => {
            updatePricingLockIcon();
            markDirty();
        });
        updatePricingLockIcon();

        function snapToTenMinutes(input) {
            if (!input || !input.value) return;
            const val = input.value;
            // Handle HH:MM (e.g. 14:23 -> 14:20)
            const parts = val.split(':');
            if (parts.length >= 2) {
                const h = parts[0];
                let m = parseInt(parts[1], 10);
                if (!isNaN(m)) {
                    m = Math.round(m / 10) * 10;
                    if (m >= 60) m = 50;
                    input.value = `${h.padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                }
            }
        }

        $('poDueTime')?.addEventListener('change', function () {
            snapToTenMinutes(this);
            markDirty();
        });
        $('poDueTime')?.addEventListener('blur', function () {
            snapToTenMinutes(this);
        });

        // Date and Time inputs are automatically handled globally by TakeoffDateTimePicker

        $('poClearEstimatorBtn')?.addEventListener('click', () => {
            const est = $('poEstimator');
            if (est) {
                est.value = '';
                markDirty();
                renderProjectHeaderMeta();
            }
        });
        ['poCustomerCompany', 'poPrimaryContact', 'poCustomerPhone', 'poCustomerEmail', 'poCustomerAddress', 'poProjectAddress'].forEach(id => {
            $(id)?.addEventListener('input', () => {
                syncCustomerDisplayCard();
                markDirty();
            });
        });
        $('poCustomerSelector')?.addEventListener('change', event => {
            const idx = event.target.value;
            if (idx !== '') selectCustomerByIndex(Number(idx));
        });
        $('saveCustomerBtn')?.addEventListener('click', saveCurrentCustomerToDirectory);
        $('clearCustomerBtn')?.addEventListener('click', clearCustomerFields);
        loadCustomersDirectory();
        $('addNoteBtn')?.addEventListener('click', () => openNoteModal(-1));
        $('addNoteBtnHead')?.addEventListener('click', () => openNoteModal(-1));
        $('modalSaveNoteBtn')?.addEventListener('click', saveNoteFromModal);
        $('createTaskBtn')?.addEventListener('click', () => openTaskModal(-1));
        $('createTaskBtnHead')?.addEventListener('click', () => openTaskModal(-1));
        $('modalSaveTaskBtn')?.addEventListener('click', saveTaskFromModal);

        $('pdItemActionEdit')?.addEventListener('click', () => {
            if (!contextMenuTarget) return;
            const { type, index } = contextMenuTarget;
            closeItemContextMenu();
            if (type === 'note') openNoteModal(index);
            else if (type === 'task') openTaskModal(index);
        });

        $('pdItemActionDelete')?.addEventListener('click', () => {
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
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#pdItemContextMenu') && !e.target.closest('.pd-item-menu-wrap')) {
                closeItemContextMenu();
            }
        });

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

        renderNotes();
        renderTasks();
        loadSystemUsers();

        window.TakeoffUsers = {
            getUsers: () => systemUsers,
            setUsers: (list) => {
                systemUsers = Array.isArray(list) ? list : systemUsers;
                populateAssigneeSelector();
            },
            load: loadSystemUsers
        };

        // In-app navigation interceptor for unsaved changes
        document.addEventListener('click', event => {
            if (!isDirty) return;

            const link = event.target.closest('a[href]');
            if (!link) return;

            const href = link.getAttribute('href');
            if (!href || href === '#' || href.startsWith('javascript:') || link.target === '_blank') return;
            if (href.startsWith('#')) return;

            event.preventDefault();
            event.stopPropagation();

            if (window.TakeoffAnnouncement) {
                window.TakeoffAnnouncement.show({
                    type: 'warning',
                    force: true,
                    title: 'Unsaved Changes in Project',
                    badge: 'UNSAVED CHANGES',
                    content: `<p>You have made changes to this project that have not been saved yet.</p>
                              <div class="g-announcement-highlight-box" style="border-left-color: #f59e0b;">
                                  Would you like to save your project before leaving, or discard changes?
                              </div>`,
                    primaryText: 'Save & Exit',
                    secondaryText: 'Discard & Exit',
                    cancelText: 'Stay on Page',
                    onPrimary: async () => {
                        try {
                            await saveProject();
                            isDirty = false;
                            window.location.href = href;
                        } catch (err) {
                            console.error('Failed to save project before navigating:', err);
                        }
                    },
                    onSecondary: () => {
                        isDirty = false;
                        window.location.href = href;
                    },
                    onCancel: () => {
                        // User chooses to stay
                    }
                });
            } else {
                if (confirm('You have unsaved changes. Discard and leave anyway?')) {
                    isDirty = false;
                    window.location.href = href;
                }
            }
        }, true);

        // Browser back button interceptor for unsaved changes
        window.addEventListener('popstate', event => {
            if (!isDirty) return;

            // Re-push state immediately so user is not navigated away while modal is active
            try {
                window.history.pushState({ takeoffDirtyGuard: true }, '', window.location.href);
            } catch (e) { }

            if (window.TakeoffAnnouncement) {
                window.TakeoffAnnouncement.show({
                    type: 'warning',
                    force: true,
                    title: 'Unsaved Changes in Project',
                    badge: 'UNSAVED CHANGES',
                    content: `<p>You have made changes to this project that have not been saved yet.</p>
                              <div class="g-announcement-highlight-box" style="border-left-color: #f59e0b;">
                                  Would you like to save your project before leaving, or discard changes?
                              </div>`,
                    primaryText: 'Save & Exit',
                    secondaryText: 'Discard & Exit',
                    cancelText: 'Stay on Page',
                    onPrimary: async () => {
                        try {
                            await saveProject();
                            isDirty = false;
                            window._historyDirtyGuarded = false;
                            window.history.go(-2);
                        } catch (err) {
                            console.error('Failed to save project before navigating back:', err);
                        }
                    },
                    onSecondary: () => {
                        isDirty = false;
                        window._historyDirtyGuarded = false;
                        window.history.go(-2);
                    },
                    onCancel: () => {
                        // User chooses to stay
                    }
                });
            } else {
                if (confirm('You have unsaved changes. Discard and leave anyway?')) {
                    isDirty = false;
                    window._historyDirtyGuarded = false;
                    window.history.go(-2);
                }
            }
        });

        window.addEventListener('beforeunload', event => {
            if (!isDirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
    });
})();
