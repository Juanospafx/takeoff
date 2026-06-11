(function () {
    const apiUrl = '../api/cost_catalog.php';
    let state = { catalogs: [], groups: [], items: [] };
    let selection = { view: 'all', catalogId: null, groupId: null };
    let editingItemId = null;
    let movingItemId = null;

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[ch]));

    const money = (value) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2
    }).format(Number(value || 0));

    function request(action, payload = {}) {
        return fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        }).then(r => r.json()).then(data => {
            if (data.status !== 'success') throw new Error(data.msg || 'Cost Catalog request failed');
            return data;
        });
    }

    function load() {
        const params = new URLSearchParams({ action: 'list', view: selection.view });
        if (selection.catalogId) params.set('catalog_id', selection.catalogId);
        if (selection.groupId) params.set('group_id', selection.groupId);
        return fetch(`${apiUrl}?${params.toString()}`)
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.msg || 'Cost Catalog could not load');
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function render() {
        renderTree();
        renderActions();
        renderItems();
        renderTitle();
        renderItemSelects();
    }

    function renderTitle() {
        const catalog = currentCatalog();
        const group = currentGroup();
        let title = 'All Catalog Items';
        let subtitle = 'Browse catalog items by catalog, group or subgroup.';
        if (selection.view === 'recent') {
            title = 'Most Recently Used';
            subtitle = 'Recently updated catalog items across all catalogs.';
        }
        if (catalog) {
            title = catalog.name;
            subtitle = `${catalog.item_count || 0} items - ${Number(catalog.active) ? 'Active' : 'Inactive'}`;
        }
        if (group) {
            title = group.name;
            subtitle = `${group.catalog_name} - ${group.item_count || 0} items - ${Number(group.enabled_for_projects) ? 'Enabled for projects' : 'Not enabled for projects'}`;
        }
        document.getElementById('ccTitle').textContent = title;
        document.getElementById('ccSubtitle').textContent = subtitle;
    }

    function renderTree() {
        document.querySelectorAll('[data-view]').forEach(btn => {
            btn.classList.toggle('active', selection.view === btn.dataset.view);
        });
        const root = document.getElementById('ccCatalogTree');
        root.innerHTML = state.catalogs.map(catalog => {
            const groups = state.groups.filter(group => Number(group.catalog_id) === Number(catalog.id) && !group.parent_group_id);
            return `
                <button class="cc-tree-row ${selection.catalogId === Number(catalog.id) && selection.view === 'catalog' ? 'active' : ''}" data-catalog-id="${catalog.id}">
                    <i class="fas fa-book"></i><span>${esc(catalog.name)}</span><span class="status ${Number(catalog.active) ? '' : 'off'}"></span>
                </button>
                ${groups.map(group => renderGroup(group, 'group')).join('')}
            `;
        }).join('');
        root.querySelectorAll('[data-catalog-id]').forEach(button => {
            button.addEventListener('click', () => {
                selection = { view: 'catalog', catalogId: Number(button.dataset.catalogId), groupId: null };
                load();
            });
        });
        root.querySelectorAll('[data-group-id]').forEach(button => {
            button.addEventListener('click', () => {
                selection = { view: 'group', catalogId: null, groupId: Number(button.dataset.groupId) };
                load();
            });
        });
    }

    function renderGroup(group, cls) {
        const children = state.groups.filter(row => Number(row.parent_group_id || 0) === Number(group.id));
        return `
            <button class="cc-tree-row ${cls} ${selection.groupId === Number(group.id) ? 'active' : ''}" data-group-id="${group.id}">
                <i class="fas fa-folder"></i><span>${esc(group.name)}</span><span class="status ${Number(group.active) ? '' : 'off'}"></span>
            </button>
            ${children.map(child => renderGroup(child, 'subgroup')).join('')}
        `;
    }

    function renderActions() {
        const catalog = currentCatalog();
        const group = currentGroup();
        document.getElementById('ccCatalogActions').innerHTML = `
            <button class="cc-btn" data-catalog-action="add">Add Catalog</button>
            <button class="cc-btn" data-catalog-action="rename" ${!catalog ? 'disabled' : ''}>Rename</button>
            <button class="cc-btn" data-catalog-action="copy" ${!catalog ? 'disabled' : ''}>Copy</button>
            <button class="cc-btn" data-catalog-action="move" ${!catalog ? 'disabled' : ''}>Move</button>
            <button class="cc-btn danger" data-catalog-action="delete" ${!catalog ? 'disabled' : ''}>Delete</button>
            <button class="cc-btn" data-catalog-action="active" ${!catalog ? 'disabled' : ''}>${catalog && Number(catalog.active) ? 'Deactivate' : 'Activate'}</button>
            <button class="cc-btn" data-catalog-action="enabled" ${!catalog ? 'disabled' : ''}>${catalog && Number(catalog.enabled_for_projects) ? 'Disable Projects' : 'Enable Projects'}</button>
        `;
        document.getElementById('ccGroupActions').innerHTML = `
            <button class="cc-btn" data-group-action="add">Add Group</button>
            <button class="cc-btn" data-group-action="rename" ${!group ? 'disabled' : ''}>Rename</button>
            <button class="cc-btn" data-group-action="copy" ${!group ? 'disabled' : ''}>Copy</button>
            <button class="cc-btn" data-group-action="move" ${!group ? 'disabled' : ''}>Move</button>
            <button class="cc-btn danger" data-group-action="delete" ${!group ? 'disabled' : ''}>Delete</button>
            <button class="cc-btn" data-group-action="active" ${!group ? 'disabled' : ''}>Toggle</button>
            <button class="cc-btn" data-group-action="enabled" ${!group ? 'disabled' : ''}>Enabled for projects</button>
        `;
        document.querySelectorAll('[data-catalog-action]').forEach(btn => btn.addEventListener('click', () => catalogAction(btn.dataset.catalogAction)));
        document.querySelectorAll('[data-group-action]').forEach(btn => btn.addEventListener('click', () => groupAction(btn.dataset.groupAction)));
    }

    function renderItems() {
        const body = document.getElementById('ccItemsBody');
        body.innerHTML = state.items.map(item => `
            <tr>
                <td>
                    <strong>${esc(item.name)}</strong><br>
                    <span class="cc-pill">${displayItemType(item.item_type)}</span>
                    ${item.color ? `<span class="cc-swatch" style="background:${esc(item.color)}"></span>` : ''}
                </td>
                <td>${esc(item.description || '-')}</td>
                <td>${esc(item.unit_of_measure || 'ea')}</td>
                <td>${money(item.unit_cost)}</td>
                <td>${Number(item.labor_hours || 0).toFixed(4)}</td>
                <td>${esc(item.catalog_name || '-')}</td>
                <td>${esc(item.group_name || '-')}</td>
                <td>
                    <div class="cc-row-actions">
                        <button class="cc-btn" data-item-action="edit" data-id="${item.id}">Edit</button>
                        <button class="cc-btn" data-item-action="duplicate" data-id="${item.id}">Duplicate</button>
                        <button class="cc-btn" data-item-action="move" data-id="${item.id}">Move</button>
                        <button class="cc-btn" data-item-action="assembly" data-id="${item.id}">Convert</button>
                        <button class="cc-btn" data-item-action="takeoff" data-id="${item.id}">Add to Takeoff</button>
                        <button class="cc-btn" data-item-action="history" data-id="${item.id}">History</button>
                        <button class="cc-btn danger" data-item-action="delete" data-id="${item.id}">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="8" style="color:#94a3b8;">No items in this selection.</td></tr>';

        body.querySelectorAll('[data-item-action]').forEach(button => {
            button.addEventListener('click', () => itemAction(button.dataset.itemAction, Number(button.dataset.id)));
        });
    }

    function renderItemSelects() {
        const catalogOptions = state.catalogs.map(catalog => `<option value="${catalog.id}">${esc(catalog.name)}</option>`).join('');
        document.getElementById('ccItemCatalog').innerHTML = catalogOptions;
        document.getElementById('ccMoveCatalog').innerHTML = catalogOptions;
        renderGroupSelect(document.getElementById('ccItemGroup'), Number(document.getElementById('ccItemCatalog').value || selection.catalogId || 0));
        renderGroupSelect(document.getElementById('ccMoveGroup'), Number(document.getElementById('ccMoveCatalog').value || selection.catalogId || 0));
    }

    function renderGroupSelect(select, catalogId, selectedId = '') {
        const groups = state.groups.filter(group => Number(group.catalog_id) === Number(catalogId));
        select.innerHTML = '<option value="">No group</option>' + groups.map(group => `<option value="${group.id}" ${Number(selectedId) === Number(group.id) ? 'selected' : ''}>${esc(group.name)}</option>`).join('');
    }

    function displayItemType(type) {
        return type === 'part' ? 'material' : esc(type || 'material');
    }

    function currentCatalog() {
        return selection.catalogId ? state.catalogs.find(row => Number(row.id) === Number(selection.catalogId)) : null;
    }

    function currentGroup() {
        return selection.groupId ? state.groups.find(row => Number(row.id) === Number(selection.groupId)) : null;
    }

    function selectedCatalogForNewItem() {
        const group = currentGroup();
        if (group) return Number(group.catalog_id);
        const catalog = currentCatalog();
        if (catalog) return Number(catalog.id);
        return state.catalogs[0] ? Number(state.catalogs[0].id) : 0;
    }

    function catalogAction(action) {
        const catalog = currentCatalog();
        if (action === 'add') return saveCatalog();
        if (!catalog) return;
        if (action === 'rename') return saveCatalog(catalog);
        if (action === 'copy') return mutate('copy_catalog', { id: catalog.id });
        if (action === 'move') return alert('Move catalog is reserved for catalog ordering.');
        if (action === 'delete') {
            if (!confirm(`Delete catalog "${catalog.name}"? Locked catalogs are protected.`)) return;
            return mutate('delete_catalog', { id: catalog.id });
        }
        if (action === 'active') return mutate('toggle_catalog', { id: catalog.id, field: 'active' });
        if (action === 'enabled') return mutate('toggle_catalog', { id: catalog.id, field: 'enabled_for_projects' });
    }

    function saveCatalog(catalog = null) {
        const name = prompt('Catalog name', catalog?.name || '');
        if (!name) return;
        const description = prompt('Description', catalog?.description || '') || '';
        request('save_catalog', {
            id: catalog?.id || 0,
            name,
            description,
            trade: catalog?.trade || name,
            active: catalog ? Number(catalog.active) : 1,
            locked: catalog ? Number(catalog.locked) : 0,
            enabled_for_projects: catalog ? Number(catalog.enabled_for_projects) : 1
        }).then(data => {
            selection = { view: 'catalog', catalogId: Number(data.id), groupId: null };
            state = data.data;
            render();
        }).catch(err => showError(err.message));
    }

    function groupAction(action) {
        const group = currentGroup();
        if (action === 'add') return saveGroup();
        if (!group) return;
        if (action === 'rename') return saveGroup(group);
        if (action === 'copy') return mutate('copy_group', { id: group.id });
        if (action === 'move') return moveGroup(group);
        if (action === 'delete') {
            if (!confirm(`Delete group "${group.name}"? Items will remain but lose this group selection.`)) return;
            return mutate('delete_group', { id: group.id });
        }
        if (action === 'active') return mutate('toggle_group', { id: group.id, field: 'active' });
        if (action === 'enabled') return mutate('toggle_group', { id: group.id, field: 'enabled_for_projects' });
    }

    function saveGroup(group = null) {
        const fallbackCatalog = currentCatalog() || (group ? state.catalogs.find(c => Number(c.id) === Number(group.catalog_id)) : state.catalogs[0]);
        if (!fallbackCatalog) return showError('Create a catalog before adding groups.');
        const name = prompt('Group name', group?.name || '');
        if (!name) return;
        request('save_group', {
            id: group?.id || 0,
            catalog_id: group?.catalog_id || fallbackCatalog.id,
            parent_group_id: group?.parent_group_id || '',
            name,
            description: group?.description || '',
            sort_order: group?.sort_order || 0,
            active: group ? Number(group.active) : 1,
            enabled_for_projects: group ? Number(group.enabled_for_projects) : 1
        }).then(data => {
            selection = { view: 'group', catalogId: null, groupId: Number(data.id) };
            state = data.data;
            render();
        }).catch(err => showError(err.message));
    }

    function moveGroup(group) {
        const catalogId = prompt('Move to catalog id', group.catalog_id);
        if (!catalogId) return;
        const parentGroupId = prompt('Parent group id for subgroup, or blank for top level', group.parent_group_id || '');
        request('save_group', {
            id: group.id,
            catalog_id: catalogId,
            parent_group_id: parentGroupId,
            name: group.name,
            description: group.description || '',
            sort_order: group.sort_order || 0,
            active: Number(group.active),
            enabled_for_projects: Number(group.enabled_for_projects)
        }).then(data => {
            selection = { view: 'group', catalogId: null, groupId: Number(data.id) };
            state = data.data;
            render();
        }).catch(err => showError(err.message));
    }

    function itemAction(action, id) {
        const item = state.items.find(row => Number(row.id) === id);
        if (!item) return;
        if (action === 'edit') return openItemModal(item);
        if (action === 'duplicate') return mutate('duplicate_item', { id });
        if (action === 'move') return openMoveItemModal(item);
        if (action === 'assembly') return mutate('convert_item_assembly', currentContextPayload({ id }));
        if (action === 'delete') {
            if (!confirm(`Delete item "${item.name}"?`)) return;
            return mutate('delete_item', currentContextPayload({ id }));
        }
        if (action === 'takeoff') return alert('This item is ready for takeoff layer selection in the Takeoff task.');
        if (action === 'history') return alert('Usage history will be populated when takeoff and estimates start consuming catalog items.');
    }

    function currentContextPayload(extra = {}) {
        return {
            ...extra,
            view: selection.view,
            catalog_id: selection.catalogId || '',
            group_id: selection.groupId || ''
        };
    }

    function openItemModal(item = null) {
        editingItemId = item ? Number(item.id) : null;
        document.getElementById('ccItemModalTitle').textContent = editingItemId ? 'Edit Catalog Item' : 'Create Catalog Item';
        document.getElementById('ccItemForm').reset();
        const catalogId = item ? Number(item.catalog_id) : selectedCatalogForNewItem();
        const groupId = item ? Number(item.catalog_group_id || 0) : (selection.groupId || '');
        document.getElementById('ccItemCatalog').value = catalogId;
        renderGroupSelect(document.getElementById('ccItemGroup'), catalogId, groupId);
        document.getElementById('ccItemGroup').value = groupId || '';
        document.getElementById('ccItemName').value = item?.name || '';
        document.getElementById('ccItemDescription').value = item?.description || '';
        document.getElementById('ccItemType').value = item?.item_type === 'part' ? 'material' : (item?.item_type || 'material');
        document.getElementById('ccItemUom').value = item?.unit_of_measure || 'ea';
        document.getElementById('ccItemUnitCost').value = item?.unit_cost || '0';
        document.getElementById('ccItemLaborHours').value = item?.labor_hours || '0';
        document.getElementById('ccItemTaxable').value = String(item?.taxable ?? '1');
        document.getElementById('ccItemColor').value = item?.color || '#2563eb';
        document.getElementById('ccItemSymbol').value = item?.symbol || 'circle';
        document.getElementById('ccItemManufacturer').value = item?.manufacturer || '';
        document.getElementById('ccItemSupplier').value = item?.supplier || '';
        document.getElementById('ccItemCatalogNumber').value = item?.catalog_number || item?.sku || '';
        document.getElementById('ccItemCostCode').value = item?.cost_code || '';
        document.getElementById('ccItemSubJobCode').value = item?.sub_job_code || '';
        document.getElementById('ccItemSubJobName').value = item?.sub_job_name || '';
        document.getElementById('ccItemEpdUrl').value = item?.epd_url || '';
        document.getElementById('ccItemAttachmentUrl').value = item?.attachment_url || '';
        document.getElementById('ccItemModal').classList.add('open');
    }

    function openMoveItemModal(item) {
        movingItemId = Number(item.id);
        document.getElementById('ccMoveCatalog').value = item.catalog_id;
        renderGroupSelect(document.getElementById('ccMoveGroup'), Number(item.catalog_id), item.catalog_group_id || '');
        document.getElementById('ccMoveGroup').value = item.catalog_group_id || '';
        document.getElementById('ccMoveItemModal').classList.add('open');
    }

    function saveItem(event) {
        event.preventDefault();
        const unitCost = Number(document.getElementById('ccItemUnitCost').value);
        const laborHours = Number(document.getElementById('ccItemLaborHours').value);
        const color = document.getElementById('ccItemColor').value;
        if (!document.getElementById('ccItemName').value.trim()) return showError('Name is required');
        if (!document.getElementById('ccItemUom').value.trim()) return showError('Unit of Measure is required');
        if (Number.isNaN(unitCost) || unitCost < 0) return showError('Unit Cost must be a number >= 0');
        if (Number.isNaN(laborHours) || laborHours < 0) return showError('Unit Labor Time must be a number >= 0');
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return showError('Color must be a valid hexadecimal value');

        request('save_item', {
            id: editingItemId || 0,
            catalog_id: document.getElementById('ccItemCatalog').value,
            catalog_group_id: document.getElementById('ccItemGroup').value,
            name: document.getElementById('ccItemName').value,
            description: document.getElementById('ccItemDescription').value,
            item_type: document.getElementById('ccItemType').value,
            unit_of_measure: document.getElementById('ccItemUom').value,
            unit_cost: unitCost,
            labor_hours: laborHours,
            taxable: document.getElementById('ccItemTaxable').value === '1' ? 1 : 0,
            color,
            symbol: document.getElementById('ccItemSymbol').value,
            manufacturer: document.getElementById('ccItemManufacturer').value,
            supplier: document.getElementById('ccItemSupplier').value,
            catalog_number: document.getElementById('ccItemCatalogNumber').value,
            cost_code: document.getElementById('ccItemCostCode').value,
            sub_job_code: document.getElementById('ccItemSubJobCode').value,
            sub_job_name: document.getElementById('ccItemSubJobName').value,
            epd_url: document.getElementById('ccItemEpdUrl').value,
            attachment_url: document.getElementById('ccItemAttachmentUrl').value
        }).then(data => {
            const groupId = Number(document.getElementById('ccItemGroup').value || 0);
            const catalogId = Number(document.getElementById('ccItemCatalog').value || 0);
            selection = groupId ? { view: 'group', catalogId: null, groupId } : { view: 'catalog', catalogId, groupId: null };
            state = data.data;
            closeItemModals();
            render();
        }).catch(err => showError(err.message));
    }

    function moveItem(event) {
        event.preventDefault();
        request('move_item', {
            id: movingItemId,
            catalog_id: document.getElementById('ccMoveCatalog').value,
            catalog_group_id: document.getElementById('ccMoveGroup').value
        }).then(data => {
            const groupId = Number(document.getElementById('ccMoveGroup').value || 0);
            const catalogId = Number(document.getElementById('ccMoveCatalog').value || 0);
            selection = groupId ? { view: 'group', catalogId: null, groupId } : { view: 'catalog', catalogId, groupId: null };
            state = data.data;
            closeItemModals();
            render();
        }).catch(err => showError(err.message));
    }

    function closeItemModals() {
        document.querySelectorAll('.cc-modal-backdrop').forEach(el => el.classList.remove('open'));
    }

    function mutate(action, payload) {
        request(action, payload)
            .then(data => {
                state = data.data;
                if (data.id && action.includes('catalog')) selection = { view: 'catalog', catalogId: Number(data.id), groupId: null };
                if (data.id && action.includes('group')) selection = { view: 'group', catalogId: null, groupId: Number(data.id) };
                render();
            })
            .catch(err => showError(err.message));
    }

    function showError(message) {
        const el = document.getElementById('ccError');
        el.textContent = message;
        el.style.display = 'block';
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                selection = { view: btn.dataset.view, catalogId: null, groupId: null };
                load();
            });
        });
        document.getElementById('ccAddCatalog').addEventListener('click', () => saveCatalog());
        document.getElementById('ccAddCatalogTop').addEventListener('click', () => saveCatalog());
        document.getElementById('ccAddGroup').addEventListener('click', () => saveGroup());
        document.getElementById('ccAddItem').addEventListener('click', () => openItemModal());
        document.getElementById('ccItemCatalog').addEventListener('change', event => renderGroupSelect(document.getElementById('ccItemGroup'), Number(event.target.value)));
        document.getElementById('ccMoveCatalog').addEventListener('change', event => renderGroupSelect(document.getElementById('ccMoveGroup'), Number(event.target.value)));
        document.querySelectorAll('[data-close-item-modal]').forEach(btn => btn.addEventListener('click', closeItemModals));
        document.getElementById('ccItemForm').addEventListener('submit', saveItem);
        document.getElementById('ccMoveItemForm').addEventListener('submit', moveItem);
        load();
    });
})();
