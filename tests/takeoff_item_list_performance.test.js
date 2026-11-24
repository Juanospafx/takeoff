const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/project_takeoff.css'), 'utf8');

test('Takeoff list indexes Estimating links once per render', () => {
    assert.match(source, /function buildEstimatingOverrideIndex\(estimateId/);
    assert.match(source, /const estimatingOverrideIndex = buildEstimatingOverrideIndex\(estimateId\);/);
    assert.match(source, /getLayerEstimatingOverride\(layer, estimateId, estimatingOverrideIndex\)/);
});

test('Takeoff list reads each editor lock state once per render', () => {
    assert.match(source, /callEditor\('projectTakeoffGetAllLayerLockStates'\)/);
    assert.match(source, /const layerLockStateById = new Map\(renderLayers\.map\(layer =>/);
    const renderStart = source.indexOf('function renderTakeoffPanel()');
    const renderEnd = source.indexOf('function patchTakeoffSelectionClassesDom()', renderStart);
    const renderBody = source.slice(renderStart, renderEnd);
    assert.doesNotMatch(renderBody, /projectTakeoffGetLayerLockState/);
    assert.match(editor, /window\.projectTakeoffGetAllLayerLockStates = function \(\)/);
    const batchStart = editor.indexOf('window.projectTakeoffGetAllLayerLockStates');
    const batchEnd = editor.indexOf('window.projectTakeoffGetSelectionLockState', batchStart);
    const batchBody = editor.slice(batchStart, batchEnd);
    assert.match(batchBody, /state\.markers\.forEach\(countObject\)/);
    assert.match(batchBody, /state\.segments\.forEach\(countObject\)/);
});

test('offscreen Takeoff rows use browser rendering containment', () => {
    assert.match(css, /\.pro-tree-item\s*\{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-size:\s*auto 36px;/);
    assert.match(css, /\.pro-preview-item-row\s*\{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-size:\s*auto 30px;/);
});
