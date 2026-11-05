import os

print("Starting export download implementation...")

# 1. Update pages/project_dashboard.php
with open('pages/project_dashboard.php', 'r', encoding='utf-8') as f:
    php_text = f.read()

# A. Add html2pdf.bundle.min.js script
old_script_ref = '<script src="../assets/project_proposal.js?v=<?= filemtime(__DIR__ . \'/../assets/project_proposal.js\') ?>"></script>'
new_script_ref = '<script src="../assets/html2pdf.bundle.min.js"></script>\n    <script src="../assets/project_proposal.js?v=<?= filemtime(__DIR__ . \'/../assets/project_proposal.js\') ?>"></script>'

assert old_script_ref in php_text, "old_script_ref not found in php"
php_text = php_text.replace(old_script_ref, new_script_ref, 1)

# B. Update the export dropdown menu HTML
old_menu_html = """                                <div class="proposal-export-menu" id="proposalExportMenu">
                                    <button type="button" data-proposal-export="pdf">Export PDF</button>
                                    <button type="button" data-proposal-export="docx">Export DOCX</button>
                                    <button type="button" data-proposal-export="preview">Export Preview</button>
                                </div>"""

new_menu_html = """                                <div class="proposal-export-menu" id="proposalExportMenu">
                                    <button type="button" data-proposal-export="pdf"><i class="fas fa-file-pdf" style="color:#ef4444; width:16px; margin-right:6px;"></i> Download PDF (.pdf)</button>
                                    <button type="button" data-proposal-export="docx"><i class="fas fa-file-word" style="color:#2563eb; width:16px; margin-right:6px;"></i> Download Word (.doc)</button>
                                    <button type="button" data-proposal-export="print"><i class="fas fa-print" style="color:#64748b; width:16px; margin-right:6px;"></i> Print / System Dialog</button>
                                </div>"""

assert old_menu_html in php_text, "old_menu_html not found in php"
php_text = php_text.replace(old_menu_html, new_menu_html, 1)

with open('pages/project_dashboard.php', 'w', encoding='utf-8') as f:
    f.write(php_text)
print("pages/project_dashboard.php updated successfully.")

# 2. Update assets/project_proposal.js
with open('assets/project_proposal.js', 'r', encoding='utf-8') as f:
    js_text = f.read()

# Replace the export button listener and triggerProposalPrint
old_export_block = """    function triggerProposalPrint() {
        const prevTitle = document.title;
        const project = state.projectInfo || {};
        const draft = state.proposalDraft || {};
        const customMeta = getCustomMeta();
        const quoteNum = firstValue([customMeta.quoteNumber, draft.proposal_number, draft.quote_number, `PROP-${(project.id || projectId || '001')}`]);
        const docTitle = firstValue([customMeta.title, draft.estimate_name, project.name, 'Commercial Proposal']);

        // Set clean, professional document title for the browser's PDF save filename
        const cleanFileName = `Proposal_${quoteNum}_${docTitle}`.replace(/[^a-zA-Z0-9_\\-\\.]/g, '_');
        document.title = cleanFileName;

        // Ensure we are in paged mode so the PDF has proper sheets, page numbers, and running headers
        const needsRestorePaged = proposalSettings.pageMode !== 'paged';
        if (needsRestorePaged) {
            proposalSettings.pageMode = 'paged';
            renderPreview();
        }

        // Add marker class to body so print styles apply with maximal specificity
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
            if (exportType === 'pdf' || exportType === 'preview') {
                showToast('Preparing proposal for printing / PDF export...');
                triggerProposalPrint();
                return;
            }
            if (exportType === 'docx') {
                showToast('Preparing document...');
                triggerProposalPrint();
                return;
            }
        });
    });"""

new_export_block = """    function exportProposalPdf() {
        const project = state.projectInfo || {};
        const customMeta = getCustomMeta();
        const draft = state.proposalDraft || {};
        const quoteNum = firstValue([customMeta.quoteNumber, draft.proposal_number, draft.quote_number, `PROP-${(project.id || projectId || '001')}`]);
        const docTitle = firstValue([customMeta.title, draft.estimate_name, project.name, 'Commercial Proposal']);
        const cleanFileName = `Proposal_${quoteNum}_${docTitle}`.replace(/[^a-zA-Z0-9_\\-\\.]/g, '_');

        if (typeof window.html2pdf !== 'function') {
            showToast('Preparing proposal for printing / PDF export...');
            triggerProposalPrint();
            return;
        }

        const wasContinuous = proposalSettings.pageMode !== 'paged';
        if (wasContinuous) {
            proposalSettings.pageMode = 'paged';
            renderPreview();
        }

        const pagedWrap = documentNode.querySelector('.proposal-paged-wrap') || documentNode.querySelector('.proposal-document-body');
        if (!pagedWrap) {
            triggerProposalPrint();
            return;
        }

        // Show loading progress modal
        document.querySelectorAll('#proposalDownloadModal').forEach(el => el.remove());
        const modal = document.createElement('div');
        modal.id = 'proposalDownloadModal';
        modal.className = 'proposal-contact-modal-backdrop';
        modal.innerHTML = `
            <div class="proposal-contact-modal-card">
                <div class="proposal-contact-modal-spinner">
                    <i class="fas fa-circle-notch fa-spin"></i>
                </div>
                <div class="proposal-contact-modal-title">Generating PDF File</div>
                <div class="proposal-contact-modal-desc">
                    Rendering vector sheets and packaging <strong>${esc(cleanFileName)}.pdf</strong>...
                </div>
                <div class="proposal-contact-progress-bar">
                    <div class="proposal-contact-progress-fill"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const opt = {
            margin:       [0.2, 0.2, 0.2, 0.2],
            filename:     `${cleanFileName}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, logging: false },
            jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' },
            pagebreak:    { mode: ['css', 'legacy'] }
        };

        window.html2pdf().set(opt).from(pagedWrap).save().then(() => {
            modal.remove();
            showToast(`PDF downloaded: ${cleanFileName}.pdf`);
            if (wasContinuous) {
                proposalSettings.pageMode = 'continuous';
                renderPreview();
            }
        }).catch((err) => {
            modal.remove();
            console.warn('html2pdf fallback to print:', err);
            triggerProposalPrint();
        });
    }

    function exportProposalDocx() {
        const project = state.projectInfo || {};
        const customMeta = getCustomMeta();
        const draft = state.proposalDraft || {};
        const quoteNum = firstValue([customMeta.quoteNumber, draft.proposal_number, draft.quote_number, `PROP-${(project.id || projectId || '001')}`]);
        const docTitle = firstValue([customMeta.title, draft.estimate_name, project.name, 'Commercial Proposal']);
        const cleanFileName = `Proposal_${quoteNum}_${docTitle}`.replace(/[^a-zA-Z0-9_\\-\\.]/g, '_');

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

        const blob = new Blob(['\\ufeff', docContent], { type: 'application/vnd.ms-word;charset=utf-8' });
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

        const cleanFileName = `Proposal_${quoteNum}_${docTitle}`.replace(/[^a-zA-Z0-9_\\-\\.]/g, '_');
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
    });"""

assert old_export_block in js_text, "old_export_block not found in js"
js_text = js_text.replace(old_export_block, new_export_block, 1)

with open('assets/project_proposal.js', 'w', encoding='utf-8') as f:
    f.write(js_text)
print("assets/project_proposal.js updated successfully.")

# 3. Update assets/project_proposal.css (width of export menu)
with open('assets/project_proposal.css', 'r', encoding='utf-8') as f:
    css_text = f.read()

old_menu_css = """.proposal-export-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 1100;
    width: 178px;
    padding: 6px;
    display: none;
    background: var(--bg-panel, #ffffff);
    border: 1px solid var(--border-soft, #cbd5e1);
    border-radius: 9px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
}"""

new_menu_css = """.proposal-export-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 1100;
    width: 215px;
    padding: 6px;
    display: none;
    background: var(--bg-panel, #ffffff);
    border: 1px solid var(--border-soft, #cbd5e1);
    border-radius: 9px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
}"""

assert old_menu_css in css_text, "old_menu_css not found in css"
css_text = css_text.replace(old_menu_css, new_menu_css, 1)

with open('assets/project_proposal.css', 'w', encoding='utf-8') as f:
    f.write(css_text)
print("assets/project_proposal.css updated successfully.")

print("EXPORT DOWNLOAD PIPELINE COMPLETE.")

