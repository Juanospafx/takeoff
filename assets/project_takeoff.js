(function () {
    const $ = (id) => document.getElementById(id);
    let editorEstimateGeneration = 0;

    function canWrite() {
        return window.TakeoffAuth?.canWrite === true;
    }

    function requireWrite() {
        return window.TakeoffAuthorization?.requireWrite?.() === true;
    }

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

    window.canChangeTakeoffDrawing = () => {
        const visible = $('tab-takeoff')?.classList.contains('active');
        if (takeoffWindow()?.projectTakeoffCanChangeDrawing?.(visible) !== false) return true;
        if (!visible) window.TakeoffAnnouncement?.show({
            type: 'warning',
            title: 'Drawing in progress',
            message: 'Return to Takeoff and finish the drawing with Enter or double-click, or press Esc to cancel.',
            primaryText: 'Continue',
            force: true,
            showDontShow: false
        });
        return false;
    };

    const takeoffSaveCoordinator = window.TakeoffSaveCoordinator.create({
        getElement: $,
        getEditorWindow: takeoffWindow,
        getDocumentId: () => activeDrawingDoc()?.id || window.ProjectState?.selectedDocumentId,
        getEstimateId: () => activeEstimateId(),
        getPage: () => Number(drawingState?.selectedPage || 1),
        buildEditorUrl: takeoffEditorUrl,
        hasPendingDeletes: () => pendingDeletedTakeoffLayersByEstimate.size > 0
    });

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

    function takeoffEditorUrl(documentId, estimateId = activeEstimateId(), pageNumber = null) {
        const inheritLegacy = String(estimateId) === primaryEstimateId() ? '&inherit_legacy=1' : '';
        const parsedPage = Number(pageNumber);
        const pageParam = Number.isFinite(parsedPage) && parsedPage > 1 ? `&page=${Math.floor(parsedPage)}` : '';
        return `editor.php?id=${encodeURIComponent(documentId)}&embedded=1&estimate_key=${encodeURIComponent(estimateId)}${inheritLegacy}${pageParam}&_v=${Date.now()}`;
    }
    window.projectTakeoffEditorUrl = takeoffEditorUrl;

    const pendingDeletedTakeoffLayersByEstimate = new Map();
    let activeEstimateSwitchTimer = null;

    function loadedEditorEstimateKey() {
        const win = takeoffWindow();
        if (win?.__projectTakeoffEstimateKey) return String(win.__projectTakeoffEstimateKey);
        const frame = $('takeoffFrame');
        if (!frame) return '';
        try {
            return String(new URL(frame.getAttribute('src') || '', window.location.href).searchParams.get('estimate_key') || '');
        } catch (_) {
            return '';
        }
    }

    function collectLayerTrackingKeys(layer) {
        if (!layer || typeof layer !== 'object') return [];
        const meta = layer.metadata_json && typeof layer.metadata_json === 'object' ? layer.metadata_json : {};
        return [...new Set([
            layer.id,
            layer.integration_key,
            layer.client_uid,
            meta.project_layer_id,
            layer.metadata?.project_layer_id
        ].map(v => String(v || '').trim()).filter(Boolean))];
    }

    function purgeableLayerTrackingKeys(layer, protectedKeys = new Set()) {
        return collectLayerTrackingKeys(layer).filter(key => !protectedKeys.has(key));
    }

    function queueDeletedLayersForEstimate(estimateId, keys) {
        const estKey = String(estimateId || '').trim();
        if (!estKey || !Array.isArray(keys) || !keys.length) return;
        const set = pendingDeletedTakeoffLayersByEstimate.get(estKey) || new Set();
        keys.forEach(k => {
            const val = String(k || '').trim();
            if (val) set.add(val);
        });
        if (set.size) pendingDeletedTakeoffLayersByEstimate.set(estKey, set);
    }

    function unqueueDeletedLayerKeys(estimateId, layer) {
        const set = pendingDeletedTakeoffLayersByEstimate.get(String(estimateId || '').trim());
        if (!set || !set.size) return;
        collectLayerTrackingKeys(layer).forEach(k => set.delete(k));
        if (!set.size) pendingDeletedTakeoffLayersByEstimate.delete(String(estimateId || '').trim());
    }

    async function purgeDeletedLayersOnServer(estKey, keySet) {
        const pid = Number(window.ProjectState?.projectId || 0);
        const targetEst = String(estKey || '').trim();
        if (pid <= 0 || !targetEst || !keySet || !keySet.size) return;
        const layerIds = [...keySet];
        try {
            const res = await fetch('../api/takeoff.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'purge_deleted_layers',
                    project_id: pid,
                    estimate_key: targetEst,
                    layer_ids: layerIds
                })
            });
            if (res.ok) {
                const currentSet = pendingDeletedTakeoffLayersByEstimate.get(targetEst);
                if (currentSet) {
                    layerIds.forEach(id => currentSet.delete(id));
                    if (!currentSet.size) pendingDeletedTakeoffLayersByEstimate.delete(targetEst);
                }
            }
        } catch (err) {
            console.warn('Could not purge deleted layers for estimate', targetEst, err);
            throw new Error('Takeoff layer deletion could not be confirmed by the database.');
        }
    }

    async function flushPendingDeletedEstimateLayers() {
        if (!pendingDeletedTakeoffLayersByEstimate.size) return;
        const entries = [...pendingDeletedTakeoffLayersByEstimate.entries()].filter(([, set]) => set && set.size > 0);
        for (const [estKey, keySet] of entries) {
            await purgeDeletedLayersOnServer(estKey, keySet);
        }
    }

    window.flushTakeoffDeletedLayersForEstimate = (estimateId = null) => {
        if (!estimateId) return flushPendingDeletedEstimateLayers();
        const estKey = String(estimateId || '').trim();
        return purgeDeletedLayersOnServer(estKey, pendingDeletedTakeoffLayersByEstimate.get(estKey));
    };

    function removeLayersFromEditorAndQueue(estimateId, layersOrKeys, options = {}) {
        const estId = String(estimateId || activeEstimateId() || '').trim();
        const keys = [...new Set((Array.isArray(layersOrKeys) ? layersOrKeys : []).flatMap(entry =>
            typeof entry === 'object' && entry !== null ? collectLayerTrackingKeys(entry) : [String(entry || '').trim()]
        ).filter(Boolean))];
        if (!keys.length) return { keys: [], deleted: null };
        let deleted = null;
        if (estId && estId === loadedEditorEstimateKey()) {
            deleted = callEditor('projectTakeoffDeleteLayers', keys, { force: Boolean(options?.force) });
            if (deleted === false && !options?.force) {
                return { keys, deleted: false };
            }
        }
        queueDeletedLayersForEstimate(estId, keys);
        return { keys, deleted };
    }

    function ensureEditorEstimate(estimateId = activeEstimateId(), forceReload = false) {
        const frame = $('takeoffFrame');
        const documentId = activeDrawingDoc()?.id || window.ProjectState?.selectedDocumentId;
        if (!frame || !documentId) return false;
        let loadedEstimate = '';
        try { loadedEstimate = new URL(frame.getAttribute('src') || '', window.location.href).searchParams.get('estimate_key') || ''; } catch (_) { }
        if (!forceReload && loadedEstimate === String(estimateId)) return false;
        const requestedEstimateId = String(estimateId);
        const preservedPage = Math.max(1, Number(drawingState?.selectedPage || 1));
        if (preservedPage > 1) drawingState.pendingPageJump = preservedPage;
        const generation = ++editorEstimateGeneration;
        frame.addEventListener('load', () => {
            if (generation !== editorEstimateGeneration || requestedEstimateId !== activeEstimateId()) return;
            const pendingDel = pendingDeletedTakeoffLayersByEstimate.get(requestedEstimateId);
            if (pendingDel && pendingDel.size > 0) {
                callEditor('projectTakeoffDeleteLayers', [...pendingDel]);
            }
            syncAllLayersToCanvas({ suppressEstimatingSync: true });
            renderTakeoffPanel();
            notifyEditorVisible();
        }, { once: true });
        frame.src = takeoffEditorUrl(documentId, estimateId, preservedPage);
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
    function getTakeoffEditorFrame() {
        return $('takeoffFrame');
    }
    window.isTakeoffDirty = () => {
        if (takeoffIsDirty) return true;
        try {
            if (getTakeoffEditorFrame()?.contentWindow?.isEditorTakeoffDirty?.()) return true;
        } catch (_) { }
        return false;
    };
    window.projectTakeoffFitToScreen = fitTakeoffToScreen;
    window.projectTakeoffSaveState = async function () {
        const requiresPersistence = window.isTakeoffDirty()
            || pendingDeletedTakeoffLayersByEstimate.size > 0;
        if (!requiresPersistence) return { persisted: false, skipped: true };
        const pId = String(window.ProjectState?.projectId || 0);
        safeSetTakeoffLocalStorage('takeoff_project_groups_' + pId, JSON.stringify(takeoffState.groups));
        syncTakeoffToEstimating();
        const win = takeoffWindow();
        const loadedEst = win?.__projectTakeoffEstimateKey ? String(win.__projectTakeoffEstimateKey) : '';
        if (loadedEst && pendingDeletedTakeoffLayersByEstimate.get(loadedEst)?.size) {
            callEditor('projectTakeoffDeleteLayers', [...pendingDeletedTakeoffLayersByEstimate.get(loadedEst)], { force: true });
        }
        const saveResult = await takeoffSaveCoordinator.saveWithService();
        if (saveResult?.persisted !== true || !Number.isInteger(Number(saveResult.revision))) {
            throw new Error('Takeoff canvas persistence was not acknowledged by the server.');
        }
        if (saveResult.dirtyRemaining === true) {
            throw new Error('Takeoff changed while it was being saved. Please save again before reloading.');
        }
        await flushPendingDeletedEstimateLayers();
        takeoffIsDirty = false;
        return { ...saveResult, projectId: Number(pId) || 0 };
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
        previewAttachmentDocId: null,
        query: '',
        filterMode: 'all',
        previewPage: 1,
        pdfReady: null,
        pdfLoading: null,
        pdfDocs: new Map(),
        thumbnailCache: new Map(),
        thumbnailCacheLimit: 40,
        ownedPreviewObjectUrls: new Set(),
        thumbnailRequest: 0,
        previewDebounceTimer: null,
        previewDebounceResolve: null,
        previewObserver: null,
        previewObserverResolve: null,
        previewPendingKey: null,
        previewRenderedKey: null,
        previewDetailsSummary: null,
        previewDetailsActiveId: null,
        pendingCanvasPage: null,
        canvasSwitchFallbackTimer: null
    };

    function drawingExtensions() {
        return ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg', 'heic'];
    }

    function isImageDrawingDoc(doc) {
        return Boolean(doc && String(doc.extension || '').toLowerCase() !== 'pdf');
    }

    function pdfDrawingDocs() {
        return drawingState.documents.filter(doc => !isImageDrawingDoc(doc));
    }

    function attachmentImageDocs() {
        return drawingState.documents.filter(doc => isImageDrawingDoc(doc));
    }

    function isBrowsingAttachmentFolder() {
        if (drawingState.browseDocumentId === 'attachment') return true;
        const browsed = drawingState.documents.find(doc => Number(doc.id) === Number(drawingState.browseDocumentId));
        if (browsed && isImageDrawingDoc(browsed)) return true;
        if (!browsed && pdfDrawingDocs().length === 0 && attachmentImageDocs().length > 0) return true;
        return false;
    }

    function esc(text) {
        return String(text ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[ch]));
    }

    function drawingDocs() {
        return (window.ProjectState?.documents || [])
            .filter(doc => doc?.path && drawingExtensions().includes(String(doc.extension || '').toLowerCase()))
            .map(doc => ({
                id: Number(doc.id),
                name: doc.filename || doc.title || 'Untitled drawing',
                source: doc.source,
                folder: doc.folder_name || 'Documents',
                pageCount: Number(doc.pageCount || doc.page_count || 0) || null,
                fileUrl: doc.path,
                version: String(doc.version || doc.updated_at || doc.uploaded_at || doc.path || ''),
                extension: String(doc.extension || '').toLowerCase(),
                sheets: []
            }));
    }

    function activeDrawingDoc() {
        return drawingState.documents.find(doc => Number(doc.id) === Number(drawingState.selectedDocumentId)) || drawingState.documents[0] || null;
    }

    function browsingDrawingDoc() {
        if (isBrowsingAttachmentFolder()) {
            const imgs = attachmentImageDocs();
            return imgs.find(doc => Number(doc.id) === Number(drawingState.previewAttachmentDocId)) ||
                imgs.find(doc => Number(doc.id) === Number(drawingState.selectedDocumentId)) ||
                imgs[0] ||
                null;
        }
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

    window.__SharedPdfDocCache = window.__SharedPdfDocCache || new Map();
    window.__SharedPdfThumbCache = window.__SharedPdfThumbCache || new Map();
    const sharedPdfDocCache = window.__SharedPdfDocCache;
    const pdfLoadingInFlight = new Map();

    async function getPdfDocument(doc) {
        if (!doc || doc.extension !== 'pdf') return null;
        const docKey = String(doc.id);
        if (drawingState.pdfDocs.has(doc.id)) return drawingState.pdfDocs.get(doc.id);
        if (sharedPdfDocCache.has(docKey)) {
            const cached = sharedPdfDocCache.get(docKey);
            drawingState.pdfDocs.set(doc.id, cached);
            return cached;
        }
        if (doc.fileUrl && sharedPdfDocCache.has(String(doc.fileUrl))) {
            const cached = sharedPdfDocCache.get(String(doc.fileUrl));
            drawingState.pdfDocs.set(doc.id, cached);
            sharedPdfDocCache.set(docKey, cached);
            return cached;
        }
        if (pdfLoadingInFlight.has(docKey)) return pdfLoadingInFlight.get(docKey);

        const promise = (async () => {
            try {
                const pdfjs = await loadPdfJs();
                const task = pdfjs.getDocument({
                    url: doc.fileUrl,
                    rangeChunkSize: 262144,
                    disableStream: false,
                    disableAutoFetch: true
                });
                const pdf = await task.promise;
                drawingState.pdfDocs.set(doc.id, pdf);
                sharedPdfDocCache.set(docKey, pdf);
                if (doc.fileUrl) sharedPdfDocCache.set(String(doc.fileUrl), pdf);
                return pdf;
            } finally {
                pdfLoadingInFlight.delete(docKey);
            }
        })();

        pdfLoadingInFlight.set(docKey, promise);
        return promise;
    }

    function sheetName(doc, pageNumber) {
        return `${doc.name} - Page ${pageNumber}`;
    }

    const EMPTY_SHEET_SUMMARY = Object.freeze({
        totalMarks: 0,
        layers: [],
        activeItemMarks: 0,
        hasActiveItem: false,
        hasAnyTakeoff: false
    });
    const docSummaryMemo = new Map();

    function invalidateTakeoffSheetSummary(docId = null) {
        if (docId === null) {
            docSummaryMemo.clear();
            return;
        }
        const resolvedDocId = Number(docId || 0);
        if (resolvedDocId > 0) docSummaryMemo.delete(resolvedDocId);
    }

    function getDocTakeoffPageMap(docId) {
        const numDocId = Number(docId);
        const activeId = String(takeoffState.activeLayerId || selectionState.activeLayerId || '');
        const activeEst = typeof activeEstimateId === 'function' ? activeEstimateId() : '';
        const snapshotKey = `${activeEst}:${numDocId}`;
        const liveSnapshot = (takeoffState.canvasSnapshots && takeoffState.canvasSnapshots[snapshotKey])
            || Object.values(takeoffState.canvasSnapshots || {}).find(s => Number(s.drawingId || s.drawing_id) === numDocId);
        const locationsRef = window.ProjectState?.takeoffLocations || null;
        const sourceRef = liveSnapshot || locationsRef;
        const sourceVersion = Number(liveSnapshot?.updatedAt || 0);
        const cached = docSummaryMemo.get(numDocId);
        if (cached && cached.activeId === activeId && cached.activeEst === activeEst
            && cached.sourceRef === sourceRef && cached.sourceVersion === sourceVersion) {
            return cached;
        }

        const pageLayerMaps = new Map();
        const ensurePageMap = (p) => {
            if (!pageLayerMaps.has(p)) pageLayerMaps.set(p, new Map());
            return pageLayerMaps.get(p);
        };

        if (liveSnapshot && Array.isArray(liveSnapshot.layers) && liveSnapshot.layers.length > 0) {
            liveSnapshot.layers.forEach(remote => {
                const lid = String(remote.id || remote.layerId || '');
                const layer = typeof findLayer === 'function' ? findLayer(lid) : null;
                const allShapes = remote.shapes || remote.takeoffObjects || [];
                if (!allShapes.length) return;
                const byPage = new Map();
                for (let i = 0; i < allShapes.length; i++) {
                    const s = allShapes[i];
                    const pg = Number(s.pageNumber) || 1;
                    const prev = byPage.get(pg);
                    const q = Number(s.quantityValue || s.quantity || 1);
                    if (prev) {
                        prev.count++;
                        prev.qty += q;
                    } else {
                        byPage.set(pg, { count: 1, qty: q });
                    }
                }
                byPage.forEach((agg, pg) => {
                    ensurePageMap(pg).set(lid, {
                        layerId: lid,
                        name: layer?.name || remote.name || 'Item de Takeoff',
                        color: layer?.color || remote.color || '#2563eb',
                        symbol: layer?.symbol || remote.symbol || 'Solid Circle',
                        type: layer?.type || remote.type || 'Count',
                        uom: layer?.uom || remote.unit_of_measure || remote.uom || 'ea',
                        markCount: agg.count,
                        quantity: agg.qty,
                        isActive: Boolean(activeId && lid === activeId)
                    });
                });
            });
        } else {
            const locations = window.ProjectState?.takeoffLocations || {};
            Object.entries(locations).forEach(([lid, loc]) => {
                const layer = typeof findLayer === 'function' ? findLayer(lid) : null;
                const layerDocId = Number(loc.drawingId || loc.drawing_id || layer?.drawing_id || 0);
                if (layerDocId !== 0 && layerDocId !== numDocId) return;
                const pagesObj = loc.pages || {};
                Object.entries(pagesObj).forEach(([pgKey, pageData]) => {
                    const numPage = Number(pgKey);
                    if (!numPage || !pageData) return;
                    const cnt = Number(pageData.count || 0);
                    const qty = Number(pageData.quantity || 0);
                    if (cnt > 0 || qty > 0) {
                        ensurePageMap(numPage).set(String(lid), {
                            layerId: String(lid),
                            name: layer?.name || loc.name || 'Item de Takeoff',
                            color: layer?.color || loc.color || '#2563eb',
                            symbol: layer?.symbol || loc.symbol || 'Solid Circle',
                            type: layer?.type || loc.type || 'Count',
                            uom: layer?.uom || loc.uom || loc.unit_of_measure || 'ea',
                            markCount: cnt,
                            quantity: qty,
                            isActive: Boolean(activeId && String(lid) === activeId)
                        });
                    }
                });
            });
        }

        const pages = new Map();
        let docHasActiveItem = false;
        let docHasAnyTakeoff = false;

        pageLayerMaps.forEach((layerMap, numPage) => {
            const layers = Array.from(layerMap.values());
            const totalMarks = layers.reduce((sum, l) => sum + l.markCount, 0);
            const activeLayerEntry = activeId ? layerMap.get(activeId) : null;
            const activeItemMarks = activeLayerEntry ? activeLayerEntry.markCount : 0;
            const hasActiveItem = activeItemMarks > 0;
            const hasAnyTakeoff = layers.length > 0 || totalMarks > 0;
            if (hasActiveItem) docHasActiveItem = true;
            if (hasAnyTakeoff) docHasAnyTakeoff = true;
            pages.set(numPage, {
                totalMarks,
                layers,
                activeItemMarks,
                hasActiveItem,
                hasAnyTakeoff
            });
        });

        const entry = {
            activeId,
            activeEst,
            sourceRef,
            sourceVersion,
            pages,
            docHasActiveItem,
            docHasAnyTakeoff
        };
        docSummaryMemo.set(numDocId, entry);
        return entry;
    }

    function getSheetTakeoffSummary(docId, pageNumber) {
        const numPage = Number(pageNumber) || 1;
        return getDocTakeoffPageMap(docId).pages.get(numPage) || EMPTY_SHEET_SUMMARY;
    }

    function buildSheets(doc) {
        if (!doc) return [];
        const count = doc.pageCount || (doc.extension === 'pdf' ? 0 : 1);
        if (!count) return [];
        const docMap = getDocTakeoffPageMap(doc.id);
        if (doc._cachedSheets && doc._cachedPageCount === count && doc._cachedSummaryRef === docMap) {
            return doc._cachedSheets;
        }
        const built = Array.from({ length: count }, (_, index) => {
            const pageNumber = index + 1;
            const saved = doc.sheets?.[index] || {};
            const summary = docMap.pages.get(pageNumber) || EMPTY_SHEET_SUMMARY;
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
        doc._cachedSheets = built;
        doc._cachedPageCount = count;
        doc._cachedSummaryRef = docMap;
        return built;
    }

    function syncResolvedPageCountToState(doc, count) {
        if (!doc || !count || count <= 0) return;
        doc.pageCount = Number(count);
        if (window.ProjectState?.documents) {
            const psDoc = window.ProjectState.documents.find(d => Number(d.id) === Number(doc.id));
            if (psDoc) {
                psDoc.pageCount = doc.pageCount;
                psDoc.page_count = doc.pageCount;
            }
        }
    }

    async function ensurePageCount(doc) {
        if (!doc) return 0;
        // The embedded editor owns the authoritative PDF page count. Reconcile it
        // even when an older database row still contains the provisional value 1.
        if (doc.id === drawingState.selectedDocumentId) {
            const info = callEditor('takeoffGetDocumentInfo');
            if (info?.pageCount) {
                syncResolvedPageCountToState(doc, Number(info.pageCount));
                doc.sheets = buildSheets(doc);
                return doc.pageCount;
            }
        }
        if (doc.pageCount) return doc.pageCount;
        if (window.ProjectState?.documents) {
            const psDoc = window.ProjectState.documents.find(d => Number(d.id) === Number(doc.id));
            const knownCount = Number(psDoc?.pageCount || psDoc?.page_count || 0);
            if (knownCount > 0) {
                doc.pageCount = knownCount;
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
            if (window.__TakeoffThumbService?.getPageCount) {
                const workerCount = await window.__TakeoffThumbService.getPageCount(doc);
                if (workerCount > 0) {
                    syncResolvedPageCountToState(doc, workerCount);
                    doc.sheets = buildSheets(doc);
                    return doc.pageCount;
                }
            }
            const pdf = await getPdfDocument(doc);
            syncResolvedPageCountToState(doc, pdf.numPages);
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
        'ea', 'pr', 'set', 'lot', 'box', 'roll',
        'lf', 'ft', 'in', 'yd', 'm', 'mm',
        'sq ft', 'sq yd', 'm2',
        'cu yd', 'ft3', 'm3'
    ];
    const TAKEOFF_SYMBOLS = ['Checkmark', 'Octagon', 'Solid Circle', 'Hollow Circle', 'Square', 'Triangle', 'Diamond', 'Cross', 'Pentagon', 'Target'];
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
        const isCount = rawType === 'Count' || (Boolean(layer?.symbol) && !rawType.startsWith('Linear') && !rawType.includes('Area') && !rawType.includes('Volume') && rawType !== 'Count by distance');

        if (!isCount) {
            if (rawType === 'Count by distance') {
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none">
                    <line x1="3" y1="12" x2="21" y2="12" stroke="${esc(color)}" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3"/>
                    <circle cx="5" cy="12" r="2.5" fill="${esc(color)}"/>
                    <circle cx="19" cy="12" r="2.5" fill="${esc(color)}"/>
                </svg>`;
            }
            if (rawType === 'Linear') {
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none">
                    <line x1="5" y1="12" x2="19" y2="12" stroke="${esc(color)}" stroke-width="3.2" stroke-linecap="round"/>
                    <rect x="2.5" y="9.5" width="5" height="5" fill="${esc(color)}"/>
                    <rect x="16.5" y="9.5" width="5" height="5" fill="${esc(color)}"/>
                </svg>`;
            }
            if (rawType === 'Linear with drop') {
                return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none">
                    <line x1="6" y1="12" x2="18" y2="12" stroke="${esc(color)}" stroke-width="3" stroke-linecap="round"/>
                    <path d="M2.5 9.5L7.5 14.5M7.5 9.5L2.5 14.5M16.5 9.5L21.5 14.5M21.5 9.5L16.5 14.5" stroke="${esc(color)}" stroke-width="2.1" stroke-linecap="round"/>
                </svg>`;
            }
            if (rawType === 'Linear avg. with drop' || rawType.startsWith('Linear')) {
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
        '#7c3aed', '#6366f1', '#3b5998', '#2563eb', '#0ea5e9', '#00d2ff',
        '#06b6d4', '#009688', '#10b981', '#16a34a', '#22c55e', '#84cc16',
        '#a3e635', '#eab308', '#fde047', '#f59e0b', '#f97316', '#fb5a3a',
        '#ef4444', '#dc2626', '#991b1b', '#ec4899', '#d946ef', '#a855f7',
        '#78350f', '#92400e', '#475569', '#000000'
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
        {
            id: 'Solid Circle',
            label: 'Solid Circle',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>`
        },
        {
            id: 'Hollow Circle',
            label: 'Hollow Circle',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="7.5"/></svg>`
        },
        {
            id: 'Square',
            label: 'Square',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="1.5"/></svg>`
        },
        {
            id: 'Triangle',
            label: 'Triangle',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><polygon points="12 3.5 21.5 20.5 2.5 20.5"/></svg>`
        },
        {
            id: 'Diamond',
            label: 'Diamond',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><polygon points="12 2.5 21.5 12 12 21.5 2.5 12"/></svg>`
        },
        {
            id: 'Cross',
            label: 'Cross / Plus',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M18.5 10.5h-5v-5a1.5 1.5 0 0 0-3 0v5h-5a1.5 1.5 0 0 0 0 3h5v5a1.5 1.5 0 0 0 3 0v-5h5a1.5 1.5 0 0 0 0-3z"/></svg>`
        },
        {
            id: 'Octagon',
            label: 'Octagon',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><polygon points="7.86 2.5 16.14 2.5 21.5 7.86 21.5 16.14 16.14 21.5 7.86 21.5 2.5 16.14 2.5 7.86"/></svg>`
        },
        {
            id: 'Pentagon',
            label: 'Pentagon',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><polygon points="12 2.5 21.5 9.5 17.8 21 6.2 21 2.5 9.5"/></svg>`
        },
        {
            id: 'Checkmark',
            label: 'Checkmark',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
        },
        {
            id: 'Target',
            label: 'Target',
            svg: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.8" fill="currentColor"/></svg>`
        }
    ];

    const TAKEOFF_SIZE_ITEMS = [
        {
            id: 'X-Small',
            label: 'X-Small',
            svg: `<svg viewBox="0 0 28 28" width="18" height="18" fill="none"><circle cx="14" cy="14" r="10.5" stroke="var(--pcd-ring, #cbd5e1)" stroke-width="1.2"/><circle cx="14" cy="14" r="3" fill="currentColor"/></svg>`
        },
        {
            id: 'Small',
            label: 'Small',
            svg: `<svg viewBox="0 0 28 28" width="18" height="18" fill="none"><circle cx="14" cy="14" r="9.5" stroke="var(--pcd-ring, #cbd5e1)" stroke-width="1.4"/><circle cx="14" cy="14" r="5" stroke="currentColor" stroke-width="2.2"/></svg>`
        },
        {
            id: 'Medium',
            label: 'Medium',
            svg: `<svg viewBox="0 0 28 28" width="18" height="18" fill="none"><circle cx="14" cy="14" r="7.5" stroke="currentColor" stroke-width="2.2"/></svg>`
        },
        {
            id: 'Large',
            label: 'Large',
            svg: `<svg viewBox="0 0 28 28" width="18" height="18" fill="none"><circle cx="14" cy="14" r="10.5" stroke="currentColor" stroke-width="2.3"/></svg>`
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
            dd.querySelector('.pro-custom-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
        });
    }

    function positionProDropdownMenu(dropdown, trigger, menu) {
        if (!dropdown || !trigger || !menu) return;
        requestAnimationFrame(() => {
            if (!dropdown.classList.contains('is-open')) return;
            const container = dropdown.closest('.pro-layer-modal, .pro-create-layer-modal, .pro-layer-drawer');
            const containerRect = container ? container.getBoundingClientRect() : null;
            const minLeft = containerRect ? containerRect.left + 8 : 8;
            const maxRight = Math.min(
                window.innerWidth - 8,
                containerRect ? containerRect.right - 8 : window.innerWidth - 8
            );
            const triggerRect = trigger.getBoundingClientRect();

            menu.style.left = '0px';
            menu.style.right = 'auto';
            menu.style.maxWidth = `${Math.max(64, Math.floor(maxRight - minLeft))}px`;
            const rect = menu.getBoundingClientRect();
            if (rect.right > maxRight) {
                menu.style.left = 'auto';
                menu.style.right = '0px';
                const flippedRect = menu.getBoundingClientRect();
                if (flippedRect.left < minLeft) {
                    menu.style.left = `${Math.round(minLeft - triggerRect.left)}px`;
                    menu.style.right = 'auto';
                }
            }
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
            if (!isOpen) {
                dropdown.classList.add('is-open');
                trigger.setAttribute('aria-expanded', 'true');
                positionProDropdownMenu(dropdown, trigger, menu);
            }
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
        { section: 'Count' },
        { id: 'ea', label: 'ea', desc: 'Each', hint: 'Fixtures, devices, boxes', category: 'Count' },
        { id: 'pr', label: 'pr', desc: 'Pair', hint: 'Matched pairs', category: 'Count' },
        { id: 'set', label: 'set', desc: 'Set', hint: 'Assemblies, sets', category: 'Count' },
        { id: 'lot', label: 'lot', desc: 'Lot', hint: 'Lump sum packages', category: 'Count' },
        { id: 'box', label: 'box', desc: 'Box', hint: 'Box quantities', category: 'Count' },
        { id: 'roll', label: 'roll', desc: 'Roll', hint: 'Wire spools, membrane', category: 'Count' },

        { section: 'Length' },
        { id: 'lf', label: 'lf', desc: 'Linear Ft', hint: 'Conduit, wire, piping', category: 'Length' },
        { id: 'ft', label: 'ft', desc: 'Feet', hint: 'Drop & run lengths', category: 'Length' },
        { id: 'in', label: 'in', desc: 'Inches', hint: 'Short measurements', category: 'Length' },
        { id: 'yd', label: 'yd', desc: 'Yards', hint: 'Trenching & site work', category: 'Length' },
        { id: 'm', label: 'm', desc: 'Meters', hint: 'Metric distance', category: 'Length' },
        { id: 'mm', label: 'mm', desc: 'Millimeters', hint: 'Precision metric', category: 'Length' },

        { section: 'Area' },
        { id: 'sq ft', label: 'sq ft', desc: 'Sq Feet', hint: 'Floor, wall, ceiling', category: 'Area' },
        { id: 'sq yd', label: 'sq yd', desc: 'Sq Yards', hint: 'Paving, turf, flooring', category: 'Area' },
        { id: 'm2', label: 'm²', desc: 'Sq Meters', hint: 'Metric floor/wall', category: 'Area' },

        { section: 'Volume' },
        { id: 'cu yd', label: 'cu yd', desc: 'Cu Yards', hint: 'Concrete, excavation', category: 'Volume' },
        { id: 'ft3', label: 'ft³', desc: 'Cu Feet', hint: 'Structural volume', category: 'Volume' },
        { id: 'm3', label: 'm³', desc: 'Cu Meters', hint: 'Metric volume', category: 'Volume' }
    ];

    function allowedUomCategoriesForType(type) {
        const raw = String(type || 'Count').trim();
        if (raw === 'Count' || raw === 'Count by distance') return ['Count'];
        if (raw === 'Linear' || raw.startsWith('Linear')) return ['Length'];
        if (raw === 'Vertical wall area') return ['Area'];
        if (raw === 'Area / Volume' || raw.includes('Area') || raw.includes('Volume')) return ['Area', 'Volume'];
        return ['Count'];
    }

    function defaultUomForType(type) {
        const raw = String(type || 'Count').trim();
        if (raw === 'Count' || raw === 'Count by distance') return 'ea';
        if (raw === 'Linear' || raw.startsWith('Linear')) return 'ft';
        if (raw === 'Area / Volume' || raw.includes('Area') || raw.includes('Volume')) return 'sq ft';
        return 'ea';
    }

    function isUomValidForType(uom, type) {
        const norm = String(uom || '').trim().toLowerCase();
        if (!norm) return false;
        const allowed = allowedUomCategoriesForType(type);
        const aliasMap = { 'm²': 'm2', 'ft³': 'ft3', 'm³': 'm3', 'sqft': 'sq ft', 'sf': 'sq ft', 'linear ft': 'lf', 'yd3': 'cu yd' };
        const canonical = aliasMap[norm] || norm;
        const matched = TAKEOFF_UOM_ITEMS.find(it => it.id && (it.id.toLowerCase() === canonical || String(it.label || '').toLowerCase() === norm));
        if (!matched) return true;
        return !matched.category || allowed.includes(matched.category);
    }

    function setupUomDropdown(prefix, selectEl) {
        const dropdown = $(`${prefix}UomDropdown`);
        const trigger = $(`${prefix}UomTrigger`);
        const menu = $(`${prefix}UomMenu`);
        if (!dropdown || !trigger || !menu) return;

        if (selectEl) {
            TAKEOFF_UOM_ITEMS.forEach(it => {
                if (!it.id) return;
                const exists = Array.from(selectEl.options).some(o => o.value.toLowerCase() === it.id.toLowerCase());
                if (!exists) {
                    const opt = document.createElement('option');
                    opt.value = it.id;
                    opt.textContent = it.label || it.id;
                    selectEl.appendChild(opt);
                }
            });
        }

        let listHtml = '';
        TAKEOFF_UOM_ITEMS.forEach(item => {
            if (item.section) {
                listHtml += `<div class="pcd-section-header" data-uom-section="${esc(item.section)}">${esc(item.section)}</div>`;
            } else {
                listHtml += `
                    <div class="pcd-uom-item" data-uom="${esc(item.id)}" data-category="${esc(item.category || '')}" data-search="${esc((item.label + ' ' + item.desc + ' ' + item.id + ' ' + (item.hint || '')).toLowerCase())}" title="${esc(item.desc)}${item.hint ? ' — ' + esc(item.hint) : ''}">
                        <div class="pcd-uom-left">
                            <span class="pcd-uom-badge">${esc(item.label)}</span>
                            <span class="pcd-uom-name">${esc(item.desc)}</span>
                        </div>
                        <i class="fas fa-check pcd-uom-check"></i>
                    </div>
                `;
            }
        });

        menu.innerHTML = `
            <div class="pcd-uom-list">
                ${listHtml}
            </div>
        `;

        function applyUomSelection(uom) {
            const clean = String(uom || 'ea').trim();
            if (selectEl) {
                setSelectValue(selectEl, clean);
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            updateUomDropdownTrigger(prefix, clean);
            closeAllProCustomDropdowns();
        }

        function filterItems() {
            const currentType = dropdown._takeoffType || 'Count';
            const allowed = allowedUomCategoriesForType(currentType);
            const items = menu.querySelectorAll('.pcd-uom-item');
            let firstVisible = null;

            items.forEach(el => {
                const cat = el.dataset.category || '';
                const isTypeAllowed = !cat || allowed.includes(cat);
                el.style.display = isTypeAllowed ? 'flex' : 'none';
                if (isTypeAllowed && !firstVisible) firstVisible = el;
            });

            menu.querySelectorAll('.pcd-section-header').forEach(header => {
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

            return { firstVisible };
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            closeAllProCustomDropdowns();
            if (!isOpen) {
                dropdown.classList.add('is-open');
                trigger.setAttribute('aria-expanded', 'true');
                filterItems();
                positionProDropdownMenu(dropdown, trigger, menu);
            } else {
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        menu.addEventListener('click', (e) => {
            e.stopPropagation();
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
            (norm.toLowerCase() === 'm³' && it.id === 'm3') ||
            (norm.toLowerCase() === 'cu yd' && it.id === 'cu yd') ||
            (norm.toLowerCase() === 'yd3' && it.id === 'cu yd') ||
            (norm.toLowerCase() === 'sqft' && it.id === 'sq ft') ||
            (norm.toLowerCase() === 'sf' && it.id === 'sq ft') ||
            (norm.toLowerCase() === 'linear ft' && it.id === 'lf')
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
                    (norm.toLowerCase() === 'm³' && uomId === 'm3') ||
                    (norm.toLowerCase() === 'cu yd' && uomId === 'cu yd') ||
                    (norm.toLowerCase() === 'yd3' && uomId === 'cu yd') ||
                    (norm.toLowerCase() === 'sqft' && uomId === 'sq ft') ||
                    (norm.toLowerCase() === 'sf' && uomId === 'sq ft') ||
                    (norm.toLowerCase() === 'linear ft' && uomId === 'lf');
                el.classList.toggle('is-selected', Boolean(isSelected));
            });
        }
    }

    function setupSymbolDropdown(prefix, selectEl) {
        const dropdown = $(`${prefix}SymbolDropdown`);
        const trigger = $(`${prefix}SymbolTrigger`);
        const menu = $(`${prefix}SymbolMenu`);
        if (!dropdown || !trigger || !menu) return;

        let html = '<div class="pcd-symbol-grid">';
        TAKEOFF_SYMBOL_ITEMS.forEach(item => {
            if (item.id) {
                html += `<div class="pcd-symbol-item" data-symbol="${esc(item.id)}" title="${esc(item.label)}">
                    <span>${item.svg}</span>
                </div>`;
            }
        });
        html += '</div>';
        menu.innerHTML = html;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            closeAllProCustomDropdowns();
            if (!isOpen) {
                dropdown.classList.add('is-open');
                trigger.setAttribute('aria-expanded', 'true');
                positionProDropdownMenu(dropdown, trigger, menu);
            }
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
            if (!isOpen) {
                dropdown.classList.add('is-open');
                trigger.setAttribute('aria-expanded', 'true');
                positionProDropdownMenu(dropdown, trigger, menu);
            }
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

        menu.innerHTML = `
            <div class="pcd-color-vertical-list">
                ${TAKEOFF_RICH_COLORS.map(color => `
                    <div class="pcd-color-item" data-color="${color}" title="${color}">
                        <span class="pcd-color-circle" style="background:${color};"></span>
                    </div>
                `).join('')}
            </div>
            <div class="pcd-color-custom-footer">
                <button type="button" class="pcd-add-custom-color-btn" data-color-custom-btn="${prefix}" title="Choose custom color">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
        `;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            closeAllProCustomDropdowns();
            if (!isOpen) {
                dropdown.classList.add('is-open');
                trigger.setAttribute('aria-expanded', 'true');
                positionProDropdownMenu(dropdown, trigger, menu);
            }
        });

        menu.querySelectorAll('.pcd-color-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const color = itemEl.dataset.color;
                if (prefix === 'createLayer') {
                    setCreateLayerColor(color);
                } else {
                    setLayerColor(color, { notify: true });
                }
                closeAllProCustomDropdowns();
            });
        });

        const customBtn = menu.querySelector(`[data-color-custom-btn="${prefix}"]`);
        if (customBtn && customPickerEl) {
            customBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAllProCustomDropdowns();
                customPickerEl.click();
            });
        }
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
        selectedLayerIds: [],
        selectedRuler: null,
        selectedNote: null,
        selectedCloud: null,
        selectedObjectType: null
    };
    const takeoffRulersState = {
        page: 1,
        isExpanded: true,
        items: []
    };
    let draggedTakeoffGroupId = null;
    let suppressNextGroupToggle = false;
    let draggedTakeoffLayerId = null;
    let isDraggingTakeoffLayer = false;
    let takeoffLayerDragSuppressedClickTime = 0;

    const historyState = [];
    const redoHistoryState = [];

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
        let meta = null;
        if (layer?.metadata_json && typeof layer.metadata_json === 'object') {
            meta = layer.metadata_json;
        } else {
            try { meta = JSON.parse(layer?.metadata_json || '{}') || {}; } catch (_) { meta = {}; }
        }
        if (meta && !meta.catalog_item && meta.catalog_item_ref) {
            const shared = window.ProjectState?.catalogItemMetaMap?.[meta.catalog_item_ref];
            if (shared && typeof shared === 'object') {
                meta = { ...meta, catalog_item: window.CatalogMetadata.clone(shared) };
                delete meta.catalog_item_ref;
            }
        }
        return meta || {};
    }

    function layerCatalogMetadata(layer) {
        return window.CatalogMetadata.fromLayer(layer);
    }

    function seedGroupsFromProjectLayers() {
        const groups = [];
        const byName = new Map();
        const seenLayers = new Map();
        (window.ProjectState?.takeoffLayers || []).forEach((layer, index) => {
            const metadata = takeoffLayerMetadata(layer);
            const groupName = layer.group_name || 'Default Group';
            const estimateId = metadata.estimate_id || layer.estimate_key || null;
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
            const layerId = String(layer.integration_key || metadata.project_layer_id || layer.id || makeId('layer'));
            const dedupeKey = `${estimateId || 'legacy'}:${layerId}`;
            const qtyVal = Number(layer.quantity || layer.count || layer.measurement_count || 0);
            const baseVal = Number(layer.baseQuantity ?? layer.seedQuantity ?? layer.seed_quantity ?? metadata.base_quantity ?? 0);
            const existingLayer = seenLayers.get(dedupeKey);
            if (existingLayer) {
                if (baseVal > 0 && !(existingLayer.baseQuantity > 0)) existingLayer.baseQuantity = baseVal;
                if (qtyVal > Number(existingLayer.quantity || 0)) existingLayer.quantity = qtyVal;
                return;
            }
            const type = normalizeTakeoffType(layer.takeoff_type || layer.type);
            const layerTag = metadata.tag || layer.tag || '';
            const layerCostCode = layer.cost_code || layer.costCode || '';
            const seededLayer = {
                id: layerId,
                groupId: group.id,
                estimateId,
                estimatingItemId: metadata.estimating_item_id || null,
                estimatingGroupId: metadata.estimating_group_id || null,
                name: layer.name || layer.title || `Takeoff Item ${index + 1}`,
                tag: layerTag,
                costCode: layerCostCode,
                type,
                uom: layer.unit_of_measure || typeToUom(type),
                symbol: layer.symbol || 'Solid Circle',
                size: layer.symbol_size || 'Medium',
                color: layer.color || '#111827',
                visible: layer.visible !== false,
                locked: Number(layer.locked || 0) === 1,
                quantity: qtyVal,
                // `quantity`, `count`, and `measurement_count` are calculated
                // takeoff totals returned by the API. Treating one of them as
                // a seed makes every saved shape count twice after reload and
                // causes the next canvas event to jump the displayed total.
                baseQuantity: baseVal,
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
                difficulty: Number(layer.difficulty ?? metadata.difficulty ?? 1),
                multiplier: Number(layer.multiplier ?? metadata.multiplier ?? 1),
                dropLength: Number(layer.dropLength || layer.drop_length || 0),
                spacing: Number(layer.spacing || 0),
                height: Number(layer.height || 0),
                depth: Number(layer.depth || 0)
            };
            seenLayers.set(dedupeKey, seededLayer);
            group.layers.push(seededLayer);
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
                tag: layer.tag || '',
                costCode: layer.costCode || layer.cost_code || '',
                type: normalizeTakeoffType(layer.type),
                uom: layer.uom || typeToUom(normalizeTakeoffType(layer.type)),
                symbol: layer.symbol || 'Solid Circle',
                size: layer.size || 'Medium',
                color: layer.color || '#111827',
                visible: layer.visible !== false,
                locked: Number(layer.locked || 0) === 1,
                quantity: Number(layer.quantity || 0),
                baseQuantity: Number(layer.baseQuantity ?? layer.seedQuantity ?? 0),
                quantityOverride: Boolean(layer.quantityOverride),
                estimatingQuantity: layer.estimatingQuantity !== undefined ? Number(layer.estimatingQuantity) : undefined,
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
                difficulty: Number(layer.difficulty ?? layer.metadata_json?.difficulty ?? 1),
                multiplier: Number(layer.multiplier ?? layer.metadata_json?.multiplier ?? 1),
                metadata_json: layer.metadata_json ? (typeof layer.metadata_json === 'object' ? { ...layer.metadata_json } : {}) : {},
                dropLength: Number(layer.dropLength || layer.drop_length || 0),
                spacing: Number(layer.spacing || 0),
                height: Number(layer.height || 0),
                depth: Number(layer.depth || 0)
            }))
        }));
    }

    let estimatingSyncTimer = null;
    let saveTakeoffLocalTimer = null;
    let pendingLocalSaveEstimateGroups = false;

    function flushTakeoffLocalSave() {
        if (saveTakeoffLocalTimer) {
            clearTimeout(saveTakeoffLocalTimer);
            saveTakeoffLocalTimer = null;
        }
        if (!pendingLocalSaveEstimateGroups) return false;
        pendingLocalSaveEstimateGroups = false;
        const pId = String(window.ProjectState?.projectId || 0);
        safeSetTakeoffLocalStorage('takeoff_project_groups_' + pId, JSON.stringify(takeoffState.groups));
        return true;
    }

    function scheduleTakeoffLocalSave(delayMs = 350) {
        pendingLocalSaveEstimateGroups = true;
        clearTimeout(saveTakeoffLocalTimer);
        saveTakeoffLocalTimer = setTimeout(() => {
            saveTakeoffLocalTimer = null;
            flushTakeoffLocalSave();
        }, Math.max(80, Number(delayMs) || 350));
    }

    function flushEstimatingSyncFromCanvas() {
        flushTakeoffLocalSave();
        if (estimatingSyncTimer) {
            clearTimeout(estimatingSyncTimer);
            estimatingSyncTimer = null;
        }
        syncTakeoffToEstimating();
    }

    function scheduleEstimatingSyncFromCanvas(delayMs = 1000) {
        clearTimeout(estimatingSyncTimer);
        estimatingSyncTimer = setTimeout(() => {
            estimatingSyncTimer = null;
            flushTakeoffLocalSave();
            syncTakeoffToEstimating();
        }, Math.max(200, Number(delayMs) || 1000));
    }

    window.flushTakeoffEstimatingSync = flushEstimatingSyncFromCanvas;
    window.hasPendingTakeoffEstimatingSync = () => Boolean(estimatingSyncTimer);

    function saveTakeoffState() {
        if (!canWrite()) return false;
        const options = arguments[0] || {};
        // iframe/API owns persistent Takeoff state
        if (!options.suppressDirty) {
            takeoffIsDirty = true;
        }
        if (options && options.debounceLocalSave) {
            scheduleTakeoffLocalSave();
        } else {
            pendingLocalSaveEstimateGroups = true;
            flushTakeoffLocalSave();
        }
        if (options && options.skipEstimatingSync) {
            return true;
        }
        if (options && options.debounceEstimatingSync) {
            scheduleEstimatingSyncFromCanvas(1000);
        } else {
            flushEstimatingSyncFromCanvas();
        }
    }

    function pushTakeoffHistory(reason = 'change') {
        if (!canWrite()) return false;
        takeoffIsDirty = true;
        try {
            redoHistoryState.length = 0;
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
            if (historyState.length > 10) historyState.shift();
        } catch (e) {
            console.warn('Takeoff history could not be saved', e);
        }
    }

    function undoTakeoff() {
        const editorUndone = callEditor('projectTakeoffUndo') || callEditor('undo');
        const previous = historyState.pop();
        if (!previous) {
            if (!editorUndone) showPrepared('Nothing to undo.');
            return;
        }
        try {
            redoHistoryState.push({
                groups: JSON.parse(JSON.stringify(takeoffState.groups)),
                activeGroupId: takeoffState.activeGroupId,
                activeLayerId: takeoffState.activeLayerId,
                canvasSnapshots: JSON.parse(JSON.stringify(takeoffState.canvasSnapshots || {})),
                annotations: JSON.parse(JSON.stringify(takeoffState.annotations || [])),
                pins: JSON.parse(JSON.stringify(takeoffState.pins || [])),
                globalVisible: takeoffState.globalVisible
            });
            if (redoHistoryState.length > 10) redoHistoryState.shift();
        } catch (_) { }
        takeoffState.groups = previous.groups;
        takeoffState.activeGroupId = previous.activeGroupId;
        takeoffState.activeLayerId = previous.activeLayerId;
        takeoffState.canvasSnapshots = previous.canvasSnapshots || {};
        takeoffState.annotations = previous.annotations || [];
        takeoffState.pins = previous.pins || [];
        takeoffState.globalVisible = previous.globalVisible !== false;
        saveTakeoffState();
        if (!editorUndone) syncAllLayersToCanvas();
        syncTakeoffToEstimating();
        renderTakeoffPanel();
        renderActiveLayerToolbar();
    }

    function redoTakeoff() {
        const editorRedone = callEditor('projectTakeoffRedo') || callEditor('redo');
        const next = redoHistoryState.pop();
        if (!next) {
            if (!editorRedone) showPrepared('Nothing to redo.');
            return;
        }
        try {
            historyState.push({
                reason: 'redo',
                groups: JSON.parse(JSON.stringify(takeoffState.groups)),
                activeGroupId: takeoffState.activeGroupId,
                activeLayerId: takeoffState.activeLayerId,
                canvasSnapshots: JSON.parse(JSON.stringify(takeoffState.canvasSnapshots || {})),
                annotations: JSON.parse(JSON.stringify(takeoffState.annotations || [])),
                pins: JSON.parse(JSON.stringify(takeoffState.pins || [])),
                globalVisible: takeoffState.globalVisible
            });
            if (historyState.length > 10) historyState.shift();
        } catch (_) { }
        takeoffState.groups = next.groups;
        takeoffState.activeGroupId = next.activeGroupId;
        takeoffState.activeLayerId = next.activeLayerId;
        takeoffState.canvasSnapshots = next.canvasSnapshots || {};
        takeoffState.annotations = next.annotations || [];
        takeoffState.pins = next.pins || [];
        takeoffState.globalVisible = next.globalVisible !== false;
        saveTakeoffState();
        if (!editorRedone) syncAllLayersToCanvas();
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

    let latestEstimatingState = null;
    let takeoffDomInitialized = false;
    let pendingInitialEstimatingItemsDetail = null;

    function adoptAuthoritativeEstimateFromEstimating(detail = {}) {
        const incomingEstId = String(detail.activeEstimateId || '');
        if (!incomingEstId || incomingEstId === 'est_primary') return false;
        const estimatesList = Array.isArray(detail.estimates) ? detail.estimates : (latestEstimatingState?.estimates || []);
        const estListIds = new Set(estimatesList.map(row => String(row?.id || '')));
        const prevEstId = String(takeoffState.activeEstimateId || '');
        const currentLayersCount = takeoffState.groups
            .filter(g => groupBelongsToEstimate(g, prevEstId))
            .reduce((sum, g) => sum + ((g.items || g.layers || []).length), 0);
        if (!prevEstId || prevEstId === 'est_primary' || (estListIds.size && !estListIds.has(prevEstId))
            || (prevEstId !== incomingEstId && currentLayersCount === 0 && !takeoffIsDirty)) {
            takeoffState.activeEstimateId = incomingEstId;
            if (takeoffDomInitialized && typeof ensureEstimateTakeoffWorkspace === 'function') {
                ensureEstimateTakeoffWorkspace(incomingEstId, false);
            }
            return prevEstId !== incomingEstId;
        }
        return false;
    }

    window.addEventListener('takeoff:estimating-state-updated', event => {
        const detail = event.detail || {};
        updateLatestEstimatingState(detail, false);
        if (!takeoffDomInitialized) return;
        const switchedEstimate = adoptAuthoritativeEstimateFromEstimating(detail);
        if (typeof renderTakeoffEstimateFooter === 'function') renderTakeoffEstimateFooter();
        if (switchedEstimate && detail.syncSource !== 'takeoff-sync' && typeof renderTakeoffPanel === 'function') renderTakeoffPanel();
    });

    function removeLayersDeletedFromEstimating(detail = {}) {
        const estId = String(detail.estimateId || detail.activeEstimateId || '').trim();
        if (!estId) return;
        const itemIdSet = new Set((Array.isArray(detail.itemIds) ? detail.itemIds : []).map(String).filter(Boolean));
        const keySet = new Set((Array.isArray(detail.layerKeys) ? detail.layerKeys : []).map(String).filter(Boolean));
        const removedKeys = new Set(keySet);
        const removedLayerIds = new Set();

        takeoffState.groups.forEach(group => {
            if (!groupBelongsToEstimate(group, estId)) return;
            group.layers = (group.layers || []).filter(layer => {
                const layerItemId = String(layer.estimatingItemId || layer.metadata_json?.estimating_item_id || layer.estimate_item_id || '').trim();
                const layerKeys = collectLayerTrackingKeys(layer);
                const matchesItem = layerItemId && itemIdSet.has(layerItemId);
                const matchesKey = layerKeys.some(k => keySet.has(k));
                if (!matchesItem && !matchesKey) return true;
                if (layer?.id) removedLayerIds.add(String(layer.id));
                layerKeys.forEach(k => removedKeys.add(k));
                return false;
            });
        });

        const keysList = [...removedKeys];
        if (!keysList.length && !removedLayerIds.size) return;
        removeLayersFromEditorAndQueue(estId, keysList, { force: true });
        if (estId === activeEstimateId()) {
            const activeKey = String(takeoffState.activeLayerId || '');
            if (activeKey && (removedLayerIds.has(activeKey) || removedKeys.has(activeKey))) {
                takeoffState.activeLayerId = null;
                callEditor('projectTakeoffClearActiveLayer');
                setActiveTool('smart');
            }
            selectionState.selectedLayerIds = (selectionState.selectedLayerIds || []).filter(id => !removedLayerIds.has(String(id)) && !removedKeys.has(String(id)));
            if (selectionState.activeLayerId && (removedLayerIds.has(String(selectionState.activeLayerId)) || removedKeys.has(String(selectionState.activeLayerId)))) {
                selectionState.activeLayerId = null;
            }
        }
        if (canWrite()) {
            takeoffIsDirty = true;
            try {
                const pId = String(window.ProjectState?.projectId || 0);
                safeSetTakeoffLocalStorage('takeoff_project_groups_' + pId, JSON.stringify(takeoffState.groups));
            } catch (_) { }
        }
        if (takeoffDomInitialized) {
            renderTakeoffPanel();
            updateSubheadSelectedItem();
        }
    }

    window.addEventListener('takeoff:estimating-items-deleted', event => {
        const detail = event.detail || {};
        if (detail.projectId && window.ProjectState?.projectId && String(detail.projectId) !== String(window.ProjectState.projectId)) return;
        if (!takeoffDomInitialized) {
            const estId = String(detail.estimateId || '').trim();
            queueDeletedLayersForEstimate(estId, detail.layerKeys || []);
        }
        removeLayersDeletedFromEstimating(detail);
    });

    window.addEventListener('takeoff:estimating-items-updated', event => {
        const detail = event.detail || {};
        updateLatestEstimatingState(detail, true);
        if (!takeoffDomInitialized) {
            pendingInitialEstimatingItemsDetail = detail;
            return;
        }
        const isEcho = detail.syncSource === 'takeoff-sync';
        adoptAuthoritativeEstimateFromEstimating(detail);
        const changedStructure = syncEstimatingItemsToTakeoff({ ...detail, skipCanvasResync: isEcho });
        if (!isEcho || changedStructure) {
            if (typeof renderTakeoffPanel === 'function') renderTakeoffPanel();
        } else {
            patchAllTakeoffLayerQuantityDom();
        }
        if (typeof renderTakeoffEstimateFooter === 'function') renderTakeoffEstimateFooter();
    });

    function safeSetTakeoffLocalStorage(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (_) {
            try {
                const pidStr = String(window.ProjectState?.projectId || 'draft');
                const evictable = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (!k || k === key) continue;
                    if ((k.startsWith('takeoff.estimating.module.') && k !== `takeoff.estimating.module.${pidStr}`)
                        || (k.startsWith('takeoff_project_groups_') && k !== `takeoff_project_groups_${pidStr}`)) {
                        evictable.push(k);
                    }
                }
                evictable.forEach(k => { try { localStorage.removeItem(k); } catch (_) { } });
                localStorage.setItem(key, value);
                return true;
            } catch (_) {
                return false;
            }
        }
    }

    function updateLatestEstimatingState(detail = {}, isItemsEvent = false) {
        if (!detail || typeof detail !== 'object') return;
        if (!isItemsEvent && Array.isArray(detail.estimates)) {
            latestEstimatingState = {
                ...(latestEstimatingState || {}),
                activeEstimateId: String(detail.activeEstimateId || latestEstimatingState?.activeEstimateId || detail.estimates[0]?.id || 'est_primary'),
                estimates: detail.estimates,
                summary: detail.summary || latestEstimatingState?.summary || null
            };
            return;
        }
        const detailActiveId = String(detail.activeEstimateId || '');
        if (!detailActiveId || !Array.isArray(detail.groups)) return;
        const base = latestEstimatingState && Array.isArray(latestEstimatingState.estimates)
            ? latestEstimatingState
            : loadEstimatingStateForSync();
        const estimates = Array.isArray(base?.estimates) ? base.estimates.map(est => {
            if (String(est?.id) === detailActiveId) {
                return { ...est, groups: detail.groups };
            }
            return est;
        }) : [];
        if (!estimates.some(est => String(est?.id) === detailActiveId)) {
            estimates.push({
                id: detailActiveId,
                name: 'Estimate',
                groups: detail.groups,
                isPrimary: estimates.length === 0,
                is_primary: estimates.length === 0
            });
        }
        latestEstimatingState = {
            ...(base || {}),
            activeEstimateId: detailActiveId,
            estimates
        };
    }

    function loadEstimatingStateForSync() {
        let parsed = null;
        try {
            const candidate = JSON.parse(localStorage.getItem(estimatingStoreKey()) || 'null');
            if (candidate && (Array.isArray(candidate.groups) || Array.isArray(candidate.estimates))) {
                parsed = candidate;
            }
        } catch (e) { }
        if (latestEstimatingState && Array.isArray(latestEstimatingState.estimates) && latestEstimatingState.estimates.length) {
            return {
                ...(parsed || {}),
                activeEstimateId: String(latestEstimatingState.activeEstimateId || parsed?.activeEstimateId || latestEstimatingState.estimates[0]?.id || 'est_primary'),
                estimates: latestEstimatingState.estimates,
                summary: latestEstimatingState.summary || parsed?.summary || null
            };
        }
        if (parsed) return parsed;
        const psSummary = Array.isArray(window.ProjectState?.estimatesSummary) ? window.ProjectState.estimatesSummary : [];
        const psActiveId = String(window.ProjectState?.activeEstimateId || '');
        if (psSummary.length > 0) {
            const resolvedActive = (psActiveId && psActiveId !== 'est_primary') ? psActiveId : String(psSummary[0].id || 'est_primary');
            const activeRow = psSummary.find(row => String(row.id) === resolvedActive) || psSummary[0];
            return {
                search: '',
                selected: [],
                fullscreen: false,
                hiddenColumns: [],
                laborUnit: 'hrs',
                groups: Array.isArray(activeRow?.groups) ? activeRow.groups : [],
                estimates: psSummary.map((row, idx) => ({
                    id: String(row.id),
                    name: row.name || (idx === 0 ? 'Primary Estimate' : `Estimate ${idx + 1}`),
                    is_primary: Boolean(row.is_primary || row.isPrimary || idx === 0),
                    isPrimary: Boolean(row.is_primary || row.isPrimary || idx === 0),
                    primary: Boolean(row.is_primary || row.isPrimary || idx === 0),
                    groups: Array.isArray(row.groups) ? row.groups : [],
                    settings: row.settings || {}
                })),
                activeEstimateId: resolvedActive,
                summary: activeRow?.estimateSummary || null
            };
        }
        const fallbackActiveId = (psActiveId && psActiveId !== 'est_primary') ? psActiveId : 'est_primary';
        return {
            search: '',
            selected: [],
            fullscreen: false,
            hiddenColumns: [],
            laborUnit: 'hrs',
            groups: [],
            estimates: [{ id: fallbackActiveId, name: 'Primary Estimate', primary: true }],
            activeEstimateId: fallbackActiveId,
            globalLaborCost: 36,
            globalLaborSales: 55.05,
            globalLaborMargin: 34.6,
            materialMargin: 15,
            equipmentMargin: 15,
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
        if (!window.canChangeTakeoffDrawing()) return;
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
        const estimating = loadEstimatingStateForSync();
        const psActiveId = String(window.ProjectState?.activeEstimateId || '');
        if (takeoffState.activeEstimateId && String(takeoffState.activeEstimateId) !== 'est_primary') {
            return String(takeoffState.activeEstimateId);
        }
        const estActiveId = String(estimating?.activeEstimateId || '');
        if (estActiveId && estActiveId !== 'est_primary') {
            return estActiveId;
        }
        if (psActiveId && psActiveId !== 'est_primary') {
            return psActiveId;
        }
        const firstEstId = String(estimating?.estimates?.[0]?.id || '');
        if (firstEstId && firstEstId !== 'est_primary') {
            return firstEstId;
        }
        return String(takeoffState.activeEstimateId || estActiveId || firstEstId || 'est_primary');
    }

    function primaryEstimateId() {
        const estimating = loadEstimatingStateForSync();
        const primary = Array.isArray(estimating?.estimates)
            ? estimating.estimates.find(row => Boolean(row?.isPrimary || row?.is_primary || row?.primary))
            : null;
        if (primary?.id) return String(primary.id);
        const metaPrimaryId = String(window.ProjectState?.metadata?.primary_estimate_id || '');
        if (metaPrimaryId && metaPrimaryId !== 'est_primary') return metaPrimaryId;
        return String(estimating.estimates?.[0]?.id || estimating.activeEstimateId || activeEstimateId() || 'est_primary');
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
            if (!group.estimateId || (group.estimateId === 'est_primary' && primaryId !== 'est_primary')) {
                group.estimateId = primaryId;
            }
            (group.layers || []).forEach(layer => {
                if (!layer.estimateId || (layer.estimateId === 'est_primary' && primaryId !== 'est_primary')) {
                    layer.estimateId = group.estimateId || primaryId;
                }
            });
        });
    }

    function layerBelongsToEstimate(layer, estimateId = activeEstimateId()) {
        return Boolean(layer) && String(layer.estimateId || '') === String(estimateId || '');
    }

    function resolveEstimatingItemTakeoffColor(item = {}, fallback = '#2563eb') {
        const candidates = [
            item.color,
            item.takeoffDefaults?.color,
            item.catalogMetadata?.takeoffDefaults?.color,
            item.catalogSnapshot?.takeoffDefaults?.color,
            item.catalogMetadata?.color,
            item.catalogSnapshot?.color
        ];
        const selected = candidates
            .map(value => String(value || '').trim())
            .find(value => /^#[0-9a-f]{3,8}$/i.test(value));
        return selected || fallback;
    }

    function syncEstimatingItemsToTakeoff(detail = {}) {
        if (detail.projectId && window.ProjectState?.projectId && String(detail.projectId) !== String(window.ProjectState.projectId)) return;
        scopeLegacyTakeoffGroupsOnce();
        const estimateId = String(detail.activeEstimateId || '');
        if (!estimateId || !Array.isArray(detail.groups)) return;
        const isCurrentActiveEstimate = estimateId === activeEstimateId();
        const hasWorkspaceForEst = takeoffState.groups.some(row => groupBelongsToEstimate(row, estimateId));
        if (!isCurrentActiveEstimate && !hasWorkspaceForEst) return;
        if (detail.syncSource && detail.syncSource !== 'takeoff-sync' && estimatingSyncTimer) {
            clearTimeout(estimatingSyncTimer);
            estimatingSyncTimer = null;
        }
        ensureEstimateTakeoffWorkspace(estimateId);
        const seen = new Set();
        const seenLayerObjects = new Set();
        const pendingLinks = [];
        const orderedGroupIds = [];
        const orderedLayerIdsByGroup = new Map();
        let didMutateGroupMeta = false;
        const previousOrderSignature = takeoffState.groups
            .filter(group => groupBelongsToEstimate(group, estimateId))
            .map(group => `${group.id}:${(group.layers || []).map(row => String(row.id)).join(',')}`)
            .join('|');
        detail.groups.forEach((estimateGroup, groupIndex) => {
            const groupKey = String(estimateGroup.id || `group_${groupIndex}`);
            let group = takeoffState.groups.find(row => String(row.estimateId || '') === estimateId
                && (String(row.estimatingGroupId || '') === groupKey
                    || String(row.id || '') === groupKey
                    || (estimateGroup.takeoffGroupId && String(row.id || '') === String(estimateGroup.takeoffGroupId))
                    || groupKey.endsWith('_' + String(row.id || ''))
                    || (row.name && row.name.trim().toLowerCase() === (estimateGroup.name || '').trim().toLowerCase())));
            if (!group) {
                group = {
                    id: `estgrp_${estimateId}_${groupKey}`, estimatingGroupId: groupKey,
                    estimateId, name: estimateGroup.name || 'Default Group', isExpanded: true, isDefault: false, layers: []
                };
                takeoffState.groups.push(group);
                didMutateGroupMeta = true;
            }
            group.estimatingGroupId = groupKey;
            if (estimateGroup.name && estimateGroup.name !== group.name) {
                group.name = estimateGroup.name;
                group.isDefault = false;
                didMutateGroupMeta = true;
            }
            group.sortOrder = groupIndex;
            orderedGroupIds.push(String(group.id));
            if (!orderedLayerIdsByGroup.has(group)) {
                orderedLayerIdsByGroup.set(group, []);
            }
            const groupOrderedLayerIds = orderedLayerIdsByGroup.get(group);
            (estimateGroup.items || []).forEach(item => {
                const itemId = String(item.id || '');
                if (!itemId || item.parentItemId || item.parent_item_id || item.assemblyParentId) return;
                const layerId = String(item.takeoffLayerId || `estitem_${estimateId}_${itemId}`);
                const itemKeys = [
                    String(item.takeoffLayerId || ''),
                    item.takeoffLayerId && String(item.takeoffLayerId).startsWith('takeoff_') ? String(item.takeoffLayerId).slice(8) : '',
                    itemId.startsWith('takeoff_') ? itemId.slice(8) : '',
                    String(item.source_layer_key || '')
                ].filter(Boolean);
                const scopedLayers = allLayers().filter(row => String(row.estimateId || '') === estimateId || !row.estimateId);
                const matchesTakeoffIdentity = row => {
                    const rowKeys = [
                        String(row.id || ''),
                        String(row.integration_key || ''),
                        String(row.client_uid || ''),
                        String(row.metadata_json?.project_layer_id || ''),
                        String(row.metadata?.project_layer_id || '')
                    ].filter(Boolean);
                    return itemKeys.some(key => rowKeys.includes(key)) || String(row.id) === layerId;
                };
                // The persisted Takeoff identity is authoritative. A shared
                // estimatingItemId is only a fallback because legacy races may
                // have left two aliases pointing at the same Estimating row.
                let layer = scopedLayers.find(matchesTakeoffIdentity)
                    || scopedLayers.find(row => String(row.estimatingItemId || '') === itemId);
                const estQty = Number(item.quantity || 0);
                const isItemAddedFromEst = Boolean(item.addedFromEstimating || item.origin === 'estimating' || item.origin === 'excel_import');
                const hasTakeoffOrigin = Boolean(item.copiedFromTakeoffLayerId || item.takeoffLayerId || item.source_layer_key || String(item.quantitySource || '') === 'takeoff');
                const initialTakeoffQty = (item.lastSyncedTakeoffQuantity !== undefined && item.lastSyncedTakeoffQuantity !== null)
                    ? Number(item.lastSyncedTakeoffQuantity || 0)
                    : (hasTakeoffOrigin ? Number(item.takeoffQuantity ?? 0) : 0);
                const isItemOverridden = Boolean(
                    item.quantityOverride
                    || String(item.quantitySyncStatus || '') === 'overridden'
                    || (!layer && Math.abs(estQty - initialTakeoffQty) >= 0.0001)
                );
                if (!layer) {
                    layer = {
                        id: layerId, groupId: group.id, estimateId, estimatingItemId: itemId,
                        name: item.name || 'Cost item', type: inferTakeoffTypeFromUom(item.uom) || 'Count',
                        uom: item.uom || 'ea', symbol: 'Solid Circle', size: 'Medium', color: resolveEstimatingItemTakeoffColor(item),
                        colorSource: 'estimating',
                        visible: true, locked: false, quantity: initialTakeoffQty,
                        baseQuantity: initialTakeoffQty,
                        quantityOverride: isItemOverridden,
                        estimatingQuantity: estQty,
                        addedFromEstimating: isItemAddedFromEst,
                        catalogItemId: item.catalogItemId || null,
                        catalog_item_id: item.catalogItemId || null, unitCost: Number(item.unitMaterialCost || 0),
                        unit_cost: Number(item.unitMaterialCost || 0), laborHours: Number(item.unitLabor || 0),
                        labor_hours: Number(item.unitLabor || 0), description: item.description || '',
                        catalogNumber: item.costCode || item.budgetCode || '', itemType: item.itemType || 'part'
                    };
                    group.layers.push(layer);
                    didMutateGroupMeta = true;
                } else {
                    const oldGroup = groupForLayer(layer);
                    if (oldGroup !== group) {
                        oldGroup.layers = oldGroup.layers.filter(row => row !== layer);
                        group.layers.push(layer); layer.groupId = group.id;
                        didMutateGroupMeta = true;
                    }
                    const estimatingColor = resolveEstimatingItemTakeoffColor(item, '');
                    const currentColor = String(layer.color || '').trim();
                    const mayRestoreEstimatingColor = layer.colorSource === 'estimating'
                        || (layer.colorSource !== 'takeoff-user' && (
                            !/^#[0-9a-f]{3,8}$/i.test(currentColor)
                            || currentColor.toLowerCase() === '#2563eb'
                        ));
                    const resolvedColor = mayRestoreEstimatingColor && estimatingColor
                        ? estimatingColor : (currentColor || '#2563eb');
                    if (resolvedColor !== layer.color) {
                        didMutateGroupMeta = true;
                        layer.colorSource = 'estimating';
                    }
                    Object.assign(layer, {
                        estimateId, estimatingItemId: itemId, name: item.name || layer.name,
                        uom: item.uom || layer.uom, catalogItemId: item.catalogItemId || null,
                        catalog_item_id: item.catalogItemId || null, unitCost: Number(item.unitMaterialCost || 0),
                        unit_cost: Number(item.unitMaterialCost || 0), laborHours: Number(item.unitLabor || 0),
                        labor_hours: Number(item.unitLabor || 0), description: item.description || '',
                        quantityOverride: isItemOverridden,
                        estimatingQuantity: Number(item.quantity || 0),
                        addedFromEstimating: isItemAddedFromEst || layer.addedFromEstimating,
                        color: resolvedColor
                    });
                }
                seen.add(String(layer.id));
                seenLayerObjects.add(layer);
                unqueueDeletedLayerKeys(estimateId, layer);
                groupOrderedLayerIds.push(String(layer.id));
                if (String(item.takeoffLayerId || '') !== String(layer.id)) {
                    pendingLinks.push({ itemId, layerId: String(layer.id) });
                }
            });
        });
        const canonicalLayerKeys = new Set(
            [...seenLayerObjects].flatMap(layer => collectLayerTrackingKeys(layer))
        );
        const existingEstLayerCount = allLayers().filter(row => String(row.estimateId || '') === estimateId && (row.estimatingItemId || row.metadata_json?.estimating_item_id)).length;
        const removedLayerIds = [];
        const removedLayerKeys = [];
        takeoffState.groups.forEach(group => {
            group.layers = (group.layers || []).filter(layer => {
                const linkedEstItemId = String(layer.estimatingItemId || layer.metadata_json?.estimating_item_id || layer.estimate_item_id || '');
                const keep = String(layer.estimateId || '') !== estimateId
                    || !linkedEstItemId || seenLayerObjects.has(layer);
                if (!keep && layer?.id) {
                    const purgeableKeys = purgeableLayerTrackingKeys(layer, canonicalLayerKeys);
                    if (!canonicalLayerKeys.has(String(layer.id))) removedLayerIds.push(String(layer.id));
                    purgeableKeys.forEach(k => removedLayerKeys.push(k));
                }
                return keep;
            });
        });
        if (removedLayerKeys.length > 0) {
            removeLayersFromEditorAndQueue(estimateId, removedLayerKeys, { force: true });
            const removedIdSet = new Set(removedLayerIds.map(String));
            const removedKeySet = new Set(removedLayerKeys.map(String));
            if (isCurrentActiveEstimate && takeoffState.activeLayerId
                && (removedIdSet.has(String(takeoffState.activeLayerId)) || removedKeySet.has(String(takeoffState.activeLayerId)))) {
                takeoffState.activeLayerId = null;
                callEditor('projectTakeoffClearActiveLayer');
                setActiveTool('smart');
            }
            if (canWrite()) takeoffIsDirty = true;
        }
        orderedLayerIdsByGroup.forEach((layerIds, group) => {
            const layerOrder = new Map(layerIds.map((id, idx) => [id, idx]));
            group.layers = (group.layers || []).slice().sort((a, b) =>
                (layerOrder.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (layerOrder.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));
        });
        const nextEstLayerCount = allLayers().filter(row => String(row.estimateId || '') === estimateId && (row.estimatingItemId || row.metadata_json?.estimating_item_id)).length;
        if (nextEstLayerCount !== existingEstLayerCount) didMutateGroupMeta = true;
        const scopedIndexes = takeoffState.groups.map((group, index) => groupBelongsToEstimate(group, estimateId) ? index : -1).filter(index => index >= 0);
        const order = new Map(orderedGroupIds.map((id, index) => [id, index]));
        const scopedGroups = scopedIndexes.map(index => takeoffState.groups[index]).sort((a, b) =>
            (order.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));
        scopedGroups.forEach((group, index) => { takeoffState.groups[scopedIndexes[index]] = group; });
        const nextOrderSignature = takeoffState.groups
            .filter(group => groupBelongsToEstimate(group, estimateId))
            .map(group => `${group.id}:${(group.layers || []).map(row => String(row.id)).join(',')}`)
            .join('|');
        if (didMutateGroupMeta || nextOrderSignature !== previousOrderSignature) {
            if (canWrite()) {
                takeoffIsDirty = true;
                try {
                    const pId = String(window.ProjectState?.projectId || 0);
                    safeSetTakeoffLocalStorage('takeoff_project_groups_' + pId, JSON.stringify(takeoffState.groups));
                } catch (_) { }
            }
        }
        if (isCurrentActiveEstimate && takeoffState.activeLayerId && !layerBelongsToEstimate(findLayer(takeoffState.activeLayerId), estimateId)) {
            takeoffState.activeLayerId = null;
        }
        if (pendingLinks.length) window.dispatchEvent(new CustomEvent('takeoff:estimating-links-requested', {
            detail: {
                version: 1, origin: 'takeoff', projectId: String(window.ProjectState?.projectId || ''),
                estimateId, links: pendingLinks
            }
        }));
        const editorReloading = ensureEditorEstimate(estimateId);
        if (!detail.skipCanvasResync && !editorReloading) syncAllLayersToCanvas({ suppressEstimatingSync: true });
        if (!detail.skipCanvasResync || didMutateGroupMeta || nextOrderSignature !== previousOrderSignature) {
            renderTakeoffPanel();
        } else {
            patchAllTakeoffLayerQuantityDom();
        }
        renderActiveLayerToolbar();
        return Boolean(didMutateGroupMeta || nextOrderSignature !== previousOrderSignature);
    }

    function estimateLineFromLayer(layer) {
        const group = groupForLayer(layer);
        const resolvedMeta = layerCatalogMetadata(layer);
        const isAsm = Boolean(
            layer.isAssembly === true
            || Number(layer.is_assembly ?? 0) === 1
            || String(layer.itemType || layer.item_type || '').toLowerCase() === 'assembly'
            || String(resolvedMeta?.type || '').toLowerCase() === 'assembly'
            || (Array.isArray(layer.copiedAssemblyChildren) && layer.copiedAssemblyChildren.length > 0)
            || (Array.isArray(resolvedMeta?.assemblyComponents) && resolvedMeta.assemblyComponents.length > 0)
            || (Array.isArray(layer.catalogSnapshot?.assemblyComponents) && layer.catalogSnapshot.assemblyComponents.length > 0)
        );
        const itemType = isAsm
            ? 'assembly'
            : (layer.itemType || layer.item_type || (String(layer.category || '').toLowerCase().includes('labor') ? 'Labor' : 'Materials'));
        return {
            id: `takeoff_${layer.id}`,
            takeoffLayerId: String(layer.id),
            copiedFromTakeoffLayerId: layer.copiedFromTakeoffLayerId || null,
            catalogItemId: layer.catalogItemId || layer.catalog_item_id || null,
            catalogMetadata: resolvedMeta,
            ...(layer.catalogSnapshot && !resolvedMeta ? { catalogSnapshot: window.CatalogMetadata.clone(layer.catalogSnapshot) } : {}),
            name: layer.name || 'Takeoff item',
            description: layer.description || '',
            color: layer.color,
            type: itemType,
            itemType,
            isAssembly: isAsm,
            budgetCode: layer.catalogNumber || layer.catalog_number || '',
            costCode: layer.catalogNumber || layer.catalog_number || '',
            costCategory: itemType,
            originalQuantity: Number(layer.quantity || 0),
            quantity: Number(layer.quantity || 0),
            unitCost: Number(layer.unitCost || layer.unit_cost || 0),
            unitMaterialCost: Number(layer.unitCost || layer.unit_cost || 0),
            waste: (layer.waste !== undefined && layer.waste !== null && layer.waste !== '') ? Number(layer.waste) : null,
            materialMargin: (layer.materialMargin !== undefined && layer.materialMargin !== null && layer.materialMargin !== '')
                ? Number(layer.materialMargin)
                : ((layer.margin !== undefined && layer.margin !== null && layer.margin !== '') ? Number(layer.margin) : null),
            equipmentMargin: (layer.equipmentMargin !== undefined && layer.equipmentMargin !== null && layer.equipmentMargin !== '')
                ? Number(layer.equipmentMargin) : null,
            unitLabor: Number(layer.laborHours || layer.labor_hours || 0),
            laborRate: (layer.laborRate !== undefined && layer.laborRate !== null && Number(layer.laborRate) > 0)
                ? Number(layer.laborRate) : null,
            laborUnitType: 'hrs',
            difficulty: (layer.difficulty !== undefined && layer.difficulty !== null && layer.difficulty !== '' && Number(layer.difficulty) !== 1)
                ? Number(layer.difficulty)
                : (layer.metadata_json?.difficulty !== undefined && layer.metadata_json?.difficulty !== null
                    ? Number(layer.metadata_json.difficulty) : null),
            laborMargin: (layer.laborMargin !== undefined && layer.laborMargin !== null && layer.laborMargin !== '')
                ? Number(layer.laborMargin) : null,
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

    function syncTakeoffToEstimating(targetEstimateOverrideId = null) {
        const state = loadEstimatingStateForSync();
        const scopedEstimateId = String(targetEstimateOverrideId || state.activeEstimateId || '');
        const isBackgroundEstimate = Boolean(targetEstimateOverrideId) && scopedEstimateId !== String(state.activeEstimateId || '');
        const activeEstimate = Array.isArray(state.estimates)
            ? (state.estimates.find(estimate => String(estimate.id) === scopedEstimateId) || state.estimates[0])
            : null;
        const currentGroups = activeEstimate?.groups || (!isBackgroundEstimate ? state.groups : []) || [];
        const existingByLayerId = new Map();
        const manualByGroupName = new Map();
        const layerByEstimatingItemId = new Map(allLayers()
            .filter(layer => layerBelongsToEstimate(layer, scopedEstimateId) && layer.estimatingItemId)
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
        const targetEstimateId = scopedEstimateId;
        const scopedTakeoffGroups = takeoffState.groups.filter(group => groupBelongsToEstimate(group, targetEstimateId));
        const totalScopedLayerCount = scopedTakeoffGroups.reduce((sum, group) => {
            const groupItems = Array.isArray(group?.items) ? group.items : (Array.isArray(group?.layers) ? group.layers : []);
            return sum + groupItems.length;
        }, 0);
        if (totalScopedLayerCount === 0 && !takeoffIsDirty) {
            const targetEstimate = Array.isArray(state?.estimates)
                ? state.estimates.find(est => String(est?.id) === targetEstimateId)
                : null;
            const targetEstGroups = Array.isArray(targetEstimate?.groups) ? targetEstimate.groups : (Array.isArray(state?.groups) ? state.groups : []);
            const estimatingHasItems = targetEstGroups.some(grp => Array.isArray(grp?.items) && grp.items.length > 0)
                || (Array.isArray(window.ProjectState?.estimateItems) && window.ProjectState.estimateItems.length > 0)
                || (Array.isArray(window.ProjectState?.estimatesSummary) && window.ProjectState.estimatesSummary.some(e => String(e.id) === targetEstimateId && Number(e.itemCount || 0) > 0));
            if (estimatingHasItems) {
                return;
            }
        }
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
                if (!existing && Array.isArray(layer.copiedAssemblyChildren) && layer.copiedAssemblyChildren.length > 0) {
                    line.children = cloneAssemblyChildrenTree(layer.copiedAssemblyChildren);
                }
                const synchronized = window.TakeoffEstimatingSyncService?.takeoffItem
                    ? window.TakeoffEstimatingSyncService.takeoffItem({ ...line, id: layer.id },
                        { id: groupId, name: groupName }, existing)
                    : { ...(existing || {}), ...line };
                if (!layer.estimatingItemId && (existing?.id || synchronized.id || line.id)) {
                    layer.estimatingItemId = String(existing?.id || synchronized.id || line.id);
                }
                const isOverridden = Boolean(
                    synchronized.quantityOverride
                    || existing?.quantityOverride
                    || String(existing?.quantitySyncStatus || '') === 'overridden'
                );
                const effectiveQty = isOverridden
                    ? Number(existing?.quantity ?? synchronized.quantity ?? line.quantity)
                    : line.quantity;
                return {
                    ...line,
                    ...synchronized,
                    id: existing?.id || line.id,
                    groupId,
                    groupName,
                    originalQuantity: line.quantity,
                    quantity: effectiveQty,
                    pendingTakeoffQuantity: isOverridden ? line.quantity : null,
                    quantityOverride: isOverridden,
                    quantitySource: 'takeoff',
                    quantitySyncStatus: isOverridden ? 'overridden' : 'synced',
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
                isDefault: Boolean(takeoffGroup.isDefault),
                items
            };
        }).filter(group => group.items.length
            || !group.isDefault
            || currentGroups.some(row => row.name === group.name
                || String(row.id) === String(group.id)
                || (group.takeoffGroupId && String(row.takeoffGroupId || '') === String(group.takeoffGroupId))));

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

        if (!isBackgroundEstimate) state.groups = projectedGroups;
        if (activeEstimate) activeEstimate.groups = projectedGroups;
        try {
            window.dispatchEvent(new CustomEvent('takeoff:estimating-lines-updated', {
                detail: {
                    version: 2,
                    projectId: String(window.ProjectState?.projectId || ''),
                    activeEstimateId: String(targetEstimateId || ''),
                    allowBackgroundEstimate: isBackgroundEstimate,
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
        const overrideBlock = getLayerEstimatingOverrideBlock(layer, layer.estimateId || activeEstimateId());
        return {
            id: layer.id,
            name: layer.name,
            tag: layer.tag || '',
            cost_code: layer.costCode || layer.catalogNumber || '',
            takeoff_type: layer.type.toLowerCase(),
            type: layer.type.toLowerCase(),
            unit_of_measure: layer.uom,
            uom: layer.uom,
            symbol: layer.symbol,
            symbol_size: takeoffSizeRadius(layer.size || (layer.markerDiameter ? layer.markerDiameter / 2 : 9)),
            size: layer.size || takeoffDisplaySize(layer.markerDiameter ? layer.markerDiameter / 2 : 9),
            marker_diameter: layer.markerDiameter || (takeoffSizeRadius(layer.size) * 2),
            stroke_width: layer.strokeWidth || 4,
            color: layer.color,
            quantity: layer.quantity,
            baseQuantity: layer.baseQuantity || 0,
            multiplier: Number(layer.multiplier ?? layer.metadata_json?.multiplier ?? 1),
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
            estimating_override_block: Boolean(overrideBlock.blocked),
            estimating_override_qty: Number(overrideBlock.estimatingQuantity || 0),
            estimating_override_uom: String(overrideBlock.uom || layer.uom || 'ea'),
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
        if (isLinearType(layer.type) || layer.type === 'Count by distance') return '<i class="fas fa-minus"></i>';
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

    function takeoffGeometryFamily(type) {
        if (isLinearType(type) || type === 'Count by distance') return 'linear';
        if (isAreaType(type)) return 'area';
        const raw = String(type || '').trim().toLowerCase();
        if (raw.includes('linear') || raw === 'count by distance' || raw === 'count_by_distance') return 'linear';
        if (raw.includes('area') || raw.includes('volume')) return 'area';
        return 'count';
    }

    function needsTakeoffTypeChangeWarning(prevType, nextType) {
        return Boolean(prevType && nextType && takeoffGeometryFamily(prevType) !== takeoffGeometryFamily(nextType));
    }

    async function confirmTakeoffTypeChange({ layer = null, prevType = 'Count', nextType = 'Linear' } = {}) {
        if (!needsTakeoffTypeChangeWarning(prevType, nextType)) return true;
        const prevFam = takeoffGeometryFamily(prevType);
        const nextFam = takeoffGeometryFamily(nextType);
        const itemName = layer?.name ? `"${layer.name}"` : 'this item';
        const prevObjectLabel = prevFam === 'count'
            ? 'count markers'
            : (prevFam === 'linear' ? 'linear lines' : 'area measurements');
        const nextActionHint = nextFam === 'linear'
            ? 'so you can re-measure using Linear lines'
            : (nextFam === 'count' ? 'so you can re-count using Count markers' : 'so you can re-measure with the new type');
        const qtyNote = Number(layer?.quantity || 0) > 0
            ? ` Current quantity (${quantityLabel(layer)}) will reset to 0.`
            : '';
        const message = `Changing ${itemName} from ${prevType} to ${nextType} will delete all existing ${prevObjectLabel} from the drawings and reset its quantity to 0 ${nextActionHint}.${qtyNote} Do you want to continue?`;
        if (typeof window.showConfirmDialog === 'function') {
            return await window.showConfirmDialog({
                title: 'Confirm Takeoff Type Change',
                message,
                confirmText: 'Change Type & Clear',
                cancelText: 'Cancel',
                type: 'warning',
                badge: 'TYPE CHANGE',
                icon: 'fas fa-triangle-exclamation',
                primaryDanger: true
            });
        }
        return window.confirm(message);
    }

    function clearLayerCachedStateOnTypeChange(layer) {
        if (!layer) return;
        layer.quantity = 0;
        layer.baseQuantity = 0;
        layer.shapes = [];
        layer.takeoffObjects = [];
        if (layer.metadata && typeof layer.metadata === 'object') layer.metadata.base_quantity = 0;
        if (layer.metadata_json && typeof layer.metadata_json === 'object') layer.metadata_json.base_quantity = 0;
        const activeEst = activeEstimateId();
        const ids = new Set([String(layer.id || ''), String(layer.client_uid || '')].filter(Boolean));
        Object.values(takeoffState.canvasSnapshots || {}).forEach(snapshot => {
            if (!snapshot || String(snapshot.estimateId || snapshot.estimateKey || '') !== activeEst) return;
            (snapshot.layers || []).forEach(remote => {
                const rid = String(remote?.id || remote?.layerId || remote?.client_uid || '');
                if (!rid || !ids.has(rid)) return;
                remote.shapes = [];
                remote.takeoffObjects = [];
                remote.quantity = 0;
                remote.baseQuantity = 0;
                remote.base_quantity = 0;
                remote.seedQuantity = 0;
                remote.seed_quantity = 0;
            });
        });
    }

    function itemQuantitySubtitle(layer) {
        const qty = Number(layer.quantity || 0);
        const formatted = qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2);
        const uom = layer.uom || typeToUom(layer.type) || 'ft';
        if (layer.type === 'Linear avg. with drop' || String(layer.type).toLowerCase().includes('avg')) {
            return `${formatted} ${uom} avg.`;
        }
        return `${formatted} ${uom}`;
    }

    function buildEstimatingOverrideIndex(estimateId = activeEstimateId()) {
        const index = new Map();
        try {
            const estState = loadEstimatingStateForSync();
            const est = Array.isArray(estState?.estimates)
                ? (estState.estimates.find(row => String(row.id) === String(estimateId)) || estState.estimates[0])
                : null;
            const groups = est?.groups || estState?.groups || [];
            const addFirst = (key, item) => {
                if (key && !index.has(key)) index.set(key, item);
            };
            for (const group of groups) {
                for (const item of (group.items || [])) {
                    const itemId = String(item.id || '');
                    const itemLayerId = String(item.takeoffLayerId || item.takeoff_layer_id || item.layerId || '');
                    const cleanLayerId = itemLayerId.replace(/^takeoff_/, '');
                    const cleanItemId = itemId.replace(/^takeoff_/, '');
                    addFirst(`estimating:${itemId}`, item);
                    addFirst(`layer:${itemLayerId}`, item);
                    addFirst(`layer:${cleanLayerId}`, item);
                    addFirst(`layer:${cleanItemId}`, item);
                }
            }
        } catch (_) { }
        return index;
    }

    function getLayerEstimatingOverride(layer, estimateId = activeEstimateId(), overrideIndex = null) {
        if (!layer) return { overridden: false, estimatingQuantity: 0, addedFromEstimating: false };
        try {
            const index = overrideIndex || buildEstimatingOverrideIndex(estimateId);
            const lid = String(layer.id || '');
            const estItemId = String(layer.estimatingItemId || layer.metadata_json?.estimating_item_id || '');
            const layerKeys = [
                lid,
                String(layer.client_uid || ''),
                String(layer.integration_key || ''),
                String(layer.metadata_json?.project_layer_id || '')
            ].filter(Boolean);
            let item = estItemId ? index.get(`estimating:${estItemId}`) : null;
            if (!item) {
                for (const key of layerKeys) {
                    item = index.get(`layer:${key}`);
                    if (item) break;
                }
            }
            const tkQty = Number(layer.quantity || 0);
            if (item) {
                const estQty = Number(item.quantity ?? 0);
                const isSame = Math.abs(tkQty - estQty) < 0.0001;
                const overridden = !isSame && (
                    item.quantityOverride === true
                    || String(item.quantitySyncStatus || '') === 'overridden'
                    || String(item.origin || '') === 'excel_import'
                    || (Boolean(layer.quantityOverride) && String(item.quantitySyncStatus || '') !== 'synced')
                );
                const addedFromEstimating = Boolean(item.addedFromEstimating === true || item.origin === 'estimating' || item.origin === 'excel_import' || layer.addedFromEstimating === true);
                return {
                    overridden,
                    estimatingQuantity: estQty,
                    addedFromEstimating,
                    quantityOverrideSource: String(item.quantityOverrideSource || ''),
                    lastSyncedTakeoffQuantity: Number(item.lastSyncedTakeoffQuantity ?? item.originalQuantity ?? 0)
                };
            }
        } catch (_) { }
        return {
            overridden: false,
            estimatingQuantity: 0,
            addedFromEstimating: Boolean(layer.addedFromEstimating === true),
            quantityOverrideSource: '',
            lastSyncedTakeoffQuantity: 0
        };
    }

    function getLayerEstimatingOverrideBlock(layer, estimateId = activeEstimateId()) {
        if (!layer) return { blocked: false, estimatingQuantity: 0, uom: 'ea' };
        const ov = getLayerEstimatingOverride(layer, estimateId);
        const uom = String(layer.uom || 'ea');
        const estQty = Number(ov.estimatingQuantity || 0);
        if (!ov.overridden || estQty <= 0) {
            return { blocked: false, estimatingQuantity: estQty, uom };
        }
        const source = String(ov.quantityOverrideSource || '');
        if (source === 'canvas_overridden') {
            return { blocked: false, estimatingQuantity: estQty, uom };
        }
        const hasCanvasShapes = Array.isArray(layer.shapes) && layer.shapes.length > 0;
        const canvasQty = Number(layer.quantity || 0);
        const estSyncedCanvasQty = Number(ov.lastSyncedTakeoffQuantity || 0);
        const blocked = source === 'estimating_first'
            || (!hasCanvasShapes && canvasQty <= 0 && estSyncedCanvasQty <= 0);
        return { blocked, estimatingQuantity: estQty, uom };
    }

    function toggleGroupLock(groupId) {
        if (!requireWrite()) return false;
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
        const renderLayers = allLayers().filter(layer => layerBelongsToEstimate(layer, estimateId));
        const layersCount = renderLayers.length;
        const estimatingOverrideIndex = buildEstimatingOverrideIndex(estimateId);
        const editorLockStates = callEditor('projectTakeoffGetAllLayerLockStates') || {};
        const layerLockStateById = new Map(renderLayers.map(layer => {
            const editorLockState = editorLockStates[String(layer.id)]
                || editorLockStates[String(layer.client_uid || '')]
                || editorLockStates[String(layer.metadata_json?.project_layer_id || '')]
                || {};
            return [String(layer.id), Boolean(layer.locked || editorLockState.locked)];
        }));
        if (title) title.textContent = `Takeoffs (${layersCount})`;
        const activeLayer = findLayer(takeoffState.activeLayerId);
        if (activeLabel) activeLabel.textContent = activeLayer ? activeLayer.name : 'None';
        renderActiveLayerToolbar();
        renderInspector();
        renderWorkspaceSummary();
        const groupsHtml = takeoffState.groups.filter(group => groupBelongsToEstimate(group, estimateId)).map(group => {
            const visibleLayers = (group.layers || []).filter(layer => layerBelongsToEstimate(layer, estimateId)).filter(layer => {
                if (!q) return true;
                return group.name.toLowerCase().includes(q) || layer.name.toLowerCase().includes(q) || layer.type.toLowerCase().includes(q);
            });
            const groupVisible = !q || group.name.toLowerCase().includes(q) || visibleLayers.length > 0;
            if (!groupVisible) return '';
            const expanded = q ? true : group.isExpanded !== false;
            const groupSelected = selectionState.selectedGroupIds.includes(String(group.id));
            const groupLocked = (group.layers || []).length > 0
                && (group.layers || []).every(layer => layerLockStateById.get(String(layer.id)) === true);
            const hasVisibleChild = visibleLayers.some(layer => layer.visible !== false);

            const isFolderActive = groupSelected;

            return `<div class="pro-takeoff-group" data-group-id="${esc(group.id)}">
                <div class="pro-tree-row pro-tree-folder ${isFolderActive ? 'active' : ''} ${groupSelected ? 'group-selected' : ''}" draggable="true" data-takeoff-group-row="${esc(group.id)}" role="button" tabindex="0" aria-selected="${groupSelected ? 'true' : 'false'}">
                    <button class="pro-visibility-btn ${hasVisibleChild ? '' : 'is-off'}" type="button" data-group-visibility="${esc(group.id)}" title="Show or hide group" aria-label="Show or hide group"><i class="fas ${hasVisibleChild ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                    <input type="checkbox" class="pro-group-select-check" ${groupSelected ? 'checked' : ''} aria-label="Select all items in group" data-group-select="${esc(group.id)}">
                    <div class="pro-tree-folder-title">
                        <button class="pro-tree-toggle" type="button" draggable="true" data-group-toggle="${esc(group.id)}" title="Click arrow to expand/collapse; drag to reorder" aria-label="Expand or drag group"><i class="fas ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i></button>
                        <span class="pro-tree-name" data-group-name-wrap="${esc(group.id)}" title="Double-click to rename or drag to reorder"><strong>${esc(group.name)}</strong></span>
                    </div>
                    <div class="pro-tree-row-actions">
                        <button class="pro-folder-lock-btn ${groupLocked ? 'is-locked' : ''}" type="button" data-group-lock="${esc(group.id)}" title="${groupLocked ? 'Unlock folder' : 'Lock folder'}" aria-label="${groupLocked ? 'Unlock folder' : 'Lock folder'}"><i class="fas ${groupLocked ? 'fa-lock' : 'fa-lock-open'}"></i></button>
                        <button class="pro-row-menu-btn" type="button" data-group-menu="${esc(group.id)}" title="Folder properties" aria-label="Folder properties"><i class="fas fa-ellipsis-vertical"></i></button>
                    </div>
                </div>
                <div class="pro-tree-children" ${expanded ? '' : 'hidden'}>
                    ${visibleLayers.map(layer => {
                const isVisible = layer.visible !== false;
                const isLocked = layerLockStateById.get(String(layer.id)) === true;
                const subText = itemQuantitySubtitle(layer);
                const overrideInfo = getLayerEstimatingOverride(layer, estimateId, estimatingOverrideIndex);
                const uom = layer.uom || typeToUom(layer.type) || 'ea';
                const estQtyNum = Number(overrideInfo.estimatingQuantity || 0);
                const estQtyFormatted = estQtyNum % 1 === 0 ? estQtyNum.toFixed(0) : estQtyNum.toFixed(2);
                const tkQtyNum = Number(layer.quantity || 0);
                const tkQtyFormatted = tkQtyNum % 1 === 0 ? tkQtyNum.toFixed(0) : tkQtyNum.toFixed(2);
                const overrideBadgeHtml = overrideInfo.overridden
                    ? `<span class="pro-tree-qty-override-badge" data-qty-override-badge="true" title="${esc(`Quantity altered in Estimating: ${estQtyFormatted} ${uom} (Takeoff measured: ${tkQtyFormatted} ${uom})`)}"><i class="fas fa-pen-to-square"></i><span>Est: ${esc(estQtyFormatted)} ${esc(uom)}</span></span>`
                    : '';
                const addedFromEstBadgeHtml = overrideInfo.addedFromEstimating
                    ? `<span class="pro-tree-est-added-badge" title="Added from Estimating"><i class="fas fa-calculator"></i><span>Est</span></span>`
                    : '';
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
                                    ${overrideBadgeHtml}
                                    ${addedFromEstBadgeHtml}
                                </div>
                            </div>
                            <div class="pro-tree-row-actions">
                                <button class="pro-layer-lock-btn ${isLocked ? 'is-locked' : ''}" type="button" data-layer-lock="${esc(layer.id)}" title="${isLocked ? 'Unlock item' : 'Lock item'}" aria-label="${isLocked ? 'Unlock item' : 'Lock item'}" aria-pressed="${isLocked ? 'true' : 'false'}"><i class="fas fa-${isLocked ? 'lock' : 'lock-open'}"></i></button>
                                <button class="pro-row-menu-btn" type="button" draggable="true" data-layer-menu="${esc(layer.id)}" title="Item details (drag to reorder)" aria-label="Item details"><i class="fas fa-ellipsis-vertical"></i></button>
                            </div>
                        </div>`;
            }).join('')}
                </div>
            </div>`;
        }).join('');

        const allRulers = Array.isArray(takeoffRulersState.items) ? takeoffRulersState.items : [];
        const visibleRulers = allRulers.filter((r, idx) => {
            if (!q) return true;
            const label = `measurement #${idx + 1}: "${r.sidebarQuantityText || r.lengthText || ''}"`.toLowerCase();
            return 'measurements'.includes(q) || label.includes(q);
        });
        const anyRulerVisible = allRulers.some(r => !r.hidden);
        const mExpanded = q ? true : takeoffRulersState.isExpanded !== false;
        const measurementsHtml = visibleRulers.length ? `
            <div class="pro-takeoff-group pro-measurements-group" data-measurements-group="true">
                <div class="pro-tree-row pro-tree-folder is-measurements-folder" data-measurements-header="true">
                    <button class="pro-visibility-btn ${anyRulerVisible ? '' : 'is-off'}" type="button" data-measurements-all-visibility="true" title="${anyRulerVisible ? 'Hide all measurements' : 'Show all measurements'}" aria-label="Show or hide all measurements"><i class="fas ${anyRulerVisible ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                    <div class="pro-tree-folder-title">
                        <button class="pro-tree-toggle" type="button" data-measurements-toggle="true" title="Expand or collapse measurements" aria-label="Expand or collapse measurements"><i class="fas ${mExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i></button>
                        <span class="pro-tree-name"><strong>Measurements</strong></span>
                        <span class="pro-measurements-badge">${visibleRulers.length}</span>
                    </div>
                    <div></div>
                </div>
                <div class="pro-tree-children" ${mExpanded ? '' : 'hidden'}>
                    ${visibleRulers.map((r) => {
            const qtyStr = String(r.sidebarQuantityText || r.lengthText || '0');
            const rowTitle = `Measurement #${r.index}: "${qtyStr}"`;
            const isSelected = Boolean(selectionState.selectedRuler && String(selectionState.selectedRuler.id || '') === String(r.id || ''));
            return `<div class="pro-tree-row pro-measurement-row ${r.hidden ? 'is-hidden-measurement' : ''} ${isSelected ? 'active' : ''}" data-measurement-row="${esc(r.id)}" title="${esc(rowTitle)}">
                            <button class="pro-visibility-btn ${r.hidden ? 'is-off' : ''}" type="button" data-measurement-visibility="${esc(r.id)}" title="${r.hidden ? 'Show measurement' : 'Hide measurement'}" aria-label="Show or hide measurement"><i class="fas ${r.hidden ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <span class="pro-measurement-color-dot" style="background:${esc(r.color || '#22c55e')};"></span>
                            <span class="pro-measurement-title">${esc(rowTitle)}</span>
                        </div>`;
        }).join('')}
                </div>
            </div>
        ` : '';

        tree.innerHTML = (groupsHtml || measurementsHtml)
            ? `${groupsHtml}${measurementsHtml}`
            : '<div class="pro-drawing-empty">No takeoffs match your search.</div>';
        bindTakeoffTreeEvents();
        updateSubheadSelectedItem();
        syncTakeoffSubheadAlignment();
    }

    function patchTakeoffSelectionClassesDom() {
        const tree = $('takeoffItemsTree');
        if (!tree) return false;
        const estimateId = activeEstimateId();
        const activeLabel = $('takeoffActiveLayerLabel');
        const activeLayer = findLayer(takeoffState.activeLayerId);
        if (activeLabel) activeLabel.textContent = activeLayer ? activeLayer.name : 'None';

        const selectedGroups = new Set((selectionState.selectedGroupIds || []).map(String));
        const selectedLayers = new Set((selectionState.selectedLayerIds || []).map(String));
        const activeIdStr = String(takeoffState.activeLayerId || '');
        const rows = tree.querySelectorAll('[data-layer-row]');
        const expectedVisibleLayers = allLayers().filter(layer => layerBelongsToEstimate(layer, estimateId));
        if (!String(takeoffState.query || '').trim() && rows.length !== expectedVisibleLayers.length) {
            return false;
        }

        tree.querySelectorAll('[data-takeoff-group-row]').forEach(gRow => {
            const gid = String(gRow.dataset.takeoffGroupRow || '');
            const gSel = selectedGroups.has(gid);
            gRow.classList.toggle('active', gSel);
            gRow.classList.toggle('group-selected', gSel);
            gRow.setAttribute('aria-selected', gSel ? 'true' : 'false');
            const gBox = gRow.querySelector('[data-group-select]');
            if (gBox) gBox.checked = gSel;
        });

        rows.forEach(row => {
            const lid = String(row.dataset.layerRow || '');
            const layer = findLayer(lid);
            const gid = String(layer?.groupId || '');
            const isLocked = row.classList.contains('is-locked-item') || Boolean(layer?.locked);
            const groupSelected = selectedGroups.has(gid);
            const isLayerSelected = !isLocked && (activeIdStr === lid || selectedLayers.has(lid));
            row.classList.toggle('active', isLayerSelected || groupSelected);
            row.classList.toggle('group-selected', groupSelected);
            row.setAttribute('aria-selected', groupSelected ? 'true' : 'false');
            const box = row.querySelector('[data-layer-select]');
            if (box) box.checked = isLayerSelected || groupSelected;
        });

        renderActiveLayerToolbar();
        return true;
    }
    window.updateTakeoffSubheadInfo = updateSubheadSelectedItem;

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
                ${(() => {
                const ov = getLayerEstimatingOverride(layer);
                if (!ov.overridden) return '';
                const uom = layer.uom || typeToUom(layer.type) || 'ea';
                const eq = Number(ov.estimatingQuantity || 0);
                const fmt = eq % 1 === 0 ? eq.toFixed(0) : eq.toFixed(2);
                return `<div class="pro-property-row"><span>Estimating qty</span><strong style="color:#d97706;"><i class="fas fa-pen-to-square"></i> ${esc(fmt)} ${esc(uom)}</strong></div>`;
            })()}
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

    function applyTakeoffGroupRename(group, nextName) {
        const trimmed = String(nextName || '').trim().replace(/\s+/g, ' ');
        if (!group || !trimmed || trimmed === String(group.name || '').trim()) return false;
        pushTakeoffHistory('rename-group');
        const oldName = String(group.name || '');
        const estimateId = activeEstimateId();
        group.name = trimmed;
        group.isDefault = false;
        group.estimatingGroupId = group.estimatingGroupId || `takeoff_group_${group.id}`;
        (group.layers || []).forEach(layer => {
            if (!layer) return;
            layer.groupName = trimmed;
            if (!layer.category || layer.category === oldName) layer.category = trimmed;
            if (layer.metadata_json && typeof layer.metadata_json === 'object') {
                layer.metadata_json.estimating_group_id = group.estimatingGroupId;
            }
        });
        takeoffIsDirty = true;
        const pId = String(window.ProjectState?.projectId || 0);
        safeSetTakeoffLocalStorage('takeoff_project_groups_' + pId, JSON.stringify(takeoffState.groups));
        window.dispatchEvent(new CustomEvent('takeoff:estimating-group-rename-requested', {
            detail: {
                projectId: String(window.ProjectState?.projectId || ''),
                estimateId,
                groupId: group.estimatingGroupId,
                takeoffGroupId: String(group.id),
                oldName,
                name: group.name
            }
        }));
        saveTakeoffState();
        syncAllLayersToCanvas({ suppressEstimatingSync: true });
        renderTakeoffPanel();
        renderSelectionBar?.();
        updateSubheadSelectedItem?.();
        return true;
    }

    function bindTakeoffTreeEvents() {
        let draggedGroupInsertAfter = false;
        const clearGroupDragMarkers = () => {
            document.querySelectorAll('.pro-takeoff-group').forEach(el => {
                el.classList.remove('is-dragging-group', 'pro-drag-over-group', 'pro-drag-over-group-before', 'pro-drag-over-group-after');
            });
        };
        const beginGroupDrag = (groupId, sourceEl, event) => {
            if (!groupId || takeoffState.query) { event.preventDefault(); return; }
            draggedTakeoffGroupId = String(groupId);
            draggedTakeoffLayerId = null;
            draggedGroupInsertAfter = false;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', draggedTakeoffGroupId);
            event.dataTransfer.setData('application/x-takeoff-group', draggedTakeoffGroupId);
            sourceEl?.setAttribute('aria-grabbed', 'true');
            const groupContainer = document.querySelector(`.pro-takeoff-group[data-group-id="${draggedTakeoffGroupId}"]`);
            if (groupContainer) groupContainer.classList.add('is-dragging-group');
        };
        const endGroupDrag = (sourceEl) => {
            sourceEl?.removeAttribute('aria-grabbed');
            clearGroupDragMarkers();
            draggedTakeoffGroupId = null;
        };

        document.querySelectorAll('[data-takeoff-group-row]').forEach(row => {
            row.addEventListener('click', event => {
                if (event.target.closest('button, input')) return;
                toggleGroupSelection(row.dataset.takeoffGroupRow);
            });
            row.addEventListener('keydown', event => {
                if (event.target.closest('input, textarea, select, button')) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleGroupSelection(row.dataset.takeoffGroupRow);
            });
            row.addEventListener('dragstart', event => {
                if (event.target.closest('[data-group-toggle], button, input')) {
                    if (!event.target.closest('[data-group-toggle]')) {
                        event.preventDefault();
                    }
                    return;
                }
                beginGroupDrag(row.dataset.takeoffGroupRow, row, event);
            });
            row.addEventListener('dragend', () => endGroupDrag(row));
        });
        document.querySelectorAll('[data-group-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (suppressNextGroupToggle) { suppressNextGroupToggle = false; return; }
                const group = findGroup(button.dataset.groupToggle);
                if (!group) return;
                group.isExpanded = group.isExpanded === false;
                saveTakeoffState({ skipEstimatingSync: true, suppressDirty: true, debounceLocalSave: true });
                renderTakeoffPanel();
            });
            button.addEventListener('dragstart', event => {
                event.stopPropagation();
                beginGroupDrag(button.dataset.groupToggle, button, event);
            });
            button.addEventListener('dragend', () => endGroupDrag(button));
        });
        document.querySelectorAll('.pro-takeoff-group[data-group-id]').forEach(container => {
            container.addEventListener('dragover', event => {
                const targetGroupId = container.dataset.groupId;
                if (draggedTakeoffGroupId && !takeoffState.query) {
                    if (String(targetGroupId) === String(draggedTakeoffGroupId)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    const rect = container.getBoundingClientRect();
                    draggedGroupInsertAfter = event.clientY > (rect.top + rect.height / 2);
                    document.querySelectorAll('.pro-takeoff-group').forEach(el => {
                        if (el !== container) el.classList.remove('pro-drag-over-group-before', 'pro-drag-over-group-after');
                    });
                    container.classList.toggle('pro-drag-over-group-before', !draggedGroupInsertAfter);
                    container.classList.toggle('pro-drag-over-group-after', draggedGroupInsertAfter);
                } else if (draggedTakeoffLayerId && !takeoffState.query) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    container.classList.add('pro-drag-over-group');
                }
            });
            container.addEventListener('dragleave', event => {
                if (event.relatedTarget && container.contains(event.relatedTarget)) return;
                container.classList.remove('pro-drag-over-group', 'pro-drag-over-group-before', 'pro-drag-over-group-after');
            });
            container.addEventListener('drop', event => {
                event.preventDefault();
                const insertAfter = container.classList.contains('pro-drag-over-group-after') || draggedGroupInsertAfter;
                clearGroupDragMarkers();
                const targetGroupId = container.dataset.groupId;
                if (draggedTakeoffGroupId) {
                    const sourceId = draggedTakeoffGroupId || event.dataTransfer.getData('text/plain');
                    if (sourceId && targetGroupId && sourceId !== targetGroupId) reorderTakeoffGroup(sourceId, targetGroupId, insertAfter);
                    suppressNextGroupToggle = true;
                    setTimeout(() => { suppressNextGroupToggle = false; }, 0);
                    draggedTakeoffGroupId = null;
                } else if (draggedTakeoffLayerId) {
                    moveTakeoffLayerToGroup(draggedTakeoffLayerId, targetGroupId);
                    draggedTakeoffLayerId = null;
                }
            });
        });

        document.querySelector('[data-measurements-toggle]')?.addEventListener('click', event => {
            event.stopPropagation();
            takeoffRulersState.isExpanded = takeoffRulersState.isExpanded === false;
            renderTakeoffPanel();
        });
        document.querySelector('[data-measurements-all-visibility]')?.addEventListener('click', event => {
            event.stopPropagation();
            const anyVisible = (takeoffRulersState.items || []).some(r => !r.hidden);
            callEditor('setAllKonvaRulersVisibility', !anyVisible);
        });
        document.querySelectorAll('[data-measurement-visibility]').forEach(btn => {
            btn.addEventListener('click', event => {
                event.stopPropagation();
                const id = btn.dataset.measurementVisibility;
                const found = (takeoffRulersState.items || []).find(r => String(r.id || '') === String(id));
                callEditor('setKonvaRulerVisibility', id, Boolean(found?.hidden));
            });
        });
        document.querySelectorAll('[data-measurement-row]').forEach(row => {
            row.addEventListener('click', event => {
                if (event.target.closest('button')) return;
                callEditor('selectKonvaRulerById', row.dataset.measurementRow);
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

                const prevDraggable = row ? row.getAttribute('draggable') : null;
                if (row) row.draggable = false;

                nameSpan.replaceWith(input);
                input.focus();
                input.select();

                let committed = false;
                const commit = (save) => {
                    if (committed) return;
                    committed = true;
                    document.removeEventListener('pointerdown', handleOutside, true);
                    document.removeEventListener('mousedown', handleOutside, true);
                    if (row && row.isConnected) {
                        row.draggable = prevDraggable !== 'false';
                    }
                    const val = input.value.trim().replace(/\s+/g, ' ');
                    if (save && val && val !== currentName) {
                        if (applyTakeoffGroupRename(group, val)) {
                            showTakeoffToast?.('Group renamed.');
                        } else {
                            renderTakeoffPanel();
                        }
                    } else {
                        renderTakeoffPanel();
                    }
                };

                const handleOutside = (e) => {
                    if (e.target !== input && !input.contains(e.target)) {
                        commit(true);
                    }
                };

                setTimeout(() => {
                    if (!committed && input.isConnected) {
                        document.addEventListener('pointerdown', handleOutside, true);
                        document.addEventListener('mousedown', handleOutside, true);
                    }
                }, 50);

                input.addEventListener('dragstart', e => {
                    e.preventDefault();
                    e.stopPropagation();
                });
                input.addEventListener('keydown', e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation?.();
                        commit(true);
                        return;
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation?.();
                        commit(false);
                        return;
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
                const isCurrentlyActive = (String(takeoffState.activeLayerId || '') === String(layerId)) &&
                    (selectionState.selectedLayerIds.length === 1 && String(selectionState.selectedLayerIds[0]) === String(layerId));
                if (isCurrentlyActive) {
                    clearAllSelections();
                    return;
                }
                selectSingleLayer(layerId);
                const drawerModal = $('takeoffLayerModal');
                const drawerWorkspace = $('takeoffWorkspace');
                if (drawerModal && !drawerModal.hidden && drawerWorkspace?.classList.contains('has-layer-drawer') && String(takeoffState.editingLayerId || '') !== String(layerId)) {
                    const menuBtn = document.querySelector(`[data-layer-menu="${CSS.escape ? CSS.escape(layerId) : layerId}"]`);
                    openLayerModal(layer?.groupId, layerId, menuBtn);
                }
            });

            row.addEventListener('dragover', event => {
                if (!draggedTakeoffLayerId || takeoffState.query || row.dataset.layerRow === draggedTakeoffLayerId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                row.classList.add('pro-drag-over-layer');
            });

            row.addEventListener('dragleave', event => {
                if (event.relatedTarget && row.contains(event.relatedTarget)) return;
                row.classList.remove('pro-drag-over-layer');
            });

            row.addEventListener('drop', event => {
                if (!draggedTakeoffLayerId || takeoffState.query) return;
                event.preventDefault();
                row.classList.remove('pro-drag-over-layer');
                const targetLayerId = row.dataset.layerRow;
                if (draggedTakeoffLayerId && targetLayerId && draggedTakeoffLayerId !== targetLayerId) {
                    moveTakeoffLayer(draggedTakeoffLayerId, targetLayerId);
                }
                draggedTakeoffLayerId = null;
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
                const menu = $('takeoffGroupContextMenu');
                const isOpen = menu && menu.style.display !== 'none' && takeoffState.contextGroupId === groupId;
                closeGroupContextMenu();
                closeLayerModal();
                if (isOpen) return;
                openGroupContextMenu(groupId, button);
            });
        });
        document.querySelectorAll('[data-layer-menu]').forEach(button => {
            button.addEventListener('dragstart', event => {
                if (takeoffState.query) { event.preventDefault(); return; }
                draggedTakeoffLayerId = button.dataset.layerMenu;
                isDraggingTakeoffLayer = true;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', draggedTakeoffLayerId);
                event.dataTransfer.setData('application/x-takeoff-layer', draggedTakeoffLayerId);
                const row = button.closest('[data-layer-row]');
                if (row) {
                    row.classList.add('is-dragging-row');
                }
            });

            button.addEventListener('dragend', () => {
                isDraggingTakeoffLayer = false;
                takeoffLayerDragSuppressedClickTime = Date.now();
                document.querySelectorAll('.is-dragging-row').forEach(el => el.classList.remove('is-dragging-row'));
                document.querySelectorAll('.pro-drag-over-layer, .pro-drag-over-group').forEach(el => {
                    el.classList.remove('pro-drag-over-layer', 'pro-drag-over-group');
                });
                setTimeout(() => { draggedTakeoffLayerId = null; }, 60);
            });

            button.addEventListener('click', event => {
                event.stopPropagation();
                if (isDraggingTakeoffLayer || (Date.now() - takeoffLayerDragSuppressedClickTime < 350)) {
                    return;
                }
                const layerId = button.dataset.layerMenu;
                const modal = $('takeoffLayerModal');
                const workspace = $('takeoffWorkspace');
                const isOpen = modal && !modal.hidden && workspace?.classList.contains('has-layer-drawer') && takeoffState.editingLayerId === layerId;
                closeGroupContextMenu();
                if (isOpen) {
                    void layerModalController.commit();
                    return;
                }
                const layer = findLayer(layerId);
                openLayerModal(layer?.groupId, layerId, button);
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

        const seeded = seedGroupsFromProjectLayers();
        if (seeded.length > 0) {
            takeoffState.groups = normalizeSavedGroups(seeded);
        } else if (Array.isArray(storedGroups)) {
            takeoffState.groups = normalizeSavedGroups(storedGroups);
        } else if (!isTemplateProject) {
            takeoffState.groups = [defaultGroup(activeEstimateId())];
        } else {
            takeoffState.groups = [];
        }
        scopeLegacyTakeoffGroupsOnce();
        ensureEstimateTakeoffWorkspace();
        takeoffState.activeLayerId = null;
        takeoffState.canvasSnapshots = {};
        const dbDrawingStates = Array.isArray(window.ProjectState?.takeoffDrawingStates)
            ? window.ProjectState.takeoffDrawingStates
            : [];
        dbDrawingStates.forEach(snap => {
            const estId = String(snap?.estimateId || snap?.estimateKey || '').trim();
            const docId = Number(snap?.drawingId || snap?.documentId || 0);
            if (!estId || docId <= 0 || !Array.isArray(snap?.layers)) return;
            takeoffState.canvasSnapshots[`${estId}:${docId}`] = {
                ...snap,
                estimateId: estId,
                documentId: String(docId),
                drawingId: docId
            };
        });
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
        if (!takeoffState.activeEstimateId || takeoffState.activeEstimateId === 'est_primary') {
            takeoffState.activeEstimateId = activeEstimateId();
        }
        renderTakeoffPanel();
        renderActiveLayerToolbar();
        syncTakeoffToEstimating();
    }

    const layerModalController = window.TakeoffLayerModalController.create({
        dom: { getElement: $ },
        state: { takeoffState },
        constants: {
            TAKEOFF_TYPES, TAKEOFF_SYMBOLS, TAKEOFF_SIZES, TAKEOFF_RICH_COLORS,
            TAKEOFF_UOMS, TAKEOFF_TYPE_HELP
        },
        presentation: {
            setupTypeDropdown, setupUomDropdown, setupSymbolDropdown, setupSizeDropdown,
            setupColorDropdown, filterUomDropdownByType, updateTypeDropdownTrigger,
            updateUomDropdownTrigger, updateSymbolDropdownTrigger, updateSizeDropdownTrigger,
            updateColorDropdownTrigger, setSelectValue, takeoffDisplaySymbol,
            takeoffDisplaySize, takeoffSizeRadius, esc, renderCatalogPill, quantityLabel,
            itemQuantitySubtitle, getLayerBadgeSvg, renderLayerBadgeHtml,
            updateCatalogSelectionIndicator, renderTakeoffPanel, renderActiveLayerToolbar,
            updateSubheadSelectedItem, notifyEditorVisible
        },
        domain: {
            openCatalogModal, ensureCatalogModal, deleteLayer, duplicateLayer, toggleLayerLock,
            findLayer, findGroup, allLayers, layerBelongsToEstimate, groupBelongsToEstimate,
            activeEstimateId, typeToUom, defaultUomForType, isUomValidForType,
            needsTakeoffTypeChangeWarning, confirmTakeoffTypeChange,
            getLayerEstimatingOverride, ensureEstimateTakeoffWorkspace, catalogItemMeta,
            makeId, clearLayerCachedStateOnTypeChange, setActiveTakeoffLayer,
            syncAllLayersToCanvas, syncTakeoffFromCanvasSnapshot, invalidateTakeoffSheetSummary, showPrepared
        },
        persistence: {
            canWrite, requireWrite, callEditor, pushTakeoffHistory, saveTakeoffState
        }
    });

    function ensureTakeoffModal() { return layerModalController.ensure(); }
    function openLayerModal(...args) { return layerModalController.open(...args); }
    function closeLayerModal() { return layerModalController.close(); }
    function repositionLayerModal() { return layerModalController.reposition(); }
    function setLayerColor(...args) { return layerModalController.setColor(...args); }
    function switchLayerModalTab(...args) { return layerModalController.switchTab(...args); }
    function updateLayerTypeIcon() { return layerModalController.updateTypeIcon(); }
    function updateLayerStrokePreview() { return layerModalController.updateStrokePreview(); }
    function updateAssociatedCatalogCard(...args) { return layerModalController.updateAssociatedCatalogCard(...args); }
    function updateLayerDrawingsList(...args) { return layerModalController.updateDrawingsList(...args); }
    function updateLayerTypeFields(...args) { return layerModalController.updateTypeFields(...args); }
    function updateLayerColorSwatch() { return layerModalController.updateColorSwatch(); }
    function updateLayerSubmitState() { return layerModalController.updateSubmitState(); }
    function patchTakeoffLayerRowQuantityDom(...args) { return layerModalController.patchLayerQuantity(...args); }
    function patchAllTakeoffLayerQuantityDom() { return layerModalController.patchAllQuantities(); }
    function refreshTakeoffLayerRowDom(...args) { return layerModalController.refreshLayerRow(...args); }
    function getLayerModalActiveFormType() { return layerModalController.getActiveFormType(); }
    function setLayerModalActiveFormType(type) { return layerModalController.setActiveFormType(type); }

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
                    <div class="pro-create-added-items-wrap" id="createLayerAddedItemsWrap" style="display:none;"></div>
                    <div class="pro-create-layer-field" style="display:none;">
                        <label for="createLayerGroup">Target Group</label>
                        <div class="pro-create-control-box" style="width:100%;">
                            <select id="createLayerGroup" class="form-select">
                            </select>
                        </div>
                    </div>
                    <div class="pro-create-layer-field">
                        <label for="createLayerCatalogName">Takeoff Layer Name</label>
                        <div class="pro-create-catalog-row">
                            <input id="createLayerCatalogName" type="text" placeholder="Enter layer name or pick items from catalog...">
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
                                    <select id="createLayerType" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
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
                                    <select id="createLayerUom" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
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
                                    <select id="createLayerSymbol" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
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
                                    <select id="createLayerSize" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
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
                                    <select id="createLayerColor" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
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
                    <button type="button" class="pro-btn-create-submit" id="createLayerSubmitBtn" data-keyboard-accept>Create</button>
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
            updateActiveAddedItemFromForm();
        });

        $('createLayerUom')?.addEventListener('change', () => {
            updateUomDropdownTrigger('createLayer', $('createLayerUom').value);
            updateActiveAddedItemFromForm();
        });

        $('createLayerSymbol')?.addEventListener('change', (e) => {
            updateSymbolDropdownTrigger('createLayer', e.target.value);
            updateActiveAddedItemFromForm();
        });

        $('createLayerSize')?.addEventListener('change', (e) => {
            updateSizeDropdownTrigger('createLayer', e.target.value);
            updateActiveAddedItemFromForm();
        });

        $('createLayerCatalogName')?.addEventListener('input', () => {
            updateActiveAddedItemFromForm();
            updateCreateLayerSubmitState();
        });

        $('createLayerCatalogName')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitCreateLayerModal();
            }
        });

        modal.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
            if (!e.target?.matches?.('input, select')) return;
            if (modal.querySelector('.pro-custom-dropdown.is-open')) return;
            e.preventDefault();
            submitCreateLayerModal();
        });

        $('createLayerColor')?.addEventListener('change', (e) => {
            if (e.target.value === '__custom__') {
                $('createLayerCustomColorPicker')?.click();
            } else {
                setCreateLayerColor(e.target.value);
            }
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
        if (!requireWrite()) return false;
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
        takeoffState.pendingCatalogItems = [];
        takeoffState.activeAddedItemId = null;
        renderCreateLayerAddedItems();

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

        closeAllProCustomDropdowns();
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
        const isCount = type === 'Count';
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
        if (swatch) {
            swatch.dataset.hexColor = hex;
            swatch.style.background = hex;
        }
        if (select) {
            let match = Array.from(select.options).find(o => o.value.toLowerCase() === hex.toLowerCase());
            if (match) select.value = match.value;
            else select.value = '__custom__';
        }
        updateColorDropdownTrigger('createLayer', hex);
        updateActiveAddedItemFromForm();
    }

    function updateCreateLayerSubmitState() {
        const val = $('createLayerCatalogName')?.value.trim();
        const items = takeoffState.pendingCatalogItems || [];
        const hasItems = items.length > 0;
        const submit = $('createLayerSubmitBtn');
        if (submit) {
            submit.classList.toggle('is-active', Boolean(val || hasItems));
            if (items.length > 1) {
                submit.textContent = `Create (${items.length} layers)`;
            } else {
                submit.textContent = 'Create';
            }
        }
    }

    function submitCreateLayerModal() {

        if (!requireWrite()) return false;










        const items = takeoffState.pendingCatalogItems || [];

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
        if (!Array.isArray(group.layers)) group.layers = [];

        if (items.length > 0) {
            updateActiveAddedItemFromForm();

            const createdLayers = [];
            for (const it of items) {
                const layerName = it.customName || it.name || 'Catalog Item';
                const itemType = it.type || 'Count';
                const itemUom = it.uom || typeToUom(itemType);
                const itemSymbol = it.symbol || 'Solid Circle';
                const itemSize = it.size || 'Medium';
                const itemColor = it.color || '#00d2ff';
                const strokeWidth = itemType.includes('Area') ? 2 : 2.5;
                const radius = takeoffSizeRadius(itemSize);
                const tag = $('createLayerTag')?.value.trim() || '';

                const newLayer = {
                    id: makeId('layer'),
                    groupId: group.id,
                    estimateId: activeEstimateId(),
                    name: layerName,
                    tag: tag,
                    costCode: it.supplier?.catalogNumber || it.classification?.costCode || '',
                    metadata_json: {
                        tag,
                        catalog_item: {
                            id: it.id,
                            name: it.name,
                            unitCost: getCatalogItemUnitCost(it),
                            laborHours: getCatalogItemLaborHours(it),
                            uom: itemUom,
                            catalog: it.catalog,
                            category: it.category
                        }
                    },
                    catalogItemId: it.id,
                    catalog_item_id: it.id,
                    unitCost: getCatalogItemUnitCost(it),
                    unit_cost: getCatalogItemUnitCost(it),
                    laborHours: getCatalogItemLaborHours(it),
                    labor_hours: getCatalogItemLaborHours(it),
                    pricing: {
                        unitCost: getCatalogItemUnitCost(it),
                        laborHoursPerUnit: getCatalogItemLaborHours(it)
                    },
                    catalog: it.catalog,
                    category: it.category?.name || it.category,
                    type: itemType,
                    uom: itemUom,
                    symbol: itemSymbol,
                    size: itemSize,
                    markerDiameter: radius * 2,
                    strokeWidth,
                    color: itemColor,
                    quantity: 0,
                    baseQuantity: 0,
                    dropLength: 0,
                    spacing: 0,
                    height: 0,
                    depth: 0,
                    shapes: [],
                    takeoffObjects: []
                };

                try {
                    const meta = catalogItemMeta(it);
                    Object.assign(newLayer, meta);
                    newLayer.name = layerName;
                    newLayer.tag = tag;
                    newLayer.type = itemType;
                    newLayer.uom = itemUom;
                    newLayer.symbol = itemSymbol;
                    newLayer.size = itemSize;
                    newLayer.color = itemColor;
                } catch (e) { }

                group.layers.push(newLayer);
                createdLayers.push(newLayer);
            }

            pushTakeoffHistory('create-layer');
            group.isExpanded = true;
            takeoffState.activeGroupId = group.id;

            closeCreateLayerModal();
            if (createdLayers.length) {
                setActiveTakeoffLayer(createdLayers[0].id, true);
            }
            saveTakeoffState();
            renderTakeoffPanel();
            showPrepared(createdLayers.length === 1
                ? `Takeoff layer "${createdLayers[0].name}" created.`
                : `${createdLayers.length} takeoff layers added to "${group.name}".`);
            return;
        }

        let name = $('createLayerCatalogName')?.value.trim();
        if (!name) return closeCreateLayerModal();

        const type = $('createLayerType')?.value || 'Count';
        const uom = $('createLayerUom')?.value || typeToUom(type);
        const symbol = $('createLayerSymbol')?.value || 'Solid Circle';
        const size = $('createLayerSize')?.value || 'Medium';






        const color = $('createLayerColorSwatch')?.style.background || '#00d2ff';
        const strokeWidth = type.includes('Area') ? 2 : 2.5;
        const radius = takeoffSizeRadius(size);
        const tag = $('createLayerTag')?.value.trim() || '';

        const newLayer = {
            id: makeId('layer'),
            groupId: group.id,
            estimateId: activeEstimateId(),
            name,
            tag,
            costCode: '',
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

    function getActiveAddedItem() {
        if (!takeoffState.activeAddedItemId || !takeoffState.pendingCatalogItems) return null;
        return takeoffState.pendingCatalogItems.find(it => String(it.id) === String(takeoffState.activeAddedItemId)) || null;
    }

    function updateActiveAddedItemFromForm() {
        const activeItem = getActiveAddedItem();
        if (!activeItem) return;

        const nameVal = $('createLayerCatalogName')?.value.trim();
        if (nameVal) activeItem.customName = nameVal;
        activeItem.type = $('createLayerType')?.value || activeItem.type || 'Count';
        activeItem.uom = $('createLayerUom')?.value || activeItem.uom || 'ea';
        activeItem.symbol = $('createLayerSymbol')?.value || activeItem.symbol || 'Solid Circle';
        activeItem.size = $('createLayerSize')?.value || activeItem.size || 'Medium';
        const swatchColor = $('createLayerColorSwatch')?.dataset?.hexColor;
        const selectColor = ($('createLayerColor')?.value && $('createLayerColor').value !== '__custom__') ? $('createLayerColor').value : '';
        activeItem.color = swatchColor || selectColor || activeItem.color || '#00d2ff';

        updateActiveItemRowPreview(activeItem);
    }

    function updateActiveItemRowPreview(item) {
        if (!item) return;
        const id = String(item.id);
        const titleEl = document.querySelector(`[data-item-title="${id}"]`);
        if (titleEl) titleEl.textContent = item.customName || item.name;

        const badgeWrap = document.querySelector(`[data-item-badge-wrap="${id}"]`);
        if (badgeWrap) badgeWrap.innerHTML = getLayerBadgeSvg(item, 18);

        const colorTag = document.querySelector(`[data-item-color-tag="${id}"]`);
        if (colorTag) {
            colorTag.innerHTML = `
                <span class="pro-color-dot-inline" style="background:${esc(item.color)};"></span>
                <strong class="tag-val" style="font-family:monospace; font-size:11px;">${esc(item.color)}</strong>
            `;
        }

        const typeTag = document.querySelector(`[data-item-type-tag="${id}"] .tag-val`);
        if (typeTag) typeTag.textContent = item.type;
    }

    function syncFormWithActiveAddedItem() {
        const activeItem = getActiveAddedItem();
        if (!activeItem) return;

        const nameInput = $('createLayerCatalogName');
        if (nameInput) nameInput.value = activeItem.customName || activeItem.name || '';

        const type = activeItem.type || 'Count';
        if ($('createLayerType')) $('createLayerType').value = type;
        updateCreateLayerTypeUi(type);

        const uom = activeItem.uom || defaultUomForType(type);
        if ($('createLayerUom')) $('createLayerUom').value = uom;
        updateUomDropdownTrigger('createLayer', uom);

        const symbol = activeItem.symbol || 'Solid Circle';
        if ($('createLayerSymbol')) $('createLayerSymbol').value = symbol;
        updateSymbolDropdownTrigger('createLayer', symbol);

        const size = activeItem.size || 'Medium';
        if ($('createLayerSize')) $('createLayerSize').value = size;
        updateSizeDropdownTrigger('createLayer', size);

        const color = activeItem.color || '#00d2ff';
        const swatch = $('createLayerColorSwatch');
        const select = $('createLayerColor');
        if (swatch) {
            swatch.dataset.hexColor = color;
            swatch.style.background = color;
        }
        if (select) {
            let match = Array.from(select.options).find(o => o.value.toLowerCase() === color.toLowerCase());
            if (match) select.value = match.value;
            else select.value = '__custom__';
        }
        updateColorDropdownTrigger('createLayer', color);

        const wrap = $('createLayerAddedItemsWrap');
        if (wrap) {
            wrap.querySelectorAll('.pro-create-added-item-row').forEach(row => {
                const isThis = String(row.dataset.addedItemId) === String(activeItem.id);
                row.classList.toggle('is-active-item', isThis);
                const badge = row.querySelector('.pro-added-item-editing-badge');
                if (badge) badge.classList.toggle('is-hidden', !isThis);
            });
        }
        updateCreateLayerSubmitState();
    }

    function renderCreateLayerAddedItems() {
        const wrap = $('createLayerAddedItemsWrap');
        if (!wrap) return;
        const items = takeoffState.pendingCatalogItems || [];
        if (!items.length) {
            wrap.innerHTML = '';
            wrap.style.display = 'none';
            takeoffState.activeAddedItemId = null;
            return;
        }
        if (!takeoffState.activeAddedItemId && items.length > 0) {
            takeoffState.activeAddedItemId = String(items[0].id);
        }
        wrap.style.display = 'flex';
        wrap.innerHTML = `
            <div class="pro-create-added-items-header">
                <span class="pro-create-added-title">
                    <i class="fas fa-boxes-stacked"></i>
                    Selected Items (${items.length})
                    <span style="font-size:10.5px;font-weight:normal;opacity:0.85;margin-left:4px;">(Click an item to configure its color & properties)</span>
                </span>
                <button type="button" class="pro-create-clear-items-btn" id="createLayerClearItemsBtn">Clear all</button>
            </div>
            <div class="pro-create-added-items-list">
                ${items.map(item => {
            const isActive = String(item.id) === String(takeoffState.activeAddedItemId);
            const isAssembly = item.type === 'assembly';
            const unitCost = getCatalogItemUnitCost(item);
            const laborHours = getCatalogItemLaborHours(item);
            const costStr = unitCost > 0 ? `$${unitCost.toFixed(2)}` : '$0.00';
            const laborStr = laborHours > 0 ? `${laborHours % 1 === 0 ? laborHours.toFixed(0) : laborHours.toFixed(2)} hrs` : '0.00 hrs';
            const catalogName = item.catalog?.name || '';
            const catalogId = item.catalog?.id || '';
            const groupName = item.category?.name || '';
            const groupId = item.category?.id || '';
            const code = item.supplier?.catalogNumber || item.classification?.costCode || 'n/a';
            return `
                        <div class="pro-create-added-item-row ${isActive ? 'is-active-item' : ''}" data-added-item-id="${esc(item.id)}">
                            <div class="pro-create-item-badge-wrap" data-item-badge-wrap="${esc(item.id)}">
                                ${getLayerBadgeSvg(item, 18)}
                            </div>
                            <div class="pro-catalog-item-content">
                                <div class="pro-catalog-item-top">
                                    <span class="pro-catalog-item-title" data-item-title="${esc(item.id)}">${esc(item.customName || item.name)}</span>
                                    ${isAssembly ? '<span class="cc-type-badge assembly"><i class="fas fa-boxes-stacked"></i> Assembly</span>' : ''}
                                    <span class="pro-added-item-editing-badge ${isActive ? '' : 'is-hidden'}" data-item-editing="${esc(item.id)}"><i class="fas fa-pen"></i> Editing</span>
                                </div>
                                ${item.description ? `<div class="pro-catalog-item-desc">${esc(item.description)}</div>` : ''}
                                <div class="pro-catalog-item-details-row">
                                    <span class="pro-cat-info-tag tag-color" data-item-color-tag="${esc(item.id)}" title="Assigned Color">
                                        <span class="pro-color-dot-inline" style="background:${esc(item.color)};"></span>
                                        <strong class="tag-val" style="font-family:monospace; font-size:11px;">${esc(item.color)}</strong>
                                    </span>
                                    <span class="pro-cat-info-tag tag-type" data-item-type-tag="${esc(item.id)}" title="Layer Type">
                                        <span class="tag-label">Type:</span>
                                        <strong class="tag-val">${esc(item.type)}</strong>
                                    </span>
                                    <span class="pro-cat-info-tag tag-price" title="Unit Cost">
                                        <i class="fas fa-tag"></i>
                                        <span class="tag-label">Price:</span>
                                        <strong class="tag-val">${costStr}</strong>
                                        <span class="tag-uom">/ ${esc(item.uom || 'ea')}</span>
                                    </span>
                                    <span class="pro-cat-info-tag tag-labor" title="Labor Time">
                                        <i class="far fa-clock"></i>
                                        <span class="tag-label">Labor:</span>
                                        <strong class="tag-val">${laborStr}</strong>
                                    </span>
                                    ${renderCatalogPill(catalogName, catalogId)}
                                    ${groupName ? renderGroupPill(groupName, groupId, catalogId) : ''}
                                </div>
                            </div>
                            <button type="button" class="pro-create-item-remove-btn" data-remove-item="${esc(item.id)}" title="Remove item">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `;
        }).join('')}
            </div>
        `;

        wrap.querySelectorAll('.pro-create-added-item-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('[data-remove-item]')) return;
                const id = row.dataset.addedItemId;
                takeoffState.activeAddedItemId = id;
                syncFormWithActiveAddedItem();
            });
        });

        function resetCreateLayerFormToDefaults() {
            takeoffState.pendingCatalogItems = [];
            takeoffState.pendingCatalogItem = null;
            takeoffState.activeAddedItemId = null;
            const nameInput = $('createLayerCatalogName');
            if (nameInput) nameInput.value = '';
            if ($('createLayerType')) $('createLayerType').value = 'Count';
            if ($('createLayerUom')) $('createLayerUom').value = 'ea';
            if ($('createLayerSymbol')) $('createLayerSymbol').value = 'Solid Circle';
            if ($('createLayerSize')) $('createLayerSize').value = 'Medium';
            setCreateLayerColor('#00d2ff');
            updateCreateLayerTypeUi('Count');
            const symCol = $('createLayerSymbolCol');
            const sizeCol = $('createLayerSizeCol');
            const uomCol = $('createLayerUomCol');
            const colCol = $('createLayerColorCol');
            if (symCol) symCol.style.display = '';
            if (sizeCol) sizeCol.style.display = '';
            if (uomCol) uomCol.style.display = '';
            if (colCol) colCol.style.display = '';
            updateTypeDropdownTrigger('createLayer', 'Count');
            updateUomDropdownTrigger('createLayer', 'ea');
            updateSymbolDropdownTrigger('createLayer', 'Solid Circle');
            updateSizeDropdownTrigger('createLayer', 'Medium');
            updateCreateLayerSubmitState();
        }

        wrap.querySelectorAll('[data-remove-item]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.removeItem;
                takeoffState.pendingCatalogItems = (takeoffState.pendingCatalogItems || []).filter(it => String(it.id) !== String(id));
                if (!takeoffState.pendingCatalogItems.length) {
                    resetCreateLayerFormToDefaults();
                    renderCreateLayerAddedItems();
                    return;
                }
                if (String(takeoffState.activeAddedItemId) === String(id)) {
                    takeoffState.activeAddedItemId = takeoffState.pendingCatalogItems[0]?.id ? String(takeoffState.pendingCatalogItems[0].id) : null;
                }
                takeoffState.pendingCatalogItem = takeoffState.pendingCatalogItems[0] || null;
                renderCreateLayerAddedItems();
                syncFormWithActiveAddedItem();
                updateCreateLayerSubmitState();
            });
        });

        $('createLayerClearItemsBtn')?.addEventListener('click', () => {
            resetCreateLayerFormToDefaults();
            renderCreateLayerAddedItems();
        });
    }

    function assignDistinctCatalogColors(items, groupId = null) {
        if (!Array.isArray(items) || !items.length) return;
        const palette = TAKEOFF_RICH_COLORS;
        const normHex = (val) => {
            if (window.TakeoffColorPalette?.normalizeHex) {
                return window.TakeoffColorPalette.normalizeHex(val);
            }
            const raw = String(val || '').trim().toLowerCase();
            return /^#[0-9a-f]{6}$/.test(raw) ? raw : '';
        };
        const targetGroup = findGroupExact(groupId) || findGroup(groupId)
            || takeoffState.groups.find(g => groupBelongsToEstimate(g, activeEstimateId()));
        const existingGroupColors = new Set(
            (targetGroup?.layers || []).map(l => normHex(l?.color)).filter(Boolean)
        );
        const batchColors = new Set();
        const pickNextColor = (startIndex = 0) => {
            for (let pass = 0; pass < 2; pass++) {
                for (let offset = 0; offset < palette.length; offset++) {
                    const candidate = palette[(startIndex + offset) % palette.length];
                    const norm = normHex(candidate) || candidate.toLowerCase();
                    if (batchColors.has(norm)) continue;
                    if (pass === 0 && existingGroupColors.has(norm)) continue;
                    batchColors.add(norm);
                    return candidate;
                }
            }
            const fallback = palette[startIndex % palette.length];
            batchColors.add(normHex(fallback) || fallback.toLowerCase());
            return fallback;
        };

        if (items.length > 1) {
            // Assign distinct sequential colors from our palette across ALL takeoff types
            // whenever more than one catalog item is added at once.
            items.forEach((it, idx) => {
                it.color = pickNextColor(idx);
            });
            return;
        }
        const single = items[0];
        const explicit = normHex(single.color || single.takeoffDefaults?.color);
        single.color = explicit || pickNextColor(0);
    }

    async function applyCatalogItemsToLayerForm(items) {
        if (!Array.isArray(items)) items = items ? [items] : [];
        items.forEach((it) => {
            if (!it.customName) it.customName = it.name || '';
            const mType = String(it.measurement_type || it.measurementType || '').toLowerCase();
            const uomRaw = String(it.unit_of_measure || it.uom || '').toLowerCase();
            let takeoffType = 'Count';
            if (mType === 'linear' || ['ft', 'lf', 'linear ft', 'linear feet', 'feet', 'foot', 'm', 'lm'].includes(uomRaw)) {
                takeoffType = 'Linear';
            } else if (mType === 'area' || mType === 'volume' || ['sq ft', 'sf', 'sqft', 'ft2', 'm2', 'sqm', 'sq m', 'cu yd', 'cy', 'cu ft'].includes(uomRaw)) {
                takeoffType = 'Area / Volume';
            } else if (mType === 'count' || ['ea', 'each', 'unit', 'units', 'pcs', 'piece', 'pieces'].includes(uomRaw)) {
                takeoffType = 'Count';
            } else if (it.takeoff_type && TAKEOFF_TYPES.includes(it.takeoff_type)) {
                takeoffType = it.takeoff_type;
            } else if (it.type && TAKEOFF_TYPES.includes(it.type)) {
                takeoffType = it.type;
            } else {
                takeoffType = inferTakeoffTypeFromUom(it.unit_of_measure || it.uom) || 'Count';
            }
            it.type = takeoffType;
            it.uom = it.unit_of_measure || it.uom || defaultUomForType(takeoffType);
            if (!it.symbol) it.symbol = it.takeoffDefaults?.symbol || it.symbol || 'Solid Circle';
            if (!it.size) it.size = it.takeoffDefaults?.size || 'Medium';
        });

        const createModal = $('takeoffCreateLayerModal');
        const inCreateFlow = Boolean(createModal && !createModal.hidden);
        const targetGroupId = inCreateFlow
            ? ($('createLayerGroup')?.value || takeoffState.pendingCreateGroupId || takeoffState.activeGroupId)
            : (takeoffState.pendingLayerGroupId || takeoffState.activeGroupId);
        assignDistinctCatalogColors(items, targetGroupId);

        if (!inCreateFlow && items.length && takeoffState.editingLayerId) {
            const editingLayer = findLayer(takeoffState.editingLayerId);
            const inferred = items[0].type;
            const prevType = getLayerModalActiveFormType() || editingLayer?.type || 'Count';
            if (editingLayer && inferred && needsTakeoffTypeChangeWarning(prevType, inferred)) {
                const confirmed = await confirmTakeoffTypeChange({ layer: editingLayer, prevType, nextType: inferred });
                if (!confirmed) return false;
            }
        }

        takeoffState.pendingCatalogItems = items;
        if (items[0]) items[0]._fromCatalogPicker = true;
        takeoffState.pendingCatalogItem = items[0] || null;
        takeoffState.activeAddedItemId = items.length ? String(items[0].id) : null;

        if (inCreateFlow) {
            createModal.classList.remove('is-behind');
            renderCreateLayerAddedItems();
            syncFormWithActiveAddedItem();
            updateCreateLayerSubmitState();
            closeCatalogModal();
            setTimeout(() => $('createLayerCatalogName')?.focus(), 40);
            return true;
        }

        if (items.length) {
            const item = items[0];
            $('layerNameInput').value = item.name || '';
            const inferred = item.type;
            if (inferred) {
                setLayerModalActiveFormType(inferred);
                $('layerTypeInput').value = inferred;
                if ($('layerTypeHelp')) $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[inferred] || TAKEOFF_TYPE_HELP.Count;
                filterUomDropdownByType('editLayer', inferred);
                updateTypeDropdownTrigger('editLayer', inferred);
                updateLayerTypeIcon();
                updateLayerTypeFields(inferred);
            }
            const nextUom = item.uom || defaultUomForType(inferred || $('layerTypeInput')?.value || 'Count') || 'ea';
            setSelectValue($('layerUomInput'), nextUom);
            updateUomDropdownTrigger('editLayer', nextUom);
            const symbol = item.symbol;
            const color = item.color;
            if (symbol && TAKEOFF_SYMBOLS.includes(symbol)) {
                $('layerSymbolInput').value = symbol;
                updateSymbolDropdownTrigger('editLayer', symbol);
            }
            if (color) {
                setLayerColor(color);
            }
            updateAssociatedCatalogCard({
                name: item.name,
                category: item.category || item.catalogName || item.catalog_name || '',
                catalogNumber: item.catalogNumber || item.code || item.catalog_number || '',
                unitCost: item.unitCost ?? item.unit_cost ?? 0,
                laborHours: item.laborHours ?? item.labor_hours ?? 0
            });
            updateCatalogSelectionIndicator();
            updateLayerSubmitState();
        }
        closeCatalogModal();
        setTimeout(() => $('layerNameInput')?.focus(), 40);
        return true;
    }

    function applyCatalogItemToLayerForm(item) {
        return applyCatalogItemsToLayerForm(item ? [item] : []);
    }

    function dismissEmptyLayerModal() {
        return closeLayerModal();
    }

    async function submitLayerModal() {
        return layerModalController.submit();
    }

    const CATALOG_PALETTE = [
        '#2563eb', // Blue
        '#059669', // Emerald
        '#d97706', // Amber
        '#7c3aed', // Purple
        '#db2777', // Pink
        '#0891b2', // Cyan
        '#ea580c', // Orange
        '#4f46e5', // Indigo
        '#16a34a', // Green
        '#0284c7', // Sky
        '#9333ea', // Violet
        '#ca8a04'  // Gold
    ];

    function getCatalogColor(catalogOrName, catalogId) {
        if (typeof catalogOrName === 'object' && catalogOrName !== null) {
            if (catalogOrName.color) return catalogOrName.color;
            const id = catalogOrName.id;
            if (id) {
                return CATALOG_PALETTE[(Number(id) - 1) % CATALOG_PALETTE.length] || CATALOG_PALETTE[0];
            }
            catalogOrName = catalogOrName.name || '';
        }
        if (catalogId) {
            return CATALOG_PALETTE[(Number(catalogId) - 1) % CATALOG_PALETTE.length] || CATALOG_PALETTE[0];
        }
        const str = String(catalogOrName || '');
        if (!str || str === '-') return '#64748b';
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
        return CATALOG_PALETTE[Math.abs(hash) % CATALOG_PALETTE.length];
    }

    function hexToRgba(hex, alpha) {
        if (!hex || typeof hex !== 'string') return `rgba(100, 116, 139, ${alpha})`;
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        if (isNaN(num)) return `rgba(100, 116, 139, ${alpha})`;
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function getDarkerShade(hex) {
        if (!hex || typeof hex !== 'string') return '#1e293b';
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        if (isNaN(num)) return '#1e293b';
        let r = Math.max(0, Math.floor(((num >> 16) & 255) * 0.72));
        let g = Math.max(0, Math.floor(((num >> 8) & 255) * 0.72));
        let b = Math.max(0, Math.floor((num & 255) * 0.72));
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }

    function getGroupColor(groupOrName, groupId, catalogId) {
        let resolvedCatId = catalogId;
        let resolvedCatName = '';
        if (typeof groupOrName === 'object' && groupOrName !== null) {
            resolvedCatId = resolvedCatId || groupOrName.catalog_id || groupOrName.catalogId;
            resolvedCatName = groupOrName.catalog_name || groupOrName.catalogName || '';
        }
        if (!resolvedCatId && groupId) {
            const found = (catalogState.groups || []).find(g => String(g.id) === String(groupId));
            if (found) {
                resolvedCatId = found.catalogId || found.catalog_id;
                resolvedCatName = found.catalogName || '';
            }
        }
        const cat = (catalogState.catalogs || []).find(c => String(c.id) === String(resolvedCatId));
        const catColor = getCatalogColor(cat || resolvedCatName, resolvedCatId);
        return getDarkerShade(catColor);
    }

    function renderCatalogPill(catalogName, catalogId) {
        if (!catalogName || catalogName === '-') return '';
        const color = getCatalogColor(catalogName, catalogId);
        const bgLight = hexToRgba(color, 0.12);
        const borderLight = hexToRgba(color, 0.35);
        const textLight = getDarkerShade(color);
        const bgDark = hexToRgba(color, 0.28);
        const borderDark = hexToRgba(color, 0.60);
        return `
            <span class="cc-catalog-pill" style="--cat-color: ${color}; --cat-bg-light: ${bgLight}; --cat-border-light: ${borderLight}; --cat-text-light: ${textLight}; --cat-bg-dark: ${bgDark}; --cat-border-dark: ${borderDark};" title="Catalog: ${esc(catalogName)}">
                <span class="bb-status-dot" style="background-color: ${color};"></span>
                <span class="bb-status-pill-label">${esc(catalogName)}</span>
            </span>
        `;
    }

    function renderGroupPill(groupName, groupId, catalogId) {
        if (!groupName || groupName === '-') return '';
        const color = getGroupColor(groupName, groupId, catalogId);
        const bgLight = hexToRgba(color, 0.14);
        const borderLight = hexToRgba(color, 0.40);
        const textLight = color;
        const bgDark = hexToRgba(color, 0.30);
        const borderDark = hexToRgba(color, 0.65);
        return `
            <span class="cc-catalog-pill cc-group-pill" style="--cat-color: ${color}; --cat-bg-light: ${bgLight}; --cat-border-light: ${borderLight}; --cat-text-light: ${textLight}; --cat-bg-dark: ${bgDark}; --cat-border-dark: ${borderDark};" title="Group: ${esc(groupName)}">
                <i class="fas fa-folder" style="font-size: 10px; color: ${color};"></i>
                <span class="bb-status-pill-label">${esc(groupName)}</span>
            </span>
        `;
    }

    function getCatalogItemUnitCost(item) {
        if (!item) return 0;
        if (window.TakeoffCatalogAdapter && typeof window.TakeoffCatalogAdapter.legacyUnitCost === 'function') {
            const val = window.TakeoffCatalogAdapter.legacyUnitCost(item);
            if (Number(val) > 0) return Number(val);
        }
        const p = item.pricing || {};
        if (p.unitCost !== undefined && p.unitCost !== null && Number(p.unitCost) > 0) return Number(p.unitCost);
        if (p.materialUnitCost !== undefined && p.materialUnitCost !== null && Number(p.materialUnitCost) > 0) return Number(p.materialUnitCost);
        if (p.equipmentUnitCost !== undefined && p.equipmentUnitCost !== null && Number(p.equipmentUnitCost) > 0) return Number(p.equipmentUnitCost);
        if (p.subcontractorUnitCost !== undefined && p.subcontractorUnitCost !== null && Number(p.subcontractorUnitCost) > 0) return Number(p.subcontractorUnitCost);
        if (p.legacyUnitCost !== undefined && p.legacyUnitCost !== null && Number(p.legacyUnitCost) > 0) return Number(p.legacyUnitCost);
        if (item.unit_cost !== undefined && item.unit_cost !== null) return Number(item.unit_cost) || 0;
        if (item.unitCost !== undefined && item.unitCost !== null) return Number(item.unitCost) || 0;
        return Number(item.cost ?? item.price ?? 0);
    }

    function getCatalogItemLaborHours(item) {
        if (!item) return 0;
        const p = item.pricing || {};
        return Number(p.laborHoursPerUnit ?? item.labor_hours ?? item.laborHours ?? 0);
    }

    const catalogBrowserController = window.TakeoffCatalogBrowser.create({
        getElement: $,
        takeoffState,
        catalogState,
        requireWrite,
        ensureTakeoffModal,
        ensureCatalogModal,
        render: renderCatalogBrowser,
        getCatalogItemUnitCost,
        getCatalogItemLaborHours,
        window
    });
    const browseCatalogState = catalogBrowserController.state;

    function ensureCatalogModal() {
        if ($('takeoffCatalogModal')) return;
        const modal = document.createElement('div');
        modal.id = 'takeoffCatalogModal';
        modal.className = 'pro-modal-backdrop pro-catalog-backdrop';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="pro-browse-catalog-modal" role="dialog" aria-modal="true" aria-labelledby="takeoffCatalogModalTitle">
                <div class="pro-browse-catalog-head">
                    <div class="pro-browse-head-left">
                        <div class="pro-browse-title-row">
                            <h2 id="takeoffCatalogModalTitle" class="pro-browse-title">
                                <i class="fas fa-book-open"></i> Cost Catalog
                            </h2>
                            <div class="pro-browse-context-badges">
                                <span class="cc-context-badge catalog-badge" id="proBrowseCatBadge" title="Current catalog filter">
                                    <i class="fas fa-book"></i>
                                    <span id="proBrowseCatContext">All Catalogs</span>
                                </span>
                                <span class="cc-context-badge group-badge" id="proBrowseGrpBadge" title="Current group filter">
                                    <i class="fas fa-folder"></i>
                                    <span id="proBrowseGrpContext">All Groups</span>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="pro-browse-head-right">
                        <button type="button" class="bb-btn-procore-primary pro-browse-head-create-btn" id="proBrowseCreateNewItemBtn">
                            <i class="fas fa-plus"></i> Create New Item
                        </button>
                        <button class="pro-icon-btn pro-modal-tab-close" type="button" data-catalog-close aria-label="Close" title="Close dialog">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="pro-browse-catalog-body">
                    <aside class="pro-browse-cat-sidebar cc-catalog-sidebar" id="proBrowseCatSidebar" aria-label="Catalog library navigation">
                        <div class="cc-sidebar-head">
                            <div class="cc-sidebar-head-left">
                                <span class="cc-sidebar-eyebrow">Company Tool</span>
                                <strong class="cc-sidebar-title">Catalog Library</strong>
                            </div>
                        </div>
                        <div class="cc-sidebar-search-wrap">
                            <div class="bb-search-field-procore cc-sidebar-search">
                                <input id="proBrowseCatSearch" type="search" placeholder="Search catalogs..." autocomplete="off">
                                <button class="bb-search-submit" type="button" aria-label="Search">
                                    <i class="fas fa-magnifying-glass"></i>
                                </button>
                            </div>
                        </div>
                        <div class="cc-sidebar-nav-fixed">
                            <button class="cc-tree-row static-view active" data-cat-select="all" type="button">
                                <i class="fas fa-layer-group" aria-hidden="true"></i>
                                <span>All Catalog Items</span>
                                <span class="cc-tree-count" id="proBrowseAllCount">0</span>
                            </button>
                            <button class="cc-tree-row static-view" data-cat-select="recent" type="button">
                                <i class="far fa-clock" aria-hidden="true"></i>
                                <span>Most Recently Used</span>
                            </button>
                        </div>
                        <div class="cc-tree-divider">
                            <span>Catalogs</span>
                        </div>
                        <div class="cc-sidebar-tree-wrap" id="proBrowseCatTree" role="tree" aria-label="Catalogs and groups"></div>
                    </aside>
                    <main class="pro-browse-items-main">
                        <div class="pro-browse-items-controls cc-table-controls bb-table-controls">
                            <div class="cc-table-controls-left bb-table-controls-left">
                                <div class="bb-search-field-procore cc-search-procore" style="width: 340px;">
                                    <input id="proBrowseItemSearch" type="search" placeholder="Search catalog items, codes, descriptions..." autocomplete="off">
                                    <button class="bb-search-submit" type="button" aria-label="Search">
                                        <i class="fas fa-magnifying-glass"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="cc-table-controls-right bb-table-controls-right">
                                <span class="pro-browse-count-label" id="proBrowseCountLabel">0 items</span>
                            </div>
                        </div>
                        <div class="pro-browse-items-list" id="proBrowseItemsList"></div>
                        <div class="cc-pagination pro-browse-pagination" id="ccPagination" aria-label="Catalog items pagination">
                            <div class="cc-pagination-info" id="ccPaginationInfo">
                                Showing <span id="ccPageStart">0</span>–<span id="ccPageEnd">0</span> of <span id="ccPageTotal">0</span> items
                            </div>
                            <div class="cc-pagination-controls" id="ccPaginationControls">
                                <button type="button" class="cc-page-btn" id="ccPageFirst" title="First page" aria-label="First page" disabled>
                                    <i class="fas fa-angles-left" aria-hidden="true"></i>
                                </button>
                                <button type="button" class="cc-page-btn" id="ccPagePrev" title="Previous page" aria-label="Previous page" disabled>
                                    <i class="fas fa-angle-left" aria-hidden="true"></i>
                                </button>
                                <div class="cc-pagination-numbers" id="ccPaginationNumbers"></div>
                                <button type="button" class="cc-page-btn" id="ccPageNext" title="Next page" aria-label="Next page" disabled>
                                    <i class="fas fa-angle-right" aria-hidden="true"></i>
                                </button>
                                <button type="button" class="cc-page-btn" id="ccPageLast" title="Last page" aria-label="Last page" disabled>
                                    <i class="fas fa-angles-right" aria-hidden="true"></i>
                                </button>
                            </div>
                        </div>
                    </main>
                </div>
                <div class="pro-browse-catalog-foot">
                    <div class="pro-browse-foot-left">
                        <span class="pro-browse-footer-selection-text" id="proBrowseFooterSelection">No item selected</span>
                    </div>
                    <div class="pro-browse-foot-right">
                        <button type="button" class="pro-btn-browse-cancel" data-catalog-close>Cancel</button>
                        <button type="button" class="bb-btn-procore-primary pro-btn-browse-select" id="proBrowseSelectBtn" disabled>
                            <i class="fas fa-check"></i> Select Item
                        </button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);

        modal.querySelectorAll('[data-catalog-close]').forEach(btn => btn.addEventListener('click', closeCatalogModal));

        const goToBrowseCatalogPage = (targetPage) => {
            const lastPage = browseCatalogState._lastTotalPages || 1;
            const nextPage = Math.max(1, Math.min(lastPage, Number(targetPage) || 1));
            if (nextPage === browseCatalogState.page) return;
            browseCatalogState.page = nextPage;
            renderCatalogItems({ scrollToTop: true });
        };

        const syncItemSearch = (immediate = false) => {
            const input = $('proBrowseItemSearch');
            if (!input) return;
            const apply = () => {
                browseCatalogState.itemQuery = input.value.trim();
                browseCatalogState.page = 1;
                renderCatalogItems({ scrollToTop: true });
            };
            clearTimeout(input._timer);
            if (immediate) apply();
            else input._timer = setTimeout(apply, 120);
        };

        $('proBrowseCatSearch')?.addEventListener('input', e => {
            browseCatalogState.catalogQuery = e.target.value.trim();
            renderCatalogSidebar();
        });
        $('proBrowseCatSearch')?.closest('.bb-search-field-procore')?.querySelector('.bb-search-submit')?.addEventListener('click', () => {
            const inp = $('proBrowseCatSearch');
            if (inp) {
                browseCatalogState.catalogQuery = inp.value.trim();
                renderCatalogSidebar();
                inp.focus();
            }
        });

        $('proBrowseItemSearch')?.addEventListener('input', () => syncItemSearch(false));
        $('proBrowseItemSearch')?.addEventListener('search', () => syncItemSearch(true));
        $('proBrowseItemSearch')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                syncItemSearch(true);
            }
        });
        $('proBrowseItemSearch')?.closest('.bb-search-field-procore')?.querySelector('.bb-search-submit')?.addEventListener('click', () => {
            syncItemSearch(true);
            $('proBrowseItemSearch')?.focus();
        });

        $('proBrowseSelectBtn')?.addEventListener('click', () => {
            const selectedItems = getSelectedCatalogItems();
            if (selectedItems.length) {
                if (typeof browseCatalogState.onSelect === 'function') {
                    const callback = browseCatalogState.onSelect;
                    browseCatalogState.onSelect = null;
                    closeCatalogModal();
                    callback(selectedItems);
                    return;
                }
                applyCatalogItemsToLayerForm(selectedItems);
            }
        });

        $('proBrowseCreateNewItemBtn')?.addEventListener('click', () => {
            window.open('cost_catalog.php', '_blank');
        });

        $('ccPageFirst')?.addEventListener('click', () => goToBrowseCatalogPage(1));
        $('ccPagePrev')?.addEventListener('click', () => goToBrowseCatalogPage(browseCatalogState.page - 1));
        $('ccPageNext')?.addEventListener('click', () => goToBrowseCatalogPage(browseCatalogState.page + 1));
        $('ccPageLast')?.addEventListener('click', () => goToBrowseCatalogPage(browseCatalogState._lastTotalPages || 1));

        $('ccPaginationNumbers')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.cc-page-number');
            if (btn && btn.dataset.page) {
                goToBrowseCatalogPage(btn.dataset.page);
            }
        });
    }

    function openCatalogModal(options = {}) {
        return catalogBrowserController.open(options);
    }

    function closeCatalogModal() {
        return catalogBrowserController.close();
    }

    function renderCatalogBrowser() {
        renderCatalogSidebar();
        renderCatalogItems();
    }

    function updateCatalogContextBadges() {
        const catBadge = $('proBrowseCatBadge');
        const grpBadge = $('proBrowseGrpBadge');
        const catContext = $('proBrowseCatContext');
        const grpContext = $('proBrowseGrpContext');

        const catId = browseCatalogState.selectedCatalogId;
        const grpId = browseCatalogState.selectedGroupId;

        const cat = (catalogState.catalogs || []).find(c => String(c.id) === String(catId));
        const grp = (catalogState.groups || []).find(g => String(g.id) === String(grpId));

        if (catContext) catContext.textContent = cat ? cat.name : (catId === '__recent__' ? 'Recently Used' : 'All Catalogs');
        if (grpContext) grpContext.textContent = grp ? grp.name : 'All Groups';

        if (catBadge) {
            catBadge.classList.toggle('is-selected', Boolean(cat));
            if (cat) {
                const color = getCatalogColor(cat.name, cat.id);
                catBadge.style.setProperty('--cat-color', color);
                catBadge.style.setProperty('--cat-bg-light', hexToRgba(color, 0.12));
                catBadge.style.setProperty('--cat-border-light', hexToRgba(color, 0.35));
                catBadge.style.setProperty('--cat-text-light', getDarkerShade(color));
                catBadge.style.setProperty('--cat-bg-dark', hexToRgba(color, 0.28));
                catBadge.style.setProperty('--cat-border-dark', hexToRgba(color, 0.60));
            } else {
                catBadge.style.removeProperty('--cat-color');
                catBadge.style.removeProperty('--cat-bg-light');
                catBadge.style.removeProperty('--cat-border-light');
                catBadge.style.removeProperty('--cat-text-light');
                catBadge.style.removeProperty('--cat-bg-dark');
                catBadge.style.removeProperty('--cat-border-dark');
            }
        }
        if (grpBadge) {
            grpBadge.classList.toggle('is-selected', Boolean(grp));
            if (grp) {
                const color = getGroupColor(grp.name, grp.id, catId);
                grpBadge.style.setProperty('--cat-color', color);
                grpBadge.style.setProperty('--cat-bg-light', hexToRgba(color, 0.14));
                grpBadge.style.setProperty('--cat-border-light', hexToRgba(color, 0.40));
                grpBadge.style.setProperty('--cat-text-light', color);
                grpBadge.style.setProperty('--cat-bg-dark', hexToRgba(color, 0.30));
                grpBadge.style.setProperty('--cat-border-dark', hexToRgba(color, 0.65));
            } else {
                grpBadge.style.removeProperty('--cat-color');
                grpBadge.style.removeProperty('--cat-bg-light');
                grpBadge.style.removeProperty('--cat-border-light');
                grpBadge.style.removeProperty('--cat-text-light');
                grpBadge.style.removeProperty('--cat-bg-dark');
                grpBadge.style.removeProperty('--cat-border-dark');
            }
        }
    }

    function normalizeCatalogSearchText(value) {
        return catalogBrowserController.normalizeSearchText(value);
    }

    function compactCatalogSearchText(value) {
        return catalogBrowserController.compactSearchText(value);
    }

    function resetBrowseCatalogScrollTop() {
        const list = $('proBrowseItemsList');
        const main = list?.closest('.pro-browse-items-main');
        if (list) list.scrollTop = 0;
        if (main) main.scrollTop = 0;
    }

    function renderCatalogSidebar() {
        const tree = $('proBrowseCatTree');
        if (!tree) return;
        const rawQuery = browseCatalogState.catalogQuery || '';
        const queryTokens = normalizeCatalogSearchText(rawQuery).split(' ').filter(Boolean);
        const isAllActive = !browseCatalogState.selectedCatalogId && !browseCatalogState.selectedGroupId;
        const isRecentActive = browseCatalogState.selectedCatalogId === '__recent__';

        const allBtn = document.querySelector('.pro-browse-cat-sidebar [data-cat-select="all"]');
        if (allBtn) allBtn.classList.toggle('active', isAllActive);
        const recentBtn = document.querySelector('.pro-browse-cat-sidebar [data-cat-select="recent"]');
        if (recentBtn) recentBtn.classList.toggle('active', isRecentActive);

        const allItems = catalogState.items || [];
        if ($('proBrowseAllCount')) $('proBrowseAllCount').textContent = allItems.length;

        updateCatalogContextBadges();

        let html = '';
        (catalogState.catalogs || []).forEach(cat => {
            const catId = String(cat.id);
            const allGroups = (catalogState.groups || [])
                .filter(g => String(g.catalogId) === catId && !g.parentGroupId)
                .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { numeric: true, sensitivity: 'base' }));

            const catNorm = normalizeCatalogSearchText(cat.name);
            const catMatches = !queryTokens.length || queryTokens.every(tok => catNorm.includes(tok));
            const matchingGroups = queryTokens.length
                ? allGroups.filter(g => {
                    const gNorm = `${catNorm} ${normalizeCatalogSearchText(g.name)}`;
                    return queryTokens.every(tok => gNorm.includes(tok));
                })
                : allGroups;

            if (queryTokens.length && !catMatches && !matchingGroups.length) return;

            const groups = (queryTokens.length && !catMatches) ? matchingGroups : allGroups;
            const isCatActive = String(browseCatalogState.selectedCatalogId) === catId && !browseCatalogState.selectedGroupId;
            const isExpanded = queryTokens.length && matchingGroups.length ? true : Boolean(browseCatalogState.expandedCatalogs[catId] ?? true);
            const catColor = getCatalogColor(cat.name, cat.id);
            const catCount = allItems.filter(i => String(i.catalog?.id) === catId).length;

            html += `
                <div class="cc-tree-row cc-tree-catalog ${isCatActive ? 'active' : ''}" data-cat-select="${esc(catId)}" title="${esc(cat.name)}">
                    ${groups.length ? `<i class="fas fa-caret-right cc-tree-caret ${isExpanded ? 'open' : ''}" data-cat-toggle="${esc(catId)}"></i>` : '<span style="width:16px;display:inline-block;"></span>'}
                    <i class="fas fa-book cc-tree-icon" style="color: ${catColor};"></i>
                    <span class="cc-tree-label">${esc(cat.name)}</span>
                    ${cat.locked ? '<i class="fas fa-lock cc-tree-lock" title="Locked catalog"></i>' : ''}
                    <span class="cc-tree-count">${catCount}</span>
                </div>
            `;

            if (isExpanded && groups.length) {
                html += '<div class="cc-tree-children" role="group">';
                groups.forEach(grp => {
                    const grpId = String(grp.id);
                    const isGrpActive = String(browseCatalogState.selectedGroupId) === grpId;
                    const grpCount = allItems.filter(i => String(i.category?.id) === grpId).length;

                    html += `
                        <div class="cc-tree-row cc-tree-group ${isGrpActive ? 'active' : ''}" data-cat-group-select="${esc(grpId)}" data-cat-parent="${esc(catId)}" title="${esc(grp.name)}">
                            <i class="fas fa-folder cc-tree-icon" style="font-size:11.5px;"></i>
                            <span class="cc-tree-label">${esc(grp.name)}</span>
                            <span class="cc-tree-count">${grpCount}</span>
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

        const rootModal = $('takeoffCatalogModal');
        rootModal?.querySelectorAll('.pro-browse-cat-sidebar [data-cat-select]').forEach(node => {
            node.addEventListener('click', () => {
                const target = node.dataset.catSelect;
                if (target === 'all') {
                    browseCatalogState.selectedCatalogId = null;
                    browseCatalogState.selectedGroupId = null;
                } else if (target === 'recent') {
                    browseCatalogState.selectedCatalogId = '__recent__';
                    browseCatalogState.selectedGroupId = null;
                } else {
                    browseCatalogState.selectedCatalogId = target;
                    browseCatalogState.selectedGroupId = null;
                }
                browseCatalogState.page = 1;
                renderCatalogSidebar();
                renderCatalogItems({ scrollToTop: true });
            });
        });

        tree.querySelectorAll('[data-cat-group-select]').forEach(node => {
            node.addEventListener('click', () => {
                const grpId = node.dataset.catGroupSelect;
                const parentCatId = node.dataset.catParent;
                browseCatalogState.selectedCatalogId = parentCatId;
                browseCatalogState.selectedGroupId = grpId;
                browseCatalogState.page = 1;
                renderCatalogSidebar();
                renderCatalogItems({ scrollToTop: true });
            });
        });
    }

    function filterBrowseCatalogItems() {
        return catalogBrowserController.filterItems();
    }

    function renderCatalogItems(options = {}) {
        const list = $('proBrowseItemsList');
        const selectBtn = $('proBrowseSelectBtn');
        if (!list) return;
        const shouldScrollTop = options?.scrollToTop !== false;

        if (catalogState.loading) {
            list.innerHTML = '<div style="padding: 60px 20px; text-align: center; color: var(--tk-text-muted);"><i class="fas fa-spinner fa-spin" style="font-size: 26px; color: var(--tk-primary, #fb5a3a);"></i><p style="margin-top: 12px; font-size: 13px; font-weight: 500;">Loading catalog items...</p></div>';
            return;
        }

        const filtered = filterBrowseCatalogItems();
        const total = filtered.length;
        const pageSize = browseCatalogState.pageSize;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        browseCatalogState._lastTotalPages = totalPages;
        if (browseCatalogState.page > totalPages) browseCatalogState.page = totalPages;
        const start = (browseCatalogState.page - 1) * pageSize;
        const pageItems = filtered.slice(start, start + pageSize);
        const end = Math.min(start + pageItems.length, total);

        if ($('proBrowseCountLabel')) {
            $('proBrowseCountLabel').textContent = `${total.toLocaleString()} ${total === 1 ? 'item found' : 'items found'}`;
        }

        const pageStartEl = $('ccPageStart');
        const pageEndEl = $('ccPageEnd');
        const pageTotalEl = $('ccPageTotal');
        if (pageStartEl && pageEndEl && pageTotalEl) {
            const displayStart = total > 0 ? start + 1 : 0;
            pageStartEl.textContent = Number(displayStart).toLocaleString();
            pageEndEl.textContent = Number(end).toLocaleString();
            pageTotalEl.textContent = Number(total).toLocaleString();
        }

        const btnFirst = $('ccPageFirst');
        const btnPrev = $('ccPagePrev');
        const btnNext = $('ccPageNext');
        const btnLast = $('ccPageLast');
        const currentPage = browseCatalogState.page;

        if (btnFirst) btnFirst.disabled = currentPage <= 1 || totalPages <= 1;
        if (btnPrev) btnPrev.disabled = currentPage <= 1 || totalPages <= 1;
        if (btnNext) btnNext.disabled = currentPage >= totalPages || totalPages <= 1;
        if (btnLast) btnLast.disabled = currentPage >= totalPages || totalPages <= 1;

        const numbersContainer = $('ccPaginationNumbers');
        if (numbersContainer) {
            if (totalPages <= 1) {
                numbersContainer.innerHTML = total > 0 ? `<button type="button" class="cc-page-number active" aria-current="page">1</button>` : '';
            } else {
                const pages = [];
                if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                } else {
                    if (currentPage <= 4) {
                        pages.push(1, 2, 3, 4, 5, '...', totalPages);
                    } else if (currentPage >= totalPages - 3) {
                        pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
                    } else {
                        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
                    }
                }
                numbersContainer.innerHTML = pages.map(p => {
                    if (p === '...') {
                        return `<span class="cc-page-ellipsis" aria-hidden="true">&hellip;</span>`;
                    }
                    const isActive = p === currentPage;
                    return `<button type="button" class="cc-page-number ${isActive ? 'active' : ''}" data-page="${p}" ${isActive ? 'aria-current="page"' : ''} title="Page ${p}">${p}</button>`;
                }).join('');
            }
        }

        if (!pageItems.length) {
            list.innerHTML = '<div style="padding: 60px 20px; text-align: center; color: var(--tk-text-muted);"><i class="fas fa-box-open" style="font-size: 32px; opacity: 0.45; margin-bottom: 8px;"></i><p style="margin-top: 8px; font-size: 13.5px; font-weight: 500;">No catalog items match this criteria.</p></div>';
            if (shouldScrollTop) resetBrowseCatalogScrollTop();
            if (selectBtn) { selectBtn.disabled = true; selectBtn.classList.remove('is-active'); }
            updateBrowseSelectionUi();
            return;
        }

        const showCatGrpPills = !browseCatalogState.selectedCatalogId && !browseCatalogState.selectedGroupId;

        list.innerHTML = pageItems.map(item => {
            const itemIdStr = String(item.id);
            const isSelected = browseCatalogState.selectedItemIds.has(itemIdStr);
            const unitCost = getCatalogItemUnitCost(item);
            const laborHours = getCatalogItemLaborHours(item);
            const costStr = unitCost > 0 ? `$${unitCost.toFixed(2)}` : '$0.00';
            const laborStr = laborHours > 0 ? `${laborHours % 1 === 0 ? laborHours.toFixed(0) : laborHours.toFixed(2)} hrs` : '0.00 hrs';
            const catalogName = item.catalog?.name || '';
            const catalogId = item.catalog?.id || '';
            const groupName = item.category?.name || '';
            const groupId = item.category?.id || '';
            const code = item.supplier?.catalogNumber || item.classification?.costCode || '';
            const uomStr = esc(item.uom || item.unit_of_measure || 'ea');

            return `
                <div class="pro-catalog-item-card ${isSelected ? 'is-selected' : ''}" data-browse-item="${esc(item.id)}">
                    <div class="pro-catalog-item-select-col">
                        <input type="${browseCatalogState.singleSelect ? 'radio' : 'checkbox'}" ${browseCatalogState.singleSelect ? 'name="proBrowseSingleSelect"' : ''} class="pro-catalog-item-checkbox" ${isSelected ? 'checked' : ''} data-item-check="${esc(item.id)}" aria-label="Select ${esc(item.name)}">
                    </div>
                    <div class="pro-catalog-item-content">
                        <div class="pro-catalog-item-top cc-item-primary-row">
                            <span class="pro-catalog-item-title cc-item-name">${esc(item.name)}</span>
                            ${item.color ? `<span class="cc-swatch" style="background:${esc(item.color)};" title="Color: ${esc(item.color)}"></span>` : ''}
                        </div>
                        ${item.description ? `<div class="pro-catalog-item-desc cc-item-desc-inline">${esc(item.description)}</div>` : ''}
                        <div class="pro-catalog-item-details-row cc-item-meta">
                            <span class="pro-cat-info-tag tag-price cc-money" title="Unit Cost">
                                <i class="fas fa-tag"></i>
                                <span class="tag-label">Price:</span>
                                <strong class="tag-val">${costStr}</strong>
                                <span class="tag-uom">/ ${uomStr}</span>
                            </span>
                            <span class="pro-cat-info-tag tag-labor" title="Labor Time">
                                <i class="far fa-clock"></i>
                                <span class="tag-label">Labor:</span>
                                <strong class="tag-val">${laborStr}</strong>
                            </span>
                            <span class="pro-cat-info-tag tag-uom cc-uom-tag" title="Unit of measure">
                                <span class="tag-label">UoM:</span>
                                <strong class="tag-val">${uomStr}</strong>
                            </span>
                            ${code && code !== 'n/a' ? `
                                <span class="pro-cat-info-tag tag-code" title="Catalog Number / Code">
                                    <i class="fas fa-barcode"></i>
                                    <strong class="tag-val">${esc(code)}</strong>
                                </span>
                            ` : ''}
                            ${showCatGrpPills && catalogName ? renderCatalogPill(catalogName, catalogId) : ''}
                            ${showCatGrpPills && groupName ? renderGroupPill(groupName, groupId, catalogId) : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        if (shouldScrollTop) {
            resetBrowseCatalogScrollTop();
            requestAnimationFrame(resetBrowseCatalogScrollTop);
        }

        list.querySelectorAll('[data-browse-item]').forEach(card => {
            const id = String(card.dataset.browseItem);
            card.addEventListener('click', (e) => {
                if (e.target.matches('input[type="checkbox"], input[type="radio"]')) return;
                if (browseCatalogState.singleSelect) {
                    browseCatalogState.selectedItemIds.clear();
                    browseCatalogState.selectedItemIds.add(id);
                } else if (browseCatalogState.selectedItemIds.has(id)) {
                    browseCatalogState.selectedItemIds.delete(id);
                } else {
                    browseCatalogState.selectedItemIds.add(id);
                }
                updateBrowseSelectionUi();
            });
            card.addEventListener('dblclick', () => {
                if (browseCatalogState.singleSelect) browseCatalogState.selectedItemIds.clear();
                browseCatalogState.selectedItemIds.add(id);
                updateBrowseSelectionUi();
                const selectedItems = getSelectedCatalogItems();
                if (selectedItems.length) applyCatalogItemsToLayerForm(selectedItems);
            });
        });

        list.querySelectorAll('[data-item-check]').forEach(check => {
            check.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = String(check.dataset.itemCheck);
                if (browseCatalogState.singleSelect) {
                    browseCatalogState.selectedItemIds.clear();
                    if (check.checked) browseCatalogState.selectedItemIds.add(id);
                } else if (check.checked) {
                    browseCatalogState.selectedItemIds.add(id);
                } else {
                    browseCatalogState.selectedItemIds.delete(id);
                }
                updateBrowseSelectionUi();
            });
        });

        updateBrowseSelectionUi();
    }

    function updateBrowseSelectionUi() {
        const list = $('proBrowseItemsList');
        const selectBtn = $('proBrowseSelectBtn');
        const footerSelection = $('proBrowseFooterSelection');
        const selectedIds = browseCatalogState.selectedItemIds || new Set();
        if (browseCatalogState.singleSelect && selectedIds.size > 1) {
            const lastId = Array.from(selectedIds).pop();
            selectedIds.clear();
            if (lastId) selectedIds.add(lastId);
        }
        const selectedItems = getSelectedCatalogItems();
        const count = selectedItems.length;

        if (list) {
            list.querySelectorAll('.pro-catalog-item-card').forEach(card => {
                const cardId = String(card.dataset.browseItem || '');
                const isSelected = selectedIds.has(cardId);
                card.classList.toggle('is-selected', isSelected);
                const checkbox = card.querySelector('input[type="checkbox"], input[type="radio"]');
                if (checkbox) checkbox.checked = isSelected;
            });
        }

        if (footerSelection) {
            if (count === 0) {
                footerSelection.textContent = browseCatalogState.singleSelect ? 'Select 1 catalog item to replace' : 'No items selected';
            } else if (count === 1) {
                const item = selectedItems[0];
                const cost = getCatalogItemUnitCost(item);
                const costStr = cost > 0 ? `$${cost.toFixed(2)}` : '$0.00';
                const labelPrefix = browseCatalogState.singleSelect ? 'Replacement item' : 'Selected 1 item';
                footerSelection.innerHTML = `${labelPrefix}: <strong>${esc(item.name)}</strong> · ${costStr} / ${esc(item.uom || 'ea')}`;
            } else {
                let totalCost = 0;
                selectedItems.forEach(it => { totalCost += getCatalogItemUnitCost(it); });
                footerSelection.innerHTML = `<strong>${count} items selected</strong> · Est. unit total: $${totalCost.toFixed(2)}`;
            }
        }

        if (selectBtn) {
            const hasSelected = count > 0;
            selectBtn.disabled = !hasSelected;
            selectBtn.classList.toggle('is-active', hasSelected);
            if (browseCatalogState.singleSelect) {
                selectBtn.innerHTML = `<i class="fas fa-check"></i> Replace Item`;
            } else if (count > 1) {
                selectBtn.innerHTML = `<i class="fas fa-check"></i> Add Selected Items (${count})`;
            } else {
                selectBtn.innerHTML = `<i class="fas fa-check"></i> Select Item`;
            }
        }
    }

    function getSelectedCatalogItems() {
        const ids = browseCatalogState.selectedItemIds;
        if (!ids || !ids.size) return [];
        return (catalogState.items || []).filter(i => ids.has(String(i.id)));
    }

    function getSelectedCatalogItem() {
        const items = getSelectedCatalogItems();
        return items[0] || null;
    }

    let takeoffGroupModalReturnFocus = null;
    let takeoffGroupModalEditingGroup = null;

    function closeTakeoffGroupModal() {
        const modal = $('takeoffGroupModal');
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        modal.style.display = 'none';
        modal.classList.remove('open', 'is-open');
        document.body.classList.remove('pro-dialog-open');
        const input = $('takeoffGroupName');
        const error = $('takeoffGroupNameError');
        if (input) { input.value = ''; input.removeAttribute('aria-invalid'); }
        if (error) { error.hidden = true; error.textContent = ''; }
        if ($('takeoffGroupNameCount')) $('takeoffGroupNameCount').textContent = '0 / 120';
        takeoffGroupModalEditingGroup = null;
        const heading = $('takeoffGroupModalHeading');
        if (heading) heading.textContent = 'Create new group';
        const icon = $('takeoffGroupModalIcon');
        if (icon) icon.className = 'fas fa-folder-plus';
        const submitText = $('takeoffGroupSubmitText');
        if (submitText) submitText.textContent = 'Create group';
        takeoffGroupModalReturnFocus?.focus?.();
        takeoffGroupModalReturnFocus = null;
    }

    function openTakeoffGroupModal(trigger = document.activeElement, groupToRename = null) {
        if (!requireWrite()) return false;
        const modal = $('takeoffGroupModal');
        const input = $('takeoffGroupName');
        if (!modal || !input) return;
        takeoffGroupModalReturnFocus = trigger;
        takeoffGroupModalEditingGroup = groupToRename;

        const heading = $('takeoffGroupModalHeading');
        const icon = $('takeoffGroupModalIcon');
        const submitText = $('takeoffGroupSubmitText');

        if (groupToRename) {
            if (heading) heading.textContent = 'Rename group';
            if (icon) icon.className = 'fas fa-pen';
            if (submitText) submitText.textContent = 'Save changes';
            input.value = groupToRename.name || '';
            if ($('takeoffGroupNameCount')) $('takeoffGroupNameCount').textContent = `${(groupToRename.name || '').length} / 120`;
        } else {
            if (heading) heading.textContent = 'Create new group';
            if (icon) icon.className = 'fas fa-folder-plus';
            if (submitText) submitText.textContent = 'Create group';
            input.value = '';
            if ($('takeoffGroupNameCount')) $('takeoffGroupNameCount').textContent = '0 / 120';
        }

        modal.hidden = false;
        modal.style.display = 'flex';
        modal.classList.add('open', 'is-open');
        document.body.classList.add('pro-dialog-open');
        requestAnimationFrame(() => {
            input.focus();
            if (groupToRename) input.select();
        });
    }

    function createTakeoffGroup(name) {
        if (!requireWrite()) return false;
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
                group: { id: estimatingGroupId, takeoffGroupId: group.id, name: group.name, expanded: true, sortOrder: takeoffState.groups.filter(row => groupBelongsToEstimate(row)).length - 1, items: [] }
            }
        }));
        saveTakeoffState();
        renderTakeoffPanel();
        requestAnimationFrame(() => {
            const groupEl = document.querySelector(`[data-takeoff-group-row="${group.id}"]`) || document.querySelector(`.pro-takeoff-group[data-group-id="${group.id}"]`);
            if (groupEl) {
                groupEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                groupEl.classList.add('group-highlight-pulse');
                setTimeout(() => groupEl.classList.remove('group-highlight-pulse'), 3600);
            }
            const nameEl = document.querySelector(`.pro-takeoff-group[data-group-id="${group.id}"] .pro-tree-name`);
            if (nameEl) {
                nameEl.click();
            }
        });
        return true;
    }

    function submitTakeoffGroupModal(event) {
        event.preventDefault();
        if (!requireWrite()) return false;
        const input = $('takeoffGroupName');
        const error = $('takeoffGroupNameError');
        const name = String(input?.value || '').trim().replace(/\s+/g, ' ');
        let message = '';
        if (!name) message = 'Enter a group name.';
        else if (takeoffGroupModalEditingGroup) {
            const isDuplicate = takeoffState.groups.some(group =>
                group !== takeoffGroupModalEditingGroup &&
                groupBelongsToEstimate(group) &&
                String(group.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase()
            );
            if (isDuplicate) message = 'A group with this name already exists in this estimate.';
        } else if (takeoffState.groups.some(group => groupBelongsToEstimate(group)
            && String(group.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
            message = 'A group with this name already exists in this estimate.';
        }
        if (message) {
            if (error) { error.textContent = message; error.hidden = false; }
            input?.setAttribute('aria-invalid', 'true');
            input?.focus();
            return;
        }

        if (takeoffGroupModalEditingGroup) {
            const group = takeoffGroupModalEditingGroup;
            if (group.name !== name) {
                applyTakeoffGroupRename(group, name);
                showTakeoffToast?.('Group renamed.');
            }
            closeTakeoffGroupModal();
            return;
        }

        if (createTakeoffGroup(name)) closeTakeoffGroupModal();
    }

    function collapseAllTakeoffGroups() {
        takeoffState.groups.filter(group => groupBelongsToEstimate(group)).forEach(group => { group.isExpanded = false; });
        saveTakeoffState({ skipEstimatingSync: true, suppressDirty: true, debounceLocalSave: true });
        renderTakeoffPanel();
    }

    function duplicateGroup(groupId) {
        if (!requireWrite()) return false;
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
        if (!requireWrite()) return false;
        const group = findGroupExact(groupId);
        if (!group || !targetEstimateId) return;
        group.estimateId = targetEstimateId;
        (group.layers || []).forEach(l => { l.estimateId = targetEstimateId; });
        saveTakeoffState();
        renderTakeoffPanel();
        showPrepared(`Group moved to target estimate.`);
    }

    function openGroupContextMenu(groupId, button) {
        if (!requireWrite()) return false;
        if (groupId instanceof Element && typeof button === 'string') {
            const tmp = groupId;
            groupId = button;
            button = tmp;
        }
        closeLayerModal();
        let menu = $('takeoffGroupContextMenu');
        if (menu && menu.style.display !== 'none' && takeoffState.contextGroupId === groupId) {
            closeGroupContextMenu();
            return;
        }
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
        document.querySelectorAll('[data-group-menu], [data-subhead-group-action="more"]').forEach(b => {
            b.setAttribute('aria-expanded', 'false');
            b.classList.remove('is-active');
        });
        menu.__trigger = button;
        menu.dataset.activeGroupId = String(groupId);
        menu.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
        button.classList.add('is-active');
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

        const footer = document.querySelector('.est-version-bar') || $('takeoffEstimateTypesFooter');
        const footerRect = footer ? footer.getBoundingClientRect() : null;
        const bottomLimit = (footerRect && footerRect.top > 0) ? Math.min(footerRect.top - margin, bounds.bottom) : bounds.bottom;

        if (left + menuRect.width > (isSubhead ? window.innerWidth - 12 : bounds.right)) {
            left = isSubhead ? window.innerWidth - menuRect.width - 12 : rect.left - menuRect.width - gap;
        }

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
        if (!requireWrite()) return false;
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
        if (menu) {
            menu.style.display = 'none';
            menu.classList.remove('open');
            delete menu.dataset.activeGroupId;
            menu.__trigger = null;
        }
        document.querySelectorAll('[data-group-menu], [data-subhead-group-action="more"]').forEach(b => {
            b.setAttribute('aria-expanded', 'false');
            b.classList.remove('is-active');
        });
        takeoffState.contextGroupId = null;
    }

    function promptRenameGroup(group) {
        if (!requireWrite()) return false;
        if (!group) return;
        openTakeoffGroupModal(document.activeElement, group);
    }

    function renameGroup(groupId) {
        if (!requireWrite()) return false;
        const group = findGroup(groupId);
        if (!group) return;
        promptRenameGroup(group);
    }

    async function deleteGroup(groupId) {
        if (!requireWrite()) return false;
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
        if (!requireWrite()) return false;
        const wanted = new Set((groupIds || []).map(String));
        const groups = takeoffState.groups.filter(group => wanted.has(String(group.id))
            && groupBelongsToEstimate(group));
        if (!groups.length) return false;
        const estId = activeEstimateId();
        const groupLayers = groups.flatMap(group => group.layers || []);
        const layerIds = groupLayers.map(layer => String(layer.id));
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
        const delRes = removeLayersFromEditorAndQueue(estId, groupLayers, { force: false });
        if (groupLayers.length && delRes.deleted === false) return showPrepared('Unlock the selected groups before deleting them.');
        const removedKeySet = new Set([...layerIds, ...(delRes.keys || [])]);
        pushTakeoffHistory('delete-groups');
        const estimatingGroupIds = groups.map(group => String(group.estimatingGroupId || `takeoff_group_${group.id}`));
        takeoffState.groups = takeoffState.groups.filter(group => !wanted.has(String(group.id)));
        selectionState.selectedGroupIds = [];
        selectionState.selectedLayerIds = [];
        selectionState.selectedObjectIds = [];
        if (wanted.has(String(takeoffState.activeGroupId))) takeoffState.activeGroupId = takeoffState.groups.find(group => groupBelongsToEstimate(group))?.id || null;
        if (takeoffState.activeLayerId && removedKeySet.has(String(takeoffState.activeLayerId))) {
            takeoffState.activeLayerId = null;
            callEditor('projectTakeoffClearActiveLayer');
            setActiveTool('smart');
        }
        window.dispatchEvent(new CustomEvent('takeoff:estimating-groups-delete-requested', {
            detail: {
                projectId: String(window.ProjectState?.projectId || ''), estimateId: activeEstimateId(), groupIds: estimatingGroupIds
            }
        }));
        saveTakeoffState();
        renderTakeoffPanel(); renderSelectionBar(); renderInspector(); updateSubheadSelectedItem();
        return true;
    }

    function reorderTakeoffGroup(sourceId, targetId, insertAfter = false) {
        if (!requireWrite()) return false;
        const estimateId = activeEstimateId();
        const scopedIndexes = takeoffState.groups.map((group, index) => groupBelongsToEstimate(group, estimateId) ? index : -1).filter(index => index >= 0);
        const scoped = scopedIndexes.map(index => takeoffState.groups[index]);
        const from = scoped.findIndex(group => String(group.id) === String(sourceId));
        const to = scoped.findIndex(group => String(group.id) === String(targetId));
        if (from < 0 || to < 0 || from === to) return false;
        let insertAt = from < to
            ? (insertAfter ? to : Math.max(0, to - 1))
            : (insertAfter ? to + 1 : to);
        insertAt = Math.max(0, Math.min(scoped.length - 1, insertAt));
        if (insertAt === from) return false;
        pushTakeoffHistory('reorder-groups');
        const [moved] = scoped.splice(from, 1);
        scoped.splice(insertAt, 0, moved);
        scoped.forEach((group, index) => { group.sortOrder = index; takeoffState.groups[scopedIndexes[index]] = group; });
        window.dispatchEvent(new CustomEvent('takeoff:estimating-groups-reorder-requested', {
            detail: {
                projectId: String(window.ProjectState?.projectId || ''), estimateId,
                groupIds: scoped.map(group => String(group.estimatingGroupId || `takeoff_group_${group.id}`)),
                groupNames: scoped.map(group => ({
                    id: String(group.estimatingGroupId || `takeoff_group_${group.id}`),
                    takeoffGroupId: String(group.id),
                    name: String(group.name || '')
                }))
            }
        }));
        saveTakeoffState(); renderTakeoffPanel();
        return true;
    }

    function moveTakeoffLayer(sourceLayerId, targetLayerId) {
        if (!sourceLayerId || !targetLayerId || sourceLayerId === targetLayerId) return false;
        if (!requireWrite()) return false;

        let sourceGroup = null, sourceIndex = -1, layer = null;
        let targetGroup = null, targetIndex = -1;

        for (const group of takeoffState.groups) {
            const sIdx = (group.layers || []).findIndex(l => String(l.id) === String(sourceLayerId));
            if (sIdx !== -1) {
                sourceGroup = group;
                sourceIndex = sIdx;
                layer = group.layers[sIdx];
            }
            const tIdx = (group.layers || []).findIndex(l => String(l.id) === String(targetLayerId));
            if (tIdx !== -1) {
                targetGroup = group;
                targetIndex = tIdx;
            }
        }

        if (!layer || !sourceGroup || !targetGroup) return false;

        pushTakeoffHistory('reorder-layer');
        sourceGroup.layers.splice(sourceIndex, 1);
        if (sourceGroup.id === targetGroup.id && sourceIndex < targetIndex) {
            targetIndex--;
        }
        layer.groupId = targetGroup.id;
        targetGroup.layers.splice(targetIndex, 0, layer);

        window.dispatchEvent(new CustomEvent('takeoff:estimating-items-reorder-requested', {
            detail: {
                projectId: String(window.ProjectState?.projectId || ''),
                estimateId: activeEstimateId(),
                sourceLayerId: layer.id,
                targetLayerId: targetLayerId,
                targetGroupId: targetGroup.estimatingGroupId || targetGroup.id
            }
        }));

        saveTakeoffState();
        renderTakeoffPanel();
        showTakeoffToast?.('Item moved.');
        return true;
    }

    function moveTakeoffLayerToGroup(sourceLayerId, targetGroupId) {
        if (!sourceLayerId || !targetGroupId) return false;
        if (!requireWrite()) return false;

        let sourceGroup = null, sourceIndex = -1, layer = null;
        for (const group of takeoffState.groups) {
            const sIdx = (group.layers || []).findIndex(l => String(l.id) === String(sourceLayerId));
            if (sIdx !== -1) {
                sourceGroup = group;
                sourceIndex = sIdx;
                layer = group.layers[sIdx];
                break;
            }
        }
        const targetGroup = findGroup(targetGroupId);
        if (!layer || !sourceGroup || !targetGroup) return false;
        if (sourceGroup.id === targetGroup.id) return false;

        pushTakeoffHistory('reorder-layer');
        sourceGroup.layers.splice(sourceIndex, 1);
        layer.groupId = targetGroup.id;
        if (!Array.isArray(targetGroup.layers)) targetGroup.layers = [];
        targetGroup.layers.push(layer);

        window.dispatchEvent(new CustomEvent('takeoff:estimating-items-reorder-requested', {
            detail: {
                projectId: String(window.ProjectState?.projectId || ''),
                estimateId: activeEstimateId(),
                sourceLayerId: layer.id,
                targetGroupId: targetGroup.estimatingGroupId || targetGroup.id
            }
        }));

        saveTakeoffState();
        renderTakeoffPanel();
        showTakeoffToast?.('Item moved to group.');
        return true;
    }

    async function deleteLayer(layerId) {
        if (!requireWrite()) return false;
        const layer = findLayer(layerId);
        if (!layer) return false;
        const editorState = callEditor('projectTakeoffGetLayerLockState', layer.id) || {};
        if (layer.locked || editorState.locked) {
            return showPrepared('Unlock the selected item before deleting it.');
        }
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
        if (!confirmed) return false;
        const estId = layer.estimateId || activeEstimateId();
        const delRes = removeLayersFromEditorAndQueue(estId, [layer], { force: false });
        if (delRes.deleted === false) {
            return showPrepared('Unlock the selected item before deleting it.');
        }
        pushTakeoffHistory('delete-layer');
        const group = findGroup(layer.groupId);
        if (group) group.layers = group.layers.filter(item => String(item.id) !== String(layerId));
        selectionState.selectedLayerIds = (selectionState.selectedLayerIds || []).filter(id => String(id) !== String(layerId));
        if (String(takeoffState.activeLayerId || '') === String(layerId)) {
            takeoffState.activeLayerId = null;
            callEditor('projectTakeoffClearActiveLayer');
            setActiveTool('smart');
        }
        if (String(selectionState.activeLayerId || '') === String(layerId)) {
            selectionState.activeLayerId = null;
        }
        saveTakeoffState();
        renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
        updateSubheadSelectedItem();
        return true;
    }

    function selectedValidLayerIds() {
        const estId = activeEstimateId();
        const unique = Array.from(new Set((selectionState.selectedLayerIds || []).map(String)));
        return unique.filter(id => {
            const l = findLayer(id);
            return Boolean(l && layerBelongsToEstimate(l, estId));
        });
    }

    async function deleteTakeoffLayers(layerIds) {
        if (!requireWrite()) return false;
        const estId = activeEstimateId();
        const targetIds = Array.from(new Set((Array.isArray(layerIds) ? layerIds : []).map(String))).filter(id => {
            const l = findLayer(id);
            return Boolean(l && layerBelongsToEstimate(l, estId));
        });
        if (!targetIds.length) return false;
        const targetSet = new Set(targetIds);
        const targetLayers = targetIds.map(id => findLayer(id)).filter(Boolean);
        const lockedLayers = targetLayers.filter(layer => {
            const editorState = callEditor('projectTakeoffGetLayerLockState', layer.id) || {};
            return Boolean(layer?.locked || editorState.locked);
        });
        if (lockedLayers.length) {
            return showPrepared('Unlock the selected items before deleting them.');
        }
        const msg = targetIds.length === 1
            ? `Are you sure you want to delete takeoff layer "${findLayer(targetIds[0])?.name || 'Item'}" and its measurements?`
            : `Are you sure you want to delete ${targetIds.length} selected takeoff items and all their measurements?`;
        let confirmed = false;
        if (typeof window.showConfirmDialog === 'function') {
            confirmed = await window.showConfirmDialog({
                title: targetIds.length === 1 ? 'Delete Takeoff Layer' : 'Delete Selected Items',
                message: msg,
                confirmText: targetIds.length === 1 ? 'Delete Layer' : `Delete ${targetIds.length} Items`,
                primaryDanger: true
            });
        } else {
            confirmed = confirm(msg);
        }
        if (!confirmed) return false;
        const delRes = removeLayersFromEditorAndQueue(estId, targetLayers, { force: false });
        if (delRes.deleted === false) {
            return showPrepared('Unlock the selected items before deleting them.');
        }
        pushTakeoffHistory('delete-layers');
        takeoffState.groups.forEach(group => {
            if (!groupBelongsToEstimate(group, estId)) return;
            group.layers = (group.layers || []).filter(layer => !targetSet.has(String(layer.id)));
        });
        selectionState.selectedLayerIds = [];
        selectionState.selectedGroupIds = [];
        selectionState.selectedObjectIds = [];
        if (takeoffState.activeLayerId && targetSet.has(String(takeoffState.activeLayerId))) {
            takeoffState.activeLayerId = null;
            callEditor('projectTakeoffClearActiveLayer');
            setActiveTool('smart');
        }
        if (selectionState.activeLayerId && targetSet.has(String(selectionState.activeLayerId))) {
            selectionState.activeLayerId = null;
        }
        saveTakeoffState();
        renderTakeoffPanel();
        renderSelectionBar();
        renderInspector();
        updateSubheadSelectedItem();
        showPrepared(targetIds.length === 1 ? 'Takeoff item deleted.' : `${targetIds.length} takeoff items deleted.`);
        return true;
    }

    function insertCopiedLayerAfterSource(targetGroup, sourceLayer, copyLayer) {
        if (!targetGroup || !copyLayer) return;
        targetGroup.layers = targetGroup.layers || [];
        const srcIdx = sourceLayer ? targetGroup.layers.indexOf(sourceLayer) : -1;
        if (srcIdx >= 0) {
            targetGroup.layers.splice(srcIdx + 1, 0, copyLayer);
        } else {
            targetGroup.layers.push(copyLayer);
        }
    }

    function cloneAssemblyChildrenTree(children = [], parentItemId = null) {
        if (!Array.isArray(children) || !children.length) return [];
        return children.map(child => {
            const nextId = makeId('item');
            const cloned = JSON.parse(JSON.stringify(child || {}));
            delete cloned.dbEstimateItemId;
            delete cloned.estimateItemId;
            const nested = Array.isArray(cloned.children) && cloned.children.length
                ? cloned.children
                : (Array.isArray(cloned.assemblyItems) && cloned.assemblyItems.length ? cloned.assemblyItems : []);
            cloned.id = nextId;
            if (parentItemId !== null && parentItemId !== undefined) {
                cloned.parentItemId = parentItemId;
            } else {
                delete cloned.parentItemId;
                delete cloned.parent_item_id;
                delete cloned.assemblyParentId;
            }
            cloned.children = nested.length ? cloneAssemblyChildrenTree(nested, nextId) : [];
            return cloned;
        });
    }

    function findEstimatingSourceItemForLayer(layer, explicitEstId = null) {
        if (!layer) return null;
        const estState = loadEstimatingStateForSync();
        const targetEstId = String(explicitEstId || layer.estimateId || activeEstimateId() || '');
        const est = Array.isArray(estState?.estimates)
            ? (estState.estimates.find(row => String(row.id) === targetEstId) || estState.estimates[0])
            : null;
        const groups = est?.groups || estState?.groups || [];
        const candidateKeys = new Set([
            layer.id,
            layer.integration_key,
            layer.client_uid,
            layer.metadata_json?.project_layer_id
        ].filter(Boolean).map(String));
        const estItemId = layer.estimatingItemId || layer.metadata_json?.estimating_item_id || null;
        for (const grp of groups) {
            for (const item of (grp?.items || [])) {
                const tkKey = String(item.takeoffLayerId || item.takeoff_layer_id || '');
                const rawId = String(item.id || '');
                const strippedId = rawId.startsWith('takeoff_') ? rawId.slice(8) : '';
                if (candidateKeys.has(tkKey) || candidateKeys.has(strippedId) || (estItemId && rawId === String(estItemId))) {
                    return item;
                }
            }
        }
        return null;
    }

    function copyAssemblyContextOntoLayer(srcLayer, copyLayer, sourceEstId = null) {
        if (!srcLayer || !copyLayer) return copyLayer;
        const resolvedMeta = layerCatalogMetadata(srcLayer);
        if (resolvedMeta && window.CatalogMetadata) {
            copyLayer.catalogMetadata = window.CatalogMetadata.clone(resolvedMeta);
            copyLayer.metadata_json = copyLayer.metadata_json && typeof copyLayer.metadata_json === 'object' ? copyLayer.metadata_json : {};
            copyLayer.metadata_json.catalog_item = window.CatalogMetadata.clone(resolvedMeta);
            delete copyLayer.metadata_json.catalog_item_ref;
        }
        const sourceEstItem = findEstimatingSourceItemForLayer(srcLayer, sourceEstId);
        const estChildren = Array.isArray(sourceEstItem?.children) && sourceEstItem.children.length
            ? sourceEstItem.children
            : (Array.isArray(sourceEstItem?.assemblyItems) && sourceEstItem.assemblyItems.length
                ? sourceEstItem.assemblyItems
                : (Array.isArray(srcLayer.copiedAssemblyChildren) ? srcLayer.copiedAssemblyChildren : []));
        const snapComps = Array.isArray(sourceEstItem?.catalogSnapshot?.assemblyComponents) && sourceEstItem.catalogSnapshot.assemblyComponents.length
            ? sourceEstItem.catalogSnapshot.assemblyComponents
            : (Array.isArray(copyLayer.catalogMetadata?.assemblyComponents) ? copyLayer.catalogMetadata.assemblyComponents : []);
        const isAsm = Boolean(
            sourceEstItem?.isAssembly === true
            || Number(sourceEstItem?.is_assembly ?? 0) === 1
            || String(sourceEstItem?.itemType ?? sourceEstItem?.item_type ?? '').toLowerCase() === 'assembly'
            || String(sourceEstItem?.catalogSnapshot?.type ?? '').toLowerCase() === 'assembly'
            || srcLayer.isAssembly === true
            || String(srcLayer.itemType || srcLayer.item_type || '').toLowerCase() === 'assembly'
            || String(resolvedMeta?.type || '').toLowerCase() === 'assembly'
            || estChildren.length > 0
            || snapComps.length > 0
        );
        if (!isAsm) return copyLayer;
        copyLayer.isAssembly = true;
        copyLayer.itemType = 'assembly';
        copyLayer.item_type = 'assembly';
        copyLayer.copiedFromTakeoffLayerId = String(srcLayer.id);
        if (!copyLayer.catalogItemId && sourceEstItem?.catalogItemId) {
            copyLayer.catalogItemId = sourceEstItem.catalogItemId;
            copyLayer.catalog_item_id = sourceEstItem.catalogItemId;
        }
        if (sourceEstItem?.catalogSnapshot) {
            copyLayer.catalogSnapshot = JSON.parse(JSON.stringify(sourceEstItem.catalogSnapshot));
            if (!copyLayer.catalogMetadata) {
                copyLayer.catalogMetadata = JSON.parse(JSON.stringify(sourceEstItem.catalogSnapshot));
            } else if (!Array.isArray(copyLayer.catalogMetadata.assemblyComponents) || !copyLayer.catalogMetadata.assemblyComponents.length) {
                copyLayer.catalogMetadata.assemblyComponents = JSON.parse(JSON.stringify(snapComps));
            }
            if (copyLayer.metadata_json && typeof copyLayer.metadata_json === 'object') {
                copyLayer.metadata_json.catalog_item = JSON.parse(JSON.stringify(copyLayer.catalogMetadata));
                delete copyLayer.metadata_json.catalog_item_ref;
            }
        }
        if (estChildren.length > 0) {
            copyLayer.copiedAssemblyChildren = cloneAssemblyChildrenTree(estChildren);
        }
        return copyLayer;
    }

    function duplicateLayer(layerId) {
        if (!requireWrite()) return false;
        const layer = findLayer(layerId);
        if (!layer) return;
        pushTakeoffHistory('duplicate-layer');
        const group = findGroup(layer.groupId);
        const copyId = makeId('layer');
        const copy = {
            ...JSON.parse(JSON.stringify(layer)),
            id: copyId,
            client_uid: copyId,
            integration_key: copyId,
            name: `${layer.name} Copy`,
            color: window.TakeoffColorPalette.duplicateColor(layer.color, (group.layers || []).map(item => item.color)),
            quantity: 0,
            baseQuantity: 0,
            shapes: [],
            takeoffObjects: [],
            metadata: { ...(JSON.parse(JSON.stringify(layer.metadata || {}))), project_layer_id: copyId },
            metadata_json: { ...(JSON.parse(JSON.stringify(layer.metadata_json || {}))), project_layer_id: copyId }
        };
        delete copy.estimatingItemId;
        if (copy.metadata_json) delete copy.metadata_json.estimating_item_id;
        copyAssemblyContextOntoLayer(layer, copy);
        insertCopiedLayerAfterSource(group, layer, copy);
        setActiveTakeoffLayer(copy.id, false);
        // Register the duplicate in the canvas owner before it can be opened
        // in the Pro modal. Otherwise a quick rename targets a layer that only
        // exists in the parent panel and the next canvas save restores the
        // duplicate's original name.
        syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
        saveTakeoffState({ skipEstimatingSync: true });
        const persisted = callEditor('projectTakeoffSave');
        if (persisted && typeof persisted.then === 'function') {
            persisted.catch(error => {
                console.warn('Takeoff duplicate save failed', error);
                showPrepared('The copied Takeoff item could not be saved. Please try again.');
            });
        }
        saveTakeoffState({ debounceEstimatingSync: true, suppressDirty: true });
        renderTakeoffPanel();
        updateSubheadSelectedItem();
        return copy;
    }

    function renameLayer(layerId) {
        if (!requireWrite()) return false;
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
        layer.colorSource = 'takeoff-user';
        callEditor('projectTakeoffUpdateLayerObjects', layer.id, { color: layer.color });
        syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
        callEditor('projectTakeoffSave');
        saveTakeoffState();
        renderTakeoffPanel();
    }

    function closeTakeoffActionModal() {
        document.querySelector('[data-takeoff-action-portal]')?.remove();
    }

    function moveLayersToTargetGroup(layerIds, targetGroup) {
        if (!requireWrite() || !targetGroup) return false;
        const estId = activeEstimateId();
        const ids = Array.from(new Set((Array.isArray(layerIds) ? layerIds : []).map(String)));
        const layersToMove = ids.map(id => findLayer(id)).filter(l => l && layerBelongsToEstimate(l, estId));
        if (!layersToMove.length) return false;
        pushTakeoffHistory('move-layers');
        let movedCount = 0;
        layersToMove.forEach(layer => {
            const oldGroup = findGroup(layer.groupId);
            if (oldGroup && String(oldGroup.id) === String(targetGroup.id)) return;
            if (oldGroup) {
                oldGroup.layers = (oldGroup.layers || []).filter(item => String(item.id) !== String(layer.id));
            }
            layer.groupId = targetGroup.id;
            layer.groupName = targetGroup.name;
            if (targetGroup.estimatingGroupId) layer.estimatingGroupId = targetGroup.estimatingGroupId;
            if (layer.metadata_json && typeof layer.metadata_json === 'object' && targetGroup.estimatingGroupId) {
                layer.metadata_json.estimating_group_id = targetGroup.estimatingGroupId;
            }
            targetGroup.layers = targetGroup.layers || [];
            targetGroup.layers.push(layer);
            movedCount++;
        });
        if (!movedCount) return false;
        targetGroup.isExpanded = true;
        syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
        callEditor('projectTakeoffSave');
        saveTakeoffState();
        renderTakeoffPanel();
        updateSubheadSelectedItem();
        showPrepared(movedCount === 1
            ? `Moved "${layersToMove[0].name}" to "${targetGroup.name}".`
            : `Moved ${movedCount} items to "${targetGroup.name}".`);
        return true;
    }

    function openMoveLayersModal(layerIds) {
        if (!requireWrite()) return false;
        const estId = activeEstimateId();
        const layers = Array.from(new Set((Array.isArray(layerIds) ? layerIds : []).map(String)))
            .map(id => findLayer(id))
            .filter(l => l && layerBelongsToEstimate(l, estId));
        if (!layers.length) return false;
        closeTakeoffActionModal();

        const groups = takeoffState.groups.filter(g => groupBelongsToEstimate(g, estId));
        const currentGroupIds = new Set(layers.map(l => String(l.groupId || '')));
        const defaultTarget = groups.find(g => !currentGroupIds.has(String(g.id))) || groups[0];
        const summaryText = layers.length === 1
            ? `Move "${layers[0].name}" to another takeoff group`
            : `Move ${layers.length} selected items to another takeoff group`;

        const portal = document.createElement('div');
        portal.className = 'tk-modal-portal';
        portal.dataset.takeoffActionPortal = 'move';
        portal.innerHTML = `
            <div class="pd-modal bb-studio-modal tk-action-modal" role="dialog" aria-modal="true" aria-labelledby="tkMoveModalTitle">
                <div class="tk-action-modal-head">
                    <div class="tk-action-modal-head-left">
                        <div class="tk-action-icon-badge"><i class="fas fa-folder-tree"></i></div>
                        <div>
                            <h3 id="tkMoveModalTitle" class="tk-action-modal-title">${layers.length === 1 ? 'Move Takeoff Item' : `Move ${layers.length} Items`}</h3>
                            <p class="tk-action-modal-sub">${esc(summaryText)}</p>
                        </div>
                    </div>
                    <button type="button" class="tk-action-modal-close" data-tk-modal-close aria-label="Close"><i class="fas fa-times"></i></button>
                </div>
                <div class="tk-action-modal-body">
                    <div class="tk-field-group">
                        <label class="tk-field-label" for="tkMoveTargetGroup">
                            <span>Destination Group</span>
                            <button type="button" class="tk-inline-link-btn" id="tkMoveNewGroupToggle">+ New Group</button>
                        </label>
                        <select id="tkMoveTargetGroup" class="tk-select">
                            ${groups.map(g => {
            const isCurrent = currentGroupIds.size === 1 && currentGroupIds.has(String(g.id));
            const count = (g.layers || []).length;
            return `<option value="${esc(g.id)}" ${defaultTarget && String(defaultTarget.id) === String(g.id) ? 'selected' : ''}>${esc(g.name)} (${count} ${count === 1 ? 'item' : 'items'})${isCurrent ? ' — current' : ''}</option>`;
        }).join('')}
                        </select>
                    </div>
                    <div class="tk-field-group" id="tkMoveNewGroupWrap" hidden>
                        <label class="tk-field-label" for="tkMoveNewGroupName"><span>New Group Name</span></label>
                        <input type="text" id="tkMoveNewGroupName" class="tk-input" placeholder="e.g. Exterior Lighting">
                    </div>
                </div>
                <div class="tk-action-modal-foot">
                    <button type="button" class="tk-btn-cancel" data-tk-modal-close>Cancel</button>
                    <button type="button" class="tk-btn-primary" id="tkMoveSubmitBtn" data-keyboard-accept><i class="fas fa-arrow-right"></i> Move ${layers.length === 1 ? 'Item' : `${layers.length} Items`}</button>
                </div>
            </div>
        `;
        document.body.appendChild(portal);

        const groupSelect = portal.querySelector('#tkMoveTargetGroup');
        const newWrap = portal.querySelector('#tkMoveNewGroupWrap');
        const newInput = portal.querySelector('#tkMoveNewGroupName');
        const newToggle = portal.querySelector('#tkMoveNewGroupToggle');
        let creatingNew = false;

        newToggle?.addEventListener('click', () => {
            creatingNew = !creatingNew;
            newWrap.hidden = !creatingNew;
            groupSelect.disabled = creatingNew;
            newToggle.textContent = creatingNew ? 'Select Existing' : '+ New Group';
            if (creatingNew) setTimeout(() => newInput?.focus(), 20);
        });

        const closeOnEsc = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                cleanup();
            }
        };
        const cleanup = () => {
            document.removeEventListener('keydown', closeOnEsc, true);
            closeTakeoffActionModal();
        };
        document.addEventListener('keydown', closeOnEsc, true);
        portal.addEventListener('click', (e) => { if (e.target === portal) cleanup(); });
        portal.querySelectorAll('[data-tk-modal-close]').forEach(b => b.addEventListener('click', cleanup));

        portal.querySelector('#tkMoveSubmitBtn')?.addEventListener('click', () => {
            let targetGroup = null;
            if (creatingNew) {
                const name = String(newInput?.value || '').trim().replace(/\s+/g, ' ');
                if (!name) {
                    newInput?.focus();
                    return;
                }
                const gid = makeId('grp');
                targetGroup = {
                    id: gid,
                    estimatingGroupId: `takeoff_group_${gid}`,
                    estimateId: estId,
                    name,
                    isExpanded: true,
                    isDefault: false,
                    layers: []
                };
                takeoffState.groups.push(targetGroup);
            } else {
                targetGroup = findGroupExact(groupSelect?.value);
            }
            if (!targetGroup) return;
            cleanup();
            moveLayersToTargetGroup(layers.map(l => l.id), targetGroup);
        });
    }

    async function copyLayersToGroup({ layerIds, targetGroupId, includeQuantity = true }) {
        const estId = activeEstimateId();
        const targetGroup = findGroupExact(targetGroupId);
        if (!targetGroup) return false;
        const sourceLayers = layerIds.map(id => findLayer(id)).filter(l => l && layerBelongsToEstimate(l, estId));
        if (!sourceLayers.length) return false;
        pushTakeoffHistory('copy-layers-group');
        const created = [];
        sourceLayers.forEach(layer => {
            const copyId = makeId('layer');
            const qtyVal = includeQuantity ? Number(layer.quantity || 0) : 0;
            const clonedMeta = JSON.parse(JSON.stringify(layer.metadata_json || {}));
            delete clonedMeta.estimating_item_id;
            clonedMeta.project_layer_id = copyId;
            clonedMeta.base_quantity = qtyVal;
            clonedMeta.estimate_id = estId;
            clonedMeta.estimating_group_id = targetGroup.estimatingGroupId || `takeoff_group_${targetGroup.id}`;
            const existingColors = (targetGroup.layers || []).map(item => item.color);
            const copy = {
                ...JSON.parse(JSON.stringify(layer)),
                id: copyId,
                client_uid: copyId,
                integration_key: copyId,
                groupId: targetGroup.id,
                groupName: targetGroup.name,
                estimateId: estId,
                estimatingGroupId: clonedMeta.estimating_group_id,
                name: String(layer.groupId) === String(targetGroup.id) ? `${layer.name} Copy` : layer.name,
                color: window.TakeoffColorPalette.duplicateColor(layer.color, existingColors),
                quantity: qtyVal,
                baseQuantity: qtyVal,
                shapes: [],
                takeoffObjects: [],
                metadata: { ...(JSON.parse(JSON.stringify(layer.metadata || {}))), project_layer_id: copyId, base_quantity: qtyVal },
                metadata_json: clonedMeta
            };
            delete copy.estimatingItemId;
            copyAssemblyContextOntoLayer(layer, copy, estId);
            insertCopiedLayerAfterSource(targetGroup, layer, copy);
            created.push(copy);
        });
        targetGroup.isExpanded = true;
        if (created.length === 1) {
            setActiveTakeoffLayer(created[0].id, false, { fast: false, skipLayerSync: false });
        } else {
            syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
        }
        saveTakeoffState();
        renderTakeoffPanel();
        updateSubheadSelectedItem();
        showPrepared(created.length === 1
            ? `Copied "${created[0].name}" to "${targetGroup.name}".`
            : `Copied ${created.length} items to "${targetGroup.name}".`);
        return true;
    }

    async function copyLayersToDrawingAndEstimate({
        layerIds,
        targetEstimateId,
        targetDrawingId = 0,
        targetPage = 1,
        targetGroupChoice = '__same__',
        copyShapes = true
    }) {
        const srcEstId = activeEstimateId();
        const dstEstId = String(targetEstimateId || srcEstId);
        const dstDrawingId = Number(targetDrawingId || 0);
        const dstPage = Math.max(1, Number(targetPage || 1));
        const sourceLayers = layerIds.map(id => findLayer(id)).filter(l => l && layerBelongsToEstimate(l, srcEstId));
        if (!sourceLayers.length) return false;

        pushTakeoffHistory('copy-layers-drawing-estimate');
        const createdLayers = [];
        const srcDocId = Number(activeDrawingDoc()?.id || 0);

        if (copyShapes && dstDrawingId > 0 && srcDocId > 0) {
            try {
                if (typeof takeoffWindow()?.projectTakeoffSave === 'function') {
                    await takeoffWindow().projectTakeoffSave();
                }
            } catch (_) { }
        }

        const findOrCreateTargetGroup = (sourceLayer) => {
            if (targetGroupChoice && targetGroupChoice !== '__same__') {
                const chosen = findGroupExact(targetGroupChoice);
                if (chosen && groupBelongsToEstimate(chosen, dstEstId)) return chosen;
            }
            const srcGroup = findGroup(sourceLayer.groupId);
            const wantedName = srcGroup?.name || sourceLayer.groupName || 'Project Takeoff';
            let existing = takeoffState.groups.find(g => groupBelongsToEstimate(g, dstEstId)
                && String(g.name || '').trim().toLowerCase() === wantedName.trim().toLowerCase());
            if (!existing) {
                const gid = makeId('grp');
                existing = {
                    id: gid,
                    estimatingGroupId: `takeoff_group_${gid}`,
                    estimateId: dstEstId,
                    name: wantedName,
                    isExpanded: true,
                    isDefault: false,
                    layers: []
                };
                takeoffState.groups.push(existing);
            }
            return existing;
        };

        let srcServerState = null;
        let dstServerState = null;
        if (dstDrawingId > 0) {
            if (copyShapes && srcDocId > 0) {
                try {
                    const rSrc = await fetch(`../api/takeoff.php?action=state&drawing_id=${encodeURIComponent(srcDocId)}&estimate_key=${encodeURIComponent(srcEstId)}&inherit_legacy=1`);
                    const jSrc = await rSrc.json();
                    if (jSrc?.status === 'success' && jSrc.data) srcServerState = jSrc.data;
                } catch (_) { }
            }
            try {
                const rDst = await fetch(`../api/takeoff.php?action=state&drawing_id=${encodeURIComponent(dstDrawingId)}&estimate_key=${encodeURIComponent(dstEstId)}&inherit_legacy=1`);
                const jDst = await rDst.json();
                if (jDst?.status === 'success' && jDst.data) dstServerState = jDst.data;
            } catch (_) { }
        }

        const dstLayers = Array.isArray(dstServerState?.layers) ? [...dstServerState.layers] : [];
        const dstMarkers = Array.isArray(dstServerState?.markers) ? [...dstServerState.markers] : [];
        const dstSegments = Array.isArray(dstServerState?.segments) ? [...dstServerState.segments] : [];

        sourceLayers.forEach(srcLayer => {
            const targetGroup = findOrCreateTargetGroup(srcLayer);
            const newId = makeId('layer');
            const srcKeys = new Set([
                String(srcLayer.id || ''),
                String(srcLayer.client_uid || ''),
                String(srcLayer.integration_key || ''),
                String(srcLayer.metadata_json?.project_layer_id || '')
            ].filter(Boolean));
            const srcQty = Number(srcLayer.quantity || 0);

            let copiedMarkersForLayer = [];
            let copiedSegmentsForLayer = [];
            if (copyShapes && srcServerState) {
                copiedMarkersForLayer = (srcServerState.markers || [])
                    .filter(m => srcKeys.has(String(m.layer_client_uid || m.layer_id || '')))
                    .map(m => {
                        const cloneM = JSON.parse(JSON.stringify(m));
                        cloneM.client_uid = makeId('m');
                        cloneM.id = undefined;
                        cloneM.layer_client_uid = newId;
                        cloneM.page_number = dstPage;
                        cloneM.document_id = String(dstDrawingId);
                        return cloneM;
                    });
                copiedSegmentsForLayer = (srcServerState.segments || [])
                    .filter(s => srcKeys.has(String(s.layer_client_uid || s.layer_id || '')))
                    .map(s => {
                        const cloneS = JSON.parse(JSON.stringify(s));
                        cloneS.client_uid = makeId('seg');
                        cloneS.id = undefined;
                        cloneS.layer_client_uid = newId;
                        cloneS.page_number = dstPage;
                        cloneS.document_id = String(dstDrawingId);
                        return cloneS;
                    });
            }

            const hasCopiedCanvasGeometry = copiedMarkersForLayer.length > 0 || copiedSegmentsForLayer.length > 0;
            const baseQtyToPersist = hasCopiedCanvasGeometry ? Number(srcLayer.baseQuantity || 0) : srcQty;

            const existingColors = (targetGroup.layers || []).map(item => item.color);
            const isSameGroupAndEst = dstEstId === srcEstId && String(targetGroup.id) === String(srcLayer.groupId);
            const copyName = isSameGroupAndEst ? `${srcLayer.name} Copy` : srcLayer.name;

            const clonedMeta = JSON.parse(JSON.stringify(srcLayer.metadata_json || {}));
            delete clonedMeta.estimating_item_id;
            clonedMeta.project_layer_id = newId;
            clonedMeta.base_quantity = baseQtyToPersist;
            clonedMeta.estimate_id = dstEstId;
            clonedMeta.estimating_group_id = targetGroup.estimatingGroupId || `takeoff_group_${targetGroup.id}`;

            const newLayer = {
                ...JSON.parse(JSON.stringify(srcLayer)),
                id: newId,
                client_uid: newId,
                integration_key: newId,
                groupId: targetGroup.id,
                groupName: targetGroup.name,
                estimateId: dstEstId,
                estimatingGroupId: clonedMeta.estimating_group_id,
                name: copyName,
                color: isSameGroupAndEst ? window.TakeoffColorPalette.duplicateColor(srcLayer.color, existingColors) : srcLayer.color,
                quantity: srcQty,
                baseQuantity: baseQtyToPersist,
                shapes: [],
                takeoffObjects: [],
                metadata: { ...(JSON.parse(JSON.stringify(srcLayer.metadata || {}))), project_layer_id: newId, base_quantity: baseQtyToPersist },
                metadata_json: clonedMeta
            };
            delete newLayer.estimatingItemId;
            copyAssemblyContextOntoLayer(srcLayer, newLayer, srcEstId);
            insertCopiedLayerAfterSource(targetGroup, srcLayer, newLayer);
            createdLayers.push(newLayer);

            if (dstDrawingId > 0) {
                const payloadLayer = {
                    ...layerCanvasPayload(newLayer),
                    client_uid: newId,
                    integration_key: newId,
                    page_number: dstPage,
                    seed_quantity: baseQtyToPersist,
                    quantity: srcQty,
                    group_name: targetGroup.name,
                    metadata_json: clonedMeta
                };
                dstLayers.push(payloadLayer);
                dstMarkers.push(...copiedMarkersForLayer);
                dstSegments.push(...copiedSegmentsForLayer);
            }
        });

        if (dstDrawingId > 0) {
            try {
                await fetch('../api/takeoff.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'save_state',
                        drawing_id: dstDrawingId,
                        project_id: Number(window.ProjectState?.projectId || 0),
                        estimate_key: dstEstId,
                        layers: dstLayers,
                        markers: dstMarkers,
                        segments: dstSegments,
                        dirty_page_numbers: [dstPage]
                    })
                });
            } catch (err) {
                console.warn('Could not save copied drawing state:', err);
            }
            if (dstDrawingId === srcDocId && dstEstId === srcEstId) {
                const frame = $('takeoffFrame');
                if (frame?.contentWindow?.location) {
                    syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
                }
            }
        }

        if (dstEstId === srcEstId) {
            syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true });
            saveTakeoffState();
            renderTakeoffPanel();
            updateSubheadSelectedItem();
        } else {
            saveTakeoffState({ skipEstimatingSync: true });
            syncTakeoffToEstimating(dstEstId);
            renderTakeoffPanel();
        }

        const estObj = (loadEstimatingStateForSync()?.estimates || []).find(e => String(e.id) === dstEstId);
        const dstEstLabel = estObj?.name || (dstEstId === srcEstId ? 'current estimate' : dstEstId);
        const dstDocObj = drawingDocs().find(d => Number(d.id) === dstDrawingId);
        const whereText = dstDrawingId > 0
            ? `"${dstDocObj?.name || 'Drawing'}" (Page ${dstPage}) in "${dstEstLabel}"`
            : `"${dstEstLabel}"`;
        showPrepared(createdLayers.length === 1
            ? `Copied "${createdLayers[0].name}" (${createdLayers[0].quantity} ${createdLayers[0].uom}) to ${whereText}.`
            : `Copied ${createdLayers.length} items to ${whereText}.`);
        return true;
    }

    function openCopyLayersModal(layerIds) {
        if (!requireWrite()) return false;
        const estId = activeEstimateId();
        const layers = Array.from(new Set((Array.isArray(layerIds) ? layerIds : []).map(String)))
            .map(id => findLayer(id))
            .filter(l => l && layerBelongsToEstimate(l, estId));
        if (!layers.length) return false;
        closeTakeoffActionModal();

        const groupsInActive = takeoffState.groups.filter(g => groupBelongsToEstimate(g, estId));
        const activeGroupId = String(layers[0]?.groupId || groupsInActive[0]?.id || '');
        const estimatesList = loadEstimatingStateForSync()?.estimates || [];
        const docs = drawingDocs();
        const currentDoc = activeDrawingDoc();
        const defaultEst = estimatesList.find(e => String(e.id) !== estId) || estimatesList[0] || { id: estId, name: 'Current Estimate' };
        const defaultDoc = docs.find(d => Number(d.id) !== Number(currentDoc?.id || 0)) || currentDoc || docs[0] || null;
        const summaryText = layers.length === 1
            ? `${layers[0].name} (${quantityLabel(layers[0])})`
            : `${layers.length} selected takeoff items`;

        const portal = document.createElement('div');
        portal.className = 'tk-modal-portal';
        portal.dataset.takeoffActionPortal = 'copy';
        portal.innerHTML = `
            <div class="pd-modal bb-studio-modal tk-action-modal" role="dialog" aria-modal="true" aria-labelledby="tkCopyModalTitle">
                <div class="tk-action-modal-head">
                    <div class="tk-action-modal-head-left">
                        <div class="tk-action-icon-badge"><i class="fas fa-copy"></i></div>
                        <div>
                            <h3 id="tkCopyModalTitle" class="tk-action-modal-title">${layers.length === 1 ? 'Copy Takeoff Item' : `Copy ${layers.length} Selected Items`}</h3>
                            <p class="tk-action-modal-sub">${esc(summaryText)}</p>
                        </div>
                    </div>
                    <button type="button" class="tk-action-modal-close" data-tk-modal-close aria-label="Close"><i class="fas fa-times"></i></button>
                </div>
                <div class="tk-action-modal-body">
                    <div class="tk-mode-grid">
                        <button type="button" class="bb-mode-card bb-studio-card tk-studio-card active" data-tk-copy-mode="group">
                            <div class="tk-studio-card-head">
                                <span class="tk-studio-card-icon"><i class="fas fa-folder-plus"></i></span>
                                <span class="tk-studio-card-title">Copy to Group</span>
                            </div>
                            <span class="tk-studio-card-desc">Duplicate ${layers.length === 1 ? 'this item' : 'these items'} inside a group of the current estimate.</span>
                        </button>
                        <button type="button" class="bb-mode-card bb-studio-card tk-studio-card" data-tk-copy-mode="drawing_estimate">
                            <div class="tk-studio-card-head">
                                <span class="tk-studio-card-icon"><i class="fas fa-map"></i></span>
                                <span class="tk-studio-card-title">Copy Quantity / Drawing</span>
                            </div>
                            <span class="tk-studio-card-desc">Copy quantity or shapes to another drawing sheet and/or another estimate.</span>
                        </button>
                    </div>

                    <div id="tkCopyModeGroupPane">
                        <div class="tk-field-group">
                            <label class="tk-field-label" for="tkCopyGroupSelect"><span>Target Group (Current Estimate)</span></label>
                            <select id="tkCopyGroupSelect" class="tk-select">
                                ${groupsInActive.map(g => `<option value="${esc(g.id)}" ${String(g.id) === activeGroupId ? 'selected' : ''}>${esc(g.name)}${String(g.id) === activeGroupId ? ' (current)' : ''}</option>`).join('')}
                            </select>
                        </div>
                        <label class="tk-check-row" style="margin-top:8px;">
                            <input type="checkbox" id="tkCopyGroupIncludeQty" checked>
                            <span>Include current quantity as base quantity</span>
                        </label>
                    </div>

                    <div id="tkCopyModeDrawingPane" hidden>
                        <div class="tk-field-row-2">
                            <div class="tk-field-group">
                                <label class="tk-field-label" for="tkCopyTargetEstimate"><span>Target Estimate</span></label>
                                <select id="tkCopyTargetEstimate" class="tk-select">
                                    ${(estimatesList.length ? estimatesList : [{ id: estId, name: 'Primary Estimate' }]).map(est => `<option value="${esc(est.id)}" ${String(est.id) === String(defaultEst.id) ? 'selected' : ''}>${esc(est.name || 'Estimate')}${String(est.id) === estId ? ' (current)' : ''}</option>`).join('')}
                                </select>
                            </div>
                            <div class="tk-field-group">
                                <label class="tk-field-label" for="tkCopyDestGroup"><span>Target Group</span></label>
                                <select id="tkCopyDestGroup" class="tk-select"></select>
                            </div>
                        </div>
                        <div class="tk-field-row-2" style="margin-top:10px;">
                            <div class="tk-field-group">
                                <label class="tk-field-label" for="tkCopyTargetDrawing"><span>Target Drawing</span></label>
                                <select id="tkCopyTargetDrawing" class="tk-select">
                                    <option value="0">Base quantity only (no drawing placement)</option>
                                    ${docs.map(doc => `<option value="${esc(doc.id)}" ${defaultDoc && Number(defaultDoc.id) === Number(doc.id) ? 'selected' : ''}>${esc(doc.name)}${currentDoc && Number(currentDoc.id) === Number(doc.id) ? ' (current)' : ''}</option>`).join('')}
                                </select>
                            </div>
                            <div class="tk-field-group">
                                <label class="tk-field-label" for="tkCopyTargetPage"><span>Page / Sheet</span></label>
                                <input type="number" min="1" step="1" id="tkCopyTargetPage" class="tk-input" value="1">
                            </div>
                        </div>
                        <label class="tk-check-row" style="margin-top:8px;">
                            <input type="checkbox" id="tkCopyShapesCheck" checked>
                            <span>Copy drawing marks &amp; lines (falls back to base quantity if empty)</span>
                        </label>
                    </div>
                </div>
                <div class="tk-action-modal-foot">
                    <button type="button" class="tk-btn-cancel" data-tk-modal-close>Cancel</button>
                    <button type="button" class="tk-btn-primary" id="tkCopySubmitBtn" data-keyboard-accept><i class="fas fa-copy"></i> Copy ${layers.length === 1 ? 'Item' : `${layers.length} Items`}</button>
                </div>
            </div>
        `;
        document.body.appendChild(portal);

        let selectedMode = 'group';
        const modeCards = portal.querySelectorAll('[data-tk-copy-mode]');
        const groupPane = portal.querySelector('#tkCopyModeGroupPane');
        const drawingPane = portal.querySelector('#tkCopyModeDrawingPane');
        const estSelect = portal.querySelector('#tkCopyTargetEstimate');
        const destGroupSelect = portal.querySelector('#tkCopyDestGroup');
        const drawingSelect = portal.querySelector('#tkCopyTargetDrawing');
        const pageInput = portal.querySelector('#tkCopyTargetPage');
        const shapesCheck = portal.querySelector('#tkCopyShapesCheck');

        const refreshDestGroupsForEst = () => {
            const targetEst = String(estSelect?.value || estId);
            const targetGroups = takeoffState.groups.filter(g => groupBelongsToEstimate(g, targetEst));
            if (destGroupSelect) {
                destGroupSelect.innerHTML = `<option value="__same__">Keep source group name (create if needed)</option>`
                    + targetGroups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
            }
        };
        const syncPageInputState = () => {
            const did = Number(drawingSelect?.value || 0);
            const docObj = docs.find(d => Number(d.id) === did);
            if (pageInput) {
                pageInput.disabled = did <= 0;
                if (docObj?.pageCount) pageInput.max = String(docObj.pageCount);
                else pageInput.removeAttribute('max');
                if (did <= 0) pageInput.value = '1';
            }
            if (shapesCheck) shapesCheck.disabled = did <= 0;
        };
        refreshDestGroupsForEst();
        syncPageInputState();
        estSelect?.addEventListener('change', refreshDestGroupsForEst);
        drawingSelect?.addEventListener('change', syncPageInputState);

        modeCards.forEach(card => {
            card.addEventListener('click', () => {
                selectedMode = card.dataset.tkCopyMode;
                modeCards.forEach(c => c.classList.toggle('active', c === card));
                if (groupPane) groupPane.hidden = selectedMode !== 'group';
                if (drawingPane) drawingPane.hidden = selectedMode !== 'drawing_estimate';
            });
        });

        const closeOnEsc = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                cleanup();
            }
        };
        const cleanup = () => {
            document.removeEventListener('keydown', closeOnEsc, true);
            closeTakeoffActionModal();
        };
        document.addEventListener('keydown', closeOnEsc, true);
        portal.addEventListener('click', (e) => { if (e.target === portal) cleanup(); });
        portal.querySelectorAll('[data-tk-modal-close]').forEach(b => b.addEventListener('click', cleanup));

        const submitBtn = portal.querySelector('#tkCopySubmitBtn');
        submitBtn?.addEventListener('click', async () => {
            submitBtn.disabled = true;
            try {
                if (selectedMode === 'group') {
                    await copyLayersToGroup({
                        layerIds: layers.map(l => l.id),
                        targetGroupId: portal.querySelector('#tkCopyGroupSelect')?.value,
                        includeQuantity: Boolean(portal.querySelector('#tkCopyGroupIncludeQty')?.checked)
                    });
                } else {
                    await copyLayersToDrawingAndEstimate({
                        layerIds: layers.map(l => l.id),
                        targetEstimateId: estSelect?.value || estId,
                        targetDrawingId: Number(drawingSelect?.value || 0),
                        targetPage: Number(pageInput?.value || 1),
                        targetGroupChoice: destGroupSelect?.value || '__same__',
                        copyShapes: Boolean(shapesCheck?.checked)
                    });
                }
                cleanup();
            } finally {
                if (submitBtn.isConnected) submitBtn.disabled = false;
            }
        });
    }

    function moveLayerToGroup(layerId) {
        return openMoveLayersModal([layerId]);
    }

    function bindSubheadItemActions() {
        const info = $('takeoffSubheadItemInfo');
        if (!info || info.__actionsBound) return;
        info.__actionsBound = true;

        info.addEventListener('change', event => {
            const sizeSelect = event.target.closest('.subhead-note-size-select');
            if (sizeSelect && selectionState.selectedNote) {
                const sz = Number(sizeSelect.value);
                callEditor('updateSelectedNoteTypography', { fontSize: sz });
                selectionState.selectedNote.fontSize = sz;
                return;
            }
        });

        info.addEventListener('input', event => {
            const colorPicker = event.target.closest('.subhead-note-color-picker');
            if (colorPicker && selectionState.selectedNote) {
                const col = colorPicker.value;
                callEditor('updateSelectedNoteTypography', { color: col });
                selectionState.selectedNote.color = col;
                return;
            }
            const cloudColorPicker = event.target.closest('.subhead-cloud-color-picker');
            if (cloudColorPicker && selectionState.selectedCloud) {
                const col = cloudColorPicker.value;
                selectionState.selectedCloud.color = col;
                callEditor('updateSelectedCloudColor', col);
                const dotIcon = $('takeoffSubheadItemDot')?.querySelector('.fa-cloud');
                if (dotIcon) dotIcon.style.color = col;
                return;
            }
            const rulerColorPicker = event.target.closest('.subhead-ruler-color-picker');
            if (rulerColorPicker && selectionState.selectedRuler) {
                const col = rulerColorPicker.value;
                selectionState.selectedRuler.color = col;
                callEditor('updateSelectedRulerStyle', { color: col });
                const dotIcon = $('takeoffSubheadItemDot')?.querySelector('.fa-ruler');
                if (dotIcon) dotIcon.style.color = col;
                info.querySelectorAll('.subhead-ruler-color-swatch').forEach(sw => {
                    sw.classList.toggle('is-active', String(sw.dataset.rulerColor || '').toLowerCase() === col.toLowerCase());
                });
                return;
            }
        });

        info.addEventListener('click', event => {
            const rulerSwatch = event.target.closest('[data-ruler-color]');
            if (rulerSwatch && selectionState.selectedRuler) {
                event.stopPropagation();
                const col = rulerSwatch.dataset.rulerColor;
                selectionState.selectedRuler.color = col;
                callEditor('updateSelectedRulerStyle', { color: col });
                const picker = info.querySelector('.subhead-ruler-color-picker');
                if (picker && col.startsWith('#')) picker.value = col;
                const dotIcon = $('takeoffSubheadItemDot')?.querySelector('.fa-ruler');
                if (dotIcon) dotIcon.style.color = col;
                info.querySelectorAll('.subhead-ruler-color-swatch').forEach(sw => sw.classList.toggle('is-active', sw === rulerSwatch));
                return;
            }
            const rulerVisBtn = event.target.closest('[data-subhead-ruler-visibility]');
            if (rulerVisBtn && selectionState.selectedRuler) {
                event.stopPropagation();
                const nextHidden = !Boolean(selectionState.selectedRuler.hidden);
                selectionState.selectedRuler.hidden = nextHidden;
                callEditor('updateSelectedRulerStyle', { hidden: nextHidden });
                updateSubheadSelectedItem();
                return;
            }
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
                    openGroupContextMenu(groupId, groupBtn);
                }
                return;
            }

            const btn = event.target.closest('[data-subhead-item-action]');
            if (!btn) return;
            event.stopPropagation();
            const action = btn.dataset.subheadItemAction;
            const activeLayerId = takeoffState.activeLayerId || selectionState.activeLayerId;
            const selectedLayerIds = selectedValidLayerIds();
            const hasMultiLayers = selectedLayerIds.length > 1;
            const hasSelection = selectionState.selectedObjectIds.length > 0;

            if (action === 'add-node') {
                callEditor('projectTakeoffArmAddNode', true);
                showPrepared('Click anywhere on the line to insert a new node.');
            } else if (action === 'copy') {
                if (hasMultiLayers) {
                    openCopyLayersModal(selectedLayerIds);
                } else if (hasSelection && !selectedLayerIds.length) {
                    runSelectionAction('copy');
                } else if (selectedLayerIds.length === 1) {
                    openCopyLayersModal(selectedLayerIds);
                } else if (activeLayerId) {
                    openCopyLayersModal([activeLayerId]);
                } else {
                    showPrepared('Select a takeoff item first.');
                }
            } else if (action === 'move') {
                if (hasMultiLayers) {
                    openMoveLayersModal(selectedLayerIds);
                } else if (hasSelection && !selectedLayerIds.length && !activeLayerId) {
                    runSelectionAction('move');
                } else if (selectedLayerIds.length === 1) {
                    openMoveLayersModal(selectedLayerIds);
                } else if (activeLayerId) {
                    openMoveLayersModal([activeLayerId]);
                } else {
                    showPrepared('Select a takeoff item first.');
                }
            } else if (action === 'delete') {
                if (selectionState.selectedNote) {
                    callEditor('deleteKonvaSelection');
                    selectionState.selectedNote = null;
                    updateSubheadSelectedItem();
                    showPrepared('Note deleted.');
                } else if (selectionState.selectedCloud) {
                    callEditor('deleteKonvaSelection');
                    selectionState.selectedCloud = null;
                    updateSubheadSelectedItem();
                    showPrepared('Cloud deleted.');
                } else if (selectionState.selectedRuler) {
                    callEditor('deleteKonvaSelection');
                    selectionState.selectedRuler = null;
                    updateSubheadSelectedItem();
                    showPrepared('Ruler measurement deleted.');
                } else if (hasMultiLayers) {
                    deleteTakeoffLayers(selectedLayerIds);
                } else if (hasSelection) {
                    runSelectionAction('delete');
                } else if (selectedLayerIds.length === 1) {
                    deleteTakeoffLayers(selectedLayerIds);
                } else if (activeLayerId) {
                    deleteLayer(activeLayerId);
                } else {
                    showPrepared('Select a takeoff item first.');
                }
            }
        });
    }

    let cachedSaveBtnMetrics = null;

    function syncTakeoffSubheadAlignment(forceResetCache = false) {
        const itemInfo = document.getElementById('takeoffSubheadItemInfo');
        if (itemInfo) {
            itemInfo.style.marginLeft = '';
        }

        const saveBtn = document.getElementById('saveProjectBtn');
        const scaleBtn = document.getElementById('takeoffScaleStatus');
        const scaleSlot = document.getElementById('takeoffSubheadScaleSlot');
        if (saveBtn && scaleBtn && scaleSlot) {
            if (scaleBtn.getClientRects().length === 0 || scaleSlot.getClientRects().length === 0) {
                return;
            }
            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || parseFloat(getComputedStyle(document.body).zoom) || 1;
            const btnLabel = (saveBtn.textContent || '').trim();
            const isTransientSaveState = Boolean(saveBtn.disabled || /^(saving\b|saved\b)/i.test(btnLabel));
            if (forceResetCache && !isTransientSaveState) {
                delete saveBtn.dataset.intrinsicWidth;
                saveBtn.style.minWidth = '';
            }
            if (!isTransientSaveState) {
                const liveRect = saveBtn.getBoundingClientRect();
                if (liveRect.width > 0) {
                    cachedSaveBtnMetrics = {
                        width: liveRect.width,
                        left: liveRect.left
                    };
                }
            }
            const saveRect = cachedSaveBtnMetrics;
            if (saveRect && saveRect.width > 0) {
                const targetW = Math.max(20, Math.round(saveRect.width / zoom));
                const prevW = parseFloat(scaleBtn.style.width) || 0;
                if (Math.abs(prevW - targetW) > 0.5) {
                    const widthPx = `${targetW}px`;
                    scaleBtn.style.width = widthPx;
                    scaleBtn.style.minWidth = widthPx;
                    scaleBtn.style.maxWidth = widthPx;
                    scaleBtn.style.overflow = 'hidden';
                    scaleBtn.style.textOverflow = 'ellipsis';
                    scaleBtn.style.whiteSpace = 'nowrap';
                }

                const appliedMarginCss = parseFloat(scaleSlot.style.marginRight) || 0;
                const slotRect = scaleSlot.getBoundingClientRect();
                if (slotRect.width > 0) {
                    const unshiftedRight = slotRect.right + (appliedMarginCss * zoom);
                    const saveCenter = saveRect.left + (saveRect.width / 2);
                    const desiredRight = saveCenter + ((targetW * zoom) / 2);
                    const targetMarginCss = Math.max(0, Number(((unshiftedRight - desiredRight) / zoom).toFixed(1)));
                    if (Math.abs(appliedMarginCss - targetMarginCss) > 0.25) {
                        scaleSlot.style.marginRight = `${targetMarginCss}px`;
                    }
                }
            }
        }
    }
    window.syncTakeoffLayout = syncTakeoffSubheadAlignment;

    function updateSubheadSelectedItem() {
        if (window.ProjectState?.activeTab === 'documents' || document.body?.classList.contains('is-documents-tab')) {
            window.syncDocumentsSubheadInfo?.();
            return;
        }
        if (window.ProjectState?.activeTab === 'estimating' || document.body?.classList.contains('is-estimating-tab')) {
            const info = $('takeoffSubheadItemInfo');
            if (info) {
                info.classList.remove('is-visible');
                info.style.display = 'none';
            }
            window.syncEstimatingSubheadInfo?.();
            return;
        }
        const info = $('takeoffSubheadItemInfo');
        if (!info) return;
        bindSubheadItemActions();

        const selectedGroupIds = selectionState.selectedGroupIds || [];
        const isGroupSelected = selectedGroupIds.length > 0;
        const selectedGroup = isGroupSelected ? findGroup(selectedGroupIds[0]) : null;
        const selectedLayerObjects = selectedValidLayerIds().map(id => findLayer(id)).filter(Boolean);
        const isMultiLayerSelected = !isGroupSelected && selectedLayerObjects.length > 1;

        const activeLayerId = takeoffState.activeLayerId || selectionState.activeLayerId;
        const activeLayer = typeof findLayer === 'function' ? findLayer(activeLayerId) : null;
        const selectedCount = selectionState.selectedObjectIds?.length || 0;

        const dot = $('takeoffSubheadItemDot');
        const name = $('takeoffSubheadItemName');
        const meta = $('takeoffSubheadItemMeta');
        const actionsContainer = info.querySelector('.takeoff-subhead-item-actions');
        const prevActionMode = info.dataset.subheadActionMode || '';
        let nextActionMode = '';

        if (selectionState.selectedNote) {
            nextActionMode = 'note';
            info.classList.add('is-visible');
            info.classList.remove('is-group-info');
            info.style.display = 'inline-flex';
            if (dot) {
                dot.style.background = 'transparent';
                dot.innerHTML = '<i class="fas fa-note-sticky" style="color: #60a5fa; font-size: 11.5px;"></i>';
            }
            if (name) name.textContent = 'Note';
            if (meta) {
                const noteTxt = String(selectionState.selectedNote.text || '').trim();
                meta.textContent = noteTxt ? (noteTxt.length > 20 ? `"${noteTxt.slice(0, 20)}..."` : `"${noteTxt}"`) : 'Text note';
            }
            if (actionsContainer) {
                const curSize = Number(selectionState.selectedNote.fontSize) || 18;
                const curColor = String(selectionState.selectedNote.color || '#0f172a');
                actionsContainer.innerHTML = `
                    <div style="display:inline-flex; align-items:center; gap:5px; margin-right:4px;">
                        <span style="font-size:11px; font-weight:600; color:var(--text-muted, #94a3b8);">Size:</span>
                        <select class="subhead-note-size-select" style="border:1px solid var(--tk-border, #cbd5e1); border-radius:4px; font-size:11.5px; padding:2px 4px; cursor:pointer;">
                            <option value="12" ${curSize <= 13 ? 'selected' : ''}>12px</option>
                            <option value="14" ${curSize > 13 && curSize <= 15 ? 'selected' : ''}>14px</option>
                            <option value="16" ${curSize > 15 && curSize <= 17 ? 'selected' : ''}>16px</option>
                            <option value="18" ${curSize > 17 && curSize <= 21 ? 'selected' : ''}>18px</option>
                            <option value="24" ${curSize > 21 && curSize <= 28 ? 'selected' : ''}>24px</option>
                            <option value="32" ${curSize > 28 && curSize <= 40 ? 'selected' : ''}>32px</option>
                            <option value="48" ${curSize > 40 ? 'selected' : ''}>48px</option>
                        </select>
                    </div>
                    <div style="display:inline-flex; align-items:center; gap:5px; margin-right:4px;">
                        <span style="font-size:11px; font-weight:600; color:var(--text-muted, #94a3b8);">Color:</span>
                        <input type="color" class="subhead-note-color-picker" value="${curColor.startsWith('#') ? curColor : '#0f172a'}" style="width:22px; height:22px; padding:0; border:1px solid var(--tk-border, #cbd5e1); border-radius:4px; cursor:pointer; background:transparent;">
                    </div>
                    <button type="button" class="subhead-item-act-btn danger" data-subhead-item-action="delete" title="Delete note">
                        <i class="fas fa-trash"></i><span>Delete</span>
                    </button>
                `;
            }
        } else if (selectionState.selectedCloud) {
            info.classList.add('is-visible');
            info.classList.remove('is-group-info');
            info.style.display = 'inline-flex';
            if (dot) {
                dot.style.background = 'transparent';
                dot.innerHTML = `<i class="fas fa-cloud" style="color: ${selectionState.selectedCloud.color || '#ef4444'}; font-size: 11.5px;"></i>`;
            }
            if (name) name.textContent = 'Cloud';
            if (meta) meta.textContent = 'Annotation';
            if (actionsContainer) {
                const curColor = String(selectionState.selectedCloud.color || '#ef4444');
                actionsContainer.innerHTML = `
                    <div style="display:inline-flex; align-items:center; gap:5px; margin-right:4px;">
                        <span style="font-size:11px; font-weight:600; color:var(--text-muted, #94a3b8);">Color:</span>
                        <input type="color" class="subhead-cloud-color-picker" value="${curColor.startsWith('#') ? curColor : '#ef4444'}" style="width:22px; height:22px; padding:0; border:1px solid var(--tk-border, #cbd5e1); border-radius:4px; cursor:pointer; background:transparent;">
                    </div>
                    <button type="button" class="subhead-item-act-btn danger" data-subhead-item-action="delete" title="Delete cloud">
                        <i class="fas fa-trash"></i><span>Delete</span>
                    </button>
                `;
            }
        } else if (selectionState.selectedRuler) {
            info.classList.add('is-visible');
            info.classList.remove('is-group-info');
            info.style.display = 'inline-flex';
            const rColor = String(selectionState.selectedRuler.color || '#22c55e');
            const isHidden = Boolean(selectionState.selectedRuler.hidden);
            if (dot) {
                dot.style.background = 'transparent';
                dot.innerHTML = `<i class="fas fa-ruler" style="color: ${esc(rColor)}; font-size: 11px;"></i>`;
            }
            if (name) {
                const idx = selectionState.selectedRuler.index ? ` #${selectionState.selectedRuler.index}` : '';
                name.textContent = `Measurement${idx}`;
            }
            if (meta) meta.textContent = selectionState.selectedRuler.sidebarQuantityText || selectionState.selectedRuler.lengthText || 'Measurement';
            if (actionsContainer) {
                const quickColors = ['#22c55e', '#ef4444', '#2563eb', '#f59e0b', '#a855c9', '#06b6d4'];
                const swatchesHtml = quickColors.map(c =>
                    `<button type="button" class="subhead-ruler-color-swatch ${rColor.toLowerCase() === c.toLowerCase() ? 'is-active' : ''}" data-ruler-color="${c}" style="background:${c};" title="Color ${c}" aria-label="Color ${c}"></button>`
                ).join('');
                actionsContainer.innerHTML = `
                    <div class="subhead-ruler-color-wrap" style="margin-right:4px;">
                        ${swatchesHtml}
                        <input type="color" class="subhead-ruler-color-picker" value="${rColor.startsWith('#') ? esc(rColor) : '#22c55e'}" title="Custom measurement color">
                    </div>
                    <button type="button" class="subhead-item-act-btn" data-subhead-ruler-visibility="true" title="${isHidden ? 'Show measurement' : 'Hide measurement'}">
                        <i class="fas ${isHidden ? 'fa-eye-slash' : 'fa-eye'}"></i><span>${isHidden ? 'Show' : 'Hide'}</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn danger" data-subhead-item-action="delete" title="Delete ruler measurement">
                        <i class="fas fa-trash"></i><span>Delete</span>
                    </button>
                `;
            }
        } else if (isGroupSelected && selectedGroup) {
            nextActionMode = 'group';
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

            if (actionsContainer && prevActionMode !== nextActionMode) {
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
        } else if (isMultiLayerSelected) {
            nextActionMode = 'multi-items';
            info.classList.add('is-visible');
            info.classList.remove('is-group-info');
            info.style.display = 'inline-flex';
            if (dot) {
                dot.style.background = 'transparent';
                dot.style.color = '#2563eb';
                dot.innerHTML = '<i class="fas fa-layer-group" style="font-size: 11.5px;"></i>';
            }
            if (name) {
                name.textContent = `${selectedLayerObjects.length} items selected`;
            }
            if (meta) {
                const uoms = Array.from(new Set(selectedLayerObjects.map(l => l.uom || typeToUom(l.type) || 'ea')));
                if (uoms.length === 1) {
                    const sumQty = selectedLayerObjects.reduce((sum, l) => sum + Number(l.quantity || 0), 0);
                    const formatted = sumQty % 1 === 0 ? sumQty.toFixed(0) : sumQty.toFixed(2);
                    meta.textContent = `Total: ${formatted} ${uoms[0]}`;
                } else {
                    const typesSummary = Array.from(new Set(selectedLayerObjects.map(l => l.type || 'Count'))).slice(0, 3).join(', ');
                    meta.textContent = activeLayer ? `${typesSummary} · Drawing: ${activeLayer.name}` : typesSummary;
                }
            }
            if (actionsContainer && prevActionMode !== nextActionMode) {
                actionsContainer.innerHTML = `
                    <button type="button" class="subhead-item-act-btn" data-subhead-item-action="copy" title="Copy selected items">
                        <i class="fas fa-copy"></i><span>Copy</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn" data-subhead-item-action="move" title="Move selected items to group">
                        <i class="fas fa-folder-tree"></i><span>Move to</span>
                    </button>
                    <button type="button" class="subhead-item-act-btn danger" data-subhead-item-action="delete" title="Delete selected items">
                        <i class="fas fa-trash"></i><span>Delete</span>
                    </button>
                `;
            }
        } else if (activeLayer || selectedCount > 0) {
            info.classList.add('is-visible');
            info.classList.remove('is-group-info');
            info.style.display = 'inline-flex';
            if (dot) {
                if (activeLayer) {
                    dot.innerHTML = symbolGlyph(activeLayer);
                    dot.style.background = 'transparent';
                    dot.style.color = activeLayer.color || '#2563eb';
                } else {
                    dot.innerHTML = '';
                    dot.style.background = '#2563eb';
                    dot.style.color = '';
                }
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

            const layerTypeStr = String(activeLayer?.type || activeLayer?.takeoff_type || '').toLowerCase();
            const isLinear = Boolean((activeLayer && layerTypeStr.includes('linear'))
                || selectionState.selectedObjectType === 'segment');
            nextActionMode = isLinear ? 'item-linear' : 'item-single';
            const addNodeHtml = isLinear ? `
                    <button type="button" class="subhead-item-act-btn" data-subhead-item-action="add-node" title="Add node to adjust line">
                        <i class="fas fa-bezier-curve"></i><span>Add Node</span>
                    </button>
            ` : '';

            if (actionsContainer && prevActionMode !== nextActionMode) {
                actionsContainer.innerHTML = `
                    ${addNodeHtml}
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
            nextActionMode = '';
            info.classList.remove('is-visible', 'is-group-info');
            info.style.display = 'none';
        }
        info.dataset.subheadActionMode = nextActionMode;
        if (prevActionMode !== nextActionMode) {
            syncTakeoffSubheadAlignment();
        }
    }
    window.updateTakeoffSubheadInfo = updateSubheadSelectedItem;

    function setActiveTakeoffLayer(layerId, rerender = true, options = {}) {
        const layer = findLayer(layerId);
        if (!layer) return;

        takeoffState.activeLayerId = layer.id;
        takeoffState.activeGroupId = layer.groupId;
        applyLayerToCanvas(layer, {
            skipLayerSync: options.skipLayerSync !== false,
            fast: options.fast !== false
        });
        saveTakeoffState({
            skipEstimatingSync: options.skipEstimatingSync !== false,
            suppressDirty: options.suppressDirty !== false,
            debounceLocalSave: true
        });
        if (rerender && !patchTakeoffSelectionClassesDom()) renderTakeoffPanel();
        else renderActiveLayerToolbar();
        updateSubheadSelectedItem();
        if ($('takeoffDrawingDropdown')?.classList.contains('open')) renderDrawingDropdown();
    }

    function selectTakeoffContext(layerId, rerender = true) {
        const layer = findLayer(layerId);
        if (!layer) return;
        const activeChanged = String(takeoffState.activeLayerId || '') !== String(layer.id)
            || String(takeoffState.activeGroupId || '') !== String(layer.groupId || '');
        takeoffState.activeLayerId = layer.id;
        takeoffState.activeGroupId = layer.groupId;
        if (rerender && activeChanged && !patchTakeoffSelectionClassesDom()) renderTakeoffPanel();
        else renderActiveLayerToolbar();
        updateSubheadSelectedItem();
        if ($('takeoffDrawingDropdown')?.classList.contains('open')) renderDrawingDropdown();
    }

    function clearActiveTakeoffLayer(rerender = true) {
        takeoffState.activeLayerId = null;
        callEditor('projectTakeoffClearActiveLayer');
        saveTakeoffState({
            skipEstimatingSync: true,
            suppressDirty: true,
            debounceLocalSave: true
        });
        if (rerender && !patchTakeoffSelectionClassesDom()) renderTakeoffPanel();
        else renderActiveLayerToolbar();
        updateSubheadSelectedItem();
        if ($('takeoffDrawingDropdown')?.classList.contains('open')) renderDrawingDropdown();
    }

    function syncVisibilityToEditorBatch(layers, visible) {
        const list = (layers || []).filter(Boolean);
        if (!list.length) return;
        const win = takeoffWindow();
        if (win && typeof win.projectTakeoffSetLayersVisibility === 'function') {
            win.projectTakeoffSetLayersVisibility(list.map(layer => ({ id: layer.id, visible: Boolean(visible) })));
        } else {
            list.forEach(layer => callEditor('projectTakeoffSetLayerVisibility', layer.id, Boolean(visible)));
        }
    }

    function toggleLayerVisibility(layerId, visible) {
        const layer = findLayer(layerId);
        if (!layer) return;
        layer.visible = Boolean(visible);
        pushTakeoffHistory('toggle-layer-visibility');
        syncVisibilityToEditorBatch([layer], layer.visible);
        saveTakeoffState({ skipEstimatingSync: true, debounceLocalSave: true });
        renderTakeoffPanel();
    }

    function toggleGroupVisibility(groupId, visible) {
        const group = findGroup(groupId);
        if (!group) return;
        const targetVisible = Boolean(visible);
        pushTakeoffHistory('toggle-group-visibility');
        (group.layers || []).forEach(layer => {
            layer.visible = targetVisible;
        });
        syncVisibilityToEditorBatch(group.layers || [], targetVisible);
        saveTakeoffState({ skipEstimatingSync: true, debounceLocalSave: true });
        renderTakeoffPanel();
    }

    function applyLayerToCanvas(layer, options = {}) {
        const win = takeoffWindow();
        if (!win) return;
        if (options.skipLayerSync === false) syncAllLayersToCanvas();
        const payload = layerCanvasPayload(layer);
        win.__projectActiveTakeoffLayer = payload;
        callEditor('projectTakeoffActivateLayer', payload, { fast: options.fast !== false });
        if (isLinearType(layer.type) || layer.type === 'Count by distance') setActiveTool('linear');
        else if (isAreaType(layer.type)) setActiveTool('area');
        else setActiveTool('count');
    }

    const fastDrawingLayerQty = new Map();

    function handleFastLayerQtyUpdate(payload = {}) {
        if (!payload?.layerId) return false;
        const estimateId = String(payload.estimateId || payload.estimateKey || activeEstimateId());
        if (estimateId && estimateId !== activeEstimateId()) return false;
        const remoteId = String(payload.layerId);
        const layer = findLayer(remoteId) || allLayers().find(row => String(row.id) === remoteId
            || String(row.client_uid || '') === remoteId);
        if (!layer) return false;
        const doc = activeDrawingDoc();
        const rawDocId = Number(payload.drawingId || payload.drawing_id || doc?.id || 0);
        const docKey = rawDocId > 0 ? String(rawDocId) : 'active';
        const cacheKey = `${estimateId}:${docKey}:${String(layer.id)}`;
        let prevDrawingQty = fastDrawingLayerQty.get(cacheKey);
        if (prevDrawingQty === undefined) {
            const snap = takeoffState.canvasSnapshots?.[`${estimateId}:${docKey}`]
                || takeoffState.canvasSnapshots?.[`${estimateId}:active`];
            const remote = snap?.layers?.find(r => String(r.id || r.layerId || '') === remoteId || String(r.id || '') === String(layer.id));
            if (remote) {
                const rawShapes = remote.shapes || remote.takeoffObjects || [];
                const remoteBase = Number(remote.baseQuantity ?? layer.baseQuantity ?? 0);
                if (rawShapes.length) {
                    const shapeSum = rawShapes.reduce((s, o) => s + Number(o?.quantityValue ?? o?.quantity ?? 0), 0);
                    prevDrawingQty = remoteBase + shapeSum;
                } else {
                    prevDrawingQty = Number(remote.quantity ?? layer.quantity ?? 0);
                }
            } else {
                prevDrawingQty = Number(layer.quantity || 0);
            }
        }
        const nextDrawingQty = Number(payload.quantity || 0);
        fastDrawingLayerQty.set(cacheKey, nextDrawingQty);
        layer.quantity = Math.max(0, Number(layer.quantity || 0) + (nextDrawingQty - prevDrawingQty));
        if (payload.userDirty) takeoffIsDirty = true;
        if (!patchTakeoffLayerRowQuantityDom(layer)) renderTakeoffPanel();
        if (String(takeoffState.activeLayerId || '') === String(layer.id)) updateSubheadSelectedItem();
        saveTakeoffState({ debounceEstimatingSync: true, suppressDirty: !payload.userDirty });
        return true;
    }

    function syncTakeoffFromCanvasSnapshot(snapshot, options = {}) {
        if (!snapshot || !Array.isArray(snapshot.layers)) return;
        const estimateId = String(snapshot.estimateId || snapshot.estimateKey || activeEstimateId());
        if (estimateId && estimateId !== activeEstimateId()) return;
        const doc = activeDrawingDoc();
        const rawDocId = Number(snapshot.drawingId || snapshot.drawing_id || doc?.id || 0);
        const documentId = rawDocId > 0 ? String(rawDocId) : 'active';
        fastDrawingLayerQty.clear();
        const prevActiveLayerId = takeoffState.activeLayerId;
        let lockOrUomChanged = false;
        if (rawDocId > 0 && takeoffState.canvasSnapshots?.[`${estimateId}:active`]) {
            delete takeoffState.canvasSnapshots[`${estimateId}:active`];
        }
        takeoffState.canvasSnapshots[`${estimateId}:${documentId}`] = {
            ...snapshot,
            estimateId,
            documentId,
            drawingId: rawDocId > 0 ? rawDocId : (snapshot.drawingId || null),
            updatedAt: Date.now()
        };
        if (rawDocId > 0) docSummaryMemo.delete(rawDocId);
        if (snapshot.userDirty === true || snapshot.dirty === true) {
            takeoffIsDirty = true;
        }
        snapshot.layers.forEach(remote => {
            const remoteId = String(remote.id || remote.layerId || '');
            const layer = findLayer(remoteId) || allLayers().find(row => String(row.id) === remoteId
                || String(row.client_uid || '') === remoteId
                || (layerBelongsToEstimate(row, estimateId) && (String(row.id) === remoteId || String(row.client_uid || '') === remoteId)));
            if (!layer) return;
            layer.shapes = remote.shapes || [];
            layer.takeoffObjects = remote.shapes || [];
            // Canvas snapshots report current state, but selection/state events
            // must never act as visibility commands. Only explicit eye/checkbox
            // actions are allowed to mutate layer.visible.
            if (remote.unit_of_measure || remote.uom) {
                const nextUom = remote.unit_of_measure || remote.uom;
                if (nextUom !== layer.uom) lockOrUomChanged = true;
                layer.uom = nextUom;
            }
            if (remote.locked !== undefined) {
                const nextLocked = Boolean(remote.locked);
                if (nextLocked !== Boolean(layer.locked)) lockOrUomChanged = true;
                layer.locked = nextLocked;
            }
            if (remote.catalogMetadata) {
                layer.catalogMetadata = window.CatalogMetadata.clone(remote.catalogMetadata);
                layer.metadata_json = window.CatalogMetadata.mergeMetadata(layer.metadata_json, remote.catalogMetadata);
            }
        });
        applyAggregatedCanvasQuantities();
        if (snapshot.activeLayerId && findLayer(snapshot.activeLayerId)) {
            takeoffState.activeLayerId = snapshot.activeLayerId;
        } else if (snapshot.activeLayerId === null || snapshot.activeLayerId === '') {
            takeoffState.activeLayerId = null;
        }
        if (!options.suppressEstimatingSync) {
            saveTakeoffState({
                debounceEstimatingSync: !options.immediateEstimatingSync,
                suppressDirty: !(snapshot.userDirty === true || snapshot.dirty === true)
            });
        }
        const canPatchOnly = !lockOrUomChanged
            && prevActiveLayerId === takeoffState.activeLayerId
            && !String(takeoffState.searchQuery || '').trim()
            && patchAllTakeoffLayerQuantityDom();
        if (!canPatchOnly) renderTakeoffPanel();
        if (canPatchOnly && !($('takeoffViewerLayersPopover')?.hidden ?? true)) {
            renderViewerLayersPopover();
        } else if (!canPatchOnly) {
            renderViewerLayersPopover();
        }
        renderActiveLayerToolbar();
        updateSubheadSelectedItem();
    }

    function applyAggregatedCanvasQuantities() {
        const totals = new Map();
        const avgStats = new Map();
        const canonicalKeyMap = new Map();
        const avgLayerMeta = new Map();
        const activeEst = activeEstimateId();
        const snapshots = Object.entries(takeoffState.canvasSnapshots || {});
        const seenDocKeys = new Set();
        const seenObjectIdsAcrossSnapshots = new Set();
        const hasNumericDocSnapshot = snapshots.some(([, s]) =>
            String(s?.estimateId || s?.estimateKey || '') === activeEst && Number(s?.drawingId || s?.drawing_id || 0) > 0
        );
        const layerBaseMap = new Map();
        allLayers().forEach(layer => {
            if (!layerBelongsToEstimate(layer, activeEst)) return;
            const baseVal = Number(layer.baseQuantity || 0);
            const dropVal = Number(layer.dropLength ?? layer.drop_length ?? 0);
            const multVal = Number(layer.multiplier ?? layer.metadata_json?.multiplier ?? 1) || 1;
            const isAvgDrop = normalizeTakeoffType(layer.type) === 'Linear avg. with drop';
            const primaryKey = layer.id !== undefined && layer.id !== null ? String(layer.id) : String(layer.client_uid || '');
            if (layer.id !== undefined && layer.id !== null) {
                const idKey = String(layer.id);
                layerBaseMap.set(idKey, baseVal);
                canonicalKeyMap.set(idKey, primaryKey);
                if (isAvgDrop) avgLayerMeta.set(idKey, { dropLength: dropVal, multiplier: multVal });
            }
            if (layer.client_uid) {
                const uidKey = String(layer.client_uid);
                layerBaseMap.set(uidKey, baseVal);
                canonicalKeyMap.set(uidKey, primaryKey);
                if (isAvgDrop) avgLayerMeta.set(uidKey, { dropLength: dropVal, multiplier: multVal });
            }
        });
        snapshots.forEach(([, snapshot]) => {
            if (!snapshot || String(snapshot.estimateId || snapshot.estimateKey || '') !== activeEst) return;
            const numericDocId = Number(snapshot.drawingId || snapshot.drawing_id || 0);
            if (numericDocId <= 0 && hasNumericDocSnapshot) return;
            const docDedupeKey = numericDocId > 0 ? String(numericDocId) : String(snapshot.documentId || 'active');
            if (seenDocKeys.has(docDedupeKey)) return;
            seenDocKeys.add(docDedupeKey);
            const seenLayerIdsInSnap = new Set();
            (snapshot.layers || []).forEach(remote => {
                const id = String(remote.id || remote.layerId || '');
                const canonId = canonicalKeyMap.get(id) || id;
                if (!id || seenLayerIdsInSnap.has(canonId)) return;
                seenLayerIdsInSnap.add(canonId);
                const rawObjects = remote.shapes || remote.takeoffObjects || [];
                const seenObjIds = new Set();
                const avgMeta = avgLayerMeta.get(id) || avgLayerMeta.get(canonId);
                const isAvgDrop = Boolean(avgMeta) || normalizeTakeoffType(remote.takeoff_type || remote.type) === 'Linear avg. with drop';
                let objectTotal = 0;
                let hasObjects = false;
                rawObjects.forEach((obj, idx) => {
                    if (!obj || typeof obj !== 'object') return;
                    const explicitObjectId = obj.id || obj.client_uid || '';
                    const oid = String(explicitObjectId || `idx_${idx}`);
                    if (seenObjIds.has(oid)) return;
                    seenObjIds.add(oid);
                    if (explicitObjectId) {
                        const globalObjectId = String(explicitObjectId);
                        if (seenObjectIdsAcrossSnapshots.has(globalObjectId)) return;
                        seenObjectIdsAcrossSnapshots.add(globalObjectId);
                    }
                    hasObjects = true;
                    if (isAvgDrop) {
                        const stats = avgStats.get(canonId) || {
                            sumRounded: 0,
                            count: 0,
                            dropLength: Number(avgMeta?.dropLength ?? remote.dropLength ?? remote.drop_length ?? 0),
                            multiplier: Number(avgMeta?.multiplier ?? remote.multiplier ?? 1) || 1
                        };
                        const roundedSeg = obj.roundedLength !== undefined && obj.roundedLength !== null
                            ? Number(obj.roundedLength)
                            : Math.round(Number(obj.horizontalLength ?? obj.quantityValue ?? obj.quantity ?? 0));
                        stats.sumRounded += Number.isFinite(roundedSeg) ? roundedSeg : 0;
                        stats.count += 1;
                        avgStats.set(canonId, stats);
                    } else {
                        objectTotal += Number(obj.quantityValue ?? obj.quantity ?? 0);
                    }
                });
                const localBase = Number(layerBaseMap.get(id) || 0);
                const remoteBase = Math.max(
                    localBase,
                    Number(remote.baseQuantity ?? remote.base_quantity ?? remote.seedQuantity ?? remote.seed_quantity ?? 0)
                );
                const remoteMeasured = Math.max(0, Number(remote.quantity || 0) - remoteBase);
                // Count snapshots from older/editor-loading paths may expose the
                // aggregate quantity before their marker objects are hydrated.
                // Subtracting effective base ensures base + base never doubles.
                const measured = hasObjects ? objectTotal : remoteMeasured;
                totals.set(canonId, (totals.get(canonId) || 0) + measured);
            });
        });
        allLayers().forEach(layer => {
            // A layer absent from the snapshots has not been observed as empty.
            // Preserve its persisted quantity until its drawing is hydrated;
            // overwriting it here made Count/Part items disappear while linear
            // layers on the active sheet continued to calculate normally.
            const idKey = String(layer.id);
            const uidKey = String(layer.client_uid || '');
            const canonId = canonicalKeyMap.get(idKey) || canonicalKeyMap.get(uidKey) || idKey;
            const stats = avgStats.get(canonId);
            if (normalizeTakeoffType(layer.type) === 'Linear avg. with drop' && stats && stats.count > 0) {
                const base = Number(layer.baseQuantity || 0);
                const drop = Number(layer.dropLength ?? layer.drop_length ?? stats.dropLength ?? 0);
                const mult = Number(layer.multiplier ?? layer.metadata_json?.multiplier ?? stats.multiplier ?? 1) || 1;
                layer.quantity = Math.round((base + ((stats.sumRounded / stats.count) + drop) * mult) * 10000) / 10000;
                return;
            }
            const hasTotal = totals.has(canonId) || totals.has(idKey) || (uidKey && totals.has(uidKey));
            if (!hasTotal) return;
            const base = Number(layer.baseQuantity || 0);
            const totalVal = totals.has(canonId)
                ? totals.get(canonId)
                : (totals.has(idKey) ? totals.get(idKey) : totals.get(uidKey));
            layer.quantity = base + totalVal;
        });
    }

    const takeoffViewerController = window.TakeoffViewerController.create({
        state: {
            viewerState,
            takeoffState,
            selectionState,
            drawingState
        },
        dom: {
            getElement: $,
            document,
            window
        },
        actions: {
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
        }
    });

    function ensureViewerLayersPopover(...args) {
        return takeoffViewerController.ensureViewerLayersPopover(...args);
    }

    function renderViewerLayersPopover(...args) {
        return takeoffViewerController.renderViewerLayersPopover(...args);
    }

    function openViewerLayersPopover(...args) {
        return takeoffViewerController.openViewerLayersPopover(...args);
    }

    function closeViewerLayersPopover(...args) {
        return takeoffViewerController.closeViewerLayersPopover(...args);
    }

    function toggleViewerLayersPopover(...args) {
        return takeoffViewerController.toggleViewerLayersPopover(...args);
    }

    function toggleGrid(...args) {
        return takeoffViewerController.toggleGrid(...args);
    }

    function ensureTakeoffOverlays(...args) {
        return takeoffViewerController.ensureTakeoffOverlays(...args);
    }

    function renderActiveLayerToolbar(...args) {
        return takeoffViewerController.renderActiveLayerToolbar(...args);
    }

    function renderSelectionBar(...args) {
        return takeoffViewerController.renderSelectionBar(...args);
    }

    function clearAllSelections(...args) {
        return takeoffViewerController.clearAllSelections(...args);
    }

    function setSelectedObjects(...args) {
        return takeoffViewerController.setSelectedObjects(...args);
    }

    function toggleGroupSelection(...args) {
        return takeoffViewerController.toggleGroupSelection(...args);
    }

    function setGroupSelection(...args) {
        return takeoffViewerController.setGroupSelection(...args);
    }

    function selectSingleLayer(...args) {
        return takeoffViewerController.selectSingleLayer(...args);
    }

    function toggleLayerSelection(...args) {
        return takeoffViewerController.toggleLayerSelection(...args);
    }

    function toggleLayerLock(...args) {
        return takeoffViewerController.toggleLayerLock(...args);
    }

    function runSelectionAction(...args) {
        return takeoffViewerController.runSelectionAction(...args);
    }

    function runLayerTool(...args) {
        return takeoffViewerController.runLayerTool(...args);
    }

    function openComparePanel(...args) {
        return takeoffViewerController.openComparePanel(...args);
    }

    function runCompareAction(...args) {
        return takeoffViewerController.runCompareAction(...args);
    }

    function toggleMoreToolsPanel(...args) {
        return takeoffViewerController.toggleMoreToolsPanel(...args);
    }

    function openTakeoffContextMenu(...args) {
        return takeoffViewerController.openTakeoffContextMenu(...args);
    }

    function handleTakeoffAction(...args) {
        return takeoffViewerController.handleTakeoffAction(...args);
    }

    function bindTakeoffActionDelegation(...args) {
        return takeoffViewerController.bindTakeoffActionDelegation(...args);
    }

    function toggleGlobalVisibility(...args) {
        return takeoffViewerController.toggleGlobalVisibility(...args);
    }

    function exportTakeoffQuantities(...args) {
        return takeoffViewerController.exportTakeoffQuantities(...args);
    }

    function setActiveTool(...args) {
        return takeoffViewerController.setActiveTool(...args);
    }

    function runTool(...args) {
        return takeoffViewerController.runTool(...args);
    }

    function runViewerCommand(...args) {
        return takeoffViewerController.runViewerCommand(...args);
    }

    function showPrepared(...args) {
        return takeoffViewerController.showPrepared(...args);
    }

    function getTakeoffBoundary(...args) {
        return takeoffViewerController.getTakeoffBoundary(...args);
    }

    function positionRowMenu(...args) {
        return takeoffViewerController.positionRowMenu(...args);
    }

    function toggleRowMenu(...args) {
        return takeoffViewerController.toggleRowMenu(...args);
    }

    function refreshOpenRowMenu(...args) {
        return takeoffViewerController.refreshOpenRowMenu(...args);
    }

    function clearActiveRowMenuAnchor(...args) {
        return takeoffViewerController.clearActiveRowMenuAnchor(...args);
    }
    const takeoffScaleController = window.TakeoffScaleController.create({
        dom: {
            getElement: $,
            document,
            window
        },
        actions: {
            takeoffWindow,
            callEditor,
            syncTakeoffSubheadAlignment,
            requireWrite,
            showToast: (...args) => window.showToast?.(...args)
        }
    });

    function editorDocument(...args) {
        return takeoffScaleController.editorDocument(...args);
    }

    function syncScaleStatus(...args) {
        return takeoffScaleController.syncScaleStatus(...args);
    }

    function hasScaleSet(...args) {
        return takeoffScaleController.hasScaleSet(...args);
    }

    function syncScaleHint(...args) {
        return takeoffScaleController.syncScaleHint(...args);
    }

    function syncScalePresets(...args) {
        return takeoffScaleController.syncScalePresets(...args);
    }

    function setScaleMode(...args) {
        return takeoffScaleController.setScaleMode(...args);
    }

    function openScalePanel(...args) {
        return takeoffScaleController.openScalePanel(...args);
    }

    function closeScalePanel(...args) {
        return takeoffScaleController.closeScalePanel(...args);
    }

    function applyScalePreset(...args) {
        return takeoffScaleController.applyScalePreset(...args);
    }

    function applyManualScale(...args) {
        return takeoffScaleController.applyManualScale(...args);
    }

    function bindScalePanel(...args) {
        return takeoffScaleController.bindScalePanel(...args);
    }
    let isDropdownScrolling = false;
    let dropdownScrollTimer = null;
    let activeSheetHoverTimer = null;
    let dropdownScrollBound = false;
    let documentListDelegationBound = false;
    let sheetListDelegationBound = false;
    let sheetVirtualModel = null;
    let sheetVirtualFrame = null;
    let sheetPreviewScheduler = null;
    let lastSheetPointer = null;
    const SHEET_VIRTUAL_THRESHOLD = 60;
    const SHEET_VIRTUAL_ROW_HEIGHT = 33;
    const SHEET_VIRTUAL_OVERSCAN = 8;

    function ensureDrawingDropdownPortal() {
        const panel = $('takeoffDrawingDropdown');
        if (!panel) return null;
        const canvasShell = $('takeoffCanvasShell') || document.querySelector('.pro-canvas-shell');
        if (!canvasShell) return null;
        let overlay = $('takeoffDrawingModalOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'takeoffDrawingModalOverlay';
            overlay.className = 'pro-drawing-modal-overlay';
            overlay.setAttribute('aria-hidden', 'true');
            canvasShell.appendChild(overlay);
        } else if (overlay.parentElement !== canvasShell) {
            canvasShell.appendChild(overlay);
        }
        if (overlay.dataset.closeBound !== 'true') {
            overlay.dataset.closeBound = 'true';
            overlay.addEventListener('click', event => {
                if (event.target === overlay) closeDrawingDropdown();
            });
        }
        if (panel.parentElement !== overlay) overlay.appendChild(panel);
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'takeoffDrawingDialogTitle');
        panel.style.removeProperty('left');
        panel.style.removeProperty('top');
        panel.style.removeProperty('width');
        panel.style.removeProperty('height');
        panel.style.removeProperty('max-width');
        panel.style.removeProperty('max-height');
        panel.style.removeProperty('transform');
        return panel;
    }

    function syncDrawingDropdownOverlay() {
        const panel = ensureDrawingDropdownPortal();
        const overlay = panel?.parentElement;
        if (!panel || !overlay?.classList.contains('pro-drawing-modal-overlay')) return;
        overlay.classList.toggle('open', drawingState.dropdownOpen);
        overlay.setAttribute('aria-hidden', drawingState.dropdownOpen ? 'false' : 'true');
    }

    function bindDropdownScrollGuards() {
        if (dropdownScrollBound) return;
        const docBox = $('takeoffDocumentList');
        const sheetBox = $('takeoffSheetList');
        if (!docBox && !sheetBox) return;
        dropdownScrollBound = true;
        const onScroll = () => {
            isDropdownScrolling = true;
            scheduleVirtualSheetWindow();
            if (activeSheetHoverTimer) {
                clearTimeout(activeSheetHoverTimer);
                activeSheetHoverTimer = null;
            }
            if (dropdownScrollTimer) clearTimeout(dropdownScrollTimer);
            dropdownScrollTimer = setTimeout(() => {
                isDropdownScrolling = false;
                renderVirtualSheetWindow(true);
                if (lastSheetPointer && typeof document.elementFromPoint === 'function') {
                    const pointedRow = document.elementFromPoint(lastSheetPointer.x, lastSheetPointer.y)?.closest?.('.pro-sheet-row');
                    if (pointedRow) sheetPreviewScheduler?.(pointedRow);
                }
            }, 150);
        };
        docBox?.addEventListener('scroll', onScroll, { passive: true });
        sheetBox?.addEventListener('scroll', onScroll, { passive: true });
    }

    function scheduleVirtualSheetWindow() {
        if (!sheetVirtualModel || sheetVirtualFrame !== null) return;
        sheetVirtualFrame = requestAnimationFrame(() => {
            sheetVirtualFrame = null;
            renderVirtualSheetWindow();
        });
    }

    function renderVirtualSheetWindow(force = false) {
        const model = sheetVirtualModel;
        const box = $('takeoffSheetList');
        if (!model || !box || model.box !== box || !drawingState.dropdownOpen) return;
        const viewportHeight = Math.max(box.clientHeight || 0, SHEET_VIRTUAL_ROW_HEIGHT * 8);
        const start = Math.max(0, Math.floor(box.scrollTop / SHEET_VIRTUAL_ROW_HEIGHT) - SHEET_VIRTUAL_OVERSCAN);
        const visibleCount = Math.ceil(viewportHeight / SHEET_VIRTUAL_ROW_HEIGHT) + (SHEET_VIRTUAL_OVERSCAN * 2);
        const end = Math.min(model.items.length, start + visibleCount);
        if (!force && start === model.start && end === model.end) return;
        model.start = start;
        model.end = end;
        const topHeight = start * SHEET_VIRTUAL_ROW_HEIGHT;
        const bottomHeight = Math.max(0, (model.items.length - end) * SHEET_VIRTUAL_ROW_HEIGHT);
        box.innerHTML = `<div class="pro-sheet-virtual-spacer" style="height:${topHeight}px"></div>`
            + model.items.slice(start, end).map((item, offset) => model.renderRow(item, start + offset)).join('')
            + `<div class="pro-sheet-virtual-spacer" style="height:${bottomHeight}px"></div>`;
    }

    function renderSheetRows(box, items, renderRow, key) {
        if (items.length <= SHEET_VIRTUAL_THRESHOLD) {
            sheetVirtualModel = null;
            box.classList.remove('is-virtualized');
            box.innerHTML = items.map(renderRow).join('');
            return;
        }
        const previousKey = sheetVirtualModel?.key;
        if (previousKey !== key) box.scrollTop = 0;
        box.classList.add('is-virtualized');
        sheetVirtualModel = { box, items, renderRow, key, start: -1, end: -1 };
        renderVirtualSheetWindow(true);
    }

    function clearSheetRows(box, html) {
        sheetVirtualModel = null;
        box?.classList.remove('is-virtualized');
        if (box) box.innerHTML = html;
    }

    function bindSheetListDelegation() {
        if (sheetListDelegationBound) return;
        const box = $('takeoffSheetList');
        if (!box) return;
        sheetListDelegationBound = true;
        const cancelScheduledPreview = () => {
            if (activeSheetHoverTimer) clearTimeout(activeSheetHoverTimer);
            activeSheetHoverTimer = null;
        };
        const resolveTarget = row => {
            const attachmentId = Number(row?.dataset.attachmentDocId || 0);
            if (attachmentId > 0) {
                return { doc: attachmentImageDocs().find(item => Number(item.id) === attachmentId), page: 1, attachment: true };
            }
            return { doc: browsingDrawingDoc(), page: Number(row?.dataset.drawingPage || 1), attachment: false };
        };
        const schedulePreview = row => {
            if (!row || isDropdownScrolling) return;
            cancelScheduledPreview();
            activeSheetHoverTimer = setTimeout(() => {
                if (isDropdownScrolling || !row.isConnected) return;
                const target = resolveTarget(row);
                if (!target.doc) return;
                if (target.attachment) {
                    if (Number(drawingState.previewAttachmentDocId) === Number(target.doc.id)) return;
                    drawingState.previewAttachmentDocId = target.doc.id;
                } else if (drawingState.previewPage === target.page
                    && Number(drawingState.lastPreviewDocId) === Number(target.doc.id)) return;
                renderSheetPreview(target.doc, target.page, { debounce: false });
            }, 200);
        };
        sheetPreviewScheduler = schedulePreview;
        box.addEventListener('pointermove', event => {
            lastSheetPointer = { x: event.clientX, y: event.clientY };
        }, { passive: true });
        box.addEventListener('mouseover', event => {
            const row = event.target.closest('.pro-sheet-row');
            if (!row || row.contains(event.relatedTarget)) return;
            lastSheetPointer = { x: event.clientX, y: event.clientY };
            schedulePreview(row);
        });
        box.addEventListener('mouseout', event => {
            const row = event.target.closest('.pro-sheet-row');
            if (!row || row.contains(event.relatedTarget)) return;
            cancelScheduledPreview();
        });
        box.addEventListener('focusin', event => schedulePreview(event.target.closest('.pro-sheet-row')));
        box.addEventListener('focusout', cancelScheduledPreview);
        box.addEventListener('click', event => {
            const row = event.target.closest('.pro-sheet-row');
            if (!row) return;
            cancelScheduledPreview();
            const target = resolveTarget(row);
            if (!target.doc) return;
            if (target.attachment) drawingState.previewAttachmentDocId = target.doc.id;
            selectDrawingSheet(target.doc, target.page);
        });
    }

    function bindDocumentListDelegation() {
        if (documentListDelegationBound) return;
        const box = $('takeoffDocumentList');
        if (!box) return;
        documentListDelegationBound = true;
        box.addEventListener('click', event => {
            const button = event.target.closest('[data-drawing-doc]');
            if (!button) return;
            const rawTarget = button.dataset.drawingDoc;
            if (rawTarget === 'attachment') {
                drawingState.browseDocumentId = 'attachment';
                const images = attachmentImageDocs();
                if (!images.some(doc => Number(doc.id) === Number(drawingState.previewAttachmentDocId))) {
                    drawingState.previewAttachmentDocId = images[0]?.id || null;
                }
                renderDrawingDropdown();
                return;
            }
            drawingState.browseDocumentId = Number(rawTarget);
            drawingState.previewPage = 1;
            const doc = browsingDrawingDoc();
            if (doc && !doc.pageCount && doc.extension === 'pdf') {
                renderDrawingDropdown();
                showPreviewLoading();
                ensurePageCount(doc).then(() => {
                    if (!drawingState.dropdownOpen || Number(drawingState.browseDocumentId) !== Number(doc.id)) return;
                    renderDrawingDropdown();
                });
            } else {
                renderDrawingDropdown();
            }
        });
    }

    function openDrawingDropdown() {
        const panel = ensureDrawingDropdownPortal();
        const trigger = $('takeoffSheetSelect');
        if (!panel) return;
        drawingState.documents = drawingDocs();
        drawingState.dropdownOpen = true;
        panel.classList.add('open');
        trigger?.setAttribute('aria-expanded', 'true');
        syncDrawingDropdownOverlay();
        bindDropdownScrollGuards();
        bindDocumentListDelegation();
        bindSheetListDelegation();
        const doc = browsingDrawingDoc();
        if (doc && doc.id === drawingState.selectedDocumentId && drawingState.selectedPage) {
            drawingState.previewPage = drawingState.selectedPage;
        }
        renderDrawingDropdown();
        if (doc && doc.extension === 'pdf') {
            ensurePageCount(doc).then(() => {
                if (!drawingState.dropdownOpen) return;
                renderDrawingDropdown();
            });
        }
    }

    function closeDrawingDropdown() {
        drawingState.dropdownOpen = false;
        if (activeSheetHoverTimer) {
            clearTimeout(activeSheetHoverTimer);
            activeSheetHoverTimer = null;
        }
        cancelPreviewRendering();
        sheetVirtualModel = null;
        if (sheetVirtualFrame !== null) cancelAnimationFrame(sheetVirtualFrame);
        sheetVirtualFrame = null;
        $('takeoffDrawingDropdown')?.classList.remove('open');
        $('takeoffDrawingModalOverlay')?.classList.remove('open');
        $('takeoffDrawingModalOverlay')?.setAttribute('aria-hidden', 'true');
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
            if (isBrowsingAttachmentFolder()) {
                matchCount = attachmentImageDocs().filter(imgDoc => getSheetTakeoffSummary(imgDoc.id, 1)?.hasActiveItem).length;
            } else if (doc) {
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
        if (!drawingState.dropdownOpen) return;
        renderActiveDrawingItemBar();
        renderDocumentList();
        renderSheetList();
    }

    let isWarmingDrawingMeta = false;
    async function warmDrawingMetadata() {
        if (isWarmingDrawingMeta) return;
        isWarmingDrawingMeta = true;
        try {
            const targets = pdfDrawingDocs().filter(doc => !doc.pageCount).slice(0, 20);
            for (const doc of targets) {
                if (!drawingState.dropdownOpen) break;
                while (isDropdownScrolling && drawingState.dropdownOpen) {
                    await new Promise(r => setTimeout(r, 160));
                }
                if (!drawingState.dropdownOpen) break;
                if (doc.pageCount) continue;
                await ensurePageCount(doc);
                if (!drawingState.dropdownOpen) break;
                const rowCountEl = document.querySelector(`#takeoffDocumentList [data-drawing-doc="${doc.id}"] .pro-drawing-count`);
                if (rowCountEl && doc.pageCount) {
                    rowCountEl.textContent = String(doc.pageCount);
                }
                if (Number(doc.id) === Number(drawingState.browseDocumentId)) {
                    renderSheetList();
                }
                await new Promise(r => setTimeout(r, 90));
            }
        } finally {
            isWarmingDrawingMeta = false;
        }
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
        bindDocumentListDelegation();
        const allPdfs = pdfDrawingDocs();
        const allImages = attachmentImageDocs();
        const directoryTotal = allPdfs.length + (allImages.length > 0 ? 1 : 0);
        const totalCountBadge = $('takeoffDocTotalCount');
        if (totalCountBadge) totalCountBadge.textContent = directoryTotal;

        if (!drawingState.documents.length) {
            box.innerHTML = `<div class="pro-drawing-empty">
                <strong>No drawings uploaded yet</strong>
                <span>Upload drawings in Documents to start takeoff.</span>
            </div>`;
            return;
        }

        const activeLayer = typeof findLayer === 'function' ? findLayer(takeoffState.activeLayerId || selectionState.activeLayerId) : null;

        const pdfs = allPdfs.filter(doc => {
            if (!drawingState.query) return true;
            if (matchesDrawingQuery(doc)) return true;
            return buildSheets(doc).some(sheet => matchesDrawingQuery(doc, sheet));
        });

        const matchingImages = allImages.filter(doc => {
            if (!drawingState.query) return true;
            if ('attachment'.includes(drawingState.query)) return true;
            return matchesDrawingQuery(doc);
        });

        const browsingAttachments = isBrowsingAttachmentFolder();

        const renderPdfDocRow = doc => {
            const isSelected = !browsingAttachments && Number(doc.id) === Number(drawingState.browseDocumentId);
            const docMap = getDocTakeoffPageMap(doc.id);
            const docHasActiveItem = docMap.docHasActiveItem;
            const docHasAnyTakeoff = docMap.docHasAnyTakeoff;
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
        };

        const discApi = window.ProjectDocumentsDisciplines;
        let pdfRowsHtml = '';
        if (discApi && Array.isArray(discApi.list) && typeof discApi.classify === 'function') {
            const groupedPdfs = new Map(discApi.list.map(d => [d.key, []]));
            pdfs.forEach(doc => {
                const key = discApi.classify({
                    ...doc,
                    title: doc.name,
                    filename: doc.name,
                    folder_name: doc.folder || doc.folder_name || ''
                });
                if (!groupedPdfs.has(key)) groupedPdfs.set(key, []);
                groupedPdfs.get(key).push(doc);
            });
            pdfRowsHtml = discApi.list.map(disc => {
                const groupDocs = groupedPdfs.get(disc.key) || [];
                if (!groupDocs.length) return '';
                return `
                    <div class="pro-drawing-group-header" data-discipline-group="${esc(disc.key)}">
                        <span class="pro-drawing-group-title"><i class="${esc(disc.icon)}" style="color: ${esc(disc.color)};"></i> ${esc(disc.label)}</span>
                        <span class="pro-drawing-group-count">${groupDocs.length}</span>
                    </div>
                    ${groupDocs.map(renderPdfDocRow).join('')}`;
            }).join('');
        } else {
            pdfRowsHtml = pdfs.map(renderPdfDocRow).join('');
        }

        let attachmentFolderHtml = '';
        if (matchingImages.length > 0) {
            let folderHasActiveItem = false;
            let folderHasAnyTakeoff = false;
            matchingImages.forEach(imgDoc => {
                const summary = getSheetTakeoffSummary(imgDoc.id, 1);
                if (summary?.hasActiveItem) folderHasActiveItem = true;
                if (summary?.hasAnyTakeoff) folderHasAnyTakeoff = true;
            });
            attachmentFolderHtml = `
            <div class="pro-drawing-group-header" data-discipline-group="attachments">
                <span class="pro-drawing-group-title"><i class="fas fa-paperclip" style="color: #f59e0b;"></i> Attachments</span>
                <span class="pro-drawing-group-count">${matchingImages.length}</span>
            </div>
            <button class="pro-drawing-row pro-drawing-folder-row ${browsingAttachments ? 'active' : ''}" type="button" data-drawing-doc="attachment" title="Attachment (${matchingImages.length})">
                <span class="pro-drawing-info">
                    <i class="fas fa-folder pro-doc-icon" style="color: #f59e0b;"></i>
                    <span class="pro-drawing-name">Attachment</span>
                </span>
                <span class="pro-drawing-meta">
                    ${folderHasActiveItem ? `<span class="pro-drawing-item-dot" style="background: ${activeLayer?.color || '#2563eb'}" title="Contiene marcas de ${esc(activeLayer?.name || 'item activo')}"></span>` : (folderHasAnyTakeoff ? `<span class="pro-drawing-takeoff-dot" title="Contiene marcas de takeoff"></span>` : '')}
                    <span class="pro-drawing-count">${matchingImages.length}</span>
                </span>
            </button>`;
        }

        box.innerHTML = (pdfRowsHtml + attachmentFolderHtml) || '<div class="pro-drawing-empty">No drawings match your search.</div>';

    }

    function renderSheetList() {
        const box = $('takeoffSheetList');
        if (!box) return;
        bindDropdownScrollGuards();
        bindSheetListDelegation();

        const activeLayer = typeof findLayer === 'function' ? findLayer(takeoffState.activeLayerId || selectionState.activeLayerId) : null;

        if (isBrowsingAttachmentFolder()) {
            let imgDocs = attachmentImageDocs().filter(doc => {
                if (!drawingState.query || 'attachment'.includes(drawingState.query)) return true;
                return matchesDrawingQuery(doc);
            });

            const totalSheetBadge = $('takeoffSheetTotalCount');
            if (totalSheetBadge) totalSheetBadge.textContent = imgDocs.length;

            if (drawingState.filterMode === 'item') {
                imgDocs = imgDocs.filter(imgDoc => getSheetTakeoffSummary(imgDoc.id, 1)?.hasActiveItem);
            }

            if (!imgDocs.length) {
                clearSheetRows(box, `<div class="pro-drawing-empty">${drawingState.filterMode === 'item' ? 'Ninguna imagen contiene marcas del item activo.' : 'No attachments match your search.'}</div>`);
                showPreviewFallback('Select an attachment');
                return;
            }

            const activePreviewDoc = imgDocs.find(d => Number(d.id) === Number(drawingState.previewAttachmentDocId)) ||
                                     imgDocs.find(d => Number(d.id) === Number(drawingState.selectedDocumentId)) ||
                                     imgDocs[0];
            drawingState.previewAttachmentDocId = activePreviewDoc?.id || null;

            const renderAttachmentRow = (imgDoc, idx) => {
                const isCurrentEditorSheet = Number(imgDoc.id) === Number(drawingState.selectedDocumentId);
                const isPreviewActive = Number(imgDoc.id) === Number(drawingState.previewAttachmentDocId);
                const summary = getSheetTakeoffSummary(imgDoc.id, 1);
                const hasActiveMarks = summary.hasActiveItem;
                const activeCount = summary.activeItemMarks;

                return `<button class="pro-sheet-row ${isPreviewActive ? 'active' : ''} ${isCurrentEditorSheet ? 'is-editor-open' : ''}" type="button" data-attachment-doc-id="${imgDoc.id}" data-drawing-page="1" title="${esc(imgDoc.name)}">
                    <span class="pro-sheet-info">
                        <span class="pro-sheet-page-badge">Img ${idx + 1}</span>
                        <span class="pro-sheet-name">${esc(imgDoc.name)}</span>
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
                        ${isCurrentEditorSheet ? '<span class="pro-sheet-current-tag" title="Imagen abierta en el visor"><i class="fas fa-eye"></i></span>' : ''}
                    </span>
                </button>`;
            };
            renderSheetRows(box, imgDocs, renderAttachmentRow,
                `attachments:${drawingState.query}:${drawingState.filterMode}`);

            if (activePreviewDoc) {
                renderSheetPreview(activePreviewDoc, 1);
            }
            return;
        }

        const doc = browsingDrawingDoc();
        if (!doc) {
            clearSheetRows(box, '<div class="pro-drawing-empty">No drawing selected.</div>');
            showPreviewFallback('Select a drawing');
            return;
        }
        if (!doc.pageCount && doc.extension === 'pdf') {
            clearSheetRows(box, '<div class="pro-drawing-empty">Loading sheet list...</div>');
            return;
        }

        let sheets = buildSheets(doc).filter(sheet => matchesDrawingQuery(doc, sheet));

        const totalSheetBadge = $('takeoffSheetTotalCount');
        if (totalSheetBadge) totalSheetBadge.textContent = sheets.length;

        if (drawingState.filterMode === 'item') {
            sheets = sheets.filter(sheet => sheet.takeoffSummary?.hasActiveItem);
        }

        const renderPdfSheetRow = sheet => {
            const isCurrentEditorSheet = doc.id === drawingState.selectedDocumentId && sheet.pageNumber === drawingState.selectedPage;
            const isPreviewActive = sheet.pageNumber === (drawingState.previewPage || 1);
            const summary = sheet.takeoffSummary || EMPTY_SHEET_SUMMARY;
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
        };
        if (sheets.length) {
            renderSheetRows(box, sheets, renderPdfSheetRow,
                `pdf:${doc.id}:${doc.pageCount}:${drawingState.query}:${drawingState.filterMode}`);
        } else {
            clearSheetRows(box, `<div class="pro-drawing-empty">${drawingState.filterMode === 'item' ? 'Ninguna hoja contiene marcas del item activo.' : 'No sheets match your search.'}</div>`);
        }

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

    function waitForPreviewIdle() {
        return new Promise(resolve => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(() => resolve(), { timeout: 180 });
            } else {
                setTimeout(resolve, 32);
            }
        });
    }

    const PREVIEW_THUMB_CACHE_VERSION = 'white-v3';
    const PREVIEW_THUMB_MAX_DIMENSION = 800;
    const PREVIEW_DEBOUNCE_MS = 200;

    function previewThumbKey(doc, pageNumber) {
        const version = String(doc?.version || doc?.fileUrl || 'unknown');
        return `${PREVIEW_THUMB_CACHE_VERSION}:${doc?.id || 0}:${version}:${Number(pageNumber) || 1}:${PREVIEW_THUMB_MAX_DIMENSION}`;
    }

    function previewImageHtml(url, label) {
        return `<img class="pro-preview-image" src="${esc(url)}" alt="${esc(label)}" loading="lazy" decoding="async">`;
    }

    function showPreviewImage(box, url, label, key) {
        if (!box || !url) return;
        box.innerHTML = previewImageHtml(url, label);
        drawingState.previewRenderedKey = key;
    }

    function cancelPreviewRendering() {
        ++drawingState.thumbnailRequest;
        if (drawingState.previewDebounceTimer) {
            clearTimeout(drawingState.previewDebounceTimer);
            drawingState.previewDebounceTimer = null;
        }
        drawingState.previewDebounceResolve?.(false);
        drawingState.previewDebounceResolve = null;
        if (drawingState.previewObserver) {
            drawingState.previewObserver.disconnect();
            drawingState.previewObserver = null;
        }
        drawingState.previewObserverResolve?.(false);
        drawingState.previewObserverResolve = null;
        if (drawingState.activePreviewRenderTask && typeof drawingState.activePreviewRenderTask.cancel === 'function') {
            try { drawingState.activePreviewRenderTask.cancel(); } catch (_) {}
            drawingState.activePreviewRenderTask = null;
        }
        callEditor('takeoffCancelThumbnailRender');
        window.__TakeoffThumbService?.cancelTakeoffJobs?.();
        drawingState.previewPendingKey = null;
    }

    function waitForPreviewDebounce(requestId) {
        return new Promise(resolve => {
            if (drawingState.previewDebounceTimer) {
                clearTimeout(drawingState.previewDebounceTimer);
                drawingState.previewDebounceResolve?.(false);
            }
            drawingState.previewDebounceResolve = resolve;
            drawingState.previewDebounceTimer = setTimeout(() => {
                drawingState.previewDebounceTimer = null;
                drawingState.previewDebounceResolve = null;
                resolve(requestId === drawingState.thumbnailRequest && drawingState.dropdownOpen);
            }, PREVIEW_DEBOUNCE_MS);
        });
    }

    function waitForPreviewVisibility(box, requestId) {
        if (!box || !drawingState.dropdownOpen || requestId !== drawingState.thumbnailRequest) return Promise.resolve(false);
        const rect = box.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0
            && rect.bottom > 0 && rect.right > 0
            && rect.top < window.innerHeight && rect.left < window.innerWidth;
        if (isVisible || typeof window.IntersectionObserver !== 'function') return Promise.resolve(true);
        return new Promise(resolve => {
            drawingState.previewObserver?.disconnect();
            drawingState.previewObserverResolve?.(false);
            drawingState.previewObserverResolve = resolve;
            drawingState.previewObserver = new IntersectionObserver(entries => {
                if (!entries.some(entry => entry.isIntersecting)) return;
                drawingState.previewObserver?.disconnect();
                drawingState.previewObserver = null;
                drawingState.previewObserverResolve = null;
                resolve(requestId === drawingState.thumbnailRequest && drawingState.dropdownOpen);
            }, { root: null, threshold: 0.01 });
            drawingState.previewObserver.observe(box);
        });
    }

    function takePreviewCacheValue(cache, key) {
        if (!cache?.has(key)) return null;
        const value = cache.get(key);
        cache.delete(key);
        cache.set(key, value);
        return value;
    }

    function storeTakeoffPreviewThumb(key, url, options = {}) {
        if (!url) return;
        if (drawingState.thumbnailCache.has(key)) {
            const previousUrl = drawingState.thumbnailCache.get(key);
            drawingState.thumbnailCache.delete(key);
            if (previousUrl !== url && drawingState.ownedPreviewObjectUrls.delete(previousUrl)) {
                try { URL.revokeObjectURL(previousUrl); } catch (_) {}
            }
        }
        drawingState.thumbnailCache.set(key, url);
        if (options.ownedObjectUrl) drawingState.ownedPreviewObjectUrls.add(url);
        while (drawingState.thumbnailCache.size > drawingState.thumbnailCacheLimit) {
            const oldestKey = drawingState.thumbnailCache.keys().next().value;
            const oldestUrl = drawingState.thumbnailCache.get(oldestKey);
            drawingState.thumbnailCache.delete(oldestKey);
            if (drawingState.ownedPreviewObjectUrls.delete(oldestUrl)) {
                try { URL.revokeObjectURL(oldestUrl); } catch (_) {}
            }
        }
    }

    async function getViewerPreviewThumb(doc, targetPage, requestId) {
        const info = callEditor('takeoffGetDocumentInfo');
        if (!info || Number(info.fileId) !== Number(doc.id)) return null;
        const result = callEditor('takeoffRenderThumbnail', targetPage, PREVIEW_THUMB_MAX_DIMENSION);
        if (!result || typeof result.then !== 'function') return null;
        const url = await result;
        return requestId === drawingState.thumbnailRequest ? url : null;
    }

    async function renderSheetPreview(doc, pageNumber, options = {}) {
        const box = $('takeoffSheetPreview');
        if (!box || !doc) return;
        const targetPage = Math.max(1, Number(pageNumber) || 1);
        drawingState.previewPage = targetPage;

        const prevActive = document.querySelector('#takeoffSheetList .pro-sheet-row.active');
        const nextActive = doc.extension !== 'pdf'
            ? document.querySelector(`#takeoffSheetList .pro-sheet-row[data-attachment-doc-id="${doc.id}"]`)
            : document.querySelector(`#takeoffSheetList .pro-sheet-row[data-drawing-page="${targetPage}"]`);
        if (prevActive && prevActive !== nextActive) prevActive.classList.remove('active');
        if (nextActive && !nextActive.classList.contains('active')) nextActive.classList.add('active');

        const titleEl = $('takeoffPreviewTitle');
        const subEl = $('takeoffPreviewSub');
        if (titleEl) titleEl.textContent = sheetName(doc, targetPage);
        if (subEl) subEl.textContent = `Hoja ${targetPage} de ${doc.pageCount || 1} • ${doc.name || ''}`;

        const summary = getSheetTakeoffSummary(doc.id, targetPage);
        const countEl = $('takeoffPreviewItemCount');
        const listEl = $('takeoffPreviewItemsList');
        const openBtn = $('takeoffOpenSheetBtn');

        if (countEl) countEl.textContent = `${summary.layers.length} ${summary.layers.length === 1 ? 'item' : 'items'} (${summary.totalMarks} marcas)`;
        const previewActiveId = String(takeoffState.activeLayerId || selectionState.activeLayerId || '');
        const shouldRefreshDetails = drawingState.previewDetailsSummary !== summary
            || drawingState.previewDetailsActiveId !== previewActiveId;
        if (listEl && shouldRefreshDetails) {
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
            drawingState.previewDetailsSummary = summary;
            drawingState.previewDetailsActiveId = previewActiveId;
        }

        if (openBtn) {
            openBtn.disabled = false;
            openBtn.onclick = () => selectDrawingSheet(doc, targetPage);
        }

        if (doc.extension !== 'pdf') {
            const imageKey = `image:${doc.id}:${doc.version || doc.fileUrl || ''}`;
            if (drawingState.previewRenderedKey === imageKey && box.querySelector('img')) return;
            cancelPreviewRendering();
            drawingState.lastPreviewDocId = doc.id;
            showPreviewImage(box, doc.fileUrl, doc.name, imageKey);
            return;
        }
        const key = previewThumbKey(doc, targetPage);

        if (drawingState.previewRenderedKey === key && box.querySelector('img')) return;
        if (drawingState.previewPendingKey === key) return;
        cancelPreviewRendering();
        const requestId = drawingState.thumbnailRequest;
        drawingState.lastPreviewDocId = doc.id;

        const cachedUrl = takePreviewCacheValue(drawingState.thumbnailCache, key)
            || window.__TakeoffThumbService?.getCachedThumbUrl?.(doc, targetPage);
        if (cachedUrl) {
            storeTakeoffPreviewThumb(key, cachedUrl);
            showPreviewImage(box, cachedUrl, sheetName(doc, targetPage), key);
            return;
        }

        drawingState.previewPendingKey = key;
        showPreviewLoading();

        try {
            const debounceReady = options.debounce === false
                ? requestId === drawingState.thumbnailRequest && drawingState.dropdownOpen
                : await waitForPreviewDebounce(requestId);
            if (!debounceReady || !await waitForPreviewVisibility(box, requestId)) return;

            const viewerUrl = await getViewerPreviewThumb(doc, targetPage, requestId);
            if (requestId !== drawingState.thumbnailRequest || !drawingState.dropdownOpen) return;
            if (viewerUrl) {
                storeTakeoffPreviewThumb(key, viewerUrl);
                showPreviewImage(box, viewerUrl, sheetName(doc, targetPage), key);
                return;
            }

            if (window.__TakeoffThumbService?.getPersistedThumbUrl) {
                const persistedUrl = await window.__TakeoffThumbService.getPersistedThumbUrl(doc, targetPage);
                if (requestId !== drawingState.thumbnailRequest || !drawingState.dropdownOpen) return;
                if (persistedUrl) {
                    storeTakeoffPreviewThumb(key, persistedUrl);
                    showPreviewImage(box, persistedUrl, sheetName(doc, targetPage), key);
                    return;
                }
            }

            if (window.__TakeoffThumbService?.renderPreviewThumb) {
                const workerRes = await window.__TakeoffThumbService.renderPreviewThumb(doc, targetPage);
                if (requestId !== drawingState.thumbnailRequest || !drawingState.dropdownOpen) return;
                if (workerRes && workerRes.url) {
                    if (workerRes.numPages && !doc.pageCount) {
                        syncResolvedPageCountToState(doc, workerRes.numPages);
                    }
                    storeTakeoffPreviewThumb(key, workerRes.url);
                    showPreviewImage(box, workerRes.url, sheetName(doc, targetPage), key);
                    return;
                }
            }

            await waitForPreviewIdle();
            if (requestId !== drawingState.thumbnailRequest || !drawingState.dropdownOpen) return;
            if (requestId !== drawingState.thumbnailRequest) return;
            const pdf = await getPdfDocument(doc);
            if (requestId !== drawingState.thumbnailRequest || !pdf) return;
            const page = await pdf.getPage(targetPage);
            if (requestId !== drawingState.thumbnailRequest) {
                try { page.cleanup(); } catch (_) {}
                return;
            }
            const unscaled = page.getViewport({ scale: 1.0 });
            const largestSide = Math.max(unscaled.width || 1, unscaled.height || 1);
            const scale = Math.min(1, PREVIEW_THUMB_MAX_DIMENSION / largestSide);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { alpha: false });
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            ctx.save();
            ctx.globalCompositeOperation = 'copy';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
            const renderTask = page.render({ canvasContext: ctx, viewport, background: '#ffffff' });
            drawingState.activePreviewRenderTask = renderTask;
            try {
                await renderTask.promise;
            } finally {
                try { page.cleanup(); } catch (_) {}
                if (drawingState.activePreviewRenderTask === renderTask) {
                    drawingState.activePreviewRenderTask = null;
                }
            }
            if (requestId !== drawingState.thumbnailRequest) return;
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
            canvas.width = 0;
            canvas.height = 0;
            if (!blob || requestId !== drawingState.thumbnailRequest) return;
            const blobUrl = URL.createObjectURL(blob);
            storeTakeoffPreviewThumb(key, blobUrl, { ownedObjectUrl: true });
            showPreviewImage(box, blobUrl, sheetName(doc, targetPage), key);
        } catch (e) {
            if (e && (e.name === 'RenderingCancelledException' || String(e.message || '').includes('Rendering cancelled'))) {
                return;
            }
            console.warn('Thumbnail failed', e);
            if (requestId === drawingState.thumbnailRequest) showPreviewFallback('Preview unavailable');
        } finally {
            if (drawingState.previewPendingKey === key) drawingState.previewPendingKey = null;
        }
    }

    function syncProjectDocument(doc) {
        if (!doc) return;
        drawingState.selectedDocumentId = Number(doc.id);
        if (isImageDrawingDoc(doc)) {
            drawingState.browseDocumentId = 'attachment';
            drawingState.previewAttachmentDocId = Number(doc.id);
        } else {
            drawingState.browseDocumentId = Number(doc.id);
        }
        if (window.ProjectState) {
            window.ProjectState.selectedDocumentId = Number(doc.id);
            window.ProjectState.selectedDrawingId = Number(doc.id);
        }
        const download = document.getElementById('downloadDocBtn');
        if (download) download.href = doc.fileUrl || '#';
    }

    function showTakeoffCanvasLoader(text = 'Loading drawing...') {
        const stage = $('takeoffFrame')?.parentElement;
        if (!stage) return;
        let loader = document.getElementById('takeoffCanvasLoadingOverlay');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'takeoffCanvasLoadingOverlay';
            loader.className = 'takeoff-canvas-loading-overlay';
            loader.setAttribute('role', 'status');
            loader.setAttribute('aria-live', 'polite');
            loader.innerHTML = `
                <span class="doc-loading-spinner" aria-hidden="true"></span>
                <span class="takeoff-canvas-loading-text"></span>
            `;
            stage.appendChild(loader);
        }
        const txtEl = loader.querySelector('.takeoff-canvas-loading-text');
        if (txtEl) txtEl.textContent = text;
        loader.classList.add('is-active');
    }

    function hideTakeoffCanvasLoader() {
        if (drawingState.canvasSwitchFallbackTimer) {
            clearTimeout(drawingState.canvasSwitchFallbackTimer);
            drawingState.canvasSwitchFallbackTimer = null;
        }
        document.getElementById('takeoffCanvasLoadingOverlay')?.classList.remove('is-active');
    }

    function armTakeoffCanvasLoaderFallback(timeoutMs = 12000) {
        if (drawingState.canvasSwitchFallbackTimer) clearTimeout(drawingState.canvasSwitchFallbackTimer);
        drawingState.canvasSwitchFallbackTimer = setTimeout(() => {
            drawingState.canvasSwitchFallbackTimer = null;
            drawingState.pendingCanvasPage = null;
            document.getElementById('takeoffCanvasLoadingOverlay')?.classList.remove('is-active');
        }, timeoutMs);
    }
    window.showTakeoffCanvasLoader = showTakeoffCanvasLoader;
    window.hideTakeoffCanvasLoader = hideTakeoffCanvasLoader;

    function selectDrawingSheet(doc, pageNumber) {
        if (!doc || !window.canChangeTakeoffDrawing()) return;
        const targetPage = Math.max(1, Number(pageNumber) || 1);
        syncProjectDocument(doc);
        drawingState.selectedPage = targetPage;
        setDrawingLabel();
        closeDrawingDropdown();
        if (doc.source !== 'legacy_file') return;
        const frame = $('takeoffFrame');
        if (!frame) return;
        const nextSrc = takeoffEditorUrl(doc.id, activeEstimateId(), targetPage);
        let currentFrameId = 0;
        try {
            const currentUrl = new URL(frame.getAttribute('src') || '', window.location.href);
            currentFrameId = Number(currentUrl.searchParams.get('id') || 0);
        } catch (e) { }
        const currentInfo = currentFrameId === Number(doc.id) ? callEditor('takeoffGetDocumentInfo') : null;
        if (currentFrameId === Number(doc.id)
            && Number(currentInfo?.pageNum || 0) === targetPage
            && !drawingState.pendingCanvasPage) {
            hideTakeoffCanvasLoader();
            return;
        }
        drawingState.pendingCanvasPage = targetPage;
        showTakeoffCanvasLoader(`Cargando hoja ${targetPage}...`);
        armTakeoffCanvasLoaderFallback();
        if (currentFrameId !== Number(doc.id)) {
            drawingState.pendingPageJump = targetPage;
            frame.style.display = 'block';
            const switchFrame = async () => {
                try {
                    if (frame.contentWindow?.isEditorTakeoffDirty?.() && typeof frame.contentWindow?.projectTakeoffSave === 'function') {
                        await Promise.race([
                            Promise.resolve(frame.contentWindow.projectTakeoffSave()),
                            new Promise(resolve => setTimeout(resolve, 1500))
                        ]);
                    }
                } catch (_) { }
                frame.src = nextSrc;
            };
            switchFrame();
        } else {
            drawingState.pendingPageJump = null;
            callEditor('takeoffJumpToPage', targetPage);
        }
        $('takeoffEmpty')?.style.setProperty('display', 'none');
    }

    function orderedDirectoryDocuments() {
        const allPdfs = pdfDrawingDocs();
        const allImages = attachmentImageDocs();
        const discApi = window.ProjectDocumentsDisciplines;
        let orderedPdfs = allPdfs;
        if (discApi && Array.isArray(discApi.list) && typeof discApi.classify === 'function') {
            const grouped = new Map(discApi.list.map(d => [d.key, []]));
            allPdfs.forEach(doc => {
                const key = discApi.classify({
                    ...doc,
                    title: doc.name,
                    filename: doc.name,
                    folder_name: doc.folder || doc.folder_name || ''
                });
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(doc);
            });
            orderedPdfs = [];
            grouped.forEach(list => {
                if (list.length) orderedPdfs.push(...list);
            });
        }
        return [...orderedPdfs, ...allImages];
    }

    async function changeActiveSheet(delta) {
        const doc = activeDrawingDoc();
        if (!doc) return;
        const step = delta < 0 ? -1 : 1;
        const info = callEditor('takeoffGetDocumentInfo');
        const max = Number(info?.pageCount || doc.pageCount || 1);
        const current = Number(info?.pageNum || drawingState.selectedPage || 1);
        const next = current + step;
        doc.pageCount = max;
        if (next >= 1 && next <= max) {
            selectDrawingSheet(doc, next);
            return;
        }
        const ordered = orderedDirectoryDocuments();
        if (!ordered.length) return;
        const currentIdx = ordered.findIndex(item => Number(item.id) === Number(doc.id));
        const targetIdx = currentIdx === -1 ? (step > 0 ? 0 : ordered.length - 1) : currentIdx + step;
        if (targetIdx < 0 || targetIdx >= ordered.length) return;
        const targetDoc = ordered[targetIdx];
        if (!targetDoc) return;
        if (step > 0) {
            selectDrawingSheet(targetDoc, 1);
        } else {
            await ensurePageCount(targetDoc);
            const lastPage = Math.max(1, Number(targetDoc.pageCount || 1));
            selectDrawingSheet(targetDoc, lastPage);
        }
    }

    function syncEditorInfo() {
        const doc = activeDrawingDoc();
        const info = callEditor('takeoffGetDocumentInfo');
        if (doc && info?.pageCount) {
            doc.pageCount = Number(info.pageCount);
            doc.sheets = buildSheets(doc);
        }
        if (info?.pageNum && !drawingState.pendingPageJump) drawingState.selectedPage = Number(info.pageNum);
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
        $('takeoffDrawingSearch')?.addEventListener('input', event => {
            clearTimeout(event.target._takeoffSearchTimer);
            event.target._takeoffSearchTimer = setTimeout(() => {
                drawingState.query = event.target.value.trim().toLowerCase();
                renderDrawingDropdown();
            }, 120);
        });
        window.addEventListener('message', event => {
            if (event.data?.type === 'project-takeoff-canvas-pointerdown') {
                if (event.source !== takeoffWindow()) return;
                document.querySelectorAll('.pro-menu, .pro-row-menu').forEach(menu => menu.classList.remove('open'));
                document.querySelectorAll('[data-takeoff-menu-toggle], [data-row-menu]').forEach(btn => {
                    btn.classList.remove('is-active');
                    btn.setAttribute('aria-expanded', 'false');
                });
                clearActiveRowMenuAnchor();
                if (typeof window.closeAllOpenPopouts === 'function') window.closeAllOpenPopouts();
                closeScalePanel();
                closeDrawingDropdown();
                closeGroupContextMenu();
                $('takeoffMoreToolsPanel')?.setAttribute('hidden', '');
                return;
            }
            if (event.data?.type === 'project-takeoff-scale-required') {
                if (event.source !== takeoffWindow()) return;
                openScalePanel();
                showPrepared(event.data?.payload?.message || 'Set the drawing scale before adding linear items.');
                return;
            }
            if (event.data?.type === 'takeoff-editor-save-status') {
                if (event.source !== takeoffWindow()) return;
                const payload = event.data?.payload || {};
                const result = takeoffSaveCoordinator.handleStatus(payload);
                if (result.dirty !== null) takeoffIsDirty = result.dirty;
                return;
            }
            if (event.data?.type === 'project-takeoff-layer-qty') {
                if (event.source !== takeoffWindow()) return;
                handleFastLayerQtyUpdate(event.data.payload);
                return;
            }
            if (event.data?.type === 'project-takeoff-state') {
                if (event.source !== takeoffWindow()) return;
                syncTakeoffFromCanvasSnapshot(event.data.payload);
                return;
            }
            if (event.data?.type === 'project-takeoff-selection') {
                const payload = event.data.payload || {};
                selectionState.selectedObjectType = payload.objectType || payload.type || null;
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
                    } else selectTakeoffContext(payload.layerId, false);
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
                const protectedActiveTools = ['cloud', 'text', 'note', 'measure', 'freehand', 'pin'];
                const annotationPlacementActive = protectedActiveTools.includes(viewerState.activeTool);
                // The editor implements hand/pan on top of its internal smart
                // mode, so its `smart` report must not visually reselect Pointer
                // while the parent is actively panning or using protected tools.
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
            if (event.data?.type === 'project-takeoff-rulers-updated') {
                const payload = event.data.payload || {};
                takeoffRulersState.page = Number(payload.page || 1);
                takeoffRulersState.items = Array.isArray(payload.rulers) ? payload.rulers : [];
                renderTakeoffPanel();
                return;
            }
            if (event.data?.type === 'project-takeoff-ruler-selected') {
                const payload = event.data.payload || {};
                const nextRuler = payload.selected ? payload : null;
                const prevRulerId = selectionState.selectedRuler ? String(selectionState.selectedRuler.id || '') : null;
                const nextRulerId = nextRuler ? String(nextRuler.id || '') : null;
                selectionState.selectedRuler = nextRuler;
                if (prevRulerId !== nextRulerId) {
                    updateSubheadSelectedItem();
                    renderTakeoffPanel();
                }
                return;
            }
            if (event.data?.type === 'project-takeoff-note-selected') {
                const payload = event.data.payload || {};
                selectionState.selectedNote = payload.selected ? payload : null;
                updateSubheadSelectedItem();
                return;
            }
            if (event.data?.type === 'project-takeoff-cloud-selected') {
                const payload = event.data.payload || event.data || {};
                selectionState.selectedCloud = payload.selected ? payload : null;
                updateSubheadSelectedItem();
                return;
            }
            if (event.data?.type === 'project-takeoff-clear-active-layer') {
                clearActiveTakeoffLayer(true);
                clearAllSelections();
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
            if (event.data?.type === 'takeoff-canvas-blocked-by-estimating-override') {
                if (event.source !== takeoffWindow()) return;
                const payload = event.data?.payload || {};
                const qtyNum = Number(payload.estimatingQty || 0);
                const qtyStr = Number.isFinite(qtyNum) ? String(qtyNum) : '0';
                const uomStr = String(payload.uom || 'ea');
                if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.show === 'function') {
                    window.TakeoffAnnouncement.show({
                        id: 'user_alert_estimating_first_override',
                        perUser: true,
                        force: false,
                        type: 'warning',
                        badge: 'ESTIMATING QUANTITY ACTIVE',
                        icon: 'fas fa-triangle-exclamation',
                        title: 'Remove Manual Quantity in Estimating',
                        message: `"${payload.name || 'This item'}" already has a manual quantity placed in Estimating (${qtyStr} ${uomStr}). To count or measure it on the canvas, first remove or reset that quantity in Estimating.`,
                        primaryText: 'Got It',
                        showDontShow: true,
                        dontShowLabel: "Don't show this warning again"
                    });
                } else {
                    showToast(`Remove the manual quantity (${qtyStr} ${uomStr}) in Estimating before counting "${payload.name || 'this item'}" on the canvas.`, 'warning');
                }
                return;
            }
            if (event.data?.type === 'takeoff-editor-state-loaded') {
                if (event.source !== takeoffWindow()) return;
                const loadedEstKey = String(event.data?.payload?.estimateKey || activeEstimateId() || '').trim();
                const pendingDel = loadedEstKey ? pendingDeletedTakeoffLayersByEstimate.get(loadedEstKey) : null;
                if (pendingDel && pendingDel.size > 0) {
                    callEditor('projectTakeoffDeleteLayers', [...pendingDel], { force: true });
                }
                if (event.data?.payload?.remoteSync !== true) {
                    syncAllLayersToCanvas({ suppressEstimatingSync: true });
                }
                const active = findLayer(takeoffState.activeLayerId);
                if (active) applyLayerToCanvas(active, { skipLayerSync: true });
                return;
            }
            if (event.data?.type === 'takeoff-page-rendered') {
                if (event.source !== takeoffWindow()) return;
                const doc = activeDrawingDoc();
                const renderedPage = Number(event.data.page || 0);
                if (!doc || Number(event.data.fileId) !== Number(doc.id)) return;
                if (renderedPage !== Number(drawingState.selectedPage || 1)) return;
                drawingState.pendingCanvasPage = null;
                drawingState.selectedPage = renderedPage;
                window.__takeoffPageSwitchMetrics = {
                    durationMs: Number(event.data.durationMs || 0),
                    p50: Number(event.data.p50 || 0),
                    p95: Number(event.data.p95 || 0),
                    p99: Number(event.data.p99 || 0),
                    sampleCount: Number(event.data.sampleCount || 0)
                };
                hideTakeoffCanvasLoader();
                setDrawingLabel();
                syncScaleStatus(true);
                return;
            }
            if (event.data?.type !== 'takeoff-editor-ready') return;
            const doc = activeDrawingDoc();
            if (doc && Number(event.data.fileId) === Number(doc.id)) {
                const totalPages = Math.max(1, Number(event.data.pageCount || 1));
                syncResolvedPageCountToState(doc, totalPages);
                doc.sheets = buildSheets(doc);
                const pendingTarget = drawingState.pendingPageJump
                    ? Math.max(1, Math.min(totalPages, Number(drawingState.pendingPageJump) || 1))
                    : null;
                drawingState.pendingPageJump = null;
                if (pendingTarget && Number(event.data.pageNum || 1) !== pendingTarget) {
                    drawingState.selectedPage = pendingTarget;
                    callEditor('takeoffJumpToPage', pendingTarget);
                } else {
                    drawingState.selectedPage = Number(event.data.pageNum || 1);
                }
                setDrawingLabel();
                if (drawingState.dropdownOpen) renderDrawingDropdown();
                syncScalePresets();
                syncScaleStatus(true);
            }
            if (!drawingState.pendingCanvasPage) hideTakeoffCanvasLoader();
            const readyRulers = callEditor('getKonvaRulersSummary');
            if (Array.isArray(readyRulers)) {
                takeoffRulersState.page = Number(drawingState.selectedPage || 1);
                takeoffRulersState.items = readyRulers;
                renderTakeoffPanel();
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

    window.cloneTakeoffWorkspaceForEstimate = function (sourceEstimateId, targetEstimateId, copiedEstimate = null) {
        const srcEstId = String(sourceEstimateId || activeEstimateId() || '');
        const dstEstId = String(targetEstimateId || '');
        if (!srcEstId || !dstEstId || srcEstId === dstEstId) return null;

        const layerIdMap = {};
        const groupIdMap = {};
        const itemIdMap = {};
        const copiedEstGroups = Array.isArray(copiedEstimate?.groups) ? copiedEstimate.groups : [];
        const sourceGroups = takeoffState.groups.filter(g => groupBelongsToEstimate(g, srcEstId));

        takeoffState.groups = takeoffState.groups.filter(g => String(g.estimateId || '') !== dstEstId);

        const matchCopiedEstGroup = (srcGroup, idx) => {
            const byIdx = copiedEstGroups[idx];
            if (byIdx && String(byIdx.name || '') === String(srcGroup.name || '')) return byIdx;
            return copiedEstGroups.find(eg => String(eg.name || '') === String(srcGroup.name || '')) || byIdx || null;
        };

        const clonedGroups = sourceGroups.map((srcGroup, idx) => {
            const newGroupId = makeId('grp');
            const matchedEstGrp = matchCopiedEstGroup(srcGroup, idx);
            const newEstGroupId = matchedEstGrp ? String(matchedEstGrp.id) : `takeoff_group_${newGroupId}`;
            if (matchedEstGrp) matchedEstGrp.takeoffGroupId = newGroupId;
            groupIdMap[String(srcGroup.id)] = newGroupId;
            if (srcGroup.estimatingGroupId) groupIdMap[String(srcGroup.estimatingGroupId)] = newEstGroupId;

            const clonedLayers = (srcGroup.layers || []).map(srcLayer => {
                const newLayerId = makeId('layer');
                const srcLayerKeys = [
                    srcLayer.id,
                    srcLayer.client_uid,
                    srcLayer.integration_key,
                    srcLayer.metadata_json?.project_layer_id
                ].filter(Boolean).map(String);
                srcLayerKeys.forEach(k => { layerIdMap[k] = newLayerId; });

                let matchedEstItem = null;
                const findMatchInItems = (rows) => {
                    for (const it of (rows || [])) {
                        if (srcLayerKeys.includes(String(it.copiedFromTakeoffLayerId || it.takeoffLayerId || ''))) return it;
                        if (srcLayer.estimatingItemId && String(it.name || '') === String(srcLayer.name || '')) return it;
                    }
                    return null;
                };
                if (matchedEstGrp) matchedEstItem = findMatchInItems(matchedEstGrp.items);
                if (!matchedEstItem) {
                    for (const g of copiedEstGroups) {
                        matchedEstItem = findMatchInItems(g.items);
                        if (matchedEstItem) break;
                    }
                }
                if (matchedEstItem) {
                    matchedEstItem.takeoffLayerId = newLayerId;
                    matchedEstItem.source_layer_key = newLayerId;
                    if (srcLayer.estimatingItemId) itemIdMap[String(srcLayer.estimatingItemId)] = String(matchedEstItem.id);
                }

                const clonedMeta = srcLayer.metadata_json && typeof srcLayer.metadata_json === 'object'
                    ? JSON.parse(JSON.stringify(srcLayer.metadata_json))
                    : {};
                clonedMeta.project_layer_id = newLayerId;
                clonedMeta.estimate_id = dstEstId;
                clonedMeta.estimating_group_id = newEstGroupId;
                if (matchedEstItem) clonedMeta.estimating_item_id = String(matchedEstItem.id);
                if (srcLayer.tag) clonedMeta.tag = srcLayer.tag;
                if (srcLayer.multiplier !== undefined) clonedMeta.multiplier = Number(srcLayer.multiplier ?? 1);
                if (srcLayer.difficulty !== undefined) clonedMeta.difficulty = Number(srcLayer.difficulty ?? 1);

                const clonedShapes = Array.isArray(srcLayer.shapes)
                    ? srcLayer.shapes.map(sh => ({
                        ...JSON.parse(JSON.stringify(sh)),
                        id: makeId('shape'),
                        layerId: newLayerId
                    }))
                    : [];

                return {
                    ...JSON.parse(JSON.stringify(srcLayer)),
                    id: newLayerId,
                    client_uid: newLayerId,
                    integration_key: newLayerId,
                    groupId: newGroupId,
                    estimateId: dstEstId,
                    estimatingGroupId: newEstGroupId,
                    estimatingItemId: matchedEstItem ? String(matchedEstItem.id) : null,
                    shapes: clonedShapes,
                    takeoffObjects: clonedShapes,
                    metadata_json: clonedMeta
                };
            });

            return {
                ...JSON.parse(JSON.stringify(srcGroup)),
                id: newGroupId,
                estimateId: dstEstId,
                estimatingGroupId: newEstGroupId,
                layers: clonedLayers
            };
        });

        takeoffState.groups.push(...clonedGroups);

        Object.entries(takeoffState.canvasSnapshots || {}).forEach(([snapKey, snap]) => {
            if (!snap || String(snap.estimateId || snap.estimateKey || '') !== srcEstId) return;
            const docId = String(snap.documentId || snap.drawingId || snapKey.split(':')[1] || 'active');
            const clonedSnap = JSON.parse(JSON.stringify(snap));
            clonedSnap.estimateId = dstEstId;
            clonedSnap.estimateKey = dstEstId;
            if (Array.isArray(clonedSnap.layers)) {
                clonedSnap.layers = clonedSnap.layers.map(rl => {
                    const mappedId = layerIdMap[String(rl.id || rl.layerId || rl.client_uid || '')] || String(rl.id || '');
                    const shapes = Array.isArray(rl.shapes || rl.takeoffObjects)
                        ? (rl.shapes || rl.takeoffObjects).map(s => ({ ...s, id: makeId('shape'), layerId: mappedId }))
                        : [];
                    return { ...rl, id: mappedId, layerId: mappedId, client_uid: mappedId, estimate_id: dstEstId, shapes, takeoffObjects: shapes };
                });
            }
            clonedSnap.updatedAt = Date.now();
            takeoffState.canvasSnapshots[`${dstEstId}:${docId}`] = clonedSnap;
        });

        if (canWrite()) {
            try {
                const pId = String(window.ProjectState?.projectId || 0);
                safeSetTakeoffLocalStorage('takeoff_project_groups_' + pId, JSON.stringify(takeoffState.groups));
            } catch (_) { }
        }
        return { sourceEstimateId: srcEstId, targetEstimateId: dstEstId, layerIdMap, groupIdMap, itemIdMap };
    };

    window.projectTakeoffRefreshDrawings = function (targetDocId = null) {
        drawingState.documents = drawingDocs();
        const preferredId = targetDocId || window.ProjectState?.selectedDocumentId;
        const matchedDoc = preferredId ? drawingState.documents.find(doc => Number(doc.id) === Number(preferredId)) : null;
        if (matchedDoc) {
            drawingState.selectedDocumentId = Number(matchedDoc.id);
            if (isImageDrawingDoc(matchedDoc)) {
                drawingState.browseDocumentId = 'attachment';
                drawingState.previewAttachmentDocId = Number(matchedDoc.id);
            } else {
                drawingState.browseDocumentId = Number(matchedDoc.id);
            }
        } else if (!drawingState.documents.some(doc => Number(doc.id) === Number(drawingState.selectedDocumentId)) && drawingState.documents[0]) {
            const firstDoc = drawingState.documents[0];
            drawingState.selectedDocumentId = firstDoc.id;
            if (isImageDrawingDoc(firstDoc)) {
                drawingState.browseDocumentId = 'attachment';
                drawingState.previewAttachmentDocId = firstDoc.id;
            } else {
                drawingState.browseDocumentId = firstDoc.id;
            }
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

        requestAnimationFrame(() => {
            syncWorkspaceDensity();
            repositionLayerModal();
        });
        setTimeout(() => {
            notifyEditorVisible();
            repositionLayerModal();
        }, 120);
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
            workspace.classList.add('is-resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
        });

        resizer.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            const delta = (e.clientX - startX) / zoom;
            const newWidth = Math.max(220, Math.min(650, Math.round(startWidth + delta)));
            workspace.style.setProperty('--tk-sidebar-width', `${newWidth}px`);
            if (typeof repositionLayerModal === 'function') repositionLayerModal();
        });

        const stopDragging = (e) => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('is-dragging');
            workspace.classList.remove('is-resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try {
                if (e?.pointerId) resizer.releasePointerCapture(e.pointerId);
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
                const isCurrentlyOpen = menu?.classList.contains('open') || button.getAttribute('aria-expanded') === 'true';
                if (isCurrentlyOpen) {
                    setMenuExpanded(button, false);
                } else {
                    if (typeof window.closeAllOpenPopouts === 'function') window.closeAllOpenPopouts();
                    setMenuExpanded(button, true);
                }
            });
        });

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

        const controlsDockBtn = $('takeoffControlsDockToggle');
        const controlsCollapseBtn = $('takeoffControlsCollapseToggle');
        const controlsPanel = document.querySelector('.pro-floating-controls');
        const syncFloatingControlsUi = () => {
            if (!controlsPanel) return;
            const isLeft = controlsPanel.classList.contains('is-docked-left');
            const isCollapsed = controlsPanel.classList.contains('is-collapsed');
            if (controlsCollapseBtn) {
                controlsCollapseBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
                controlsCollapseBtn.title = isCollapsed ? 'Expand floating controls' : 'Collapse floating controls';
                controlsCollapseBtn.setAttribute('aria-label', controlsCollapseBtn.title);
                const icon = controlsCollapseBtn.querySelector('i');
                if (icon) {
                    const pointLeft = isCollapsed ? !isLeft : isLeft;
                    icon.className = `fas fa-chevron-${pointLeft ? 'left' : 'right'}`;
                }
            }
        };
        if (controlsDockBtn && controlsPanel) {
            const savedControlsDock = localStorage.getItem('takeoff.floatingControlsDock');
            if (savedControlsDock === 'left') controlsPanel.classList.add('is-docked-left');
            controlsDockBtn.addEventListener('click', () => {
                const isLeft = controlsPanel.classList.toggle('is-docked-left');
                localStorage.setItem('takeoff.floatingControlsDock', isLeft ? 'left' : 'right');
                syncFloatingControlsUi();
            });
        }
        if (controlsCollapseBtn && controlsPanel) {
            const savedCollapsed = localStorage.getItem('takeoff.floatingControlsCollapsed');
            if (savedCollapsed === '1') controlsPanel.classList.add('is-collapsed');
            controlsCollapseBtn.addEventListener('click', () => {
                const isCollapsed = controlsPanel.classList.toggle('is-collapsed');
                localStorage.setItem('takeoff.floatingControlsCollapsed', isCollapsed ? '1' : '0');
                syncFloatingControlsUi();
            });
        }
        syncFloatingControlsUi();

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
        takeoffDomInitialized = true;
        if (pendingDeletedTakeoffLayersByEstimate.size > 0) {
            pendingDeletedTakeoffLayersByEstimate.forEach((keySet, estKey) => {
                if (keySet && keySet.size > 0) {
                    removeLayersDeletedFromEstimating({ estimateId: estKey, layerKeys: [...keySet] });
                }
            });
        }
        if (pendingInitialEstimatingItemsDetail) {
            const queuedDetail = pendingInitialEstimatingItemsDetail;
            pendingInitialEstimatingItemsDetail = null;
            adoptAuthoritativeEstimateFromEstimating(queuedDetail);
            syncEstimatingItemsToTakeoff(queuedDetail);
            renderTakeoffPanel();
        } else if (latestEstimatingState && Array.isArray(latestEstimatingState.estimates)) {
            const estId = activeEstimateId();
            const activeEst = latestEstimatingState.estimates.find(row => String(row?.id) === String(estId));
            const currentLayersCount = takeoffState.groups
                .filter(g => groupBelongsToEstimate(g, estId))
                .reduce((sum, g) => sum + ((g.items || g.layers || []).length), 0);
            if (activeEst && Array.isArray(activeEst.groups) && currentLayersCount === 0 && activeEst.groups.some(g => (g.items || []).length > 0)) {
                adoptAuthoritativeEstimateFromEstimating({ activeEstimateId: estId, estimates: latestEstimatingState.estimates });
                syncEstimatingItemsToTakeoff({ activeEstimateId: estId, groups: activeEst.groups });
                renderTakeoffPanel();
            }
        }
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
            const prevEstId = String(takeoffState.activeEstimateId || '');
            const estimateId = String(event.detail?.estimateId || activeEstimateId());
            const forceReload = Boolean(event.detail?.cloned);
            if (prevEstId && prevEstId !== estimateId && estimatingSyncTimer) {
                clearTimeout(estimatingSyncTimer);
                estimatingSyncTimer = null;
                syncTakeoffToEstimating(prevEstId);
            }
            takeoffState.activeEstimateId = estimateId;
            setSelectedObjects([]);
            renderTakeoffEstimateFooter();
            clearTimeout(activeEstimateSwitchTimer);
            activeEstimateSwitchTimer = setTimeout(() => {
                activeEstimateSwitchTimer = null;
                ensureEstimateTakeoffWorkspace(estimateId, true);
                ensureEditorEstimate(estimateId, forceReload);
                renderTakeoffPanel();
                renderViewerLayersPopover();
                syncAllLayersToCanvas({ suppressEstimatingSync: true });
            }, 180);
        });
        window.addEventListener('takeoff:primary-estimate-changed', () => {
            renderTakeoffEstimateFooter();
        });
        window.addEventListener('takeoff:estimating-lines-updated', renderTakeoffEstimateFooter);
        window.addEventListener('estimating:takeoff-item-moved', event => {
            const detail = event.detail || {};
            if (detail.layerId && detail.targetGroupId) {
                moveTakeoffLayerToGroup(detail.layerId, detail.targetGroupId);
            }
        });
        window.addEventListener('estimating:item-difficulty-updated', event => {
            const detail = event.detail || {};
            if (!detail.layerId) return;
            const targetId = String(detail.layerId);
            const layer = allLayers().find(l => String(l.id) === targetId || String(l.integration_key) === targetId || String(l.client_uid) === targetId);
            if (layer) {
                layer.difficulty = Number(detail.difficulty || 1);
                if (!layer.metadata_json || typeof layer.metadata_json !== 'object') layer.metadata_json = {};
                layer.metadata_json.difficulty = layer.difficulty;
                saveTakeoffState();
            }
        });
        window.addEventListener('estimating:global-difficulty-updated', event => {
            const diff = Number(event.detail?.difficulty || 1);
            allLayers().forEach(layer => {
                layer.difficulty = diff;
                if (!layer.metadata_json || typeof layer.metadata_json !== 'object') layer.metadata_json = {};
                layer.metadata_json.difficulty = diff;
            });
            saveTakeoffState();
        });
        ensureViewerLayersPopover();
        bindDrawingDropdown();
        bindScalePanel();
        $('takeoffFrame')?.addEventListener('load', () => setTimeout(notifyEditorVisible, 120));
        if (document.getElementById('tab-takeoff')?.classList.contains('active')) {
            setTimeout(notifyEditorVisible, 180);
        }

        document.addEventListener('click', (event) => {
            document.querySelectorAll('.pro-menu, .pro-row-menu').forEach(menu => {
                menu.classList.remove('open');
                menu.__trigger = null;
            });
            document.querySelectorAll('[data-takeoff-menu-toggle], [data-row-menu]').forEach(button => {
                button.classList.remove('is-active');
                button.setAttribute('aria-expanded', 'false');
            });
            clearActiveRowMenuAnchor();
            if (typeof window.closeAllOpenPopouts === 'function') window.closeAllOpenPopouts();
            closeScalePanel();
            closeDrawingDropdown();
            closeGroupContextMenu();
            $('takeoffMoreToolsPanel')?.setAttribute('hidden', '');

            if (!event.target.closest('[data-takeoff-group-row], [data-layer-row], button, input, .pro-tree-inline-edit, .pro-row-menu, .pro-tree-search-bar, .pro-floating-controls, .pro-floating-tools, #takeoffSubheadItemInfo, .est-version-tab, .est-version-menu, #saveProjectBtn, #takeoffDownloadDrawingBtn, #takeoffCompareBtn, #takeoffScaleStatus, .tk-modal-portal, .tk-action-modal, .pd-modal-backdrop, .pd-modal')) {
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
            syncTakeoffSubheadAlignment(true);
            repositionLayerModal();
        });
        syncTakeoffSubheadAlignment(true);
        setTimeout(() => syncTakeoffSubheadAlignment(true), 60);
        if (document.fonts && typeof document.fonts.ready?.then === 'function') {
            document.fonts.ready.then(() => syncTakeoffSubheadAlignment(true));
        }
        document.querySelector('[data-tab="takeoff"]')?.addEventListener('click', () => {
            syncTakeoffSubheadAlignment(true);
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => syncTakeoffSubheadAlignment(true));
            }
            setTimeout(() => syncTakeoffSubheadAlignment(true), 50);
            updateSubheadSelectedItem();
        });
        document.querySelectorAll('[data-tab="estimating"], [data-tab="proposal"], [data-takeoff-estimating-action]').forEach(el => {
            el.addEventListener('pointerdown', () => {
                flushEstimatingSyncFromCanvas();
            }, true);
        });
        window.addEventListener('pagehide', () => flushEstimatingSyncFromCanvas());
        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(() => {
                syncWorkspaceDensity();
                repositionLayerModal();
            });
            const viewer = document.querySelector('.pro-takeoff-viewer');
            if (viewer) observer.observe(viewer);
            const subheadAlignObserver = new ResizeObserver(() => syncTakeoffSubheadAlignment(true));
            const saveBtnEl = document.getElementById('saveProjectBtn');
            const topTabsEl = document.querySelector('.top-tabs');
            if (saveBtnEl) subheadAlignObserver.observe(saveBtnEl);
            if (topTabsEl) subheadAlignObserver.observe(topTabsEl);
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

        const handleWorkspaceShortcut = takeoffViewerController.bindKeyboardShortcuts(syncTakeoffSubheadAlignment);

        document.addEventListener('keydown', event => {
            if (event.defaultPrevented || event.isComposing) return;
            const layerModal = $('takeoffLayerModal');
            if (layerModal && !layerModal.hidden && event.key === 'Escape') {
                event.preventDefault();
                closeLayerModal();
                return;
            }
            const groupModal = $('takeoffGroupModal');
            if (groupModal && !groupModal.hidden) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeTakeoffGroupModal();
                    return;
                }
                if (event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    const form = $('takeoffGroupForm');
                    if (form && event.target?.tagName !== 'BUTTON') {
                        event.preventDefault();
                        if (typeof form.requestSubmit === 'function') form.requestSubmit();
                        else submitTakeoffGroupModal(event);
                    }
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
            if (handleWorkspaceShortcut(event)) {
                event.preventDefault();
                return;
            }
            if (!$('tab-takeoff')?.classList.contains('active') || (layerModal && !layerModal.hidden)
                || event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
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
        window.takeoffState = takeoffState;
        window.getTakeoffLayerById = function (layerId) {
            if (!layerId) return null;
            return typeof findLayer === 'function' ? findLayer(layerId) : null;
        };
        window.getTakeoffLayerByName = function (name) {
            if (!name) return null;
            return (typeof allLayers === 'function' ? allLayers() : []).find(l => l.name === name) || null;
        };
        window.openTakeoffCatalogModal = openCatalogModal;
    });
})();
