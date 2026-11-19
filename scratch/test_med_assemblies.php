<?php
require_once __DIR__ . '/../core/db/connection.php';

$st = $pdo->query("SELECT * FROM assembly_parts WHERE assembly_catalog_item_id IN (9112, 9114, 9116, 9118)");
echo "Medical assembly parts found: " . count($st->fetchAll()) . "\n";

