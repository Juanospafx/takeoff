(function () {
    const root = document.getElementById('estimatingModule');
    if (!root) return;

    const projectId = Number(root.dataset.projectId || window.ProjectState?.projectId || 0);
    const storageKey = `takeoff.estimating.module.${projectId || 'draft'}`;
    const sourceItems = Array.isArray(window.ProjectState?.estimateItems) ? window.ProjectState.estimateItems : [];
    const squareFootage = Number(window.ProjectState?.projectMeta?.square_footage || 0);

    const columns = [
        ['select', ''], ['name', 'Cost Item'], ['budget', 'Budget Code'], ['qty', 'Quantity'], ['unitCost', 'Unit Cost ($)'],
        ['waste', 'Waste (%)'], ['subtotalCost', 'Subtotal Item Cost ($)'], ['margin', 'Margin (%)'], ['unitSales', 'Unit Sales ($)'],
        ['subtotalSales', 'Subtotal Item Sales ($)'], ['profit', 'Profit ($)'], ['unitLabor', 'Unit Labor'], ['laborRate', 'Labor Rate ($/hr)'],
        ['difficulty', 'Difficulty Factor'], ['totalLabor', 'Total Labor (hrs)'], ['laborCost', 'Total Labor Cost ($)'],
        ['laborMargin', 'Labor Margin (%)'], ['laborSales', 'Total Labor Sales ($)'], ['notes', 'Notes'], ['tax', 'Tax']
    ];

    const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value || 0));
    const number = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
    const id = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const state = loadState();

    function normalizeType(value) {
        const raw = String(value || '').toLowerCase();
        if (raw.includes('labor')) return 'Labor';
        if (raw.includes('equip')) return 'Equipment';
        return 'Materials';
    }

    function groupNameFor(item) {
        return item.group_name || item.cost_type || normalizeType(item.item_type || item.source_type || 'Materials');
    }

    function itemFromEstimate(item) {
        const qty = Number(item.quantity || 0);
        const unitCost = Number(item.unit_cost || 0);
        const unitLabor = Number(item.unit_labor_time || 0);
        const laborHours = Number(item.labor_hours || qty * unitLabor || 0);
        return {
            id: `ei_${item.id || id('item')}`,
            estimateItemId: item.id || null,
            name: item.name || 'Cost item',
            description: item.description || item.catalog_item_name || '',
            type: normalizeType(item.cost_type || item.item_type || item.source_type),
            budgetCode: item.budget_code || '',
            originalQuantity: qty,
            quantity: qty,
            unitCost,
            waste: Number(item.waste_percentage || item.waste_factor_percent || 0),
            margin: Number(item.margin_percentage || item.markup_percent || 0),
            unitLabor,
            laborRate: Number(item.labor_rate || 85),
            difficulty: Number(item.difficulty_factor || 1),
            laborMargin: Number(item.labor_margin_percentage || 0),
            notes: item.notes || '',
            taxable: Number(item.taxable ?? 1) === 1
        };
    }

    function seedGroups() {
        const map = new Map();
        sourceItems.forEach(item => {
            const name = groupNameFor(item);
            if (!map.has(name)) map.set(name, { id: id('grp'), type: 'group', name, expanded: true, items: [] });
            map.get(name).items.push(itemFromEstimate(item));
        });
        if (!map.size) {
            map.set('Materials', { id: id('grp'), type: 'group', name: 'Materials', expanded: true, items: [sampleItem('Materials', 'Duplex Receptacle', 4, 18.5)] });
            map.set('Labor', { id: id('grp'), type: 'group', name: 'Labor', expanded: true, items: [sampleItem('Labor', 'Electrician Labor', 3, 0)] });
        }
        return Array.from(map.values());
    }

    function sampleItem(type, name, qty, unitCost) {
        return { id: id('item'), name, description: '', type, budgetCode: '', originalQuantity: qty, quantity: qty, unitCost, waste: 0, margin: 10, unitLabor: type === 'Labor' ? 60 : 12, laborRate: 85, difficulty: 1, laborMargin: 10, notes: '', taxable: true };
    }

    function defaultState() {
        return {
            search: '', selected: [], fullscreen: false, hiddenColumns: [], laborUnit: 'mins',
            groups: seedGroups(),
            notesCollapsed: false,
            summaryCollapsed: false,
            scope: 'Describe the scope of work for this estimate.',
            projectNotes: '',
            included: ['Furnish and install listed materials', 'Labor during normal business hours', 'Coordination with project drawings'],
            excluded: ['Permit fees unless noted', 'Utility company charges', 'Work not shown in documents'],
            globalLaborCost: 85,
            globalLaborSales: 110,
            preTaxMarkups: [{ id: id('mk'), name: 'Overhead', percent: 4 }, { id: id('mk'), name: 'Discount', percent: 0 }],
            taxes: { Labor: 0, Materials: 0, Equipment: 0 },
            postTaxMarkups: [{ id: id('mk'), name: 'Bonding', percent: 0 }, { id: id('mk'), name: 'Permit Impact Fee', percent: 0 }],
            estimates: [{ id: id('est'), name: 'Primary Estimate', primary: true }],
            activeEstimateId: null
        };
    }

    function loadState() {
        try {
            const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (parsed && Array.isArray(parsed.groups)) return { ...defaultState(), ...parsed };
        } catch (e) {}
        const fresh = defaultState();
        fresh.activeEstimateId = fresh.estimates[0]?.id || null;
        return fresh;
    }

    function persist() {
        state.estimateSummary = publicEstimateSummary();
        localStorage.setItem(storageKey, JSON.stringify(state));
        if (window.ProjectState) window.ProjectState.estimateSummary = state.estimateSummary;
        window.dispatchEvent(new CustomEvent('takeoff:estimate-summary-updated', { detail: state.estimateSummary }));
    }

    function allItems() {
        return state.groups.flatMap(group => group.items.map(item => ({ ...item, groupId: group.id, groupName: group.name })));
    }

    function calcItem(item) {
        const qty = Number(item.quantity || 0);
        const unitCost = Number(item.unitCost || 0);
        const waste = Number(item.waste || 0);
        const margin = Math.min(99.9, Number(item.margin || 0));
        const subtotalCost = qty * unitCost * (1 + waste / 100);
        const unitSales = margin >= 99.9 ? unitCost : unitCost / (1 - margin / 100);
        const subtotalSales = qty * unitSales;
        const unitLabor = Number(item.unitLabor || 0);
        const unitLaborHours = state.laborUnit === 'hrs' ? unitLabor : unitLabor / 60;
        const totalLabor = unitLaborHours * qty * Number(item.difficulty || 1);
        const laborRate = Number(item.laborRate || state.globalLaborCost || 0);
        const laborCost = totalLabor * laborRate;
        const laborMargin = Math.min(99.9, Number(item.laborMargin || 0));
        const laborSales = laborMargin >= 99.9 ? laborCost : laborCost / (1 - laborMargin / 100);
        return { qty, subtotalCost, unitSales, subtotalSales, profit: subtotalSales - subtotalCost, totalLabor, laborCost, laborSales };
    }

    function groupTotals(group) {
        return group.items.reduce((sum, item) => addTotals(sum, calcItem(item)), emptyTotals());
    }

    function emptyTotals() {
        return { subtotalCost: 0, subtotalSales: 0, profit: 0, totalLabor: 0, laborCost: 0, laborSales: 0 };
    }

    function addTotals(a, b) {
        return { subtotalCost: a.subtotalCost + b.subtotalCost, subtotalSales: a.subtotalSales + b.subtotalSales, profit: a.profit + b.profit, totalLabor: a.totalLabor + b.totalLabor, laborCost: a.laborCost + b.laborCost, laborSales: a.laborSales + b.laborSales };
    }

    function summaryByType() {
        const rows = { Labor: emptyTotals(), Materials: emptyTotals(), Equipment: emptyTotals() };
        allItems().forEach(item => { rows[normalizeType(item.type)] = addTotals(rows[normalizeType(item.type)], calcItem(item)); });
        return rows;
    }

    function baseSubtotal() {
        return allItems().reduce((sum, item) => sum + calcItem(item).subtotalSales + calcItem(item).laborSales, 0);
    }

    function taxBaseByType(type) {
        return allItems().filter(item => normalizeType(item.type) === type && item.taxable).reduce((sum, item) => {
            const c = calcItem(item);
            return sum + c.subtotalSales + c.laborSales;
        }, 0);
    }

    function totals() {
        const subtotal = baseSubtotal();
        const pre = state.preTaxMarkups.reduce((sum, m) => sum + subtotal * Number(m.percent || 0) / 100, 0);
        const taxableBase = subtotal + pre;
        const tax = ['Labor', 'Materials', 'Equipment'].reduce((sum, type) => sum + taxBaseByType(type) * Number(state.taxes[type] || 0) / 100, 0);
        const postBase = taxableBase + tax;
        const post = state.postTaxMarkups.reduce((sum, m) => sum + postBase * Number(m.percent || 0) / 100, 0);
        return { subtotal, pre, tax, post, total: subtotal + pre + tax + post };
    }

    function publicEstimateSummary() {
        const byType = summaryByType();
        const t = totals();
        return {
            subtotal: t.subtotal,
            preTaxMarkup: t.pre,
            taxes: t.tax,
            postTaxMarkup: t.post,
            total: t.total,
            material: byType.Materials.subtotalSales,
            labor: byType.Labor.laborSales + byType.Labor.subtotalSales,
            equipment: byType.Equipment.subtotalSales,
            profit: Object.values(byType).reduce((sum, row) => sum + row.profit + row.laborSales - row.laborCost, 0),
            activeEstimateId: state.activeEstimateId,
            updatedAt: new Date().toISOString()
        };
    }

    function render() {
        renderToolbar();
        renderTable();
        renderNotes();
        renderSummary();
        renderVersions();
        persist();
    }

    function isHidden(col) { return state.hiddenColumns.includes(col); }
    function colClass(col) { return isHidden(col) ? 'est-col-hidden' : ''; }

    function renderToolbar() {
        const deleteBtn = root.querySelector('[data-est-action="delete-selected"]');
        if (deleteBtn) deleteBtn.disabled = state.selected.length === 0;
        const search = root.querySelector('#estSearch');
        if (search && search.value !== state.search) search.value = state.search;
        root.classList.toggle('est-fullscreen', state.fullscreen);
    }

    function renderTable() {
        const head = root.querySelector('#estTableHead');
        const body = root.querySelector('#estTableBody');
        if (!head || !body) return;
        head.innerHTML = `<tr>${columns.map(([key, label]) => `<th class="${colClass(key)}">${esc(label)}</th>`).join('')}<th></th></tr>`;
        const query = state.search.toLowerCase();
        body.innerHTML = state.groups.map(group => {
            const items = group.items.filter(item => !query || item.name.toLowerCase().includes(query));
            if (query && !items.length && !group.name.toLowerCase().includes(query)) return '';
            const gt = groupTotals(group);
            const groupRow = `<tr class="est-row-group" data-group-id="${group.id}">
                <td class="${colClass('select')}"><input type="checkbox" data-select-group="${group.id}"></td>
                <td class="est-name-cell ${colClass('name')}"><div class="est-name-main"><button class="est-icon-btn" data-toggle-group="${group.id}"><i class="fas ${group.expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i></button><i class="fas fa-folder"></i><span>${esc(group.name)}</span></div></td>
                <td class="${colClass('budget')}"></td><td class="est-number ${colClass('qty')}">${number(group.items.reduce((s, i) => s + Number(i.quantity || 0), 0))} x</td>
                <td class="${colClass('unitCost')}"></td><td class="${colClass('waste')}"></td><td class="est-money ${colClass('subtotalCost')}">${money(gt.subtotalCost)}</td><td class="${colClass('margin')}"></td><td class="${colClass('unitSales')}"></td><td class="est-money ${colClass('subtotalSales')}">${money(gt.subtotalSales)}</td><td class="est-money ${colClass('profit')}">${money(gt.profit)}</td><td class="${colClass('unitLabor')}"></td><td class="${colClass('laborRate')}"></td><td class="${colClass('difficulty')}"></td><td class="est-number ${colClass('totalLabor')}">${number(gt.totalLabor)}</td><td class="est-money ${colClass('laborCost')}">${money(gt.laborCost)}</td><td class="${colClass('laborMargin')}"></td><td class="est-money ${colClass('laborSales')}">${money(gt.laborSales)}</td><td class="${colClass('notes')}"></td><td class="${colClass('tax')}"></td>
                <td><button class="est-icon-btn" data-add-item="${group.id}"><i class="fas fa-plus"></i></button><button class="est-icon-btn" data-row-menu="group:${group.id}"><i class="fas fa-ellipsis-vertical"></i></button></td>
            </tr>`;
            const itemRows = group.expanded ? items.map(item => itemRow(group, item)).join('') : '';
            return groupRow + itemRows;
        }).join('') || `<tr><td colspan="${columns.length + 1}" class="est-muted">No cost items found.</td></tr>`;
        bindTableEvents();
    }

    function itemRow(group, item) {
        const c = calcItem(item);
        const selected = state.selected.includes(item.id);
        return `<tr class="est-row-item is-child" data-item-id="${item.id}" data-group-id="${group.id}">
            <td class="${colClass('select')}"><input type="checkbox" ${selected ? 'checked' : ''} data-select-item="${item.id}"></td>
            <td class="est-name-cell ${colClass('name')}"><div class="est-name-main"><i class="fas fa-grip-lines est-muted"></i><input class="est-cell-input" value="${esc(item.name)}" data-field="name"></div><div class="est-item-desc"><input class="est-cell-input" value="${esc(item.description)}" placeholder="Description" data-field="description"></div></td>
            <td class="${colClass('budget')}"><input class="est-cell-input" value="${esc(item.budgetCode)}" data-field="budgetCode"></td>
            <td class="${colClass('qty')}"><input class="est-cell-input number" type="number" step="0.01" value="${item.quantity}" data-field="quantity"> x</td>
            <td class="${colClass('unitCost')}"><input class="est-cell-input number" type="number" step="0.01" value="${item.unitCost}" data-field="unitCost"></td>
            <td class="${colClass('waste')}"><input class="est-cell-input number" type="number" step="0.01" value="${item.waste}" data-field="waste"></td>
            <td class="est-money ${colClass('subtotalCost')}">${money(c.subtotalCost)}</td>
            <td class="${colClass('margin')}"><input class="est-cell-input number" type="number" step="0.01" value="${item.margin}" data-field="margin"></td>
            <td class="est-money ${colClass('unitSales')}">${money(c.unitSales)}</td>
            <td class="est-money ${colClass('subtotalSales')}">${money(c.subtotalSales)}</td>
            <td class="est-money ${colClass('profit')}">${money(c.profit)}</td>
            <td class="${colClass('unitLabor')}"><input class="est-cell-input number" type="number" step="0.01" value="${item.unitLabor}" data-field="unitLabor"></td>
            <td class="${colClass('laborRate')}"><input class="est-cell-input number" type="number" step="0.01" value="${item.laborRate}" data-field="laborRate"></td>
            <td class="${colClass('difficulty')}"><input class="est-cell-input number" type="number" step="0.01" value="${item.difficulty}" data-field="difficulty"> x</td>
            <td class="est-number ${colClass('totalLabor')}">${number(c.totalLabor)}</td>
            <td class="est-money ${colClass('laborCost')}">${money(c.laborCost)}</td>
            <td class="${colClass('laborMargin')}"><input class="est-cell-input number" type="number" step="0.01" value="${item.laborMargin}" data-field="laborMargin"></td>
            <td class="est-money ${colClass('laborSales')}">${money(c.laborSales)}</td>
            <td class="${colClass('notes')}"><input class="est-cell-input" value="${esc(item.notes)}" data-field="notes"></td>
            <td class="${colClass('tax')}"><button class="est-toggle ${item.taxable ? 'on' : ''}" data-toggle-tax>${item.taxable ? 'Yes' : 'No'}</button></td>
            <td><select class="est-cell-select" data-field="type"><option ${item.type === 'Labor' ? 'selected' : ''}>Labor</option><option ${item.type === 'Materials' ? 'selected' : ''}>Materials</option><option ${item.type === 'Equipment' ? 'selected' : ''}>Equipment</option></select><button class="est-icon-btn" data-row-menu="item:${group.id}:${item.id}"><i class="fas fa-ellipsis-vertical"></i></button></td>
        </tr>`;
    }

    function bindTableEvents() {
        root.querySelectorAll('[data-toggle-group]').forEach(btn => btn.addEventListener('click', () => { const group = state.groups.find(g => g.id === btn.dataset.toggleGroup); if (group) group.expanded = !group.expanded; render(); }));
        root.querySelectorAll('[data-add-item]').forEach(btn => btn.addEventListener('click', () => addItem(btn.dataset.addItem)));
        root.querySelectorAll('[data-select-item]').forEach(box => box.addEventListener('change', () => { state.selected = box.checked ? [...new Set([...state.selected, box.dataset.selectItem])] : state.selected.filter(id => id !== box.dataset.selectItem); renderToolbar(); persist(); }));
        root.querySelectorAll('[data-select-group]').forEach(box => box.addEventListener('change', () => { const group = state.groups.find(g => g.id === box.dataset.selectGroup); if (!group) return; const ids = group.items.map(i => i.id); state.selected = box.checked ? [...new Set([...state.selected, ...ids])] : state.selected.filter(id => !ids.includes(id)); render(); }));
        root.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', () => updateItemField(input)));
        root.querySelectorAll('[data-toggle-tax]').forEach(btn => btn.addEventListener('click', () => { const item = itemFromRow(btn); if (item) item.taxable = !item.taxable; render(); }));
        root.querySelectorAll('[data-row-menu]').forEach(btn => btn.addEventListener('click', () => rowMenu(btn.dataset.rowMenu)));
    }

    function itemFromRow(el) {
        const row = el.closest('[data-item-id]');
        if (!row) return null;
        const group = state.groups.find(g => g.id === row.dataset.groupId);
        return group?.items.find(i => i.id === row.dataset.itemId) || null;
    }

    function updateItemField(input) {
        const item = itemFromRow(input);
        if (!item) return;
        const field = input.dataset.field;
        const numeric = ['quantity', 'unitCost', 'waste', 'margin', 'unitLabor', 'laborRate', 'difficulty', 'laborMargin'];
        item[field] = numeric.includes(field) ? Number(input.value || 0) : input.value;
        render();
    }

    function addGroup() {
        const name = prompt('Group name', 'New Group');
        if (!name) return;
        state.groups.push({ id: id('grp'), type: 'group', name, expanded: true, items: [] });
        render();
    }

    function addItem(groupId) {
        const group = state.groups.find(g => g.id === groupId) || state.groups[0];
        if (!group) return;
        group.expanded = true;
        group.items.push(sampleItem('Materials', 'New cost item', 1, 0));
        render();
    }

    function rowMenu(token) {
        const parts = String(token || '').split(':');
        if (parts[0] === 'group') {
            const group = state.groups.find(g => g.id === parts[1]);
            if (!group) return;
            const action = prompt('Group action: rename, duplicate, delete', 'rename');
            if (action === 'rename') { const name = prompt('Group name', group.name); if (name) group.name = name; }
            if (action === 'duplicate') state.groups.push({ ...group, id: id('grp'), name: `${group.name} Copy`, items: group.items.map(i => ({ ...i, id: id('item') })) });
            if (action === 'delete' && confirm('Delete this group and its items?')) state.groups = state.groups.filter(g => g.id !== group.id);
        } else if (parts[0] === 'item') {
            const group = state.groups.find(g => g.id === parts[1]);
            const item = group?.items.find(i => i.id === parts[2]);
            if (!group || !item) return;
            const action = prompt('Item action: duplicate, move, delete', 'duplicate');
            if (action === 'duplicate') group.items.push({ ...item, id: id('item'), name: `${item.name} Copy` });
            if (action === 'delete') group.items = group.items.filter(i => i.id !== item.id);
            if (action === 'move') { const target = prompt('Move to group', state.groups.map(g => g.name).join(', ')); const targetGroup = state.groups.find(g => g.name === target); if (targetGroup) { group.items = group.items.filter(i => i.id !== item.id); targetGroup.items.push(item); } }
        }
        render();
    }

    function renderNotes() {
        root.querySelector('#scopeEditor').innerHTML = state.scope || '';
        root.querySelector('#projectNotesEditor').innerHTML = state.projectNotes || '';
        root.querySelector('#includedList').innerHTML = listRows('included');
        root.querySelector('#excludedList').innerHTML = listRows('excluded');
        root.querySelector('#notesCard').classList.toggle('collapsed', state.notesCollapsed);
        bindNoteEvents();
    }

    function listRows(key) {
        return state[key].map((value, index) => `<div class="est-note-row"><input class="est-note-input" value="${esc(value)}" data-list="${key}" data-index="${index}"><button class="est-icon-btn danger" data-remove-list="${key}:${index}"><i class="fas fa-times"></i></button></div>`).join('');
    }

    function bindNoteEvents() {
        root.querySelectorAll('[contenteditable][data-editor]').forEach(editor => editor.oninput = () => { state[editor.dataset.editor] = editor.innerHTML; persist(); });
        root.querySelectorAll('[data-list]').forEach(input => input.addEventListener('input', () => { state[input.dataset.list][Number(input.dataset.index)] = input.value; persist(); }));
        root.querySelectorAll('[data-remove-list]').forEach(btn => btn.addEventListener('click', () => { const [key, index] = btn.dataset.removeList.split(':'); state[key].splice(Number(index), 1); render(); }));
    }

    function renderSummary() {
        const rows = summaryByType();
        const totalRows = ['Labor', 'Materials', 'Equipment'].map(type => summaryRow(type, rows[type])).join('');
        const aggregate = Object.values(rows).reduce(addTotals, emptyTotals());
        root.querySelector('#summaryTypes').innerHTML = totalRows + summaryRow('Subtotal', aggregate, true);
        root.querySelector('#summaryCard').classList.toggle('collapsed', state.summaryCollapsed);
        root.querySelector('#globalLaborCost').value = state.globalLaborCost;
        root.querySelector('#globalLaborSales').value = state.globalLaborSales;
        renderMarkups('preTaxMarkups', 'preMarkupRows', totals().subtotal);
        renderTaxes();
        renderMarkups('postTaxMarkups', 'postMarkupRows', totals().subtotal + totals().pre + totals().tax);
        const t = totals();
        root.querySelector('#estimateTotal').textContent = money(t.total);
        root.querySelector('#estimateSqft').innerHTML = squareFootage > 0 ? `${money(t.total / squareFootage)}/sq ft` : '--/sq ft <a href="#" data-tab-jump="overview">Enter sq ft</a>';
        bindSummaryEvents();
    }

    function summaryRow(label, row, total = false) {
        return `<tr class="${total ? 'est-summary-total' : ''}"><td>${esc(label)}</td><td>${number(row.totalLabor)}</td><td>1.00x</td><td>--</td><td>${money(row.subtotalCost + row.laborCost)}</td><td>${number(row.subtotalSales ? row.profit / Math.max(row.subtotalSales, 1) * 100 : 0)}%</td><td>${money(row.subtotalSales + row.laborSales)}</td><td>${money(row.profit + row.laborSales - row.laborCost)}</td></tr>`;
    }

    function renderMarkups(key, targetId, base) {
        root.querySelector(`#${targetId}`).innerHTML = state[key].map(markup => {
            const value = base * Number(markup.percent || 0) / 100;
            return `<tr><td><input class="est-markup-input" value="${esc(markup.name)}" placeholder="Untitled markup" data-markup-name="${key}:${markup.id}"></td><td><input class="est-markup-input" type="number" step="0.01" value="${markup.percent}" data-markup-percent="${key}:${markup.id}"></td><td>${money(value)}</td><td><button class="est-icon-btn" data-delete-markup="${key}:${markup.id}"><i class="fas fa-ellipsis-vertical"></i></button></td></tr>`;
        }).join('') + `<tr class="est-summary-total"><td>Subtotal</td><td></td><td>${money(state[key].reduce((s, m) => s + base * Number(m.percent || 0) / 100, 0))}</td><td></td></tr>`;
    }

    function renderTaxes() {
        root.querySelector('#taxRows').innerHTML = ['Labor', 'Materials', 'Equipment'].map(type => {
            const value = taxBaseByType(type) * Number(state.taxes[type] || 0) / 100;
            return `<tr><td>${type} Tax</td><td><input class="est-tax-input" type="number" step="0.01" value="${state.taxes[type]}" data-tax="${type}"></td><td>${money(value)}</td></tr>`;
        }).join('') + `<tr class="est-summary-total"><td>Subtotal</td><td></td><td>${money(totals().tax)}</td></tr>`;
    }

    function bindSummaryEvents() {
        root.querySelector('#globalLaborCost').oninput = e => { state.globalLaborCost = Number(e.target.value || 0); render(); };
        root.querySelector('#globalLaborSales').oninput = e => { state.globalLaborSales = Number(e.target.value || 0); persist(); };
        root.querySelectorAll('[data-tax]').forEach(input => input.oninput = () => { state.taxes[input.dataset.tax] = Number(input.value || 0); render(); });
        root.querySelectorAll('[data-markup-name]').forEach(input => input.oninput = () => updateMarkup(input, 'name'));
        root.querySelectorAll('[data-markup-percent]').forEach(input => input.oninput = () => updateMarkup(input, 'percent'));
        root.querySelectorAll('[data-delete-markup]').forEach(btn => btn.onclick = () => { const [key, idValue] = btn.dataset.deleteMarkup.split(':'); state[key] = state[key].filter(m => m.id !== idValue); render(); });
    }

    function updateMarkup(input, field) {
        const [key, idValue] = (input.dataset.markupName || input.dataset.markupPercent).split(':');
        const row = state[key].find(m => m.id === idValue);
        if (!row) return;
        row[field] = field === 'percent' ? Number(input.value || 0) : input.value;
        render();
    }

    function renderVersions() {
        const t = totals();
        root.querySelector('#versionBar').innerHTML = `<span class="est-pill">${state.estimates.length} E</span><span class="est-pill">${state.groups.length} C</span><button class="est-icon-btn" data-version-dropdown><i class="fas fa-chevron-up"></i></button>` + state.estimates.map(est => `<button class="est-version-tab ${state.activeEstimateId === est.id ? 'active' : ''}" data-version="${est.id}"><span><strong>${esc(est.name)}</strong><span>${money(t.total)}</span></span>${est.primary ? '<i class="fas fa-check-circle" style="color:#16a34a"></i>' : ''}<i class="fas fa-ellipsis-vertical" data-version-menu="${est.id}"></i></button>`).join('') + `<button class="est-icon-btn" data-add-version><i class="fas fa-plus"></i></button>`;
        root.querySelectorAll('[data-version]').forEach(btn => btn.onclick = e => { if (e.target.dataset.versionMenu) return; state.activeEstimateId = btn.dataset.version; render(); });
        root.querySelector('[data-add-version]').onclick = () => { const next = { id: id('est'), name: `Alternate ${state.estimates.length}`, primary: false }; state.estimates.push(next); state.activeEstimateId = next.id; render(); };
        root.querySelectorAll('[data-version-menu]').forEach(icon => icon.onclick = e => { e.stopPropagation(); versionMenu(icon.dataset.versionMenu); });
    }

    function versionMenu(versionId) {
        const est = state.estimates.find(row => row.id === versionId);
        if (!est) return;
        const action = prompt('Estimate action: rename, duplicate, primary, delete', 'rename');
        if (action === 'rename') { const name = prompt('Estimate name', est.name); if (name) est.name = name; }
        if (action === 'duplicate') state.estimates.push({ id: id('est'), name: `${est.name} Copy`, primary: false });
        if (action === 'primary') state.estimates.forEach(row => row.primary = row.id === est.id);
        if (action === 'delete' && state.estimates.length > 1) state.estimates = state.estimates.filter(row => row.id !== est.id);
        if (!state.estimates.some(row => row.primary)) state.estimates[0].primary = true;
        state.activeEstimateId = state.estimates[0]?.id || null;
        render();
    }

    root.addEventListener('click', event => {
        const action = event.target.closest('[data-est-action]')?.dataset.estAction;
        if (action === 'create-group') addGroup();
        if (action === 'reset-quantities') { state.groups.forEach(g => g.items.forEach(i => i.quantity = i.originalQuantity)); render(); }
        if (action === 'delete-selected') { state.groups.forEach(g => g.items = g.items.filter(i => !state.selected.includes(i.id))); state.selected = []; render(); }
        if (action === 'fullscreen') { state.fullscreen = !state.fullscreen; render(); }
        if (action === 'add-pre-markup') { state.preTaxMarkups.push({ id: id('mk'), name: 'Untitled markup', percent: 0 }); render(); }
        if (action === 'add-post-markup') { state.postTaxMarkups.push({ id: id('mk'), name: 'Untitled markup', percent: 0 }); render(); }
        if (action === 'add-included') { state.included.push(''); render(); }
        if (action === 'add-excluded') { state.excluded.push(''); render(); }
        if (action === 'browse-library') alert('Library picker placeholder: connect predefined inclusions/exclusions here.');
        const cardToggle = event.target.closest('[data-collapse-card]');
        if (cardToggle) { const key = cardToggle.dataset.collapseCard; state[key] = !state[key]; render(); }
        const cmdButton = event.target.closest('[data-editor-cmd]');
        const cmd = cmdButton?.dataset.editorCmd;
        if (cmd) document.execCommand(cmd, false, cmdButton.dataset.editorValue || null);
    });

    root.querySelector('#estSearch')?.addEventListener('input', e => { state.search = e.target.value.trim(); render(); });
    root.querySelectorAll('[data-editor-format]').forEach(select => select.addEventListener('change', e => document.execCommand(e.target.dataset.editorFormat, false, e.target.value)));
    root.querySelector('[data-est-action="columns"]')?.addEventListener('click', () => root.querySelector('#columnMenu').classList.toggle('open'));
    root.querySelector('[data-est-action="options"]')?.addEventListener('click', () => root.querySelector('#optionsMenu').classList.toggle('open'));
    root.querySelector('#columnMenu')?.addEventListener('change', event => { const col = event.target.value; state.hiddenColumns = event.target.checked ? state.hiddenColumns.filter(c => c !== col) : [...new Set([...state.hiddenColumns, col])]; render(); });
    root.querySelector('[data-labor-unit]')?.addEventListener('click', () => { state.laborUnit = state.laborUnit === 'mins' ? 'hrs' : 'mins'; root.querySelector('[data-labor-unit]').textContent = state.laborUnit === 'mins' ? 'mins' : 'hrs'; render(); });

    window.addEventListener('takeoff:estimating-lines-updated', () => {
        try {
            const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (!parsed || !Array.isArray(parsed.groups)) return;
            Object.assign(state, parsed);
            render();
        } catch (e) {
            console.warn('Unable to refresh estimating from Takeoff', e);
        }
    });

    root.querySelector('#columnMenu').innerHTML = columns.filter(([key]) => key !== 'select').map(([key, label]) => `<label><input type="checkbox" value="${key}" ${isHidden(key) ? '' : 'checked'}> ${esc(label)}</label>`).join('');
    render();
})();
