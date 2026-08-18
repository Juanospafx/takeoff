const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'takeoff.php'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');

test('Takeoff autosave identifies only pages changed by this client', () => {
    assert.match(editor, /const dirtyTakeoffPages = new Set\(\)/);
    assert.match(editor, /dirtyTakeoffPages\.add\(Number\(pageNum \|\| 1\)\)/);
    assert.match(editor, /dirty_page_numbers: sentPages/);
    assert.match(editor, /dirtyTakeoffPageGenerations/);
});

test('server serializes and merges dirty pages without replacing other sheets', () => {
    assert.match(api, /function merge_takeoff_pages/);
    assert.match(api, /SELECT state_json FROM takeoff_drawing_states WHERE drawing_id = \? LIMIT 1 FOR UPDATE/);
    assert.match(api, /merge_takeoff_pages\(\$currentSnapshot, \$snapshot, \$dirtyPages\)/);
    assert.ok(api.indexOf('FOR UPDATE') < api.indexOf('DELETE FROM takeoff_count_markers WHERE layer_id IN'));
});
