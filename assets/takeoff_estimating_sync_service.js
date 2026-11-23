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
            // Color is part of the persisted Takeoff identity. Dropping it at
            // this boundary makes copied/reloaded items fall back to the same
            // catalog default even when their canvas layers were distinct.
            color: layer.color ?? previous?.color,
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
            difficulty: (layer.difficulty !== undefined && layer.difficulty !== null && layer.difficulty !== '')
                ? number(layer.difficulty)
                : (previous?.difficulty !== undefined ? previous.difficulty : null),
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
        if (layer.copiedFromTakeoffLayerId && !item.copiedFromTakeoffLayerId) {
            item.copiedFromTakeoffLayerId = stringId(layer.copiedFromTakeoffLayerId);
        }
        if (Array.isArray(previous?.children) && previous.children.length > 0) {
            item.children = JSON.parse(JSON.stringify(previous.children));
            item.isAssembly = true;
        } else if (Array.isArray(layer.children) && layer.children.length > 0) {
            item.children = JSON.parse(JSON.stringify(layer.children));
            item.isAssembly = true;
            item.itemType = 'assembly';
        } else if (Array.isArray(item.catalogSnapshot?.assemblyComponents) && item.catalogSnapshot.assemblyComponents.length > 0
            && (!Array.isArray(item.children) || item.children.length === 0)) {
            item.children = item.catalogSnapshot.assemblyComponents.map((comp, idx) => ({
                id: `${item.id}_comp_${idx}`,
                catalogItemId: comp.catalogItemId ?? comp.part_catalog_item_id ?? null,
                assemblyComponentId: comp.id ?? null,
                name: comp.name || 'Assembly component',
                description: comp.description || '',
                uom: comp.uom || 'ea',
                itemType: comp.itemType || 'part',
                costCode: comp.costCode || '',
                ratio: number(comp.quantity || 1),
                quantity: number(comp.quantity || 1),
                ratioType: comp.ratioType || 'per_unit',
                spacing: comp.spacing ?? null,
                componentWaste: number(comp.waste || 0),
                pricingSnapshot: comp.pricingSnapshot ? JSON.parse(JSON.stringify(comp.pricingSnapshot)) : undefined,
                unitMaterialCost: number(comp.pricingSnapshot?.materialUnitCost),
                unitEquipmentCost: number(comp.pricingSnapshot?.equipmentUnitCost),
                unitSubcontractorCost: number(comp.pricingSnapshot?.subcontractorUnitCost),
                unitLabor: number(comp.pricingSnapshot?.laborHoursPerUnit),
                laborUnitType: 'hrs',
                laborRate: number(comp.pricingSnapshot?.laborRate) > 0 ? number(comp.pricingSnapshot.laborRate) : null
            }));
            item.isAssembly = true;
            item.itemType = 'assembly';
        }
        if (item.isAssembly
            || layer.isAssembly === true
            || String(layer.itemType || layer.item_type || item.catalogSnapshot?.type || layer.catalogMetadata?.type || '').toLowerCase() === 'assembly') {
            item.isAssembly = true;
            item.itemType = 'assembly';
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

    function reconcileLinkedOnly(existingGroups = [], incomingGroups = [], options = {}) {
        const incomingByLayer = new Map();
        const incomingGroupById = new Map();
        const incomingGroupByTakeoffId = new Map();
        (incomingGroups || []).forEach(group => {
            const gId = stringId(group.id);
            const tgId = stringId(group.takeoffGroupId);
            if (gId) incomingGroupById.set(gId, group);
            if (tgId) incomingGroupByTakeoffId.set(tgId, group);
            (group.items || group.layers || []).forEach(layer => {
                const layerId = stringId(layer.takeoffLayerId ?? layer.id);
                if (layerId) incomingByLayer.set(layerId, { layer, group });
            });
        });
        const consumed = new Set();
        const existingLayerIds = new Set();
        const result = (existingGroups || []).map((group, groupIndex) => {
            const gId = stringId(group.id);
            const tgId = stringId(group.takeoffGroupId);
            let matchedIncomingGroup = (gId && incomingGroupById.get(gId))
                || (tgId && incomingGroupByTakeoffId.get(tgId))
                || null;
            const items = (group.items || []).flatMap(existing => {
                const layerId = stringId(existing.takeoffLayerId);
                if (!layerId) return [{ ...existing }];
                // A Takeoff layer has exactly one Estimating row. Legacy sync
                // races could persist duplicates; retain the first canonical
                // row deterministically and discard later aliases.
                if (existingLayerIds.has(layerId)) return [];
                existingLayerIds.add(layerId);
                const incoming = incomingByLayer.get(layerId);
                // Loading one drawing is not proof that a linked item was
                // deleted from the estimate. Keep unreported bindings unless
                // the caller carries explicit destructive intent.
                if (!incoming) return options.removeMissing === true ? [] : [{ ...existing }];
                if (!matchedIncomingGroup && incoming.group) matchedIncomingGroup = incoming.group;
                consumed.add(layerId);
                return [takeoffItem({ ...incoming.layer, id: layerId }, incoming.group, existing)];
            });
            const isTakeoffLinkedGroup = Boolean(
                group.source === 'takeoff'
                || group.takeoffMirror
                || group.takeoffGroupId
                || String(group.id || '').startsWith('takeoff_')
            );
            return {
                ...group,
                name: (isTakeoffLinkedGroup && matchedIncomingGroup?.name) ? matchedIncomingGroup.name : group.name,
                items,
                sortOrder: group.sortOrder ?? groupIndex
            };
        });
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
