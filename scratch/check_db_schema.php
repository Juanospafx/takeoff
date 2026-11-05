<?php
require_once __DIR__ . '/../core/db/connection.php';

foreach (['takeoff_layers', 'estimate_items', 'estimates'] as $table) {
    echo "=== TABLE: $table ===\n";
    $stmt = $pdo->query("DESCRIBE $table");
    $cols = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($cols as $col) {
        echo "  - {$col['Field']} ({$col['Type']})\n";
    }
}
