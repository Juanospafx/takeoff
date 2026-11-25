const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtime = fs.readFileSync(
    path.resolve(__dirname, '..', 'assets', 'editor', 'runtime.js'),
    'utf8'
);

test('Konva never initializes its backing canvas with a zero dimension while Takeoff is hidden', () => {
    const start = runtime.indexOf('function initKonvaRuler()');
    const end = runtime.indexOf('// Zoom desde Konva', start);
    const init = runtime.slice(start, end);

    assert.match(init, /width:\s*Math\.max\(1,\s*w\.clientWidth\)/);
    assert.match(init, /height:\s*Math\.max\(1,\s*w\.clientHeight\)/);
});

test('later resize and visibility paths preserve the real viewport dimensions', () => {
    assert.match(runtime, /if \(!w \|\| w\.clientWidth <= 0 \|\| w\.clientHeight <= 0\) return/);
    assert.match(runtime, /event\.data\.type !== 'takeoff-visible'/);
    assert.match(runtime, /konvaStage\.width\(w\.clientWidth\)/);
    assert.match(runtime, /konvaStage\.height\(w\.clientHeight\)/);
});

