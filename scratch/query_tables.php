<?php
require_once __DIR__ . '/../core/db/connection.php';
$stmt = $pdo->query("SHOW TABLES");
echo json_encode($stmt->fetchAll(PDO::FETCH_COLUMN), JSON_PRETTY_PRINT);

