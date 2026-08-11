const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const overview = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_overview.js'), 'utf8');

test('saving a draft project migrates every project-scoped workspace key before redirect', () => {
    assert.match(overview, /migrateDraftWorkspace\(data\.id\)[\s\S]*project_dashboard\.php\?id=/);
    for (const prefix of [
        'takeoff.projectDocuments',
        'takeoff.projectDocumentFolders',
        'takeoff.quantification',
        'takeoff.estimating.columns',
        'takeoff.proposal.settings',
        'takeoff.proposal.banner'
    ]) assert.match(overview, new RegExp(prefix.replaceAll('.', '\\.')));
});

test('Estimating draft is rebound to the new project and stale server identities are removed', () => {
    assert.match(overview, /const estimatingDraftKey = 'takeoff\.estimating\.module\.draft'/);
    assert.match(overview, /projectId: numericProjectId, revision: 0/);
    assert.match(overview, /delete migrated\.dbEstimateId/);
    assert.match(overview, /delete migrated\.estimateItemId/);
    assert.match(overview, /takeoff\.estimating\.module\.\$\{numericProjectId\}/);
    assert.match(overview, /localStorage\.removeItem\(estimatingDraftKey\)/);
});
