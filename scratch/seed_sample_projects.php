<?php
require_once __DIR__ . '/../core/db/connection.php';

try {
    /** @var \PDO $pdo */
    global $pdo;

    // Keep Default Takeoff Project (id=1)
    // Clear previously seeded demo projects (project_number LIKE 'DEMO-%')
    $pdo->exec("DELETE FROM `projects` WHERE `project_number` LIKE 'DEMO-%'");

    $phases = [
        'invitations' => 'Invitations',
        'to_do' => 'To Do',
        'estimating' => 'Estimating',
        'bid_submitted' => 'Bid Submitted',
        'accepted' => 'Accepted',
        'in_progress' => 'In Progress',
        'complete' => 'Complete',
        'estimadores' => 'Estimadores',
        'lost' => 'Lost',
        'archived' => 'Archived'
    ];

    $shortNames = [
        'Roof Repair',
        'Lot 4 Deck',
        'HVAC Retrofit',
        'Gate Automation',
        'Slab Pour',
        'Unit 304 Remodel',
        'Bistro Patio',
        'Fire Door Replacement',
        'Drywall Patching',
        'Loading Dock Ramp',
        'Exterior Painting',
        'Basement Waterproofing'
    ];

    $longNames = [
        'St. Jude Children Specialty Clinic - Complete Level 4 MEPF Infrastructure & Seismic Bracing',
        'Metropolitan Logistics Hub - 450,000 Sq Ft Pre-Engineered Steel Superstructure & Tilt-Up Walls',
        'Oceanview Luxury Condominiums - Architectural Glazing, Balcony Balustrades & Curtain Wall Package',
        'Silicon Valley Technology Campus - Phase 3 Cleanroom Expansion & High-Purity Piping System',
        'Grand Central Transit Terminal - Historic Masonry Restoration, Terra Cotta Repair & Seismic Retrofit',
        'Northwest Regional Data Center - Critical Redundant Power Substation, Backup Generators & Raised Flooring',
        'Pinecrest Senior Living Community - Full Commercial Kitchen Equipment & Fire Suppression Takeoff',
        'Westside Mixed-Use Development - Multi-Level Post-Tensioned Concrete Parking Structure',
        'Riverside Municipal Wastewater Treatment Facility - Aeration Basin Rehabilitation & Sludge Dewatering',
        'Summit Ridge Mountain Resort - Timber-Framed Clubhouse, Exposed Heavy Truss Framing & Copper Roof',
        'Bay Area Biotech Laboratory - Biosafety Level 3 Containment Modules & Specialized Exhaust Ductwork',
        'Downtown Hyatt Regency Hotel - 18-Story Atrium Acoustical Wall Panels & Custom Millwork Fabrication'
    ];

    $clients = [
        ['Turner Construction Co.', 'bids@turnerconstruction.com', 'New York, NY'],
        ['Skanska USA Building', 'estimating@skanska.com', 'Parsippany, NJ'],
        ['Whiting-Turner Contracting', 'proposals@whiting-turner.com', 'Baltimore, MD'],
        ['Suffolk Construction', 'subcontractor-bids@suffolk.com', 'Boston, MA'],
        ['DPR Construction', 'estimating.bayarea@dpr.com', 'Redwood City, CA'],
        ['Clark Construction Group', 'bidbox@clarkconstruction.com', 'Bethesda, MD'],
        ['PCL Construction', 'bids.florida@pcl.com', 'Orlando, FL'],
        ['Gilbane Building Company', 'commercial@gilbaneco.com', 'Providence, RI'],
        ['Mortenson Construction', 'estimating@mortenson.com', 'Minneapolis, MN'],
        ['Hensel Phelps', 'bids.southeast@henselphelps.com', 'Greeley, CO'],
        ['Brasfield & Gorrie', 'estimates@brasfieldgorrie.com', 'Birmingham, AL'],
        ['McCarthy Building Companies', 'proposals.west@mccarthy.com', 'St. Louis, MO']
    ];

    $estimators = [
        'Juan Estevez',
        'Sarah Jenkins',
        'Michael Chang',
        'Elena Rostova',
        'Carlos Rodriguez',
        'David Miller',
        'Amanda Brooks',
        'Marcus Vance'
    ];

    $categories = [
        'Commercial Shell & Core',
        'Healthcare & Life Sciences',
        'Educational Facility',
        'Industrial & Warehouse',
        'Multi-Family Residential',
        'Hospitality & Entertainment',
        'Heavy Civil Infrastructure',
        'Retail Interior Tenant Improvement'
    ];

    $insertStmt = $pdo->prepare("
        INSERT INTO `projects` (
            `project_number`,
            `name`,
            `description`,
            `status`,
            `client_name`,
            `city`,
            `state`,
            `country`,
            `bid_due_at`,
            `created_at`,
            `metadata_json`
        ) VALUES (
            :project_number,
            :name,
            :description,
            :status,
            :client_name,
            :city,
            :state,
            :country,
            :bid_due_at,
            :created_at,
            :metadata_json
        )
    ");

    $totalInserted = 0;
    $phaseIndex = 0;

    foreach ($phases as $statusCode => $phaseLabel) {
        $phaseIndex++;
        for ($i = 0; $i < 8; $i++) {
            // Alternate between short and long names for testing flexibility
            $isLong = ($i % 2 === 1);
            $namePool = $isLong ? $longNames : $shortNames;
            $projectName = $namePool[$i];

            $client = $clients[($phaseIndex * 3 + $i) % count($clients)];
            $estimator = ($i === 0) ? 'Unassigned' : $estimators[($phaseIndex + $i) % count($estimators)];
            $category = $categories[($phaseIndex + $i) % count($categories)];

            $sqft = rand(15, 650) * 100; // 1,500 - 65,000 sq ft
            $ratePerSqFt = rand(45, 280);
            $totalValue = round($sqft * $ratePerSqFt, -2);
            $primaryQuote = ($i % 3 === 0) ? round($totalValue * 0.96, -2) : 0;

            // Vary due dates: overdue, next 3 days, next 15 days, next 45 days, or null
            $dueDate = null;
            if ($i % 5 === 0) {
                // Past due (1 to 10 days ago)
                $dueDate = date('Y-m-d H:i:s', strtotime('-' . rand(1, 10) . ' days ' . rand(9, 17) . ':00:00'));
            } elseif ($i % 5 === 1) {
                // Due soon (1 to 6 days ahead)
                $dueDate = date('Y-m-d H:i:s', strtotime('+' . rand(1, 6) . ' days ' . rand(10, 16) . ':00:00'));
            } elseif ($i % 5 === 2) {
                // Due in 2 to 4 weeks
                $dueDate = date('Y-m-d H:i:s', strtotime('+' . rand(10, 28) . ' days ' . rand(12, 17) . ':00:00'));
            } elseif ($i % 5 === 3) {
                // Due next month
                $dueDate = date('Y-m-d H:i:s', strtotime('+' . rand(32, 60) . ' days 14:00:00'));
            } else {
                // No due date defined
                $dueDate = null;
            }

            $createdAt = date('Y-m-d H:i:s', strtotime('-' . rand(2, 90) . ' days'));
            $projectNum = sprintf('DEMO-P%02d-%02d', $phaseIndex, $i + 1);

            // Scale realistic material & equipment quantities based on square footage
            $scaleFactor = max(0.5, round($sqft / 10000, 2));
            $trofferQty = max(12, (int)round($sqft / 90));
            $conduitLF = max(180, (int)round($sqft * 0.85));
            $wireLF = max(600, (int)round($conduitLF * 3.5));
            $recQty = max(10, (int)round($sqft / 250));
            $dimmerQty = max(4, (int)round($trofferQty / 8));
            $exitQty = max(2, (int)round($sqft / 4000));

            $groups1 = [
                [
                    'id' => 'grp_dist_' . $i,
                    'name' => 'Power & Distribution',
                    'expanded' => true,
                    'items' => [
                        [
                            'id' => 'itm_mdp_' . $i,
                            'name' => '400A Main Distribution Panel (MDP-1, 120/208V 3PH 4W)',
                            'quantity' => 1,
                            'unit' => 'EA',
                            'unit_cost' => 8500.00,
                            'cost' => 8500.00,
                            'material_cost' => 8500.00,
                            'labor_hours' => 18.0
                        ],
                        [
                            'id' => 'itm_p1a_' . $i,
                            'name' => '200A 42-Circuit Lighting & Appliance Branch Panel',
                            'quantity' => max(1, (int)round($scaleFactor)),
                            'unit' => 'EA',
                            'unit_cost' => 2850.00,
                            'cost' => 2850.00,
                            'material_cost' => 2850.00,
                            'labor_hours' => 12.0
                        ],
                        [
                            'id' => 'itm_xfmr_' . $i,
                            'name' => '75kVA Dry-Type Transformer 480V-208Y/120V NEMA 3R',
                            'quantity' => 1,
                            'unit' => 'EA',
                            'unit_cost' => 4200.00,
                            'cost' => 4200.00,
                            'material_cost' => 4200.00,
                            'labor_hours' => 14.0
                        ]
                    ]
                ],
                [
                    'id' => 'grp_light_' . $i,
                    'name' => 'Lighting & Lighting Controls',
                    'expanded' => true,
                    'items' => [
                        [
                            'id' => 'itm_troff_' . $i,
                            'name' => '2x4 Architectural Back-Lit LED Troffer 40W 4000K',
                            'quantity' => $trofferQty,
                            'unit' => 'EA',
                            'unit_cost' => 125.00,
                            'cost' => 125.00,
                            'material_cost' => 125.00,
                            'labor_hours' => 0.75
                        ],
                        [
                            'id' => 'itm_dimm_' . $i,
                            'name' => '0-10V Commercial Dimming Wall Station / Occupancy Sensor',
                            'quantity' => $dimmerQty,
                            'unit' => 'EA',
                            'unit_cost' => 85.00,
                            'cost' => 85.00,
                            'material_cost' => 85.00,
                            'labor_hours' => 0.5
                        ],
                        [
                            'id' => 'itm_exit_' . $i,
                            'name' => 'LED Exit Sign / Emergency Light Combo w/ Battery Backup',
                            'quantity' => $exitQty,
                            'unit' => 'EA',
                            'unit_cost' => 110.00,
                            'cost' => 110.00,
                            'material_cost' => 110.00,
                            'labor_hours' => 0.8
                        ]
                    ]
                ],
                [
                    'id' => 'grp_branch_' . $i,
                    'name' => 'Conduit, Wire & Branch Devices',
                    'expanded' => true,
                    'items' => [
                        [
                            'id' => 'itm_emt_' . $i,
                            'name' => '3/4" EMT Thinwall Steel Conduit w/ Set Screw Fittings',
                            'quantity' => $conduitLF,
                            'unit' => 'LF',
                            'unit_cost' => 7.80,
                            'cost' => 7.80,
                            'material_cost' => 7.80,
                            'labor_hours' => 0.12
                        ],
                        [
                            'id' => 'itm_wire_' . $i,
                            'name' => '#12 AWG THHN Stranded Copper Building Wire (600V)',
                            'quantity' => $wireLF,
                            'unit' => 'LF',
                            'unit_cost' => 0.65,
                            'cost' => 0.65,
                            'material_cost' => 0.65,
                            'labor_hours' => 0.04
                        ],
                        [
                            'id' => 'itm_rec_' . $i,
                            'name' => '20A Commercial Spec-Grade Duplex Receptacle w/ Cover',
                            'quantity' => $recQty,
                            'unit' => 'EA',
                            'unit_cost' => 45.00,
                            'cost' => 45.00,
                            'material_cost' => 45.00,
                            'labor_hours' => 0.45
                        ]
                    ]
                ]
            ];

            // Calculate Primary Estimate Subtotal
            $directSales1 = 0;
            foreach ($groups1 as $g) {
                foreach ($g['items'] as $it) {
                    $directSales1 += $it['quantity'] * $it['unit_cost'];
                }
            }
            // 10% overhead / markup
            $primaryEstTotal = round($directSales1 * 1.10, 2);

            // Alternate estimate: Premium Architectural Fixtures
            $altFixturesQty = max(6, (int)round($trofferQty * 0.35));
            $groups2 = [
                [
                    'id' => 'grp_alt_' . $i,
                    'name' => 'Architectural Suspended Linear Lighting',
                    'expanded' => true,
                    'items' => [
                        [
                            'id' => 'itm_pendant_' . $i,
                            'name' => '4FT Direct/Indirect Architectural LED Continuous Pendant',
                            'quantity' => $altFixturesQty,
                            'unit' => 'EA',
                            'unit_cost' => 310.00,
                            'cost' => 310.00,
                            'material_cost' => 310.00,
                            'labor_hours' => 1.2
                        ],
                        [
                            'id' => 'itm_daylight_' . $i,
                            'name' => 'Continuous Daylight Harvesting & Wireless Mesh Sensors',
                            'quantity' => max(2, (int)round($altFixturesQty / 4)),
                            'unit' => 'EA',
                            'unit_cost' => 165.00,
                            'cost' => 165.00,
                            'material_cost' => 165.00,
                            'labor_hours' => 0.7
                        ]
                    ]
                ]
            ];
            $directSales2 = 0;
            foreach ($groups2 as $g) {
                foreach ($g['items'] as $it) {
                    $directSales2 += $it['quantity'] * $it['unit_cost'];
                }
            }
            $altEstTotal = round($directSales2 * 1.10, 2);

            $primaryId = "est_{$phaseIndex}_{$i}_primary";
            $altId = "est_{$phaseIndex}_{$i}_alt";

            $metadata = [
                'estimator' => $estimator,
                'estimator_name' => $estimator,
                'customer_email' => $client[1],
                'primary_contact' => $client[1],
                'primary_estimate_id' => $primaryId,
                'primary_estimate_total' => $primaryEstTotal,
                'primary_quote_value' => $primaryEstTotal,
                'estimate_total' => $primaryEstTotal,
                'total_sales' => $primaryEstTotal,
                'square_footage' => $sqft,
                'sqft' => $sqft,
                'task_count' => rand(0, 14),
                'note_count' => rand(0, 8),
                'measurement_system' => 'US',
                'estimate_pricing' => 'Unlocked'
            ];

            $insertStmt->execute([
                ':project_number' => $projectNum,
                ':name' => $projectName,
                ':description' => $category,
                ':status' => $statusCode,
                ':client_name' => $client[0],
                ':city' => explode(',', $client[2])[0],
                ':state' => trim(explode(',', $client[2])[1] ?? 'FL'),
                ':country' => 'USA',
                ':bid_due_at' => $dueDate,
                ':created_at' => $createdAt,
                ':metadata_json' => json_encode($metadata, JSON_UNESCAPED_SLASHES)
            ]);

            $insertedProjectId = (int)$pdo->lastInsertId();

            // Insert Primary Estimate
            $estStmt = $pdo->prepare("
                INSERT INTO `estimates` (
                    `project_id`, `estimate_number`, `name`, `status`, `currency_code`, `created_at`, `updated_at`
                ) VALUES (?, ?, ?, ?, 'USD', ?, ?)
            ");
            $estStmt->execute([
                $insertedProjectId,
                $projectNum . '-EST1',
                'Primary Estimate',
                'ready',
                $createdAt,
                $createdAt
            ]);
            $est1DbId = (int)$pdo->lastInsertId();

            $state1 = [
                'id' => $primaryId,
                'dbEstimateId' => $est1DbId,
                'projectId' => $insertedProjectId,
                'name' => 'Primary Estimate',
                'status' => 'ready',
                'is_primary' => true,
                'isPrimary' => true,
                'isActive' => true,
                'groups' => $groups1,
                'settings' => [
                    'preTaxMarkups' => [
                        ['id' => 'm_oh_' . $i, 'name' => 'Overhead', 'type' => 'percentage', 'percent' => 10, 'base' => 'subtotal_sales', 'active' => true]
                    ],
                    'postTaxMarkups' => [],
                    'taxes' => []
                ]
            ];

            // Insert Alternate Estimate
            $estStmt->execute([
                $insertedProjectId,
                $projectNum . '-EST2',
                'Alternate Lighting Package',
                'draft',
                $createdAt,
                $createdAt
            ]);
            $est2DbId = (int)$pdo->lastInsertId();

            $state2 = [
                'id' => $altId,
                'dbEstimateId' => $est2DbId,
                'projectId' => $insertedProjectId,
                'name' => 'Alternate Lighting Package',
                'status' => 'draft',
                'is_primary' => false,
                'isPrimary' => false,
                'isActive' => false,
                'groups' => $groups2,
                'settings' => [
                    'preTaxMarkups' => [
                        ['id' => 'm_oh2_' . $i, 'name' => 'Overhead', 'type' => 'percentage', 'percent' => 10, 'base' => 'subtotal_sales', 'active' => true]
                    ],
                    'postTaxMarkups' => [],
                    'taxes' => []
                ]
            ];

            $wsStmt = $pdo->prepare("
                INSERT INTO `estimate_workspace_states` (
                    `estimate_id`, `project_id`, `client_estimate_id`, `state_json`, `revision`
                ) VALUES (?, ?, ?, ?, 1)
            ");
            $wsStmt->execute([$est1DbId, $insertedProjectId, $primaryId, json_encode($state1, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
            $wsStmt->execute([$est2DbId, $insertedProjectId, $altId, json_encode($state2, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);

            $totalInserted++;
        }
    }

    echo "SUCCESS: Inserted {$totalInserted} test projects with rich multi-estimates and workspace items across all 10 pipeline phases.\n";
} catch (\Throwable $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    exit(1);
}
