(function (global) {
    'use strict';

    const Contract = global.CatalogItemContract
        || (typeof require === 'function' ? require('./catalog_item_contract.js') : null);
    if (!Contract) throw new Error('CatalogItemContract must load before EstimatingCatalogAdapter');

    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const legacyId = value => /^\d+$/.test(String(value || '')) ? Number(value) : value;

    function estimatingCategory(dto) {
        return {
            [Contract.ITEM_TYPES.PART]: 'Materials',
            [Contract.ITEM_TYPES.EQUIPMENT]: 'Equipment',
            [Contract.ITEM_TYPES.LABOR]: 'Labor',
            [Contract.ITEM_TYPES.ASSEMBLY]: 'Assembly',
            [Contract.ITEM_TYPES.SUBCONTRACTOR]: 'Subcontractor',
            [Contract.ITEM_TYPES.TRAVEL]: 'Other',
            [Contract.ITEM_TYPES.CUSTOM]: 'Other',
            [Contract.ITEM_TYPES.OTHER]: 'Other'
        }[dto.type] || 'Other';
    }

    function laborRate(dto, globalLaborRate) {
        const explicit = number(dto.pricing.laborRate);
        return explicit > 0 ? explicit : number(globalLaborRate);
    }

    function dtoPricing(dto) {
        return {
            unitMaterialCost: dto.type === Contract.ITEM_TYPES.PART
                ? number(dto.pricing.materialUnitCost)
                : (dto.type === Contract.ITEM_TYPES.ASSEMBLY ? number(dto.pricing.legacyUnitCost) : 0),
            unitEquipmentCost: dto.type === Contract.ITEM_TYPES.EQUIPMENT
                ? number(dto.pricing.equipmentUnitCost) : 0,
            unitLabor: number(dto.pricing.laborHoursPerUnit),
            laborUnitType: 'hrs'
        };
    }

    function assemblyComponentDtoToEstimatingChild(component, context = {}) {
        const childDto = context.itemsById?.get(String(component.catalogItemId)) || null;
        const snapshot = component.pricingSnapshot || {};
        const fallbackType = snapshot.equipmentUnitCost > 0
            ? Contract.ITEM_TYPES.EQUIPMENT : Contract.ITEM_TYPES.PART;
        const type = childDto?.type || fallbackType;
        const category = childDto ? estimatingCategory(childDto)
            : (type === Contract.ITEM_TYPES.EQUIPMENT ? 'Equipment' : 'Materials');
        return {
            catalogItemId: legacyId(component.catalogItemId),
            itemType: type.toLowerCase(),
            isAssembly: type === Contract.ITEM_TYPES.ASSEMBLY,
            name: childDto?.name || 'Assembly part',
            description: childDto?.description || '',
            costCode: childDto?.classification?.costCode || '',
            costCategory: category,
            uom: childDto?.uom || 'ea',
            quantity: number(component.quantity),
            unitMaterialCost: type === Contract.ITEM_TYPES.PART
                ? number(childDto?.pricing?.materialUnitCost ?? snapshot.materialUnitCost) : 0,
            unitEquipmentCost: type === Contract.ITEM_TYPES.EQUIPMENT
                ? number(childDto?.pricing?.equipmentUnitCost ?? snapshot.equipmentUnitCost) : 0,
            equipmentQuantity: 0,
            unitLabor: number(childDto?.pricing?.laborHoursPerUnit ?? snapshot.laborHoursPerUnit),
            laborUnitType: 'hrs',
            laborRate: laborRate(childDto || { pricing: snapshot }, context.globalLaborRate)
        };
    }

    function catalogItemDtoToEstimatingInput(dto, options = {}) {
        const itemsById = options.itemsById || new Map();
        const children = dto.type === Contract.ITEM_TYPES.ASSEMBLY
            ? dto.assemblyComponents.map(component => assemblyComponentDtoToEstimatingChild(component, {
                itemsById,
                globalLaborRate: options.globalLaborRate
            }))
            : [];
        return {
            catalogItemId: legacyId(dto.id),
            itemType: dto.type.toLowerCase(),
            isAssembly: dto.type === Contract.ITEM_TYPES.ASSEMBLY,
            name: dto.name,
            description: dto.description,
            budgetCode: '',
            costCode: dto.classification.costCode || dto.supplier.catalogNumber || '',
            costCategory: estimatingCategory(dto),
            uom: dto.uom,
            quantity: 0,
            ...dtoPricing(dto),
            equipmentQuantity: 0,
            laborRate: laborRate(dto, options.globalLaborRate),
            children,
            childrenQuantitiesExtended: false
        };
    }

    function catalogItemDtoToEstimatingItem(dto, options = {}) {
        const input = catalogItemDtoToEstimatingInput(dto, options);
        if (typeof options.workspaceItem !== 'function') return input;
        const normalized = options.workspaceItem(input);
        // Workspace's legacy category normalizer defaults unknown values to
        // Materials. Restore the explicit DTO classification at this boundary.
        normalized.costCategory = input.costCategory;
        normalized.children.forEach((child, index) => {
            child.costCategory = input.children[index]?.costCategory || 'Other';
        });
        return normalized;
    }

    const api = {
        estimatingCategory,
        assemblyComponentDtoToEstimatingChild,
        catalogItemDtoToEstimatingInput,
        catalogItemDtoToEstimatingItem
    };
    global.EstimatingCatalogAdapter = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
