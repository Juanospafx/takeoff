const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const parent = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const overview = fs.readFileSync(path.join(root, 'assets/project_overview.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'assets/editor/runtime.js'), 'utf8');
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

test('dashboard Takeoff dirty state clears only after a database acknowledgement', () => {
    const saveStart = parent.indexOf('window.projectTakeoffSaveState = async function');
    const saveEnd = parent.indexOf('const viewerState', saveStart);
    const saveBlock = parent.slice(saveStart, saveEnd);
    assert.match(saveBlock, /const saveResult = await callEditor\('projectTakeoffSave'\)/);
    assert.match(saveBlock, /saveResult\?\.persisted !== true/);
    assert.match(saveBlock, /saveResult\.dirtyRemaining === true/);
    assert.ok(saveBlock.indexOf('takeoffIsDirty = false') > saveBlock.indexOf("await flushPendingDeletedEstimateLayers()"),
        'dirty state must clear after the canvas and deletion acknowledgements');
    assert.doesNotMatch(saveBlock, /syncAllLayersToCanvas/,
        'manual save must not overwrite the authoritative iframe with a potentially stale parent snapshot');
    assert.doesNotMatch(saveBlock, /catch \(e\)[\s\S]*ignored/);
});

test('project Save has one awaited persistence owner and no speculative pointerdown save', () => {
    const bindingStart = parent.indexOf("document.querySelectorAll('[data-tab=\"estimating\"]");
    const bindingEnd = parent.indexOf("window.addEventListener('pagehide'", bindingStart);
    const bindingBlock = parent.slice(bindingStart, bindingEnd);
    assert.doesNotMatch(bindingBlock, /#saveProjectBtn/);
    assert.doesNotMatch(bindingBlock, /projectTakeoffSave/);
    assert.match(overview, /await window\.projectTakeoffSaveState\(\)/);
});

test('editor verifies the canonical save acknowledgement before clearing dirty objects', () => {
    const saveStart = editor.indexOf('function performSaveTakeoff');
    const saveEnd = editor.indexOf('function saveTakeoff', saveStart);
    const saveBlock = editor.slice(saveStart, saveEnd);
    assert.match(editor, /function validateTakeoffSaveAcknowledgement/);
    assert.match(saveBlock, /validateTakeoffSaveAcknowledgement/);
    assert.ok(saveBlock.indexOf('validateTakeoffSaveAcknowledgement') < saveBlock.indexOf('dirtyTakeoffObjects.delete'),
        'canonical acknowledgement must be verified before local dirty tracking is cleared');
    assert.match(saveBlock, /persisted:\s*true/);
    assert.match(saveBlock, /dirtyRemaining/);
    assert.match(saveBlock, /acknowledgedObjects/);
    assert.match(saveBlock, /takeoffObjectBaseVersions\.set\(id, acknowledgedVersion\)/,
        'a newer local edit must advance to the acknowledged base before the drain save');
});

test('sheet scale is shared by drawing and page while geometry remains estimate-scoped', () => {
    assert.match(api, /CREATE TABLE IF NOT EXISTS takeoff_sheet_scales/);
    assert.match(api, /UNIQUE KEY uq_takeoff_sheet_scale \(drawing_id, page_number\)/);
    assert.match(api, /case 'scale'/);
    assert.match(api, /case 'save_scale'/);
    assert.match(api, /function ensure_takeoff_scale_table/);
    assert.match(api, /assert_takeoff_runtime_schema\(\$pdo\)/);
    const runtime = api.slice(api.indexOf('try {\n    \/\/ Production runtime credentials'));
    assert.doesNotMatch(runtime, /ensure_takeoff_scale_table\(\$pdo\)/);
    assert.doesNotMatch(api, /Run db\/migrations\/2026-08-12_takeoff_shared_persistence\.sql/);
    assert.match(api, /ON DUPLICATE KEY UPDATE/);
    assert.match(api, /FROM takeoff_sheet_scales WHERE drawing_id = \? AND page_number = \?/);
    assert.match(api, /FROM takeoff_estimate_scales WHERE drawing_id = \? AND page_number = \? ORDER BY updated_at DESC LIMIT 1/);
});

test('geometry tables exist and every saved layer belongs to a persisted takeoff', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS takeoff_count_markers/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS takeoff_linear_segments/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS takeoff_measurement_summaries/);
    assert.match(api, /function ensure_takeoff_geometry_tables/);
    assert.match(api, /ensure_drawing_takeoff\(\$pdo, \$projectId, \$drawingId\)/);
    assert.match(api, /\(takeoff_id, (?:project_id, )?integration_key, drawing_id/);
    assert.match(api, /\$layerParams = \[\$takeoffId\]/);
    assert.match(api, /array_push\(\s*\$layerParams,\s*\$layerClientId/s);
});

test('editor loads and saves calibration through the shared API', () => {
    assert.match(shell, /takeoffScaleRequest\('scale', \{ drawing_id: fileId, estimate_key: takeoffEstimateKey, page_number: requestedPage \}\)/);
    assert.match(shell, /takeoffScaleRequest\('save_scale'/);
    assert.match(shell, /requestedPage !== Number\(pageNum \|\| 1\)/);
    assert.doesNotMatch(shell, /localStorage\.setItem\(getCalKey|localStorage\.getItem\(getCalKey/);
});
