<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/db/connection.php';

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
$action = $_GET['action'] ?? $_POST['action'] ?? $input['action'] ?? ($_SERVER['REQUEST_METHOD'] === 'POST' ? 'save' : 'list');

function customer_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255) NULL,
        phone VARCHAR(100) NULL,
        email VARCHAR(255) NULL,
        address TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_company (company)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
} catch (Throwable $e) {
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company TEXT NOT NULL,
            contact_name TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )");
    } catch (Throwable $ignore) {}
}

function get_all_customers(PDO $pdo): array
{
    $customers = [];
    try {
        $stmt = $pdo->query("SELECT * FROM customers ORDER BY company ASC");
        $customers = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        $customers = [];
    }

    $existingCompanies = [];
    foreach ($customers as $c) {
        $existingCompanies[mb_strtolower(trim((string)($c['company'] ?? '')))] = true;
    }

    try {
        $projStmt = $pdo->query("SELECT client_name, metadata_json FROM projects WHERE deleted_at IS NULL AND client_name IS NOT NULL AND client_name != ''");
        while ($row = $projStmt->fetch(PDO::FETCH_ASSOC)) {
            $company = trim((string)($row['client_name'] ?? ''));
            $norm = mb_strtolower($company);
            if ($company !== '' && !isset($existingCompanies[$norm])) {
                $meta = json_decode((string)($row['metadata_json'] ?? '{}'), true);
                if (!is_array($meta)) $meta = [];
                $customers[] = [
                    'id' => null,
                    'company' => $company,
                    'contact_name' => $meta['primary_contact'] ?? $meta['contact_name'] ?? '',
                    'phone' => $meta['customer_phone'] ?? $meta['phone'] ?? '',
                    'email' => $meta['customer_email'] ?? $meta['email'] ?? '',
                    'address' => $meta['customer_address'] ?? $meta['address'] ?? '',
                    'from_project' => true
                ];
                $existingCompanies[$norm] = true;
            }
        }
    } catch (Throwable $e) {}

    usort($customers, function ($a, $b) {
        return strcasecmp((string)($a['company'] ?? ''), (string)($b['company'] ?? ''));
    });

    return $customers;
}

switch ($action) {
    case 'list':
        customer_json([
            'status' => 'success',
            'data' => get_all_customers($pdo)
        ]);

    case 'save':
        $company = trim((string)($input['company'] ?? ''));
        if ($company === '') {
            customer_json(['status' => 'error', 'msg' => 'Company name is required'], 422);
        }
        $contact = trim((string)($input['contact_name'] ?? $input['primary_contact'] ?? ''));
        $phone = trim((string)($input['phone'] ?? $input['customer_phone'] ?? ''));
        $email = trim((string)($input['email'] ?? $input['customer_email'] ?? ''));
        $address = trim((string)($input['address'] ?? $input['customer_address'] ?? ''));
        $id = isset($input['id']) && is_numeric($input['id']) && (int)$input['id'] > 0 ? (int)$input['id'] : null;

        if ($id) {
            $stmt = $pdo->prepare("UPDATE customers SET company = ?, contact_name = ?, phone = ?, email = ?, address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
            $stmt->execute([$company, $contact, $phone, $email, $address, $id]);
        } else {
            $check = $pdo->prepare("SELECT id FROM customers WHERE LOWER(company) = LOWER(?) LIMIT 1");
            $check->execute([$company]);
            $existingId = $check->fetchColumn();
            if ($existingId) {
                $id = (int)$existingId;
                $stmt = $pdo->prepare("UPDATE customers SET company = ?, contact_name = ?, phone = ?, email = ?, address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
                $stmt->execute([$company, $contact, $phone, $email, $address, $id]);
            } else {
                $stmt = $pdo->prepare("INSERT INTO customers (company, contact_name, phone, email, address) VALUES (?, ?, ?, ?, ?)");
                $stmt->execute([$company, $contact, $phone, $email, $address]);
                $id = (int)$pdo->lastInsertId();
            }
        }

        $fetchStmt = $pdo->prepare("SELECT * FROM customers WHERE id = ?");
        $fetchStmt->execute([$id]);
        $savedCustomer = $fetchStmt->fetch(PDO::FETCH_ASSOC);

        customer_json([
            'status' => 'success',
            'data' => $savedCustomer,
            'customers' => get_all_customers($pdo)
        ]);

    default:
        customer_json(['status' => 'error', 'msg' => 'Unknown action'], 400);
}
