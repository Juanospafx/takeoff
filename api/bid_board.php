<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/db/connection.php';

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
$action = $_GET['action'] ?? $_POST['action'] ?? $input['action'] ?? 'list';

function bid_board_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function bid_board_num(mixed $value, float $default = 0): float
{
    return is_numeric($value) ? (float)$value : $default;
}

function bid_board_int(mixed $value, int $default = 0): int
{
    return is_numeric($value) ? (int)$value : $default;
}

function bid_board_date_or_null(mixed $value): ?string
{
    $value = trim((string)($value ?? ''));
    if ($value === '') return null;
    $ts = strtotime($value);
    return $ts ? date('Y-m-d H:i:s', $ts) : null;
}

function bid_board_ensure_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS estimators (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        display_name VARCHAR(191) NOT NULL,
        email VARCHAR(191) NULL,
        phone VARCHAR(100) NULL,
        company_name VARCHAR(191) NULL,
        trade VARCHAR(100) NULL,
        metadata_json JSON NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_estimators_active_deleted (active, deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS bid_statuses (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        code VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_terminal TINYINT(1) NOT NULL DEFAULT 0,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_bid_statuses_code (code),
        KEY idx_bid_statuses_sort (sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS bids (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        project_id BIGINT UNSIGNED NULL,
        estimating_id BIGINT UNSIGNED NULL,
        bid_status_id BIGINT UNSIGNED NULL,
        estimator_id BIGINT UNSIGNED NULL,
        bid_number VARCHAR(100) NULL,
        name VARCHAR(191) NOT NULL,
        requester_company VARCHAR(191) NULL,
        project_name_snapshot VARCHAR(191) NULL,
        due_at DATETIME NULL,
        submitted_at DATETIME NULL,
        awarded_at DATETIME NULL,
        total_amount DECIMAL(18,4) NOT NULL DEFAULT 0,
        currency_code CHAR(3) NOT NULL DEFAULT 'USD',
        notes TEXT NULL,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_bids_status (bid_status_id),
        KEY idx_bids_estimator (estimator_id),
        KEY idx_bids_due (due_at),
        KEY idx_bids_deleted (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $columns = $pdo->query("SHOW COLUMNS FROM bids")->fetchAll(PDO::FETCH_COLUMN);
    $pdo->exec("ALTER TABLE bids MODIFY project_id BIGINT UNSIGNED NULL");
    $add = [
        'requester_company' => "ALTER TABLE bids ADD COLUMN requester_company VARCHAR(191) NULL AFTER name",
        'project_name_snapshot' => "ALTER TABLE bids ADD COLUMN project_name_snapshot VARCHAR(191) NULL AFTER requester_company",
    ];
    foreach ($add as $column => $sql) {
        if (!in_array($column, $columns, true)) $pdo->exec($sql);
    }

    $stmt = $pdo->prepare("INSERT INTO bid_statuses (code, name, sort_order, is_terminal) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order), is_terminal = VALUES(is_terminal)");
    $statuses = [
        ['invitations', 'Invitations', 10, 0],
        ['to_do', 'To Do', 20, 0],
        ['estimating', 'Estimating', 30, 0],
        ['bid_submitted', 'Bid Submitted', 40, 0],
        ['accepted', 'Accepted', 50, 0],
        ['in_progress', 'In Progress', 60, 0],
        ['complete', 'Complete', 70, 1],
        ['estimadores', 'Estimadores', 80, 0],
        ['lost', 'Lost', 90, 1],
        ['archived', 'Archived', 100, 1],
    ];
    foreach ($statuses as $status) $stmt->execute($status);
}

function bid_board_payload(PDO $pdo): array
{
    $statuses = $pdo->query("SELECT * FROM bid_statuses ORDER BY sort_order, id")->fetchAll(PDO::FETCH_ASSOC);
    $estimators = $pdo->query("SELECT id, display_name, email FROM estimators WHERE deleted_at IS NULL AND active = 1 ORDER BY display_name")->fetchAll(PDO::FETCH_ASSOC);

    $dashboard = $pdo->query(
        "SELECT bs.id AS status_id, bs.code, bs.name, COUNT(b.id) AS bid_count, COALESCE(SUM(b.total_amount), 0) AS total_sales
         FROM bid_statuses bs
         LEFT JOIN bids b ON b.bid_status_id = bs.id AND b.deleted_at IS NULL
         GROUP BY bs.id, bs.code, bs.name, bs.sort_order
         ORDER BY bs.sort_order, bs.id"
    )->fetchAll(PDO::FETCH_ASSOC);

    $bids = $pdo->query(
        "SELECT b.*, bs.code AS status_code, bs.name AS status_name, e.display_name AS estimator_name
         FROM bids b
         LEFT JOIN bid_statuses bs ON bs.id = b.bid_status_id
         LEFT JOIN estimators e ON e.id = b.estimator_id
         WHERE b.deleted_at IS NULL
         ORDER BY COALESCE(b.due_at, '2999-12-31') ASC, b.id DESC"
    )->fetchAll(PDO::FETCH_ASSOC);

    return compact('statuses', 'estimators', 'dashboard', 'bids');
}

try {
    bid_board_ensure_schema($pdo);

    switch ($action) {
        case 'list':
            bid_board_json(['status' => 'success', 'data' => bid_board_payload($pdo)]);

        case 'save':
            $id = bid_board_int($input['id'] ?? 0);
            $name = trim((string)($input['name'] ?? ''));
            if ($name === '') bid_board_json(['status' => 'error', 'msg' => 'Name is required'], 422);

            $data = [
                'bid_status_id' => bid_board_int($input['bid_status_id'] ?? 0) ?: null,
                'estimator_id' => bid_board_int($input['estimator_id'] ?? 0) ?: null,
                'name' => $name,
                'requester_company' => trim((string)($input['requester_company'] ?? '')) ?: null,
                'project_name_snapshot' => trim((string)($input['project_name_snapshot'] ?? '')) ?: null,
                'due_at' => bid_board_date_or_null($input['due_at'] ?? null),
                'total_amount' => bid_board_num($input['total_amount'] ?? 0),
                'currency_code' => strtoupper(substr((string)($input['currency_code'] ?? 'USD'), 0, 3)) ?: 'USD',
                'notes' => trim((string)($input['notes'] ?? '')) ?: null,
            ];

            if ($id > 0) {
                $set = implode(', ', array_map(fn($column) => "$column = ?", array_keys($data)));
                $stmt = $pdo->prepare("UPDATE bids SET $set WHERE id = ?");
                $stmt->execute([...array_values($data), $id]);
            } else {
                $columns = array_keys($data);
                $stmt = $pdo->prepare("INSERT INTO bids (" . implode(', ', $columns) . ") VALUES (" . implode(', ', array_fill(0, count($columns), '?')) . ")");
                $stmt->execute(array_values($data));
                $id = (int)$pdo->lastInsertId();
            }

            bid_board_json(['status' => 'success', 'id' => $id, 'data' => bid_board_payload($pdo)]);

        case 'duplicate':
            $id = bid_board_int($input['id'] ?? 0);
            $stmt = $pdo->prepare("SELECT * FROM bids WHERE id = ? AND deleted_at IS NULL");
            $stmt->execute([$id]);
            $bid = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$bid) bid_board_json(['status' => 'error', 'msg' => 'Bid not found'], 404);
            unset($bid['id'], $bid['created_at'], $bid['updated_at'], $bid['deleted_at']);
            $bid['name'] = $bid['name'] . ' Copy';
            $columns = array_keys($bid);
            $stmt = $pdo->prepare("INSERT INTO bids (" . implode(', ', $columns) . ") VALUES (" . implode(', ', array_fill(0, count($columns), '?')) . ")");
            $stmt->execute(array_values($bid));
            bid_board_json(['status' => 'success', 'id' => (int)$pdo->lastInsertId(), 'data' => bid_board_payload($pdo)]);

        case 'archive':
            $id = bid_board_int($input['id'] ?? 0);
            $statusId = (int)$pdo->query("SELECT id FROM bid_statuses WHERE code = 'archived' LIMIT 1")->fetchColumn();
            $stmt = $pdo->prepare("UPDATE bids SET bid_status_id = ? WHERE id = ?");
            $stmt->execute([$statusId, $id]);
            bid_board_json(['status' => 'success', 'data' => bid_board_payload($pdo)]);

        case 'delete':
            $id = bid_board_int($input['id'] ?? 0);
            $stmt = $pdo->prepare("UPDATE bids SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?");
            $stmt->execute([$id]);
            bid_board_json(['status' => 'success', 'data' => bid_board_payload($pdo)]);

        default:
            bid_board_json(['status' => 'error', 'msg' => 'Invalid action'], 404);
    }
} catch (Throwable $e) {
    bid_board_json(['status' => 'error', 'msg' => $e->getMessage()], 500);
}
