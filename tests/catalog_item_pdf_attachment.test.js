const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const api=fs.readFileSync(path.join(root,'api/catalog_item_attachment.php'),'utf8');
const migration=fs.readFileSync(path.join(root,'db/migrations/2026-08-28_catalog_item_pdf_attachments.sql'),'utf8');
const service=fs.readFileSync(path.join(root,'core/services/CatalogAdminService.php'),'utf8');
const page=fs.readFileSync(path.join(root,'pages/cost_catalog.php'),'utf8');
const js=fs.readFileSync(path.join(root,'assets/cost_catalog.js'),'utf8');

test('managed attachment schema is additive and enforces one PDF per item',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS catalog_item_attachments/);
  assert.match(migration,/PRIMARY KEY \(catalog_item_id\)/);assert.match(migration,/ON DELETE CASCADE/);
  assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM catalog_items/i);
});
test('upload validates real PDF, caps size, and uses an untrusted-name-independent path',()=>{
  assert.match(api,/CATALOG_PDF_MAX_BYTES = 10485760/);assert.match(api,/finfo\(FILEINFO_MIME_TYPE\)/);
  assert.match(api,/application\/pdf/);assert.match(api,/\$magic!==['"]%PDF-['"]/);
  assert.match(api,/bin2hex\(random_bytes\(24\)\).*\.pdf/);assert.match(api,/is_uploaded_file/);assert.match(api,/move_uploaded_file/);
  assert.doesNotMatch(api,/\$_POST\[['"]url|filter_var\(.+FILTER_VALIDATE_URL/);
});
test('view endpoint checks active item and confines storage before inline response',()=>{
  assert.match(api,/i\.active=1 AND i\.deleted_at IS NULL/);assert.match(api,/\^\[a-f0-9\]\{48\}\\\.pdf/);
  assert.match(api,/strpos\(\$real,\$realRoot\.DIRECTORY_SEPARATOR\)!==0/);assert.match(api,/Content-Disposition: inline/);
  assert.match(api,/X-Content-Type-Options: nosniff/);assert.match(api,/Content-Security-Policy: sandbox/);
});
test('attachment mutation bumps item revision and audits through admin service',()=>{
  assert.match(service,/function replaceItemPdf/);assert.match(service,/item\.pdf_replaced/);
  assert.match(service,/function removeItemPdf/);assert.match(service,/item\.pdf_removed/);
  assert.match(service,/catalog_ra_update\([^;]+true\)/s);
});
test('unified item modal exposes accessible upload, view, replace and remove states',()=>{
  assert.match(page,/id="ccItemPdf"[^>]+accept="application\/pdf,\.pdf"/);assert.match(page,/id="ccItemPdfView"/);
  assert.match(page,/id="ccItemPdfRemove"/);assert.match(page,/role="status" aria-live="polite"/);
  assert.match(js,/attachmentRequest\('upload'/);assert.match(js,/attachmentRequest\('remove'/);assert.match(js,/safeLegacyUrl/);
});
