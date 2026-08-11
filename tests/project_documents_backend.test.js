const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'project_documents.php'), 'utf8');

test('document mutations are scoped by project, source and active rows', () => {
    assert.match(api, /in_array\(\$source, array\('legacy_file', 'project_document'\)/);
    assert.match(api, /WHERE id=\? AND project_id=\?[\s\S]*deleted_at IS NULL/);
    assert.match(api, /UPDATE `\$table` SET deleted_at=CURRENT_TIMESTAMP WHERE id=\? AND project_id=\? AND deleted_at IS NULL/);
    assert.doesNotMatch(api, /unlink\(/, 'delete must remain recoverable');
});

test('rename preserves file type and never changes the physical storage path', () => {
    assert.match(api, /extension_change_not_allowed/);
    assert.match(api, /UPDATE files SET filename=\?/);
    assert.match(api, /UPDATE project_documents SET title=\?,original_filename=\?/);
    assert.doesNotMatch(api, /rename\s*\(/, 'backend rename is logical and must not move storage files');
});

test('download resolves only real files contained by approved upload roots', () => {
    assert.ok(api.includes("realpath(__DIR__ . '/..')"));
    assert.match(api, /strpos\(\$real, \$root \. DIRECTORY_SEPARATOR\) === 0/);
    assert.match(api, /Content-Disposition: attachment/);
    assert.match(api, /X-Content-Type-Options: nosniff/);
    assert.match(api, /readfile\(\$path\)/);
});

test('start takeoff returns a normalized document and deterministic navigation payload', () => {
    assert.match(api, /if \(\$action === 'start_takeoff'\)/);
    assert.match(api, /unsupported_drawing/);
    assert.match(api, /'tab' => 'takeoff'/);
    assert.match(api, /'project_id' => \$projectId, 'document_id' => \$documentId, 'source' => \$source/);
    assert.match(api, /'ok' => true, 'success' => true, 'document'/);
});

test('project document rename and delete also update the Takeoff files mirror by scoped storage path', () => {
    assert.match(api, /function pdoc_mirror_paths/);
    assert.match(api, /UPDATE files SET filename=\? WHERE project_id=\? AND deleted_at IS NULL AND filepath IN/);
    assert.match(api, /UPDATE files SET deleted_at=CURRENT_TIMESTAMP WHERE project_id=\? AND deleted_at IS NULL AND filepath IN/);
});
