(function () {
    var fallback = { displayName: 'Viewer', role: 'viewer', canWrite: false, readOnly: true };
    try {
        var node = document.getElementById('takeoff-auth-metadata');
        var parsed = node ? JSON.parse(node.textContent || '{}') : fallback;
        window.TakeoffAuth = Object.freeze({
            displayName: String(parsed.displayName || fallback.displayName),
            role: String(parsed.role || fallback.role),
            canWrite: parsed.canWrite === true,
            readOnly: parsed.canWrite !== true
        });
    } catch (_) { window.TakeoffAuth = Object.freeze(fallback); }
    window.takeoffCanWrite = function () { return window.TakeoffAuth?.canWrite === true; };
    window.takeoffRequireWrite = function () {
        if (window.takeoffCanWrite()) return true;
        window.showToast?.('Read-only access: this action requires an administrator.', 'warning');
        return false;
    };

    if (!window.takeoffCanWrite()) {
        var nativeFetch = window.fetch.bind(window);
        window.fetch = function (input, init) {
            var method = String(init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
            if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
                return Promise.reject(new Error('Read-only access: mutation request blocked.'));
            }
            return nativeFetch(input, init);
        };
        document.addEventListener('DOMContentLoaded', function () {
            document.querySelectorAll('#btn-save,#btn-delete-selected,#btn-del-cal,#btn-generate,#btn-draw,#btn-text,#btn-cloud,#btn-stamp,#btn-measure,#btn-cal,[onclick*="finishCal"],[onclick*="clearCalLine"],[onclick*="deleteSelected"],[onclick*="submitReport"],[onclick*="addText"],[onclick*="addCloud"],[onclick*="addPin"],[onclick*="addStamp"]').forEach(function (element) {
                element.hidden = true;
                element.setAttribute('aria-hidden', 'true');
                if ('disabled' in element) element.disabled = true;
            });
            document.body.classList.add('takeoff-read-only');
        });
        document.addEventListener('click', function (event) {
            var mutation = event.target?.closest?.('#btn-save,#btn-delete-selected,#btn-del-cal,#btn-generate,#btn-draw,#btn-text,#btn-cloud,#btn-stamp,#btn-measure,#btn-cal,[onclick*="finishCal"],[onclick*="clearCalLine"],[onclick*="deleteSelected"],[onclick*="submitReport"]');
            if (!mutation) return;
            event.preventDefault(); event.stopImmediatePropagation();
        }, true);
    }
})();
