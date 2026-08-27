(function (global) {
    'use strict';

    const Contract = global.CatalogItemContract
        || (typeof require === 'function' ? require('./catalog_item_contract.js') : null);
    if (!Contract) throw new Error('CatalogItemContract must load before CatalogService');

    const DEFAULT_ENDPOINT = '../api/cost_catalog.php';

    class CatalogServiceError extends Error {
        constructor(code, message, options = {}) {
            super(message);
            this.name = 'CatalogServiceError';
            this.code = code;
            this.status = Number(options.status || 0) || null;
            this.cause = options.cause || null;
        }
    }

    function id(value) {
        return value === null || value === undefined || value === '' ? null : String(value);
    }

    function flag(value, fallback = true) {
        if (value === null || value === undefined || value === '') return fallback;
        return !['0', 'false', 'no'].includes(String(value).toLowerCase());
    }

    function catalogDto(row = {}) {
        return {
            id: id(row.id),
            name: String(row.name || ''),
            description: String(row.description || ''),
            trade: String(row.trade || ''),
            active: flag(row.active),
            enabledForProjects: flag(row.enabled_for_projects),
            locked: flag(row.locked, false),
            revision: row.revision ?? row.updated_at ?? row.updatedAt ?? null,
            itemCount: Number(row.item_count || 0)
        };
    }

    function categoryDto(row = {}) {
        return {
            id: id(row.id),
            catalogId: id(row.catalog_id),
            parentId: id(row.parent_group_id),
            name: String(row.name || ''),
            catalogName: String(row.catalog_name || ''),
            description: String(row.description || ''),
            sortOrder: Number(row.sort_order || 0),
            active: flag(row.active),
            enabledForProjects: flag(row.enabled_for_projects),
            revision: row.revision ?? row.updated_at ?? row.updatedAt ?? null,
            itemCount: Number(row.item_count || 0)
        };
    }

    function availabilityMode(options = {}) {
        if (options.enabledForProjectsOnly) return 'project';
        if (options.activeOnly) return 'active';
        return ['admin', 'active', 'project'].includes(options.availability) ? options.availability : 'admin';
    }

    function endpointUrl(endpoint, options = {}) {
        const params = new URLSearchParams({ action: 'list', view: 'all' });
        params.set('availability', availabilityMode(options));
        if (availabilityMode(options) === 'admin' && options.includeDeleted) params.set('include_deleted', '1');
        if (options.catalogId) {
            params.set('view', 'catalog');
            params.set('catalog_id', options.catalogId);
        }
        if (options.categoryId) {
            params.set('view', 'group');
            params.set('group_id', options.categoryId);
        }
        return `${endpoint}?${params.toString()}`;
    }

    async function requestPayload(options = {}) {
        const fetchImpl = options.fetchImpl || global.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new CatalogServiceError('FETCH_UNAVAILABLE', 'No fetch implementation is available.');
        }
        let response;
        try {
            response = await fetchImpl(endpointUrl(options.endpoint || DEFAULT_ENDPOINT, options), {
                headers: { Accept: 'application/json' }
            });
        } catch (cause) {
            throw new CatalogServiceError('NETWORK_ERROR', 'Unable to reach the Cost Catalog.', { cause });
        }
        let json;
        try {
            json = await response.json();
        } catch (cause) {
            throw new CatalogServiceError('INVALID_RESPONSE', 'Cost Catalog returned an invalid response.', {
                status: response.status, cause
            });
        }
        if (!response.ok || json?.status !== 'success') {
            throw new CatalogServiceError(json?.code || 'API_ERROR', json?.msg || 'Cost Catalog request failed.', {
                status: response.status, cause: json
            });
        }
        return json.data || {};
    }

    function normalizedItems(payload, options = {}) {
        const scoped = Boolean(options.catalogId || options.categoryId);
        const rawItems = scoped ? (payload.items || [])
            : (Array.isArray(payload.allItems) && payload.allItems.length ? payload.allItems : (payload.items || []));
        let items = rawItems.map(item => Contract.normalizeCatalogItem(item, {
            assemblyParts: payload.assemblyParts || []
        }));
        if (options.type) {
            const type = Contract.normalizeItemType(options.type);
            items = items.filter(item => item.type === type);
        }
        const query = String(options.query || '').trim().toLowerCase();
        if (query) items = items.filter(item => [
            item.name, item.description, item.catalog.name, item.category.name,
            item.supplier.catalogNumber, item.classification.costCode, item.uom, item.type
        ].join(' ').toLowerCase().includes(query));
        return items;
    }

    async function getSnapshot(options = {}) {
        const payload = await requestPayload(options);
        return {
            catalogs: (payload.catalogs || []).map(catalogDto),
            categories: (payload.groups || []).map(categoryDto),
            items: normalizedItems(payload, options),
            blockedAssemblies: Array.isArray(payload.blockedAssemblies) ? payload.blockedAssemblies : [],
            capabilities: payload.capabilities || {},
            availability: payload.availability || availabilityMode(options)
        };
    }

    async function listCatalogs(options = {}) {
        return (await getSnapshot(options)).catalogs;
    }

    async function listCategories(options = {}) {
        let categories = (await getSnapshot(options)).categories;
        if (options.catalogId) categories = categories.filter(row => row.catalogId === String(options.catalogId));
        return categories;
    }

    async function listItems(options = {}) {
        return (await getSnapshot(options)).items;
    }

    async function getItem(itemId, options = {}) {
        const item = (await listItems(options)).find(row => row.id === String(itemId));
        if (!item) throw new CatalogServiceError('ITEM_NOT_FOUND', 'Catalog item was not found.');
        return item;
    }

    async function searchItems(query, options = {}) {
        return listItems({ ...options, query });
    }

    async function getAssembly(itemId, options = {}) {
        const item = await getItem(itemId, options);
        if (item.type !== Contract.ITEM_TYPES.ASSEMBLY) {
            throw new CatalogServiceError('NOT_AN_ASSEMBLY', 'Catalog item is not an assembly.');
        }
        return item;
    }

    const api = {
        CatalogServiceError,
        getSnapshot,
        listCatalogs,
        listCategories,
        listItems,
        getItem,
        searchItems,
        getAssembly
    };
    global.CatalogService = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
