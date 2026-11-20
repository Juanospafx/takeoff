const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pages', 'bid_board.php'), 'utf8');
const client = fs.readFileSync(path.join(root, 'assets', 'bid_board.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'bid_board.css'), 'utf8');
const service = fs.readFileSync(path.join(root, 'core', 'services', 'ProjectEstimateExcelService.php'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'api', 'project_estimate_excel.php'), 'utf8');

test('Excel project mode owns a stable visible Create Project action', () => {
    assert.match(page, /id="bbProjectSubmitBtn"[^>]*type="submit"/);
    assert.match(client, /function\s+syncExcelImportUi\s*\(/);
    assert.match(client, /submitBtn\.disabled\s*=\s*mode\s*===\s*['"]excel['"]\s*&&\s*!validFile/);
    assert.match(client, /isValidProjectExcelFile\s*\(/);
});

test('input selection, drop and mode changes all synchronize the Excel action state', () => {
    assert.match(client, /excelInput\.addEventListener\(['"]change['"][\s\S]*?syncExcelImportUi\s*\(/);
    assert.match(client, /excelDropzone\.addEventListener\(['"]drop['"][\s\S]*?syncExcelImportUi\s*\(/);
    assert.match(client, /input\[name="bbProjectMode"\][\s\S]*?toggleProjectTemplate[\s\S]*?syncExcelImportUi\s*\(/);
});

test('Excel action is enabled only for a valid workbook', () => {
    const start = client.indexOf('function isValidProjectExcelFile');
    const end = client.indexOf('async function createProjectDraft', start);
    assert.ok(start >= 0 && end > start);
    const mode = { value: 'excel' };
    const input = { files: [] };
    const submit = { hidden: true, disabled: false, attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } };
    const dropzone = { classList: { toggle() {} } };
    const document = {
        querySelector() { return mode; },
        getElementById(id) {
            return ({ bbProjectExcelFile: input, bbProjectSubmitBtn: submit, bbProjectExcelDropzone: dropzone })[id] || null;
        }
    };
    const sandbox = { document };
    vm.runInNewContext(`${client.slice(start, end)}; globalThis.testApi = { syncExcelImportUi };`, sandbox);

    sandbox.testApi.syncExcelImportUi();
    assert.equal(submit.hidden, false);
    assert.equal(submit.disabled, true);

    input.files = [{ name: 'estimate.csv', size: 10 }];
    sandbox.testApi.syncExcelImportUi();
    assert.equal(submit.disabled, true);

    input.files = [{ name: 'estimate.XLSX', size: 10 }];
    sandbox.testApi.syncExcelImportUi();
    assert.equal(submit.disabled, false);

    mode.value = 'template';
    input.files = [];
    sandbox.testApi.syncExcelImportUi();
    assert.equal(submit.disabled, false);
});

test('Create Project footer cannot shrink or scroll outside the modal viewport', () => {
    assert.match(css, /\.bb-create-project-modal\s+\.bb-modal-foot\s*\{[^}]*flex:\s*0\s+0\s+auto;[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s);
});

test('Excel project import inserts estimates using discovered schema columns', () => {
    assert.match(service, /function\s+insertEstimateCompatible\s*\(/);
    assert.match(service, /ProjectTemplateService::tableColumns\(\$pdo,\s*['"]estimates['"]\)/);
    const importProject = service.slice(
        service.indexOf('public static function importProjectFromExportedExcel'),
        service.indexOf('private static function makeStandaloneItemFromExcelRow')
    );
    assert.match(importProject, /self::insertEstimateCompatible\s*\(/);
    assert.doesNotMatch(importProject, /INSERT INTO estimates \(project_id, name, description, status, currency_code, settings_json/);
});

test('optional Takeoff projection cannot roll back the imported project workspace', () => {
    const importProject = service.slice(
        service.indexOf('public static function importProjectFromExportedExcel'),
        service.indexOf('private static function makeStandaloneItemFromExcelRow')
    );
    assert.ok(importProject.indexOf('$pdo->commit();') < importProject.indexOf('ProjectTemplateService::ensureTakeoffLayersFromWorkspace'));
    assert.match(importProject, /catch \(Throwable \$projectionError\)/);
    assert.match(importProject, /if \(\$pdo->inTransaction\(\)\) \$pdo->rollBack\(\);/);
    assert.match(importProject, /error_log\('Excel project import optional Takeoff projection failed'\)/);
    assert.doesNotMatch(importProject, /projectionError->getMessage/);
});

test('Excel import failures remain generic and never log raw database errors', () => {
    assert.match(endpoint, /bin2hex\(random_bytes\(8\)\)/);
    assert.match(endpoint, /error_log\("ProjectEstimateExcelService failure: \{\$incidentId\}"\)/);
    assert.doesNotMatch(endpoint, /error_log\([^)]*getMessage\(\)/);
    assert.match(endpoint, /excel_json_error\('Excel operation failed\.', 500\)/);
});
