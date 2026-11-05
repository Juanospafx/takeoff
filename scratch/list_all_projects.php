<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, project_number, name, status, deleted_at FROM projects ORDER BY id ASC");
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    echo "ID: {$row['id']}, Number: {$row['project_number']}, Name: {$row['name']}, Status: {$row['status']}, Deleted: " . ($row['deleted_at'] ?: 'NO') . "\n";
}

