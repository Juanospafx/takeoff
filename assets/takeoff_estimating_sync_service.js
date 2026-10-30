(function (global) {
    const CatalogSnapshot = global.EstimatingCatalogSnapshotService
        || (typeof require === 'function' ? require('./estimating_catalog_snapshot_service.js') : null);
    function number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function stringId(value) {
        return value === null || value === undefined ? '' : String(value);
    }

    function takeoffItem(layer, group, previous) {
        const measuredQty = number(layer.lastSyncedTakeoffQuantity ?? layer.originalQuantity ?? layer.quantity);
        const isOverridden = Boolean(
            previous?.quantityOverride === true
            || String(previous?.quantitySyncStatus || '').toLowerCase() === 'overridden'
            || layer.quantityOverride === true
        );
        const quantity = isOverridden
            ? number(previous?.quantity ?? layer.quantity)
            : number(layer.quantity);
        const item = {
            ...(previous || {}),
            id: previous?.id || `takeoff_${stringId(layer.id)}`,
            takeoffLayerId: stringId(layer.id),
            catalogItemId: layer.catalogItemId ?? layer.catalog_item_id ?? previous?.catalogItemId ?? null,
            name: layer.name || 'Takeoff item',
            description: layer.description || '',
            quantity,
            originalQuantity: measuredQty,
            lastSyncedTakeoffQuantity: measuredQty,
            pendingTakeoffQuantity: isOverridden ? measuredQty : null,
            quantityOverride: isOverridden,
            quantitySource: 'takeoff',
            quantitySyncStatus: isOverridden ? 'overridden' : 'synced',
            uom: layer.uom || layer.unit_of_measure || 'ea',
            unitMaterialCost: number(layer.unitMaterialCost ?? layer.unitCost ?? layer.unit_cost ?? previous?.unitMaterialCost),
            unitLabor: number(layer.unitLabor ?? layer.laborHours ?? layer.labor_hours ?? previous?.unitLabor),
            laborUnitType: layer.laborUnitType || previous?.laborUnitType || 'hrs',
            difficulty: (layer.difficulty !== undefined && layer.difficulty !== null)
                ? number(layer.difficulty)
                : (previous?.difficulty !== undefined ? number(previous.difficulty) : 1),
            groupId: stringId(group.id),
            groupName: group.name || 'Default Group'
        };
        if (layer.catalogMetadata && CatalogSnapshot) {
            const preservedOverrides = previous?.overrides;
            CatalogSnapshot.attachCatalogMetadata(item, {
                ...layer.catalogMetadata,
                uom: layer.catalogMetadata.uom ?? item.uom
            });
            if (preservedOverrides) item.overrides = { ...item.overrides, ...preservedOverrides };
            const effectiveLabor = number(layer.unitLabor ?? layer.laborHours ?? layer.labor_hours);
            const effectiveMaterial = number(layer.unitMaterialCost ?? layer.unitCost ?? layer.unit_cost);
            if (item.catalogSnapshot) {
                if (effectiveLabor > 0 && effectiveLabor !== number(item.catalogSnapshot.laborHoursPerUnit)) {
                    item.overrides = item.overrides || {};
                    item.overrides.laborHoursPerUnit = effectiveLabor;
                }
                if (effectiveMaterial > 0 && effectiveMaterial !== number(item.catalogSnapshot.materialUnitCost)) {
                    item.overrides = item.overrides || {};
                    item.overrides.materialUnitCost = effectiveMaterial;
                }
            }
            CatalogSnapshot.refreshEffectiveLegacyFields(item);
        }
        if (Array.isArray(previous?.children) && previous.children.length > 0) {
            item.children = JSON.parse(JSON.stringify(previous.children));
            item.isAssembly = true;
        }
        if (previous?.factorOverride !== undefined && previous.factorOverride !== null) {
            item.factorOverride = previous.factorOverride;
        }
        if (Array.isArray(previous?.catalogSnapshot?.assemblyComponents) && item.catalogSnapshot) {
            const prevCompMap = new Map(previous.catalogSnapshot.assemblyComponents.map(c => [String(c.id || c.catalogItemId), c]));
            (item.catalogSnapshot.assemblyComponents || []).forEach(sc => {
                const prevComp = prevCompMap.get(String(sc.id || sc.catalogItemId));
                if (prevComp) {
                    if (prevComp.factorOverride !== undefined) sc.factorOverride = prevComp.factorOverride;
                    if (prevComp.quantity !== undefined) sc.quantity = prevComp.quantity;
                }
            });
        }
        return item;
    }

    /**
     * Mirrors Takeoff groups/layers into an estimate while retaining manually
     * authored estimating rows. Takeoff-owned rows absent from the new snapshot
     * are intentionally removed.
     */
    function reconcile(existingGroups = [], takeoffGroups = []) {
        const previousByLayer = new Map();
        const manualGroups = [];

        (existingGroups || []).forEach(group => {
            const manualItems = [];
            (group.items || []).forEach(item => {
                if (item.takeoffLayerId !== null && item.takeoffLayerId !== undefined && stringId(item.takeoffLayerId) !== '') {
                    previousByLayer.set(stringId(item.takeoffLayerId), item);
                } else {
                    manualItems.push({ ...item });
                }
            });
            if (manualItems.length) manualGroups.push({ ...group, items: manualItems });
        });

        const groups = (takeoffGroups || []).map((group, groupIndex) => ({
            id: stringId(group.id) || `takeoff_group_${groupIndex}`,
            takeoffGroupId: stringId(group.id) || null,
            name: group.name || 'Default Group',
            expanded: group.expanded !== false && group.isExpanded !== false,
            sortOrder: groupIndex,
            source: 'takeoff',
            takeoffMirror: true,
            items: (group.layers || []).map(layer => takeoffItem(layer, group, previousByLayer.get(stringId(layer.id))))
        }));

        manualGroups.forEach(manualGroup => {
            const collidesWithTakeoff = groups.some(group => group.name === manualGroup.name);
            groups.push({
                ...manualGroup,
                id: manualGroup.takeoffMirror ? `manual_${stringId(manualGroup.id)}` : manualGroup.id,
                name: collidesWithTakeoff ? `${manualGroup.name} (Manual)` : manualGroup.name,
                source: 'manual',
                takeoffMirror: false,
                sortOrder: groups.length
            });
        });

        return groups;
    }

    function reconcileLinkedOnly(existingGroups = [], incomingGroups = []) {
        const incomingByLayer = new Map();
        (incomingGroups || []).forEach(group => (group.items || group.layers || []).forEach(layer => {
            const layerId = stringId(layer.takeoffLayerId ?? layer.id);
            if (layerId) incomingByLayer.set(layerId, { layer, group });
        }));
        const consumed = new Set();
        const result = (existingGroups || []).map((group, groupIndex) => ({
            ...group,
            items: (group.items || []).flatMap(existing => {
                const layerId = stringId(existing.takeoffLayerId);
                if (!layerId) return [{ ...existing }];
                const incoming = incomingByLayer.get(layerId);
                if (!incoming) return [];
                consumed.add(layerId);
                return [takeoffItem({ ...incoming.layer, id: layerId }, incoming.group, existing)];
            }),
            sortOrder: group.sortOrder ?? groupIndex
        }));
        (incomingGroups || []).forEach((incomingGroup, groupIndex) => {
            const pending = (incomingGroup.items || incomingGroup.layers || []).filter(layer => {
                const layerId = stringId(layer.takeoffLayerId ?? layer.id);
                return layerId && !consumed.has(layerId);
            });
            if (!pending.length) return;
            const incomingGroupId = stringId(incomingGroup.id);
            const takeoffGroupId = stringId(incomingGroup.takeoffGroupId);
            let target = result.find(group => (incomingGroupId && stringId(group.id) === incomingGroupId)
                || (takeoffGroupId && stringId(group.takeoffGroupId) === takeoffGroupId));
            if (!target) {
                target = {
                    id: incomingGroupId || `takeoff_group_${takeoffGroupId || groupIndex}`,
                    takeoffGroupId: takeoffGroupId || incomingGroupId || null,
                    name: incomingGroup.name || 'Default Group',
                    expanded: incomingGroup.expanded !== false && incomingGroup.isExpanded !== false,
                    sortOrder: incomingGroup.sortOrder ?? result.length,
                    source: 'takeoff', takeoffMirror: true, items: []
                };
                result.push(target);
            }
            pending.forEach(layer => {
                const layerId = stringId(layer.takeoffLayerId ?? layer.id);
                if (consumed.has(layerId)) return;
                target.items.push(takeoffItem({ ...layer, id: layerId }, incomingGroup));
                consumed.add(layerId);
            });
        });
        return result;
    }

    const service = { reconcile, reconcileLinkedOnly, takeoffItem };
    global.TakeoffEstimatingSyncService = service;
    if (typeof module !== 'undefined') module.exports = service;
})(typeof window !== 'undefined' ? window : globalThis);
