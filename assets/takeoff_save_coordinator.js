(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TakeoffSaveCoordinator = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
    function create(options = {}) {
        const getElement = options.getElement || (id => document.getElementById(id));
        const getEditorWindow = options.getEditorWindow || (() => null);

        async function waitForService(timeoutMs = 12000) {
            const frame = getElement('takeoffFrame');
            if (!frame) {
                throw new Error('Takeoff could not be saved because its editor frame is missing. Your changes remain pending.');
            }
            if (!frame.getAttribute('src')) {
                const documentId = options.getDocumentId?.();
                if (!documentId) {
                    throw new Error('Takeoff could not be saved because no drawing is loaded. Your changes remain pending.');
                }
                frame.src = options.buildEditorUrl(documentId, options.getEstimateId?.(), options.getPage?.());
            }
            const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 12000);
            while (Date.now() < deadline) {
                const win = getEditorWindow();
                try {
                    if (win && typeof win.projectTakeoffSave === 'function') return win;
                } catch (_) {}
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            throw new Error('Takeoff editor is still loading and could not confirm persistence. Your recovery draft was preserved; wait for the drawing to finish loading and retry Save.');
        }

        async function saveWithService() {
            let editor = await waitForService();
            try {
                return await editor.projectTakeoffSave();
            } catch (error) {
                // Retry only when navigation replaced the iframe. A database or
                // validation failure from the current editor must remain visible.
                if (editor === getEditorWindow() && typeof editor?.projectTakeoffSave === 'function') throw error;
                editor = await waitForService(5000);
                return editor.projectTakeoffSave();
            }
        }

        function setStatus(state, message = '') {
            const status = getElement('takeoffAutosaveStatus');
            if (!status) return;
            const states = {
                idle: { label: 'Autosave ready', icon: 'fa-cloud' },
                pending: { label: 'Changes pending', icon: 'fa-clock' },
                saving: { label: 'Saving…', icon: 'fa-circle-notch' },
                saved: { label: 'All changes saved', icon: 'fa-check' },
                error: { label: 'Save failed — Retry', icon: 'fa-exclamation' }
            };
            const statusKey = Object.hasOwn(states, state) ? state : 'idle';
            const { label, icon } = states[statusKey];
            status.className = `takeoff-autosave-status is-${statusKey}`;
            status.querySelector('i').className = `fas ${icon}`;
            const text = status.querySelector('.takeoff-autosave-label');
            if (text.textContent !== label) text.textContent = label;
            status.title = message || label;
        }

        function handleStatus(payload = {}) {
            const status = String(payload.status || 'idle');
            let dirty = null;
            if (status === 'pending' || status === 'saving' || status === 'error') {
                dirty = true;
            } else if (status === 'saved' && payload.dirty !== true && !options.hasPendingDeletes?.()) {
                const documentMatches = !payload.drawingId
                    || Number(payload.drawingId) === Number(options.getDocumentId?.() || 0);
                const estimateMatches = !payload.estimateKey
                    || String(payload.estimateKey) === String(options.getEstimateId?.() || '');
                if (documentMatches && estimateMatches) dirty = false;
            }
            setStatus(status, payload.message || '');
            return { dirty, status };
        }

        return { waitForService, saveWithService, setStatus, handleStatus };
    }

    return { create };
});
