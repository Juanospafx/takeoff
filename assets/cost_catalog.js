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
    let measurementFilter = 'all';
    let statusFilter = 'active';
    let uomFilter = 'all';
    let assemblyAdvanced = false;
    const expandedCatalogs = new Set();
    const expandedGroups = new Set();
    let entityEditor = null;
    let archivingCategoryId = null;
    let assemblyPartsByAssembly = new Map();
    let stagedAssemblyComponents = new Map();
    function rebuildAssemblyIndex(){assemblyPartsByAssembly=new Map();state.assemblyParts.forEach(part=>{const key=Number(part.assembly_catalog_item_id);if(!assemblyPartsByAssembly.has(key))assemblyPartsByAssembly.set(key,[]);assemblyPartsByAssembly.get(key).push(part);});assemblyPartsByAssembly.forEach(parts=>parts.sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||Number(a.id)-Number(b.id)));}

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
        }).then(async r => { const data=await r.json().catch(()=>({})); if(!r.ok||data.status!=='success'){const error=new Error(data.msg||'Cost Catalog request failed');error.code=data.code||'request_failed';error.status=r.status;error.current=data.current||null;error.details=data.details||null;throw error;} return data; }).then(data => {
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
        if (statusFilter !== 'active') params.set('include_deleted', '1');
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
        rebuildAssemblyIndex();
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
        const childrenByParent=new Map();
        state.groups.forEach(group=>{const key=`${group.catalog_id}:${Number(group.parent_group_id||0)}`;if(!childrenByParent.has(key))childrenByParent.set(key,[]);childrenByParent.get(key).push(group);});
        childrenByParent.forEach(rows=>rows.sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.name).localeCompare(String(b.name))));
        root.innerHTML = state.catalogs.slice().sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.name).localeCompare(String(b.name))).map(catalog => {
            const groups = childrenByParent.get(`${catalog.id}:0`)||[];
            const expanded=expandedCatalogs.has(Number(catalog.id))||selection.catalogId===Number(catalog.id)||groups.some(g=>Number(g.id)===Number(selection.groupId));
            return `
                <div class="cc-tree-node ${catalog.deleted_at?'archived':''}" role="treeitem" aria-level="1" aria-expanded="${expanded}" aria-selected="${selection.catalogId === Number(catalog.id) && selection.view === 'catalog'}">
                  <button class="cc-tree-toggle" data-tree-toggle-catalog="${catalog.id}" aria-label="${expanded?'Collapse':'Expand'} ${esc(catalog.name)}"><i class="fas fa-chevron-${expanded?'down':'right'}"></i></button>
                  <button class="cc-tree-row ${selection.catalogId === Number(catalog.id) && selection.view === 'catalog' ? 'active' : ''}" data-catalog-id="${catalog.id}"><i class="fas fa-book"></i><span>${esc(catalog.name)}</span><span class="status ${Number(catalog.active) ? '' : 'off'}"></span></button>
                </div>
                ${expanded?groups.map(group => renderGroup(group, 2, childrenByParent)).join(''):''}
            `;
        }).join('');
    }

    function renderGroup(group, level, childrenByParent) {
        const children = childrenByParent.get(`${group.catalog_id}:${group.id}`)||[];
        const expanded=expandedGroups.has(Number(group.id))||children.some(child=>Number(child.id)===Number(selection.groupId));
        return `
            <div class="cc-tree-node cc-tree-level-${level} ${group.deleted_at?'archived':''}" role="treeitem" aria-level="${level}" ${children.length?`aria-expanded="${expanded}"`:''} aria-selected="${selection.groupId === Number(group.id)}">
              ${children.length?`<button class="cc-tree-toggle" data-tree-toggle-group="${group.id}" aria-label="${expanded?'Collapse':'Expand'} ${esc(group.name)}"><i class="fas fa-chevron-${expanded?'down':'right'}"></i></button>`:'<span class="cc-tree-toggle-spacer"></span>'}
              <button class="cc-tree-row group ${selection.groupId === Number(group.id) ? 'active' : ''}" data-group-id="${group.id}" aria-label="Category: ${esc(group.name)}"><i class="fas fa-folder"></i><span>${esc(group.name)}</span><span class="status ${Number(group.active) ? '' : 'off'}"></span></button>
            </div>
            ${expanded?children.map(child => renderGroup(child, level+1,childrenByParent)).join(''):''}
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
            <button class="cc-btn" data-catalog-action="up" ${!catalog ? 'disabled' : ''}>Move up</button><button class="cc-btn" data-catalog-action="down" ${!catalog ? 'disabled' : ''}>Move down</button>
            <button class="cc-btn ${catalog?.deleted_at?'':'danger'}" data-catalog-action="${catalog?.deleted_at?'restore':'delete'}" ${!catalog ? 'disabled' : ''}>${catalog?.deleted_at?'Restore':'Archive'}</button>
            <button class="cc-btn" data-catalog-action="active" ${!catalog ? 'disabled' : ''}>${catalog && Number(catalog.active) ? 'Deactivate' : 'Activate'}</button>
            <button class="cc-btn" data-catalog-action="enabled" ${!catalog ? 'disabled' : ''}>${catalog && Number(catalog.enabled_for_projects) ? 'Disable Projects' : 'Enable Projects'}</button>
        `;
        document.getElementById('ccGroupActions').innerHTML = `
            <button class="cc-btn" data-group-action="add">Add Group</button>
            <button class="cc-btn" data-group-action="rename" ${!group ? 'disabled' : ''}>Rename</button>
            <button class="cc-btn" data-group-action="copy" ${!group ? 'disabled' : ''}>Copy</button>
            <button class="cc-btn" data-group-action="move" ${!group ? 'disabled' : ''}>Move</button>
            <button class="cc-btn" data-group-action="up" ${!group ? 'disabled' : ''}>Move up</button><button class="cc-btn" data-group-action="down" ${!group ? 'disabled' : ''}>Move down</button>
            <button class="cc-btn ${group?.deleted_at?'':'danger'}" data-group-action="${group?.deleted_at?'restore':'delete'}" ${!group ? 'disabled' : ''}>${group?.deleted_at?'Restore':'Archive'}</button>
            <button class="cc-btn" data-group-action="active" ${!group ? 'disabled' : ''}>Toggle</button>
            <button class="cc-btn" data-group-action="enabled" ${!group ? 'disabled' : ''}>Enabled for projects</button>
        `;
    }

    function renderItems() {
        const body = document.getElementById('ccItemsBody');
        const normalizeSearch=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
        const normalizedQuery = normalizeSearch(itemQuery);
        const valueForSort = item => {
            if (itemSort === 'cost') return Number(item.unit_cost || 0);
            if (itemSort === 'labor') return Number(item.labor_hours || 0);
            if (itemSort === 'catalog') return String(item.catalog_name || '').toLowerCase();
            if (itemSort === 'created') return String(item.created_at || '');
            if (itemSort === 'updated') return String(item.updated_at || '');
            return String(item.name || '').toLowerCase();
        };
        const normalizeType=item=>String(item.item_type||'part').toLowerCase()==='material'?'part':String(item.item_type||'part').toLowerCase();
        const items = state.items.filter(item => itemTypeFilter === 'all' || normalizeType(item) === itemTypeFilter)
            .filter(item=>measurementFilter==='all'||String(item.measurement_type||'count')===measurementFilter)
            .filter(item=>uomFilter==='all'||String(item.unit_of_measure||'ea')===uomFilter)
            .filter(item=>statusFilter==='all'||(statusFilter==='archived'?Boolean(item.deleted_at):!item.deleted_at))
            .filter(item => !normalizedQuery || [item.name, item.description,
            item.catalog_name, item.group_name, item.manufacturer,item.supplier,item.catalog_number,item.cost_code,item.masterformat,item.uniformat]
            .some(value => normalizeSearch(value).includes(normalizedQuery)))
            .slice().sort((a, b) => {
                const left = valueForSort(a);
                const right = valueForSort(b);
                return (typeof left === 'number' ? left - right : left.localeCompare(right)) * itemSortDirection;
            });
        const resultCount = document.getElementById('ccResultCount');
        if (resultCount) resultCount.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
        body.innerHTML = items.map(CatalogItemRow).join('') || '<tr class="cc-empty-row"><td colspan="8"><i class="fas fa-box-open" aria-hidden="true"></i>No catalog items match this view.</td></tr>';
        const uom=document.getElementById('ccUomFilter');const current=uom.value;uom.innerHTML='<option value="all">All units</option>'+[...new Set(state.allItems.map(item=>item.unit_of_measure||'ea'))].sort().map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');uom.value=[...uom.options].some(o=>o.value===current)?current:'all';
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
            <tr class="${item.deleted_at?'cc-archived-row':''}">
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
                                ${String(item.item_type).toLowerCase()!=='assembly'&&!item.deleted_at?`<button type="button" data-item-action="assembly" data-id="${item.id}" role="menuitem"><i class="fas fa-cubes"></i>Convert to assembly</button>`:''}
                                ${item.deleted_at?`<button type="button" data-item-action="restore" data-id="${item.id}" role="menuitem"><i class="fas fa-rotate-left"></i>Restore</button>`:`<button class="danger" type="button" data-item-action="delete" data-id="${item.id}" role="menuitem"><i class="fas fa-box-archive"></i>Archive</button>`}
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
        const common = [detailField('Type', displayItemType(type)), detailField('Description', item.description), detailField('Unit of measure', item.unit_of_measure || 'ea'),detailField('Measurement type',item.measurement_type||'count'), detailField('Catalog', item.catalog_name), detailField('Category', item.group_name), detailField('Cost code', item.cost_code), detailField('Catalog number', item.catalog_number), detailField('Manufacturer', item.manufacturer), detailField('Supplier', item.supplier),detailField('Size',item.size),detailField('Diameter',item.diameter),detailField('Trade size',item.trade_size),detailField('Thickness',item.thickness),detailField('Gauge',item.gauge),detailField('Material',item.material),detailField('Markup',`${Number(item.markup_percent||0)}%`),detailField('Waste',`${Number(item.waste_factor_percent||0)}%`),detailField('Notes',item.notes)];
        const specific = type === 'labor'
            ? [detailField('Labor time', `${Number(item.labor_hours || 0).toFixed(4)} hr`)]
            : type === 'equipment'
                ? [detailField('Equipment cost', money(item.unit_cost))]
                : [detailField(type === 'assembly' ? 'Assembly cost' : 'Material cost', money(item.unit_cost)), detailField('Labor time', `${Number(item.labor_hours || 0).toFixed(4)} hr`)];
        const parts = type === 'assembly' ? (assemblyPartsByAssembly.get(Number(item.id))||[]) : [];
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

    function initStagedAssemblyComponents(item = null) {
        stagedAssemblyComponents.clear();
        if (!item || String(item.item_type || '').toLowerCase() !== 'assembly') return;
        rebuildAssemblyIndex();
        const parts = assemblyPartsByAssembly.get(Number(item.id)) || [];
        const source = state.allItems?.length ? state.allItems : state.items;
        parts.forEach((part, index) => {
            const childId = Number(part.part_catalog_item_id);
            const childItem = source.find(row => Number(row.id) === childId);
            stagedAssemblyComponents.set(childId, {
                id: part.id ? Number(part.id) : null,
                itemId: childId,
                name: part.child_item_name || childItem?.name || 'Item',
                unit: part.child_unit_of_measure || childItem?.unit_of_measure || 'ea',
                unitCost: Number(childItem?.unit_cost ?? part.unit_cost_snapshot ?? 0),
                laborHours: Number(childItem?.labor_hours ?? part.unit_labor_time_snapshot ?? 0),
                ratio: Number(part.quantity ?? 1),
                ratioType: part.ratio_type || 'per_unit',
                spacingValue: part.spacing_value !== null && part.spacing_value !== undefined ? Number(part.spacing_value) : null,
                wasteFactorPercent: Number(part.waste_factor_percent || 0),
                notes: part.notes || '',
                sortOrder: Number(part.sort_order ?? index)
            });
        });
    }

    function toggleAssemblyComponentSelection(childId) {
        childId = Number(childId);
        if (!childId) return;
        if (stagedAssemblyComponents.has(childId)) {
            stagedAssemblyComponents.delete(childId);
        } else {
            const source = state.allItems?.length ? state.allItems : state.items;
            const childItem = source.find(row => Number(row.id) === childId);
            if (!childItem) return;
            stagedAssemblyComponents.set(childId, {
                id: null,
                itemId: childId,
                name: childItem.name,
                unit: childItem.unit_of_measure || 'ea',
                unitCost: Number(childItem.unit_cost || 0),
                laborHours: Number(childItem.labor_hours || 0),
                ratio: 1,
                ratioType: 'per_unit',
                spacingValue: null,
                wasteFactorPercent: 0,
                notes: '',
                sortOrder: stagedAssemblyComponents.size
            });
        }
        renderAssemblyParts();
        renderAssemblyBrowserResults();
    }

    function renderAssemblyItemOptions() {
        const catalog = document.getElementById('ccAssemblyCatalogFilter');
        if (!catalog) return;
        const currentItemCatalog = document.getElementById('ccItemCatalog')?.value || '';
        const selected = catalog.value || currentItemCatalog;
        catalog.innerHTML = '<option value="">All catalogs</option>' + state.catalogs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
        catalog.value = selected;
        const category = document.getElementById('ccAssemblyCategoryFilter');
        const selectedCategory = category.value;
        category.innerHTML = '<option value="">All categories</option>' + state.groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
        category.value = selectedCategory;
        renderAssemblyBrowserResults();
    }

    function renderAssemblyBrowserResults() {
        const root = document.getElementById('ccAssemblyResults');
        if (!root) return;
        const q = (document.getElementById('ccAssemblySearch')?.value || '').toLowerCase().trim();
        const catalog = document.getElementById('ccAssemblyCatalogFilter')?.value;
        const category = document.getElementById('ccAssemblyCategoryFilter')?.value;
        const type = document.getElementById('ccAssemblyTypeFilter')?.value;
        const source = state.allItems?.length ? state.allItems : state.items;
        const rows = source.filter(i => {
            if (Number(i.id) === Number(editingItemId || 0)) return false;
            if (String(i.item_type || '').toLowerCase() === 'assembly') return false;
            if (q) {
                const text = `${i.name || ''} ${i.description || ''} ${i.cost_code || ''} ${i.catalog_number || ''} ${i.sku || ''} ${i.sub_job_code || ''} ${i.masterformat || ''}`.toLowerCase();
                if (!text.includes(q)) return false;
            }
            if (catalog && String(i.catalog_id) !== catalog) return false;
            if (category && String(i.catalog_group_id) !== category) return false;
            if (type && (i.item_type === 'material' ? 'part' : i.item_type) !== type) return false;
            return true;
        });

        root.innerHTML = rows.map(i => {
            const isSelected = stagedAssemblyComponents.has(Number(i.id));
            return `
                <div class="cc-assembly-item-row ${isSelected ? 'is-selected' : ''}" role="option" aria-selected="${isSelected}" data-assembly-select="${i.id}">
                    <div class="cc-assembly-item-check-cell">
                        <input type="checkbox" class="cc-assembly-item-checkbox" data-assembly-item-check="${i.id}" ${isSelected ? 'checked' : ''} aria-label="Select ${esc(i.name)}">
                    </div>
                    <div class="cc-assembly-item-main">
                        <strong class="cc-assembly-item-title">${esc(i.name)}</strong>
                        <small class="cc-assembly-item-sub">${esc(i.catalog_name || '')} · ${esc(i.group_name || 'Uncategorized')} · ${displayItemType(i.item_type)} · Unit: ${esc(i.unit_of_measure || 'ea')}${i.cost_code ? ` · ${esc(i.cost_code)}` : ''}</small>
                    </div>
                    <div class="cc-assembly-item-pricing">
                        <span class="cc-money">${money(i.unit_cost)}</span>
                        <small>${Number(i.labor_hours || 0).toFixed(4)} hr</small>
                    </div>
                </div>
            `;
        }).join('') || '<p class="cc-assembly-no-results">No matching items.</p>';

        root.querySelectorAll('[data-assembly-select]').forEach(row => {
            row.addEventListener('click', event => {
                if (event.target.matches('input[type="checkbox"]')) return;
                toggleAssemblyComponentSelection(Number(row.dataset.assemblySelect));
            });
        });
        root.querySelectorAll('[data-assembly-item-check]').forEach(cb => {
            cb.addEventListener('click', event => {
                event.stopPropagation();
                toggleAssemblyComponentSelection(Number(cb.dataset.assemblyItemCheck));
            });
        });
    }

    function renderGroupSelect(select, catalogId, selectedId = '') {
        const groups = state.groups.filter(group => Number(group.catalog_id) === Number(catalogId));
        select.innerHTML = '<option value="">No group</option>' + groups.map(group => `<option value="${group.id}" ${Number(selectedId) === Number(group.id) ? 'selected' : ''}>${esc(group.name)}</option>`).join('');
    }

    function displayItemType(type) {
        const normalized=String(type||'part').toLowerCase();return normalized==='material'||normalized==='part'?'Part':esc(normalized);
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
        if (action === 'add') return openEntityModal('catalog');
        if (!catalog) return;
        if (action === 'rename') return openEntityModal('catalog',catalog);
        if (action === 'copy') return mutate('copy_catalog', revisionPayload(catalog,{ id: catalog.id }));
        if (action === 'up'||action==='down') return reorderEntity('catalog',catalog,action);
        if (action === 'delete') {
            if (!confirm(`Archive catalog "${catalog.name}"? Its historical references will be preserved.`)) return;
            return mutate('delete_catalog', revisionPayload(catalog,{ id: catalog.id }));
        }
        if(action==='restore')return mutate('restore_catalog',revisionPayload(catalog,{id:catalog.id}));
        if (action === 'active') return mutate('toggle_catalog', revisionPayload(catalog,{ id: catalog.id, field: 'active' }));
        if (action === 'enabled') return mutate('toggle_catalog', revisionPayload(catalog,{ id: catalog.id, field: 'enabled_for_projects' }));
    }

    function groupAction(action) {
        const group = currentGroup();
        if (action === 'add') return openEntityModal('category');
        if (!group) return;
        if (action === 'rename'||action==='move') return openEntityModal('category',group);
        if (action === 'copy') return mutate('copy_group', revisionPayload(group,{ id: group.id }));
        if(action==='up'||action==='down')return reorderEntity('category',group,action);
        if (action === 'delete') return openCategoryArchive(group);
        if(action==='restore')return mutate('restore_group',revisionPayload(group,{id:group.id}));
        if (action === 'active') return mutate('toggle_group', revisionPayload(group,{ id: group.id, field: 'active' }));
        if (action === 'enabled') return mutate('toggle_group', revisionPayload(group,{ id: group.id, field: 'enabled_for_projects' }));
    }

    function revisionPayload(entity,payload={}){return entity?.revision!==undefined&&entity?.revision!==null?{...payload,expected_revision:Number(entity.revision)}:payload;}

    function openEntityModal(kind,entity=null){if(kind==='category'&&!state.catalogs.length)return showError('Create a catalog before adding categories.');entityEditor={kind,entity};const modal=document.getElementById('ccEntityModal');document.getElementById('ccEntityTitle').textContent=`${entity?'Edit':'Create'} ${kind==='catalog'?'Catalog':'Category'}`;document.getElementById('ccEntityName').value=entity?.name||'';document.getElementById('ccEntityDescription').value=entity?.description||'';document.getElementById('ccEntityActive').checked=entity?Number(entity.active)!==0:true;document.getElementById('ccEntityEnabled').checked=entity?Number(entity.enabled_for_projects)!==0:true;document.querySelectorAll('[data-entity-category]').forEach(el=>el.hidden=kind!=='category');const catalog=document.getElementById('ccEntityCatalog');catalog.innerHTML=state.catalogs.filter(c=>!c.deleted_at).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');catalog.value=String(entity?.catalog_id||selectedCatalogForNewItem());renderEntityParents(entity);document.getElementById('ccEntityError').hidden=true;modal.classList.add('open');document.getElementById('ccEntityName').focus();}
    function renderEntityParents(entity=null){const catalogId=Number(document.getElementById('ccEntityCatalog').value||0),select=document.getElementById('ccEntityParent');select.innerHTML='<option value="">Top level</option>'+state.groups.filter(g=>Number(g.catalog_id)===catalogId&&!g.deleted_at&&Number(g.id)!==Number(entity?.id||0)).map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('');select.value=String(entity?.parent_group_id||'');}
    async function saveEntity(event){event.preventDefault();const {kind,entity}=entityEditor||{};if(!kind)return;const button=document.getElementById('ccEntitySave'),error=document.getElementById('ccEntityError');button.disabled=true;error.hidden=true;const payload=revisionPayload(entity,{id:entity?.id||0,name:document.getElementById('ccEntityName').value.trim(),description:document.getElementById('ccEntityDescription').value.trim(),active:document.getElementById('ccEntityActive').checked?1:0,enabled_for_projects:document.getElementById('ccEntityEnabled').checked?1:0});if(kind==='catalog'){payload.trade=entity?.trade||payload.name;payload.locked=Number(entity?.locked||0);payload.sort_order=Number(entity?.sort_order||0);}else{payload.catalog_id=Number(document.getElementById('ccEntityCatalog').value);payload.parent_group_id=document.getElementById('ccEntityParent').value;payload.sort_order=Number(entity?.sort_order||0);}try{const data=await request(kind==='catalog'?'save_catalog':'save_group',payload);state=data.data;selection=kind==='catalog'?{view:'catalog',catalogId:Number(data.id),groupId:null}:{view:'group',catalogId:null,groupId:Number(data.id)};closeEntityModal();render();}catch(err){error.textContent=err.code==='revision_conflict'?'This record changed elsewhere. Your entries were kept; reload the catalog before trying again.':err.message;error.hidden=false;}finally{button.disabled=false;}}
    function closeEntityModal(){document.getElementById('ccEntityModal').classList.remove('open');entityEditor=null;}
    function reorderEntity(kind,entity,direction){const list=(kind==='catalog'?state.catalogs:state.groups.filter(g=>Number(g.catalog_id)===Number(entity.catalog_id)&&Number(g.parent_group_id||0)===Number(entity.parent_group_id||0))).filter(row=>!row.deleted_at).slice().sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||Number(a.id)-Number(b.id));const index=list.findIndex(row=>Number(row.id)===Number(entity.id)),other=direction==='up'?index-1:index+1;if(index<0||other<0||other>=list.length)return;[list[index],list[other]]=[list[other],list[index]];mutate(kind==='catalog'?'reorder_catalogs':'reorder_groups',kind==='catalog'?{ordered_ids:list.map(row=>row.id)}:{catalog_id:entity.catalog_id,parent_group_id:entity.parent_group_id||'',ordered_ids:list.map(row=>row.id)});}
    function openCategoryArchive(group){archivingCategoryId=Number(group.id);const descendants=state.groups.filter(g=>Number(g.parent_group_id||0)===Number(group.id));const items=state.allItems.filter(i=>Number(i.catalog_group_id||0)===Number(group.id));document.getElementById('ccArchiveCategoryImpact').textContent=`${items.length} cost item(s) and ${descendants.length} direct subcategory(ies) are affected. Items will be moved, never deleted.`;const target=document.getElementById('ccArchiveCategoryTarget');target.innerHTML='<option value="">Uncategorized</option>'+state.groups.filter(g=>Number(g.catalog_id)===Number(group.catalog_id)&&Number(g.id)!==Number(group.id)&&!g.deleted_at).map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('');document.getElementById('ccArchiveCategoryTree').checked=descendants.length>0;document.getElementById('ccArchiveCategoryModal').classList.add('open');}
    async function archiveCategory(event){event.preventDefault();const group=state.groups.find(g=>Number(g.id)===archivingCategoryId),error=document.getElementById('ccArchiveCategoryError');if(!group)return;error.hidden=true;try{const data=await request('delete_group',revisionPayload(group,{id:group.id,target_group_id:document.getElementById('ccArchiveCategoryTarget').value,archive_tree:document.getElementById('ccArchiveCategoryTree').checked?1:0}));state=data.data;selection={view:'catalog',catalogId:Number(group.catalog_id),groupId:null};closeCategoryArchive();render();}catch(err){error.textContent=err.message;error.hidden=false;}}
    function closeCategoryArchive(){document.getElementById('ccArchiveCategoryModal').classList.remove('open');archivingCategoryId=null;}

    function itemAction(action, id) {
        const item = (state.allItems?.length?state.allItems:state.items).find(row => Number(row.id) === id);
        if (!item) return;
        if (action === 'edit') return openItemModal(item);
        if (action === 'duplicate') return mutate('duplicate_item', revisionPayload(item,{ id }));
        if (action === 'move') return openMoveItemModal(item);
        if (action === 'assembly') return mutate('convert_item_assembly', currentContextPayload(revisionPayload(item,{ id })));
        if (action === 'delete') {
            if (!confirm(`Delete item "${item.name}"?`)) return;
            return mutate('delete_item', currentContextPayload(revisionPayload(item,{ id })));
        }
        if(action==='restore')return mutate('restore_item',currentContextPayload(revisionPayload(item,{id})));
    }

    function currentContextPayload(extra = {}) {
        return {
            ...extra,
            view: selection.view,
            catalog_id: selection.catalogId || '',
            group_id: selection.groupId || ''
        };
    }
    function assemblyContext(extra={}){const parent=(state.allItems?.length?state.allItems:state.items).find(row=>Number(row.id)===Number(editingItemId));return currentContextPayload(revisionPayload(parent,extra));}

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
        document.getElementById('ccItemMeasurementType').value = item?.measurement_type || 'count';
        document.getElementById('ccItemUnitCost').value = item?.unit_cost || '0';
        document.getElementById('ccItemMaterialCost').value = item?.material_cost || '0';
        document.getElementById('ccItemLaborCost').value = item?.labor_cost || '0';
        document.getElementById('ccItemEquipmentCost').value = item?.equipment_cost || '0';
        document.getElementById('ccItemLaborHours').value = item?.labor_hours || '0';
        document.getElementById('ccItemLaborRate').value = item?.labor_rate || '0';
        document.getElementById('ccItemMarkup').value = item?.markup_percent || '0';
        document.getElementById('ccItemWaste').value = item?.waste_factor_percent || '0';
        document.getElementById('ccItemTaxable').value = String(item?.taxable ?? '1');
        document.getElementById('ccItemColor').value = item?.color || '#2563eb';
        document.getElementById('ccItemSymbol').value = item?.symbol || 'circle';
        document.getElementById('ccItemMarkerSize').value = item?.marker_size ?? '';
        document.getElementById('ccItemSize').value = item?.size || '';
        document.getElementById('ccItemDiameter').value = item?.diameter || '';
        document.getElementById('ccItemTradeSize').value = item?.trade_size || '';
        document.getElementById('ccItemThickness').value = item?.thickness || '';
        document.getElementById('ccItemGauge').value = item?.gauge || '';
        document.getElementById('ccItemMaterial').value = item?.material || '';
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
        let tags=[];try{tags=typeof item?.tags_json==='string'?JSON.parse(item.tags_json||'[]'):(item?.tags_json||[]);}catch(_){tags=[];}document.getElementById('ccItemTags').value=Array.isArray(tags)?tags.map(tag=>typeof tag==='string'?tag:(tag.name||'')).filter(Boolean).join(', '):'';
        document.getElementById('ccItemAttributes').value=typeof item?.attributes_json==='string'?item.attributes_json:JSON.stringify(item?.attributes_json||{},null,2);
        document.getElementById('ccItemNotes').value=item?.notes||'';
        renderPdfAttachment(item);
        initStagedAssemblyComponents(item);
        toggleAssemblySection();
        renderAssemblyParts();
        renderAssemblyItemOptions();
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
        renderAssemblyBrowserResults();
    }

    function renderAssemblyParts() {
        rebuildAssemblyIndex();
        const body = document.getElementById('ccAssemblyPartsBody');
        const note = document.getElementById('ccAssemblyNote');
        const totalsEl = document.getElementById('ccAssemblyTotals');
        const countEl = document.getElementById('ccSelectedComponentsCount');
        if (!body || !note || !totalsEl) return;
        if (!isAssemblyType()) {
            body.innerHTML = '';
            note.textContent = '';
            if (countEl) countEl.textContent = '0';
            return;
        }

        const components = Array.from(stagedAssemblyComponents.values());
        if (countEl) countEl.textContent = String(components.length);
        note.textContent = '';

        const source = state.allItems?.length ? state.allItems : state.items;
        let totalCost = 0, totalLabor = 0, canonicalValid = false;

        if (window.CatalogItemContract && window.AssemblyExpansionService && editingItemId) {
            const canonical = source.map(item => window.CatalogItemContract.normalizeCatalogItem(item, { assemblyParts: state.assemblyParts }));
            const root = canonical.find(item => String(item.id) === String(editingItemId));
            if (root) {
                const preview = window.AssemblyExpansionService.expandAssembly(root, 1, {
                    catalogIndex: new Map(canonical.map(item => [String(item.id), item])),
                    pricingSource: 'CURRENT_CATALOG',
                    linearLength: 1,
                    area: 1,
                    endpointCount: 1
                });
                preview.leaves.forEach(row => {
                    const pricing = row.pricing || {};
                    totalCost += row.pricedQuantity * (Number(pricing.materialUnitCost || 0) + Number(pricing.equipmentUnitCost || 0) + Number(pricing.subcontractorUnitCost || 0) + Number(pricing.legacyUnitCost || 0));
                    totalLabor += row.pricedQuantity * Number(pricing.laborHoursPerUnit || 0);
                });
                canonicalValid = !preview.errors.length;
                note.textContent = canonicalValid ? 'Totals use current component prices through the canonical assembly engine.' : 'Canonical calculation is blocked by a cycle, missing component, or invalid ratio input.';
            }
        }

        let calculatedCost = 0, calculatedLabor = 0;
        components.forEach(comp => {
            const qty = Number(comp.ratio || 0);
            calculatedCost += qty * Number(comp.unitCost || 0);
            calculatedLabor += qty * Number(comp.laborHours || 0);
        });

        if (!canonicalValid) {
            totalCost = calculatedCost;
            totalLabor = calculatedLabor;
        }

        body.innerHTML = components.map((part, index) => {
            const qty = Number(part.ratio ?? 1);
            const unitCost = Number(part.unitCost || 0);
            const labor = Number(part.laborHours || 0);
            const ratio = part.ratioType || 'per_unit';
            const advanced = assemblyAdvanced ? `<div class="cc-component-advanced"><select data-part-ratio="${part.itemId}" aria-label="Ratio type for ${esc(part.name)}"><option value="per_unit" ${ratio === 'per_unit' ? 'selected' : ''}>Per unit</option><option value="fixed" ${ratio === 'fixed' ? 'selected' : ''}>Fixed</option><option value="per_linear_length" ${ratio === 'per_linear_length' ? 'selected' : ''}>Per linear</option><option value="per_area" ${ratio === 'per_area' ? 'selected' : ''}>Per area</option><option value="per_endpoint" ${ratio === 'per_endpoint' ? 'selected' : ''}>Per endpoint</option><option value="spacing_based" ${ratio === 'spacing_based' ? 'selected' : ''}>Spacing</option></select>${ratio === 'spacing_based' ? `<input data-part-spacing="${part.itemId}" type="number" min="0.0001" step="0.0001" value="${Number(part.spacingValue || 1)}" aria-label="Spacing for ${esc(part.name)}">` : ''}<input data-part-waste="${part.itemId}" type="number" min="0" step="0.01" value="${Number(part.wasteFactorPercent || 0)}" aria-label="Waste percent for ${esc(part.name)}"></div>` : '';

            return `
                <tr data-part-row="${part.itemId}">
                    <td><strong>${esc(part.name)}</strong>${advanced}</td>
                    <td><input class="cc-qty-input" data-part-quantity="${part.itemId}" type="number" min="0" step="0.0001" value="${qty}" aria-label="Quantity for ${esc(part.name)}"></td>
                    <td>${esc(part.unit || 'ea')}</td>
                    <td>${money(unitCost)}</td>
                    <td>${labor.toFixed(4)}</td>
                    <td>${money(qty * unitCost)}</td>
                    <td>${(qty * labor).toFixed(4)}</td>
                    <td><input class="cc-component-note" data-part-notes="${part.itemId}" value="${esc(part.notes || '')}" aria-label="Notes for ${esc(part.name)}"></td>
                    <td><div class="cc-row-actions"><button class="cc-icon-btn bordered" type="button" data-part-move="up" data-part-id="${part.itemId}" aria-label="Move ${esc(part.name)} up">↑</button><button class="cc-icon-btn bordered" type="button" data-part-move="down" data-part-id="${part.itemId}" aria-label="Move ${esc(part.name)} down">↓</button><button class="cc-btn danger" type="button" data-assembly-part-delete="${part.itemId}">Remove</button></div></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="9" class="cc-assembly-empty">No items included yet. Select items from the list above to add them to this assembly.</td></tr>';

        const stored = editingItemId ? (state.allItems?.length ? state.allItems : state.items).find(item => Number(item.id) === Number(editingItemId)) : null;
        const storedCost = canonicalValid ? totalCost : Number(stored?.unit_cost || totalCost);
        const storedLabor = canonicalValid ? totalLabor : Number(stored?.labor_hours || totalLabor);
        document.getElementById('ccItemUnitCost').value = totalCost;
        document.getElementById('ccItemLaborHours').value = totalLabor;

        totalsEl.textContent = `Cost ${money(totalCost)} · Labor ${totalLabor.toFixed(4)}`;

        body.querySelectorAll('[data-assembly-part-delete]').forEach(button => {
            button.addEventListener('click', () => {
                const itemId = Number(button.dataset.assemblyPartDelete);
                stagedAssemblyComponents.delete(itemId);
                renderAssemblyParts();
                renderAssemblyBrowserResults();
            });
        });

        body.querySelectorAll('[data-part-quantity]').forEach(input => {
            input.addEventListener('input', () => {
                const itemId = Number(input.dataset.partQuantity);
                const comp = stagedAssemblyComponents.get(itemId);
                if (comp) {
                    comp.ratio = input.value === '' ? '' : Number(input.value);
                    updateAssemblyTotalsPreview();
                }
            });
            input.addEventListener('change', () => {
                const itemId = Number(input.dataset.partQuantity);
                const comp = stagedAssemblyComponents.get(itemId);
                if (comp) {
                    comp.ratio = Number(input.value || 0);
                    renderAssemblyParts();
                }
            });
        });

        body.querySelectorAll('[data-part-ratio]').forEach(sel => {
            sel.addEventListener('change', () => {
                const comp = stagedAssemblyComponents.get(Number(sel.dataset.partRatio));
                if (comp) { comp.ratioType = sel.value; renderAssemblyParts(); }
            });
        });
        body.querySelectorAll('[data-part-spacing]').forEach(inp => {
            inp.addEventListener('change', () => {
                const comp = stagedAssemblyComponents.get(Number(inp.dataset.partSpacing));
                if (comp) { comp.spacingValue = Number(inp.value); }
            });
        });
        body.querySelectorAll('[data-part-waste]').forEach(inp => {
            inp.addEventListener('change', () => {
                const comp = stagedAssemblyComponents.get(Number(inp.dataset.partWaste));
                if (comp) { comp.wasteFactorPercent = Number(inp.value); }
            });
        });
        body.querySelectorAll('[data-part-notes]').forEach(inp => {
            inp.addEventListener('change', () => {
                const comp = stagedAssemblyComponents.get(Number(inp.dataset.partNotes));
                if (comp) { comp.notes = inp.value; }
            });
        });
        body.querySelectorAll('[data-part-move]').forEach(button => {
            button.addEventListener('click', () => {
                const itemId = Number(button.dataset.partId);
                const direction = button.dataset.partMove;
                const entries = Array.from(stagedAssemblyComponents.entries());
                const index = entries.findIndex(([cid]) => cid === itemId);
                const other = direction === 'up' ? index - 1 : index + 1;
                if (index < 0 || other < 0 || other >= entries.length) return;
                [entries[index], entries[other]] = [entries[other], entries[index]];
                stagedAssemblyComponents = new Map(entries);
                renderAssemblyParts();
            });
        });
    }

    function updateAssemblyTotalsPreview() {
        let totalCost = 0, totalLabor = 0;
        stagedAssemblyComponents.forEach(comp => {
            const qty = Number(comp.ratio || 0);
            totalCost += qty * Number(comp.unitCost || 0);
            totalLabor += qty * Number(comp.laborHours || 0);
        });
        document.getElementById('ccItemUnitCost').value = totalCost;
        document.getElementById('ccItemLaborHours').value = totalLabor;
        document.getElementById('ccAssemblyTotals').textContent = `Cost ${money(totalCost)} · Labor ${totalLabor.toFixed(4)}`;
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
        const numericIds=['ccItemMaterialCost','ccItemLaborCost','ccItemEquipmentCost','ccItemMarkup','ccItemWaste','ccItemMarkerSize'];
        if (!document.getElementById('ccItemName').value.trim()) return showError('Name is required');
        if (!document.getElementById('ccItemUom').value.trim()) return showError('Unit of Measure is required');
        if (Number.isNaN(unitCost) || unitCost < 0) return showError('Unit Cost must be a number >= 0');
        if (Number.isNaN(laborHours) || laborHours < 0) return showError('Unit Labor Time must be a number >= 0');
        if (Number.isNaN(laborRate) || laborRate < 0) return showError('Unit Labor Cost must be a number >= 0');
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return showError('Color must be a valid hexadecimal value');
        for(const id of numericIds){const input=document.getElementById(id);if(input.value!==''&&(!Number.isFinite(Number(input.value))||Number(input.value)<0))return showItemFormError(`${input.closest('.cc-field').querySelector('label').textContent} must be a number greater than or equal to 0.`);}
        let attributes={};try{attributes=JSON.parse(document.getElementById('ccItemAttributes').value||'{}');if(!attributes||Array.isArray(attributes)||typeof attributes!=='object')throw new Error();}catch(_){return showItemFormError('Attributes must be a valid JSON object.');}

        if (isAssemblyType()) {
            for (const comp of stagedAssemblyComponents.values()) {
                const ratioNum = Number(comp.ratio);
                if (comp.ratio === '' || comp.ratio === null || !Number.isFinite(ratioNum) || ratioNum < 0) {
                    return showItemFormError(`Component "${comp.name}" must have a valid quantity ratio greater than or equal to 0.`);
                }
            }
        }

        const pdf=document.getElementById('ccItemPdf').files[0] || null;
        if(pdf && (pdf.size>10485760 || (pdf.type && pdf.type!=='application/pdf'))) return showError('Choose a PDF of 10 MB or smaller');
        const saveButton=document.getElementById('ccItemSave'); saveButton.disabled=true; saveButton.textContent=pdf?'Saving and uploading…':'Saving…';
        try {
            const existing=(state.allItems?.length?state.allItems:state.items).find(row=>Number(row.id)===Number(editingItemId));
            const componentsPayload = isAssemblyType() ? Array.from(stagedAssemblyComponents.values()).map((comp, idx) => ({
                id: comp.id,
                itemId: comp.itemId,
                part_catalog_item_id: comp.itemId,
                quantity: Number(comp.ratio || 0),
                ratio_type: comp.ratioType || 'per_unit',
                spacing_value: comp.spacingValue,
                waste_factor_percent: comp.wasteFactorPercent || 0,
                notes: comp.notes || '',
                sort_order: idx
            })) : null;

            const data=await request('save_item', revisionPayload(existing,{
                id: editingItemId || 0,
                catalog_id: document.getElementById('ccItemCatalog').value,
                catalog_group_id: document.getElementById('ccItemGroup').value,
                name: document.getElementById('ccItemName').value,
                description: document.getElementById('ccItemDescription').value,
                item_type: document.getElementById('ccItemType').value,
                unit_of_measure: document.getElementById('ccItemUom').value,
                measurement_type:document.getElementById('ccItemMeasurementType').value,
                unit_cost: unitCost,
                material_cost:Number(document.getElementById('ccItemMaterialCost').value||0),
                labor_cost:Number(document.getElementById('ccItemLaborCost').value||0),
                equipment_cost:Number(document.getElementById('ccItemEquipmentCost').value||0),
                labor_hours: laborHours,
                labor_rate: laborRate,
                markup_percent:Number(document.getElementById('ccItemMarkup').value||0),
                waste_factor_percent:Number(document.getElementById('ccItemWaste').value||0),
                taxable: document.getElementById('ccItemTaxable').value === '1' ? 1 : 0,
                color,
                symbol: document.getElementById('ccItemSymbol').value,
                marker_size:document.getElementById('ccItemMarkerSize').value,
                size:document.getElementById('ccItemSize').value,diameter:document.getElementById('ccItemDiameter').value,trade_size:document.getElementById('ccItemTradeSize').value,
                thickness:document.getElementById('ccItemThickness').value,gauge:document.getElementById('ccItemGauge').value,material:document.getElementById('ccItemMaterial').value,
                manufacturer: document.getElementById('ccItemManufacturer').value,
                supplier: document.getElementById('ccItemSupplier').value,
                catalog_number: document.getElementById('ccItemCatalogNumber').value,
                cost_code: document.getElementById('ccItemCostCode').value,
                masterformat: document.getElementById('ccItemMasterFormat').value,
                uniformat: document.getElementById('ccItemUniFormat').value,
                sub_job_code: document.getElementById('ccItemSubJobCode').value,
                sub_job_name: document.getElementById('ccItemSubJobName').value,
                epd_url: document.getElementById('ccItemEpdUrl').value,
                attachment_url: document.getElementById('ccItemAttachmentUrl').value,
                tags_json:document.getElementById('ccItemTags').value.split(',').map(value=>value.trim()).filter(Boolean),attributes_json:attributes,notes:document.getElementById('ccItemNotes').value,
                components: componentsPayload
            }));
            if(pdf){document.getElementById('ccItemPdfFeedback').textContent='Uploading PDF…';await attachmentRequest('upload',data.id,data.revision,pdf);}
            const groupId = Number(document.getElementById('ccItemGroup').value || 0);
            const catalogId = Number(document.getElementById('ccItemCatalog').value || 0);
            selection = groupId ? { view: 'group', catalogId: null, groupId } : { view: 'catalog', catalogId, groupId: null };
            state = data.data;
            closeItemModals();
            await load();
        } catch(err) { showItemFormError(err.code==='revision_conflict'?'This item changed elsewhere. Your entries are still here; reload to review the current version before saving again.':err.message); document.getElementById('ccItemPdfFeedback').textContent=err.message; }
        finally { saveButton.disabled=false; saveButton.textContent='Save Item'; }
    }

    function showItemFormError(message){const el=document.getElementById('ccItemFormError');el.textContent=message;el.hidden=false;el.scrollIntoView?.({block:'nearest'});}

    function addAssemblyPart(childId) {
        toggleAssemblyComponentSelection(childId);
    }

    function updateAssemblyPart(id){const row=document.querySelector(`[data-part-row="${id}"]`);const ratio=row.querySelector('[data-part-ratio]')?.value||state.assemblyParts.find(p=>Number(p.id)===id)?.ratio_type||'per_unit';request('update_assembly_part',assemblyContext({id,quantity:Number(row.querySelector('[data-part-quantity]').value),ratio_type:ratio,spacing_value:ratio==='spacing_based'?Number(row.querySelector('[data-part-spacing]')?.value||1):null,waste_factor_percent:Number(row.querySelector('[data-part-waste]')?.value||0),notes:row.querySelector('[data-part-notes]')?.value||''})).then(data=>{state=data.data;renderAssemblyParts();}).catch(err=>showItemFormError(err.message));}

    function moveAssemblyPart(id,direction){const parts=state.assemblyParts.filter(p=>Number(p.assembly_catalog_item_id)===Number(editingItemId)).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||Number(a.id)-Number(b.id));const index=parts.findIndex(p=>Number(p.id)===id),other=direction==='up'?index-1:index+1;if(index<0||other<0||other>=parts.length)return;[parts[index],parts[other]]=[parts[other],parts[index]];request('reorder_assembly_parts',assemblyContext({assembly_catalog_item_id:editingItemId,ordered_ids:parts.map(p=>p.id)})).then(data=>{state=data.data;renderAssemblyParts();}).catch(err=>showItemFormError(err.message));}

    function deleteAssemblyPart(id) {
        stagedAssemblyComponents.delete(Number(id));
        renderAssemblyParts();
        renderAssemblyBrowserResults();
    }

    function moveItem(event) {
        event.preventDefault();
        const item=(state.allItems?.length?state.allItems:state.items).find(row=>Number(row.id)===Number(movingItemId));request('move_item', revisionPayload(item,{
            id: movingItemId,
            catalog_id: document.getElementById('ccMoveCatalog').value,
            catalog_group_id: document.getElementById('ccMoveGroup').value
        })).then(data => {
            const groupId = Number(document.getElementById('ccMoveGroup').value || 0);
            const catalogId = Number(document.getElementById('ccMoveCatalog').value || 0);
            selection = groupId ? { view: 'group', catalogId: null, groupId } : { view: 'catalog', catalogId, groupId: null };
            state = data.data;
            closeItemModals();
            render();
        }).catch(err => showError(err.message));
    }

    function closeItemModals() {
        stagedAssemblyComponents.clear();
        document.querySelectorAll('.cc-modal-backdrop').forEach(el => el.classList.remove('open'));
        if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
        modalReturnFocus = null;
    }

    function mutate(action, payload) {
        request(action, payload)
            .then(data => {
                state = data.data;
                if (data.id && action.includes('catalog')&&!action.startsWith('delete_')) selection = { view: 'catalog', catalogId: Number(data.id), groupId: null };
                if (data.id && action.includes('group')&&!action.startsWith('delete_')) selection = { view: 'group', catalogId: null, groupId: Number(data.id) };
                if(action.startsWith('delete_catalog'))selection={view:'all',catalogId:null,groupId:null};
                render();
            })
            .catch(err => showError(err.code==='revision_conflict'?'This record was updated elsewhere. Reload and review the latest version before retrying.':err.message));
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
        document.getElementById('ccMeasurementFilter')?.addEventListener('change',event=>{measurementFilter=event.target.value;renderItems();});
        document.getElementById('ccUomFilter')?.addEventListener('change',event=>{uomFilter=event.target.value;renderItems();});
        document.getElementById('ccStatusFilter')?.addEventListener('change',event=>{statusFilter=event.target.value;load();});
        document.getElementById('ccClearFilters')?.addEventListener('click',()=>{itemQuery='';itemTypeFilter=measurementFilter=uomFilter='all';statusFilter='active';document.getElementById('ccSearch').value='';document.getElementById('ccTypeFilter').value='all';document.getElementById('ccMeasurementFilter').value='all';document.getElementById('ccUomFilter').value='all';document.getElementById('ccStatusFilter').value='active';load();});
        document.getElementById('ccItemsBody')?.addEventListener('click', event => {
            const trigger = event.target.closest('[data-item-details]');
            if (trigger) openItemDetails(trigger.dataset.itemDetails, trigger);
            const menuTrigger=event.target.closest('[data-item-menu]');if(menuTrigger){event.stopPropagation();const menu=menuTrigger.closest('.cc-row-menu'),opening=!menu.classList.contains('open');closeItemMenus();if(opening){menu.classList.add('open');menuTrigger.setAttribute('aria-expanded','true');positionItemMenu(menuTrigger,menu.querySelector('.cc-row-menu-panel'));}}
            const action=event.target.closest('[data-item-action]');if(action)itemAction(action.dataset.itemAction,Number(action.dataset.id));
        });
        document.getElementById('ccCatalogTree')?.addEventListener('click',event=>{const catalogToggle=event.target.closest('[data-tree-toggle-catalog]');if(catalogToggle){const id=Number(catalogToggle.dataset.treeToggleCatalog);expandedCatalogs.has(id)?expandedCatalogs.delete(id):expandedCatalogs.add(id);return renderTree();}const groupToggle=event.target.closest('[data-tree-toggle-group]');if(groupToggle){const id=Number(groupToggle.dataset.treeToggleGroup);expandedGroups.has(id)?expandedGroups.delete(id):expandedGroups.add(id);return renderTree();}const catalog=event.target.closest('[data-catalog-id]');if(catalog){selection={view:'catalog',catalogId:Number(catalog.dataset.catalogId),groupId:null};expandedCatalogs.add(Number(catalog.dataset.catalogId));return load();}const group=event.target.closest('[data-group-id]');if(group){const row=state.groups.find(g=>Number(g.id)===Number(group.dataset.groupId));selection={view:'group',catalogId:null,groupId:Number(group.dataset.groupId)};if(row)expandedCatalogs.add(Number(row.catalog_id));return load();}});
        document.querySelector('.cc-context-actions')?.addEventListener('click',event=>{const catalog=event.target.closest('[data-catalog-action]');if(catalog)return catalogAction(catalog.dataset.catalogAction);const group=event.target.closest('[data-group-action]');if(group)return groupAction(group.dataset.groupAction);});
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
        document.getElementById('ccAddCatalog').addEventListener('click', () => openEntityModal('catalog'));
        document.getElementById('ccAddCatalogTop').addEventListener('click', () => openEntityModal('catalog'));
        document.getElementById('ccAddGroup').addEventListener('click', () => openEntityModal('category'));
        document.getElementById('ccAddItem').addEventListener('click', () => openItemModal());
        document.getElementById('ccItemCatalog').addEventListener('change', event => { renderGroupSelect(document.getElementById('ccItemGroup'), Number(event.target.value)); renderAssemblyItemOptions(); });
        document.getElementById('ccMoveCatalog').addEventListener('change', event => renderGroupSelect(document.getElementById('ccMoveGroup'), Number(event.target.value)));
        document.getElementById('ccItemType').addEventListener('change', () => { toggleAssemblySection(); renderAssemblyItemOptions(); });
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
        document.getElementById('ccEntityForm').addEventListener('submit',saveEntity);document.querySelectorAll('[data-close-entity-modal]').forEach(button=>button.addEventListener('click',closeEntityModal));document.getElementById('ccEntityCatalog').addEventListener('change',()=>renderEntityParents(entityEditor?.entity));
        document.getElementById('ccArchiveCategoryForm').addEventListener('submit',archiveCategory);document.querySelectorAll('[data-close-category-archive]').forEach(button=>button.addEventListener('click',closeCategoryArchive));
        load();
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.cc-row-menu')) closeItemMenus();
    });
    document.addEventListener('keydown', event => {
        const treeControl=event.target.closest?.('#ccCatalogTree button');
        if(treeControl){const controls=[...document.querySelectorAll('#ccCatalogTree button:not(.cc-tree-toggle)')];const index=controls.indexOf(treeControl);if(event.key==='ArrowDown'||event.key==='ArrowUp'||event.key==='Home'||event.key==='End'){event.preventDefault();const target=event.key==='Home'?controls[0]:event.key==='End'?controls.at(-1):controls[index+(event.key==='ArrowDown'?1:-1)];target?.focus();}else if(event.key==='ArrowRight'){const node=treeControl.closest('[role="treeitem"]');if(node?.getAttribute('aria-expanded')==='false'){event.preventDefault();node.querySelector('.cc-tree-toggle')?.click();}}else if(event.key==='ArrowLeft'){const node=treeControl.closest('[role="treeitem"]');if(node?.getAttribute('aria-expanded')==='true'){event.preventDefault();node.querySelector('.cc-tree-toggle')?.click();}}else if((event.key==='Enter'||event.key===' ')&&treeControl){event.preventDefault();treeControl.click();}}
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
            closeEntityModal();closeCategoryArchive();
        }
    });
})();
