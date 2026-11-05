<?php
require_once __DIR__ . '/../core/db/connection.php';

foreach (['estimates', 'estimate_items', 'estimate_workspace_states', 'estimate_markups', 'takeoff_layers'] as $tbl) {
    echo "=== COLUMNS FOR: $tbl ===" . PHP_EOL;
    $cols = $pdo->query("DESCRIBE $tbl")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($cols as $c) {
        echo "  {$c['Field']} ({$c['Type']})" . PHP_EOL;
    }
}
