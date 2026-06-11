<?php
// fix_password.php - Reparador de Contraseña
require_once __DIR__ . '/../core/db/connection.php';

$usuario = 'admin';
$nuevaPassword = 'admin123';

// 1. Generamos el hash usando TU servidor para asegurar compatibilidad
$nuevoHash = password_hash($nuevaPassword, PASSWORD_DEFAULT);

try {
    // 2. Actualizamos la base de datos
    $stmt = $pdo->prepare("UPDATE users SET password = ? WHERE username = ?");
    $resultado = $stmt->execute([$nuevoHash, $usuario]);

    if ($resultado && $stmt->rowCount() > 0) {
        echo "<h1>✅ ¡ÉXITO!</h1>";
        echo "<p>La contraseña del usuario <strong>'$usuario'</strong> se ha restablecido a: <strong>'$nuevaPassword'</strong></p>";
        echo "<p>El nuevo hash generado es: <small>$nuevoHash</small></p>";
        echo "<br><a href='../pages/login.php'>--> Ir a Iniciar Sesión <--</a>";
    } else {
        echo "<h1>⚠️ ALERTA</h1>";
        echo "<p>No se pudo actualizar. Posibles razones:</p>";
        echo "<ul>";
        echo "<li>El usuario '$usuario' no existe (revisa la tabla users).</li>";
        echo "<li>La contraseña ya era 'admin123' y no hubo cambios.</li>";
        echo "</ul>";
        
        // Diagnóstico extra: Ver si el usuario existe
        $check = $pdo->prepare("SELECT * FROM users WHERE username = ?");
        $check->execute([$usuario]);
        if(!$check->fetch()) {
            echo "<p style='color:red'>Confirmado: El usuario '$usuario' NO existe en la base de datos.</p>";
            // Intentar crearlo si no existe
            $stmtInsert = $pdo->prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')");
            if($stmtInsert->execute([$usuario, $nuevoHash])) {
                 echo "<p style='color:green'>✅ Se ha creado el usuario '$usuario' automáticamente. Intenta entrar ahora.</p>";
                 echo "<br><a href='../pages/login.php'>--> Ir a Iniciar Sesión <--</a>";
            }
        }
    }
} catch (PDOException $e) {
    echo "Error de base de datos: " . $e->getMessage();
}
?>
