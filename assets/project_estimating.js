(function () {
    'use strict';
    const root = document.getElementById('estimatingModule');
    if (!root) return;

    const Workspace = window.EstimatingWorkspaceService;
    const Calc = window.EstimateCalculationService;
    const Footer = window.ProjectEstimateFooter;
    if (!Workspace || !Calc) {
        root.innerHTML = '<div class="est-fatal">Estimating could not start. Required services are unavailable.</div>';
        return;
    }

    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    const selectorValue = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const money = value => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const number = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
    const resolveProjectId = () => {
        const query = new URLSearchParams(window.location.search);
        return [root.dataset.projectId, window.ProjectState?.projectId, window.EstimateProjectId,
            query.get('project_id'), query.get('projectId'), query.get('id')]
            .map(Workspace.projectId).find(Boolean) || 0;
    };

    const projectId = resolveProjectId();
    const storageKey = `takeoff.estimating.module.${projectId || 'draft'}`;
    const apiUrl = '../api/project_estimating.php';
    const ui = { search: '', selected: new Set(), saving: false, saveRequested: false, saveTimer: null, loadState: projectId ? 'loading' : 'local',
        message: projectId ? 'Loading estimate' : 'Local draft', collapsed: {}, modal: null };
    let state = readLocal();

    if (!$('estTableHead')) {
        root.classList.add('est-v2');
        root.innerHTML = `<div class="est-main"><section class="est-left"><div class="est-toolbar"><input id="estSearch" type="search" placeholder="Search cost item"><button type="button" data-est-action="create-group">Create group</button><button type="button" data-est-action="delete-selected" disabled>Delete</button></div><div class="est-table-wrap"><table class="est-table"><thead id="estTableHead"></thead><tbody id="estTableBody"></tbody></table></div></section><aside class="est-right"><div class="est-right-scroll"></div><div class="est-total-box"><div id="estimateTotal"></div><div id="estimateSqft"></div></div></aside></div><footer class="est-version-bar" id="versionBar"></footer>`;
    }

    function readLocal() {
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) {}
        return Workspace.workspace(raw || {}, projectId, window.ProjectState?.estimateItems || []);
    }

    function current() { return Workspace.active(state); }
    function summary() { return Calc.calculateSummary(current().groups, current().settings); }
    function allItems() { return current().groups.flatMap(group => group.items.map(item => ({ group, item }))); }
    function calculationErrors() {
        return allItems().flatMap(({ item }) => (Calc.calculateItem(item, current().settings).validation || [])
            .map(error => ({ ...error, itemId: item.id, itemName: item.name })));
    }
    function findItem(itemId) { return allItems().find(row => row.item.id === itemId) || null; }
    function saveLocal() {
        state.groups = current().groups;
        state.clientUiUpdatedAt = Workspace.now();
        const stored = Workspace.clone(state);
        if (!stored.pendingProjectCreationSync) delete stored.pendingProjectCreationSync;
        localStorage.setItem(storageKey, JSON.stringify(stored));
        publish();
    }

    function publish() {
        const total = summary();
        window.dispatchEvent(new CustomEvent('takeoff:estimating-state-updated', { detail: {
            projectId: String(projectId), activeEstimateId: state.activeEstimateId,
            estimates: state.estimates.map(row => ({ id: row.id, name: row.name, status: row.status })),
            summary: { material: total.direct.materialSales, labor: total.direct.laborSales,
                equipment: total.direct.equipmentSales, preTaxMarkup: total.preTaxTotal,
                taxes: total.totalTax, total: total.estimateTotal, profit: total.profit }
        } }));
        window.dispatchEvent(new CustomEvent('takeoff:estimate-summary-updated', { detail: total }));
    }

    function changed(action) {
        Workspace.touch(state, action);
        saveLocal();
        scheduleSave();
        render();
    }

    function reactiveChanged(target) {
        Workspace.touch(state);
        saveLocal();
        scheduleSave();
        renderPreservingInput(target);
    }

    function renderPreservingInput(target) {
        const rowId = target.closest('[data-item-id]')?.dataset.itemId;
        const identity = rowId && target.dataset.itemField
            ? { rowId, key: 'itemField', value: target.dataset.itemField }
            : ['setting', 'tax', 'markupValue'].map(key => target.dataset[key] !== undefined
                ? { key, value: target.dataset[key] } : null).find(Boolean);
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const rawValue = target.value;
        renderTable();
        renderDetails();
        renderFooter();
        renderStatus();
        if (!identity) return;
        const scope = identity.rowId
            ? root.querySelector(`[data-item-id="${selectorValue(identity.rowId)}"]`)
            : root;
        const replacement = scope?.querySelector(`[data-${identity.key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}="${selectorValue(identity.value)}"]`);
        if (replacement && rawValue !== undefined) replacement.value = rawValue;
        replacement?.focus();
        if (replacement?.setSelectionRange && replacement.type !== 'number' && start !== null && end !== null) {
            replacement.setSelectionRange(start, end);
        }
    }

    function scheduleSave() {
        if (!projectId) return;
        ui.saveRequested = true;
        clearTimeout(ui.saveTimer);
        ui.loadState = 'pending';
        ui.message = 'Unsaved changes';
        ui.saveTimer = setTimeout(saveServer, 500);
    }

    async function request(action, options = {}) {
        const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}&project_id=${projectId}`, options);
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) throw new Error(result?.message || `HTTP ${response.status}`);
        return result;
    }

    async function saveServer() {
        if (!projectId) return;
        if (ui.saving) {
            ui.saveRequested = true;
            return;
        }
        if (calculationErrors().length) {
            ui.loadState = 'error';
            ui.message = 'Cannot save: every margin must be below 100%.';
            renderStatus();
            return;
        }
        ui.saving = true;
        ui.saveRequested = false;
        ui.loadState = 'saving';
        ui.message = 'Saving…';
        renderStatus();
        const sent = Workspace.clone(state);
        delete sent.pendingProjectCreationSync;
        try {
            const result = await request('save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save', project_id: projectId, state: sent, summary: summary() }) });
            const acknowledged = Workspace.workspace(result.state || sent, projectId);
            if (state.clientUiUpdatedAt === sent.clientUiUpdatedAt) {
                state = acknowledged;
                ui.loadState = 'saved';
                ui.message = 'Saved';
            } else {
                // A stale response must not replace estimates created or edited
                // while this request was in flight. Carry forward only the
                // server identity and revision needed by the queued save.
                const acknowledgements = new Map(acknowledged.estimates.map(estimate => [String(estimate.id), estimate]));
                state.estimates.forEach(estimate => {
                    const ack = acknowledgements.get(String(estimate.id));
                    if (!ack) return;
                    estimate.dbEstimateId = ack.dbEstimateId;
                    estimate.revision = ack.revision;
                });
                ui.saveRequested = true;
                ui.loadState = 'pending';
                ui.message = 'Unsaved changes';
            }
            saveLocal();
        } catch (error) {
            ui.loadState = 'error';
            ui.message = `Save failed: ${error.message}`;
        } finally {
            ui.saving = false;
            render();
            if (ui.saveRequested) {
                clearTimeout(ui.saveTimer);
                ui.saveTimer = setTimeout(saveServer, 0);
            }
        }
    }

    async function loadServer() {
        if (!projectId) { render(); return; }
        const requestLocalTimestamp = state.clientUiUpdatedAt;
        const forceMigratedLocal = state.pendingProjectCreationSync === true;
        try {
            const result = await request('list');
            const remoteSource = result.state || {};
            const remote = Workspace.workspace(remoteSource, projectId);
            const local = state;
            const changedDuringLoad = local.clientUiUpdatedAt !== requestLocalTimestamp;
            if (forceMigratedLocal || changedDuringLoad || Date.parse(local.clientUiUpdatedAt || 0) > Date.parse(remote.clientUiUpdatedAt || 0)) {
                delete state.pendingProjectCreationSync;
                saveLocal();
                await saveServer();
                return;
            }
            if (Array.isArray(remoteSource.estimates) && remoteSource.estimates.length) state = remote;
            ui.loadState = 'saved';
            ui.message = 'Loaded from server';
            saveLocal();
        } catch (error) {
            ui.loadState = 'error';
            ui.message = `Offline: ${error.message}`;
        }
        render();
    }

    function reconcileGroups(groups) {
        if (!Array.isArray(groups)) return;
        const currentEstimate = current();
        if (groups.some(group => Array.isArray(group.items))) {
            currentEstimate.groups = groups.map(Workspace.group);
        } else if (window.TakeoffEstimatingSyncService?.reconcile) {
            currentEstimate.groups = window.TakeoffEstimatingSyncService.reconcile(currentEstimate.groups,
                groups).map(Workspace.group);
        } else {
            currentEstimate.groups = groups.map(Workspace.group);
        }
        changed('Synchronized items from Takeoff');
    }

    function render() {
        renderTable();
        renderDetails();
        renderFooter();
        renderStatus();
        renderModal();
    }

    const columns = [
        ['name', 'Item'], ['description', 'Description'], ['costCategory', 'Category'], ['uom', 'UoM'],
        ['quantity', 'Qty'], ['unitMaterialCost', 'Material/unit'], ['waste', 'Waste %'],
        ['unitLabor', 'Labor/unit'], ['laborRate', 'Labor rate'], ['difficulty', 'Difficulty'],
        ['materialMargin', 'Material margin %'], ['laborMargin', 'Labor margin %'],
        ['unitEquipmentCost', 'Equipment/unit'], ['equipmentQuantity', 'Equipment qty'], ['equipmentMargin', 'Equipment margin %']
    ];

    function renderTable() {
        const head = $('estTableHead');
        const body = $('estTableBody');
        if (!head || !body) return;
        head.innerHTML = `<tr><th class="est-check-col"><input type="checkbox" data-select-all aria-label="Select all"></th>${columns.map(([, label]) => `<th>${esc(label)}</th>`).join('')}<th>Cost</th><th>Sales</th><th>Profit</th><th></th></tr>`;
        const query = ui.search.trim().toLowerCase();
        const html = [];
        current().groups.forEach(group => {
            const visible = group.items.filter(item => !query || `${item.name} ${item.description} ${item.costCode}`.toLowerCase().includes(query));
            html.push(`<tr class="est-group-row" data-group-id="${esc(group.id)}"><td><input type="checkbox" data-group-check="${esc(group.id)}" aria-label="Select group"></td><td colspan="${columns.length + 3}"><button type="button" class="est-group-toggle" data-toggle-group="${esc(group.id)}"><i class="fas fa-chevron-${group.expanded ? 'down' : 'right'}"></i></button><input class="est-group-name" data-group-name="${esc(group.id)}" value="${esc(group.name)}"><span>${visible.length} items</span></td><td><button type="button" class="est-row-action" data-add-item="${esc(group.id)}" title="Add item"><i class="fas fa-plus"></i></button><button type="button" class="est-row-action" data-delete-group="${esc(group.id)}" title="Delete group"><i class="fas fa-trash"></i></button></td></tr>`);
            if (!group.expanded) return;
            visible.forEach(item => {
                const calc = Calc.calculateItem(item, current().settings);
                const invalid = (calc.validation || []).length > 0;
                html.push(`<tr class="est-item-row ${ui.selected.has(item.id) ? 'selected' : ''} ${invalid ? 'est-invalid-row' : ''}" data-item-id="${esc(item.id)}" ${invalid ? 'title="Margins must be below 100%"' : ''}>
                    <td><input type="checkbox" data-item-check="${esc(item.id)}" ${ui.selected.has(item.id) ? 'checked' : ''}></td>
                    ${columns.map(([key]) => cell(item, key)).join('')}
                    <td class="est-money">${money(calc.totalCost)}</td><td class="est-money">${money(calc.totalSales)}</td><td class="est-money">${money(calc.profit)}</td>
                    <td><button type="button" class="est-row-action" data-delete-item="${esc(item.id)}" title="Delete"><i class="fas fa-trash"></i></button></td></tr>`);
            });
        });
        body.innerHTML = html.join('') || `<tr><td colspan="${columns.length + 5}" class="est-empty">No estimate items. Create a group or add items in Takeoff.</td></tr>`;
        const deleteButton = root.querySelector('[data-est-action="delete-selected"]');
        if (deleteButton) deleteButton.disabled = ui.selected.size === 0;
    }

    function cell(item, key) {
        if (key === 'costCategory') return `<td><select data-item-field="${key}"><option ${item[key] === 'Materials' ? 'selected' : ''}>Materials</option><option ${item[key] === 'Labor' ? 'selected' : ''}>Labor</option><option ${item[key] === 'Equipment' ? 'selected' : ''}>Equipment</option></select></td>`;
        const numericKeys = new Set(['quantity', 'unitMaterialCost', 'waste', 'unitLabor', 'laborRate', 'difficulty', 'materialMargin', 'laborMargin', 'unitEquipmentCost', 'equipmentQuantity', 'equipmentMargin']);
        const locked = key === 'quantity' && item.takeoffLayerId;
        const margin = key.toLowerCase().includes('margin');
        const invalid = margin && Number(item[key]) >= 100;
        return `<td><input data-item-field="${key}" ${numericKeys.has(key) ? `type="number" step="0.01" ${margin ? 'max="99.99"' : ''}` : 'type="text"'} value="${esc(item[key])}" ${invalid ? 'aria-invalid="true" title="Margin must be below 100%"' : ''} ${locked ? 'readonly title="Quantity is synchronized from Takeoff"' : ''}></td>`;
    }

    function renderDetails() {
        const aside = root.querySelector('.est-right-scroll');
        if (!aside) return;
        const estimate = current();
        const total = summary();
        aside.innerHTML = `${card('notes', 'Notes', notesHtml(estimate))}${card('summary', 'Summary', summaryHtml(total))}${card('audit', 'Audit', auditHtml(estimate))}`;
        const totalElement = $('estimateTotal');
        if (totalElement) totalElement.textContent = money(total.estimateTotal);
        const sqft = Number(window.ProjectState?.projectMeta?.square_footage || 0);
        const sqftElement = $('estimateSqft');
        if (sqftElement) sqftElement.textContent = sqft ? `${money(total.estimateTotal / sqft)}/sq ft` : '--/sq ft';
    }

    function card(key, title, content) {
        const collapsed = ui.collapsed[key] === true;
        return `<section class="est-card ${collapsed ? 'collapsed' : ''}" id="${key}Card"><button class="est-card-header" type="button" data-collapse-card="${key}" aria-expanded="${!collapsed}"><span><i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i> ${title}</span></button>${collapsed ? '' : `<div class="est-card-body">${content}</div>`}</section>`;
    }

    function notesHtml(estimate) {
        const notes = estimate.notes;
        return `<label class="est-field-block"><span class="est-label">Scope of Work</span><textarea data-note-field="scope" placeholder="Write the scope of work…">${esc(notes.scope)}</textarea></label>
            ${listEditor('included', 'Included', notes.included)}${listEditor('excluded', 'Excluded', notes.excluded)}
            <label class="est-field-block"><span class="est-label">Project Notes</span><textarea data-note-field="projectNotes" placeholder="Write a project note…">${esc(notes.projectNotes)}</textarea></label>`;
    }

    function listEditor(key, label, values) {
        return `<div class="est-field-block"><div class="est-list-head"><span class="est-label">${label}</span><button type="button" class="est-small-btn" data-add-note-row="${key}" title="Add note"><i class="fas fa-plus"></i></button></div><div class="est-free-list">${values.map((value, index) => `<div class="est-free-row"><input data-note-list="${key}" data-index="${index}" value="${esc(value)}" placeholder="Write a note…"><button type="button" data-remove-note-row="${key}" data-index="${index}" title="Remove note"><i class="fas fa-times"></i></button></div>`).join('') || `<button type="button" class="est-empty-note" data-add-note-row="${key}">+ Add ${label.toLowerCase()} note</button>`}</div></div>`;
    }

    function summaryHtml(total) {
        const settings = current().settings;
        return `<div class="est-rate-grid"><label>Global labor cost<input type="number" step="0.01" min="0" data-setting="globalLaborCost" value="${settings.globalLaborCost}"></label><label>Global labor margin %<input type="number" step="0.01" max="99.99" data-setting="globalLaborMargin" value="${settings.globalLaborMargin}"></label></div>
            <div class="est-summary-grid">${['Materials', 'Labor', 'Equipment'].map(name => `<div><strong>${name}</strong><span>${money(total.byCategory[name].totalSales)}</span></div>`).join('')}<div><strong>Direct cost</strong><span>${money(total.direct.totalCost)}</span></div><div><strong>Direct sales</strong><span>${money(total.direct.totalSales)}</span></div><div><strong>Profit</strong><span>${money(total.profit)}</span></div></div>
            ${markupSection('preTaxMarkups', 'Pre-tax markups', total.preTaxMarkups)}
            <div class="est-summary-section"><div class="est-summary-title">Taxes</div>${['Materials', 'Labor', 'Equipment'].map(name => `<label class="est-markup-row"><span>${name}</span><input type="number" step="0.01" data-tax="${name}" value="${settings.taxes[name]}"><span>%</span><strong>${money(total.taxes[name])}</strong></label>`).join('')}</div>
            ${markupSection('postTaxMarkups', 'Post-tax markups', total.postTaxMarkups)}
            <div class="est-summary-total"><span>Estimate total</span><strong>${money(total.estimateTotal)}</strong></div>`;
    }

    function markupSection(key, title, rows) {
        const bases = [['subtotal_sales', 'Sales subtotal'], ['material_sales', 'Materials'], ['labor_sales', 'Labor'], ['equipment_sales', 'Equipment'], ['total_cost', 'Total cost'], ['previous_adjustments', 'Previous adjustments'], ['subtotal_plus_previous_adjustments', 'Subtotal + adjustments']];
        return `<div class="est-summary-section"><div class="est-summary-title"><span>${title}</span><button type="button" data-add-markup="${key}"><i class="fas fa-plus"></i></button></div>${rows.map(row => `<div class="est-markup-row"><input data-markup-name="${row.id}" value="${esc(row.name)}"><select data-markup-type="${row.id}"><option value="percentage" ${row.type === 'percentage' ? 'selected' : ''}>%</option><option value="fixed_amount" ${row.type === 'fixed_amount' ? 'selected' : ''}>$</option></select><input type="number" step="0.01" data-markup-value="${row.id}" value="${row.type === 'fixed_amount' ? row.amount : row.percent}"><select data-markup-base="${row.id}" title="Calculation base">${bases.map(([value, label]) => `<option value="${value}" ${row.base === value ? 'selected' : ''}>${label}</option>`).join('')}</select><label class="est-markup-active" title="Active"><input type="checkbox" data-markup-active="${row.id}" ${row.active !== false ? 'checked' : ''}></label><strong>${money(row.value)}</strong><button type="button" data-delete-markup="${row.id}"><i class="fas fa-times"></i></button></div>`).join('')}</div>`;
    }

    function auditHtml(estimate) {
        return `<div class="est-audit-actions"><button type="button" class="est-small-btn" data-audit-export>Export JSON</button><button type="button" class="est-small-btn" data-audit-clear>Clear</button></div><div class="est-audit-list">${estimate.auditLog.slice().reverse().map(row => `<div class="est-audit-row"><time>${esc(new Date(row.at).toLocaleString())}</time><span>${esc(row.action)}</span></div>`).join('') || '<div class="est-empty">No activity yet.</div>'}</div>`;
    }

    function renderFooter() {
        const bar = $('versionBar');
        if (!bar) return;
        if (Footer?.render) {
            bar.innerHTML = Footer.render({ estimates: state.estimates, activeEstimateId: state.activeEstimateId,
                selectAttribute: 'data-version', actionAttribute: 'data-estimating-action' });
        } else {
            bar.innerHTML = state.estimates.map(row => `<button data-version="${row.id}" class="${row.id === state.activeEstimateId ? 'active' : ''}">${esc(row.name)}</button>`).join('');
        }
    }

    function renderStatus() {
        let status = root.querySelector('.est-save-status');
        if (!status) {
            status = document.createElement('div');
            status.className = 'est-save-status';
            root.appendChild(status);
        }
        status.dataset.state = ui.loadState;
        status.innerHTML = `<span></span>${esc(ui.message)}${ui.loadState === 'error' ? '<button type="button" data-retry-save>Retry</button>' : ''}`;
    }

    function renderModal() {
        document.querySelector('[data-estimating-modal-portal]')?.remove();
        if (!ui.modal) return;
        const portal = document.createElement('div');
        portal.dataset.estimatingModalPortal = '';
        portal.className = 'est-modal-backdrop';
        if (ui.modal === 'new') portal.innerHTML = `<div class="est-dialog est-copy-modal" role="dialog" aria-modal="true" aria-labelledby="copyEstimateTitle"><header><div><h2 id="copyEstimateTitle">New Estimate</h2><span>Create an independent estimate for this project</span></div><button type="button" aria-label="Close" data-close-modal>&times;</button></header><div class="est-copy-body"><label class="est-copy-name"><span>Name</span><input id="copyEstimateName" type="text" value="${esc(current().name)} Copy" autocomplete="off"></label><fieldset><legend>Starting point</legend><label class="est-copy-option"><input type="radio" name="copyEstimateMode" value="all" checked><span><strong>Copy everything</strong><small>Start with the current groups, items, quantities, notes and markups.</small></span></label><label class="est-copy-option"><input type="radio" name="copyEstimateMode" value="structure"><span><strong>Groups only</strong><small>Keep the current group structure without its cost items.</small></span></label><label class="est-copy-option"><input type="radio" name="copyEstimateMode" value="blank"><span><strong>Blank</strong><small>Start with a clean estimate.</small></span></label></fieldset></div><footer><button type="button" data-close-modal>Cancel</button><button type="button" class="est-btn-primary" data-create-estimate data-est-action="create-estimate-copy">Create estimate</button></footer></div>`;
        if (ui.modal === 'compare') portal.innerHTML = `<div class="est-dialog est-compare" role="dialog" aria-modal="true"><header><h2>Compare Estimates</h2><button type="button" data-close-modal data-modal-close="compareOpen">&times;</button></header><div class="est-compare-grid">${state.estimates.map(row => { const total = Calc.calculateSummary(row.groups, row.settings); return `<article><h3>${esc(row.name)}</h3><p>${row.groups.reduce((sum, group) => sum + group.items.length, 0)} items</p><strong>${money(total.estimateTotal)}</strong><span>${money(total.profit)} profit</span></article>`; }).join('')}</div></div>`;
        document.body.appendChild(portal);
        portal.querySelector('input, button')?.focus();
    }

    function createGroup() {
        const group = Workspace.group({ name: `Group ${current().groups.length + 1}`, items: [] }, current().groups.length);
        current().groups.push(group);
        changed(`Created group “${group.name}”`);
    }

    function addItem(groupId) {
        const group = current().groups.find(row => row.id === groupId);
        if (!group) return;
        group.items.push(Workspace.item({ name: 'New cost item', laborRate: current().settings.globalLaborCost }));
        group.expanded = true;
        changed(`Added item to “${group.name}”`);
    }

    function exportEstimate() {
        const blob = new Blob([JSON.stringify({ state, summary: summary() }, null, 2)], { type: 'application/json' });
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = `${current().name.replace(/[^a-z0-9_-]+/gi, '_')}.json`;
        anchor.click();
        URL.revokeObjectURL(anchor.href);
    }

    root.addEventListener('input', event => {
        if (event.target.id === 'estSearch') { ui.search = event.target.value; renderTable(); return; }
        const estimate = current();
        const itemRow = event.target.closest('[data-item-id]');
        const itemField = event.target.dataset.itemField;
        if (itemRow && itemField && event.target.type === 'number') {
            const found = findItem(itemRow.dataset.itemId);
            if (!found) return;
            found.item[itemField] = Workspace.numeric(event.target.value);
            found.item.updatedAt = Workspace.now();
            reactiveChanged(event.target);
            return;
        }
        if (event.target.dataset.setting) {
            estimate.settings[event.target.dataset.setting] = Workspace.numeric(event.target.value);
            reactiveChanged(event.target);
            return;
        }
        if (event.target.dataset.tax) {
            estimate.settings.taxes[event.target.dataset.tax] = Workspace.numeric(event.target.value);
            reactiveChanged(event.target);
            return;
        }
        if (event.target.dataset.markupValue) {
            updateMarkupValue(event.target);
            reactiveChanged(event.target);
            return;
        }
        if (event.target.dataset.noteField) {
            estimate.notes[event.target.dataset.noteField] = event.target.value;
            estimate.updatedAt = Workspace.now();
            saveLocal();
            scheduleSave();
            return;
        }
        if (event.target.dataset.noteList) {
            estimate.notes[event.target.dataset.noteList][Number(event.target.dataset.index)] = event.target.value;
            estimate.updatedAt = Workspace.now();
            saveLocal();
            scheduleSave();
        }
    });

    root.addEventListener('change', event => {
        const row = event.target.closest('[data-item-id]');
        const field = event.target.dataset.itemField;
        if (row && field) {
            const found = findItem(row.dataset.itemId);
            if (!found) return;
            found.item[field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
            found.item.updatedAt = Workspace.now();
            changed(`Updated ${found.item.name}`);
            return;
        }
        if (event.target.matches('[data-item-check]')) {
            event.target.checked ? ui.selected.add(event.target.dataset.itemCheck) : ui.selected.delete(event.target.dataset.itemCheck);
            renderTable(); return;
        }
        if (event.target.matches('[data-select-all]')) {
            ui.selected = event.target.checked ? new Set(allItems().map(row => row.item.id)) : new Set();
            renderTable(); return;
        }
        const estimate = current();
        if (event.target.dataset.noteField) { estimate.notes[event.target.dataset.noteField] = event.target.value; changed('Updated notes'); return; }
        if (event.target.dataset.noteList) { estimate.notes[event.target.dataset.noteList][Number(event.target.dataset.index)] = event.target.value; changed('Updated notes'); return; }
        if (event.target.dataset.setting) { estimate.settings[event.target.dataset.setting] = Number(event.target.value); changed('Updated estimate settings'); return; }
        if (event.target.dataset.tax) { estimate.settings.taxes[event.target.dataset.tax] = Number(event.target.value); changed('Updated taxes'); return; }
        updateMarkup(event.target);
    });

    function updateMarkup(target) {
        const id = target.dataset.markupName || target.dataset.markupType || target.dataset.markupValue;
        if (!id) return;
        const rows = [...current().settings.preTaxMarkups, ...current().settings.postTaxMarkups];
        const row = rows.find(candidate => candidate.id === id);
        if (!row) return;
        if (target.dataset.markupName) row.name = target.value;
        if (target.dataset.markupType) row.type = target.value;
        if (target.dataset.markupBase) row.base = target.value;
        if (target.dataset.markupActive) row.active = target.checked;
        if (target.dataset.markupValue) row[row.type === 'fixed_amount' ? 'amount' : 'percent'] = Workspace.numeric(target.value);
        changed('Updated markup');
    }

    function updateMarkupValue(target) {
        const rows = [...current().settings.preTaxMarkups, ...current().settings.postTaxMarkups];
        const row = rows.find(candidate => candidate.id === target.dataset.markupValue);
        if (row) row[row.type === 'fixed_amount' ? 'amount' : 'percent'] = Workspace.numeric(target.value);
    }

    root.addEventListener('click', event => {
        const target = event.target;
        const action = target.closest('[data-est-action]')?.dataset.estAction;
        if (action === 'create-group') createGroup();
        if (action === 'delete-selected') {
            current().groups.forEach(group => { group.items = group.items.filter(item => !ui.selected.has(item.id)); });
            ui.selected.clear(); changed('Deleted selected items');
        }
        if (action === 'reset-quantities') {
            allItems().forEach(({ item }) => { item.quantity = item.takeoffLayerId ? item.lastSyncedTakeoffQuantity : item.originalQuantity; });
            changed('Reset quantities');
        }
        if (action === 'fullscreen') document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.();
        if (action === 'options') $('optionsMenu')?.classList.toggle('open');
        const option = target.closest('[data-est-option]')?.dataset.estOption;
        if (option === 'save') saveServer();
        if (option === 'copy') { ui.modal = 'new'; renderModal(); }
        if (option === 'export') exportEstimate();
        const collapse = target.closest('[data-collapse-card]')?.dataset.collapseCard;
        if (collapse) { ui.collapsed[collapse] = !ui.collapsed[collapse]; renderDetails(); }
        const toggle = target.closest('[data-toggle-group]')?.dataset.toggleGroup;
        if (toggle) { const group = current().groups.find(row => row.id === toggle); group.expanded = !group.expanded; changed(); }
        const add = target.closest('[data-add-item]')?.dataset.addItem;
        if (add) addItem(add);
        const deleteItem = target.closest('[data-delete-item]')?.dataset.deleteItem;
        if (deleteItem) { const found = findItem(deleteItem); found.group.items = found.group.items.filter(row => row.id !== deleteItem); changed(`Deleted ${found.item.name}`); }
        const deleteGroup = target.closest('[data-delete-group]')?.dataset.deleteGroup;
        if (deleteGroup && confirm('Delete this group and its items?')) { current().groups = current().groups.filter(row => row.id !== deleteGroup); changed('Deleted group'); }
        const addRow = target.closest('[data-add-note-row]')?.dataset.addNoteRow;
        if (addRow) { current().notes[addRow].push(''); changed(`Added ${addRow} note`); }
        const removeRow = target.closest('[data-remove-note-row]');
        if (removeRow) { current().notes[removeRow.dataset.removeNoteRow].splice(Number(removeRow.dataset.index), 1); changed('Removed note'); }
        const addMarkup = target.closest('[data-add-markup]')?.dataset.addMarkup;
        if (addMarkup) { current().settings[addMarkup].push({ id: Workspace.uid('markup'), name: 'Markup', type: 'percentage', percent: 0, amount: 0, base: 'subtotal_sales', active: true }); changed('Added markup'); }
        const deleteMarkup = target.closest('[data-delete-markup]')?.dataset.deleteMarkup;
        if (deleteMarkup) { ['preTaxMarkups', 'postTaxMarkups'].forEach(key => { current().settings[key] = current().settings[key].filter(row => row.id !== deleteMarkup); }); changed('Deleted markup'); }
        if (target.closest('[data-audit-clear]') && confirm('Clear audit history?')) { current().auditLog = []; changed(); }
        if (target.closest('[data-audit-export]')) {
            const blob = new Blob([JSON.stringify(current().auditLog, null, 2)], { type: 'application/json' });
            const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = 'estimate-audit.json'; anchor.click(); URL.revokeObjectURL(anchor.href);
        }
        const version = target.closest('[data-version]')?.dataset.version;
        if (version) selectEstimate(version);
        const footerAction = target.closest('[data-estimating-action]')?.dataset.estimatingAction;
        if (footerAction === 'new-estimate') { ui.modal = 'new'; renderModal(); }
        if (footerAction === 'compare-estimates') { ui.modal = 'compare'; renderModal(); }
        if (target.closest('[data-retry-save]')) saveServer();
    });

    root.addEventListener('change', event => {
        if (!event.target.matches('[data-group-name]')) return;
        const group = current().groups.find(row => row.id === event.target.dataset.groupName);
        if (group) { group.name = event.target.value.trim() || 'Untitled Group'; changed('Renamed group'); }
    });

    document.addEventListener('click', event => {
        const portal = event.target.closest('[data-estimating-modal-portal]');
        if (!portal) return;
        if (event.target.closest('[data-close-modal]') || event.target === portal) { ui.modal = null; renderModal(); return; }
        if (event.target.closest('[data-create-estimate]')) {
            const name = portal.querySelector('#copyEstimateName')?.value;
            const mode = portal.querySelector('input[name="copyEstimateMode"]:checked')?.value || 'blank';
            Workspace.createEstimate(state, name, mode); ui.modal = null; saveLocal();
            if (projectId) saveServer();
            render();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && ui.modal) { ui.modal = null; renderModal(); }
    });

    function refreshEstimateFromStorage(estimateId) {
        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (stored?.estimates?.some(row => String(row.id) === String(estimateId))) state = Workspace.workspace(stored, projectId);
        } catch (_) {}
    }

    function selectEstimate(estimateId) {
        const selected = Workspace.selectEstimate(state, estimateId);
        if (!selected) return;
        Workspace.touch(state, `Selected estimate “${current().name}”`);
        ui.selected.clear(); saveLocal(); scheduleSave(); render();
    }

    window.addEventListener('takeoff:estimating-lines-updated', event => {
        if (event.detail?.projectId && String(event.detail.projectId) !== String(projectId)) return;
        reconcileGroups(event.detail?.groups || []);
    });
    window.addEventListener('takeoff:active-estimate-changed', event => {
        if (event.detail?.projectId && String(event.detail.projectId) !== String(projectId)) return;
        refreshEstimateFromStorage(event.detail?.estimateId);
        selectEstimate(event.detail?.estimateId);
    });
    window.addEventListener('takeoff:estimating-action-requested', event => {
        if (event.detail?.action === 'new-estimate') ui.modal = 'new';
        if (event.detail?.action === 'compare-estimates') ui.modal = 'compare';
        renderModal();
    });
    window.addEventListener('storage', event => {
        if (event.key !== storageKey || !event.newValue) return;
        state = Workspace.workspace(JSON.parse(event.newValue), projectId); render();
    });

    window.projectEstimatingSave = async function () {
        if (!projectId) return true;
        const started = Date.now();
        ui.saveRequested = true;
        while (ui.saving || ui.saveRequested) {
            if (Date.now() - started > 15000) throw new Error('Estimating save timed out.');
            if (ui.saving) {
                await new Promise(resolve => setTimeout(resolve, 50));
                continue;
            }
            clearTimeout(ui.saveTimer);
            await saveServer();
            if (ui.loadState === 'error') throw new Error(ui.message);
        }
        return true;
    };

    saveLocal();
    render();
    loadServer();
})();
