const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectSource = fs.readFileSync(path.resolve(__dirname, '../assets/project_takeoff.js'), 'utf8');
const controllerPath = path.resolve(__dirname, '../assets/takeoff_layer_modal.js');
const controllerSource = fs.existsSync(controllerPath) ? fs.readFileSync(controllerPath, 'utf8') : '';
const apiSource = fs.readFileSync(path.resolve(__dirname, '../api/takeoff.php'), 'utf8');
const dashboardSource = fs.readFileSync(path.resolve(__dirname, '../pages/project_dashboard.php'), 'utf8');
const editorSource = fs.readFileSync(path.resolve(__dirname, '../assets/editor/takeoff.js'), 'utf8');
const estimatingApiSource = fs.readFileSync(path.resolve(__dirname, '../api/project_estimating.php'), 'utf8');
const source = `${projectSource}\n${controllerSource}`;

test('Close, drawer X, and Enter share the same layer modal commit path', () => {
    assert.match(controllerSource, /layerDrawerSaveBtn[\s\S]*?void commit\(\)/);
    assert.match(controllerSource, /data-layer-modal-close[\s\S]*?void commit\(\)/);
    assert.match(controllerSource, /event\.key !== 'Enter'[\s\S]*?void commit\(\)/);
    assert.match(source, /if \(isOpen\) \{\s*void (?:commitLayerModalChanges|layerModalController\.commit)\(\);\s*return;/,
        'clicking the same three-dot trigger to close must also commit the current title');
});

test('existing layer title is committed on the first action instead of being closed as stale state', () => {
    const commit = controllerSource || source.slice(
        source.indexOf('async function commitLayerModalChanges'),
        source.indexOf('function patchTakeoffLayerRowQuantityDom')
    );
    assert.match(commit, /flushActiveLayerModalSave\(\)/);
    assert.match(commit, /isLayerModalNonAutoDirty\(\)/);
    assert.match(commit, /(?:return\s+)?submitLayerModal\(\)/);
});

test('title state and row are updated before awaiting iframe persistence', () => {
    const submit = controllerSource.slice(
        controllerSource.indexOf('async function submitLayerModal'),
        controllerSource.indexOf('function getActiveFormType')
    );
    const assignIndex = submit.indexOf('Object.assign(layer, payload)');
    const rowIndex = submit.indexOf('refreshTakeoffLayerRowDom(updatedLayer)');
    const localSaveIndex = submit.indexOf('saveTakeoffState({ skipEstimatingSync: true');
    const iframeSaveIndex = submit.indexOf("const saved = callEditor('projectTakeoffSave')");
    assert.ok(assignIndex >= 0 && assignIndex < rowIndex, 'model title must update before the visible row');
    assert.ok(rowIndex < localSaveIndex, 'visible row must update before local persistence');
    assert.ok(localSaveIndex < iframeSaveIndex, 'local title must persist before awaiting the iframe request');
    assert.match(submit, /return true;[\s\S]*?catch \(error\)[\s\S]*?return false;/);
});

test('title persistence must be acknowledged before the drawer closes or Estimating reloads', () => {
    const submit = controllerSource.slice(
        controllerSource.indexOf('async function submitLayerModal'),
        controllerSource.indexOf('function getActiveFormType')
    );
    const localSaveIndex = submit.indexOf('saveTakeoffState({ skipEstimatingSync: true')
    const iframeSaveIndex = submit.indexOf("const saved = callEditor('projectTakeoffSave')");
    const unavailableIndex = submit.indexOf("typeof saved.then !== 'function'");
    const awaitIndex = submit.indexOf('await saved');
    const closeIndex = submit.indexOf('closeLayerModal()', awaitIndex);
    const estimatingSyncIndex = submit.indexOf('debounceEstimatingSync', closeIndex);
    assert.ok(localSaveIndex >= 0 && localSaveIndex < iframeSaveIndex, 'Close must snapshot locally before the server request');
    assert.ok(unavailableIndex > iframeSaveIndex && unavailableIndex < awaitIndex, 'a missing persistence bridge must fail closed');
    assert.ok(awaitIndex < closeIndex, 'the drawer must remain open until the database acknowledges the save');
    assert.ok(closeIndex < estimatingSyncIndex, 'Estimating synchronization must run after the drawer closes');
    assert.match(submit, /catch \(error\)[\s\S]*showPrepared\('Unable to save Takeoff item changes\. Please try again\.'\)[\s\S]*return false/,
        'a rejected database save must leave the drawer open and show a visible error');
    assert.doesNotMatch(submit, /catch \(editorErr\)[\s\S]{0,180}console\.warn[\s\S]{0,180}closeLayerModal\(\)/,
        'server failures must not be swallowed before closing');
});

test('hard refresh prefers database layers and only falls back to browser storage', () => {
    const init = projectSource.slice(
        projectSource.indexOf('function initTakeoffState()'),
        projectSource.indexOf('const layerModalController')
    );
    const seedIndex = init.indexOf('const seeded = seedGroupsFromProjectLayers()');
    const dbBranchIndex = init.indexOf('if (seeded.length > 0)');
    const storageBranchIndex = init.indexOf('else if (Array.isArray(storedGroups))');
    assert.ok(seedIndex >= 0 && seedIndex < dbBranchIndex && dbBranchIndex < storageBranchIndex,
        'persisted database layers must be canonical when available');
});

test('duplicate drawing copies use the latest persisted layer and share renamed metadata', () => {
    assert.match(dashboardSource, /ORDER BY tl\.sort_order ASC, tl\.id DESC/,
        'newest relational copy must win deterministic deduplication');
    assert.match(apiSource, /function apply_explicit_takeoff_layer_name_updates/);
    assert.match(apiSource, /UPDATE takeoff_layers SET name = \?[^;]+project_id = \?[^;]+estimate_key = \?[^;]+integration_key = \?/s);
});

test('only explicit layer renames are propagated and retained until save acknowledgement', () => {
    assert.match(editorSource, /const pendingLayerNameUpdates = new Map\(\)/);
    assert.match(editorSource, /patch\.name !== undefined[\s\S]{0,260}previousName[\s\S]{0,260}pendingLayerNameUpdates\.set/,
        'projectTakeoffUpdateLayerObjects must record only an actual explicit rename');
    assert.match(editorSource, /layer_name_updates:\s*sentLayerNameUpdates\.map/,
        'ordinary stale layer snapshots must not imply rename propagation');
    assert.match(editorSource, /layer_name_updates:\s*body\.layer_name_updates/,
        'compact keepalive saves must preserve explicit rename intent');
    assert.match(editorSource, /sentLayerNameUpdates\.forEach[\s\S]{0,500}pendingLayerNameUpdates\.delete/,
        'rename intent must clear only in the successful acknowledgement path');
    assert.doesNotMatch(apiSource, /propagate_takeoff_layer_metadata\([^)]*\$savedLayers/,
        'a stale drawing autosave must never propagate names from its full snapshot');
    assert.match(apiSource, /\$layerNameUpdates\s*=\s*normalize_takeoff_layer_name_updates/);
    assert.match(apiSource, /apply_explicit_takeoff_layer_name_updates\(\$pdo, \$projectId, \$estimateKey, \$layerNameUpdates\)/);
    const explicitHelper = apiSource.slice(
        apiSource.indexOf('function apply_explicit_takeoff_layer_name_updates'),
        apiSource.indexOf('function purge_deleted_takeoff_layer_rows')
    );
    assert.doesNotMatch(explicitHelper, /takeoff_estimate_states|FOR UPDATE/,
        'explicit propagation must not lock or rewrite snapshots for other drawings');
});

test('estimate-scoped serialization prevents a stale autosave from winning after an explicit rename', () => {
    const saveCase = apiSource.slice(apiSource.indexOf("case 'save_state':"), apiSource.indexOf("case 'save_catalog_item':"));
    const transaction = saveCase.indexOf('$pdo->beginTransaction()');
    const canonicalRead = saveCase.indexOf('lock_takeoff_layer_name_registry(');
    const drawingLock = saveCase.indexOf('SELECT state_json FROM takeoff_estimate_states');
    const staleNormalization = saveCase.indexOf('apply_layer_name_updates_to_snapshot($snapshot, $canonicalLayerNames)');
    const explicitOverride = saveCase.indexOf('apply_layer_name_updates_to_snapshot($snapshot, $layerNameUpdates)');
    const persistence = saveCase.indexOf('INSERT INTO takeoff_estimate_states', explicitOverride);
    assert.ok(transaction >= 0 && transaction < canonicalRead && canonicalRead < drawingLock,
        'all saves must lock the estimate name registry before their drawing snapshot');
    assert.ok(staleNormalization < explicitOverride && explicitOverride < persistence,
        'canonical names protect stale autosaves while explicit rename intent remains authoritative');
    assert.match(estimatingApiSource, /pew_save_workspace_state[\s\S]*takeoffLayerNames[\s\S]*storedWorkspace\['takeoffLayerNames'\]/,
        'Estimating workspace saves must preserve the server-owned name registry');

    const serializedSave = (registry, snapshotName, update = null) => {
        if (update) registry.layer = update;
        return registry.layer || snapshotName;
    };
    const registry = {};
    assert.equal(serializedSave(registry, 'Old name', 'New name'), 'New name');
    assert.equal(serializedSave(registry, 'Old name'), 'New name',
        'a stale save serialized after the rename must receive the canonical name');
});

test('layer-name registry saves remain compatible when workspace updated_at is absent', () => {
    const registryHelper = apiSource.slice(
        apiSource.indexOf('function lock_takeoff_layer_name_registry'),
        apiSource.indexOf('function apply_explicit_takeoff_layer_name_updates')
    );
    assert.match(registryHelper, /takeoff_columns\(\$pdo, 'estimate_workspace_states'\)/,
        'the rename path must discover the production workspace schema');
    assert.match(registryHelper, /in_array\('updated_at',[\s\S]*?CURRENT_TIMESTAMP/,
        'updated_at must be appended only when that optional column exists');
    assert.doesNotMatch(registryHelper, /SET state_json = \?, updated_at = CURRENT_TIMESTAMP/,
        'a legacy workspace without updated_at must not reject the rename save');
});
