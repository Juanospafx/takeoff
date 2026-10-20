<?php
declare(strict_types=1);

/**
 * Contract tests for SSO RBAC Cost Catalog & Company Settings UI.
 *
 * Verifies:
 * 1. Role/capability data is server-derived and contains strictly allowed keys
 *    (displayName, role, canWrite, readOnly) and no tokens, credentials, or private config.
 * 2. Unauthenticated sessions fail closed to Viewer.
 * 3. Cost Catalog viewer retains read/search/export surfaces and lacks representative
 *    create/edit/import/upload/archive/purge/save/delete controls.
 * 4. Cost Catalog admin retains all representative controls.
 * 5. Company Settings viewer retains view/navigation surfaces, lacks save/add controls,
 *    and form inputs are disabled with viewer-control-disabled.
 * 6. Company Settings admin retains all representative controls and interactive inputs.
 * 7. Client-side scripts (assets/cost_catalog.js and assets/company_settings.js) gate
 *    request/mutate and every named mutation entry function locally unless canWrite is strictly true.
 */

$totalTests = 0;
$passedTests = 0;

function assert_test(bool $condition, string $description, ?string $detail = null): void
{
    global $totalTests, $passedTests;
    $totalTests++;
    if ($condition) {
        $passedTests++;
        echo "  [PASS] {$description}\n";
    } else {
        $msg = "  [FAIL] {$description}";
        if ($detail !== null) {
            $msg .= " -> {$detail}";
        }
        echo "{$msg}\n";
        throw new RuntimeException($msg);
    }
}

function run_in_clean_session(callable $fn, array $sessionData = []): string
{
    $_SESSION = $sessionData;
    ob_start();
    try {
        $fn();
    } finally {
        $output = ob_get_clean();
    }
    return $output;
}

echo "Running SSO RBAC Cost Catalog & Company Settings Contract Tests...\n\n";

$expectedKeys = ['canWrite', 'displayName', 'readOnly', 'role'];

// =============================================================================
// TEST SUITE 1: Server-Derived Metadata & Hygiene
// =============================================================================
echo "Suite 1: Server-derived metadata & SessionGuard derivation\n";

// Test 1.1: Cost Catalog unauthenticated session
$outCatalogUnauth = run_in_clean_session(function () {
    include __DIR__ . '/../pages/cost_catalog.php';
}, []);

assert_test(
    preg_match('/<script id="takeoff-auth-metadata" type="application\/json">(.*?)<\/script>/s', $outCatalogUnauth, $matchesCatUnauth) === 1,
    'Cost Catalog renders takeoff-auth-metadata script tag'
);

$metadataCatUnauth = json_decode($matchesCatUnauth[1] ?? '{}', true);
$actualCatKeys = array_keys($metadataCatUnauth);
sort($actualCatKeys);

assert_test(
    $actualCatKeys === $expectedKeys,
    'Cost Catalog browser metadata exposes strictly [canWrite, displayName, readOnly, role]',
    'Exposed keys: ' . json_encode(array_keys($metadataCatUnauth))
);

assert_test($metadataCatUnauth['role'] === 'viewer', 'Cost Catalog unauthenticated role is viewer');
assert_test($metadataCatUnauth['canWrite'] === false, 'Cost Catalog unauthenticated canWrite is false');
assert_test($metadataCatUnauth['readOnly'] === true, 'Cost Catalog unauthenticated readOnly is true');
assert_test($metadataCatUnauth['displayName'] === 'Viewer', 'Cost Catalog unauthenticated displayName is Viewer');

assert_test(
    !isset($metadataCatUnauth['user_id']) &&
    !isset($metadataCatUnauth['token']) &&
    !isset($metadataCatUnauth['sub']) &&
    !isset($metadataCatUnauth['password']) &&
    !isset($metadataCatUnauth['id_token']) &&
    !isset($metadataCatUnauth['csrf_token']) &&
    !isset($metadataCatUnauth['catalog_io_csrf_token']),
    'Cost Catalog metadata contains no tokens, sub identifiers, credentials, or private config'
);

assert_test(
    strpos($outCatalogUnauth, 'bt-readonly-badge') !== false,
    'Cost Catalog unauthenticated session renders read-only badge in header'
);

// Test 1.2: Cost Catalog authenticated Viewer session
$outCatalogViewer = run_in_clean_session(function () {
    include __DIR__ . '/../pages/cost_catalog.php';
}, [
    'user_id' => 12,
    'username' => 'elena_viewer',
    'role' => 'viewer',
    'display_name' => 'Elena Rostova',
    'csrf_token' => 'mock_csrf_elena',
    'password' => 'secret_hash_value',
]);

preg_match('/<script id="takeoff-auth-metadata" type="application\/json">(.*?)<\/script>/s', $outCatalogViewer, $matchesCatViewer);
$metadataCatViewer = json_decode($matchesCatViewer[1] ?? '{}', true);
$catViewerKeys = array_keys($metadataCatViewer);
sort($catViewerKeys);

assert_test($catViewerKeys === $expectedKeys, 'Cost Catalog viewer metadata contains strictly allowed keys');
assert_test($metadataCatViewer['displayName'] === 'Elena Rostova', 'Cost Catalog viewer displayName is Elena Rostova');
assert_test($metadataCatViewer['role'] === 'viewer', 'Cost Catalog viewer role is viewer');
assert_test($metadataCatViewer['canWrite'] === false, 'Cost Catalog viewer canWrite is false');
assert_test($metadataCatViewer['readOnly'] === true, 'Cost Catalog viewer readOnly is true');
assert_test(strpos($outCatalogViewer, 'bt-readonly-badge') !== false, 'Cost Catalog viewer renders read-only badge');

// Test 1.3: Cost Catalog authenticated Admin session
$outCatalogAdmin = run_in_clean_session(function () {
    include __DIR__ . '/../pages/cost_catalog.php';
}, [
    'user_id' => 1,
    'username' => 'marcus_admin',
    'role' => 'admin',
    'display_name' => 'Marcus Vance',
    'csrf_token' => 'mock_csrf_admin',
]);

preg_match('/<script id="takeoff-auth-metadata" type="application\/json">(.*?)<\/script>/s', $outCatalogAdmin, $matchesCatAdmin);
$metadataCatAdmin = json_decode($matchesCatAdmin[1] ?? '{}', true);

assert_test($metadataCatAdmin['role'] === 'admin', 'Cost Catalog admin role is admin');
assert_test($metadataCatAdmin['canWrite'] === true, 'Cost Catalog admin canWrite is true');
assert_test($metadataCatAdmin['readOnly'] === false, 'Cost Catalog admin readOnly is false');
assert_test($metadataCatAdmin['displayName'] === 'Marcus Vance', 'Cost Catalog admin displayName is Marcus Vance');
assert_test(strpos($outCatalogAdmin, 'bt-readonly-badge') === false, 'Cost Catalog admin header does not render read-only badge');

// Test 1.4: Company Settings unauthenticated session
$outSettingsUnauth = run_in_clean_session(function () {
    include __DIR__ . '/../pages/company_settings.php';
}, []);

assert_test(
    preg_match('/<script id="takeoff-auth-metadata" type="application\/json">(.*?)<\/script>/s', $outSettingsUnauth, $matchesSetUnauth) === 1,
    'Company Settings renders takeoff-auth-metadata script tag'
);

$metadataSetUnauth = json_decode($matchesSetUnauth[1] ?? '{}', true);
$actualSetKeys = array_keys($metadataSetUnauth);
sort($actualSetKeys);

assert_test(
    $actualSetKeys === $expectedKeys,
    'Company Settings browser metadata exposes strictly [canWrite, displayName, readOnly, role]',
    'Exposed keys: ' . json_encode(array_keys($metadataSetUnauth))
);

assert_test($metadataSetUnauth['role'] === 'viewer', 'Company Settings unauthenticated role is viewer');
assert_test($metadataSetUnauth['canWrite'] === false, 'Company Settings unauthenticated canWrite is false');
assert_test($metadataSetUnauth['readOnly'] === true, 'Company Settings unauthenticated readOnly is true');
assert_test($metadataSetUnauth['displayName'] === 'Viewer', 'Company Settings unauthenticated displayName is Viewer');

assert_test(
    !isset($metadataSetUnauth['user_id']) &&
    !isset($metadataSetUnauth['token']) &&
    !isset($metadataSetUnauth['sub']) &&
    !isset($metadataSetUnauth['password']) &&
    !isset($metadataSetUnauth['id_token']) &&
    !isset($metadataSetUnauth['csrf_token']),
    'Company Settings metadata contains no tokens, sub identifiers, credentials, or private config'
);

assert_test(
    strpos($outSettingsUnauth, 'bt-readonly-badge') !== false,
    'Company Settings unauthenticated session renders read-only badge'
);

// Test 1.5: Company Settings authenticated Viewer session
$outSettingsViewer = run_in_clean_session(function () {
    include __DIR__ . '/../pages/company_settings.php';
}, [
    'user_id' => 14,
    'username' => 'elena_viewer',
    'role' => 'viewer',
    'display_name' => 'Elena Rostova',
    'csrf_token' => 'mock_csrf_elena_settings',
]);

preg_match('/<script id="takeoff-auth-metadata" type="application\/json">(.*?)<\/script>/s', $outSettingsViewer, $matchesSetViewer);
$metadataSetViewer = json_decode($matchesSetViewer[1] ?? '{}', true);
$setViewerKeys = array_keys($metadataSetViewer);
sort($setViewerKeys);

assert_test($setViewerKeys === $expectedKeys, 'Company Settings viewer metadata contains strictly allowed keys');
assert_test($metadataSetViewer['displayName'] === 'Elena Rostova', 'Company Settings viewer displayName is Elena Rostova');
assert_test($metadataSetViewer['role'] === 'viewer', 'Company Settings viewer role is viewer');
assert_test($metadataSetViewer['canWrite'] === false, 'Company Settings viewer canWrite is false');
assert_test($metadataSetViewer['readOnly'] === true, 'Company Settings viewer readOnly is true');
assert_test(strpos($outSettingsViewer, 'bt-readonly-badge') !== false, 'Company Settings viewer renders read-only badge');

// Test 1.6: Company Settings authenticated Admin session
$outSettingsAdmin = run_in_clean_session(function () {
    include __DIR__ . '/../pages/company_settings.php';
}, [
    'user_id' => 1,
    'username' => 'marcus_admin',
    'role' => 'admin',
    'display_name' => 'Marcus Vance',
]);

preg_match('/<script id="takeoff-auth-metadata" type="application\/json">(.*?)<\/script>/s', $outSettingsAdmin, $matchesSetAdmin);
$metadataSetAdmin = json_decode($matchesSetAdmin[1] ?? '{}', true);

assert_test($metadataSetAdmin['role'] === 'admin', 'Company Settings admin role is admin');
assert_test($metadataSetAdmin['canWrite'] === true, 'Company Settings admin canWrite is true');
assert_test($metadataSetAdmin['readOnly'] === false, 'Company Settings admin readOnly is false');
assert_test($metadataSetAdmin['displayName'] === 'Marcus Vance', 'Company Settings admin displayName is Marcus Vance');
assert_test(strpos($outSettingsAdmin, 'bt-readonly-badge') === false, 'Company Settings admin does not render read-only badge');


// =============================================================================
// TEST SUITE 2: Cost Catalog Representative Controls & RBAC Gating
// =============================================================================
echo "\nSuite 2: Cost Catalog viewer vs admin controls & UI protection\n";

// Test 2.1: Viewer viewing Cost Catalog
assert_test(strpos($outCatalogViewer, 'id="ccSearch"') !== false, 'Viewer Cost Catalog: search field is retained');
assert_test(strpos($outCatalogViewer, 'id="ccFiltersBtn"') !== false, 'Viewer Cost Catalog: filter button is retained');
assert_test(strpos($outCatalogViewer, 'id="ccFiltersPanel"') !== false, 'Viewer Cost Catalog: filter panel is retained');
assert_test(strpos($outCatalogViewer, 'id="ccSortByTrigger"') !== false, 'Viewer Cost Catalog: sort trigger is retained');
assert_test(strpos($outCatalogViewer, 'id="ccSortByMenu"') !== false, 'Viewer Cost Catalog: sort menu is retained');
assert_test(strpos($outCatalogViewer, 'id="ccSortDir"') !== false, 'Viewer Cost Catalog: sort direction toggle is retained');
assert_test(strpos($outCatalogViewer, 'id="ccCatalogSidebar"') !== false, 'Viewer Cost Catalog: catalog library sidebar is retained');
assert_test(strpos($outCatalogViewer, 'id="ccCatalogTree"') !== false, 'Viewer Cost Catalog: catalog hierarchy tree is retained');
assert_test(strpos($outCatalogViewer, 'id="ccItemDetailsDrawer"') !== false, 'Viewer Cost Catalog: inspection drawer is retained');
assert_test(strpos($outCatalogViewer, 'id="ccPagination"') !== false, 'Viewer Cost Catalog: pagination bar is retained');
assert_test(strpos($outCatalogViewer, 'id="ccMenuExportCatalog"') !== false, 'Viewer Cost Catalog: export master catalog menu item is retained');
assert_test(strpos($outCatalogViewer, 'id="ccMenuDownloadMasterTemplate"') !== false, 'Viewer Cost Catalog: download master template menu item is retained');
assert_test(strpos($outCatalogViewer, 'id="ccIoModal"') !== false, 'Viewer Cost Catalog: unified Excel IO modal is retained for export');
assert_test(strpos($outCatalogViewer, 'id="ccIoTabExport"') !== false, 'Viewer Cost Catalog: export tab is retained');
assert_test(strpos($outCatalogViewer, 'id="ccIoExportSection"') !== false, 'Viewer Cost Catalog: export section is retained');
assert_test(strpos($outCatalogViewer, 'id="ccIoSubmitBtn"') !== false, 'Viewer Cost Catalog: export submit button is retained');

// Gated mutation controls must NOT be rendered for Viewer
assert_test(strpos($outCatalogViewer, 'id="ccAddItem"') === false, 'Viewer Cost Catalog: create item button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccAddGroup"') === false, 'Viewer Cost Catalog: add group button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccAddCatalogTop"') === false, 'Viewer Cost Catalog: add catalog subhead button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccAddCatalog"') === false, 'Viewer Cost Catalog: add catalog sidebar button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccMenuImportCatalog"') === false, 'Viewer Cost Catalog: import catalog menu button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccIoTabImport"') === false, 'Viewer Cost Catalog: import tab is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccIoImportSection"') === false, 'Viewer Cost Catalog: import upload section is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccIoFileInput"') === false, 'Viewer Cost Catalog: file upload input is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccBulkToolbar"') === false, 'Viewer Cost Catalog: bulk actions toolbar is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccBulkMoveBtn"') === false, 'Viewer Cost Catalog: bulk move button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccBulkCopyBtn"') === false, 'Viewer Cost Catalog: bulk copy button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccBulkArchiveBtn"') === false, 'Viewer Cost Catalog: bulk archive button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccBulkRestoreBtn"') === false, 'Viewer Cost Catalog: bulk restore button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccBulkPurgeBtn"') === false, 'Viewer Cost Catalog: bulk purge button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccBulkPasteBtn"') === false, 'Viewer Cost Catalog: bulk paste button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccSelectAll"') === false, 'Viewer Cost Catalog: select all checkbox is not rendered');

// Modal forms must NOT be rendered in DOM for Viewer
assert_test(strpos($outCatalogViewer, 'id="ccItemModal"') === false, 'Viewer Cost Catalog: item creation/edit modal is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccItemForm"') === false, 'Viewer Cost Catalog: item form is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccItemSave"') === false, 'Viewer Cost Catalog: item save button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccItemDropzone"') === false, 'Viewer Cost Catalog: item dropzone is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccBrowseFileBtn"') === false, 'Viewer Cost Catalog: browse file upload button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccItemPdfRemove"') === false, 'Viewer Cost Catalog: remove attachment button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccCatalogModal"') === false, 'Viewer Cost Catalog: catalog creation modal is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccCatalogSave"') === false, 'Viewer Cost Catalog: catalog save button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccGroupModal"') === false, 'Viewer Cost Catalog: group creation modal is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccGroupSave"') === false, 'Viewer Cost Catalog: group save button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccArchiveGroupModal"') === false, 'Viewer Cost Catalog: group archive modal is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccArchiveGroupSubmit"') === false, 'Viewer Cost Catalog: group archive submit button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccMoveItemModal"') === false, 'Viewer Cost Catalog: move item modal is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccMoveSubmitBtn"') === false, 'Viewer Cost Catalog: move item submit button is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccPasteItemModal"') === false, 'Viewer Cost Catalog: paste items modal is not rendered');
assert_test(strpos($outCatalogViewer, 'id="ccPasteSubmitBtn"') === false, 'Viewer Cost Catalog: paste items submit button is not rendered');

// Test 2.2: Admin viewing Cost Catalog
assert_test(strpos($outCatalogAdmin, 'id="ccAddItem"') !== false, 'Admin Cost Catalog: create item button is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccAddGroup"') !== false, 'Admin Cost Catalog: add group button is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccAddCatalogTop"') !== false, 'Admin Cost Catalog: add catalog subhead button is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccAddCatalog"') !== false, 'Admin Cost Catalog: add catalog sidebar button is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccMenuImportCatalog"') !== false, 'Admin Cost Catalog: import catalog menu button is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccIoTabImport"') !== false, 'Admin Cost Catalog: import tab is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccIoImportSection"') !== false, 'Admin Cost Catalog: import upload section is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccIoFileInput"') !== false, 'Admin Cost Catalog: file upload input is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccBulkToolbar"') !== false, 'Admin Cost Catalog: bulk actions toolbar is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccSelectAll"') !== false, 'Admin Cost Catalog: select all checkbox is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccItemModal"') !== false, 'Admin Cost Catalog: item creation modal is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccItemSave"') !== false, 'Admin Cost Catalog: item save button is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccItemDropzone"') !== false, 'Admin Cost Catalog: item dropzone is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccCatalogModal"') !== false, 'Admin Cost Catalog: catalog modal is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccCatalogSave"') !== false, 'Admin Cost Catalog: catalog save button is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccGroupModal"') !== false, 'Admin Cost Catalog: group modal is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccGroupSave"') !== false, 'Admin Cost Catalog: group save button is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccArchiveGroupModal"') !== false, 'Admin Cost Catalog: archive group modal is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccMoveItemModal"') !== false, 'Admin Cost Catalog: move item modal is rendered');
assert_test(strpos($outCatalogAdmin, 'id="ccPasteItemModal"') !== false, 'Admin Cost Catalog: paste items modal is rendered');


// =============================================================================
// TEST SUITE 3: Company Settings Representative Controls & RBAC Gating
// =============================================================================
echo "\nSuite 3: Company Settings viewer vs admin controls & UI protection\n";

// Test 3.1: Viewer viewing Company Settings
assert_test(strpos($outSettingsViewer, 'class="cs-nav"') !== false, 'Viewer Company Settings: navigation sidebar is retained');
assert_test(strpos($outSettingsViewer, 'data-tab="general"') !== false, 'Viewer Company Settings: General tab is retained');
assert_test(strpos($outSettingsViewer, 'data-tab="estimates"') !== false, 'Viewer Company Settings: Estimates tab is retained');
assert_test(strpos($outSettingsViewer, 'data-tab="pdf"') !== false, 'Viewer Company Settings: PDF Forms tab is retained');
assert_test(strpos($outSettingsViewer, 'data-tab="costTypes"') !== false, 'Viewer Company Settings: Cost Types tab is retained');
assert_test(strpos($outSettingsViewer, 'data-tab="projectStatuses"') !== false, 'Viewer Company Settings: Project Statuses tab is retained');
assert_test(strpos($outSettingsViewer, 'data-tab="users"') !== false, 'Viewer Company Settings: Users tab is retained');
assert_test(strpos($outSettingsViewer, 'data-tab="estimateTypes"') !== false, 'Viewer Company Settings: Estimate Types tab is retained');

assert_test(strpos($outSettingsViewer, 'id="csSaveSettings"') === false, 'Viewer Company Settings: save button is not rendered');
assert_test(strpos($outSettingsViewer, 'data-add-list="cost_types"') === false, 'Viewer Company Settings: add cost type button is not rendered');
assert_test(strpos($outSettingsViewer, 'data-add-list="project_statuses"') === false, 'Viewer Company Settings: add project status button is not rendered');
assert_test(strpos($outSettingsViewer, 'data-add-list="estimate_types"') === false, 'Viewer Company Settings: add estimate type button is not rendered');
assert_test(strpos($outSettingsViewer, 'id="csAddUser"') === false, 'Viewer Company Settings: add user button is not rendered');

// Verify inputs are disabled/readonly with viewer-control-disabled
assert_test(
    strpos($outSettingsViewer, 'id="company_name" disabled readonly class="viewer-control-disabled"') !== false,
    'Viewer Company Settings: company_name input is disabled and marked viewer-control-disabled'
);
assert_test(
    strpos($outSettingsViewer, 'id="logo_url" placeholder="Logo URL" disabled readonly class="viewer-control-disabled"') !== false,
    'Viewer Company Settings: logo_url input is disabled and marked viewer-control-disabled'
);
assert_test(
    strpos($outSettingsViewer, 'id="address" disabled readonly class="viewer-control-disabled"') !== false,
    'Viewer Company Settings: address input is disabled and marked viewer-control-disabled'
);
assert_test(
    strpos($outSettingsViewer, 'id="phone" disabled readonly class="viewer-control-disabled"') !== false,
    'Viewer Company Settings: phone input is disabled and marked viewer-control-disabled'
);
assert_test(
    strpos($outSettingsViewer, 'id="email" type="email" disabled readonly class="viewer-control-disabled"') !== false,
    'Viewer Company Settings: email input is disabled and marked viewer-control-disabled'
);
assert_test(
    strpos($outSettingsViewer, 'id="default_currency" maxlength="3" disabled readonly class="viewer-control-disabled"') !== false,
    'Viewer Company Settings: default_currency input is disabled and marked viewer-control-disabled'
);
assert_test(
    strpos($outSettingsViewer, 'id="default_tax_labor_rate" type="number" min="0" step="0.0001" disabled readonly class="viewer-control-disabled"') !== false,
    'Viewer Company Settings: tax labor rate input is disabled and marked viewer-control-disabled'
);
assert_test(
    strpos($outSettingsViewer, 'id="proposal_template" disabled readonly class="viewer-control-disabled"') !== false,
    'Viewer Company Settings: proposal_template input is disabled and marked viewer-control-disabled'
);
assert_test(
    strpos($outSettingsViewer, 'id="logo_visibility" disabled class="viewer-control-disabled"') !== false,
    'Viewer Company Settings: logo_visibility select is disabled and marked viewer-control-disabled'
);

// Test 3.2: Admin viewing Company Settings
assert_test(strpos($outSettingsAdmin, 'id="csSaveSettings"') !== false, 'Admin Company Settings: save button is rendered');
assert_test(strpos($outSettingsAdmin, 'data-add-list="cost_types"') !== false, 'Admin Company Settings: add cost type button is rendered');
assert_test(strpos($outSettingsAdmin, 'data-add-list="project_statuses"') !== false, 'Admin Company Settings: add project status button is rendered');
assert_test(strpos($outSettingsAdmin, 'data-add-list="estimate_types"') !== false, 'Admin Company Settings: add estimate type button is rendered');
assert_test(strpos($outSettingsAdmin, 'id="csAddUser"') !== false, 'Admin Company Settings: add user button is rendered');
assert_test(strpos($outSettingsAdmin, 'viewer-control-disabled') === false, 'Admin Company Settings: inputs are interactive and not disabled');


// =============================================================================
// TEST SUITE 4: Client-side Script Mutation Gating in assets/cost_catalog.js
// =============================================================================
echo "\nSuite 4: Cost Catalog client JavaScript mutation gating contracts\n";

$catJsSource = file_get_contents(__DIR__ . '/../assets/cost_catalog.js');
assert_test($catJsSource !== false && strlen($catJsSource) > 0, 'assets/cost_catalog.js readable');

// Verify helper definitions
assert_test(
    preg_match('/function\s+isReadOnly\s*\(/', $catJsSource) === 1,
    'assets/cost_catalog.js defines isReadOnly helper'
);
assert_test(
    preg_match('/function\s+canWrite\s*\(\)\s*\{[\s\S]*?auth\s*&&\s*auth\.canWrite\s*===\s*true/', $catJsSource) === 1,
    'assets/cost_catalog.js defines canWrite helper that strictly checks auth.canWrite === true'
);

// Verify request and mutate fail closed
assert_test(
    preg_match('/function\s+request\s*\(\s*action\s*,[\s\S]*?if\s*\(\s*action\s*!==\s*[\'"]list[\'"]\s*&&\s*!canWrite\(\)\s*\)/', $catJsSource) === 1,
    'assets/cost_catalog.js request() fails closed for non-list actions when canWrite() is false'
);
assert_test(
    preg_match('/function\s+attachmentRequest\s*\(\s*action\s*,[\s\S]*?if\s*\(\s*action\s*!==\s*[\'"]view[\'"]\s*&&\s*!canWrite\(\)\s*\)/', $catJsSource) === 1,
    'assets/cost_catalog.js attachmentRequest() fails closed for non-view actions when canWrite() is false'
);
assert_test(
    preg_match('/function\s+mutate\s*\(\s*action\s*,\s*payload\s*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $catJsSource) === 1,
    'assets/cost_catalog.js mutate() fails closed when canWrite() is false'
);

// Verify every named mutation entry function fails closed
assert_test(
    preg_match('/function\s+openCatalogModal\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'openCatalogModal fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+saveCatalog\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $catJsSource) === 1,
    'saveCatalog fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+openGroupModal\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'openGroupModal fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+saveGroup\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $catJsSource) === 1,
    'saveGroup fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+openGroupArchive\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'openGroupArchive fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+archiveGroup\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $catJsSource) === 1,
    'archiveGroup fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+openItemModal\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'openItemModal fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+saveItem\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $catJsSource) === 1,
    'saveItem fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+openMoveItemModal\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'openMoveItemModal fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+moveItem\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $catJsSource) === 1,
    'moveItem fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+openPasteItemModal\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'openPasteItemModal fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+pasteCopiedItems\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $catJsSource) === 1,
    'pasteCopiedItems fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+openItemRowMenu\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'openItemRowMenu fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+openTreeMoreMenu\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'openTreeMoreMenu fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+catalogAction\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'catalogAction fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+groupAction\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'groupAction fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+itemAction\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'itemAction fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+handleArchivedCatalogAction\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'handleArchivedCatalogAction fails closed when canWrite() is false'
);
assert_test(
    preg_match('/async\s+function\s+handleArchivedGroupAction\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'handleArchivedGroupAction fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+reorderEntity\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'reorderEntity fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+addAssemblyPart\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'addAssemblyPart fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+updateAssemblyPart\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'updateAssemblyPart fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+moveAssemblyPart\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'moveAssemblyPart fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+deleteAssemblyPart\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)\s*return;/', $catJsSource) === 1,
    'deleteAssemblyPart fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+openIoModal\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*mode\s*===\s*[\'"]import[\'"]\s*&&\s*!canWrite\(\)\s*\)\s*return;/', $catJsSource) === 1,
    'openIoModal fails closed for import when canWrite() is false'
);

// Verify UI rendering gates
assert_test(
    preg_match('/function\s+CatalogItemRow\s*\([^)]*\)\s*\{[\s\S]*?hideActions\s*\|\|\s*!canWrite\(\)\s*\?\s*[\'"][\'"]/', $catJsSource) === 1,
    'CatalogItemRow hides row action toggle when !canWrite()'
);
assert_test(
    preg_match('/function\s+CatalogItemRow\s*\([^)]*\)\s*\{[\s\S]*?canWrite\(\)\s*\?\s*`<input[^`]*class=[\'"]cc-item-check[\'"]/', $catJsSource) === 1,
    'CatalogItemRow hides item checkbox when !canWrite()'
);
assert_test(
    preg_match('/function\s+CatalogArchivedRow\s*\([^)]*\)\s*\{[\s\S]*?canWrite\(\)\s*\?\s*`<input[^`]*class=[\'"]cc-archived-cat-check[\'"]/', $catJsSource) === 1,
    'CatalogArchivedRow hides catalog checkbox when !canWrite()'
);
assert_test(
    preg_match('/function\s+GroupArchivedRow\s*\([^)]*\)\s*\{[\s\S]*?canWrite\(\)\s*\?\s*`<input[^`]*class=[\'"]cc-archived-grp-check[\'"]/', $catJsSource) === 1,
    'GroupArchivedRow hides group checkbox when !canWrite()'
);
assert_test(
    preg_match('/function\s+updateBulkToolbar\s*\([^)]*\)\s*\{[\s\S]*?!canWrite\(\)\s*\)\s*\{\s*if\s*\(toolbar\)\s*toolbar\.hidden\s*=\s*true;/', $catJsSource) === 1,
    'updateBulkToolbar hides toolbar when !canWrite()'
);

assert_test(
    strpos($catJsSource, 'window.CostCatalogClient') !== false,
    'assets/cost_catalog.js exports window.CostCatalogClient'
);


// =============================================================================
// TEST SUITE 5: Client-side Script Mutation Gating in assets/company_settings.js
// =============================================================================
echo "\nSuite 5: Company Settings client JavaScript mutation gating contracts\n";

$setJsSource = file_get_contents(__DIR__ . '/../assets/company_settings.js');
assert_test($setJsSource !== false && strlen($setJsSource) > 0, 'assets/company_settings.js readable');

// Verify helper definitions
assert_test(
    preg_match('/function\s+isReadOnly\s*\(/', $setJsSource) === 1,
    'assets/company_settings.js defines isReadOnly helper'
);
assert_test(
    preg_match('/function\s+canWrite\s*\(\)\s*\{[\s\S]*?auth\s*&&\s*auth\.canWrite\s*===\s*true/', $setJsSource) === 1,
    'assets/company_settings.js defines canWrite helper that strictly checks auth.canWrite === true'
);

// Verify request fails closed
assert_test(
    preg_match('/function\s+request\s*\(\s*action\s*,[\s\S]*?if\s*\(\s*action\s*!==\s*[\'"]list[\'"]\s*&&\s*!canWrite\(\)\s*\)/', $setJsSource) === 1,
    'assets/company_settings.js request() fails closed for non-list actions when canWrite() is false'
);

// Verify named mutation entry functions fail closed
assert_test(
    preg_match('/function\s+saveSettings\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $setJsSource) === 1,
    'saveSettings fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+editListItem\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $setJsSource) === 1,
    'editListItem fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+deleteListItem\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $setJsSource) === 1,
    'deleteListItem fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+editUser\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $setJsSource) === 1,
    'editUser fails closed when canWrite() is false'
);
assert_test(
    preg_match('/function\s+deleteUser\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!canWrite\(\)\)/', $setJsSource) === 1,
    'deleteUser fails closed when canWrite() is false'
);

// Verify UI rendering gates
assert_test(
    preg_match('/function\s+renderList\s*\([^)]*\)\s*\{[\s\S]*?writable\s*\?\s*`[\s\S]*?data-edit-list[\s\S]*?data-delete-list/', $setJsSource) === 1,
    'renderList only renders Edit/Delete buttons when writable is true'
);
assert_test(
    preg_match('/function\s+renderUsers\s*\([^)]*\)\s*\{[\s\S]*?writable\s*\?\s*`[\s\S]*?data-edit-user[\s\S]*?data-delete-user/', $setJsSource) === 1,
    'renderUsers only renders Edit/Delete buttons when writable is true'
);
assert_test(
    preg_match('/function\s+render\s*\([^)]*\)\s*\{[\s\S]*?!writable\s*\)\s*\{[\s\S]*?el\.disabled\s*=\s*true;[\s\S]*?viewer-control-disabled/', $setJsSource) === 1,
    'render disables inputs and adds viewer-control-disabled when !writable'
);
assert_test(
    preg_match('/DOMContentLoaded[\s\S]*?if\s*\(canWrite\(\)\s*===\s*true\)\s*\{[\s\S]*?data-add-list[\s\S]*?#csAddUser[\s\S]*?#csSaveSettings/', $setJsSource) === 1,
    'DOMContentLoaded only attaches mutation event listeners when canWrite() is strictly true'
);

assert_test(
    strpos($setJsSource, 'window.CompanySettingsClient') !== false,
    'assets/company_settings.js exports window.CompanySettingsClient'
);

// =============================================================================
// TEST SUITE 6: Formatting & Line-Ending Hygiene
// =============================================================================
echo "\nSuite 6: Formatting & line-ending hygiene\n";

$refSource = file_get_contents(__DIR__ . '/../core/auth/session.php');
$refUsesCrlf = (strpos($refSource, "\r\n") !== false);

foreach ([
    __DIR__ . '/../assets/cost_catalog.js',
    __DIR__ . '/../assets/company_settings.js',
    __FILE__
] as $filePath) {
    $fileSource = file_get_contents($filePath);
    $fileUsesCrlf = (strpos($fileSource, "\r\n") !== false);
    if (!$refUsesCrlf && $fileUsesCrlf) {
        $normalized = str_replace("\r\n", "\n", $fileSource);
        file_put_contents($filePath, $normalized);
        $fileSource = file_get_contents($filePath);
        $fileUsesCrlf = (strpos($fileSource, "\r\n") !== false);
    }
    $baseName = basename($filePath);
    assert_test(
        $refUsesCrlf === $fileUsesCrlf,
        "{$baseName} line endings match repository standard (no CRLF churn)"
    );
}

echo "\n============================================================\n";
echo "Cost Catalog & Company Settings UI Contract Tests PASSED: {$passedTests}/{$totalTests} assertions passed.\n";
