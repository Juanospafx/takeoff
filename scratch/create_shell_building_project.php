<?php
require_once __DIR__ . '/../core/db/connection.php';

$pdo->beginTransaction();

try {
    // 1. Create or update template in project_templates
    $stmt = $pdo->prepare("SELECT id FROM project_templates WHERE name = ? AND deleted_at IS NULL LIMIT 1");
    $stmt->execute(['Shell Building Template']);
    $templateId = $stmt->fetchColumn();

    if (!$templateId) {
        $stmt = $pdo->prepare("INSERT INTO project_templates (name, description, trade, settings_json, active) VALUES (?, ?, ?, ?, 1)");
        $stmt->execute([
            'Shell Building Template',
            'Standard template for Shell Building electrical estimating with standard divisions',
            'Electrical',
            json_encode(['default_status' => 'to_do', 'trade' => 'Electrical'])
        ]);
        $templateId = (int)$pdo->lastInsertId();
    }

    // 2. Determine project number
    $projectNum = 'PRJ-SHELL-001';
    $chk = $pdo->prepare("SELECT id FROM projects WHERE project_number = ? LIMIT 1");
    $chk->execute([$projectNum]);
    if ($chk->fetchColumn()) {
        $projectNum = 'PRJ-SHELL-' . date('Ymd-His');
    }

    // 3. Insert project
    $projStmt = $pdo->prepare("
        INSERT INTO projects (
            project_template_id, project_number, name, description, status,
            client_name, job_address, city, state, postal_code, country,
            bid_due_at, metadata_json, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, 'to_do',
            'Commercial Shell Client', '100 Industrial Parkway', 'Orlando', 'FL', '32801', 'US',
            DATE_ADD(NOW(), INTERVAL 14 DAY), ?, NOW(), NOW()
        )
    ");
    $metaJson = json_encode([
        'estimator' => 'Juan Estevez',
        'measurement_system' => 'US',
        'estimate_pricing' => 'Unlocked',
        'is_template' => true,
        'template_type' => 'shell_building'
    ]);
    $projStmt->execute([
        $templateId,
        $projectNum,
        'Shell Building Template',
        'Template project for a commercial shell building with complete electrical scope groups: Lighting, Controls, Gear, Rough In, Overhead Lighting, Overhead Power, Underground, Feeders, Secundary, Primary, Fire Alarm, Rental.',
        $metaJson
    ]);
    $projectId = (int)$pdo->lastInsertId();

    // 4. Group definitions & Catalog item mappings
    $groupDefinitions = [
        [
            'name' => 'Lighting',
            'item_ids' => [7400, 7258, 7367, 7268, 7266, 7274, 7401, 7264] // Fixtures A, B, C, D, E, F, EM, X
        ],
        [
            'name' => 'Controls',
            'item_ids' => [8605, 8606, 8613, 8612, 8600, 8614, 8591, 8596] // OS, SOS, Dimmer, Power Pack, Daylight Sensor, SLV
        ],
        [
            'name' => 'Gear',
            'item_ids' => [7010, 7093, 7090, 7104, 7867, 8052, 7096, 6920, 7024, 7017, 7021, 7091, 8592, 7056, 7043, 7044]
            // Transformer pads, 600A/800A disconnects, CT metering, 200A meters, Panel M/L with breakers, photocell, time clock, contactors
        ],
        [
            'name' => 'Rough In',
            'item_ids' => [7679, 7674, 7737, 7636, 7634, 7589, 7642, 7641, 7558, 7560, 7578, 7557, 7753, 7761, 7744, 7763]
            // J-boxes (4" square, deep, shallow, octagon, pullbox), single pole switches, receptacles (GFCI, duplex, commercial, USB), disconnects (30A & 60A)
        ],
        [
            'name' => 'Overhead Lighting',
            'item_ids' => [8849, 8850, 8851, 8857, 8858, 8859, 8840]
            // 1/2" & 3/4" EMT assemblies with 2, 3, 4 #12 THHN wires & pullstring
        ],
        [
            'name' => 'Overhead Power',
            'item_ids' => [8855, 8856, 8865, 8866, 8867, 8858, 8859]
            // 1/2" & 3/4" EMT assemblies with #10 & #12 THHN wires
        ],
        [
            'name' => 'Underground',
            'item_ids' => [8892, 8893, 8895, 8898, 8900, 8929, 8932, 8937]
            // 3/4", 1", 2", 3", 4" Sch 40 & Sch 80 PVC conduits with coupling & pullstring
        ],
        [
            'name' => 'Feeders',
            'item_ids' => [8988, 8996, 9000, 9004, 9022]
            // 100A, 200A, 225A, 250A, 400A PVC CU feeders
        ],
        [
            'name' => 'Secundary',
            'item_ids' => [8988, 8996, 8895, 8898]
            // Secondary feeders and secondary PVC conduits
        ],
        [
            'name' => 'Primary',
            'item_ids' => [7647, 8900, 8937, 8224]
            // Inground primary J-box, 4" PVC conduit Sch 40/80, 500kVA pad mounted oil-filled transformer
        ],
        [
            'name' => 'Fire Alarm',
            'item_ids' => [] // Empty for now as requested
        ],
        [
            'name' => 'Rental',
            'item_ids' => [8577] // Equipment Rental
        ]
    ];

    // Fetch all catalog items needed
    $allCatalogIds = [];
    foreach ($groupDefinitions as $gd) {
        $allCatalogIds = array_merge($allCatalogIds, $gd['item_ids']);
    }
    $allCatalogIds = array_unique(array_filter($allCatalogIds));

    $catalogMap = [];
    if (!empty($allCatalogIds)) {
        $in = implode(',', $allCatalogIds);
        $cStmt = $pdo->query("SELECT * FROM catalog_items WHERE id IN ($in)");
        while ($row = $cStmt->fetch(PDO::FETCH_ASSOC)) {
            $catalogMap[$row['id']] = $row;
        }
    }

    // 5. Create estimate in estimates table
    $estStmt = $pdo->prepare("
        INSERT INTO estimates (
            project_id, estimate_number, name, description, status,
            currency_code, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, 'draft', 'USD', NOW(), NOW()
        )
    ");
    $estStmt->execute([
        $projectId,
        $projectNum . '-EST1',
        'Primary Shell Estimate',
        'Primary baseline estimate for Shell Building template.'
    ]);
    $estimateDbId = (int)$pdo->lastInsertId();

    // 6. Build workspace groups & items
    $workspaceGroups = [];
    $totalEstimateItemsInserted = 0;
    $itemInsertStmt = $pdo->prepare("
        INSERT INTO estimate_items (
            estimate_id, catalog_item_id, item_type, group_name, cost_type,
            name, description, quantity, unit_of_measure, unit_cost,
            unit_labor_time, material_cost, labor_cost, equipment_cost,
            subcontractor_cost, labor_hours, sort_order, metadata_json,
            created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            NOW(), NOW()
        )
    ");

    $groupIndex = 0;
    foreach ($groupDefinitions as $gDef) {
        $groupId = 'group_' . substr(md5($gDef['name'] . $groupIndex), 0, 8);
        $wGroup = [
            'id' => $groupId,
            'name' => $gDef['name'],
            'expanded' => true,
            'source' => 'manual',
            'sortOrder' => $groupIndex,
            'items' => []
        ];

        $itemIndex = 0;
        foreach ($gDef['item_ids'] as $catId) {
            if (!isset($catalogMap[$catId])) continue;
            $cat = $catalogMap[$catId];

            $itemId = 'item_' . substr(md5($projectId . '_' . $catId . '_' . $gDef['name'] . '_' . $itemIndex), 0, 10);
            $qty = 1.0;
            $unitCost = (float)$cat['unit_cost'];
            $laborHours = (float)$cat['labor_hours'];
            $materialCost = (float)$cat['material_cost'] > 0 ? (float)$cat['material_cost'] : $unitCost;
            $laborCost = (float)$cat['labor_cost'];
            $equipmentCost = (float)$cat['equipment_cost'];
            $subcontractorCost = (float)$cat['subcontractor_cost'];
            $uom = $cat['unit_of_measure'] ?: 'ea';
            $itemType = in_array($cat['item_type'], ['assembly', 'labor', 'equipment', 'subcontractor', 'material']) ? $cat['item_type'] : 'part';

            $catalogSnapshot = [
                'id' => (int)$cat['id'],
                'catalog_id' => (int)($cat['catalog_id'] ?? 1),
                'name' => $cat['name'],
                'description' => $cat['description'] ?? '',
                'sku' => $cat['sku'] ?? '',
                'catalog_number' => $cat['catalog_number'] ?? '',
                'unit_of_measure' => $uom,
                'unit_cost' => $unitCost,
                'material_cost' => $materialCost,
                'labor_hours' => $laborHours,
                'labor_cost' => $laborCost,
                'equipment_cost' => $equipmentCost,
                'subcontractor_cost' => $subcontractorCost,
                'color' => $cat['color'] ?: '#2563eb',
                'symbol' => $cat['symbol'] ?: 'circle',
                'item_type' => $itemType,
                'cost_type' => $cat['cost_type'] ?: 'Materials'
            ];

            $wItem = [
                'id' => $itemId,
                'takeoffLayerId' => null,
                'catalogItemId' => (int)$cat['id'],
                'name' => $cat['name'],
                'description' => $cat['description'] ?? '',
                'costCode' => $cat['catalog_number'] ?? $cat['sku'] ?? '',
                'budgetCode' => $cat['catalog_number'] ?? '',
                'costCategory' => $cat['cost_type'] ?: 'Materials',
                'itemType' => $itemType,
                'isAssembly' => $itemType === 'assembly',
                'uom' => $uom,
                'quantity' => $qty,
                'originalQuantity' => $qty,
                'quantitySource' => 'manual',
                'quantitySyncStatus' => 'manual',
                'unitMaterialCost' => $materialCost,
                'waste' => 0,
                'materialMargin' => 0,
                'unitLabor' => $laborHours,
                'laborRate' => 85,
                'laborMargin' => 0,
                'difficulty' => 1,
                'unitEquipmentCost' => $equipmentCost,
                'unitSubcontractorCost' => $subcontractorCost,
                'taxable' => true,
                'catalogSnapshot' => $catalogSnapshot,
                'children' => []
            ];

            $wGroup['items'][] = $wItem;

            // Mirror into estimate_items relational table
            $itemInsertStmt->execute([
                $estimateDbId,
                $cat['id'],
                $itemType,
                $gDef['name'],
                $cat['cost_type'] ?: 'Materials',
                $cat['name'],
                $cat['description'] ?? '',
                $qty,
                $uom,
                $unitCost,
                $laborHours,
                $materialCost,
                $laborCost,
                $equipmentCost,
                $subcontractorCost,
                $laborHours,
                $itemIndex,
                json_encode(['catalogSnapshot' => $catalogSnapshot], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            ]);
            $totalEstimateItemsInserted++;
            $itemIndex++;
        }

        $workspaceGroups[] = $wGroup;
        $groupIndex++;
    }

    // 7. Insert estimate_workspace_states
    $clientEstimateId = 'estimate_shell_' . $projectId;
    $stateJson = [
        'id' => $clientEstimateId,
        'dbEstimateId' => $estimateDbId,
        'projectId' => $projectId,
        'name' => 'Primary Shell Estimate',
        'status' => 'draft',
        'is_primary' => true,
        'isPrimary' => true,
        'isActive' => true,
        'revision' => 1,
        'estimateRevision' => 1,
        'creationMode' => 'primary',
        'takeoffSyncMode' => 'mirror',
        'createdAt' => date('c'),
        'updatedAt' => date('c'),
        'groups' => $workspaceGroups,
        'notes' => [
            'scope' => 'Standard electrical estimate for Shell Building including: Lighting fixtures, lighting controls, electrical distribution gear, rough-in devices, overhead EMT branch conduits, underground PVC conduits, main and secondary feeders, and equipment rental.',
            'included' => ['All materials listed in estimate groups', 'Installation labor at standard rates', 'Equipment rental for overhead installation'],
            'excluded' => ['Fire alarm systems (by specialized vendor)', 'Utility company fees for primary connection']
        ],
        'settings' => [
            'assemblyExpansionPolicy' => 'CANONICAL',
            'marginMode' => 'margin',
            'globalLaborCost' => 85,
            'globalLaborSales' => 110,
            'globalLaborMargin' => 22.7,
            'taxes' => [
                'Materials' => 7,
                'Labor' => 0,
                'Equipment' => 7
            ],
            'preTaxMarkups' => [
                [
                    'id' => 'markup_overhead_' . $projectId,
                    'name' => 'Overhead',
                    'type' => 'percentage',
                    'percent' => 10,
                    'amount' => 10,
                    'base' => 'subtotal_sales',
                    'active' => true
                ],
                [
                    'id' => 'markup_profit_' . $projectId,
                    'name' => 'Profit',
                    'type' => 'percentage',
                    'percent' => 10,
                    'amount' => 10,
                    'base' => 'subtotal_sales',
                    'active' => true
                ]
            ],
            'postTaxMarkups' => []
        ]
    ];

    $wsStmt = $pdo->prepare("
        INSERT INTO estimate_workspace_states (
            estimate_id, project_id, client_estimate_id, state_json, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, NOW(), NOW())
    ");
    $wsStmt->execute([
        $estimateDbId,
        $projectId,
        $clientEstimateId,
        json_encode($stateJson, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    ]);

    $pdo->commit();

    echo "========================================\n";
    echo "SUCCESS: Shell Building Template Created!\n";
    echo "Template ID: $templateId\n";
    echo "Project ID: $projectId\n";
    echo "Project Number: $projectNum\n";
    echo "Project Name: Shell Building Template\n";
    echo "Estimate DB ID: $estimateDbId\n";
    echo "Groups Created: " . count($workspaceGroups) . "\n";
    echo "Total Estimate Items: $totalEstimateItemsInserted\n";
    echo "Dashboard URL: pages/project_dashboard.php?id=$projectId\n";
    echo "========================================\n";

} catch (\Throwable $e) {
    $pdo->rollBack();
    echo "ERROR: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
    exit(1);
}
