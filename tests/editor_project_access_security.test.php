<?php
declare(strict_types=1);

$source = file_get_contents(__DIR__ . '/../pages/editor.php');
if ($source === false) throw new RuntimeException('Unable to read editor.php');
if (!str_contains($source, 'FILTER_VALIDATE_INT')) {
    throw new RuntimeException('Editor file IDs must be normalized as positive integers.');
}
if (str_contains($source, 'ID: $id')) {
    throw new RuntimeException('Editor errors must not reflect request input.');
}
if (!str_contains($source, 'takeoff_guard_project_access($pdo, $authUser, $projectId, ProjectAccess::READ)')) {
    throw new RuntimeException('Editor must enforce project read access.');
}
if (!str_contains($source, 'ProjectAccess::can($pdo, $authUser, $projectId, ProjectAccess::WRITE)')) {
    throw new RuntimeException('Editor write capability must use the centralized project policy.');
}

echo "editor project access security contract passed\n";
