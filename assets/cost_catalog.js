(function () {
    const apiUrl = '../api/cost_catalog.php';
    let state = { catalogs: [], groups: [], items: [], allItems: [], assemblyParts: [] };
    let selection = { view: 'all', catalogId: null, groupId: null };
    let editingItemId = null;
    let movingItemId = null;
    let detailsItemId = null;
    let detailsReturnFocus = null;
    let itemQuery = '';
    let itemSort = 'name';
    let itemSortDirection = 1;
    let itemTypeFilter = 'all';

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
        renderAssemblyItemOptions();
        renderBreadcrumb();
    }

    function renderBreadcrumb() {
        const root = document.getElementById('ccBreadcrumb');
        if (!root) return;
        const group = currentGroup();
        const catalog = currentCatalog() || (group && state.catalogs.find(row => Number(row.id) === Number(group.catalog_id)));
        const parts = [{ label: 'Catalogs', view: 'all' }];
        if (catalog) parts.push({ label: catalog.name, view: 'catalog', catalogId: catalog.id, current: !group });
        if (group) parts.push({ label: group.name, current: true });
        root.innerHTML = `<ol>${parts.map((part, index) => `<li>${index ? '<i class="fas fa-chevron-right" aria-hidden="true"></i>' : ''}${part.current ? `<span aria-current="page">${esc(part.label)}</span>` : `<button type="button" data-breadcrumb-view="${part.view}" ${part.catalogId ? `data-catalog-id="${part.catalogId}"` : ''}>${esc(part.label)}</button>`}</li>`).join('')}</ol>`;
        root.querySelectorAll('[data-breadcrumb-view]').forEach(button => button.addEventListener('click', () => {
            selection = button.dataset.breadcrumbView === 'catalog' ? { view: 'catalog', catalogId: Number(button.dataset.catalogId), groupId: null } : { view: 'all', catalogId: null, groupId: null };
            load();
        }));
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
        root.setAttribute('role', 'tree');
        root.setAttribute('aria-label', 'Catalog and category hierarchy');
        root.innerHTML = state.catalogs.map(catalog => {
            const groups = state.groups.filter(group => Number(group.catalog_id) === Number(catalog.id) && !group.parent_group_id);
            return `
                <button class="cc-tree-row ${selection.catalogId === Number(catalog.id) && selection.view === 'catalog' ? 'active' : ''}" data-catalog-id="${catalog.id}" role="treeitem" aria-level="1" aria-selected="${selection.catalogId === Number(catalog.id) && selection.view === 'catalog'}">
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
            <button class="cc-tree-row ${cls} ${selection.groupId === Number(group.id) ? 'active' : ''}" data-group-id="${group.id}" role="treeitem" aria-level="${cls === 'subgroup' ? 3 : 2}" aria-selected="${selection.groupId === Number(group.id)}" aria-label="Category: ${esc(group.name)}">
                <i class="fas fa-folder"></i><span>${esc(group.name)}</span><span class="status ${Number(group.active) ? '' : 'off'}"></span>
            </button>
            ${children.map(child => renderGroup(child, 'subgroup')).join('')}
        `;
    }

    function renderActions() {
        const catalog = currentCatalog();
        const group = currentGroup();
        const catalogContext = document.getElementById('ccCatalogContext');
        const groupContext = document.getElementById('ccGroupContext');
        if (catalogContext) catalogContext.textContent = catalog?.name || 'No catalog selected';
        if (groupContext) groupContext.textContent = group?.name || 'No group selected';
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
        const normalizedQuery = itemQuery.trim().toLowerCase();
        const valueForSort = item => {
            if (itemSort === 'cost') return Number(item.unit_cost || 0);
            if (itemSort === 'labor') return Number(item.labor_hours || 0);
            if (itemSort === 'catalog') return String(item.catalog_name || '').toLowerCase();
            return String(item.name || '').toLowerCase();
        };
        const items = state.items.filter(item => itemTypeFilter === 'all' || String(item.item_type || 'part').toLowerCase() === itemTypeFilter)
            .filter(item => !normalizedQuery || [item.name, item.description,
            item.catalog_name, item.group_name, item.manufacturer, item.catalog_number, item.cost_code]
            .some(value => String(value || '').toLowerCase().includes(normalizedQuery)))
            .slice().sort((a, b) => {
                const left = valueForSort(a);
                const right = valueForSort(b);
                return (typeof left === 'number' ? left - right : left.localeCompare(right)) * itemSortDirection;
            });
        const resultCount = document.getElementById('ccResultCount');
        if (resultCount) resultCount.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
        body.innerHTML = items.map(CatalogItemRow).join('') || '<tr class="cc-empty-row"><td colspan="8"><i class="fas fa-box-open" aria-hidden="true"></i>No catalog items match this view.</td></tr>';
        /* CatalogItemRow owns the row markup; keep listeners below delegated to its data attributes. */
        body.querySelectorAll('[data-item-menu]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation(); const menu = button.closest('.cc-row-menu'); const opening = !menu.classList.contains('open'); closeItemMenus();
                if (opening) { menu.classList.add('open'); button.setAttribute('aria-expanded', 'true'); positionItemMenu(button, menu.querySelector('.cc-row-menu-panel')); }
            });
        });
        body.querySelectorAll('[data-item-action]').forEach(button => button.addEventListener('click', () => itemAction(button.dataset.itemAction, Number(button.dataset.id))));
    }

    function canonicalItemMetrics(item) {
        const type = String(item.item_type || 'part').toLowerCase();
        if (type === 'labor') return { primary: `${Number(item.labor_hours || 0).toFixed(4)} hr`, secondary: 'Labor / unit' };
        if (type === 'equipment') return { primary: money(item.unit_cost), secondary: 'Equipment / unit' };
        if (type === 'assembly') return { primary: money(item.unit_cost), secondary: `${Number(item.labor_hours || 0).toFixed(4)} hr assembled` };
        return { primary: money(item.unit_cost), secondary: `${Number(item.labor_hours || 0).toFixed(4)} hr labor` };
    }

    function CatalogItemRow(item) {
        const metrics = canonicalItemMetrics(item);
        return `
            <tr>
                <td>
                    <button class="cc-item-name" type="button" data-item-details="${item.id}" title="View ${esc(item.name)} details">${esc(item.name)}</button>
                    <span class="cc-item-meta"><span class="cc-pill">${displayItemType(item.item_type)}</span>
                    ${item.color ? `<span class="cc-swatch" style="background:${esc(item.color)}" title="Item color"></span>` : ''}</span>
                </td>
                <td class="cc-muted-cell" title="${esc(item.description || '')}">${esc(item.description || '-')}</td>
                <td>${esc(item.unit_of_measure || 'ea')}</td>
                <td class="cc-money"><strong>${metrics.primary}</strong><small>${esc(metrics.secondary)}</small></td>
                <td>${Number(item.labor_hours || 0).toFixed(4)}</td>
                <td class="cc-muted-cell">${esc(item.catalog_name || '-')}</td>
                <td class="cc-muted-cell">${esc(item.group_name || '-')}</td>
                <td>
                    <div class="cc-row-actions">
                        <div class="cc-row-menu">
                            <button class="cc-btn cc-row-menu-toggle" type="button" data-item-menu="${item.id}" aria-label="Actions for ${esc(item.name)}" aria-expanded="false"><i class="fas fa-ellipsis-vertical" aria-hidden="true"></i></button>
                            <div class="cc-row-menu-panel" data-item-menu-panel="${item.id}" role="menu">
                                <button type="button" data-item-action="edit" data-id="${item.id}" role="menuitem"><i class="fas fa-pen"></i>Edit</button>
                                <button type="button" data-item-action="duplicate" data-id="${item.id}" role="menuitem"><i class="far fa-copy"></i>Duplicate</button>
                                <button type="button" data-item-action="move" data-id="${item.id}" role="menuitem"><i class="fas fa-arrow-right-arrow-left"></i>Move</button>
                                <button type="button" data-item-action="assembly" data-id="${item.id}" role="menuitem"><i class="fas fa-cubes"></i>Convert to assembly</button>
                                <button type="button" data-item-action="takeoff" data-id="${item.id}" role="menuitem"><i class="fas fa-ruler-combined"></i>Add to Takeoff</button>
                                <button type="button" data-item-action="history" data-id="${item.id}" role="menuitem"><i class="fas fa-clock-rotate-left"></i>Usage history</button>
                                <button class="danger" type="button" data-item-action="delete" data-id="${item.id}" role="menuitem"><i class="fas fa-trash"></i>Delete</button>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    function safeExternalUrl(value) {
        try {
            const url = new URL(String(value || ''), window.location.href);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch (_) { return ''; }
    }

    function detailField(label, value) {
        const display = value === null || value === undefined || value === '' ? 'Not provided' : value;
        return `<div class="cc-detail-field"><dt>${esc(label)}</dt><dd>${esc(display)}</dd></div>`;
    }

    function detailLink(label, value) {
        const url = safeExternalUrl(value);
        return `<div class="cc-detail-field"><dt>${esc(label)}</dt><dd>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ${esc(label)} <i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : 'Not provided'}</dd></div>`;
    }

    function renderItemDetails(item) {
        const type = String(item.item_type || 'part').toLowerCase();
        const metrics = canonicalItemMetrics(item);
        const common = [detailField('Type', displayItemType(type)), detailField('Description', item.description), detailField('Unit of measure', item.unit_of_measure || 'ea'), detailField('Catalog', item.catalog_name), detailField('Category', item.group_name), detailField('Cost code', item.cost_code), detailField('Catalog number', item.catalog_number), detailField('Manufacturer', item.manufacturer), detailField('Supplier', item.supplier)];
        const specific = type === 'labor'
            ? [detailField('Labor time', `${Number(item.labor_hours || 0).toFixed(4)} hr`)]
            : type === 'equipment'
                ? [detailField('Equipment cost', money(item.unit_cost))]
                : [detailField(type === 'assembly' ? 'Assembly cost' : 'Material cost', money(item.unit_cost)), detailField('Labor time', `${Number(item.labor_hours || 0).toFixed(4)} hr`)];
        const parts = type === 'assembly' ? state.assemblyParts.filter(part => Number(part.assembly_catalog_item_id) === Number(item.id)) : [];
        const included = type === 'assembly' ? `<section class="cc-detail-section"><h3>Included items</h3><div class="cc-included-items">${parts.map(part => `<article><strong>${esc(part.child_item_name || 'Catalog item')}</strong><span>${esc(part.child_item_unit || 'ea')} · Qty ${Number(part.quantity || 0)}</span><small>${money(part.unit_cost_snapshot)} · ${Number(part.unit_labor_time_snapshot || 0).toFixed(4)} hr</small></article>`).join('') || '<p class="cc-details-empty">No included items.</p>'}</div></section>` : '';
        return `<section class="cc-detail-summary"><span class="cc-pill">${displayItemType(type)}</span><h3>${esc(item.name)}</h3><p>${esc(item.description || 'No description provided.')}</p><div class="cc-detail-metrics"><strong>${esc(metrics.primary)}</strong><span>${esc(metrics.secondary)}</span></div></section><section class="cc-detail-section"><h3>Item information</h3><dl class="cc-detail-list">${common.join('')}${specific.join('')}${detailField('Taxable', Number(item.taxable) ? 'Yes' : 'No')}${detailLink('EPD', item.epd_url)}${detailLink('Attachment', item.attachment_url)}</dl></section>${included}`;
    }

    function openItemDetails(itemId, trigger) {
        const item = (state.allItems?.length ? state.allItems : state.items).find(row => Number(row.id) === Number(itemId));
        if (!item) return;
        detailsItemId = Number(item.id); detailsReturnFocus = trigger || document.activeElement;
        document.getElementById('ccItemDetailsTitle').textContent = item.name;
        document.getElementById('ccItemDetailsBody').innerHTML = renderItemDetails(item);
        const drawer = document.getElementById('ccItemDetailsDrawer'); const scrim = document.getElementById('ccItemDetailsScrim');
        const mobile = window.matchMedia?.('(max-width: 760px)').matches;
        if (mobile) { drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); }
        else { drawer.removeAttribute('role'); drawer.removeAttribute('aria-modal'); }
        drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); scrim.hidden = false;
        document.body.classList.add('cc-details-open'); drawer.focus();
    }

    function closeItemDetails() {
        if (detailsItemId === null) return;
        detailsItemId = null; const drawer = document.getElementById('ccItemDetailsDrawer');
        drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); document.getElementById('ccItemDetailsScrim').hidden = true;
        drawer.removeAttribute('role'); drawer.removeAttribute('aria-modal');
        document.body.classList.remove('cc-details-open'); const target = detailsReturnFocus; detailsReturnFocus = null; target?.focus?.();
    }

    function closeItemMenus() {
        document.querySelectorAll('.cc-row-menu.open').forEach(menu => menu.classList.remove('open'));
        document.querySelectorAll('[data-item-menu]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    }

    function positionItemMenu(button, panel) {
        if (!panel) return;
        const rect = button.getBoundingClientRect();
        const width = 178;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
        const estimatedHeight = 238;
        const top = rect.bottom + estimatedHeight > window.innerHeight ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4;
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    }

    function renderItemSelects() {
        const catalogOptions = state.catalogs.map(catalog => `<option value="${catalog.id}">${esc(catalog.name)}</option>`).join('');
        document.getElementById('ccItemCatalog').innerHTML = catalogOptions;
        document.getElementById('ccMoveCatalog').innerHTML = catalogOptions;
        renderGroupSelect(document.getElementById('ccItemGroup'), Number(document.getElementById('ccItemCatalog').value || selection.catalogId || 0));
        renderGroupSelect(document.getElementById('ccMoveGroup'), Number(document.getElementById('ccMoveCatalog').value || selection.catalogId || 0));
    }

    function renderAssemblyItemOptions() {
        const select = document.getElementById('ccAssemblyChildItem');
        if (!select) return;
        const source = state.allItems && state.allItems.length ? state.allItems : state.items;
        select.innerHTML = '<option value="">Search/select item...</option>' + source
            .filter(item => Number(item.id) !== Number(editingItemId || 0))
            .map(item => `<option value="${item.id}">${esc(item.name)} - ${money(item.unit_cost)} - ${Number(item.labor_hours || 0).toFixed(4)} labor</option>`)
            .join('');
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
        document.getElementById('ccItemType').value = item?.item_type === 'material' ? 'part' : (item?.item_type || 'part');
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
        document.getElementById('ccItemMasterFormat').value = item?.masterformat || '';
        document.getElementById('ccItemUniFormat').value = item?.uniformat || '';
        document.getElementById('ccItemSubJobCode').value = item?.sub_job_code || '';
        document.getElementById('ccItemSubJobName').value = item?.sub_job_name || '';
        document.getElementById('ccItemEpdUrl').value = item?.epd_url || '';
        document.getElementById('ccItemAttachmentUrl').value = item?.attachment_url || '';
        toggleAssemblySection();
        renderAssemblyParts();
        document.getElementById('ccItemModal').classList.add('open');
        document.getElementById('ccItemModal').setAttribute('role', 'dialog');
        document.getElementById('ccItemModal').setAttribute('aria-modal', 'true');
        document.getElementById('ccItemName').focus();
    }

    function isAssemblyType() {
        return document.getElementById('ccItemType').value === 'assembly';
    }

    function toggleAssemblySection() {
        const section = document.getElementById('ccAssemblySection');
        section.style.display = isAssemblyType() ? 'block' : 'none';
        const type = document.getElementById('ccItemType').value;
        document.querySelectorAll('[data-item-specific]').forEach(field => { field.hidden = !field.dataset.itemSpecific.split(' ').includes(type); });
        document.getElementById('ccItemUnitCost').readOnly = isAssemblyType();
        document.getElementById('ccItemLaborHours').readOnly = isAssemblyType();
        renderAssemblyParts();
    }

    function renderAssemblyParts() {
        const body = document.getElementById('ccAssemblyPartsBody');
        const note = document.getElementById('ccAssemblyNote');
        const totalsEl = document.getElementById('ccAssemblyTotals');
        if (!body || !note || !totalsEl) return;
        if (!isAssemblyType()) {
            body.innerHTML = '';
            note.textContent = '';
            return;
        }
        if (!editingItemId) {
            body.innerHTML = '<tr><td colspan="6" style="color:#94a3b8;">Save the assembly item before adding included items.</td></tr>';
            note.textContent = 'Create the assembly first, then edit it to add included items.';
            totalsEl.textContent = 'Cost $0.00 - Labor 0.0000';
            return;
        }
        note.textContent = '';
        const parts = state.assemblyParts.filter(part => Number(part.assembly_catalog_item_id) === Number(editingItemId));
        let totalCost = 0;
        let totalLabor = 0;
        body.innerHTML = parts.map(part => {
            const qty = Number(part.quantity || 0);
            const unitCost = Number(part.unit_cost_snapshot || 0);
            const labor = Number(part.unit_labor_time_snapshot || 0);
            totalCost += qty * unitCost;
            totalLabor += qty * labor;
            return `
                <tr>
                    <td>${esc(part.child_item_name)}</td>
                    <td>${qty.toFixed(4)}</td>
                    <td>${money(unitCost)}</td>
                    <td>${labor.toFixed(4)}</td>
                    <td>${money(qty * unitCost)}</td>
                    <td><button class="cc-btn danger" type="button" data-assembly-part-delete="${part.id}">Remove</button></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="6" style="color:#94a3b8;">No items included yet.</td></tr>';
        totalsEl.textContent = `Cost ${money(totalCost)} - Labor ${totalLabor.toFixed(4)}`;
        body.querySelectorAll('[data-assembly-part-delete]').forEach(button => {
            button.addEventListener('click', () => deleteAssemblyPart(Number(button.dataset.assemblyPartDelete)));
        });
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
            masterformat: document.getElementById('ccItemMasterFormat').value,
            uniformat: document.getElementById('ccItemUniFormat').value,
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

    function addAssemblyPart() {
        if (!editingItemId) return showError('Save the assembly item before adding included items.');
        const childId = Number(document.getElementById('ccAssemblyChildItem').value || 0);
        const quantity = Number(document.getElementById('ccAssemblyQuantity').value || 0);
        if (!childId) return showError('Select an item to include in the assembly.');
        if (Number.isNaN(quantity) || quantity <= 0) return showError('Assembly part quantity must be greater than 0');
        request('add_assembly_part', currentContextPayload({
            assembly_catalog_item_id: editingItemId,
            part_catalog_item_id: childId,
            quantity
        })).then(data => {
            state = data.data;
            const updated = state.items.find(item => Number(item.id) === Number(editingItemId));
            render();
            openItemModal(updated || null);
        }).catch(err => showError(err.message));
    }

    function deleteAssemblyPart(id) {
        request('delete_assembly_part', currentContextPayload({ id }))
            .then(data => {
                state = data.data;
                const updated = state.items.find(item => Number(item.id) === Number(editingItemId));
                render();
                openItemModal(updated || null);
            })
            .catch(err => showError(err.message));
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
        document.getElementById('ccSearch')?.addEventListener('input', event => {
            itemQuery = event.target.value;
            renderItems();
        });
        document.getElementById('ccSortBy')?.addEventListener('change', event => {
            itemSort = event.target.value;
            renderItems();
        });
        document.getElementById('ccTypeFilter')?.addEventListener('change', event => { itemTypeFilter = event.target.value; renderItems(); });
        document.getElementById('ccItemsBody')?.addEventListener('click', event => {
            const trigger = event.target.closest('[data-item-details]');
            if (trigger) openItemDetails(trigger.dataset.itemDetails, trigger);
        });
        document.getElementById('ccCloseItemDetails')?.addEventListener('click', closeItemDetails);
        document.getElementById('ccItemDetailsScrim')?.addEventListener('click', closeItemDetails);
        document.getElementById('ccSortDir')?.addEventListener('click', event => {
            itemSortDirection *= -1;
            const button = event.currentTarget;
            button.setAttribute('aria-label', itemSortDirection > 0 ? 'Sort ascending' : 'Sort descending');
            button.querySelector('i').className = itemSortDirection > 0 ? 'fas fa-arrow-up-wide-short' : 'fas fa-arrow-down-wide-short';
            renderItems();
        });
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
        document.getElementById('ccItemType').addEventListener('change', toggleAssemblySection);
        document.getElementById('ccAddAssemblyPart').addEventListener('click', addAssemblyPart);
        document.querySelectorAll('[data-close-item-modal]').forEach(btn => btn.addEventListener('click', closeItemModals));
        document.getElementById('ccItemForm').addEventListener('submit', saveItem);
        document.getElementById('ccMoveItemForm').addEventListener('submit', moveItem);
        load();
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.cc-row-menu')) closeItemMenus();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Tab' && detailsItemId !== null && window.matchMedia?.('(max-width: 760px)').matches) {
            const drawer = document.getElementById('ccItemDetailsDrawer');
            const focusable = [...drawer.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')];
            if (focusable.length) {
                const first = focusable[0]; const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        }
        if (event.key === 'Escape') {
            closeItemDetails();
            closeItemMenus();
            closeItemModals();
        }
    });
})();
