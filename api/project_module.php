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
    try {
        $stmt = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1');
        $stmt->execute([$table]);
        if ($stmt->fetchColumn()) return true;
    } catch (Throwable $e) {}
    try {
        $stmt = $pdo->query("SELECT 1 FROM {$table} LIMIT 1");
        return $stmt !== false;
    } catch (Throwable $e) {
        return false;
    }
}

function project_deep_clone(PDO $pdo, int $sourceId, int $newId): void
{
    $inTransaction = $pdo->inTransaction();
    if (!$inTransaction) {
        $pdo->beginTransaction();
    }
    try {
        $folderMap = [];
        $docFolderMap = [];
        $fileMap = [];
        $docMap = [];
        $takeoffMap = [];
        $layerMap = [];
        $estimateMap = [];

        // 1. Folders
        if (project_table_exists($pdo, 'folders')) {
            $stmt = $pdo->prepare("SELECT * FROM folders WHERE project_id = ? ORDER BY COALESCE(parent_id, 0) ASC, id ASC");
            $stmt->execute([$sourceId]);
            $folders = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($folders as $f) {
                $oldFid = (int)$f['id'];
                unset($f['id'], $f['created_at'], $f['updated_at']);
                $f['project_id'] = $newId;
                if (isset($f['parent_id']) && $f['parent_id'] !== null && isset($folderMap[(int)$f['parent_id']])) {
                    $f['parent_id'] = $folderMap[(int)$f['parent_id']];
                }
                $cols = array_keys($f);
                $ins = $pdo->prepare("INSERT INTO folders (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($f));
                $folderMap[$oldFid] = (int)$pdo->lastInsertId();
            }
        }

        // 1b. Document Folders
        if (project_table_exists($pdo, 'document_folders')) {
            $stmt = $pdo->prepare("SELECT * FROM document_folders WHERE project_id = ? ORDER BY COALESCE(parent_folder_id, 0) ASC, id ASC");
            $stmt->execute([$sourceId]);
            $docFolders = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($docFolders as $df) {
                $oldDfid = (int)$df['id'];
                unset($df['id'], $df['created_at'], $df['updated_at'], $df['deleted_at']);
                $df['project_id'] = $newId;
                if (isset($df['parent_folder_id']) && $df['parent_folder_id'] !== null && isset($docFolderMap[(int)$df['parent_folder_id']])) {
                    $df['parent_folder_id'] = $docFolderMap[(int)$df['parent_folder_id']];
                }
                $cols = array_keys($df);
                $ins = $pdo->prepare("INSERT INTO document_folders (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($df));
                $docFolderMap[$oldDfid] = (int)$pdo->lastInsertId();
            }
        }

        // 2. Files
        if (project_table_exists($pdo, 'files')) {
            $stmt = $pdo->prepare("SELECT * FROM files WHERE project_id = ? AND deleted_at IS NULL");
            $stmt->execute([$sourceId]);
            $files = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($files as $fl) {
                $oldFlId = (int)$fl['id'];
                unset($fl['id'], $fl['created_at'], $fl['updated_at'], $fl['deleted_at']);
                $fl['project_id'] = $newId;
                if (isset($fl['folder_id']) && $fl['folder_id'] !== null && isset($folderMap[(int)$fl['folder_id']])) {
                    $fl['folder_id'] = $folderMap[(int)$fl['folder_id']];
                }
                $cols = array_keys($fl);
                $ins = $pdo->prepare("INSERT INTO files (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($fl));
                $fileMap[$oldFlId] = (int)$pdo->lastInsertId();
            }
        }

        // 2b. Project Documents
        if (project_table_exists($pdo, 'project_documents')) {
            $stmt = $pdo->prepare("SELECT * FROM project_documents WHERE project_id = ? AND deleted_at IS NULL");
            $stmt->execute([$sourceId]);
            $docs = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($docs as $dc) {
                $oldDcId = (int)$dc['id'];
                unset($dc['id'], $dc['created_at'], $dc['updated_at'], $dc['deleted_at']);
                $dc['project_id'] = $newId;
                if (isset($dc['document_folder_id']) && $dc['document_folder_id'] !== null && isset($docFolderMap[(int)$dc['document_folder_id']])) {
                    $dc['document_folder_id'] = $docFolderMap[(int)$dc['document_folder_id']];
                }
                if (isset($dc['file_id']) && $dc['file_id'] !== null && isset($fileMap[(int)$dc['file_id']])) {
                    $dc['file_id'] = $fileMap[(int)$dc['file_id']];
                }
                $cols = array_keys($dc);
                $ins = $pdo->prepare("INSERT INTO project_documents (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($dc));
                $docMap[$oldDcId] = (int)$pdo->lastInsertId();
            }
        }

        // 3. Takeoffs
        if (project_table_exists($pdo, 'takeoffs')) {
            $stmt = $pdo->prepare("SELECT * FROM takeoffs WHERE project_id = ? AND deleted_at IS NULL");
            $stmt->execute([$sourceId]);
            $takeoffs = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($takeoffs as $tk) {
                $oldTkId = (int)$tk['id'];
                unset($tk['id'], $tk['created_at'], $tk['updated_at'], $tk['deleted_at']);
                $tk['project_id'] = $newId;
                if (isset($tk['drawing_id']) && $tk['drawing_id'] !== null) {
                    if (isset($fileMap[(int)$tk['drawing_id']])) $tk['drawing_id'] = $fileMap[(int)$tk['drawing_id']];
                    elseif (isset($docMap[(int)$tk['drawing_id']])) $tk['drawing_id'] = $docMap[(int)$tk['drawing_id']];
                }
                $cols = array_keys($tk);
                $ins = $pdo->prepare("INSERT INTO takeoffs (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($tk));
                $takeoffMap[$oldTkId] = (int)$pdo->lastInsertId();
            }
        }

        // 4. Takeoff Layers
        if (project_table_exists($pdo, 'takeoff_layers')) {
            $stmt = $pdo->prepare("SELECT * FROM takeoff_layers WHERE project_id = ? AND deleted_at IS NULL");
            $stmt->execute([$sourceId]);
            $layers = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($layers as $ly) {
                $oldLyId = (int)$ly['id'];
                unset($ly['id'], $ly['created_at'], $ly['updated_at'], $ly['deleted_at']);
                $ly['project_id'] = $newId;
                if (isset($ly['takeoff_id']) && isset($takeoffMap[(int)$ly['takeoff_id']])) {
                    $ly['takeoff_id'] = $takeoffMap[(int)$ly['takeoff_id']];
                }
                if (isset($ly['drawing_id']) && $ly['drawing_id'] !== null) {
                    if (isset($fileMap[(int)$ly['drawing_id']])) $ly['drawing_id'] = $fileMap[(int)$ly['drawing_id']];
                    elseif (isset($docMap[(int)$ly['drawing_id']])) $ly['drawing_id'] = $docMap[(int)$ly['drawing_id']];
                }
                $cols = array_keys($ly);
                $ins = $pdo->prepare("INSERT INTO takeoff_layers (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($ly));
                $layerMap[$oldLyId] = (int)$pdo->lastInsertId();
            }
        }

        // 5. Takeoff Count Markers
        if (project_table_exists($pdo, 'takeoff_count_markers') && !empty($layerMap)) {
            $layerIds = array_keys($layerMap);
            $inClause = implode(',', array_fill(0, count($layerIds), '?'));
            $stmt = $pdo->prepare("SELECT * FROM takeoff_count_markers WHERE layer_id IN ($inClause)");
            $stmt->execute($layerIds);
            $markers = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($markers as $mk) {
                unset($mk['id'], $mk['created_at'], $mk['updated_at']);
                $mk['layer_id'] = $layerMap[(int)$mk['layer_id']] ?? $mk['layer_id'];
                if (isset($mk['file_id']) && isset($fileMap[(int)$mk['file_id']])) {
                    $mk['file_id'] = $fileMap[(int)$mk['file_id']];
                }
                if (isset($mk['drawing_id']) && isset($fileMap[(int)$mk['drawing_id']])) {
                    $mk['drawing_id'] = $fileMap[(int)$mk['drawing_id']];
                }
                $cols = array_keys($mk);
                $ins = $pdo->prepare("INSERT INTO takeoff_count_markers (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($mk));
            }
        }

        // 6. Takeoff Linear Segments
        if (project_table_exists($pdo, 'takeoff_linear_segments') && !empty($layerMap)) {
            $layerIds = array_keys($layerMap);
            $inClause = implode(',', array_fill(0, count($layerIds), '?'));
            $stmt = $pdo->prepare("SELECT * FROM takeoff_linear_segments WHERE layer_id IN ($inClause)");
            $stmt->execute($layerIds);
            $segments = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($segments as $sg) {
                unset($sg['id'], $sg['created_at'], $sg['updated_at']);
                $sg['layer_id'] = $layerMap[(int)$sg['layer_id']] ?? $sg['layer_id'];
                if (isset($sg['file_id']) && isset($fileMap[(int)$sg['file_id']])) {
                    $sg['file_id'] = $fileMap[(int)$sg['file_id']];
                }
                if (isset($sg['drawing_id']) && isset($fileMap[(int)$sg['drawing_id']])) {
                    $sg['drawing_id'] = $fileMap[(int)$sg['drawing_id']];
                }
                $cols = array_keys($sg);
                $ins = $pdo->prepare("INSERT INTO takeoff_linear_segments (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($sg));
            }
        }

        // 7. Scales (takeoff_sheet_scales & drawing_scales)
        if (project_table_exists($pdo, 'takeoff_sheet_scales')) {
            $stmt = $pdo->prepare("SELECT * FROM takeoff_sheet_scales WHERE project_id = ?");
            $stmt->execute([$sourceId]);
            $scales = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($scales as $sc) {
                unset($sc['id'], $sc['created_at'], $sc['updated_at']);
                $sc['project_id'] = $newId;
                if (isset($sc['drawing_id']) && isset($fileMap[(int)$sc['drawing_id']])) {
                    $sc['drawing_id'] = $fileMap[(int)$sc['drawing_id']];
                }
                $cols = array_keys($sc);
                $ins = $pdo->prepare("INSERT INTO takeoff_sheet_scales (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($sc));
            }
        }
        if (project_table_exists($pdo, 'drawing_scales')) {
            $stmt = $pdo->prepare("SELECT * FROM drawing_scales WHERE project_id = ?");
            $stmt->execute([$sourceId]);
            $dscales = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($dscales as $dsc) {
                unset($dsc['id'], $dsc['created_at'], $dsc['updated_at']);
                $dsc['project_id'] = $newId;
                if (isset($dsc['drawing_id']) && isset($fileMap[(int)$dsc['drawing_id']])) {
                    $dsc['drawing_id'] = $fileMap[(int)$dsc['drawing_id']];
                }
                $cols = array_keys($dsc);
                $ins = $pdo->prepare("INSERT INTO drawing_scales (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($dsc));
            }
        }

        // 8. Estimates
        if (project_table_exists($pdo, 'estimates')) {
            $stmt = $pdo->prepare("SELECT * FROM estimates WHERE project_id = ? AND deleted_at IS NULL");
            $stmt->execute([$sourceId]);
            $estimates = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($estimates as $est) {
                $oldEstId = (int)$est['id'];
                unset($est['id'], $est['created_at'], $est['updated_at'], $est['deleted_at']);
                $est['project_id'] = $newId;
                $cols = array_keys($est);
                $ins = $pdo->prepare("INSERT INTO estimates (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($est));
                $estimateMap[$oldEstId] = (int)$pdo->lastInsertId();
            }
        }

        // 9. Estimate Items
        if (project_table_exists($pdo, 'estimate_items')) {
            $stmt = $pdo->prepare("SELECT * FROM estimate_items WHERE project_id = ? AND deleted_at IS NULL");
            $stmt->execute([$sourceId]);
            $estItems = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($estItems as $ei) {
                unset($ei['id'], $ei['created_at'], $ei['updated_at'], $ei['deleted_at']);
                $ei['project_id'] = $newId;
                if (isset($ei['estimate_id']) && isset($estimateMap[(int)$ei['estimate_id']])) {
                    $ei['estimate_id'] = $estimateMap[(int)$ei['estimate_id']];
                }
                if (isset($ei['takeoff_layer_id']) && isset($layerMap[(int)$ei['takeoff_layer_id']])) {
                    $ei['takeoff_layer_id'] = $layerMap[(int)$ei['takeoff_layer_id']];
                }
                $cols = array_keys($ei);
                $ins = $pdo->prepare("INSERT INTO estimate_items (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($ei));
            }
        }

        // 10. Estimate Markups
        if (project_table_exists($pdo, 'estimate_markups') && !empty($estimateMap)) {
            $estIds = array_keys($estimateMap);
            $inClause = implode(',', array_fill(0, count($estIds), '?'));
            $stmt = $pdo->prepare("SELECT * FROM estimate_markups WHERE estimate_id IN ($inClause)");
            $stmt->execute($estIds);
            $markups = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            foreach ($markups as $mkp) {
                unset($mkp['id'], $mkp['created_at'], $mkp['updated_at']);
                $mkp['estimate_id'] = $estimateMap[(int)$mkp['estimate_id']] ?? $mkp['estimate_id'];
                $cols = array_keys($mkp);
                $ins = $pdo->prepare("INSERT INTO estimate_markups (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")");
                $ins->execute(array_values($mkp));
            }
        }

        if (!$inTransaction) {
            $pdo->commit();
        }
    } catch (Throwable $e) {
        if (!$inTransaction && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('Project deep clone warning: ' . $e->getMessage());
    }
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

            $existingCols = $pdo->query("SHOW COLUMNS FROM projects")->fetchAll(PDO::FETCH_COLUMN);
            $filteredData = array_filter($data, function ($key) use ($existingCols) {
                return in_array($key, $existingCols, true);
            }, ARRAY_FILTER_USE_KEY);

            if ($id > 0) {
                $set = implode(', ', array_map(function ($column) {
                    return "$column = ?";
                }, array_keys($filteredData)));
                $stmt = $pdo->prepare("UPDATE projects SET $set WHERE id = ?");
                $stmt->execute(array_merge(array_values($filteredData), [$id]));
            } else {
                $columns = array_keys($filteredData);
                $stmt = $pdo->prepare("INSERT INTO projects (" . implode(', ', $columns) . ") VALUES (" . implode(', ', array_fill(0, count($columns), '?')) . ")");
                $stmt->execute(array_values($filteredData));
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
            project_deep_clone($pdo, $id, $newId);
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
