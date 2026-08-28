<?php
declare(strict_types=1);

require_once __DIR__ . '/catalog_revision_audit.php';

final class CatalogAdminException extends RuntimeException
{
    public string $errorCode;
    public int $httpStatus;
    public array $details;
    public function __construct(string $code, string $message, int $status = 422, array $details = [])
    {
        parent::__construct($message); $this->errorCode = $code; $this->httpStatus = $status; $this->details = $details;
    }
}

final class CatalogAdminService
{
    private PDO $pdo;
    public function __construct(PDO $pdo) { $this->pdo = $pdo; }

    public function execute(string $command, array $payload): array
    {
        $payload['request_id'] = catalog_ra_request_id($payload);
        $map = [
            'catalog.create'=>'createCatalog','catalog.update'=>'updateCatalog','catalog.toggle'=>'toggleCatalog',
            'catalog.archive'=>'archiveCatalog','catalog.restore'=>'restoreCatalog','catalog.copy'=>'copyCatalog',
            'category.create'=>'createCategory','category.update'=>'updateCategory','category.toggle'=>'toggleCategory',
            'category.archive'=>'archiveCategory','category.restore'=>'restoreCategory','category.copy'=>'copyCategory',
            'item.create'=>'createItem','item.update'=>'updateItem','item.archive'=>'archiveItem','item.restore'=>'restoreItem',
            'item.move'=>'moveItem','item.duplicate'=>'duplicateItem','item.convert_assembly'=>'convertItemAssembly',
            'assembly_component.add'=>'addAssemblyComponent','assembly_component.update'=>'updateAssemblyComponent',
            'assembly_component.remove'=>'removeAssemblyComponent','assembly_component.reorder'=>'reorderAssemblyComponents'
        ];
        if (!isset($map[$command])) throw new CatalogAdminException('INVALID_COMMAND', 'Unknown catalog command.', 404);
        return $this->transaction(fn() => $this->{$map[$command]}($payload));
    }

    /** Internal binary endpoint command; deliberately not exposed by execute(). */
    public function replaceItemPdf(array $p): array
    {
        return $this->transaction(function () use ($p) {
            $id = $this->requiredId($p, 'item_id');
            $item = catalog_ra_assert_expected($this->pdo, 'catalog_items', $id, $p);
            if (!empty($item['deleted_at']) || empty($item['active'])) throw new CatalogAdminException('NOT_FOUND', 'Active catalog item was not found.', 404);
            $this->assertUnlocked((int)$item['catalog_id']);
            if (!catalog_ra_table_exists($this->pdo, 'catalog_item_attachments')) throw new CatalogAdminException('MIGRATION_REQUIRED', 'PDF attachment storage is not installed.', 503);
            $old = $this->pdo->prepare('SELECT storage_name FROM catalog_item_attachments WHERE catalog_item_id=? FOR UPDATE');
            $old->execute([$id]); $oldName = $old->fetchColumn() ?: null;
            $stmt = $this->pdo->prepare('INSERT INTO catalog_item_attachments
                (catalog_item_id,storage_name,original_name,mime_type,size_bytes,sha256,uploaded_by)
                VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE storage_name=VALUES(storage_name),original_name=VALUES(original_name),
                mime_type=VALUES(mime_type),size_bytes=VALUES(size_bytes),sha256=VALUES(sha256),uploaded_by=VALUES(uploaded_by)');
            $stmt->execute([$id,$p['storage_name'],$p['original_name'],'application/pdf',(int)$p['size_bytes'],$p['sha256'],$p['actor_user_id']??null]);
            $entity = catalog_ra_update($this->pdo,'catalog_items','item',$id,[],'item.pdf_replaced',$p,(int)$item['catalog_id'],true);
            return ['id'=>$id,'entity'=>$entity,'previous_storage_name'=>$oldName];
        });
    }

    public function removeItemPdf(array $p): array
    {
        return $this->transaction(function () use ($p) {
            $id=$this->requiredId($p,'item_id'); $item=catalog_ra_assert_expected($this->pdo,'catalog_items',$id,$p);
            if (!empty($item['deleted_at']) || empty($item['active'])) throw new CatalogAdminException('NOT_FOUND','Active catalog item was not found.',404);
            $this->assertUnlocked((int)$item['catalog_id']);
            if (!catalog_ra_table_exists($this->pdo,'catalog_item_attachments')) throw new CatalogAdminException('MIGRATION_REQUIRED','PDF attachment storage is not installed.',503);
            $stmt=$this->pdo->prepare('SELECT storage_name FROM catalog_item_attachments WHERE catalog_item_id=? FOR UPDATE');$stmt->execute([$id]);$old=$stmt->fetchColumn();
            if (!$old) return ['id'=>$id,'entity'=>$item,'previous_storage_name'=>null];
            $this->pdo->prepare('DELETE FROM catalog_item_attachments WHERE catalog_item_id=?')->execute([$id]);
            $entity=catalog_ra_update($this->pdo,'catalog_items','item',$id,[],'item.pdf_removed',$p,(int)$item['catalog_id'],true);
            return ['id'=>$id,'entity'=>$entity,'previous_storage_name'=>$old];
        });
    }

    private function transaction(callable $callback): array
    {
        $ownTransaction = !$this->pdo->inTransaction();
        if ($ownTransaction) $this->pdo->beginTransaction();
        try { $result = $callback(); if ($ownTransaction) $this->pdo->commit(); return $result; }
        catch (Throwable $e) { if ($ownTransaction && $this->pdo->inTransaction()) $this->pdo->rollBack(); throw $e; }
    }
    private function requiredId(array $p, string $key = 'id'): int
    { $id = (int)($p[$key] ?? 0); if ($id < 1) throw new CatalogAdminException('INVALID_ID', "$key is required."); return $id; }
    private function text($v): ?string { $v = trim((string)($v ?? '')); return $v === '' ? null : $v; }
    private function tableRow(string $table, int $id, bool $active = true): array
    {
        $row = catalog_ra_row($this->pdo, $table, $id, true);
        if (!$row || ($active && !empty($row['deleted_at']))) throw new CatalogAdminException('NOT_FOUND', 'Catalog record was not found.', 404);
        return $row;
    }
    private function catalog(int $id, bool $active = true): array { return $this->tableRow('catalogs', $id, $active); }
    private function assertUnlocked(int $catalogId): array
    { $row = $this->catalog($catalogId); if (!empty($row['locked'])) throw new CatalogAdminException('CATALOG_LOCKED', 'This catalog is locked.', 409); return $row; }
    private function categoryForCatalog(?int $categoryId, int $catalogId, ?int $selfId = null): ?array
    {
        if (!$categoryId) return null;
        if ($selfId && $categoryId === $selfId) throw new CatalogAdminException('CATEGORY_CYCLE', 'A category cannot be its own parent.', 422);
        $row = $this->tableRow('catalog_groups', $categoryId);
        if ((int)$row['catalog_id'] !== $catalogId) throw new CatalogAdminException('CATEGORY_CATALOG_MISMATCH', 'Category must belong to the selected catalog.', 422);
        $ancestor = $row;
        $seen = [];
        while ($selfId && !empty($ancestor['parent_group_id'])) {
            $ancestorId = (int)$ancestor['parent_group_id'];
            if ($ancestorId === $selfId || isset($seen[$ancestorId])) {
                throw new CatalogAdminException('CATEGORY_CYCLE', 'Category hierarchy cannot contain a cycle.', 422);
            }
            $seen[$ancestorId] = true;
            $ancestor = $this->tableRow('catalog_groups', $ancestorId);
            if ((int)$ancestor['catalog_id'] !== $catalogId) throw new CatalogAdminException('CATEGORY_CATALOG_MISMATCH', 'Category ancestry must remain in one catalog.', 422);
        }
        return $row;
    }
    private function itemValues(array $p): array
    {
        $catalogId = $this->requiredId($p, 'catalog_id');
        $groupId = (int)($p['catalog_group_id'] ?? 0) ?: null;
        $this->assertUnlocked($catalogId); $this->categoryForCatalog($groupId, $catalogId);
        $name = $this->text($p['name'] ?? null);
        if (!$name) throw new CatalogAdminException('VALIDATION_ERROR', 'Item name is required.', 422, ['field'=>'name']);
        $allowedTypes = ['part','material','assembly','labor','equipment','subcontractor','travel','custom'];
        $type = strtolower((string)($p['item_type'] ?? 'material')); if (!in_array($type, $allowedTypes, true)) $type = 'material';
        $columns = catalog_ra_columns($this->pdo, 'catalog_items');
        $values = [
            'catalog_id'=>$catalogId,'cost_catalog_id'=>(int)($p['cost_catalog_id'] ?? 0) ?: null,'catalog_group_id'=>$groupId,
            'sku'=>$this->text($p['sku'] ?? null),'name'=>$name,'description'=>$this->text($p['description'] ?? null),
            'item_type'=>$type,'cost_type'=>$this->text($p['cost_type'] ?? null),'unit_of_measure'=>$this->text($p['unit_of_measure'] ?? null) ?: 'ea',
            'unit_cost'=>(float)($p['unit_cost'] ?? 0),'material_cost'=>(float)($p['material_cost'] ?? 0),
            'labor_cost'=>(float)($p['labor_cost'] ?? 0),'equipment_cost'=>(float)($p['equipment_cost'] ?? 0),
            'subcontractor_cost'=>(float)($p['subcontractor_cost'] ?? 0),'labor_hours'=>(float)($p['labor_hours'] ?? 0),
            'labor_rate'=>(float)($p['labor_rate'] ?? 0),'markup_percent'=>(float)($p['markup_percent'] ?? 0),
            'waste_factor_percent'=>(float)($p['waste_factor_percent'] ?? 0),'taxable'=>!empty($p['taxable'])?1:0,
            'manufacturer'=>$this->text($p['manufacturer'] ?? null),'supplier'=>$this->text($p['supplier'] ?? null),
            'catalog_number'=>$this->text($p['catalog_number'] ?? null),'cost_code'=>$this->text($p['cost_code'] ?? null),
            'masterformat'=>$this->text($p['masterformat'] ?? null),'uniformat'=>$this->text($p['uniformat'] ?? null),
            'sub_job_code'=>$this->text($p['sub_job_code'] ?? null),'sub_job_name'=>$this->text($p['sub_job_name'] ?? null),
            'epd_url'=>$this->text($p['epd_url'] ?? null),'attachment_url'=>$this->text($p['attachment_url'] ?? null),
            'color'=>$this->text($p['color'] ?? null),'symbol'=>$this->text($p['symbol'] ?? null),
            'active'=>array_key_exists('active', $p) ? (!empty($p['active']) ? 1 : 0) : 1
        ];
        return array_intersect_key($values, $columns);
    }
    private function insert(string $table, array $values): int
    {
        $columns=array_keys($values); $sql="INSERT INTO `$table` (`".implode('`,`',$columns)."`) VALUES (".implode(',',array_fill(0,count($columns),'?')).')';
        $this->pdo->prepare($sql)->execute(array_values($values)); return (int)$this->pdo->lastInsertId();
    }

    public function createCatalog(array $p): array { return $this->transaction(function() use($p) {
        $name=$this->text($p['name']??null); if(!$name) throw new CatalogAdminException('VALIDATION_ERROR','Catalog name is required.');
        $id=$this->insert('catalogs',['name'=>$name,'description'=>$this->text($p['description']??null),'trade'=>$this->text($p['trade']??null),'active'=>!empty($p['active'])?1:0,'locked'=>!empty($p['locked'])?1:0,'enabled_for_projects'=>!empty($p['enabled_for_projects'])?1:0]);
        $bookId=$this->insert('cost_catalogs',['catalog_id'=>$id,'name'=>$name.' Cost Book','currency_code'=>'USD','active'=>1]);
        catalog_ra_created($this->pdo,'catalogs','catalog',$id,'catalog.created',$p,$id); catalog_ra_created($this->pdo,'cost_catalogs','cost_catalog',$bookId,'cost_catalog.created',$p,$id);
        return ['id'=>$id,'entity'=>catalog_ra_row($this->pdo,'catalogs',$id)]; }); }
    public function updateCatalog(array $p): array { return $this->transaction(function() use($p) { $id=$this->requiredId($p); $this->assertUnlocked($id);
        $old=$this->catalog($id); $values=[]; foreach(['name','description','trade','active','locked','enabled_for_projects'] as $k) if(array_key_exists($k,$p)) $values[$k]=in_array($k,['active','locked','enabled_for_projects'],true)?(!empty($p[$k])?1:0):$this->text($p[$k]);
        if(isset($values['name'])&&!$values['name']) throw new CatalogAdminException('VALIDATION_ERROR','Catalog name is required.');
        return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalogs','catalog',$id,$values,'catalog.updated',$p,$id)]; }); }
    public function toggleCatalog(array $p): array { return $this->transaction(function() use($p){$id=$this->requiredId($p);$row=$this->assertUnlocked($id);$f=($p['field']??'')==='enabled_for_projects'?'enabled_for_projects':'active';return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalogs','catalog',$id,[$f=>empty($row[$f])?1:0],'catalog.toggled',$p,$id)];});}
    public function archiveCatalog(array $p): array { return $this->transaction(function() use($p){$id=$this->requiredId($p);$this->assertUnlocked($id);return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalogs','catalog',$id,['deleted_at'=>date('Y-m-d H:i:s')],'catalog.archived',$p,$id)];});}
    public function restoreCatalog(array $p): array { return $this->transaction(function() use($p){$id=$this->requiredId($p);$row=$this->catalog($id,false);if(!empty($row['locked']))throw new CatalogAdminException('CATALOG_LOCKED','This catalog is locked.',409);return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalogs','catalog',$id,['deleted_at'=>null],'catalog.restored',$p,$id)];});}
    public function copyCatalog(array $p): array { return $this->transaction(function() use($p){$source=$this->catalog($this->requiredId($p));$this->assertUnlocked((int)$source['id']);$id=$this->insert('catalogs',['name'=>$source['name'].' Copy','description'=>$source['description'],'trade'=>$source['trade'],'active'=>$source['active'],'locked'=>0,'enabled_for_projects'=>$source['enabled_for_projects'],'metadata_json'=>$source['metadata_json']]);catalog_ra_created($this->pdo,'catalogs','catalog',$id,'catalog.copied',$p,$id);
        $stmt=$this->pdo->prepare('SELECT * FROM catalog_groups WHERE catalog_id=? AND deleted_at IS NULL ORDER BY parent_group_id IS NOT NULL,id');$stmt->execute([(int)$source['id']]);$map=[];foreach($stmt->fetchAll(PDO::FETCH_ASSOC) as $g){$gid=$this->insert('catalog_groups',['catalog_id'=>$id,'parent_group_id'=>$g['parent_group_id']?($map[(int)$g['parent_group_id']]??null):null,'name'=>$g['name'],'description'=>$g['description'],'sort_order'=>$g['sort_order'],'active'=>$g['active'],'enabled_for_projects'=>$g['enabled_for_projects'],'metadata_json'=>$g['metadata_json']]);$map[(int)$g['id']]=$gid;catalog_ra_created($this->pdo,'catalog_groups','category',$gid,'category.copied',$p,$id);}return ['id'=>$id,'entity'=>catalog_ra_row($this->pdo,'catalogs',$id)];});}

    public function createCategory(array $p): array { return $this->transaction(function() use($p){$cid=$this->requiredId($p,'catalog_id');$this->assertUnlocked($cid);$parent=(int)($p['parent_group_id']??0)?:null;$this->categoryForCatalog($parent,$cid);$name=$this->text($p['name']??null);if(!$name)throw new CatalogAdminException('VALIDATION_ERROR','Category name is required.');$id=$this->insert('catalog_groups',['catalog_id'=>$cid,'parent_group_id'=>$parent,'name'=>$name,'description'=>$this->text($p['description']??null),'sort_order'=>(int)($p['sort_order']??0),'active'=>!empty($p['active'])?1:0,'enabled_for_projects'=>!empty($p['enabled_for_projects'])?1:0]);catalog_ra_created($this->pdo,'catalog_groups','category',$id,'category.created',$p,$cid);return ['id'=>$id,'entity'=>catalog_ra_row($this->pdo,'catalog_groups',$id)];});}
    public function updateCategory(array $p): array { return $this->transaction(function() use($p){$id=$this->requiredId($p);$old=$this->tableRow('catalog_groups',$id);$cid=(int)($p['catalog_id']??$old['catalog_id']);$this->assertUnlocked($cid);$parent=array_key_exists('parent_group_id',$p)?((int)$p['parent_group_id']?:null):($old['parent_group_id']? (int)$old['parent_group_id']:null);$this->categoryForCatalog($parent,$cid,$id);$values=[];foreach(['catalog_id','parent_group_id','name','description','sort_order','active','enabled_for_projects'] as $k)if(array_key_exists($k,$p))$values[$k]=in_array($k,['active','enabled_for_projects'],true)?(!empty($p[$k])?1:0):($k==='parent_group_id'?$parent:$p[$k]);$action=((int)$old['catalog_id']!==$cid||(string)($old['parent_group_id']??'')!==(string)($parent??''))?'category.moved':'category.updated';return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalog_groups','category',$id,$values,$action,$p,$cid)];});}
    public function toggleCategory(array $p): array {$id=$this->requiredId($p);$r=$this->tableRow('catalog_groups',$id);$this->assertUnlocked((int)$r['catalog_id']);$f=($p['field']??'')==='enabled_for_projects'?'enabled_for_projects':'active';return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalog_groups','category',$id,[$f=>empty($r[$f])?1:0],'category.toggled',$p,(int)$r['catalog_id'])];}
    public function archiveCategory(array $p): array {$id=$this->requiredId($p);$r=$this->tableRow('catalog_groups',$id);$this->assertUnlocked((int)$r['catalog_id']);return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalog_groups','category',$id,['deleted_at'=>date('Y-m-d H:i:s')],'category.archived',$p,(int)$r['catalog_id'])];}
    public function restoreCategory(array $p): array {$id=$this->requiredId($p);$r=$this->tableRow('catalog_groups',$id,false);$this->assertUnlocked((int)$r['catalog_id']);return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalog_groups','category',$id,['deleted_at'=>null],'category.restored',$p,(int)$r['catalog_id'])];}
    public function copyCategory(array $p): array {$r=$this->tableRow('catalog_groups',$this->requiredId($p));$this->assertUnlocked((int)$r['catalog_id']);$id=$this->insert('catalog_groups',['catalog_id'=>$r['catalog_id'],'parent_group_id'=>$r['parent_group_id'],'name'=>$r['name'].' Copy','description'=>$r['description'],'sort_order'=>$r['sort_order'],'active'=>$r['active'],'enabled_for_projects'=>$r['enabled_for_projects'],'metadata_json'=>$r['metadata_json']]);catalog_ra_created($this->pdo,'catalog_groups','category',$id,'category.copied',$p,(int)$r['catalog_id']);return ['id'=>$id,'entity'=>catalog_ra_row($this->pdo,'catalog_groups',$id)];}

    public function createItem(array $p): array {$v=$this->itemValues($p);$id=$this->insert('catalog_items',$v);catalog_ra_created($this->pdo,'catalog_items','item',$id,'item.created',$p,(int)$v['catalog_id']);return ['id'=>$id,'entity'=>catalog_ra_row($this->pdo,'catalog_items',$id)];}
    public function updateItem(array $p): array {$id=$this->requiredId($p);$old=$this->tableRow('catalog_items',$id);$merged=array_merge($old,$p);$v=$this->itemValues($merged);return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalog_items','item',$id,$v,'item.updated',$p,(int)$v['catalog_id'])];}
    public function archiveItem(array $p): array {$id=$this->requiredId($p);$r=$this->tableRow('catalog_items',$id);$this->assertUnlocked((int)$r['catalog_id']);return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalog_items','item',$id,['deleted_at'=>date('Y-m-d H:i:s')],'item.archived',$p,(int)$r['catalog_id'])];}
    public function restoreItem(array $p): array {$id=$this->requiredId($p);$r=$this->tableRow('catalog_items',$id,false);$this->assertUnlocked((int)$r['catalog_id']);return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalog_items','item',$id,['deleted_at'=>null],'item.restored',$p,(int)$r['catalog_id'])];}
    public function moveItem(array $p): array {$id=$this->requiredId($p);$old=$this->tableRow('catalog_items',$id);$cid=$this->requiredId($p,'catalog_id');$this->assertUnlocked((int)$old['catalog_id']);$this->assertUnlocked($cid);$gid=(int)($p['catalog_group_id']??0)?:null;$this->categoryForCatalog($gid,$cid);return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalog_items','item',$id,['catalog_id'=>$cid,'catalog_group_id'=>$gid],'item.moved',$p,$cid)];}
    public function duplicateItem(array $p): array {$r=$this->tableRow('catalog_items',$this->requiredId($p));$this->assertUnlocked((int)$r['catalog_id']);foreach(['id','revision','created_at','updated_at','deleted_at'] as $k)unset($r[$k]);$r['name'].=' Copy';$id=$this->insert('catalog_items',$r);catalog_ra_created($this->pdo,'catalog_items','item',$id,'item.copied',$p,(int)$r['catalog_id']);return ['id'=>$id,'entity'=>catalog_ra_row($this->pdo,'catalog_items',$id)];}
    public function convertItemAssembly(array $p): array {$id=$this->requiredId($p);$r=$this->tableRow('catalog_items',$id);$this->assertUnlocked((int)$r['catalog_id']);return ['id'=>$id,'entity'=>catalog_ra_update($this->pdo,'catalog_items','item',$id,['item_type'=>'assembly'],'item.converted_to_assembly',$p,(int)$r['catalog_id'])];}

    private function assertNoAssemblyCycle(int $assemblyId,int $childId):void
    { if($assemblyId===$childId)throw new CatalogAdminException('ASSEMBLY_SELF_REFERENCE','Assembly cannot contain itself.',422);$seen=[];$queue=[$childId];$stmt=$this->pdo->prepare('SELECT part_catalog_item_id FROM assembly_parts WHERE assembly_catalog_item_id=? AND deleted_at IS NULL');while($queue){$current=array_shift($queue);if($current===$assemblyId)throw new CatalogAdminException('ASSEMBLY_CYCLE','Nested assembly components cannot create a cycle.',422);if(isset($seen[$current]))continue;$seen[$current]=true;$stmt->execute([$current]);foreach($stmt->fetchAll(PDO::FETCH_COLUMN)as$next)$queue[]=(int)$next;}}
    private function componentValues(array $p,array $old=[]):array
    {$columns=catalog_ra_columns($this->pdo,'assembly_parts');$ratio=strtolower((string)($p['ratio_type']??$p['ratioType']??$old['ratio_type']??'per_unit'));$allowed=['fixed','per_unit','per_linear_length','per_area','per_endpoint','spacing_based'];if(!in_array($ratio,$allowed,true))throw new CatalogAdminException('VALIDATION_ERROR','Invalid component ratio type.');$q=(float)($p['quantity']??$old['quantity']??0);if($q<=0)throw new CatalogAdminException('VALIDATION_ERROR','Quantity must be greater than zero.');$spacing=$p['spacing']??$p['spacing_value']??$old['spacing_value']??null;if($ratio==='spacing_based'&&(float)$spacing<=0)throw new CatalogAdminException('VALIDATION_ERROR','Spacing must be greater than zero.');$values=['quantity'=>$q,'ratio_type'=>$ratio,'spacing_value'=>$ratio==='spacing_based'?(float)$spacing:null,'waste_factor_percent'=>max(0,(float)($p['waste']??$p['waste_factor_percent']??$old['waste_factor_percent']??0)),'sort_order'=>(int)($p['sort_order']??$old['sort_order']??0)];return array_intersect_key($values,$columns);}
    private function recalculateAssembly(int $id,array $p,string $action):array{$stmt=$this->pdo->prepare('SELECT COALESCE(SUM(quantity*unit_cost_snapshot),0) unit_cost,COALESCE(SUM(quantity*unit_labor_time_snapshot),0) labor_hours FROM assembly_parts WHERE assembly_catalog_item_id=? AND deleted_at IS NULL');$stmt->execute([$id]);$t=$stmt->fetch(PDO::FETCH_ASSOC);return catalog_ra_update($this->pdo,'catalog_items','item',$id,['item_type'=>'assembly','unit_cost'=>(float)$t['unit_cost'],'labor_hours'=>(float)$t['labor_hours']],$action,$p,null,true);}
    public function addAssemblyComponent(array $p): array {return $this->transaction(function()use($p){$aid=$this->requiredId($p,'assembly_catalog_item_id');$cid=$this->requiredId($p,'part_catalog_item_id');$a=catalog_ra_assert_expected($this->pdo,'catalog_items',$aid,$p);$c=$this->tableRow('catalog_items',$cid);$this->assertUnlocked((int)$a['catalog_id']);if((int)$a['catalog_id']!==(int)$c['catalog_id'])throw new CatalogAdminException('ITEM_CATALOG_MISMATCH','Assembly component must belong to the same catalog.');$this->assertNoAssemblyCycle($aid,$cid);$values=$this->componentValues($p);$values+=['assembly_catalog_item_id'=>$aid,'part_catalog_item_id'=>$cid,'unit_cost_snapshot'=>(float)$c['unit_cost'],'unit_labor_time_snapshot'=>(float)$c['labor_hours']];$id=$this->insert('assembly_parts',$values);catalog_ra_created($this->pdo,'assembly_parts','assembly_component',$id,'assembly_component.created',$p,(int)$a['catalog_id']);$parent=$this->recalculateAssembly($aid,$p,'assembly.component_added');return ['id'=>$id,'entity'=>catalog_ra_row($this->pdo,'assembly_parts',$id),'assembly'=>$parent];});}
    public function updateAssemblyComponent(array $p): array {return $this->transaction(function()use($p){$id=$this->requiredId($p);$part=$this->tableRow('assembly_parts',$id);$aid=(int)$part['assembly_catalog_item_id'];$a=catalog_ra_assert_expected($this->pdo,'catalog_items',$aid,$p);$this->assertUnlocked((int)$a['catalog_id']);$componentInput=$p;unset($componentInput['expected_revision']);$entity=catalog_ra_update($this->pdo,'assembly_parts','assembly_component',$id,$this->componentValues($p,$part),'assembly_component.updated',$componentInput,(int)$a['catalog_id']);$parent=$this->recalculateAssembly($aid,$p,'assembly.component_updated');return ['id'=>$id,'entity'=>$entity,'assembly'=>$parent];});}
    public function removeAssemblyComponent(array $p): array {return $this->transaction(function()use($p){$id=$this->requiredId($p);$part=$this->tableRow('assembly_parts',$id);$aid=(int)$part['assembly_catalog_item_id'];$a=catalog_ra_assert_expected($this->pdo,'catalog_items',$aid,$p);$this->assertUnlocked((int)$a['catalog_id']);$componentInput=$p;unset($componentInput['expected_revision']);$entity=catalog_ra_update($this->pdo,'assembly_parts','assembly_component',$id,['deleted_at'=>date('Y-m-d H:i:s')],'assembly_component.archived',$componentInput,(int)$a['catalog_id']);$parent=$this->recalculateAssembly($aid,$p,'assembly.component_removed');return ['id'=>$id,'entity'=>$entity,'assembly'=>$parent];});}
    public function reorderAssemblyComponents(array $p):array{return $this->transaction(function()use($p){$aid=$this->requiredId($p,'assembly_catalog_item_id');$a=catalog_ra_assert_expected($this->pdo,'catalog_items',$aid,$p);$this->assertUnlocked((int)$a['catalog_id']);$ids=array_values(array_unique(array_map('intval',is_array($p['ordered_ids']??null)?$p['ordered_ids']:[])));$stmt=$this->pdo->prepare('SELECT id FROM assembly_parts WHERE assembly_catalog_item_id=? AND deleted_at IS NULL ORDER BY sort_order,id');$stmt->execute([$aid]);$actual=array_map('intval',$stmt->fetchAll(PDO::FETCH_COLUMN));$sorted=$ids;$a1=$actual;$a2=$ids;sort($a1);sort($a2);if($a1!==$a2)throw new CatalogAdminException('VALIDATION_ERROR','Reorder must contain every active component exactly once.');$update=$this->pdo->prepare('UPDATE assembly_parts SET sort_order=? WHERE id=? AND assembly_catalog_item_id=?');foreach($sorted as$order=>$id)$update->execute([$order,$id,$aid]);$parent=catalog_ra_update($this->pdo,'catalog_items','item',$aid,[],'assembly.components_reordered',$p,(int)$a['catalog_id'],true);return['id'=>$aid,'assembly'=>$parent,'ordered_ids'=>$sorted];});}
}
