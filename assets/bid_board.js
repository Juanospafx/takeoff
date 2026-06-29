(function () {
    const apiUrl = '../api/bid_board.php';
    const pipelineStatuses = ['Draft', 'Invited', 'Bidding', 'Submitted', 'Awarded', 'Lost'];
    const statusAliases = {
        draft: 'Draft',
        invitations: 'Invited',
        invited: 'Invited',
        to_do: 'Draft',
        estimating: 'Bidding',
        bidding: 'Bidding',
        bid_submitted: 'Submitted',
        submitted: 'Submitted',
        accepted: 'Awarded',
        awarded: 'Awarded',
        in_progress: 'Awarded',
        complete: 'Awarded',
        estimadores: 'Bidding',
        lost: 'Lost',
        archived: 'Lost'
    };

    let state = { statuses: [], estimators: [], templates: [], dashboard: [], bids: [] };
    let activeStatus = 'Bidding';
    let sortDirection = 'asc';
    let editingId = null;
    let projectBidId = null;
    let usingMockData = false;

    const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 0
    }).format(Number(value || 0));

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[ch]));

    const toDate = (value) => {
        if (!value) return null;
        const date = new Date(String(value).replace(' ', 'T'));
        return Number.isNaN(date.getTime()) ? null : date;
    };

    const fmtDate = (value) => {
        const date = toDate(value);
        return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
    };

    const daysUntil = (value) => {
        const date = toDate(value);
        if (!date) return 'No due date';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        date.setHours(0, 0, 0, 0);
        const days = Math.round((date - today) / 86400000);
        if (days === 0) return 'Due today';
        if (days > 0) return `Due in ${days} day${days === 1 ? '' : 's'}`;
        return `Overdue by ${Math.abs(days)} day${days === -1 ? '' : 's'}`;
    };

    const initials = (name) => String(name || 'UA')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase() || 'UA';

    const statusSlug = (status) => String(status || 'Draft').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    function request(action, payload = {}) {
        return fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        }).then(r => r.json()).then(data => {
            if (data.status !== 'success') throw new Error(data.msg || 'Bid Board request failed');
            return data;
        });
    }

    function load() {
        return fetch(`${apiUrl}?action=list`)
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.msg || 'Bid Board could not load');
                state = data.data;
                usingMockData = !state.bids || state.bids.length === 0;
                if (usingMockData) {
                    state = mockState(state);
                }
                if (!normalizedBids().some(bid => bid.status === activeStatus)) {
                    activeStatus = pipelineStatuses.find(status => normalizedBids().some(bid => bid.status === status)) || 'Draft';
                }
                render();
            })
            .catch(err => {
                state = mockState();
                usingMockData = true;
                showError(`${err.message}. Showing local sample bid data.`);
                render();
            });
    }

    function mockState(base = {}) {
        const statuses = pipelineStatuses.map((name, index) => ({
            id: `mock-${statusSlug(name)}`,
            code: statusSlug(name),
            name,
            sort_order: (index + 1) * 10
        }));
        const estimators = [
            { id: 'mock-jp', display_name: 'Juan Pablo', email: 'juan@brightronix.com' },
            { id: 'mock-ar', display_name: 'Ava Roberts', email: 'ava@brightronix.com' },
            { id: 'mock-ms', display_name: 'Marco Silva', email: 'marco@brightronix.com' }
        ];
        const bids = [
            mockBid(1, 'Electrical Package - Building A', 'Commercial / New Construction', 'Brighton Development Group', 'kelly@brightondev.com', 'PRJ-1042', '2026-07-15', 125400, 'Juan Pablo', 'Bidding'),
            mockBid(2, 'Low Voltage Systems - North Tower', 'Technology / Tenant Improvement', 'Summit Medical Partners', 'rachel@summitmed.com', 'PRJ-1088', '2026-07-09', 86300, 'Ava Roberts', 'Invited'),
            mockBid(3, 'Parking Garage Lighting Retrofit', 'Infrastructure / Retrofit', 'Harborview Properties', 'matt@harborview.com', 'PRJ-0997', '2026-06-27', 214750, 'Marco Silva', 'Submitted'),
            mockBid(4, 'Main Service Upgrade', 'Industrial / Service', 'Vector Logistics', 'procurement@vectorlog.com', 'PRJ-1101', '2026-07-22', 342900, 'Juan Pablo', 'Draft'),
            mockBid(5, 'Hotel Guestroom Power Rough-In', 'Hospitality / Renovation', 'Luna Hospitality Group', 'sandra@lunahotels.com', 'PRJ-1059', '2026-07-03', 498000, 'Ava Roberts', 'Bidding'),
            mockBid(6, 'Warehouse Distribution Controls', 'Industrial / Controls', 'Redwood Fulfillment', 'ops@redwoodfulfill.com', 'PRJ-1120', '2026-08-04', 276450, 'Marco Silva', 'Awarded'),
            mockBid(7, 'Emergency Generator Scope', 'Healthcare / Backup Power', 'Central Care Viera', 'facilities@ccviera.com', 'PRJ-1073', '2026-06-29', 188200, 'Juan Pablo', 'Bidding'),
            mockBid(8, 'Shell Building Lighting Package', 'Commercial / Shell', 'Oakland Exchange LLC', 'bids@oaklandexchange.com', 'PRJ-1035', '2026-07-18', 154800, 'Ava Roberts', 'Invited'),
            mockBid(9, 'Restaurant TI Electrical', 'Retail / Tenant Improvement', 'Platinum Celebrations', 'nina@platinumti.com', 'PRJ-1064', '2026-07-11', 93900, 'Marco Silva', 'Lost'),
            mockBid(10, 'Photometrics Revision Package', 'Site / Exterior Lighting', 'Meridian Civil Group', 'design@meridiancivil.com', 'PRJ-1019', '2026-07-01', 61250, 'Juan Pablo', 'Submitted'),
            mockBid(11, 'School Gym Modernization', 'Education / Renovation', 'Evergreen School District', 'sam@evergreenschools.org', 'PRJ-1092', '2026-07-26', 319700, 'Ava Roberts', 'Draft'),
            mockBid(12, 'Auto Shop Permit Set', 'Automotive / New Construction', 'Yuexing Auto Group', 'permits@yuexingauto.com', 'PRJ-1008', '2026-06-25', 227600, 'Marco Silva', 'Lost')
        ];
        return {
            statuses: base.statuses && base.statuses.length ? mergePipelineStatuses(base.statuses) : statuses,
            estimators: base.estimators && base.estimators.length ? base.estimators : estimators,
            templates: base.templates || [],
            dashboard: base.dashboard || [],
            bids
        };
    }

    function mockBid(id, recordName, category, requestingEntity, requestingContact, projectId, dueDate, totalValue, responsibleName, status) {
        return {
            id: `mock-${id}`,
            name: recordName,
            category,
            requester_company: requestingEntity,
            requesting_contact: requestingContact,
            project_name_snapshot: projectId,
            due_at: `${dueDate} 12:00:00`,
            total_amount: totalValue,
            currency_code: 'USD',
            estimator_name: responsibleName,
            responsible_initials: initials(responsibleName),
            status_name: status,
            status_code: statusSlug(status),
            notes: 'Sample bid board record'
        };
    }

    function mergePipelineStatuses(apiStatuses) {
        const existing = new Map();
        apiStatuses.forEach(status => {
            const canonical = canonicalStatus(status);
            const code = String(status?.code || '').toLowerCase();
            const name = String(status?.name || '').toLowerCase();
            const isExact = code === statusSlug(canonical) || name === canonical.toLowerCase();
            if (!existing.has(canonical) || isExact) {
                existing.set(canonical, status);
            }
        });
        return pipelineStatuses.map((name, index) => existing.get(name) || {
            id: `virtual-${statusSlug(name)}`,
            code: statusSlug(name),
            name,
            sort_order: (index + 1) * 10
        });
    }

    function canonicalStatus(row) {
        const code = String(row?.status_code || row?.code || '').toLowerCase();
        const name = String(row?.status_name || row?.name || '').toLowerCase();
        return statusAliases[code] || statusAliases[name] || pipelineStatuses.find(status => status.toLowerCase() === name) || 'Draft';
    }

    function normalizedBids() {
        return (state.bids || []).map((bid, index) => {
            const responsibleName = bid.estimator_name || bid.responsibleName || 'Unassigned';
            const projectId = bid.project_name_snapshot || bid.bid_number || `BID-${String(index + 1).padStart(4, '0')}`;
            return {
                ...bid,
                status: canonicalStatus(bid),
                recordName: bid.name || bid.recordName || 'Untitled bid',
                category: bid.category || inferCategory(bid.notes) || 'Commercial / Electrical',
                requestingEntity: bid.requester_company || bid.requestingEntity || 'Unassigned requester',
                requestingContact: bid.requesting_contact || bid.requestingContact || bid.email || 'contact pending',
                projectId,
                dueDate: bid.due_at || bid.dueDate,
                totalValue: Number(bid.total_amount ?? bid.totalValue ?? 0),
                responsibleName,
                responsibleInitials: bid.responsible_initials || initials(responsibleName),
                currency: bid.currency_code || 'USD'
            };
        });
    }

    function inferCategory(notes) {
        const text = String(notes || '');
        const match = text.match(/category:\s*([^;]+)/i);
        return match ? match[1].trim() : '';
    }

    function visibleBids() {
        const q = document.getElementById('bbSearch')?.value.trim().toLowerCase() || '';
        const sortBy = document.getElementById('bbSortBy')?.value || 'dueDate';
        const direction = sortDirection === 'asc' ? 1 : -1;
        return normalizedBids()
            .filter(bid => bid.status === activeStatus)
            .filter(bid => {
                const haystack = [
                    bid.recordName,
                    bid.requestingEntity,
                    bid.requestingContact,
                    bid.projectId,
                    bid.responsibleName
                ].join(' ').toLowerCase();
                return !q || haystack.includes(q);
            })
            .sort((a, b) => compareBids(a, b, sortBy) * direction);
    }

    function compareBids(a, b, sortBy) {
        if (sortBy === 'dueDate') return (toDate(a.dueDate)?.getTime() || 0) - (toDate(b.dueDate)?.getTime() || 0);
        if (sortBy === 'totalValue') return a.totalValue - b.totalValue;
        if (sortBy === 'recordName') return a.recordName.localeCompare(b.recordName);
        if (sortBy === 'requestingEntity') return a.requestingEntity.localeCompare(b.requestingEntity);
        if (sortBy === 'responsible') return a.responsibleName.localeCompare(b.responsibleName);
        return 0;
    }

    function statusSummary() {
        const bids = normalizedBids();
        return pipelineStatuses.map(status => {
            const statusBids = bids.filter(bid => bid.status === status);
            return {
                name: status,
                count: statusBids.length,
                total: statusBids.reduce((sum, bid) => sum + bid.totalValue, 0)
            };
        });
    }

    function render() {
        renderPipelineTabs();
        renderTable();
        renderFormOptions();
        renderSortIcon();
    }

    function renderPipelineTabs() {
        const root = document.getElementById('bbPipelineTabs');
        root.innerHTML = statusSummary().map(row => `
            <button class="bb-pipeline-tab ${row.name === activeStatus ? 'active' : ''}" type="button" data-status="${esc(row.name)}">
                <span class="bb-tab-label">${esc(row.name)} (${row.count})</span>
                <span class="bb-tab-total">${money(row.total)}</span>
            </button>
        `).join('');
        root.querySelectorAll('[data-status]').forEach(tab => {
            tab.addEventListener('click', () => {
                activeStatus = tab.dataset.status;
                render();
            });
        });
    }

    function renderTable() {
        const body = document.getElementById('bbTableBody');
        const bids = visibleBids();
        body.innerHTML = bids.map(bid => `
            <tr>
                <td>
                    <a class="bb-record-name" href="#" data-action="view" data-id="${esc(bid.id)}">${esc(bid.recordName)}</a>
                    <span class="bb-subtext">${esc(bid.category)}</span>
                </td>
                <td class="bb-metrics-cell">
                    <span class="bb-metrics-btn" title="Metrics"><i class="fas fa-chart-column"></i></span>
                </td>
                <td>
                    <strong>${esc(bid.requestingEntity)}</strong>
                    <span class="bb-subtext">${esc(bid.requestingContact)}</span>
                </td>
                <td>${esc(bid.projectId)}</td>
                <td>
                    <strong>${fmtDate(bid.dueDate)}</strong>
                    <span class="bb-subtext">${esc(daysUntil(bid.dueDate))}</span>
                </td>
                <td class="bb-money">${money(bid.totalValue, bid.currency)}</td>
                <td>
                    <span class="bb-responsible">
                        <span class="bb-avatar">${esc(bid.responsibleInitials)}</span>
                        <span>${esc(bid.responsibleName)}</span>
                    </span>
                </td>
                <td>${statusBadge(bid.status)}</td>
                <td>
                    <div class="bb-row-actions">
                        <button class="bb-btn secondary" data-action="view" data-id="${esc(bid.id)}">View</button>
                        <button class="bb-btn secondary" data-action="edit" data-id="${esc(bid.id)}" ${usingMockData ? 'disabled' : ''}>Edit</button>
                        <button class="bb-btn secondary" data-action="create-project" data-id="${esc(bid.id)}" ${usingMockData || bid.project_id ? 'disabled' : ''}>Project</button>
                    </div>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="9" class="bb-empty-row">No bids match the current status, search, and sort criteria.</td></tr>`;

        body.querySelectorAll('[data-action]').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                handleAction(button.dataset.action, button.dataset.id);
            });
        });
    }

    function statusBadge(status) {
        return `<span class="bb-status-badge bb-status-${statusSlug(status)}">${esc(status)}</span>`;
    }

    function renderSortIcon() {
        const icon = document.querySelector('#bbSortDir i');
        if (!icon) return;
        icon.className = sortDirection === 'asc' ? 'fas fa-arrow-down-wide-short' : 'fas fa-arrow-up-short-wide';
    }

    function statusSelectOptions(selectedId = '') {
        return mergePipelineStatuses(state.statuses || []).map(status => {
            const selected = String(status.id) === String(selectedId) || canonicalStatus(status) === activeStatus ? 'selected' : '';
            return `<option value="${esc(status.id)}" ${selected}>${esc(canonicalStatus(status))}</option>`;
        }).join('');
    }

    function renderFormOptions() {
        const status = document.getElementById('bbStatus');
        const estimator = document.getElementById('bbEstimator');
        const template = document.getElementById('bbProjectTemplate');
        if (status) status.innerHTML = '<option value="">Unassigned</option>' + statusSelectOptions();
        if (estimator) {
            estimator.innerHTML = '<option value="">Unassigned</option>' + (state.estimators || [])
                .map(e => `<option value="${esc(e.id)}">${esc(e.display_name)}</option>`)
                .join('');
        }
        if (template) {
            template.innerHTML = '<option value="">Select template</option>' + (state.templates || [])
                .map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`)
                .join('');
        }
    }

    function findBid(id) {
        return normalizedBids().find(row => String(row.id) === String(id));
    }

    function handleAction(action, id) {
        const bid = findBid(id);
        if (action === 'view') return openView(bid);
        if (usingMockData) return;
        if (action === 'edit') return openEdit(bid);
        if (action === 'create-project') return openCreateProject(bid);
    }

    function openView(bid) {
        document.getElementById('bbViewTitle').textContent = bid?.recordName || 'Bid';
        document.getElementById('bbViewBody').innerHTML = bid ? `
            <div class="bb-form-grid">
                <div><strong>Requesting Entity</strong><br>${esc(bid.requestingEntity)}</div>
                <div><strong>Contact</strong><br>${esc(bid.requestingContact)}</div>
                <div><strong>ID / Project</strong><br>${esc(bid.projectId)}</div>
                <div><strong>Due Date</strong><br>${fmtDate(bid.dueDate)}<br><span class="bb-subtext">${esc(daysUntil(bid.dueDate))}</span></div>
                <div><strong>Total Value</strong><br>${money(bid.totalValue, bid.currency)}</div>
                <div><strong>Responsible</strong><br>${esc(bid.responsibleName)}</div>
                <div><strong>Status</strong><br>${statusBadge(bid.status)}</div>
                <div><strong>Category</strong><br>${esc(bid.category)}</div>
                <div class="bb-field full"><strong>Notes</strong><br>${esc(bid.notes || '-')}</div>
            </div>
        ` : '';
        document.getElementById('bbViewModal').classList.add('open');
    }

    function openEdit(bid = null) {
        editingId = bid ? Number(bid.id) : null;
        document.getElementById('bbModalTitle').textContent = editingId ? 'Edit Bid' : 'New Bid';
        document.getElementById('bbName').value = bid?.recordName || '';
        document.getElementById('bbRequesterCompany').value = bid?.requestingEntity || '';
        document.getElementById('bbProjectName').value = bid?.projectId || '';
        document.getElementById('bbDueDate').value = bid?.dueDate ? String(bid.dueDate).slice(0, 10) : '';
        document.getElementById('bbTotalSales').value = bid?.totalValue || '';
        document.getElementById('bbCurrency').value = bid?.currency || 'USD';
        document.getElementById('bbEstimator').value = bid?.estimator_id || '';
        document.getElementById('bbStatus').value = bid?.bid_status_id || '';
        document.getElementById('bbNotes').value = bid?.notes || '';
        document.getElementById('bbEditModal').classList.add('open');
    }

    function openCreateProject(bid) {
        if (!bid) return;
        projectBidId = Number(bid.id);
        document.getElementById('bbProjectForm').reset();
        document.querySelector('input[name="bbProjectMode"][value="template"]').checked = true;
        document.getElementById('bbProjectCreateName').value = bid.projectId || bid.recordName || '';
        document.getElementById('bbProjectSourceBid').value = `${bid.recordName} - ${bid.requestingEntity || 'No requester'}`;
        toggleProjectTemplate();
        document.getElementById('bbProjectModal').classList.add('open');
    }

    function toggleProjectTemplate() {
        const mode = document.querySelector('input[name="bbProjectMode"]:checked')?.value || 'empty';
        document.getElementById('bbProjectTemplateWrap').style.display = mode === 'template' ? 'block' : 'none';
    }

    function closeModals() {
        document.querySelectorAll('.bb-modal-backdrop').forEach(el => el.classList.remove('open'));
    }

    function saveBid(event) {
        event.preventDefault();
        request('save', {
            id: editingId,
            name: document.getElementById('bbName').value,
            requester_company: document.getElementById('bbRequesterCompany').value,
            project_name_snapshot: document.getElementById('bbProjectName').value,
            due_at: document.getElementById('bbDueDate').value,
            total_amount: document.getElementById('bbTotalSales').value,
            currency_code: document.getElementById('bbCurrency').value,
            estimator_id: document.getElementById('bbEstimator').value,
            bid_status_id: document.getElementById('bbStatus').value,
            notes: document.getElementById('bbNotes').value
        }).then(data => {
            state = data.data;
            usingMockData = false;
            closeModals();
            render();
        }).catch(err => showError(err.message));
    }

    function createProject(event) {
        event.preventDefault();
        const mode = document.querySelector('input[name="bbProjectMode"]:checked')?.value || 'empty';
        request('create_project', {
            id: projectBidId,
            mode,
            project_name: document.getElementById('bbProjectCreateName').value,
            project_template_id: mode === 'template' ? document.getElementById('bbProjectTemplate').value : ''
        }).then(data => {
            state = data.data;
            closeModals();
            render();
        }).catch(err => showError(err.message));
    }

    function showError(message) {
        const el = document.getElementById('bbError');
        el.textContent = message;
        el.hidden = false;
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('bbNewBid').addEventListener('click', () => openEdit());
        document.getElementById('bbSearch').addEventListener('input', render);
        document.getElementById('bbSortBy').addEventListener('change', render);
        document.getElementById('bbSortDir').addEventListener('click', () => {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            render();
        });
        document.getElementById('bbFiltersBtn').addEventListener('click', () => {
            showError('Advanced filters panel is ready for backend criteria and saved views.');
        });
        document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModals));
        document.querySelectorAll('input[name="bbProjectMode"]').forEach(input => input.addEventListener('change', toggleProjectTemplate));
        document.getElementById('bbBidForm').addEventListener('submit', saveBid);
        document.getElementById('bbProjectForm').addEventListener('submit', createProject);
        load();
    });
})();
