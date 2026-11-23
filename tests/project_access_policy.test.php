<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/auth/ProjectAccess.php';
require_once __DIR__ . '/../core/auth/session.php';

$cases = [
    ['admin', '', ProjectAccess::READ, true],
    ['admin', '', ProjectAccess::WRITE, true],
    ['estimator', 'editor', ProjectAccess::READ, true],
    ['estimator', 'editor', ProjectAccess::WRITE, true],
    ['estimator', 'viewer', ProjectAccess::READ, true],
    ['estimator', 'viewer', ProjectAccess::WRITE, false],
    ['estimator', '', ProjectAccess::READ, false],
    ['estimator', '', ProjectAccess::WRITE, false],
    ['viewer', 'viewer', ProjectAccess::READ, true],
    ['viewer', 'editor', ProjectAccess::WRITE, false],
    ['viewer', '', ProjectAccess::READ, true],
    ['unknown', 'owner', ProjectAccess::READ, false],
];
foreach ($cases as [$appRole, $memberRole, $capability, $expected]) {
    $actual = ProjectAccess::roleAllowsCapability($appRole, $memberRole, $capability);
    if ($actual !== $expected) throw new RuntimeException("Unexpected policy result: {$appRole}/{$memberRole}/{$capability}");
}

$projectModule = file_get_contents(__DIR__ . '/../api/project_module.php');
$estimating = file_get_contents(__DIR__ . '/../api/project_estimating.php');
$takeoff = file_get_contents(__DIR__ . '/../api/takeoff.php');
$projectDocuments = file_get_contents(__DIR__ . '/../api/project_documents.php');
$projectDocumentTakeoff = file_get_contents(__DIR__ . '/../api/project_document_takeoff.php');
$takeoffLayers = file_get_contents(__DIR__ . '/../api/takeoff_layers.php');
$projectExcel = file_get_contents(__DIR__ . '/../api/project_estimate_excel.php');
$v1Router = file_get_contents(__DIR__ . '/../api/v1/index.php');
$filesController = file_get_contents(__DIR__ . '/../api/v1/controllers/FilesController.php');
$foldersController = file_get_contents(__DIR__ . '/../api/v1/controllers/FoldersController.php');
$searchPage = file_get_contents(__DIR__ . '/../api/search.php');
foreach ([$projectModule, $estimating, $takeoff, $projectDocuments, $projectDocumentTakeoff, $takeoffLayers, $projectExcel] as $source) {
    if (!str_contains((string)$source, 'ProjectAccess.php')) throw new RuntimeException('Project endpoint does not load ProjectAccess.');
    if (!str_contains((string)$source, 'takeoff_guard_project_access')) throw new RuntimeException('Project endpoint lacks project membership guard.');
}

$estimator = ['user_id' => 42, 'username' => 'assigned_estimator', 'role' => 'estimator'];
$viewer = ['user_id' => 43, 'username' => 'assigned_viewer', 'role' => 'viewer'];
$mutation = takeoff_check_api_access('save', [], ['save'], null, $estimator, 'estimating.write');
if (($mutation['allowed'] ?? false) !== true) throw new RuntimeException('Estimator capability mutation was blocked before project ACL.');
$viewerMutation = takeoff_check_api_access('save', [], ['save'], null, $viewer, 'estimating.write');
if (($viewerMutation['allowed'] ?? true) !== false) throw new RuntimeException('Viewer capability mutation was admitted.');

if (!str_contains((string)$projectModule, "'project.write'")) throw new RuntimeException('Project API does not consume project.write.');
if (!str_contains((string)$estimating, "'estimating.write'")) throw new RuntimeException('Estimating API does not consume estimating.write.');
if (!str_contains((string)$takeoff, "'takeoff.write'")) throw new RuntimeException('Takeoff API does not consume takeoff.write.');
if (!str_contains((string)$projectDocuments, "'documents.write'")) throw new RuntimeException('Project document API does not consume documents.write.');
if (!str_contains((string)$projectDocuments, 'ProjectAccess::READ')) throw new RuntimeException('Project document reads lack membership enforcement.');
if (!str_contains((string)$projectDocumentTakeoff, "'documents.write'")) throw new RuntimeException('Project drawing preparation does not consume documents.write.');
if (!str_contains((string)$takeoffLayers, "'takeoff.write'")) throw new RuntimeException('Legacy Takeoff layer API does not consume takeoff.write.');
if (str_contains((string)$takeoffLayers, 'Uploads Test Project')) throw new RuntimeException('Legacy Takeoff layer API may create an implicit test project.');
if (!str_contains((string)$projectExcel, "'estimating.write'")) throw new RuntimeException('Excel estimate API does not consume estimating.write.');
if (!str_contains((string)$v1Router, "'POST /api/v1/files' => 'documents.write'")) throw new RuntimeException('V1 uploads are not capability-scoped.');
if (!str_contains((string)$filesController, 'ProjectAccess::WRITE')) throw new RuntimeException('V1 uploads lack project write enforcement.');
if (!str_contains((string)$foldersController, 'ProjectAccess::READ')) throw new RuntimeException('V1 folder reads lack project membership enforcement.');
if (!str_contains((string)$searchPage, 'takeoff_require_page_auth')) throw new RuntimeException('Global search is accessible without authentication.');
if (!str_contains((string)$searchPage, 'ProjectAccess::READ')) throw new RuntimeException('Global search is not filtered by project membership.');

$legacyApi = file_get_contents(__DIR__ . '/../api/api.php');
$createProjectApi = file_get_contents(__DIR__ . '/../api/create_project.php');
$projectCreatePage = file_get_contents(__DIR__ . '/../pages/project_create.php');
$projectsPage = file_get_contents(__DIR__ . '/../pages/projects.php');
if (!str_contains((string)$legacyApi, "'update_project_info', 'add_project_folders'")) throw new RuntimeException('Legacy project mutations are not capability-scoped.');
if (substr_count((string)$legacyApi, 'takeoff_guard_project_access($pdo, $user,') < 2) throw new RuntimeException('Legacy project mutations lack project membership enforcement.');
if (!str_contains((string)$createProjectApi, "'project.write'")) throw new RuntimeException('Project creation API does not consume project.write.');
if (!str_contains((string)$projectCreatePage, "takeoff_has_capability('project.write'")) throw new RuntimeException('Project creation UI does not consume project.write.');
if (!str_contains((string)$projectCreatePage, 'ProjectAccess::can($pdo, $authUser, $editId, ProjectAccess::WRITE)')) throw new RuntimeException('Project edit UI lacks project membership enforcement.');
if (!str_contains((string)$projectsPage, '$canCreateProject = takeoff_has_capability(\'project.write\'')) throw new RuntimeException('Projects list hides creation from authorized estimators.');
if (!str_contains((string)$projectsPage, 'ProjectAccess::can($pdo, $authUser ?: [], $visibleProjectId, ProjectAccess::WRITE)')) throw new RuntimeException('Projects list does not scope edit controls by membership.');
if (!str_contains((string)file_get_contents(__DIR__ . '/../core/auth/ProjectAccess.php'), "if (\$role === 'viewer' && \$capability === self::READ) return true;")) {
    throw new RuntimeException('Viewer does not receive global read access while project hierarchy is disabled.');
}
echo "project access policy tests passed\n";
