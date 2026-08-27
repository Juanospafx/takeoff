(function (global) {
    'use strict';

    const CONTRACT_VERSION = 'CatalogItemDTO/v1';
    const FIELDS = Object.freeze([
        'materialUnitCost', 'equipmentUnitCost', 'subcontractorUnitCost',
        'laborHoursPerUnit', 'laborRate'
    ]);
    const LEGACY_FIELDS = Object.freeze({
        materialUnitCost: 'unitMaterialCost',
        equipmentUnitCost: 'unitEquipmentCost',
        subcontractorUnitCost: 'unitSubcontractorCost',
        laborHoursPerUnit: 'unitLabor',
        laborRate: 'laborRate'
    });
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const present = value => value !== null && value !== undefined;

    function emptyOverrides() {
        return Object.fromEntries(FIELDS.map(field => [field, null]));
    }

    function normalizeOverrides(value) {
        const result = emptyOverrides();
        if (!value || typeof value !== 'object') return result;
        FIELDS.forEach(field => { result[field] = present(value[field]) ? numeric(value[field]) : null; });
        return result;
    }

    function snapshotInput(source) {
        if (!source || typeof source !== 'object') return null;
        const pricing = source.pricing || {};
        const id = source.catalogItemId ?? source.catalog_item_id ?? source.id ?? null;
        if (id === null || id === undefined || id === '') return null;
        return {
            contractVersion: source.contractVersion || source.schema || CONTRACT_VERSION,
            catalogItemId: id,
            revision: source.revision ?? source.catalogRevision ?? null,
            type: source.type || source.itemType || null,
            costCategory: source.costCategory ?? source.classification?.costCategory ?? null,
            uom: source.uom ?? source.unitOfMeasure ?? null,
            pricing: {
                materialUnitCost: numeric(pricing.materialUnitCost),
                equipmentUnitCost: numeric(pricing.equipmentUnitCost),
                subcontractorUnitCost: numeric(pricing.subcontractorUnitCost),
                laborHoursPerUnit: numeric(pricing.laborHoursPerUnit),
                laborRate: numeric(pricing.laborRate)
            },
            assemblyComponents: clone(source.assemblyComponents || []),
            catalog: clone(source.catalog || null),
            category: clone(source.category || null)
        };
    }

    function createCatalogSnapshot(dto) {
        return snapshotInput(dto);
    }

    function hasCatalogOverride(item, field) {
        return FIELDS.includes(field) && present(item?.overrides?.[field]);
    }

    function getEffectiveCatalogValue(item, field) {
        if (!FIELDS.includes(field)) throw new Error(`Unsupported catalog override field: ${field}`);
        if (hasCatalogOverride(item, field)) return numeric(item.overrides[field]);
        if (item?.catalogSnapshot?.pricing && present(item.catalogSnapshot.pricing[field])) {
            return numeric(item.catalogSnapshot.pricing[field]);
        }
        return numeric(item?.[LEGACY_FIELDS[field]]);
    }

    function refreshEffectiveLegacyFields(item) {
        if (!item || typeof item !== 'object') return item;
        if (!item.catalogSnapshot && !FIELDS.some(field => hasCatalogOverride(item, field))) return item;
        FIELDS.forEach(field => { item[LEGACY_FIELDS[field]] = getEffectiveCatalogValue(item, field); });
        item.laborUnitType = 'hrs';
        return item;
    }

    function attachCatalogSnapshot(item, dto) {
        const snapshot = createCatalogSnapshot(dto);
        if (!snapshot) return item;
        item.catalogItemId = snapshot.catalogItemId;
        item.catalogRevision = snapshot.revision;
        item.catalogSnapshot = clone(snapshot);
        item.overrides = normalizeOverrides(item.overrides);
        return refreshEffectiveLegacyFields(item);
    }

    function attachCatalogMetadata(item, metadata) {
        return attachCatalogSnapshot(item, metadata);
    }

    function setCatalogOverride(item, field, value) {
        if (!FIELDS.includes(field)) throw new Error(`Unsupported catalog override field: ${field}`);
        item.overrides = normalizeOverrides(item.overrides);
        item.overrides[field] = present(value) ? numeric(value) : null;
        return refreshEffectiveLegacyFields(item);
    }

    function clearCatalogOverride(item, field) {
        return setCatalogOverride(item, field, null);
    }

    function normalizeItemCatalogState(item) {
        if (!item || typeof item !== 'object') return item;
        item.catalogRevision = item.catalogRevision ?? item.catalogSnapshot?.revision ?? null;
        item.catalogSnapshot = item.catalogSnapshot ? clone(item.catalogSnapshot) : null;
        item.overrides = normalizeOverrides(item.overrides);
        return refreshEffectiveLegacyFields(item);
    }

    const api = {
        CONTRACT_VERSION, FIELDS, LEGACY_FIELDS, emptyOverrides, createCatalogSnapshot,
        attachCatalogSnapshot, attachCatalogMetadata, setCatalogOverride, clearCatalogOverride,
        hasCatalogOverride, getEffectiveCatalogValue, refreshEffectiveLegacyFields,
        normalizeItemCatalogState,
        effectiveMaterialUnitCost: item => getEffectiveCatalogValue(item, 'materialUnitCost'),
        effectiveEquipmentUnitCost: item => getEffectiveCatalogValue(item, 'equipmentUnitCost'),
        effectiveSubcontractorUnitCost: item => getEffectiveCatalogValue(item, 'subcontractorUnitCost'),
        effectiveLaborHoursPerUnit: item => getEffectiveCatalogValue(item, 'laborHoursPerUnit'),
        effectiveLaborRate: item => getEffectiveCatalogValue(item, 'laborRate')
    };
    global.EstimatingCatalogSnapshotService = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
