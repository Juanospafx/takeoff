(function () {
    const apiUrl = '../api/project_module.php';
    const PROJECT_STATUSES = ['Invitations', 'To Do', 'Templates', 'Bid Submitted', 'Accepted', 'In Progress', 'Complete', 'Estimadores', 'Lost', 'Archived'];
    const STATUS_VALUES = {
        'Invitations': 'invitations',
        'To Do': 'to_do',
        'Templates': 'templates',
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
    STATUS_LABELS.template = 'Templates';
    STATUS_LABELS.estimating = 'To Do';
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
    const overviewDialogs = window.ProjectOverviewDialogs.create({
        getElement: $,
        escapeHtml,
        showToast
    });

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

    async function saveProject(options = {}) {
        const opts = (options && typeof options === 'object' && !('target' in options) && !('preventDefault' in options)) ? options : {};
        const silent = Boolean(opts.silent);
        const throwOnError = Boolean(opts.throwOnError);
        const payload = collectProjectPayload();
        if (!payload.name.trim()) {
            if (!silent && window.TakeoffAnnouncement) {
                window.TakeoffAnnouncement.warning({
                    title: 'Estimate Name Required',
                    badge: 'REQUIRED FIELD',
                    content: '<p>Please enter an <strong>Estimate Name</strong> before saving the project.</p>',
                    primaryText: 'Understood'
                });
            } else if (!silent) {
                showToast('Estimate Name is required.');
            }
            if (throwOnError) {
                throw new Error('Estimate Name is required.');
            }
            return;
        }

        const saveButton = $('saveProjectBtn');
        const previousHtml = saveButton?.innerHTML;
        const previousLabel = saveButton?.textContent;
        if (saveButton) {
            saveButton.style.boxSizing = 'border-box';
            if (!saveButton.dataset.intrinsicWidth) {
                const restingWidth = Math.ceil(saveButton.getBoundingClientRect().width || 0);
                if (restingWidth > 0) {
                    saveButton.dataset.intrinsicWidth = String(restingWidth);
                }
            }
            if (saveButton.dataset.intrinsicWidth) {
                saveButton.style.minWidth = `${saveButton.dataset.intrinsicWidth}px`;
                saveButton.style.justifyContent = 'center';
            }
            saveButton.disabled = true;
            saveButton.textContent = 'Saving...';
        }

        try {
            if (typeof window.hasPendingTakeoffEstimatingSync === 'function' && window.hasPendingTakeoffEstimatingSync()
                && typeof window.flushTakeoffEstimatingSync === 'function') {
                try {
                    await window.flushTakeoffEstimatingSync();
                } catch (syncErr) {
                    console.warn('Takeoff/Estimating sync flush warning:', syncErr);
                }
            }
            try {
                const takeoffFrame = document.getElementById('takeoffFrame');
                const saveTakeoff = takeoffFrame?.contentWindow?.projectTakeoffSave;
                if (typeof saveTakeoff === 'function') {
                    await saveTakeoff.call(takeoffFrame.contentWindow);
                    takeoffFrame?.contentWindow?.clearEditorTakeoffDirtyCheckpoint?.();
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

            if (!silent && window.TakeoffAnnouncement) {
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
            if (throwOnError) {
                throw error;
            }
        } finally {
            if (saveButton) {
                saveButton.disabled = false;
                if (previousHtml) saveButton.innerHTML = previousHtml;
                else saveButton.textContent = previousLabel || 'Save Project';
            }
        }
    }

    async function persistPendingDocuments(projectId) {
        const pending = localDocuments.filter(doc => sessionFiles.has(String(doc.id)));
        let failed = 0;
        for (const doc of pending) {
            const file = sessionFiles.get(String(doc.id));
            try {
                const isDrawing = doc.category === 'Drawings' || inferCategory({ name: doc.name || file.name }, doc.category) === 'Drawings';
                const disc = isDrawing ? classifyDrawingDiscipline(doc) : null;
                const folderName = isDrawing ? `Drawings:${disc || 'general'}` : 'Attachments';
                const form = new FormData();
                form.append('project_id', projectId);
                form.append('folder_name', folderName);
                form.append('file', file, doc.name || file.name);
                const response = await fetch('../api/project_document_takeoff.php', {
                    method: 'POST', body: form, headers: { Accept: 'application/json' }
                });
                const result = await response.json().catch(() => null);
                if (!response.ok || !result?.success || !result.file?.id) {
                    throw new Error(result?.message || `HTTP ${response.status}`);
                }
                const storedId = Number(result.file.id);
                const storedName = doc.name || result.file.filename;
                if (isDrawing && disc) {
                    saveDisciplineOverride(`existing-legacy_file-${storedId}`, disc, storedId, storedName);
                }
                const stored = {
                    id: storedId, source: 'legacy_file', filename: storedName,
                    title: storedName, path: `../${result.file.filepath}`,
                    extension: doc.extension, mime_type: doc.type, uploaded_at: new Date().toISOString(),
                    pageCount: doc.pageCount || null, page_count: doc.pageCount || null, pages: doc.pages || [],
                    folder_name: result.file.folder_name || folderName
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
        'Templates': { label: 'Templates', color: '#0d9488' },
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

    function syncProjectBidBoardReturnStage(isExplicitChange = false) {
        const label = statusLabel();
        const code = currentStatus || normalizeStatus(label);
        try {
            localStorage.setItem('takeoff.bidBoardStage', label);
            sessionStorage.setItem('takeoff.bidBoardStage', label);
            if (isExplicitChange) {
                sessionStorage.setItem('takeoff.bidBoardStageOverride', JSON.stringify({
                    stage: label,
                    code,
                    projectId: Number(window.ProjectState?.projectId || 0),
                    at: Date.now()
                }));
            }
        } catch (e) { }
        try {
            const brandLink = document.getElementById('btHeaderBrandLink');
            if (brandLink) {
                brandLink.setAttribute('href', `bid_board.php?status=${encodeURIComponent(code)}`);
            }
            if (window.history && typeof window.history.replaceState === 'function') {
                const url = new URL(window.location.href);
                if (url.searchParams.has('stage') || isExplicitChange) {
                    url.searchParams.set('stage', code);
                    window.history.replaceState(null, '', url.toString());
                }
            }
        } catch (e) { }
    }

    function changeProjectStatus(status) {
        currentStatus = normalizeStatus(status);
        if (window.ProjectState?.projectInfo) {
            window.ProjectState.projectInfo.status = currentStatus;
        }
        syncProjectBidBoardReturnStage(true);
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
    let editingDirectoryCustomerId = null;
    let customerModalView = 'form';

    function setEditingDirectoryCustomer(customer = null) {
        const banner = $('pdCustomerEditBanner');
        const bannerName = $('pdCustomerEditBannerName');
        const saveBtn = $('saveCustomerBtn');
        if (customer && Number(customer.id) > 0) {
            editingDirectoryCustomerId = Number(customer.id);
            if (banner) banner.hidden = false;
            if (bannerName) bannerName.textContent = customer.company || 'Customer';
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Update Directory';
        } else {
            editingDirectoryCustomerId = null;
            if (banner) banner.hidden = true;
            if (bannerName) bannerName.textContent = '';
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-bookmark"></i> Save to Directory';
        }
    }

    function setCustomerModalView(view = 'form') {
        customerModalView = view === 'directory' ? 'directory' : 'form';
        const isDir = customerModalView === 'directory';
        const formView = $('pdCustomerFormView');
        const dirView = $('pdCustomerDirectoryView');
        const formFoot = $('pdCustomerFormFoot');
        const dirFoot = $('pdCustomerDirectoryFoot');
        const titleEl = $('customerModalTitle');
        const toggleBtn = $('openCustomerDirectoryBtn');

        if (formView) formView.hidden = isDir;
        if (formFoot) formFoot.hidden = isDir;
        if (dirView) dirView.hidden = !isDir;
        if (dirFoot) dirFoot.hidden = !isDir;
        if (titleEl) {
            titleEl.innerHTML = isDir
                ? '<i class="fas fa-address-book" style="color: var(--primary);"></i> Customer Directory'
                : '<i class="far fa-id-badge" style="color: var(--primary);"></i> Customer Information';
        }
        if (toggleBtn) {
            toggleBtn.classList.toggle('is-active', isDir);
            toggleBtn.innerHTML = isDir
                ? '<i class="fas fa-arrow-left"></i> <span>Form</span>'
                : '<i class="fas fa-address-book"></i> <span>Directory</span>';
        }
        if (isDir) {
            renderCustomerDirectory();
            setTimeout(() => $('poCustomerDirectorySearch')?.focus(), 40);
        }
    }

    function renderCustomerDirectory() {
        const listEl = $('poCustomerDirectoryList');
        const countEl = $('poCustomerDirectoryCount');
        if (!listEl) return;
        const query = ($('poCustomerDirectorySearch')?.value || '').trim().toLowerCase();
        const canMutateDir = window.TakeoffAuth
            ? window.TakeoffAuth.canWrite === true
            : !document.body?.dataset?.readOnly;

        const filtered = savedCustomers
            .map((customer, index) => ({ customer, index }))
            .filter(({ customer }) => {
                if (!query) return true;
                const haystack = [
                    customer.company,
                    customer.contact_name,
                    customer.phone,
                    customer.email,
                    customer.address
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(query);
            });

        if (countEl) {
            countEl.textContent = `${filtered.length} customer${filtered.length === 1 ? '' : 's'}`;
        }

        if (!filtered.length) {
            listEl.innerHTML = savedCustomers.length
                ? '<div class="pd-customer-dir-empty">No customers match your search.</div>'
                : '<div class="pd-customer-dir-empty">No saved customers in directory yet.</div>';
            return;
        }

        listEl.innerHTML = filtered.map(({ customer, index }) => {
            const dbId = Number(customer.id || 0);
            const hasDbId = dbId > 0;
            const company = escapeHtml(customer.company || 'Unnamed Customer');
            const badge = hasDbId
                ? '<span class="pd-customer-dir-badge">Saved</span>'
                : '<span class="pd-customer-dir-badge is-project">Project</span>';
            const metaParts = [];
            if (customer.contact_name) metaParts.push(`<span><i class="far fa-user"></i> ${escapeHtml(customer.contact_name)}</span>`);
            if (customer.phone) metaParts.push(`<span><i class="fas fa-phone"></i> ${escapeHtml(customer.phone)}</span>`);
            if (customer.email) metaParts.push(`<span><i class="far fa-envelope"></i> ${escapeHtml(customer.email)}</span>`);
            if (customer.address) metaParts.push(`<span><i class="fas fa-location-dot"></i> ${escapeHtml(customer.address)}</span>`);
            const metaHtml = metaParts.length
                ? metaParts.join('')
                : '<span>No contact details stored</span>';

            return `
                <div class="pd-customer-dir-card" data-dir-row="${index}">
                    <div class="pd-customer-dir-info">
                        <div class="pd-customer-dir-title-row">
                            <span class="pd-customer-dir-company">${company}</span>
                            ${badge}
                        </div>
                        <div class="pd-customer-dir-meta">${metaHtml}</div>
                    </div>
                    <div class="pd-customer-dir-actions">
                        <button type="button" class="pd-customer-dir-btn" data-dir-use="${index}" title="Use this customer for the project">
                            <i class="fas fa-check"></i> Select
                        </button>
                        ${canMutateDir ? `
                            <button type="button" class="pd-customer-dir-btn" data-dir-edit="${index}" title="${hasDbId ? 'Edit directory customer' : 'Edit & save to directory'}">
                                <i class="fas fa-pen"></i>
                            </button>
                            ${hasDbId ? `
                                <button type="button" class="pd-customer-dir-btn is-danger" data-dir-delete="${dbId}" title="Delete from customer directory">
                                    <i class="fas fa-trash-can"></i>
                                </button>
                            ` : ''}
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    async function deleteDirectoryCustomer(customerId) {
        const targetId = Number(customerId || 0);
        if (targetId <= 0) return;
        const target = savedCustomers.find(c => Number(c.id || 0) === targetId);
        const safeCompany = escapeHtml(target?.company || `Customer #${targetId}`);
        const confirmed = typeof window.showConfirmDialog === 'function'
            ? await window.showConfirmDialog({
                title: 'Delete Customer',
                message: `Are you sure you want to remove <strong>"${safeCompany}"</strong> from the Customer Directory? Existing projects will keep their copied customer fields.`,
                confirmText: 'Delete Customer',
                cancelText: 'Cancel',
                type: 'error',
                badge: 'DELETE',
                icon: 'fas fa-trash',
                primaryDanger: true
            })
            : window.confirm(`Delete "${target?.company || targetId}" from directory?`);
        if (!confirmed) return;

        try {
            const res = await fetch('../api/customers.php?action=delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: targetId })
            });
            const data = await res.json();
            if (data?.status === 'success') {
                if (Array.isArray(data.customers)) {
                    savedCustomers = data.customers;
                } else {
                    savedCustomers = savedCustomers.filter(c => Number(c.id || 0) !== targetId);
                }
                if (editingDirectoryCustomerId === targetId) {
                    setEditingDirectoryCustomer(null);
                }
                populateCustomerSelector();
                renderCustomerDirectory();
                showToast(`Customer "${target?.company || targetId}" removed from directory.`);
            } else {
                showToast(data?.msg || 'Failed to delete customer.');
            }
        } catch (e) {
            showToast('Error deleting customer from directory.');
        }
    }

    async function loadCustomersDirectory() {
        const selector = $('poCustomerSelector');
        if (!selector) return;
        try {
            const res = await fetch('../api/customers.php?action=list');
            const data = await res.json();
            if (data?.status === 'success' && Array.isArray(data.data)) {
                savedCustomers = data.data;
                populateCustomerSelector();
                if (customerModalView === 'directory') renderCustomerDirectory();
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

    function selectCustomerByIndex(index, { editDirectory = false } = {}) {
        const c = savedCustomers[index];
        if (!c) return;
        if ($('poCustomerCompany')) $('poCustomerCompany').value = c.company || '';
        if ($('poPrimaryContact')) $('poPrimaryContact').value = c.contact_name || '';
        if ($('poCustomerPhone')) $('poCustomerPhone').value = c.phone || '';
        if ($('poCustomerEmail')) $('poCustomerEmail').value = c.email || '';
        if ($('poCustomerAddress')) $('poCustomerAddress').value = c.address || '';
        if (editDirectory) {
            setEditingDirectoryCustomer(Number(c.id || 0) > 0 ? c : null);
        } else {
            setEditingDirectoryCustomer(null);
        }
        syncCustomerDisplayCard();
        markDirty();
        renderProjectHeaderMeta();
        populateCustomerSelector(c.company || '');
        if (!editDirectory) {
            showToast(`Customer "${c.company}" selected.`);
        }
    }

    function clearCustomerFields() {
        setEditingDirectoryCustomer(null);
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
        const wasEditing = editingDirectoryCustomerId > 0;
        const payload = {
            id: wasEditing ? editingDirectoryCustomerId : null,
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
                    const existingIdx = savedCustomers.findIndex(c => Number(c.id || 0) === Number(data.data.id || -1) || c.company.toLowerCase() === company.toLowerCase());
                    if (existingIdx >= 0) savedCustomers[existingIdx] = data.data;
                    else savedCustomers.push(data.data);
                }
                setEditingDirectoryCustomer(null);
                populateCustomerSelector(data.data?.company || company);
                if (customerModalView === 'directory') renderCustomerDirectory();
                showToast(wasEditing ? `Customer "${company}" updated in directory!` : `Customer "${company}" saved to directory!`);
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
        const company = $('poCustomerCompany')?.value?.trim() || '';
        const contact = $('poPrimaryContact')?.value?.trim() || '';
        const phone = $('poCustomerPhone')?.value?.trim() || '';
        const email = $('poCustomerEmail')?.value?.trim() || '';
        const address = $('poCustomerAddress')?.value?.trim() || '';
        const projectAddress = $('poProjectAddress')?.value?.trim() || '';
        const hasCustomer = !!(company || contact);

        const customerFilledRow = $('customerFilledRow');
        const addCustomerBtn = $('addCustomerBtn');
        if (customerFilledRow && addCustomerBtn) {
            if (hasCustomer) {
                customerFilledRow.style.display = 'flex';
                addCustomerBtn.style.display = 'none';
            } else {
                customerFilledRow.style.display = 'none';
                addCustomerBtn.style.display = 'flex';
            }
        }

        const avatar = $('customerAvatarLetter');
        const initial = (company || contact || 'C').trim().charAt(0).toUpperCase() || 'C';
        if (avatar) avatar.textContent = initial;

        const displayComp = $('displayCustomerCompany');
        if (displayComp) displayComp.textContent = company || contact || 'Customer';

        const displayContactSummary = $('displayContactSummary');
        if (displayContactSummary) {
            const parts = [contact, phone, email].filter(Boolean);
            if (!parts.length && address) parts.push(address);
            displayContactSummary.textContent = parts.join(', ') || (company ? 'No contact details added' : '');
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
                        <div class="pd-task-meta-row">
                            <div class="pd-task-assignee">For ${escapeHtml(task.responsible || 'Isaac De Jesús')}</div>
                            ${dueText ? `<div class="pd-task-due-badge">${escapeHtml(dueText)}</div>` : ''}
                        </div>
                    </div>
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

        const isOpen = menu.style.display === 'flex' && contextMenuTarget?.type === type && contextMenuTarget?.index === index;
        closeItemContextMenu();
        if (isOpen) return;

        contextMenuTarget = { type, index };
        const rect = button.getBoundingClientRect();
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;

        menu.__trigger = button;
        button.classList.add('is-active');
        button.setAttribute('aria-expanded', 'true');
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
            'takeoff.docDisciplines',
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
        if (forcedCategory) {
            const norm = String(forcedCategory).trim();
            if (norm === 'Drawings' || norm.startsWith('Drawings:')) return 'Drawings';
            if (norm === 'Attachments') return 'Attachments';
        }
        const ext = String((file?.name || '').split('.').pop() || '').toLowerCase();
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

    window.__SharedPdfDocCache = window.__SharedPdfDocCache || new Map();
    window.__SharedPdfThumbCache = window.__SharedPdfThumbCache || new Map();
    const sharedPdfDocCache = window.__SharedPdfDocCache;
    const sharedPdfThumbCache = window.__SharedPdfThumbCache;
    const imageThumbnailUrlCache = new Map();
    const imageThumbnailPromises = new Map();
    const MAX_SHARED_THUMB_URLS = 240;
    const THUMB_TARGET_WIDTH = 320;
    const THUMB_JPEG_QUALITY = 0.85;
    const pdfLoadingPromises = new Map();
    let activePriorityThumbRenders = 0;
    let documentsNeedsRenderOnTabEnter = false;

    function isDocumentsTabActive() {
        if (document.hidden) return false;
        if (window.ProjectState?.activeTab) {
            return window.ProjectState.activeTab === 'documents';
        }
        const tabPanel = document.getElementById('tab-documents');
        if (tabPanel) {
            return tabPanel.classList.contains('active') && !tabPanel.hidden;
        }
        return document.body.classList.contains('is-documents-tab');
    }

    function getDocCacheKeys(doc) {
        if (!doc) return [];
        const keys = [String(doc.id)];
        if (doc.backendId) keys.push(String(doc.backendId));
        if (doc.path) keys.push(String(doc.path));
        return keys;
    }

    function getPersistentThumbKey(doc, pageNumber = 1) {
        if (!doc) return '';
        const p = Number(pageNumber) || 1;
        const base = doc.path || (doc.backendId ? `backend:${doc.backendId}` : `doc:${doc.id}`);
        return `${base}:p${p}:w${THUMB_TARGET_WIDTH}`;
    }

    function getCachedSheetThumbUrl(doc, pageNumber = 1) {
        if (!doc) return null;
        const p = Number(pageNumber) || 1;
        for (const k of getDocCacheKeys(doc)) {
            const key = `${k}:${p}`;
            if (sharedPdfThumbCache.has(key)) return sharedPdfThumbCache.get(key);
        }
        const legacyKey = `${doc.id}_p${p}`;
        if (sharedPdfThumbCache.has(legacyKey)) return sharedPdfThumbCache.get(legacyKey);
        return null;
    }

    function storeCachedSheetThumbUrl(doc, pageNumber, dataUrl) {
        if (!doc || !dataUrl) return;
        const p = Number(pageNumber) || 1;
        const keys = getDocCacheKeys(doc).map(k => `${k}:${p}`);
        keys.push(`${doc.id}_p${p}`);
        keys.forEach(key => {
            if (sharedPdfThumbCache.has(key)) sharedPdfThumbCache.delete(key);
            sharedPdfThumbCache.set(key, dataUrl);
        });
        while (sharedPdfThumbCache.size > MAX_SHARED_THUMB_URLS) {
            const oldest = sharedPdfThumbCache.keys().next().value;
            sharedPdfThumbCache.delete(oldest);
        }
    }

    // IndexedDB persistent cache for rendered blueprint thumbnails (instant reload without re-rendering PDF)
    let thumbIdbPromise = null;
    function openThumbIdb() {
        if (thumbIdbPromise) return thumbIdbPromise;
        if (typeof indexedDB === 'undefined') return Promise.resolve(null);
        thumbIdbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open('takeoff_pdf_thumbs_v2', 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('thumbs')) {
                        db.createObjectStore('thumbs');
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (_) {
                resolve(null);
            }
        });
        return thumbIdbPromise;
    }

    async function getPersistedThumbBlobUrl(doc, pageNumber = 1) {
        const key = getPersistentThumbKey(doc, pageNumber);
        if (!key) return null;
        const db = await openThumbIdb();
        if (!db) return null;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction('thumbs', 'readonly');
                const store = tx.objectStore('thumbs');
                const req = store.get(key);
                req.onsuccess = () => {
                    const val = req.result;
                    if (val instanceof Blob) {
                        const blobUrl = URL.createObjectURL(val);
                        storeCachedSheetThumbUrl(doc, pageNumber, blobUrl);
                        resolve(blobUrl);
                    } else if (typeof val === 'string' && val.startsWith('data:image/')) {
                        storeCachedSheetThumbUrl(doc, pageNumber, val);
                        resolve(val);
                    } else {
                        resolve(null);
                    }
                };
                req.onerror = () => resolve(null);
            } catch (_) {
                resolve(null);
            }
        });
    }

    async function savePersistedThumbBlob(doc, pageNumber, blobOrDataUrl) {
        const key = getPersistentThumbKey(doc, pageNumber);
        if (!key || !blobOrDataUrl) return;
        const db = await openThumbIdb();
        if (!db) return;
        try {
            const tx = db.transaction('thumbs', 'readwrite');
            tx.objectStore('thumbs').put(blobOrDataUrl, key);
        } catch (_) {}
    }

    // Dedicated Background Web Worker for PDF Thumbnail Rasterization & Page Count (OffscreenCanvas)
    let pdfThumbWorker = null;
    let pdfThumbWorkerUnsupported = false;
    let pdfWorkerReqSeq = 0;
    const pdfWorkerPending = new Map();

    function getPdfThumbWorker() {
        if (pdfThumbWorkerUnsupported) return null;
        if (pdfThumbWorker) return pdfThumbWorker;
        if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
            pdfThumbWorkerUnsupported = true;
            return null;
        }
        try {
            const workerCode = `
                self.window = self;
                function makeOffscreenCanvas(w, h) {
                    const c = new OffscreenCanvas(Math.max(1, w || 1), Math.max(1, h || 1));
                    if (!c.style) c.style = {};
                    c.remove = function() {};
                    c.getAttribute = function() { return null; };
                    c.setAttribute = function() {};
                    return c;
                }
                self.document = {
                    createElement: function(tag) {
                        if (String(tag).toLowerCase() === 'canvas') return makeOffscreenCanvas(1, 1);
                        return { style: {}, setAttribute: function(){}, getAttribute: function(){ return null; }, appendChild: function(){} };
                    },
                    createElementNS: function(ns, tag) {
                        if (String(tag).toLowerCase() === 'canvas') return makeOffscreenCanvas(1, 1);
                        return { style: {}, setAttribute: function(){}, getAttribute: function(){ return null; } };
                    },
                    head: { appendChild: function(){} },
                    body: { appendChild: function(){} },
                    documentElement: { style: {} },
                    currentScript: null
                };

                class WorkerOffscreenCanvasFactory {
                    create(width, height) {
                        const canvas = makeOffscreenCanvas(width, height);
                        const context = canvas.getContext('2d', { alpha: false });
                        return { canvas, context };
                    }
                    reset(canvasAndContext, width, height) {
                        if (!canvasAndContext || !canvasAndContext.canvas) return;
                        canvasAndContext.canvas.width = Math.max(1, width);
                        canvasAndContext.canvas.height = Math.max(1, height);
                    }
                    destroy(canvasAndContext) {
                        if (!canvasAndContext || !canvasAndContext.canvas) return;
                        canvasAndContext.canvas.width = 0;
                        canvasAndContext.canvas.height = 0;
                        canvasAndContext.canvas = null;
                        canvasAndContext.context = null;
                    }
                }

                let pdfjsReady = false;
                try {
                    importScripts(
                        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js',
                        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'
                    );
                    if (self.pdfjsLib) {
                        self.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                        pdfjsReady = true;
                    }
                } catch (err) {
                    pdfjsReady = false;
                }

                const pdfCache = new Map();
                const pdfLoading = new Map();
                const canvasFactory = new WorkerOffscreenCanvasFactory();
                let isPaused = false;
                let minValidToken = 0;
                const jobQueue = [];
                let isProcessing = false;

                async function getWorkerPdf(docKey, url, buffer) {
                    if (pdfCache.has(docKey)) return pdfCache.get(docKey);
                    if (pdfLoading.has(docKey)) return pdfLoading.get(docKey);
                    const p = (async () => {
                        try {
                            const params = buffer
                                ? { data: new Uint8Array(buffer), disableAutoFetch: true, disableStream: false, isEvalSupported: false, canvasFactory }
                                : { url, rangeChunkSize: 262144, disableAutoFetch: true, disableStream: false, isEvalSupported: false, canvasFactory };
                            const pdf = await self.pdfjsLib.getDocument(params).promise;
                            pdfCache.set(docKey, pdf);
                            while (pdfCache.size > 6) {
                                const oldestKey = pdfCache.keys().next().value;
                                const oldPdf = pdfCache.get(oldestKey);
                                pdfCache.delete(oldestKey);
                                if (oldPdf && typeof oldPdf.cleanup === 'function') {
                                    try { oldPdf.cleanup(); } catch (_) {}
                                }
                            }
                            return pdf;
                        } finally {
                            pdfLoading.delete(docKey);
                        }
                    })();
                    pdfLoading.set(docKey, p);
                    return p;
                }

                async function processNextJob() {
                    if (isProcessing || !jobQueue.length) return;
                    isProcessing = true;
                    while (jobQueue.length > 0) {
                        const job = jobQueue.shift();
                        if (!job) continue;
                        const isTakeoffJob = job.scope === 'takeoff';
                        if (!isTakeoffJob && isPaused) {
                            self.postMessage({ reqId: job.reqId, ok: false, cancelled: true });
                            continue;
                        }
                        if (!isTakeoffJob && job.token && job.token < minValidToken) {
                            self.postMessage({ reqId: job.reqId, ok: false, cancelled: true });
                            continue;
                        }
                        if (!pdfjsReady) {
                            self.postMessage({ reqId: job.reqId, ok: false, unsupported: true });
                            continue;
                        }
                        try {
                            const pdf = await getWorkerPdf(job.docKey, job.url, job.buffer);
                            if (!isTakeoffJob && (isPaused || (job.token && job.token < minValidToken))) {
                                self.postMessage({ reqId: job.reqId, ok: false, cancelled: true });
                                continue;
                            }
                            if (job.type === 'pageCount') {
                                self.postMessage({ reqId: job.reqId, ok: true, numPages: pdf ? pdf.numPages : 0 });
                                continue;
                            }
                            if (job.type === 'renderThumb') {
                                const page = await pdf.getPage(job.pageNumber || 1);
                                if (!isTakeoffJob && (isPaused || (job.token && job.token < minValidToken))) {
                                    try { page.cleanup(); } catch (_) {}
                                    self.postMessage({ reqId: job.reqId, ok: false, cancelled: true });
                                    continue;
                                }
                                const unscaled = page.getViewport({ scale: 1.0 });
                                const targetWidth = job.targetWidth || 320;
                                const scale = Math.min(0.45, Math.max(0.15, targetWidth / (unscaled.width || 1000)));
                                const viewport = page.getViewport({ scale });
                                const w = Math.max(1, Math.round(viewport.width));
                                const h = Math.max(1, Math.round(viewport.height));
                                const offscreen = makeOffscreenCanvas(w, h);
                                const ctx = offscreen.getContext('2d', { alpha: false });
                                ctx.fillStyle = '#ffffff';
                                ctx.fillRect(0, 0, w, h);
                                await page.render({ canvasContext: ctx, viewport, canvasFactory }).promise;
                                try { page.cleanup(); } catch (_) {}
                                const blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: job.quality || 0.85 });
                                self.postMessage({
                                    reqId: job.reqId,
                                    ok: true,
                                    blob,
                                    numPages: pdf.numPages
                                });
                            }
                        } catch (err) {
                            self.postMessage({ reqId: job.reqId, ok: false, error: String(err && err.message || err) });
                        }
                        await new Promise(r => setTimeout(r, 15));
                    }
                    isProcessing = false;
                }

                self.onmessage = function(e) {
                    const msg = e.data || {};
                    if (msg.type === 'pause') {
                        isPaused = true;
                        if (typeof msg.token === 'number') minValidToken = msg.token;
                        for (let i = jobQueue.length - 1; i >= 0; i--) {
                            if (jobQueue[i].scope !== 'takeoff') {
                                const dropped = jobQueue.splice(i, 1)[0];
                                if (dropped && dropped.reqId) {
                                    self.postMessage({ reqId: dropped.reqId, ok: false, cancelled: true });
                                }
                            }
                        }
                        return;
                    }
                    if (msg.type === 'clearTakeoff') {
                        for (let i = jobQueue.length - 1; i >= 0; i--) {
                            if (jobQueue[i].scope === 'takeoff') {
                                const dropped = jobQueue.splice(i, 1)[0];
                                if (dropped && dropped.reqId) {
                                    self.postMessage({ reqId: dropped.reqId, ok: false, cancelled: true });
                                }
                            }
                        }
                        return;
                    }
                    if (msg.type === 'resume') {
                        isPaused = false;
                        processNextJob();
                        return;
                    }
                    if (msg.type === 'clearToken') {
                        if (typeof msg.token === 'number') minValidToken = msg.token;
                        for (let i = jobQueue.length - 1; i >= 0; i--) {
                            if (jobQueue[i].scope !== 'takeoff' && jobQueue[i].token && jobQueue[i].token < minValidToken) {
                                const dropped = jobQueue.splice(i, 1)[0];
                                if (dropped && dropped.reqId) {
                                    self.postMessage({ reqId: dropped.reqId, ok: false, cancelled: true });
                                }
                            }
                        }
                        return;
                    }
                    if (msg.type === 'renderThumb') {
                        if (msg.scope === 'takeoff') {
                            // Replace any queued takeoff preview render so only the latest hovered sheet renders
                            for (let i = jobQueue.length - 1; i >= 0; i--) {
                                if (jobQueue[i].scope === 'takeoff' && jobQueue[i].type === 'renderThumb') {
                                    const dropped = jobQueue.splice(i, 1)[0];
                                    if (dropped && dropped.reqId) {
                                        self.postMessage({ reqId: dropped.reqId, ok: false, cancelled: true });
                                    }
                                }
                            }
                            jobQueue.unshift(msg);
                            processNextJob();
                            return;
                        }
                        // Prioritize visible thumbnail renders at the front of the queue before background pageCount jobs
                        let insertIdx = jobQueue.findIndex(j => j.type === 'pageCount');
                        if (insertIdx === -1) jobQueue.push(msg);
                        else jobQueue.splice(insertIdx, 0, msg);
                        processNextJob();
                        return;
                    }
                    if (msg.type === 'pageCount') {
                        jobQueue.push(msg);
                        processNextJob();
                        return;
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            pdfThumbWorker = new Worker(workerUrl);
            pdfThumbWorker.onmessage = (e) => {
                const data = e.data || {};
                if (!data.reqId || !pdfWorkerPending.has(data.reqId)) return;
                const { resolve } = pdfWorkerPending.get(data.reqId);
                pdfWorkerPending.delete(data.reqId);
                if (data.unsupported) {
                    pdfThumbWorkerUnsupported = true;
                }
                resolve(data);
            };
            pdfThumbWorker.onerror = () => {
                pdfThumbWorkerUnsupported = true;
                pdfWorkerPending.forEach(({ resolve }) => resolve({ ok: false, unsupported: true }));
                pdfWorkerPending.clear();
            };
            return pdfThumbWorker;
        } catch (_) {
            pdfThumbWorkerUnsupported = true;
            return null;
        }
    }

    async function callPdfThumbWorker(payload) {
        const worker = getPdfThumbWorker();
        if (!worker) return { ok: false, unsupported: true };
        const reqId = ++pdfWorkerReqSeq;
        return new Promise((resolve) => {
            pdfWorkerPending.set(reqId, { resolve });
            worker.postMessage({ ...payload, reqId });
        });
    }

    async function buildWorkerDocPayload(doc) {
        const rawPath = doc.path || doc.fileUrl || '';
        const docKey = String(doc.backendId || rawPath || doc.id);
        let absUrl = '';
        let buffer = null;
        const file = sessionFiles.get(String(doc.id));
        if (file) {
            buffer = await file.arrayBuffer();
        } else if (rawPath) {
            try {
                absUrl = new URL(rawPath, window.location.href).href;
            } catch (_) {
                absUrl = rawPath;
            }
        }
        return { docKey, url: absUrl, buffer };
    }

    window.__TakeoffThumbService = {
        getCachedThumbUrl(doc, pageNumber = 1) {
            if (!doc) return null;
            return getCachedSheetThumbUrl({ id: doc.id, backendId: doc.id, path: doc.fileUrl || doc.path }, pageNumber);
        },
        async getPersistedThumbUrl(doc, pageNumber = 1) {
            if (!doc) return null;
            return getPersistedThumbBlobUrl({ id: doc.id, backendId: doc.id, path: doc.fileUrl || doc.path }, pageNumber);
        },
        async renderPreviewThumb(doc, pageNumber = 1) {
            if (!doc || pdfThumbWorkerUnsupported) return null;
            const normDoc = { id: doc.id, backendId: doc.id, path: doc.fileUrl || doc.path };
            const workerDoc = await buildWorkerDocPayload(normDoc);
            if (!workerDoc.url && !workerDoc.buffer) return null;
            const res = await callPdfThumbWorker({
                type: 'renderThumb',
                scope: 'takeoff',
                docKey: workerDoc.docKey,
                url: workerDoc.url,
                buffer: workerDoc.buffer,
                pageNumber: Number(pageNumber) || 1,
                targetWidth: THUMB_TARGET_WIDTH,
                quality: THUMB_JPEG_QUALITY
            });
            if (res && res.ok && res.blob) {
                const blobUrl = URL.createObjectURL(res.blob);
                storeCachedSheetThumbUrl(normDoc, pageNumber, blobUrl);
                savePersistedThumbBlob(normDoc, pageNumber, res.blob);
                return { url: blobUrl, numPages: res.numPages };
            }
            return null;
        },
        async getPageCount(doc) {
            if (!doc || pdfThumbWorkerUnsupported) return 0;
            const normDoc = { id: doc.id, backendId: doc.id, path: doc.fileUrl || doc.path };
            const workerDoc = await buildWorkerDocPayload(normDoc);
            if (!workerDoc.url && !workerDoc.buffer) return 0;
            const res = await callPdfThumbWorker({
                type: 'pageCount',
                scope: 'takeoff',
                docKey: workerDoc.docKey,
                url: workerDoc.url,
                buffer: workerDoc.buffer
            });
            return (res && res.ok && res.numPages > 0) ? Number(res.numPages) : 0;
        },
        cancelTakeoffJobs() {
            if (pdfThumbWorker) {
                try { pdfThumbWorker.postMessage({ type: 'clearTakeoff' }); } catch (_) {}
            }
        }
    };

    function waitForIdleSlice(timeoutMs = 180) {
        return new Promise((resolve) => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
            } else {
                setTimeout(resolve, 32);
            }
        });
    }

    async function loadPdfDocument(doc) {
        if (!window.pdfjsLib || !doc) return null;
        const docKey = String(doc.id);
        if (pdfDocumentCache.has(doc.id)) return pdfDocumentCache.get(doc.id);
        if (pdfDocumentCache.has(docKey)) return pdfDocumentCache.get(docKey);
        for (const k of getDocCacheKeys(doc)) {
            if (sharedPdfDocCache.has(k)) {
                const cached = sharedPdfDocCache.get(k);
                pdfDocumentCache.set(doc.id, cached);
                pdfDocumentCache.set(docKey, cached);
                return cached;
            }
        }
        if (pdfLoadingPromises.has(docKey)) return pdfLoadingPromises.get(docKey);

        const loadPromise = (async () => {
            try {
                let pdf = null;
                const file = sessionFiles.get(docKey);
                if (file) {
                    const arrayBuffer = await file.arrayBuffer();
                    pdf = await window.pdfjsLib.getDocument({
                        data: new Uint8Array(arrayBuffer),
                        disableAutoFetch: true,
                        disableStream: false
                    }).promise;
                } else if (doc.path) {
                    pdf = await window.pdfjsLib.getDocument({
                        url: doc.path,
                        rangeChunkSize: 262144,
                        disableAutoFetch: true,
                        disableStream: false
                    }).promise;
                }
                if (pdf) {
                    pdfDocumentCache.set(doc.id, pdf);
                    pdfDocumentCache.set(docKey, pdf);
                    getDocCacheKeys(doc).forEach(k => sharedPdfDocCache.set(k, pdf));
                    return pdf;
                }
            } catch (e) {
                console.warn('PDF load failed for doc', doc.id, e);
            } finally {
                pdfLoadingPromises.delete(docKey);
            }
            return null;
        })();

        pdfLoadingPromises.set(docKey, loadPromise);
        return loadPromise;
    }

    const pdfThumbnailDataCache = new Map();
    let currentThumbnailObserver = null;
    let sheetRenderToken = 0;
    let documentsContentRenderSeq = 0;

    function cleanupThumbnailObserver() {
        sheetRenderToken++;
        if (currentThumbnailObserver) {
            currentThumbnailObserver.disconnect();
            currentThumbnailObserver = null;
        }
        if (pdfThumbWorker) {
            try {
                pdfThumbWorker.postMessage({ type: 'clearToken', token: sheetRenderToken });
            } catch (_) {}
        }
    }

    function pauseDocumentsBackgroundWork() {
        cleanupThumbnailObserver();
        if (pdfThumbWorker) {
            try {
                pdfThumbWorker.postMessage({ type: 'pause', token: sheetRenderToken });
            } catch (_) {}
        }
    }

    window.onDocumentsTabVisibilityChange = function (isActive) {
        if (!isActive) {
            pauseDocumentsBackgroundWork();
            return;
        }
        if (pdfThumbWorker) {
            try {
                pdfThumbWorker.postMessage({ type: 'resume' });
            } catch (_) {}
        }
        if (documentsNeedsRenderOnTabEnter) {
            documentsNeedsRenderOnTabEnter = false;
            renderDocumentsPage();
            return;
        }
        // Resume page counts and any visible sheet/attachment thumbnails when returning to Documents tab
        const drawings = drawingDocuments();
        drawings.forEach(doc => {
            if (doc.extension === 'pdf' && (!doc.pageCount || doc.pageCount <= 0)) {
                enqueuePdfPageCount(doc);
            }
        });
        processPdfPageCountQueue();
        if (selectedDocumentsFolder.startsWith('document:')) {
            const docId = selectedDocumentsFolder.replace('document:', '');
            const doc = allDocumentRows().find(r => r.id === docId);
            if (doc && Array.isArray(doc.pages) && doc.pages.length) {
                renderSheetThumbnails(doc, doc.pages);
            }
        } else if (selectedDocumentsFolder === 'attachments') {
            renderAttachmentThumbnails(sortedDocuments(filteredDocuments(attachmentDocuments())));
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            pauseDocumentsBackgroundWork();
        } else if (isDocumentsTabActive()) {
            window.onDocumentsTabVisibilityChange?.(true);
        }
    });

    async function renderSheetThumbnails(doc, sheets) {
        cleanupThumbnailObserver();
        if (!doc || !isDocumentsTabActive()) return;
        const token = sheetRenderToken;

        const renderQueue = [];
        const queuedSheetIds = new Set();
        let isRendering = false;

        const processQueue = async () => {
            if (token !== sheetRenderToken || !isDocumentsTabActive()) return;
            if (isRendering || !renderQueue.length) return;
            isRendering = true;
            activePriorityThumbRenders++;
            const item = renderQueue.shift();
            try {
                await renderSingleSheetThumbnail(null, doc, item.sheet, token);
            } catch (err) {
                console.warn('Thumbnail render error:', err);
            } finally {
                activePriorityThumbRenders = Math.max(0, activePriorityThumbRenders - 1);
                isRendering = false;
                if (token === sheetRenderToken && isDocumentsTabActive() && renderQueue.length) {
                    setTimeout(processQueue, 24);
                }
            }
        };

        const enqueueSheet = (sheet) => {
            if (!sheet || queuedSheetIds.has(sheet.id) || !isDocumentsTabActive()) return;
            const cId = cleanId(sheet.id);
            const cachedUrl = getCachedSheetThumbUrl(doc, sheet.pageNumber || 1);
            if (cachedUrl) {
                applySheetThumbDataUrlToDom(cId, cachedUrl, sheet.name);
                return;
            }
            queuedSheetIds.add(sheet.id);
            renderQueue.push({ sheet });
            processQueue();
        };

        if (window.IntersectionObserver) {
            currentThumbnailObserver = new IntersectionObserver((entries, obs) => {
                if (token !== sheetRenderToken || !isDocumentsTabActive()) return;
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const row = entry.target;
                        obs.unobserve(row);
                        const sheetId = row.dataset.docSheetId;
                        const sheet = sheets.find(s => s.id === sheetId);
                        if (sheet) enqueueSheet(sheet);
                    }
                });
            }, {
                root: document.getElementById('documentsList'),
                rootMargin: '140px 0px 140px 0px',
                threshold: 0.01
            });

            document.querySelectorAll('.doc-list-item-row[data-doc-sheet-id]').forEach(row => {
                currentThumbnailObserver.observe(row);
            });
        } else {
            for (const sheet of sheets.slice(0, 6)) {
                if (token !== sheetRenderToken || !isDocumentsTabActive()) break;
                enqueueSheet(sheet);
            }
        }
    }

    function applySheetThumbDataUrlToDom(cId, dataUrl, altText) {
        const canvas = document.getElementById(`canvas-${cId}`);
        const bpFallback = document.getElementById(`bp-${cId}`);
        let imgEl = document.getElementById(`img-${cId}`);
        if (!imgEl && canvas && canvas.parentNode) {
            imgEl = document.createElement('img');
            imgEl.id = `img-${cId}`;
            imgEl.className = 'doc-sheet-canvas';
            imgEl.loading = 'lazy';
            imgEl.decoding = 'async';
            imgEl.alt = altText || '';
            canvas.parentNode.insertBefore(imgEl, canvas);
        }
        if (imgEl) {
            imgEl.src = dataUrl;
            imgEl.style.display = 'block';
        }
        if (canvas) canvas.style.display = 'none';
        if (bpFallback) bpFallback.style.display = 'none';
    }

    async function renderSingleSheetThumbnail(pdf, doc, sheet, token = sheetRenderToken) {
        if (token !== sheetRenderToken || !isDocumentsTabActive()) return;
        const cId = cleanId(sheet.id);
        const pageNum = sheet.pageNumber || 1;

        // 1. Check in-memory cache (0ms)
        const cachedUrl = getCachedSheetThumbUrl(doc, pageNum);
        if (cachedUrl) {
            applySheetThumbDataUrlToDom(cId, cachedUrl, sheet.name);
            return;
        }

        // 2. Check IndexedDB persistent cache (~1ms, zero PDF parsing/rendering)
        const persistedUrl = await getPersistedThumbBlobUrl(doc, pageNum);
        if (token !== sheetRenderToken || !isDocumentsTabActive()) return;
        if (persistedUrl) {
            applySheetThumbDataUrlToDom(cId, persistedUrl, sheet.name);
            return;
        }

        const canvas = document.getElementById(`canvas-${cId}`);
        const bpFallback = document.getElementById(`bp-${cId}`);
        if (!canvas && !bpFallback) return;

        const bpIcon = bpFallback?.querySelector('i');
        if (bpIcon) bpIcon.className = 'fas fa-circle-notch fa-spin doc-thumb-spinner';

        // 3. Render in Dedicated Background Web Worker (OffscreenCanvas) so main UI thread never lags
        if (!pdfThumbWorkerUnsupported) {
            try {
                const workerDoc = await buildWorkerDocPayload(doc);
                if (token !== sheetRenderToken || !isDocumentsTabActive()) return;
                if (workerDoc.url || workerDoc.buffer) {
                    const res = await callPdfThumbWorker({
                        type: 'renderThumb',
                        token,
                        docKey: workerDoc.docKey,
                        url: workerDoc.url,
                        buffer: workerDoc.buffer,
                        pageNumber: pageNum,
                        targetWidth: THUMB_TARGET_WIDTH,
                        quality: THUMB_JPEG_QUALITY
                    });
                    if (token !== sheetRenderToken || !isDocumentsTabActive() || res.cancelled) {
                        if (bpIcon) bpIcon.className = 'fas fa-drafting-compass';
                        return;
                    }
                    if (res.ok && res.blob) {
                        const blobUrl = URL.createObjectURL(res.blob);
                        storeCachedSheetThumbUrl(doc, pageNum, blobUrl);
                        savePersistedThumbBlob(doc, pageNum, res.blob);
                        applySheetThumbDataUrlToDom(cId, blobUrl, sheet.name);
                        return;
                    }
                }
            } catch (_) {}
        }

        // 4. Fallback for older browsers without OffscreenCanvas Worker: low-priority idle slice + async toBlob
        try {
            await waitForIdleSlice(220);
            if (token !== sheetRenderToken || !isDocumentsTabActive()) return;
            const activePdf = pdf || await loadPdfDocument(doc);
            if (!activePdf || token !== sheetRenderToken || !isDocumentsTabActive()) return;
            const page = await activePdf.getPage(pageNum);
            if (token !== sheetRenderToken || !isDocumentsTabActive()) {
                try { page.cleanup(); } catch (_) {}
                return;
            }
            const unscaled = page.getViewport({ scale: 1.0 });
            const scale = Math.min(0.42, Math.max(0.15, THUMB_TARGET_WIDTH / (unscaled.width || 1000)));
            const viewport = page.getViewport({ scale });

            if (!canvas) return;
            canvas.width = Math.max(1, Math.round(viewport.width));
            canvas.height = Math.max(1, Math.round(viewport.height));
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await waitForIdleSlice(180);
            if (token !== sheetRenderToken || !isDocumentsTabActive()) {
                try { page.cleanup(); } catch (_) {}
                return;
            }
            await page.render({ canvasContext: ctx, viewport }).promise;
            try { page.cleanup(); } catch (_) {}
            if (token !== sheetRenderToken || !isDocumentsTabActive()) return;

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', THUMB_JPEG_QUALITY));
            if (blob) {
                const blobUrl = URL.createObjectURL(blob);
                storeCachedSheetThumbUrl(doc, pageNum, blobUrl);
                savePersistedThumbBlob(doc, pageNum, blob);
                applySheetThumbDataUrlToDom(cId, blobUrl, sheet.name);
            }
            await new Promise(r => setTimeout(r, 60));
        } catch (err) {
            if (bpIcon) bpIcon.className = 'fas fa-drafting-compass';
            console.warn('Could not render thumbnail for page', sheet.pageNumber, err);
        }
    }

    async function ensureImageThumbnailUrl(doc) {
        if (!doc) return '';
        const docKey = String(doc.id);
        if (imageThumbnailUrlCache.has(docKey)) return imageThumbnailUrlCache.get(docKey);
        if (imageThumbnailPromises.has(docKey)) return imageThumbnailPromises.get(docKey);

        const rawUrl = doc.path || sessionFileUrls.get(docKey) || '';
        if (!rawUrl || doc.extension === 'svg') return rawUrl;

        const promise = new Promise((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
                try {
                    const maxW = 280;
                    const maxH = 200;
                    const w = img.naturalWidth || img.width || maxW;
                    const h = img.naturalHeight || img.height || maxH;
                    if (w <= maxW && h <= maxH) {
                        imageThumbnailUrlCache.set(docKey, rawUrl);
                        resolve(rawUrl);
                        return;
                    }
                    const ratio = Math.min(maxW / w, maxH / h);
                    const cw = Math.max(1, Math.round(w * ratio));
                    const ch = Math.max(1, Math.round(h * ratio));
                    const canvas = document.createElement('canvas');
                    canvas.width = cw;
                    canvas.height = ch;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, cw, ch);
                    canvas.toBlob((blob) => {
                        if (blob) {
                            const thumbUrl = URL.createObjectURL(blob);
                            imageThumbnailUrlCache.set(docKey, thumbUrl);
                            resolve(thumbUrl);
                        } else {
                            imageThumbnailUrlCache.set(docKey, rawUrl);
                            resolve(rawUrl);
                        }
                    }, 'image/webp', 0.82);
                } catch (_) {
                    imageThumbnailUrlCache.set(docKey, rawUrl);
                    resolve(rawUrl);
                } finally {
                    imageThumbnailPromises.delete(docKey);
                }
            };
            img.onerror = () => {
                imageThumbnailPromises.delete(docKey);
                resolve(rawUrl);
            };
            img.src = rawUrl;
        });

        imageThumbnailPromises.set(docKey, promise);
        return promise;
    }

    async function renderAttachmentThumbnails(docs) {
        if (!isDocumentsTabActive()) return;
        const token = sheetRenderToken;
        const imageDocs = docs.filter(d => ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(d.extension));
        for (const doc of imageDocs) {
            if (token !== sheetRenderToken || !isDocumentsTabActive()) break;
            const docKey = String(doc.id);
            if (imageThumbnailUrlCache.has(docKey)) continue;
            ensureImageThumbnailUrl(doc).then(thumbUrl => {
                if (token !== sheetRenderToken || !isDocumentsTabActive() || !thumbUrl) return;
                const cId = cleanId(doc.id);
                const imgEl = document.getElementById(`att-img-${cId}`);
                if (imgEl && imgEl.src !== thumbUrl) {
                    imgEl.src = thumbUrl;
                }
            });
            await new Promise(r => setTimeout(r, 12));
        }

        const pdfDocs = docs.filter(d => d.extension === 'pdf');
        for (const doc of pdfDocs) {
            if (token !== sheetRenderToken || !isDocumentsTabActive()) break;
            await renderSingleSheetThumbnail(null, doc, { id: doc.id, pageNumber: 1, name: doc.name }, token);
        }
    }

    function buildSheetPagesList(doc, count) {
        const total = Math.max(1, Number(count) || 1);
        const baseTitle = (doc.name || 'Plan').replace(/\.pdf$/i, '');
        const generated = [];
        for (let p = 1; p <= total; p++) {
            generated.push({
                id: `${doc.id}-p${p}`,
                pageNumber: p,
                name: `Sheet ${p}`,
                title: `${baseTitle} - Page ${p}`
            });
        }
        return generated;
    }

    function applyResolvedPdfPageCount(doc, count) {
        if (!doc || !count || count <= 0) return;
        doc.pageCount = count;
        if (!doc.pages || !doc.pages.length) {
            doc.pages = buildSheetPagesList(doc, count);
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
                const spacerEl = itemEl.querySelector('.doc-tree-badge-spacer');
                const actionsWrap = itemEl.querySelector('.doc-tree-row-actions');
                const moreBtn = itemEl.querySelector('.doc-tree-item-more');
                if (spacerEl && spacerEl.parentNode) {
                    spacerEl.parentNode.replaceChild(badgeEl, spacerEl);
                } else if (actionsWrap && moreBtn) {
                    actionsWrap.insertBefore(badgeEl, moreBtn);
                }
            }
        }
    }

    async function getDocumentSheets(doc) {
        if (!doc) return [];
        if (Array.isArray(doc.pages) && doc.pages.length) {
            return doc.pages;
        }
        if (doc.extension === 'pdf' && doc.pageCount && Number(doc.pageCount) > 0) {
            const generated = buildSheetPagesList(doc, Number(doc.pageCount));
            doc.pages = generated;
            return generated;
        }
        if (doc.extension === 'pdf') {
            // Try background worker first so opening a document doesn't parse the PDF on the main thread
            if (!pdfThumbWorkerUnsupported) {
                try {
                    const workerDoc = await buildWorkerDocPayload(doc);
                    if (workerDoc.url || workerDoc.buffer) {
                        const res = await callPdfThumbWorker({
                            type: 'pageCount',
                            token: sheetRenderToken,
                            docKey: workerDoc.docKey,
                            url: workerDoc.url,
                            buffer: workerDoc.buffer
                        });
                        if (res.ok && res.numPages > 0) {
                            applyResolvedPdfPageCount(doc, res.numPages);
                            return doc.pages;
                        }
                    }
                } catch (_) {}
            }
            const pdf = await loadPdfDocument(doc);
            if (pdf && pdf.numPages) {
                applyResolvedPdfPageCount(doc, pdf.numPages);
                return doc.pages;
            }
        }
        return buildSheetPagesList(doc, Number(doc.pageCount || 1));
    }

    const pdfPageCountQueue = [];
    const pdfPageCountQueuedIds = new Set();
    let isProcessingPageCountQueue = false;

    function enqueuePdfPageCount(doc) {
        if (!isDocumentsTabActive()) return;
        if (!doc || doc.extension !== 'pdf' || (doc.pageCount && doc.pageCount > 0)) return;
        const docKey = String(doc.id);
        if (pdfPageCountQueuedIds.has(docKey)) return;
        pdfPageCountQueuedIds.add(docKey);
        pdfPageCountQueue.push(doc);
        processPdfPageCountQueue();
    }

    async function processPdfPageCountQueue() {
        if (isProcessingPageCountQueue || !pdfPageCountQueue.length || !isDocumentsTabActive()) return;
        isProcessingPageCountQueue = true;
        while (pdfPageCountQueue.length > 0 && isDocumentsTabActive()) {
            while (activePriorityThumbRenders > 0 && isDocumentsTabActive()) {
                await new Promise(r => setTimeout(r, 150));
            }
            if (!isDocumentsTabActive()) break;
            const nextDoc = pdfPageCountQueue.shift();
            if (!nextDoc) continue;
            try {
                if (!nextDoc.pageCount || nextDoc.pageCount <= 0) {
                    await ensurePdfPageCount(nextDoc);
                }
            } finally {
                pdfPageCountQueuedIds.delete(String(nextDoc.id));
            }
            await new Promise(r => setTimeout(r, 60));
        }
        isProcessingPageCountQueue = false;
    }

    async function ensurePdfPageCount(doc) {
        if (!isDocumentsTabActive()) return null;
        if (!doc || doc.extension !== 'pdf' || (doc.pageCount && doc.pageCount > 0)) return doc.pageCount;
        try {
            if (!pdfThumbWorkerUnsupported) {
                const workerDoc = await buildWorkerDocPayload(doc);
                if (!isDocumentsTabActive()) return null;
                if (workerDoc.url || workerDoc.buffer) {
                    const res = await callPdfThumbWorker({
                        type: 'pageCount',
                        token: sheetRenderToken,
                        docKey: workerDoc.docKey,
                        url: workerDoc.url,
                        buffer: workerDoc.buffer
                    });
                    if (res.ok && res.numPages > 0) {
                        applyResolvedPdfPageCount(doc, res.numPages);
                        return res.numPages;
                    }
                }
            }
            if (!isDocumentsTabActive()) return null;
            const pdf = await loadPdfDocument(doc);
            if (pdf && pdf.numPages) {
                applyResolvedPdfPageCount(doc, pdf.numPages);
                return pdf.numPages;
            }
        } catch (e) {
            console.warn('ensurePdfPageCount failed for', doc.id, e);
        }
        return null;
    }

    const MAX_DOCUMENT_BYTES = 10737418240;
    const MAX_PDF_PREVIEW_BYTES = 67108864;
    const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg']);
    const DOCUMENT_ACCEPT_FILTER = '.pdf,image/*,application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp,image/tiff';
    const UPLOAD_MODAL_HOLD_MS = 2000;
    let isAddingFiles = false;
    const selectedDocumentCheckboxIds = new Set();
    const collapsedDisciplines = new Set();
    let isDrawingsRootCollapsed = false;

    function isSupportedDocumentFile(file) {
        if (!file) return false;
        const name = String(file.name || '').trim();
        const ext = name.includes('.') ? String(name.split('.').pop() || '').toLowerCase() : '';
        const mime = String(file.type || '').toLowerCase();
        if (!ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) return false;
        if (mime && mime !== 'application/pdf' && mime !== 'application/x-pdf' && !mime.startsWith('image/') && mime !== 'application/octet-stream') {
            return false;
        }
        return true;
    }

    function stripDuplicateUploadPrefix(name) {
        return String(name || '').trim().replace(/^#\d+_/, '');
    }

    function resolveDuplicateDocumentName(rawName, batchAssignedNames = []) {
        const cleanRaw = String(rawName || 'Document').trim() || 'Document';
        const baseName = stripDuplicateUploadPrefix(cleanRaw) || cleanRaw;
        const baseLower = baseName.toLowerCase();

        const existingNames = [];
        for (const doc of allDocumentRows()) {
            if (doc.name) existingNames.push(String(doc.name).trim());
            if (doc.filename && doc.filename !== doc.name) existingNames.push(String(doc.filename).trim());
        }
        for (const assigned of batchAssignedNames) {
            if (assigned) existingNames.push(String(assigned).trim());
        }

        const existingLowerSet = new Set(existingNames.map(n => n.toLowerCase()));
        let matchingUploadCount = 0;
        for (const existing of existingNames) {
            if (stripDuplicateUploadPrefix(existing).toLowerCase() === baseLower) {
                matchingUploadCount++;
            }
        }

        if (matchingUploadCount === 0 && !existingLowerSet.has(cleanRaw.toLowerCase())) {
            return cleanRaw;
        }

        let nextNumber = Math.max(2, matchingUploadCount + 1);
        let candidate = `#${nextNumber}_${baseName}`;
        while (existingLowerSet.has(candidate.toLowerCase())) {
            nextNumber++;
            candidate = `#${nextNumber}_${baseName}`;
        }
        return candidate;
    }

    function ensureDocumentUploadModal() {
        let modal = document.getElementById('pdDocumentUploadModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'pdDocumentUploadModal';
        modal.className = 'pd-modal-backdrop doc-upload-modal-backdrop';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'docUploadModalTitle');
        modal.setAttribute('aria-live', 'polite');
        modal.innerHTML = `
            <div class="pd-modal doc-upload-modal" style="width: min(480px, calc(100vw - 32px)); max-width: 480px;">
                <div class="pd-modal-head">
                    <h3 id="docUploadModalTitle" style="min-width: 0; overflow: hidden;">
                        <i class="fas fa-cloud-arrow-up doc-upload-modal-icon" id="docUploadModalIcon" style="color: var(--primary); flex-shrink: 0;"></i>
                        <span id="docUploadModalHeading" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Uploading Documents...</span>
                    </h3>
                    <span class="doc-upload-modal-counter" id="docUploadModalCounter">0 / 0</span>
                </div>
                <div class="pd-modal-body doc-upload-modal-body" style="grid-template-columns: minmax(0, 1fr); gap: 14px;">
                    <div class="doc-upload-current-card">
                        <div class="doc-upload-file-row">
                            <div class="doc-upload-file-meta">
                                <i class="far fa-file-pdf doc-upload-file-icon" id="docUploadFileIcon"></i>
                                <span class="doc-upload-file-name" id="docUploadFileName" title="Preparing upload...">Preparing upload...</span>
                            </div>
                            <span class="doc-upload-file-percent" id="docUploadFilePercent">0%</span>
                        </div>
                        <div class="doc-upload-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="docUploadProgressTrack">
                            <div class="doc-upload-progress-bar" id="docUploadProgressBar" style="width: 0%;"></div>
                        </div>
                        <div class="doc-upload-status-line">
                            <span class="doc-upload-status-text" id="docUploadStatusText">Uploading file...</span>
                        </div>
                    </div>
                    <div class="doc-upload-file-list" id="docUploadFileList" style="display: none;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    function uploadDocumentFile(file, projectId, onProgress, targetFilename = null, folderName = null) {
        return new Promise((resolve, reject) => {
            const finalName = targetFilename || file.name;
            const form = new FormData();
            form.append('project_id', projectId);
            if (folderName) form.append('folder_name', folderName);
            form.append('file', file, finalName);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '../api/project_document_takeoff.php');
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.upload.onprogress = event => {
                if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
            };
            xhr.onload = () => {
                let result = null;
                try { result = JSON.parse(xhr.responseText); } catch (_) {}
                if (xhr.status >= 200 && xhr.status < 300 && result?.success && result?.file?.id) resolve(result.file);
                else reject(new Error(result?.message || `Upload failed (HTTP ${xhr.status || 0}).`));
            };
            xhr.onerror = () => reject(new Error('Connection error.'));
            xhr.send(form);
        });
    }

    async function addFiles(files, category = null) {
        const rawIncoming = Array.from(files || []);
        if (!rawIncoming.length || isAddingFiles) return;
        isAddingFiles = true;

        try {
            const incoming = [];
            const unsupportedFiles = [];
            for (const file of rawIncoming) {
                if (isSupportedDocumentFile(file)) {
                    incoming.push(file);
                } else {
                    unsupportedFiles.push(file);
                }
            }

            if (unsupportedFiles.length && !incoming.length) {
                const rejectedList = unsupportedFiles.map(f => f.name).join(', ');
                showAlertDialog({
                    title: 'Unsupported File Format',
                    message: `The system cannot process the following file(s): ${rejectedList}. Only PDF and image files (PDF, PNG, JPG, JPEG, WEBP, GIF, BMP, TIFF) can be uploaded.`,
                    buttonText: 'Understood',
                    type: 'error',
                    badge: 'UNSUPPORTED FILE',
                    icon: 'fas fa-file-circle-xmark'
                });
                return;
            }

            const batchAssignedNames = [];
            const uploadEntries = incoming.map(file => {
                const resolvedName = resolveDuplicateDocumentName(file.name, batchAssignedNames);
                batchAssignedNames.push(resolvedName);
                return { file, resolvedName };
            });

            const projectId = Number(window.ProjectState?.projectId || 0);
            const modal = ensureDocumentUploadModal();
            const modalHeading = modal.querySelector('#docUploadModalHeading');
            const modalIcon = modal.querySelector('#docUploadModalIcon');
            const modalCounter = modal.querySelector('#docUploadModalCounter');
            const fileIcon = modal.querySelector('#docUploadFileIcon');
            const progressLabel = modal.querySelector('#docUploadFileName');
            const progressPercent = modal.querySelector('#docUploadFilePercent');
            const progressTrack = modal.querySelector('#docUploadProgressTrack');
            const progressBar = modal.querySelector('#docUploadProgressBar');
            const statusText = modal.querySelector('#docUploadStatusText');
            const fileListEl = modal.querySelector('#docUploadFileList');

            const setModalProgress = (pct, statusMsg = null) => {
                const clamped = Math.max(0, Math.min(100, Math.round(pct)));
                if (progressPercent) progressPercent.textContent = `${clamped}%`;
                if (progressBar) progressBar.style.width = `${clamped}%`;
                if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(clamped));
                if (statusMsg !== null && statusText) {
                    statusText.textContent = statusMsg;
                    statusText.title = statusMsg;
                }
            };

            if (modalHeading) modalHeading.textContent = uploadEntries.length > 1 ? 'Uploading Documents...' : 'Uploading Document...';
            if (modalIcon) {
                modalIcon.className = 'fas fa-cloud-arrow-up doc-upload-modal-icon';
                modalIcon.style.color = 'var(--primary)';
            }
            if (fileListEl) {
                if (uploadEntries.length > 1) {
                    fileListEl.style.display = 'flex';
                    fileListEl.innerHTML = uploadEntries.map((entry, idx) => {
                        const isPdf = String(entry.resolvedName.split('.').pop() || '').toLowerCase() === 'pdf';
                        return `
                            <div class="doc-upload-list-item" data-upload-idx="${idx}">
                                <i class="far ${isPdf ? 'fa-file-pdf' : 'fa-file-image'} doc-upload-list-icon" style="color: ${isPdf ? '#ef4444' : '#3b82f6'}; flex-shrink: 0;"></i>
                                <span class="doc-upload-list-name" title="${escapeHtml(entry.resolvedName)}">${escapeHtml(entry.resolvedName)}</span>
                                <span class="doc-upload-list-status" data-upload-status="${idx}">Pending</span>
                            </div>
                        `;
                    }).join('');
                } else {
                    fileListEl.style.display = 'none';
                    fileListEl.innerHTML = '';
                }
            }

            setModalProgress(0, 'Preparing file upload...');
            modal.classList.add('open');

            // Ensure initial 0% state renders before starting upload work
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            const errors = [];
            let completed = 0;
            let succeeded = 0;
            let firstAddedId = null;
            const activeDisciplineGroup = (typeof selectedDocumentsFolder === 'string' && selectedDocumentsFolder.startsWith('discipline:'))
                ? selectedDocumentsFolder.replace('discipline:', '')
                : null;
            const effectiveCategory = category || (activeDisciplineGroup ? 'Drawings' : null);

            for (let index = 0; index < uploadEntries.length; index++) {
                const { file, resolvedName } = uploadEntries[index];
                const ext = String(resolvedName.split('.').pop() || '').toLowerCase();
                const isPdf = ext === 'pdf';
                const itemStatusEl = fileListEl?.querySelector(`[data-upload-status="${index}"]`);
                const itemRowEl = fileListEl?.querySelector(`[data-upload-idx="${index}"]`);

                if (progressLabel) {
                    progressLabel.textContent = resolvedName;
                    progressLabel.title = resolvedName;
                }
                if (modalCounter) modalCounter.textContent = `${index + 1} / ${uploadEntries.length}`;
                if (fileIcon) {
                    fileIcon.className = `far ${isPdf ? 'fa-file-pdf' : 'fa-file-image'} doc-upload-file-icon`;
                    fileIcon.style.color = isPdf ? '#ef4444' : '#3b82f6';
                }
                if (itemRowEl) itemRowEl.classList.add('is-active');
                if (itemStatusEl) itemStatusEl.textContent = '0%';
                setModalProgress(0, `Uploading ${resolvedName}...`);

                if (file.size > MAX_DOCUMENT_BYTES) {
                    errors.push({ filename: resolvedName, message: 'File exceeds the 10 GB limit.' });
                    if (itemRowEl) {
                        itemRowEl.classList.remove('is-active');
                        itemRowEl.classList.add('is-error');
                    }
                    if (itemStatusEl) itemStatusEl.textContent = 'Failed';
                    completed++;
                    continue;
                }

                const id = String(Date.now() + index + Math.random().toString(16).slice(2));
                const inferredCategory = activeDisciplineGroup ? 'Drawings' : inferCategory({ name: resolvedName }, effectiveCategory);
                const resolvedDiscipline = inferredCategory === 'Drawings'
                    ? (activeDisciplineGroup || classifyDrawingDiscipline({ name: resolvedName, filename: resolvedName }))
                    : null;
                const targetFolderName = inferredCategory === 'Drawings'
                    ? `Drawings:${resolvedDiscipline || 'general'}`
                    : 'Attachments';
                const folderId = '';
                let pageCount = null;
                let pages = [];

                // PDF page counts and thumbnails are resolved asynchronously in the background Web Worker
                // (capped by MAX_PDF_PREVIEW_BYTES) after upload completes so main-thread UI never freezes.

                if (!projectId) {
                    setModalProgress(60, `Processing ${resolvedName}...`);
                    if (itemStatusEl) itemStatusEl.textContent = '60%';
                    await new Promise(r => setTimeout(r, 120));
                    sessionFiles.set(id, file);
                    sessionFileUrls.set(id, URL.createObjectURL(file));
                    localDocuments.push({
                        id, name: resolvedName, filename: resolvedName, category: inferredCategory, folderId,
                        size: file.size, uploadedAt: new Date().toLocaleString(),
                        uploadedBy: $('poEstimator')?.value || 'Juan Estevez', type: file.type || '',
                        extension: ext, source: 'local', pageCount, pages, order: Date.now() + index
                    });
                    if (inferredCategory === 'Drawings' && resolvedDiscipline) {
                        saveDisciplineOverride(id, resolvedDiscipline, null, resolvedName);
                        collapsedDisciplines.delete(resolvedDiscipline);
                    }
                    firstAddedId = firstAddedId || id;
                    succeeded++;
                    completed++;
                    setModalProgress(100, `Uploaded ${resolvedName}`);
                    if (itemRowEl) {
                        itemRowEl.classList.remove('is-active');
                        itemRowEl.classList.add('is-done');
                    }
                    if (itemStatusEl) itemStatusEl.innerHTML = '<i class="fas fa-check" style="color:#10b981;"></i> 100%';
                    continue;
                }

                try {
                    const stored = await uploadDocumentFile(file, projectId, percent => {
                        const filePct = Math.max(0, Math.min(100, Math.round(percent)));
                        setModalProgress(filePct, `Uploading ${resolvedName}... (${completed + 1} of ${uploadEntries.length})`);
                        if (itemStatusEl) itemStatusEl.textContent = `${filePct}%`;
                    }, resolvedName, targetFolderName);
                    const storedId = Number(stored.id);
                    const finalStoredName = resolvedName || stored.filename || file.name;
                    const docStateId = `existing-legacy_file-${storedId}`;
                    window.ProjectState.documents.push({
                        id: storedId, source: 'legacy_file', filename: finalStoredName,
                        title: finalStoredName, path: `../${stored.filepath}`,
                        extension: stored.file_type || ext, mime_type: file.type || '',
                        uploaded_at: new Date().toISOString(), pageCount, page_count: pageCount, pages,
                        folder_name: stored.folder_name || targetFolderName
                    });
                    if (!window._pendingTakeoffDrawingId && storedId > 0) {
                        window._pendingTakeoffDrawingId = storedId;
                    }
                    window._pendingTakeoffSync = true;
                    if (inferredCategory === 'Drawings' && resolvedDiscipline) {
                        saveDisciplineOverride(docStateId, resolvedDiscipline, storedId, finalStoredName);
                        collapsedDisciplines.delete(resolvedDiscipline);
                    }
                    firstAddedId = firstAddedId || docStateId;
                    succeeded++;
                    setModalProgress(100, `Uploaded ${resolvedName}`);
                    if (itemRowEl) {
                        itemRowEl.classList.remove('is-active');
                        itemRowEl.classList.add('is-done');
                    }
                    if (itemStatusEl) itemStatusEl.innerHTML = '<i class="fas fa-check" style="color:#10b981;"></i> 100%';
                } catch (error) {
                    errors.push({ filename: resolvedName, message: error.message || 'Upload failed.' });
                    if (itemRowEl) {
                        itemRowEl.classList.remove('is-active');
                        itemRowEl.classList.add('is-error');
                    }
                    if (itemStatusEl) itemStatusEl.textContent = 'Failed';
                }
                completed++;
            }

            if (firstAddedId) selectedDocumentsId = firstAddedId;
            persistLocalDocuments();
            syncDocumentsToProjectState();

            setModalProgress(100, errors.length ? `${succeeded} uploaded, ${errors.length} failed` : `${succeeded} document${succeeded === 1 ? '' : 's'} uploaded & synced with Takeoff (100%)`);
            if (modalHeading) {
                modalHeading.textContent = errors.length ? 'Upload Finished with Issues' : 'Upload Complete';
            }
            if (modalIcon && !errors.length) {
                modalIcon.className = 'fas fa-circle-check doc-upload-modal-icon';
                modalIcon.style.color = '#10b981';
            }
            if (modalCounter) {
                modalCounter.textContent = `${completed} / ${uploadEntries.length}`;
            }

            // Hold the modal at 100% for 2 seconds before disappearing so fast uploads don't flash
            await new Promise(resolve => setTimeout(resolve, UPLOAD_MODAL_HOLD_MS));
            modal.classList.remove('open');

            // Render Documents list after modal closes so upload animation & Takeoff sync never compete in parallel
            renderDocumentsPage();
            const isTakeoffTabActive = document.getElementById('tab-takeoff')?.classList.contains('active');
            if (isTakeoffTabActive) {
                window.projectTakeoffRefreshDrawings?.(window._pendingTakeoffDrawingId || null);
                window._pendingTakeoffDrawingId = null;
                window._pendingTakeoffSync = false;
            }

            if (unsupportedFiles.length || errors.length) {
                const messages = [];
                if (unsupportedFiles.length) {
                    messages.push(`Unsupported file(s) blocked: ${unsupportedFiles.map(f => f.name).join(', ')}. Only PDF and image files are allowed.`);
                }
                if (errors.length) {
                    messages.push(...errors.map(e => `${e.filename}: ${e.message}`));
                }
                showAlertDialog({
                    title: unsupportedFiles.length ? 'Unsupported File Format' : 'Upload Error',
                    message: messages.join(' '),
                    buttonText: 'Understood',
                    type: 'error',
                    badge: 'UPLOAD ALERT',
                    icon: 'fas fa-circle-exclamation'
                });
            }
        } finally {
            isAddingFiles = false;
        }
    }
    window.uploadProjectDocumentsWithModal = addFiles;

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
                const docId = `existing-${doc.source}-${doc.id}`;
                const docName = doc.source === 'project_document' ? (doc.title || doc.filename || 'Document') : (doc.filename || doc.title || 'Document');
                const overrides = loadDisciplineOverrides();
                const nameKey = `name:${String(docName).trim().toLowerCase()}`;
                const backendKey = `backend:${doc.id}`;
                const folderNameStr = String(doc.folder_name || '').trim();
                const hasDisciplineOverride = Boolean(
                    folderNameStr === 'Drawings' ||
                    folderNameStr.startsWith('Drawings:') ||
                    (overrides[docId] && DRAWING_DISCIPLINES.some(d => d.key === overrides[docId])) ||
                    (overrides[backendKey] && DRAWING_DISCIPLINES.some(d => d.key === overrides[backendKey])) ||
                    (overrides[nameKey] && DRAWING_DISCIPLINES.some(d => d.key === overrides[nameKey]))
                );
                return {
                    id: docId,
                    backendId: doc.id,
                    name: docName,
                    filename: doc.filename || doc.title || 'Document',
                    folderName: folderNameStr,
                    category: hasDisciplineOverride ? 'Drawings' : inferCategory({ name: doc.filename || doc.title || '' }, doc.folder_name || null),
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

    const DRAWING_DISCIPLINES = [
        {
            key: 'architectural',
            label: 'Architectural',
            color: '#2563eb',
            bgLight: 'rgba(37, 99, 235, 0.1)',
            borderLight: 'rgba(37, 99, 235, 0.26)',
            textLight: '#1d4ed8',
            bgDark: 'rgba(59, 130, 246, 0.16)',
            borderDark: 'rgba(96, 165, 250, 0.35)',
            prefixRegex: /^(?:#\d+_)?(?:a[-_.\s]?\d|arq[-_.\s]?|arch[-_.\s]?)/i,
            keywordRegex: /\b(?:arch|architectural|arquitect|arquitectura|floor\s*plan|planta\s*arquitect|elevat|elevacion|fachada|ceiling|rcp|reflected|section|seccion|door|window|finish|acabado|partition|interior)\b/i
        },
        {
            key: 'electrical',
            label: 'Electrical',
            color: '#f59e0b',
            bgLight: 'rgba(245, 158, 11, 0.12)',
            borderLight: 'rgba(245, 158, 11, 0.3)',
            textLight: '#b45309',
            bgDark: 'rgba(245, 158, 11, 0.16)',
            borderDark: 'rgba(251, 191, 36, 0.35)',
            prefixRegex: /^(?:#\d+_)?(?:e[-_.\s]?\d|el[-_.\s]?\d|elec[-_.\s]?)/i,
            keywordRegex: /\b(?:elec|electrical|electrico|electrica|iluminacion|lighting|power|potencia|panel\s*schedule|tablero|single\s*line|unifilar|low\s*voltage|fire\s*alarm|telecom|data)\b/i
        },
        {
            key: 'plumbing',
            label: 'Pluvial / Plumbing',
            color: '#06b6d4',
            bgLight: 'rgba(6, 182, 212, 0.11)',
            borderLight: 'rgba(6, 182, 212, 0.28)',
            textLight: '#0e7490',
            bgDark: 'rgba(6, 182, 212, 0.16)',
            borderDark: 'rgba(34, 211, 238, 0.35)',
            prefixRegex: /^(?:#\d+_)?(?:p[-_.\s]?\d|pl[-_.\s]?\d|plu[-_.\s]?|san[-_.\s]?|fp[-_.\s]?\d)/i,
            keywordRegex: /\b(?:pluvial|plubial|plumb|plumbing|plomeria|fontaneria|sanitario|sanitary|storm\s*drain|drenaje|agua\s*potable|hidrosanitario|hidraulic|piping|riser|fire\s*protection|sprinkler)\b/i
        },
        {
            key: 'structural',
            label: 'Structural',
            color: '#8b5cf6',
            bgLight: 'rgba(139, 92, 246, 0.11)',
            borderLight: 'rgba(139, 92, 246, 0.28)',
            textLight: '#6d28d9',
            bgDark: 'rgba(139, 92, 246, 0.17)',
            borderDark: 'rgba(167, 139, 250, 0.35)',
            prefixRegex: /^(?:#\d+_)?(?:s[-_.\s]?\d|st[-_.\s]?\d|est[-_.\s]?|str[-_.\s]?)/i,
            keywordRegex: /\b(?:struct|structural|estruct|estructura|estructural|foundation|cimentacion|footing|zapata|framing|beam|column|viga|columna|slab|losa|rebar|acero|concrete)\b/i
        },
        {
            key: 'civil',
            label: 'Civil',
            color: '#10b981',
            bgLight: 'rgba(16, 185, 129, 0.11)',
            borderLight: 'rgba(16, 185, 129, 0.28)',
            textLight: '#047857',
            bgDark: 'rgba(16, 185, 129, 0.16)',
            borderDark: 'rgba(52, 211, 153, 0.35)',
            prefixRegex: /^(?:#\d+_)?(?:c[-_.\s]?\d|cv[-_.\s]?\d|civ[-_.\s]?)/i,
            keywordRegex: /\b(?:civil|site\s*plan|grading|nivelacion|topograf|survey|paving|pavimento|utility|utilities|erosion|swppp|earthwork|terraceria|roadway|parking)\b/i
        },
        {
            key: 'mechanical',
            label: 'Mechanical',
            color: '#f97316',
            bgLight: 'rgba(249, 115, 22, 0.11)',
            borderLight: 'rgba(249, 115, 22, 0.28)',
            textLight: '#c2410c',
            bgDark: 'rgba(249, 115, 22, 0.16)',
            borderDark: 'rgba(251, 146, 60, 0.35)',
            prefixRegex: /^(?:#\d+_)?(?:m[-_.\s]?\d|mh[-_.\s]?\d|mec[-_.\s]?|hvac[-_.\s]?)/i,
            keywordRegex: /\b(?:mech|mechanical|mecanico|mecanica|hvac|duct|ducto|climatizacion|ventilacion|aire\s*acondicionado|chiller|boiler)\b/i
        },
        {
            key: 'general',
            label: 'General',
            color: '#64748b',
            bgLight: 'rgba(100, 116, 139, 0.12)',
            borderLight: 'rgba(100, 116, 139, 0.28)',
            textLight: '#334155',
            bgDark: 'rgba(148, 163, 184, 0.16)',
            borderDark: 'rgba(148, 163, 184, 0.32)',
            prefixRegex: /^(?:#\d+_)?(?:g[-_.\s]?\d|gn[-_.\s]?\d|t[-_.\s]?\d)/i,
            keywordRegex: /\b(?:general|cover|portada|title\s*sheet|index|indice|legend|simbologia|notes)\b/i
        }
    ];

    function renderDisciplinePill(discOrKey, extraClass = '') {
        const disc = typeof discOrKey === 'string' ? getDisciplineMeta(discOrKey) : (discOrKey || getDisciplineMeta('general'));
        return `<span class="bb-status-pill-wrap doc-discipline-pill disc-${escapeHtml(disc.key)} ${extraClass}" style="--disc-color: ${disc.color}; --disc-bg-light: ${disc.bgLight}; --disc-border-light: ${disc.borderLight}; --disc-text-light: ${disc.textLight}; --disc-bg-dark: ${disc.bgDark}; --disc-border-dark: ${disc.borderDark};" title="${escapeHtml(disc.label)}">
            <span class="bb-status-dot" style="background-color: ${disc.color};"></span>
            <span class="bb-status-pill-label">${escapeHtml(disc.label)}</span>
        </span>`;
    }

    function disciplineStorageKey() {
        const id = Number(window.ProjectState?.projectId || 0);
        return `takeoff.docDisciplines.${id || 'draft'}`;
    }

    function loadDisciplineOverrides() {
        try {
            const raw = localStorage.getItem(disciplineStorageKey());
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function saveDisciplineOverride(docId, disciplineKey, backendId = null, docName = null) {
        try {
            const map = loadDisciplineOverrides();
            map[String(docId)] = disciplineKey;
            let resolvedBackendId = backendId;
            let resolvedName = docName;
            if (!resolvedBackendId || !resolvedName) {
                const doc = (window.ProjectState?.documents || []).find(d => `existing-${d.source}-${d.id}` === String(docId) || String(d.id) === String(docId));
                if (doc) {
                    if (!resolvedBackendId) resolvedBackendId = doc.id;
                    if (!resolvedName) resolvedName = doc.filename || doc.title;
                }
            }
            if (resolvedBackendId) {
                map[`backend:${resolvedBackendId}`] = disciplineKey;
            }
            if (resolvedName) {
                map[`name:${String(resolvedName).trim().toLowerCase()}`] = disciplineKey;
            }
            localStorage.setItem(disciplineStorageKey(), JSON.stringify(map));
        } catch (e) { }
    }

    function classifyDrawingDiscipline(doc) {
        if (!doc) return 'general';
        const overrides = loadDisciplineOverrides();
        const folderDisc = String(doc.folderName || doc.folder_name || '').startsWith('Drawings:')
            ? String(doc.folderName || doc.folder_name).split(':')[1]
            : null;
        const nameKey = `name:${String(doc.name || doc.filename || '').trim().toLowerCase()}`;
        const backendKey = doc.backendId ? `backend:${doc.backendId}` : null;
        const candidates = [
            overrides[String(doc.id)],
            backendKey ? overrides[backendKey] : null,
            folderDisc,
            overrides[nameKey]
        ];
        for (const candidate of candidates) {
            if (candidate && DRAWING_DISCIPLINES.some(d => d.key === candidate)) {
                return candidate;
            }
        }
        const rawTitle = stripDuplicateUploadPrefix(doc.name || doc.filename || '');
        const cleanTitle = rawTitle.replace(/\.[a-z0-9]+$/i, '').trim();

        for (const disc of DRAWING_DISCIPLINES) {
            if (disc.key === 'general') continue;
            if (disc.prefixRegex && disc.prefixRegex.test(cleanTitle)) {
                return disc.key;
            }
        }
        for (const disc of DRAWING_DISCIPLINES) {
            if (disc.key === 'general') continue;
            if (disc.keywordRegex && disc.keywordRegex.test(cleanTitle)) {
                return disc.key;
            }
        }
        return 'general';
    }

    function getDisciplineMeta(key) {
        return DRAWING_DISCIPLINES.find(d => d.key === key) || DRAWING_DISCIPLINES[DRAWING_DISCIPLINES.length - 1];
    }

    window.ProjectDocumentsDisciplines = {
        list: DRAWING_DISCIPLINES,
        classify: classifyDrawingDiscipline,
        getMeta: getDisciplineMeta
    };

    function pruneSelectionSet() {
        const validIds = new Set(allDocumentRows().map(d => String(d.id)));
        for (const checkedId of Array.from(selectedDocumentCheckboxIds)) {
            if (!validIds.has(String(checkedId))) {
                selectedDocumentCheckboxIds.delete(checkedId);
            }
        }
    }

    function syncDocumentsSubheadInfo() {
        pruneSelectionSet();
        const container = $('documentsSubheadItemInfo');
        if (!container) return;

        const isDocsTab = document.body.classList.contains('is-documents-tab') ||
            document.querySelector('.project-subhead-wrapper')?.classList.contains('is-documents-tab');
        if (!isDocsTab) {
            container.classList.remove('is-visible');
            container.style.display = 'none';
            container.setAttribute('aria-hidden', 'true');
            return;
        }

        const checkedIds = Array.from(selectedDocumentCheckboxIds);
        if (!checkedIds.length) {
            container.classList.remove('is-visible');
            container.style.display = 'none';
            container.setAttribute('aria-hidden', 'true');
            return;
        }

        const allDocs = allDocumentRows();
        const selectedDocs = checkedIds.map(id => allDocs.find(d => String(d.id) === String(id))).filter(Boolean);
        if (!selectedDocs.length) {
            container.classList.remove('is-visible');
            container.style.display = 'none';
            container.setAttribute('aria-hidden', 'true');
            return;
        }

        const dotEl = $('documentsSubheadItemDot') || container.querySelector('.pro-active-layer-dot');
        const nameEl = $('documentsSubheadItemName') || container.querySelector('.takeoff-subhead-item-name');
        const metaEl = $('documentsSubheadItemMeta') || container.querySelector('.takeoff-subhead-item-meta');
        const actionsEl = $('documentsSubheadItemActions') || container.querySelector('.takeoff-subhead-item-actions');

        if (dotEl) {
            dotEl.style.background = 'transparent';
            dotEl.style.boxShadow = 'none';
            dotEl.innerHTML = `<i class="fas fa-folder" style="color: #f59e0b; font-size: 11.5px;"></i>`;
        }

        const count = selectedDocs.length;
        const labelText = count === 1 ? (selectedDocs[0].name || '1 document selected') : `${count} documents selected`;
        if (nameEl) {
            nameEl.textContent = labelText;
            nameEl.title = selectedDocs.map(d => d.name).join(', ');
        }

        if (metaEl) {
            metaEl.textContent = `${count} ${count === 1 ? 'document' : 'documents'}`;
        }

        if (actionsEl) {
            actionsEl.innerHTML = `
                <button type="button" class="subhead-item-act-btn danger" data-doc-subhead-action="delete-all" title="Delete selected documents">
                    <i class="fas fa-trash"></i><span>Delete All</span>
                </button>
            `;
        }

        container.classList.add('is-visible');
        container.style.display = 'inline-flex';
        container.setAttribute('aria-hidden', 'false');
    }
    window.syncDocumentsSubheadInfo = syncDocumentsSubheadInfo;

    async function deleteSelectedDocuments() {
        pruneSelectionSet();
        const checkedIds = Array.from(selectedDocumentCheckboxIds);
        if (!checkedIds.length) return;

        const allDocs = allDocumentRows();
        const selectedDocs = checkedIds.map(id => allDocs.find(d => String(d.id) === String(id))).filter(Boolean);
        if (!selectedDocs.length) return;

        const count = selectedDocs.length;
        const confirmed = await showConfirmDialog({
            title: count === 1 ? 'Delete Selected Document' : `Delete ${count} Selected Documents`,
            message: `Are you sure you want to permanently delete ${count === 1 ? `"${selectedDocs[0].name}"` : `the ${count} selected documents (${selectedDocs.map(d => `"${d.name}"`).join(', ')})`}? This action cannot be undone.`,
            confirmText: count === 1 ? 'Delete Document' : `Delete All (${count})`,
            cancelText: 'Cancel',
            type: 'error',
            badge: 'CONFIRM DELETION',
            icon: 'fas fa-trash-can',
            primaryDanger: true
        });
        if (!confirmed) return;

        const delBtn = document.querySelector('[data-doc-subhead-action="delete-all"]');
        const origDelHtml = delBtn ? delBtn.innerHTML : '';
        if (delBtn) {
            delBtn.disabled = true;
            delBtn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i><span>Deleting...</span>`;
        }

        const projectId = Number(window.ProjectState?.projectId || 0);
        let deletedCount = 0;
        const errors = [];

        try {
            for (const doc of selectedDocs) {
                if (doc.source === 'existing') {
                    try {
                        await request('document_action', {
                            project_id: projectId,
                            id: doc.backendId,
                            source: doc.originalSource,
                            operation: 'delete'
                        });
                        window.ProjectState.documents = (window.ProjectState.documents || []).filter(
                            row => !(String(row.id) === String(doc.backendId) && row.source === doc.originalSource)
                        );
                        deletedCount++;
                    } catch (err) {
                        errors.push(`${doc.name}: ${err.message || 'Delete failed'}`);
                    }
                } else {
                    localDocuments = localDocuments.filter(row => String(row.id) !== String(doc.id));
                    sessionFiles.delete(String(doc.id));
                    const objectUrl = sessionFileUrls.get(String(doc.id));
                    if (objectUrl) URL.revokeObjectURL(objectUrl);
                    sessionFileUrls.delete(String(doc.id));
                    deletedCount++;
                }
                selectedDocumentCheckboxIds.delete(String(doc.id));
                if (String(selectedDocumentsId) === String(doc.id)) selectedDocumentsId = null;
                if (selectedDocumentsFolder === `document:${doc.id}`) selectedDocumentsFolder = 'drawings';
            }
        } finally {
            if (delBtn && delBtn.isConnected) {
                delBtn.disabled = false;
                delBtn.innerHTML = origDelHtml;
            }
        }

        persistLocalDocuments();
        syncDocumentsToProjectState();
        renderDocumentsPage();
        window.projectTakeoffRefreshDrawings?.();
        syncDocumentsSubheadInfo();

        if (errors.length) {
            showAlertDialog({
                title: 'Deletion Completed with Errors',
                message: `Deleted ${deletedCount} document(s). Errors: ${errors.join('; ')}`,
                buttonText: 'Understood',
                type: 'error',
                badge: 'DELETE ALERT',
                icon: 'fas fa-circle-exclamation'
            });
        } else {
            showAlertDialog({
                title: 'Documents Deleted',
                message: `Successfully deleted ${deletedCount} ${deletedCount === 1 ? 'document' : 'documents'} from the project.`,
                buttonText: 'Got It',
                type: 'info',
                badge: 'DELETED',
                icon: 'fas fa-trash-can'
            });
        }
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
                if (!draggedDocId) return;
                e.preventDefault();
                e.stopPropagation();
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
                if (!draggedDocId) return;
                e.preventDefault();
                e.stopPropagation();
                item.classList.remove('drag-over-top', 'drag-over-bottom');
                const targetDocId = item.dataset.dragDocId;
                if (!draggedDocId || draggedDocId === targetDocId) return;

                const targetDoc = findDocumentById(targetDocId);
                if (targetDoc) {
                    const targetDiscipline = classifyDrawingDiscipline(targetDoc);
                    saveDisciplineOverride(draggedDocId, targetDiscipline);
                }

                const rect = item.getBoundingClientRect();
                const insertBefore = (e.clientY - rect.top) < (rect.height / 2);

                reorderPdfDocuments(draggedDocId, targetDocId, insertBefore);
            });

            item.addEventListener('dragend', () => {
                items.forEach(i => i.classList.remove('is-dragging', 'drag-over-top', 'drag-over-bottom'));
                container.querySelectorAll('.doc-discipline-group-head').forEach(h => h.classList.remove('is-drop-target'));
                draggedDocId = null;
            });
        });

        container.querySelectorAll('.doc-discipline-group-head[data-discipline-key]').forEach(header => {
            header.addEventListener('dragover', (e) => {
                if (!draggedDocId) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                header.classList.add('is-drop-target');
            });
            header.addEventListener('dragleave', () => {
                header.classList.remove('is-drop-target');
            });
            header.addEventListener('drop', (e) => {
                if (!draggedDocId) return;
                e.preventDefault();
                e.stopPropagation();
                header.classList.remove('is-drop-target');
                const discKey = header.dataset.disciplineKey;
                if (discKey) {
                    saveDisciplineOverride(draggedDocId, discKey);
                    collapsedDisciplines.delete(discKey);
                    renderDocumentsPage();
                }
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
        if (selectedDocumentsFolder.startsWith('discipline:')) {
            const discKey = selectedDocumentsFolder.replace('discipline:', '');
            return drawingDocuments().filter(doc => classifyDrawingDiscipline(doc) === discKey);
        }
        if (selectedDocumentsFolder.startsWith('document:')) {
            const docId = selectedDocumentsFolder.replace('document:', '');
            const doc = all.find(row => row.id === docId);
            if (!doc) return [];
            return doc.pages.length ? doc.pages.map(page => ({ ...page, parentId: doc.id, category: 'Drawings', source: 'sheet' })) : [doc];
        }
        return drawingDocuments();
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
        pruneSelectionSet();

        if (!all.length) {
            if (emptyView) {
                emptyView.classList.remove('is-hidden');
                emptyView.style.setProperty('display', 'flex', 'important');
            }
            if (pageView) {
                pageView.classList.add('is-hidden');
                pageView.style.setProperty('display', 'none', 'important');
            }
            syncDocumentsSubheadInfo();
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
        syncDocumentsSubheadInfo();
    }

    function renderDocumentFolderTree() {
        const tree = $('documentsFolderTree');
        if (!tree) return;
        const counts = folderCounts();
        const drawings = drawingDocuments();
        const attachments = attachmentDocuments();

        // Asynchronously ensure any PDF missing a page count gets calculated sequentially in background
        drawings.forEach(doc => {
            if (doc.extension === 'pdf' && (!doc.pageCount || doc.pageCount <= 0)) {
                enqueuePdfPageCount(doc);
            }
        });

        const allDrawingsChecked = drawings.length > 0 && drawings.every(d => selectedDocumentCheckboxIds.has(String(d.id)));
        const someDrawingsChecked = drawings.some(d => selectedDocumentCheckboxIds.has(String(d.id)));
        const allAttachmentsChecked = attachments.length > 0 && attachments.every(d => selectedDocumentCheckboxIds.has(String(d.id)));
        const someAttachmentsChecked = attachments.some(d => selectedDocumentCheckboxIds.has(String(d.id)));

        const isAttachmentsActive = selectedDocumentsFolder === 'attachments';

        // Group drawings by smart discipline classification
        const groupedDrawings = new Map();
        DRAWING_DISCIPLINES.forEach(disc => groupedDrawings.set(disc.key, []));
        drawings.forEach(doc => {
            const discKey = classifyDrawingDiscipline(doc);
            if (!groupedDrawings.has(discKey)) groupedDrawings.set(discKey, []);
            groupedDrawings.get(discKey).push(doc);
        });

        const disciplineGroupsHtml = DRAWING_DISCIPLINES.map(disc => {
            const groupDocs = groupedDrawings.get(disc.key) || [];
            if (!groupDocs.length) return '';
            const isCollapsed = collapsedDisciplines.has(disc.key);
            const isDiscActive = selectedDocumentsFolder === `discipline:${disc.key}`;
            const allGroupChecked = groupDocs.every(d => selectedDocumentCheckboxIds.has(String(d.id)));

            const childrenHtml = isCollapsed ? '' : groupDocs.map(doc => {
                const pageVal = doc.pageCount || (doc.pages && doc.pages.length) || '';
                const isDocActive = selectedDocumentsFolder === `document:${doc.id}`;
                const isDocChecked = selectedDocumentCheckboxIds.has(String(doc.id));
                return `
                    <div class="doc-tree-item child ${isDocActive ? 'active' : ''} ${isDocChecked ? 'is-checked' : ''}" data-doc-folder="document:${escapeHtml(doc.id)}" data-drag-doc-id="${escapeHtml(doc.id)}" draggable="true">
                        <input type="checkbox" class="doc-sidebar-check" data-doc-check-id="${escapeHtml(doc.id)}" ${isDocChecked ? 'checked' : ''} title="Select document">
                        <div class="doc-tree-child-details">
                            <span class="doc-tree-item-title" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
                        </div>
                        <div class="doc-tree-row-actions">
                            ${pageVal ? `<span class="doc-tree-item-badge">${escapeHtml(pageVal)}</span>` : `<span class="doc-tree-badge-spacer" aria-hidden="true"></span>`}
                            <button class="btn-ghost icon-only doc-tree-item-more" type="button" data-doc-sidebar-more="doc:${escapeHtml(doc.id)}" title="Document options"><i class="fas fa-ellipsis-vertical"></i></button>
                        </div>
                    </div>`;
            }).join('');

            return `
                <div class="doc-discipline-group ${isCollapsed ? 'is-collapsed' : ''}" data-discipline-group="${escapeHtml(disc.key)}">
                    <div class="doc-discipline-group-head ${isDiscActive ? 'active' : ''} ${allGroupChecked ? 'is-checked' : ''}" data-doc-folder="discipline:${escapeHtml(disc.key)}" data-discipline-key="${escapeHtml(disc.key)}">
                        <input type="checkbox" class="doc-sidebar-check" data-doc-check-discipline="${escapeHtml(disc.key)}" ${allGroupChecked ? 'checked' : ''} title="Select all ${escapeHtml(disc.label)} drawings">
                        <div class="doc-tree-folder-title is-discipline-level">
                            <button type="button" class="doc-discipline-chevron" data-doc-toggle-discipline="${escapeHtml(disc.key)}" title="${isCollapsed ? 'Expand group' : 'Collapse group'}">
                                <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'}"></i>
                            </button>
                            ${renderDisciplinePill(disc, 'is-sidebar-pill')}
                        </div>
                        <div class="doc-tree-row-actions">
                            <span class="doc-tree-item-badge">${groupDocs.length}</span>
                            <span class="doc-tree-more-spacer" aria-hidden="true"></span>
                        </div>
                    </div>
                    <div class="doc-discipline-group-items">
                        ${childrenHtml}
                    </div>
                </div>
            `;
        }).join('');

        tree.innerHTML = `
            <div class="doc-tree-item doc-tree-root ${selectedDocumentsFolder === 'drawings' ? 'active' : ''} ${allDrawingsChecked ? 'is-checked' : ''}" data-doc-folder="drawings">
                <input type="checkbox" class="doc-sidebar-check" data-doc-check-group="drawings" ${allDrawingsChecked ? 'checked' : ''} title="Select all drawings">
                <div class="doc-tree-folder-title">
                    <button type="button" class="doc-discipline-chevron" data-doc-toggle-root="drawings" title="${isDrawingsRootCollapsed ? 'Expand Drawings' : 'Collapse Drawings'}">
                        <i class="fas fa-chevron-${isDrawingsRootCollapsed ? 'right' : 'down'}"></i>
                    </button>
                    <span class="doc-tree-root-name"><strong>Drawings</strong></span>
                </div>
                <div class="doc-tree-row-actions">
                    <span class="doc-tree-item-badge">${counts.drawings}</span>
                    <button class="btn-ghost icon-only doc-tree-item-more" type="button" data-doc-sidebar-more="category:Drawings" title="Drawings options"><i class="fas fa-ellipsis-vertical"></i></button>
                </div>
            </div>
            <div class="documents-folder-children ${isDrawingsRootCollapsed ? 'is-collapsed' : ''}">
                ${disciplineGroupsHtml}
            </div>
            <div class="doc-tree-item doc-tree-root ${isAttachmentsActive ? 'active' : ''} ${allAttachmentsChecked ? 'is-checked' : ''}" data-doc-folder="attachments">
                <input type="checkbox" class="doc-sidebar-check" data-doc-check-group="attachments" ${allAttachmentsChecked ? 'checked' : ''} title="Select all attachments">
                <div class="doc-tree-folder-title">
                    <span class="doc-tree-root-caret-spacer" aria-hidden="true"></span>
                    <span class="doc-tree-root-name"><strong>Attachments</strong></span>
                </div>
                <div class="doc-tree-row-actions">
                    <span class="doc-tree-item-badge">${counts.attachments}</span>
                    <button class="btn-ghost icon-only doc-tree-item-more" type="button" data-doc-sidebar-more="category:Attachments" title="Attachment options"><i class="fas fa-ellipsis-vertical"></i></button>
                </div>
            </div>
        `;

        const drawingsMasterCheck = tree.querySelector('[data-doc-check-group="drawings"]');
        if (drawingsMasterCheck) {
            drawingsMasterCheck.indeterminate = !allDrawingsChecked && someDrawingsChecked;
        }
        const attachmentsMasterCheck = tree.querySelector('[data-doc-check-group="attachments"]');
        if (attachmentsMasterCheck) {
            attachmentsMasterCheck.indeterminate = !allAttachmentsChecked && someAttachmentsChecked;
        }
        tree.querySelectorAll('[data-doc-check-discipline]').forEach(chk => {
            const key = chk.dataset.docCheckDiscipline;
            const docs = groupedDrawings.get(key) || [];
            const allChk = docs.length > 0 && docs.every(d => selectedDocumentCheckboxIds.has(String(d.id)));
            const someChk = docs.some(d => selectedDocumentCheckboxIds.has(String(d.id)));
            chk.indeterminate = !allChk && someChk;
        });

        tree.querySelectorAll('.doc-sidebar-check').forEach(chk => {
            chk.addEventListener('click', e => e.stopPropagation());
            chk.addEventListener('change', e => {
                e.stopPropagation();
                const checked = chk.checked;
                if (chk.dataset.docCheckId) {
                    const id = String(chk.dataset.docCheckId);
                    if (checked) selectedDocumentCheckboxIds.add(id);
                    else selectedDocumentCheckboxIds.delete(id);
                } else if (chk.dataset.docCheckDiscipline) {
                    const key = chk.dataset.docCheckDiscipline;
                    const docs = groupedDrawings.get(key) || [];
                    docs.forEach(d => {
                        if (checked) selectedDocumentCheckboxIds.add(String(d.id));
                        else selectedDocumentCheckboxIds.delete(String(d.id));
                    });
                } else if (chk.dataset.docCheckGroup === 'drawings') {
                    drawings.forEach(d => {
                        if (checked) selectedDocumentCheckboxIds.add(String(d.id));
                        else selectedDocumentCheckboxIds.delete(String(d.id));
                    });
                } else if (chk.dataset.docCheckGroup === 'attachments') {
                    attachments.forEach(d => {
                        if (checked) selectedDocumentCheckboxIds.add(String(d.id));
                        else selectedDocumentCheckboxIds.delete(String(d.id));
                    });
                }
                renderDocumentsPage();
            });
        });

        tree.querySelectorAll('[data-doc-toggle-root="drawings"]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                isDrawingsRootCollapsed = !isDrawingsRootCollapsed;
                renderDocumentFolderTree();
            });
        });

        tree.querySelectorAll('[data-doc-toggle-discipline]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const key = btn.dataset.docToggleDiscipline;
                if (collapsedDisciplines.has(key)) collapsedDisciplines.delete(key);
                else collapsedDisciplines.add(key);
                renderDocumentFolderTree();
            });
        });

        tree.querySelectorAll('[data-doc-folder]').forEach(row => {
            row.addEventListener('click', (e) => {
                if (
                    e.target.closest('.doc-tree-item-more') ||
                    e.target.closest('[data-doc-action]') ||
                    e.target.closest('.doc-drag-handle') ||
                    e.target.closest('.doc-sidebar-check') ||
                    e.target.closest('[data-doc-toggle-discipline]') ||
                    e.target.closest('[data-doc-toggle-root]')
                ) return;
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

    function canDropDocumentsInCurrentView() {
        if (allDocumentRows().length === 0) return true;
        return selectedDocumentsFolder === 'drawings' || selectedDocumentsFolder.startsWith('discipline:');
    }

    async function renderDocumentsContent() {
        const list = $('documentsList');
        if (!list) return;
        const renderSeq = ++documentsContentRenderSeq;
        cleanupThumbnailObserver();
        const title = $('documentsContentTitle');
        const isAttachments = selectedDocumentsFolder === 'attachments';
        const isPackage = selectedDocumentsFolder.startsWith('document:');
        const isDiscipline = selectedDocumentsFolder.startsWith('discipline:');
        const contentFooter = $('documentsContentFooter');
        if (contentFooter) {
            const canDrop = selectedDocumentsFolder === 'drawings' || isDiscipline;
            contentFooter.style.display = canDrop ? 'flex' : 'none';
        }

        if (title) {
            if (isPackage) {
                const docId = selectedDocumentsFolder.replace('document:', '');
                const docObj = findDocumentById(docId);
                const discMeta = getDisciplineMeta(classifyDrawingDiscipline(docObj));
                const docName = selectedFolderDocumentName();
                title.innerHTML = `
                    <div class="doc-topbar-breadcrumb">
                        <span class="doc-breadcrumb-link" data-doc-breadcrumb="drawings">Drawings</span>
                        <span class="doc-breadcrumb-sep"><i class="fas fa-chevron-right"></i></span>
                        <span class="doc-breadcrumb-link" data-doc-breadcrumb="discipline:${escapeHtml(discMeta.key)}">${escapeHtml(discMeta.label)}</span>
                        <span class="doc-breadcrumb-sep"><i class="fas fa-chevron-right"></i></span>
                        <span class="doc-breadcrumb-current">${escapeHtml(docName)}</span>
                    </div>
                `;
            } else if (isDiscipline) {
                const discKey = selectedDocumentsFolder.replace('discipline:', '');
                const discMeta = getDisciplineMeta(discKey);
                title.innerHTML = `
                    <div class="doc-topbar-breadcrumb">
                        <span class="doc-breadcrumb-link" data-doc-breadcrumb="drawings">Drawings</span>
                        <span class="doc-breadcrumb-sep"><i class="fas fa-chevron-right"></i></span>
                        <span class="doc-breadcrumb-current">${escapeHtml(discMeta.label)}</span>
                    </div>
                `;
            } else if (isAttachments) {
                title.textContent = 'Attachments';
            } else {
                title.textContent = 'Drawings';
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
            if (!isDocumentsTabActive()) {
                documentsNeedsRenderOnTabEnter = true;
                return;
            }
            const docId = selectedDocumentsFolder.replace('document:', '');
            const doc = allDocumentRows().find(r => r.id === docId);
            if (!doc) {
                list.className = 'documents-list';
                list.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Document not found.</div>`;
                return;
            }
            if ((!Array.isArray(doc.pages) || !doc.pages.length) && (!doc.pageCount || Number(doc.pageCount) <= 0)) {
                list.className = 'documents-list';
                list.innerHTML = `
                    <div class="doc-panel-loading-state" role="status" aria-live="polite">
                        <span class="doc-loading-spinner" aria-hidden="true"></span>
                        <span class="doc-loading-title">Loading drawing sheets...</span>
                        <span class="doc-loading-sub">${escapeHtml(doc.name || 'Document')}</span>
                    </div>
                `;
            }
            const sheets = await getDocumentSheets(doc);
            if (renderSeq !== documentsContentRenderSeq) return;
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

        // 3. Drawings / Discipline Filtered View (File List View)
        const docs = sortedDocuments(filteredDocuments(documentsForSelectedFolder()));
        if (!docs.length) {
            list.className = 'documents-list';
            list.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">${query ? 'No files match your search.' : 'No files in this group yet.'}</div>`;
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
        const cachedUrl = getCachedSheetThumbUrl(doc, sheet.pageNumber || 1);
        return `
            <div class="doc-list-item-row ${isActive ? 'active' : ''}" data-doc-sheet-id="${escapeHtml(sheet.id)}" data-parent-doc-id="${escapeHtml(doc.id)}" data-page-num="${sheet.pageNumber}">
                <div class="doc-item-thumb-box" data-doc-action="select-sheet" data-doc-id="${escapeHtml(sheet.id)}">
                    ${cachedUrl ? `<img class="doc-sheet-canvas" id="img-${cId}" src="${cachedUrl}" alt="${escapeHtml(sheet.name)}" loading="lazy" decoding="async" style="display:block;">` : ''}
                    <canvas class="doc-sheet-canvas" id="canvas-${cId}" style="display:none;"></canvas>
                    <div class="doc-sheet-blueprint" id="bp-${cId}" ${cachedUrl ? 'style="display:none;"' : ''}>
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
        const docKey = String(doc.id);
        const rawImgUrl = doc.path || sessionFileUrls.get(docKey) || '';
        const thumbImgUrl = imageThumbnailUrlCache.get(docKey) || rawImgUrl;
        const isChecked = selectedDocumentCheckboxIds.has(docKey);

        let thumbHtml = '';
        if (isImage && thumbImgUrl) {
            thumbHtml = `<img id="att-img-${cleanDocId}" src="${escapeHtml(thumbImgUrl)}" alt="${escapeHtml(doc.name)}" loading="lazy" decoding="async" style="width: 100%; height: 100%; object-fit: contain;">`;
        } else if (isPdf) {
            const cachedPdfThumb = getCachedSheetThumbUrl(doc, 1);
            thumbHtml = `
                ${cachedPdfThumb ? `<img class="doc-sheet-canvas" id="img-${cleanDocId}" src="${cachedPdfThumb}" alt="${escapeHtml(doc.name)}" loading="lazy" decoding="async" style="display:block;">` : ''}
                <canvas class="doc-sheet-canvas" id="canvas-${cleanDocId}" style="display:none;"></canvas>
                <div class="doc-attachment-thumb" id="bp-${cleanDocId}" ${cachedPdfThumb ? 'style="display:none;"' : ''}>
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
            <div class="doc-list-item-row ${selectedDocumentsId === doc.id ? 'active' : ''} ${isChecked ? 'is-checked' : ''}" data-doc-id="${escapeHtml(doc.id)}">
                <input type="checkbox" class="doc-sidebar-check doc-row-check" data-doc-list-check-id="${escapeHtml(doc.id)}" ${isChecked ? 'checked' : ''} title="Select document">
                <div class="doc-item-thumb-box doc-attachment-preview-trigger" data-doc-action="preview-attachment" data-doc-id="${escapeHtml(doc.id)}" title="Click to preview attachment">
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
        const isChecked = selectedDocumentCheckboxIds.has(String(doc.id));
        const discMeta = getDisciplineMeta(classifyDrawingDiscipline(doc));
        return `<div class="doc-file-row ${selectedDocumentsId === doc.id ? 'active' : ''} ${isChecked ? 'is-checked' : ''}" data-doc-id="${escapeHtml(doc.id)}">
            <div class="doc-file-info" data-doc-action="select" data-doc-id="${escapeHtml(doc.id)}">
                <input type="checkbox" class="doc-sidebar-check doc-row-check" data-doc-list-check-id="${escapeHtml(doc.id)}" ${isChecked ? 'checked' : ''} title="Select document">
                <span class="doc-file-name" title="${escapeHtml(doc.name || doc.title || 'Document')}">${escapeHtml(doc.name || doc.title || 'Document')}</span>
                ${renderDisciplinePill(discMeta, 'is-row-pill')}
            </div>
            <div class="doc-file-actions">
                <button class="btn-ghost icon-only" type="button" data-doc-action="menu" data-doc-id="${escapeHtml(doc.id)}" title="Options">
                    <i class="fas fa-ellipsis-vertical"></i>
                </button>
                <div class="documents-menu row-menu" data-doc-menu="${escapeHtml(doc.id)}">
                    <button type="button" data-doc-action="view" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-eye"></i> View</button>
                    <button type="button" data-doc-action="rename" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-pen"></i> Rename</button>
                    <button type="button" data-doc-action="download" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-download"></i> Download</button>
                    <button type="button" class="danger" data-doc-action="delete" data-doc-id="${escapeHtml(doc.id)}"><i class="fas fa-trash"></i> Delete</button>
                </div>
            </div>
        </div>`;
    }

    function bindDocumentListActions(root) {
        if (root.dataset.documentActionsBound === '1') return;
        root.dataset.documentActionsBound = '1';

        root.addEventListener('change', event => {
            const chk = event.target.closest('[data-doc-list-check-id]');
            if (!chk) return;
            event.stopPropagation();
            const docId = String(chk.dataset.docListCheckId);
            if (chk.checked) selectedDocumentCheckboxIds.add(docId);
            else selectedDocumentCheckboxIds.delete(docId);
            renderDocumentsPage();
        });

        root.addEventListener('click', event => {
            if (event.target.closest('[data-doc-list-check-id]')) {
                event.stopPropagation();
                return;
            }

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
                const pageNum = sheetRow.dataset.pageNum ? Number(sheetRow.dataset.pageNum) : 1;
                const parentDoc = findDocumentById(sheetRow.dataset.parentDocId);
                if (parentDoc) openDocumentInBrowser(parentDoc, pageNum);
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

    function openRenameModal(options) { return overviewDialogs.openRenameModal(options); }
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
        const isOpen = (menu.classList.contains('open') && menu.__activeTarget === target) ||
                       (trigger && trigger.__wasOpenAtPointerDown && Date.now() - trigger.__wasOpenAtPointerDown < 500);
        if (trigger) trigger.__wasOpenAtPointerDown = 0;
        closeAllDocumentsMenus();
        if (isOpen) {
            menu.__activeTarget = null;
            return;
        }
        menu.__activeTarget = target;
        menu.__trigger = trigger;
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        let html = '';
        if (target.startsWith('doc:')) {
            const docId = target.replace('doc:', '');
            const doc = findDocumentById(docId);
            if (!doc) return;
            const currentDisc = classifyDrawingDiscipline(doc);
            const discButtons = DRAWING_DISCIPLINES.map(d => `
                <button type="button" data-sidebar-action="set-discipline" data-id="${escapeHtml(docId)}" data-discipline="${escapeHtml(d.key)}" style="${d.key === currentDisc ? 'color: var(--primary); font-weight: 700;' : ''}">
                    <span class="bb-status-dot" style="background-color: ${d.color}; display: inline-block; flex-shrink: 0;"></span> ${escapeHtml(d.label)}${d.key === currentDisc ? ' ✓' : ''}
                </button>
            `).join('');
            html = `
                <button type="button" data-sidebar-action="view-doc" data-id="${escapeHtml(docId)}"><i class="fas fa-eye"></i> View File</button>
                <button type="button" data-sidebar-action="rename-doc" data-id="${escapeHtml(docId)}"><i class="fas fa-pen"></i> Rename</button>
                <button type="button" data-sidebar-action="download-doc" data-id="${escapeHtml(docId)}"><i class="fas fa-download"></i> Download</button>
                <div class="documents-menu-eyebrow" style="margin-top: 4px; border-top: 1px solid var(--border-soft); padding-top: 6px;">Drawing Group</div>
                ${discButtons}
                <button type="button" class="danger" data-sidebar-action="delete-doc" data-id="${escapeHtml(docId)}" style="color: #ef4444; margin-top: 4px; border-top: 1px solid var(--border-soft);"><i class="fas fa-trash"></i> Delete</button>
            `;
        } else if (target === 'category:Drawings') {
            html = `
                <button type="button" data-sidebar-action="upload-category" data-cat="Drawings"><i class="fas fa-upload"></i> Upload drawing</button>
                <button type="button" data-sidebar-action="expand-disciplines"><i class="fas fa-angles-down"></i> Expand all groups</button>
                <button type="button" data-sidebar-action="collapse-disciplines"><i class="fas fa-angles-up"></i> Collapse all groups</button>
                <button type="button" data-sidebar-action="sort-folders"><i class="fas fa-arrow-down-a-z"></i> Sort drawings A–Z</button>
            `;
        } else if (target === 'category:Attachments') {
            html = `
                <button type="button" data-sidebar-action="upload-category" data-cat="Attachments"><i class="fas fa-paperclip"></i> Upload attachment</button>
            `;
        } else {
            // header:folders
            html = `
                <button type="button" data-sidebar-action="expand-disciplines"><i class="fas fa-angles-down"></i> Expand all groups</button>
                <button type="button" data-sidebar-action="collapse-disciplines"><i class="fas fa-angles-up"></i> Collapse all groups</button>
                <button type="button" data-sidebar-action="sort-folders"><i class="fas fa-arrow-down-a-z"></i> Sort drawings A–Z</button>
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

    function showConfirmDialog(options) { return overviewDialogs.showConfirmDialog(options); }
    window.showConfirmDialog = showConfirmDialog;

    function showAlertDialog(options) { return overviewDialogs.showAlertDialog(options); }

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
        } else if (action === 'set-discipline') {
            const discKey = btn?.dataset?.discipline;
            if (id && discKey) {
                saveDisciplineOverride(id, discKey);
                collapsedDisciplines.delete(discKey);
                renderDocumentsPage();
                const discMeta = getDisciplineMeta(discKey);
                showToast(`Moved to ${discMeta.label}.`);
            }
        } else if (action === 'expand-disciplines') {
            isDrawingsRootCollapsed = false;
            collapsedDisciplines.clear();
            renderDocumentFolderTree();
        } else if (action === 'collapse-disciplines') {
            DRAWING_DISCIPLINES.forEach(d => collapsedDisciplines.add(d.key));
            renderDocumentFolderTree();
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

    let currentAttachmentPreviewId = null;

    function getPreviewableAttachmentList(currentDoc = null) {
        const filtered = sortedDocuments(filteredDocuments(attachmentDocuments()));
        if (currentDoc && filtered.some(d => String(d.id) === String(currentDoc.id))) {
            return filtered;
        }
        const allAtt = sortedDocuments(attachmentDocuments());
        if (currentDoc && allAtt.some(d => String(d.id) === String(currentDoc.id))) {
            return allAtt;
        }
        return currentDoc ? [currentDoc] : allAtt;
    }

    function closeAttachmentPreviewModal() {
        const modal = $('pdAttachmentPreviewModal');
        if (!modal) return;
        modal.classList.remove('open');
        const viewport = modal.querySelector('#docAttachmentPreviewViewport');
        if (viewport) viewport.innerHTML = '';
    }

    function navigateAttachmentPreview(delta) {
        const currentDoc = currentAttachmentPreviewId ? findDocumentById(currentAttachmentPreviewId) : null;
        const list = getPreviewableAttachmentList(currentDoc);
        if (list.length <= 1) return;
        const currentIndex = list.findIndex(d => String(d.id) === String(currentAttachmentPreviewId));
        const baseIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = (baseIndex + delta + list.length) % list.length;
        const nextDoc = list[nextIndex];
        if (nextDoc) {
            selectedDocumentsId = nextDoc.id;
            document.querySelectorAll('.doc-list-item-row[data-doc-id]').forEach(row => {
                row.classList.toggle('active', String(row.dataset.docId) === String(nextDoc.id));
            });
            openAttachmentPreviewModal(nextDoc);
        }
    }

    function ensureAttachmentPreviewModal() {
        let modal = $('pdAttachmentPreviewModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'pdAttachmentPreviewModal';
        modal.className = 'pd-modal-backdrop doc-attachment-preview-backdrop';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'docAttachmentPreviewTitle');
        modal.innerHTML = `
            <div class="pd-modal doc-attachment-preview-modal">
                <div class="pd-modal-head doc-attachment-preview-head">
                    <div class="doc-attachment-preview-title-wrap">
                        <i class="far fa-file-image doc-attachment-preview-type-icon" id="docAttachmentPreviewIcon"></i>
                        <h3 id="docAttachmentPreviewTitle">
                            <span id="docAttachmentPreviewName">Attachment Preview</span>
                        </h3>
                        <span class="doc-attachment-preview-counter" id="docAttachmentPreviewCounter">1 / 1</span>
                        <span class="doc-attachment-preview-meta" id="docAttachmentPreviewMeta"></span>
                    </div>
                    <div class="doc-attachment-preview-actions">
                        <button type="button" class="doc-custom-btn" id="docAttachmentDownloadBtn" title="Download file">
                            <i class="fas fa-download"></i> Download
                        </button>
                        <button type="button" class="doc-custom-btn" id="docAttachmentOpenTabBtn" title="Open in new tab">
                            <i class="fas fa-arrow-up-right-from-square"></i> Open
                        </button>
                        <button type="button" class="pd-modal-head-close" id="docAttachmentPreviewCloseBtn" title="Close preview" aria-label="Close preview">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="doc-attachment-preview-body" id="docAttachmentPreviewBody">
                    <button type="button" class="doc-attachment-nav-btn is-prev" id="docAttachmentPrevBtn" title="Previous attachment (←)" aria-label="Previous attachment">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <div class="doc-attachment-preview-viewport" id="docAttachmentPreviewViewport"></div>
                    <button type="button" class="doc-attachment-nav-btn is-next" id="docAttachmentNextBtn" title="Next attachment (→)" aria-label="Next attachment">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target.closest('#docAttachmentPreviewCloseBtn')) {
                e.preventDefault();
                e.stopPropagation();
                closeAttachmentPreviewModal();
                return;
            }
            if (e.target.closest('#docAttachmentPrevBtn')) {
                e.preventDefault();
                e.stopPropagation();
                navigateAttachmentPreview(-1);
                return;
            }
            if (e.target.closest('#docAttachmentNextBtn')) {
                e.preventDefault();
                e.stopPropagation();
                navigateAttachmentPreview(1);
                return;
            }
            if (!e.target.closest('.doc-attachment-preview-modal')) {
                closeAttachmentPreviewModal();
            }
        });

        return modal;
    }

    function openAttachmentPreviewModal(doc) {
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

        currentAttachmentPreviewId = doc.id;
        const modal = ensureAttachmentPreviewModal();
        const list = getPreviewableAttachmentList(doc);
        const currentIdx = Math.max(0, list.findIndex(d => String(d.id) === String(doc.id)));

        const iconEl = modal.querySelector('#docAttachmentPreviewIcon');
        const nameEl = modal.querySelector('#docAttachmentPreviewName');
        const counterEl = modal.querySelector('#docAttachmentPreviewCounter');
        const metaEl = modal.querySelector('#docAttachmentPreviewMeta');
        const viewportEl = modal.querySelector('#docAttachmentPreviewViewport');
        const openBtn = modal.querySelector('#docAttachmentOpenTabBtn');
        const downloadBtn = modal.querySelector('#docAttachmentDownloadBtn');
        const prevBtn = modal.querySelector('#docAttachmentPrevBtn');
        const nextBtn = modal.querySelector('#docAttachmentNextBtn');

        const ext = String(doc.extension || '').toLowerCase();
        const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'tif', 'tiff', 'heic'].includes(ext);
        const isPdf = ext === 'pdf';

        if (iconEl) {
            iconEl.className = `far ${isPdf ? 'fa-file-pdf' : isImage ? 'fa-file-image' : 'fa-file'} doc-attachment-preview-type-icon`;
            iconEl.style.color = isPdf ? '#ef4444' : 'var(--primary, #fb5a3a)';
        }
        if (nameEl) {
            nameEl.textContent = doc.name || doc.filename || 'Attachment Preview';
            nameEl.title = doc.name || doc.filename || '';
        }
        if (counterEl) {
            counterEl.textContent = `${currentIdx + 1} / ${list.length}`;
            counterEl.style.display = list.length > 0 ? 'inline-flex' : 'none';
        }
        if (metaEl) {
            const parts = [];
            if (doc.extension) parts.push(String(doc.extension).toUpperCase());
            if (doc.size) parts.push(formatBytes(doc.size));
            metaEl.textContent = parts.join(' • ');
            metaEl.style.display = parts.length ? 'inline-flex' : 'none';
        }
        if (openBtn) {
            openBtn.onclick = () => openDocumentInBrowser(doc);
        }
        if (downloadBtn) {
            downloadBtn.onclick = () => handleDocumentAction('download', doc.id);
        }
        if (prevBtn) {
            prevBtn.disabled = list.length <= 1;
            prevBtn.classList.toggle('is-hidden', list.length <= 1);
        }
        if (nextBtn) {
            nextBtn.disabled = list.length <= 1;
            nextBtn.classList.toggle('is-hidden', list.length <= 1);
        }

        if (viewportEl) {
            if (isImage) {
                viewportEl.innerHTML = `
                    <div class="doc-attachment-preview-loader" id="docAttachmentPreviewLoader" role="status" aria-live="polite">
                        <span class="doc-loading-spinner" aria-hidden="true"></span>
                        <span>Loading image...</span>
                    </div>
                    <div class="doc-attachment-preview-stage">
                        <img src="${escapeHtml(url)}" alt="${escapeHtml(doc.name || 'Attachment')}" class="doc-attachment-preview-img" id="docAttachmentPreviewImgEl" style="opacity: 0; transition: opacity 0.18s ease;">
                    </div>
                `;
                const imgEl = viewportEl.querySelector('#docAttachmentPreviewImgEl');
                const loaderEl = viewportEl.querySelector('#docAttachmentPreviewLoader');
                if (imgEl) {
                    const done = () => {
                        if (loaderEl) loaderEl.remove();
                        imgEl.style.opacity = '1';
                    };
                    if (imgEl.complete && imgEl.naturalWidth > 0) {
                        done();
                    } else {
                        imgEl.addEventListener('load', done, { once: true });
                        imgEl.addEventListener('error', () => {
                            if (loaderEl) loaderEl.remove();
                            imgEl.style.opacity = '1';
                        }, { once: true });
                    }
                }
            } else if (isPdf) {
                viewportEl.innerHTML = `
                    <div class="doc-attachment-preview-loader" id="docAttachmentPreviewLoader" role="status" aria-live="polite">
                        <span class="doc-loading-spinner" aria-hidden="true"></span>
                        <span>Loading PDF preview...</span>
                    </div>
                    <iframe src="${escapeHtml(url)}" class="doc-attachment-preview-frame" id="docAttachmentPreviewFrameEl" title="${escapeHtml(doc.name || 'PDF Preview')}"></iframe>
                `;
                const frameEl = viewportEl.querySelector('#docAttachmentPreviewFrameEl');
                const loaderEl = viewportEl.querySelector('#docAttachmentPreviewLoader');
                if (frameEl && loaderEl) {
                    const removeLoader = () => { if (loaderEl.isConnected) loaderEl.remove(); };
                    frameEl.addEventListener('load', removeLoader, { once: true });
                    setTimeout(removeLoader, 1800);
                }
            } else {
                viewportEl.innerHTML = `
                    <div class="doc-attachment-preview-fallback">
                        <i class="far fa-file"></i>
                        <p>${escapeHtml(doc.name || 'File')}</p>
                    </div>
                `;
            }
        }

        modal.classList.add('open');
    }

    async function handleDocumentAction(action, id, trigger = null) {
        if (action === 'menu' || action === 'sheet-menu') {
            const menu = [...document.querySelectorAll('.documents-menu.row-menu')]
                .find(candidate => candidate.dataset.docMenu === String(id));
            if (!menu) return;
            const isOpen = menu.classList.contains('open') ||
                           (trigger && trigger.__wasOpenAtPointerDown && Date.now() - trigger.__wasOpenAtPointerDown < 500);
            if (trigger) trigger.__wasOpenAtPointerDown = 0;
            closeAllDocumentsMenus();
            if (!isOpen && trigger) {
                menu.classList.add('open');
                menu.__trigger = trigger;
                trigger.classList.add('active');
                trigger.setAttribute('aria-expanded', 'true');
                positionFloatingMenu(menu, trigger);
            }
            return;
        }

        const doc = findDocumentById(id);
        if (!doc) return;
        closeAllDocumentsMenus();

        if (action === 'preview-attachment') {
            selectedDocumentsId = doc.id;
            openAttachmentPreviewModal(doc);
            return;
        }
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
            const pageNum = trigger?.dataset?.pageNum ? Number(trigger.dataset.pageNum) : 1;
            startDocumentsTakeoff(pageNum);
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
                    selectedDocumentCheckboxIds.delete(String(id));
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
                selectedDocumentCheckboxIds.delete(String(id));
                persistLocalDocuments();
                syncDocumentsToProjectState();
                if (selectedDocumentsId === id) selectedDocumentsId = null;
                if (selectedDocumentsFolder === `document:${id}`) selectedDocumentsFolder = 'drawings';
                renderDocumentsPage();
                showToast('Document deleted.');
                return;
            }
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
        const isOpen = menu.classList.contains('open') ||
                       (trigger && trigger.__wasOpenAtPointerDown && Date.now() - trigger.__wasOpenAtPointerDown < 500);
        if (trigger) trigger.__wasOpenAtPointerDown = 0;
        closeAllDocumentsMenus();
        if (!isOpen && trigger) {
            menu.classList.add('open');
            menu.__trigger = trigger;
            trigger.classList.add('active');
            trigger.setAttribute('aria-expanded', 'true');
            positionFloatingMenu(menu, trigger);
        }
    }

    function closeAllDocumentsMenus() {
        document.querySelectorAll('.documents-menu.open').forEach(menu => {
            menu.classList.remove('open');
            menu.style.display = '';
            if (menu.__trigger) {
                menu.__trigger.classList.remove('active', 'is-active');
                menu.__trigger.setAttribute('aria-expanded', 'false');
                menu.__trigger = null;
            }
        });
        const sidebarMenu = $('docSidebarMenu');
        if (sidebarMenu) {
            sidebarMenu.classList.remove('open');
            sidebarMenu.style.display = '';
            sidebarMenu.__activeTarget = null;
            if (sidebarMenu.__trigger) {
                sidebarMenu.__trigger.classList.remove('active', 'is-active');
                sidebarMenu.__trigger.setAttribute('aria-expanded', 'false');
                sidebarMenu.__trigger = null;
            }
        }
        document.querySelectorAll('[data-doc-sidebar-more].active, [data-doc-action="menu"].active, [data-doc-action="sheet-menu"].active, [data-doc-folder-more].active, [data-doc-folder-menu-toggle].active, [data-doc-view-menu-toggle].active, #docSortMenuBtn.active, .doc-tree-item-more.active').forEach(b => {
            b.classList.remove('active', 'is-active');
            b.setAttribute('aria-expanded', 'false');
        });
    }

    function initSidebarResizer() {
        const resizer = $('docSidebarResizer');
        const sidebar = $('documentsSidebar');
        if (!resizer || !sidebar) return;

        try {
            const savedWidth = localStorage.getItem('takeoff.documentsSidebarWidth');
            if (savedWidth) {
                const w = Math.max(170, Math.min(650, parseInt(savedWidth, 10)));
                sidebar.style.setProperty('--doc-sidebar-w', `${w}px`);
                sidebar.style.width = `${w}px`;
                sidebar.style.flexBasis = `${w}px`;
            }
        } catch (_) {}

        let isDragging = false;
        let startX = 0;
        let startWidth = 240;

        resizer.addEventListener('pointerdown', (e) => {
            isDragging = true;
            startX = e.clientX;
            const currentComputed = parseInt(getComputedStyle(sidebar).width, 10) || 240;
            startWidth = currentComputed;
            resizer.classList.add('is-dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
        });

        resizer.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            const deltaX = (e.clientX - startX) / zoom;
            const newWidth = Math.max(170, Math.min(650, Math.round(startWidth + deltaX)));
            sidebar.style.setProperty('--doc-sidebar-w', `${newWidth}px`);
            sidebar.style.width = `${newWidth}px`;
            sidebar.style.flexBasis = `${newWidth}px`;
        });

        const stopDragging = (e) => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('is-dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try {
                if (e?.pointerId) resizer.releasePointerCapture(e.pointerId);
            } catch (_) {}

            const finalWidth = parseInt(getComputedStyle(sidebar).width, 10) || 240;
            try {
                localStorage.setItem('takeoff.documentsSidebarWidth', finalWidth);
            } catch (_) {}
        };

        resizer.addEventListener('pointerup', stopDragging);
        resizer.addEventListener('pointercancel', stopDragging);
    }

    function sortDocumentFolders() {
        const drawings = [...allDocumentRows().filter(doc => doc.category === 'Drawings')];
        drawings.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
        setFolderReorderList(drawings.map(d => String(d.id)));
        documentSortBy = 'name';
        renderDocumentsPage();
        showToast('Drawings sorted A–Z.');
    }

    async function startDocumentsTakeoff(targetPage = 1) {
        if (startTakeoffInFlight) return;
        startTakeoffInFlight = true;
        const startButton = $('documentsStartTakeoffBtn');
        const topMoveBtn = $('docMoveToTakeoffBtn');
        const origTopMoveHtml = topMoveBtn ? topMoveBtn.innerHTML : '';
        if (startButton) startButton.disabled = true;
        if (topMoveBtn) {
            topMoveBtn.disabled = true;
            topMoveBtn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Opening Takeoff...`;
        }
        try {
            const drawings = drawingDocuments();
            if (!drawings.length) {
                showToast('Upload drawings before starting takeoff.');
                return;
            }
            let targetPageNum = Number(targetPage) || 1;
            let doc = findDocumentById(selectedDocumentsId);
            if (!doc && typeof selectedDocumentsId === 'string' && selectedDocumentsId.includes('-p')) {
                const parts = selectedDocumentsId.split('-p');
                const parsedDoc = findDocumentById(parts[0]);
                if (parsedDoc) {
                    doc = parsedDoc;
                    const p = parseInt(parts[1], 10);
                    if (!isNaN(p) && p > 0) targetPageNum = p;
                }
            }
            if (!doc && selectedDocumentsFolder.startsWith('document:')) {
                const folderDocId = selectedDocumentsFolder.replace('document:', '');
                doc = findDocumentById(folderDocId);
            }
            if (!doc) {
                doc = drawings[0];
            }
            selectedDocumentsId = doc.id;
            let takeoffFileId = doc.backendId || doc.id;
            if (doc.source === 'local') {
                let file = sessionFiles.get(String(doc.id));
                if (!file) {
                    const existingMatch = (window.ProjectState?.documents || []).find(row =>
                        row.source === 'legacy_file' &&
                        (row.filename === doc.filename || row.title === doc.filename || row.filename === doc.name)
                    );
                    if (existingMatch && existingMatch.id) {
                        takeoffFileId = Number(existingMatch.id);
                        doc.backendId = takeoffFileId;
                        doc.source = 'existing';
                        doc.originalSource = 'legacy_file';
                    }
                }
                if (!file && doc.source === 'local') {
                    showToast('Select this PDF again so it can be uploaded for Takeoff.');
                    openDocumentPicker('Drawings');
                    return;
                }
                if (file) {
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
            if (typeof window.projectTakeoffRefreshDrawings === 'function') window.projectTakeoffRefreshDrawings(takeoffFileId);
            if (typeof window.activateTakeoffDocument === 'function') {
                window.activateTakeoffDocument(takeoffFileId, targetPageNum);
            } else {
                const frame = $('takeoffFrame');
                const empty = $('takeoffEmpty');
                if (frame) {
                    frame.src = `editor.php?id=${encodeURIComponent(takeoffFileId)}&embedded=1`;
                    frame.style.display = 'block';
                }
                if (empty) empty.style.display = 'none';
            }
        } finally {
            startTakeoffInFlight = false;
            if (startButton) startButton.disabled = false;
            if (topMoveBtn) {
                topMoveBtn.disabled = false;
                topMoveBtn.innerHTML = origTopMoveHtml;
            }
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
        const input = $('documentsBrowseInput');
        if (input) {
            input.setAttribute('accept', DOCUMENT_ACCEPT_FILTER);
            input.click();
        }
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
        document.addEventListener('click', (event) => {
            if (event && event.target && event.target.closest('.documents-menu, [data-menu-toggle], [data-doc-sidebar-more], [data-doc-action="menu"], [data-doc-action="sheet-menu"], [data-doc-folder-more], [data-doc-folder-menu-toggle], [data-doc-view-menu-toggle], #docSortMenuBtn, .doc-tree-item-more')) return;
            document.querySelectorAll('.project-menu').forEach(menu => menu.classList.remove('open'));
            document.querySelectorAll('.documents-menu').forEach(menu => menu.classList.remove('open'));
            $('projectStatusMenu')?.classList.remove('open');
            $('pdPresenceMenu')?.classList.remove('open');
            document.querySelector('.project-subhead-wrapper')?.classList.remove('has-open-menu');
        });

        // Multi-User Real-Time Presence System
        const FAKE_PRESENCE_NAMES = [
            'sarah jenkins', 'marcus vance', 'carlos rodriguez',
            'elena rostova', 'michael chang', 'david miller',
            'amanda brooks', 'ana lopez', 'sarah connor'
        ];

        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && (k.startsWith('takeoff_presence_') || k.startsWith('takeoff_active_presence_'))) {
                    localStorage.removeItem(k);
                }
            }
        } catch (e) { }

        const currentUserPresence = window.ProjectPresenceUser || {
            id: 1,
            name: 'User (You)',
            initials: 'US',
            color: '#5b4364',
            role: 'Estimator',
            isSelf: true
        };
        const currentPresenceProjId = window.ProjectState?.id || window.WonProjectConfig?.projectId || 0;
        const PRESENCE_STORAGE_KEY = 'takeoff_active_presence_p_' + currentPresenceProjId;
        const presenceClientId = 'client_' + Math.random().toString(36).substring(2, 9);

        function updatePresenceHeartbeat() {
            try {
                let data = {};
                const raw = localStorage.getItem(PRESENCE_STORAGE_KEY);
                if (raw) data = JSON.parse(raw);
                const now = Date.now();
                // Expire users unseen for > 8s and prune fake legacy names
                Object.keys(data).forEach(k => {
                    const u = data[k];
                    const isOld = !u || (now - (u.lastSeen || 0)) > 8000;
                    const isFake = u && FAKE_PRESENCE_NAMES.some(f => (u.name || '').toLowerCase().includes(f));
                    if (isOld || isFake) {
                        delete data[k];
                    }
                });
                data[presenceClientId] = {
                    id: currentUserPresence.id,
                    name: currentUserPresence.name,
                    initials: currentUserPresence.initials,
                    color: currentUserPresence.color,
                    role: currentUserPresence.role,
                    lastSeen: now
                };
                localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(data));
            } catch (e) { }
        }

        function getActivePresenceList() {
            try {
                const raw = localStorage.getItem(PRESENCE_STORAGE_KEY);
                if (!raw) return [{ ...currentUserPresence, isSelf: true }];
                const data = JSON.parse(raw);
                const now = Date.now();
                const list = [];
                const seenUserIds = new Set();

                // Add self first
                list.push({ ...currentUserPresence, isSelf: true });
                seenUserIds.add(String(currentUserPresence.id));

                Object.keys(data).forEach(k => {
                    if (k === presenceClientId) return;
                    const u = data[k];
                    if (!u) return;
                    const isFake = FAKE_PRESENCE_NAMES.some(f => (u.name || '').toLowerCase().includes(f));
                    if (isFake) return;
                    if ((now - (u.lastSeen || 0)) <= 8000) {
                        const uid = String(u.id);
                        if (!seenUserIds.has(uid)) {
                            seenUserIds.add(uid);
                            list.push({
                                ...u,
                                isSelf: false
                            });
                        }
                    }
                });
                return list;
            } catch (e) {
                return [{ ...currentUserPresence, isSelf: true }];
            }
        }

        function removePresenceClient() {
            try {
                const raw = localStorage.getItem(PRESENCE_STORAGE_KEY);
                if (raw) {
                    const data = JSON.parse(raw);
                    delete data[presenceClientId];
                    localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(data));
                }
            } catch (e) { }
        }

        window.ProjectPresence = {
            users: getActivePresenceList(),
            getUsers() { return this.users; },
            setUsers(newUsers) {
                this.users = Array.isArray(newUsers) ? newUsers : [];
                this.render();
            },
            syncRealtime() {
                updatePresenceHeartbeat();
                this.users = getActivePresenceList();
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
                            <span>${escapeHtml(u.initials || (u.name || 'U').slice(0, 2).toUpperCase())}</span>
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
                            <div class="pd-presence-avatar ${u.isSelf ? 'self' : ''}" style="background: ${u.color || '#5b4364'}; width: 24px; height: 24px; font-size: 9.5px; margin: 0;">
                                <span>${escapeHtml(u.initials || (u.name || 'U').slice(0, 2).toUpperCase())}</span>
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

        window.ProjectPresence.syncRealtime();
        setInterval(() => window.ProjectPresence.syncRealtime(), 5000);
        window.addEventListener('storage', (e) => {
            if (e.key === PRESENCE_STORAGE_KEY) {
                window.ProjectPresence.users = getActivePresenceList();
                window.ProjectPresence.render();
            }
        });
        window.addEventListener('beforeunload', removePresenceClient);

        $('pdPresenceStack')?.addEventListener('click', (e) => {
            e.stopPropagation();
            $('pdPresenceMenu')?.classList.toggle('open');
        });

        $('projectStatusButton')?.addEventListener('click', event => {
            event.stopPropagation();
            $('projectStatusMenu')?.classList.toggle('open');
        });

        function openCustomerModal() {
            setEditingDirectoryCustomer(null);
            setCustomerModalView('form');
            populateCustomerSelector();
            $('pdCustomerModal')?.classList.add('open');
        }
        function closeCustomerModal() {
            setEditingDirectoryCustomer(null);
            setCustomerModalView('form');
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
        $('customerFilledRow')?.addEventListener('click', openCustomerModal);
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
                if (backdrop.id === 'pdDocumentUploadModal') return;
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
        $('openCustomerDirectoryBtn')?.addEventListener('click', () => {
            setCustomerModalView(customerModalView === 'directory' ? 'form' : 'directory');
        });
        $('customerDirectoryBackBtn')?.addEventListener('click', () => setCustomerModalView('form'));
        $('customerDirectoryNewBtn')?.addEventListener('click', () => {
            clearCustomerFields();
            setCustomerModalView('form');
            setTimeout(() => $('poCustomerCompany')?.focus(), 40);
        });
        $('cancelEditDirectoryCustomerBtn')?.addEventListener('click', () => setEditingDirectoryCustomer(null));
        $('poCustomerDirectorySearch')?.addEventListener('input', renderCustomerDirectory);
        $('poCustomerDirectoryList')?.addEventListener('click', async event => {
            const useBtn = event.target.closest('[data-dir-use]');
            if (useBtn) {
                selectCustomerByIndex(Number(useBtn.dataset.dirUse), { editDirectory: false });
                setCustomerModalView('form');
                return;
            }
            const editBtn = event.target.closest('[data-dir-edit]');
            if (editBtn) {
                selectCustomerByIndex(Number(editBtn.dataset.dirEdit), { editDirectory: true });
                setCustomerModalView('form');
                setTimeout(() => $('poCustomerCompany')?.focus(), 40);
                return;
            }
            const deleteBtn = event.target.closest('[data-dir-delete]');
            if (deleteBtn) {
                await deleteDirectoryCustomer(Number(deleteBtn.dataset.dirDelete));
            }
        });
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

        overviewDialogs.bindRenameForm();

        document.querySelectorAll('[data-doc-folder-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.docFolderAction;
                if (action === 'expand-all') {
                    isDrawingsRootCollapsed = false;
                    collapsedDisciplines.clear();
                    renderDocumentFolderTree();
                }
                if (action === 'collapse-all') {
                    DRAWING_DISCIPLINES.forEach(d => collapsedDisciplines.add(d.key));
                    renderDocumentFolderTree();
                }
                if (action === 'sort') sortDocumentFolders();
                closeAllDocumentsMenus();
            });
        });

        $('documentsSubheadItemInfo')?.addEventListener('click', (event) => {
            const docActionBtn = event.target.closest('[data-doc-subhead-action]');
            if (!docActionBtn) return;
            event.preventDefault();
            event.stopPropagation();
            const action = docActionBtn.dataset.docSubheadAction;
            if (action === 'delete-all') {
                deleteSelectedDocuments();
            }
        });

        $('documentsContentFooter')?.addEventListener('click', () => {
            if (!canDropDocumentsInCurrentView()) return;
            openDocumentPicker(categoryForSelectedFolder());
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
        const contentFooter = $('documentsContentFooter');

        [emptyView, pageView].filter(Boolean).forEach(zone => {
            ['dragenter', 'dragover'].forEach(eventName => {
                zone.addEventListener(eventName, event => {
                    if (draggedDocId) return;
                    const types = Array.from(event.dataTransfer?.types || []);
                    if (types.length && !types.includes('Files')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (zone === pageView && !canDropDocumentsInCurrentView()) {
                        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
                        zone.classList.remove('is-dragover');
                        if (contentFooter) contentFooter.classList.remove('is-dragover');
                        return;
                    }
                    zone.classList.add('is-dragover');
                    if (emptyBox && zone === emptyView) emptyBox.classList.add('is-dragover');
                    if (contentFooter && zone === pageView) contentFooter.classList.add('is-dragover');
                });
            });
            zone.addEventListener('dragleave', event => {
                if (draggedDocId) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
                zone.classList.remove('is-dragover');
                if (emptyBox && zone === emptyView) emptyBox.classList.remove('is-dragover');
                if (contentFooter && zone === pageView) contentFooter.classList.remove('is-dragover');
            });
            zone.addEventListener('drop', event => {
                if (draggedDocId) return;
                const dtFiles = event.dataTransfer?.files;
                if (!dtFiles || !dtFiles.length) return;
                event.preventDefault();
                event.stopPropagation();
                zone.classList.remove('is-dragover');
                if (emptyBox && zone === emptyView) emptyBox.classList.remove('is-dragover');
                if (contentFooter && zone === pageView) contentFooter.classList.remove('is-dragover');
                if (zone === pageView && !canDropDocumentsInCurrentView()) {
                    return;
                }
                addFiles(dtFiles, null);
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
            const previewModal = $('pdAttachmentPreviewModal');
            if (previewModal && previewModal.classList.contains('open')) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeAttachmentPreviewModal();
                    return;
                }
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    navigateAttachmentPreview(-1);
                    return;
                }
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    navigateAttachmentPreview(1);
                    return;
                }
            }
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
            if (!href || href === '#' || href.startsWith('#') || href.startsWith('javascript:')
                || href.startsWith('blob:') || href.startsWith('data:')
                || href.startsWith('mailto:') || href.startsWith('tel:')
                || link.hasAttribute('download') || link.dataset.noNavGuard === '1'
                || link.target === '_blank') return;

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

        function ensureTemplateActionModal() {
            let backdrop = $('pdTemplateActionModal');
            if (backdrop) return backdrop;
            backdrop = document.createElement('div');
            backdrop.id = 'pdTemplateActionModal';
            backdrop.className = 'pd-modal-backdrop';
            backdrop.innerHTML = `
                <div class="pd-modal" style="max-width: 520px; width: 92vw;" role="dialog" aria-modal="true" aria-labelledby="pdTemplateModalTitle">
                    <div class="pd-modal-head">
                        <h3 id="pdTemplateModalTitle" style="margin:0;font-size:15px;font-weight:700;">Project Template</h3>
                        <button type="button" class="pd-modal-head-close" id="pdTemplateModalClose" aria-label="Close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="pd-modal-body" id="pdTemplateModalBody" style="display:flex;flex-direction:column;gap:12px;"></div>
                    <div class="pd-modal-foot">
                        <button type="button" class="btn-ghost" id="pdTemplateModalCancel">Cancel</button>
                        <button type="button" class="btn-main orange" id="pdTemplateModalConfirm">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(backdrop);
            const close = () => backdrop.classList.remove('open');
            backdrop.querySelector('#pdTemplateModalClose')?.addEventListener('click', close);
            backdrop.querySelector('#pdTemplateModalCancel')?.addEventListener('click', close);
            backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
            return backdrop;
        }

        function escHtml(v) {
            return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
        }

        function ensureProjectSavedForTemplateAction(actionDescription, onContinue) {
            if (!checkIsDirty()) {
                return Promise.resolve().then(onContinue);
            }
            if (window.TakeoffAnnouncement) {
                window.TakeoffAnnouncement.show({
                    type: 'warning',
                    force: true,
                    title: 'Unsaved Changes in Project',
                    badge: 'UNSAVED CHANGES',
                    content: `<p>You have made changes to this project that have not been saved yet.</p>
                              <div class="g-announcement-highlight-box" style="border-left-color: #f59e0b;">
                                  Save all changes across Overview, Takeoff, and Estimating before ${escHtml(actionDescription)}?
                              </div>`,
                    primaryText: 'Save & Continue',
                    cancelText: 'Go Back',
                    showDontShow: false,
                    onPrimary: async () => {
                        await Promise.resolve();
                        try {
                            await saveProject({ silent: true, throwOnError: true });
                            await onContinue();
                        } catch (err) {
                            console.error('Failed to save project before template action:', err);
                        }
                    },
                    onCancel: () => {}
                });
                return;
            }
            if (confirm(`You have unsaved changes. Save project before ${actionDescription}?`)) {
                return saveProject({ silent: true, throwOnError: true }).then(() => onContinue()).catch(() => {});
            }
        }

        async function openConvertToTemplateDialog() {
            const projectId = Number(window.ProjectState?.projectId || 0);
            if (projectId <= 0) {
                showToast('Please save the project first before converting it to a template.');
                return;
            }
            return ensureProjectSavedForTemplateAction('converting it to a template', () => {
                const currentName = ($('poEstimateName')?.value || window.ProjectState?.projectInfo?.name || 'Project').trim();
                const suggested = /template$/i.test(currentName) ? currentName : `${currentName} Template`;
                const modal = ensureTemplateActionModal();
                modal.querySelector('#pdTemplateModalTitle').innerHTML = '<i class="fas fa-layer-group" style="color:#0d9488;margin-right:6px;"></i> Convert to Template';
                modal.querySelector('#pdTemplateModalBody').innerHTML = `
                    <p class="pd-template-modal-desc" style="margin:0;font-size:13px;line-height:1.45;">
                        Creates a clean copy of this project in the <strong>Templates</strong> stage with all Estimating and Takeoff quantities reset to <strong>0</strong>. Your current project will remain unchanged.
                    </p>
                    <label class="pd-template-field-label" style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;font-weight:600;">
                        <span>Template Name</span>
                        <input type="text" id="pdConvertTemplateNameInput" class="pd-input" value="${escHtml(suggested)}" placeholder="Template name" style="padding:8px 10px;border:1px solid var(--border,#cbd5e1);border-radius:6px;font-size:13px;">
                    </label>
                `;
                const confirmBtn = modal.querySelector('#pdTemplateModalConfirm');
                confirmBtn.textContent = 'Create Template';
                confirmBtn.disabled = false;
                modal.classList.add('open');
                setTimeout(() => modal.querySelector('#pdConvertTemplateNameInput')?.focus(), 40);

                confirmBtn.onclick = async () => {
                    const nameInput = modal.querySelector('#pdConvertTemplateNameInput');
                    const tplName = (nameInput?.value || '').trim();
                    if (!tplName) {
                        nameInput?.focus();
                        return;
                    }
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = 'Converting...';
                    try {
                        await saveProject({ silent: true, throwOnError: true });
                        const res = await request('convert_to_template', { id: projectId, name: tplName });
                        modal.classList.remove('open');
                        const createdId = Number(res.project_id || res.id || 0);
                        showToast(`Template "${res.name || tplName}" created in Templates stage.`);
                        if (createdId > 0 && typeof window.showConfirmDialog === 'function') {
                            const go = await window.showConfirmDialog({
                                title: 'Template Created',
                                message: `"${res.name || tplName}" was created in the Templates stage with quantities set to 0. Do you want to open the new template now?`,
                                confirmText: 'Open Template',
                                cancelText: 'Stay Here',
                                type: 'info',
                                badge: 'TEMPLATES',
                                icon: 'fas fa-layer-group'
                            });
                            if (go) {
                                isDirty = false;
                                window.location.href = `project_dashboard.php?id=${encodeURIComponent(createdId)}&tab=estimating`;
                            }
                        }
                    } catch (err) {
                        showToast(err?.message || 'Could not convert project to template.');
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = 'Create Template';
                    }
                };
            });
        }

        async function openApplyTemplateDialog() {
            const projectId = Number(window.ProjectState?.projectId || 0);
            if (projectId <= 0) {
                showToast('Please save the project first before applying a template.');
                return;
            }
            return ensureProjectSavedForTemplateAction('applying a template', async () => {
                const modal = ensureTemplateActionModal();
                modal.querySelector('#pdTemplateModalTitle').innerHTML = '<i class="fas fa-wand-magic-sparkles" style="color:#0d9488;margin-right:6px;"></i> Apply Template';
                modal.querySelector('#pdTemplateModalBody').innerHTML = '<div style="padding:12px 0;font-size:13px;color:var(--muted,#64748b);">Loading available templates...</div>';
                const confirmBtn = modal.querySelector('#pdTemplateModalConfirm');
                confirmBtn.textContent = 'Apply Template';
                confirmBtn.disabled = true;
                modal.classList.add('open');

                try {
                    const resp = await fetch(`${apiUrl}?action=templates`, { cache: 'no-store' });
                    const data = await resp.json();
                    const templates = Array.isArray(data?.templates) ? data.templates : [];
                    if (!templates.length) {
                        modal.querySelector('#pdTemplateModalBody').innerHTML = '<p style="margin:0;font-size:13px;color:#dc2626;">No templates are currently available.</p>';
                        return;
                    }
                    modal.querySelector('#pdTemplateModalBody').innerHTML = `
                        <p class="pd-template-modal-desc" style="margin:0;font-size:13px;line-height:1.45;">
                            Creates a <strong>new empty estimate</strong> in this project prefixed with <code>TMPLT_</code> and copies all groups, items, assemblies, Takeoff layers, and settings from the chosen template.
                        </p>
                        <label class="pd-template-field-label" style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;font-weight:600;">
                            <span>Select Template</span>
                            <select id="pdApplyTemplateSelect" class="pd-input" style="padding:8px 10px;border:1px solid var(--border,#cbd5e1);border-radius:6px;font-size:13px;">
                                ${templates.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.name)}${t.trade ? ` (${escHtml(t.trade)})` : ''}</option>`).join('')}
                            </select>
                        </label>
                        <div id="pdApplyTemplatePreview" class="pd-template-preview-box"></div>
                    `;
                    const sel = modal.querySelector('#pdApplyTemplateSelect');
                    const preview = modal.querySelector('#pdApplyTemplatePreview');
                    const refreshPreview = () => {
                        const chosen = templates.find(t => String(t.id) === String(sel?.value));
                        if (!chosen || !preview) return;
                        const prefixed = String(chosen.name || '').startsWith('TMPLT_') ? chosen.name : `TMPLT_${chosen.name}`;
                        preview.innerHTML = `<strong>New Estimate:</strong> ${escHtml(prefixed)}${chosen.description ? `<br><span>${escHtml(chosen.description)}</span>` : ''}`;
                    };
                    sel?.addEventListener('change', refreshPreview);
                    refreshPreview();
                    confirmBtn.disabled = false;

                    confirmBtn.onclick = async () => {
                        const tplId = Number(sel?.value || 0);
                        if (tplId <= 0) return;
                        confirmBtn.disabled = true;
                        confirmBtn.textContent = 'Applying...';
                        try {
                            await saveProject({ silent: true, throwOnError: true });
                            const res = await request('apply_template', { id: projectId, template_id: tplId });
                            const clientEstId = res?.estimate?.client_estimate_id || '';
                            try {
                                if (clientEstId) {
                                    sessionStorage.setItem(`takeoff.pendingActivateEstimateId.${projectId}`, clientEstId);
                                }
                                localStorage.removeItem(`takeoff_project_groups_${projectId}`);
                            } catch (_) {}
                            isDirty = false;
                            modal.classList.remove('open');
                            window.location.href = `project_dashboard.php?id=${encodeURIComponent(projectId)}&tab=estimating`;
                        } catch (err) {
                            showToast(err?.message || 'Could not apply template.');
                            confirmBtn.disabled = false;
                            confirmBtn.textContent = 'Apply Template';
                        }
                    };
                } catch (err) {
                    modal.querySelector('#pdTemplateModalBody').innerHTML = `<p style="margin:0;font-size:13px;color:#dc2626;">${escHtml(err?.message || 'Error loading templates.')}</p>`;
                }
            });
        }

        $('projectActionsMenu')?.addEventListener('click', async event => {
            const btn = event.target?.closest?.('[data-project-action]');
            if (!btn) return;
            event.stopPropagation();
            $('projectActionsMenu')?.classList.remove('open');
            const action = btn.dataset.projectAction;
            const projectId = Number(window.ProjectState?.projectId || 0);
            if (action === 'convert-template') return openConvertToTemplateDialog();
            if (action === 'apply-template') return openApplyTemplateDialog();
            if (projectId <= 0) {
                showToast('Please save the project first.');
                return;
            }
            if (action === 'copy') {
                const ok = typeof window.showConfirmDialog === 'function'
                    ? await window.showConfirmDialog({
                        title: 'Copy Project',
                        message: 'Create a full duplicate of this project including documents, takeoffs, and estimates?',
                        confirmText: 'Copy Project',
                        cancelText: 'Cancel',
                        type: 'info',
                        icon: 'fas fa-copy'
                    })
                    : window.confirm('Create a copy of this project?');
                if (!ok) return;
                try {
                    const res = await request('copy', { id: projectId });
                    if (res?.id) {
                        isDirty = false;
                        window.location.href = `project_dashboard.php?id=${encodeURIComponent(res.id)}&tab=overview`;
                    }
                } catch (err) {
                    showToast(err?.message || 'Could not copy project.');
                }
            } else if (action === 'archive') {
                const ok = typeof window.showConfirmDialog === 'function'
                    ? await window.showConfirmDialog({
                        title: 'Archive Project',
                        message: 'Move this project to Archived stage?',
                        confirmText: 'Archive',
                        cancelText: 'Cancel',
                        type: 'warning',
                        icon: 'fas fa-box-archive'
                    })
                    : window.confirm('Archive this project?');
                if (!ok) return;
                await changeProjectStatus('archived');
            } else if (action === 'delete') {
                const projLabel = ($('poEstimateName')?.value || window.ProjectState?.projectInfo?.name || `Project #${projectId}`).trim();
                const safeProjLabel = escHtml(projLabel || 'this project');
                const ok = typeof window.showConfirmDialog === 'function'
                    ? await window.showConfirmDialog({
                        title: 'Delete Project',
                        message: `Are you sure you want to delete <strong>"${safeProjLabel}"</strong>? It will be moved to the deleted archive and hidden from the Bid Board.`,
                        confirmText: 'Delete Project',
                        cancelText: 'Cancel',
                        type: 'error',
                        badge: 'DELETE',
                        icon: 'fas fa-trash',
                        primaryDanger: true
                    })
                    : window.confirm(`Are you sure you want to delete "${projLabel}"?`);
                if (!ok) return;
                try {
                    await request('delete', { id: projectId });
                    isDirty = false;
                    window.location.href = 'bid_board.php';
                } catch (err) {
                    showToast(err?.message || 'Could not delete project.');
                }
            }
        });
        if (Number(window.ProjectState?.projectId || 0) > 0 && window.ProjectState?.projectInfo?.status) {
            syncProjectBidBoardReturnStage(false);
        }
    });
})();
