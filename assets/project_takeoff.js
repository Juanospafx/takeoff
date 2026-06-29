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
        if (command === 'grid' || command === 'layers' || command === 'compare' || command === 'previous' || command === 'next') {
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
        bindScalePanel();

        document.addEventListener('click', () => {
            document.querySelectorAll('.pro-menu, .pro-row-menu').forEach(menu => menu.classList.remove('open'));
            closeScalePanel();
        });
        $('takeoffScalePanel')?.addEventListener('click', event => event.stopPropagation());
    });
})();
