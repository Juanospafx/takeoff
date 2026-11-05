<?php
require_once __DIR__ . '/../core/db/connection.php';
// $pdo is provided by core/db/connection.php
$tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
echo "TABLES:\n" . implode("\n", $tables) . "\n\n";

if (in_array('project_templates', $tables)) {
    $cols = $pdo->query('DESCRIBE project_templates')->fetchAll(PDO::FETCH_ASSOC);
    echo "project_templates columns:\n";
    print_r($cols);
    $templates = $pdo->query('SELECT * FROM project_templates')->fetchAll(PDO::FETCH_ASSOC);
    echo "project_templates rows:\n";
    print_r($templates);
}

if (in_array('projects', $tables)) {
    $cols = $pdo->query('DESCRIBE projects')->fetchAll(PDO::FETCH_ASSOC);
    echo "projects columns:\n";
    print_r($cols);
}
