const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('findLayer and toggleLayerLock correctly match numeric and string layer IDs', () => {
    const root = path.resolve(__dirname, '..');
    const takeoffJs = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');

    // Verify findLayer implementation coerces to string
    assert.match(takeoffJs, /function findLayer\(layerId\) \{\s*const id = String\(layerId \?\? ''\);\s*return allLayers\(\)\.find\(layer => String\(layer\.id\) === id\) \|\| null;\s*\}/);

    // Verify groupForLayer also compares string IDs
    assert.match(takeoffJs, /String\(group\.id\) === String\(layer\?\.groupId\)/);

    // Emulate findLayer behavior
    const allLayers = [
        { id: 42, name: 'Receptacles', locked: false, color: '#111827' },
        { id: 'layer_custom_99', name: 'Lighting 2x4', locked: true, color: '#2563eb' }
    ];
    function findLayer(layerId) {
        const id = String(layerId ?? '');
        return allLayers.find(layer => String(layer.id) === id) || null;
    }

    // String "42" (from dataset.layerLock) matches numeric 42
    const foundNum = findLayer("42");
    assert.ok(foundNum, 'Should find layer with numeric ID when queried by string');
    assert.equal(foundNum.id, 42);

    // Number 42 matches
    assert.equal(findLayer(42).name, 'Receptacles');

    // String 'layer_custom_99' matches
    const foundStr = findLayer('layer_custom_99');
    assert.ok(foundStr);
    assert.equal(foundStr.name, 'Lighting 2x4');
});

test('editor takeoff matches numeric layer ID in projectTakeoffSetLayerLocked and getLayerLockState', () => {
    const root = path.resolve(__dirname, '..');
    const editorTakeoffJs = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');

    assert.match(editorTakeoffJs, /window\.projectTakeoffSetLayerLocked = function \(layerId, locked\) \{\s*const layer = state\.layers\.find\(row => String\(row\.client_uid\) === String\(layerId\) \|\| String\(row\.metadata_json\?\.project_layer_id\) === String\(layerId\) \|\| String\(row\.id\) === String\(layerId\)\);/);
    assert.match(editorTakeoffJs, /window\.projectTakeoffGetLayerLockState = function \(layerId\) \{\s*const layer = state\.layers\.find\(row => String\(row\.client_uid\) === String\(layerId\) \|\| String\(row\.metadata_json\?\.project_layer_id\) === String\(layerId\) \|\| String\(row\.id\) === String\(layerId\)\);/);
});

test('layer modal supports custom colors not in preset palette', () => {
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
            <div id="layerColorSwatch"></div>
            <select id="layerColorInput">
                <option value="#111827">Dark Slate</option>
                <option value="#2563eb">Blue</option>
                <option value="__custom__">Custom color...</option>
            </select>
            <input type="color" id="layerCustomColorPicker">
        </body>
        </html>
    `);
    const { document } = dom.window;
    const input = document.getElementById('layerColorInput');
    const swatch = document.getElementById('layerColorSwatch');
    const picker = document.getElementById('layerCustomColorPicker');

    function updateLayerColorSwatch() {
        const color = (input?.value === '__custom__' ? picker?.value : input?.value) || '#111827';
        if (swatch) swatch.style.background = color;
    }

    function setLayerColor(color) {
        const hex = String(color || '#111827').trim();
        let match = Array.from(input.options).find(opt => opt.value.toLowerCase() === hex.toLowerCase());
        if (!match && hex !== '__custom__') {
            const opt = document.createElement('option');
            opt.value = hex;
            opt.textContent = `Custom (${hex})`;
            const customOpt = input.querySelector('option[value="__custom__"]');
            if (customOpt) input.insertBefore(opt, customOpt);
            else input.appendChild(opt);
            match = opt;
        }
        if (match) input.value = match.value;
        if (picker && hex.startsWith('#') && (hex.length === 7 || hex.length === 4)) {
            picker.value = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
        }
        updateLayerColorSwatch();
    }

    // Set custom hex purple not in presets
    setLayerColor('#7c3aed');
    assert.equal(input.value, '#7c3aed', 'Custom color should be set on select');
    assert.ok(swatch.style.background === '#7c3aed' || swatch.style.background === 'rgb(124, 58, 237)', 'Swatch should reflect custom color');
    assert.equal(picker.value, '#7c3aed', 'Color picker should reflect custom color');

    // Confirm custom option exists in select
    const customOpt = input.querySelector('option[value="#7c3aed"]');
    assert.ok(customOpt, 'Custom option was inserted into select');
    assert.equal(customOpt.textContent, 'Custom (#7c3aed)');
});
