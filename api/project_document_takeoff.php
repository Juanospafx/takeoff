<?php
if (session_status() !== PHP_SESSION_ACTIVE) session_start();
require_once __DIR__ . '/../core/db/connection.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed.']);
        exit;
    }
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $projectValue = $_POST['project_id'] ?? ($body['project_id'] ?? null);
    $projectId = is_numeric($projectValue) ? (int)$projectValue : 0;
    if ($projectId < 1) throw new RuntimeException('A valid project is required.');

    if (!empty($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $original = basename((string)$_FILES['file']['name']);
        $extension = strtolower(pathinfo($original, PATHINFO_EXTENSION));
        $allowedExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'dwg', 'dxf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf', 'ppt', 'pptx', 'zip'];
        if (!$extension || !in_array($extension, $allowedExtensions, true)) throw new RuntimeException('Unsupported document format.');
        $targetDir = __DIR__ . '/../uploads/';
        if (!is_dir($targetDir) && !mkdir($targetDir, 0755, true)) throw new RuntimeException('Upload directory is unavailable.');
        $storedName = bin2hex(random_bytes(8)) . '_' . preg_replace('/[^A-Za-z0-9._-]/', '_', $original);
        if (!move_uploaded_file($_FILES['file']['tmp_name'], $targetDir . $storedName)) throw new RuntimeException('Unable to store drawing.');
        $uploadedBy = !empty($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : 1;
        $path = 'uploads/' . $storedName;
        $insert = $pdo->prepare('INSERT INTO files (project_id,folder_id,filename,filepath,file_type,uploaded_by,version_number) VALUES (?,NULL,?,?,?,?,1)');
        $insert->execute([$projectId, $original, $path, $extension, $uploadedBy]);
        echo json_encode(['success' => true, 'file' => ['id' => (int)$pdo->lastInsertId(), 'filename' => $original, 'filepath' => $path, 'file_type' => $extension]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    $documentId = is_numeric($body['document_id'] ?? null) ? (int)$body['document_id'] : 0;
    if ($documentId < 1) throw new RuntimeException('A valid project document is required.');

    $stmt = $pdo->prepare('SELECT * FROM project_documents WHERE id=? AND project_id=? AND deleted_at IS NULL LIMIT 1');
    $stmt->execute([$documentId, $projectId]);
    $document = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$document) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Project document not found.']);
        exit;
    }

    $path = ltrim(str_replace('\\', '/', (string)$document['storage_path']), '/');
    $pathWithoutApi = strpos($path, 'api/') === 0 ? substr($path, 4) : $path;
    $lookup = $pdo->prepare('SELECT id,filename,filepath,file_type FROM files WHERE project_id=? AND (filepath=? OR filepath=?) ORDER BY id DESC LIMIT 1');
    $lookup->execute([$projectId, $path, $pathWithoutApi]);
    $file = $lookup->fetch(PDO::FETCH_ASSOC);

    if (!$file) {
        $filename = (string)($document['original_filename'] ?: $document['title']);
        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $uploadedBy = !empty($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : 1;
        $insert = $pdo->prepare('INSERT INTO files (project_id,folder_id,filename,filepath,file_type,uploaded_by,version_number) VALUES (?,NULL,?,?,?,?,1)');
        $insert->execute([$projectId, $filename, $pathWithoutApi, $extension ?: (string)$document['mime_type'], $uploadedBy]);
        $file = ['id' => (int)$pdo->lastInsertId(), 'filename' => $filename, 'filepath' => $pathWithoutApi, 'file_type' => $extension];
    }

    echo json_encode(['success' => true, 'file' => $file], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('project_document_takeoff.php: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to prepare this document for Takeoff.']);
}
