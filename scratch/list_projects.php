<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->query("SELECT id, project_number, name, status, project_template_id FROM projects WHERE deleted_at IS NULL");
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Existing projects:\n";
foreach ($rows as $r) {
    echo "  [ID {$r['id']}] {$r['project_number']} - {$r['name']} (status: {$r['status']}, template_id: {$r['project_template_id']})\n";
}
