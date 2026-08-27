(function (global) {
    'use strict';

    const Preview = global.CatalogUpdatePreviewService
        || (typeof require === 'function' ? require('./catalog_update_preview_service.js') : null);
    const Detection = global.CatalogChangeDetectionService
        || (typeof require === 'function' ? require('./catalog_change_detection_service.js') : null);
    const Workspace = global.EstimatingWorkspaceService
        || (typeof require === 'function' ? require('./estimating_workspace_service.js') : null);
    if (!Preview || !Detection || !Workspace) throw new Error('Catalog update application dependencies are required');

    const STRATEGY = Object.freeze({ UPDATE_IN_PLACE: 'UPDATE_IN_PLACE', CREATE_REVISION: 'CREATE_REVISION' });
    const EDITABLE_STATUSES = new Set(['', 'draft', 'working', 'active', 'ready', 'unlocked']);
    const HISTORICAL_STATUSES = new Set(['submitted', 'approved', 'locked', 'closed', 'archived']);
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const present = value => value !== null && value !== undefined;

    class CatalogUpdateApplicationError extends Error {
        constructor(code, message, details = {}) {
            super(message); this.name = 'CatalogUpdateApplicationError'; this.code = code; this.details = details;
        }
    }

    function stable(value) {
        if (Array.isArray(value)) return value.map(stable);
        if (!value || typeof value !== 'object') return value;
        return Object.keys(value).sort().reduce((result, key) => { result[key] = stable(value[key]); return result; }, {});
    }
    const stableJson = value => JSON.stringify(stable(value));
    function fingerprint(value) {
        const text = stableJson(value);
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
    }

    function catalogMap(input) {
        if (input instanceof Map) return new Map([...input.entries()].map(([key, value]) => [String(key), value]));
        const items = Array.isArray(input) ? input : (Array.isArray(input?.items) ? input.items : []);
        return new Map(items.map(item => [String(item.id ?? item.catalogItemId), item]));
    }

    function catalogFingerprint(index, estimate, options = {}) {
        const selected = Array.isArray(options.selectedCatalogItemIds)
            ? new Set(options.selectedCatalogItemIds.map(String)) : null;
        const ids = new Set();
        const visit = item => {
            const id = item.catalogItemId ?? item.catalogSnapshot?.catalogItemId;
            if (present(id) && (!selected || selected.has(String(id)))) ids.add(String(id));
            (item.children || []).forEach(visit);
        };
        (estimate.groups || []).forEach(group => (group.items || []).forEach(visit));
        return fingerprint([...ids].sort().map(id => [id, clone(index.get(id) || null)]));
    }

    function optionsFingerprint(options = {}) {
        return fingerprint({
            preserveOverrides: options.preserveOverrides !== false,
            includeAssemblies: options.includeAssemblies !== false,
            includePricing: options.includePricing !== false,
            includeLabor: options.includeLabor !== false,
            includeEquipment: options.includeEquipment !== false,
            selectedCatalogItemIds: Array.isArray(options.selectedCatalogItemIds)
                ? options.selectedCatalogItemIds.map(String).sort() : null
        });
    }

    function resolveCatalogUpdateStrategy(estimate) {
        const status = String(estimate?.status || '').trim().toLowerCase();
        const locked = estimate?.isLocked === true || status === 'locked';
        if (!locked && EDITABLE_STATUSES.has(status)) return {
            strategy: STRATEGY.UPDATE_IN_PLACE, reason: 'ESTIMATE_IS_EDITABLE', editable: true
        };
        return {
            strategy: STRATEGY.CREATE_REVISION,
            reason: locked ? 'ESTIMATE_IS_LOCKED'
                : (HISTORICAL_STATUSES.has(status) ? `ESTIMATE_IS_${status.toUpperCase()}` : 'UNKNOWN_STATUS_IS_CONSERVATIVE'),
            editable: false
        };
    }

    function createPreviewGuard(estimate, catalogIndex, options = {}) {
        const index = catalogMap(catalogIndex);
        return {
            estimateId: String(estimate.id), dbEstimateId: estimate.dbEstimateId ?? null,
            serverRevision: Number(estimate.revision || 0), estimateRevision: Number(estimate.estimateRevision || 1),
            estimateFingerprint: fingerprint(estimate), catalogFingerprint: catalogFingerprint(index, estimate, options),
            optionsFingerprint: optionsFingerprint(options)
        };
    }

    function prepareCatalogUpdate(estimate, catalogIndex, options = {}) {
        const index = catalogMap(catalogIndex);
        return {
            preview: Preview.previewEstimateUpdate(estimate, index, options),
            guard: createPreviewGuard(estimate, index, options),
            catalogItems: clone([...index.values()]),
            options: clone(options)
        };
    }

    function assertFresh(estimate, index, options, guard) {
        if (!guard) throw new CatalogUpdateApplicationError('PREVIEW_GUARD_REQUIRED', 'A prepared preview is required before apply.');
        const estimateChanged = String(guard.estimateId) !== String(estimate.id)
            || Number(guard.serverRevision) !== Number(estimate.revision || 0)
            || guard.estimateFingerprint !== fingerprint(estimate);
        if (estimateChanged) throw new CatalogUpdateApplicationError('ESTIMATE_CHANGED_SINCE_PREVIEW',
            'The Estimate changed after preview.', { expected: guard, currentRevision: estimate.revision });
        if (guard.optionsFingerprint !== optionsFingerprint(options)) {
            throw new CatalogUpdateApplicationError('PREVIEW_OPTIONS_CHANGED', 'Update options changed after preview.');
        }
        const currentCatalogFingerprint = catalogFingerprint(index, estimate, options);
        if (guard.catalogFingerprint !== currentCatalogFingerprint) {
            throw new CatalogUpdateApplicationError('CATALOG_CHANGED_SINCE_PREVIEW',
                'The Cost Catalog changed after preview.', { expected: guard.catalogFingerprint, current: currentCatalogFingerprint });
        }
    }

    function itemMap(estimate) {
        const result = new Map();
        const visit = item => { result.set(String(item.id ?? item.catalogItemId), item); (item.children || []).forEach(visit); };
        (estimate.groups || []).forEach(group => (group.items || []).forEach(visit));
        return result;
    }

    function removedOverrideConflicts(original, projected) {
        const projectedIds = new Set(itemMap(projected).keys());
        const conflicts = [];
        itemMap(original).forEach((item, id) => {
            if (projectedIds.has(id)) return;
            const overrides = item.overrides || {};
            if (!Object.values(overrides).some(present)) return;
            conflicts.push({ code: 'REMOVED_COMPONENT_WITH_OVERRIDE', itemId: item.id ?? null,
                catalogItemId: item.catalogItemId ?? item.catalogSnapshot?.catalogItemId ?? null,
                name: item.name || '', overrides: clone(overrides), catalogSnapshot: clone(item.catalogSnapshot) });
        });
        return conflicts;
    }

    function traceItems(original, applied, updatedItemIds, refreshedAt) {
        const originals = itemMap(original);
        const appliedItems = itemMap(applied);
        updatedItemIds.forEach(id => {
            const before = originals.get(String(id));
            const after = appliedItems.get(String(id));
            if (!after) return;
            after.lastCatalogRefresh = {
                refreshedAt,
                previousCatalogRevision: before?.catalogRevision ?? before?.catalogSnapshot?.revision ?? null,
                currentCatalogRevision: after.catalogRevision ?? after.catalogSnapshot?.revision ?? null
            };
        });
    }

    function refreshedItemIds(original, projected, selectedCatalogItemIds) {
        const beforeItems = itemMap(original);
        const selected = Array.isArray(selectedCatalogItemIds)
            ? new Set(selectedCatalogItemIds.map(String)) : null;
        const refreshed = [];
        itemMap(projected).forEach((after, id) => {
            const before = beforeItems.get(id);
            if (!before) return;
            const catalogId = after.catalogItemId ?? after.catalogSnapshot?.catalogItemId;
            if (selected && !selected.has(String(catalogId))) return;
            if (fingerprint({ revision: before.catalogRevision, snapshot: before.catalogSnapshot })
                !== fingerprint({ revision: after.catalogRevision, snapshot: after.catalogSnapshot })) {
                refreshed.push(String(id));
            }
        });
        return refreshed;
    }

    function detachUnsafeTakeoffBindings(estimate, warnings) {
        const visit = item => {
            if (item.takeoffLayerId) {
                item.copiedFromTakeoffLayerId = item.takeoffLayerId;
                item.takeoffLayerId = null;
                item.quantitySource = 'manual'; item.quantitySyncStatus = 'manual';
                warnings.push(`TAKEOFF_BINDING_REQUIRES_RELINK:${String(item.id ?? '')}`);
            }
            (item.children || []).forEach(visit);
        };
        (estimate.groups || []).forEach(group => (group.items || []).forEach(visit));
    }

    function applyCatalogUpdate(estimate, catalogIndex, options = {}) {
        const index = catalogMap(catalogIndex);
        const guard = options.previewGuard || options.guard || options.preparedPreview?.guard;
        const previewOptions = { ...(options.preparedPreview?.options || {}), ...options };
        delete previewOptions.previewGuard; delete previewOptions.guard; delete previewOptions.preparedPreview;
        delete previewOptions.now; delete previewOptions.idFactory; delete previewOptions.preserveTakeoffBindingsOnRevision;
        assertFresh(estimate, index, previewOptions, guard);

        const preview = Preview.previewEstimateUpdate(estimate, index, previewOptions);
        const strategy = resolveCatalogUpdateStrategy(estimate);
        const applied = clone(preview.projectedEstimate);
        const refreshedAt = typeof options.now === 'function' ? options.now() : new Date().toISOString();
        const updatedItemIds = refreshedItemIds(estimate, applied, previewOptions.selectedCatalogItemIds);
        traceItems(estimate, applied, updatedItemIds, refreshedAt);
        const conflicts = removedOverrideConflicts(estimate, applied);
        const warnings = [...new Set(preview.warnings)];

        const previousEstimateRevision = Number(estimate.estimateRevision || 1);
        if (strategy.strategy === STRATEGY.CREATE_REVISION) {
            const idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => Workspace.uid('estimate');
            applied.id = String(idFactory());
            delete applied.dbEstimateId;
            applied.revision = 0;
            applied.estimateRevision = previousEstimateRevision + 1;
            applied.parentEstimateId = String(estimate.id);
            applied.sourceEstimateRevision = previousEstimateRevision;
            applied.status = 'draft'; applied.isLocked = false; applied.isActive = true;
            applied.name = `${estimate.name} Rev ${applied.estimateRevision}`;
            applied.catalogUpdateSourceGuard = {
                sourceEstimateId: String(estimate.id), sourceDbEstimateId: estimate.dbEstimateId ?? null,
                sourceServerRevision: Number(estimate.revision || 0)
            };
            if (options.preserveTakeoffBindingsOnRevision !== true) detachUnsafeTakeoffBindings(applied, warnings);
        } else {
            applied.id = estimate.id;
            applied.dbEstimateId = estimate.dbEstimateId;
            applied.revision = estimate.revision;
            applied.estimateRevision = previousEstimateRevision;
        }

        const originalItems = itemMap(estimate);
        const appliedItems = itemMap(applied);
        const previousCatalogRevisions = {};
        const currentCatalogRevisions = {};
        let preservedOverrides = 0;
        updatedItemIds.forEach(id => {
            const before = originalItems.get(id); const after = appliedItems.get(id);
            previousCatalogRevisions[id] = before?.catalogRevision ?? before?.catalogSnapshot?.revision ?? null;
            currentCatalogRevisions[id] = after?.catalogRevision ?? after?.catalogSnapshot?.revision ?? null;
            preservedOverrides += Object.values(after?.overrides || {}).filter(present).length;
        });
        const selected = Array.isArray(previewOptions.selectedCatalogItemIds)
            ? new Set(previewOptions.selectedCatalogItemIds.map(String)) : null;
        const skippedItems = preview.changeSet.itemChanges.filter(change =>
            change.status === Detection.STATUS.MISSING_IN_CATALOG
            || change.status === Detection.STATUS.LEGACY_NO_SNAPSHOT
            || (selected && !selected.has(String(change.catalogItemId))))
            .map(change => ({ catalogItemId: change.catalogItemId, status: change.status,
                reason: selected && !selected.has(String(change.catalogItemId)) ? 'NOT_SELECTED' : change.status }));
        const metadata = {
            refreshedAt, strategy: strategy.strategy,
            previousEstimateRevision,
            currentEstimateRevision: Number(applied.estimateRevision || previousEstimateRevision),
            previousCatalogRevisions, currentCatalogRevisions,
            changedItems: updatedItemIds, skippedItems: clone(skippedItems), preservedOverrides,
            conflicts: clone(conflicts), warnings: clone(warnings),
            previewGuard: clone(guard), previousTotal: preview.current.total, currentTotal: preview.projected.total
        };
        applied.catalogUpdateConflicts = [...(applied.catalogUpdateConflicts || []), ...clone(conflicts)];
        applied.catalogRefreshHistory = [...(applied.catalogRefreshHistory || []), metadata].slice(-50);
        applied.updatedAt = refreshedAt;
        applied.auditLog = [...(applied.auditLog || []), { id: Workspace.uid('audit'), at: refreshedAt,
            action: `Applied Cost Catalog update (${strategy.strategy})` }].slice(-100);

        return {
            strategy: strategy.strategy, reason: strategy.reason,
            estimateId: applied.id, previousEstimateId: estimate.id, revision: applied.estimateRevision,
            appliedEstimate: applied, appliedChanges: clone(updatedItemIds), skippedItems,
            conflicts, warnings,
            previousTotals: clone(preview.current), newTotals: clone(preview.projected),
            catalogRefreshMetadata: clone(metadata), preview
        };
    }

    const api = { STRATEGY, EDITABLE_STATUSES, HISTORICAL_STATUSES, CatalogUpdateApplicationError,
        resolveCatalogUpdateStrategy, createPreviewGuard, prepareCatalogUpdate, applyCatalogUpdate,
        fingerprint, catalogFingerprint };
    global.CatalogUpdateApplicationService = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
