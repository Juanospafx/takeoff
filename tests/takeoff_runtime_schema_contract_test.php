<?php
$source = file_get_contents(__DIR__ . '/../api/takeoff.php');
if (strpos($source, 'assert_takeoff_runtime_schema($pdo);') === false) throw new RuntimeException('Missing runtime schema preflight.');
$try = substr($source, strpos($source, "try {\n    // Production runtime credentials"));
foreach (array('ensure_takeoff_layer_columns($pdo);', 'ensure_takeoff_geometry_tables($pdo);', 'ensure_takeoff_scale_table($pdo);', 'ensure_takeoff_state_table($pdo);', 'ensure_estimate_schema($pdo);') as $call) {
    if (strpos($try, $call) !== false) throw new RuntimeException('Runtime still invokes DDL bootstrap: ' . $call);
}
if (strpos($source, "'code' => 'takeoff_storage_unavailable'") === false) throw new RuntimeException('Missing safe storage error contract.');
echo "takeoff runtime schema contract test passed\n";
