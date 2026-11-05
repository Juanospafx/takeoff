<?php
require_once __DIR__ . '/../core/db/connection.php';

$stmt = $pdo->prepare("SELECT id, name, metadata_json, created_at, updated_at FROM estimates WHERE project_id = 6");
$stmt->execute();
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

foreach ($rows as $r) {
    echo "ID: {$r['id']}, Name: {$r['name']}, Updated: {$r['updated_at']}\n";
    $meta = json_decode($r['metadata_json'] ?? '', true);
    if ($meta) {
        $keys = array_keys($meta);
        echo "  metadata_json keys: " . implode(', ', $keys) . "\n";
        if (isset($meta['workspace'])) {
            $ws = $meta['workspace'];
            echo "    workspace keys: " . implode(', ', array_keys($ws)) . "\n";
            $groups = $ws['groups'] ?? [];
            echo "    workspace groups: " . count($groups) . "\n";
        }
    } else {
        echo "  metadata_json is NULL or empty\n";
    }
}
