<?php
// funciones/projects.php
function getStatusColor($status) {
    switch($status) {
        case 'Active': return 'success';
        case 'Planning': return 'info';
        case 'On Hold': return 'warning';
        case 'Completed': return 'primary';
        default: return 'secondary';
    }
}
?>
