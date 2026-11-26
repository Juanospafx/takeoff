        const runtimeConfigNode = document.getElementById('editor-runtime-config');
        let editorRuntimeConfig = {};
        try {
            editorRuntimeConfig = runtimeConfigNode ? JSON.parse(runtimeConfigNode.textContent || '{}') : {};
        } catch (error) {
            console.error('Editor runtime configuration is invalid.', error);
        }
        const runtimeFilename = String(editorRuntimeConfig.filename || 'drawing.pdf');

        // --- UI HELPERS ---

        // Toggle Sidebar Izquierda (Sheets)
        function toggleSheets() {
            document.getElementById('sidebarLeft').classList.toggle('show');
            updateOverlay();
            // Cerrar herramientas si abrimos sheets
            closeTools();
        }

        // Toggle Herramientas (Mobile)
        function toggleMobileTools() {
            const sbRight = document.getElementById('sidebarRight');
            const btn = document.getElementById('btn-toggle-tools');
            const floatControls = document.querySelector('.floating-controls'); // SelecciÃ³n de controles flotantes

            sbRight.classList.toggle('show-mobile');
            btn.classList.toggle('active');

            // Logica para ocultar controles flotantes
            if (sbRight.classList.contains('show-mobile')) {
                if (floatControls) floatControls.classList.add('hide-ui');
            } else {
                if (floatControls) floatControls.classList.remove('hide-ui');
            }

            // Cerrar sheets si abrimos herramientas
            document.getElementById('sidebarLeft').classList.remove('show');
            updateOverlay();
        }

        function closeTools() {
            document.getElementById('sidebarRight').classList.remove('show-mobile');
            document.getElementById('btn-toggle-tools').classList.remove('active');

            // Mostrar de nuevo los controles flotantes si se cerrÃ³ la barra
            const floatControls = document.querySelector('.floating-controls');
            if (floatControls) floatControls.classList.remove('hide-ui');
        }

        function updateOverlay() {
            const overlay = document.getElementById('sidebarOverlay');
            const sheetsOpen = document.getElementById('sidebarLeft').classList.contains('show');
            if (sheetsOpen) overlay.classList.add('show'); else overlay.classList.remove('show');
        }

        function closeAllOverlays() {
            document.getElementById('sidebarLeft').classList.remove('show');
            updateOverlay();
        }

        function openMobileCalModal() {
            if (window.innerWidth > 991) return;
            const desktopMode = document.getElementById('cal-mode');
            const desktopPreset = document.getElementById('cal-preset');
            const mMode = document.getElementById('mobile-cal-mode');
            const mPreset = document.getElementById('mobile-cal-preset');
            const mCurrent = document.getElementById('mobile-cal-current');

            if (desktopMode && mMode) mMode.value = desktopMode.value || 'preset';

            if (desktopPreset && mPreset) {
                mPreset.innerHTML = desktopPreset.innerHTML;
                mPreset.value = desktopPreset.value || '';
            }

            const scaleText = (document.getElementById('scale-display')?.textContent || '--').trim();
            if (mCurrent) mCurrent.textContent = scaleText || '--';

            mobileCalModeChanged(mMode ? mMode.value : 'preset');
            new bootstrap.Modal(document.getElementById('mobileCalModal')).show();
        }

        function mobileCalModeChanged(mode) {
            const desktopMode = document.getElementById('cal-mode');
            if (desktopMode) desktopMode.value = mode;
            setCalMode(mode);

            document.getElementById('mobile-cal-preset-wrap')?.classList.toggle('d-none', mode !== 'preset');
            document.getElementById('mobile-cal-manual-wrap')?.classList.toggle('d-none', mode !== 'manual');
        }

        function mobileCalPresetChanged(value) {
            const desktopPreset = document.getElementById('cal-preset');
            if (desktopPreset) desktopPreset.value = value;
            applyScalePreset(value);
            const scaleText = (document.getElementById('scale-display')?.textContent || '--').trim();
            const mCurrent = document.getElementById('mobile-cal-current');
            if (mCurrent) mCurrent.textContent = scaleText || '--';
        }

        function mobileApplyManualCal() {
            const v = document.getElementById('mobile-cal-val')?.value;
            const desktopVal = document.getElementById('cal-val');
            if (desktopVal) desktopVal.value = v || '';
            finishCal(true);
            const scaleText = (document.getElementById('scale-display')?.textContent || '--').trim();
            const mCurrent = document.getElementById('mobile-cal-current');
            if (mCurrent) mCurrent.textContent = scaleText || '--';
        }

        // --- SETUP ---
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

        // SERVER VARIABLES
        const fileUrl = String(editorRuntimeConfig.fileUrl || '');
        const fileExt = String(editorRuntimeConfig.fileExt || '');
        const fileId = Number(editorRuntimeConfig.fileId || 0);
        const projectId = Number(editorRuntimeConfig.projectId || 0);
        let allAnnotations = editorRuntimeConfig.annotations;
        if (typeof allAnnotations !== 'object' || allAnnotations === null) allAnnotations = {};

        const draftAnnotationsKey = `ep_annotations_draft_file_${fileId}`;
        function loadDraftAnnotations() {
            try {
                const raw = localStorage.getItem(draftAnnotationsKey);
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    allAnnotations = { ...allAnnotations, ...parsed };
                }
            } catch (e) {
                console.warn('Draft annotations could not be loaded', e);
            }
        }
        function persistDraftAnnotations() {
            if (!window.takeoffCanWrite()) return false;
            try {
                localStorage.setItem(draftAnnotationsKey, JSON.stringify(allAnnotations));
            } catch (e) {
                console.warn('Draft annotations could not be saved', e);
            }
        }
        loadDraftAnnotations();

        // FABRIC INIT
        let canvas = new fabric.Canvas('c', {
            preserveObjectStacking: true,
            fireRightClick: true,
            stopContextMenu: true,
            allowTouchScrolling: false,
            renderOnAddRemove: true, // Mantener renderizado automático
            stateful: false, // Optimización de rendimiento
            imageSmoothing: true
        });
        canvas.on('before:render', () => {
            if (canvas.contextContainer) {
                canvas.contextContainer.imageSmoothingEnabled = true;
                canvas.contextContainer.imageSmoothingQuality = 'high';
            }
        });
        const useKonvaRuler = true;
        const konvaOverlay = document.getElementById('konva-overlay');
        let konvaStage = null;
        let konvaLayer = null;
        let konvaRulers = [];
        let konvaNotes = [];
        let konvaClouds = [];
        let konvaPins = [];
        const konvaRulersByPage = {};
        let konvaTransformer = null;
        let konvaEditingTextarea = null;
        let konvaSelectedNote = null;
        let konvaSelectedNode = null;
        let konvaDrawing = null;
        let konvaRulerAnchor = null;
        let konvaIsPanning = false;
        let konvaPanMode = false;
        let konvaTemporaryPan = false;
        const isMobileViewport = window.innerWidth <= 768;
        const dpr = window.devicePixelRatio || 1;
        const PDF_PADDING = isMobileViewport ? 18 : 36;
        const MAX_PDF_RENDER_SCALE = 2.5;
        const PAGE_SWITCH_MAX_DIMENSION = 3072;
        const initialRequestedPage = Math.max(1, Number.parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10) || 1);
        let pdfDoc = null, pageNum = initialRequestedPage;
        let pdfWorldWidth = 0;
        let pdfWorldHeight = 0;
        let pdfFitZoom = 1;
        let currentPdfRenderZoom = 0;
        let currentPdfRenderScale = 0;
        let renderToken = 0;
        let activePdfRenderTask = null;
        let pdfRerenderTimer = null;
        let zoomNotificationFrame = null;
        let pendingZoomNotification = null;
        let currentPdfBgImage = null;
        const pdfBitmapCache = new Map();
        const PDF_BITMAP_CACHE_LIMIT = 2;
        const pageSwitchLatencySamples = [];
        let activePageSwitch = null;
        const drawingLoading = document.getElementById('drawingLoading');

        function notifyTakeoffZoomChanged(source = 'editor') {
            const zoom = Number(canvas?.getZoom?.() || 1);
            const percent = Math.round(zoom * 100);
            const zoomEl = document.getElementById('zoom-disp');
            if (zoomEl) zoomEl.innerText = percent + '%';
            pendingZoomNotification = { zoom, percent, source };
            if (zoomNotificationFrame !== null) return;
            zoomNotificationFrame = requestAnimationFrame(() => {
                zoomNotificationFrame = null;
                const payload = pendingZoomNotification;
                pendingZoomNotification = null;
                try {
                    window.parent?.postMessage({ type: 'project-takeoff-zoom-changed', payload }, '*');
                } catch (e) { }
            });
        }
        window.notifyTakeoffZoomChanged = notifyTakeoffZoomChanged;

        function clampViewportTransform(vpt) {
            if (!vpt || !canvas) return vpt;
            const w = document.getElementById('canvas-wrapper');
            if (!w) return vpt;

            const viewW = w.clientWidth || canvas.getWidth();
            const viewH = w.clientHeight || canvas.getHeight();
            if (!viewW || !viewH) return vpt;

            const docWorldW = pdfWorldWidth || (canvas.backgroundImage ? (canvas.backgroundImage.width || canvas.backgroundImage.getScaledWidth?.() || 0) : 0);
            const docWorldH = pdfWorldHeight || (canvas.backgroundImage ? (canvas.backgroundImage.height || canvas.backgroundImage.getScaledHeight?.() || 0) : 0);
            if (!docWorldW || !docWorldH) return vpt;

            const zoom = vpt[0] || canvas.getZoom() || 1;
            const docW = docWorldW * zoom;
            const docH = docWorldH * zoom;

            // Generous limit margins so the canvas has plenty of workspace and movement freedom
            const marginX = Math.max(viewW * 0.5, 450);
            const marginY = Math.max(viewH * 0.5, 350);

            // Keep at least a noticeable portion of the plan visible so it can never be lost
            const minKeepX = Math.min(100, Math.max(40, docW * 0.25));
            const minKeepY = Math.min(100, Math.max(40, docH * 0.25));

            const minX = Math.max(minKeepX - docW, Math.min(-marginX, viewW - docW - marginX));
            const maxX = Math.min(viewW - minKeepX, Math.max(marginX, viewW - docW + marginX));

            const minY = Math.max(minKeepY - docH, Math.min(-marginY, viewH - docH - marginY));
            const maxY = Math.min(viewH - minKeepY, Math.max(marginY, viewH - docH + marginY));

            vpt[4] = Math.max(minX, Math.min(maxX, vpt[4]));
            vpt[5] = Math.max(minY, Math.min(maxY, vpt[5]));
            return vpt;
        }
        window.clampViewportTransform = clampViewportTransform;

        const originalSetViewportTransform = canvas.setViewportTransform.bind(canvas);
        canvas.setViewportTransform = function (vpt) {
            clampViewportTransform(vpt);
            return originalSetViewportTransform(vpt);
        };

        // STATES
        let pixelsPerFoot = 0;
        window.pixelsPerFoot = 0;
        let currentMode = 'smart';
        let pendingPlacementTool = null;
        let pendingPlacementStart = null;
        let pendingPlacementPreview = null;
        let lineState = 0, activeLine = null, startPoint = null;
        let calLineObject = null;
        let calMode = 'preset';
        let cloudStrokeWidth = 3; // default actual behavior

        const takeoffEstimateKey = new URLSearchParams(window.location.search).get('estimate_key') || 'est_primary';
        const takeoffInheritLegacy = new URLSearchParams(window.location.search).get('inherit_legacy') === '1';
        window.__projectTakeoffEstimateKey = takeoffEstimateKey;

        // Calibration persistence is isolated by estimate + file + page.
        async function takeoffScaleRequest(action, payload = {}, method = 'GET') {
            if (method !== 'GET' && !window.takeoffRequireWrite()) {
                throw new Error('Read-only access: scale mutation blocked.');
            }
            const endpoint = '../api/takeoff.php';
            const options = method === 'GET' ? {} : {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...payload })
            };
            const url = method === 'GET'
                ? `${endpoint}?action=${encodeURIComponent(action)}&${new URLSearchParams(payload).toString()}`
                : endpoint;
            const response = await fetch(url, options);
            const result = await response.json();
            if (!response.ok || result.status !== 'success') throw new Error(result.msg || 'Scale persistence failed');
            return result.data || null;
        }

        window.sheetScales = window.sheetScales || {};
        let scaleMutationEpoch = 0;

        async function loadCalibrationForPage(showNotice) {
            const requestedPage = Number(pageNum || 1);
            const startEpoch = scaleMutationEpoch;
            try {
                const scale = await takeoffScaleRequest('scale', { drawing_id: fileId, estimate_key: takeoffEstimateKey, page_number: requestedPage });
                if (requestedPage !== Number(pageNum || 1) || startEpoch !== scaleMutationEpoch) return;
                pixelsPerFoot = Number(scale?.pixels_per_unit || 0);
                window.pixelsPerFoot = pixelsPerFoot;
                window.sheetScales[requestedPage] = pixelsPerFoot;
                const displayName = (scale?.scale_name || '').trim() || (pixelsPerFoot > 0 ? 'Custom' : '');
                setScaleDisplay(displayName);
                if (pixelsPerFoot > 0 && showNotice) setTimeout(() => showToast("Saved calibration loaded", "success"), 800);
            } catch (error) {
                if (requestedPage !== Number(pageNum || 1) || startEpoch !== scaleMutationEpoch) return;
                pixelsPerFoot = 0;
                window.pixelsPerFoot = 0;
                window.sheetScales[requestedPage] = 0;
                setScaleDisplay('');
                console.error('Scale load failed:', error);
                if (showNotice) showToast(error.message, 'error');
            }
            refreshMeasureLabels();
            try {
                window.parent?.syncScaleStatus?.();
            } catch (e) { }
        }

        function saveCalibrationForPage(scaleName, calibration = {}, applyAll = false) {
            if (!window.takeoffCanWrite()) return false;
            const pageCount = pdfDoc ? pdfDoc.numPages : 1;
            if (applyAll) {
                for (let p = 1; p <= pageCount; p++) {
                    window.sheetScales[p] = pixelsPerFoot;
                }
            } else {
                window.sheetScales[pageNum] = pixelsPerFoot;
            }
            return takeoffScaleRequest('save_scale', {
                drawing_id: fileId,
                project_id: typeof projectId !== 'undefined' ? projectId : 0,
                estimate_key: takeoffEstimateKey,
                page_number: pageNum,
                apply_to_all: applyAll ? 1 : 0,
                page_count: pageCount,
                scale_name: scaleName || 'Custom',
                pixels_per_unit: pixelsPerFoot,
                unit: 'ft',
                calibration_json: calibration
            }, 'POST');
        }

        function setScaleDisplay(text) {
            const el = document.getElementById('scale-display');
            if (el) el.textContent = text || '';
            try {
                window.parent?.syncScaleStatus?.();
                window.parent?.postMessage({
                    type: 'project-takeoff-scale-changed',
                    scaleName: text || '',
                    pageNum: typeof pageNum !== 'undefined' ? pageNum : 1
                }, '*');
            } catch (e) { }
        }

        function keepScaleDisplayVisible() {
            const wrap = document.getElementById('scale-display-wrap');
            if (wrap) wrap.classList.add('active');
        }

        function getActiveScaleLabel() {
            const el = document.getElementById('scale-display');
            return (el?.textContent || '').trim();
        }
        window.getActiveScaleLabel = getActiveScaleLabel;

        function gcd(a, b) {
            let x = Math.abs(a);
            let y = Math.abs(b);
            while (y) {
                const t = y;
                y = x % y;
                x = t;
            }
            return x || 1;
        }

        function getArchitecturalInchStep(scaleLabel) {
            const parsed = parseScaleLabel(scaleLabel || '');
            if (!parsed) return 1 / 16;

            // Civil scales (ej. 1" = 10') se muestran en pies enteros
            if (parsed.feet > 1) return null;

            const inchesPerFoot = parsed.inches;
            if (inchesPerFoot <= (1 / 8)) return 1;      // 1/8" o menor -> 1"
            if (inchesPerFoot <= (1 / 4)) return 1 / 2;  // 3/16", 1/4" -> 1/2"
            if (inchesPerFoot <= (1 / 2)) return 1 / 4;  // 3/8", 1/2" -> 1/4"
            if (inchesPerFoot < 1) return 1 / 8;         // 3/4" -> 1/8"
            return 1 / 16;                                // 1" o mayor -> 1/16"
        }

        function formatFeetForDisplay(feetDecimal) {
            if (!isFinite(feetDecimal)) return '--';

            const step = getArchitecturalInchStep(getActiveScaleLabel());

            // Civil: solo pies enteros redondeados
            if (step === null) {
                return `${Math.round(feetDecimal)}'`;
            }

            let feetWhole = Math.floor(feetDecimal);
            let inches = (feetDecimal - feetWhole) * 12;
            inches = Math.round(inches / step) * step;

            if (inches >= 12 - 1e-9) {
                feetWhole += 1;
                inches = 0;
            }

            let wholeInches = Math.floor(inches + 1e-9);
            const frac = inches - wholeInches;

            if (frac < 1e-9) {
                return `${feetWhole}' ${wholeInches}"`;
            }

            let den = Math.round(1 / step);
            let num = Math.round(frac * den);

            if (num === den) {
                wholeInches += 1;
                num = 0;
            }
            if (wholeInches >= 12) {
                feetWhole += 1;
                wholeInches = 0;
            }
            if (num === 0) {
                return `${feetWhole}' ${wholeInches}"`;
            }

            const factor = gcd(num, den);
            num /= factor;
            den /= factor;

            return `${feetWhole}' ${wholeInches} ${num}/${den}"`;
        }

        function formatTapeMeasureLength(feetDecimal, maxDenominator = 4) {
            if (!isFinite(feetDecimal) || feetDecimal < 0) return '0"';

            // Saltos sencillos de fracciones: cuartos (1/4, 1/2, 3/4)
            const den = 4;
            const totalInches = feetDecimal * 12;
            const totalQuarters = Math.round(totalInches * den);
            const totalWholeInches = Math.floor(totalQuarters / den);
            const remQuarters = totalQuarters % den;

            const feet = Math.floor(totalWholeInches / 12);
            const inches = totalWholeInches % 12;

            let fracText = '';
            if (remQuarters === 2) fracText = '1/2';
            else if (remQuarters === 1) fracText = '1/4';
            else if (remQuarters === 3) fracText = '3/4';

            // "que no tenga un número entero y seguido la fracción, solo las fracciones"
            // Cuando hay pulgadas enteras, se redondea a la pulgada entera más cercana (ej. 7" o 5' 8")
            // para evitar mostrar un entero seguido de fracción ("7 1/2"").
            // Si no hay pulgadas enteras pero sí fracción, se muestra únicamente la fracción (ej. 1/2" o 5' 1/2"),
            // sin el cero previo que antes generaba "0 1/2"".
            if (feet > 0) {
                if (inches > 0) {
                    const roundedInches = remQuarters >= 2 ? inches + 1 : inches;
                    if (roundedInches >= 12) {
                        return `${feet + 1}' 0"`;
                    }
                    return `${feet}' ${roundedInches}"`;
                } else if (fracText) {
                    return `${feet}' ${fracText}"`;
                } else {
                    return `${feet}' 0"`;
                }
            } else {
                if (inches > 0) {
                    const roundedInches = remQuarters >= 2 ? inches + 1 : inches;
                    return `${roundedInches}"`;
                } else if (fracText) {
                    return `${fracText}"`;
                } else {
                    return `0"`;
                }
            }
        }

        // --- SCALE PRESETS ---
        const RAW_SCALE_PRESETS = [
            { category: 'Architectural', label: '1/128" = 1\'' },
            { category: 'Architectural', label: '1/64" = 1\'' },
            { category: 'Architectural', label: '1/32" = 1\'' },
            { category: 'Architectural', label: '1/16" = 1\'' },
            { category: 'Architectural', label: '3/32" = 1\'' },
            { category: 'Architectural', label: '1/8" = 1\'' },
            { category: 'Architectural', label: '3/16" = 1\'' },
            { category: 'Architectural', label: '1/4" = 1\'' },
            { category: 'Architectural', label: '3/8" = 1\'' },
            { category: 'Architectural', label: '1/2" = 1\'' },
            { category: 'Architectural', label: '3/4" = 1\'' },
            { category: 'Architectural', label: '1" = 1\'' },
            { category: 'Architectural', label: '1 1/2" = 1\'' },
            { category: 'Architectural', label: '3" = 1\'' },
            { category: 'Civil', label: '1" = 10\'' },
            { category: 'Civil', label: '1" = 20\'' },
            { category: 'Civil', label: '1" = 30\'' },
            { category: 'Civil', label: '1" = 40\'' },
            { category: 'Civil', label: '1" = 50\'' },
            { category: 'Civil', label: '1" = 60\'' },
            { category: 'Civil', label: '1" = 70\'' },
            { category: 'Civil', label: '1" = 80\'' },
            { category: 'Civil', label: '1" = 90\'' },
            { category: 'Civil', label: '1" = 100\'' },
            { category: 'Civil', label: '1" = 300\'' },
            { category: 'Civil', label: '1" = 500\'' },
            { category: 'Civil', label: '1" = 1000\'' }
        ];

        function parseFraction(value) {
            const match = value.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
            if (!match) return NaN;
            const numerator = parseFloat(match[1]);
            const denominator = parseFloat(match[2]);
            if (!isFinite(numerator) || !isFinite(denominator) || denominator === 0) return NaN;
            return numerator / denominator;
        }

        function parseMixedNumber(value) {
            const parts = value.trim().split(/\s+/);
            if (parts.length === 1) {
                if (parts[0].includes('/')) return parseFraction(parts[0]);
                return parseFloat(parts[0]);
            }
            if (parts.length === 2) {
                const whole = parseFloat(parts[0]);
                const fraction = parseFraction(parts[1]);
                if (!isFinite(whole) || !isFinite(fraction)) return NaN;
                return whole + fraction;
            }
            return NaN;
        }

        function parseScaleLabel(label) {
            const match = label.match(/^(.+)"\s*=\s*(.+)'$/);
            if (!match) return null;
            const inches = parseMixedNumber(match[1].trim());
            const feet = parseMixedNumber(match[2].trim());
            if (!isFinite(inches) || !isFinite(feet) || inches <= 0 || feet <= 0) return null;
            return { inches, feet, feetPerInch: feet / inches };
        }

        function buildScalePresets() {
            const presets = [];
            RAW_SCALE_PRESETS.forEach(raw => {
                const parsed = parseScaleLabel(raw.label);
                if (!parsed || !isFinite(parsed.feetPerInch) || parsed.feetPerInch <= 0) {
                    console.warn("Invalid scale preset:", raw);
                    return;
                }
                presets.push({ ...raw, ...parsed });
            });
            return presets;
        }

        const SCALE_PRESETS = buildScalePresets();

        function populateScalePresets() {
            const select = document.getElementById('cal-preset');
            if (!select) return;
            SCALE_PRESETS.forEach((preset, index) => {
                let group = select.querySelector(`optgroup[label="${preset.category}"]`);
                if (!group) {
                    group = document.createElement('optgroup');
                    group.label = preset.category;
                    select.appendChild(group);
                }
                const option = document.createElement('option');
                option.value = String(index);
                option.textContent = preset.label;
                group.appendChild(option);
            });
        }

        async function getPdfPixelsPerInch() {
            if (!pdfDoc) return 72;
            try {
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1 });
                if (viewport && viewport.width) return 72;
            } catch (e) { }
            return 72;
        }

        async function applyScalePreset(value, applyAll = false) {
            if (value === '' || value === null || value === undefined) return false;
            const index = parseInt(value, 10);
            const preset = SCALE_PRESETS[index];
            if (!preset) { showToast("Invalid preset", "error"); return false; }
            const pixelsPerInch = await getPdfPixelsPerInch();
            const nextPixelsPerFoot = pixelsPerInch / preset.feetPerInch;
            if (!isFinite(nextPixelsPerFoot) || nextPixelsPerFoot <= 0) { showToast("Invalid preset calculation", "error"); return false; }
            scaleMutationEpoch += 1;
            pixelsPerFoot = nextPixelsPerFoot;
            window.pixelsPerFoot = pixelsPerFoot;
            const pageCount = pdfDoc ? pdfDoc.numPages : 1;
            if (applyAll) {
                for (let p = 1; p <= pageCount; p++) {
                    window.sheetScales[p] = pixelsPerFoot;
                }
            } else {
                window.sheetScales[pageNum] = pixelsPerFoot;
            }
            setScaleDisplay(preset.label);
            refreshMeasureLabels();
            try { window.projectTakeoffUpdateScale?.(pageNum, pixelsPerFoot, applyAll); } catch (e) { }
            try {
                await Promise.resolve(saveCalibrationForPage(preset.label, { mode: 'preset', preset_index: index, feet_per_inch: preset.feetPerInch }, applyAll));
                showToast(applyAll ? `Calibrated all sheets! 1 ft = ${pixelsPerFoot.toFixed(2)} px` : `Calibrated sheet! 1 ft = ${pixelsPerFoot.toFixed(2)} px`, "success");
            } catch (error) {
                console.warn('Preset scale persistence warning:', error);
                showToast(error?.message || 'Scale applied locally; save failed.', 'warning');
            }
            return true;
        }
        window.applyScalePreset = applyScalePreset;

        function resetScalePresetSelection() {
            const preset = document.getElementById('cal-preset');
            if (preset) preset.value = '';
        }

        function updateCalHint() {
            const hint = document.getElementById('cal-hint');
            if (!hint) return;
            hint.textContent = (calMode === 'preset') ? 'Select a preset scale...' : 'Draw a known line...';
        }

        function setCalMode(mode) {
            calMode = (mode === 'preset') ? 'preset' : 'manual';
            const modeSelect = document.getElementById('cal-mode');
            if (modeSelect) modeSelect.value = calMode;
            const preset = document.getElementById('cal-preset');
            if (preset) preset.disabled = (calMode !== 'preset');
            const actions = document.getElementById('cal-actions');
            if (actions) {
                actions.style.display = (calMode === 'manual' && calLineObject) ? 'flex' : 'none';
            }
            const btnDel = document.getElementById('btn-del-cal');
            if (btnDel) btnDel.style.display = (calMode === 'manual' && calLineObject) ? 'inline-block' : 'none';
            if (calMode !== 'preset') resetScalePresetSelection();
            updateCalHint();
            keepScaleDisplayVisible();
        }

        function refreshMeasureLabels() {
            canvas.getObjects().forEach(obj => {
                if (obj.isMeasureLine && obj.label) updateMeasureLabel(obj);
            });
            if (useKonvaRuler) {
                konvaRulers.forEach(r => updateKonvaLabel(r));
                syncKonvaToFabric();
                if (typeof emitKonvaRulersState === 'function') emitKonvaRulersState();
            }
            canvas.requestRenderAll();
        }

        function syncCloudStrokeControl(value = cloudStrokeWidth) {
            const ctrl = document.getElementById('cloud-stroke');
            if (ctrl) ctrl.value = String(value);
        }

        function setCloudStrokeWidth(value) {
            const next = parseFloat(value);
            if (!isFinite(next) || next <= 0) return;
            cloudStrokeWidth = next;
            syncCloudStrokeControl(cloudStrokeWidth);

            if (konvaSelectedNode?.type === 'cloud' && konvaSelectedNode.ref?.shape) {
                konvaSelectedNode.ref.shape.strokeWidth(cloudStrokeWidth);
                if (konvaLayer) konvaLayer.batchDraw();
                saveCurrentPageAnnotations();
            }
        }

        function runScalePresetSelfCheck() {
            const cases = [
                { label: '1/8" = 1\'', expected: 8 },
                { label: '1 1/2" = 1\'', expected: 1 / 1.5 },
                { label: '1" = 500\'', expected: 500 }
            ];
            return cases.map(testCase => {
                const parsed = parseScaleLabel(testCase.label);
                const actual = parsed ? parsed.feetPerInch : null;
                const ok = parsed ? Math.abs(actual - testCase.expected) < 1e-6 : false;
                return { label: testCase.label, feetPerInch: actual, ok };
            });
        }

        window.__scalePresetSelfCheck = runScalePresetSelfCheck;
        populateScalePresets();
        setCalMode(calMode);
        loadCalibrationForPage(true);
        keepScaleDisplayVisible();
        syncCloudStrokeControl();

        // HISTORY
        const MAX_HISTORY = 10;
        let undoStack = [];
        let historyIndex = -1;
        let historyProcessing = false;

        window.addEventListener('contextmenu', e => e.preventDefault());

        let hasInitialPdfFit = false;

        function resize() {
            const w = document.getElementById('canvas-wrapper');
            if (!w || w.clientWidth <= 0 || w.clientHeight <= 0) return;
            canvas.setWidth(w.clientWidth);
            canvas.setHeight(w.clientHeight);
            if (konvaStage) {
                konvaStage.width(w.clientWidth);
                konvaStage.height(w.clientHeight);
                if (konvaLayer) konvaLayer._waitingForDraw = false;
                syncKonvaToFabric();
            }
            if (pdfDoc && pdfWorldWidth && pdfWorldHeight) {
                if (!hasInitialPdfFit) {
                    fitPdfToView(true);
                } else {
                    // Keep the user's zoom level and pan position intact when panels/aside resize the viewport.
                    fitPdfToView(false, { preserveViewport: true });
                }
                schedulePdfRerender();
            }
        }
        let resizeTimer = null;
        // This must be initialized before the first waitForWrapperSize() call.
        // Function declarations are hoisted, but a later `let` initializer is not.
        let wrapperSizePromise = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(resize, 120);
        });
        // The wrapper can still be at 0x0 here if this editor is embedded in a tab/panel
        // that hasn't been made visible by the parent page yet, so poll instead of a single check.
        waitForWrapperSize();
        window.addEventListener('message', event => {
            if (!event.data || event.data.type !== 'takeoff-visible') return;
            if (konvaLayer) konvaLayer._waitingForDraw = false;
            resize();
            if (pdfDoc && !canvas.backgroundImage && !isRenderingPage) {
                renderPage(pageNum, true);
            } else if (pdfDoc) {
                if (!hasInitialPdfFit) {
                    fitPdfToView(true);
                } else {
                    fitPdfToView(false, { preserveViewport: true });
                }
                schedulePdfRerender();
            }
            syncKonvaToFabric();
            if (konvaLayer && (!konvaStage || (konvaStage.width() > 0 && konvaStage.height() > 0))) {
                konvaLayer.batchDraw();
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                if (konvaLayer) konvaLayer._waitingForDraw = false;
                resize();
                if (pdfDoc) schedulePdfRerender();
                syncKonvaToFabric();
            }
        });

        function setKonvaActive(active) {
            if (!konvaOverlay) return;
            konvaOverlay.style.pointerEvents = active ? 'auto' : 'none';
            konvaOverlay.style.display = 'block';
            if (active) syncKonvaToFabric();
        }

        function getFabricVpt() {
            const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
            return { scaleX: vpt[0], scaleY: vpt[3], translateX: vpt[4], translateY: vpt[5] };
        }

        function screenToWorld(pos) {
            const vpt = getFabricVpt();
            return {
                x: (pos.x - vpt.translateX) / vpt.scaleX,
                y: (pos.y - vpt.translateY) / vpt.scaleY
            };
        }

        let lastSyncedKonvaZoom = null;
        let lastSyncedKonvaPage = null;
        let lastSyncedKonvaRulerCount = -1;
        let paintedKonvaViewport = null;
        let viewportIdleCommitTimer = null;
        let pendingViewportIdleZoom = null;
        const viewportWorkSamples = [];

        function viewportSnapshot() {
            const vpt = getFabricVpt();
            return {
                scale: Number(vpt.scaleX || 1),
                x: Number(vpt.translateX || 0),
                y: Number(vpt.translateY || 0)
            };
        }

        function konvaSceneCanvases() {
            if (!konvaStage?.container) return [];
            return [...konvaStage.container().querySelectorAll('canvas')];
        }

        function clearKonvaViewportCssTransform() {
            konvaSceneCanvases().forEach(sceneCanvas => {
                sceneCanvas.style.transform = '';
                sceneCanvas.style.transformOrigin = '';
                sceneCanvas.style.willChange = '';
            });
        }

        // Moving the already-painted scene canvas is a constant-cost GPU operation.
        // It keeps pan/zoom frames independent from the number of Takeoff nodes.
        function applyKonvaViewportCssTransform() {
            if (!paintedKonvaViewport) return false;
            const next = viewportSnapshot();
            const baseScale = paintedKonvaViewport.scale || 1;
            const ratio = next.scale / baseScale;
            const tx = next.x - (ratio * paintedKonvaViewport.x);
            const ty = next.y - (ratio * paintedKonvaViewport.y);
            const transform = `matrix(${ratio}, 0, 0, ${ratio}, ${tx}, ${ty})`;
            konvaSceneCanvases().forEach(sceneCanvas => {
                sceneCanvas.style.transformOrigin = '0 0';
                sceneCanvas.style.willChange = 'transform';
                sceneCanvas.style.transform = transform;
            });
            return true;
        }

        function recordViewportWork(kind, startedAt) {
            const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            viewportWorkSamples.push({ kind, duration: Math.max(0, now - startedAt) });
            if (viewportWorkSamples.length > 240) viewportWorkSamples.splice(0, viewportWorkSamples.length - 240);
        }

        window.getTakeoffViewportPerformance = function () {
            const durations = viewportWorkSamples.map(sample => sample.duration).sort((a, b) => a - b);
            const percentile = value => durations.length
                ? durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * value))]
                : 0;
            return {
                samples: durations.length,
                p50: percentile(0.50),
                p95: percentile(0.95),
                p99: percentile(0.99)
            };
        };

        function syncKonvaToFabric(options = {}) {
            if (!konvaLayer) return;
            clearKonvaViewportCssTransform();
            const w = document.getElementById('canvas-wrapper');
            if (konvaStage && w && w.clientWidth > 0 && w.clientHeight > 0) {
                if (konvaStage.width() !== w.clientWidth || konvaStage.height() !== w.clientHeight) {
                    konvaStage.width(w.clientWidth);
                    konvaStage.height(w.clientHeight);
                }
            }
            const vpt = getFabricVpt();
            konvaLayer.position({ x: vpt.translateX, y: vpt.translateY });
            konvaLayer.scale({ x: vpt.scaleX, y: vpt.scaleY });
            const invScale = vpt.scaleX ? 1 / vpt.scaleX : 1;

            // Clamping zoom limit strictly between 100% (1.0) and 250% (2.5)
            const zoom = Number(vpt.scaleX || 1);
            const scaleChanged = lastSyncedKonvaZoom === null || Math.abs(zoom - lastSyncedKonvaZoom) > 0.0001;
            const contextChanged = lastSyncedKonvaPage !== pageNum || lastSyncedKonvaRulerCount !== konvaRulers.length;
            const panOnly = Boolean(options?.panOnly)
                || (!options?.forceScale && !scaleChanged && !contextChanged);

            if (!panOnly) {
                lastSyncedKonvaZoom = zoom;
                lastSyncedKonvaPage = pageNum;
                lastSyncedKonvaRulerCount = konvaRulers.length;
                const clampedZoom = Math.max(1.0, Math.min(2.5, zoom));
                const rulerScale = 1 / clampedZoom;

                try {
                    konvaRulers.forEach(r => {
                        if (!r?.line || !r?.a1 || !r?.a2 || !r?.label || !r?.group) return;
                        const rColor = r.color || '#22c55e';
                        r.line.stroke(rColor);
                        r.line.strokeWidth(Math.max(1.5, 2.0 * rulerScale));
                        r.line.hitStrokeWidth(Math.max(18, Math.min(32, 20 * rulerScale)));

                        // Refined ruler nodes (small, sleek and uncluttered)
                        const handleR = 4.2 * rulerScale;
                        r.a1.radius(handleR);
                        r.a2.radius(handleR);
                        r.a1.strokeWidth(Math.max(1.2, 1.6 * rulerScale));
                        r.a2.strokeWidth(Math.max(1.2, 1.6 * rulerScale));
                        r.a1.fill(rColor);
                        r.a2.fill(rColor);
                        r.a1.stroke('#ffffff');
                        r.a2.stroke('#ffffff');
                        r.a1.hitStrokeWidth(Math.max(14, Math.min(24, 16 * rulerScale)));
                        r.a2.hitStrokeWidth(Math.max(14, Math.min(24, 16 * rulerScale)));

                        // Refined ruler numbers: scaled cleanly within 100% - 250% zoom bounds (+15% larger)
                        const fontSize = 14.4 * rulerScale;
                        r.label.fontSize(fontSize);
                        r.label.fill(rColor);
                        r.label.stroke('#ffffff');
                        r.label.strokeWidth(Math.max(2.0, 2.8 * rulerScale));
                        r.label.fillAfterStrokeEnabled(true);
                        r.label.padding(1.5);
                        updateKonvaLabel(r);
                        r.group.visible(r.page === pageNum && !r.hidden);
                        r.group.moveToTop();
                    });
                } catch (e) { }
                try {
                    window.syncTakeoffInteractionScale?.(invScale);
                } catch (e) { }
            }
            // Reset any stalled batchDraw flag accumulated while the tab/iframe was hidden
            // (display: none skips rAF in Chromium), then draw synchronously with Fabric.
            konvaLayer._waitingForDraw = false;
            if ((options?.immediate || (!panOnly && !options?.useBatchDraw)) && w && w.clientWidth > 0 && w.clientHeight > 0 && !document.hidden) {
                konvaLayer.draw();
            } else {
                konvaLayer.batchDraw();
            }
            paintedKonvaViewport = viewportSnapshot();
        }
        window.syncKonvaToFabric = syncKonvaToFabric;

        function commitViewportAfterGesture() {
            if (viewportIdleCommitTimer) {
                clearTimeout(viewportIdleCommitTimer);
                viewportIdleCommitTimer = null;
            }
            const finalZoom = pendingViewportIdleZoom;
            pendingViewportIdleZoom = null;
            if (finalZoom != null) updateTextScales(finalZoom, { deferDraw: true });
            clearKonvaViewportCssTransform();
            if (useKonvaRuler) syncKonvaToFabric({ forceScale: true, immediate: true });
            canvas.requestRenderAll();
        }

        function scheduleViewportIdleCommit(zoom, delay = 90) {
            pendingViewportIdleZoom = zoom;
            if (viewportIdleCommitTimer) clearTimeout(viewportIdleCommitTimer);
            viewportIdleCommitTimer = setTimeout(commitViewportAfterGesture, delay);
        }

        function updateKonvaLabel(r) {
            const p1 = r.a1.position();
            const p2 = r.a2.position();
            const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            let textVal = "";
            if (pixelsPerFoot > 0) {
                const feet = distPx / pixelsPerFoot;
                textVal = formatTapeMeasureLength(feet);
            } else {
                textVal = Math.round(distPx) + " px";
            }
            r.label.text(textVal);
            r.feetDecimal = pixelsPerFoot > 0 ? (distPx / pixelsPerFoot) : null;
            r.sidebarQuantityText = pixelsPerFoot > 0
                ? `${(distPx / pixelsPerFoot).toFixed(2)} fts`
                : `${Math.round(distPx)} px`;

            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.hypot(dx, dy);

            const vpt = getFabricVpt();
            const zoom = Number(vpt.scaleX || 1);
            const clampedZoom = Math.max(1.0, Math.min(2.5, zoom));
            const rulerScale = 1 / clampedZoom;
            r.label.offsetX(r.label.width() / 2);
            r.label.offsetY(r.label.height() / 2);

            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            const isVertical = absDy > absDx * 1.5;

            if (isVertical) {
                // En vertical colocado justo al lado de la linea
                const offsetDist = Math.max(4 * rulerScale, r.label.height() * 0.35 + 1.5 * rulerScale);
                r.label.position({ x: midX + offsetDist, y: midY });
            } else {
                // En horizontal colocado mucho mas cerca de la linea por encima
                let nx = 0, ny = -1;
                if (dist > 0.001) {
                    nx = -dy / dist;
                    ny = dx / dist;
                    if (ny > 0 || (Math.abs(ny) < 0.001 && nx < 0)) {
                        nx = -nx;
                        ny = -ny;
                    }
                }
                const offsetDist = Math.max(3.5 * rulerScale, r.label.height() * 0.35 + 1.2 * rulerScale);
                r.label.position({ x: midX + nx * offsetDist, y: midY + ny * offsetDist });
            }
        }

        function konvaRulerPayload(r, index = 0) {
            if (!r) return null;
            const p1 = r.a1?.position?.() || { x: 0, y: 0 };
            const p2 = r.a2?.position?.() || { x: 0, y: 0 };
            const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const sidebarQuantityText = r.sidebarQuantityText
                || (pixelsPerFoot > 0 ? `${(distPx / pixelsPerFoot).toFixed(2)} fts` : `${Math.round(distPx)} px`);
            return {
                id: String(r.id || ''),
                index: index + 1,
                page: Number(r.page || pageNum || 1),
                color: String(r.color || '#22c55e'),
                hidden: Boolean(r.hidden),
                visible: !r.hidden,
                lengthText: String(r.label?.text?.() || sidebarQuantityText),
                sidebarQuantityText
            };
        }

        function emitKonvaRulersState() {
            if (!window.parent || window.parent === window) return;
            try {
                const pageRulers = konvaRulers
                    .filter(r => r && r.page === pageNum && r !== konvaDrawing)
                    .map((r, idx) => konvaRulerPayload(r, idx));
                window.parent.postMessage({
                    type: 'project-takeoff-rulers-updated',
                    payload: { page: Number(pageNum || 1), rulers: pageRulers }
                }, '*');
                if (konvaSelectedNode?.type === 'ruler' && konvaSelectedNode.ref) {
                    const sel = konvaSelectedNode.ref;
                    const meta = konvaRulerPayload(sel, Math.max(0, konvaRulers.filter(r => r.page === sel.page).indexOf(sel)));
                    window.parent.postMessage({
                        type: 'project-takeoff-ruler-selected',
                        payload: { selected: true, ...meta }
                    }, '*');
                }
            } catch (err) { }
        }
        window.getKonvaRulersSummary = () => konvaRulers
            .filter(r => r && r.page === pageNum && r !== konvaDrawing)
            .map((r, idx) => konvaRulerPayload(r, idx));

        function serializeKonvaForPage(pg) {
            const notes = konvaNotes
                .filter(n => n.page === pg)
                .map(n => ({ x: n.group.x(), y: n.group.y(), text: n.label.text(), fill: n.label.fill(), fontSize: n.label.fontSize(), width: n.label.width() }));
            const rulers = konvaRulers
                .filter(r => r.page === pg)
                .map(r => ({
                    id: r.id,
                    p1: r.a1.position(),
                    p2: r.a2.position(),
                    color: r.color || '#22c55e',
                    hidden: Boolean(r.hidden)
                }));
            const clouds = konvaClouds
                .filter(c => c.page === pg)
                .map(c => ({
                    x: c.group.x(),
                    y: c.group.y(),
                    w: c.w || 180,
                    h: c.h || 120,
                    stroke: c.stroke || '#ef4444',
                    strokeWidth: c.shape ? c.shape.strokeWidth() : cloudStrokeWidth
                }));
            const pins = konvaPins
                .filter(p => p.page === pg)
                .map(p => ({ x: p.group.x(), y: p.group.y() }));
            return { notes, rulers, clouds, pins };
        }

        function clearKonvaPage(pg) {
            konvaNotes.filter(n => n.page === pg).forEach(n => n.group.destroy());
            konvaRulers.filter(r => r.page === pg).forEach(r => r.group.destroy());
            konvaClouds.filter(c => c.page === pg).forEach(c => c.group.destroy());
            konvaPins.filter(p => p.page === pg).forEach(p => p.group.destroy());
            konvaNotes = konvaNotes.filter(n => n.page !== pg);
            konvaRulers = konvaRulers.filter(r => r.page !== pg);
            konvaClouds = konvaClouds.filter(c => c.page !== pg);
            konvaPins = konvaPins.filter(p => p.page !== pg);
        }

        function loadKonvaForPage(pg, data) {
            if (!useKonvaRuler) return;
            initKonvaRuler();
            clearKonvaPage(pg);
            if (!data || typeof data !== 'object') {
                emitKonvaRulersState();
                return;
            }
            (data.rulers || []).forEach(r => createKonvaRuler(r.p1, r.p2, pg, {
                id: r.id,
                color: r.color || '#22c55e',
                hidden: Boolean(r.hidden)
            }));
            (data.notes || []).forEach(n => {
                const note = createKonvaNote({ x: n.x, y: n.y }, n.text || 'annotation', pg);
                if (n.fill) note.label.fill(n.fill);
                if (n.fontSize) note.label.fontSize(n.fontSize);
                if (n.width) note.label.width(n.width);
                note.syncBg?.();
            });
            (data.clouds || []).forEach(c => {
                const initW = c.w || (c.scaleX ? c.scaleX * 180 : 180);
                const initH = c.h || (c.scaleY ? c.scaleY * 120 : 120);
                createKonvaCloud({ x: c.x, y: c.y }, pg, c.strokeWidth || cloudStrokeWidth, initW, initH, c.stroke || '#ef4444');
            });
            (data.pins || []).forEach(p => {
                createKonvaPin({ x: p.x, y: p.y }, pg);
            });
            setKonvaPage(pg);
        }

        function saveCurrentPageAnnotations() {
            if (!window.takeoffCanWrite()) return false;
            const fabricJson = JSON.stringify(canvas.toJSON(['isMeasureLine', 'labelId', 'labelOffsetX', 'labelOffsetY']));
            if (!useKonvaRuler) {
                allAnnotations[pageNum] = fabricJson;
                persistDraftAnnotations();
                return;
            }
            allAnnotations[pageNum] = {
                fabric: fabricJson,
                konva: serializeKonvaForPage(pageNum)
            };
            persistDraftAnnotations();
        }

        function getSavedPageState(pg) {
            const raw = allAnnotations[pg];
            if (!raw) return { fabric: null, konva: null };
            if (typeof raw === 'string') return { fabric: raw, konva: null };
            return { fabric: raw.fabric || null, konva: raw.konva || null };
        }

        function updateKonvaInteractivity() {
            const allowEdit = (currentMode === 'smart' && !pendingPlacementTool);
            konvaRulers.forEach(r => {
                r.group.draggable(allowEdit);
                r.a1.draggable(allowEdit);
                r.a2.draggable(allowEdit);
                if (konvaDrawing === r) {
                    r.a1.visible(true);
                    r.a2.visible(true);
                } else {
                    const selected = allowEdit && konvaSelectedNode?.type === 'ruler' && konvaSelectedNode.ref === r;
                    r.a1.visible(selected);
                    r.a2.visible(selected);
                }
            });
            konvaNotes.forEach(n => {
                n.group.draggable(allowEdit);
            });
            konvaClouds.forEach(c => {
                c.group.draggable(allowEdit);
            });
            konvaPins.forEach(p => {
                p.group.draggable(allowEdit);
            });
            if (konvaTransformer) {
                if (!allowEdit) konvaTransformer.nodes([]);
            }
            if (konvaLayer) konvaLayer.batchDraw();
        }

        function setKonvaPage(page) {
            konvaRulers.forEach(r => {
                r.group.visible(r.page === page && !r.hidden);
            });
            konvaNotes.forEach(n => {
                n.group.visible(n.page === page);
            });
            konvaClouds.forEach(c => {
                c.group.visible(c.page === page);
            });
            konvaPins.forEach(p => {
                p.group.visible(p.page === page);
            });
            if (konvaTransformer) {
                konvaTransformer.nodes([]);
            }
            konvaSelectedNode = null;
            konvaRulers.forEach(r => {
                r.a1.visible(false);
                r.a2.visible(false);
            });
            if (konvaLayer) konvaLayer.batchDraw();
            emitKonvaRulersState();
            if (typeof window.setTakeoffPage === 'function') window.setTakeoffPage(page);
        }

        function createKonvaRuler(p1, p2, targetPage = pageNum, options = {}) {
            const rulerColor = String(options.color || '#22c55e');
            const isHidden = Boolean(options.hidden);
            const rulerId = String(options.id || ('ruler_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)));
            const group = new Konva.Group({ draggable: true, visible: targetPage === pageNum && !isHidden });
            const line = new Konva.Line({
                points: [p1.x, p1.y, p2.x, p2.y],
                stroke: rulerColor,
                strokeWidth: 2,
                hitStrokeWidth: 20,
                lineCap: 'round',
                lineJoin: 'round'
            });
            const a1 = new Konva.Circle({
                x: p1.x, y: p1.y,
                radius: 4.2,
                fill: rulerColor,
                stroke: '#ffffff',
                strokeWidth: 1.6,
                shadowColor: 'rgba(0,0,0,0.25)',
                shadowBlur: 2,
                hitStrokeWidth: 20,
                draggable: true,
                visible: true
            });
            const a2 = new Konva.Circle({
                x: p2.x, y: p2.y,
                radius: 4.2,
                fill: rulerColor,
                stroke: '#ffffff',
                strokeWidth: 1.6,
                shadowColor: 'rgba(0,0,0,0.25)',
                shadowBlur: 2,
                hitStrokeWidth: 20,
                draggable: true,
                visible: true
            });
            const label = new Konva.Text({
                x: (p1.x + p2.x) / 2,
                y: (p1.y + p2.y) / 2,
                text: '',
                fontSize: 14.4,
                fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                fontStyle: 'bold',
                fill: rulerColor,
                stroke: '#ffffff',
                strokeWidth: 2.8,
                fillAfterStrokeEnabled: true,
                padding: 1.5,
                listening: false
            });

            group.add(line, a1, a2, label);
            konvaLayer.add(group);
            group.moveToTop();

            const ruler = { id: rulerId, color: rulerColor, hidden: isHidden, group, line, a1, a2, label, page: targetPage };
            konvaRulers.push(ruler);
            if (!konvaRulersByPage[targetPage]) konvaRulersByPage[targetPage] = [];
            konvaRulersByPage[targetPage].push(ruler);

            const updateLine = () => {
                const p1c = a1.position();
                const p2c = a2.position();
                line.points([p1c.x, p1c.y, p2c.x, p2c.y]);
                updateKonvaLabel(ruler);
                konvaLayer.batchDraw();
            };

            a1.on('mouseenter', () => { if (konvaStage?.container()) konvaStage.container().style.cursor = 'grab'; });
            a1.on('mouseleave', () => { if (konvaStage?.container()) konvaStage.container().style.cursor = 'default'; });
            a1.on('dragstart', e => { e.cancelBubble = true; if (konvaStage?.container()) konvaStage.container().style.cursor = 'grabbing'; });
            a1.on('dragmove', e => { e.cancelBubble = true; updateLine(); });
            a1.on('dragend', e => { e.cancelBubble = true; if (konvaStage?.container()) konvaStage.container().style.cursor = 'grab'; saveCurrentPageAnnotations(); emitKonvaRulersState(); });
            a1.on('click tap', e => { if (currentMode === 'measure' || konvaDrawing) return; e.cancelBubble = true; });
            a1.on('mousedown touchstart', e => { if (currentMode === 'measure' || konvaDrawing) return; e.cancelBubble = true; });

            a2.on('mouseenter', () => { if (konvaStage?.container()) konvaStage.container().style.cursor = 'grab'; });
            a2.on('mouseleave', () => { if (konvaStage?.container()) konvaStage.container().style.cursor = 'default'; });
            a2.on('dragstart', e => { e.cancelBubble = true; if (konvaStage?.container()) konvaStage.container().style.cursor = 'grabbing'; });
            a2.on('dragmove', e => { e.cancelBubble = true; updateLine(); });
            a2.on('dragend', e => { e.cancelBubble = true; if (konvaStage?.container()) konvaStage.container().style.cursor = 'grab'; saveCurrentPageAnnotations(); emitKonvaRulersState(); });
            a2.on('click tap', e => { if (currentMode === 'measure' || konvaDrawing) return; e.cancelBubble = true; });
            a2.on('mousedown touchstart', e => { if (currentMode === 'measure' || konvaDrawing) return; e.cancelBubble = true; });

            group.on('dragmove', () => {
                updateKonvaLabel(ruler);
                konvaLayer.batchDraw();
            });
            group.on('dragend', () => { saveCurrentPageAnnotations(); emitKonvaRulersState(); });

            const selectRuler = (e) => {
                if (konvaDrawing) return;
                if (e) e.cancelBubble = true;
                if (currentMode !== 'smart') {
                    setMode('smart');
                }
                if (konvaTransformer) konvaTransformer.nodes([]);
                konvaSelectedNode = { type: 'ruler', ref: ruler };
                konvaRulers.forEach(r => {
                    const active = r === ruler;
                    r.a1.visible(active && !r.hidden);
                    r.a2.visible(active && !r.hidden);
                    if (active) {
                        r.group.moveToTop();
                        r.a1.moveToTop();
                        r.a2.moveToTop();
                    }
                });
                konvaLayer.batchDraw();
                const meta = konvaRulerPayload(ruler, Math.max(0, konvaRulers.filter(r => r.page === ruler.page).indexOf(ruler)));
                try {
                    window.parent?.postMessage({
                        type: 'project-takeoff-ruler-selected',
                        payload: {
                            selected: true,
                            ...meta
                        }
                    }, '*');
                } catch (err) { }
            };
            ruler.select = selectRuler;

            group.on('pointerdown mousedown', selectRuler);
            group.on('click tap', selectRuler);
            line.on('pointerdown mousedown', selectRuler);
            line.on('click tap', selectRuler);

            updateKonvaLabel(ruler);
            updateKonvaInteractivity();
            return ruler;
        }

        function isKonvaNoteEmpty(note) {
            if (!note || !note.label) return true;
            const raw = String(note.label.text() || '');
            const trimmed = raw.trim();
            return trimmed === '';
        }

        function removeKonvaNote(note) {
            if (!window.takeoffRequireWrite()) return false;
            if (!note) return;
            if (konvaSelectedNote === note) konvaSelectedNote = null;
            if (konvaSelectedNode && konvaSelectedNode.type === 'note' && konvaSelectedNode.ref === note) {
                konvaSelectedNode = null;
            }
            if (konvaTransformer) konvaTransformer.nodes([]);
            note.group.destroy();
            konvaNotes = konvaNotes.filter(n => n !== note);
            if (konvaLayer) konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
        }

        function discardEmptyActiveKonvaNote() {
            if (!konvaSelectedNote) return false;
            if (!isKonvaNoteEmpty(konvaSelectedNote)) return false;
            removeKonvaNote(konvaSelectedNote);
            showToast("Empty note discarded", "warning");
            return true;
        }

        function getResponsiveNotePreset() {
            const width = window.innerWidth || 1280;
            if (width <= 640) return { fontSize: 42, minEditW: 180, minEditH: 52 };
            if (width <= 1024) return { fontSize: 54, minEditW: 220, minEditH: 64 };
            return { fontSize: 64, minEditW: 260, minEditH: 72 };
        }

        function createKonvaNote(pos, text = 'annotation', targetPage = pageNum) {
            if (!window.takeoffRequireWrite()) return false;
            const preset = getResponsiveNotePreset();
            const group = new Konva.Group({ x: pos.x, y: pos.y, draggable: true });
            const padX = 10;
            const padY = 8;
            const initialW = 160;

            const bgRect = new Konva.Rect({
                x: -padX,
                y: -padY,
                width: initialW + (padX * 2),
                height: 44,
                fill: 'transparent',
                stroke: 'transparent',
                strokeWidth: 0,
                cornerRadius: 4
            });

            const label = new Konva.Text({
                x: 0,
                y: 0,
                text,
                fontSize: 18,
                fill: '#0f172a',
                fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                width: initialW,
                wrap: 'word',
                padding: 0
            });

            const syncBg = () => {
                const w = Math.max(40, label.width());
                const h = Math.max(20, label.height());
                bgRect.width(w + (padX * 2));
                bgRect.height(h + (padY * 2));
            };
            syncBg();

            group.add(bgRect);
            group.add(label);
            konvaLayer.add(group);

            const note = { group, label, bgRect, page: targetPage, syncBg };
            konvaNotes.push(note);

            const notifyNoteSelect = () => {
                if (currentMode !== 'smart') setMode('smart');
                konvaSelectedNote = note;
                konvaSelectedNode = { type: 'note', ref: note };
                if (konvaTransformer) {
                    // Only allow edge anchors (width / height) - NO corners that distort font size
                    konvaTransformer.enabledAnchors(['middle-left', 'middle-right', 'top-center', 'bottom-center']);
                    konvaTransformer.nodes([group]);
                }
                showPropSection('text');
                const sizeInput = document.getElementById('text-size-input');
                if (sizeInput) sizeInput.value = Math.round(note.label.fontSize());
                try {
                    window.parent?.postMessage({
                        type: 'project-takeoff-note-selected',
                        payload: {
                            selected: true,
                            fontSize: Math.round(note.label.fontSize()),
                            color: note.label.fill(),
                            text: note.label.text()
                        }
                    }, '*');
                } catch (err) { }
            };

            group.on('click tap', notifyNoteSelect);
            group.on('dragend', saveCurrentPageAnnotations);
            label.on('dblclick dbltap', () => {
                notifyNoteSelect();
                startInlineNoteEdit(note);
            });
            group.on('dblclick dbltap', () => {
                notifyNoteSelect();
                startInlineNoteEdit(note);
            });

            group.on('transform', () => {
                const scaleX = group.scaleX();
                const scaleY = group.scaleY();
                const newWidth = Math.max(40, (label.width() || 160) * scaleX);
                group.scaleX(1);
                group.scaleY(1);
                label.width(newWidth);
                label.wrap('word');
                syncBg();
                konvaLayer.batchDraw();
            });

            updateKonvaInteractivity();
            return note;
        }

        function createKonvaCloud(pos, targetPage = pageNum, strokeWidth = 3.5, initialW = 180, initialH = 120, cloudColor = '#ef4444') {
            if (!window.takeoffRequireWrite()) return false;
            const group = new Konva.Group({ x: pos.x, y: pos.y, draggable: true });

            const cloud = {
                group,
                page: targetPage,
                w: initialW,
                h: initialH,
                stroke: cloudColor
            };

            const pad = 12;
            const stroke = cloudColor;

            const cloudShape = new Konva.Shape({
                sceneFunc: (ctx, shape) => {
                    const w = cloud.w || 180;
                    const h = cloud.h || 120;
                    const left = -w / 2;
                    const top = -h / 2;
                    const right = w / 2;
                    const bottom = h / 2;
                    const arcSize = 20;

                    const numArcsX = Math.max(2, Math.round(w / arcSize));
                    const stepX = w / numArcsX;
                    const numArcsY = Math.max(2, Math.round(h / arcSize));
                    const stepY = h / numArcsY;

                    ctx.beginPath();

                    // Top: left to right
                    ctx.moveTo(left, top);
                    for (let i = 0; i < numArcsX; i++) {
                        const startX = left + i * stepX;
                        const endX = left + (i + 1) * stepX;
                        const midX = (startX + endX) / 2;
                        ctx.quadraticCurveTo(midX, top - 8, endX, top);
                    }

                    // Right: top to bottom
                    for (let i = 0; i < numArcsY; i++) {
                        const startY = top + i * stepY;
                        const endY = top + (i + 1) * stepY;
                        const midY = (startY + endY) / 2;
                        ctx.quadraticCurveTo(right + 8, midY, right, endY);
                    }

                    // Bottom: right to left
                    for (let i = 0; i < numArcsX; i++) {
                        const startX = right - i * stepX;
                        const endX = right - (i + 1) * stepX;
                        const midX = (startX + endX) / 2;
                        ctx.quadraticCurveTo(midX, bottom + 8, endX, bottom);
                    }

                    // Left: bottom to top
                    for (let i = 0; i < numArcsY; i++) {
                        const startY = bottom - i * stepY;
                        const endY = bottom - (i + 1) * stepY;
                        const midY = (startY + endY) / 2;
                        ctx.quadraticCurveTo(left - 8, midY, left, endY);
                    }

                    ctx.closePath();
                    ctx.fillStrokeShape(shape);
                },
                stroke,
                strokeWidth: strokeWidth || 3.5,
                fill: 'transparent',
                shadowColor: stroke,
                shadowBlur: 8,
                shadowOpacity: 0.18
            });

            const hitBox = new Konva.Rect({
                x: -(cloud.w / 2) - pad,
                y: -(cloud.h / 2) - pad,
                width: cloud.w + (pad * 2),
                height: cloud.h + (pad * 2),
                fill: 'rgba(0,0,0,0.001)',
                strokeWidth: 0
            });

            group.add(cloudShape);
            group.add(hitBox);
            konvaLayer.add(group);

            cloud.shape = cloudShape;
            cloud.hitBox = hitBox;
            konvaClouds.push(cloud);

            const selectCloud = () => {
                if (currentMode !== 'smart') setMode('smart');
                if (konvaTransformer) {
                    konvaTransformer.enabledAnchors(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']);
                    konvaTransformer.nodes([group]);
                }
                konvaSelectedNode = { type: 'cloud', ref: cloud };
                cloudStrokeWidth = cloud.shape.strokeWidth();
                syncCloudStrokeControl(cloudStrokeWidth);
                showPropSection('cloud');
                try {
                    window.parent?.postMessage({
                        type: 'project-takeoff-cloud-selected',
                        payload: {
                            selected: true,
                            color: cloud.stroke || stroke || '#ef4444'
                        }
                    }, '*');
                } catch (err) { }
            };

            group.on('click tap', selectCloud);
            group.on('dblclick dbltap', selectCloud);
            group.on('dragend', saveCurrentPageAnnotations);

            group.on('transform', () => {
                const scaleX = group.scaleX();
                const scaleY = group.scaleY();
                cloud.w = Math.max(40, (cloud.w || 180) * scaleX);
                cloud.h = Math.max(30, (cloud.h || 120) * scaleY);
                group.scaleX(1);
                group.scaleY(1);
                hitBox.x(-(cloud.w / 2) - pad);
                hitBox.y(-(cloud.h / 2) - pad);
                hitBox.width(cloud.w + pad * 2);
                hitBox.height(cloud.h + pad * 2);
                konvaLayer.batchDraw();
            });

            updateKonvaInteractivity();
            return cloud;
        }

        function createKonvaPin(pos, targetPage = pageNum) {
            if (!window.takeoffRequireWrite()) return false;
            const group = new Konva.Group({ x: pos.x, y: pos.y, draggable: true });
            const pinPath = new Konva.Path({
                data: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
                fill: '#ef4444',
                stroke: '#ffffff',
                strokeWidth: 1.2,
                scale: { x: 1.6, y: 1.6 },
                offset: { x: 12, y: 22 },
                shadowColor: 'rgba(0,0,0,0.4)',
                shadowBlur: 5,
                shadowOffset: { x: 1, y: 2 }
            });
            group.add(pinPath);
            konvaLayer.add(group);
            const pin = { group, path: pinPath, page: targetPage };
            konvaPins.push(pin);

            group.on('click tap', () => {
                if (currentMode !== 'smart') setMode('smart');
                konvaSelectedNode = { type: 'pin', ref: pin };
                if (konvaTransformer) konvaTransformer.nodes([]);
                showToast('Pin marker selected', 'info');
            });
            group.on('dragend', saveCurrentPageAnnotations);
            updateKonvaInteractivity();
            return pin;
        }

        function ensureKonvaTransformer() {
            if (!konvaLayer) return;
            if (!konvaTransformer) {
                konvaTransformer = new Konva.Transformer({
                    enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center'],
                    rotateEnabled: false,
                    keepRatio: false,
                    boundBoxFunc: (oldBox, newBox) => {
                        if (newBox.width < 20 || newBox.height < 20) return oldBox;
                        return newBox;
                    }
                });
                konvaTransformer.on('transformend', saveCurrentPageAnnotations);
                konvaLayer.add(konvaTransformer);
            }
        }

        function deleteKonvaSelection() {
            if (!window.takeoffRequireWrite()) return false;
            if (!konvaSelectedNode) return false;
            const { type, ref } = konvaSelectedNode;
            if (type === 'ruler') {
                ref.group.destroy();
                konvaRulers = konvaRulers.filter(r => r !== ref);
                if (konvaRulersByPage[ref.page]) {
                    konvaRulersByPage[ref.page] = konvaRulersByPage[ref.page].filter(r => r !== ref);
                }
                try {
                    window.parent?.postMessage({
                        type: 'project-takeoff-ruler-selected',
                        payload: { selected: false }
                    }, '*');
                } catch (err) { }
            } else if (type === 'note') {
                if (konvaSelectedNote === ref) konvaSelectedNote = null;
                ref.group.destroy();
                konvaNotes = konvaNotes.filter(n => n !== ref);
                try {
                    window.parent?.postMessage({
                        type: 'project-takeoff-note-selected',
                        payload: { selected: false }
                    }, '*');
                } catch (err) { }
            } else if (type === 'cloud') {
                ref.group.destroy();
                konvaClouds = konvaClouds.filter(c => c !== ref);
            } else if (type === 'pin') {
                ref.group.destroy();
                konvaPins = konvaPins.filter(p => p !== ref);
            }
            konvaSelectedNode = null;
            if (konvaTransformer) konvaTransformer.nodes([]);
            if (konvaLayer) konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
            emitKonvaRulersState();
            return true;
        }
        window.deleteKonvaSelection = deleteKonvaSelection;

        function startInlineNoteEdit(note, options = {}) {
            if (!note || !konvaStage || !konvaLayer) return;
            if (konvaEditingTextarea) konvaEditingTextarea.blur();
            konvaSelectedNote = note;
            const container = konvaStage.container();
            const textNode = note.label;
            const absPos = textNode.getAbsolutePosition();
            const absScale = textNode.getAbsoluteScale();
            const originalText = textNode.text();
            let finished = false;

            if (!konvaEditingTextarea) {
                konvaEditingTextarea = document.createElement('textarea');
                konvaEditingTextarea.style.position = 'absolute';
                konvaEditingTextarea.style.zIndex = '3000';
                konvaEditingTextarea.style.resize = 'none';
                konvaEditingTextarea.style.border = '1px dashed #3b82f6';
                konvaEditingTextarea.style.borderRadius = '3px';
                konvaEditingTextarea.style.padding = '2px 4px';
                konvaEditingTextarea.style.outline = 'none';
                konvaEditingTextarea.style.background = 'transparent';
                konvaEditingTextarea.style.color = textNode.fill() || '#0f172a';
                container.appendChild(konvaEditingTextarea);
            }

            const fontSizePx = textNode.fontSize() * Math.abs(absScale.x || 1);
            konvaEditingTextarea.style.fontSize = fontSizePx + 'px';
            konvaEditingTextarea.style.lineHeight = '1.2';
            // Absolute Konva coordinates already include the stage viewport transform.
            konvaEditingTextarea.style.left = absPos.x + 'px';
            konvaEditingTextarea.style.top = absPos.y + 'px';
            const preset = getResponsiveNotePreset();
            konvaEditingTextarea.style.width = Math.max(preset.minEditW, textNode.width() * Math.abs(absScale.x || 1)) + 'px';
            konvaEditingTextarea.style.height = Math.max(preset.minEditH, textNode.height() * Math.abs(absScale.y || 1)) + 'px';
            konvaEditingTextarea.style.background = 'transparent';
            konvaEditingTextarea.style.border = '1px dashed #3b82f6';
            konvaEditingTextarea.style.boxShadow = 'none';
            konvaEditingTextarea.style.color = textNode.fill() || '#0f172a';
            konvaEditingTextarea.style.caretColor = textNode.fill() || '#0f172a';
            konvaEditingTextarea.value = textNode.text();
            textNode.visible(false);
            konvaLayer.batchDraw();
            konvaEditingTextarea.focus();
            if (options.selectAll) konvaEditingTextarea.select();

            const finish = (cancelled = false) => {
                if (finished || !konvaEditingTextarea) return;
                finished = true;
                const textarea = konvaEditingTextarea;
                const next = textarea.value.trim();
                textNode.text(cancelled ? originalText : next);
                textNode.visible(true);
                textarea.remove();
                konvaEditingTextarea = null;
                if (cancelled && options.isNew) {
                    removeKonvaNote(note);
                    return;
                }
                if (isKonvaNoteEmpty(note)) {
                    removeKonvaNote(note);
                    showToast("Empty note discarded", "warning");
                    saveCurrentPageAnnotations();
                    return;
                }
                konvaLayer.batchDraw();
                saveCurrentPageAnnotations();
            };

            const onInput = () => {
                if (konvaEditingTextarea) textNode.text(konvaEditingTextarea.value);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    finish(true);
                    return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    finish();
                }
            };
            const onBlur = () => finish();
            konvaEditingTextarea.addEventListener('input', onInput);
            konvaEditingTextarea.addEventListener('keydown', onKey);
            konvaEditingTextarea.addEventListener('blur', onBlur);
        }

        function completePendingPlacement(end) {
            if (!pendingPlacementTool || !pendingPlacementStart || !end) return false;
            const tool = pendingPlacementTool;
            const minX = Math.min(pendingPlacementStart.x, end.x);
            const minY = Math.min(pendingPlacementStart.y, end.y);
            const width = Math.max(10, Math.abs(end.x - pendingPlacementStart.x));
            const height = Math.max(10, Math.abs(end.y - pendingPlacementStart.y));
            const cx = minX + (width / 2);
            const cy = minY + (height / 2);

            if (pendingPlacementPreview) {
                pendingPlacementPreview.destroy();
                pendingPlacementPreview = null;
            }

            if (tool === 'note') {
                const note = createKonvaNote({ x: minX, y: minY }, 'annotation');
                note.label.width(Math.max(60, width));
                note.syncBg?.();
                if (konvaTransformer) {
                    konvaTransformer.enabledAnchors(['middle-left', 'middle-right', 'top-center', 'bottom-center']);
                    konvaTransformer.nodes([note.group]);
                }
                konvaSelectedNode = { type: 'note', ref: note };
                konvaSelectedNote = note;
                clearPlacementTool();
                startInlineNoteEdit(note, { selectAll: true, isNew: true });
            } else if (tool === 'cloud') {
                const cloud = createKonvaCloud({ x: cx, y: cy }, pageNum, cloudStrokeWidth, width, height);
                if (konvaTransformer) {
                    konvaTransformer.enabledAnchors(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']);
                    konvaTransformer.nodes([cloud.group]);
                }
                konvaSelectedNode = { type: 'cloud', ref: cloud };
                clearPlacementTool();
                saveCurrentPageAnnotations();
            } else if (tool === 'pin') {
                const pin = createKonvaPin({ x: minX, y: minY });
                clearPlacementTool();
                saveCurrentPageAnnotations();
            }
            return true;
        }

        function initKonvaRuler() {
            if (!useKonvaRuler || konvaStage) return;
            const w = document.getElementById('canvas-wrapper');
            if (!w) return;
            konvaStage = new Konva.Stage({
                container: 'konva-overlay',
                // Hidden project tabs report 0x0 during initialization. Konva's
                // internal scene compositor cannot draw from a zero-sized canvas.
                // Keep a harmless backing surface until `takeoff-visible`/resize
                // applies the real viewport dimensions.
                width: Math.max(1, w.clientWidth),
                height: Math.max(1, w.clientHeight)
            });
            konvaLayer = new Konva.Layer();
            konvaStage.add(konvaLayer);
            ensureKonvaTransformer();

            // Zoom desde Konva -> Fabric (para no bloquear zoom)
            function computeWheelZoomFactor(e) {
                const delta = Number(e?.deltaY || 0);
                // Trackpad pinch gestures are emitted as synthetic wheel events with ctrlKey=true
                // and small per-frame deltaY values; boost sensitivity without changing mouse wheel.
                if (e?.ctrlKey && Math.abs(delta) < 40) {
                    const pinchFactor = 0.986 ** delta;
                    return Math.max(0.78, Math.min(1.28, pinchFactor));
                }
                return Math.abs(delta) >= 30 ? (delta < 0 ? 1.18 : 0.85) : (0.9975 ** delta);
            }

            konvaStage.container().addEventListener('wheel', function (e) {
                e.preventDefault();
                const factor = computeWheelZoomFactor(e);
                let zoom = canvas.getZoom() * factor;
                const minZoom = Math.min(0.25, pdfFitZoom ? pdfFitZoom * 0.5 : 0.25);
                if (zoom > 4.0) zoom = 4.0; if (zoom < minZoom) zoom = minZoom;
                const rect = konvaStage.container().getBoundingClientRect();
                const point = new fabric.Point(e.clientX - rect.left, e.clientY - rect.top);
                canvas.zoomToPoint(point, zoom);
                clampViewportTransform(canvas.viewportTransform);
                canvas.setViewportTransform(canvas.viewportTransform);
                notifyTakeoffZoomChanged('wheel');
                scheduleViewportFrameUpdate(zoom, { clientX: e.clientX, clientY: e.clientY });
            }, { passive: false });

            // Pan desde Konva -> Fabric (ALT o botón derecho)
            let panStart = null;
            let backgroundPanCandidate = null;
            let backgroundPanGestureActive = false;
            let panRenderRaf = null;
            const schedulePanFrameRender = () => {
                if (panRenderRaf) return;
                const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : cb => setTimeout(cb, 0);
                panRenderRaf = raf(() => {
                    const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
                    panRenderRaf = null;
                    canvas.requestRenderAll();
                    applyKonvaViewportCssTransform();
                    recordViewportWork('pan', startedAt);
                });
            };
            const emitBackgroundPanState = (active) => {
                try {
                    window.parent?.postMessage({
                        type: 'project-takeoff-pan-state',
                        payload: { active: Boolean(active), source: 'background-gesture' }
                    }, '*');
                } catch (e) { }
            };
            const releaseCanvasPointerState = () => {
                const notifyGestureEnd = backgroundPanGestureActive;
                const wasPanning = konvaIsPanning;
                if (panRenderRaf) {
                    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(panRenderRaf);
                    panRenderRaf = null;
                }
                if (backgroundPanGestureActive || konvaIsPanning) {
                    window.__takeoffJustPanned = true;
                    setTimeout(() => { window.__takeoffJustPanned = false; }, 140);
                }
                konvaIsPanning = false;
                window.__takeoffIsPanning = false;
                panStart = null;
                backgroundPanCandidate = null;
                backgroundPanGestureActive = false;
                if (konvaLayer) konvaLayer.listening(true);
                if (wasPanning) {
                    canvas?.requestRenderAll();
                    syncKonvaToFabric({ panOnly: true, immediate: true });
                }
                if (canvas) {
                    canvas.isDragging = false;
                    canvas.selection = currentMode === 'smart';
                    canvas.defaultCursor = 'default';
                    canvas.setCursor('default');
                }
                if (konvaStage?.container()) {
                    konvaStage.container().style.cursor = (konvaPanMode || konvaTemporaryPan) ? 'grab' : 'default';
                }
                if (notifyGestureEnd) emitBackgroundPanState(false);
            };
            window.releaseTakeoffPointerState = releaseCanvasPointerState;
            window.setTakeoffPanMode = (enabled, temporary = false) => {
                releaseCanvasPointerState();
                if (temporary) konvaTemporaryPan = Boolean(enabled);
                else konvaPanMode = Boolean(enabled);
                if (konvaStage?.container()) {
                    konvaStage.container().style.cursor = (konvaPanMode || konvaTemporaryPan) ? 'grab' : 'default';
                }
            };
            const panContainer = konvaStage.container();
            if (!panContainer._takeoffPanPointerBound) {
                panContainer._takeoffPanPointerBound = true;
                panContainer.addEventListener('pointerdown', evt => {
                    // Annotation placement owns the complete first gesture, even if
                    // the previously selected tool was Hand/Pan.
                    if (pendingPlacementTool) return;
                    const panActive = konvaPanMode || konvaTemporaryPan
                        || Boolean(window.projectTakeoffIsPanModeActive?.());
                    if (!panActive || (evt.button !== 0 && evt.button !== 1 && evt.button !== 2)) return;
                    evt.preventDefault();
                    evt.stopImmediatePropagation();
                    panStart = { x: evt.clientX, y: evt.clientY };
                    konvaIsPanning = true;
                    if (konvaLayer) konvaLayer.listening(false);
                    panContainer.style.cursor = 'grabbing';
                    try { panContainer.setPointerCapture(evt.pointerId); } catch (e) { }
                }, true);
                panContainer.addEventListener('pointermove', evt => {
                    if (!konvaIsPanning || !panStart) return;
                    evt.preventDefault();
                    evt.stopImmediatePropagation();
                    const vpt = canvas.viewportTransform;
                    vpt[4] += evt.clientX - panStart.x;
                    vpt[5] += evt.clientY - panStart.y;
                    clampViewportTransform(vpt);
                    panStart = { x: evt.clientX, y: evt.clientY };
                    schedulePanFrameRender();
                }, true);
                const finishPointerPan = evt => {
                    if (!konvaIsPanning) return;
                    try { panContainer.releasePointerCapture(evt.pointerId); } catch (e) { }
                    releaseCanvasPointerState();
                };
                panContainer.addEventListener('pointerup', finishPointerPan, true);
                panContainer.addEventListener('pointercancel', finishPointerPan, true);
            }
            konvaStage.on('mousedown touchstart', (e) => {
                const pos = konvaStage.getPointerPosition();
                // Placement must also work over the PDF and existing annotations.
                if (pendingPlacementTool) {
                    if (!pos) return;
                    const world = screenToWorld(pos);
                    e.cancelBubble = true;
                    if (pendingPlacementStart) {
                        completePendingPlacement(world);
                        return;
                    }
                    pendingPlacementStart = world;
                    if (pendingPlacementPreview) pendingPlacementPreview.destroy();
                    pendingPlacementPreview = new Konva.Rect({
                        x: pendingPlacementStart.x,
                        y: pendingPlacementStart.y,
                        width: 1,
                        height: 1,
                        stroke: '#22c55e',
                        strokeWidth: 1.5,
                        dash: [6, 4],
                        listening: false
                    });
                    konvaLayer.add(pendingPlacementPreview);
                    konvaLayer.batchDraw();
                    return;
                }
                if (currentMode !== 'measure') return;
                if (!pos) return;
                const world = screenToWorld(pos);
                e.cancelBubble = true;
                if (konvaDrawing && konvaRulerAnchor) {
                    const p1 = konvaDrawing.a1.position();
                    const dist = Math.hypot(world.x - p1.x, world.y - p1.y);
                    if (dist > 5) {
                        konvaDrawing.a2.position(world);
                        konvaDrawing.line.points([
                            p1.x, p1.y,
                            world.x, world.y
                        ]);
                        konvaDrawing.placedNodes = 2;
                        finalizeKonvaRulerDrawing(konvaDrawing);
                        return;
                    }
                    return;
                }
                konvaDrawing = createKonvaRuler(world, world);
                konvaDrawing.placedNodes = 1;
                konvaDrawing.a1.visible(true);
                konvaDrawing.a2.visible(true);
                konvaDrawing.group.listening(false);
                konvaDrawing.line.listening(false);
                konvaDrawing.a1.listening(false);
                konvaDrawing.a2.listening(false);
                konvaDrawing.group.moveToTop();
                konvaDrawing.a1.moveToTop();
                konvaDrawing.a2.moveToTop();
                konvaRulerAnchor = world;
                updateKonvaLabel(konvaDrawing);
                konvaLayer.batchDraw();
            });

            konvaStage.on('mousemove touchmove', () => {
                const pos = konvaStage.getPointerPosition();
                if (pendingPlacementTool && pendingPlacementStart && pendingPlacementPreview && pos) {
                    const world = screenToWorld(pos);
                    const x = Math.min(pendingPlacementStart.x, world.x);
                    const y = Math.min(pendingPlacementStart.y, world.y);
                    const w = Math.max(1, Math.abs(world.x - pendingPlacementStart.x));
                    const h = Math.max(1, Math.abs(world.y - pendingPlacementStart.y));
                    pendingPlacementPreview.position({ x, y });
                    pendingPlacementPreview.size({ width: w, height: h });
                    konvaLayer.batchDraw();
                    return;
                }
                if (!konvaDrawing) return;
                if (!pos) return;
                const world = screenToWorld(pos);
                konvaDrawing.a2.position(world);
                konvaDrawing.line.points([
                    konvaDrawing.a1.x(), konvaDrawing.a1.y(),
                    world.x, world.y
                ]);
                konvaDrawing.a1.visible(true);
                konvaDrawing.a2.visible(true);
                konvaDrawing.group.moveToTop();
                konvaDrawing.a1.moveToTop();
                konvaDrawing.a2.moveToTop();
                updateKonvaLabel(konvaDrawing);
                konvaLayer.batchDraw();
            });

            konvaStage.on('mouseup touchend', () => {
                if (pendingPlacementTool && pendingPlacementStart) {
                    return;
                }

                if (!konvaDrawing) return;
                if (!konvaRulerAnchor) return;
                const p1 = konvaDrawing.a1.position();
                const p2 = konvaDrawing.a2.position();
                const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (dist > 15) {
                    konvaDrawing.placedNodes = 2;
                    finalizeKonvaRulerDrawing(konvaDrawing);
                }
            });

            konvaStage.on('mousedown touchstart', (e) => {
                const evt = e.evt;
                const target = e.target;
                const isEmpty = !target || target === konvaStage;
                if (pendingPlacementTool) return;
                const explicitPan = evt && (evt.altKey || evt.button === 2);
                const takeoffDrawing = Boolean(window.projectTakeoffIsDrawingToolActive?.());
                const isCountToolActive = Boolean(window.projectTakeoffIsCountToolActive?.());
                const clientX = evt.clientX != null ? evt.clientX : evt.touches?.[0]?.clientX;
                const clientY = evt.clientY != null ? evt.clientY : evt.touches?.[0]?.clientY;
                if (clientX == null || clientY == null) return;

                const requestedPan = konvaPanMode || konvaTemporaryPan || (explicitPan && isEmpty);
                if (evt && requestedPan && (!takeoffDrawing || konvaTemporaryPan)) {
                    e.cancelBubble = true;
                    panStart = { x: clientX, y: clientY };
                    konvaIsPanning = true;
                    window.__takeoffIsPanning = true;
                    konvaStage.container().style.cursor = 'grabbing';
                    return;
                }
                const primaryBackgroundGesture = evt && evt.button === 0 && currentMode === 'smart'
                    && isEmpty && !takeoffDrawing && !pendingPlacementTool;
                const drawingPanGesture = evt && evt.button === 0 && takeoffDrawing && isEmpty && !pendingPlacementTool;
                if (primaryBackgroundGesture || drawingPanGesture) {
                    backgroundPanCandidate = { x: clientX, y: clientY };
                }
            });
            konvaStage.on('click tap', (e) => {
                const target = e.target;
                const isEmpty = !target || target === konvaStage;

                if (currentMode === 'smart' && konvaSelectedNote && isKonvaNoteEmpty(konvaSelectedNote)) {
                    const clickedInsideSelectedNote = target && (
                        target === konvaSelectedNote.group ||
                        target === konvaSelectedNote.label ||
                        target.getParent?.() === konvaSelectedNote.group
                    );
                    if (!clickedInsideSelectedNote) {
                        removeKonvaNote(konvaSelectedNote);
                        showToast("Empty note discarded", "warning");
                    }
                }

                const hadKonvaSelection = Boolean(
                    konvaSelectedNode
                    || konvaSelectedNote
                    || konvaTransformer?.nodes?.()?.length
                );
                if (currentMode === 'smart' && isEmpty && !window.projectTakeoffIsDrawingToolActive?.() && konvaTransformer?.nodes?.()?.length) {
                    konvaTransformer.nodes([]);
                    konvaLayer.batchDraw();
                }
                if (currentMode === 'smart' && isEmpty && !window.projectTakeoffIsDrawingToolActive?.() && hadKonvaSelection) {
                    konvaSelectedNode = null;
                    konvaSelectedNote = null;
                    konvaRulers.forEach(r => {
                        r.a1.visible(false);
                        r.a2.visible(false);
                    });
                    if (konvaLayer) konvaLayer.batchDraw();
                    try {
                        window.parent?.postMessage({
                            type: 'project-takeoff-ruler-selected',
                            payload: { selected: false }
                        }, '*');
                        window.parent?.postMessage({
                            type: 'project-takeoff-note-selected',
                            payload: { selected: false }
                        }, '*');
                        window.parent?.postMessage({
                            type: 'project-takeoff-cloud-selected',
                            payload: { selected: false }
                        }, '*');
                    } catch (err) { }
                }
            });
            konvaStage.on('mousemove touchmove', (e) => {
                if (pendingPlacementTool) return;
                const evt = e.evt;
                const clientX = evt.clientX != null ? evt.clientX : evt.touches?.[0]?.clientX;
                const clientY = evt.clientY != null ? evt.clientY : evt.touches?.[0]?.clientY;
                if (clientX == null || clientY == null) return;

                if (!konvaIsPanning && backgroundPanCandidate) {
                    const distance = Math.hypot(
                        clientX - backgroundPanCandidate.x,
                        clientY - backgroundPanCandidate.y
                    );
                    if (distance >= 5) {
                        panStart = { ...backgroundPanCandidate };
                        backgroundPanCandidate = null;
                        backgroundPanGestureActive = true;
                        konvaIsPanning = true;
                        if (konvaLayer) konvaLayer.listening(false);
                        window.__takeoffIsPanning = true;
                        konvaStage.container().style.cursor = 'grabbing';
                        emitBackgroundPanState(true);
                    }
                }
                if (!konvaIsPanning || !panStart) return;
                const vpt = canvas.viewportTransform;
                vpt[4] += clientX - panStart.x;
                vpt[5] += clientY - panStart.y;
                clampViewportTransform(vpt);
                panStart = { x: clientX, y: clientY };
                schedulePanFrameRender();
            });
            konvaStage.on('mouseup touchend', releaseCanvasPointerState);
            konvaStage.container().addEventListener('mouseleave', releaseCanvasPointerState);
            konvaStage.container().addEventListener('pointercancel', releaseCanvasPointerState);
            window.addEventListener('pointerup', releaseCanvasPointerState);
            window.addEventListener('mouseup', releaseCanvasPointerState);
            window.addEventListener('touchend', releaseCanvasPointerState, { passive: true });
            window.addEventListener('touchcancel', releaseCanvasPointerState, { passive: true });
            window.addEventListener('blur', releaseCanvasPointerState);

            setKonvaPage(pageNum);
            setKonvaActive(currentMode === 'smart' || currentMode === 'measure');
            updateKonvaInteractivity();
        }

        // --- DOUBLE TAP & NODE LOGIC ---
        let lastTapTime = 0;
        let lastTapTarget = null;
        const DOUBLE_TAP_DELAY = 400;

        // Estado para control de modificaciÃ³n de vÃ©rtices de regla
        let controlEditMode = false; // Modo de ediciÃ³n activado con doble clic
        let activeControlPoint = null; // Punto de control activo ('p1' o 'p2')
        let renderAnimationFrame = null; // Para renderizado suave

        // --- CUSTOM CONTROLS FOR LINES (POSITION HANDLER FIXED) ---
        // Variable para rastrear si estamos manipulando un control
        let isDraggingControl = false;
        let controlDragStart = null;

        function createLineControls(line) {
            function linePositionHandler(pointName) {
                return function (dim, finalMatrix, fabricObject) {
                    const points = fabricObject.calcLinePoints();
                    const pt = (pointName === 'p1') ? new fabric.Point(points.x1, points.y1) : new fabric.Point(points.x2, points.y2);
                    return fabric.util.transformPoint(pt, finalMatrix);
                };
            }

            function lineActionHandler(pointName) {
                return function (e, transform, x, y) {
                    const target = transform.target;

                    // Solo permitir modificaciÃ³n si el modo de ediciÃ³n estÃ¡ activado (doble clic)
                    if (currentMode !== 'measure') {
                        if (!controlEditMode || activeControlPoint !== pointName) {
                            return false;
                        }
                    }

                    // Si el objeto estÃ¡ en modo "moving" (movimiento libre), no permitir modificar controles
                    if (target.isMoving && !isDraggingControl) {
                        return false;
                    }

                    // Estamos manipulando un control - permitir la acciÃ³n
                    let localPoint = null;
                    if (fabric.controlsUtils && typeof fabric.controlsUtils.getLocalPoint === 'function') {
                        localPoint = fabric.controlsUtils.getLocalPoint(transform, target.originX || 'center', target.originY || 'center', x, y);
                    } else {
                        const pt = new fabric.Point(x, y);
                        localPoint = target.toLocalPoint(pt, target.originX || 'center', target.originY || 'center');
                    }
                    if (!localPoint) return false;

                    // Actualizar las coordenadas del punto correspondiente
                    if (pointName === 'p1') {
                        target.set({ x1: localPoint.x, y1: localPoint.y });
                    } else {
                        target.set({ x2: localPoint.x, y2: localPoint.y });
                    }

                    // Forzar actualizaciÃ³n de coordenadas antes de actualizar la etiqueta
                    target.setCoords();

                    // Usar requestAnimationFrame para renderizado suave sin trazos impresos
                    if (renderAnimationFrame) {
                        cancelAnimationFrame(renderAnimationFrame);
                    }
                    renderAnimationFrame = requestAnimationFrame(() => {
                        // Actualizar la etiqueta de mediciÃ³n inmediatamente
                        updateMeasureLabel(target);
                        // Renderizado suave usando requestRenderAll en lugar de renderAll
                        canvas.requestRenderAll();
                        renderAnimationFrame = null;
                    });

                    return true;
                };
            }

            // Crear controles con Ã¡rea de detecciÃ³n mÃ¡s precisa
            const controlSize = 20; // TamaÃ±o del Ã¡rea de detecciÃ³n del control (mÃ¡s grande para facilitar el clic)

            // FunciÃ³n para verificar si el clic fue sobre un control
            function isControlClick(opt) {
                if (!opt.target || !opt.target.isMeasureLine) return false;
                if (!opt.control) return false;
                return opt.control === 'p1' || opt.control === 'p2';
            }

            line.controls = {
                p1: new fabric.Control({
                    positionHandler: linePositionHandler('p1'),
                    actionHandler: lineActionHandler('p1'),
                    cursorStyle: 'crosshair',
                    render: renderCircleControl,
                    sizeX: controlSize,
                    sizeY: controlSize,
                    // Asegurar que el control solo se active cuando se hace clic directamente sobre Ã©l
                    mouseUpHandler: function (e, transformData, x, y) {
                        isDraggingControl = false;
                        controlDragStart = null;
                        return true;
                    }
                }),
                p2: new fabric.Control({
                    positionHandler: linePositionHandler('p2'),
                    actionHandler: lineActionHandler('p2'),
                    cursorStyle: 'crosshair',
                    render: renderCircleControl,
                    sizeX: controlSize,
                    sizeY: controlSize,
                    mouseUpHandler: function (e, transformData, x, y) {
                        isDraggingControl = false;
                        controlDragStart = null;
                        return true;
                    }
                })
            };
        }

        function renderCircleControl(ctx, left, top, styleOverride, fabricObject) {
            ctx.save(); ctx.translate(left, top); ctx.beginPath();
            ctx.arc(0, 0, 8, 0, Math.PI * 2, false);
            ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#22c55e"; ctx.lineWidth = 2;
            ctx.fill(); ctx.stroke(); ctx.restore();
        }

        // --- LOCK HELPERS ---
        function lockObject(obj) {
            if (!obj) return;
            obj.set({
                lockMovementX: obj.isMeasureLine ? false : true,
                lockMovementY: obj.isMeasureLine ? false : true,
                lockRotation: true, lockScalingX: true, lockScalingY: true,
                borderColor: '#22c55e', cornerColor: 'transparent', hasBorders: false, hasControls: true
            });
            if (obj.isMeasureLine) {
                createLineControls(obj);
                // Asegurar que el objeto puede moverse normalmente cuando no se estÃ¡ manipulando un control
                obj.set({ lockMovementX: false, lockMovementY: false });
            }
        }

        function unlockObject(obj) {
            if (!obj) return;
            obj.set({
                lockMovementX: false, lockMovementY: false, lockRotation: true,
                borderColor: '#ef4444', hasBorders: true, hasControls: false, borderDashArray: [5, 5]
            });
        }

        // --- DELETE FUNCTIONALITY ---
        function deleteSelected() {
            if (!window.takeoffRequireWrite()) return false;
            const takeoffSelectionIds = window.projectTakeoffGetSelectionIds?.() || [];
            if (window.projectTakeoffDeleteCurrentSelection?.()) {
                showToast("Selection deleted", "success");
                return true;
            }
            // A locked Takeoff selection is still authoritative. Do not fall through
            // and accidentally delete an unrelated Fabric annotation.
            if (takeoffSelectionIds.length) return false;
            if (useKonvaRuler && deleteKonvaSelection()) {
                showToast("Selection deleted", "success");
                return true;
            }
            const activeObjects = canvas.getActiveObjects();
            if (!activeObjects.length) return false;

            // MODIFICADO: Eliminado confirm() y agrupado el historial
            historyProcessing = true; // Pausar guardado automÃ¡tico por objeto para agrupar la acciÃ³n

            canvas.discardActiveObject(); // Limpiar selecciÃ³n visual

            activeObjects.forEach(obj => {
                // Limpieza de dependencias (Etiquetas de medidas)
                if (obj.isMeasureLine && obj.label) canvas.remove(obj.label);

                // Limpieza inversa (Si borro etiqueta, buscar y borrar linea)
                if (obj.isMeasureLabel) {
                    const line = canvas.getObjects().find(o => o.labelId === obj.id);
                    if (line) canvas.remove(line);
                }
                canvas.remove(obj);
            });

            historyProcessing = false; // Reactivar historial
            saveHistory(); // Guardar el estado UNA vez con todos los objetos borrados
            showToast("Selection deleted", "success");
            return true;
        }
        window.projectTakeoffDeleteSelectedAnnotation = deleteSelected;

        // --- PINCH ZOOM & PAN (GESTOS TÃCTILES MEJORADOS) ---
        const canvasWrapper = document.querySelector('.upper-canvas');
        let lastDist = 0;
        let lastClientX = 0;
        let lastClientY = 0;

        if (canvasWrapper) {
            canvasWrapper.addEventListener('touchstart', function (e) {
                if (e.touches.length === 2) {
                    // Calcular distancia inicial
                    const dx = e.touches[0].clientX - e.touches[1].clientX;
                    const dy = e.touches[0].clientY - e.touches[1].clientY;
                    lastDist = Math.sqrt(dx * dx + dy * dy);

                    // Calcular centro inicial para el Pan
                    lastClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    lastClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

                    e.preventDefault();
                }
            }, { passive: false });

            canvasWrapper.addEventListener('touchmove', function (e) {
                if (e.touches.length === 2) {
                    e.preventDefault();

                    // 1. CALCULAR ZOOM (Escala)
                    const dx = e.touches[0].clientX - e.touches[1].clientX;
                    const dy = e.touches[0].clientY - e.touches[1].clientY;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    // 2. CALCULAR PAN (Movimiento)
                    const currentClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    const currentClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

                    const deltaX = currentClientX - lastClientX;
                    const deltaY = currentClientY - lastClientY;

                    // Aplicar Pan (Mover el canvas)
                    const vpt = canvas.viewportTransform;
                    vpt[4] += deltaX;
                    vpt[5] += deltaY;
                    clampViewportTransform(vpt);

                    // Aplicar Zoom
                    if (lastDist > 0) {
                        const scale = dist / lastDist;
                        let newZoom = canvas.getZoom() * scale;
                        const minZoom = Math.min(0.25, pdfFitZoom ? pdfFitZoom * 0.5 : 0.25);
                        if (newZoom > 4.0) newZoom = 4.0; if (newZoom < minZoom) newZoom = minZoom;

                        // Zoom hacia el punto central de los dedos
                        const point = new fabric.Point(currentClientX, currentClientY);
                        canvas.zoomToPoint(point, newZoom);
                        clampViewportTransform(canvas.viewportTransform);
                        canvas.setViewportTransform(canvas.viewportTransform);
                        notifyTakeoffZoomChanged('pinch');
                        updateTextScales(newZoom);
                        if (useKonvaRuler) syncKonvaToFabric();
                        schedulePdfRerender();
                    }

                    // Actualizar referencias para el siguiente frame
                    lastDist = dist;
                    lastClientX = currentClientX;
                    lastClientY = currentClientY;

                    canvas.requestRenderAll();
                }
            }, { passive: false });
        }

        canvas.on('mouse:up', function (opt) {
            this.setViewportTransform(this.viewportTransform);
            this.isDragging = false;
            if (currentMode === 'smart') this.selection = true;
            if (this.isDrawingModeWasOn) { canvas.isDrawingMode = true; this.isDrawingModeWasOn = false; }

            // MODIFICADO: Refuerzo contra falsos positivos (lÃ­neas cortas/basura)
            if (lineState === 1 && activeLine) {
                const ptr = canvas.getPointer(opt.e);
                const dist = Math.sqrt(Math.pow(ptr.x - startPoint.x, 2) + Math.pow(ptr.y - startPoint.y, 2));

                if (dist > 10) {
                    finishLineLogic();
                } else {
                    // BUG FIX: Si la distancia es muy corta (misclick), limpiar el objeto temporal
                    canvas.remove(activeLine);
                    activeLine = null;
                    lineState = 0;
                    canvas.requestRenderAll();
                }
            }
            canvas.setCursor('default');
        });

        // --- LOAD LOGIC ---
        let pdfLoadingTask = null;

        function loadPdfDocument(forceFullDownload = false) {
            if (fileExt !== 'pdf') return;
            showDrawingLoading(true);
            if (pdfLoadingTask?.destroy) {
                try { pdfLoadingTask.destroy(); } catch (e) { }
            }
            pdfLoadingTask = pdfjsLib.getDocument({
                url: fileUrl,
                rangeChunkSize: 262144,
                disableRange: forceFullDownload,
                disableStream: forceFullDownload,
                disableAutoFetch: !forceFullDownload,
                // Broken TrueType hint programs (for example an undefined FDEF 21)
                // are recoverable in PDF.js. Keep them from flooding production
                // consoles while real document load/render errors remain visible.
                verbosity: pdfjsLib.VerbosityLevel?.ERRORS ?? 0
            });
            pdfLoadingTask.promise.then(pdf => {
                pdfDoc = pdf;
                pageNum = Math.max(1, Math.min(pdf.numPages, Number(pageNum) || 1));
                if (typeof window.setTakeoffPage === 'function') window.setTakeoffPage(pageNum);
                if (useKonvaRuler) setKonvaPage(pageNum);
                document.getElementById('p-total').textContent = pdf.numPages;
                renderPageList(pdf.numPages);
                activePageSwitch = {
                    page: pageNum,
                    startedAt: typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
                };
                notifyTakeoffReady();
                renderPage(pageNum);
            }).catch(error => {
                console.error('PDF load failed', { forceFullDownload, fileUrl, error });
                if (!forceFullDownload) {
                    // Some servers/proxies advertise byte ranges but fail while PDF.js
                    // requests later chunks. A full download is slower but reliable.
                    loadPdfDocument(true);
                    return;
                }
                showDrawingError('Unable to load this sheet');
                showToast("Error loading PDF", "error");
            });
        }

        function retryPdfLoad() {
            pdfDoc = null;
            loadPdfDocument(true);
        }

        if (fileExt === 'pdf') {
            loadPdfDocument(false);
        } else if (fileExt === 'heic') {
            document.getElementById('p-total').textContent = '1'; renderPageList(1);
            notifyTakeoffReady();
            fetch(fileUrl).then(res => res.blob()).then(blob => heic2any({ blob, toType: "image/jpeg" })).then(conversionResult => {
                const blob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
                const url = URL.createObjectURL(blob);
                fabric.Image.fromURL(url, img => { setBg(img); loadPageAnnotations(1); });
            }).catch(e => { console.error(e); showToast("Error loading HEIC", "error"); });
        } else {
            document.getElementById('p-total').textContent = '1'; renderPageList(1);
            notifyTakeoffReady();
            fabric.Image.fromURL(fileUrl, img => {
                if (!img) { showToast("Error loading image", "error"); return; }
                setBg(img); loadPageAnnotations(1);
            });
        }

        function renderPageList(total) {
            const container = document.getElementById('page-list-container'); container.innerHTML = '';
            for (let i = 1; i <= total; i++) {
                const div = document.createElement('div'); div.className = `page-item ${i === pageNum ? 'active' : ''}`;
                div.innerHTML = `<span>Page ${i}</span> <i class="fas fa-chevron-right small opacity-50"></i>`;
                div.onclick = () => jumpToPage(i); div.id = `plist-${i}`; container.appendChild(div);
            }
        }

        function updatePageListUI(curr) {
            document.querySelectorAll('.page-item').forEach(el => el.classList.remove('active'));
            const activeEl = document.getElementById(`plist-${curr}`);
            if (activeEl) activeEl.classList.add('active');
            document.getElementById('p-curr').innerText = curr;
        }

        function showDrawingLoading(show) {
            if (!drawingLoading) return;
            if (show) {
                drawingLoading.innerHTML = '<div class="drawing-loading-pill"><i class="fas fa-circle-notch fa-spin"></i><span>Loading drawing...</span></div>';
            }
            drawingLoading.classList.toggle('hidden', !show);
        }

        function showDrawingError(message = 'Unable to load this sheet') {
            if (!drawingLoading) return;
            drawingLoading.innerHTML = `<div class="drawing-loading-pill" style="border-color: #ef4444; color: #ef4444;">
            <i class="fas fa-triangle-exclamation"></i>
            <span>${message}</span>
            <button type="button" class="btn btn-sm btn-outline-danger ms-2 py-0 px-2" style="font-size: 11px; border-radius: 9999px;" onclick="retryPdfLoad()">Retry</button>
        </div>`;
            drawingLoading.classList.remove('hidden');
        }

        function getCanvasWrapper() {
            return document.getElementById('canvas-wrapper');
        }

        function wrapperHasSize() {
            const w = getCanvasWrapper();
            return !!(w && w.clientWidth > 0 && w.clientHeight > 0);
        }

        function waitForWrapperSize() {
            if (wrapperHasSize()) {
                resize();
                return Promise.resolve(true);
            }
            if (wrapperSizePromise) return wrapperSizePromise;
            wrapperSizePromise = new Promise(resolve => {
                const started = performance.now();
                const tick = () => {
                    if (wrapperHasSize()) {
                        resize();
                        wrapperSizePromise = null;
                        resolve(true);
                        return;
                    }
                    if (document.hidden || performance.now() - started >= 3000) {
                        wrapperSizePromise = null;
                        resolve(false);
                        return;
                    }
                    requestAnimationFrame(tick);
                };
                tick();
            });
            return wrapperSizePromise;
        }

        function fitPdfToView(force = false, options = {}) {
            if (!pdfWorldWidth || !pdfWorldHeight || !wrapperHasSize()) return;
            const w = getCanvasWrapper();
            const availableW = Math.max(120, w.clientWidth - PDF_PADDING * 2);
            const availableH = Math.max(120, w.clientHeight - PDF_PADDING * 2);
            const nextFit = Math.min(availableW / pdfWorldWidth, availableH / pdfWorldHeight);
            if (!isFinite(nextFit) || nextFit <= 0) return;
            pdfFitZoom = nextFit;
            if (options && options.preserveViewport) {
                return;
            }
            if (force || Math.abs(canvas.getZoom() - nextFit) < 0.02 || canvas.getZoom() === 1) {
                centerPdfAtZoom(nextFit);
                hasInitialPdfFit = true;
            }
        }

        function centerPdfAtZoom(zoom) {
            const w = getCanvasWrapper();
            if (!w || !pdfWorldWidth || !pdfWorldHeight) return;
            const left = Math.max(PDF_PADDING, (w.clientWidth - pdfWorldWidth * zoom) / 2);
            const top = Math.max(PDF_PADDING, (w.clientHeight - pdfWorldHeight * zoom) / 2);
            canvas.setViewportTransform([zoom, 0, 0, zoom, left, top]);
            notifyTakeoffZoomChanged('fit');
            if (useKonvaRuler) syncKonvaToFabric();
            updateTextScales(zoom);
            canvas.requestRenderAll();
        }

        function pdfRenderScaleForViewport(baseViewport) {
            const largestSide = Math.max(baseViewport?.width || 1, baseViewport?.height || 1);
            return Math.min(MAX_PDF_RENDER_SCALE, Math.max(0.5, PAGE_SWITCH_MAX_DIMENSION / largestSide));
        }

        function pdfBitmapCacheKey(num, renderScale) {
            return `${num}@${Number(renderScale || 1).toFixed(3)}`;
        }

        function touchPdfBitmapCache(key, bitmap) {
            if (pdfBitmapCache.has(key)) pdfBitmapCache.delete(key);
            pdfBitmapCache.set(key, bitmap);
            while (pdfBitmapCache.size > PDF_BITMAP_CACHE_LIMIT) {
                const firstKey = pdfBitmapCache.keys().next().value;
                const old = pdfBitmapCache.get(firstKey);
                pdfBitmapCache.delete(firstKey);
                if (old?.url) URL.revokeObjectURL(old.url);
                if (old?.canvas && old.canvas !== canvas.backgroundImage?.getElement?.()) {
                    old.canvas.width = 0;
                    old.canvas.height = 0;
                }
            }
        }

        function cancelActivePdfRender() {
            if (activePdfRenderTask && typeof activePdfRenderTask.cancel === 'function') {
                try { activePdfRenderTask.cancel(); } catch (e) { }
            }
            activePdfRenderTask = null;
        }



        async function renderPageToBitmap(num, renderScale, token, page, baseViewport) {
            const cacheKey = pdfBitmapCacheKey(num, renderScale);
            const cached = pdfBitmapCache.get(cacheKey);
            if (cached) {
                touchPdfBitmapCache(cacheKey, cached);
                return cached;
            }
            if (token !== renderToken) return null;
            pdfWorldWidth = baseViewport.width;
            pdfWorldHeight = baseViewport.height;

            const viewport = page.getViewport({ scale: renderScale });
            const renderCanvas = document.createElement('canvas');
            const renderCtx = renderCanvas.getContext('2d', { alpha: false });

            renderCanvas.width = Math.max(1, Math.round(viewport.width));
            renderCanvas.height = Math.max(1, Math.round(viewport.height));
            renderCtx.fillStyle = '#ffffff';
            renderCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
            cancelActivePdfRender();
            const renderTask = page.render({ canvasContext: renderCtx, viewport });
            activePdfRenderTask = renderTask;
            try {
                await renderTask.promise;
            } finally {
                if (activePdfRenderTask === renderTask) activePdfRenderTask = null;
            }
            if (token !== renderToken) return null;

            const bitmap = {
                canvas: renderCanvas,
                bitmapWidth: renderCanvas.width,
                bitmapHeight: renderCanvas.height,
                worldWidth: baseViewport.width,
                worldHeight: baseViewport.height,
                renderScale,
                requestedZoom: Number(canvas.getZoom()) || 1
            };
            if (bitmap) touchPdfBitmapCache(cacheKey, bitmap);
            return bitmap;
        }

        function pageSwitchPercentile(percentile) {
            if (!pageSwitchLatencySamples.length) return 0;
            const sorted = [...pageSwitchLatencySamples].sort((a, b) => a - b);
            return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1))];
        }

        function notifyPageSwitchRendered(renderedPage, token) {
            if (!activePageSwitch || activePageSwitch.page !== renderedPage || token !== renderToken) return;
            const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            const durationMs = Math.max(0, now - activePageSwitch.startedAt);
            pageSwitchLatencySamples.push(durationMs);
            if (pageSwitchLatencySamples.length > 30) pageSwitchLatencySamples.shift();
            const metrics = {
                page: renderedPage,
                durationMs: Math.round(durationMs),
                p50: Math.round(pageSwitchPercentile(0.5)),
                p95: Math.round(pageSwitchPercentile(0.95)),
                p99: Math.round(pageSwitchPercentile(0.99)),
                sampleCount: pageSwitchLatencySamples.length
            };
            window.__takeoffPageSwitchMetrics = metrics;
            activePageSwitch = null;
            try { window.parent?.postMessage({ type: 'takeoff-page-rendered', fileId, ...metrics }, '*'); } catch (_) { }
        }

        function applyPdfBackground(bitmap, token, loadAnnotations) {
            const commit = img => {
                if (token !== renderToken) return;
                setBg(img, bitmap.worldWidth, bitmap.worldHeight);
                currentPdfRenderZoom = bitmap.requestedZoom;
                currentPdfRenderScale = bitmap.renderScale;
                showDrawingLoading(false);
                if (typeof window.setTakeoffPage === 'function') window.setTakeoffPage(pageNum);
                if (typeof window.syncKonvaToFabric === 'function') window.syncKonvaToFabric();
                if (loadAnnotations) loadPageAnnotations(pageNum);
                notifyPageSwitchRendered(pageNum, token);
            };
            if (bitmap.canvas) {
                commit(new fabric.Image(bitmap.canvas));
                return;
            }
            fabric.Image.fromURL(bitmap.url, commit);
        }

        let isRenderingPage = false;
        let pendingRenderRequest = null;
        async function renderPage(num, loadAnnotations = true) {
            if (isRenderingPage) {
                pendingRenderRequest = {
                    num: Math.max(1, Number(num) || 1),
                    loadAnnotations: Boolean(loadAnnotations)
                };
                // Page navigation is latest-wins: abort the old raster immediately
                // instead of making the newly selected sheet wait behind it.
                renderToken++;
                cancelActivePdfRender();
                return;
            }
            isRenderingPage = true;
            updatePageListUI(num);
            if (!pdfDoc) {
                isRenderingPage = false;
                return;
            }
            const isBackgroundRefresh = !loadAnnotations && !!canvas.backgroundImage;
            if (!isBackgroundRefresh) showDrawingLoading(true);
            try {
                await waitForWrapperSize();
                renderToken++;
                const token = renderToken;
                cancelActivePdfRender();
                const page = await pdfDoc.getPage(num);
                if (token !== renderToken) return;
                const baseViewport = page.getViewport({ scale: 1 });
                pdfWorldWidth = baseViewport.width;
                pdfWorldHeight = baseViewport.height;
                fitPdfToView(loadAnnotations);
                const renderScale = pdfRenderScaleForViewport(baseViewport);
                const bitmap = await renderPageToBitmap(num, renderScale, token, page, baseViewport);
                if (token !== renderToken) return;
                if (!bitmap) throw new Error('PDF bitmap generation failed');
                applyPdfBackground(bitmap, token, loadAnnotations);
            } catch (error) {
                if (error?.name === 'RenderingCancelledException') return;
                console.error(error);
                if (isBackgroundRefresh) return;
                showDrawingError('Unable to load this sheet');
                showToast("Error rendering PDF page", "error");
            } finally {
                isRenderingPage = false;
                if (pendingRenderRequest) {
                    const nextReq = pendingRenderRequest;
                    pendingRenderRequest = null;
                    renderPage(nextReq.num, nextReq.loadAnnotations);
                }
            }
        }

        function schedulePdfRerender() {
            // Disabled: PDF is rendered once at fixed optimal resolution (150%).
            // Canvas zooms via GPU hardware acceleration without CPU rasterization overhead.
            return;
        }

        function setBg(img, worldWidth = img.width, worldHeight = img.height) {
            currentPdfBgImage = img;
            img.excludeFromHistory = true;
            img.excludeFromExport = true;
            img.set({
                originX: 'left',
                originY: 'top',
                left: 0,
                top: 0,
                scaleX: worldWidth / img.width,
                scaleY: worldHeight / img.height,
                selectable: false,
                evented: false,
                imageSmoothing: true
            });
            if (canvas.contextContainer) {
                canvas.contextContainer.imageSmoothingEnabled = true;
                canvas.contextContainer.imageSmoothingQuality = 'high';
            }
            if (canvas.contextTop) {
                canvas.contextTop.imageSmoothingEnabled = true;
                canvas.contextTop.imageSmoothingQuality = 'high';
            }
            canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
            showDrawingLoading(false);
        }

        function jumpToPage(targetPage) {
            const nextPage = Math.max(1, Number(targetPage) || 1);
            if (nextPage === pageNum && canvas.backgroundImage && !isRenderingPage) return;
            const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            activePageSwitch = { page: nextPage, startedAt };
            saveCurrentPageAnnotations();
            currentPdfBgImage = null;
            pendingRenderRequest = null;
            renderToken++;
            cancelActivePdfRender();
            canvas.clear(); undoStack = []; historyIndex = -1;
            pageNum = nextPage;
            loadCalibrationForPage(false);
            if (typeof window.setTakeoffPage === 'function') window.setTakeoffPage(pageNum);
            if (useKonvaRuler) setKonvaPage(pageNum);
            if (pdfDoc) renderPage(pageNum); else loadPageAnnotations(pageNum);

            // AUTO-HIDE SIDEBAR ON PAGE SELECT (Universal)
            const sb = document.getElementById('sidebarLeft');
            if (sb.classList.contains('show')) {
                toggleSheets();
            }
        }

        function changePage(offset) {
            let max = pdfDoc ? pdfDoc.numPages : 1;
            const newPage = pageNum + offset;
            if (newPage < 1 || newPage > max) return;
            jumpToPage(newPage);
        }

        function notifyTakeoffReady() {
            try {
                window.parent?.postMessage({
                    type: 'takeoff-editor-ready',
                    fileId,
                    pageCount: pdfDoc ? pdfDoc.numPages : 1,
                    pageNum
                }, '*');
            } catch (e) { }
        }

        const thumbnailCache = new Map();
        const THUMBNAIL_CACHE_LIMIT = 24;
        const THUMBNAIL_MAX_DIMENSION = 800;
        let activeThumbnailRenderTask = null;
        let thumbnailRequestSequence = 0;

        function touchThumbnailCache(key, dataUrl) {
            if (thumbnailCache.has(key)) thumbnailCache.delete(key);
            thumbnailCache.set(key, dataUrl);
            while (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
                thumbnailCache.delete(thumbnailCache.keys().next().value);
            }
        }

        function takeoffCancelThumbnailRender() {
            ++thumbnailRequestSequence;
            if (activeThumbnailRenderTask && typeof activeThumbnailRenderTask.cancel === 'function') {
                try { activeThumbnailRenderTask.cancel(); } catch (_) { }
            }
            activeThumbnailRenderTask = null;
        }

        async function takeoffRenderThumbnail(targetPage = pageNum, requestedMaxDimension = THUMBNAIL_MAX_DIMENSION) {
            if (!pdfDoc) return null;
            const pg = Math.max(1, Math.min(pdfDoc.numPages, Number(targetPage) || 1));
            const maxDimension = Math.min(THUMBNAIL_MAX_DIMENSION, Math.max(160, Number(requestedMaxDimension) || THUMBNAIL_MAX_DIMENSION));
            const key = `white-v3:${pg}:${maxDimension}`;
            if (thumbnailCache.has(key)) {
                const cached = thumbnailCache.get(key);
                thumbnailCache.delete(key);
                thumbnailCache.set(key, cached);
                return cached;
            }
            takeoffCancelThumbnailRender();
            const requestId = thumbnailRequestSequence;
            const page = await pdfDoc.getPage(pg);
            if (requestId !== thumbnailRequestSequence) {
                try { page.cleanup(); } catch (_) { }
                return null;
            }
            const unscaled = page.getViewport({ scale: 1 });
            const largestSide = Math.max(unscaled.width || 1, unscaled.height || 1);
            const viewport = page.getViewport({ scale: Math.min(1, maxDimension / largestSide) });
            const thumbCanvas = document.createElement('canvas');
            const ctx = thumbCanvas.getContext('2d', { alpha: false });
            thumbCanvas.width = Math.max(1, Math.floor(viewport.width));
            thumbCanvas.height = Math.max(1, Math.floor(viewport.height));
            ctx.save();
            ctx.globalCompositeOperation = 'copy';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
            ctx.restore();
            const renderTask = page.render({ canvasContext: ctx, viewport, background: '#ffffff' });
            activeThumbnailRenderTask = renderTask;
            try {
                await renderTask.promise;
            } finally {
                if (activeThumbnailRenderTask === renderTask) activeThumbnailRenderTask = null;
                try { page.cleanup(); } catch (_) { }
            }
            if (requestId !== thumbnailRequestSequence) return null;
            const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.86);
            thumbCanvas.width = 0;
            thumbCanvas.height = 0;
            touchThumbnailCache(key, dataUrl);
            return dataUrl;
        }

        function takeoffGetDocumentInfo() {
            return {
                fileId,
                pageCount: pdfDoc ? pdfDoc.numPages : 1,
                pageNum,
                fileUrl,
                fileExt
            };
        }

        function takeoffJumpToPage(targetPage) {
            const requested = Math.max(1, Number(targetPage) || 1);
            if (!pdfDoc) {
                pageNum = requested;
                return takeoffGetDocumentInfo();
            }
            const pg = Math.max(1, Math.min(pdfDoc.numPages, requested));
            jumpToPage(pg);
            notifyTakeoffReady();
            return takeoffGetDocumentInfo();
        }

        window.takeoffGetDocumentInfo = takeoffGetDocumentInfo;
        window.takeoffJumpToPage = takeoffJumpToPage;
        window.takeoffRenderThumbnail = takeoffRenderThumbnail;
        window.takeoffCancelThumbnailRender = takeoffCancelThumbnailRender;

        function loadPageAnnotations(pg) {
            historyProcessing = true;
            const state = getSavedPageState(pg);
            const bgToKeep = canvas.backgroundImage || currentPdfBgImage;
            if (state.fabric) {
                canvas.loadFromJSON(state.fabric, function () {
                    if (bgToKeep) {
                        canvas.backgroundImage = bgToKeep;
                    }
                    const objects = canvas.getObjects();
                    objects.forEach(obj => {
                        if (obj.isMeasureLine) {
                            lockObject(obj);
                            if (obj.labelId) {
                                const lbl = objects.find(o => o.isMeasureLabel && o.id === obj.labelId);
                                if (lbl) { obj.label = lbl; lbl.selectable = false; lbl.evented = false; }
                            }
                        } else if (!obj.isMeasureLabel) {
                            obj.set({ lockMovementX: true, lockMovementY: true, borderColor: '#22c55e' });
                        }
                    });
                    if (useKonvaRuler) loadKonvaForPage(pg, state.konva);
                    updateTextScales(canvas.getZoom());
                    canvas.requestRenderAll();
                    refreshMeasureLabels();
                    historyProcessing = false;
                    saveHistory();
                });
            } else {
                if (bgToKeep && !canvas.backgroundImage) {
                    canvas.backgroundImage = bgToKeep;
                    canvas.requestRenderAll();
                }
                if (useKonvaRuler) loadKonvaForPage(pg, state.konva);
                historyProcessing = false;
                saveHistory();
            }
        }

        // --- HISTORY ---
        function saveHistory() {
            if (!window.takeoffCanWrite()) return false;
            if (historyProcessing) return;
            if (historyIndex < undoStack.length - 1) { undoStack = undoStack.slice(0, historyIndex + 1); }
            const json = JSON.stringify(canvas.toJSON(['isMeasureLine', 'isMeasureLabel', 'labelId', 'id']));
            undoStack.push(json);
            historyIndex++;
            if (undoStack.length > MAX_HISTORY) { undoStack.shift(); historyIndex--; }
            updateHistoryButtons();
        }

        function undo() {
            if (historyIndex > 0) {
                historyProcessing = true; historyIndex--;
                const state = undoStack[historyIndex];
                canvas.loadFromJSON(state, () => {
                    reLinkObjects(); historyProcessing = false; updateTextScales(canvas.getZoom()); updateHistoryButtons();
                });
                return true;
            }
            return false;
        }

        function redo() {
            if (historyIndex < undoStack.length - 1) {
                historyProcessing = true; historyIndex++;
                const state = undoStack[historyIndex];
                canvas.loadFromJSON(state, () => {
                    reLinkObjects(); historyProcessing = false; updateTextScales(canvas.getZoom()); updateHistoryButtons();
                });
                return true;
            }
            return false;
        }
        window.undo = undo;
        window.redo = redo;

        function updateHistoryButtons() {
            const btnUndo = document.getElementById('btn-undo');
            const btnRedo = document.getElementById('btn-redo');
            if (historyIndex > 0) btnUndo.classList.remove('btn-disabled'); else btnUndo.classList.add('btn-disabled');
            if (historyIndex < undoStack.length - 1) btnRedo.classList.remove('btn-disabled'); else btnRedo.classList.add('btn-disabled');
        }

        function reLinkObjects() {
            const objects = canvas.getObjects();
            objects.forEach(obj => {
                if (obj.isMeasureLine) {
                    lockObject(obj);
                    if (obj.labelId) {
                        const lbl = objects.find(o => o.isMeasureLabel && o.id === obj.labelId);
                        if (lbl) { obj.label = lbl; lbl.selectable = false; lbl.evented = false; }
                    }
                }
            });
            canvas.requestRenderAll();
        }

        // --- EVENTS ---
        canvas.on('object:added', e => { if (!e.target.excludeFromHistory) saveHistory(); });
        canvas.on('object:modified', saveHistory);
        canvas.on('object:removed', e => {
            if (e.target.isMeasureLine && e.target.label) canvas.remove(e.target.label);
            saveHistory();
        });

        // Auto-remove empty text on creation
        canvas.on('text:editing:exited', function (e) {
            const obj = e.target;
            if (obj && obj.isNew) {
                if ((obj.text || '').trim() === '') {
                    canvas.remove(obj);
                    canvas.requestRenderAll();
                    showToast("Empty note discarded", "warning");
                } else {
                    delete obj.isNew;
                }
            }
        });

        function updateMeasureLabel(line) {
            if (!line || !line.label) return;
            const points = line.calcLinePoints();
            const matrix = line.calcTransformMatrix();
            const p1 = fabric.util.transformPoint(new fabric.Point(points.x1, points.y1), matrix);
            const p2 = fabric.util.transformPoint(new fabric.Point(points.x2, points.y2), matrix);
            const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            let textVal = "";
            if (pixelsPerFoot > 0) {
                const feet = distPx / pixelsPerFoot;
                textVal = formatFeetForDisplay(feet);
            } else {
                textVal = Math.round(distPx) + " px";
            }
            line.label.set({ text: textVal });
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            line.label.set({ left: midX, top: midY - 15 });
            line.setCoords();
            line.label.setCoords();
            // NO llamar requestRenderAll aquÃ­ - se maneja en los eventos con requestAnimationFrame
        }

        canvas.on('object:moving', function (e) {
            const obj = e.target;
            if (obj.isMeasureLine && obj.label) {
                // Cuando se mueve el objeto completo, solo actualizar posiciÃ³n de la etiqueta
                // No actualizar el valor porque la distancia no cambia
                const center = obj.getCenterPoint();
                obj.label.set({ left: center.x, top: center.y - 15 });
                obj.label.setCoords();
                // Renderizado suave durante el movimiento
                if (renderAnimationFrame) cancelAnimationFrame(renderAnimationFrame);
                renderAnimationFrame = requestAnimationFrame(() => {
                    canvas.requestRenderAll();
                    renderAnimationFrame = null;
                });
            }
        });

        // --- TOOL SWITCHING ---
        function setMode(mode) {
            if (mode === 'freehand') mode = 'draw';
            if (calLineObject && mode !== 'cal') clearCalLine();

            discardEmptyActiveKonvaNote();

            // FIX: Check for new note before switching tool
            const activeObj = canvas.getActiveObject();
            if (activeObj && activeObj.isNew && (activeObj.type === 'i-text' || activeObj.type === 'text' || activeObj.type === 'textbox')) {
                canvas.remove(activeObj);
                canvas.requestRenderAll();
                showToast("Empty note discarded", "warning");
            }

            if (pendingPlacementTool && mode !== 'smart') clearPlacementTool();
            resetToolState();
            currentMode = mode;
            window.currentMode = mode;
            if (['measure', 'cal', 'draw'].includes(mode)) {
                if (typeof window.projectTakeoffClearActiveLayer === 'function') {
                    window.projectTakeoffClearActiveLayer();
                    currentMode = mode;
                    window.currentMode = mode;
                }
                window.clearTakeoffSelection?.();
                try {
                    window.parent?.postMessage({ type: 'project-takeoff-clear-active-layer' }, '*');
                } catch (err) { }
            }
            canvas.discardActiveObject(); canvas.requestRenderAll();
            canvas.isDrawingMode = (mode === 'draw');
            canvas.selection = (mode === 'smart');
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            if (mode !== 'smart') {
                const btn = document.getElementById('btn-' + mode);
                if (btn) btn.classList.add('active');
            } else { document.getElementById('btn-smart').classList.add('active'); }
            document.querySelectorAll('.prop-section').forEach(p => p.classList.remove('active'));
            const propEl = document.getElementById('prop-' + mode);
            if (propEl) propEl.classList.add('active');
            document.getElementById('stamp-menu').style.display = 'none';

            // CURSOR LOGIC SIMPLIFIED (No 'pan' mode check needed for cursor style here)
            if (mode === 'draw') {
                canvas.freeDrawingBrush.color = '#ef4444';
                canvas.freeDrawingBrush.width = 3;
                canvas.defaultCursor = 'crosshair';
                if (konvaStage?.container()) konvaStage.container().style.cursor = 'crosshair';
            } else if (mode === 'measure') {
                canvas.defaultCursor = 'crosshair';
                if (konvaStage?.container()) konvaStage.container().style.cursor = 'crosshair';
            } else if (mode === 'cal') {
                updateCalHint();
                if (window.innerWidth <= 991) {
                    openMobileCalModal();
                }
            } else {
                canvas.defaultCursor = 'default';
                if (konvaStage?.container() && !pendingPlacementTool) konvaStage.container().style.cursor = 'default';
            }

            if (useKonvaRuler) {
                if (mode === 'measure' || mode === 'smart') {
                    initKonvaRuler();
                    setKonvaActive(true);
                } else {
                    setKonvaActive(false);
                }
                updateKonvaInteractivity();
            }

            if (mode === 'smart') {
                const active = canvas.getActiveObject();
                if (active && (active.type === 'i-text' || active.type === 'text' || active.type === 'textbox')) showPropSection('text');
            }

            // Auto-close tools on mobile after selecting a tool (Optional UX improvement)
            if (window.innerWidth <= 991 && mode !== 'stamp') {
                // setTimeout(toggleMobileTools, 300); // Uncomment if you prefer auto-close
            }
        }

        function finalizeKonvaRulerDrawing(ruler) {
            if (!ruler) return false;
            ruler.group?.listening(true);
            ruler.line?.listening(true);
            ruler.a1?.listening(true);
            ruler.a2?.listening(true);
            ruler.a1?.visible(true);
            ruler.a2?.visible(true);
            updateKonvaLabel(ruler);
            ruler.group?.moveToTop();
            ruler.a1?.moveToTop();
            ruler.a2?.moveToTop();
            konvaLayer?.batchDraw();
            if (typeof konvaDrawing !== 'undefined' && konvaDrawing === ruler) {
                konvaDrawing = null;
                konvaRulerAnchor = null;
            }
            ruler.select?.();
            saveCurrentPageAnnotations();
            emitKonvaRulersState();
            return true;
        }

        function resolveMeasurementOnPointer() {
            if (typeof konvaDrawing !== 'undefined' && konvaDrawing) {
                if (Number(konvaDrawing.placedNodes || 1) >= 2) {
                    finalizeKonvaRulerDrawing(konvaDrawing);
                    return 'finished';
                }
                cancelActiveMeasurement();
                return 'cancelled';
            }
            if (activeLine && !calLineObject) {
                canvas.remove(activeLine);
                activeLine = null;
                lineState = 0;
                return 'cancelled';
            }
            return 'none';
        }
        window.resolveMeasurementOnPointer = resolveMeasurementOnPointer;

        function cancelActiveMeasurement() {
            let cancelled = false;
            if (typeof konvaDrawing !== 'undefined' && konvaDrawing) {
                const draft = konvaDrawing;
                konvaDrawing = null;
                konvaRulerAnchor = null;
                if (typeof konvaSelectedNode !== 'undefined' && konvaSelectedNode?.ref === draft) {
                    konvaSelectedNode = null;
                }
                try { draft.group?.destroy?.(); } catch (e) { }
                if (Array.isArray(konvaRulers)) {
                    const idx = konvaRulers.indexOf(draft);
                    if (idx !== -1) konvaRulers.splice(idx, 1);
                }
                const targetPage = Number(draft.page || pageNum || 1);
                if (typeof konvaRulersByPage !== 'undefined' && Array.isArray(konvaRulersByPage[targetPage])) {
                    konvaRulersByPage[targetPage] = konvaRulersByPage[targetPage].filter(r => r !== draft);
                }
                if (typeof konvaLayer !== 'undefined' && konvaLayer) konvaLayer.batchDraw();
                try { emitKonvaRulersState(); } catch (e) { }
                cancelled = true;
            }
            if (activeLine && !calLineObject) {
                canvas.remove(activeLine);
                activeLine = null;
                cancelled = true;
            }
            lineState = 0;
            return cancelled;
        }
        window.cancelActiveMeasurement = cancelActiveMeasurement;

        function resetToolState() {
            resolveMeasurementOnPointer();
            if (currentMode !== 'cal') {
                document.getElementById('cal-actions').style.display = 'none';
                document.getElementById('cal-hint').style.display = 'block';
                document.getElementById('cal-val').value = '';
                resetScalePresetSelection();
                updateCalHint();
            }
        }

        function showPropSection(idPart) {
            document.querySelectorAll('.prop-section').forEach(p => p.classList.remove('active'));
            const el = document.getElementById('prop-' + idPart);
            if (el) el.classList.add('active');
            keepScaleDisplayVisible();
        }

        function toggleStampMenu() {
            const m = document.getElementById('stamp-menu');
            m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
        }

        function addStamp(text, color) {
            if (!window.takeoffRequireWrite()) return false;
            setMode('smart');
            const center = canvas.getVpCenter();
            const rect = new fabric.Rect({ width: 200, height: 80, rx: 10, ry: 10, fill: 'transparent', stroke: color, strokeWidth: 5, originX: 'center', originY: 'center' });
            const lbl = new fabric.Text(text, { fontSize: 40, fill: color, fontWeight: 'bold', fontFamily: 'Arial', originX: 'center', originY: 'center' });
            const group = new fabric.Group([rect, lbl], { left: center.x, top: center.y, opacity: 0.8 });
            lockObject(group);
            canvas.add(group); canvas.setActiveObject(group);
            document.getElementById('stamp-menu').style.display = 'none';
            saveHistory();
        }

        // --- CANVAS INPUTS ---
        canvas.on('mouse:down', function (opt) {
            const evt = opt.e;
            const now = new Date().getTime();

            if (currentMode === 'measure' && useKonvaRuler) {
                return;
            }

            // Verificar si el clic fue sobre un control de una lÃ­nea de medida
            if (opt.target && opt.target.isMeasureLine) {
                const activeControl = opt.control;

                // Verificar si es clic en un control (vértice)
                if (activeControl && (activeControl === 'p1' || activeControl === 'p2')) {
                    if (currentMode === 'measure') {
                        // En modo medida, permitir editar directamente sin doble clic
                        controlEditMode = true;
                        activeControlPoint = activeControl;
                        isDraggingControl = true;
                        controlDragStart = {
                            x: evt.clientX || (evt.touches && evt.touches[0].clientX),
                            y: evt.clientY || (evt.touches && evt.touches[0].clientY)
                        };
                        opt.target.set({ lockMovementX: true, lockMovementY: true });
                        opt.target.isMoving = false;
                        showToast("Edit mode: Drag vertex to resize", "success");
                    } else {
                        const isDoubleClick = (lastTapTarget === opt.target &&
                            lastTapTarget.control === activeControl &&
                            (now - lastTapTime < DOUBLE_TAP_DELAY));

                        if (isDoubleClick) {
                            // Doble clic en vértice - activar modo de edición
                            controlEditMode = true;
                            activeControlPoint = activeControl;
                            isDraggingControl = true;
                            controlDragStart = {
                                x: evt.clientX || (evt.touches && evt.touches[0].clientX),
                                y: evt.clientY || (evt.touches && evt.touches[0].clientY)
                            };
                            // Prevenir que el objeto se mueva cuando arrastramos un control
                            opt.target.set({ lockMovementX: true, lockMovementY: true });
                            opt.target.isMoving = false;
                            showToast("Edit mode: Drag vertex to resize", "success");
                        } else {
                            // Primer clic en control - solo seleccionar, no activar edición
                            controlEditMode = false;
                            activeControlPoint = null;
                            isDraggingControl = false;
                        }
                    }
                } else {
                    // El clic fue sobre el cuerpo de la lÃ­nea, no sobre un control
                    controlEditMode = false;
                    activeControlPoint = null;
                    isDraggingControl = false;
                    controlDragStart = null;
                    opt.target.set({ lockMovementX: false, lockMovementY: false });
                }
            } else {
                // No es una lÃ­nea de medida, resetear estado
                controlEditMode = false;
                activeControlPoint = null;
                isDraggingControl = false;
                controlDragStart = null;
            }

            if (opt.target && currentMode === 'smart') {
                if (lastTapTarget === opt.target && (now - lastTapTime < DOUBLE_TAP_DELAY)) {
                    // Si no es un control de regla, permitir desbloqueo normal
                    if (!opt.target.isMeasureLine || !opt.control) {
                        unlockObject(opt.target);
                        showToast("Movement Unlocked", "warning");
                        canvas.requestRenderAll();
                        opt.target.isMoving = true;
                    }
                } else {
                    if (opt.target.isMeasureLine) {
                        lockObject(opt.target);
                        canvas.requestRenderAll();
                    } else {
                        lockObject(opt.target);
                    }
                }
                lastTapTarget = opt.target;
                lastTapTime = now;
            }
            const isTouch = evt.type.startsWith('touch');
            let clientX, clientY;
            if (isTouch) { clientX = evt.touches[0].clientX; clientY = evt.touches[0].clientY; } else { clientX = evt.clientX; clientY = evt.clientY; }

            if (evt.button === 2 || (currentMode === 'smart' && evt.altKey)) {
                evt.preventDefault(); evt.stopPropagation();
                this.isDragging = true; this.selection = false;
                this.lastPosX = clientX; this.lastPosY = clientY;
                if (canvas.isDrawingMode) { canvas.isDrawingMode = false; this.isDrawingModeWasOn = true; }
                canvas.setCursor('grabbing');
                return;
            }

            if (currentMode === 'cal' || currentMode === 'measure') {
                if (currentMode === 'cal' && calMode === 'preset') { showToast("Switch to Manual to draw a calibration line", "warning"); return; }
                if (currentMode === 'cal' && calLineObject) { showToast("Delete existing line first", "error"); return; }
                const ptr = canvas.getPointer(evt);
                if (lineState === 0) {
                    startPoint = ptr;
                    activeLine = new fabric.Line([ptr.x, ptr.y, ptr.x, ptr.y], {
                        stroke: (currentMode === 'cal' ? '#eab308' : '#22c55e'), strokeWidth: 3,
                        selectable: false, evented: false, excludeFromHistory: true, originX: 'center', originY: 'center'
                    });
                    canvas.add(activeLine); lineState = 1;
                } else finishLineLogic();
                return;
            }
            if (currentMode === 'smart' && (!opt.target || evt.altKey)) {
                this.isDragging = true; this.selection = false;
                this.lastPosX = clientX; this.lastPosY = clientY; canvas.defaultCursor = 'grabbing';
            }
        });

        canvas.on('mouse:move', function (opt) {
            const evt = opt.e;
            const isTouch = evt.type.startsWith('touch');
            if (currentMode === 'measure' && useKonvaRuler) return;
            if (this.isDragging) {
                let clientX, clientY;
                if (isTouch) { evt.preventDefault(); clientX = evt.touches[0].clientX; clientY = evt.touches[0].clientY; }
                else { clientX = evt.clientX; clientY = evt.clientY; }
                const vpt = this.viewportTransform;
                vpt[4] += clientX - this.lastPosX; vpt[5] += clientY - this.lastPosY;
                clampViewportTransform(vpt);
                this.requestRenderAll();
                this.lastPosX = clientX; this.lastPosY = clientY;
                if (useKonvaRuler) syncKonvaToFabric();
            } else if (lineState === 1 && activeLine) {
                const ptr = canvas.getPointer(evt);
                activeLine.set({ x2: ptr.x, y2: ptr.y });
                // Usar requestAnimationFrame para renderizado suave durante el dibujo
                if (renderAnimationFrame) cancelAnimationFrame(renderAnimationFrame);
                renderAnimationFrame = requestAnimationFrame(() => {
                    canvas.requestRenderAll();
                    renderAnimationFrame = null;
                });
            }
        });

        canvas.on('mouse:up', function (opt) {
            this.setViewportTransform(this.viewportTransform);
            this.isDragging = false;
            if (currentMode === 'measure' && useKonvaRuler) return;

            // Resetear el estado de arrastre de control y restaurar movimiento del objeto
            if (isDraggingControl && opt.target && opt.target.isMeasureLine) {
                // Restaurar el movimiento del objeto
                opt.target.set({ lockMovementX: false, lockMovementY: false });
                // Desactivar modo de ediciÃ³n
                controlEditMode = false;
                activeControlPoint = null;
            }

            isDraggingControl = false;
            controlDragStart = null;

            // Cancelar cualquier renderizado pendiente
            if (renderAnimationFrame) {
                cancelAnimationFrame(renderAnimationFrame);
                renderAnimationFrame = null;
            }

            if (currentMode === 'smart') this.selection = true;
            if (this.isDrawingModeWasOn) { canvas.isDrawingMode = true; this.isDrawingModeWasOn = false; }
            if (lineState === 1 && activeLine) {
                const ptr = canvas.getPointer(opt.e);
                const dist = Math.sqrt(Math.pow(ptr.x - startPoint.x, 2) + Math.pow(ptr.y - startPoint.y, 2));
                if (dist > 10) finishLineLogic();
            }
            canvas.setCursor('default');
        });

        function finishLineLogic() {
            if (currentMode === 'measure' && useKonvaRuler) {
                lineState = 0;
                activeLine = null;
                return;
            }
            lineState = 0;
            const dx = activeLine.x2 - activeLine.x1; const dy = activeLine.y2 - activeLine.y1;
            const distPx = Math.sqrt(dx * dx + dy * dy);
            if (currentMode === 'cal') {
                document.getElementById('cal-actions').style.display = 'flex';
                document.getElementById('cal-hint').style.display = 'none';
                document.getElementById('btn-del-cal').style.display = 'inline-block';
                document.getElementById('cal-val').focus();
                canvas.tempDist = distPx; calLineObject = activeLine;
            } else if (currentMode === 'measure') {
                const feet = distPx / pixelsPerFoot;
                const textVal = formatFeetForDisplay(feet);
                const midX = (activeLine.x1 + activeLine.x2) / 2;
                const midY = (activeLine.y1 + activeLine.y2) / 2;
                const uniqueId = Date.now();
                const lbl = new fabric.Text(textVal, { left: midX, top: midY - 15, fontSize: 24, fill: '#22c55e', backgroundColor: '#0f172a', originX: 'center', originY: 'center', selectable: false, evented: false, isMeasureLabel: true, id: uniqueId + '_lbl' });
                const line = new fabric.Line([activeLine.x1, activeLine.y1, activeLine.x2, activeLine.y2], { stroke: '#22c55e', strokeWidth: 4, selectable: true, evented: true, originX: 'center', originY: 'center', isMeasureLine: true, labelId: lbl.id, label: lbl, id: uniqueId + '_line' });
                canvas.remove(activeLine); canvas.add(line); canvas.add(lbl);
                lockObject(line); canvas.setActiveObject(line);
                activeLine = null; saveHistory();
            }
        }

        function clearCalLine() {
            if (!window.takeoffRequireWrite()) return false;
            if (calLineObject) { canvas.remove(calLineObject); calLineObject = null; }
            document.getElementById('cal-actions').style.display = 'none';
            document.getElementById('cal-hint').style.display = 'block';
            document.getElementById('cal-val').value = '';
            resetScalePresetSelection();
            updateCalHint();
            lineState = 0; activeLine = null; canvas.requestRenderAll();
        }

        function finishCal(save, applyAll = false) {
            if (!window.takeoffRequireWrite()) return false;
            if (save) {
                const val = parseFloat(document.getElementById('cal-val').value);
                if (!calLineObject || !(canvas.tempDist > 0)) {
                    showToast("Draw a calibration line on the plan first", "warning");
                    return false;
                }
                if (val > 0) {
                    scaleMutationEpoch += 1;
                    pixelsPerFoot = canvas.tempDist / val;
                    window.pixelsPerFoot = pixelsPerFoot;
                    Promise.resolve(saveCalibrationForPage('Custom', { mode: 'manual', measured_pixels: canvas.tempDist, real_feet: val }, applyAll))
                        .catch(error => showToast(error?.message || 'Scale save failed', 'error'));
                    setScaleDisplay('Custom');
                    showToast(`Calibrated! 1 ft = ${pixelsPerFoot.toFixed(2)} px`, "success");
                    refreshMeasureLabels();
                    try { window.projectTakeoffUpdateScale?.(pageNum, pixelsPerFoot, applyAll); } catch (e) { }
                    clearCalLine();
                } else { showToast("Invalid value", "error"); return false; }
            } else clearCalLine();
            resetToolState(); setMode('smart');
            return true;
        }
        window.finishCal = finishCal;
        window.setCalMode = setCalMode;
        window.clearCalLine = clearCalLine;

        // --- UTILS ---
        function setPenColor(c, el) { canvas.freeDrawingBrush.color = c; document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active')); el.classList.add('active'); }
        function setPenWidth(w) { canvas.freeDrawingBrush.width = parseInt(w); }

        function startPlacementTool(tool) {
            if (calLineObject) clearCalLine();
            if (activeLine) { canvas.remove(activeLine); activeLine = null; }
            discardEmptyActiveKonvaNote();
            canvas.discardActiveObject();
            canvas.requestRenderAll();
            setMode('smart');
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            const btn = document.getElementById('btn-' + (tool === 'note' ? 'text' : tool));
            if (btn) btn.classList.add('active');

            window.projectTakeoffClearActiveLayer?.();
            window.clearTakeoffSelection?.();
            try {
                window.parent?.postMessage({ type: 'project-takeoff-clear-active-layer' }, '*');
            } catch (e) { }
            try { window.projectTakeoffSetTool?.('select'); } catch (e) { }
            try { window.projectTakeoffSetAnnotationPlacement?.(true); } catch (e) { }
            pendingPlacementTool = tool;
            pendingPlacementStart = null;
            if (pendingPlacementPreview) {
                pendingPlacementPreview.destroy();
                pendingPlacementPreview = null;
            }
            konvaPanMode = false;
            konvaTemporaryPan = false;
            if (!useKonvaRuler) return;
            initKonvaRuler();
            setKonvaActive(true);
            updateKonvaInteractivity();
            if (konvaStage && konvaStage.container()) konvaStage.container().style.cursor = 'crosshair';
            showToast(tool === 'note' ? 'Click on the drawing to place a note' : (tool === 'pin' ? 'Click on the drawing to place a reference pin' : 'Click on the drawing to place a cloud'), 'success');
        }

        function clearPlacementTool() {
            const clearedTool = pendingPlacementTool;
            pendingPlacementTool = null;
            pendingPlacementStart = null;
            try { window.projectTakeoffSetAnnotationPlacement?.(false); } catch (e) { }
            if (pendingPlacementPreview) {
                pendingPlacementPreview.destroy();
                pendingPlacementPreview = null;
                if (konvaLayer) konvaLayer.batchDraw();
            }
            if (konvaStage && konvaStage.container()) konvaStage.container().style.cursor = 'default';
            updateKonvaInteractivity();
            if (clearedTool) {
                try {
                    window.parent?.postMessage({
                        type: 'project-annotation-tool-state',
                        payload: { tool: 'smart', completed: true, annotation: clearedTool }
                    }, '*');
                } catch (e) { }
            }
        }

        function addText() {
            if (!window.takeoffRequireWrite()) return false;
            setMode('smart');
            if (useKonvaRuler) {
                startPlacementTool('note');
                return true;
            }
            const center = canvas.getVpCenter();
            const preset = getResponsiveNotePreset();
            const t = new fabric.Textbox('annotation', {
                left: center.x,
                top: center.y,
                fill: '#ef4444',
                fontSize: preset.fontSize,
                fontWeight: 'normal',
                originX: 'center',
                originY: 'center',
                isNew: true
            });
            // Newly placed fallback annotations must remain movable/resizable like
            // their Konva counterparts; locking is an explicit user action.
            unlockObject(t);
            t.set({ hasControls: true, lockScalingX: false, lockScalingY: false });
            canvas.add(t); canvas.setActiveObject(t); t.selectAll(); t.enterEditing();
            showPropSection('text');
            document.getElementById('text-size-input').value = preset.fontSize;
            document.querySelectorAll('#prop-text .color-dot').forEach(d => d.classList.remove('active'));
            document.querySelector('#prop-text .color-dot[data-col="#ef4444"]').classList.add('active');
            return true;
        }

        function addCloud() {
            if (!window.takeoffRequireWrite()) return false;
            setMode('smart');
            showPropSection('cloud');
            syncCloudStrokeControl();
            if (!useKonvaRuler) return false;
            startPlacementTool('cloud');
            return true;
        }

        function addPin() {
            if (!window.takeoffRequireWrite()) return false;
            setMode('smart');
            if (!useKonvaRuler) return false;
            startPlacementTool('pin');
            return true;
        }
        window.addPin = addPin;

        function updateSelectedNoteTypography(params = {}) {
            if (!window.takeoffRequireWrite()) return false;
            if (!konvaSelectedNote || !konvaSelectedNote.label) return false;
            if (params.fontSize && isFinite(params.fontSize)) {
                konvaSelectedNote.label.fontSize(Number(params.fontSize));
            }
            if (params.color) {
                konvaSelectedNote.label.fill(params.color);
            }
            konvaSelectedNote.syncBg?.();
            if (konvaLayer) konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
            return true;
        }
        window.updateSelectedNoteTypography = updateSelectedNoteTypography;

        function updateSelectedCloudColor(color) {
            if (!window.takeoffRequireWrite()) return false;
            if (!konvaSelectedNode || konvaSelectedNode.type !== 'cloud' || !konvaSelectedNode.ref) return false;
            const cloud = konvaSelectedNode.ref;
            cloud.stroke = color;
            if (cloud.shape) {
                cloud.shape.stroke(color);
                cloud.shape.shadowColor(color);
            }
            if (konvaLayer) konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
            return true;
        }
        window.updateSelectedCloudColor = updateSelectedCloudColor;

        function applyKonvaRulerVisuals(r) {
            if (!r) return;
            const rColor = r.color || '#22c55e';
            r.line?.stroke(rColor);
            r.a1?.fill(rColor);
            r.a2?.fill(rColor);
            r.label?.fill(rColor);
            r.group?.visible(r.page === pageNum && !r.hidden);
        }

        function updateSelectedRulerStyle(params = {}) {
            if (!window.takeoffRequireWrite()) return false;
            if (!konvaSelectedNode || konvaSelectedNode.type !== 'ruler' || !konvaSelectedNode.ref) return false;
            const ruler = konvaSelectedNode.ref;
            if (params.color) ruler.color = String(params.color);
            if (params.hidden !== undefined) ruler.hidden = Boolean(params.hidden);
            applyKonvaRulerVisuals(ruler);
            if (ruler.hidden) {
                ruler.a1?.visible(false);
                ruler.a2?.visible(false);
            }
            if (konvaLayer) konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
            emitKonvaRulersState();
            return true;
        }
        window.updateSelectedRulerStyle = updateSelectedRulerStyle;

        function setKonvaRulerVisibility(rulerId, visible) {
            const targetId = String(rulerId || '');
            const ruler = konvaRulers.find(r => String(r.id || '') === targetId);
            if (!ruler) return false;
            ruler.hidden = !visible;
            applyKonvaRulerVisuals(ruler);
            if (ruler.hidden) {
                ruler.a1?.visible(false);
                ruler.a2?.visible(false);
            }
            if (konvaLayer) konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
            emitKonvaRulersState();
            return true;
        }
        window.setKonvaRulerVisibility = setKonvaRulerVisibility;

        function setAllKonvaRulersVisibility(visible) {
            konvaRulers.filter(r => r.page === pageNum).forEach(r => {
                r.hidden = !visible;
                applyKonvaRulerVisuals(r);
                if (r.hidden) {
                    r.a1?.visible(false);
                    r.a2?.visible(false);
                }
            });
            if (konvaLayer) konvaLayer.batchDraw();
            saveCurrentPageAnnotations();
            emitKonvaRulersState();
            return true;
        }
        window.setAllKonvaRulersVisibility = setAllKonvaRulersVisibility;

        function selectKonvaRulerById(rulerId) {
            const targetId = String(rulerId || '');
            const ruler = konvaRulers.find(r => String(r.id || '') === targetId);
            if (!ruler) return false;
            if (ruler.hidden) {
                ruler.hidden = false;
                applyKonvaRulerVisuals(ruler);
            }
            ruler.select?.();
            emitKonvaRulersState();
            return true;
        }
        window.selectKonvaRulerById = selectKonvaRulerById;

        function bringTakeoffRulersToTop() {
            konvaRulers.forEach(r => {
                if (r.group) {
                    r.group.moveToTop();
                    r.a1?.moveToTop();
                    r.a2?.moveToTop();
                    r.label?.moveToTop();
                }
            });
            if (konvaLayer) konvaLayer.batchDraw();
        }
        window.bringTakeoffRulersToTop = bringTakeoffRulersToTop;

        function setTextFixedColor(color, el) {
            document.querySelectorAll('#prop-text .color-dot').forEach(d => d.classList.remove('active'));
            el.classList.add('active');
            updateTextProp('fill', color);
        }

        const REPORT_ATTACH_MAX_FILES = 5;
        const REPORT_ATTACH_MAX_BYTES = 10 * 1024 * 1024;
        const REPORT_ATTACH_ALLOWED = [
            /^image\//,
            /^application\/pdf$/,
            /^application\/msword$/,
            /^application\/vnd\.openxmlformats-officedocument\./,
            /^application\/vnd\.ms-excel$/
        ];
        let reportAttachments = [];

        function isAllowedAttachmentType(file) {
            return REPORT_ATTACH_ALLOWED.some(rx => rx.test(file.type || ''));
        }

        function formatBytes(bytes) {
            if (!isFinite(bytes) || bytes <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB'];
            let i = 0;
            let val = bytes;
            while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
            return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
        }

        function getAttachmentIcon(file) {
            const type = (file.type || '').toLowerCase();
            if (type.startsWith('image/')) return 'fa-file-image';
            if (type === 'application/pdf') return 'fa-file-pdf';
            if (type.includes('word') || type.includes('officedocument.word')) return 'fa-file-word';
            if (type.includes('excel') || type.includes('spreadsheet')) return 'fa-file-excel';
            return 'fa-file';
        }

        function renderAttachmentPreview() {
            const box = document.getElementById('rep-attachments-preview');
            if (!box) return;
            box.innerHTML = '';
            reportAttachments.forEach((entry, idx) => {
                const row = document.createElement('div');
                row.className = 'd-flex align-items-center justify-content-between p-2 rounded';
                row.style.background = '#1f2633';
                row.style.border = '1px solid #2f384a';

                const left = document.createElement('div');
                left.className = 'd-flex align-items-center gap-2';

                if (entry.previewUrl) {
                    const img = document.createElement('img');
                    img.src = entry.previewUrl;
                    img.alt = entry.file.name;
                    img.style.width = '44px';
                    img.style.height = '44px';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '6px';
                    left.appendChild(img);
                } else {
                    const icon = document.createElement('i');
                    icon.className = `fas ${getAttachmentIcon(entry.file)} text-accent`;
                    left.appendChild(icon);
                }

                const meta = document.createElement('div');
                meta.className = 'small';
                meta.innerHTML = `<div class="text-white">${entry.file.name}</div><div class="text-muted">${formatBytes(entry.file.size)}</div>`;
                left.appendChild(meta);

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-sm btn-outline-danger';
                btn.innerHTML = '<i class="fas fa-times"></i>';
                btn.onclick = () => {
                    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
                    reportAttachments.splice(idx, 1);
                    renderAttachmentPreview();
                };

                row.appendChild(left);
                row.appendChild(btn);
                box.appendChild(row);
            });
        }

        function addReportAttachments(fileList) {
            if (!window.takeoffRequireWrite()) return false;
            const files = Array.from(fileList || []);
            for (const file of files) {
                if (reportAttachments.length >= REPORT_ATTACH_MAX_FILES) {
                    showToast('Maximum 5 attachments per report', 'warning');
                    break;
                }
                if (!isAllowedAttachmentType(file)) {
                    showToast(`Unsupported file type: ${file.name}`, 'error');
                    continue;
                }
                if (file.size > REPORT_ATTACH_MAX_BYTES) {
                    showToast(`File exceeds 10MB: ${file.name}`, 'error');
                    continue;
                }
                const previewUrl = (file.type || '').startsWith('image/') ? URL.createObjectURL(file) : null;
                reportAttachments.push({ file, previewUrl });
            }
            renderAttachmentPreview();
        }

        function initReportAttachmentUI() {
            const input = document.getElementById('rep-attachments');
            const drop = document.getElementById('rep-attach-dropzone');
            if (!input || !drop || input.dataset.bound === '1') return;

            input.addEventListener('change', (e) => {
                addReportAttachments(e.target.files);
                input.value = '';
            });

            ['dragenter', 'dragover'].forEach(evt => {
                drop.addEventListener(evt, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    drop.style.borderColor = '#22c55e';
                });
            });

            ['dragleave', 'drop'].forEach(evt => {
                drop.addEventListener(evt, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    drop.style.borderColor = '#475569';
                });
            });

            drop.addEventListener('drop', (e) => {
                addReportAttachments(e.dataTransfer?.files || []);
            });

            input.dataset.bound = '1';
        }

        function resetReportAttachments() {
            reportAttachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
            reportAttachments = [];
            renderAttachmentPreview();
        }

        function openReportModal() {
            saveCurrentPageAnnotations();
            initReportAttachmentUI();
            resetReportAttachments();
            new bootstrap.Modal(document.getElementById('reportModal')).show();
        }

        async function submitReport() {
            if (!window.takeoffRequireWrite()) return false;
            const btn = document.getElementById('btn-generate');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Generating...';
            try {
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                doc.setFontSize(22); doc.text("Field Activity Report", 20, 20);
                doc.setFontSize(12);
                doc.text(`Project File: ${runtimeFilename}`, 20, 35);
                doc.text(`Technician: ${document.getElementById('rep-name').value}`, 20, 45);
                doc.text(`Role: ${document.getElementById('rep-role').value}`, 20, 55);
                doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 65);
                doc.setFontSize(14); doc.text("Activity Description:", 20, 80);
                doc.setFontSize(11);
                const desc = document.getElementById('rep-desc').value;
                const splitText = doc.splitTextToSize(desc, 170);
                doc.text(splitText, 20, 90);
                if (reportAttachments.length > 0) {
                    const names = reportAttachments.map(a => `- ${a.file.name}`);
                    doc.setFontSize(12);
                    doc.text('Attachments:', 20, 118);
                    doc.setFontSize(10);
                    doc.text(doc.splitTextToSize(names.join('\n'), 170), 20, 126);
                }
                const dataUrl = canvas.toDataURL({ format: 'jpeg', quality: 0.8 });
                doc.addPage();
                doc.text("Plan Snapshot (Current View)", 20, 20);
                const imgProps = doc.getImageProperties(dataUrl);
                const pdfWidth = doc.internal.pageSize.getWidth() - 40;
                const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
                doc.addImage(dataUrl, 'JPEG', 20, 30, pdfWidth, pdfHeight);
                const pdfBlob = doc.output('blob');
                const annotationsJson = JSON.stringify(allAnnotations);
                const fd = new FormData();
                fd.append('action', 'save_report_flow');
                fd.append('file_id', fileId);
                fd.append('pdf_file', pdfBlob);
                fd.append('annotations_json', annotationsJson);
                fd.append('tech_name', document.getElementById('rep-name').value);
                fd.append('tech_role', document.getElementById('rep-role').value);
                fd.append('description', desc);
                reportAttachments.forEach(a => fd.append('attachments[]', a.file, a.file.name));
                const res = await fetch('../api/api.php', { method: 'POST', body: fd });
                const d = await res.json();
                if (d.status === 'success') {
                    showToast("Report saved successfully!", "success");
                    setTimeout(() => location.href = "preview.php?id=" + fileId, 1500);
                } else { showToast("Error saving report: " + d.msg, "error"); btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Generate Report'; }
            } catch (e) { console.error(e); showToast("Critical Error generating report", "error"); btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Generate Report'; }
        }

        window.projectTakeoffDownloadAnnotatedDrawing = async function (customOptions = {}) {
            showToast('Preparing drawing with marks for download...', 'info');
            try {
                const rawFilename = runtimeFilename;
                const extMatch = rawFilename.match(/\.([0-9a-z]+)$/i);
                const baseName = rawFilename.replace(/\.[^/.]+$/, "");
                const isPdf = !!pdfDoc || (extMatch && extMatch[1].toLowerCase() === 'pdf');

                let exportCanvas = document.createElement('canvas');
                let ctx = exportCanvas.getContext('2d');
                let worldW = 0;
                let worldH = 0;
                let exportScale = 1.5;

                if (pdfDoc) {
                    const page = await pdfDoc.getPage(pageNum);
                    const viewport = page.getViewport({ scale: exportScale });
                    exportCanvas.width = Math.floor(viewport.width);
                    exportCanvas.height = Math.floor(viewport.height);
                    worldW = viewport.width / exportScale;
                    worldH = viewport.height / exportScale;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
                    await page.render({ canvasContext: ctx, viewport }).promise;
                } else if (canvas && canvas.backgroundImage) {
                    const bgImg = canvas.backgroundImage.getElement ? canvas.backgroundImage.getElement() : canvas.backgroundImage._element;
                    if (bgImg && (bgImg.naturalWidth || bgImg.width)) {
                        worldW = bgImg.naturalWidth || bgImg.width;
                        worldH = bgImg.naturalHeight || bgImg.height;
                        exportCanvas.width = worldW;
                        exportCanvas.height = worldH;
                        exportScale = 1;
                        ctx.drawImage(bgImg, 0, 0, worldW, worldH);
                    } else {
                        worldW = canvas.getWidth();
                        worldH = canvas.getHeight();
                        exportCanvas.width = worldW;
                        exportCanvas.height = worldH;
                        exportScale = 1;
                        ctx.drawImage(canvas.lowerCanvasEl, 0, 0);
                    }
                } else {
                    showToast('No drawing loaded to export.', 'warning');
                    return false;
                }

                // Render Fabric annotations if any exist (excluding background)
                if (canvas && typeof canvas.getObjects === 'function') {
                    const fabricObjs = canvas.getObjects().filter(o => !o.excludeFromExport && o !== canvas.backgroundImage);
                    if (fabricObjs.length > 0) {
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = exportCanvas.width;
                        tempCanvas.height = exportCanvas.height;
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.scale(exportScale, exportScale);
                        fabricObjs.forEach(obj => obj.render(tempCtx));
                        ctx.drawImage(tempCanvas, 0, 0);
                    }
                }

                // Render Konva overlay (markers, counts, lines, areas, text notes, clouds)
                if (konvaLayer) {
                    const transformers = konvaLayer.find('Transformer');
                    transformers.forEach(t => t.visible(false));

                    const origPos = konvaLayer.position();
                    const origScale = konvaLayer.scale();

                    konvaLayer.position({ x: 0, y: 0 });
                    konvaLayer.scale({ x: exportScale, y: exportScale });
                    konvaLayer.batchDraw();

                    const konvaCanvas = konvaLayer.toCanvas({
                        x: 0,
                        y: 0,
                        width: exportCanvas.width,
                        height: exportCanvas.height,
                        pixelRatio: 1
                    });

                    konvaLayer.position(origPos);
                    konvaLayer.scale(origScale);
                    transformers.forEach(t => t.visible(true));
                    konvaLayer.batchDraw();

                    ctx.drawImage(konvaCanvas, 0, 0);
                }

                const downloadFilename = isPdf
                    ? `${baseName}_Sheet_${pageNum}_with_takeoff.pdf`
                    : `${baseName}_with_takeoff.png`;

                if (isPdf && window.jspdf) {
                    const { jsPDF } = window.jspdf;
                    const pdf = new jsPDF({
                        orientation: worldW > worldH ? 'landscape' : 'portrait',
                        unit: 'pt',
                        format: [worldW, worldH]
                    });
                    const imgData = exportCanvas.toDataURL('image/jpeg', 0.94);
                    pdf.addImage(imgData, 'JPEG', 0, 0, worldW, worldH);
                    pdf.save(downloadFilename);
                } else {
                    const link = document.createElement('a');
                    link.download = downloadFilename;
                    link.href = exportCanvas.toDataURL('image/png');
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                }
                showToast(`Downloaded: ${downloadFilename}`, 'success');
                return true;
            } catch (err) {
                console.error('Download annotated drawing error:', err);
                showToast('Failed to export drawing with marks, falling back to original.', 'warning');
                return false;
            }
        };

        function showToast(msg, type = 'info') {
            const box = document.getElementById('toast-container');
            if (!box) return;
            box.innerHTML = '';
            const key = `${type}:${msg}`;
            const el = document.createElement('div');
            el.className = `toast-msg`;
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
                || document.body?.classList.contains('theme-dark')
                || (function () {
                    try {
                        return window.parent?.document?.documentElement?.getAttribute('data-theme') === 'dark'
                            || window.parent?.document?.body?.classList.contains('theme-dark');
                    } catch (_) { return false; }
                })();
            if (isDark) el.classList.add('theme-dark');
            el.dataset.toastKey = key;
            el.dataset.toastType = type;
            let icon = '<i class="fas fa-check" style="color:#10b981;"></i>';
            let borderColor = 'rgba(16, 185, 129, 0.4)';
            if (type === 'error') {
                icon = '<i class="fas fa-triangle-exclamation" style="color:#ef4444;"></i>';
                borderColor = 'rgba(239, 68, 68, 0.4)';
            } else if (type === 'warning') {
                icon = '<i class="fas fa-circle-exclamation" style="color:#eab308;"></i>';
                borderColor = 'rgba(234, 179, 8, 0.4)';
            } else if (type === 'info') {
                icon = '<i class="fas fa-circle-info" style="color:#38bdf8;"></i>';
                borderColor = 'rgba(56, 189, 248, 0.4)';
            }
            el.style.borderColor = borderColor;
            el.innerHTML = icon;
            const message = document.createElement('span');
            message.textContent = msg;
            el.appendChild(message);
            box.appendChild(el);
            setTimeout(() => el.remove(), 3200);
        }
        window.showToast = showToast;
        window.addEventListener('message', e => {
            if (e.data?.type === 'editor-show-toast') {
                showToast(e.data.payload?.message || e.data.message || '', e.data.payload?.type || e.data.toastType || 'info');
            }
        });

        function updateTextProp(prop, val) {
            if (konvaSelectedNote && konvaSelectedNote.label) {
                if (prop === 'fill') konvaSelectedNote.label.fill(val);
                if (prop === 'fontSize') konvaSelectedNote.label.fontSize(parseInt(val, 10) || konvaSelectedNote.label.fontSize());
                if (konvaLayer) konvaLayer.batchDraw();
                saveCurrentPageAnnotations();
                return;
            }
            const active = canvas.getActiveObject();
            if (active && (active.type === 'i-text' || active.type === 'text' || active.type === 'textbox')) { active.set(prop, val); canvas.requestRenderAll(); }
        }

        function updateTextScales(zoom, options = {}) {
            const scale = Math.min(1.5, Math.max(0.2, 1 / zoom));
            canvas.getObjects().forEach(obj => {
                if (obj.isMeasureLabel) { obj.set({ scaleX: scale, scaleY: scale }); }
                if (obj.isMeasureLine) { obj.set({ strokeWidth: 4 * scale }); }
            });
            if (options.deferDraw) return;
            canvas.requestRenderAll();
            if (useKonvaRuler) syncKonvaToFabric();
        }

        // Wheel and trackpad gestures can emit many events inside one display frame.
        // Keep the latest viewport immediately, but coalesce all expensive redraw and
        // takeoff-node scaling work into a single animation-frame commit.
        let viewportFrameRaf = null;
        let pendingViewportFrame = null;
        function scheduleViewportFrameUpdate(zoom, pointer = null) {
            pendingViewportFrame = { zoom, pointer };
            if (viewportFrameRaf) return;
            const raf = typeof requestAnimationFrame === 'function'
                ? requestAnimationFrame
                : callback => setTimeout(callback, 0);
            viewportFrameRaf = raf(() => {
                const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
                viewportFrameRaf = null;
                const pending = pendingViewportFrame;
                pendingViewportFrame = null;
                if (!pending) return;
                canvas.requestRenderAll();
                if (useKonvaRuler) applyKonvaViewportCssTransform();
                scheduleViewportIdleCommit(pending.zoom);
                if (pending.pointer && typeof window.projectTakeoffOnZoom === 'function') {
                    window.projectTakeoffOnZoom({
                        clientX: pending.pointer.clientX,
                        clientY: pending.pointer.clientY,
                        zoom: pending.zoom
                    });
                }
                recordViewportWork('zoom', startedAt);
            });
        }

        function handleSelectionChange() {
            const active = canvas.getActiveObject();
            if (active) {
                if (active.type === 'i-text' || active.type === 'text' || active.type === 'textbox') {
                    const sInp = document.getElementById('text-size-input');
                    if (sInp) sInp.value = active.fontSize;
                    const currentColor = active.fill;
                    document.querySelectorAll('#prop-text .color-dot').forEach(d => {
                        d.classList.remove('active');
                        if (d.getAttribute('data-col').toLowerCase() === currentColor.toLowerCase()) { d.classList.add('active'); }
                    });
                    showPropSection('text');
                } else { showPropSection('smart'); }
            } else { showPropSection(currentMode); }
            keepScaleDisplayVisible();
        }

        canvas.on('selection:created', handleSelectionChange);
        canvas.on('selection:updated', handleSelectionChange);
        canvas.on('selection:cleared', handleSelectionChange);

        // Interceptar transformaciones para verificar si estamos manipulando un control
        canvas.on('before:transform', function (e) {
            const obj = e.target;
            if (obj && obj.isMeasureLine) {
                // Asegurar que las transformaciones no deseadas estÃ©n bloqueadas
                obj.set({ lockRotation: true, lockScalingX: true, lockScalingY: true });

                // Si estamos en modo de ediciÃ³n (doble clic en vÃ©rtice), bloquear movimiento del objeto
                if (isDraggingControl && controlEditMode) {
                    obj.set({ lockMovementX: true, lockMovementY: true });
                } else {
                    // Si no es modo de ediciÃ³n, permitir movimiento del objeto
                    obj.set({ lockMovementX: false, lockMovementY: false });
                }
            }
        });

        // Detectar cuando se estÃ¡ modificando (durante el arrastre)
        canvas.on('object:modifying', function (e) {
            const obj = e.target;
            if (obj && obj.isMeasureLine && isDraggingControl && controlEditMode) {
                // Cancelar renderizado anterior si existe
                if (renderAnimationFrame) {
                    cancelAnimationFrame(renderAnimationFrame);
                }

                // Usar requestAnimationFrame para renderizado suave sin trazos impresos
                renderAnimationFrame = requestAnimationFrame(() => {
                    // Actualizar la etiqueta de mediciÃ³n en tiempo real mientras se arrastra un control
                    updateMeasureLabel(obj);
                    // Usar requestRenderAll para renderizado suave
                    canvas.requestRenderAll();
                    renderAnimationFrame = null;
                });
            }
        });

        // Detectar cuando se completa una transformaciÃ³n para restaurar el estado
        canvas.on('object:modified', function (e) {
            const obj = e.target;
            if (obj && obj.isMeasureLine) {
                // Cancelar cualquier renderizado pendiente
                if (renderAnimationFrame) {
                    cancelAnimationFrame(renderAnimationFrame);
                    renderAnimationFrame = null;
                }

                // Actualizar la etiqueta final con renderizado suave
                requestAnimationFrame(() => {
                    updateMeasureLabel(obj);
                    canvas.requestRenderAll();
                });

                // Restaurar el movimiento del objeto despuÃ©s de modificar
                obj.set({ lockMovementX: false, lockMovementY: false });

                // Guardar en historial si fue una modificaciÃ³n de control
                if (isDraggingControl && controlEditMode) {
                    saveHistory();
                }

                // Resetear estado de ediciÃ³n
                controlEditMode = false;
                activeControlPoint = null;
                isDraggingControl = false;
                controlDragStart = null;
            }
        });

        window.addEventListener('keydown', e => {
            if (e.defaultPrevented || e.isComposing
                || e.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.repeat) {
                const key = e.key.toLowerCase();
                if (key === 'z' || key === 'y') {
                    e.preventDefault();
                    if (key === 'y' || e.shiftKey) redo();
                    else undo();
                    return;
                }
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (window.projectTakeoffHandleDeleteKey?.(e)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                const activeObj = canvas.getActiveObject();
                if (activeObj && activeObj.isEditing) return;
                if (e.target?.matches?.('input, textarea, select, option, [contenteditable="true"], [role="textbox"]')) return;
                e.preventDefault(); deleteSelected();
            }
        });

        canvas.on('mouse:wheel', function (opt) {
            const evt = opt.e;
            const delta = Number(evt?.deltaY || 0);
            const factor = (evt?.ctrlKey && Math.abs(delta) < 40)
                ? Math.max(0.78, Math.min(1.28, 0.986 ** delta))
                : (Math.abs(delta) >= 30 ? (delta < 0 ? 1.18 : 0.85) : (0.9975 ** delta));
            let zoom = canvas.getZoom() * factor;
            const minZoom = Math.min(0.25, pdfFitZoom ? pdfFitZoom * 0.5 : 0.25);
            if (zoom > 4.0) zoom = 4.0; if (zoom < minZoom) zoom = minZoom;
            canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            clampViewportTransform(canvas.viewportTransform);
            canvas.setViewportTransform(canvas.viewportTransform);
            notifyTakeoffZoomChanged('wheel');
            scheduleViewportFrameUpdate(zoom, { clientX: evt.clientX, clientY: evt.clientY });
            opt.e.preventDefault(); opt.e.stopPropagation();
        });
        // schedulePdfRerender is committed once by scheduleViewportFrameUpdate.

        window.addEventListener('beforeunload', () => {
            saveCurrentPageAnnotations();
            pdfBitmapCache.forEach(bitmap => {
                if (bitmap?.url) URL.revokeObjectURL(bitmap.url);
                if (bitmap?.canvas) {
                    bitmap.canvas.width = 0;
                    bitmap.canvas.height = 0;
                }
            });
            pdfBitmapCache.clear();
        });
        window.addEventListener('pagehide', () => {
            saveCurrentPageAnnotations();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') saveCurrentPageAnnotations();
        });


