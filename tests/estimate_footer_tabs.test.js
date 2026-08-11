const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const page = read('pages/project_dashboard.php');
const takeoff = read('assets/project_takeoff.js');
const proposal = read('assets/project_proposal.js');
const estimating = read('assets/project_estimating.js');
const sharedFooter = read('assets/project_estimate_footer.js');
const calculation = read('assets/estimate_calculation_service.js');
const workspace = read('assets/estimating_workspace_service.js');
const takeoffCss = read('assets/project_takeoff.css');
const estimatingCss = read('assets/project_estimating.css');

function expect(source, pattern, message) {
    if (!pattern.test(source)) throw new Error(message);
}

expect(page, /id="takeoffEstimateTypesFooter"/, 'Takeoff must expose an estimate footer.');
expect(page, /id="proposalEstimateTypesFooter"/, 'Proposal must expose an estimate footer.');
expect(page, /id="takeoffEstimateTypesFooter"[\s\S]*?Loading estimates/, 'Takeoff footer must have a no-JS fallback.');
expect(page, /id="proposalEstimateTypesFooter"[\s\S]*?Loading estimates/, 'Proposal footer must have a no-JS fallback.');
expect(page, /class="est-version-bar" id="takeoffEstimateTypesFooter"/, 'Takeoff must reuse the Estimating footer design.');
expect(page, /class="est-version-bar" id="proposalEstimateTypesFooter"/, 'Proposal must reuse the Estimating footer design.');
expect(estimatingCss, /\.est-version-bar\s*\{[\s\S]*?--est-surface:\s*#ffffff;[\s\S]*?--est-primary-border:/, 'Shared footer must own its visual tokens outside Estimating.');
expect(estimatingCss, /\[data-theme="dark"\]\s+\.est-version-bar\s*\{[\s\S]*?--est-surface:/, 'Shared footer must preserve Estimating parity in dark mode.');
expect(takeoff, /data-takeoff-estimate-id/, 'Takeoff must render estimate choices.');
expect(proposal, /data-proposal-estimate-id/, 'Proposal must render estimate choices.');
expect(takeoff, /state\.activeEstimateId\s*=\s*estimateId/, 'Takeoff must persist the active estimate.');
expect(proposal, /estimating\.activeEstimateId\s*=\s*estimateId/, 'Proposal must persist the active estimate.');
expect(takeoff, /takeoff:active-estimate-changed/, 'Takeoff must publish estimate changes.');
expect(proposal, /takeoff:active-estimate-changed/, 'Proposal must react to estimate changes.');
expect(takeoff, /takeoff:estimating-state-updated/, 'Takeoff must react after asynchronous estimating load.');
expect(proposal, /takeoff:estimating-state-updated/, 'Proposal must react after asynchronous estimating load.');
expect(sharedFooter, /actionAttribute[\s\S]*new-estimate/, 'The shared footer must expose New estimate.');
expect(sharedFooter, /actionAttribute[\s\S]*compare-estimates/, 'The shared footer must expose Compare.');
expect(takeoff, /actionAttribute:\s*'data-takeoff-estimating-action'/, 'Takeoff must connect shared footer actions.');
expect(proposal, /actionAttribute:\s*'data-proposal-estimating-action'/, 'Proposal must connect shared footer actions.');
expect(takeoff, /sourceTab:\s*'takeoff'/, 'Takeoff footer actions must identify their originating tab.');
expect(proposal, /sourceTab:\s*'proposal'/, 'Proposal footer actions must identify their originating tab.');
expect(estimating, /data-estimating-modal-portal/, 'Estimating must portal shared modals over the active workspace tab.');
expect(estimating, /portal\.querySelector\('#copyEstimateName'\)/, 'Estimate creation must read values from the shared modal portal.');
if (/estimating-action-requested[\s\S]{0,500}data-tab="estimating"/.test(estimating)) {
    throw new Error('Footer estimating actions must not change the active workspace tab.');
}
expect(proposal, /activeEstimate\?\.groups/, 'Proposal data must come from the active estimate.');
expect(estimating, /takeoff:active-estimate-changed[\s\S]*selectEstimate\(event\.detail\?\.estimateId\)/, 'Estimating must consume external active-estimate changes.');
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
dom.window.eval(sharedFooter);
dom.window.eval(takeoff);
dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
const renderedFooter = dom.window.document.getElementById('takeoffEstimateTypesFooter');
if (!renderedFooter.textContent.includes('Primary Estimate') || !renderedFooter.textContent.includes('Lighting Alternate')) {
    throw new Error('Takeoff footer must render visible estimate names from storage.');
}
const activeButton = renderedFooter.querySelector('[data-takeoff-estimate-id="alternate"]');
if (!activeButton?.classList.contains('active') || activeButton.getAttribute('aria-pressed') !== 'true') {
    throw new Error('Takeoff footer must visibly identify the active estimate.');
}
renderedFooter.querySelector('[data-takeoff-estimate-id="primary"]').click();
const savedState = JSON.parse(dom.window.localStorage.getItem('takeoff.estimating.module.2'));
if (savedState.activeEstimateId !== 'primary' || !renderedFooter.querySelector('[data-takeoff-estimate-id="primary"]')?.classList.contains('active')) {
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

const estimatingDom = new JSDOM(`<!doctype html>
    <button data-tab="takeoff" class="active">Takeoff</button>
    <button data-tab="estimating">Estimating</button>
    <button data-tab="proposal">Proposal</button>
    <div id="estimatingModule" data-project-id="0"></div>`, {
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
estimatingDom.window.eval(sharedFooter);
estimatingDom.window.eval(workspace);
estimatingDom.window.eval(estimating);
let estimatingTabClicks = 0;
estimatingDom.window.document.querySelector('[data-tab="estimating"]').addEventListener('click', () => { estimatingTabClicks += 1; });
estimatingDom.window.dispatchEvent(new estimatingDom.window.CustomEvent('takeoff:active-estimate-changed', {
    detail: { projectId: '', estimateId: 'alternate' }
}));
let estimatingState = JSON.parse(estimatingDom.window.localStorage.getItem('takeoff.estimating.module.draft'));
if (estimatingState.activeEstimateId !== 'alternate' || estimatingDom.window.document.querySelector('[data-version="alternate"]')?.classList.contains('active') !== true) {
    throw new Error('Estimating must update its in-memory UI and storage after a footer selection.');
}
let catalogEvent = null;
estimatingDom.window.addEventListener('takeoff:estimating-state-updated', event => { catalogEvent = event.detail; });
estimatingDom.window.dispatchEvent(new estimatingDom.window.CustomEvent('takeoff:estimating-action-requested', {
    detail: { action: 'new-estimate', sourceTab: 'takeoff' }
}));
if (estimatingTabClicks !== 0 || !estimatingDom.window.document.querySelector('[data-tab="takeoff"]').classList.contains('active')) {
    throw new Error('New estimate from Takeoff must not activate or navigate to the Estimating tab.');
}
const createPortal = estimatingDom.window.document.querySelector('[data-estimating-modal-portal]');
const createDialog = createPortal?.querySelector('[role="dialog"][aria-labelledby="copyEstimateTitle"]');
const createName = createPortal?.querySelector('#copyEstimateName');
const createModes = [...(createPortal?.querySelectorAll('input[name="copyEstimateMode"]') || [])].map(input => input.value);
if (!createDialog || !createName || !['all', 'structure', 'blank'].every(mode => createModes.includes(mode))) {
    throw new Error('New estimate must open a visible global dialog with a name and all copy modes.');
}
createName.value = 'New Bid Option';
createPortal.querySelector('input[name="copyEstimateMode"][value="blank"]').checked = true;
createPortal.querySelector('[data-est-action="create-estimate-copy"]').click();
estimatingState = JSON.parse(estimatingDom.window.localStorage.getItem('takeoff.estimating.module.draft'));
const createdEstimate = estimatingState.estimates.find(estimate => estimate.name === 'New Bid Option');
if (!createdEstimate || createdEstimate.groups.length !== 0 || !catalogEvent?.estimates?.some(estimate => estimate.name === 'New Bid Option')) {
    throw new Error('Confirming New estimate must honor the selected mode, persist it, and publish the updated catalog.');
}
if (!estimatingDom.window.document.querySelector('.est-version-bar')?.textContent.includes('New Bid Option')) {
    throw new Error('A newly created estimate must immediately appear in the estimate footer.');
}

estimatingDom.window.dispatchEvent(new estimatingDom.window.CustomEvent('takeoff:estimating-action-requested', {
    detail: { action: 'compare-estimates', sourceTab: 'takeoff' }
}));
if (estimatingTabClicks !== 0 || !estimatingDom.window.document.querySelector('[data-estimating-modal-portal]')?.textContent.includes('Compare Estimates')) {
    throw new Error('Compare from Takeoff must open globally without navigating to Estimating.');
}
estimatingDom.window.document.querySelector('[data-modal-close="compareOpen"]')?.click();
if (estimatingDom.window.document.querySelector('[data-estimating-modal-portal]')) {
    throw new Error('Closing a portaled comparison must remove the global modal and update Estimating state.');
}
estimatingDom.window.document.querySelector('[data-tab="takeoff"]').classList.remove('active');
estimatingDom.window.document.querySelector('[data-tab="proposal"]').classList.add('active');
estimatingDom.window.dispatchEvent(new estimatingDom.window.CustomEvent('takeoff:estimating-action-requested', {
    detail: { action: 'compare-estimates', sourceTab: 'proposal' }
}));
if (estimatingTabClicks !== 0 || !estimatingDom.window.document.querySelector('[data-tab="proposal"]').classList.contains('active') || !estimatingDom.window.document.querySelector('[data-estimating-modal-portal]')?.textContent.includes('Compare Estimates')) {
    throw new Error('Compare from Proposal must keep Proposal active and show the comparison dialog.');
}
const proposalPortal = estimatingDom.window.document.querySelector('[data-estimating-modal-portal]');
proposalPortal.querySelector('button').dispatchEvent(new estimatingDom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
if (estimatingDom.window.document.querySelector('[data-estimating-modal-portal]')) throw new Error('Escape must close a global estimating modal.');
estimatingDom.window.close();

console.log('Estimate footer integration checks passed.');
