const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const overview = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_overview.js'), 'utf8');

test('saving a draft project persists its Estimating workspace before redirect', () => {
    assert.match(overview, /const projectId = savedProjectId\(result\)[\s\S]*projectEstimatingPersistDraft\(projectId\)[\s\S]*migrateDraftWorkspace\(projectId, \{ estimatingPersisted: true \}\)[\s\S]*project_dashboard\.php\?id=/);
    for (const prefix of [
        'takeoff.projectDocuments',
        'takeoff.projectDocumentFolders',
        'takeoff.quantification',
        'takeoff.estimating.columns',
        'takeoff.proposal.settings',
        'takeoff.proposal.banner'
    ]) assert.match(overview, new RegExp(prefix.replaceAll('.', '\\.')));
    assert.match(overview, /takeoff_project_groups_0/);
    assert.match(overview, /takeoff_project_groups_\$\{numericProjectId\}/);
});

test('save lifecycle validates HTTP, application status and a positive project id before committing the draft', () => {
    assert.match(overview, /if \(!response\.ok \|\| data\?\.status !== 'success'\)/);
    assert.match(overview, /Number\.isSafeInteger\(id\) && id > 0/);
    assert.match(overview, /if \(!projectId\) throw new Error\('The project was saved without a valid project ID\.'\)/);
    assert.match(overview, /const result = await request\('save', savePayload\)[\s\S]*if \(!projectId\)[\s\S]*localStorage\.removeItem\('takeoff\.projectDraft'\)/);
    assert.match(overview, /saveButton\.disabled = true[\s\S]*finally[\s\S]*saveButton\.disabled = false/);
});

test('project save API exposes one stable id and project contract while retaining legacy fields', () => {
    const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'project_module.php'), 'utf8');
    assert.match(api, /'id' => \$id,[\s\S]*'project_id' => \$id,[\s\S]*'project' => \$payload\['project'\],[\s\S]*'data' => \$payload/);
    assert.match(api, /Project could not be loaded after saving/);
});

test('Estimating draft is rebound to the new project and stale server identities are removed', () => {
    const estimating = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_estimating.js'), 'utf8');
    assert.match(estimating, /window\.projectEstimatingPersistDraft = async function \(targetProjectId\)/);
    assert.match(estimating, /action=create&project_id=/);
    assert.match(estimating, /delete estimate\.dbEstimateId/);
    assert.match(estimating, /if \(!response\.ok \|\| !result\?\.success\)/);
    assert.match(overview, /const estimatingDraftKey = 'takeoff\.estimating\.module\.draft'/);
    assert.match(overview, /projectId: numericProjectId, revision: 0/);
    assert.match(overview, /workspace\.pendingProjectCreationSync = true/);
    assert.match(overview, /delete migrated\.dbEstimateId/);
    assert.match(overview, /delete migrated\.estimateItemId/);
    assert.match(overview, /takeoff\.estimating\.module\.\$\{numericProjectId\}/);
    assert.match(overview, /localStorage\.removeItem\(estimatingDraftKey\)/);
});

test('coordinated project save is fail-closed for module and document persistence', () => {
    assert.doesNotMatch(overview, /Takeoff iframe save ignored or unavailable/);
    assert.doesNotMatch(overview, /Takeoff state save warning/);
    assert.doesNotMatch(overview, /Estimating save error/);
    assert.match(overview, /if \(uploadResult\.failed\) throw new Error/);
    assert.match(overview, /isDirty = false[\s\S]*All changes to/);
});

test('migration refreshes identity timestamps and repairs an invalid active estimate', () => {
    assert.match(overview, /updatedAt: migratedAt/);
    assert.match(overview, /workspace\.clientUiUpdatedAt = migratedAt/);
    assert.match(overview, /migratedIds\.has/);
    assert.match(overview, /workspace\.activeEstimateId = workspace\.estimates\[0\]\?\.id \|\| null/);
});
