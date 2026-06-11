<?php
// Compatibility shim for legacy pages.
// The standalone Takeoff module does not use login, roles, or access control.
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

$_SESSION['user_id'] = $_SESSION['user_id'] ?? 1;
$_SESSION['username'] = $_SESSION['username'] ?? 'Takeoff';
$_SESSION['role'] = $_SESSION['role'] ?? 'admin';

function requireRole($role) {
    return true;
}
?>
