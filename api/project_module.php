<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/db/connection.php';

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
$action = $_GET['action'] ?? $_POST['action'] ?? $input['action'] ?? 'list';

function project_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function project_int($value, int $default = 0): int
{
    return is_numeric($value) ? (int)$value : $default;
}

function project_date_or_null($value): ?string
{
    $value = trim((string)($value ?? ''));
    if ($value === '') return null;
    try {
        $date = new DateTimeImmutable($value);
    } catch (Throwable $e) {
        return null;
    }
    $year = (int)$date->format('Y');
    if ($year < 2000 || $year > 2100) return null;
    return $date->format('Y-m-d');
}

function project_datetime_or_null($value): ?string
{
    $value = trim((string)($value ?? ''));
    if ($value === '') return null;
    try {
        $date = new DateTimeImmutable($value);
    } catch (Throwable $e) {
        return null;
    }
    $year = (int)$date->format('Y');
    if ($year < 2000 || $year > 2100) return null;
    return $date->format('Y-m-d H:i:s');
}

function project_json_value($value): ?string
{
    if ($value === null || $value === '') return null;
    if (is_string($value)) {
        json_decode($value, true);
        if (json_last_error() === JSON_ERROR_NONE) return $value;
    }
    $encoded = json_encode($value, JSON_UNESCAPED_SLASHES);
    return $encoded === false ? null : $encoded;
}

function project_table_exists(PDO $pdo, string $table): bool
{
    $stmt = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1');
    $stmt->execute([$table]);
    return (bool)$stmt->fetchColumn();
}

function project_ensure_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS project_templates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        trade VARCHAR(100) NULL,
        settings_json JSON NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_project_templates_active_deleted (active, deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS projects (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        project_template_id BIGINT UNSIGNED NULL,
        estimator_id BIGINT UNSIGNED NULL,
        project_number VARCHAR(100) NULL,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        client_name VARCHAR(191) NULL,
        job_address VARCHAR(255) NULL,
        city VARCHAR(100) NULL,
        state VARCHAR(100) NULL,
        postal_code VARCHAR(30) NULL,
        country VARCHAR(100) NULL,
        bid_due_at DATETIME NULL,
        start_date DATE NULL,
        end_date DATE NULL,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_projects_template (project_template_id),
        KEY idx_projects_status_deleted (status, deleted_at),
        KEY idx_projects_bid_due (bid_due_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $columns = $pdo->query("SHOW COLUMNS FROM projects")->fetchAll(PDO::FETCH_COLUMN);
    $add = [
        'project_template_id' => "ALTER TABLE projects ADD COLUMN project_template_id BIGINT UNSIGNED NULL AFTER id",
        'estimator_id' => "ALTER TABLE projects ADD COLUMN estimator_id BIGINT UNSIGNED NULL AFTER project_template_id",
        'project_number' => "ALTER TABLE projects ADD COLUMN project_number VARCHAR(100) NULL AFTER estimator_id",
        'client_name' => "ALTER TABLE projects ADD COLUMN client_name VARCHAR(191) NULL AFTER status",
        'job_address' => "ALTER TABLE projects ADD COLUMN job_address VARCHAR(255) NULL AFTER client_name",
        'city' => "ALTER TABLE projects ADD COLUMN city VARCHAR(100) NULL AFTER job_address",
        'state' => "ALTER TABLE projects ADD COLUMN state VARCHAR(100) NULL AFTER city",
        'postal_code' => "ALTER TABLE projects ADD COLUMN postal_code VARCHAR(30) NULL AFTER state",
        'country' => "ALTER TABLE projects ADD COLUMN country VARCHAR(100) NULL AFTER postal_code",
        'bid_due_at' => "ALTER TABLE projects ADD COLUMN bid_due_at DATETIME NULL AFTER country",
        'start_date' => "ALTER TABLE projects ADD COLUMN start_date DATE NULL AFTER bid_due_at",
        'end_date' => "ALTER TABLE projects ADD COLUMN end_date DATE NULL AFTER start_date",
        'metadata_json' => "ALTER TABLE projects ADD COLUMN metadata_json JSON NULL AFTER end_date",
        'deleted_at' => "ALTER TABLE projects ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at",
    ];
    foreach ($add as $column => $sql) {
        if (!in_array($column, $columns, true)) $pdo->exec($sql);
    }

    $stmt = $pdo->prepare("INSERT INTO project_templates (name, description, trade, settings_json, active) VALUES (?, ?, ?, ?, 1)");
    $count = (int)$pdo->query("SELECT COUNT(*) FROM project_templates WHERE deleted_at IS NULL")->fetchColumn();
    if ($count === 0) {
        $stmt->execute(['Electrical Bid Template', 'Basic electrical estimating project template', 'Electrical', project_json_value(['default_status' => 'draft'])]);
        $stmt->execute(['Commercial Shell Template', 'Commercial shell bidding template', 'Commercial', project_json_value(['default_status' => 'draft'])]);
    }
}

function project_payload(PDO $pdo, ?int $projectId = null): array
{
    $templates = $pdo->query("SELECT * FROM project_templates WHERE deleted_at IS NULL AND active = 1 ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
    $projects = $pdo->query(
        "SELECT p.*, pt.name AS template_name
         FROM projects p
         LEFT JOIN project_templates pt ON pt.id = p.project_template_id
         WHERE p.deleted_at IS NULL
         ORDER BY p.updated_at DESC, p.id DESC"
    )->fetchAll(PDO::FETCH_ASSOC);

    $project = null;
    if ($projectId) {
        $stmt = $pdo->prepare(
            "SELECT p.*, pt.name AS template_name, pt.description AS template_description
             FROM projects p
             LEFT JOIN project_templates pt ON pt.id = p.project_template_id
             WHERE p.id = ? AND p.deleted_at IS NULL"
        );
        $stmt->execute([$projectId]);
        $project = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    return compact('templates', 'projects', 'project');
}

function project_input_data(array $input): array
{
    return [
        'project_template_id' => project_int($input['project_template_id'] ?? 0) ?: null,
        'project_number' => trim((string)($input['project_number'] ?? '')) ?: null,
        'name' => trim((string)($input['name'] ?? '')),
        'description' => trim((string)($input['description'] ?? '')) ?: null,
        'status' => trim((string)($input['status'] ?? 'draft')) ?: 'draft',
        'client_name' => trim((string)($input['client_name'] ?? '')) ?: null,
        'job_address' => trim((string)($input['job_address'] ?? '')) ?: null,
        'city' => trim((string)($input['city'] ?? '')) ?: null,
        'state' => trim((string)($input['state'] ?? '')) ?: null,
        'postal_code' => trim((string)($input['postal_code'] ?? '')) ?: null,
        'country' => trim((string)($input['country'] ?? '')) ?: null,
        'bid_due_at' => project_datetime_or_null($input['bid_due_at'] ?? null),
        'start_date' => project_date_or_null($input['start_date'] ?? null),
        'end_date' => project_date_or_null($input['end_date'] ?? null),
        'metadata_json' => project_json_value($input['metadata_json'] ?? null),
    ];
}

try {
    project_ensure_schema($pdo);

    switch ($action) {
        case 'list':
            project_json(['status' => 'success', 'data' => project_payload($pdo)]);

        case 'detail':
            $id = project_int($_GET['id'] ?? $input['id'] ?? 0);
            project_json(['status' => 'success', 'data' => project_payload($pdo, $id)]);

        case 'save':
            $id = project_int($input['id'] ?? 0);
            $data = project_input_data($input);
            if ($data['name'] === '') project_json(['status' => 'error', 'msg' => 'Project name is required'], 422);

            if ($id > 0) {
                $set = implode(', ', array_map(function ($column) {
                    return "$column = ?";
                }, array_keys($data)));
                $stmt = $pdo->prepare("UPDATE projects SET $set WHERE id = ?");
                $stmt->execute(array_merge(array_values($data), [$id]));
            } else {
                $columns = array_keys($data);
                $stmt = $pdo->prepare("INSERT INTO projects (" . implode(', ', $columns) . ") VALUES (" . implode(', ', array_fill(0, count($columns), '?')) . ")");
                $stmt->execute(array_values($data));
                $id = (int)$pdo->lastInsertId();
            }

            $payload = project_payload($pdo, $id);
            if (empty($payload['project'])) project_json(['status' => 'error', 'msg' => 'Project could not be loaded after saving'], 500);
            project_json([
                'status' => 'success',
                'id' => $id,
                'project_id' => $id,
                'project' => $payload['project'],
                'data' => $payload,
            ]);

        case 'copy':
            $id = project_int($input['id'] ?? 0);
            $stmt = $pdo->prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL");
            $stmt->execute([$id]);
            $project = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$project) project_json(['status' => 'error', 'msg' => 'Project not found'], 404);
            unset($project['id'], $project['created_at'], $project['updated_at'], $project['deleted_at']);
            $project['name'] = $project['name'] . ' Copy';
            $project['project_number'] = null;
            $columns = array_keys($project);
            $stmt = $pdo->prepare("INSERT INTO projects (" . implode(', ', $columns) . ") VALUES (" . implode(', ', array_fill(0, count($columns), '?')) . ")");
            $stmt->execute(array_values($project));
            $newId = (int)$pdo->lastInsertId();
            project_json(['status' => 'success', 'id' => $newId, 'data' => project_payload($pdo, $newId)]);

        case 'archive':
            $id = project_int($input['id'] ?? 0);
            $stmt = $pdo->prepare("UPDATE projects SET status = 'archived' WHERE id = ?");
            $stmt->execute([$id]);
            project_json(['status' => 'success', 'data' => project_payload($pdo, $id)]);

        case 'delete':
            $id = project_int($input['id'] ?? 0);
            $stmt = $pdo->prepare("UPDATE projects SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?");
            $stmt->execute([$id]);
            project_json(['status' => 'success', 'data' => project_payload($pdo)]);

        case 'document_action':
            $projectId = project_int($input['project_id'] ?? 0);
            $documentId = project_int($input['id'] ?? 0);
            $source = (string)($input['source'] ?? '');
            $operation = (string)($input['operation'] ?? '');
            if ($projectId < 1 || $documentId < 1) project_json(['status' => 'error', 'msg' => 'Invalid document reference'], 422);
            $sources = [
                'legacy_file' => ['table' => 'files', 'name' => 'filename', 'folder' => 'folder_id'],
                'project_document' => ['table' => 'project_documents', 'name' => 'title', 'folder' => 'document_folder_id'],
            ];
            if (!isset($sources[$source]) || !in_array($operation, ['rename', 'move', 'delete'], true)) {
                project_json(['status' => 'error', 'msg' => 'Unsupported document action'], 422);
            }
            $config = $sources[$source];
            if (!project_table_exists($pdo, $config['table'])) project_json(['status' => 'error', 'msg' => 'Document storage is unavailable'], 503);
            $owned = $pdo->prepare("SELECT * FROM {$config['table']} WHERE id=? AND project_id=? AND deleted_at IS NULL LIMIT 1");
            $owned->execute([$documentId, $projectId]);
            $ownedDocument = $owned->fetch(PDO::FETCH_ASSOC);
            if (!$ownedDocument) project_json(['status' => 'error', 'msg' => 'Document not found'], 404);
            $mirrorPaths = [];
            if ($source === 'project_document') {
                $storedPath = ltrim(str_replace('\\', '/', (string)($ownedDocument['storage_path'] ?? '')), '/');
                if ($storedPath !== '') {
                    $mirrorPaths[] = $storedPath;
                    if (strpos($storedPath, 'api/') === 0) $mirrorPaths[] = substr($storedPath, 4);
                }
            }
            $pdo->beginTransaction();
            if ($operation === 'delete') {
                $stmt = $pdo->prepare("UPDATE {$config['table']} SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=? AND deleted_at IS NULL");
                $stmt->execute([$documentId, $projectId]);
                if ($mirrorPaths && project_table_exists($pdo, 'files')) {
                    $marks = implode(',', array_fill(0, count($mirrorPaths), '?'));
                    $mirror = $pdo->prepare("UPDATE files SET deleted_at=CURRENT_TIMESTAMP WHERE project_id=? AND deleted_at IS NULL AND filepath IN ($marks)");
                    $mirror->execute(array_merge([$projectId], $mirrorPaths));
                }
            } elseif ($operation === 'rename') {
                $name = trim((string)($input['name'] ?? ''));
                if ($name === '') project_json(['status' => 'error', 'msg' => 'Document name is required'], 422);
                if ($source === 'project_document') {
                    $title = pathinfo($name, PATHINFO_FILENAME) ?: $name;
                    $stmt = $pdo->prepare('UPDATE project_documents SET title=?,original_filename=? WHERE id=? AND project_id=? AND deleted_at IS NULL');
                    $stmt->execute([$title, $name, $documentId, $projectId]);
                    if ($mirrorPaths && project_table_exists($pdo, 'files')) {
                        $marks = implode(',', array_fill(0, count($mirrorPaths), '?'));
                        $mirror = $pdo->prepare("UPDATE files SET filename=? WHERE project_id=? AND deleted_at IS NULL AND filepath IN ($marks)");
                        $mirror->execute(array_merge([$name, $projectId], $mirrorPaths));
                    }
                } else {
                    $stmt = $pdo->prepare("UPDATE {$config['table']} SET {$config['name']}=? WHERE id=? AND project_id=? AND deleted_at IS NULL");
                    $stmt->execute([$name, $documentId, $projectId]);
                }
            } else {
                $folderId = project_int($input['folder_id'] ?? 0) ?: null;
                $stmt = $pdo->prepare("UPDATE {$config['table']} SET {$config['folder']}=? WHERE id=? AND project_id=? AND deleted_at IS NULL");
                $stmt->execute([$folderId, $documentId, $projectId]);
            }
            $pdo->commit();
            project_json(['status' => 'success', 'id' => $documentId, 'operation' => $operation]);

        default:
            project_json(['status' => 'error', 'msg' => 'Invalid action'], 404);
    }
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    project_json(['status' => 'error', 'msg' => $e->getMessage()], 500);
}
