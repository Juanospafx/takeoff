<?php
/**
 * Database Seed: Assemblies 2027 Brightronix Cost Catalog
 *
 * Preflight: php db/seed_assemblies_2027.php --check
 * Apply:     php db/seed_assemblies_2027.php --apply
 *
 * Rollback: all writes are enclosed in one transaction and are rolled back on
 * abnormal termination. Restore the pre-run database backup to reverse a
 * successfully committed seed.
 *
 * Creates or updates all assemblies across:
 * - Assemblies EMT (Group 36)
 * - Assemblies PVC (Group 37)
 * - Assemblies Feeders (Group 38)
 * - Assemblies Rough In (Group 40)
 * - Assemblies Low Voltage (Group 42)
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$mode = $argv[1] ?? '';
if (!in_array($mode, ['--check', '--apply'], true)) {
    fwrite(STDERR, "Usage: php db/seed_assemblies_2027.php --check|--apply\n");
    exit(2);
}

require_once __DIR__ . '/../core/db/connection.php';

echo "========================================================\n";
echo " SEEDING ASSEMBLIES FOR 2027 BRIGHTRONIX COST CATALOG\n";
echo "========================================================\n\n";

// 1. Locate Target Catalog
$targetCatalogName = '2027 Brightronix Cost Catalog';
$stmt = $pdo->prepare("SELECT id, name FROM catalogs WHERE name = ? AND deleted_at IS NULL");
$stmt->execute([$targetCatalogName]);
$catalog = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$catalog) {
    fwrite(STDERR, "Error: Target catalog '2027 Brightronix Cost Catalog' was not found.\n");
    exit(1);
}
$catalogId = (int)$catalog['id'];
echo "Target Catalog: '{$catalog['name']}' (ID: $catalogId)\n\n";

if ($stmt->fetch(PDO::FETCH_ASSOC)) {
    fwrite(STDERR, "Error: More than one active target catalog has the exact canonical name.\n");
    exit(1);
}

if ($mode === '--check') {
    $groupCount = $pdo->prepare("SELECT COUNT(*) FROM catalog_groups WHERE catalog_id = ? AND deleted_at IS NULL");
    $groupCount->execute([$catalogId]);
    $itemCount = $pdo->prepare("SELECT COUNT(*) FROM catalog_items WHERE catalog_id = ? AND deleted_at IS NULL");
    $itemCount->execute([$catalogId]);
    echo "CHECK_ONLY: target exists; current groups=" . (int)$groupCount->fetchColumn()
        . ", current items=" . (int)$itemCount->fetchColumn() . ". No writes performed.\n";
    exit(0);
}

$pdo->beginTransaction();
register_shutdown_function(static function () use ($pdo): void {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
});

// 2. Ensure / Retrieve Groups
$targetGroups = [
    'Assemblies EMT'             => ['desc' => 'Overhead Branch EMT conduit assemblies with pullstring and THHN wires'],
    'Assemblies PVC'             => ['desc' => 'Underground / Branch PVC Schedule 40 & 80 conduit assemblies'],
    'Assemblies Feeders'         => ['desc' => 'Commercial power feeders by amperage in EMT, PVC 40 & 80 (CU & ALU)'],
    'Assemblies Controls'        => ['desc' => 'Control wiring and automation assemblies'],
    'Assemblies Rough In'        => ['desc' => 'Terminal device rough-in kits (receptacles, switches, boxes, medical MC)'],
    'Assemblies Fire Alarm'      => ['desc' => 'Fire alarm notification, initiating and circuit assemblies'],
    'Assemblies Low Voltage'     => ['desc' => 'Low voltage structured cabling, TV boxes & mounts assemblies'],
    'Assemblies Temporary Power' => ['desc' => 'Temporary jobsite power and lighting assemblies']
];

$groupMap = [];
$groupStmt = $pdo->prepare("SELECT id, name FROM catalog_groups WHERE catalog_id = ? AND deleted_at IS NULL");
$groupStmt->execute([$catalogId]);
while ($g = $groupStmt->fetch(PDO::FETCH_ASSOC)) {
    $groupMap[$g['name']] = (int)$g['id'];
}

$sortOrder = 500;
foreach ($targetGroups as $gName => $meta) {
    if (!isset($groupMap[$gName])) {
        $ins = $pdo->prepare("INSERT INTO catalog_groups (catalog_id, name, description, sort_order, active, enabled_for_projects) VALUES (?, ?, ?, ?, 1, 1)");
        $ins->execute([$catalogId, $gName, $meta['desc'], $sortOrder++]);
        $newGid = (int)$pdo->lastInsertId();
        $groupMap[$gName] = $newGid;
        echo "[GROUP CREATED] $gName (ID: $newGid)\n";
    }
}

// 3. Pre-load all non-assembly catalog items for high-performance lookup
$rawItems = $pdo->query("SELECT id, name, unit_of_measure, unit_cost, labor_hours FROM catalog_items WHERE catalog_id = $catalogId AND item_type != 'assembly' AND deleted_at IS NULL")->fetchAll(PDO::FETCH_ASSOC);

$itemIndex = [];
foreach ($rawItems as $it) {
    $normalized = strtolower(preg_replace('/\s+/', ' ', trim($it['name'])));
    $itemIndex[$normalized] = $it;
}

function getItem(string $search, array &$itemIndex, array &$rawItems): ?array {
    $norm = strtolower(preg_replace('/\s+/', ' ', trim($search)));
    if (isset($itemIndex[$norm])) return $itemIndex[$norm];

    // Fallback: match without case / substring
    foreach ($rawItems as $it) {
        $candidate = strtolower(preg_replace('/\s+/', ' ', trim($it['name'])));
        if ($candidate === $norm) return $it;
    }
    foreach ($rawItems as $it) {
        if (stripos($it['name'], $search) !== false) return $it;
    }
    return null;
}

// Helper to save or update an assembly and its components
$stats = [
    'created' => 0,
    'updated' => 0,
    'parts_linked' => 0
];

function persistAssembly(PDO $pdo, int $catalogId, int $groupId, string $name, string $uom, string $measurementType, array $components, array &$stats): int {
    // Check if assembly already exists
    $find = $pdo->prepare("SELECT id FROM catalog_items WHERE catalog_id = ? AND catalog_group_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1");
    $find->execute([$catalogId, $groupId, $name]);
    $existingId = $find->fetchColumn();

    if ($existingId) {
        $assemblyId = (int)$existingId;
        $upd = $pdo->prepare("UPDATE catalog_items SET item_type = 'assembly', unit_of_measure = ?, measurement_type = ?, active = 1, updated_at = NOW() WHERE id = ?");
        $upd->execute([$uom, $measurementType, $assemblyId]);
        $stats['updated']++;
    } else {
        $ins = $pdo->prepare("INSERT INTO catalog_items (catalog_id, cost_catalog_id, catalog_group_id, name, item_type, cost_type, unit_of_measure, measurement_type, unit_cost, labor_hours, active, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 'assembly', 'Material', ?, ?, 0.00, 0.00, 1, 1, NOW(), NOW())");
        $ins->execute([$catalogId, $catalogId, $groupId, $name, $uom, $measurementType]);
        $assemblyId = (int)$pdo->lastInsertId();
        $stats['created']++;
    }

    // Replace assembly parts cleanly
    $pdo->prepare("DELETE FROM assembly_parts WHERE assembly_catalog_item_id = ?")->execute([$assemblyId]);

    $totalCost = 0.0;
    $totalLabor = 0.0;
    $sort = 0;

    $partIns = $pdo->prepare("INSERT INTO assembly_parts (assembly_catalog_item_id, part_catalog_item_id, quantity, ratio_type, unit_cost_snapshot, unit_labor_time_snapshot, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)");

    foreach ($components as $c) {
        $item = $c['item'];
        $qty = (float)$c['quantity'];
        $ratioType = $c['ratio_type'] ?? ($measurementType === 'linear' ? 'per_linear_length' : 'per_unit');
        $unitCost = (float)$item['unit_cost'];
        $laborHours = (float)$item['labor_hours'];

        $partIns->execute([$assemblyId, (int)$item['id'], $qty, $ratioType, $unitCost, $laborHours, $sort++]);
        $stats['parts_linked']++;

        $totalCost += ($qty * $unitCost);
        $totalLabor += ($qty * $laborHours);
    }

    // Update calculated totals on parent assembly
    $recalc = $pdo->prepare("UPDATE catalog_items SET unit_cost = ?, labor_hours = ? WHERE id = ?");
    $recalc->execute([round($totalCost, 4), round($totalLabor, 4), $assemblyId]);

    return $assemblyId;
}

// =========================================================================
// 1. GENERATE ASSEMBLIES EMT (Group 36)
// =========================================================================
echo "--------------------------------------------------------\n";
echo " 1. Generating Assemblies EMT...\n";
echo "--------------------------------------------------------\n";

$emtGroupId = $groupMap['Assemblies EMT'];
$emtDiameters = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"', '3-1/2"', '4"'];
$pullstring = getItem('Pullstring', $itemIndex, $rawItems);

// 1.A. Pullstring for all diameters (1/2" to 4")
foreach ($emtDiameters as $d) {
    $conduit = getItem("$d EMT Conduit", $itemIndex, $rawItems);
    $strap   = getItem("$d Steel One Hole Strap, EMT", $itemIndex, $rawItems) ?? getItem("$d Two Hole Steel Strap, EMT", $itemIndex, $rawItems);
    $coup    = getItem("$d Set Screw Steel Coupling, EMT", $itemIndex, $rawItems);
    $conn    = getItem("$d Steel Set Screw Connector, EMT", $itemIndex, $rawItems);
    $elbow   = getItem("$d EMT 90 Degree Elbow", $itemIndex, $rawItems);

    $comps = [];
    if ($conduit) $comps[] = ['item' => $conduit, 'quantity' => 1.0];
    if ($strap)   $comps[] = ['item' => $strap, 'quantity' => 0.10];
    if ($coup)    $comps[] = ['item' => $coup, 'quantity' => 0.10];
    if ($conn)    $comps[] = ['item' => $conn, 'quantity' => 0.02];
    if ($elbow)   $comps[] = ['item' => $elbow, 'quantity' => 0.02];
    if ($pullstring) $comps[] = ['item' => $pullstring, 'quantity' => 1.10];

    $name = "$d EMT Conduit, Overhead Branch, w/ Pullstring";
    persistAssembly($pdo, $catalogId, $emtGroupId, $name, 'ft', 'linear', $comps, $stats);
}

// 1.B. Wires in EMT
$wireRulesEMT = [
    '1/2"' => [
        ['gauge' => '12', 'min' => 2, 'max' => 7],
        ['gauge' => '10', 'min' => 2, 'max' => 3]
    ],
    '3/4"' => [
        ['gauge' => '12', 'min' => 2, 'max' => 9],
        ['gauge' => '10', 'min' => 2, 'max' => 7],
        ['gauge' => '8',  'min' => 2, 'max' => 4]
    ],
    '1"' => [
        ['gauge' => '10', 'min' => 3, 'max' => 9],
        ['gauge' => '8',  'min' => 2, 'max' => 7],
        ['gauge' => '6',  'min' => 2, 'max' => 5]
    ]
];

foreach ($wireRulesEMT as $d => $rules) {
    $conduit = getItem("$d EMT Conduit", $itemIndex, $rawItems);
    $strap   = getItem("$d Steel One Hole Strap, EMT", $itemIndex, $rawItems);
    $coup    = getItem("$d Set Screw Steel Coupling, EMT", $itemIndex, $rawItems);
    $conn    = getItem("$d Steel Set Screw Connector, EMT", $itemIndex, $rawItems);
    $elbow   = getItem("$d EMT 90 Degree Elbow", $itemIndex, $rawItems);

    foreach ($rules as $rule) {
        $g = $rule['gauge'];
        $wire = getItem("#$g Type THHN 600 Volt Stranded Copper Building Wire", $itemIndex, $rawItems);

        for ($count = $rule['min']; $count <= $rule['max']; $count++) {
            $comps = [];
            if ($conduit) $comps[] = ['item' => $conduit, 'quantity' => 1.0];
            if ($strap)   $comps[] = ['item' => $strap, 'quantity' => 0.10];
            if ($coup)    $comps[] = ['item' => $coup, 'quantity' => 0.10];
            if ($conn)    $comps[] = ['item' => $conn, 'quantity' => 0.02];
            if ($elbow)   $comps[] = ['item' => $elbow, 'quantity' => 0.02];
            if ($wire)    $comps[] = ['item' => $wire, 'quantity' => round($count * 1.10, 4)];

            $name = "$d EMT Conduit, Overhead Branch, w/ $count #$g THHN Wires";
            persistAssembly($pdo, $catalogId, $emtGroupId, $name, 'ft', 'linear', $comps, $stats);
        }
    }
}
echo "Assemblies EMT complete.\n";

// =========================================================================
// 2. GENERATE ASSEMBLIES PVC (Group 37) - Schedule 40 & Schedule 80
// =========================================================================
echo "--------------------------------------------------------\n";
echo " 2. Generating Assemblies PVC (Sch 40 & Sch 80)...\n";
echo "--------------------------------------------------------\n";

$pvcGroupId = $groupMap['Assemblies PVC'];
$pvcSchedules = [
    'Sch 40' => [
        'name_pattern' => 'Schedule 40 PVC Conduit, 10\' Lengths With Coupling',
        'elbow_pattern' => '90 Degree Schedule 40 Pvc Elbows',
        'label' => 'Sch 40'
    ],
    'Sch 80' => [
        'name_pattern' => 'Schedule 80 Heavy Wall Pvc Conduit, 10\' Lengths With Coupling',
        'elbow_pattern' => '90 Degree Schedule 80 Pvc Elbows',
        'label' => 'Sch 80'
    ]
];

$wireRulesPVC = [
    '1/2"' => [
        ['gauge' => '12', 'min' => 2, 'max' => 5], // 7 - 2 = 5
        ['gauge' => '10', 'min' => 2, 'max' => 2]  // 3 - 2 = 1, but min 2 conductors
    ],
    '3/4"' => [
        ['gauge' => '12', 'min' => 2, 'max' => 7], // 9 - 2 = 7
        ['gauge' => '10', 'min' => 2, 'max' => 5], // 7 - 2 = 5
        ['gauge' => '8',  'min' => 2, 'max' => 2]  // 4 - 2 = 2
    ],
    '1"' => [
        ['gauge' => '10', 'min' => 3, 'max' => 7], // 9 - 2 = 7
        ['gauge' => '8',  'min' => 2, 'max' => 5], // 7 - 2 = 5
        ['gauge' => '6',  'min' => 2, 'max' => 3]  // 5 - 2 = 3
    ]
];

foreach ($pvcSchedules as $schKey => $sch) {
    // 2.A. Pullstring (1/2" to 4")
    foreach ($emtDiameters as $d) {
        $conduit = getItem("$d {$sch['name_pattern']}", $itemIndex, $rawItems);
        $elbow   = getItem("$d {$sch['elbow_pattern']}", $itemIndex, $rawItems);

        // Waste factor: 1.05 for <1", 1.10 for >= 1-1/4"
        $isLarger = in_array($d, ['1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"', '3-1/2"', '4"'], true);
        $conduitRatio = $isLarger ? 1.10 : 1.05;

        $comps = [];
        if ($conduit) $comps[] = ['item' => $conduit, 'quantity' => $conduitRatio];
        if ($elbow)   $comps[] = ['item' => $elbow, 'quantity' => 0.02];
        if ($pullstring) $comps[] = ['item' => $pullstring, 'quantity' => 1.10];

        $name = "$d {$sch['label']} PVC Conduit, With Coupling, w/ Pullstring";
        persistAssembly($pdo, $catalogId, $pvcGroupId, $name, 'ft', 'linear', $comps, $stats);
    }

    // 2.B. Cables THHN
    foreach ($wireRulesPVC as $d => $rules) {
        $conduit = getItem("$d {$sch['name_pattern']}", $itemIndex, $rawItems);
        $elbow   = getItem("$d {$sch['elbow_pattern']}", $itemIndex, $rawItems);
        $isLarger = in_array($d, ['1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"', '3-1/2"', '4"'], true);
        $conduitRatio = $isLarger ? 1.10 : 1.05;

        foreach ($rules as $rule) {
            $g = $rule['gauge'];
            $wire = getItem("#$g Type THHN 600 Volt Stranded Copper Building Wire", $itemIndex, $rawItems);

            for ($count = $rule['min']; $count <= $rule['max']; $count++) {
                $comps = [];
                if ($conduit) $comps[] = ['item' => $conduit, 'quantity' => $conduitRatio];
                if ($elbow)   $comps[] = ['item' => $elbow, 'quantity' => 0.02];
                if ($wire)    $comps[] = ['item' => $wire, 'quantity' => round($count * 1.10, 4)];

                $name = "$d {$sch['label']} PVC Conduit, Feeder Branch, $count #$g THHN Wires";
                persistAssembly($pdo, $catalogId, $pvcGroupId, $name, 'ft', 'linear', $comps, $stats);
            }
        }
    }
}
echo "Assemblies PVC complete.\n";

// =========================================================================
// 3. GENERATE ASSEMBLIES FEEDERS (Group 38)
// =========================================================================
echo "--------------------------------------------------------\n";
echo " 3. Generating Assemblies Feeders (CU & ALU in EMT/PVC40/PVC80)...\n";
echo "--------------------------------------------------------\n";

$feedersGroupId = $groupMap['Assemblies Feeders'];

// Standard Feeders table per NEC 310.16 & NEC 250.122
$feederData = [
    'CU' => [
        '100A' => ['wire' => '#3 Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#8 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #8 GND', 'wire_label' => '4 #3 THHN', 'emt' => '1-1/4"', 'pvc' => '1-1/4"'],
        '125A' => ['wire' => '#1 Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#6 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #6 GND', 'wire_label' => '4 #1 THHN', 'emt' => '1-1/2"', 'pvc' => '1-1/2"'],
        '150A' => ['wire' => '#1/0 Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#6 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #6 GND', 'wire_label' => '4 #1/0 THHN', 'emt' => '2"', 'pvc' => '2"'],
        '175A' => ['wire' => '#2/0 Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#6 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #6 GND', 'wire_label' => '4 #2/0 THHN', 'emt' => '2"', 'pvc' => '2"'],
        '200A' => ['wire' => '#3/0 Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#6 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #6 GND', 'wire_label' => '4 #3/0 THHN', 'emt' => '2"', 'pvc' => '2"'],
        '225A' => ['wire' => '#4/0 Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#4 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #4 GND', 'wire_label' => '4 #4/0 THHN', 'emt' => '2-1/2"', 'pvc' => '2-1/2"'],
        '250A' => ['wire' => '#250 KCMIL Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#4 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #4 GND', 'wire_label' => '4 #250 KCMIL', 'emt' => '2-1/2"', 'pvc' => '2-1/2"'],
        '300A' => ['wire' => '#350 KCMIL Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#4 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #4 GND', 'wire_label' => '4 #350 KCMIL', 'emt' => '3"', 'pvc' => '3"'],
        '350A' => ['wire' => '#500 KCMIL Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#3 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #3 GND', 'wire_label' => '4 #500 KCMIL', 'emt' => '3-1/2"', 'pvc' => '3-1/2"'],
        '400A' => ['wire' => '#600 KCMIL Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 4, 'gnd' => '#3 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #3 GND', 'wire_label' => '4 #600 KCMIL', 'emt' => '4"', 'pvc' => '4"'],
        '450A' => ['wire' => '#250 KCMIL Type THHN 600 Volt Stranded Copper Building Wire', 'count' => 8, 'gnd' => '#4 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '2 #4 GND', 'wire_label' => '8 #250 KCMIL', 'emt' => '2x 2-1/2"', 'pvc' => '2x 2-1/2"', 'multiplier' => 2, 'base_d' => '2-1/2"']
    ],
    'ALU' => [
        '100A' => ['wire' => '1 AWG XHHW Stranded Aluminum', 'count' => 4, 'gnd' => '#8 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #8 GND', 'wire_label' => '4 #1 XHHW', 'emt' => '1-1/2"', 'pvc' => '1-1/2"'],
        '125A' => ['wire' => '2/0 XHHW Stranded Aluminum', 'count' => 4, 'gnd' => '#6 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #6 GND', 'wire_label' => '4 #2/0 XHHW', 'emt' => '2"', 'pvc' => '2"'],
        '150A' => ['wire' => '3/0 AWG XHHW Stranded Aluminum', 'count' => 4, 'gnd' => '#6 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #6 GND', 'wire_label' => '4 #3/0 XHHW', 'emt' => '2"', 'pvc' => '2"'],
        '175A' => ['wire' => '4/0 AWG XHHW-2 Stranded Aluminum', 'count' => 4, 'gnd' => '#6 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #6 GND', 'wire_label' => '4 #4/0 XHHW', 'emt' => '2-1/2"', 'pvc' => '2-1/2"'],
        '200A' => ['wire' => '250 MCM XHHW Stranded Aluminum', 'count' => 4, 'gnd' => '#6 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #6 GND', 'wire_label' => '4 #250 MCM', 'emt' => '2-1/2"', 'pvc' => '2-1/2"'],
        '225A' => ['wire' => '300 MCM XHHW Stranded Aluminum', 'count' => 4, 'gnd' => '#4 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #4 GND', 'wire_label' => '4 #300 MCM', 'emt' => '3"', 'pvc' => '3"'],
        '250A' => ['wire' => '350 MCM XHHW Stranded Aluminum', 'count' => 4, 'gnd' => '#4 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #4 GND', 'wire_label' => '4 #350 MCM', 'emt' => '3"', 'pvc' => '3"'],
        '300A' => ['wire' => '500 MCM XHHW Stranded Aluminum', 'count' => 4, 'gnd' => '#4 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #4 GND', 'wire_label' => '4 #500 MCM', 'emt' => '3-1/2"', 'pvc' => '3-1/2"'],
        '350A' => ['wire' => '700 MCM XHHW Stranded Aluminum', 'count' => 4, 'gnd' => '#3 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #3 GND', 'wire_label' => '4 #700 MCM', 'emt' => '4"', 'pvc' => '4"'],
        '400A' => ['wire' => '750 MCM XHHW-2 Stranded Aluminum', 'count' => 4, 'gnd' => '#3 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '1 #3 GND', 'wire_label' => '4 #750 MCM', 'emt' => '4"', 'pvc' => '4"'],
        '450A' => ['wire' => '300 MCM XHHW Stranded Aluminum', 'count' => 8, 'gnd' => '#4 Type THHN 600 Volt Stranded Copper Building Wire', 'gnd_label' => '2 #4 GND', 'wire_label' => '8 #300 MCM', 'emt' => '2x 3"', 'pvc' => '2x 3"', 'multiplier' => 2, 'base_d' => '3"']
    ]
];

$conduitOptions = [
    'EMT' => ['type' => 'EMT'],
    'Sch 40 PVC' => ['type' => 'PVC_40'],
    'Sch 80 PVC' => ['type' => 'PVC_80']
];

foreach ($feederData as $metal => $amps) {
    foreach ($amps as $amp => $cfg) {
        $wireItem = getItem($cfg['wire'], $itemIndex, $rawItems);
        $gndItem  = getItem($cfg['gnd'], $itemIndex, $rawItems);
        $mult     = $cfg['multiplier'] ?? 1;

        foreach ($conduitOptions as $cName => $cMeta) {
            $diam = $cMeta['type'] === 'EMT' ? $cfg['emt'] : $cfg['pvc'];
            $baseD = $cfg['base_d'] ?? $diam;

            // Fetch conduit fittings
            $compsBase = [];
            if ($cMeta['type'] === 'EMT') {
                $conduit = getItem("$baseD EMT Conduit", $itemIndex, $rawItems);
                $strap   = getItem("$baseD Steel One Hole Strap, EMT", $itemIndex, $rawItems) ?? getItem("$baseD Two Hole Steel Strap, EMT", $itemIndex, $rawItems);
                $coup    = getItem("$baseD Set Screw Steel Coupling, EMT", $itemIndex, $rawItems);
                $conn    = getItem("$baseD Steel Set Screw Connector, EMT", $itemIndex, $rawItems);
                $elbow   = getItem("$baseD EMT 90 Degree Elbow", $itemIndex, $rawItems);

                if ($conduit) $compsBase[] = ['item' => $conduit, 'quantity' => 1.0 * $mult];
                if ($strap)   $compsBase[] = ['item' => $strap, 'quantity' => 0.10 * $mult];
                if ($coup)    $compsBase[] = ['item' => $coup, 'quantity' => 0.10 * $mult];
                if ($conn)    $compsBase[] = ['item' => $conn, 'quantity' => 0.02 * $mult];
                if ($elbow)   $compsBase[] = ['item' => $elbow, 'quantity' => 0.02 * $mult];
            } else {
                $schPat = $cMeta['type'] === 'PVC_40' ? 'Schedule 40 PVC Conduit, 10\' Lengths With Coupling' : 'Schedule 80 Heavy Wall Pvc Conduit, 10\' Lengths With Coupling';
                $elbPat = $cMeta['type'] === 'PVC_40' ? '90 Degree Schedule 40 Pvc Elbows' : '90 Degree Schedule 80 Pvc Elbows';
                $conduit = getItem("$baseD $schPat", $itemIndex, $rawItems);
                $elbow   = getItem("$baseD $elbPat", $itemIndex, $rawItems);

                if ($conduit) $compsBase[] = ['item' => $conduit, 'quantity' => 1.10 * $mult];
                if ($elbow)   $compsBase[] = ['item' => $elbow, 'quantity' => 0.02 * $mult];
            }

            // Variant 1: 4-Wire (Without Ground)
            $compsNoGnd = $compsBase;
            if ($wireItem) $compsNoGnd[] = ['item' => $wireItem, 'quantity' => round($cfg['count'] * 1.10, 4)];
            $nameNoGnd = "$amp - 4 Wire $metal Feeder, $diam $cName, {$cfg['wire_label']}";
            persistAssembly($pdo, $catalogId, $feedersGroupId, $nameNoGnd, 'ft', 'linear', $compsNoGnd, $stats);

            // Variant 2: 4-Wire w/ Ground (5-wire total)
            $compsWithGnd = $compsBase;
            if ($wireItem) $compsWithGnd[] = ['item' => $wireItem, 'quantity' => round($cfg['count'] * 1.10, 4)];
            if ($gndItem)  $compsWithGnd[] = ['item' => $gndItem, 'quantity' => round((1 * $mult) * 1.10, 4)];
            $nameWithGnd = "$amp - 4 Wire w/ Ground $metal Feeder, $diam $cName, {$cfg['wire_label']}, {$cfg['gnd_label']}";
            persistAssembly($pdo, $catalogId, $feedersGroupId, $nameWithGnd, 'ft', 'linear', $compsWithGnd, $stats);
        }
    }
}
echo "Assemblies Feeders complete.\n";

// =========================================================================
// 4. GENERATE ASSEMBLIES ROUGH IN (Group 40)
// =========================================================================
echo "--------------------------------------------------------\n";
echo " 4. Generating Assemblies Rough In (Switches, J-Boxes, Receptacles)...\n";
echo "--------------------------------------------------------\n";

$roughInGroupId = $groupMap['Assemblies Rough In'];

// Common materials
$emt12       = getItem('1/2" EMT Conduit', $itemIndex, $rawItems);
$strap12     = getItem('1/2" Steel One Hole Strap, EMT', $itemIndex, $rawItems);
$coup12      = getItem('1/2" Set Screw Steel Coupling, EMT', $itemIndex, $rawItems);
$conn12      = getItem('1/2" Steel Set Screw Connector, EMT', $itemIndex, $rawItems);
$emt34       = getItem('3/4" EMT Conduit', $itemIndex, $rawItems);
$strap34     = getItem('3/4" Steel One Hole Strap, EMT', $itemIndex, $rawItems);
$coup34      = getItem('3/4" Set Screw Steel Coupling, EMT', $itemIndex, $rawItems);
$conn34      = getItem('3/4" Steel Set Screw Connector, EMT', $itemIndex, $rawItems);

$box4Sq      = getItem('4" Square Box 1/2" & 3/4" KO - 1-1/2" Shallow Box', $itemIndex, $rawItems);
$boxOctagon  = getItem('4" Octagon Box, 2-1/8" Deep, 1/2" KOs, Drawn, Steel', $itemIndex, $rawItems);
$coverOctagon= getItem('4" Octagon/Round Box Cover, (1) 1/2" KO, Drawn, Metallic', $itemIndex, $rawItems);
$mudRing1G   = getItem('5/8" Raised One Gang Mud Ring for 4" Square', $itemIndex, $rawItems);
$mudRing2G   = getItem('5/8" Raised 2 Gang Mud Ring for 4" Square', $itemIndex, $rawItems);
$bracket     = getItem('4" X 1-1/2" General Stud Mounting Bracket for Square Boxes', $itemIndex, $rawItems);
$wireNuts    = getItem('Red, Extra Large Wire Nuts', $itemIndex, $rawItems);

$thhn12      = getItem('#12 Type THHN 600 Volt Stranded Copper Building Wire', $itemIndex, $rawItems);
$thhn10      = getItem('#10 Type THHN 600 Volt Stranded Copper Building Wire', $itemIndex, $rawItems);

$plateSwitch = getItem('Switch Wallplate, 1 Gang, Plastic, White', $itemIndex, $rawItems);
$plateDuplex = getItem('Duplex Receptacle Wallplate, 1-Gang, Plastic', $itemIndex, $rawItems);
$plateQuad   = getItem('Duplex Receptacle Wallplate, 2-Gang, Nylon, White', $itemIndex, $rawItems);
$plateSingle = getItem('Single Receptacle Wallplate, 1 Gang, Nylon, White', $itemIndex, $rawItems);

$bubble1G    = getItem('Bubble Cover - Weatherproof-In-Use Cover, 1-Gang', $itemIndex, $rawItems);
$bubble2G    = getItem('Bubble Cover - Weatherproof-In-Use Cover, 2-Gang', $itemIndex, $rawItems);

$medicalMC   = getItem('12/3 MC Cable  - w/Ground, Aluminum Armor, Solid', $itemIndex, $rawItems);
$laborCounter= getItem('Labor For Counter Mounted', $itemIndex, $rawItems);
$unistrut    = getItem('Unistrut and Accessories', $itemIndex, $rawItems);
$floorBox    = getItem('Floor box', $itemIndex, $rawItems);

// 4.A. Switches
$switches = [
    'Switch, 1-Pole, 20 amp, Commercial-Grade w/ Box, Stub-up & 3 #12' => [
        'item' => getItem('Switch Single Pole, 20 Amp, Commercial Grade, Grounding', $itemIndex, $rawItems),
        'wire' => $thhn12
    ],
    'Switch, 2-Way, 20 amp, Commercial-Grade w/ Box, Stub-up & 3 #12' => [
        'item' => getItem('Switch Double Pole, 20 Amp, Commercial Grade, Grounding', $itemIndex, $rawItems),
        'wire' => $thhn12
    ],
    'Switch, 3-Way, 20 amp, Commercial-Grade w/ Box, Stub-up & 3 #12' => [
        'item' => getItem('Switch, 3-way, 20 Amp, Grounded, Commercial Grade', $itemIndex, $rawItems),
        'wire' => $thhn12
    ],
    'Switch, 4-Way, 20 amp, Commercial-Grade w/ Box, Stub-up & 3 #12' => [
        'item' => getItem('Switch, 4-way, 20 Amp, Grounded, Commercial Grade', $itemIndex, $rawItems),
        'wire' => $thhn12
    ],
    'Manual Motor Switch, 1-Pole, 15 amp, w/ Box, Stub-up & 3 #12' => [
        'item' => getItem('Manual Motor Switch Double Pole, 15 Amp, Industrial Grade, Non-Grounding', $itemIndex, $rawItems),
        'wire' => $thhn12
    ],
    'Manual Motor Switch, 2-Pole, 30 amp, w/ Box, Stub-up & 3 #10' => [
        'item' => getItem('Manual Motor Switch Single Pole, 30 Amp, Industrial Grade, Non-Grounding', $itemIndex, $rawItems),
        'wire' => $thhn10
    ]
];

foreach ($switches as $sName => $sCfg) {
    $comps = [];
    if ($emt12)       $comps[] = ['item' => $emt12, 'quantity' => 15.0];
    if ($strap12)     $comps[] = ['item' => $strap12, 'quantity' => 3.0];
    if ($coup12)      $comps[] = ['item' => $coup12, 'quantity' => 1.0];
    if ($conn12)      $comps[] = ['item' => $conn12, 'quantity' => 2.0];
    if ($box4Sq)      $comps[] = ['item' => $box4Sq, 'quantity' => 1.0];
    if ($mudRing1G)   $comps[] = ['item' => $mudRing1G, 'quantity' => 1.0];
    if ($plateSwitch) $comps[] = ['item' => $plateSwitch, 'quantity' => 1.0];
    if ($sCfg['item']) $comps[] = ['item' => $sCfg['item'], 'quantity' => 1.0];
    if ($sCfg['wire']) $comps[] = ['item' => $sCfg['wire'], 'quantity' => 50.0];
    if ($wireNuts)    $comps[] = ['item' => $wireNuts, 'quantity' => 3.0];

    persistAssembly($pdo, $catalogId, $roughInGroupId, $sName, 'ea', 'count', $comps, $stats);
}

// 4.B. Junction Boxes
$jboxes = [
    // Standard J-Box
    'J-box, Commercial-Grade with Box, Conduit Stub-up' => [
        'conduit' => $emt12, 'strap' => $strap12, 'coup' => $coup12, 'conn' => $conn12,
        'box' => $box4Sq, 'bracket' => $bracket, 'pullstring' => $pullstring, 'wp' => false
    ],
    'WP - J-box, Commercial-Grade with Box WP, Conduit Stub-up' => [
        'conduit' => $emt12, 'strap' => $strap12, 'coup' => $coup12, 'conn' => $conn12,
        'box' => $box4Sq, 'bracket' => $bracket, 'pullstring' => $pullstring, 'wp' => true, 'bubble' => $bubble2G
    ],
    // Sign Lighting J-Box
    '20 amp Sign Lighting J-box, Commercial-Grade w/ Box, Stub-up & 3 #12' => [
        'conduit' => $emt12, 'strap' => $strap12, 'coup' => $coup12, 'conn' => $conn12,
        'box' => $boxOctagon, 'cover' => $coverOctagon, 'device' => getItem('Duplex Receptacle, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'plate' => $plateDuplex, 'wire' => $thhn12, 'wire_qty' => 50.0, 'wireNuts' => 3, 'wp' => false
    ],
    'WP - 20 amp Sign Lighting J-box, Commercial-Grade w/ Box WP, Stub-up & 3 #12' => [
        'conduit' => $emt12, 'strap' => $strap12, 'coup' => $coup12, 'conn' => $conn12,
        'box' => $boxOctagon, 'cover' => $coverOctagon, 'device' => getItem('Duplex Receptacle, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'plate' => $plateDuplex, 'wire' => $thhn12, 'wire_qty' => 50.0, 'wireNuts' => 3, 'wp' => true, 'bubble' => $bubble2G
    ],
    // Dedicated 20A / 30A
    '20 Amp Dedicated Circuit J-box, Commercial-Grade w/ Box, 3/4" Stub-up & 3 #12' => [
        'conduit' => $emt34, 'strap' => $strap34, 'coup' => $coup34, 'conn' => $conn34,
        'box' => $box4Sq, 'bracket' => $bracket, 'device' => getItem('Duplex Receptacle, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'plate' => $plateDuplex, 'wire' => $thhn12, 'wire_qty' => 50.0, 'wp' => false
    ],
    'WP - 20 Amp Dedicated Circuit J-box, Commercial-Grade w/ WP Box, 3/4" Stub-up & 3 #12' => [
        'conduit' => $emt34, 'strap' => $strap34, 'coup' => $coup34, 'conn' => $conn34,
        'box' => $box4Sq, 'bracket' => $bracket, 'device' => getItem('Duplex Receptacle, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'plate' => $plateDuplex, 'wire' => $thhn12, 'wire_qty' => 50.0, 'wp' => true, 'bubble' => $bubble2G
    ],
    '30 Amp Dedicated Circuit J-box, Commercial-Grade w/ Box, 3/4" Stub-up & 3 #10' => [
        'conduit' => $emt34, 'strap' => $strap34, 'coup' => $coup34, 'conn' => $conn34,
        'box' => $box4Sq, 'bracket' => $bracket, 'device' => getItem('Duplex Receptacle, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'plate' => $plateDuplex, 'wire' => $thhn10, 'wire_qty' => 50.0, 'wp' => false
    ],
    'WP - 30 Amp Dedicated Circuit J-box, Commercial-Grade w/ WP Box, 3/4" Stub-up & 3 #10' => [
        'conduit' => $emt34, 'strap' => $strap34, 'coup' => $coup34, 'conn' => $conn34,
        'box' => $box4Sq, 'bracket' => $bracket, 'device' => getItem('Duplex Receptacle, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'plate' => $plateDuplex, 'wire' => $thhn10, 'wire_qty' => 50.0, 'wp' => true, 'bubble' => $bubble2G
    ]
];

foreach ($jboxes as $jbName => $jbCfg) {
    $comps = [];
    if (!empty($jbCfg['conduit'])) $comps[] = ['item' => $jbCfg['conduit'], 'quantity' => 15.0];
    if (!empty($jbCfg['strap']))   $comps[] = ['item' => $jbCfg['strap'], 'quantity' => 3.0];
    if (!empty($jbCfg['coup']))    $comps[] = ['item' => $jbCfg['coup'], 'quantity' => 1.0];
    if (!empty($jbCfg['conn']))    $comps[] = ['item' => $jbCfg['conn'], 'quantity' => 2.0];
    if (!empty($jbCfg['box']))     $comps[] = ['item' => $jbCfg['box'], 'quantity' => 1.0];
    if (!empty($jbCfg['bracket'])) $comps[] = ['item' => $jbCfg['bracket'], 'quantity' => 1.0];
    if (!empty($jbCfg['cover']))   $comps[] = ['item' => $jbCfg['cover'], 'quantity' => 1.0];
    if (!empty($jbCfg['device']))  $comps[] = ['item' => $jbCfg['device'], 'quantity' => 1.0];
    if (!empty($jbCfg['plate']))   $comps[] = ['item' => $jbCfg['plate'], 'quantity' => 1.0];
    if (!empty($jbCfg['wire']))    $comps[] = ['item' => $jbCfg['wire'], 'quantity' => $jbCfg['wire_qty'] ?? 50.0];
    if (!empty($jbCfg['wireNuts']))$comps[] = ['item' => $wireNuts, 'quantity' => 3.0];
    if (!empty($jbCfg['pullstring'])) $comps[] = ['item' => $jbCfg['pullstring'], 'quantity' => 15.0];
    if (!empty($jbCfg['bubble']))  $comps[] = ['item' => $jbCfg['bubble'], 'quantity' => 1.0];

    persistAssembly($pdo, $catalogId, $roughInGroupId, $jbName, 'ea', 'count', $comps, $stats);
}

// 4.C. Receptacles (6 types x 4 mountings x 2 [Std/WP] x 2 [Standard/Medical MC] = 96 assemblies)
$receptacleTypes = [
    'Duplex' => [
        'item' => getItem('Duplex Receptacle, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'item_qty' => 1.0,
        'mudRing' => $mudRing1G,
        'plate' => $plateDuplex,
        'bubble' => $bubble1G,
        'label' => 'Duplex Receptacle, 20A'
    ],
    'Duplex IG' => [
        'item' => getItem('Duplex receptacle, 20 amp, with surge suppressor and isolated ground, hospital grade, 5-20R', $itemIndex, $rawItems),
        'item_qty' => 1.0,
        'mudRing' => $mudRing1G,
        'plate' => $plateDuplex,
        'bubble' => $bubble1G,
        'label' => 'Duplex IG Receptacle, 20A'
    ],
    'Quad' => [
        'item' => getItem('Duplex Receptacle, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'item_qty' => 2.0, // 2x duplex for quad
        'mudRing' => $mudRing2G,
        'plate' => $plateQuad,
        'bubble' => $bubble2G, // 2-gang bubble for quad
        'label' => 'Quad Receptacle, 20A'
    ],
    'GFCI' => [
        'item' => getItem('GFCI Duplex Receptacle, Tamper Resistant, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'item_qty' => 1.0,
        'mudRing' => $mudRing1G,
        'plate' => $plateDuplex,
        'bubble' => $bubble1G,
        'label' => 'GFCI Duplex Receptacle, 20A'
    ],
    'Single' => [
        'item' => getItem('Single Receptacle, 20 Amp, Commercial Grade, 5-20R, White', $itemIndex, $rawItems),
        'item_qty' => 1.0,
        'mudRing' => $mudRing1G,
        'plate' => $plateSingle,
        'bubble' => $bubble1G,
        'label' => 'Single Receptacle, 20A'
    ],
    'USB' => [
        'item' => getItem('Duplex USB Receptacle, 15 Amp, Commercial Grade, White', $itemIndex, $rawItems),
        'item_qty' => 1.0,
        'mudRing' => $mudRing1G,
        'plate' => $plateDuplex,
        'bubble' => $bubble1G,
        'label' => 'USB Duplex Receptacle, 15A'
    ]
];

$mountingTypes = [
    'Wall' => [
        'label' => 'Commercial-Grade',
        'extra_item' => null
    ],
    'Counter' => [
        'label' => '[Counter mounted]',
        'extra_item' => $laborCounter
    ],
    'Ceiling' => [
        'label' => '[Ceiling mounted]',
        'extra_item' => $unistrut
    ],
    'Floor' => [
        'label' => '[Floor mounted]',
        'extra_item' => $floorBox,
        'is_floor' => true
    ]
];

foreach ($receptacleTypes as $rKey => $rCfg) {
    foreach ($mountingTypes as $mKey => $mCfg) {
        foreach ([false, true] as $isWP) {
            foreach ([false, true] as $isMedical) {
                $comps = [];

                // Basic conduit stub-up and box (floor mounted uses floor box)
                if (empty($mCfg['is_floor'])) {
                    if ($emt12)     $comps[] = ['item' => $emt12, 'quantity' => 15.0];
                    if ($strap12)   $comps[] = ['item' => $strap12, 'quantity' => 3.0];
                    if ($coup12)    $comps[] = ['item' => $coup12, 'quantity' => 1.0];
                    if ($conn12)    $comps[] = ['item' => $conn12, 'quantity' => 2.0];
                    if ($box4Sq)    $comps[] = ['item' => $box4Sq, 'quantity' => 1.0];
                    if ($rCfg['mudRing']) $comps[] = ['item' => $rCfg['mudRing'], 'quantity' => 1.0];
                } else {
                    if ($emt12)     $comps[] = ['item' => $emt12, 'quantity' => 15.0];
                    if ($strap12)   $comps[] = ['item' => $strap12, 'quantity' => 3.0];
                    if ($coup12)    $comps[] = ['item' => $coup12, 'quantity' => 1.0];
                    if ($conn12)    $comps[] = ['item' => $conn12, 'quantity' => 2.0];
                }

                // Device item
                if ($rCfg['item']) $comps[] = ['item' => $rCfg['item'], 'quantity' => $rCfg['item_qty']];

                // Plate or Bubble Cover
                if ($isWP && !empty($rCfg['bubble'])) {
                    $comps[] = ['item' => $rCfg['bubble'], 'quantity' => 1.0];
                } elseif (!empty($rCfg['plate'])) {
                    $comps[] = ['item' => $rCfg['plate'], 'quantity' => 1.0];
                }

                // THHN Wire & Wire Nuts
                if ($thhn12)   $comps[] = ['item' => $thhn12, 'quantity' => 50.0];
                if ($wireNuts) $comps[] = ['item' => $wireNuts, 'quantity' => 3.0];

                // Extra mounting accessories
                if (!empty($mCfg['extra_item'])) {
                    $comps[] = ['item' => $mCfg['extra_item'], 'quantity' => 1.0];
                }

                // Medical MC variation
                if ($isMedical && $medicalMC) {
                    $comps[] = ['item' => $medicalMC, 'quantity' => 7.0];
                }

                // Name building
                $wpPrefix = $isWP ? 'WP - ' : '';
                $medSuffix = $isMedical ? ' Medical MC' : '';
                $name = "{$wpPrefix}{$rCfg['label']}, {$mCfg['label']} with Box, Conduit Stub-up and 3 #12{$medSuffix}";

                persistAssembly($pdo, $catalogId, $roughInGroupId, $name, 'ea', 'count', $comps, $stats);
            }
        }
    }
}
echo "Assemblies Rough In complete.\n";

// =========================================================================
// 5. GENERATE ASSEMBLIES LOW VOLTAGE (Group 42)
// =========================================================================
echo "--------------------------------------------------------\n";
echo " 5. Generating Assemblies Low Voltage...\n";
echo "--------------------------------------------------------\n";

$lvGroupId    = $groupMap['Assemblies Low Voltage'];
$box411       = getItem('4-11/16" Square Box, 2-1/8" Depth, 1/2" & 3/4" KO, Deep Box', $itemIndex, $rawItems);
$tvBackbox    = getItem('TV Backbox', $itemIndex, $rawItems);
$tvMount      = getItem('TV Wall Mount', $itemIndex, $rawItems);
$tvFaceplate  = getItem('TV Faceplate Combo - Without Box', $itemIndex, $rawItems);

$lvSizes = ['3/4"', '1"', '1-1/4"', '1-1/2"'];
foreach ($lvSizes as $d) {
    $conduit = getItem("$d EMT Conduit", $itemIndex, $rawItems);
    $strap   = getItem("$d Steel One Hole Strap, EMT", $itemIndex, $rawItems);
    $coup    = getItem("$d Set Screw Steel Coupling, EMT", $itemIndex, $rawItems);
    $conn    = getItem("$d Steel Set Screw Connector, EMT", $itemIndex, $rawItems);

    $comps = [];
    if ($conduit)     $comps[] = ['item' => $conduit, 'quantity' => 15.0];
    if ($strap)       $comps[] = ['item' => $strap, 'quantity' => 3.0];
    if ($coup)        $comps[] = ['item' => $coup, 'quantity' => 1.0];
    if ($conn)        $comps[] = ['item' => $conn, 'quantity' => 2.0];
    if ($box411)      $comps[] = ['item' => $box411, 'quantity' => 1.0];
    if ($tvBackbox)   $comps[] = ['item' => $tvBackbox, 'quantity' => 1.0];
    if ($tvMount)     $comps[] = ['item' => $tvMount, 'quantity' => 1.0];
    if ($tvFaceplate) $comps[] = ['item' => $tvFaceplate, 'quantity' => 1.0];

    $name = "TV Box, Faceplate & TV Mount w/ $d EMT Conduit Stub-up";
    persistAssembly($pdo, $catalogId, $lvGroupId, $name, 'ea', 'count', $comps, $stats);
}
echo "Assemblies Low Voltage complete.\n";

// =========================================================================
// SUMMARY
// =========================================================================
echo "\n========================================================\n";
echo " SEEDING COMPLETED SUCCESSFULLY!\n";
echo " Assemblies Created:       {$stats['created']}\n";
echo " Assemblies Updated:       {$stats['updated']}\n";
echo " Components Linked:        {$stats['parts_linked']}\n";
echo " Total Active Assemblies:  " . ($stats['created'] + $stats['updated']) . "\n";
echo "========================================================\n";

$pdo->commit();
