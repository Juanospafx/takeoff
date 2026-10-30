const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectApi = fs.readFileSync(path.join(__dirname, '..', 'api', 'project_module.php'), 'utf8');

assert.match(projectApi, /SELECT \* FROM estimate_items WHERE estimate_id IN \(\$inClause\)/,
    'estimate items are selected by estimate ownership, not an optional project_id column');
assert.match(projectApi, /SELECT \* FROM estimate_workspace_states WHERE estimate_id IN \(\$inClause\)/,
    'lossless workspace snapshots are copied with their estimates');
assert.match(projectApi, /\$decoded\['dbEstimateId'\] = \$newEstId/,
    'copied snapshots receive the cloned database estimate identity');
assert.match(projectApi, /\$decoded\['projectId'\] = \$newId/,
    'copied snapshots receive the cloned project identity');

assert.doesNotMatch(projectApi, /preserve Summary settings from the latest project using that template/,
    'creating a project never imports notes or settings from an unrelated project');
assert.doesNotMatch(projectApi, /ORDER BY ews\.updated_at DESC[\s\S]{0,300}LIMIT 1/,
    'project creation has no cross-project latest-estimate lookup');

console.log('project clone estimating contract passed');
