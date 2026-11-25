const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'assets', 'project_overview.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'project_presence.php'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '20261125_project_presence.sql'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');
const migrationHarness = fs.readFileSync(path.join(root, 'harness', 'project-members-migration.php'), 'utf8');
const deployWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'utf8');

test('project presence is server-backed and does not use localStorage as its transport', () => {
    const start = client.indexOf('// Server-backed project presence');
    const end = client.indexOf("$('projectStatusButton')", start);
    const presence = client.slice(start, end);
    assert.match(presence, /project_presence\.php/);
    assert.match(presence, /fetchProjectPresence\('heartbeat'\)/);
    assert.match(presence, /setInterval\(\(\) => window\.ProjectPresence\.syncRealtime\(\), 5000\)/);
    assert.doesNotMatch(presence, /localStorage/);
    assert.match(presence, /if \(this\.syncing\) return/);
});

test('presence API authenticates, enforces project read access, and derives identity from session', () => {
    assert.match(api, /takeoff_guard_api_action/);
    assert.match(api, /'project\.read'/);
    assert.match(api, /takeoff_guard_project_access\(\$pdo, \$user, \$projectId, ProjectAccess::READ\)/);
    assert.match(api, /\$_SESSION\['display_name'\]/);
    assert.doesNotMatch(api, /\$input\['display_name'\]/);
});

test('presence rows are tab-scoped, expire, and are deduplicated per user', () => {
    assert.match(migration, /PRIMARY KEY \(`project_id`, `user_id`, `client_id`\)/);
    assert.match(api, /ON DUPLICATE KEY UPDATE/);
    assert.match(api, /INTERVAL 15 SECOND/);
    assert.match(api, /GROUP BY user_id/);
    assert.match(client, /navigator\.sendBeacon/);
    assert.match(dashboard, /\$authUser\['user_id'\]/);
});

test('production deployment creates and verifies the presence table before releasing code', () => {
    assert.match(migrationHarness, /CREATE TABLE IF NOT EXISTS project_presence/);
    assert.match(migrationHarness, /\$result\['project_presence_table'\] = true/);
    assert.match(deployWorkflow, /\.project_presence_table == true/);
});

