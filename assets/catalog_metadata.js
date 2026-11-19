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
        let value = layer?.catalogMetadata || layer?.metadata_json?.catalog_item;
        if (!value && layer?.metadata_json?.catalog_item_ref && typeof global.ProjectState?.catalogItemMetaMap === 'object') {
            value = global.ProjectState.catalogItemMetaMap[layer.metadata_json.catalog_item_ref] || null;
        }
        return value && typeof value === 'object' ? clone(value) : null;
    }

    function attach(layer, value) {
        const copy = { ...(layer || {}) };
        const metadata = value && typeof value === 'object' ? clone(value) : fromLayer(layer);
        copy.metadata_json = clone(layer?.metadata_json || {});
        if (metadata) {
            copy.catalogMetadata = clone(metadata);
            copy.metadata_json.catalog_item = clone(metadata);
            delete copy.metadata_json.catalog_item_ref;
        }
        return copy;
    }

    function mergeMetadata(existing, incoming, additions = {}) {
        const result = { ...clone(existing || {}), ...clone(additions || {}) };
        const metadata = incoming && typeof incoming === 'object' ? clone(incoming)
            : (existing?.catalog_item && typeof existing.catalog_item === 'object'
                ? clone(existing.catalog_item)
                : (existing?.catalog_item_ref && global.ProjectState?.catalogItemMetaMap?.[existing.catalog_item_ref]
                    ? clone(global.ProjectState.catalogItemMetaMap[existing.catalog_item_ref])
                    : null));
        if (metadata) {
            result.catalog_item = metadata;
            delete result.catalog_item_ref;
        }
        return result;
    }

    const api = { clone, fromLayer, attach, mergeMetadata };
    global.CatalogMetadata = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
