(function (global) {
    'use strict';

    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const text = value => value === null || value === undefined ? '' : String(value);
    const isAssembly = item => item?.isAssembly === true
        || text(item?.itemType ?? item?.item_type).toLowerCase() === 'assembly';
    const parentId = item => text(item?.parentItemId ?? item?.parent_item_id ?? item?.assemblyParentId);
    const catalogId = item => item?.catalogItemId ?? item?.catalog_item_id ?? '';

    function catalogColumns(item, quantity, groupName, type) {
        return {
            Group: text(groupName),
            Type: type,
            'Catalog Item ID': text(catalogId(item)),
            Item: text(item?.name ?? item?.catalog_item_name),
            Description: text(item?.description),
            'Budget Code': text(item?.budgetCode ?? item?.budget_code),
            'Cost Code': text(item?.costCode ?? item?.cost_code),
            Category: text(item?.costCategory ?? item?.cost_type ?? item?.item_type),
            UOM: text(item?.uom ?? item?.unit_of_measure),
            Quantity: number(quantity),
            'Unit Material Cost': number(item?.unitMaterialCost ?? item?.unitCost ?? item?.unit_cost),
            'Unit Labor': number(item?.unitLabor ?? item?.unit_labor_time ?? item?.laborHours),
            'Labor Unit': text(item?.laborUnitType ?? item?.laborUnit),
            'Labor Rate': number(item?.laborRate ?? item?.labor_rate),
            Notes: text(item?.notes)
        };
    }

    function normalRows(estimate) {
        const rows = [];
        (estimate?.groups || []).forEach(group => {
            const children = new Map();
            (group.items || []).forEach(item => {
                const parent = parentId(item);
                if (!parent) return;
                if (!children.has(parent)) children.set(parent, []);
                children.get(parent).push(item);
            });
            (group.items || []).forEach(item => {
                if (parentId(item)) return;
                rows.push(catalogColumns(item, item.quantity, group.name, isAssembly(item) ? 'Assembly' : 'Part'));
            });
        });
        return rows;
    }

    function flattenItem(item, multiplier, groupName, siblingChildren, output, ancestry) {
        const id = text(item?.id);
        const embedded = Array.isArray(item?.children) ? item.children
            : (Array.isArray(item?.assemblyItems) ? item.assemblyItems : []);
        const children = embedded.length ? embedded : (siblingChildren.get(id) || []);
        if (isAssembly(item) && children.length) {
            if (id && ancestry.has(id)) return;
            const nextAncestry = new Set(ancestry);
            if (id) nextAncestry.add(id);
            const assemblyMultiplier = multiplier * number(item.quantity);
            children.forEach(child => {
                const childMultiplier = item.childrenQuantitiesExtended ? multiplier : assemblyMultiplier;
                flattenItem(child, childMultiplier, groupName, siblingChildren, output, nextAncestry);
            });
            return;
        }
        output.push({ item, quantity: multiplier * number(item.quantity), groupName });
    }

    function flatRows(estimate) {
        const expanded = [];
        (estimate?.groups || []).forEach(group => {
            const siblingChildren = new Map();
            (group.items || []).forEach(item => {
                const parent = parentId(item);
                if (!parent) return;
                if (!siblingChildren.has(parent)) siblingChildren.set(parent, []);
                siblingChildren.get(parent).push(item);
            });
            (group.items || []).filter(item => !parentId(item))
                .forEach(item => flattenItem(item, 1, group.name, siblingChildren, expanded, new Set()));
        });
        const consolidated = new Map();
        expanded.forEach(row => {
            const item = row.item;
            const key = catalogId(item) !== '' ? `catalog:${catalogId(item)}:${text(item?.uom).toLowerCase()}`
                : ['item', text(item?.costCode ?? item?.cost_code).toLowerCase(),
                    text(item?.name).toLowerCase(), text(item?.uom).toLowerCase()].join(':');
            if (!consolidated.has(key)) consolidated.set(key, { ...row, groups: new Set([row.groupName]) });
            else {
                const current = consolidated.get(key);
                current.quantity += row.quantity;
                current.groups.add(row.groupName);
            }
        });
        return [...consolidated.values()].map(row => catalogColumns(
            row.item, row.quantity, [...row.groups].filter(Boolean).join('; '), 'Part'
        ));
    }

    function withCatalog(estimate, catalogPayload = {}) {
        const cloned = JSON.parse(JSON.stringify(estimate || {}));
        const items = new Map((catalogPayload.allItems || []).map(item => [text(item.id), item]));
        const parts = new Map();
        (catalogPayload.assemblyParts || []).forEach(part => {
            const key = text(part.assembly_catalog_item_id);
            if (!parts.has(key)) parts.set(key, []);
            parts.get(key).push(part);
        });
        function hydrate(item, ancestry = new Set()) {
            const id = text(catalogId(item));
            const catalogItem = items.get(id);
            if (catalogItem) Object.assign(item, {
                catalogItemId: catalogItem.id,
                name: catalogItem.name ?? item.name,
                description: catalogItem.description ?? item.description,
                budgetCode: catalogItem.budget_code ?? item.budgetCode,
                costCode: catalogItem.cost_code ?? item.costCode,
                costCategory: catalogItem.cost_type ?? item.costCategory,
                uom: catalogItem.unit_of_measure ?? item.uom,
                unitMaterialCost: catalogItem.unit_cost ?? item.unitMaterialCost,
                unitLabor: catalogItem.labor_hours ?? item.unitLabor,
                laborUnitType: catalogItem.labor_hours !== undefined ? 'hrs' : item.laborUnitType,
                itemType: catalogItem.item_type ?? item.itemType,
                isAssembly: text(catalogItem.item_type).toLowerCase() === 'assembly' || item.isAssembly === true
            });
            const definitions = parts.get(id) || [];
            if ((!item.children || !item.children.length) && definitions.length && !ancestry.has(id)) {
                const next = new Set(ancestry); next.add(id);
                item.children = definitions.flatMap(part => {
                    const childId = text(part.part_catalog_item_id);
                    if (!childId || next.has(childId)) return [];
                    const child = { ...(items.get(childId) || {}),
                        id: `catalog_part_${text(part.id)}_${childId}`,
                        catalogItemId: childId,
                        quantity: number(part.quantity),
                        unitMaterialCost: part.unit_cost_snapshot ?? items.get(childId)?.unit_cost,
                        unitLabor: part.unit_labor_time_snapshot ?? items.get(childId)?.labor_hours,
                        laborUnitType: 'hrs' };
                    hydrate(child, next);
                    return [child];
                });
            } else (item.children || []).forEach(child => hydrate(child, ancestry));
            return item;
        }
        (cloned.groups || []).forEach(group => (group.items || []).forEach(item => hydrate(item)));
        return cloned;
    }

    function needsCatalog(estimate) {
        return (estimate?.groups || []).some(group => (group.items || []).some(item =>
            isAssembly(item) && catalogId(item) !== ''
            && !(Array.isArray(item.children) && item.children.length)
            && !(Array.isArray(item.assemblyItems) && item.assemblyItems.length)));
    }

    function unresolvedAssemblies(estimate) {
        return (estimate?.groups || []).flatMap(group => (group.items || []).filter(item =>
            isAssembly(item)
            && !(Array.isArray(item.children) && item.children.length)
            && !(Array.isArray(item.assemblyItems) && item.assemblyItems.length)));
    }

    function csv(rows) {
        const headers = Object.keys(rows[0] || catalogColumns({}, 0, '', 'Part'));
        const escape = value => {
            const raw = text(value);
            return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
        };
        return '\uFEFF' + [headers, ...rows.map(row => headers.map(header => row[header]))]
            .map(columns => columns.map(escape).join(',')).join('\r\n');
    }

    const service = { normalRows, flatRows, withCatalog, needsCatalog, unresolvedAssemblies, csv };
    global.EstimatingExportService = service;
    if (typeof module !== 'undefined') module.exports = service;
})(typeof window !== 'undefined' ? window : globalThis);
