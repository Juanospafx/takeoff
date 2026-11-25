(function () {
    const apiUrl = '../api/takeoff.php';
    const state = {
        tool: 'select',
        catalog: { items: [] },
        assemblies: { assemblies: [], items: [] },
        layers: [],
        markers: [],
        segments: [],
        selectedItemId: null,
        selectedAssemblyId: null,
        selectedLayerUid: null,
        selectedLayerUids: new Set(),
        collapsedGroups: new Set(),
        layerSearch: '',
        layerGroupFilter: '',
        layerTypeFilter: '',
        createCatalogItemId: null,
        createLayerMode: null,
        createLayerGroup: 'Ungrouped',
        selectedElement: null,
        selectedObjectUids: new Set(),
        continuousTool: false,
        annotationPlacement: false,
        panMode: false,
        temporaryPan: false,
        addNodeArmed: false,
        selectionDrag: null,
        draftLine: null,
        draftArea: null,
        projectControlled: false,
        undo: [],
        redo: [],
        dirty: false,
    };

    const uid = () => 'tf_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
    const countPlacementGuard = window.TakeoffPlacementGuard?.createPlacementGuard({
        windowMs: 500,
        coordinateTolerance: 0.5
    }) || null;
    const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    const money = (v) => '$' + num(v).toFixed(2);
    let takeoffAutosaveTimer = null;
    const dirtyTakeoffPages = new Set();
    const dirtyTakeoffPageGenerations = new Map();
    const dirtyTakeoffObjects = new Map();
    const deletedTakeoffObjects = new Map();
    const deletedTakeoffLayers = new Set();
    const pendingLayerNameUpdates = new Map();
    const takeoffObjectBaseVersions = new Map();
    const dirtyTakeoffObjectGenerations = new Map();
    let takeoffDirtyGeneration = 0;
    let hasPendingManualCanvasCheckpoint = false;
    let missingScaleWarningShown = false;
    let selectionRectDraft = null;
    let linearPointerWorld = null;
    let linearShiftPressed = false;
    let takeoffServerRevision = 0;
    let takeoffRemoteSyncInFlight = false;
    let takeoffRemotePollTimer = null;

    function layerTrackingKeys(layer) {
        if (!layer) return [];
        if (typeof layer !== 'object') return [String(layer)].filter(Boolean);
        return [
            layer.client_uid,
            layer.integration_key,
            layer.metadata_json?.project_layer_id,
            layer.id
        ].filter(v => v !== undefined && v !== null && String(v) !== '').map(String);
    }

    function trackDeletedLayer(layer) {
        layerTrackingKeys(layer).forEach(k => deletedTakeoffLayers.add(k));
    }

    function untrackDeletedLayer(layerOrId) {
        layerTrackingKeys(layerOrId).forEach(k => deletedTakeoffLayers.delete(k));
    }

    function trackTakeoffObjects(targets, deleted = false) {
        (targets || []).forEach(target => {
            const ref = target?.ref || target;
            const id = String(ref?.client_uid || '');
            if (!id) return;
            if (!takeoffObjectBaseVersions.has(id)) {
                takeoffObjectBaseVersions.set(id, ref?._serverUpdatedAt ?? ref?.updated_at ?? ref?.updatedAt ?? null);
            }
            const record = { id, type: target?.type || (state.markers.includes(ref) ? 'marker' : 'segment'),
                layerId: String(ref?.layer_client_uid || ''), page: Number(ref?.page_number || pageNum || 1) };
            (deleted ? deletedTakeoffObjects : dirtyTakeoffObjects).set(id, record);
            if (deleted) dirtyTakeoffObjects.delete(id);
            dirtyTakeoffObjectGenerations.set(id, ++takeoffDirtyGeneration);
        });
    }

    function warnMissingScale() {
        if (hasPlanScale()) {
            missingScaleWarningShown = false;
            return;
        }
        if (missingScaleWarningShown) return;
        missingScaleWarningShown = true;
        showToast('Drawing scale is not defined. Set the scale to calculate quantities.', 'warning');
    }

    function requirePlanScale(measurement = 'linear') {
        if (hasPlanScale()) {
            missingScaleWarningShown = false;
            return true;
        }
        warnMissingScale();
        try {
            window.parent?.postMessage({
                type: 'project-takeoff-scale-required',
                payload: { measurement, message: 'Set the drawing scale before adding linear items.' }
            }, '*');
        } catch (error) {}
        return false;
    }

    function currentProjectId() {
        return typeof projectId !== 'undefined' ? String(projectId) : '0';
    }

    function currentDocumentId() {
        return typeof fileId !== 'undefined' ? String(fileId) : 'drawing';
    }

    function currentEstimateKey() {
        return String(window.__projectTakeoffEstimateKey || new URLSearchParams(window.location.search).get('estimate_key') || 'est_primary');
    }

    function sheetIdFor(page = pageNum) {
        return `${currentDocumentId()}:${Number(page || 1)}`;
    }

    function timestamp() {
        return new Date().toISOString();
    }

    function assignNewPlacementIdentity(marker, preferredOperationId = null) {
        if (!marker || typeof marker !== 'object') return marker;
        const placementOperationId = preferredOperationId || uid();
        marker.placement_operation_id = placementOperationId;
        marker.metadata_json = {
            ...(marker.metadata_json || {}),
            placement_operation_id: placementOperationId
        };
        return marker;
    }
    function serializeTakeoffState() {
        return {
            version: 2,
            savedAt: Date.now(),
            drawing_id: typeof fileId !== 'undefined' ? fileId : null,
            project_id: typeof projectId !== 'undefined' ? projectId : 0,
            estimate_key: currentEstimateKey(),
            layers: state.layers.map(stripNodes),
            markers: state.markers.map(stripNodes),
            segments: state.segments.map(stripNodes),
            summary: calculateTakeoffSummary()
        };
    }

    let takeoffAutosaveInFlight = false;
    let takeoffAutosaveQueued = false;

    function scheduleTakeoffAutosave(delayMs = 1800) {
        const waitMs = Math.max(100, Number(delayMs) || 1800);
        clearTimeout(takeoffAutosaveTimer);
        takeoffAutosaveTimer = setTimeout(() => {
            if (takeoffAutosaveInFlight) {
                takeoffAutosaveQueued = true;
                return;
            }
            takeoffAutosaveInFlight = true;
            Promise.resolve(saveTakeoff(true)).finally(() => {
                takeoffAutosaveInFlight = false;
                if (takeoffAutosaveQueued) {
                    takeoffAutosaveQueued = false;
                    scheduleTakeoffAutosave(250);
                }
            });
        }, waitMs);
    }

    function request(action, payload, method) {
        const url = method === 'GET'
            ? `${apiUrl}?action=${encodeURIComponent(action)}&${new URLSearchParams(payload || {}).toString()}`
            : apiUrl;
        const options = method === 'GET' ? {} : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload }),
        };
        return fetch(url, options).then(async r => {
            let body;
            try { body = await r.json(); } catch (_) {
                throw new Error(`Takeoff request failed (${r.status || 'invalid response'}).`);
            }
            if (!r.ok || body?.status === 'error') {
                throw new Error(body?.msg || body?.error?.message || `Takeoff request failed (${r.status}).`);
            }
            return body;
        });
    }

    function escapeHtml(v) {
        return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
    }

    function stripNodes(entry) {
        const copy = { ...entry };
        delete copy.node;
        delete copy.labelNode;
        delete copy.handles;
        delete copy.symbolNode;
        delete copy.transformer;
        copy.metadata_json = window.CatalogMetadata.clone(entry?.metadata_json || {});
        if (entry?.catalogMetadata) copy.catalogMetadata = window.CatalogMetadata.clone(entry.catalogMetadata);
        return copy;
    }

    function persistLayerCostSnapshot(layer) {
        if (!layer) return layer;
        layer.metadata_json = {
            ...window.CatalogMetadata.clone(layer.metadata_json || {}),
            project_layer_id: layer.metadata_json?.project_layer_id || layer.client_uid,
            unit_cost: num(layer.unit_cost || 0),
            unit_labor_time: num(layer.unit_labor_time || layer.labor_hours || 0),
            difficulty: num(layer.difficulty ?? layer.metadata_json?.difficulty ?? 1),
            multiplier: num(layer.multiplier ?? layer.metadata_json?.multiplier ?? 1),
            cost_code: layer.cost_code || '',
            catalog_item_id: layer.catalog_item_id || null
        };
        return layer;
    }

    function restoreLayerCostSnapshot(layer) {
        const metadata = window.CatalogMetadata.clone(layer?.metadata_json || {});
        const hasSnapshotCost = Object.prototype.hasOwnProperty.call(metadata, 'unit_cost');
        const hasSnapshotLabor = Object.prototype.hasOwnProperty.call(metadata, 'unit_labor_time');
        return {
            ...layer,
            unit_cost: num(hasSnapshotCost ? metadata.unit_cost : (layer.unit_cost ?? 0)),
            unit_labor_time: num(hasSnapshotLabor ? metadata.unit_labor_time : (layer.unit_labor_time ?? layer.labor_hours ?? 0)),
            difficulty: num(metadata.difficulty ?? layer.difficulty ?? 1),
            multiplier: num(metadata.multiplier ?? layer.multiplier ?? 1),
            cost_code: metadata.cost_code || layer.cost_code || '',
            catalog_item_id: layer.catalog_item_id || metadata.catalog_item_id || null,
            catalogMetadata: window.CatalogMetadata.clone(metadata.catalog_item || layer.catalogMetadata || null),
            metadata_json: metadata
        };
    }

    const MAX_TAKEOFF_HISTORY = 10;

    function snapshot() {
        state.undo.push(JSON.stringify({
            layers: state.layers,
            markers: state.markers.map(stripNodes),
            segments: state.segments.map(stripNodes),
        }));
        if (state.undo.length > MAX_TAKEOFF_HISTORY) state.undo.shift();
        state.redo = [];
    }

    function restore(raw) {
        clearNodes();
        const data = JSON.parse(raw);
        state.layers = data.layers || [];
        state.markers = data.markers || [];
        state.segments = data.segments || [];
        renderNodes();
        renderAll();
        state.dirty = true;
        hasPendingManualCanvasCheckpoint = true;
        emitProjectState(true);
        scheduleTakeoffAutosave();
    }

    function currentItem() {
        return state.catalog.items.find(i => String(i.id) === String(state.selectedItemId)) || null;
    }

    function currentAssembly() {
        return state.assemblies.assemblies.find(a => String(a.id) === String(state.selectedAssemblyId)) || null;
    }

    function createLayer(overrides) {
        const hasOverrideItem = overrides && Object.prototype.hasOwnProperty.call(overrides, 'catalog_item_id');
        const overrideItemId = hasOverrideItem ? overrides.catalog_item_id : null;
        const item = hasOverrideItem
            ? (overrideItemId ? state.catalog.items.find(i => String(i.id) === String(overrideItemId)) || null : null)
            : currentItem();
        const assembly = currentAssembly();
        const takeoffType = overrides?.takeoff_type || overrides?.type || (state.tool === 'takeoff_linear' ? 'linear' : 'count');
        const layer = {
            client_uid: uid(),
            page_number: pageNum || 1,
            name: overrides?.name || assembly?.name || item?.name || 'Takeoff Layer',
            type: takeoffType,
            takeoff_type: takeoffType,
            group_name: overrides?.group_name || item?.group_name || item?.category_name || 'Ungrouped',
            unit_of_measure: overrides?.unit_of_measure || assembly?.unit_of_measure || item?.unit_of_measure || (state.tool === 'takeoff_linear' ? 'ft' : 'ea'),
            catalog_item_id: item ? Number(item.id) : null,
            assembly_id: assembly ? Number(assembly.id) : null,
            color: overrides?.color || item?.color || '#2563eb',
            symbol: overrides?.symbol || item?.symbol || 'circle',
            symbol_size: overrides?.symbol_size || 'Medium',
            unit_cost: num(overrides?.unit_cost ?? item?.unit_cost ?? 0),
            unit_labor_time: num(overrides?.unit_labor_time ?? item?.labor_hours ?? 0),
            cost_code: overrides?.cost_code || item?.cost_code || '',
            estimate_item_id: overrides?.estimate_item_id || null,
            visible: 1,
            locked: 0,
            tag: null,
            metadata_json: {},
        };
        layer.metadata_json.project_layer_id = layer.client_uid;
        state.layers.push(layer);
        state.selectedLayerUid = layer.client_uid;
        return layer;
    }

    function activeLayer() {
        const layer = state.layers.find(l => l.client_uid === state.selectedLayerUid) || null;
        if (layer) return layer;
        return state.projectControlled ? null : createLayer();
    }

    function activePlacementLayer() {
        if (state.panMode || state.temporaryPan || state.annotationPlacement) return null;
        const layer = activeLayer();
        if (!layer) return null;
        const expectedTool = layerType(layer) === 'linear'
            ? 'takeoff_linear'
            : (layerType(layer) === 'area' ? 'takeoff_area' : 'takeoff_count');
        return state.tool === expectedTool ? layer : null;
    }

    function layerMultiplier(layer) {
        const raw = layer?.multiplier ?? layer?.metadata_json?.multiplier;
        const n = num(raw);
        return (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(n) && n >= 0) ? n : 1;
    }

    function calculateCountQuantity(marker) {
        const raw = marker?.multiplier;
        if (raw !== undefined && raw !== null && raw !== '') {
            const n = num(raw);
            return Number.isFinite(n) && n >= 0 ? n : 1;
        }
        return 1;
    }

    function calculateLinearLength(segment) {
        if (String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area') return calculateAreaQuantity(segment);
        const points = segment.points_json || [];
        let px = 0;
        for (let index = 1; index < points.length; index++) {
            const dx = points[index].x - points[index - 1].x;
            const dy = points[index].y - points[index - 1].y;
            px += Math.sqrt(dx * dx + dy * dy);
        }
        const segPage = segment.page_number ?? segment.page ?? (typeof pageNum !== 'undefined' ? pageNum : 1);
        const scale = getPlanScale(segPage);
        if (!(scale > 0)) {
            const persistedTotal = num(segment.total_length);
            const persistedMeasured = num(segment.measured_length);
            if (persistedTotal > 0 || persistedMeasured > 0) {
                return persistedTotal > 0 ? persistedTotal : persistedMeasured * num(segment.multiplier || 1);
            }
        }
        const horizontal = scale > 0 ? px / scale : 0;
        const layer = state.layers.find(row =>
            String(row.client_uid) === String(segment?.layer_client_uid || '')
            || String(row.id || '') === String(segment?.layer_id || '')
        );
        const subtype = normalizeLinearSubtype(
            segment.takeoff_subtype
            || segment.metadata_json?.takeoff_subtype
            || layer?.takeoff_subtype
            || layer?.original_takeoff_type
            || segment.takeoff_type
            || segment.type
        );
        const dropLength = (subtype === 'linear' || subtype === 'count_by_distance')
            ? 0
            : Math.max(0, num(segment.drop_length ?? segment.dropLength ?? layer?.drop_length ?? layer?.dropLength));
        // Each committed vertex is a defined drop point. Editing vertices via
        // the existing handles therefore recalculates both run and drops.
        const dropCount = subtype === 'linear' ? 0 : points.length;
        const drops = dropLength * dropCount;
        const measured = horizontal + drops;
        segment.takeoff_subtype = subtype;
        segment.horizontal_length = horizontal;
        segment.drop_length = dropLength;
        segment.drop_count = dropCount;
        segment.drop_total = drops;
        segment.measured_length = measured;
        segment.total_length = measured * num(segment.multiplier || 1);
        segment.scale_pixels_per_unit = scale;
        segment.unit = 'ft';

        if (subtype === 'linear_avg_with_drop') {
            // Round drawn canvas length to whole integer first; average + single drop computes in layerQuantity().
            const roundedHorizontal = Math.round(horizontal);
            segment.drop_count = 0;
            segment.drop_total = 0;
            segment.measured_length = roundedHorizontal;
            segment.total_length = roundedHorizontal * num(segment.multiplier || 1);
            segment.unit = 'ft';
        } else if (subtype === 'count_by_distance') {
            const spacing = Math.max(0, num(segment.spacing ?? segment.metadata_json?.spacing ?? layer?.spacing ?? layer?.metadata_json?.spacing));
            const effectiveSpacing = spacing > 0 ? spacing : 1;
            const spacedCount = horizontal > 0 ? Math.ceil(Math.max(0, (horizontal / effectiveSpacing) - 1e-6)) : 0;
            segment.spacing = effectiveSpacing;
            segment.drop_count = 0;
            segment.drop_total = 0;
            segment.measured_length = spacedCount;
            segment.total_length = spacedCount * num(segment.multiplier || 1);
            segment.unit = layer?.unit_of_measure || 'ea';
        }
        return segment.total_length;
    }

    function normalizeLinearSubtype(value) {
        const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (raw === 'linear with drop') return 'linear_with_drop';
        if (raw === 'linear avg. with drop' || raw === 'linear avg with drop') return 'linear_avg_with_drop';
        if (raw === 'count by distance' || raw === 'count_by_distance') return 'count_by_distance';
        if (raw === 'linear_with_drop' || raw === 'linear_avg_with_drop') return raw;
        return 'linear';
    }

    function normalizeEditorLayerType(value) {
        const raw = String(value || 'count').trim().toLowerCase();
        if (raw === 'area' || raw === 'area / volume' || raw === 'vertical wall area') return { type: 'area', subtype: 'area' };
        if (raw === 'linear' || raw === 'linear with drop' || raw === 'linear avg. with drop'
            || raw === 'linear avg with drop' || raw === 'linear_with_drop' || raw === 'linear_avg_with_drop'
            || raw === 'count by distance' || raw === 'count_by_distance') {
            return { type: 'linear', subtype: normalizeLinearSubtype(raw) };
        }
        return { type: 'count', subtype: 'count' };
    }

    function calculateAreaQuantity(segment) {
        const points = segment.points_json || [];
        if (points.length < 3) {
            segment.measured_area = 0;
            segment.total_area = 0;
            segment.total_length = 0;
            segment.unit = segment.unit || 'sq ft';
            return 0;
        }
        let pxArea = 0;
        points.forEach((point, index) => {
            const next = points[(index + 1) % points.length];
            pxArea += point.x * next.y - next.x * point.y;
        });
        pxArea = Math.abs(pxArea) / 2;
        const segPage = segment.page_number ?? segment.page ?? (typeof pageNum !== 'undefined' ? pageNum : 1);
        const scale = getPlanScale(segPage);
        if (!(scale > 0)) {
            const persistedTotal = num(segment.total_area ?? segment.total_length);
            const persistedMeasured = num(segment.measured_area);
            if (persistedTotal > 0 || persistedMeasured > 0) {
                return persistedTotal > 0 ? persistedTotal : persistedMeasured * num(segment.multiplier || 1);
            }
        }
        const measured = scale > 0 ? pxArea / (scale * scale) : 0;
        segment.measured_area = measured;
        segment.total_area = measured * num(segment.multiplier || 1);
        segment.total_length = segment.total_area;
        segment.scale_pixels_per_unit = scale;
        segment.unit = segment.unit || 'sq ft';
        return segment.total_area;
    }

    function getPlanScale(pageNumber = null) {
        const targetPage = pageNumber !== null && pageNumber !== undefined ? pageNumber : (typeof pageNum !== 'undefined' ? pageNum : null);
        if (targetPage !== null && window.sheetScales) {
            const sc = window.sheetScales[targetPage] ?? window.sheetScales[Number(targetPage)] ?? window.sheetScales[String(targetPage)];
            if (Number(sc) > 0) return Number(sc);
        }
        if (typeof window.pixelsPerFoot !== 'undefined' && Number(window.pixelsPerFoot) > 0) {
            return Number(window.pixelsPerFoot);
        }
        if (typeof pixelsPerFoot !== 'undefined' && Number(pixelsPerFoot) > 0) {
            return Number(pixelsPerFoot);
        }
        if (window.sheetScales) {
            for (const k in window.sheetScales) {
                if (Number(window.sheetScales[k]) > 0) return Number(window.sheetScales[k]);
            }
        }
        return 0;
    }

    function hasPlanScale(pageNumber = null) {
        return getPlanScale(pageNumber) > 0;
    }

    function formatFeetLabel(feet) {
        if (typeof formatFeetForDisplay === 'function') return formatFeetForDisplay(feet);
        return `${num(feet).toFixed(2)} ft`;
    }

    function formatAreaLabel(area) {
        return `${num(area).toFixed(2)} sq ft`;
    }

    function pointsLength(points, pageNumber = null) {
        let px = 0;
        for (let index = 1; index < (points || []).length; index++) {
            const dx = points[index].x - points[index - 1].x;
            const dy = points[index].y - points[index - 1].y;
            px += Math.sqrt(dx * dx + dy * dy);
        }
        const scale = getPlanScale(pageNumber);
        return scale > 0 ? px / scale : 0;
    }

    window.projectTakeoffUpdateScale = function(pNum, scaleValue, applyAll) {
        if (!window.sheetScales) window.sheetScales = {};
        if (applyAll) {
            (state.segments || []).forEach(segment => {
                if (segment.takeoff_type === 'linear' || segment.type === 'linear') {
                    calculateLinearLength(segment);
                } else if (segment.takeoff_type === 'area' || segment.type === 'area') {
                    calculateAreaQuantity(segment);
                }
            });
        } else {
            (state.segments || []).forEach(segment => {
                const segPage = segment.page_number ?? segment.page ?? 1;
                if (Number(segPage) === Number(pNum)) {
                    if (segment.takeoff_type === 'linear' || segment.type === 'linear') {
                        calculateLinearLength(segment);
                    } else if (segment.takeoff_type === 'area' || segment.type === 'area') {
                        calculateAreaQuantity(segment);
                    }
                }
            });
        }
        try { renderProperties(); } catch (e) {}
        try { emitData(); } catch (e) {}
    };

    function calculateItemCost(item, quantity) {
        if (!item) return { unitCost: 0, material: 0, labor: 0, equipment: 0, total: 0, laborHours: 0, waste: 0, markup: 0 };
        const wasteQty = quantity * (num(item.waste_factor) / 100);
        const pricedQty = quantity + wasteQty;
        const material = pricedQty * num(item.material_cost || item.unit_cost);
        const laborHours = pricedQty * num(item.labor_hours);
        const labor = pricedQty * num(item.labor_cost || (num(item.labor_hours) * num(item.labor_rate)));
        const equipment = pricedQty * num(item.equipment_cost);
        const subtotal = material + labor + equipment + pricedQty * num(item.subcontractor_cost);
        const markup = subtotal * (num(item.markup) / 100);
        return { unitCost: num(item.unit_cost), material, labor, equipment, total: subtotal + markup, laborHours, waste: wasteQty, markup };
    }

    function calculateAssemblyQuantity(component, base) {
        const quantity = num(component.quantity || 1);
        if (component.ratio_type === 'fixed') return quantity;
        if (component.ratio_type === 'per_endpoint') return quantity * 2;
        if (component.ratio_type === 'spacing_based') return Math.ceil(base / Math.max(num(component.spacing_value), 1)) * quantity;
        return quantity * base;
    }

    function calculateAssemblyCost(assembly, baseQty) {
        const components = state.assemblies.items.filter(i => String(i.assembly_id) === String(assembly.id));
        const total = { material: 0, labor: 0, equipment: 0, total: 0, laborHours: 0, details: [] };
        components.forEach(component => {
            const item = state.catalog.items.find(i => String(i.id) === String(component.catalog_item_id));
            const quantity = calculateAssemblyQuantity(component, baseQty);
            const cost = calculateItemCost(item, quantity + quantity * (num(component.waste_factor) / 100));
            total.material += cost.material;
            total.labor += cost.labor;
            total.equipment += cost.equipment;
            total.total += cost.total;
            total.laborHours += cost.laborHours;
            total.details.push({ component, item, quantity, cost });
        });
        if (assembly.override_cost !== null && assembly.override_cost !== undefined && assembly.override_cost !== '') {
            total.total = num(assembly.override_cost) * baseQty;
        }
        return total;
    }

    function calculateLaborHours(quantity, item, assembly) {
        return assembly ? calculateAssemblyCost(assembly, quantity).laborHours : calculateItemCost(item, quantity).laborHours;
    }

    function calculateTakeoffSummary() {
        const rows = [];
        state.layers.forEach(layer => {
            const quantity = layerQuantity(layer);
            const item = layerCatalogItem(layer);
            const assembly = layerAssembly(layer);
            const source = item || layer;
            const seed = {
                layerUid: layer.client_uid,
                itemId: item?.id || layer.catalog_item_id || null,
                assemblyId: assembly?.id || layer.assembly_id || null,
                item: layer.name || item?.name || 'Manual takeoff',
                assembly: assembly?.name || '',
                type: layerTypeLabel(layer),
                unit: layerUnit(layer),
                group: layerGroup(layer),
                sourceType: layer.estimate_item_id ? 'takeoff' : (item ? 'catalog' : 'manual'),
                estimateLinked: Boolean(layer.estimate_item_id || item),
            };
            const row = { ...seed, quantity, unitCost: 0, laborHours: 0, material: 0, labor: 0, total: 0, waste: 0, markup: 0, components: [] };
            if (assembly) {
                const cost = calculateAssemblyCost(assembly, quantity);
                row.unitCost = quantity ? cost.total / quantity : 0;
                row.laborHours = cost.laborHours;
                row.material = cost.material;
                row.labor = cost.labor;
                row.total = cost.total;
                row.components = cost.details;
            } else {
                const cost = calculateItemCost(source, quantity);
                row.unitCost = cost.unitCost;
                row.laborHours = cost.laborHours || (quantity * num(layer.unit_labor_time || 0));
                row.material = cost.material || (quantity * num(layer.unit_cost || 0));
                row.labor = cost.labor;
                row.total = cost.total || row.material + row.labor;
                row.waste = cost.waste;
                row.markup = cost.markup;
            }
            rows.push(row);
        });
        return rows;
    }

    function ensureKonva() {
        initKonvaRuler();
        if (!konvaStage || !konvaLayer) return false;
        setKonvaActive(true);
        return true;
    }

    function flushKonvaCanvasDraw(immediate = false) {
        if (!konvaLayer) return;
        const w = document.getElementById('canvas-wrapper');
        if (!w || w.clientWidth <= 0 || w.clientHeight <= 0 || document.hidden) return;
        if (typeof konvaStage !== 'undefined' && konvaStage && (konvaStage.width() <= 0 || konvaStage.height() <= 0)) return;
        konvaLayer._waitingForDraw = false;
        if (immediate) konvaLayer.draw();
        else konvaLayer.batchDraw();
    }

    function screenToWorld(pos) {
        const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        return { x: (pos.x - vpt[4]) / vpt[0], y: (pos.y - vpt[5]) / vpt[3] };
    }

    function snapPointTo45(start, cursor, enabled) {
        if (!enabled || !start || !cursor) return cursor;
        const dx = cursor.x - start.x;
        const dy = cursor.y - start.y;
        const distance = Math.hypot(dx, dy);
        if (!distance) return { x: start.x, y: start.y };
        const step = Math.PI / 4;
        const snappedAngle = Math.round(Math.atan2(dy, dx) / step) * step;
        return {
            x: start.x + Math.cos(snappedAngle) * distance,
            y: start.y + Math.sin(snappedAngle) * distance
        };
    }

    function linearPointForPointer(cursor, shiftPressed) {
        const points = state.draftLine?.points || [];
        const start = points[points.length - 1];
        return start ? snapPointTo45(start, cursor, Boolean(shiftPressed)) : cursor;
    }

    function activeDraftLayerSubtype(layer = null) {
        const resolved = layer || activeLayer();
        return normalizeLinearSubtype(
            resolved?.takeoff_subtype
            || resolved?.original_takeoff_type
            || resolved?.takeoff_type
            || resolved?.type
        );
    }

    function positionLinearDraftLabel(lastPoint, nextPoint) {
        const label = state.draftLine?.lengthLabel;
        if (!label || !lastPoint || !nextPoint) return;
        const dx = nextPoint.x - lastPoint.x;
        const dy = nextPoint.y - lastPoint.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
            label.visible(false);
            return;
        }
        const partial = pointsLength([lastPoint, nextPoint]);
        const draftSub = state.draftLine?.subtype || activeDraftLayerSubtype();
        label.text(draftSub === 'linear_avg_with_drop' ? `${Math.round(partial)} ft` : formatFeetLabel(partial));
        const viewportScale = Number(canvas?.viewportTransform?.[0] || 1);
        const factor = viewportScale > 0 ? 1 / viewportScale : 1;
        const labelScale = Math.max(0.45, Math.min(1.6, factor));
        label.scale({ x: labelScale, y: labelScale });
        label.offsetX(label.width() / 2);
        label.offsetY(label.height() / 2);
        const midX = (lastPoint.x + nextPoint.x) / 2;
        const midY = (lastPoint.y + nextPoint.y) / 2;
        const isVertical = Math.abs(dy) > Math.abs(dx) * 1.5;
        const scaledH = label.height() * labelScale;
        if (isVertical) {
            const scaledW = label.width() * labelScale;
            label.position({ x: midX + (scaledW * 0.5 + 8 * labelScale), y: midY });
        } else {
            let nx = -dy / dist;
            let ny = dx / dist;
            if (ny > 0 || (Math.abs(ny) < 0.001 && nx < 0)) {
                nx = -nx;
                ny = -ny;
            }
            const offsetDist = Math.max(8 * labelScale, scaledH * 0.65 + 4 * labelScale);
            label.position({ x: midX + nx * offsetDist, y: midY + ny * offsetDist });
        }
        label.visible(true);
        label.moveToTop();
    }

    let linearStatusRaf = null;
    let linearStatusPoint = null;
    function scheduleLinearStatusUpdate(point) {
        linearStatusPoint = point;
        if (linearStatusRaf) return;
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : cb => setTimeout(cb, 16);
        linearStatusRaf = raf(() => {
            linearStatusRaf = null;
            updateDrawingStatus(linearStatusPoint);
        });
    }

    function renderLinearPreview(cursor = linearPointerWorld, shiftPressed = linearShiftPressed) {
        if (state.tool !== 'takeoff_linear' || !state.draftLine?.preview || !state.draftLine.points.length || !cursor) return false;
        const point = linearPointForPointer(cursor, shiftPressed);
        state.draftLine.preview.points([...state.draftLine.points, point].flatMap(value => [value.x, value.y]));
        const last = state.draftLine.points[state.draftLine.points.length - 1];
        positionLinearDraftLabel(last, point);
        scheduleLinearStatusUpdate(point);
        konvaLayer?.batchDraw();
        return true;
    }

    function normalizeSymbol(symbol) {
        const raw = String(symbol || '').trim().toLowerCase();
        if (raw.includes('hollow')) return 'hollow circle';
        if (raw.includes('solid') && raw.includes('circle')) return 'circle';
        if (raw.includes('checkmark') || raw.includes('check')) return 'checkmark';
        if (raw.includes('octagon')) return 'octagon';
        if (raw.includes('pentagon')) return 'pentagon';
        if (raw.includes('target') || raw.includes('bullseye')) return 'target';
        if (raw.includes('dimension')) return 'dimension';
        if (raw.includes('square')) return 'square';
        if (raw.includes('triangle')) return 'triangle';
        if (raw.includes('diamond')) return 'diamond';
        if (raw.includes('cross') || raw.includes('plus')) return 'cross';
        return 'circle';
    }

    function symbolRadius(size) {
        const numeric = Number(size);
        if (Number.isFinite(numeric) && numeric > 0) return Math.max(4, Math.min(96, numeric));
        const raw = String(size || '').toLowerCase().trim();
        if (raw === 'x-small' || raw === 'xsmall' || raw === 'xs' || raw === 'extra-small' || raw === 'extra small') return 5;
        if (raw === 'small' || raw === 's') return 7;
        if (raw === 'large' || raw === 'l') return 12;
        if (raw === 'x-large' || raw === 'xlarge' || raw === 'xl' || raw === 'extra-large' || raw === 'extra large') return 16;
        if (raw === 'medium' || raw === 'm') return 9;
        return 9;
    }

    function drawSymbol(group, symbol, color, size) {
        symbol = normalizeSymbol(symbol);
        const radius = symbolRadius(size);

        // 1. Hit Area: constrained strictly to the visible symbol geometry
        const hitCommon = {
            fill: 'rgba(0,0,0,0.001)',
            strokeWidth: 0,
            hitStrokeWidth: 0,
            listening: true
        };

        // 2. Selection Ring: non-listening visual outline that highlights upon selection
        const ringCommon = {
            name: 'takeoff-selection-ring',
            stroke: '#38bdf8',
            strokeWidth: 2,
            dash: [4, 3],
            listening: false,
            visible: false
        };

        // 3. Visual Shape: the visible icon matching the shape and color
        const common = {
            fill: color,
            fillOpacity: 0.42,
            stroke: color,
            strokeWidth: 1.5,
            hitStrokeWidth: 1.5,
            listening: true
        };

        if (symbol === 'square') {
            group.add(new Konva.Rect({ x: -(radius + 3), y: -(radius + 3), width: (radius + 3) * 2, height: (radius + 3) * 2, cornerRadius: 2, ...ringCommon }));
            group.add(new Konva.Rect({ x: -radius, y: -radius, width: radius * 2, height: radius * 2, ...common }));
        } else if (symbol === 'triangle') {
            group.add(new Konva.RegularPolygon({ sides: 3, radius: radius + 4, ...ringCommon }));
            group.add(new Konva.RegularPolygon({ sides: 3, radius: radius + 2, ...common }));
        } else if (symbol === 'diamond') {
            group.add(new Konva.RegularPolygon({ sides: 4, radius: radius + 4, rotation: 45, ...ringCommon }));
            group.add(new Konva.RegularPolygon({ sides: 4, radius: radius + 2, rotation: 45, ...common }));
        } else if (symbol === 'cross') {
            const crossW = Math.max(3, radius / 2);
            group.add(new Konva.RegularPolygon({ sides: 4, radius: radius + 4, rotation: 45, ...ringCommon }));
            group.add(new Konva.Line({ points: [-radius, 0, radius, 0], stroke: color, strokeWidth: crossW, hitStrokeWidth: crossW, lineCap: 'round', listening: true }));
            group.add(new Konva.Line({ points: [0, -radius, 0, radius], stroke: color, strokeWidth: crossW, hitStrokeWidth: crossW, lineCap: 'round', listening: true }));
        } else if (symbol === 'octagon') {
            group.add(new Konva.RegularPolygon({ sides: 8, radius: radius + 4, rotation: 22.5, ...ringCommon }));
            group.add(new Konva.RegularPolygon({ sides: 8, radius: radius + 2, rotation: 22.5, ...common }));
        } else if (symbol === 'pentagon') {
            group.add(new Konva.RegularPolygon({ sides: 5, radius: radius + 4, rotation: 0, ...ringCommon }));
            group.add(new Konva.RegularPolygon({ sides: 5, radius: radius + 2, rotation: 0, ...common }));
        } else if (symbol === 'hollow circle') {
            group.add(new Konva.Circle({ radius, ...hitCommon }));
            group.add(new Konva.Circle({ radius: radius + 3, ...ringCommon }));
            group.add(new Konva.Circle({ radius, fill: 'transparent', stroke: color, strokeWidth: 2.2, hitStrokeWidth: 2.2, listening: true }));
        } else if (symbol === 'target') {
            group.add(new Konva.Circle({ radius, ...hitCommon }));
            group.add(new Konva.Circle({ radius: radius + 3, ...ringCommon }));
            group.add(new Konva.Circle({ radius, fill: 'rgba(0,0,0,0.001)', stroke: color, strokeWidth: 1.8, hitStrokeWidth: 1.8, listening: true }));
            group.add(new Konva.Circle({ radius: Math.max(2.5, radius * 0.38), fill: color, stroke: color, strokeWidth: 1, hitStrokeWidth: 1, listening: true }));
            group.add(new Konva.Line({ points: [-radius * 0.75, 0, radius * 0.75, 0], stroke: color, strokeWidth: 1, listening: false }));
            group.add(new Konva.Line({ points: [0, -radius * 0.75, 0, radius * 0.75], stroke: color, strokeWidth: 1, listening: false }));
        } else if (symbol === 'checkmark') {
            group.add(new Konva.Circle({ radius: radius + 3, ...ringCommon }));
            group.add(new Konva.Circle({ radius, fill: color, fillOpacity: 0.20, stroke: color, strokeWidth: 1.2, hitStrokeWidth: 1.2, listening: true }));
            const checkPoints = [-radius * 0.55, 0, -radius * 0.15, radius * 0.50, radius * 0.65, -radius * 0.50];
            group.add(new Konva.Line({ points: checkPoints, stroke: color, strokeWidth: Math.max(2.2, radius * 0.26), lineCap: 'round', lineJoin: 'round', listening: false }));
        } else if (symbol === 'dimension') {
            group.add(new Konva.Rect({ x: -radius, y: -(radius * 0.6), width: radius * 2, height: radius * 1.2, ...hitCommon }));
            group.add(new Konva.Rect({ x: -(radius + 3), y: -(radius + 3), width: (radius + 3) * 2, height: (radius + 3) * 2, ...ringCommon }));
            group.add(new Konva.Line({ points: [-radius, 0, radius, 0], stroke: color, strokeWidth: 2, hitStrokeWidth: 2, lineCap: 'round', listening: true }));
            group.add(new Konva.Line({ points: [-radius, -radius * 0.6, -radius, radius * 0.6], stroke: color, strokeWidth: 2, hitStrokeWidth: 2, listening: true }));
            group.add(new Konva.Line({ points: [radius, -radius * 0.6, radius, radius * 0.6], stroke: color, strokeWidth: 2, hitStrokeWidth: 2, listening: true }));
        } else {
            group.add(new Konva.Circle({ radius: radius + 3, ...ringCommon }));
            group.add(new Konva.Circle({ radius, ...common }));
        }
    }

    function isObjectIndividuallyLocked(ref) {
        return Number(ref?.locked || 0) === 1;
    }

    function buildTakeoffLayerLookup() {
        const lookup = new Map();
        state.layers.forEach(layer => {
            if (layer.client_uid != null) lookup.set(String(layer.client_uid), layer);
            if (layer.integration_key) lookup.set(String(layer.integration_key), layer);
            if (layer.metadata_json?.project_layer_id) lookup.set(String(layer.metadata_json.project_layer_id), layer);
        });
        return lookup;
    }

    function isElementLocked(ref, layerLookup = null) {
        if (isObjectIndividuallyLocked(ref)) return true;
        const layer = layerLookup?.get(String(ref?.layer_client_uid || ''))
            || state.layers.find(row => String(row.client_uid) === String(ref?.layer_client_uid));
        return Number(layer?.locked || 0) === 1;
    }

    function isElementVisibleOnPage(ref, page = pageNum) {
        const layer = state.layers.find(row => String(row.client_uid) === String(ref?.layer_client_uid));
        return Number(ref?.page_number) === Number(page) && Number(layer?.visible ?? 1) !== 0
            && ref?.node?.visible() !== false;
    }

    function isTakeoffDrawingToolActive() {
        return ['takeoff_count', 'takeoff_linear', 'takeoff_area', 'multi-select'].includes(state.tool);
    }

    function isTakeoffObjectInteractionBlocked() {
        if (typeof window.takeoffCanWrite === 'function' && !window.takeoffCanWrite()) return true;
        // Count remains armed for repeated placement, but existing geometry must
        // still receive clicks/drags so it never becomes static after creation.
        return ['takeoff_linear', 'takeoff_area', 'multi-select'].includes(state.tool);
    }

    function applyTakeoffDrawingInteractivity() {
        const panning = state.panMode || state.temporaryPan;
        const listening = !isTakeoffObjectInteractionBlocked() && !panning && !state.annotationPlacement;
        const layerLookup = buildTakeoffLayerLookup();
        state.markers.forEach(marker => {
            if (!marker.node) return;
            marker.node?.listening(listening);
            const unlocked = !isElementLocked(marker, layerLookup);
            marker.node?.draggable(listening && !panning && unlocked);
            marker.transformer?.listening(listening && !panning && unlocked);
        });
        state.segments.forEach(segment => {
            if (!segment.node) return;
            const unlocked = !isElementLocked(segment, layerLookup);
            segment.node?.listening(listening);
            segment.node?.draggable(listening && !panning && unlocked);
            (segment.handles || []).forEach(handle => handle.listening(listening));
            (segment.handles || []).forEach(handle => handle.draggable(listening && !panning && unlocked));
        });
        flushKonvaCanvasDraw();
    }

    function isColorLight(color) {
        if (!color) return true;
        let r = 0, g = 0, b = 0;
        const str = String(color).trim();
        if (str.startsWith('#')) {
            let hex = str.slice(1);
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            const numVal = parseInt(hex, 16);
            r = (numVal >> 16) & 255;
            g = (numVal >> 8) & 255;
            b = numVal & 255;
        } else if (str.startsWith('rgb')) {
            const parts = str.match(/\d+/g);
            if (parts && parts.length >= 3) {
                r = parseInt(parts[0], 10);
                g = parseInt(parts[1], 10);
                b = parseInt(parts[2], 10);
            }
        } else {
            return false;
        }
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness >= 145;
    }

    function createTakeoffLockIcon(color, x = 0, y = 0, scale = 0.65) {
        const isLight = isColorLight(color);
        const lockColor = isLight ? '#0f172a' : '#ffffff';
        return new Konva.Path({
            name: 'takeoff-object-lock',
            x,
            y,
            data: 'M4 6V4a4 4 0 0 1 8 0v2h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1zm2 0h4V4a2 2 0 1 0-4 0v2z',
            fill: lockColor,
            stroke: isLight ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
            strokeWidth: 0.8,
            fillAfterStrokeEnabled: true,
            scale: { x: scale, y: scale },
            shadowColor: isLight ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
            shadowBlur: 2,
            listening: false
        });
    }

    function applyMarkerLockVisual(marker) {
        if (!marker.node) return;
        const locked = isElementLocked(marker);
        marker.node.draggable(!locked && !isTakeoffObjectInteractionBlocked()
            && !state.panMode && !state.temporaryPan && !state.annotationPlacement);
        marker.node.opacity(locked ? 0.55 : 0.70);
        marker.transformer?.visible(!locked && state.selectedObjectUids.has(String(marker.client_uid))
            && isElementVisibleOnPage(marker));
        const ring = marker.node.findOne('.takeoff-selection-ring');
        if (ring) {
            ring.visible(!locked && state.selectedObjectUids.has(String(marker.client_uid)) && isElementVisibleOnPage(marker));
        }
        const existing = marker.node.findOne('.takeoff-object-lock');
        if (existing) existing.destroy();
        if (locked) {
            const markerLayer = state.layers.find(l => String(l.client_uid) === String(marker.layer_client_uid));
            const col = marker.color || markerLayer?.color || '#2563eb';
            const icon = createTakeoffLockIcon(col, 5, -8, 0.65);
            marker.node.add(icon);
        }
    }

    function beginTakeoffSelectionDrag(type, ref) {
        if (!ref?.node) return false;
        if (!state.selectedObjectUids.has(String(ref.client_uid))) selectElement(type, ref);
        const targets = selectedTakeoffObjectIds().map(findTakeoffObjectByUid).filter(Boolean);
        if (!targets.length || targets.some(target => isElementLocked(target.ref))) {
            ref.node.stopDrag?.();
            if (type === 'marker') ref.node.position({ x: num(ref.x), y: num(ref.y) });
            else ref.node.position({ x: 0, y: 0 });
            showToast('Unlock all selected elements before moving them.', 'warning');
            return false;
        }
        snapshot();
        state.selectionDrag = {
            anchor: ref,
            start: { x: ref.node.x(), y: ref.node.y() },
            targets: targets.map(target => ({
                ...target,
                markerX: target.type === 'marker' ? num(target.ref.x) : null,
                markerY: target.type === 'marker' ? num(target.ref.y) : null,
                points: target.type === 'segment' ? (target.ref.points_json || []).map(point => ({ ...point })) : null,
                nodePosition: target.ref.node?.position() || { x: 0, y: 0 },
                labelPosition: target.ref.labelNode?.position() || null,
                handlePositions: (target.ref.handles || []).map(handle => handle.position())
            }))
        };
        return true;
    }

    function updateTakeoffSelectionDrag(ref) {
        const drag = state.selectionDrag;
        if (!drag || drag.anchor !== ref) return;
        const dx = ref.node.x() - drag.start.x;
        const dy = ref.node.y() - drag.start.y;
        drag.targets.forEach(target => {
            if (target.ref !== ref) target.ref.node?.position({ x: target.nodePosition.x + dx, y: target.nodePosition.y + dy });
            if (target.type !== 'segment') return;
            target.ref.labelNode?.position({ x: target.labelPosition.x + dx, y: target.labelPosition.y + dy });
            (target.ref.handles || []).forEach((handle, index) => {
                const origin = target.handlePositions[index];
                if (origin) handle.position({ x: origin.x + dx, y: origin.y + dy });
            });
        });
        flushKonvaCanvasDraw();
    }

    function finishTakeoffSelectionDrag(ref) {
        const drag = state.selectionDrag;
        if (!drag || drag.anchor !== ref) return false;
        const dx = ref.node.x() - drag.start.x;
        const dy = ref.node.y() - drag.start.y;
        drag.targets.forEach(target => {
            if (target.type === 'marker') {
                target.ref.x = target.markerX + dx;
                target.ref.y = target.markerY + dy;
                target.ref.node?.position({ x: target.ref.x, y: target.ref.y });
            } else {
                target.ref.points_json = target.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
                target.ref.node?.position({ x: 0, y: 0 });
                refreshSegment(target.ref);
            }
            target.ref.updatedAt = timestamp();
            target.ref.updated_at = target.ref.updatedAt;
        });
        state.selectionDrag = null;
        markDirty();
        return true;
    }

    function applySegmentLockVisual(segment) {
        if (!segment.node) return;
        const locked = isElementLocked(segment);
        segment.node.draggable(!locked && !isTakeoffObjectInteractionBlocked()
            && !state.panMode && !state.temporaryPan && !state.annotationPlacement);
        segment.node.opacity(locked ? 0.55 : (String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area' ? 0.28 : 1));
        segment.node.dash(locked ? [8, 6] : []);
        (segment.handles || []).forEach(handle => {
            handle.draggable(!locked && !isTakeoffObjectInteractionBlocked()
                && !state.panMode && !state.temporaryPan && !state.annotationPlacement);
            handle.visible(!locked && state.selectedObjectUids.has(String(segment.client_uid))
                && isElementVisibleOnPage(segment));
        });
        const existing = typeof segment.node.findOne === 'function'
            ? segment.node.findOne('.takeoff-object-lock')
            : segment.lockNode;
        if (existing && typeof existing.destroy === 'function') existing.destroy();
        segment.lockNode = null;
        if (locked) {
            const segLayer = state.layers.find(l => String(l.client_uid) === String(segment.layer_client_uid));
            const col = segment.color || segLayer?.color || '#2563eb';
            const isArea = String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area';
            let cx = 0, cy = 0;
            const pts = segment.points_json || [];
            if (pts.length) {
                cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
                cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
            }
            const icon = createTakeoffLockIcon(col, cx - 6, cy - 7, isArea ? 0.85 : 0.7);
            if (typeof segment.node.add === 'function') {
                segment.node.add(icon);
            } else {
                segment.lockNode = icon;
                if (konvaLayer) konvaLayer.add(icon);
            }
        }
    }

    function createMarkerNode(marker, resolvedLayer = null) {
        if (!ensureKonva()) return;
        const markerLayer = resolvedLayer || state.layers.find(layer => String(layer.client_uid) === String(marker.layer_client_uid));
        const itemName = markerLayer?.name || marker.label || 'Takeoff item';
        const markerLocked = isObjectIndividuallyLocked(marker) || Number(markerLayer?.locked || 0) === 1;
        const group = new Konva.Group({
            x: num(marker.x),
            y: num(marker.y),
            draggable: !markerLocked,
            listening: !isTakeoffObjectInteractionBlocked(),
            visible: Number(marker.page_number) === Number(pageNum),
            opacity: markerLocked ? 0.55 : 0.70
        });
        
        const radius = symbolRadius(marker.symbol_size || marker.size);
        // A marker may contain several decorative paths. Keep only one node in
        // Konva's hit graph; pointer events still bubble to the outer group.
        group.add(new Konva.Circle({
            name: 'takeoff-marker-hit',
            radius: radius + 5,
            fill: 'rgba(0,0,0,0.001)',
            listening: true,
            perfectDrawEnabled: false
        }));
        const symbol = new Konva.Group({ name: 'takeoff-count-symbol', listening: false });
        drawSymbol(symbol, marker.symbol || 'circle', marker.color || '#2563eb', marker.symbol_size || marker.size);
        group.add(symbol);
        // Quantity remains on the marker model and in layer roll-ups; it is not
        // a visual label. Only render text explicitly entered by the user.
        group.add(new Konva.Text({ x: 12, y: -10, text: marker.label || '', fill: marker.color || '#2563eb', fontSize: 14, fontStyle: 'bold', listening: false, perfectDrawEnabled: false }));
        
        // Lazy hover tooltip allocated only on first mouseenter to keep rapid placement lightweight
        let tooltip = null;
        const ensureTooltip = () => {
            if (tooltip) return tooltip;
            tooltip = new Konva.Label({
                x: 0,
                y: -(radius + 8),
                visible: false,
                listening: false,
                name: 'takeoff-marker-tooltip'
            });
            tooltip.add(new Konva.Tag({
                fill: 'rgba(15, 23, 42, 0.94)',
                stroke: 'rgba(148, 163, 184, 0.40)',
                strokeWidth: 0.75,
                cornerRadius: 3.5,
                shadowColor: 'rgba(0, 0, 0, 0.4)',
                shadowBlur: 4,
                shadowOffset: { x: 0, y: 1 },
                pointerDirection: 'down',
                pointerWidth: 4,
                pointerHeight: 2.5
            }));
            tooltip.add(new Konva.Text({
                text: itemName,
                fill: '#f8fafc',
                fontSize: 9,
                fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                fontStyle: '600',
                padding: 2.5
            }));
            group.add(tooltip);
            return tooltip;
        };
        group.on('mouseenter', () => {
            const tip = ensureTooltip();
            tip.visible(true);
            tip.moveToTop();
            document.body.style.cursor = 'pointer';
            konvaLayer.batchDraw();
        });
        group.on('mouseleave', () => {
            if (tooltip) tooltip.visible(false);
            document.body.style.cursor = '';
            konvaLayer.batchDraw();
        });
        group.on('pointerdown mousedown touchstart', event => {
            if (isTakeoffObjectInteractionBlocked() || state.panMode || state.temporaryPan) return;
            event.cancelBubble = true;
            setTool('smart');
            selectElement('marker', marker, { additive: !!event.evt?.shiftKey });
        });
        group.on('click tap', event => {
            event.cancelBubble = true;
            setTool('smart');
            selectElement('marker', marker, { additive: !!event.evt?.shiftKey });
        });
        group.on('dblclick dbltap', event => {
            event.cancelBubble = true;
            setTool('smart');
            selectElement('marker', marker);
            if (!state.projectControlled || !marker.layer_client_uid) return;
            window.parent?.postMessage({
                type: 'project-takeoff-selection',
                payload: {
                    ids: [String(marker.client_uid)],
                    layerId: String(marker.layer_client_uid),
                    layerIds: [String(marker.layer_client_uid)],
                    objectType: 'marker',
                    activateLayer: true
                }
            }, '*');
        });
        group.on('contextmenu', event => openObjectContextMenu(event, 'marker', marker));
        group.on('dragstart', () => beginTakeoffSelectionDrag('marker', marker));
        group.on('dragmove', () => updateTakeoffSelectionDrag(marker));
        group.on('dragend', () => finishTakeoffSelectionDrag(marker));
        konvaLayer.add(group);

        // Count sizes are controlled exclusively via the layer's Size input
        // rather than canvas corner resize handles.
        marker.node = group;
        marker.symbolNode = symbol;
        applyMarkerLockVisual(marker);
        konvaLayer.batchDraw();
    }

    function refreshSegment(segment, draggingHandleIndex = -1, options = {}) {
        if (!segment.node) return;
        const isArea = String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area';
        segment.node.points((segment.points_json || []).flatMap(p => [p.x, p.y]));
        if (options && options.deferMeasurement && !isArea) {
            (segment.handles || []).forEach((handle, index) => {
                if (index !== draggingHandleIndex && segment.points_json[index]) {
                    handle.position(segment.points_json[index]);
                }
            });
            konvaLayer.batchDraw();
            return;
        }
        if (isArea) calculateAreaQuantity(segment);
        else calculateLinearLength(segment);
        const points = segment.points_json || [];
        const mid = points.length >= 2
            ? { x: (points[0].x + points[points.length - 1].x) / 2, y: (points[0].y + points[points.length - 1].y) / 2 }
            : (points[0] || { x: 0, y: 0 });
        segment.labelNode.position({ x: mid.x + 8, y: mid.y - 18 });
        const segSubtype = normalizeLinearSubtype(segment.takeoff_subtype || segment.takeoff_type || segment.type);
        let segLabelText = isArea ? formatAreaLabel(segment.total_area) : formatFeetLabel(segment.total_length);
        if (!isArea && segSubtype === 'linear_avg_with_drop') {
            segLabelText = `${Math.round(num(segment.horizontal_length || 0))} ft`;
        } else if (!isArea && segSubtype === 'count_by_distance') {
            segLabelText = `${num(segment.total_length || 0)} ${segment.unit || 'ea'}`;
        }
        segment.labelNode.text(segLabelText);
        (segment.handles || []).forEach((handle, index) => {
            if (index !== draggingHandleIndex && segment.points_json[index]) {
                handle.position(segment.points_json[index]);
            }
        });
        konvaLayer.batchDraw();
    }

    function vertexXArm(radius) {
        return Math.max(radius * 0.95, 2);
    }

    function createVertexHandleNode(point, subtype, color, radius, strokeW, options = {}) {
        const draggable = Boolean(options.draggable);
        const listening = options.listening !== undefined ? Boolean(options.listening) : true;
        const visible = options.visible !== undefined ? Boolean(options.visible) : true;
        const hitW = num(options.hitStrokeWidth || 32);
        const blur = radius <= 3 ? 1 : 2;
        if (subtype === 'linear') {
            const side = radius * 2;
            return new Konva.Rect({
                x: point.x,
                y: point.y,
                width: side,
                height: side,
                offsetX: radius,
                offsetY: radius,
                cornerRadius: radius <= 3 ? 0.5 : 1,
                fill: '#ffffff',
                stroke: color || '#2563eb',
                strokeWidth: strokeW,
                shadowColor: 'rgba(0,0,0,0.25)',
                shadowBlur: blur,
                hitStrokeWidth: hitW,
                draggable,
                listening,
                visible
            });
        }
        if (subtype === 'linear_with_drop') {
            const group = new Konva.Group({
                x: point.x,
                y: point.y,
                name: 'vertex-x',
                draggable,
                listening,
                visible
            });
            group.add(new Konva.Circle({
                name: 'vertex-x-hit',
                x: 0,
                y: 0,
                radius: Math.max(radius * 1.45, 7),
                fill: 'rgba(0,0,0,0.001)',
                hitStrokeWidth: hitW
            }));
            const arm = vertexXArm(radius);
            group.add(new Konva.Line({
                name: 'vertex-x-halo1',
                points: [-arm, -arm, arm, arm],
                stroke: '#ffffff',
                strokeWidth: strokeW * 2.2,
                lineCap: 'round',
                listening: false
            }));
            group.add(new Konva.Line({
                name: 'vertex-x-halo2',
                points: [-arm, arm, arm, -arm],
                stroke: '#ffffff',
                strokeWidth: strokeW * 2.2,
                lineCap: 'round',
                listening: false
            }));
            group.add(new Konva.Line({
                name: 'vertex-x-line1',
                points: [-arm, -arm, arm, arm],
                stroke: color || '#2563eb',
                strokeWidth: strokeW * 1.3,
                lineCap: 'round',
                listening: false
            }));
            group.add(new Konva.Line({
                name: 'vertex-x-line2',
                points: [-arm, arm, arm, -arm],
                stroke: color || '#2563eb',
                strokeWidth: strokeW * 1.3,
                lineCap: 'round',
                listening: false
            }));
            return group;
        }
        return new Konva.Circle({
            x: point.x,
            y: point.y,
            radius,
            fill: '#ffffff',
            stroke: color || '#2563eb',
            strokeWidth: strokeW,
            shadowColor: 'rgba(0,0,0,0.25)',
            shadowBlur: blur,
            hitStrokeWidth: hitW,
            draggable,
            listening,
            visible
        });
    }

    function resizeVertexHandleNode(handle, handleR, handleStroke, handleHit = 24) {
        if (!handle) return;
        if (typeof handle.radius === 'function') {
            handle.radius(handleR);
            handle.strokeWidth(handleStroke);
            handle.hitStrokeWidth(handleHit);
            return;
        }
        if (typeof handle.name === 'function' && handle.name() === 'vertex-x') {
            const arm = vertexXArm(handleR);
            const hitNode = handle.findOne?.('.vertex-x-hit');
            if (hitNode) {
                hitNode.radius(Math.max(handleR * 1.45, 7));
                hitNode.hitStrokeWidth(handleHit);
            }
            ['.vertex-x-halo1', '.vertex-x-line1'].forEach(sel => {
                const n = handle.findOne?.(sel);
                if (n) {
                    n.points([-arm, -arm, arm, arm]);
                    n.strokeWidth(sel.includes('halo') ? handleStroke * 2.2 : handleStroke * 1.3);
                }
            });
            ['.vertex-x-halo2', '.vertex-x-line2'].forEach(sel => {
                const n = handle.findOne?.(sel);
                if (n) {
                    n.points([-arm, arm, arm, -arm]);
                    n.strokeWidth(sel.includes('halo') ? handleStroke * 2.2 : handleStroke * 1.3);
                }
            });
            return;
        }
        if (typeof handle.size === 'function') {
            handle.size({ width: handleR * 2, height: handleR * 2 });
            handle.offset({ x: handleR, y: handleR });
            if (typeof handle.cornerRadius === 'function') {
                handle.cornerRadius(handleR <= 3 ? 0.5 : 1);
            }
            handle.strokeWidth(handleStroke);
            handle.hitStrokeWidth(handleHit);
        }
    }

    function resolveViewportInverseScale(inverseScale) {
        if (Number.isFinite(Number(inverseScale)) && Number(inverseScale) > 0) {
            return Number(inverseScale);
        }
        const viewportScale = Number(canvas?.viewportTransform?.[0] || 1);
        return viewportScale > 0 ? 1 / viewportScale : 1;
    }

    function getLinearNodeRadius(inverseScale) {
        const factor = resolveViewportInverseScale(inverseScale);
        // Linear & all variants (linear, linear_with_drop, linear_avg_with_drop, count_by_distance): 50% smaller
        return Math.max(2.2, Math.min(4.0, 2.6 * factor));
    }

    function getLinearNodeStroke(inverseScale) {
        const factor = resolveViewportInverseScale(inverseScale);
        return Math.max(0.6, Math.min(1.2, 0.8 * factor));
    }

    function getAreaNodeRadius(inverseScale) {
        const factor = resolveViewportInverseScale(inverseScale);
        return Math.max(4.4, Math.min(8.0, 5.2 * factor));
    }

    function getAreaNodeStroke(inverseScale) {
        const factor = resolveViewportInverseScale(inverseScale);
        return Math.max(1.2, Math.min(2.4, 1.6 * factor));
    }

    function segmentHitStrokeWidth(segment, isArea, factor = 1) {
        const baseStroke = Math.max(1, num(segment?.stroke_width || (isArea ? 2 : 2.5)));
        if (isArea) return Math.max(12, Math.min(24, 14 * factor));
        return Number((baseStroke * 1.03).toFixed(4));
    }

    let lastTakeoffInverseScale = 1;
    function scaleSegmentInteractionNodes(segment, factor, visibleOnly = false) {
        if (!segment?.node) return;
        const isAreaSeg = String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area';
        segment.node.hitStrokeWidth(segmentHitStrokeWidth(segment, isAreaSeg, factor));
        const handleR = isAreaSeg ? getAreaNodeRadius(factor) : getLinearNodeRadius(factor);
        const handleStroke = isAreaSeg ? getAreaNodeStroke(factor) : getLinearNodeStroke(factor);
        const handleHit = Math.max(22, Math.min(38, 24 * factor));
        (segment.handles || []).forEach(handle => {
            if (visibleOnly && typeof handle.visible === 'function' && !handle.visible()) return;
            if (typeof handle.radius === 'function') {
                handle.radius(handleR);
                handle.strokeWidth(handleStroke);
                handle.hitStrokeWidth(handleHit);
            } else {
                resizeVertexHandleNode(handle, handleR, handleStroke, handleHit);
            }
        });
    }

    function syncTakeoffHandleScale(inverseScale) {
        const factor = resolveViewportInverseScale(inverseScale);
        lastTakeoffInverseScale = factor;
        const linearR = getLinearNodeRadius(factor);
        const linearStroke = getLinearNodeStroke(factor);
        const areaR = getAreaNodeRadius(factor);
        const areaStroke = getAreaNodeStroke(factor);
        const handleHit = Math.max(22, Math.min(38, 24 * factor));

        state.segments.forEach(segment => {
            scaleSegmentInteractionNodes(segment, factor, true);
        });
        (state.draftLine?.vertices || []).forEach(vertex => {
            resizeVertexHandleNode(vertex, linearR, linearStroke, handleHit);
        });
        (state.draftArea?.vertices || []).forEach(vertex => {
            resizeVertexHandleNode(vertex, areaR, areaStroke, handleHit);
        });
        if (state.draftLine?.points?.length && linearPointerWorld) {
            const lastPt = state.draftLine.points[state.draftLine.points.length - 1];
            const nextPt = linearPointForPointer(linearPointerWorld, linearShiftPressed);
            positionLinearDraftLabel(lastPt, nextPt);
        }
        state.markers.forEach(marker => {
            if (!marker.node) return;
            const r = symbolRadius(marker.symbol_size || marker.size);
            const tooltip = marker.node?.findOne?.('.takeoff-marker-tooltip');
            if (tooltip && typeof tooltip.scale === 'function') {
                const tScale = Math.max(0.5, Math.min(1.4, factor));
                tooltip.scale({ x: tScale, y: tScale });
                tooltip.position({ x: 0, y: -(r + 4 * tScale) });
            }
        });
        flushKonvaCanvasDraw(false);
    }

    function destroySegmentNodes(segment) {
        if (segment.node) segment.node.destroy();
        if (segment.labelNode) segment.labelNode.destroy();
        (segment.handles || []).forEach(h => h.destroy());
        delete segment.node;
        delete segment.labelNode;
        delete segment.handles;
    }

    function insertSegmentVertex(segment, point) {
        const points = segment.points_json || [];
        if (points.length < 2 || isElementLocked(segment)) return false;
        let insertAt = 1;
        let nearest = Infinity;
        for (let index = 0; index < points.length - 1; index += 1) {
            const start = points[index];
            const end = points[index + 1];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const lengthSquared = dx * dx + dy * dy;
            const ratio = lengthSquared ? Math.max(0, Math.min(1,
                ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
            const projected = { x: start.x + ratio * dx, y: start.y + ratio * dy };
            const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
            if (distance < nearest) {
                nearest = distance;
                insertAt = index + 1;
            }
        }
        snapshot();
        segment.points_json.splice(insertAt, 0, { x: point.x, y: point.y });
        segment.updatedAt = timestamp();
        segment.updated_at = segment.updatedAt;
        destroySegmentNodes(segment);
        createSegmentNode(segment);
        selectElement('segment', segment);
        markDirty();
        showToast('Vertex added. Drag the handles to refine the run.', 'success');
        return true;
    }

    function createSegmentNode(segment, resolvedLayer = null) {
        if (!ensureKonva()) return;
        const visible = Number(segment.page_number) === Number(pageNum);
        const isArea = String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area';
        const segLayer = resolvedLayer || state.layers.find(row =>
            String(row.client_uid) === String(segment.layer_client_uid || '')
            || String(row.id || '') === String(segment.layer_id || '')
        );
        const segSubtype = isArea ? 'area' : normalizeLinearSubtype(
            segment.takeoff_subtype
            || segment.metadata_json?.takeoff_subtype
            || segLayer?.takeoff_subtype
            || segLayer?.original_takeoff_type
            || segLayer?.takeoff_type
            || segLayer?.type
        );
        const strokeW = num(segment.stroke_width || (isArea ? 2 : 2.5));
        const viewportScale = Number(canvas?.viewportTransform?.[0] || 1);
        const scaleFactor = viewportScale > 0 ? 1 / viewportScale : 1;
        const line = new Konva.Line({
            points: (segment.points_json || []).flatMap(p => [p.x, p.y]),
            stroke: segment.color || '#2563eb',
            strokeWidth: strokeW,
            dash: segSubtype === 'count_by_distance' ? [8, 6] : [],
            closed: isArea,
            fill: isArea ? segment.color || '#2563eb' : undefined,
            opacity: isArea ? 0.28 : 1,
            hitStrokeWidth: segmentHitStrokeWidth(segment, isArea, scaleFactor),
            lineCap: 'round',
            lineJoin: 'round',
            draggable: !isElementLocked(segment),
            listening: !isTakeoffObjectInteractionBlocked(),
            visible,
        });
        const label = new Konva.Text({ fill: segment.color || '#22c55e', fontSize: 16, padding: 4, visible: false, listening: false });
        const handleR = isArea ? getAreaNodeRadius() : getLinearNodeRadius();
        const handleStroke = isArea ? getAreaNodeStroke() : getLinearNodeStroke();
        const handles = (segment.points_json || []).map((point, index) => {
            const handle = (segSubtype === 'linear' || segSubtype === 'linear_with_drop')
                ? createVertexHandleNode(point, segSubtype, segment.color || '#2563eb', handleR, handleStroke, {
                    draggable: !isElementLocked(segment),
                    listening: !isTakeoffObjectInteractionBlocked(),
                    visible: false,
                    hitStrokeWidth: 32
                })
                : new Konva.Circle({
                    x: point.x,
                    y: point.y,
                    radius: handleR,
                    fill: '#ffffff',
                    stroke: segment.color || '#2563eb',
                    strokeWidth: handleStroke,
                    shadowColor: 'rgba(0,0,0,0.25)',
                    shadowBlur: handleR <= 3 ? 1 : 2,
                    hitStrokeWidth: 32,
                    draggable: !isElementLocked(segment),
                    listening: !isTakeoffObjectInteractionBlocked(),
                    visible: false
                });
            handle.on('pointerdown mousedown touchstart', (e) => {
                e.cancelBubble = true;
                handle.moveToTop();
            });
            handle.on('dragstart', (e) => {
                e.cancelBubble = true;
                handle.moveToTop();
                snapshot();
            });
            handle.on('dragmove', (e) => {
                e.cancelBubble = true;
                const position = handle.position();
                segment.points_json[index] = { x: position.x, y: position.y };
                const isAreaSeg = String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area';
                refreshSegment(segment, index, { deferMeasurement: !isAreaSeg });
                if (isAreaSeg) {
                    renderProperties();
                    emitProjectState();
                }
            });
            handle.on('dragend', (e) => {
                e.cancelBubble = true;
                const position = handle.position();
                segment.points_json[index] = { x: position.x, y: position.y };
                segment.updatedAt = timestamp();
                segment.updated_at = segment.updatedAt;
                refreshSegment(segment);
                renderProperties();
                emitProjectState();
                markDirty();
            });
            handle.on('mouseenter', () => {
                document.body.style.cursor = 'move';
            });
            handle.on('mouseleave', () => {
                document.body.style.cursor = '';
            });
            handle.on('dblclick dbltap', (e) => {
                e.cancelBubble = true;
                if (segment.points_json.length <= 2) return;
                snapshot();
                segment.points_json.splice(index, 1);
                destroySegmentNodes(segment);
                createSegmentNode(segment);
                selectElement('segment', segment);
                markDirty();
            });
            handle.on('click tap', event => {
                event.cancelBubble = true;
                selectElement('segment', segment, { additive: !!event.evt?.shiftKey });
            });
            handle.on('contextmenu', event => openObjectContextMenu(event, 'segment', segment));
            konvaLayer.add(handle);
            return handle;
        });
        const handleLineSelect = (event) => {
            if (isElementLocked(segment)) return;
            event.cancelBubble = true;
            if (state.addNodeArmed) {
                state.addNodeArmed = false;
                const pointer = konvaStage?.getPointerPosition();
                if (pointer) {
                    insertSegmentVertex(segment, screenToWorld(pointer));
                }
                if (konvaStage?.container()) konvaStage.container().style.cursor = 'default';
                document.body.style.cursor = '';
                return;
            }
            setTool('smart');
            selectElement('segment', segment, { additive: !!event.evt?.shiftKey });
            (segment.handles || []).forEach(h => { h.visible(true); h.moveToTop(); });
            konvaLayer.batchDraw();
        };
        line.on('pointerdown mousedown touchstart', (event) => {
            if (!isTakeoffObjectInteractionBlocked() && !state.panMode && !state.temporaryPan) {
                handleLineSelect(event);
            }
        });
        line.on('click tap', handleLineSelect);
        line.on('mouseenter', () => {
            if (!isTakeoffObjectInteractionBlocked() && !state.panMode && !state.temporaryPan) {
                document.body.style.cursor = state.addNodeArmed ? 'crosshair' : 'pointer';
            }
        });
        line.on('mouseleave', () => {
            document.body.style.cursor = '';
        });
        line.on('dragstart', () => {
            selectElement('segment', segment);
            (segment.handles || []).forEach(h => { h.visible(true); h.moveToTop(); });
            beginTakeoffSelectionDrag('segment', segment);
        });
        line.on('dblclick dbltap', event => {
            event.cancelBubble = true;
            const pointer = konvaStage?.getPointerPosition();
            if (pointer) insertSegmentVertex(segment, screenToWorld(pointer));
        });
        line.on('contextmenu', event => openObjectContextMenu(event, 'segment', segment));
        line.on('dragmove', () => updateTakeoffSelectionDrag(segment));
        line.on('dragend', () => finishTakeoffSelectionDrag(segment));
        konvaLayer.add(line, label);
        handles.forEach(handle => handle.moveToTop());
        segment.node = line;
        segment.labelNode = label;
        segment.handles = handles;
        refreshSegment(segment);
        applySegmentLockVisual(segment);
        window.bringTakeoffRulersToTop?.();
    }

    function clearNodes() {
        state.markers.forEach(destroyMarkerNodes);
        state.segments.forEach(destroySegmentNodes);
    }

    function destroyMarkerNodes(marker) {
        marker.transformer?.destroy();
        marker.node?.destroy();
        delete marker.transformer;
        delete marker.symbolNode;
        delete marker.node;
    }

    function renderNodes() {
        setTakeoffPage(pageNum);
        window.bringTakeoffRulersToTop?.();
    }

    function setTakeoffPage(pg) {
        const targetPage = Number(pg);
        if (!Number.isFinite(targetPage) || targetPage <= 0) return;

        // Deselect any objects that belong to other pages
        const selectedTargets = Array.from(state.selectedObjectUids).map(findTakeoffObjectByUid).filter(Boolean);
        const foreignSelection = selectedTargets.some(t => Number(t.ref.page_number) !== targetPage);
        if (foreignSelection) {
            clearTakeoffSelection();
        }

        if (selectionRectDraft && Number(selectionRectDraft.pageNumber) !== targetPage) {
            selectionRectDraft.node?.destroy();
            selectionRectDraft = null;
        }
        const layerByKey = buildTakeoffLayerLookup();
        state.markers.forEach(m => {
            const layer = layerByKey.get(String(m.layer_client_uid || ''));
            const isVisible = Number(m.page_number) === targetPage && Number(layer?.visible ?? 1) !== 0;
            if (!isVisible) {
                if (m.node) destroyMarkerNodes(m);
                return;
            }
            if (!m.node) createMarkerNode(m, layer);
            m.node?.visible(true);
            const isSelected = !isElementLocked(m, layerByKey) && state.selectedObjectUids.has(String(m.client_uid));
            m.transformer?.visible(isSelected);
            const ring = m.node?.findOne('.takeoff-selection-ring');
            if (ring) {
                ring.visible(isSelected);
            }
        });
        state.segments.forEach(s => {
            const layer = layerByKey.get(String(s.layer_client_uid || ''));
            const isVisible = Number(s.page_number) === targetPage && Number(layer?.visible ?? 1) !== 0;
            if (!isVisible) {
                if (s.node) destroySegmentNodes(s);
                return;
            }
            if (!s.node) createSegmentNode(s, layer);
            s.node?.visible(true);
            if (s.labelNode) s.labelNode.visible(false);
            const isSelected = !isElementLocked(s, layerByKey) && state.selectedObjectUids.has(String(s.client_uid));
            (s.handles || []).forEach(h => {
                h.visible(isSelected);
            });
        });
        syncTakeoffHandleScale();
        applyObjectSelectionVisuals(true);
        flushKonvaCanvasDraw();
    }
    window.setTakeoffPage = setTakeoffPage;

    function selectElement(type, ref, options = {}) {
        if (ref && isElementLocked(ref)) return;
        const objectUid = String(ref?.client_uid || '');
        if (options.additive && objectUid) {
            if (state.selectedObjectUids.has(objectUid)) state.selectedObjectUids.delete(objectUid);
            else state.selectedObjectUids.add(objectUid);
        } else {
            state.selectedObjectUids = new Set(objectUid ? [objectUid] : []);
        }
        const selectedTargets = Array.from(state.selectedObjectUids).map(findTakeoffObjectByUid).filter(Boolean);
        state.selectedElement = selectedTargets.length === 1 ? selectedTargets[0] : null;
        applyObjectSelectionVisuals();
        renderProperties();
        if (konvaLayer) konvaLayer.batchDraw();
        emitSelectionState();
    }

    function emitSelectionState() {
        if (!state.projectControlled) return;
        try {
            const selectedTargets = Array.from(state.selectedObjectUids).map(findTakeoffObjectByUid).filter(Boolean);
            const layerIds = Array.from(new Set(selectedTargets.map(target => String(target.ref.layer_client_uid || '')).filter(Boolean)));
            const objectTypes = Array.from(new Set(selectedTargets.map(target => target.type)));
            window.parent?.postMessage({
                type: 'project-takeoff-selection',
                payload: {
                    ids: selectedTargets.map(target => String(target.ref.client_uid)),
                    layerId: layerIds.length === 1 ? layerIds[0] : null,
                    layerIds,
                    objectType: objectTypes.length === 1 ? objectTypes[0] : (objectTypes.length ? 'mixed' : null)
                }
            }, '*');
        } catch (e) {}
    }

    function clearTakeoffSelection() {
        state.selectedElement = null;
        state.selectedObjectUids.clear();
        state.segments.forEach(s => (s.handles || []).forEach(h => h.visible(false)));
        state.markers.forEach(marker => marker.transformer?.visible(false));
        applyObjectSelectionVisuals();
        renderProperties();
        if (konvaLayer) konvaLayer.batchDraw();
        emitSelectionState();
        return true;
    }

    const prevSelectedVisualUids = new Set();

    function applySingleMarkerSelectionVisual(marker, selected) {
        if (!marker?.node) return;
        const locked = isElementLocked(marker);
        const showRing = selected && !locked && isElementVisibleOnPage(marker);
        marker.node.scale({ x: 1, y: 1 });
        marker.transformer?.visible(showRing);
        const ring = marker.node.findOne('.takeoff-selection-ring');
        if (ring) ring.visible(showRing);
        const useGlow = selected && state.tool !== 'takeoff_count';
        if (typeof marker.node.shadowEnabled === 'function') marker.node.shadowEnabled(useGlow);
        if (useGlow) {
            if (typeof marker.node.shadowColor === 'function') marker.node.shadowColor('#38bdf8');
            if (typeof marker.node.shadowBlur === 'function') marker.node.shadowBlur(8);
        } else if (typeof marker.node.shadowBlur === 'function') {
            marker.node.shadowBlur(0);
        }
    }

    function applySingleSegmentSelectionVisual(segment, selected) {
        if (!segment?.node) return;
        const showHandles = selected && !isElementLocked(segment) && isElementVisibleOnPage(segment);
        if (showHandles) scaleSegmentInteractionNodes(segment, lastTakeoffInverseScale, false);
        (segment.handles || []).forEach(handle => {
            handle.visible(showHandles);
            if (selected) handle.moveToTop();
        });
        if (typeof segment.node.shadowEnabled === 'function') segment.node.shadowEnabled(selected);
        if (selected) {
            if (typeof segment.node.shadowColor === 'function') segment.node.shadowColor('#38bdf8');
            if (typeof segment.node.shadowBlur === 'function') segment.node.shadowBlur(8);
        } else if (typeof segment.node.shadowBlur === 'function') {
            segment.node.shadowBlur(0);
        }
    }

    function applyObjectSelectionVisuals(fullSync = false) {
        if (fullSync || prevSelectedVisualUids.size === 0 && state.selectedObjectUids.size === 0) {
            if (fullSync) {
                state.markers.forEach(marker => applySingleMarkerSelectionVisual(marker, state.selectedObjectUids.has(String(marker.client_uid))));
                state.segments.forEach(segment => applySingleSegmentSelectionVisual(segment, state.selectedObjectUids.has(String(segment.client_uid))));
            }
        } else {
            const dirtyUids = new Set([...prevSelectedVisualUids, ...state.selectedObjectUids]);
            dirtyUids.forEach(uidVal => {
                const found = findTakeoffObjectByUid(uidVal);
                if (!found) return;
                const isSel = state.selectedObjectUids.has(uidVal);
                if (found.type === 'marker') applySingleMarkerSelectionVisual(found.ref, isSel);
                else applySingleSegmentSelectionVisual(found.ref, isSel);
            });
        }
        prevSelectedVisualUids.clear();
        state.selectedObjectUids.forEach(uidVal => prevSelectedVisualUids.add(String(uidVal)));
        flushKonvaCanvasDraw();
    }

    function findTakeoffObjectByUid(objectUid) {
        const uidValue = String(objectUid || '');
        const marker = state.markers.find(m => String(m.client_uid) === uidValue);
        if (marker) return { type: 'marker', ref: marker };
        const segment = state.segments.find(s => String(s.client_uid) === uidValue);
        if (segment) return { type: 'segment', ref: segment };
        return null;
    }

    function addMarker(pos, placementOperationId = null) {
        const layer = activeLayer();
        if (!layer) {
            showToast('Select a takeoff layer before drawing.', 'error');
            return;
        }
        snapshot();
        if (Number(layer.locked)) {
            showToast('Layer is locked', 'error');
            return;
        }
        const markerMultiplier = layerMultiplier(layer);
        const marker = assignNewPlacementIdentity({
            client_uid: uid(),
            layer_client_uid: layer.client_uid,
            catalog_item_id: layer.catalog_item_id || state.selectedItemId,
            assembly_id: layer.assembly_id || state.selectedAssemblyId,
            takeoff_type: 'count',
            type: 'count',
            page_number: Number(pageNum || 1),
            x: pos.x,
            y: pos.y,
            symbol: layer.symbol || 'circle',
            symbol_size: layer.symbol_size || 'Medium',
            size: layer.symbol_size || 'Medium',
            color: layer.color || '#2563eb',
            label: '',
            multiplier: markerMultiplier,
            quantity: markerMultiplier,
            notes: '',
            project_id: currentProjectId(),
            document_id: currentDocumentId(),
            sheet_id: sheetIdFor(pageNum),
            createdAt: timestamp(),
            updatedAt: timestamp(),
            metadata_json: {},
        }, placementOperationId);
        marker.created_at = marker.createdAt;
        marker.updated_at = marker.updatedAt;
        marker.quantity = calculateCountQuantity(marker);
        state.markers.push(marker);
        createMarkerNode(marker);
        trackTakeoffObjects([{ type: 'marker', ref: marker }], false);
        dirtyTakeoffPages.add(Number(marker.page_number || pageNum || 1));
        selectElement('marker', marker);
        markDirty({ objectsTracked: true, fastPlacement: true, layer });
        finishToolUse();
    }

    let lastEmittedToolKey = '';

    function emitToolState(force = false) {
        if (!state.projectControlled) return;
        const toolKey = `${state.tool}:${Boolean(state.continuousTool)}`;
        if (!force && toolKey === lastEmittedToolKey) return;
        lastEmittedToolKey = toolKey;
        try {
            window.parent?.postMessage({
                type: 'project-takeoff-tool-state',
                payload: { tool: state.tool, continuous: state.continuousTool }
            }, '*');
        } catch (e) {}
    }

    function finishToolUse() {
        // Count/Point is intentionally persistent while its item remains active.
        // Each click adds another marker; changing or clearing the active layer
        // is the explicit boundary that returns the editor to Smart/Select.
        if (state.tool === 'takeoff_count' && activeLayer()) {
            emitToolState();
            return;
        }
        if (state.continuousTool) {
            emitToolState();
            return;
        }
        // Let Konva finish the current click/tap before changing interactivity.
        // Switching layers synchronously can leave the pointer captured by the
        // drawing overlay, making the cursor appear frozen over the plan.
        requestAnimationFrame(() => {
            if (state.continuousTool) return;
            if (!['takeoff_count', 'takeoff_linear', 'takeoff_area'].includes(state.tool)) return;
            setTool('smart');
        });
    }

    function addLinearPoint(pos) {
        if (!requirePlanScale('linear')) return false;
        const layer = activeLayer();
        if (!layer) {
            showToast('Select a takeoff layer before drawing.', 'error');
            return;
        }
        if (Number(layer.locked)) {
            showToast('Layer is locked', 'error');
            return;
        }
        if (!state.draftLine) {
            const handleR = getLinearNodeRadius();
            const handleStroke = getLinearNodeStroke();
            const draftSubtype = activeDraftLayerSubtype(layer);
            const vertex = createVertexHandleNode(pos, draftSubtype, layer.color || '#22c55e', handleR, handleStroke, {
                draggable: false,
                listening: false,
                visible: true
            });
            state.draftLine = {
                points: [pos],
                layerUid: layer.client_uid,
                subtype: draftSubtype,
                vertices: [vertex],
                preview: new Konva.Line({
                    points: [pos.x, pos.y, pos.x, pos.y],
                    stroke: layer.color || '#22c55e',
                    strokeWidth: Math.max(1, num(layer.stroke_width || layer.strokeWidth || 2.5)),
                    dash: draftSubtype === 'count_by_distance' ? [8, 6] : [],
                    lineCap: 'round',
                    lineJoin: 'round',
                    listening: false
                }),
                lengthLabel: new Konva.Text({
                    x: pos.x,
                    y: pos.y,
                    text: '',
                    fill: layer.color || '#22c55e',
                    fontSize: 13.5,
                    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                    fontStyle: 'bold',
                    stroke: '#ffffff',
                    strokeWidth: 3,
                    fillAfterStrokeEnabled: true,
                    padding: 2,
                    visible: false,
                    listening: false
                })
            };
            konvaLayer.add(state.draftLine.preview, vertex, state.draftLine.lengthLabel);
            updateDrawingStatus();
            konvaLayer.batchDraw();
            return;
        }
        const last = state.draftLine.points[state.draftLine.points.length - 1];
        if (Math.hypot(pos.x - last.x, pos.y - last.y) < 0.5) return;
        state.draftLine.points.push(pos);
        state.draftLine.preview.points(state.draftLine.points.flatMap(p => [p.x, p.y]));
        const handleR = getLinearNodeRadius();
        const handleStroke = getLinearNodeStroke();
        const vertex = createVertexHandleNode(pos, state.draftLine.subtype || activeDraftLayerSubtype(layer), layer.color || '#22c55e', handleR, handleStroke, {
            draggable: false,
            listening: false,
            visible: true
        });
        state.draftLine.vertices.push(vertex);
        konvaLayer.add(vertex);
        updateDrawingStatus();
        konvaLayer.batchDraw();
    }

    function finishLinear() {
        if (!state.draftLine) return false;
        if (!requirePlanScale('linear')) {
            cancelLinearDraft();
            return false;
        }
        if (state.draftLine.points.length < 2) {
            cancelLinearDraft();
            return false;
        }
        const layer = state.layers.find(row => row.client_uid === state.draftLine.layerUid);
        if (!layer) {
            cancelLinearDraft();
            return false;
        }
        snapshot();
        let points = state.draftLine.points.map(point => ({ ...point }));
        while (points.length > 2) {
            const last = points[points.length - 1];
            const prev = points[points.length - 2];
            if (Math.hypot(last.x - prev.x, last.y - prev.y) < 2) {
                points.pop();
            } else {
                break;
            }
        }
        const subtype = normalizeLinearSubtype(layer.takeoff_subtype || layer.original_takeoff_type || layer.takeoff_type || layer.type);
        const spacingVal = subtype === 'count_by_distance' ? Math.max(0, num(layer.spacing ?? layer.metadata_json?.spacing ?? 0)) : 0;
        const segmentDropLength = subtype === 'count_by_distance' ? 0 : Math.max(0, num(layer.drop_length ?? layer.dropLength));
        const segment = {
            client_uid: uid(),
            layer_client_uid: layer.client_uid,
            catalog_item_id: layer.catalog_item_id || state.selectedItemId,
            assembly_id: layer.assembly_id || state.selectedAssemblyId,
            takeoff_type: 'linear',
            takeoff_subtype: subtype,
            type: 'linear',
            page_number: Number(pageNum || 1),
            points_json: points,
            measured_length: 0,
            drop_length: subtype === 'linear' ? 0 : segmentDropLength,
            spacing: spacingVal,
            multiplier: layerMultiplier(layer),
            total_length: 0,
            unit: subtype === 'count_by_distance' ? (layer.unit_of_measure || 'ea') : 'ft',
            color: layer.color || '#2563eb',
            stroke_width: Math.max(1, num(layer.stroke_width || layer.strokeWidth || 2.5)),
            label: '',
            project_id: currentProjectId(),
            document_id: currentDocumentId(),
            sheet_id: sheetIdFor(pageNum),
            createdAt: timestamp(),
            updatedAt: timestamp(),
            metadata_json: {},
        };
        segment.created_at = segment.createdAt;
        segment.updated_at = segment.updatedAt;
        calculateLinearLength(segment);
        destroyLinearDraftNodes();
        state.segments.push(segment);
        createSegmentNode(segment);
        trackTakeoffObjects([{ type: 'segment', ref: segment }], false);
        dirtyTakeoffPages.add(Number(segment.page_number || pageNum || 1));
        clearTakeoffSelection();
        markDirty({ objectsTracked: true, fastPlacement: true, layer });
        updateDrawingStatus();
        applyTakeoffDrawingInteractivity();
        if (konvaStage?.container()) konvaStage.container().style.cursor = 'crosshair';
        emitToolState();
        return true;
    }

    function destroyLinearDraftNodes() {
        if (!state.draftLine) return;
        state.draftLine.preview?.destroy();
        state.draftLine.lengthLabel?.destroy();
        (state.draftLine.vertices || []).forEach(vertex => vertex.destroy());
        state.draftLine = null;
        flushKonvaCanvasDraw();
    }

    function cancelLinearDraft() {
        destroyLinearDraftNodes();
        updateDrawingStatus();
    }

    function undoLinearPoint() {
        if (!state.draftLine) return false;
        if (state.draftLine.points.length <= 1) {
            cancelLinearDraft();
            return true;
        }
        state.draftLine.points.pop();
        state.draftLine.vertices.pop()?.destroy();
        state.draftLine.preview.points(state.draftLine.points.flatMap(point => [point.x, point.y]));
        if (linearPointerWorld) {
            renderLinearPreview(linearPointerWorld, linearShiftPressed);
        } else {
            state.draftLine.lengthLabel?.text('');
            state.draftLine.lengthLabel?.visible(false);
            updateDrawingStatus();
            konvaLayer?.batchDraw();
        }
        return true;
    }

    function updateAreaDraftPreview(points) {
        if (!state.draftArea?.preview) return;
        state.draftArea.preview.points((points || []).flatMap(p => [p.x, p.y]));
        const lbl = state.draftArea.areaLabel;
        if (lbl && points && points.length >= 3) {
            let pxArea = 0;
            for (let i = 0; i < points.length; i++) {
                const next = points[(i + 1) % points.length];
                pxArea += points[i].x * next.y - next.x * points[i].y;
            }
            pxArea = Math.abs(pxArea) / 2;
            const scale = getPlanScale(pageNum);
            const areaFt = scale > 0 ? pxArea / (scale * scale) : 0;
            const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
            const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
            const viewportScale = Number(canvas?.viewportTransform?.[0] || 1);
            const factor = viewportScale > 0 ? 1 / viewportScale : 1;
            const lScale = Math.max(0.45, Math.min(1.6, factor));
            lbl.text(formatAreaLabel(areaFt));
            lbl.scale({ x: lScale, y: lScale });
            lbl.offsetX(lbl.width() / 2);
            lbl.offsetY(lbl.height() / 2);
            lbl.position({ x: cx, y: cy });
            lbl.visible(true);
            lbl.moveToTop();
        } else if (lbl) {
            lbl.visible(false);
        }
    }

    function addAreaPoint(pos) {
        if (!requirePlanScale('area')) return false;
        const layer = activeLayer();
        if (!layer) {
            showToast('Select a takeoff layer before drawing.', 'error');
            return;
        }
        if (Number(layer.locked)) {
            showToast('Layer is locked', 'error');
            return;
        }
        const handleR = getAreaNodeRadius();
        const handleStroke = getAreaNodeStroke();
        if (!state.draftArea) {
            const vertex = createVertexHandleNode(pos, 'area', layer.color || '#2563eb', handleR, handleStroke, {
                draggable: false,
                listening: false,
                visible: true
            });
            state.draftArea = {
                points: [pos],
                layerUid: layer.client_uid,
                vertices: [vertex],
                preview: new Konva.Line({
                    points: [pos.x, pos.y, pos.x, pos.y],
                    stroke: layer.color || '#2563eb',
                    strokeWidth: Math.max(1, num(layer.stroke_width || layer.strokeWidth || 2.5)),
                    fill: layer.color || '#2563eb',
                    opacity: 0.28,
                    closed: true,
                    lineJoin: 'round',
                    listening: false
                }),
                areaLabel: new Konva.Text({
                    x: pos.x,
                    y: pos.y,
                    text: '',
                    fill: layer.color || '#2563eb',
                    fontSize: 13.5,
                    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                    fontStyle: 'bold',
                    stroke: '#ffffff',
                    strokeWidth: 3,
                    fillAfterStrokeEnabled: true,
                    padding: 2,
                    visible: false,
                    listening: false
                })
            };
            konvaLayer.add(state.draftArea.preview, vertex, state.draftArea.areaLabel);
            konvaLayer.batchDraw();
            return;
        }
        const last = state.draftArea.points[state.draftArea.points.length - 1];
        if (Math.hypot(pos.x - last.x, pos.y - last.y) < 0.5) return;
        state.draftArea.points.push(pos);
        const vertex = createVertexHandleNode(pos, 'area', layer.color || '#2563eb', handleR, handleStroke, {
            draggable: false,
            listening: false,
            visible: true
        });
        state.draftArea.vertices.push(vertex);
        konvaLayer.add(vertex);
        updateAreaDraftPreview(state.draftArea.points);
        konvaLayer.batchDraw();
        if (state.draftArea.points.length >= 4) {
            finishArea();
        }
    }

    function destroyAreaDraftNodes() {
        if (!state.draftArea) return;
        state.draftArea.preview?.destroy();
        state.draftArea.areaLabel?.destroy();
        (state.draftArea.vertices || []).forEach(v => v.destroy());
        state.draftArea = null;
        flushKonvaCanvasDraw();
    }

    function finishArea() {
        if (!state.draftArea || state.draftArea.points.length < 3) return false;
        if (!requirePlanScale('area')) {
            destroyAreaDraftNodes();
            return false;
        }
        const layer = state.layers.find(row => row.client_uid === state.draftArea.layerUid) || activeLayer();
        if (!layer) {
            showToast('Select a takeoff layer before drawing.', 'error');
            return false;
        }
        snapshot();
        const segment = {
            client_uid: uid(),
            layer_client_uid: layer.client_uid,
            catalog_item_id: layer.catalog_item_id || state.selectedItemId,
            assembly_id: layer.assembly_id || state.selectedAssemblyId,
            takeoff_type: 'area',
            type: 'area',
            page_number: Number(pageNum || 1),
            points_json: state.draftArea.points.map(p => ({ ...p })),
            measured_area: 0,
            multiplier: layerMultiplier(layer),
            total_area: 0,
            total_length: 0,
            unit: layer.unit_of_measure || 'sq ft',
            color: layer.color || '#2563eb',
            stroke_width: Math.max(1, num(layer.stroke_width || layer.strokeWidth || 2.5)),
            label: '',
            project_id: currentProjectId(),
            document_id: currentDocumentId(),
            sheet_id: sheetIdFor(pageNum),
            createdAt: timestamp(),
            updatedAt: timestamp(),
            metadata_json: {},
        };
        segment.created_at = segment.createdAt;
        segment.updated_at = segment.updatedAt;
        calculateAreaQuantity(segment);
        destroyAreaDraftNodes();
        state.segments.push(segment);
        createSegmentNode(segment);
        trackTakeoffObjects([{ type: 'segment', ref: segment }], false);
        dirtyTakeoffPages.add(Number(segment.page_number || pageNum || 1));
        clearTakeoffSelection();
        markDirty({ objectsTracked: true, fastPlacement: true, layer });
        applyTakeoffDrawingInteractivity();
        if (konvaStage?.container()) konvaStage.container().style.cursor = 'crosshair';
        renderLayers();
        emitProjectState();
        emitToolState();
        scheduleTakeoffAutosave(250);
        return true;
    }

    function clearDrafts() {
        if (state.draftLine) destroyLinearDraftNodes();
        if (state.draftArea) destroyAreaDraftNodes();
        updateDrawingStatus();
        flushKonvaCanvasDraw();
    }

    function selectedTakeoffObjectIds() {
        const ids = new Set(Array.from(state.selectedObjectUids || []).map(String));
        if (state.selectedElement?.ref?.client_uid) ids.add(String(state.selectedElement.ref.client_uid));
        return Array.from(ids);
    }

    function deleteTakeoffSelection(objectIds = null) {
        const localIds = selectedTakeoffObjectIds();
        const requestedIds = Array.from(new Set([
            ...localIds,
            ...(Array.isArray(objectIds) ? objectIds.map(String) : [])
        ]));
        let targets = requestedIds.map(findTakeoffObjectByUid).filter(Boolean);
        if (!targets.length && state.selectedElement) {
            targets = [state.selectedElement];
        }
        if (!targets.length) {
            if (state.draftLine || state.draftArea) {
                clearDrafts();
                return true;
            }
            return false;
        }
        if (targets.some(target => isElementLocked(target.ref))) {
            showToast('Unlock selected elements before deleting them.', 'warning');
            return false;
        }
        snapshot();
        trackTakeoffObjects(targets, true);
        targets.forEach(({ type, ref }) => {
            if (type === 'marker') {
                destroyMarkerNodes(ref);
                state.markers = state.markers.filter(marker => marker !== ref);
            } else {
                destroySegmentNodes(ref);
                state.segments = state.segments.filter(segment => segment !== ref);
            }
        });
        state.selectedElement = null;
        state.selectedObjectUids.clear();
        renderProperties();
        applyObjectSelectionVisuals();
        markDirty({ objectsTracked: true });
        emitSelectionState();
        return true;
    }

    function deleteSelected() {
        return deleteTakeoffSelection();
    }

    let editorUiRefreshRaf = null;
    function scheduleEditorUiRefresh() {
        if (editorUiRefreshRaf) return;
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : cb => setTimeout(cb, 0);
        editorUiRefreshRaf = raf(() => {
            editorUiRefreshRaf = null;
            if (!state.projectControlled || document.getElementById('takeoffSummary')?.offsetParent !== null) {
                renderSummary();
            }
            if (!state.projectControlled || document.getElementById('takeoffLayersTab')?.offsetParent !== null) {
                renderLayers();
            }
        });
    }

    function emitFastLayerQuantityDelta(layer) {
        if (!state.projectControlled || !layer?.client_uid || !window.parent || window.parent === window) return;
        try {
            window.parent.postMessage({
                type: 'project-takeoff-layer-qty',
                payload: {
                    estimateKey: currentEstimateKey(),
                    estimate_key: currentEstimateKey(),
                    drawingId: typeof fileId !== 'undefined' ? fileId : null,
                    layerId: layer.client_uid,
                    quantity: layerQuantity(layer),
                    userDirty: true
                }
            }, '*');
        } catch (e) {}
    }

    function markDirty(options = {}) {
        state.dirty = true;
        hasPendingManualCanvasCheckpoint = true;
        if (options.pageFallback) {
            dirtyTakeoffPages.add(Number(pageNum || 1));
            dirtyTakeoffPageGenerations.set(Number(pageNum || 1), ++takeoffDirtyGeneration);
        } else if (!options.objectsTracked) {
            const targets = selectedTakeoffObjectIds().map(findTakeoffObjectByUid).filter(Boolean);
            if (targets.length) trackTakeoffObjects(targets);
            else {
                dirtyTakeoffPages.add(Number(pageNum || 1));
                dirtyTakeoffPageGenerations.set(Number(pageNum || 1), ++takeoffDirtyGeneration);
            }
        }
        if (options.fastPlacement) {
            scheduleEditorUiRefresh();
            emitFastLayerQuantityDelta(options.layer || activeLayer());
            scheduleTakeoffAutosave(1400);
            scheduleEmitProjectState(true, 260);
            return;
        }
        renderSummary();
        renderLayers();
        scheduleTakeoffAutosave();
        emitProjectState(true, true);
    }

    function layerQuantity(layer) {
        const countQty = state.markers
            .filter(marker => marker.layer_client_uid === layer.client_uid)
            .reduce((sum, marker) => sum + calculateCountQuantity(marker), 0);
        const linearSegments = state.segments
            .filter(segment => segment.layer_client_uid === layer.client_uid && String(segment.takeoff_type || segment.type || '').toLowerCase() !== 'area');
        const layerSub = normalizeLinearSubtype(layer.takeoff_subtype || layer.original_takeoff_type || layer.takeoff_type || layer.type);
        let linearQty = 0;
        if (layerSub === 'linear_avg_with_drop') {
            if (linearSegments.length > 0) {
                const roundedSum = linearSegments.reduce((sum, segment) => {
                    calculateLinearLength(segment);
                    return sum + Math.round(num(segment.horizontal_length || 0));
                }, 0);
                const avgRounded = roundedSum / linearSegments.length;
                const singleDrop = Math.max(0, num(layer.drop_length ?? layer.dropLength ?? 0));
                linearQty = (avgRounded + singleDrop) * layerMultiplier(layer);
            }
        } else {
            linearQty = linearSegments.reduce((sum, segment) => sum + calculateLinearLength(segment), 0);
        }
        const areaQty = state.segments
            .filter(segment => segment.layer_client_uid === layer.client_uid && String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area')
            .reduce((sum, segment) => sum + calculateAreaQuantity(segment), 0);
        const measured = countQty + linearQty + areaQty;
        // `layer.quantity` may already be the persisted aggregate for this
        // layer. Only an explicit seed is additive to measured geometry.
        const base = num(layer.seed_quantity ?? layer.seedQuantity ?? layer.baseQuantity
            ?? layer.metadata_json?.base_quantity ?? 0);
        return base + measured;
    }

    function layerType(layer) {
        const raw = String(layer.takeoff_type || layer.type || layer.layer_type || '').toLowerCase();
        if (['linear', 'line', 'lines', 'lf', 'ft', 'linear with drop', 'linear avg. with drop',
            'linear avg with drop', 'linear_with_drop', 'linear_avg_with_drop',
            'count by distance', 'count_by_distance'].includes(raw)) return 'linear';
        if (['count', 'counts', 'point', 'points', 'ea'].includes(raw)) return 'count';
        if (['area', 'sf', 'area / volume', 'vertical wall area'].includes(raw)) return 'area';
        if (['volume', 'cy'].includes(raw)) return 'area';
        if (['lump_sum', 'lump sum', 'lot'].includes(raw)) return 'lump_sum';
        const uom = String(layer.unit_of_measure || '').toLowerCase();
        if (['lf', 'ft'].includes(uom)) return 'linear';
        return raw || 'mixed';
    }

    function layerUnit(layer) {
        return layer.unit_of_measure || (layerType(layer) === 'linear' ? 'ft' : (layerType(layer) === 'area' ? 'sq ft' : 'ea'));
    }

    function layerGroup(layer) {
        return layer.group_name || layer.tag || 'Ungrouped';
    }

    function layerSymbol(layer) {
        const symbol = layer.symbol || 'circle';
        const color = layer.color || '#2563eb';
        return `<span class="takeoff-layer-symbol ${escapeHtml(symbol)}" style="background:${escapeHtml(color)}"></span>`;
    }

    function formatLayerQty(value) {
        const n = num(value);
        return Number.isInteger(n) ? String(n) : n.toFixed(2);
    }

    function layerCatalogItem(layer) {
        if (layer.catalog_item_id) {
            return state.catalog.items.find(item => String(item.id) === String(layer.catalog_item_id)) || null;
        }
        return null;
    }

    function layerAssembly(layer) {
        if (layer.assembly_id) {
            return state.assemblies.assemblies.find(assembly => String(assembly.id) === String(layer.assembly_id)) || null;
        }
        return null;
    }

    function layerLinkedName(layer) {
        const assembly = layerAssembly(layer);
        const item = layerCatalogItem(layer);
        return assembly?.name || item?.name || 'Manual takeoff';
    }

    function layerTypeLabel(layer) {
        const type = layerType(layer);
        return String(type || 'mixed').replace('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function projectLayerPayload(layer) {
        const baseQuantity = num(layer.seed_quantity ?? layer.seedQuantity ?? layer.baseQuantity
            ?? layer.metadata_json?.base_quantity ?? 0);
        return {
            id: layer.client_uid,
            layerId: layer.client_uid,
            name: layer.name,
            type: layerTypeLabel(layer),
            takeoff_type: layerType(layer),
            uom: layerUnit(layer),
            unit_of_measure: layerUnit(layer),
            color: layer.color || '#2563eb',
            symbol: layer.symbol || 'circle',
            symbol_size: layer.symbol_size || 'Medium',
            visible: Number(layer.visible ?? 1) !== 0,
            locked: Number(layer.locked || 0) === 1,
            quantity: layerQuantity(layer),
            baseQuantity,
            seed_quantity: baseQuantity,
            multiplier: layerMultiplier(layer),
            catalog_item_id: layer.catalog_item_id || null,
            catalogMetadata: window.CatalogMetadata.fromLayer(layer),
            unit_cost: num(layer.unit_cost || 0),
            labor_hours: num(layer.unit_labor_time || layer.labor_hours || 0),
            estimate_id: layer.metadata_json?.estimate_id || null,
            estimating_item_id: layer.metadata_json?.estimating_item_id || null,
            estimating_group_id: layer.metadata_json?.estimating_group_id || null,
            dropLength: Math.max(0, num(layer.drop_length ?? layer.dropLength)),
            spacing: Math.max(0, num(layer.spacing ?? layer.metadata_json?.spacing)),
            subtype: normalizeLinearSubtype(layer.takeoff_subtype || layer.original_takeoff_type || layer.takeoff_type || layer.type),
            shapes: [
                ...state.markers.filter(marker => marker.layer_client_uid === layer.client_uid).map(marker => ({
                    id: marker.client_uid,
                    projectId: String(marker.project_id || currentProjectId()),
                    layerId: layer.client_uid,
                    documentId: String(marker.document_id || currentDocumentId()),
                    sheetId: marker.sheet_id || sheetIdFor(marker.page_number),
                    pageNumber: marker.page_number,
                    type: 'Count',
                    position: { x: marker.x, y: marker.y },
                    color: marker.color,
                    symbol: marker.symbol,
                    size: marker.symbol_size || marker.size || layer.symbol_size || 'Medium',
                    quantityValue: calculateCountQuantity(marker),
                    uom: layerUnit(layer),
                    createdAt: marker.createdAt || marker.created_at || null,
                    updatedAt: marker.updatedAt || marker.updated_at || null
                })),
                ...state.segments.filter(segment => segment.layer_client_uid === layer.client_uid).map(segment => {
                    const isArea = String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area';
                    const qtyVal = isArea ? calculateAreaQuantity(segment) : calculateLinearLength(segment);
                    const sub = normalizeLinearSubtype(segment.takeoff_subtype || layer.takeoff_subtype || layer.original_takeoff_type || layer.type);
                    return {
                        id: segment.client_uid,
                        projectId: String(segment.project_id || currentProjectId()),
                        layerId: layer.client_uid,
                        documentId: String(segment.document_id || currentDocumentId()),
                        sheetId: segment.sheet_id || sheetIdFor(segment.page_number),
                        pageNumber: segment.page_number,
                        type: isArea ? 'Area' : 'Linear',
                        subtype: isArea ? 'area' : sub,
                        horizontalLength: num(segment.horizontal_length || 0),
                        roundedLength: Math.round(num(segment.horizontal_length || 0)),
                        points: segment.points_json || [],
                        color: segment.color,
                        size: segment.symbol_size || segment.size || layer.symbol_size || 'Medium',
                        quantityValue: qtyVal,
                        uom: layerUnit(layer),
                        createdAt: segment.createdAt || segment.created_at || null,
                        updatedAt: segment.updatedAt || segment.updated_at || null
                    };
                })
            ]
        };
    }

    function isEditorTakeoffDirty() {
        return Boolean(
            state.dirty
            || hasPendingManualCanvasCheckpoint
            || dirtyTakeoffPages.size > 0
            || dirtyTakeoffObjects.size > 0
            || deletedTakeoffObjects.size > 0
            || deletedTakeoffLayers.size > 0
        );
    }
    window.isEditorTakeoffDirty = isEditorTakeoffDirty;
    window.clearEditorTakeoffDirtyCheckpoint = function () {
        hasPendingManualCanvasCheckpoint = false;
    };

    function projectSnapshot(isUserDirty = false) {
        return {
            estimateKey: currentEstimateKey(),
            estimate_key: currentEstimateKey(),
            drawingId: typeof fileId !== 'undefined' ? fileId : null,
            drawing_id: typeof fileId !== 'undefined' ? fileId : null,
            projectId: typeof projectId !== 'undefined' ? projectId : 0,
            activeLayerId: state.selectedLayerUid,
            dirty: isEditorTakeoffDirty(),
            userDirty: Boolean(isUserDirty),
            layers: state.layers.map(projectLayerPayload),
            summary: calculateTakeoffSummary()
        };
    }

    let emitProjectStateTimer = null;
    let pendingEmitUserDirty = false;

    function emitProjectState(isUserDirty = false) {
        clearTimeout(emitProjectStateTimer);
        emitProjectStateTimer = null;
        const effectiveUserDirty = Boolean(isUserDirty || pendingEmitUserDirty);
        pendingEmitUserDirty = false;
        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({ type: 'project-takeoff-state', payload: projectSnapshot(effectiveUserDirty) }, '*');
            } catch (e) {}
        }
    }

    function flushPendingProjectStateEmit() {
        if (!emitProjectStateTimer && !pendingEmitUserDirty) return false;
        emitProjectState(pendingEmitUserDirty);
        return true;
    }

    function scheduleEmitProjectState(isUserDirty = false, delayMs = 260) {
        pendingEmitUserDirty = pendingEmitUserDirty || Boolean(isUserDirty);
        clearTimeout(emitProjectStateTimer);
        emitProjectStateTimer = setTimeout(() => {
            emitProjectStateTimer = null;
            emitProjectState(pendingEmitUserDirty);
        }, Math.max(40, Number(delayMs) || 260));
    }
    window.projectTakeoffFlushSnapshot = flushPendingProjectStateEmit;

    function filteredLayers() {
        const q = String(state.layerSearch || '').toLowerCase();
        return state.layers.filter(layer => {
            const matchesSearch = !q || [
                layer.name,
                layerGroup(layer),
                layerType(layer),
                layerUnit(layer),
                layerLinkedName(layer)
            ].join(' ').toLowerCase().includes(q);
            const matchesGroup = !state.layerGroupFilter || layerGroup(layer) === state.layerGroupFilter;
            const matchesType = !state.layerTypeFilter || layerType(layer) === state.layerTypeFilter;
            return matchesSearch && matchesGroup && matchesType;
        });
    }

    function renderLayerFilterOptions() {
        const groupSelect = document.getElementById('takeoffLayerGroupFilter');
        const typeSelect = document.getElementById('takeoffLayerTypeFilter');
        if (!groupSelect || !typeSelect) return;
        const groups = Array.from(new Set(state.layers.map(layerGroup))).sort();
        const types = Array.from(new Set(state.layers.map(layerType))).sort();
        groupSelect.innerHTML = '<option value="">All groups</option>' + groups.map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join('');
        typeSelect.innerHTML = '<option value="">All types</option>' + types.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(layerTypeLabel({ takeoff_type: type }))}</option>`).join('');
        groupSelect.value = groups.includes(state.layerGroupFilter) ? state.layerGroupFilter : '';
        typeSelect.value = types.includes(state.layerTypeFilter) ? state.layerTypeFilter : '';
    }

    function executeDeleteLayer(layer) {
        if (!layer) return;
        snapshot();
        state.markers.filter(marker => marker.layer_client_uid === layer.client_uid).forEach(destroyMarkerNodes);
        state.segments.filter(segment => segment.layer_client_uid === layer.client_uid).forEach(destroySegmentNodes);
        state.markers = state.markers.filter(marker => marker.layer_client_uid !== layer.client_uid);
        state.segments = state.segments.filter(segment => segment.layer_client_uid !== layer.client_uid);
        state.layers = state.layers.filter(row => row !== layer);
        if (state.selectedLayerUid === layer.client_uid) state.selectedLayerUid = state.layers[0]?.client_uid || null;
        state.selectedLayerUids.delete(layer.client_uid);
        state.selectedElement = null;
        markDirty({ pageFallback: true });
        renderAll();
    }

    async function deleteLayer(layer) {
        if (!layer) return;
        const confirmFn = window.parent?.showConfirmDialog || window.showConfirmDialog;
        if (typeof confirmFn === 'function') {
            const ok = await confirmFn({
                title: 'Delete Takeoff Layer',
                message: `Delete takeoff layer "${layer.name || 'Unnamed'}" and its measurements?`,
                confirmText: 'Delete Layer',
                primaryDanger: true
            });
            if (!ok) return;
        } else if (!confirm('Delete this takeoff layer and its measurements?')) {
            return;
        }
        executeDeleteLayer(layer);
    }

    function duplicateLayer(layer) {
        if (!layer) return;
        snapshot();
        const copyUid = uid();
        const copy = {
            ...JSON.parse(JSON.stringify(layer)),
            client_uid: copyUid,
            name: `${layer.name} Copy`,
            color: window.TakeoffColorPalette.duplicateColor(layer.color, state.layers
                .filter(item => layerGroup(item) === layerGroup(layer))
                .map(item => item.color)),
            metadata_json: { ...JSON.parse(JSON.stringify(layer.metadata_json || {})), project_layer_id: copyUid }
        };
        const srcIdx = state.layers.indexOf(layer);
        if (srcIdx >= 0) {
            state.layers.splice(srcIdx + 1, 0, copy);
        } else {
            state.layers.push(copy);
        }
        state.selectedLayerUid = copy.client_uid;
        markDirty({ pageFallback: true });
        renderAll();
    }

    function editLayer(layer) {
        if (!layer) return;
        const name = prompt('Layer name', layer.name || '');
        if (name === null) return;
        const group = prompt('Group', layerGroup(layer));
        if (group === null) return;
        const previousType = normalizeEditorLayerType(layer.takeoff_type || layer.type || layer.layer_type).type;
        const nextTypeRaw = prompt('Takeoff type: count, linear, area, volume, lump_sum', layerType(layer)) || layerType(layer);
        const nextNorm = normalizeEditorLayerType(nextTypeRaw);
        if (previousType !== nextNorm.type) {
            const msg = previousType === 'count'
                ? `Changing "${layer.name}" from Count to ${nextTypeRaw} will delete all existing count markers from the canvas and reset its quantity to 0.`
                : `Changing "${layer.name}" from ${previousType} to ${nextTypeRaw} will delete its existing measurements from the canvas and reset its quantity to 0.`;
            if (!window.confirm(msg)) return;
        }
        snapshot();
        layer.name = name.trim() || layer.name;
        layer.group_name = group.trim() || 'Ungrouped';
        layer.takeoff_type = nextNorm.type;
        layer.type = nextNorm.type;
        layer.takeoff_subtype = nextNorm.subtype;
        layer.unit_of_measure = prompt('Unit of measure', layerUnit(layer)) || layerUnit(layer);
        if (previousType !== nextNorm.type) {
            purgeIncompatibleLayerObjects(layer, nextNorm.type);
        } else {
            markDirty({ pageFallback: true });
        }
        renderAll();
    }

    function createLayerFromPrompt(group = null) {
        openCreateLayerModal(null, group || state.createLayerGroup || 'Ungrouped');
    }

    function openCreateLayerModal(layer = null, group = null) {
        state.createLayerMode = layer;
        state.createLayerGroup = group || layerGroup(layer || {}) || state.createLayerGroup || 'Ungrouped';
        state.createCatalogItemId = layer?.catalog_item_id || null;
        const item = state.createCatalogItemId ? state.catalog.items.find(row => String(row.id) === String(state.createCatalogItemId)) : null;
        document.getElementById('takeoffCreateName').value = layer?.name || item?.name || '';
        document.getElementById('takeoffCreateType').value = layerType(layer || {}) === 'mixed' ? 'count' : layerType(layer || {});
        document.getElementById('takeoffCreateUom').value = layer?.unit_of_measure || item?.unit_of_measure || 'ea';
        document.getElementById('takeoffCreateSymbol').value = layer?.symbol || item?.symbol || 'circle';
        document.getElementById('takeoffCreateSize').value = layer?.symbol_size || 'Medium';
        document.getElementById('takeoffCreateColor').value = layer?.color || item?.color || '#2563eb';
        updateCreateMeta(item, layer);
        document.getElementById('takeoffCreateModal').classList.remove('takeoff-hidden');
        validateCreateLayerModal();
        setTimeout(() => document.getElementById('takeoffCreateName').focus(), 40);
    }

    function closeCreateLayerModal() {
        document.getElementById('takeoffCreateModal')?.classList.add('takeoff-hidden');
        state.createLayerMode = null;
    }

    function validateCreateLayerModal() {
        const name = document.getElementById('takeoffCreateName')?.value.trim();
        const button = document.getElementById('takeoffCreateSubmit');
        if (button) button.disabled = !name;
    }

    function updateCreateMeta(item, layer = null) {
        const el = document.getElementById('takeoffCreateMeta');
        if (!el) return;
        const type = document.getElementById('takeoffCreateType')?.value || 'count';
        const copy = {
            count: 'Count Quantity items - EX: Light Fixtures, Electrical Outlets, Data Outlets',
            linear: 'Measure linear length items - EX: Conduit, cable, trenching',
            area: 'Measure area items - EX: Flooring, walls, ceiling areas',
            volume: 'Measure volume items - EX: Concrete, excavation',
            lump_sum: 'Track lump sum scope items - EX: Lighting Package Lump Sum'
        };
        el.textContent = copy[type] || copy.count;
    }

    function submitCreateLayerModal() {
        const item = state.createCatalogItemId ? state.catalog.items.find(row => String(row.id) === String(state.createCatalogItemId)) : null;
        const previousType = state.createLayerMode ? layerType(state.createLayerMode) : null;
        const payload = {
            name: document.getElementById('takeoffCreateName').value.trim(),
            takeoff_type: document.getElementById('takeoffCreateType').value,
            type: document.getElementById('takeoffCreateType').value,
            unit_of_measure: document.getElementById('takeoffCreateUom').value,
            symbol: document.getElementById('takeoffCreateSymbol').value,
            symbol_size: document.getElementById('takeoffCreateSize').value,
            color: document.getElementById('takeoffCreateColor').value || '#2563eb',
            group_name: state.createLayerGroup || item?.group_name || 'Ungrouped',
            catalog_item_id: item?.id || null,
            unit_cost: item?.unit_cost || 0,
            unit_labor_time: item?.labor_hours || 0,
            cost_code: item?.cost_code || '',
        };
        if (!payload.name || !payload.takeoff_type || !payload.unit_of_measure) return;
        snapshot();
        let targetLayer = null;
        if (state.createLayerMode) {
            Object.assign(state.createLayerMode, payload);
            state.selectedLayerUid = state.createLayerMode.client_uid;
            targetLayer = state.createLayerMode;
        } else {
            targetLayer = createLayer(payload);
        }
        if (targetLayer && previousType && previousType !== normalizeEditorLayerType(targetLayer.takeoff_type || targetLayer.type).type) {
            purgeIncompatibleLayerObjects(targetLayer, normalizeEditorLayerType(targetLayer.takeoff_type || targetLayer.type).type);
        }
        if (targetLayer && state.createLayerMode) {
            // Editing a layer changes its drawing contract as well as its row.
            // Apply the same values to already-created geometry so the canvas
            // and the persisted marker/segment rows cannot retain stale values.
            window.projectTakeoffUpdateLayerObjects?.(targetLayer.client_uid, {
                type: payload.takeoff_type,
                uom: payload.unit_of_measure,
                symbol: payload.symbol,
                color: payload.color,
                symbolSize: symbolRadius(payload.symbol_size),
                diameter: symbolRadius(payload.symbol_size) * 2
            });
        }
        state.createCatalogItemId = null;
        closeCreateLayerModal();
        if (targetLayer) activateLayerForInsert(targetLayer.client_uid);
        markDirty({ pageFallback: true });
        renderAll();
    }

    function purgeIncompatibleLayerObjects(layer, nextType, layerKeys = null) {
        if (!layer) return 0;
        const targetType = normalizeEditorLayerType(nextType).type;
        const keys = layerKeys instanceof Set ? new Set(layerKeys) : new Set([
            String(layer.client_uid || ''),
            String(layer.id || ''),
            String(layer.metadata_json?.project_layer_id || ''),
            String(layer.integration_key || '')
        ].filter(Boolean));
        if (state.draftLine && keys.has(String(state.draftLine.layerUid || ''))) {
            if (targetType !== 'linear') cancelLinearDraft();
        }
        if (state.draftArea && keys.has(String(state.draftArea.layerUid || ''))) {
            if (targetType !== 'area') clearDrafts();
        }
        const matchesLayer = (obj) => keys.has(String(obj?.layer_client_uid || '')) || keys.has(String(obj?.layer_id || ''));
        const removedMarkers = targetType === 'count' ? [] : state.markers.filter(matchesLayer);
        const removedSegments = state.segments.filter(segment => {
            if (!matchesLayer(segment)) return false;
            if (targetType === 'count') return true;
            const segType = normalizeEditorLayerType(segment.takeoff_type || segment.type).type;
            return segType !== targetType;
        });
        const removedTargets = [
            ...removedMarkers.map(ref => ({ type: 'marker', ref })),
            ...removedSegments.map(ref => ({ type: 'segment', ref }))
        ];
        if (removedTargets.length) {
            trackTakeoffObjects(removedTargets, true);
            const removedUidSet = new Set(removedTargets.map(item => String(item.ref?.client_uid || '')).filter(Boolean));
            removedMarkers.forEach(ref => {
                dirtyTakeoffPages.add(Number(ref.page_number || pageNum || 1));
                destroyMarkerNodes(ref);
            });
            removedSegments.forEach(ref => {
                dirtyTakeoffPages.add(Number(ref.page_number || pageNum || 1));
                destroySegmentNodes(ref);
            });
            const removedSet = new Set(removedTargets.map(item => item.ref));
            state.markers = state.markers.filter(marker => !removedSet.has(marker));
            state.segments = state.segments.filter(segment => !removedSet.has(segment));
            removedUidSet.forEach(uidVal => state.selectedObjectUids?.delete(uidVal));
            if (state.selectedElement?.ref && removedSet.has(state.selectedElement.ref)) {
                state.selectedElement = null;
            }
        }
        layer.seed_quantity = 0;
        layer.base_quantity = 0;
        layer.baseQuantity = 0;
        layer.quantity = 0;
        if (layer.metadata_json && typeof layer.metadata_json === 'object') {
            layer.metadata_json.base_quantity = 0;
        }
        markDirty({ pageFallback: true, objectsTracked: true });
        flushKonvaCanvasDraw();
        return removedTargets.length;
    }

    function clearIncompatibleMeasurements(layer, nextType) {
        return purgeIncompatibleLayerObjects(layer, nextType);
    }

    function openCatalogBrowser() {
        document.getElementById('takeoffCatalogModal').classList.remove('takeoff-hidden');
        renderCatalogBrowser();
        setTimeout(() => document.getElementById('takeoffCatalogSearch').focus(), 40);
    }

    function closeCatalogBrowser() {
        document.getElementById('takeoffCatalogModal')?.classList.add('takeoff-hidden');
    }

    function catalogSearchMatch(item, q) {
        if (!q) return true;
        return [
            item.name,
            item.description,
            item.manufacturer,
            item.catalog_number,
            item.cost_code,
            item.group_name,
            item.catalog_name,
            item.sku,
        ].join(' ').toLowerCase().includes(q);
    }

    function renderCatalogBrowser() {
        const q = String(document.getElementById('takeoffCatalogSearch')?.value || '').toLowerCase();
        const tree = document.getElementById('takeoffCatalogTree');
        const results = document.getElementById('takeoffCatalogResults');
        if (!tree || !results) return;
        const catalogs = state.catalog.catalogs || [];
        const groups = state.catalog.groups || state.catalog.categories || [];
        tree.innerHTML = catalogs.map(catalog => {
            const childGroups = groups.filter(group => String(group.catalog_id) === String(catalog.id));
            return `<div class="takeoff-catalog-node">
                <div class="takeoff-catalog-node-title"><i class="fas fa-book"></i>${escapeHtml(catalog.name)}</div>
                ${childGroups.map(group => `<button data-catalog-group="${group.id}">${escapeHtml(group.name)}</button>`).join('')}
            </div>`;
        }).join('') || '<div class="takeoff-empty-state">No catalogs found.</div>';
        const items = (state.catalog.items || []).filter(item => catalogSearchMatch(item, q)).slice(0, 120);
        results.innerHTML = items.map(item => `
            <button class="takeoff-catalog-result" data-catalog-pick="${item.id}">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.catalog_name || 'Catalog')} / ${escapeHtml(item.group_name || 'Ungrouped')}</span>
                <small>${escapeHtml(item.description || item.manufacturer || '')}</small>
                <em>${escapeHtml(item.unit_of_measure || 'ea')} | ${money(item.unit_cost || 0)} | ${escapeHtml(item.cost_code || item.catalog_number || '')}</em>
            </button>
        `).join('') || '<div class="takeoff-empty-state">No catalog items match your search.</div>';
        tree.querySelectorAll('[data-catalog-group]').forEach(btn => btn.addEventListener('click', () => {
            const group = groups.find(row => String(row.id) === String(btn.dataset.catalogGroup));
            document.getElementById('takeoffCatalogSearch').value = group?.name || '';
            renderCatalogBrowser();
        }));
        results.querySelectorAll('[data-catalog-pick]').forEach(btn => btn.addEventListener('click', () => {
            const item = state.catalog.items.find(row => String(row.id) === String(btn.dataset.catalogPick));
            if (!item) return;
            state.createCatalogItemId = item.id;
            document.getElementById('takeoffCreateName').value = item.name || '';
            const uomSelect = document.getElementById('takeoffCreateUom');
            const uomVal = (item.unit_of_measure || 'ea').trim();
            if (uomSelect) {
                let match = Array.from(uomSelect.options).find(o => o.value.toLowerCase() === uomVal.toLowerCase());
                if (!match) {
                    const opt = document.createElement('option');
                    opt.value = uomVal;
                    opt.textContent = uomVal;
                    uomSelect.appendChild(opt);
                }
                uomSelect.value = match ? match.value : uomVal;
            }
            document.getElementById('takeoffCreateColor').value = item.color || '#2563eb';
            document.getElementById('takeoffCreateSymbol').value = item.symbol || 'circle';
            const uomLower = uomVal.toLowerCase();
            const isLinear = ['ft', 'lf', 'mft', 'kft', 'cft', 'm', 'km', 'linear'].includes(uomLower);
            const isArea = ['sf', 'sq ft', 'sqft', 'sy', 'sq yd', 'm2', 'area'].includes(uomLower);
            document.getElementById('takeoffCreateType').value = isLinear ? 'linear' : (isArea ? 'area' : 'count');
            updateCreateMeta(item);
            validateCreateLayerModal();
            closeCatalogBrowser();
        }));
    }

    function applyLayerBulk(action) {
        const uids = Array.from(state.selectedLayerUids);
        if (!uids.length && state.selectedLayerUid) uids.push(state.selectedLayerUid);
        if (!uids.length) return;
        if (action === 'move') {
            const group = prompt('Move selected to group', 'Lighting');
            if (!group) return;
            snapshot();
            uids.forEach(uidValue => {
                const layer = state.layers.find(row => row.client_uid === uidValue);
                if (layer) layer.group_name = group.trim();
            });
            markDirty();
            renderAll();
            return;
        }
        if (action === 'estimate') {
            snapshot();
            uids.forEach(uidValue => {
                const layer = state.layers.find(row => row.client_uid === uidValue);
                if (layer) layer.estimate_item_id = layer.estimate_item_id || `pending_${layer.client_uid}`;
            });
            markDirty();
            renderAll();
            return;
        }
        snapshot();
        uids.forEach(uidValue => {
            const layer = state.layers.find(row => row.client_uid === uidValue);
            if (!layer) return;
            if (action === 'show') layer.visible = 1;
            if (action === 'hide') layer.visible = 0;
            if (action === 'lock') layer.locked = 1;
            if (action === 'delete') {
                state.markers.filter(marker => marker.layer_client_uid === layer.client_uid).forEach(destroyMarkerNodes);
                state.segments.filter(segment => segment.layer_client_uid === layer.client_uid).forEach(destroySegmentNodes);
                state.markers = state.markers.filter(marker => marker.layer_client_uid !== layer.client_uid);
                state.segments = state.segments.filter(segment => segment.layer_client_uid !== layer.client_uid);
                state.layers = state.layers.filter(row => row !== layer);
            }
        });
        state.selectedLayerUids.clear();
        setTakeoffPage(pageNum);
        markDirty();
        renderAll();
    }

    function setTool(tool) {
        if (tool === 'select') tool = 'smart';
        if (['takeoff_count', 'takeoff_linear', 'takeoff_area'].includes(tool)
            && typeof window.takeoffRequireWrite === 'function'
            && !window.takeoffRequireWrite()) return false;
        if (tool === 'takeoff_linear' && !requirePlanScale('linear')) return false;
        window.releaseTakeoffPointerState?.();
        if (tool !== 'multi-select' && selectionRectDraft) {
            selectionRectDraft.node?.destroy();
            selectionRectDraft = null;
            konvaLayer?.batchDraw();
        }
        const leavingLinear = state.tool === 'takeoff_linear' && tool !== 'takeoff_linear';
        if (leavingLinear && state.draftLine) {
            if (state.draftLine.points.length >= 2) {
                finishLinear();
            } else {
                cancelLinearDraft();
            }
        }
        state.tool = tool;
        window.__takeoffDrawingActive = ['takeoff_count', 'takeoff_linear', 'takeoff_area'].includes(tool);
        applyTakeoffDrawingInteractivity();
        if (tool === 'takeoff_count' || tool === 'takeoff_linear' || tool === 'takeoff_area') {
            if (typeof setMode === 'function') setMode('smart');
            ensureKonva();
            bindKonva();
            if (konvaStage?.container()) konvaStage.container().style.cursor = 'crosshair';
            const label = tool === 'takeoff_count'
                ? 'Count tool active'
                : (tool === 'takeoff_area'
                    ? 'Area tool active. Double-click to finish.'
                    : 'Click to add points. Double-click, Enter, or deselect the item to finish.');
            showToast(label, 'success');
        } else if (konvaStage?.container()) {
            if (tool === 'smart' && typeof setMode === 'function') {
                if (typeof currentMode === 'undefined' || currentMode !== 'measure') {
                    setMode('smart');
                }
                ensureKonva();
                bindKonva();
                if (typeof setKonvaActive === 'function') setKonvaActive(true);
            }
            clearDrafts();
            konvaStage.container().style.cursor = (typeof currentMode !== 'undefined' && currentMode === 'measure') ? 'crosshair' : 'default';
        }
        document.querySelectorAll('[data-takeoff-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.takeoffTool === tool));
        updateDrawingStatus();
        emitToolState();
    }

    function updateDrawingStatus(pointer) {
        const badge = document.getElementById('takeoffDrawingStatus');
        if (!badge) return;
        // Drawing guidance is already conveyed by the active tool and cursor.
        // Keep the former overlay disabled so it does not cover the plan.
        badge.classList.add('takeoff-hidden');
        badge.replaceChildren();
        return;
        const layer = state.layers.find(row => row.client_uid === (state.draftLine?.layerUid || state.selectedLayerUid));
        const active = state.tool === 'takeoff_linear' && layer && layerType(layer) === 'linear';
        badge.classList.toggle('takeoff-hidden', !active);
        if (!active) return;
        let detail = 'Click to place the first point';
        if (state.draftLine?.points.length) {
            const confirmed = pointsLength(state.draftLine.points);
            const last = state.draftLine.points[state.draftLine.points.length - 1];
            const partial = pointer ? pointsLength([last, pointer]) : 0;
            detail = `Segment: ${formatFeetLabel(partial)} · Total: ${formatFeetLabel(confirmed + partial)}`;
        }
        badge.innerHTML = `<strong>Drawing: ${escapeHtml(layer.name)}</strong><span>${escapeHtml(detail)}</span><small>Click to add points. Double-click, Enter, or deselect the item to finish.</small>`;
    }

    function bindKonva() {
        if (!ensureKonva() || konvaStage._takeoffBound) return;
        konvaStage._takeoffBound = true;
        const finishRectangleSelection = () => {
            if (!selectionRectDraft) return false;
            const start = selectionRectDraft.start;
            const current = selectionRectDraft.current || start;
            // Keep selection geometry in world coordinates. Reading the visual
            // node's client rect here produced inconsistent bounds when the PDF
            // layer was zoomed or translated.
            const rect = {
                x: Math.min(start.x, current.x),
                y: Math.min(start.y, current.y),
                width: Math.abs(current.x - start.x),
                height: Math.abs(current.y - start.y)
            };
            selectionRectDraft.node.destroy();
            selectionRectDraft = null;
            if (rect.width < 3 && rect.height < 3) {
                konvaLayer.batchDraw();
                return false;
            }
            const targets = [
                ...state.markers.filter(marker => marker.page_number === pageNum && marker.node?.visible() && !isElementLocked(marker))
                    .filter(marker => Konva.Util.haveIntersection(rect, marker.node.getClientRect({ relativeTo: konvaLayer })))
                    .map(marker => ({ type: 'marker', ref: marker })),
                ...state.segments.filter(segment => segment.page_number === pageNum && segment.node?.visible() && !isElementLocked(segment))
                    .filter(segment => Konva.Util.haveIntersection(rect, segment.node.getClientRect({ relativeTo: konvaLayer })))
                    .map(segment => ({ type: 'segment', ref: segment }))
            ];
            state.selectedObjectUids = new Set(targets.map(target => String(target.ref.client_uid)));
            state.selectedElement = targets.length === 1 ? targets[0] : null;
            state.segments.forEach(segment => (segment.handles || []).forEach(handle => handle.visible(false)));
            applyObjectSelectionVisuals();
            renderProperties();
            emitSelectionState();
            // Rectangle selection is a one-shot gesture. Return to Pointer so
            // the selected set can immediately be dragged, deleted, or edited.
            setTool('smart');
            konvaLayer.batchDraw();
            return true;
        };

        konvaStage.on('pointermove mousemove touchmove', evt => {
            if (state.tool !== 'multi-select' || !selectionRectDraft) return;
            const pos = konvaStage.getPointerPosition();
            if (!pos) return;
            evt.cancelBubble = true;
            const current = screenToWorld(pos);
            selectionRectDraft.current = current;
            selectionRectDraft.node.position({
                x: Math.min(selectionRectDraft.start.x, current.x),
                y: Math.min(selectionRectDraft.start.y, current.y)
            });
            selectionRectDraft.node.size({
                width: Math.abs(current.x - selectionRectDraft.start.x),
                height: Math.abs(current.y - selectionRectDraft.start.y)
            });
            konvaLayer.batchDraw();
        });

        let drawPointerDown = null;
        let drawDidDrag = false;

        konvaStage.on('pointerdown mousedown touchstart', evt => {
            if (['takeoff_count', 'takeoff_linear', 'takeoff_area'].includes(state.tool)) {
                const clientX = evt.evt?.clientX != null ? evt.evt.clientX : evt.evt?.touches?.[0]?.clientX;
                const clientY = evt.evt?.clientY != null ? evt.evt.clientY : evt.evt?.touches?.[0]?.clientY;
                if (clientX != null && clientY != null) {
                    drawPointerDown = { x: clientX, y: clientY };
                    drawDidDrag = false;
                }
            }
        });

        konvaStage.on('pointermove mousemove touchmove', evt => {
            if (drawPointerDown && ['takeoff_count', 'takeoff_linear', 'takeoff_area'].includes(state.tool)) {
                const clientX = evt.evt?.clientX != null ? evt.evt.clientX : evt.evt?.touches?.[0]?.clientX;
                const clientY = evt.evt?.clientY != null ? evt.evt.clientY : evt.evt?.touches?.[0]?.clientY;
                if (clientX != null && clientY != null) {
                    if (Math.hypot(clientX - drawPointerDown.x, clientY - drawPointerDown.y) >= 6) {
                        drawDidDrag = true;
                    }
                }
            }
        });

        konvaStage.on('click tap', evt => {
            if (state.tool === 'multi-select') {
                const nativeEvent = evt.evt;
                if (nativeEvent?.button != null && nativeEvent.button !== 0) return;
                const pos = konvaStage.getPointerPosition();
                if (!pos) return;
                evt.cancelBubble = true;
                const world = screenToWorld(pos);
                if (selectionRectDraft) {
                    selectionRectDraft.current = world;
                    finishRectangleSelection();
                    return;
                }
                const node = new Konva.Rect({
                    x: world.x, y: world.y, width: 0, height: 0,
                    fill: 'rgba(56, 189, 248, 0.14)', stroke: '#38bdf8',
                    strokeWidth: 1.5, dash: [7, 5], listening: false
                });
                selectionRectDraft = { start: world, current: world, node, pageNumber: pageNum };
                konvaLayer.add(node);
                node.moveToTop();
                konvaLayer.batchDraw();
                return;
            }
            if (state.tool === 'smart') {
                if ((evt.target === konvaStage || evt.target === konvaLayer) && !evt.evt?.shiftKey) clearTakeoffSelection();
                return;
            }
            if (state.tool !== 'takeoff_count' && state.tool !== 'takeoff_linear' && state.tool !== 'takeoff_area') return;
            if (evt.target !== konvaStage && evt.target.getParent() !== konvaLayer) return;

            // When drawing (count, linear, area), separate click from click-and-drag panning
            if (['takeoff_count', 'takeoff_linear', 'takeoff_area'].includes(state.tool)) {
                const wasDragging = drawDidDrag || Boolean(window.__takeoffJustPanned) || Boolean(window.__takeoffIsPanning);
                drawPointerDown = null;
                drawDidDrag = false;
                if (wasDragging) return;
            }

            // Geometry creation is allowed only when the interaction mode and
            // the explicitly active layer agree. Never repair a stale layer or
            // tool from a canvas click and never fall back to the last item.
            const layer = activePlacementLayer();
            if (!layer) {
                return;
            }
            if (layer.metadata_json?.estimating_override_block) {
                try {
                    window.parent?.postMessage({
                        type: 'takeoff-canvas-blocked-by-estimating-override',
                        payload: {
                            layerId: layer.client_uid || layer.id,
                            name: layer.name || 'Takeoff Item',
                            estimatingQty: Number(layer.metadata_json?.estimating_override_qty || 0),
                            uom: layer.metadata_json?.estimating_override_uom || layer.unit_of_measure || 'ea'
                        }
                    }, '*');
                } catch (_) {}
                return;
            }
            const pos = konvaStage.getPointerPosition();
            const world = screenToWorld(pos);
            if (layerType(layer) === 'linear') addLinearPoint(linearPointForPointer(world, evt.evt?.shiftKey || linearShiftPressed));
            else if (layerType(layer) === 'area') addAreaPoint(world);
            else {
                const placementOperationId = countPlacementGuard?.begin({
                    layerId: layer.client_uid,
                    pageNumber: pageNum,
                    pointerId: evt.evt?.pointerId ?? evt.evt?.changedTouches?.[0]?.identifier ?? '',
                    eventType: evt.type || evt.evt?.type || 'click',
                    eventTimestamp: evt.evt?.timeStamp ?? Date.now(),
                    x: world.x,
                    y: world.y
                }) || null;
                if (countPlacementGuard && !placementOperationId) return;
                addMarker(world, placementOperationId);
            }
        });
        konvaStage.on('dblclick dbltap', () => {
            if (state.tool === 'takeoff_linear') finishLinear();
            if (state.tool === 'takeoff_area') finishArea();
        });
        konvaStage.on('mousemove touchmove', evt => {
            const pos = konvaStage.getPointerPosition();
            if (!pos) return;
            const world = screenToWorld(pos);
            linearPointerWorld = world;
            linearShiftPressed = Boolean(evt.evt?.shiftKey);
            renderLinearPreview(world, linearShiftPressed);
            if (state.tool === 'takeoff_area' && state.draftArea?.preview && state.draftArea.points.length) {
                updateAreaDraftPreview([...state.draftArea.points, world]);
                konvaLayer.batchDraw();
            }
        });
    }

    function renderShell() {
        const wrapper = document.getElementById('canvas-wrapper');
        if (!wrapper || document.getElementById('takeoffWorkspace')) return;
        const root = document.createElement('div');
        root.id = 'takeoffWorkspace';
        root.className = 'takeoff-workspace';
        root.innerHTML = `
            <section class="takeoff-panel" id="takeoffPanel">
                <div class="takeoff-panel-header">
                    <div class="takeoff-title">Takeoffs (<span id="takeoffLayerCount">0</span>)</div>
                    <button class="takeoff-icon-btn" id="takeoffNewLayerTop" title="Create takeoff layer"><i class="fas fa-plus"></i></button>
                </div>
                <div class="takeoff-panel-section">
                    <input class="takeoff-search-input" id="takeoffLayerSearch" placeholder="Search Takeoffs">
                </div>
                <div class="takeoff-actions-strip">
                    <i class="fas fa-eye"></i>
                    <button class="takeoff-actions-btn" id="takeoffActionsBtn">Actions <i class="fas fa-caret-down"></i></button>
                </div>
                <div class="takeoff-panel-body">
                    <div id="takeoffLayersTab"></div>
                </div>
            </section>
            <section class="takeoff-props" id="takeoffProps"></section>
            <section class="takeoff-summary" id="takeoffSummary"></section>
            <div class="takeoff-drawing-status takeoff-hidden" id="takeoffDrawingStatus"></div>
            <div class="takeoff-modal-backdrop takeoff-hidden" id="takeoffCreateModal">
                <div class="takeoff-modal">
                    <div class="takeoff-modal-head">
                        <h3>Create new takeoff layer</h3>
                        <button class="takeoff-mini-btn" id="takeoffCreateClose"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="takeoff-modal-body">
                        <div class="takeoff-field">
                            <label>Catalog Item Name</label>
                            <div class="takeoff-pick-row">
                                <input id="takeoffCreateName" placeholder="Enter material name or pick one from catalog">
                                <button class="takeoff-command browse" id="takeoffBrowseCatalog" type="button"><i class="fas fa-list"></i> Browse Catalog</button>
                            </div>
                        </div>
                        <div class="takeoff-create-row">
                            <div class="takeoff-field takeoff-type-field"><label>Takeoff Type</label><select id="takeoffCreateType">
                                <option value="count">Count</option><option value="linear">Linear</option><option value="area">Area</option><option value="volume">Volume</option><option value="lump_sum">Lump Sum</option>
                            </select></div>
                            <div class="takeoff-field"><label>UoM</label><select id="takeoffCreateUom"><option>ea</option><option>ft</option><option>lf</option><option>sf</option><option>cy</option><option>lot</option><option>hr</option></select></div>
                            <div class="takeoff-field"><label>Symbol</label><select id="takeoffCreateSymbol">
                                <option value="circle">●</option><option value="square">■</option><option value="pentagon">⬟</option><option value="diamond">◆</option><option value="triangle">▲</option><option value="cross">✚</option><option value="line">━</option>
                            </select></div>
                            <div class="takeoff-field"><label>Size</label><select id="takeoffCreateSize"><option>Small</option><option selected>Medium</option><option>Large</option></select></div>
                            <div class="takeoff-field"><label>Color</label><input id="takeoffCreateColor" type="color" value="#2563eb"></div>
                        </div>
                        <div class="takeoff-create-meta" id="takeoffCreateMeta"></div>
                    </div>
                    <div class="takeoff-modal-actions">
                        <button class="takeoff-command" id="takeoffCreateCancel">Cancel</button>
                        <button class="takeoff-command primary" id="takeoffCreateSubmit" disabled>Create</button>
                    </div>
                </div>
            </div>
            <div class="takeoff-modal-backdrop takeoff-hidden" id="takeoffCatalogModal">
                <div class="takeoff-modal takeoff-catalog-modal">
                    <div class="takeoff-modal-head">
                        <h3>Browse Catalog</h3>
                        <button class="takeoff-mini-btn" id="takeoffCatalogClose"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="takeoff-modal-body">
                        <div class="takeoff-field"><label>Search Catalog</label><input id="takeoffCatalogSearch" placeholder="Item, description, manufacturer, catalog number, cost code, group"></div>
                        <div class="takeoff-catalog-browser">
                            <div class="takeoff-catalog-tree" id="takeoffCatalogTree"></div>
                            <div class="takeoff-catalog-results" id="takeoffCatalogResults"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="takeoff-menu takeoff-hidden" id="takeoffContextMenu"></div>
        `;
        wrapper.appendChild(root);
        root.querySelectorAll('[data-takeoff-tool]').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.takeoffTool)));
        document.getElementById('takeoffNewLayerTop').addEventListener('click', () => openCreateLayerModal(null, state.createLayerGroup || 'Ungrouped'));
        document.getElementById('takeoffCreateClose').addEventListener('click', closeCreateLayerModal);
        document.getElementById('takeoffCreateCancel').addEventListener('click', closeCreateLayerModal);
        document.getElementById('takeoffCreateSubmit').addEventListener('click', submitCreateLayerModal);
        document.getElementById('takeoffBrowseCatalog').addEventListener('click', openCatalogBrowser);
        document.getElementById('takeoffCatalogClose').addEventListener('click', closeCatalogBrowser);
        document.getElementById('takeoffCatalogSearch').addEventListener('input', renderCatalogBrowser);
        ['takeoffCreateName', 'takeoffCreateType', 'takeoffCreateUom'].forEach(id => {
            document.getElementById(id).addEventListener('input', validateCreateLayerModal);
            document.getElementById(id).addEventListener('change', validateCreateLayerModal);
        });
        document.getElementById('takeoffCreateType').addEventListener('change', () => updateCreateMeta(null, state.createLayerMode));
        document.getElementById('takeoffLayerSearch').addEventListener('input', event => {
            state.layerSearch = event.target.value;
            renderLayers();
        });
        document.getElementById('takeoffActionsBtn').addEventListener('click', event => openActionsMenu(event.currentTarget));
        document.addEventListener('click', event => {
            const menu = document.getElementById('takeoffContextMenu');
            if (menu && !menu.contains(event.target) && !event.target.closest('[data-layer-action],[data-group-action],#takeoffActionsBtn')) {
                menu.classList.add('takeoff-hidden');
            }
        });
        document.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                saveTakeoff();
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                if (state.draftLine) {
                    undoLinearPoint();
                    return;
                }
                if (!state.undo.length) return;
                state.redo.push(JSON.stringify({ layers: state.layers, markers: state.markers.map(stripNodes), segments: state.segments.map(stripNodes) }));
                restore(state.undo.pop());
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
                event.preventDefault();
                if (!state.redo.length) return;
                state.undo.push(JSON.stringify({ layers: state.layers, markers: state.markers.map(stripNodes), segments: state.segments.map(stripNodes) }));
                restore(state.redo.pop());
            }
        });
        root._takeoffUndoHandler = () => {
            if (!state.undo.length) return;
            state.redo.push(JSON.stringify({ layers: state.layers, markers: state.markers.map(stripNodes), segments: state.segments.map(stripNodes) }));
            restore(state.undo.pop());
        };
        root._takeoffRedoHandler = () => {
            if (!state.redo.length) return;
            state.undo.push(JSON.stringify({ layers: state.layers, markers: state.markers.map(stripNodes), segments: state.segments.map(stripNodes) }));
            restore(state.redo.pop());
        };
    }

    function activateTab(tab) {
        document.querySelectorAll('[data-takeoff-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.takeoffTab === tab));
        document.getElementById('takeoffCatalogTab')?.classList.toggle('takeoff-hidden', tab !== 'catalog');
        document.getElementById('takeoffAssembliesTab')?.classList.toggle('takeoff-hidden', tab !== 'assemblies');
        document.getElementById('takeoffLayersTab')?.classList.toggle('takeoff-hidden', tab !== 'layers');
    }

    function renderCatalog() {
        const el = document.getElementById('takeoffCatalogTab');
        if (!el) return;
        el.innerHTML = `<div class="takeoff-field"><label>Search material</label><input id="takeoffItemSearch" placeholder="Wire, conduit, receptacle"></div><div class="takeoff-list" id="takeoffItemList"></div>`;
        const render = () => {
            const q = (document.getElementById('takeoffItemSearch').value || '').toLowerCase();
            const list = document.getElementById('takeoffItemList');
            list.innerHTML = state.catalog.items
                .filter(item => !q || String(item.name).toLowerCase().includes(q) || String(item.sku || '').toLowerCase().includes(q))
                .slice(0, 60)
                .map(item => `<div class="takeoff-list-item ${String(item.id) === String(state.selectedItemId) ? 'active' : ''}" data-item-id="${item.id}">
                    <div class="takeoff-list-title">${escapeHtml(item.name)}</div>
                    <div class="takeoff-list-meta">${escapeHtml(item.item_type)} · ${escapeHtml(item.unit_of_measure)} · ${money(item.unit_cost)}</div>
                </div>`).join('');
            list.querySelectorAll('[data-item-id]').forEach(row => row.addEventListener('click', () => {
                state.selectedItemId = row.dataset.itemId;
                state.selectedAssemblyId = null;
                createLayer({ name: currentItem()?.name, color: currentItem()?.color, symbol: currentItem()?.symbol });
                renderAll();
            }));
        };
        document.getElementById('takeoffItemSearch').addEventListener('input', render);
        render();
    }

    function renderAssemblies() {
        const el = document.getElementById('takeoffAssembliesTab');
        if (!el) return;
        el.innerHTML = `<div class="takeoff-list">${state.assemblies.assemblies.map(a => `<div class="takeoff-list-item ${String(a.id) === String(state.selectedAssemblyId) ? 'active' : ''}" data-assembly-id="${a.id}">
            <div class="takeoff-list-title">${escapeHtml(a.name)}</div>
            <div class="takeoff-list-meta">${escapeHtml(a.unit_of_measure)} · ${escapeHtml(a.description || '')}</div>
        </div>`).join('')}</div>`;
        el.querySelectorAll('[data-assembly-id]').forEach(row => row.addEventListener('click', () => {
            state.selectedAssemblyId = row.dataset.assemblyId;
            state.selectedItemId = null;
            createLayer({ name: currentAssembly()?.name });
            renderAll();
        }));
    }

    function renderLayers() {
        const el = document.getElementById('takeoffLayersTab');
        if (!el) return;
        const countEl = document.getElementById('takeoffLayerCount');
        if (countEl) countEl.textContent = String(state.layers.length);

        const groups = {};
        filteredLayers().forEach(layer => {
            const group = layerGroup(layer);
            if (!groups[group]) groups[group] = [];
            groups[group].push(layer);
        });

        el.innerHTML = `<div class="takeoff-layer-groups">${Object.keys(groups).sort().map(group => {
            const collapsed = state.collapsedGroups.has(group);
            const rows = groups[group];
            return `<div class="takeoff-layer-group">
                <div class="takeoff-layer-group-head">
                    <button class="takeoff-group-eye" data-group-action="visibility" data-group-name="${escapeHtml(group)}"><i class="fas fa-eye"></i></button>
                    <input type="checkbox" class="takeoff-group-check" data-group-check="${escapeHtml(group)}">
                    <button class="takeoff-group-toggle" data-layer-group="${escapeHtml(group)}"><i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i></button>
                    <span>${escapeHtml(group)}</span>
                    <button class="takeoff-mini-btn" data-group-action="menu" data-group-name="${escapeHtml(group)}" title="Group actions"><i class="fas fa-ellipsis-vertical"></i></button>
                </div>
                <div ${collapsed ? 'hidden' : ''}>
                    ${rows.map(layer => renderLayerRow(layer)).join('')}
                </div>
            </div>`;
        }).join('') || '<div class="takeoff-empty-state">No takeoff layers match the current filters.</div>'}</div>`;

        el.querySelectorAll('[data-layer-group]').forEach(btn => btn.addEventListener('click', event => {
            event.stopPropagation();
            const group = btn.dataset.layerGroup;
            if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group);
            else state.collapsedGroups.add(group);
            renderLayers();
        }));

        el.querySelectorAll('[data-group-action]').forEach(btn => btn.addEventListener('click', event => {
            event.stopPropagation();
            if (btn.dataset.groupAction === 'menu') openGroupMenu(btn, btn.dataset.groupName);
            if (btn.dataset.groupAction === 'visibility') {
                const layers = state.layers.filter(layer => layerGroup(layer) === btn.dataset.groupName);
                const next = layers.some(layer => Number(layer.visible) !== 0) ? 0 : 1;
                snapshot();
                layers.forEach(layer => { layer.visible = next; });
                setTakeoffPage(pageNum);
                markDirty();
            }
        }));

        el.querySelectorAll('[data-group-check]').forEach(box => {
            box.addEventListener('click', event => event.stopPropagation());
            box.addEventListener('change', () => {
                const layers = state.layers.filter(layer => layerGroup(layer) === box.dataset.groupCheck);
                if (box.checked) layers.forEach(layer => state.selectedLayerUids.add(layer.client_uid));
                else layers.forEach(layer => state.selectedLayerUids.delete(layer.client_uid));
                renderLayers();
            });
        });

        el.querySelectorAll('[data-layer-uid]').forEach(row => row.addEventListener('click', () => {
            activateLayerForInsert(row.dataset.layerUid);
        }));

        el.querySelectorAll('[data-layer-check]').forEach(box => {
            box.addEventListener('click', event => event.stopPropagation());
            box.addEventListener('change', () => {
                if (box.checked) activateLayerForInsert(box.dataset.layerCheck);
                else if (String(state.selectedLayerUid || '') === String(box.dataset.layerCheck)) deactivateLayerForInsert();
            });
        });

        el.querySelectorAll('[data-layer-action]').forEach(btn => btn.addEventListener('click', event => {
            event.stopPropagation();
            const layer = state.layers.find(row => row.client_uid === btn.dataset.layerUid);
            if (!layer) return;
            if (btn.dataset.layerAction === 'menu') openLayerMenu(btn, layer);
            else handleLayerAction(btn.dataset.layerAction, layer);
        }));
    }

    function renderLayerRow(layer) {
        const qty = layerQuantity(layer);
        const visible = Number(layer.visible) !== 0;
        const selected = layer.client_uid === state.selectedLayerUid;
        const checked = state.selectedLayerUids.has(layer.client_uid);
        return `<div class="takeoff-layer-row ${selected ? 'active' : ''}" data-layer-uid="${layer.client_uid}">
            <button class="takeoff-layer-eye ${visible ? '' : 'off'}" data-layer-action="visible" data-layer-uid="${layer.client_uid}" title="Show/hide">
                <i class="fas fa-eye${visible ? '' : '-slash'}"></i>
            </button>
            <input type="checkbox" class="takeoff-layer-check" data-layer-check="${layer.client_uid}" ${checked ? 'checked' : ''}>
            <div class="takeoff-layer-copy">
                <div class="takeoff-layer-name">${escapeHtml(layer.name)}</div>
                <div class="takeoff-layer-meta">${layerSymbol(layer)} <span>${formatLayerQty(qty)}</span></div>
            </div>
            <button class="takeoff-mini-btn" data-layer-action="menu" data-layer-uid="${layer.client_uid}" title="Layer actions"><i class="fas fa-ellipsis-vertical"></i></button>
        </div>`;
    }

    function handleGroupAction(group) {
        const choice = prompt('Group action: rename, show, hide, lock, delete', 'rename');
        if (!choice) return;
        const action = choice.trim().toLowerCase();
        const layers = state.layers.filter(layer => layerGroup(layer) === group);
        if (!layers.length) return;
        if (action === 'rename') {
            const next = prompt('New group name', group);
            if (!next) return;
            snapshot();
            layers.forEach(layer => { layer.group_name = next.trim() || group; });
        }
        if (action === 'show' || action === 'hide' || action === 'lock') {
            snapshot();
            layers.forEach(layer => {
                if (action === 'show') layer.visible = 1;
                if (action === 'hide') layer.visible = 0;
                if (action === 'lock') layer.locked = 1;
            });
            setTakeoffPage(pageNum);
        }
        if (action === 'delete') {
            if (!confirm('Delete all layers in this group?')) return;
            snapshot();
            layers.forEach(deleteLayerWithoutConfirm);
        }
        markDirty();
        renderAll();
    }

    function purgeObjectsForLayerKeys(keysInput) {
        const keys = keysInput instanceof Set ? keysInput : new Set((keysInput || []).map(String).filter(Boolean));
        if (!keys.size) return [];
        const matchesLayerKey = (obj) => {
            const lcu = String(obj?.layer_client_uid || '');
            const lid = String(obj?.layer_id || '');
            return (lcu && keys.has(lcu)) || (lid && keys.has(lid));
        };
        const removedObjects = [
            ...state.markers.filter(matchesLayerKey).map(ref => ({ type: 'marker', ref })),
            ...state.segments.filter(matchesLayerKey).map(ref => ({ type: 'segment', ref }))
        ];
        if (state.draftLine && keys.has(String(state.draftLine.layerUid || ''))) {
            cancelLinearDraft();
        }
        if (state.draftArea && keys.has(String(state.draftArea.layerUid || ''))) {
            clearDrafts();
        }
        removedObjects.forEach(({ ref }) => {
            const p = Number(ref?.page_number || pageNum || 1);
            if (p > 0) dirtyTakeoffPages.add(p);
        });
        if (removedObjects.length) {
            trackTakeoffObjects(removedObjects, true);
        }
        removedObjects.forEach(target => {
            const objUid = String(target.ref?.client_uid || '');
            if (objUid) state.selectedObjectUids.delete(objUid);
            if (state.selectedElement?.ref === target.ref) state.selectedElement = null;
            if (target.type === 'marker') destroyMarkerNodes(target.ref);
            else destroySegmentNodes(target.ref);
        });
        state.markers = state.markers.filter(marker => !matchesLayerKey(marker));
        state.segments = state.segments.filter(segment => !matchesLayerKey(segment));
        return removedObjects;
    }

    function deleteLayerWithoutConfirm(layer, explicitKeys = []) {
        const keys = new Set([
            ...(layer ? layerTrackingKeys(layer) : []),
            ...(Array.isArray(explicitKeys) ? explicitKeys : []).map(String).filter(Boolean)
        ]);
        if (!keys.size) return;
        if (layer) trackDeletedLayer(layer);
        keys.forEach(k => deletedTakeoffLayers.add(k));
        dirtyTakeoffPages.add(Number(layer?.page_number || pageNum || 1));
        purgeObjectsForLayerKeys(keys);
        if (layer) {
            state.layers = state.layers.filter(row => row !== layer);
            state.selectedLayerUids.delete(layer.client_uid);
            if (state.selectedLayerUid === layer.client_uid) state.selectedLayerUid = state.layers[0]?.client_uid || null;
        }
    }

    function handleLayerAction(action, layer) {
        if (action === 'visible') {
            snapshot();
            layer.visible = Number(layer.visible) ? 0 : 1;
            setTakeoffPage(pageNum);
            markDirty();
            renderLayers();
            return;
        }
        if (action === 'lock') {
            snapshot();
            layer.locked = Number(layer.locked) ? 0 : 1;
            markDirty();
            renderLayers();
            return;
        }
        if (action !== 'menu') return;
        const choice = prompt('Layer action: edit, duplicate, delete, move, color, symbol, type', 'edit');
        if (!choice) return;
        const selectedAction = choice.trim().toLowerCase();
        if (selectedAction === 'edit') editLayer(layer);
        if (selectedAction === 'duplicate') duplicateLayer(layer);
        if (selectedAction === 'delete') deleteLayer(layer);
        if (selectedAction === 'move') {
            const group = prompt('Move to group', layerGroup(layer));
            if (!group) return;
            snapshot();
            layer.group_name = group.trim();
            markDirty();
            renderAll();
        }
        if (selectedAction === 'color') {
            const color = prompt('Hex color', layer.color || '#2563eb');
            if (!color) return;
            snapshot();
            layer.color = color;
            markDirty();
            renderAll();
        }
        if (selectedAction === 'symbol') {
            const symbol = prompt('Symbol: circle, square, diamond, triangle, cross, line', layer.symbol || 'circle');
            if (!symbol) return;
            snapshot();
            layer.symbol = symbol;
            markDirty();
            renderAll();
        }
        if (selectedAction === 'type') {
            const type = prompt('Takeoff type: count, linear, area, volume, lump_sum', layerType(layer));
            if (!type) return;
            snapshot();
            layer.takeoff_type = type.trim();
            layer.type = type.trim();
            markDirty();
            renderAll();
        }
    }

    function activateLayerForInsert(uidValue, options = {}) {
        const layer = state.layers.find(row => row.client_uid === uidValue);
        if (!layer) return;
        if (state.draftLine && state.draftLine.layerUid !== layer.client_uid) finishLinear();
        state.selectedLayerUid = layer.client_uid;
        state.selectedLayerUids = new Set([layer.client_uid]);
        const fast = Boolean(options?.fast);
        const skipEmit = Boolean(options?.skipEmit);
        const shouldRenderLayers = !fast || document.getElementById('takeoffLayersTab')?.offsetParent !== null;
        const type = layerType(layer);
        if ((type === 'linear' || type === 'area') && !hasPlanScale()) {
            if (type === 'linear') {
                requirePlanScale('linear');
                setTool('smart');
                if (shouldRenderLayers) renderLayers();
                if (!skipEmit) emitProjectState();
                return false;
            }
            requirePlanScale('area');
            setTool('smart');
            if (shouldRenderLayers) renderLayers();
            if (!skipEmit) emitProjectState();
            return false;
        }
        setTool(type === 'linear' ? 'takeoff_linear' : (type === 'area' ? 'takeoff_area' : 'takeoff_count'));
        if (!fast) showToast(`${layer.name} active`, 'success');
        if (shouldRenderLayers) renderLayers();
        if (!skipEmit) emitProjectState();
        return true;
    }

    function deactivateLayerForInsert() {
        if (state.draftLine) finishLinear();
        if (state.draftArea) finishArea();
        state.selectedLayerUid = null;
        state.selectedLayerUids.clear();
        state.continuousTool = false;
        if (state.tool !== 'measure' && (typeof currentMode === 'undefined' || currentMode !== 'measure')) {
            setTool('smart');
        }
        renderLayers();
        emitProjectState();
        return true;
    }

    function openTakeoffMenu(anchor, items) {
        const menu = document.getElementById('takeoffContextMenu');
        if (!menu) return;
        menu.innerHTML = items.map(item => item.divider
            ? '<div class="takeoff-menu-divider"></div>'
            : `<button type="button" data-menu-action="${escapeHtml(item.action)}"><i class="${escapeHtml(item.icon)}"></i><span>${escapeHtml(item.label)}</span></button>`
        ).join('');
        const rect = anchor.getBoundingClientRect();
        const wrapper = document.getElementById('canvas-wrapper').getBoundingClientRect();
        menu.style.left = Math.min(rect.left - wrapper.left, wrapper.width - 230) + 'px';
        menu.style.top = Math.min(rect.bottom - wrapper.top + 6, wrapper.height - 260) + 'px';
        menu.classList.remove('takeoff-hidden');
        menu.querySelectorAll('[data-menu-action]').forEach(btn => btn.addEventListener('click', () => {
            const action = btn.dataset.menuAction;
            menu.classList.add('takeoff-hidden');
            itemAction(items.find(item => item.action === action));
        }));
        function itemAction(item) {
            if (item && typeof item.run === 'function') item.run();
        }
    }

    function openObjectContextMenu(event, type, ref) {
        const nativeEvent = event?.evt || event;
        nativeEvent?.preventDefault?.();
        nativeEvent?.stopPropagation?.();
        if (event) event.cancelBubble = true;
        window.releaseTakeoffPointerState?.();
        const refId = String(ref?.client_uid || '');
        if (!state.selectedObjectUids.has(refId)) {
            setTool('smart');
            selectElement(type, ref);
        }
        const selectedIds = selectedTakeoffObjectIds();
        const count = selectedIds.length || 1;
        const anchor = {
            getBoundingClientRect: () => ({
                left: Number(nativeEvent?.clientX || 0),
                bottom: Number(nativeEvent?.clientY || 0)
            })
        };
        openTakeoffMenu(anchor, [{
            label: count > 1 ? `Delete ${count} selected elements` : 'Delete',
            icon: 'fas fa-trash',
            action: 'delete-object-selection',
            run: () => {
                if (count > 1 && !confirm(`Delete all ${count} selected elements?`)) return;
                deleteTakeoffSelection(selectedIds);
            }
        }]);
    }

    function openActionsMenu(anchor) {
        openTakeoffMenu(anchor, [
            { label: 'Save Takeoff', icon: 'fas fa-save', action: 'save', run: saveTakeoff },
            { label: 'Undo', icon: 'fas fa-undo', action: 'undo', run: () => document.getElementById('takeoffWorkspace')._takeoffUndoHandler?.() },
            { label: 'Redo', icon: 'fas fa-redo', action: 'redo', run: () => document.getElementById('takeoffWorkspace')._takeoffRedoHandler?.() },
            { divider: true },
            { label: 'Delete Selected', icon: 'fas fa-trash', action: 'deleteSelected', run: deleteSelected }
        ]);
    }

    function openGroupMenu(anchor, group) {
        openTakeoffMenu(anchor, [
            { label: 'Create New Takeoff Layer', icon: 'fas fa-plus', action: 'create', run: () => openCreateLayerModal(null, group) },
            { label: 'Rename', icon: 'fas fa-pen', action: 'rename', run: () => renameGroup(group) },
            { label: 'Copy', icon: 'far fa-copy', action: 'copy', run: () => copyGroup(group) },
            { label: 'Copy to other estimate', icon: 'far fa-copy', action: 'copyEstimate', run: () => showToast('Estimate selector is not wired yet', 'warning') },
            { label: 'Move to other estimate', icon: 'fas fa-right-left', action: 'moveEstimate', run: () => showToast('Estimate selector is not wired yet', 'warning') },
            { divider: true },
            { label: 'Delete', icon: 'fas fa-trash', action: 'delete', run: () => deleteGroup(group) }
        ]);
    }

    function openLayerMenu(anchor, layer) {
        openTakeoffMenu(anchor, [
            { label: 'Rename', icon: 'fas fa-pen', action: 'rename', run: () => renameLayer(layer) },
            { label: 'Copy', icon: 'far fa-copy', action: 'copy', run: () => duplicateLayer(layer) },
            { label: 'Copy to other estimate', icon: 'far fa-copy', action: 'copyEstimate', run: () => showToast('Estimate selector is not wired yet', 'warning') },
            { label: 'Move to other estimate', icon: 'fas fa-right-left', action: 'moveEstimate', run: () => showToast('Estimate selector is not wired yet', 'warning') },
            { label: 'Edit Layer', icon: 'fas fa-sliders', action: 'edit', run: () => openCreateLayerModal(layer, layerGroup(layer)) },
            { divider: true },
            { label: 'Delete', icon: 'fas fa-trash', action: 'delete', run: () => deleteLayer(layer) }
        ]);
    }

    function renameLayer(layer) {
        if (!layer) return;
        const renameFn = window.parent?.openRenameModal || window.openRenameModal;
        if (typeof renameFn === 'function') {
            renameFn({
                title: 'Rename Takeoff Layer',
                label: 'Layer Name',
                currentName: layer.name || '',
                onSave: (newName) => {
                    if (!newName || !newName.trim()) return;
                    snapshot();
                    layer.name = newName.trim();
                    markDirty();
                    renderAll();
                }
            });
            return;
        }
        const name = prompt('Layer name', layer.name || '');
        if (!name) return;
        snapshot();
        layer.name = name.trim() || layer.name;
        markDirty();
        renderAll();
    }

    function renameGroup(group) {
        if (!group) return;
        const renameFn = window.parent?.openRenameModal || window.openRenameModal;
        if (typeof renameFn === 'function') {
            renameFn({
                title: 'Rename Group',
                label: 'Group Name',
                currentName: group,
                onSave: (newName) => {
                    if (!newName || !newName.trim()) return;
                    snapshot();
                    state.layers.filter(layer => layerGroup(layer) === group).forEach(layer => { layer.group_name = newName.trim(); });
                    markDirty();
                    renderAll();
                }
            });
            return;
        }
        const next = prompt('Rename group', group);
        if (!next) return;
        snapshot();
        state.layers.filter(layer => layerGroup(layer) === group).forEach(layer => { layer.group_name = next.trim() || group; });
        markDirty();
        renderAll();
    }

    function copyGroup(group) {
        snapshot();
        state.layers.filter(layer => layerGroup(layer) === group).forEach(layer => {
            const copyUid = uid();
            const copy = { ...layer, client_uid: copyUid, name: `${layer.name} Copy`, id: null, metadata_json: { ...(layer.metadata_json || {}), project_layer_id: copyUid } };
            state.layers.push(copy);
        });
        markDirty();
        renderAll();
    }

    async function deleteGroup(group) {
        const layers = state.layers.filter(layer => layerGroup(layer) === group);
        if (!layers.length) return;
        const confirmFn = window.parent?.showConfirmDialog || window.showConfirmDialog;
        if (typeof confirmFn === 'function') {
            const ok = await confirmFn({
                title: 'Delete Takeoff Group',
                message: `Delete takeoff group "${group}" and all its ${layers.length} layer(s)?`,
                confirmText: 'Delete Group',
                primaryDanger: true
            });
            if (!ok) return;
        } else if (!confirm(`Delete this takeoff group and all ${layers.length} layers?`)) {
            return;
        }
        snapshot();
        layers.forEach(deleteLayerWithoutConfirm);
        markDirty();
        renderAll();
    }

    function findCatalogItemByName(name) {
        const normalized = String(name).toLowerCase();
        return state.catalog.items.find(item => String(item.name || '').toLowerCase() === normalized)
            || state.catalog.items.find(item => String(item.name || '').toLowerCase().includes(normalized.split('"')[0].trim()))
            || null;
    }

    function seedTemplateLayers() {
        const seeds = [
            ['Lighting', 'Lighting Fixture "A"', 0, 'count', 'ea', '#ef6b6b', 'circle'],
            ['Lighting', 'Lighting Fixture "B"', 15, 'count', 'ea', '#a855c9', 'circle'],
            ['Lighting', 'Lighting Fixture "C"', 0, 'count', 'ea', '#6478c8', 'circle'],
            ['Lighting', 'Lighting Fixture "D"', 0, 'count', 'ea', '#49cbd3', 'circle'],
            ['Lighting', 'Lighting Fixture "Y"', 8, 'count', 'ea', '#2f3437', 'circle'],
            ['Lighting', 'Lighting Fixture "E"', 26, 'count', 'ea', '#45b39d', 'circle'],
            ['Lighting', 'Lighting Package Lump Sum', 0, 'lump_sum', 'lot', '#2f3437', 'circle'],
            ['Controls', 'Ceiling Mounted Occupancy Sensor "OS"', 0, 'count', 'ea', '#ef6b6b', 'pentagon'],
            ['Controls', 'Wall Occupancy Sensor Switch Dual Tech', 0, 'count', 'ea', '#f4e85c', 'circle'],
            ['Controls', 'Dimmer Switch', 0, 'count', 'ea', '#a855c9', 'square'],
            ['Controls', 'Dimmer Switch 3-way', 0, 'count', 'ea', '#3f7f45', 'square'],
            ['Controls', 'Power Pack', 0, 'count', 'ea', '#ef6b6b', 'circle'],
        ];
        seeds.forEach(([group, name, quantity, type, uom, color, symbol]) => {
            const item = findCatalogItemByName(name);
            const layer = createLayer({
                name,
                group_name: group,
                takeoff_type: type,
                type,
                unit_of_measure: item?.unit_of_measure || uom,
                catalog_item_id: item?.id || null,
                color: item?.color || color,
                symbol: item?.symbol || symbol,
                unit_cost: item?.unit_cost || 0,
                unit_labor_time: item?.labor_hours || 0,
                cost_code: item?.cost_code || '',
            });
            layer.seed_quantity = quantity;
        });
        state.selectedLayerUid = state.layers[0]?.client_uid || null;
    }

    function isLegacyTemplateSeed() {
        if (state.markers.length || state.segments.length) return false;
        const names = new Set(state.layers.map(layer => layer.name));
        return names.has('Lighting Fixture "B"')
            && names.has('Power Pack')
            && (names.has('Panelboard') || names.has('EMT Conduit 1/2 inch') || state.layers.length !== 12);
    }

    function renderProperties() {
        const el = document.getElementById('takeoffProps');
        if (!el) return;
        if (state.projectControlled && el.offsetParent === null) return;
        if (!state.selectedElement) {
            el.innerHTML = '<div class="takeoff-panel-header"><div class="takeoff-title">Properties</div></div><div class="takeoff-panel-section"><div class="takeoff-list-meta">Select a marker or line.</div></div>';
            return;
        }
        const { type, ref } = state.selectedElement;
        const locked = isElementLocked(ref);
        const isArea = type === 'segment' && String(ref.takeoff_type || ref.type || '').toLowerCase() === 'area';
        const measuredLabel = type === 'marker' ? 'Quantity' : (isArea ? 'Area' : 'Length');
        const measuredValue = type === 'marker' ? num(ref.quantity) : (isArea ? num(ref.total_area) : num(ref.total_length));
        el.innerHTML = `
            <div class="takeoff-panel-header"><div class="takeoff-title">Properties</div><span class="takeoff-list-meta">${type}</span></div>
            <div class="takeoff-panel-section">
                <button class="takeoff-lock-btn ${locked ? 'is-locked' : ''}" type="button" id="takeoffPropLock">${locked ? 'Unlock element' : 'Lock element'}</button>
                <div class="takeoff-list-meta">${locked ? 'Locked elements cannot be moved, resized, or edited.' : 'Editable element'}</div>
                <div class="takeoff-field"><label>Label</label><input id="takeoffPropLabel" value="${escapeHtml(ref.label || '')}" ${locked ? 'disabled' : ''}></div>
                <div class="takeoff-grid-2">
                    <div class="takeoff-field"><label>Multiplier</label><input id="takeoffPropMultiplier" type="number" step="0.01" value="${escapeHtml(ref.multiplier || 1)}" ${locked ? 'disabled' : ''}></div>
                    <div class="takeoff-field"><label>${measuredLabel}</label><input disabled value="${measuredValue.toFixed(2)} ${escapeHtml(ref.unit || (type === 'marker' ? 'ea' : (isArea ? 'sq ft' : 'ft')))}"></div>
                </div>
                ${type === 'marker' ? `<div class="takeoff-field"><label>Symbol size</label><input id="takeoffPropSize" type="number" min="4" max="96" step="0.5" value="${symbolRadius(ref.symbol_size || ref.size)}" ${locked ? 'disabled' : ''}></div>` : `
                    <div class="takeoff-grid-2">
                        <div class="takeoff-field"><label>Stroke width</label><input id="takeoffPropStroke" type="number" min="1" max="3" step="0.5" value="${num(ref.stroke_width || (isArea ? 2 : 2.5))}" ${locked ? 'disabled' : ''}></div>
                        <div class="takeoff-field"><label>Points</label><input disabled value="${(ref.points_json || []).length}"></div>
                    </div>`}
                <div class="takeoff-field"><label>Notes</label><textarea id="takeoffPropNotes" rows="3" ${locked ? 'disabled' : ''}>${escapeHtml(ref.notes || '')}</textarea></div>
            </div>`;
        const update = () => {
            if (isElementLocked(ref)) return;
            snapshot();
            ref.label = document.getElementById('takeoffPropLabel').value;
            ref.multiplier = num(document.getElementById('takeoffPropMultiplier').value || 1);
            ref.notes = document.getElementById('takeoffPropNotes').value;
            if (type === 'marker') {
                const nextSize = Math.max(4, Math.min(96, num(document.getElementById('takeoffPropSize').value || 9)));
                const sizeChanged = nextSize !== symbolRadius(ref.symbol_size || ref.size);
                ref.symbol_size = nextSize;
                ref.size = nextSize;
                ref.metadata_json = { ...(ref.metadata_json || {}), symbol_size: nextSize };
                ref.quantity = calculateCountQuantity(ref);
                if (sizeChanged) {
                    destroyMarkerNodes(ref);
                    createMarkerNode(ref);
                    selectElement('marker', ref);
                } else {
                    ref.node?.findOne('Text')?.text(ref.label || '');
                }
            } else {
                ref.stroke_width = Math.max(1, Math.min(3, num(document.getElementById('takeoffPropStroke').value || 2.5)));
                ref.node?.strokeWidth(ref.stroke_width);
                calculateLinearLength(ref);
                refreshSegment(ref);
            }
            markDirty();
            renderProperties();
        };
        ['takeoffPropLabel', 'takeoffPropMultiplier', 'takeoffPropNotes', type === 'marker' ? 'takeoffPropSize' : 'takeoffPropStroke']
            .forEach(id => document.getElementById(id).addEventListener('change', update));
        document.getElementById('takeoffPropLock').addEventListener('click', () => {
            snapshot();
            ref.locked = isElementLocked(ref) ? 0 : 1;
            ref.updatedAt = timestamp();
            ref.updated_at = ref.updatedAt;
            if (type === 'marker') applyMarkerLockVisual(ref);
            else applySegmentLockVisual(ref);
            markDirty();
            renderProperties();
        });
    }

    function renderSummary() {
        const rows = calculateTakeoffSummary();
        const el = document.getElementById('takeoffSummary');
        if (!el) return;
        const body = rows.length
            ? rows.map(r => `<tr><td>${escapeHtml(r.item)}</td><td>${escapeHtml(r.assembly)}</td><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.unit)}</td><td>${r.quantity.toFixed(2)}</td><td>${money(r.unitCost)}</td><td>${r.laborHours.toFixed(2)}</td><td>${money(r.material)}</td><td>${money(r.labor)}</td><td>${money(r.total)}</td><td>${num(r.waste).toFixed(2)}</td><td>${money(r.markup)}</td></tr>`).join('')
            : '<tr><td colspan="12">No estimate items linked yet. Create a takeoff layer from catalog or add an estimate item.</td></tr>';
        el.innerHTML = `<div class="takeoff-summary-head"><div class="takeoff-title">Summary</div><div class="takeoff-list-meta">${rows.length} rows${state.dirty ? ' - unsaved' : ''}</div></div>
            <div class="takeoff-summary-table-wrap"><table>
            <thead><tr><th>Item</th><th>Assembly</th><th>Type</th><th>Unit</th><th>Qty</th><th>Unit Cost</th><th>Labor Hours</th><th>Material</th><th>Labor</th><th>Total</th><th>Waste</th><th>Markup</th></tr></thead>
            <tbody>${body}</tbody>
            </table></div>`;
    }

    function renderAll() {
        renderCatalog();
        renderAssemblies();
        renderLayers();
        renderProperties();
        renderSummary();
        emitProjectState();
    }

    function normalizePointsJson(rawPoints) {
        let parsed = rawPoints;
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch (_) { parsed = []; }
        }
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(p => p && typeof p === 'object')
            .map(p => ({ x: num(p.x), y: num(p.y) }));
    }

    function buildSaveTakeoffPayload() {
        state.layers.forEach(persistLayerCostSnapshot);
        const sentPages = dirtyTakeoffPages.size ? [...dirtyTakeoffPages] : [Number(pageNum || 1)];
        const sentGenerations = new Map(sentPages.map(page => [page, dirtyTakeoffPageGenerations.get(page) || 0]));
        const sentObjectIds = Array.from(new Set([...dirtyTakeoffObjects.keys(), ...deletedTakeoffObjects.keys()]));
        const sentObjectGenerations = new Map(sentObjectIds.map(id => [id, dirtyTakeoffObjectGenerations.get(id) || 0]));
        const objectBaseVersions = Object.fromEntries(sentObjectIds.map(id => [id, takeoffObjectBaseVersions.get(id) ?? null]));
        const fallbackPages = dirtyTakeoffPages.size ? [...dirtyTakeoffPages] : (sentObjectIds.length ? [] : sentPages);
        const sentDeletedLayerIds = [...deletedTakeoffLayers];
        const sentLayerNameUpdates = [...pendingLayerNameUpdates.values()].map(update => ({ ...update }));
        return {
            sentPages,
            sentGenerations,
            sentObjectIds,
            sentObjectGenerations,
            sentDeletedLayerIds,
            sentLayerNameUpdates,
            body: {
                drawing_id: fileId,
                project_id: typeof projectId !== 'undefined' ? projectId : 0,
                estimate_key: currentEstimateKey(),
                replace_layers: 1,
                layers: state.layers,
                markers: state.markers.map(marker => ({
                    ...stripNodes(marker),
                    metadata_json: { ...(marker.metadata_json || {}), element_locked: isObjectIndividuallyLocked(marker) ? 1 : 0,
                        symbol_size: symbolRadius(marker.symbol_size || marker.size) }
                })),
                segments: state.segments.map(segment => ({
                    ...stripNodes(segment),
                    metadata_json: { ...(segment.metadata_json || {}), element_locked: isObjectIndividuallyLocked(segment) ? 1 : 0,
                        takeoff_subtype: normalizeLinearSubtype(segment.takeoff_subtype || segment.takeoff_type || segment.type),
                        drop_length: Math.max(0, num(segment.drop_length ?? segment.dropLength)),
                        spacing: Math.max(0, num(segment.spacing ?? segment.metadata_json?.spacing)) }
                })),
                summary: calculateTakeoffSummary(),
                dirty_page_numbers: fallbackPages,
                dirty_object_ids: [...dirtyTakeoffObjects.keys()],
                deleted_object_ids: [...deletedTakeoffObjects.keys()],
                deleted_layer_ids: sentDeletedLayerIds,
                layer_name_updates: sentLayerNameUpdates.map(({ integration_key, name }) => ({ integration_key, name })),
                object_base_versions: objectBaseVersions,
            }
        };
    }

    function compactLayerForKeepalive(layer) {
        if (!layer || typeof layer !== 'object') return layer;
        const meta = layer.metadata_json && typeof layer.metadata_json === 'object'
            ? { ...layer.metadata_json } : {};
        delete meta.catalog_item;
        delete meta.catalogSnapshot;
        return {
            ...layer,
            metadata_json: meta,
        };
    }

    function flushTakeoffKeepalive() {
        if (!state.dirty || typeof fetch !== 'function' || typeof fileId === 'undefined' || !fileId) return;
        const { sentPages, sentObjectIds, body } = buildSaveTakeoffPayload();
        let serialized = JSON.stringify({ action: 'save_state', ...body });
        if (serialized.length > 48000) {
            const dirtyObjectSet = new Set(sentObjectIds.map(String));
            const dirtyPageSet = new Set(sentPages.map(Number));
            const dirtySegments = (body.segments || []).filter(seg =>
                dirtyObjectSet.has(String(seg.client_uid || '')) || (!dirtyObjectSet.size && dirtyPageSet.has(Number(seg.page_number || 1)))
            );
            const dirtyMarkers = (body.markers || []).filter(m =>
                dirtyObjectSet.has(String(m.client_uid || '')) || (!dirtyObjectSet.size && dirtyPageSet.has(Number(m.page_number || 1)))
            );
            const referencedLayers = new Set([
                ...dirtySegments.map(s => String(s.layer_client_uid || '')),
                ...dirtyMarkers.map(m => String(m.layer_client_uid || ''))
            ]);
            const compactLayers = (body.layers || [])
                .filter(l => !dirtyObjectSet.size || referencedLayers.has(String(l.client_uid || l.id || '')))
                .map(compactLayerForKeepalive);
            const compactSummary = (body.summary || []).filter(row =>
                !referencedLayers.size || referencedLayers.has(String(row.layerUid || ''))
            );
            const compactBody = {
                drawing_id: body.drawing_id,
                project_id: body.project_id,
                estimate_key: body.estimate_key,
                partial_keepalive: 1,
                layers: compactLayers,
                markers: dirtyMarkers,
                segments: dirtySegments,
                summary: compactSummary,
                dirty_page_numbers: dirtyObjectSet.size ? [] : (body.dirty_page_numbers || []),
                dirty_object_ids: body.dirty_object_ids || [],
                deleted_object_ids: body.deleted_object_ids || [],
                deleted_layer_ids: body.deleted_layer_ids || [],
                layer_name_updates: body.layer_name_updates || [],
                object_base_versions: body.object_base_versions || {},
            };
            serialized = JSON.stringify({ action: 'save_state', ...compactBody });
        }
        try {
            fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: serialized,
                keepalive: true
            });
        } catch (_) {}
    }

    function saveTakeoff(silent = false, rejectOnError = false) {
        const { sentPages, sentGenerations, sentObjectIds, sentObjectGenerations, sentDeletedLayerIds, sentLayerNameUpdates, body } = buildSaveTakeoffPayload();
        return request('save_state', body).then(res => {
            if (res.status !== 'success') throw new Error(res.msg || 'Save failed');
            takeoffServerRevision = Math.max(takeoffServerRevision, Number(res.data?.revision || 0));
            sentPages.forEach(page => {
                if ((dirtyTakeoffPageGenerations.get(page) || 0) !== sentGenerations.get(page)) return;
                dirtyTakeoffPages.delete(page);
                dirtyTakeoffPageGenerations.delete(page);
            });
            sentObjectIds.forEach(id => {
                if ((dirtyTakeoffObjectGenerations.get(id) || 0) !== sentObjectGenerations.get(id)) return;
                dirtyTakeoffObjects.delete(id);
                deletedTakeoffObjects.delete(id);
                dirtyTakeoffObjectGenerations.delete(id);
                const current = findTakeoffObjectByUid(id)?.ref;
                if (current) {
                    current._serverUpdatedAt = current.updated_at || current.updatedAt || timestamp();
                    takeoffObjectBaseVersions.set(id, current._serverUpdatedAt);
                } else takeoffObjectBaseVersions.delete(id);
            });
            (sentDeletedLayerIds || []).forEach(id => deletedTakeoffLayers.delete(id));
            sentLayerNameUpdates.forEach(sent => {
                const pending = pendingLayerNameUpdates.get(sent.integration_key);
                if (pending?.generation === sent.generation) pendingLayerNameUpdates.delete(sent.integration_key);
            });
            state.dirty = dirtyTakeoffPages.size > 0 || dirtyTakeoffObjects.size > 0 || deletedTakeoffObjects.size > 0
                || deletedTakeoffLayers.size > 0 || pendingLayerNameUpdates.size > 0;
            if (!silent) {
                hasPendingManualCanvasCheckpoint = false;
                showToast('Takeoff saved', 'success');
            }
            renderSummary();
        }).catch(err => {
            if (!silent) showToast(err.message, 'error');
            else console.warn('Takeoff autosave failed', err);
            if (rejectOnError) throw err;
        });
    }

    function loadTakeoff(options = {}) {
        return Promise.all([
            request('bootstrap', {}, 'GET'),
            request('state', { drawing_id: fileId, estimate_key: currentEstimateKey(),
                inherit_legacy: new URLSearchParams(window.location.search).get('inherit_legacy') === '1' ? 1 : 0 }, 'GET'),
        ]).then(([boot, loaded]) => {
            if (boot.status === 'success') {
                state.catalog = boot.catalog || state.catalog;
                state.assemblies = boot.assemblies || state.assemblies;
            }
            if (loaded.status === 'success') {
                const data = loaded.data || {};
                takeoffServerRevision = Math.max(takeoffServerRevision, Number(data.revision || 0));
                clearNodes();
                state.selectedObjectUids.clear();
                state.selectedElement = null;
                window.sheetScales = window.sheetScales || {};
                (data.scales || []).forEach(scale => {
                    const page = Number(scale.page_number ?? scale.page ?? 1);
                    const pixelsPerUnit = Number(scale.pixels_per_unit ?? scale.pixelsPerUnit ?? 0);
                    if (page > 0 && pixelsPerUnit > 0) window.sheetScales[page] = pixelsPerUnit;
                });
                const dbLayerIdMap = new Map();
                const dedupedLayers = [];
                const seenLayerIdx = new Map();
                (data.layers || []).forEach(l => {
                    const metadata = l.metadata_json || {};
                    const stableUid = String(metadata.project_layer_id || l.client_uid || l.integration_key || l.id);
                    [l.id, l.client_uid, l.integration_key, metadata.project_layer_id].forEach(k => {
                        if (k !== undefined && k !== null && String(k) !== '') dbLayerIdMap.set(String(k), stableUid);
                    });
                    const normalizedLayer = restoreLayerCostSnapshot({
                        ...l,
                        client_uid: stableUid,
                        metadata_json: { ...metadata, project_layer_id: stableUid }
                    });
                    if (seenLayerIdx.has(stableUid)) {
                        const idx = seenLayerIdx.get(stableUid);
                        const prev = dedupedLayers[idx];
                        const nextQty = Math.max(num(prev?.quantity), num(normalizedLayer.quantity));
                        dedupedLayers[idx] = { ...prev, ...normalizedLayer, quantity: nextQty };
                    } else {
                        seenLayerIdx.set(stableUid, dedupedLayers.length);
                        dedupedLayers.push(normalizedLayer);
                    }
                });
                state.layers = dedupedLayers;
                const seenMarkerIds = new Set();
                state.markers = (data.markers || []).map(m => {
                    const rawLayerKey = String(m.layer_client_uid || dbLayerIdMap.get(String(m.layer_id)) || m.layer_id || '');
                    const resolvedLayerUid = dbLayerIdMap.get(rawLayerKey) || rawLayerKey;
                    return { ...m, client_uid: m.client_uid || String(m.id), layer_client_uid: resolvedLayerUid, metadata_json: m.metadata_json || {}, symbol_size: m.symbol_size ?? m.metadata_json?.symbol_size ?? m.size, size: m.symbol_size ?? m.metadata_json?.symbol_size ?? m.size, locked: Number(m.locked ?? m.metadata_json?.element_locked ?? 0), _serverUpdatedAt: m.updated_at || m.updatedAt || null };
                }).filter(m => {
                    const uidKey = String(m.client_uid || '');
                    if (!uidKey || seenMarkerIds.has(uidKey)) return false;
                    seenMarkerIds.add(uidKey);
                    return true;
                });
                const seenSegmentIds = new Set();
                state.segments = (data.segments || []).map(s => {
                    const rawLayerKey = String(s.layer_client_uid || dbLayerIdMap.get(String(s.layer_id)) || s.layer_id || '');
                    const resolvedLayerUid = dbLayerIdMap.get(rawLayerKey) || rawLayerKey;
                    return { ...s, client_uid: s.client_uid || String(s.id), layer_client_uid: resolvedLayerUid, page_number: Math.max(1, Number(s.page_number || 1)), points_json: normalizePointsJson(s.points_json), metadata_json: s.metadata_json || {}, takeoff_subtype: s.takeoff_subtype || s.metadata_json?.takeoff_subtype || 'linear', drop_length: Math.max(0, num(s.drop_length ?? s.metadata_json?.drop_length)), spacing: Math.max(0, num(s.spacing ?? s.metadata_json?.spacing)), locked: Number(s.locked ?? s.metadata_json?.element_locked ?? 0), _serverUpdatedAt: s.updated_at || s.updatedAt || null };
                }).filter(s => {
                    const uidKey = String(s.client_uid || '');
                    if (!uidKey || seenSegmentIds.has(uidKey)) return false;
                    seenSegmentIds.add(uidKey);
                    return true;
                });
                const repairResult = window.TakeoffObjectRepairService?.repair(state.markers, state.segments);
                if (repairResult?.changed) {
                    // The server merges dirty pages so merely omitting a duplicate
                    // from this snapshot would leave it in the database. Register
                    // every discarded object as an explicit tombstone first.
                    const removedObjects = [
                        ...repairResult.removedMarkers.map(ref => ({ type: 'marker', ref })),
                        ...repairResult.removedSegments.map(ref => ({ type: 'segment', ref }))
                    ];
                    trackTakeoffObjects(removedObjects, true);
                    state.markers = repairResult.markers;
                    state.segments = repairResult.segments;
                    repairResult.affectedPages.forEach(page => {
                        const pageNumber = Math.max(1, Number(page || 1));
                        dirtyTakeoffPages.add(pageNumber);
                        dirtyTakeoffPageGenerations.set(pageNumber, ++takeoffDirtyGeneration);
                    });
                    state.dirty = true;
                    scheduleTakeoffAutosave(200);
                }
            }
            if (!state.selectedItemId && state.catalog.items[0]) state.selectedItemId = state.catalog.items[0].id;
            // An empty server snapshot is intentional. Never treat zero layers as
            // a first run or deleted starter groups will return after refresh.
            renderNodes();
            renderAll();
            try {
                window.parent?.postMessage({
                    type: 'takeoff-editor-state-loaded',
                    payload: {
                        drawingId: typeof fileId !== 'undefined' ? fileId : null,
                        estimateKey: currentEstimateKey(),
                        remoteSync: options.remoteSync === true
                    }
                }, '*');
            } catch (_) {}
        }).catch(err => {
            console.error(err);
            showToast(err?.message || 'Takeoff could not load. Please retry or contact an administrator.', 'error');
            renderAll();
        });
    }

    function hasPendingTakeoffMutation() {
        return state.dirty
            || dirtyTakeoffPages.size > 0
            || dirtyTakeoffObjects.size > 0
            || deletedTakeoffObjects.size > 0
            || deletedTakeoffLayers.size > 0
            || pendingLayerNameUpdates.size > 0
            || !!state.draftLine
            || !!state.draftArea
            || !!state.selectionDrag;
    }

    async function pollTakeoffRemoteRevision() {
        if (takeoffRemoteSyncInFlight || document.hidden || hasPendingTakeoffMutation()) return;
        if (typeof fileId === 'undefined' || !fileId || !currentEstimateKey()) return;
        takeoffRemoteSyncInFlight = true;
        try {
            const response = await request('revision', {
                drawing_id: fileId,
                project_id: typeof projectId !== 'undefined' ? projectId : 0,
                estimate_key: currentEstimateKey()
            }, 'GET');
            const remoteRevision = Number(response?.revision || 0);
            if (response?.status === 'success' && remoteRevision > takeoffServerRevision && !hasPendingTakeoffMutation()) {
                await loadTakeoff({ remoteSync: true });
            }
        } catch (error) {
            console.warn('Takeoff collaboration sync failed', error);
        } finally {
            takeoffRemoteSyncInFlight = false;
        }
    }

    function startTakeoffRemoteSync() {
        if (takeoffRemotePollTimer) clearInterval(takeoffRemotePollTimer);
        takeoffRemotePollTimer = setInterval(pollTakeoffRemoteRevision, 2500);
    }

    function patchEditor() {
        const originalChangePage = window.changePage;
        if (typeof originalChangePage === 'function') {
            window.changePage = function () {
                const result = originalChangePage.apply(this, arguments);
                setTimeout(() => setTakeoffPage(pageNum), 80);
                return result;
            };
        }
        window.addEventListener('keydown', e => {
            if (e.key === 'Shift' && state.draftLine) {
                linearShiftPressed = true;
                renderLinearPreview();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                state.continuousTool = false;
                clearDrafts();
                setTool('smart');
                clearTakeoffSelection();
                return;
            }
            if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            if ((e.key === 'Delete' || e.key === 'Backspace') && !state.draftLine && !state.draftArea) {
                if (state.selectedObjectUids.size > 0 || state.selectedElement) {
                    e.preventDefault();
                    deleteTakeoffSelection();
                    return;
                }
            }
            if (state.draftLine && e.key === 'Backspace') {
                e.preventDefault();
                undoLinearPoint();
                return;
            }
            if (state.draftLine && e.key === 'Enter') {
                e.preventDefault();
                finishLinear();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && state.selectedElement) {
                window.__takeoffClipboard = { type: state.selectedElement.type, data: stripNodes(state.selectedElement.ref) };
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && window.__takeoffClipboard) {
                snapshot();
                const { type, data } = window.__takeoffClipboard;
                const copy = { ...data, client_uid: uid(), page_number: pageNum };
                if (type === 'marker') {
                    assignNewPlacementIdentity(copy);
                    copy.x = num(copy.x) + 18;
                    copy.y = num(copy.y) + 18;
                    state.markers.push(copy);
                    createMarkerNode(copy);
                    trackTakeoffObjects([{ type: 'marker', ref: copy }], false);
                    selectElement('marker', copy);
                } else {
                    copy.points_json = (copy.points_json || []).map(p => ({ x: p.x + 18, y: p.y + 18 }));
                    state.segments.push(copy);
                    createSegmentNode(copy);
                    trackTakeoffObjects([{ type: 'segment', ref: copy }], false);
                    selectElement('segment', copy);
                }
                dirtyTakeoffPages.add(Number(copy.page_number || pageNum || 1));
                markDirty({ objectsTracked: true });
            }
        });
        window.addEventListener('pagehide', () => {
            flushPendingProjectStateEmit();
            flushTakeoffKeepalive();
        });
        window.addEventListener('beforeunload', event => {
            flushPendingProjectStateEmit();
            flushTakeoffKeepalive();
            if (state.projectControlled || !isEditorTakeoffDirty()) return;
            event.preventDefault();
            event.returnValue = '';
        });
        window.addEventListener('keyup', e => {
            if (e.key !== 'Shift') return;
            linearShiftPressed = false;
            renderLinearPreview();
        });
    }

    window.setTakeoffInternalView = function(view) {
        if (view === 'summary') {
            document.body.classList.add('view-summary');
            document.getElementById('btn-view-summary').classList.replace('btn-outline-light', 'btn-primary');
            document.getElementById('btn-view-summary').classList.remove('border-0');
            document.getElementById('btn-view-drawing').classList.replace('btn-primary', 'btn-outline-light');
            document.getElementById('btn-view-drawing').classList.add('border-0');
            // Ensure summary is rendered
            renderSummary();
        } else {
            document.body.classList.remove('view-summary');
            document.getElementById('btn-view-drawing').classList.replace('btn-outline-light', 'btn-primary');
            document.getElementById('btn-view-drawing').classList.remove('border-0');
            document.getElementById('btn-view-summary').classList.replace('btn-primary', 'btn-outline-light');
            document.getElementById('btn-view-summary').classList.add('border-0');
        }
    };

    window.takeoffServices = {
        calculateCountQuantity,
        calculateLinearLength,
        calculateAssemblyQuantity,
        calculateAssemblyCost,
        calculateItemCost,
        calculateLaborHours,
        calculateTakeoffSummary,
        snapPointTo45,
    };

    window.syncTakeoffInteractionScale = syncTakeoffHandleScale;

    window.projectTakeoffActivateLayer = function (payload, options = {}) {
        if (!payload?.id) return null;
        state.projectControlled = true;
        const fast = options?.fast !== false;
        const externalId = String(payload.id);
        let layer = state.layers.find(row => row.client_uid === externalId || row.metadata_json?.project_layer_id === externalId);
        const normalizedType = String(payload.takeoff_type || payload.type || 'count').toLowerCase();
        const normalizedLayerType = normalizeEditorLayerType(normalizedType);
        const type = normalizedLayerType.type;
        const seedQuantity = num(payload.baseQuantity ?? payload.base_quantity ?? payload.seedQuantity
            ?? payload.seed_quantity ?? layer?.seed_quantity ?? layer?.metadata_json?.base_quantity ?? 0);
        const layerMultiplierVal = Math.max(0, num(payload.multiplier ?? layer?.multiplier ?? layer?.metadata_json?.multiplier ?? 1));
        const data = {
            client_uid: externalId,
            page_number: pageNum || 1,
            name: payload.name || 'Takeoff Layer',
            type,
            takeoff_type: type,
            takeoff_subtype: normalizedLayerType.subtype,
            original_takeoff_type: normalizedType,
            drop_length: Math.max(0, num(payload.drop_length ?? payload.dropLength)),
            spacing: Math.max(0, num(payload.spacing ?? payload.metadata_json?.spacing)),
            group_name: payload.group_name || payload.category || 'Project Takeoff',
            unit_of_measure: payload.unit_of_measure || payload.uom || (type === 'linear' ? 'ft' : (type === 'area' ? 'sq ft' : 'ea')),
            catalog_item_id: payload.catalog_item_id || payload.catalogItemId || null,
            assembly_id: payload.assembly_id || null,
            color: payload.color || '#2563eb',
            symbol: normalizeSymbol(payload.symbol || 'circle'),
            symbol_size: payload.symbol_size || payload.size || 'Medium',
            unit_cost: num(payload.unit_cost || payload.unitCost || 0),
            unit_labor_time: num(payload.labor_hours || payload.laborHours || payload.unit_labor_time || 0),
            cost_code: payload.cost_code || payload.catalogNumber || '',
            multiplier: layerMultiplierVal,
            visible: payload.visible === false ? 0 : 1,
            locked: payload.locked ? 1 : 0,
            seed_quantity: seedQuantity,
            metadata_json: window.CatalogMetadata.mergeMetadata(layer?.metadata_json,
                payload.catalogMetadata || payload.metadata_json?.catalog_item, { project_layer_id: externalId,
                base_quantity: seedQuantity,
                multiplier: layerMultiplierVal,
                estimate_id: payload.estimate_id || payload.estimateId || null,
                estimating_item_id: payload.estimating_item_id || payload.estimatingItemId || null,
                estimating_group_id: payload.estimating_group_id || payload.estimatingGroupId || null,
                estimating_override_block: Boolean(payload.estimating_override_block ?? payload.metadata_json?.estimating_override_block),
                estimating_override_qty: Number(payload.estimating_override_qty ?? payload.metadata_json?.estimating_override_qty ?? 0),
                estimating_override_uom: String(payload.estimating_override_uom ?? payload.metadata_json?.estimating_override_uom ?? payload.unit_of_measure ?? payload.uom ?? 'ea') }),
        };
        if (layer) Object.assign(layer, data);
        else {
            layer = data;
            state.layers.push(layer);
        }
        untrackDeletedLayer(layer);
        untrackDeletedLayer(externalId);
        if (fast) {
            activateLayerForInsert(layer.client_uid, { fast: true, skipEmit: true });
            return projectLayerPayload(layer);
        }
        activateLayerForInsert(layer.client_uid);
        renderAll();
        return projectLayerPayload(layer);
    };

    window.projectTakeoffSyncLayers = function (layers) {
        if (!Array.isArray(layers)) return projectSnapshot();
        state.projectControlled = true;
        layers.forEach(payload => {
            if (!payload?.id) return;
            const externalId = String(payload.id);
            let layer = state.layers.find(row => row.client_uid === externalId
                || row.metadata_json?.project_layer_id === externalId
                || String(row.id || '') === externalId
                || String(row.integration_key || '') === externalId);
            const normalizedType = String(payload.takeoff_type || payload.type || 'count').toLowerCase();
            const normalizedLayerType = normalizeEditorLayerType(normalizedType);
            const type = normalizedLayerType.type;
            const seedQuantity = num(payload.baseQuantity ?? payload.base_quantity ?? payload.seedQuantity
                ?? payload.seed_quantity ?? layer?.seed_quantity ?? layer?.metadata_json?.base_quantity ?? 0);
            const syncedMultiplier = Math.max(0, num(payload.multiplier ?? layer?.multiplier ?? layer?.metadata_json?.multiplier ?? 1));
            const data = {
                client_uid: layer?.client_uid || externalId,
                page_number: Number(layer?.page_number || payload.page_number || payload.pageNumber || pageNum || 1),
                name: payload.name || 'Takeoff Layer',
                type,
                takeoff_type: type,
                takeoff_subtype: normalizedLayerType.subtype,
                original_takeoff_type: normalizedType,
                drop_length: Math.max(0, num(payload.drop_length ?? payload.dropLength)),
                spacing: Math.max(0, num(payload.spacing ?? payload.metadata_json?.spacing)),
                group_name: payload.group_name || payload.category || 'Project Takeoff',
                unit_of_measure: payload.unit_of_measure || payload.uom || (type === 'linear' ? 'ft' : (type === 'area' ? 'sq ft' : 'ea')),
                catalog_item_id: payload.catalog_item_id || payload.catalogItemId || null,
                assembly_id: payload.assembly_id || null,
                color: payload.color || '#2563eb',
                symbol: normalizeSymbol(payload.symbol || 'circle'),
                symbol_size: payload.symbol_size || payload.size || 'Medium',
                unit_cost: num(payload.unit_cost || payload.unitCost || 0),
                unit_labor_time: num(payload.labor_hours || payload.laborHours || payload.unit_labor_time || 0),
                cost_code: payload.cost_code || payload.catalogNumber || '',
                multiplier: syncedMultiplier,
                visible: payload.visible === false ? 0 : 1,
                locked: payload.locked ? 1 : 0,
                seed_quantity: seedQuantity,
                metadata_json: window.CatalogMetadata.mergeMetadata(layer?.metadata_json,
                    payload.catalogMetadata || payload.metadata_json?.catalog_item, { project_layer_id: layer?.client_uid || externalId,
                    base_quantity: seedQuantity,
                    multiplier: syncedMultiplier,
                    estimate_id: payload.estimate_id || payload.estimateId || null,
                    estimating_item_id: payload.estimating_item_id || payload.estimatingItemId || null,
                    estimating_group_id: payload.estimating_group_id || payload.estimatingGroupId || null,
                    estimating_override_block: Boolean(payload.estimating_override_block ?? payload.metadata_json?.estimating_override_block),
                    estimating_override_qty: Number(payload.estimating_override_qty ?? payload.metadata_json?.estimating_override_qty ?? 0),
                    estimating_override_uom: String(payload.estimating_override_uom ?? payload.metadata_json?.estimating_override_uom ?? payload.unit_of_measure ?? payload.uom ?? 'ea') }),
            };
            if (layer) {
                const layerKeys = new Set([externalId, String(layer.client_uid || ''), String(layer.id || ''), String(layer.metadata_json?.project_layer_id || ''), String(layer.integration_key || '')].filter(Boolean));
                const prevType = normalizeEditorLayerType(layer.takeoff_type || layer.type || layer.layer_type).type;
                const prevSubtype = normalizeLinearSubtype(layer.takeoff_subtype || layer.original_takeoff_type || layer.takeoff_type || layer.type);
                const prevDrop = Math.max(0, num(layer.drop_length ?? layer.dropLength ?? 0));
                const prevSpacing = Math.max(0, num(layer.spacing ?? layer.metadata_json?.spacing ?? 0));
                const typeFamilyChanged = prevType !== type;
                const subtypeChanged = !typeFamilyChanged && type === 'linear' && prevSubtype !== data.takeoff_subtype;
                const dropChanged = Math.abs(prevDrop - data.drop_length) > 0.0001;
                const spacingChanged = Math.abs(prevSpacing - data.spacing) > 0.0001;
                const groupChanged = String(layer.group_name || '') !== String(data.group_name || '');
                const nameChanged = String(layer.name || '') !== String(data.name || '');
                const colorChanged = layer.color !== data.color;
                const symbolChanged = layer.symbol !== data.symbol;
                const sizeChanged = symbolRadius(layer.symbol_size) !== symbolRadius(data.symbol_size);
                const multiplierChanged = payload.multiplier !== undefined && Math.abs(layerMultiplier(layer) - syncedMultiplier) > 0.0001;
                if (typeFamilyChanged) {
                    data.seed_quantity = 0;
                    if (data.metadata_json && typeof data.metadata_json === 'object') {
                        data.metadata_json.base_quantity = 0;
                    }
                }
                Object.assign(layer, data);
                if (typeFamilyChanged) {
                    purgeIncompatibleLayerObjects(layer, type, layerKeys);
                    scheduleTakeoffAutosave(200);
                } else if (groupChanged || nameChanged || subtypeChanged || dropChanged || spacingChanged) {
                    state.dirty = true;
                    hasPendingManualCanvasCheckpoint = true;
                    scheduleTakeoffAutosave();
                }
                if (colorChanged || symbolChanged || sizeChanged || multiplierChanged || subtypeChanged || dropChanged || spacingChanged) {
                    state.markers.filter(m => layerKeys.has(String(m.layer_client_uid || '')) || layerKeys.has(String(m.layer_id || ''))).forEach(ref => {
                        if (colorChanged) ref.color = data.color;
                        if (symbolChanged) ref.symbol = data.symbol;
                        if (sizeChanged) {
                            ref.symbol_size = data.symbol_size;
                            ref.size = data.symbol_size;
                        }
                        if (multiplierChanged) {
                            ref.multiplier = syncedMultiplier;
                            ref.quantity = calculateCountQuantity(ref);
                        }
                        destroyMarkerNodes(ref);
                        if (Number(ref.page_number) === Number(pageNum) && Number(layer.visible ?? 1) !== 0) {
                            createMarkerNode(ref);
                        }
                    });
                    state.segments.filter(s => layerKeys.has(String(s.layer_client_uid || '')) || layerKeys.has(String(s.layer_id || ''))).forEach(ref => {
                        if (colorChanged) ref.color = data.color;
                        if (subtypeChanged) ref.takeoff_subtype = data.takeoff_subtype;
                        if (dropChanged || subtypeChanged) {
                            ref.drop_length = data.takeoff_subtype === 'linear' || data.takeoff_subtype === 'count_by_distance' ? 0 : data.drop_length;
                        }
                        if (spacingChanged || subtypeChanged) {
                            ref.spacing = data.takeoff_subtype === 'count_by_distance' ? data.spacing : 0;
                        }
                        if (multiplierChanged) ref.multiplier = syncedMultiplier;
                        if (subtypeChanged) {
                            destroySegmentNodes(ref);
                            if (Number(ref.page_number) === Number(pageNum) && Number(layer.visible ?? 1) !== 0) {
                                createSegmentNode(ref);
                            }
                        } else if (!ref.node && Number(ref.page_number) === Number(pageNum) && Number(layer.visible ?? 1) !== 0) {
                            createSegmentNode(ref);
                        } else {
                            if (colorChanged) ref.node.stroke(String(ref.color || layer.color));
                            refreshSegment(ref);
                        }
                    });
                }
            } else {
                state.layers.push(data);
            }
            untrackDeletedLayer(data);
            untrackDeletedLayer(externalId);
        });
        // Preserve parent group layer ordering inside state.layers (copied items stay right below their source)
        const payloadOrder = new Map();
        layers.forEach((p, idx) => {
            if (p?.id) payloadOrder.set(String(p.id), idx);
        });
        const orderedLayers = [];
        const unmatchedLayers = [];
        const bucketByOrder = new Map();
        state.layers.forEach(row => {
            const matchedKey = layerTrackingKeys(row).find(k => payloadOrder.has(k));
            if (matchedKey !== undefined) {
                const idx = payloadOrder.get(matchedKey);
                if (!bucketByOrder.has(idx)) bucketByOrder.set(idx, []);
                bucketByOrder.get(idx).push(row);
            } else {
                unmatchedLayers.push(row);
            }
        });
        Array.from(bucketByOrder.keys()).sort((a, b) => a - b).forEach(idx => {
            orderedLayers.push(...bucketByOrder.get(idx));
        });
        if (orderedLayers.length) {
            state.layers = [...orderedLayers, ...unmatchedLayers];
        }
        setTakeoffPage(pageNum);
        renderLayers();
        if (typeof window.syncKonvaToFabric === 'function') {
            window.syncKonvaToFabric();
        }
        return projectSnapshot();
    };

    window.projectTakeoffClearActiveLayer = function (showToastNotice = false) {
        state.projectControlled = true;
        deactivateLayerForInsert();
        if (showToastNotice) {
            showToast('Active layer cleared', 'success');
        }
        return true;
    };

    window.projectTakeoffSetLayersVisibility = function (entries) {
        const list = Array.isArray(entries) ? entries : [];
        if (!list.length) return false;
        const layerByKey = new Map();
        state.layers.forEach(row => {
            if (row.client_uid != null) layerByKey.set(String(row.client_uid), row);
            if (row.metadata_json?.project_layer_id != null) layerByKey.set(String(row.metadata_json.project_layer_id), row);
            if (row.id != null && row.id !== '') layerByKey.set(String(row.id), row);
            if (row.integration_key) layerByKey.set(String(row.integration_key), row);
        });
        let changedCount = 0;
        list.forEach(entry => {
            if (!entry || entry.id === undefined || entry.id === null) return;
            const layer = layerByKey.get(String(entry.id));
            if (!layer) return;
            const nextVis = entry.visible ? 1 : 0;
            if (Number(layer.visible ?? 1) !== nextVis) {
                layer.visible = nextVis;
            }
            changedCount++;
        });
        if (!changedCount) return false;
        setTakeoffPage(pageNum);
        renderLayers();
        scheduleEmitProjectState(true, 120);
        scheduleTakeoffAutosave();
        return true;
    };

    window.projectTakeoffSetLayerVisibility = function (layerId, visible) {
        return window.projectTakeoffSetLayersVisibility([{ id: layerId, visible }]);
    };

    window.projectTakeoffDeleteLayer = function (layerId, options = {}) {
        const key = String(layerId || '').trim();
        if (!key) return false;
        return Boolean(window.projectTakeoffDeleteLayers([key], options));
    };

    window.projectTakeoffDeleteLayers = function (layerIds, options = {}) {
        const force = Boolean(options?.force);
        const wanted = new Set((Array.isArray(layerIds) ? layerIds : []).map(String).filter(Boolean));
        if (!wanted.size) return false;
        const layers = state.layers.filter(row => layerTrackingKeys(row).some(k => wanted.has(k)));
        const allKeys = new Set(wanted);
        layers.forEach(layer => layerTrackingKeys(layer).forEach(k => allKeys.add(k)));
        const matchesAnyKey = (obj) => {
            const lcu = String(obj?.layer_client_uid || '');
            const lid = String(obj?.layer_id || '');
            return (lcu && allKeys.has(lcu)) || (lid && allKeys.has(lid));
        };
        const blocked = !force && layers.some(layer => Number(layer.locked || 0) === 1
            || state.markers.some(marker => matchesAnyKey(marker) && isElementLocked(marker))
            || state.segments.some(segment => matchesAnyKey(segment) && isElementLocked(segment)));
        if (blocked) return false;
        const affectedPages = new Set();
        layers.forEach(layer => affectedPages.add(Number(layer.page_number || pageNum || 1)));
        state.markers.forEach(marker => {
            if (matchesAnyKey(marker)) affectedPages.add(Number(marker.page_number || pageNum || 1));
        });
        state.segments.forEach(segment => {
            if (matchesAnyKey(segment)) affectedPages.add(Number(segment.page_number || pageNum || 1));
        });
        snapshot();
        if (layers.length) {
            layers.forEach(layer => deleteLayerWithoutConfirm(layer, [...allKeys]));
        } else {
            allKeys.forEach(k => deletedTakeoffLayers.add(k));
            purgeObjectsForLayerKeys(allKeys);
        }
        affectedPages.forEach(page => dirtyTakeoffPages.add(page));
        markDirty({ pageFallback: affectedPages.size === 0, objectsTracked: true });
        renderAll();
        flushKonvaCanvasDraw(true);
        if (typeof window.syncKonvaToFabric === 'function') window.syncKonvaToFabric();
        emitSelectionState();
        return { deletedLayerIds: [...allKeys], snapshot: projectSnapshot() };
    };

    window.projectTakeoffSnapshot = function () {
        return projectSnapshot();
    };

    window.projectTakeoffResolveDraftOnPointer = function () {
        if (state.draftLine) {
            if (state.draftLine.points.length >= 2) {
                finishLinear();
                return 'finished';
            }
            cancelLinearDraft();
            return 'cancelled';
        }
        if (state.draftArea) {
            if (state.draftArea.points?.length >= 3) {
                finishArea();
                return 'finished';
            }
            clearDrafts();
            return 'cancelled';
        }
        return 'none';
    };

    window.projectTakeoffCancelActiveDraft = function () {
        let cancelled = false;
        if (state.draftLine) {
            cancelLinearDraft();
            cancelled = true;
        }
        if (state.draftArea) {
            clearDrafts();
            cancelled = true;
        }
        return cancelled;
    };

    window.projectTakeoffSetTool = function (tool) {
        const normalized = String(tool || '').toLowerCase();
        if (normalized === 'pan') {
            flushPendingProjectStateEmit();
            setTool('smart');
            state.panMode = true;
            applyTakeoffDrawingInteractivity();
            window.setTakeoffPanMode?.(true, false);
            return true;
        }
        state.panMode = false;
        state.temporaryPan = false;
        window.setTakeoffPanMode?.(false, false);
        window.setTakeoffPanMode?.(false, true);
        if (normalized === 'select' || normalized === 'smart') {
            if (state.draftLine) {
                if (state.draftLine.points.length >= 2) {
                    finishLinear();
                } else {
                    cancelLinearDraft();
                }
            }
            if (state.draftArea) {
                if (state.draftArea.points?.length >= 3) {
                    finishArea();
                } else {
                    clearDrafts();
                }
            }
            flushPendingProjectStateEmit();
            setTool('smart');
            applyTakeoffDrawingInteractivity();
            return true;
        }
        if (normalized === 'multi-select' || normalized === 'select-rect') {
            setTool('multi-select');
            if (typeof setMode === 'function') setMode('smart');
            if (typeof setKonvaActive === 'function') setKonvaActive(true);
            if (konvaStage?.container()) konvaStage.container().style.cursor = 'crosshair';
            applyTakeoffDrawingInteractivity();
            return true;
        }
        if (normalized === 'transform' || normalized === 'vertices') {
            setTool('smart');
            if (isElementLocked(state.selectedElement?.ref)) return false;
            if (state.selectedElement?.type === 'segment') {
                (state.selectedElement.ref.handles || []).forEach(handle => handle.visible(true));
                konvaLayer?.batchDraw();
            }
            return normalized === 'vertices'
                ? state.selectedElement?.type === 'segment'
                : Boolean(state.selectedElement);
        }
        if (normalized === 'measure') {
            clearTakeoffSelection();
            state.tool = 'measure';
            if (typeof setMode === 'function') setMode('measure');
            return true;
        }
        if (normalized === 'freehand' || normalized === 'draw') {
            clearTakeoffSelection();
            state.tool = 'draw';
            if (typeof setMode === 'function') setMode('draw');
            return true;
        }
        if (normalized === 'pin') {
            clearTakeoffSelection();
            state.tool = 'pin';
            if (typeof addPin === 'function') addPin();
            return true;
        }
        if (normalized === 'measure') {
            clearTakeoffSelection();
            state.tool = 'measure';
            if (typeof setMode === 'function') setMode('measure');
            return true;
        }
        if (normalized === 'linear') return setTool('takeoff_linear');
        if (normalized === 'area') return setTool('takeoff_area');
        if (normalized === 'count') return setTool('takeoff_count');
        return setTool('smart');
    };

    window.projectTakeoffArmAddNode = function (armed = true) {
        state.addNodeArmed = Boolean(armed);
        if (state.addNodeArmed) {
            if (konvaStage?.container()) konvaStage.container().style.cursor = 'crosshair';
            document.body.style.cursor = 'crosshair';
            showToast('Click anywhere on the line to insert a new node', 'info');
        } else {
            if (konvaStage?.container()) konvaStage.container().style.cursor = 'default';
            document.body.style.cursor = '';
        }
        return state.addNodeArmed;
    };

    window.projectTakeoffUndo = function () {
        if (state.draftLine) return undoLinearPoint();
        if (!state.undo.length) return false;
        state.redo.push(JSON.stringify({ layers: state.layers, markers: state.markers.map(stripNodes), segments: state.segments.map(stripNodes) }));
        if (state.redo.length > MAX_TAKEOFF_HISTORY) state.redo.shift();
        restore(state.undo.pop());
        return true;
    };

    window.projectTakeoffRedo = function () {
        if (!state.redo.length) return false;
        state.undo.push(JSON.stringify({ layers: state.layers, markers: state.markers.map(stripNodes), segments: state.segments.map(stripNodes) }));
        if (state.undo.length > MAX_TAKEOFF_HISTORY) state.undo.shift();
        restore(state.redo.pop());
        return true;
    };

    window.projectTakeoffOnZoom = function (info) {
        if (!konvaStage) return;
        const pos = konvaStage.getPointerPosition();
        if (pos) {
            const world = screenToWorld(pos);
            linearPointerWorld = world;
            if (state.tool === 'takeoff_linear' && state.draftLine && state.draftLine.points.length) {
                renderLinearPreview(world, linearShiftPressed);
            }
            if (state.tool === 'takeoff_area' && state.draftArea?.preview && state.draftArea.points.length) {
                updateAreaDraftPreview([...state.draftArea.points, world]);
                konvaLayer?.batchDraw();
            }
        }
    };

    window.projectTakeoffSetTemporaryPan = function (enabled) {
        state.temporaryPan = Boolean(enabled);
        applyTakeoffDrawingInteractivity();
        window.setTakeoffPanMode?.(state.temporaryPan, true);
        return state.temporaryPan;
    };

    window.projectTakeoffSetAnnotationPlacement = function (enabled) {
        state.annotationPlacement = Boolean(enabled);
        applyTakeoffDrawingInteractivity();
        return state.annotationPlacement;
    };

    window.projectTakeoffIsDrawingToolActive = function () {
        return ['takeoff_count', 'takeoff_linear', 'takeoff_area'].includes(state.tool);
    };

    window.projectTakeoffIsCountToolActive = function () {
        return state.tool === 'takeoff_count';
    };

    window.projectTakeoffIsPanModeActive = function () {
        return state.panMode || state.temporaryPan;
    };

    window.projectTakeoffSetContinuous = function (enabled) {
        state.continuousTool = Boolean(enabled);
        emitToolState();
        return state.continuousTool;
    };

    window.projectTakeoffClearSelection = function () {
        return clearTakeoffSelection();
    };

    window.projectTakeoffSelectGroup = function (layerIds) {
        const allowed = new Set((Array.isArray(layerIds) ? layerIds : []).map(String));
        const targets = [
            ...state.markers.filter(marker => allowed.has(String(marker.layer_client_uid))).map(marker => ({ type: 'marker', ref: marker })),
            ...state.segments.filter(segment => allowed.has(String(segment.layer_client_uid))).map(segment => ({ type: 'segment', ref: segment }))
        ];
        state.selectedObjectUids = new Set(targets.map(target => String(target.ref.client_uid)));
        state.selectedElement = targets.length === 1 ? targets[0] : null;
        state.segments.forEach(segment => (segment.handles || []).forEach(handle => handle.visible(false)));
        applyObjectSelectionVisuals();
        renderProperties();
        if (konvaLayer) konvaLayer.batchDraw();
        return targets.map(target => String(target.ref.client_uid));
    };

    window.projectTakeoffSetSelectionLocked = function (objectIds, locked) {
        const targets = (Array.isArray(objectIds) ? objectIds : []).map(findTakeoffObjectByUid).filter(Boolean);
        if (!targets.length) return false;
        snapshot();
        targets.forEach(({ type, ref }) => {
            ref.locked = locked ? 1 : 0;
            ref.updatedAt = timestamp();
            ref.updated_at = ref.updatedAt;
            if (type === 'marker') applyMarkerLockVisual(ref);
            else applySegmentLockVisual(ref);
        });
        trackTakeoffObjects(targets);
        markDirty({ objectsTracked: true });
        applyObjectSelectionVisuals();
        return true;
    };

    window.projectTakeoffSetLayerLocked = function (layerId, locked) {
        const layer = state.layers.find(row => String(row.client_uid) === String(layerId) || String(row.metadata_json?.project_layer_id) === String(layerId) || String(row.id) === String(layerId));
        if (!layer) return false;
        snapshot();
        layer.locked = locked ? 1 : 0;
        layer.updated_at = timestamp();
        const layerTargets = [];
        state.markers.filter(marker => String(marker.layer_client_uid) === String(layer.client_uid)).forEach(marker => {
            marker.locked = locked ? 1 : 0;
            marker.updated_at = timestamp();
            applyMarkerLockVisual(marker);
            layerTargets.push({ type: 'marker', ref: marker });
        });
        state.segments.filter(segment => String(segment.layer_client_uid) === String(layer.client_uid)).forEach(segment => {
            segment.locked = locked ? 1 : 0;
            segment.updated_at = timestamp();
            applySegmentLockVisual(segment);
            layerTargets.push({ type: 'segment', ref: segment });
        });
        trackTakeoffObjects(layerTargets);
        markDirty({ pageFallback: true, objectsTracked: true });
        applyObjectSelectionVisuals();
        return true;
    };

    window.projectTakeoffGetLayerLockState = function (layerId) {
        const layer = state.layers.find(row => String(row.client_uid) === String(layerId) || String(row.metadata_json?.project_layer_id) === String(layerId) || String(row.id) === String(layerId));
        if (!layer) return { locked: false, layerLocked: false, objectCount: 0 };
        const objects = [
            ...state.markers.filter(marker => String(marker.layer_client_uid) === String(layer.client_uid)),
            ...state.segments.filter(segment => String(segment.layer_client_uid) === String(layer.client_uid))
        ];
        return {
            locked: Number(layer.locked || 0) === 1 || objects.some(isObjectIndividuallyLocked),
            layerLocked: Number(layer.locked || 0) === 1,
            objectCount: objects.length
        };
    };

    window.projectTakeoffGetAllLayerLockStates = function () {
        const result = Object.create(null);
        const byClientUid = new Map();
        state.layers.forEach(layer => {
            const entry = {
                locked: Number(layer.locked || 0) === 1,
                layerLocked: Number(layer.locked || 0) === 1,
                objectCount: 0
            };
            const keys = [layer.client_uid, layer.metadata_json?.project_layer_id, layer.id]
                .filter(value => value !== undefined && value !== null && String(value) !== '')
                .map(String);
            keys.forEach(key => { result[key] = entry; });
            if (layer.client_uid !== undefined && layer.client_uid !== null) {
                byClientUid.set(String(layer.client_uid), entry);
            }
        });
        const countObject = object => {
            const entry = byClientUid.get(String(object.layer_client_uid || ''));
            if (!entry) return;
            entry.objectCount += 1;
            if (isObjectIndividuallyLocked(object)) entry.locked = true;
        };
        state.markers.forEach(countObject);
        state.segments.forEach(countObject);
        return result;
    };

    window.projectTakeoffGetSelectionLockState = function () {
        const targets = selectedTakeoffObjectIds().map(findTakeoffObjectByUid).filter(Boolean);
        return {
            count: targets.length,
            anyLocked: targets.some(target => isElementLocked(target.ref)),
            allLocked: targets.length > 0 && targets.every(target => isElementLocked(target.ref))
        };
    };

    window.projectTakeoffUpdateSelection = function (objectIds, patch) {
        const targets = (Array.isArray(objectIds) ? objectIds : []).map(findTakeoffObjectByUid).filter(Boolean);
        if (!targets.length || !patch || typeof patch !== 'object') return false;
        if (targets.some(target => isElementLocked(target.ref))) {
            showToast('Unlock selected elements before editing their properties.', 'warning');
            return false;
        }
        snapshot();
        targets.forEach(({ type, ref }) => {
            if (patch.multiplier !== undefined) ref.multiplier = Math.max(0, num(patch.multiplier));
            if (patch.notes !== undefined) ref.notes = String(patch.notes);
            if (type === 'marker') ref.quantity = calculateCountQuantity(ref);
            else refreshSegment(ref);
            ref.updatedAt = timestamp();
            ref.updated_at = ref.updatedAt;
        });
        trackTakeoffObjects(targets);
        markDirty({ objectsTracked: true });
        return true;
    };

    window.projectTakeoffUpdateLayerObjects = function (layerId, patch) {
        if (!layerId || !patch || typeof patch !== 'object') return false;
        const layerKey = String(layerId);
        const layer = state.layers.find(row => String(row.client_uid) === layerKey
            || String(row.metadata_json?.project_layer_id || '') === layerKey
            || String(row.id || '') === layerKey
            || String(row.integration_key || '') === layerKey);
        const layerKeys = new Set([
            layerKey,
            String(layer?.client_uid || ''),
            String(layer?.id || ''),
            String(layer?.metadata_json?.project_layer_id || ''),
            String(layer?.integration_key || '')
        ].filter(Boolean));
        let targets = [
            ...state.markers.filter(marker => layerKeys.has(String(marker.layer_client_uid || '')) || layerKeys.has(String(marker.layer_id || ''))),
            ...state.segments.filter(segment => layerKeys.has(String(segment.layer_client_uid || '')) || layerKeys.has(String(segment.layer_id || '')))
        ];
        if (!layer) return false;
        const metadataOnly = Boolean(patch.metadataOnly);
        if (!metadataOnly) {
            snapshot();
        }
        const prevType = normalizeEditorLayerType(layer.takeoff_type || layer.type || layer.layer_type).type;
        const prevSubtype = normalizeLinearSubtype(layer.takeoff_subtype || layer.original_takeoff_type || layer.takeoff_type || layer.type);
        let nextType = prevType;
        let nextSubtype = prevSubtype;
        if (patch.name !== undefined) {
            const previousName = String(layer.name || '');
            const nextName = String(patch.name);
            layer.name = nextName;
            if (nextName !== previousName) {
                const integrationKey = String(layer.integration_key || layer.metadata_json?.project_layer_id
                    || layer.client_uid || layer.id || layerKey);
                pendingLayerNameUpdates.set(integrationKey, {
                    integration_key: integrationKey,
                    name: nextName,
                    generation: ++takeoffDirtyGeneration
                });
            }
        }
        if (patch.tag !== undefined) {
            layer.tag = String(patch.tag);
            layer.metadata_json = { ...(layer.metadata_json || {}), tag: layer.tag };
        }
        if (patch.difficulty !== undefined) {
            layer.difficulty = Number(patch.difficulty);
            layer.metadata_json = { ...(layer.metadata_json || {}), difficulty: layer.difficulty };
        }
        if (patch.type !== undefined || patch.takeoff_type !== undefined) {
            const rawNext = patch.takeoff_type ?? patch.type;
            const normNext = normalizeEditorLayerType(rawNext);
            nextType = normNext.type;
            nextSubtype = normNext.subtype;
            layer.takeoff_type = normNext.type;
            layer.type = normNext.type;
            layer.takeoff_subtype = normNext.subtype;
            layer.original_takeoff_type = String(rawNext || normNext.type).toLowerCase();
        }
        const subtypeChanged = prevType === nextType && nextType === 'linear' && prevSubtype !== nextSubtype;
        if (patch.uom !== undefined) layer.unit_of_measure = String(patch.uom);
        const hasDropPatch = patch.dropLength !== undefined && Number.isFinite(Number(patch.dropLength)) && Number(patch.dropLength) >= 0;
        const nextDropLength = hasDropPatch ? Math.max(0, num(patch.dropLength)) : null;
        if (hasDropPatch) layer.drop_length = nextDropLength;
        const hasSpacingPatch = patch.spacing !== undefined && Number.isFinite(Number(patch.spacing)) && Number(patch.spacing) >= 0;
        const nextSpacing = hasSpacingPatch ? Math.max(0, num(patch.spacing)) : null;
        if (hasSpacingPatch) layer.spacing = nextSpacing;
        const typeFamilyChanged = prevType !== nextType || Boolean(patch.purgeIncompatibleGeometry);
        if (typeFamilyChanged) {
            purgeIncompatibleLayerObjects(layer, nextType, layerKeys);
        }
        targets = targets.filter(ref => state.markers.includes(ref) || state.segments.includes(ref));
        if (patch.symbol !== undefined) layer.symbol = normalizeSymbol(patch.symbol);
        if (patch.color !== undefined) layer.color = String(patch.color);
        if (patch.symbolSize !== undefined) layer.symbol_size = symbolRadius(patch.symbolSize);
        if (patch.strokeWidth !== undefined) layer.stroke_width = Math.max(1, Math.min(3, num(patch.strokeWidth)));
        const hasMultiplierPatch = patch.multiplier !== undefined && Number.isFinite(Number(patch.multiplier)) && Number(patch.multiplier) >= 0;
        const nextMultiplier = hasMultiplierPatch ? Math.max(0, Number(patch.multiplier)) : null;
        if (hasMultiplierPatch) {
            layer.multiplier = nextMultiplier;
            layer.metadata_json = { ...(layer.metadata_json || {}), multiplier: nextMultiplier };
        }
        const markerVisualChanged = (patch.color !== undefined) || (patch.symbol !== undefined) || (patch.symbolSize !== undefined);
        const segmentVisualChanged = (patch.color !== undefined) || (patch.strokeWidth !== undefined);
        if (markerVisualChanged || segmentVisualChanged || hasMultiplierPatch || hasDropPatch || hasSpacingPatch || subtypeChanged || typeFamilyChanged) {
            targets.forEach(ref => {
                if (isElementLocked(ref)) return;
                const marker = state.markers.includes(ref);
                if (patch.color !== undefined) ref.color = String(patch.color);
                if (hasMultiplierPatch) ref.multiplier = nextMultiplier;
                if (marker) {
                    if (hasMultiplierPatch) ref.quantity = calculateCountQuantity(ref);
                    if (patch.symbol !== undefined) ref.symbol = normalizeSymbol(patch.symbol);
                    if (patch.symbolSize !== undefined) {
                        ref.symbol_size = symbolRadius(patch.symbolSize);
                        ref.size = ref.symbol_size;
                    }
                    ref.metadata_json = { ...(ref.metadata_json || {}),
                        symbol_size: ref.symbol_size,
                        diameter: Math.max(8, Math.min(192, num(patch.diameter || ref.symbol_size * 2))) };
                    if (markerVisualChanged) {
                        destroyMarkerNodes(ref);
                        createMarkerNode(ref);
                    }
                } else {
                    if (subtypeChanged) ref.takeoff_subtype = nextSubtype;
                    if (hasDropPatch || subtypeChanged) {
                        const effectiveSub = normalizeLinearSubtype(ref.takeoff_subtype || layer.takeoff_subtype || layer.type);
                        ref.drop_length = effectiveSub === 'linear' || effectiveSub === 'count_by_distance'
                            ? 0
                            : Math.max(0, nextDropLength !== null ? nextDropLength : num(layer.drop_length || 0));
                    }
                    if (hasSpacingPatch || subtypeChanged) {
                        const effectiveSub = normalizeLinearSubtype(ref.takeoff_subtype || layer.takeoff_subtype || layer.type);
                        ref.spacing = effectiveSub === 'count_by_distance'
                            ? Math.max(0, nextSpacing !== null ? nextSpacing : num(layer.spacing || 0))
                            : 0;
                    }
                    if (patch.strokeWidth !== undefined) ref.stroke_width = Math.max(1, Math.min(3, num(patch.strokeWidth)));
                    ref.metadata_json = { ...(ref.metadata_json || {}),
                        thickness: ref.stroke_width,
                        takeoff_subtype: normalizeLinearSubtype(ref.takeoff_subtype || layer.takeoff_subtype || ref.type),
                        drop_length: Math.max(0, num(ref.drop_length ?? ref.dropLength)),
                        spacing: Math.max(0, num(ref.spacing ?? 0)) };
                    if (hasMultiplierPatch || hasDropPatch || hasSpacingPatch || subtypeChanged) {
                        if (String(ref.takeoff_type || ref.type || '').toLowerCase() === 'area') calculateAreaQuantity(ref);
                        else calculateLinearLength(ref);
                    }
                    const isAreaSeg = String(ref.takeoff_type || ref.type || '').toLowerCase() === 'area';
                    const viewportScale = Number(canvas?.viewportTransform?.[0] || 1);
                    const scaleFactor = viewportScale > 0 ? 1 / viewportScale : 1;
                    if (subtypeChanged) {
                        destroySegmentNodes(ref);
                        createSegmentNode(ref);
                    } else if (segmentVisualChanged || hasMultiplierPatch || hasDropPatch || hasSpacingPatch) {
                        ref.node?.stroke(String(ref.color || layer.color));
                        ref.node?.strokeWidth(ref.stroke_width);
                        ref.node?.hitStrokeWidth(segmentHitStrokeWidth(ref, isAreaSeg, scaleFactor));
                        refreshSegment(ref);
                    }
                }
                ref.updatedAt = timestamp();
                ref.updated_at = ref.updatedAt;
            });
            applyObjectSelectionVisuals();
            if (targets.length) {
                trackTakeoffObjects(targets.map(ref => ({ type: state.markers.includes(ref) ? 'marker' : 'segment', ref })));
            }
        }
        // A layer edit must persist even when the duplicate has no geometry yet.
        // The page fallback carries the layer row, while tracked objects carry
        // marker/segment appearance changes with their stable identities.
        markDirty({ pageFallback: true, objectsTracked: true });
        renderProperties();
        if (typeFamilyChanged || subtypeChanged || hasDropPatch || hasSpacingPatch) {
            renderLayers();
            emitProjectState(true);
        }
        return true;
    };

    window.projectTakeoffMoveSelectionToLayer = function (objectIds, targetLayer) {
        if (!targetLayer?.id) return false;
        const targets = (Array.isArray(objectIds) ? objectIds : []).map(findTakeoffObjectByUid).filter(Boolean);
        if (!targets.length || targets.some(target => isElementLocked(target.ref))) {
            if (targets.some(target => isElementLocked(target.ref))) showToast('Unlock selected elements before moving them.', 'warning');
            return false;
        }
        snapshot();
        targets.forEach(({ ref }) => {
            ref.layer_client_uid = String(targetLayer.id);
            ref.catalog_item_id = targetLayer.catalog_item_id || targetLayer.catalogItemId || ref.catalog_item_id || null;
            ref.updatedAt = timestamp();
            ref.updated_at = ref.updatedAt;
        });
        trackTakeoffObjects(targets);
        markDirty({ objectsTracked: true });
        return true;
    };

    window.projectTakeoffDeleteSelection = function (objectIds) {
        return deleteTakeoffSelection(objectIds);
    };

    window.projectTakeoffSave = function () {
        flushPendingProjectStateEmit();
        return saveTakeoff(true, true).then(result => {
            hasPendingManualCanvasCheckpoint = false;
            return result;
        });
    };

    window.projectTakeoffDeleteCurrentSelection = function () {
        return deleteTakeoffSelection();
    };

    window.projectTakeoffGetSelectionIds = function () {
        return selectedTakeoffObjectIds();
    };

    window.projectTakeoffHandleDeleteKey = function (event) {
        if (!event || (event.key !== 'Delete' && event.key !== 'Backspace')) return false;
        const target = event.target;
        if (target?.matches?.('input, textarea, select, option, [contenteditable="true"], [role="textbox"]')) return false;
        if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
        if (event.key === 'Backspace' && state.draftLine) return undoLinearPoint();
        if (!selectedTakeoffObjectIds().length && !state.draftLine && !state.draftArea) return false;
        return deleteTakeoffSelection();
    };

    window.projectTakeoffCopySelection = function (objectIds) {
        const ids = Array.isArray(objectIds) ? objectIds : [];
        const targets = ids.map(findTakeoffObjectByUid).filter(Boolean);
        if (!targets.length && state.selectedElement) targets.push(state.selectedElement);
        if (!targets.length) return false;
        snapshot();
        const copies = targets.map(target => {
            const copy = {
                ...stripNodes(target.ref),
                client_uid: uid(),
                createdAt: timestamp(),
                updatedAt: timestamp()
            };
            copy.created_at = copy.createdAt;
            copy.updated_at = copy.updatedAt;
            if (target.type === 'marker') {
                assignNewPlacementIdentity(copy);
                copy.x = num(target.ref.x) + 16;
                copy.y = num(target.ref.y) + 16;
                state.markers.push(copy);
                createMarkerNode(copy);
                trackTakeoffObjects([{ type: 'marker', ref: copy }], false);
            } else {
                copy.points_json = (target.ref.points_json || []).map(point => ({ x: point.x + 16, y: point.y + 16 }));
                state.segments.push(copy);
                createSegmentNode(copy);
                trackTakeoffObjects([{ type: 'segment', ref: copy }], false);
            }
            dirtyTakeoffPages.add(Number(copy.page_number || pageNum || 1));
            return copy;
        });
        state.selectedElement = null;
        state.selectedObjectUids = new Set(copies.map(copy => String(copy.client_uid)));
        applyObjectSelectionVisuals();
        renderProperties();
        markDirty({ objectsTracked: true });
        return copies.map(copy => String(copy.client_uid));
    };

    window.projectTakeoffSetZoom = function (percent) {
        if (!canvas || typeof canvas.setViewportTransform !== 'function') return null;
        const zoom = Math.max(0.25, Math.min(4.0, Number(percent || 100) / 100));
        const center = typeof canvas.getVpCenter === 'function'
            ? canvas.getVpCenter()
            : { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 };
        if (typeof canvas.zoomToPoint === 'function') canvas.zoomToPoint(center, zoom);
        else canvas.setZoom(zoom);
        if (typeof clampViewportTransform === 'function') {
            clampViewportTransform(canvas.viewportTransform);
            canvas.setViewportTransform(canvas.viewportTransform);
        }
        if (typeof syncKonvaToFabric === 'function') syncKonvaToFabric();
        if (typeof updateTextScales === 'function') updateTextScales(zoom);
        canvas.requestRenderAll();
        const zoomText = Math.round(zoom * 100) + '%';
        const zoomEl = document.getElementById('zoom-disp');
        if (zoomEl) zoomEl.innerText = zoomText;
        if (typeof schedulePdfRerender === 'function') schedulePdfRerender();
        window.notifyTakeoffZoomChanged?.('parent-api');
        return Math.round(zoom * 100);
    };

    window.projectTakeoffGetZoom = function () {
        return canvas && typeof canvas.getZoom === 'function' ? Math.round(canvas.getZoom() * 100) : 100;
    };

    window.projectTakeoffFitToView = function () {
        if (typeof fitPdfToView === 'function') {
            fitPdfToView(true);
            return window.projectTakeoffGetZoom();
        }
        return null;
    };

    window.clearTakeoffSelection = clearTakeoffSelection;
    window.projectTakeoffClearSelection = clearTakeoffSelection;

    function init() {
        renderShell();
        patchEditor();
        bindKonva();
        loadTakeoff().finally(startTakeoffRemoteSync);
    }

    window.addEventListener('beforeunload', () => {
        if (takeoffRemotePollTimer) clearInterval(takeoffRemotePollTimer);
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
