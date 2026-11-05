<?php
/**
 * create_4_building_templates.php
 * Creates 4 realistic, production-grade Electrical Building Template Projects:
 * 1. Commercial Shell Building Template (PRJ-TMPL-SHELL, ~18,500 sq ft)
 * 2. Medical Clinic & Healthcare Office Template (PRJ-TMPL-MEDIC, ~9,200 sq ft)
 * 3. Industrial Logistics & Warehouse Template (PRJ-TMPL-WAREH, ~52,000 sq ft)
 * 4. Multi-Family Residential Complex Template (PRJ-TMPL-MULTI, ~32,500 sq ft, 24 units + clubhouse)
 */

require_once __DIR__ . '/../core/db/connection.php';

$pdo->beginTransaction();

try {
    echo "=================================================================\n";
    echo "STARTING CREATION OF 4 BUILDING TEMPLATE ESTIMATING PROJECTS\n";
    echo "=================================================================\n";

    // Helper: Query catalog item details
    $catalogCache = [];
    $getCatItem = function($id) use ($pdo, &$catalogCache) {
        if (isset($catalogCache[$id])) return $catalogCache[$id];
        $st = $pdo->prepare("SELECT * FROM catalog_items WHERE id = ? LIMIT 1");
        $st->execute([$id]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $catalogCache[$id] = $row;
        return $row;
    };

    // Helper: Query assembly parts
    $partsCache = [];
    $getAssemblyParts = function($assemblyId) use ($pdo, &$partsCache) {
        if (isset($partsCache[$assemblyId])) return $partsCache[$assemblyId];
        $st = $pdo->prepare("
            SELECT ap.id as assembly_part_id, ap.assembly_catalog_item_id, ap.part_catalog_item_id,
                   ap.quantity, ap.ratio_type, ap.waste_factor_percent, ap.sort_order,
                   ci.id as part_id, ci.name, ci.description, ci.unit_of_measure,
                   ci.unit_cost, ci.material_cost, ci.labor_hours, ci.cost_type
            FROM assembly_parts ap
            JOIN catalog_items ci ON ci.id = ap.part_catalog_item_id
            WHERE ap.assembly_catalog_item_id = ?
            ORDER BY ap.sort_order ASC, ap.id ASC
        ");
        $st->execute([$assemblyId]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        $partsCache[$assemblyId] = $rows;
        return $rows;
    };

    // Define the 4 Templates Configuration
    $templatesConfig = [
        // -------------------------------------------------------------
        // TEMPLATE 1: Commercial Shell Building
        // -------------------------------------------------------------
        [
            'code' => 'PRJ-TMPL-SHELL',
            'name' => 'Commercial Shell Building Template',
            'template_name' => 'Commercial Shell Building Template',
            'trade' => 'Electrical',
            'client' => 'Apex Commercial Properties LLC',
            'address' => '100 Industrial Parkway',
            'city' => 'Orlando',
            'state' => 'FL',
            'zip' => '32801',
            'sqft' => 18500,
            'desc' => 'Standard template for Commercial Shell Building electrical estimating. Includes complete scope: Lighting, Controls, Main Gear & Distribution, Rough-In, Overhead Branch Lighting (EMT), Overhead Branch Power (EMT), Underground Conduits (PVC), Feeders & Services, Secondary, Primary Transformer Connection, Site Lighting, and Equipment Rental.',
            'settings' => [
                'marginMode' => 'margin',
                'assemblyExpansionPolicy' => 'CANONICAL',
                'globalLaborCost' => 85,
                'globalLaborSales' => 110,
                'globalLaborMargin' => 22.7,
                'taxes' => ['Materials' => 7.0, 'Labor' => 0.0, 'Equipment' => 7.0],
                'preTaxMarkups' => [
                    ['id' => 'markup_overhead', 'name' => 'Overhead', 'type' => 'percentage', 'percent' => 10, 'amount' => 10, 'base' => 'subtotal_sales', 'active' => true],
                    ['id' => 'markup_profit', 'name' => 'Profit', 'type' => 'percentage', 'percent' => 10, 'amount' => 10, 'base' => 'subtotal_sales', 'active' => true]
                ],
                'postTaxMarkups' => []
            ],
            'notes' => [
                'scope' => 'Electrical estimating package for 18,500 sq ft Commercial Shell Building. Base building core & shell electrical distribution, 800A 480/277V service with step-down transformers, exterior architectural facade lighting, parking lot lighting, emergency exit lighting egress, and complete rough-in infrastructure for future tenant fit-outs.',
                'included' => [
                    'Furnish and install main 800A switchboard and distribution panelboards',
                    'Dry-type step-down transformer (480V to 120/208V)',
                    'Complete branch EMT conduits with #12 and #10 THHN copper conductors',
                    'Underground utility conduits with pull strings and concrete transformer pad rough-in',
                    'Exterior LED lighting fixtures with photocell & timeclock controls',
                    'Scissor lift rental for high-ceiling overhead conduit installation',
                    'Standard electrical permits and inspection coordination'
                ],
                'excluded' => [
                    'Interior tenant build-out power & lighting beyond base shell provisions',
                    'Low-voltage telecommunication cabling & server rack hardware',
                    'Fire alarm devices and engineered fire alarm submittals (by certified life safety vendor)',
                    'Utility company charges or impact connection fees'
                ]
            ],
            'groups' => [
                [
                    'name' => 'Lighting',
                    'items' => [
                        ['cat_id' => 7400, 'qty' => 38, 'waste' => 0], // Fixture A
                        ['cat_id' => 7258, 'qty' => 24, 'waste' => 0], // Fixture B
                        ['cat_id' => 7367, 'qty' => 16, 'waste' => 0], // Fixture C
                        ['cat_id' => 7268, 'qty' => 12, 'waste' => 0], // Fixture D
                        ['cat_id' => 7266, 'qty' => 10, 'waste' => 0], // Fixture E
                        ['cat_id' => 7274, 'qty' => 8,  'waste' => 0], // Fixture F
                        ['cat_id' => 7401, 'qty' => 14, 'waste' => 0], // Fixture EM
                        ['cat_id' => 7264, 'qty' => 18, 'waste' => 0]  // Exit Sign X
                    ]
                ],
                [
                    'name' => 'Controls',
                    'items' => [
                        ['cat_id' => 8605, 'qty' => 22, 'waste' => 0], // Occupancy Sensor Ceiling
                        ['cat_id' => 8606, 'qty' => 14, 'waste' => 0], // Sensor Wall Switch
                        ['cat_id' => 8613, 'qty' => 10, 'waste' => 0], // Dimmer 0-10V
                        ['cat_id' => 8612, 'qty' => 8,  'waste' => 0], // Power Pack
                        ['cat_id' => 8600, 'qty' => 4,  'waste' => 0], // Daylight Harvesting Sensor
                        ['cat_id' => 8614, 'qty' => 6,  'waste' => 0], // Low Voltage Switch
                        ['cat_id' => 8591, 'qty' => 2,  'waste' => 0], // Photocell Dusk-to-Dawn
                        ['cat_id' => 8596, 'qty' => 2,  'waste' => 0]  // Time Clock 7-Day Digital
                    ]
                ],
                [
                    'name' => 'Gear & Distribution',
                    'items' => [
                        ['cat_id' => 7010, 'qty' => 1, 'waste' => 0], // Transformer Pad Concrete
                        ['cat_id' => 7090, 'qty' => 1, 'waste' => 0], // Main Disconnect 600A 208V
                        ['cat_id' => 7104, 'qty' => 1, 'waste' => 0], // Main Disconnect 800A 208V
                        ['cat_id' => 7011, 'qty' => 1, 'waste' => 0], // CT Meter Cabinet
                        ['cat_id' => 6920, 'qty' => 2, 'waste' => 0], // Meter Center 200A-400A
                        ['cat_id' => 7024, 'qty' => 2, 'waste' => 0], // Panelboard Medium 200A 42-slot
                        ['cat_id' => 7017, 'qty' => 1, 'waste' => 0], // Panelboard Large 600A 72-slot
                        ['cat_id' => 7021, 'qty' => 1, 'waste' => 0], // Panel NEHB 277/480V 225A
                        ['cat_id' => 7056, 'qty' => 2, 'waste' => 0]  // Contactor 30A 3P
                    ]
                ],
                [
                    'name' => 'Rough In',
                    'items' => [
                        ['cat_id' => 7679, 'qty' => 140, 'waste' => 5], // 4" Sq Deep Box
                        ['cat_id' => 7674, 'qty' => 85,  'waste' => 5], // 4" Sq Shallow Box
                        ['cat_id' => 7737, 'qty' => 120, 'waste' => 5], // 1-Gang Mudring 5/8"
                        ['cat_id' => 7636, 'qty' => 45,  'waste' => 0], // Single Pole Switch 20A
                        ['cat_id' => 7558, 'qty' => 30,  'waste' => 0], // GFCI Receptacle 20A
                        ['cat_id' => 7560, 'qty' => 80,  'waste' => 0], // Commercial Duplex 20A
                        ['cat_id' => 7557, 'qty' => 25,  'waste' => 0], // USB Duplex Receptacle
                        ['cat_id' => 7753, 'qty' => 8,   'waste' => 0]  // 30A Heavy Disconnect NEMA 3R
                    ]
                ],
                [
                    'name' => 'Overhead Branch Conduits (EMT)',
                    'items' => [
                        ['cat_id' => 8840, 'qty' => 450, 'waste' => 5], // 3/4" EMT w/ Pullstring
                        ['cat_id' => 8849, 'qty' => 650, 'waste' => 5], // 1/2" EMT w/ 2 #12 THHN
                        ['cat_id' => 8850, 'qty' => 850, 'waste' => 5], // 1/2" EMT w/ 3 #12 THHN
                        ['cat_id' => 8851, 'qty' => 520, 'waste' => 5], // 1/2" EMT w/ 4 #12 THHN
                        ['cat_id' => 8857, 'qty' => 380, 'waste' => 5], // 3/4" EMT w/ 2 #12 THHN
                        ['cat_id' => 8858, 'qty' => 420, 'waste' => 5]  // 3/4" EMT w/ 3 #12 THHN
                    ]
                ],
                [
                    'name' => 'Overhead Power Conduits (EMT)',
                    'items' => [
                        ['cat_id' => 8855, 'qty' => 350, 'waste' => 5], // 1/2" EMT w/ 2 #10 THHN
                        ['cat_id' => 8856, 'qty' => 280, 'waste' => 5], // 1/2" EMT w/ 3 #10 THHN
                        ['cat_id' => 8841, 'qty' => 220, 'waste' => 5], // 1" EMT w/ Pullstring
                        ['cat_id' => 8842, 'qty' => 150, 'waste' => 5]  // 1-1/4" EMT w/ Pullstring
                    ]
                ],
                [
                    'name' => 'Underground Conduits (PVC)',
                    'items' => [
                        ['cat_id' => 8892, 'qty' => 320, 'waste' => 5], // 3/4" Sch 40 PVC w/ Pullstring
                        ['cat_id' => 8893, 'qty' => 240, 'waste' => 5], // 1" Sch 40 PVC w/ Pullstring
                        ['cat_id' => 8895, 'qty' => 180, 'waste' => 5], // 1-1/2" Sch 40 PVC w/ Pullstring
                        ['cat_id' => 8898, 'qty' => 260, 'waste' => 5], // 3" Sch 40 PVC w/ Pullstring
                        ['cat_id' => 8900, 'qty' => 350, 'waste' => 5]  // 4" Sch 40 PVC w/ Pullstring
                    ]
                ],
                [
                    'name' => 'Feeders & Services',
                    'items' => [
                        ['cat_id' => 8988, 'qty' => 120, 'waste' => 5], // 175A 4W w/ GND CU Feeder
                        ['cat_id' => 8996, 'qty' => 160, 'waste' => 5], // 225A 4W w/ GND CU Feeder
                        ['cat_id' => 9000, 'qty' => 140, 'waste' => 5], // 225A 4W w/ GND Sch 80 PVC
                        ['cat_id' => 9004, 'qty' => 180, 'waste' => 5], // 250A 4W w/ GND Sch 40 PVC
                        ['cat_id' => 9022, 'qty' => 210, 'waste' => 5]  // 400A 4W w/ GND Sch 40 PVC
                    ]
                ],
                [
                    'name' => 'Site & Exterior Lighting',
                    'items' => [
                        ['cat_id' => 7253, 'qty' => 6,  'waste' => 0], // Lighting Pole 20' Steel
                        ['cat_id' => 7263, 'qty' => 4,  'waste' => 0], // Lighting Pole 25' Steel
                        ['cat_id' => 8604, 'qty' => 8,  'waste' => 0]  // Wall Pack w/ Battery Backup
                    ]
                ],
                [
                    'name' => 'Equipment Rental',
                    'items' => [
                        ['cat_id' => 8577, 'qty' => 4,  'waste' => 0]  // Equipment Rental (Weeks)
                    ]
                ]
            ]
        ],

        // -------------------------------------------------------------
        // TEMPLATE 2: Medical Clinic & Healthcare Office
        // -------------------------------------------------------------
        [
            'code' => 'PRJ-TMPL-MEDIC',
            'name' => 'Medical Clinic & Healthcare Office Template',
            'template_name' => 'Medical Clinic & Healthcare Office Template',
            'trade' => 'Electrical',
            'client' => 'Horizon Health Partners',
            'address' => '450 Medical Arts Boulevard',
            'city' => 'Tampa',
            'state' => 'FL',
            'zip' => '33606',
            'sqft' => 9200,
            'desc' => 'Specialized estimating template for Outpatient Medical Clinics, Ambulatory Care, and Healthcare Facilities. Features isolated grounding, hospital-grade devices, cleanroom sealed LED troffers, emergency transfer distribution, and medical MC cables.',
            'settings' => [
                'marginMode' => 'margin',
                'assemblyExpansionPolicy' => 'CANONICAL',
                'globalLaborCost' => 95,
                'globalLaborSales' => 125,
                'globalLaborMargin' => 24.0,
                'taxes' => ['Materials' => 7.5, 'Labor' => 0.0, 'Equipment' => 7.5],
                'preTaxMarkups' => [
                    ['id' => 'markup_overhead', 'name' => 'Overhead', 'type' => 'percentage', 'percent' => 12, 'amount' => 12, 'base' => 'subtotal_sales', 'active' => true],
                    ['id' => 'markup_profit', 'name' => 'Profit', 'type' => 'percentage', 'percent' => 12, 'amount' => 12, 'base' => 'subtotal_sales', 'active' => true],
                    ['id' => 'markup_qa_safety', 'name' => 'Healthcare QA & Infection Control', 'type' => 'percentage', 'percent' => 3, 'amount' => 3, 'base' => 'subtotal_sales', 'active' => true]
                ],
                'postTaxMarkups' => []
            ],
            'notes' => [
                'scope' => 'Turnkey electrical scope for 9,200 sq ft Outpatient Healthcare Clinic. Includes 14 exam rooms, 2 minor procedure rooms, clinical lab, nurses station, clean utility, medication room, reception, and administrative offices. Compliance with NFPA 99 healthcare standards, isolated grounding, emergency backup, and cleanroom lighting.',
                'included' => [
                    'Medical-grade isolated ground wiring and dedicated branch circuits',
                    'Hospital-grade 20A tamper-resistant duplex and GFCI receptacles',
                    'Medical MC cable assemblies with conduit stub-ups to ceiling plenum',
                    '400A Essential Switchboard and Automatic Transfer Switch (ATS) connections',
                    'Cleanroom sealed LED troffers and 0-10V dimming daylight sensors',
                    'Dedicated circuits for lab freezers, autoclaves, and diagnostic ultrasound equipment',
                    'Nurse call and emergency code-blue empty conduit raceways with pull strings',
                    'Comprehensive circuit label engraving and certified ground continuity testing'
                ],
                'excluded' => [
                    'Procurement of specialized medical imaging equipment (CT, X-Ray, ultrasound by owner)',
                    'Nurse call head-end electronics and software commissioning (raceways only)',
                    'Server room active IT networking switches and fiber patch panels'
                ]
            ],
            'groups' => [
                [
                    'name' => 'Exam Room & Clinical Lighting',
                    'items' => [
                        ['cat_id' => 7258, 'qty' => 48, 'waste' => 0], // Troffer B Cleanroom LED
                        ['cat_id' => 7367, 'qty' => 26, 'waste' => 0], // Architectural Recessed C
                        ['cat_id' => 7362, 'qty' => 12, 'waste' => 0], // Combo Emergency Light & Exit
                        ['cat_id' => 7264, 'qty' => 14, 'waste' => 0], // Exit Sign X
                        ['cat_id' => 8593, 'qty' => 1,  'waste' => 0]  // Emergency Lighting Inverter System
                    ]
                ],
                [
                    'name' => 'Healthcare Lighting Controls',
                    'items' => [
                        ['cat_id' => 8605, 'qty' => 28, 'waste' => 0], // Occupancy Sensor Ceiling
                        ['cat_id' => 8606, 'qty' => 18, 'waste' => 0], // Wall Sensor Switch
                        ['cat_id' => 8613, 'qty' => 22, 'waste' => 0], // 0-10V Dimmer Switch
                        ['cat_id' => 8612, 'qty' => 12, 'waste' => 0], // Power Pack Controller
                        ['cat_id' => 7023, 'qty' => 1,  'waste' => 0]  // Lighting Control Panel
                    ]
                ],
                [
                    'name' => 'Emergency & Essential Distribution Gear',
                    'items' => [
                        ['cat_id' => 7089, 'qty' => 1, 'waste' => 0], // Main Disconnect 400A Nema 3R
                        ['cat_id' => 7087, 'qty' => 2, 'waste' => 0], // Surge Protector Device (SPD)
                        ['cat_id' => 7016, 'qty' => 2, 'waste' => 0], // Panel MCB Shunt Trip 100A
                        ['cat_id' => 7032, 'qty' => 1, 'waste' => 0], // Panel MCB Shunt Trip 225A
                        ['cat_id' => 7031, 'qty' => 1, 'waste' => 0], // Panel MCB Shunt Trip 400A
                        ['cat_id' => 8608, 'qty' => 2, 'waste' => 0]  // Battery Backup & Network Surge
                    ]
                ],
                [
                    'name' => 'Hospital-Grade Rough In & Devices',
                    'items' => [
                        ['cat_id' => 7563, 'qty' => 64, 'waste' => 0], // Receptacle 20A Surge Isolated Ground Hospital Grade
                        ['cat_id' => 7595, 'qty' => 36, 'waste' => 0], // Receptacle 20A Surge Hospital Grade
                        ['cat_id' => 7599, 'qty' => 45, 'waste' => 0], // Receptacle 20A Self-Grounding Hospital Grade
                        ['cat_id' => 7558, 'qty' => 24, 'waste' => 0], // GFCI Receptacle 20A
                        ['cat_id' => 7567, 'qty' => 90, 'waste' => 0], // Stainless Steel Wallplate 2-Gang
                        ['cat_id' => 7590, 'qty' => 30, 'waste' => 0], // Stainless Steel Wallplate 3-Gang
                        ['cat_id' => 7679, 'qty' => 110, 'waste' => 5] // 4" Sq Deep Box
                    ]
                ],
                [
                    'name' => 'Medical Assemblies & Branch Raceways',
                    'items' => [
                        ['cat_id' => 9112, 'qty' => 32, 'waste' => 0], // Duplex 20A w/ Box, Stub & Medical MC
                        ['cat_id' => 9114, 'qty' => 12, 'waste' => 0], // WP Duplex 20A w/ Box, Stub & Medical MC
                        ['cat_id' => 9116, 'qty' => 18, 'waste' => 0], // Counter Receptacle 20A w/ Medical MC
                        ['cat_id' => 8671, 'qty' => 1200, 'waste' => 8] // #12-2 Solid Armored MC Cable Hospital Rated
                    ]
                ],
                [
                    'name' => 'Overhead Branch Conduits (EMT)',
                    'items' => [
                        ['cat_id' => 8840, 'qty' => 380, 'waste' => 5], // 3/4" EMT w/ Pullstring
                        ['cat_id' => 8850, 'qty' => 560, 'waste' => 5], // 1/2" EMT w/ 3 #12 THHN
                        ['cat_id' => 8851, 'qty' => 480, 'waste' => 5], // 1/2" EMT w/ 4 #12 THHN
                        ['cat_id' => 8858, 'qty' => 340, 'waste' => 5]  // 3/4" EMT w/ 3 #12 THHN
                    ]
                ],
                [
                    'name' => 'Life Safety & Essential Feeders',
                    'items' => [
                        ['cat_id' => 8984, 'qty' => 110, 'waste' => 5], // 175A 4W w/ GND CU Feeder EMT
                        ['cat_id' => 8990, 'qty' => 140, 'waste' => 5], // 200A 4W w/ GND CU Feeder EMT
                        ['cat_id' => 8996, 'qty' => 160, 'waste' => 5]  // 225A 4W w/ GND CU Feeder EMT
                    ]
                ],
                [
                    'name' => 'Equipment Rental',
                    'items' => [
                        ['cat_id' => 8577, 'qty' => 2, 'waste' => 0]   // Equipment Rental (Weeks)
                    ]
                ]
            ]
        ],

        // -------------------------------------------------------------
        // TEMPLATE 3: Industrial Logistics & Warehouse
        // -------------------------------------------------------------
        [
            'code' => 'PRJ-TMPL-WAREH',
            'name' => 'Industrial Logistics & Warehouse Template',
            'template_name' => 'Industrial Logistics & Warehouse Template',
            'trade' => 'Electrical',
            'client' => 'Vanguard Logistics Park',
            'address' => '8800 Commerce Way',
            'city' => 'Jacksonville',
            'state' => 'FL',
            'zip' => '32818',
            'sqft' => 52000,
            'desc' => 'Industrial template for High-Bay Distribution Centers, Fulfillment Hubs, and Warehouse Logistics Facilities. Includes high-bay LED lighting with integral motion sensors, 480V 3-phase heavy distribution, dock levelers, forklift charging stations, and high-capacity feeders.',
            'settings' => [
                'marginMode' => 'margin',
                'assemblyExpansionPolicy' => 'CANONICAL',
                'globalLaborCost' => 88,
                'globalLaborSales' => 115,
                'globalLaborMargin' => 23.5,
                'taxes' => ['Materials' => 6.5, 'Labor' => 0.0, 'Equipment' => 6.5],
                'preTaxMarkups' => [
                    ['id' => 'markup_overhead', 'name' => 'Overhead', 'type' => 'percentage', 'percent' => 8, 'amount' => 8, 'base' => 'subtotal_sales', 'active' => true],
                    ['id' => 'markup_profit', 'name' => 'Profit', 'type' => 'percentage', 'percent' => 9, 'amount' => 9, 'base' => 'subtotal_sales', 'active' => true],
                    ['id' => 'markup_heavy_equip', 'name' => 'Heavy Equipment Factor', 'type' => 'percentage', 'percent' => 5, 'amount' => 5, 'base' => 'subtotal_sales', 'active' => true]
                ],
                'postTaxMarkups' => []
            ],
            'notes' => [
                'scope' => 'Electrical scope for 52,000 sq ft Industrial Logistics Warehouse. 30-foot clear height high-bay distribution space, 12 loading dock bays, battery charging zone for electric forklifts, administrative mezzanine offices, and secure perimeter trailer yard.',
                'included' => [
                    '1,200A 480V/277V 3-phase main switchgear distribution and CT metering',
                    '150kVA dry step-down transformer for 120/208V general convenience power',
                    'Industrial LED high bay luminaires with heavy-duty fixture hangers',
                    'Power drops to 12 dock levelers and automatic overhead sectional doors',
                    '480V 30A dedicated circuits for 8 forklift fast-chargers with safety disconnects',
                    'Heavy-duty safety disconnect switches (100A, 200A, 400A)',
                    'High-mast 35-foot steel yard lighting poles with high-wattage LED floodlights',
                    'Overhead rigid and EMT conduit raceways in high-ceiling open bays',
                    '45-foot boom lift rental for aerial conduit and fixture installation'
                ],
                'excluded' => [
                    'Conveyor automated sorting system VFD controllers (by material handling OEM)',
                    'Forklift charging units and battery rack stands (provided by fleet vendor)',
                    'Perimeter security optical CCTV cameras and card access turnstiles'
                ]
            ],
            'groups' => [
                [
                    'name' => 'High-Bay Warehouse Lighting',
                    'items' => [
                        ['cat_id' => 7400, 'qty' => 96, 'waste' => 0], // High Bay Fixture A
                        ['cat_id' => 7185, 'qty' => 96, 'waste' => 0], // Fixture Hanger 3/4" 12" Flexible
                        ['cat_id' => 7236, 'qty' => 6,  'waste' => 0], // Industrial Big Fan
                        ['cat_id' => 7362, 'qty' => 18, 'waste' => 0], // Combo Emergency Light & Exit
                        ['cat_id' => 7264, 'qty' => 20, 'waste' => 0]  // Exit Sign X
                    ]
                ],
                [
                    'name' => 'Warehouse Controls & Sensors',
                    'items' => [
                        ['cat_id' => 8605, 'qty' => 48, 'waste' => 0], // High-Bay Occupancy Sensor
                        ['cat_id' => 8600, 'qty' => 8,  'waste' => 0], // Daylight Harvesting Sensor
                        ['cat_id' => 7023, 'qty' => 2,  'waste' => 0], // Lighting Control Panel
                        ['cat_id' => 8591, 'qty' => 4,  'waste' => 0]  // Photocell Sensor
                    ]
                ],
                [
                    'name' => '480V Heavy Industrial Gear & Starters',
                    'items' => [
                        ['cat_id' => 7103, 'qty' => 1, 'waste' => 0], // Main Disconnect 1200A 208V
                        ['cat_id' => 7104, 'qty' => 2, 'waste' => 0], // Main Disconnect 800A 208V
                        ['cat_id' => 7090, 'qty' => 2, 'waste' => 0], // Main Disconnect 600A 208V
                        ['cat_id' => 7089, 'qty' => 4, 'waste' => 0], // Main Disconnect 400A Nema 3R
                        ['cat_id' => 7407, 'qty' => 2, 'waste' => 0], // Motor Starter FVR NEMA 4 Size 4
                        ['cat_id' => 7410, 'qty' => 4, 'waste' => 0], // Motor Starter FVNR 480V 10HP
                        ['cat_id' => 7411, 'qty' => 2, 'waste' => 0]  // Motor Starter FVNR 480V 25HP
                    ]
                ],
                [
                    'name' => 'Industrial Rough In & Power Drops',
                    'items' => [
                        ['cat_id' => 7679, 'qty' => 160, 'waste' => 5], // 4" Sq Deep Box
                        ['cat_id' => 7560, 'qty' => 90,  'waste' => 0], // Commercial Receptacle 20A
                        ['cat_id' => 7558, 'qty' => 40,  'waste' => 0], // GFCI Receptacle 20A
                        ['cat_id' => 7574, 'qty' => 16,  'waste' => 0], // Switch 4-way 20A Industrial Grade
                        ['cat_id' => 7761, 'qty' => 12,  'waste' => 0]  // 60A Disconnect NEMA 3R
                    ]
                ],
                [
                    'name' => 'High-Ceiling Overhead Conduits (EMT)',
                    'items' => [
                        ['cat_id' => 8840, 'qty' => 850,  'waste' => 5], // 3/4" EMT w/ Pullstring
                        ['cat_id' => 8841, 'qty' => 620,  'waste' => 5], // 1" EMT w/ Pullstring
                        ['cat_id' => 8842, 'qty' => 450,  'waste' => 5], // 1-1/4" EMT w/ Pullstring
                        ['cat_id' => 8844, 'qty' => 380,  'waste' => 5], // 2" EMT w/ Pullstring
                        ['cat_id' => 8857, 'qty' => 1200, 'waste' => 5], // 3/4" EMT w/ 2 #12 THHN
                        ['cat_id' => 8858, 'qty' => 980,  'waste' => 5]  // 3/4" EMT w/ 3 #12 THHN
                    ]
                ],
                [
                    'name' => 'Heavy Underground Conduits (PVC)',
                    'items' => [
                        ['cat_id' => 8896, 'qty' => 420, 'waste' => 5], // 2" Sch 40 PVC w/ Pullstring
                        ['cat_id' => 8898, 'qty' => 550, 'waste' => 5], // 3" Sch 40 PVC w/ Pullstring
                        ['cat_id' => 8900, 'qty' => 720, 'waste' => 5]  // 4" Sch 40 PVC w/ Pullstring
                    ]
                ],
                [
                    'name' => 'Heavy Industrial Feeders',
                    'items' => [
                        ['cat_id' => 9008, 'qty' => 220, 'waste' => 5], // 300A 4W w/ GND CU Feeder EMT
                        ['cat_id' => 9014, 'qty' => 260, 'waste' => 5], // 350A 4W w/ GND CU Feeder EMT
                        ['cat_id' => 9020, 'qty' => 310, 'waste' => 5], // 400A 4W w/ GND CU Feeder EMT
                        ['cat_id' => 9026, 'qty' => 280, 'waste' => 5]  // 450A 4W w/ GND 2x 2-1/2" EMT
                    ]
                ],
                [
                    'name' => 'Exterior High-Mast Yard Lighting',
                    'items' => [
                        ['cat_id' => 7251, 'qty' => 8, 'waste' => 0], // Lighting Pole 35' Steel
                        ['cat_id' => 7252, 'qty' => 6, 'waste' => 0], // Lighting Pole 30' Steel
                        ['cat_id' => 8604, 'qty' => 16, 'waste' => 0] // Wall Pack w/ Battery Backup
                    ]
                ],
                [
                    'name' => 'Heavy Equipment Rental',
                    'items' => [
                        ['cat_id' => 8577, 'qty' => 8, 'waste' => 0]  // Equipment Rental (Weeks)
                    ]
                ]
            ]
        ],

        // -------------------------------------------------------------
        // TEMPLATE 4: Multi-Family Residential Complex
        // -------------------------------------------------------------
        [
            'code' => 'PRJ-TMPL-MULTI',
            'name' => 'Multi-Family Residential Complex Template',
            'template_name' => 'Multi-Family Residential Complex Template',
            'trade' => 'Electrical',
            'client' => 'Suncoast Multi-Family Holdings',
            'address' => '1200 Palm Bay Loop',
            'city' => 'Fort Myers',
            'state' => 'FL',
            'zip' => '33901',
            'sqft' => 32500,
            'desc' => 'Estimating template for Multi-Family Residential Apartments and Condominiums. Standardized 24-unit scope with multi-meter center banks, apartment unit load centers, tamper-resistant residential rough-in, clubhouse architectural lighting, EV charging infrastructure, and site lighting.',
            'settings' => [
                'marginMode' => 'margin',
                'assemblyExpansionPolicy' => 'CANONICAL',
                'globalLaborCost' => 80,
                'globalLaborSales' => 105,
                'globalLaborMargin' => 23.8,
                'taxes' => ['Materials' => 6.5, 'Labor' => 0.0, 'Equipment' => 6.5],
                'preTaxMarkups' => [
                    ['id' => 'markup_overhead', 'name' => 'Overhead', 'type' => 'percentage', 'percent' => 10, 'amount' => 10, 'base' => 'subtotal_sales', 'active' => true],
                    ['id' => 'markup_profit', 'name' => 'Profit', 'type' => 'percentage', 'percent' => 11, 'amount' => 11, 'base' => 'subtotal_sales', 'active' => true]
                ],
                'postTaxMarkups' => []
            ],
            'notes' => [
                'scope' => 'Complete electrical estimating package for 24-unit Multi-Family Residential development. Two 12-unit two-story garden apartment buildings plus 2,500 sq ft Community Clubhouse, fitness suite, leasing office, swimming pool amenity deck, and EV charging stations.',
                'included' => [
                    'Two 12-gang tenant meter centers with 200A main disconnects',
                    '24 individual 125A 24-circuit apartment unit panelboards with AFCI/GFCI breakers',
                    'Apartment unit branch wiring: Decora switches, tamper-resistant USB outlets, LED downlights, ceiling fan rough-in',
                    'Clubhouse architectural lighting, dimming controls, and fitness room power',
                    'Resort-style pool deck power: sub-panel, underwater LED lighting, pump disconnects, timer controls',
                    'Underground PVC service laterals and site amenity electrical distribution',
                    'Four Level-2 dual-port EV charging station feeder circuits (50A 240V)',
                    'Decorative pedestrian and parking lot lighting poles with dusk-to-dawn controls'
                ],
                'excluded' => [
                    'Residential kitchen & laundry appliances (provided by appliance vendor)',
                    'Pool mechanical pump and filtration machinery (by pool contractor)',
                    'Individual tenant internet routers and cable TV equipment'
                ]
            ],
            'groups' => [
                [
                    'name' => 'Apartment Unit Interior Lighting',
                    'items' => [
                        ['cat_id' => 7258, 'qty' => 144, 'waste' => 0], // Recessed Downlight B
                        ['cat_id' => 7246, 'qty' => 48,  'waste' => 0], // Wall Sconce Light
                        ['cat_id' => 7367, 'qty' => 36,  'waste' => 0], // Decorative Pendant C
                        ['cat_id' => 7362, 'qty' => 16,  'waste' => 0], // Emergency Egress Corridor Light
                        ['cat_id' => 7264, 'qty' => 16,  'waste' => 0]  // Exit Sign X
                    ]
                ],
                [
                    'name' => 'Clubhouse & Amenity Lighting',
                    'items' => [
                        ['cat_id' => 7258, 'qty' => 32, 'waste' => 0], // Clubhouse Downlight B
                        ['cat_id' => 7240, 'qty' => 8,  'waste' => 0], // Track Lighting Install
                        ['cat_id' => 7238, 'qty' => 150,'waste' => 5], // LED Tape Lighting (ft)
                        ['cat_id' => 8605, 'qty' => 12, 'waste' => 0], // Restroom & Gym Occupancy Sensor
                        ['cat_id' => 8613, 'qty' => 8,  'waste' => 0]  // Dimmer Controls
                    ]
                ],
                [
                    'name' => 'Multi-Meter Centers & Unit Distribution',
                    'items' => [
                        ['cat_id' => 6920, 'qty' => 2,  'waste' => 0], // Meter Center 200A-400A (12-gang)
                        ['cat_id' => 7024, 'qty' => 2,  'waste' => 0], // Panelboard Medium 200A (House Service)
                        ['cat_id' => 7009, 'qty' => 24, 'waste' => 0], // Breaker 50/2 Double Pole (Range)
                        ['cat_id' => 7027, 'qty' => 24, 'waste' => 0], // Breaker 30/2 Double Pole (A/C & Water Heater)
                        ['cat_id' => 7018, 'qty' => 96, 'waste' => 0]  // GFCI Breaker 20/1 Single Pole
                    ]
                ],
                [
                    'name' => 'Residential Rough In & Devices',
                    'items' => [
                        ['cat_id' => 7578, 'qty' => 280, 'waste' => 0], // Decora Duplex Receptacle 20A Grounded
                        ['cat_id' => 7558, 'qty' => 72,  'waste' => 0], // GFCI Receptacle 20A (Kitchen/Bath)
                        ['cat_id' => 7557, 'qty' => 48,  'waste' => 0], // USB Duplex Receptacle
                        ['cat_id' => 7636, 'qty' => 96,  'waste' => 0], // Single Pole Switch 20A
                        ['cat_id' => 7565, 'qty' => 60,  'waste' => 0], // Decora Switch Plate Plastic 3-Gang
                        ['cat_id' => 7572, 'qty' => 120, 'waste' => 0], // Switch Wallplate 1-Gang Plastic
                        ['cat_id' => 7573, 'qty' => 140, 'waste' => 0], // Duplex Receptacle Wallplate 2-Gang
                        ['cat_id' => 7679, 'qty' => 220, 'waste' => 5]  // 4" Sq Deep Box
                    ]
                ],
                [
                    'name' => 'Common Corridor & Riser Conduits (EMT)',
                    'items' => [
                        ['cat_id' => 8840, 'qty' => 520, 'waste' => 5], // 3/4" EMT w/ Pullstring
                        ['cat_id' => 8849, 'qty' => 750, 'waste' => 5], // 1/2" EMT w/ 2 #12 THHN
                        ['cat_id' => 8850, 'qty' => 680, 'waste' => 5], // 1/2" EMT w/ 3 #12 THHN
                        ['cat_id' => 8857, 'qty' => 480, 'waste' => 5]  // 3/4" EMT w/ 2 #12 THHN
                    ]
                ],
                [
                    'name' => 'Residential Feeders to Unit Panels',
                    'items' => [
                        ['cat_id' => 8980, 'qty' => 480, 'waste' => 5], // 150A 4W w/ GND CU Feeder (PVC)
                        ['cat_id' => 8984, 'qty' => 360, 'waste' => 5], // 175A 4W w/ GND CU Feeder (EMT)
                        ['cat_id' => 8990, 'qty' => 240, 'waste' => 5]  // 200A 4W w/ GND CU Feeder (EMT)
                    ]
                ],
                [
                    'name' => 'Underground Amenity & Site Conduits (PVC)',
                    'items' => [
                        ['cat_id' => 8892, 'qty' => 420, 'waste' => 5], // 3/4" Sch 40 PVC w/ Pullstring
                        ['cat_id' => 8893, 'qty' => 350, 'waste' => 5], // 1" Sch 40 PVC w/ Pullstring
                        ['cat_id' => 8895, 'qty' => 280, 'waste' => 5], // 1-1/2" Sch 40 PVC w/ Pullstring
                        ['cat_id' => 8898, 'qty' => 310, 'waste' => 5]  // 3" Sch 40 PVC w/ Pullstring
                    ]
                ],
                [
                    'name' => 'EV Charging Stations & Pool Power',
                    'items' => [
                        ['cat_id' => 7020, 'qty' => 4,  'waste' => 0], // Breaker 50/2 Double Pole (EV Chargers)
                        ['cat_id' => 7753, 'qty' => 6,  'waste' => 0], // Disconnect 30A NEMA 3R (Pool Pumps)
                        ['cat_id' => 7014, 'qty' => 2,  'waste' => 0], // Timer Switch Pool Controls
                        ['cat_id' => 8856, 'qty' => 320, 'waste' => 5]  // 1/2" EMT w/ 3 #10 THHN (EV Circuit)
                    ]
                ],
                [
                    'name' => 'Site & Parking Lot Lighting',
                    'items' => [
                        ['cat_id' => 7250, 'qty' => 12, 'waste' => 0], // Lighting Pole 12' Galvanized
                        ['cat_id' => 7249, 'qty' => 6,  'waste' => 0], // Lighting Pole 16' Galvanized
                        ['cat_id' => 8591, 'qty' => 3,  'waste' => 0]  // Photocell Sensor
                    ]
                ],
                [
                    'name' => 'Equipment Rental',
                    'items' => [
                        ['cat_id' => 8577, 'qty' => 3,  'waste' => 0]  // Equipment Rental (Weeks)
                    ]
                ]
            ]
        ]
    ];

    $createdProjects = [];

    // Prepared statements for insertion
    $insertTemplateStmt = $pdo->prepare("
        INSERT INTO project_templates (name, description, trade, settings_json, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, NOW(), NOW())
    ");

    $insertProjectStmt = $pdo->prepare("
        INSERT INTO projects (
            project_template_id, project_number, name, description, status,
            client_name, job_address, city, state, postal_code, country,
            bid_due_at, metadata_json, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, 'to_do',
            ?, ?, ?, ?, ?, 'US',
            DATE_ADD(NOW(), INTERVAL 14 DAY), ?, NOW(), NOW()
        )
    ");

    $insertEstimateStmt = $pdo->prepare("
        INSERT INTO estimates (
            project_id, estimate_number, name, description, status,
            currency_code, subtotal_cost, total_cost, settings_json, notes_json,
            created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, 'approved',
            'USD', ?, ?, ?, ?,
            NOW(), NOW()
        )
    ");

    $insertItemStmt = $pdo->prepare("
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

    $insertWsStmt = $pdo->prepare("
        INSERT INTO estimate_workspace_states (
            estimate_id, project_id, client_estimate_id, state_json, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, NOW(), NOW())
    ");

    foreach ($templatesConfig as $cfg) {
        echo "\n-----------------------------------------------------------------\n";
        echo "Creating Template Project: {$cfg['name']} ({$cfg['code']})\n";

        // 1. Create or get Project Template
        $stmt = $pdo->prepare("SELECT id FROM project_templates WHERE name = ? AND deleted_at IS NULL LIMIT 1");
        $stmt->execute([$cfg['template_name']]);
        $templateId = $stmt->fetchColumn();

        if (!$templateId) {
            $insertTemplateStmt->execute([
                $cfg['template_name'],
                $cfg['desc'],
                $cfg['trade'],
                json_encode([
                    'default_status' => 'to_do',
                    'trade' => $cfg['trade'],
                    'square_footage' => $cfg['sqft']
                ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            ]);
            $templateId = (int)$pdo->lastInsertId();
            echo "  + Created Project Template ID: $templateId\n";
        } else {
            echo "  = Found Existing Project Template ID: $templateId\n";
        }

        // 2. Ensure unique project number
        $projNum = $cfg['code'];
        $chk = $pdo->prepare("SELECT id FROM projects WHERE project_number = ? AND deleted_at IS NULL LIMIT 1");
        $chk->execute([$projNum]);
        if ($chk->fetchColumn()) {
            $projNum = $cfg['code'] . '-' . date('Ymd-His');
        }

        // 3. Insert Project
        $metaJson = json_encode([
            'estimator' => 'Juan Estevez',
            'measurement_system' => 'US',
            'estimate_pricing' => 'Unlocked',
            'is_template' => true,
            'template_type' => strtolower(str_replace(' ', '_', $cfg['name'])),
            'square_footage' => $cfg['sqft'],
            'client_name' => $cfg['client']
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $insertProjectStmt->execute([
            $templateId,
            $projNum,
            $cfg['name'],
            $cfg['desc'],
            $cfg['client'],
            $cfg['address'],
            $cfg['city'],
            $cfg['state'],
            $cfg['zip'],
            $metaJson
        ]);
        $projectId = (int)$pdo->lastInsertId();
        echo "  + Created Project ID: $projectId (Number: $projNum)\n";

        // 4. Create primary estimate in estimates table
        $estNumber = $projNum . '-EST1';
        $estName = $cfg['name'] . ' Baseline';
        $estDesc = 'Authoritative baseline estimate for ' . $cfg['name'];

        $insertEstimateStmt->execute([
            $projectId,
            $estNumber,
            $estName,
            $estDesc,
            0.0, // will update with calculated subtotal
            0.0, // will update with calculated total
            json_encode($cfg['settings'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            json_encode($cfg['notes'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        ]);
        $estimateDbId = (int)$pdo->lastInsertId();
        echo "  + Created Estimate DB ID: $estimateDbId (Number: $estNumber)\n";

        // 5. Build Workspace Groups, Items & Assemblies
        $workspaceGroups = [];
        $totalItemsCount = 0;
        $totalAssemblyChildrenCount = 0;
        $directSubtotalCost = 0.0;
        $directLaborHours = 0.0;

        $globalLaborRate = (float)$cfg['settings']['globalLaborCost'];

        $groupIndex = 0;
        foreach ($cfg['groups'] as $gDef) {
            $groupId = 'group_' . substr(md5($projectId . '_' . $gDef['name'] . '_' . $groupIndex), 0, 8);
            $wGroup = [
                'id' => $groupId,
                'name' => $gDef['name'],
                'expanded' => true,
                'source' => 'manual',
                'sortOrder' => $groupIndex,
                'items' => []
            ];

            $itemIndex = 0;
            foreach ($gDef['items'] as $itemSpec) {
                $catId = $itemSpec['cat_id'];
                $cat = $getCatItem($catId);
                if (!$cat) {
                    echo "    ! Warning: Catalog item $catId not found. Skipping.\n";
                    continue;
                }

                $qty = (float)$itemSpec['qty'];
                $itemWaste = (float)($itemSpec['waste'] ?? 0);
                $itemId = 'item_' . substr(md5($projectId . '_' . $catId . '_' . $gDef['name'] . '_' . $itemIndex), 0, 10);

                $unitCost = (float)$cat['unit_cost'];
                $laborHours = (float)$cat['labor_hours'];
                $materialCost = (float)$cat['material_cost'] > 0 ? (float)$cat['material_cost'] : $unitCost;
                $laborCost = (float)$cat['labor_cost'];
                $equipmentCost = (float)$cat['equipment_cost'];
                $subcontractorCost = (float)$cat['subcontractor_cost'];
                $uom = $cat['unit_of_measure'] ?: 'ea';
                $itemType = in_array($cat['item_type'], ['assembly', 'labor', 'equipment', 'subcontractor', 'material']) ? $cat['item_type'] : 'part';
                $isAssembly = ($itemType === 'assembly');

                // Check and hydrate assembly children from assembly_parts
                $children = [];
                $assemblyPartsList = [];
                if ($isAssembly) {
                    $dbParts = $getAssemblyParts($catId);
                    foreach ($dbParts as $p) {
                        $childId = 'comp_' . substr(md5($itemId . '_' . $p['part_id'] . '_' . $p['assembly_part_id']), 0, 10);
                        $childUnitCost = (float)$p['unit_cost'];
                        $childMatCost = (float)$p['material_cost'] > 0 ? (float)$p['material_cost'] : $childUnitCost;
                        $childLabor = (float)$p['labor_hours'];
                        $childQty = (float)$p['quantity'];
                        $childWaste = (float)$p['waste_factor_percent'];

                        $childItem = [
                            'id' => $childId,
                            'parentItemId' => $itemId,
                            'catalogItemId' => (int)$p['part_id'],
                            'name' => $p['name'],
                            'description' => $p['description'] ?? '',
                            'quantity' => $childQty,
                            'originalQuantity' => $childQty,
                            'ratioType' => $p['ratio_type'] ?: 'per_unit',
                            'uom' => $p['unit_of_measure'] ?: 'ea',
                            'unitCost' => $childUnitCost,
                            'unitMaterialCost' => $childMatCost,
                            'waste' => $childWaste,
                            'unitLabor' => $childLabor,
                            'laborRate' => $globalLaborRate
                        ];
                        $children[] = $childItem;
                        $assemblyPartsList[] = [
                            'catalogItemId' => (int)$p['part_id'],
                            'name' => $p['name'],
                            'quantity' => $childQty,
                            'uom' => $p['unit_of_measure'] ?: 'ea',
                            'pricing' => [
                                'materialUnitCost' => $childMatCost,
                                'laborHoursPerUnit' => $childLabor,
                                'laborRate' => $globalLaborRate
                            ]
                        ];
                        $totalAssemblyChildrenCount++;
                    }
                }

                $catalogSnapshot = [
                    'id' => (int)$cat['id'],
                    'catalog_id' => (int)($cat['catalog_id'] ?? 7),
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
                    'type' => $itemType,
                    'cost_type' => $cat['cost_type'] ?: 'Materials',
                    'components' => $children,
                    'assemblyComponents' => $assemblyPartsList
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
                    'isAssembly' => $isAssembly,
                    'uom' => $uom,
                    'quantity' => $qty,
                    'originalQuantity' => $qty,
                    'quantitySource' => 'manual',
                    'quantitySyncStatus' => 'manual',
                    'unitMaterialCost' => $materialCost,
                    'waste' => $itemWaste,
                    'materialMargin' => 0,
                    'unitLabor' => $laborHours,
                    'laborRate' => $globalLaborRate,
                    'laborMargin' => 0,
                    'difficulty' => 1,
                    'unitEquipmentCost' => $equipmentCost,
                    'unitSubcontractorCost' => $subcontractorCost,
                    'taxable' => true,
                    'catalogSnapshot' => $catalogSnapshot,
                    'children' => $children
                ];

                $wGroup['items'][] = $wItem;

                // Accumulate direct costs for estimate totals
                $itemMaterialTotal = $qty * $materialCost * (1 + $itemWaste / 100);
                $itemLaborHoursTotal = $qty * $laborHours;
                $directSubtotalCost += $itemMaterialTotal + ($itemLaborHoursTotal * $globalLaborRate) + ($qty * $equipmentCost) + ($qty * $subcontractorCost);
                $directLaborHours += $itemLaborHoursTotal;

                // Mirror into estimate_items relational table
                $insertItemStmt->execute([
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
                    json_encode([
                        'catalogSnapshot' => $catalogSnapshot,
                        'children' => $children,
                        'waste' => $itemWaste,
                        'laborRate' => $globalLaborRate
                    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
                ]);

                $totalItemsCount++;
                $itemIndex++;
            }

            $workspaceGroups[] = $wGroup;
            $groupIndex++;
        }

        // 6. Calculate Estimate Subtotal and Estimate Total (including markups & taxes)
        // Markups calculation
        $preTaxMarkupsTotal = 0.0;
        foreach ($cfg['settings']['preTaxMarkups'] as $mk) {
            if (!empty($mk['active'])) {
                $preTaxMarkupsTotal += ($directSubtotalCost * ((float)$mk['percent'] / 100));
            }
        }
        $materialTaxPercent = (float)($cfg['settings']['taxes']['Materials'] ?? 7.0);
        $taxTotal = ($directSubtotalCost * 0.5) * ($materialTaxPercent / 100); // estimated tax on materials
        $grandTotalCost = $directSubtotalCost + $preTaxMarkupsTotal + $taxTotal;

        // Update estimates table with real totals
        $updEst = $pdo->prepare("UPDATE estimates SET subtotal_cost = ?, total_cost = ? WHERE id = ?");
        $updEst->execute([round($directSubtotalCost, 2), round($grandTotalCost, 2), $estimateDbId]);

        // Update project metadata with primary estimate ID and total
        $metaArr = json_decode($metaJson, true);
        $metaArr['primary_estimate_id'] = $estimateDbId;
        $metaArr['primary_estimate_total'] = round($grandTotalCost, 2);
        $metaArr['primary_quote_value'] = round($grandTotalCost, 2);
        $updProj = $pdo->prepare("UPDATE projects SET metadata_json = ? WHERE id = ?");
        $updProj->execute([json_encode($metaArr, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $projectId]);

        // 7. Insert into estimate_workspace_states
        $clientEstimateId = 'estimate_' . strtolower(str_replace(['PRJ-TMPL-', '-'], ['', '_'], $cfg['code'])) . '_' . $projectId;
        $stateJson = [
            'id' => $clientEstimateId,
            'dbEstimateId' => $estimateDbId,
            'estimateItemId' => $estimateDbId,
            'projectId' => $projectId,
            'name' => $estName,
            'code' => $estNumber,
            'status' => 'approved',
            'is_primary' => true,
            'isPrimary' => true,
            'isActive' => true,
            'isPinned' => true,
            'revision' => 1,
            'estimateRevision' => 1,
            'creationMode' => 'primary',
            'takeoffSyncMode' => 'mirror',
            'createdAt' => date('c'),
            'updatedAt' => date('c'),
            'groups' => $workspaceGroups,
            'notes' => $cfg['notes'],
            'settings' => $cfg['settings'],
            'auditLog' => [
                [
                    'timestamp' => date('c'),
                    'user' => 'Juan Estevez',
                    'action' => 'Template Baseline Initialized',
                    'details' => "Template created with " . count($workspaceGroups) . " groups and {$totalItemsCount} catalog items."
                ]
            ]
        ];

        $insertWsStmt->execute([
            $estimateDbId,
            $projectId,
            $clientEstimateId,
            json_encode($stateJson, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        ]);

        $createdProjects[] = [
            'id' => $projectId,
            'number' => $projNum,
            'name' => $cfg['name'],
            'sqft' => $cfg['sqft'],
            'groups_count' => count($workspaceGroups),
            'items_count' => $totalItemsCount,
            'assembly_children_count' => $totalAssemblyChildrenCount,
            'direct_subtotal' => round($directSubtotalCost, 2),
            'grand_total' => round($grandTotalCost, 2),
            'price_per_sqft' => round($grandTotalCost / $cfg['sqft'], 2),
            'url' => "pages/project_dashboard.php?id=$projectId"
        ];

        echo "  + Workspace State Seeded: $clientEstimateId\n";
        echo "  + Groups: " . count($workspaceGroups) . " | Root Items: $totalItemsCount | Assembly Components: $totalAssemblyChildrenCount\n";
        echo "  + Subtotal: \$" . number_format($directSubtotalCost, 2) . " | Total: \$" . number_format($grandTotalCost, 2) . " (\$" . number_format($grandTotalCost / $cfg['sqft'], 2) . "/sq ft)\n";
    }

    $pdo->commit();

    echo "\n=================================================================\n";
    echo "SUCCESS: ALL 4 TEMPLATE PROJECTS CREATED SUCCESSFULLY!\n";
    echo "=================================================================\n";
    foreach ($createdProjects as $p) {
        echo "Project [{$p['id']}] {$p['number']} - {$p['name']}\n";
        echo "  Sq Ft: " . number_format($p['sqft']) . " | Total: \$" . number_format($p['grand_total'], 2) . " (\$" . $p['price_per_sqft'] . "/sq ft)\n";
        echo "  Groups: {$p['groups_count']} | Items: {$p['items_count']} | Assembly Children: {$p['assembly_children_count']}\n";
        echo "  URL: {$p['url']}\n\n";
    }

} catch (\Throwable $e) {
    $pdo->rollBack();
    echo "\nFATAL ERROR DURING CREATION:\n" . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
    exit(1);
}

