import os
import re

print("Starting proposal refinements...")

# 1. Update defaults in assets/project_proposal.js
with open('assets/project_proposal.js', 'r', encoding='utf-8') as f:
    js_text = f.read()

# Change defaults.appendixPage: 'None' -> 'Scope Appendix'
old_def = "appendixPage: 'None',"
new_def = "appendixPage: 'Scope Appendix',"
assert old_def in js_text, "old_def not found in js"
js_text = js_text.replace(old_def, new_def, 1)

# Now find from 'function renderAppendixPage' to end of 'renderPreview'
start_marker = '    function renderAppendixPage('
end_marker = '    function renderAll() {'

start_pos = js_text.find(start_marker)
end_pos = js_text.find(end_marker)

assert start_pos != -1, "start_marker not found in js"
assert end_pos != -1, "end_marker not found in js"

new_section = '''    function renderAppendixPage(appendixType, quoteNum, docTitle, currentDate) {
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

    function chunkFlatEntries(entries, maxPerPage = 14) {
        const pages = [];
        const total = entries.length;
        if (total === 0) {
            return pages;
        }

        let idx = 0;
        while (idx < total) {
            const take = Math.min(maxPerPage, total - idx);
            pages.push({
                entries: entries.slice(idx, idx + take),
                hasSummary: false
            });
            idx += take;
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
                amount: totalData.material,
                desc: 'Raw materials, prefabricated elements, hardware, and physical project supplies required for installation.'
            });
            items.push({
                icon: 'fa-person-digging',
                badge: 'Direct Labor',
                label: 'Direct Labor & Installation',
                amount: totalData.labor,
                desc: 'Certified trade craftsmanship, fabrication, field installation, and technical execution hours.'
            });
        }

        if (totalData.equipment) {
            items.push({
                icon: 'fa-truck-pickup',
                badge: 'Equipment',
                label: 'Equipment & Machinery',
                amount: totalData.equipment,
                desc: 'Specialized heavy equipment, machinery rentals, scaffolding, and staging logistics.'
            });
        }

        if (proposalSettings.summary.overhead) {
            if (Array.isArray(totalData.preTaxMarkups) && totalData.preTaxMarkups.length > 0) {
                totalData.preTaxMarkups.forEach(m => {
                    if (m && m.value !== 0) {
                        const rateStr = m.rate ? ` (${m.rate}%)` : '';
                        items.push({
                            icon: 'fa-building-shield',
                            badge: 'Markup',
                            label: `${m.name || 'Markup'}${rateStr}`,
                            amount: m.value,
                            desc: 'Site supervision, project engineering, administrative management, and insurance coverage.'
                        });
                    }
                });
            } else if (totalData.markup) {
                items.push({
                    icon: 'fa-building-shield',
                    badge: 'Overhead',
                    label: 'Overhead & Administration',
                    amount: totalData.markup,
                    desc: 'Operational overhead, insurance coverage, administrative coordination, and site safety management.'
                });
            }
        }

        if (Array.isArray(totalData.postTaxMarkups) && totalData.postTaxMarkups.length > 0) {
            totalData.postTaxMarkups.forEach(m => {
                if (m && m.value !== 0) {
                    const rateStr = m.rate ? ` (${m.rate}%)` : '';
                    items.push({
                        icon: 'fa-file-invoice-dollar',
                        badge: 'Adjustment',
                        label: `${m.name || 'Adjustment'}${rateStr}`,
                        amount: m.value,
                        desc: 'Post-tax contract adjustments, project contingency allocation, or performance bonding.'
                    });
                }
            });
        }

        if (proposalSettings.summary.taxes && totalData.taxes) {
            items.push({
                icon: 'fa-receipt',
                badge: 'Taxes',
                label: 'Statutory Taxes',
                amount: totalData.taxes,
                desc: 'Applicable state, county, and municipal sales or excise taxes on project materials and trade services.'
            });
        }

        if (proposalSettings.summary.profit && totalData.profit) {
            items.push({
                icon: 'fa-chart-line-up',
                badge: 'Margin',
                label: 'Profit Margin & Contingency',
                amount: totalData.profit,
                desc: 'Net project margin, warranty reserve funding, and firm contract performance guarantee.'
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

        return `
            <section class="proposal-doc-section proposal-financial-summary-section">
                <div class="proposal-fin-head">
                    <div>
                        <h4>Financial Summary &amp; Investment Breakdown</h4>
                        <p class="proposal-fin-head-sub">Comprehensive accounting breakdown itemizing direct trade work, equipment, operational markups, and taxes.</p>
                    </div>
                    ${unitRateHtml}
                </div>

                <div class="proposal-fin-list-shell">
                    <div class="proposal-fin-list-header">
                        <span class="col-cost-cat">Cost Category &amp; Scope Details</span>
                        <span class="col-cost-type">Classification</span>
                        <span class="col-cost-amount">Amount</span>
                    </div>
                    <div class="proposal-fin-list-body">
                        ${items.map(row => `
                            <div class="proposal-fin-list-row">
                                <div class="proposal-fin-row-main">
                                    <div class="proposal-fin-icon-bubble"><i class="fas ${row.icon}"></i></div>
                                    <div class="proposal-fin-row-texts">
                                        <div class="proposal-fin-row-label">${esc(row.label)}</div>
                                        <div class="proposal-fin-row-desc">${esc(row.desc)}</div>
                                    </div>
                                </div>
                                <div class="proposal-fin-row-badge">
                                    <span class="fin-badge-pill">${esc(row.badge)}</span>
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
        const showAcceptedBy = proposalSettings.summary.acceptedBy;
        const showDate = proposalSettings.summary.date;
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
                        <div class="proposal-sign-draw-zone">
                            <div class="proposal-sign-draw-line"></div>
                            <span class="proposal-sign-line-text">Authorized Client Signature</span>
                        </div>
                        <div class="proposal-sign-meta-compact-row">
                            <div class="proposal-sign-meta-cell">
                                <span class="meta-cell-label">Printed Name</span>
                                <span class="meta-cell-value">${clientContact ? esc(clientContact) : '_____________________'}</span>
                            </div>
                            <div class="proposal-sign-meta-cell">
                                <span class="meta-cell-label">Date of Acceptance</span>
                                <span class="meta-cell-value">____ / ____ / 202___</span>
                            </div>
                        </div>
                    </div>

                    <!-- Contractor Authorization Column -->
                    <div class="proposal-sign-column proposal-sign-compact-col">
                        <div class="proposal-sign-compact-label">
                            <span class="sign-party-tag">CONTRACTOR AUTHORIZATION</span>
                            <span class="sign-party-name">Brightronix Technologies</span>
                        </div>
                        <div class="proposal-sign-draw-zone">
                            <div class="proposal-sign-draw-line"></div>
                            <span class="proposal-sign-line-text">Authorized Representative Signature</span>
                        </div>
                        <div class="proposal-sign-meta-compact-row">
                            <div class="proposal-sign-meta-cell">
                                <span class="meta-cell-label">Prepared By</span>
                                <span class="meta-cell-value">${esc(estimatorName)}</span>
                            </div>
                            <div class="proposal-sign-meta-cell">
                                <span class="meta-cell-label">Date of Issuance</span>
                                <span class="meta-cell-value">${esc(currentDate)}</span>
                            </div>
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
            const itemChunks = chunkFlatEntries(flatEntries, 14);

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
    }'''

js_patched = js_text[:start_pos] + new_section + '\n\n' + js_text[end_pos:]

with open('assets/project_proposal.js', 'w', encoding='utf-8') as f:
    f.write(js_patched)

print("assets/project_proposal.js updated successfully.")

