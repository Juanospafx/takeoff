const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const page = read('pages/cost_catalog.php');
const client = read('assets/cost_catalog.js');
const api = read('api/cost_catalog.php');
const admin = read('core/services/CatalogAdminService.php');
const migration = read('db/migrations/2026-09-02_cost_catalog_completion.sql');
const Contract = require('../assets/catalog_item_contract.js');

test('completion schema is migration-owned and supports explicit takeoff metadata', () => {
  assert.match(migration, /measurement_type/);
  assert.match(migration, /marker_size/);
  assert.match(migration, /notes/);
  assert.doesNotMatch(api, /cc_ensure_schema\s*\(/);
  assert.doesNotMatch(api, /CREATE TABLE IF NOT EXISTS/);
  assert.doesNotMatch(api, /ALTER TABLE/);
});

test('canonical DTO preserves completion fields and material remains a Part alias', () => {
  const dto = Contract.normalizeCatalogItem({item_type:'material',measurement_type:'linear',marker_size:'8',size:'1/2',diameter:'0.5',trade_size:'1/2',thickness:'2',gauge:'12',material:'Copper',notes:'Field note'});
  assert.equal(dto.type, 'PART');
  assert.equal(dto.takeoffDefaults.measurementType, 'linear');
  assert.equal(dto.takeoffDefaults.markerSize, 8);
  assert.deepEqual(dto.physical, {size:'1/2',diameter:'0.5',tradeSize:'1/2',thickness:'2',gauge:'12',material:'Copper'});
  assert.equal(dto.notes, 'Field note');
});

test('backend validates numbers, types, measurements, siblings and assembly duplicates', () => {
  assert.match(admin, /INVALID_ITEM_TYPE/);
  assert.match(admin, /INVALID_MEASUREMENT_TYPE/);
  assert.match(admin, /must be a valid number/);
  assert.match(admin, /DUPLICATE_CATEGORY/);
  assert.match(admin, /assembly_component\.quantity_merged/);
  assert.match(admin, /assembly_component\.copied/);
});

test('catalog UI has complete fields, archive restore, filters and no fake actions', () => {
  ['ccItemMeasurementType','ccItemMarkup','ccItemWaste','ccItemSize','ccItemDiameter','ccItemTradeSize','ccItemThickness','ccItemGauge','ccItemMaterial','ccItemNotes','ccMeasurementFilter','ccStatusFilter','ccUomFilter','ccClearFilters'].forEach(id => assert.match(page, new RegExp(`id="${id}"`)));
  assert.doesNotMatch(page, /value="cable"/);
  assert.doesNotMatch(client, /Move catalog is reserved|coming soon|Usage history will|ready for takeoff layer/i);
  assert.match(client, /normalize\('NFD'\)/);
  assert.match(client, /expected_revision/);
  assert.match(client, /data-tree-toggle-group/);
  assert.match(client, /restore_item/);
});

test('category archive is transactional and moves items before archiving the tree', () => {
  assert.match(admin, /function archiveCategory[\s\S]*UPDATE catalog_items SET catalog_group_id/);
  assert.match(admin, /CATEGORY_HAS_CHILDREN/);
  assert.match(client, /ccArchiveCategoryImpact/);
  assert.match(client, /archive_tree/);
});
