<?php
$ctx = stream_context_create(['http' => ['timeout' => 5]]);
$html = @file_get_contents('http://localhost/takeoff/pages/project_dashboard.php?project_id=6', false, $ctx);
if ($html === false) {
    echo "Failed to fetch HTTP.\n";
} else {
    echo "HTTP fetch OK, length: " . strlen($html) . "\n";
    // Check if estimating module is included
    if (strpos($html, 'id="estimatingModule"') !== false) {
        echo "estimatingModule found in HTML\n";
    }
}

