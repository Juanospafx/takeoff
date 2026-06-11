(function () {
    const apiUrl = '../api/takeoff_layers.php';
    let state = { layers: [], catalogItems: [], estimateItems: [] };
    let selectedLayerId = null;
    let selectedIds = new Set();
    let collapsedGroups = new Set();
    let editingLayerId = null;
    let marks = [];

    const typeHelp = {
        count: 'Count places one symbol per click and increments quantity by one.',
        linear: 'Linear tracks measured length and uses length-based units.',
        area: 'Area tracks surface coverage and uses square units.',
        volume: 'Volume tracks cubic quantities.',
        lump_sum: 'Lump Sum creates one fixed scope item.'
    };

    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[ch]));

    function request(action, payload = {}) {
        return fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        }).then(r => r.json()).then(data => {
            if (data.status !== 'success') throw new Error(data.msg || 'Request failed');
            state = data.data || state;
            render();
            return data;
        }).catch(err => {
            showError(err.message);
            return Promise.reject(err);
        });
    }

    function load() {
        fetch(`${apiUrl}?action=list`)
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.msg || 'Could not load takeoff layers');
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function render() {
        renderFilters();
        renderGroups();
        renderSelectedLabel();
        renderCatalogResults();
    }

    function filteredLayers() {
        const search = document.getElementById('tlSearch').value.trim().toLowerCase();
        const type = document.getElementById('tlTypeFilter').value;
        const group = document.getElementById('tlGroupFilter').value;
        return state.layers.filter(layer => {
            const haystack = [
                layer.name,
                layer.group_name,
                layer.catalog_item_name,
                layer.takeoff_type,
                layer.unit_of_measure
            ].join(' ').toLowerCase();
            return (!search || haystack.includes(search)) &&
                (!type || layer.takeoff_type === type) &&
                (!group || (layer.group_name || 'Ungrouped') === group);
        });
    }

    function renderFilters() {
        const groups = Array.from(new Set(state.layers.map(layer => layer.group_name || 'Ungrouped'))).sort();
        const select = document.getElementById('tlGroupFilter');
        const current = select.value;
        select.innerHTML = '<option value="">All groups</option>' + groups.map(group => `<option value="${esc(group)}">${esc(group)}</option>`).join('');
        select.value = groups.includes(current) ? current : '';
        document.getElementById('tlLayerCount').textContent = String(state.layers.length);
    }

    function renderGroups() {
        const root = document.getElementById('tlGroups');
        const layers = filteredLayers();
        const groups = {};
        layers.forEach(layer => {
            const group = layer.group_name || 'Ungrouped';
            if (!groups[group]) groups[group] = [];
            groups[group].push(layer);
        });

        root.innerHTML = Object.keys(groups).sort().map(group => {
            const rows = groups[group];
            const collapsed = collapsedGroups.has(group);
            const total = rows.reduce((sum, layer) => sum + Number(layer.quantity || 0), 0);
            return `
                <section class="tl-group">
                    <button class="tl-group-head" data-toggle-group="${esc(group)}">
                        <i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i>
                        <strong>${esc(group)}</strong>
                        <span>${rows.length} layers | ${formatQty(total)}</span>
                    </button>
                    <div ${collapsed ? 'hidden' : ''}>
                        ${rows.map(renderLayer).join('')}
                    </div>
                </section>
            `;
        }).join('') || '<div class="tl-error">No takeoff layers match the filters.</div>';

        root.querySelectorAll('[data-toggle-group]').forEach(button => {
            button.addEventListener('click', () => {
                const group = button.dataset.toggleGroup;
                if (collapsedGroups.has(group)) collapsedGroups.delete(group);
                else collapsedGroups.add(group);
                renderGroups();
            });
        });
        root.querySelectorAll('[data-select-layer]').forEach(input => {
            input.addEventListener('click', event => event.stopPropagation());
            input.addEventListener('change', () => {
                const id = Number(input.dataset.selectLayer);
                if (input.checked) selectedIds.add(id);
                else selectedIds.delete(id);
            });
        });
        root.querySelectorAll('[data-layer-id]').forEach(row => {
            row.addEventListener('click', () => {
                selectedLayerId = Number(row.dataset.layerId);
                renderGroups();
                renderSelectedLabel();
            });
        });
        root.querySelectorAll('[data-layer-action]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                layerAction(button.dataset.layerAction, Number(button.dataset.id));
            });
        });
    }

    function renderLayer(layer) {
        const active = Number(layer.id) === Number(selectedLayerId);
        const checked = selectedIds.has(Number(layer.id));
        const visible = Number(layer.visible) === 1;
        const locked = Number(layer.locked) === 1;
        return `
            <div class="tl-layer-row ${active ? 'active' : ''} ${locked ? 'locked' : ''}" data-layer-id="${layer.id}">
                <input type="checkbox" ${checked ? 'checked' : ''} data-select-layer="${layer.id}">
                ${symbolHtml(layer)}
                <div class="tl-layer-main">
                    <strong>${esc(layer.name)}</strong>
                    <span>${esc(labelType(layer.takeoff_type))} | ${formatQty(layer.quantity)} ${esc(layer.unit_of_measure || '')}${layer.catalog_item_name ? ' | ' + esc(layer.catalog_item_name) : ''}</span>
                </div>
                <div class="tl-layer-actions">
                    <button class="tl-mini-btn" title="Show or hide" data-layer-action="visible" data-id="${layer.id}"><i class="fas fa-eye${visible ? '' : '-slash'}"></i></button>
                    <button class="tl-mini-btn" title="Lock" data-layer-action="lock" data-id="${layer.id}"><i class="fas fa-${locked ? 'lock' : 'lock-open'}"></i></button>
                    <button class="tl-mini-btn" title="More" data-layer-action="menu" data-id="${layer.id}"><i class="fas fa-ellipsis-vertical"></i></button>
                </div>
            </div>
        `;
    }

    function symbolHtml(layer) {
        const cls = esc(layer.symbol || 'circle');
        const color = esc(layer.color || '#2563eb');
        return `<span class="tl-symbol ${cls}" style="background:${color}"><span></span></span>`;
    }

    function layerAction(action, id) {
        const layer = state.layers.find(row => Number(row.id) === Number(id));
        if (!layer) return;
        if (action === 'visible') request('update_layer', { id, field: 'visible', value: Number(layer.visible) ? 0 : 1 });
        if (action === 'lock') request('update_layer', { id, field: 'locked', value: Number(layer.locked) ? 0 : 1 });
        if (action === 'menu') openLayerMenu(layer);
    }

    function openLayerMenu(layer) {
        const choice = prompt('Action: edit, duplicate, delete, move, color, symbol, sync', 'edit');
        if (!choice) return;
        const action = choice.trim().toLowerCase();
        if (action === 'edit') openLayerModal(layer);
        if (action === 'duplicate') request('duplicate_layer', { id: layer.id });
        if (action === 'delete' && confirm('Delete this takeoff layer?')) request('delete_layer', { id: layer.id });
        if (action === 'move') {
            const group = prompt('Move to group', layer.group_name || 'Ungrouped');
            if (group) request('update_layer', { id: layer.id, field: 'group_name', value: group });
        }
        if (action === 'color') {
            const color = prompt('Hex color', layer.color || '#2563eb');
            if (color) request('update_layer', { id: layer.id, field: 'color', value: color });
        }
        if (action === 'symbol') {
            const symbol = prompt('Symbol: circle, square, diamond, triangle, cross, line', layer.symbol || 'circle');
            if (symbol) request('update_layer', { id: layer.id, field: 'symbol', value: symbol });
        }
        if (action === 'sync') request('sync_layer_estimate', { id: layer.id });
    }

    function selectedLayer() {
        return state.layers.find(layer => Number(layer.id) === Number(selectedLayerId));
    }

    function renderSelectedLabel() {
        const layer = selectedLayer();
        document.getElementById('tlSelectedLabel').textContent = layer
            ? `${layer.name} | ${formatQty(layer.quantity)} ${layer.unit_of_measure || ''}`
            : 'No layer selected';
    }

    function openLayerModal(layer = null) {
        editingLayerId = layer ? Number(layer.id) : null;
        document.getElementById('tlLayerModalTitle').textContent = layer ? 'Edit Takeoff Layer' : 'Create Takeoff Layer';
        document.getElementById('tlCreateLayer').textContent = layer ? 'Save' : 'Create';
        document.getElementById('tlLayerName').value = layer ? layer.name : '';
        document.getElementById('tlLayerType').value = layer ? layer.takeoff_type : '';
        document.getElementById('tlLayerUom').value = layer ? layer.unit_of_measure : 'ea';
        document.getElementById('tlLayerGroup').value = layer ? (layer.group_name || 'Ungrouped') : 'Lighting';
        document.getElementById('tlLayerSymbol').value = layer ? (layer.symbol || 'circle') : 'circle';
        document.getElementById('tlLayerSize').value = layer ? (layer.symbol_size || 'Medium') : 'Medium';
        document.getElementById('tlLayerColor').value = layer ? (layer.color || '#2563eb') : '#2563eb';
        document.getElementById('tlLayerCatalogItemId').value = layer ? (layer.catalog_item_id || '') : '';
        updateTypeHelp();
        validateLayerForm();
        document.getElementById('tlLayerModal').classList.add('open');
    }

    function closeLayerModal() {
        document.getElementById('tlLayerModal').classList.remove('open');
        editingLayerId = null;
    }

    function saveLayer(event) {
        event.preventDefault();
        const payload = {
            id: editingLayerId,
            name: document.getElementById('tlLayerName').value.trim(),
            takeoff_type: document.getElementById('tlLayerType').value,
            unit_of_measure: document.getElementById('tlLayerUom').value.trim(),
            group_name: document.getElementById('tlLayerGroup').value.trim() || 'Ungrouped',
            symbol: document.getElementById('tlLayerSymbol').value,
            symbol_size: document.getElementById('tlLayerSize').value,
            color: document.getElementById('tlLayerColor').value,
            catalog_item_id: Number(document.getElementById('tlLayerCatalogItemId').value || 0)
        };
        request('save_layer', payload).then(() => closeLayerModal());
    }

    function validateLayerForm() {
        const valid = document.getElementById('tlLayerName').value.trim() &&
            document.getElementById('tlLayerType').value &&
            document.getElementById('tlLayerUom').value.trim();
        document.getElementById('tlCreateLayer').disabled = !valid;
    }

    function updateTypeHelp() {
        const type = document.getElementById('tlLayerType').value;
        document.getElementById('tlTypeHelp').textContent = typeHelp[type] || 'Choose how quantity will be measured.';
    }

    function renderCatalogResults() {
        const searchEl = document.getElementById('tlCatalogSearch');
        if (!searchEl) return;
        const search = searchEl.value.trim().toLowerCase();
        const items = state.catalogItems.filter(item => {
            const text = [
                item.name, item.description, item.manufacturer, item.catalog_number,
                item.cost_code, item.group_name, item.catalog_name
            ].join(' ').toLowerCase();
            return !search || text.includes(search);
        });
        document.getElementById('tlCatalogResults').innerHTML = items.map(item => `
            <div class="tl-catalog-card">
                <div>
                    <strong>${esc(item.name)}</strong>
                    <span>${esc(item.catalog_name || '-')} | ${esc(item.group_name || '-')} | ${esc(item.unit_of_measure || 'ea')} | $${Number(item.unit_cost || 0).toFixed(2)}</span>
                    <span>${esc(item.description || '')}</span>
                </div>
                <button class="tl-btn primary" data-pick-catalog="${item.id}">Select</button>
            </div>
        `).join('') || '<div class="tl-error">No catalog items found.</div>';
        document.querySelectorAll('[data-pick-catalog]').forEach(button => {
            button.addEventListener('click', () => selectCatalogItem(Number(button.dataset.pickCatalog)));
        });
    }

    function selectCatalogItem(id) {
        const item = state.catalogItems.find(row => Number(row.id) === Number(id));
        if (!item) return;
        document.getElementById('tlLayerCatalogItemId').value = item.id;
        document.getElementById('tlLayerName').value = item.name || '';
        document.getElementById('tlLayerUom').value = item.unit_of_measure || 'ea';
        document.getElementById('tlLayerColor').value = item.color || '#2563eb';
        document.getElementById('tlLayerSymbol').value = item.symbol || 'circle';
        document.getElementById('tlLayerGroup').value = item.group_name || 'Ungrouped';
        const suggested = item.item_type === 'assembly' ? 'linear' : 'count';
        if (!document.getElementById('tlLayerType').value) document.getElementById('tlLayerType').value = suggested;
        updateTypeHelp();
        validateLayerForm();
        document.getElementById('tlCatalogDrawer').classList.remove('open');
    }

    function applyGlobal(action) {
        const ids = Array.from(selectedIds);
        if (!ids.length && selectedLayerId) ids.push(selectedLayerId);
        if (!ids.length) return alert('Select one or more layers first.');
        if (action === 'delete' && !confirm('Delete selected layers?')) return;
        ids.forEach(id => {
            if (action === 'show') request('update_layer', { id, field: 'visible', value: 1 });
            if (action === 'hide') request('update_layer', { id, field: 'visible', value: 0 });
            if (action === 'lock') request('update_layer', { id, field: 'locked', value: 1 });
            if (action === 'sync') request('sync_layer_estimate', { id });
            if (action === 'delete') request('delete_layer', { id });
        });
        selectedIds.clear();
    }

    function addQuantity(delta = 1, event = null) {
        const layer = selectedLayer();
        if (!layer) return alert('Select a takeoff layer first.');
        if (Number(layer.locked)) return alert('This layer is locked.');
        const current = Number(layer.quantity || 0);
        const increment = layer.takeoff_type === 'lump_sum' ? (current > 0 ? 0 : 1) : delta;
        const next = current + increment;
        if (event) addMark(event, layer);
        request('update_layer', { id: layer.id, field: 'quantity', value: next });
    }

    function addMark(event, layer) {
        const canvas = document.getElementById('tlCanvas');
        const rect = canvas.getBoundingClientRect();
        marks.push({
            layerId: layer.id,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            color: layer.color || '#2563eb',
            symbol: layer.symbol || 'circle'
        });
        renderMarks();
    }

    function renderMarks() {
        document.getElementById('tlMarks').innerHTML = marks.map(mark => `
            <span class="tl-mark tl-symbol ${esc(mark.symbol)}" style="left:${mark.x}px;top:${mark.y}px;background:${esc(mark.color)}"></span>
        `).join('');
    }

    function formatQty(value) {
        const number = Number(value || 0);
        return Number.isInteger(number) ? String(number) : number.toFixed(2);
    }

    function labelType(value) {
        return String(value || '').replace('_', ' ').replace(/\b\w/g, ch => ch.toUpperCase());
    }

    function showError(message) {
        const box = document.getElementById('tlError');
        box.textContent = message;
        box.style.display = 'block';
    }

    document.getElementById('tlNewLayer').addEventListener('click', () => openLayerModal());
    document.getElementById('tlLayerForm').addEventListener('submit', saveLayer);
    document.querySelectorAll('[data-close-layer]').forEach(btn => btn.addEventListener('click', closeLayerModal));
    document.getElementById('tlBrowseCatalog').addEventListener('click', () => {
        document.getElementById('tlCatalogDrawer').classList.add('open');
        renderCatalogResults();
    });
    document.querySelectorAll('[data-close-catalog]').forEach(btn => btn.addEventListener('click', () => {
        document.getElementById('tlCatalogDrawer').classList.remove('open');
    }));
    ['tlLayerName', 'tlLayerType', 'tlLayerUom'].forEach(id => {
        document.getElementById(id).addEventListener('input', validateLayerForm);
        document.getElementById(id).addEventListener('change', validateLayerForm);
    });
    document.getElementById('tlLayerType').addEventListener('change', updateTypeHelp);
    document.getElementById('tlCatalogSearch').addEventListener('input', renderCatalogResults);
    document.getElementById('tlSearch').addEventListener('input', renderGroups);
    document.getElementById('tlTypeFilter').addEventListener('change', renderGroups);
    document.getElementById('tlGroupFilter').addEventListener('change', renderGroups);
    document.querySelectorAll('[data-global-action]').forEach(btn => btn.addEventListener('click', () => applyGlobal(btn.dataset.globalAction)));
    document.getElementById('tlAddMeasurement').addEventListener('click', () => addQuantity(1));
    document.getElementById('tlSyncSelected').addEventListener('click', () => {
        const layer = selectedLayer();
        if (!layer) return alert('Select a layer first.');
        request('sync_layer_estimate', { id: layer.id });
    });
    document.getElementById('tlCanvas').addEventListener('click', event => addQuantity(1, event));

    load();
})();
