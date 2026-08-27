(function (global) {
    'use strict';

    const SnapshotService = global.EstimatingCatalogSnapshotService
        || (typeof require === 'function' ? require('./estimating_catalog_snapshot_service.js') : null);

    const STATUS = Object.freeze({
        CURRENT: 'CURRENT', OUTDATED: 'OUTDATED', MISSING_IN_CATALOG: 'MISSING_IN_CATALOG',
        LEGACY_NO_SNAPSHOT: 'LEGACY_NO_SNAPSHOT', UNVERSIONED: 'UNVERSIONED', ERROR: 'ERROR'
    });
    const IMPACT = Object.freeze({
        EFFECTIVE_VALUE_CHANGE: 'EFFECTIVE_VALUE_CHANGE', OVERRIDDEN_NO_EFFECT: 'OVERRIDDEN_NO_EFFECT',
        STRUCTURAL_CHANGE: 'STRUCTURAL_CHANGE', INFORMATIONAL: 'INFORMATIONAL',
        REMOVED: 'REMOVED', UNRESOLVED: 'UNRESOLVED'
    });
    const PRICING_FIELDS = Object.freeze([
        'materialUnitCost', 'equipmentUnitCost', 'subcontractorUnitCost',
        'laborHoursPerUnit', 'laborRate'
    ]);
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const present = value => value !== null && value !== undefined;
    const sameId = (left, right) => String(left ?? '') === String(right ?? '');

    function stable(value) {
        if (Array.isArray(value)) return value.map(stable);
        if (!value || typeof value !== 'object') return value;
        return Object.keys(value).sort().reduce((result, key) => {
            result[key] = stable(value[key]); return result;
        }, {});
    }
    const equal = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));

    function revisionComparison(previous, current) {
        if (!present(current) || current === '') return { comparable: false, equal: false, direction: null };
        if (!present(previous) || previous === '') return { comparable: false, equal: false, direction: null };
        if (String(previous) === String(current)) return { comparable: true, equal: true, direction: 0 };
        const previousNumber = Number(previous);
        const currentNumber = Number(current);
        if (Number.isFinite(previousNumber) && Number.isFinite(currentNumber)) {
            return { comparable: true, equal: false, direction: Math.sign(currentNumber - previousNumber) };
        }
        return { comparable: true, equal: false, direction: null };
    }

    function effectiveValue(item, field, snapshotPricing) {
        if (item?.overrides && present(item.overrides[field])) return Number(item.overrides[field]);
        if (snapshotPricing && present(snapshotPricing[field])) return Number(snapshotPricing[field]);
        return SnapshotService ? SnapshotService.getEffectiveCatalogValue(item, field) : null;
    }

    function pricingChange(item, field, previousValue, currentValue) {
        const hasOverride = Boolean(item?.overrides && present(item.overrides[field]));
        const before = effectiveValue(item, field, item.catalogSnapshot?.pricing);
        const after = hasOverride ? Number(item.overrides[field]) : Number(currentValue);
        return {
            field: `pricing.${field}`, previousValue: clone(previousValue), currentValue: clone(currentValue),
            hasOverride, overrideValue: hasOverride ? Number(item.overrides[field]) : null,
            effectiveValueBefore: before, effectiveValueAfterIfUpdated: after,
            impact: hasOverride ? IMPACT.OVERRIDDEN_NO_EFFECT : IMPACT.EFFECTIVE_VALUE_CHANGE
        };
    }

    function componentKey(component, index) {
        if (present(component?.id) && component.id !== '') return `id:${String(component.id)}`;
        return `fallback:${String(component?.catalogItemId ?? '')}:${index}`;
    }

    function compareAssemblyComponents(previous = [], current = []) {
        const previousMap = new Map(previous.map((component, index) => [componentKey(component, index), { component, index }]));
        const currentMap = new Map(current.map((component, index) => [componentKey(component, index), { component, index }]));
        const componentChanges = [];
        previousMap.forEach(({ component }, key) => {
            if (!currentMap.has(key)) {
                componentChanges.push({ componentKey: key, change: 'REMOVED', previousValue: clone(component), currentValue: null });
                return;
            }
            const next = currentMap.get(key).component;
            ['catalogItemId', 'quantity', 'ratioType', 'spacing', 'waste', 'pricingSnapshot', 'catalogRevision', 'revision']
                .forEach(field => {
                    if (!equal(component?.[field] ?? null, next?.[field] ?? null)) {
                        componentChanges.push({ componentKey: key, change: 'CHANGED', field,
                            previousValue: clone(component?.[field] ?? null), currentValue: clone(next?.[field] ?? null) });
                    }
                });
        });
        currentMap.forEach(({ component }, key) => {
            if (!previousMap.has(key)) componentChanges.push({ componentKey: key, change: 'ADDED', previousValue: null, currentValue: clone(component) });
        });
        return componentChanges;
    }

    function baseResult(item, current) {
        return {
            catalogItemId: item?.catalogItemId ?? item?.catalogSnapshot?.catalogItemId ?? current?.id ?? null,
            previousRevision: item?.catalogRevision ?? item?.catalogSnapshot?.revision ?? null,
            currentRevision: current?.revision ?? null,
            outdated: false, status: STATUS.CURRENT, changes: [], warnings: []
        };
    }

    function compareCatalogItem(item, currentCatalogItem) {
        const result = baseResult(item, currentCatalogItem);
        if (!item || typeof item !== 'object') return { ...result, status: STATUS.ERROR, warnings: ['INVALID_ESTIMATING_ITEM'] };
        if (!item.catalogSnapshot) {
            result.status = STATUS.LEGACY_NO_SNAPSHOT;
            if (currentCatalogItem) result.warnings.push('CURRENT_ITEM_EXISTS_WITHOUT_HISTORICAL_SNAPSHOT');
            return result;
        }
        if (!currentCatalogItem) return { ...result, status: STATUS.MISSING_IN_CATALOG, warnings: ['CATALOG_ITEM_NOT_FOUND'] };
        if (!sameId(result.catalogItemId, currentCatalogItem.id ?? currentCatalogItem.catalogItemId)) {
            return { ...result, status: STATUS.ERROR, warnings: ['CATALOG_IDENTITY_MISMATCH'] };
        }

        const previous = item.catalogSnapshot;
        const current = currentCatalogItem;
        PRICING_FIELDS.forEach(field => {
            const before = previous.pricing?.[field] ?? 0;
            const after = current.pricing?.[field] ?? 0;
            if (!equal(before, after)) result.changes.push(pricingChange(item, field, before, after));
        });
        ['type', 'costCategory', 'uom'].forEach(field => {
            if (!equal(previous[field] ?? null, current[field] ?? null)) result.changes.push({
                field, previousValue: clone(previous[field] ?? null), currentValue: clone(current[field] ?? null),
                hasOverride: false, effectiveValueBefore: null, effectiveValueAfterIfUpdated: null,
                impact: present(current[field]) ? IMPACT.STRUCTURAL_CHANGE : IMPACT.REMOVED
            });
        });
        ['catalog', 'category'].forEach(field => {
            if (!equal(previous[field] ?? null, current[field] ?? null)) result.changes.push({
                field, previousValue: clone(previous[field] ?? null), currentValue: clone(current[field] ?? null),
                hasOverride: false, effectiveValueBefore: null, effectiveValueAfterIfUpdated: null,
                impact: present(current[field]) ? IMPACT.INFORMATIONAL : IMPACT.REMOVED
            });
        });
        const componentChanges = compareAssemblyComponents(previous.assemblyComponents || [], current.assemblyComponents || []);
        if (componentChanges.length) result.changes.push({
            field: 'assemblyComponents', previousValue: clone(previous.assemblyComponents || []),
            currentValue: clone(current.assemblyComponents || []), hasOverride: false,
            effectiveValueBefore: null, effectiveValueAfterIfUpdated: null,
            impact: IMPACT.STRUCTURAL_CHANGE, componentChanges
        });

        const revision = revisionComparison(result.previousRevision, result.currentRevision);
        if (!present(result.currentRevision) || result.currentRevision === '') {
            result.status = STATUS.UNVERSIONED;
            result.outdated = result.changes.length > 0;
            result.warnings.push('CURRENT_CATALOG_REVISION_MISSING');
        } else {
            result.outdated = !revision.equal || result.changes.length > 0;
            result.status = result.outdated ? STATUS.OUTDATED : STATUS.CURRENT;
            if (revision.direction === -1) result.warnings.push('CATALOG_REVISION_REGRESSION');
            if (revision.equal && result.changes.length) result.warnings.push('CONTENT_MISMATCH_AT_SAME_REVISION');
        }
        return result;
    }

    function catalogMap(input) {
        if (input instanceof Map) return new Map([...input.entries()].map(([key, value]) => [String(key), value]));
        const items = Array.isArray(input) ? input : (Array.isArray(input?.items) ? input.items : []);
        return new Map(items.map(item => [String(item.id ?? item.catalogItemId), item]));
    }

    function estimateItems(estimate) {
        const result = [];
        const visit = item => { result.push(item); (item.children || []).forEach(visit); };
        (estimate?.groups || []).forEach(group => (group.items || []).forEach(visit));
        return result;
    }

    function compareEstimate(estimate, catalogIndex) {
        const index = catalogMap(catalogIndex);
        const items = estimateItems(estimate);
        const linked = items.filter(item => present(item.catalogItemId) || item.catalogSnapshot);
        const itemChanges = linked.map(item => compareCatalogItem(item,
            index.get(String(item.catalogItemId ?? item.catalogSnapshot?.catalogItemId)) || null));
        const count = status => itemChanges.filter(change => change.status === status).length;
        const changesByType = { pricing: 0, labor: 0, equipment: 0, assemblies: 0, informational: 0 };
        itemChanges.flatMap(change => change.changes).forEach(change => {
            if (change.field === 'assemblyComponents') changesByType.assemblies += 1;
            else if (change.impact === IMPACT.INFORMATIONAL) changesByType.informational += 1;
            else if (change.field === 'pricing.equipmentUnitCost') changesByType.equipment += 1;
            else if (change.field === 'pricing.laborRate' || change.field === 'pricing.laborHoursPerUnit') changesByType.labor += 1;
            else if (change.field.startsWith('pricing.')) changesByType.pricing += 1;
            else changesByType.informational += 1;
        });
        return {
            totalItems: items.length, linkedItems: linked.length,
            currentItems: count(STATUS.CURRENT), outdatedItems: count(STATUS.OUTDATED),
            missingItems: count(STATUS.MISSING_IN_CATALOG), legacyItems: count(STATUS.LEGACY_NO_SNAPSHOT),
            unversionedItems: count(STATUS.UNVERSIONED), errorItems: count(STATUS.ERROR),
            changesByType, itemChanges
        };
    }

    function summarizeChanges(changeSet) {
        const changes = Array.isArray(changeSet) ? changeSet
            : (Array.isArray(changeSet?.itemChanges) ? changeSet.itemChanges : [changeSet]);
        const summary = { items: changes.filter(Boolean).length, changes: 0, statuses: {}, impacts: {} };
        changes.filter(Boolean).forEach(item => {
            summary.statuses[item.status] = (summary.statuses[item.status] || 0) + 1;
            (item.changes || []).forEach(change => {
                summary.changes += 1;
                summary.impacts[change.impact] = (summary.impacts[change.impact] || 0) + 1;
            });
        });
        return summary;
    }

    const api = { STATUS, IMPACT, PRICING_FIELDS, compareCatalogItem, compareEstimate,
        summarizeChanges, compareAssemblyComponents, revisionComparison };
    global.CatalogChangeDetectionService = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
