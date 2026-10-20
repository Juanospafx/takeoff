<?php
declare(strict_types=1);


require_once __DIR__ . '/../core/auth/session.php';

header('Content-Type: application/json; charset=utf-8');

function catalog_admin_json(array $body, int $status = 200): void
{ http_response_code($status); echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); exit; }

$input = json_decode(file_get_contents('php://input'), true);
$readActions = [];
$mutationActions = [
    'catalog.create', 'catalog.update', 'catalog.toggle', 'catalog.archive', 'catalog.restore', 'catalog.purge', 'catalog.copy', 'catalog.reorder',
    'category.create', 'category.update', 'category.toggle', 'category.archive', 'category.restore', 'category.purge', 'category.copy', 'category.reorder',
    'item.create', 'item.update', 'item.archive', 'item.restore', 'item.purge', 'item.move', 'item.duplicate', 'item.convert_assembly',
    'assembly_component.add', 'assembly_component.update', 'assembly_component.remove', 'assembly_component.reorder',
];

if (!is_array($input) && !empty($_POST)) {
    $input = $_POST;
}
$command = is_array($input) ? trim((string)($input['command'] ?? $input['action'] ?? '')) : '';
if ($command === '') {
    $command = trim((string)($_POST['command'] ?? $_GET['command'] ?? $_POST['action'] ?? $_GET['action'] ?? ''));
}
$user = takeoff_guard_api_action($command, $readActions, $mutationActions);
if (!is_array($input) && empty($_POST)) catalog_admin_json(['success'=>false,'error'=>['code'=>'INVALID_JSON','message'=>'A JSON body is required.']], 400);

require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/services/CatalogAdminService.php';

$payload = is_array($input['payload'] ?? null) ? $input['payload'] : $input;
$payload['actor_user_id'] = (int)$user['user_id'];
$payload['request_id'] = trim((string)($input['requestId'] ?? $input['request_id'] ?? $payload['request_id'] ?? ''));
if (array_key_exists('expectedRevision', $input) && !array_key_exists('expected_revision', $payload)) $payload['expected_revision'] = $input['expectedRevision'];

try {
    $result = (new CatalogAdminService($pdo))->execute($command, $payload);
    catalog_admin_json(['success'=>true,'command'=>$command,'requestId'=>$payload['request_id'],'data'=>$result], str_ends_with($command, '.create') ? 201 : 200);
} catch (CatalogRevisionConflict $e) {
    catalog_admin_json(['success'=>false,'error'=>['code'=>'REVISION_CONFLICT','message'=>$e->getMessage(),'current'=>$e->current]], 409);
} catch (CatalogAdminException $e) {
    catalog_admin_json(['success'=>false,'error'=>['code'=>$e->errorCode,'message'=>$e->getMessage(),'details'=>$e->details]], $e->httpStatus);
} catch (Throwable $e) {
    error_log('catalog_admin.php: ' . $e->getMessage());
    catalog_admin_json(['success'=>false,'error'=>['code'=>'CATALOG_ADMIN_ERROR','message'=>'Unable to update the Cost Catalog.']], 500);
}
