const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const page = read('pages/project_dashboard.php');
const takeoff = read('assets/project_takeoff.js');
const proposal = read('assets/project_proposal.js');
const estimating = read('assets/project_estimating.js');
const calculation = read('assets/estimate_calculation_service.js');
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
expect(takeoff, /data-takeoff-estimating-action="new-estimate"/, 'Takeoff must expose New estimate in its footer.');
expect(takeoff, /data-takeoff-estimating-action="compare-estimates"/, 'Takeoff must expose Compare in its footer.');
expect(proposal, /data-proposal-estimating-action="new-estimate"/, 'Proposal must expose New estimate in its footer.');
expect(proposal, /data-proposal-estimating-action="compare-estimates"/, 'Proposal must expose Compare in its footer.');
expect(proposal, /activeEstimate\?\.groups/, 'Proposal data must come from the active estimate.');
expect(estimating, /takeoff:active-estimate-changed[\s\S]*selectEstimate\(detail\.estimateId\)/, 'Estimating must consume external active-estimate changes.');
expect(estimating, /takeoff:estimating-state-updated[\s\S]*estimates:\s*state\.estimates\.map/, 'Estimating must publish its estimate catalog.');

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
let requestedAction = '';
dom.window.addEventListener('takeoff:estimating-action-requested', event => { requestedAction = event.detail.action; });
renderedFooter.querySelector('[data-takeoff-estimating-action="new-estimate"]')?.click();
if (requestedAction !== 'new-estimate') throw new Error('Footer actions must delegate to the Estimating module.');
const updatedState = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.2'));
updatedState.estimates.push({ id: 'change_order', name: 'Change Order', status: 'Draft', groups: [] });
dom.window.localStorage.setItem('takeoff.estimating.module.2', JSON.stringify(updatedState));
dom.window.dispatchEvent(new dom.window.CustomEvent('takeoff:estimating-state-updated', { detail: { projectId: '2' } }));
if (!renderedFooter.textContent.includes('Change Order')) throw new Error('Takeoff footer must display estimates created in Estimating without a reload.');
dom.window.close();

const estimatingDom = new JSDOM('<!doctype html><div id="estimatingModule" data-project-id="0"></div>', {
    url: 'https://takeoff.test/project/draft', runScripts: 'outside-only', pretendToBeVisual: true
});
estimatingDom.window.ProjectState = { projectId: 0, estimateItems: [], projectMeta: {}, projectInfo: { name: 'Contract test' } };
estimatingDom.window.localStorage.setItem('takeoff.estimating.module.draft', JSON.stringify({
    activeEstimateId: 'primary',
    estimates: [
        { id: 'primary', name: 'Primary Estimate', status: 'draft', groups: [] },
        { id: 'alternate', name: 'Alternate Estimate', status: 'draft', groups: [] }
    ]
}));
estimatingDom.window.eval(calculation);
estimatingDom.window.eval(estimating);
estimatingDom.window.dispatchEvent(new estimatingDom.window.CustomEvent('takeoff:active-estimate-changed', {
    detail: { projectId: '', estimateId: 'alternate' }
}));
let estimatingState = JSON.parse(estimatingDom.window.localStorage.getItem('takeoff.estimating.module.draft'));
if (estimatingState.activeEstimateId !== 'alternate' || estimatingDom.window.document.querySelector('[data-version="alternate"]')?.classList.contains('active') !== true) {
    throw new Error('Estimating must update its in-memory UI and storage after a footer selection.');
}
let catalogEvent = null;
estimatingDom.window.addEventListener('takeoff:estimating-state-updated', event => { catalogEvent = event.detail; });
estimatingDom.window.document.querySelector('[data-est-action="new-estimate"]').click();
estimatingDom.window.document.getElementById('copyEstimateName').value = 'New Bid Option';
estimatingDom.window.document.querySelector('[data-est-action="create-estimate-copy"]').click();
estimatingState = JSON.parse(estimatingDom.window.localStorage.getItem('takeoff.estimating.module.draft'));
if (!estimatingState.estimates.some(estimate => estimate.name === 'New Bid Option') || !catalogEvent?.estimates?.some(estimate => estimate.name === 'New Bid Option')) {
    throw new Error('Creating an estimate must persist it and publish the updated catalog.');
}
estimatingDom.window.close();

console.log('Estimate footer integration checks passed.');
