(function (global) {
    'use strict';

    function clone(value) {
        if (Array.isArray(value)) return value.map(clone);
        if (!value || typeof value !== 'object') return value;
        const copy = {};
        Object.keys(value).forEach(key => { copy[key] = clone(value[key]); });
        return copy;
    }

    function fromLayer(layer) {
        const value = layer?.catalogMetadata || layer?.metadata_json?.catalog_item;
        return value && typeof value === 'object' ? clone(value) : null;
    }

    function attach(layer, value) {
        const copy = { ...(layer || {}) };
        const metadata = value && typeof value === 'object' ? clone(value) : fromLayer(layer);
        copy.metadata_json = clone(layer?.metadata_json || {});
        if (metadata) {
            copy.catalogMetadata = clone(metadata);
            copy.metadata_json.catalog_item = clone(metadata);
        }
        return copy;
    }

    function mergeMetadata(existing, incoming, additions = {}) {
        const result = { ...clone(existing || {}), ...clone(additions || {}) };
        const metadata = incoming && typeof incoming === 'object' ? clone(incoming)
            : (existing?.catalog_item && typeof existing.catalog_item === 'object' ? clone(existing.catalog_item) : null);
        if (metadata) result.catalog_item = metadata;
        return result;
    }

    const api = { clone, fromLayer, attach, mergeMetadata };
    global.CatalogMetadata = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
