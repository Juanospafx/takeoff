(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TakeoffScaleController = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    function create(dependencies = {}) {
        const {
            getElement: $,
            document: documentRef = root.document,
            window: windowRef = root
        } = dependencies.dom || {};
        const document = documentRef;
        const window = windowRef;
        const {
            takeoffWindow,
            callEditor,
            syncTakeoffSubheadAlignment,
            requireWrite,
            showToast
        } = dependencies.actions || {};

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
        const editorWin = takeoffWindow();
        const editorDoc = editorDocument();
        const rawDisplay = (editorDoc?.getElementById('scale-display')?.textContent || callEditor('getActiveScaleLabel') || '').trim();
        const activePpf = Number(editorWin?.pixelsPerFoot || 0);
        const scaleText = (rawDisplay && rawDisplay !== '--') ? rawDisplay : (activePpf > 0 ? 'Custom' : '');
        const label = button.querySelector('#takeoffScaleLabel') || button.querySelector('span:not(.pro-scale-dot)') || button.querySelector('span');
        const icon = button.querySelector('i');
        const hasScale = Boolean(scaleText && scaleText !== '--' && !scaleText.toLowerCase().includes('not set') && scaleText !== '0');
        button.classList.toggle('is-set', hasScale);
        if (icon) icon.style.display = 'none';
        if (label) label.textContent = hasScale ? `Scale: ${scaleText}` : 'Not Drawing Scale';
        button.title = hasScale ? `Drawing scale: ${scaleText}` : 'Set drawing scale';
        syncTakeoffSubheadAlignment();

        const panel = $('takeoffScalePanel');
        const isPanelOpen = panel?.classList.contains('open');
        const presetSelect = $('takeoffScalePreset');
        const isUserDirty = presetSelect?.dataset?.userDirty === '1';

        // Only update preset dropdown if forced, or if panel is closed and user isn't actively selecting
        if (presetSelect && (forcePresetSync || (!isPanelOpen && !isUserDirty))) {
            let matched = false;
            if (hasScale) {
                for (let i = 0; i < presetSelect.options.length; i++) {
                    if (presetSelect.options[i].text.trim().toLowerCase() === scaleText.toLowerCase() ||
                        presetSelect.options[i].value.trim().toLowerCase() === scaleText.toLowerCase()) {
                        presetSelect.selectedIndex = i;
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched) {
                presetSelect.value = '';
            }
            presetSelect._syncCustom?.();
        }
    }
    window.syncScaleStatus = syncScaleStatus;

    function hasScaleSet() {
        const editorWin = takeoffWindow();
        const scaleText = (editorDocument()?.getElementById('scale-display')?.textContent || callEditor('getActiveScaleLabel') || '').trim();
        if (scaleText && scaleText !== '--' && !scaleText.toLowerCase().includes('not set') && scaleText !== '0') return true;
        return Number(editorWin?.pixelsPerFoot || 0) > 0;
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
        if (!target) return false;
        if (source && source.options && source.options.length > 1) {
            if (target.dataset.loaded === '1' && target.dataset.optionCount === String(source.options.length)) {
                target._syncCustom?.();
                return true;
            }
            target.innerHTML = source.innerHTML;
            target.value = source.value || '';
            target.dataset.loaded = '1';
            target.dataset.optionCount = String(source.options.length);
            target._syncCustom?.();
            return true;
        }
        return false;
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
        if (!requireWrite()) return false;
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
        if (value === '' || value === null || value === undefined) return;
        const applyCheckbox = $('takeoffScaleApplyAll');
        const applyAll = Boolean(applyCheckbox?.checked);
        const editorSelect = editorDocument()?.getElementById('cal-preset');
        if (editorSelect) editorSelect.value = value;
        const result = callEditor('applyScalePreset', value, applyAll);
        const presetSelect = $('takeoffScalePreset');
        if (presetSelect) delete presetSelect.dataset.userDirty;
        syncScaleStatus(true);
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
        syncScaleStatus(true);
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
                syncScalePresets();
                const presetVal = $('takeoffScalePreset')?.value;
                if (presetVal !== '' && presetVal !== null && presetVal !== undefined) {
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


        return Object.freeze({
            editorDocument,
            syncScaleStatus,
            hasScaleSet,
            syncScaleHint,
            syncScalePresets,
            setScaleMode,
            openScalePanel,
            closeScalePanel,
            applyScalePreset,
            applyManualScale,
            bindScalePanel
        });
    }

    return Object.freeze({ create });
});

