const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'project_estimating.php'), 'utf8');
const takeoff = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '2026-08-11_estimating_workspace_repair.sql'), 'utf8');

test('Estimating repairs additive legacy columns before loading or saving workspace data', () => {
    assert.match(api, /function pew_ensure_columns/);
    assert.match(api, /pew_ensure_columns\(\$pdo, 'estimate_items'/);
    for (const column of ['source_layer_key', 'equipment_cost', 'sort_order', 'metadata_json']) {
        assert.match(api, new RegExp(`'${column}'\\s*=>`));
        assert.match(migration, new RegExp(`'estimate_items', '${column}'`));
    }
    assert.match(api, /UPDATE estimate_workspace_states ws INNER JOIN estimates e/);
});

test('repair migration bootstraps a missing workspace table and upgrades legacy shapes idempotently', () => {
    const createAt = migration.indexOf('CREATE TABLE IF NOT EXISTS estimate_workspace_states');
    const firstAlterAt = migration.indexOf("CALL estimating_add_column_if_missing('estimate_workspace_states'");
    assert.ok(createAt >= 0 && firstAlterAt > createAt, 'table bootstrap must precede legacy ALTER calls');
    for (const column of ['estimate_id', 'project_id', 'client_estimate_id', 'state_json', 'revision', 'created_at', 'updated_at']) {
        assert.match(migration, new RegExp(`estimate_workspace_states', '${column}'`));
    }
    assert.match(migration, /PRIMARY KEY \(estimate_id\)/);
    assert.doesNotMatch(migration, /ALTER[\s\S]*UNIQUE INDEX[\s\S]*estimate_id/, 'legacy duplicate rows must not make repair fail');
    assert.match(migration, /ADD INDEX[\s\S]*p_index[\s\S]*p_column/);
    assert.match(migration, /idx_estimate_workspace_estimate', 'estimate_id'/);
});

test('runtime load and save are read-only with respect to schema', () => {
    assert.match(api, /pew_assert_schema\(\$pdo\);/);
    assert.doesNotMatch(api, /pew_assert_schema\(\$pdo, \$action === 'save'\)/);
    assert.match(api, /isset\(\$columns\['state_json'\]\) \? 'state_json' : 'NULL AS state_json'/);
    assert.match(api, /isset\(\$columns\['revision'\]\) \? 'revision' : '0 AS revision'/);
    assert.match(api, /migration is incomplete\.', 503, 'migration_required'/);
});

test('selection visuals tolerate Konva builds without shadowEnabled', () => {
    assert.match(takeoff, /typeof marker\.node\.shadowEnabled === 'function'/);
    assert.match(takeoff, /typeof segment\.node\.shadowEnabled === 'function'/);
});

test('workspace snapshot is authoritative when relational mirrors use a legacy schema', () => {
    const start = api.indexOf('function pew_save_estimate');
    const save = api.slice(start, api.indexOf('\ntry {', start));
    const snapshot = save.indexOf('pew_save_workspace_state');
    const items = save.indexOf("pew_best_effort('estimate items mirror', $pdo");
    const markups = save.indexOf("pew_best_effort('estimate markups mirror', $pdo");
    assert.ok(snapshot > -1);
    assert.ok(items > snapshot, 'item mirroring must happen after snapshot persistence');
    assert.ok(markups > snapshot, 'markup mirroring must happen after snapshot persistence');
    assert.match(save, /if \(!\$extendedSaved\)[\s\S]*UPDATE estimates SET name=\?,status=\?/);
    assert.match(api, /function pew_best_effort[\s\S]*catch \(Throwable \$e\)/);
    assert.match(api, /SAVEPOINT[\s\S]*ROLLBACK TO SAVEPOINT[\s\S]*RELEASE SAVEPOINT/, 'failed optional mirrors must roll back atomically');
    assert.match(save, /extended estimate insert[\s\S]*INSERT INTO estimates \(project_id,name,status\)/);
    assert.match(api, /pew_error\('Estimating workspace migration is incomplete\.', 503, 'migration_required'\)/);
    assert.match(api, /pew_assert_schema\(\$pdo\);/);
    assert.doesNotMatch(api, /pew_assert_schema\(\$pdo, \$action === 'save'\)/, 'POST must never run ALTER-based repair');
});

test('workspace persistence does not require legacy timestamps or unique indexes', () => {
    const start = api.indexOf('function pew_save_workspace_state');
    const fn = api.slice(start, api.indexOf('function pew_relational_groups', start));
    assert.match(fn, /isset\(\$columns\['updated_at'\]\) \? ',updated_at=CURRENT_TIMESTAMP' : ''/);
    assert.match(fn, /UPDATE estimate_workspace_states[\s\S]*WHERE estimate_id=\?/);
    assert.match(fn, /if \(\$stmt->rowCount\(\) > 0\) return;[\s\S]*INSERT INTO estimate_workspace_states/);
    assert.doesNotMatch(fn, /ON DUPLICATE KEY UPDATE/, 'legacy workspace stores may lack the required unique key');
});

test('a stale local dbEstimateId is recovered without updating another project or returning 404', () => {
    const start = api.indexOf('function pew_save_estimate');
    const save = api.slice(start, api.indexOf('\ntry {', start));
    assert.match(api, /function pew_owned_estimate_id\(PDO \$pdo, \$estimateId, \$projectId/);
    assert.match(save, /\$estimateId = pew_resolve_estimate_id\([\s\S]*?dbEstimateId/);
    assert.match(api, /function pew_resolve_estimate_id[\s\S]*Stable client identity wins over a numeric id/);
    assert.match(api, /JSON_UNQUOTE\(JSON_EXTRACT\(metadata_json, '\$\.workspaceClientId'\)\)/);
    assert.match(save, /if \(!\$estimateId\) \{[\s\S]*?INSERT INTO estimates/);
    assert.doesNotMatch(save, /if \(\$estimateId\) \{\s*pew_owned_estimate\(/);
});

test('client reconciles one legacy 404 and creates missing browser drafts by stable identity', () => {
    const client = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
    assert.match(client, /\['estimate_not_found', 'stale_estimate_id'\]\.includes\(error\.code\)/);
    assert.match(client, /await request\('list'\)/);
    assert.match(client, /remoteByClientId/);
    assert.match(client, /dbEstimateId: null/);
    assert.doesNotMatch(client, /dbEstimateId: null, revision: 0/);
    assert.match(client, /request\(hasNewDraft \? 'create' : 'save'/);
    assert.match(api, /\$createByClientIdentity = \$action === 'create'/);
    assert.match(api, /if \(\$createByClientIdentity\) \$action = 'save'/);
    assert.match(api, /if \(\$createByClientIdentity\) \$estimate\['dbEstimateId'\] = null/);
    assert.match(client, /automaticRebaseKeys/);
    assert.match(client, /ui\.saveRequested = false/);
});

test('stale client mappings are removed without stealing a live estimate mapping', () => {
    const start = api.indexOf('function pew_save_workspace_state');
    const fn = api.slice(start, api.indexOf('function pew_relational_groups', start));
    assert.match(fn, /DELETE ws FROM estimate_workspace_states ws LEFT JOIN estimates e/);
    assert.match(fn, /ws\.estimate_id<>\?[\s\S]*e\.id IS NULL OR e\.deleted_at IS NOT NULL OR e\.project_id<>\?/);
    assert.ok(fn.indexOf('DELETE ws FROM') < fn.indexOf('UPDATE estimate_workspace_states'), 'orphan cleanup must precede workspace upsert');
});

test('Estimating 500 responses expose only a safe stage and correlation id', () => {
    assert.match(api, /\$pewStage = 'database_connection';[\s\S]*require __DIR__ .*connection\.php/);
    for (const stage of ['schema_validation', 'project_validation', 'workspace_load', 'workspace_save', 'workspace_delete']) {
        assert.match(api, new RegExp(`\\$pewStage = '${stage}'`));
    }
    assert.match(api, /'request_id' => \$pewRequestId/);
    assert.match(api, /'stage' => \$pewStage/);
    assert.doesNotMatch(api, /'message'\s*=>\s*\$e->getMessage\(\)/);
    assert.match(api, /error_log\(sprintf\('project_estimating\.php request=%s stage=%s/);
    assert.match(api, /'code' => \$schemaFailure \? 'schema_incompatible' : 'server_error'/);
    assert.match(api, /Apply the estimating workspace migration, then retry/);
    assert.match(api, /if \(\$status >= 500\)[\s\S]*\$error\['request_id'\]/);
});
