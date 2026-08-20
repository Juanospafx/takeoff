(function () {
    const root = document.getElementById('proposalModule');
    if (!root) return;

    const state = window.ProjectState || {};
    const projectId = root.dataset.projectId || state.projectId || 'draft';
    const settingsKey = `takeoff.proposal.settings.${projectId || 'draft'}`;
    const bannerKey = `takeoff.proposal.banner.${projectId || 'draft'}`;
    const estimatingKey = `takeoff.estimating.module.${projectId || 'draft'}`;
    const settingsPanel = document.getElementById('proposalSettingsPanel');
    const documentNode = document.getElementById('proposalDocument');
    const builderNote = document.getElementById('proposalBuilderNote');
    const exportMenu = document.getElementById('proposalExportMenu');
    const exportToggle = root.querySelector('[data-proposal-export-toggle]');
    const banner = document.getElementById('proposalFeatureBanner');
    const estimateFooter = document.getElementById('proposalEstimateTypesFooter');

    const defaultIncluded = new Set(['Furnish and install listed materials', 'Labor during normal business hours', 'Coordination with project drawings']);
    const defaultExcluded = new Set(['Permit fees unless noted', 'Utility company charges', 'Work not shown in documents']);
    const defaultScope = 'Describe the scope of work for this estimate.';
    const defaults = {
        groupsOnly: true,
        lumpSum: false,
        material: { quantity: false, assemblyItems: false, itemTotalCost: true, combinedUnitCost: false, groupSubtotals: false, manufacturer: false, catalogNumber: false, description: false },
        groupBy: 'Groups',
        summary: { laborMaterials: true, taxes: true, overhead: true, profit: true, acceptedBy: true, date: true, showDecimals: true, roundTotal: false, priceSqft: false },
        costItems: { groupSubtotals: true, summary: true, estimateTotal: true },
        proposalBuilder: false,
        coverPage: 'None',
        appendixPage: 'None'
    };
    let proposalSettings = loadSettings();

    function deepMerge(base, next) {
        const merged = { ...base };
        Object.keys(next || {}).forEach((key) => {
            merged[key] = next[key] && typeof next[key] === 'object' && !Array.isArray(next[key]) ? deepMerge(base[key] || {}, next[key]) : next[key];
        });
        return merged;
    }

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(settingsKey) || 'null');
            return saved ? deepMerge(defaults, saved) : deepMerge(defaults, {});
        } catch (error) {
            return deepMerge(defaults, {});
        }
    }

    function saveSettings() {
        try { localStorage.setItem(settingsKey, JSON.stringify(proposalSettings)); } catch (error) {}
    }

    function getPath(obj, path) {
        return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj);
    }

    function setPath(obj, path, value) {
        const parts = path.split('.');
        let cursor = obj;
        parts.slice(0, -1).forEach((part) => {
            cursor[part] = cursor[part] || {};
            cursor = cursor[part];
        });
        cursor[parts[parts.length - 1]] = value;
    }

    function esc(value) {
        return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function cleanHtml(value) {
        const holder = document.createElement('div');
        holder.innerHTML = String(value || '');
        holder.querySelectorAll('script, style, iframe, object').forEach((node) => node.remove());
        holder.querySelectorAll('*').forEach((node) => {
            [...node.attributes].forEach((attr) => {
                if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
            });
        });
        return holder.innerHTML.trim();
    }

    function textFromHtml(value) {
        const holder = document.createElement('div');
        holder.innerHTML = String(value || '');
        return holder.textContent.trim();
    }

    function num(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function money(value) {
        const amount = proposalSettings.summary.roundTotal ? Math.round(num(value)) : num(value);
        const digits = proposalSettings.summary.showDecimals ? 2 : 0;
        return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
    }

    function firstValue(values) {
        return values.find((value) => String(value ?? '').trim() !== '') || '';
    }

    function readEstimatingNotes() {
        try {
            const parsed = JSON.parse(localStorage.getItem(estimatingKey) || 'null');
            if (!parsed || typeof parsed !== 'object') return {};
            const activeEstimate = Array.isArray(parsed.estimates) ? parsed.estimates.find(estimate => String(estimate.id) === String(parsed.activeEstimateId)) : null;
            const notes = activeEstimate?.notes || parsed;
            const scopeValue = notes.scope || '';
            const scopeText = textFromHtml(scopeValue);
            return {
                scope: scopeText && scopeText !== defaultScope ? cleanHtml(scopeValue) : '',
                included: Array.isArray(notes.included) ? notes.included.map((item) => String(item || '').trim()).filter((item) => item && !defaultIncluded.has(item)) : [],
                excluded: Array.isArray(notes.excluded) ? notes.excluded.map((item) => String(item || '').trim()).filter((item) => item && !defaultExcluded.has(item)) : [],
                projectNotes: cleanHtml(notes.projectNotes || '')
            };
        } catch (error) {
            return {};
        }
    }

    function readEstimatingModule() {
        try {
            const parsed = JSON.parse(localStorage.getItem(estimatingKey) || 'null');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function getCustomer() {
        const project = state.projectInfo || {};
        const meta = state.projectMeta || {};
        return {
            company: firstValue([meta.customer_company, project.client_name]),
            contact: firstValue([meta.primary_contact]),
            phone: firstValue([meta.customer_phone]),
            email: firstValue([meta.customer_email]),
            address: firstValue([project.job_address, meta.customer_address, meta.address]),
            city: firstValue([project.city, meta.customer_city]),
            region: firstValue([project.state, meta.customer_state]),
            postal: firstValue([project.postal_code, meta.customer_postal_code, meta.customer_zip]),
            country: firstValue([project.country, meta.customer_country])
        };
    }

    function getCompany() {
        const meta = state.projectMeta || {};
        return {
            name: firstValue([meta.company_name, meta.office_name, 'Brightronix']),
            address: firstValue([meta.company_address, meta.office_address, meta.office, 'Company address not configured']),
            phone: firstValue([meta.company_phone, 'Company phone not configured']),
            email: firstValue([meta.company_email, meta.estimator_email, 'Company email not configured']),
            preparedBy: firstValue([meta.estimator, 'Estimator not assigned'])
        };
    }

    function itemFromEstimate(item) {
        const quantity = num(item.quantity ?? item.qty);
        const unitCost = num(item.unit_cost ?? item.unit_price ?? item.cost_each ?? item.unitMaterialCost ?? item.unitCost);
        const total = num(item.total_cost ?? item.subtotal_cost ?? item.totalSales ?? (quantity * unitCost));
        const type = firstValue([item.item_type, item.catalog_item_type, item.cost_type, item.costCategory, item.type]);
        return {
            name: firstValue([item.name, item.catalog_item_name, item.description, 'Cost item']),
            group: firstValue([item.group_name, item.groupName, item.group, item.cost_group, type, 'Ungrouped']),
            budgetCode: firstValue([item.budget_code, item.budgetCode, item.cost_code, item.costCode, item.code]),
            itemType: firstValue([type, 'Cost Item']),
            category: firstValue([item.category, item.catalog_category, item.catalog_name]),
            quantity,
            uom: firstValue([item.unit_of_measure, item.uom, item.unit]),
            unitCost,
            total,
            material: num(item.material_cost ?? item.materialCost),
            labor: num(item.labor_cost ?? item.laborCost),
            equipment: num(item.equipment_cost ?? item.equipmentCost),
            manufacturer: firstValue([item.manufacturer, item.brand]),
            catalogNumber: firstValue([item.catalog_number, item.catalogNumber, item.sku, item.part_number]),
            description: firstValue([item.description, item.notes])
        };
    }

    function realItems() {
        const estimating = readEstimatingModule();
        const activeEstimate = Array.isArray(estimating.estimates) ? estimating.estimates.find(estimate => String(estimate.id) === String(estimating.activeEstimateId)) : null;
        const groups = Array.isArray(activeEstimate?.groups) ? activeEstimate.groups : (Array.isArray(estimating.groups) ? estimating.groups : []);
        if (groups.length) return groups.flatMap(group => (group.items || []).map(item => itemFromEstimate({ ...item, groupName: group.name })));
        return Array.isArray(state.estimateItems) ? state.estimateItems.map(itemFromEstimate) : [];
    }

    function renderEstimateFooter() {
        if (!estimateFooter) return;
        const estimating = readEstimatingModule();
        const estimates = Array.isArray(estimating.estimates) ? estimating.estimates : [];
        const activeId = String(estimating.activeEstimateId || estimates[0]?.id || '');
        estimateFooter.innerHTML = window.ProjectEstimateFooter.render({
            estimates,
            activeEstimateId: activeId,
            selectAttribute: 'data-proposal-estimate-id',
            actionAttribute: 'data-proposal-estimating-action',
            menuAttribute: 'data-proposal-estimate-menu',
            itemActionAttribute: 'data-proposal-estimate-action'
        });
        window.ProjectEstimateFooter.bindMenus?.(estimateFooter, {
            menuAttribute: 'data-proposal-estimate-menu',
            itemActionAttribute: 'data-proposal-estimate-action',
            onAction: (action, estimateId) => window.dispatchEvent(new CustomEvent('takeoff:estimating-estimate-action-requested', {
                detail: { action, estimateId, sourceTab: 'proposal', projectId: String(projectId) }
            }))
        });
    }

    function activateEstimate(estimateId) {
        const estimating = readEstimatingModule();
        if (!Array.isArray(estimating.estimates) || !estimating.estimates.some(estimate => String(estimate.id) === String(estimateId))) return;
        estimating.activeEstimateId = estimateId;
        const active = estimating.estimates.find(estimate => String(estimate.id) === String(estimateId));
        if (active && Array.isArray(active.groups)) estimating.groups = active.groups;
        localStorage.setItem(estimatingKey, JSON.stringify(estimating));
        renderEstimateFooter();
        renderPreview();
        window.dispatchEvent(new CustomEvent('takeoff:active-estimate-changed', { detail: { projectId: String(projectId), estimateId } }));
    }

    function totals(items) {
        const estimating = readEstimatingModule();
        const liveSummary = state.estimateSummary || estimating.estimateSummary || {};
        const estimateTotals = state.estimateTotals || {};
        const itemTotal = items.reduce((sum, item) => sum + num(item.total), 0);
        const material = num(liveSummary.material) || num(estimateTotals.material) || items.reduce((sum, item) => sum + num(item.material), 0);
        const labor = num(liveSummary.labor) || num(estimateTotals.labor) || items.reduce((sum, item) => sum + num(item.labor), 0);
        const equipment = num(liveSummary.equipment) || num(estimateTotals.equipment) || items.reduce((sum, item) => sum + num(item.equipment), 0);
        return {
            material,
            labor,
            equipment,
            markup: num(liveSummary.preTaxMarkup) || num(estimateTotals.markup),
            taxes: num(liveSummary.taxes),
            profit: num(liveSummary.profit),
            total: num(liveSummary.total) || num(estimateTotals.total) || itemTotal
        };
    }

    function groupKey(item) {
        if (proposalSettings.groupBy === 'Budget Code') return item.budgetCode || 'No Budget Code';
        if (proposalSettings.groupBy === 'Item Type') return item.itemType || 'Uncategorized';
        if (proposalSettings.groupBy === 'Catalog Category') return item.category || 'Uncategorized';
        return item.group || 'Ungrouped';
    }

    function groupedItems(items) {
        const groups = new Map();
        items.forEach((item) => {
            const key = groupKey(item);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        });
        return [...groups.entries()].map(([name, children]) => ({ name, children, total: children.reduce((sum, item) => sum + num(item.total), 0) }));
    }

    function renderToggle(label, path) {
        return `<label class="proposal-toggle-row"><span>${esc(label)}</span><span class="proposal-switch"><input type="checkbox" data-proposal-setting="${esc(path)}" ${getPath(proposalSettings, path) ? 'checked' : ''}><span class="proposal-slider"></span></span></label>`;
    }

    function renderSelect(label, path, options) {
        const value = getPath(proposalSettings, path);
        return `<label class="proposal-select-row"><span>${esc(label)}</span><select data-proposal-select="${esc(path)}">${options.map((option) => `<option value="${esc(option)}" ${option === value ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select></label>`;
    }

    function section(title, body) {
        return `<section class="proposal-section"><h3>${esc(title)}</h3><div class="proposal-control-list">${body}</div></section>`;
    }

    function renderCustomerSettings() {
        const customer = getCustomer();
        const hasCustomer = Boolean(customer.company || customer.contact || customer.phone || customer.email || customer.address);
        if (!hasCustomer) return section('Customer Information', '<div class="proposal-customer-box"><div class="proposal-customer-title">No customer assigned</div><button class="proposal-small-btn" type="button" data-proposal-open-overview>Add customer in Overview</button></div>');
        const location = [customer.address, [customer.city, customer.region, customer.postal].filter(Boolean).join(', '), customer.country].filter(Boolean).join('<br>');
        return section('Customer Information', `<div class="proposal-customer-box"><div class="proposal-customer-title">${esc(customer.company || customer.contact || 'Customer')}</div>${location ? `<div>${location}</div>` : ''}${customer.contact ? `<div>${esc(customer.contact)}</div>` : ''}${customer.phone ? `<div>${esc(customer.phone)}</div>` : ''}${customer.email ? `<div>${esc(customer.email)}</div>` : ''}<div class="proposal-customer-actions"><button class="proposal-dot-btn" type="button" title="Customer options">...</button>${customer.email ? '<button class="proposal-small-btn" type="button" data-proposal-contact>Contact</button>' : ''}</div></div>`);
    }

    function renderSettings() {
        const materialRows = [
            ['Quantity', 'material.quantity'],
            ['Assembly Items', 'material.assemblyItems'],
            ['Item Total Cost', 'material.itemTotalCost'],
            ['Combined Unit Cost', 'material.combinedUnitCost'],
            ['Group Subtotals', 'material.groupSubtotals'],
            ['Manufacturer', 'material.manufacturer'],
            ['Catalog Number', 'material.catalogNumber'],
            ['Description', 'material.description']
        ].map(([label, path]) => renderToggle(label, path)).join('');
        settingsPanel.innerHTML = [
            section('Quick Simplification', renderToggle('Groups Only', 'groupsOnly') + renderToggle('Lump Sum', 'lumpSum')),
            section('Material Details', materialRows),
            section('Group By', renderSelect('Group By', 'groupBy', ['Groups', 'Budget Code', 'Item Type', 'Catalog Category'])),
            section('Summary Details', [
                renderToggle('Labor and Materials', 'summary.laborMaterials'), renderToggle('Taxes', 'summary.taxes'), renderToggle('Overhead', 'summary.overhead'), renderToggle('Profit', 'summary.profit'),
                renderToggle('Accepted By', 'summary.acceptedBy'), renderToggle('Date', 'summary.date'), renderToggle('Show 2 decimals', 'summary.showDecimals'), renderToggle('Round Proposal Total', 'summary.roundTotal'), renderToggle('Price / sq ft', 'summary.priceSqft')
            ].join('')),
            section('Cost Items', renderToggle('Group Subtotals', 'costItems.groupSubtotals') + renderToggle('Summary', 'costItems.summary') + renderToggle('Estimate Total', 'costItems.estimateTotal')),
            section('Edit Mode', renderToggle('Proposal Builder', 'proposalBuilder')),
            section('Cover and Appendix Pages', renderSelect('Cover page', 'coverPage', ['None', 'Default Cover', 'Company Cover']) + renderSelect('Appendix page', 'appendixPage', ['None', 'Terms and Conditions', 'Scope Appendix'])),
            renderCustomerSettings()
        ].join('');
    }

    function renderItemTable(groups, allItems) {
        if (!allItems.length) return '<div class="proposal-empty-state">No cost items in estimate yet.</div>';
        if (proposalSettings.lumpSum) return `<table class="proposal-item-table"><tbody><tr class="proposal-group-row"><td>Lump Sum Proposal</td><td class="amount">${money(totals(allItems).total)}</td></tr></tbody></table>`;
        const headers = ['Description'];
        if (proposalSettings.material.quantity) headers.push('Qty');
        if (proposalSettings.material.combinedUnitCost) headers.push('Unit Cost');
        if (proposalSettings.material.itemTotalCost) headers.push('Total');
        const rows = [];
        groups.forEach((group) => {
            rows.push(`<tr class="proposal-group-row"><td colspan="${headers.length}">${esc(group.name)}${proposalSettings.costItems.groupSubtotals || proposalSettings.material.groupSubtotals ? `<span class="amount" style="float:right;">${money(group.total)}</span>` : ''}</td></tr>`);
            if (!proposalSettings.groupsOnly) {
                group.children.forEach((item) => {
                    const details = [];
                    if (proposalSettings.material.description && item.description && item.description !== item.name) details.push(esc(item.description));
                    if (proposalSettings.material.manufacturer && item.manufacturer) details.push(`Manufacturer: ${esc(item.manufacturer)}`);
                    if (proposalSettings.material.catalogNumber && item.catalogNumber) details.push(`Catalog #: ${esc(item.catalogNumber)}`);
                    if (proposalSettings.material.assemblyItems) details.push(esc(item.group || 'Assembly item'));
                    const cells = [`<td><strong>${esc(item.name)}</strong>${details.length ? `<div class="proposal-muted">${details.join('<br>')}</div>` : ''}</td>`];
                    if (proposalSettings.material.quantity) cells.push(`<td>${esc(item.quantity || '')} ${esc(item.uom || '')}</td>`);
                    if (proposalSettings.material.combinedUnitCost) cells.push(`<td class="amount">${money(item.unitCost)}</td>`);
                    if (proposalSettings.material.itemTotalCost) cells.push(`<td class="amount">${money(item.total)}</td>`);
                    rows.push(`<tr>${cells.join('')}</tr>`);
                });
            }
        });
        return `<table class="proposal-item-table"><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    }

    function renderSummary(totalData) {
        if (!proposalSettings.costItems.summary) return '';
        const rows = [];
        if (proposalSettings.summary.laborMaterials) rows.push(['Materials', totalData.material], ['Labor', totalData.labor]);
        if (totalData.equipment) rows.push(['Equipment', totalData.equipment]);
        if (proposalSettings.summary.taxes) rows.push(['Taxes', totalData.taxes]);
        if (proposalSettings.summary.overhead) rows.push(['Overhead / Markup', totalData.markup]);
        if (proposalSettings.summary.profit) rows.push(['Profit', totalData.profit]);
        const sqft = num((state.projectMeta || {}).square_footage);
        if (proposalSettings.summary.priceSqft) rows.push(['Price / sq ft', sqft ? totalData.total / sqft : 0]);
        if (!rows.length) return '';
        return `<section class="proposal-doc-section"><h4>Financial Summary</h4><table class="proposal-summary-table"><tbody>${rows.map(([label, value]) => `<tr><td>${esc(label)}</td><td class="amount">${label === 'Price / sq ft' ? `${money(value)} / sq ft` : money(value)}</td></tr>`).join('')}</tbody></table></section>`;
    }

    function renderAcceptance() {
        const parts = [];
        if (proposalSettings.summary.acceptedBy) parts.push('<div class="proposal-sign-line">Accepted By:</div>');
        if (proposalSettings.summary.date) parts.push('<div class="proposal-sign-line">Date:</div>');
        return parts.length ? `<div class="proposal-acceptance">${parts.join('')}</div>` : '';
    }

    function renderPreview() {
        const project = state.projectInfo || {};
        const meta = state.projectMeta || {};
        const customer = getCustomer();
        const company = getCompany();
        const notes = readEstimatingNotes();
        const items = realItems();
        const totalData = totals(items);
        const draft = state.proposalDraft || {};
        const scope = notes.scope || cleanHtml(project.description || '') || 'No scope of work defined.';
        const overviewNotes = Array.isArray(meta.notes) ? meta.notes.map((note) => String(note.text || note.title || note || '').trim()).filter(Boolean).join('<br>') : '';
        const customerLocation = [customer.address, [customer.city, customer.region, customer.postal].filter(Boolean).join(', '), customer.country].filter(Boolean).join('<br>');
        builderNote.hidden = !proposalSettings.proposalBuilder;
        documentNode.innerHTML = `<div class="proposal-doc-header"><div class="proposal-brand"><div class="proposal-logo">B</div><div><div class="proposal-company-name">${esc(company.name)}</div><div class="proposal-muted">${esc(company.address)}</div><div class="proposal-muted">${esc(company.phone)}</div><div class="proposal-muted">Prepared by: ${esc(company.preparedBy)}</div><div class="proposal-muted">${esc(company.email)}</div></div></div><div class="proposal-quote-meta"><div><strong>Quote:</strong> ${esc(firstValue([draft.proposal_number, draft.quote_number, 'Draft']))}</div><div><strong>Date:</strong> ${esc(new Date().toLocaleDateString('en-US'))}</div></div></div><div class="proposal-doc-title">${esc(firstValue([draft.estimate_name, project.name, project.project_number, 'Draft Proposal']))}</div><div class="proposal-customer-block"><h4>Customer</h4><div><strong>${esc(customer.company || 'No customer assigned')}</strong></div>${customerLocation ? `<div>${customerLocation}</div>` : ''}${customer.contact ? `<div>${esc(customer.contact)}</div>` : ''}${customer.phone ? `<div>${esc(customer.phone)}</div>` : ''}${customer.email ? `<div>${esc(customer.email)}</div>` : ''}</div><section class="proposal-doc-section"><h4>Scope of Work</h4><p>${scope}</p></section>${notes.included && notes.included.length ? `<section class="proposal-doc-section"><h4>Included</h4><ol>${notes.included.map((item) => `<li>${esc(item)}</li>`).join('')}</ol></section>` : ''}${notes.excluded && notes.excluded.length ? `<section class="proposal-doc-section"><h4>Excluded</h4><ol>${notes.excluded.map((item) => `<li>${esc(item)}</li>`).join('')}</ol></section>` : ''}${notes.projectNotes || overviewNotes ? `<section class="proposal-doc-section"><h4>Notes</h4><p>${notes.projectNotes || cleanHtml(overviewNotes)}</p></section>` : ''}<section class="proposal-doc-section"><h4>Cost Items</h4>${renderItemTable(groupedItems(items), items)}</section>${renderSummary(totalData)}${proposalSettings.costItems.estimateTotal ? `<div class="proposal-total-box"><div><div class="label">Estimate Total</div><div>Generated from current estimate data</div></div><div class="value">${money(totalData.total)}</div></div>` : ''}${renderAcceptance()}`;
    }

    function renderAll() {
        renderSettings();
        renderPreview();
        renderEstimateFooter();
    }

    function showToast(message) {
        document.querySelectorAll('.proposal-toast').forEach((node) => node.remove());
        const node = document.createElement('div');
        node.className = 'proposal-toast';
        node.textContent = message;
        document.body.appendChild(node);
        window.setTimeout(() => node.remove(), 3200);
    }

    settingsPanel.addEventListener('change', (event) => {
        const checkbox = event.target.closest('[data-proposal-setting]');
        const select = event.target.closest('[data-proposal-select]');
        if (checkbox) setPath(proposalSettings, checkbox.dataset.proposalSetting, checkbox.checked);
        if (select) setPath(proposalSettings, select.dataset.proposalSelect, select.value);
        if (checkbox || select) {
            saveSettings();
            renderAll();
        }
    });

    settingsPanel.addEventListener('click', (event) => {
        if (event.target.closest('[data-proposal-open-overview]')) document.querySelector('[data-tab="overview"]')?.click();
        if (event.target.closest('[data-proposal-contact]')) {
            const email = getCustomer().email;
            if (email) window.location.href = `mailto:${email}`;
        }
    });

    exportToggle?.addEventListener('click', (event) => {
        event.stopPropagation();
        exportMenu?.classList.toggle('open');
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.proposal-export-wrap')) exportMenu?.classList.remove('open');
    });

    root.querySelectorAll('[data-proposal-export]').forEach((button) => {
        button.addEventListener('click', () => {
            exportMenu?.classList.remove('open');
            if (button.dataset.proposalExport === 'preview') return window.print();
            showToast(button.dataset.proposalExport === 'pdf' ? 'PDF export is ready to be connected.' : 'DOCX export is ready to be connected.');
        });
    });

    if (banner) {
        banner.hidden = localStorage.getItem(bannerKey) === 'dismissed';
        banner.querySelector('[data-proposal-dismiss-banner]')?.addEventListener('click', () => {
            banner.hidden = true;
            try { localStorage.setItem(bannerKey, 'dismissed'); } catch (error) {}
        });
        banner.querySelector('[data-proposal-learn]')?.addEventListener('click', () => showToast('Proposal itemization settings are controlled from Detail Settings.'));
    }

    window.addEventListener('storage', (event) => {
        if (event.key === estimatingKey) { renderPreview(); renderEstimateFooter(); }
    });
    window.addEventListener('takeoff:active-estimate-changed', () => { renderPreview(); renderEstimateFooter(); });
    window.addEventListener('takeoff:estimating-state-updated', () => { renderPreview(); renderEstimateFooter(); });
    window.addEventListener('takeoff:estimate-summary-updated', (event) => {
        if (window.ProjectState) window.ProjectState.estimateSummary = event.detail || {};
        renderPreview();
    });
    estimateFooter?.addEventListener('click', event => {
        const button = event.target.closest('[data-proposal-estimate-id]');
        if (button) activateEstimate(button.dataset.proposalEstimateId);
        const action = event.target.closest('[data-proposal-estimating-action]')?.dataset.proposalEstimatingAction;
        if (action) window.dispatchEvent(new CustomEvent('takeoff:estimating-action-requested', { detail: { action, sourceTab: 'proposal' } }));
    });
    document.querySelector('[data-tab="proposal"]')?.addEventListener('click', () => window.setTimeout(() => { renderPreview(); renderEstimateFooter(); }, 0));
    renderAll();
})();
