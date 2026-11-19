const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../assets/project_takeoff.js'), 'utf8');

test('Close, drawer X, and Enter share the same layer modal commit path', () => {
    const modalBindings = source.slice(
        source.indexOf("$('layerDrawerSaveBtn')?.addEventListener"),
        source.indexOf("setupTypeDropdown('editLayer'")
    );
    assert.match(modalBindings, /layerDrawerSaveBtn[\s\S]*?commitLayerModalChanges\(\)/);
    assert.match(modalBindings, /data-layer-modal-close[\s\S]*?commitLayerModalChanges\(\)/);
    assert.match(modalBindings, /event\.key !== 'Enter'[\s\S]*?commitLayerModalChanges\(\)/);
    assert.match(source, /if \(isOpen\) \{\s*void commitLayerModalChanges\(\);\s*return;/,
        'clicking the same three-dot trigger to close must also commit the current title');
});

test('existing layer title is committed on the first action instead of being closed as stale state', () => {
    const commit = source.slice(
        source.indexOf('async function commitLayerModalChanges'),
        source.indexOf('function patchTakeoffLayerRowQuantityDom')
    );
    assert.match(commit, /flushActiveLayerModalSave\(\)/);
    assert.match(commit, /isLayerModalNonAutoDirty\(\)/);
    assert.match(commit, /return submitLayerModal\(\)/);
});

test('title state and row are updated before awaiting iframe persistence', () => {
    const submit = source.slice(
        source.indexOf('async function submitLayerModal'),
        source.indexOf('const CATALOG_PALETTE')
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
