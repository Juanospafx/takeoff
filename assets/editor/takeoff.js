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
        selectionDrag: null,
        draftLine: null,
        draftArea: null,
        projectControlled: false,
        undo: [],
        redo: [],
        dirty: false,
    };

    const uid = () => 'tf_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
    const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    const money = (v) => '$' + num(v).toFixed(2);
    let takeoffAutosaveTimer = null;
    const dirtyTakeoffPages = new Set();
    const dirtyTakeoffPageGenerations = new Map();
    const dirtyTakeoffObjects = new Map();
    const deletedTakeoffObjects = new Map();
    const takeoffObjectBaseVersions = new Map();
    const dirtyTakeoffObjectGenerations = new Map();
    let takeoffDirtyGeneration = 0;
    let missingScaleWarningShown = false;
    let selectionRectDraft = null;

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

    function sheetIdFor(page = pageNum) {
        return `${currentDocumentId()}:${Number(page || 1)}`;
    }

    function timestamp() {
        return new Date().toISOString();
    }
    function serializeTakeoffState() {
        return {
            version: 2,
            savedAt: Date.now(),
            drawing_id: typeof fileId !== 'undefined' ? fileId : null,
            project_id: typeof projectId !== 'undefined' ? projectId : 0,
            layers: state.layers.map(stripNodes),
            markers: state.markers.map(stripNodes),
            segments: state.segments.map(stripNodes),
            summary: calculateTakeoffSummary()
        };
    }

    function scheduleTakeoffAutosave() {
        clearTimeout(takeoffAutosaveTimer);
        takeoffAutosaveTimer = setTimeout(() => {
            saveTakeoff(true);
        }, 900);
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
        return fetch(url, options).then(r => r.json());
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
        return copy;
    }

    function persistLayerCostSnapshot(layer) {
        if (!layer) return layer;
        layer.metadata_json = {
            ...(layer.metadata_json || {}),
            project_layer_id: layer.metadata_json?.project_layer_id || layer.client_uid,
            unit_cost: num(layer.unit_cost || 0),
            unit_labor_time: num(layer.unit_labor_time || layer.labor_hours || 0),
            cost_code: layer.cost_code || '',
            catalog_item_id: layer.catalog_item_id || null
        };
        return layer;
    }

    function restoreLayerCostSnapshot(layer) {
        const metadata = layer?.metadata_json || {};
        const hasSnapshotCost = Object.prototype.hasOwnProperty.call(metadata, 'unit_cost');
        const hasSnapshotLabor = Object.prototype.hasOwnProperty.call(metadata, 'unit_labor_time');
        return {
            ...layer,
            unit_cost: num(hasSnapshotCost ? metadata.unit_cost : (layer.unit_cost ?? 0)),
            unit_labor_time: num(hasSnapshotLabor ? metadata.unit_labor_time : (layer.unit_labor_time ?? layer.labor_hours ?? 0)),
            cost_code: metadata.cost_code || layer.cost_code || '',
            catalog_item_id: layer.catalog_item_id || metadata.catalog_item_id || null
        };
    }

    function snapshot() {
        state.undo.push(JSON.stringify({
            layers: state.layers,
            markers: state.markers.map(stripNodes),
            segments: state.segments.map(stripNodes),
        }));
        if (state.undo.length > 50) state.undo.shift();
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

    function calculateCountQuantity(marker) {
        return num(marker.multiplier || 1);
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
        const horizontal = getPlanScale() > 0 ? px / getPlanScale() : 0;
        const subtype = normalizeLinearSubtype(segment.takeoff_subtype || segment.takeoff_type || segment.type);
        const dropLength = subtype === 'linear' ? 0 : Math.max(0, num(segment.drop_length ?? segment.dropLength));
        // Each committed vertex is a defined drop point. Editing vertices via
        // the existing handles therefore recalculates both run and drops.
        const dropCount = subtype === 'linear' ? 0 : points.length;
        const drops = dropLength * dropCount;
        const measured = horizontal + drops;
        segment.horizontal_length = horizontal;
        segment.drop_length = dropLength;
        segment.drop_count = dropCount;
        segment.drop_total = drops;
        segment.measured_length = measured;
        segment.total_length = measured * num(segment.multiplier || 1);
        segment.unit = 'ft';
        return segment.total_length;
    }

    function normalizeLinearSubtype(value) {
        const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (raw === 'linear with drop') return 'linear_with_drop';
        if (raw === 'linear avg. with drop' || raw === 'linear avg with drop') return 'linear_avg_with_drop';
        if (raw === 'linear_with_drop' || raw === 'linear_avg_with_drop') return raw;
        return 'linear';
    }

    function normalizeEditorLayerType(value) {
        const raw = String(value || 'count').trim().toLowerCase();
        if (raw === 'area') return { type: 'area', subtype: 'area' };
        if (raw === 'linear' || raw === 'linear with drop' || raw === 'linear avg. with drop'
            || raw === 'linear avg with drop' || raw === 'linear_with_drop' || raw === 'linear_avg_with_drop') {
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
        const scale = getPlanScale();
        const measured = scale > 0 ? pxArea / (scale * scale) : 0;
        segment.measured_area = measured;
        segment.total_area = measured * num(segment.multiplier || 1);
        segment.total_length = segment.total_area;
        segment.unit = segment.unit || 'sq ft';
        return segment.total_area;
    }

    function getPlanScale() {
        return (typeof pixelsPerFoot !== 'undefined' && Number(pixelsPerFoot) > 0) ? Number(pixelsPerFoot) : 0;
    }

    function hasPlanScale() {
        return getPlanScale() > 0;
    }

    function formatFeetLabel(feet) {
        if (typeof formatFeetForDisplay === 'function') return formatFeetForDisplay(feet);
        return `${num(feet).toFixed(2)} ft`;
    }

    function formatAreaLabel(area) {
        return `${num(area).toFixed(2)} sq ft`;
    }

    function pointsLength(points) {
        let px = 0;
        for (let index = 1; index < (points || []).length; index++) {
            const dx = points[index].x - points[index - 1].x;
            const dy = points[index].y - points[index - 1].y;
            px += Math.sqrt(dx * dx + dy * dy);
        }
        const scale = getPlanScale();
        return scale > 0 ? px / scale : 0;
    }

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

    function screenToWorld(pos) {
        const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        return { x: (pos.x - vpt[4]) / vpt[0], y: (pos.y - vpt[5]) / vpt[3] };
    }

    function normalizeSymbol(symbol) {
        const raw = String(symbol || '').toLowerCase();
        if (raw.includes('square')) return 'square';
        if (raw.includes('triangle')) return 'triangle';
        if (raw.includes('diamond')) return 'diamond';
        if (raw.includes('cross')) return 'cross';
        return 'circle';
    }

    function symbolRadius(size) {
        const numeric = Number(size);
        if (Number.isFinite(numeric) && numeric > 0) return Math.max(4, Math.min(96, numeric));
        const raw = String(size || '').toLowerCase();
        if (raw === 'small') return 7;
        if (raw === 'large') return 12;
        return 9;
    }

    function drawSymbol(group, symbol, color, size) {
        symbol = normalizeSymbol(symbol);
        const radius = symbolRadius(size);
        // Keep the outline crisp while allowing the drawing beneath a count
        // marker to remain visible. `fillOpacity` affects only the fill, unlike
        // group opacity which would also fade selection/lock affordances.
        const common = { stroke: '#fff', strokeWidth: 1.5, fill: color, fillOpacity: 0.42 };
        if (symbol === 'square') group.add(new Konva.Rect({ x: -radius, y: -radius, width: radius * 2, height: radius * 2, ...common }));
        else if (symbol === 'triangle') group.add(new Konva.RegularPolygon({ sides: 3, radius: radius + 2, ...common }));
        else if (symbol === 'diamond') group.add(new Konva.RegularPolygon({ sides: 4, radius: radius + 2, rotation: 45, ...common }));
        else if (symbol === 'cross') {
            group.add(new Konva.Line({ points: [-radius, 0, radius, 0], stroke: color, strokeWidth: Math.max(3, radius / 2) }));
            group.add(new Konva.Line({ points: [0, -radius, 0, radius], stroke: color, strokeWidth: Math.max(3, radius / 2) }));
        } else {
            group.add(new Konva.Circle({ radius, ...common }));
        }
    }

    function isObjectIndividuallyLocked(ref) {
        return Number(ref?.locked || 0) === 1;
    }

    function isElementLocked(ref) {
        if (isObjectIndividuallyLocked(ref)) return true;
        const layer = state.layers.find(row => String(row.client_uid) === String(ref?.layer_client_uid));
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
        // Count remains armed for repeated placement, but existing geometry must
        // still receive clicks/drags so it never becomes static after creation.
        return ['takeoff_linear', 'takeoff_area', 'multi-select'].includes(state.tool);
    }

    function applyTakeoffDrawingInteractivity() {
        const panning = state.panMode || state.temporaryPan;
        const listening = !isTakeoffObjectInteractionBlocked() && !panning && !state.annotationPlacement;
        state.markers.forEach(marker => {
            marker.node?.listening(listening);
            marker.node?.draggable(listening && !panning && !isElementLocked(marker));
            marker.transformer?.listening(listening && !panning && !isElementLocked(marker));
        });
        state.segments.forEach(segment => {
            segment.node?.listening(listening);
            segment.node?.draggable(listening && !panning && !isElementLocked(segment));
            (segment.handles || []).forEach(handle => handle.listening(listening));
            (segment.handles || []).forEach(handle => handle.draggable(listening && !panning && !isElementLocked(segment)));
        });
        konvaLayer?.batchDraw();
    }

    function applyMarkerLockVisual(marker) {
        if (!marker.node) return;
        const locked = isElementLocked(marker);
        marker.node.draggable(!locked && !isTakeoffObjectInteractionBlocked()
            && !state.panMode && !state.temporaryPan && !state.annotationPlacement);
        marker.node.opacity(locked ? 0.55 : 1);
        marker.transformer?.visible(!locked && state.selectedObjectUids.has(String(marker.client_uid))
            && isElementVisibleOnPage(marker));
        const existing = marker.node.findOne('.takeoff-object-lock');
        if (existing) existing.destroy();
        if (locked) marker.node.add(new Konva.Text({
            name: 'takeoff-object-lock',
            x: 12,
            y: 9,
            text: 'LOCKED',
            fill: '#fbbf24',
            fontSize: 9,
            fontStyle: 'bold',
            listening: false
        }));
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
        konvaLayer?.batchDraw();
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
    }

    function createMarkerNode(marker) {
        if (!ensureKonva()) return;
        const markerLayer = state.layers.find(layer => String(layer.client_uid) === String(marker.layer_client_uid));
        const itemName = markerLayer?.name || marker.label || 'Takeoff item';
        const group = new Konva.Group({ x: num(marker.x), y: num(marker.y), draggable: !isElementLocked(marker), listening: !isTakeoffObjectInteractionBlocked(), visible: marker.page_number === pageNum });
        const symbol = new Konva.Group({ name: 'takeoff-count-symbol' });
        drawSymbol(symbol, marker.symbol || 'circle', marker.color || '#2563eb', marker.symbol_size || marker.size);
        group.add(symbol);
        // Quantity remains on the marker model and in layer roll-ups; it is not
        // a visual label. Only render text explicitly entered by the user.
        group.add(new Konva.Text({ x: 12, y: -10, text: marker.label || '', fill: marker.color || '#2563eb', fontSize: 14, fontStyle: 'bold' }));
        const tooltip = new Konva.Label({ x: 0, y: -34, visible: false, listening: false, name: 'takeoff-marker-tooltip' });
        tooltip.add(new Konva.Tag({ fill: '#0f172a', opacity: 0.94, cornerRadius: 4, pointerDirection: 'down', pointerWidth: 8, pointerHeight: 5 }));
        tooltip.add(new Konva.Text({ text: itemName, fill: '#f8fafc', fontSize: 13, fontStyle: 'bold', padding: 7 }));
        group.add(tooltip);
        group.on('mouseenter', () => {
            tooltip.visible(true);
            tooltip.moveToTop();
            document.body.style.cursor = 'pointer';
            konvaLayer.batchDraw();
        });
        group.on('mouseleave', () => {
            tooltip.visible(false);
            document.body.style.cursor = '';
            konvaLayer.batchDraw();
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
        const transformer = new Konva.Transformer({
            nodes: [symbol],
            enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
            rotateEnabled: false,
            keepRatio: true,
            flipEnabled: false,
            borderStroke: marker.color || '#38bdf8',
            borderStrokeWidth: 1.5,
            anchorFill: '#fff',
            anchorStroke: marker.color || '#2563eb',
            anchorStrokeWidth: 2,
            anchorSize: 9,
            visible: false,
            boundBoxFunc: (oldBox, newBox) => {
                const side = Math.max(Math.abs(newBox.width), Math.abs(newBox.height));
                return side < 8 || side > 192 ? oldBox : newBox;
            }
        });
        transformer.on('transformstart', () => {
            if (isElementLocked(marker)) {
                transformer.stopTransform?.();
                return;
            }
            snapshot();
        });
        transformer.on('transformend', () => {
            if (isElementLocked(marker)) return;
            const scale = Math.max(Math.abs(symbol.scaleX()), Math.abs(symbol.scaleY()));
            const nextRadius = Math.max(4, Math.min(96, symbolRadius(marker.symbol_size || marker.size) * scale));
            symbol.scale({ x: 1, y: 1 });
            marker.symbol_size = Number(nextRadius.toFixed(4));
            marker.size = marker.symbol_size;
            marker.metadata_json = { ...(marker.metadata_json || {}), symbol_size: marker.symbol_size };
            marker.updatedAt = timestamp();
            marker.updated_at = marker.updatedAt;
            transformer.destroy();
            group.destroy();
            delete marker.node;
            delete marker.symbolNode;
            delete marker.transformer;
            createMarkerNode(marker);
            selectElement('marker', marker);
            markDirty();
        });
        konvaLayer.add(transformer);
        marker.node = group;
        marker.symbolNode = symbol;
        marker.transformer = transformer;
        applyMarkerLockVisual(marker);
        konvaLayer.batchDraw();
    }

    function refreshSegment(segment) {
        if (!segment.node) return;
        const isArea = String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area';
        segment.node.points((segment.points_json || []).flatMap(p => [p.x, p.y]));
        if (isArea) calculateAreaQuantity(segment);
        else calculateLinearLength(segment);
        const points = segment.points_json || [];
        const mid = points.length >= 2
            ? { x: (points[0].x + points[points.length - 1].x) / 2, y: (points[0].y + points[points.length - 1].y) / 2 }
            : (points[0] || { x: 0, y: 0 });
        segment.labelNode.position({ x: mid.x + 8, y: mid.y - 18 });
        segment.labelNode.text(isArea ? formatAreaLabel(segment.total_area) : formatFeetLabel(segment.total_length));
        (segment.handles || []).forEach((handle, index) => {
            if (segment.points_json[index]) handle.position(segment.points_json[index]);
        });
        konvaLayer.batchDraw();
    }

    function syncTakeoffHandleScale(inverseScale) {
        const viewportScale = Number(canvas?.viewportTransform?.[0] || 1);
        const factor = Number.isFinite(Number(inverseScale)) && Number(inverseScale) > 0
            ? Number(inverseScale)
            : (viewportScale > 0 ? 1 / viewportScale : 1);
        state.segments.forEach(segment => {
            (segment.handles || []).forEach(handle => {
                // Vertex controls are UI affordances, not drawing geometry.
                // Keep their visible and hit size usable while the PDF is fit
                // to screen and the world layer is heavily scaled down.
                handle.radius(6 * factor);
                handle.strokeWidth(2 * factor);
                handle.hitStrokeWidth(14 * factor);
            });
        });
        konvaLayer?.batchDraw();
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

    function createSegmentNode(segment) {
        if (!ensureKonva()) return;
        const visible = segment.page_number === pageNum;
        const isArea = String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area';
        const line = new Konva.Line({
            points: (segment.points_json || []).flatMap(p => [p.x, p.y]),
            stroke: segment.color || '#2563eb',
            strokeWidth: num(segment.stroke_width || (isArea ? 3 : 4)),
            closed: isArea,
            fill: isArea ? segment.color || '#2563eb' : undefined,
            opacity: isArea ? 0.28 : 1,
            hitStrokeWidth: 16,
            lineCap: 'round',
            lineJoin: 'round',
            draggable: !isElementLocked(segment),
            listening: !isTakeoffObjectInteractionBlocked(),
            visible,
        });
        const label = new Konva.Text({ fill: segment.color || '#22c55e', fontSize: 16, padding: 4, visible: false, listening: false });
        const handles = (segment.points_json || []).map((point, index) => {
            const handle = new Konva.Circle({ x: point.x, y: point.y, radius: 5, fill: '#fff', stroke: segment.color || '#2563eb', strokeWidth: 2, draggable: !isElementLocked(segment), listening: !isTakeoffObjectInteractionBlocked(), visible: false });
            handle.on('dragstart', () => snapshot());
            handle.on('dragmove', () => {
                const position = handle.position();
                segment.points_json[index] = { x: position.x, y: position.y };
                refreshSegment(segment);
            });
            handle.on('dragend', () => {
                segment.updatedAt = timestamp();
                segment.updated_at = segment.updatedAt;
                refreshSegment(segment);
                markDirty();
            });
            handle.on('dblclick dbltap', () => {
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
        line.on('click tap', event => {
            event.cancelBubble = true;
            setTool('smart');
            selectElement('segment', segment, { additive: !!event.evt?.shiftKey });
        });
        line.on('dblclick dbltap', event => {
            event.cancelBubble = true;
            const pointer = konvaStage?.getPointerPosition();
            if (pointer) insertSegmentVertex(segment, screenToWorld(pointer));
        });
        line.on('contextmenu', event => openObjectContextMenu(event, 'segment', segment));
        line.on('dragstart', () => beginTakeoffSelectionDrag('segment', segment));
        line.on('dragmove', () => updateTakeoffSelectionDrag(segment));
        line.on('dragend', () => finishTakeoffSelectionDrag(segment));
        konvaLayer.add(line, label);
        handles.forEach(handle => handle.moveToTop());
        segment.node = line;
        segment.labelNode = label;
        segment.handles = handles;
        refreshSegment(segment);
        applySegmentLockVisual(segment);
        syncTakeoffHandleScale();
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
        state.markers.forEach(createMarkerNode);
        state.segments.forEach(createSegmentNode);
        setTakeoffPage(pageNum);
    }

    function setTakeoffPage(pg) {
        if (selectionRectDraft && Number(selectionRectDraft.pageNumber) !== Number(pg)) {
            selectionRectDraft.node?.destroy();
            selectionRectDraft = null;
        }
        state.markers.forEach(m => {
            const layer = state.layers.find(l => l.client_uid === m.layer_client_uid);
            m.node && m.node.visible(m.page_number === pg && Number(layer?.visible ?? 1));
            m.transformer?.visible(m.page_number === pg && Number(layer?.visible ?? 1) && !isElementLocked(m)
                && state.selectedObjectUids.has(String(m.client_uid)));
        });
        state.segments.forEach(s => {
            const layer = state.layers.find(l => l.client_uid === s.layer_client_uid);
            const isVisible = s.page_number === pg && Number(layer?.visible ?? 1);
            if (s.node) s.node.visible(isVisible);
            if (s.labelNode) s.labelNode.visible(false);
            (s.handles || []).forEach(h => h.visible(isVisible && !isElementLocked(s)
                && state.selectedObjectUids.has(String(s.client_uid))));
        });
        if (konvaLayer) konvaLayer.batchDraw();
    }

    function selectElement(type, ref, options = {}) {
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

    function applyObjectSelectionVisuals() {
        state.markers.forEach(marker => {
            if (!marker.node) return;
            const selected = state.selectedObjectUids.has(String(marker.client_uid));
            marker.node.scale({ x: 1, y: 1 });
            marker.transformer?.visible(selected && !isElementLocked(marker) && isElementVisibleOnPage(marker));
            if (typeof marker.node.shadowEnabled === 'function') marker.node.shadowEnabled(selected);
            if (typeof marker.node.shadowColor === 'function') marker.node.shadowColor('#38bdf8');
            if (typeof marker.node.shadowBlur === 'function') marker.node.shadowBlur(selected ? 10 : 0);
        });
        state.segments.forEach(segment => {
            if (!segment.node) return;
            const selected = state.selectedObjectUids.has(String(segment.client_uid));
            (segment.handles || []).forEach(handle => handle.visible(selected && !isElementLocked(segment)
                && isElementVisibleOnPage(segment)));
            if (typeof segment.node.shadowEnabled === 'function') segment.node.shadowEnabled(selected);
            if (typeof segment.node.shadowColor === 'function') segment.node.shadowColor('#38bdf8');
            if (typeof segment.node.shadowBlur === 'function') segment.node.shadowBlur(selected ? 10 : 0);
        });
        konvaLayer?.batchDraw();
    }

    function findTakeoffObjectByUid(objectUid) {
        const uidValue = String(objectUid || '');
        const marker = state.markers.find(m => String(m.client_uid) === uidValue);
        if (marker) return { type: 'marker', ref: marker };
        const segment = state.segments.find(s => String(s.client_uid) === uidValue);
        if (segment) return { type: 'segment', ref: segment };
        return null;
    }

    function addMarker(pos) {
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
        const marker = {
            client_uid: uid(),
            layer_client_uid: layer.client_uid,
            catalog_item_id: layer.catalog_item_id || state.selectedItemId,
            assembly_id: layer.assembly_id || state.selectedAssemblyId,
            takeoff_type: 'count',
            type: 'count',
            page_number: pageNum,
            x: pos.x,
            y: pos.y,
            symbol: layer.symbol || 'circle',
            symbol_size: layer.symbol_size || 'Medium',
            size: layer.symbol_size || 'Medium',
            color: layer.color || '#2563eb',
            label: '',
            multiplier: 1,
            quantity: 1,
            notes: '',
            project_id: currentProjectId(),
            document_id: currentDocumentId(),
            sheet_id: sheetIdFor(pageNum),
            createdAt: timestamp(),
            updatedAt: timestamp(),
            metadata_json: {},
        };
        marker.created_at = marker.createdAt;
        marker.updated_at = marker.updatedAt;
        marker.quantity = calculateCountQuantity(marker);
        state.markers.push(marker);
        createMarkerNode(marker);
        selectElement('marker', marker);
        markDirty();
        finishToolUse();
    }

    function emitToolState() {
        if (!state.projectControlled) return;
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
            const vertex = new Konva.Circle({
                x: pos.x,
                y: pos.y,
                radius: 5,
                fill: '#fff',
                stroke: layer.color || '#22c55e',
                strokeWidth: 3,
                listening: false
            });
            state.draftLine = {
                points: [pos],
                layerUid: layer.client_uid,
                vertices: [vertex],
                preview: new Konva.Line({
                    points: [pos.x, pos.y, pos.x, pos.y],
                    stroke: layer.color || '#22c55e',
                    strokeWidth: 4,
                    lineCap: 'round',
                    lineJoin: 'round',
                    listening: false
                }),
                lengthLabel: new Konva.Text({
                    x: pos.x + 12,
                    y: pos.y - 28,
                    text: '',
                    fill: layer.color || '#22c55e',
                    fontSize: 14,
                    fontStyle: 'bold',
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
        const vertex = new Konva.Circle({
            x: pos.x,
            y: pos.y,
            radius: 5,
            fill: '#fff',
            stroke: layer.color || '#22c55e',
            strokeWidth: 3,
            listening: false
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
        const points = state.draftLine.points.map(point => ({ ...point }));
        const subtype = normalizeLinearSubtype(layer.takeoff_subtype || layer.original_takeoff_type || layer.takeoff_type || layer.type);
        const segment = {
            client_uid: uid(),
            layer_client_uid: layer.client_uid,
            catalog_item_id: layer.catalog_item_id || state.selectedItemId,
            assembly_id: layer.assembly_id || state.selectedAssemblyId,
            takeoff_type: 'linear',
            takeoff_subtype: subtype,
            type: 'linear',
            page_number: pageNum,
            points_json: points,
            measured_length: 0,
            drop_length: subtype === 'linear' ? 0 : Math.max(0, num(layer.drop_length ?? layer.dropLength)),
            multiplier: 1,
            total_length: 0,
            unit: 'ft',
            color: layer.color || '#2563eb',
            stroke_width: 4,
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
        selectElement('segment', segment);
        markDirty();
        updateDrawingStatus();
        finishToolUse();
        return true;
    }

    function destroyLinearDraftNodes() {
        if (!state.draftLine) return;
        state.draftLine.preview?.destroy();
        state.draftLine.lengthLabel?.destroy();
        (state.draftLine.vertices || []).forEach(vertex => vertex.destroy());
        state.draftLine = null;
        konvaLayer?.batchDraw();
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
        state.draftLine.lengthLabel?.text('');
        updateDrawingStatus();
        konvaLayer?.batchDraw();
        return true;
    }

    function addAreaPoint(pos) {
        warnMissingScale();
        const layer = activeLayer();
        if (!layer) {
            showToast('Select a takeoff layer before drawing.', 'error');
            return;
        }
        if (Number(layer.locked)) {
            showToast('Layer is locked', 'error');
            return;
        }
        if (!state.draftArea) {
            state.draftArea = {
                points: [pos],
                preview: new Konva.Line({
                    points: [pos.x, pos.y, pos.x, pos.y],
                    stroke: layer.color || '#2563eb',
                    strokeWidth: 3,
                    fill: layer.color || '#2563eb',
                    opacity: 0.28,
                    closed: true,
                    lineJoin: 'round'
                }),
            };
            konvaLayer.add(state.draftArea.preview);
            return;
        }
        state.draftArea.points.push(pos);
        state.draftArea.preview.points(state.draftArea.points.flatMap(p => [p.x, p.y]));
        konvaLayer.batchDraw();
    }

    function finishArea() {
        if (!state.draftArea || state.draftArea.points.length < 3) return;
        const layer = activeLayer();
        if (!layer) {
            showToast('Select a takeoff layer before drawing.', 'error');
            return;
        }
        snapshot();
        const segment = {
            client_uid: uid(),
            layer_client_uid: layer.client_uid,
            catalog_item_id: layer.catalog_item_id || state.selectedItemId,
            assembly_id: layer.assembly_id || state.selectedAssemblyId,
            takeoff_type: 'area',
            type: 'area',
            page_number: pageNum,
            points_json: state.draftArea.points,
            measured_area: 0,
            multiplier: 1,
            total_area: 0,
            total_length: 0,
            unit: 'sq ft',
            color: layer.color || '#2563eb',
            stroke_width: 3,
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
        state.draftArea.preview.destroy();
        state.draftArea = null;
        state.segments.push(segment);
        createSegmentNode(segment);
        selectElement('segment', segment);
        markDirty();
        finishToolUse();
    }

    function clearDrafts() {
        if (state.draftLine) destroyLinearDraftNodes();
        if (state.draftArea?.preview) state.draftArea.preview.destroy();
        state.draftArea = null;
        updateDrawingStatus();
        konvaLayer?.batchDraw();
    }

    function selectedTakeoffObjectIds() {
        const ids = new Set(Array.from(state.selectedObjectUids || []).map(String));
        if (state.selectedElement?.ref?.client_uid) ids.add(String(state.selectedElement.ref.client_uid));
        return Array.from(ids);
    }

    function deleteTakeoffSelection(objectIds = null) {
        const localIds = selectedTakeoffObjectIds();
        const requestedIds = localIds.length
            ? localIds
            : (Array.isArray(objectIds) ? objectIds.map(String) : []);
        const targets = Array.from(new Set(requestedIds)).map(findTakeoffObjectByUid).filter(Boolean);
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

    function markDirty(options = {}) {
        state.dirty = true;
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
        renderSummary();
        renderLayers();
        scheduleTakeoffAutosave();
        emitProjectState();
    }

    function layerQuantity(layer) {
        const countQty = state.markers
            .filter(marker => marker.layer_client_uid === layer.client_uid)
            .reduce((sum, marker) => sum + calculateCountQuantity(marker), 0);
        const linearQty = state.segments
            .filter(segment => segment.layer_client_uid === layer.client_uid && String(segment.takeoff_type || segment.type || '').toLowerCase() !== 'area')
            .reduce((sum, segment) => sum + calculateLinearLength(segment), 0);
        const areaQty = state.segments
            .filter(segment => segment.layer_client_uid === layer.client_uid && String(segment.takeoff_type || segment.type || '').toLowerCase() === 'area')
            .reduce((sum, segment) => sum + calculateAreaQuantity(segment), 0);
        const measured = countQty + linearQty + areaQty;
        // `layer.quantity` may already be the persisted aggregate for this
        // layer. Only an explicit seed is additive to measured geometry.
        const base = num(layer.seed_quantity ?? layer.seedQuantity ?? layer.baseQuantity ?? 0);
        return base + measured;
    }

    function layerType(layer) {
        const raw = String(layer.takeoff_type || layer.type || layer.layer_type || '').toLowerCase();
        if (['linear', 'line', 'lines', 'lf', 'ft', 'linear with drop', 'linear avg. with drop',
            'linear avg with drop', 'linear_with_drop', 'linear_avg_with_drop'].includes(raw)) return 'linear';
        if (['count', 'counts', 'point', 'points', 'ea'].includes(raw)) return 'count';
        if (['area', 'sf'].includes(raw)) return 'area';
        if (['volume', 'cy'].includes(raw)) return 'volume';
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
            catalog_item_id: layer.catalog_item_id || null,
            unit_cost: num(layer.unit_cost || 0),
            labor_hours: num(layer.unit_labor_time || layer.labor_hours || 0),
            dropLength: Math.max(0, num(layer.drop_length ?? layer.dropLength)),
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
                    return {
                        id: segment.client_uid,
                        projectId: String(segment.project_id || currentProjectId()),
                        layerId: layer.client_uid,
                        documentId: String(segment.document_id || currentDocumentId()),
                        sheetId: segment.sheet_id || sheetIdFor(segment.page_number),
                        pageNumber: segment.page_number,
                        type: isArea ? 'Area' : 'Linear',
                        points: segment.points_json || [],
                        color: segment.color,
                        size: segment.symbol_size || segment.size || layer.symbol_size || 'Medium',
                        quantityValue: isArea ? calculateAreaQuantity(segment) : calculateLinearLength(segment),
                        uom: layerUnit(layer),
                        createdAt: segment.createdAt || segment.created_at || null,
                        updatedAt: segment.updatedAt || segment.updated_at || null
                    };
                })
            ]
        };
    }

    function projectSnapshot() {
        return {
            drawingId: typeof fileId !== 'undefined' ? fileId : null,
            drawing_id: typeof fileId !== 'undefined' ? fileId : null,
            projectId: typeof projectId !== 'undefined' ? projectId : 0,
            activeLayerId: state.selectedLayerUid,
            layers: state.layers.map(projectLayerPayload),
            summary: calculateTakeoffSummary()
        };
    }

    function emitProjectState() {
        if (!state.projectControlled) return;
        try {
            window.parent?.postMessage({ type: 'project-takeoff-state', payload: projectSnapshot() }, '*');
        } catch (e) {}
    }

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

    function deleteLayer(layer) {
        if (!layer || !confirm('Delete this takeoff layer and its measurements?')) return;
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

    function duplicateLayer(layer) {
        if (!layer) return;
        snapshot();
        const copyUid = uid();
        const copy = { ...layer, client_uid: copyUid, name: `${layer.name} Copy`, metadata_json: { ...(layer.metadata_json || {}), project_layer_id: copyUid } };
        state.layers.push(copy);
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
        snapshot();
        layer.name = name.trim() || layer.name;
        layer.group_name = group.trim() || 'Ungrouped';
        layer.takeoff_type = prompt('Takeoff type: count, linear, area, volume, lump_sum', layerType(layer)) || layerType(layer);
        layer.unit_of_measure = prompt('Unit of measure', layerUnit(layer)) || layerUnit(layer);
        markDirty({ pageFallback: true });
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
        if (targetLayer && previousType && previousType !== layerType(targetLayer)) {
            clearIncompatibleMeasurements(targetLayer, layerType(targetLayer));
        }
        state.createCatalogItemId = null;
        closeCreateLayerModal();
        if (targetLayer) activateLayerForInsert(targetLayer.client_uid);
        markDirty({ pageFallback: true });
        renderAll();
    }

    function clearIncompatibleMeasurements(layer, nextType) {
        if (nextType === 'linear') {
            state.markers.filter(marker => marker.layer_client_uid === layer.client_uid).forEach(destroyMarkerNodes);
            state.markers = state.markers.filter(marker => marker.layer_client_uid !== layer.client_uid);
        } else if (nextType === 'count') {
            state.segments.filter(segment => segment.layer_client_uid === layer.client_uid).forEach(destroySegmentNodes);
            state.segments = state.segments.filter(segment => segment.layer_client_uid !== layer.client_uid);
        }
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
            document.getElementById('takeoffCreateUom').value = item.unit_of_measure || 'ea';
            document.getElementById('takeoffCreateColor').value = item.color || '#2563eb';
            document.getElementById('takeoffCreateSymbol').value = item.symbol || 'circle';
            if (!document.getElementById('takeoffCreateType').value) {
                document.getElementById('takeoffCreateType').value = item.unit_of_measure === 'ft' || item.unit_of_measure === 'lf' ? 'linear' : 'count';
            }
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
        if (tool === 'takeoff_linear' && !requirePlanScale('linear')) return false;
        window.releaseTakeoffPointerState?.();
        if (tool !== 'multi-select' && selectionRectDraft) {
            selectionRectDraft.node?.destroy();
            selectionRectDraft = null;
            konvaLayer?.batchDraw();
        }
        const leavingLinear = state.tool === 'takeoff_linear' && tool !== 'takeoff_linear';
        if (leavingLinear && state.draftLine) finishLinear();
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
                setMode('smart');
                ensureKonva();
                bindKonva();
                if (typeof setKonvaActive === 'function') setKonvaActive(true);
            }
            clearDrafts();
            konvaStage.container().style.cursor = 'default';
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
                ...state.markers.filter(marker => marker.page_number === pageNum && marker.node?.visible())
                    .filter(marker => Konva.Util.haveIntersection(rect, marker.node.getClientRect({ relativeTo: konvaLayer })))
                    .map(marker => ({ type: 'marker', ref: marker })),
                ...state.segments.filter(segment => segment.page_number === pageNum && segment.node?.visible())
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
            const layer = activeLayer();
            if (!layer) {
                showToast('Select a takeoff layer before drawing.', 'error');
                return;
            }
            const activeType = layerType(layer);
            if (activeType === 'linear' && state.tool !== 'takeoff_linear') {
                setTool('takeoff_linear');
            }
            if (activeType === 'area' && state.tool !== 'takeoff_area') {
                setTool('takeoff_area');
            }
            if (activeType !== 'linear' && activeType !== 'area' && state.tool !== 'takeoff_count') {
                setTool('takeoff_count');
            }
            const pos = konvaStage.getPointerPosition();
            const world = screenToWorld(pos);
            if (layerType(layer) === 'linear') addLinearPoint(world);
            else if (layerType(layer) === 'area') addAreaPoint(world);
            else addMarker(world);
        });
        konvaStage.on('dblclick dbltap', () => {
            if (state.tool === 'takeoff_linear') finishLinear();
            if (state.tool === 'takeoff_area') finishArea();
        });
        konvaStage.on('mousemove touchmove', () => {
            const pos = konvaStage.getPointerPosition();
            if (!pos) return;
            const world = screenToWorld(pos);
            if (state.tool === 'takeoff_linear' && state.draftLine?.preview && state.draftLine.points.length) {
                state.draftLine.preview.points([...state.draftLine.points, world].flatMap(p => [p.x, p.y]));
                const last = state.draftLine.points[state.draftLine.points.length - 1];
                const partial = pointsLength([last, world]);
                const total = pointsLength(state.draftLine.points) + partial;
                state.draftLine.lengthLabel.position({ x: world.x + 12, y: world.y - 28 });
                state.draftLine.lengthLabel.text(`${formatFeetLabel(partial)} · Σ ${formatFeetLabel(total)}`);
                updateDrawingStatus(world);
                konvaLayer.batchDraw();
            }
            if (state.tool === 'takeoff_area' && state.draftArea?.preview && state.draftArea.points.length) {
                state.draftArea.preview.points([...state.draftArea.points, world].flatMap(p => [p.x, p.y]));
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
        el.innerHTML = `<div class="takeoff-list">${state.layers.map(l => `<div class="takeoff-list-item ${l.client_uid === state.selectedLayerUid ? 'active' : ''}" data-layer-uid="${l.client_uid}">
            <div class="takeoff-list-title"><span style="color:${l.color}">●</span> ${escapeHtml(l.name)}</div>
            <div class="takeoff-list-meta">Page ${l.page_number} · ${escapeHtml(l.type)}</div>
        </div>`).join('') || '<div class="takeoff-list-meta">No layers yet.</div>'}</div>`;
        el.querySelectorAll('[data-layer-uid]').forEach(row => row.addEventListener('click', () => {
            state.selectedLayerUid = row.dataset.layerUid;
            renderLayers();
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
        const groupOrder = ['Lighting', 'Controls'];
        const sortedGroups = Object.keys(groups).sort((a, b) => {
            const ai = groupOrder.indexOf(a);
            const bi = groupOrder.indexOf(b);
            if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            return a.localeCompare(b);
        });
        el.innerHTML = `<div class="takeoff-layer-groups">${sortedGroups.map(group => {
            const collapsed = state.collapsedGroups.has(group);
            const rows = groups[group];
            const groupQty = rows.reduce((sum, layer) => sum + layerQuantity(layer), 0);
            return `<div class="takeoff-layer-group">
                <button class="takeoff-layer-group-head" data-layer-group="${escapeHtml(group)}">
                    <i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i>
                    <span>${escapeHtml(group)}</span>
                    <small>${rows.length} | ${groupQty.toFixed(2)}</small>
                </button>
                <div ${collapsed ? 'hidden' : ''}>
                    ${rows.map(l => `<div class="takeoff-list-item takeoff-layer-row ${l.client_uid === state.selectedLayerUid ? 'active' : ''}" data-layer-uid="${l.client_uid}">
                        <input type="checkbox" class="takeoff-layer-check" data-layer-check="${l.client_uid}" ${state.selectedLayerUids.has(l.client_uid) ? 'checked' : ''}>
                        ${layerSymbol(l)}
                        <div class="takeoff-layer-copy">
                            <div class="takeoff-list-title">${escapeHtml(l.name)}</div>
                            <div class="takeoff-list-meta">Page ${l.page_number || pageNum} | ${escapeHtml(layerType(l))} | ${layerQuantity(l).toFixed(2)} ${escapeHtml(layerUnit(l))}</div>
                        </div>
                        <div class="takeoff-layer-actions">
                            <button class="takeoff-mini-btn" data-layer-action="visible" data-layer-uid="${l.client_uid}" title="Show/hide"><i class="fas fa-eye${Number(l.visible) ? '' : '-slash'}"></i></button>
                            <button class="takeoff-mini-btn" data-layer-action="lock" data-layer-uid="${l.client_uid}" title="Lock"><i class="fas fa-${Number(l.locked) ? 'lock' : 'lock-open'}"></i></button>
                            <button class="takeoff-mini-btn" data-layer-action="menu" data-layer-uid="${l.client_uid}" title="Actions"><i class="fas fa-ellipsis-vertical"></i></button>
                        </div>
                    </div>`).join('')}
                </div>
            </div>`;
        }).join('') || '<div class="takeoff-list-meta">No layers yet.</div>'}</div>`;
        el.querySelectorAll('[data-layer-group]').forEach(btn => btn.addEventListener('click', () => {
            const group = btn.dataset.layerGroup;
            if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group);
            else state.collapsedGroups.add(group);
            renderLayers();
        }));
        el.querySelectorAll('[data-layer-uid]').forEach(row => row.addEventListener('click', () => {
            state.selectedLayerUid = row.dataset.layerUid;
            renderLayers();
        }));
        el.querySelectorAll('[data-layer-check]').forEach(box => {
            box.addEventListener('click', event => event.stopPropagation());
            box.addEventListener('change', () => {
                if (box.checked) state.selectedLayerUids.add(box.dataset.layerCheck);
                else state.selectedLayerUids.delete(box.dataset.layerCheck);
            });
        });
        el.querySelectorAll('[data-layer-action]').forEach(btn => btn.addEventListener('click', event => {
            event.stopPropagation();
            const layer = state.layers.find(row => row.client_uid === btn.dataset.layerUid);
            if (!layer) return;
            const action = btn.dataset.layerAction;
            if (action === 'visible') {
                snapshot();
                layer.visible = Number(layer.visible) ? 0 : 1;
                setTakeoffPage(pageNum);
                markDirty();
                renderLayers();
            }
            if (action === 'lock') {
                snapshot();
                layer.locked = Number(layer.locked) ? 0 : 1;
                markDirty();
                renderLayers();
            }
            if (action === 'menu') {
                const choice = prompt('Action: edit, duplicate, delete, color, symbol', 'edit');
                if (!choice) return;
                const selectedAction = choice.trim().toLowerCase();
                if (selectedAction === 'edit') editLayer(layer);
                if (selectedAction === 'duplicate') duplicateLayer(layer);
                if (selectedAction === 'delete') deleteLayer(layer);
                if (selectedAction === 'color') {
                    const color = prompt('Hex color', layer.color || '#2563eb');
                    if (color) {
                        snapshot();
                        layer.color = color;
                        markDirty();
                        renderAll();
                    }
                }
                if (selectedAction === 'symbol') {
                    const symbol = prompt('Symbol: circle, square, diamond, triangle, cross, line', layer.symbol || 'circle');
                    if (symbol) {
                        snapshot();
                        layer.symbol = symbol;
                        markDirty();
                        renderAll();
                    }
                }
            }
        }));
    }

    function renderLayers() {
        const el = document.getElementById('takeoffLayersTab');
        if (!el) return;
        const countEl = document.getElementById('takeoffLayerCount');
        if (countEl) countEl.textContent = String(75);

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
                activateLayerForInsert(box.dataset.layerCheck);
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

    function deleteLayerWithoutConfirm(layer) {
        const removedObjects = [
            ...state.markers.filter(marker => marker.layer_client_uid === layer.client_uid).map(ref => ({ type: 'marker', ref })),
            ...state.segments.filter(segment => segment.layer_client_uid === layer.client_uid).map(ref => ({ type: 'segment', ref }))
        ];
        trackTakeoffObjects(removedObjects, true);
        removedObjects.filter(target => target.type === 'marker').forEach(target => destroyMarkerNodes(target.ref));
        removedObjects.filter(target => target.type === 'segment').forEach(target => destroySegmentNodes(target.ref));
        state.markers = state.markers.filter(marker => marker.layer_client_uid !== layer.client_uid);
        state.segments = state.segments.filter(segment => segment.layer_client_uid !== layer.client_uid);
        state.layers = state.layers.filter(row => row !== layer);
        state.selectedLayerUids.delete(layer.client_uid);
        if (state.selectedLayerUid === layer.client_uid) state.selectedLayerUid = state.layers[0]?.client_uid || null;
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

    function activateLayerForInsert(uidValue) {
        const layer = state.layers.find(row => row.client_uid === uidValue);
        if (!layer) return;
        if (state.draftLine && state.draftLine.layerUid !== layer.client_uid) finishLinear();
        state.selectedLayerUid = layer.client_uid;
        state.selectedLayerUids = new Set([layer.client_uid]);
        const type = layerType(layer);
        if ((type === 'linear' || type === 'area') && !hasPlanScale()) {
            if (type === 'linear') {
                requirePlanScale('linear');
                setTool('smart');
                renderLayers();
                emitProjectState();
                return false;
            }
            warnMissingScale();
        }
        setTool(type === 'linear' ? 'takeoff_linear' : (type === 'area' ? 'takeoff_area' : 'takeoff_count'));
        showToast(`${layer.name} active`, 'success');
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
        const name = prompt('Layer name', layer.name || '');
        if (!name) return;
        snapshot();
        layer.name = name.trim() || layer.name;
        markDirty();
        renderAll();
    }

    function renameGroup(group) {
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

    function deleteGroup(group) {
        const layers = state.layers.filter(layer => layerGroup(layer) === group);
        if (!layers.length || !confirm('Delete this takeoff group and all layers?')) return;
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
                        <div class="takeoff-field"><label>Stroke width</label><input id="takeoffPropStroke" type="number" min="1" max="20" step="1" value="${num(ref.stroke_width || (isArea ? 3 : 4))}" ${locked ? 'disabled' : ''}></div>
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
                ref.stroke_width = Math.max(1, Math.min(20, num(document.getElementById('takeoffPropStroke').value || 4)));
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
        el.innerHTML = `<div class="takeoff-summary-head"><div class="takeoff-title">Summary</div><div class="takeoff-list-meta">${rows.length} rows${state.dirty ? ' - unsaved' : ''}</div></div>
            <div class="takeoff-summary-table-wrap"><table>
            <thead><tr><th>Item</th><th>Assembly</th><th>Type</th><th>Unit</th><th>Qty</th><th>Unit Cost</th><th>Labor Hours</th><th>Material</th><th>Labor</th><th>Total</th><th>Waste</th><th>Markup</th></tr></thead>
            <tbody>${rows.map(r => `<tr><td>${escapeHtml(r.item)}</td><td>${escapeHtml(r.assembly)}</td><td>${r.type}</td><td>${escapeHtml(r.unit)}</td><td>${r.quantity.toFixed(2)}</td><td>${money(r.unitCost)}</td><td>${r.laborHours.toFixed(2)}</td><td>${money(r.material)}</td><td>${money(r.labor)}</td><td>${money(r.total)}</td><td>${num(r.waste).toFixed(2)}</td><td>${money(r.markup)}</td></tr>`).join('')}</tbody>
            </table></div>`;
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

    function saveTakeoff(silent = false, rejectOnError = false) {
        state.layers.forEach(persistLayerCostSnapshot);
        const sentPages = dirtyTakeoffPages.size ? [...dirtyTakeoffPages] : [Number(pageNum || 1)];
        const sentGenerations = new Map(sentPages.map(page => [page, dirtyTakeoffPageGenerations.get(page) || 0]));
        const sentObjectIds = Array.from(new Set([...dirtyTakeoffObjects.keys(), ...deletedTakeoffObjects.keys()]));
        const sentObjectGenerations = new Map(sentObjectIds.map(id => [id, dirtyTakeoffObjectGenerations.get(id) || 0]));
        const objectBaseVersions = Object.fromEntries(sentObjectIds.map(id => [id, takeoffObjectBaseVersions.get(id) ?? null]));
        // Object patches are more precise than the page fallback. A page is
        // included only for layer/global edits that could not be attributed to
        // stable geometry IDs.
        const fallbackPages = dirtyTakeoffPages.size ? [...dirtyTakeoffPages] : (sentObjectIds.length ? [] : sentPages);
        return request('save_state', {
            drawing_id: fileId,
            project_id: typeof projectId !== 'undefined' ? projectId : 0,
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
                    drop_length: Math.max(0, num(segment.drop_length ?? segment.dropLength)) }
            })),
            summary: calculateTakeoffSummary(),
            dirty_page_numbers: fallbackPages,
            dirty_object_ids: [...dirtyTakeoffObjects.keys()],
            deleted_object_ids: [...deletedTakeoffObjects.keys()],
            object_base_versions: objectBaseVersions,
        }).then(res => {
            if (res.status !== 'success') throw new Error(res.msg || 'Save failed');
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
            state.dirty = dirtyTakeoffPages.size > 0 || dirtyTakeoffObjects.size > 0 || deletedTakeoffObjects.size > 0;
            if (!silent) showToast('Takeoff saved', 'success');
            renderSummary();
        }).catch(err => {
            if (!silent) showToast(err.message, 'error');
            else console.warn('Takeoff autosave failed', err);
            if (rejectOnError) throw err;
        });
    }

    function loadTakeoff() {
        return Promise.all([
            request('bootstrap', {}, 'GET'),
            request('state', { drawing_id: fileId }, 'GET'),
        ]).then(([boot, loaded]) => {
            if (boot.status === 'success') {
                state.catalog = boot.catalog || state.catalog;
                state.assemblies = boot.assemblies || state.assemblies;
            }
            if (loaded.status === 'success') {
                const data = loaded.data || {};
                const dbLayerIdMap = new Map();
                state.layers = (data.layers || []).map(l => {
                    const metadata = l.metadata_json || {};
                    const stableUid = String(metadata.project_layer_id || l.client_uid || l.id);
                    dbLayerIdMap.set(String(l.id), stableUid);
                    return restoreLayerCostSnapshot({ ...l, client_uid: stableUid, metadata_json: { ...metadata, project_layer_id: stableUid } });
                });
                state.markers = (data.markers || []).map(m => ({ ...m, client_uid: m.client_uid || String(m.id), layer_client_uid: String(m.layer_client_uid || dbLayerIdMap.get(String(m.layer_id)) || m.layer_id || ''), metadata_json: m.metadata_json || {}, symbol_size: m.symbol_size ?? m.metadata_json?.symbol_size ?? m.size, size: m.symbol_size ?? m.metadata_json?.symbol_size ?? m.size, locked: Number(m.locked ?? m.metadata_json?.element_locked ?? 0), _serverUpdatedAt: m.updated_at || m.updatedAt || null }));
                state.segments = (data.segments || []).map(s => ({ ...s, client_uid: s.client_uid || String(s.id), layer_client_uid: String(s.layer_client_uid || dbLayerIdMap.get(String(s.layer_id)) || s.layer_id || ''), points_json: s.points_json || [], metadata_json: s.metadata_json || {}, takeoff_subtype: s.takeoff_subtype || s.metadata_json?.takeoff_subtype || 'linear', drop_length: Math.max(0, num(s.drop_length ?? s.metadata_json?.drop_length)), locked: Number(s.locked ?? s.metadata_json?.element_locked ?? 0), _serverUpdatedAt: s.updated_at || s.updatedAt || null }));
            }
            if (!state.selectedItemId && state.catalog.items[0]) state.selectedItemId = state.catalog.items[0].id;
            const onlyLegacyDefault = state.layers.length === 1
                && String(state.layers[0].name || '').toLowerCase() === 'default takeoff'
                && !state.markers.length
                && !state.segments.length;
            if (!state.layers.length || onlyLegacyDefault || isLegacyTemplateSeed()) {
                state.layers = [];
                seedTemplateLayers();
            }
            renderNodes();
            renderAll();
        }).catch(err => {
            console.error(err);
            showToast('Takeoff could not load. Run takeoff_mysql_schema.sql first.', 'error');
            renderAll();
        });
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
            if (e.key === 'Escape') {
                e.preventDefault();
                state.continuousTool = false;
                clearDrafts();
                setTool('smart');
                clearTakeoffSelection();
                return;
            }
            if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
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
                    copy.x = num(copy.x) + 18;
                    copy.y = num(copy.y) + 18;
                    state.markers.push(copy);
                    createMarkerNode(copy);
                    selectElement('marker', copy);
                } else {
                    copy.points_json = (copy.points_json || []).map(p => ({ x: p.x + 18, y: p.y + 18 }));
                    state.segments.push(copy);
                    createSegmentNode(copy);
                    selectElement('segment', copy);
                }
                markDirty();
            }
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
    };

    window.syncTakeoffInteractionScale = syncTakeoffHandleScale;

    window.projectTakeoffActivateLayer = function (payload) {
        if (!payload?.id) return null;
        state.projectControlled = true;
        const externalId = String(payload.id);
        let layer = state.layers.find(row => row.client_uid === externalId || row.metadata_json?.project_layer_id === externalId);
        const normalizedType = String(payload.takeoff_type || payload.type || 'count').toLowerCase();
        const normalizedLayerType = normalizeEditorLayerType(normalizedType);
        const type = normalizedLayerType.type;
        const data = {
            client_uid: externalId,
            page_number: pageNum || 1,
            name: payload.name || 'Takeoff Layer',
            type,
            takeoff_type: type,
            takeoff_subtype: normalizedLayerType.subtype,
            original_takeoff_type: normalizedType,
            drop_length: Math.max(0, num(payload.drop_length ?? payload.dropLength)),
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
            visible: payload.visible === false ? 0 : 1,
            locked: payload.locked ? 1 : 0,
            metadata_json: { ...(layer?.metadata_json || {}), project_layer_id: externalId },
        };
        if (layer) Object.assign(layer, data);
        else {
            layer = data;
            state.layers.push(layer);
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
            let layer = state.layers.find(row => row.client_uid === externalId || row.metadata_json?.project_layer_id === externalId);
            const normalizedType = String(payload.takeoff_type || payload.type || 'count').toLowerCase();
            const normalizedLayerType = normalizeEditorLayerType(normalizedType);
            const type = normalizedLayerType.type;
            const data = {
                client_uid: externalId,
                page_number: pageNum || 1,
                name: payload.name || 'Takeoff Layer',
                type,
                takeoff_type: type,
                takeoff_subtype: normalizedLayerType.subtype,
                original_takeoff_type: normalizedType,
                drop_length: Math.max(0, num(payload.drop_length ?? payload.dropLength)),
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
                visible: payload.visible === false ? 0 : 1,
                locked: payload.locked ? 1 : 0,
                metadata_json: { ...(layer?.metadata_json || {}), project_layer_id: externalId },
            };
            if (layer) Object.assign(layer, data);
            else state.layers.push(data);
        });
        setTakeoffPage(pageNum);
        renderLayers();
        emitProjectState();
        return projectSnapshot();
    };

    window.projectTakeoffClearActiveLayer = function () {
        state.projectControlled = true;
        state.selectedLayerUid = null;
        state.selectedLayerUids.clear();
        state.continuousTool = false;
        setTool('select');
        renderLayers();
        emitProjectState();
        showToast('Active layer cleared', 'success');
    };

    window.projectTakeoffSetLayerVisibility = function (layerId, visible) {
        const layer = state.layers.find(row => row.client_uid === String(layerId) || row.metadata_json?.project_layer_id === String(layerId));
        if (!layer) return false;
        layer.visible = visible ? 1 : 0;
        setTakeoffPage(pageNum);
        renderLayers();
        emitProjectState();
        scheduleTakeoffAutosave();
        return true;
    };

    window.projectTakeoffDeleteLayer = function (layerId) {
        const layer = state.layers.find(row => row.client_uid === String(layerId) || row.metadata_json?.project_layer_id === String(layerId));
        if (!layer) return false;
        deleteLayerWithoutConfirm(layer);
        markDirty();
        renderAll();
        return true;
    };

    window.projectTakeoffSnapshot = function () {
        return projectSnapshot();
    };

    window.projectTakeoffSetTool = function (tool) {
        const normalized = String(tool || '').toLowerCase();
        if (normalized === 'pan') {
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
        if (normalized === 'linear') return setTool('takeoff_linear');
        if (normalized === 'area') return setTool('takeoff_area');
        if (normalized === 'count') return setTool('takeoff_count');
        return setTool('smart');
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
        const layer = state.layers.find(row => String(row.client_uid) === String(layerId) || String(row.metadata_json?.project_layer_id) === String(layerId));
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
        const layer = state.layers.find(row => String(row.client_uid) === String(layerId) || String(row.metadata_json?.project_layer_id) === String(layerId));
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
            || String(row.metadata_json?.project_layer_id || '') === layerKey);
        const targets = [
            ...state.markers.filter(marker => String(marker.layer_client_uid) === layerKey),
            ...state.segments.filter(segment => String(segment.layer_client_uid) === layerKey)
        ];
        if (!layer) return false;
        snapshot();
        if (patch.symbol !== undefined) layer.symbol = normalizeSymbol(patch.symbol);
        if (patch.color !== undefined) layer.color = String(patch.color);
        if (patch.symbolSize !== undefined) layer.symbol_size = Math.max(4, Math.min(96, num(patch.symbolSize)));
        if (patch.strokeWidth !== undefined) layer.stroke_width = Math.max(1, Math.min(20, num(patch.strokeWidth)));
        targets.forEach(ref => {
            if (isElementLocked(ref)) return;
            const marker = state.markers.includes(ref);
            if (patch.color !== undefined) ref.color = String(patch.color);
            if (marker) {
                if (patch.symbol !== undefined) ref.symbol = normalizeSymbol(patch.symbol);
                if (patch.symbolSize !== undefined) {
                    ref.symbol_size = Math.max(4, Math.min(96, num(patch.symbolSize)));
                    ref.size = ref.symbol_size;
                }
                ref.metadata_json = { ...(ref.metadata_json || {}),
                    symbol_size: ref.symbol_size,
                    diameter: Math.max(8, Math.min(192, num(patch.diameter || ref.symbol_size * 2))) };
                destroyMarkerNodes(ref);
                createMarkerNode(ref);
            } else {
                if (patch.strokeWidth !== undefined) ref.stroke_width = Math.max(1, Math.min(20, num(patch.strokeWidth)));
                ref.metadata_json = { ...(ref.metadata_json || {}), thickness: ref.stroke_width };
                ref.node?.stroke(String(ref.color || layer.color));
                ref.node?.strokeWidth(ref.stroke_width);
                refreshSegment(ref);
            }
            ref.updatedAt = timestamp();
            ref.updated_at = ref.updatedAt;
        });
        applyObjectSelectionVisuals();
        trackTakeoffObjects(targets.map(ref => ({ type: state.markers.includes(ref) ? 'marker' : 'segment', ref })));
        markDirty({ objectsTracked: true });
        renderProperties();
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
        return saveTakeoff(true, true);
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
                copy.x = num(target.ref.x) + 16;
                copy.y = num(target.ref.y) + 16;
                state.markers.push(copy);
                createMarkerNode(copy);
            } else {
                copy.points_json = (target.ref.points_json || []).map(point => ({ x: point.x + 16, y: point.y + 16 }));
                state.segments.push(copy);
                createSegmentNode(copy);
            }
            return copy;
        });
        state.selectedElement = null;
        state.selectedObjectUids = new Set(copies.map(copy => String(copy.client_uid)));
        applyObjectSelectionVisuals();
        renderProperties();
        markDirty();
        return copies.map(copy => String(copy.client_uid));
    };

    window.projectTakeoffSetZoom = function (percent) {
        if (!canvas || typeof canvas.setViewportTransform !== 'function') return null;
        const zoom = Math.max(0.25, Math.min(4, Number(percent || 100) / 100));
        const center = typeof canvas.getVpCenter === 'function'
            ? canvas.getVpCenter()
            : { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 };
        if (typeof canvas.zoomToPoint === 'function') canvas.zoomToPoint(center, zoom);
        else canvas.setZoom(zoom);
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

    function init() {
        renderShell();
        patchEditor();
        bindKonva();
        loadTakeoff();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
