(function () {
    const apiUrl = '../api/cost_catalog.php';
    const attachmentApiUrl = '../api/catalog_item_attachment.php';
    let state = { catalogs: [], groups: [], items: [], allItems: [], assemblyParts: [] };
    let selection = { view: 'all', catalogId: null, groupId: null };
    let editingItemId = null;
    let movingItemId = null;
    let modalReturnFocus = null;
    let detailsItemId = null;
    let detailsReturnFocus = null;
    let itemQuery = '';
    let itemSort = 'name';
    let itemSortDirection = 1;
    let itemTypeFilter = 'all';
    let assemblyAdvanced = false;

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

    function attachmentRequest(action, itemId, revision, file = null) {
        const options = { method: 'POST' };
        if (file) {
            const form = new FormData(); form.append('action', action); form.append('item_id', itemId); form.append('pdf', file);
            if (revision !== null && revision !== undefined) form.append('expected_revision', revision);
            options.body = form;
        } else {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify({ item_id: itemId, expected_revision: revision });
        }
        return fetch(`${attachmentApiUrl}?action=${encodeURIComponent(action)}`, options).then(async response => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.status !== 'success') throw new Error(data.msg || 'PDF attachment request failed');
            return data;
        });
    }

    function safeLegacyUrl(value) {
        try { const url = new URL(value, window.location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
        catch (_) { return ''; }
    }

    function renderPdfAttachment(item) {
        const managed=item?.pdf_attachment || null; const current=document.getElementById('ccItemPdfCurrent');
        const legacy=document.getElementById('ccItemLegacyAttachment'); const input=document.getElementById('ccItemPdf');
        input.value=''; document.getElementById('ccItemPdfFeedback').textContent=''; current.hidden=!managed;
        if(managed){document.getElementById('ccItemPdfName').textContent=`${managed.originalName} · ${(Number(managed.sizeBytes||0)/1048576).toFixed(1)} MB`;document.getElementById('ccItemPdfView').href=managed.viewUrl;}
        const legacyUrl=!managed?safeLegacyUrl(item?.attachment_url||''):''; legacy.hidden=!legacyUrl;
        if(legacyUrl)document.getElementById('ccItemLegacyAttachmentView').href=legacyUrl;
        document.getElementById('ccItemPdfRemove').disabled=!managed||!editingItemId;
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
        const catalog=document.getElementById('ccAssemblyCatalogFilter'); if(!catalog)return;
        const selected=catalog.value;catalog.innerHTML='<option value="">All catalogs</option>'+state.catalogs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');catalog.value=selected;
        const category=document.getElementById('ccAssemblyCategoryFilter');const selectedCategory=category.value;category.innerHTML='<option value="">All categories</option>'+state.groups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('');category.value=selectedCategory;
        renderAssemblyBrowserResults();
    }

    function renderAssemblyBrowserResults(){const root=document.getElementById('ccAssemblyResults');if(!root)return;const q=(document.getElementById('ccAssemblySearch')?.value||'').toLowerCase();const catalog=document.getElementById('ccAssemblyCatalogFilter')?.value;const category=document.getElementById('ccAssemblyCategoryFilter')?.value;const type=document.getElementById('ccAssemblyTypeFilter')?.value;const source=state.allItems?.length?state.allItems:state.items;const rows=source.filter(i=>Number(i.id)!==Number(editingItemId||0)&&(!q||`${i.name} ${i.description||''}`.toLowerCase().includes(q))&&(!catalog||String(i.catalog_id)===catalog)&&(!category||String(i.catalog_group_id)===category)&&(!type||(i.item_type==='material'?'part':i.item_type)===type));root.innerHTML=rows.map(i=>`<button type="button" role="option" data-assembly-select="${i.id}"><span><strong>${esc(i.name)}</strong><small>${esc(i.catalog_name||'')} · ${esc(i.group_name||'Uncategorized')} · ${displayItemType(i.item_type)}</small></span><span>${money(i.unit_cost)} · ${Number(i.labor_hours||0).toFixed(4)} hr</span></button>`).join('')||'<p>No matching items.</p>';root.querySelectorAll('[data-assembly-select]').forEach(b=>b.addEventListener('click',()=>addAssemblyPart(Number(b.dataset.assemblySelect))));}

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
        modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
        document.getElementById('ccItemLaborRate').value = item?.labor_rate || '0';
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
        renderPdfAttachment(item);
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
        document.getElementById('ccItemUnitCostHint').textContent = isAssemblyType() ? 'Calculated from included items' : '';
        document.getElementById('ccItemLaborHoursHint').textContent = isAssemblyType() ? 'Calculated from included items' : '';
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
            body.innerHTML = '<tr><td colspan="8" class="cc-assembly-empty">Save the assembly item before adding included items.</td></tr>';
            note.textContent = 'Create the assembly first, then edit it to add included items.';
            totalsEl.textContent = 'Cost $0.00 - Labor 0.0000';
            return;
        }
        note.textContent = '';
        const parts = state.assemblyParts.filter(part => Number(part.assembly_catalog_item_id) === Number(editingItemId)).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||Number(a.id)-Number(b.id));
        const source=state.allItems?.length?state.allItems:state.items;let totalCost=0,totalLabor=0;
        if(window.CatalogItemContract&&window.AssemblyExpansionService){const canonical=source.map(item=>window.CatalogItemContract.normalizeCatalogItem(item,{assemblyParts:state.assemblyParts}));const root=canonical.find(item=>String(item.id)===String(editingItemId));if(root){const preview=window.AssemblyExpansionService.expandAssembly(root,1,{catalogIndex:new Map(canonical.map(item=>[String(item.id),item])),pricingSource:'CURRENT_CATALOG',linearLength:1,area:1,endpointCount:1});preview.leaves.forEach(row=>{const pricing=row.pricing||{};totalCost+=row.pricedQuantity*Number(pricing.materialUnitCost||pricing.equipmentUnitCost||pricing.subcontractorUnitCost||pricing.legacyUnitCost||0);totalLabor+=row.pricedQuantity*Number(pricing.laborHoursPerUnit||0);});note.textContent=preview.errors.length?'Preview blocked: assembly cycle or invalid ratio input.':'Preview uses the canonical assembly expansion engine.';}}
        body.innerHTML = parts.map(part => {
            const qty = Number(part.quantity || 0);
            const unitCost = Number(part.unit_cost_snapshot || 0);
            const labor = Number(part.unit_labor_time_snapshot || 0);
            if(!window.AssemblyExpansionService){totalCost+=qty*unitCost;totalLabor+=qty*labor;}
            const ratio=part.ratio_type||'per_unit';const advanced=assemblyAdvanced?`<div class="cc-component-advanced"><select data-part-ratio="${part.id}" aria-label="Ratio type for ${esc(part.child_item_name)}"><option value="per_unit" ${ratio==='per_unit'?'selected':''}>Per unit</option><option value="fixed" ${ratio==='fixed'?'selected':''}>Fixed</option><option value="per_linear_length" ${ratio==='per_linear_length'?'selected':''}>Per linear</option><option value="per_area" ${ratio==='per_area'?'selected':''}>Per area</option><option value="per_endpoint" ${ratio==='per_endpoint'?'selected':''}>Per endpoint</option><option value="spacing_based" ${ratio==='spacing_based'?'selected':''}>Spacing</option></select>${ratio==='spacing_based'?`<input data-part-spacing="${part.id}" type="number" min="0.0001" step="0.0001" value="${Number(part.spacing_value||1)}" aria-label="Spacing for ${esc(part.child_item_name)}">`:''}<input data-part-waste="${part.id}" type="number" min="0" step="0.01" value="${Number(part.waste_factor_percent||0)}" aria-label="Waste percent for ${esc(part.child_item_name)}"></div>`:'';
            return `
                <tr data-part-row="${part.id}">
                    <td><strong>${esc(part.child_item_name)}</strong>${advanced}</td>
                    <td><input class="cc-qty-input" data-part-quantity="${part.id}" type="number" min="0.0001" step="0.0001" value="${qty}" aria-label="Quantity for ${esc(part.child_item_name)}"></td>
                    <td>${esc(part.child_unit_of_measure||'ea')}</td>
                    <td>${money(unitCost)}</td>
                    <td>${labor.toFixed(4)}</td>
                    <td>${money(qty * unitCost)}</td>
                    <td>${(qty*labor).toFixed(4)}</td>
                    <td><div class="cc-row-actions"><button class="cc-icon-btn bordered" type="button" data-part-move="up" data-part-id="${part.id}" aria-label="Move ${esc(part.child_item_name)} up">↑</button><button class="cc-icon-btn bordered" type="button" data-part-move="down" data-part-id="${part.id}" aria-label="Move ${esc(part.child_item_name)} down">↓</button><button class="cc-btn danger" type="button" data-assembly-part-delete="${part.id}">Remove</button></div></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="8" class="cc-assembly-empty">No items included yet.</td></tr>';
        const stored=(state.allItems?.length?state.allItems:state.items).find(item=>Number(item.id)===Number(editingItemId));
        const storedCost=Number(stored?.unit_cost||0),storedLabor=Number(stored?.labor_hours||0);
        document.getElementById('ccItemUnitCost').value=storedCost;document.getElementById('ccItemLaborHours').value=storedLabor;
        const differs=Math.abs(storedCost-totalCost)>0.0001||Math.abs(storedLabor-totalLabor)>0.0001;
        totalsEl.textContent=differs?`Stored ${money(storedCost)} / ${storedLabor.toFixed(4)} hr · Canonical preview ${money(totalCost)} / ${totalLabor.toFixed(4)} hr`:`Cost ${money(totalCost)} - Labor ${totalLabor.toFixed(4)}`;
        if(differs)note.textContent='Canonical preview differs from the legacy stored total; values were not changed automatically.';
        body.querySelectorAll('[data-assembly-part-delete]').forEach(button => {
            button.addEventListener('click', () => deleteAssemblyPart(Number(button.dataset.assemblyPartDelete)));
        });
        body.querySelectorAll('[data-part-quantity],[data-part-ratio],[data-part-spacing],[data-part-waste]').forEach(input=>input.addEventListener('change',()=>updateAssemblyPart(Number(input.dataset.partQuantity||input.dataset.partRatio||input.dataset.partSpacing||input.dataset.partWaste))));
        body.querySelectorAll('[data-part-move]').forEach(button=>button.addEventListener('click',()=>moveAssemblyPart(Number(button.dataset.partId),button.dataset.partMove)));
    }

    function openMoveItemModal(item) {
        movingItemId = Number(item.id);
        document.getElementById('ccMoveCatalog').value = item.catalog_id;
        renderGroupSelect(document.getElementById('ccMoveGroup'), Number(item.catalog_id), item.catalog_group_id || '');
        document.getElementById('ccMoveGroup').value = item.catalog_group_id || '';
        document.getElementById('ccMoveItemModal').classList.add('open');
    }

    async function saveItem(event) {
        event.preventDefault();
        const unitCost = Number(document.getElementById('ccItemUnitCost').value);
        const laborHours = Number(document.getElementById('ccItemLaborHours').value);
        const laborRate = Number(document.getElementById('ccItemLaborRate').value);
        const color = document.getElementById('ccItemColor').value;
        if (!document.getElementById('ccItemName').value.trim()) return showError('Name is required');
        if (!document.getElementById('ccItemUom').value.trim()) return showError('Unit of Measure is required');
        if (Number.isNaN(unitCost) || unitCost < 0) return showError('Unit Cost must be a number >= 0');
        if (Number.isNaN(laborHours) || laborHours < 0) return showError('Unit Labor Time must be a number >= 0');
        if (Number.isNaN(laborRate) || laborRate < 0) return showError('Unit Labor Cost must be a number >= 0');
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return showError('Color must be a valid hexadecimal value');

        const pdf=document.getElementById('ccItemPdf').files[0] || null;
        if(pdf && (pdf.size>10485760 || (pdf.type && pdf.type!=='application/pdf'))) return showError('Choose a PDF of 10 MB or smaller');
        const saveButton=document.getElementById('ccItemSave'); saveButton.disabled=true; saveButton.textContent=pdf?'Saving and uploading…':'Saving…';
        try { const data=await request('save_item', {
            id: editingItemId || 0,
            catalog_id: document.getElementById('ccItemCatalog').value,
            catalog_group_id: document.getElementById('ccItemGroup').value,
            name: document.getElementById('ccItemName').value,
            description: document.getElementById('ccItemDescription').value,
            item_type: document.getElementById('ccItemType').value,
            unit_of_measure: document.getElementById('ccItemUom').value,
            unit_cost: unitCost,
            labor_hours: laborHours,
            labor_rate: laborRate,
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
        });
            if(pdf){document.getElementById('ccItemPdfFeedback').textContent='Uploading PDF…';await attachmentRequest('upload',data.id,data.revision,pdf);}
            const groupId = Number(document.getElementById('ccItemGroup').value || 0);
            const catalogId = Number(document.getElementById('ccItemCatalog').value || 0);
            selection = groupId ? { view: 'group', catalogId: null, groupId } : { view: 'catalog', catalogId, groupId: null };
            state = data.data;
            closeItemModals();
            await load();
        } catch(err) { showError(err.message); document.getElementById('ccItemPdfFeedback').textContent=err.message; }
        finally { saveButton.disabled=false; saveButton.textContent='Save Item'; }
    }

    function addAssemblyPart(childId) {
        if (!editingItemId) return showError('Save the assembly item before adding included items.');
        if (!childId) return showError('Select an item to include in the assembly.');
        request('add_assembly_part', currentContextPayload({
            assembly_catalog_item_id: editingItemId,
            part_catalog_item_id: childId,
            quantity:1,
            sort_order:state.assemblyParts.filter(p=>Number(p.assembly_catalog_item_id)===Number(editingItemId)).length
        })).then(data => {
            state = data.data;
            document.getElementById('ccAssemblyBrowser').hidden=true;renderAssemblyParts();renderAssemblyItemOptions();
        }).catch(err => showError(err.message));
    }

    function updateAssemblyPart(id){const row=document.querySelector(`[data-part-row="${id}"]`);const ratio=row.querySelector('[data-part-ratio]')?.value||state.assemblyParts.find(p=>Number(p.id)===id)?.ratio_type||'per_unit';request('update_assembly_part',currentContextPayload({id,quantity:Number(row.querySelector('[data-part-quantity]').value),ratio_type:ratio,spacing_value:ratio==='spacing_based'?Number(row.querySelector('[data-part-spacing]')?.value||1):null,waste_factor_percent:Number(row.querySelector('[data-part-waste]')?.value||0)})).then(data=>{state=data.data;renderAssemblyParts();}).catch(err=>showError(err.message));}

    function moveAssemblyPart(id,direction){const parts=state.assemblyParts.filter(p=>Number(p.assembly_catalog_item_id)===Number(editingItemId)).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||Number(a.id)-Number(b.id));const index=parts.findIndex(p=>Number(p.id)===id),other=direction==='up'?index-1:index+1;if(index<0||other<0||other>=parts.length)return;[parts[index],parts[other]]=[parts[other],parts[index]];request('reorder_assembly_parts',currentContextPayload({assembly_catalog_item_id:editingItemId,ordered_ids:parts.map(p=>p.id)})).then(data=>{state=data.data;renderAssemblyParts();}).catch(err=>showError(err.message));}

    function deleteAssemblyPart(id) {
        request('delete_assembly_part', currentContextPayload({ id }))
            .then(data => {
                state = data.data;
                renderAssemblyParts();renderAssemblyItemOptions();
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
        if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
        modalReturnFocus = null;
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
        document.getElementById('ccItemPdf').addEventListener('change', event => {
            const file=event.target.files[0];
            document.getElementById('ccItemPdfFeedback').textContent=file?`${file.name} selected. It will be uploaded when you save.`:'';
        });
        document.getElementById('ccItemPdfRemove').addEventListener('click', async () => {
            if(!editingItemId || !confirm('Remove the current PDF attachment?'))return;
            const item=(state.allItems||state.items).find(row=>Number(row.id)===Number(editingItemId));
            const field=document.querySelector('.cc-pdf-field'); field.classList.add('is-loading');
            document.getElementById('ccItemPdfFeedback').textContent='Removing PDF…';
            try { await attachmentRequest('remove',editingItemId,item?.revision??null); await load(); const updated=(state.allItems||state.items).find(row=>Number(row.id)===Number(editingItemId)); renderPdfAttachment(updated); document.getElementById('ccItemPdfFeedback').textContent='PDF removed.'; }
            catch(err){document.getElementById('ccItemPdfFeedback').textContent=err.message;showError(err.message);}
            finally{field.classList.remove('is-loading');}
        });
        document.getElementById('ccOpenAssemblyBrowser').addEventListener('click',()=>{const browser=document.getElementById('ccAssemblyBrowser');browser.hidden=false;renderAssemblyBrowserResults();document.getElementById('ccAssemblySearch').focus();});
        document.getElementById('ccCloseAssemblyBrowser').addEventListener('click',()=>{document.getElementById('ccAssemblyBrowser').hidden=true;document.getElementById('ccOpenAssemblyBrowser').focus();});
        ['ccAssemblySearch','ccAssemblyCatalogFilter','ccAssemblyCategoryFilter','ccAssemblyTypeFilter'].forEach(id=>document.getElementById(id).addEventListener(id==='ccAssemblySearch'?'input':'change',renderAssemblyBrowserResults));
        document.getElementById('ccAssemblyAdvanced').addEventListener('click',event=>{assemblyAdvanced=!assemblyAdvanced;event.currentTarget.setAttribute('aria-pressed',String(assemblyAdvanced));event.currentTarget.textContent=assemblyAdvanced?'Basic':'Advanced';renderAssemblyParts();});
        document.querySelectorAll('[data-close-item-modal]').forEach(btn => btn.addEventListener('click', closeItemModals));
        document.getElementById('ccItemForm').addEventListener('submit', saveItem);
        document.getElementById('ccMoveItemForm').addEventListener('submit', moveItem);
        load();
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.cc-row-menu')) closeItemMenus();
    });
    document.addEventListener('keydown', event => {
        const openModal = document.querySelector('.cc-modal-backdrop.open');
        if (event.key === 'Tab' && openModal) {
            const focusable = [...openModal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
                .filter(el => !el.hidden && el.offsetParent !== null);
            if (focusable.length) {
                const first = focusable[0]; const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        }
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
