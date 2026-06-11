<?php
// reset_admin.php - Utilidad de Emergencia V3
require_once __DIR__ . '/../core/db/connection.php';

$msg = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $newPass = $_POST['password'];
    $secret = $_POST['secret']; // Una clave simple para evitar uso accidental
    
    // Cambia "12345" por una clave secreta que solo tú sepas
    if($secret === '12345') {
        $hash = password_hash($newPass, PASSWORD_DEFAULT);
        
        // Actualiza el usuario 'admin'
        $stmt = $pdo->prepare("UPDATE users SET password = ? WHERE username = 'admin'");
        if($stmt->execute([$hash])) {
            $msg = "<div class='alert alert-success'>Contraseña de Admin restablecida correctamente.</div>";
        } else {
            $msg = "<div class='alert alert-danger'>Error al actualizar. Verifica que el usuario 'admin' exista.</div>";
        }
    } else {
        $msg = "<div class='alert alert-danger'>Clave secreta incorrecta.</div>";
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Reset Admin | Brightronix</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>body { background: #0f172a; color: white; padding: 50px; }</style>
</head>
<body>
    <div class="container" style="max-width: 500px;">
        <h3>Reset Admin Password</h3>
        <?= $msg ?>
        <form method="POST" class="card p-4 bg-dark border-secondary mt-3">
            <div class="mb-3">
                <label>New Password</label>
                <input type="text" name="password" class="form-control" required placeholder="New password">
            </div>
            <div class="mb-3">
                <label>Secret Key</label>
                <input type="password" name="secret" class="form-control" required placeholder="Safety pin">
            </div>
            <button class="btn btn-danger w-100">Reset Password</button>
        </form>
    </div>
</body>
</html>