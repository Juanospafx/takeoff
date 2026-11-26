(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TakeoffViewerController = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    function create(dependencies = {}) {
        const {
            viewerState,
            takeoffState,
            selectionState,
            drawingState
        } = dependencies.state || {};
        const {
            getElement: $,
            document: documentRef = root.document,
            window: windowRef = root
        } = dependencies.dom || {};
        const document = documentRef;
        const window = windowRef;
        const {
            allLayers,
            layerBelongsToEstimate,
            esc,
            renderLayerBadgeHtml,
            quantityLabel,
            toggleLayerVisibility,
            updateSubheadSelectedItem,
            callEditor,
            patchTakeoffSelectionClassesDom,
            renderTakeoffPanel,
            renderInspector,
            findGroupExact,
            findGroup,
            findLayer,
            setActiveTakeoffLayer,
            clearActiveTakeoffLayer,
            requireWrite,
            pushTakeoffHistory,
            saveTakeoffState,
            deleteTakeoffGroups,
            layerCanvasPayload,
            syncTakeoffFromCanvasSnapshot,
            activeDrawingDoc,
            drawingDocs,
            ensurePageCount,
            buildSheets,
            openCreateLayerModal,
            renameGroup,
            duplicateGroup,
            deleteGroup,
            openLayerModal,
            renameLayer,
            duplicateLayer,
            deleteLayer,
            toggleGroupLock,
            changeLayerColor,
            moveLayerToGroup,
            openTakeoffGroupModal,
            collapseAllTakeoffGroups,
            openCatalogModal,
            submitTakeoffGroupModal,
            syncVisibilityToEditorBatch,
            groupForLayer,
            typeToUom,
            makeId,
            undoTakeoff,
            redoTakeoff,
            hasScaleSet,
            openScalePanel,
            setZoom,
            currentZoomPercent,
            updateZoomUi,
            changeActiveSheet,
            syncTakeoffToEstimating
        } = dependencies.actions || {};

    function ensureViewerLayersPopover() {
        if ($('takeoffViewerLayersPopover')) return;
        const popover = document.createElement('div');
        popover.id = 'takeoffViewerLayersPopover';
        popover.className = 'pro-viewer-layers-popover';
        popover.hidden = true;
        document.querySelector('.pro-canvas-shell')?.appendChild(popover);
    }

    function renderViewerLayersPopover() {
        const popover = $('takeoffViewerLayersPopover');
        if (!popover) return;
        const layers = allLayers().filter(layer => layerBelongsToEstimate(layer));
        popover.innerHTML = `<div class="pro-viewer-layers-head">
                <strong>Layers</strong>
                <button class="pro-icon-btn" type="button" data-viewer-layers-close aria-label="Close"><i class="fas fa-times"></i></button>
            </div>
            <div class="pro-viewer-layers-list">
                ${layers.map(layer => `<label class="pro-viewer-layer-row">
                    <input type="checkbox" ${layer.visible === false ? '' : 'checked'} data-viewer-layer-visible="${esc(layer.id)}">
                    ${renderLayerBadgeHtml(layer, 14)}
                    <span>${esc(layer.name)}</span>
                    <small>${esc(quantityLabel(layer))}</small>
                </label>`).join('') || '<div class="pro-drawing-empty">No takeoff layers yet.</div>'}
            </div>`;
        popover.querySelector('[data-viewer-layers-close]')?.addEventListener('click', closeViewerLayersPopover);
        popover.querySelectorAll('[data-viewer-layer-visible]').forEach(box => {
            box.addEventListener('change', () => toggleLayerVisibility(box.dataset.viewerLayerVisible, box.checked));
        });
    }

    function openViewerLayersPopover() {
        ensureViewerLayersPopover();
        viewerState.isLayersPopoverOpen = true;
        renderViewerLayersPopover();
        const popover = $('takeoffViewerLayersPopover');
        if (popover) popover.hidden = false;
        document.querySelector('[data-viewer-command="layers"]')?.classList.add('active');
    }

    function closeViewerLayersPopover() {
        viewerState.isLayersPopoverOpen = false;
        $('takeoffViewerLayersPopover')?.setAttribute('hidden', '');
        document.querySelector('[data-viewer-command="layers"]')?.classList.remove('active');
    }

    function toggleViewerLayersPopover() {
        if (viewerState.isLayersPopoverOpen) closeViewerLayersPopover();
        else openViewerLayersPopover();
    }

    function toggleGrid() {
        viewerState.isGridVisible = !viewerState.isGridVisible;
        document.querySelector('.pro-canvas-shell')?.classList.toggle('grid-visible', viewerState.isGridVisible);
        document.querySelector('[data-viewer-command="grid"]')?.classList.toggle('active', viewerState.isGridVisible);
    }

    function ensureTakeoffOverlays() {
        const viewer = document.querySelector('.pro-takeoff-viewer');
        const shell = document.querySelector('.pro-canvas-shell');
        $('takeoffActiveLayerToolbar')?.remove();
        $('takeoffSelectionBar')?.remove();
        if (shell && !$('takeoffComparePanel')) {
            const panel = document.createElement('div');
            panel.id = 'takeoffComparePanel';
            panel.className = 'pro-compare-panel';
            panel.hidden = true;
            shell.appendChild(panel);
        }
        if (shell && !$('takeoffMoreToolsPanel')) {
            const panel = document.createElement('div');
            panel.id = 'takeoffMoreToolsPanel';
            panel.className = 'pro-more-tools-panel';
            panel.hidden = true;
            shell.appendChild(panel);
        }
    }

    function renderActiveLayerToolbar() {
        $('takeoffActiveLayerToolbar')?.remove();
    }

    function renderSelectionBar() {
        $('takeoffSelectionBar')?.remove();
        updateSubheadSelectedItem();
    }

    function clearAllSelections() {
        takeoffState.activeLayerId = null;
        takeoffState.activeGroupId = null;
        selectionState.activeLayerId = null;
        selectionState.selectedGroupIds = [];
        selectionState.selectedLayerIds = [];
        selectionState.selectedObjectIds = [];
        selectionState.selectedRuler = null;
        selectionState.selectedNote = null;
        selectionState.selectedObjectType = null;
        callEditor('projectTakeoffClearSelection');
        callEditor('projectTakeoffClearActiveLayer');
        if (!patchTakeoffSelectionClassesDom()) renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
    }

    function setSelectedObjects(ids = [], layerId = null) {
        const prevActive = String(selectionState.activeLayerId || takeoffState.activeLayerId || '');
        const prevGroupKey = (selectionState.selectedGroupIds || []).join(',');
        const prevLayerKey = (selectionState.selectedLayerIds || []).join(',');
        const isDrawingToolActive = ['count', 'linear', 'area'].includes(viewerState.activeTool);
        selectionState.selectedObjectIds = Array.from(new Set(ids.map(String).filter(Boolean)));
        if (!ids.length && !layerId) {
            selectionState.activeLayerId = null;
            takeoffState.activeLayerId = null;
            takeoffState.activeGroupId = null;
            selectionState.selectedGroupIds = [];
            selectionState.selectedLayerIds = [];
        } else {
            selectionState.activeLayerId = layerId || selectionState.activeLayerId || takeoffState.activeLayerId;
            if (isDrawingToolActive && selectionState.selectedLayerIds.length > 1
                && (!layerId || selectionState.selectedLayerIds.includes(String(layerId)))) {
                // Keep batch checkbox selection intact while placing shapes
            } else {
                selectionState.selectedGroupIds = [];
                selectionState.selectedLayerIds = layerId ? [String(layerId)] : [];
            }
        }
        const nextActive = String(selectionState.activeLayerId || takeoffState.activeLayerId || '');
        const nextGroupKey = (selectionState.selectedGroupIds || []).join(',');
        const nextLayerKey = (selectionState.selectedLayerIds || []).join(',');
        const treeSelectionChanged = prevActive !== nextActive
            || prevGroupKey !== nextGroupKey
            || (prevLayerKey !== nextLayerKey && !(nextLayerKey === prevActive && prevLayerKey === ''));
        if (treeSelectionChanged && !patchTakeoffSelectionClassesDom()) {
            renderTakeoffPanel();
        }
        renderSelectionBar();
        renderInspector();
    }

    function toggleGroupSelection(groupId) {
        const isSelected = selectionState.selectedGroupIds.includes(String(groupId)) || (takeoffState.activeGroupId === groupId && !takeoffState.activeLayerId && selectionState.selectedGroupIds.length > 0);
        setGroupSelection(groupId, !isSelected);
    }

    function setGroupSelection(groupId, selected) {
        const group = findGroupExact(groupId);
        if (!group) return;
        const groupIds = new Set(selectionState.selectedGroupIds.map(String));
        const layerIds = new Set(selectionState.selectedLayerIds.map(String));
        if (!selected) {
            groupIds.delete(String(group.id));
            (group.layers || []).forEach(layer => layerIds.delete(String(layer.id)));
            if (takeoffState.activeGroupId === group.id) takeoffState.activeGroupId = null;
            if (selectionState.activeLayerId && (group.layers || []).some(l => l.id === selectionState.activeLayerId)) {
                selectionState.activeLayerId = null;
            }
        } else {
            takeoffState.activeGroupId = group.id;
            groupIds.add(String(group.id));
            (group.layers || []).forEach(layer => layerIds.add(String(layer.id)));
            selectionState.activeLayerId = group.layers?.[0]?.id || null;
        }
        selectionState.selectedGroupIds = Array.from(groupIds);
        selectionState.selectedLayerIds = Array.from(layerIds);
        const selectedIds = selectionState.selectedLayerIds.length
            ? callEditor('projectTakeoffSelectGroup', selectionState.selectedLayerIds)
            : (callEditor('projectTakeoffClearSelection'), []);
        selectionState.selectedObjectIds = Array.isArray(selectedIds) ? selectedIds : [];
        if (!patchTakeoffSelectionClassesDom()) renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
    }

    function selectSingleLayer(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        const editorLockState = callEditor('projectTakeoffGetLayerLockState', layer.id) || {};
        if (layer.locked || editorLockState.locked) return;

        // Reset any existing multi-group and multi-layer selection
        selectionState.selectedGroupIds = [];
        selectionState.selectedLayerIds = [String(layer.id)];
        selectionState.activeLayerId = layer.id;

        // Activate this layer in the takeoff editor for drawing (fast path)
        setActiveTakeoffLayer(layer.id, false, { fast: true, skipLayerSync: true });

        // Select objects for this single layer on canvas
        const selectedIds = callEditor('projectTakeoffSelectGroup', [String(layer.id)]);
        selectionState.selectedObjectIds = Array.isArray(selectedIds) ? selectedIds : [];

        if (!patchTakeoffSelectionClassesDom()) renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
    }

    function toggleLayerSelection(layerId, selected) {
        const layer = findLayer(layerId);
        if (!layer) return;
        const ids = new Set(selectionState.selectedLayerIds.map(String));
        if (selected) ids.add(String(layer.id));
        else ids.delete(String(layer.id));
        selectionState.selectedLayerIds = Array.from(ids);
        // Individual item checkboxes accumulate multi-item selection without switching
        // the subhead toolbar into folder/group actions.
        selectionState.selectedGroupIds = [];
        selectionState.activeLayerId = selected ? layer.id : (selectionState.selectedLayerIds[selectionState.selectedLayerIds.length - 1] || null);
        // Checking an item is also the user's placement-layer choice. Keep the
        // multi-layer/object selection below, but activate this specific layer
        // in the editor so the next drawing uses its type and catalog data.
        if (selected) setActiveTakeoffLayer(layer.id, false, { fast: true, skipLayerSync: true });
        else if (String(takeoffState.activeLayerId || '') === String(layer.id)) {
            // Checkbox selection and placement activation are separate state.
            // Clearing the checkbox for the active layer must also terminate
            // the editor's drawing mode; otherwise Count keeps using the last
            // selected layer even though the sidebar presents it as inactive.
            clearActiveTakeoffLayer(false);
            selectionState.activeLayerId = selectionState.selectedLayerIds[0] || null;
            setActiveTool('smart');
        }
        const selectedIds = callEditor('projectTakeoffSelectGroup', selectionState.selectedLayerIds);
        selectionState.selectedObjectIds = Array.isArray(selectedIds) ? selectedIds : [];
        if (!patchTakeoffSelectionClassesDom()) renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
    }

    function toggleLayerLock(layerId) {
        if (!requireWrite()) return false;
        const layer = findLayer(layerId);
        if (!layer) return;
        const editorState = callEditor('projectTakeoffGetLayerLockState', layer.id) || {};
        layer.locked = !Boolean(layer.locked || editorState.locked);
        pushTakeoffHistory(layer.locked ? 'lock-layer' : 'unlock-layer');
        callEditor('projectTakeoffSetLayerLocked', layer.id, layer.locked);
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function runSelectionAction(action) {
        if (action === 'clear') {
            setSelectedObjects([]);
            callEditor('projectTakeoffClearSelection');
            return;
        }
        if (action === 'delete' && selectionState.selectedGroupIds.length) {
            deleteTakeoffGroups(selectionState.selectedGroupIds);
            return;
        }
        if (!selectionState.selectedObjectIds.length) {
            const editorIds = callEditor('projectTakeoffGetSelectionIds');
            if (Array.isArray(editorIds)) selectionState.selectedObjectIds = editorIds;
        }
        if (!selectionState.selectedObjectIds.length && action !== 'delete') return showPrepared('Select one or more takeoff objects first.');
        pushTakeoffHistory(`selection-${action}`);
        if (action === 'copy') {
            const copied = callEditor('projectTakeoffCopySelection', selectionState.selectedObjectIds);
            if (!copied) showPrepared('Copy selection is ready to be connected.');
            else if (Array.isArray(copied)) selectionState.selectedObjectIds = copied;
        }
        if (action === 'delete') {
            const deleted = selectionState.selectedObjectIds.length
                ? callEditor('projectTakeoffDeleteSelection', selectionState.selectedObjectIds)
                : callEditor('projectTakeoffDeleteSelectedAnnotation');
            if (!deleted) showPrepared('Select an unlocked element before deleting.');
            else {
                selectionState.selectedObjectIds = [];
                selectionState.selectedGroupIds = [];
                selectionState.selectedLayerIds = [];
            }
        }
        if (action === 'lock' || action === 'unlock') {
            const changed = callEditor('projectTakeoffSetSelectionLocked', selectionState.selectedObjectIds, action === 'lock');
            if (!changed) showPrepared(`Unable to ${action} the selected elements.`);
        }
        if (action === 'properties') {
            const multiplier = prompt('Multiplier for all selected elements', '1');
            if (multiplier === null) return;
            const numeric = Number(multiplier);
            if (!Number.isFinite(numeric) || numeric < 0) return showPrepared('Enter a valid multiplier of 0 or greater.');
            const changed = callEditor('projectTakeoffUpdateSelection', selectionState.selectedObjectIds, { multiplier: numeric });
            if (!changed) showPrepared('Unlock selected elements before changing their properties.');
        }
        if (action === 'move') {
            const names = allLayers().map(layer => layer.name).join(', ');
            const targetName = prompt(`Move selected objects to layer (${names})`, findLayer(takeoffState.activeLayerId)?.name || '');
            const target = allLayers().find(layer => layer.name.toLowerCase() === String(targetName || '').trim().toLowerCase());
            if (!target) return;
            const moved = callEditor('projectTakeoffMoveSelectionToLayer', selectionState.selectedObjectIds, layerCanvasPayload(target));
            if (!moved) showPrepared('Move selection is ready to be connected.');
        }
        const snapshot = callEditor('projectTakeoffSnapshot');
        if (snapshot) syncTakeoffFromCanvasSnapshot(snapshot);
    }

    function runLayerTool(command) {
        if (command === 'auto-count') return showPrepared('Auto-Count is ready to be connected to detection service.');
        if (command === 'auto-area') return showPrepared('Auto-Area Takeoff is ready to be connected to detection service.');
        const map = {
            'linear-straight': 'linear',
            'linear-angled': 'linear-angled',
            'linear-curved': 'linear-curved',
            'linear-freehand': 'freehand',
            'area-polygon': 'area',
            'count-point': 'count'
        };
        runTool(map[command] || command);
    }

    function openComparePanel() {
        ensureTakeoffOverlays();
        const panel = $('takeoffComparePanel');
        if (!panel) return;
        const activeDoc = activeDrawingDoc();
        const docs = drawingState.documents.length ? drawingState.documents : drawingDocs();
        panel.hidden = false;
        panel.innerHTML = `
            <div class="pro-compare-head">
                <div><strong>Compare Drawings</strong><span>Base: ${esc(activeDoc?.name || 'Current drawing')}</span></div>
                <button class="pro-icon-btn" type="button" data-compare-action="cancel" aria-label="Close"><i class="fas fa-times"></i></button>
            </div>
            <div class="pro-compare-body">
                <div>
                    <label>Documents</label>
                    <div class="pro-compare-list">
                        ${docs.map(doc => `<button type="button" data-compare-doc="${esc(doc.id)}">${esc(doc.name)}<small>${esc(doc.folder || '')}</small></button>`).join('') || '<span>No drawings available.</span>'}
                    </div>
                </div>
                <div>
                    <label>Pages</label>
                    <div class="pro-compare-list" id="takeoffComparePages"><span>Select a drawing.</span></div>
                </div>
            </div>
            <div class="pro-compare-actions">
                <button type="button" data-compare-action="align">Align</button>
                <button type="button" data-compare-action="swap">Swap</button>
                <button type="button" data-compare-action="start">Compare</button>
            </div>
        `;
        panel.querySelectorAll('[data-compare-doc]').forEach(button => {
            button.addEventListener('click', async () => {
                panel.querySelectorAll('[data-compare-doc]').forEach(item => item.classList.toggle('active', item === button));
                const doc = docs.find(item => String(item.id) === String(button.dataset.compareDoc));
                if (!doc) return;
                await ensurePageCount(doc);
                const pages = buildSheets(doc);
                const pageBox = $('takeoffComparePages');
                if (pageBox) pageBox.innerHTML = pages.map(sheet => `<button type="button" data-compare-page="${sheet.pageNumber}">${esc(sheet.name)}</button>`).join('');
                panel.dataset.compareDoc = doc.id;
            });
        });
        panel.querySelectorAll('[data-compare-action]').forEach(button => {
            button.addEventListener('click', () => runCompareAction(button.dataset.compareAction));
        });
    }

    function runCompareAction(action) {
        if (action === 'cancel') {
            takeoffState.compare = null;
            $('takeoffComparePanel')?.setAttribute('hidden', '');
            saveTakeoffState();
            return;
        }
        if (action === 'align' || action === 'swap') return showPrepared(`${action.charAt(0).toUpperCase() + action.slice(1)} is ready to be connected.`);
        takeoffState.compare = {
            baseDocumentId: drawingState.selectedDocumentId,
            basePage: drawingState.selectedPage,
            compareDocumentId: $('takeoffComparePanel')?.dataset.compareDoc || null,
            updatedAt: Date.now()
        };
        saveTakeoffState();
        showPrepared('Drawing comparison is ready to be connected.');
    }

    function toggleMoreToolsPanel() {
        ensureTakeoffOverlays();
        const panel = $('takeoffMoreToolsPanel');
        if (!panel) return;
        const open = panel.hidden;
        panel.hidden = !open;
        if (!open) return;
        panel.innerHTML = `
            <button type="button" data-tool-command-inline="transform"><i class="fas fa-up-down-left-right"></i><span>Transform / Scale</span></button>
            <button type="button" data-tool-command-inline="vertices"><i class="fas fa-vector-square"></i><span>Edit vertices</span></button>
            <button type="button" data-tool-command-inline="multi-select"><i class="fas fa-object-group"></i><span>Rectangle select</span></button>
            <button type="button" data-tool-command-inline="freehand"><i class="fas fa-signature"></i><span>Freehand / Lasso</span></button>
        `;
        panel.querySelectorAll('[data-tool-command-inline]').forEach(button => {
            button.addEventListener('click', () => {
                panel.hidden = true;
                runTool(button.dataset.toolCommandInline);
            });
        });
    }

    function openTakeoffContextMenu(button, type, id) {
        const menu = $('takeoffRowMenu');
        if (!menu) return;
        const group = type === 'group' ? findGroup(id) : null;
        menu.innerHTML = type === 'group'
            ? `<button type="button" data-menu-act="group-create"><i class="fas fa-plus"></i> Create New Takeoff Layer</button>
               <button type="button" data-menu-act="group-rename"><i class="fas fa-pen"></i> Rename</button>
               <button type="button" data-menu-act="group-copy"><i class="fas fa-copy"></i> Copy</button>
               <button type="button" data-menu-act="group-copy-estimate"><i class="fas fa-copy"></i> Copy to other estimate</button>
               <button type="button" data-menu-act="group-move-estimate"><i class="fas fa-arrow-right"></i> Move to other estimate</button>
               <button type="button" class="danger" data-menu-act="group-delete"><i class="fas fa-trash"></i> Delete</button>`
            : `<button type="button" data-menu-act="layer-edit"><i class="fas fa-sliders"></i> Item properties & size</button>
               <button type="button" data-menu-act="layer-rename"><i class="fas fa-pen"></i> Rename</button>
               <button type="button" data-menu-act="layer-duplicate"><i class="fas fa-copy"></i> Duplicate</button>
               <button type="button" data-menu-act="layer-color"><i class="fas fa-palette"></i> Change Color</button>
               <button type="button" data-menu-act="layer-move"><i class="fas fa-folder-tree"></i> Move to Group</button>
               <button type="button" class="danger" data-menu-act="layer-delete"><i class="fas fa-trash"></i> Delete</button>`;
        menu.querySelectorAll('[data-menu-act]').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.menuAct;
                menu.classList.remove('open');
                activeRowMenuAnchor = null;
                if (action === 'group-create') openCreateLayerModal(id);
                if (action === 'group-rename') renameGroup(id);
                if (action === 'group-copy') duplicateGroup(id);
                if (action === 'group-copy-estimate') showPrepared('Copy to other estimate is ready to be connected.');
                if (action === 'group-move-estimate') showPrepared('Move to other estimate is ready to be connected.');
                if (action === 'group-delete') deleteGroup(id);
                if (action === 'layer-edit') openLayerModal(findLayer(id)?.groupId, id);
                if (action === 'layer-rename') renameLayer(id);
                if (action === 'layer-duplicate') duplicateLayer(id);
                if (action === 'layer-color') changeLayerColor(id);
                if (action === 'layer-move') moveLayerToGroup(id);
                if (action === 'layer-delete') deleteLayer(id);
            });
        });
        toggleRowMenu(button);
    }

    function handleTakeoffAction(action) {
        document.querySelectorAll('.pro-menu').forEach(menu => menu.classList.remove('open'));
        document.querySelectorAll('[data-takeoff-menu-toggle]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
        if (action === 'create-group') return openTakeoffGroupModal(document.activeElement);
        if (action === 'create-layer') return openCreateLayerModal(null);
        if (action === 'collapse-all') return collapseAllTakeoffGroups();
        if (action === 'toggle-global-visibility') return toggleGlobalVisibility();
        if (action === 'export-excel') return exportTakeoffQuantities();
        if (action === 'browse-catalog') return openCatalogModal();
        if (action === 'upload-drawing') return document.querySelector('[data-tab="documents"]')?.click();
        if (action === 'save-workspace') {
            saveTakeoffState();
            try {
                const saved = callEditor('projectTakeoffSave');
                if (saved && typeof saved.then === 'function') {
                    saved.catch(e => console.warn('Canvas save warning:', e));
                }
            } catch (e) {
                console.warn('Canvas save error:', e);
            }
            if (typeof window.projectEstimatingSave === 'function') {
                try {
                    window.projectEstimatingSave().catch?.(e => console.warn('Estimating save warning:', e));
                } catch (e) {
                    console.warn('Estimating save error:', e);
                }
            }
            callEditor('projectTakeoffSnapshot');
            return showPrepared('Workspace saved.');
        }
        showPrepared(action);
    }

    // Bind mutation entry points through delegation as soon as this script is
    // evaluated.  The Takeoff workspace can be rendered or refreshed after the
    // initial DOMContentLoaded pass, so snapshotting the current buttons left
    // Actions -> Create New Group without a listener in that state.
    function bindTakeoffActionDelegation() {
        document.addEventListener('click', event => {
            const button = event.target?.closest?.('[data-takeoff-action]');
            if (!button) return;
            handleTakeoffAction(button.dataset.takeoffAction);
        });
        document.addEventListener('submit', event => {
            if (event.target?.id !== 'takeoffGroupForm') return;
            submitTakeoffGroupModal(event);
        });
    }

    bindTakeoffActionDelegation();

    function toggleGlobalVisibility() {
        pushTakeoffHistory('toggle-global-visibility');
        takeoffState.globalVisible = !takeoffState.globalVisible;
        const targetVisible = Boolean(takeoffState.globalVisible);
        const activeLayers = [];
        allLayers().forEach(layer => {
            layer.visible = targetVisible;
            if (layerBelongsToEstimate(layer)) activeLayers.push(layer);
        });
        syncVisibilityToEditorBatch(activeLayers, targetVisible);
        saveTakeoffState({ skipEstimatingSync: true, debounceLocalSave: true });
        renderTakeoffPanel();
        const button = document.querySelector('[data-takeoff-action="toggle-global-visibility"] i');
        if (button) button.className = targetVisible ? 'fas fa-eye' : 'fas fa-eye-slash';
    }

    function exportTakeoffQuantities() {
        const rows = allLayers().map(layer => {
            const group = groupForLayer(layer);
            const activeDoc = activeDrawingDoc();
            return {
                project: window.ProjectState?.projectName || document.querySelector('.project-title h1')?.textContent || 'Project',
                estimate: 'Primary Estimate',
                group: group?.name || 'Default Group',
                layer: layer.name,
                catalog: layer.catalogItemId || '',
                type: layer.type,
                quantity: Number(layer.quantity || 0),
                uom: layer.uom || typeToUom(layer.type),
                document: activeDoc?.name || '',
                sheet: drawingState.selectedPage ? `Page ${drawingState.selectedPage}` : '',
                unitCost: Number(layer.unitCost || layer.unit_cost || 0),
                labor: Number(layer.laborHours || layer.labor_hours || 0)
            };
        });
        const headers = ['Project name', 'Estimate name', 'Group', 'Takeoff layer', 'Catalog item', 'Takeoff type', 'Quantity', 'UoM', 'Document', 'Sheet/Page', 'Unit cost', 'Labor'];
        const body = rows.map(row => [
            row.project, row.estimate, row.group, row.layer, row.catalog, row.type, row.quantity, row.uom, row.document, row.sheet, row.unitCost, row.labor
        ]);
        const html = `<table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${body.map(cells => `<tr>${cells.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `takeoff-quantities-${Date.now()}.xls`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function setActiveTool(command) {
        viewerState.activeTool = command;
        document.querySelectorAll('[data-tool-command]').forEach(button => {
            button.classList.toggle('active', button.dataset.toolCommand === command);
        });
        const layerToolMap = {
            count: ['count-point'],
            linear: ['linear-straight', 'linear-angled'],
            area: ['area-polygon'],
            freehand: ['linear-freehand']
        };
        document.querySelectorAll('[data-layer-tool]').forEach(button => {
            button.classList.toggle('active', (layerToolMap[command] || []).includes(button.dataset.layerTool));
        });
    }

    function runTool(command) {
        if (command === 'count' || command === 'linear' || command === 'area') {
            const active = findLayer(takeoffState.activeLayerId);
            if (!active) {
                showPrepared('Select a takeoff layer before drawing.');
                return;
            }
            pushTakeoffHistory(`tool-${command}`);
            callEditor('projectTakeoffSetTool', command);
            setActiveTool(command);
            if ((command === 'linear' || command === 'area') && !hasScaleSet()) openScalePanel();
            return;
        }
        if (command === 'smart' || command === 'pan') {
            if (command === 'smart') {
                callEditor('resolveMeasurementOnPointer');
                callEditor('projectTakeoffResolveDraftOnPointer');
            }
            callEditor('clearPlacementTool');
            callEditor('projectTakeoffSetTool', command === 'pan' ? 'pan' : 'select');
            setActiveTool(command);
            callEditor('setMode', 'smart');
            if (command === 'smart') {
                clearActiveTakeoffLayer(true);
                clearAllSelections();
            }
            document.querySelector('.pro-canvas-shell')?.classList.toggle('is-panning', command === 'pan');
            return;
        }
        const modeMap = {
            smart: 'smart',
            pan: 'smart',
            count: 'smart',
            linear: 'measure',
            area: 'draw',
            calibrate: 'cal',
            text: 'text',
            note: 'text',
            cloud: 'cloud',
            stamp: 'stamp'
        };
        if (['measure', 'calibrate', 'cloud', 'pin', 'freehand', 'stamp', 'text', 'note'].includes(command)) {
            clearActiveTakeoffLayer(true);
            clearAllSelections();
            callEditor('projectTakeoffClearSelection');
        }
        if (command === 'measure') {
            callEditor('projectTakeoffSetTool', 'measure');
            callEditor('setMode', 'measure');
            setActiveTool(command);
            showPrepared("Ruler active. Click and drag or click two points to measure.", "info");
            return;
        }
        if (command === 'calibrate') {
            callEditor('setMode', 'cal');
            setActiveTool(command);
            openScalePanel('manual');
            return;
        }
        if (command === 'multi-select') {
            callEditor('projectTakeoffSetTool', 'multi-select');
            setActiveTool(command);
            return;
        }
        if (command === 'snapshot') {
            takeoffState.snapshots.push({
                id: makeId('snapshot'),
                documentId: drawingState.selectedDocumentId,
                page: drawingState.selectedPage,
                createdAt: Date.now()
            });
            saveTakeoffState();
            return showPrepared('Snapshot is ready to be connected.');
        }
        if (command === 'freehand') {
            callEditor('projectTakeoffSetTool', 'freehand');
            callEditor('setMode', 'draw');
            setActiveTool(command);
            return;
        }
        if (command === 'pin') {
            callEditor('projectTakeoffSetTool', 'select');
            callEditor('addPin');
            setActiveTool(command);
            showPrepared('Click the drawing to place a reference pin.');
            return;
        }
        if (command === 'text') {
            // Notes are annotations, not a Takeoff drawing type. Explicitly
            // leave the quantity tool, then arm the annotation placement API.
            callEditor('projectTakeoffSetTool', 'select');
            const added = callEditor('addText');
            setActiveTool(command);
            if (!added) showPrepared('Click the drawing to add a text annotation.');
            return;
        }
        if (command === 'cloud') {
            // Annotation clouds are independent from Takeoff areas. Stop any
            // active quantity tool before arming the one-shot cloud placement.
            callEditor('projectTakeoffSetTool', 'select');
            const activated = callEditor('addCloud');
            setActiveTool(command);
            if (!activated) showPrepared('Click or drag on the drawing to place a cloud annotation.');
            return;
        }
        if (command === 'stamp') {
            callEditor('toggleStampMenu');
            setActiveTool(command);
            return;
        }
        if (command === 'undo') return undoTakeoff();
        if (command === 'redo') return redoTakeoff();
        if (command === 'delete') return runSelectionAction('delete');
        if (command === 'more') return toggleMoreToolsPanel();
        if (command === 'transform') {
            const activated = callEditor('projectTakeoffSetTool', 'transform');
            setActiveTool(command);
            if (!activated) showPrepared('Select an item before transforming it.');
            return;
        }
        if (command === 'vertices') {
            const activated = callEditor('projectTakeoffSetTool', 'vertices');
            setActiveTool(command);
            if (!activated) showPrepared('Select a line or area before editing vertices.');
            return;
        }
    }

    function bindKeyboardShortcuts(syncTakeoffSubheadAlignment) {
            const headerToggle = $('bt-header-collapse-btn');
            headerToggle?.addEventListener('click', () => {
                const header = $('projectWorkspaceHeader');
                if (!header) return;
                header.hidden = !header.hidden;
                const label = header.hidden ? 'Show header' : 'Hide header';
                headerToggle.setAttribute('aria-expanded', String(!header.hidden));
                headerToggle.setAttribute('aria-label', label);
                headerToggle.title = `${label} (H)`;
                const icon = headerToggle.querySelector('i');
                if (icon) icon.className = `fas fa-chevron-${header.hidden ? 'down' : 'up'}`;
                syncTakeoffSubheadAlignment();
            });

            const toolShortcuts = { v: 'smart', m: 'measure', c: 'cloud', n: 'text', a: 'multi-select' };
            function handleWorkspaceShortcut(event) {
                if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey) return false;
                const key = event.key.toLowerCase();
                const target = event.target;
                const editing = target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
                const dialog = Array.from(document.querySelectorAll('[aria-modal="true"], #takeoffLayerModal'))
                    .filter(element => element.getClientRects().length > 0 && window.getComputedStyle(element).visibility === 'visible')
                    .at(-1);
                const control = event.ctrlKey || event.metaKey;
                if (dialog) {
                    if (key !== 'enter' || control || event.shiftKey
                        || target?.closest?.('textarea, select, button, a, [contenteditable], [role="textbox"], form')) return false;
                    const actions = Array.from(dialog.querySelectorAll('.pd-modal-foot button.btn-main, button[data-keyboard-accept], button[type="submit"]'))
                        .filter(button => !button.disabled && button.getClientRects().length > 0);
                    if (actions.length !== 1) return false;
                    actions[0].click();
                    return true;
                }
                if (editing) return false;
                if (key === 'h' && !control && !event.shiftKey && headerToggle) {
                    headerToggle.click();
                    return true;
                }
                if (key === 'f' && !control && !event.shiftKey && $('tab-estimating')?.classList.contains('active')) {
                    const button = $('estBtnFullscreen');
                    if (!button || button.disabled || button.hidden) return false;
                    button.click();
                    return true;
                }
                if (!$('tab-takeoff')?.classList.contains('active')) return false;
                const readOnly = document.body.dataset.readOnly === 'true';
                if (control) {
                    if (readOnly || (key !== 'z' && key !== 'y')) return false;
                    runTool(key === 'y' || event.shiftKey ? 'redo' : 'undo');
                    return true;
                }
                if (event.shiftKey) return false;
                if (key === 'f') {
                    runViewerCommand('fullscreen');
                    return true;
                }
                if (key === 'enter' && !readOnly && !target?.closest?.('button, a, [role="button"]')) {
                    return callEditor('projectTakeoffFinishActiveDraft') === true;
                }
                if (key === 'delete' && !readOnly) {
                    runSelectionAction('delete');
                    return true;
                }
                const tool = toolShortcuts[key];
                if (!tool || (readOnly && tool !== 'smart' && tool !== 'multi-select')) return false;
                runTool(tool);
                return true;
            }
            window.handleProjectWorkspaceShortcut = handleWorkspaceShortcut;
        return handleWorkspaceShortcut;
    }

    function runViewerCommand(command) {
        if (command === 'zoom-out') return setZoom(currentZoomPercent() - 25);
        if (command === 'zoom-in') return setZoom(currentZoomPercent() + 25);
        if (command === 'fit') {
            const zoom = callEditor('projectTakeoffFitToView') || callEditor('fitPdfToView', true) || currentZoomPercent();
            setTimeout(() => updateZoomUi(zoom || currentZoomPercent()), 40);
            return;
        }
        if (command === 'previous' || command === 'next') return changeActiveSheet(command === 'next' ? 1 : -1);
        if (command === 'fullscreen') {
            const shell = $('takeoffWorkspace') || document.querySelector('.pro-takeoff-workspace') || document.querySelector('.pro-canvas-shell');
            if (!document.fullscreenElement && shell?.requestFullscreen) {
                shell.requestFullscreen().catch(() => showPrepared('Fullscreen could not start.'));
            } else if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => showPrepared('Fullscreen could not close.'));
            }
            return;
        }
        if (command === 'popout') {
            const frame = $('takeoffFrame');
            if (frame?.src) window.open(frame.src, '_blank', 'noopener');
            return;
        }
        if (command === 'download') {
            const downloaded = callEditor('projectTakeoffDownloadAnnotatedDrawing');
            if (downloaded) return;
            const link = document.getElementById('downloadDocBtn');
            if (link?.href && link.href !== '#') link.click();
            return;
        }
        if (command === 'grid') return toggleGrid();
        if (command === 'layers') return toggleViewerLayersPopover();
        if (command === 'compare') return openComparePanel();
        if (command === 'show-estimate') {
            syncTakeoffToEstimating();
            if (typeof window.setActiveTab === 'function') window.setActiveTab('estimating');
            else document.querySelector('[data-tab="estimating"]')?.click();
        }
    }

    function showPrepared(command, type = 'info') {
        const text = String(command || '').includes('.') || String(command || '').includes(' ') ? command : `${command.replace('-', ' ')} is ready to connect.`;
        const frame = $('takeoffFrame') || document.querySelector('iframe#takeoffFrame');
        if (frame && frame.contentWindow) {
            try {
                frame.contentWindow.postMessage({ type: 'editor-show-toast', message: text, toastType: type }, '*');
                return;
            } catch (_) { }
        }

        const old = document.querySelector('.toast-lite');
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.className = 'toast-lite';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.style.cssText = 'position:fixed !important; top:16px !important; bottom:auto !important; left:50% !important; right:auto !important; transform:translateX(-50%) !important; z-index:999999 !important; border-radius:9999px !important; padding:4px 14px !important; height:28px !important; font-size:12px !important; display:inline-flex !important; align-items:center !important; gap:7px !important; pointer-events:none !important; white-space:nowrap !important;';
        const iconClass = type === 'error' ? 'fa-circle-exclamation' : (type === 'success' ? 'fa-circle-check' : 'fa-info-circle');
        const iconColor = type === 'error' ? '#ef4444' : (type === 'success' ? '#22c55e' : '#38bdf8');
        toast.innerHTML = `<i class="fas ${iconClass}" style="color:${iconColor}; font-size:12px; margin-right:4px;"></i><span>${esc(text)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2400);
    }

    let activeRowMenuAnchor = null;

    function getTakeoffBoundary(el) {
        const margin = 8;
        const boundaryEl = el?.closest?.('.pro-takeoff-workspace, .workspace-shell, body') || document.body;
        if (!boundaryEl || boundaryEl === document.body || boundaryEl === document.documentElement) {
            return {
                left: margin,
                top: margin,
                right: window.innerWidth - margin,
                bottom: window.innerHeight - margin,
                width: window.innerWidth - (margin * 2),
                height: window.innerHeight - (margin * 2)
            };
        }
        const bRect = boundaryEl.getBoundingClientRect();
        return {
            left: Math.max(margin, bRect.left + margin),
            top: Math.max(margin, bRect.top + margin),
            right: Math.min(window.innerWidth - margin, bRect.right - margin),
            bottom: Math.min(window.innerHeight - margin, bRect.bottom - margin),
            width: Math.max(0, Math.min(window.innerWidth - margin, bRect.right - margin) - Math.max(margin, bRect.left + margin)),
            height: Math.max(0, Math.min(window.innerHeight - margin, bRect.bottom - margin) - Math.max(margin, bRect.top + margin))
        };
    }

    function positionRowMenu(button) {
        const menu = $('takeoffRowMenu');
        if (!menu) return;
        const rect = button.getBoundingClientRect();
        const bounds = getTakeoffBoundary(button);
        const margin = 8;
        const gap = 6;
        menu.style.left = '0px';
        menu.style.top = '0px';
        menu.style.visibility = 'hidden';
        menu.classList.add('open');
        const menuRect = menu.getBoundingClientRect();
        let left = rect.right - menuRect.width;
        let top = rect.bottom + gap;
        if (top + menuRect.height > bounds.bottom) {
            top = rect.top - menuRect.height - gap;
        }
        left = Math.max(bounds.left, Math.min(left, bounds.right - menuRect.width));
        top = Math.max(bounds.top, Math.min(top, bounds.bottom - menuRect.height));
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        menu.style.visibility = 'visible';
    }

    function toggleRowMenu(button) {
        const menu = $('takeoffRowMenu');
        if (!menu) return;
        const isSameOpen = menu.classList.contains('open') && activeRowMenuAnchor === button;
        document.querySelectorAll('.pro-row-menu').forEach(item => {
            item.classList.remove('open');
            item.__trigger = null;
        });
        document.querySelectorAll('[data-row-menu]').forEach(btn => {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-expanded', 'false');
        });
        if (isSameOpen) {
            activeRowMenuAnchor = null;
            return;
        }
        activeRowMenuAnchor = button;
        menu.__trigger = button;
        button.classList.add('is-active');
        button.setAttribute('aria-expanded', 'true');
        positionRowMenu(button);
    }

    function refreshOpenRowMenu() {
        const menu = $('takeoffRowMenu');
        if (!menu?.classList.contains('open') || !activeRowMenuAnchor?.isConnected) return;
        positionRowMenu(activeRowMenuAnchor);
    }


        function clearActiveRowMenuAnchor() {
            activeRowMenuAnchor = null;
        }

        return Object.freeze({
            ensureViewerLayersPopover,
            renderViewerLayersPopover,
            openViewerLayersPopover,
            closeViewerLayersPopover,
            toggleViewerLayersPopover,
            toggleGrid,
            ensureTakeoffOverlays,
            renderActiveLayerToolbar,
            renderSelectionBar,
            clearAllSelections,
            setSelectedObjects,
            toggleGroupSelection,
            setGroupSelection,
            selectSingleLayer,
            toggleLayerSelection,
            toggleLayerLock,
            runSelectionAction,
            runLayerTool,
            openComparePanel,
            runCompareAction,
            toggleMoreToolsPanel,
            openTakeoffContextMenu,
            handleTakeoffAction,
            bindTakeoffActionDelegation,
            toggleGlobalVisibility,
            exportTakeoffQuantities,
            setActiveTool,
            runTool,
            runViewerCommand,
            bindKeyboardShortcuts,
            showPrepared,
            getTakeoffBoundary,
            positionRowMenu,
            toggleRowMenu,
            refreshOpenRowMenu,
            clearActiveRowMenuAnchor
        });
    }

    return Object.freeze({ create });
});

