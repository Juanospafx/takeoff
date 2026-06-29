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

    function setActiveTool(command) {
        document.querySelectorAll('[data-tool-command]').forEach(button => {
            button.classList.toggle('active', button.dataset.toolCommand === command);
        });
    }

    function runTool(command) {
        const modeMap = {
            smart: 'smart',
            pan: 'smart',
            area: 'draw',
            measure: 'measure',
            calibrate: 'cal'
        };
        if (modeMap[command]) {
            callEditor('setMode', modeMap[command]);
            setActiveTool(command);
            if (command === 'calibrate') openScalePanel('manual');
            if (command === 'measure' && !hasScaleSet()) openScalePanel();
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
        toast.textContent = `${command.replace('-', ' ')} is ready to connect.`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2400);
    }

    function toggleRowMenu(button) {
        const menu = $('takeoffRowMenu');
        if (!menu) return;
        const rect = button.getBoundingClientRect();
        menu.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        menu.classList.toggle('open');
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
        if (label) label.textContent = hasScale ? `Scale ${scaleText}` : 'Scale not set';
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
                <button class="btn-main mt-2" type="button" data-action-tab="documents">Upload Drawings</button>
            </div>`;
            box.querySelector('[data-action-tab]')?.addEventListener('click', () => {
                closeDrawingDropdown();
                document.querySelector('[data-tab="documents"]')?.click();
            });
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
            button.addEventListener('click', () => showPrepared(button.dataset.takeoffAction));
        });

        $('takeoffItemSearch')?.addEventListener('input', event => {
            const q = event.target.value.trim().toLowerCase();
            document.querySelectorAll('[data-search-text]').forEach(row => {
                row.hidden = q && !row.dataset.searchText.includes(q);
            });
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
        bindDrawingDropdown();
        bindScalePanel();

        document.addEventListener('click', () => {
            document.querySelectorAll('.pro-menu, .pro-row-menu').forEach(menu => menu.classList.remove('open'));
            closeScalePanel();
            closeDrawingDropdown();
        });
        $('takeoffScalePanel')?.addEventListener('click', event => event.stopPropagation());
    });
})();
