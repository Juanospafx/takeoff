const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Start Takeoff validates legacy and project documents through one storage resolver', () => {
  const api = read('api/project_document_takeoff.php');
  assert.match(api, /takeoff_resolve_stored_file/);
  assert.match(api, /source.*legacy_file.*project_document/s);
  assert.match(api, /uploaded drawing file could not be found/);
});

test('shared resolver supports current and historical upload roots without escaping them', () => {
  const resolver = read('core/files/upload_storage.php');
  assert.match(resolver, /workspace \. '\/uploads'/);
  assert.match(resolver, /workspace \. '\/api\/uploads'/);
  assert.match(resolver, /realpath/);
  assert.match(resolver, /DIRECTORY_SEPARATOR/);
});

test('Documents always prepares persisted drawings before loading editor', () => {
  const overview = read('assets/project_overview.js');
  assert.match(overview, /if \(doc\.source === 'existing'\)/);
  assert.match(overview, /source: doc\.originalSource \|\| 'legacy_file'/);
  assert.match(overview, /startTakeoffInFlight/);
  assert.match(overview, /sessionFiles\.delete/);
  assert.match(overview, /URL\.revokeObjectURL/);
  assert.match(overview, /path: `\.\.\/\$\{result\.file\.filepath\}`/);
});

test('editor resolves a physical upload before exposing its URL', () => {
  const editor = read('pages/editor.php');
  assert.match(editor, /takeoff_resolve_stored_file/);
  assert.match(editor, /uploaded drawing file is missing/);
  assert.match(editor, /resolvedDrawing\['public_path'\]/);
});

test('document API refuses Start Takeoff when its physical upload is missing', () => {
  const api = read('api/project_documents.php');
  assert.match(api, /if \(\$action === 'start_takeoff'\)[\s\S]*pdoc_storage_path/);
});

test('Takeoff bridge tolerates legacy document schemas and returns operable errors', () => {
  const api = read('api/project_document_takeoff.php');
  assert.match(api, /SHOW COLUMNS FROM/);
  assert.match(api, /\['storage_path', 'filepath', 'file_path', 'path'\]/);
  assert.match(api, /takeoff_active_clause\(\$documentColumns\)/);
  assert.match(api, /DOCUMENT_SCHEMA_UNAVAILABLE/);
  assert.match(api, /TAKEOFF_PREPARATION_FAILED/);
  assert.match(api, /errorId/);
  assert.match(api, /takeoff_json_error\(422/);
  assert.match(api, /takeoff_json_error\(415/);
});
