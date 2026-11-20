<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/auth/session.php';

$action = strtolower(trim((string)($_GET['action'] ?? $_POST['action'] ?? '')));
$readActions = ['export_estimate'];
$mutationActions = ['export_estimate_live', 'import_project', 'import_estimate', 'sync_templates'];

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'export_estimate') {
    $action = 'export_estimate_live';
}

$user = takeoff_guard_api_action($action, $readActions, $mutationActions, 'export_estimate');

require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/services/ProjectEstimateExcelService.php';

function excel_json_error(string $msg, int $status = 400): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['status' => 'error', 'msg' => $msg], JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    if ($action === 'export_estimate' || $action === 'export_estimate_live') {
        $projectId = (int)($_GET['project_id'] ?? $_POST['project_id'] ?? 0);
        $clientEstimateId = trim((string)($_GET['estimate_id'] ?? $_POST['estimate_id'] ?? ''));
        $livePayload = null;
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $rawBody = file_get_contents('php://input');
            $decoded = json_decode((string)$rawBody, true);
            if (is_array($decoded)) {
                $livePayload = $decoded;
                if ($projectId <= 0 && !empty($decoded['project_id'])) {
                    $projectId = (int)$decoded['project_id'];
                }
                if ($clientEstimateId === '' && !empty($decoded['estimate_id'])) {
                    $clientEstimateId = trim((string)$decoded['estimate_id']);
                }
            }
        }
        if ($projectId <= 0 && empty($livePayload['estimate'])) {
            excel_json_error('Valid project_id or estimate payload is required.', 422);
        }

        $result = ProjectEstimateExcelService::exportEstimateWorkbook(
            $pdo,
            $projectId,
            $clientEstimateId !== '' ? $clientEstimateId : null,
            $livePayload
        );

        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $result['filename']) . '"');
        header('Cache-Control: max-age=0');
        header('Content-Length: ' . strlen($result['content']));
        echo $result['content'];
        exit;
    }

    if ($action === 'import_project') {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            excel_json_error('POST required.', 405);
        }
        if (empty($_FILES['file']) || ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            excel_json_error('Please select a valid .xlsx Excel file to import.', 422);
        }
        $origName = (string)($_FILES['file']['name'] ?? 'Imported_Project.xlsx');
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        if (!in_array($ext, ['xlsx', 'xlsm'], true)) {
            excel_json_error('Only .xlsx Excel files generated from the project export template are supported.', 422);
        }
        $tmpPath = (string)$_FILES['file']['tmp_name'];
        $params = [
            'name' => trim((string)($_POST['name'] ?? '')),
            'status' => trim((string)($_POST['status'] ?? 'to_do')) ?: 'to_do',
            'original_filename' => $origName,
        ];
        $res = ProjectEstimateExcelService::importProjectFromExportedExcel($pdo, $tmpPath, $params);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['status' => 'success'] + $res, JSON_UNESCAPED_SLASHES);
        exit;
    }

    if ($action === 'import_estimate') {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            excel_json_error('POST required.', 405);
        }
        $projectId = (int)($_POST['project_id'] ?? $_GET['project_id'] ?? 0);
        if ($projectId <= 0) {
            excel_json_error('Valid project_id is required.', 422);
        }
        if (empty($_FILES['file']) || ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            excel_json_error('Please select a valid .xlsx Excel file to import.', 422);
        }
        $origName = (string)($_FILES['file']['name'] ?? 'Imported_Estimate.xlsx');
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        if (!in_array($ext, ['xlsx', 'xlsm'], true)) {
            excel_json_error('Only .xlsx Excel files generated from the project export template are supported.', 422);
        }
        $tmpPath = (string)$_FILES['file']['tmp_name'];
        $mode = trim((string)($_POST['import_mode'] ?? 'keep_excel'));
        $params = [
            'estimate_name' => trim((string)($_POST['estimate_name'] ?? '')),
            'original_filename' => $origName,
            'zero_quantities' => in_array($mode, ['zero_qty_keep_prices', 'zero_qty_refresh_prices'], true)
                || ($_POST['zero_quantities'] ?? '') === '1',
            'relink_catalog' => $mode !== 'standalone_exact'
                && ($_POST['relink_catalog'] ?? '1') !== '0',
            'refresh_catalog_prices' => in_array($mode, ['keep_qty_refresh_prices', 'zero_qty_refresh_prices'], true)
                || ($_POST['refresh_catalog_prices'] ?? '') === '1',
        ];
        $res = ProjectEstimateExcelService::importEstimateTabIntoProject($pdo, $projectId, $tmpPath, $params);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['status' => 'success'] + $res, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'sync_templates') {
        $results = ProjectEstimateExcelService::syncDirectoryTemplates($pdo);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['status' => 'success', 'templates' => $results], JSON_UNESCAPED_SLASHES);
        exit;
    }

    excel_json_error('Unsupported action.', 404);
} catch (ExcelRuntimeException $e) {
    error_log('ProjectEstimateExcelService runtime prerequisite failed');
    excel_json_error($e->getMessage(), 503);
} catch (\PhpOffice\PhpSpreadsheet\Reader\Exception $e) {
    error_log('ProjectEstimateExcelService rejected an unreadable workbook');
    excel_json_error('The uploaded Excel workbook could not be read.', 422);
} catch (Throwable $e) {
    $incidentId = bin2hex(random_bytes(8));
    error_log("ProjectEstimateExcelService failure: {$incidentId}");
    excel_json_error('Excel operation failed.', 500);
}
