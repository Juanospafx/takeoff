(function () {
    const apiUrl = '../api/project_module.php';
    let state = { templates: [], projects: [], project: null };
    let editingId = null;
    let selectedId = null;

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[ch]));

    const fmtDate = (value) => {
        if (!value) return '-';
        const date = new Date(String(value).replace(' ', 'T'));
        return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString();
    };

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

    function load(id = null) {
        const url = id ? `${apiUrl}?action=detail&id=${id}` : `${apiUrl}?action=list`;
        return fetch(url)
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.msg || 'Project module could not load');
                state = data.data;
                const selectedExists = state.projects.some(project => Number(project.id) === Number(selectedId));
                if (!selectedExists) selectedId = state.projects[0] ? Number(state.projects[0].id) : null;
                if (selectedId && id === null) {
                    return load(selectedId);
                }
                render();
            })
            .catch(err => showError(err.message));
    }

    function render() {
        renderTable();
        renderDetail();
        renderTemplateOptions();
    }

    function renderTable() {
        const body = document.getElementById('pmTableBody');
        body.innerHTML = state.projects.map(project => `
            <tr>
                <td><strong>${esc(project.name)}</strong><br><span style="color:#94a3b8;">${esc(project.project_number || '-')}</span></td>
                <td>${esc(project.client_name || '-')}</td>
                <td>${esc(project.template_name || 'Empty Project')}</td>
                <td><span class="pm-pill">${esc(project.status || 'draft')}</span></td>
                <td>${fmtDate(project.bid_due_at)}</td>
                <td>${fmtDate(project.updated_at)}</td>
                <td>
                    <div class="pm-row-actions">
                        <button class="pm-btn" data-action="view" data-id="${project.id}">View</button>
                        <button class="pm-btn" data-action="edit" data-id="${project.id}">Edit</button>
                        <button class="pm-btn" data-action="copy" data-id="${project.id}">Copy</button>
                        <button class="pm-btn" data-action="archive" data-id="${project.id}">Archive</button>
                        <button class="pm-btn danger" data-action="delete" data-id="${project.id}">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="7" style="color:#94a3b8;">No projects yet.</td></tr>`;

        body.querySelectorAll('[data-action]').forEach(button => {
            button.addEventListener('click', () => handleAction(button.dataset.action, Number(button.dataset.id)));
        });
    }

    function renderDetail() {
        const project = state.project;
        const root = document.getElementById('pmDetail');
        if (!project) {
            root.innerHTML = '<div style="color:#94a3b8;">Select a project to view details.</div>';
            return;
        }
        root.innerHTML = `
            <div class="pm-card-head">
                <strong>${esc(project.name)}</strong>
                <span class="pm-pill">${esc(project.status || 'draft')}</span>
            </div>
            <div class="pm-card-body">
                <div class="pm-detail-actions">
                    <button class="pm-btn" data-detail-action="edit" data-id="${project.id}"><i class="fas fa-pen"></i> Edit</button>
                    <button class="pm-btn" data-detail-action="copy" data-id="${project.id}"><i class="fas fa-copy"></i> Copy Project</button>
                    <button class="pm-btn" data-detail-action="archive" data-id="${project.id}"><i class="fas fa-box-archive"></i> Archive</button>
                    <button class="pm-btn danger" data-detail-action="delete" data-id="${project.id}"><i class="fas fa-trash"></i> Delete</button>
                </div>
                <div class="pm-detail-grid">
                    <div class="pm-detail-item"><span>Project Number</span>${esc(project.project_number || '-')}</div>
                    <div class="pm-detail-item"><span>Template</span>${esc(project.template_name || 'Empty Project')}</div>
                    <div class="pm-detail-item"><span>Client</span>${esc(project.client_name || '-')}</div>
                    <div class="pm-detail-item"><span>Bid Due</span>${fmtDate(project.bid_due_at)}</div>
                    <div class="pm-detail-item"><span>Start</span>${fmtDate(project.start_date)}</div>
                    <div class="pm-detail-item"><span>End</span>${fmtDate(project.end_date)}</div>
                    <div class="pm-detail-item full"><span>Address</span>${esc([project.job_address, project.city, project.state, project.postal_code, project.country].filter(Boolean).join(', ') || '-')}</div>
                    <div class="pm-detail-item full"><span>Description</span>${esc(project.description || '-')}</div>
                </div>
            </div>
        `;
        root.querySelectorAll('[data-detail-action]').forEach(button => {
            button.addEventListener('click', () => handleAction(button.dataset.detailAction, Number(button.dataset.id)));
        });
    }

    function renderTemplateOptions() {
        const select = document.getElementById('pmTemplate');
        select.innerHTML = '<option value="">Select template...</option>' + state.templates.map(template => `<option value="${template.id}">${esc(template.name)}</option>`).join('');
    }

    function handleAction(action, id) {
        if (action === 'view') {
            selectedId = id;
            return load(id);
        }
        const project = state.projects.find(row => Number(row.id) === id);
        if (action === 'edit') return openEdit(project);
        if (action === 'copy') return mutate('copy', id);
        if (action === 'archive') return mutate('archive', id);
        if (action === 'delete') {
            if (!confirm('Delete this project?')) return;
            if (Number(selectedId) === id) selectedId = null;
            return mutate('delete', id);
        }
    }

    function mutate(action, id) {
        request(action, { id })
            .then(data => {
                state = data.data;
                selectedId = data.id || selectedId;
                if (selectedId) return load(selectedId);
                render();
            })
            .catch(err => showError(err.message));
    }

    function openCreate() {
        editingId = null;
        document.getElementById('pmModalTitle').textContent = 'Create Project';
        document.getElementById('pmProjectForm').reset();
        document.querySelector('input[name="pmCreateMode"][value="empty"]').checked = true;
        toggleTemplateMode();
        document.getElementById('pmEditModal').classList.add('open');
    }

    function openEdit(project) {
        editingId = Number(project.id);
        const status = String(project.status || 'draft').toLowerCase().replace(/\s+/g, '_');
        document.getElementById('pmModalTitle').textContent = 'Edit Project';
        document.querySelector('input[name="pmCreateMode"][value="template"]').checked = project.project_template_id ? true : false;
        document.querySelector('input[name="pmCreateMode"][value="empty"]').checked = project.project_template_id ? false : true;
        document.getElementById('pmTemplate').value = project.project_template_id || '';
        document.getElementById('pmName').value = project.name || '';
        document.getElementById('pmProjectNumber').value = project.project_number || '';
        document.getElementById('pmClientName').value = project.client_name || '';
        document.getElementById('pmStatus').value = ['draft', 'active', 'on_hold', 'archived'].includes(status) ? status : 'draft';
        document.getElementById('pmBidDue').value = project.bid_due_at ? String(project.bid_due_at).slice(0, 10) : '';
        document.getElementById('pmStartDate').value = project.start_date || '';
        document.getElementById('pmEndDate').value = project.end_date || '';
        document.getElementById('pmAddress').value = project.job_address || '';
        document.getElementById('pmCity').value = project.city || '';
        document.getElementById('pmState').value = project.state || '';
        document.getElementById('pmPostalCode').value = project.postal_code || '';
        document.getElementById('pmCountry').value = project.country || '';
        document.getElementById('pmDescription').value = project.description || '';
        toggleTemplateMode();
        document.getElementById('pmEditModal').classList.add('open');
    }

    function toggleTemplateMode() {
        const mode = document.querySelector('input[name="pmCreateMode"]:checked')?.value || 'empty';
        document.getElementById('pmTemplateWrap').style.display = mode === 'template' ? 'block' : 'none';
        if (mode === 'empty') document.getElementById('pmTemplate').value = '';
    }

    function applyTemplateDefaults() {
        if (editingId) return;
        const mode = document.querySelector('input[name="pmCreateMode"]:checked')?.value || 'empty';
        if (mode !== 'template') return;
        const templateId = Number(document.getElementById('pmTemplate').value || 0);
        const template = state.templates.find(row => Number(row.id) === templateId);
        if (!template) return;
        if (!document.getElementById('pmName').value.trim()) document.getElementById('pmName').value = template.name;
        if (!document.getElementById('pmDescription').value.trim()) document.getElementById('pmDescription').value = template.description || '';
    }

    function closeModals() {
        document.querySelectorAll('.pm-modal-backdrop').forEach(el => el.classList.remove('open'));
    }

    function saveProject(event) {
        event.preventDefault();
        request('save', {
            id: editingId,
            project_template_id: document.getElementById('pmTemplate').value,
            name: document.getElementById('pmName').value,
            project_number: document.getElementById('pmProjectNumber').value,
            client_name: document.getElementById('pmClientName').value,
            status: document.getElementById('pmStatus').value,
            bid_due_at: document.getElementById('pmBidDue').value,
            start_date: document.getElementById('pmStartDate').value,
            end_date: document.getElementById('pmEndDate').value,
            job_address: document.getElementById('pmAddress').value,
            city: document.getElementById('pmCity').value,
            state: document.getElementById('pmState').value,
            postal_code: document.getElementById('pmPostalCode').value,
            country: document.getElementById('pmCountry').value,
            description: document.getElementById('pmDescription').value
        }).then(data => {
            selectedId = data.id;
            closeModals();
            return load(selectedId);
        }).catch(err => showError(err.message));
    }

    function showError(message) {
        const el = document.getElementById('pmError');
        el.textContent = message;
        el.style.display = 'block';
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('pmCreateProject').addEventListener('click', openCreate);
        document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModals));
        document.querySelectorAll('input[name="pmCreateMode"]').forEach(input => input.addEventListener('change', toggleTemplateMode));
        document.getElementById('pmTemplate').addEventListener('change', applyTemplateDefaults);
        document.getElementById('pmProjectForm').addEventListener('submit', saveProject);
        load();
    });
})();
