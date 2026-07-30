(function () {
    const $ = (id) => document.getElementById(id);

    function takeoffWindow() {
        const frame = $('takeoffFrame');
        if (!frame || !frame.contentWindow) return null;
        try {
            return frame.contentWindow;
        } catch (e) {
            return null;
        }
    }

    function callEditor(fnName, ...args) {
        const win = takeoffWindow();
        if (!win || typeof win[fnName] !== 'function') return false;
        try {
            return win[fnName](...args);
        } catch (e) {
            console.warn(`Takeoff editor command failed: ${fnName}`, e);
            return false;
        }
    }

    function editorCanvas() {
        const win = takeoffWindow();
        return win && win.canvas ? win.canvas : null;
    }

    function notifyEditorVisible() {
        const frame = $('takeoffFrame');
        try {
            frame?.contentWindow?.postMessage({ type: 'takeoff-visible' }, '*');
        } catch (e) {}
    }

    function setZoom(percent) {
        const clamped = Math.max(25, Math.min(400, Number(percent || 100)));
        const editorZoom = callEditor('projectTakeoffSetZoom', clamped);
        const nextPercent = Number(editorZoom || clamped);
        updateZoomUi(nextPercent);
    }

    function updateZoomUi(percent) {
        const nextPercent = Math.max(25, Math.min(400, Number(percent || 100)));
        const percentText = `${Math.round(nextPercent)}%`;
        const slider = $('takeoffZoomSlider');
        const label = $('takeoffZoomPercent');
        if (slider) slider.value = String(Math.round(nextPercent));
        if (label) label.textContent = percentText;
        const win = takeoffWindow();
        const embeddedZoom = win?.document?.getElementById('zoom-disp');
        if (embeddedZoom) embeddedZoom.textContent = percentText;
    }

    function currentZoomPercent() {
        const editorZoom = callEditor('projectTakeoffGetZoom');
        if (editorZoom) return Number(editorZoom);
        return Number($('takeoffZoomSlider')?.value || 100);
    }

    function fitTakeoffToScreen() {
        const commands = ['projectTakeoffFitToScreen', 'takeoffFitToScreen', 'fitToScreen', 'fitPage'];
        for (const command of commands) {
            const result = callEditor(command);
            if (result) {
                updateZoomUi(Number(result) || currentZoomPercent());
                return true;
            }
        }
        notifyEditorVisible();
        return false;
    }

    function bindTooltips() {
        document.querySelectorAll('.pro-tool-btn, .pro-toolbar-btn, .pro-chip-btn').forEach(button => {
            const label = button.getAttribute('aria-label') || button.getAttribute('title') || button.dataset.toolCommand || button.dataset.viewerCommand || '';
            if (!label) return;
            button.dataset.proTooltip = label.replace(/[-_]+/g, ' ');
            button.removeAttribute('title');
        });
    }

    window.projectTakeoffFitToScreen = fitTakeoffToScreen;

    const viewerState = {
        isGridVisible: false,
        isLayersPopoverOpen: false,
        isFullscreen: false
    };

    const drawingState = {
        documents: [],
        selectedDocumentId: Number(window.ProjectState?.selectedDocumentId || 0),
        selectedPage: 1,
        browseDocumentId: Number(window.ProjectState?.selectedDocumentId || 0),
        query: '',
        pdfReady: null,
        pdfLoading: null,
        pdfDocs: new Map(),
        thumbnailCache: new Map(),
        thumbnailCacheLimit: 40,
        thumbnailRequest: 0
    };

    function drawingExtensions() {
        return ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic'];
    }

    function esc(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function drawingDocs() {
        return (window.ProjectState?.documents || [])
            .filter(doc => doc?.path && drawingExtensions().includes(String(doc.extension || '').toLowerCase()))
            .map(doc => ({
                id: Number(doc.id),
                name: doc.filename || doc.title || 'Untitled drawing',
                source: doc.source,
                folder: doc.folder_name || 'Documents',
                pageCount: Number(doc.pageCount || 0) || null,
                fileUrl: doc.path,
                extension: String(doc.extension || '').toLowerCase(),
                sheets: []
            }));
    }

    function activeDrawingDoc() {
        return drawingState.documents.find(doc => Number(doc.id) === Number(drawingState.selectedDocumentId)) || drawingState.documents[0] || null;
    }

    function browsingDrawingDoc() {
        return drawingState.documents.find(doc => Number(doc.id) === Number(drawingState.browseDocumentId)) || activeDrawingDoc();
    }

    function setDrawingLabel() {
        const doc = activeDrawingDoc();
        const label = $('takeoffSheetLabel');
        if (!label) return;
        if (!doc) {
            label.textContent = 'No drawing selected';
            return;
        }
        const suffix = doc.pageCount && doc.pageCount > 1 ? ` - Page ${drawingState.selectedPage}` : '';
        label.textContent = `${doc.name}${suffix}`;
        renderCompactDocuments();
        renderWorkspaceSummary();
    }

    function renderCompactDocuments() {
        const list = $('takeoffDocumentsCompact');
        const count = $('takeoffDocumentCount');
        if (count) count.textContent = String(drawingState.documents.length);
        if (!list) return;
        list.innerHTML = drawingState.documents.map(doc => {
            const active = Number(doc.id) === Number(drawingState.selectedDocumentId);
            const pages = doc.pageCount ? `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}` : 'Drawing';
            return `<button class="pro-compact-document ${active ? 'active' : ''}" type="button" data-compact-document="${esc(doc.id)}">
                <i class="fas ${doc.extension === 'pdf' ? 'fa-file-pdf' : 'fa-file-image'}"></i>
                <span><strong>${esc(doc.name)}</strong><small>${esc(doc.folder)} · ${esc(pages)}</small></span>
                <em>${active ? 'Active' : 'Open'}</em>
            </button>`;
        }).join('') || '<div class="pro-inspector-empty"><span>No drawings uploaded.</span></div>';
        list.querySelectorAll('[data-compact-document]').forEach(button => {
            button.addEventListener('click', () => {
                const doc = drawingState.documents.find(row => Number(row.id) === Number(button.dataset.compactDocument));
                if (doc) selectDrawingSheet(doc, 1);
            });
        });
    }

    function renderWorkspaceSummary() {
        const page = $('takeoffTopPage');
        const progress = $('takeoffTopProgress');
        const doc = activeDrawingDoc();
        if (page) page.textContent = `${drawingState.selectedPage || 1} / ${doc?.pageCount || 1}`;
        const layers = allLayers();
        const ready = layers.filter(layer => Number(layer.quantity || 0) > 0).length;
        const percentage = layers.length ? Math.round((ready / layers.length) * 100) : 0;
        if (progress) progress.textContent = `${percentage}% ready`;
    }

    function loadPdfJs() {
        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.pdfjsLib.GlobalWorkerOptions.workerSrc || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
            return Promise.resolve(window.pdfjsLib);
        }
        if (drawingState.pdfLoading) return drawingState.pdfLoading;
        drawingState.pdfLoading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
            script.onload = () => {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                resolve(window.pdfjsLib);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
        return drawingState.pdfLoading;
    }

    async function getPdfDocument(doc) {
        if (!doc || doc.extension !== 'pdf') return null;
        if (drawingState.pdfDocs.has(doc.id)) return drawingState.pdfDocs.get(doc.id);
        const pdfjs = await loadPdfJs();
        const task = pdfjs.getDocument({
            url: doc.fileUrl,
            rangeChunkSize: 262144,
            disableStream: false,
            disableAutoFetch: true
        });
        const pdf = await task.promise;
        drawingState.pdfDocs.set(doc.id, pdf);
        return pdf;
    }

    function sheetName(doc, pageNumber) {
        return `${doc.name} - Page ${pageNumber}`;
    }

    function buildSheets(doc) {
        if (!doc) return [];
        const count = doc.pageCount || (doc.extension === 'pdf' ? 0 : 1);
        if (!count) return [];
        return Array.from({ length: count }, (_, index) => {
            const pageNumber = index + 1;
            const saved = doc.sheets?.[index] || {};
            return {
                id: `${doc.id}:${pageNumber}`,
                documentId: doc.id,
                name: saved.name || sheetName(doc, pageNumber),
                pageNumber,
                thumbnailUrl: saved.thumbnailUrl,
                hasTakeoffs: Boolean(saved.hasTakeoffs),
                hasComments: Boolean(saved.hasComments)
            };
        });
    }

    async function ensurePageCount(doc) {
        if (!doc || doc.pageCount) return doc?.pageCount || 0;
        if (doc.id === drawingState.selectedDocumentId) {
            const info = callEditor('takeoffGetDocumentInfo');
            if (info?.pageCount) {
                doc.pageCount = Number(info.pageCount);
                doc.sheets = buildSheets(doc);
                return doc.pageCount;
            }
        }
        if (doc.extension !== 'pdf') {
            doc.pageCount = 1;
            doc.sheets = buildSheets(doc);
            return doc.pageCount;
        }
        try {
            const pdf = await getPdfDocument(doc);
            doc.pageCount = pdf.numPages;
            doc.sheets = buildSheets(doc);
            return doc.pageCount;
        } catch (e) {
            console.warn('Unable to read drawing metadata', e);
            doc.pageCount = 0;
            return 0;
        }
    }

    const TAKEOFF_TYPES = ['Count', 'Linear', 'Linear with drop', 'Linear avg. with drop', 'Count by distance', 'Area / Volume', 'Vertical wall area'];
    const TAKEOFF_UOMS = ['ea', 'ft', 'lf', 'sq ft', 'ft3', 'yd', 'm'];
    const TAKEOFF_SYMBOLS = ['Solid Circle', 'Hollow Circle', 'Square', 'Triangle', 'Diamond', 'Cross'];
    const TAKEOFF_SIZES = ['Small', 'Medium', 'Large'];
    const TAKEOFF_COLORS = [
        { label: 'Black', value: '#111827' },
        { label: 'Red', value: '#dc2626' },
        { label: 'Blue', value: '#2563eb' },
        { label: 'Green', value: '#16a34a' },
        { label: 'Orange', value: '#f97316' },
        { label: 'Purple', value: '#7c3aed' },
        { label: 'Yellow', value: '#eab308' }
    ];
    const TAKEOFF_TYPE_HELP = {
        Count: 'Use Count for fixtures, receptacles, luminaires, devices, or any item measured by quantity.',
        Linear: 'Use Linear for conduits, cables, piping, or any item measured by length.',
        'Linear with drop': 'Use Linear with drop when horizontal runs include vertical drops at defined points.',
        'Linear avg. with drop': 'Use Linear avg. with drop for repeated runs where an average drop is applied.',
        'Count by distance': 'Use Count by distance for supports, straps, or devices repeated every fixed spacing.',
        'Area / Volume': 'Use Area / Volume for surfaces or volumetric quantities.',
        'Vertical wall area': 'Use Vertical wall area for wall takeoffs measured by height and length.'
    };

    const takeoffState = {
        groups: [],
        activeGroupId: 'default',
        activeLayerId: null,
        editingLayerId: null,
        pendingLayerGroupId: 'default',
        pendingCatalogItem: null,
        canvasSnapshots: {},
        annotations: [],
        pins: [],
        snapshots: [],
        compare: null,
        globalVisible: true,
        query: ''
    };

    const selectionState = {
        selectedObjectIds: [],
        activeLayerId: null
    };

    const historyState = [];

    const catalogState = {
        loaded: false,
        loading: false,
        error: '',
        catalogs: [],
        groups: [],
        items: [],
        query: '',
        category: '',
        uom: ''
    };

    function takeoffStoreKey() {
        return `takeoff.quantification.${window.ProjectState?.projectId || 'draft'}`;
    }

    function typeToUom(type) {
        if (['Linear', 'Linear with drop', 'Linear avg. with drop'].includes(type)) return 'ft';
        if (type === 'Count by distance') return 'ea';
        if (['Area', 'Area / Volume', 'Vertical wall area'].includes(type)) return 'sq ft';
        return 'ea';
    }

    function inferTakeoffTypeFromUom(uom) {
        const value = String(uom || '').trim().toLowerCase();
        if (['ea', 'each', 'unit', 'units', 'pcs', 'piece', 'pieces'].includes(value)) return 'Count';
        if (['ft', 'lf', 'linear ft', 'linear feet', 'feet', 'foot', 'm', 'lm'].includes(value)) return 'Linear';
        if (['sq ft', 'sf', 'sqft', 'ft2', 'm2', 'sqm', 'sq m'].includes(value)) return 'Area';
        return '';
    }

    function setSelectValue(select, value) {
        if (!select || !value) return;
        const normalized = String(value).trim();
        const match = Array.from(select.options).find(option => option.value.toLowerCase() === normalized.toLowerCase());
        if (match) {
            select.value = match.value;
            return;
        }
        const option = document.createElement('option');
        option.value = normalized;
        option.textContent = normalized;
        select.appendChild(option);
        select.value = normalized;
    }

    function normalizeTakeoffType(value) {
        const raw = String(value || '').toLowerCase();
        if (raw === 'linear') return 'Linear';
        if (raw === 'linear with drop') return 'Linear with drop';
        if (raw === 'linear avg. with drop' || raw === 'linear avg with drop') return 'Linear avg. with drop';
        if (raw === 'count by distance') return 'Count by distance';
        if (raw === 'area' || raw === 'area / volume' || raw === 'volume') return 'Area / Volume';
        if (raw === 'vertical wall area') return 'Vertical wall area';
        return 'Count';
    }

    function makeId(prefix) {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    function defaultGroup() {
        return { id: 'default', name: 'Default Group', isExpanded: true, isDefault: true, layers: [] };
    }

    function readSavedTakeoffs() {
        try {
            const parsed = JSON.parse(localStorage.getItem(takeoffStoreKey()) || 'null');
            return parsed && Array.isArray(parsed.groups) ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    function seedGroupsFromProjectLayers() {
        const groups = [defaultGroup()];
        const byName = new Map([['Default Group', groups[0]]]);
        (window.ProjectState?.takeoffLayers || []).forEach((layer, index) => {
            const groupName = layer.group_name || 'Default Group';
            let group = byName.get(groupName);
            if (!group) {
                group = { id: makeId('grp'), name: groupName, isExpanded: true, isDefault: false, layers: [] };
                byName.set(groupName, group);
                groups.push(group);
            }
            const type = normalizeTakeoffType(layer.takeoff_type || layer.type);
            group.layers.push({
                id: String(layer.id || makeId('layer')),
                groupId: group.id,
                name: layer.name || layer.title || `Takeoff Item ${index + 1}`,
                type,
                uom: layer.unit_of_measure || typeToUom(type),
                symbol: layer.symbol || 'Solid Circle',
                size: layer.symbol_size || 'Medium',
                color: layer.color || '#111827',
                visible: layer.visible !== false,
                quantity: Number(layer.quantity || layer.count || layer.measurement_count || 0),
                baseQuantity: Number(layer.baseQuantity ?? layer.quantity ?? layer.count ?? layer.measurement_count ?? 0),
                catalogItemId: layer.catalog_item_id || layer.catalogItemId || null,
                catalog_item_id: layer.catalog_item_id || layer.catalogItemId || null,
                unitCost: Number(layer.unit_cost || layer.unitCost || 0),
                unit_cost: Number(layer.unit_cost || layer.unitCost || 0),
                laborHours: Number(layer.labor_hours || layer.laborHours || 0),
                labor_hours: Number(layer.labor_hours || layer.laborHours || 0),
                category: layer.category || layer.catalog_name || layer.group_name || '',
                description: layer.description || '',
                dropLength: Number(layer.dropLength || layer.drop_length || 0),
                spacing: Number(layer.spacing || 0),
                height: Number(layer.height || 0),
                depth: Number(layer.depth || 0)
            });
        });
        return groups;
    }

    function normalizeSavedGroups(groups) {
        const result = [defaultGroup()];
        (groups || []).forEach(group => {
            if (group.id === 'default') {
                result[0] = { ...defaultGroup(), ...group, id: 'default', name: 'Default Group', isDefault: true, layers: group.layers || [] };
            } else {
                result.push({
                    id: group.id || makeId('grp'),
                    name: group.name || 'New Group',
                    isExpanded: group.isExpanded !== false,
                    isDefault: false,
                    layers: group.layers || []
                });
            }
        });
        return result.map(group => ({
            ...group,
            layers: (group.layers || []).map(layer => ({
                id: layer.id || makeId('layer'),
                groupId: group.id,
                name: layer.name || 'New Takeoff Layer',
                type: normalizeTakeoffType(layer.type),
                uom: layer.uom || typeToUom(normalizeTakeoffType(layer.type)),
                symbol: layer.symbol || 'Solid Circle',
                size: layer.size || 'Medium',
                color: layer.color || '#111827',
                visible: layer.visible !== false,
                quantity: Number(layer.quantity || 0),
                baseQuantity: Number(layer.baseQuantity ?? layer.seedQuantity ?? 0),
                catalogItemId: layer.catalogItemId || layer.catalog_item_id || null,
                catalog_item_id: layer.catalog_item_id || layer.catalogItemId || null,
                unitCost: Number(layer.unitCost || layer.unit_cost || 0),
                unit_cost: Number(layer.unit_cost || layer.unitCost || 0),
                laborHours: Number(layer.laborHours || layer.labor_hours || 0),
                labor_hours: Number(layer.labor_hours || layer.laborHours || 0),
                category: layer.category || '',
                description: layer.description || '',
                dropLength: Number(layer.dropLength || layer.drop_length || 0),
                spacing: Number(layer.spacing || 0),
                height: Number(layer.height || 0),
                depth: Number(layer.depth || 0)
            }))
        }));
    }

    function saveTakeoffState() {
        try {
            localStorage.setItem(takeoffStoreKey(), JSON.stringify({
                groups: takeoffState.groups,
                activeGroupId: takeoffState.activeGroupId,
                activeLayerId: takeoffState.activeLayerId,
                canvasSnapshots: takeoffState.canvasSnapshots,
                annotations: takeoffState.annotations,
                pins: takeoffState.pins,
                snapshots: takeoffState.snapshots,
                compare: takeoffState.compare,
                globalVisible: takeoffState.globalVisible
            }));
            syncTakeoffToEstimating();
        } catch (e) {
            console.warn('Takeoff state could not be saved', e);
        }
    }

    function pushTakeoffHistory(reason = 'change') {
        try {
            historyState.push({
                reason,
                groups: JSON.parse(JSON.stringify(takeoffState.groups)),
                activeGroupId: takeoffState.activeGroupId,
                activeLayerId: takeoffState.activeLayerId,
                canvasSnapshots: JSON.parse(JSON.stringify(takeoffState.canvasSnapshots || {})),
                annotations: JSON.parse(JSON.stringify(takeoffState.annotations || [])),
                pins: JSON.parse(JSON.stringify(takeoffState.pins || [])),
                globalVisible: takeoffState.globalVisible
            });
            if (historyState.length > 60) historyState.shift();
        } catch (e) {
            console.warn('Takeoff history could not be saved', e);
        }
    }

    function undoTakeoff() {
        const previous = historyState.pop();
        const editorUndone = callEditor('undo') || callEditor('projectTakeoffUndo');
        if (!previous) {
            if (!editorUndone) showPrepared('Nothing to undo.');
            return;
        }
        takeoffState.groups = previous.groups;
        takeoffState.activeGroupId = previous.activeGroupId;
        takeoffState.activeLayerId = previous.activeLayerId;
        takeoffState.canvasSnapshots = previous.canvasSnapshots || {};
        takeoffState.annotations = previous.annotations || [];
        takeoffState.pins = previous.pins || [];
        takeoffState.globalVisible = previous.globalVisible !== false;
        saveTakeoffState();
        syncAllLayersToCanvas();
        syncTakeoffToEstimating();
        renderTakeoffPanel();
        renderActiveLayerToolbar();
    }

    function allLayers() {
        return takeoffState.groups.flatMap(group => group.layers || []);
    }

    function findGroup(groupId) {
        return takeoffState.groups.find(group => group.id === groupId) || takeoffState.groups[0];
    }

    function findLayer(layerId) {
        return allLayers().find(layer => layer.id === layerId) || null;
    }

    function groupForLayer(layer) {
        return takeoffState.groups.find(group => group.id === layer?.groupId) || takeoffState.groups[0] || defaultGroup();
    }

    function estimatingStoreKey() {
        return `takeoff.estimating.module.${window.ProjectState?.projectId || 'draft'}`;
    }

    function loadEstimatingStateForSync() {
        try {
            const parsed = JSON.parse(localStorage.getItem(estimatingStoreKey()) || 'null');
            if (parsed && Array.isArray(parsed.groups)) return parsed;
        } catch (e) {}
        return {
            search: '',
            selected: [],
            fullscreen: false,
            hiddenColumns: [],
            laborUnit: 'mins',
            groups: [],
            estimates: [{ id: 'est_primary', name: 'Primary Estimate', primary: true }],
            activeEstimateId: 'est_primary',
            globalLaborCost: 85,
            globalLaborSales: 110,
            taxes: { Labor: 0, Materials: 0, Equipment: 0 },
            preTaxMarkups: [],
            postTaxMarkups: []
        };
    }

    function estimateLineFromLayer(layer) {
        const group = groupForLayer(layer);
        const hasCatalog = Boolean(layer.catalogItemId || layer.catalog_item_id);
        const estimateGroupName = hasCatalog ? (group?.name || 'Default Group') : 'Default Group';
        const itemType = layer.itemType || layer.item_type || (String(layer.category || '').toLowerCase().includes('labor') ? 'Labor' : 'Materials');
        return {
            id: `takeoff_${layer.id}`,
            takeoffLayerId: String(layer.id),
            catalogItemId: layer.catalogItemId || layer.catalog_item_id || null,
            name: layer.name || 'Takeoff item',
            description: layer.description || '',
            type: itemType,
            budgetCode: layer.catalogNumber || layer.catalog_number || '',
            originalQuantity: Number(layer.quantity || 0),
            quantity: Number(layer.quantity || 0),
            unitCost: Number(layer.unitCost || layer.unit_cost || 0),
            waste: 0,
            margin: 0,
            unitLabor: Number(layer.laborHours || layer.labor_hours || 0),
            laborRate: 85,
            difficulty: 1,
            laborMargin: 0,
            notes: `Synced from Takeoff${group?.name ? ` / ${group.name}` : ''}`,
            taxable: true,
            groupId: hasCatalog ? (group?.id || 'default') : 'default',
            groupName: estimateGroupName,
            uom: layer.uom || typeToUom(layer.type),
            projectId: String(window.ProjectState?.projectId || ''),
            estimateId: ''
        };
    }

    function syncTakeoffToEstimating() {
        const state = loadEstimatingStateForSync();
        const byName = new Map((state.groups || []).map(group => [group.name, group]));
        const syncedLayerIds = new Set();
        allLayers().forEach(layer => {
            const line = estimateLineFromLayer(layer);
            syncedLayerIds.add(String(layer.id));
            let group = byName.get(line.groupName);
            if (!group) {
                group = { id: makeId('estgrp'), type: 'group', name: line.groupName, expanded: true, items: [] };
                state.groups.push(group);
                byName.set(group.name, group);
            }
            const existing = (state.groups || [])
                .flatMap(candidate => candidate.items || [])
                .find(item => String(item.takeoffLayerId || '') === String(layer.id));
            if (existing) {
                const hasManualOverride = Boolean(existing.quantityOverride) || ['modified', 'detached', 'takeoff_changed'].includes(String(existing.quantitySyncStatus || ''));
                const quantityPatch = hasManualOverride && Number(existing.quantity || 0) !== Number(line.quantity || 0)
                    ? {
                        pendingTakeoffQuantity: line.quantity,
                        quantitySyncStatus: 'takeoff_changed',
                        lastSyncedTakeoffQuantity: Number(existing.lastSyncedTakeoffQuantity ?? existing.quantity ?? 0)
                    }
                    : {
                        originalQuantity: line.quantity,
                        quantity: line.quantity,
                        pendingTakeoffQuantity: null,
                        quantityOverride: false,
                        quantitySyncStatus: 'synced',
                        lastSyncedTakeoffQuantity: line.quantity
                    };
                Object.assign(existing, {
                    catalogItemId: line.catalogItemId,
                    name: line.name,
                    description: line.description,
                    type: line.type,
                    budgetCode: line.budgetCode,
                    unitCost: line.unitCost,
                    unitLabor: line.unitLabor,
                    notes: line.notes,
                    uom: line.uom,
                    groupId: group.id,
                    groupName: group.name,
                    quantitySource: 'takeoff',
                    catalogSyncStatus: line.catalogItemId ? (existing.catalogSyncStatus || 'synced') : 'detached',
                    updatedAt: new Date().toISOString()
                }, quantityPatch);
                if (!group.items.includes(existing)) {
                    state.groups.forEach(candidate => {
                        candidate.items = (candidate.items || []).filter(item => item !== existing);
                    });
                    group.items.push(existing);
                }
            } else {
                group.items.push(line);
            }
        });
        state.groups.forEach(group => {
            group.items = (group.items || []).filter(item => !item.takeoffLayerId || syncedLayerIds.has(String(item.takeoffLayerId)));
        });
        try {
            localStorage.setItem(estimatingStoreKey(), JSON.stringify(state));
            window.dispatchEvent(new CustomEvent('takeoff:estimating-lines-updated', { detail: { groups: state.groups } }));
        } catch (e) {
            console.warn('Estimating sync failed', e);
        }
    }

    function layerCanvasPayload(layer) {
        return {
            id: layer.id,
            name: layer.name,
            takeoff_type: layer.type.toLowerCase(),
            type: layer.type.toLowerCase(),
            unit_of_measure: layer.uom,
            uom: layer.uom,
            symbol: layer.symbol,
            symbol_size: layer.size,
            size: layer.size,
            color: layer.color,
            quantity: layer.quantity,
            baseQuantity: layer.baseQuantity || 0,
            catalog_item_id: layer.catalogItemId || null,
            unit_cost: layer.unitCost || 0,
            labor_hours: layer.laborHours || 0,
            category: layer.category || '',
            description: layer.description || '',
            dropLength: layer.dropLength || 0,
            spacing: layer.spacing || 0,
            height: layer.height || 0,
            depth: layer.depth || 0,
            visible: layer.visible !== false
        };
    }

    function syncAllLayersToCanvas() {
        const payload = allLayers().map(layerCanvasPayload);
        const snapshot = callEditor('projectTakeoffSyncLayers', payload);
        if (snapshot) syncTakeoffFromCanvasSnapshot(snapshot);
    }

    function quantityLabel(layer) {
        const qty = Number(layer.quantity || 0);
        return `${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)} ${layer.uom}`;
    }

    function symbolGlyph(layer) {
        if (isLinearType(layer.type)) return '<i class="fas fa-minus"></i>';
        if (isAreaType(layer.type)) return '<i class="far fa-square"></i>';
        const map = {
            'Solid Circle': '<i class="fas fa-circle"></i>',
            'Hollow Circle': '<i class="far fa-circle"></i>',
            Square: '<i class="fas fa-square"></i>',
            Triangle: '<i class="fas fa-play fa-rotate-270"></i>',
            Diamond: '<i class="fas fa-diamond"></i>',
            Cross: '<i class="fas fa-xmark"></i>'
        };
        return map[layer.symbol] || '<i class="fas fa-circle"></i>';
    }

    function isLinearType(type) {
        return ['Linear', 'Linear with drop', 'Linear avg. with drop'].includes(type);
    }

    function isAreaType(type) {
        return ['Area', 'Area / Volume', 'Vertical wall area'].includes(type);
    }

    function renderTakeoffPanel() {
        const tree = $('takeoffItemsTree');
        const title = $('takeoffPanelTitle');
        const activeLabel = $('takeoffActiveLayerLabel');
        if (!tree) return;
        const q = takeoffState.query;
        const layersCount = allLayers().length;
        if (title) title.textContent = `Takeoffs (${layersCount})`;
        const activeLayer = findLayer(takeoffState.activeLayerId);
        if (activeLabel) activeLabel.textContent = activeLayer ? activeLayer.name : 'None';
        renderActiveLayerToolbar();
        renderInspector();
        renderWorkspaceSummary();
        tree.innerHTML = takeoffState.groups.map(group => {
            const visibleLayers = (group.layers || []).filter(layer => {
                if (!q) return true;
                return group.name.toLowerCase().includes(q) || layer.name.toLowerCase().includes(q) || layer.type.toLowerCase().includes(q);
            });
            const groupVisible = !q || group.name.toLowerCase().includes(q) || visibleLayers.length > 0;
            if (!groupVisible) return '';
            const expanded = q ? true : group.isExpanded !== false;
            const groupCheckboxVisible = (group.layers || []).some(layer => layer.visible !== false) || !(group.layers || []).length;
            return `<div class="pro-takeoff-group" data-group-id="${esc(group.id)}">
                <div class="pro-tree-row pro-tree-folder ${takeoffState.activeGroupId === group.id ? 'active' : ''}" data-takeoff-group-row="${esc(group.id)}">
                    <button class="pro-tree-toggle" type="button" data-group-toggle="${esc(group.id)}"><i class="fas ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i></button>
                    <input type="checkbox" ${groupCheckboxVisible ? 'checked' : ''} aria-label="Group visibility" data-group-visible="${esc(group.id)}">
                    <span class="pro-tree-name"><i class="fas fa-folder${expanded ? '-open' : ''}"></i> ${esc(group.name)}</span>
                    <span class="pro-tree-qty">${group.layers.length}</span>
                    <button class="pro-row-menu-btn" type="button" data-group-menu="${esc(group.id)}"><i class="fas fa-ellipsis-vertical"></i></button>
                </div>
                <div class="pro-tree-children" ${expanded ? '' : 'hidden'}>
                    ${visibleLayers.map(layer => {
                        const isVisible = layer.visible !== false;
                        const metadata = layer.catalogItemId ? 'Linked to catalog' : (layer.category || layer.description || '');
                        return `<div class="pro-tree-row pro-tree-item ${takeoffState.activeLayerId === layer.id ? 'active' : ''} ${isVisible ? '' : 'is-hidden'}" data-layer-row="${esc(layer.id)}">
                            <button class="pro-visibility-btn ${isVisible ? '' : 'is-off'}" type="button" data-layer-visibility="${esc(layer.id)}" title="${isVisible ? 'Hide item' : 'Show item'}" aria-label="${isVisible ? 'Hide item' : 'Show item'}"><i class="fas ${isVisible ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                            <input class="pro-layer-active-check" type="checkbox" ${takeoffState.activeLayerId === layer.id ? 'checked' : ''} aria-label="Set active layer" data-layer-active="${esc(layer.id)}">
                            <span class="pro-layer-symbol" style="color:${esc(layer.color)}">${symbolGlyph(layer)}</span>
                            <span class="pro-tree-name" title="${esc(layer.name)}">${esc(layer.name)}</span>
                            <span class="pro-tree-qty">${esc(quantityLabel(layer))}</span>
                            <button class="pro-row-menu-btn" type="button" data-layer-menu="${esc(layer.id)}"><i class="fas fa-ellipsis-vertical"></i></button>
                            <small class="pro-layer-meta ${layer.catalogItemId ? 'pro-catalog-linked' : ''}">${esc(metadata)}</small>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('') || '<div class="pro-drawing-empty">No takeoffs match your search.</div>';
        bindTakeoffTreeEvents();
    }

    function renderInspector() {
        const content = $('takeoffInspectorContent');
        if (!content) return;
        const selectionCount = selectionState.selectedObjectIds.length;
        const layer = findLayer(selectionCount ? selectionState.activeLayerId : takeoffState.activeLayerId);
        if (!layer) {
            content.innerHTML = `<div class="pro-inspector-empty">
                <i class="fas fa-arrow-pointer"></i>
                <strong>No takeoff selected</strong>
                <span>Select a layer or an element on the drawing to review its properties and metrics.</span>
            </div>`;
            return;
        }
        const group = groupForLayer(layer);
        content.innerHTML = `
            <section class="pro-property-card">
                <div class="pro-property-title">
                    <span class="pro-color-dot" style="background:${esc(layer.color)}"></span>
                    <span><strong>${esc(layer.name)}</strong><small>${esc(group?.name || 'Ungrouped')}</small></span>
                </div>
                <span class="pro-status-pill"><i class="fas fa-circle-check"></i>${layer.visible === false ? 'Inactive' : 'Active'}</span>
            </section>
            <section class="pro-property-card">
                <h3>Takeoff metrics</h3>
                <div class="pro-property-row"><span>Quantity</span><strong>${esc(quantityLabel(layer))}</strong></div>
                <div class="pro-property-row"><span>Type</span><strong>${esc(layer.type)}</strong></div>
                <div class="pro-property-row"><span>Unit</span><strong>${esc(layer.uom || typeToUom(layer.type))}</strong></div>
                <div class="pro-property-row"><span>Selected</span><strong>${selectionCount} element${selectionCount === 1 ? '' : 's'}</strong></div>
            </section>
            <section class="pro-property-card">
                <h3>Estimate link</h3>
                <div class="pro-property-row"><span>Catalog</span><strong>${layer.catalogItemId ? 'Linked' : 'Not linked'}</strong></div>
                <div class="pro-property-row"><span>Unit cost</span><strong>$${Number(layer.unitCost || layer.unit_cost || 0).toFixed(2)}</strong></div>
                <div class="pro-property-row"><span>Labor hours</span><strong>${Number(layer.laborHours || layer.labor_hours || 0).toFixed(2)}</strong></div>
            </section>`;
    }

    function bindTakeoffTreeEvents() {
        document.querySelectorAll('[data-takeoff-group-row]').forEach(row => {
            row.addEventListener('click', event => {
                if (event.target.closest('button')) return;
                takeoffState.activeGroupId = row.dataset.takeoffGroupRow;
                saveTakeoffState();
                renderTakeoffPanel();
            });
        });
        document.querySelectorAll('[data-group-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const group = findGroup(button.dataset.groupToggle);
                group.isExpanded = group.isExpanded === false;
                saveTakeoffState();
                renderTakeoffPanel();
            });
        });
        document.querySelectorAll('[data-group-visible]').forEach(box => {
            box.addEventListener('click', event => event.stopPropagation());
            box.addEventListener('change', () => toggleGroupVisibility(box.dataset.groupVisible, box.checked));
        });
        document.querySelectorAll('[data-layer-row]').forEach(row => {
            row.addEventListener('click', event => {
                if (event.target.closest('button') || event.target.closest('input')) return;
                if (takeoffState.activeLayerId === row.dataset.layerRow) clearActiveTakeoffLayer();
                else setActiveTakeoffLayer(row.dataset.layerRow);
            });
        });
        document.querySelectorAll('[data-layer-visibility]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const layer = findLayer(button.dataset.layerVisibility);
                if (layer) toggleLayerVisibility(layer.id, layer.visible === false);
            });
        });
        document.querySelectorAll('[data-layer-active]').forEach(box => {
            box.addEventListener('click', event => event.stopPropagation());
            box.addEventListener('change', () => {
                if (box.checked) setActiveTakeoffLayer(box.dataset.layerActive);
                else if (takeoffState.activeLayerId === box.dataset.layerActive) clearActiveTakeoffLayer();
                else renderTakeoffPanel();
            });
        });
        document.querySelectorAll('[data-group-menu]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                openTakeoffContextMenu(button, 'group', button.dataset.groupMenu);
            });
        });
        document.querySelectorAll('[data-layer-menu]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                openTakeoffContextMenu(button, 'layer', button.dataset.layerMenu);
            });
        });
    }

    function initTakeoffState() {
        const saved = readSavedTakeoffs();
        takeoffState.groups = normalizeSavedGroups(saved?.groups || seedGroupsFromProjectLayers());
        takeoffState.activeGroupId = saved?.activeGroupId || 'default';
        takeoffState.activeLayerId = saved?.activeLayerId || null;
        takeoffState.canvasSnapshots = saved?.canvasSnapshots && typeof saved.canvasSnapshots === 'object' ? saved.canvasSnapshots : {};
        takeoffState.annotations = Array.isArray(saved?.annotations) ? saved.annotations : [];
        takeoffState.pins = Array.isArray(saved?.pins) ? saved.pins : [];
        takeoffState.snapshots = Array.isArray(saved?.snapshots) ? saved.snapshots : [];
        takeoffState.compare = saved?.compare || null;
        takeoffState.globalVisible = saved?.globalVisible !== false;
        applyAggregatedCanvasQuantities();
        if (!findGroup(takeoffState.activeGroupId)) takeoffState.activeGroupId = 'default';
        if (takeoffState.activeLayerId && !findLayer(takeoffState.activeLayerId)) takeoffState.activeLayerId = null;
        ensureTakeoffModal();
        ensureTakeoffOverlays();
        renderTakeoffPanel();
        renderActiveLayerToolbar();
        syncTakeoffToEstimating();
    }

    function ensureTakeoffModal() {
        if ($('takeoffLayerModal')) return;
        const modal = document.createElement('div');
        modal.id = 'takeoffLayerModal';
        modal.className = 'pro-modal-backdrop';
        modal.hidden = true;
        modal.innerHTML = `<div class="pro-layer-modal" role="dialog" aria-modal="true" aria-labelledby="takeoffLayerModalTitle">
            <div class="pro-layer-modal-head">
                <h3 id="takeoffLayerModalTitle">Create new takeoff layer</h3>
                <button class="pro-icon-btn" type="button" data-layer-modal-close aria-label="Close"><i class="fas fa-times"></i></button>
            </div>
            <div class="pro-layer-form">
                <div class="pro-field pro-field-wide">
                    <label for="layerNameInput">Catalog Item Name</label>
                    <div class="pro-input-action">
                        <input id="layerNameInput" type="text" placeholder="Enter item name">
                        <button class="pro-create-layer-btn" type="button" data-takeoff-action="browse-catalog">Browse Catalog</button>
                    </div>
                    <div class="pro-catalog-selected" id="layerCatalogSelected" hidden></div>
                </div>
                <div class="pro-field pro-field-wide">
                    <label for="layerTypeInput">Takeoff Type</label>
                    <select id="layerTypeInput">${TAKEOFF_TYPES.map(type => `<option>${type}</option>`).join('')}</select>
                    <p id="layerTypeHelp">${TAKEOFF_TYPE_HELP.Count}</p>
                </div>
                <div class="pro-layer-field-grid">
                    <div class="pro-field"><label for="layerUomInput">UoM</label><select id="layerUomInput">${TAKEOFF_UOMS.map(uom => `<option>${uom}</option>`).join('')}</select></div>
                    <div class="pro-field"><label for="layerSymbolInput">Symbol</label><select id="layerSymbolInput">${TAKEOFF_SYMBOLS.map(symbol => `<option>${symbol}</option>`).join('')}</select></div>
                    <div class="pro-field"><label for="layerSizeInput">Size</label><select id="layerSizeInput">${TAKEOFF_SIZES.map(size => `<option>${size}</option>`).join('')}</select></div>
                    <div class="pro-field">
                        <label for="layerColorInput">Color</label>
                        <div class="pro-color-select">
                            <span id="layerColorSwatch"></span>
                            <select id="layerColorInput">${TAKEOFF_COLORS.map(color => `<option value="${color.value}">${color.label}</option>`).join('')}</select>
                        </div>
                    </div>
                </div>
                <div class="pro-layer-field-grid pro-layer-type-fields" id="layerTypeFields">
                    <div class="pro-field" data-type-field="drop"><label for="layerDropInput">Drop length (ft)</label><input id="layerDropInput" type="number" min="0" step="0.1" placeholder="0"></div>
                    <div class="pro-field" data-type-field="spacing"><label for="layerSpacingInput">Spacing (ft)</label><input id="layerSpacingInput" type="number" min="0.1" step="0.1" placeholder="5"></div>
                    <div class="pro-field" data-type-field="height"><label for="layerHeightInput">Height (ft)</label><input id="layerHeightInput" type="number" min="0" step="0.1" placeholder="0"></div>
                    <div class="pro-field" data-type-field="depth"><label for="layerDepthInput">Depth (ft)</label><input id="layerDepthInput" type="number" min="0" step="0.1" placeholder="0"></div>
                </div>
            </div>
            <div class="pro-layer-modal-actions">
                <button class="pro-toolbar-btn" type="button" data-layer-modal-close>Cancel</button>
                <button class="pro-create-layer-btn" type="button" id="layerCreateSubmit" disabled>Create</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('[data-layer-modal-close]').forEach(btn => btn.addEventListener('click', closeLayerModal));
        $('layerNameInput').addEventListener('input', updateLayerSubmitState);
        modal.querySelector('[data-takeoff-action="browse-catalog"]')?.addEventListener('click', event => {
            event.stopPropagation();
            openCatalogModal();
        });
        $('layerTypeInput').addEventListener('change', () => {
            const type = $('layerTypeInput').value;
            $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[type] || TAKEOFF_TYPE_HELP.Count;
            $('layerUomInput').value = typeToUom(type);
            updateLayerTypeFields(type);
            updateLayerSubmitState();
        });
        $('layerColorInput').addEventListener('change', updateLayerColorSwatch);
        $('layerCreateSubmit').addEventListener('click', submitLayerModal);
        ensureCatalogModal();
    }

    function updateLayerTypeFields(type = $('layerTypeInput')?.value || 'Count') {
        document.querySelectorAll('[data-type-field]').forEach(field => {
            const name = field.dataset.typeField;
            const visible = (
                (name === 'drop' && ['Linear with drop', 'Linear avg. with drop'].includes(type)) ||
                (name === 'spacing' && type === 'Count by distance') ||
                (name === 'height' && ['Area / Volume', 'Vertical wall area'].includes(type)) ||
                (name === 'depth' && type === 'Area / Volume')
            );
            field.toggleAttribute('hidden', !visible);
        });
        const symbolField = $('layerSymbolInput')?.closest('.pro-field');
        const sizeField = $('layerSizeInput')?.closest('.pro-field');
        if (symbolField) symbolField.toggleAttribute('hidden', type !== 'Count' && type !== 'Count by distance');
        if (sizeField) sizeField.toggleAttribute('hidden', !['Count', 'Count by distance'].includes(type));
    }

    function openLayerModal(groupId = takeoffState.activeGroupId, layerId = null) {
        ensureTakeoffModal();
        const layer = layerId ? findLayer(layerId) : null;
        takeoffState.pendingLayerGroupId = groupId || layer?.groupId || takeoffState.activeGroupId || 'default';
        takeoffState.editingLayerId = layerId;
        takeoffState.pendingCatalogItem = layer?.catalogItemId ? {
            id: layer.catalogItemId,
            name: layer.name,
            unit_of_measure: layer.uom,
            unit_cost: layer.unitCost,
            labor_hours: layer.laborHours,
            catalog_name: layer.category,
            group_name: layer.category,
            description: layer.description
        } : null;
        $('takeoffLayerModalTitle').textContent = layer ? 'Edit takeoff layer' : 'Create new takeoff layer';
        $('layerNameInput').value = layer?.name || '';
        $('layerTypeInput').value = layer?.type || 'Count';
        $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[$('layerTypeInput').value] || TAKEOFF_TYPE_HELP.Count;
        setSelectValue($('layerUomInput'), layer?.uom || typeToUom($('layerTypeInput').value));
        $('layerSymbolInput').value = layer?.symbol || 'Solid Circle';
        $('layerSizeInput').value = layer?.size || 'Medium';
        $('layerColorInput').value = layer?.color || '#111827';
        $('layerDropInput').value = layer?.dropLength || '';
        $('layerSpacingInput').value = layer?.spacing || '';
        $('layerHeightInput').value = layer?.height || '';
        $('layerDepthInput').value = layer?.depth || '';
        $('layerCreateSubmit').textContent = layer ? 'Save' : 'Create';
        updateCatalogSelectionIndicator();
        updateLayerColorSwatch();
        updateLayerTypeFields($('layerTypeInput').value);
        updateLayerSubmitState();
        $('takeoffLayerModal').hidden = false;
        setTimeout(() => $('layerNameInput')?.focus(), 40);
    }

    function closeLayerModal() {
        const modal = $('takeoffLayerModal');
        if (modal) modal.hidden = true;
        takeoffState.editingLayerId = null;
        takeoffState.pendingCatalogItem = null;
    }

    function updateLayerColorSwatch() {
        const swatch = $('layerColorSwatch');
        if (swatch) swatch.style.background = $('layerColorInput')?.value || '#111827';
    }

    function updateLayerSubmitState() {
        const submit = $('layerCreateSubmit');
        if (submit) submit.disabled = !$('layerNameInput')?.value.trim();
    }

    function updateCatalogSelectionIndicator() {
        const box = $('layerCatalogSelected');
        if (!box) return;
        const item = takeoffState.pendingCatalogItem;
        box.hidden = !item;
        if (!item) {
            box.innerHTML = '';
            return;
        }
        box.innerHTML = `<i class="fas fa-link"></i>
            <span>Linked to catalog: <strong>${esc(item.name || 'Catalog item')}</strong></span>`;
    }

    function catalogItemMeta(item) {
        return {
            catalogItemId: item?.id || null,
            catalog_item_id: item?.id || null,
            unitCost: Number(item?.unit_cost || 0),
            unit_cost: Number(item?.unit_cost || 0),
            laborHours: Number(item?.labor_hours || 0),
            labor_hours: Number(item?.labor_hours || 0),
            category: item?.group_name || item?.catalog_name || '',
            description: item?.description || '',
            catalogName: item?.catalog_name || '',
            catalogGroupName: item?.group_name || '',
            catalogNumber: item?.catalog_number || item?.sku || item?.cost_code || '',
            itemType: item?.item_type || ''
        };
    }

    function applyCatalogItemToLayerForm(item) {
        if (!item) return;
        takeoffState.pendingCatalogItem = item;
        $('layerNameInput').value = item.name || '';
        setSelectValue($('layerUomInput'), item.unit_of_measure || 'ea');
        const inferred = inferTakeoffTypeFromUom(item.unit_of_measure);
        if (inferred) {
            $('layerTypeInput').value = inferred;
            $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[inferred];
        }
        if (item.symbol && TAKEOFF_SYMBOLS.includes(item.symbol)) $('layerSymbolInput').value = item.symbol;
        if (item.color && TAKEOFF_COLORS.some(color => color.value.toLowerCase() === String(item.color).toLowerCase())) {
            $('layerColorInput').value = item.color;
            updateLayerColorSwatch();
        }
        updateCatalogSelectionIndicator();
        updateLayerSubmitState();
        closeCatalogModal();
        setTimeout(() => $('layerCreateSubmit')?.focus(), 40);
    }

    function submitLayerModal() {
        const name = $('layerNameInput')?.value.trim();
        if (!name) return;
        pushTakeoffHistory(takeoffState.editingLayerId ? 'edit-layer' : 'create-layer');
        const type = $('layerTypeInput').value;
        const payload = {
            name,
            type,
            uom: $('layerUomInput').value || typeToUom(type),
            symbol: $('layerSymbolInput').value || 'Solid Circle',
            size: $('layerSizeInput').value || 'Medium',
            color: $('layerColorInput').value || '#111827',
            dropLength: Number($('layerDropInput')?.value || 0),
            spacing: Number($('layerSpacingInput')?.value || 0),
            height: Number($('layerHeightInput')?.value || 0),
            depth: Number($('layerDepthInput')?.value || 0)
        };
        if (takeoffState.pendingCatalogItem) Object.assign(payload, catalogItemMeta(takeoffState.pendingCatalogItem));
        if (takeoffState.editingLayerId) {
            const layer = findLayer(takeoffState.editingLayerId);
            if (layer) Object.assign(layer, payload);
            setActiveTakeoffLayer(takeoffState.editingLayerId, false);
        } else {
            const group = findGroup(takeoffState.pendingLayerGroupId);
            const layer = {
                id: makeId('layer'),
                groupId: group.id,
                quantity: 0,
                ...payload
            };
            group.layers.push(layer);
            group.isExpanded = true;
            takeoffState.activeGroupId = group.id;
            setActiveTakeoffLayer(layer.id, false);
        }
        closeLayerModal();
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function ensureCatalogModal() {
        if ($('takeoffCatalogModal')) return;
        const modal = document.createElement('div');
        modal.id = 'takeoffCatalogModal';
        modal.className = 'pro-modal-backdrop pro-catalog-backdrop';
        modal.hidden = true;
        modal.innerHTML = `<div class="pro-catalog-modal" role="dialog" aria-modal="true" aria-labelledby="takeoffCatalogModalTitle">
            <div class="pro-layer-modal-head">
                <h3 id="takeoffCatalogModalTitle">Browse Catalog</h3>
                <button class="pro-icon-btn" type="button" data-catalog-close aria-label="Close"><i class="fas fa-times"></i></button>
            </div>
            <div class="pro-catalog-toolbar">
                <div class="pro-field">
                    <label for="takeoffCatalogSearch">Search catalog items</label>
                    <input id="takeoffCatalogSearch" type="search" placeholder="Search catalog items...">
                </div>
                <div class="pro-field">
                    <label for="takeoffCatalogCategory">Category</label>
                    <select id="takeoffCatalogCategory"><option value="">All categories</option></select>
                </div>
                <div class="pro-field">
                    <label for="takeoffCatalogUom">UoM</label>
                    <select id="takeoffCatalogUom"><option value="">All UoM</option></select>
                </div>
                <a class="pro-toolbar-btn" href="/pages/cost_catalog.php" target="_blank" rel="noopener">
                    <i class="fas fa-arrow-up-right-from-square"></i> Open Cost Catalog
                </a>
            </div>
            <div class="pro-catalog-status" id="takeoffCatalogStatus" hidden></div>
            <div class="pro-catalog-table-wrap">
                <table class="pro-catalog-table">
                    <thead>
                        <tr>
                            <th>Item Name</th>
                            <th>Category</th>
                            <th>UoM</th>
                            <th>Unit Cost</th>
                            <th>Labor Hours</th>
                            <th>Description</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="takeoffCatalogRows"></tbody>
                </table>
            </div>
        </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('[data-catalog-close]').forEach(btn => btn.addEventListener('click', closeCatalogModal));
        modal.addEventListener('click', event => {
            if (event.target.id === 'takeoffCatalogModal') closeCatalogModal();
        });
        $('takeoffCatalogSearch')?.addEventListener('input', event => {
            clearTimeout(event.target._catalogTimer);
            event.target._catalogTimer = setTimeout(() => {
                catalogState.query = event.target.value.trim().toLowerCase();
                renderCatalogBrowser();
            }, 120);
        });
        $('takeoffCatalogCategory')?.addEventListener('change', event => {
            catalogState.category = event.target.value;
            renderCatalogBrowser();
        });
        $('takeoffCatalogUom')?.addEventListener('change', event => {
            catalogState.uom = event.target.value;
            renderCatalogBrowser();
        });
    }

    function openCatalogModal() {
        ensureTakeoffModal();
        ensureCatalogModal();
        $('takeoffCatalogModal').hidden = false;
        renderCatalogBrowser();
        loadCatalogItems();
        setTimeout(() => $('takeoffCatalogSearch')?.focus(), 40);
    }

    function closeCatalogModal() {
        const modal = $('takeoffCatalogModal');
        if (modal) modal.hidden = true;
    }

    async function loadCatalogItems() {
        if (catalogState.loaded || catalogState.loading) return;
        catalogState.loading = true;
        catalogState.error = '';
        renderCatalogBrowser();
        try {
            const response = await fetch('../api/cost_catalog.php?action=list&view=all', { headers: { Accept: 'application/json' } });
            const json = await response.json();
            if (!response.ok || json.status !== 'success') throw new Error(json.msg || 'Unable to load Cost Catalog');
            catalogState.catalogs = json.data?.catalogs || [];
            catalogState.groups = json.data?.groups || [];
            catalogState.items = json.data?.allItems || json.data?.items || [];
            catalogState.loaded = true;
            populateCatalogFilters();
        } catch (e) {
            console.warn('Cost Catalog load failed', e);
            catalogState.error = e.message || 'Unable to load Cost Catalog';
        } finally {
            catalogState.loading = false;
            renderCatalogBrowser();
        }
    }

    function populateCatalogFilters() {
        const categorySelect = $('takeoffCatalogCategory');
        const uomSelect = $('takeoffCatalogUom');
        if (categorySelect) {
            const categories = Array.from(new Set(catalogState.items.map(item => item.group_name || item.catalog_name || '').filter(Boolean))).sort();
            categorySelect.innerHTML = '<option value="">All categories</option>' + categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
            categorySelect.value = catalogState.category;
        }
        if (uomSelect) {
            const uoms = Array.from(new Set(catalogState.items.map(item => item.unit_of_measure || '').filter(Boolean))).sort();
            uomSelect.innerHTML = '<option value="">All UoM</option>' + uoms.map(uom => `<option value="${esc(uom)}">${esc(uom)}</option>`).join('');
            uomSelect.value = catalogState.uom;
        }
    }

    function catalogSearchMatch(item) {
        const category = item.group_name || item.catalog_name || '';
        if (catalogState.category && category !== catalogState.category) return false;
        if (catalogState.uom && String(item.unit_of_measure || '') !== catalogState.uom) return false;
        const q = catalogState.query;
        if (!q) return true;
        return [
            item.name,
            item.description,
            item.catalog_name,
            item.group_name,
            item.sku,
            item.catalog_number,
            item.cost_code,
            item.unit_of_measure,
            item.item_type,
            item.manufacturer,
            item.supplier
        ].join(' ').toLowerCase().includes(q);
    }

    function money(value) {
        const number = Number(value || 0);
        return number ? `$${number.toFixed(2)}` : '-';
    }

    function renderCatalogBrowser() {
        const rows = $('takeoffCatalogRows');
        const status = $('takeoffCatalogStatus');
        if (!rows || !status) return;
        if (catalogState.loading) {
            status.hidden = false;
            status.textContent = 'Loading Cost Catalog...';
            rows.innerHTML = '';
            return;
        }
        if (catalogState.error) {
            status.hidden = false;
            status.innerHTML = `${esc(catalogState.error)} <button class="pro-toolbar-btn" type="button" data-catalog-retry>Retry</button>`;
            status.querySelector('[data-catalog-retry]')?.addEventListener('click', () => {
                catalogState.loaded = false;
                loadCatalogItems();
            });
            rows.innerHTML = '';
            return;
        }
        status.hidden = true;
        const items = catalogState.items.filter(catalogSearchMatch);
        if (!catalogState.loaded) {
            rows.innerHTML = '';
            return;
        }
        if (!items.length) {
            rows.innerHTML = `<tr><td colspan="7">
                <div class="pro-catalog-empty">
                    <strong>No catalog items found</strong>
                    <span>Add items in Cost Catalog before selecting them for takeoff layers.</span>
                    <a class="pro-toolbar-btn" href="/pages/cost_catalog.php" target="_blank" rel="noopener">Open Cost Catalog</a>
                </div>
            </td></tr>`;
            return;
        }
        rows.innerHTML = items.slice(0, 250).map(item => {
            const category = item.group_name || item.catalog_name || '-';
            return `<tr data-catalog-item="${esc(item.id)}">
                <td>
                    <strong>${esc(item.name)}</strong>
                    <small>${esc(item.catalog_number || item.sku || item.cost_code || '')}</small>
                </td>
                <td>${esc(category)}</td>
                <td>${esc(item.unit_of_measure || 'ea')}</td>
                <td>${money(item.unit_cost)}</td>
                <td>${Number(item.labor_hours || 0).toFixed(4)}</td>
                <td>${esc(item.description || item.item_type || '-')}</td>
                <td><button class="pro-create-layer-btn" type="button" data-catalog-select="${esc(item.id)}">Select</button></td>
            </tr>`;
        }).join('');
        rows.querySelectorAll('[data-catalog-item]').forEach(row => {
            row.addEventListener('click', event => {
                const id = event.target.closest('[data-catalog-select]')?.dataset.catalogSelect || row.dataset.catalogItem;
                const item = catalogState.items.find(candidate => String(candidate.id) === String(id));
                if (item) applyCatalogItemToLayerForm(item);
            });
        });
    }

    function createTakeoffGroup() {
        const name = prompt('Group name', 'New Group');
        if (!name || !name.trim()) return;
        pushTakeoffHistory('create-group');
        const group = { id: makeId('grp'), name: name.trim(), isExpanded: true, isDefault: false, layers: [] };
        takeoffState.groups.push(group);
        takeoffState.activeGroupId = group.id;
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function collapseAllTakeoffGroups() {
        takeoffState.groups.forEach(group => { group.isExpanded = false; });
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function duplicateGroup(groupId) {
        const group = findGroup(groupId);
        pushTakeoffHistory('duplicate-group');
        const copy = {
            id: makeId('grp'),
            name: `${group.name} Copy`,
            isExpanded: true,
            isDefault: false,
            layers: (group.layers || []).map(layer => ({ ...layer, id: makeId('layer'), groupId: null, quantity: 0, baseQuantity: 0, shapes: [], takeoffObjects: [] }))
        };
        copy.layers.forEach(layer => { layer.groupId = copy.id; });
        takeoffState.groups.push(copy);
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function deleteGroup(groupId) {
        const group = findGroup(groupId);
        if (!group || group.isDefault) return;
        if (group.layers.length && !confirm('Delete this group and its takeoff layers?')) return;
        pushTakeoffHistory('delete-group');
        takeoffState.groups = takeoffState.groups.filter(item => item.id !== group.id);
        if (takeoffState.activeGroupId === group.id) takeoffState.activeGroupId = 'default';
        if (group.layers.some(layer => layer.id === takeoffState.activeLayerId)) takeoffState.activeLayerId = null;
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function renameGroup(groupId) {
        const group = findGroup(groupId);
        if (!group) return;
        const name = prompt('Rename group', group.name);
        if (!name || !name.trim()) return;
        pushTakeoffHistory('rename-group');
        group.name = group.isDefault ? 'Default Group' : name.trim();
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function deleteLayer(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        if (!confirm('Delete this takeoff layer?')) return;
        pushTakeoffHistory('delete-layer');
        callEditor('projectTakeoffDeleteLayer', layer.id);
        const group = findGroup(layer.groupId);
        group.layers = group.layers.filter(item => item.id !== layerId);
        if (takeoffState.activeLayerId === layerId) takeoffState.activeLayerId = null;
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function duplicateLayer(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        pushTakeoffHistory('duplicate-layer');
        const group = findGroup(layer.groupId);
        const copy = { ...layer, id: makeId('layer'), name: `${layer.name} Copy`, quantity: 0, baseQuantity: 0, shapes: [], takeoffObjects: [] };
        group.layers.push(copy);
        setActiveTakeoffLayer(copy.id, false);
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function renameLayer(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        const name = prompt('Rename layer', layer.name);
        if (!name || !name.trim()) return;
        pushTakeoffHistory('rename-layer');
        layer.name = name.trim();
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function changeLayerColor(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        const color = prompt('Layer color hex', layer.color);
        if (!color) return;
        pushTakeoffHistory('change-layer-color');
        layer.color = color.trim();
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function moveLayerToGroup(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        const names = takeoffState.groups.map(group => group.name).join(', ');
        const targetName = prompt(`Move to group (${names})`, findGroup(layer.groupId).name);
        const target = takeoffState.groups.find(group => group.name.toLowerCase() === String(targetName || '').trim().toLowerCase());
        if (!target || target.id === layer.groupId) return;
        pushTakeoffHistory('move-layer');
        findGroup(layer.groupId).layers = findGroup(layer.groupId).layers.filter(item => item.id !== layerId);
        layer.groupId = target.id;
        target.layers.push(layer);
        target.isExpanded = true;
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function setActiveTakeoffLayer(layerId, rerender = true) {
        const layer = findLayer(layerId);
        if (!layer) return;

        takeoffState.activeLayerId = layer.id;
        takeoffState.activeGroupId = layer.groupId;
        applyLayerToCanvas(layer);
        saveTakeoffState();
        if (rerender) renderTakeoffPanel();
        renderActiveLayerToolbar();
    }

    function clearActiveTakeoffLayer(rerender = true) {
        takeoffState.activeLayerId = null;
        callEditor('projectTakeoffClearActiveLayer');
        saveTakeoffState();
        if (rerender) renderTakeoffPanel();
        renderActiveLayerToolbar();
    }

    function toggleLayerVisibility(layerId, visible) {
        const layer = findLayer(layerId);
        if (!layer) return;
        layer.visible = Boolean(visible);
        pushTakeoffHistory('toggle-layer-visibility');
        callEditor('projectTakeoffSetLayerVisibility', layer.id, layer.visible);

        saveTakeoffState();
        renderTakeoffPanel();
        syncAllLayersToCanvas();
    }

    function toggleGroupVisibility(groupId, visible) {
        const group = findGroup(groupId);
        if (!group) return;
        pushTakeoffHistory('toggle-group-visibility');
        (group.layers || []).forEach(layer => {
            layer.visible = Boolean(visible);
            callEditor('projectTakeoffSetLayerVisibility', layer.id, layer.visible);
        });
        saveTakeoffState();
        renderTakeoffPanel();
        syncAllLayersToCanvas();
    }

    function applyLayerToCanvas(layer) {
        const win = takeoffWindow();
        if (!win) return;
        syncAllLayersToCanvas();
        const payload = layerCanvasPayload(layer);
        win.__projectActiveTakeoffLayer = payload;
        callEditor('projectTakeoffActivateLayer', payload);
        if (isLinearType(layer.type)) setActiveTool('linear');
        if (isAreaType(layer.type)) setActiveTool('area');
        if (!isLinearType(layer.type) && !isAreaType(layer.type)) setActiveTool('count');
    }

    function syncTakeoffFromCanvasSnapshot(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.layers)) return;
        const doc = activeDrawingDoc();
        const documentId = String(snapshot.drawingId || snapshot.drawing_id || doc?.id || 'active');
        takeoffState.canvasSnapshots[documentId] = {
            ...snapshot,
            documentId,
            updatedAt: Date.now()
        };
        snapshot.layers.forEach(remote => {
            const layer = findLayer(remote.id || remote.layerId);
            if (!layer) return;
            layer.shapes = remote.shapes || [];
            layer.takeoffObjects = remote.shapes || [];
            layer.visible = remote.visible !== false;
            if (remote.unit_of_measure || remote.uom) layer.uom = remote.unit_of_measure || remote.uom;
        });
        applyAggregatedCanvasQuantities();
        if (snapshot.activeLayerId && findLayer(snapshot.activeLayerId)) {
            takeoffState.activeLayerId = snapshot.activeLayerId;
        }
        saveTakeoffState();
        renderTakeoffPanel();
        renderViewerLayersPopover();
        renderActiveLayerToolbar();
    }

    function applyAggregatedCanvasQuantities() {
        const totals = new Map();
        Object.values(takeoffState.canvasSnapshots || {}).forEach(snapshot => {
            (snapshot.layers || []).forEach(remote => {
                const id = String(remote.id || remote.layerId || '');
                if (!id) return;
                const objectTotal = (remote.shapes || remote.takeoffObjects || [])
                    .reduce((sum, obj) => sum + Number(obj.quantityValue || obj.quantity || 0), 0);
                totals.set(id, (totals.get(id) || 0) + objectTotal);
            });
        });
        allLayers().forEach(layer => {
            const base = Number(layer.baseQuantity || 0);
            layer.quantity = base + (totals.get(String(layer.id)) || 0);
        });
    }

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
        const layers = allLayers();
        popover.innerHTML = `<div class="pro-viewer-layers-head">
                <strong>Layers</strong>
                <button class="pro-icon-btn" type="button" data-viewer-layers-close aria-label="Close"><i class="fas fa-times"></i></button>
            </div>
            <div class="pro-viewer-layers-list">
                ${layers.map(layer => `<label class="pro-viewer-layer-row">
                    <input type="checkbox" ${layer.visible === false ? '' : 'checked'} data-viewer-layer-visible="${esc(layer.id)}">
                    <span class="pro-color-dot" style="background:${esc(layer.color)}"></span>
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
        if (viewer && !$('takeoffActiveLayerToolbar')) {
            const toolbar = document.createElement('div');
            toolbar.id = 'takeoffActiveLayerToolbar';
            toolbar.className = 'pro-active-layer-toolbar';
            toolbar.hidden = true;
            viewer.insertBefore(toolbar, shell);
        }
        if (viewer && !$('takeoffSelectionBar')) {
            const bar = document.createElement('div');
            bar.id = 'takeoffSelectionBar';
            bar.className = 'pro-selection-bar';
            bar.hidden = true;
            viewer.insertBefore(bar, shell);
        }
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
        ensureTakeoffOverlays();
        const toolbar = $('takeoffActiveLayerToolbar');
        if (!toolbar) return;
        const layer = findLayer(takeoffState.activeLayerId);
        toolbar.hidden = !layer;
        if (!layer) {
            toolbar.innerHTML = '';
            return;
        }
        let tools = '';
        if (isLinearType(layer.type)) {
            tools = `
                <button type="button" data-layer-tool="linear-straight"><i class="fas fa-grip-lines"></i> Straight</button>
                <button type="button" data-layer-tool="linear-angled"><i class="fas fa-route"></i> Angled</button>
                <button type="button" data-layer-tool="linear-curved"><i class="fas fa-bezier-curve"></i> Curved</button>
                <button type="button" data-layer-tool="linear-freehand"><i class="fas fa-signature"></i> Freehand</button>`;
        } else if (isAreaType(layer.type)) {
            tools = `
                <button type="button" data-layer-tool="area-polygon"><i class="fas fa-draw-polygon"></i> Polygon</button>
                <button type="button" data-layer-tool="auto-area"><i class="fas fa-wand-magic-sparkles"></i> Auto-Area Takeoff</button>`;
        } else {
            tools = `
                <button type="button" data-layer-tool="count-point"><i class="fas fa-circle-dot"></i> Point</button>
                <button type="button" data-layer-tool="auto-count"><i class="fas fa-wand-magic-sparkles"></i> Auto-Count</button>`;
        }
        toolbar.innerHTML = `
            <span class="pro-active-layer-dot" style="background:${esc(layer.color)}"></span>
            <strong>${esc(layer.name)}</strong>
            <small>${esc(layer.type)} · ${esc(quantityLabel(layer))}</small>
            <div>${tools}</div>
        `;
        toolbar.querySelectorAll('[data-layer-tool]').forEach(button => {
            button.addEventListener('click', () => runLayerTool(button.dataset.layerTool));
        });
    }

    function renderSelectionBar() {
        ensureTakeoffOverlays();
        const bar = $('takeoffSelectionBar');
        if (!bar) return;
        const count = selectionState.selectedObjectIds.length;
        bar.hidden = count === 0;
        if (!count) {
            bar.innerHTML = '';
            return;
        }
        bar.innerHTML = `
            <strong>${count} element(s) selected</strong>
            <button type="button" data-selection-action="copy"><i class="fas fa-copy"></i> Copy</button>
            <button type="button" data-selection-action="move"><i class="fas fa-folder-tree"></i> Move To</button>
            <button type="button" data-selection-action="delete"><i class="fas fa-trash"></i> Delete</button>
            <button type="button" class="icon" data-selection-action="clear" aria-label="Clear selection"><i class="fas fa-times"></i></button>
        `;
        bar.querySelectorAll('[data-selection-action]').forEach(button => {
            button.addEventListener('click', () => runSelectionAction(button.dataset.selectionAction));
        });
    }

    function setSelectedObjects(ids = [], layerId = null) {
        selectionState.selectedObjectIds = Array.from(new Set(ids.map(String).filter(Boolean)));
        selectionState.activeLayerId = layerId || selectionState.activeLayerId || takeoffState.activeLayerId;
        renderSelectionBar();
        renderInspector();
    }

    function runSelectionAction(action) {
        if (action === 'clear') {
            setSelectedObjects([]);
            callEditor('projectTakeoffClearSelection');
            return;
        }
        if (!selectionState.selectedObjectIds.length) return showPrepared('Select one or more takeoff objects first.');
        pushTakeoffHistory(`selection-${action}`);
        if (action === 'copy') {
            const copied = callEditor('projectTakeoffCopySelection', selectionState.selectedObjectIds) || callEditor('copySelected');
            if (!copied) showPrepared('Copy selection is ready to be connected.');
        }
        if (action === 'delete') {
            const deleted = callEditor('projectTakeoffDeleteSelection', selectionState.selectedObjectIds) || callEditor('deleteSelected');
            if (!deleted) showPrepared('Delete selection is ready to be connected.');
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
               ${group?.isDefault ? '' : '<button type="button" class="danger" data-menu-act="group-delete"><i class="fas fa-trash"></i> Delete</button>'}`
            : `<button type="button" data-menu-act="layer-edit"><i class="fas fa-sliders"></i> Edit Layer</button>
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
                if (action === 'group-create') openLayerModal(id);
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
        if (action === 'create-group') return createTakeoffGroup();
        if (action === 'create-layer') return openLayerModal(takeoffState.activeGroupId);
        if (action === 'collapse-all') return collapseAllTakeoffGroups();
        if (action === 'toggle-global-visibility') return toggleGlobalVisibility();
        if (action === 'export-excel') return exportTakeoffQuantities();
        if (action === 'browse-catalog') return openCatalogModal();
        if (action === 'upload-drawing') return document.querySelector('[data-tab="documents"]')?.click();
        if (action === 'save-workspace') {
            saveTakeoffState();
            callEditor('projectTakeoffSnapshot');
            return showPrepared('Workspace saved.');
        }
        showPrepared(action);
    }

    function toggleGlobalVisibility() {
        pushTakeoffHistory('toggle-global-visibility');
        takeoffState.globalVisible = !takeoffState.globalVisible;
        allLayers().forEach(layer => {
            layer.visible = takeoffState.globalVisible;
            callEditor('projectTakeoffSetLayerVisibility', layer.id, layer.visible);
        });
        saveTakeoffState();
        renderTakeoffPanel();
        syncAllLayersToCanvas();
        const button = document.querySelector('[data-takeoff-action="toggle-global-visibility"] i');
        if (button) button.className = takeoffState.globalVisible ? 'fas fa-eye' : 'fas fa-eye-slash';
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
        document.querySelectorAll('[data-tool-command]').forEach(button => {
            button.classList.toggle('active', button.dataset.toolCommand === command);
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
            callEditor('projectTakeoffSetTool', command === 'pan' ? 'pan' : 'select');
            setActiveTool(command);
            callEditor('setMode', command === 'pan' ? 'pan' : 'smart');
            document.querySelector('.pro-canvas-shell')?.classList.toggle('is-panning', command === 'pan');
            return;
        }
        const modeMap = {
            smart: 'smart',
            pan: 'smart',
            count: 'smart',
            linear: 'measure',
            area: 'draw',
            measure: 'measure',
            calibrate: 'cal'
        };
        if (modeMap[command]) {
            callEditor('setMode', modeMap[command]);
            setActiveTool(command);
            if (command === 'calibrate') openScalePanel('manual');
            if (command === 'measure') showPrepared("This tool measures distances, but doesn't add to a takeoff. To perform a takeoff, click Add Takeoff in top left corner.");
            if ((command === 'measure' || command === 'linear' || command === 'area') && !hasScaleSet()) openScalePanel();
            return;
        }
        if (command === 'multi-select') {
            callEditor('projectTakeoffSetTool', 'multi-select');
            callEditor('setMode', 'select-rect');
            setActiveTool(command);
            return showPrepared('Drag a rectangle to select takeoff objects.');
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
            callEditor('setMode', 'freehand');
            setActiveTool(command);
            return;
        }
        if (command === 'pin') {
            const added = callEditor('projectTakeoffSetTool', 'pin') || callEditor('setMode', 'pin');
            setActiveTool(command);
            if (!added) showPrepared('Click the drawing to place a reference pin.');
            return;
        }
        if (command === 'text') {
            const added = callEditor('projectTakeoffSetTool', 'text') || callEditor('addText');
            setActiveTool(command);
            if (!added) showPrepared('Click the drawing to add a text annotation.');
            return;
        }
        if (command === 'cloud') {
            callEditor('addCloud');
            setActiveTool(command);
            return;
        }
        if (command === 'stamp') {
            callEditor('toggleStampMenu');
            setActiveTool(command);
            return;
        }
        if (command === 'undo') return undoTakeoff();
        if (command === 'redo') return callEditor('redo');
        if (command === 'delete') return runSelectionAction('delete');
        if (command === 'more') return toggleMoreToolsPanel();
        if (command === 'transform') {
            callEditor('projectTakeoffSetTool', 'transform');
            setActiveTool(command);
            return showPrepared('Transform / Scale tool is ready to be connected.');
        }
        if (command === 'vertices') {
            callEditor('projectTakeoffSetTool', 'vertices');
            setActiveTool(command);
            return showPrepared('Edit vertices tool is ready to be connected.');
        }
    }

    function runViewerCommand(command) {
        if (command === 'zoom-out') return setZoom(currentZoomPercent() - 10);
        if (command === 'zoom-in') return setZoom(currentZoomPercent() + 10);
        if (command === 'fit') {
            const zoom = callEditor('projectTakeoffFitToView') || callEditor('fitPdfToView', true) || currentZoomPercent();
            setTimeout(() => updateZoomUi(zoom || currentZoomPercent()), 40);
            return;
        }
        if (command === 'previous' || command === 'next') return changeActiveSheet(command === 'next' ? 1 : -1);
        if (command === 'fullscreen') {
            const shell = document.querySelector('.pro-canvas-shell');
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

    function showPrepared(command) {
        const old = document.querySelector('.toast-lite');
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.className = 'toast-lite';
        toast.textContent = command.includes('.') ? command : `${command.replace('-', ' ')} is ready to connect.`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2400);
    }

    let activeRowMenuAnchor = null;

    function positionRowMenu(button) {
        const menu = $('takeoffRowMenu');
        if (!menu) return;
        const rect = button.getBoundingClientRect();
        const margin = 8;
        const gap = 6;
        menu.style.left = '0px';
        menu.style.top = '0px';
        menu.style.visibility = 'hidden';
        menu.classList.add('open');
        const menuRect = menu.getBoundingClientRect();
        let left = rect.right - menuRect.width;
        let top = rect.bottom + gap;
        if (top + menuRect.height > window.innerHeight - margin) {
            top = rect.top - menuRect.height - gap;
        }
        left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - menuRect.height - margin));
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        menu.style.visibility = 'visible';
    }

    function toggleRowMenu(button) {
        const menu = $('takeoffRowMenu');
        if (!menu) return;
        const isSameOpen = menu.classList.contains('open') && activeRowMenuAnchor === button;
        document.querySelectorAll('.pro-row-menu').forEach(item => item.classList.remove('open'));
        if (isSameOpen) {
            activeRowMenuAnchor = null;
            return;
        }
        activeRowMenuAnchor = button;
        positionRowMenu(button);
    }

    function refreshOpenRowMenu() {
        const menu = $('takeoffRowMenu');
        if (!menu?.classList.contains('open') || !activeRowMenuAnchor?.isConnected) return;
        positionRowMenu(activeRowMenuAnchor);
    }

    function editorDocument() {
        const win = takeoffWindow();
        try {
            return win?.document || null;
        } catch (e) {
            return null;
        }
    }

    function syncScaleStatus() {
        const scaleText = (editorDocument()?.getElementById('scale-display')?.textContent || '').trim();
        const button = $('takeoffScaleStatus');
        if (!button) return;
        const label = button.querySelector('span');
        const icon = button.querySelector('i');
        const hasScale = scaleText && scaleText !== '--';
        button.classList.toggle('is-set', hasScale);
        if (label) label.textContent = hasScale ? `Drawing Scale: ${scaleText}` : 'Drawing Scale: not defined yet';
        if (icon) icon.className = hasScale ? 'fas fa-ruler-combined' : 'fas fa-triangle-exclamation';
    }

    function hasScaleSet() {
        const scaleText = (editorDocument()?.getElementById('scale-display')?.textContent || '').trim();
        return Boolean(scaleText && scaleText !== '--');
    }

    function syncScaleHint() {
        const hint = $('takeoffScaleHint');
        if (!hint) return;
        const editorHint = (editorDocument()?.getElementById('cal-hint')?.textContent || '').trim();
        hint.textContent = editorHint || 'Choose a preset scale or calibrate manually.';
    }

    function syncScalePresets() {
        const source = editorDocument()?.getElementById('cal-preset');
        const target = $('takeoffScalePreset');
        if (!source || !target) return false;
        if (target.dataset.loaded === '1' && target.dataset.optionCount === String(source.options.length)) return true;
        target.innerHTML = source.innerHTML || '<option value="">No presets available</option>';
        target.value = source.value || '';
        target.dataset.loaded = '1';
        target.dataset.optionCount = String(source.options.length);
        return true;
    }

    function setScaleMode(mode) {
        const nextMode = mode === 'manual' ? 'manual' : 'preset';
        const modeSelect = $('takeoffScaleMode');
        if (modeSelect) modeSelect.value = nextMode;
        $('takeoffPresetWrap')?.toggleAttribute('hidden', nextMode !== 'preset');
        $('takeoffManualWrap')?.toggleAttribute('hidden', nextMode !== 'manual');
        callEditor('setCalMode', nextMode);
        if (nextMode === 'manual') callEditor('setMode', 'cal');
        syncScaleHint();
    }

    function openScalePanel(mode) {
        const panel = $('takeoffScalePanel');
        const toggle = $('takeoffScaleStatus');
        if (!panel) return;
        syncScalePresets();
        panel.classList.add('open');
        toggle?.setAttribute('aria-expanded', 'true');
        if (mode) setScaleMode(mode);
    }

    function closeScalePanel() {
        $('takeoffScalePanel')?.classList.remove('open');
        $('takeoffScaleStatus')?.setAttribute('aria-expanded', 'false');
    }

    function applyScalePreset(value) {
        if (!value) return;
        const editorSelect = editorDocument()?.getElementById('cal-preset');
        if (editorSelect) editorSelect.value = value;
        const result = callEditor('applyScalePreset', value);
        Promise.resolve(result).finally(() => {
            syncScaleStatus();
            syncScaleHint();
        });
    }

    function applyManualScale() {
        const feet = $('takeoffManualFeet')?.value;
        const editorInput = editorDocument()?.getElementById('cal-val');
        if (editorInput) editorInput.value = feet || '';
        const result = callEditor('finishCal', true);
        Promise.resolve(result).finally(() => {
            syncScaleStatus();
            syncScaleHint();
        });
    }

    function bindScalePanel() {
        $('takeoffScaleStatus')?.addEventListener('click', event => {
            event.stopPropagation();
            const panel = $('takeoffScalePanel');
            if (panel?.classList.contains('open')) closeScalePanel();
            else openScalePanel();
        });
        document.querySelector('[data-scale-close]')?.addEventListener('click', closeScalePanel);
        $('takeoffScaleMode')?.addEventListener('change', event => setScaleMode(event.target.value));
        $('takeoffScalePreset')?.addEventListener('change', event => applyScalePreset(event.target.value));
        document.querySelector('[data-scale-apply-manual]')?.addEventListener('click', applyManualScale);
        document.querySelector('[data-scale-clear-line]')?.addEventListener('click', () => {
            callEditor('clearCalLine');
            syncScaleHint();
        });
        $('takeoffFrame')?.addEventListener('load', () => {
            setTimeout(() => {
                syncScalePresets();
                syncScaleStatus();
                syncScaleHint();
            }, 250);
        });
        setInterval(() => {
            syncScaleStatus();
            syncScaleHint();
            syncScalePresets();
        }, 1200);
    }

    function openDrawingDropdown() {
        const panel = $('takeoffDrawingDropdown');
        const trigger = $('takeoffSheetSelect');
        if (!panel) return;
        panel.classList.add('open');
        trigger?.setAttribute('aria-expanded', 'true');
        renderDrawingDropdown();
        warmDrawingMetadata();
        const doc = browsingDrawingDoc();
        if (doc) ensurePageCount(doc).then(() => {
            renderDrawingDropdown();
            renderSheetPreview(doc, drawingState.selectedPage || 1);
        });
    }

    function closeDrawingDropdown() {
        $('takeoffDrawingDropdown')?.classList.remove('open');
        $('takeoffSheetSelect')?.setAttribute('aria-expanded', 'false');
    }

    function renderDrawingDropdown() {
        renderDocumentList();
        renderSheetList();
    }

    function warmDrawingMetadata() {
        drawingState.documents.slice(0, 30).forEach(doc => {
            if (doc.pageCount) return;
            ensurePageCount(doc).then(() => renderDocumentList());
        });
    }

    function matchesDrawingQuery(doc, sheet) {
        const q = drawingState.query;
        if (!q) return true;
        const haystack = [
            doc?.name,
            doc?.folder,
            sheet?.name,
            sheet?.pageNumber ? `page ${sheet.pageNumber}` : ''
        ].join(' ').toLowerCase();
        return haystack.includes(q);
    }

    function renderDocumentList() {
        const box = $('takeoffDocumentList');
        if (!box) return;
        if (!drawingState.documents.length) {
            box.innerHTML = `<div class="pro-drawing-empty">
                <strong>No drawings uploaded yet</strong>
                <span>Upload drawings in Documents to start takeoff.</span>
            </div>`;
            return;
        }
        const docs = drawingState.documents.filter(doc => {
            if (!drawingState.query) return true;
            if (matchesDrawingQuery(doc)) return true;
            return buildSheets(doc).some(sheet => matchesDrawingQuery(doc, sheet));
        });
        box.innerHTML = docs.map(doc => `
            <button class="pro-drawing-row ${doc.id === drawingState.browseDocumentId ? 'active' : ''}" type="button" data-drawing-doc="${doc.id}">
                <span class="pro-drawing-name">${esc(doc.name)}</span>
                <span class="pro-drawing-count">${doc.pageCount || (doc.extension === 'pdf' ? '...' : '1')}</span>
            </button>
        `).join('') || '<div class="pro-drawing-empty">No drawings match your search.</div>';
        box.querySelectorAll('[data-drawing-doc]').forEach(button => {
            button.addEventListener('click', () => {
                drawingState.browseDocumentId = Number(button.dataset.drawingDoc);
                const doc = browsingDrawingDoc();
                renderDrawingDropdown();
                if (doc) {
                    showPreviewLoading();
                    ensurePageCount(doc).then(() => {
                        renderDrawingDropdown();
                        renderSheetPreview(doc, 1);
                    });
                }
            });
        });
    }

    function renderSheetList() {
        const box = $('takeoffSheetList');
        const doc = browsingDrawingDoc();
        if (!box) return;
        if (!doc) {
            box.innerHTML = '<div class="pro-drawing-empty">No drawing selected.</div>';
            showPreviewFallback('Select a drawing');
            return;
        }
        if (!doc.pageCount && doc.extension === 'pdf') {
            box.innerHTML = '<div class="pro-drawing-empty">Loading sheet list...</div>';
            return;
        }
        const sheets = buildSheets(doc).filter(sheet => matchesDrawingQuery(doc, sheet));
        box.innerHTML = sheets.map(sheet => {
            const isActive = doc.id === drawingState.selectedDocumentId && sheet.pageNumber === drawingState.selectedPage;
            return `<button class="pro-sheet-row ${isActive ? 'active' : ''}" type="button" data-drawing-page="${sheet.pageNumber}">
                <span class="pro-sheet-name">${esc(sheet.name)}</span>
                <span class="pro-sheet-icons">
                    ${sheet.hasTakeoffs ? '<i class="fas fa-layer-group" title="Has takeoffs"></i>' : ''}
                    ${sheet.hasComments ? '<i class="fas fa-comment" title="Has comments"></i>' : ''}
                </span>
            </button>`;
        }).join('') || '<div class="pro-drawing-empty">No sheets match your search.</div>';
        box.querySelectorAll('[data-drawing-page]').forEach(button => {
            button.addEventListener('mouseenter', () => renderSheetPreview(doc, Number(button.dataset.drawingPage)));
            button.addEventListener('focus', () => renderSheetPreview(doc, Number(button.dataset.drawingPage)));
            button.addEventListener('click', () => selectDrawingSheet(doc, Number(button.dataset.drawingPage)));
        });
        const previewPage = doc.id === drawingState.selectedDocumentId ? drawingState.selectedPage : 1;
        renderSheetPreview(doc, previewPage);
    }

    function showPreviewLoading() {
        const box = $('takeoffSheetPreview');
        if (box) box.innerHTML = '<div class="pro-preview-skeleton"></div>';
    }

    function showPreviewFallback(text) {
        const box = $('takeoffSheetPreview');
        if (box) box.innerHTML = `<span>${esc(text || 'Preview unavailable')}</span>`;
    }

    async function renderSheetPreview(doc, pageNumber) {
        const box = $('takeoffSheetPreview');
        if (!box || !doc) return;
        const requestId = ++drawingState.thumbnailRequest;
        showPreviewLoading();
        if (doc.extension !== 'pdf') {
            box.innerHTML = `<img src="${esc(doc.fileUrl)}" alt="${esc(doc.name)}">`;
            return;
        }
        const key = `${doc.id}:${pageNumber}`;
        try {
            if (drawingState.thumbnailCache.has(key)) {
                if (requestId === drawingState.thumbnailRequest) {
                    box.innerHTML = `<img src="${drawingState.thumbnailCache.get(key)}" alt="${esc(sheetName(doc, pageNumber))}">`;
                }
                return;
            }
            let dataUrl = null;
            if (doc.id === drawingState.selectedDocumentId) {
                dataUrl = await Promise.resolve(callEditor('takeoffRenderThumbnail', pageNumber));
            }
            if (!dataUrl) {
                const pdf = await getPdfDocument(doc);
                const page = await pdf.getPage(pageNumber);
                const viewport = page.getViewport({ scale: 0.18 });
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { alpha: false });
                canvas.width = Math.max(1, Math.floor(viewport.width));
                canvas.height = Math.max(1, Math.floor(viewport.height));
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport }).promise;
                dataUrl = canvas.toDataURL('image/jpeg', 0.68);
            }
            if (drawingState.thumbnailCache.has(key)) drawingState.thumbnailCache.delete(key);
            drawingState.thumbnailCache.set(key, dataUrl);
            while (drawingState.thumbnailCache.size > drawingState.thumbnailCacheLimit) {
                drawingState.thumbnailCache.delete(drawingState.thumbnailCache.keys().next().value);
            }
            if (requestId === drawingState.thumbnailRequest) {
                box.innerHTML = `<img src="${dataUrl}" alt="${esc(sheetName(doc, pageNumber))}">`;
            }
        } catch (e) {
            console.warn('Thumbnail failed', e);
            if (requestId === drawingState.thumbnailRequest) showPreviewFallback('Preview unavailable');
        }
    }

    function syncProjectDocument(doc) {
        if (!doc) return;
        drawingState.selectedDocumentId = Number(doc.id);
        drawingState.browseDocumentId = Number(doc.id);
        if (window.ProjectState) {
            window.ProjectState.selectedDocumentId = Number(doc.id);
            window.ProjectState.selectedDrawingId = Number(doc.id);
        }
        const download = document.getElementById('downloadDocBtn');
        if (download) download.href = doc.fileUrl || '#';
    }

    function selectDrawingSheet(doc, pageNumber) {
        if (!doc) return;
        syncProjectDocument(doc);
        drawingState.selectedPage = Math.max(1, Number(pageNumber) || 1);
        setDrawingLabel();
        closeDrawingDropdown();
        if (doc.source !== 'legacy_file') return;
        const frame = $('takeoffFrame');
        if (!frame) return;
        const nextSrc = `editor.php?id=${encodeURIComponent(doc.id)}&embedded=1`;
        let currentFrameId = 0;
        try {
            const currentUrl = new URL(frame.getAttribute('src') || '', window.location.href);
            currentFrameId = Number(currentUrl.searchParams.get('id') || 0);
        } catch (e) {}
        if (currentFrameId !== Number(doc.id)) {
            frame.style.display = 'block';
            const onLoad = () => {
                frame.removeEventListener('load', onLoad);
                setTimeout(() => {
                    callEditor('takeoffJumpToPage', drawingState.selectedPage);
                    syncEditorInfo();
                }, 80);
            };
            frame.addEventListener('load', onLoad);
            frame.src = nextSrc;
        } else {
            callEditor('takeoffJumpToPage', drawingState.selectedPage);
            syncEditorInfo();
        }
        $('takeoffEmpty')?.style.setProperty('display', 'none');
    }

    function changeActiveSheet(delta) {
        const doc = activeDrawingDoc();
        if (!doc) return;
        const info = callEditor('takeoffGetDocumentInfo');
        const max = Number(info?.pageCount || doc.pageCount || 1);
        const current = Number(info?.pageNum || drawingState.selectedPage || 1);
        const next = current + delta;
        if (next < 1 || next > max) return;
        doc.pageCount = max;
        selectDrawingSheet(doc, next);
    }

    function syncEditorInfo() {
        const doc = activeDrawingDoc();
        const info = callEditor('takeoffGetDocumentInfo');
        if (doc && info?.pageCount) {
            doc.pageCount = Number(info.pageCount);
            doc.sheets = buildSheets(doc);
        }
        if (info?.pageNum) drawingState.selectedPage = Number(info.pageNum);
        setDrawingLabel();
        renderDrawingDropdown();
    }

    function bindDrawingDropdown() {
        drawingState.documents = drawingDocs();
        if (!drawingState.browseDocumentId && drawingState.documents[0]) {
            drawingState.browseDocumentId = drawingState.documents[0].id;
            drawingState.selectedDocumentId = drawingState.documents[0].id;
        }
        setDrawingLabel();
        $('takeoffSheetSelect')?.addEventListener('click', event => {
            event.stopPropagation();
            const panel = $('takeoffDrawingDropdown');
            if (panel?.classList.contains('open')) closeDrawingDropdown();
            else openDrawingDropdown();
        });
        document.querySelector('[data-drawing-close]')?.addEventListener('click', closeDrawingDropdown);
        $('takeoffDrawingDropdown')?.addEventListener('click', event => event.stopPropagation());
        $('takeoffDrawingSearch')?.addEventListener('input', event => {
            clearTimeout(event.target._takeoffSearchTimer);
            event.target._takeoffSearchTimer = setTimeout(() => {
                drawingState.query = event.target.value.trim().toLowerCase();
                renderDrawingDropdown();
            }, 120);
        });
        window.addEventListener('message', event => {
            if (event.data?.type === 'project-takeoff-state') {
                syncTakeoffFromCanvasSnapshot(event.data.payload);
                return;
            }
            if (event.data?.type === 'project-takeoff-selection') {
                const payload = event.data.payload || {};
                setSelectedObjects(payload.ids || payload.selectedObjectIds || [], payload.layerId || null);
                if (payload.layerId && findLayer(payload.layerId)) setActiveTakeoffLayer(payload.layerId);
                return;
            }
            if (event.data?.type !== 'takeoff-editor-ready') return;
            const doc = activeDrawingDoc();
            if (doc && Number(event.data.fileId) === Number(doc.id)) {
                doc.pageCount = Number(event.data.pageCount || 1);
                doc.sheets = buildSheets(doc);
                drawingState.selectedPage = Number(event.data.pageNum || 1);
                setDrawingLabel();
                renderDrawingDropdown();
            }
        });
        $('takeoffFrame')?.addEventListener('load', () => {
            setTimeout(syncEditorInfo, 250);
            setTimeout(notifyEditorVisible, 120);
            setTimeout(fitTakeoffToScreen, 520);
            setTimeout(() => {
                syncAllLayersToCanvas();
                const active = findLayer(takeoffState.activeLayerId);
                if (active) applyLayerToCanvas(active);
                else callEditor('projectTakeoffClearActiveLayer');
                const snapshot = callEditor('projectTakeoffSnapshot');
                if (snapshot) syncTakeoffFromCanvasSnapshot(snapshot);
            }, 360);
        });
    }

    window.projectTakeoffRefreshDrawings = function () {
        drawingState.documents = drawingDocs();
        if (!drawingState.documents.some(doc => Number(doc.id) === Number(drawingState.selectedDocumentId)) && drawingState.documents[0]) {
            drawingState.selectedDocumentId = drawingState.documents[0].id;
            drawingState.browseDocumentId = drawingState.documents[0].id;
        }
        setDrawingLabel();
        renderDrawingDropdown();
    };

    document.addEventListener('DOMContentLoaded', () => {
        $('toggleTakeoffItemsPanel')?.addEventListener('click', () => {
            const workspace = $('takeoffWorkspace');
            workspace?.classList.toggle('items-collapsed');
            const icon = $('toggleTakeoffItemsPanel')?.querySelector('i');
            if (icon) {
                icon.className = workspace?.classList.contains('items-collapsed') ? 'fas fa-angles-right' : 'fas fa-angles-left';
            }
        });

        document.querySelectorAll('[data-takeoff-menu-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                $(button.dataset.takeoffMenuToggle)?.classList.toggle('open');
            });
        });

        document.querySelectorAll('[data-takeoff-action]').forEach(button => {
            button.addEventListener('click', () => handleTakeoffAction(button.dataset.takeoffAction));
        });

        $('takeoffItemSearch')?.addEventListener('input', event => {
            takeoffState.query = event.target.value.trim().toLowerCase();
            renderTakeoffPanel();
        });

        document.querySelectorAll('[data-tree-toggle]').forEach(button => {
            button.addEventListener('click', () => {
                const folder = button.closest('.pro-tree-row');
                const children = folder?.nextElementSibling;
                const isOpen = folder?.classList.toggle('open');
                if (children) children.hidden = !isOpen;
                const icon = button.querySelector('i');
                if (icon) icon.className = isOpen ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
            });
        });

        document.querySelectorAll('[data-row-menu]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                toggleRowMenu(button);
            });
        });

        document.querySelectorAll('[data-tool-command]').forEach(button => {
            button.addEventListener('click', () => runTool(button.dataset.toolCommand));
        });
        bindTooltips();

        document.querySelectorAll('[data-viewer-command]').forEach(button => {
            button.addEventListener('click', () => runViewerCommand(button.dataset.viewerCommand));
        });

        $('takeoffZoomSlider')?.addEventListener('input', event => setZoom(event.target.value));
        initTakeoffState();
        ensureViewerLayersPopover();
        bindDrawingDropdown();
        bindScalePanel();
        $('takeoffFrame')?.addEventListener('load', () => setTimeout(notifyEditorVisible, 120));
        if (document.getElementById('tab-takeoff')?.classList.contains('active')) {
            setTimeout(notifyEditorVisible, 180);
        }

        document.addEventListener('click', () => {
            document.querySelectorAll('.pro-menu, .pro-row-menu').forEach(menu => menu.classList.remove('open'));
            activeRowMenuAnchor = null;
            closeScalePanel();
            closeDrawingDropdown();
            $('takeoffMoreToolsPanel')?.setAttribute('hidden', '');
        });
        document.addEventListener('click', event => {
            if (!viewerState.isLayersPopoverOpen) return;
            if (event.target.closest('#takeoffViewerLayersPopover') || event.target.closest('[data-viewer-command="layers"]')) return;
            closeViewerLayersPopover();
        });
        window.addEventListener('resize', refreshOpenRowMenu);
        document.addEventListener('fullscreenchange', () => {
            viewerState.isFullscreen = Boolean(document.fullscreenElement);
            const icon = document.querySelector('[data-viewer-command="fullscreen"] i');
            if (icon) icon.className = viewerState.isFullscreen ? 'fas fa-compress' : 'fas fa-expand';
        });
        document.addEventListener('scroll', refreshOpenRowMenu, true);
        $('takeoffScalePanel')?.addEventListener('click', event => event.stopPropagation());
        $('takeoffComparePanel')?.addEventListener('click', event => event.stopPropagation());
        $('takeoffMoreToolsPanel')?.addEventListener('click', event => event.stopPropagation());
        $('takeoffLayerModal')?.addEventListener('click', event => {
            if (event.target.id === 'takeoffLayerModal') closeLayerModal();
        });
        document.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                undoTakeoff();
                return;
            }
            if (event.code === 'Space' && !event.repeat && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                callEditor('projectTakeoffSetTemporaryPan', true);
                document.querySelector('.pro-canvas-shell')?.classList.add('is-panning');
            }
        });
        document.addEventListener('keyup', event => {
            if (event.code === 'Space') {
                callEditor('projectTakeoffSetTemporaryPan', false);
                if (!document.querySelector('[data-tool-command="pan"]')?.classList.contains('active')) {
                    document.querySelector('.pro-canvas-shell')?.classList.remove('is-panning');
                }
            }
        });
    });
})();
