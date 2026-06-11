<?php
// settings.php - Gestión de Usuarios y Seguridad V5.5 (Show Password Buttons)
require_once __DIR__ . '/../core/auth/session.php';
require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/time.php';

// ---------------------------------------------------------
// 1. DEFINICIÓN DE USUARIO Y ROLES
// ---------------------------------------------------------
$userId = $_SESSION['user_id'];
$userName = $_SESSION['username'];
$userRoleRaw = $_SESSION['role'] ?? 'viewer'; 
$userRole = strtolower($userRoleRaw); 

// Definir permisos
$isAdmin = ($userRole === 'admin');
$canCreate = $isAdmin;
$canDelete = $isAdmin; 
$canUpload = $isAdmin;

// --- NAVEGACIÓN DE PESTAÑAS ---
$tab = $_GET['tab'] ?? 'users';
$tabLabel = ($tab === 'security') ? 'Security' : 'User Management'; // Etiqueta para breadcrumb

// --- LÓGICA BACKEND ---
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    
    // 1. Crear Usuario
    if ($_POST['action'] === 'create_user') {
        $u = trim($_POST['username']);
        $r = $_POST['role']; // Este viene del select (admin, technician, viewer)
        $p = $_POST['password'];
        
        $check = $pdo->prepare("SELECT id FROM users WHERE username = ?");
        $check->execute([$u]);
        
        if($check->rowCount() == 0) {
            $hash = password_hash($p, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)");
            $stmt->execute([$u, $hash, $r]);
            header("Location: settings.php?tab=users&msg=created");
            exit;
        }
    }

    // 2. Editar Usuario (Con opción de cambio de contraseña)
    if ($_POST['action'] === 'edit_user') {
        $id = $_POST['user_id'];
        $u = trim($_POST['username']);
        $r = $_POST['role'];
        $newPass = trim($_POST['password'] ?? '');

        if (!empty($newPass)) {
            // Si hay contraseña nueva, actualizamos todo incluido el hash
            $hash = password_hash($newPass, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("UPDATE users SET username=?, role=?, password=? WHERE id=?");
            $stmt->execute([$u, $r, $hash, $id]);
        } else {
            // Si no hay contraseña, solo actualizamos datos básicos
            $stmt = $pdo->prepare("UPDATE users SET username=?, role=? WHERE id=?");
            $stmt->execute([$u, $r, $id]);
        }
        
        header("Location: settings.php?tab=users&msg=updated");
        exit;
    }

    // 3. Cambiar Contraseña (Usuario actual)
    if ($_POST['action'] === 'change_password') {
        $newPass = $_POST['new_password'];
        $confPass = $_POST['confirm_password'];
        
        if($newPass === $confPass) {
            $hash = password_hash($newPass, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("UPDATE users SET password=? WHERE id=?");
            $stmt->execute([$hash, $userId]);
            header("Location: settings.php?tab=security&msg=pass_changed");
            exit;
        }
    }
}

// Eliminar Usuario
if (isset($_GET['delete_id'])) {
    $id = $_GET['delete_id'];
    if($id != 1 && $id != $userId) { 
        $stmt = $pdo->prepare("DELETE FROM users WHERE id=?");
        $stmt->execute([$id]);
    }
    header("Location: settings.php?tab=users");
    exit;
}

// --- CONSULTAS ---
$users = $pdo->query("SELECT * FROM users ORDER BY created_at DESC")->fetchAll(PDO::FETCH_ASSOC);

// INCLUIR HEADER
$pageTitle = "Settings | Brightronix";
include __DIR__ . '/../views/header.php';
?>

    <style>
        .settings-nav { display: flex; gap: 10px; margin-bottom: 30px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 20px; }
        .nav-pill { padding: 10px 25px; border-radius: 50px; font-weight: 600; font-size: 0.9rem; color: #94a3b8; transition: 0.2s; border: 1px solid transparent; }
        .nav-pill:hover { background: #334155; color: white; }
        .nav-pill.active { background: #6366f1; color: white; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3); }

        .card-box { background: #1e293b; border-radius: 20px; padding: 30px; border: 1px solid rgba(255,255,255,0.05); }
        .form-label { color: #94a3b8; font-size: 0.85rem; font-weight: 600; margin-bottom: 8px; }
        
        .table-responsive { border-radius: 20px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); }
        .table-rounded { width: 100%; border-collapse: separate; border-spacing: 0; background: #1e293b; }
        .table-rounded th { background: rgba(0,0,0,0.2); color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; padding: 15px 20px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .table-rounded td { padding: 15px 20px; color: white; vertical-align: middle; border-bottom: 1px solid rgba(255,255,255,0.02); }
        .table-rounded tr:last-child td { border-bottom: none; }

        .alert-custom { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #34d399; border-radius: 12px; padding: 15px; display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
        .btn-action { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.05); color: #94a3b8; background: transparent; transition: 0.2s; }
        .btn-action:hover { background: white; color: #0b1120; }
        .btn-action.delete:hover { background: #ef4444; color: white; border-color: #ef4444; }

        /* Estilos para botón ojo en Settings */
        .btn-eye-settings {
            background: transparent;
            border: 1px solid rgba(255,255,255,0.1);
            border-left: 0;
            color: #94a3b8;
            transition: 0.2s;
        }
        .btn-eye-settings:hover {
            background: rgba(255,255,255,0.05);
            color: white;
            border-color: rgba(255,255,255,0.2);
        }
        /* Ajuste de form-control en input-group para esquinas */
        .input-group .form-control:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
        .input-group .btn:last-child { border-top-left-radius: 0; border-bottom-left-radius: 0; }

    </style>

    <main class="main-content">
        
        <header class="header">
            <div class="d-flex align-items-center gap-3">
                <button class="mobile-toggle" onclick="toggleSidebar()">
                    <i class="fas fa-bars"></i>
                </button>
                <div class="breadcrumbs">
                    <a href="../pages/index.php">Home</a>
                    <i class="fas fa-chevron-right mx-2" style="font-size:0.7rem"></i>
                    <span>Settings</span>
                    <i class="fas fa-chevron-right mx-2" style="font-size:0.7rem"></i>
                    <span class="text-primary"><?= htmlspecialchars($tabLabel) ?></span>
                </div>
            </div>

            <div class="user-pill">
                <div class="avatar"><?= strtoupper(substr($userName,0,1)) ?></div>
                <span class="small fw-bold"><?= htmlspecialchars($userName) ?></span>
            </div>
        </header>

        <div class="mb-4">
             <h2 class="fw-bold m-0">System Configuration</h2>
        </div>

        <?php if(isset($_GET['msg'])): ?>
            <?php if($_GET['msg'] == 'created'): ?>
                <div class="alert-custom"><i class="fas fa-check-circle"></i> User created successfully.</div>
            <?php elseif($_GET['msg'] == 'updated'): ?>
                <div class="alert-custom"><i class="fas fa-check-circle"></i> User updated successfully.</div>
            <?php elseif($_GET['msg'] == 'pass_changed'): ?>
                <div class="alert-custom"><i class="fas fa-lock"></i> Your password has been updated.</div>
            <?php endif; ?>
        <?php endif; ?>

        <div class="settings-nav">
            <a href="?tab=users" class="nav-pill <?= $tab=='users'?'active':'' ?>"><i class="fas fa-users me-2"></i>User Management</a>
            <a href="?tab=security" class="nav-pill <?= $tab=='security'?'active':'' ?>"><i class="fas fa-shield-alt me-2"></i>Security</a>
        </div>

        <?php if($tab === 'users'): ?>
            <div class="d-flex justify-content-between align-items-center mb-4">
                <p class="text-gray mb-0">Manage access and roles for team members.</p>
                <button class="btn-main" data-bs-toggle="modal" data-bs-target="#addUserModal">
                    <i class="fas fa-plus me-2"></i> Add User
                </button>
            </div>

            <div class="table-responsive">
                <table class="table-rounded">
                    <thead>
                        <tr>
                            <th>User Profile</th>
                            <th>Role</th>
                            <th>Registered</th>
                            <th class="text-end">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach($users as $u): ?>
                        <tr>
                            <td>
                                <div class="d-flex align-items-center gap-3">
                                    <div class="avatar" style="background: <?= $u['role']=='admin'?'#ef4444':'#6366f1' ?>">
                                        <?= strtoupper(substr($u['username'],0,1)) ?>
                                    </div>
                                    <div>
                                        <div class="fw-bold"><?= htmlspecialchars($u['username']) ?></div>
                                        <div class="small text-gray">ID: <?= $u['id'] ?></div>
                                    </div>
                                </div>
                            </td>
                            <td>
                                <span class="badge <?= $u['role']=='admin'?'bg-danger':'bg-primary' ?> bg-opacity-25 <?= $u['role']=='admin'?'text-danger':'text-primary' ?>">
                                    <?= ucfirst($u['role']) ?>
                                </span>
                            </td>
                            <td class="small text-gray"><?= date('M d, Y', strtotime($u['created_at'])) ?></td>
                            <td class="text-end">
                                <button class="btn-action me-1" onclick="openEditModal(<?= $u['id'] ?>, '<?= $u['username'] ?>', '<?= $u['role'] ?>')">
                                    <i class="fas fa-pen"></i>
                                </button>
                                <?php if($u['id'] != 1 && $u['id'] != $userId): ?>
                                <a href="settings.php?tab=users&delete_id=<?= $u['id'] ?>" class="btn-action delete" onclick="return confirm('Delete this user?');">
                                    <i class="fas fa-trash"></i>
                                </a>
                                <?php endif; ?>
                            </td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>

        <?php if($tab === 'security'): ?>
            <div class="row">
                <div class="col-md-6">
                    <div class="card-box">
                        <h5 class="fw-bold mb-3 text-warning"><i class="fas fa-key me-2"></i>Change Your Password</h5>
                        <p class="text-gray small mb-4">Update the password for your current account (<?= htmlspecialchars($userName) ?>).</p>
                        
                        <form method="POST">
                            <input type="hidden" name="action" value="change_password">
                            <div class="mb-3">
                                <label class="form-label">New Password</label>
                                <div class="input-group">
                                    <input type="password" name="new_password" id="sec_new_pass" class="form-control" required minlength="4">
                                    <button class="btn btn-eye-settings" type="button" onclick="togglePassword('sec_new_pass', this)"><i class="fas fa-eye"></i></button>
                                </div>
                            </div>
                            <div class="mb-4">
                                <label class="form-label">Confirm Password</label>
                                <div class="input-group">
                                    <input type="password" name="confirm_password" id="sec_conf_pass" class="form-control" required minlength="4">
                                    <button class="btn btn-eye-settings" type="button" onclick="togglePassword('sec_conf_pass', this)"><i class="fas fa-eye"></i></button>
                                </div>
                            </div>
                            <div class="text-end">
                                <button type="submit" class="btn-main">Update Password</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        <?php endif; ?>

    </main>

<div class="modal fade" id="addUserModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <form class="modal-content p-3" method="POST">
            <input type="hidden" name="action" value="create_user">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Add New User</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <div class="mb-3">
                    <label class="form-label">Username</label>
                    <input type="text" name="username" class="form-control" required>
                </div>
                <div class="mb-3">
                    <label class="form-label">Password</label>
                    <div class="input-group">
                        <input type="password" name="password" id="add_password" class="form-control" required>
                        <button class="btn btn-eye-settings" type="button" onclick="togglePassword('add_password', this)"><i class="fas fa-eye"></i></button>
                    </div>
                </div>
                <div class="mb-3">
                    <label class="form-label">Role</label>
                    <select name="role" class="form-select">
                        <option value="technician">Technician</option>
                        <option value="admin">Administrator</option>
                        <option value="viewer">Viewer</option>
                    </select>
                </div>
            </div>
            <div class="modal-footer">
                <button type="submit" class="btn-main w-100">Create User</button>
            </div>
        </form>
    </div>
</div>

<div class="modal fade" id="editUserModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
        <form class="modal-content p-3" method="POST">
            <input type="hidden" name="action" value="edit_user">
            <input type="hidden" name="user_id" id="edit_id">
            
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Edit User</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <div class="mb-3">
                    <label class="form-label">Username</label>
                    <input type="text" name="username" id="edit_name" class="form-control" required>
                </div>
                <div class="mb-3">
                    <label class="form-label">Role</label>
                    <select name="role" id="edit_role" class="form-select">
                        <option value="technician">Technician</option>
                        <option value="admin">Administrator</option>
                        <option value="viewer">Viewer</option>
                    </select>
                </div>
                <div class="mb-3 border-top border-secondary pt-3 mt-3">
                    <label class="form-label text-warning">Reset Password <small>(Optional)</small></label>
                    <div class="input-group">
                        <input type="password" name="password" id="edit_password" class="form-control" placeholder="Leave empty to keep current password">
                        <button class="btn btn-eye-settings" type="button" onclick="togglePassword('edit_password', this)"><i class="fas fa-eye"></i></button>
                    </div>
                    <div class="form-text text-muted small">Only enter a value if you want to change the user's password.</div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="submit" class="btn-main w-100">Save Changes</button>
            </div>
        </form>
    </div>
</div>

<script>
    function openEditModal(id, name, role) {
        document.getElementById('edit_id').value = id;
        document.getElementById('edit_name').value = name;
        document.getElementById('edit_role').value = role;
        document.getElementById('edit_password').value = ''; 
        new bootstrap.Modal(document.getElementById('editUserModal')).show();
    }

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

<?php include __DIR__ . '/../views/footer.php'; ?>
