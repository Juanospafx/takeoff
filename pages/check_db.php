<?php
// check_db.php - Diagnóstico de Conexión
require_once __DIR__ . '/../core/db/connection.php';

echo "<h2>Estado de la Conexión</h2>";

try {
    // 1. Ver nombre de la BD conectada
    $dbName = $pdo->query("SELECT DATABASE()")->fetchColumn();
    echo "<p>✅ Conectado exitosamente a la base de datos: <strong>" . htmlspecialchars($dbName) . "</strong></p>";
    
    // 2. Ver si existe la tabla users
    $tableExists = $pdo->query("SHOW TABLES LIKE 'users'")->rowCount() > 0;
    if (!$tableExists) {
        die("<p>❌ ERROR CRÍTICO: La tabla 'users' NO existe en esta base de datos. Ejecuta el script SQL.</p>");
    }

    // 3. Buscar usuario admin
    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = 'admin'");
    $stmt->execute();
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($user) {
        echo "<p>✅ Usuario 'admin' encontrado (ID: " . $user['id'] . ")</p>";
        echo "<p>Rol: " . $user['role'] . "</p>";
        
        // 4. Probar la contraseña manualmente
        $testPass = 'admin123';
        if (password_verify($testPass, $user['password'])) {
            echo "<p style='color:green; font-weight:bold;'>✅ La contraseña 'admin123' es CORRECTA. El login debería funcionar.</p>";
        } else {
            echo "<p style='color:red; font-weight:bold;'>❌ La contraseña 'admin123' es INCORRECTA para el hash guardado.</p>";
            echo "<small>Hash en BD: " . substr($user['password'], 0, 20) . "...</small>";
        }
    } else {
        echo "<p style='color:red; font-weight:bold;'>❌ El usuario 'admin' NO existe en la tabla 'users'.</p>";
    }

} catch (PDOException $e) {
    echo "<p style='color:red'>❌ Error de conexión: " . $e->getMessage() . "</p>";
}
?>