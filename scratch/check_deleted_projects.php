<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, name, deleted_at FROM projects WHERE id IN (5,6,7,8,9,10)");
while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
    echo "Project {$r['id']}: deleted_at = " . var_export($r['deleted_at'], true) . PHP_EOL;
}

