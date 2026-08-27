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
        const quantity = number(layer.quantity);
        const item = {
            ...(previous || {}),
            id: previous?.id || `takeoff_${stringId(layer.id)}`,
            takeoffLayerId: stringId(layer.id),
            catalogItemId: layer.catalogItemId ?? layer.catalog_item_id ?? previous?.catalogItemId ?? null,
            name: layer.name || 'Takeoff item',
            description: layer.description || '',
            quantity,
            originalQuantity: quantity,
            lastSyncedTakeoffQuantity: quantity,
            pendingTakeoffQuantity: null,
            quantityOverride: false,
            quantitySource: 'takeoff',
            quantitySyncStatus: 'synced',
            uom: layer.uom || layer.unit_of_measure || 'ea',
            unitMaterialCost: number(layer.unitMaterialCost ?? layer.unitCost ?? layer.unit_cost ?? previous?.unitMaterialCost),
            unitLabor: number(layer.unitLabor ?? layer.laborHours ?? layer.labor_hours ?? previous?.unitLabor),
            laborUnitType: layer.laborUnitType || previous?.laborUnitType || 'hrs',
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
            CatalogSnapshot.refreshEffectiveLegacyFields(item);
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

    const service = { reconcile, takeoffItem };
    global.TakeoffEstimatingSyncService = service;
    if (typeof module !== 'undefined') module.exports = service;
})(typeof window !== 'undefined' ? window : globalThis);
