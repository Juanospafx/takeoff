<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/DatabaseConfig.php';

$databaseConfig = DatabaseConfig::load();
$pdo = $databaseConfig->connect($GLOBALS['__TAKEOFF_PDO_FACTORY__'] ?? null);