<?php
declare(strict_types=1);

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../../funciones/file_names.php';

class FilesController
{
    private $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    private function cleanName(string $name): string
    {
        return clean_filename($name);
    }

    public function store(): void
    {
        if (!isset($_FILES['file'])) {
            error_response('VALIDATION_ERROR', 'No file uploaded', ['field' => 'file'], 422);
        }

        $projectId = require_int($_POST['project_id'] ?? null);
        if (!$projectId) {
            error_response('VALIDATION_ERROR', 'Invalid project_id', ['field' => 'project_id'], 422);
        }

        $folderId = !empty($_POST['folder_id']) ? require_int($_POST['folder_id']) : null;
        $subFolderId = !empty($_POST['sub_folder_id']) ? require_int($_POST['sub_folder_id']) : null;

        // Size limit: 1GB
        $maxSize = 1073741824;
        if ($_FILES['file']['size'] > $maxSize) {
            error_response('VALIDATION_ERROR', 'File exceeds 1GB limit', null, 422);
        }

        $allowedExts = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'];
        $origName = $_FILES['file']['name'];
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

        if (!in_array($ext, $allowedExts, true)) {
            error_response('VALIDATION_ERROR', 'Invalid file type', null, 422);
        }

        $sqlCheck = "SELECT id, version_group_id, version_number FROM files\n                     WHERE project_id = ? AND filename = ? AND deleted_at IS NULL";
        $params = [$projectId, $origName];

        if ($folderId) {
            $sqlCheck .= " AND folder_id = ?";
            $params[] = $folderId;
        } else {
            $sqlCheck .= " AND folder_id IS NULL";
        }

        if ($subFolderId) {
            $sqlCheck .= " AND sub_folder_id = ?";
            $params[] = $subFolderId;
        } else {
            $sqlCheck .= " AND sub_folder_id IS NULL";
        }

        $sqlCheck .= " ORDER BY version_number DESC LIMIT 1";

        try {
            $stmtCheck = $this->pdo->prepare($sqlCheck);
            $stmtCheck->execute($params);
            $existing = $stmtCheck->fetch(PDO::FETCH_ASSOC);

            $versionGroup = uniqid('vgroup_');
            $versionNum = 1;

            if ($existing) {
                $versionGroup = $existing['version_group_id'] ?: uniqid('vgroup_');
                $versionNum = (int)$existing['version_number'] + 1;
                if (!$existing['version_group_id']) {
                    $this->pdo
                        ->prepare("UPDATE files SET version_group_id = ? WHERE id = ?")
                        ->execute([$versionGroup, $existing['id']]);
                }
            }

            $fileName = time() . '_' . $this->cleanName($origName);
            $targetDir = __DIR__ . '/../../uploads/';
            if (!file_exists($targetDir)) {
                mkdir($targetDir, 0755, true);
            }

            $targetPath = $targetDir . $fileName;
            $type = $ext;

            if (!move_uploaded_file($_FILES['file']['tmp_name'], $targetPath)) {
                error_response('INTERNAL_ERROR', 'Upload failed', null, 500);
            }

            $publicPath = 'uploads/' . $fileName;

            $stmt = $this->pdo->prepare(
                "INSERT INTO files\n                 (project_id, folder_id, sub_folder_id, filename, filepath, file_type, uploaded_by, version_group_id, version_number)\n                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );

            $uploadedBy = null;
            $stmt->execute([
                $projectId,
                $folderId,
                $subFolderId,
                $origName,
                $publicPath,
                $type,
                $uploadedBy,
                $versionGroup,
                $versionNum
            ]);

            ok_response(['stored' => true], null, 201);

        } catch (Exception $e) {
            error_response('INTERNAL_ERROR', 'Unexpected error', null, 500);
        }
    }
}
