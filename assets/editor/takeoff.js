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
        selectedElement: null,
        draftLine: null,
        undo: [],
        redo: [],
        dirty: false,
    };

    const uid = () => 'tf_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
    const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    const money = (v) => '$' + num(v).toFixed(2);

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
        return copy;
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
        state.layers.push(layer);
        state.selectedLayerUid = layer.client_uid;
        return layer;
    }

    function activeLayer() {
        return state.layers.find(l => l.client_uid === state.selectedLayerUid) || createLayer();
    }

    function calculateCountQuantity(marker) {
        return num(marker.multiplier || 1);
    }

    function calculateLinearLength(segment) {
        const points = segment.points_json || [];
        let px = 0;
        for (let index = 1; index < points.length; index++) {
            const dx = points[index].x - points[index - 1].x;
            const dy = points[index].y - points[index - 1].y;
            px += Math.sqrt(dx * dx + dy * dy);
        }
        const measured = pixelsPerFoot > 0 ? px / pixelsPerFoot : px;
        segment.measured_length = measured;
        segment.total_length = measured * num(segment.multiplier || 1);
        return segment.total_length;
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

    function drawSymbol(group, symbol, color) {
        const common = { stroke: '#fff', strokeWidth: 1.5, fill: color };
        if (symbol === 'square') group.add(new Konva.Rect({ x: -8, y: -8, width: 16, height: 16, ...common }));
        else if (symbol === 'triangle') group.add(new Konva.RegularPolygon({ sides: 3, radius: 11, ...common }));
        else if (symbol === 'diamond') group.add(new Konva.RegularPolygon({ sides: 4, radius: 11, rotation: 45, ...common }));
        else if (symbol === 'cross') {
            group.add(new Konva.Line({ points: [-9, 0, 9, 0], stroke: color, strokeWidth: 4 }));
            group.add(new Konva.Line({ points: [0, -9, 0, 9], stroke: color, strokeWidth: 4 }));
        } else {
            group.add(new Konva.Circle({ radius: 9, ...common }));
        }
    }

    function createMarkerNode(marker) {
        if (!ensureKonva()) return;
        const group = new Konva.Group({ x: num(marker.x), y: num(marker.y), draggable: true, visible: marker.page_number === pageNum });
        drawSymbol(group, marker.symbol || 'circle', marker.color || '#2563eb');
        group.add(new Konva.Text({ x: 12, y: -10, text: marker.label || String(marker.quantity || ''), fill: marker.color || '#2563eb', fontSize: 14, fontStyle: 'bold' }));
        group.on('click tap', () => selectElement('marker', marker));
        group.on('dragend', () => {
            snapshot();
            marker.x = group.x();
            marker.y = group.y();
            markDirty();
        });
        konvaLayer.add(group);
        marker.node = group;
        konvaLayer.batchDraw();
    }

    function refreshSegment(segment) {
        if (!segment.node) return;
        segment.node.points((segment.points_json || []).flatMap(p => [p.x, p.y]));
        calculateLinearLength(segment);
        const mid = segment.points_json[Math.floor((segment.points_json.length - 1) / 2)] || { x: 0, y: 0 };
        segment.labelNode.position({ x: mid.x + 8, y: mid.y - 18 });
        segment.labelNode.text(`${segment.total_length.toFixed(2)} ${segment.unit || 'ft'}`);
        (segment.handles || []).forEach((handle, index) => {
            if (segment.points_json[index]) handle.position(segment.points_json[index]);
        });
        konvaLayer.batchDraw();
    }

    function destroySegmentNodes(segment) {
        if (segment.node) segment.node.destroy();
        if (segment.labelNode) segment.labelNode.destroy();
        (segment.handles || []).forEach(h => h.destroy());
        delete segment.node;
        delete segment.labelNode;
        delete segment.handles;
    }

    function createSegmentNode(segment) {
        if (!ensureKonva()) return;
        const visible = segment.page_number === pageNum;
        const line = new Konva.Line({
            points: (segment.points_json || []).flatMap(p => [p.x, p.y]),
            stroke: segment.color || '#2563eb',
            strokeWidth: num(segment.stroke_width || 4),
            lineCap: 'round',
            lineJoin: 'round',
            draggable: true,
            visible,
        });
        const label = new Konva.Text({ fill: segment.color || '#2563eb', fontSize: 14, padding: 3, visible });
        const handles = (segment.points_json || []).map((point, index) => {
            const handle = new Konva.Circle({ x: point.x, y: point.y, radius: 5, fill: '#fff', stroke: segment.color || '#2563eb', strokeWidth: 2, draggable: true, visible: false });
            handle.on('dragmove', () => {
                segment.points_json[index] = handle.position();
                refreshSegment(segment);
            });
            handle.on('dragend', () => {
                snapshot();
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
            konvaLayer.add(handle);
            return handle;
        });
        line.on('click tap', () => selectElement('segment', segment));
        line.on('dragend', () => {
            snapshot();
            const dx = line.x();
            const dy = line.y();
            segment.points_json = segment.points_json.map(p => ({ x: p.x + dx, y: p.y + dy }));
            line.position({ x: 0, y: 0 });
            refreshSegment(segment);
            markDirty();
        });
        konvaLayer.add(line, label);
        segment.node = line;
        segment.labelNode = label;
        segment.handles = handles;
        refreshSegment(segment);
    }

    function clearNodes() {
        state.markers.forEach(m => m.node && m.node.destroy());
        state.segments.forEach(destroySegmentNodes);
    }

    function renderNodes() {
        state.markers.forEach(createMarkerNode);
        state.segments.forEach(createSegmentNode);
        setTakeoffPage(pageNum);
    }

    function setTakeoffPage(pg) {
        state.markers.forEach(m => {
            const layer = state.layers.find(l => l.client_uid === m.layer_client_uid);
            m.node && m.node.visible(m.page_number === pg && Number(layer?.visible ?? 1));
        });
        state.segments.forEach(s => {
            const layer = state.layers.find(l => l.client_uid === s.layer_client_uid);
            const isVisible = s.page_number === pg && Number(layer?.visible ?? 1);
            if (s.node) s.node.visible(isVisible);
            if (s.labelNode) s.labelNode.visible(isVisible);
            (s.handles || []).forEach(h => h.visible(s.page_number === pg && state.selectedElement?.ref === s));
        });
        if (konvaLayer) konvaLayer.batchDraw();
    }

    function selectElement(type, ref) {
        state.selectedElement = { type, ref };
        state.segments.forEach(s => (s.handles || []).forEach(h => h.visible(type === 'segment' && ref === s)));
        renderProperties();
        if (konvaLayer) konvaLayer.batchDraw();
    }

    function addMarker(pos) {
        snapshot();
        const layer = activeLayer();
        if (Number(layer.locked)) {
            showToast('Layer is locked', 'error');
            return;
        }
        const marker = {
            client_uid: uid(),
            layer_client_uid: layer.client_uid,
            catalog_item_id: state.selectedItemId,
            assembly_id: state.selectedAssemblyId,
            page_number: pageNum,
            x: pos.x,
            y: pos.y,
            symbol: layer.symbol || 'circle',
            color: layer.color || '#2563eb',
            label: '',
            multiplier: 1,
            quantity: 1,
            notes: '',
            metadata_json: {},
        };
        marker.quantity = calculateCountQuantity(marker);
        state.markers.push(marker);
        createMarkerNode(marker);
        selectElement('marker', marker);
        markDirty();
    }

    function addLinearPoint(pos) {
        if (!state.draftLine) {
            state.draftLine = {
                points: [pos],
                preview: new Konva.Line({ points: [pos.x, pos.y], stroke: '#38bdf8', strokeWidth: 3, dash: [8, 6], lineCap: 'round', lineJoin: 'round' }),
            };
            konvaLayer.add(state.draftLine.preview);
            return;
        }
        state.draftLine.points.push(pos);
        state.draftLine.preview.points(state.draftLine.points.flatMap(p => [p.x, p.y]));
        konvaLayer.batchDraw();
    }

    function finishLinear() {
        if (!state.draftLine || state.draftLine.points.length < 2) return;
        snapshot();
        const layer = activeLayer();
        if (Number(layer.locked)) {
            showToast('Layer is locked', 'error');
            return;
        }
        const segment = {
            client_uid: uid(),
            layer_client_uid: layer.client_uid,
            catalog_item_id: state.selectedItemId,
            assembly_id: state.selectedAssemblyId,
            page_number: pageNum,
            points_json: state.draftLine.points,
            measured_length: 0,
            multiplier: 1,
            total_length: 0,
            unit: 'ft',
            color: layer.color || '#2563eb',
            stroke_width: 4,
            label: '',
            metadata_json: {},
        };
        calculateLinearLength(segment);
        state.draftLine.preview.destroy();
        state.draftLine = null;
        state.segments.push(segment);
        createSegmentNode(segment);
        selectElement('segment', segment);
        markDirty();
    }

    function deleteSelected() {
        if (!state.selectedElement) return;
        snapshot();
        const { type, ref } = state.selectedElement;
        if (type === 'marker') {
            if (ref.node) ref.node.destroy();
            state.markers = state.markers.filter(m => m !== ref);
        } else {
            destroySegmentNodes(ref);
            state.segments = state.segments.filter(s => s !== ref);
        }
        state.selectedElement = null;
        renderProperties();
        markDirty();
    }

    function markDirty() {
        state.dirty = true;
        renderSummary();
        renderLayers();
    }

    function layerQuantity(layer) {
        const countQty = state.markers
            .filter(marker => marker.layer_client_uid === layer.client_uid)
            .reduce((sum, marker) => sum + calculateCountQuantity(marker), 0);
        const linearQty = state.segments
            .filter(segment => segment.layer_client_uid === layer.client_uid)
            .reduce((sum, segment) => sum + calculateLinearLength(segment), 0);
        const measured = countQty + linearQty;
        return measured || num(layer.quantity || layer.seed_quantity || 0);
    }

    function layerType(layer) {
        return layer.takeoff_type || layer.type || 'mixed';
    }

    function layerUnit(layer) {
        return layer.unit_of_measure || (layerType(layer) === 'linear' ? 'ft' : 'ea');
    }

    function layerGroup(layer) {
        return layer.group_name || layer.tag || 'Ungrouped';
    }

    function layerSymbol(layer) {
        const symbol = layer.symbol || 'circle';
        const color = layer.color || '#2563eb';
        return `<span class="takeoff-layer-symbol ${escapeHtml(symbol)}" style="background:${escapeHtml(color)}"></span>`;
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
        state.markers.filter(marker => marker.layer_client_uid === layer.client_uid).forEach(marker => marker.node && marker.node.destroy());
        state.segments.filter(segment => segment.layer_client_uid === layer.client_uid).forEach(destroySegmentNodes);
        state.markers = state.markers.filter(marker => marker.layer_client_uid !== layer.client_uid);
        state.segments = state.segments.filter(segment => segment.layer_client_uid !== layer.client_uid);
        state.layers = state.layers.filter(row => row !== layer);
        if (state.selectedLayerUid === layer.client_uid) state.selectedLayerUid = state.layers[0]?.client_uid || null;
        state.selectedLayerUids.delete(layer.client_uid);
        state.selectedElement = null;
        markDirty();
        renderAll();
    }

    function duplicateLayer(layer) {
        if (!layer) return;
        snapshot();
        const copy = { ...layer, client_uid: uid(), name: `${layer.name} Copy` };
        state.layers.push(copy);
        state.selectedLayerUid = copy.client_uid;
        markDirty();
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
        markDirty();
        renderAll();
    }

    function createLayerFromPrompt() {
        openCreateLayerModal();
    }

    function openCreateLayerModal(layer = null) {
        state.createLayerMode = layer;
        state.createCatalogItemId = layer?.catalog_item_id || null;
        const item = state.createCatalogItemId ? state.catalog.items.find(row => String(row.id) === String(state.createCatalogItemId)) : null;
        document.getElementById('takeoffCreateName').value = layer?.name || item?.name || '';
        document.getElementById('takeoffCreateType').value = layerType(layer || {}) === 'mixed' ? 'count' : layerType(layer || {});
        document.getElementById('takeoffCreateUom').value = layer?.unit_of_measure || item?.unit_of_measure || '';
        document.getElementById('takeoffCreateSymbol').value = layer?.symbol || item?.symbol || 'circle';
        document.getElementById('takeoffCreateSize').value = layer?.symbol_size || 'Medium';
        document.getElementById('takeoffCreateColor').value = layer?.color || item?.color || '#2563eb';
        document.getElementById('takeoffCreateGroup').value = layerGroup(layer || item || {});
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
        const type = document.getElementById('takeoffCreateType')?.value;
        const uom = document.getElementById('takeoffCreateUom')?.value.trim();
        const button = document.getElementById('takeoffCreateSubmit');
        if (button) button.disabled = !(name && type && uom);
    }

    function updateCreateMeta(item, layer = null) {
        const el = document.getElementById('takeoffCreateMeta');
        if (!el) return;
        const source = item || layer;
        if (!source) {
            el.innerHTML = 'No catalog item selected. This layer will be created as a manual takeoff layer.';
            return;
        }
        el.innerHTML = `
            <span>Unit Cost: <strong>${money(source.unit_cost || layer?.unit_cost || 0)}</strong></span>
            <span>Labor Time: <strong>${num(source.labor_hours || layer?.unit_labor_time || 0).toFixed(2)}</strong></span>
            <span>Cost Code: <strong>${escapeHtml(source.cost_code || layer?.cost_code || '-')}</strong></span>
        `;
    }

    function submitCreateLayerModal() {
        const item = state.createCatalogItemId ? state.catalog.items.find(row => String(row.id) === String(state.createCatalogItemId)) : null;
        const payload = {
            name: document.getElementById('takeoffCreateName').value.trim(),
            takeoff_type: document.getElementById('takeoffCreateType').value,
            type: document.getElementById('takeoffCreateType').value,
            unit_of_measure: document.getElementById('takeoffCreateUom').value.trim(),
            symbol: document.getElementById('takeoffCreateSymbol').value,
            symbol_size: document.getElementById('takeoffCreateSize').value,
            color: document.getElementById('takeoffCreateColor').value || '#2563eb',
            group_name: document.getElementById('takeoffCreateGroup').value.trim() || item?.group_name || 'Ungrouped',
            catalog_item_id: item?.id || null,
            unit_cost: item?.unit_cost || 0,
            unit_labor_time: item?.labor_hours || 0,
            cost_code: item?.cost_code || '',
        };
        if (!payload.name || !payload.takeoff_type || !payload.unit_of_measure) return;
        snapshot();
        if (state.createLayerMode) {
            Object.assign(state.createLayerMode, payload);
            state.selectedLayerUid = state.createLayerMode.client_uid;
        } else {
            createLayer(payload);
        }
        state.createCatalogItemId = null;
        closeCreateLayerModal();
        markDirty();
        renderAll();
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
            document.getElementById('takeoffCreateGroup').value = item.group_name || item.catalog_name || 'Ungrouped';
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
                state.markers.filter(marker => marker.layer_client_uid === layer.client_uid).forEach(marker => marker.node && marker.node.destroy());
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
        state.tool = tool;
        if (tool === 'takeoff_count' || tool === 'takeoff_linear') {
            if (typeof setMode === 'function') setMode('smart');
            ensureKonva();
            bindKonva();
            if (konvaStage?.container()) konvaStage.container().style.cursor = 'crosshair';
            showToast(tool === 'takeoff_count' ? 'Count tool active' : 'Linear tool active. Double-click to finish.', 'success');
        } else if (konvaStage?.container()) {
            konvaStage.container().style.cursor = 'default';
        }
        document.querySelectorAll('[data-takeoff-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.takeoffTool === tool));
    }

    function bindKonva() {
        if (!ensureKonva() || konvaStage._takeoffBound) return;
        konvaStage._takeoffBound = true;
        konvaStage.on('click tap', evt => {
            if (state.tool !== 'takeoff_count' && state.tool !== 'takeoff_linear') return;
            if (evt.target !== konvaStage && evt.target.getParent() !== konvaLayer) return;
            const pos = konvaStage.getPointerPosition();
            const world = screenToWorld(pos);
            if (state.tool === 'takeoff_count') addMarker(world);
            if (state.tool === 'takeoff_linear') addLinearPoint(world);
        });
        konvaStage.on('dblclick dbltap', () => {
            if (state.tool === 'takeoff_linear') finishLinear();
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
                    <div class="takeoff-title"><i class="fas fa-layer-group me-1"></i>Takeoffs (<span id="takeoffLayerCount">0</span>)</div>
                    <button class="takeoff-icon-btn" id="takeoffNewLayerTop" title="Create takeoff layer"><i class="fas fa-plus"></i></button>
                </div>
                <div class="takeoff-panel-section">
                    <div class="takeoff-tool-row">
                        <button class="takeoff-icon-btn active" data-takeoff-tool="select" title="Select"><i class="fas fa-mouse-pointer"></i></button>
                        <button class="takeoff-icon-btn" data-takeoff-tool="takeoff_count" title="Count"><i class="fas fa-location-dot"></i></button>
                        <button class="takeoff-icon-btn" data-takeoff-tool="takeoff_linear" title="Linear"><i class="fas fa-route"></i></button>
                        <button class="takeoff-icon-btn" id="takeoffDelete" title="Delete"><i class="fas fa-trash"></i></button>
                        <button class="takeoff-icon-btn" id="takeoffUndo" title="Undo"><i class="fas fa-undo"></i></button>
                        <button class="takeoff-icon-btn" id="takeoffRedo" title="Redo"><i class="fas fa-redo"></i></button>
                    </div>
                </div>
                <div class="takeoff-panel-section">
                    <div class="takeoff-field mb-2"><label>Search</label><input id="takeoffLayerSearch" placeholder="Layer, group, catalog item"></div>
                    <div class="takeoff-filter-row">
                        <select id="takeoffLayerGroupFilter"><option value="">All groups</option></select>
                        <select id="takeoffLayerTypeFilter"><option value="">All types</option></select>
                    </div>
                    <div class="takeoff-tool-row">
                        <button class="takeoff-command" data-layer-bulk="show"><i class="fas fa-eye me-1"></i>Show</button>
                        <button class="takeoff-command" data-layer-bulk="hide"><i class="fas fa-eye-slash me-1"></i>Hide</button>
                        <button class="takeoff-command" data-layer-bulk="lock"><i class="fas fa-lock me-1"></i>Lock</button>
                        <button class="takeoff-command" data-layer-bulk="move"><i class="fas fa-folder-open me-1"></i>Move</button>
                        <button class="takeoff-command" data-layer-bulk="estimate"><i class="fas fa-calculator me-1"></i>Estimate</button>
                        <button class="takeoff-command" data-layer-bulk="delete"><i class="fas fa-trash me-1"></i>Delete</button>
                    </div>
                </div>
                <div class="takeoff-panel-section">
                    <div class="takeoff-tabs">
                        <button class="takeoff-tab active" data-takeoff-tab="layers">Layers</button>
                        <button class="takeoff-tab" data-takeoff-tab="catalog">Catalog</button>
                        <button class="takeoff-tab" data-takeoff-tab="assemblies">Assemblies</button>
                    </div>
                </div>
                <div class="takeoff-panel-body">
                    <div id="takeoffLayersTab" class="takeoff-panel-section"></div>
                    <div id="takeoffCatalogTab" class="takeoff-panel-section takeoff-hidden"></div>
                    <div id="takeoffAssembliesTab" class="takeoff-panel-section takeoff-hidden"></div>
                </div>
                <div class="takeoff-panel-section">
                    <button class="takeoff-command primary" id="takeoffSave"><i class="fas fa-save me-1"></i>Save Takeoff</button>
                    <button class="takeoff-command" id="takeoffNewLayer"><i class="fas fa-layer-group me-1"></i>Layer</button>
                </div>
            </section>
            <section class="takeoff-props" id="takeoffProps"></section>
            <section class="takeoff-summary" id="takeoffSummary"></section>
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
                                <button class="takeoff-command" id="takeoffBrowseCatalog" type="button">Browse Catalog</button>
                            </div>
                        </div>
                        <div class="takeoff-grid-2">
                            <div class="takeoff-field"><label>Takeoff Type</label><select id="takeoffCreateType">
                                <option value="">Select type</option><option value="count">Count</option><option value="linear">Linear</option><option value="area">Area</option><option value="volume">Volume</option><option value="lump_sum">Lump Sum</option>
                            </select></div>
                            <div class="takeoff-field"><label>UOM</label><input id="takeoffCreateUom" placeholder="ea, ft, lf, sf, cy, lot"></div>
                        </div>
                        <div class="takeoff-grid-2">
                            <div class="takeoff-field"><label>Symbol</label><select id="takeoffCreateSymbol">
                                <option value="circle">Circle</option><option value="square">Square</option><option value="diamond">Diamond</option><option value="triangle">Triangle</option><option value="cross">Cross</option><option value="line">Line</option>
                            </select></div>
                            <div class="takeoff-field"><label>Size</label><select id="takeoffCreateSize"><option>Small</option><option selected>Medium</option><option>Large</option></select></div>
                        </div>
                        <div class="takeoff-grid-2">
                            <div class="takeoff-field"><label>Color</label><input id="takeoffCreateColor" type="color" value="#2563eb"></div>
                            <div class="takeoff-field"><label>Group</label><input id="takeoffCreateGroup" placeholder="Lighting, Controls, Gear"></div>
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
        `;
        wrapper.appendChild(root);
        root.querySelectorAll('[data-takeoff-tool]').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.takeoffTool)));
        root.querySelectorAll('[data-takeoff-tab]').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.takeoffTab)));
        document.getElementById('takeoffDelete').addEventListener('click', deleteSelected);
        document.getElementById('takeoffNewLayer').addEventListener('click', createLayerFromPrompt);
        document.getElementById('takeoffNewLayerTop').addEventListener('click', createLayerFromPrompt);
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
        document.getElementById('takeoffLayerSearch').addEventListener('input', event => {
            state.layerSearch = event.target.value;
            renderLayers();
        });
        document.getElementById('takeoffLayerGroupFilter').addEventListener('change', event => {
            state.layerGroupFilter = event.target.value;
            renderLayers();
        });
        document.getElementById('takeoffLayerTypeFilter').addEventListener('change', event => {
            state.layerTypeFilter = event.target.value;
            renderLayers();
        });
        root.querySelectorAll('[data-layer-bulk]').forEach(btn => btn.addEventListener('click', () => applyLayerBulk(btn.dataset.layerBulk)));
        document.getElementById('takeoffSave').addEventListener('click', saveTakeoff);
        document.getElementById('takeoffUndo').addEventListener('click', () => {
            if (!state.undo.length) return;
            state.redo.push(JSON.stringify({ layers: state.layers, markers: state.markers.map(stripNodes), segments: state.segments.map(stripNodes) }));
            restore(state.undo.pop());
        });
        document.getElementById('takeoffRedo').addEventListener('click', () => {
            if (!state.redo.length) return;
            state.undo.push(JSON.stringify({ layers: state.layers, markers: state.markers.map(stripNodes), segments: state.segments.map(stripNodes) }));
            restore(state.redo.pop());
        });
    }

    function activateTab(tab) {
        document.querySelectorAll('[data-takeoff-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.takeoffTab === tab));
        document.getElementById('takeoffCatalogTab').classList.toggle('takeoff-hidden', tab !== 'catalog');
        document.getElementById('takeoffAssembliesTab').classList.toggle('takeoff-hidden', tab !== 'assemblies');
        document.getElementById('takeoffLayersTab').classList.toggle('takeoff-hidden', tab !== 'layers');
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
        el.innerHTML = `<div class="takeoff-layer-groups">${Object.keys(groups).sort().map(group => {
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
        if (countEl) countEl.textContent = String(state.layers.length);
        renderLayerFilterOptions();

        const groups = {};
        filteredLayers().forEach(layer => {
            const group = layerGroup(layer);
            if (!groups[group]) groups[group] = [];
            groups[group].push(layer);
        });

        el.innerHTML = `<div class="takeoff-layer-groups">${Object.keys(groups).sort().map(group => {
            const collapsed = state.collapsedGroups.has(group);
            const rows = groups[group];
            const groupQty = rows.reduce((sum, layer) => sum + layerQuantity(layer), 0);
            return `<div class="takeoff-layer-group">
                <div class="takeoff-layer-group-head">
                    <button class="takeoff-group-toggle" data-layer-group="${escapeHtml(group)}">
                        <i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i>
                    </button>
                    <span>${escapeHtml(group)}</span>
                    <small>${rows.length} layers</small>
                    <strong>${groupQty.toFixed(2)}</strong>
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
            handleGroupAction(btn.dataset.groupName);
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
                renderLayers();
            });
        });

        el.querySelectorAll('[data-layer-action]').forEach(btn => btn.addEventListener('click', event => {
            event.stopPropagation();
            const layer = state.layers.find(row => row.client_uid === btn.dataset.layerUid);
            if (!layer) return;
            handleLayerAction(btn.dataset.layerAction, layer);
        }));
    }

    function renderLayerRow(layer) {
        const qty = layerQuantity(layer);
        const visible = Number(layer.visible) !== 0;
        const locked = Number(layer.locked) === 1;
        const selected = layer.client_uid === state.selectedLayerUid;
        const checked = state.selectedLayerUids.has(layer.client_uid);
        return `<div class="takeoff-layer-row ${selected ? 'active' : ''} ${locked ? 'locked' : ''}" data-layer-uid="${layer.client_uid}">
            <input type="checkbox" class="takeoff-layer-check" data-layer-check="${layer.client_uid}" ${checked ? 'checked' : ''}>
            <button class="takeoff-layer-eye ${visible ? '' : 'off'}" data-layer-action="visible" data-layer-uid="${layer.client_uid}" title="Show/hide">
                <i class="fas fa-eye${visible ? '' : '-slash'}"></i>
            </button>
            <div class="takeoff-layer-mark">
                ${layerSymbol(layer)}
            </div>
            <div class="takeoff-layer-copy">
                <div class="takeoff-layer-name">${escapeHtml(layer.name)}</div>
                <div class="takeoff-layer-linked">${escapeHtml(layerLinkedName(layer))}</div>
                <div class="takeoff-layer-meta">${escapeHtml(layerTypeLabel(layer))} | ${escapeHtml(layerUnit(layer))} | Page ${layer.page_number || pageNum}</div>
            </div>
            <div class="takeoff-layer-qty">${qty.toFixed(2)}</div>
            <button class="takeoff-mini-btn ${locked ? 'active' : ''}" data-layer-action="lock" data-layer-uid="${layer.client_uid}" title="Lock">
                <i class="fas fa-${locked ? 'lock' : 'lock-open'}"></i>
            </button>
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
        state.markers.filter(marker => marker.layer_client_uid === layer.client_uid).forEach(marker => marker.node && marker.node.destroy());
        state.segments.filter(segment => segment.layer_client_uid === layer.client_uid).forEach(destroySegmentNodes);
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

    function findCatalogItemByName(name) {
        const normalized = String(name).toLowerCase();
        return state.catalog.items.find(item => String(item.name || '').toLowerCase() === normalized)
            || state.catalog.items.find(item => String(item.name || '').toLowerCase().includes(normalized.split('"')[0].trim()))
            || null;
    }

    function seedTemplateLayers() {
        const seeds = [
            ['Lighting', 'Lighting Fixture "A"', 0, 'count', 'ea', '#ef4444', 'square'],
            ['Lighting', 'Lighting Fixture "B"', 15, 'count', 'ea', '#f97316', 'circle'],
            ['Lighting', 'Lighting Fixture "C"', 0, 'count', 'ea', '#eab308', 'diamond'],
            ['Lighting', 'Lighting Fixture "D"', 0, 'count', 'ea', '#22c55e', 'triangle'],
            ['Lighting', 'Lighting Fixture "Y"', 8, 'count', 'ea', '#06b6d4', 'circle'],
            ['Lighting', 'Lighting Fixture "E"', 26, 'count', 'ea', '#8b5cf6', 'square'],
            ['Lighting', 'Lighting Package Lump Sum', 0, 'lump_sum', 'lot', '#64748b', 'diamond'],
            ['Controls', 'Ceiling Mounted Occupancy Sensor "OS"', 0, 'count', 'ea', '#38bdf8', 'circle'],
            ['Controls', 'Wall Occupancy Sensor Switch Dual Tech', 0, 'count', 'ea', '#0ea5e9', 'square'],
            ['Controls', 'Dimmer Switch', 0, 'count', 'ea', '#6366f1', 'circle'],
            ['Controls', 'Dimmer Switch 3-way', 0, 'count', 'ea', '#a855f7', 'circle'],
            ['Controls', 'Power Pack', 0, 'count', 'ea', '#14b8a6', 'square'],
            ['Gear', 'Panelboard', 0, 'count', 'ea', '#f59e0b', 'square'],
            ['Rough-in', 'EMT Conduit 1/2 inch', 0, 'linear', 'ft', '#94a3b8', 'line'],
            ['Overhead Lighting', 'Lighting Branch Circuit', 0, 'linear', 'ft', '#38bdf8', 'line'],
            ['Overhead Power', 'Power Branch Circuit', 0, 'linear', 'ft', '#f43f5e', 'line'],
            ['Underground', 'Underground Feeder', 0, 'linear', 'ft', '#84cc16', 'line'],
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

    function renderProperties() {
        const el = document.getElementById('takeoffProps');
        if (!el) return;
        if (!state.selectedElement) {
            el.innerHTML = '<div class="takeoff-panel-header"><div class="takeoff-title">Properties</div></div><div class="takeoff-panel-section"><div class="takeoff-list-meta">Select a marker or line.</div></div>';
            return;
        }
        const { type, ref } = state.selectedElement;
        el.innerHTML = `
            <div class="takeoff-panel-header"><div class="takeoff-title">Properties</div><span class="takeoff-list-meta">${type}</span></div>
            <div class="takeoff-panel-section">
                <div class="takeoff-field"><label>Label</label><input id="takeoffPropLabel" value="${escapeHtml(ref.label || '')}"></div>
                <div class="takeoff-grid-2">
                    <div class="takeoff-field"><label>Multiplier</label><input id="takeoffPropMultiplier" type="number" step="0.01" value="${escapeHtml(ref.multiplier || 1)}"></div>
                    <div class="takeoff-field"><label>${type === 'marker' ? 'Quantity' : 'Length'}</label><input disabled value="${type === 'marker' ? num(ref.quantity).toFixed(2) : num(ref.total_length).toFixed(2)}"></div>
                </div>
                <div class="takeoff-field"><label>Notes</label><textarea id="takeoffPropNotes" rows="3">${escapeHtml(ref.notes || '')}</textarea></div>
            </div>`;
        const update = () => {
            snapshot();
            ref.label = document.getElementById('takeoffPropLabel').value;
            ref.multiplier = num(document.getElementById('takeoffPropMultiplier').value || 1);
            ref.notes = document.getElementById('takeoffPropNotes').value;
            if (type === 'marker') {
                ref.quantity = calculateCountQuantity(ref);
                ref.node?.findOne('Text')?.text(ref.label || String(ref.quantity || ''));
            } else {
                calculateLinearLength(ref);
                refreshSegment(ref);
            }
            markDirty();
            renderProperties();
        };
        ['takeoffPropLabel', 'takeoffPropMultiplier', 'takeoffPropNotes'].forEach(id => document.getElementById(id).addEventListener('change', update));
    }

    function renderSummary() {
        const rows = calculateTakeoffSummary();
        const el = document.getElementById('takeoffSummary');
        if (!el) return;
        el.innerHTML = `<div class="takeoff-summary-head"><div class="takeoff-title">Summary</div><div class="takeoff-list-meta">${rows.length} rows${state.dirty ? ' · unsaved' : ''}</div></div>
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
    }

    function saveTakeoff() {
        return request('save_state', {
            drawing_id: fileId,
            project_id: typeof projectId !== 'undefined' ? projectId : 0,
            layers: state.layers,
            markers: state.markers.map(stripNodes),
            segments: state.segments.map(stripNodes),
            summary: calculateTakeoffSummary(),
        }).then(res => {
            if (res.status !== 'success') throw new Error(res.msg || 'Save failed');
            state.dirty = false;
            showToast('Takeoff saved', 'success');
            renderSummary();
        }).catch(err => showToast(err.message, 'error'));
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
                state.layers = (data.layers || []).map(l => ({ ...l, client_uid: String(l.id), metadata_json: l.metadata_json || {} }));
                state.markers = (data.markers || []).map(m => ({ ...m, client_uid: m.client_uid || String(m.id), layer_client_uid: String(m.layer_id), metadata_json: m.metadata_json || {} }));
                state.segments = (data.segments || []).map(s => ({ ...s, client_uid: s.client_uid || String(s.id), layer_client_uid: String(s.layer_id), points_json: s.points_json || [], metadata_json: s.metadata_json || {} }));
            }
            if (!state.selectedItemId && state.catalog.items[0]) state.selectedItemId = state.catalog.items[0].id;
            const onlyLegacyDefault = state.layers.length === 1
                && String(state.layers[0].name || '').toLowerCase() === 'default takeoff'
                && !state.markers.length
                && !state.segments.length;
            if (!state.layers.length || onlyLegacyDefault) {
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
            if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            if (e.key === 'Escape' && state.draftLine) {
                state.draftLine.preview.destroy();
                state.draftLine = null;
                konvaLayer?.batchDraw();
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

    window.takeoffServices = {
        calculateCountQuantity,
        calculateLinearLength,
        calculateAssemblyQuantity,
        calculateAssemblyCost,
        calculateItemCost,
        calculateLaborHours,
        calculateTakeoffSummary,
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
