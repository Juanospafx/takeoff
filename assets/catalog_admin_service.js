(function (global) {
    'use strict';
    const DEFAULT_ENDPOINT = '../api/catalog_admin.php';
    class CatalogAdminError extends Error {
        constructor(code, message, options = {}) { super(message); this.name = 'CatalogAdminError'; this.code = code; this.status = options.status || 0; this.details = options.details || null; this.current = options.current || null; }
    }
    function requestId() { return global.crypto?.randomUUID?.() || `catalog-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
    async function command(commandName, payload = {}, options = {}) {
        const fetchImpl = options.fetchImpl || global.fetch;
        if (typeof fetchImpl !== 'function') throw new CatalogAdminError('FETCH_UNAVAILABLE', 'No fetch implementation is available.');
        let response;
        try { response = await fetchImpl(options.endpoint || DEFAULT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ command: commandName, requestId: options.requestId || requestId(), expectedRevision: options.expectedRevision, payload }) }); }
        catch (cause) { throw new CatalogAdminError('NETWORK_ERROR', 'Unable to reach Cost Catalog administration.', { details: cause }); }
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.success) { const error = json?.error || {}; throw new CatalogAdminError(error.code || 'API_ERROR', error.message || 'Cost Catalog update failed.', { status: response.status, details: error.details, current: error.current }); }
        return json.data;
    }
    const names = {
        createCatalog:'catalog.create',updateCatalog:'catalog.update',toggleCatalog:'catalog.toggle',archiveCatalog:'catalog.archive',restoreCatalog:'catalog.restore',copyCatalog:'catalog.copy',
        createCategory:'category.create',updateCategory:'category.update',toggleCategory:'category.toggle',archiveCategory:'category.archive',restoreCategory:'category.restore',copyCategory:'category.copy',
        createItem:'item.create',updateItem:'item.update',archiveItem:'item.archive',restoreItem:'item.restore',moveItem:'item.move',duplicateItem:'item.duplicate',
        addAssemblyComponent:'assembly_component.add',updateAssemblyComponent:'assembly_component.update',removeAssemblyComponent:'assembly_component.remove'
    };
    const api = { CatalogAdminError, command };
    Object.entries(names).forEach(([method, name]) => { api[method] = (payload, options) => command(name, payload, options); });
    global.CatalogAdminService = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
