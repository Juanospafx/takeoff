(function (global) {
    'use strict';

    function create(options) {
        const documentRef = options.document;
        const windowRef = options.window;
        let detailsItemId = null;
        let detailsReturnFocus = null;

        function safeExternalUrl(value) {
            try {
                const url = new URL(String(value || ''), windowRef.location.href);
                return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
            } catch (_) {
                return '';
            }
        }

        function detailField(label, value) {
            const display = value === null || value === undefined || value === '' ? 'Not provided' : value;
            return `<div class="cc-detail-field"><dt>${options.escape(label)}</dt><dd>${options.escape(display)}</dd></div>`;
        }

        function detailLink(label, value) {
            const url = safeExternalUrl(value);
            return `<div class="cc-detail-field"><dt>${options.escape(label)}</dt><dd>${url ? `<a href="${options.escape(url)}" target="_blank" rel="noopener noreferrer">Open ${options.escape(label)} <i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : 'Not provided'}</dd></div>`;
        }

        function renderItemDetails(item) {
            const type = String(item.item_type || 'part').toLowerCase();
            const metrics = options.canonicalItemMetrics(item);
            const common = [
                detailField('Type', options.displayItemType(type)),
                detailField('Description', item.description),
                detailField('Unit of measure', item.unit_of_measure || 'ea'),
                detailField('Measurement type', item.measurement_type || 'count'),
                detailField('Catalog', item.catalog_name),
                detailField('Group', item.group_name),
                detailField('Cost code', item.cost_code),
                detailField('Part # / Catalog number', item.catalog_number),
                detailField('Notes', item.notes)
            ];
            const laborTimeSnippet = type === 'labor'
                ? ''
                : `<span class="cc-detail-metric-divider">·</span><span class="cc-detail-metric-labor" title="Labor time"><i class="fas fa-clock" aria-hidden="true"></i> ${options.formatLaborHours(item.labor_hours)} hr</span>`;
            const parts = type === 'assembly' ? options.getAssemblyParts(Number(item.id)) : [];
            const included = type === 'assembly' ? `
                <section class="cc-detail-section cc-included-section">
                    <div class="cc-detail-section-header">
                        <h3><i class="fas fa-boxes-stacked" aria-hidden="true"></i> Included items</h3>
                        <span class="cc-detail-count-badge">${parts.length} ${parts.length === 1 ? 'item' : 'items'}</span>
                    </div>
                    <div class="cc-included-items">
                        ${parts.map((part) => {
                            const childName = options.escape(part.child_item_name || 'Catalog item');
                            const childUnit = options.escape(part.child_unit_of_measure || part.child_item_unit || 'ea');
                            const qtyVal = Number(part.quantity || 0);
                            const costSnap = options.money(part.unit_cost_snapshot);
                            const laborSnap = options.formatLaborHours(part.unit_labor_time_snapshot);
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
            return `<section class="cc-detail-summary"><span class="cc-pill">${options.displayItemType(type)}</span><h3>${options.escape(item.name)}</h3><p>${options.escape(item.description || 'No description provided.')}</p><div class="cc-detail-metrics"><strong>${options.escape(metrics.primary)}</strong><span>${options.escape(metrics.secondary)}</span>${laborTimeSnippet}</div></section>${included}<section class="cc-detail-section"><h3>Item information</h3><dl class="cc-detail-list">${common.join('')}${detailField('Taxable', Number(item.taxable) ? 'Yes' : 'No')}${detailLink('EPD', item.epd_url)}${detailLink('Attachment', item.attachment_url)}</dl></section>`;
        }

        function open(itemId, trigger) {
            const drawer = documentRef.getElementById('ccItemDetailsDrawer');
            if (detailsItemId === Number(itemId) && drawer && drawer.classList.contains('open')) {
                close();
                return;
            }
            const item = options.getItems().find(row => Number(row.id) === Number(itemId));
            if (!item) return;
            detailsItemId = Number(item.id);
            detailsReturnFocus = trigger || documentRef.activeElement;
            documentRef.querySelectorAll('#ccItemsBody tr.is-selected').forEach(row => row.classList.remove('is-selected'));
            documentRef.querySelector(`#ccItemsBody tr[data-item-row="${itemId}"]`)?.classList.add('is-selected');
            documentRef.getElementById('ccItemDetailsTitle').textContent = 'Item Details';
            documentRef.getElementById('ccItemDetailsBody').innerHTML = renderItemDetails(item);
            if (drawer) {
                drawer.classList.add('open');
                drawer.setAttribute('aria-hidden', 'false');
            }
        }

        function close() {
            if (detailsItemId === null) return;
            detailsItemId = null;
            documentRef.querySelectorAll('#ccItemsBody tr.is-selected').forEach(row => row.classList.remove('is-selected'));
            const drawer = documentRef.getElementById('ccItemDetailsDrawer');
            if (drawer) {
                drawer.classList.remove('open');
                drawer.setAttribute('aria-hidden', 'true');
            }
            const target = detailsReturnFocus;
            detailsReturnFocus = null;
            target?.focus?.();
        }

        function openMenu(triggerBtn, itemId) {
            if (!options.canWrite()) return;
            itemId = Number(itemId);
            const menu = documentRef.getElementById('ccRowItemFloatingMenu');
            if (!menu) return;
            if (!menu.hidden && triggerBtn.classList.contains('is-active')) {
                closeMenu();
                return;
            }
            closeMenu();
            const item = options.getItems().find(row => Number(row.id) === itemId);
            if (!item) return;
            triggerBtn.classList.add('is-active');
            triggerBtn.setAttribute('aria-expanded', 'true');
            const isAssembly = String(item.item_type).toLowerCase() === 'assembly';
            menu.innerHTML = `
                <button type="button" data-floating-item-action="edit" data-id="${itemId}"><i class="fas fa-pen"></i>Edit</button>
                <button type="button" data-floating-item-action="duplicate" data-id="${itemId}"><i class="far fa-copy"></i>Duplicate</button>
                <button type="button" data-floating-item-action="move" data-id="${itemId}"><i class="fas fa-arrow-right-arrow-left"></i>Move</button>
                ${!isAssembly ? `<button type="button" data-floating-item-action="assembly" data-id="${itemId}"><i class="fas fa-cubes"></i>Convert to assembly</button>` : ''}
                <button type="button" class="danger" data-floating-item-action="delete" data-id="${itemId}"><i class="fas fa-box-archive"></i>Archive</button>`;
            menu.style.display = '';
            menu.hidden = false;
            const zoom = parseFloat(windowRef.getComputedStyle(documentRef.documentElement).zoom) || 1;
            const rect = triggerBtn.getBoundingClientRect();
            const menuWidth = 175;
            const menuHeight = isAssembly ? 140 : 175;
            let left = (rect.left / zoom) - menuWidth - 4;
            if (left < 10) left = (rect.right / zoom) + 4;
            let top = rect.top / zoom;
            const maxTop = (windowRef.innerHeight / zoom) - menuHeight - 12;
            if (top > maxTop) top = Math.max(10, maxTop);
            menu.style.left = `${Math.round(left)}px`;
            menu.style.top = `${Math.round(top)}px`;
        }

        function closeMenu() {
            const menu = documentRef.getElementById('ccRowItemFloatingMenu');
            if (menu) {
                menu.hidden = true;
                menu.innerHTML = '';
            }
            documentRef.querySelectorAll('.cc-row-menu-toggle.is-active').forEach(button => {
                button.classList.remove('is-active');
                button.setAttribute('aria-expanded', 'false');
            });
        }

        return {
            close,
            closeMenu,
            isOpen: () => detailsItemId !== null,
            isSelected: itemId => detailsItemId === Number(itemId),
            open,
            openMenu,
            renderItemDetails
        };
    }

    global.CostCatalogItemInspector = { create };
}(window));
