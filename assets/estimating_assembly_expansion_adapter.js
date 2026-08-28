(function (global) {
    'use strict';

    const Engine = global.AssemblyExpansionService
        || (typeof require === 'function' ? require('./assembly_expansion_service.js') : null);
    if (!Engine) throw new Error('AssemblyExpansionService must load before EstimatingAssemblyExpansionAdapter');

    const POLICIES = Object.freeze({ LEGACY: 'LEGACY', CANONICAL: 'CANONICAL' });
    const text = value => value === null || value === undefined ? '' : String(value);
    const policy = value => text(value).trim().toUpperCase() === POLICIES.CANONICAL
        ? POLICIES.CANONICAL : POLICIES.LEGACY;
    const itemPolicy = (item, settings = {}) => policy(item?.assemblyExpansionPolicy
        ?? item?.assembly_expansion_policy ?? settings.assemblyExpansionPolicy
        ?? settings.assembly_expansion_policy);
    const itemId = item => text(item?.id || item?.catalogItemId || item?.catalog_item_id);
    const parentId = item => text(item?.parentItemId ?? item?.parent_item_id ?? item?.assemblyParentId);
    const isAssembly = item => item?.isAssembly === true
        || text(item?.itemType ?? item?.item_type).toLowerCase() === 'assembly';

    function createGraph(groups = []) {
        const rows = groups.flatMap(group => Array.isArray(group?.items) ? group.items : []);
        const byId = new Map();
        const flatChildren = new Map();
        function indexRow(row, embedded = false) {
            const id = itemId(row);
            if (id) byId.set(id, row);
            const catalogId = text(row?.catalogItemId ?? row?.catalog_item_id);
            if (catalogId && !byId.has(catalogId)) byId.set(catalogId, row);
            const parent = parentId(row);
            if (parent && !embedded) {
                if (!flatChildren.has(parent)) flatChildren.set(parent, []);
                flatChildren.get(parent).push(row);
            }
            const children = Array.isArray(row?.children) ? row.children
                : (Array.isArray(row?.assemblyItems) ? row.assemblyItems : []);
            children.forEach(child => indexRow(child, true));
        }
        rows.forEach(row => indexRow(row));
        return { rows, byId, flatChildren };
    }

    function expand(root, groups = [], settings = {}) {
        const graph = createGraph(groups);
        const index = new Map();
        let sequence = 0;

        function dto(row, path = new Set()) {
            const id = itemId(row) || `embedded-${++sequence}`;
            if (index.has(id)) return index.get(id);
            const result = {
                id,
                type: isAssembly(row) ? 'ASSEMBLY' : text((row?.itemType ?? row?.item_type) || 'PART').toUpperCase(),
                costCategory: row?.costCategory || 'other',
                uom: row?.uom || 'ea',
                pricing: {},
                estimatingItem: { ...row },
                assemblyComponents: []
            };
            index.set(id, result);
            const catalogId = text(row?.catalogItemId ?? row?.catalog_item_id);
            if (catalogId && !index.has(catalogId)) index.set(catalogId, result);
            if (!isAssembly(row) || path.has(id)) return result;
            const nextPath = new Set(path).add(id);
            const canonical = row?.catalogSnapshot?.assemblyComponents ?? row?.catalogMetadata?.assemblyComponents;
            const embedded = Array.isArray(row?.children) ? row.children
                : (Array.isArray(row?.assemblyItems) ? row.assemblyItems : []);
            const children = Array.isArray(canonical) && canonical.length
                ? canonical.map(component => ({ component, child: graph.byId.get(text(component.catalogItemId)) }))
                : (embedded.length ? embedded : (graph.flatChildren.get(id) || [])).map(child => ({ child }));
            result.assemblyComponents = children.map(({ component, child }, componentIndex) => {
                const childDto = child ? dto(child, nextPath) : null;
                const childId = text(component?.catalogItemId) || childDto?.id || `missing-${id}-${componentIndex}`;
                return {
                    id: text(component?.id) || `${id}:${componentIndex}`,
                    catalogItemId: childId,
                    quantity: component?.quantity ?? child?.quantity ?? 0,
                    ratioType: component?.ratioType ?? component?.ratio_type
                        ?? child?.ratioType ?? child?.ratio_type
                        ?? (row?.childrenQuantitiesExtended ? 'fixed' : 'per_unit'),
                    spacing: component?.spacing ?? component?.spacingValue ?? child?.spacing ?? null,
                    waste: component?.waste ?? component?.wasteFactorPercent ?? child?.componentWaste ?? 0,
                    pricingSnapshot: component?.pricingSnapshot || {},
                    overrides: component?.overrides || {}
                };
            });
            return result;
        }

        graph.rows.forEach(row => dto(row));
        const rootDto = dto(root);
        const measurement = settings.assemblyMeasurement || {};
        const result = Engine.expandAssembly(rootDto, root?.quantity, {
            catalogIndex: index,
            linearLength: root?.linearLength ?? measurement.linearLength,
            area: root?.area ?? measurement.area,
            endpointCount: root?.endpointCount ?? measurement.endpointCount,
            measurementType: root?.measurementType,
            measurementUom: root?.uom
        });
        return {
            ...result,
            leaves: result.leaves.map(leaf => ({
                ...leaf,
                item: (() => {
                    const source = { ...(leaf.sourceCatalogItem?.estimatingItem || {}),
                        quantity: leaf.effectiveQuantity, waste: leaf.wastePercent };
                    if (text(leaf.type).toUpperCase() === 'EQUIPMENT') {
                        source.equipmentQuantity = leaf.effectiveQuantity;
                    }
                    return source;
                })()
            }))
        };
    }

    const api = { POLICIES, policy, itemPolicy, createGraph, expand };
    global.EstimatingAssemblyExpansionAdapter = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
