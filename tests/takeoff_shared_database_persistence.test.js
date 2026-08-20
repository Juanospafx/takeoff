const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const parent = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const overview = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'pages/editor.php'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/takeoff.php'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db/migrations/2026-08-12_takeoff_shared_persistence.sql'), 'utf8');
const estimateMigration = fs.readFileSync(path.join(root, 'db/migrations/2026-08-20_takeoff_estimate_isolation.sql'), 'utf8');

test('Takeoff geometry uses the database without a browser-state override', () => {
    assert.doesNotMatch(editor, /localTakeoffKey|persistLocalTakeoffState|readLocalTakeoffState/);
    assert.doesNotMatch(parent, /takeoff\.quantification|readSavedTakeoffs/);
    assert.match(editor, /request\('save_state'/);
    assert.match(editor, /request\('state', \{ drawing_id: fileId, estimate_key: currentEstimateKey\(\)/);
    assert.match(parent, /iframe\/API owns persistent Takeoff state/);
});

test('one authoritative estimate and drawing snapshot survives relational mirror failures', () => {
    assert.match(api, /CREATE TABLE IF NOT EXISTS takeoff_estimate_states/);
    assert.match(api, /INSERT INTO takeoff_estimate_states[\s\S]*ON DUPLICATE KEY UPDATE/);
    assert.match(api, /SELECT state_json FROM takeoff_estimate_states/);
    assert.match(api, /Takeoff relational mirror failed/);
    assert.match(editor, /window\.projectTakeoffSave = function[\s\S]*saveTakeoff\(true, true\)/);
    assert.match(overview, /await saveTakeoff\.call\(takeoffFrame\.contentWindow\)/);
});

test('sheet scale schema and API are isolated by estimate, drawing and page', () => {
    assert.match(estimateMigration, /CREATE TABLE IF NOT EXISTS takeoff_estimate_scales/);
    assert.match(estimateMigration, /PRIMARY KEY \(estimate_key, drawing_id, page_number\)/);
    assert.match(api, /case 'scale'/);
    assert.match(api, /case 'save_scale'/);
    assert.match(api, /function ensure_takeoff_scale_table/);
    assert.match(api, /ensure_takeoff_scale_table\(\$pdo\)/);
    assert.doesNotMatch(api, /Run db\/migrations\/2026-08-12_takeoff_shared_persistence\.sql/);
    assert.match(api, /ON DUPLICATE KEY UPDATE/);
    assert.match(api, /WHERE estimate_key = \? AND drawing_id = \? AND page_number = \?/);
});

test('geometry tables exist and every saved layer belongs to a persisted takeoff', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS takeoff_count_markers/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS takeoff_linear_segments/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS takeoff_measurement_summaries/);
    assert.match(api, /function ensure_takeoff_geometry_tables/);
    assert.match(api, /ensure_drawing_takeoff\(\$pdo, \$projectId, \$drawingId\)/);
    assert.match(api, /\(takeoff_id, integration_key, drawing_id/);
    assert.match(api, /\$takeoffId,\s*\$layerClientId/);
});

test('editor loads and saves calibration through the shared API', () => {
    assert.match(shell, /takeoffScaleRequest\('scale', \{ drawing_id: fileId, estimate_key: takeoffEstimateKey, page_number: requestedPage \}\)/);
    assert.match(shell, /takeoffScaleRequest\('save_scale'/);
    assert.match(shell, /requestedPage !== Number\(pageNum \|\| 1\)/);
    assert.doesNotMatch(shell, /localStorage\.setItem\(getCalKey|localStorage\.getItem\(getCalKey/);
});
