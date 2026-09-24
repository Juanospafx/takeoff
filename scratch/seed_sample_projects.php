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
        for ($i = 0; $i < 12; $i++) {
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

            $metadata = [
                'estimator' => $estimator,
                'estimator_name' => $estimator,
                'customer_email' => $client[1],
                'primary_contact' => $client[1],
                'estimate_total' => $totalValue,
                'total_sales' => $totalValue,
                'primary_quote_value' => $primaryQuote,
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

            $totalInserted++;
        }
    }

    echo "SUCCESS: Inserted {$totalInserted} test projects across all 10 pipeline phases.\n";
} catch (\Throwable $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    exit(1);
}
