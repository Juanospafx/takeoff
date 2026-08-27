<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/services/CatalogAdminService.php';
header('Content-Type: application/json; charset=utf-8');

function catalog_admin_json(array $body, int $status = 200): void
{ http_response_code($status); echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); exit; }

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) catalog_admin_json(['success'=>false,'error'=>['code'=>'INVALID_JSON','message'=>'A JSON body is required.']], 400);
$command = trim((string)($input['command'] ?? ''));
$payload = is_array($input['payload'] ?? null) ? $input['payload'] : $input;
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
