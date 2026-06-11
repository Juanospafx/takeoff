<?php
// funciones/file_names.php
function clean_filename($name) {
    return preg_replace('/[^A-Za-z0-9\-_\.]/', '', str_replace(' ', '_', $name));
}
?>
