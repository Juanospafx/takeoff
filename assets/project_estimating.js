(function () {
    'use strict';
    const root = document.getElementById('estimatingModule');
    if (!root) return;

    const Workspace = window.EstimatingWorkspaceService;
    const Calc = window.EstimateCalculationService;
    const Exporter = window.EstimatingExportService;
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
    const ui = { search: '', selected: new Set(), saving: false, saveRequested: false, saveTimer: null, pendingDeleteId: null, lastErrorCode: null, loadState: projectId ? 'loading' : 'local',
        message: projectId ? 'Loading estimate' : 'Local draft', collapsed: {}, modal: null,
        catalogTargetGroupId: null, catalogData: null, catalogLoading: false, catalogError: '' };
    let state = readLocal();
    const dirtyEstimateIds = new Set(state.dirtyEstimateIds || []);
    const takeoffSyncDirtyIds = new Set(state.takeoffSyncDirtyIds || []);
    const conflictedEstimateIds = new Set();
    const conflictRemoteEstimates = new Map();
    const dirtyGenerations = new Map();
    const automaticRebaseKeys = new Set();
    const deletingEstimateIds = new Set();
    let dirtyGeneration = 0;
    const pendingTakeoffByEstimate = new Map();

    function restoreDirtyTracking() {
        dirtyEstimateIds.clear();
        dirtyGenerations.clear();
        (state.dirtyEstimateIds || []).forEach(id => {
            const normalized = String(id);
            if (!state.estimates.some(estimate => String(estimate.id) === normalized)) return;
            dirtyEstimateIds.add(normalized);
            dirtyGenerations.set(normalized, ++dirtyGeneration);
        });
    }

    if (!$('estTableHead')) {
        root.classList.add('est-v2');
        root.innerHTML = `<div class="est-main"><section class="est-left"><div class="est-toolbar"><input id="estSearch" type="search" placeholder="Search cost item"><button type="button" data-est-action="create-group">Create group</button><button type="button" data-est-action="catalog-update">Update from Cost Catalog</button><button type="button" data-est-action="delete-selected" disabled>Delete</button></div><div class="est-table-wrap"><table class="est-table"><thead id="estTableHead"></thead><tbody id="estTableBody"></tbody></table></div></section><aside class="est-right"><div class="est-right-scroll"></div><div class="est-total-box"><div id="estimateTotal"></div><div id="estimateSqft"></div></div></aside></div><footer class="est-version-bar" id="versionBar"></footer>`;
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
    function markEstimateDirty(estimateId = state.activeEstimateId) {
        const id = String(estimateId || '');
        if (!id) return;
        dirtyEstimateIds.add(id);
        dirtyGenerations.set(id, ++dirtyGeneration);
        state.dirtyEstimateIds = [...dirtyEstimateIds];
        state.takeoffSyncDirtyIds = [...takeoffSyncDirtyIds];
    }
    function saveLocal() {
        state.groups = current().groups;
        state.dirtyEstimateIds = [...dirtyEstimateIds];
        state.takeoffSyncDirtyIds = [...takeoffSyncDirtyIds];
        state.clientUiUpdatedAt = Workspace.now();
        const stored = Workspace.clone(state);
        if (!stored.pendingProjectCreationSync) delete stored.pendingProjectCreationSync;
        localStorage.setItem(storageKey, JSON.stringify(stored));
        publish();
    }

    function applyDeletedEstimateTombstones(workspace, additionalIds = []) {
        const deletedIds = new Set([
            ...(state?.deletedEstimateIds || []),
            ...(workspace?.deletedEstimateIds || []),
            ...additionalIds
        ].map(String));
        workspace.deletedEstimateIds = [...deletedIds].sort();
        if (!deletedIds.size) return workspace;
        workspace.estimates = workspace.estimates.filter(estimate => !deletedIds.has(String(estimate.id)));
        if (!workspace.estimates.length) return workspace;
        if (!workspace.estimates.some(estimate => String(estimate.id) === String(workspace.activeEstimateId))) {
            workspace.activeEstimateId = workspace.estimates[0].id;
        }
        Workspace.selectEstimate(workspace, workspace.activeEstimateId);
        return workspace;
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
        window.dispatchEvent(new CustomEvent('takeoff:estimating-items-updated', { detail: {
            version: 1, origin: 'estimating', projectId: String(projectId),
            activeEstimateId: String(state.activeEstimateId), revision: Number(current().revision || 0),
            groups: Workspace.clone(current().groups)
        } }));
        window.dispatchEvent(new CustomEvent('takeoff:estimate-summary-updated', { detail: total }));
    }

    function changed(action) {
        const activeId = String(state.activeEstimateId || '');
        if (action === 'Synchronized items from Takeoff') takeoffSyncDirtyIds.add(activeId);
        else takeoffSyncDirtyIds.delete(activeId);
        conflictedEstimateIds.delete(activeId);
        conflictRemoteEstimates.delete(activeId);
        Workspace.touch(state, action);
        saveLocal();
        scheduleSave(action === 'Synchronized items from Takeoff' ? 'takeoff' : 'manual');
        render();
    }

    function reactiveChanged(target) {
        takeoffSyncDirtyIds.delete(String(state.activeEstimateId || ''));
        conflictedEstimateIds.delete(String(state.activeEstimateId || ''));
        conflictRemoteEstimates.delete(String(state.activeEstimateId || ''));
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

    function scheduleSave(source = 'manual') {
        if (!projectId) return;
        const activeId = String(state.activeEstimateId || '');
        if (source === 'takeoff') takeoffSyncDirtyIds.add(activeId);
        else takeoffSyncDirtyIds.delete(activeId);
        conflictedEstimateIds.delete(activeId);
        markEstimateDirty();
        ui.saveRequested = true;
        clearTimeout(ui.saveTimer);
        ui.loadState = 'pending';
        ui.message = 'Unsaved changes';
        ui.saveTimer = setTimeout(saveServer, 500);
    }

    async function request(action, options = {}) {
        const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}&project_id=${projectId}`, options);
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
            const error = new Error(result?.error?.message || result?.message || `HTTP ${response.status}`);
            error.code = result?.error?.code || result?.code || (response.status === 409 ? 'revision_conflict' : 'request_failed');
            error.status = response.status;
            error.payload = result;
            throw error;
        }
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
        const sentIds = [...dirtyEstimateIds].filter(id => !conflictedEstimateIds.has(id)
            && state.estimates.some(estimate => String(estimate.id) === id));
        if (!sentIds.length) {
            if (conflictedEstimateIds.size) {
                ui.saveRequested = false;
                ui.loadState = 'error';
                ui.message = 'This estimate has concurrent manual changes. Your local draft is preserved; review the latest version before saving.';
                renderStatus();
                return;
            }
            ui.saveRequested = false;
            ui.loadState = 'saved';
            ui.message = 'Saved';
            renderStatus();
            return;
        }
        ui.saving = true;
        ui.lastErrorCode = null;
        ui.saveRequested = false;
        ui.loadState = 'saving';
        ui.message = 'Saving…';
        renderStatus();
        const sentGenerations = new Map(sentIds.map(id => [id, dirtyGenerations.get(id) || 0]));
        const sent = {
            schemaVersion: state.schemaVersion,
            projectId: state.projectId,
            activeEstimateId: state.activeEstimateId,
            clientUiUpdatedAt: state.clientUiUpdatedAt,
            estimates: Workspace.clone(state.estimates.filter(estimate => sentIds.includes(String(estimate.id))))
        };
        try {
            const savePayload = estimates => ({ action: 'save', mode: 'patch', project_id: projectId,
                updates: estimates, state: { ...sent, estimates }, summary: summary() });
            let result;
            try {
                result = await request('save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(savePayload(sent.estimates)) });
            } catch (error) {
                if (error.status !== 404 || !['estimate_not_found', 'stale_estimate_id'].includes(error.code)) throw error;
                // Reconcile against the database before retrying. A 404 can mean
                // either a stale numeric hint or a browser-only draft. Blindly
                // retrying the same local identity caused repeated 404 requests.
                const remote = await request('list');
                const remoteRows = remote.state?.estimates || remote.estimates || [];
                const remoteByClientId = new Map(remoteRows.map(estimate => [String(estimate.id), estimate]));
                const recoverable = sent.estimates.map(estimate => {
                    const canonical = remoteByClientId.get(String(estimate.id));
                    return canonical
                        ? { ...estimate, dbEstimateId: canonical.dbEstimateId, revision: canonical.revision }
                        : { ...estimate, dbEstimateId: null };
                });
                const hasNewDraft = recoverable.some(estimate => !remoteByClientId.has(String(estimate.id)));
                result = await request(hasNewDraft ? 'create' : 'save', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(savePayload(recoverable))
                });
            }
            const acknowledgedRows = result.updates || result.state?.estimates || result.estimates || [];
            const acknowledgements = new Map(acknowledgedRows.map(estimate => [String(estimate.id), estimate]));
            sentIds.forEach(id => {
                const currentIndex = state.estimates.findIndex(estimate => String(estimate.id) === id);
                const ack = acknowledgements.get(id);
                if (currentIndex < 0 || !ack) return;
                if ((dirtyGenerations.get(id) || 0) === sentGenerations.get(id)) {
                    state.estimates[currentIndex] = Workspace.estimate(ack, projectId, currentIndex);
                    dirtyEstimateIds.delete(id);
                    dirtyGenerations.delete(id);
                    takeoffSyncDirtyIds.delete(id);
                    conflictedEstimateIds.delete(id);
                    conflictRemoteEstimates.delete(id);
                    [...automaticRebaseKeys].filter(key => key.startsWith(`${id}:`)).forEach(key => automaticRebaseKeys.delete(key));
                } else {
                    state.estimates[currentIndex].dbEstimateId = ack.dbEstimateId;
                    state.estimates[currentIndex].revision = ack.revision;
                    ui.saveRequested = true;
                }
            });
            Workspace.selectEstimate(state, state.activeEstimateId);
            ui.loadState = dirtyEstimateIds.size ? 'pending' : 'saved';
            ui.message = dirtyEstimateIds.size ? 'Unsaved changes' : 'Saved';
            saveLocal();
        } catch (error) {
            ui.lastErrorCode = error.code || 'request_failed';
            ui.loadState = 'error';
            ui.message = error.code === 'revision_conflict'
                ? 'This estimate changed elsewhere. Your draft is saved locally; reload or retry after reviewing the latest version.'
                : `Save failed: ${error.message}`;
            if (error.code === 'revision_conflict') {
                const conflicts = error.payload?.error?.conflicts || [];
                let rebasedTakeoff = false;
                conflicts.forEach(conflict => {
                    const id = String(conflict.id || '');
                    const localIndex = state.estimates.findIndex(estimate => String(estimate.id) === id);
                    if (localIndex < 0 || !conflict.current) return;
                    const currentRevision = Number(conflict.currentRevision ?? conflict.current?.revision ?? 0);
                    const rebaseKey = `${id}:${currentRevision}`;
                    if (takeoffSyncDirtyIds.has(id) && !automaticRebaseKeys.has(rebaseKey)) {
                        automaticRebaseKeys.add(rebaseKey);
                        state.estimates[localIndex] = rebaseTakeoffChanges(state.estimates[localIndex], conflict.current, localIndex);
                        markEstimateDirty(id);
                        rebasedTakeoff = true;
                    } else {
                        if (conflict.current) {
                            state.estimates[localIndex].dbEstimateId = conflict.current.dbEstimateId ?? conflict.dbEstimateId ?? state.estimates[localIndex].dbEstimateId;
                            state.estimates[localIndex].revision = currentRevision;
                        }
                        conflictedEstimateIds.add(id);
                        conflictRemoteEstimates.set(id, Workspace.clone(conflict.current));
                    }
                });
                ui.saveRequested = rebasedTakeoff;
                if (rebasedTakeoff) {
                    ui.loadState = 'pending';
                    ui.message = 'Merged with the latest server revision; saving again…';
                }
            }
            if (error.code !== 'revision_conflict') ui.saveRequested = false;
            saveLocal();
        } finally {
            ui.saving = false;
            render();
            if (ui.pendingDeleteId && ui.loadState !== 'error') {
                const pendingDeleteId = ui.pendingDeleteId;
                ui.pendingDeleteId = null;
                clearTimeout(ui.saveTimer);
                ui.saveTimer = setTimeout(() => deleteEstimateAuthoritative(pendingDeleteId, true), 0);
            } else if (ui.pendingDeleteId) {
                ui.message = 'Delete paused because pending estimates could not be saved. Retry after resolving the save error.';
                renderStatus();
            } else if (ui.saveRequested) {
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
            const remote = applyDeletedEstimateTombstones(Workspace.workspace(remoteSource, projectId));
            const local = state;
            const changedDuringLoad = local.clientUiUpdatedAt !== requestLocalTimestamp;
            // A newer local timestamp alone does not prove there are unsaved edits:
            // localStorage can retain a successfully saved snapshot from an older
            // browser session while another client has advanced the DB revision.
            // Only explicit dirty tracking (or an edit made during this request)
            // is allowed to push local data back to the server on startup.
            const hasExplicitLocalChanges = dirtyEstimateIds.size > 0;
            if (forceMigratedLocal || hasExplicitLocalChanges) {
                delete state.pendingProjectCreationSync;
                if (forceMigratedLocal) {
                    state.estimates.forEach(estimate => markEstimateDirty(estimate.id));
                }
                const remoteById = new Map(remote.estimates.map(estimate => [String(estimate.id), estimate]));
                state.estimates = state.estimates.map((localEstimate, index) => {
                    const id = String(localEstimate.id);
                    const remoteEstimate = remoteById.get(id);
                    if (!dirtyEstimateIds.has(id) || !remoteEstimate) return localEstimate;
                    if (Number(localEstimate.revision) === Number(remoteEstimate.revision)) return localEstimate;
                    if (takeoffSyncDirtyIds.has(id)) return rebaseTakeoffChanges(localEstimate, remoteEstimate, index);
                    conflictedEstimateIds.add(id);
                    conflictRemoteEstimates.set(id, Workspace.clone(remoteEstimate));
                    return localEstimate;
                });
                saveLocal();
                await saveServer();
                render();
                drainPendingTakeoff();
                return;
            }
            if (changedDuringLoad) {
                // A real edit/new estimate completed while GET was in flight.
                // Its save lifecycle owns the newer local state; never replace it
                // with the now-stale GET snapshot.
                ui.loadState = 'saved';
                ui.message = 'Loaded; local changes preserved';
                saveLocal();
            } else if (Array.isArray(remoteSource.estimates) && remoteSource.estimates.length) {
                state = remote;
                restoreDirtyTracking();
            }
            ui.loadState = 'saved';
            ui.message = 'Loaded from server';
            saveLocal();
        } catch (error) {
            ui.loadState = 'error';
            ui.message = `Offline: ${error.message}`;
        }
        render();
        drainPendingTakeoff();
    }

    function groupsContentSignature(groups) {
        return JSON.stringify(groups, (key, value) => key === 'updatedAt' ? undefined : value);
    }

    function rebaseTakeoffChanges(localEstimate, remoteEstimate, index = 0) {
        const remote = Workspace.estimate(remoteEstimate, projectId, index);
        const takeoffGroups = (localEstimate.groups || []).map((group, groupIndex) => ({
            id: group.takeoffGroupId || group.id || `takeoff_group_${groupIndex}`,
            name: group.name || 'Default Group',
            expanded: group.expanded !== false,
            layers: (group.items || []).filter(item => item.takeoffLayerId).map(item => ({
                ...Workspace.clone(item), id: item.takeoffLayerId
            }))
        })).filter(group => group.layers.length || String(group.id).startsWith('takeoff_'));
        if (window.TakeoffEstimatingSyncService?.reconcile) {
            remote.groups = window.TakeoffEstimatingSyncService.reconcile(remote.groups, takeoffGroups).map(Workspace.group);
        }
        remote.updatedAt = Workspace.now();
        remote.auditLog.push({ id: Workspace.uid('audit'), at: remote.updatedAt,
            action: 'Merged Takeoff changes with concurrent server changes' });
        remote.auditLog = remote.auditLog.slice(-100);
        return remote;
    }

    function reconcileExistingTakeoffBindings(existingGroups, incomingGroups) {
        const incomingByLayer = new Map();
        (incomingGroups || []).forEach(group => (group.items || group.layers || []).forEach(item => {
            const layerId = String(item.takeoffLayerId ?? item.id ?? '');
            if (layerId) incomingByLayer.set(layerId, { item, group });
        }));
        return (existingGroups || []).map((group, groupIndex) => Workspace.group({
            ...Workspace.clone(group),
            items: (group.items || []).flatMap(existing => {
                if (!existing.takeoffLayerId) return [existing];
                const incoming = incomingByLayer.get(String(existing.takeoffLayerId));
                if (!incoming) return [];
                if (window.TakeoffEstimatingSyncService?.takeoffItem) {
                    return [window.TakeoffEstimatingSyncService.takeoffItem({
                        ...incoming.item, id: existing.takeoffLayerId
                    }, incoming.group, existing)];
                }
                return [{ ...existing, quantity: incoming.item.quantity,
                    originalQuantity: incoming.item.quantity,
                    lastSyncedTakeoffQuantity: incoming.item.quantity }];
            })
        }, groupIndex));
    }

    function drainPendingTakeoff() {
        const queued = [...pendingTakeoffByEstimate.entries()];
        pendingTakeoffByEstimate.clear();
        queued.forEach(([estimateId, groups]) => reconcileGroups(estimateId, groups));
    }

    function reconcileGroups(estimateId, groups) {
        if (!Array.isArray(groups)) return;
        // The iframe commonly publishes its initial snapshot while the current
        // estimate revision is still loading. Apply that snapshot only after the
        // server state is authoritative, otherwise it dirties a stale revision.
        if (ui.loadState === 'loading') {
            pendingTakeoffByEstimate.set(String(estimateId || ''), Workspace.clone(groups));
            return;
        }
        const activeId = String(estimateId || '');
        const estimateIndex = state.estimates.findIndex(row => String(row.id) === activeId);
        if (estimateIndex < 0) return;
        if (conflictedEstimateIds.has(activeId) && conflictRemoteEstimates.has(activeId)) {
            const index = state.estimates.findIndex(estimate => String(estimate.id) === activeId);
            state.estimates[index] = rebaseTakeoffChanges(state.estimates[index], conflictRemoteEstimates.get(activeId), index);
            conflictedEstimateIds.delete(activeId);
            conflictRemoteEstimates.delete(activeId);
            takeoffSyncDirtyIds.add(activeId);
        }
        const currentEstimate = state.estimates[estimateIndex];
        let reconciled;
        if (currentEstimate.takeoffSyncMode === 'linked-only') {
            reconciled = reconcileExistingTakeoffBindings(currentEstimate.groups, groups);
        } else if (groups.some(group => Array.isArray(group.items))) {
            reconciled = groups.map(Workspace.group);
        } else if (window.TakeoffEstimatingSyncService?.reconcile) {
            reconciled = window.TakeoffEstimatingSyncService.reconcile(currentEstimate.groups,
                groups).map(Workspace.group);
        } else {
            reconciled = groups.map(Workspace.group);
        }
        if (groupsContentSignature(currentEstimate.groups) === groupsContentSignature(reconciled)) return;
        currentEstimate.groups = reconciled;
        currentEstimate.updatedAt = Workspace.now();
        currentEstimate.auditLog.push({ id: Workspace.uid('audit'), at: currentEstimate.updatedAt,
            action: 'Synchronized items from Takeoff' });
        currentEstimate.auditLog = currentEstimate.auditLog.slice(-100);
        takeoffSyncDirtyIds.add(activeId);
        markEstimateDirty(activeId);
        saveLocal();
        scheduleSave('takeoff');
        render();
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
                selectAttribute: 'data-version', actionAttribute: 'data-estimating-action',
                menuAttribute: 'data-estimate-menu', itemActionAttribute: 'data-estimate-action' });
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
        if (ui.modal === 'new') portal.innerHTML = `<div class="est-dialog est-copy-modal" role="dialog" aria-modal="true" aria-labelledby="copyEstimateTitle"><header><div><h2 id="copyEstimateTitle">New Estimate</h2><span>Create an independent estimate for this project</span></div><button type="button" aria-label="Close" data-close-modal>&times;</button></header><div class="est-copy-body"><label class="est-copy-name"><span>Name</span><input id="copyEstimateName" type="text" value="${esc(current().name)} Copy" autocomplete="off"></label><fieldset><legend>Starting point</legend><label class="est-copy-option"><input type="radio" name="copyEstimateMode" value="all" checked><span><strong>Copy everything</strong><small>Start with an independent copy of groups, items, quantities, notes and markups.</small></span></label><label class="est-copy-option"><input type="radio" name="copyEstimateMode" value="structure"><span><strong>Groups only</strong><small>Keep only the group structure; Takeoff items are not imported automatically.</small></span></label><label class="est-copy-option"><input type="radio" name="copyEstimateMode" value="blank"><span><strong>Blank</strong><small>Start completely empty; Takeoff items are added only when explicitly linked.</small></span></label></fieldset></div><footer><button type="button" data-close-modal>Cancel</button><button type="button" class="est-btn-primary" data-create-estimate data-est-action="create-estimate-copy">Create estimate</button></footer></div>`;
        if (ui.modal === 'compare') portal.innerHTML = `<div class="est-dialog est-compare" role="dialog" aria-modal="true"><header><h2>Compare Estimates</h2><button type="button" data-close-modal data-modal-close="compareOpen">&times;</button></header><div class="est-compare-grid">${state.estimates.map(row => { const total = Calc.calculateSummary(row.groups, row.settings); return `<article><h3>${esc(row.name)}</h3><p>${row.groups.reduce((sum, group) => sum + group.items.length, 0)} items</p><strong>${money(total.estimateTotal)}</strong><span>${money(total.profit)} profit</span></article>`; }).join('')}</div></div>`;
        if (ui.modal === 'export') portal.innerHTML = `<div class="est-dialog est-copy-modal" role="dialog" aria-modal="true" aria-labelledby="exportEstimateTitle"><header><div><h2 id="exportEstimateTitle">Export Estimate</h2><span>Download a supplier-ready bill of quantities (CSV)</span></div><button type="button" aria-label="Close" data-close-modal>&times;</button></header><div class="est-copy-body"><fieldset><legend>Export format</legend><label class="est-copy-option"><input type="radio" name="estimateExportMode" value="normal" checked><span><strong>BOQ normal</strong><small>Export the estimate as organized, keeping assemblies as assembly rows.</small></span></label><label class="est-copy-option"><input type="radio" name="estimateExportMode" value="flat"><span><strong>BOQ Flat</strong><small>Break assemblies into parts and consolidate the total quantity of each catalog item.</small></span></label></fieldset></div><footer><button type="button" data-close-modal>Cancel</button><button type="button" class="est-btn-primary" data-download-estimate>Export CSV</button></footer></div>`;
        if (ui.modal === 'catalog') portal.innerHTML = `<div class="est-dialog est-copy-modal" role="dialog" aria-modal="true" aria-labelledby="estimateCatalogTitle"><header><div><h2 id="estimateCatalogTitle">Add Cost Catalog Item</h2><span>Select an existing catalog item for this estimate group</span></div><button type="button" aria-label="Close" data-close-modal>&times;</button></header><div class="est-copy-body"><input type="search" data-est-catalog-search placeholder="Search Cost Catalog" autocomplete="off"><div data-est-catalog-results>${ui.catalogLoading ? '<div class="est-empty">Loading Cost Catalog…</div>' : (ui.catalogError ? `<div class="est-empty">${esc(ui.catalogError)}</div>` : renderCatalogChoices(''))}</div></div><footer><button type="button" data-close-modal>Cancel</button></footer></div>`;
        document.body.appendChild(portal);
        portal.querySelector('input, button')?.focus();
    }

    function createGroup() {
        const group = Workspace.group({ name: `Group ${current().groups.length + 1}`, items: [] }, current().groups.length);
        current().groups.push(group);
        changed(`Created group “${group.name}”`);
    }

    function renderCatalogChoices(query = '') {
        const rows = ui.catalogData?.items || [];
        const normalized = String(query).trim().toLowerCase();
        const visible = rows.filter(item => !normalized || [item.name, item.description, item.supplier.catalogNumber,
            item.classification.costCode, item.catalog.name, item.category.name].join(' ').toLowerCase().includes(normalized));
        return visible.map(item => `<button type="button" class="est-copy-option" data-est-catalog-item="${esc(item.id)}"><span><strong>${esc(item.name)}</strong><small>${esc(item.catalog.name || '')} · ${esc(item.category.name || '')} · ${esc(item.uom || 'ea')} · ${money(item.pricing.materialUnitCost || item.pricing.equipmentUnitCost || item.pricing.legacyUnitCost || 0)}</small></span></button>`).join('')
            || '<div class="est-empty">No catalog items found.</div>';
    }

    async function addItem(groupId) {
        if (!current().groups.some(row => row.id === groupId)) return;
        ui.catalogTargetGroupId = groupId;
        ui.catalogLoading = true; ui.catalogError = ''; ui.modal = 'catalog'; renderModal();
        try {
            ui.catalogData = await window.CatalogService.getSnapshot({ enabledForProjectsOnly: true });
        } catch (error) { ui.catalogError = error.message; }
        ui.catalogLoading = false; renderModal();
    }

    function catalogEstimateItem(catalog) {
        const itemsById = new Map((ui.catalogData?.items || []).map(item => [String(item.id), item]));
        return window.EstimatingCatalogAdapter.catalogItemDtoToEstimatingItem(catalog, {
            itemsById,
            globalLaborRate: current().settings.globalLaborCost,
            workspaceItem: Workspace.item
        });
    }

    async function exportEstimate(mode = 'normal') {
        if (!Exporter) return;
        let estimate = Workspace.clone(current());
        if (mode === 'flat' && Exporter.needsCatalog(estimate)) {
            try {
                const catalogSnapshot = await window.CatalogService.getSnapshot({ enabledForProjectsOnly: true });
                estimate = window.BoqCatalogAdapter.hydrateEstimate(estimate, catalogSnapshot);
            } catch (error) {
                alert(`BOQ Flat could not load the Cost Catalog: ${error.message}`);
                return;
            }
        }
        const unresolved = mode === 'flat' ? Exporter.unresolvedAssemblies(estimate) : [];
        if (unresolved.length) {
            alert(`BOQ Flat cannot expand these assemblies because they have no Cost Catalog components: ${unresolved.map(item => item.name).join(', ')}`);
            return;
        }
        const rows = mode === 'flat' ? Exporter.flatRows(estimate) : Exporter.normalRows(estimate);
        const blob = new Blob([Exporter.csv(rows)], { type: 'text/csv;charset=utf-8' });
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = `${current().name.replace(/[^a-z0-9_-]+/gi, '_')}_${mode === 'flat' ? 'BOQ_Flat' : 'BOQ'}.csv`;
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
            const catalogFields = {
                unitMaterialCost: 'materialUnitCost',
                unitEquipmentCost: 'equipmentUnitCost',
                unitSubcontractorCost: 'subcontractorUnitCost',
                unitLabor: 'laborHoursPerUnit',
                laborRate: 'laborRate'
            };
            if (found.item.catalogSnapshot && catalogFields[itemField]
                && window.EstimatingCatalogSnapshotService) {
                window.EstimatingCatalogSnapshotService.setCatalogOverride(found.item,
                    catalogFields[itemField], Workspace.numeric(event.target.value));
            } else {
                found.item[itemField] = Workspace.numeric(event.target.value);
            }
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
            const catalogFields = {
                unitMaterialCost: 'materialUnitCost', unitEquipmentCost: 'equipmentUnitCost',
                unitSubcontractorCost: 'subcontractorUnitCost', unitLabor: 'laborHoursPerUnit', laborRate: 'laborRate'
            };
            if (event.target.type === 'number' && found.item.catalogSnapshot && catalogFields[field]
                && window.EstimatingCatalogSnapshotService) {
                window.EstimatingCatalogSnapshotService.setCatalogOverride(found.item,
                    catalogFields[field], Number(event.target.value));
            } else {
                found.item[field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
            }
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

    function confirmEstimateDeletion(message) {
        return new Promise(resolve => {
            document.querySelector('[data-estimate-delete-confirm]')?.remove();
            const portal = document.createElement('div');
            portal.className = 'est-modal-backdrop';
            portal.dataset.estimateDeleteConfirm = 'true';
            portal.innerHTML = `<div class="est-dialog est-copy-modal" role="dialog" aria-modal="true" aria-labelledby="deleteEstimateTitle"><header><div><h2 id="deleteEstimateTitle">Delete estimate</h2><span>This action cannot be undone</span></div></header><div class="est-copy-body"><p>${esc(message)}</p></div><footer><button type="button" data-delete-cancel>Cancel</button><button type="button" class="est-btn-primary" data-delete-confirm>Delete</button></footer></div>`;
            const finish = value => { portal.remove(); resolve(value); };
            portal.addEventListener('click', event => {
                if (event.target === portal || event.target.closest('[data-delete-cancel]')) finish(false);
                if (event.target.closest('[data-delete-confirm]')) finish(true);
            });
            document.body.appendChild(portal);
            portal.querySelector('[data-delete-confirm]')?.focus();
        });
    }


    async function deleteEstimateAuthoritative(estimateId = state.activeEstimateId, confirmed = false) {
        const requestedId = String(estimateId || '');
        if (!requestedId || deletingEstimateIds.has(requestedId)) return;

        let estimate = state.estimates.find(row => String(row.id) === requestedId);
        if (!estimate && projectId) {
            try {
                const latest = await request('list');
                state = applyDeletedEstimateTombstones(Workspace.workspace(latest.state || {}, projectId));
                restoreDirtyTracking();
                saveLocal();
                render();
                estimate = state.estimates.find(row => String(row.id) === requestedId);
            } catch (error) {
                ui.loadState = 'error';
                ui.message = `Could not refresh estimates: ${error.message}`;
                renderStatus();
                return;
            }
            if (!estimate) {
                ui.loadState = 'saved';
                ui.message = 'That estimate was already removed.';
                renderStatus();
                return;
            }
        }
        if (!estimate) return;
        if (state.estimates.length <= 1) {
            alert('At least one estimate must remain in the project.');
            return;
        }

        const original = String(state.estimates[0]?.id || '') === requestedId
            || String(estimate.creationMode || '') === 'primary';
        const message = original
            ? `WARNING: "${estimate.name}" is the original estimate. Its Takeoff data will also be permanently removed. Delete it?`
            : `Delete "${estimate.name}"? This will also delete its Takeoff items and cannot be undone.`;
        if (!confirmed && !(await confirmEstimateDeletion(message))) return;

        deletingEstimateIds.add(requestedId);
        const backup = Workspace.clone(state);
        const requestedDbId = Number(estimate.dbEstimateId || 0);

        // Optimistic catalog removal is intentional: all three footers consume
        // this one published state and the stale card becomes non-actionable
        // immediately. A failed server transaction restores the exact backup.
        state.deletedEstimateIds = [...new Set([...(state.deletedEstimateIds || []), requestedId])].sort();
        state.estimates = state.estimates.filter(row => String(row.id) !== requestedId);
        if (!state.estimates.some(row => String(row.id) === String(state.activeEstimateId))) {
            state.activeEstimateId = state.estimates[0]?.id || null;
        }
        if (state.estimates.length) Workspace.selectEstimate(state, state.activeEstimateId);
        dirtyEstimateIds.delete(requestedId);
        dirtyGenerations.delete(requestedId);
        takeoffSyncDirtyIds.delete(requestedId);
        conflictedEstimateIds.delete(requestedId);
        conflictRemoteEstimates.delete(requestedId);
        clearTimeout(ui.saveTimer);
        ui.saveRequested = false;
        ui.loadState = 'saving';
        ui.message = 'Deleting estimate...';
        saveLocal();
        render();

        try {
            // A request already in flight may contain the target. Wait for that
            // one request only; never start a save/delete recursion.
            const waitStarted = Date.now();
            while (ui.saving && Date.now() - waitStarted < 15000) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (ui.saving) throw new Error('The current save did not finish in time.');

            let ack = { success: true, state };
            if (projectId) {
                ack = await request('delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete', project_id: projectId,
                        estimate_id: requestedDbId, client_estimate_id: requestedId,
                        delete_original: original }) });
            }
            const acknowledgedId = String(ack?.deleted?.clientEstimateId || ack?.clientEstimateId || requestedId);
            const localDrafts = state.estimates.filter(row => !Number(row.dbEstimateId || 0)
                && String(row.id) !== requestedId && String(row.id) !== acknowledgedId);
            const authoritative = Workspace.workspace(ack?.state || state, projectId);
            const serverIds = new Set(authoritative.estimates.map(row => String(row.id)));
            localDrafts.forEach(row => { if (!serverIds.has(String(row.id))) authoritative.estimates.push(row); });
            state = applyDeletedEstimateTombstones(authoritative, [requestedId, acknowledgedId]);
            restoreDirtyTracking();
            saveLocal();
            render();
            ui.loadState = projectId ? 'saved' : 'local';
            ui.message = 'Estimate deleted';
            renderStatus();
        } catch (error) {
            if (!requestedDbId && ['estimate_not_found', 'last_estimate'].includes(error.code)) {
                saveLocal();
                render();
                ui.loadState = projectId ? 'saved' : 'local';
                ui.message = 'Estimate deleted';
                renderStatus();
            } else {
                state = Workspace.workspace(backup, projectId);
                restoreDirtyTracking();
                saveLocal();
                render();
                ui.loadState = 'error';
                ui.message = `Delete failed: ${error.message}`;
                renderStatus();
            }
        } finally {
            deletingEstimateIds.delete(requestedId);
        }
    }

    function handleEstimateCardAction(actionName, estimateId) {
        if (actionName === 'rename') {
            const estimate = state.estimates.find(row => String(row.id) === String(estimateId));
            const name = estimate && prompt('Estimate name', estimate.name);
            if (estimate && name?.trim()) {
                estimate.name = name.trim(); estimate.updatedAt = Workspace.now();
                estimate.auditLog.push({ id: Workspace.uid('audit'), at: estimate.updatedAt, action: 'Renamed estimate' });
                markEstimateDirty(estimate.id); saveLocal(); ui.saveRequested = true;
                clearTimeout(ui.saveTimer); ui.saveTimer = setTimeout(saveServer, 0); render();
            }
        }
        if (actionName === 'copy') { selectEstimate(estimateId); ui.modal = 'new'; renderModal(); }
        if (actionName === 'delete') deleteEstimateAuthoritative(estimateId);
    }

    root.addEventListener('click', event => {
        const target = event.target;
        const estimateMenu = target.closest('[data-estimate-menu]');
        if (estimateMenu) {
            const id = estimateMenu.dataset.estimateMenu;
            const menu = root.querySelector(`[data-estimate-actions-menu="${selectorValue(id)}"]`);
            const opening = Boolean(menu?.hidden);
            root.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
            root.querySelectorAll('[data-estimate-menu]').forEach(row => row.setAttribute('aria-expanded', 'false'));
            if (menu && opening) {
                const rect = estimateMenu.getBoundingClientRect();
                menu.hidden = false;
                menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 178, rect.right - 170))}px`;
                menu.style.top = `${Math.max(8, rect.top - menu.offsetHeight - 6)}px`;
                estimateMenu.setAttribute('aria-expanded', 'true');
            }
            return;
        }
        const estimateAction = target.closest('[data-estimate-action]');
        if (estimateAction) {
            const estimateId = estimateAction.dataset.estimateId;
            const actionName = estimateAction.dataset.estimateAction;
            root.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
            handleEstimateCardAction(actionName, estimateId);
            return;
        }
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
        if (option === 'export') { ui.modal = 'export'; renderModal(); }
        if (option === 'delete-estimate') deleteEstimateAuthoritative();
        if (target.closest('[data-download-estimate]')) {
            const mode = document.querySelector('[name="estimateExportMode"]:checked')?.value || 'normal';
            exportEstimate(mode); ui.modal = null; renderModal();
        }
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

    document.addEventListener('click', async event => {
        const portal = event.target.closest('[data-estimating-modal-portal]');
        if (!portal) return;
        if (event.target.closest('[data-close-modal]') || event.target === portal) { ui.modal = null; renderModal(); return; }
        if (event.target.closest('[data-create-estimate]')) {
            const createButton = event.target.closest('[data-create-estimate]');
            const name = portal.querySelector('#copyEstimateName')?.value;
            const mode = portal.querySelector('input[name="copyEstimateMode"]:checked')?.value || 'blank';
            Workspace.createEstimate(state, name, mode); ui.modal = null; saveLocal();
            markEstimateDirty();
            saveLocal();
            render();
            if (projectId) {
                createButton.disabled = true;
                ui.loadState = 'saving';
                ui.message = 'Creating estimate in database…';
                renderStatus();
                try {
                    await window.projectEstimatingSave();
                    ui.message = 'Estimate created';
                    renderStatus();
                } catch (error) {
                    ui.loadState = 'error';
                    ui.message = `Estimate was not confirmed by the database: ${error.message}`;
                    renderStatus();
                }
            }
        }
        const catalogId = event.target.closest('[data-est-catalog-item]')?.dataset.estCatalogItem;
        if (catalogId) {
            const group = current().groups.find(row => String(row.id) === String(ui.catalogTargetGroupId));
            const catalog = (ui.catalogData?.items || []).find(row => String(row.id) === String(catalogId));
            if (!group || !catalog) return;
            const item = catalogEstimateItem(catalog);
            group.items.push(item); group.expanded = true; ui.modal = null;
            changed(`Added ${item.name} from Cost Catalog`);
        }
    });

    document.addEventListener('input', event => {
        if (!event.target.matches('[data-est-catalog-search]')) return;
        const results = document.querySelector('[data-est-catalog-results]');
        if (results) results.innerHTML = renderCatalogChoices(event.target.value);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && ui.modal) { ui.modal = null; renderModal(); }
        if (event.key === 'Escape') {
            root.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
            root.querySelectorAll('[data-estimate-menu]').forEach(row => row.setAttribute('aria-expanded', 'false'));
        }
    });

    document.addEventListener('click', event => {
        if (event.target.closest('[data-estimate-menu], [data-estimate-actions-menu]')) return;
        root.querySelectorAll('[data-estimate-actions-menu]').forEach(row => { row.hidden = true; });
        root.querySelectorAll('[data-estimate-menu]').forEach(row => row.setAttribute('aria-expanded', 'false'));
    });

    function refreshEstimateFromStorage(estimateId) {
        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (stored?.estimates?.some(row => String(row.id) === String(estimateId))) {
                state = Workspace.workspace(stored, projectId);
                restoreDirtyTracking();
            }
        } catch (_) {}
    }

    function selectEstimate(estimateId) {
        const selected = Workspace.selectEstimate(state, estimateId);
        if (!selected) return;
        // Selecting a tab is local UI state, not an estimate content edit. It
        // must not increment the estimate revision or conflict with another
        // estimator editing that same estimate.
        ui.selected.clear(); saveLocal(); render();
    }

    window.addEventListener('takeoff:estimating-lines-updated', event => {
        if (event.detail?.projectId && String(event.detail.projectId) !== String(projectId)) return;
        if (event.detail?.activeEstimateId && String(event.detail.activeEstimateId) !== String(state.activeEstimateId)) return;
        if (!(event.detail?.groups || []).length && event.detail?.complete !== true) return;
        reconcileGroups(event.detail?.activeEstimateId || state.activeEstimateId, event.detail?.groups || []);
    });
    window.addEventListener('takeoff:estimating-link-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId)) return;
        const found = allItems().find(row => String(row.item.id) === String(detail.itemId));
        if (!found || !detail.layerId) return;
        if (found.item.takeoffLayerId && String(found.item.takeoffLayerId) === String(detail.layerId)) return;
        found.item.takeoffLayerId = String(detail.layerId);
        found.item.quantitySource = 'takeoff';
        found.item.quantitySyncStatus = 'synced';
        changed(`Linked ${found.item.name} to Takeoff`);
    });
    window.addEventListener('takeoff:estimating-links-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId) || !Array.isArray(detail.links)) return;
        const itemsById = new Map(allItems().map(row => [String(row.item.id), row.item]));
        let linked = 0;
        detail.links.forEach(link => {
            const item = itemsById.get(String(link.itemId || ''));
            if (!item || !link.layerId || String(item.takeoffLayerId || '') === String(link.layerId)) return;
            item.takeoffLayerId = String(link.layerId);
            item.quantitySource = 'takeoff';
            item.quantitySyncStatus = 'synced';
            linked += 1;
        });
        if (linked) changed(`Linked ${linked} item(s) to Takeoff`);
    });
    window.addEventListener('takeoff:active-estimate-changed', event => {
        if (event.detail?.projectId && String(event.detail.projectId) !== String(projectId)) return;
        selectEstimate(event.detail?.estimateId);
    });
    window.addEventListener('takeoff:estimating-groups-delete-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId) || !Array.isArray(detail.groupIds)) return;
        const ids = new Set(detail.groupIds.map(String));
        const estimate = current();
        const next = estimate.groups.filter(group => !ids.has(String(group.id)));
        if (next.length === estimate.groups.length) return;
        const removedCount = estimate.groups.length - next.length;
        estimate.groups = next;
        changed(`Deleted ${removedCount} Takeoff group(s)`);
    });
    window.addEventListener('takeoff:estimating-group-create-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId) || !detail.group) return;
        const estimate = current();
        if (estimate.groups.some(group => String(group.id) === String(detail.group.id))) return;
        estimate.groups.push(Workspace.group(detail.group));
        changed(`Created Takeoff group ${detail.group.name || ''}`.trim());
    });
    window.addEventListener('takeoff:estimating-groups-reorder-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        if (String(detail.estimateId || '') !== String(state.activeEstimateId) || !Array.isArray(detail.groupIds)) return;
        const order = new Map(detail.groupIds.map((id, index) => [String(id), index]));
        const estimate = current();
        const before = estimate.groups.map(group => String(group.id)).join('|');
        estimate.groups.sort((a, b) => (order.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));
        estimate.groups.forEach((group, index) => { group.sortOrder = index; });
        if (before === estimate.groups.map(group => String(group.id)).join('|')) return;
        changed('Reordered Takeoff groups');
    });
    window.addEventListener('takeoff:estimating-action-requested', event => {
        if (event.detail?.action === 'new-estimate') ui.modal = 'new';
        if (event.detail?.action === 'compare-estimates') ui.modal = 'compare';
        renderModal();
    });
    window.addEventListener('takeoff:estimating-estimate-action-requested', event => {
        const detail = event.detail || {};
        if (detail.projectId && String(detail.projectId) !== String(projectId)) return;
        handleEstimateCardAction(detail.action, detail.estimateId);
    });
    window.addEventListener('storage', event => {
        if (event.key !== storageKey || !event.newValue) return;
        const incoming = Workspace.workspace(JSON.parse(event.newValue), projectId);
        state = applyDeletedEstimateTombstones(incoming);
        restoreDirtyTracking();
        // Storage events are notifications only. Never write the same workspace
        // key from inside its handler: two tabs can otherwise bounce normalized
        // snapshots forever and monopolize the browser main thread.
        state.groups = current().groups;
        state.dirtyEstimateIds = [...dirtyEstimateIds];
        state.takeoffSyncDirtyIds = [...takeoffSyncDirtyIds];
        render();
        publish();
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
            if (ui.loadState === 'error') {
                const error = new Error(ui.message);
                error.code = ui.lastErrorCode || 'save_failed';
                throw error;
            }
        }
        return true;
    };

    function catalogDomainOptions(options = {}) {
        const result = { ...options };
        delete result.estimateId;
        return result;
    }

    window.projectEstimatingPrepareCatalogUpdate = async function (options = {}) {
        const Application = window.CatalogUpdateApplicationService;
        const Catalog = window.CatalogService;
        if (!Application || !Catalog) throw new Error('Catalog update services are unavailable.');
        await window.projectEstimatingSave();
        const estimateId = String(options.estimateId || state.activeEstimateId || '');
        const estimate = state.estimates.find(row => String(row.id) === estimateId);
        if (!estimate) throw new Application.CatalogUpdateApplicationError(
            'ESTIMATE_NOT_FOUND', 'The Estimate selected for refresh no longer exists.');
        const catalog = await Catalog.getSnapshot();
        const domainOptions = catalogDomainOptions(options);
        const prepared = Application.prepareCatalogUpdate(Workspace.clone(estimate), catalog, domainOptions);
        const strategy = Application.resolveCatalogUpdateStrategy(estimate);
        return {
            ...prepared,
            strategy,
            currentEstimateRevision: Number(estimate.estimateRevision || 1),
            projectedEstimateRevision: Number(estimate.estimateRevision || 1)
                + (strategy.strategy === Application.STRATEGY.CREATE_REVISION ? 1 : 0)
        };
    };

    window.projectEstimatingApplyCatalogUpdate = async function (prepared, options = {}) {
        const Application = window.CatalogUpdateApplicationService;
        const Catalog = window.CatalogService;
        if (!Application || !Catalog) throw new Error('Catalog update services are unavailable.');
        if (!prepared?.guard) throw new Application.CatalogUpdateApplicationError(
            'PREVIEW_GUARD_REQUIRED', 'Generate a Cost Catalog preview before applying it.');
        const sourceId = String(prepared.guard.estimateId || '');
        const sourceIndex = state.estimates.findIndex(row => String(row.id) === sourceId);
        if (sourceIndex < 0) throw new Application.CatalogUpdateApplicationError(
            'ESTIMATE_CHANGED_SINCE_PREVIEW', 'The Estimate no longer exists.');
        const catalog = await Catalog.getSnapshot();
        const result = Application.applyCatalogUpdate(Workspace.clone(state.estimates[sourceIndex]), catalog, {
            ...catalogDomainOptions(prepared.options || {}),
            ...catalogDomainOptions(options),
            previewGuard: prepared.guard
        });
        const normalized = Workspace.estimate(result.appliedEstimate, projectId,
            result.strategy === Application.STRATEGY.CREATE_REVISION ? state.estimates.length : sourceIndex);
        if (result.strategy === Application.STRATEGY.CREATE_REVISION) {
            state.estimates.forEach(row => { row.isActive = false; });
            state.estimates.push(normalized);
            state.activeEstimateId = normalized.id;
        } else {
            state.estimates[sourceIndex] = normalized;
        }
        Workspace.selectEstimate(state, state.activeEstimateId);
        markEstimateDirty(normalized.id);
        saveLocal();
        render();
        try {
            await window.projectEstimatingSave();
        } catch (cause) {
            throw new Application.CatalogUpdateApplicationError(
                cause.code === 'ESTIMATE_CHANGED_SINCE_PREVIEW'
                    ? 'ESTIMATE_CHANGED_SINCE_PREVIEW' : 'CATALOG_UPDATE_PERSISTENCE_FAILED',
                cause.message,
                { cause, estimateId: normalized.id, localDraftPreserved: true }
            );
        }
        const persisted = state.estimates.find(row => String(row.id) === String(normalized.id));
        return {
            ...result,
            estimateId: persisted?.id || result.estimateId,
            dbEstimateId: persisted?.dbEstimateId || null,
            serverRevision: Number(persisted?.revision || 0),
            appliedEstimate: Workspace.clone(persisted || normalized),
            persisted: true
        };
    };

    window.addEventListener('beforeunload', event => {
        if (!ui.saving && !ui.saveRequested && !dirtyEstimateIds.size) return;
        event.preventDefault();
        event.returnValue = '';
    });

    saveLocal();
    render();
    loadServer();
})();
