<?php
require_once __DIR__ . '/../config/database.php';
$pdo = getDbConnection();
$stmt = $pdo->prepare("SELECT * FROM project_estimates WHERE project_id = 9 LIMIT 5");
$stmt->execute();
$estimates = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Project estimates count: " . count($estimates) . "\n";
if (!empty($estimates)) {
    $est = $estimates[0];
    echo "Name: " . $est['name'] . ", ID: " . $est['id'] . "\n";
    if (!empty($est['data'])) {
        $data = json_decode($est['data'], true);
        echo "Data keys: " . json_encode(array_keys($data)) . "\n";
        if (isset($data['groups'])) {
            echo "Groups count: " . count($data['groups']) . "\n";
            foreach ($data['groups'] as $g) {
                echo "Group: " . ($g['name'] ?? 'no name') . ", items: " . count($g['items'] ?? []) . "\n";
                if (!empty($g['items'])) {
                    echo "  Sample item: " . json_encode($g['items'][0]) . "\n";
                }
            }
        }
    }
}
