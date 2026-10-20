const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const php = fs.readFileSync(path.join(root, 'core/services/CatalogAdminService.php'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/catalog_admin.php'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'api/cost_catalog.php'), 'utf8');
const js = fs.readFileSync(path.join(root, 'assets/catalog_admin_service.js'), 'utf8');

test('CatalogAdminService exposes every phase 3 command through one transaction boundary', () => {
    for (const command of ['catalog.create','catalog.update','catalog.toggle','catalog.archive','catalog.restore',
        'category.create','category.update','category.toggle','category.archive','category.restore',
        'item.create','item.update','item.archive','item.restore','item.move','item.duplicate',
        'assembly_component.add','assembly_component.update','assembly_component.remove']) assert.match(php, new RegExp(command.replace('.', '\\.')));
    assert.match(php, /return \$this->transaction\(fn\(\) => \$this->\{\$map\[\$command\]\}/);
    assert.match(php, /CATALOG_LOCKED/);
    assert.match(php, /CATEGORY_CATALOG_MISMATCH/);
    assert.match(php, /ASSEMBLY_SELF_REFERENCE/);
    assert.match(php, /array_key_exists\('active', \$p\)[\s\S]*:\s*1/, 'new items remain active when legacy callers omit active');
});
test('new API normalizes command success, validation and revision conflict responses', () => {
    assert.match(api, /new CatalogAdminService\(\$pdo\)/);
    assert.match(api, /REVISION_CONFLICT/);
    assert.match(api, /CatalogAdminException/);
    assert.match(api, /CATALOG_ADMIN_ERROR/);
    assert.doesNotMatch(api, /\$e->getMessage\(\).*500/);
});

test('legacy mutation actions delegate to the domain service without changing action names', () => {
    for (const action of ['save_catalog','copy_catalog','delete_catalog','toggle_catalog','save_group','copy_group',
        'delete_group','toggle_group','save_item','duplicate_item','delete_item','move_item','convert_item_assembly',
        'add_assembly_part','delete_assembly_part']) assert.match(legacy, new RegExp(`['\"]${action}['\"]`));
    assert.match(legacy, /\(new CatalogAdminService\(\$pdo\)\)->execute\(\$legacyCommands\[\$action\]/);
});

test('browser admin client is separate from read-only CatalogService and preserves structured errors', async () => {
    const Admin = require(path.join(root, 'assets/catalog_admin_service.js'));
    assert.equal(typeof Admin.updateItem, 'function');
    let sent;
    const result = await Admin.updateItem({ id: 3 }, { expectedRevision: 4, requestId: 'r1', fetchImpl: async (_url, init) => {
        sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 3 } }) };
    }});
    assert.equal(sent.command, 'item.update'); assert.equal(sent.expectedRevision, 4); assert.equal(result.id, 3);
    assert.doesNotMatch(js, /CatalogService\s*=/);
});

test('purge methods safely delete legacy assembly_items dependencies before parent deletions inside transaction', () => {
    // purgeItem cleans up assembly_items references
    assert.match(php, /DELETE FROM assembly_items WHERE assembly_id=\? OR catalog_item_id=\?/);
    const purgeItemPos = php.indexOf('function purgeItem');
    const deleteAssemblyItemsPos = php.indexOf('DELETE FROM assembly_items WHERE assembly_id=?', purgeItemPos);
    const deleteCatalogItemsPos = php.indexOf('DELETE FROM catalog_items WHERE id=?', purgeItemPos);
    assert.ok(deleteAssemblyItemsPos > 0 && deleteAssemblyItemsPos < deleteCatalogItemsPos, 'purgeItem cleans assembly_items before catalog_items');

    // purgeCatalog cleans up assembly_items references
    const purgeCatalogPos = php.indexOf('function purgeCatalog');
    const catDeleteAssemblyItemsPos = php.indexOf('DELETE ai FROM assembly_items ai JOIN catalog_items ci ON ci.id=ai.assembly_id WHERE ci.catalog_id=?', purgeCatalogPos);
    const catDeleteCatalogItemsPos = php.indexOf('DELETE FROM catalog_items WHERE catalog_id=?', purgeCatalogPos);
    assert.ok(catDeleteAssemblyItemsPos > 0 && catDeleteAssemblyItemsPos < catDeleteCatalogItemsPos, 'purgeCatalog cleans assembly_items before catalog_items');

    // purgeCategory cleans up assembly_items references
    const purgeCategoryPos = php.indexOf('function purgeCategory');
    const grpDeleteAssemblyItemsPos = php.indexOf('DELETE ai FROM assembly_items ai JOIN catalog_items ci ON ci.id=ai.assembly_id WHERE ci.catalog_group_id IN', purgeCategoryPos);
    const grpDeleteCatalogItemsPos = php.indexOf('DELETE FROM catalog_items WHERE catalog_group_id IN', purgeCategoryPos);
    assert.ok(grpDeleteAssemblyItemsPos > 0 && grpDeleteAssemblyItemsPos < grpDeleteCatalogItemsPos, 'purgeCategory cleans assembly_items before catalog_items');
});

test('CatalogAdminService handles schemas without sort_order safely across catalogs and groups', () => {
    // Assert createCatalog filters values with catalog_ra_columns
    assert.match(php, /public\s+function\s+createCatalog[\s\S]*?catalog_ra_columns\(\$this->pdo,\s*['"]catalogs['"]\)/);
    // Assert createCategory filters values with catalog_ra_columns
    assert.match(php, /public\s+function\s+createCategory[\s\S]*?catalog_ra_columns\(\$this->pdo,\s*['"]catalog_groups['"]\)/);
    // Assert updateCatalog and updateCategory filter values
    assert.match(php, /public\s+function\s+updateCatalog[\s\S]*?array_intersect_key/);
    assert.match(php, /public\s+function\s+updateCategory[\s\S]*?array_intersect_key/);
    // Assert reorder queries fall back to id when sort_order is absent
    assert.match(php, /reorderCatalogs[\s\S]*?ORDER BY id/);
    assert.match(php, /reorderCategories[\s\S]*?ORDER BY id/);
    // Assert capability-safe return structure
    assert.match(php, /reorderCatalogs[\s\S]*?'supported'\s*=>/);
    assert.match(php, /reorderCategories[\s\S]*?'supported'\s*=>/);
});
