(function () {
    const apiUrl = '../api/takeoff_layers.php';
    const projectId = Number(window.EstimateProjectId || new URLSearchParams(window.location.search).get('project_id') || new URLSearchParams(window.location.search).get('id') || 0);
    let state = { layers: [], catalogItems: [], estimateItems: [] };
    let editingId = null;

    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[ch]));

    const money = value => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2
    }).format(Number(value || 0));

    function request(action, payload = {}) {
        return fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, project_id: projectId, ...payload })
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
        fetch(`${apiUrl}?action=list&project_id=${encodeURIComponent(projectId)}`)
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.msg || 'Could not load estimate');
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function render() {
        renderSummary();
        renderRows();
        renderSelectors();
    }

    function renderSummary() {
        const items = state.estimateItems || [];
        const subtotal = items.reduce((sum, item) => sum + Number(item.subtotal_cost || 0), 0);
        const total = items.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
        const labor = items.reduce((sum, item) => sum + Number(item.labor_hours || 0), 0);
        const locked = items.filter(item => Number(item.is_quantity_locked_from_takeoff) === 1).length;
        document.getElementById('emSummary').innerHTML = `
            <div class="em-stat"><span>Items</span><strong>${items.length}</strong></div>
            <div class="em-stat"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
            <div class="em-stat"><span>Total</span><strong>${money(total)}</strong></div>
            <div class="em-stat"><span>Labor Hours</span><strong>${labor.toFixed(2)}</strong><small>${locked} takeoff-synced</small></div>
        `;
    }

    function renderRows() {
        const body = document.getElementById('emItemsBody');
        body.innerHTML = (state.estimateItems || []).map(item => `
            <tr>
                <td>
                    <strong>${esc(item.name)}</strong>
                    <small>${esc(item.description || item.takeoff_layer_name || item.catalog_item_name || '')}</small>
                </td>
                <td><span class="em-pill">${esc(labelSource(item.source_type))}</span>${Number(item.is_quantity_locked_from_takeoff) ? '<br><small>Quantity locked</small>' : ''}</td>
                <td>${esc(item.budget_code || '-')}</td>
                <td>${esc(item.cost_type || '-')}</td>
                <td>${formatQty(item.quantity)}</td>
                <td>${esc(item.unit_of_measure || 'ea')}</td>
                <td>${money(item.unit_cost)}</td>
                <td>${Number(item.unit_labor_time || 0).toFixed(4)}</td>
                <td>${money(item.total_cost)}</td>
                <td>
                    <div class="em-row-actions">
                        <button class="em-btn" data-em-action="edit" data-id="${item.id}">Edit</button>
                        <button class="em-btn danger" data-em-action="delete" data-id="${item.id}">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="10">No estimate items yet.</td></tr>';
        body.querySelectorAll('[data-em-action]').forEach(button => {
            button.addEventListener('click', () => rowAction(button.dataset.emAction, Number(button.dataset.id)));
        });
    }

    function renderSelectors() {
        const takeoff = document.getElementById('emTakeoffLayer');
        const catalog = document.getElementById('emCatalogItem');
        takeoff.innerHTML = '<option value="">Select takeoff layer</option>' + (state.layers || []).map(layer => `
            <option value="${layer.id}">${esc(layer.name)} | ${formatQty(layer.quantity)} ${esc(layer.unit_of_measure || '')}</option>
        `).join('');
        catalog.innerHTML = '<option value="">Select catalog item</option>' + (state.catalogItems || []).map(item => `
            <option value="${item.id}" data-type="${esc(item.item_type || '')}">${esc(item.name)} | ${esc(item.item_type || 'material')} | ${money(item.unit_cost)}</option>
        `).join('');
        updateSourceUi();
    }

    function rowAction(action, id) {
        const item = state.estimateItems.find(row => Number(row.id) === Number(id));
        if (!item) return;
        if (action === 'edit') openModal(item);
        if (action === 'delete' && confirm('Delete this estimate item?')) request('delete_estimate_item', { id });
    }

    function openModal(item = null) {
        editingId = item ? Number(item.id) : null;
        document.getElementById('emModalTitle').textContent = item ? 'Edit Estimate Item' : 'Add Estimate Item';
        document.getElementById('emSourceType').value = item ? (item.source_type || 'manual') : 'manual';
        document.getElementById('emTakeoffLayer').value = item ? (item.takeoff_layer_id || '') : '';
        document.getElementById('emCatalogItem').value = item ? (item.catalog_item_id || '') : '';
        document.getElementById('emName').value = item ? item.name : '';
        document.getElementById('emDescription').value = item ? (item.description || '') : '';
        document.getElementById('emBudgetCode').value = item ? (item.budget_code || '') : '';
        document.getElementById('emCostType').value = item ? (item.cost_type || '') : '';
        document.getElementById('emQuantity').value = item ? Number(item.quantity || 0) : 1;
        document.getElementById('emUom').value = item ? (item.unit_of_measure || 'ea') : 'ea';
        document.getElementById('emUnitCost').value = item ? Number(item.unit_cost || 0) : 0;
        document.getElementById('emUnitLaborTime').value = item ? Number(item.unit_labor_time || 0) : 0;
        document.getElementById('emWaste').value = item ? Number(item.waste_percentage || 0) : 0;
        document.getElementById('emMargin').value = item ? Number(item.margin_percentage || 0) : 0;
        document.getElementById('emTaxable').value = item ? String(item.taxable ?? 1) : '1';
        document.getElementById('emGroup').value = item ? (item.group_name || '') : '';
        updateSourceUi();
        document.getElementById('emItemModal').classList.add('open');
    }

    function closeModal() {
        editingId = null;
        document.getElementById('emItemModal').classList.remove('open');
    }

    function saveItem(event) {
        event.preventDefault();
        const payload = {
            id: editingId,
            source_type: document.getElementById('emSourceType').value,
            takeoff_layer_id: Number(document.getElementById('emTakeoffLayer').value || 0),
            catalog_item_id: Number(document.getElementById('emCatalogItem').value || 0),
            name: document.getElementById('emName').value.trim(),
            description: document.getElementById('emDescription').value.trim(),
            budget_code: document.getElementById('emBudgetCode').value.trim(),
            cost_type: document.getElementById('emCostType').value.trim(),
            quantity: Number(document.getElementById('emQuantity').value || 0),
            unit_of_measure: document.getElementById('emUom').value.trim() || 'ea',
            unit_cost: Number(document.getElementById('emUnitCost').value || 0),
            unit_labor_time: Number(document.getElementById('emUnitLaborTime').value || 0),
            waste_percentage: Number(document.getElementById('emWaste').value || 0),
            margin_percentage: Number(document.getElementById('emMargin').value || 0),
            taxable: Number(document.getElementById('emTaxable').value || 0),
            group_name: document.getElementById('emGroup').value.trim()
        };
        if (!payload.name) return showError('Cost item name is required');
        request('save_estimate_item', payload).then(() => closeModal());
    }

    function updateSourceUi() {
        const source = document.getElementById('emSourceType').value;
        const takeoffWrap = document.getElementById('emTakeoffPickerWrap');
        const catalogWrap = document.getElementById('emCatalogPickerWrap');
        const quantity = document.getElementById('emQuantity');
        takeoffWrap.style.display = source === 'takeoff' ? '' : 'none';
        catalogWrap.style.display = source === 'catalog' || source === 'assembly' ? '' : 'none';
        quantity.readOnly = source === 'takeoff';
        document.getElementById('emLockNote').textContent = source === 'takeoff'
            ? 'Quantity is locked from the selected takeoff layer.'
            : '';
        if (source === 'takeoff') preloadFromTakeoff();
        if (source === 'catalog' || source === 'assembly') preloadFromCatalog(source);
    }

    function preloadFromTakeoff() {
        const id = Number(document.getElementById('emTakeoffLayer').value || 0);
        const layer = state.layers.find(row => Number(row.id) === id);
        if (!layer) return;
        document.getElementById('emName').value = layer.name || '';
        document.getElementById('emQuantity').value = Number(layer.quantity || 0);
        document.getElementById('emUom').value = layer.unit_of_measure || 'ea';
        document.getElementById('emGroup').value = layer.group_name || '';
        document.getElementById('emCatalogItem').value = layer.catalog_item_id || '';
        const item = state.catalogItems.find(row => Number(row.id) === Number(layer.catalog_item_id));
        if (item) fillCatalogFields(item);
    }

    function preloadFromCatalog(source = null) {
        const id = Number(document.getElementById('emCatalogItem').value || 0);
        const item = state.catalogItems.find(row => Number(row.id) === id);
        if (!item) return;
        if (source === 'assembly' && item.item_type !== 'assembly') return;
        fillCatalogFields(item);
    }

    function fillCatalogFields(item) {
        document.getElementById('emName').value = item.name || '';
        document.getElementById('emDescription').value = item.description || '';
        document.getElementById('emUom').value = item.unit_of_measure || 'ea';
        document.getElementById('emUnitCost').value = Number(item.unit_cost || 0);
        document.getElementById('emUnitLaborTime').value = Number(item.labor_hours || 0);
        document.getElementById('emBudgetCode').value = item.cost_code || '';
        document.getElementById('emCostType').value = item.item_type || '';
        document.getElementById('emGroup').value = item.group_name || '';
    }

    function labelSource(value) {
        return String(value || 'manual').replace('_', ' ').replace(/\b\w/g, ch => ch.toUpperCase());
    }

    function formatQty(value) {
        const number = Number(value || 0);
        return Number.isInteger(number) ? String(number) : number.toFixed(2);
    }

    function showError(message) {
        const box = document.getElementById('emError');
        box.textContent = message;
        box.style.display = 'block';
    }

    document.getElementById('emAddItem').addEventListener('click', () => openModal());
    document.getElementById('emItemForm').addEventListener('submit', saveItem);
    document.querySelectorAll('[data-close-em-modal]').forEach(button => button.addEventListener('click', closeModal));
    document.getElementById('emSourceType').addEventListener('change', updateSourceUi);
    document.getElementById('emTakeoffLayer').addEventListener('change', preloadFromTakeoff);
    document.getElementById('emCatalogItem').addEventListener('change', () => preloadFromCatalog(document.getElementById('emSourceType').value));

    load();
})();
