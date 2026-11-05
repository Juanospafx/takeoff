import os
import re

print("Starting full proposal patch...")

# ==========================================================
# 1. PATCH assets/project_proposal.js
# ==========================================================
with open('assets/project_proposal.js', 'r', encoding='utf-8') as f:
    js_text = f.read()

# Read replacement functions from scratch/test_js_full_update.py
import sys
sys.path.insert(0, 'scratch')
import test_js_full_update as js_mod
new_block = js_mod.new_functions

start_marker = '    function chunkFlatEntries('
end_marker = '    function renderAll() {'

start_pos = js_text.find(start_marker)
end_pos = js_text.find(end_marker)

assert start_pos != -1, "start_marker not found in js"
assert end_pos != -1, "end_marker not found in js"

js_patched = js_text[:start_pos] + new_block + '\n\n' + js_text[end_pos:]

# Update the click handlers in settingsPanel
old_click_handler = """        if (event.target.closest('[data-proposal-open-overview]')) {
            document.querySelector('[data-tab="overview"]')?.click();
            return;
        }
        if (event.target.closest('[data-proposal-contact]')) {
            const email = getCustomer().email;
            if (email) window.location.href = `mailto:${email}`;
        }"""

new_click_handler = """        if (event.target.closest('[data-proposal-open-overview]')) {
            openCustomerEditInOverview();
            return;
        }
        if (event.target.closest('[data-proposal-contact]')) {
            showContactWaitModal(getCustomer());
            return;
        }"""

assert old_click_handler in js_patched, "old_click_handler not found in js"
js_patched = js_patched.replace(old_click_handler, new_click_handler)

with open('assets/project_proposal.js', 'w', encoding='utf-8') as f:
    f.write(js_patched)

print("assets/project_proposal.js patched successfully.")

# ==========================================================
# 2. PATCH assets/project_proposal.css
# ==========================================================
with open('assets/project_proposal.css', 'r', encoding='utf-8') as f:
    css_text = f.read()

# A. Scrollbar on .proposal-preview-area
old_preview_scroll = """.proposal-preview-area {
    min-width: 0;
    min-height: 0;
    position: relative;
    overflow-y: auto !important;
    overflow-x: auto !important;
    padding: 20px 20px 60px !important;
    background: var(--bg-body, var(--tk-bg-workspace, #edf2f7));
    border: 1px solid var(--border-soft, #cbd5e1);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
    display: block !important;
}

.proposal-preview-area::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

.proposal-preview-area::-webkit-scrollbar-track {
    background: transparent;
}

.proposal-preview-area::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.35);
    border-radius: 999px;
}"""

new_preview_scroll = """.proposal-preview-area {
    min-width: 0;
    min-height: 0;
    position: relative;
    overflow-y: scroll !important;
    overflow-x: auto !important;
    scrollbar-gutter: stable;
    scrollbar-width: thin !important;
    scrollbar-color: #94a3b8 #f1f5f9 !important;
    padding: 20px 20px 60px !important;
    background: var(--bg-body, var(--tk-bg-workspace, #edf2f7));
    border: 1px solid var(--border-soft, #cbd5e1);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
    display: block !important;
}

.proposal-preview-area::-webkit-scrollbar {
    display: block !important;
    width: 10px !important;
    height: 10px !important;
}

.proposal-preview-area::-webkit-scrollbar-track {
    display: block !important;
    background: #f1f5f9 !important;
    border-radius: 8px !important;
}

.proposal-preview-area::-webkit-scrollbar-thumb {
    display: block !important;
    background: #cbd5e1 !important;
    border-radius: 8px !important;
    border: 2px solid #f1f5f9 !important;
}

.proposal-preview-area::-webkit-scrollbar-thumb:hover {
    background: #94a3b8 !important;
}"""

assert old_preview_scroll in css_text, "old_preview_scroll not found in css"
css_text = css_text.replace(old_preview_scroll, new_preview_scroll)

# B. Table Styles (Item table th & td backgrounds, customer block under title)
old_table_styles = """.proposal-item-table th {
    background: #f8fafc;
    color: #475569;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
    padding: 9px 12px;
    border-bottom: 1px solid #e2e8f0;
    text-align: left;
    box-sizing: border-box !important;
}

.proposal-item-table td {
    padding: 9px 12px;
    border-bottom: 1px solid #f1f5f9;
    color: #1e293b;
    font-size: 12px;
    vertical-align: top;
    box-sizing: border-box !important;
    word-break: break-word;
    overflow-wrap: break-word;
}"""

new_table_styles = """.proposal-item-table th {
    background: #f1f5f9 !important;
    color: #475569 !important;
    font-size: 10.5px !important;
    font-weight: 800 !important;
    text-transform: uppercase !important;
    letter-spacing: .04em !important;
    padding: 8px 12px !important;
    border-bottom: 1px solid #cbd5e1 !important;
    text-align: left;
    box-sizing: border-box !important;
}

.proposal-item-table td {
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

assert old_table_styles in css_text, "old_table_styles not found in css"
css_text = css_text.replace(old_table_styles, new_table_styles)

# Remove child row background
old_child_row = """.proposal-item-table tr.is-child td {
    background: #fafbfc;
    color: #475569;
    font-size: 11.5px;
}"""

new_child_row = """.proposal-item-table tr.is-child td {
    background: transparent !important;
    color: #475569;
    font-size: 11.5px;
}"""

assert old_child_row in css_text, "old_child_row not found in css"
css_text = css_text.replace(old_child_row, new_child_row)

# Update group row
old_group_row = """.proposal-group-row td {
    background: #f1f5f9;
    font-weight: 800;
    color: #0f172a;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 12px;
}"""

new_group_row = """.proposal-group-row td {
    background: #f8fafc !important;
    font-weight: 800;
    color: #0f172a;
    border-top: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 12px;
}"""

assert old_group_row in css_text, "old_group_row not found in css"
css_text = css_text.replace(old_group_row, new_group_row)

# Update customer block styling
old_customer_block = """.proposal-customer-block {
    width: 100% !important;
    box-sizing: border-box !important;
    padding: 13px 16px;
    margin: 14px 0 16px;
    border: 1px solid #e2e8f0;
    border-radius: 9px;
    background: #f8fafc;
}

.proposal-customer-block h4,
.proposal-doc-section h4 {
    margin: 0 0 6px;
    font-size: 11px;
    color: #334155;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
}

.proposal-customer-name {
    font-size: 13.5px;
    color: #0f172a;
    margin-bottom: 3px;
}

.proposal-customer-sub {
    font-size: 11.5px;
    color: #475569;
    line-height: 1.35;
}"""

new_customer_block = """.proposal-customer-block {
    width: 100% !important;
    box-sizing: border-box !important;
    padding: 10px 14px;
    margin: 6px 0 16px;
    border: 1px solid #e2e8f0;
    border-left: 3px solid var(--primary, #fb5a3a);
    border-radius: 0 8px 8px 0;
    background: #f8fafc;
}

.proposal-customer-prep-label {
    font-size: 9.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--primary, #fb5a3a);
    margin-bottom: 2px;
}

.proposal-doc-section h4 {
    margin: 0 0 6px;
    font-size: 11px;
    color: #334155;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
}

.proposal-customer-name {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 2px;
}

.proposal-customer-address {
    font-size: 11.5px;
    color: #475569;
    line-height: 1.4;
}

.proposal-customer-contacts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    font-size: 11px;
    color: #64748b;
    margin-top: 4px;
}

.proposal-customer-contacts span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}"""

assert old_customer_block in css_text, "old_customer_block not found in css"
css_text = css_text.replace(old_customer_block, new_customer_block)

# C. Append New Rich Styling for:
# - Financial Summary Cards Grid (.proposal-fin-cards-grid, .proposal-fin-card, etc.)
# - Acceptance Wrap (.proposal-acceptance-wrap, .proposal-signatures-grid, etc.)
# - Total box spacing
# - Cover Page (.proposal-cover-page, etc.)
# - Appendix Page (.proposal-appendix-sheet, etc.)
# - Builder mode orange dashed outlines (.is-builder-mode [contenteditable="true"])
# - Contact Modal (.proposal-contact-modal-backdrop, etc.)
# - Dark theme additions for all the above
additional_css = """

/* ==========================================================
   BUILDER MODE: HIGHLIGHT EDITABLE FIELDS WITH ORANGE DASHED BOXES
   ========================================================== */
.is-builder-mode [contenteditable="true"] {
    outline: 2px dashed #fb5a3a !important;
    outline-offset: 3px !important;
    background-color: rgba(251, 90, 58, 0.08) !important;
    border-radius: 4px !important;
    position: relative !important;
    cursor: text !important;
    transition: all 0.2s ease !important;
}

.is-builder-mode [contenteditable="true"]:hover {
    outline: 2px solid #ea580c !important;
    background-color: rgba(251, 90, 58, 0.16) !important;
}

.is-builder-mode [contenteditable="true"]:focus {
    outline: 2px solid #fb5a3a !important;
    background-color: rgba(251, 90, 58, 0.22) !important;
    box-shadow: 0 0 0 3px rgba(251, 90, 58, 0.25) !important;
}

/* ==========================================================
   FINANCIAL INVESTMENT SUMMARY: CARDS GRID & EMPHASIS
   ========================================================== */
.proposal-financial-summary-section {
    margin-top: 22px;
    margin-bottom: 16px;
    width: 100% !important;
    box-sizing: border-box !important;
}

.proposal-fin-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
    padding-bottom: 8px;
    border-bottom: 2px solid #0f172a;
}

.proposal-fin-head h4 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: #0f172a;
}

.proposal-fin-head-sub {
    font-size: 11px;
    color: #64748b;
    margin: 3px 0 0 0;
}

.proposal-fin-unit-rate {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    background: #f1f5f9;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11.5px;
    color: #334155;
    border: 1px solid #e2e8f0;
    white-space: nowrap;
}

.proposal-fin-unit-rate .rate-val {
    font-weight: 800;
    color: var(--primary, #fb5a3a);
    font-size: 13px;
}

.proposal-fin-cards-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 20px;
    width: 100% !important;
    box-sizing: border-box !important;
}

.proposal-fin-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    box-sizing: border-box !important;
}

.proposal-fin-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
}

.proposal-fin-card-icon {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: rgba(251, 90, 58, 0.1);
    color: var(--primary, #fb5a3a);
    display: grid;
    place-items: center;
    font-size: 11px;
}

.proposal-fin-card-badge {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: #64748b;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    padding: 2px 6px;
    border-radius: 4px;
}

.proposal-fin-card-label {
    font-size: 11.5px;
    font-weight: 700;
    color: #334155;
    margin-top: 2px;
}

.proposal-fin-card-amount {
    font-size: 19px;
    font-weight: 800;
    color: #0f172a;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
}

.proposal-fin-card-amount.is-negative {
    color: #dc2626;
}

.proposal-fin-card-desc {
    font-size: 10.5px;
    color: #64748b;
    line-height: 1.35;
    margin-top: 2px;
}

/* ==========================================================
   TOTAL BOX: SPACIOUS BREATHING ROOM BEFORE ACCEPTANCE
   ========================================================== */
.proposal-total-box {
    margin-top: 24px !important;
    margin-bottom: 48px !important; /* Generous separation from signatures */
}

/* ==========================================================
   PROPOSAL AUTHORIZATION & DUAL SIGNATURE ACCEPTANCE BLOCK
   ========================================================== */
.proposal-acceptance-wrap {
    width: 100% !important;
    box-sizing: border-box !important;
    margin-top: 10px;
    padding-top: 18px;
    border-top: 2px solid #0f172a;
}

.proposal-acceptance-title h4 {
    margin: 0;
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: #0f172a;
}

.proposal-acceptance-title p {
    margin: 2px 0 16px 0;
    font-size: 11px;
    color: #64748b;
}

.proposal-signatures-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
    width: 100% !important;
    box-sizing: border-box !important;
}

.proposal-sign-column {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    box-sizing: border-box !important;
}

.proposal-sign-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 10px;
}

.proposal-sign-party {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--primary, #fb5a3a);
}

.proposal-sign-role {
    font-size: 12.5px;
    font-weight: 700;
    color: #0f172a;
}

.proposal-sign-agreement-text {
    font-size: 10px;
    color: #64748b;
    line-height: 1.4;
    margin-bottom: 14px;
}

.proposal-sign-slot {
    margin-bottom: 12px;
}

.proposal-sign-slot.signature-line .proposal-sign-line-draw {
    min-height: 38px;
}

.proposal-sign-slot-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 0;
}

.proposal-sign-line-draw {
    border-bottom: 1px solid #94a3b8;
    min-height: 22px;
    display: flex;
    align-items: flex-end;
    padding-bottom: 2px;
}

.proposal-sign-prefilled {
    font-size: 11px;
    font-weight: 600;
    color: #1e293b;
}

.proposal-sign-slot-label {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: #64748b;
    margin-top: 3px;
}

/* ==========================================================
   COVER PAGE & APPENDIX PAGES
   ========================================================== */
.proposal-cover-page {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 9.6in;
    padding: .2in 0;
    box-sizing: border-box !important;
}

.proposal-cover-top-accent {
    height: 6px;
    background: linear-gradient(90deg, #fb5a3a 0%, #ea580c 100%);
    border-radius: 3px;
    margin-bottom: 28px;
}

.proposal-cover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 20px;
    border-bottom: 1px solid #e2e8f0;
}

.proposal-cover-tagline {
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: .06em;
}

.proposal-cover-center {
    margin: 40px 0;
}

.proposal-cover-badge {
    display: inline-block;
    background: rgba(251, 90, 58, 0.1);
    color: var(--primary, #fb5a3a);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .1em;
    padding: 4px 10px;
    border-radius: 4px;
    margin-bottom: 16px;
}

.proposal-cover-title {
    font-size: 30px;
    font-weight: 900;
    color: #0f172a;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin-bottom: 12px;
}

.proposal-cover-subtitle {
    font-size: 14.5px;
    color: #475569;
    line-height: 1.4;
}

.proposal-cover-divider {
    width: 60px;
    height: 4px;
    background: var(--primary, #fb5a3a);
    margin-top: 22px;
    border-radius: 2px;
}

.proposal-cover-meta-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin: 30px 0;
}

.proposal-cover-meta-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 16px;
    box-sizing: border-box !important;
}

.proposal-cover-meta-label {
    font-size: 9.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--primary, #fb5a3a);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
}

.proposal-cover-meta-val {
    font-size: 13.5px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 4px;
}

.proposal-cover-meta-sub {
    font-size: 11px;
    color: #64748b;
    line-height: 1.4;
}

.proposal-cover-bottom {
    padding-top: 18px;
    border-top: 1px solid #e2e8f0;
}

.proposal-cover-confidential {
    font-size: 9.5px;
    color: #94a3b8;
    line-height: 1.4;
}

.proposal-continuous-page-divider {
    height: 2px;
    background: #e2e8f0;
    margin: 40px 0;
    border-radius: 1px;
}

/* Appendix Sheet */
.proposal-appendix-sheet {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.proposal-appendix-content {
    margin-top: 18px;
}

.proposal-appendix-header h4 {
    font-size: 14px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: #0f172a;
    margin: 0;
}

.proposal-appendix-sub {
    font-size: 11.5px;
    color: #64748b;
    margin: 4px 0 20px 0;
}

.proposal-terms-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 20px;
}

.proposal-term-item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
}

.proposal-term-num {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: rgba(251, 90, 58, 0.1);
    color: var(--primary, #fb5a3a);
    font-size: 11.5px;
    font-weight: 800;
    display: grid;
    place-items: center;
}

.proposal-term-body h5 {
    font-size: 11.5px;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 3px 0;
}

.proposal-term-body p {
    font-size: 10.5px;
    color: #475569;
    line-height: 1.45;
    margin: 0;
}

/* ==========================================================
   CUSTOMER CONTACT WAITING MODAL
   ========================================================== */
.proposal-contact-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    animation: propFadeIn 0.2s ease;
}

.proposal-contact-modal-card {
    background: #ffffff;
    border-radius: 16px;
    padding: 28px 32px;
    width: 380px;
    max-width: 90vw;
    text-align: center;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
    border: 1px solid #e2e8f0;
}

.proposal-contact-modal-spinner {
    font-size: 34px;
    color: var(--primary, #fb5a3a);
    margin-bottom: 14px;
}

.proposal-contact-modal-title {
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 6px;
}

.proposal-contact-modal-desc {
    font-size: 12.5px;
    color: #64748b;
    line-height: 1.45;
}

.proposal-contact-email {
    color: var(--primary, #fb5a3a);
    font-weight: 700;
}

.proposal-contact-progress-bar {
    height: 4px;
    background: #e2e8f0;
    border-radius: 999px;
    overflow: hidden;
    margin: 18px 0 16px;
}

.proposal-contact-progress-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #fb5a3a, #ea580c);
    border-radius: 999px;
    animation: propProgressFill 0.9s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes propProgressFill {
    0% { width: 0%; }
    100% { width: 100%; }
}

.proposal-contact-modal-cancel {
    background: transparent;
    border: 1px solid #cbd5e1;
    color: #64748b;
    padding: 6px 18px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
}

.proposal-contact-modal-cancel:hover {
    background: #f1f5f9;
    color: #0f172a;
}

/* Dark Theme Overrides for New Components */
[data-theme="dark"] .proposal-contact-modal-card,
body.theme-dark .proposal-contact-modal-card {
    background: #1e293b;
    border-color: #334155;
    color: #f8fafc;
}

[data-theme="dark"] .proposal-contact-modal-title,
body.theme-dark .proposal-contact-modal-title {
    color: #f8fafc;
}

[data-theme="dark"] .proposal-contact-modal-desc,
body.theme-dark .proposal-contact-modal-desc {
    color: #94a3b8;
}

[data-theme="dark"] .proposal-contact-progress-bar,
body.theme-dark .proposal-contact-progress-bar {
    background: #334155;
}

[data-theme="dark"] .proposal-contact-modal-cancel,
body.theme-dark .proposal-contact-modal-cancel {
    border-color: #475569;
    color: #cbd5e1;
}

[data-theme="dark"] .proposal-contact-modal-cancel:hover,
body.theme-dark .proposal-contact-modal-cancel:hover {
    background: #334155;
    color: #ffffff;
}

[data-theme="dark"] .proposal-preview-area,
body.theme-dark .proposal-preview-area {
    scrollbar-color: #475569 #1f2633 !important;
}

[data-theme="dark"] .proposal-preview-area::-webkit-scrollbar-track,
body.theme-dark .proposal-preview-area::-webkit-scrollbar-track {
    background: #1f2633 !important;
}

[data-theme="dark"] .proposal-preview-area::-webkit-scrollbar-thumb,
body.theme-dark .proposal-preview-area::-webkit-scrollbar-thumb {
    background: #475569 !important;
    border: 2px solid #1f2633 !important;
}

[data-theme="dark"] .proposal-preview-area::-webkit-scrollbar-thumb:hover,
body.theme-dark .proposal-preview-area::-webkit-scrollbar-thumb:hover {
    background: #64748b !important;
}
"""

css_text += additional_css

with open('assets/project_proposal.css', 'w', encoding='utf-8') as f:
    f.write(css_text)

print("assets/project_proposal.css patched successfully.")
print("ALL PATCHES APPLIED.")
