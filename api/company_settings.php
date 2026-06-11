<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/db/connection.php';

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
$action = $_GET['action'] ?? $_POST['action'] ?? $input['action'] ?? 'list';

function cs_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function cs_int($value): int
{
    return is_numeric($value) ? (int)$value : 0;
}

function cs_str($value): ?string
{
    $value = trim((string)($value ?? ''));
    return $value === '' ? null : $value;
}

function cs_ensure_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS company_settings (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        setting_key VARCHAR(100) NOT NULL,
        setting_value TEXT NULL,
        value_type VARCHAR(50) NOT NULL DEFAULT 'string',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_company_settings_key (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS company_cost_types (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS company_project_statuses (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS company_estimate_types (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS company_setting_users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        display_name VARCHAR(191) NOT NULL,
        email VARCHAR(191) NULL,
        role_name VARCHAR(100) NOT NULL DEFAULT 'Estimator',
        status VARCHAR(50) NOT NULL DEFAULT 'Active',
        estimator_flag TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $defaults = [
        'company_name' => 'Brightronix',
        'logo_url' => '',
        'address' => '',
        'phone' => '',
        'email' => '',
        'default_currency' => 'USD',
        'default_tax_labor_rate' => '0',
        'default_tax_material_rate' => '0',
        'default_overhead_percentage' => '0',
        'default_profit_percentage' => '0',
        'default_waste_percentage' => '0',
        'proposal_template' => 'Standard Proposal',
        'pdf_header_footer' => '',
        'logo_visibility' => '1',
        'signature_block' => 'Accepted By',
    ];
    $stmt = $pdo->prepare("INSERT INTO company_settings (setting_key, setting_value, value_type) VALUES (?, ?, 'string') ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key)");
    foreach ($defaults as $key => $value) $stmt->execute([$key, $value]);

    cs_seed_list($pdo, 'company_cost_types', ['Material', 'Labor', 'Equipment', 'Subcontract', 'Other']);
    cs_seed_list($pdo, 'company_project_statuses', ['Active', 'Estimating', 'Bid Submitted', 'Accepted', 'In Progress', 'Complete', 'Lost', 'Archived']);
    cs_seed_list($pdo, 'company_estimate_types', ['Budgetary', 'Detailed', 'Lump Sum', 'Conceptual', 'Final']);
}

function cs_seed_list(PDO $pdo, string $table, array $values): void
{
    $count = (int)$pdo->query("SELECT COUNT(*) FROM $table WHERE deleted_at IS NULL")->fetchColumn();
    if ($count > 0) return;
    $stmt = $pdo->prepare("INSERT INTO $table (name, sort_order, active) VALUES (?, ?, 1)");
    foreach ($values as $index => $name) $stmt->execute([$name, ($index + 1) * 10]);
}

function cs_payload(PDO $pdo): array
{
    $rows = $pdo->query("SELECT setting_key, setting_value, value_type FROM company_settings ORDER BY setting_key")->fetchAll(PDO::FETCH_ASSOC);
    $settings = [];
    foreach ($rows as $row) $settings[$row['setting_key']] = $row['setting_value'];
    $costTypes = $pdo->query("SELECT * FROM company_cost_types WHERE deleted_at IS NULL ORDER BY sort_order, name")->fetchAll(PDO::FETCH_ASSOC);
    $projectStatuses = $pdo->query("SELECT * FROM company_project_statuses WHERE deleted_at IS NULL ORDER BY sort_order, name")->fetchAll(PDO::FETCH_ASSOC);
    $estimateTypes = $pdo->query("SELECT * FROM company_estimate_types WHERE deleted_at IS NULL ORDER BY sort_order, name")->fetchAll(PDO::FETCH_ASSOC);
    $users = $pdo->query("SELECT * FROM company_setting_users WHERE deleted_at IS NULL ORDER BY display_name")->fetchAll(PDO::FETCH_ASSOC);
    return compact('settings', 'costTypes', 'projectStatuses', 'estimateTypes', 'users');
}

function cs_table_for_list(string $list): ?string
{
    if ($list === 'cost_types') return 'company_cost_types';
    if ($list === 'project_statuses') return 'company_project_statuses';
    if ($list === 'estimate_types') return 'company_estimate_types';
    return null;
}

try {
    cs_ensure_schema($pdo);

    switch ($action) {
        case 'list':
            cs_json(['status' => 'success', 'data' => cs_payload($pdo)]);

        case 'save_settings':
            $settings = is_array($input['settings'] ?? null) ? $input['settings'] : [];
            $stmt = $pdo->prepare("INSERT INTO company_settings (setting_key, setting_value, value_type) VALUES (?, ?, 'string') ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), value_type = VALUES(value_type)");
            foreach ($settings as $key => $value) {
                $stmt->execute([(string)$key, (string)$value]);
            }
            cs_json(['status' => 'success', 'data' => cs_payload($pdo)]);

        case 'save_list_item':
            $table = cs_table_for_list((string)($input['list'] ?? ''));
            if (!$table) cs_json(['status' => 'error', 'msg' => 'Invalid list'], 422);
            $id = cs_int($input['id'] ?? 0);
            $name = cs_str($input['name'] ?? null);
            if (!$name) cs_json(['status' => 'error', 'msg' => 'Name is required'], 422);
            $active = !empty($input['active']) ? 1 : 0;
            $sort = cs_int($input['sort_order'] ?? 0);
            if ($id > 0) {
                $pdo->prepare("UPDATE $table SET name = ?, active = ?, sort_order = ? WHERE id = ?")->execute([$name, $active, $sort, $id]);
            } else {
                $pdo->prepare("INSERT INTO $table (name, active, sort_order) VALUES (?, ?, ?)")->execute([$name, $active, $sort]);
            }
            cs_json(['status' => 'success', 'data' => cs_payload($pdo)]);

        case 'delete_list_item':
            $table = cs_table_for_list((string)($input['list'] ?? ''));
            if (!$table) cs_json(['status' => 'error', 'msg' => 'Invalid list'], 422);
            $pdo->prepare("UPDATE $table SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")->execute([cs_int($input['id'] ?? 0)]);
            cs_json(['status' => 'success', 'data' => cs_payload($pdo)]);

        case 'save_user':
            $id = cs_int($input['id'] ?? 0);
            $name = cs_str($input['display_name'] ?? null);
            if (!$name) cs_json(['status' => 'error', 'msg' => 'Name is required'], 422);
            $data = [
                $name,
                cs_str($input['email'] ?? null),
                cs_str($input['role_name'] ?? 'Estimator') ?: 'Estimator',
                cs_str($input['status'] ?? 'Active') ?: 'Active',
                !empty($input['estimator_flag']) ? 1 : 0,
            ];
            if ($id > 0) {
                $pdo->prepare("UPDATE company_setting_users SET display_name = ?, email = ?, role_name = ?, status = ?, estimator_flag = ? WHERE id = ?")->execute(array_merge($data, [$id]));
            } else {
                $pdo->prepare("INSERT INTO company_setting_users (display_name, email, role_name, status, estimator_flag) VALUES (?, ?, ?, ?, ?)")->execute($data);
            }
            cs_json(['status' => 'success', 'data' => cs_payload($pdo)]);

        case 'delete_user':
            $pdo->prepare("UPDATE company_setting_users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")->execute([cs_int($input['id'] ?? 0)]);
            cs_json(['status' => 'success', 'data' => cs_payload($pdo)]);

        default:
            cs_json(['status' => 'error', 'msg' => 'Invalid action'], 404);
    }
} catch (Throwable $e) {
    cs_json(['status' => 'error', 'msg' => $e->getMessage()], 500);
}
