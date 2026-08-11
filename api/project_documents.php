<?php
require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/db/connection.php';

function pdoc_json($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function pdoc_error($code, $message, $status = 400) {
    pdoc_json(array('ok' => false, 'success' => false, 'error' => array('code' => $code, 'message' => $message)), $status);
}
function pdoc_int($value) { return is_numeric($value) ? max(0, (int)$value) : 0; }
function pdoc_body() {
    $decoded = json_decode(file_get_contents('php://input'), true);
    return is_array($decoded) ? $decoded : array();
}
function pdoc_source($value) {
    $source = (string)$value;
    if (!in_array($source, array('legacy_file', 'project_document'), true)) pdoc_error('invalid_source', 'A valid document source is required.', 422);
    return $source;
}
function pdoc_row(PDO $pdo, $projectId, $documentId, $source, $includeDeleted = false) {
    $active = $includeDeleted ? '' : ' AND deleted_at IS NULL';
    if ($source === 'legacy_file') {
        $stmt = $pdo->prepare('SELECT id,project_id,filename AS title,filename,filepath AS storage_path,file_type AS mime_type,uploaded_at AS created_at,deleted_at FROM files WHERE id=? AND project_id=?' . $active . ' LIMIT 1');
    } else {
        $stmt = $pdo->prepare('SELECT id,project_id,title,original_filename AS filename,storage_path,mime_type,created_at,deleted_at FROM project_documents WHERE id=? AND project_id=?' . $active . ' LIMIT 1');
    }
    $stmt->execute(array($documentId, $projectId));
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) pdoc_error('document_not_found', 'Document not found in this project.', 404);
    $row['id'] = (int)$row['id'];
    $row['project_id'] = (int)$row['project_id'];
    $row['source'] = $source;
    $row['extension'] = strtolower(pathinfo((string)$row['filename'], PATHINFO_EXTENSION));
    unset($row['storage_path'], $row['deleted_at']);
    return $row;
}
function pdoc_storage_path(PDO $pdo, $projectId, $documentId, $source) {
    $column = $source === 'legacy_file' ? 'filepath' : 'storage_path';
    $table = $source === 'legacy_file' ? 'files' : 'project_documents';
    $stmt = $pdo->prepare("SELECT `$column` FROM `$table` WHERE id=? AND project_id=? AND deleted_at IS NULL LIMIT 1");
    $stmt->execute(array($documentId, $projectId));
    $stored = (string)$stmt->fetchColumn();
    if ($stored === '' || strpos($stored, "\0") !== false || preg_match('~^[a-z]+://~i', $stored)) pdoc_error('file_not_found', 'Stored file is unavailable.', 404);
    $relative = ltrim(str_replace('\\', '/', $stored), '/');
    $relative = preg_replace('~^(?:\.\./)+~', '', $relative);
    $workspace = realpath(__DIR__ . '/..');
    $allowedRoots = array_filter(array(realpath($workspace . '/uploads'), realpath(__DIR__ . '/uploads')));
    $candidates = array($workspace . '/' . $relative, __DIR__ . '/' . $relative);
    foreach ($candidates as $candidate) {
        $real = realpath($candidate);
        if (!$real || !is_file($real)) continue;
        foreach ($allowedRoots as $root) {
            if ($real === $root || strpos($real, $root . DIRECTORY_SEPARATOR) === 0) return $real;
        }
    }
    pdoc_error('file_not_found', 'Stored file is unavailable.', 404);
}
function pdoc_mirror_paths(PDO $pdo, $projectId, $documentId) {
    $stmt = $pdo->prepare('SELECT storage_path FROM project_documents WHERE id=? AND project_id=? AND deleted_at IS NULL LIMIT 1');
    $stmt->execute(array($documentId, $projectId));
    $path = ltrim(str_replace('\\', '/', (string)$stmt->fetchColumn()), '/');
    if ($path === '') return array();
    return strpos($path, 'api/') === 0 ? array($path, substr($path, 4)) : array($path);
}

$body = pdoc_body();
$action = (string)($_GET['action'] ?? $body['action'] ?? $_POST['action'] ?? 'get');
$projectId = pdoc_int($_GET['project_id'] ?? $body['project_id'] ?? $_POST['project_id'] ?? 0);
$documentId = pdoc_int($_GET['document_id'] ?? $body['document_id'] ?? $_POST['document_id'] ?? 0);
$source = pdoc_source($_GET['source'] ?? $body['source'] ?? $_POST['source'] ?? '');
if (!$projectId || !$documentId) pdoc_error('invalid_request', 'project_id and document_id are required.', 422);

if ($action === 'get') pdoc_json(array('ok' => true, 'success' => true, 'document' => pdoc_row($pdo, $projectId, $documentId, $source)));

if ($action === 'rename') {
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') pdoc_error('method_not_allowed', 'POST is required.', 405);
    $current = pdoc_row($pdo, $projectId, $documentId, $source);
    $pdo->beginTransaction();
    $name = trim((string)($body['name'] ?? $_POST['name'] ?? ''));
    $name = basename(str_replace('\\', '/', $name));
    if ($name === '' || strlen($name) > 255) pdoc_error('invalid_name', 'Enter a valid document name.', 422);
    $oldExt = strtolower(pathinfo($current['filename'], PATHINFO_EXTENSION));
    $newExt = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if ($newExt === '' && $oldExt !== '') $name .= '.' . $oldExt;
    elseif ($oldExt !== '' && $newExt !== $oldExt) pdoc_error('extension_change_not_allowed', 'Renaming cannot change the document type.', 422);
    if ($source === 'legacy_file') {
        $stmt = $pdo->prepare('UPDATE files SET filename=? WHERE id=? AND project_id=? AND deleted_at IS NULL');
        $stmt->execute(array($name, $documentId, $projectId));
    } else {
        $mirrorPaths = pdoc_mirror_paths($pdo, $projectId, $documentId);
        $title = pathinfo($name, PATHINFO_FILENAME) ?: $name;
        $stmt = $pdo->prepare('UPDATE project_documents SET title=?,original_filename=? WHERE id=? AND project_id=? AND deleted_at IS NULL');
        $stmt->execute(array($title, $name, $documentId, $projectId));
        if ($mirrorPaths) {
            $marks = implode(',', array_fill(0, count($mirrorPaths), '?'));
            $pdo->prepare("UPDATE files SET filename=? WHERE project_id=? AND deleted_at IS NULL AND filepath IN ($marks)")->execute(array_merge(array($name, $projectId), $mirrorPaths));
        }
    }
    $renamed = pdoc_row($pdo, $projectId, $documentId, $source);
    $pdo->commit();
    pdoc_json(array('ok' => true, 'success' => true, 'document' => $renamed));
}

if ($action === 'delete') {
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') pdoc_error('method_not_allowed', 'POST is required.', 405);
    pdoc_row($pdo, $projectId, $documentId, $source);
    $pdo->beginTransaction();
    $mirrorPaths = $source === 'project_document' ? pdoc_mirror_paths($pdo, $projectId, $documentId) : array();
    $table = $source === 'legacy_file' ? 'files' : 'project_documents';
    $stmt = $pdo->prepare("UPDATE `$table` SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=? AND deleted_at IS NULL");
    $stmt->execute(array($documentId, $projectId));
    if ($mirrorPaths) {
        $marks = implode(',', array_fill(0, count($mirrorPaths), '?'));
        $pdo->prepare("UPDATE files SET deleted_at=CURRENT_TIMESTAMP WHERE project_id=? AND deleted_at IS NULL AND filepath IN ($marks)")->execute(array_merge(array($projectId), $mirrorPaths));
    }
    $pdo->commit();
    pdoc_json(array('ok' => true, 'success' => true, 'deleted' => true, 'document_id' => $documentId, 'source' => $source));
}

if ($action === 'download') {
    $document = pdoc_row($pdo, $projectId, $documentId, $source);
    $path = pdoc_storage_path($pdo, $projectId, $documentId, $source);
    header('Content-Type: ' . ($document['mime_type'] ?: 'application/octet-stream'));
    header('Content-Length: ' . filesize($path));
    header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($document['filename']));
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
}

if ($action === 'start_takeoff') {
    $document = pdoc_row($pdo, $projectId, $documentId, $source);
    if (!in_array($document['extension'], array('pdf', 'png', 'jpg', 'jpeg', 'webp'), true)) pdoc_error('unsupported_drawing', 'This document type cannot be used for takeoff.', 422);
    pdoc_json(array('ok' => true, 'success' => true, 'document' => $document, 'takeoff' => array(
        'project_id' => $projectId, 'document_id' => $documentId, 'source' => $source,
        'tab' => 'takeoff', 'url' => '../pages/project_dashboard.php?id=' . $projectId . '&tab=takeoff&document_id=' . $documentId
    )));
}

pdoc_error('unknown_action', 'Unknown document action.', 404);
