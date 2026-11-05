import sys

print("Applying user tweaks to proposal...")

# 1. Update assets/project_proposal.js
with open('assets/project_proposal.js', 'r', encoding='utf-8') as f:
    js_text = f.read()

# Point 1: Remove bold <strong> from item rows in renderItemTableRow
old_name_html = """        const isChild = Boolean(item.isAssemblyChild);
        const nameHtml = isChild
            ? `<span class="proposal-item-child-indicator">&rdsh;</span> <span class="proposal-item-child-name">${esc(item.name.replace(/^\\u21b3\\s*/, ''))}</span>`
            : `<strong>${esc(item.name)}</strong>`;"""

new_name_html = """        const isChild = Boolean(item.isAssemblyChild);
        const nameHtml = isChild
            ? `<span class="proposal-item-child-indicator">&rdsh;</span> <span class="proposal-item-child-name">${esc(item.name.replace(/^\\u21b3\\s*/, ''))}</span>`
            : `<span class="proposal-item-name">${esc(item.name)}</span>`;"""

assert old_name_html in js_text, "old_name_html not found in js"
js_text = js_text.replace(old_name_html, new_name_html)
print("1. Removed <strong> from cost item names in JS.")

# Point 2 & 5: In renderSummary: remove description underneath, and sort deductions/discounts to the end
old_render_summary_start = "    function renderSummary(totalData) {"
pos_sum_start = js_text.find(old_render_summary_start)
assert pos_sum_start != -1, "renderSummary not found"

pos_sum_end = js_text.find("    function renderAcceptance(", pos_sum_start)
assert pos_sum_end != -1, "renderAcceptance not found after renderSummary"

new_render_summary = """    function renderSummary(totalData) {
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
            const isNegative = item.amount < 0 || /\\b(discount|deduction|rebate|credit|minus|subtraction)\\b/i.test(item.label + ' ' + item.badge);
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

"""

js_text = js_text[:pos_sum_start] + new_render_summary + js_text[pos_sum_end:]
print("2 & 5. Updated renderSummary in JS (removed descriptions, deductions sorted to end).")

with open('assets/project_proposal.js', 'w', encoding='utf-8') as f:
    f.write(js_text)

print("assets/project_proposal.js updated successfully.")

# ==========================================================
# 2. Update assets/project_proposal.css
# ==========================================================
with open('assets/project_proposal.css', 'r', encoding='utf-8') as f:
    css_text = f.read()

# Point 1 CSS: Unbold cost item names & cells
old_item_td = """.proposal-item-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
    background: transparent !important;
    color: #1e293b;
    font-size: 12px;
    vertical-align: top;
    box-sizing: border-box !important;
    word-break: break-word;
    overflow-wrap: break-word;
}"""

new_item_td = """.proposal-item-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
    background: transparent !important;
    color: #1e293b;
    font-size: 12px;
    font-weight: 400 !important; /* Items without bold */
    vertical-align: top;
    box-sizing: border-box !important;
    word-break: break-word;
    overflow-wrap: break-word;
}

.proposal-item-name {
    font-weight: 400 !important; /* Regular font weight for item names */
    color: #1e293b;
}

.proposal-item-table td.col-desc {
    font-weight: 400 !important;
}

.proposal-item-table td.amount {
    font-weight: 500 !important; /* Clean tabular numbers, not heavy bold */
}"""

assert old_item_td in css_text, "old_item_td not found in css"
css_text = css_text.replace(old_item_td, new_item_td)
print("1. Updated CSS: cost item table td is unbolded.")

# Point 3 CSS: Total proposal box - White background with crisp contrast
old_total_box = """.proposal-hero-total-box,
.proposal-total-box {
    width: 100% !important;
    box-sizing: border-box !important;
    margin-top: 14px !important;
    margin-bottom: 24px !important;
    background: linear-gradient(135deg, #090d16 0%, #0f172a 60%, #1e293b 100%) !important;
    border-radius: 12px;
    color: #ffffff !important;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
}"""

new_total_box = """.proposal-hero-total-box,
.proposal-total-box {
    width: 100% !important;
    box-sizing: border-box !important;
    margin-top: 14px !important;
    margin-bottom: 24px !important;
    background: #ffffff !important; /* Clean white background */
    border: 2px solid #0f172a !important; /* Crisp contrast definition */
    border-radius: 12px;
    color: #0f172a !important;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08) !important;
    position: relative;
    overflow: hidden;
}"""

assert old_total_box in css_text, "old_total_box not found in css"
css_text = css_text.replace(old_total_box, new_total_box)

# Update the sub elements inside total box for white background contrast
old_total_elements = """.proposal-hero-title {
    font-size: 16px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.01em;
}

.proposal-hero-sub {
    font-size: 11px;
    color: #94a3b8;
    line-height: 1.4;
    max-width: 520px;
}

.proposal-hero-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
}

.hero-micro-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 9.5px;
    font-weight: 600;
    color: #cbd5e1;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 2px 7px;
    border-radius: 4px;
}

.proposal-hero-total-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
    flex-shrink: 0;
}

.proposal-hero-val-label {
    font-size: 9.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #94a3b8;
    margin-bottom: 2px;
}

.proposal-hero-amount-val {
    font-size: 32px;
    font-weight: 900;
    color: #ffffff !important;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    white-space: nowrap;
}

.proposal-hero-val-sub {
    font-size: 10px;
    color: #64748b;
    margin-top: 3px;
}"""

new_total_elements = """.proposal-hero-title {
    font-size: 16px;
    font-weight: 800;
    color: #0f172a; /* Dark charcoal text */
    letter-spacing: -0.01em;
}

.proposal-hero-sub {
    font-size: 11px;
    color: #64748b; /* Readable slate text */
    line-height: 1.4;
    max-width: 520px;
}

.proposal-hero-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
}

.hero-micro-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 9.5px;
    font-weight: 600;
    color: #334155;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    padding: 2px 7px;
    border-radius: 4px;
}

.proposal-hero-total-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
    flex-shrink: 0;
}

.proposal-hero-val-label {
    font-size: 9.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #64748b;
    margin-bottom: 2px;
}

.proposal-hero-amount-val {
    font-size: 34px;
    font-weight: 900;
    color: #0f172a !important; /* High-contrast hero amount in dark charcoal */
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    white-space: nowrap;
}

.proposal-hero-val-sub {
    font-size: 10px;
    color: #64748b;
    margin-top: 3px;
}"""

assert old_total_elements in css_text, "old_total_elements not found in css"
css_text = css_text.replace(old_total_elements, new_total_elements)
print("3. Updated CSS: total proposal investment is now on white background with crisp dark contrast.")

# Point 4 CSS: Pinned to the bottom of the page
old_acceptance_compact = """.proposal-acceptance-wrap.proposal-acceptance-compact {
    width: 100% !important;
    box-sizing: border-box !important;
    margin-top: 20px;
    padding-top: 14px;
    border-top: 2px solid #0f172a;
}"""

new_acceptance_compact = """.proposal-acceptance-wrap.proposal-acceptance-compact {
    width: 100% !important;
    box-sizing: border-box !important;
    margin-top: auto !important; /* Pinned to the very bottom of the page! */
    padding-top: 14px;
    border-top: 2px solid #0f172a;
}"""

assert old_acceptance_compact in css_text, "old_acceptance_compact not found in css"
css_text = css_text.replace(old_acceptance_compact, new_acceptance_compact)
print("4. Updated CSS: proposal authorization pinned to the bottom of the page via margin-top: auto.")

# Deduction / Negative Row styles for Point 5
deduction_css = """
.proposal-fin-list-row.is-deduction-row {
    background: rgba(254, 242, 242, 0.4);
}

.proposal-fin-icon-bubble.is-negative {
    background: rgba(220, 38, 38, 0.1) !important;
    color: #dc2626 !important;
}

.fin-badge-pill.is-negative {
    background: #fef2f2 !important;
    color: #dc2626 !important;
    border-color: #fecaca !important;
}
"""
css_text += deduction_css

with open('assets/project_proposal.css', 'w', encoding='utf-8') as f:
    f.write(css_text)

print("assets/project_proposal.css updated successfully.")
print("ALL TWEAKS COMPLETED.")

