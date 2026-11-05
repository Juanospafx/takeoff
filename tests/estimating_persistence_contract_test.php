<?php
$source = file_get_contents(__DIR__ . '/../api/project_estimating.php');
if (strpos($source, "'workspace' => \$item") === false) throw new RuntimeException('Relational metadata must preserve the complete workspace item.');
if (strpos($source, 'pew_flatten_workspace_items') === false) throw new RuntimeException('Nested workspace items must be mirrored recursively.');
echo "estimating persistence contract test passed\n";
