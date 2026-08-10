const fs = require('node:fs');
const path = require('node:path');

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
expect(takeoffCss, /\.project-estimate-footer\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/, 'The footer must span the workspace.');
expect(takeoff, /data-takeoff-estimate-id/, 'Takeoff must render estimate choices.');
expect(proposal, /data-proposal-estimate-id/, 'Proposal must render estimate choices.');
expect(takeoff, /state\.activeEstimateId\s*=\s*estimateId/, 'Takeoff must persist the active estimate.');
expect(proposal, /estimating\.activeEstimateId\s*=\s*estimateId/, 'Proposal must persist the active estimate.');
expect(takeoff, /takeoff:active-estimate-changed/, 'Takeoff must publish estimate changes.');
expect(proposal, /takeoff:active-estimate-changed/, 'Proposal must react to estimate changes.');
expect(proposal, /activeEstimate\?\.groups/, 'Proposal data must come from the active estimate.');

console.log('Estimate footer integration checks passed.');
