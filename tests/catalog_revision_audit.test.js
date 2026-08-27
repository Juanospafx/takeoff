const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'db/migrations/2026-08-27_catalog_revision_audit.sql'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'core/services/catalog_revision_audit.php'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/cost_catalog.php'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'core/services/CatalogAdminService.php'), 'utf8');
const catalogService = fs.readFileSync(path.join(root, 'assets/catalog_service.js'), 'utf8');
const contract = fs.readFileSync(path.join(root, 'assets/catalog_item_contract.js'), 'utf8');

test('catalog revision migration is additive and idempotent for every mutable entity', () => {
    for (const table of ['catalogs', 'cost_catalogs', 'catalog_groups', 'catalog_items', 'assembly_parts']) {
        assert.match(migration, new RegExp(`catalog_add_column_if_missing\\('${table}', 'revision', 'BIGINT UNSIGNED`));
    }
    assert.match(migration, /CREATE TABLE IF NOT EXISTS catalog_audit_events/);
    assert.match(migration, /UNIQUE KEY uq_catalog_audit_request_entity/);
    assert.match(migration, /catalog_add_index_if_missing/);
});

test('revision helper is capability-aware, rejects stale optional revisions and skips no-ops', () => {
    assert.match(helper, /information_schema\.tables[\s\S]*catalog_audit_events/);
    assert.match(helper, /array_key_exists\('expected_revision'/);
    assert.match(helper, /throw new CatalogRevisionConflict/);
    assert.match(helper, /if \(\$changed\)[\s\S]*`revision`=`revision`\+1/);
    assert.match(helper, /if \(\$changed\) catalog_ra_audit/);
    assert.doesNotMatch(api, /cc_add_column\([^\n]*'revision'/);
});

test('all current catalog mutation families use revision audit helpers', () => {
    for (const action of [
        'catalog.created', 'cost_catalog.created', 'catalog.updated', 'catalog.copied', 'catalog.archived', 'catalog.toggled',
        'category.created', 'category.updated', 'category.moved', 'category.copied', 'category.archived', 'category.toggled',
        'item.created', 'item.updated', 'item.copied', 'item.archived', 'item.moved',
        'assembly_component.created', 'assembly_component.archived',
        'assembly.component_added', 'assembly.component_removed'
    ]) assert.match(api + admin, new RegExp(action.replace('.', '\\.')));
    assert.match(api, /catch \(CatalogRevisionConflict \$e\)[\s\S]*revision_conflict[\s\S]*409/);
});

test('assembly component commands lock the parent and bump it once through recalculation', () => {
    assert.match(admin, /catalog_ra_assert_expected\(\$this->pdo,'catalog_items',\$aid,\$p\)/);
    assert.match(admin, /recalculateAssembly\(\$aid,\$p,'assembly\.component_added'\)/);
    assert.match(admin, /recalculateAssembly\(\$aid,\$p,'assembly\.component_removed'\)/);
    assert.match(admin, /return \$this->transaction\(function\(\)use\(\$p\)/);
});

test('DTOs prefer explicit revision while preserving legacy timestamp fallback', () => {
    assert.match(catalogService, /revision: row\.revision \?\? row\.updated_at \?\? row\.updatedAt \?\? null/);
    assert.match(contract, /\['revision', 'updated_at', 'updatedAt'\]/);
});
