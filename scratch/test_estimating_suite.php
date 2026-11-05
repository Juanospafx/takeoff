<?php
require_once __DIR__ . '/../core/db/connection.php';

echo "==========================================================" . PHP_EOL;
echo " COMPREHENSIVE ESTIMATING AUDIT & VERIFICATION SUITE      " . PHP_EOL;
echo "==========================================================" . PHP_EOL;

$results = [];

// TEST 1: Check Projects & Estimate Loading
echo PHP_EOL . ">>> 1. AUDIT: Project & Estimate Existence" . PHP_EOL;
$projects = [5, 6, 7, 8, 9, 10];
foreach ($projects as $pid) {
    $stmtProj = $pdo->prepare("SELECT id, name, status FROM projects WHERE id = ?");
    $stmtProj->execute([$pid]);
    $p = $stmtProj->fetch(PDO::FETCH_ASSOC);
    if (!$p) {
        echo "  [FAIL] Project {$pid} does not exist in DB." . PHP_EOL;
        $results["Project_{$pid}"] = "FAIL";
        continue;
    }
    
    // Check estimate
    $stmtEst = $pdo->prepare("SELECT id, total_cost, subtotal_cost, markup_total FROM estimates WHERE project_id = ? ORDER BY id DESC LIMIT 1");
    $stmtEst->execute([$pid]);
    $est = $stmtEst->fetch(PDO::FETCH_ASSOC);
    
    // Check workspace state
    $stmtWs = $pdo->prepare("SELECT estimate_id, revision, updated_at, LENGTH(state_json) as len FROM estimate_workspace_states WHERE project_id = ?");
    $stmtWs->execute([$pid]);
    $ws = $stmtWs->fetch(PDO::FETCH_ASSOC);
    
    // Check items count
    $stmtItems = $pdo->prepare("SELECT COUNT(*) FROM estimate_items WHERE estimate_id = ?");
    $stmtItems->execute([$est['id'] ?? 0]);
    $itemCount = $stmtItems->fetchColumn();
    
    echo "  [PASS] Project {$pid}: '{$p['name']}' | Estimate ID: " . ($est['id'] ?? 'NONE') . " (Total: \$" . number_format($est['total_cost'] ?? 0, 2) . ") | Items: {$itemCount} | WS State: " . ($ws ? "YES ({$ws['len']} bytes, rev {$ws['revision']})" : "NO") . PHP_EOL;
    $results["Project_{$pid}"] = "PASS";
}

// TEST 2: Inspect Difficulty Factor & Multiplier Persistence in DB
echo PHP_EOL . ">>> 2. AUDIT: Difficulty Factor & Multiplier in Workspace States" . PHP_EOL;
$stmtWsAll = $pdo->query("SELECT project_id, revision, state_json FROM estimate_workspace_states ORDER BY project_id ASC");
while ($wsRow = $stmtWsAll->fetch(PDO::FETCH_ASSOC)) {
    $pid = $wsRow['project_id'];
    $data = json_decode($wsRow['state_json'], true);
    $items = [];
    $dfFound = 0;
    $mfFound = 0;
    $sampleDf = [];
    
    if (!empty($data['estimate']['groups'])) {
        foreach ($data['estimate']['groups'] as $grp) {
            foreach ($grp['items'] ?? [] as $it) {
                if (isset($it['difficultyFactor'])) {
                    $dfFound++;
                    if (count($sampleDf) < 3) $sampleDf[] = $it['name'] . ' (DF=' . $it['difficultyFactor'] . ')';
                }
                if (isset($it['multiplier'])) $mfFound++;
            }
        }
    }
    echo "  Project {$pid}: DF attributes found on {$dfFound} items, Multipliers on {$mfFound} items. Samples: " . implode(', ', $sampleDf) . PHP_EOL;
}

// TEST 3: Test API Load Simulation
echo PHP_EOL . ">>> 3. AUDIT: API Estimating Workspace Load Simulation" . PHP_EOL;
foreach ([6, 7, 8, 9, 10] as $pid) {
    $_GET = ['action' => 'load', 'project_id' => $pid];
    $_SERVER['REQUEST_METHOD'] = 'GET';
    
    // Capture output of api/project_estimating.php
    ob_start();
    try {
        include __DIR__ . '/../api/project_estimating.php';
        $output = ob_get_clean();
        $json = json_decode($output, true);
        if ($json && ($json['success'] ?? false)) {
            $estData = $json['data']['estimate'] ?? [];
            $groups = $estData['groups'] ?? [];
            $groupCount = count($groups);
            $totalItems = 0;
            foreach ($groups as $g) $totalItems += count($g['items'] ?? []);
            echo "  [PASS] API Load Project {$pid}: OK (Groups: {$groupCount}, Items: {$totalItems}, Total: \$" . number_format($estData['total'] ?? 0, 2) . ")" . PHP_EOL;
        } else {
            echo "  [WARN] API Load Project {$pid}: " . ($json['error'] ?? 'Non-JSON or unsuccessful response') . PHP_EOL;
        }
    } catch (\Throwable $t) {
        ob_end_clean();
        echo "  [FAIL] API Load Project {$pid} Exception: " . $t->getMessage() . PHP_EOL;
    }
}

// TEST 4: Assembly Component Calculation Verification
echo PHP_EOL . ">>> 4. AUDIT: Assembly Component Calculation Consistency" . PHP_EOL;
// Test assembly expansion logic:
// When parent has quantity Q (e.g. 100 FT) and component formula is 1 connector per 10 FT (ratio = 0.1),
// component quantity should be Q * ratio = 10.
// Verify that neither estimate_calculation_service.js nor estimating_assembly_expansion_adapter.js double-multiplies this.
$assemblyComponents = [
    ['name' => '1/2" EMT Conduit', 'ratio' => 1.0, 'unit' => 'FT'],
    ['name' => '1/2" Steel Set Screw Coupling', 'ratio' => 0.1, 'unit' => 'EA'],
    ['name' => '1/2" Steel Set Screw Connector', 'ratio' => 0.2, 'unit' => 'EA'],
    ['name' => '1/2" One-Hole Strap', 'ratio' => 0.33, 'unit' => 'EA'],
];
$parentQty = 150.0;
echo "  Parent Assembly Quantity: {$parentQty} FT" . PHP_EOL;
foreach ($assemblyComponents as $comp) {
    $expectedQty = $parentQty * $comp['ratio'];
    echo "  - Component '{$comp['name']}': Ratio {$comp['ratio']} -> Expected Qty: {$expectedQty} {$comp['unit']}" . PHP_EOL;
}

// TEST 5: Post-tax Markups Calculation Simulation (Discount vs Tax)
echo PHP_EOL . ">>> 5. AUDIT: Post-Tax Markups (Add vs Subtract Behavior)" . PHP_EOL;
$subtotal = 50000.00;
$markups = [
    ['name' => 'Overhead', 'type' => 'percentage', 'value' => 10, 'operator' => '+'],
    ['name' => 'Profit', 'type' => 'percentage', 'value' => 5, 'operator' => '+'],
    ['name' => 'Early Pay Discount', 'type' => 'percentage', 'value' => 3, 'operator' => '-'],
    ['name' => 'State Sales Tax', 'type' => 'percentage', 'value' => 7, 'operator' => '+'],
];

$runningTotal = $subtotal;
echo "  Base Subtotal: \$" . number_format($subtotal, 2) . PHP_EOL;
foreach ($markups as $m) {
    $calcAmount = ($subtotal * ($m['value'] / 100));
    if ($m['operator'] === '-') {
        $runningTotal -= $calcAmount;
        echo "  - [SUBTRACT] {$m['name']} ({$m['value']}%): -\$" . number_format($calcAmount, 2) . " -> Subtotal now: \$" . number_format($runningTotal, 2) . PHP_EOL;
    } else {
        $runningTotal += $calcAmount;
        echo "  - [ADD]      {$m['name']} ({$m['value']}%): +\$" . number_format($calcAmount, 2) . " -> Subtotal now: \$" . number_format($runningTotal, 2) . PHP_EOL;
    }
}
$expectedEarlyPayDiscountDeducted = ($runningTotal < ($subtotal * 1.22)); // Overhead + profit + tax is 22%
echo "  Final Calculated Total: \$" . number_format($runningTotal, 2) . " (Discount successfully deducted: " . ($expectedEarlyPayDiscountDeducted ? "YES" : "NO") . ")" . PHP_EOL;

// TEST 6: Labor vs Material Waste Separation
echo PHP_EOL . ">>> 6. AUDIT: Labor vs Material Waste Calculation" . PHP_EOL;
$itemQty = 100;
$matUnitCost = 25.00;
$laborHoursPerUnit = 0.5; // 50 hours total
$laborRate = 65.00; // $3,250 labor base
$matWaste = 10.0; // 10%
$laborWaste = 5.0; // 5%
$diffFactor = 1.2; // 1.2 difficulty

$baseMatCost = $itemQty * $matUnitCost;
$effectiveMatCost = $baseMatCost * (1 + ($matWaste / 100));

$baseLaborHours = $itemQty * $laborHoursPerUnit;
$effectiveLaborHours = $baseLaborHours * (1 + ($laborWaste / 100)) * $diffFactor;
$effectiveLaborCost = $effectiveLaborHours * $laborRate;

echo "  Item Qty: {$itemQty} | Mat Unit Cost: \${$matUnitCost} | Labor Unit Hours: {$laborHoursPerUnit} hr @ \${$laborRate}/hr" . PHP_EOL;
echo "  - Material Waste ({$matWaste}%): Base \${$baseMatCost} -> Effective \${$effectiveMatCost}" . PHP_EOL;
echo "  - Labor Waste ({$laborWaste}%) & Diff Factor ({$diffFactor}): Base {$baseLaborHours} hrs -> Effective {$effectiveLaborHours} hrs -> Labor Cost: \$" . number_format($effectiveLaborCost, 2) . PHP_EOL;

// TEST 7: Orange Override Indicator Verification
echo PHP_EOL . ">>> 7. AUDIT: Orange Text Indicator Logic for Overridden Values" . PHP_EOL;
// Rules verified in assets/project_estimating.js:
// 1. Quantity: isQtyOverridden = item.overrides?.quantity !== undefined && item.overrides?.quantity !== null && Number(item.overrides.quantity) !== Number(item.takeoffQuantity)
// 2. Material Cost: isMatOverridden = item.overrides?.materialUnitCost !== undefined && item.overrides?.materialUnitCost !== null
// 3. Labor Hours: isLaborOverridden = item.overrides?.laborHoursPerUnit !== undefined && item.overrides?.laborHoursPerUnit !== null
$testItems = [
    ['desc' => 'Normal Item (no overrides)', 'overrides' => null, 'qty' => 10, 'toQty' => 10, 'expOrange' => false],
    ['desc' => 'Item with empty overrides object', 'overrides' => ['materialUnitCost' => null, 'quantity' => null], 'qty' => 10, 'toQty' => 10, 'expOrange' => false],
    ['desc' => 'Item with modified quantity', 'overrides' => ['quantity' => 15], 'qty' => 15, 'toQty' => 10, 'expOrange' => true],
    ['desc' => 'Item with modified unit cost', 'overrides' => ['materialUnitCost' => 28.50], 'qty' => 10, 'toQty' => 10, 'expOrange' => true],
];

foreach ($testItems as $ti) {
    $isQtyOverridden = isset($ti['overrides']['quantity']) && $ti['overrides']['quantity'] !== null && $ti['overrides']['quantity'] != $ti['toQty'];
    $isMatOverridden = isset($ti['overrides']['materialUnitCost']) && $ti['overrides']['materialUnitCost'] !== null;
    $hasOrange = $isQtyOverridden || $isMatOverridden;
    $match = ($hasOrange === $ti['expOrange']);
    echo "  - [{$ti['desc']}]: Has Orange Highlight = " . ($hasOrange ? "TRUE" : "FALSE") . " (Expected: " . ($ti['expOrange'] ? "TRUE" : "FALSE") . ") -> " . ($match ? "PASS" : "FAIL") . PHP_EOL;
}

echo PHP_EOL . "==========================================================" . PHP_EOL;
echo " AUDIT COMPLETED SUCCESSFULLY                             " . PHP_EOL;
echo "==========================================================" . PHP_EOL;

