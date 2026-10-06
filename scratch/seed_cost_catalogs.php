<?php
require_once __DIR__ . '/../core/db/connection.php';

$count = (int)$pdo->query("SELECT COUNT(*) FROM catalogs")->fetchColumn();
if ($count > 0) {
    echo "Catalogs already populated ($count catalogs found)." . PHP_EOL;
    exit;
}

$now = date('Y-m-d H:i:s');
$catalogsData = [
    [
        'name' => '2025 COST CATALOG BRIGHTRONIX',
        'trade' => 'Electrical',
        'description' => 'Master comprehensive 2025 cost catalog for Brightronix electrical and low-voltage systems.',
        'groups' => [
            ['name' => 'RMC', 'items' => [
                ['name' => '1-1/2" rigid steel couplings', 'description' => '1-1/2" rigid steel couplings', 'unit_of_measure' => 'ea', 'unit_cost' => 0.08, 'labor_hours' => 0.1, 'catalog_number' => 'STEEL_RMC', 'item_type' => 'material']
            ]],
            ['name' => 'Demolition & Relocate', 'items' => [
                ['name' => 'DEMO - Meter center 200A to 400A', 'description' => 'Gear Demolition', 'unit_of_measure' => 'ea', 'unit_cost' => 0.00, 'labor_hours' => 3.0, 'catalog_number' => 'DEMO-MC', 'item_type' => 'labor']
            ]],
            ['name' => '2. Extras', 'items' => [
                ['name' => '8 hours Labor for Relocation', 'description' => 'Dedicated labor crew relocation', 'unit_of_measure' => 'ea', 'unit_cost' => 0.00, 'labor_hours' => 8.0, 'catalog_number' => 'LAB-8HR', 'item_type' => 'labor'],
                ['name' => 'Labor For Counter Mounted', 'description' => 'Labor for counter mounted components', 'unit_of_measure' => 'ea', 'unit_cost' => 0.00, 'labor_hours' => 1.0, 'catalog_number' => 'LAB-CTR', 'item_type' => 'labor']
            ]],
            ['name' => 'Fire Alarm', 'items' => [
                ['name' => 'Control Panel Kit', 'description' => 'Includes Control Panel, 24V Transformer, Surge Protection Device, Batteries, CAT 6 Plenum Cabling, termination, installation, and labeling', 'unit_of_measure' => 'ea', 'unit_cost' => 0.00, 'labor_hours' => 9.21, 'catalog_number' => 'FA-KIT', 'item_type' => 'assembly'],
                ['name' => 'Surge Protection', 'description' => 'Surge Protection Device Mounted In Enclosure', 'unit_of_measure' => 'ea', 'unit_cost' => 0.00, 'labor_hours' => 0.5, 'catalog_number' => 'SPD-FA', 'item_type' => 'material'],
                ['name' => 'Cellular Communicator', 'description' => 'Cellular Communicator for Fire Alarm Monitoring', 'unit_of_measure' => 'ea', 'unit_cost' => 120.00, 'labor_hours' => 1.5, 'catalog_number' => 'CELL-FA', 'item_type' => 'material']
            ]]
        ]
    ],
    [
        'name' => 'Commercial Electrical',
        'trade' => 'Commercial Electrical',
        'description' => 'Standard commercial electrical systems, distribution, branch and lighting.',
        'groups' => [
            ['name' => 'Lighting', 'items' => [
                ['name' => '2x4 LED Troffer Fixture', 'description' => '40W 5000K Commercial Recessed LED Troffer', 'unit_of_measure' => 'ea', 'unit_cost' => 48.50, 'labor_hours' => 0.75, 'catalog_number' => 'LT-2X4', 'item_type' => 'material'],
                ['name' => '2x2 LED Flat Panel', 'description' => '30W 4000K Commercial LED Panel', 'unit_of_measure' => 'ea', 'unit_cost' => 38.00, 'labor_hours' => 0.60, 'catalog_number' => 'LT-2X2', 'item_type' => 'material'],
                ['name' => 'Emergency Exit LED Sign Combo', 'description' => 'LED Exit Sign with Emergency Backup Battery and Heads', 'unit_of_measure' => 'ea', 'unit_cost' => 32.50, 'labor_hours' => 0.50, 'catalog_number' => 'LT-EXIT', 'item_type' => 'material']
            ]],
            ['name' => 'Branch Conduit & Wire', 'items' => [
                ['name' => '1/2" EMT Conduit', 'description' => 'Thin-wall Electrical Metallic Tubing', 'unit_of_measure' => 'ft', 'unit_cost' => 0.85, 'labor_hours' => 0.05, 'catalog_number' => 'EMT-050', 'item_type' => 'material'],
                ['name' => '3/4" EMT Conduit', 'description' => 'Thin-wall Electrical Metallic Tubing', 'unit_of_measure' => 'ft', 'unit_cost' => 1.25, 'labor_hours' => 0.06, 'catalog_number' => 'EMT-075', 'item_type' => 'material'],
                ['name' => '#12 THHN Copper Wire Solid', 'description' => '600V Commercial Building Wire', 'unit_of_measure' => 'ft', 'unit_cost' => 0.22, 'labor_hours' => 0.01, 'catalog_number' => 'THHN-12', 'item_type' => 'material']
            ]],
            ['name' => 'Devices & Plates', 'items' => [
                ['name' => 'Duplex Receptacle 20A Commercial', 'description' => 'Specification Grade 125V NEMA 5-20R', 'unit_of_measure' => 'ea', 'unit_cost' => 3.95, 'labor_hours' => 0.25, 'catalog_number' => 'REC-20A', 'item_type' => 'material'],
                ['name' => 'Single Pole Switch 20A Commercial', 'description' => '120/277V Spec Grade Quiet Switch', 'unit_of_measure' => 'ea', 'unit_cost' => 4.20, 'labor_hours' => 0.25, 'catalog_number' => 'SW-1P', 'item_type' => 'material']
            ]]
        ]
    ],
    [
        'name' => 'Commercial Electrical copy',
        'trade' => 'Commercial Electrical',
        'description' => 'Gear and panelboards distribution items copy.',
        'groups' => [
            ['name' => 'Gear and Panelboards', 'items' => [
                ['name' => '"SPD" Surge Protector Device', 'description' => 'Surge Protection Device Mounted In Enclosure', 'unit_of_measure' => 'ea', 'unit_cost' => 0.00, 'labor_hours' => 1.0, 'catalog_number' => 'SPD-GEAR', 'item_type' => 'material'],
                ['name' => '225A Main Breaker Panelboard 42 CKT', 'description' => '120/208V 3PH 4W Surface Mount NEMA 1', 'unit_of_measure' => 'ea', 'unit_cost' => 1250.00, 'labor_hours' => 8.0, 'catalog_number' => 'PNL-225', 'item_type' => 'material']
            ]]
        ]
    ],
    [
        'name' => 'Low Voltage',
        'trade' => 'Low Voltage',
        'description' => 'Structured cabling, data networking, fire alarm, and security.',
        'groups' => [
            ['name' => 'Structured Cabling', 'items' => [
                ['name' => 'Cat6 UTP Plenum Cable', 'description' => '4-Pair 23AWG Solid Bare Copper CMP Blue', 'unit_of_measure' => 'ft', 'unit_cost' => 0.38, 'labor_hours' => 0.02, 'catalog_number' => 'C6-CMP', 'item_type' => 'material'],
                ['name' => 'Cat6 RJ45 Keystone Jack', 'description' => 'Component Compliant 110 Punchdown Jack', 'unit_of_measure' => 'ea', 'unit_cost' => 2.85, 'labor_hours' => 0.15, 'catalog_number' => 'C6-JACK', 'item_type' => 'material']
            ]],
            ['name' => 'Fire Alarm', 'items' => [
                ['name' => 'Smoke Detector Photoelectric', 'description' => 'Intelligent Addressable Photoelectric Smoke Sensor', 'unit_of_measure' => 'ea', 'unit_cost' => 65.00, 'labor_hours' => 0.50, 'catalog_number' => 'FA-SMK', 'item_type' => 'material'],
                ['name' => 'Fire Alarm Horn Strobe', 'description' => 'Multi-Candela Wall Mount Horn Strobe Red', 'unit_of_measure' => 'ea', 'unit_cost' => 54.00, 'labor_hours' => 0.60, 'catalog_number' => 'FA-HS', 'item_type' => 'material']
            ]]
        ]
    ],
    [
        'name' => 'Residential Electrical',
        'trade' => 'Residential Electrical',
        'description' => 'Residential electrical installations and fixtures.',
        'groups' => [
            ['name' => 'Rough-In', 'items' => [
                ['name' => 'Romex NM-B 12/2 Wire 250ft', 'description' => 'Non-metallic sheathed cable with ground', 'unit_of_measure' => 'ft', 'unit_cost' => 0.45, 'labor_hours' => 0.015, 'catalog_number' => 'NMB-12-2', 'item_type' => 'material'],
                ['name' => 'Single Gang Plastic Nail-On Box', 'description' => '20.3 cu in PVC electrical box', 'unit_of_measure' => 'ea', 'unit_cost' => 0.65, 'labor_hours' => 0.10, 'catalog_number' => 'BOX-1G-PVC', 'item_type' => 'material']
            ]]
        ]
    ]
];

$stmtCat = $pdo->prepare("INSERT INTO catalogs (name, description, trade, active, locked, enabled_for_projects, sort_order, revision, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 1, ?, 1, ?, ?)");
$stmtGrp = $pdo->prepare("INSERT INTO catalog_groups (catalog_id, name, description, sort_order, active, enabled_for_projects, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?)");
$stmtItem = $pdo->prepare("INSERT INTO catalog_items (catalog_id, catalog_group_id, name, description, item_type, unit_of_measure, unit_cost, labor_hours, catalog_number, active, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)");

$catIdx = 0;
foreach ($catalogsData as $cat) {
    $catIdx++;
    $stmtCat->execute([$cat['name'], $cat['description'], $cat['trade'], $catIdx, $now, $now]);
    $catId = (int)$pdo->lastInsertId();
    $grpIdx = 0;
    foreach ($cat['groups'] as $grp) {
        $grpIdx++;
        $stmtGrp->execute([$catId, $grp['name'], '', $grpIdx, $now, $now]);
        $grpId = (int)$pdo->lastInsertId();
        foreach ($grp['items'] as $item) {
            $stmtItem->execute([
                $catId,
                $grpId,
                $item['name'],
                $item['description'],
                $item['item_type'],
                $item['unit_of_measure'],
                $item['unit_cost'],
                $item['labor_hours'],
                $item['catalog_number'],
                $now,
                $now
            ]);
        }
    }
}

echo "Successfully seeded " . count($catalogsData) . " catalogs with groups and items." . PHP_EOL;
