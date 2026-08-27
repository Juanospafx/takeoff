(function (global) {
    'use strict';

    const RATIO_TYPES = Object.freeze({
        FIXED: 'FIXED',
        PER_UNIT: 'PER_UNIT',
        PER_LINEAR: 'PER_LINEAR',
        PER_AREA: 'PER_AREA',
        PER_ENDPOINT: 'PER_ENDPOINT',
        SPACING: 'SPACING'
    });
    const PRICING_SOURCES = Object.freeze({
        CURRENT_CATALOG: 'CURRENT_CATALOG',
        SNAPSHOT: 'SNAPSHOT'
    });
    const aliases = Object.freeze({
        fixed: RATIO_TYPES.FIXED,
        per_unit: RATIO_TYPES.PER_UNIT,
        perunit: RATIO_TYPES.PER_UNIT,
        unit: RATIO_TYPES.PER_UNIT,
        per_linear: RATIO_TYPES.PER_LINEAR,
        per_linear_length: RATIO_TYPES.PER_LINEAR,
        linear: RATIO_TYPES.PER_LINEAR,
        per_area: RATIO_TYPES.PER_AREA,
        area: RATIO_TYPES.PER_AREA,
        per_endpoint: RATIO_TYPES.PER_ENDPOINT,
        endpoint: RATIO_TYPES.PER_ENDPOINT,
        spacing: RATIO_TYPES.SPACING,
        spacing_based: RATIO_TYPES.SPACING
    });

    const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const text = value => value === null || value === undefined ? '' : String(value);
    const clone = value => {
        if (Array.isArray(value)) return value.map(clone);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
    };

    function normalizeRatioType(value) {
        const normalized = text(value || 'per_unit').trim().toLowerCase().replace(/[\s-]+/g, '_');
        return aliases[normalized] || RATIO_TYPES.PER_UNIT;
    }

    function catalogLookup(index) {
        if (index instanceof Map) return id => index.get(id) || index.get(text(id))
            || (/^\d+$/.test(text(id)) ? index.get(Number(id)) : null) || null;
        if (Array.isArray(index)) {
            const mapped = new Map(index.map(item => [text(item?.id), item]));
            return id => mapped.get(text(id)) || null;
        }
        if (index && typeof index === 'object') return id => index[id] || index[text(id)] || null;
        return () => null;
    }

    function ratioBasis(ratioType, component, measuredQuantity, context, errors, path) {
        if (ratioType === RATIO_TYPES.FIXED) return { baseQuantity: 1, measurementQuantity: measuredQuantity };
        if (ratioType === RATIO_TYPES.PER_UNIT) {
            return { baseQuantity: measuredQuantity, measurementQuantity: measuredQuantity };
        }
        const required = ratioType === RATIO_TYPES.PER_LINEAR || ratioType === RATIO_TYPES.SPACING
            ? 'linearLength' : (ratioType === RATIO_TYPES.PER_AREA ? 'area' : 'endpointCount');
        if (context[required] === null || context[required] === undefined || context[required] === '') {
            errors.push({ code: 'MISSING_RATIO_INPUT', ratioType, field: required, path: [...path] });
            return { baseQuantity: 0, measurementQuantity: null };
        }
        const measurementQuantity = numeric(context[required]);
        if (ratioType !== RATIO_TYPES.SPACING) {
            return { baseQuantity: measurementQuantity, measurementQuantity };
        }
        const spacing = Math.max(numeric(component?.spacing, 0), 1);
        return {
            baseQuantity: Math.ceil(measurementQuantity / spacing),
            measurementQuantity,
            spacing
        };
    }

    function selectedPricing(sourceItem, component, pricingSource) {
        const snapshot = clone(component?.pricingSnapshot || {});
        const current = clone(sourceItem?.pricing || {});
        return {
            pricingSource,
            pricing: pricingSource === PRICING_SOURCES.SNAPSHOT ? snapshot : (sourceItem ? current : snapshot),
            pricingSnapshot: snapshot,
            currentCatalogPricing: current
        };
    }

    function expandAssembly(assembly, measuredQuantity, context = {}) {
        const components = [];
        const warnings = [];
        const errors = [];
        const lookup = catalogLookup(context.catalogIndex);
        const pricingSource = context.pricingSource === PRICING_SOURCES.SNAPSHOT
            ? PRICING_SOURCES.SNAPSHOT : PRICING_SOURCES.CURRENT_CATALOG;
        const rootId = text(assembly?.id) || 'UNKNOWN_ASSEMBLY';
        const rootType = text(assembly?.type ?? assembly?.itemType).toUpperCase();
        if (rootType && rootType !== 'ASSEMBLY') {
            errors.push({ code: 'NOT_AN_ASSEMBLY', assemblyId: rootId, path: [rootId] });
        }

        function visit(currentAssembly, currentMeasuredQuantity, depth, path, ancestry) {
            (currentAssembly?.assemblyComponents || []).forEach((component, index) => {
                const catalogItemId = text(component?.catalogItemId);
                const componentId = text(component?.id) || `${text(currentAssembly?.id)}:${catalogItemId || index}`;
                const sourceItem = catalogItemId ? lookup(catalogItemId) : null;
                const nodeId = catalogItemId || componentId;
                const nodePath = [...path, nodeId];
                const ratioType = normalizeRatioType(component?.ratioType);
                const componentQuantity = component?.quantity === null || component?.quantity === undefined
                    ? 1 : numeric(component.quantity);
                const basis = ratioBasis(ratioType, component, currentMeasuredQuantity, context, errors, nodePath);
                const effectiveQuantity = basis.baseQuantity * componentQuantity;
                const wastePercent = numeric(component?.waste);
                const wasteQuantity = effectiveQuantity * wastePercent / 100;
                const pricedQuantity = effectiveQuantity + wasteQuantity;
                const isAssembly = text(sourceItem?.type).toUpperCase() === 'ASSEMBLY';
                if (!sourceItem) {
                    warnings.push({ code: 'MISSING_CATALOG_ITEM', componentId, catalogItemId: catalogItemId || null,
                        path: nodePath });
                }
                const pricing = selectedPricing(sourceItem, component, pricingSource);
                const expanded = {
                    componentId,
                    catalogItemId: catalogItemId || null,
                    type: sourceItem?.type || 'OTHER',
                    costCategory: sourceItem?.costCategory || 'other',
                    isAssembly,
                    ratioType,
                    componentQuantity,
                    baseQuantity: basis.baseQuantity,
                    measurementQuantity: basis.measurementQuantity,
                    effectiveQuantity,
                    wastePercent,
                    wasteQuantity,
                    pricedQuantity,
                    spacing: basis.spacing ?? component?.spacing ?? null,
                    uom: sourceItem?.uom || component?.overrides?.uom || 'ea',
                    sourceCatalogItem: sourceItem ? clone(sourceItem) : null,
                    ...pricing,
                    overrides: clone(component?.overrides || {}),
                    depth,
                    path: nodePath
                };
                components.push(expanded);

                if (!isAssembly) return;
                if (ancestry.has(catalogItemId)) {
                    errors.push({ code: 'ASSEMBLY_CYCLE', componentId, catalogItemId, path: nodePath });
                    return;
                }
                const nextAncestry = new Set(ancestry);
                nextAncestry.add(catalogItemId);
                visit(sourceItem, effectiveQuantity, depth + 1, nodePath, nextAncestry);
            });
        }

        visit(assembly, numeric(measuredQuantity), 0, [rootId], new Set([rootId]));
        return {
            assemblyId: rootId,
            measuredQuantity: numeric(measuredQuantity),
            measurementType: context.measurementType || null,
            measurementUom: context.measurementUom || null,
            pricingSource,
            components,
            leaves: components.filter(component => !component.isAssembly),
            warnings,
            errors
        };
    }

    function consolidateComponents(components, options = {}) {
        const includeAssemblies = options.includeAssemblies === true;
        const buckets = new Map();
        (components || []).filter(component => includeAssemblies || !component.isAssembly).forEach(component => {
            const key = options.key
                ? options.key(component)
                : `${component.catalogItemId || component.componentId}:${text(component.uom).toLowerCase()}`;
            if (!buckets.has(key)) {
                buckets.set(key, {
                    key,
                    catalogItemId: component.catalogItemId,
                    type: component.type,
                    costCategory: component.costCategory,
                    uom: component.uom,
                    baseQuantity: 0,
                    effectiveQuantity: 0,
                    wasteQuantity: 0,
                    pricedQuantity: 0,
                    sources: []
                });
            }
            const bucket = buckets.get(key);
            bucket.baseQuantity += numeric(component.baseQuantity);
            bucket.effectiveQuantity += numeric(component.effectiveQuantity);
            bucket.wasteQuantity += numeric(component.wasteQuantity);
            bucket.pricedQuantity += numeric(component.pricedQuantity);
            bucket.sources.push({ componentId: component.componentId, depth: component.depth,
                path: [...component.path], effectiveQuantity: component.effectiveQuantity,
                wasteQuantity: component.wasteQuantity, pricedQuantity: component.pricedQuantity });
        });
        return [...buckets.values()];
    }

    const api = { RATIO_TYPES, PRICING_SOURCES, normalizeRatioType, expandAssembly, consolidateComponents };
    global.AssemblyExpansionService = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
