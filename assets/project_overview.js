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
    let documentDensity = 'normal';
    let documentZoomLevel = 1;
    const sessionFiles = new Map();
    const sessionFileUrls = new Map();
    const pdfDocumentCache = new Map();
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
        const existingMeta = window.ProjectState?.projectMeta || {};
        const metadata = {
            ...existingMeta,
            estimator: $('poEstimator')?.value || existingMeta.estimator || 'Juan Estevez',
            measurement_system: $('poMeasurementSystem')?.value || existingMeta.measurement_system || 'US',
            estimate_pricing: $('poEstimatePricing')?.value || existingMeta.estimate_pricing || 'Unlocked',
            office: $('poOffice')?.value || existingMeta.office || '',
            square_footage: $('poSquareFootage')?.value || existingMeta.square_footage || '',
            customer_company: $('poCustomerCompany')?.value || existingMeta.customer_company || '',
            primary_contact: $('poPrimaryContact')?.value || existingMeta.primary_contact || '',
            customer_phone: $('poCustomerPhone')?.value || existingMeta.customer_phone || '',
            customer_email: $('poCustomerEmail')?.value || existingMeta.customer_email || '',
            customer_address: $('poCustomerAddress')?.value || existingMeta.customer_address || '',
            notes,
            tasks
        };

        return {
            id: Number(window.ProjectState?.projectId || 0) || 0,
            project_template_id: window.ProjectState?.projectInfo?.project_template_id || '',
            name: $('poEstimateName')?.value.trim() || window.ProjectState?.projectInfo?.name || $('projectHeaderName')?.textContent?.trim() || 'New Project',
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
                    await window.projectTakeoffSaveState();
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
            const savePayload = collectProjectPayload();
            const result = await request('save', savePayload);
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
                    extension: doc.extension, mime_type: doc.type, uploaded_at: new Date().toISOString(),
                    pageCount: doc.pageCount || null, page_count: doc.pageCount || null, pages: doc.pages || []
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
        try {
            localStorage.setItem('takeoff.bidBoardStage', statusLabel());
            sessionStorage.setItem('takeoff.bidBoardStage', statusLabel());
        } catch (e) { }
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
        { id: 4, name: 'Sarah Jenkins', role: 'Senior Estimator', initials: 'SJ', avatarColor: '#d97706' },
        { id: 5, name: 'Michael Chang', role: 'Civil Estimator', initials: 'MC', avatarColor: '#0284c7' },
        { id: 6, name: 'Elena Rostova', role: 'Electrical Estimator', initials: 'ER', avatarColor: '#7c3aed' },
        { id: 7, name: 'David Miller', role: 'Mechanical Estimator', initials: 'DM', avatarColor: '#059669' },
        { id: 8, name: 'Amanda Brooks', role: 'Commercial Estimator', initials: 'AB', avatarColor: '#ea580c' },
        { id: 9, name: 'Marcus Vance', role: 'Structural Estimator', initials: 'MV', avatarColor: '#dc2626' },
        { id: 10, name: 'Ana Lopez', role: 'Estimating Coordinator', initials: 'AL', avatarColor: '#d97706' }
    ];

    function loadSystemUsers() {
        if (window.ProjectState && Array.isArray(window.ProjectState.availableEstimators) && window.ProjectState.availableEstimators.length) {
            systemUsers = window.ProjectState.availableEstimators;
        }
        populateAssigneeSelector();
        populateEstimatorSelector();
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

    function populateEstimatorSelector(selectedEstimator = null) {
        const select = $('poEstimator');
        if (!select) return;
        const current = (selectedEstimator !== null ? selectedEstimator : (select.value || select.dataset.initialValue || '')).trim();

        select.innerHTML = '<option value="">-- Select an Estimator --</option>' +
            systemUsers.map(u => {
                const isSel = (current && (current === u.name || current.toLowerCase() === u.name.toLowerCase())) ? 'selected' : '';
                return `<option value="${escapeHtml(u.name)}" ${isSel}>${escapeHtml(u.name)} (${escapeHtml(u.role || 'Estimator')})</option>`;
            }).join('');

        if (current && current !== 'Unassigned' && !systemUsers.some(u => u.name.toLowerCase() === current.toLowerCase())) {
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

        const boundaryEl = button.closest('#overviewTab, .workspace-shell, body') || document.body;
        const margin = 10;
        const bRect = (boundaryEl && boundaryEl !== document.body) ? boundaryEl.getBoundingClientRect() : {
            left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight
        };
        const minLeft = Math.max(margin, (bRect.left / zoom) + margin);
        const maxRight = Math.min((window.innerWidth / zoom) - margin, (bRect.right / zoom) - margin);
        const maxBottom = Math.min((window.innerHeight / zoom) - margin, (bRect.bottom / zoom) - margin);

        const menuWidth = menu.offsetWidth || 130;
        const menuHeight = menu.offsetHeight || 140;

        let leftPos = (rect.right / zoom) - menuWidth;
        if (leftPos < minLeft) {
            leftPos = (rect.left / zoom);
        }
        leftPos = Math.max(minLeft, Math.min(leftPos, maxRight - menuWidth));

        let topPos = (rect.bottom / zoom) + 4;
        if (topPos + menuHeight > maxBottom) {
            topPos = Math.max(margin, (rect.top / zoom) - menuHeight - 4);
        }

        menu.style.left = `${Math.round(leftPos)}px`;
        menu.style.top = `${Math.round(topPos)}px`;
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

    function cleanId(id) {
        return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    async function loadPdfDocument(doc) {
        if (!window.pdfjsLib) return null;
        if (pdfDocumentCache.has(doc.id)) return pdfDocumentCache.get(doc.id);
        try {
            let pdf = null;
            const file = sessionFiles.get(String(doc.id));
            if (file) {
                const arrayBuffer = await file.arrayBuffer();
                pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
            } else if (doc.path) {
                pdf = await window.pdfjsLib.getDocument(doc.path).promise;
            }
            if (pdf) {
                pdfDocumentCache.set(doc.id, pdf);
                return pdf;
            }
        } catch (e) {
            console.warn('PDF load failed for doc', doc.id, e);
        }
        return null;
    }

    const pdfThumbnailDataCache = new Map();
    let currentThumbnailObserver = null;

    function cleanupThumbnailObserver() {
        if (currentThumbnailObserver) {
            currentThumbnailObserver.disconnect();
            currentThumbnailObserver = null;
        }
    }

    async function renderSheetThumbnails(doc, sheets) {
        cleanupThumbnailObserver();
        if (!doc) return;

        let pdfInstance = null;
        const loadPdfOnce = async () => {
            if (!pdfInstance) {
                pdfInstance = await loadPdfDocument(doc);
            }
            return pdfInstance;
        };

        const renderQueue = [];
        let isRendering = false;

        const processQueue = async () => {
            if (isRendering || !renderQueue.length) return;
            isRendering = true;
            const item = renderQueue.shift();
            try {
                const pdf = await loadPdfOnce();
                if (pdf) {
                    await renderSingleSheetThumbnail(pdf, doc, item.sheet);
                }
            } catch (err) {
                console.warn('Thumbnail render error:', err);
            } finally {
                isRendering = false;
                if (renderQueue.length) {
                    requestAnimationFrame(processQueue);
                }
            }
        };

        if (window.IntersectionObserver) {
            currentThumbnailObserver = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const row = entry.target;
                        obs.unobserve(row);
                        const sheetId = row.dataset.docSheetId;
                        const sheet = sheets.find(s => s.id === sheetId);
                        if (sheet) {
                            renderQueue.push({ sheet });
                            processQueue();
                        }
                    }
                });
            }, {
                root: document.getElementById('documentsList'),
                rootMargin: '120px 0px 120px 0px',
                threshold: 0.01
            });

            document.querySelectorAll('.doc-list-item-row[data-doc-sheet-id]').forEach(row => {
                currentThumbnailObserver.observe(row);
            });
        } else {
            // Fallback for browsers without IntersectionObserver: render first 8 sheets
            const pdf = await loadPdfOnce();
            if (pdf) {
                for (const sheet of sheets.slice(0, 8)) {
                    await renderSingleSheetThumbnail(pdf, doc, sheet);
                }
            }
        }
    }

    async function renderSingleSheetThumbnail(pdf, doc, sheet) {
        const cId = cleanId(sheet.id);
        const canvas = document.getElementById(`canvas-${cId}`);
        const bpFallback = document.getElementById(`bp-${cId}`);
        if (!canvas) return;

        const cacheKey = `${doc.id}_p${sheet.pageNumber || 1}`;
        if (pdfThumbnailDataCache.has(cacheKey)) {
            const cachedImg = pdfThumbnailDataCache.get(cacheKey);
            const ctx = canvas.getContext('2d');
            canvas.width = cachedImg.width;
            canvas.height = cachedImg.height;
            ctx.drawImage(cachedImg, 0, 0);
            canvas.style.display = 'block';
            if (bpFallback) bpFallback.style.display = 'none';
            return;
        }

        try {
            const pageNum = sheet.pageNumber || 1;
            const page = await pdf.getPage(pageNum);
            const unscaled = page.getViewport({ scale: 1.0 });
            // Optimal lightweight thumbnail scale (~160px width)
            const targetWidth = 160;
            const scale = Math.min(0.32, Math.max(0.12, targetWidth / (unscaled.width || 1000)));
            const viewport = page.getViewport({ scale });

            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;

            canvas.style.display = 'block';
            if (bpFallback) bpFallback.style.display = 'none';

            if (window.createImageBitmap) {
                createImageBitmap(canvas).then(bitmap => {
                    pdfThumbnailDataCache.set(cacheKey, bitmap);
                }).catch(() => { });
            }
        } catch (err) {
            console.warn('Could not render thumbnail for page', sheet.pageNumber, err);
        }
    }

    async function renderAttachmentThumbnails(docs) {
        if (!window.pdfjsLib) return;
        const pdfDocs = docs.filter(d => d.extension === 'pdf');
        for (const doc of pdfDocs) {
            const cId = cleanId(doc.id);
            const canvas = document.getElementById(`canvas-${cId}`);
            const bpFallback = document.getElementById(`bp-${cId}`);
            if (!canvas) continue;

            const cacheKey = `${doc.id}_p1`;
            if (pdfThumbnailDataCache.has(cacheKey)) {
                const cachedImg = pdfThumbnailDataCache.get(cacheKey);
                const ctx = canvas.getContext('2d');
                canvas.width = cachedImg.width;
                canvas.height = cachedImg.height;
                ctx.drawImage(cachedImg, 0, 0);
                canvas.style.display = 'block';
                if (bpFallback) bpFallback.style.display = 'none';
                continue;
            }

            try {
                const pdf = await loadPdfDocument(doc);
                if (!pdf) continue;
                const page = await pdf.getPage(1);
                const unscaled = page.getViewport({ scale: 1.0 });
                const scale = Math.min(0.32, Math.max(0.12, 160 / (unscaled.width || 1000)));
                const viewport = page.getViewport({ scale });
                canvas.width = Math.round(viewport.width);
                canvas.height = Math.round(viewport.height);
                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;
                canvas.style.display = 'block';
                if (bpFallback) bpFallback.style.display = 'none';

                if (window.createImageBitmap) {
                    createImageBitmap(canvas).then(bitmap => {
                        pdfThumbnailDataCache.set(cacheKey, bitmap);
                    }).catch(() => { });
                }
            } catch (err) {
                console.warn('Could not render attachment preview:', err);
            }
        }
    }

    async function getDocumentSheets(doc) {
        if (!doc) return [];
        if (Array.isArray(doc.pages) && doc.pages.length) {
            return doc.pages;
        }
        if (doc.extension === 'pdf') {
            const pdf = await loadPdfDocument(doc);
            if (pdf && pdf.numPages) {
                const generated = [];
                for (let p = 1; p <= pdf.numPages; p++) {
                    generated.push({
                        id: `${doc.id}-p${p}`,
                        pageNumber: p,
                        name: `Sheet ${p}`,
                        title: `${(doc.name || 'Plan').replace(/\.pdf$/i, '')} - Page ${p}`
                    });
                }
                doc.pages = generated;
                doc.pageCount = pdf.numPages;

                const local = localDocuments.find(d => String(d.id) === String(doc.id));
                if (local) {
                    local.pages = generated;
                    local.pageCount = pdf.numPages;
                    persistLocalDocuments();
                    syncDocumentsToProjectState();
                }
                if (window.ProjectState?.documents) {
                    const psDoc = window.ProjectState.documents.find(d => String(d.id) === String(doc.id) || (doc.backendId && String(d.id) === String(doc.backendId)));
                    if (psDoc) {
                        psDoc.pages = generated;
                        psDoc.page_count = pdf.numPages;
                        psDoc.pageCount = pdf.numPages;
                    }
                }
                return generated;
            }
        }
        const count = Number(doc.pageCount || 1);
        const fallbackPages = [];
        for (let p = 1; p <= count; p++) {
            fallbackPages.push({
                id: `${doc.id}-p${p}`,
                pageNumber: p,
                name: `Sheet ${p}`,
                title: `Page ${p}`
            });
        }
        return fallbackPages;
    }

    async function ensurePdfPageCount(doc) {
        if (!doc || doc.extension !== 'pdf' || (doc.pageCount && doc.pageCount > 0)) return doc.pageCount;
        try {
            const pdf = await loadPdfDocument(doc);
            if (pdf && pdf.numPages) {
                const count = pdf.numPages;
                doc.pageCount = count;
                if (!doc.pages || !doc.pages.length) {
                    doc.pages = Array.from({ length: count }, (_, i) => ({
                        id: `${doc.id}-p${i + 1}`,
                        pageNumber: i + 1,
                        name: `Sheet ${i + 1}`,
                        title: `${(doc.name || 'Plan').replace(/\.pdf$/i, '')} - Page ${i + 1}`
                    }));
                }

                const localDoc = localDocuments.find(d => String(d.id) === String(doc.id));
                if (localDoc) {
                    localDoc.pageCount = count;
                    localDoc.pages = doc.pages;
                    persistLocalDocuments();
                    syncDocumentsToProjectState();
                }

                if (window.ProjectState?.documents) {
                    const psDoc = window.ProjectState.documents.find(d => String(d.id) === String(doc.id) || (doc.backendId && String(d.id) === String(doc.backendId)));
                    if (psDoc) {
                        psDoc.pageCount = count;
                        psDoc.page_count = count;
                        psDoc.pages = doc.pages;
                    }
                }

                const itemEl = document.querySelector(`[data-drag-doc-id="${doc.id}"]`);
                if (itemEl) {
                    let badgeEl = itemEl.querySelector('.doc-tree-item-badge');
                    if (badgeEl) {
                        badgeEl.textContent = String(count);
                    } else {
                        badgeEl = document.createElement('span');
                        badgeEl.className = 'doc-tree-item-badge';
                        badgeEl.textContent = String(count);
                        const moreBtn = itemEl.querySelector('.doc-tree-item-more');
                        itemEl.insertBefore(badgeEl, moreBtn);
                    }
                }
                return count;
            }
        } catch (e) {
            console.warn('ensurePdfPageCount failed for', doc.id, e);
        }
        return null;
    }

    let isAddingFiles = false;

    async function addFiles(files, category = null) {
        const rawIncoming = Array.from(files || []);
        if (!rawIncoming.length) return;
        if (isAddingFiles) return;
        isAddingFiles = true;

        try {
            // Deduplicate files in this incoming batch by name, size, and lastModified
            const incoming = [];
            const seenKeys = new Set();
            for (const f of rawIncoming) {
                const key = `${f.name}_${f.size}_${f.lastModified || 0}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    incoming.push(f);
                }
            }

            if (!incoming.length) return;
            const now = new Date().toLocaleString();

            for (let index = 0; index < incoming.length; index++) {
                const file = incoming[index];
                const id = String(Date.now() + index + Math.random().toString(16).slice(2));
                const ext = String(file.name.split('.').pop() || '').toLowerCase();
                const inferredCategory = inferCategory(file, category);
                const folderId = selectedDocumentsFolder.startsWith('custom:') ? selectedDocumentsFolder.replace('custom:', '') : '';

                sessionFiles.set(id, file);
                sessionFileUrls.set(id, URL.createObjectURL(file));

                let pageCount = null;
                let pages = [];

                if (ext === 'pdf' && window.pdfjsLib) {
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        const typedData = new Uint8Array(arrayBuffer);
                        const pdf = await window.pdfjsLib.getDocument({ data: typedData }).promise;
                        pdfDocumentCache.set(id, pdf);
                        pageCount = pdf.numPages;
                        for (let p = 1; p <= pageCount; p++) {
                            pages.push({
                                id: `${id}-p${p}`,
                                pageNumber: p,
                                name: `Sheet ${p}`,
                                title: `${file.name.replace(/\.pdf$/i, '')} - Page ${p}`
                            });
                        }
                    } catch (err) {
                        console.warn('Could not extract PDF page count:', err);
                    }
                }

                localDocuments.push({
                    id,
                    name: file.name,
                    filename: file.name,
                    category: inferredCategory,
                    folderId,
                    size: file.size,
                    uploadedAt: now,
                    uploadedBy: $('poEstimator')?.value || 'Juan Estevez',
                    type: file.type || '',
                    extension: ext,
                    source: 'local',
                    pageCount: pageCount || (pages.length ? pages.length : null),
                    pages,
                    order: Date.now() + index
                });
            }

            persistLocalDocuments();
            syncDocumentsToProjectState();
            renderDocumentsPage();
            showToast(`${incoming.length} file${incoming.length === 1 ? '' : 's'} added.`);
        } finally {
            isAddingFiles = false;
        }
    }

    function existingDocumentRows() {
        return (window.ProjectState?.documents || [])
            .filter(doc => doc.source !== 'local_metadata')
            .map(doc => {
                const pageCount = Number(doc.page_count || doc.pageCount || 0) || (Array.isArray(doc.pages) ? doc.pages.length : 0) || null;
                let pages = Array.isArray(doc.pages) ? doc.pages : [];
                if ((!pages || !pages.length) && pageCount && pageCount > 0) {
                    pages = Array.from({ length: pageCount }, (_, i) => ({
                        id: `existing-${doc.source}-${doc.id}-p${i + 1}`,
                        pageNumber: i + 1,
                        name: `Sheet ${i + 1}`,
                        title: `Page ${i + 1}`
                    }));
                }
                return {
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
                    pageCount: pageCount,
                    pages: pages,
                    order: Number(doc.id || 0)
                };
            });
    }

    function allDocumentRows() {
        const seen = new Set();
        const rows = [];
        const existing = existingDocumentRows();
        const locals = localDocuments.map(doc => ({ ...doc, path: sessionFileUrls.get(doc.id) || doc.path || '' }));
        for (const row of [...existing, ...locals]) {
            const key = row.backendId ? `b-${row.originalSource}-${row.backendId}` : `l-${row.id}`;
            if (!seen.has(key)) {
                seen.add(key);
                rows.push(row);
            }
        }
        return rows;
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

    function getFolderReorderList() {
        try {
            const raw = localStorage.getItem('takeoff.docFolderOrder');
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function setFolderReorderList(ids) {
        try {
            localStorage.setItem('takeoff.docFolderOrder', JSON.stringify(ids));
        } catch (e) { }
    }

    function reorderPdfDocuments(sourceId, targetId, insertBefore) {
        const drawings = drawingDocuments();
        const currentIds = drawings.map(d => String(d.id));
        const srcIndex = currentIds.indexOf(String(sourceId));
        let tgtIndex = currentIds.indexOf(String(targetId));

        if (srcIndex === -1 || tgtIndex === -1) return;

        currentIds.splice(srcIndex, 1);
        tgtIndex = currentIds.indexOf(String(targetId));
        if (insertBefore) {
            currentIds.splice(tgtIndex, 0, String(sourceId));
        } else {
            currentIds.splice(tgtIndex + 1, 0, String(sourceId));
        }

        setFolderReorderList(currentIds);
        renderDocumentFolderTree();
    }

    let draggedDocId = null;

    function bindFolderTreeDragDrop(container) {
        if (!container) return;
        const items = container.querySelectorAll('.doc-tree-item.child[draggable="true"]');
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedDocId = item.dataset.dragDocId;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', draggedDocId);
                item.classList.add('is-dragging');
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = item.getBoundingClientRect();
                const relY = e.clientY - rect.top;
                if (relY < rect.height / 2) {
                    item.classList.add('drag-over-top');
                    item.classList.remove('drag-over-bottom');
                } else {
                    item.classList.add('drag-over-bottom');
                    item.classList.remove('drag-over-top');
                }
            });

            item.addEventListener('dragleave', () => {
                item.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('drag-over-top', 'drag-over-bottom');
                const targetDocId = item.dataset.dragDocId;
                if (!draggedDocId || draggedDocId === targetDocId) return;

                const rect = item.getBoundingClientRect();
                const insertBefore = (e.clientY - rect.top) < (rect.height / 2);

                reorderPdfDocuments(draggedDocId, targetDocId, insertBefore);
            });

            item.addEventListener('dragend', () => {
                items.forEach(i => i.classList.remove('is-dragging', 'drag-over-top', 'drag-over-bottom'));
                draggedDocId = null;
            });
        });
    }

    function drawingDocuments() {
        const rows = allDocumentRows().filter(doc => doc.category === 'Drawings');
        const customOrder = getFolderReorderList();
        if (customOrder.length) {
            return [...rows].sort((a, b) => {
                const idxA = customOrder.indexOf(String(a.id));
                const idxB = customOrder.indexOf(String(b.id));
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return (a.order || 0) - (b.order || 0);
            });
        }
        return rows;
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
        const emptyView = $('documentsEmptyView');
        const pageView = $('documentsPageView');
        const all = allDocumentRows();

        if (!all.length) {
            if (emptyView) {
                emptyView.classList.remove('is-hidden');
                emptyView.style.setProperty('display', 'flex', 'important');
            }
            if (pageView) {
                pageView.classList.add('is-hidden');
                pageView.style.setProperty('display', 'none', 'important');
            }
            return;
        }

        if (emptyView) {
            emptyView.classList.add('is-hidden');
            emptyView.style.setProperty('display', 'none', 'important');
        }
        if (pageView) {
            pageView.classList.remove('is-hidden');
            pageView.style.setProperty('display', 'flex', 'important');
        }

        renderDocumentFolderTree();
        renderDocumentsContent();
    }

    function renderDocumentFolderTree() {
        const tree = $('documentsFolderTree');
        if (!tree) return;
        const counts = folderCounts();
        const drawings = drawingDocuments();

        // Asynchronously ensure any PDF missing a page count gets calculated and updated
        drawings.forEach(doc => {
            if (doc.extension === 'pdf' && (!doc.pageCount || doc.pageCount <= 0)) {
                ensurePdfPageCount(doc);
            }
        });

        const customRows = customFolders.map(folder => {
            const count = allDocumentRows().filter(doc => String(doc.folderId || '') === String(folder.id)).length;
            const isActive = selectedDocumentsFolder === `custom:${folder.id}`;
            return `<div class="doc-tree-item ${isActive ? 'active' : ''}" data-doc-folder="custom:${escapeHtml(folder.id)}">
                <i class="fas fa-folder doc-tree-item-icon"></i>
                <span class="doc-tree-item-title">${escapeHtml(folder.name)}</span>
                <span class="doc-tree-item-badge">${count}</span>
                <button class="btn-ghost icon-only doc-tree-item-more" type="button" data-doc-sidebar-more="custom:${escapeHtml(folder.id)}" title="Folder options"><i class="fas fa-ellipsis-vertical"></i></button>
            </div>`;
        }).join('');

        const isDrawingsActive = selectedDocumentsFolder === 'drawings' || selectedDocumentsFolder.startsWith('document:');
        const isAttachmentsActive = selectedDocumentsFolder === 'attachments';

        tree.innerHTML = `
            <div class="doc-tree-item ${selectedDocumentsFolder === 'drawings' ? 'active' : ''}" data-doc-folder="drawings">
                <i class="far fa-file-lines doc-tree-item-icon"></i>
                <span class="doc-tree-item-title">Drawings</span>
                <span class="doc-tree-item-badge">${counts.drawings}</span>
                <button class="btn-ghost icon-only doc-tree-item-more" type="button" data-doc-sidebar-more="category:Drawings" title="Drawings options"><i class="fas fa-ellipsis-vertical"></i></button>
            </div>
            <div class="documents-folder-children">
                ${drawings.map(doc => {
            const pageVal = doc.pageCount || (doc.pages && doc.pages.length) || '';
            const isDocActive = selectedDocumentsFolder === `document:${doc.id}`;
            return `
                    <div class="doc-tree-item child ${isDocActive ? 'active' : ''}" data-doc-folder="document:${escapeHtml(doc.id)}" data-drag-doc-id="${escapeHtml(doc.id)}" draggable="true">
                        <i class="fas fa-grip-vertical doc-drag-handle" title="Drag to reorder"></i>
                        <i class="fas fa-folder doc-tree-item-icon"></i>
                        <span class="doc-tree-item-title" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
                        ${pageVal ? `<span class="doc-tree-item-badge">${escapeHtml(pageVal)}</span>` : ''}
                        <button class="btn-ghost icon-only doc-tree-item-more" type="button" data-doc-sidebar-more="doc:${escapeHtml(doc.id)}" title="Document options"><i class="fas fa-ellipsis-vertical"></i></button>
                    </div>`;
        }).join('')}
            </div>
            <div class="doc-tree-item ${isAttachmentsActive ? 'active' : ''}" data-doc-folder="attachments">
                <i class="fas fa-paperclip doc-tree-item-icon"></i>
                <span class="doc-tree-item-title">Attachments</span>
                <span class="doc-tree-item-badge">${counts.attachments}</span>
                <button class="btn-ghost icon-only doc-tree-item-more" type="button" data-doc-sidebar-more="category:Attachments" title="Attachment options"><i class="fas fa-ellipsis-vertical"></i></button>
            </div>
            ${customRows}
        `;

        tree.querySelectorAll('[data-doc-folder]').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.doc-tree-item-more') || e.target.closest('[data-doc-action]') || e.target.closest('.doc-drag-handle')) return;
                selectedDocumentsFolder = row.dataset.docFolder;
                renderDocumentsPage();
            });
        });

        tree.querySelectorAll('[data-doc-sidebar-more]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openSidebarMenu(btn.dataset.docSidebarMore, btn);
            });
        });

        bindFolderTreeDragDrop(tree);
    }

    async function renderDocumentsContent() {
        const list = $('documentsList');
        if (!list) return;
        const title = $('documentsContentTitle');
        const isAttachments = selectedDocumentsFolder === 'attachments';
        const isPackage = selectedDocumentsFolder.startsWith('document:');

        if (title) {
            if (isPackage) {
                const docName = selectedFolderDocumentName();
                title.innerHTML = `
                    <div class="doc-topbar-breadcrumb">
                        <span class="doc-breadcrumb-link" data-doc-breadcrumb="drawings">Drawings</span>
                        <span class="doc-breadcrumb-sep"><i class="fas fa-chevron-right"></i></span>
                        <span class="doc-breadcrumb-current">${escapeHtml(docName)}</span>
                    </div>
                `;
            } else if (isAttachments) {
                title.textContent = 'Attachments';
            } else if (selectedDocumentsFolder.startsWith('custom:')) {
                const fId = selectedDocumentsFolder.replace('custom:', '');
                const folder = customFolders.find(f => String(f.id) === fId);
                title.textContent = folder ? folder.name : 'Custom Drawings';
            } else {
                title.textContent = 'Custom Drawings';
            }
        }

        const sortLabel = $('docSortLabel');
        if (sortLabel) {
            const labels = {
                custom: 'Custom',
                name: 'Name',
                uploadedAt: 'Upload Date',
                pageCount: 'Page Count',
                type: 'Type'
            };
            sortLabel.textContent = labels[documentSortBy] || 'Custom';
        }

        const query = String($('documentsSearch')?.value || '').trim().toLowerCase();

        // 1. PDF Document Page Separation View
        if (isPackage) {
            const docId = selectedDocumentsFolder.replace('document:', '');
            const doc = allDocumentRows().find(r => r.id === docId);
            if (!doc) {
                list.className = 'documents-list';
                list.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Document not found.</div>`;
                return;
            }
            const sheets = await getDocumentSheets(doc);
            const filtered = query
                ? sheets.filter(s => `${s.name || ''} ${s.title || ''} page ${s.pageNumber || ''}`.toLowerCase().includes(query))
                : sheets;

            if (!filtered.length) {
                list.className = 'documents-list';
                list.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No sheets match your search.</div>`;
                return;
            }

            list.className = `doc-horizontal-list zoom-${documentZoomLevel}`;
            list.innerHTML = filtered.map(sheet => renderSheetCard(doc, sheet)).join('');
            bindDocumentListActions(list);
            renderSheetThumbnails(doc, filtered);
            return;
        }

        // 2. Attachments View
        if (isAttachments) {
            const docs = sortedDocuments(filteredDocuments(attachmentDocuments()));
            if (!docs.length) {
                list.className = 'documents-list';
                list.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">${query ? 'No attachments match your search.' : 'No attachments in this folder yet.'}</div>`;
                return;
            }
            list.className = `doc-horizontal-list zoom-${documentZoomLevel}`;
            list.innerHTML = docs.map(doc => renderAttachmentCard(doc)).join('');
            bindDocumentListActions(list);
            renderAttachmentThumbnails(docs);
            return;
        }

        // 3. Drawings / Custom Folders (File List View)
        const docs = sortedDocuments(filteredDocuments(documentsForSelectedFolder()));
        if (!docs.length) {
            list.className = 'documents-list';
            list.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">${query ? 'No files match your search.' : 'No files in this folder yet.'}</div>`;
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

    function renderSheetCard(doc, sheet) {
        const cId = cleanId(sheet.id);
        const isActive = selectedDocumentsId === sheet.id;
        return `
            <div class="doc-list-item-row ${isActive ? 'active' : ''}" data-doc-sheet-id="${escapeHtml(sheet.id)}" data-parent-doc-id="${escapeHtml(doc.id)}" data-page-num="${sheet.pageNumber}">
                <div class="doc-item-thumb-box" data-doc-action="select-sheet" data-doc-id="${escapeHtml(sheet.id)}">
                    <canvas class="doc-sheet-canvas" id="canvas-${cId}" style="display:none;"></canvas>
                    <div class="doc-sheet-blueprint" id="bp-${cId}">
                        <i class="fas fa-drafting-compass"></i>
                        <span class="doc-sheet-blueprint-badge">P.${sheet.pageNumber}</span>
                    </div>
                </div>
                <div class="doc-item-details" data-doc-action="select-sheet" data-doc-id="${escapeHtml(sheet.id)}">
                    <div class="doc-item-title-line">
                        <span class="doc-item-name" title="${escapeHtml(sheet.name)}">${escapeHtml(sheet.name)}</span>
                        <span class="doc-item-page-badge">Page ${sheet.pageNumber}</span>
                    </div>
                    <div class="doc-item-sub-line">
                        <span class="doc-item-sub-desc">${escapeHtml(sheet.title || doc.name)}</span>
                    </div>
                </div>
                <div class="doc-item-actions">
                    <button class="btn-ghost icon-only" type="button" data-doc-action="sheet-menu" data-doc-id="${escapeHtml(sheet.id)}" title="Options">
                        <i class="fas fa-ellipsis-vertical"></i>
                    </button>
                    <div class="documents-menu row-menu" data-doc-menu="${escapeHtml(sheet.id)}">
                        <button type="button" data-doc-action="takeoff" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-ruler-combined"></i> Takeoff Page ${sheet.pageNumber}</button>
                        <button type="button" data-doc-action="view-sheet" data-doc-id="${escapeHtml(doc.id)}" data-page-num="${sheet.pageNumber}"><i class="fas fa-eye"></i> View File</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderAttachmentCard(doc) {
        const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(doc.extension);
        const isPdf = doc.extension === 'pdf';
        const cleanDocId = cleanId(doc.id);
        const imgUrl = doc.path || sessionFileUrls.get(String(doc.id)) || '';

        let thumbHtml = '';
        if (isImage && imgUrl) {
            thumbHtml = `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(doc.name)}" style="width: 100%; height: 100%; object-fit: contain;">`;
        } else if (isPdf) {
            thumbHtml = `
                <canvas class="doc-sheet-canvas" id="canvas-${cleanDocId}" style="display:none;"></canvas>
                <div class="doc-attachment-thumb" id="bp-${cleanDocId}">
                    <i class="far fa-file-pdf" style="color: #ef4444;"></i>
                    <span style="font-size: 10px; color: var(--text-muted);">${formatBytes(doc.size)}</span>
                </div>
            `;
        } else {
            const iconClass = doc.extension.includes('xls') ? 'fa-file-excel' : doc.extension.includes('doc') ? 'fa-file-word' : doc.extension.includes('zip') ? 'fa-file-zipper' : 'fa-file';
            const iconColor = doc.extension.includes('xls') ? '#10b981' : doc.extension.includes('doc') ? '#3b82f6' : '#64748b';
            thumbHtml = `
                <div class="doc-attachment-thumb">
                    <i class="far ${iconClass}" style="color: ${iconColor};"></i>
                    <span style="font-size: 10px; color: var(--text-muted);">${formatBytes(doc.size)}</span>
                </div>
            `;
        }

        return `
            <div class="doc-list-item-row ${selectedDocumentsId === doc.id ? 'active' : ''}" data-doc-id="${escapeHtml(doc.id)}">
                <div class="doc-item-thumb-box" data-doc-action="select" data-doc-id="${escapeHtml(doc.id)}">
                    ${thumbHtml}
                </div>
                <div class="doc-item-details" data-doc-action="select" data-doc-id="${escapeHtml(doc.id)}">
                    <div class="doc-item-title-line">
                        <span class="doc-item-name" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
                        <span class="doc-item-page-badge">${escapeHtml(doc.extension.toUpperCase())}</span>
                    </div>
                    <div class="doc-item-sub-line">
                        <span class="doc-item-sub-desc">${formatBytes(doc.size)}${doc.uploadedAt ? ` • Uploaded ${doc.uploadedAt}` : ''}</span>
                    </div>
                </div>
                <div class="doc-item-actions">
                    <button class="btn-ghost icon-only" type="button" data-doc-action="menu" data-doc-id="${escapeHtml(doc.id)}" title="Options">
                        <i class="fas fa-ellipsis-vertical"></i>
                    </button>
                    <div class="documents-menu row-menu" data-doc-menu="${escapeHtml(doc.id)}">
                        <button type="button" data-doc-action="view" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-eye"></i> View</button>
                        <button type="button" data-doc-action="rename" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-pen"></i> Rename</button>
                        <button type="button" data-doc-action="download" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-download"></i> Download</button>
                        <button type="button" data-doc-action="delete" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-trash"></i> Delete</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderDocumentRow(doc) {
        return `<div class="doc-file-row ${selectedDocumentsId === doc.id ? 'active' : ''}" data-doc-id="${escapeHtml(doc.id)}">
            <div class="doc-file-info" data-doc-action="select" data-doc-id="${escapeHtml(doc.id)}">
                <i class="fas fa-folder doc-file-icon"></i>
                <span class="doc-file-name" title="${escapeHtml(doc.name || doc.title || 'Document')}">${escapeHtml(doc.name || doc.title || 'Document')}</span>
            </div>
            <div class="doc-file-actions">
                <button class="btn-ghost icon-only" type="button" data-doc-action="menu" data-doc-id="${escapeHtml(doc.id)}" title="Options">
                    <i class="fas fa-ellipsis-vertical"></i>
                </button>
                <div class="documents-menu row-menu" data-doc-menu="${escapeHtml(doc.id)}">
                    <button type="button" data-doc-action="view" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-eye"></i> View</button>
                    <button type="button" data-doc-action="takeoff" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-ruler-combined"></i> Start Takeoff</button>
                    <button type="button" data-doc-action="rename" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-pen"></i> Rename</button>
                    <button type="button" data-doc-action="move" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-folder-tree"></i> Move</button>
                    <button type="button" data-doc-action="download" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-download"></i> Download</button>
                    <button type="button" data-doc-action="delete" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-trash"></i> Delete</button>
                </div>
            </div>
        </div>`;
    }

    function bindDocumentListActions(root) {
        if (root.dataset.documentActionsBound === '1') return;
        root.dataset.documentActionsBound = '1';
        root.addEventListener('click', event => {
            const breadcrumb = event.target.closest('[data-doc-breadcrumb]');
            if (breadcrumb) {
                event.stopPropagation();
                selectedDocumentsFolder = breadcrumb.dataset.docBreadcrumb;
                renderDocumentsPage();
                return;
            }

            const upload = event.target.closest('[data-doc-upload]');
            if (upload) return openDocumentPicker(upload.dataset.docUpload);

            const selectSheet = event.target.closest('[data-doc-sheet-id]');
            if (selectSheet && !event.target.closest('[data-doc-action="sheet-menu"]')) {
                selectedDocumentsId = selectSheet.dataset.docSheetId;
                document.querySelectorAll('.doc-list-item-row').forEach(c => {
                    c.classList.toggle('active', c.dataset.docSheetId === selectedDocumentsId);
                });
                return;
            }

            const button = event.target.closest('[data-doc-action]');
            if (!button) return;
            event.stopPropagation();
            handleDocumentAction(button.dataset.docAction, button.dataset.docId, button);
        });

        root.addEventListener('dblclick', event => {
            const sheetRow = event.target.closest('.doc-list-item-row');
            if (sheetRow && sheetRow.dataset.parentDocId) {
                selectedDocumentsId = sheetRow.dataset.parentDocId;
                startDocumentsTakeoff();
                return;
            }
            const row = event.target.closest('.doc-file-row');
            if (!row) return;
            const doc = findDocumentById(row.dataset.docId);
            if (!doc) return;
            if (doc.category === 'Drawings' || doc.extension === 'pdf') {
                selectedDocumentsFolder = `document:${doc.id}`;
                renderDocumentsPage();
            } else {
                handleDocumentAction('view', doc.id);
            }
        });
    }

    function findDocumentById(id) {
        return allDocumentRows().find(row => String(row.id) === String(id));
    }

    let currentRenameCallback = null;

    function openRenameModal({ title = 'Rename', label = 'Name', currentName = '', onSave }) {
        const modal = $('pdDocRenameModal');
        const titleEl = $('docRenameModalTitle');
        const labelEl = $('docRenameInputLabel');
        const input = $('modalDocRenameInput');
        if (!modal || !input) return;

        if (titleEl) titleEl.innerHTML = `<i class="fas fa-pen" style="color: var(--primary);"></i> ${escapeHtml(title)}`;
        if (labelEl) labelEl.textContent = label;
        input.value = currentName;
        currentRenameCallback = onSave;

        modal.classList.add('open');
        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    }
    window.openRenameModal = openRenameModal;

    function renameDocumentWithModal(doc, trigger = null) {
        if (!doc) return;
        openRenameModal({
            title: 'Rename Document',
            label: 'Document Name',
            currentName: doc.name,
            onSave: async (nextName) => {
                if (!nextName || nextName === doc.name) return;
                if (doc.source === 'existing') {
                    const projectId = Number(window.ProjectState?.projectId || 0);
                    let payload = { project_id: projectId, id: doc.backendId, source: doc.originalSource, operation: 'rename', name: nextName };
                    if (trigger) trigger.disabled = true;
                    try {
                        await request('document_action', payload);
                        window.ProjectState.documents = (window.ProjectState.documents || []).map(row => {
                            if (String(row.id) !== String(doc.backendId) || row.source !== doc.originalSource) return row;
                            return { ...row, title: payload.name, filename: payload.name };
                        });
                        renderDocumentsPage();
                        window.projectTakeoffRefreshDrawings?.();
                        showToast('Document renamed.');
                    } catch (error) {
                        showToast(error.message || 'Document rename failed.');
                    } finally {
                        if (trigger?.isConnected) trigger.disabled = false;
                    }
                } else {
                    localDocuments = localDocuments.map(row => row.id === doc.id ? { ...row, name: nextName, filename: nextName, extension: String(nextName.split('.').pop() || row.extension || '').toLowerCase() } : row);
                    persistLocalDocuments();
                    renderDocumentsPage();
                    showToast('Document renamed.');
                }
            }
        });
    }

    function openSidebarMenu(target, trigger) {
        const menu = $('docSidebarMenu');
        if (!menu || !trigger) return;
        closeAllDocumentsMenus();

        let html = '';
        if (target.startsWith('doc:')) {
            const docId = target.replace('doc:', '');
            const doc = findDocumentById(docId);
            if (!doc) return;
            html = `
                <button type="button" data-sidebar-action="view-doc" data-id="${escapeHtml(docId)}"><i class="fas fa-eye"></i> View File</button>
                <button type="button" data-sidebar-action="rename-doc" data-id="${escapeHtml(docId)}"><i class="fas fa-pen"></i> Rename</button>
                <button type="button" data-sidebar-action="takeoff-doc" data-id="${escapeHtml(docId)}"><i class="fas fa-ruler-combined"></i> Move to Takeoff</button>
                <button type="button" data-sidebar-action="download-doc" data-id="${escapeHtml(docId)}"><i class="fas fa-download"></i> Download</button>
                <button type="button" class="danger" data-sidebar-action="delete-doc" data-id="${escapeHtml(docId)}" style="color: #ef4444;"><i class="fas fa-trash"></i> Delete</button>
            `;
        } else if (target.startsWith('custom:')) {
            const folderId = target.replace('custom:', '');
            html = `
                <button type="button" data-sidebar-action="rename-folder" data-id="${escapeHtml(folderId)}"><i class="fas fa-pen"></i> Rename folder</button>
                <button type="button" class="danger" data-sidebar-action="delete-folder" data-id="${escapeHtml(folderId)}" style="color: #ef4444;"><i class="fas fa-trash"></i> Delete folder</button>
            `;
        } else if (target === 'category:Drawings') {
            html = `
                <button type="button" data-sidebar-action="upload-category" data-cat="Drawings"><i class="fas fa-upload"></i> Upload drawing</button>
                <button type="button" data-sidebar-action="sort-folders"><i class="fas fa-arrow-down-a-z"></i> Sort drawings</button>
            `;
        } else if (target === 'category:Attachments') {
            html = `
                <button type="button" data-sidebar-action="upload-category" data-cat="Attachments"><i class="fas fa-paperclip"></i> Upload attachment</button>
            `;
        } else {
            // header:folders
            html = `
                <button type="button" data-sidebar-action="create-folder"><i class="fas fa-folder-plus"></i> Create folder</button>
                <button type="button" data-sidebar-action="sort-folders"><i class="fas fa-arrow-down-a-z"></i> Sort folders</button>
            `;
        }

        menu.innerHTML = html;
        menu.classList.add('open');
        positionFloatingMenu(menu, trigger);

        menu.querySelectorAll('[data-sidebar-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAllDocumentsMenus();
                const action = btn.dataset.sidebarAction;
                const id = btn.dataset.id;
                handleSidebarMenuAction(action, id, btn);
            });
        });
    }

    function showConfirmDialog({
        title = 'Confirm Action',
        message = 'Are you sure you want to proceed?',
        confirmText = 'Delete',
        cancelText = 'Cancel',
        type = 'error',
        badge = 'CONFIRMATION',
        icon = 'fas fa-trash',
        primaryDanger = true
    }) {
        return new Promise((resolve) => {
            if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.show === 'function') {
                let resolved = false;
                window.TakeoffAnnouncement.show({
                    force: true,
                    type: type,
                    title: title,
                    badge: badge,
                    icon: icon,
                    message: message,
                    primaryText: confirmText,
                    primaryDanger: primaryDanger,
                    cancelText: cancelText,
                    showDontShow: false,
                    onPrimary: () => {
                        if (!resolved) {
                            resolved = true;
                            resolve(true);
                        }
                    },
                    onCancel: () => {
                        if (!resolved) {
                            resolved = true;
                            resolve(false);
                        }
                    }
                });
                return;
            }
            resolve(window.confirm(message));
        });
    }
    window.showConfirmDialog = showConfirmDialog;

    function showAlertDialog({
        title = 'Notice',
        message = '',
        buttonText = 'Got It',
        type = 'warning',
        badge = 'NOTICE',
        icon = 'fas fa-circle-exclamation'
    }) {
        if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.show === 'function') {
            window.TakeoffAnnouncement.show({
                force: true,
                type: type,
                title: title,
                badge: badge,
                icon: icon,
                message: message,
                primaryText: buttonText,
                cancelText: null,
                secondaryText: null,
                showDontShow: false
            });
            return;
        }
        showToast(message);
    }

    async function handleSidebarMenuAction(action, id, btn) {
        if (action === 'view-doc') {
            const doc = findDocumentById(id);
            if (doc) openDocumentInBrowser(doc);
        } else if (action === 'rename-doc') {
            const doc = findDocumentById(id);
            if (doc) renameDocumentWithModal(doc, btn);
        } else if (action === 'takeoff-doc') {
            selectedDocumentsId = id;
            startDocumentsTakeoff();
        } else if (action === 'download-doc') {
            handleDocumentAction('download', id);
        } else if (action === 'delete-doc') {
            handleDocumentAction('delete', id);
        } else if (action === 'rename-folder') {
            const folder = customFolders.find(f => String(f.id) === String(id));
            if (folder) {
                openRenameModal({
                    title: 'Rename Folder',
                    label: 'Folder Name',
                    currentName: folder.name,
                    onSave: (name) => {
                        folder.name = name;
                        persistDocumentFolders();
                        renderDocumentsPage();
                        showToast(`Folder renamed to "${name}".`);
                    }
                });
            }
        } else if (action === 'delete-folder') {
            const folder = customFolders.find(f => String(f.id) === String(id));
            const hasDocs = allDocumentRows().some(doc => String(doc.folderId || '') === String(id));
            if (hasDocs) {
                showAlertDialog({
                    title: 'Folder Not Empty',
                    message: 'Folder must be empty before deleting it. Please move or delete its files first.',
                    buttonText: 'Got It',
                    type: 'warning',
                    badge: 'CANNOT DELETE',
                    icon: 'fas fa-folder-closed'
                });
                return;
            }
            const confirmed = await showConfirmDialog({
                title: 'Delete Folder',
                message: `Are you sure you want to delete the folder "${folder ? folder.name : 'this folder'}"?`,
                confirmText: 'Delete Folder',
                cancelText: 'Cancel',
                type: 'error',
                badge: 'DELETE FOLDER',
                icon: 'fas fa-trash',
                primaryDanger: true
            });
            if (!confirmed) return;
            customFolders = customFolders.filter(f => String(f.id) !== String(id));
            if (selectedDocumentsFolder === `custom:${id}`) selectedDocumentsFolder = 'drawings';
            persistDocumentFolders();
            renderDocumentsPage();
            showToast('Folder deleted.');
        } else if (action === 'create-folder') {
            createDocumentFolder();
        } else if (action === 'sort-folders') {
            sortDocumentFolders();
        } else if (action === 'upload-category') {
            openDocumentPicker(btn?.dataset?.cat || 'Drawings');
        }
    }

    function openDocumentInBrowser(doc, pageNum = null) {
        if (!doc) return;
        let url = '';
        if (doc.source === 'existing' && doc.path) {
            url = doc.path;
        } else {
            url = sessionFileUrls.get(String(doc.id)) || doc.path || '';
            if (!url) {
                const file = sessionFiles.get(String(doc.id));
                if (file) {
                    url = URL.createObjectURL(file);
                    sessionFileUrls.set(String(doc.id), url);
                }
            }
        }

        if (!url) {
            showToast('Unable to open preview: file not available in memory or storage.');
            return;
        }

        let targetUrl = url;
        const isPdf = doc.extension === 'pdf' || targetUrl.toLowerCase().includes('.pdf') || (doc.mime_type && doc.mime_type.includes('pdf'));
        if (pageNum && isPdf) {
            targetUrl = targetUrl.split('#')[0] + `#page=${pageNum}`;
        }

        window.open(targetUrl, '_blank');
    }

    async function handleDocumentAction(action, id, trigger = null) {
        if (action === 'menu' || action === 'sheet-menu') {
            const menu = [...document.querySelectorAll('.documents-menu.row-menu')]
                .find(candidate => candidate.dataset.docMenu === String(id));
            if (!menu) return;
            const isOpen = menu.classList.contains('open');
            closeAllDocumentsMenus();
            if (!isOpen && trigger) {
                menu.classList.add('open');
                positionFloatingMenu(menu, trigger);
            }
            return;
        }

        const doc = findDocumentById(id);
        if (!doc) return;
        closeAllDocumentsMenus();

        if (action === 'select') {
            selectedDocumentsId = doc.id;
            if (doc.category === 'Drawings' || doc.extension === 'pdf') {
                selectedDocumentsFolder = `document:${doc.id}`;
                renderDocumentsPage();
                return;
            }
            renderDocumentsContent();
            return;
        }
        if (action === 'takeoff') {
            selectedDocumentsId = doc.id;
            startDocumentsTakeoff();
            return;
        }
        if (action === 'rename') {
            renameDocumentWithModal(doc, trigger);
            return;
        }
        if (action === 'view' || action === 'view-sheet') {
            const pageNum = trigger?.dataset?.pageNum ? Number(trigger.dataset.pageNum) : null;
            openDocumentInBrowser(doc, pageNum);
            return;
        }
        if (action === 'download') {
            let url = doc.path || sessionFileUrls.get(String(doc.id));
            if (!url) {
                const file = sessionFiles.get(String(doc.id));
                if (file) {
                    url = URL.createObjectURL(file);
                    sessionFileUrls.set(String(doc.id), url);
                }
            }
            if (url) {
                const link = document.createElement('a');
                link.href = url;
                link.download = doc.name || doc.filename || 'download';
                document.body.appendChild(link);
                link.click();
                link.remove();
            } else {
                showToast('File not available for download.');
            }
            return;
        }
        if (action === 'delete') {
            const confirmed = await showConfirmDialog({
                title: 'Delete Document',
                message: `Are you sure you want to delete "${doc.name}"? This removes it from the project.`,
                confirmText: 'Delete Document',
                cancelText: 'Cancel',
                type: 'error',
                badge: 'DELETE DOCUMENT',
                icon: 'fas fa-trash',
                primaryDanger: true
            });
            if (!confirmed) return;

            if (doc.source === 'existing') {
                const projectId = Number(window.ProjectState?.projectId || 0);
                let payload = { project_id: projectId, id: doc.backendId, source: doc.originalSource, operation: 'delete' };
                if (trigger) trigger.disabled = true;
                try {
                    await request('document_action', payload);
                    window.ProjectState.documents = (window.ProjectState.documents || []).filter(row => !(String(row.id) === String(doc.backendId) && row.source === doc.originalSource));
                    if (selectedDocumentsId === id) selectedDocumentsId = null;
                    if (selectedDocumentsFolder === `document:${id}`) selectedDocumentsFolder = 'drawings';
                    renderDocumentsPage();
                    window.projectTakeoffRefreshDrawings?.();
                    showToast('Document deleted.');
                } catch (error) {
                    showAlertDialog({ title: 'Delete Failed', message: error.message || 'Document action failed.', type: 'error' });
                } finally {
                    if (trigger?.isConnected) trigger.disabled = false;
                }
                return;
            } else {
                localDocuments = localDocuments.filter(row => String(row.id) !== String(id));
                sessionFiles.delete(String(id));
                const objectUrl = sessionFileUrls.get(String(id));
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                sessionFileUrls.delete(String(id));
                persistLocalDocuments();
                syncDocumentsToProjectState();
                if (selectedDocumentsId === id) selectedDocumentsId = null;
                if (selectedDocumentsFolder === `document:${id}`) selectedDocumentsFolder = 'drawings';
                renderDocumentsPage();
                showToast('Document deleted.');
                return;
            }
        }
        if (action === 'move') {
            openRenameModal({
                title: 'Move Document',
                label: 'Folder / Category (e.g. Drawings, Attachments)',
                currentName: doc.category || 'Drawings',
                onSave: async (next) => {
                    if (!next) return;
                    if (doc.source === 'existing') {
                        const projectId = Number(window.ProjectState?.projectId || 0);
                        let payload = { project_id: projectId, id: doc.backendId, source: doc.originalSource, operation: 'move' };
                        if (/^\d+$/.test(next.trim())) {
                            payload.folder_id = Number(next.trim());
                        } else {
                            const normalized = next.toLowerCase().startsWith('attach') ? 'Attachments' : 'Drawings';
                            payload.category = normalized;
                        }
                        if (trigger) trigger.disabled = true;
                        try {
                            await request('document_action', payload);
                            window.ProjectState.documents = (window.ProjectState.documents || []).map(row => {
                                if (String(row.id) !== String(doc.backendId) || row.source !== doc.originalSource) return row;
                                return { ...row, folder_id: payload.folder_id || null };
                            });
                            renderDocumentsPage();
                            showToast('Document moved.');
                        } catch (error) {
                            showAlertDialog({ title: 'Move Failed', message: error.message || 'Document action failed.', type: 'error' });
                        } finally {
                            if (trigger?.isConnected) trigger.disabled = false;
                        }
                    } else {
                        const normalized = next.toLowerCase().startsWith('attach') ? 'Attachments' : 'Drawings';
                        localDocuments = localDocuments.map(row => row.id === id ? { ...row, category: normalized } : row);
                        persistLocalDocuments();
                        renderDocumentsPage();
                        showToast(`Moved to ${normalized}.`);
                    }
                }
            });
            return;
        }
    }

    function positionFloatingMenu(menu, trigger) {
        if (!menu || !trigger) return;
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const rect = trigger.getBoundingClientRect();

        menu.style.position = 'fixed';
        menu.style.zIndex = '99999';
        menu.style.display = 'grid';

        const triggerRight = rect.right / zoom;
        const triggerLeft = rect.left / zoom;
        const triggerBottom = rect.bottom / zoom;
        const triggerTop = rect.top / zoom;

        const menuWidth = Math.max(170, (menu.offsetWidth || 170));
        const menuHeight = Math.max(120, (menu.offsetHeight || 160));
        const winWidth = window.innerWidth / zoom;
        const winHeight = window.innerHeight / zoom;
        const margin = 8;

        // By default open towards the left from the trigger's right edge
        let leftPos = triggerRight - menuWidth;

        // If trigger is very close to left edge (e.g. sidebar tree), open towards the right of trigger
        if (leftPos < margin) {
            leftPos = Math.max(margin, triggerLeft);
        }

        // Clamp so it never extends beyond the right edge of window
        if (leftPos + menuWidth > winWidth - margin) {
            leftPos = winWidth - menuWidth - margin;
        }

        // Position vertically right under the trigger (+ 4px), or flip above if near bottom
        let topPos = triggerBottom + 4;
        if (topPos + menuHeight > winHeight - margin) {
            topPos = Math.max(margin, triggerTop - menuHeight - 4);
        }

        menu.style.setProperty('left', `${Math.round(leftPos)}px`, 'important');
        menu.style.setProperty('top', `${Math.round(topPos)}px`, 'important');
        menu.style.setProperty('right', 'auto', 'important');
        menu.style.setProperty('bottom', 'auto', 'important');
    }

    function toggleFloatingMenu(menuId, trigger) {
        const menu = $(menuId);
        if (!menu) return;
        const isOpen = menu.classList.contains('open');
        closeAllDocumentsMenus();
        if (!isOpen && trigger) {
            menu.classList.add('open');
            positionFloatingMenu(menu, trigger);
        }
    }

    function closeAllDocumentsMenus() {
        document.querySelectorAll('.documents-menu.open').forEach(menu => {
            menu.classList.remove('open');
            menu.style.display = '';
        });
    }

    function initSidebarResizer() {
        const resizer = $('docSidebarResizer');
        const sidebar = $('documentsSidebar');
        if (!resizer || !sidebar) return;

        const savedWidth = localStorage.getItem('takeoff.documentsSidebarWidth');
        if (savedWidth) {
            const w = Math.max(170, Math.min(500, Number(savedWidth)));
            sidebar.style.setProperty('--doc-sidebar-w', `${w}px`);
            sidebar.style.width = `${w}px`;
        }

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        const onMouseDown = (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = sidebar.getBoundingClientRect().width;
            resizer.classList.add('is-dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            const deltaX = (e.clientX - startX) / zoom;
            const maxW = Math.min(520, (window.innerWidth / zoom) * 0.55);
            const newWidth = Math.max(160, Math.min(maxW, startWidth + deltaX));
            sidebar.style.setProperty('--doc-sidebar-w', `${Math.round(newWidth)}px`);
            sidebar.style.width = `${Math.round(newWidth)}px`;
        };

        const onMouseUp = () => {
            if (!isResizing) return;
            isResizing = false;
            resizer.classList.remove('is-dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            const currentW = sidebar.getBoundingClientRect().width;
            localStorage.setItem('takeoff.documentsSidebarWidth', Math.round(currentW));
        };

        resizer.addEventListener('mousedown', onMouseDown);
    }

    function createDocumentFolder() {
        openRenameModal({
            title: 'Create Folder',
            label: 'Folder Name',
            currentName: '',
            onSave: (name) => {
                if (!name) return;
                customFolders.push({ id: `folder-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, order: Date.now() });
                persistDocumentFolders();
                renderDocumentsPage();
                showToast(`Folder "${name}" created.`);
            }
        });
    }

    function renameDocumentFolder() {
        if (!selectedDocumentsFolder.startsWith('custom:')) {
            showToast('Select a custom folder first.');
            return;
        }
        const id = selectedDocumentsFolder.replace('custom:', '');
        const folder = customFolders.find(row => row.id === id);
        if (!folder) return;
        openRenameModal({
            title: 'Rename Folder',
            label: 'Folder Name',
            currentName: folder.name,
            onSave: (name) => {
                if (!name || name === folder.name) return;
                folder.name = name;
                persistDocumentFolders();
                renderDocumentsPage();
                showToast(`Folder renamed to "${name}".`);
            }
        });
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

        // Multi-User Presence System (4 active users allowed per project)
        const initialCollaborators = [
            { id: 1, name: 'Isaac Diaz (You)', initials: 'ID', color: '#5b4364', role: 'Lead Estimator', isSelf: true },
            { id: 2, name: 'Sarah Connor', initials: 'SC', color: '#2563eb', role: 'Senior Architect', isSelf: false },
            { id: 3, name: 'Marcus Vance', initials: 'MV', color: '#059669', role: 'Project Manager', isSelf: false },
            { id: 4, name: 'Elena Gomez', initials: 'EG', color: '#d97706', role: 'Electrical Estimator', isSelf: false }
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

        $('docEmptyUploadBtn')?.addEventListener('click', () => openDocumentPicker('Drawings'));
        $('docUploadArrowBtn')?.addEventListener('click', () => openDocumentPicker(categoryForSelectedFolder()));
        $('docSortMenuBtn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleFloatingMenu('docSortMenu', event.currentTarget);
        });
        document.querySelectorAll('[data-doc-sort]').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                documentSortBy = button.dataset.docSort;
                closeAllDocumentsMenus();
                renderDocumentsContent();
            });
        });
        $('documentsSearch')?.addEventListener('input', () => {
            renderDocumentsContent();
        });
        $('documentsZoom')?.addEventListener('input', event => {
            documentZoomLevel = Number(event.target.value);
            documentDensity = documentZoomLevel === 0 ? 'compact' : documentZoomLevel === 2 ? 'comfortable' : 'normal';
            const hList = document.querySelector('.doc-horizontal-list');
            if (hList) {
                hList.className = `doc-horizontal-list zoom-${documentZoomLevel}`;
            }
            const list = document.querySelector('.documents-list');
            if (list) {
                list.className = `documents-list density-${documentDensity}`;
            }
        });
        document.querySelector('[data-doc-folder-menu-toggle]')?.addEventListener('click', event => {
            event.stopPropagation();
            openSidebarMenu('header:folders', event.currentTarget);
        });
        document.querySelector('[data-doc-view-menu-toggle]')?.addEventListener('click', event => {
            event.stopPropagation();
            toggleFloatingMenu('documentsViewMenu', event.currentTarget);
        });
        $('docMoveToTakeoffBtn')?.addEventListener('click', () => {
            let targetDocId = null;
            if (selectedDocumentsFolder.startsWith('document:')) {
                targetDocId = selectedDocumentsFolder.replace('document:', '');
            } else if (selectedDocumentsId) {
                targetDocId = selectedDocumentsId;
            } else {
                const drawings = drawingDocuments();
                if (drawings.length) targetDocId = drawings[0].id;
            }
            if (!targetDocId) {
                showToast('Please upload or select a document to move to Takeoff.');
                return;
            }
            selectedDocumentsId = targetDocId;
            startDocumentsTakeoff();
        });

        $('modalSaveDocRenameBtn')?.addEventListener('click', () => {
            const input = $('modalDocRenameInput');
            const val = input ? input.value.trim() : '';
            if (!val) {
                showToast('Please enter a valid name.');
                return;
            }
            $('pdDocRenameModal')?.classList.remove('open');
            if (typeof currentRenameCallback === 'function') {
                const cb = currentRenameCallback;
                currentRenameCallback = null;
                cb(val);
            }
        });

        $('modalDocRenameInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                $('modalSaveDocRenameBtn')?.click();
            }
        });

        document.querySelectorAll('[data-doc-folder-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.docFolderAction;
                if (action === 'create') createDocumentFolder();
                if (action === 'rename') renameDocumentFolder();
                if (action === 'delete') deleteDocumentFolder();
                if (action === 'sort') sortDocumentFolders();
                closeAllDocumentsMenus();
            });
        });
        document.querySelectorAll('[data-doc-view-action]').forEach(button => {
            button.addEventListener('click', () => {
                documentDensity = button.dataset.docViewAction === 'compact' ? 'compact' : 'comfortable';
                documentZoomLevel = documentDensity === 'compact' ? 0 : 2;
                const zoom = $('documentsZoom');
                if (zoom) zoom.value = String(documentZoomLevel);
                const hList = document.querySelector('.doc-horizontal-list');
                if (hList) {
                    hList.className = `doc-horizontal-list zoom-${documentZoomLevel}`;
                }
                closeAllDocumentsMenus();
                renderDocumentsContent();
            });
        });
        $('documentsBrowseInput')?.addEventListener('change', function () {
            addFiles(this.files, uploadCategory);
            this.value = '';
            uploadCategory = null;
        });

        const emptyView = $('documentsEmptyView');
        const emptyBox = $('docEmptyDropzone');
        const pageView = $('documentsPageView');

        [emptyView, pageView].filter(Boolean).forEach(zone => {
            ['dragenter', 'dragover'].forEach(eventName => {
                zone.addEventListener(eventName, event => {
                    event.preventDefault();
                    event.stopPropagation();
                    zone.classList.add('is-dragover');
                    if (emptyBox && zone === emptyView) emptyBox.classList.add('is-dragover');
                });
            });
            zone.addEventListener('dragleave', event => {
                event.preventDefault();
                event.stopPropagation();
                if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
                zone.classList.remove('is-dragover');
                if (emptyBox && zone === emptyView) emptyBox.classList.remove('is-dragover');
            });
            zone.addEventListener('drop', event => {
                event.preventDefault();
                event.stopPropagation();
                zone.classList.remove('is-dragover');
                if (emptyBox && zone === emptyView) emptyBox.classList.remove('is-dragover');
                const dtFiles = event.dataTransfer?.files;
                if (dtFiles && dtFiles.length) {
                    addFiles(dtFiles, null);
                }
            });
        });

        document.addEventListener('click', (event) => {
            const inMenu = event.target.closest('.documents-menu');
            const inTrigger = event.target.closest('[data-doc-folder-menu-toggle], [data-doc-view-menu-toggle], #docSortMenuBtn, [data-doc-action="menu"], [data-doc-action="sheet-menu"], [data-doc-folder-more], [data-doc-sidebar-more]');
            if (!inMenu && !inTrigger) {
                closeAllDocumentsMenus();
            }
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllDocumentsMenus();
                $('pdDocRenameModal')?.classList.remove('open');
            }
        });
        window.addEventListener('scroll', closeAllDocumentsMenus, true);
        window.addEventListener('resize', closeAllDocumentsMenus);

        initSidebarResizer();

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
                populateEstimatorSelector();
            },
            load: loadSystemUsers
        };

        function checkIsDirty() {
            if (isDirty) return true;
            if (typeof window.isTakeoffDirty === 'function' && window.isTakeoffDirty()) return true;
            if (typeof window.isEstimatingDirty === 'function' && window.isEstimatingDirty()) return true;
            if (window.ProjectState?.isDirty) return true;
            return false;
        }
        window.isProjectDirty = checkIsDirty;

        // In-app navigation interceptor for unsaved changes
        document.addEventListener('click', event => {
            if (!checkIsDirty()) return;

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
            if (!checkIsDirty()) return;

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
            if (!checkIsDirty()) return;
            event.preventDefault();
            event.returnValue = '';
        });
    });
})();
