(function () {
    const $ = (id) => document.getElementById(id);
    let editorEstimateGeneration = 0;

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
        } catch (e) { }
    }

    function takeoffEditorUrl(documentId, estimateId = activeEstimateId()) {
        const inheritLegacy = String(estimateId) === primaryEstimateId() ? '&inherit_legacy=1' : '';
        return `editor.php?id=${encodeURIComponent(documentId)}&embedded=1&estimate_key=${encodeURIComponent(estimateId)}${inheritLegacy}`;
    }
    window.projectTakeoffEditorUrl = takeoffEditorUrl;

    function ensureEditorEstimate(estimateId = activeEstimateId()) {
        const frame = $('takeoffFrame');
        const documentId = activeDrawingDoc()?.id || window.ProjectState?.selectedDocumentId;
        if (!frame || !documentId) return false;
        let loadedEstimate = '';
        try { loadedEstimate = new URL(frame.getAttribute('src') || '', window.location.href).searchParams.get('estimate_key') || ''; } catch (_) { }
        if (loadedEstimate === String(estimateId)) return false;
        const requestedEstimateId = String(estimateId);
        const generation = ++editorEstimateGeneration;
        frame.addEventListener('load', () => {
            if (generation !== editorEstimateGeneration || requestedEstimateId !== activeEstimateId()) return;
            syncAllLayersToCanvas({ suppressEstimatingSync: true });
            renderTakeoffPanel();
            notifyEditorVisible();
        }, { once: true });
        frame.src = takeoffEditorUrl(documentId, estimateId);
        return true;
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
        document.querySelectorAll('[data-takeoff-menu-toggle]').forEach(button => {
            const menu = $(button.dataset.takeoffMenuToggle);
            button.setAttribute('aria-haspopup', 'menu');
            button.setAttribute('aria-expanded', menu?.classList.contains('open') ? 'true' : 'false');
        });
    }

    function setMenuExpanded(button, expanded) {
        const menu = button && $(button.dataset.takeoffMenuToggle);
        if (!button || !menu) return;
        menu.classList.toggle('open', expanded);
        button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function syncWorkspaceDensity() {
        const workspace = $('takeoffWorkspace');
        const viewer = document.querySelector('.pro-takeoff-viewer');
        if (!workspace || !viewer) return;
        const width = viewer.clientWidth;
        workspace.classList.toggle('workspace-compact', width < 920);
        workspace.classList.toggle('workspace-tight', width < 690);
    }

    function setInspectorCollapsed(collapsed) {
        const workspace = $('takeoffWorkspace');
        const button = $('toggleTakeoffInspector');
        if (!workspace) return;
        workspace.classList.toggle('inspector-collapsed', Boolean(collapsed));
        if (button) {
            const icon = button.querySelector('i');
            button.setAttribute('aria-label', collapsed ? 'Expand inspector' : 'Collapse inspector');
            button.dataset.proTooltip = collapsed ? 'Expand inspector' : 'Collapse inspector';
            if (icon) icon.className = collapsed ? 'fas fa-angles-left' : 'fas fa-angles-right';
        }
        requestAnimationFrame(syncWorkspaceDensity);
        setTimeout(notifyEditorVisible, 80);
    }

    let takeoffIsDirty = false;
    window.isTakeoffDirty = () => takeoffIsDirty;
    window.projectTakeoffFitToScreen = fitTakeoffToScreen;
    window.projectTakeoffSaveState = async function () {
        takeoffIsDirty = false;
        try {
            const pId = String(window.ProjectState?.projectId || 0);
            localStorage.setItem('takeoff_project_groups_' + pId, JSON.stringify(takeoffState.groups));
        } catch (_) { }
        syncTakeoffToEstimating();
        syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
        try {
            await callEditor('projectTakeoffSave');
        } catch (e) {
            console.warn('Canvas save ignored or complete:', e);
        }
    };

    const viewerState = {
        isGridVisible: false,
        isLayersPopoverOpen: false,
        isFullscreen: false,
        continuousTool: false,
        activeTool: 'smart'
    };
    let temporaryPanPreviousTool = null;
    let gesturePanPreviousTool = null;

    const drawingState = {
        documents: [],
        selectedDocumentId: Number(window.ProjectState?.selectedDocumentId || 0),
        selectedPage: 1,
        browseDocumentId: Number(window.ProjectState?.selectedDocumentId || 0),
        query: '',
        filterMode: 'all',
        previewPage: 1,
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
        renderWorkspaceSummary();
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

    function getSheetTakeoffSummary(docId, pageNumber) {
        const activeId = String(takeoffState.activeLayerId || selectionState.activeLayerId || '');
        const numDocId = Number(docId);
        const numPage = Number(pageNumber);

        const layerMap = new Map();

        // 1. Check live snapshots for this drawing
        const activeEst = typeof activeEstimateId === 'function' ? activeEstimateId() : '';
        const snapshotKey = `${activeEst}:${numDocId}`;
        const liveSnapshot = (takeoffState.canvasSnapshots && takeoffState.canvasSnapshots[snapshotKey])
            || Object.values(takeoffState.canvasSnapshots || {}).find(s => Number(s.drawingId || s.drawing_id) === numDocId);

        if (liveSnapshot && Array.isArray(liveSnapshot.layers) && liveSnapshot.layers.length > 0) {
            liveSnapshot.layers.forEach(remote => {
                const lid = String(remote.id || remote.layerId || '');
                const layer = typeof findLayer === 'function' ? findLayer(lid) : null;
                const shapes = (remote.shapes || remote.takeoffObjects || []).filter(s => Number(s.pageNumber) === numPage);
                if (!shapes.length) return;
                const markCount = shapes.length;
                const quantity = shapes.reduce((sum, s) => sum + Number(s.quantityValue || s.quantity || 1), 0);
                layerMap.set(lid, {
                    layerId: lid,
                    name: layer?.name || remote.name || 'Item de Takeoff',
                    color: layer?.color || remote.color || '#2563eb',
                    symbol: layer?.symbol || remote.symbol || 'Solid Circle',
                    type: layer?.type || remote.type || 'Count',
                    uom: layer?.uom || remote.unit_of_measure || remote.uom || 'ea',
                    markCount,
                    quantity,
                    isActive: Boolean(activeId && lid === activeId)
                });
            });
        } else {
            // 2. Fall back to server-seeded takeoffLocations
            const locations = window.ProjectState?.takeoffLocations || {};
            Object.entries(locations).forEach(([lid, loc]) => {
                const layer = typeof findLayer === 'function' ? findLayer(lid) : null;
                const layerDocId = Number(loc.drawingId || loc.drawing_id || layer?.drawing_id || 0);
                if (layerDocId !== 0 && layerDocId !== numDocId) return;

                const pageData = loc.pages?.[numPage] || loc.pages?.[String(numPage)];
                if (pageData && (Number(pageData.count || 0) > 0 || Number(pageData.quantity || 0) > 0)) {
                    layerMap.set(String(lid), {
                        layerId: String(lid),
                        name: layer?.name || loc.name || 'Item de Takeoff',
                        color: layer?.color || loc.color || '#2563eb',
                        symbol: layer?.symbol || loc.symbol || 'Solid Circle',
                        type: layer?.type || loc.type || 'Count',
                        uom: layer?.uom || loc.uom || loc.unit_of_measure || 'ea',
                        markCount: Number(pageData.count || 0),
                        quantity: Number(pageData.quantity || 0),
                        isActive: Boolean(activeId && String(lid) === activeId)
                    });
                }
            });
        }

        const layers = Array.from(layerMap.values());
        const totalMarks = layers.reduce((sum, l) => sum + l.markCount, 0);
        const activeLayerEntry = activeId ? layerMap.get(activeId) : null;
        const activeItemMarks = activeLayerEntry ? activeLayerEntry.markCount : 0;

        return {
            totalMarks,
            layers,
            activeItemMarks,
            hasActiveItem: activeItemMarks > 0,
            hasAnyTakeoff: layers.length > 0 || totalMarks > 0
        };
    }

    function buildSheets(doc) {
        if (!doc) return [];
        const count = doc.pageCount || (doc.extension === 'pdf' ? 0 : 1);
        if (!count) return [];
        return Array.from({ length: count }, (_, index) => {
            const pageNumber = index + 1;
            const saved = doc.sheets?.[index] || {};
            const summary = getSheetTakeoffSummary(doc.id, pageNumber);
            return {
                id: `${doc.id}:${pageNumber}`,
                documentId: doc.id,
                name: saved.name || sheetName(doc, pageNumber),
                pageNumber,
                thumbnailUrl: saved.thumbnailUrl,
                hasTakeoffs: summary.hasAnyTakeoff || Boolean(saved.hasTakeoffs),
                takeoffSummary: summary,
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
    const TAKEOFF_UOMS = [
        'ea', 'set', 'lot', 'pr', 'pkg', 'box',
        'lf', 'ft', 'in', 'yd', 'm', 'mm',
        'sq ft', 'sq yd', 'm2', 'acre',
        'cu yd', 'ft3', 'm3', 'gal',
        'hr', 'day', 'wk'
    ];
    const TAKEOFF_SYMBOLS = ['Checkmark', 'Octagon', 'Solid Circle', 'Square', 'Triangle', 'Cross', 'Pentagon', 'Target', 'Dimension', 'Hollow Circle', 'Diamond'];
    const TAKEOFF_SIZES = ['X-Small', 'Small', 'Medium', 'Large'];
    const takeoffSizeRadius = size => ({ 'X-Small': 5, Small: 7, Medium: 9, Large: 12 }[size]
        || Math.max(4, Math.min(96, Number(size) || 9)));
    const takeoffDisplaySize = size => {
        if (TAKEOFF_SIZES.includes(size)) return size;
        const radius = takeoffSizeRadius(size);
        if (radius <= 5) return 'X-Small';
        if (radius <= 7) return 'Small';
        if (radius >= 12) return 'Large';
        return 'Medium';
    };
    const takeoffDisplaySymbol = symbol => {
        const raw = String(symbol || '').toLowerCase();
        if (raw.includes('check')) return 'Checkmark';
        if (raw.includes('octagon')) return 'Octagon';
        if (raw.includes('square')) return 'Square';
        if (raw.includes('triangle')) return 'Triangle';
        if (raw.includes('pentagon')) return 'Pentagon';
        if (raw.includes('target') || raw.includes('concentric')) return 'Target';
        if (raw.includes('dimension') || raw.includes('dynamic')) return 'Dimension';
        if (raw.includes('diamond')) return 'Diamond';
        if (raw.includes('cross') || raw.includes('plus')) return 'Cross';
        if (raw.includes('hollow')) return 'Hollow Circle';
        return 'Solid Circle';
    };

    function getLayerBadgeSvg(layer, size = 14) {
        const color = layer?.color || '#3b82f6';
        const rawType = String(layer?.type || 'Count');
        const isCount = rawType === 'Count' || rawType === 'Count by distance' || Boolean(layer?.symbol && !rawType.startsWith('Linear') && !rawType.includes('Area'));

        if (!isCount) {
            if (rawType === 'Linear' || rawType.startsWith('Linear')) {
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none">
                    <line x1="3" y1="12" x2="21" y2="12" stroke="${esc(color)}" stroke-width="3.5" stroke-linecap="round"/>
                    <circle cx="5" cy="12" r="2.5" fill="${esc(color)}"/>
                    <circle cx="19" cy="12" r="2.5" fill="${esc(color)}"/>
                </svg>`;
            }
            return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none">
                <polygon points="4 5, 20 5, 20 19, 4 19" stroke="${esc(color)}" stroke-width="2.2" stroke-linejoin="round" fill="${esc(color)}" fill-opacity="0.35"/>
            </svg>`;
        }

        const sym = takeoffDisplaySymbol(layer?.symbol || 'Solid Circle');
        switch (sym) {
            case 'Checkmark':
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${esc(color)}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>`;
            case 'Square':
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                    <rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/>
                </svg>`;
            case 'Triangle':
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                    <polygon points="12 2.5 22 21.5 2 21.5"/>
                </svg>`;
            case 'Octagon':
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                    <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"/>
                </svg>`;
            case 'Cross':
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                    <path d="M19 10.5h-5.5V5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v5.5H5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5h5.5V19c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-5.5H19c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5z"/>
                </svg>`;
            case 'Pentagon':
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                    <polygon points="12 2 22 9.5 18.2 21.5 5.8 21.5 2 9.5"/>
                </svg>`;
            case 'Target':
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${esc(color)}" stroke-width="2.5">
                    <circle cx="12" cy="12" r="9"/>
                    <circle cx="12" cy="12" r="4.5" fill="${esc(color)}"/>
                </svg>`;
            case 'Hollow Circle':
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${esc(color)}" stroke-width="3">
                    <circle cx="12" cy="12" r="8"/>
                </svg>`;
            case 'Diamond':
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                    <polygon points="12 2 22 12 12 22 2 12"/>
                </svg>`;
            case 'Dimension':
                return `<svg viewBox="0 0 28 20" width="${Math.round(size * 1.15)}" height="${Math.round(size * 0.85)}" fill="none" stroke="${esc(color)}" stroke-width="2">
                    <text x="14" y="8" text-anchor="middle" font-size="9" font-family="sans-serif" font-weight="bold" fill="${esc(color)}" stroke="none">x</text>
                    <line x1="3" y1="11" x2="3" y2="18"/>
                    <line x1="25" y1="11" x2="25" y2="18"/>
                    <line x1="3" y1="15" x2="25" y2="15"/>
                </svg>`;
            case 'Solid Circle':
            default:
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${esc(color)}">
                    <circle cx="12" cy="12" r="8.5"/>
                </svg>`;
        }
    }

    function renderLayerBadgeHtml(layer, size = 14) {
        if (!layer) return '';
        const symbolLabel = layer.symbol || layer.type || 'Item';
        return `<span class="pro-layer-symbol-badge" title="${esc(symbolLabel)} (${esc(layer.color || '#3b82f6')})">${getLayerBadgeSvg(layer, size)}</span>`;
    }

    const TAKEOFF_COLORS = window.TakeoffColorPalette?.COLORS || [];
    const TAKEOFF_RICH_COLORS = [
        '#7c3aed',
        '#3b5998',
        '#0ea5e9',
        '#00d2ff',
        '#009688',
        '#16a34a',
        '#84cc16',
        '#a3e635',
        '#fde047',
        '#f59e0b',
        '#f97316',
        '#ef4444',
        '#78350f',
        '#000000'
    ];

    const TAKEOFF_TYPE_ITEMS = [
        {
            type: 'Count',
            title: 'Count',
            desc: 'Count Quantity items - EX: Light Fixtures, Electrical Outlets, Data Outlets',
            svg: `<svg viewBox="0 0 44 44" width="34" height="34" fill="none"><path d="M22 6 C18.7 6 16 8.7 16 12 C16 16 22 21 22 21 C22 21 28 16 28 12 C28 8.7 25.3 6 22 6 Z" fill="var(--pcd-pin-bg, #ffffff)" stroke="#1e293b" stroke-width="2" stroke-linejoin="round"/><circle cx="22" cy="11.5" r="2.2" fill="#1e293b"/><path d="M11 18 C7.7 18 5 20.7 5 24 C5 28 11 33 11 33 C11 33 17 28 17 24 C17 20.7 14.3 18 11 18 Z" fill="var(--pcd-pin-bg, #ffffff)" stroke="#1e293b" stroke-width="2" stroke-linejoin="round"/><circle cx="11" cy="23.5" r="2.2" fill="#1e293b"/><path d="M33 21 C29.7 21 27 23.7 27 27 C27 31 33 36 33 36 C33 36 39 31 39 27 C39 23.7 36.3 21 33 21 Z" fill="var(--pcd-pin-bg, #ffffff)" stroke="#1e293b" stroke-width="2" stroke-linejoin="round"/><circle cx="33" cy="26.5" r="2.2" fill="#1e293b"/></svg>`
        },
        {
            type: 'Linear',
            title: 'Linear',
            desc: 'Measure Distance - EX: Cable, Conduit, Pipe',
            svg: `<svg viewBox="0 0 44 44" width="34" height="34" fill="none"><polyline points="7 34, 21 15, 37 34" stroke="#ff5722" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="34" r="3.5" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="21" cy="15" r="3.5" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="37" cy="34" r="3.5" fill="#ffffff" stroke="#1e293b" stroke-width="2"/></svg>`
        },
        {
            type: 'Linear with drop',
            title: 'Linear with drop',
            desc: 'Measure conduit and include drop distance at user defined points',
            svg: `<svg viewBox="0 0 44 44" width="34" height="34" fill="none"><polyline points="7 22, 22 9, 37 22" stroke="#ff5722" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="7" y1="22" x2="7" y2="34" stroke="#ff5722" stroke-width="1.8" stroke-dasharray="2,2"/><circle cx="7" cy="34" r="2.2" fill="#ffffff" stroke="#ff5722" stroke-width="1.5"/><line x1="22" y1="9" x2="22" y2="25" stroke="#ff5722" stroke-width="1.8" stroke-dasharray="2,2"/><circle cx="22" cy="25" r="2.2" fill="#ffffff" stroke="#ff5722" stroke-width="1.5"/><line x1="37" y1="22" x2="37" y2="34" stroke="#ff5722" stroke-width="1.8" stroke-dasharray="2,2"/><circle cx="37" cy="34" r="2.2" fill="#ffffff" stroke="#ff5722" stroke-width="1.5"/><circle cx="7" cy="22" r="3.2" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="22" cy="9" r="3.2" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="37" cy="22" r="3.2" fill="#ffffff" stroke="#1e293b" stroke-width="2"/></svg>`
        },
        {
            type: 'Linear avg. with drop',
            title: 'Linear avg. with drop',
            desc: 'Uses sample cable runs to average length including drop',
            svg: `<svg viewBox="0 0 44 44" width="34" height="34" fill="none"><path d="M8 29 L16 29 L16 17 L25 17 L25 29 L36 29" stroke="#ff5722" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="16" y1="29" x2="16" y2="35" stroke="#ff5722" stroke-width="2"/><line x1="25" y1="29" x2="25" y2="35" stroke="#ff5722" stroke-width="2"/><circle cx="8" cy="29" r="3" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="16" cy="35" r="3" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="25" cy="35" r="3" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="36" cy="29" r="3" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="25" cy="11" r="3" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><line x1="25" y1="11" x2="25" y2="17" stroke="#ff5722" stroke-width="2"/></svg>`
        },
        {
            type: 'Count by distance',
            title: 'Count by distance',
            desc: 'Divides linear distance into quantity for J-hooks, Anchors, Straps, etc.',
            svg: `<svg viewBox="0 0 44 44" width="34" height="34" fill="none"><line x1="7" y1="33" x2="21" y2="17" stroke="#ff5722" stroke-width="2.5" stroke-dasharray="3,3" stroke-linecap="round"/><line x1="21" y1="17" x2="37" y2="33" stroke="#ff5722" stroke-width="2.5" stroke-dasharray="3,3" stroke-linecap="round"/><circle cx="7" cy="33" r="3.2" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="21" cy="17" r="3.2" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="37" cy="33" r="3.2" fill="#ffffff" stroke="#1e293b" stroke-width="2"/></svg>`
        },
        {
            type: 'Area / Volume',
            title: 'Area / Volume',
            desc: 'Measure area in square units or space in cubic ones',
            svg: `<svg viewBox="0 0 44 44" width="34" height="34" fill="none"><polygon points="10 16, 34 16, 37 34, 7 34" stroke="#ff5722" stroke-width="2.5" stroke-linejoin="round" fill="none"/><circle cx="10" cy="16" r="3" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="34" cy="16" r="3" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="37" cy="34" r="3" fill="#ffffff" stroke="#1e293b" stroke-width="2"/><circle cx="7" cy="34" r="3" fill="#ffffff" stroke="#1e293b" stroke-width="2"/></svg>`
        }
    ];

    const TAKEOFF_SYMBOL_ITEMS = [
        { section: 'Basic Symbols' },
        {
            id: 'Checkmark',
            label: 'Checkmark',
            svg: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
        },
        {
            id: 'Octagon',
            label: 'Octagon',
            svg: `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"/></svg>`
        },
        {
            id: 'Solid Circle',
            label: 'Circle',
            svg: `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><circle cx="12" cy="12" r="8.5"/></svg>`
        },
        {
            id: 'Square',
            label: 'Square',
            svg: `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><rect x="3.5" y="3.5" width="17" height="17" rx="1"/></svg>`
        },
        {
            id: 'Triangle',
            label: 'Triangle',
            svg: `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><polygon points="12 3 22 21 2 21"/></svg>`
        },
        {
            id: 'Cross',
            label: 'Plus',
            svg: `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><path d="M19 10.5h-5.5V5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v5.5H5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5h5.5V19c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-5.5H19c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5z"/></svg>`
        },
        {
            id: 'Pentagon',
            label: 'Pentagon',
            svg: `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><polygon points="12 2 22 9.5 18.2 21.5 5.8 21.5 2 9.5"/></svg>`
        },
        {
            id: 'Target',
            label: 'Concentric',
            svg: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>`
        },
        { divider: true },
        { section: 'Dynamic Symbols' },
        {
            id: 'Dimension',
            label: 'Dimension',
            svg: `<svg viewBox="0 0 28 20" width="22" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><text x="14" y="8" text-anchor="middle" font-size="9" font-family="sans-serif" font-weight="bold" fill="currentColor" stroke="none">x</text><line x1="3" y1="11" x2="3" y2="18"/><line x1="25" y1="11" x2="25" y2="18"/><line x1="3" y1="15" x2="25" y2="15"/></svg>`
        }
    ];

    const TAKEOFF_SIZE_ITEMS = [
        {
            id: 'X-Small',
            label: 'X-Small',
            svg: `<svg viewBox="0 0 28 28" width="20" height="20" fill="none"><circle cx="14" cy="14" r="11" stroke="var(--pcd-ring, #cbd5e1)" stroke-width="1.2"/><circle cx="14" cy="14" r="7.5" stroke="var(--pcd-ring-2, #94a3b8)" stroke-width="1.2"/><circle cx="14" cy="14" r="2.5" fill="#1e293b"/></svg>`
        },
        {
            id: 'Small',
            label: 'Small',
            svg: `<svg viewBox="0 0 28 28" width="20" height="20" fill="none"><circle cx="14" cy="14" r="9.5" stroke="var(--pcd-ring, #cbd5e1)" stroke-width="1.4"/><circle cx="14" cy="14" r="5" stroke="#1e293b" stroke-width="2"/></svg>`
        },
        {
            id: 'Medium',
            label: 'Medium',
            svg: `<svg viewBox="0 0 28 28" width="20" height="20" fill="none"><circle cx="14" cy="14" r="7.5" stroke="#1e293b" stroke-width="2.2"/></svg>`
        },
        {
            id: 'Large',
            label: 'Large',
            svg: `<svg viewBox="0 0 28 28" width="20" height="20" fill="none"><circle cx="14" cy="14" r="10.5" stroke="#1e293b" stroke-width="2.2"/></svg>`
        }
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

    function closeAllProCustomDropdowns() {
        document.querySelectorAll('.pro-custom-dropdown.is-open').forEach(dd => {
            dd.classList.remove('is-open');
        });
    }

    if (!window.__proCustomDropdownGlobalClickBound) {
        window.__proCustomDropdownGlobalClickBound = true;
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.pro-custom-dropdown')) {
                closeAllProCustomDropdowns();
            }
        });
    }

    function setupTypeDropdown(prefix, selectEl) {
        const dropdown = $(`${prefix}TypeDropdown`);
        const trigger = $(`${prefix}TypeTrigger`);
        const menu = $(`${prefix}TypeMenu`);
        if (!dropdown || !trigger || !menu) return;

        menu.innerHTML = TAKEOFF_TYPE_ITEMS.map(item => `
            <div class="pcd-item" data-type="${esc(item.type)}">
                <div class="pcd-item-icon">${item.svg}</div>
                <div class="pcd-item-content">
                    <div class="pcd-item-title">${esc(item.title)}</div>
                    <div class="pcd-item-desc">${esc(item.desc)}</div>
                </div>
            </div>
        `).join('');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            closeAllProCustomDropdowns();
            if (!isOpen) dropdown.classList.add('is-open');
        });

        menu.querySelectorAll('.pcd-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const type = itemEl.dataset.type;
                if (selectEl) {
                    selectEl.value = type;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                updateTypeDropdownTrigger(prefix, type);
                closeAllProCustomDropdowns();
            });
        });
    }

    function updateTypeDropdownTrigger(prefix, type) {
        const item = TAKEOFF_TYPE_ITEMS.find(it => it.type === type) || TAKEOFF_TYPE_ITEMS[0];
        const iconPreview = $(`${prefix}TypeIconPreview`);
        const textPreview = $(`${prefix}TypeText`);
        const menu = $(`${prefix}TypeMenu`);
        if (iconPreview) iconPreview.innerHTML = item.svg;
        if (textPreview) textPreview.textContent = item.title;
        if (menu) {
            menu.querySelectorAll('.pcd-item').forEach(el => {
                el.classList.toggle('is-selected', el.dataset.type === type);
            });
        }
    }

    const TAKEOFF_UOM_ITEMS = [
        { section: 'Count & Items' },
        { id: 'ea', label: 'ea', desc: 'Each', hint: 'Fixtures, devices, boxes', category: 'Count' },
        { id: 'pr', label: 'pr', desc: 'Pair', hint: 'Matched pairs', category: 'Count' },
        { id: 'set', label: 'set', desc: 'Set', hint: 'Assemblies, sets', category: 'Count' },
        { id: 'lot', label: 'lot', desc: 'Lot', hint: 'Lump sum packages', category: 'Count' },
        { id: 'pkg', label: 'pkg', desc: 'Package', hint: 'Standard packs', category: 'Count' },
        { id: 'box', label: 'box', desc: 'Box', hint: 'Box quantities', category: 'Count' },

        { section: 'Length & Distance' },
        { id: 'lf', label: 'lf', desc: 'Linear Feet', hint: 'Conduit, wire, piping', category: 'Length' },
        { id: 'ft', label: 'ft', desc: 'Feet', hint: 'Drop & run lengths', category: 'Length' },
        { id: 'in', label: 'in', desc: 'Inches', hint: 'Short measurements', category: 'Length' },
        { id: 'yd', label: 'yd', desc: 'Yards', hint: 'Trenching & site work', category: 'Length' },
        { id: 'm', label: 'm', desc: 'Meters', hint: 'Metric distance', category: 'Length' },
        { id: 'mm', label: 'mm', desc: 'Millimeters', hint: 'Precision metric', category: 'Length' },

        { section: 'Area & Surface' },
        { id: 'sq ft', label: 'sq ft', desc: 'Square Feet', hint: 'Floor, wall, ceiling', category: 'Area' },
        { id: 'sq yd', label: 'sq yd', desc: 'Square Yards', hint: 'Paving, turf, flooring', category: 'Area' },
        { id: 'm2', label: 'm²', desc: 'Square Meters', hint: 'Metric floor/wall', category: 'Area' },
        { id: 'acre', label: 'acre', desc: 'Acres', hint: 'Site acreage', category: 'Area' },

        { section: 'Volume & Bulk' },
        { id: 'cu yd', label: 'cu yd', desc: 'Cubic Yards', hint: 'Concrete, excavation', category: 'Volume' },
        { id: 'ft3', label: 'ft³', desc: 'Cubic Feet', hint: 'Structural volume', category: 'Volume' },
        { id: 'm3', label: 'm³', desc: 'Cubic Meters', hint: 'Metric volume', category: 'Volume' },
        { id: 'gal', label: 'gal', desc: 'Gallons', hint: 'Liquid, paint, sealant', category: 'Volume' },

        { section: 'Time & Labor' },
        { id: 'hr', label: 'hr', desc: 'Hours', hint: 'Labor hours', category: 'Time' },
        { id: 'day', label: 'day', desc: 'Days', hint: 'Daily crew / equipment', category: 'Time' },
        { id: 'wk', label: 'wk', desc: 'Weeks', hint: 'Duration schedule', category: 'Time' }
    ];

    function allowedUomCategoriesForType(type) {
        const raw = String(type || 'Count').trim();
        if (raw === 'Count' || raw === 'Count by distance') return ['Count'];
        if (raw === 'Linear' || raw.startsWith('Linear')) return ['Length'];
        if (raw === 'Area / Volume' || raw.includes('Area') || raw.includes('Volume')) return ['Area', 'Volume'];
        return ['Count', 'Length', 'Area', 'Volume', 'Time'];
    }

    function defaultUomForType(type) {
        const raw = String(type || 'Count').trim();
        if (raw === 'Count' || raw === 'Count by distance') return 'ea';
        if (raw === 'Linear' || raw.startsWith('Linear')) return 'ft';
        if (raw === 'Area / Volume' || raw.includes('Area') || raw.includes('Volume')) return 'sq ft';
        return 'ea';
    }

    function isUomValidForType(uom, type) {
        if (!uom) return false;
        const normUom = String(uom).trim().toLowerCase();
        const allowed = allowedUomCategoriesForType(type);
        const item = TAKEOFF_UOM_ITEMS.find(it => it.id && (
            it.id.toLowerCase() === normUom ||
            (normUom === 'm²' && it.id === 'm2') ||
            (normUom === 'ft³' && it.id === 'ft3') ||
            (normUom === 'cu yd' && it.id === 'cu yd') ||
            (normUom === 'yd3' && it.id === 'cu yd')
        ));
        if (!item) return true;
        return allowed.includes(item.category);
    }

    function setupUomDropdown(prefix, selectEl) {
        const dropdown = $(`${prefix}UomDropdown`);
        const trigger = $(`${prefix}UomTrigger`);
        const menu = $(`${prefix}UomMenu`);
        if (!dropdown || !trigger || !menu) return;

        let listHtml = '';
        TAKEOFF_UOM_ITEMS.forEach(item => {
            if (item.section) {
                listHtml += `<div class="pcd-section-header" data-uom-section="${esc(item.section)}">${esc(item.section)}</div>`;
            } else {
                listHtml += `
                    <div class="pcd-uom-item" data-uom="${esc(item.id)}" data-category="${esc(item.category || '')}" data-search="${esc((item.label + ' ' + item.desc + ' ' + item.id + ' ' + (item.hint || '')).toLowerCase())}">
                        <div class="pcd-uom-left">
                            <span class="pcd-uom-badge">${esc(item.label)}</span>
                            <div class="pcd-uom-info">
                                <span class="pcd-uom-name">${esc(item.desc)}</span>
                                ${item.hint ? `<span class="pcd-uom-hint">${esc(item.hint)}</span>` : ''}
                            </div>
                        </div>
                        <i class="fas fa-check pcd-uom-check"></i>
                    </div>
                `;
            }
        });

        menu.innerHTML = `
            <div class="pcd-search-wrap">
                <i class="fas fa-search pcd-search-icon"></i>
                <input type="text" class="pcd-search-input" placeholder="Search or type unit..." autocomplete="off">
            </div>
            <div class="pcd-uom-list">
                ${listHtml}
            </div>
            <div class="pcd-uom-custom-row" style="display:none;">
                <button type="button" class="pcd-uom-custom-btn">
                    <i class="fas fa-plus"></i> <span class="pcd-uom-custom-text">Use custom unit</span>
                </button>
            </div>
        `;

        const searchInput = menu.querySelector('.pcd-search-input');
        const customRow = menu.querySelector('.pcd-uom-custom-row');
        const customBtn = menu.querySelector('.pcd-uom-custom-btn');
        const customText = menu.querySelector('.pcd-uom-custom-text');

        function applyUomSelection(uom) {
            const clean = String(uom || 'ea').trim();
            if (selectEl) {
                setSelectValue(selectEl, clean);
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            updateUomDropdownTrigger(prefix, clean);
            closeAllProCustomDropdowns();
        }

        function filterItems(query) {
            const q = String(query || '').toLowerCase().trim();
            const currentType = dropdown._takeoffType || 'Count';
            const allowed = allowedUomCategoriesForType(currentType);
            const items = menu.querySelectorAll('.pcd-uom-item');
            let hasExactMatch = false;
            let firstVisible = null;

            items.forEach(el => {
                const cat = el.dataset.category || '';
                const isTypeAllowed = !cat || allowed.includes(cat);
                if (!isTypeAllowed) {
                    el.style.display = 'none';
                    return;
                }
                const uomId = (el.dataset.uom || '').toLowerCase();
                const searchData = (el.dataset.search || '').toLowerCase();
                const matches = !q || searchData.includes(q) || uomId.includes(q);
                el.style.display = matches ? 'flex' : 'none';
                if (matches) {
                    if (!firstVisible) firstVisible = el;
                    if (uomId === q) hasExactMatch = true;
                }
            });

            menu.querySelectorAll('.pcd-section-header').forEach(header => {
                if (!q) {
                    // Check if any item in this section is allowed for current type
                    let next = header.nextElementSibling;
                    let sectionHasVisible = false;
                    while (next && !next.classList.contains('pcd-section-header')) {
                        const cat = next.dataset.category || '';
                        if (next.classList.contains('pcd-uom-item') && (!cat || allowed.includes(cat))) {
                            sectionHasVisible = true;
                            break;
                        }
                        next = next.nextElementSibling;
                    }
                    header.style.display = sectionHasVisible ? 'block' : 'none';
                    return;
                }
                let next = header.nextElementSibling;
                let sectionHasVisible = false;
                while (next && !next.classList.contains('pcd-section-header')) {
                    if (next.classList.contains('pcd-uom-item') && next.style.display !== 'none') {
                        sectionHasVisible = true;
                        break;
                    }
                    next = next.nextElementSibling;
                }
                header.style.display = sectionHasVisible ? 'block' : 'none';
            });

            if (q && !hasExactMatch && customRow && customText) {
                customRow.style.display = 'block';
                customText.textContent = `Use custom unit "${q}"`;
            } else if (customRow) {
                customRow.style.display = 'none';
            }

            return { firstVisible, hasExactMatch };
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            closeAllProCustomDropdowns();
            if (!isOpen) {
                dropdown.classList.add('is-open');
                if (searchInput) {
                    searchInput.value = '';
                }
                filterItems('');
                if (searchInput) {
                    setTimeout(() => searchInput.focus(), 25);
                }
            }
        });

        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        searchInput?.addEventListener('input', (e) => {
            filterItems(e.target.value);
        });

        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = searchInput.value.trim();
                const { firstVisible } = filterItems(q);
                if (firstVisible && (!q || firstVisible.style.display !== 'none')) {
                    applyUomSelection(firstVisible.dataset.uom);
                } else if (q) {
                    applyUomSelection(q);
                }
            } else if (e.key === 'Escape') {
                closeAllProCustomDropdowns();
            }
        });

        customBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const q = searchInput?.value.trim();
            if (q) applyUomSelection(q);
        });

        menu.querySelectorAll('.pcd-uom-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                applyUomSelection(itemEl.dataset.uom);
            });
        });
    }

    function filterUomDropdownByType(prefix, type) {
        const dropdown = $(`${prefix}UomDropdown`);
        const menu = $(`${prefix}UomMenu`);
        if (!dropdown || !menu) return;
        dropdown._takeoffType = type || 'Count';
        const allowed = allowedUomCategoriesForType(dropdown._takeoffType);

        menu.querySelectorAll('.pcd-uom-item').forEach(el => {
            const cat = el.dataset.category || '';
            const isAllowed = !cat || allowed.includes(cat);
            el.dataset.typeAllowed = isAllowed ? 'true' : 'false';
            el.style.display = isAllowed ? 'flex' : 'none';
        });

        menu.querySelectorAll('.pcd-section-header').forEach(header => {
            let next = header.nextElementSibling;
            let sectionHasVisible = false;
            while (next && !next.classList.contains('pcd-section-header')) {
                if (next.classList.contains('pcd-uom-item') && next.dataset.typeAllowed === 'true') {
                    sectionHasVisible = true;
                    break;
                }
                next = next.nextElementSibling;
            }
            header.style.display = sectionHasVisible ? 'block' : 'none';
        });
    }

    function updateUomDropdownTrigger(prefix, rawUom) {
        const norm = String(rawUom || 'ea').trim();
        const textPreview = $(`${prefix}UomText`);
        const trigger = $(`${prefix}UomTrigger`);
        const menu = $(`${prefix}UomMenu`);
        
        const matchedItem = TAKEOFF_UOM_ITEMS.find(it => it.id && (
            it.id.toLowerCase() === norm.toLowerCase() ||
            (norm.toLowerCase() === 'm²' && it.id === 'm2') ||
            (norm.toLowerCase() === 'ft³' && it.id === 'ft3') ||
            (norm.toLowerCase() === 'cu yd' && it.id === 'cu yd') ||
            (norm.toLowerCase() === 'yd3' && it.id === 'cu yd')
        ));
        const displayLabel = matchedItem ? matchedItem.label : norm;
        const fullDesc = matchedItem ? `${matchedItem.desc} (${matchedItem.label})` : `Unit of Measure: ${norm}`;

        if (textPreview) {
            textPreview.textContent = displayLabel;
        }
        if (trigger) {
            trigger.title = fullDesc;
        }
        if (menu) {
            menu.querySelectorAll('.pcd-uom-item').forEach(el => {
                const uomId = (el.dataset.uom || '').toLowerCase();
                const isSelected = (uomId === norm.toLowerCase()) ||
                    (norm.toLowerCase() === 'm²' && uomId === 'm2') ||
                    (norm.toLowerCase() === 'ft³' && uomId === 'ft3') ||
                    (norm.toLowerCase() === 'cu yd' && uomId === 'cu yd') ||
                    (norm.toLowerCase() === 'yd3' && uomId === 'cu yd');
                el.classList.toggle('is-selected', Boolean(isSelected));
            });
        }
    }

    function setupSymbolDropdown(prefix, selectEl) {
        const dropdown = $(`${prefix}SymbolDropdown`);
        const trigger = $(`${prefix}SymbolTrigger`);
        const menu = $(`${prefix}SymbolMenu`);
        if (!dropdown || !trigger || !menu) return;

        let html = '';
        TAKEOFF_SYMBOL_ITEMS.forEach(item => {
            if (item.section) {
                html += `<div class="pcd-section-header">${esc(item.section)}</div>`;
            } else if (item.divider) {
                html += `<div class="pcd-divider"></div>`;
            } else {
                html += `<div class="pcd-symbol-item" data-symbol="${esc(item.id)}" title="${esc(item.label)}">
                    <span>${item.svg}</span>
                </div>`;
            }
        });
        menu.innerHTML = html;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            closeAllProCustomDropdowns();
            if (!isOpen) dropdown.classList.add('is-open');
        });

        menu.querySelectorAll('.pcd-symbol-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const sym = itemEl.dataset.symbol;
                if (selectEl) {
                    selectEl.value = sym;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                updateSymbolDropdownTrigger(prefix, sym);
                closeAllProCustomDropdowns();
            });
        });
    }

    function updateSymbolDropdownTrigger(prefix, rawSymbol) {
        const norm = takeoffDisplaySymbol(rawSymbol);
        const item = TAKEOFF_SYMBOL_ITEMS.find(it => it.id === norm) || TAKEOFF_SYMBOL_ITEMS.find(it => it.id === 'Solid Circle');
        const preview = $(`${prefix}SymbolPreview`);
        const menu = $(`${prefix}SymbolMenu`);
        if (preview && item) preview.innerHTML = item.svg;
        if (menu) {
            menu.querySelectorAll('.pcd-symbol-item').forEach(el => {
                el.classList.toggle('is-selected', el.dataset.symbol === norm);
            });
        }
    }

    function setupSizeDropdown(prefix, selectEl) {
        const dropdown = $(`${prefix}SizeDropdown`);
        const trigger = $(`${prefix}SizeTrigger`);
        const menu = $(`${prefix}SizeMenu`);
        if (!dropdown || !trigger || !menu) return;

        menu.innerHTML = TAKEOFF_SIZE_ITEMS.map(item => `
            <div class="pcd-size-item" data-size="${esc(item.id)}" title="${esc(item.label)}">
                <span>${item.svg}</span>
            </div>
        `).join('');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            closeAllProCustomDropdowns();
            if (!isOpen) dropdown.classList.add('is-open');
        });

        menu.querySelectorAll('.pcd-size-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const sz = itemEl.dataset.size;
                if (selectEl) {
                    selectEl.value = sz;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                updateSizeDropdownTrigger(prefix, sz);
                closeAllProCustomDropdowns();
            });
        });
    }

    function updateSizeDropdownTrigger(prefix, rawSize) {
        const norm = takeoffDisplaySize(rawSize);
        const item = TAKEOFF_SIZE_ITEMS.find(it => it.id === norm) || TAKEOFF_SIZE_ITEMS.find(it => it.id === 'Medium');
        const preview = $(`${prefix}SizePreview`);
        const menu = $(`${prefix}SizeMenu`);
        if (preview && item) preview.innerHTML = item.svg;
        if (menu) {
            menu.querySelectorAll('.pcd-size-item').forEach(el => {
                el.classList.toggle('is-selected', el.dataset.size === norm);
            });
        }
    }

    function setupColorDropdown(prefix, selectEl, customPickerEl) {
        const dropdown = $(`${prefix}ColorDropdown`);
        const trigger = $(`${prefix}ColorTrigger`);
        const menu = $(`${prefix}ColorMenu`);
        if (!dropdown || !trigger || !menu) return;

        menu.innerHTML = TAKEOFF_RICH_COLORS.map(color => `
            <div class="pcd-color-item" data-color="${color}">
                <span class="pcd-color-circle" style="background:${color};"></span>
            </div>
        `).join('');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            closeAllProCustomDropdowns();
            if (!isOpen) dropdown.classList.add('is-open');
        });

        menu.querySelectorAll('.pcd-color-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const color = itemEl.dataset.color;
                if (prefix === 'createLayer') {
                    setCreateLayerColor(color);
                } else {
                    setLayerColor(color);
                }
                closeAllProCustomDropdowns();
            });
        });
    }

    function updateColorDropdownTrigger(prefix, hex) {
        const swatch = $(`${prefix}ColorSwatch`);
        const menu = $(`${prefix}ColorMenu`);
        if (swatch) swatch.style.background = hex;
        if (menu) {
            menu.querySelectorAll('.pcd-color-item').forEach(el => {
                const match = el.dataset.color?.toLowerCase() === String(hex || '').toLowerCase();
                el.classList.toggle('is-selected', match);
            });
        }
    }

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
        activeLayerId: null,
        selectedGroupIds: [],
        selectedLayerIds: []
    };
    let draggedTakeoffGroupId = null;
    let suppressNextGroupToggle = false;

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

    function defaultGroup(estimateId = null) {
        const scopedId = estimateId ? `default_${estimateId}` : 'default';
        return { id: scopedId, estimateId, name: 'Default Group', isExpanded: true, isDefault: true, layers: [] };
    }

    function takeoffLayerMetadata(layer) {
        if (layer?.metadata_json && typeof layer.metadata_json === 'object') return layer.metadata_json;
        try { return JSON.parse(layer?.metadata_json || '{}') || {}; } catch (_) { return {}; }
    }

    function layerCatalogMetadata(layer) {
        return window.CatalogMetadata.fromLayer(layer);
    }

    function seedGroupsFromProjectLayers() {
        const groups = [];
        const byName = new Map();
        (window.ProjectState?.takeoffLayers || []).forEach((layer, index) => {
            const metadata = takeoffLayerMetadata(layer);
            const groupName = layer.group_name || 'Default Group';
            const estimateId = metadata.estimate_id || null;
            const groupKey = `${estimateId || 'legacy'}:${metadata.estimating_group_id || groupName}`;
            let group = byName.get(groupKey);
            if (!group) {
                group = {
                    id: metadata.estimating_group_id ? `estgrp_${estimateId}_${metadata.estimating_group_id}` : makeId('grp'),
                    name: groupName, estimateId,
                    estimatingGroupId: metadata.estimating_group_id || null,
                    isExpanded: true, isDefault: false, layers: []
                };
                byName.set(groupKey, group);
                groups.push(group);
            }
            const type = normalizeTakeoffType(layer.takeoff_type || layer.type);
            const layerTag = metadata.tag || layer.tag || layer.cost_code || layer.costCode || '';
            group.layers.push({
                id: String(layer.integration_key || layer.id || makeId('layer')),
                groupId: group.id,
                estimateId,
                estimatingItemId: metadata.estimating_item_id || null,
                estimatingGroupId: metadata.estimating_group_id || null,
                name: layer.name || layer.title || `Takeoff Item ${index + 1}`,
                tag: layerTag,
                costCode: layerTag,
                type,
                uom: layer.unit_of_measure || typeToUom(type),
                symbol: layer.symbol || 'Solid Circle',
                size: layer.symbol_size || 'Medium',
                color: layer.color || '#111827',
                visible: layer.visible !== false,
                locked: Number(layer.locked || 0) === 1,
                quantity: Number(layer.quantity || layer.count || layer.measurement_count || 0),
                // `quantity`, `count`, and `measurement_count` are calculated
                // takeoff totals returned by the API. Treating one of them as
                // a seed makes every saved shape count twice after reload and
                // causes the next canvas event to jump the displayed total.
                baseQuantity: Number(layer.baseQuantity ?? layer.seedQuantity ?? layer.seed_quantity ?? 0),
                catalogItemId: layer.catalog_item_id || layer.catalogItemId || null,
                catalog_item_id: layer.catalog_item_id || layer.catalogItemId || null,
                unitCost: Number(layer.unit_cost || layer.unitCost || 0),
                unit_cost: Number(layer.unit_cost || layer.unitCost || 0),
                laborHours: Number(layer.labor_hours || layer.laborHours || 0),
                labor_hours: Number(layer.labor_hours || layer.laborHours || 0),
                category: layer.category || layer.catalog_name || layer.group_name || '',
                description: layer.description || '',
                catalogNumber: layer.catalog_number || layer.catalogNumber || layer.sku || layer.cost_code || '',
                itemType: layer.item_type || layer.itemType || '',
                catalogMetadata: window.CatalogMetadata.clone(metadata.catalog_item || null),
                metadata_json: window.CatalogMetadata.clone(metadata),
                dropLength: Number(layer.dropLength || layer.drop_length || 0),
                spacing: Number(layer.spacing || 0),
                height: Number(layer.height || 0),
                depth: Number(layer.depth || 0)
            });
        });
        return groups;
    }

    function normalizeSavedGroups(groups) {
        const result = [];
        (groups || []).forEach(group => {
            result.push({
                id: group.id || makeId('grp'),
                estimateId: group.estimateId || null,
                estimatingGroupId: group.estimatingGroupId || null,
                name: group.name || 'New Group',
                isExpanded: group.isExpanded !== false,
                isDefault: Boolean(group.isDefault),
                layers: group.layers || []
            });
        });
        return result.map(group => ({
            ...group,
            layers: (group.layers || []).map(layer => ({
                id: layer.id || makeId('layer'),
                groupId: group.id,
                estimateId: layer.estimateId || group.estimateId || null,
                estimatingItemId: layer.estimatingItemId || null,
                estimatingGroupId: layer.estimatingGroupId || group.estimatingGroupId || null,
                name: layer.name || 'New Takeoff Layer',
                tag: layer.tag || layer.costCode || layer.cost_code || '',
                costCode: layer.costCode || layer.tag || layer.cost_code || '',
                type: normalizeTakeoffType(layer.type),
                uom: layer.uom || typeToUom(normalizeTakeoffType(layer.type)),
                symbol: layer.symbol || 'Solid Circle',
                size: layer.size || 'Medium',
                color: layer.color || '#111827',
                visible: layer.visible !== false,
                locked: Number(layer.locked || 0) === 1,
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
                catalogNumber: layer.catalogNumber || layer.catalog_number || layer.costCode || layer.cost_code || '',
                itemType: layer.itemType || layer.item_type || '',
                dropLength: Number(layer.dropLength || layer.drop_length || 0),
                spacing: Number(layer.spacing || 0),
                height: Number(layer.height || 0),
                depth: Number(layer.depth || 0)
            }))
        }));
    }

    function saveTakeoffState() {
        takeoffIsDirty = true;
        try {
            const pId = String(window.ProjectState?.projectId || 0);
            localStorage.setItem('takeoff_project_groups_' + pId, JSON.stringify(takeoffState.groups));
        } catch (_) { }
        syncTakeoffToEstimating();
    }

    function pushTakeoffHistory(reason = 'change') {
        takeoffIsDirty = true;
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
        if (!groupId) return null;
        return takeoffState.groups.find(group => String(group.id) === String(groupId))
            || takeoffState.groups.find(group => String(group.estimatingGroupId || '') === String(groupId))
            || null;
    }

    function findGroupExact(groupId) {
        if (!groupId) return null;
        return takeoffState.groups.find(group => String(group.id) === String(groupId)
            && groupBelongsToEstimate(group)) || null;
    }

    function findLayer(layerId) {
        const id = String(layerId ?? '');
        return allLayers().find(layer => String(layer.id) === id) || null;
    }

    function groupForLayer(layer) {
        return takeoffState.groups.find(group => String(group.id) === String(layer?.groupId))
            || takeoffState.groups.find(group => groupBelongsToEstimate(group, layer?.estimateId))
            || defaultGroup(layer?.estimateId || activeEstimateId());
    }

    function estimatingStoreKey() {
        return `takeoff.estimating.module.${window.ProjectState?.projectId || 'draft'}`;
    }

    function loadEstimatingStateForSync() {
        try {
            const parsed = JSON.parse(localStorage.getItem(estimatingStoreKey()) || 'null');
            if (parsed && (Array.isArray(parsed.groups) || Array.isArray(parsed.estimates))) return parsed;
        } catch (e) { }
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

    function renderTakeoffEstimateFooter(source = null) {
        const footer = $('takeoffEstimateTypesFooter');
        if (!footer) return;
        const published = source?.detail && Array.isArray(source.detail.estimates)
            ? { estimates: source.detail.estimates, activeEstimateId: source.detail.activeEstimateId }
            : null;
        const state = published || loadEstimatingStateForSync();
        const estimates = Array.isArray(state?.estimates) ? state.estimates : [];
        const activeId = String(state?.activeEstimateId || estimates[0]?.id || '');
        footer.innerHTML = window.ProjectEstimateFooter.render({
            estimates,
            activeEstimateId: activeId,
            selectAttribute: 'data-takeoff-estimate-id',
            actionAttribute: 'data-takeoff-estimating-action',
            menuAttribute: 'data-takeoff-estimate-menu',
            itemActionAttribute: 'data-takeoff-estimate-action',
            showCompare: false
        });
        window.ProjectEstimateFooter.bindMenus?.(footer, {
            menuAttribute: 'data-takeoff-estimate-menu',
            itemActionAttribute: 'data-takeoff-estimate-action',
            onAction: (action, estimateId) => window.dispatchEvent(new CustomEvent('takeoff:estimating-estimate-action-requested', {
                detail: { action, estimateId, sourceTab: 'takeoff', projectId: String(window.ProjectState?.projectId || '') }
            }))
        });
    }

    function activateEstimate(estimateId) {
        if (String(takeoffState.activeEstimateId) === String(estimateId)) return;
        takeoffState.activeEstimateId = String(estimateId);

        const tree = $('takeoffItemsTree');
        if (tree) {
            tree.innerHTML = `
                <div class="pro-tree-loading">
                    <div class="pro-tree-spinner"></div>
                    <span>Loading estimate takeoff...</span>
                </div>
            `;
        }

        const state = loadEstimatingStateForSync();
        if (!state || !Array.isArray(state.estimates) || !state.estimates.some(estimate => String(estimate.id) === String(estimateId))) return;
        window.dispatchEvent(new CustomEvent('takeoff:active-estimate-changed', { detail: { projectId: String(window.ProjectState?.projectId || ''), estimateId } }));
    }

    function activeEstimateId() {
        if (takeoffState.activeEstimateId) return String(takeoffState.activeEstimateId);
        const estimating = loadEstimatingStateForSync();
        return String(estimating.activeEstimateId || estimating.estimates?.[0]?.id || 'est_primary');
    }

    function primaryEstimateId() {
        const estimating = loadEstimatingStateForSync();
        return String(estimating.estimates?.[0]?.id || estimating.activeEstimateId || 'est_primary');
    }

    function groupBelongsToEstimate(group, estimateId = activeEstimateId()) {
        return String(group?.estimateId || '') === String(estimateId || '');
    }

    function ensureEstimateTakeoffWorkspace(estimateId = activeEstimateId(), createDefault = false) {
        let scopedGroups = takeoffState.groups.filter(group => groupBelongsToEstimate(group, estimateId));
        if (scopedGroups.length === 0 && createDefault) {
            const isTemplate = Boolean(window.ProjectState?.projectInfo?.project_template_id || new URLSearchParams(window.location.search).get('template_id'));
            if (!isTemplate) {
                const defGroup = defaultGroup(estimateId);
                takeoffState.groups.unshift(defGroup);
                scopedGroups = [defGroup];
            }
        }
        if (!scopedGroups.some(group => group.id === takeoffState.activeGroupId)) {
            takeoffState.activeGroupId = scopedGroups[0]?.id || null;
        }
        if (takeoffState.activeLayerId && !layerBelongsToEstimate(findLayer(takeoffState.activeLayerId), estimateId)) {
            takeoffState.activeLayerId = null;
        }
    }

    function scopeLegacyTakeoffGroupsOnce() {
        const primaryId = primaryEstimateId();
        takeoffState.groups.forEach(group => {
            if (!group.estimateId) group.estimateId = primaryId;
            (group.layers || []).forEach(layer => {
                if (!layer.estimateId) layer.estimateId = group.estimateId || primaryId;
            });
        });
    }

    function layerBelongsToEstimate(layer, estimateId = activeEstimateId()) {
        return Boolean(layer) && String(layer.estimateId || '') === String(estimateId || '');
    }

    function syncEstimatingItemsToTakeoff(detail = {}) {
        if (detail.projectId && String(detail.projectId) !== String(window.ProjectState?.projectId || '')) return;
        const estimateId = String(detail.activeEstimateId || '');
        if (!estimateId || estimateId !== activeEstimateId() || !Array.isArray(detail.groups)) return;
        ensureEstimateTakeoffWorkspace(estimateId);
        const seen = new Set();
        const pendingLinks = [];
        const orderedGroupIds = [];
        detail.groups.forEach((estimateGroup, groupIndex) => {
            const groupKey = String(estimateGroup.id || `group_${groupIndex}`);
            let group = takeoffState.groups.find(row => String(row.estimateId || '') === estimateId
                && (String(row.estimatingGroupId || '') === groupKey
                    || String(row.id || '') === groupKey
                    || groupKey.endsWith('_' + String(row.id || ''))
                    || (row.name && row.name.trim().toLowerCase() === (estimateGroup.name || '').trim().toLowerCase())));
            if (!group) {
                group = {
                    id: `estgrp_${estimateId}_${groupKey}`, estimatingGroupId: groupKey,
                    estimateId, name: estimateGroup.name || 'Default Group', isExpanded: true, isDefault: false, layers: []
                };
                takeoffState.groups.push(group);
            }
            group.estimatingGroupId = groupKey;
            group.name = estimateGroup.name || group.name;
            group.sortOrder = groupIndex;
            orderedGroupIds.push(String(group.id));
            (estimateGroup.items || []).forEach(item => {
                const itemId = String(item.id || '');
                if (!itemId) return;
                const layerId = String(item.takeoffLayerId || `estitem_${estimateId}_${itemId}`);
                const layerMatchesEstimatingItem = (row) => {
                    if (String(row.estimatingItemId || '') === itemId) return true;
                    const itemKeys = [
                        String(item.takeoffLayerId || ''),
                        item.takeoffLayerId && String(item.takeoffLayerId).startsWith('takeoff_') ? String(item.takeoffLayerId).slice(8) : '',
                        itemId.startsWith('takeoff_') ? itemId.slice(8) : '',
                        String(item.source_layer_key || '')
                    ].filter(Boolean);
                    if (itemKeys.length) {
                        const rowKeys = [
                            String(row.id || ''),
                            String(row.integration_key || ''),
                            String(row.client_uid || ''),
                            String(row.metadata_json?.project_layer_id || ''),
                            String(row.metadata?.project_layer_id || '')
                        ].filter(Boolean);
                        if (itemKeys.some(k => rowKeys.includes(k))) return true;
                    }
                    return String(row.id) === layerId;
                };
                let layer = allLayers().find(row => (String(row.estimateId || '') === estimateId || !row.estimateId)
                    && layerMatchesEstimatingItem(row));
                if (!layer) {
                    layer = {
                        id: layerId, groupId: group.id, estimateId, estimatingItemId: itemId,
                        name: item.name || 'Cost item', type: inferTakeoffTypeFromUom(item.uom) || 'Count',
                        uom: item.uom || 'ea', symbol: 'Solid Circle', size: 'Medium', color: '#2563eb',
                        visible: true, locked: false, quantity: Number(item.quantity || 0),
                        baseQuantity: Number(item.quantity || 0), catalogItemId: item.catalogItemId || null,
                        catalog_item_id: item.catalogItemId || null, unitCost: Number(item.unitMaterialCost || 0),
                        unit_cost: Number(item.unitMaterialCost || 0), laborHours: Number(item.unitLabor || 0),
                        labor_hours: Number(item.unitLabor || 0), description: item.description || '',
                        catalogNumber: item.costCode || item.budgetCode || '', itemType: item.itemType || 'part'
                    };
                    group.layers.push(layer);
                } else {
                    const oldGroup = groupForLayer(layer);
                    if (oldGroup !== group) {
                        oldGroup.layers = oldGroup.layers.filter(row => row !== layer);
                        group.layers.push(layer); layer.groupId = group.id;
                    }
                    Object.assign(layer, {
                        estimateId, estimatingItemId: itemId, name: item.name || layer.name,
                        uom: item.uom || layer.uom, catalogItemId: item.catalogItemId || null,
                        catalog_item_id: item.catalogItemId || null, unitCost: Number(item.unitMaterialCost || 0),
                        unit_cost: Number(item.unitMaterialCost || 0), laborHours: Number(item.unitLabor || 0),
                        labor_hours: Number(item.unitLabor || 0), description: item.description || ''
                    });
                }
                seen.add(String(layer.id));
                if (!item.takeoffLayerId) pendingLinks.push({ itemId, layerId: String(layer.id) });
            });
        });
        takeoffState.groups.forEach(group => {
            group.layers = (group.layers || []).filter(layer => String(layer.estimateId || '') !== estimateId
                || !layer.estimatingItemId || seen.has(String(layer.id)));
        });
        const scopedIndexes = takeoffState.groups.map((group, index) => groupBelongsToEstimate(group, estimateId) ? index : -1).filter(index => index >= 0);
        const order = new Map(orderedGroupIds.map((id, index) => [id, index]));
        const scopedGroups = scopedIndexes.map(index => takeoffState.groups[index]).sort((a, b) =>
            (order.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));
        scopedGroups.forEach((group, index) => { takeoffState.groups[scopedIndexes[index]] = group; });
        if (takeoffState.activeLayerId && !layerBelongsToEstimate(findLayer(takeoffState.activeLayerId), estimateId)) {
            takeoffState.activeLayerId = null;
        }
        if (pendingLinks.length) window.dispatchEvent(new CustomEvent('takeoff:estimating-links-requested', {
            detail: {
                version: 1, origin: 'takeoff', projectId: String(window.ProjectState?.projectId || ''),
                estimateId, links: pendingLinks
            }
        }));
        const editorReloading = ensureEditorEstimate(estimateId);
        if (!editorReloading) syncAllLayersToCanvas({ suppressEstimatingSync: true });
        renderTakeoffPanel(); renderActiveLayerToolbar();
    }

    function estimateLineFromLayer(layer) {
        const group = groupForLayer(layer);
        const itemType = layer.itemType || layer.item_type || (String(layer.category || '').toLowerCase().includes('labor') ? 'Labor' : 'Materials');
        return {
            id: `takeoff_${layer.id}`,
            takeoffLayerId: String(layer.id),
            catalogItemId: layer.catalogItemId || layer.catalog_item_id || null,
            catalogMetadata: layerCatalogMetadata(layer),
            name: layer.name || 'Takeoff item',
            description: layer.description || '',
            type: itemType,
            itemType,
            budgetCode: layer.catalogNumber || layer.catalog_number || '',
            costCode: layer.catalogNumber || layer.catalog_number || '',
            costCategory: itemType,
            originalQuantity: Number(layer.quantity || 0),
            quantity: Number(layer.quantity || 0),
            unitCost: Number(layer.unitCost || layer.unit_cost || 0),
            unitMaterialCost: Number(layer.unitCost || layer.unit_cost || 0),
            waste: 0,
            margin: 0,
            unitLabor: Number(layer.laborHours || layer.labor_hours || 0),
            laborRate: 85,
            laborUnitType: 'hrs',
            difficulty: 1,
            laborMargin: 0,
            notes: `Synced from Takeoff${group?.name ? ` / ${group.name}` : ''}`,
            taxable: true,
            groupId: group?.id || 'default',
            groupName: group?.name || 'Default Group',
            uom: layer.uom || typeToUom(layer.type),
            projectId: String(window.ProjectState?.projectId || ''),
            estimateId: String(layer.estimateId || activeEstimateId()),
            estimatingItemId: layer.estimatingItemId || null
        };
    }

    function syncTakeoffToEstimating() {
        const state = loadEstimatingStateForSync();
        const activeEstimate = Array.isArray(state.estimates)
            ? (state.estimates.find(estimate => String(estimate.id) === String(state.activeEstimateId)) || state.estimates[0])
            : null;
        const currentGroups = activeEstimate?.groups || state.groups || [];
        const existingByLayerId = new Map();
        const manualByGroupName = new Map();
        const layerByEstimatingItemId = new Map(allLayers()
            .filter(layer => layerBelongsToEstimate(layer, state.activeEstimateId) && layer.estimatingItemId)
            .map(layer => [String(layer.estimatingItemId), layer]));

        currentGroups.forEach(group => {
            (group.items || []).forEach(item => {
                if (item.takeoffLayerId) {
                    const key = String(item.takeoffLayerId);
                    if (!existingByLayerId.has(key)) existingByLayerId.set(key, item);
                    if (key.startsWith('takeoff_') && !existingByLayerId.has(key.slice(8))) {
                        existingByLayerId.set(key.slice(8), item);
                    }
                    if (item.source_layer_key && !existingByLayerId.has(String(item.source_layer_key))) {
                        existingByLayerId.set(String(item.source_layer_key), item);
                    }
                    if (item.id && String(item.id).startsWith('takeoff_') && !existingByLayerId.has(String(item.id).slice(8))) {
                        existingByLayerId.set(String(item.id).slice(8), item);
                    }
                    return;
                }
                const linkedLayer = layerByEstimatingItemId.get(String(item.id));
                if (linkedLayer) {
                    existingByLayerId.set(String(linkedLayer.id), item);
                    if (linkedLayer.integration_key) existingByLayerId.set(String(linkedLayer.integration_key), item);
                    return;
                }
                if (item.id && String(item.id).startsWith('takeoff_')) {
                    const rawKey = String(item.id).slice(8);
                    if (!existingByLayerId.has(rawKey)) existingByLayerId.set(rawKey, item);
                    return;
                }
                const name = group.name || 'Default Group';
                if (!manualByGroupName.has(name)) manualByGroupName.set(name, []);
                manualByGroupName.get(name).push(item);
            });
        });

        const projectedLayerIds = new Set();
        const targetEstimateId = String(state.activeEstimateId || '');
        const scopedTakeoffGroups = takeoffState.groups.filter(group => groupBelongsToEstimate(group, targetEstimateId));
        const projectedGroups = scopedTakeoffGroups.map((takeoffGroup, groupIndex) => {
            const groupName = takeoffGroup.name || 'Default Group';
            const groupId = String(takeoffGroup.estimatingGroupId || `takeoff_group_${String(takeoffGroup.id || groupIndex)}`);
            takeoffGroup.estimatingGroupId = groupId;
            const items = (takeoffGroup.layers || []).filter(layer => layerBelongsToEstimate(layer, targetEstimateId)).filter(layer => {
                const layerId = String(layer.id);
                if (projectedLayerIds.has(layerId)) return false;
                projectedLayerIds.add(layerId);
                return true;
            }).map(layer => {
                const line = estimateLineFromLayer(layer);
                const existing = existingByLayerId.get(String(layer.id))
                    || (layer.integration_key ? existingByLayerId.get(String(layer.integration_key)) : null)
                    || (layer.client_uid ? existingByLayerId.get(String(layer.client_uid)) : null)
                    || (layer.metadata_json?.project_layer_id ? existingByLayerId.get(String(layer.metadata_json.project_layer_id)) : null)
                    || (layer.estimatingItemId ? existingByLayerId.get(String(layer.estimatingItemId)) : null);
                const synchronized = window.TakeoffEstimatingSyncService?.takeoffItem
                    ? window.TakeoffEstimatingSyncService.takeoffItem({ ...line, id: layer.id },
                        { id: groupId, name: groupName }, existing)
                    : { ...(existing || {}), ...line };
                return {
                    ...line,
                    ...synchronized,
                    id: existing?.id || line.id,
                    groupId,
                    groupName,
                    originalQuantity: line.quantity,
                    quantity: line.quantity,
                    pendingTakeoffQuantity: null,
                    quantityOverride: false,
                    quantitySource: 'takeoff',
                    quantitySyncStatus: 'synced',
                    lastSyncedTakeoffQuantity: line.quantity,
                    catalogSyncStatus: line.catalogItemId ? 'synced' : 'detached',
                    updatedAt: new Date().toISOString()
                };
            });
            items.push(...(manualByGroupName.get(groupName) || []));
            manualByGroupName.delete(groupName);
            const currentGroup = currentGroups.find(row => String(row.id) === groupId
                || String(row.takeoffGroupId || '') === String(takeoffGroup.id || groupIndex));
            return {
                id: groupId,
                takeoffGroupId: String(takeoffGroup.id || groupIndex),
                source: 'takeoff',
                type: 'group',
                name: groupName,
                expanded: currentGroup ? currentGroup.expanded !== false : takeoffGroup.isExpanded !== false,
                sortOrder: groupIndex,
                items
            };
        }).filter(group => group.items.length || currentGroups.some(row => row.name === group.name));

        // Manual estimating items remain intact. Empty and takeoff-only legacy groups
        // intentionally disappear so deleted/renamed Takeoff folders cannot accumulate.
        manualByGroupName.forEach((items, name) => {
            if (!items.length) return;
            const previous = currentGroups.find(group => group.name === name && (group.items || []).some(item => !item.takeoffLayerId));
            projectedGroups.push({
                ...(previous || {}),
                id: previous?.id || makeId('estgrp'),
                name,
                expanded: previous?.expanded !== false,
                sortOrder: projectedGroups.length,
                items
            });
        });

        state.groups = projectedGroups;
        if (activeEstimate) activeEstimate.groups = projectedGroups;
        try {
            window.dispatchEvent(new CustomEvent('takeoff:estimating-lines-updated', {
                detail: {
                    version: 2,
                    projectId: String(window.ProjectState?.projectId || ''),
                    activeEstimateId: String(state.activeEstimateId || ''),
                    authoritative: true,
                    complete: true,
                    groups: projectedGroups,
                    layerIds: Array.from(projectedLayerIds)
                }
            }));
        } catch (e) {
            console.warn('Estimating sync failed', e);
        }
    }

    function layerCanvasPayload(layer) {
        return {
            id: layer.id,
            name: layer.name,
            tag: layer.tag || layer.costCode || '',
            cost_code: layer.tag || layer.costCode || '',
            takeoff_type: layer.type.toLowerCase(),
            type: layer.type.toLowerCase(),
            unit_of_measure: layer.uom,
            uom: layer.uom,
            symbol: layer.symbol,
            symbol_size: layer.markerDiameter ? layer.markerDiameter / 2 : layer.size,
            size: layer.markerDiameter ? layer.markerDiameter / 2 : layer.size,
            marker_diameter: layer.markerDiameter || takeoffSizeRadius(layer.size) * 2,
            stroke_width: layer.strokeWidth || 4,
            color: layer.color,
            quantity: layer.quantity,
            baseQuantity: layer.baseQuantity || 0,
            catalog_item_id: layer.catalogItemId || null,
            unit_cost: layer.unitCost || 0,
            labor_hours: layer.laborHours || 0,
            catalogMetadata: layerCatalogMetadata(layer),
            category: layer.category || groupForLayer(layer)?.name || '',
            group_name: groupForLayer(layer)?.name || 'Default Group',
            description: layer.description || '',
            dropLength: layer.dropLength || 0,
            spacing: layer.spacing || 0,
            height: layer.height || 0,
            depth: layer.depth || 0,
            estimate_id: layer.estimateId || activeEstimateId(),
            estimating_item_id: layer.estimatingItemId || null,
            estimating_group_id: groupForLayer(layer)?.estimatingGroupId || null,
            visible: layer.visible !== false && layerBelongsToEstimate(layer),
            locked: Boolean(layer.locked)
        };
    }

    function syncAllLayersToCanvas(options = {}) {
        const payload = allLayers().filter(layer => layerBelongsToEstimate(layer)).map(layerCanvasPayload);
        const snapshot = callEditor('projectTakeoffSyncLayers', payload);
        if (snapshot) syncTakeoffFromCanvasSnapshot(snapshot, options);
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
            'Checkmark': '<i class="fas fa-check"></i>',
            'Octagon': '<i class="fas fa-stop"></i>',
            'Square': '<i class="fas fa-square"></i>',
            'Triangle': '<i class="fas fa-play fa-rotate-270"></i>',
            'Diamond': '<i class="fas fa-diamond"></i>',
            'Cross': '<i class="fas fa-plus"></i>',
            'Pentagon': '<i class="fas fa-draw-polygon"></i>',
            'Target': '<i class="fas fa-bullseye"></i>',
            'Dimension': '<i class="fas fa-arrows-left-right-to-line"></i>'
        };
        return map[layer.symbol] || '<i class="fas fa-circle"></i>';
    }

    function isLinearType(type) {
        return ['Linear', 'Linear with drop', 'Linear avg. with drop'].includes(type);
    }

    function isAreaType(type) {
        return ['Area', 'Area / Volume', 'Vertical wall area'].includes(type);
    }

    function itemQuantitySubtitle(layer) {
        const qty = Number(layer.quantity || 0);
        const formatted = qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2);
        const uom = layer.uom || typeToUom(layer.type) || 'ft';
        if (layer.type === 'Linear avg. with drop' || String(layer.type).toLowerCase().includes('avg')) {
            return `${formatted} ${uom} avg. (${formatted} ${uom})`;
        }
        if (layer.type === 'Linear with drop') {
            return `${formatted} ${uom} (${formatted} ${uom})`;
        }
        if (isLinearType(layer.type)) {
            return `${formatted} ${uom} avg. (${formatted} ${uom})`;
        }
        return `${formatted} ${uom}`;
    }

    function toggleGroupLock(groupId) {
        const group = findGroup(groupId);
        if (!group) return;
        const layers = group.layers || [];
        const shouldLock = !layers.every(layer => {
            const editorState = callEditor('projectTakeoffGetLayerLockState', layer.id) || {};
            return Boolean(layer.locked || editorState.locked);
        });
        group.locked = shouldLock;
        layers.forEach(layer => {
            layer.locked = shouldLock;
            callEditor('projectTakeoffSetLayerLocked', layer.id, shouldLock);
        });
        pushTakeoffHistory(shouldLock ? 'lock-group' : 'unlock-group');
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function renderTakeoffPanel() {
        const tree = $('takeoffItemsTree');
        const title = $('takeoffPanelTitle');
        const activeLabel = $('takeoffActiveLayerLabel');
        if (!tree) return;
        const q = takeoffState.query;
        const estimateId = activeEstimateId();
        ensureEstimateTakeoffWorkspace(estimateId, true);
        const layersCount = allLayers().filter(layer => layerBelongsToEstimate(layer, estimateId)).length;
        if (title) title.textContent = `Takeoffs (${layersCount})`;
        const activeLayer = findLayer(takeoffState.activeLayerId);
        if (activeLabel) activeLabel.textContent = activeLayer ? activeLayer.name : 'None';
        renderActiveLayerToolbar();
        renderInspector();
        renderWorkspaceSummary();
        tree.innerHTML = takeoffState.groups.filter(group => groupBelongsToEstimate(group, estimateId)).map(group => {
            const visibleLayers = (group.layers || []).filter(layer => layerBelongsToEstimate(layer, estimateId)).filter(layer => {
                if (!q) return true;
                return group.name.toLowerCase().includes(q) || layer.name.toLowerCase().includes(q) || layer.type.toLowerCase().includes(q);
            });
            const groupVisible = !q || group.name.toLowerCase().includes(q) || visibleLayers.length > 0;
            if (!groupVisible) return '';
            const expanded = q ? true : group.isExpanded !== false;
            const groupSelected = selectionState.selectedGroupIds.includes(String(group.id));
            const groupLocked = (group.layers || []).length > 0 && (group.layers || []).every(layer => {
                const editorLockState = callEditor('projectTakeoffGetLayerLockState', layer.id) || {};
                return Boolean(layer.locked || editorLockState.locked);
            });
            const hasVisibleChild = visibleLayers.some(layer => layer.visible !== false);

            const isFolderActive = groupSelected;

            return `<div class="pro-takeoff-group" data-group-id="${esc(group.id)}">
                <div class="pro-tree-row pro-tree-folder ${isFolderActive ? 'active' : ''} ${groupSelected ? 'group-selected' : ''}" data-takeoff-group-row="${esc(group.id)}" role="button" tabindex="0" aria-selected="${groupSelected ? 'true' : 'false'}">
                    <button class="pro-visibility-btn ${hasVisibleChild ? '' : 'is-off'}" type="button" data-group-visibility="${esc(group.id)}" title="Show or hide group" aria-label="Show or hide group"><i class="fas ${hasVisibleChild ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                    <input type="checkbox" class="pro-group-select-check" ${groupSelected ? 'checked' : ''} aria-label="Select all items in group" data-group-select="${esc(group.id)}">
                    <div class="pro-tree-folder-title">
                        <button class="pro-tree-toggle" type="button" draggable="true" data-group-toggle="${esc(group.id)}" title="Click arrow to expand/collapse; drag to reorder" aria-label="Expand or drag group"><i class="fas ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i></button>
                        <span class="pro-tree-name" data-group-name-wrap="${esc(group.id)}" title="Double-click to rename"><strong>${esc(group.name)}</strong></span>
                    </div>
                    <div class="pro-tree-row-actions">
                        <button class="pro-folder-lock-btn ${groupLocked ? 'is-locked' : ''}" type="button" data-group-lock="${esc(group.id)}" title="${groupLocked ? 'Unlock folder' : 'Lock folder'}" aria-label="${groupLocked ? 'Unlock folder' : 'Lock folder'}"><i class="fas ${groupLocked ? 'fa-lock' : 'fa-lock-open'}"></i></button>
                        <button class="pro-row-menu-btn" type="button" data-group-menu="${esc(group.id)}" title="Folder properties" aria-label="Folder properties"><i class="fas fa-ellipsis-vertical"></i></button>
                    </div>
                </div>
                <div class="pro-tree-children" ${expanded ? '' : 'hidden'}>
                    ${visibleLayers.map(layer => {
                const isVisible = layer.visible !== false;
                const editorLockState = callEditor('projectTakeoffGetLayerLockState', layer.id) || {};
                const isLocked = Boolean(layer.locked || editorLockState.locked);
                const subText = itemQuantitySubtitle(layer);
                const isLayerSelected = !isLocked && (String(takeoffState.activeLayerId || '') === String(layer.id) || selectionState.selectedLayerIds.includes(String(layer.id)));
                return `<div class="pro-tree-row pro-tree-item ${isLayerSelected || groupSelected ? 'active' : ''} ${groupSelected ? 'group-selected' : ''} ${isVisible ? '' : 'is-hidden'} ${isLocked ? 'is-locked-item' : ''}" data-layer-row="${esc(layer.id)}" aria-selected="${groupSelected ? 'true' : 'false'}">
                            <button class="pro-visibility-btn ${isVisible ? '' : 'is-off'}" type="button" data-layer-visibility="${esc(layer.id)}" title="${isVisible ? 'Hide item' : 'Show item'}" aria-label="${isVisible ? 'Hide item' : 'Show item'}"><i class="fas ${isVisible ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                            <input class="pro-layer-active-check" type="checkbox" ${isLayerSelected ? 'checked' : ''} ${isLocked ? 'disabled title="Item is locked"' : ''} aria-label="Select item" data-layer-select="${esc(layer.id)}">
                            <div class="pro-tree-item-details">
                                <div class="pro-tree-item-title" title="${esc(layer.name)}">${esc(layer.name)}</div>
                                ${layer.tag ? `<div class="pro-tree-item-tag"><i class="fas fa-tag"></i> ${esc(layer.tag)}</div>` : ''}
                                <div class="pro-tree-item-sub">
                                    ${renderLayerBadgeHtml(layer, 13)}
                                    <span class="pro-tree-qty">${esc(subText)}</span>
                                </div>
                            </div>
                            <div class="pro-tree-row-actions">
                                <button class="pro-layer-lock-btn ${isLocked ? 'is-locked' : ''}" type="button" data-layer-lock="${esc(layer.id)}" title="${isLocked ? 'Unlock item' : 'Lock item'}" aria-label="${isLocked ? 'Unlock item' : 'Lock item'}" aria-pressed="${isLocked ? 'true' : 'false'}"><i class="fas fa-${isLocked ? 'lock' : 'lock-open'}"></i></button>
                                <button class="pro-row-menu-btn" type="button" data-layer-menu="${esc(layer.id)}" title="Item details" aria-label="Item details"><i class="fas fa-ellipsis-vertical"></i></button>
                            </div>
                        </div>`;
            }).join('')}
                </div>
            </div>`;
        }).join('') || '<div class="pro-drawing-empty">No takeoffs match your search.</div>';
        bindTakeoffTreeEvents();
        updateSubheadSelectedItem();
        syncTakeoffSubheadAlignment();
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
                    ${renderLayerBadgeHtml(layer, 16)}
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
                if (event.target.closest('button, input')) return;
                toggleGroupSelection(row.dataset.takeoffGroupRow);
            });
            row.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleGroupSelection(row.dataset.takeoffGroupRow);
            });
        });
        document.querySelectorAll('[data-group-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (suppressNextGroupToggle) { suppressNextGroupToggle = false; return; }
                const group = findGroup(button.dataset.groupToggle);
                if (!group) return;
                group.isExpanded = group.isExpanded === false;
                saveTakeoffState();
                renderTakeoffPanel();
            });
            button.addEventListener('dragstart', event => {
                if (takeoffState.query) { event.preventDefault(); return; }
                draggedTakeoffGroupId = button.dataset.groupToggle;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', draggedTakeoffGroupId);
                button.setAttribute('aria-grabbed', 'true');
            });
            button.addEventListener('dragend', () => {
                button.removeAttribute('aria-grabbed');
                draggedTakeoffGroupId = null;
            });
        });
        document.querySelectorAll('.pro-takeoff-group[data-group-id]').forEach(container => {
            container.addEventListener('dragover', event => {
                if (!draggedTakeoffGroupId || takeoffState.query) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
            });
            container.addEventListener('drop', event => {
                event.preventDefault();
                const sourceId = draggedTakeoffGroupId || event.dataTransfer.getData('text/plain');
                const targetId = container.dataset.groupId;
                if (sourceId && targetId && sourceId !== targetId) reorderTakeoffGroup(sourceId, targetId);
                suppressNextGroupToggle = true;
                setTimeout(() => { suppressNextGroupToggle = false; }, 0);
                draggedTakeoffGroupId = null;
            });
        });
        document.querySelectorAll('[data-group-select]').forEach(box => {
            box.addEventListener('click', event => event.stopPropagation());
            box.addEventListener('change', () => setGroupSelection(box.dataset.groupSelect, box.checked));
        });
        document.querySelectorAll('[data-group-visibility]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const group = findGroup(button.dataset.groupVisibility);
                if (group) toggleGroupVisibility(group.id, !(group.layers || []).some(layer => layer.visible !== false));
            });
        });
        document.querySelectorAll('.pro-tree-folder .pro-tree-name').forEach(nameSpan => {
            nameSpan.addEventListener('click', event => {
                event.stopPropagation();
            });
            nameSpan.addEventListener('dblclick', event => {
                event.stopPropagation();
                event.preventDefault();
                const row = nameSpan.closest('[data-takeoff-group-row]');
                const groupId = row ? row.dataset.takeoffGroupRow : null;
                const group = findGroup(groupId);
                if (!group) return;

                const currentName = group.name || '';
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'pro-tree-inline-edit';
                input.value = currentName;

                nameSpan.replaceWith(input);
                input.focus();
                input.select();

                let committed = false;
                const commit = (save) => {
                    if (committed) return;
                    committed = true;
                    document.removeEventListener('pointerdown', handleOutside, true);
                    document.removeEventListener('mousedown', handleOutside, true);
                    const val = input.value.trim();
                    if (save && val && val !== currentName) {
                        pushTakeoffHistory('rename-group');
                        group.name = val;
                        group.isDefault = false;
                        takeoffIsDirty = true;
                        saveTakeoffState();
                        window.dispatchEvent(new CustomEvent('takeoff:estimating-group-rename-requested', {
                            detail: {
                                projectId: String(window.ProjectState?.projectId || ''),
                                estimateId: activeEstimateId(),
                                groupId: group.estimatingGroupId || `takeoff_group_${group.id}`,
                                name: val
                            }
                        }));
                        showTakeoffToast?.('Group renamed.');
                    }
                    renderTakeoffPanel();
                };

                const handleOutside = (e) => {
                    if (e.target !== input && !input.contains(e.target)) {
                        commit(true);
                    }
                };

                setTimeout(() => {
                    document.addEventListener('pointerdown', handleOutside, true);
                    document.addEventListener('mousedown', handleOutside, true);
                }, 50);

                input.addEventListener('keydown', e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        commit(true);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        commit(false);
                    }
                    e.stopPropagation();
                });
                input.addEventListener('blur', () => commit(true));
                input.addEventListener('click', e => e.stopPropagation());
                input.addEventListener('dblclick', e => e.stopPropagation());
            });
        });
        document.querySelectorAll('[data-layer-row]').forEach(row => {
            row.addEventListener('click', event => {
                if (event.target.closest('button') || event.target.closest('input[type="checkbox"]')) return;
                const layerId = row.dataset.layerRow;
                const layer = findLayer(layerId);
                const editorLockState = callEditor('projectTakeoffGetLayerLockState', layerId) || {};
                if (layer?.locked || editorLockState.locked) {
                    return; // Prevent selection if item is locked
                }
                // Single item selection: deselect others, select only this one
                selectSingleLayer(layerId);
            });
        });
        document.querySelectorAll('[data-layer-visibility]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const layer = findLayer(button.dataset.layerVisibility);
                if (layer) toggleLayerVisibility(layer.id, layer.visible === false);
            });
        });
        document.querySelectorAll('[data-layer-select]').forEach(box => {
            box.addEventListener('click', event => {
                const layerId = box.dataset.layerSelect;
                const layer = findLayer(layerId);
                const editorLockState = callEditor('projectTakeoffGetLayerLockState', layerId) || {};
                if (layer?.locked || editorLockState.locked) {
                    event.preventDefault();
                    event.stopPropagation();
                    box.checked = false;
                    return false;
                }
                event.stopPropagation();
            });
            box.addEventListener('change', (event) => {
                const layerId = box.dataset.layerSelect;
                const layer = findLayer(layerId);
                const editorLockState = callEditor('projectTakeoffGetLayerLockState', layerId) || {};
                if (layer?.locked || editorLockState.locked) {
                    box.checked = false;
                    event.preventDefault();
                    return false;
                }
                const checked = box.checked;
                toggleLayerSelection(layerId, checked);
                if (checked) {
                    setActiveTakeoffLayer(layerId);
                } else if (String(takeoffState.activeLayerId || '') === String(layerId)) {
                    clearActiveTakeoffLayer();
                }
            });
        });
        document.querySelectorAll('[data-layer-lock]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                toggleLayerLock(button.dataset.layerLock);
            });
        });
        document.querySelectorAll('[data-group-lock]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                toggleGroupLock(button.dataset.groupLock);
            });
        });
        document.querySelectorAll('[data-group-menu]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const groupId = button.dataset.groupMenu;
                openGroupContextMenu(groupId, button);
            });
        });
        document.querySelectorAll('[data-layer-menu]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const layerId = button.dataset.layerMenu;
                const layer = findLayer(layerId);
                openLayerModal(layer?.groupId, layerId);
            });
        });
    }

    function initTakeoffState() {
        const pId = String(window.ProjectState?.projectId || 0);
        const storageKey = 'takeoff_project_groups_' + pId;
        const isTemplateProject = Boolean(
            window.ProjectState?.projectInfo?.project_template_id ||
            new URLSearchParams(window.location.search).get('template_id')
        );
        let storedGroups = null;
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw !== null) storedGroups = JSON.parse(raw);
        } catch (_) { }

        if (Array.isArray(storedGroups)) {
            takeoffState.groups = normalizeSavedGroups(storedGroups);
        } else {
            const seeded = seedGroupsFromProjectLayers();
            if (seeded.length > 0) {
                takeoffState.groups = normalizeSavedGroups(seeded);
            } else if (!isTemplateProject) {
                takeoffState.groups = [defaultGroup(activeEstimateId())];
            } else {
                takeoffState.groups = [];
            }
        }
        scopeLegacyTakeoffGroupsOnce();
        ensureEstimateTakeoffWorkspace(activeEstimateId(), false);
        takeoffState.activeLayerId = null;
        takeoffState.canvasSnapshots = {};
        takeoffState.annotations = [];
        takeoffState.pins = [];
        takeoffState.snapshots = [];
        takeoffState.compare = null;
        takeoffState.globalVisible = true;
        applyAggregatedCanvasQuantities();
        if (!findGroup(takeoffState.activeGroupId)) takeoffState.activeGroupId = takeoffState.groups.find(group => groupBelongsToEstimate(group))?.id || null;
        if (takeoffState.activeLayerId && !findLayer(takeoffState.activeLayerId)) takeoffState.activeLayerId = null;
        ensureTakeoffModal();
        ensureTakeoffOverlays();
        ensureEditorEstimate();
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
            <div class="pro-layer-modal-tabs">
                <button type="button" class="pro-modal-tab active" data-layer-tab="details">Main Details</button>
                <button type="button" class="pro-modal-tab" data-layer-tab="drawings">List of Drawings</button>
                <button class="pro-icon-btn pro-modal-tab-close" type="button" data-layer-modal-close aria-label="Close"><i class="fas fa-times"></i></button>
            </div>
            <div class="pro-layer-tab-pane" id="layerTabPaneDetails">
                <div class="pro-layer-form">
                    <div class="pro-field">
                        <label>Takeoff Type</label>
                        <div class="pro-custom-dropdown" id="editLayerTypeDropdown">
                            <button type="button" class="pro-custom-dropdown-trigger" id="editLayerTypeTrigger">
                                <span class="pcd-trigger-left">
                                    <span class="pcd-trigger-icon" id="editLayerTypeIconPreview"></span>
                                    <span class="pcd-trigger-text" id="editLayerTypeText">Count</span>
                                </span>
                                <span class="pcd-caret"></span>
                            </button>
                            <div class="pro-custom-dropdown-menu pcd-type-menu" id="editLayerTypeMenu"></div>
                            <select id="layerTypeInput" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                ${TAKEOFF_TYPES.map(type => `<option value="${type}">${type}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="pro-edit-selectors-row">
                        <div class="pro-field col-stroke" id="layerStrokeCol">
                            <label for="layerStrokeInput">Line width</label>
                            <div class="pro-custom-select-wrap">
                                <span class="pro-stroke-preview" id="layerStrokePreview"></span>
                                <select id="layerStrokeInput">
                                    <option value="1">1 px</option>
                                    <option value="2">2 px</option>
                                    <option value="3">3 px</option>
                                    <option value="4" selected>4 px</option>
                                    <option value="5">5 px</option>
                                    <option value="6">6 px</option>
                                    <option value="8">8 px</option>
                                </select>
                            </div>
                        </div>
                        <div class="pro-field col-uom" id="layerUomCol">
                            <label>UoM</label>
                            <div class="pro-custom-dropdown" id="editLayerUomDropdown">
                                <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="editLayerUomTrigger">
                                    <span class="pcd-trigger-text" id="editLayerUomText">ea</span>
                                    <span class="pcd-caret"></span>
                                </button>
                                <div class="pro-custom-dropdown-menu pcd-uom-menu" id="editLayerUomMenu"></div>
                                <select id="layerUomInput" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                    ${TAKEOFF_UOMS.map(uom => `<option value="${uom}">${uom}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="pro-field col-symbol" id="layerSymbolCol">
                            <label>Symbol</label>
                            <div class="pro-custom-dropdown" id="editLayerSymbolDropdown">
                                <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="editLayerSymbolTrigger">
                                    <span class="pcd-trigger-icon" id="editLayerSymbolPreview"></span>
                                    <span class="pcd-caret"></span>
                                </button>
                                <div class="pro-custom-dropdown-menu pcd-symbol-menu" id="editLayerSymbolMenu"></div>
                                <select id="layerSymbolInput" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                    ${TAKEOFF_SYMBOLS.map(symbol => `<option value="${symbol}">${symbol}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="pro-field col-size" id="layerSizeCol">
                            <label>Size</label>
                            <div class="pro-custom-dropdown" id="editLayerSizeDropdown">
                                <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="editLayerSizeTrigger">
                                    <span class="pcd-trigger-icon" id="editLayerSizePreview"></span>
                                    <span class="pcd-caret"></span>
                                </button>
                                <div class="pro-custom-dropdown-menu pcd-size-menu" id="editLayerSizeMenu"></div>
                                <select id="layerSizeInput" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                    ${TAKEOFF_SIZES.map(size => `<option value="${size}">${size}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="pro-field col-color" id="layerColorCol">
                            <label>Color</label>
                            <div class="pro-custom-dropdown" id="editLayerColorDropdown">
                                <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="editLayerColorTrigger">
                                    <span class="pcd-color-dot" id="editLayerColorSwatch" style="background:#00d2ff;"></span>
                                    <span class="pcd-caret"></span>
                                </button>
                                <div class="pro-custom-dropdown-menu pcd-color-menu" id="editLayerColorMenu"></div>
                                <select id="layerColorInput" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                    ${TAKEOFF_RICH_COLORS.map(c => `<option value="${c}">${c}</option>`).join('')}
                                    <option value="__custom__">Custom color...</option>
                                </select>
                                <input type="color" id="layerCustomColorPicker" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                            </div>
                        </div>
                    </div>
                    <div class="pro-field">
                        <label for="layerNameInput">Takeoff Display Name</label>
                        <input id="layerNameInput" type="text" placeholder="Enter takeoff display name">
                    </div>
                    <div class="pro-field">
                        <label for="layerTagInput">Tag</label>
                        <input id="layerTagInput" type="text" placeholder="Enter your own short text to tag this takeoff">
                    </div>
                    <div class="pro-layer-catalog-row">
                        <div class="pro-field">
                            <label for="layerMultiplierInput">Multiplier</label>
                            <input id="layerMultiplierInput" type="number" min="1" step="1" value="1">
                        </div>
                        <div class="pro-field">
                            <label>Associated Catalog item</label>
                            <div class="pro-associated-catalog-card" id="layerCatalogCard">
                                <div class="pro-acc-info">
                                    <strong class="pro-acc-title" id="layerAccTitle">3/4" EMT Conduit, Overhead Branch, w/ 9 #12 THHN Wires</strong>
                                    <p class="pro-acc-desc" id="layerAccDesc">Includes conduit, one hole straps, connectors, couplings and wire</p>
                                    <div class="pro-acc-badges"><span class="pro-acc-badge" id="layerAccBadge">Assembly</span></div>
                                    <div class="pro-acc-meta" id="layerAccMeta"><span>UoM <strong id="layerAccUom">ft</strong></span> <span>UC <strong id="layerAccUc">$3.47</strong></span> <span>ULT <strong id="layerAccUlt">0.12 hrs</strong></span> <span>CN <strong id="layerAccCn">EMT-ASM-2025</strong></span></div>
                                    <div class="pro-acc-path" id="layerAccPath">CC 2025 COST CATALOG BRIGHTRONIX &gt; .EMT Assemblies</div>
                                </div>
                                <button type="button" class="pro-catalog-swap-btn" id="layerSwapCatalogBtn" title="Change item from Cost Catalog" aria-label="Change item from Cost Catalog">
                                    <i class="fas fa-arrows-rotate"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="pro-field" id="layerDropField">
                        <label for="layerDropInput">Default Drop Length (ft)</label>
                        <input id="layerDropInput" type="number" min="0" step="0.1" placeholder="0">
                    </div>
                    <div style="display:none;">
                        <h3 id="takeoffLayerModalTitle">Edit takeoff layer</h3>
                        <p id="layerTypeHelp"></p>
                        <div id="layerCatalogSelected"></div>
                        <input id="layerDiameterInput" type="number">
                        <input id="layerSpacingInput" type="number">
                        <input id="layerHeightInput" type="number">
                        <input id="layerDepthInput" type="number">
                        <button type="button" id="layerCreateSubmit">Save</button>
                    </div>
                </div>
            </div>
            <div class="pro-layer-tab-pane" id="layerTabPaneDrawings" hidden>
                <div class="pro-drawings-list-wrap" id="layerDrawingsList"></div>
            </div>
            <div class="pro-layer-modal-foot">
                <div class="pro-modal-foot-left">
                    <button type="button" class="pro-foot-btn danger" data-layer-act="delete" title="Delete takeoff layer"><i class="fas fa-trash-can"></i> Delete</button>
                    <button type="button" class="pro-foot-btn" data-layer-act="copy" title="Copy takeoff layer"><i class="far fa-copy"></i> Copy</button>
                    <button type="button" class="pro-foot-btn" data-layer-act="lock" title="Lock/Unlock takeoff layer"><i class="fas fa-lock"></i> <span id="layerModalLockLabel">Lock</span></button>
                    <button type="button" class="pro-foot-btn muted" data-layer-act="split" title="Split layer"><i class="fas fa-code-fork fa-rotate-270"></i> Split</button>
                </div>
                <div class="pro-modal-foot-right">
                    <button type="button" class="pro-foot-btn-close" data-layer-modal-close>Close</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);

        modal.querySelectorAll('[data-layer-modal-close]').forEach(btn => btn.addEventListener('click', () => {
            const name = $('layerNameInput')?.value.trim();
            if (name) submitLayerModal();
            else closeLayerModal();
        }));

        modal.querySelectorAll('[data-layer-tab]').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => switchLayerModalTab(tabBtn.dataset.layerTab));
        });

        $('layerSwapCatalogBtn')?.addEventListener('click', event => {
            event.stopPropagation();
            openCatalogModal();
        });

        modal.querySelector('[data-layer-act="delete"]')?.addEventListener('click', () => {
            if (takeoffState.editingLayerId) {
                deleteLayer(takeoffState.editingLayerId);
                closeLayerModal();
            }
        });

        modal.querySelector('[data-layer-act="copy"]')?.addEventListener('click', () => {
            if (takeoffState.editingLayerId) {
                duplicateLayer(takeoffState.editingLayerId);
                closeLayerModal();
            }
        });

        modal.querySelector('[data-layer-act="lock"]')?.addEventListener('click', () => {
            if (takeoffState.editingLayerId) {
                toggleLayerLock(takeoffState.editingLayerId);
                const layer = findLayer(takeoffState.editingLayerId);
                const isLocked = Boolean(layer?.locked);
                if ($('layerModalLockLabel')) $('layerModalLockLabel').textContent = isLocked ? 'Unlock' : 'Lock';
                const lockIcon = modal.querySelector('[data-layer-act="lock"] i');
                if (lockIcon) lockIcon.className = `fas fa-${isLocked ? 'lock' : 'lock-open'}`;
            }
        });

        modal.querySelector('[data-layer-act="split"]')?.addEventListener('click', () => {
            showPrepared('Split takeoff layer is ready.');
        });

        $('layerNameInput').addEventListener('input', updateLayerSubmitState);

        setupTypeDropdown('editLayer', $('layerTypeInput'));
        setupUomDropdown('editLayer', $('layerUomInput'));
        setupSymbolDropdown('editLayer', $('layerSymbolInput'));
        setupSizeDropdown('editLayer', $('layerSizeInput'));
        setupColorDropdown('editLayer', $('layerColorInput'), $('layerCustomColorPicker'));

        $('layerTypeInput').addEventListener('change', () => {
            const type = $('layerTypeInput').value;
            $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[type] || TAKEOFF_TYPE_HELP.Count;
            filterUomDropdownByType('editLayer', type);
            if (!isUomValidForType($('layerUomInput')?.value, type)) {
                const newUom = defaultUomForType(type);
                if ($('layerUomInput')) $('layerUomInput').value = newUom;
                updateUomDropdownTrigger('editLayer', newUom);
            }
            updateTypeDropdownTrigger('editLayer', type);
            updateLayerTypeIcon();
            updateLayerTypeFields(type);
            updateLayerSubmitState();
        });

        $('layerUomInput')?.addEventListener('change', () => {
            updateUomDropdownTrigger('editLayer', $('layerUomInput').value);
        });

        $('layerSymbolInput')?.addEventListener('change', () => {
            updateSymbolDropdownTrigger('editLayer', $('layerSymbolInput').value);
        });

        $('layerSizeInput')?.addEventListener('change', () => {
            updateSizeDropdownTrigger('editLayer', $('layerSizeInput').value);
        });

        $('layerStrokeInput').addEventListener('change', updateLayerStrokePreview);

        $('layerColorInput').addEventListener('change', () => {
            if ($('layerColorInput').value === '__custom__') {
                $('layerCustomColorPicker')?.click();
            } else {
                updateLayerColorSwatch();
            }
        });
        $('layerColorSwatch')?.addEventListener('click', () => {
            $('layerCustomColorPicker')?.click();
        });
        $('editLayerColorSwatch')?.addEventListener('click', () => {
            $('layerCustomColorPicker')?.click();
        });
        $('layerCustomColorPicker')?.addEventListener('input', event => {
            setLayerColor(event.target.value);
        });
        $('layerCustomColorPicker')?.addEventListener('change', event => {
            setLayerColor(event.target.value);
        });
        $('layerCreateSubmit').addEventListener('click', submitLayerModal);
        ensureCatalogModal();
    }

    function ensureCreateLayerModal() {
        if ($('takeoffCreateLayerModal')) return;
        const modal = document.createElement('div');
        modal.id = 'takeoffCreateLayerModal';
        modal.className = 'pro-modal-backdrop';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="pro-create-layer-modal" role="dialog" aria-modal="true" aria-labelledby="createLayerModalTitle">
                <div class="pro-create-layer-head">
                    <h2 id="createLayerModalTitle">Create new takeoff layer</h2>
                    <button class="pro-icon-btn" type="button" data-create-layer-close aria-label="Close"><i class="fas fa-times"></i></button>
                </div>
                <div class="pro-create-layer-body">
                    <div class="pro-create-layer-field" style="display:none;">
                        <label for="createLayerGroup">Target Group</label>
                        <div class="pro-create-control-box" style="width:100%;">
                            <select id="createLayerGroup" style="width:100%;font:inherit;font-size:12px;font-weight:600;padding:6px 10px;border:1px solid var(--tk-border, #e2e8f0);border-radius:6px;background:var(--tk-bg-surface, #fff);color:var(--tk-text-main, #0f172a);">
                            </select>
                        </div>
                    </div>
                    <div class="pro-create-layer-field">
                        <label for="createLayerCatalogName">Catalog Item Name</label>
                        <div class="pro-create-catalog-row">
                            <input id="createLayerCatalogName" type="text" placeholder="Enter material name or pick one from catalog">
                            <button type="button" class="pro-btn-browse-catalog" id="createLayerBrowseCatalogBtn">
                                <i class="fas fa-bars-staggered"></i> Browse Catalog
                            </button>
                        </div>
                    </div>
                    <div class="pro-create-layer-field" style="display:none;">
                        <label for="createLayerTag">Tag</label>
                        <input id="createLayerTag" type="text" placeholder="Enter short text to tag this takeoff (optional)">
                    </div>
                    <div class="pro-create-layer-field">
                        <div class="pro-create-selectors-row">
                            <div class="col-type">
                                <label>Takeoff Type</label>
                                <div class="pro-custom-dropdown" id="createLayerTypeDropdown">
                                    <button type="button" class="pro-custom-dropdown-trigger" id="createLayerTypeTrigger">
                                        <span class="pcd-trigger-left">
                                            <span class="pcd-trigger-icon" id="createLayerTypeIconPreview"></span>
                                            <span class="pcd-trigger-text" id="createLayerTypeText">Count</span>
                                        </span>
                                        <span class="pcd-caret"></span>
                                    </button>
                                    <div class="pro-custom-dropdown-menu pcd-type-menu" id="createLayerTypeMenu"></div>
                                    <select id="createLayerType" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                        <option value="Count">Count</option>
                                        <option value="Linear">Linear</option>
                                        <option value="Linear with drop">Linear with drop</option>
                                        <option value="Linear avg. with drop">Linear avg. with drop</option>
                                        <option value="Count by distance">Count by distance</option>
                                        <option value="Area / Volume">Area / Volume</option>
                                    </select>
                                </div>
                            </div>
                            <div class="col-uom" id="createLayerUomCol">
                                <label>UoM</label>
                                <div class="pro-custom-dropdown" id="createLayerUomDropdown">
                                    <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="createLayerUomTrigger">
                                        <span class="pcd-trigger-text" id="createLayerUomText">ea</span>
                                        <span class="pcd-caret"></span>
                                    </button>
                                    <div class="pro-custom-dropdown-menu pcd-uom-menu" id="createLayerUomMenu"></div>
                                    <select id="createLayerUom" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                        ${TAKEOFF_UOMS.map(uom => `<option value="${uom}">${uom}</option>`).join('')}
                                    </select>
                                </div>
                            </div>
                            <div class="col-symbol" id="createLayerSymbolCol">
                                <label>Symbol</label>
                                <div class="pro-custom-dropdown" id="createLayerSymbolDropdown">
                                    <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="createLayerSymbolTrigger">
                                        <span class="pcd-trigger-icon" id="createLayerSymbolPreview"></span>
                                        <span class="pcd-caret"></span>
                                    </button>
                                    <div class="pro-custom-dropdown-menu pcd-symbol-menu" id="createLayerSymbolMenu"></div>
                                    <select id="createLayerSymbol" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                        ${TAKEOFF_SYMBOLS.map(symbol => `<option value="${symbol}">${symbol}</option>`).join('')}
                                    </select>
                                </div>
                            </div>
                            <div class="col-size" id="createLayerSizeCol">
                                <label>Size</label>
                                <div class="pro-custom-dropdown" id="createLayerSizeDropdown">
                                    <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="createLayerSizeTrigger">
                                        <span class="pcd-trigger-icon" id="createLayerSizePreview"></span>
                                        <span class="pcd-caret"></span>
                                    </button>
                                    <div class="pro-custom-dropdown-menu pcd-size-menu" id="createLayerSizeMenu"></div>
                                    <select id="createLayerSize" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                        ${TAKEOFF_SIZES.map(size => `<option value="${size}">${size}</option>`).join('')}
                                    </select>
                                </div>
                            </div>
                            <div class="col-color" id="createLayerColorCol">
                                <label>Color</label>
                                <div class="pro-custom-dropdown" id="createLayerColorDropdown">
                                    <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="createLayerColorTrigger">
                                        <span class="pcd-color-dot" id="createLayerColorSwatch" style="background:#00d2ff;"></span>
                                        <span class="pcd-caret"></span>
                                    </button>
                                    <div class="pro-custom-dropdown-menu pcd-color-menu" id="createLayerColorMenu"></div>
                                    <select id="createLayerColor" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                        ${TAKEOFF_RICH_COLORS.map(c => `<option value="${c}">${c}</option>`).join('')}
                                        <option value="__custom__">Custom...</option>
                                    </select>
                                    <input type="color" id="createLayerCustomColorPicker" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                </div>
                            </div>
                        </div>
                        <div class="pro-create-help-text" id="createLayerHelpText">
                            Count Quantity items - EX: Light Fixtures, Electrical Outlets, Data Outlets
                        </div>
                    </div>
                </div>
                <div class="pro-create-layer-foot">
                    <button type="button" class="pro-btn-create-cancel" data-create-layer-close>Cancel</button>
                    <button type="button" class="pro-btn-create-submit" id="createLayerSubmitBtn">Create</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        modal.querySelectorAll('[data-create-layer-close]').forEach(btn => {
            btn.addEventListener('click', closeCreateLayerModal);
        });

        $('createLayerBrowseCatalogBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openCatalogModal();
        });

        setupTypeDropdown('createLayer', $('createLayerType'));
        setupUomDropdown('createLayer', $('createLayerUom'));
        setupSymbolDropdown('createLayer', $('createLayerSymbol'));
        setupSizeDropdown('createLayer', $('createLayerSize'));
        setupColorDropdown('createLayer', $('createLayerColor'), $('createLayerCustomColorPicker'));

        $('createLayerType')?.addEventListener('change', (e) => {
            updateTypeDropdownTrigger('createLayer', e.target.value);
            updateCreateLayerTypeUi(e.target.value);
        });

        $('createLayerUom')?.addEventListener('change', () => {
            updateUomDropdownTrigger('createLayer', $('createLayerUom').value);
        });

        $('createLayerSymbol')?.addEventListener('change', (e) => {
            updateSymbolDropdownTrigger('createLayer', e.target.value);
        });

        $('createLayerSize')?.addEventListener('change', (e) => {
            updateSizeDropdownTrigger('createLayer', e.target.value);
        });

        $('createLayerCatalogName')?.addEventListener('input', () => {
            updateCreateLayerSubmitState();
        });

        $('createLayerCatalogName')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitCreateLayerModal();
            }
        });

        $('createLayerColor')?.addEventListener('change', (e) => {
            if (e.target.value === '__custom__') {
                $('createLayerCustomColorPicker')?.click();
            } else {
                setCreateLayerColor(e.target.value);
            }
        });

        $('createLayerColorSwatch')?.addEventListener('click', () => {
            $('createLayerCustomColorPicker')?.click();
        });

        $('createLayerCustomColorPicker')?.addEventListener('input', (e) => {
            setCreateLayerColor(e.target.value);
        });

        $('createLayerCustomColorPicker')?.addEventListener('change', (e) => {
            setCreateLayerColor(e.target.value);
        });

        $('createLayerGroup')?.addEventListener('change', (e) => {
            takeoffState.pendingCreateGroupId = e.target.value;
            takeoffState.activeGroupId = e.target.value;
        });

        $('createLayerSubmitBtn')?.addEventListener('click', submitCreateLayerModal);

        modal.addEventListener('click', (e) => {
            if (e.target.id === 'takeoffCreateLayerModal') closeCreateLayerModal();
        });
    }

    function openCreateLayerModal(groupId = null) {
        ensureCreateLayerModal();
        const activeEst = activeEstimateId();
        const scopedGroups = takeoffState.groups.filter(g => groupBelongsToEstimate(g, activeEst));
        let targetGroup = null;
        if (groupId) {
            targetGroup = findGroupExact(groupId) || findGroup(groupId);
        } else if (takeoffState.activeGroupId) {
            targetGroup = findGroupExact(takeoffState.activeGroupId) || findGroup(takeoffState.activeGroupId);
        }
        if (!targetGroup && scopedGroups.length > 0) {
            targetGroup = scopedGroups[0];
        }
        if (!targetGroup) {
            const newGrp = { id: makeId('grp'), estimateId: activeEst, name: 'Takeoff Group 1', isExpanded: true, isDefault: false, layers: [] };
            takeoffState.groups.push(newGrp);
            targetGroup = newGrp;
        }
        takeoffState.pendingCreateGroupId = String(targetGroup.id);
        takeoffState.activeGroupId = String(targetGroup.id);
        takeoffState.pendingCatalogItem = null;

        const modal = $('takeoffCreateLayerModal');
        if (!modal) return;

        const groupSelect = $('createLayerGroup');
        if (groupSelect) {
            const currentScoped = takeoffState.groups.filter(g => groupBelongsToEstimate(g, activeEst));
            groupSelect.innerHTML = currentScoped.map(g => `<option value="${esc(g.id)}"${String(g.id) === String(targetGroup.id) ? ' selected' : ''}>${esc(g.name || 'Group')}</option>`).join('');
            groupSelect.value = String(targetGroup.id);
        }

        const nameInput = $('createLayerCatalogName');
        if (nameInput) nameInput.value = '';
        const tagInput = $('createLayerTag');
        if (tagInput) tagInput.value = '';
        if ($('createLayerType')) $('createLayerType').value = 'Count';
        filterUomDropdownByType('createLayer', 'Count');
        updateCreateLayerTypeUi('Count');
        if ($('createLayerUom')) $('createLayerUom').value = 'ea';
        if ($('createLayerSymbol')) $('createLayerSymbol').value = 'Solid Circle';
        if ($('createLayerSize')) $('createLayerSize').value = 'Medium';
        updateTypeDropdownTrigger('createLayer', 'Count');
        updateUomDropdownTrigger('createLayer', 'ea');
        updateSymbolDropdownTrigger('createLayer', 'Solid Circle');
        updateSizeDropdownTrigger('createLayer', 'Medium');
        setCreateLayerColor('#00d2ff');
        updateCreateLayerSubmitState();

        modal.hidden = false;
        setTimeout(() => $('createLayerCatalogName')?.focus(), 40);
    }

    function closeCreateLayerModal() {
        const modal = $('takeoffCreateLayerModal');
        if (modal) {
            modal.classList.remove('is-behind');
            modal.hidden = true;
        }
    }

    function updateCreateLayerTypeUi(type) {
        const isCount = type === 'Count' || type === 'Count by distance';
        const symCol = $('createLayerSymbolCol');
        const sizeCol = $('createLayerSizeCol');
        if (symCol) symCol.style.display = isCount ? 'block' : 'none';
        if (sizeCol) sizeCol.style.display = isCount ? 'block' : 'none';

        const help = $('createLayerHelpText');
        const uom = $('createLayerUom');

        if (help) {
            help.textContent = TAKEOFF_TYPE_HELP[type] || 'Count Quantity items - EX: Light Fixtures, Electrical Outlets, Data Outlets';
        }

        filterUomDropdownByType('createLayer', type);

        if (uom) {
            if (!isUomValidForType(uom.value, type)) {
                uom.value = defaultUomForType(type);
            }
            updateUomDropdownTrigger('createLayer', uom.value);
        }
        updateTypeDropdownTrigger('createLayer', type);
    }

    function setCreateLayerColor(hex) {
        const swatch = $('createLayerColorSwatch');
        const select = $('createLayerColor');
        if (swatch) swatch.style.background = hex;
        if (select) {
            let match = Array.from(select.options).find(o => o.value.toLowerCase() === hex.toLowerCase());
            if (match) select.value = match.value;
            else select.value = '__custom__';
        }
        updateColorDropdownTrigger('createLayer', hex);
    }

    function updateCreateLayerSubmitState() {
        const val = $('createLayerCatalogName')?.value.trim();
        const submit = $('createLayerSubmitBtn');
        if (submit) {
            submit.classList.toggle('is-active', Boolean(val));
        }
    }

    function submitCreateLayerModal() {
        const name = $('createLayerCatalogName')?.value.trim();
        if (!name) return closeCreateLayerModal();

        const type = $('createLayerType')?.value || 'Count';
        const uom = $('createLayerUom')?.value || typeToUom(type);
        const symbol = $('createLayerSymbol')?.value || 'Solid Circle';
        const size = $('createLayerSize')?.value || 'Medium';
        const color = $('createLayerColorSwatch')?.style.background || '#ec4899';

        const chosenGroupId = $('createLayerGroup')?.value || takeoffState.pendingCreateGroupId;
        let group = findGroupExact(chosenGroupId) || findGroup(chosenGroupId);
        if (!group) {
            const scopedGroups = takeoffState.groups.filter(g => groupBelongsToEstimate(g, activeEstimateId()));
            group = scopedGroups[0] || takeoffState.groups[0];
        }
        if (!group) {
            group = { id: makeId('grp'), estimateId: activeEstimateId(), name: 'Takeoff Group 1', isExpanded: true, isDefault: false, layers: [] };
            takeoffState.groups.push(group);
        }

        const strokeWidth = type.includes('Area') ? 3 : 4;
        const radius = takeoffSizeRadius(size);
        const tag = $('createLayerTag')?.value.trim() || '';

        const newLayer = {
            id: makeId('layer'),
            groupId: group.id,
            estimateId: activeEstimateId(),
            name,
            tag,
            costCode: tag,
            metadata_json: { tag },
            type,
            uom,
            symbol,
            size,
            markerDiameter: radius * 2,
            strokeWidth,
            color,
            quantity: 0,
            baseQuantity: 0,
            dropLength: 0,
            spacing: 0,
            height: 0,
            depth: 0,
            shapes: [],
            takeoffObjects: []
        };

        if (takeoffState.pendingCatalogItem) {
            try {
                Object.assign(newLayer, catalogItemMeta(takeoffState.pendingCatalogItem));
            } catch (e) {
                newLayer.catalogItemId = takeoffState.pendingCatalogItem.id;
            }
        }

        pushTakeoffHistory('create-layer');
        group.layers.push(newLayer);
        group.isExpanded = true;
        takeoffState.activeGroupId = group.id;

        closeCreateLayerModal();
        setActiveTakeoffLayer(newLayer.id, true);
        saveTakeoffState();
        renderTakeoffPanel();
        showPrepared(`Takeoff layer "${name}" created.`);
    }

    function switchLayerModalTab(tabName) {
        document.querySelectorAll('.pro-modal-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.layerTab === tabName);
        });
        const detailsPane = $('layerTabPaneDetails');
        const drawingsPane = $('layerTabPaneDrawings');
        if (detailsPane) detailsPane.hidden = tabName !== 'details';
        if (drawingsPane) drawingsPane.hidden = tabName !== 'drawings';
    }

    function updateLayerTypeIcon() {
        const icon = $('layerTypeIconPreview');
        if (!icon) return;
        const type = $('layerTypeInput')?.value || 'Count';
        if (type === 'Linear avg. with drop') {
            icon.innerHTML = '<i class="fas fa-network-wired"></i>';
        } else if (type.includes('Linear')) {
            icon.innerHTML = '<i class="fas fa-minus"></i>';
        } else if (type.includes('Area')) {
            icon.innerHTML = '<i class="far fa-square"></i>';
        } else {
            icon.innerHTML = '<i class="fas fa-circle-dot"></i>';
        }
    }

    function updateLayerStrokePreview() {
        const preview = $('layerStrokePreview');
        const input = $('layerStrokeInput');
        if (preview && input) {
            preview.style.height = `${Math.max(1, Math.min(10, Number(input.value) || 4))}px`;
        }
    }

    function updateAssociatedCatalogCard(layer) {
        const item = takeoffState.pendingCatalogItem || (layer?.catalogItemId ? {
            name: layer.name,
            description: layer.description,
            uom: layer.uom,
            unitCost: layer.unitCost,
            laborHours: layer.laborHours,
            code: layer.catalogCode || 'EMT-ASM-2025',
            group_name: layer.category || '.EMT Assemblies'
        } : null);

        const card = $('layerCatalogCard');
        if (!card) return;

        if (item) {
            if ($('layerAccTitle')) $('layerAccTitle').textContent = item.name || layer?.name || 'Catalog Item';
            if ($('layerAccDesc')) $('layerAccDesc').textContent = item.description || 'Includes conduit, one hole straps, connectors, couplings and wire';
            if ($('layerAccBadge')) $('layerAccBadge').textContent = item.itemType || item.type || 'Assembly';
            if ($('layerAccUom')) $('layerAccUom').textContent = item.uom || layer?.uom || 'ft';
            if ($('layerAccUc')) $('layerAccUc').textContent = '$' + Number(item.unit_cost || item.unitCost || 3.47).toFixed(2);
            if ($('layerAccUlt')) $('layerAccUlt').textContent = Number(item.labor_hours || item.laborHours || 0.12).toFixed(2) + ' hrs';
            if ($('layerAccCn')) $('layerAccCn').textContent = item.code || item.item_code || 'EMT-ASM-2025';
            if ($('layerAccPath')) $('layerAccPath').textContent = `CC 2025 COST CATALOG BRIGHTRONIX > ${item.group_name || item.catalog_name || '.EMT Assemblies'}`;
        } else {
            if ($('layerAccTitle')) $('layerAccTitle').textContent = layer?.name || 'Custom Layer';
            if ($('layerAccDesc')) $('layerAccDesc').textContent = 'Custom project layer (use swap button to link with Cost Catalog)';
            if ($('layerAccBadge')) $('layerAccBadge').textContent = 'Custom';
            if ($('layerAccUom')) $('layerAccUom').textContent = layer?.uom || 'ea';
            if ($('layerAccUc')) $('layerAccUc').textContent = '$' + Number(layer?.unitCost || 0).toFixed(2);
            if ($('layerAccUlt')) $('layerAccUlt').textContent = Number(layer?.laborHours || 0).toFixed(2) + ' hrs';
            if ($('layerAccCn')) $('layerAccCn').textContent = 'N/A';
            if ($('layerAccPath')) $('layerAccPath').textContent = 'Custom Takeoff';
        }
    }

    function updateLayerDrawingsList(layer) {
        const container = $('layerDrawingsList');
        if (!container) return;
        const currentDoc = (window.documentState?.drawings || []).find(d => String(d.id) === String(window.currentDrawingId));
        const docName = currentDoc?.name || 'Current Drawing (E1.0 - Power Plan)';
        const count = layer ? (layer.quantity ? `${quantityLabel(layer)}` : '0 items') : '0 items';
        container.innerHTML = `
            <div class="pro-drawing-row-item">
                <span class="pro-drawing-row-title"><i class="fas fa-file-lines" style="margin-right:8px;color:var(--tk-primary);"></i> ${esc(docName)}</span>
                <span class="pro-drawing-row-qty">${esc(count)}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--tk-text-muted);margin-top:8px;">
                <i class="fas fa-info-circle"></i> This takeoff layer is active on the current drawing plan.
            </div>
        `;
    }

    function updateLayerTypeFields(type = $('layerTypeInput')?.value || 'Count') {
        const dropField = $('layerDropField');
        if (dropField) {
            const hasDrop = ['Linear with drop', 'Linear avg. with drop'].includes(type);
            dropField.style.display = hasDrop ? 'flex' : 'none';
        }
        const isCount = type === 'Count' || type === 'Count by distance';
        const symCol = $('layerSymbolCol');
        const sizeCol = $('layerSizeCol');
        const strokeCol = $('layerStrokeCol');
        if (symCol) symCol.style.display = isCount ? 'block' : 'none';
        if (sizeCol) sizeCol.style.display = isCount ? 'block' : 'none';
        if (strokeCol) strokeCol.style.display = isCount ? 'none' : 'block';
    }

    function openLayerModal(groupId = takeoffState.activeGroupId, layerId = null) {
        if (!layerId && !takeoffState.groups.some(group => groupBelongsToEstimate(group))) {
            ensureEstimateTakeoffWorkspace(activeEstimateId(), true);
            groupId = takeoffState.activeGroupId;
        }
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
            description: layer.description,
            code: layer.catalogCode || layer.code || 'EMT-ASM-2025'
        } : null;

        switchLayerModalTab('details');

        if ($('takeoffLayerModalTitle')) $('takeoffLayerModalTitle').textContent = layer ? 'Edit takeoff layer' : 'Create new takeoff layer';
        $('layerNameInput').value = layer?.name || '';
        if ($('layerTagInput')) $('layerTagInput').value = layer?.tag || '';
        if ($('layerMultiplierInput')) $('layerMultiplierInput').value = layer?.multiplier || 1;
        $('layerTypeInput').value = layer?.type || 'Linear avg. with drop';
        if (!$('layerTypeInput').value) $('layerTypeInput').value = 'Count';
        if ($('layerTypeHelp')) $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[$('layerTypeInput').value] || TAKEOFF_TYPE_HELP.Count;
        setSelectValue($('layerUomInput'), layer?.uom || typeToUom($('layerTypeInput').value));
        if ($('layerSymbolInput')) $('layerSymbolInput').value = takeoffDisplaySymbol(layer?.symbol);
        if ($('layerSizeInput')) $('layerSizeInput').value = takeoffDisplaySize(layer?.size);
        if ($('layerDiameterInput')) $('layerDiameterInput').value = Number(layer?.markerDiameter || (takeoffSizeRadius(layer?.size || 'Medium') * 2));

        const strokeVal = Math.round(Number(layer?.strokeWidth || 4));
        setSelectValue($('layerStrokeInput'), String(strokeVal));
        updateLayerStrokePreview();

        setLayerColor(layer?.color || '#ef4444');
        if ($('layerDropInput')) $('layerDropInput').value = layer?.dropLength || 0;
        if ($('layerSpacingInput')) $('layerSpacingInput').value = layer?.spacing || '';
        if ($('layerHeightInput')) $('layerHeightInput').value = layer?.height || '';
        if ($('layerDepthInput')) $('layerDepthInput').value = layer?.depth || '';
        if ($('layerCreateSubmit')) $('layerCreateSubmit').textContent = layer ? 'Save' : 'Create';

        const isLocked = Boolean(layer?.locked);
        if ($('layerModalLockLabel')) $('layerModalLockLabel').textContent = isLocked ? 'Unlock' : 'Lock';
        const lockIcon = $('takeoffLayerModal')?.querySelector('[data-layer-act="lock"] i');
        if (lockIcon) lockIcon.className = `fas fa-${isLocked ? 'lock' : 'lock-open'}`;

        updateAssociatedCatalogCard(layer);
        updateLayerDrawingsList(layer);
        const currentEditType = $('layerTypeInput').value;
        filterUomDropdownByType('editLayer', currentEditType);
        if (!isUomValidForType($('layerUomInput')?.value, currentEditType)) {
            setSelectValue($('layerUomInput'), defaultUomForType(currentEditType));
        }
        updateTypeDropdownTrigger('editLayer', currentEditType);
        updateUomDropdownTrigger('editLayer', $('layerUomInput')?.value || 'ea');
        updateSymbolDropdownTrigger('editLayer', $('layerSymbolInput')?.value || 'Solid Circle');
        updateSizeDropdownTrigger('editLayer', $('layerSizeInput')?.value || 'Medium');
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

    function setLayerColor(color) {
        const input = $('layerColorInput');
        const picker = $('layerCustomColorPicker');
        if (!input) return;
        const hex = String(color || '#ef4444').trim();
        let match = Array.from(input.options).find(opt => opt.value.toLowerCase() === hex.toLowerCase());
        if (!match && hex !== '__custom__') {
            const opt = document.createElement('option');
            opt.value = hex;
            opt.textContent = `Custom (${hex})`;
            const customOpt = input.querySelector('option[value="__custom__"]');
            if (customOpt) input.insertBefore(opt, customOpt);
            else input.appendChild(opt);
            match = opt;
        }
        if (match) input.value = match.value;
        if (picker && hex.startsWith('#') && (hex.length === 7 || hex.length === 4)) {
            picker.value = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
        }
        updateLayerColorSwatch();
        updateColorDropdownTrigger('editLayer', hex);
    }

    function updateLayerColorSwatch() {
        const swatch = $('layerColorSwatch');
        const editSwatch = $('editLayerColorSwatch');
        const color = ($('layerColorInput')?.value === '__custom__' ? $('layerCustomColorPicker')?.value : $('layerColorInput')?.value) || '#ef4444';
        if (swatch) swatch.style.background = color;
        if (editSwatch) editSwatch.style.background = color;
        updateColorDropdownTrigger('editLayer', color);
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
        return window.TakeoffCatalogAdapter.catalogItemDtoToLegacyLayerMeta(item);
    }

    function applyCatalogItemToLayerForm(item) {
        if (!item) return;
        takeoffState.pendingCatalogItem = item;
        const createModal = $('takeoffCreateLayerModal');
        if (createModal && !createModal.hidden) {
            createModal.classList.remove('is-behind');
            if ($('createLayerCatalogName')) $('createLayerCatalogName').value = item.name || '';
            const inferred = window.TakeoffCatalogAdapter?.measurementType ? window.TakeoffCatalogAdapter.measurementType(item, inferTakeoffTypeFromUom(item.uom)) : inferTakeoffTypeFromUom(item.uom);
            if (inferred && $('createLayerType')) {
                $('createLayerType').value = inferred;
                updateCreateLayerTypeUi(inferred);
            }
            if ($('createLayerUom')) {
                $('createLayerUom').value = item.uom || 'ea';
                updateUomDropdownTrigger('createLayer', item.uom || 'ea');
            }
            const color = item.takeoffDefaults?.color || item.color;
            if (color) setCreateLayerColor(color);
            const symbol = item.takeoffDefaults?.symbol || item.symbol;
            if (symbol && $('createLayerSymbol')) $('createLayerSymbol').value = symbol;
            updateCreateLayerSubmitState();
            closeCatalogModal();
            setTimeout(() => $('createLayerCatalogName')?.focus(), 40);
            return;
        }
        $('layerNameInput').value = item.name || '';
        setSelectValue($('layerUomInput'), item.uom || 'ea');
        updateUomDropdownTrigger('editLayer', item.uom || 'ea');
        const inferred = window.TakeoffCatalogAdapter?.measurementType ? window.TakeoffCatalogAdapter.measurementType(item, inferTakeoffTypeFromUom(item.uom)) : inferTakeoffTypeFromUom(item.uom);
        if (inferred) {
            $('layerTypeInput').value = inferred;
            $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[inferred];
            updateLayerTypeIcon();
        }
        const symbol = item.takeoffDefaults?.symbol || item.symbol;
        const color = item.takeoffDefaults?.color || item.color;
        if (symbol && TAKEOFF_SYMBOLS.includes(symbol)) $('layerSymbolInput').value = symbol;
        if (color) {
            setLayerColor(color);
        }
        updateAssociatedCatalogCard(null);
        updateCatalogSelectionIndicator();
        updateLayerSubmitState();
        closeCatalogModal();
        setTimeout(() => $('layerNameInput')?.focus(), 40);
    }

    async function submitLayerModal() {
        const name = $('layerNameInput')?.value.trim();
        if (!name) return closeLayerModal();
        const submit = $('layerCreateSubmit');
        if (submit?.dataset.saving === '1') return;
        const editingLayerId = takeoffState.editingLayerId;
        if (submit) {
            submit.dataset.saving = '1';
            submit.disabled = true;
            submit.textContent = 'Saving...';
        }
        try {
            pushTakeoffHistory(editingLayerId ? 'edit-layer' : 'create-layer');
            const type = $('layerTypeInput').value;
            const chosenColor = ($('layerColorInput')?.value === '__custom__'
                ? $('layerCustomColorPicker')?.value
                : $('layerColorInput')?.value) || '#ef4444';
            const strokeWidth = Number($('layerStrokeInput')?.value || 4);
            const payload = {
                name,
                type,
                tag: $('layerTagInput')?.value.trim() || '',
                multiplier: Number($('layerMultiplierInput')?.value || 1),
                uom: $('layerUomInput')?.value || typeToUom(type),
                symbol: $('layerSymbolInput')?.value || 'Solid Circle',
                size: $('layerSizeInput')?.value || 'Medium',
                markerDiameter: Math.max(8, Math.min(192, Number($('layerDiameterInput')?.value || (strokeWidth * 4)))),
                strokeWidth: Math.max(1, Math.min(20, strokeWidth)),
                color: chosenColor,
                dropLength: Number($('layerDropInput')?.value || 0),
                spacing: Number($('layerSpacingInput')?.value || 0),
                height: Number($('layerHeightInput')?.value || 0),
                depth: Number($('layerDepthInput')?.value || 0)
            };
            if (takeoffState.pendingCatalogItem) {
                try {
                    Object.assign(payload, catalogItemMeta(takeoffState.pendingCatalogItem));
                } catch (metaError) {
                    console.warn('catalogItemMeta failed', metaError);
                    payload.catalogItemId = takeoffState.pendingCatalogItem.id;
                    payload.catalog_item_id = takeoffState.pendingCatalogItem.id;
                }
            }
            if (editingLayerId) {
                const layer = findLayer(editingLayerId);
                if (layer) {
                    Object.assign(layer, payload);
                    layer.tag = payload.tag;
                    layer.costCode = payload.tag;
                    if (!layer.metadata_json || typeof layer.metadata_json !== 'object') layer.metadata_json = {};
                    layer.metadata_json.tag = payload.tag;
                    if (payload.unitCost !== undefined) layer.unitCost = payload.unitCost;
                    if (payload.laborHours !== undefined) layer.laborHours = payload.laborHours;
                }
                callEditor('projectTakeoffUpdateLayerObjects', editingLayerId, {
                    symbol: payload.symbol,
                    color: payload.color,
                    symbolSize: payload.markerDiameter / 2,
                    diameter: payload.markerDiameter,
                    strokeWidth: payload.strokeWidth
                });
                setActiveTakeoffLayer(editingLayerId, false);
            } else {
                const group = findGroup(takeoffState.pendingLayerGroupId);
                const layer = {
                    id: makeId('layer'),
                    groupId: group.id,
                    estimateId: activeEstimateId(),
                    quantity: 0,
                    tag: payload.tag,
                    costCode: payload.tag,
                    metadata_json: { tag: payload.tag },
                    ...payload
                };
                group.layers.push(layer);
                group.isExpanded = true;
                takeoffState.activeGroupId = group.id;
                setActiveTakeoffLayer(layer.id, false);
            }
            syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
            // Modal Save is a durable operation, not merely a request for the
            // editor's delayed autosave. Waiting for this ACK prevents a quick
            // close/reload from restoring the duplicate's previous appearance.
            const saved = callEditor('projectTakeoffSave');
            if (saved && typeof saved.then === 'function') await saved;
            closeLayerModal();
            saveTakeoffState();
            renderTakeoffPanel();
        } catch (error) {
            console.warn('Takeoff layer save failed', error);
            showPrepared('Unable to save Takeoff item changes. Please try again.');
        } finally {
            if (submit) {
                submit.dataset.saving = '0';
                submit.disabled = !$('layerNameInput')?.value.trim();
                submit.textContent = editingLayerId ? 'Save' : 'Create';
            }
        }
    }

    const browseCatalogState = {
        activeTab: 'cost_catalog',
        selectedCatalogId: null,
        selectedGroupId: null,
        selectedItemId: null,
        itemQuery: '',
        catalogQuery: '',
        page: 1,
        pageSize: 40,
        expandedCatalogs: {}
    };

    function ensureCatalogModal() {
        if ($('takeoffCatalogModal')) return;
        const modal = document.createElement('div');
        modal.id = 'takeoffCatalogModal';
        modal.className = 'pro-modal-backdrop pro-catalog-backdrop';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="pro-browse-catalog-modal" role="dialog" aria-modal="true" aria-labelledby="takeoffCatalogModalTitle">
                <div class="pro-browse-catalog-head">
                    <h2 id="takeoffCatalogModalTitle">Select catalog item</h2>
                    <button class="pro-icon-btn" type="button" data-catalog-close aria-label="Close">&times;</button>
                </div>
                <div class="pro-browse-catalog-tabs">
                    <button type="button" class="pro-browse-catalog-tab active" data-browse-tab="cost_catalog">Cost Catalog</button>
                    <button type="button" class="pro-browse-catalog-tab" data-browse-tab="masterformat">Masterformat</button>
                    <button type="button" class="pro-browse-catalog-tab" data-browse-tab="uniformat">Uniformat</button>
                </div>
                <div class="pro-browse-catalog-body">
                    <aside class="pro-browse-cat-sidebar">
                        <div class="pro-browse-cat-sidebar-head">Catalogs</div>
                        <div class="pro-browse-cat-search">
                            <input id="proBrowseCatSearch" type="search" placeholder="Search Catalogs" autocomplete="off">
                            <i class="fas fa-magnifying-glass"></i>
                        </div>
                        <div class="pro-browse-cat-tree" id="proBrowseCatTree"></div>
                    </aside>
                    <main class="pro-browse-items-main">
                        <div class="pro-browse-items-head">
                            <div class="pro-browse-items-head-top">
                                <span class="pro-browse-items-title" id="proBrowseItemsTitle">All Catalog Items</span>
                            </div>
                            <div class="pro-btn-create-item-row" style="margin-top:-2px; margin-bottom:4px;">
                                <button type="button" class="pro-btn-create-item-link" id="proBrowseCreateNewItemBtn">
                                    <i class="fas fa-plus"></i> Create New Item
                                </button>
                            </div>
                            <div class="pro-browse-items-controls">
                                <div class="pro-browse-items-controls-left">
                                    <input type="checkbox" id="proBrowseSelectAll" aria-label="Select all items">
                                    <button type="button" class="pro-cat-tool-btn">
                                        <i class="fas fa-bars"></i> Common <i class="fas fa-caret-down"></i>
                                    </button>
                                    <button type="button" class="pro-cat-tool-btn">
                                        <i class="fas fa-filter"></i> Filters
                                    </button>
                                </div>
                                <div class="pro-browse-item-search">
                                    <input id="proBrowseItemSearch" type="search" placeholder="Search catalog item name" autocomplete="off">
                                    <i class="fas fa-magnifying-glass"></i>
                                </div>
                            </div>
                        </div>
                        <div class="pro-browse-items-list" id="proBrowseItemsList"></div>
                        <div class="pro-browse-pagination">
                            <span id="proBrowsePaginationText">0-0 of 0</span>
                            <span>Page: <select id="proBrowsePageSelect" style="padding: 1px 4px; font-size: 11px; border: 1px solid var(--tk-border); border-radius: 4px; background: inherit; color: inherit;"></select></span>
                            <div class="pro-browse-pagination-arrows">
                                <button type="button" class="pro-browse-pagination-arrow" id="proBrowsePrevPage" disabled title="Previous page"><i class="fas fa-chevron-left"></i></button>
                                <button type="button" class="pro-browse-pagination-arrow" id="proBrowseNextPage" disabled title="Next page"><i class="fas fa-chevron-right"></i></button>
                            </div>
                        </div>
                    </main>
                </div>
                <div class="pro-browse-catalog-foot">
                    <button type="button" class="pro-btn-browse-cancel" data-catalog-close>Cancel</button>
                    <button type="button" class="pro-btn-browse-select" id="proBrowseSelectBtn" disabled>Select</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        modal.querySelectorAll('[data-catalog-close]').forEach(btn => btn.addEventListener('click', closeCatalogModal));

        modal.querySelectorAll('[data-browse-tab]').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
                modal.querySelectorAll('[data-browse-tab]').forEach(b => b.classList.remove('active'));
                tabBtn.classList.add('active');
                browseCatalogState.activeTab = tabBtn.dataset.browseTab;
                browseCatalogState.page = 1;
                renderCatalogBrowser();
            });
        });

        $('proBrowseCatSearch')?.addEventListener('input', e => {
            browseCatalogState.catalogQuery = e.target.value.trim().toLowerCase();
            renderCatalogSidebar();
        });

        $('proBrowseItemSearch')?.addEventListener('input', e => {
            clearTimeout(e.target._timer);
            e.target._timer = setTimeout(() => {
                browseCatalogState.itemQuery = e.target.value.trim().toLowerCase();
                browseCatalogState.page = 1;
                renderCatalogItems();
            }, 120);
        });

        $('proBrowseSelectBtn')?.addEventListener('click', () => {
            const selected = getSelectedCatalogItem();
            if (selected) {
                applyCatalogItemToLayerForm(selected);
            }
        });

        $('proBrowseCreateNewItemBtn')?.addEventListener('click', () => {
            window.open('/pages/cost_catalog.php', '_blank');
        });

        $('proBrowsePrevPage')?.addEventListener('click', () => {
            if (browseCatalogState.page > 1) {
                browseCatalogState.page--;
                renderCatalogItems();
            }
        });

        $('proBrowseNextPage')?.addEventListener('click', () => {
            browseCatalogState.page++;
            renderCatalogItems();
        });

        $('proBrowsePageSelect')?.addEventListener('change', e => {
            browseCatalogState.page = Number(e.target.value) || 1;
            renderCatalogItems();
        });
    }

    function openCatalogModal() {
        ensureTakeoffModal();
        ensureCatalogModal();
        const createModal = $('takeoffCreateLayerModal');
        if (createModal && !createModal.hidden) {
            createModal.classList.add('is-behind');
        }
        browseCatalogState.selectedItemId = null;
        browseCatalogState.page = 1;
        browseCatalogState.itemQuery = '';
        browseCatalogState.catalogQuery = '';
        $('takeoffCatalogModal').hidden = false;
        loadCatalogItems();
        setTimeout(() => $('proBrowseItemSearch')?.focus(), 50);
    }

    function closeCatalogModal() {
        const modal = $('takeoffCatalogModal');
        if (modal) modal.hidden = true;
        const createModal = $('takeoffCreateLayerModal');
        if (createModal && !createModal.hidden) {
            createModal.classList.remove('is-behind');
            setTimeout(() => $('createLayerCatalogName')?.focus(), 50);
        }
    }

    async function loadCatalogItems() {
        if (catalogState.loaded || catalogState.loading) {
            renderCatalogBrowser();
            return;
        }
        catalogState.loading = true;
        catalogState.error = '';
        renderCatalogBrowser();
        try {
            if (window.CatalogService) {
                const snapshot = await window.CatalogService.getSnapshot({ enabledForProjectsOnly: false });
                catalogState.catalogs = snapshot.catalogs || [];
                catalogState.groups = snapshot.categories || [];
                catalogState.items = snapshot.items || [];
            } else {
                const res = await fetch('../api/cost_catalog.php?action=list');
                const json = await res.json();
                if (json.status === 'success' && json.data) {
                    catalogState.catalogs = (json.data.catalogs || []).map(c => ({ id: c.id, name: c.name, locked: Boolean(Number(c.locked || 0)) }));
                    catalogState.groups = (json.data.groups || []).map(g => ({ id: g.id, catalogId: g.catalog_id, parentGroupId: g.parent_group_id, name: g.name }));
                    catalogState.items = (json.data.items || json.data.allItems || []).map(i => ({
                        id: i.id,
                        name: i.name,
                        description: i.description || '',
                        type: i.item_type || 'material',
                        uom: i.unit_of_measure || 'ea',
                        color: i.color,
                        symbol: i.symbol,
                        pricing: { unitCost: Number(i.unit_cost || 0), laborHoursPerUnit: Number(i.labor_hours || 0) },
                        catalog: { id: i.catalog_id, name: i.catalog_name || '' },
                        category: { id: i.catalog_group_id, name: i.group_name || '' },
                        supplier: { catalogNumber: i.catalog_number || '' },
                        classification: { costCode: i.cost_code || '', masterformat: i.masterformat || '', uniformat: i.uniformat || '' }
                    }));
                }
            }
            catalogState.loaded = true;
        } catch (e) {
            console.warn('Cost Catalog load failed', e);
            catalogState.error = e.message || 'Unable to load Cost Catalog';
        } finally {
            catalogState.loading = false;
            renderCatalogBrowser();
        }
    }

    function renderCatalogBrowser() {
        renderCatalogSidebar();
        renderCatalogItems();
    }

    function renderCatalogSidebar() {
        const tree = $('proBrowseCatTree');
        if (!tree) return;
        const q = browseCatalogState.catalogQuery;
        const isAllActive = !browseCatalogState.selectedCatalogId && !browseCatalogState.selectedGroupId;

        let html = `
            <div class="pro-cat-tree-node ${isAllActive ? 'active' : ''}" data-cat-select="all">
                <i class="fas fa-bars pro-cat-icon"></i>
                <span class="node-name">All Catalog Items</span>
            </div>
            <div class="pro-cat-tree-node ${browseCatalogState.selectedCatalogId === '__recent__' ? 'active' : ''}" data-cat-select="recent">
                <i class="fas fa-clock pro-cat-icon"></i>
                <span class="node-name">Most Recently Used Items</span>
            </div>
        `;

        (catalogState.catalogs || []).forEach(cat => {
            if (q && !cat.name.toLowerCase().includes(q)) return;
            const catId = String(cat.id);
            const isCatActive = String(browseCatalogState.selectedCatalogId) === catId && !browseCatalogState.selectedGroupId;
            const isExpanded = Boolean(browseCatalogState.expandedCatalogs[catId] ?? true);
            const groups = (catalogState.groups || []).filter(g => String(g.catalogId) === catId && !g.parentGroupId);

            html += `
                <div class="pro-cat-tree-node ${isCatActive ? 'active' : ''}" data-cat-select="${esc(catId)}">
                    ${groups.length ? `<i class="fas fa-caret-right node-carat ${isExpanded ? 'open' : ''}" data-cat-toggle="${esc(catId)}"></i>` : '<span style="width:14px;"></span>'}
                    <i class="fas fa-folder node-icon"></i>
                    <span class="node-name" title="${esc(cat.name)}">${esc(cat.name)}</span>
                    ${cat.locked ? '<i class="fas fa-lock node-lock"></i>' : ''}
                </div>
            `;

            if (isExpanded && groups.length) {
                html += '<div class="pro-cat-tree-children">';
                groups.forEach(grp => {
                    const grpId = String(grp.id);
                    const isGrpActive = String(browseCatalogState.selectedGroupId) === grpId;
                    html += `
                        <div class="pro-cat-tree-node ${isGrpActive ? 'active' : ''}" data-cat-group-select="${esc(grpId)}" data-cat-parent="${esc(catId)}">
                            <i class="fas fa-folder-open node-icon" style="font-size:11px;"></i>
                            <span class="node-name" title="${esc(grp.name)}">${esc(grp.name)}</span>
                        </div>
                    `;
                });
                html += '</div>';
            }
        });

        tree.innerHTML = html;

        tree.querySelectorAll('[data-cat-toggle]').forEach(carat => {
            carat.addEventListener('click', e => {
                e.stopPropagation();
                const cid = carat.dataset.catToggle;
                browseCatalogState.expandedCatalogs[cid] = !browseCatalogState.expandedCatalogs[cid];
                renderCatalogSidebar();
            });
        });

        tree.querySelectorAll('[data-cat-select]').forEach(node => {
            node.addEventListener('click', () => {
                const target = node.dataset.catSelect;
                if (target === 'all') {
                    browseCatalogState.selectedCatalogId = null;
                    browseCatalogState.selectedGroupId = null;
                    if ($('proBrowseItemsTitle')) $('proBrowseItemsTitle').textContent = 'All Catalog Items';
                } else if (target === 'recent') {
                    browseCatalogState.selectedCatalogId = '__recent__';
                    browseCatalogState.selectedGroupId = null;
                    if ($('proBrowseItemsTitle')) $('proBrowseItemsTitle').textContent = 'Most Recently Used Items';
                } else {
                    browseCatalogState.selectedCatalogId = target;
                    browseCatalogState.selectedGroupId = null;
                    const cat = (catalogState.catalogs || []).find(c => String(c.id) === target);
                    if ($('proBrowseItemsTitle')) $('proBrowseItemsTitle').textContent = cat ? cat.name : 'Catalog Items';
                }
                browseCatalogState.page = 1;
                renderCatalogSidebar();
                renderCatalogItems();
            });
        });

        tree.querySelectorAll('[data-cat-group-select]').forEach(node => {
            node.addEventListener('click', () => {
                const grpId = node.dataset.catGroupSelect;
                const parentCatId = node.dataset.catParent;
                browseCatalogState.selectedCatalogId = parentCatId;
                browseCatalogState.selectedGroupId = grpId;
                const grp = (catalogState.groups || []).find(g => String(g.id) === grpId);
                const cat = (catalogState.catalogs || []).find(c => String(c.id) === parentCatId);
                if ($('proBrowseItemsTitle')) $('proBrowseItemsTitle').textContent = `${cat ? cat.name + ' > ' : ''}${grp ? grp.name : 'Group'}`;
                browseCatalogState.page = 1;
                renderCatalogSidebar();
                renderCatalogItems();
            });
        });
    }

    function filterBrowseCatalogItems() {
        const items = catalogState.items || [];
        const q = browseCatalogState.itemQuery;
        const catId = browseCatalogState.selectedCatalogId;
        const grpId = browseCatalogState.selectedGroupId;
        const tab = browseCatalogState.activeTab;

        return items.filter(item => {
            if (catId === '__recent__') {
                // Return all items
            } else if (grpId) {
                if (String(item.category?.id || '') !== String(grpId)) return false;
            } else if (catId) {
                if (String(item.catalog?.id || '') !== String(catId)) return false;
            }
            if (tab === 'masterformat' && !item.classification?.masterformat) {
                // Allow browsing under masterformat tab
            }
            if (tab === 'uniformat' && !item.classification?.uniformat) {
                // Allow browsing under uniformat tab
            }
            if (q) {
                const searchString = [
                    item.name,
                    item.description,
                    item.catalog?.name,
                    item.category?.name,
                    item.supplier?.catalogNumber,
                    item.classification?.costCode,
                    item.uom
                ].filter(Boolean).join(' ').toLowerCase();
                if (!searchString.includes(q)) return false;
            }
            return true;
        });
    }

    function renderCatalogItems() {
        const list = $('proBrowseItemsList');
        const selectBtn = $('proBrowseSelectBtn');
        if (!list) return;

        if (catalogState.loading) {
            list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--tk-text-muted);"><i class="fas fa-spinner fa-spin" style="font-size: 24px; color: var(--tk-primary);"></i><p style="margin-top: 10px;">Loading catalog items...</p></div>';
            return;
        }

        const filtered = filterBrowseCatalogItems();
        const total = filtered.length;
        const pageSize = browseCatalogState.pageSize;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (browseCatalogState.page > totalPages) browseCatalogState.page = totalPages;
        const start = (browseCatalogState.page - 1) * pageSize;
        const pageItems = filtered.slice(start, start + pageSize);

        // Update pagination
        const end = Math.min(start + pageItems.length, total);
        const text = total > 0 ? `${start + 1}-${end} of ${total.toLocaleString()}` : '0 of 0';
        if ($('proBrowsePaginationText')) $('proBrowsePaginationText').textContent = text;
        if ($('proBrowsePrevPage')) $('proBrowsePrevPage').disabled = browseCatalogState.page <= 1;
        if ($('proBrowseNextPage')) $('proBrowseNextPage').disabled = browseCatalogState.page >= totalPages;

        const pageSelect = $('proBrowsePageSelect');
        if (pageSelect) {
            let opts = '';
            for (let i = 1; i <= totalPages; i++) {
                opts += `<option value="${i}"${i === browseCatalogState.page ? ' selected' : ''}>${i}</option>`;
            }
            pageSelect.innerHTML = opts;
        }

        if (!pageItems.length) {
            list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--tk-text-muted);"><i class="fas fa-box-open" style="font-size: 28px; opacity: 0.5;"></i><p style="margin-top: 10px; font-size: 13px;">No catalog items match this criteria.</p></div>';
            if (selectBtn) { selectBtn.disabled = true; selectBtn.classList.remove('is-active'); }
            return;
        }

        list.innerHTML = pageItems.map(item => {
            const isSelected = String(browseCatalogState.selectedItemId) === String(item.id);
            const isAssembly = item.type === 'assembly';
            const unitCost = Number(item.pricing?.unitCost || 0);
            const laborHours = Number(item.pricing?.laborHoursPerUnit || 0);
            const costStr = unitCost > 0 ? `$${unitCost.toFixed(2)}` : '$0.00';
            const laborStr = laborHours > 0 ? `${laborHours % 1 === 0 ? laborHours.toFixed(0) : laborHours.toFixed(2)} hrs` : '0 hrs';
            const catalogName = item.catalog?.name || 'Catalog';
            const categoryName = item.category?.name ? ` > ${item.category.name}` : '';
            const catPath = `${catalogName}${categoryName}`;
            const code = item.supplier?.catalogNumber || 'n/a';

            return `
                <div class="pro-catalog-item-card ${isSelected ? 'is-selected' : ''}" data-browse-item="${esc(item.id)}">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} data-item-check="${esc(item.id)}" aria-label="Select ${esc(item.name)}">
                    <div class="pro-catalog-item-content">
                        <div class="pro-catalog-item-title">${esc(item.name)}</div>
                        ${item.description ? `<div class="pro-catalog-item-desc">${esc(item.description)}</div>` : ''}
                        <div class="pro-catalog-item-chips">
                            ${isAssembly ? '<span class="pro-cat-badge-assembly">Assembly</span>' : ''}
                            <span>UoM <strong>${esc(item.uom || 'ea')}</strong></span>
                            <span>UC <strong>${costStr}</strong></span>
                            <span>ULT <strong>${laborStr}</strong></span>
                            <span>CN <strong>${esc(code)}</strong></span>
                            <span>CC <strong>${esc(catPath)}</strong></span>
                        </div>
                    </div>
                    <button type="button" class="pro-catalog-item-menu" title="Item actions" aria-label="Item actions"><i class="fas fa-ellipsis-vertical"></i></button>
                </div>
            `;
        }).join('');

        // Wire click handlers
        list.querySelectorAll('[data-browse-item]').forEach(card => {
            const id = card.dataset.browseItem;
            card.addEventListener('click', (e) => {
                if (e.target.closest('.pro-catalog-item-menu')) return;
                browseCatalogState.selectedItemId = id;
                updateBrowseSelectionUi();
            });
            card.addEventListener('dblclick', () => {
                browseCatalogState.selectedItemId = id;
                const item = getSelectedCatalogItem();
                if (item) applyCatalogItemToLayerForm(item);
            });
        });

        list.querySelectorAll('[data-item-check]').forEach(check => {
            check.addEventListener('change', (e) => {
                e.stopPropagation();
                if (check.checked) {
                    browseCatalogState.selectedItemId = check.dataset.itemCheck;
                } else if (String(browseCatalogState.selectedItemId) === String(check.dataset.itemCheck)) {
                    browseCatalogState.selectedItemId = null;
                }
                updateBrowseSelectionUi();
            });
        });

        updateBrowseSelectionUi();
    }

    function updateBrowseSelectionUi() {
        const list = $('proBrowseItemsList');
        const selectBtn = $('proBrowseSelectBtn');
        const selectedId = String(browseCatalogState.selectedItemId || '');

        if (list) {
            list.querySelectorAll('.pro-catalog-item-card').forEach(card => {
                const cardId = String(card.dataset.browseItem || '');
                const isSelected = selectedId && cardId === selectedId;
                card.classList.toggle('is-selected', isSelected);
                const checkbox = card.querySelector('input[type="checkbox"]');
                if (checkbox) checkbox.checked = isSelected;
            });
        }

        if (selectBtn) {
            const hasSelected = Boolean(selectedId && getSelectedCatalogItem());
            selectBtn.disabled = !hasSelected;
            selectBtn.classList.toggle('is-active', hasSelected);
        }
    }

    function getSelectedCatalogItem() {
        if (!browseCatalogState.selectedItemId) return null;
        return (catalogState.items || []).find(i => String(i.id) === String(browseCatalogState.selectedItemId));
    }

    let takeoffGroupModalReturnFocus = null;

    function closeTakeoffGroupModal() {
        const modal = $('takeoffGroupModal');
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        document.body.classList.remove('pro-dialog-open');
        const input = $('takeoffGroupName');
        const error = $('takeoffGroupNameError');
        if (input) { input.value = ''; input.removeAttribute('aria-invalid'); }
        if (error) { error.hidden = true; error.textContent = ''; }
        if ($('takeoffGroupNameCount')) $('takeoffGroupNameCount').textContent = '0 / 120';
        takeoffGroupModalReturnFocus?.focus?.();
        takeoffGroupModalReturnFocus = null;
    }

    function openTakeoffGroupModal(trigger = document.activeElement) {
        const modal = $('takeoffGroupModal');
        const input = $('takeoffGroupName');
        if (!modal || !input) return;
        takeoffGroupModalReturnFocus = trigger;
        modal.hidden = false;
        document.body.classList.add('pro-dialog-open');
        requestAnimationFrame(() => input.focus());
    }

    function createTakeoffGroup(name) {
        const normalizedName = String(name || '').trim().replace(/\s+/g, ' ');
        if (!normalizedName) return false;
        const estimateId = activeEstimateId();
        if (takeoffState.groups.some(group => groupBelongsToEstimate(group, estimateId)
            && String(group.name || '').trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) return false;
        pushTakeoffHistory('create-group');
        const id = makeId('grp');
        const estimatingGroupId = `takeoff_group_${id}`;
        const group = { id, estimatingGroupId, estimateId, name: normalizedName, isExpanded: true, isDefault: false, layers: [] };
        takeoffState.groups.push(group);
        takeoffState.activeGroupId = group.id;
        window.dispatchEvent(new CustomEvent('takeoff:estimating-group-create-requested', {
            detail: {
                projectId: String(window.ProjectState?.projectId || ''), estimateId,
                group: {
                    id: estimatingGroupId, takeoffGroupId: group.id, name: group.name,
                    expanded: true, sortOrder: takeoffState.groups.filter(row => groupBelongsToEstimate(row)).length - 1, items: []
                }
            }
        }));
        saveTakeoffState();
        renderTakeoffPanel();
        return true;
    }

    function submitTakeoffGroupModal(event) {
        event.preventDefault();
        const input = $('takeoffGroupName');
        const error = $('takeoffGroupNameError');
        const name = String(input?.value || '').trim().replace(/\s+/g, ' ');
        let message = '';
        if (!name) message = 'Enter a group name.';
        else if (takeoffState.groups.some(group => groupBelongsToEstimate(group)
            && String(group.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase())) message = 'A group with this name already exists in this estimate.';
        if (message) {
            if (error) { error.textContent = message; error.hidden = false; }
            input?.setAttribute('aria-invalid', 'true');
            input?.focus();
            return;
        }
        if (createTakeoffGroup(name)) closeTakeoffGroupModal();
    }

    function collapseAllTakeoffGroups() {
        takeoffState.groups.filter(group => groupBelongsToEstimate(group)).forEach(group => { group.isExpanded = false; });
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function duplicateGroup(groupId) {
        const group = findGroup(groupId);
        pushTakeoffHistory('duplicate-group');
        const copy = {
            id: makeId('grp'),
            estimateId: activeEstimateId(),
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

    function setGroupName(groupId, newName) {
        const group = findGroupExact(groupId);
        if (!group) return;
        group.name = newName;
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function copyGroupToEstimate(groupId, targetEstimateId) {
        const group = findGroupExact(groupId);
        if (!group || !targetEstimateId) return;
        const copy = {
            id: makeId('grp'),
            estimatingGroupId: `takeoff_group_${makeId('grp')}`,
            estimateId: targetEstimateId,
            name: `${group.name} (Copy)`,
            isExpanded: true,
            isDefault: false,
            layers: (group.layers || []).map(layer => ({
                ...layer,
                id: makeId('layer'),
                estimateId: targetEstimateId,
                groupId: null,
                quantity: layer.quantity || 0,
                baseQuantity: layer.baseQuantity || 0
            }))
        };
        copy.layers.forEach(layer => { layer.groupId = copy.id; });
        takeoffState.groups.push(copy);
        saveTakeoffState();
        showPrepared(`Group copied to target estimate.`);
    }

    function moveGroupToEstimate(groupId, targetEstimateId) {
        const group = findGroupExact(groupId);
        if (!group || !targetEstimateId) return;
        group.estimateId = targetEstimateId;
        (group.layers || []).forEach(l => { l.estimateId = targetEstimateId; });
        saveTakeoffState();
        renderTakeoffPanel();
        showPrepared(`Group moved to target estimate.`);
    }

    function openGroupContextMenu(groupId, button) {
        let menu = $('takeoffGroupContextMenu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'takeoffGroupContextMenu';
            menu.className = 'pro-group-context-menu';
            document.body.appendChild(menu);
        }
        const group = findGroup(groupId);
        if (!group) return;
        takeoffState.contextGroupId = groupId;

        const state = loadEstimatingStateForSync();
        const otherEstimates = (state?.estimates || []).filter(est => String(est.id) !== activeEstimateId());

        menu.innerHTML = `
            <button type="button" data-group-ctx="create-layer"><i class="fas fa-plus"></i> Create New Takeoff Layer</button>
            <div class="pro-menu-divider"></div>
            <button type="button" data-group-ctx="rename"><i class="fas fa-pen"></i> Rename</button>
            <button type="button" data-group-ctx="copy"><i class="far fa-copy"></i> Copy</button>
            <div class="pro-menu-item-has-sub">
                <button type="button" data-group-ctx="copy-other"><i class="far fa-copy"></i> Copy to other estimate <i class="fas fa-caret-right pro-menu-arrow"></i></button>
                <div class="pro-menu-sub" id="groupCopyEstimateSub">
                    ${otherEstimates.length ? otherEstimates.map(est => `
                        <button type="button" data-ctx-copy-est="${esc(est.id)}">${esc(est.name || 'Estimate')}</button>
                    `).join('') : '<div style="padding: 6px 12px; font-size: 11px; color: var(--tk-text-muted);">No other estimates</div>'}
                </div>
            </div>
            <div class="pro-menu-item-has-sub">
                <button type="button" data-group-ctx="move-other"><i class="fas fa-arrows-turn-to-dots"></i> Move to other estimate <i class="fas fa-caret-right pro-menu-arrow"></i></button>
                <div class="pro-menu-sub" id="groupMoveEstimateSub">
                    ${otherEstimates.length ? otherEstimates.map(est => `
                        <button type="button" data-ctx-move-est="${esc(est.id)}">${esc(est.name || 'Estimate')}</button>
                    `).join('') : '<div style="padding: 6px 12px; font-size: 11px; color: var(--tk-text-muted);">No other estimates</div>'}
                </div>
            </div>
            <div class="pro-menu-divider"></div>
            <button type="button" class="danger" data-group-ctx="delete"><i class="fas fa-trash-can"></i> Delete</button>
        `;

        const rect = button.getBoundingClientRect();
        menu.style.display = 'flex';
        menu.style.visibility = 'hidden';
        menu.style.top = '0px';
        menu.style.left = '0px';

        const menuRect = menu.getBoundingClientRect();
        const bounds = getTakeoffBoundary(button);
        const margin = 8;
        const gap = 2;
        const isSubhead = Boolean(button.closest('#takeoffSubheadItemInfo'));
        let left = isSubhead ? rect.left : rect.right + gap;
        let top = isSubhead ? rect.bottom + 4 : rect.top;

        // Detect if footer exists and calculate bottom limit so menu never touches or overlaps the footer or boundary
        const footer = document.querySelector('.est-version-bar') || $('takeoffEstimateTypesFooter');
        const footerRect = footer ? footer.getBoundingClientRect() : null;
        const bottomLimit = (footerRect && footerRect.top > 0) ? Math.min(footerRect.top - margin, bounds.bottom) : bounds.bottom;

        // If it overflows the right edge of the boundary, flip to the left of the button
        if (left + menuRect.width > (isSubhead ? window.innerWidth - 12 : bounds.right)) {
            left = isSubhead ? window.innerWidth - menuRect.width - 12 : rect.left - menuRect.width - gap;
        }

        // If it overflows the bottom limit (or touches the footer), align bottom with button bottom or flip upwards
        if (top + menuRect.height > (isSubhead ? window.innerHeight - 12 : bottomLimit)) {
            top = isSubhead ? rect.top - menuRect.height - 4 : Math.max(bounds.top, rect.bottom - menuRect.height);
        }

        if (!isSubhead) {
            left = Math.max(bounds.left, Math.min(left, bounds.right - menuRect.width));
            top = Math.max(bounds.top, Math.min(top, bottomLimit - menuRect.height));
        }

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        menu.style.visibility = 'visible';

        menu.querySelectorAll('.pro-menu-item-has-sub').forEach(item => {
            item.addEventListener('mouseenter', () => {
                const sub = item.querySelector('.pro-menu-sub');
                if (!sub) return;
                sub.style.top = '0';
                sub.style.bottom = 'auto';
                const subRect = sub.getBoundingClientRect();
                if (subRect.bottom > window.innerHeight - 12 || (bottomLimit && subRect.bottom > bottomLimit)) {
                    sub.style.top = 'auto';
                    sub.style.bottom = '0';
                }
            });
        });

        menu.querySelector('[data-group-ctx="create-layer"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            closeGroupContextMenu();
            openCreateLayerModal(groupId);
        });
        menu.querySelector('[data-group-ctx="rename"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            closeGroupContextMenu();
            promptRenameGroup(group);
        });
        menu.querySelector('[data-group-ctx="copy"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            closeGroupContextMenu();
            duplicateGroup(groupId);
        });
        menu.querySelectorAll('[data-ctx-copy-est]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeGroupContextMenu();
                copyGroupToEstimate(groupId, btn.dataset.ctxCopyEst);
            });
        });
        menu.querySelectorAll('[data-ctx-move-est]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeGroupContextMenu();
                moveGroupToEstimate(groupId, btn.dataset.ctxMoveEst);
            });
        });
        menu.querySelector('[data-group-ctx="delete"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            closeGroupContextMenu();
            deleteGroup(groupId);
        });
    }

    function closeEstimatePickerPopup() {
        const pop = $('takeoffEstimatePickerPopup');
        if (pop) pop.remove();
    }

    function openEstimatePickerPopup(button, groupId, action = 'move') {
        closeEstimatePickerPopup();
        const state = loadEstimatingStateForSync();
        const otherEstimates = (state?.estimates || []).filter(est => String(est.id) !== activeEstimateId());
        if (!otherEstimates.length) {
            showTakeoffToast?.('No other estimates in this project.');
            return;
        }
        const pop = document.createElement('div');
        pop.id = 'takeoffEstimatePickerPopup';
        pop.className = 'pro-menu-sub open';
        pop.style.display = 'flex';
        pop.style.position = 'fixed';
        pop.style.zIndex = '99999';
        pop.innerHTML = `
            <div style="padding: 4px 10px; font-size: 11px; font-weight: 600; color: var(--tk-text-muted); border-bottom: 1px solid var(--tk-border, #e2e8f0); margin-bottom: 2px;">
                ${action === 'copy' ? 'Copy to estimate:' : 'Move to estimate:'}
            </div>
            ${otherEstimates.map(est => `
                <button type="button" data-picker-est="${esc(est.id)}" style="display:flex;align-items:center;gap:7px;padding:6px 12px;width:100%;text-align:left;border:none;background:transparent;cursor:pointer;font-size:12px;color:inherit;">
                    <i class="fas ${action === 'copy' ? 'fa-copy' : 'fa-arrow-right'}" style="font-size:11px;opacity:0.7;"></i>
                    <span>${esc(est.name || 'Estimate')}</span>
                </button>
            `).join('')}
        `;
        document.body.appendChild(pop);
        const rect = button.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 4;
        const popRect = pop.getBoundingClientRect();
        if (left + popRect.width > window.innerWidth - 12) {
            left = window.innerWidth - popRect.width - 12;
        }
        if (top + popRect.height > window.innerHeight - 12) {
            top = rect.top - popRect.height - 4;
        }
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;

        pop.querySelectorAll('[data-picker-est]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const estId = btn.dataset.pickerEst;
                closeEstimatePickerPopup();
                if (action === 'copy') {
                    copyGroupToEstimate(groupId, estId);
                } else {
                    moveGroupToEstimate(groupId, estId);
                }
            });
        });

        const closeOnOutside = (e) => {
            if (!pop.contains(e.target) && e.target !== button && !button.contains(e.target)) {
                closeEstimatePickerPopup();
                document.removeEventListener('pointerdown', closeOnOutside, true);
            }
        };
        setTimeout(() => document.addEventListener('pointerdown', closeOnOutside, true), 10);
    }

    function closeGroupContextMenu() {
        const menu = $('takeoffGroupContextMenu');
        if (menu) menu.style.display = 'none';
        takeoffState.contextGroupId = null;
    }

    function promptRenameGroup(group) {
        if (!group) return;
        if (typeof window.openRenameModal === 'function') {
            window.openRenameModal({
                title: 'Rename Group',
                label: 'Group Name',
                currentName: group.name,
                onSave: (newName) => {
                    if (!newName || !newName.trim()) return;
                    pushTakeoffHistory('rename-group');
                    group.name = newName.trim();
                    group.isDefault = false;
                    saveTakeoffState();
                    window.dispatchEvent(new CustomEvent('takeoff:estimating-group-rename-requested', {
                        detail: {
                            projectId: String(window.ProjectState?.projectId || ''),
                            estimateId: activeEstimateId(),
                            groupId: group.estimatingGroupId || `takeoff_group_${group.id}`,
                            name: group.name
                        }
                    }));
                    renderTakeoffPanel();
                    showTakeoffToast?.('Group renamed.');
                }
            });
        } else {
            const newName = prompt('Enter new group name:', group.name);
            if (newName && newName.trim() && newName.trim() !== group.name) {
                pushTakeoffHistory('rename-group');
                group.name = newName.trim();
                group.isDefault = false;
                saveTakeoffState();
                window.dispatchEvent(new CustomEvent('takeoff:estimating-group-rename-requested', {
                    detail: {
                        projectId: String(window.ProjectState?.projectId || ''),
                        estimateId: activeEstimateId(),
                        groupId: group.estimatingGroupId || `takeoff_group_${group.id}`,
                        name: group.name
                    }
                }));
                renderTakeoffPanel();
            }
        }
    }

    function renameGroup(groupId) {
        const group = findGroup(groupId);
        if (!group) return;
        promptRenameGroup(group);
    }

    async function deleteGroup(groupId) {
        const group = findGroupExact(groupId);
        if (!group) return;
        const msg = group.layers.length
            ? `Delete group "${group.name}" and all its ${group.layers.length} takeoff layer(s)?`
            : `Delete group "${group.name}"?`;
        let confirmed = false;
        if (typeof window.showConfirmDialog === 'function') {
            confirmed = await window.showConfirmDialog({
                title: 'Delete Group',
                message: msg,
                confirmText: 'Delete Group',
                primaryDanger: true
            });
        } else {
            confirmed = confirm(msg);
        }
        if (!confirmed) return;
        deleteTakeoffGroups([group.id], false);
    }

    async function deleteTakeoffGroups(groupIds, ask = true) {
        const wanted = new Set((groupIds || []).map(String));
        const groups = takeoffState.groups.filter(group => wanted.has(String(group.id))
            && groupBelongsToEstimate(group));
        if (!groups.length) return false;
        const layerIds = groups.flatMap(group => (group.layers || []).map(layer => String(layer.id)));
        if (ask) {
            const msg = `Delete ${groups.length} group(s) and ${layerIds.length} takeoff layer(s)?`;
            let confirmed = false;
            if (typeof window.showConfirmDialog === 'function') {
                confirmed = await window.showConfirmDialog({
                    title: 'Delete Groups',
                    message: msg,
                    confirmText: 'Delete Groups',
                    primaryDanger: true
                });
            } else {
                confirmed = confirm(msg);
            }
            if (!confirmed) return false;
        }
        const deleted = callEditor('projectTakeoffDeleteLayers', layerIds);
        if (layerIds.length && !deleted) return showPrepared('Unlock the selected groups before deleting them.');
        pushTakeoffHistory('delete-groups');
        const estimatingGroupIds = groups.map(group => String(group.estimatingGroupId || `takeoff_group_${group.id}`));
        takeoffState.groups = takeoffState.groups.filter(group => !wanted.has(String(group.id)));
        selectionState.selectedGroupIds = [];
        selectionState.selectedLayerIds = [];
        selectionState.selectedObjectIds = [];
        if (wanted.has(String(takeoffState.activeGroupId))) takeoffState.activeGroupId = takeoffState.groups.find(group => groupBelongsToEstimate(group))?.id || null;
        if (layerIds.includes(String(takeoffState.activeLayerId))) takeoffState.activeLayerId = null;
        window.dispatchEvent(new CustomEvent('takeoff:estimating-groups-delete-requested', {
            detail: {
                projectId: String(window.ProjectState?.projectId || ''), estimateId: activeEstimateId(), groupIds: estimatingGroupIds
            }
        }));
        saveTakeoffState();
        renderTakeoffPanel(); renderSelectionBar(); renderInspector(); updateSubheadSelectedItem();
        return true;
    }

    function reorderTakeoffGroup(sourceId, targetId) {
        const estimateId = activeEstimateId();
        const scopedIndexes = takeoffState.groups.map((group, index) => groupBelongsToEstimate(group, estimateId) ? index : -1).filter(index => index >= 0);
        const scoped = scopedIndexes.map(index => takeoffState.groups[index]);
        const from = scoped.findIndex(group => String(group.id) === String(sourceId));
        const to = scoped.findIndex(group => String(group.id) === String(targetId));
        if (from < 0 || to < 0 || from === to) return false;
        pushTakeoffHistory('reorder-groups');
        const [moved] = scoped.splice(from, 1);
        scoped.splice(to, 0, moved);
        scoped.forEach((group, index) => { group.sortOrder = index; takeoffState.groups[scopedIndexes[index]] = group; });
        window.dispatchEvent(new CustomEvent('takeoff:estimating-groups-reorder-requested', {
            detail: {
                projectId: String(window.ProjectState?.projectId || ''), estimateId,
                groupIds: scoped.map(group => String(group.estimatingGroupId || `takeoff_group_${group.id}`))
            }
        }));
        saveTakeoffState(); renderTakeoffPanel();
        return true;
    }

    async function deleteLayer(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        let confirmed = false;
        if (typeof window.showConfirmDialog === 'function') {
            confirmed = await window.showConfirmDialog({
                title: 'Delete Takeoff Layer',
                message: `Are you sure you want to delete takeoff layer "${layer.name}" and its measurements?`,
                confirmText: 'Delete Layer',
                primaryDanger: true
            });
        } else {
            confirmed = confirm(`Delete this takeoff layer "${layer.name}"?`);
        }
        if (!confirmed) return;
        pushTakeoffHistory('delete-layer');
        callEditor('projectTakeoffDeleteLayer', layer.id);
        const group = findGroup(layer.groupId);
        if (group) group.layers = group.layers.filter(item => item.id !== layerId);
        if (takeoffState.activeLayerId === layerId) takeoffState.activeLayerId = null;
        saveTakeoffState();
        renderTakeoffPanel();
        updateSubheadSelectedItem();
    }

    function duplicateLayer(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        pushTakeoffHistory('duplicate-layer');
        const group = findGroup(layer.groupId);
        const copyId = makeId('layer');
        const copy = {
            ...JSON.parse(JSON.stringify(layer)),
            id: copyId,
            name: `${layer.name} Copy`,
            color: window.TakeoffColorPalette.duplicateColor(layer.color, (group.layers || []).map(item => item.color)),
            quantity: 0,
            baseQuantity: 0,
            shapes: [],
            takeoffObjects: [],
            metadata: { ...(JSON.parse(JSON.stringify(layer.metadata || {}))), project_layer_id: copyId },
            metadata_json: { ...(JSON.parse(JSON.stringify(layer.metadata_json || {}))), project_layer_id: copyId }
        };
        group.layers.push(copy);
        setActiveTakeoffLayer(copy.id, false);
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function renameLayer(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        if (typeof window.openRenameModal === 'function') {
            window.openRenameModal({
                title: 'Rename Takeoff Layer',
                label: 'Layer Name',
                currentName: layer.name,
                onSave: (newName) => {
                    if (!newName || !newName.trim()) return;
                    pushTakeoffHistory('rename-layer');
                    layer.name = newName.trim();
                    syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
                    callEditor('projectTakeoffSave');
                    saveTakeoffState();
                    renderTakeoffPanel();
                    updateSubheadSelectedItem();
                }
            });
        } else {
            const name = prompt('Rename layer', layer.name);
            if (!name || !name.trim()) return;
            pushTakeoffHistory('rename-layer');
            layer.name = name.trim();
            syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
            callEditor('projectTakeoffSave');
            saveTakeoffState();
            renderTakeoffPanel();
            updateSubheadSelectedItem();
        }
    }

    function changeLayerColor(layerId) {
        const layer = findLayer(layerId);
        if (!layer) return;
        const color = prompt('Layer color hex', layer.color);
        if (!color) return;
        pushTakeoffHistory('change-layer-color');
        layer.color = color.trim();
        callEditor('projectTakeoffUpdateLayerObjects', layer.id, { color: layer.color });
        syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
        callEditor('projectTakeoffSave');
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
        syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
        callEditor('projectTakeoffSave');
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function bindSubheadItemActions() {
        const info = $('takeoffSubheadItemInfo');
        if (!info || info.__actionsBound) return;
        info.__actionsBound = true;
        info.addEventListener('click', event => {
            const groupBtn = event.target.closest('[data-subhead-group-action]');
            if (groupBtn) {
                event.stopPropagation();
                const action = groupBtn.dataset.subheadGroupAction;
                const groupId = selectionState.selectedGroupIds?.[0] || takeoffState.activeGroupId;
                const group = findGroup(groupId);
                if (!group) {
                    showPrepared('No group selected.');
                    return;
                }

                if (action === 'create-layer') {
                    openCreateLayerModal(groupId);
                } else if (action === 'rename') {
                    promptRenameGroup(group);
                } else if (action === 'copy') {
                    duplicateGroup(groupId);
                } else if (action === 'copy-other') {
                    openEstimatePickerPopup(groupBtn, groupId, 'copy');
                } else if (action === 'move-other') {
                    openEstimatePickerPopup(groupBtn, groupId, 'move');
                } else if (action === 'delete') {
                    if (selectionState.selectedGroupIds.length > 1) {
                        deleteTakeoffGroups(selectionState.selectedGroupIds);
                    } else {
                        deleteGroup(groupId);
                    }
                } else if (action === 'more') {
                    openGroupContextMenu(groupBtn, groupId);
                }
                return;
            }

            const btn = event.target.closest('[data-subhead-item-action]');
            if (!btn) return;
            event.stopPropagation();
            const action = btn.dataset.subheadItemAction;
            const activeLayerId = takeoffState.activeLayerId || selectionState.activeLayerId;
            const hasSelection = selectionState.selectedObjectIds.length > 0;

            if (action === 'copy') {
                if (hasSelection) {
                    runSelectionAction('copy');
                } else if (activeLayerId) {
                    duplicateLayer(activeLayerId);
                } else {
                    showPrepared('Select a takeoff item first.');
                }
            } else if (action === 'move') {
                if (hasSelection) {
                    runSelectionAction('move');
                } else if (activeLayerId) {
                    moveLayerToGroup(activeLayerId);
                } else {
                    showPrepared('Select a takeoff item first.');
                }
            } else if (action === 'delete') {
                if (hasSelection) {
                    runSelectionAction('delete');
                } else if (activeLayerId) {
                    deleteLayer(activeLayerId);
                } else {
                    showPrepared('Select a takeoff item first.');
                }
            }
        });
    }

    function syncTakeoffSubheadAlignment() {
        // 5: takeoffSubheadItemInfo is centered horizontally via CSS
        const itemInfo = document.getElementById('takeoffSubheadItemInfo');
        if (itemInfo) {
            itemInfo.style.marginLeft = '';
        }

        // 3: Match drawing scale button width with save project button & center in exact same location
        const saveBtn = document.getElementById('saveProjectBtn');
        const scaleBtn = document.getElementById('takeoffScaleStatus');
        const scaleSlot = document.getElementById('takeoffSubheadScaleSlot');
        if (saveBtn && scaleBtn && scaleSlot) {
            const saveRect = saveBtn.getBoundingClientRect();
            if (saveRect.width > 0) {
                // 1. Give scale button the width of save project minus 2px (1px each side)
                const targetW = Math.max(20, Math.round(saveRect.width) - 2);
                const widthPx = `${targetW}px`;
                scaleBtn.style.width = widthPx;
                scaleBtn.style.minWidth = widthPx;
                scaleBtn.style.maxWidth = widthPx;
                scaleBtn.style.overflow = 'hidden';
                scaleBtn.style.textOverflow = 'ellipsis';
                scaleBtn.style.whiteSpace = 'nowrap';

                // 2. Reset marginRight to 0 to read the natural unshifted layout position
                scaleSlot.style.marginRight = '0px';
                const scaleRect = scaleBtn.getBoundingClientRect();

                // 3. Align centers: calculate how much scale is further right than save, nudged 2.5px right
                const saveCenter = saveRect.left + (saveRect.width / 2);
                const scaleCenter = scaleRect.left + (scaleRect.width / 2);
                const diff = Number(((scaleCenter - saveCenter) - 2.5).toFixed(1));
                if (diff > 0) {
                    scaleSlot.style.marginRight = `${diff}px`;
                } else {
                    scaleSlot.style.marginRight = '0px';
                }
            }
        }
    }
    window.syncTakeoffLayout = syncTakeoffSubheadAlignment;

    function updateSubheadSelectedItem() {
        const info = $('takeoffSubheadItemInfo');
        if (!info) return;
        bindSubheadItemActions();

        const selectedGroupIds = selectionState.selectedGroupIds || [];
        const isGroupSelected = selectedGroupIds.length > 0;
        const selectedGroup = isGroupSelected ? findGroup(selectedGroupIds[0]) : null;

        const activeLayerId = takeoffState.activeLayerId || selectionState.activeLayerId;
        const activeLayer = typeof findLayer === 'function' ? findLayer(activeLayerId) : null;
        const selectedCount = selectionState.selectedObjectIds?.length || 0;

        const dot = $('takeoffSubheadItemDot');
        const name = $('takeoffSubheadItemName');
        const meta = $('takeoffSubheadItemMeta');
        const actionsContainer = info.querySelector('.takeoff-subhead-item-actions');

        if (isGroupSelected && selectedGroup) {
            info.classList.add('is-visible', 'is-group-info');
            info.style.display = 'inline-flex';
            if (dot) {
                dot.style.background = 'transparent';
                dot.innerHTML = '<i class="fas fa-folder" style="color: #f59e0b; font-size: 11.5px;"></i>';
            }
            if (name) {
                name.textContent = selectedGroupIds.length > 1 ? `${selectedGroupIds.length} groups selected` : selectedGroup.name;
            }
            if (meta) {
                const layerCount = (selectedGroup.layers || []).length;
                meta.textContent = `${layerCount} ${layerCount === 1 ? 'item' : 'items'}`;
            }

            if (actionsContainer) {
                actionsContainer.innerHTML = `
                    <button type="button" class="subhead-item-act-btn" data-subhead-group-action="create-layer" title="Create New Takeoff Layer">
                        <i class="fas fa-plus"></i><span>New Item</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn" data-subhead-group-action="rename" title="Rename Group">
                        <i class="fas fa-pen"></i><span>Rename</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn" data-subhead-group-action="copy" title="Copy Group">
                        <i class="far fa-copy"></i><span>Copy</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn" data-subhead-group-action="move-other" title="Move to other estimate">
                        <i class="fas fa-arrows-turn-to-dots"></i><span>Move to</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn danger" data-subhead-group-action="delete" title="Delete Group">
                        <i class="fas fa-trash"></i><span>Delete</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn icon-only" data-subhead-group-action="more" title="More group options">
                        <i class="fas fa-ellipsis-vertical"></i>
                    </button>
                `;
            }
        } else if (activeLayer || selectedCount > 0) {
            info.classList.add('is-visible');
            info.classList.remove('is-group-info');
            info.style.display = 'inline-flex';
            if (dot) {
                dot.innerHTML = '';
                dot.style.background = activeLayer?.color || '#2563eb';
            }
            if (name) name.textContent = activeLayer?.name || (selectedCount > 1 ? `${selectedCount} elements selected` : '1 element selected');
            if (meta) {
                if (selectedCount > 1) {
                    meta.textContent = `${selectedCount} selected`;
                } else if (activeLayer) {
                    meta.textContent = `${activeLayer.type || 'Count'} · ${quantityLabel(activeLayer)}`;
                } else {
                    meta.textContent = 'Selected element';
                }
            }

            if (actionsContainer) {
                actionsContainer.innerHTML = `
                    <button type="button" class="subhead-item-act-btn" data-subhead-item-action="copy" title="Copy item or selection">
                        <i class="fas fa-copy"></i><span>Copy</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn" data-subhead-item-action="move" title="Move item to group">
                        <i class="fas fa-folder-tree"></i><span>Move to</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn danger" data-subhead-item-action="delete" title="Delete item or selection">
                        <i class="fas fa-trash"></i><span>Delete</span>
                    </button>
                `;
            }
        } else {
            info.classList.remove('is-visible', 'is-group-info');
            info.style.display = 'none';
        }
        syncTakeoffSubheadAlignment();
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
        updateSubheadSelectedItem();
        if ($('takeoffDrawingDropdown')?.classList.contains('open')) renderDrawingDropdown();
    }

    function selectTakeoffContext(layerId, rerender = true) {
        const layer = findLayer(layerId);
        if (!layer) return;
        takeoffState.activeLayerId = layer.id;
        takeoffState.activeGroupId = layer.groupId;
        if (rerender) renderTakeoffPanel();
        renderActiveLayerToolbar();
        updateSubheadSelectedItem();
        if ($('takeoffDrawingDropdown')?.classList.contains('open')) renderDrawingDropdown();
    }

    function clearActiveTakeoffLayer(rerender = true) {
        takeoffState.activeLayerId = null;
        callEditor('projectTakeoffClearActiveLayer');
        saveTakeoffState();
        if (rerender) renderTakeoffPanel();
        renderActiveLayerToolbar();
        updateSubheadSelectedItem();
        if ($('takeoffDrawingDropdown')?.classList.contains('open')) renderDrawingDropdown();
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

    function applyLayerToCanvas(layer, options = {}) {
        const win = takeoffWindow();
        if (!win) return;
        if (!options.skipLayerSync) syncAllLayersToCanvas();
        const payload = layerCanvasPayload(layer);
        win.__projectActiveTakeoffLayer = payload;
        callEditor('projectTakeoffActivateLayer', payload);
        if (isLinearType(layer.type)) setActiveTool('linear');
        if (isAreaType(layer.type)) setActiveTool('area');
        if (!isLinearType(layer.type) && !isAreaType(layer.type)) setActiveTool('count');
    }

    function syncTakeoffFromCanvasSnapshot(snapshot, options = {}) {
        if (!snapshot || !Array.isArray(snapshot.layers)) return;
        const estimateId = String(snapshot.estimateKey || snapshot.estimate_key || '');
        if (!estimateId || estimateId !== activeEstimateId()) return;
        const doc = activeDrawingDoc();
        const documentId = String(snapshot.drawingId || snapshot.drawing_id || doc?.id || 'active');
        takeoffState.canvasSnapshots[`${estimateId}:${documentId}`] = {
            ...snapshot,
            estimateId,
            documentId,
            updatedAt: Date.now()
        };
        snapshot.layers.forEach(remote => {
            const layer = allLayers().find(row => layerBelongsToEstimate(row, estimateId)
                && String(row.id) === String(remote.id || remote.layerId));
            if (!layer) return;
            layer.shapes = remote.shapes || [];
            layer.takeoffObjects = remote.shapes || [];
            // Canvas snapshots report current state, but selection/state events
            // must never act as visibility commands. Only explicit eye/checkbox
            // actions are allowed to mutate layer.visible.
            if (remote.unit_of_measure || remote.uom) layer.uom = remote.unit_of_measure || remote.uom;
            if (remote.locked !== undefined) layer.locked = Boolean(remote.locked);
            if (remote.catalogMetadata) {
                layer.catalogMetadata = window.CatalogMetadata.clone(remote.catalogMetadata);
                layer.metadata_json = window.CatalogMetadata.mergeMetadata(layer.metadata_json, remote.catalogMetadata);
            }
        });
        applyAggregatedCanvasQuantities();
        if (snapshot.activeLayerId && findLayer(snapshot.activeLayerId)) {
            takeoffState.activeLayerId = snapshot.activeLayerId;
        }
        if (!options.suppressEstimatingSync) saveTakeoffState();
        renderTakeoffPanel();
        renderViewerLayersPopover();
        renderActiveLayerToolbar();
    }

    function applyAggregatedCanvasQuantities() {
        const totals = new Map();
        Object.values(takeoffState.canvasSnapshots || {}).forEach(snapshot => {
            if (String(snapshot.estimateId || snapshot.estimateKey || '') !== activeEstimateId()) return;
            (snapshot.layers || []).forEach(remote => {
                const id = String(remote.id || remote.layerId || '');
                if (!id) return;
                const objects = remote.shapes || remote.takeoffObjects || [];
                const objectTotal = objects
                    .reduce((sum, obj) => sum + Number(obj.quantityValue || obj.quantity || 0), 0);
                const remoteBase = Number(remote.baseQuantity ?? remote.base_quantity
                    ?? remote.seedQuantity ?? remote.seed_quantity ?? 0);
                const remoteMeasured = Math.max(0, Number(remote.quantity || 0) - remoteBase);
                // Count snapshots from older/editor-loading paths may expose the
                // aggregate quantity before their marker objects are hydrated.
                // The aggregate is a safe fallback; never add it on top of the
                // same objects or the Part would be counted twice.
                const measured = objects.length ? objectTotal : remoteMeasured;
                totals.set(id, (totals.get(id) || 0) + measured);
            });
        });
        allLayers().forEach(layer => {
            // A layer absent from the snapshots has not been observed as empty.
            // Preserve its persisted quantity until its drawing is hydrated;
            // overwriting it here made Count/Part items disappear while linear
            // layers on the active sheet continued to calculate normally.
            if (!totals.has(String(layer.id))) return;
            const base = Number(layer.baseQuantity || 0);
            layer.quantity = base + totals.get(String(layer.id));
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
        callEditor('projectTakeoffClearSelection');
        callEditor('projectTakeoffClearActiveLayer');
        renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
        updateSubheadSelectedItem();
    }

    function setSelectedObjects(ids = [], layerId = null) {
        selectionState.selectedObjectIds = Array.from(new Set(ids.map(String).filter(Boolean)));
        if (!ids.length && !layerId) {
            selectionState.activeLayerId = null;
            takeoffState.activeLayerId = null;
            takeoffState.activeGroupId = null;
            selectionState.selectedGroupIds = [];
            selectionState.selectedLayerIds = [];
        } else {
            selectionState.activeLayerId = layerId || selectionState.activeLayerId || takeoffState.activeLayerId;
            selectionState.selectedGroupIds = [];
            selectionState.selectedLayerIds = layerId ? [String(layerId)] : [];
        }
        renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
        updateSubheadSelectedItem();
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
        renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
        updateSubheadSelectedItem();
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

        // Activate this layer in the takeoff editor for drawing
        setActiveTakeoffLayer(layer.id, false);

        // Select objects for this single layer on canvas
        const selectedIds = callEditor('projectTakeoffSelectGroup', [String(layer.id)]);
        selectionState.selectedObjectIds = Array.isArray(selectedIds) ? selectedIds : [];

        renderTakeoffPanel();
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
        const group = findGroup(layer.groupId);
        const groupLayerIds = (group?.layers || []).map(item => String(item.id));
        const selectedGroups = new Set(selectionState.selectedGroupIds.map(String));
        if (groupLayerIds.length && groupLayerIds.every(id => ids.has(id))) selectedGroups.add(String(group.id));
        else selectedGroups.delete(String(group.id));
        selectionState.selectedGroupIds = Array.from(selectedGroups);
        selectionState.activeLayerId = selected ? layer.id : (selectionState.selectedLayerIds[0] || null);
        // Checking an item is also the user's placement-layer choice. Keep the
        // multi-layer/object selection below, but activate this specific layer
        // in the editor so the next drawing uses its type and catalog data.
        if (selected) setActiveTakeoffLayer(layer.id, false);
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
        renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
        updateSubheadSelectedItem();
    }

    function toggleLayerLock(layerId) {
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
            const deleted = callEditor('projectTakeoffDeleteSelection', selectionState.selectedObjectIds);
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
            callEditor('clearPlacementTool');
            callEditor('projectTakeoffSetTool', command === 'pan' ? 'pan' : 'select');
            setActiveTool(command);
            // Fabric has no independent pan mode here. Konva owns navigation
            // and mutually excludes object dragging while the hand is active.
            callEditor('setMode', 'smart');
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
        if (command === 'redo') return callEditor('redo');
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

    function showPrepared(command) {
        const old = document.querySelector('.toast-lite');
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.className = 'toast-lite';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.textContent = command.includes('.') ? command : `${command.replace('-', ' ')} is ready to connect.`;
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

    function syncScaleStatus(forcePresetSync = false) {
        const button = $('takeoffScaleStatus');
        if (!button) return;
        const editorDoc = editorDocument();
        const scaleText = (editorDoc?.getElementById('scale-display')?.textContent || '').trim();
        const label = button.querySelector('#takeoffScaleLabel') || button.querySelector('span:not(.pro-scale-dot)') || button.querySelector('span');
        const icon = button.querySelector('i');
        const hasScale = Boolean(scaleText && scaleText !== '--' && !scaleText.toLowerCase().includes('not set') && scaleText !== '0');
        button.classList.toggle('is-set', hasScale);
        if (icon) icon.style.display = 'none';
        if (label) label.textContent = hasScale ? `Scale: ${scaleText}` : 'Not Drawing Scale';

        const panel = $('takeoffScalePanel');
        const isPanelOpen = panel?.classList.contains('open');
        const presetSelect = $('takeoffScalePreset');
        const isUserDirty = presetSelect?.dataset?.userDirty === '1';

        // Only update preset dropdown if forced, or if panel is closed and user isn't actively selecting
        if (presetSelect && (forcePresetSync || (!isPanelOpen && !isUserDirty))) {
            if (hasScale) {
                for (let i = 0; i < presetSelect.options.length; i++) {
                    if (presetSelect.options[i].text.trim().toLowerCase() === scaleText.toLowerCase() ||
                        presetSelect.options[i].value.trim().toLowerCase() === scaleText.toLowerCase()) {
                        presetSelect.selectedIndex = i;
                        break;
                    }
                }
            } else {
                presetSelect.value = '';
            }
        }
    }
    window.syncScaleStatus = syncScaleStatus;

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
        const presetSelect = $('takeoffScalePreset');
        if (!panel) return;
        if (presetSelect) delete presetSelect.dataset.userDirty;
        syncScalePresets();
        syncScaleStatus(true);
        panel.classList.add('open');
        toggle?.setAttribute('aria-expanded', 'true');
        if (mode) setScaleMode(mode);
    }

    function closeScalePanel() {
        const presetSelect = $('takeoffScalePreset');
        if (presetSelect) delete presetSelect.dataset.userDirty;
        $('takeoffScalePanel')?.classList.remove('open');
        $('takeoffScaleStatus')?.setAttribute('aria-expanded', 'false');
    }

    function applyScalePreset(value) {
        if (!value) return;
        const applyCheckbox = $('takeoffScaleApplyAll');
        const applyAll = Boolean(applyCheckbox?.checked);
        const editorSelect = editorDocument()?.getElementById('cal-preset');
        if (editorSelect) editorSelect.value = value;
        const result = callEditor('applyScalePreset', value, applyAll);
        const presetSelect = $('takeoffScalePreset');
        if (presetSelect) delete presetSelect.dataset.userDirty;
        Promise.resolve(result).finally(() => {
            if (applyCheckbox) applyCheckbox.checked = false;
            syncScaleStatus(true);
            syncScaleHint();
        });
    }

    function applyManualScale() {
        const feet = $('takeoffManualFeet')?.value;
        const applyCheckbox = $('takeoffScaleApplyAll');
        const applyAll = Boolean(applyCheckbox?.checked);
        const editorInput = editorDocument()?.getElementById('cal-val');
        if (editorInput) editorInput.value = feet || '';
        const result = callEditor('finishCal', true, applyAll);
        const presetSelect = $('takeoffScalePreset');
        if (presetSelect) delete presetSelect.dataset.userDirty;
        Promise.resolve(result).finally(() => {
            if (applyCheckbox) applyCheckbox.checked = false;
            syncScaleStatus(true);
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
        $('takeoffScalePreset')?.addEventListener('change', () => {
            const target = $('takeoffScalePreset');
            if (target) target.dataset.userDirty = '1';
        });
        $('takeoffScaleApplyBtn')?.addEventListener('click', () => {
            const mode = $('takeoffScaleMode')?.value;
            if (mode === 'manual') {
                applyManualScale();
            } else {
                const presetVal = $('takeoffScalePreset')?.value;
                if (presetVal) {
                    applyScalePreset(presetVal);
                } else {
                    showToast('Please select a scale preset', 'warning');
                    return;
                }
            }
            closeScalePanel();
        });
        document.querySelector('[data-scale-apply-manual]')?.addEventListener('click', () => {
            applyManualScale();
            closeScalePanel();
        });
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
            if (document.hidden || !$('takeoffScalePanel')?.classList.contains('open')) return;
            syncScaleHint();
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

    function renderActiveDrawingItemBar() {
        const activeLayer = typeof findLayer === 'function' ? findLayer(takeoffState.activeLayerId || selectionState.activeLayerId) : null;
        const dot = $('takeoffDrawingActiveDot');
        const text = $('takeoffDrawingActiveText');
        const pill = $('takeoffDrawingActivePill');
        const countBadge = $('takeoffFilterItemCount');
        const filterItemBtn = $('takeoffFilterItemSheets');

        if (activeLayer) {
            if (dot) {
                dot.innerHTML = getLayerBadgeSvg(activeLayer, 14);
                dot.style.background = 'transparent';
                dot.style.display = 'inline-flex';
                dot.style.alignItems = 'center';
                dot.style.justifyContent = 'center';
                dot.style.width = '14px';
                dot.style.height = '14px';
            }
            if (text) text.textContent = activeLayer.name || 'Item sin nombre';
            if (pill) {
                pill.title = `Item activo: ${activeLayer.name} (${activeLayer.type || 'conteo'})`;
                pill.style.borderColor = `${activeLayer.color || '#2563eb'}60`;
            }

            const doc = browsingDrawingDoc();
            let matchCount = 0;
            if (doc) {
                const sheets = buildSheets(doc);
                matchCount = sheets.filter(s => s.takeoffSummary?.hasActiveItem).length;
            }
            if (countBadge) countBadge.textContent = matchCount;
            if (filterItemBtn) filterItemBtn.disabled = false;
        } else {
            if (dot) {
                dot.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="#94a3b8"><circle cx="12" cy="12" r="8.5"/></svg>';
                dot.style.background = 'transparent';
                dot.style.display = 'inline-flex';
                dot.style.alignItems = 'center';
                dot.style.justifyContent = 'center';
                dot.style.width = '14px';
                dot.style.height = '14px';
            }
            if (text) text.textContent = 'Ningún item seleccionado';
            if (pill) {
                pill.title = 'Selecciona un item en Takeoff para ver sus marcas en los planos';
                pill.style.borderColor = '#e2e8f0';
            }
            if (countBadge) countBadge.textContent = '0';
            if (filterItemBtn) {
                filterItemBtn.disabled = true;
                if (drawingState.filterMode === 'item') {
                    drawingState.filterMode = 'all';
                    $('takeoffFilterAllSheets')?.classList.add('active');
                    $('takeoffFilterItemSheets')?.classList.remove('active');
                }
            }
        }
    }

    function renderDrawingDropdown() {
        renderActiveDrawingItemBar();
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
        const totalCountBadge = $('takeoffDocTotalCount');
        if (totalCountBadge) totalCountBadge.textContent = drawingState.documents.length;

        if (!drawingState.documents.length) {
            box.innerHTML = `<div class="pro-drawing-empty">
                <strong>No drawings uploaded yet</strong>
                <span>Upload drawings in Documents to start takeoff.</span>
            </div>`;
            return;
        }

        const activeLayer = typeof findLayer === 'function' ? findLayer(takeoffState.activeLayerId || selectionState.activeLayerId) : null;

        const docs = drawingState.documents.filter(doc => {
            if (!drawingState.query) return true;
            if (matchesDrawingQuery(doc)) return true;
            return buildSheets(doc).some(sheet => matchesDrawingQuery(doc, sheet));
        });

        box.innerHTML = docs.map(doc => {
            const isSelected = doc.id === drawingState.browseDocumentId;
            let docHasActiveItem = false;
            let docHasAnyTakeoff = false;
            if (doc.sheets && doc.sheets.length > 0) {
                docHasActiveItem = doc.sheets.some(s => s.takeoffSummary?.hasActiveItem);
                docHasAnyTakeoff = doc.sheets.some(s => s.takeoffSummary?.hasAnyTakeoff);
            }
            return `
            <button class="pro-drawing-row ${isSelected ? 'active' : ''}" type="button" data-drawing-doc="${doc.id}" title="${esc(doc.name)}">
                <span class="pro-drawing-info">
                    <i class="fas fa-file-lines pro-doc-icon"></i>
                    <span class="pro-drawing-name">${esc(doc.name)}</span>
                </span>
                <span class="pro-drawing-meta">
                    ${docHasActiveItem ? `<span class="pro-drawing-item-dot" style="background: ${activeLayer?.color || '#2563eb'}" title="Contiene marcas de ${esc(activeLayer?.name || 'item activo')}"></span>` : (docHasAnyTakeoff ? `<span class="pro-drawing-takeoff-dot" title="Contiene marcas de takeoff"></span>` : '')}
                    <span class="pro-drawing-count">${doc.pageCount || (doc.extension === 'pdf' ? '...' : '1')}</span>
                </span>
            </button>`;
        }).join('') || '<div class="pro-drawing-empty">No drawings match your search.</div>';

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

        const activeLayer = typeof findLayer === 'function' ? findLayer(takeoffState.activeLayerId || selectionState.activeLayerId) : null;
        let sheets = buildSheets(doc).filter(sheet => matchesDrawingQuery(doc, sheet));

        const totalSheetBadge = $('takeoffSheetTotalCount');
        if (totalSheetBadge) totalSheetBadge.textContent = sheets.length;

        if (drawingState.filterMode === 'item') {
            sheets = sheets.filter(sheet => sheet.takeoffSummary?.hasActiveItem);
        }

        box.innerHTML = sheets.map(sheet => {
            const isCurrentEditorSheet = doc.id === drawingState.selectedDocumentId && sheet.pageNumber === drawingState.selectedPage;
            const isPreviewActive = sheet.pageNumber === (drawingState.previewPage || 1);
            const summary = sheet.takeoffSummary || getSheetTakeoffSummary(doc.id, sheet.pageNumber);
            const hasActiveMarks = summary.hasActiveItem;
            const activeCount = summary.activeItemMarks;

            return `<button class="pro-sheet-row ${isPreviewActive ? 'active' : ''} ${isCurrentEditorSheet ? 'is-editor-open' : ''}" type="button" data-drawing-page="${sheet.pageNumber}" title="${esc(sheet.name)}">
                <span class="pro-sheet-info">
                    <span class="pro-sheet-page-badge">Pág. ${sheet.pageNumber}</span>
                    <span class="pro-sheet-name">${esc(sheet.name)}</span>
                </span>
                <span class="pro-sheet-icons">
                    ${hasActiveMarks ? `
                        <span class="pro-sheet-item-mark" style="--mark-color: ${activeLayer?.color || '#2563eb'}" title="${activeCount} ${activeCount === 1 ? 'marca' : 'marcas'} de ${esc(activeLayer?.name || 'item activo')}">
                            <span class="pro-mark-dot" style="background: ${activeLayer?.color || '#2563eb'}"></span>
                            ${activeCount}
                        </span>
                    ` : (summary.hasAnyTakeoff ? `
                        <span class="pro-sheet-takeoff-tag" title="${summary.layers.length} ${summary.layers.length === 1 ? 'item' : 'items'} de cotización (${summary.totalMarks} marcas)">
                            <i class="fas fa-layer-group"></i> ${summary.layers.length}
                        </span>
                    ` : '')}
                    ${sheet.hasComments ? '<i class="fas fa-comment pro-comment-icon" title="Comentarios"></i>' : ''}
                    ${isCurrentEditorSheet ? '<span class="pro-sheet-current-tag" title="Hoja abierta en el visor"><i class="fas fa-eye"></i></span>' : ''}
                </span>
            </button>`;
        }).join('') || `<div class="pro-drawing-empty">${drawingState.filterMode === 'item' ? 'Ninguna hoja contiene marcas del item activo.' : 'No sheets match your search.'}</div>`;

        box.querySelectorAll('[data-drawing-page]').forEach(button => {
            button.addEventListener('mouseenter', () => renderSheetPreview(doc, Number(button.dataset.drawingPage)));
            button.addEventListener('focus', () => renderSheetPreview(doc, Number(button.dataset.drawingPage)));
            button.addEventListener('click', () => {
                const pg = Number(button.dataset.drawingPage);
                renderSheetPreview(doc, pg);
                selectDrawingSheet(doc, pg);
            });
        });

        const previewPage = drawingState.previewPage || (doc.id === drawingState.selectedDocumentId ? drawingState.selectedPage : 1);
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
        drawingState.previewPage = Math.max(1, Number(pageNumber) || 1);

        // Update sheet row active state in list
        document.querySelectorAll('#takeoffSheetList .pro-sheet-row').forEach(row => {
            if (Number(row.dataset.drawingPage) === drawingState.previewPage) {
                row.classList.add('active');
            } else {
                row.classList.remove('active');
            }
        });

        // Update preview headers
        const titleEl = $('takeoffPreviewTitle');
        const subEl = $('takeoffPreviewSub');
        if (titleEl) titleEl.textContent = sheetName(doc, drawingState.previewPage);
        if (subEl) subEl.textContent = `Hoja ${drawingState.previewPage} de ${doc.pageCount || 1} • ${esc(doc.name)}`;

        // Update Takeoff Items breakdown on this sheet
        const summary = getSheetTakeoffSummary(doc.id, drawingState.previewPage);
        const countEl = $('takeoffPreviewItemCount');
        const listEl = $('takeoffPreviewItemsList');
        const openBtn = $('takeoffOpenSheetBtn');

        if (countEl) countEl.textContent = `${summary.layers.length} ${summary.layers.length === 1 ? 'item' : 'items'} (${summary.totalMarks} marcas)`;
        if (listEl) {
            if (!summary.layers.length) {
                listEl.innerHTML = '<div class="pro-preview-empty-takeoff"><i class="fas fa-circle-info"></i> Sin marcas de cotización en esta hoja</div>';
            } else {
                listEl.innerHTML = summary.layers.map(l => `
                    <div class="pro-preview-item-row ${l.isActive ? 'is-active-item' : ''}">
                        <span class="pro-preview-item-symbol" style="background: ${l.color}22; color: ${l.color};">
                            ${typeof symbolGlyph === 'function' ? symbolGlyph(l) : '<i class="fas fa-circle"></i>'}
                        </span>
                        <div class="pro-preview-item-info">
                            <span class="pro-preview-item-name" title="${esc(l.name)}">
                                ${esc(l.name)}
                                ${l.isActive ? '<span class="pro-active-badge">Item Activo</span>' : ''}
                            </span>
                            <span class="pro-preview-item-qty">
                                ${Number(l.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${esc(l.uom)} &bull; ${l.markCount} ${l.markCount === 1 ? 'marca' : 'marcas'}
                            </span>
                        </div>
                    </div>
                `).join('');
            }
        }

        if (openBtn) {
            openBtn.disabled = false;
            openBtn.onclick = () => selectDrawingSheet(doc, drawingState.previewPage);
        }

        // Render thumbnail
        const requestId = ++drawingState.thumbnailRequest;
        showPreviewLoading();
        if (doc.extension !== 'pdf') {
            box.innerHTML = `<img src="${esc(doc.fileUrl)}" alt="${esc(doc.name)}">`;
            return;
        }
        const key = `${doc.id}:${drawingState.previewPage}`;
        try {
            if (drawingState.thumbnailCache.has(key)) {
                if (requestId === drawingState.thumbnailRequest) {
                    box.innerHTML = `<img src="${drawingState.thumbnailCache.get(key)}" alt="${esc(sheetName(doc, drawingState.previewPage))}">`;
                }
                return;
            }
            let dataUrl = null;
            if (doc.id === drawingState.selectedDocumentId) {
                dataUrl = await Promise.resolve(callEditor('takeoffRenderThumbnail', drawingState.previewPage));
            }
            if (!dataUrl) {
                const pdf = await getPdfDocument(doc);
                const page = await pdf.getPage(drawingState.previewPage);
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
                box.innerHTML = `<img src="${dataUrl}" alt="${esc(sheetName(doc, drawingState.previewPage))}">`;
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
        const nextSrc = takeoffEditorUrl(doc.id);
        let currentFrameId = 0;
        try {
            const currentUrl = new URL(frame.getAttribute('src') || '', window.location.href);
            currentFrameId = Number(currentUrl.searchParams.get('id') || 0);
        } catch (e) { }
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
        syncScaleStatus();
        setTimeout(syncScaleStatus, 250);
        setTimeout(syncScaleStatus, 700);
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
        $('takeoffFilterAllSheets')?.addEventListener('click', () => {
            drawingState.filterMode = 'all';
            $('takeoffFilterAllSheets')?.classList.add('active');
            $('takeoffFilterItemSheets')?.classList.remove('active');
            renderSheetList();
        });
        $('takeoffFilterItemSheets')?.addEventListener('click', () => {
            const activeLayer = typeof findLayer === 'function' ? findLayer(takeoffState.activeLayerId || selectionState.activeLayerId) : null;
            if (!activeLayer) return;
            drawingState.filterMode = 'item';
            $('takeoffFilterItemSheets')?.classList.add('active');
            $('takeoffFilterAllSheets')?.classList.remove('active');
            renderSheetList();
        });
        $('takeoffOpenSheetBtn')?.addEventListener('click', () => {
            const doc = browsingDrawingDoc();
            if (doc) selectDrawingSheet(doc, drawingState.previewPage || 1);
        });
        $('takeoffDrawingSearch')?.addEventListener('input', event => {
            clearTimeout(event.target._takeoffSearchTimer);
            event.target._takeoffSearchTimer = setTimeout(() => {
                drawingState.query = event.target.value.trim().toLowerCase();
                renderDrawingDropdown();
            }, 120);
        });
        window.addEventListener('message', event => {
            if (event.data?.type === 'project-takeoff-scale-required') {
                if (event.source !== takeoffWindow()) return;
                openScalePanel();
                showPrepared(event.data?.payload?.message || 'Set the drawing scale before adding linear items.');
                return;
            }
            if (event.data?.type === 'project-takeoff-state') {
                if (event.source !== takeoffWindow()) return;
                syncTakeoffFromCanvasSnapshot(event.data.payload);
                return;
            }
            if (event.data?.type === 'project-takeoff-selection') {
                const payload = event.data.payload || {};
                setSelectedObjects(payload.ids || payload.selectedObjectIds || [], payload.layerId || null);
                if (payload.layerId && findLayer(payload.layerId)) {
                    if (payload.activateLayer === true) {
                        const layer = findLayer(payload.layerId);
                        const group = findGroup(layer.groupId);
                        if (group) group.isExpanded = true;
                        setActiveTakeoffLayer(payload.layerId);
                        requestAnimationFrame(() => {
                            [...document.querySelectorAll('[data-layer-row]')]
                                .find(row => row.dataset.layerRow === String(layer.id))
                                ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        });
                    } else selectTakeoffContext(payload.layerId);
                }
                return;
            }
            if (event.data?.type === 'project-takeoff-tool-state') {
                const payload = event.data.payload || {};
                viewerState.continuousTool = Boolean(payload.continuous);
                const map = { takeoff_count: 'count', takeoff_linear: 'linear', takeoff_area: 'area', smart: 'smart', select: 'smart' };
                const reportedTool = map[payload.tool] || payload.tool || 'smart';
                const explicitPanActive = viewerState.activeTool === 'pan'
                    && document.querySelector('.pro-canvas-shell')?.classList.contains('is-panning');
                const annotationPlacementActive = viewerState.activeTool === 'cloud' || viewerState.activeTool === 'text';
                // The editor implements hand/pan on top of its internal smart
                // mode, so its `smart` report must not visually reselect Pointer
                // while the parent is actively panning.
                setActiveTool(reportedTool === 'smart' && annotationPlacementActive
                    ? viewerState.activeTool
                    : (explicitPanActive && reportedTool === 'smart' ? 'pan' : reportedTool));
                renderActiveLayerToolbar();
                return;
            }
            if (event.data?.type === 'project-annotation-tool-state') {
                if (event.source !== takeoffWindow()) return;
                setActiveTool(event.data?.payload?.tool || 'smart');
                return;
            }
            if (event.data?.type === 'project-takeoff-pan-state') {
                const payload = event.data.payload || {};
                if (payload.source !== 'background-gesture') return;
                if (payload.active) {
                    if (viewerState.activeTool !== 'pan') gesturePanPreviousTool = viewerState.activeTool;
                    setActiveTool('pan');
                    document.querySelector('.pro-canvas-shell')?.classList.add('is-panning');
                } else {
                    const restoreTool = gesturePanPreviousTool || 'smart';
                    gesturePanPreviousTool = null;
                    setActiveTool(restoreTool);
                    if (restoreTool !== 'pan') {
                        document.querySelector('.pro-canvas-shell')?.classList.remove('is-panning');
                    }
                }
                return;
            }
            if (event.data?.type === 'project-takeoff-zoom-changed') {
                if (event.source !== takeoffWindow()) return;
                const reportedPercent = Number(event.data?.payload?.percent);
                if (!Number.isFinite(reportedPercent)) return;
                // Editor-originated wheel, trackpad, pinch, and fit changes only
                // update controls here. Do not call setZoom(), which would send
                // the same value back into the iframe and create a feedback loop.
                updateZoomUi(Math.round(Math.max(25, Math.min(400, reportedPercent))));
                return;
            }
            if (event.data?.type === 'project-takeoff-scale-changed') {
                syncScaleStatus();
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
                syncScaleStatus();
            }
        });
        $('takeoffFrame')?.addEventListener('load', () => {
            setTimeout(syncEditorInfo, 250);
            setTimeout(notifyEditorVisible, 120);
            setTimeout(fitTakeoffToScreen, 520);
            setTimeout(() => {
                syncAllLayersToCanvas();
                const active = findLayer(takeoffState.activeLayerId);
                if (active) applyLayerToCanvas(active, { skipLayerSync: true });
                else callEditor('projectTakeoffClearActiveLayer');
            }, 360);
        });
    }

    window.projectTakeoffRefreshDrawings = function (targetDocId = null) {
        drawingState.documents = drawingDocs();
        const preferredId = targetDocId || window.ProjectState?.selectedDocumentId;
        if (preferredId && drawingState.documents.some(doc => Number(doc.id) === Number(preferredId))) {
            drawingState.selectedDocumentId = Number(preferredId);
            drawingState.browseDocumentId = Number(preferredId);
        } else if (!drawingState.documents.some(doc => Number(doc.id) === Number(drawingState.selectedDocumentId)) && drawingState.documents[0]) {
            drawingState.selectedDocumentId = drawingState.documents[0].id;
            drawingState.browseDocumentId = drawingState.documents[0].id;
        }
        setDrawingLabel();
        renderDrawingDropdown();
    };

    window.activateTakeoffDocument = function (documentId, pageNumber = 1) {
        window.projectTakeoffRefreshDrawings(documentId);
        const doc = drawingState.documents.find(d => Number(d.id) === Number(documentId));
        if (doc) {
            selectDrawingSheet(doc, pageNumber);
        } else if (drawingState.documents[0]) {
            selectDrawingSheet(drawingState.documents[0], pageNumber);
        }
    };

    function toggleTakeoffSidebar(forceState = null) {
        const workspace = $('takeoffWorkspace');
        if (!workspace) return;
        const willCollapse = forceState !== null ? Boolean(forceState) : !workspace.classList.contains('items-collapsed');
        workspace.classList.toggle('items-collapsed', willCollapse);

        const tabBtn = $('takeoffSidebarCollapseTab');
        if (tabBtn) {
            const icon = tabBtn.querySelector('i');
            if (icon) {
                icon.className = willCollapse ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
            }
            tabBtn.title = willCollapse ? 'Show Sidebar' : 'Hide Sidebar';
            tabBtn.setAttribute('aria-label', willCollapse ? 'Show Sidebar' : 'Hide Sidebar');
        }

        try {
            localStorage.setItem('takeoff_sidebar_collapsed', willCollapse ? '1' : '0');
        } catch (e) { }

        requestAnimationFrame(syncWorkspaceDensity);
        setTimeout(notifyEditorVisible, 80);
    }

    function initTakeoffSidebarResizer() {
        const workspace = $('takeoffWorkspace');
        const resizer = $('takeoffSidebarResizer');
        const collapseTab = $('takeoffSidebarCollapseTab');
        if (!workspace || !resizer) return;

        try {
            const savedWidth = localStorage.getItem('takeoff_sidebar_width');
            if (savedWidth) {
                const parsed = parseInt(savedWidth, 10);
                if (parsed >= 200 && parsed <= 700) {
                    workspace.style.setProperty('--tk-sidebar-width', `${parsed}px`);
                }
            }
            const savedCollapsed = localStorage.getItem('takeoff_sidebar_collapsed');
            if (savedCollapsed === '1') {
                toggleTakeoffSidebar(true);
            }
        } catch (e) { }

        collapseTab?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTakeoffSidebar();
        });

        let isDragging = false;
        let startX = 0;
        let startWidth = 320;

        resizer.addEventListener('pointerdown', (e) => {
            if (e.target.closest('#takeoffSidebarCollapseTab')) return;
            if (workspace.classList.contains('items-collapsed')) return;

            isDragging = true;
            startX = e.clientX;
            const currentComputed = parseInt(getComputedStyle(workspace).getPropertyValue('--tk-sidebar-width'), 10) || 320;
            startWidth = currentComputed;
            resizer.classList.add('is-dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            resizer.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        resizer.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const delta = e.clientX - startX;
            const newWidth = Math.max(220, Math.min(650, startWidth + delta));
            workspace.style.setProperty('--tk-sidebar-width', `${newWidth}px`);
        });

        const stopDragging = (e) => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('is-dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try {
                if (e.pointerId) resizer.releasePointerCapture(e.pointerId);
            } catch (err) { }

            const finalWidth = parseInt(getComputedStyle(workspace).getPropertyValue('--tk-sidebar-width'), 10) || 320;
            try {
                localStorage.setItem('takeoff_sidebar_width', `${finalWidth}px`);
            } catch (err) { }

            requestAnimationFrame(syncWorkspaceDensity);
            setTimeout(notifyEditorVisible, 50);
        };

        resizer.addEventListener('pointerup', stopDragging);
        resizer.addEventListener('pointercancel', stopDragging);
    }

    document.addEventListener('DOMContentLoaded', () => {
        setInspectorCollapsed(false);
        $('toggleTakeoffInspector')?.addEventListener('click', () => {
            setInspectorCollapsed(!$('takeoffWorkspace')?.classList.contains('inspector-collapsed'));
        });

        initTakeoffSidebarResizer();

        document.querySelectorAll('[data-takeoff-menu-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const menu = $(button.dataset.takeoffMenuToggle);
                setMenuExpanded(button, !menu?.classList.contains('open'));
            });
        });

        document.querySelectorAll('[data-takeoff-action]').forEach(button => {
            button.addEventListener('click', () => handleTakeoffAction(button.dataset.takeoffAction));
        });

        $('takeoffGroupForm')?.addEventListener('submit', submitTakeoffGroupModal);
        document.querySelectorAll('[data-group-modal-close]').forEach(button => button.addEventListener('click', closeTakeoffGroupModal));
        $('takeoffGroupName')?.addEventListener('input', event => {
            const input = event.currentTarget;
            const error = $('takeoffGroupNameError');
            input.removeAttribute('aria-invalid');
            if (error) { error.hidden = true; error.textContent = ''; }
            if ($('takeoffGroupNameCount')) $('takeoffGroupNameCount').textContent = `${input.value.length} / 120`;
        });
        $('takeoffGroupModal')?.addEventListener('click', event => {
            if (event.target.id === 'takeoffGroupModal') closeTakeoffGroupModal();
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

        const dockBtn = $('takeoffToolsDockToggle');
        const toolsPanel = $('takeoffFloatingTools');
        if (dockBtn && toolsPanel) {
            const savedDock = localStorage.getItem('takeoff.floatingToolsDock');
            if (savedDock === 'right') toolsPanel.classList.add('is-docked-right');
            dockBtn.addEventListener('click', () => {
                const isRight = toolsPanel.classList.toggle('is-docked-right');
                localStorage.setItem('takeoff.floatingToolsDock', isRight ? 'right' : 'left');
            });
        }

        $('takeoffCompareBtn')?.addEventListener('click', () => {
            if (typeof window.showTakeoffToast === 'function') {
                window.showTakeoffToast('Drawing comparison feature coming soon.');
            }
        });

        $('takeoffDownloadDrawingBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.showAnnouncement === 'function') {
                window.showAnnouncement({
                    force: true,
                    type: 'info',
                    badge: 'DRAWING EXPORT',
                    icon: 'fas fa-cloud-arrow-down',
                    title: 'Download Current Drawing',
                    content: '<p>You are about to download the current drawing plan complete with all associated takeoff measurements, markers, annotations, and layer elements.</p><div class="g-announcement-highlight-box"><strong>Note:</strong> All visible takeoff layers and scale calibrations will be preserved in the exported document.</div>',
                    primaryText: 'Download Plan',
                    cancelText: 'Cancel',
                    showDontShow: false,
                    onPrimary: function () {
                        runViewerCommand('download');
                    }
                });
            } else {
                runViewerCommand('download');
            }
        });

        bindSubheadItemActions();

        document.querySelectorAll('[data-viewer-command]').forEach(button => {
            button.addEventListener('click', () => runViewerCommand(button.dataset.viewerCommand));
        });

        $('takeoffZoomSlider')?.addEventListener('input', event => setZoom(event.target.value));
        initTakeoffState();
        renderTakeoffEstimateFooter();
        $('takeoffEstimateTypesFooter')?.addEventListener('click', event => {
            const button = event.target.closest('[data-takeoff-estimate-id]');
            if (button) activateEstimate(button.dataset.takeoffEstimateId);
            const action = event.target.closest('[data-takeoff-estimating-action]')?.dataset.takeoffEstimatingAction;
            if (action) window.dispatchEvent(new CustomEvent('takeoff:estimating-action-requested', { detail: { action, sourceTab: 'takeoff' } }));
        });
        window.addEventListener('storage', event => {
            if (event.key === estimatingStoreKey()) renderTakeoffEstimateFooter();
        });
        window.addEventListener('takeoff:active-estimate-changed', (event) => {
            const estimateId = event.detail?.estimateId || activeEstimateId();
            takeoffState.activeEstimateId = String(estimateId);
            setSelectedObjects([]);
            renderTakeoffEstimateFooter();
            setTimeout(() => {
                ensureEstimateTakeoffWorkspace(estimateId, true);
                ensureEditorEstimate();
                renderTakeoffPanel();
                renderViewerLayersPopover();
                syncAllLayersToCanvas({ suppressEstimatingSync: true });
            }, 180);
        });
        window.addEventListener('takeoff:primary-estimate-changed', () => {
            renderTakeoffEstimateFooter();
        });
        window.addEventListener('takeoff:estimating-lines-updated', renderTakeoffEstimateFooter);
        window.addEventListener('takeoff:estimating-state-updated', renderTakeoffEstimateFooter);
        window.addEventListener('takeoff:estimating-items-updated', event => {
            syncEstimatingItemsToTakeoff(event.detail || {});
            renderTakeoffEstimateFooter();
        });
        ensureViewerLayersPopover();
        bindDrawingDropdown();
        bindScalePanel();
        $('takeoffFrame')?.addEventListener('load', () => setTimeout(notifyEditorVisible, 120));
        if (document.getElementById('tab-takeoff')?.classList.contains('active')) {
            setTimeout(notifyEditorVisible, 180);
        }

        document.addEventListener('click', (event) => {
            document.querySelectorAll('.pro-menu, .pro-row-menu').forEach(menu => menu.classList.remove('open'));
            document.querySelectorAll('[data-takeoff-menu-toggle]').forEach(button => button.setAttribute('aria-expanded', 'false'));
            activeRowMenuAnchor = null;
            closeScalePanel();
            closeDrawingDropdown();
            closeGroupContextMenu();
            $('takeoffMoreToolsPanel')?.setAttribute('hidden', '');

            if (!event.target.closest('[data-takeoff-group-row], [data-layer-row], button, input, .pro-tree-inline-edit, .pro-row-menu, .pro-tree-search-bar, .pro-floating-controls, .pro-floating-tools, #takeoffSubheadItemInfo, .est-version-tab, .est-version-menu, #saveProjectBtn, #takeoffDownloadDrawingBtn, #takeoffCompareBtn, #takeoffScaleStatus')) {
                if (document.body.classList.contains('is-takeoff-tab') || document.querySelector('.project-subhead-wrapper')?.classList.contains('is-takeoff-tab')) {
                    clearAllSelections();
                }
            }
        });
        document.addEventListener('click', event => {
            if (!viewerState.isLayersPopoverOpen) return;
            if (event.target.closest('#takeoffViewerLayersPopover') || event.target.closest('[data-viewer-command="layers"]')) return;
            closeViewerLayersPopover();
        });
        window.addEventListener('resize', () => {
            refreshOpenRowMenu();
            syncWorkspaceDensity();
            syncTakeoffSubheadAlignment();
        });
        setTimeout(syncTakeoffSubheadAlignment, 200);
        document.querySelector('[data-tab="takeoff"]')?.addEventListener('click', () => {
            setTimeout(syncTakeoffSubheadAlignment, 50);
            updateSubheadSelectedItem();
        });
        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(syncWorkspaceDensity);
            const viewer = document.querySelector('.pro-takeoff-viewer');
            if (viewer) observer.observe(viewer);
        }
        syncWorkspaceDensity();
        document.addEventListener('fullscreenchange', () => {
            viewerState.isFullscreen = Boolean(document.fullscreenElement);
            const icon = document.querySelector('[data-viewer-command="fullscreen"] i');
            if (icon) icon.className = viewerState.isFullscreen ? 'fas fa-compress' : 'fas fa-expand';
            $('takeoffWorkspace')?.classList.toggle('is-fullscreen', viewerState.isFullscreen);
            document.body.classList.toggle('takeoff-is-fullscreen', viewerState.isFullscreen);
            setTimeout(() => {
                callEditor('projectTakeoffFitToView');
                if (typeof syncTakeoffSubheadAlignment === 'function') syncTakeoffSubheadAlignment();
            }, 100);
        });
        document.addEventListener('scroll', refreshOpenRowMenu, true);
        $('takeoffScalePanel')?.addEventListener('click', event => event.stopPropagation());
        $('takeoffComparePanel')?.addEventListener('click', event => event.stopPropagation());
        $('takeoffMoreToolsPanel')?.addEventListener('click', event => event.stopPropagation());
        $('takeoffLayerModal')?.addEventListener('click', event => {
            if (event.target.id === 'takeoffLayerModal') closeLayerModal();
        });
        document.addEventListener('keydown', event => {
            const groupModal = $('takeoffGroupModal');
            if (groupModal && !groupModal.hidden) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeTakeoffGroupModal();
                    return;
                }
                if (event.key === 'Tab') {
                    const focusable = [...groupModal.querySelectorAll('button:not([disabled]), input:not([disabled])')];
                    if (!focusable.length) return;
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                }
                return;
            }
            if (event.key === 'Delete' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey
                && !event.target?.matches?.('input, textarea, select, option, [contenteditable="true"], [role="textbox"]')) {
                event.preventDefault();
                runSelectionAction('delete');
                return;
            }
            if (event.key === 'Escape') {
                viewerState.continuousTool = false;
                callEditor('clearPlacementTool');
                callEditor('projectTakeoffSetContinuous', false);
                callEditor('projectTakeoffSetTool', 'select');
                callEditor('projectTakeoffClearSelection');
                setSelectedObjects([]);
                callEditor('setMode', 'smart');
                setActiveTool('smart');
                renderActiveLayerToolbar();
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                undoTakeoff();
                return;
            }
            if (event.code === 'Space' && !event.repeat && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                temporaryPanPreviousTool = viewerState.activeTool;
                callEditor('projectTakeoffSetTemporaryPan', true);
                setActiveTool('pan');
                document.querySelector('.pro-canvas-shell')?.classList.add('is-panning');
            }
        });
        document.addEventListener('keyup', event => {
            if (event.code === 'Space') {
                callEditor('projectTakeoffSetTemporaryPan', false);
                if (temporaryPanPreviousTool === null) return;
                const restoreTool = temporaryPanPreviousTool || 'smart';
                temporaryPanPreviousTool = null;
                setActiveTool(restoreTool);
                if (restoreTool !== 'pan') {
                    document.querySelector('.pro-canvas-shell')?.classList.remove('is-panning');
                }
            }
        });
    });
})();
