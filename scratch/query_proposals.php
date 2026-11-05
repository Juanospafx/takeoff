<?php
require_once __DIR__ . '/../core/db/connection.php';
$stmt = $pdo->query("SELECT id, project_id, estimate_id, quote_number, estimate_name, settings FROM project_proposals ORDER BY id DESC LIMIT 10");
echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC), JSON_PRETTY_PRINT);

