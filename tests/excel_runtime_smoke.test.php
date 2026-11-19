<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require_once $root . '/core/services/ProjectEstimateExcelService.php';

ProjectEstimateExcelService::assertRuntimeReady();

$source = $root . '/templates/Project Estimate Export_Template.xlsx';
if (!is_readable($source)) {
    throw new RuntimeException('Excel export template fixture is missing.');
}

$spreadsheet = \PhpOffice\PhpSpreadsheet\IOFactory::load($source);
$temporary = tempnam(sys_get_temp_dir(), 'takeoff_excel_smoke_');
if ($temporary === false) {
    throw new RuntimeException('Unable to allocate Excel smoke-test output.');
}

try {
    (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($spreadsheet))->save($temporary);
    if (!is_file($temporary) || filesize($temporary) <= 0) {
        throw new RuntimeException('Excel writer produced no output.');
    }
} finally {
    $spreadsheet->disconnectWorksheets();
    @unlink($temporary);
}

echo "Excel runtime smoke test: PASS\n";
