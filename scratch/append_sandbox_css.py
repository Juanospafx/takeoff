sandbox_css = """

/* ==========================================================
   ISOLATED DIRECT PDF EXPORT ENGINE (EXACT 8.5" x 11" LETTER)
   Guarantees 1:1 parity with Chromium Print Output
   ========================================================== */
.proposal-pdf-export-sandbox,
.proposal-pdf-export-sandbox * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    box-sizing: border-box !important;
}

.proposal-pdf-export-sandbox .proposal-page-sheet {
    box-sizing: border-box !important;
    width: 816px !important;
    min-width: 816px !important;
    max-width: 816px !important;
    height: 1056px !important;
    min-height: 1056px !important;
    max-height: 1056px !important;
    margin: 0 !important;
    padding: 0.55in 0.65in 0.45in 0.65in !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #ffffff !important;
    color: #0f172a !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: space-between !important;
    overflow: hidden !important;
}

.proposal-pdf-export-sandbox .proposal-sheet-content {
    flex: 1 1 auto !important;
    display: flex !important;
    flex-direction: column !important;
}

.proposal-pdf-export-sandbox .proposal-item-table td,
.proposal-pdf-export-sandbox .proposal-summary-table td {
    color: #0f172a !important;
    border-bottom: 1px solid #e2e8f0 !important;
}

.proposal-pdf-export-sandbox .proposal-hero-total-box {
    background: #ffffff !important;
    border: 2px solid #0f172a !important;
}

.proposal-pdf-export-sandbox .proposal-hero-amount-val {
    color: #0f172a !important;
}

.proposal-pdf-export-sandbox .proposal-acceptance-wrap {
    margin-top: auto !important;
    padding-top: 10px !important;
    border-top: 1.5px solid #0f172a !important;
}
"""

with open('assets/project_proposal.css', 'a', encoding='utf-8') as f:
    f.write(sandbox_css)

print("assets/project_proposal.css updated with direct PDF export rules.")

