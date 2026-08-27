const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pages/cost_catalog.php'), 'utf8');
const js = fs.readFileSync(path.join(root, 'assets/cost_catalog.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'core/services/CatalogAdminService.php'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db/migrations/2026-08-27_catalog_item_classifications.sql'), 'utf8');

test('phase 6 unified modal exposes essential and catalog details for four visible types', () => {
    assert.match(page, /Essential Details/); assert.match(page, /Catalog Details/);
    ['part','equipment','labor','assembly'].forEach(type => assert.match(page, new RegExp(`value="${type}"`)));
    ['ccItemMasterFormat','ccItemUniFormat','ccItemName','ccItemDescription','ccItemUom'].forEach(id => assert.match(page, new RegExp(`id="${id}"`)));
    assert.match(page, /id="ccItemAttachmentUrl" type="hidden"/);
});

test('assembly price inputs are calculated read-only and classifications persist additively', () => {
    assert.match(js, /ccItemUnitCost'\)\.readOnly = isAssemblyType/);
    assert.match(js, /ccItemLaborHours'\)\.readOnly = isAssemblyType/);
    assert.match(admin, /'masterformat'/); assert.match(admin, /'uniformat'/);
    assert.match(migration, /ADD COLUMN masterformat/); assert.match(migration, /ADD COLUMN uniformat/);
    assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/);
});
