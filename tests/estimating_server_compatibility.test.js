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

test('selection visuals tolerate Konva builds without shadowEnabled', () => {
    assert.match(takeoff, /typeof marker\.node\.shadowEnabled === 'function'/);
    assert.match(takeoff, /typeof segment\.node\.shadowEnabled === 'function'/);
});
