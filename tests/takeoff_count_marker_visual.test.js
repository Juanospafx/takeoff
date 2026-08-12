const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../assets/editor/takeoff.js'), 'utf8');

test('count marker fill is semitransparent without fading its full group', () => {
    const drawSymbol = source.slice(source.indexOf('function drawSymbol'), source.indexOf('function isObjectIndividuallyLocked'));
    assert.match(drawSymbol, /fillOpacity:\s*0\.42/);
    assert.doesNotMatch(drawSymbol, /const common\s*=\s*\{[^}]*opacity:/s);
});

test('count markers render only explicit labels and keep quantity calculations intact', () => {
    const createMarker = source.slice(source.indexOf('function createMarkerNode'), source.indexOf('function refreshSegment'));
    assert.match(createMarker, /text:\s*marker\.label\s*\|\|\s*''/);
    assert.doesNotMatch(createMarker, /String\(marker\.quantity/);
    assert.match(source, /marker\.quantity\s*=\s*calculateCountQuantity\(marker\)/);
    assert.match(source, /reduce\(\(sum, marker\) => sum \+ calculateCountQuantity\(marker\), 0\)/);
});

test('editing a count marker never restores the numeric quantity as display text', () => {
    assert.match(source, /findOne\('Text'\)\?\.text\(ref\.label\s*\|\|\s*''\)/);
    assert.doesNotMatch(source, /findOne\('Text'\)\?\.text\(ref\.label\s*\|\|\s*String\(ref\.quantity/);
});
