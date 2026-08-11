const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const overview = fs.readFileSync(path.join(root, 'assets', 'project_overview.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'project_document_takeoff.php'), 'utf8');
const page = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');

test('Start Takeoff resolves project_documents to the files identity consumed by editor.php', () => {
    assert.match(overview, /async function startDocumentsTakeoff/);
    assert.match(overview, /originalSource === 'project_document'[\s\S]*project_document_takeoff\.php/);
    assert.match(overview, /takeoffFileId = Number\(result\.file\.id\)/);
    assert.match(overview, /source: 'legacy_file'/);
    assert.match(overview, /editor\.php\?id=\$\{encodeURIComponent\(takeoffFileId\)\}/);
});

test('bridge is project-scoped, idempotent and reuses the physical PDF', () => {
    assert.match(api, /FROM project_documents WHERE id=\? AND project_id=\?/);
    assert.match(api, /FROM files WHERE project_id=\? AND \(filepath=\? OR filepath=\?\)/);
    assert.match(api, /if \(!\$file\)[\s\S]*INSERT INTO files/);
    assert.match(api, /JSON_UNESCAPED_SLASHES/);
    assert.match(page, /project_overview\.js\?v=project-documents-20260811-3/);
});

test('session PDFs are uploaded persistently before opening Takeoff', () => {
    assert.match(overview, /doc\.source === 'local'[\s\S]*sessionFiles\.get/);
    assert.match(overview, /new FormData\(\)[\s\S]*form\.append\('file', file/);
    assert.match(overview, /Select this PDF again/);
    assert.match(api, /\$_FILES\['file'\][\s\S]*move_uploaded_file/);
    assert.match(api, /\['pdf', 'png', 'jpg', 'jpeg', 'webp'\]/);
});
