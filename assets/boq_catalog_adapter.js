(function (global) {
    'use strict';

    const Contract = global.CatalogItemContract
        || (typeof require === 'function' ? require('./catalog_item_contract.js') : null);
    if (!Contract) throw new Error('CatalogItemContract must load before BoqCatalogAdapter');

    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const text = value => value === null || value === undefined ? '' : String(value);
    const clone = value => {
        if (Array.isArray(value)) return value.map(clone);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
    };

    function categoryForType(type) {
        return {
            [Contract.ITEM_TYPES.PART]: Contract.COST_CATEGORIES.MATERIAL,
            [Contract.ITEM_TYPES.EQUIPMENT]: Contract.COST_CATEGORIES.EQUIPMENT,
            [Contract.ITEM_TYPES.LABOR]: Contract.COST_CATEGORIES.LABOR,
            [Contract.ITEM_TYPES.ASSEMBLY]: Contract.COST_CATEGORIES.ASSEMBLY
        }[type] || Contract.COST_CATEGORIES.OTHER;
    }

    function fallbackComponent(component = {}) {
        const snapshot = component.pricingSnapshot || {};
        return {
            catalogItemId: component.catalogItemId,
            itemType: Contract.ITEM_TYPES.OTHER,
            type: Contract.ITEM_TYPES.OTHER,
            isAssembly: false,
            costCategory: Contract.COST_CATEGORIES.OTHER,
            name: 'Assembly component',
            description: '',
            uom: 'ea',
            quantity: number(component.quantity),
            unitMaterialCost: number(snapshot.materialUnitCost),
            unitEquipmentCost: number(snapshot.equipmentUnitCost),
            unitLabor: number(snapshot.laborHoursPerUnit),
            laborUnitType: 'hrs',
            laborRate: number(snapshot.laborRate),
            assemblyComponent: clone(component)
        };
    }

    function assemblyComponentDtoToBoqLine(component, context = {}) {
        const childDto = context.itemsById?.get(text(component?.catalogItemId)) || null;
        if (!childDto) return fallbackComponent(component);
        const ancestry = new Set(context.ancestry || []);
        const child = catalogItemDtoToBoqItem(childDto, { ...context, ancestry });
        child.quantity = number(component.quantity);
        child.assemblyComponent = clone(component);
        return child;
    }

    function catalogItemDtoToBoqItem(dto, context = {}) {
        const type = dto?.type || Contract.ITEM_TYPES.OTHER;
        const id = text(dto?.id);
        const ancestry = new Set(context.ancestry || []);
        const cyclic = Boolean(id && ancestry.has(id));
        if (id) ancestry.add(id);
        const item = {
            catalogItemId: dto?.id ?? null,
            catalogRevision: dto?.revision ?? null,
            itemType: type,
            type,
            isAssembly: type === Contract.ITEM_TYPES.ASSEMBLY,
            costCategory: categoryForType(type),
            name: dto?.name || '',
            description: dto?.description || '',
            uom: dto?.uom || 'ea',
            budgetCode: dto?.classification?.subJobCode || '',
            costCode: dto?.classification?.costCode || '',
            manufacturer: dto?.supplier?.manufacturer || '',
            catalogNumber: dto?.supplier?.catalogNumber || '',
            catalog: clone(dto?.catalog || {}),
            category: clone(dto?.category || {}),
            catalogPath: [dto?.catalog?.name, dto?.category?.name].filter(Boolean).join(' / '),
            unitLabor: number(dto?.pricing?.laborHoursPerUnit),
            laborUnitType: 'hrs',
            laborRate: number(dto?.pricing?.laborRate),
            quantity: number(context.quantity)
        };
        if (type === Contract.ITEM_TYPES.PART) {
            item.unitMaterialCost = number(dto?.pricing?.materialUnitCost);
        } else if (type === Contract.ITEM_TYPES.EQUIPMENT) {
            item.unitEquipmentCost = number(dto?.pricing?.equipmentUnitCost);
        }
        item.children = type === Contract.ITEM_TYPES.ASSEMBLY && !cyclic
            ? (dto?.assemblyComponents || []).map(component => assemblyComponentDtoToBoqLine(component, {
                ...context, ancestry
            }))
            : [];
        return item;
    }

    function hydrateEstimate(estimate, catalogSnapshot = {}) {
        const result = clone(estimate || {});
        const itemsById = new Map((catalogSnapshot.items || []).map(item => [text(item.id), item]));

        function hydrate(item, ancestry = new Set()) {
            const catalogItem = itemsById.get(text(item?.catalogItemId ?? item?.catalog_item_id));
            if (catalogItem) {
                const mapped = catalogItemDtoToBoqItem(catalogItem, { itemsById, ancestry });
                const existingChildren = Array.isArray(item.children) && item.children.length
                    ? item.children : (Array.isArray(item.assemblyItems) && item.assemblyItems.length
                        ? item.assemblyItems : null);
                const identity = { id: item.id, quantity: item.quantity };
                Object.assign(item, mapped, identity);
                if (existingChildren) item.children = existingChildren;
            }
            (item.children || item.assemblyItems || []).forEach(child => hydrate(child, ancestry));
            return item;
        }

        (result.groups || []).forEach(group => (group.items || []).forEach(item => hydrate(item)));
        return result;
    }

    const api = {
        categoryForType,
        catalogItemDtoToBoqItem,
        assemblyComponentDtoToBoqLine,
        hydrateEstimate
    };
    global.BoqCatalogAdapter = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
