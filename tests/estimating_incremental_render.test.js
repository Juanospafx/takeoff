const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/design_system.css'), 'utf8');

test('large estimating tables render in cancellable animation-frame chunks', () => {
    assert.match(source, /let estimatingTableRenderGeneration = 0/);
    assert.match(source, /const ESTIMATING_TABLE_CHUNK_SIZE = 60/);
    assert.match(source, /rows\.length > ESTIMATING_TABLE_CHUNK_THRESHOLD/);
    assert.match(source, /body\.innerHTML = rows\.slice\(0, ESTIMATING_TABLE_CHUNK_SIZE\)\.join\(''\)/);
    assert.match(source, /generation !== estimatingTableRenderGeneration \|\| !body\.isConnected/);
    assert.match(source, /body\.insertAdjacentHTML\('beforeend', rows\.slice\(offset, nextOffset\)\.join\(''\)\)/);
    assert.match(source, /requestAnimationFrame\(appendChunk\)/);
});

test('small and empty tables retain synchronous rendering and final table bindings', () => {
    assert.match(source, /if \(!rows\.length\) \{\s*body\.innerHTML = emptyHtml;\s*finalizeEstimatingTableRender\(generation\)/);
    assert.match(source, /if \(!canChunk\) \{\s*body\.innerHTML = rows\.join\(''\);\s*finalizeEstimatingTableRender\(generation\)/);
    assert.match(source, /No estimate items\. Create a group or add items in Takeoff\./);
    assert.match(source, /attachTableResizeAndDragOnce\(\)/);
});

test('repeated static inline table styles are represented by reusable CSS classes', () => {
    for (const className of [
        'est-toolbar-actions',
        'est-group-item-count',
        'est-group-subtotal',
        'est-group-labor-margin',
        'est-assembly-empty-note'
    ]) {
        assert.match(source, new RegExp(`class="[^"]*${className}`));
        assert.match(css, new RegExp(`\\.${className}\\s*\\{`));
    }
    assert.doesNotMatch(source, /class="est-toolbar-actions" style=/);
    assert.doesNotMatch(source, /No components defined in this assembly<\/span>[\s\S]{0,200}font-style:/);
});
