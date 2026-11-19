<?php
require_once __DIR__ . '/../core/db/connection.php';

$tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
echo "Matching tables:\n";
foreach ($tables as $t) {
    if (preg_match('/(estimat|catalog|layer|takeoff|group|item)/i', $t)) {
        echo " - $t\n";
    }
}

// Let's inspect cost catalog items table!
echo "\n--- Catalog tables schema & samples ---\n";
foreach (['cost_catalog', 'cost_catalog_items', 'cost_catalog_assemblies', 'cost_catalog_assembly_parts'] as $ct) {
    if (in_array($ct, $tables)) {
        echo "Table: $ct\n";
        $cols = $pdo->query("DESCRIBE $ct")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($cols as $c) {
            echo "  {$c['Field']} ({$c['Type']})\n";
        }
        $count = $pdo->query("SELECT COUNT(*) FROM $ct")->fetchColumn();
        echo "  Total rows: $count\n";
    }
}

echo "\n--- Estimating tables schema ---\n";
foreach (['estimates', 'estimate_groups', 'estimate_items', 'takeoff_layers', 'takeoff_groups'] as $et) {
    if (in_array($et, $tables)) {
        echo "Table: $et\n";
        $cols = $pdo->query("DESCRIBE $et")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($cols as $c) {
            echo "  {$c['Field']} ({$c['Type']})\n";
        }
        $count = $pdo->query("SELECT COUNT(*) FROM $et")->fetchColumn();
        echo "  Total rows: $count\n";
    }
}
