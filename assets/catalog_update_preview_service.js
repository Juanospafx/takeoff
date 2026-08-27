(function (global) {
    'use strict';

    const Detection = global.CatalogChangeDetectionService
        || (typeof require === 'function' ? require('./catalog_change_detection_service.js') : null);
    const Snapshots = global.EstimatingCatalogSnapshotService
        || (typeof require === 'function' ? require('./estimating_catalog_snapshot_service.js') : null);
    const Calculation = global.EstimateCalculationService
        || (typeof require === 'function' ? require('./estimate_calculation_service.js') : null);
    if (!Detection || !Snapshots || !Calculation) throw new Error('Catalog preview dependencies are required');

    const DEFAULT_OPTIONS = Object.freeze({
        preserveOverrides: true, includeAssemblies: true, includePricing: true, includeLabor: true,
        includeEquipment: true, selectedCatalogItemIds: null
    });
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const present = value => value !== null && value !== undefined;
    const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const pricingOverridePresent = item => Snapshots.FIELDS.some(field => present(item?.overrides?.[field]));

    function normalizeOptions(options = {}) {
        return { ...DEFAULT_OPTIONS, ...(options || {}) };
    }

    function catalogMap(input) {
        if (input instanceof Map) return new Map([...input.entries()].map(([key, value]) => [String(key), value]));
        const items = Array.isArray(input) ? input : (Array.isArray(input?.items) ? input.items : []);
        return new Map(items.map(item => [String(item.id ?? item.catalogItemId), item]));
    }

    function selectedCatalogItem(item, current, options) {
        const previous = item.catalogSnapshot || {};
        const previousPricing = previous.pricing || {};
        const currentPricing = current.pricing || {};
        return {
            ...clone(current),
            pricing: {
                ...clone(currentPricing),
                materialUnitCost: options.includePricing ? currentPricing.materialUnitCost : previousPricing.materialUnitCost,
                equipmentUnitCost: options.includePricing && options.includeEquipment
                    ? currentPricing.equipmentUnitCost : previousPricing.equipmentUnitCost,
                subcontractorUnitCost: options.includePricing ? currentPricing.subcontractorUnitCost : previousPricing.subcontractorUnitCost,
                laborHoursPerUnit: options.includeLabor ? currentPricing.laborHoursPerUnit : previousPricing.laborHoursPerUnit,
                laborRate: options.includeLabor ? currentPricing.laborRate : previousPricing.laborRate
            },
            assemblyComponents: options.includeAssemblies
                ? clone(current.assemblyComponents || []) : clone(previous.assemblyComponents || [])
        };
    }

    function componentIdentity(component, index) {
        if (present(component?.id) && component.id !== '') return `id:${String(component.id)}`;
        if (present(component?.catalogItemId)) return `catalog:${String(component.catalogItemId)}`;
        return `position:${index}`;
    }

    function childForOldComponent(children, oldComponents, component, newIndex) {
        if (present(component?.id)) {
            const oldIndex = oldComponents.findIndex(row => String(row?.id ?? '') === String(component.id));
            if (oldIndex >= 0) return { child: children[oldIndex], oldIndex };
        }
        if (present(component?.catalogItemId)) {
            const childIndex = children.findIndex(row => String(row?.catalogItemId ?? '') === String(component.catalogItemId));
            if (childIndex >= 0) return { child: children[childIndex], oldIndex: childIndex };
        }
        return { child: children[newIndex], oldIndex: newIndex };
    }

    function componentFallbackDto(component, existingChild) {
        const pricing = component?.pricingSnapshot || {};
        const type = existingChild?.catalogSnapshot?.type || existingChild?.itemType?.toUpperCase()
            || (numeric(pricing.equipmentUnitCost) ? 'EQUIPMENT' : 'PART');
        return {
            id: component.catalogItemId,
            revision: component.catalogRevision ?? component.revision ?? null,
            type,
            costCategory: existingChild?.catalogSnapshot?.costCategory || existingChild?.costCategory || null,
            uom: existingChild?.uom || 'ea', pricing: clone(pricing), assemblyComponents: [],
            catalog: clone(existingChild?.catalogSnapshot?.catalog || null),
            category: clone(existingChild?.catalogSnapshot?.category || null)
        };
    }

    function reconcileAssemblyChildren(item, previousSnapshot, currentDto, index, options, warnings) {
        if (!options.includeAssemblies) return;
        const children = Array.isArray(item.children) ? item.children : [];
        const oldComponents = previousSnapshot?.assemblyComponents || [];
        const currentComponents = currentDto.assemblyComponents || [];
        const retainedOldIndexes = new Set();
        item.children = currentComponents.map((component, componentIndex) => {
            const match = childForOldComponent(children, oldComponents, component, componentIndex);
            if (match.child) retainedOldIndexes.add(match.oldIndex);
            const child = clone(match.child || {
                id: `preview_${componentIdentity(component, componentIndex)}`,
                catalogItemId: component.catalogItemId,
                name: 'Assembly component', itemType: 'part', quantity: component.quantity, overrides: {}
            });
            child.catalogItemId = component.catalogItemId ?? child.catalogItemId ?? null;
            child.quantity = numeric(component.quantity);
            const childDto = index.get(String(child.catalogItemId)) || componentFallbackDto(component, child);
            if (childDto?.id !== null && childDto?.id !== undefined) {
                const preserved = options.preserveOverrides ? clone(child.overrides || {}) : Snapshots.emptyOverrides();
                Snapshots.attachCatalogSnapshot(child, selectedCatalogItem(child, childDto, options));
                child.overrides = preserved;
                Snapshots.refreshEffectiveLegacyFields(child);
            } else warnings.push(`ASSEMBLY_COMPONENT_METADATA_UNRESOLVED:${String(component.catalogItemId ?? componentIndex)}`);
            return child;
        });
        children.forEach((child, childIndex) => {
            if (!retainedOldIndexes.has(childIndex) && pricingOverridePresent(child)) {
                warnings.push(`REMOVED_COMPONENT_WITH_OVERRIDE:${String(child.catalogItemId ?? child.id ?? childIndex)}`);
            }
        });
        item.childrenQuantitiesExtended = false;
    }

    function visitItems(estimate, callback) {
        const visit = (item, parent = null) => {
            callback(item, parent);
            (item.children || []).forEach(child => visit(child, item));
        };
        (estimate.groups || []).forEach(group => (group.items || []).forEach(item => visit(item)));
    }

    function applyCatalogChangesToClone(estimateClone, changeSet, catalogIndex, options = {}) {
        const projected = clone(estimateClone);
        const index = catalogMap(catalogIndex);
        const policy = normalizeOptions(options);
        const warnings = [];
        const updatedItemIds = [];
        const selectedIds = Array.isArray(policy.selectedCatalogItemIds)
            ? new Set(policy.selectedCatalogItemIds.map(String)) : null;
        visitItems(projected, item => {
            if (!item.catalogSnapshot) {
                if (present(item.catalogItemId)) warnings.push(`LEGACY_ITEM_NOT_REFRESHABLE:${String(item.id ?? item.catalogItemId)}`);
                return;
            }
            const current = index.get(String(item.catalogItemId ?? item.catalogSnapshot.catalogItemId));
            if (selectedIds && !selectedIds.has(String(item.catalogItemId ?? item.catalogSnapshot.catalogItemId))) return;
            if (!current) {
                warnings.push(`MISSING_CATALOG_ITEM_PRESERVED:${String(item.id ?? item.catalogItemId)}`);
                return;
            }
            const comparison = Detection.compareCatalogItem(item, current);
            if (comparison.status === Detection.STATUS.ERROR) {
                warnings.push(`CATALOG_COMPARISON_ERROR:${String(item.id ?? item.catalogItemId)}`); return;
            }
            if (comparison.status === Detection.STATUS.UNVERSIONED) {
                warnings.push(`UNVERSIONED_CATALOG_ITEM:${String(item.id ?? item.catalogItemId)}`);
            }
            if (comparison.status === Detection.STATUS.CURRENT && !comparison.changes.length) return;
            const previousSnapshot = clone(item.catalogSnapshot);
            if (String(current.type || '').toUpperCase() === 'ASSEMBLY' || item.isAssembly) {
                reconcileAssemblyChildren(item, previousSnapshot, current, index, policy, warnings);
            }
            const preservedOverrides = policy.preserveOverrides ? clone(item.overrides || {}) : Snapshots.emptyOverrides();
            Snapshots.attachCatalogSnapshot(item, selectedCatalogItem(item, current, policy));
            item.overrides = preservedOverrides;
            Snapshots.refreshEffectiveLegacyFields(item);
            updatedItemIds.push(String(item.id ?? item.catalogItemId));
        });
        return { estimate: projected, warnings: [...new Set(warnings)], updatedItemIds, changeSet: clone(changeSet) };
    }

    function normalizedTotals(summary) {
        return {
            subtotal: numeric(summary?.direct?.totalSales),
            material: numeric(summary?.direct?.materialCost),
            equipment: numeric(summary?.direct?.equipmentCost),
            labor: numeric(summary?.direct?.laborCost),
            tax: numeric(summary?.totalTax),
            markups: numeric(summary?.totalMarkups),
            sales: numeric(summary?.estimateTotal),
            profit: numeric(summary?.profit),
            total: numeric(summary?.estimateTotal),
            totalCost: numeric(summary?.direct?.totalCost),
            raw: clone(summary)
        };
    }

    function itemMap(estimate) {
        const map = new Map();
        visitItems(estimate, item => map.set(String(item.id ?? item.catalogItemId), item));
        return map;
    }

    function itemImpacts(original, projected, settings, changeSet) {
        const projectedItems = itemMap(projected);
        const changesByCatalog = new Map((changeSet.itemChanges || []).map(change => [String(change.catalogItemId), change]));
        const impacts = [];
        visitItems(original, item => {
            const key = String(item.id ?? item.catalogItemId);
            const afterItem = projectedItems.get(key);
            if (!afterItem || (!item.catalogSnapshot && !item.catalogItemId)) return;
            const before = Calculation.calculateItem(item, settings);
            const after = Calculation.calculateItem(afterItem, settings);
            impacts.push({
                itemId: item.id ?? null, catalogItemId: item.catalogItemId ?? item.catalogSnapshot?.catalogItemId ?? null,
                name: item.name || '', before: clone(before), after: clone(after),
                difference: after.totalSales - before.totalSales,
                costDifference: after.totalCost - before.totalCost,
                changes: clone(changesByCatalog.get(String(item.catalogItemId ?? item.catalogSnapshot?.catalogItemId))?.changes || []),
                overridden: pricingOverridePresent(item)
            });
        });
        return impacts;
    }

    function categoryImpact(currentSummary, projectedSummary, itemImpactsList) {
        const category = name => ({
            cost: numeric(projectedSummary.byCategory?.[name]?.totalCost) - numeric(currentSummary.byCategory?.[name]?.totalCost),
            sales: numeric(projectedSummary.byCategory?.[name]?.totalSales) - numeric(currentSummary.byCategory?.[name]?.totalSales)
        });
        return {
            materialDifference: category('Materials'),
            equipmentDifference: category('Equipment'),
            laborDifference: category('Labor'),
            assemblyDifference: itemImpactsList.filter(item => item.before?.isAssembly || item.after?.isAssembly)
                .reduce((sum, item) => sum + item.difference, 0)
        };
    }

    function previewEstimateUpdate(estimate, catalogIndex, options = {}) {
        const originalClone = clone(estimate);
        const index = catalogMap(catalogIndex);
        const policy = normalizeOptions(options);
        const changeSet = Detection.compareEstimate(originalClone, index);
        const applied = applyCatalogChangesToClone(originalClone, changeSet, index, policy);
        const settings = clone(originalClone.settings || {});
        const currentSummary = Calculation.calculateSummary(originalClone.groups || [], settings);
        const projectedSummary = Calculation.calculateSummary(applied.estimate.groups || [], settings);
        const current = normalizedTotals(currentSummary);
        const projected = normalizedTotals(projectedSummary);
        const amount = projected.total - current.total;
        const impacts = itemImpacts(originalClone, applied.estimate, settings, changeSet);
        const warnings = [...new Set([
            ...applied.warnings,
            ...changeSet.itemChanges.flatMap(change => change.warnings || [])
        ])];
        const changed = applied.updatedItemIds.length > 0;
        return {
            status: warnings.length ? 'PREVIEW_WITH_WARNINGS' : (changed ? 'PREVIEW_READY' : 'PREVIEW_NO_CHANGES'),
            options: policy, changeSet, current, projected,
            difference: { amount, percent: current.total ? amount / current.total * 100 : (amount ? null : 0) },
            itemImpacts: impacts,
            categoryImpact: categoryImpact(currentSummary, projectedSummary, impacts),
            warnings,
            projectedEstimate: applied.estimate
        };
    }

    const api = { DEFAULT_OPTIONS, previewEstimateUpdate, applyCatalogChangesToClone,
        normalizedTotals, reconcileAssemblyChildren };
    global.CatalogUpdatePreviewService = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
