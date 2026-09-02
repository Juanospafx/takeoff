const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_estimating.js'), 'utf8');

test('all numeric calculation inputs recalculate through the central calculation render on input', () => {
    const inputHandler = source.slice(source.indexOf("root.addEventListener('input'"), source.indexOf("root.addEventListener('change'"));
    assert.match(inputHandler, /dataset\.itemField[\s\S]*reactiveChanged\(event\.target\)/);
    assert.match(inputHandler, /dataset\.setting[\s\S]*reactiveChanged\(event\.target\)/);
    assert.match(inputHandler, /dataset\.tax[\s\S]*reactiveChanged\(event\.target\)/);
    assert.match(inputHandler, /dataset\.markupValue[\s\S]*reactiveChanged\(event\.target\)/);
    assert.match(source, /function summary\(\) \{ return Calc\.calculateSummary/);
    assert.match(source, /calculatedByItem[\s\S]*Calc\.calculateItem/);
});

test('reactive editing keeps the live control mounted and persists locally before debounced remote save', () => {
    const reactive = source.slice(source.indexOf('function reactiveChanged'), source.indexOf('function scheduleSave'));
    assert.match(reactive, /Workspace\.touch\(state\)/);
    assert.match(reactive, /saveLocal\(\{ publish: false \}\)/);
    assert.match(reactive, /scheduleSave\(\)/);
    assert.match(reactive, /renderLiveSummary\(\)/);
    assert.doesNotMatch(reactive.slice(0, reactive.indexOf('function activeEditingElement')), /renderPreservingInput\(target\)/);
    assert.match(source, /function renderAfterAsyncSave\(\)[\s\S]*activeEditingElement\(\)[\s\S]*renderLiveSummary\(\)/);
});

test('invalid margins are visible and block server persistence', () => {
    assert.match(source, /function calculationErrors\(\)[\s\S]*Calc\.calculateItem[\s\S]*validation/);
    assert.match(source, /if \(calculationErrors\(\)\.length\)[\s\S]*Cannot save: every margin must be below 100%/);
    assert.match(source, /aria-invalid="true"/);
});

test('markup base and active state are editable and recalculate on change', () => {
    assert.match(source, /data-markup-base/);
    assert.match(source, /data-markup-active/);
    assert.match(source, /target\.dataset\.markupBase[\s\S]*row\.base = target\.value/);
    assert.match(source, /target\.dataset\.markupActive[\s\S]*row\.active = target\.checked/);
});
