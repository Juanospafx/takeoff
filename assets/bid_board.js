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

    function getPhaseConfig() {
        try {
            const raw = localStorage.getItem('takeoff.pipelineConfig');
            if (raw) {
                const parsed = JSON.parse(raw);
                return { ...defaultPhaseConfig, ...parsed };
            }
        } catch (e) {}
        return { ...defaultPhaseConfig };
    }

    function savePhaseConfig(cfg) {
        try {
            localStorage.setItem('takeoff.pipelineConfig', JSON.stringify(cfg));
        } catch (e) {}
    }

    function getPhase(key) {
        const cfg = getPhaseConfig();
        return cfg[key] || { label: key, color: '#1d5cc9' };
    }

    let filterState = {
        estimator: '',
        requester: '',
        dueDate: '',
        minSales: '',
        maxSales: ''
    };

    let state = { templates: [], projects: [] };
    let activeStatus = 'To Do';
    let sortDirection = 'asc';
    let openMenuId = null;
    let openStatusMenuId = null;
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
                applyUrlInitialFilter();
                render();
                highlightTargetProject();
            })
            .catch(err => showError(err.message));
    }

    function applyUrlInitialFilter() {
        const params = new URLSearchParams(window.location.search);
        const targetProjectId = params.get('project_id');
        const urlStatus = params.get('status');

        if (targetProjectId) {
            const found = (state.projects || []).find(p => String(p.id) === String(targetProjectId));
            if (found) {
                activeStatus = canonicalStatus(found);
                return;
            }
        }
        if (urlStatus) {
            const clean = urlStatus.trim().toLowerCase().replace(/\s+/g, '_');
            if (statusAliases[clean]) {
                activeStatus = statusAliases[clean];
            } else if (pipelineStatuses.includes(urlStatus)) {
                activeStatus = urlStatus;
            }
        } else if (!targetProjectId) {
            const allProjects = normalizedProjects();
            const hasEstimadores = allProjects.some(p => p.statusLabel === 'Estimadores');
            const hasToDo = allProjects.some(p => p.statusLabel === 'To Do');
            if (hasEstimadores && !hasToDo) {
                activeStatus = 'Estimadores';
            }
        }
    }

    function highlightTargetProject() {
        const params = new URLSearchParams(window.location.search);
        const targetProjectId = params.get('project_id');
        if (!targetProjectId) return;
        setTimeout(() => {
            const row = document.querySelector(`[data-project-id="${targetProjectId}"]`) ||
                        document.querySelector(`a[href*="id=${targetProjectId}"]`)?.closest('tr');
            if (row) {
                const scrollParent = row.closest('.bb-table-scroll');
                if (scrollParent) {
                    scrollParent.scrollTop = Math.max(0, row.offsetTop - (scrollParent.clientHeight / 2));
                }
                row.classList.add('bb-row-highlight');
                setTimeout(() => row.classList.remove('bb-row-highlight'), 3500);
            }
            window.scrollTo(0, 0);
        }, 150);
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
            const primaryQuoteValue = Number(metadata.primary_quote_value ?? metadata.primary_estimate_total ?? metadata.primaryEstimateTotal ?? totalValue ?? 0);
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
                primaryQuoteValue,
                sqft,
                salesPerSqFt,
                taskCount: metadata.task_count ?? metadata.tasks_count ?? metadata.tasks ?? '',
                noteCount: metadata.note_count ?? metadata.notes_count ?? metadata.notes ?? '',
                responsibleName: estimatorName || 'Unassigned',
                responsibleInitials: estimatorName ? initials(estimatorName) : 'U'
            };
        });
    }

    function formatCompactMoney(value) {
        const num = Number(value || 0);
        if (!num || num === 0) return '--';
        if (num >= 1000000) {
            const m = num / 1000000;
            const formatted = m >= 100 ? m.toFixed(1) : (m % 1 === 0 ? m.toFixed(0) : (m >= 10 ? m.toFixed(2) : m.toFixed(1)));
            return `$${formatted.replace(/\.0$/, '')}M`;
        }
        if (num >= 1000) {
            const k = num / 1000;
            const formatted = k >= 100 ? k.toFixed(1) : (k % 1 === 0 ? k.toFixed(0) : k.toFixed(2));
            return `$${formatted.replace(/\.00$/, '')}K`;
        }
        return `$${num.toLocaleString('en-US')}`;
    }

    function formatSales(value) {
        const num = Number(value || 0);
        if (!num) return '$0';
        return `$${Math.round(num).toLocaleString('en-US')}`;
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

    function countActiveFilters() {
        let count = 0;
        if (filterState.estimator) count++;
        if (filterState.requester) count++;
        if (filterState.dueDate) count++;
        if (filterState.minSales !== '') count++;
        if (filterState.maxSales !== '') count++;
        return count;
    }

    function updateFilterBadge(matchedCount = null) {
        const count = countActiveFilters();
        const badge = document.getElementById('bbFilterActiveBadge');
        const filterBtn = document.getElementById('bbFiltersBtn');
        const matchLabel = document.getElementById('bbFiltersMatchCount');
        
        if (badge) {
            badge.textContent = count;
            badge.hidden = count === 0;
        }
        if (filterBtn) {
            filterBtn.classList.toggle('active', count > 0);
        }
        if (matchLabel && matchedCount !== null) {
            const total = normalizedProjects().filter(p => p.statusLabel === activeStatus).length;
            if (count === 0) {
                matchLabel.textContent = `Showing all ${total} projects in this phase`;
            } else {
                matchLabel.textContent = `Showing ${matchedCount} of ${total} projects in this phase`;
            }
        }
    }

    function populateFilterEstimators() {
        const select = document.getElementById('bbFilterEstimator');
        if (!select) return;
        const currentVal = filterState.estimator || select.value;
        const estimators = Array.from(new Set(
            normalizedProjects()
                .map(p => p.responsibleName)
                .filter(name => name && name !== 'Unassigned' && name !== '--')
        )).sort();

        select.innerHTML = '<option value="">All Estimators</option>' +
            estimators.map(est => `<option value="${esc(est)}" ${est === currentVal ? 'selected' : ''}>${esc(est)}</option>`).join('') +
            '<option value="Unassigned">Unassigned</option>';
        if (currentVal) select.value = currentVal;
    }

    function toggleFiltersPanel() {
        const panel = document.getElementById('bbFiltersPanel');
        if (!panel) return;
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        if (willOpen) {
            populateFilterEstimators();
            document.getElementById('bbFilterEstimator').value = filterState.estimator;
            document.getElementById('bbFilterRequester').value = filterState.requester;
            document.getElementById('bbFilterDueDate').value = filterState.dueDate;
            document.getElementById('bbFilterMinSales').value = filterState.minSales;
            document.getElementById('bbFilterMaxSales').value = filterState.maxSales;
            updateFilterBadge(visibleProjects().length);
        }
    }

    function applyFilters() {
        filterState.estimator = document.getElementById('bbFilterEstimator')?.value || '';
        filterState.requester = (document.getElementById('bbFilterRequester')?.value || '').trim();
        filterState.dueDate = document.getElementById('bbFilterDueDate')?.value || '';
        filterState.minSales = (document.getElementById('bbFilterMinSales')?.value || '').trim();
        filterState.maxSales = (document.getElementById('bbFilterMaxSales')?.value || '').trim();
        render();
    }

    function clearFilters() {
        filterState = {
            estimator: '',
            requester: '',
            dueDate: '',
            minSales: '',
            maxSales: ''
        };
        const est = document.getElementById('bbFilterEstimator');
        if (est) est.value = '';
        const req = document.getElementById('bbFilterRequester');
        if (req) req.value = '';
        const due = document.getElementById('bbFilterDueDate');
        if (due) due.value = '';
        const minS = document.getElementById('bbFilterMinSales');
        if (minS) minS.value = '';
        const maxS = document.getElementById('bbFilterMaxSales');
        if (maxS) maxS.value = '';
        render();
    }

    function openPhaseConfig() {
        const cfg = getPhaseConfig();
        const list = document.getElementById('bbPhaseList');
        if (!list) return;
        list.innerHTML = pipelineStatuses.map(status => {
            const current = cfg[status] || { label: status, color: '#1d5cc9' };
            const safeKey = esc(status);
            return `
                <div class="bb-phase-row" data-phase-key="${safeKey}">
                    <span class="bb-phase-key" title="Original Stage: ${safeKey}">${safeKey}</span>
                    <input type="text" class="bb-phase-name-input" value="${esc(current.label)}" placeholder="${safeKey}" data-label-key="${safeKey}">
                    <input type="color" class="bb-phase-color-input" value="${current.color}" data-color-key="${safeKey}" title="Choose phase color">
                    <div class="bb-phase-preview-wrap">
                        <span class="bb-phase-live-pill" id="bbPrev_${safeKey}" style="background-color: ${current.color}; color: #ffffff;">
                            ${esc(current.label.toUpperCase())}
                        </span>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.bb-phase-row').forEach(row => {
            const key = row.dataset.phaseKey;
            const textInput = row.querySelector('[data-label-key]');
            const colorInput = row.querySelector('[data-color-key]');
            const prev = document.getElementById(`bbPrev_${key}`);

            if (colorInput && prev) {
                colorInput.addEventListener('input', (e) => {
                    prev.style.backgroundColor = e.target.value;
                });
            }
            if (textInput && prev) {
                textInput.addEventListener('input', (e) => {
                    prev.textContent = (e.target.value.trim() || key).toUpperCase();
                });
            }
        });

        document.getElementById('bbPhaseConfigModal').classList.add('open');
    }

    function savePhasesFromModal() {
        const list = document.getElementById('bbPhaseList');
        if (!list) return;
        const cfg = getPhaseConfig();
        list.querySelectorAll('.bb-phase-row').forEach(row => {
            const key = row.dataset.phaseKey;
            const labelInput = row.querySelector('[data-label-key]');
            const colorInput = row.querySelector('[data-color-key]');
            if (key && labelInput && colorInput) {
                cfg[key] = {
                    label: labelInput.value.trim() || key,
                    color: colorInput.value || '#1d5cc9'
                };
            }
        });
        savePhaseConfig(cfg);
        closeModals();
        render();
    }

    function resetPhasesToDefault() {
        if (window.confirm('Reset all phase names and colors to default?')) {
            localStorage.removeItem('takeoff.pipelineConfig');
            openPhaseConfig();
            render();
        }
    }

    function visibleProjects() {
        const q = document.getElementById('bbSearch')?.value.trim().toLowerCase() || '';
        const sortBy = document.getElementById('bbSortBy')?.value || 'createdAt';
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
            .filter(project => {
                if (filterState.estimator && project.responsibleName !== filterState.estimator) {
                    return false;
                }
                if (filterState.requester) {
                    const reqQ = filterState.requester.toLowerCase();
                    const match = (project.requestingEntity || '').toLowerCase().includes(reqQ) ||
                                  (project.requestingContact || '').toLowerCase().includes(reqQ);
                    if (!match) return false;
                }
                if (filterState.dueDate) {
                    const due = toDate(project.dueDate);
                    const now = new Date();
                    now.setHours(0, 0, 0, 0);
                    if (filterState.dueDate === 'none') {
                        if (due) return false;
                    } else if (!due) {
                        return false;
                    } else if (filterState.dueDate === 'overdue') {
                        if (due.getTime() >= now.getTime()) return false;
                    } else if (filterState.dueDate === 'next7') {
                        const next7 = new Date(now.getTime() + 7 * 86400000);
                        if (due.getTime() < now.getTime() || due.getTime() > next7.getTime()) return false;
                    } else if (filterState.dueDate === 'next30') {
                        const next30 = new Date(now.getTime() + 30 * 86400000);
                        if (due.getTime() < now.getTime() || due.getTime() > next30.getTime()) return false;
                    }
                }
                if (filterState.minSales !== '' && !isNaN(Number(filterState.minSales))) {
                    if (project.totalValue < Number(filterState.minSales)) return false;
                }
                if (filterState.maxSales !== '' && !isNaN(Number(filterState.maxSales))) {
                    if (project.totalValue > Number(filterState.maxSales)) return false;
                }
                return true;
            })
            .sort((a, b) => compareProjects(a, b, sortBy) * direction);
    }

    function compareProjects(a, b, sortBy) {
        if (sortBy === 'createdAt') return (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0);
        if (sortBy === 'projectId') return String(a.projectId || '').localeCompare(String(b.projectId || ''));
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
        syncFieldSelectors();
        const exportLabel = document.getElementById('bbExportStageLabel');
        if (exportLabel) {
            const currentPhase = getPhase(activeStatus);
            exportLabel.textContent = `Export Projects (${currentPhase.label})`;
        }
        const isEmpty = !state.projects || state.projects.length === 0;
        document.getElementById('bbEmptyState').hidden = !isEmpty;
        document.getElementById('bbTableControls').hidden = isEmpty;
        document.querySelector('.bb-table-shell').hidden = isEmpty;
        if (!isEmpty) renderTable();
    }

    function renderPipelineTabs() {
        const root = document.getElementById('bbPipelineTabs');
        root.innerHTML = statusSummary().map(row => {
            const phase = getPhase(row.name);
            const isActive = row.name === activeStatus;
            const activeStyle = isActive ? `style="border-bottom-color: ${phase.color} !important;"` : '';
            return `
                <button class="bb-pipeline-tab ${isActive ? 'active' : ''}" type="button" data-status="${esc(row.name)}" ${activeStyle}>
                    <span class="bb-tab-label">${esc(phase.label)} (${row.count})</span>
                    <span class="bb-tab-total">${formatCompactMoney(row.total)}</span>
                </button>
            `;
        }).join('');
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
        updateFilterBadge(projects.length);

        body.innerHTML = projects.map(project => `
            <tr data-project-id="${esc(project.id)}">
                <td class="bb-name-cell">
                    <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; max-width: 100%;">
                        <a class="bb-record-name" href="project_dashboard.php?id=${encodeURIComponent(project.id)}&tab=overview">${esc(project.recordName)}</a>
                        ${project.primaryQuoteValue > 0 ? `<span class="bb-primary-badge" title="Primary Quote: ${money(project.primaryQuoteValue)}">${money(project.primaryQuoteValue)}</span>` : ''}
                    </div>
                    ${project.category && project.category !== '--' ? `<div class="bb-subtext">${esc(project.category)}</div>` : ''}
                </td>
                <td class="bb-col-info-cell">
                    <button class="bb-info-btn" type="button" aria-label="Project information" data-bb-tooltip="${esc(infoTooltip(project))}">
                        <i class="fas fa-chart-column"></i>
                    </button>
                </td>
                <td>
                    <div class="bb-company-title">${esc(safeText(project.requestingEntity))}</div>
                    <div class="bb-company-email">${esc(safeText(project.requestingContact))}</div>
                </td>
                <td class="bb-project-code">${esc(safeText(project.projectId))}</td>
                <td>
                    <div class="bb-due-wrap" data-bb-tooltip="${esc(dueTooltip(project))}">
                        <div class="bb-due-date">${esc(displayDueDate(project.dueDate))}</div>
                        <div class="bb-due-relative">${esc(dueRelative(project.dueDate))}</div>
                    </div>
                </td>
                <td>
                    <div class="bb-sales-value" data-bb-tooltip="${esc(`Total Sales per sq ft:\n${project.salesPerSqFt}`)}">${formatSales(project.totalValue)}</div>
                </td>
                <td>
                    <div class="bb-estimator-wrap" data-bb-tooltip="${esc(`Estimator: ${project.responsibleName || 'Unassigned'}`)}">
                        <div class="bb-estimator-avatar">${esc(project.responsibleInitials)}</div>
                        <span class="bb-estimator-name">${esc(project.responsibleName)}</span>
                    </div>
                </td>
                <td class="bb-col-status-cell">${statusSelect(project)}</td>
                <td class="bb-actions-cell">
                    ${rowActions(project)}
                </td>
            </tr>
        `).join('') || `<tr><td colspan="9" class="bb-empty-row">No projects match the current status, search, and filter criteria.</td></tr>`;

        bindRowControls(body);
        bindHeaderSorting();
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

    function statusSelect(project) {
        const currentPhase = getPhase(project.statusLabel);
        const bgPale = hexToRgba(currentPhase.color, 0.12);
        const borderPale = hexToRgba(currentPhase.color, 0.35);
        const textPale = getDarkerShade(currentPhase.color);
        const isOpen = openStatusMenuId === String(project.id);
        return `
            <div class="bb-status-pill-container ${isOpen ? 'open' : ''}">
                <button type="button" class="bb-status-pill-wrap ${isOpen ? 'active' : ''}" data-status-trigger="${esc(project.id)}" title="Click to Change Status" style="background-color: ${bgPale}; color: ${textPale}; border: 1px solid ${borderPale};">
                    <span class="bb-status-dot" style="background-color: ${currentPhase.color};"></span>
                    <span class="bb-status-pill-label">${esc(currentPhase.label.toUpperCase())}</span>
                    <i class="fas fa-caret-down bb-status-pill-caret" style="color: ${textPale};"></i>
                </button>
                <div class="bb-status-menu-panel ${isOpen ? 'open' : ''}" data-status-panel="${esc(project.id)}">
                    <div class="bb-status-menu-eyebrow">Change Status</div>
                    <div class="bb-status-menu-list">
                        ${pipelineStatuses.map(status => {
                            const phase = getPhase(status);
                            const isCurrent = status === project.statusLabel;
                            const itemBg = hexToRgba(phase.color, 0.12);
                            const itemBorder = hexToRgba(phase.color, 0.32);
                            const itemText = getDarkerShade(phase.color);
                            return `
                                <button type="button" class="bb-status-menu-option ${isCurrent ? 'selected' : ''}" data-set-status="${esc(status)}" data-project-id="${esc(project.id)}">
                                    <span class="bb-status-option-pill" style="background-color: ${itemBg}; border: 1px solid ${itemBorder}; color: ${itemText};">
                                        <span class="bb-status-dot-sm" style="background-color: ${phase.color};"></span>
                                        <span class="bb-status-option-name">${esc(phase.label.toUpperCase())}</span>
                                    </span>
                                    ${isCurrent ? `<i class="fas fa-check bb-status-option-check" style="color: ${phase.color};"></i>` : ''}
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function rowActions(project) {
        return `
            <div class="bb-row-menu">
                <button class="bb-row-menu-toggle" type="button" aria-label="Project actions" data-row-menu="${esc(project.id)}" title="More options">
                    <i class="fas fa-ellipsis-vertical"></i>
                </button>
            </div>
        `;
    }

    function bindHeaderSorting() {
        document.querySelectorAll('th.sortable[data-sort]').forEach(th => {
            th.onclick = () => {
                const col = th.dataset.sort;
                const select = document.getElementById('bbSortBy');
                if (select) {
                    if (select.value === col) {
                        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        select.value = col;
                        sortDirection = 'asc';
                    }
                    render();
                }
            };
        });
    }

    function bindRowControls(root) {
        root.querySelectorAll('[data-status-trigger]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                openMenuId = null;
                openStatusMenuId = openStatusMenuId === button.dataset.statusTrigger ? null : button.dataset.statusTrigger;
                renderTable();
                const activeTrigger = [...document.querySelectorAll('[data-status-trigger]')]
                    .find(c => c.dataset.statusTrigger === String(openStatusMenuId || ''));
                const panel = [...document.querySelectorAll('[data-status-panel]')]
                    .find(p => p.dataset.statusPanel === String(openStatusMenuId || ''));
                if (activeTrigger && panel) positionStatusMenu(panel, activeTrigger);
            });
        });
        root.querySelectorAll('[data-set-status]').forEach(item => {
            item.addEventListener('click', event => {
                event.stopPropagation();
                const status = item.dataset.setStatus;
                const projectId = item.dataset.projectId;
                openStatusMenuId = null;
                updateProjectStatus(projectId, status);
            });
        });
        root.querySelectorAll('[data-row-menu]').forEach(btn => {
            btn.addEventListener('click', event => {
                event.stopPropagation();
                const button = event.currentTarget;
                const projectId = String(button.dataset.rowMenu || '');
                const menu = document.getElementById('bbFloatingRowMenu');
                if (!menu) return;

                if (menu.dataset.currentProject === projectId && !menu.hidden) {
                    menu.hidden = true;
                    menu.removeAttribute('data-current-project');
                    button.classList.remove('active');
                    return;
                }

                document.querySelectorAll('.bb-row-menu-toggle.active').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.bb-status-menu-panel.open').forEach(p => p.classList.remove('open'));
                document.querySelectorAll('.bb-status-pill-wrap.active').forEach(w => w.classList.remove('active'));
                openStatusMenuId = null;

                button.classList.add('active');
                menu.dataset.currentProject = projectId;

                const openLink = document.getElementById('bbActionOpen');
                if (openLink) {
                    openLink.href = `project_dashboard.php?id=${encodeURIComponent(projectId)}&tab=overview`;
                }

                menu.hidden = false;
                const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
                const rect = button.getBoundingClientRect();

                const btnLeft = rect.left / zoom;
                const btnRight = rect.right / zoom;
                const btnTop = rect.top / zoom;
                const btnBottom = rect.bottom / zoom;
                const vpWidth = window.innerWidth / zoom;
                const vpHeight = window.innerHeight / zoom;

                const menuWidth = menu.offsetWidth || 155;
                const menuHeight = menu.offsetHeight || 140;

                // Snug alignment to button's right edge
                let left = btnRight - menuWidth;
                if (left + menuWidth > vpWidth - 6) {
                    left = vpWidth - menuWidth - 6;
                }
                if (left < 6) {
                    left = 6;
                }

                menu.style.position = 'fixed';
                menu.style.zIndex = '99999';
                menu.style.left = `${Math.round(left)}px`;
                menu.style.right = 'auto';

                // Snug 2px gap right under or above the button
                const gap = 2;
                if (btnBottom + menuHeight + gap + 8 <= vpHeight) {
                    menu.style.top = `${Math.round(btnBottom + gap)}px`;
                    menu.style.bottom = 'auto';
                } else {
                    menu.style.top = `${Math.round(Math.max(6, btnTop - menuHeight - gap))}px`;
                    menu.style.bottom = 'auto';
                }
            });
        });
        bindTooltips(root);
    }

    function positionStatusMenu(panel, trigger) {
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const rect = trigger.getBoundingClientRect();

        const triggerLeft = rect.left / zoom;
        const triggerTop = rect.top / zoom;
        const triggerBottom = rect.bottom / zoom;
        const vpWidth = window.innerWidth / zoom;
        const vpHeight = window.innerHeight / zoom;

        const width = 220;
        const height = Math.min(380, panel.scrollHeight || 340);
        const margin = 8;
        const gap = 3;

        panel.style.position = 'fixed';
        panel.style.zIndex = '5200';
        panel.style.width = `${width}px`;
        panel.style.left = `${Math.round(Math.max(margin, Math.min(vpWidth - width - margin, triggerLeft)))}px`;
        panel.style.right = 'auto';

        if (triggerBottom + height + margin <= vpHeight) {
            panel.style.top = `${Math.round(triggerBottom + gap)}px`;
            panel.style.bottom = 'auto';
        } else {
            panel.style.top = `${Math.round(Math.max(margin, triggerTop - height - gap))}px`;
            panel.style.bottom = 'auto';
        }
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

    function syncFieldSelectors() {
        document.querySelectorAll('.bt-selector-wrap').forEach(wrap => {
            const select = wrap.querySelector('select');
            const labelText = wrap.querySelector('.bt-picker-bottom');
            const menu = wrap.querySelector('.bt-field-menu');
            if (!select) return;
            const currentOpt = select.options[select.selectedIndex];
            if (currentOpt && labelText) {
                labelText.textContent = currentOpt.textContent;
            }
            if (menu) {
                menu.querySelectorAll('.bt-field-option').forEach(optBtn => {
                    const isActive = optBtn.dataset.value === select.value;
                    optBtn.classList.toggle('active', isActive);
                    optBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
                });
            }
        });
    }

    function initFieldSelectors() {
        document.querySelectorAll('.bt-selector-wrap').forEach(wrap => {
            const trigger = wrap.querySelector('.bt-field-selector');
            const menu = wrap.querySelector('.bt-field-menu');
            const select = wrap.querySelector('select');
            if (!trigger || !menu || !select) return;

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const willOpen = menu.hidden;
                document.querySelectorAll('.bt-field-menu:not([hidden])').forEach(m => {
                    if (m !== menu) {
                        m.hidden = true;
                        m.closest('.bt-selector-wrap')?.querySelector('.bt-field-selector')?.setAttribute('aria-expanded', 'false');
                    }
                });
                menu.hidden = !willOpen;
                trigger.setAttribute('aria-expanded', String(willOpen));
            });

            menu.querySelectorAll('.bt-field-option').forEach(optBtn => {
                optBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = optBtn.dataset.value;
                    if (select.value !== val) {
                        select.value = val;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    syncFieldSelectors();
                    menu.hidden = true;
                    trigger.setAttribute('aria-expanded', 'false');
                });
            });

            select.addEventListener('change', syncFieldSelectors);
        });

        syncFieldSelectors();
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
        const nameInput = document.getElementById('bbProjectName');
        if (nameInput) nameInput.value = 'New Project';
        document.querySelector('input[name="bbProjectMode"][value="template"]').checked = true;
        toggleProjectTemplate();
        document.getElementById('bbProjectModal').classList.add('open');
        setTimeout(() => nameInput?.focus?.(), 40);
    }

    function toggleProjectTemplate() {
        const mode = document.querySelector('input[name="bbProjectMode"]:checked')?.value || 'empty';
        document.querySelectorAll('.bb-mode-card').forEach(card => {
            const isMatch = card.dataset.modeCard === mode;
            card.classList.toggle('active', isMatch);
        });
        const wrap = document.getElementById('bbProjectTemplateWrap');
        if (wrap) wrap.style.display = mode === 'template' ? 'block' : 'none';
    }

    async function createProjectDraft(event) {
        event.preventDefault();
        const mode = document.querySelector('input[name="bbProjectMode"]:checked')?.value || 'empty';
        const templateId = mode === 'template' ? document.getElementById('bbProjectTemplate').value : '';
        const template = (state.templates || []).find(row => String(row.id) === String(templateId));
        const projectName = document.getElementById('bbProjectName')?.value.trim() || 'New Project';
        const submitBtn = event.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating...';
        }
        const draft = {
            mode,
            project_template_id: templateId,
            template_name: template?.name || '',
            name: projectName,
            status: 'to_do',
            measurement_system: 'US',
            estimate_pricing: 'Unlocked',
            created_at: new Date().toISOString()
        };
        localStorage.setItem('takeoff.projectDraft', JSON.stringify(draft));
        try {
            const res = await postProjectAction('save', {
                name: projectName,
                project_template_id: templateId || null,
                status: 'to_do',
                metadata_json: JSON.stringify({
                    estimator: 'Juan Estevez',
                    measurement_system: 'US',
                    estimate_pricing: 'Unlocked',
                    notes: [],
                    tasks: []
                })
            });
            if (res && res.id) {
                localStorage.removeItem('takeoff.projectDraft');
                window.location.href = `project_dashboard.php?id=${encodeURIComponent(res.id)}&tab=overview`;
                return;
            }
        } catch (e) {
            console.warn('Direct project creation fallback to draft', e);
        }
        window.location.href = `project_dashboard.php?draft=1${templateId ? `&template_id=${encodeURIComponent(templateId)}` : ''}&name=${encodeURIComponent(projectName)}`;
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
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const rect = target.getBoundingClientRect();
        tooltipEl.style.left = '0px';
        tooltipEl.style.top = '0px';
        const tipRect = tooltipEl.getBoundingClientRect();

        const tLeft = rect.left / zoom;
        const tTop = rect.top / zoom;
        const tBottom = rect.bottom / zoom;
        const tWidth = rect.width / zoom;
        const tipWidth = tipRect.width / zoom;
        const tipHeight = tipRect.height / zoom;
        const vpWidth = window.innerWidth / zoom;

        const left = Math.min(Math.max(10, tLeft + tWidth / 2 - tipWidth / 2), vpWidth - tipWidth - 10);
        const top = tTop > tipHeight + 14 ? tTop - tipHeight - 8 : tBottom + 8;
        tooltipEl.style.left = `${Math.round(left)}px`;
        tooltipEl.style.top = `${Math.round(top)}px`;
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
        initFieldSelectors();
        document.getElementById('bbCreateProject').addEventListener('click', openCreateProject);
        document.querySelectorAll('[data-open-project-modal]').forEach(btn => btn.addEventListener('click', openCreateProject));
        document.getElementById('bbSearch').addEventListener('input', render);
        document.getElementById('bbSortBy').addEventListener('change', render);
        document.getElementById('bbSortDir').addEventListener('click', () => {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            render();
        });
        document.getElementById('bbConfigPhasesBtn')?.addEventListener('click', openPhaseConfig);
        document.getElementById('bbPhaseSaveBtn')?.addEventListener('click', savePhasesFromModal);
        document.getElementById('bbPhaseResetBtn')?.addEventListener('click', resetPhasesToDefault);

        document.getElementById('bbFiltersBtn')?.addEventListener('click', toggleFiltersPanel);
        document.getElementById('bbApplyFiltersBtn')?.addEventListener('click', applyFilters);
        document.getElementById('bbClearFiltersBtn')?.addEventListener('click', clearFilters);

        document.getElementById('bbFilterEstimator')?.addEventListener('change', applyFilters);
        document.getElementById('bbFilterDueDate')?.addEventListener('change', applyFilters);
        ['bbFilterRequester', 'bbFilterMinSales', 'bbFilterMaxSales'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyFilters();
                }
            });
        });

        const moreBtn = document.getElementById('bbHeadMoreBtn');
        const moreDropdown = document.getElementById('bbHeadDropdown');
        if (moreBtn && moreDropdown) {
            moreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const willOpen = moreDropdown.hidden;
                moreDropdown.hidden = !willOpen;
                moreBtn.setAttribute('aria-expanded', String(!willOpen));
            });
            document.getElementById('bbExportStageBtn')?.addEventListener('click', () => {
                moreDropdown.hidden = true;
                moreBtn.setAttribute('aria-expanded', 'false');
            });
        }

        document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModals));
        document.querySelectorAll('input[name="bbProjectMode"]').forEach(input => input.addEventListener('change', toggleProjectTemplate));
        document.getElementById('bbProjectForm').addEventListener('submit', createProjectDraft);

        document.getElementById('bbActionDuplicate')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = document.getElementById('bbFloatingRowMenu');
            const projectId = menu?.dataset.currentProject;
            if (menu) menu.hidden = true;
            document.querySelectorAll('.bb-row-menu-toggle.active').forEach(b => b.classList.remove('active'));
            if (projectId) runProjectAction('duplicate', projectId);
        });
        document.getElementById('bbActionArchive')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = document.getElementById('bbFloatingRowMenu');
            const projectId = menu?.dataset.currentProject;
            if (menu) menu.hidden = true;
            document.querySelectorAll('.bb-row-menu-toggle.active').forEach(b => b.classList.remove('active'));
            if (projectId) runProjectAction('archive', projectId);
        });
        document.getElementById('bbActionDelete')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = document.getElementById('bbFloatingRowMenu');
            const projectId = menu?.dataset.currentProject;
            if (menu) menu.hidden = true;
            document.querySelectorAll('.bb-row-menu-toggle.active').forEach(b => b.classList.remove('active'));
            if (projectId) runProjectAction('delete', projectId);
        });

        document.addEventListener('click', (e) => {
            const rowMenu = document.getElementById('bbFloatingRowMenu');
            if (rowMenu && !rowMenu.hidden && !e.target.closest('#bbFloatingRowMenu') && !e.target.closest('[data-row-menu]')) {
                rowMenu.hidden = true;
                rowMenu.removeAttribute('data-current-project');
                document.querySelectorAll('.bb-row-menu-toggle.active').forEach(b => b.classList.remove('active'));
            }
            if (moreDropdown && !moreDropdown.hidden && !e.target.closest('#bbHeadMoreBtn')) {
                moreDropdown.hidden = true;
                moreBtn?.setAttribute('aria-expanded', 'false');
            }
            if (!e.target.closest('.bt-selector-wrap')) {
                document.querySelectorAll('.bt-field-menu:not([hidden])').forEach(m => {
                    m.hidden = true;
                    m.closest('.bt-selector-wrap')?.querySelector('.bt-field-selector')?.setAttribute('aria-expanded', 'false');
                });
            }
            if (e.target.closest('.bb-status-menu-panel') || e.target.closest('.bb-status-pill-wrap')) {
                return;
            }
            document.querySelectorAll('.bb-status-menu-panel.open').forEach(p => p.classList.remove('open'));
            document.querySelectorAll('.bb-status-pill-wrap.active').forEach(w => w.classList.remove('active'));
            openStatusMenuId = null;
        });

        const closeFloatingUi = (e) => {
            if (e && e.target && (e.target.closest?.('#bbFloatingRowMenu') || e.target.closest?.('.bb-status-menu-panel') || e.target.closest?.('.bt-selector-wrap'))) {
                return;
            }
            hideTooltip();
            const rowMenu = document.getElementById('bbFloatingRowMenu');
            if (rowMenu && !rowMenu.hidden) {
                rowMenu.hidden = true;
                rowMenu.removeAttribute('data-current-project');
                document.querySelectorAll('.bb-row-menu-toggle.active').forEach(b => b.classList.remove('active'));
            }
            if (moreDropdown && !moreDropdown.hidden) {
                moreDropdown.hidden = true;
                moreBtn?.setAttribute('aria-expanded', 'false');
            }
            document.querySelectorAll('.bt-field-menu:not([hidden])').forEach(m => {
                m.hidden = true;
                m.closest('.bt-selector-wrap')?.querySelector('.bt-field-selector')?.setAttribute('aria-expanded', 'false');
            });
            if (e && e.type === 'scroll') {
                document.querySelectorAll('.bb-status-menu-panel.open').forEach(p => p.classList.remove('open'));
                document.querySelectorAll('.bb-status-pill-wrap.active').forEach(w => w.classList.remove('active'));
                openStatusMenuId = null;
            }
        };
        window.addEventListener('scroll', closeFloatingUi, true);
        window.addEventListener('resize', closeFloatingUi);
        load();
    });
})();
