(function () {
    const apiUrl = '../api/cost_catalog.php';
    const attachmentApiUrl = '../api/catalog_item_attachment.php';
    let state = { catalogs: [], groups: [], items: [], allItems: [], assemblyParts: [] };
    let selection = { view: 'all', catalogId: null, groupId: null };
    let editingItemId = null;
    let movingItemId = null;
    const selectedItemIds = new Set();
    const selectedArchivedCatalogIds = new Set();
    const selectedArchivedGroupIds = new Set();
    let clipboardItemIds = [];
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
    let currentPage = 1;
    const PAGE_SIZE = 30;
    let currentTotalPages = 1;
    const expandedCatalogs = new Set();
    const expandedGroups = new Set();
    let entityEditor = null;
    let archivingCategoryId = null;
    let assemblyPartsByAssembly = new Map();
    let stagedAssemblyComponents = new Map();
    function rebuildAssemblyIndex(){assemblyPartsByAssembly=new Map();state.assemblyParts.forEach(part=>{const key=Number(part.assembly_catalog_item_id);if(!assemblyPartsByAssembly.has(key))assemblyPartsByAssembly.set(key,[]);assemblyPartsByAssembly.get(key).push(part);});assemblyPartsByAssembly.forEach(parts=>parts.sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||Number(a.id)-Number(b.id)));}

    const MEASUREMENT_DEFAULT_UOM = {
        count: 'ea',
        linear: 'ft',
        area: 'sqft',
        volume: 'cuyd'
    };

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[ch]));

    function showConfirmDialog(options) {
        if (typeof window.showConfirmDialog === 'function') {
            return window.showConfirmDialog(options);
        }
        if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.confirm === 'function') {
            return window.TakeoffAnnouncement.confirm(options);
        }
        return Promise.resolve(window.confirm(options?.message || 'Are you sure you want to proceed?'));
    }

    const money = (value) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(value || 0));

    function sanitizeSingleNumber(numStr, maxInt = 1000, maxDecimals = 4) {
        if (!numStr) return '';
        const parts = numStr.split('.');
        let intPart = parts[0];
        let hasDot = parts.length > 1;
        let decPart = parts.slice(1).join('');
        
        if (maxInt !== null && intPart !== '') {
            const intVal = parseInt(intPart, 10);
            if (!isNaN(intVal)) {
                if (intVal > maxInt) {
                    intPart = String(maxInt);
                    decPart = '';
                    hasDot = false;
                } else if (intVal === maxInt && hasDot && decPart) {
                    decPart = '';
                    hasDot = false;
                }
            }
        }
        
        if (decPart.length > maxDecimals) {
            decPart = decPart.slice(0, maxDecimals);
        }
        
        return hasDot ? `${intPart}.${decPart}` : intPart;
    }

    function sanitizeQuantityInput(str) {
        if (!str) return '';
        const cleaned = String(str).replace(/[^0-9./]/g, '');
        if (cleaned.includes('/')) {
            const firstSlashIdx = cleaned.indexOf('/');
            const numPart = cleaned.slice(0, firstSlashIdx);
            const denPart = cleaned.slice(firstSlashIdx + 1).replace(/\//g, '');
            const numStr = sanitizeSingleNumber(numPart, 1000, 4);
            const denStr = sanitizeSingleNumber(denPart, null, 4);
            return `${numStr}/${denStr}`;
        }
        return sanitizeSingleNumber(cleaned, 1000, 4);
    }

    function parseQuantityExpression(inputStr) {
        if (inputStr === null || inputStr === undefined) return 0;
        inputStr = String(inputStr).trim();
        if (!inputStr) return 0;
        let result = 0;
        if (inputStr.includes('/')) {
            const parts = inputStr.split('/');
            if (parts.length >= 2) {
                const num = parseFloat(parts[0]);
                const den = parseFloat(parts[1]);
                if (!isNaN(num) && !isNaN(den) && den !== 0) {
                    result = num / den;
                }
            }
        } else {
            const val = parseFloat(inputStr);
            if (!isNaN(val)) result = val;
        }
        if (result > 1000) result = 1000;
        if (result < 0) result = 0;
        return parseFloat(result.toFixed(4));
    }

    let assemblyBrowserPage = 1;
    const ASSEMBLY_PAGE_SIZE = 30;

    const formatLaborHours = (hours) => Number(hours || 0).toFixed(2);

    const CATALOG_PALETTE = [
        '#2563eb', // Blue
        '#059669', // Emerald
        '#d97706', // Amber
        '#7c3aed', // Purple
        '#db2777', // Pink
        '#0891b2', // Cyan
        '#ea580c', // Orange
        '#4f46e5', // Indigo
        '#16a34a', // Green
        '#0284c7', // Sky
        '#9333ea', // Violet
        '#ca8a04'  // Gold
    ];

    function getCatalogColor(catalogOrName, catalogId) {
        if (typeof catalogOrName === 'object' && catalogOrName !== null) {
            if (catalogOrName.color) return catalogOrName.color;
            const id = catalogOrName.id;
            if (id) {
                return CATALOG_PALETTE[(Number(id) - 1) % CATALOG_PALETTE.length] || CATALOG_PALETTE[0];
            }
            catalogOrName = catalogOrName.name || '';
        }
        if (catalogId) {
            return CATALOG_PALETTE[(Number(catalogId) - 1) % CATALOG_PALETTE.length] || CATALOG_PALETTE[0];
        }
        const str = String(catalogOrName || '');
        if (!str || str === '-') return '#64748b';
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
        return CATALOG_PALETTE[Math.abs(hash) % CATALOG_PALETTE.length];
    }

    function hexToRgba(hex, alpha) {
        if (!hex || typeof hex !== 'string') return `rgba(100, 116, 139, ${alpha})`;
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        if (isNaN(num)) return `rgba(100, 116, 139, ${alpha})`;
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function getDarkerShade(hex) {
        if (!hex || typeof hex !== 'string') return '#1e293b';
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        if (isNaN(num)) return '#1e293b';
        let r = Math.max(0, Math.floor(((num >> 16) & 255) * 0.72));
        let g = Math.max(0, Math.floor(((num >> 8) & 255) * 0.72));
        let b = Math.max(0, Math.floor((num & 255) * 0.72));
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }

    function getGroupColor(group) {
        if (!group) return '#334155';
        const cat = state.catalogs.find(c => Number(c.id) === Number(group.catalog_id));
        const catColor = getCatalogColor(cat || group.catalog_name, group.catalog_id);
        return getDarkerShade(catColor);
    }

    function renderCatalogPill(catalogName, catalogId) {
        if (!catalogName || catalogName === '-') return '<span class="cc-muted-text">-</span>';
        const color = getCatalogColor(catalogName, catalogId);
        const bgLight = hexToRgba(color, 0.12);
        const borderLight = hexToRgba(color, 0.35);
        const textLight = getDarkerShade(color);
        const bgDark = hexToRgba(color, 0.28);
        const borderDark = hexToRgba(color, 0.60);
        return `
            <span class="bb-status-pill-wrap cc-catalog-pill" style="--cat-color: ${color}; --cat-bg-light: ${bgLight}; --cat-border-light: ${borderLight}; --cat-text-light: ${textLight}; --cat-bg-dark: ${bgDark}; --cat-border-dark: ${borderDark};" title="${esc(catalogName)}">
                <span class="bb-status-dot" style="background-color: ${color};"></span>
                <span class="bb-status-pill-label">${esc(catalogName)}</span>
            </span>
        `;
    }

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
        const managed = item?.pdf_attachment || null;
        const current = document.getElementById('ccItemPdfCurrent');
        const placeholder = document.getElementById('ccDropzonePlaceholder');
        const legacy = document.getElementById('ccItemLegacyAttachment');
        const input = document.getElementById('ccItemPdf');
        const imgThumb = document.getElementById('ccAttachedImgThumb');
        const fileIcon = document.getElementById('ccAttachedFileIcon');
        const meta = document.getElementById('ccItemPdfMeta');

        if (input) input.value = '';
        const feedback = document.getElementById('ccItemPdfFeedback');
        if (feedback) feedback.textContent = '';
        if (current) current.hidden = !managed;
        if (placeholder) placeholder.hidden = Boolean(managed);

        if (managed) {
            const isImg = (managed.mimeType && managed.mimeType.startsWith('image/')) ||
                          /\.(png|jpe?g|webp)$/i.test(managed.originalName || '');
            if (isImg && imgThumb && fileIcon) {
                imgThumb.src = managed.viewUrl;
                imgThumb.style.display = 'block';
                fileIcon.style.display = 'none';
                if (meta) meta.textContent = 'Product Image';
            } else if (imgThumb && fileIcon) {
                imgThumb.style.display = 'none';
                fileIcon.style.display = 'block';
                fileIcon.className = 'fas fa-file-pdf';
                fileIcon.style.color = '#ef4444';
                if (meta) meta.textContent = 'PDF Spec Sheet';
            }
            const nameEl = document.getElementById('ccItemPdfName');
            if (nameEl) nameEl.textContent = `${managed.originalName} · ${(Number(managed.sizeBytes || 0) / 1048576).toFixed(1)} MB`;
            const viewLink = document.getElementById('ccItemPdfView');
            if (viewLink) viewLink.href = managed.viewUrl;
        } else {
            if (imgThumb) imgThumb.style.display = 'none';
            if (fileIcon) fileIcon.style.display = 'block';
        }

        const legacyUrl = !managed ? safeLegacyUrl(item?.attachment_url || '') : '';
        if (legacy) legacy.hidden = !legacyUrl;
        if (legacyUrl && document.getElementById('ccItemLegacyAttachmentView')) {
            document.getElementById('ccItemLegacyAttachmentView').href = legacyUrl;
        }
        const removeBtn = document.getElementById('ccItemPdfRemove');
        if (removeBtn) removeBtn.disabled = !managed || !editingItemId;
    }

    function load() {
        currentPage = 1;
        selectedItemIds.clear();
        selectedArchivedCatalogIds.clear();
        selectedArchivedGroupIds.clear();
        updateBulkToolbar();
        updateSelectAllCheckbox();
        const tableWrap = document.getElementById('ccTableWrap') || document.querySelector('.cc-table-wrap');
        const pagination = document.getElementById('ccPagination');
        if (tableWrap) tableWrap.classList.add('is-loading');
        if (pagination) pagination.classList.add('is-loading');

        const params = new URLSearchParams({ action: 'list', view: selection.view });
        if (statusFilter !== 'active' || selection.view === 'archived') params.set('include_deleted', '1');
        if (selection.catalogId) params.set('catalog_id', selection.catalogId);
        if (selection.groupId) params.set('group_id', selection.groupId);
        return fetch(`${apiUrl}?${params.toString()}`)
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.msg || 'Cost Catalog could not load');
                state = data.data;
                render();
            })
            .catch(err => showError(err.message))
            .finally(() => {
                if (tableWrap) tableWrap.classList.remove('is-loading');
                if (pagination) pagination.classList.remove('is-loading');
            });
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
        initCustomSelects();
    }

    function renderBreadcrumb() {
        const root = document.getElementById('ccBreadcrumb');
        if (!root) return;
        const group = currentGroup();
        const catalog = currentCatalog() || (group && state.catalogs.find(row => Number(row.id) === Number(group.catalog_id)));
        const parts = [];
        if (catalog) parts.push({ label: catalog.name, view: 'catalog', catalogId: catalog.id, current: !group });
        if (group) parts.push({ label: group.name, current: true });
        if (!parts.length) {
            root.innerHTML = '';
            return;
        }
        root.innerHTML = `<ol>${parts.map((part, index) => `<li>${index ? '<i class="fas fa-chevron-right" aria-hidden="true"></i>' : ''}${part.current ? `<span aria-current="page">${esc(part.label)}</span>` : `<button type="button" data-breadcrumb-view="${part.view}" ${part.catalogId ? `data-catalog-id="${part.catalogId}"` : ''}>${esc(part.label)}</button>`}</li>`).join('')}</ol>`;
        root.querySelectorAll('[data-breadcrumb-view]').forEach(button => button.addEventListener('click', () => {
            selection = button.dataset.breadcrumbView === 'catalog' ? { view: 'catalog', catalogId: Number(button.dataset.catalogId), groupId: null } : { view: 'all', catalogId: null, groupId: null };
            load();
        }));
    }

    function renderTitle() {
        const catalog = currentCatalog();
        const group = currentGroup();
        let subtitle = 'Browse catalog items by catalog, group or subgroup.';
        let statusPillHtml = '';
        if (selection.view === 'recent') {
            subtitle = 'Recently updated catalog items across all catalogs.';
        } else if (selection.view === 'unassigned') {
            subtitle = 'Items without an assigned catalog or group.';
        } else if (selection.view === 'archived') {
            subtitle = 'Archived catalog items preserved for history and recovery.';
        } else if (group) {
            const count = Number(group.item_count || 0);
            subtitle = `${count} ${count === 1 ? 'item' : 'items'}`;
            const isEnabled = Boolean(Number(group.enabled_for_projects) && Number(group.active));
            statusPillHtml = `<span class="cc-status-pill ${isEnabled ? 'enabled' : 'disabled'}"><i class="fas ${isEnabled ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${isEnabled ? 'Enabled for Projects' : 'Disabled for Projects'}</span>`;
        } else if (catalog) {
            const count = Number(catalog.item_count || 0);
            subtitle = `${count} ${count === 1 ? 'item' : 'items'}`;
            const isEnabled = Boolean(Number(catalog.enabled_for_projects) && Number(catalog.active));
            statusPillHtml = `<span class="cc-status-pill ${isEnabled ? 'enabled' : 'disabled'}"><i class="fas ${isEnabled ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${isEnabled ? 'Enabled for Projects' : 'Disabled for Projects'}</span>`;
        }
        const titleEl = document.getElementById('ccTitle');
        if (titleEl) titleEl.textContent = 'Cost Catalog';
        const subEl = document.getElementById('ccSubtitle');
        if (subEl) {
            subEl.innerHTML = `<span>${esc(subtitle)}</span>${statusPillHtml}`;
        }
    }

    function renderTree() {
        document.querySelectorAll('[data-view]').forEach(btn => {
            btn.classList.toggle('active', selection.view === btn.dataset.view);
        });

        // Update live counts for Special Views (Request 10 & Request 5)
        const unassignedCount = (state.allItems || state.items).filter(i => (!i.catalog_id || !i.catalog_group_id || Number(i.catalog_id) === 0) && !i.deleted_at && !i.catalog_deleted_at && !i.group_deleted_at).length;
        const archivedCount = (state.allItems || state.items).filter(i => Boolean(i.deleted_at || i.catalog_deleted_at || i.group_deleted_at)).length + (state.archivedCatalogs?.length || 0) + (state.archivedGroups?.length || 0);
        const unassignedEl = document.getElementById('ccUnassignedCount');
        if (unassignedEl) unassignedEl.textContent = unassignedCount;
        const archivedEl = document.getElementById('ccArchivedCount');
        if (archivedEl) archivedEl.textContent = archivedCount;

        const root = document.getElementById('ccCatalogTree');
        root.setAttribute('role', 'tree');
        root.setAttribute('aria-label', 'Catalog and group hierarchy');
        const childrenByParent = new Map();
        state.groups.forEach(group => {
            const key = `${group.catalog_id}:${Number(group.parent_group_id || 0)}`;
            if (!childrenByParent.has(key)) childrenByParent.set(key, []);
            childrenByParent.get(key).push(group);
        });
        const naturalCompare = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
        childrenByParent.forEach(rows => rows.sort((a, b) => naturalCompare(a.name, b.name)));
        root.innerHTML = state.catalogs.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || naturalCompare(a.name, b.name)).map(catalog => {
            const groups = childrenByParent.get(`${catalog.id}:0`) || [];
            // Request 7: Selecting a catalog does NOT expand child groups. Only expandedCatalogs or active selection within children expands.
            const expanded = expandedCatalogs.has(Number(catalog.id)) || groups.some(g => Number(g.id) === Number(selection.groupId));
            const isSelected = selection.catalogId === Number(catalog.id) && selection.view === 'catalog';
            const catColor = getCatalogColor(catalog);
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body?.classList.contains('theme-dark');
            const bgAlpha = isDark ? 0.24 : 0.12;
            const borderAlpha = isDark ? 0.50 : 0.35;
            const activeStyle = isSelected
                ? `style="--active-cat-bg: ${hexToRgba(catColor, bgAlpha)}; --active-cat-border: ${hexToRgba(catColor, borderAlpha)}; --active-cat-color: ${isDark ? '#60a5fa' : catColor};"`
                : '';
            return `
                <div class="cc-tree-node ${catalog.deleted_at ? 'archived' : ''}" role="treeitem" aria-level="1" aria-expanded="${expanded}" aria-selected="${isSelected}">
                  <button class="cc-tree-toggle" data-tree-toggle-catalog="${catalog.id}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${esc(catalog.name)}"><i class="fas fa-chevron-${expanded ? 'down' : 'right'}"></i></button>
                  <div class="cc-tree-row catalog-row ${isSelected ? 'active' : ''}" data-catalog-id="${catalog.id}" role="button" tabindex="0" ${activeStyle}>
                    <i class="fas fa-book"></i>
                    <span>${esc(catalog.name)}</span>
                    <span class="status ${Number(catalog.active) ? '' : 'off'}" title="${Number(catalog.active) ? 'Active globally' : 'Inactive'}"></span>
                    <button class="cc-tree-more-btn" type="button" data-tree-more-catalog="${catalog.id}" aria-label="Catalog actions" title="Actions">
                      <i class="fas fa-ellipsis-vertical"></i>
                    </button>
                  </div>
                </div>
                ${expanded && groups.length ? `<div class="cc-tree-children" role="group">${groups.map(group => renderGroup(group, 2, childrenByParent)).join('')}</div>` : ''}
            `;
        }).join('');
    }

    function renderGroup(group, level, childrenByParent) {
        const children = childrenByParent.get(`${group.catalog_id}:${group.id}`) || [];
        const expanded = expandedGroups.has(Number(group.id)) || children.some(child => Number(child.id) === Number(selection.groupId));
        const isSelected = selection.groupId === Number(group.id);
        const grpColor = getGroupColor(group);
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body?.classList.contains('theme-dark');
        const bgAlpha = isDark ? 0.28 : 0.14;
        const borderAlpha = isDark ? 0.60 : 0.40;
        const activeStyle = isSelected
            ? `style="--active-grp-bg: ${hexToRgba(grpColor, bgAlpha)}; --active-grp-border: ${hexToRgba(grpColor, borderAlpha)}; --active-grp-color: ${isDark ? '#e2e8f0' : grpColor};"`
            : '';
        return `
            <div class="cc-tree-node cc-tree-level-${level} ${group.deleted_at ? 'archived' : ''}" role="treeitem" aria-level="${level}" ${children.length ? `aria-expanded="${expanded}"` : ''} aria-selected="${isSelected}">
              ${children.length ? `<button class="cc-tree-toggle" data-tree-toggle-group="${group.id}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${esc(group.name)}"><i class="fas fa-chevron-${expanded ? 'down' : 'right'}"></i></button>` : '<span class="cc-tree-toggle-spacer"></span>'}
              <div class="cc-tree-row group-row ${isSelected ? 'active' : ''}" data-group-id="${group.id}" role="button" tabindex="0" aria-label="Group: ${esc(group.name)}" ${activeStyle}>
                <i class="fas fa-folder"></i>
                <span>${esc(group.name)}</span>
                <span class="status ${Number(group.active) ? '' : 'off'}" title="${Number(group.active) ? 'Active' : 'Inactive'}"></span>
                <button class="cc-tree-more-btn" type="button" data-tree-more-group="${group.id}" aria-label="Group actions" title="Actions">
                  <i class="fas fa-ellipsis-vertical"></i>
                </button>
              </div>
            </div>
            ${expanded && children.length ? `<div class="cc-tree-children" role="group">${children.map(child => renderGroup(child, level + 1, childrenByParent)).join('')}</div>` : ''}
        `;
    }

    function renderActions() {
        const catalog = currentCatalog();
        const group = currentGroup();
        const catalogContext = document.getElementById('ccCatalogContext');
        const groupContext = document.getElementById('ccGroupContext');
        const catBadge = document.getElementById('ccCatalogBadge');
        const grpBadge = document.getElementById('ccGroupBadge');
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body?.classList.contains('theme-dark');

        if (selection.view === 'unassigned') {
            if (catalogContext) catalogContext.textContent = 'Unassigned';
            if (groupContext) groupContext.textContent = 'All Items';
            if (catBadge) {
                catBadge.classList.add('is-selected');
                catBadge.style.backgroundColor = 'rgba(249, 115, 22, 0.12)';
                catBadge.style.borderColor = 'rgba(249, 115, 22, 0.35)';
                catBadge.style.color = '#ea580c';
            }
            if (grpBadge) {
                grpBadge.classList.remove('is-selected');
                grpBadge.style.removeProperty('background-color');
                grpBadge.style.removeProperty('border-color');
                grpBadge.style.removeProperty('color');
            }
        } else if (selection.view === 'archived') {
            if (catalogContext) catalogContext.textContent = 'Archived';
            if (groupContext) groupContext.textContent = 'All Items';
            if (catBadge) {
                catBadge.classList.add('is-selected');
                catBadge.style.backgroundColor = 'rgba(239, 68, 68, 0.12)';
                catBadge.style.borderColor = 'rgba(239, 68, 68, 0.35)';
                catBadge.style.color = '#ef4444';
            }
            if (grpBadge) {
                grpBadge.classList.remove('is-selected');
                grpBadge.style.removeProperty('background-color');
                grpBadge.style.removeProperty('border-color');
                grpBadge.style.removeProperty('color');
            }
        } else {
            if (catalogContext) catalogContext.textContent = catalog?.name || 'All Catalogs';
            if (groupContext) groupContext.textContent = group?.name || 'All Groups';
            if (catBadge) {
                catBadge.classList.toggle('is-selected', Boolean(catalog));
                if (catalog) {
                    const color = getCatalogColor(catalog);
                    const bgLight = hexToRgba(color, 0.12);
                    const borderLight = hexToRgba(color, 0.35);
                    const textLight = getDarkerShade(color);
                    const bgDark = hexToRgba(color, 0.28);
                    const borderDark = hexToRgba(color, 0.60);
                    catBadge.style.setProperty('--cat-bg-light', bgLight);
                    catBadge.style.setProperty('--cat-border-light', borderLight);
                    catBadge.style.setProperty('--cat-text-light', textLight);
                    catBadge.style.setProperty('--cat-bg-dark', bgDark);
                    catBadge.style.setProperty('--cat-border-dark', borderDark);
                    catBadge.style.backgroundColor = isDark ? bgDark : bgLight;
                    catBadge.style.borderColor = isDark ? borderDark : borderLight;
                    catBadge.style.color = isDark ? '#ffffff' : textLight;
                } else {
                    catBadge.style.removeProperty('--cat-bg-light');
                    catBadge.style.removeProperty('--cat-border-light');
                    catBadge.style.removeProperty('--cat-text-light');
                    catBadge.style.removeProperty('--cat-bg-dark');
                    catBadge.style.removeProperty('--cat-border-dark');
                    catBadge.style.removeProperty('background-color');
                    catBadge.style.removeProperty('border-color');
                    catBadge.style.removeProperty('color');
                }
            }
            if (grpBadge) {
                grpBadge.classList.toggle('is-selected', Boolean(group));
                if (group) {
                    const grpColor = getGroupColor(group);
                    const bgLight = hexToRgba(grpColor, 0.14);
                    const borderLight = hexToRgba(grpColor, 0.40);
                    const textLight = grpColor;
                    const bgDark = hexToRgba(grpColor, 0.30);
                    const borderDark = hexToRgba(grpColor, 0.65);
                    grpBadge.style.setProperty('--cat-bg-light', bgLight);
                    grpBadge.style.setProperty('--cat-border-light', borderLight);
                    grpBadge.style.setProperty('--cat-text-light', textLight);
                    grpBadge.style.setProperty('--cat-bg-dark', bgDark);
                    grpBadge.style.setProperty('--cat-border-dark', borderDark);
                    grpBadge.style.backgroundColor = isDark ? bgDark : bgLight;
                    grpBadge.style.borderColor = isDark ? borderDark : borderLight;
                    grpBadge.style.color = isDark ? '#ffffff' : textLight;
                } else {
                    grpBadge.style.removeProperty('--cat-bg-light');
                    grpBadge.style.removeProperty('--cat-border-light');
                    grpBadge.style.removeProperty('--cat-text-light');
                    grpBadge.style.removeProperty('--cat-bg-dark');
                    grpBadge.style.removeProperty('--cat-border-dark');
                    grpBadge.style.removeProperty('background-color');
                    grpBadge.style.removeProperty('border-color');
                    grpBadge.style.removeProperty('color');
                }
            }
        }

        const catActions = document.getElementById('ccCatalogActions');
        if (catActions) {
            const isCatActive = Boolean(catalog && Number(catalog.enabled_for_projects) && Number(catalog.active));
            catActions.innerHTML = `
                <button class="cc-action-pill" data-catalog-action="add" title="Add new catalog"><i class="fas fa-plus"></i> New</button>
                <button class="cc-action-pill" data-catalog-action="rename" ${!catalog ? 'disabled' : ''} title="Rename catalog"><i class="fas fa-pen"></i> Rename</button>
                <button class="cc-action-pill" data-catalog-action="copy" ${!catalog ? 'disabled' : ''} title="Duplicate catalog"><i class="far fa-copy"></i> Copy</button>
                <button class="cc-action-pill" data-catalog-action="up" ${!catalog ? 'disabled' : ''} title="Move up"><i class="fas fa-arrow-up"></i></button>
                <button class="cc-action-pill" data-catalog-action="down" ${!catalog ? 'disabled' : ''} title="Move down"><i class="fas fa-arrow-down"></i></button>
                <button class="cc-action-pill ${catalog?.deleted_at ? '' : 'danger'}" data-catalog-action="${catalog?.deleted_at ? 'restore' : 'delete'}" ${!catalog ? 'disabled' : ''}><i class="fas ${catalog?.deleted_at ? 'fa-rotate-left' : 'fa-box-archive'}"></i> ${catalog?.deleted_at ? 'Restore' : 'Archive'}</button>
                <button class="cc-action-pill" data-catalog-action="toggle_status" ${!catalog ? 'disabled' : ''} title="Enable/disable for projects"><i class="fas ${isCatActive ? 'fa-toggle-on' : 'fa-toggle-off'}"></i> ${isCatActive ? 'Disable Projects' : 'Enable Projects'}</button>
            `;
        }

        const grpActions = document.getElementById('ccGroupActions');
        if (grpActions) {
            const isGrpActive = Boolean(group && Number(group.enabled_for_projects) && Number(group.active));
            grpActions.innerHTML = `
                <button class="cc-action-pill" data-group-action="add" title="Add new group"><i class="fas fa-plus"></i> New</button>
                <button class="cc-action-pill" data-group-action="rename" ${!group ? 'disabled' : ''} title="Rename group"><i class="fas fa-pen"></i> Rename</button>
                <button class="cc-action-pill" data-group-action="copy" ${!group ? 'disabled' : ''} title="Duplicate group"><i class="far fa-copy"></i> Copy</button>
                <button class="cc-action-pill" data-group-action="move" ${!group ? 'disabled' : ''} title="Move group"><i class="fas fa-arrows-split-up-and-left"></i> Move</button>
                <button class="cc-action-pill" data-group-action="up" ${!group ? 'disabled' : ''} title="Move up"><i class="fas fa-arrow-up"></i></button>
                <button class="cc-action-pill" data-group-action="down" ${!group ? 'disabled' : ''} title="Move down"><i class="fas fa-arrow-down"></i></button>
                <button class="cc-action-pill ${group?.deleted_at ? '' : 'danger'}" data-group-action="${group?.deleted_at ? 'restore' : 'delete'}" ${!group ? 'disabled' : ''}><i class="fas ${group?.deleted_at ? 'fa-rotate-left' : 'fa-box-archive'}"></i> ${group?.deleted_at ? 'Restore' : 'Archive'}</button>
                <button class="cc-action-pill" data-group-action="toggle_status" ${!group ? 'disabled' : ''} title="Enable/disable for projects"><i class="fas ${isGrpActive ? 'fa-toggle-on' : 'fa-toggle-off'}"></i> ${isGrpActive ? 'Disable Projects' : 'Enable Projects'}</button>
            `;
        }
    }

    function renderItems() {
        const body = document.getElementById('ccItemsBody');
        const normalizeSearch = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
        const normalizedQuery = normalizeSearch(itemQuery);
        const valueForSort = item => {
            if (itemSort === 'cost') return Number(item.unit_cost || 0);
            if (itemSort === 'labor') return Number(item.labor_hours || 0);
            if (itemSort === 'catalog') return String(item.catalog_name || '').toLowerCase();
            if (itemSort === 'created') return String(item.created_at || '');
            if (itemSort === 'updated') return String(item.updated_at || '');
            return String(item.name || '').toLowerCase();
        };
        const normalizeType = item => String(item.item_type || 'part').toLowerCase() === 'material' ? 'part' : String(item.item_type || 'part').toLowerCase();

        let rawItems = state.items;
        if (selection.view === 'unassigned') {
            rawItems = (state.allItems?.length ? state.allItems : state.items).filter(item => (!item.catalog_id || !item.catalog_group_id || Number(item.catalog_id) === 0) && !item.deleted_at && !item.catalog_deleted_at && !item.group_deleted_at);
        } else if (selection.view === 'archived') {
            rawItems = (state.allItems?.length ? state.allItems : state.items).filter(item => Boolean(item.deleted_at || item.catalog_deleted_at || item.group_deleted_at));
        }

        const items = rawItems.filter(item => itemTypeFilter === 'all' || normalizeType(item) === itemTypeFilter)
            .filter(item => measurementFilter === 'all' || String(item.measurement_type || 'count') === measurementFilter)
            .filter(item => uomFilter === 'all' || String(item.unit_of_measure || 'ea') === uomFilter)
            .filter(item => {
                if (selection.view === 'archived') return true;
                return statusFilter === 'all' || (statusFilter === 'archived' ? Boolean(item.deleted_at || item.catalog_deleted_at || item.group_deleted_at) : (!item.deleted_at && !item.catalog_deleted_at && !item.group_deleted_at));
            })
            .filter(item => !normalizedQuery || [item.name, item.description,
                item.catalog_name, item.group_name, item.manufacturer, item.supplier, item.catalog_number, item.cost_code, item.masterformat, item.uniformat]
                .some(value => normalizeSearch(value).includes(normalizedQuery)))
            .slice().sort((a, b) => {
                const left = valueForSort(a);
                const right = valueForSort(b);
                return (typeof left === 'number' ? left - right : left.localeCompare(right)) * itemSortDirection;
            });

        const archivedArea = document.getElementById('ccArchivedHeaderArea');
        if (selection.view === 'archived') {
            if (archivedArea) {
                archivedArea.hidden = false;
                const subTab = state.archiveSubTab || 'all';
                const catCount = state.archivedCatalogs?.length || 0;
                const grpCount = state.archivedGroups?.length || 0;
                const itmCount = rawItems.length;
                const totCount = catCount + grpCount + itmCount;
                archivedArea.innerHTML = `
                    <div class="cc-archived-tabs-bar" id="ccArchivedTabsBar">
                        <button type="button" class="cc-archived-tab-btn ${subTab === 'all' ? 'active' : ''}" data-archive-tab="all">
                            <i class="fas fa-layer-group"></i> All Archived
                            <span class="cc-archived-tab-count">${totCount}</span>
                        </button>
                        <button type="button" class="cc-archived-tab-btn ${subTab === 'catalogs' ? 'active' : ''}" data-archive-tab="catalogs">
                            <i class="fas fa-book"></i> Catalogs
                            <span class="cc-archived-tab-count">${catCount}</span>
                        </button>
                        <button type="button" class="cc-archived-tab-btn ${subTab === 'groups' ? 'active' : ''}" data-archive-tab="groups">
                            <i class="fas fa-folder"></i> Groups
                            <span class="cc-archived-tab-count">${grpCount}</span>
                        </button>
                        <button type="button" class="cc-archived-tab-btn ${subTab === 'items' ? 'active' : ''}" data-archive-tab="items">
                            <i class="fas fa-boxes-stacked"></i> Items
                            <span class="cc-archived-tab-count">${itmCount}</span>
                        </button>
                    </div>
                `;
                archivedArea.querySelectorAll('[data-archive-tab]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        state.archiveSubTab = btn.dataset.archiveTab;
                        currentPage = 1;
                        renderItems();
                    });
                });
            }
        } else {
            if (archivedArea) archivedArea.hidden = true;
        }

        const resultCount = document.getElementById('ccResultCount');
        if (resultCount) {
            if (selection.view === 'archived') {
                const sub = state.archiveSubTab || 'all';
                const count = sub === 'catalogs' ? (state.archivedCatalogs?.length || 0)
                    : sub === 'groups' ? (state.archivedGroups?.length || 0)
                    : sub === 'items' ? items.length
                    : (items.length + (state.archivedCatalogs?.length || 0) + (state.archivedGroups?.length || 0));
                resultCount.textContent = `${count} ${count === 1 ? 'archived' : 'archived'}`;
            } else {
                resultCount.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
            }
        }

        let activeFilterCount = 0;
        if (itemTypeFilter !== 'all') activeFilterCount++;
        if (measurementFilter !== 'all') activeFilterCount++;
        if (statusFilter !== 'active') activeFilterCount++;
        if (uomFilter !== 'all') activeFilterCount++;
        const filterBadge = document.getElementById('ccFilterActiveBadge');
        if (filterBadge) {
            filterBadge.textContent = activeFilterCount;
            filterBadge.hidden = activeFilterCount === 0;
        }
        const filterBtn = document.getElementById('ccFiltersBtn');
        if (filterBtn) filterBtn.classList.toggle('active', activeFilterCount > 0);
        const matchCount = document.getElementById('ccFiltersMatchCount');
        if (matchCount) {
            matchCount.textContent = `Showing ${items.length} of ${rawItems.length} items`;
        }

        const totalItems = items.length;
        currentTotalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
        if (currentPage > currentTotalPages) currentPage = currentTotalPages;
        if (currentPage < 1) currentPage = 1;

        const startIndex = (currentPage - 1) * PAGE_SIZE;
        const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
        const pagedItems = items.slice(startIndex, endIndex);

        if (selection.view === 'archived') {
            const sub = state.archiveSubTab || 'all';
            if (sub === 'catalogs') {
                body.innerHTML = (state.archivedCatalogs || []).map(CatalogArchivedRow).join('') || '<tr class="cc-empty-row"><td colspan="8"><i class="fas fa-box-open"></i>No archived catalogs.</td></tr>';
                renderPagination(state.archivedCatalogs?.length || 0, 1, (state.archivedCatalogs?.length || 0) > 0 ? 1 : 0, state.archivedCatalogs?.length || 0);
            } else if (sub === 'groups') {
                body.innerHTML = (state.archivedGroups || []).map(GroupArchivedRow).join('') || '<tr class="cc-empty-row"><td colspan="8"><i class="fas fa-box-open"></i>No archived groups.</td></tr>';
                renderPagination(state.archivedGroups?.length || 0, 1, (state.archivedGroups?.length || 0) > 0 ? 1 : 0, state.archivedGroups?.length || 0);
            } else if (sub === 'items') {
                body.innerHTML = pagedItems.map(CatalogItemRow).join('') || '<tr class="cc-empty-row"><td colspan="8"><i class="fas fa-box-open"></i>No archived items.</td></tr>';
                renderPagination(totalItems, currentTotalPages, totalItems === 0 ? 0 : startIndex + 1, endIndex);
            } else {
                const catRows = (state.archivedCatalogs || []).map(CatalogArchivedRow).join('');
                const grpRows = (state.archivedGroups || []).map(GroupArchivedRow).join('');
                const itmRows = pagedItems.map(CatalogItemRow).join('');
                body.innerHTML = (catRows + grpRows + itmRows) || '<tr class="cc-empty-row"><td colspan="8"><i class="fas fa-box-open"></i>No archived entities found.</td></tr>';
                renderPagination(totalItems, currentTotalPages, totalItems === 0 ? 0 : startIndex + 1, endIndex);
            }
        } else {
            body.innerHTML = pagedItems.map(CatalogItemRow).join('') || '<tr class="cc-empty-row"><td colspan="8"><i class="fas fa-box-open" aria-hidden="true"></i>No catalog items match this view.</td></tr>';
            renderPagination(totalItems, currentTotalPages, totalItems === 0 ? 0 : startIndex + 1, endIndex);
        }

        updateSelectAllCheckbox();
        updateBulkToolbar();

        const uom = document.getElementById('ccUomFilter');
        if (uom) {
            const current = uom.value;
            uom.innerHTML = '<option value="all">All units</option>' + [...new Set((state.allItems?.length ? state.allItems : state.items).map(item => item.unit_of_measure || 'ea'))].sort().map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
            uom.value = [...uom.options].some(o => o.value === current) ? current : 'all';
            uom._syncCustom?.();
        }
    }

    function updateSelectAllCheckbox() {
        const selectAll = document.getElementById('ccSelectAll');
        if (!selectAll) return;
        const pageItemCheckboxes = Array.from(document.querySelectorAll('.cc-item-check, .cc-archived-cat-check, .cc-archived-grp-check'));
        if (!pageItemCheckboxes.length) {
            selectAll.checked = false;
            selectAll.indeterminate = false;
            return;
        }
        const checkedCount = pageItemCheckboxes.filter(cb => cb.checked).length;
        selectAll.checked = checkedCount === pageItemCheckboxes.length;
        selectAll.indeterminate = checkedCount > 0 && checkedCount < pageItemCheckboxes.length;
    }

    function updateBulkToolbar() {
        const toolbar = document.getElementById('ccBulkToolbar');
        if (!toolbar) return;
        const isArchived = selection.view === 'archived';
        const count = isArchived
            ? (selectedItemIds.size + selectedArchivedCatalogIds.size + selectedArchivedGroupIds.size)
            : selectedItemIds.size;
        const hasClipboard = clipboardItemIds.length > 0;
        const countEl = document.getElementById('ccBulkCount');
        const normalGroup = document.getElementById('ccBulkActionsNormal');
        const archivedGroup = document.getElementById('ccBulkActionsArchived');
        const pasteGroup = document.getElementById('ccBulkActionsPaste');

        if (hasClipboard && count === 0) {
            // Paste mode: show ONLY the paste button and cancel button!
            toolbar.hidden = false;
            if (countEl) countEl.textContent = `${clipboardItemIds.length} item(s) copied`;
            if (normalGroup) normalGroup.hidden = true;
            if (archivedGroup) archivedGroup.hidden = true;
            if (pasteGroup) pasteGroup.hidden = false;
        } else if (count > 0) {
            toolbar.hidden = false;
            if (countEl) countEl.textContent = `${count} selected`;
            if (normalGroup) normalGroup.hidden = isArchived;
            if (archivedGroup) archivedGroup.hidden = !isArchived;
            if (pasteGroup) pasteGroup.hidden = true;
        } else {
            toolbar.hidden = true;
            if (normalGroup) normalGroup.hidden = true;
            if (archivedGroup) archivedGroup.hidden = true;
            if (pasteGroup) pasteGroup.hidden = true;
        }
    }

    function updateClipboardUI() {
        updateBulkToolbar();
    }

    function goToPage(pageNum) {
        if (pageNum < 1) pageNum = 1;
        if (pageNum > currentTotalPages) pageNum = currentTotalPages;
        if (pageNum === currentPage) return;
        currentPage = pageNum;
        renderItems();
        const wrap = document.getElementById('ccTableWrap') || document.querySelector('.cc-table-wrap');
        if (wrap) wrap.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderPagination(totalItems, totalPages, displayStart, displayEnd) {
        const pag = document.getElementById('ccPagination');
        if (!pag) return;

        const pageStartEl = document.getElementById('ccPageStart');
        const pageEndEl = document.getElementById('ccPageEnd');
        const pageTotalEl = document.getElementById('ccPageTotal');
        if (pageStartEl && pageEndEl && pageTotalEl) {
            pageStartEl.textContent = Number(displayStart).toLocaleString();
            pageEndEl.textContent = Number(displayEnd).toLocaleString();
            pageTotalEl.textContent = Number(totalItems).toLocaleString();
        }

        const btnFirst = document.getElementById('ccPageFirst');
        const btnPrev = document.getElementById('ccPagePrev');
        const btnNext = document.getElementById('ccPageNext');
        const btnLast = document.getElementById('ccPageLast');

        if (btnFirst) btnFirst.disabled = currentPage <= 1 || totalPages <= 1;
        if (btnPrev) btnPrev.disabled = currentPage <= 1 || totalPages <= 1;
        if (btnNext) btnNext.disabled = currentPage >= totalPages || totalPages <= 1;
        if (btnLast) btnLast.disabled = currentPage >= totalPages || totalPages <= 1;

        const container = document.getElementById('ccPaginationNumbers');
        if (!container) return;

        if (totalPages <= 1) {
            container.innerHTML = totalItems > 0 ? `<button type="button" class="cc-page-number active" aria-current="page">1</button>` : '';
            return;
        }

        const pages = [];
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            if (currentPage <= 4) {
                pages.push(1, 2, 3, 4, 5, '...', totalPages);
            } else if (currentPage >= totalPages - 3) {
                pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
            } else {
                pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
            }
        }

        container.innerHTML = pages.map(p => {
            if (p === '...') {
                return `<span class="cc-page-ellipsis" aria-hidden="true">&hellip;</span>`;
            }
            const isActive = p === currentPage;
            return `<button type="button" class="cc-page-number ${isActive ? 'active' : ''}" data-page="${p}" ${isActive ? 'aria-current="page"' : ''} title="Page ${p}">${p}</button>`;
        }).join('');
    }

    function canonicalItemMetrics(item) {
        const type = String(item.item_type || 'part').toLowerCase();
        if (type === 'labor') return { primary: money(item.unit_cost || item.labor_cost || 0), secondary: `${formatLaborHours(item.labor_hours)} hr` };
        if (type === 'equipment') return { primary: money(item.unit_cost), secondary: 'Equipment' };
        if (type === 'assembly') return { primary: money(item.unit_cost), secondary: 'Assembly' };
        if (type === 'travel') return { primary: money(item.unit_cost), secondary: 'Travel' };
        return { primary: money(item.unit_cost), secondary: 'Material' };
    }

    function CatalogArchivedRow(cat) {
        const isChecked = selectedArchivedCatalogIds.has(Number(cat.id));
        return `
            <tr class="cc-archived-row cc-archived-catalog-row" data-catalog-id="${cat.id}">
                <td class="col-check-cell">
                    <input type="checkbox" class="cc-archived-cat-check" data-catalog-id="${cat.id}" ${isChecked ? 'checked' : ''} aria-label="Select catalog ${esc(cat.name)}">
                </td>
                <td class="col-name-cell">
                    <div class="cc-item-primary-row">
                        <strong style="font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 8px;">
                            <i class="fas fa-book" style="color: #d97706;"></i> ${esc(cat.name)}
                        </strong>
                    </div>
                    <div class="cc-item-sub-row">
                        <span class="cc-archived-badge reason-catalog"><i class="fas fa-box-archive"></i> Catalog Archived</span>
                        ${cat.description ? `<span class="cc-item-desc-inline">${esc(cat.description)}</span>` : ''}
                    </div>
                </td>
                <td class="col-uom-cell">-</td>
                <td class="col-cost-cell"><strong>${Number(cat.item_count || 0)} items</strong></td>
                <td class="col-labor-cell">-</td>
                <td class="col-cat-cell">${renderCatalogPill(cat.name, cat.id)}</td>
                <td class="col-group-cell cc-muted-cell">${cat.deleted_at ? formatDateStr(cat.deleted_at) : 'Archived'}</td>
                <td class="col-actions-cell"></td>
            </tr>
        `;
    }

    function GroupArchivedRow(grp) {
        const isChecked = selectedArchivedGroupIds.has(Number(grp.id));
        return `
            <tr class="cc-archived-row cc-archived-group-row" data-group-id="${grp.id}">
                <td class="col-check-cell">
                    <input type="checkbox" class="cc-archived-grp-check" data-group-id="${grp.id}" ${isChecked ? 'checked' : ''} aria-label="Select group ${esc(grp.name)}">
                </td>
                <td class="col-name-cell">
                    <div class="cc-item-primary-row">
                        <strong style="font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 8px;">
                            <i class="fas fa-folder" style="color: #2563eb;"></i> ${esc(grp.name)}
                        </strong>
                    </div>
                    <div class="cc-item-sub-row">
                        <span class="cc-archived-badge reason-group"><i class="fas fa-box-archive"></i> Group Archived</span>
                        ${grp.description ? `<span class="cc-item-desc-inline">${esc(grp.description)}</span>` : ''}
                    </div>
                </td>
                <td class="col-uom-cell">-</td>
                <td class="col-cost-cell"><strong>${Number(grp.item_count || 0)} items</strong></td>
                <td class="col-labor-cell">-</td>
                <td class="col-cat-cell">${renderCatalogPill(grp.catalog_name, grp.catalog_id)}</td>
                <td class="col-group-cell cc-muted-cell">${grp.deleted_at ? formatDateStr(grp.deleted_at) : 'Archived'}</td>
                <td class="col-actions-cell"></td>
            </tr>
        `;
    }

    function formatDateStr(str) {
        if (!str) return '-';
        try {
            const d = new Date(str.replace(' ', 'T'));
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (_) { return str; }
    }

    function CatalogItemRow(item) {
        const metrics = canonicalItemMetrics(item);
        const isArchived = Boolean(
            selection.view === 'archived' ||
            statusFilter === 'archived' ||
            item.deleted_at ||
            item.catalog_deleted_at ||
            item.group_deleted_at
        );
        let reasonBadge = '';
        if (item.catalog_deleted_at) {
            reasonBadge = `<span class="cc-archived-badge reason-catalog" title="Archived with Catalog '${esc(item.catalog_name)}'"><i class="fas fa-book"></i> Catalog: ${esc(item.catalog_name)}</span>`;
        } else if (item.group_deleted_at) {
            reasonBadge = `<span class="cc-archived-badge reason-group" title="Archived with Group '${esc(item.group_name)}'"><i class="fas fa-folder"></i> Group: ${esc(item.group_name)}</span>`;
        } else if (item.deleted_at) {
            reasonBadge = `<span class="cc-archived-badge reason-item" title="Item Archived"><i class="fas fa-box-archive"></i> Item Archived</span>`;
        }
        const isSelected = detailsItemId === Number(item.id);
        const isChecked = selectedItemIds.has(Number(item.id));
        const hideActions = isArchived || selection.view === 'archived' || statusFilter === 'archived';
        return `
            <tr class="${isArchived ? 'cc-archived-row' : ''} ${isSelected ? 'is-selected' : ''}" data-item-row="${item.id}">
                <td class="col-check-cell">
                    <input type="checkbox" class="cc-item-check" data-item-id="${item.id}" ${isChecked ? 'checked' : ''} aria-label="Select ${esc(item.name)}">
                </td>
                <td class="col-name-cell" data-item-details="${item.id}" role="button" tabindex="0" title="Inspect ${esc(item.name)}">
                    <div class="cc-item-primary-row">
                        <span class="cc-item-name">${esc(item.name)}</span>
                    </div>
                    <div class="cc-item-sub-row">
                        <span class="cc-pill ${esc(String(item.item_type || 'part').toLowerCase())}">${displayItemType(item.item_type)}</span>
                        ${item.color ? `<span class="cc-swatch" style="background:${esc(item.color)}" title="Item color"></span>` : ''}
                        ${reasonBadge}
                        ${item.description ? `<span class="cc-item-desc-inline" title="${esc(item.description)}">${esc(item.description)}</span>` : ''}
                    </div>
                </td>
                <td class="col-uom-cell">${esc(item.unit_of_measure || 'ea')}</td>
                <td class="col-cost-cell cc-money"><strong>${metrics.primary}</strong></td>
                <td class="col-labor-cell">${formatLaborHours(item.labor_hours)} hr</td>
                <td class="col-cat-cell">${renderCatalogPill(item.catalog_name, item.catalog_id)}</td>
                <td class="col-group-cell cc-muted-cell">${esc(item.group_name || '-')}</td>
                <td class="col-actions-cell">
                    ${hideActions ? '' : `
                        <div class="cc-row-actions">
                            <button class="cc-btn cc-row-menu-toggle" type="button" data-item-menu="${item.id}" aria-label="Actions for ${esc(item.name)}" aria-expanded="false"><i class="fas fa-ellipsis-vertical" aria-hidden="true"></i></button>
                        </div>
                    `}
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
        const common = [
            detailField('Type', displayItemType(type)),
            detailField('Description', item.description),
            detailField('Unit of measure', item.unit_of_measure || 'ea'),
            detailField('Measurement type', item.measurement_type || 'count'),
            detailField('Catalog', item.catalog_name),
            detailField('Group', item.group_name),
            detailField('Cost code', item.cost_code),
            detailField('Part # / Catalog number', item.catalog_number),
            detailField('Notes', item.notes)
        ];
        const specific = [];
        const laborTimeSnippet = type === 'labor'
            ? ''
            : `<span class="cc-detail-metric-divider">·</span><span class="cc-detail-metric-labor" title="Labor time"><i class="fas fa-clock" aria-hidden="true"></i> ${formatLaborHours(item.labor_hours)} hr</span>`;
        const parts = type === 'assembly' ? (assemblyPartsByAssembly.get(Number(item.id))||[]) : [];
        const included = type === 'assembly' ? `
            <section class="cc-detail-section cc-included-section">
                <div class="cc-detail-section-header">
                    <h3><i class="fas fa-boxes-stacked" aria-hidden="true"></i> Included items</h3>
                    <span class="cc-detail-count-badge">${parts.length} ${parts.length === 1 ? 'item' : 'items'}</span>
                </div>
                <div class="cc-included-items">
                    ${parts.map((part) => {
                        const childName = esc(part.child_item_name || 'Catalog item');
                        const childUnit = esc(part.child_unit_of_measure || part.child_item_unit || 'ea');
                        const qtyVal = Number(part.quantity || 0);
                        const costSnap = money(part.unit_cost_snapshot);
                        const laborSnap = formatLaborHours(part.unit_labor_time_snapshot);
                        return `
                        <article class="cc-included-item-row">
                            <div class="cc-included-item-top">
                                <strong class="cc-included-item-name" title="${childName}">${childName}</strong>
                            </div>
                            <div class="cc-included-item-meta">
                                <span class="cc-included-qty">Qty: <strong class="cc-qty-accent">${qtyVal} ${childUnit}</strong></span>
                                <span class="cc-included-stat"><i class="fas fa-tag" aria-hidden="true"></i> Unit: <span>${costSnap}</span></span>
                                <span class="cc-included-stat"><i class="fas fa-clock" aria-hidden="true"></i> Labor: <span>${laborSnap} hr</span></span>
                            </div>
                        </article>`;
                    }).join('') || '<div class="cc-details-empty"><i class="fas fa-box-open" aria-hidden="true"></i><span>No included items in this assembly.</span></div>'}
                </div>
            </section>` : '';
        return `<section class="cc-detail-summary"><span class="cc-pill">${displayItemType(type)}</span><h3>${esc(item.name)}</h3><p>${esc(item.description || 'No description provided.')}</p><div class="cc-detail-metrics"><strong>${esc(metrics.primary)}</strong><span>${esc(metrics.secondary)}</span>${laborTimeSnippet}</div></section>${included}<section class="cc-detail-section"><h3>Item information</h3><dl class="cc-detail-list">${common.join('')}${specific.join('')}${detailField('Taxable', Number(item.taxable) ? 'Yes' : 'No')}${detailLink('EPD', item.epd_url)}${detailLink('Attachment', item.attachment_url)}</dl></section>`;
    }

    function openItemDetails(itemId, trigger) {
        const drawer = document.getElementById('ccItemDetailsDrawer');
        if (detailsItemId === Number(itemId) && drawer && drawer.classList.contains('open')) {
            closeItemDetails();
            return;
        }
        const item = (state.allItems?.length ? state.allItems : state.items).find(row => Number(row.id) === Number(itemId));
        if (!item) return;
        detailsItemId = Number(item.id);
        detailsReturnFocus = trigger || document.activeElement;
        document.querySelectorAll('#ccItemsBody tr.is-selected').forEach(r => r.classList.remove('is-selected'));
        const activeRow = document.querySelector(`#ccItemsBody tr[data-item-row="${itemId}"]`);
        if (activeRow) activeRow.classList.add('is-selected');
        document.getElementById('ccItemDetailsTitle').textContent = 'Item Details';
        document.getElementById('ccItemDetailsBody').innerHTML = renderItemDetails(item);
        if (drawer) {
            drawer.classList.add('open');
            drawer.setAttribute('aria-hidden', 'false');
        }
    }

    function closeItemDetails() {
        if (detailsItemId === null) return;
        detailsItemId = null;
        document.querySelectorAll('#ccItemsBody tr.is-selected').forEach(r => r.classList.remove('is-selected'));
        const drawer = document.getElementById('ccItemDetailsDrawer');
        if (drawer) {
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
        }
        const target = detailsReturnFocus;
        detailsReturnFocus = null;
        target?.focus?.();
    }

    function openItemRowMenu(triggerBtn, itemId) {
        itemId = Number(itemId);
        const menu = document.getElementById('ccRowItemFloatingMenu');
        if (!menu) return;

        if (!menu.hidden && triggerBtn.classList.contains('is-active')) {
            closeItemRowMenu();
            return;
        }

        closeItemRowMenu();

        const item = (state.allItems?.length ? state.allItems : state.items).find(r => Number(r.id) === itemId);
        if (!item) return;

        triggerBtn.classList.add('is-active');
        triggerBtn.setAttribute('aria-expanded', 'true');

        const isAssembly = String(item.item_type).toLowerCase() === 'assembly';
        menu.innerHTML = `
            <button type="button" data-floating-item-action="edit" data-id="${itemId}"><i class="fas fa-pen"></i>Edit</button>
            <button type="button" data-floating-item-action="duplicate" data-id="${itemId}"><i class="far fa-copy"></i>Duplicate</button>
            <button type="button" data-floating-item-action="move" data-id="${itemId}"><i class="fas fa-arrow-right-arrow-left"></i>Move</button>
            ${!isAssembly ? `<button type="button" data-floating-item-action="assembly" data-id="${itemId}"><i class="fas fa-cubes"></i>Convert to assembly</button>` : ''}
            <button type="button" class="danger" data-floating-item-action="delete" data-id="${itemId}"><i class="fas fa-box-archive"></i>Archive</button>
        `;
        menu.hidden = false;

        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const rect = triggerBtn.getBoundingClientRect();
        const menuWidth = 175;
        const menuHeight = isAssembly ? 140 : 175;

        let left = (rect.left / zoom) - menuWidth - 4;
        if (left < 10) {
            left = (rect.right / zoom) + 4;
        }

        let top = (rect.top / zoom);
        const maxTop = (window.innerHeight / zoom) - menuHeight - 12;
        if (top > maxTop) {
            top = Math.max(10, maxTop);
        }

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    }

    function closeItemRowMenu() {
        const menu = document.getElementById('ccRowItemFloatingMenu');
        if (menu) {
            menu.hidden = true;
            menu.innerHTML = '';
        }
        document.querySelectorAll('.cc-row-menu-toggle.is-active').forEach(b => {
            b.classList.remove('is-active');
            b.setAttribute('aria-expanded', 'false');
        });
    }

    function renderItemSelects() {
        const itemCat = document.getElementById('ccItemCatalog');
        const moveCat = document.getElementById('ccMoveCatalog');
        if (!state.catalogs || state.catalogs.length === 0) {
            const noCats = '<option value="" disabled selected>No catalogs available</option>';
            if (itemCat) itemCat.innerHTML = noCats;
            if (moveCat) moveCat.innerHTML = noCats;
            renderGroupSelect(document.getElementById('ccItemGroup'), 0);
            renderGroupSelect(document.getElementById('ccMoveGroup'), 0);
            return;
        }

        const catalogOptions = state.catalogs.map(catalog => `<option value="${catalog.id}">${esc(catalog.name)}</option>`).join('');
        if (itemCat) { itemCat.innerHTML = catalogOptions; itemCat._syncCustom?.(); }
        if (moveCat) { moveCat.innerHTML = catalogOptions; moveCat._syncCustom?.(); }

        renderGroupSelect(document.getElementById('ccItemGroup'), Number(itemCat?.value || selection.catalogId || 0));
        renderGroupSelect(document.getElementById('ccMoveGroup'), Number(moveCat?.value || selection.catalogId || 0));
    }

    function renderGroupSelect(select, catalogId, selectedId = '') {
        if (!select) return;
        if (!catalogId || !state.catalogs || state.catalogs.length === 0) {
            select.innerHTML = '<option value="" disabled selected>No groups available</option>';
            select._syncCustom?.();
            return;
        }

        const groups = state.groups.filter(group => Number(group.catalog_id) === Number(catalogId) && !group.deleted_at);
        if (groups.length === 0) {
            select.innerHTML = '<option value="" disabled selected>No groups available</option>';
            select._syncCustom?.();
            return;
        }

        select.innerHTML = '<option value="">No group</option>' + groups.map(group => `<option value="${group.id}" ${Number(selectedId) === Number(group.id) ? 'selected' : ''}>${esc(group.name)}</option>`).join('');
        select._syncCustom?.();
    }

    function displayItemType(type) {
        const normalized = String(type || 'part').toLowerCase();
        if (normalized === 'material' || normalized === 'part') return 'Part';
        if (normalized === 'travel') return 'Travel';
        return esc(normalized);
    }

    function currentCatalog() {
        if (selection.catalogId) return state.catalogs.find(row => Number(row.id) === Number(selection.catalogId)) || null;
        if (selection.groupId) {
            const group = state.groups.find(row => Number(row.id) === Number(selection.groupId));
            if (group) return state.catalogs.find(row => Number(row.id) === Number(group.catalog_id)) || null;
        }
        return null;
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

    async function catalogAction(action) {
        const catalog = currentCatalog();
        if (action === 'add') return openCatalogModal();
        if (!catalog) return;
        if (action === 'rename') return openCatalogModal(catalog);
        if (action === 'copy') return mutate('copy_catalog', revisionPayload(catalog,{ id: catalog.id }));
        if (action === 'up'||action==='down') return reorderEntity('catalog',catalog,action);
        if (action === 'delete') {
            const ok = await showConfirmDialog({
                title: 'Archive Catalog',
                message: `Archive catalog "${catalog.name}"? All its groups and items will be archived together.`,
                confirmText: 'Archive Catalog',
                cancelText: 'Cancel',
                type: 'warning',
                badge: 'ARCHIVE',
                icon: 'fas fa-box-archive'
            });
            if (!ok) return;
            return mutate('delete_catalog', revisionPayload(catalog,{ id: catalog.id }));
        }
        if (action === 'restore') return mutate('restore_catalog', revisionPayload(catalog,{ id: catalog.id }));
        if (action === 'purge') {
            const ok = await showConfirmDialog({
                title: 'Permanently Delete Catalog',
                message: `Are you sure you want to PERMANENTLY delete catalog "${catalog.name}" and all its contents? This action cannot be undone.`,
                confirmText: 'Delete Permanently',
                cancelText: 'Cancel',
                type: 'error',
                badge: 'PERMANENT DELETE',
                icon: 'fas fa-trash-can',
                primaryDanger: true
            });
            if (!ok) return;
            return mutate('purge_catalog', revisionPayload(catalog,{ id: catalog.id }));
        }
        if (action === 'active' || action === 'enabled' || action === 'toggle_status') return mutate('toggle_catalog', revisionPayload(catalog,{ id: catalog.id, field: 'active' }));
    }

    async function groupAction(action) {
        const group = currentGroup();
        if (action === 'add') return openGroupModal(null, selection.catalogId);
        if (!group) return;
        if (action === 'rename'||action==='move') return openGroupModal(group);
        if (action === 'copy') return mutate('copy_group', revisionPayload(group,{ id: group.id }));
        if (action === 'up'||action==='down') return reorderEntity('group',group,action);
        if (action === 'delete') return openGroupArchive(group);
        if (action === 'restore') return mutate('restore_group', revisionPayload(group,{ id: group.id }));
        if (action === 'purge') {
            const ok = await showConfirmDialog({
                title: 'Permanently Delete Group',
                message: `Are you sure you want to PERMANENTLY delete group "${group.name}" and all its contents? This action cannot be undone.`,
                confirmText: 'Delete Permanently',
                cancelText: 'Cancel',
                type: 'error',
                badge: 'PERMANENT DELETE',
                icon: 'fas fa-trash-can',
                primaryDanger: true
            });
            if (!ok) return;
            return mutate('purge_group', revisionPayload(group,{ id: group.id }));
        }
        if (action === 'active' || action === 'enabled' || action === 'toggle_status') return mutate('toggle_group', revisionPayload(group,{ id: group.id, field: 'active' }));
    }

    function revisionPayload(entity,payload={}){return entity?.revision!==undefined&&entity?.revision!==null?{...payload,expected_revision:Number(entity.revision)}:payload;}

    let catalogEditor = null;
    let groupEditor = null;
    let archivingGroupId = null;

    function openCatalogModal(catalog = null) {
        catalogEditor = catalog;
        const modal = document.getElementById('ccCatalogModal');
        if (!modal) return;
        document.getElementById('ccCatalogModalTitle').innerHTML = `<i class="fas fa-book"></i> ${catalog ? 'Edit Catalog' : 'Create Catalog'}`;
        document.getElementById('ccCatalogName').value = catalog?.name || '';
        document.getElementById('ccCatalogDescription').value = catalog?.description || '';
        document.getElementById('ccCatalogError').hidden = true;
        modal.classList.add('open');
        document.getElementById('ccCatalogName').focus();
    }

    function closeCatalogModal() {
        document.getElementById('ccCatalogModal')?.classList.remove('open');
        catalogEditor = null;
    }

    async function saveCatalog(event) {
        event.preventDefault();
        const button = document.getElementById('ccCatalogSave');
        const error = document.getElementById('ccCatalogError');
        const name = document.getElementById('ccCatalogName').value.trim();
        if (!name) return;
        button.disabled = true;
        error.hidden = true;
        const payload = revisionPayload(catalogEditor, {
            id: catalogEditor?.id || 0,
            name,
            description: document.getElementById('ccCatalogDescription').value.trim(),
            trade: catalogEditor?.trade || name,
            active: catalogEditor ? Number(catalogEditor.active) : 1,
            enabled_for_projects: catalogEditor ? Number(catalogEditor.enabled_for_projects) : 1,
            locked: Number(catalogEditor?.locked || 0),
            sort_order: Number(catalogEditor?.sort_order || 0)
        });
        try {
            const data = await request('save_catalog', payload);
            state = data.data;
            selection = { view: 'catalog', catalogId: Number(data.id), groupId: null };
            closeCatalogModal();
            render();
        } catch (err) {
            error.textContent = err.code === 'revision_conflict' ? 'This record changed elsewhere. Reload to review the latest version.' : err.message;
            error.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    function openGroupModal(group = null, prefillCatalogId = null, prefillParentId = null) {
        if (!state.catalogs.length) return showError('Create a catalog before adding groups.');
        groupEditor = group;
        const modal = document.getElementById('ccGroupModal');
        if (!modal) return;
        document.getElementById('ccGroupModalTitle').innerHTML = `<i class="fas fa-folder"></i> ${group ? 'Edit Group' : 'Create Group'}`;
        document.getElementById('ccGroupName').value = group?.name || '';
        document.getElementById('ccGroupDescription').value = group?.description || '';
        const catSelect = document.getElementById('ccGroupCatalog');
        catSelect.innerHTML = state.catalogs.filter(c => !c.deleted_at).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
        catSelect.value = String(group?.catalog_id || prefillCatalogId || selection.catalogId || state.catalogs[0]?.id || '');
        catSelect._syncCustom?.();
        renderGroupParents(group);
        if (prefillParentId && !group) {
            const gp = document.getElementById('ccGroupParent');
            if (gp) {
                gp.value = String(prefillParentId);
                gp._syncCustom?.();
            }
        }
        document.getElementById('ccGroupError').hidden = true;
        modal.classList.add('open');
        document.getElementById('ccGroupName').focus();
    }

    function closeGroupModal() {
        document.getElementById('ccGroupModal')?.classList.remove('open');
        groupEditor = null;
    }

    function renderGroupParents(group = null) {
        const catalogId = Number(document.getElementById('ccGroupCatalog')?.value || 0);
        const select = document.getElementById('ccGroupParent');
        if (!select) return;
        const currentId = Number(group?.id || 0);
        const hasChildren = currentId && state.groups.some(c => Number(c.parent_group_id) === currentId && !c.deleted_at);
        if (hasChildren) {
            select.innerHTML = '<option value="">None (Top-level group with sub-groups)</option>';
            select.value = '';
            select.disabled = true;
            select._syncCustom?.();
            return;
        }
        select.disabled = false;
        const options = ['<option value="">None (Top-level group in catalog)</option>'];
        // Only root groups (!g.parent_group_id) can be parents - NO CHAINED SUBGROUPS!
        state.groups.filter(g => Number(g.catalog_id) === catalogId && !g.deleted_at && Number(g.id) !== currentId && !g.parent_group_id)
            .forEach(g => {
                const childCount = state.groups.filter(c => Number(c.parent_group_id) === Number(g.id) && !c.deleted_at && Number(c.id) !== currentId).length;
                const isCurrentParent = Number(group?.parent_group_id || 0) === Number(g.id);
                if (childCount >= 3 && !isCurrentParent) {
                    options.push(`<option value="${g.id}" disabled>${esc(g.name)} (Max 3 sub-groups reached)</option>`);
                } else {
                    options.push(`<option value="${g.id}">${esc(g.name)}${childCount > 0 ? ` (${childCount}/3 sub-groups)` : ''}</option>`);
                }
            });
        select.innerHTML = options.join('');
        select.value = String(group?.parent_group_id || '');
        select._syncCustom?.();
    }

    async function saveGroup(event) {
        event.preventDefault();
        const button = document.getElementById('ccGroupSave');
        const error = document.getElementById('ccGroupError');
        const name = document.getElementById('ccGroupName').value.trim();
        const catalogId = Number(document.getElementById('ccGroupCatalog').value);
        if (!name || !catalogId) return;

        const parentId = Number(document.getElementById('ccGroupParent').value || 0);
        if (parentId) {
            const parentObj = state.groups.find(g => Number(g.id) === parentId);
            if (parentObj && parentObj.parent_group_id) {
                error.textContent = 'Sub-groups cannot have nested sub-groups. Maximum depth is 1 level.';
                error.hidden = false;
                return;
            }
            const currentId = Number(groupEditor?.id || 0);
            const hasChildren = currentId && state.groups.some(c => Number(c.parent_group_id) === currentId && !c.deleted_at);
            if (hasChildren) {
                error.textContent = 'A group that contains sub-groups cannot be converted into a sub-group.';
                error.hidden = false;
                return;
            }
            const childCount = state.groups.filter(c => Number(c.parent_group_id) === parentId && !c.deleted_at && Number(c.id) !== currentId).length;
            if (childCount >= 3 && Number(groupEditor?.parent_group_id || 0) !== parentId) {
                error.textContent = 'This group already has the maximum of 3 sub-groups.';
                error.hidden = false;
                return;
            }
        }

        button.disabled = true;
        error.hidden = true;
        const payload = revisionPayload(groupEditor, {
            id: groupEditor?.id || 0,
            name,
            catalog_id: catalogId,
            parent_group_id: document.getElementById('ccGroupParent').value || null,
            description: document.getElementById('ccGroupDescription').value.trim(),
            active: groupEditor ? Number(groupEditor.active) : 1,
            enabled_for_projects: groupEditor ? Number(groupEditor.enabled_for_projects) : 1,
            sort_order: Number(groupEditor?.sort_order || 0)
        });
        try {
            const data = await request('save_group', payload);
            state = data.data;
            selection = { view: 'group', catalogId: null, groupId: Number(data.id) };
            closeGroupModal();
            render();
        } catch (err) {
            error.textContent = err.code === 'revision_conflict' ? 'This record changed elsewhere. Reload to review the latest version.' : err.message;
            error.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    function reorderEntity(kind,entity,direction){const list=(kind==='catalog'?state.catalogs:state.groups.filter(g=>Number(g.catalog_id)===Number(entity.catalog_id)&&Number(g.parent_group_id||0)===Number(entity.parent_group_id||0))).filter(row=>!row.deleted_at).slice().sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||Number(a.id)-Number(b.id));const index=list.findIndex(row=>Number(row.id)===Number(entity.id)),other=direction==='up'?index-1:index+1;if(index<0||other<0||other>=list.length)return;[list[index],list[other]]=[list[other],list[index]];mutate(kind==='catalog'?'reorder_catalogs':'reorder_groups',kind==='catalog'?{ordered_ids:list.map(row=>row.id)}:{catalog_id:entity.catalog_id,parent_group_id:entity.parent_group_id||'',ordered_ids:list.map(row=>row.id)});}

    function openGroupArchive(group){archivingGroupId=Number(group.id);const descendants=state.groups.filter(g=>Number(g.parent_group_id||0)===Number(group.id));const items=(state.allItems||state.items).filter(i=>Number(i.catalog_group_id||0)===Number(group.id));document.getElementById('ccArchiveGroupImpact').textContent=`${items.length} item(s) and ${descendants.length} direct subgroup(s) are affected. Items will be moved, never deleted.`;const target=document.getElementById('ccArchiveGroupTarget');target.innerHTML='<option value="">Ungrouped</option>'+state.groups.filter(g=>Number(g.catalog_id)===Number(group.catalog_id)&&Number(g.id)!==Number(group.id)&&!g.deleted_at).map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('');document.getElementById('ccArchiveGroupTree').checked=descendants.length>0;document.getElementById('ccArchiveGroupModal').classList.add('open');}
    async function archiveGroup(event){event.preventDefault();const group=state.groups.find(g=>Number(g.id)===archivingGroupId),error=document.getElementById('ccArchiveGroupError');if(!group)return;error.hidden=true;try{const data=await request('delete_group',revisionPayload(group,{id:group.id,target_group_id:document.getElementById('ccArchiveGroupTarget').value,archive_tree:document.getElementById('ccArchiveGroupTree').checked?1:0}));state=data.data;selection={view:'catalog',catalogId:Number(group.catalog_id),groupId:null};closeGroupArchive();render();}catch(err){error.textContent=err.message;error.hidden=false;}}
    function closeGroupArchive(){document.getElementById('ccArchiveGroupModal')?.classList.remove('open');archivingGroupId=null;}

    async function itemAction(action, id) {
        const item = (state.allItems?.length?state.allItems:state.items).find(row => Number(row.id) === id);
        if (!item) return;
        if (action === 'edit') return openItemModal(item);
        if (action === 'duplicate') return mutate('duplicate_item', revisionPayload(item,{ id }));
        if (action === 'move') return openMoveItemModal(item);
        if (action === 'assembly') return mutate('convert_item_assembly', currentContextPayload(revisionPayload(item,{ id })));
        if (action === 'delete') {
            const ok = await showConfirmDialog({
                title: 'Archive Item',
                message: `Archive item "${item.name}"? It will be moved to Archived Items.`,
                confirmText: 'Archive Item',
                cancelText: 'Cancel',
                type: 'warning',
                badge: 'ARCHIVE',
                icon: 'fas fa-box-archive'
            });
            if (!ok) return;
            return mutate('delete_item', currentContextPayload(revisionPayload(item,{ id })));
        }
        if (action === 'restore') return mutate('restore_item', currentContextPayload(revisionPayload(item,{ id })));
        if (action === 'purge') {
            const ok = await showConfirmDialog({
                title: 'Permanently Delete Item',
                message: `Are you sure you want to PERMANENTLY delete item "${item.name}"? This action cannot be undone.`,
                confirmText: 'Delete Permanently',
                cancelText: 'Cancel',
                type: 'error',
                badge: 'PERMANENT DELETE',
                icon: 'fas fa-trash-can',
                primaryDanger: true
            });
            if (!ok) return;
            return mutate('purge_item', currentContextPayload(revisionPayload(item,{ id })));
        }
    }

    async function handleArchivedCatalogAction(action, id) {
        const cat = (state.archivedCatalogs || []).find(c => Number(c.id) === id);
        if (!cat) return;
        if (action === 'restore') return mutate('restore_catalog', revisionPayload(cat, { id }));
        if (action === 'purge') {
            const ok = await showConfirmDialog({
                title: 'Permanently Delete Catalog',
                message: `Are you sure you want to PERMANENTLY delete catalog "${cat.name}" and all its contents? This action cannot be undone.`,
                confirmText: 'Delete Permanently',
                cancelText: 'Cancel',
                type: 'error',
                badge: 'PERMANENT DELETE',
                icon: 'fas fa-trash-can',
                primaryDanger: true
            });
            if (!ok) return;
            return mutate('purge_catalog', revisionPayload(cat, { id }));
        }
    }

    async function handleArchivedGroupAction(action, id) {
        const grp = (state.archivedGroups || []).find(g => Number(g.id) === id);
        if (!grp) return;
        if (action === 'restore') return mutate('restore_group', revisionPayload(grp, { id }));
        if (action === 'purge') {
            const ok = await showConfirmDialog({
                title: 'Permanently Delete Group',
                message: `Are you sure you want to PERMANENTLY delete group "${grp.name}" and all its contents? This action cannot be undone.`,
                confirmText: 'Delete Permanently',
                cancelText: 'Cancel',
                type: 'error',
                badge: 'PERMANENT DELETE',
                icon: 'fas fa-trash-can',
                primaryDanger: true
            });
            if (!ok) return;
            return mutate('purge_group', revisionPayload(grp, { id }));
        }
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

    const CC_SYMBOLS = [
        { id: 'Solid Circle', label: 'Circle', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="8.5"/></svg>' },
        { id: 'Square', label: 'Square', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3.5" y="3.5" width="17" height="17" rx="1"/></svg>' },
        { id: 'Triangle', label: 'Triangle', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="12 3 22 21 2 21"/></svg>' },
        { id: 'Octagon', label: 'Octagon', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"/></svg>' },
        { id: 'Diamond', label: 'Diamond', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="12 2 22 12 12 22 2 12"/></svg>' },
        { id: 'Checkmark', label: 'Checkmark', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' },
        { id: 'Cross', label: 'Cross', svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>' }
    ];

    const CC_RICH_COLORS = [
        '#2563eb', '#7c3aed', '#3b5998', '#0ea5e9', '#00d2ff', '#009688',
        '#16a34a', '#84cc16', '#a3e635', '#fde047', '#f59e0b', '#f97316',
        '#ef4444', '#78350f', '#000000'
    ];

    function setupItemSymbolDropdown() {
        const dropdown = document.getElementById('ccItemSymbolDropdown');
        const trigger = document.getElementById('ccItemSymbolTrigger');
        const menu = document.getElementById('ccItemSymbolMenu');
        const hiddenInput = document.getElementById('ccItemSymbol');
        if (!dropdown || !trigger || !menu || !hiddenInput) return;

        const currentVal = (hiddenInput.value || 'Solid Circle').toLowerCase();
        menu.className = 'pro-custom-dropdown-menu pcd-select-menu pcd-symbol-menu';
        menu.innerHTML = `
            <div class="pcd-select-group-header">Symbols</div>
            ${CC_SYMBOLS.map(sym => {
                const isSel = sym.id.toLowerCase() === currentVal || sym.label.toLowerCase() === currentVal;
                return `
                <div class="pcd-select-item pcd-symbol-item ${isSel ? 'is-selected' : ''}" data-symbol="${esc(sym.id)}" role="option" aria-selected="${isSel}">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span class="pcd-symbol-icon" style="width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;">${sym.svg}</span>
                        <span class="pcd-select-text">${esc(sym.label)}</span>
                    </div>
                    ${isSel ? '<i class="fas fa-check pcd-check" aria-hidden="true"></i>' : ''}
                </div>
            `}).join('')}
        `;

        trigger.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            document.querySelectorAll('.pro-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
            if (!isOpen) dropdown.classList.add('is-open');
        });

        menu.querySelectorAll('.pcd-symbol-item').forEach(item => {
            item.addEventListener('click', e => {
                e.stopPropagation();
                setItemSymbol(item.dataset.symbol);
                dropdown.classList.remove('is-open');
            });
        });
    }

    function setItemSymbol(symId) {
        const hiddenInput = document.getElementById('ccItemSymbol');
        const preview = document.getElementById('ccItemSymbolPreview');
        const menu = document.getElementById('ccItemSymbolMenu');
        const targetId = String(symId || '').toLowerCase();
        const found = CC_SYMBOLS.find(s => s.id.toLowerCase() === targetId || s.label.toLowerCase() === targetId) || CC_SYMBOLS[0];
        if (hiddenInput) hiddenInput.value = found.id;
        if (preview) preview.innerHTML = found.svg;
        if (menu) {
            menu.querySelectorAll('.pcd-symbol-item').forEach(el => {
                const isSel = el.dataset.symbol.toLowerCase() === found.id.toLowerCase();
                el.classList.toggle('is-selected', isSel);
                el.setAttribute('aria-selected', isSel);
                let check = el.querySelector('.pcd-check');
                if (isSel && !check) {
                    const i = document.createElement('i');
                    i.className = 'fas fa-check pcd-check';
                    i.setAttribute('aria-hidden', 'true');
                    el.appendChild(i);
                } else if (!isSel && check) {
                    check.remove();
                }
            });
        }
    }

    function setupItemColorDropdown() {
        const dropdown = document.getElementById('ccItemColorDropdown');
        const trigger = document.getElementById('ccItemColorTrigger');
        const menu = document.getElementById('ccItemColorMenu');
        const colorInput = document.getElementById('ccItemColor');
        if (!dropdown || !trigger || !menu || !colorInput) return;

        menu.innerHTML = `
            <div class="pcd-color-vertical-list">
                ${CC_RICH_COLORS.map(color => `
                    <div class="pcd-color-item" data-color="${color}" title="${color}">
                        <span class="pcd-color-circle" style="background:${color};"></span>
                    </div>
                `).join('')}
            </div>
            <div class="pcd-color-custom-footer">
                <button type="button" class="pcd-add-custom-color-btn" id="ccItemAddCustomColorBtn" title="Choose custom color">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
        `;

        trigger.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            document.querySelectorAll('.pro-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
            if (!isOpen) dropdown.classList.add('is-open');
        });

        menu.querySelectorAll('.pcd-color-item').forEach(item => {
            item.addEventListener('click', e => {
                e.stopPropagation();
                setItemColor(item.dataset.color);
                dropdown.classList.remove('is-open');
            });
        });

        const customBtn = document.getElementById('ccItemAddCustomColorBtn');
        if (customBtn) {
            customBtn.addEventListener('click', e => {
                e.stopPropagation();
                dropdown.classList.remove('is-open');
                colorInput.click();
            });
        }

        colorInput.addEventListener('input', e => {
            setItemColor(e.target.value);
            dropdown.classList.remove('is-open');
        });
        colorInput.addEventListener('change', e => {
            setItemColor(e.target.value);
            dropdown.classList.remove('is-open');
        });
    }

    function setItemColor(hex) {
        hex = hex || '#2563eb';
        const colorInput = document.getElementById('ccItemColor');
        const swatch = document.getElementById('ccItemColorSwatch');
        const menu = document.getElementById('ccItemColorMenu');
        if (colorInput) colorInput.value = hex;
        if (swatch) swatch.style.backgroundColor = hex;
        if (menu) {
            menu.querySelectorAll('.pcd-color-item').forEach(el => {
                el.classList.toggle('is-selected', (el.dataset.color || '').toLowerCase() === hex.toLowerCase());
            });
        }
    }

    function enhanceSelect(selectEl) {
        if (!selectEl) return;
        if (typeof window.enhanceSelect === 'function') {
            return window.enhanceSelect(selectEl);
        }
    }

    function initCustomSelects() {
        if (typeof window.initCustomSelects === 'function') {
            window.initCustomSelects();
            return;
        }
    }

    function initDropzone() {
        const dropzone = document.getElementById('ccItemDropzone');
        const fileInput = document.getElementById('ccItemPdf');
        const browseBtn = document.getElementById('ccBrowseFileBtn');
        const placeholder = document.getElementById('ccDropzonePlaceholder');
        const current = document.getElementById('ccItemPdfCurrent');
        const imgThumb = document.getElementById('ccAttachedImgThumb');
        const fileIcon = document.getElementById('ccAttachedFileIcon');
        const meta = document.getElementById('ccItemPdfMeta');
        const nameEl = document.getElementById('ccItemPdfName');

        if (!dropzone || !fileInput) return;

        const openFileDialog = (e) => {
            if (e.target.closest('#ccItemPdfView') || e.target.closest('#ccItemPdfRemove') || e.target.closest('.cc-attached-actions')) return;
            fileInput.click();
        };

        dropzone.addEventListener('click', openFileDialog);
        browseBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });

        ['dragenter', 'dragover'].forEach(name => {
            dropzone.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('is-dragover');
            });
        });

        ['dragleave', 'drop'].forEach(name => {
            dropzone.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('is-dragover');
            });
        });

        dropzone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files[0]) {
                fileInput.files = dt.files;
                handleSelectedFile(dt.files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleSelectedFile(e.target.files[0]);
            }
        });

        function handleSelectedFile(file) {
            const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
            const sizeMb = (file.size / 1048576).toFixed(1);
            if (nameEl) nameEl.textContent = `${file.name} · ${sizeMb} MB`;
            if (meta) meta.textContent = isImg ? 'Selected image (pending save)' : 'Selected PDF (pending save)';

            if (isImg && imgThumb && fileIcon) {
                try {
                    imgThumb.src = URL.createObjectURL(file);
                    imgThumb.style.display = 'block';
                    fileIcon.style.display = 'none';
                } catch (_) {}
            } else if (imgThumb && fileIcon) {
                imgThumb.style.display = 'none';
                fileIcon.style.display = 'block';
                fileIcon.className = 'fas fa-file-pdf';
                fileIcon.style.color = '#ef4444';
            }

            if (placeholder) placeholder.hidden = true;
            if (current) current.hidden = false;
            const feedback = document.getElementById('ccItemPdfFeedback');
            if (feedback) feedback.textContent = `${file.name} selected. It will be uploaded when you save.`;
        }
    }

    function openItemModal(item = null) {
        document.querySelectorAll('.pro-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
        modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        editingItemId = item ? Number(item.id) : null;
        document.getElementById('ccItemModalTitle').textContent = editingItemId ? 'Edit Catalog Item' : 'Create Catalog Item';
        document.getElementById('ccItemForm').reset();
        const catalogId = item ? Number(item.catalog_id) : selectedCatalogForNewItem();
        const groupId = item ? Number(item.catalog_group_id || 0) : (selection.groupId || '');
        const catSelect = document.getElementById('ccItemCatalog');
        if (catSelect) { catSelect.value = catalogId; catSelect._syncCustom?.(); }
        renderGroupSelect(document.getElementById('ccItemGroup'), catalogId, groupId);
        const grpSelect = document.getElementById('ccItemGroup');
        if (grpSelect) { grpSelect.value = groupId || ''; grpSelect._syncCustom?.(); }

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = val;
                el._syncCustom?.();
            }
        };
        setVal('ccItemName', item?.name || '');
        setVal('ccItemDescription', item?.description || '');
        setVal('ccItemType', item?.item_type === 'material' ? 'part' : (item?.item_type || 'part'));
        const mType = item?.measurement_type || 'count';
        setVal('ccItemMeasurementType', mType);
        const uom = item?.unit_of_measure || MEASUREMENT_DEFAULT_UOM[mType] || 'ea';
        setVal('ccItemUom', uom);
        const uomEl = document.getElementById('ccItemUom');
        if (uomEl) uomEl.readOnly = true;
        setVal('ccItemUnitCost', Number(item?.unit_cost || 0).toFixed(2));
        setVal('ccItemMaterialCost', Number(item?.material_cost || 0).toFixed(2));
        setVal('ccItemLaborCost', Number(item?.labor_cost || 0).toFixed(2));
        setVal('ccItemEquipmentCost', Number(item?.equipment_cost || 0).toFixed(2));
        setVal('ccItemLaborHours', item ? formatLaborHours(item.labor_hours) : '0.00');
        setVal('ccItemLaborRate', Number(item?.labor_rate || 0).toFixed(2));
        setVal('ccItemMarkup', item?.markup_percent || '0');
        setVal('ccItemWaste', item?.waste_factor_percent || '0');
        setVal('ccItemTaxable', String(item?.taxable ?? '1'));
        
        setItemColor(item?.color || '#2563eb');
        setItemSymbol(item?.symbol || 'Solid Circle');

        setVal('ccItemCatalogNumber', item?.catalog_number || item?.sku || '');
        setVal('ccItemCostCode', item?.cost_code || '');
        setVal('ccItemAttachmentUrl', item?.attachment_url || '');
        setVal('ccItemNotes', item?.notes || '');

        let tags = [];
        try {
            tags = typeof item?.tags_json === 'string' ? JSON.parse(item.tags_json || '[]') : (item?.tags_json || []);
        } catch (_) { tags = []; }
        setVal('ccItemTags', Array.isArray(tags) ? tags.map(tag => typeof tag === 'string' ? tag : (tag.name || '')).filter(Boolean).join(', ') : '');
        setVal('ccItemAttributes', typeof item?.attributes_json === 'string' ? item.attributes_json : JSON.stringify(item?.attributes_json || {}, null, 2));

        renderPdfAttachment(item);
        initStagedAssemblyComponents(item);
        toggleAssemblySection();
        document.getElementById('ccItemModal').classList.add('open');
        document.getElementById('ccItemModal').setAttribute('role', 'dialog');
        document.getElementById('ccItemModal').setAttribute('aria-modal', 'true');
        document.getElementById('ccItemName').focus();
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
                rawRatio: String(part.quantity !== undefined && part.quantity !== null ? Number(part.quantity) : 1),
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
                unitCost: Number(childItem?.unit_cost || 0),
                laborHours: Number(childItem?.labor_hours || 0),
                ratio: 1,
                rawRatio: '1',
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
        if (catalog) {
            const selected = catalog.value || '';
            catalog.innerHTML = '<option value="">All catalogs</option>' + state.catalogs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
            catalog.value = selected;
        }
        const category = document.getElementById('ccAssemblyCategoryFilter');
        if (category) {
            const selectedCategory = category.value || '';
            category.innerHTML = '<option value="">All groups</option>' + state.groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
            category.value = selectedCategory;
        }
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

        const totalItems = rows.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / ASSEMBLY_PAGE_SIZE));
        if (assemblyBrowserPage > totalPages) assemblyBrowserPage = totalPages;
        if (assemblyBrowserPage < 1) assemblyBrowserPage = 1;

        const startIdx = (assemblyBrowserPage - 1) * ASSEMBLY_PAGE_SIZE;
        const endIdx = Math.min(startIdx + ASSEMBLY_PAGE_SIZE, totalItems);
        const pageRows = rows.slice(startIdx, endIdx);

        root.innerHTML = pageRows.map(i => {
            const isSelected = stagedAssemblyComponents.has(Number(i.id));
            const catColor = getCatalogColor(i.catalog_name, i.catalog_id);
            return `
                <div class="cc-assembly-item-row ${isSelected ? 'is-selected' : ''}" role="option" aria-selected="${isSelected}" data-assembly-select="${i.id}">
                    <div class="cc-assembly-item-check-cell">
                        <input type="checkbox" class="cc-assembly-item-checkbox" data-assembly-item-check="${i.id}" ${isSelected ? 'checked' : ''} aria-label="Select ${esc(i.name)}">
                    </div>
                    <div class="cc-assembly-item-main">
                        <strong class="cc-assembly-item-title">${esc(i.name)}</strong>
                        <div class="cc-assembly-item-sub">
                            <span class="cc-assembly-badge" style="border-left: 3px solid ${catColor};">${esc(i.catalog_name || 'Catalog')}</span>
                            <span>${esc(i.group_name || 'Ungrouped')}</span>
                            <span class="cc-pill mini">${displayItemType(i.item_type)}</span>
                            <span>${esc(i.unit_of_measure || 'ea')}</span>
                            ${i.cost_code ? `<span class="cc-code">${esc(i.cost_code)}</span>` : ''}
                        </div>
                    </div>
                    <div class="cc-assembly-item-pricing">
                        <span class="cc-money">${money(i.unit_cost)}</span>
                        <small>${formatLaborHours(i.labor_hours)} hr</small>
                    </div>
                </div>
            `;
        }).join('') || '<p class="cc-assembly-no-results">No matching items found. Try adjusting your search or filters.</p>';

        renderAssemblyPagination(totalItems, totalPages, totalItems > 0 ? startIdx + 1 : 0, endIdx);

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

    function renderAssemblyPagination(totalItems, totalPages, displayStart, displayEnd) {
        const pag = document.getElementById('ccAssemblyPagination');
        if (!pag) return;
        pag.hidden = totalItems <= ASSEMBLY_PAGE_SIZE;
        const startEl = document.getElementById('ccAssemblyPageStart');
        const endEl = document.getElementById('ccAssemblyPageEnd');
        const totalEl = document.getElementById('ccAssemblyPageTotal');
        if (startEl) startEl.textContent = displayStart;
        if (endEl) endEl.textContent = displayEnd;
        if (totalEl) totalEl.textContent = totalItems;

        const prevBtn = document.getElementById('ccAssemblyPagePrev');
        const nextBtn = document.getElementById('ccAssemblyPageNext');
        if (prevBtn) prevBtn.disabled = assemblyBrowserPage <= 1;
        if (nextBtn) nextBtn.disabled = assemblyBrowserPage >= totalPages;

        const numbers = document.getElementById('ccAssemblyPaginationNumbers');
        if (!numbers) return;

        let pages = [];
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            pages.push(1);
            if (assemblyBrowserPage > 3) pages.push('...');
            const start = Math.max(2, assemblyBrowserPage - 1);
            const end = Math.min(totalPages - 1, assemblyBrowserPage + 1);
            for (let i = start; i <= end; i++) pages.push(i);
            if (assemblyBrowserPage < totalPages - 2) pages.push('...');
            pages.push(totalPages);
        }

        numbers.innerHTML = pages.map(p => {
            if (p === '...') return `<span class="cc-page-ellipsis">&hellip;</span>`;
            const isActive = p === assemblyBrowserPage;
            return `<button type="button" class="cc-page-number ${isActive ? 'active' : ''}" data-assembly-page="${p}">${p}</button>`;
        }).join('');

        numbers.querySelectorAll('[data-assembly-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                assemblyBrowserPage = Number(btn.dataset.assemblyPage);
                renderAssemblyBrowserResults();
                document.getElementById('ccAssemblyResults')?.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    }

    function isAssemblyType() {
        return document.getElementById('ccItemType').value === 'assembly';
    }

    function toggleAssemblySection() {
        const section = document.getElementById('ccAssemblySection');
        if (!section) return;
        const isAssembly = isAssemblyType();
        section.style.display = isAssembly ? 'block' : 'none';
        section.classList.toggle('is-open', isAssembly);
        section.hidden = !isAssembly;
        const type = document.getElementById('ccItemType').value;
        document.querySelectorAll('[data-item-specific]').forEach(field => { field.hidden = !field.dataset.itemSpecific.split(' ').includes(type); });
        document.getElementById('ccItemUnitCost').readOnly = isAssembly;
        document.getElementById('ccItemLaborHours').readOnly = isAssembly;
        document.getElementById('ccItemUnitCostHint').textContent = isAssembly ? 'Calculated from included items' : '';
        document.getElementById('ccItemLaborHoursHint').textContent = isAssembly ? 'Calculated from included items' : '';
        renderAssemblyParts();
        if (isAssembly) {
            renderAssemblyItemOptions();
            renderAssemblyBrowserResults();
        }
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

        body.innerHTML = components.map((part) => {
            const qty = Number(part.ratio ?? 1);
            const unitCost = Number(part.unitCost || 0);
            const labor = Number(part.laborHours || 0);
            const displayQty = part.rawRatio !== undefined ? part.rawRatio : (Number.isInteger(qty) ? qty : parseFloat(qty.toFixed(4)).toString());

            return `
                <tr data-part-row="${part.itemId}" class="cc-assembly-part-row" draggable="true">
                    <td class="cc-assembly-drag-cell" title="Drag to reorder">
                        <span class="cc-assembly-drag-handle">
                            <i class="fas fa-grip-vertical"></i>
                        </span>
                    </td>
                    <td style="text-align: right; width: 90px;">
                        <input class="cc-qty-input" data-part-quantity="${part.itemId}" type="text" value="${esc(displayQty)}" placeholder="1 or 2/100" title="Multiplier (e.g. 2, 0.05, 2/100)" aria-label="Multiplier for ${esc(part.name)}">
                    </td>
                    <td>
                        <strong>${esc(part.name)}</strong>
                    </td>
                    <td style="text-align: center; width: 60px;">
                        <span class="cc-pill" style="font-size: 11px;">${esc(part.unit || 'ea')}</span>
                    </td>
                    <td style="text-align: right; width: 90px;">${money(unitCost)}</td>
                    <td style="text-align: right; width: 95px;">${formatLaborHours(labor)}</td>
                    <td style="text-align: center; width: 50px;">
                        <button class="cc-part-remove-btn" type="button" data-assembly-part-delete="${part.itemId}" title="Remove component from assembly" aria-label="Remove ${esc(part.name)}">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="7" class="cc-assembly-empty" style="text-align: center; padding: 24px 12px; color: var(--text-muted);"><i class="fas fa-boxes-stacked" style="font-size: 20px; display: block; margin-bottom: 6px; opacity: 0.5;"></i>No items included yet. Select items from the list above to add them to this assembly.</td></tr>';

        const stored = editingItemId ? (state.allItems?.length ? state.allItems : state.items).find(item => Number(item.id) === Number(editingItemId)) : null;
        const storedCost = canonicalValid ? totalCost : Number(stored?.unit_cost || totalCost);
        const storedLabor = canonicalValid ? totalLabor : Number(stored?.labor_hours || totalLabor);
        document.getElementById('ccItemUnitCost').value = Number(totalCost || 0).toFixed(2);
        document.getElementById('ccItemLaborHours').value = formatLaborHours(totalLabor);

        totalsEl.textContent = `Cost ${money(totalCost)} · Labor ${formatLaborHours(totalLabor)}`;

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
                const oldSel = input.selectionStart;
                const oldVal = input.value;
                const sanitized = sanitizeQuantityInput(oldVal);
                if (oldVal !== sanitized) {
                    input.value = sanitized;
                    const newSel = Math.min(oldSel, sanitized.length);
                    try { input.setSelectionRange(newSel, newSel); } catch (_) {}
                }
                const itemId = Number(input.dataset.partQuantity);
                const comp = stagedAssemblyComponents.get(itemId);
                if (comp) {
                    comp.rawRatio = input.value;
                    comp.ratio = parseQuantityExpression(input.value);
                    updateAssemblyTotalsPreview();
                }
            });
            input.addEventListener('change', () => {
                const sanitized = sanitizeQuantityInput(input.value.trim());
                input.value = sanitized;
                const itemId = Number(input.dataset.partQuantity);
                const comp = stagedAssemblyComponents.get(itemId);
                if (comp) {
                    comp.rawRatio = sanitized;
                    comp.ratio = parseQuantityExpression(sanitized);
                    renderAssemblyParts();
                }
            });
        });

        // HTML5 Drag and Drop for reordering rows
        let draggedItemId = null;
        body.querySelectorAll('.cc-assembly-part-row').forEach(row => {
            row.addEventListener('dragstart', e => {
                draggedItemId = Number(row.dataset.partRow);
                row.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(draggedItemId));
            });
            row.addEventListener('dragend', () => {
                row.classList.remove('is-dragging');
                body.querySelectorAll('.cc-assembly-part-row').forEach(r => r.classList.remove('is-drag-over-above', 'is-drag-over-below'));
                draggedItemId = null;
            });
            row.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const targetId = Number(row.dataset.partRow);
                if (targetId === draggedItemId) return;
                const rect = row.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    row.classList.add('is-drag-over-above');
                    row.classList.remove('is-drag-over-below');
                } else {
                    row.classList.add('is-drag-over-below');
                    row.classList.remove('is-drag-over-above');
                }
            });
            row.addEventListener('dragleave', () => {
                row.classList.remove('is-drag-over-above', 'is-drag-over-below');
            });
            row.addEventListener('drop', e => {
                e.preventDefault();
                row.classList.remove('is-drag-over-above', 'is-drag-over-below');
                const targetId = Number(row.dataset.partRow);
                if (!draggedItemId || targetId === draggedItemId) return;

                const rect = row.getBoundingClientRect();
                const insertAfter = e.clientY >= (rect.top + rect.height / 2);

                const entries = Array.from(stagedAssemblyComponents.entries());
                const fromIndex = entries.findIndex(([k]) => k === draggedItemId);
                if (fromIndex < 0) return;
                const [movedEntry] = entries.splice(fromIndex, 1);

                let toIndex = entries.findIndex(([k]) => k === targetId);
                if (toIndex >= 0) {
                    if (insertAfter) toIndex++;
                    entries.splice(toIndex, 0, movedEntry);
                } else {
                    entries.push(movedEntry);
                }
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
        document.getElementById('ccItemUnitCost').value = Number(totalCost || 0).toFixed(2);
        document.getElementById('ccItemLaborHours').value = formatLaborHours(totalLabor);
        document.getElementById('ccAssemblyTotals').textContent = `Cost ${money(totalCost)} · Labor ${formatLaborHours(totalLabor)}`;
    }

    function openMoveItemModal(itemOrIds) {
        if (Array.isArray(itemOrIds)) {
            movingItemIds = itemOrIds.map(Number);
            movingItemId = null;
            const h3 = document.querySelector('#ccMoveItemModal h3');
            if (h3) h3.innerHTML = `<i class="fas fa-arrows-split-up-and-left"></i> Move ${movingItemIds.length} Items`;
            const firstItem = (state.allItems?.length ? state.allItems : state.items).find(r => Number(r.id) === movingItemIds[0]);
            if (firstItem && document.getElementById('ccMoveCatalog')) {
                document.getElementById('ccMoveCatalog').value = firstItem.catalog_id;
                document.getElementById('ccMoveCatalog')._syncCustom?.();
                renderGroupSelect(document.getElementById('ccMoveGroup'), Number(firstItem.catalog_id), firstItem.catalog_group_id || '');
                document.getElementById('ccMoveGroup').value = firstItem.catalog_group_id || '';
                document.getElementById('ccMoveGroup')._syncCustom?.();
            }
        } else {
            movingItemIds = [Number(itemOrIds.id)];
            movingItemId = Number(itemOrIds.id);
            const h3 = document.querySelector('#ccMoveItemModal h3');
            if (h3) h3.innerHTML = `<i class="fas fa-arrow-right-arrow-left"></i> Move Catalog Item`;
            document.getElementById('ccMoveCatalog').value = itemOrIds.catalog_id;
            document.getElementById('ccMoveCatalog')._syncCustom?.();
            renderGroupSelect(document.getElementById('ccMoveGroup'), Number(itemOrIds.catalog_id), itemOrIds.catalog_group_id || '');
            document.getElementById('ccMoveGroup').value = itemOrIds.catalog_group_id || '';
            document.getElementById('ccMoveGroup')._syncCustom?.();
        }
        document.getElementById('ccMoveItemModal').classList.add('open');
    }

    function openPasteItemModal() {
        if (!clipboardItemIds.length) return showError('No items copied to clipboard.');
        const modal = document.getElementById('ccPasteItemModal');
        if (!modal) return;
        const catSelect = document.getElementById('ccPasteCatalog');
        const grpSelect = document.getElementById('ccPasteGroup');
        const subtitle = document.getElementById('ccPasteModalSubtitle');
        const title = document.getElementById('ccPasteModalTitle');
        if (title) title.innerHTML = `<i class="fas fa-paste"></i> Paste ${clipboardItemIds.length} Copied Item(s)`;
        if (subtitle) subtitle.textContent = `Select destination catalog and group to duplicate the ${clipboardItemIds.length} item(s).`;

        catSelect.innerHTML = state.catalogs.filter(c => !c.deleted_at).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
        const targetCatId = selection.catalogId || (selection.groupId ? state.groups.find(g => Number(g.id) === Number(selection.groupId))?.catalog_id : null) || state.catalogs[0]?.id || '';
        catSelect.value = String(targetCatId);
        catSelect._syncCustom?.();

        renderGroupSelect(grpSelect, Number(targetCatId), selection.groupId || '');
        grpSelect.value = String(selection.groupId || '');
        grpSelect._syncCustom?.();

        catSelect.onchange = () => {
            renderGroupSelect(grpSelect, Number(catSelect.value), '');
            grpSelect._syncCustom?.();
        };

        modal.classList.add('open');
    }

    function closePasteItemModal() {
        document.getElementById('ccPasteItemModal')?.classList.remove('open');
    }

    async function pasteCopiedItems(event) {
        event.preventDefault();
        if (!clipboardItemIds.length) return;
        const destCat = Number(document.getElementById('ccPasteCatalog').value);
        const destGrp = Number(document.getElementById('ccPasteGroup').value || 0);
        const submitBtn = document.getElementById('ccPasteSubmitBtn');
        const oldBtnText = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Pasting...';
        }
        const tableWrap = document.getElementById('ccTableWrap') || document.querySelector('.cc-table-wrap');
        const pagination = document.getElementById('ccPagination');
        if (tableWrap) tableWrap.classList.add('is-loading');
        if (pagination) pagination.classList.add('is-loading');

        try {
            const pastedCount = clipboardItemIds.length;
            await request('batch_copy', {
                item_ids: clipboardItemIds,
                target_catalog_id: destCat,
                target_group_id: destGrp,
                view: selection.view,
                catalog_id: selection.catalogId,
                group_id: selection.groupId
            });
            closePasteItemModal();
            clipboardItemIds = [];
            selectedItemIds.clear();
            updateBulkToolbar();
            selection = destGrp ? { view: 'group', catalogId: null, groupId: destGrp } : { view: 'catalog', catalogId: destCat, groupId: null };
            await load();
            if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                window.TakeoffAnnouncement.toast(`${pastedCount} item(s) pasted successfully.`, 'success');
            }
        } catch (err) {
            showError(err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = oldBtnText;
            }
            if (tableWrap) tableWrap.classList.remove('is-loading');
            if (pagination) pagination.classList.remove('is-loading');
        }
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

        const pdf = document.getElementById('ccItemPdf')?.files[0] || null;
        const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
        if (pdf && (pdf.size > 10485760 || (!allowedTypes.includes(pdf.type) && !/\.(pdf|png|jpe?g|webp)$/i.test(pdf.name)))) {
            return showItemFormError('Choose a PDF, PNG, JPG, or WEBP file of 10 MB or smaller');
        }
        const saveButton = document.getElementById('ccItemSave');
        saveButton.disabled = true;
        saveButton.textContent = pdf ? 'Saving and uploading…' : 'Saving…';
        try {
            const existing = (state.allItems?.length ? state.allItems : state.items).find(row => Number(row.id) === Number(editingItemId));
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

            const val = id => document.getElementById(id)?.value || '';
            const numVal = id => Number(document.getElementById(id)?.value || 0);

            const data = await request('save_item', revisionPayload(existing, {
                id: editingItemId || 0,
                catalog_id: val('ccItemCatalog'),
                catalog_group_id: val('ccItemGroup'),
                name: val('ccItemName'),
                description: val('ccItemDescription'),
                item_type: val('ccItemType'),
                unit_of_measure: val('ccItemUom'),
                measurement_type: val('ccItemMeasurementType'),
                unit_cost: unitCost,
                material_cost: numVal('ccItemMaterialCost'),
                labor_cost: numVal('ccItemLaborCost'),
                equipment_cost: numVal('ccItemEquipmentCost'),
                labor_hours: laborHours,
                labor_rate: laborRate,
                markup_percent: numVal('ccItemMarkup'),
                waste_factor_percent: numVal('ccItemWaste'),
                taxable: val('ccItemTaxable') === '1' ? 1 : 0,
                color,
                symbol: val('ccItemSymbol'),
                marker_size: val('ccItemMarkerSize'),
                size: val('ccItemSize'),
                diameter: val('ccItemDiameter'),
                trade_size: val('ccItemTradeSize'),
                thickness: val('ccItemThickness'),
                gauge: val('ccItemGauge'),
                material: val('ccItemMaterial'),
                manufacturer: val('ccItemManufacturer'),
                supplier: val('ccItemSupplier'),
                catalog_number: val('ccItemCatalogNumber'),
                cost_code: val('ccItemCostCode'),
                masterformat: val('ccItemMasterFormat'),
                uniformat: val('ccItemUniFormat'),
                sub_job_code: val('ccItemSubJobCode'),
                sub_job_name: val('ccItemSubJobName'),
                epd_url: val('ccItemEpdUrl'),
                attachment_url: val('ccItemAttachmentUrl'),
                tags_json: val('ccItemTags').split(',').map(v => v.trim()).filter(Boolean),
                attributes_json: attributes,
                notes: val('ccItemNotes'),
                components: componentsPayload
            }));
            if (pdf) {
                const feedback = document.getElementById('ccItemPdfFeedback');
                if (feedback) feedback.textContent = 'Uploading attachment…';
                await attachmentRequest('upload', data.id, data.revision, pdf);
            }
            const groupId = Number(document.getElementById('ccItemGroup')?.value || 0);
            const catalogId = Number(document.getElementById('ccItemCatalog')?.value || 0);
            selection = groupId ? { view: 'group', catalogId: null, groupId } : { view: 'catalog', catalogId, groupId: null };
            state = data.data;
            closeItemModals();
            await load();
        } catch(err) {
            showItemFormError(err.code === 'revision_conflict' ? 'This item changed elsewhere. Your entries are still here; reload to review the current version before saving again.' : err.message);
            const feedback = document.getElementById('ccItemPdfFeedback');
            if (feedback) feedback.textContent = err.message;
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = 'Save Item';
        }
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

    async function moveItem(event) {
        event.preventDefault();
        const destCat = document.getElementById('ccMoveCatalog').value;
        const destGrp = document.getElementById('ccMoveGroup').value;
        const submitBtn = document.getElementById('ccMoveSubmitBtn') || document.querySelector('#ccMoveItemModal button[type="submit"]');
        const oldBtnText = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Moving...';
        }
        const tableWrap = document.getElementById('ccTableWrap') || document.querySelector('.cc-table-wrap');
        const pagination = document.getElementById('ccPagination');
        if (tableWrap) tableWrap.classList.add('is-loading');
        if (pagination) pagination.classList.add('is-loading');

        try {
            if (movingItemIds.length > 1) {
                await request('batch_move', {
                    item_ids: movingItemIds,
                    target_catalog_id: Number(destCat),
                    target_group_id: Number(destGrp || 0),
                    catalog_id: Number(destCat),
                    catalog_group_id: Number(destGrp || 0),
                    view: selection.view
                });
            } else {
                const singleId = movingItemId || movingItemIds[0];
                const item = (state.allItems?.length ? state.allItems : state.items).find(row => Number(row.id) === Number(singleId));
                await request('move_item', revisionPayload(item, {
                    id: singleId,
                    catalog_id: Number(destCat),
                    catalog_group_id: Number(destGrp || 0)
                }));
            }
            selectedItemIds.clear();
            movingItemIds = [];
            movingItemId = null;
            updateBulkToolbar();
            closeItemModals();

            const groupId = Number(destGrp || 0);
            const catalogId = Number(destCat || 0);
            selection = groupId ? { view: 'group', catalogId: null, groupId } : { view: 'catalog', catalogId, groupId: null };
            await load();
            if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                window.TakeoffAnnouncement.toast('Item(s) moved successfully.', 'success');
            }
        } catch (err) {
            showError(err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = oldBtnText;
            }
            if (tableWrap) tableWrap.classList.remove('is-loading');
            if (pagination) pagination.classList.remove('is-loading');
        }
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

    let errorTimeout = null;
    function showError(message) {
        const el = document.getElementById('ccError');
        if (!el) return;
        if (errorTimeout) {
            clearTimeout(errorTimeout);
            errorTimeout = null;
        }
        el.innerHTML = `
            <span class="cc-error-message"><i class="fas fa-triangle-exclamation"></i> ${esc(message)}</span>
            <button type="button" class="cc-error-close" aria-label="Dismiss error">&times;</button>
        `;
        el.style.display = 'flex';
        const closeBtn = el.querySelector('.cc-error-close');
        if (closeBtn) {
            closeBtn.onclick = () => {
                if (errorTimeout) {
                    clearTimeout(errorTimeout);
                    errorTimeout = null;
                }
                el.style.display = 'none';
            };
        }
        errorTimeout = setTimeout(() => {
            el.style.display = 'none';
            errorTimeout = null;
        }, 18000);
    }

    function openTreeMoreMenu(triggerBtn, type, id) {
        id = Number(id);
        const menu = document.getElementById('ccTreeMoreMenu');
        if (!menu) return;

        if (!menu.hidden && triggerBtn.classList.contains('is-active')) {
            closeTreeMoreMenu();
            return;
        }

        closeTreeMoreMenu();

        let html = '';
        if (type === 'catalog') {
            const catalog = state.catalogs.find(c => Number(c.id) === id);
            if (!catalog) return;
            triggerBtn.classList.add('is-active');
            html = `
                <div class="cc-tree-menu-eyebrow">Catalog: ${esc(catalog.name)}</div>
                <button type="button" class="cc-tree-menu-item" data-menu-catalog-action="add-group" data-id="${id}"><i class="fas fa-folder-plus"></i> Add Group</button>
                <button type="button" class="cc-tree-menu-item" data-menu-catalog-action="rename" data-id="${id}"><i class="fas fa-pen"></i> Rename</button>
                <button type="button" class="cc-tree-menu-item" data-menu-catalog-action="copy" data-id="${id}"><i class="far fa-copy"></i> Duplicate</button>
                <button type="button" class="cc-tree-menu-item" data-menu-catalog-action="up" data-id="${id}"><i class="fas fa-arrow-up"></i> Move Up</button>
                <button type="button" class="cc-tree-menu-item" data-menu-catalog-action="down" data-id="${id}"><i class="fas fa-arrow-down"></i> Move Down</button>
                <div class="cc-tree-menu-divider"></div>
                <button type="button" class="cc-tree-menu-item" data-menu-catalog-action="toggle_status" data-id="${id}"><i class="fas ${Number(catalog.active) ? 'fa-toggle-on' : 'fa-toggle-off'}"></i> ${Number(catalog.active) ? 'Disable for Projects' : 'Enable for Projects'}</button>
                <div class="cc-tree-menu-divider"></div>
                <button type="button" class="cc-tree-menu-item ${catalog.deleted_at ? '' : 'danger'}" data-menu-catalog-action="${catalog.deleted_at ? 'restore' : 'delete'}" data-id="${id}"><i class="fas ${catalog.deleted_at ? 'fa-rotate-left' : 'fa-box-archive'}"></i> ${catalog.deleted_at ? 'Restore' : 'Archive'}</button>
            `;
        } else if (type === 'group') {
            const group = state.groups.find(g => Number(g.id) === id);
            if (!group) return;
            triggerBtn.classList.add('is-active');
            const isSubgroup = Boolean(group.parent_group_id);
            const childCount = state.groups.filter(c => Number(c.parent_group_id) === id && !c.deleted_at).length;
            let addSubItem = '';
            if (isSubgroup) {
                // Subgroups cannot have nested subgroups!
                addSubItem = '';
            } else if (childCount >= 3) {
                addSubItem = `<button type="button" class="cc-tree-menu-item" disabled style="opacity:0.5; cursor:not-allowed;" title="Maximum of 3 sub-groups reached"><i class="fas fa-folder-plus"></i> Add Subgroup (Max 3 reached)</button>`;
            } else {
                addSubItem = `<button type="button" class="cc-tree-menu-item" data-menu-group-action="add-sub" data-id="${id}"><i class="fas fa-folder-plus"></i> Add Subgroup${childCount > 0 ? ` (${childCount}/3)` : ''}</button>`;
            }
            html = `
                <div class="cc-tree-menu-eyebrow">Group: ${esc(group.name)}</div>
                ${addSubItem}
                <button type="button" class="cc-tree-menu-item" data-menu-group-action="rename" data-id="${id}"><i class="fas fa-pen"></i> Rename</button>
                <button type="button" class="cc-tree-menu-item" data-menu-group-action="copy" data-id="${id}"><i class="far fa-copy"></i> Duplicate</button>
                <button type="button" class="cc-tree-menu-item" data-menu-group-action="move" data-id="${id}"><i class="fas fa-arrows-split-up-and-left"></i> Move Group</button>
                <button type="button" class="cc-tree-menu-item" data-menu-group-action="up" data-id="${id}"><i class="fas fa-arrow-up"></i> Move Up</button>
                <button type="button" class="cc-tree-menu-item" data-menu-group-action="down" data-id="${id}"><i class="fas fa-arrow-down"></i> Move Down</button>
                <div class="cc-tree-menu-divider"></div>
                <button type="button" class="cc-tree-menu-item" data-menu-group-action="toggle_status" data-id="${id}"><i class="fas ${Number(group.active) ? 'fa-toggle-on' : 'fa-toggle-off'}"></i> ${Number(group.active) ? 'Disable for Projects' : 'Enable for Projects'}</button>
                <div class="cc-tree-menu-divider"></div>
                <button type="button" class="cc-tree-menu-item ${group.deleted_at ? '' : 'danger'}" data-menu-group-action="${group.deleted_at ? 'restore' : 'delete'}" data-id="${id}"><i class="fas ${group.deleted_at ? 'fa-rotate-left' : 'fa-box-archive'}"></i> ${group.deleted_at ? 'Restore' : 'Archive'}</button>
            `;
        }

        menu.innerHTML = html;
        menu.hidden = false;

        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const rect = triggerBtn.getBoundingClientRect();
        const menuWidth = 200;
        const menuHeight = 290;

        let left = (rect.right / zoom) + 4;
        if (left + menuWidth > (window.innerWidth / zoom)) {
            left = (rect.left / zoom) - menuWidth - 4;
        }

        let top = (rect.top / zoom);
        if (top + menuHeight > (window.innerHeight / zoom)) {
            top = Math.max(10, (window.innerHeight / zoom) - menuHeight - 10);
        }

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    }

    function closeTreeMoreMenu() {
        const menu = document.getElementById('ccTreeMoreMenu');
        if (menu) {
            menu.hidden = true;
            menu.innerHTML = '';
        }
        document.querySelectorAll('.cc-tree-more-btn.is-active').forEach(b => b.classList.remove('is-active'));
    }

    function initCostCatalogSidebarResizer() {
        const sidebar = document.getElementById('ccCatalogSidebar');
        const resizer = document.getElementById('ccSidebarResizer');
        if (!sidebar || !resizer) return;

        try {
            const savedWidth = localStorage.getItem('cc_sidebar_width');
            if (savedWidth) {
                const parsed = parseInt(savedWidth, 10);
                if (parsed >= 220 && parsed <= 650) {
                    document.documentElement.style.setProperty('--cc-sidebar-width', `${parsed}px`);
                    sidebar.style.width = `${parsed}px`;
                    sidebar.style.flexBasis = `${parsed}px`;
                }
            }
        } catch (_) {}

        let isDragging = false;
        let startX = 0;
        let startWidth = 320;

        resizer.addEventListener('pointerdown', e => {
            isDragging = true;
            startX = e.clientX;
            const currentComputed = parseInt(getComputedStyle(sidebar).width, 10) || 320;
            startWidth = currentComputed;
            resizer.classList.add('is-dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
        });

        resizer.addEventListener('pointermove', e => {
            if (!isDragging) return;
            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            const delta = (e.clientX - startX) / zoom;
            const newWidth = Math.max(220, Math.min(650, Math.round(startWidth + delta)));
            document.documentElement.style.setProperty('--cc-sidebar-width', `${newWidth}px`);
            sidebar.style.width = `${newWidth}px`;
            sidebar.style.flexBasis = `${newWidth}px`;
        });

        const stopDragging = e => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('is-dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try {
                if (e?.pointerId) resizer.releasePointerCapture(e.pointerId);
            } catch (_) {}

            const finalWidth = parseInt(getComputedStyle(sidebar).width, 10) || 320;
            try {
                localStorage.setItem('cc_sidebar_width', `${finalWidth}px`);
            } catch (_) {}
        };

        resizer.addEventListener('pointerup', stopDragging);
        resizer.addEventListener('pointercancel', stopDragging);
    }

    function initColumnResizer() {
        const resizer = document.getElementById('ccColResizerName');
        if (!resizer) return;

        try {
            const saved = localStorage.getItem('cc_col_name_width');
            if (saved) {
                document.documentElement.style.setProperty('--cc-col-name-w', saved);
            }
        } catch (_) {}

        let isDragging = false;
        let startX = 0;
        let startWidth = 0;

        resizer.addEventListener('pointerdown', e => {
            isDragging = true;
            startX = e.clientX;
            const th = resizer.closest('th');
            startWidth = th ? th.getBoundingClientRect().width : 260;
            resizer.classList.add('is-dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
            e.stopPropagation();
        });

        resizer.addEventListener('pointermove', e => {
            if (!isDragging) return;
            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            const delta = (e.clientX - startX) / zoom;
            const newWidth = Math.max(150, Math.min(650, Math.round(startWidth + delta)));
            document.documentElement.style.setProperty('--cc-col-name-w', `${newWidth}px`);
        });

        const stopDrag = e => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('is-dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try { if (e?.pointerId) resizer.releasePointerCapture(e.pointerId); } catch (_) {}
            const th = resizer.closest('th');
            if (th) {
                const finalW = `${Math.round(th.getBoundingClientRect().width)}px`;
                try { localStorage.setItem('cc_col_name_width', finalW); } catch (_) {}
            }
        };

        resizer.addEventListener('pointerup', stopDrag);
        resizer.addEventListener('pointercancel', stopDrag);
    }

    function initFieldSelectors() {
        const wrap = document.getElementById('ccSortByWrap');
        const trigger = document.getElementById('ccSortByTrigger');
        const menu = document.getElementById('ccSortByMenu');
        const text = document.getElementById('ccSortByText');
        const hiddenSelect = document.getElementById('ccSortBy');
        if (!wrap || !trigger || !menu) return;

        trigger.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = !menu.hidden;
            menu.hidden = isOpen;
            trigger.setAttribute('aria-expanded', String(!isOpen));
        });

        menu.querySelectorAll('.bt-field-option').forEach(option => {
            option.addEventListener('click', e => {
                e.stopPropagation();
                const value = option.dataset.value;
                const label = option.querySelector('span')?.textContent || value;

                menu.querySelectorAll('.bt-field-option').forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');

                if (text) text.textContent = label;
                if (hiddenSelect) hiddenSelect.value = value;

                menu.hidden = true;
                trigger.setAttribute('aria-expanded', 'false');

                itemSort = value;
                currentPage = 1;
                renderItems();
            });
        });

        document.addEventListener('click', e => {
            if (!wrap.contains(e.target)) {
                menu.hidden = true;
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function initApp() {
        initCostCatalogSidebarResizer();
        initColumnResizer();
        initFieldSelectors();

        document.getElementById('ccSearch')?.addEventListener('input', event => {
            itemQuery = event.target.value;
            currentPage = 1;
            renderItems();
        });
        document.getElementById('ccFiltersBtn')?.addEventListener('click', () => {
            const panel = document.getElementById('ccFiltersPanel');
            if (panel) panel.hidden = !panel.hidden;
        });
        document.getElementById('ccApplyFiltersBtn')?.addEventListener('click', () => {
            currentPage = 1;
            renderItems();
            const panel = document.getElementById('ccFiltersPanel');
            if (panel) panel.hidden = true;
        });
        document.getElementById('ccTypeFilter')?.addEventListener('change', event => { itemTypeFilter = event.target.value; currentPage = 1; renderItems(); });
        document.getElementById('ccMeasurementFilter')?.addEventListener('change',event=>{measurementFilter=event.target.value; currentPage = 1; renderItems();});
        document.getElementById('ccUomFilter')?.addEventListener('change',event=>{uomFilter=event.target.value; currentPage = 1; renderItems();});
        document.getElementById('ccStatusFilter')?.addEventListener('change',event=>{statusFilter=event.target.value; currentPage = 1; load();});
        document.getElementById('ccClearFilters')?.addEventListener('click',()=>{
            itemQuery='';
            currentPage = 1;
            itemTypeFilter=measurementFilter=uomFilter='all';
            statusFilter='active';
            const sInp = document.getElementById('ccSearch'); if (sInp) sInp.value='';
            const tSel = document.getElementById('ccTypeFilter'); if (tSel) { tSel.value='all'; tSel._syncCustom?.(); }
            const mSel = document.getElementById('ccMeasurementFilter'); if (mSel) { mSel.value='all'; mSel._syncCustom?.(); }
            const uSel = document.getElementById('ccUomFilter'); if (uSel) { uSel.value='all'; uSel._syncCustom?.(); }
            const stSel = document.getElementById('ccStatusFilter'); if (stSel) { stSel.value='active'; stSel._syncCustom?.(); }
            load();
        });

        // Pagination button listeners
        document.getElementById('ccPageFirst')?.addEventListener('click', () => goToPage(1));
        document.getElementById('ccPagePrev')?.addEventListener('click', () => goToPage(currentPage - 1));
        document.getElementById('ccPageNext')?.addEventListener('click', () => goToPage(currentPage + 1));
        document.getElementById('ccPageLast')?.addEventListener('click', () => goToPage(currentTotalPages));
        document.getElementById('ccPaginationNumbers')?.addEventListener('click', event => {
            const btn = event.target.closest('[data-page]');
            if (btn) {
                const p = Number(btn.dataset.page);
                if (p && p !== currentPage) goToPage(p);
            }
        });
        document.getElementById('ccItemsBody')?.addEventListener('click', event => {
            const trigger = event.target.closest('[data-item-details]');
            if (trigger) openItemDetails(trigger.dataset.itemDetails, trigger);
            const menuTrigger = event.target.closest('[data-item-menu]');
            if (menuTrigger) {
                event.stopPropagation();
                openItemRowMenu(menuTrigger, menuTrigger.dataset.itemMenu);
                return;
            }
            const action = event.target.closest('[data-item-action]');
            if (action) itemAction(action.dataset.itemAction, Number(action.dataset.id));
            const catAction = event.target.closest('[data-archived-catalog-action]');
            if (catAction) handleArchivedCatalogAction(catAction.dataset.archivedCatalogAction, Number(catAction.dataset.id));
            const grpAction = event.target.closest('[data-archived-group-action]');
            if (grpAction) handleArchivedGroupAction(grpAction.dataset.archivedGroupAction, Number(grpAction.dataset.id));
        });
        document.getElementById('ccItemsBody')?.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                const cell = event.target.closest('td.col-name-cell[data-item-details]');
                if (cell) {
                    event.preventDefault();
                    openItemDetails(cell.dataset.itemDetails, cell);
                }
            }
        });
        document.getElementById('ccCatalogTree')?.addEventListener('click', event => {
            const moreCatalog = event.target.closest('[data-tree-more-catalog]');
            if (moreCatalog) {
                event.stopPropagation();
                event.preventDefault();
                return openTreeMoreMenu(moreCatalog, 'catalog', moreCatalog.dataset.treeMoreCatalog);
            }
            const moreGroup = event.target.closest('[data-tree-more-group]');
            if (moreGroup) {
                event.stopPropagation();
                event.preventDefault();
                return openTreeMoreMenu(moreGroup, 'group', moreGroup.dataset.treeMoreGroup);
            }
            const catalogToggle = event.target.closest('[data-tree-toggle-catalog]');
            if (catalogToggle) {
                const id = Number(catalogToggle.dataset.treeToggleCatalog);
                expandedCatalogs.has(id) ? expandedCatalogs.delete(id) : expandedCatalogs.add(id);
                return renderTree();
            }
            const groupToggle = event.target.closest('[data-tree-toggle-group]');
            if (groupToggle) {
                const id = Number(groupToggle.dataset.treeToggleGroup);
                expandedGroups.has(id) ? expandedGroups.delete(id) : expandedGroups.add(id);
                return renderTree();
            }
            const catalog = event.target.closest('[data-catalog-id]');
            if (catalog) {
                // Request 7: Do NOT auto-expand child groups when clicking catalog
                selection = { view: 'catalog', catalogId: Number(catalog.dataset.catalogId), groupId: null };
                return load();
            }
            const group = event.target.closest('[data-group-id]');
            if (group) {
                const row = state.groups.find(g => Number(g.id) === Number(group.dataset.groupId));
                selection = { view: 'group', catalogId: null, groupId: Number(group.dataset.groupId) };
                if (row) expandedCatalogs.add(Number(row.catalog_id));
                return load();
            }
        });

        document.getElementById('ccTreeMoreMenu')?.addEventListener('click', async event => {
            const catAction = event.target.closest('[data-menu-catalog-action]');
            if (catAction) {
                const action = catAction.dataset.menuCatalogAction;
                const id = Number(catAction.dataset.id);
                const catalog = state.catalogs.find(c => Number(c.id) === id);
                closeTreeMoreMenu();
                if (action === 'add-group') return openGroupModal(null, id);
                if (action === 'rename') return openCatalogModal(catalog);
                if (action === 'copy') return mutate('copy_catalog', revisionPayload(catalog, { id }));
                if (action === 'up' || action === 'down') return reorderEntity('catalog', catalog, action);
                if (action === 'delete') {
                    const ok = await showConfirmDialog({
                        title: 'Archive Catalog',
                        message: `Archive catalog "${catalog.name}"? Its historical references will be preserved.`,
                        confirmText: 'Archive Catalog',
                        cancelText: 'Cancel',
                        type: 'warning',
                        badge: 'ARCHIVE',
                        icon: 'fas fa-box-archive'
                    });
                    if (!ok) return;
                    return mutate('delete_catalog', revisionPayload(catalog, { id }));
                }
                if (action === 'restore') return mutate('restore_catalog', revisionPayload(catalog, { id }));
                if (action === 'toggle_status' || action === 'active' || action === 'enabled') return mutate('toggle_catalog', revisionPayload(catalog, { id, field: 'active' }));
                return;
            }

            const grpAction = event.target.closest('[data-menu-group-action]');
            if (grpAction) {
                const action = grpAction.dataset.menuGroupAction;
                const id = Number(grpAction.dataset.id);
                const group = state.groups.find(g => Number(g.id) === id);
                closeTreeMoreMenu();
                if (action === 'add-sub') {
                    const childCount = state.groups.filter(c => Number(c.parent_group_id) === id && !c.deleted_at).length;
                    if (childCount >= 3) {
                        showError('A group can have a maximum of 3 sub-groups.');
                        return;
                    }
                    return openGroupModal(null, group.catalog_id, id);
                }
                if (action === 'rename' || action === 'move') return openGroupModal(group);
                if (action === 'copy') return mutate('copy_group', revisionPayload(group, { id }));
                if (action === 'up' || action === 'down') return reorderEntity('group', group, action);
                if (action === 'delete') return openGroupArchive(group);
                if (action === 'restore') return mutate('restore_group', revisionPayload(group, { id }));
                if (action === 'toggle_status' || action === 'active' || action === 'enabled') return mutate('toggle_group', revisionPayload(group, { id, field: 'active' }));
                return;
            }
        });

        setupItemSymbolDropdown();
        setupItemColorDropdown();
        initDropzone();

        document.getElementById('ccCloseItemDetails')?.addEventListener('click', closeItemDetails);
        document.getElementById('ccItemDetailsScrim')?.addEventListener('click', closeItemDetails);
        document.getElementById('ccSortDir')?.addEventListener('click', event => {
            itemSortDirection *= -1;
            currentPage = 1;
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
        document.getElementById('ccAddCatalog')?.addEventListener('click', () => openCatalogModal());
        document.getElementById('ccAddCatalogTop')?.addEventListener('click', () => openCatalogModal());
        document.getElementById('ccAddGroup')?.addEventListener('click', () => openGroupModal(null, selection.catalogId));
        document.getElementById('ccAddItem')?.addEventListener('click', () => openItemModal());
        document.getElementById('ccItemCatalog')?.addEventListener('change', event => { renderGroupSelect(document.getElementById('ccItemGroup'), Number(event.target.value)); renderAssemblyItemOptions(); });
        document.getElementById('ccMoveCatalog')?.addEventListener('change', event => renderGroupSelect(document.getElementById('ccMoveGroup'), Number(event.target.value)));
        document.getElementById('ccItemType')?.addEventListener('change', () => { toggleAssemblySection(); renderAssemblyItemOptions(); });
        document.getElementById('ccItemMeasurementType')?.addEventListener('change', event => {
            const mType = event.target.value;
            const uomInput = document.getElementById('ccItemUom');
            if (uomInput) {
                uomInput.value = MEASUREMENT_DEFAULT_UOM[mType] || 'ea';
            }
        });
        document.getElementById('ccItemPdfRemove')?.addEventListener('click', async () => {
            if (!editingItemId) return;
            const ok = await showConfirmDialog({
                title: 'Remove Attachment',
                message: 'Are you sure you want to remove the current attachment from this catalog item?',
                confirmText: 'Remove Attachment',
                cancelText: 'Cancel',
                type: 'warning',
                badge: 'ATTACHMENT',
                icon: 'fas fa-file-pdf',
                primaryDanger: true
            });
            if (!ok) return;
            const item = (state.allItems || state.items).find(row => Number(row.id) === Number(editingItemId));
            const feedback = document.getElementById('ccItemPdfFeedback');
            if (feedback) feedback.textContent = 'Removing attachment…';
            try {
                await attachmentRequest('remove', editingItemId, item?.revision ?? null);
                await load();
                const updated = (state.allItems || state.items).find(row => Number(row.id) === Number(editingItemId));
                renderPdfAttachment(updated);
                if (feedback) feedback.textContent = 'Attachment removed.';
            } catch(err) {
                if (feedback) feedback.textContent = err.message;
                showError(err.message);
            }
        });
        document.getElementById('ccOpenAssemblyBrowser')?.addEventListener('click',()=>{const browser=document.getElementById('ccAssemblyBrowser');browser.hidden=false;renderAssemblyBrowserResults();document.getElementById('ccAssemblySearch').focus();});
        document.getElementById('ccCloseAssemblyBrowser')?.addEventListener('click',()=>{document.getElementById('ccAssemblyBrowser').hidden=true;document.getElementById('ccOpenAssemblyBrowser').focus();});
        document.getElementById('ccToggleAssemblyBrowser')?.addEventListener('click', event => {
            const browser = document.getElementById('ccAssemblyBrowser');
            const btn = event.currentTarget;
            if (!browser) return;
            const willHide = !browser.hidden;
            browser.hidden = willHide;
            btn.setAttribute('aria-expanded', String(!willHide));
            btn.innerHTML = willHide 
                ? '<i class="fas fa-plus"></i> <span>Add / Browse Items</span>' 
                : '<i class="fas fa-chevron-up"></i> <span>Hide Catalog Items</span>';
            if (!willHide) {
                renderAssemblyBrowserResults();
                document.getElementById('ccAssemblySearch')?.focus();
            }
        });
        document.getElementById('ccAssemblySearch')?.addEventListener('input', () => {
            assemblyBrowserPage = 1;
            renderAssemblyBrowserResults();
        });
        ['ccAssemblyCatalogFilter','ccAssemblyCategoryFilter','ccAssemblyTypeFilter'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                assemblyBrowserPage = 1;
                renderAssemblyBrowserResults();
            });
        });
        document.getElementById('ccAssemblyPagePrev')?.addEventListener('click', () => {
            if (assemblyBrowserPage > 1) {
                assemblyBrowserPage--;
                renderAssemblyBrowserResults();
                document.getElementById('ccAssemblyResults')?.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
        document.getElementById('ccAssemblyPageNext')?.addEventListener('click', () => {
            assemblyBrowserPage++;
            renderAssemblyBrowserResults();
            document.getElementById('ccAssemblyResults')?.scrollTo({ top: 0, behavior: 'smooth' });
        });
        document.querySelectorAll('[data-close-item-modal]').forEach(btn => btn.addEventListener('click', closeItemModals));
        document.getElementById('ccItemForm')?.addEventListener('submit', saveItem);
        document.getElementById('ccMoveItemForm')?.addEventListener('submit', moveItem);
        document.getElementById('ccCatalogForm')?.addEventListener('submit', saveCatalog);
        document.querySelectorAll('[data-close-catalog-modal]').forEach(button => button.addEventListener('click', closeCatalogModal));
        document.getElementById('ccGroupForm')?.addEventListener('submit', saveGroup);
        document.querySelectorAll('[data-close-group-modal]').forEach(button => button.addEventListener('click', closeGroupModal));
        document.getElementById('ccGroupCatalog')?.addEventListener('change', () => renderGroupParents(groupEditor));
        document.getElementById('ccArchiveGroupForm')?.addEventListener('submit', archiveGroup);
        document.querySelectorAll('[data-close-group-archive]').forEach(button => button.addEventListener('click', closeGroupArchive));

        // Master select-all checkbox handler
        document.getElementById('ccSelectAll')?.addEventListener('change', event => {
            const isChecked = event.target.checked;
            document.querySelectorAll('.cc-item-check').forEach(cb => {
                cb.checked = isChecked;
                const id = Number(cb.dataset.itemId);
                if (id) {
                    if (isChecked) selectedItemIds.add(id);
                    else selectedItemIds.delete(id);
                }
            });
            document.querySelectorAll('.cc-archived-cat-check').forEach(cb => {
                cb.checked = isChecked;
                const id = Number(cb.dataset.catalogId);
                if (id) {
                    if (isChecked) selectedArchivedCatalogIds.add(id);
                    else selectedArchivedCatalogIds.delete(id);
                }
            });
            document.querySelectorAll('.cc-archived-grp-check').forEach(cb => {
                cb.checked = isChecked;
                const id = Number(cb.dataset.groupId);
                if (id) {
                    if (isChecked) selectedArchivedGroupIds.add(id);
                    else selectedArchivedGroupIds.delete(id);
                }
            });
            updateSelectAllCheckbox();
            updateBulkToolbar();
        });

        // Individual item/catalog/group checkbox change delegation
        document.getElementById('ccItemsBody')?.addEventListener('change', event => {
            const check = event.target.closest('.cc-item-check');
            if (check) {
                const id = Number(check.dataset.itemId);
                if (id) {
                    if (check.checked) selectedItemIds.add(id);
                    else selectedItemIds.delete(id);
                }
                updateSelectAllCheckbox();
                updateBulkToolbar();
                return;
            }
            const catCheck = event.target.closest('.cc-archived-cat-check');
            if (catCheck) {
                const id = Number(catCheck.dataset.catalogId);
                if (id) {
                    if (catCheck.checked) selectedArchivedCatalogIds.add(id);
                    else selectedArchivedCatalogIds.delete(id);
                }
                updateSelectAllCheckbox();
                updateBulkToolbar();
                return;
            }
            const grpCheck = event.target.closest('.cc-archived-grp-check');
            if (grpCheck) {
                const id = Number(grpCheck.dataset.groupId);
                if (id) {
                    if (grpCheck.checked) selectedArchivedGroupIds.add(id);
                    else selectedArchivedGroupIds.delete(id);
                }
                updateSelectAllCheckbox();
                updateBulkToolbar();
                return;
            }
        });

        // Archived row direct action button delegation (Restore / Purge)
        document.getElementById('ccItemsBody')?.addEventListener('click', async event => {
            const catActionBtn = event.target.closest('[data-archived-catalog-action]');
            if (catActionBtn) {
                const action = catActionBtn.dataset.archivedCatalogAction;
                const id = Number(catActionBtn.dataset.id);
                const cat = (state.archivedCatalogs || []).find(c => Number(c.id) === id);
                const catName = cat ? cat.name : 'catalog';
                if (action === 'restore') {
                    try {
                        await request('restore_catalog', { id });
                        selectedArchivedCatalogIds.delete(id);
                        await load();
                        if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                            window.TakeoffAnnouncement.toast(`Catalog "${catName}" restored successfully.`, 'success');
                        }
                    } catch (err) { showError(err.message); }
                } else if (action === 'purge') {
                    const ok = await showConfirmDialog({
                        title: 'Permanently Delete Catalog',
                        message: `Permanently delete catalog "${catName}" and ALL items archived with it? This action CANNOT be undone.`,
                        confirmText: 'Delete Permanently',
                        cancelText: 'Cancel',
                        type: 'error',
                        badge: 'PERMANENT DELETE',
                        icon: 'fas fa-trash-can',
                        primaryDanger: true
                    });
                    if (!ok) return;
                    try {
                        await request('purge_catalog', { id });
                        selectedArchivedCatalogIds.delete(id);
                        await load();
                        if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                            window.TakeoffAnnouncement.toast(`Catalog "${catName}" permanently deleted.`, 'success');
                        }
                    } catch (err) { showError(err.message); }
                }
                return;
            }

            const grpActionBtn = event.target.closest('[data-archived-group-action]');
            if (grpActionBtn) {
                const action = grpActionBtn.dataset.archivedGroupAction;
                const id = Number(grpActionBtn.dataset.id);
                const grp = (state.archivedGroups || []).find(g => Number(g.id) === id);
                const grpName = grp ? grp.name : 'group';
                if (action === 'restore') {
                    try {
                        await request('restore_group', { id });
                        selectedArchivedGroupIds.delete(id);
                        await load();
                        if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                            window.TakeoffAnnouncement.toast(`Group "${grpName}" restored successfully.`, 'success');
                        }
                    } catch (err) { showError(err.message); }
                } else if (action === 'purge') {
                    const ok = await showConfirmDialog({
                        title: 'Permanently Delete Group',
                        message: `Permanently delete group "${grpName}" and ALL items archived with it? This action CANNOT be undone.`,
                        confirmText: 'Delete Permanently',
                        cancelText: 'Cancel',
                        type: 'error',
                        badge: 'PERMANENT DELETE',
                        icon: 'fas fa-trash-can',
                        primaryDanger: true
                    });
                    if (!ok) return;
                    try {
                        await request('purge_group', { id });
                        selectedArchivedGroupIds.delete(id);
                        await load();
                        if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                            window.TakeoffAnnouncement.toast(`Group "${grpName}" permanently deleted.`, 'success');
                        }
                    } catch (err) { showError(err.message); }
                }
                return;
            }
        });

        // Bulk toolbar actions
        document.getElementById('ccBulkCancelBtn')?.addEventListener('click', () => {
            selectedItemIds.clear();
            selectedArchivedCatalogIds.clear();
            selectedArchivedGroupIds.clear();
            clipboardItemIds = [];
            document.querySelectorAll('.cc-item-check, .cc-archived-cat-check, .cc-archived-grp-check').forEach(cb => { cb.checked = false; });
            updateSelectAllCheckbox();
            updateBulkToolbar();
        });
        document.getElementById('ccBulkMoveBtn')?.addEventListener('click', () => {
            if (!selectedItemIds.size) return;
            openMoveItemModal(Array.from(selectedItemIds));
        });
        document.getElementById('ccBulkCopyBtn')?.addEventListener('click', () => {
            if (!selectedItemIds.size) return;
            clipboardItemIds = Array.from(selectedItemIds);
            selectedItemIds.clear();
            document.querySelectorAll('.cc-item-check').forEach(cb => { cb.checked = false; });
            updateSelectAllCheckbox();
            updateBulkToolbar();
            if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                window.TakeoffAnnouncement.toast(`${clipboardItemIds.length} item(s) copied to clipboard.`, 'info');
            }
        });
        document.getElementById('ccBulkPasteBtn')?.addEventListener('click', () => {
            openPasteItemModal();
        });
        document.getElementById('ccPasteItemForm')?.addEventListener('submit', pasteCopiedItems);
        document.querySelectorAll('[data-close-paste-modal]').forEach(b => b.addEventListener('click', closePasteItemModal));
        document.getElementById('ccBulkArchiveBtn')?.addEventListener('click', async () => {
            if (!selectedItemIds.size) return;
            const ids = Array.from(selectedItemIds);
            const ok = await showConfirmDialog({
                title: 'Archive Items',
                message: `Archive ${ids.length} selected item(s)? They will be moved to Archived Items.`,
                confirmText: `Archive (${ids.length})`,
                cancelText: 'Cancel',
                type: 'warning',
                badge: 'BULK ARCHIVE',
                icon: 'fas fa-box-archive'
            });
            if (!ok) return;
            try {
                const res = await request('batch_archive', {
                    ids,
                    view: selection.view,
                    catalog_id: selection.catalogId,
                    group_id: selection.groupId
                });
                selectedItemIds.clear();
                state = res.data;
                render();
            } catch (err) {
                showError(err.message);
            }
        });
        document.getElementById('ccBulkRestoreBtn')?.addEventListener('click', async () => {
            const itemIds = Array.from(selectedItemIds);
            const catIds = Array.from(selectedArchivedCatalogIds);
            const grpIds = Array.from(selectedArchivedGroupIds);
            const totalCount = itemIds.length + catIds.length + grpIds.length;
            if (!totalCount) return;

            const tableWrap = document.getElementById('ccTableWrap') || document.querySelector('.cc-table-wrap');
            const pagination = document.getElementById('ccPagination');
            if (tableWrap) tableWrap.classList.add('is-loading');
            if (pagination) pagination.classList.add('is-loading');

            try {
                if (itemIds.length) {
                    await request('batch_restore', {
                        ids: itemIds,
                        view: selection.view,
                        catalog_id: selection.catalogId,
                        group_id: selection.groupId
                    });
                }
                for (const catId of catIds) {
                    await request('restore_catalog', { id: catId });
                }
                for (const grpId of grpIds) {
                    await request('restore_group', { id: grpId });
                }
                selectedItemIds.clear();
                selectedArchivedCatalogIds.clear();
                selectedArchivedGroupIds.clear();
                await load();
                if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                    window.TakeoffAnnouncement.toast(`${totalCount} entity/entities restored successfully.`, 'success');
                }
            } catch (err) {
                showError(err.message);
            } finally {
                if (tableWrap) tableWrap.classList.remove('is-loading');
                if (pagination) pagination.classList.remove('is-loading');
            }
        });
        document.getElementById('ccBulkPurgeBtn')?.addEventListener('click', async () => {
            const itemIds = Array.from(selectedItemIds);
            const catIds = Array.from(selectedArchivedCatalogIds);
            const grpIds = Array.from(selectedArchivedGroupIds);
            const totalCount = itemIds.length + catIds.length + grpIds.length;
            if (!totalCount) return;

            let msg = `Permanently delete ${totalCount} selected entity/entities?`;
            if (catIds.length || grpIds.length) {
                msg += ` WARNING: All items archived with the deleted catalog(s) or group(s) will also be permanently deleted.`;
            }
            msg += ` This action CANNOT be undone.`;

            const ok = await showConfirmDialog({
                title: 'Permanently Delete',
                message: msg,
                confirmText: `Delete Permanently (${totalCount})`,
                cancelText: 'Cancel',
                type: 'error',
                badge: 'PERMANENT DELETE',
                icon: 'fas fa-trash-can',
                primaryDanger: true
            });
            if (!ok) return;

            const tableWrap = document.getElementById('ccTableWrap') || document.querySelector('.cc-table-wrap');
            const pagination = document.getElementById('ccPagination');
            if (tableWrap) tableWrap.classList.add('is-loading');
            if (pagination) pagination.classList.add('is-loading');

            try {
                if (itemIds.length) {
                    await request('batch_purge', {
                        ids: itemIds,
                        view: selection.view,
                        catalog_id: selection.catalogId,
                        group_id: selection.groupId
                    });
                }
                for (const catId of catIds) {
                    await request('purge_catalog', { id: catId });
                }
                for (const grpId of grpIds) {
                    await request('purge_group', { id: grpId });
                }
                selectedItemIds.clear();
                selectedArchivedCatalogIds.clear();
                selectedArchivedGroupIds.clear();
                await load();
                if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                    window.TakeoffAnnouncement.toast(`${totalCount} entity/entities permanently deleted.`, 'success');
                }
            } catch (err) {
                showError(err.message);
            } finally {
                if (tableWrap) tableWrap.classList.remove('is-loading');
                if (pagination) pagination.classList.remove('is-loading');
            }
        });

        document.getElementById('ccRowItemFloatingMenu')?.addEventListener('click', event => {
            const btn = event.target.closest('[data-floating-item-action]');
            if (btn) {
                const action = btn.dataset.floatingItemAction;
                const id = Number(btn.dataset.id);
                closeItemRowMenu();
                itemAction(action, id);
            }
        });

        function initIoFeature() {
            const moreBtn = document.getElementById('ccMoreActionsBtn');
            const moreMenu = document.getElementById('ccHeaderMoreMenu');
            const modal = document.getElementById('ccIoModal');
            if (!moreBtn || !moreMenu || !modal) return;

            const ioApiUrl = '../api/catalog_io.php';
            let currentIoMode = 'export';

            function triggerDownload(url) {
                const a = document.createElement('a');
                a.href = url;
                a.setAttribute('download', '');
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    if (a.parentNode) {
                        a.parentNode.removeChild(a);
                    }
                }, 250);
            }

            function toggleMoreMenu(show) {
                const isHidden = typeof show === 'boolean' ? !show : !moreMenu.hidden;
                moreMenu.hidden = isHidden;
                moreBtn.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
            }

            moreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMoreMenu();
            });

            document.getElementById('ccMenuDownloadItemsTemplate')?.addEventListener('click', () => {
                toggleMoreMenu(false);
                triggerDownload(`${ioApiUrl}?action=template&type=items`);
            });

            document.getElementById('ccMenuDownloadAssembliesTemplate')?.addEventListener('click', () => {
                toggleMoreMenu(false);
                triggerDownload(`${ioApiUrl}?action=template&type=assemblies`);
            });

            document.getElementById('ccMenuExportCatalog')?.addEventListener('click', () => {
                toggleMoreMenu(false);
                openIoModal('export');
            });

            document.getElementById('ccMenuImportCatalog')?.addEventListener('click', () => {
                toggleMoreMenu(false);
                openIoModal('import');
            });

            const tabExport = document.getElementById('ccIoTabExport');
            const tabImport = document.getElementById('ccIoTabImport');
            const sectionExport = document.getElementById('ccIoExportSection');
            const sectionImport = document.getElementById('ccIoImportSection');
            const submitIcon = document.getElementById('ccIoSubmitIcon');
            const submitText = document.getElementById('ccIoSubmitText');
            const errEl = document.getElementById('ccIoModalError');
            const succEl = document.getElementById('ccIoModalSuccess');
            const catSelect = document.getElementById('ccIoCatalogSelect');
            const grpSelect = document.getElementById('ccIoGroupSelect');
            const fileInput = document.getElementById('ccIoFileInput');
            const submitBtn = document.getElementById('ccIoSubmitBtn');

            // Selectable cards interaction for Export Content options (Create New Project style)
            const exportCards = sectionExport?.querySelectorAll('.bb-mode-card');
            exportCards?.forEach(card => {
                card.addEventListener('click', () => {
                    exportCards.forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    const radio = card.querySelector('input[type="radio"]');
                    if (radio) radio.checked = true;
                });
            });

            function setIoMode(mode) {
                currentIoMode = mode;
                if (errEl) errEl.style.display = 'none';
                if (succEl) succEl.style.display = 'none';
                if (mode === 'export') {
                    tabExport?.classList.add('is-active');
                    tabImport?.classList.remove('is-active');
                    if (sectionExport) sectionExport.style.display = 'block';
                    if (sectionImport) sectionImport.style.display = 'none';
                    if (submitIcon) submitIcon.className = 'fas fa-file-export';
                    if (submitText) submitText.textContent = 'Export Excel';
                } else {
                    tabImport?.classList.add('is-active');
                    tabExport?.classList.remove('is-active');
                    if (sectionImport) sectionImport.style.display = 'block';
                    if (sectionExport) sectionExport.style.display = 'none';
                    if (submitIcon) submitIcon.className = 'fas fa-file-import';
                    if (submitText) submitText.textContent = 'Import Excel';
                }
            }

            tabExport?.addEventListener('click', () => setIoMode('export'));
            tabImport?.addEventListener('click', () => setIoMode('import'));

            function updateIoGroups() {
                if (!catSelect || !grpSelect) return;
                const catId = Number(catSelect.value);
                grpSelect.innerHTML = '<option value="all">All Groups (Whole Catalog)</option>';
                const groups = (state.groups || []).filter(g => Number(g.catalog_id) === catId);
                groups.forEach(g => {
                    const opt = document.createElement('option');
                    opt.value = g.id;
                    opt.textContent = g.name;
                    if (Number(selection.groupId) === Number(g.id)) {
                        opt.selected = true;
                    }
                    grpSelect.appendChild(opt);
                });
            }

            catSelect?.addEventListener('change', updateIoGroups);

            function openIoModal(mode = 'export') {
                if (!catSelect) return;
                catSelect.innerHTML = '';
                const cats = state.catalogs || [];
                cats.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name;
                    if (Number(selection.catalogId) === Number(c.id)) {
                        opt.selected = true;
                    }
                    catSelect.appendChild(opt);
                });
                if (!catSelect.value && cats.length) {
                    catSelect.value = cats[0].id;
                }
                updateIoGroups();
                setIoMode(mode);
                if (fileInput) fileInput.value = '';
                modal.style.display = 'flex';
                modal.classList.add('open');
            }

            function closeIoModal() {
                modal.style.display = 'none';
                modal.classList.remove('open');
            }

            document.getElementById('ccCloseIoModal')?.addEventListener('click', closeIoModal);
            document.getElementById('ccIoCancelBtn')?.addEventListener('click', closeIoModal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeIoModal();
            });

            submitBtn?.addEventListener('click', async () => {
                if (errEl) errEl.style.display = 'none';
                if (succEl) succEl.style.display = 'none';

                const catId = catSelect.value;
                const grpId = grpSelect.value;

                if (!catId) {
                    if (errEl) {
                        errEl.textContent = 'Please select a catalog.';
                        errEl.style.display = 'block';
                    }
                    return;
                }

                if (currentIoMode === 'export') {
                    const scope = document.querySelector('input[name="ccIoExportScope"]:checked')?.value || 'both';
                    
                    if (scope === 'items') {
                        triggerDownload(`${ioApiUrl}?action=export&catalog_id=${encodeURIComponent(catId)}&group_id=${encodeURIComponent(grpId)}&type=items`);
                    } else if (scope === 'assemblies') {
                        triggerDownload(`${ioApiUrl}?action=export&catalog_id=${encodeURIComponent(catId)}&group_id=${encodeURIComponent(grpId)}&type=assemblies`);
                    } else {
                        triggerDownload(`${ioApiUrl}?action=export&catalog_id=${encodeURIComponent(catId)}&group_id=${encodeURIComponent(grpId)}&type=items`);
                        setTimeout(() => {
                            triggerDownload(`${ioApiUrl}?action=export&catalog_id=${encodeURIComponent(catId)}&group_id=${encodeURIComponent(grpId)}&type=assemblies`);
                        }, 500);
                    }
                    if (succEl) {
                        succEl.textContent = 'Export started! Your Excel spreadsheet(s) will download shortly.';
                        succEl.style.display = 'block';
                    }
                    setTimeout(closeIoModal, 1500);
                } else {
                    const file = fileInput.files?.[0];
                    if (!file) {
                        if (errEl) {
                            errEl.textContent = 'Please select an Excel (.xlsx) file to upload.';
                            errEl.style.display = 'block';
                        }
                        return;
                    }

                    const importType = document.getElementById('ccIoImportType')?.value || 'auto';
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('catalog_id', catId);
                    formData.append('group_id', grpId);
                    formData.append('import_type', importType);

                    submitBtn.disabled = true;
                    if (submitIcon) submitIcon.className = 'fas fa-spinner fa-spin';
                    if (submitText) submitText.textContent = 'Importing...';

                    try {
                        const res = await fetch(`${ioApiUrl}?action=import`, {
                            method: 'POST',
                            body: formData
                        });
                        const data = await res.json();
                        if (!data.success) {
                            throw new Error(data.error || 'Import failed.');
                        }

                        let msg = `Import completed successfully! Created: ${data.created}, Updated: ${data.updated}`;
                        if (data.parts_linked) {
                            msg += `, Parts linked: ${data.parts_linked}`;
                        }
                        if (data.total_errors) {
                            msg += ` (${data.total_errors} item(s) had warnings)`;
                        }

                        if (succEl) {
                            succEl.textContent = msg;
                            succEl.style.display = 'block';
                        }
                        if (fileInput) fileInput.value = '';

                        await load();

                        if (window.TakeoffAnnouncement && typeof window.TakeoffAnnouncement.toast === 'function') {
                            window.TakeoffAnnouncement.toast(msg, 'success');
                        }

                        setTimeout(closeIoModal, 2200);
                    } catch (err) {
                        if (errEl) {
                            errEl.textContent = err.message || 'An error occurred during import.';
                            errEl.style.display = 'block';
                        }
                    } finally {
                        submitBtn.disabled = false;
                        if (submitIcon) submitIcon.className = 'fas fa-file-import';
                        if (submitText) submitText.textContent = 'Import Excel';
                    }
                }
            });
        }

        initCustomSelects();
        initIoFeature();
        load();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
    document.addEventListener('click', event => {
        if (!event.target.closest('#ccRowItemFloatingMenu') && !event.target.closest('[data-item-menu]')) closeItemRowMenu();
        if (!event.target.closest('#ccTreeMoreMenu') && !event.target.closest('.cc-tree-more-btn')) closeTreeMoreMenu();
        if (!event.target.closest('.cc-header-menu-wrap')) {
            const hm = document.getElementById('ccHeaderMoreMenu');
            if (hm && !hm.hidden) {
                hm.hidden = true;
                document.getElementById('ccMoreActionsBtn')?.setAttribute('aria-expanded', 'false');
            }
        }
        if (!event.target.closest('.pro-custom-dropdown')) document.querySelectorAll('.pro-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            document.querySelectorAll('.pro-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
            closeTreeMoreMenu();
            closeItemRowMenu();
            closeCatalogModal();
            closeGroupModal();
            closeGroupArchive();
            closeItemDetails();
            closeItemModals();
            document.getElementById('ccCloseIoModal')?.click();
            const hm = document.getElementById('ccHeaderMoreMenu');
            if (hm && !hm.hidden) {
                hm.hidden = true;
                document.getElementById('ccMoreActionsBtn')?.setAttribute('aria-expanded', 'false');
            }
        }
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
            }
        }
    });

    try {
        const themeObserver = new MutationObserver(() => {
            renderActions();
            renderItems();
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (_) {}
})();
