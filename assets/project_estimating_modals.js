(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ProjectEstimatingModals = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function renderEstimatingModal(context) {
        const { ui, esc, current, renderCatalogChoices } = context;
        document.querySelector('[data-estimating-modal-portal]')?.remove();
        if (!ui.modal) return;

        const rerender = () => renderEstimatingModal(context);
        const portal = document.createElement('div');
        portal.dataset.estimatingModalPortal = '';
        portal.className = 'pd-modal-backdrop open est-estimating-modal-portal';

        if (ui.modal === 'new') {
            portal.innerHTML = `<div class="bb-create-project-modal bb-studio-modal pd-modal est-dialog est-copy-modal est-copy-dialog" role="dialog" aria-modal="true" aria-labelledby="copyEstimateTitle">
                <div class="pd-modal-head bb-modal-head est-copy-dialog-head">
                    <div class="est-copy-dialog-title-row">
                        <div class="bb-modal-icon-badge est-modal-icon-badge est-copy-dialog-icon"><i class="fas fa-calculator"></i></div>
                        <div>
                            <strong id="copyEstimateTitle" class="bb-modal-heading est-copy-dialog-title">New Estimate Version</strong>
                            <span class="bb-modal-subheading est-modal-sub est-copy-dialog-subtitle">Create an independent bid estimate version for this project</span>
                        </div>
                    </div>
                    <button class="pd-modal-head-close bb-icon-btn bordered est-copy-dialog-close" type="button" data-close-modal aria-label="Close"><i class="fas fa-times"></i></button>
                </div>
                <div class="pd-modal-body bb-modal-body est-copy-dialog-body">
                    <div class="bb-form-group est-copy-form-group">
                        <label class="bb-form-label est-copy-form-label" for="copyEstimateName"><span>Estimate Name</span><span class="est-required-mark">*</span></label>
                        <div class="bb-input-icon-wrap est-copy-input-wrap">
                            <i class="fas fa-file-invoice-dollar est-copy-input-icon"></i>
                            <input id="copyEstimateName" class="bb-input-control est-modal-input est-copy-name-input" type="text" value="${esc(current().name)} Copy" autocomplete="off" placeholder="e.g. Base Bid Copy">
                        </div>
                        <div class="bb-input-hint est-modal-sub est-copy-input-hint">Unique name displayed across tabs, client summaries, and proposals.</div>
                    </div>
                    <div class="est-copy-name est-display-contents"></div>
                    <div class="bb-form-group est-copy-config-group">
                        <label class="bb-form-label est-copy-form-label est-copy-config-label"><i class="fas fa-shapes est-accent-icon"></i><span>Starting Configuration</span></label>
                        <div class="bb-studio-mode-stack est-copy-option-stack">
                            ${copyOption('all', 'Copy everything', 'Start with a complete clone of groups, items, quantities, notes, materials and markups.', true, true)}
                            ${copyOption('structure', 'Groups only', 'Keep the exact group hierarchy; items from Takeoff are not automatically pre-populated.')}
                            ${copyOption('blank', 'Blank estimate', 'Start with a fresh empty estimate. Ideal for value engineering alternates or custom bids.')}
                        </div>
                    </div>
                </div>
                <div class="pd-modal-foot bb-modal-foot est-copy-dialog-foot">
                    <div class="bb-modal-foot-info est-modal-sub est-copy-foot-info"><i class="fas fa-circle-check est-success-icon"></i><span>Independent version with separate totals</span></div>
                    <div class="bb-modal-foot-actions est-copy-foot-actions">
                        <button class="btn-ghost bb-btn-procore-secondary est-copy-cancel" type="button" data-close-modal>Cancel</button>
                        <button class="btn-main orange bb-btn-procore-primary est-copy-submit" type="button" data-create-estimate data-est-action="create-estimate-copy"><i class="fas fa-plus"></i> Create Estimate</button>
                    </div>
                </div>
            </div>`;
        } else if (ui.modal === 'export') {
            const options = [
                ['estimate-xlsx', 'Project Estimate (.xlsx)', 'Full multi-tab workbook (Estimate, BoM Flat & Summary)', 'fa-file-excel', 'Template'],
                ['bom-excel', 'Bill of Materials (BOM - Excel)', 'Grouped hierarchical assemblies & components (.xls)', 'fa-table-list', 'Excel'],
                ['bom-csv', 'Bill of Materials (BOM - CSV)', 'Hierarchical BOM with group headers & children (.csv)', 'fa-file-csv', 'CSV'],
                ['normal', 'BOQ Normal (CSV)', 'Organized by group keeping assemblies as single rows', 'fa-list-ul', 'CSV'],
                ['flat', 'BOQ Flat (CSV)', 'Break assemblies into parts consolidated by catalog item', 'fa-layer-group', 'CSV'],
                ['summary-csv', 'Estimate Summary (CSV)', 'Group totals for Material, Labor Hours, Equipment & Cost', 'fa-chart-pie', 'Summary']
            ];
            portal.innerHTML = studioDialog('export', 'Export Estimate', 'Choose a spreadsheet or bill of materials format for this active estimate', 'Select Export Format',
                options.map((opt, idx) => optionCard(opt, idx === 0, 'estimateExportMode')).join(''),
                '<button type="button" class="btn-main est-btn-export" data-download-estimate><i class="fas fa-download"></i> Export</button>');
        } else if (ui.modal === 'import') {
            const options = [
                ['keep_excel', 'Workbook Qty & Rates', 'Keep workbook quantities & rates and link items to Cost Catalog', 'fa-file-circle-check', 'Default'],
                ['keep_qty_refresh_prices', 'Refresh Catalog Prices', 'Keep workbook quantities and load latest Cost Catalog pricing', 'fa-arrows-rotate', 'Catalog'],
                ['zero_qty_keep_prices', 'Zero Qty (Keep Rates)', 'Import structure & workbook prices with all quantities at 0', 'fa-eraser', 'Template'],
                ['zero_qty_refresh_prices', 'Zero Qty + Catalog Rates', 'Start at 0 quantity with live Cost Catalog prices linked', 'fa-wand-magic-sparkles', 'Fresh'],
                ['standalone_exact', 'Exact Workbook Only', 'Keep workbook rows and rates verbatim without catalog relink', 'fa-lock', 'Standalone'],
                ['keep_excel_open_takeoff', 'Import & Open Takeoff', 'Create new estimate tab and jump to Takeoff canvas to count', 'fa-compass-drafting', 'Takeoff']
            ];
            const selectedFile = ui.importFile;
            const body = `<div class="est-import-top-row">
                <div class="est-import-field"><label for="estImportName">New Estimate Tab Name</label><input type="text" id="estImportName" class="est-modal-input" value="${esc(ui.importName || '')}" placeholder="Optional &mdash; defaults to workbook estimate name"></div>
                <div class="est-import-field"><label>Excel Workbook (.xlsx)</label><div class="est-import-dropzone ${selectedFile ? 'has-file' : ''}" id="estImportDropzone" tabindex="0" role="button" aria-label="Choose .xlsx file"><input type="file" id="estImportFileInput" accept=".xlsx,.xlsm" hidden><i class="fas ${selectedFile ? 'fa-file-excel' : 'fa-cloud-arrow-up'}"></i><div class="est-import-dropzone-text"><strong>${selectedFile ? esc(selectedFile.name) : 'Click or drop .xlsx workbook here'}</strong><span>${selectedFile ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB ready to import` : 'Uses Project Estimate Export_Template.xlsx structure'}</span></div></div></div>
            </div>${ui.importError ? `<div class="est-import-error" id="estImportError"><i class="fas fa-circle-exclamation"></i> <span>${esc(ui.importError)}</span></div>` : ''}
            <div class="est-studio-section-label">Import Behavior</div><div class="est-studio-card-grid" role="radiogroup" aria-label="Import behavior">${options.map(opt => optionCard(opt, (ui.importMode || 'keep_excel') === opt[0], 'estimateImportMode')).join('')}</div>`;
            const submit = `<button type="button" class="btn-main est-btn-import" data-import-estimate ${ui.importing ? 'disabled' : ''}><i class="fas ${ui.importing ? 'fa-spinner fa-spin' : 'fa-file-import'}"></i> ${ui.importing ? 'Importing&hellip;' : 'Import as New Estimate'}</button>`;
            portal.innerHTML = studioDialog('import', 'Import Estimate (.xlsx)', 'Create a new Estimate tab inside this project from an exported template workbook', '', body, submit, ui.importing);
        } else if (ui.modal === 'catalog') {
            const results = ui.catalogLoading
                ? '<div class="est-empty est-modal-sub est-catalog-message">Loading Cost Catalog...</div>'
                : (ui.catalogError ? `<div class="est-empty est-catalog-message is-error">${esc(ui.catalogError)}</div>` : renderCatalogChoices(''));
            portal.innerHTML = `<div class="pd-modal est-catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="estimateCatalogTitle">
                <div class="pd-modal-head est-catalog-head"><div><h3 id="estimateCatalogTitle" class="est-catalog-title"><i class="fas fa-book-open"></i> Add Cost Catalog Item</h3><span class="est-modal-sub est-catalog-subtitle">Select an existing catalog item for this estimate group</span></div><button class="pd-modal-head-close est-catalog-close" type="button" aria-label="Close" data-close-modal>&times;</button></div>
                <div class="pd-modal-body est-catalog-body"><input type="search" data-est-catalog-search class="est-modal-input est-catalog-search" placeholder="Search Cost Catalog..." autocomplete="off"><div data-est-catalog-results class="est-catalog-results">${results}</div></div>
                <div class="pd-modal-foot est-catalog-foot"><button type="button" class="btn-ghost est-catalog-cancel" data-close-modal>Cancel</button></div>
            </div>`;
        }

        document.body.appendChild(portal);
        bindPortalEvents(portal, context, rerender);
        portal.querySelector('input:not([type="file"]):not(.est-sr-radio), button:not([disabled])')?.focus();
    }

    function copyOption(value, title, description, checked = false, recommended = false) {
        return `<label class="bb-studio-card est-copy-option est-modal-card"><input type="radio" name="copyEstimateMode" value="${value}" ${checked ? 'checked' : ''} class="est-copy-radio"><div class="est-copy-option-content"><div class="est-copy-option-title-row"><strong>${title}</strong>${recommended ? '<span class="est-recommended-pill">Recommended</span>' : ''}</div><small class="est-modal-sub est-copy-option-description">${description}</small></div></label>`;
    }

    function optionCard(opt, active, groupName) {
        return `<label class="bb-mode-card bb-studio-card est-studio-card ${active ? 'active' : ''}" data-est-radio-card><input type="radio" name="${groupName}" value="${opt[0]}" ${active ? 'checked' : ''} class="est-sr-radio"><div class="est-studio-card-top"><span class="bb-mode-icon"><i class="fas ${opt[3]}"></i></span><span class="est-studio-card-pill">${opt[4]}</span></div><div class="est-studio-card-body"><strong>${opt[1]}</strong><span>${opt[2]}</span></div></label>`;
    }

    function studioDialog(kind, title, subtitle, sectionLabel, content, submit, disabled = false) {
        const cardGrid = sectionLabel ? `<div class="est-studio-section-label">${sectionLabel}</div><div class="est-studio-card-grid" role="radiogroup" aria-label="${sectionLabel}">${content}</div>` : content;
        return `<div class="pd-modal bb-studio-modal est-grid-modal est-${kind}-modal" role="dialog" aria-modal="true" aria-labelledby="${kind}EstimateTitle"><div class="pd-modal-head est-studio-modal-head"><div class="est-studio-head-left"><div class="est-modal-icon-badge is-${kind}"><i class="fas fa-file-${kind}"></i></div><div><h3 id="${kind}EstimateTitle">${title}</h3><span class="est-modal-sub">${subtitle}</span></div></div><button class="pd-modal-head-close" type="button" aria-label="Close" data-close-modal>&times;</button></div><div class="pd-modal-body est-studio-modal-body">${cardGrid}</div><div class="pd-modal-foot est-studio-modal-foot"><button type="button" class="btn-ghost" data-close-modal ${disabled ? 'disabled' : ''}>Cancel</button>${submit}</div></div>`;
    }

    function bindPortalEvents(portal, context, rerender) {
        const { ui } = context;
        portal.addEventListener('change', event => {
            const card = event.target.closest('[data-est-radio-card]');
            if (card && event.target.type === 'radio') {
                const groupName = event.target.name;
                portal.querySelectorAll(`input[name="${groupName}"]`).forEach(input => input.closest('[data-est-radio-card]')?.classList.toggle('active', input.checked));
                if (groupName === 'estimateImportMode') ui.importMode = event.target.value;
            }
            if (event.target.id === 'estImportFileInput') acceptImportFile(event.target.files?.[0], portal, ui, rerender);
        });
        portal.addEventListener('input', event => { if (event.target.id === 'estImportName') ui.importName = event.target.value; });
        const dropzone = portal.querySelector('#estImportDropzone');
        const fileInput = portal.querySelector('#estImportFileInput');
        if (dropzone && fileInput) {
            dropzone.addEventListener('click', () => { if (!ui.importing) fileInput.click(); });
            dropzone.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !ui.importing) { event.preventDefault(); fileInput.click(); } });
            dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('is-dragover'); });
            dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
            dropzone.addEventListener('drop', event => { event.preventDefault(); dropzone.classList.remove('is-dragover'); acceptImportFile(event.dataTransfer?.files?.[0], portal, ui, rerender); });
        }
        portal.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.target?.tagName === 'TEXTAREA' || event.target?.tagName === 'BUTTON') return;
            const selector = ui.modal === 'new' ? '[data-create-estimate]' : (ui.modal === 'export' ? '[data-download-estimate]' : (ui.modal === 'import' ? '[data-import-estimate]' : ''));
            if (selector) { event.preventDefault(); portal.querySelector(selector)?.click(); }
        });
    }

    function acceptImportFile(file, portal, ui, rerender) {
        if (!file) return;
        ui.importFile = file;
        ui.importError = '';
        const nameInput = portal.querySelector('#estImportName');
        ui.importName = nameInput && nameInput.value.trim() ? nameInput.value : file.name.replace(/\.(xlsx|xlsm)$/i, '').replace(/[_-]+/g, ' ').trim();
        rerender();
    }

    return { renderEstimatingModal };
});
