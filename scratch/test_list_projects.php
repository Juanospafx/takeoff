<?php
require_once __DIR__ . '/../api/db.php';
$stmt = $pdo->query("SELECT id, name FROM projects ORDER BY id DESC LIMIT 5");
$projects = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo json_encode($projects, JSON_PRETTY_PRINT);

