<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/auth/session.php';

$action = strtolower(trim((string)($_GET['action'] ?? $_POST['action'] ?? '')));
$readActions = ['export_estimate', 'export_estimate_live'];
$mutationActions = ['import_project', 'import_estimate', 'sync_templates'];

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'export_estimate') {
    $action = 'export_estimate_live';
}

$mutationCapability = $action === 'import_project'
    ? 'project.write'
    : ($action === 'import_estimate' ? 'estimating.write' : null);
$user = takeoff_guard_api_action($action, $readActions, $mutationActions, 'export_estimate', null, true, $mutationCapability);

require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/auth/ProjectAccess.php';
require_once __DIR__ . '/../core/services/ProjectEstimateExcelService.php';

function excel_json_error(
    string $msg,
    int $status = 400,
    ?string $code = null,
    ?string $incidentId = null
): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    $payload = ['status' => 'error', 'msg' => $msg];
    if ($code !== null && $code !== '') {
        $payload['code'] = $code;
    }
    if ($incidentId !== null && $incidentId !== '') {
        $payload['incident_id'] = $incidentId;
    }
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function excel_log_failure(Throwable $error, string $incidentId): void
{
    $message = preg_replace('/\s+/', ' ', trim($error->getMessage())) ?? '';
    $message = preg_replace(
        '/\b(password|passwd|pwd|token|secret|api[_-]?key)\b\s*[:=]\s*("[^"]*"|\'[^\']*\'|[^\s;]+)/i',
        '$1=[redacted]',
        $message
    ) ?? '';
    $message = preg_replace('/(?:[A-Za-z]:[\\\\\/]|\/)[^\s]+/', '[path]', $message) ?? '';
    $message = substr($message, 0, 500);
    error_log(sprintf(
        'ProjectEstimateExcelService failure incident=%s class=%s code=%s message=%s',
        $incidentId,
        get_class($error),
        (string)$error->getCode(),
        $message
    ));
}

function excel_uploaded_workbook(array $upload, string $fallbackName): array
{
    if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        excel_json_error('Please select a valid .xlsx Excel file to import.', 422, 'WORKBOOK_UPLOAD_INVALID');
    }
    $origName = (string)($upload['name'] ?? $fallbackName);
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    if (!in_array($ext, ['xlsx', 'xlsm'], true)) {
        excel_json_error('Only .xlsx Excel files generated from the project export template are supported.', 422, 'WORKBOOK_TYPE_UNSUPPORTED');
    }
    $tmpPath = (string)($upload['tmp_name'] ?? '');
    $reportedSize = (int)($upload['size'] ?? 0);
    $actualSize = $tmpPath !== '' && is_file($tmpPath) ? (int)filesize($tmpPath) : 0;
    $maxBytes = 25 * 1024 * 1024;
    if ($tmpPath === '' || !is_readable($tmpPath) || $actualSize <= 0) {
        excel_json_error('The uploaded Excel workbook could not be read.', 422, 'WORKBOOK_UNREADABLE');
    }
    if ($reportedSize > $maxBytes || $actualSize > $maxBytes) {
        excel_json_error('The Excel workbook exceeds the 25 MB import limit.', 413, 'WORKBOOK_TOO_LARGE');
    }
    return [$origName, $tmpPath];
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
        if ($projectId > 0) {
            takeoff_guard_project_access($pdo, $user, $projectId, ProjectAccess::READ);
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
        if (empty($_FILES['file'])) {
            excel_json_error('Please select a valid .xlsx Excel file to import.', 422);
        }
        [$origName, $tmpPath] = excel_uploaded_workbook($_FILES['file'], 'Imported_Project.xlsx');
        $params = [
            'name' => trim((string)($_POST['name'] ?? '')),
            'status' => trim((string)($_POST['status'] ?? 'to_do')) ?: 'to_do',
            'original_filename' => $origName,
        ];
        $res = ProjectEstimateExcelService::importProjectFromExportedExcel($pdo, $tmpPath, $params);
        $createdProjectId = (int)($res['project_id'] ?? 0);
        if ($createdProjectId > 0) {
            ProjectAccess::grantCreator($pdo, $createdProjectId, (int)$user['user_id']);
        }
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
        takeoff_guard_project_access($pdo, $user, $projectId, ProjectAccess::WRITE);
        if (empty($_FILES['file'])) {
            excel_json_error('Please select a valid .xlsx Excel file to import.', 422);
        }
        [$origName, $tmpPath] = excel_uploaded_workbook($_FILES['file'], 'Imported_Estimate.xlsx');
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
    excel_json_error($e->getMessage(), 503, 'EXCEL_RUNTIME_UNAVAILABLE');
} catch (\PhpOffice\PhpSpreadsheet\Reader\Exception $e) {
    error_log('ProjectEstimateExcelService rejected an unreadable workbook');
    excel_json_error('The uploaded Excel workbook could not be read.', 422, 'WORKBOOK_UNREADABLE');
} catch (Throwable $e) {
    $incidentId = bin2hex(random_bytes(8));
    excel_log_failure($e, $incidentId);
    excel_json_error('Excel operation failed.', 500, 'EXCEL_OPERATION_FAILED', $incidentId);
}
