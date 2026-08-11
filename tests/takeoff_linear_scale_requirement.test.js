const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const project = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');
const editorPage = fs.readFileSync(path.join(root, 'pages/editor.php'), 'utf8');

test('linear takeoff cannot activate, start, or finish without a drawing scale', () => {
    assert.match(editor, /function requirePlanScale\(measurement = 'linear'\)[\s\S]*if \(hasPlanScale\(\)\)[\s\S]*return false/);
    assert.match(editor, /function setTool\(tool\)[\s\S]*tool === 'takeoff_linear' && !requirePlanScale\('linear'\)[\s\S]*return false/);
    assert.match(editor, /function addLinearPoint\(pos\)[\s\S]*if \(!requirePlanScale\('linear'\)\) return false/);
    assert.match(editor, /function finishLinear\(\)[\s\S]*!requirePlanScale\('linear'\)[\s\S]*cancelLinearDraft\(\)[\s\S]*return false/);
    assert.match(editor, /function activateLayerForInsert[\s\S]*type === 'linear'[\s\S]*requirePlanScale\('linear'\)[\s\S]*return false/);
});

test('missing scale opens the parent scale panel and the new scripts bypass cache', () => {
    assert.match(editor, /project-takeoff-scale-required/);
    assert.match(project, /project-takeoff-scale-required'[\s\S]*openScalePanel\(\)/);
    assert.match(page, /project_takeoff\.js\?v=linear-scale-required-20260811-1/);
    assert.match(editorPage, /editor\/takeoff\.js\?v=linear-scale-required-20260811-1/);
});
