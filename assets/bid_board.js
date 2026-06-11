(function () {
    const apiUrl = '../api/bid_board.php';
    let state = { statuses: [], estimators: [], dashboard: [], bids: [] };
    let editingId = null;
    let viewingBid = null;

    const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 0
    }).format(Number(value || 0));

    const fmtDate = (value) => {
        if (!value) return '-';
        const date = new Date(String(value).replace(' ', 'T'));
        return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString();
    };

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[ch]));

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
                render();
            })
            .catch(err => showError(err.message));
    }

    function render() {
        renderDashboard();
        renderTable();
        renderFormOptions();
    }

    function renderDashboard() {
        const root = document.getElementById('bbDashboard');
        root.innerHTML = state.dashboard.map(row => `
            <article class="bb-status-card">
                <div class="bb-status-card-title">${esc(row.name)}</div>
                <div class="bb-status-card-main">
                    <div class="bb-count">${Number(row.bid_count || 0)}</div>
                    <div class="bb-amount">${money(row.total_sales)}</div>
                </div>
            </article>
        `).join('');
    }

    function renderTable() {
        const body = document.getElementById('bbTableBody');
        body.innerHTML = state.bids.map(bid => `
            <tr>
                <td><strong>${esc(bid.name)}</strong></td>
                <td>${esc(bid.requester_company || '-')}</td>
                <td>${esc(bid.project_name_snapshot || '-')}</td>
                <td>${fmtDate(bid.due_at)}</td>
                <td>${money(bid.total_amount, bid.currency_code)}</td>
                <td>${esc(bid.estimator_name || '-')}</td>
                <td><span class="bb-pill">${esc(bid.status_name || 'Unassigned')}</span></td>
                <td>
                    <div class="bb-row-actions">
                        <button class="bb-btn" data-action="view" data-id="${bid.id}">View</button>
                        <button class="bb-btn" data-action="edit" data-id="${bid.id}">Edit</button>
                        <button class="bb-btn" data-action="duplicate" data-id="${bid.id}">Duplicate</button>
                        <button class="bb-btn" data-action="archive" data-id="${bid.id}">Archive</button>
                        <button class="bb-btn danger" data-action="delete" data-id="${bid.id}">Delete</button>
                        <button class="bb-btn" data-action="create-project" data-id="${bid.id}">Create Project</button>
                    </div>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="8" style="color:#94a3b8;">No bids yet.</td></tr>`;

        body.querySelectorAll('[data-action]').forEach(button => {
            button.addEventListener('click', () => handleAction(button.dataset.action, Number(button.dataset.id)));
        });
    }

    function renderFormOptions() {
        const status = document.getElementById('bbStatus');
        const estimator = document.getElementById('bbEstimator');
        status.innerHTML = '<option value="">Unassigned</option>' + state.statuses.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
        estimator.innerHTML = '<option value="">Unassigned</option>' + state.estimators.map(e => `<option value="${e.id}">${esc(e.display_name)}</option>`).join('');
    }

    function handleAction(action, id) {
        const bid = state.bids.find(row => Number(row.id) === id);
        if (action === 'view') return openView(bid);
        if (action === 'edit') return openEdit(bid);
        if (action === 'duplicate') return mutate('duplicate', id);
        if (action === 'archive') return mutate('archive', id);
        if (action === 'delete') {
            if (!confirm('Delete this bid?')) return;
            return mutate('delete', id);
        }
        if (action === 'create-project') {
            alert('Create Project is prepared for a future Projects module. No project is created in this task.');
        }
    }

    function mutate(action, id) {
        request(action, { id })
            .then(data => {
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function openView(bid) {
        viewingBid = bid;
        document.getElementById('bbViewTitle').textContent = bid?.name || 'Bid';
        document.getElementById('bbViewBody').innerHTML = bid ? `
            <div class="bb-form-grid">
                <div><strong>Requester Company</strong><br>${esc(bid.requester_company || '-')}</div>
                <div><strong>Project</strong><br>${esc(bid.project_name_snapshot || '-')}</div>
                <div><strong>Due Date</strong><br>${fmtDate(bid.due_at)}</div>
                <div><strong>Total Sales</strong><br>${money(bid.total_amount, bid.currency_code)}</div>
                <div><strong>Estimator</strong><br>${esc(bid.estimator_name || '-')}</div>
                <div><strong>Status</strong><br>${esc(bid.status_name || 'Unassigned')}</div>
                <div class="bb-field full"><strong>Notes</strong><br>${esc(bid.notes || '-')}</div>
            </div>
        ` : '';
        document.getElementById('bbViewModal').classList.add('open');
    }

    function openEdit(bid = null) {
        editingId = bid ? Number(bid.id) : null;
        document.getElementById('bbModalTitle').textContent = editingId ? 'Edit Bid' : 'New Bid';
        document.getElementById('bbName').value = bid?.name || '';
        document.getElementById('bbRequesterCompany').value = bid?.requester_company || '';
        document.getElementById('bbProjectName').value = bid?.project_name_snapshot || '';
        document.getElementById('bbDueDate').value = bid?.due_at ? String(bid.due_at).slice(0, 10) : '';
        document.getElementById('bbTotalSales').value = bid?.total_amount || '';
        document.getElementById('bbCurrency').value = bid?.currency_code || 'USD';
        document.getElementById('bbEstimator').value = bid?.estimator_id || '';
        document.getElementById('bbStatus').value = bid?.bid_status_id || '';
        document.getElementById('bbNotes').value = bid?.notes || '';
        document.getElementById('bbEditModal').classList.add('open');
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
            closeModals();
            render();
        }).catch(err => showError(err.message));
    }

    function showError(message) {
        const el = document.getElementById('bbError');
        el.textContent = message;
        el.style.display = 'block';
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('bbNewBid').addEventListener('click', () => openEdit());
        document.getElementById('bbCreateProject').addEventListener('click', () => {
            alert('Create Project is prepared for a future Projects module. No project is created in this task.');
        });
        document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModals));
        document.getElementById('bbBidForm').addEventListener('submit', saveBid);
        load();
    });
})();
