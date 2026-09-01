const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const palette = require('../assets/takeoff_color_palette.js');
const dashboard = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');
const dashboardPage = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');
const editorPage = fs.readFileSync(path.join(root, 'pages', 'editor.php'), 'utf8');

test('duplicating a palette color chooses a deterministic different sibling color', () => {
    assert.equal(palette.duplicateColor('#2563eb', ['#2563eb']), '#16a34a');
    assert.equal(palette.duplicateColor('#16a34a', ['#2563eb', '#16a34a']), '#f97316');
    assert.notEqual(palette.duplicateColor('#abcdef', []), '#abcdef');
});

test('Count, Line, and Area duplication share the same palette behavior', () => {
    for (const type of ['count', 'linear', 'area']) {
        const source = { id: `source-${type}`, type, color: '#2563eb' };
        const copy = JSON.parse(JSON.stringify(source));
        copy.id = `copy-${type}`;
        copy.color = palette.duplicateColor(source.color, [source.color]);
        assert.notEqual(copy.id, source.id);
        assert.notEqual(copy.color, source.color);
        assert.equal(copy.type, source.type);
    }
});

test('duplicate state is deeply isolated and its selected color survives JSON reload', () => {
    const source = { id: 'a', color: '#2563eb', metadata_json: { catalog_item: { id: 7 }, flags: ['x'] } };
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = 'b';
    copy.color = palette.duplicateColor(source.color, [source.color]);
    copy.metadata_json.project_layer_id = copy.id;
    copy.metadata_json.flags.push('copy-only');
    const restored = JSON.parse(JSON.stringify(copy));
    assert.equal(source.metadata_json.flags.length, 1);
    assert.equal(restored.color, copy.color);
    assert.equal(restored.metadata_json.project_layer_id, 'b');
});

test('both duplicate handlers deep clone and use the shared palette', () => {
    const parentDuplicate = dashboard.slice(dashboard.indexOf('function duplicateLayer'), dashboard.indexOf('function renameLayer'));
    const editorDuplicate = editor.slice(editor.indexOf('function duplicateLayer'), editor.indexOf('function editLayer'));
    for (const handler of [parentDuplicate, editorDuplicate]) {
        assert.match(handler, /JSON\.parse\(JSON\.stringify\(layer\)\)/);
        assert.match(handler, /TakeoffColorPalette\.duplicateColor/);
    }
    assert.match(dashboardPage, /takeoff_color_palette\.js[\s\S]*?project_takeoff\.js/);
    assert.match(editorPage, /takeoff_color_palette\.js[\s\S]*?editor\/takeoff\.js/);
});
