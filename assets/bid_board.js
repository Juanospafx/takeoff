(function () {
    const projectApiUrl = '../api/project_module.php';
    const pipelineStatuses = [
        'Invitations',
        'To Do',
        'Estimating',
        'Bid Submitted',
        'Accepted',
        'In Progress',
        'Complete',
        'Estimadores',
        'Lost',
        'Archived'
    ];
    const statusCodes = {
        Invitations: 'invitations',
        'To Do': 'to_do',
        Estimating: 'estimating',
        'Bid Submitted': 'bid_submitted',
        Accepted: 'accepted',
        'In Progress': 'in_progress',
        Complete: 'complete',
        Estimadores: 'estimadores',
        Lost: 'lost',
        Archived: 'archived'
    };
    const statusAliases = {
        draft: 'To Do',
        to_do: 'To Do',
        todo: 'To Do',
        active: 'Estimating',
        invitations: 'Invitations',
        invitation: 'Invitations',
        invited: 'Invitations',
        bidding: 'Estimating',
        estimating: 'Estimating',
        submitted: 'Bid Submitted',
        bid_submitted: 'Bid Submitted',
        awarded: 'Accepted',
        accepted: 'Accepted',
        in_progress: 'In Progress',
        complete: 'Complete',
        completed: 'Complete',
        estimators: 'Estimadores',
        estimadores: 'Estimadores',
        lost: 'Lost',
        archived: 'Archived'
    };

    let state = { templates: [], projects: [] };
    let activeStatus = 'To Do';
    let sortDirection = 'asc';
    let openMenuId = null;
    let tooltipEl = null;

    const money = (value, decimals = 0) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
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
        const text = String(value).trim();
        const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
        const date = match
            ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0))
            : new Date(text.replace(' ', 'T'));
        if (Number.isNaN(date.getTime())) return null;
        const year = date.getFullYear();
        if (year < 2000 || year > 2100) return null;
        return date;
    };

    const safeText = (value) => {
        const text = String(value ?? '').trim();
        return text || '--';
    };

    const statusSlug = (status) => String(status || 'To Do').toLowerCase().replace(/[^a-z0-9]+/g, '-');

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

    function postProjectAction(action, payload) {
        return fetch(`${projectApiUrl}?action=${encodeURIComponent(action)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        })
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.msg || 'Request failed');
                if (data.data) {
                    state = data.data;
                    render();
                }
                return data;
            });
    }

    function canonicalStatus(project) {
        const raw = String(project?.status || 'draft').toLowerCase().replace(/\s+/g, '_');
        return statusAliases[raw] || 'To Do';
    }

    function parseMetadata(project) {
        try {
            return project?.metadata_json ? JSON.parse(project.metadata_json) : {};
        } catch (e) {
            return {};
        }
    }

    function normalizedProjects() {
        return (state.projects || []).map(project => {
            const metadata = parseMetadata(project);
            const estimatorName = String(metadata.estimator || metadata.estimator_name || '').trim();
            const sqft = Number(metadata.square_footage || metadata.sqft || metadata.area_sqft || 0);
            const totalValue = Number(metadata.estimate_total || metadata.total_sales || metadata.totalValue || 0);
            const salesPerSqFt = sqft > 0 ? `${money(totalValue / sqft, 2)} /sq ft` : '$0 /sq ft';

            return {
                ...project,
                metadata,
                statusLabel: canonicalStatus(project),
                recordName: project.name || 'Untitled project',
                category: project.description || project.template_name || '--',
                requestingEntity: project.client_name || '',
                requestingContact: metadata.customer_email || metadata.primary_contact || metadata.contact_email || '',
                projectId: project.project_number || '',
                dueDate: project.bid_due_at || '',
                createdAt: project.created_at || '',
                totalValue,
                sqft,
                salesPerSqFt,
                taskCount: metadata.task_count ?? metadata.tasks_count ?? metadata.tasks ?? '',
                noteCount: metadata.note_count ?? metadata.notes_count ?? metadata.notes ?? '',
                responsibleName: estimatorName || 'Unassigned',
                responsibleInitials: estimatorName ? initials(estimatorName) : 'U'
            };
        });
    }

    function initials(name) {
        return String(name || 'U')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0])
            .join('')
            .toUpperCase() || 'U';
    }

    function visibleProjects() {
        const q = document.getElementById('bbSearch')?.value.trim().toLowerCase() || '';
        const sortBy = document.getElementById('bbSortBy')?.value || 'recordName';
        const direction = sortDirection === 'asc' ? 1 : -1;
        return normalizedProjects()
            .filter(project => project.statusLabel === activeStatus)
            .filter(project => {
                const haystack = [
                    project.recordName,
                    project.category,
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
            const statusProjects = projects.filter(project => project.statusLabel === status);
            return {
                name: status,
                count: statusProjects.length,
                total: statusProjects.reduce((sum, project) => sum + project.totalValue, 0)
            };
        });
    }

    function render() {
        openMenuId = null;
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
                <span class="bb-tab-total">${money(row.total, 2)}</span>
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
                <td class="bb-name-cell">
                    <a class="bb-record-name" href="project_dashboard.php?id=${encodeURIComponent(project.id)}&tab=overview">${esc(project.recordName)}</a>
                    <span class="bb-subtext">${esc(project.category)}</span>
                </td>
                <td class="bb-metrics-cell">
                    <button class="bb-metrics-btn" type="button" aria-label="Project information" data-bb-tooltip="${esc(infoTooltip(project))}">
                        <i class="fas fa-chart-column"></i>
                    </button>
                </td>
                <td>
                    <strong>${esc(safeText(project.requestingEntity))}</strong>
                    <span class="bb-subtext">${esc(safeText(project.requestingContact))}</span>
                </td>
                <td class="bb-project-code">${esc(safeText(project.projectId))}</td>
                <td>
                    <span class="bb-hover-text" data-bb-tooltip="${esc(dueTooltip(project))}">
                        <strong>${esc(displayDueDate(project.dueDate))}</strong>
                        <span class="bb-subtext">${esc(dueRelative(project.dueDate))}</span>
                    </span>
                </td>
                <td>
                    <span class="bb-money" data-bb-tooltip="${esc(`Total Sales per sq ft:\n${project.salesPerSqFt}`)}">${money(project.totalValue)}</span>
                </td>
                <td>
                    <span class="bb-responsible" data-bb-tooltip="${esc(`Estimator: ${project.responsibleName || 'Unassigned'}`)}">
                        <span class="bb-avatar">${esc(project.responsibleInitials)}</span>
                        <span>${esc(project.responsibleName)}</span>
                    </span>
                </td>
                <td>${statusSelect(project)}</td>
                <td class="bb-actions-cell">
                    ${rowActions(project)}
                </td>
            </tr>
        `).join('') || `<tr><td colspan="9" class="bb-empty-row">No projects match the current status, search, and sort criteria.</td></tr>`;

        bindRowControls(body);
    }

    function statusSelect(project) {
        return `
            <select class="bb-status-select bb-status-${statusSlug(project.statusLabel)}" data-project-status="${esc(project.id)}" data-bb-tooltip="${esc(`Current status: ${project.statusLabel}`)}">
                ${pipelineStatuses.map(status => `<option value="${esc(status)}" ${status === project.statusLabel ? 'selected' : ''}>${esc(status)}</option>`).join('')}
            </select>
        `;
    }

    function rowActions(project) {
        return `
            <div class="bb-row-menu ${openMenuId === String(project.id) ? 'open' : ''}">
                <button class="bb-icon-btn bb-row-menu-toggle" type="button" aria-label="Project actions" data-row-menu="${esc(project.id)}">
                    <i class="fas fa-ellipsis-vertical"></i>
                </button>
                <div class="bb-row-menu-panel" data-menu-panel="${esc(project.id)}">
                    <a href="project_dashboard.php?id=${encodeURIComponent(project.id)}&tab=overview">Open</a>
                    <button type="button" data-project-action="duplicate" data-project-id="${esc(project.id)}">Duplicate</button>
                    <button type="button" data-project-action="archive" data-project-id="${esc(project.id)}">Archive</button>
                    <button class="danger" type="button" data-project-action="delete" data-project-id="${esc(project.id)}">Delete</button>
                </div>
            </div>
        `;
    }

    function bindRowControls(root) {
        root.querySelectorAll('[data-project-status]').forEach(select => {
            select.addEventListener('change', () => updateProjectStatus(select.dataset.projectStatus, select.value));
        });
        root.querySelectorAll('[data-row-menu]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                openMenuId = openMenuId === button.dataset.rowMenu ? null : button.dataset.rowMenu;
                renderTable();
            });
        });
        root.querySelectorAll('[data-project-action]').forEach(button => {
            button.addEventListener('click', () => runProjectAction(button.dataset.projectAction, button.dataset.projectId));
        });
        bindTooltips(root);
    }

    function displayDueDate(value) {
        const date = toDate(value);
        if (!date) return 'To be determined';
        const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
        const rest = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `${weekday}. ${rest}`;
    }

    function dueRelative(value) {
        const date = toDate(value);
        if (!date) return '';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        date.setHours(0, 0, 0, 0);
        const days = Math.round((date - today) / 86400000);
        if (days === 0) return 'Due Today';
        if (days > 0) return `Due in ${days} day${days === 1 ? '' : 's'}`;
        return 'Past Due';
    }

    function fullDate(value) {
        const date = toDate(value);
        if (!date) return 'Due date has not been defined.';
        const dateText = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        const timeText = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
        return `${dateText}. at ${timeText}`;
    }

    function dueTooltip(project) {
        if (!toDate(project.dueDate)) return 'Due date has not been defined.';
        return `${fullDate(project.dueDate)}\nRequester does not accept bid submissions past due date`;
    }

    function relativeTime(value) {
        const date = toDate(value);
        if (!date) return '--';
        const diff = Date.now() - date.getTime();
        const days = Math.max(0, Math.floor(diff / 86400000));
        if (days < 1) return 'Today';
        if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
        const months = Math.floor(days / 30);
        if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
        const years = Math.floor(months / 12);
        return `${years} year${years === 1 ? '' : 's'} ago`;
    }

    function infoTooltip(project) {
        return [
            'Project created',
            relativeTime(project.createdAt),
            '',
            'Project number',
            safeText(project.projectId),
            '',
            'Tasks    Notes',
            `${safeText(project.taskCount)}    ${safeText(project.noteCount)}`,
            '',
            'Total sales per sq ft',
            project.salesPerSqFt || '$0 /sq ft'
        ].join('\n');
    }

    function savePayload(project, statusLabel) {
        return {
            id: Number(project.id),
            project_template_id: project.project_template_id || null,
            project_number: project.project_number || '',
            name: project.name || 'Untitled project',
            description: project.description || '',
            status: statusCodes[statusLabel] || 'to_do',
            client_name: project.client_name || '',
            job_address: project.job_address || '',
            city: project.city || '',
            state: project.state || '',
            postal_code: project.postal_code || '',
            country: project.country || '',
            bid_due_at: project.bid_due_at || '',
            start_date: project.start_date || '',
            end_date: project.end_date || '',
            metadata_json: project.metadata_json || null
        };
    }

    function updateProjectStatus(projectId, statusLabel) {
        const rawProject = (state.projects || []).find(project => String(project.id) === String(projectId));
        if (!rawProject) return;
        const previousState = JSON.parse(JSON.stringify(state));
        rawProject.status = statusCodes[statusLabel] || 'to_do';
        activeStatus = statusLabel;
        render();
        postProjectAction('save', savePayload(rawProject, statusLabel)).catch(err => {
            state = previousState;
            render();
            showError(err.message);
        });
    }

    function runProjectAction(action, projectId) {
        openMenuId = null;
        if (action === 'delete' && !window.confirm('Delete this project from the Bid Board?')) {
            renderTable();
            return;
        }
        const apiAction = action === 'duplicate' ? 'copy' : action;
        postProjectAction(apiAction, { id: Number(projectId) }).catch(err => showError(err.message));
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

    function ensureTooltip() {
        if (tooltipEl) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'bb-tooltip';
        document.body.appendChild(tooltipEl);
        return tooltipEl;
    }

    function showTooltip(target) {
        const text = target.getAttribute('data-bb-tooltip');
        if (!text) return;
        const tooltip = ensureTooltip();
        tooltip.textContent = text;
        tooltip.classList.add('show');
        positionTooltip(target);
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.classList.remove('show');
    }

    function positionTooltip(target) {
        if (!tooltipEl) return;
        const rect = target.getBoundingClientRect();
        tooltipEl.style.left = '0px';
        tooltipEl.style.top = '0px';
        const tipRect = tooltipEl.getBoundingClientRect();
        const left = Math.min(Math.max(10, rect.left + rect.width / 2 - tipRect.width / 2), window.innerWidth - tipRect.width - 10);
        const top = rect.top > tipRect.height + 14 ? rect.top - tipRect.height - 10 : rect.bottom + 10;
        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${top}px`;
    }

    function bindTooltips(root = document) {
        root.querySelectorAll('[data-bb-tooltip]').forEach(el => {
            el.addEventListener('mouseenter', () => showTooltip(el));
            el.addEventListener('mouseleave', hideTooltip);
            el.addEventListener('focus', () => showTooltip(el));
            el.addEventListener('blur', hideTooltip);
        });
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
        document.addEventListener('click', () => {
            if (openMenuId) {
                openMenuId = null;
                renderTable();
            }
        });
        window.addEventListener('scroll', hideTooltip, true);
        window.addEventListener('resize', hideTooltip);
        load();
    });
})();
