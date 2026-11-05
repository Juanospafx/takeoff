const fs = require('fs');

const jsPath = 'assets/project_estimating.js';
let js = fs.readFileSync(jsPath, 'utf8');

// 1. Fix saving text
js = js.replace(/ui\.message = 'Saving[^']*';/g, "ui.message = 'Saving...';");
js = js.replace(/showSaveProgressModal\(1, 'Saving Estimating workspace[^']*'\);/g, "showSaveProgressModal(1, 'Saving Estimating workspace...');");

// 2. Fix audit date bullet and add toggle button if allLogs.length > 20
const oldFormatDate = `return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ? ' +`;
const newFormatDate = `return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' • ' +`;
if (js.includes(oldFormatDate)) {
    js = js.replace(oldFormatDate, newFormatDate);
} else {
    // regex replace
    js = js.replace(/toLocaleDateString\('en-US',[^)]+\)\s*\+\s*'[^']*'\s*\+\s*d\.toLocaleTimeString/g,
        "toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' • ' + d.toLocaleTimeString");
}

// Add toggle button to auditHtml
const oldAuditEnd = `                    \`}
                </div>
            </div>
        \`;
    }`;

const newAuditEnd = `                    \`}
                </div>
                \${allLogs.length > 20 ? \`
                <div class="est-audit-footer" style="padding-top: 10px; text-align: center; border-top: 1px solid var(--border, #e2e8f0); margin-top: 8px;">
                    <button type="button" class="est-small-btn" data-toggle-audit-limit style="font-size: 11px; padding: 4px 12px; cursor: pointer; border-radius: 4px; background: var(--bg-surface, #f1f5f9); border: 1px solid var(--border, #cbd5e1); color: var(--text-main, #334155);">
                        <i class="fas \${ui.showAllAudit ? 'fa-chevron-up' : 'fa-chevron-down'}"></i> \${ui.showAllAudit ? 'Show less (recent 20)' : \`Show all (\${allLogs.length} events)\`}
                    </button>
                </div>\` : ''}
            </div>
        \`;
    }`;

if (js.includes(oldAuditEnd)) {
    js = js.replace(oldAuditEnd, newAuditEnd);
    console.log('Replaced auditEnd');
} else {
    console.log('oldAuditEnd not matched directly, checking with normalized line endings');
    // Normalize and replace
    const normalizedOld = oldAuditEnd.replace(/\r\n/g, '\n');
    const parts = js.split('function auditHtml(estimate)');
    if (parts.length > 1) {
        const auditPart = parts[1];
        const timelineIdx = auditPart.indexOf('</div>\n            </div>\n        `;');
        const timelineIdxCRLF = auditPart.indexOf('</div>\r\n            </div>\r\n        `;');
        const matchIdx = timelineIdx !== -1 ? timelineIdx : timelineIdxCRLF;
        if (matchIdx !== -1) {
            const auditSnippet = auditPart.slice(0, matchIdx);
            const remaining = auditPart.slice(matchIdx);
            const replacement = remaining.replace(/<\/div>(\r?\n)\s*<\/div>(\r?\n)\s*`;(\r?\n)\s*}/,
`</div>$1                \${allLogs.length > 20 ? \`$1                <div class="est-audit-footer" style="padding-top: 10px; text-align: center; border-top: 1px solid var(--border, #e2e8f0); margin-top: 8px;">$1                    <button type="button" class="est-small-btn" data-toggle-audit-limit style="font-size: 11px; padding: 4px 12px; cursor: pointer; border-radius: 4px; background: var(--bg-surface, #f1f5f9); border: 1px solid var(--border, #cbd5e1); color: var(--text-main, #334155);">$1                        <i class="fas \${ui.showAllAudit ? 'fa-chevron-up' : 'fa-chevron-down'}"></i> \${ui.showAllAudit ? 'Show less (recent 20)' : \`Show all (\${allLogs.length} events)\`}$1                    </button>$1                </div>\` : ''}$1            </div>$1        \`;$1    }`);
            parts[1] = auditSnippet + replacement;
            js = parts.join('function auditHtml(estimate)');
            console.log('Replaced audit toggle button via auditPart split');
        }
    }
}

// 3. Update initEstimatingResizer
const newResizerFn = `function initEstimatingResizer() {
        const resizer = $('estSplitResizer');
        const estRight = root.querySelector('.est-right');
        const estMain = root.querySelector('.est-main');
        const toolbarToggle = $('estToolbarToggleRight');
        if (!resizer || !estRight) return;

        try {
            const saved = localStorage.getItem('takeoff.estimatingRightWidth');
            if (saved) {
                const parsed = parseInt(saved, 10);
                if (parsed >= 260 && parsed <= 850) {
                    estRight.style.setProperty('--est-right-w', \`\${parsed}px\`);
                    estRight.style.width = \`\${parsed}px\`;
                    estRight.style.flexBasis = \`\${parsed}px\`;
                }
            }
            const savedCollapsed = localStorage.getItem('takeoff.estimatingRightCollapsed');
            if (savedCollapsed === '1') {
                toggleEstimatingRight(true);
            }
        } catch (_) {}

        toolbarToggle?.addEventListener('click', e => {
            e.stopPropagation();
            toggleEstimatingRight();
        });

        let isDragging = false;
        let startX = 0;
        let startWidth = 0;

        const onPointerDown = e => {
            if (estMain?.classList.contains('details-collapsed')) return;

            isDragging = true;
            startX = e.clientX;
            const currentComputed = parseInt(getComputedStyle(estRight).width, 10) || 420;
            startWidth = currentComputed;
            resizer.classList.add('is-dragging');
            estMain?.classList.add('is-resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
        };

        const onPointerMove = e => {
            if (!isDragging) return;
            const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            const deltaX = (e.clientX - startX) / zoom;
            const newWidth = Math.max(260, Math.min(850, Math.round(startWidth - deltaX)));
            estRight.style.setProperty('--est-right-w', \`\${newWidth}px\`);
            estRight.style.width = \`\${newWidth}px\`;
            estRight.style.flexBasis = \`\${newWidth}px\`;
        };

        const stopDragging = e => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('is-dragging');
            estMain?.classList.remove('is-resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try {
                if (e?.pointerId) resizer.releasePointerCapture(e.pointerId);
            } catch (_) {}

            const finalWidth = parseInt(getComputedStyle(estRight).width, 10) || 420;
            try {
                localStorage.setItem('takeoff.estimatingRightWidth', finalWidth);
            } catch (_) {}
        };

        resizer.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', stopDragging);
        window.addEventListener('pointercancel', stopDragging);
    }`;

const oldResizerStart = 'function initEstimatingResizer() {';
const oldResizerEnd = 'resizer.addEventListener(\'pointercancel\', stopDragging);\r\n    }';
const oldResizerEndLF = 'resizer.addEventListener(\'pointercancel\', stopDragging);\n    }';

const rStart = js.indexOf(oldResizerStart);
let rEnd = js.indexOf(oldResizerEnd, rStart);
let rEndLen = oldResizerEnd.length;
if (rEnd === -1) {
    rEnd = js.indexOf(oldResizerEndLF, rStart);
    rEndLen = oldResizerEndLF.length;
}

if (rStart !== -1 && rEnd !== -1) {
    js = js.slice(0, rStart) + newResizerFn + js.slice(rEnd + rEndLen);
    console.log('Replaced initEstimatingResizer');
} else {
    console.error('Could not locate old initEstimatingResizer block', rStart, rEnd);
}

fs.writeFileSync(jsPath, js, 'utf8');
console.log('assets/project_estimating.js updated successfully');

