(function (global) {
    'use strict';

    const Contract = global.CatalogItemContract
        || (typeof require === 'function' ? require('./catalog_item_contract.js') : null);

    if (!Contract) throw new Error('CatalogItemContract must load before TakeoffCatalogAdapter');

    function number(value) {
        return Number.isFinite(Number(value)) ? Number(value) : 0;
    }

    function legacyUnitCost(dto) {
        if (dto.type === Contract.ITEM_TYPES.PART) return number(dto.pricing.materialUnitCost);
        if (dto.type === Contract.ITEM_TYPES.EQUIPMENT) return number(dto.pricing.equipmentUnitCost);
        if (dto.type === Contract.ITEM_TYPES.SUBCONTRACTOR) return number(dto.pricing.subcontractorUnitCost);
        return number(dto.pricing.legacyUnitCost);
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
        const unitCost = legacyUnitCost(dto);
        const laborHours = number(dto.pricing.laborHoursPerUnit);
        const metadata = {
            schema: 'CatalogItemDTO/v1',
            type: dto.type,
            costCategory: dto.costCategory,
            revision: dto.revision,
            pricing: { ...dto.pricing },
            assemblyComponents: dto.assemblyComponents.map(component => ({ ...component }))
        };
        return {
            catalogItemId: dto.id,
            catalog_item_id: dto.id,
            unitCost,
            unit_cost: unitCost,
            laborHours,
            labor_hours: laborHours,
            laborRate: number(dto.pricing.laborRate),
            category: dto.category.name || dto.catalog.name || '',
            description: dto.description,
            catalogName: dto.catalog.name,
            catalogGroupName: dto.category.name,
            catalogNumber: dto.supplier.catalogNumber || dto.classification.costCode || '',
            itemType: dto.type,
            costCategory: dto.costCategory,
            equipmentUnitCost: number(dto.pricing.equipmentUnitCost),
            materialUnitCost: number(dto.pricing.materialUnitCost),
            catalogMetadata: metadata,
            metadata_json: { catalog_item: metadata }
        };
    }

    const api = { catalogItemDtoToLegacyLayerMeta, measurementType, legacyUnitCost };
    global.TakeoffCatalogAdapter = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
