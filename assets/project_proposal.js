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
    const estimateFooter = document.getElementById('proposalEstimateTypesFooter');

    const defaultIncluded = new Set(['Furnish and install listed materials', 'Labor during normal business hours', 'Coordination with project drawings']);
    const defaultExcluded = new Set(['Permit fees unless noted', 'Utility company charges', 'Work not shown in documents']);
    const defaultScope = 'Describe the scope of work for this estimate.';
    const defaults = {
        schemaVersion: 2,
        pageMode: 'continuous', // 'continuous' or 'paged'
        pageWidth: 'letter',    // 'letter' (8.5in) or 'full' (100%)
        groupsOnly: false,
        lumpSum: false,
        quantityOnly: false,
        material: {
            quantity: true,
            assemblyItems: true,
            itemTotalCost: true,
            combinedUnitCost: false,
            groupSubtotals: false,
            manufacturer: false,
            catalogNumber: false,
            description: false
        },
        groupBy: 'Groups',
        summary: {
            laborMaterials: true,
            taxes: true,
            overhead: true,
            profit: true,
            acceptedBy: true,
            date: true,
            showDecimals: true,
            roundTotal: false,
            priceSqft: false
        },
        costItems: {
            groupSubtotals: true,
            summary: true,
            estimateTotal: true
        },
        proposalBuilder: false,
        coverPage: 'None',
        appendixPage: 'Scope Appendix',
        company: {
            address: '',
            phone: '',
            email: '',
            preparedBy: ''
        },
        metaOverrides: {
            quoteNumber: '',
            title: ''
        }
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
            if (!saved) return deepMerge(defaults, {});
            const migrated = deepMerge(defaults, saved);
            if (!saved.schemaVersion) {
                migrated.schemaVersion = 2;
                migrated.groupsOnly = false;
                migrated.material.quantity = true;
                migrated.material.assemblyItems = true;
            }
            if (!migrated.company || typeof migrated.company !== 'object') {
                migrated.company = { ...defaults.company };
            }
            if (!migrated.metaOverrides || typeof migrated.metaOverrides !== 'object') {
                migrated.metaOverrides = { ...defaults.metaOverrides };
            }
            if (!migrated.pageMode) {
                migrated.pageMode = 'continuous';
            }
            if (!migrated.pageWidth) {
                migrated.pageWidth = 'letter';
            }
            return migrated;
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

    function sanitizeString(value, fallback = '') {
        if (value === null || value === undefined) return fallback;
        if (typeof value === 'object') {
            const extracted = value.name ?? value.title ?? value.label ?? value.code ?? value.category ?? '';
            const s = String(extracted).trim();
            return s !== '' ? s : fallback;
        }
        const s = String(value).trim();
        return s !== '' ? s : fallback;
    }

    function firstValue(values) {
        if (!Array.isArray(values)) return '';
        for (const value of values) {
            const clean = sanitizeString(value);
            if (clean !== '') return clean;
        }
        return '';
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

    function activeEstimateModel() {
        const estimating = readEstimatingModule();
        if (!Array.isArray(estimating.estimates) || !estimating.estimates.length) return null;
        return estimating.estimates.find(estimate => String(estimate.id) === String(estimating.activeEstimateId))
            || estimating.estimates[0]
            || null;
    }

    function canonicalEstimateSummary() {
        const estimate = activeEstimateModel();
        const calculator = window.EstimateCalculationService;
        if (!estimate || !calculator?.calculateSummary) return null;
        return calculator.calculateSummary(estimate.groups || [], estimate.settings || {});
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
        const custom = proposalSettings.company || {};
        return {
            name: 'Brightronix', // Branded exclusively through official logo
            address: firstValue([custom.address, meta.company_address, meta.office_address, meta.office, '123 Business Parkway, Suite 100']),
            phone: firstValue([custom.phone, meta.company_phone, '(555) 234-5678']),
            email: firstValue([custom.email, meta.company_email, meta.estimator_email, 'info@brightronix.com']),
            preparedBy: firstValue([custom.preparedBy, meta.estimator, 'Estimator'])
        };
    }

    function getCustomMeta() {
        const custom = proposalSettings.metaOverrides || {};
        return {
            quoteNumber: custom.quoteNumber || '',
            title: custom.title || ''
        };
    }

    function itemFromEstimate(item) {
        if (!item || typeof item !== 'object') item = {};
        const quantity = num(item.quantity ?? item.takeoff_quantity ?? item.qty);
        const unitCost = num(item.unit_cost ?? item.unit_price ?? item.cost_each ?? item.unitMaterialCost ?? item.unitCost);
        const total = num(item.total_cost ?? item.subtotal_cost ?? item.totalSales ?? (quantity * unitCost));
        const type = firstValue([item.item_type, item.catalog_item_type, item.cost_type, item.costCategory, item.type]);
        const cat = firstValue([
            item.category,
            item.catalog_category,
            item.catalogSnapshot?.classification?.category,
            item.catalogSnapshot?.category,
            item.costCategory,
            item.catalog_name
        ]);
        return {
            name: sanitizeString(firstValue([item.name, item.catalog_item_name, item.description]), 'Cost item'),
            group: sanitizeString(firstValue([item.group_name, item.groupName, item.group, item.cost_group, type]), 'Ungrouped'),
            budgetCode: sanitizeString(firstValue([item.budget_code, item.budgetCode, item.cost_code, item.costCode, item.code])),
            itemType: sanitizeString(firstValue([type]), 'Cost Item'),
            category: sanitizeString(cat, 'Uncategorized'),
            quantity,
            uom: sanitizeString(firstValue([item.unit_of_measure, item.uom, item.unit])),
            unitCost,
            total,
            material: num(item.material_cost ?? item.materialCost),
            labor: num(item.labor_cost ?? item.laborCost),
            equipment: num(item.equipment_cost ?? item.equipmentCost),
            manufacturer: sanitizeString(firstValue([item.manufacturer, item.brand])),
            catalogNumber: sanitizeString(firstValue([item.catalog_number, item.catalogNumber, item.sku, item.part_number])),
            description: sanitizeString(firstValue([item.description, item.notes]))
        };
    }

    function realItems() {
        const canonical = canonicalEstimateSummary();
        if (canonical?.rows) {
            return canonical.rows.flatMap(row => {
                const parent = itemFromEstimate({
                    ...row.item,
                    groupName: row.groupName,
                    materialCost: row.calc.materialSales,
                    laborCost: row.calc.laborSales,
                    equipmentCost: row.calc.equipmentSales,
                    totalSales: row.calc.totalSales
                });
                parent.total = num(row.calc.totalSales);
                parent.unitCost = parent.quantity ? parent.total / parent.quantity : parent.total;
                parent.material = num(row.calc.materialSales);
                parent.labor = num(row.calc.laborSales);
                parent.equipment = num(row.calc.equipmentSales);
                const children = proposalSettings.material.assemblyItems && Array.isArray(row.calc.childRows)
                    ? row.calc.childRows.map(child => {
                        const item = itemFromEstimate({
                            ...child.item,
                            groupName: row.groupName,
                            materialCost: child.calc.materialSales,
                            laborCost: child.calc.laborSales,
                            equipmentCost: child.calc.equipmentSales,
                            totalSales: child.calc.totalSales
                        });
                        item.name = `\u21b3 ${item.name}`;
                        item.total = num(child.calc.totalSales);
                        item.unitCost = item.quantity ? item.total / item.quantity : item.total;
                        item.material = num(child.calc.materialSales);
                        item.labor = num(child.calc.laborSales);
                        item.equipment = num(child.calc.equipmentSales);
                        item.isAssemblyChild = true;
                        return item;
                    }) : [];
                return [parent, ...children];
            });
        }
        const activeEstimate = activeEstimateModel();
        const groups = Array.isArray(activeEstimate?.groups) ? activeEstimate.groups : [];
        if (groups.length) return groups.flatMap(group => (group.items || []).map(item => itemFromEstimate({ ...item, groupName: group.name })));
        return Array.isArray(state.estimateItems) ? state.estimateItems.map(itemFromEstimate) : [];
    }

    function renderEstimateFooter(source = null) {
        if (!estimateFooter) return;
        const estimating = source?.detail && Array.isArray(source.detail.estimates)
            ? { estimates: source.detail.estimates, activeEstimateId: source.detail.activeEstimateId }
            : readEstimatingModule();
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
        window.dispatchEvent(new CustomEvent('takeoff:active-estimate-changed', { detail: { projectId: String(projectId), estimateId } }));
    }

    function totals(items) {
        const canonical = canonicalEstimateSummary();
        if (canonical) {
            return {
                material: num(canonical.direct?.materialSales),
                labor: num(canonical.direct?.laborSales),
                equipment: num(canonical.direct?.equipmentSales),
                markup: num(canonical.totalMarkups),
                preTaxMarkups: Array.isArray(canonical.preTaxMarkups) ? canonical.preTaxMarkups : [],
                preTaxTotal: num(canonical.preTaxTotal),
                taxes: num(canonical.totalTax),
                postTaxMarkups: Array.isArray(canonical.postTaxMarkups) ? canonical.postTaxMarkups : [],
                postTaxTotal: num(canonical.postTaxTotal),
                profit: num(canonical.profit),
                total: num(canonical.estimateTotal)
            };
        }
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
            preTaxMarkups: [],
            preTaxTotal: num(liveSummary.preTaxMarkup) || num(estimateTotals.markup),
            taxes: num(liveSummary.taxes),
            postTaxMarkups: [],
            postTaxTotal: 0,
            profit: num(liveSummary.profit),
            total: num(liveSummary.total) || num(estimateTotals.total) || itemTotal
        };
    }

    function groupKey(item) {
        if (!item || typeof item !== 'object') return 'Ungrouped';
        const mode = String(proposalSettings.groupBy || 'Groups');
        if (mode === 'Budget Code') return sanitizeString(item.budgetCode, 'No Budget Code');
        if (mode === 'Item Type') return sanitizeString(item.itemType, 'Cost Item');
        if (mode === 'Catalog Category') return sanitizeString(item.category, 'Uncategorized');
        return sanitizeString(item.group, 'Ungrouped');
    }

    function groupedItems(items) {
        const groups = new Map();
        (Array.isArray(items) ? items : []).forEach((item) => {
            const key = groupKey(item);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        });
        return [...groups.entries()].map(([name, children]) => ({
            name,
            children,
            total: children.reduce((sum, item) => sum + (item.isAssemblyChild ? 0 : num(item.total)), 0)
        }));
    }

    function getSwitchStatus(path) {
        const isLumpSum = Boolean(proposalSettings.lumpSum && !proposalSettings.quantityOnly);
        const isQtyOnly = Boolean(proposalSettings.quantityOnly);
        const isGroupsOnly = Boolean(proposalSettings.groupsOnly && !isLumpSum);
        const isSummaryOff = Boolean(!proposalSettings.costItems.summary && !isQtyOnly);

        const projectMeta = state.projectMeta || {};
        const sqft = num(projectMeta.square_footage);
        const items = realItems();
        const totalData = totals(items);

        // Has assemblies?
        const hasAssemblies = items.some(i => i.isAssemblyChild || (i.children && i.children.length));

        // Has markups?
        const hasMarkups = (Array.isArray(totalData.preTaxMarkups) && totalData.preTaxMarkups.some(m => m && m.value !== 0)) || Boolean(totalData.markup);
        const hasProfit = Boolean(totalData.profit);

        switch (path) {
            // Quick Simplification
            case 'groupsOnly':
                if (isLumpSum) return { disabled: true, warning: 'Overridden by Lump Sum' };
                break;
            case 'lumpSum':
                if (isQtyOnly) return { disabled: true, warning: 'Incompatible with Quantity Only' };
                break;

            // Material Details
            case 'material.quantity':
                if (isLumpSum) return { disabled: true, warning: 'Overridden by Lump Sum' };
                if (isGroupsOnly) return { disabled: true, warning: 'Items hidden by Groups Only' };
                if (isQtyOnly) return { disabled: true, info: 'Always shown in Quantity Only mode' };
                break;
            case 'material.assemblyItems':
                if (isLumpSum) return { disabled: true, warning: 'Overridden by Lump Sum' };
                if (isGroupsOnly) return { disabled: true, warning: 'Items hidden by Groups Only' };
                if (!hasAssemblies) return { disabled: false, info: 'No assemblies in estimate' };
                break;
            case 'material.itemTotalCost':
            case 'material.combinedUnitCost':
                if (isLumpSum) return { disabled: true, warning: 'Overridden by Lump Sum' };
                if (isGroupsOnly) return { disabled: true, warning: 'Items hidden by Groups Only' };
                if (isQtyOnly) return { disabled: true, warning: 'Costs hidden by Quantity Only' };
                break;
            case 'material.groupSubtotals':
            case 'costItems.groupSubtotals':
                if (isLumpSum) return { disabled: true, warning: 'Overridden by Lump Sum' };
                if (isQtyOnly) return { disabled: true, warning: 'Costs hidden by Quantity Only' };
                break;
            case 'material.manufacturer':
            case 'material.catalogNumber':
            case 'material.description':
                if (isLumpSum) return { disabled: true, warning: 'Overridden by Lump Sum' };
                if (isGroupsOnly) return { disabled: true, warning: 'Items hidden by Groups Only' };
                break;

            // Group By
            case 'groupBy':
                if (isLumpSum) return { disabled: true, warning: 'Overridden by Lump Sum' };
                break;

            // Summary & Totals
            case 'summary.laborMaterials':
            case 'summary.taxes':
                if (isQtyOnly) return { disabled: true, warning: 'Costs hidden by Quantity Only' };
                if (isSummaryOff) return { disabled: true, warning: 'Financial Summary is turned off' };
                break;
            case 'summary.overhead':
                if (isQtyOnly) return { disabled: true, warning: 'Costs hidden by Quantity Only' };
                if (isSummaryOff) return { disabled: true, warning: 'Financial Summary is turned off' };
                if (!hasMarkups) return { disabled: false, info: 'No markups in estimate' };
                break;
            case 'summary.profit':
                if (isQtyOnly) return { disabled: true, warning: 'Costs hidden by Quantity Only' };
                if (isSummaryOff) return { disabled: true, warning: 'Financial Summary is turned off' };
                if (!hasProfit) return { disabled: false, info: 'No profit margin in estimate' };
                break;
            case 'summary.priceSqft':
                if (isQtyOnly) return { disabled: true, warning: 'Costs hidden by Quantity Only' };
                if (isSummaryOff) return { disabled: true, warning: 'Financial Summary is turned off' };
                if (sqft <= 0) return { disabled: false, warning: 'Project sq ft is 0 or not set' };
                break;
            case 'summary.showDecimals':
            case 'summary.roundTotal':
                if (isQtyOnly) return { disabled: true, warning: 'Costs hidden by Quantity Only' };
                break;

            // Cost Items Configuration
            case 'costItems.summary':
                if (isQtyOnly) return { disabled: true, warning: 'Costs hidden by Quantity Only' };
                break;
            case 'costItems.estimateTotal':
                if (isQtyOnly) return { disabled: true, warning: 'Costs hidden by Quantity Only' };
                break;
        }
        return { disabled: false, warning: '', info: '' };
    }

    function renderToggle(label, path) {
        const status = getSwitchStatus(path);
        const checked = Boolean(getPath(proposalSettings, path));
        const isDisabled = Boolean(status.disabled);

        return `
            <div class="proposal-toggle-wrapper ${isDisabled ? 'is-disabled' : ''}">
                <label class="proposal-toggle-row ${isDisabled ? 'is-disabled' : ''}">
                    <span class="proposal-toggle-label">
                        <span class="proposal-toggle-title">${esc(label)}</span>
                        ${status.warning ? `<span class="proposal-dep-badge is-warning"><i class="fas fa-triangle-exclamation"></i> ${esc(status.warning)}</span>` : ''}
                        ${status.info ? `<span class="proposal-dep-badge is-info"><i class="fas fa-circle-info"></i> ${esc(status.info)}</span>` : ''}
                    </span>
                    <span class="proposal-switch ${isDisabled ? 'is-disabled' : ''}">
                        <input type="checkbox" data-proposal-setting="${esc(path)}" ${checked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
                        <span class="proposal-slider"></span>
                    </span>
                </label>
            </div>
        `;
    }

    function renderSelect(label, path, options, labels = null) {
        const status = getSwitchStatus(path);
        const value = getPath(proposalSettings, path);
        const isDisabled = Boolean(status.disabled);
        return `
            <div class="proposal-select-wrapper ${isDisabled ? 'is-disabled' : ''}">
                <div class="proposal-select-row ${isDisabled ? 'is-disabled' : ''}">
                    <div class="proposal-select-label">
                        <span class="proposal-select-title">${esc(label)}</span>
                        ${status.warning ? `<span class="proposal-dep-badge is-warning"><i class="fas fa-triangle-exclamation"></i> ${esc(status.warning)}</span>` : ''}
                    </div>
                    <select data-proposal-select="${esc(path)}" ${isDisabled ? 'disabled' : ''}>
                        ${options.map((option, idx) => `<option value="${esc(option)}" ${option === value ? 'selected' : ''}>${esc(labels ? labels[idx] : option)}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
    }

    function section(title, iconClass, body) {
        return `
            <section class="proposal-section">
                <div class="proposal-card-header">
                    ${iconClass ? `<span class="proposal-card-icon"><i class="${esc(iconClass)}"></i></span>` : ''}
                    <h3>${esc(title)}</h3>
                </div>
                <div class="proposal-control-list">${body}</div>
            </section>
        `;
    }

    function renderCompanySettings() {
        const company = getCompany();
        const custom = proposalSettings.company || {};
        const isCustomized = Boolean(custom.address || custom.phone || custom.email || custom.preparedBy);
        return section('Company & Proposal Info', 'fas fa-building', `
            <div class="proposal-input-group">
                <label>Company Address</label>
                <input type="text" class="proposal-text-input" data-proposal-company-input="address" value="${esc(company.address)}" placeholder="123 Street, City, State ZIP">
            </div>
            <div class="proposal-input-group">
                <label>Phone Number</label>
                <input type="text" class="proposal-text-input" data-proposal-company-input="phone" value="${esc(company.phone)}" placeholder="(555) 000-0000">
            </div>
            <div class="proposal-input-group">
                <label>Email Address</label>
                <input type="text" class="proposal-text-input" data-proposal-company-input="email" value="${esc(company.email)}" placeholder="contact@company.com">
            </div>
            <div class="proposal-input-group">
                <label>Prepared By / Estimator</label>
                <input type="text" class="proposal-text-input" data-proposal-company-input="preparedBy" value="${esc(company.preparedBy)}" placeholder="Estimator Name">
            </div>
            ${isCustomized ? `
                <button type="button" class="proposal-reset-company-btn" data-proposal-reset-company title="Reset company info to project defaults">
                    <i class="fas fa-rotate-left"></i> Reset to Project Defaults
                </button>
            ` : ''}
        `);
    }

    function renderCustomerSettings() {
        const customer = getCustomer();
        const hasCustomer = Boolean(customer.company || customer.contact || customer.phone || customer.email || customer.address);
        if (!hasCustomer) return section('Customer Information', 'fas fa-id-badge', '<div class="proposal-customer-box"><div class="proposal-customer-title">No customer assigned</div><button class="proposal-small-btn" type="button" data-proposal-open-overview><i class="fas fa-plus"></i> Add in Overview</button></div>');
        const location = [customer.address, [customer.city, customer.region, customer.postal].filter(Boolean).join(', '), customer.country].filter(Boolean).join('<br>');
        return section('Customer Information', 'fas fa-id-badge', `
            <div class="proposal-customer-box">
                <div class="proposal-customer-title">${esc(customer.company || customer.contact || 'Customer')}</div>
                ${location ? `<div class="proposal-customer-detail"><i class="fas fa-location-dot"></i> <span>${location}</span></div>` : ''}
                ${customer.contact ? `<div class="proposal-customer-detail"><i class="fas fa-user"></i> <span>${esc(customer.contact)}</span></div>` : ''}
                ${customer.phone ? `<div class="proposal-customer-detail"><i class="fas fa-phone"></i> <span>${esc(customer.phone)}</span></div>` : ''}
                ${customer.email ? `<div class="proposal-customer-detail"><i class="fas fa-envelope"></i> <span>${esc(customer.email)}</span></div>` : ''}
                <div class="proposal-customer-actions">
                    ${customer.email ? '<button class="proposal-small-btn" type="button" data-proposal-contact><i class="fas fa-envelope"></i> Contact</button>' : ''}
                    <button class="proposal-small-btn secondary" type="button" data-proposal-open-overview><i class="fas fa-pencil"></i> Edit</button>
                </div>
            </div>
        `);
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
            section('Page Layout & Sizing', 'fas fa-copy', 
                renderSelect('Page Mode', 'pageMode', ['continuous', 'paged'], ['Extended Continuous Page', 'Multi-Page Sheets (8.5" x 11")']) +
                renderSelect('Page Width', 'pageWidth', ['letter', 'full'], ['8.5" Letter Sheet', 'Full Width (Fit Screen)'])
            ),
            renderCompanySettings(),
            renderCustomerSettings(),
            section('Quick Simplification', 'fas fa-wand-magic-sparkles', renderToggle('Groups Only', 'groupsOnly') + renderToggle('Lump Sum', 'lumpSum') + renderToggle('Quantity Only', 'quantityOnly')),
            section('Material Details', 'fas fa-boxes-stacked', materialRows),
            section('Grouping & Organization', 'fas fa-layer-group', renderSelect('Group By', 'groupBy', ['Groups', 'Budget Code', 'Item Type', 'Catalog Category'])),
            section('Summary & Totals Details', 'fas fa-calculator', [
                renderToggle('Labor and Materials', 'summary.laborMaterials'),
                renderToggle('Taxes', 'summary.taxes'),
                renderToggle('Overhead & Markups', 'summary.overhead'),
                renderToggle('Profit Margin', 'summary.profit'),
                renderToggle('Accepted By Block', 'summary.acceptedBy'),
                renderToggle('Date Signature Line', 'summary.date'),
                renderToggle('Show 2 Decimals', 'summary.showDecimals'),
                renderToggle('Round Total', 'summary.roundTotal'),
                renderToggle('Price / sq ft', 'summary.priceSqft')
            ].join('')),
            section('Cost Items Configuration', 'fas fa-table-list', renderToggle('Group Subtotals', 'costItems.groupSubtotals') + renderToggle('Financial Summary', 'costItems.summary') + renderToggle('Estimate Grand Total', 'costItems.estimateTotal')),
            section('Edit Mode & Tools', 'fas fa-pen-ruler', renderToggle('Proposal Builder Mode', 'proposalBuilder')),
            section('Cover & Appendix Pages', 'fas fa-file-lines', renderSelect('Cover page', 'coverPage', ['None', 'Default Cover', 'Company Cover']) + renderSelect('Appendix page', 'appendixPage', ['None', 'Terms and Conditions', 'Scope Appendix']))
        ].join('');
        // Initialize standardized system custom dropdowns
        if (typeof window.initCustomSelects === 'function') {
            window.initCustomSelects(settingsPanel);
        }
    }

    function getItemTableConfig(allItems) {
        const isQtyOnly = Boolean(proposalSettings.quantityOnly);
        const hasCostColumns = !isQtyOnly && Boolean(proposalSettings.material.itemTotalCost || proposalSettings.material.combinedUnitCost);
        const showGroupCost = hasCostColumns && Boolean(proposalSettings.costItems.groupSubtotals || proposalSettings.material.groupSubtotals);

        const hasQty = Boolean(proposalSettings.material.quantity || isQtyOnly);
        const hasUnitCost = Boolean(hasCostColumns && proposalSettings.material.combinedUnitCost);
        const hasTotal = Boolean(hasCostColumns && proposalSettings.material.itemTotalCost);

        const headers = [{ label: 'Description', className: 'col-desc' }];
        if (hasQty) headers.push({ label: 'Qty', className: 'col-qty' });
        if (hasUnitCost) headers.push({ label: 'Unit Cost', className: 'col-unit-cost' });
        if (hasTotal) headers.push({ label: 'Total', className: 'col-total' });

        // Calculate proportional column percentages so it strictly fills 100% width
        let descWidth = '100%';
        if (hasQty && hasUnitCost && hasTotal) {
            descWidth = '52%';
        } else if (hasQty && hasTotal) {
            descWidth = '66%';
        } else if (hasTotal) {
            descWidth = '75%';
        } else if (hasQty) {
            descWidth = '78%';
        }

        const colHtml = [`<col style="width: ${descWidth};">`];
        if (hasQty) colHtml.push(`<col style="width: ${hasUnitCost && hasTotal ? '15%' : '16%'};">`);
        if (hasUnitCost) colHtml.push(`<col style="width: 16%;">`);
        if (hasTotal) colHtml.push(`<col style="width: ${hasQty && hasUnitCost ? '17%' : '18%'};">`);

        return {
            isQtyOnly,
            hasCostColumns,
            showGroupCost,
            hasQty,
            hasUnitCost,
            hasTotal,
            headers,
            colHtml
        };
    }

    function renderItemTableRow(item, config) {
        if (!item) return '';
        const itemName = sanitizeString(item.name, 'Cost item');
        const details = [];
        if (proposalSettings.material.description && item.description && item.description !== itemName) details.push(esc(item.description));
        if (proposalSettings.material.manufacturer && item.manufacturer) details.push(`Mfr: ${esc(item.manufacturer)}`);
        if (proposalSettings.material.catalogNumber && item.catalogNumber) details.push(`Cat #: ${esc(item.catalogNumber)}`);
        if (proposalSettings.material.assemblyItems && !item.isAssemblyChild) details.push(esc(item.group || 'Assembly item'));

        const isChild = Boolean(item.isAssemblyChild);
        const cleanName = isChild ? itemName.replace(/^\u21b3\s*/, '') : itemName;
        const nameHtml = isChild
            ? `<span class="proposal-item-child-indicator">&rdsh;</span> <span class="proposal-item-child-name">${esc(cleanName)}</span>`
            : `<span class="proposal-item-name">${esc(cleanName)}</span>`;

        const cells = [
            `<td class="col-desc ${isChild ? 'proposal-td-child' : ''}">${nameHtml}${details.length ? `<div class="proposal-muted proposal-item-details">${details.join(' &bull; ')}</div>` : ''}</td>`
        ];
        if (config.hasQty) {
            const qtyStr = window.QuantityFormatService?.proposal ? window.QuantityFormatService.proposal(item.quantity) : Number(item.quantity).toLocaleString();
            cells.push(`<td class="col-qty proposal-td-qty">${esc(qtyStr)} ${esc(item.uom || '')}</td>`);
        }
        if (config.hasUnitCost) {
            cells.push(`<td class="col-unit-cost amount">${money(item.unitCost)}</td>`);
        }
        if (config.hasTotal) {
            cells.push(`<td class="col-total amount ${item.total < 0 ? 'is-negative' : ''}">${money(item.total)}</td>`);
        }
        return `<tr class="${isChild ? 'is-child' : ''}">${cells.join('')}</tr>`;
    }

    function renderGroupTableRow(group, config, isContinuation = false) {
        if (!group) return '';
        const groupName = sanitizeString(group.name, 'Ungrouped');
        const groupTotal = num(group.total);
        const colSpan = (config && Array.isArray(config.headers)) ? config.headers.length : 4;
        return `
            <tr class="proposal-group-row">
                <td colspan="${colSpan}">
                    <div class="proposal-group-row-inner">
                        <span class="proposal-group-name">${esc(groupName)}${isContinuation ? ' <small class="proposal-group-cont">(cont.)</small>' : ''}</span>
                        ${config?.showGroupCost && !isContinuation ? `<span class="proposal-group-amount">${money(groupTotal)}</span>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }

    function renderItemTable(groups, allItems) {
        if (!allItems.length) return '<div class="proposal-empty-state"><i class="fas fa-inbox"></i> No cost items in this estimate yet. Add items in Takeoff or Estimating.</div>';
        if (proposalSettings.lumpSum && !proposalSettings.quantityOnly) {
            return `<table class="proposal-item-table">
                <colgroup><col style="width: 75%;"><col style="width: 25%;"></colgroup>
                <tbody>
                    <tr class="proposal-group-row">
                        <td colspan="2">
                            <div class="proposal-group-row-inner">
                                <span class="proposal-group-name">Lump Sum Proposal</span>
                                <span class="proposal-group-amount">${money(totals(allItems).total)}</span>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>`;
        }

        const config = getItemTableConfig(allItems);
        const rows = [];
        groups.forEach((group) => {
            rows.push(renderGroupTableRow(group, config, false));
            if (!proposalSettings.groupsOnly) {
                group.children.forEach((item) => {
                    rows.push(renderItemTableRow(item, config));
                });
            }
        });

        return `
            <table class="proposal-item-table">
                <colgroup>${config.colHtml.join('')}</colgroup>
                <thead>
                    <tr>${config.headers.map(h => `<th class="${h.className}">${esc(h.label)}</th>`).join('')}</tr>
                </thead>
                <tbody>${rows.join('')}</tbody>
            </table>
        `;
    }

    function renderItemTableSlice(entries, allItems) {
        if (!entries || !entries.length) return '';
        if (proposalSettings.lumpSum && !proposalSettings.quantityOnly) {
            return `<table class="proposal-item-table">
                <colgroup><col style="width: 75%;"><col style="width: 25%;"></colgroup>
                <tbody>
                    <tr class="proposal-group-row">
                        <td colspan="2">
                            <div class="proposal-group-row-inner">
                                <span class="proposal-group-name">Lump Sum Proposal</span>
                                <span class="proposal-group-amount">${money(totals(allItems).total)}</span>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>`;
        }

        const config = getItemTableConfig(allItems);
        const rows = [];

        // If the first entry in this slice is an item whose group wasn't rendered on this page, prepend a continuation header
        if (entries[0] && entries[0].type === 'item' && entries[0].group) {
            rows.push(renderGroupTableRow(entries[0].group, config, true));
        }

        entries.forEach((entry) => {
            if (!entry) return;
            if (entry.type === 'group' && entry.group) {
                rows.push(renderGroupTableRow(entry.group, config, Boolean(entry.isContinuation)));
            } else if (entry.type === 'item' && entry.item) {
                rows.push(renderItemTableRow(entry.item, config));
            }
        });

        return `
            <table class="proposal-item-table">
                <colgroup>${config.colHtml.join('')}</colgroup>
                <thead>
                    <tr>${config.headers.map(h => `<th class="${h.className}">${esc(h.label)}</th>`).join('')}</tr>
                </thead>
                <tbody>${rows.join('')}</tbody>
            </table>
        `;
    }

    function openCustomerEditInOverview() {
        const overviewTab = document.querySelector('[data-tab="overview"]');
        if (overviewTab) {
            overviewTab.click();
            window.setTimeout(() => {
                const btn = document.getElementById('editCustomerInfoBtn') ||
                            document.getElementById('toggleCustomerDrawerBtn') ||
                            document.getElementById('addCustomerBtn') ||
                            document.getElementById('customerFilledRow');
                if (btn) {
                    btn.click();
                } else {
                    document.getElementById('pdCustomerModal')?.classList.add('open');
                }
            }, 180);
        }
    }

    function showContactWaitModal(customer) {
        document.querySelectorAll('#proposalContactModal').forEach(el => el.remove());
        const email = customer.email;
        if (!email) {
            showToast('No customer email address on file.');
            return;
        }
        const modal = document.createElement('div');
        modal.id = 'proposalContactModal';
        modal.className = 'proposal-contact-modal-backdrop';
        modal.innerHTML = `
            <div class="proposal-contact-modal-card">
                <div class="proposal-contact-modal-spinner">
                    <i class="fas fa-circle-notch fa-spin"></i>
                </div>
                <div class="proposal-contact-modal-title">Preparing Email Client</div>
                <div class="proposal-contact-modal-desc">
                    Connecting to mail client for <strong>${esc(customer.contact || customer.company || 'Customer')}</strong><br>
                    <span class="proposal-contact-email">${esc(email)}</span>
                </div>
                <div class="proposal-contact-progress-bar">
                    <div class="proposal-contact-progress-fill"></div>
                </div>
                <div class="proposal-contact-modal-actions">
                    <button type="button" class="proposal-contact-modal-cancel">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        let cancelled = false;
        modal.querySelector('.proposal-contact-modal-cancel')?.addEventListener('click', () => {
            cancelled = true;
            modal.remove();
        });

        window.setTimeout(() => {
            if (cancelled) return;
            const projectName = (state.projectInfo || {}).name || 'Brightronix Proposal';
            const subject = encodeURIComponent(`Proposal Quote - ${projectName}`);
            window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}`;
            window.setTimeout(() => {
                modal.remove();
            }, 800);
        }, 850);
    }

    function renderCoverPage(coverType, company, project, customer, quoteNum, docTitle, currentDate) {
        const isCompanyTheme = coverType === 'Company Cover';
        const clientName = customer.company || customer.contact || 'Valued Client';
        const customerLocation = [customer.address, [customer.city, customer.region, customer.postal].filter(Boolean).join(', '), customer.country].filter(Boolean).join('<br>');
        return `
            <div class="proposal-cover-page ${isCompanyTheme ? 'is-company-theme' : 'is-default-theme'}">
                <div class="proposal-cover-top-accent"></div>
                <div class="proposal-cover-header">
                    <div class="proposal-brand-logo-wrap">
                        <img src="../assets/logo-text.png" alt="Brightronix" class="proposal-brand-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div class="proposal-logo-badge" style="display:none;">
                            <span class="proposal-logo-b">B</span>
                            <span class="proposal-logo-text">Brightronix</span>
                        </div>
                    </div>
                    <div class="proposal-cover-tagline">Excellence in Commercial Construction &amp; Estimating</div>
                </div>

                <div class="proposal-cover-center">
                    <div class="proposal-cover-badge">COMMERCIAL PROPOSAL</div>
                    <div class="proposal-cover-title" contenteditable="true" data-proposal-meta="title" title="Click to edit proposal title" spellcheck="false">
                        ${esc(docTitle)}
                    </div>
                    <div class="proposal-cover-subtitle">
                        Project: <strong>${esc(project.name || 'Commercial Construction Project')}</strong>
                        ${project.project_number ? ` &bull; Ref #${esc(project.project_number)}` : ''}
                    </div>
                    <div class="proposal-cover-divider"></div>
                </div>

                <div class="proposal-cover-meta-grid">
                    <div class="proposal-cover-meta-card">
                        <div class="proposal-cover-meta-label"><i class="fas fa-building-user"></i> PREPARED FOR</div>
                        <div class="proposal-cover-meta-val">${esc(clientName)}</div>
                        ${customer.contact && customer.company ? `<div class="proposal-cover-meta-sub">Attn: ${esc(customer.contact)}</div>` : ''}
                        ${customerLocation ? `<div class="proposal-cover-meta-sub">${customerLocation}</div>` : ''}
                        ${customer.email ? `<div class="proposal-cover-meta-sub">${esc(customer.email)}</div>` : ''}
                    </div>

                    <div class="proposal-cover-meta-card">
                        <div class="proposal-cover-meta-label"><i class="fas fa-file-invoice"></i> PROPOSAL REFERENCE</div>
                        <div class="proposal-cover-meta-val">Quote #: <span contenteditable="true" data-proposal-meta="quoteNumber" title="Click to edit quote number">${esc(quoteNum)}</span></div>
                        <div class="proposal-cover-meta-sub">Date of Issue: ${esc(currentDate)}</div>
                        <div class="proposal-cover-meta-sub">Valid For: 30 Days</div>
                    </div>

                    <div class="proposal-cover-meta-card">
                        <div class="proposal-cover-meta-label"><i class="fas fa-shield-halved"></i> PREPARED BY</div>
                        <div class="proposal-cover-meta-val">Brightronix Technologies</div>
                        <div class="proposal-cover-meta-sub" contenteditable="true" data-company-field="address" title="Click to edit address">${esc(company.address)}</div>
                        <div class="proposal-cover-meta-sub"><span contenteditable="true" data-company-field="phone" title="Click to edit phone">${esc(company.phone)}</span> &bull; <span contenteditable="true" data-company-field="email" title="Click to edit email">${esc(company.email)}</span></div>
                        <div class="proposal-cover-meta-sub">Lead Estimator: <span contenteditable="true" data-company-field="preparedBy" title="Click to edit estimator">${esc(company.preparedBy)}</span></div>
                    </div>
                </div>

                <div class="proposal-cover-bottom">
                    <div class="proposal-cover-confidential">
                        <strong>CONFIDENTIALITY NOTICE:</strong> This proposal and any accompanying documents contain proprietary commercial information intended solely for the use of the client designated above. Unauthorized distribution, copying, or disclosure is strictly prohibited.
                    </div>
                </div>
            </div>
        `;
    }

    function renderAppendixPage(appendixType, quoteNum, docTitle, currentDate) {
        if (appendixType === 'Terms and Conditions') {
            return `
                <div class="proposal-appendix-sheet">
                    <div class="proposal-doc-page-header">
                        <div class="proposal-doc-page-header-left">
                            <span class="brand-name">Brightronix</span>
                            <span class="sep">&bull;</span>
                            <span class="doc-title">Terms &amp; Conditions</span>
                        </div>
                        <div class="proposal-doc-page-header-right">
                            <span>Quote #${esc(quoteNum)}</span>
                            <span class="sep">&bull;</span>
                            <span>${esc(currentDate)}</span>
                        </div>
                    </div>

                    <div class="proposal-appendix-content">
                        <div class="proposal-appendix-header">
                            <h4>General Terms &amp; Conditions of Contract</h4>
                            <p class="proposal-appendix-sub">The following commercial terms and provisions govern this proposal and become part of any subsequent agreement between Brightronix and the Client.</p>
                        </div>

                        <div class="proposal-terms-grid">
                            <div class="proposal-term-item">
                                <div class="proposal-term-num">01</div>
                                <div class="proposal-term-body">
                                    <h5>Validity of Proposal</h5>
                                    <p>Firm for thirty (30) calendar days from issuance date. Subsequent execution subject to material market recalculation.</p>
                                </div>
                            </div>

                            <div class="proposal-term-item">
                                <div class="proposal-term-num">02</div>
                                <div class="proposal-term-body">
                                    <h5>Invoicing &amp; Payment Schedule</h5>
                                    <p>Progress billing upon substantial milestones. Payment terms Net 30 days. Late accounts accrue 1.5% monthly service charge.</p>
                                </div>
                            </div>

                            <div class="proposal-term-item">
                                <div class="proposal-term-num">03</div>
                                <div class="proposal-term-body">
                                    <h5>Change Orders &amp; Deviations</h5>
                                    <p>Extra work or scope deviations executed exclusively upon mutual written Change Order signed prior to start.</p>
                                </div>
                            </div>

                            <div class="proposal-term-item">
                                <div class="proposal-term-num">04</div>
                                <div class="proposal-term-body">
                                    <h5>Warranty &amp; Craftsmanship</h5>
                                    <p>One (1) full year comprehensive craftsmanship warranty. Standard manufacturer warranties apply to all installed fixtures.</p>
                                </div>
                            </div>

                            <div class="proposal-term-item">
                                <div class="proposal-term-num">05</div>
                                <div class="proposal-term-body">
                                    <h5>Site Conditions &amp; Utility Access</h5>
                                    <p>Client to furnish unobstructed jobsite access, material staging areas, and continuous utility hookups (water, power).</p>
                                </div>
                            </div>

                            <div class="proposal-term-item">
                                <div class="proposal-term-num">06</div>
                                <div class="proposal-term-body">
                                    <h5>Force Majeure Contingencies</h5>
                                    <p>Contractor not liable for delays from extreme weather, acts of God, labor strikes, or unforeseen concealed site conditions.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // Scope Appendix (Default or Selected)
        return `
            <div class="proposal-appendix-sheet">
                <div class="proposal-doc-page-header">
                    <div class="proposal-doc-page-header-left">
                        <span class="brand-name">Brightronix</span>
                        <span class="sep">&bull;</span>
                        <span class="doc-title">Scope &amp; Technical Specifications</span>
                    </div>
                    <div class="proposal-doc-page-header-right">
                        <span>Quote #${esc(quoteNum)}</span>
                        <span class="sep">&bull;</span>
                        <span>${esc(currentDate)}</span>
                    </div>
                </div>

                <div class="proposal-appendix-content">
                    <div class="proposal-appendix-header">
                        <h4>Scope &amp; Technical Specifications Appendix</h4>
                        <p class="proposal-appendix-sub">Technical execution protocols, safety mandates, and quality assurance standards applicable to this project.</p>
                    </div>

                    <div class="proposal-terms-grid">
                        <div class="proposal-term-item">
                            <div class="proposal-term-num">A1</div>
                            <div class="proposal-term-body">
                                <h5>Material Standards &amp; Submittals</h5>
                                <p>All materials furnished shall be newly manufactured, commercial-grade, and compliant with relevant ASTM, ANSI, and local building code standards.</p>
                            </div>
                        </div>

                        <div class="proposal-term-item">
                            <div class="proposal-term-num">A2</div>
                            <div class="proposal-term-body">
                                <h5>Jobsite Safety &amp; OSHA Compliance</h5>
                                <p>Brightronix operates under strict adherence to OSHA safety regulations. Certified field personnel equipped with mandatory PPE and safety supervision.</p>
                            </div>
                        </div>

                        <div class="proposal-term-item">
                            <div class="proposal-term-num">A3</div>
                            <div class="proposal-term-body">
                                <h5>Site Protection &amp; Waste Disposal</h5>
                                <p>All adjacent surfaces and existing infrastructure are protected throughout execution. Daily debris disposal culminating in a broom-clean turnover.</p>
                            </div>
                        </div>

                        <div class="proposal-term-item">
                            <div class="proposal-term-num">A4</div>
                            <div class="proposal-term-body">
                                <h5>Permitting &amp; Inspection Coordination</h5>
                                <p>Contractor coordinates with municipal building officials and facilitates all required intermediate and final trade sign-offs.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function chunkFlatEntries(entries, maxPerPage = 22, overflowSlack = 3) {
        const pages = [];
        const total = entries.length;
        if (total === 0) {
            return pages;
        }

        let idx = 0;
        while (idx < total) {
            const remaining = total - idx;
            // If remaining entries only slightly exceed maxPerPage, fit them on this page
            // to maximize page usage and prevent near-empty orphan pages.
            if (remaining <= maxPerPage + overflowSlack) {
                pages.push({
                    entries: entries.slice(idx),
                    hasSummary: false
                });
                break;
            } else {
                const take = Math.min(maxPerPage, remaining);
                pages.push({
                    entries: entries.slice(idx, idx + take),
                    hasSummary: false
                });
                idx += take;
            }
        }
        return pages;
    }

    function renderSummary(totalData) {
        if (!proposalSettings.costItems.summary) return '';
        const items = [];

        if (proposalSettings.summary.laborMaterials) {
            items.push({
                icon: 'fa-boxes-stacked',
                badge: 'Direct Material',
                label: 'Direct Materials & Supplies',
                amount: totalData.material
            });
            items.push({
                icon: 'fa-person-digging',
                badge: 'Direct Labor',
                label: 'Direct Labor & Installation',
                amount: totalData.labor
            });
        }

        if (totalData.equipment) {
            items.push({
                icon: 'fa-truck-pickup',
                badge: 'Equipment',
                label: 'Equipment & Machinery',
                amount: totalData.equipment
            });
        }

        if (proposalSettings.summary.overhead) {
            if (Array.isArray(totalData.preTaxMarkups) && totalData.preTaxMarkups.length > 0) {
                totalData.preTaxMarkups.forEach(m => {
                    if (m && m.value !== 0) {
                        const rateStr = m.rate ? ` (${m.rate}%)` : '';
                        items.push({
                            icon: 'fa-building-shield',
                            badge: m.value < 0 ? 'Discount' : 'Markup',
                            label: `${m.name || 'Markup'}${rateStr}`,
                            amount: m.value
                        });
                    }
                });
            } else if (totalData.markup) {
                items.push({
                    icon: 'fa-building-shield',
                    badge: totalData.markup < 0 ? 'Discount' : 'Overhead',
                    label: totalData.markup < 0 ? 'Project Discount' : 'Overhead & Administration',
                    amount: totalData.markup
                });
            }
        }

        if (Array.isArray(totalData.postTaxMarkups) && totalData.postTaxMarkups.length > 0) {
            totalData.postTaxMarkups.forEach(m => {
                if (m && m.value !== 0) {
                    const rateStr = m.rate ? ` (${m.rate}%)` : '';
                    items.push({
                        icon: m.value < 0 ? 'fa-tags' : 'fa-file-invoice-dollar',
                        badge: m.value < 0 ? 'Discount' : 'Adjustment',
                        label: `${m.name || 'Adjustment'}${rateStr}`,
                        amount: m.value
                    });
                }
            });
        }

        if (proposalSettings.summary.taxes && totalData.taxes) {
            items.push({
                icon: 'fa-receipt',
                badge: 'Taxes',
                label: 'Statutory Taxes',
                amount: totalData.taxes
            });
        }

        if (proposalSettings.summary.profit && totalData.profit) {
            items.push({
                icon: 'fa-chart-line-up',
                badge: 'Margin',
                label: 'Profit Margin & Contingency',
                amount: totalData.profit
            });
        }

        const sqft = num((state.projectMeta || {}).square_footage);
        let unitRateHtml = '';
        if (proposalSettings.summary.priceSqft && sqft > 0) {
            const ratePerSqft = totalData.total / sqft;
            unitRateHtml = `
                <div class="proposal-fin-unit-rate">
                    <span class="rate-label"><i class="fas fa-ruler-combined"></i> Unit Rate:</span>
                    <span class="rate-val">${money(ratePerSqft)} / sq ft</span>
                    <span class="rate-sub">(${sqft.toLocaleString()} sq ft)</span>
                </div>
            `;
        }

        if (!items.length) return '';

        // Rule: Separate additions from subtractions/discounts so deductions are placed at the end of the list
        const additions = [];
        const deductions = [];

        items.forEach(item => {
            const isNegative = item.amount < 0 || /\b(discount|deduction|rebate|credit|minus|subtraction)\b/i.test(item.label + ' ' + item.badge);
            if (isNegative) {
                deductions.push(item);
            } else {
                additions.push(item);
            }
        });

        const sortedItems = [...additions, ...deductions];

        return `
            <section class="proposal-doc-section proposal-financial-summary-section">
                <div class="proposal-fin-head">
                    <div>
                        <h4>Financial Summary &amp; Investment Breakdown</h4>
                    </div>
                    ${unitRateHtml}
                </div>

                <div class="proposal-fin-list-shell">
                    <div class="proposal-fin-list-header">
                        <span class="col-cost-cat">Cost Category</span>
                        <span class="col-cost-type">Classification</span>
                        <span class="col-cost-amount">Amount</span>
                    </div>
                    <div class="proposal-fin-list-body">
                        ${sortedItems.map(row => `
                            <div class="proposal-fin-list-row ${row.amount < 0 ? 'is-deduction-row' : ''}">
                                <div class="proposal-fin-row-main">
                                    <div class="proposal-fin-icon-bubble ${row.amount < 0 ? 'is-negative' : ''}"><i class="fas ${row.icon}"></i></div>
                                    <div class="proposal-fin-row-texts">
                                        <div class="proposal-fin-row-label">${esc(row.label)}</div>
                                    </div>
                                </div>
                                <div class="proposal-fin-row-badge">
                                    <span class="fin-badge-pill ${row.amount < 0 ? 'is-negative' : ''}">${esc(row.badge)}</span>
                                </div>
                                <div class="proposal-fin-row-val ${row.amount < 0 ? 'is-negative' : ''}">
                                    ${row.amount < 0 ? `-${money(Math.abs(row.amount))}` : money(row.amount)}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </section>
        `;
    }

    function renderAcceptance(company, currentDate, customer) {
        const showAcceptedBy = Boolean(proposalSettings.summary.acceptedBy);
        const showDate = Boolean(proposalSettings.summary.date);
        if (!showAcceptedBy && !showDate) return '';

        const clientCompany = (customer && (customer.company || customer.contact)) || 'Client / Owner';
        const clientContact = (customer && customer.contact) || '';
        const estimatorName = (company && company.preparedBy) || 'Brightronix Estimator';

        return `
            <div class="proposal-acceptance-wrap proposal-acceptance-compact">
                <div class="proposal-acceptance-compact-head">
                    <span class="compact-head-title"><i class="fas fa-file-signature"></i> Proposal Authorization &amp; Formal Acceptance</span>
                    <span class="compact-head-sub">By signing below, authorized parties approve the project scope, specifications, schedule, and total investment defined herein.</span>
                </div>

                <div class="proposal-signatures-grid proposal-signatures-compact-grid">
                    <!-- Client Acceptance Column -->
                    <div class="proposal-sign-column proposal-sign-compact-col">
                        <div class="proposal-sign-compact-label">
                            <span class="sign-party-tag">CLIENT ACCEPTANCE</span>
                            <span class="sign-party-name">${esc(clientCompany)}</span>
                        </div>
                        ${showAcceptedBy ? `
                            <div class="proposal-sign-draw-zone">
                                <div class="proposal-sign-draw-line"></div>
                                <span class="proposal-sign-line-text">Authorized Client Signature</span>
                            </div>
                        ` : ''}
                        <div class="proposal-sign-meta-compact-row">
                            ${showAcceptedBy ? `
                                <div class="proposal-sign-meta-cell">
                                    <span class="meta-cell-label">Printed Name</span>
                                    <span class="meta-cell-value">${clientContact ? esc(clientContact) : '_____________________'}</span>
                                </div>
                            ` : ''}
                            ${showDate ? `
                                <div class="proposal-sign-meta-cell">
                                    <span class="meta-cell-label">Date of Acceptance</span>
                                    <span class="meta-cell-value">____ / ____ / 202___</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Contractor Authorization Column -->
                    <div class="proposal-sign-column proposal-sign-compact-col">
                        <div class="proposal-sign-compact-label">
                            <span class="sign-party-tag">CONTRACTOR AUTHORIZATION</span>
                            <span class="sign-party-name">Brightronix Technologies</span>
                        </div>
                        ${showAcceptedBy ? `
                            <div class="proposal-sign-draw-zone">
                                <div class="proposal-sign-draw-line"></div>
                                <span class="proposal-sign-line-text">Authorized Representative Signature</span>
                            </div>
                        ` : ''}
                        <div class="proposal-sign-meta-compact-row">
                            ${showAcceptedBy ? `
                                <div class="proposal-sign-meta-cell">
                                    <span class="meta-cell-label">Prepared By</span>
                                    <span class="meta-cell-value">${esc(estimatorName)}</span>
                                </div>
                            ` : ''}
                            ${showDate ? `
                                <div class="proposal-sign-meta-cell">
                                    <span class="meta-cell-label">Date of Issuance</span>
                                    <span class="meta-cell-value">${esc(currentDate)}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function buildHeaderHtml(company, quoteNum, currentDate, project) {
        return `
            <div class="proposal-doc-header">
                <div class="proposal-header-left">
                    <div class="proposal-brand-logo-wrap">
                        <img src="../assets/logo-text.png" alt="Brightronix" class="proposal-brand-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div class="proposal-logo-badge" style="display:none;">
                            <span class="proposal-logo-b">B</span>
                            <span class="proposal-logo-text">Brightronix</span>
                        </div>
                    </div>
                    <div class="proposal-company-details">
                        <div class="proposal-company-line" contenteditable="true" data-company-field="address" title="Click to edit address" spellcheck="false">${esc(company.address)}</div>
                        <div class="proposal-company-line" contenteditable="true" data-company-field="phone" title="Click to edit phone" spellcheck="false">${esc(company.phone)}</div>
                        <div class="proposal-company-line">Prepared by: <span class="proposal-company-inline-field" contenteditable="true" data-company-field="preparedBy" title="Click to edit estimator" spellcheck="false">${esc(company.preparedBy)}</span></div>
                        <div class="proposal-company-line" contenteditable="true" data-company-field="email" title="Click to edit email" spellcheck="false">${esc(company.email)}</div>
                    </div>
                </div>
                <div class="proposal-quote-meta">
                    <div><strong>Quote #:</strong> <span class="proposal-meta-field" contenteditable="true" data-proposal-meta="quoteNumber" title="Click to edit quote number" spellcheck="false">${esc(quoteNum)}</span></div>
                    <div><strong>Date:</strong> <span>${esc(currentDate)}</span></div>
                    ${project.project_number ? `<div><strong>Project #:</strong> <span>${esc(project.project_number)}</span></div>` : ''}
                </div>
            </div>
        `;
    }

    function renderPreview() {
        try {
            const project = state.projectInfo || {};
        const meta = state.projectMeta || {};
        const customer = getCustomer();
        const company = getCompany();
        const customMeta = getCustomMeta();
        const notes = readEstimatingNotes();
        const items = realItems();
        const totalData = totals(items);
        const draft = state.proposalDraft || {};
        const scope = notes.scope || cleanHtml(project.description || '') || 'Furnish all required equipment, material, and labor in strict accordance with specifications and contract drawings.';
        const overviewNotes = Array.isArray(meta.notes) ? meta.notes.map((note) => String(note.text || note.title || note || '').trim()).filter(Boolean).join('<br>') : '';
        const customerLocation = [customer.address, [customer.city, customer.region, customer.postal].filter(Boolean).join(', '), customer.country].filter(Boolean).join('<br>');
        const isQtyOnly = Boolean(proposalSettings.quantityOnly);
        builderNote.hidden = !proposalSettings.proposalBuilder;

        // Toggle builder mode styling on proposal document container
        documentNode.classList.toggle('is-builder-mode', Boolean(proposalSettings.proposalBuilder));

        const quoteNum = firstValue([customMeta.quoteNumber, draft.proposal_number, draft.quote_number, `PROP-${(project.id || projectId || '001')}`]);
        const docTitle = firstValue([customMeta.title, draft.estimate_name, project.name, 'Commercial Proposal']);
        const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

        const isFull = proposalSettings.pageWidth === 'full';
        const widthClass = isFull ? 'is-full-width' : '';

        const toolbarHtml = `
            <div class="proposal-view-toolbar">
                <div class="proposal-view-group">
                    <span class="proposal-view-label"><i class="fas fa-layer-group"></i> Layout:</span>
                    <div class="proposal-view-buttons">
                        <button type="button" class="proposal-view-btn ${proposalSettings.pageMode !== 'paged' ? 'active' : ''}" data-proposal-set-view="continuous" title="Single continuous page that extends to fit all content">
                            <i class="fas fa-arrows-up-down"></i> Extended Page
                        </button>
                        <button type="button" class="proposal-view-btn ${proposalSettings.pageMode === 'paged' ? 'active' : ''}" data-proposal-set-view="paged" title="Split into 8.5 x 11 in printable pages">
                            <i class="fas fa-copy"></i> Multi-Page Sheets
                        </button>
                    </div>
                </div>
                <div class="proposal-view-group">
                    <span class="proposal-view-label"><i class="fas fa-arrows-left-right"></i> Width:</span>
                    <div class="proposal-view-buttons">
                        <button type="button" class="proposal-view-btn ${!isFull ? 'active' : ''}" data-proposal-set-width="letter" title="Standard 8.5 inch Letter sheet">
                            <i class="fas fa-file"></i> 8.5" Letter
                        </button>
                        <button type="button" class="proposal-view-btn ${isFull ? 'active' : ''}" data-proposal-set-width="full" title="Fit to full screen width">
                            <i class="fas fa-expand"></i> Full Width
                        </button>
                    </div>
                </div>
            </div>
        `;

        const headerHtml = buildHeaderHtml(company, quoteNum, currentDate, project);

        const titleHtml = `
            <div class="proposal-doc-title-row">
                <div class="proposal-doc-title" contenteditable="true" data-proposal-meta="title" title="Click to edit proposal title" spellcheck="false">
                    ${esc(docTitle)}
                </div>
            </div>
        `;

        const customerDetails = [];
        if (customer.contact && customer.company) customerDetails.push(`<span><i class="fas fa-user"></i> Attn: ${esc(customer.contact)}</span>`);
        if (customer.phone) customerDetails.push(`<span><i class="fas fa-phone"></i> ${esc(customer.phone)}</span>`);
        if (customer.email) customerDetails.push(`<span><i class="fas fa-envelope"></i> ${esc(customer.email)}</span>`);

        const customerHtml = `
            <div class="proposal-customer-block">
                <div class="proposal-customer-prep-label">Prepared For:</div>
                <div class="proposal-customer-name">${esc(customer.company || customer.contact || 'No customer assigned')}</div>
                ${customerLocation ? `<div class="proposal-customer-address">${customerLocation}</div>` : ''}
                ${customerDetails.length ? `<div class="proposal-customer-contacts">${customerDetails.join('')}</div>` : ''}
            </div>
        `;

        const scopeHtml = `
            <section class="proposal-doc-section">
                <h4>Scope of Work</h4>
                <p contenteditable="true" data-proposal-meta="scope" title="Click to edit scope of work" spellcheck="false">${scope}</p>
            </section>
        `;

        const notesHtml = [
            notes.included && notes.included.length ? `
                <section class="proposal-doc-section">
                    <h4>Included Items</h4>
                    <ol class="proposal-bullets">${notes.included.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>
                </section>` : '',
            notes.excluded && notes.excluded.length ? `
                <section class="proposal-doc-section">
                    <h4>Excluded Items</h4>
                    <ol class="proposal-bullets">${notes.excluded.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>
                </section>` : '',
            notes.projectNotes || overviewNotes ? `
                <section class="proposal-doc-section">
                    <h4>Special Terms &amp; Notes</h4>
                    <p contenteditable="true" data-proposal-meta="projectNotes" title="Click to edit special notes" spellcheck="false">${notes.projectNotes || cleanHtml(overviewNotes)}</p>
                </section>` : ''
        ].filter(Boolean).join('');

        const costItemsHtml = `
            <section class="proposal-doc-section">
                <h4>Cost Items &amp; Specifications</h4>
                ${renderItemTable(groupedItems(items), items)}
            </section>
        `;

        const summaryHtml = isQtyOnly ? '' : renderSummary(totalData);

        // Improved Hero Total Proposal Box (Protagonist)
        const totalBoxHtml = (!isQtyOnly && proposalSettings.costItems.estimateTotal) ? `
            <div class="proposal-hero-total-box">
                <div class="proposal-hero-total-accent-bar"></div>
                <div class="proposal-hero-total-inner">
                    <div class="proposal-hero-total-left">
                        <div class="proposal-hero-tag">
                            <span class="proposal-hero-tag-icon"><i class="fas fa-shield-check"></i></span>
                            <span>TOTAL PROPOSAL INVESTMENT</span>
                        </div>
                        <div class="proposal-hero-title">Guaranteed Lump Sum Amount</div>
                        <div class="proposal-hero-sub">
                            Turnkey fixed investment inclusive of direct materials, trade labor, specialty equipment, administrative markups, and applicable taxes.
                        </div>
                        <div class="proposal-hero-badges">
                            <span class="hero-micro-badge"><i class="fas fa-check-circle"></i> Fixed Price</span>
                            <span class="hero-micro-badge"><i class="fas fa-clock"></i> 30-Day Guarantee</span>
                            <span class="hero-micro-badge"><i class="fas fa-file-shield"></i> Turnkey Scope</span>
                        </div>
                    </div>
                    <div class="proposal-hero-total-right">
                        <div class="proposal-hero-val-label">TOTAL PROPOSAL AMOUNT</div>
                        <div class="proposal-hero-amount-val">${money(totalData.total)}</div>
                        <div class="proposal-hero-val-sub">USD &bull; Net Total Investment</div>
                    </div>
                </div>
            </div>
        ` : '';

        // Compact Shortened Acceptance Block (Placed on the next page with Scope Appendix)
        const acceptanceHtml = renderAcceptance(company, currentDate, customer);

        const hasCover = proposalSettings.coverPage && proposalSettings.coverPage !== 'None';
        const appendixType = proposalSettings.appendixPage || 'Scope Appendix';
        const hasFinalAcceptanceSheet = (!isQtyOnly && (proposalSettings.summary.acceptedBy || proposalSettings.summary.date || proposalSettings.appendixPage !== 'None'));

        if (proposalSettings.pageMode === 'paged') {
            const allGroupEntries = groupedItems(items);
            const flatEntries = [];

            if (proposalSettings.lumpSum && !proposalSettings.quantityOnly) {
                flatEntries.push({ type: 'group', group: { name: 'Lump Sum Proposal', total: totals(items).total, children: [] } });
            } else {
                allGroupEntries.forEach((group) => {
                    flatEntries.push({ type: 'group', group: group, name: group.name, total: group.total });
                    if (!proposalSettings.groupsOnly) {
                        group.children.forEach((child) => {
                            flatEntries.push({ type: 'item', item: child, group: group });
                        });
                    }
                });
            }

            // Chunk cost item entries (14 items per page)
            const itemChunks = chunkFlatEntries(flatEntries, 22, 3);

            // Compute total page count
            const hasSummarySheet = (!isQtyOnly && (proposalSettings.costItems.summary || proposalSettings.costItems.estimateTotal));

            let totalPages = 1; // Overview page is always 1
            if (hasCover) totalPages += 1;
            totalPages += itemChunks.length;
            if (hasSummarySheet) totalPages += 1;
            if (hasFinalAcceptanceSheet) totalPages += 1;

            let runningPageNum = 1;
            let sheetsHtml = '';

            // 1. Optional Cover Sheet
            if (hasCover) {
                sheetsHtml += `
                    <div class="proposal-page-sheet ${widthClass} proposal-cover-sheet">
                        <div class="proposal-sheet-content">
                            ${renderCoverPage(proposalSettings.coverPage, company, project, customer, quoteNum, docTitle, currentDate)}
                        </div>
                        <div class="proposal-sheet-footer">
                            <span>Brightronix Commercial Proposal &bull; Quote #${esc(quoteNum)}</span>
                            <span>Page ${runningPageNum} of ${totalPages}</span>
                        </div>
                    </div>
                `;
                runningPageNum++;
            }

            // 2. Project Overview & Scope Sheet
            sheetsHtml += `
                <div class="proposal-page-sheet ${widthClass}">
                    <div class="proposal-sheet-content">
                        ${headerHtml}
                        ${titleHtml}
                        ${customerHtml}
                        ${scopeHtml}
                        ${notesHtml}
                    </div>
                    <div class="proposal-sheet-footer">
                        <span>Brightronix Proposal &bull; Quote #${esc(quoteNum)}</span>
                        <span>Page ${runningPageNum} of ${totalPages}</span>
                    </div>
                </div>
            `;
            runningPageNum++;

            // 3. Itemized Cost Sheets
            itemChunks.forEach((chunk) => {
                const pageRunningHeader = `
                    <div class="proposal-doc-page-header">
                        <div class="proposal-doc-page-header-left">
                            <span class="brand-name">Brightronix</span>
                            <span class="sep">&bull;</span>
                            <span class="doc-title">${esc(docTitle)}</span>
                        </div>
                        <div class="proposal-doc-page-header-right">
                            <span>Quote #${esc(quoteNum)}</span>
                            <span class="sep">&bull;</span>
                            <span>${esc(currentDate)}</span>
                        </div>
                    </div>
                `;
                sheetsHtml += `
                    <div class="proposal-page-sheet ${widthClass}">
                        <div class="proposal-sheet-content">
                            ${pageRunningHeader}
                            <section class="proposal-doc-section">
                                <h4>Cost Items &amp; Specifications</h4>
                                ${renderItemTableSlice(chunk.entries, items)}
                            </section>
                        </div>
                        <div class="proposal-sheet-footer">
                            <span>Brightronix Proposal &bull; Quote #${esc(quoteNum)}</span>
                            <span>Page ${runningPageNum} of ${totalPages}</span>
                        </div>
                    </div>
                `;
                runningPageNum++;
            });

            // 4. Dedicated Executive Financial Summary Sheet (Summary List + Hero Total Box only, ample room)
            if (hasSummarySheet) {
                const summaryRunningHeader = `
                    <div class="proposal-doc-page-header">
                        <div class="proposal-doc-page-header-left">
                            <span class="brand-name">Brightronix</span>
                            <span class="sep">&bull;</span>
                            <span class="doc-title">${esc(docTitle)}</span>
                        </div>
                        <div class="proposal-doc-page-header-right">
                            <span>Quote #${esc(quoteNum)}</span>
                            <span class="sep">&bull;</span>
                            <span>${esc(currentDate)}</span>
                        </div>
                    </div>
                `;
                sheetsHtml += `
                    <div class="proposal-page-sheet ${widthClass} proposal-summary-dedication-sheet">
                        <div class="proposal-sheet-content">
                            ${summaryRunningHeader}
                            ${summaryHtml}
                            ${totalBoxHtml}
                        </div>
                        <div class="proposal-sheet-footer">
                            <span>Brightronix Proposal &bull; Quote #${esc(quoteNum)}</span>
                            <span>Page ${runningPageNum} of ${totalPages}</span>
                        </div>
                    </div>
                `;
                runningPageNum++;
            }

            // 5. Next Page: Scope Appendix & Formal Acceptance Sheet (together at the end of the next page)
            if (hasFinalAcceptanceSheet) {
                const appendixContent = renderAppendixPage(appendixType, quoteNum, docTitle, currentDate);
                sheetsHtml += `
                    <div class="proposal-page-sheet ${widthClass} proposal-appendix-sheet-wrap">
                        <div class="proposal-sheet-content">
                            ${appendixContent}
                            ${acceptanceHtml}
                        </div>
                        <div class="proposal-sheet-footer">
                            <span>Brightronix Proposal &bull; Quote #${esc(quoteNum)}</span>
                            <span>Page ${runningPageNum} of ${totalPages}</span>
                        </div>
                    </div>
                `;
                runningPageNum++;
            }

            documentNode.innerHTML = `${toolbarHtml}<div class="proposal-paged-wrap">${sheetsHtml}</div>`;
        } else {
            // Continuous Extended Single Page Mode
            const continuousCover = hasCover ? `
                <div class="proposal-continuous-cover-section">
                    ${renderCoverPage(proposalSettings.coverPage, company, project, customer, quoteNum, docTitle, currentDate)}
                </div>
                <div class="proposal-continuous-page-divider"></div>
            ` : '';

            const continuousAppendix = hasFinalAcceptanceSheet ? `
                <div class="proposal-continuous-page-divider"></div>
                <div class="proposal-continuous-appendix-section">
                    ${renderAppendixPage(appendixType, quoteNum, docTitle, currentDate)}
                    ${acceptanceHtml}
                </div>
            ` : '';

            documentNode.innerHTML = `
                ${toolbarHtml}
                <div class="proposal-document-body ${widthClass}">
                    ${continuousCover}
                    ${headerHtml}
                    ${titleHtml}
                    ${customerHtml}
                    ${scopeHtml}
                    ${notesHtml}
                    ${costItemsHtml}
                    ${summaryHtml}
                    ${totalBoxHtml}
                    ${continuousAppendix}
                </div>
            `;
        }
        } catch (error) {
            console.error('Error rendering proposal preview:', error);
            if (documentNode) {
                documentNode.innerHTML = `
                    <div class="proposal-error-banner" style="padding: 24px; margin: 24px auto; max-width: 600px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; color: #9f1239; font-family: sans-serif;">
                        <h4 style="margin: 0 0 8px 0; font-size: 15px;"><i class="fas fa-triangle-exclamation"></i> Error displaying proposal preview</h4>
                        <p style="margin: 0; font-size: 13px;">There was a problem organizing the proposal items (${esc(error.message)}). Please try switching grouping mode or refreshing.</p>
                    </div>
                `;
            }
        }
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
        node.innerHTML = `<i class="fas fa-circle-check" style="color:#22c55e;"></i> <span>${esc(message)}</span>`;
        document.body.appendChild(node);
        window.setTimeout(() => node.remove(), 3200);
    }

    // Two-way sync: listen to document contenteditable changes
    documentNode.addEventListener('input', (event) => {
        const compField = event.target.closest('[data-company-field]');
        if (compField) {
            const field = compField.dataset.companyField;
            proposalSettings.company = proposalSettings.company || {};
            proposalSettings.company[field] = compField.textContent.trim();
            saveSettings();
            const sidebarInput = settingsPanel.querySelector(`[data-proposal-company-input="${field}"]`);
            if (sidebarInput && sidebarInput.value !== compField.textContent.trim()) {
                sidebarInput.value = compField.textContent.trim();
            }
            return;
        }
        const metaField = event.target.closest('[data-proposal-meta]');
        if (metaField) {
            const field = metaField.dataset.proposalMeta;
            proposalSettings.metaOverrides = proposalSettings.metaOverrides || {};
            proposalSettings.metaOverrides[field] = metaField.textContent.trim();
            saveSettings();
        }
    });

    // Single-line inputs in document blur on Enter
    documentNode.addEventListener('keydown', (event) => {
        const editable = event.target.closest('[contenteditable="true"]');
        if (editable && !editable.classList.contains('proposal-multiline') && event.key === 'Enter') {
            event.preventDefault();
            editable.blur();
        }
    });

    // Toolbar click for view mode and width
    documentNode.addEventListener('click', (event) => {
        const viewBtn = event.target.closest('[data-proposal-set-view]');
        if (viewBtn) {
            proposalSettings.pageMode = viewBtn.dataset.proposalSetView;
            saveSettings();
            renderAll();
            return;
        }
        const widthBtn = event.target.closest('[data-proposal-set-width]');
        if (widthBtn) {
            proposalSettings.pageWidth = widthBtn.dataset.proposalSetWidth;
            saveSettings();
            renderAll();
            return;
        }
    });

    // Two-way sync: listen to sidebar company inputs
    settingsPanel.addEventListener('input', (event) => {
        const compInput = event.target.closest('[data-proposal-company-input]');
        if (compInput) {
            const field = compInput.dataset.proposalCompanyInput;
            proposalSettings.company = proposalSettings.company || {};
            proposalSettings.company[field] = compInput.value;
            saveSettings();
            const docField = documentNode.querySelector(`[data-company-field="${field}"]`);
            if (docField && docField.textContent !== compInput.value) {
                docField.textContent = compInput.value;
            }
        }
    });

    settingsPanel.addEventListener('change', (event) => {
        const checkbox = event.target.closest('[data-proposal-setting]');
        const select = event.target.closest('[data-proposal-select]');
        if (checkbox) {
            const path = checkbox.dataset.proposalSetting;
            const val = checkbox.checked;
            setPath(proposalSettings, path, val);
            // Synchronize duplicated groupSubtotals toggles
            if (path === 'material.groupSubtotals') {
                proposalSettings.costItems.groupSubtotals = val;
            } else if (path === 'costItems.groupSubtotals') {
                proposalSettings.material.groupSubtotals = val;
            }
        }
        if (select) {
            setPath(proposalSettings, select.dataset.proposalSelect, select.value);
        }
        if (checkbox || select) {
            saveSettings();
            // Checkbox changes re-render settings to dynamically refresh dependency badges/disabled states
            if (checkbox) {
                renderSettings();
            }
            // Always update preview
            renderPreview();
        }
    });

    settingsPanel.addEventListener('click', (event) => {
        if (event.target.closest('[data-proposal-reset-company]')) {
            proposalSettings.company = { ...defaults.company };
            proposalSettings.metaOverrides = { ...defaults.metaOverrides };
            saveSettings();
            renderAll();
            showToast('Company details reset to project defaults.');
            return;
        }
        if (event.target.closest('[data-proposal-open-overview]')) {
            openCustomerEditInOverview();
            return;
        }
        if (event.target.closest('[data-proposal-contact]')) {
            showContactWaitModal(getCustomer());
            return;
        }
    });

    async function exportProposalPdf() {
        const project = state.projectInfo || {};
        const customMeta = getCustomMeta();
        const draft = state.proposalDraft || {};
        const quoteNum = firstValue([customMeta.quoteNumber, draft.proposal_number, draft.quote_number, `PROP-${(project.id || projectId || '001')}`]);
        const docTitle = firstValue([customMeta.title, draft.estimate_name, project.name, 'Commercial Proposal']);
        const cleanFileName = `Proposal_${quoteNum}_${docTitle}`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

        const html2canvas = window.html2canvas;
        const jsPDF = window.jsPDF || (window.jspdf && window.jspdf.jsPDF);

        if (typeof html2canvas !== 'function' || typeof jsPDF !== 'function') {
            console.warn('html2canvas or jsPDF not available, falling back to system print...');
            showToast('Opening print dialog for PDF saving...');
            triggerProposalPrint();
            return;
        }

        // 1. Ensure we are in paged mode so each sheet exists in the DOM
        const wasContinuous = proposalSettings.pageMode !== 'paged';
        if (wasContinuous) {
            proposalSettings.pageMode = 'paged';
            renderPreview();
        }

        const sheets = Array.from(documentNode.querySelectorAll('.proposal-page-sheet'));
        if (!sheets.length) {
            showToast('No proposal content to export.');
            if (wasContinuous) {
                proposalSettings.pageMode = 'continuous';
                renderPreview();
            }
            return;
        }

        // 2. Show detailed progress modal with live percentage
        document.querySelectorAll('#proposalDownloadModal').forEach(el => el.remove());
        const modal = document.createElement('div');
        modal.id = 'proposalDownloadModal';
        modal.className = 'proposal-contact-modal-backdrop';
        modal.innerHTML = `
            <div class="proposal-contact-modal-card">
                <div class="proposal-contact-modal-spinner">
                    <i class="fas fa-circle-notch fa-spin"></i>
                </div>
                <div class="proposal-contact-modal-title" id="propModalTitle">Generating High-Resolution PDF</div>
                <div class="proposal-contact-modal-desc" id="propModalDesc">
                    Rendering sheets for <strong>${esc(cleanFileName)}.pdf</strong>...
                </div>
                <div class="proposal-contact-progress-bar">
                    <div class="proposal-contact-progress-fill" id="propModalProgress" style="width: 5%;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const progressFill = modal.querySelector('#propModalProgress');
        const modalDesc = modal.querySelector('#propModalDesc');

        let sandbox = null;
        try {
            // Wait for web fonts (Outfit, FontAwesome) to be fully ready
            if (document.fonts && document.fonts.ready) {
                await document.fonts.ready;
            }

            // Create dedicated off-screen sandbox container with exact letter width
            sandbox = document.createElement('div');
            sandbox.className = 'proposal-pdf-export-sandbox';
            sandbox.style.cssText = `
                position: fixed !important;
                left: -9999px !important;
                top: 0 !important;
                width: 816px !important;
                background: #ffffff !important;
                z-index: -9999 !important;
                pointer-events: none !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                box-sizing: border-box !important;
            `;
            document.body.appendChild(sandbox);

            // Initialize jsPDF document (US Letter: 8.5in x 11in)
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'in',
                format: 'letter',
                compress: true
            });

            for (let i = 0; i < sheets.length; i++) {
                const sheet = sheets[i];
                const pct = Math.round(((i + 1) / (sheets.length + 1)) * 100);
                if (progressFill) progressFill.style.width = `${pct}%`;
                if (modalDesc) {
                    modalDesc.innerHTML = `Rendering sheet ${i + 1} of ${sheets.length} (exact 8.5" &times; 11" Letter)...`;
                }

                // Clone sheet and apply exact print layout
                const clone = sheet.cloneNode(true);
                clone.querySelectorAll('.proposal-view-toolbar, .proposal-customer-btn, button').forEach(el => el.remove());

                // Set exact print dimensions and reset screen margins/shadows/borders
                clone.style.boxSizing = 'border-box';
                clone.style.width = '816px';
                clone.style.minWidth = '816px';
                clone.style.maxWidth = '816px';
                clone.style.height = '1056px';
                clone.style.minHeight = '1056px';
                clone.style.maxHeight = '1056px';
                clone.style.margin = '0';
                clone.style.padding = '0.55in 0.65in 0.45in 0.65in';
                clone.style.borderRadius = '0';
                clone.style.boxShadow = 'none';
                clone.style.border = 'none';
                clone.style.background = '#ffffff';
                clone.style.color = '#0f172a';
                clone.style.display = 'flex';
                clone.style.flexDirection = 'column';
                clone.style.justifyContent = 'space-between';
                clone.style.overflow = 'hidden';

                sandbox.innerHTML = '';
                sandbox.appendChild(clone);

                // Small micro-delay to let DOM layout and styles settle
                await new Promise(r => setTimeout(r, 40));

                const canvas = await html2canvas(clone, {
                    scale: 2.5, // 240 DPI (ultra-crisp text, tables, and borders matching print)
                    useCORS: true,
                    logging: false,
                    backgroundColor: '#ffffff',
                    width: 816,
                    height: 1056,
                    windowWidth: 816,
                    windowHeight: 1056,
                    x: 0,
                    y: 0,
                    scrollX: 0,
                    scrollY: 0
                });

                const imgData = canvas.toDataURL('image/jpeg', 0.98);

                if (i > 0) {
                    pdf.addPage('letter', 'portrait');
                }
                pdf.addImage(imgData, 'JPEG', 0, 0, 8.5, 11, undefined, 'FAST');
            }

            if (progressFill) progressFill.style.width = '100%';
            if (modalDesc) modalDesc.innerHTML = 'Packaging and saving PDF file...';

            await new Promise(r => setTimeout(r, 120));

            pdf.save(`${cleanFileName}.pdf`);
            modal.remove();
            showToast(`PDF downloaded: ${cleanFileName}.pdf`);
        } catch (err) {
            console.error('Direct PDF export error:', err);
            modal.remove();
            showToast('Direct PDF failed, opening system print...');
            triggerProposalPrint();
        } finally {
            if (sandbox && sandbox.parentNode) {
                sandbox.parentNode.removeChild(sandbox);
            }
            if (wasContinuous) {
                proposalSettings.pageMode = 'continuous';
                renderPreview();
            }
        }
    }

    function exportProposalDocx() {
        const project = state.projectInfo || {};
        const customMeta = getCustomMeta();
        const draft = state.proposalDraft || {};
        const quoteNum = firstValue([customMeta.quoteNumber, draft.proposal_number, draft.quote_number, `PROP-${(project.id || projectId || '001')}`]);
        const docTitle = firstValue([customMeta.title, draft.estimate_name, project.name, 'Commercial Proposal']);
        const cleanFileName = `Proposal_${quoteNum}_${docTitle}`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

        const sheets = documentNode.querySelectorAll('.proposal-page-sheet, .proposal-document-body');
        if (!sheets.length) {
            showToast('No proposal content to export.');
            return;
        }

        let bodyHtml = '';
        sheets.forEach((sheet) => {
            const clone = sheet.cloneNode(true);
            clone.querySelectorAll('.proposal-view-toolbar, .proposal-sheet-footer').forEach(el => el.remove());
            bodyHtml += `<div class="word-sheet" style="page-break-after: always; padding: 20pt 0;">${clone.innerHTML}</div>`;
        });

        const docContent = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
    <meta charset="utf-8">
    <title>${esc(docTitle)}</title>
    <!--[if gte mso 9]>
    <xml>
        <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
    </xml>
    <![endif]-->
    <style>
        @page {
            size: 8.5in 11.0in;
            margin: 0.6in 0.6in 0.6in 0.6in;
            mso-header-margin: 0.3in;
            mso-footer-margin: 0.3in;
        }
        body {
            font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
            font-size: 11pt;
            color: #0f172a;
            line-height: 1.4;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 10pt 0;
        }
        th {
            background-color: #f1f5f9;
            color: #475569;
            font-size: 9.5pt;
            font-weight: bold;
            padding: 6pt 8pt;
            border-bottom: 1.5pt solid #cbd5e1;
            text-align: left;
        }
        td {
            padding: 6pt 8pt;
            border-bottom: 0.5pt solid #e2e8f0;
            font-size: 10pt;
        }
        .amount { text-align: right; font-weight: bold; }
        .proposal-hero-total-box, .proposal-total-box {
            border: 2pt solid #0f172a;
            padding: 14pt 18pt;
            margin: 16pt 0;
            background: #ffffff;
        }
        .proposal-hero-amount-val { font-size: 22pt; font-weight: bold; color: #0f172a; }
        h4 { font-size: 12pt; text-transform: uppercase; color: #0f172a; margin-top: 14pt; }
        .proposal-acceptance-wrap { margin-top: 20pt; border-top: 1.5pt solid #0f172a; padding-top: 10pt; }
        .proposal-signatures-grid { width: 100%; }
        .proposal-sign-column { border: 1pt solid #cbd5e1; padding: 10pt; }
    </style>
</head>
<body>
    ${bodyHtml}
</body>
</html>`;

        const blob = new Blob(['\ufeff', docContent], { type: 'application/vnd.ms-word;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${cleanFileName}.doc`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        showToast(`Word document downloaded: ${cleanFileName}.doc`);
    }

    function triggerProposalPrint() {
        const prevTitle = document.title;
        const project = state.projectInfo || {};
        const draft = state.proposalDraft || {};
        const customMeta = getCustomMeta();
        const quoteNum = firstValue([customMeta.quoteNumber, draft.proposal_number, draft.quote_number, `PROP-${(project.id || projectId || '001')}`]);
        const docTitle = firstValue([customMeta.title, draft.estimate_name, project.name, 'Commercial Proposal']);

        const cleanFileName = `Proposal_${quoteNum}_${docTitle}`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        document.title = cleanFileName;

        const needsRestorePaged = proposalSettings.pageMode !== 'paged';
        if (needsRestorePaged) {
            proposalSettings.pageMode = 'paged';
            renderPreview();
        }

        document.body.classList.add('is-printing-proposal');

        window.setTimeout(() => {
            window.print();

            const cleanup = () => {
                document.title = prevTitle;
                document.body.classList.remove('is-printing-proposal');
                if (needsRestorePaged) {
                    proposalSettings.pageMode = 'continuous';
                    renderPreview();
                }
                window.removeEventListener('afterprint', cleanup);
            };

            window.addEventListener('afterprint', cleanup);
            window.setTimeout(cleanup, 4000);
        }, 180);
    }

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
            const exportType = button.dataset.proposalExport;
            if (exportType === 'pdf') {
                exportProposalPdf();
                return;
            }
            if (exportType === 'docx') {
                exportProposalDocx();
                return;
            }
            if (exportType === 'print' || exportType === 'preview') {
                showToast('Opening system print preview...');
                triggerProposalPrint();
                return;
            }
        });
    });

    window.addEventListener('beforeprint', () => {
        const proposalTab = document.getElementById('tab-proposal');
        if (!proposalTab || !proposalTab.classList.contains('active')) return;
        document.body.classList.add('is-printing-proposal');
        if (proposalSettings.pageMode !== 'paged') {
            proposalSettings._tempPrintRestore = proposalSettings.pageMode;
            proposalSettings.pageMode = 'paged';
            renderPreview();
        }
    });

    window.addEventListener('afterprint', () => {
        document.body.classList.remove('is-printing-proposal');
        if (proposalSettings._tempPrintRestore) {
            proposalSettings.pageMode = proposalSettings._tempPrintRestore;
            delete proposalSettings._tempPrintRestore;
            renderPreview();
        }
    });

    window.addEventListener('storage', (event) => {
        if (event.key === estimatingKey) { renderPreview(); renderEstimateFooter(); }
    });
    window.addEventListener('takeoff:active-estimate-changed', () => { renderPreview(); renderEstimateFooter(); });
    window.addEventListener('takeoff:estimating-state-updated', event => { renderPreview(); renderEstimateFooter(event); });
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
