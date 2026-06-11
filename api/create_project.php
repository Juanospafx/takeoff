<?php
// api/create_project.php

// 1. Configuración y Cabeceras
header('Content-Type: application/json');
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/auth/session.php'; // Para obtener el ID del usuario creador

// Solo Admins pueden crear
if (!isset($_SESSION['role']) || $_SESSION['role'] !== 'admin') {
    echo json_encode(['status' => 'error', 'msg' => 'Unauthorized']);
    exit;
}

// 2. Recibir Datos
try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        throw new Exception('Invalid request method');
    }

    // Datos obligatorios
    $name = trim($_POST['project_name'] ?? '');
    if (empty($name)) {
        throw new Exception('Project Name is required');
    }

    // Datos opcionales
    $address = trim($_POST['address'] ?? '');
    $notes = trim($_POST['notes'] ?? '');
    $contactName = trim($_POST['contact_name'] ?? '');
    $contactPhone = trim($_POST['contact_phone'] ?? '');
    $companyName = trim($_POST['company_name'] ?? '');
    $companyPhone = trim($_POST['company_phone'] ?? '');
    $companyAddress = trim($_POST['company_address'] ?? '');

    $userIds = $_POST['user_ids'] ?? [];
    $selectedIds = [];
    $adminSelectedIds = [];
    if (is_array($userIds)) {
        foreach ($userIds as $uid) {
            $uid = (int)$uid;
            if ($uid > 0) $selectedIds[] = $uid;
        }
        $selectedIds = array_values(array_unique($selectedIds));
    }
    $hasUserSelection = !empty($selectedIds);
    if (!empty($selectedIds)) {
        $in = implode(',', array_fill(0, count($selectedIds), '?'));
        $stmtUsers = $pdo->prepare("SELECT id, role FROM users WHERE id IN ($in)");
        $stmtUsers->execute($selectedIds);
        $rows = $stmtUsers->fetchAll(PDO::FETCH_ASSOC);
        if (count($rows) !== count($selectedIds)) {
            throw new Exception('Invalid users selected');
        }
        foreach ($rows as $row) {
            if ($row['role'] === 'admin') $adminSelectedIds[] = (int)$row['id'];
        }
        if ($hasUserSelection && empty($adminSelectedIds)) {
            throw new Exception('At least one admin must be assigned');
        }
    }

    // Fechas (convertir vacíos a NULL)
    $dates = [
        'date_bid_sent' => $_POST['date_bid_send'] ?? null,
        'date_bid_awarded' => $_POST['date_bid_awarded'] ?? null,
        'date_started' => $_POST['date_started'] ?? null,
        'date_finished' => $_POST['date_finished'] ?? null,
        'date_warranty_end' => $_POST['date_warranty_end'] ?? null
    ];
    
    foreach ($dates as $key => $val) {
        if (empty($val)) $dates[$key] = null;
    }

    // 3. Insertar Proyecto en BD
    $pdo->beginTransaction();

    $creatorId = (int)$_SESSION['user_id'];
    $selectedIds[] = $creatorId;
    $selectedIds = array_values(array_unique($selectedIds));
    $assignedUserId = !empty($adminSelectedIds) ? (int)$adminSelectedIds[0] : $creatorId;

    // Insert dinámico según columnas existentes
    $cols = $pdo->query("DESCRIBE projects")->fetchAll(PDO::FETCH_COLUMN);
    $insertCols = [];
    $placeholders = [];
    $params = [];

    $fieldMap = [
        'name' => $name,
        'description' => $notes,
        'address' => $address,
        'notes' => $notes,
        'contact_name' => $contactName,
        'contact_phone' => $contactPhone,
        'company_name' => $companyName,
        'company_phone' => $companyPhone,
        'company_address' => $companyAddress,
        'date_bid_sent' => $dates['date_bid_sent'],
        'date_bid_awarded' => $dates['date_bid_awarded'],
        'date_started' => $dates['date_started'],
        'date_finished' => $dates['date_finished'],
        'date_warranty_end' => $dates['date_warranty_end'],
        'created_by' => $creatorId,
        'assigned_user_id' => $assignedUserId,
        'status' => 'Active'
    ];

    foreach ($fieldMap as $col => $val) {
        if (in_array($col, $cols, true)) {
            $insertCols[] = $col;
            $placeholders[] = '?';
            $params[] = $val;
        }
    }
    if (in_array('created_at', $cols, true)) {
        $insertCols[] = 'created_at';
        $placeholders[] = 'NOW()';
    }

    $sql = "INSERT INTO projects (" . implode(', ', $insertCols) . ") VALUES (" . implode(', ', $placeholders) . ")";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $projectId = $pdo->lastInsertId();

    if (!empty($selectedIds)) {
        $stmtDir = $pdo->prepare("INSERT IGNORE INTO directory (project_id, user_id) VALUES (?, ?)");
        foreach ($selectedIds as $uid) {
            $stmtDir->execute([$projectId, $uid]);
        }
    }

    // 4. Crear Carpetas Seleccionadas
    if (isset($_POST['folders']) && is_array($_POST['folders'])) {
        $folderStmt = $pdo->prepare("INSERT INTO folders (project_id, name) VALUES (?, ?)");
        
        // Mapeo de valores del checkbox a nombres reales bonitos
        $folderNames = [
            'bom' => 'BoM',
            'schedule_values' => 'Schedule of Values',
            'rfi' => 'RFI',
            'drawings' => 'Drawings',
            'photos' => 'Photos',
            'panel_schedule' => 'Panel Schedule',
            'panel_tags' => 'Panel Tags',
            'noc' => 'NOC',
            'submittal' => 'Submittal',
            'permit' => 'Permit',
            'acknowledgement' => 'Acknowledgement',
            'payapp' => 'Payapp',
            'insurance' => 'Certificate of Insurance',
            'fault_calc' => 'Fault Current Calc',
            'labor_record' => 'Labor Record',
            'expenses' => 'Expenses',
            'warranty_sup' => 'Warranty Supplier',
            'clock_in' => 'Clock In'
        ];

        foreach ($_POST['folders'] as $fKey) {
            if (isset($folderNames[$fKey])) {
                $realName = $folderNames[$fKey];
                $folderStmt->execute([$projectId, $realName]);
            }
        }
    }

    $pdo->commit();
    echo json_encode(['status' => 'success', 'id' => $projectId]);

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    // Log del error para debugging (opcional: error_log($e->getMessage()));
    echo json_encode(['status' => 'error', 'msg' => $e->getMessage()]);
}
