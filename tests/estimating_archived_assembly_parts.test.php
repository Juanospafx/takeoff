<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/services/ProjectEstimateExcelService.php';

if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "pdo_sqlite is required\n");
    exit(2);
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE catalog_items (
    id INTEGER PRIMARY KEY, catalog_id INTEGER, catalog_group_id INTEGER,
    name TEXT, description TEXT, item_type TEXT, unit_of_measure TEXT,
    unit_cost REAL, labor_hours REAL, catalog_number TEXT, cost_type TEXT,
    budget_code TEXT, material_cost REAL, labor_cost REAL, equipment_cost REAL,
    subcontractor_cost REAL, revision INTEGER, enabled_for_projects INTEGER,
    deleted_at TEXT NULL
)');
$pdo->exec('CREATE TABLE assembly_parts (
    id INTEGER PRIMARY KEY, assembly_catalog_item_id INTEGER,
    part_catalog_item_id INTEGER, quantity REAL, ratio_type TEXT,
    waste_factor_percent REAL, sort_order INTEGER, deleted_at TEXT NULL
)');
$pdo->exec("INSERT INTO catalog_items VALUES
    (1,1,1,'Assembly','', 'assembly','ea',53000,0,'A-1','material','',53000,0,0,0,1,1,NULL),
    (2,1,1,'Component','', 'part','ea',53000,0,'P-1','material','',53000,0,0,0,1,1,NULL)");
$pdo->exec("INSERT INTO assembly_parts VALUES
    (10,1,2,1,'per_unit',0,0,NULL),
    (11,1,2,1,'per_unit',0,1,'2026-11-01 00:00:00')");

$index = ProjectEstimateExcelService::loadCatalogIndex($pdo);
$parts = $index['partsByAssembly'][1] ?? [];
$dto = ProjectEstimateExcelService::buildCatalogDto($index['byId'][1], $index);

if (count($parts) !== 1 || count($dto['assemblyComponents'] ?? []) !== 1) {
    throw new RuntimeException('Archived assembly components must not be hydrated into Estimating.');
}

$component = $dto['assemblyComponents'][0];
$total = (float)$component['quantity'] * (float)$component['unitMaterialCost'];
if (abs($total - 53000.0) > 0.001) {
    throw new RuntimeException("Expected 53000 after hydration, got {$total}.");
}

echo "archived assembly parts regression passed\n";
