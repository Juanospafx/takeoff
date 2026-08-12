const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const parent = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'pages/editor.php'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/takeoff.php'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db/migrations/2026-08-12_takeoff_shared_persistence.sql'), 'utf8');

test('Takeoff geometry uses the database without a browser-state override', () => {
    assert.doesNotMatch(editor, /localTakeoffKey|persistLocalTakeoffState|readLocalTakeoffState/);
    assert.doesNotMatch(parent, /takeoff\.quantification|readSavedTakeoffs/);
    assert.match(editor, /request\('save_state'/);
    assert.match(editor, /request\('state', \{ drawing_id: fileId \}, 'GET'\)/);
    assert.match(parent, /iframe\/API owns persistent Takeoff state/);
});

test('sheet scale schema and API are isolated by drawing and page', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS takeoff_sheet_scales/);
    assert.match(migration, /UNIQUE KEY uq_takeoff_sheet_scale \(drawing_id, page_number\)/);
    assert.match(migration, /FOREIGN KEY \(drawing_id\) REFERENCES files\(id\) ON DELETE CASCADE/);
    assert.match(api, /case 'scale'/);
    assert.match(api, /case 'save_scale'/);
    assert.match(api, /ON DUPLICATE KEY UPDATE/);
    assert.match(api, /WHERE drawing_id = \? AND page_number = \?/);
});

test('editor loads and saves calibration through the shared API', () => {
    assert.match(shell, /takeoffScaleRequest\('scale', \{ drawing_id: fileId, page_number: requestedPage \}\)/);
    assert.match(shell, /takeoffScaleRequest\('save_scale'/);
    assert.match(shell, /requestedPage !== Number\(pageNum \|\| 1\)/);
    assert.doesNotMatch(shell, /localStorage\.setItem\(getCalKey|localStorage\.getItem\(getCalKey/);
});
