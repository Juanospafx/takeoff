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
    const snapshot = save.indexOf('INSERT INTO estimate_workspace_states');
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

test('Estimating 500 responses expose only a safe stage and correlation id', () => {
    assert.match(api, /\$pewStage = 'database_connection';[\s\S]*require __DIR__ .*connection\.php/);
    for (const stage of ['schema_validation', 'project_validation', 'workspace_load', 'workspace_save', 'workspace_delete']) {
        assert.match(api, new RegExp(`\\$pewStage = '${stage}'`));
    }
    assert.match(api, /'request_id' => \$pewRequestId/);
    assert.match(api, /'stage' => \$pewStage/);
    assert.doesNotMatch(api, /'message'\s*=>\s*\$e->getMessage\(\)/);
    assert.match(api, /error_log\(sprintf\('project_estimating\.php request=%s stage=%s/);
});
