const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const deploy = read('.github/workflows/deploy.yml');
const excelApi = read('api/project_estimate_excel.php');
const excelService = read('core/services/ProjectEstimateExcelService.php');
const templateService = read('core/services/ProjectTemplateService.php');
const projectModule = read('api/project_module.php');
const bidBoard = read('api/bid_board.php');
const estimatingClient = read('assets/project_estimating.js');

test('deployment places the Excel workbook template in a private runtime path', () => {
    assert.match(deploy, /cp\s+"templates\/Project Estimate Export_Template\.xlsx"/);
    assert.match(deploy, /core\/resources\/Project Estimate Export_Template\.xlsx/);
    assert.match(deploy, /test -f "\$ARTIFACT_DIR\/core\/resources\/Project Estimate Export_Template\.xlsx"/);
    assert.match(excelService, /\.\.\/resources\/Project Estimate Export_Template\.xlsx/);
});

test('Excel operations fail with a safe prerequisite response instead of an opaque 500', () => {
    assert.match(excelService, /class ExcelRuntimeException extends RuntimeException/);
    assert.match(excelService, /function assertRuntimeReady\(\)/);
    assert.match(excelApi, /catch \(ExcelRuntimeException \$e\)/);
    assert.match(excelApi, /excel_json_error\(\$e->getMessage\(\), 503, 'EXCEL_RUNTIME_UNAVAILABLE'\)/);
});

test('direct estimate import commits its authoritative workspace before optional Takeoff projection', () => {
    const importStart = excelService.indexOf('public static function importEstimateTabIntoProject');
    const importEnd = excelService.indexOf('public static function importProjectFromExportedExcel', importStart);
    const importBlock = excelService.slice(importStart, importEnd);
    const authoritativeCommit = importBlock.indexOf('$pdo->commit()');
    const projection = importBlock.indexOf('ProjectTemplateService::ensureTakeoffLayersFromWorkspace');

    assert.ok(authoritativeCommit >= 0, 'the estimate/workspace transaction must commit');
    assert.ok(projection > authoritativeCommit,
        'derived Takeoff rows must be projected only after the authoritative import commits');
    assert.match(importBlock, /catch \(Throwable \$projectionError\)/);
    assert.match(importBlock, /TAKEOFF_PROJECTION_FAILED/);
    assert.match(importBlock, /'warnings'\s*=>\s*\$warnings/);
    const primarySync = importBlock.indexOf('ProjectTemplateService::syncPrimaryEstimateMetadata');
    assert.ok(primarySync >= 0 && primarySync < authoritativeCommit,
        'primary estimate metadata must commit with the authoritative workspace');
});

test('Excel imports reject unreadable and oversized uploads before workbook parsing', () => {
    assert.match(excelApi, /function excel_uploaded_workbook/);
    assert.match(excelApi, /25 \* 1024 \* 1024/);
    assert.match(excelApi, /WORKBOOK_TOO_LARGE/);
    assert.match(excelApi, /is_readable\(\$tmpPath\)/);
    assert.match(excelApi, /excel_uploaded_workbook\(\$_FILES\['file'\]/);
});

test('new and cloned Excel workspaces persist the canonical linked-only sync policy', () => {
    assert.doesNotMatch(excelService, /'takeoffSyncMode'\s*=>\s*'linked'/);
    assert.match(excelService, /'takeoffSyncMode'\s*=>\s*'linked-only'/);
    assert.match(templateService, /in_array\(\$rawSyncMode, \['linked', 'linked-only'\], true\)/);
});

test('unexpected Excel failures return a stable safe code and incident id', () => {
    const genericCatch = excelApi.slice(excelApi.indexOf('} catch (Throwable $e)'));
    assert.match(genericCatch, /EXCEL_OPERATION_FAILED/);
    assert.match(genericCatch, /\$incidentId/);
    assert.match(excelApi, /\$payload\['incident_id'\]\s*=\s*\$incidentId/);
    assert.match(genericCatch, /excel_log_failure\(\$e, \$incidentId\)/);
    assert.doesNotMatch(genericCatch, /excel_json_error\(\$e->getMessage\(\)/,
        'unexpected exception text must never be returned to the browser');
});

test('Estimate import surfaces optional Takeoff projection warnings to the operator', () => {
    assert.match(estimatingClient, /payload\.warnings/);
    assert.match(estimatingClient, /Takeoff setup warning/);
});

test('template cloning never swallows a failed workspace copy', () => {
    const cloneStart = templateService.indexOf('public static function deepCloneProjectWorkspace');
    const cloneEnd = templateService.indexOf('public static function ensureTakeoffLayersFromWorkspace', cloneStart);
    const cloneBlock = templateService.slice(cloneStart, cloneEnd);
    assert.match(cloneBlock, /throw new RuntimeException\('Unable to clone the selected project template\.'/);
    assert.doesNotMatch(cloneBlock, /deep clone warning/);
    assert.match(cloneBlock, /'estimate_number', 'estimating_id', 'takeoff_id', 'bid_id'/);
    assert.match(cloneBlock, /parent_estimate_item_id/);
    assert.match(cloneBlock, /pendingParentLinks/);
    assert.match(cloneBlock, /Project template optional Takeoff projection failed/);
    assert.match(cloneBlock, /try\s*\{\s*ProjectTemplateService|try\s*\{\s*self::ensureTakeoffLayersFromWorkspace/);
});

test('Excel templates can generate Takeoff layers on legacy schemas without estimate_key', () => {
    const projectionStart = templateService.indexOf('public static function ensureTakeoffLayersFromWorkspace');
    const projectionEnd = templateService.indexOf('public static function inferTakeoffTypeFromItem', projectionStart);
    const projectionBlock = templateService.slice(projectionStart, projectionEnd);
    assert.match(projectionBlock, /\$hasEstimateKey\s*=\s*isset\(\$layerCols\['estimate_key'\]\)/);
    assert.match(projectionBlock, /if \(\$hasEstimateKey\)/);
    assert.match(projectionBlock, /WHERE project_id = \? AND deleted_at IS NULL/);
});

test('new projects copy and verify the selected template atomically', () => {
    const instantiateStart = templateService.indexOf('public static function instantiateTemplateIntoProject');
    const instantiateEnd = templateService.indexOf('public static function convertProjectToTemplate', instantiateStart);
    const instantiateBlock = templateService.slice(instantiateStart, instantiateEnd);
    assert.match(instantiateBlock, /sourceEstimateCount/);
    assert.match(instantiateBlock, /targetEstimateStmt/);
    assert.match(instantiateBlock, /workspace was not copied completely/);

    assert.match(projectModule, /templateCreateTransaction/);
    assert.match(projectModule, /instantiateTemplateIntoProject/);
    assert.match(projectModule, /\$pdo->rollBack\(\)/);

    const bidCreateStart = bidBoard.indexOf("case 'create_project':");
    const bidCreateEnd = bidBoard.indexOf("case 'delete':", bidCreateStart);
    const bidCreateBlock = bidBoard.slice(bidCreateStart, bidCreateEnd);
    assert.match(bidCreateBlock, /instantiateTemplateIntoProject/);
    assert.match(bidCreateBlock, /ownsCreateTransaction/);
    assert.match(bidCreateBlock, /\$pdo->rollBack\(\)/);
});
