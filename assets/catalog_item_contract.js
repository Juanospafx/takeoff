(function (global) {
    'use strict';

    const ITEM_TYPES = Object.freeze({
        PART: 'PART',
        ASSEMBLY: 'ASSEMBLY',
        EQUIPMENT: 'EQUIPMENT',
        LABOR: 'LABOR',
        SUBCONTRACTOR: 'SUBCONTRACTOR',
        TRAVEL: 'TRAVEL',
        CUSTOM: 'CUSTOM',
        OTHER: 'OTHER'
    });

    const COST_CATEGORIES = Object.freeze({
        MATERIAL: 'material',
        LABOR: 'labor',
        EQUIPMENT: 'equipment',
        SUBCONTRACTOR: 'subcontractor',
        OTHER: 'other',
        ASSEMBLY: 'assembly'
    });

    const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
    const text = value => value === null || value === undefined ? '' : String(value).trim();
    const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const nullableId = value => text(value) || null;
    const firstDefined = (source, keys, fallback = undefined) => {
        for (const key of keys) if (own(source, key) && source[key] !== null && source[key] !== '') return source[key];
        return fallback;
    };

    function parseJson(value, fallback) {
        if (value === null || value === undefined || value === '') return fallback;
        if (typeof value !== 'string') return value;
        try { return JSON.parse(value); } catch (_) { return fallback; }
    }

    function normalizeItemType(value) {
        const raw = text(value).toLowerCase().replace(/[\s-]+/g, '_');
        if (raw === 'part' || raw === 'material') return ITEM_TYPES.PART;
        if (raw === 'assembly') return ITEM_TYPES.ASSEMBLY;
        if (raw === 'equipment') return ITEM_TYPES.EQUIPMENT;
        if (raw === 'labor' || raw === 'labour') return ITEM_TYPES.LABOR;
        if (raw === 'subcontractor' || raw === 'subcontract') return ITEM_TYPES.SUBCONTRACTOR;
        if (raw === 'travel') return ITEM_TYPES.TRAVEL;
        if (raw === 'custom') return ITEM_TYPES.CUSTOM;
        return ITEM_TYPES.OTHER;
    }

    function normalizeCostCategory(value, itemType) {
        const raw = text(value).toLowerCase().replace(/[\s-]+/g, '_');
        const explicit = {
            material: COST_CATEGORIES.MATERIAL,
            materials: COST_CATEGORIES.MATERIAL,
            part: COST_CATEGORIES.MATERIAL,
            labor: COST_CATEGORIES.LABOR,
            labour: COST_CATEGORIES.LABOR,
            equipment: COST_CATEGORIES.EQUIPMENT,
            subcontractor: COST_CATEGORIES.SUBCONTRACTOR,
            subcontract: COST_CATEGORIES.SUBCONTRACTOR,
            assembly: COST_CATEGORIES.ASSEMBLY,
            other: COST_CATEGORIES.OTHER
        }[raw];
        if (explicit) return explicit;
        return {
            [ITEM_TYPES.PART]: COST_CATEGORIES.MATERIAL,
            [ITEM_TYPES.LABOR]: COST_CATEGORIES.LABOR,
            [ITEM_TYPES.EQUIPMENT]: COST_CATEGORIES.EQUIPMENT,
            [ITEM_TYPES.SUBCONTRACTOR]: COST_CATEGORIES.SUBCONTRACTOR,
            [ITEM_TYPES.ASSEMBLY]: COST_CATEGORIES.ASSEMBLY
        }[itemType] || COST_CATEGORIES.OTHER;
    }

    function normalizeMeasurementType(value) {
        const raw = text(value).toLowerCase().replace(/[\s-]+/g, '_');
        if (['count', 'linear', 'area', 'volume'].includes(raw)) return raw;
        return null;
    }

    function normalizeAttributes(raw) {
        const value = parseJson(firstDefined(raw, ['attributes', 'attributes_json']), {});
        if (!Array.isArray(value)) return value && typeof value === 'object' ? { ...value } : {};
        return value.reduce((result, attribute) => {
            if (!attribute || typeof attribute !== 'object') return result;
            const key = text(attribute.name ?? attribute.attribute_name);
            if (!key) return result;
            result[key] = {
                value: attribute.value ?? attribute.attribute_value ?? null,
                type: text(attribute.type ?? attribute.value_type) || 'string',
                uom: text(attribute.uom ?? attribute.unit_of_measure) || null
            };
            return result;
        }, {});
    }

    function normalizeTags(raw) {
        const value = parseJson(firstDefined(raw, ['tags', 'tags_json']), []);
        if (!Array.isArray(value)) return [];
        return value.map(tag => typeof tag === 'object' && tag !== null
            ? { ...tag }
            : text(tag)).filter(Boolean);
    }

    function normalizeAssemblyComponent(raw = {}) {
        return {
            id: nullableId(raw.id),
            catalogItemId: nullableId(raw.catalogItemId ?? raw.catalog_item_id ?? raw.part_catalog_item_id),
            quantity: number(raw.quantity, 1),
            ratioType: text(raw.ratioType ?? raw.ratio_type) || 'per_unit',
            spacing: firstDefined(raw, ['spacing', 'spacingValue', 'spacing_value'], null) === null
                ? null : number(firstDefined(raw, ['spacing', 'spacingValue', 'spacing_value'])),
            waste: number(raw.waste ?? raw.wasteFactorPercent ?? raw.waste_factor_percent),
            pricingSnapshot: {
                materialUnitCost: number(firstDefined(raw, ['materialUnitCost', 'material_unit_cost', 'unit_cost_snapshot'])),
                equipmentUnitCost: number(firstDefined(raw, ['equipmentUnitCost', 'equipment_unit_cost', 'equipment_cost_snapshot'])),
                subcontractorUnitCost: number(firstDefined(raw, ['subcontractorUnitCost', 'subcontractor_unit_cost', 'subcontractor_cost_snapshot'])),
                laborHoursPerUnit: number(firstDefined(raw, ['laborHoursPerUnit', 'labor_hours_per_unit', 'unit_labor_time_snapshot'])),
                laborRate: number(firstDefined(raw, ['laborRate', 'labor_rate', 'labor_rate_snapshot']))
            },
            overrides: raw.overrides && typeof raw.overrides === 'object'
                ? { ...raw.overrides }
                : parseJson(raw.overrides_json, {})
        };
    }

    function componentsFor(raw, options) {
        const embedded = firstDefined(raw, ['assemblyComponents', 'assembly_components', 'assemblyParts', 'assembly_parts', 'components']);
        if (Array.isArray(embedded)) return embedded;
        const parts = Array.isArray(options?.assemblyParts) ? options.assemblyParts : [];
        return parts.filter(part => String(part.assembly_catalog_item_id ?? part.assemblyCatalogItemId ?? '') === String(raw.id ?? ''));
    }

    function normalizePricing(raw, type) {
        const genericUnitCost = firstDefined(raw, ['unit_cost', 'unitCost'], 0);
        const materialUnitCost = type === ITEM_TYPES.PART
            ? firstDefined(raw, ['materialUnitCost', 'material_unit_cost', 'unit_cost', 'unitCost', 'material_cost'], 0)
            : firstDefined(raw, ['materialUnitCost', 'material_unit_cost'], 0);
        const equipmentUnitCost = type === ITEM_TYPES.EQUIPMENT
            ? firstDefined(raw, ['equipmentUnitCost', 'equipment_unit_cost', 'unit_cost', 'unitCost', 'equipment_cost'], 0)
            : firstDefined(raw, ['equipmentUnitCost', 'equipment_unit_cost', 'equipment_cost'], 0);
        const subcontractorUnitCost = type === ITEM_TYPES.SUBCONTRACTOR
            ? firstDefined(raw, ['subcontractorUnitCost', 'subcontractor_unit_cost', 'unit_cost', 'unitCost', 'subcontractor_cost'], 0)
            : firstDefined(raw, ['subcontractorUnitCost', 'subcontractor_unit_cost', 'subcontractor_cost'], 0);
        return {
            materialUnitCost: number(materialUnitCost),
            equipmentUnitCost: number(equipmentUnitCost),
            subcontractorUnitCost: number(subcontractorUnitCost),
            laborHoursPerUnit: number(firstDefined(raw, ['laborHoursPerUnit', 'labor_hours_per_unit', 'labor_hours', 'laborHours'])),
            laborRate: number(firstDefined(raw, ['laborRate', 'labor_rate'])),
            // Kept only as an explicit compatibility trace for types whose old
            // generic unit_cost cannot be assigned safely to a canonical bucket.
            legacyUnitCost: [ITEM_TYPES.PART, ITEM_TYPES.EQUIPMENT, ITEM_TYPES.SUBCONTRACTOR].includes(type)
                ? 0 : number(genericUnitCost)
        };
    }

    function normalizeCatalogItem(raw = {}, options = {}) {
        const type = normalizeItemType(raw.type ?? raw.item_type);
        const costCategory = normalizeCostCategory(raw.costCategory ?? raw.cost_category ?? raw.cost_type, type);
        return {
            id: nullableId(raw.id),
            revision: firstDefined(raw, ['revision', 'updated_at', 'updatedAt'], null),
            type,
            costCategory,
            name: text(raw.name),
            description: text(raw.description),
            uom: text(raw.uom ?? raw.unit_of_measure) || 'ea',
            catalog: {
                id: nullableId(raw.catalog?.id ?? raw.catalog_id),
                name: text(raw.catalog?.name ?? raw.catalog_name)
            },
            category: {
                id: nullableId(raw.category?.id ?? raw.catalog_group_id ?? raw.category_id),
                name: text(raw.category?.name ?? raw.group_name ?? raw.category_name)
            },
            classification: {
                masterformat: text(raw.classification?.masterformat ?? raw.masterformat),
                uniformat: text(raw.classification?.uniformat ?? raw.uniformat),
                costCode: text(raw.classification?.costCode ?? raw.costCode ?? raw.cost_code),
                subJobCode: text(raw.classification?.subJobCode ?? raw.subJobCode ?? raw.sub_job_code),
                subJobName: text(raw.classification?.subJobName ?? raw.subJobName ?? raw.sub_job_name)
            },
            pricing: normalizePricing(raw.pricing && typeof raw.pricing === 'object' ? { ...raw, ...raw.pricing } : raw, type),
            waste: number(raw.waste ?? raw.wasteFactorPercent ?? raw.waste_factor_percent),
            markup: number(raw.markup ?? raw.markupPercent ?? raw.markup_percent),
            taxable: raw.taxable === undefined || raw.taxable === null
                ? true : !['0', 'false', 'no'].includes(String(raw.taxable).toLowerCase()),
            supplier: {
                manufacturer: text(raw.supplier?.manufacturer ?? raw.manufacturer),
                supplier: text(raw.supplier?.supplier ?? raw.supplier_name ?? (typeof raw.supplier === 'string' ? raw.supplier : '')),
                catalogNumber: text(raw.supplier?.catalogNumber ?? raw.catalogNumber ?? raw.catalog_number ?? raw.sku)
            },
            takeoffDefaults: {
                measurementType: normalizeMeasurementType(raw.takeoffDefaults?.measurementType
                    ?? raw.measurement_type ?? raw.takeoff_type),
                symbol: text(raw.takeoffDefaults?.symbol ?? raw.symbol) || null,
                color: text(raw.takeoffDefaults?.color ?? raw.color) || null
            },
            attributes: normalizeAttributes(raw),
            tags: normalizeTags(raw),
            assemblyComponents: componentsFor(raw, options).map(normalizeAssemblyComponent),
            legacy: {
                itemType: text(raw.item_type),
                costType: text(raw.cost_type)
            }
        };
    }

    const api = {
        ITEM_TYPES,
        COST_CATEGORIES,
        normalizeItemType,
        normalizeCostCategory,
        normalizeAssemblyComponent,
        normalizeCatalogItem,
        fromApi: normalizeCatalogItem
    };

    global.CatalogItemContract = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
