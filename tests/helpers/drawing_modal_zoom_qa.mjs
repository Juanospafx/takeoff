import fs from 'node:fs/promises';

const port = Number(process.env.TAKEOFF_EDGE_DEBUG_PORT || 9333);
const baseUrl = `http://127.0.0.1:${port}`;
const pages = await (await fetch(`${baseUrl}/json/list`)).json();
if (!pages[0]?.webSocketDebuggerUrl) throw new Error('No Edge DevTools page is available.');

const socket = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
});

function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
}

const css = await fs.readFile(new URL('../../assets/project_takeoff.css', import.meta.url), 'utf8');
const html = `<!doctype html><html style="height:100%"><head><meta charset="utf-8"><style>${css}</style></head>
<body style="margin:0;height:100%"><section id="tab-takeoff" style="display:block;width:100vw;height:100vh">
<div class="takeoff-workspace pro-takeoff-workspace" id="takeoffWorkspace">
<aside class="pro-takeoff-items"></aside><div class="pro-sidebar-resizer"></div><aside class="pro-layer-drawer" hidden></aside>
<section class="pro-takeoff-viewer"><div class="pro-drawing-modal-overlay open" aria-hidden="false">
<div class="pro-drawing-dropdown open" id="takeoffDrawingDropdown">
<div class="pro-drawing-dropdown-head"><strong>Drawings &amp; Sheets</strong><button>×</button></div>
<div class="pro-drawing-search"><div class="pro-drawing-search-wrap"><input></div></div>
<div class="pro-drawing-grid">
<div class="pro-drawing-col"><div class="pro-drawing-col-title">Directory</div><div class="pro-drawing-list"></div></div>
<div class="pro-drawing-col"><div class="pro-drawing-col-title">Sheets</div><div class="pro-drawing-list"></div></div>
<div class="pro-drawing-preview"><div class="pro-drawing-col-title">Preview</div><div class="pro-preview-container">
<div class="pro-preview-box"><canvas width="200" height="120"></canvas></div>
<div class="pro-preview-details"><div class="pro-preview-sheet-header"><h4>Sheet</h4></div>
<section class="pro-preview-takeoff-section"></section><button id="takeoffOpenSheetBtn" class="pro-open-sheet-btn">Open Sheet</button></div>
</div></div></div></div></div></section></div></section></body></html>`;

await cdp('Page.enable');
await cdp('Runtime.enable');
const frameTree = await cdp('Page.getFrameTree');
await cdp('Page.setDocumentContent', { frameId: frameTree.frameTree.frame.id, html });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
    return result.result.value;
};

const zoomLevels = [67, 75, 80, 90, 100, 110, 125, 150];
const results = [];
for (const zoom of zoomLevels) {
    const scale = zoom / 100;
    await cdp('Emulation.setDeviceMetricsOverride', {
        width: Math.round(1440 / scale),
        height: Math.round(900 / scale),
        deviceScaleFactor: scale,
        mobile: false
    });
    await sleep(80);
    const states = [];
    for (const collapsed of [false, true]) {
        await evaluate(`(() => { document.getElementById('takeoffWorkspace').classList.toggle('items-collapsed', ${collapsed}); })()`);
        await sleep(320);
        states.push(await evaluate(`(() => {
            const rect = selector => {
                const value = document.querySelector(selector).getBoundingClientRect();
                return { left: value.left, top: value.top, right: value.right, bottom: value.bottom,
                    width: value.width, height: value.height };
            };
            const viewer = rect('.pro-takeoff-viewer');
            const overlay = rect('.pro-drawing-modal-overlay');
            const panel = rect('.pro-drawing-dropdown');
            const button = rect('#takeoffOpenSheetBtn');
            const grid = getComputedStyle(document.querySelector('.pro-drawing-grid')).gridTemplateColumns.split(' ').filter(Boolean);
            return {
                viewer, overlay, panel, button, columns: grid.length,
                centerDeltaX: Math.abs((panel.left + panel.width / 2) - (overlay.left + overlay.width / 2)),
                centerDeltaY: Math.abs((panel.top + panel.height / 2) - (overlay.top + overlay.height / 2)),
                contained: panel.left >= overlay.left - 1 && panel.top >= overlay.top - 1
                    && panel.right <= overlay.right + 1 && panel.bottom <= overlay.bottom + 1,
                overlayContained: overlay.left >= viewer.left - 2 && overlay.top >= viewer.top - 2
                    && overlay.right <= viewer.right + 2 && overlay.bottom <= viewer.bottom + 2,
                buttonVisible: button.width > 0 && button.height > 0
                    && button.left >= panel.left && button.right <= panel.right
                    && button.top >= panel.top && button.bottom <= panel.bottom
            };
        })()`));
    }
    const failed = states.some(state => !Number.isFinite(state.panel.width) || !Number.isFinite(state.panel.height)
        || state.panel.width <= 0 || state.panel.height <= 0
        || state.centerDeltaX > 1 || state.centerDeltaY > 1
        || !state.contained || !state.overlayContained || !state.buttonVisible || state.columns !== 3);
    results.push({ zoom, pass: !failed, expanded: states[0], sidebarCollapsed: states[1] });
}

const internalZoom = await evaluate(`(() => {
    const panel = document.querySelector('.pro-drawing-dropdown');
    const before = panel.getBoundingClientRect();
    document.querySelector('.pro-preview-box canvas').style.transform = 'scale(2)';
    const after = panel.getBoundingClientRect();
    return { unchanged: before.left === after.left && before.top === after.top && before.width === after.width && before.height === after.height };
})()`);

socket.close();
console.log(JSON.stringify(results.map(result => ({
    zoom: result.zoom,
    pass: result.pass,
    expandedCenterDelta: [result.expanded.centerDeltaX, result.expanded.centerDeltaY],
    collapsedCenterDelta: [result.sidebarCollapsed.centerDeltaX, result.sidebarCollapsed.centerDeltaY],
    panel: [result.expanded.panel.width, result.expanded.panel.height],
    buttonVisible: result.expanded.buttonVisible && result.sidebarCollapsed.buttonVisible
})), null, 2));

if (results.some(result => !result.pass) || !internalZoom.unchanged) process.exitCode = 1;
