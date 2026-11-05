with open('assets/project_proposal.css', 'r', encoding='utf-8') as f:
    css_text = f.read()

pos1 = css_text.find('/* ==========================================================\n   FINANCIAL INVESTMENT SUMMARY')
pos2 = css_text.find('/* ==========================================================\n   COVER PAGE & APPENDIX PAGES')

assert pos1 != -1, "pos1 not found"
assert pos2 != -1, "pos2 not found"

new_css_section = """/* ==========================================================
   FINANCIAL INVESTMENT SUMMARY: EXECUTIVE ITEMIZED LIST
   ========================================================== */
.proposal-financial-summary-section {
    margin-top: 20px;
    margin-bottom: 16px;
    width: 100% !important;
    box-sizing: border-box !important;
}

.proposal-fin-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
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

/* Financial Itemized List Shell */
.proposal-fin-list-shell {
    width: 100% !important;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    background: #ffffff;
    box-sizing: border-box !important;
    margin-bottom: 16px;
}

.proposal-fin-list-header {
    display: grid;
    grid-template-columns: 1fr 140px 140px;
    align-items: center;
    background: #f1f5f9;
    padding: 8px 16px;
    border-bottom: 1px solid #cbd5e1;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: #475569;
}

.proposal-fin-list-header .col-cost-amount {
    text-align: right;
}

.proposal-fin-list-header .col-cost-type {
    text-align: center;
}

.proposal-fin-list-body {
    display: flex;
    flex-direction: column;
}

.proposal-fin-list-row {
    display: grid;
    grid-template-columns: 1fr 140px 140px;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid #f1f5f9;
    box-sizing: border-box !important;
    transition: background 0.12s ease;
}

.proposal-fin-list-row:last-child {
    border-bottom: none;
}

.proposal-fin-row-main {
    display: flex;
    align-items: center;
    gap: 12px;
}

.proposal-fin-icon-bubble {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: rgba(251, 90, 58, 0.1);
    color: var(--primary, #fb5a3a);
    display: grid;
    place-items: center;
    font-size: 11px;
    flex-shrink: 0;
}

.proposal-fin-row-texts {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.proposal-fin-row-label {
    font-size: 12.5px;
    font-weight: 700;
    color: #0f172a;
}

.proposal-fin-row-desc {
    font-size: 10.5px;
    color: #64748b;
    line-height: 1.35;
}

.proposal-fin-row-badge {
    text-align: center;
}

.fin-badge-pill {
    display: inline-block;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: #475569;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    padding: 2px 8px;
    border-radius: 999px;
}

.proposal-fin-row-val {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    text-align: right;
}

.proposal-fin-row-val.is-negative {
    color: #dc2626;
}

/* ==========================================================
   HERO TOTAL PROPOSAL BOX: PROTAGONIZING THE INVESTMENT
   ========================================================== */
.proposal-hero-total-box,
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
}

.proposal-hero-total-accent-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, #fb5a3a 0%, #ea580c 50%, #f97316 100%);
}

.proposal-hero-total-inner {
    padding: 20px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    box-sizing: border-box !important;
}

.proposal-hero-total-left {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 auto;
}

.proposal-hero-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #fb5a3a;
}

.proposal-hero-title {
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
}

/* ==========================================================
   SHORTENED COMPACT PROPOSAL AUTHORIZATION & FORMAL ACCEPTANCE
   ========================================================== */
.proposal-acceptance-wrap.proposal-acceptance-compact {
    width: 100% !important;
    box-sizing: border-box !important;
    margin-top: 20px;
    padding-top: 14px;
    border-top: 2px solid #0f172a;
}

.proposal-acceptance-compact-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 10px;
}

.compact-head-title {
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: #0f172a;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.compact-head-title i {
    color: var(--primary, #fb5a3a);
}

.compact-head-sub {
    font-size: 10.5px;
    color: #64748b;
}

.proposal-signatures-compact-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    width: 100% !important;
    box-sizing: border-box !important;
}

.proposal-sign-compact-col {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box !important;
}

.proposal-sign-compact-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #e2e8f0;
}

.sign-party-tag {
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--primary, #fb5a3a);
}

.sign-party-name {
    font-size: 11px;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.proposal-sign-draw-zone {
    margin-top: 0;
}

.proposal-sign-draw-line {
    border-bottom: 1px solid #94a3b8;
    height: 26px;
}

.proposal-sign-line-text {
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: #64748b;
    margin-top: 2px;
    display: block;
}

.proposal-sign-meta-compact-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}

.proposal-sign-meta-cell {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.meta-cell-label {
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: #94a3b8;
}

.meta-cell-value {
    font-size: 10px;
    font-weight: 600;
    color: #1e293b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

"""

css_patched = css_text[:pos1] + new_css_section + css_text[pos2:]

with open('assets/project_proposal.css', 'w', encoding='utf-8') as f:
    f.write(css_patched)

print("assets/project_proposal.css updated successfully.")

