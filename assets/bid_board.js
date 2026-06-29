(function () {
    const projectApiUrl = '../api/project_module.php';
    const pipelineStatuses = ['TO DO', 'ESTIMATING', 'BID SUBMITTED', 'ACCEPTED', 'IN PROGRESS', 'COMPLETE', 'ESTIMATORS', 'LOST'];
    const statusAliases = {
        draft: 'TO DO',
        to_do: 'TO DO',
        active: 'ESTIMATING',
        invited: 'TO DO',
        bidding: 'ESTIMATING',
        estimating: 'ESTIMATING',
        submitted: 'BID SUBMITTED',
        bid_submitted: 'BID SUBMITTED',
        awarded: 'ACCEPTED',
        accepted: 'ACCEPTED',
        in_progress: 'IN PROGRESS',
        complete: 'COMPLETE',
        estimators: 'ESTIMATORS',
        estimadores: 'ESTIMATORS',
        lost: 'LOST',
        archived: 'LOST'
    };

    let state = { templates: [], projects: [] };
    let activeStatus = 'TO DO';
    let sortDirection = 'asc';

    const money = (value) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
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

    const statusSlug = (status) => String(status || 'TO DO').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    function load() {
        return fetch(`${projectApiUrl}?action=list`)
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.msg || 'Project list could not load');
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function canonicalStatus(project) {
        const status = String(project?.status || 'draft').toLowerCase();
        return statusAliases[status] || 'TO DO';
    }

    function normalizedProjects() {
        return (state.projects || []).map(project => {
            let metadata = {};
            try {
                metadata = project.metadata_json ? JSON.parse(project.metadata_json) : {};
            } catch (e) {
                metadata = {};
            }
            const dueDate = project.bid_due_at || '';
            return {
                ...project,
                status: canonicalStatus(project),
                recordName: project.name || 'Untitled project',
                category: project.template_name || 'Empty Project',
                requestingEntity: project.client_name || '',
                requestingContact: metadata.customer_email || metadata.primary_contact || '',
                projectId: project.project_number || `Project #${project.id}`,
                dueDate,
                totalValue: Number(metadata.estimate_total || 0),
                responsibleName: metadata.estimator || 'Juan Estevez',
                responsibleInitials: initials(metadata.estimator || 'Juan Estevez')
            };
        });
    }

    function initials(name) {
        return String(name || 'JE')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0])
            .join('')
            .toUpperCase() || 'JE';
    }

    function visibleProjects() {
        const q = document.getElementById('bbSearch')?.value.trim().toLowerCase() || '';
        const sortBy = document.getElementById('bbSortBy')?.value || 'dueDate';
        const direction = sortDirection === 'asc' ? 1 : -1;
        return normalizedProjects()
            .filter(project => project.status === activeStatus)
            .filter(project => {
                const haystack = [
                    project.recordName,
                    project.requestingEntity,
                    project.requestingContact,
                    project.projectId,
                    project.responsibleName
                ].join(' ').toLowerCase();
                return !q || haystack.includes(q);
            })
            .sort((a, b) => compareProjects(a, b, sortBy) * direction);
    }

    function compareProjects(a, b, sortBy) {
        if (sortBy === 'dueDate') return (toDate(a.dueDate)?.getTime() || 0) - (toDate(b.dueDate)?.getTime() || 0);
        if (sortBy === 'totalValue') return a.totalValue - b.totalValue;
        if (sortBy === 'recordName') return a.recordName.localeCompare(b.recordName);
        if (sortBy === 'requestingEntity') return a.requestingEntity.localeCompare(b.requestingEntity);
        if (sortBy === 'responsible') return a.responsibleName.localeCompare(b.responsibleName);
        return 0;
    }

    function statusSummary() {
        const projects = normalizedProjects();
        return pipelineStatuses.map(status => {
            const statusProjects = projects.filter(project => project.status === status);
            return {
                name: status,
                count: statusProjects.length,
                total: statusProjects.reduce((sum, project) => sum + project.totalValue, 0)
            };
        });
    }

    function render() {
        renderPipelineTabs();
        renderTemplateOptions();
        renderSortIcon();
        const isEmpty = !state.projects || state.projects.length === 0;
        document.getElementById('bbEmptyState').hidden = !isEmpty;
        document.getElementById('bbTableControls').hidden = isEmpty;
        document.querySelector('.bb-table-shell').hidden = isEmpty;
        if (!isEmpty) renderTable();
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
        const projects = visibleProjects();
        body.innerHTML = projects.map(project => `
            <tr>
                <td>
                    <a class="bb-record-name" href="project_dashboard.php?id=${encodeURIComponent(project.id)}&tab=overview">${esc(project.recordName)}</a>
                    <span class="bb-subtext">${esc(project.category)}</span>
                </td>
                <td class="bb-metrics-cell">
                    <span class="bb-metrics-btn" title="Metrics"><i class="fas fa-chart-column"></i></span>
                </td>
                <td>
                    <strong>${esc(project.requestingEntity || '-')}</strong>
                    <span class="bb-subtext">${esc(project.requestingContact || '-')}</span>
                </td>
                <td>${esc(project.projectId || '-')}</td>
                <td>
                    <strong>${fmtDate(project.dueDate)}</strong>
                    <span class="bb-subtext">${esc(daysUntil(project.dueDate))}</span>
                </td>
                <td class="bb-money">${money(project.totalValue)}</td>
                <td>
                    <span class="bb-responsible">
                        <span class="bb-avatar">${esc(project.responsibleInitials)}</span>
                        <span>${esc(project.responsibleName)}</span>
                    </span>
                </td>
                <td>${statusBadge(project.status)}</td>
                <td>
                    <div class="bb-row-actions">
                        <a class="bb-btn secondary" href="project_dashboard.php?id=${encodeURIComponent(project.id)}&tab=overview">Open</a>
                    </div>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="9" class="bb-empty-row">No projects match the current status, search, and sort criteria.</td></tr>`;
    }

    function statusBadge(status) {
        return `<span class="bb-status-badge bb-status-${statusSlug(status)}">${esc(status)}</span>`;
    }

    function renderSortIcon() {
        const icon = document.querySelector('#bbSortDir i');
        if (!icon) return;
        icon.className = sortDirection === 'asc' ? 'fas fa-arrow-down-wide-short' : 'fas fa-arrow-up-short-wide';
    }

    function renderTemplateOptions() {
        const template = document.getElementById('bbProjectTemplate');
        if (!template) return;
        template.innerHTML = '<option value="">Select a template</option>' + (state.templates || [])
            .map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`)
            .join('');
    }

    function openCreateProject() {
        document.getElementById('bbProjectForm').reset();
        document.querySelector('input[name="bbProjectMode"][value="template"]').checked = true;
        toggleProjectTemplate();
        document.getElementById('bbProjectModal').classList.add('open');
    }

    function toggleProjectTemplate() {
        const mode = document.querySelector('input[name="bbProjectMode"]:checked')?.value || 'empty';
        document.getElementById('bbProjectTemplateWrap').style.display = mode === 'template' ? 'block' : 'none';
    }

    function createProjectDraft(event) {
        event.preventDefault();
        const mode = document.querySelector('input[name="bbProjectMode"]:checked')?.value || 'empty';
        const templateId = mode === 'template' ? document.getElementById('bbProjectTemplate').value : '';
        const template = (state.templates || []).find(row => String(row.id) === String(templateId));
        const draft = {
            mode,
            project_template_id: templateId,
            template_name: template?.name || '',
            name: 'New Project',
            status: 'to_do',
            estimator: 'Juan Estevez',
            measurement_system: 'US',
            estimate_pricing: 'Unlocked',
            created_at: new Date().toISOString()
        };
        localStorage.setItem('takeoff.projectDraft', JSON.stringify(draft));
        window.location.href = `project_dashboard.php?draft=1${templateId ? `&template_id=${encodeURIComponent(templateId)}` : ''}`;
    }

    function closeModals() {
        document.querySelectorAll('.bb-modal-backdrop').forEach(el => el.classList.remove('open'));
    }

    function showError(message) {
        const el = document.getElementById('bbError');
        el.textContent = message;
        el.hidden = false;
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('bbCreateProject').addEventListener('click', openCreateProject);
        document.querySelectorAll('[data-open-project-modal]').forEach(btn => btn.addEventListener('click', openCreateProject));
        document.getElementById('bbSearch').addEventListener('input', render);
        document.getElementById('bbSortBy').addEventListener('change', render);
        document.getElementById('bbSortDir').addEventListener('click', () => {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            render();
        });
        document.getElementById('bbFiltersBtn').addEventListener('click', () => {
            showError('Advanced filters are ready to connect to saved views and backend criteria.');
        });
        document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModals));
        document.querySelectorAll('input[name="bbProjectMode"]').forEach(input => input.addEventListener('change', toggleProjectTemplate));
        document.getElementById('bbProjectForm').addEventListener('submit', createProjectDraft);
        load();
    });
})();
