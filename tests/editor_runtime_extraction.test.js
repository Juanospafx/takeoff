const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pages/editor.php'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'assets/editor/runtime.js'), 'utf8');

test('editor publishes runtime data through escaped JSON and a filemtime asset', () => {
    assert.match(page, /id="editor-runtime-config"\s+type="application\/json"/);
    assert.match(page, /JSON_HEX_TAG \| JSON_HEX_AMP \| JSON_HEX_APOS \| JSON_HEX_QUOT/);
    assert.match(page, /editor\/runtime\.js\?v=<\?=\s*filemtime\(/);
    assert.ok(page.indexOf('editor-runtime-config') < page.indexOf('editor/runtime.js'));
    assert.ok(page.indexOf('editor/runtime.js') < page.indexOf('catalog_metadata.js'));
});

test('runtime consumes configuration without executable PHP interpolation', () => {
    assert.match(runtime, /document\.getElementById\('editor-runtime-config'\)/);
    assert.match(runtime, /JSON\.parse\(runtimeConfigNode\.textContent/);
    assert.match(runtime, /const fileId = Number\(editorRuntimeConfig\.fileId/);
    assert.match(runtime, /let allAnnotations = editorRuntimeConfig\.annotations/);
    assert.doesNotMatch(runtime, /<\?(?:php|=)/);
});

test('the PHP shell contains no application runtime inline script', () => {
    assert.doesNotMatch(page, /<script>\s*(?:['"]use strict['"]|\/\/|const\s|let\s|function\s)/);
    assert.doesNotMatch(page, /function\s+(?:loadPdfDocument|saveCurrentPageAnnotations|takeoffScaleRequest)\s*\(/);
});
