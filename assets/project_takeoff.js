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
        const canvas = editorCanvas();
        const zoom = Math.max(0.05, Math.min(20, Number(percent || 100) / 100));
        if (canvas && typeof canvas.setZoom === 'function') {
            const center = typeof canvas.getVpCenter === 'function'
                ? canvas.getVpCenter()
                : { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 };
            if (typeof canvas.zoomToPoint === 'function') {
                canvas.zoomToPoint(center, zoom);
            } else {
                canvas.setZoom(zoom);
            }
            if (typeof canvas.requestRenderAll === 'function') canvas.requestRenderAll();
        }
        const percentText = `${Math.round(zoom * 100)}%`;
        const slider = $('takeoffZoomSlider');
        const label = $('takeoffZoomPercent');
        if (slider) slider.value = String(Math.round(zoom * 100));
        if (label) label.textContent = percentText;
        const win = takeoffWindow();
        const embeddedZoom = win?.document?.getElementById('zoom-disp');
        if (embeddedZoom) embeddedZoom.textContent = percentText;
    }

    function currentZoomPercent() {
        const canvas = editorCanvas();
        if (canvas && typeof canvas.getZoom === 'function') {
            return Math.round(canvas.getZoom() * 100);
        }
        return Number($('takeoffZoomSlider')?.value || 100);
    }

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
            .filter(doc => doc?.path && doc.source === 'legacy_file' && drawingExtensions().includes(String(doc.extension || '').toLowerCase()))
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

    const TAKEOFF_TYPES = ['Count', 'Linear', 'Area'];
    const TAKEOFF_UOMS = ['ea', 'ft', 'lf', 'sq ft', 'yd', 'm'];
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
        Area: 'Use Area for surfaces, zones, slabs, rooms, or any item measured by square footage.'
    };

    const takeoffState = {
        groups: [],
        activeGroupId: 'default',
        activeLayerId: null,
        editingLayerId: null,
        pendingLayerGroupId: 'default',
        pendingCatalogItem: null,
        query: ''
    };

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
        if (type === 'Linear') return 'ft';
        if (type === 'Area') return 'sq ft';
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
        if (raw === 'area') return 'Area';
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
                quantity: Number(layer.quantity || layer.count || layer.measurement_count || 0),
                catalogItemId: layer.catalog_item_id || layer.catalogItemId || null,
                catalog_item_id: layer.catalog_item_id || layer.catalogItemId || null,
                unitCost: Number(layer.unit_cost || layer.unitCost || 0),
                unit_cost: Number(layer.unit_cost || layer.unitCost || 0),
                laborHours: Number(layer.labor_hours || layer.laborHours || 0),
                labor_hours: Number(layer.labor_hours || layer.laborHours || 0),
                category: layer.category || layer.catalog_name || layer.group_name || '',
                description: layer.description || ''
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
                quantity: Number(layer.quantity || 0),
                catalogItemId: layer.catalogItemId || layer.catalog_item_id || null,
                catalog_item_id: layer.catalog_item_id || layer.catalogItemId || null,
                unitCost: Number(layer.unitCost || layer.unit_cost || 0),
                unit_cost: Number(layer.unit_cost || layer.unitCost || 0),
                laborHours: Number(layer.laborHours || layer.labor_hours || 0),
                labor_hours: Number(layer.labor_hours || layer.laborHours || 0),
                category: layer.category || '',
                description: layer.description || ''
            }))
        }));
    }

    function saveTakeoffState() {
        try {
            localStorage.setItem(takeoffStoreKey(), JSON.stringify({
                groups: takeoffState.groups,
                activeGroupId: takeoffState.activeGroupId,
                activeLayerId: takeoffState.activeLayerId
            }));
        } catch (e) {
            console.warn('Takeoff state could not be saved', e);
        }
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

    function quantityLabel(layer) {
        const qty = Number(layer.quantity || 0);
        return `${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)} ${layer.uom}`;
    }

    function symbolGlyph(layer) {
        if (layer.type === 'Linear') return '<i class="fas fa-minus"></i>';
        if (layer.type === 'Area') return '<i class="far fa-square"></i>';
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
        tree.innerHTML = takeoffState.groups.map(group => {
            const visibleLayers = (group.layers || []).filter(layer => {
                if (!q) return true;
                return group.name.toLowerCase().includes(q) || layer.name.toLowerCase().includes(q) || layer.type.toLowerCase().includes(q);
            });
            const groupVisible = !q || group.name.toLowerCase().includes(q) || visibleLayers.length > 0;
            if (!groupVisible) return '';
            const expanded = q ? true : group.isExpanded !== false;
            return `<div class="pro-takeoff-group" data-group-id="${esc(group.id)}">
                <div class="pro-tree-row pro-tree-folder ${takeoffState.activeGroupId === group.id ? 'active' : ''}" data-takeoff-group-row="${esc(group.id)}">
                    <button class="pro-tree-toggle" type="button" data-group-toggle="${esc(group.id)}"><i class="fas ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i></button>
                    <input type="checkbox" checked aria-label="Group visibility">
                    <span class="pro-tree-name"><i class="fas fa-folder${expanded ? '-open' : ''}"></i> ${esc(group.name)}</span>
                    <span class="pro-tree-qty">${group.layers.length}</span>
                    <button class="pro-row-menu-btn" type="button" data-group-menu="${esc(group.id)}"><i class="fas fa-ellipsis-vertical"></i></button>
                </div>
                <div class="pro-tree-children" ${expanded ? '' : 'hidden'}>
                    ${visibleLayers.map(layer => `<div class="pro-tree-row pro-tree-item ${takeoffState.activeLayerId === layer.id ? 'active' : ''}" data-layer-row="${esc(layer.id)}">
                        <input type="checkbox" checked aria-label="Layer visibility">
                        <span class="pro-layer-symbol" style="color:${esc(layer.color)}">${symbolGlyph(layer)}</span>
                        <span class="pro-tree-name">${esc(layer.name)}${layer.catalogItemId ? '<small class="pro-catalog-linked">Linked to catalog</small>' : ''}</span>
                        <span class="pro-tree-qty">${esc(quantityLabel(layer))}</span>
                        <button class="pro-row-menu-btn" type="button" data-layer-menu="${esc(layer.id)}"><i class="fas fa-ellipsis-vertical"></i></button>
                    </div>`).join('')}
                </div>
            </div>`;
        }).join('') || '<div class="pro-drawing-empty">No takeoffs match your search.</div>';
        bindTakeoffTreeEvents();
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
        document.querySelectorAll('[data-layer-row]').forEach(row => {
            row.addEventListener('click', event => {
                if (event.target.closest('button')) return;
                setActiveTakeoffLayer(row.dataset.layerRow);
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
        if (!findGroup(takeoffState.activeGroupId)) takeoffState.activeGroupId = 'default';
        if (takeoffState.activeLayerId && !findLayer(takeoffState.activeLayerId)) takeoffState.activeLayerId = null;
        ensureTakeoffModal();
        renderTakeoffPanel();
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
            $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[type];
            $('layerUomInput').value = typeToUom(type);
            updateLayerSubmitState();
        });
        $('layerColorInput').addEventListener('change', updateLayerColorSwatch);
        $('layerCreateSubmit').addEventListener('click', submitLayerModal);
        ensureCatalogModal();
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
        $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[$('layerTypeInput').value];
        setSelectValue($('layerUomInput'), layer?.uom || typeToUom($('layerTypeInput').value));
        $('layerSymbolInput').value = layer?.symbol || 'Solid Circle';
        $('layerSizeInput').value = layer?.size || 'Medium';
        $('layerColorInput').value = layer?.color || '#111827';
        $('layerCreateSubmit').textContent = layer ? 'Save' : 'Create';
        updateCatalogSelectionIndicator();
        updateLayerColorSwatch();
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
        const type = $('layerTypeInput').value;
        const payload = {
            name,
            type,
            uom: $('layerUomInput').value || typeToUom(type),
            symbol: $('layerSymbolInput').value || 'Solid Circle',
            size: $('layerSizeInput').value || 'Medium',
            color: $('layerColorInput').value || '#111827'
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
        const copy = {
            id: makeId('grp'),
            name: `${group.name} Copy`,
            isExpanded: true,
            isDefault: false,
            layers: (group.layers || []).map(layer => ({ ...layer, id: makeId('layer'), groupId: null }))
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
        group.name = group.isDefault ? 'Default Group' : name.trim();
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function deleteLayer(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        if (!confirm('Delete this takeoff layer?')) return;
        const group = findGroup(layer.groupId);
        group.layers = group.layers.filter(item => item.id !== layerId);
        if (takeoffState.activeLayerId === layerId) takeoffState.activeLayerId = null;
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function duplicateLayer(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        const group = findGroup(layer.groupId);
        const copy = { ...layer, id: makeId('layer'), name: `${layer.name} Copy`, quantity: 0 };
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
        layer.name = name.trim();
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function changeLayerColor(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        const color = prompt('Layer color hex', layer.color);
        if (!color) return;
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
    }

    function applyLayerToCanvas(layer) {
        const win = takeoffWindow();
        if (!win) return;
        win.__projectActiveTakeoffLayer = {
            id: layer.id,
            name: layer.name,
            takeoff_type: layer.type.toLowerCase(),
            type: layer.type.toLowerCase(),
            unit_of_measure: layer.uom,
            symbol: layer.symbol,
            symbol_size: layer.size,
            color: layer.color,
            quantity: layer.quantity,
            catalog_item_id: layer.catalogItemId || null,
            unit_cost: layer.unitCost || 0,
            labor_hours: layer.laborHours || 0,
            category: layer.category || '',
            description: layer.description || ''
        };
        if (layer.type === 'Linear') callEditor('setMode', 'measure');
        if (layer.type === 'Area') callEditor('setMode', 'draw');
        if (layer.type === 'Count') callEditor('setMode', 'smart');
        if (layer.type === 'Linear') setActiveTool('linear');
        if (layer.type === 'Area') setActiveTool('area');
        if (layer.type === 'Count') setActiveTool('count');
    }

    function openTakeoffContextMenu(button, type, id) {
        const menu = $('takeoffRowMenu');
        if (!menu) return;
        const group = type === 'group' ? findGroup(id) : null;
        menu.innerHTML = type === 'group'
            ? `<button type="button" data-menu-act="group-create"><i class="fas fa-plus"></i> Create New Takeoff Layer</button>
               <button type="button" data-menu-act="group-rename"><i class="fas fa-pen"></i> Rename</button>
               <button type="button" data-menu-act="group-copy"><i class="fas fa-copy"></i> Copy</button>
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
        if (action === 'export-excel') return showPrepared('Excel export is ready to be connected.');
        if (action === 'browse-catalog') return openCatalogModal();
        showPrepared(action);
    }

    function setActiveTool(command) {
        document.querySelectorAll('[data-tool-command]').forEach(button => {
            button.classList.toggle('active', button.dataset.toolCommand === command);
        });
    }

    function runTool(command) {
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
            if ((command === 'measure' || command === 'linear' || command === 'area') && !hasScaleSet()) openScalePanel();
            return;
        }
        if (command === 'text') {
            callEditor('addText');
            setActiveTool(command);
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
        if (command === 'undo') return callEditor('undo');
        if (command === 'redo') return callEditor('redo');
        if (command === 'delete') return callEditor('deleteSelected');
    }

    function runViewerCommand(command) {
        if (command === 'zoom-out') return setZoom(currentZoomPercent() - 10);
        if (command === 'zoom-in') return setZoom(currentZoomPercent() + 10);
        if (command === 'fit') return callEditor('fitPdfToView', true);
        if (command === 'previous' || command === 'next') return changeActiveSheet(command === 'next' ? 1 : -1);
        if (command === 'fullscreen') {
            const shell = document.querySelector('.pro-canvas-shell');
            if (shell?.requestFullscreen) shell.requestFullscreen();
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
        if (command === 'grid' || command === 'layers' || command === 'compare') {
            showPrepared(command);
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
        });
    }

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

        document.querySelectorAll('[data-viewer-command]').forEach(button => {
            button.addEventListener('click', () => runViewerCommand(button.dataset.viewerCommand));
        });

        $('takeoffZoomSlider')?.addEventListener('input', event => setZoom(event.target.value));
        initTakeoffState();
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
        });
        window.addEventListener('resize', refreshOpenRowMenu);
        document.addEventListener('scroll', refreshOpenRowMenu, true);
        $('takeoffScalePanel')?.addEventListener('click', event => event.stopPropagation());
        $('takeoffLayerModal')?.addEventListener('click', event => {
            if (event.target.id === 'takeoffLayerModal') closeLayerModal();
        });
    });
})();

