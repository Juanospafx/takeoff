<?php
require_once __DIR__ . '/../core/db/connection.php';

$ids = [
    // Lighting
    7400, 7258, 7367, 7268, 7266, 7274, 7401, 7264,
    // Controls
    8605, 8606, 8613, 8612, 8600, 8614, 8591, 8596,
    // Gear
    7010, 7093, 7090, 7104, 7867, 8052, 7096, 6920, 7024, 7017, 7021, 7091, 8592, 7056, 7043, 7044,
    // Rough In
    7679, 7674, 7737, 7636, 7634, 7589, 7642, 7641, 7558, 7560, 7578, 7557, 7753, 7761, 7744, 7763,
    // Overhead Lighting
    8849, 8850, 8851, 8857, 8858, 8859, 8840,
    // Overhead Power
    8855, 8856, 8865, 8866, 8867,
    // Underground
    8892, 8898, 8900, 8929, 8937,
    // Feeders
    9000, 9004, 9022,
    // Primary
    7647, 8224,
    // Rental
    8577
];

$in = implode(',', $ids);
$stmt = $pdo->query("SELECT id, name, sku, unit_cost, unit_of_measure, catalog_number FROM catalog_items WHERE id IN ($in)");
$found = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Verified: " . count($found) . " of " . count($ids) . " items found.\n";
$foundIds = array_column($found, 'id');
$missing = array_diff($ids, $foundIds);
if (!empty($missing)) {
    echo "Missing IDs: " . implode(', ', $missing) . "\n";
} else {
    echo "All item IDs exist in catalog_items!\n";
}
