<?php
$content = file_get_contents(__DIR__ . '/../pages/project_dashboard.php');
$errors = [];

if (strpos($content, 'id="proposalEstimateTypesFooter"') === false) {
    $errors[] = 'proposalEstimateTypesFooter not found';
}
if (strpos($content, 'class="est-version-bar project-estimate-footer" id="proposalEstimateTypesFooter"') === false) {
    $errors[] = 'project-estimate-footer class missing on footer';
}
if (strpos($content, "project_proposal.css?v=<?= filemtime(__DIR__ . '/../assets/project_proposal.css') ?>") === false) {
    $errors[] = 'css filemtime missing';
}
if (strpos($content, "project_proposal.js?v=<?= filemtime(__DIR__ . '/../assets/project_proposal.js') ?>") === false) {
    $errors[] = 'js filemtime missing';
}

if (!empty($errors)) {
    echo "FAILED:\n" . implode("\n", $errors) . "\n";
    exit(1);
}

echo "SUCCESS: Dashboard Proposal markup & assets verified!\n";

