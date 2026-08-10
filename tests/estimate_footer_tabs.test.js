const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const page = read('pages/project_dashboard.php');
const takeoff = read('assets/project_takeoff.js');
const proposal = read('assets/project_proposal.js');
const takeoffCss = read('assets/project_takeoff.css');

function expect(source, pattern, message) {
    if (!pattern.test(source)) throw new Error(message);
}

expect(page, /id="takeoffEstimateTypesFooter"/, 'Takeoff must expose an estimate footer.');
expect(page, /id="proposalEstimateTypesFooter"/, 'Proposal must expose an estimate footer.');
expect(page, /id="takeoffEstimateTypesFooter"[\s\S]*?Loading estimates/, 'Takeoff footer must have a no-JS fallback.');
expect(page, /id="proposalEstimateTypesFooter"[\s\S]*?Loading estimates/, 'Proposal footer must have a no-JS fallback.');
expect(takeoffCss, /\.project-estimate-footer\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/, 'The footer must span the workspace.');
expect(takeoff, /data-takeoff-estimate-id/, 'Takeoff must render estimate choices.');
expect(proposal, /data-proposal-estimate-id/, 'Proposal must render estimate choices.');
expect(takeoff, /state\.activeEstimateId\s*=\s*estimateId/, 'Takeoff must persist the active estimate.');
expect(proposal, /estimating\.activeEstimateId\s*=\s*estimateId/, 'Proposal must persist the active estimate.');
expect(takeoff, /takeoff:active-estimate-changed/, 'Takeoff must publish estimate changes.');
expect(proposal, /takeoff:active-estimate-changed/, 'Proposal must react to estimate changes.');
expect(takeoff, /takeoff:estimating-state-updated/, 'Takeoff must react after asynchronous estimating load.');
expect(proposal, /takeoff:estimating-state-updated/, 'Proposal must react after asynchronous estimating load.');
expect(proposal, /activeEstimate\?\.groups/, 'Proposal data must come from the active estimate.');

const dom = new JSDOM('<!doctype html><div id="takeoffWorkspace"><footer id="takeoffEstimateTypesFooter"></footer></div>', {
    url: 'https://takeoff.test/project/2',
    runScripts: 'outside-only',
    pretendToBeVisual: true
});
dom.window.ProjectState = { projectId: 2, documents: [], takeoffState: { groups: [] } };
dom.window.requestAnimationFrame = callback => callback(Date.now());
dom.window.localStorage.setItem('takeoff.estimating.module.2', JSON.stringify({
    groups: [],
    activeEstimateId: 'alternate',
    estimates: [
        { id: 'primary', name: 'Primary Estimate', status: 'Draft', groups: [] },
        { id: 'alternate', name: 'Lighting Alternate', status: 'Ready', groups: [] }
    ]
}));
dom.window.eval(takeoff);
dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
const renderedFooter = dom.window.document.getElementById('takeoffEstimateTypesFooter');
if (!renderedFooter.textContent.includes('Primary Estimate') || !renderedFooter.textContent.includes('Lighting Alternate')) {
    throw new Error('Takeoff footer must render visible estimate names from storage.');
}
const activeButton = renderedFooter.querySelector('[data-takeoff-estimate-id="alternate"]');
if (!activeButton?.classList.contains('is-active') || activeButton.getAttribute('aria-pressed') !== 'true') {
    throw new Error('Takeoff footer must visibly identify the active estimate.');
}
renderedFooter.querySelector('[data-takeoff-estimate-id="primary"]').click();
const savedState = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.2'));
if (savedState.activeEstimateId !== 'primary' || !renderedFooter.querySelector('[data-takeoff-estimate-id="primary"]')?.classList.contains('is-active')) {
    throw new Error('Clicking a visible footer option must persist and display the new active estimate.');
}
dom.window.close();

console.log('Estimate footer integration checks passed.');
