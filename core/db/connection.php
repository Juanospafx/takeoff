<?php
// db.php
$host = 'localhost';
$db   = 'brightro_electroplan_v2'; // Asegúrate de usar el nombre de la nueva base de datos V3
$user = 'root';           // Tu usuario de BD
$pass = '';               // Tu contraseña de BD
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (\PDOException $e) {
    throw new \PDOException($e->getMessage(), (int)$e->getCode());
}
?>