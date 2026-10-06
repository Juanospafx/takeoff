<?php
// db.php
$host = 'localhost';
$db   = 'brightro_takeoff'; // Asegúrate de usar el nombre de la nueva base de datos V3
$user = 'brightro_takeoff';           // Tu usuario de BD
$pass = 'rootadmin01#';               // Tu contraseña de BD
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
    // Si falla la autenticación en entorno local (XAMPP), intentar con 'root' sin contraseña
    if (strpos($e->getMessage(), 'Access denied') !== false || $e->getCode() === 1045 || $e->getCode() === 1044) {
        try {
            $pdo = new PDO($dsn, 'root', '', $options);
        } catch (\PDOException $eLocal) {
            throw new \PDOException($e->getMessage(), (int)$e->getCode());
        }
    } else {
        throw new \PDOException($e->getMessage(), (int)$e->getCode());
    }
}
?>