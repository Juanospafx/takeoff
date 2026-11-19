<?php
require_once __DIR__ . '/../core/db/connection.php';
$stmt = $pdo->query("SELECT id, name FROM projects");
echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC), JSON_PRETTY_PRINT);

