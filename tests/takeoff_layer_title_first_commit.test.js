const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectSource = fs.readFileSync(path.resolve(__dirname, '../assets/project_takeoff.js'), 'utf8');
const controllerPath = path.resolve(__dirname, '../assets/takeoff_layer_modal.js');
const controllerSource = fs.existsSync(controllerPath) ? fs.readFileSync(controllerPath, 'utf8') : '';
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
    const localSaveIndex = submit.indexOf('saveTakeoffState(needsEstimatingSync');
    const iframeSaveIndex = submit.indexOf("const saved = callEditor('projectTakeoffSave')");
    assert.ok(assignIndex >= 0 && assignIndex < rowIndex, 'model title must update before the visible row');
    assert.ok(rowIndex < localSaveIndex, 'visible row must update before local persistence');
    assert.ok(localSaveIndex < iframeSaveIndex, 'local title must persist before awaiting the iframe request');
    assert.match(submit, /return true;[\s\S]*?catch \(error\)[\s\S]*?return false;/);
});
