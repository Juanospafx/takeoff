<?php
// core/auth/session.php
session_start();

// Verificamos no solo el ID, sino tambien el username y el role.
// Si falta CUALQUIERA de los tres, cerramos sesion y mandamos al login.
if (!isset($_SESSION['user_id']) || !isset($_SESSION['username']) || !isset($_SESSION['role'])) {
    // Destruir sesion corrupta por si acaso
    session_destroy();
    session_unset();

    // Redirigir al login
    header("Location: ../pages/login.php");
    exit();
}

// Opcional: Funcion para chequear roles especificos
function requireRole($role) {
    if ($_SESSION['role'] !== $role && $_SESSION['role'] !== 'admin') {
        die("Acceso denegado: Se requieren permisos de " . $role);
    }
}
?>
