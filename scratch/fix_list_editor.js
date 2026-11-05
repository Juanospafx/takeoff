const fs = require('fs');

const jsPath = 'assets/project_estimating.js';
let js = fs.readFileSync(jsPath, 'utf8');

const badSnippet = `            \${allLogs.length > 20 ? \`
                <div style="text-align: center; padding: 12px 0 6px;">
                    <button type="button" class="pd-btn pd-btn-secondary pd-btn-sm" data-toggle-audit-limit style="font-size: 11.5px; border-radius: 6px; padding: 5px 12px; cursor: pointer; background: var(--bg-surface, #f8fafc); border: 1px solid var(--border, #cbd5e1); color: var(--text-main, #334155);">
                        <i class="fas fa-\${ui.showAllAudit ? 'chevron-up' : 'clock-rotate-left'}"></i> \${ui.showAllAudit ? 'Show recent only' : \`Show older activity (\${allLogs.length - 20} more)\`}
                    </button>
                </div>
            \` : ''}`;

const badSnippetNorm = badSnippet.replace(/\r\n/g, '\n');
const jsNorm = js.replace(/\r\n/g, '\n');

if (jsNorm.includes(badSnippetNorm)) {
    const updated = jsNorm.replace(badSnippetNorm, '');
    fs.writeFileSync(jsPath, updated, 'utf8');
    console.log('Successfully removed misplaced allLogs snippet from listEditor');
} else {
    console.error('Could not find badSnippet in project_estimating.js');
}

