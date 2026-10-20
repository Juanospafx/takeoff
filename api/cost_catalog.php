<?php
declare(strict_types=1);


require_once __DIR__ . '/../core/auth/session.php';


header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
$action = $_GET['action'] ?? $_POST['action'] ?? $input['action'] ?? null;

$readActions = ['list'];
$mutationActions = [
    'save_catalog', 'copy_catalog', 'delete_catalog', 'restore_catalog', 'purge_catalog', 'toggle_catalog', 'reorder_catalogs',
    'save_group', 'copy_group', 'delete_group', 'restore_group', 'purge_group', 'toggle_group', 'reorder_groups',
    'save_item', 'duplicate_item', 'delete_item', 'restore_item', 'purge_item', 'move_item',
    'convert_item_assembly', 'add_assembly_part', 'update_assembly_part', 'reorder_assembly_parts', 'delete_assembly_part',
    'batch_archive', 'batch_restore', 'batch_purge', 'batch_move', 'batch_toggle', 'batch_copy',
];

$user = takeoff_guard_api_action($action, $readActions, $mutationActions, 'list');

require_once __DIR__ . '/../core/db/connection.php';
require_once __DIR__ . '/../core/services/CatalogAdminService.php';

$input['request_id'] = catalog_ra_request_id($input);
$input['actor_user_id'] = (int)$user['user_id'];


function cc_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function cc_int($value): int
{
    return is_numeric($value) ? (int)$value : 0;
}

function cc_str($value): ?string
{
    $value = trim((string)($value ?? ''));
    return $value === '' ? null : $value;
}

function cc_columns(PDO $pdo, string $table): array
{
    return $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
}

function cc_item_type_for_db(PDO $pdo, $value): string
{
    $value = strtolower(trim((string)($value ?? 'material')));
    $allowed = ['material', 'labor', 'equipment', 'assembly', 'subcontractor', 'travel', 'custom', 'part'];
    if (!in_array($value, $allowed, true)) $value = 'material';

    $stmt = $pdo->query("SHOW COLUMNS FROM catalog_items LIKE 'item_type'");
    $column = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
    $type = strtolower((string)($column['Type'] ?? ''));
    if ($value === 'material' && strpos($type, "'material'") === false && strpos($type, 'enum') !== false) {
        return 'part';
    }
    return $value;
}

function cc_hex_or_null($value): ?string
{
    $value = trim((string)($value ?? ''));
    if ($value === '') return null;
    return preg_match('/^#[0-9a-fA-F]{6}$/', $value) ? $value : null;
}

function cc_recalculate_assembly(PDO $pdo, int $assemblyItemId, array $input = [], string $action = 'assembly.recalculated'): void
{
    if ($assemblyItemId <= 0) return;
    $stmt = $pdo->prepare(
        "SELECT
            COALESCE(SUM(quantity * unit_cost_snapshot), 0) AS unit_cost,
            COALESCE(SUM(quantity * unit_labor_time_snapshot), 0) AS labor_hours
         FROM assembly_parts
         WHERE assembly_catalog_item_id = ? AND deleted_at IS NULL"
    );
    $stmt->execute([$assemblyItemId]);
    $totals = $stmt->fetch(PDO::FETCH_ASSOC) ?: ['unit_cost' => 0, 'labor_hours' => 0];
    catalog_ra_update($pdo, 'catalog_items', 'item', $assemblyItemId, [
        'item_type' => cc_item_type_for_db($pdo, 'assembly'),
        'unit_cost' => (float)$totals['unit_cost'],
        'labor_hours' => (float)$totals['labor_hours']
    ], $action, $input, null, true);
}

function cc_item_input(PDO $pdo, array $input): array
{
    $catalogId = cc_int($input['catalog_id'] ?? 0);
    $groupId = cc_int($input['catalog_group_id'] ?? 0);
    $name = cc_str($input['name'] ?? null);
    $uom = cc_str($input['unit_of_measure'] ?? null);
    $unitCost = is_numeric($input['unit_cost'] ?? null) ? (float)$input['unit_cost'] : -1;
    $laborHours = is_numeric($input['labor_hours'] ?? null) ? (float)$input['labor_hours'] : -1;
    $color = cc_hex_or_null($input['color'] ?? null);

    if (!$catalogId) cc_json(['status' => 'error', 'msg' => 'Catalog is required'], 422);
    if (!$name) cc_json(['status' => 'error', 'msg' => 'Name is required'], 422);
    if (!$uom) cc_json(['status' => 'error', 'msg' => 'Unit of Measure is required'], 422);
    if ($unitCost < 0) cc_json(['status' => 'error', 'msg' => 'Unit Cost must be a number >= 0'], 422);
    if ($laborHours < 0) cc_json(['status' => 'error', 'msg' => 'Unit Labor Time must be a number >= 0'], 422);
    if (cc_str($input['color'] ?? null) && !$color) cc_json(['status' => 'error', 'msg' => 'Color must be a valid hex value'], 422);

    return [
        'catalog_id' => $catalogId,
        'catalog_group_id' => $groupId ?: null,
        'name' => $name,
        'description' => cc_str($input['description'] ?? null),
        'unit_of_measure' => $uom,
        'unit_cost' => $unitCost,
        'labor_hours' => $laborHours,
        'taxable' => !empty($input['taxable']) ? 1 : 0,
        'color' => $color,
        'symbol' => cc_str($input['symbol'] ?? null),
        'manufacturer' => cc_str($input['manufacturer'] ?? null),
        'supplier' => cc_str($input['supplier'] ?? null),
        'catalog_number' => cc_str($input['catalog_number'] ?? null),
        'masterformat' => cc_str($input['masterformat'] ?? null),
        'uniformat' => cc_str($input['uniformat'] ?? null),
        'sub_job_code' => cc_str($input['sub_job_code'] ?? null),
        'sub_job_name' => cc_str($input['sub_job_name'] ?? null),
        'cost_code' => cc_str($input['cost_code'] ?? null),
        'epd_url' => cc_str($input['epd_url'] ?? null),
        'attachment_url' => cc_str($input['attachment_url'] ?? null),
        'item_type' => cc_item_type_for_db($pdo, $input['item_type'] ?? 'material'),
    ];
}

function cc_availability_mode($value): string
{
    $mode = strtolower(trim((string)$value));
    return in_array($mode, ['admin', 'active', 'project'], true) ? $mode : 'admin';
}

function cc_group_availability_cte(string $mode): string
{
    if ($mode === 'admin') return '';
    $enabled = $mode === 'project' ? ' AND g.enabled_for_projects=1' : '';
    $childEnabled = $mode === 'project' ? ' AND child.enabled_for_projects=1' : '';
    return "WITH RECURSIVE group_availability AS (
        SELECT g.id,g.parent_group_id,
          CASE WHEN g.deleted_at IS NULL AND g.active=1$enabled THEN 1 ELSE 0 END AS available
        FROM catalog_groups g WHERE g.parent_group_id IS NULL
        UNION ALL
        SELECT child.id,child.parent_group_id,
          CASE WHEN parent.available=1 AND child.deleted_at IS NULL AND child.active=1$childEnabled THEN 1 ELSE 0 END
        FROM catalog_groups child
        JOIN group_availability parent ON parent.id=child.parent_group_id
    ) ";
}

function cc_payload(PDO $pdo, string $view = 'all', int $catalogId = 0, int $groupId = 0,
    string $availability = 'admin', bool $includeDeleted = false): array
{
    $availability = cc_availability_mode($availability);
    $includeDeleted = $availability === 'admin' && $includeDeleted;
    $cte = cc_group_availability_cte($availability);
    $catalogWhere = [];
    if (!$includeDeleted) $catalogWhere[] = 'c.deleted_at IS NULL';
    if ($availability !== 'admin') $catalogWhere[] = 'c.active=1';
    if ($availability === 'project') $catalogWhere[] = 'c.enabled_for_projects=1';
    $catalogSql = 'SELECT c.*,0 AS item_count FROM catalogs c'
        . ($catalogWhere ? ' WHERE '.implode(' AND ',$catalogWhere) : '')
        . ' ORDER BY c.name';
    $catalogs = $pdo->query($catalogSql)->fetchAll(PDO::FETCH_ASSOC);

    if ($availability === 'admin') {
        $groupWhere = [];
        if (!$includeDeleted) $groupWhere[] = 'g.deleted_at IS NULL AND c.deleted_at IS NULL';
        $groupSql = "SELECT g.*,c.name AS catalog_name,0 AS item_count
            FROM catalog_groups g JOIN catalogs c ON c.id=g.catalog_id"
            . ($groupWhere ? ' WHERE '.implode(' AND ',$groupWhere) : '')
            . ' ORDER BY c.name,g.parent_group_id IS NOT NULL,g.sort_order,g.name';
    } else {
        $groupCatalog = $availability === 'project'
            ? 'c.deleted_at IS NULL AND c.active=1 AND c.enabled_for_projects=1'
            : 'c.deleted_at IS NULL AND c.active=1';
        $groupSql = $cte . "SELECT g.*,c.name AS catalog_name,0 AS item_count
            FROM catalog_groups g JOIN group_availability ga ON ga.id=g.id AND ga.available=1
            JOIN catalogs c ON c.id=g.catalog_id AND $groupCatalog
            ORDER BY c.name,g.parent_group_id IS NOT NULL,g.sort_order,g.name";
    }
    $groups = $pdo->query($groupSql)->fetchAll(PDO::FETCH_ASSOC);

    $joins = " JOIN catalogs c ON c.id=ci.catalog_id
        LEFT JOIN catalog_groups g ON g.id=ci.catalog_group_id
        LEFT JOIN cost_catalogs cc ON cc.id=ci.cost_catalog_id";
    $where = [];
    if (!$includeDeleted) {
        $where[] = 'ci.deleted_at IS NULL AND c.deleted_at IS NULL AND (ci.catalog_group_id IS NULL OR g.deleted_at IS NULL)';
    }
    if ($availability !== 'admin') {
        $joins .= ' LEFT JOIN group_availability ga ON ga.id=ci.catalog_group_id';
        $where[] = 'ci.active=1';
        $where[] = 'c.deleted_at IS NULL AND c.active=1';
        $where[] = '(ci.catalog_group_id IS NULL OR ga.available=1)';
        $where[] = '(ci.cost_catalog_id IS NULL OR (cc.deleted_at IS NULL AND cc.active=1))';
    }
    if ($availability === 'project') {
        $where[] = 'c.enabled_for_projects=1';
        $where[] = "(ci.cost_catalog_id IS NULL OR (
            (cc.effective_from IS NULL OR cc.effective_from<=CURRENT_DATE)
            AND (cc.effective_to IS NULL OR cc.effective_to>=CURRENT_DATE)
        ))";
    }
    $itemSql = $cte . "SELECT ci.*,c.name AS catalog_name,c.deleted_at AS catalog_deleted_at,g.name AS group_name,g.deleted_at AS group_deleted_at
        FROM catalog_items ci $joins"
        . ($where ? ' WHERE '.implode(' AND ',$where) : '')
        . ' ORDER BY c.name,g.name,ci.name';
    $allItems = $pdo->query($itemSql)->fetchAll(PDO::FETCH_ASSOC);

    $pdfAttachments = [];
    $pdfAttachmentCapable = catalog_ra_table_exists($pdo, 'catalog_item_attachments');
    if ($pdfAttachmentCapable) {
        foreach ($pdo->query('SELECT catalog_item_id,original_name,size_bytes,updated_at FROM catalog_item_attachments')->fetchAll(PDO::FETCH_ASSOC) as $attachment) {
            $pdfAttachments[(string)$attachment['catalog_item_id']] = [
                'present'=>true,
                'originalName'=>$attachment['original_name'],
                'sizeBytes'=>(int)$attachment['size_bytes'],
                'updatedAt'=>$attachment['updated_at'],
                'viewUrl'=>'../api/catalog_item_attachment.php?action=view&item_id='.(int)$attachment['catalog_item_id']
            ];
        }
    }
    foreach ($allItems as &$itemRow) $itemRow['pdf_attachment']=$pdfAttachments[(string)$itemRow['id']]??null;
    unset($itemRow);

    $partWhere = $includeDeleted ? '1=1' : 'ap.deleted_at IS NULL';
    $assemblyPartOrder = in_array('sort_order', cc_columns($pdo, 'assembly_parts'), true) ? 'ap.sort_order,ap.id' : 'ap.id';
    $assemblyParts = $pdo->query(
        "SELECT ap.*,child.name AS child_item_name,child.unit_of_measure AS child_unit_of_measure,
            child.unit_cost AS child_unit_cost,child.labor_hours AS child_labor_hours,
            assembly.name AS assembly_item_name
         FROM assembly_parts ap
         JOIN catalog_items child ON child.id=ap.part_catalog_item_id
         JOIN catalog_items assembly ON assembly.id=ap.assembly_catalog_item_id
         WHERE $partWhere ORDER BY assembly.name,$assemblyPartOrder"
    )->fetchAll(PDO::FETCH_ASSOC);

    $blockedAssemblies = [];
    if ($availability === 'project') {
        $availableIds = array_fill_keys(array_map(static fn($row)=>(string)$row['id'],$allItems),true);
        $partsByAssembly = [];
        foreach ($assemblyParts as $part) $partsByAssembly[(string)$part['assembly_catalog_item_id']][] = (string)$part['part_catalog_item_id'];
        $blocked = [];
        do {
            $changed = false;
            foreach ($partsByAssembly as $assemblyId => $childIds) {
                if (isset($blocked[$assemblyId]) || !isset($availableIds[$assemblyId])) continue;
                $unavailable = array_values(array_unique(array_filter($childIds,
                    static fn($childId)=>!isset($availableIds[$childId]) || isset($blocked[$childId]))));
                if ($unavailable) { $blocked[$assemblyId]=$unavailable; $changed=true; }
            }
        } while ($changed);
        foreach ($blocked as $id=>$unavailableIds) $blockedAssemblies[] = [
            'id'=>$id,'availability'=>'blocked','unavailableComponentIds'=>$unavailableIds
        ];
        if ($blocked) {
            $allItems = array_values(array_filter($allItems,static fn($row)=>!isset($blocked[(string)$row['id']])));
            $availableIds = array_fill_keys(array_map(static fn($row)=>(string)$row['id'],$allItems),true);
            $assemblyParts = array_values(array_filter($assemblyParts,static fn($part)=>
                isset($availableIds[(string)$part['assembly_catalog_item_id']])
                && isset($availableIds[(string)$part['part_catalog_item_id']])));
        }
    }

    $catalogCounts=[];$groupCounts=[];
    foreach ($allItems as $row) {
        $catalogCounts[(string)$row['catalog_id']] = ($catalogCounts[(string)$row['catalog_id']]??0)+1;
        if (!empty($row['catalog_group_id'])) $groupCounts[(string)$row['catalog_group_id']] = ($groupCounts[(string)$row['catalog_group_id']]??0)+1;
    }
    foreach ($catalogs as &$row) $row['item_count']=$catalogCounts[(string)$row['id']]??0; unset($row);
    foreach ($groups as &$row) $row['item_count']=$groupCounts[(string)$row['id']]??0; unset($row);

    $items = array_values(array_filter($allItems, static function($row) use($view,$catalogId,$groupId) {
        if ($view==='catalog' && $catalogId>0) return (int)$row['catalog_id']===$catalogId;
        if ($view==='group' && $groupId>0) return (int)$row['catalog_group_id']===$groupId;
        return true;
    }));
    if ($view === 'recent') {
        usort($items, static fn($a, $b) => strcmp((string)$b['updated_at'], (string)$a['updated_at']));
        $items = array_slice($items, 0, 100);
    }

    $archivedCatalogs = [];
    $archivedGroups = [];
    if ($availability === 'admin') {
        $archivedCatalogs = $pdo->query('SELECT c.*, (SELECT COUNT(*) FROM catalog_items ci WHERE ci.catalog_id=c.id) AS item_count FROM catalogs c WHERE c.deleted_at IS NOT NULL ORDER BY c.name')->fetchAll(PDO::FETCH_ASSOC);
        $archivedGroups = $pdo->query('SELECT g.*, c.name AS catalog_name, (SELECT COUNT(*) FROM catalog_items ci WHERE ci.catalog_group_id=g.id) AS item_count FROM catalog_groups g JOIN catalogs c ON c.id=g.catalog_id WHERE g.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL ORDER BY c.name, g.name')->fetchAll(PDO::FETCH_ASSOC);
    }

    $revisioning = isset(catalog_ra_columns($pdo,'catalog_items')['revision']);
    $capabilities = ['availabilityFiltering'=>true,'revisioning'=>$revisioning,'itemPdfAttachments'=>$pdfAttachmentCapable,
        'availabilityModes'=>['admin','active','project'],'projectAssemblies'=>'exclude_blocked'];
    return compact('catalogs','groups','items','allItems','assemblyParts','blockedAssemblies','capabilities','availability','archivedCatalogs','archivedGroups');
}
try {
    // Schema is deployment-owned. Apply db/migrations before serving this endpoint;
    // request-time CREATE/ALTER repair is intentionally disabled.

    // Backwards-compatible adapter: the legacy UI keeps its action names and
    // response payload, while every mutation is executed by the same domain
    // service used by api/catalog_admin.php.
    $legacyCommands = [
        'copy_catalog'=>'catalog.copy','delete_catalog'=>'catalog.archive','restore_catalog'=>'catalog.restore','purge_catalog'=>'catalog.purge','toggle_catalog'=>'catalog.toggle','reorder_catalogs'=>'catalog.reorder',
        'copy_group'=>'category.copy','delete_group'=>'category.archive','restore_group'=>'category.restore','purge_group'=>'category.purge','toggle_group'=>'category.toggle','reorder_groups'=>'category.reorder',
        'duplicate_item'=>'item.duplicate','delete_item'=>'item.archive','restore_item'=>'item.restore','purge_item'=>'item.purge','move_item'=>'item.move',
        'convert_item_assembly'=>'item.convert_assembly','add_assembly_part'=>'assembly_component.add',
        'update_assembly_part'=>'assembly_component.update',
        'reorder_assembly_parts'=>'assembly_component.reorder',
        'delete_assembly_part'=>'assembly_component.remove'
    ];
    if ($action === 'save_catalog') $legacyCommands[$action] = cc_int($input['id'] ?? 0) ? 'catalog.update' : 'catalog.create';
    if ($action === 'save_group') $legacyCommands[$action] = cc_int($input['id'] ?? 0) ? 'category.update' : 'category.create';
    if ($action === 'save_item') $legacyCommands[$action] = cc_int($input['id'] ?? 0) ? 'item.update' : 'item.create';
    if (isset($legacyCommands[$action])) {
        try {
            $result = (new CatalogAdminService($pdo))->execute($legacyCommands[$action], $input);
            $resultId = (int)($result['id'] ?? $input['id'] ?? 0);
            $view = (string)($input['view'] ?? 'all');
            $catalogId = cc_int($input['catalog_id'] ?? ($result['entity']['catalog_id'] ?? 0));
            $groupId = cc_int($input['group_id'] ?? $input['catalog_group_id'] ?? ($result['entity']['catalog_group_id'] ?? 0));
            if (in_array($action, ['purge_catalog', 'delete_catalog'], true) || in_array($legacyCommands[$action] ?? '', ['catalog.purge', 'catalog.archive'], true)) {
                $catalogId = 0;
                $groupId = 0;
            } elseif (in_array($action, ['purge_group', 'delete_group'], true) || in_array($legacyCommands[$action] ?? '', ['category.purge', 'category.archive'], true)) {
                $groupId = 0;
            }
            cc_json(['status'=>'success','id'=>$resultId,'revision'=>$result['entity']['revision'] ?? ($result['assembly']['revision'] ?? null),'merged'=>$result['merged']??false,
                'affected_items'=>$result['affected_items']??null,'affected_categories'=>$result['affected_categories']??null,
                'data'=>cc_payload($pdo, $view, $catalogId, $groupId)]);
        } catch (CatalogRevisionConflict $e) {
            cc_json(['status'=>'error','code'=>'revision_conflict','msg'=>$e->getMessage(),'current'=>$e->current],409);
        } catch (CatalogAdminException $e) {
            cc_json(['status'=>'error','code'=>strtolower($e->errorCode),'msg'=>$e->getMessage(),'details'=>$e->details],$e->httpStatus);
        }
    }

    if (in_array($action, ['batch_archive', 'batch_restore', 'batch_purge', 'batch_move', 'batch_toggle', 'batch_copy'], true)) {
        $rawIds = is_array($input['ids'] ?? null) ? $input['ids'] : (is_array($input['item_ids'] ?? null) ? $input['item_ids'] : []);
        $ids = array_values(array_filter(array_map('intval', $rawIds), fn($v) => $v > 0));
        $view = (string)($input['view'] ?? 'all');
        $catalogId = cc_int($input['catalog_id'] ?? 0);
        $groupId = cc_int($input['group_id'] ?? 0);

        if (!empty($ids)) {
            $inClause = implode(',', array_fill(0, count($ids), '?'));
            $now = date('Y-m-d H:i:s');
            if ($action === 'batch_archive') {
                $stmt = $pdo->prepare("UPDATE catalog_items SET deleted_at=? WHERE id IN ($inClause)");
                $stmt->execute(array_merge([$now], $ids));
            } elseif ($action === 'batch_restore') {
                $stmt = $pdo->prepare("UPDATE catalog_items SET deleted_at=NULL WHERE id IN ($inClause)");
                $stmt->execute($ids);
            } elseif ($action === 'batch_purge') {
                $ownTx = !$pdo->inTransaction();
                if ($ownTx) {
                    $pdo->beginTransaction();
                }
                try {
                    if (catalog_ra_table_exists($pdo, 'assembly_parts')) {
                        $pdo->prepare("DELETE FROM assembly_parts WHERE part_catalog_item_id IN ($inClause) OR assembly_catalog_item_id IN ($inClause)")
                            ->execute(array_merge($ids, $ids));
                    }
                    if (catalog_ra_table_exists($pdo, 'assembly_items')) {
                        $pdo->prepare("DELETE FROM assembly_items WHERE assembly_id IN ($inClause) OR catalog_item_id IN ($inClause)")
                            ->execute(array_merge($ids, $ids));
                    }
                    if (catalog_ra_table_exists($pdo, 'catalog_item_attachments')) {
                        $pdo->prepare("DELETE FROM catalog_item_attachments WHERE catalog_item_id IN ($inClause)")->execute($ids);
                    }
                    if (catalog_ra_table_exists($pdo, 'catalog_item_attributes')) {
                        $pdo->prepare("DELETE FROM catalog_item_attributes WHERE catalog_item_id IN ($inClause)")->execute($ids);
                    }
                    $pdo->prepare("DELETE FROM catalog_items WHERE id IN ($inClause)")->execute($ids);
                    if ($ownTx) {
                        $pdo->commit();
                    }
                } catch (\Throwable $e) {
                    if ($ownTx && $pdo->inTransaction()) {
                        $pdo->rollBack();
                    }
                    throw $e;
                }
            } elseif ($action === 'batch_move') {
                $targetCatId = cc_int($input['target_catalog_id'] ?? ($input['catalog_id'] ?? 0));
                $targetGrpId = cc_int($input['target_group_id'] ?? ($input['catalog_group_id'] ?? 0));
                if ($targetCatId > 0) {
                    $grpParam = $targetGrpId > 0 ? $targetGrpId : null;
                    $stmt = $pdo->prepare("UPDATE catalog_items SET catalog_id=?, catalog_group_id=? WHERE id IN ($inClause)");
                    $stmt->execute(array_merge([$targetCatId, $grpParam], $ids));
                }
            } elseif ($action === 'batch_copy') {
                $targetCatId = cc_int($input['target_catalog_id'] ?? ($input['catalog_id'] ?? 0));
                $targetGrpId = cc_int($input['target_group_id'] ?? ($input['catalog_group_id'] ?? 0));
                if ($targetCatId > 0) {
                    $grpParam = $targetGrpId > 0 ? $targetGrpId : null;
                    $stmtFetch = $pdo->prepare("SELECT * FROM catalog_items WHERE id IN ($inClause)");
                    $stmtFetch->execute($ids);
                    $sourceRows = $stmtFetch->fetchAll(PDO::FETCH_ASSOC);
                    foreach ($sourceRows as $r) {
                        $sourceId = (int)$r['id'];
                        $oldCatId = (int)$r['catalog_id'];
                        $oldGrpId = (int)($r['catalog_group_id'] ?? 0);
                        foreach (['id', 'revision', 'created_at', 'updated_at', 'deleted_at'] as $k) {
                            unset($r[$k]);
                        }
                        if ($targetCatId === $oldCatId && $grpParam === ($oldGrpId ?: null)) {
                            $r['name'] .= ' Copy';
                        }
                        $r['catalog_id'] = $targetCatId;
                        $r['catalog_group_id'] = $grpParam;
                        $r['created_at'] = $now;
                        $r['updated_at'] = $now;
                        $r['deleted_at'] = null;
                        $cols = array_keys($r);
                        $colList = implode(',', $cols);
                        $placeholders = implode(',', array_fill(0, count($cols), '?'));
                        $insertStmt = $pdo->prepare("INSERT INTO catalog_items ($colList) VALUES ($placeholders)");
                        $insertStmt->execute(array_values($r));
                        $newId = (int)$pdo->lastInsertId();

                        if (strtolower((string)($r['item_type'] ?? '')) === 'assembly' && catalog_ra_table_exists($pdo, 'assembly_parts')) {
                            $partOrder = in_array('sort_order', cc_columns($pdo, 'assembly_parts'), true) ? 'sort_order, id' : 'id';
                            $partStmt = $pdo->prepare("SELECT * FROM assembly_parts WHERE assembly_catalog_item_id=? AND deleted_at IS NULL ORDER BY $partOrder");
                            $partStmt->execute([$sourceId]);
                            foreach ($partStmt->fetchAll(PDO::FETCH_ASSOC) as $part) {
                                foreach (['id', 'revision', 'created_at', 'updated_at', 'deleted_at'] as $pk) unset($part[$pk]);
                                $part['assembly_catalog_item_id'] = $newId;
                                $part['created_at'] = $now;
                                $part['updated_at'] = $now;
                                $pCols = array_keys($part);
                                $pdo->prepare("INSERT INTO assembly_parts (" . implode(',', $pCols) . ") VALUES (" . implode(',', array_fill(0, count($pCols), '?')) . ")")
                                    ->execute(array_values($part));
                            }
                        }
                    }
                }
            } elseif ($action === 'batch_toggle') {
                $newStatus = !empty($input['status']) ? 1 : 0;
                $stmt = $pdo->prepare("UPDATE catalog_items SET active=? WHERE id IN ($inClause)");
                $stmt->execute(array_merge([$newStatus], $ids));
            }
        }

        cc_json([
            'status' => 'success',
            'affected_count' => count($ids),
            'data' => cc_payload($pdo, $view, $catalogId, $groupId)
        ]);
    }

    switch ($action) {
        case 'list':
            $availability = cc_availability_mode($_GET['availability'] ?? 'admin');
            $includeDeleted = $availability === 'admin' && filter_var($_GET['include_deleted'] ?? false, FILTER_VALIDATE_BOOLEAN);
            cc_json(['status' => 'success', 'data' => cc_payload($pdo, (string)($_GET['view'] ?? 'all'),
                cc_int($_GET['catalog_id'] ?? 0), cc_int($_GET['group_id'] ?? 0), $availability, $includeDeleted)]);

        default:
            cc_json(['status' => 'error', 'msg' => 'Invalid action'], 404);
    }
} catch (CatalogRevisionConflict $e) {
    cc_json(['status' => 'error', 'code' => 'revision_conflict',
        'msg' => $e->getMessage(), 'current' => $e->current], 409);
} catch (Throwable $e) {
    cc_json(['status' => 'error', 'msg' => $e->getMessage()], 500);
}
