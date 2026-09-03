(function (global) {
    'use strict';

    const Contract = global.CatalogItemContract
        || (typeof require === 'function' ? require('./catalog_item_contract.js') : null);
    const Metadata = global.CatalogMetadata
        || (typeof require === 'function' ? require('./catalog_metadata.js') : null);

    if (!Contract || !Metadata) throw new Error('CatalogItemContract and CatalogMetadata must load before TakeoffCatalogAdapter');

    function number(value) {
        return Number.isFinite(Number(value)) ? Number(value) : 0;
    }

    function legacyUnitCost(dto) {
        if (!dto) return 0;
        if (dto.unit_cost !== undefined) return number(dto.unit_cost);
        if (dto.unitCost !== undefined) return number(dto.unitCost);
        const pricing = dto.pricing || {};
        if (dto.type === Contract.ITEM_TYPES.PART) return number(pricing.materialUnitCost ?? pricing.legacyUnitCost);
        if (dto.type === Contract.ITEM_TYPES.EQUIPMENT) return number(pricing.equipmentUnitCost ?? pricing.legacyUnitCost);
        if (dto.type === Contract.ITEM_TYPES.SUBCONTRACTOR) return number(pricing.subcontractorUnitCost ?? pricing.legacyUnitCost);
        return number(pricing.legacyUnitCost ?? pricing.materialUnitCost);
    }

    function measurementType(dto, legacyFallback = '') {
        const canonical = String(dto?.takeoffDefaults?.measurementType || '').toLowerCase();
        if (canonical === 'count') return 'Count';
        if (canonical === 'linear') return 'Linear';
        if (canonical === 'area' || canonical === 'volume') return 'Area / Volume';
        return legacyFallback;
    }

    // Transitional boundary only. The persisted Takeoff layer still has one
    // generic unitCost field, so Equipment uses it while catalogMetadata keeps
    // the canonical cost bucket and type available for a later layer migration.
    function catalogItemDtoToLegacyLayerMeta(dto) {
        if (!dto) return {};
        const unitCost = legacyUnitCost(dto);
        const pricing = dto.pricing || {};
        const laborHours = number(pricing.laborHoursPerUnit ?? dto.labor_hours ?? dto.laborHours);
        const metadata = {
            schema: 'CatalogItemDTO/v1',
            catalogItemId: dto.id,
            catalogRevision: dto.revision,
            type: dto.type,
            costCategory: dto.costCategory,
            pricing: Metadata.clone(dto.pricing),
            takeoffDefaults: Metadata.clone(dto.takeoffDefaults),
            assemblyComponents: Metadata.clone(dto.assemblyComponents),
            catalog: Metadata.clone(dto.catalog),
            category: Metadata.clone(dto.category)
        };
        return {
            catalogItemId: dto.id,
            catalog_item_id: dto.id,
            unitCost,
            unit_cost: unitCost,
            laborHours,
            labor_hours: laborHours,
            laborRate: number(pricing.laborRate ?? dto.laborRate),
            category: dto.category?.name || dto.catalog?.name || (typeof dto.category === 'string' ? dto.category : '') || '',
            description: dto.description || '',
            catalogName: dto.catalog?.name || (typeof dto.catalog === 'string' ? dto.catalog : '') || '',
            catalogGroupName: dto.category?.name || (typeof dto.category === 'string' ? dto.category : '') || '',
            catalogNumber: dto.supplier?.catalogNumber || dto.classification?.costCode || dto.catalog_number || '',
            itemType: dto.type || 'material',
            costCategory: dto.costCategory || '',
            equipmentUnitCost: number(pricing.equipmentUnitCost),
            materialUnitCost: number(pricing.materialUnitCost ?? unitCost),
            catalogMetadata: Metadata.clone(metadata),
            metadata_json: { catalog_item: Metadata.clone(metadata) }
        };
    }

    const api = { catalogItemDtoToLegacyLayerMeta, measurementType, legacyUnitCost };
    global.TakeoffCatalogAdapter = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
