(function () {
    const apiUrl = '../api/project_module.php';
    let isDirty = false;
    let notes = Array.isArray(window.ProjectState?.projectMeta?.notes) ? [...window.ProjectState.projectMeta.notes] : [];
    let tasks = Array.isArray(window.ProjectState?.projectMeta?.tasks) ? [...window.ProjectState.projectMeta.tasks] : [];

    const $ = (id) => document.getElementById(id);

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
        const dueDate = $('poDueDate')?.value || '';
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
            status: window.ProjectState?.projectInfo?.status || 'draft',
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
                    window.location.href = `project_dashboard.php?id=${encodeURIComponent(data.id)}&tab=overview`;
                } else {
                    window.ProjectState.projectId = data.id;
                    window.ProjectState.projectInfo = data.data?.project || window.ProjectState.projectInfo;
                    $('projectHeaderName').textContent = payload.name;
                }
            })
            .catch(err => showToast(err.message));
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

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-menu-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                toggleMenu(button.dataset.menuToggle);
            });
        });
        document.addEventListener('click', () => {
            document.querySelectorAll('.project-menu').forEach(menu => menu.classList.remove('open'));
        });

        $('saveProjectBtn')?.addEventListener('click', saveProject);
        $('addCustomerBtn')?.addEventListener('click', showCustomerFields);
        $('addProjectAddressBtn')?.addEventListener('click', showCustomerFields);
        $('addNoteBtn')?.addEventListener('click', addNote);
        $('createTaskBtn')?.addEventListener('click', createTask);

        document.querySelectorAll('.overview-field input, .overview-field select, .overview-field textarea').forEach(input => {
            input.addEventListener('input', markDirty);
            input.addEventListener('change', markDirty);
        });

        window.addEventListener('beforeunload', event => {
            if (!isDirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
    });
})();
