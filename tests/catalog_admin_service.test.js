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
