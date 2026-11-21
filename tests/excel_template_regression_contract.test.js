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
    assert.match(excelApi, /excel_json_error\(\$e->getMessage\(\), 503\)/);
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
