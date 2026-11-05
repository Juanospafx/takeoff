<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->prepare("
    SELECT ei.id, ei.name, ei.group_name
    FROM estimate_items ei
    INNER JOIN estimates e ON e.id = ei.estimate_id
    WHERE e.project_id = 6 AND ei.deleted_at IS NULL AND e.deleted_at IS NULL
    ORDER BY ei.sort_order ASC, ei.id DESC
");
$stmt->execute();
$items = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "project_dashboard.php will receive: " . count($items) . " items for Project 6\n";
$groups = [];
foreach ($items as $it) {
    $groups[$it['group_name'] ?: 'Ungrouped'] = ($groups[$it['group_name'] ?: 'Ungrouped'] ?? 0) + 1;
}
foreach ($groups as $gName => $cnt) {
    echo "  Group '$gName': $cnt items\n";
}

