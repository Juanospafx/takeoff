<?php
// login.php - Diseño Moderno V5.2 (Show Password Toggle)
require_once __DIR__ . '/../core/db/connection.php';
session_start();

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = trim($_POST['username']);
    $pass = $_POST['password'];

    if (!empty($user) && !empty($pass)) {
        // Buscar usuario
        $stmt = $pdo->prepare("SELECT id, username, password, role FROM users WHERE username = ?");
        $stmt->execute([$user]);
        $userData = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($userData) {
            // Usuario existe, verificamos contraseña
            if (password_verify($pass, $userData['password'])) {
                // Login Exitoso
                $_SESSION['user_id'] = $userData['id'];
                $_SESSION['username'] = $userData['username'];
                $_SESSION['role'] = $userData['role'];
                
                header("Location: index.php");
                exit;
            } else {
                $error = "Contraseña incorrecta.";
            }
        } else {
            $error = "El usuario no existe.";
        }
    } else {
        $error = "Por favor complete todos los campos.";
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Login | Brightronix</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            /* Misma paleta que el Dashboard */
            --bg-body: #0b1120;
            --bg-card: #1e293b;
            --primary: #6366f1;
            --primary-hover: #4f46e5;
            --text-white: #ffffff;
            --text-gray: #94a3b8;
            --text-muted: #9aa7b9;
            --radius-box: 20px;
        }

        body {
            background-color: var(--bg-body);
            color: var(--text-white);
            font-family: 'Outfit', sans-serif;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
        }

        .login-wrapper {
            width: 100%;
            max-width: 420px;
            padding: 20px;
        }

        .login-card {
            background: var(--bg-card);
            border-radius: var(--radius-box);
            padding: 40px;
            border: 1px solid rgba(255,255,255,0.05);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }

        .brand {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 30px;
            color: white;
        }

        .brand-icon {
            width: 40px; height: 40px;
            background: linear-gradient(135deg, var(--primary), #0ea5e9);
            border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
        }

        .form-label {
            color: var(--text-gray);
            font-size: 0.85rem;
            font-weight: 500;
            margin-bottom: 8px;
        }

        .form-control {
            background: var(--bg-body);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            color: white;
            padding: 12px 15px;
            font-size: 0.95rem;
        }

        .form-control:focus {
            background: var(--bg-body);
            color: white;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
            z-index: 2;
        }
        
        /* Estilo para el botón de ojo */
        .btn-eye {
            background: var(--bg-body);
            border: 1px solid rgba(255,255,255,0.1);
            border-left: 0;
            color: var(--text-gray);
            border-radius: 0 12px 12px 0;
            padding: 0 15px;
            transition: 0.2s;
        }
        .btn-eye:hover {
            background: #2d3748;
            color: white;
            border-color: rgba(255,255,255,0.2);
        }

        .btn-login {
            background: var(--primary);
            color: white;
            padding: 12px;
            border-radius: 50px; /* Pill shape */
            font-weight: 600;
            border: none;
            width: 100%;
            margin-top: 20px;
            transition: 0.3s;
            box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
        }

        .btn-login:hover {
            background: var(--primary-hover);
            transform: translateY(-2px);
        }

        .alert-danger {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: #fca5a5;
            border-radius: 10px;
            font-size: 0.9rem;
        }
        
        .footer-text {
            text-align: center;
            margin-top: 20px;
            font-size: 0.8rem;
            color: var(--text-muted);
        }
    </style>
</head>
<body>

<div class="login-wrapper">
    <div class="login-card">
        <div class="brand">
            <div class="brand-icon"><i class="fas fa-bolt"></i></div>
            Brightronix
        </div>
        
        <h5 class="text-center mb-4 fw-bold">Welcome Back</h5>

        <?php if($error): ?>
            <div class="alert alert-danger py-2 text-center mb-4">
                <i class="fas fa-exclamation-circle me-2"></i> <?= $error ?>
            </div>
        <?php endif; ?>

        <form method="POST">
            <div class="mb-3">
                <label class="form-label">Username</label>
                <div class="input-group">
                    <span class="input-group-text bg-transparent border-secondary text-main" style="border-right:0; border-radius: 12px 0 0 12px; border-color: rgba(255,255,255,0.1);">
                        <i class="fas fa-user"></i>
                    </span>
                    <input type="text" name="username" class="form-control" style="border-left:0; border-radius: 0 12px 12px 0;" placeholder="Enter your username" required autofocus>
                </div>
            </div>

            <div class="mb-3">
                <label class="form-label">Password</label>
                <div class="input-group">
                    <span class="input-group-text bg-transparent border-secondary text-main" style="border-right:0; border-radius: 12px 0 0 12px; border-color: rgba(255,255,255,0.1);">
                        <i class="fas fa-lock"></i>
                    </span>
                    <input type="password" name="password" id="loginPass" class="form-control" style="border-left:0; border-right:0; border-radius: 0;" placeholder="••••••••" required>
                    <button type="button" class="btn btn-eye" onclick="togglePassword('loginPass', this)">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            </div>
            
            <button type="submit" class="btn-login">
                Sign In <i class="fas fa-arrow-right ms-2"></i>
            </button>
        </form>

        <div class="footer-text">
            Protected System V5.0
        </div>
    </div>
</div>

<script>
    function togglePassword(inputId, btn) {
        const input = document.getElementById(inputId);
        const icon = btn.querySelector('i');
        
        if (input.type === "password") {
            input.type = "text";
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            input.type = "password";
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }
</script>

</body>
</html>