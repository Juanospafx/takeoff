const fs = require('fs');

const cssPath = 'assets/project_estimating.css';
let css = fs.readFileSync(cssPath, 'utf8');

// 1. Replace the legacy grid rules at .est-v2 > .est-main
const oldGridBlock = `.est-v2 > .est-main {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(680px, 1fr) minmax(350px, 410px);
    grid-template-rows: minmax(0, 1fr);
    overflow: hidden;
}
.est-v2 .est-left {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    border-right: 1px solid var(--est-line);
}
.est-v2 .est-right {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: hidden;
    background: var(--est-surface-2);
}
.est-v2 .est-right-scroll {
    min-height: 0;
    display: block;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 12px;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
}`;

const newFlexBlock = `.est-shell.est-v2 > .est-main,
.est-v2 > .est-main {
    min-height: 0;
    height: 100%;
    display: flex !important;
    flex-direction: row !important;
    align-items: stretch !important;
    overflow: hidden !important;
    position: relative;
    background: transparent !important;
    gap: 0 !important;
}
.est-v2 .est-left {
    flex: 1 1 0 !important;
    min-width: 320px !important;
    height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    position: relative;
    overflow: hidden !important;
    border-right: none !important;
}
.est-v2 .est-right {
    flex: 0 0 var(--est-right-w, 420px) !important;
    width: var(--est-right-w, 420px) !important;
    min-width: 280px !important;
    max-width: 850px !important;
    height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    position: relative;
    overflow: hidden !important;
    background: var(--bg-panel, #ffffff) !important;
}
.est-v2 .est-right-scroll {
    flex: 1 1 0 !important;
    min-height: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 12px !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    padding: 12px !important;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
}`;

// Normalize line endings for replacement
const normalize = s => s.replace(/\r\n/g, '\n');
const cssNorm = normalize(css);
const oldGridNorm = normalize(oldGridBlock);

if (cssNorm.includes(oldGridNorm)) {
    css = cssNorm.replace(oldGridNorm, normalize(newFlexBlock));
    console.log('Successfully replaced oldGridBlock with newFlexBlock');
} else {
    console.error('Could not find oldGridBlock in CSS');
}

// 2. Remove legacy dead styles block (lines 4480-4984)
const oldDeadComment = normalize(`/* ==========================================================================
   Estimating Right Sidebar (est-right) Modernization & Polish
   ========================================================================== */`);
const newModernComment = normalize(`/* ==========================================================================
   EST-RIGHT SCOPED OVERHAUL (Summary, Notes & Audit Panels)`);

const startDeadIdx = css.indexOf(oldDeadComment);
const endDeadIdx = css.indexOf(newModernComment);

if (startDeadIdx !== -1 && endDeadIdx !== -1 && endDeadIdx > startDeadIdx) {
    css = css.slice(0, startDeadIdx) + css.slice(endDeadIdx);
    console.log('Successfully removed old legacy CSS block between line 4480 and 4984');
} else {
    console.error('Could not locate start/end of legacy CSS block', startDeadIdx, endDeadIdx);
}

// 3. Make sure .est-sidebar-resizer and resizing styles are crisp
const resizerRules = `
.est-sidebar-resizer {
    width: 12px !important;
    min-width: 12px !important;
    max-width: 12px !important;
    height: 100% !important;
    margin: 0 !important;
    cursor: col-resize !important;
    position: relative;
    z-index: 30;
    flex: 0 0 12px !important;
    user-select: none;
    display: flex !important;
    align-items: center;
    justify-content: center;
    background: transparent !important;
}
.est-main.is-resizing,
.est-main.is-resizing * {
    user-select: none !important;
    -webkit-user-select: none !important;
}
.est-main.is-resizing .est-right,
.est-sidebar-resizer.is-dragging ~ .est-right {
    transition: none !important;
}
`;

css += resizerRules;

fs.writeFileSync(cssPath, css, 'utf8');
console.log('project_estimating.css updated successfully');

