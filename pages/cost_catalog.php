<?php
// Standalone Cost Catalog module with Brightronix DNA & Procore style.
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cost Catalog | Brightronix</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../assets/global_tools.css?v=<?= time() ?>">
    <script>
        (function () {
            try {
                var saved = localStorage.getItem('takeoff.theme');
                var urlTheme = null;
                try {
                    urlTheme = new URLSearchParams(window.location.search).get('theme');
                } catch (e) { }
                var theme = (urlTheme === 'dark' || urlTheme === 'light') ? urlTheme : ((saved === 'dark' || saved === 'light') ? saved : 'light');
                document.documentElement.setAttribute('data-theme', theme);
                document.addEventListener('DOMContentLoaded', function () {
                    document.body.classList.toggle('theme-light', theme === 'light');
                    document.body.classList.toggle('theme-dark', theme === 'dark');
                });
            } catch (error) {
                document.documentElement.setAttribute('data-theme', 'light');
            }
        })();
    </script>
    <link rel="stylesheet" href="../assets/cost_catalog.css?v=<?= time() ?>">
</head>
<body>
<?php include __DIR__ . '/../views/global_tools_header.php'; ?>

<div class="cc-shell" id="ccShell">
    <!-- Unified Floating Sub-Header & Context Actions Bar (Identical to Project Dashboard) -->
    <div class="cc-subhead-wrapper project-subhead-wrapper" id="ccSubheadWrapper">
        <header class="project-header cc-project-header">
            <div class="pd-header-left">
                <div class="project-title-row">
                    <h1 id="ccTitle" class="pd-project-title">Cost Catalog</h1>
                    <div class="project-status-wrap">
                        <span class="cc-context-badge catalog-badge" id="ccCatalogBadge" title="Current catalog scope">
                            <i class="fas fa-book"></i>
                            <span id="ccCatalogContext">All Catalogs</span>
                        </span>
                        <span class="cc-context-badge group-badge" id="ccGroupBadge" title="Current group scope">
                            <i class="fas fa-folder"></i>
                            <span id="ccGroupContext">All Groups</span>
                        </span>
                    </div>
                </div>
                <div class="project-meta-line cc-meta-line">
                    <span id="ccSubtitle">Browse catalog items by catalog, group or subgroup.</span>
                    <nav class="cc-breadcrumb" id="ccBreadcrumb" aria-label="Catalog breadcrumb"></nav>
                </div>
            </div>
            <div class="project-header-actions cc-header-actions">
                <button class="bb-btn-procore-primary" id="ccAddItem" type="button">
                    <i class="fas fa-plus"></i> Create New Item
                </button>
                <button class="bb-control-btn cc-btn-head" id="ccAddGroup" type="button" title="Create group in current catalog">
                    <i class="fas fa-folder-plus"></i> Add Group
                </button>
                <button class="bb-control-btn cc-btn-head" id="ccAddCatalogTop" type="button" title="Create new catalog library">
                    <i class="fas fa-book-medical"></i> Add Catalog
                </button>
                <div class="cc-header-menu-wrap" style="position: relative; display: inline-block;">
                    <button class="bb-control-btn cc-btn-head" id="ccMoreActionsBtn" type="button" title="More options (Excel Import / Export / Templates)" aria-label="More options" aria-expanded="false" style="padding: 0 10px;">
                        <i class="fas fa-ellipsis-vertical"></i>
                    </button>
                    <div class="cc-row-item-floating-menu" id="ccHeaderMoreMenu" hidden style="position: absolute; right: 0; top: calc(100% + 4px); z-index: 1000; min-width: 200px; box-shadow: 0 4px 16px rgba(0,0,0,0.15);">
                        <button type="button" id="ccMenuExportCatalog">Export Master Catalog</button>
                        <button type="button" id="ccMenuImportCatalog">Import Master Catalog</button>
                        <div class="cc-menu-divider" style="height: 1px; background: var(--border-soft); margin: 4px 0;"></div>
                        <button type="button" id="ccMenuDownloadMasterTemplate">Download Master Template</button>
                    </div>
                </div>
            </div>
        </header>
    </div>

    <!-- Alert banner -->
    <div id="ccError" class="cc-error-alert" style="display:none;" role="alert"></div>

    <!-- Page Body: Sidebar + Main Content Table fixed to page height -->
    <div class="cc-page-body">
        <!-- Sidebar: Catalog Library Navigation -->
        <aside class="cc-catalog-sidebar" id="ccCatalogSidebar" aria-label="Catalog library navigation">
            <div class="cc-sidebar-head">
                <div class="cc-sidebar-head-left">
                    <span class="cc-sidebar-eyebrow">Company Tool</span>
                    <strong class="cc-sidebar-title">Catalog Library</strong>
                </div>
                <button class="pro-add-btn" id="ccAddCatalog" type="button" title="Add catalog" aria-label="Add catalog">
                    <i class="fas fa-plus" aria-hidden="true"></i>
                </button>
            </div>
            <div class="cc-sidebar-nav-fixed">
                <button class="cc-tree-row static-view active" data-view="all" type="button">
                    <i class="fas fa-layer-group" aria-hidden="true"></i>
                    <span>All Catalog Items</span>
                </button>
                <button class="cc-tree-row static-view" data-view="recent" type="button">
                    <i class="far fa-clock" aria-hidden="true"></i>
                    <span>Most Recently Used</span>
                </button>
            </div>
            <div class="cc-tree-divider">
                <span>Catalogs</span>
            </div>
            <div class="cc-sidebar-tree-wrap" id="ccCatalogTree" role="tree" aria-label="Catalogs and groups"></div>
            
            <div class="cc-tree-divider">
                <span>Special Views</span>
            </div>
            <div class="cc-sidebar-nav-bottom">
                <button class="cc-tree-row static-view" data-view="unassigned" type="button" title="Items without catalog or group">
                    <i class="fas fa-folder-open" aria-hidden="true"></i>
                    <span>Unassigned Items</span>
                    <span class="cc-tree-count" id="ccUnassignedCount">0</span>
                </button>
                <button class="cc-tree-row static-view" data-view="archived" type="button" title="Archived catalog items">
                    <i class="fas fa-box-archive" aria-hidden="true"></i>
                    <span>Archived Items</span>
                    <span class="cc-tree-count" id="ccArchivedCount">0</span>
                </button>
            </div>
        </aside>

        <!-- Sidebar Draggable Resizer Slider -->
        <div class="cc-sidebar-resizer" id="ccSidebarResizer" title="Drag to resize sidebar">
            <div class="cc-resizer-handle"></div>
        </div>

        <!-- Main Section: Table Shell (Matching Bid Board Table Shell & Cards) -->
        <main class="cc-main">
            <section class="cc-table-section bb-card-container" aria-label="Cost catalog items">
                <!-- Table Controls Bar -->
                <div class="cc-table-controls bb-table-controls">
                    <div class="cc-table-controls-left bb-table-controls-left">
                        <div class="bb-search-field-procore cc-search-procore">
                            <input id="ccSearch" type="search" placeholder="Search catalog items, codes, descriptions..." autocomplete="off">
                            <button class="bb-search-submit" type="button" aria-label="Search">
                                <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    <div class="cc-table-controls-right bb-table-controls-right">
                        <!-- Bulk Actions Toolbar (Requests 1, 13 & 14 styled like takeoffSubheadItemInfo) -->
                        <div class="cc-bulk-toolbar takeoff-subhead-item-info" id="ccBulkToolbar" hidden title="Bulk actions">
                            <div class="takeoff-subhead-item-main">
                                <span class="cc-bulk-count takeoff-subhead-item-meta" id="ccBulkCount">0 selected</span>
                            </div>
                            <div class="takeoff-subhead-item-divider cc-bulk-divider"></div>
                            <div class="takeoff-subhead-item-actions cc-bulk-actions-group" id="ccBulkActionsNormal">
                                <button type="button" class="subhead-item-act-btn cc-bulk-btn move" id="ccBulkMoveBtn" title="Move selected items to another catalog/group">
                                    <i class="fas fa-arrows-split-up-and-left"></i><span>Move</span>
                                </button>
                                <button type="button" class="subhead-item-act-btn cc-bulk-btn copy" id="ccBulkCopyBtn" title="Copy selected items">
                                    <i class="fas fa-copy"></i><span>Copy</span>
                                </button>
                                <button type="button" class="subhead-item-act-btn danger cc-bulk-btn archive" id="ccBulkArchiveBtn" title="Archive selected items">
                                    <i class="fas fa-box-archive"></i><span>Archive</span>
                                </button>
                            </div>
                            <div class="takeoff-subhead-item-actions cc-bulk-actions-group" id="ccBulkActionsArchived" hidden>
                                <button type="button" class="subhead-item-act-btn cc-bulk-btn restore" id="ccBulkRestoreBtn" title="Restore selected items">
                                    <i class="fas fa-rotate-left"></i><span>Restore</span>
                                </button>
                                <button type="button" class="subhead-item-act-btn danger cc-bulk-btn purge" id="ccBulkPurgeBtn" title="Permanently delete selected items">
                                    <i class="fas fa-trash-can"></i><span>Delete Permanently</span>
                                </button>
                            </div>
                            <div class="takeoff-subhead-item-actions cc-bulk-actions-group" id="ccBulkActionsPaste" hidden>
                                <button type="button" class="subhead-item-act-btn cc-bulk-btn paste" id="ccBulkPasteBtn" title="Paste copied items">
                                    <i class="fas fa-paste"></i><span>Paste</span>
                                </button>
                            </div>
                            <div class="takeoff-subhead-item-divider cc-bulk-divider"></div>
                            <button type="button" class="subhead-item-act-btn icon-only cc-bulk-cancel-btn" id="ccBulkCancelBtn" title="Cancel selection">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="bt-selector-wrap" id="ccSortByWrap">
                            <button class="bt-selector bt-company-tools-trigger bt-field-selector" id="ccSortByTrigger" type="button" aria-expanded="false" aria-haspopup="listbox" title="Sort items">
                                <div class="bt-picker-lines">
                                    <span class="bt-picker-top">Sort By</span>
                                    <strong class="bt-picker-bottom" id="ccSortByText">Item name</strong>
                                </div>
                                <i class="fas fa-caret-down bt-picker-caret"></i>
                            </button>
                            <div class="bt-small-menu bt-field-menu" id="ccSortByMenu" role="listbox" hidden>
                                <div class="bt-field-menu-eyebrow">Sort items by</div>
                                <div class="bt-field-menu-options">
                                    <button type="button" class="bt-field-option active" data-value="name">
                                        <span>Item name</span>
                                        <i class="fas fa-check bt-option-check"></i>
                                    </button>
                                    <button type="button" class="bt-field-option" data-value="cost">
                                        <span>Unit cost</span>
                                        <i class="fas fa-check bt-option-check"></i>
                                    </button>
                                    <button type="button" class="bt-field-option" data-value="labor">
                                        <span>Labor time</span>
                                        <i class="fas fa-check bt-option-check"></i>
                                    </button>
                                    <button type="button" class="bt-field-option" data-value="catalog">
                                        <span>Catalog</span>
                                        <i class="fas fa-check bt-option-check"></i>
                                    </button>
                                    <button type="button" class="bt-field-option" data-value="created">
                                        <span>Date created</span>
                                        <i class="fas fa-check bt-option-check"></i>
                                    </button>
                                    <button type="button" class="bt-field-option" data-value="updated">
                                        <span>Date updated</span>
                                        <i class="fas fa-check bt-option-check"></i>
                                    </button>
                                </div>
                            </div>
                            <select id="ccSortBy" class="bb-visually-hidden" aria-hidden="true" tabindex="-1">
                                <option value="name" selected>Item name</option>
                                <option value="cost">Unit cost</option>
                                <option value="labor">Labor time</option>
                                <option value="catalog">Catalog</option>
                                <option value="created">Date created</option>
                                <option value="updated">Date updated</option>
                            </select>
                        </div>
                        <button class="bb-control-btn" id="ccSortDir" type="button" aria-label="Sort descending" title="Toggle sort direction">
                            <i class="fas fa-arrow-down-wide-short" aria-hidden="true"></i>
                        </button>
                        <button class="bb-control-btn" id="ccFiltersBtn" type="button" title="Toggle Filters" aria-label="Filters">
                            <i class="fas fa-filter" aria-hidden="true"></i>
                            <span class="bb-filter-badge" id="ccFilterActiveBadge" hidden>0</span>
                        </button>
                        <div class="cc-result-count-badge">
                            <span class="cc-result-count" id="ccResultCount" aria-live="polite">0 items</span>
                        </div>
                    </div>
                </div>

                <!-- Expandable Filters Panel (Matching Bid Board Filter Panel) -->
                <div class="bb-filters-panel cc-filters-panel" id="ccFiltersPanel" hidden>
                    <div class="bb-filters-grid cc-filters-grid">
                        <div class="bb-filter-col">
                            <label for="ccTypeFilter">Item Type</label>
                            <select id="ccTypeFilter">
                                <option value="all">All Types</option>
                                <option value="part">Part / Material</option>
                                <option value="labor">Labor</option>
                                <option value="equipment">Equipment</option>
                                <option value="travel">Travel</option>
                                <option value="assembly">Assembly</option>
                            </select>
                        </div>
                        <div class="bb-filter-col">
                            <label for="ccMeasurementFilter">Measurement Type</label>
                            <select id="ccMeasurementFilter">
                                <option value="all">All Measurements</option>
                                <option value="count">Count (ea)</option>
                                <option value="linear">Linear (ft)</option>
                                <option value="area">Area (sqft)</option>
                                <option value="volume">Volume (cuyd)</option>
                            </select>
                        </div>
                        <div class="bb-filter-col">
                            <label for="ccStatusFilter">Record Status</label>
                            <select id="ccStatusFilter">
                                <option value="active">Active Only</option>
                                <option value="all">Active + Archived</option>
                                <option value="archived">Archived Only</option>
                            </select>
                        </div>
                        <div class="bb-filter-col">
                            <label for="ccUomFilter">Unit of Measure (UoM)</label>
                            <select id="ccUomFilter">
                                <option value="all">All Units</option>
                            </select>
                        </div>
                    </div>
                    <div class="bb-filters-footer">
                        <div class="bb-filters-meta">
                            <span id="ccFiltersMatchCount">Showing all items</span>
                        </div>
                        <div class="bb-filters-actions">
                            <button class="bb-btn-ghost" id="ccClearFilters" type="button">Clear Filters</button>
                            <button class="bb-btn-procore-primary small" id="ccApplyFiltersBtn" type="button">Apply Filters</button>
                        </div>
                    </div>
                </div>

                <!-- Archived Library Information and Filter Bar (shown when viewing archived) -->
                <div id="ccArchivedHeaderArea" hidden></div>

                <!-- Table + Drawer In-Plane Workspace Shell -->
                <div class="cc-table-workspace" id="ccTableWorkspace">
                    <!-- Left side: Table + Pagination Column -->
                    <div class="cc-table-content-col" id="ccTableContentCol">
                        <!-- Internal Table Scroll Shell (Matching Bid Board Table Shell) -->
                        <div class="cc-table-wrap bb-table-scroll" id="ccTableWrap">
                            <table class="cc-table bb-table">
                                <thead>
                                    <tr>
                                        <th class="col-check"><input type="checkbox" id="ccSelectAll" aria-label="Select all items"></th>
                                        <th class="col-name">Item Name</th>
                                        <th class="col-uom">UoM</th>
                                        <th class="col-cost">Unit Cost</th>
                                        <th class="col-labor">Labor Time</th>
                                        <th class="col-cat">Catalog</th>
                                        <th class="col-group">Group</th>
                                        <th class="col-actions"><span class="sr-only">Actions</span></th>
                                    </tr>
                                </thead>
                                <tbody id="ccItemsBody">
                                    <tr class="cc-loading-row">
                                        <td colspan="8">
                                            <div class="cc-table-loader">
                                                <i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i>
                                                <span>Loading catalog items…</span>
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Table Pagination Bar -->
                        <div class="cc-pagination" id="ccPagination" aria-label="Catalog items pagination">
                            <div class="cc-pagination-info" id="ccPaginationInfo">
                                Showing <span id="ccPageStart">0</span>–<span id="ccPageEnd">0</span> of <span id="ccPageTotal">0</span> items
                            </div>
                            <div class="cc-pagination-controls" id="ccPaginationControls">
                                <button type="button" class="cc-page-btn" id="ccPageFirst" title="First page" aria-label="First page" disabled>
                                    <i class="fas fa-angles-left" aria-hidden="true"></i>
                                </button>
                                <button type="button" class="cc-page-btn" id="ccPagePrev" title="Previous page" aria-label="Previous page" disabled>
                                    <i class="fas fa-angle-left" aria-hidden="true"></i>
                                </button>
                                <div class="cc-pagination-numbers" id="ccPaginationNumbers"></div>
                                <button type="button" class="cc-page-btn" id="ccPageNext" title="Next page" aria-label="Next page" disabled>
                                    <i class="fas fa-angle-right" aria-hidden="true"></i>
                                </button>
                                <button type="button" class="cc-page-btn" id="ccPageLast" title="Last page" aria-label="Last page" disabled>
                                    <i class="fas fa-angles-right" aria-hidden="true"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- In-Plane Right Side Drawer for Item Details Inspection -->
                    <aside class="cc-details-drawer" id="ccItemDetailsDrawer" aria-labelledby="ccItemDetailsTitle" aria-hidden="true" tabindex="-1">
                        <header class="cc-details-head">
                            <div>
                                <span class="cc-sidebar-eyebrow">Item Inspection</span>
                                <h2 id="ccItemDetailsTitle">Item Details</h2>
                            </div>
                            <button class="pd-modal-head-close" type="button" id="ccCloseItemDetails" aria-label="Close item details">
                                <i class="fas fa-times" aria-hidden="true"></i>
                            </button>
                        </header>
                        <div class="cc-details-body" id="ccItemDetailsBody"></div>
                    </aside>
                </div>
            </section>
        </main>
    </div>
</div>

<!-- Modal 1: Create / Edit Catalog Item (Procore / Project Dashboard Style) -->
<div class="cc-modal-backdrop pd-modal-backdrop" id="ccItemModal">
    <div class="cc-modal pd-modal cc-item-modal-lg">
        <form id="ccItemForm">
            <div class="pd-modal-head cc-modal-head">
                <h3 id="ccItemModalTitle"><i class="fas fa-boxes-stacked"></i> Create Catalog Item</h3>
                <button class="pd-modal-head-close" type="button" data-close-item-modal aria-label="Close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="pd-modal-body cc-modal-body" aria-describedby="ccItemFormError">
                <div class="cc-inline-error" id="ccItemFormError" role="alert" hidden></div>
                
                <div class="cc-field full cc-hero-field">
                    <label for="ccItemName">Item Name <span class="req">*</span></label>
                    <input id="ccItemName" class="cc-hero-input cc-input-compact-center" required placeholder="e.g. 1-1/2 Rigid Steel Couplings">
                </div>

                <div class="cc-field full">
                    <label for="ccItemDescription">Description</label>
                    <textarea id="ccItemDescription" rows="2" placeholder="Item specifications or description..."></textarea>
                </div>

                <!-- Selectors Row matching Create new takeoff layer modal (Item Type, Measurement, UoM, Symbol, Color) -->
                <div class="pro-create-selectors-row cc-takeoff-selectors-row full">
                    <div class="col-type">
                        <label for="ccItemType">Item Type <span class="req">*</span></label>
                        <div class="pro-create-control-box">
                            <select id="ccItemType">
                                <option value="part">Part / Material</option>
                                <option value="labor">Labor</option>
                                <option value="equipment">Equipment</option>
                                <option value="travel">Travel</option>
                                <option value="assembly">Assembly</option>
                            </select>
                            <span class="pd-field-caret"><i class="fas fa-chevron-down"></i></span>
                        </div>
                    </div>
                    <div class="col-type" style="flex: 1.8;">
                        <label for="ccItemMeasurementType">Measurement</label>
                        <div class="pro-create-control-box">
                            <select id="ccItemMeasurementType">
                                <option value="count">Count (ea)</option>
                                <option value="linear">Linear (ft)</option>
                                <option value="area">Area (sqft)</option>
                                <option value="volume">Volume (cuyd)</option>
                            </select>
                            <span class="pd-field-caret"><i class="fas fa-chevron-down"></i></span>
                        </div>
                    </div>
                    <div class="col-uom">
                        <label for="ccItemUom">UoM <span class="req">*</span></label>
                        <div class="pro-create-control-box">
                            <input id="ccItemUom" readonly required value="ea" placeholder="ea" title="Locked: Automatically determined by measurement type">
                        </div>
                    </div>
                    <div class="col-symbol">
                        <label>Symbol</label>
                        <div class="pro-custom-dropdown" id="ccItemSymbolDropdown">
                            <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="ccItemSymbolTrigger" title="Select drawing symbol">
                                <span class="pcd-trigger-icon" id="ccItemSymbolPreview"></span>
                                <span class="pcd-caret"></span>
                            </button>
                            <div class="pro-custom-dropdown-menu pcd-symbol-menu" id="ccItemSymbolMenu"></div>
                            <input type="hidden" id="ccItemSymbol" value="circle">
                        </div>
                    </div>
                    <div class="col-color">
                        <label>Color</label>
                        <div class="pro-custom-dropdown" id="ccItemColorDropdown">
                            <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="ccItemColorTrigger" title="Choose color">
                                <span class="pcd-color-dot" id="ccItemColorSwatch" style="background:#2563eb;"></span>
                                <span class="pcd-caret"></span>
                            </button>
                            <div class="pro-custom-dropdown-menu pcd-color-menu" id="ccItemColorMenu"></div>
                            <input type="color" id="ccItemColor" value="#2563eb" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                        </div>
                    </div>
                </div>

                <h4 class="cc-form-section-title full">Classification & Hierarchy</h4>
                <div class="cc-field-grid-2 full">
                    <div class="cc-field">
                        <label for="ccItemCatalog">Catalog <span class="req">*</span></label>
                        <select id="ccItemCatalog" required></select>
                    </div>
                    <div class="cc-field">
                        <label for="ccItemGroup">Group</label>
                        <select id="ccItemGroup"></select>
                    </div>
                </div>

                <!-- Assembly Components Builder Section -->
                <section class="cc-assembly-section full" id="ccAssemblySection">
                    <div class="cc-section-head">
                        <div class="cc-section-head-title">
                            <strong>Assembly Components Kit</strong>
                            <button class="bb-btn-ghost small cc-toggle-browser-btn" type="button" id="ccToggleAssemblyBrowser" aria-expanded="true" title="Toggle catalog items selector">
                                <i class="fas fa-chevron-up"></i> <span>Hide Catalog Items</span>
                            </button>
                        </div>
                        <span id="ccAssemblyTotals" class="cc-assembly-totals-pill">Cost $0.00 · Labor 0.00 hr</span>
                    </div>
                    <button class="bb-btn-procore-primary small cc-assembly-open" type="button" id="ccOpenAssemblyBrowser" hidden>
                        <i class="fas fa-plus"></i> Add Item
                    </button>
                    <div class="cc-assembly-browser" id="ccAssemblyBrowser" aria-label="Catalog item selector">
                        <div class="cc-assembly-browser-head">
                            <strong><i class="fas fa-magnifying-glass"></i> Select Items to Include</strong>
                            <span class="cc-assembly-browser-hint">Click any catalog item below to add or remove it from this assembly</span>
                        </div>
                        <div class="cc-assembly-filters">
                            <input id="ccAssemblySearch" type="search" placeholder="Search by item name, part #, cost code..." aria-label="Search catalog items">
                            <select id="ccAssemblyCatalogFilter" aria-label="Filter by catalog"></select>
                            <select id="ccAssemblyCategoryFilter" aria-label="Filter by group"></select>
                            <select id="ccAssemblyTypeFilter" aria-label="Filter by type">
                                <option value="">All Types</option>
                                <option value="part">Part / Material</option>
                                <option value="labor">Labor</option>
                                <option value="equipment">Equipment</option>
                                <option value="travel">Travel</option>
                            </select>
                        </div>
                        <div class="cc-assembly-results" id="ccAssemblyResults" role="listbox" aria-label="Available catalog items"></div>
                        <div class="cc-assembly-pagination" id="ccAssemblyPagination" aria-label="Assembly catalog items pagination">
                            <div class="cc-assembly-pagination-info" id="ccAssemblyPaginationInfo">
                                Showing <span id="ccAssemblyPageStart">0</span>–<span id="ccAssemblyPageEnd">0</span> of <span id="ccAssemblyPageTotal">0</span> items
                            </div>
                            <div class="cc-pagination-controls" id="ccAssemblyPaginationControls">
                                <button type="button" class="cc-page-btn" id="ccAssemblyPagePrev" title="Previous page" aria-label="Previous page" disabled>
                                    <i class="fas fa-angle-left" aria-hidden="true"></i>
                                </button>
                                <div class="cc-pagination-numbers" id="ccAssemblyPaginationNumbers"></div>
                                <button type="button" class="cc-page-btn" id="ccAssemblyPageNext" title="Next page" aria-label="Next page" disabled>
                                    <i class="fas fa-angle-right" aria-hidden="true"></i>
                                </button>
                            </div>
                        </div>
                        <button class="bb-btn-ghost small" type="button" id="ccCloseAssemblyBrowser" hidden>Close Selector</button>
                    </div>
                    <div class="cc-assembly-selected-header">
                        <div class="cc-assembly-selected-title">
                            <i class="fas fa-list-check"></i>
                            <strong>Configured Components</strong>
                            <span class="cc-selected-count-badge" id="ccSelectedComponentsCount">0</span>
                        </div>
                    </div>
                    <div class="cc-assembly-note" id="ccAssemblyNote"></div>
                    <div class="cc-assembly-table-wrap">
                        <table class="cc-mini-table">
                            <thead>
                                <tr>
                                    <th style="width: 34px; text-align: center;" aria-label="Reorder"><i class="fas fa-grip-vertical" style="opacity: 0.5;"></i></th>
                                    <th style="width: 90px; text-align: right;">Quantity</th>
                                    <th>Item Name</th>
                                    <th style="width: 60px; text-align: center;">UoM</th>
                                    <th style="width: 90px; text-align: right;">Unit Cost</th>
                                    <th style="width: 95px; text-align: right;">Labor Time</th>
                                    <th style="width: 50px; text-align: center;"><span>Actions</span></th>
                                </tr>
                            </thead>
                            <tbody id="ccAssemblyPartsBody"></tbody>
                        </table>
                    </div>
                </section>

                <h4 class="cc-form-section-title full">Costs & Pricing</h4>
                <div class="cc-field-grid-2 full" id="ccCostPricingGrid">
                    <div class="cc-field" data-item-specific="part equipment assembly travel" id="ccFieldUnitCost">
                        <label for="ccItemUnitCost">Unit Cost ($)</label>
                        <input id="ccItemUnitCost" type="number" min="0" step="0.01" value="0.00" aria-describedby="ccItemUnitCostHint">
                        <small id="ccItemUnitCostHint" class="cc-field-hint"></small>
                    </div>
                    <div class="cc-field" data-item-specific="part equipment assembly travel" id="ccFieldLaborHours">
                        <label for="ccItemLaborHours">Labor Time (hr)</label>
                        <input id="ccItemLaborHours" type="number" min="0" step="0.01" value="0.00" aria-describedby="ccItemLaborHoursHint">
                        <small id="ccItemLaborHoursHint" class="cc-field-hint"></small>
                    </div>
                    <div class="cc-field" data-item-specific="labor" id="ccFieldLaborRate">
                        <label for="ccItemLaborRate">Labor Rate ($/hr)</label>
                        <input id="ccItemLaborRate" type="number" min="0" step="0.01" value="0.00">
                    </div>
                    <div class="cc-field" data-item-specific="labor" id="ccFieldLaborCost">
                        <label for="ccItemLaborCost">Labor Cost ($)</label>
                        <input id="ccItemLaborCost" type="number" min="0" step="0.01" value="0.00">
                    </div>
                    <div class="cc-field" data-item-specific="part" id="ccFieldMaterialCost">
                        <label for="ccItemMaterialCost">Material Cost ($)</label>
                        <input id="ccItemMaterialCost" type="number" min="0" step="0.01" value="0.00">
                    </div>
                    <div class="cc-field" data-item-specific="equipment" id="ccFieldEquipmentCost">
                        <label for="ccItemEquipmentCost">Equipment Cost ($)</label>
                        <input id="ccItemEquipmentCost" type="number" min="0" step="0.01" value="0.00">
                    </div>
                    <div class="cc-field" data-item-specific="part equipment travel" id="ccFieldTaxable">
                        <label for="ccItemTaxable">Taxable</label>
                        <select id="ccItemTaxable">
                            <option value="1">Yes</option>
                            <option value="0">No</option>
                        </select>
                    </div>
                </div>

                <!-- Hidden Markup & Waste inputs (Retained for estimator/backend compatibility, hidden from item creation UI) -->
                <input id="ccItemMarkup" type="hidden" value="0">
                <input id="ccItemWaste" type="hidden" value="0">

                <h4 class="cc-form-section-title full">Identification & Codes</h4>
                <div class="cc-field-grid-2 full">
                    <div class="cc-field">
                        <label for="ccItemCatalogNumber">Part # / Catalog Number</label>
                        <input id="ccItemCatalogNumber" placeholder="e.g. STEEL_RMC_150">
                    </div>
                    <div class="cc-field">
                        <label for="ccItemCostCode">Cost Code</label>
                        <input id="ccItemCostCode" placeholder="e.g. 26-05-33">
                    </div>
                </div>

                <div class="cc-field full">
                    <label for="ccItemNotes">Internal Notes</label>
                    <textarea id="ccItemNotes" rows="2" placeholder="Optional notes for estimators..."></textarea>
                </div>
                <input id="ccItemAttachmentUrl" type="hidden">
                <input id="ccItemTags" type="hidden">
                <input id="ccItemAttributes" type="hidden">
                <input id="ccItemMarkerSize" type="hidden">
                <input id="ccItemDiameter" type="hidden">
                <input id="ccItemTradeSize" type="hidden">
                <input id="ccItemThickness" type="hidden">
                <input id="ccItemGauge" type="hidden">

                <!-- Spec Sheet & Image Attachment Dropzone (PDF, PNG, JPG, WEBP) -->
                <div class="cc-field full cc-attachment-field">
                    <label>Product Spec Sheet or Image <span class="cc-optional">PDF, PNG, JPG, WEBP · max 10 MB</span></label>
                    <div class="cc-dropzone" id="ccItemDropzone">
                        <input id="ccItemPdf" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" style="display:none;" aria-describedby="ccItemPdfFeedback">
                        <div class="cc-dropzone-content" id="ccDropzonePlaceholder">
                            <div class="cc-dropzone-icon-group">
                                <span class="cc-drop-icon pdf" title="PDF Spec Sheet"><i class="fas fa-file-pdf"></i></span>
                                <span class="cc-drop-icon img" title="Product Image"><i class="fas fa-file-image"></i></span>
                                <span class="cc-drop-icon upload" title="Upload"><i class="fas fa-cloud-arrow-up"></i></span>
                            </div>
                            <div class="cc-dropzone-text">
                                <strong>Click to upload or drag &amp; drop file here</strong>
                                <span>Upload a PDF specification sheet, cutsheet, or product image</span>
                            </div>
                            <button type="button" class="bb-btn-ghost small cc-browse-file-btn" id="ccBrowseFileBtn">
                                <i class="fas fa-folder-open"></i> Browse Files
                            </button>
                        </div>
                        
                        <!-- Current Attached File Preview -->
                        <div class="cc-attached-card" id="ccItemPdfCurrent" hidden>
                            <div class="cc-attached-preview" id="ccAttachedPreviewBox">
                                <i class="fas fa-file-pdf" id="ccAttachedFileIcon"></i>
                                <img id="ccAttachedImgThumb" alt="Product image preview" style="display:none;">
                            </div>
                            <div class="cc-attached-info">
                                <strong class="cc-attached-name" id="ccItemPdfName">spec-sheet.pdf</strong>
                                <span class="cc-attached-meta" id="ccItemPdfMeta">Attached document</span>
                            </div>
                            <div class="cc-attached-actions">
                                <a class="bb-btn-ghost small" id="ccItemPdfView" target="_blank" rel="noopener" title="Preview / View File">
                                    <i class="fas fa-eye"></i> View
                                </a>
                                <button class="bb-btn-ghost danger small" id="ccItemPdfRemove" type="button" title="Remove attachment">
                                    <i class="fas fa-trash"></i> Remove
                                </button>
                            </div>
                        </div>
                        <div class="cc-attached-card" id="ccItemLegacyAttachment" hidden>
                            <div class="cc-attached-preview">
                                <i class="fas fa-file-lines" style="color: #64748b;"></i>
                            </div>
                            <div class="cc-attached-info">
                                <strong class="cc-attached-name">Legacy Attachment</strong>
                                <span class="cc-attached-meta">External file</span>
                            </div>
                            <div class="cc-attached-actions">
                                <a class="bb-btn-ghost small" id="ccItemLegacyAttachmentView" target="_blank" rel="noopener">
                                    <i class="fas fa-arrow-up-right-from-square"></i> Open
                                </a>
                            </div>
                        </div>
                    </div>
                    <small id="ccItemPdfFeedback" class="cc-field-hint" role="status" aria-live="polite"></small>
                </div>
            </div>
            <div class="pd-modal-foot cc-modal-foot">
                <button class="btn-ghost" type="button" data-close-item-modal>Cancel</button>
                <button class="bb-btn-procore-primary" id="ccItemSave" type="submit">
                    <i class="fas fa-floppy-disk"></i> Save Item
                </button>
            </div>
        </form>
    </div>
</div>

<!-- Modal 2: Create / Edit Catalog -->
<div class="cc-modal-backdrop pd-modal-backdrop" id="ccCatalogModal">
    <div class="cc-modal pd-modal small" role="dialog" aria-modal="true" aria-labelledby="ccCatalogModalTitle">
        <form id="ccCatalogForm">
            <div class="pd-modal-head cc-modal-head">
                <h3 id="ccCatalogModalTitle"><i class="fas fa-book"></i> Create Catalog</h3>
                <button class="pd-modal-head-close" type="button" data-close-catalog-modal aria-label="Close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="pd-modal-body cc-modal-body">
                <div class="cc-inline-error" id="ccCatalogError" role="alert" hidden></div>
                <div class="cc-field full cc-hero-field">
                    <label for="ccCatalogName">Catalog Name <span class="req">*</span></label>
                    <input id="ccCatalogName" class="cc-hero-input" required placeholder="e.g. Electrical & Lighting">
                </div>
                <div class="cc-field full">
                    <label for="ccCatalogDescription">Description</label>
                    <textarea id="ccCatalogDescription" rows="2" placeholder="Optional description or trade scope..."></textarea>
                </div>
            </div>
            <div class="pd-modal-foot cc-modal-foot">
                <button class="btn-ghost" type="button" data-close-catalog-modal>Cancel</button>
                <button class="bb-btn-procore-primary" id="ccCatalogSave" type="submit">
                    <i class="fas fa-check"></i> Save Catalog
                </button>
            </div>
        </form>
    </div>
</div>

<!-- Modal 3: Create / Edit Group -->
<div class="cc-modal-backdrop pd-modal-backdrop" id="ccGroupModal">
    <div class="cc-modal pd-modal small" role="dialog" aria-modal="true" aria-labelledby="ccGroupModalTitle">
        <form id="ccGroupForm">
            <div class="pd-modal-head cc-modal-head">
                <h3 id="ccGroupModalTitle"><i class="fas fa-folder"></i> Create Group</h3>
                <button class="pd-modal-head-close" type="button" data-close-group-modal aria-label="Close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="pd-modal-body cc-modal-body">
                <div class="cc-inline-error" id="ccGroupError" role="alert" hidden></div>
                <div class="cc-field full cc-hero-field">
                    <label for="ccGroupName">Group Name <span class="req">*</span></label>
                    <input id="ccGroupName" class="cc-hero-input" required placeholder="e.g. Conduit & Fittings">
                </div>
                <div class="cc-field full">
                    <label for="ccGroupCatalog">Destination Catalog <span class="req">*</span></label>
                    <select id="ccGroupCatalog" required></select>
                </div>
                <div class="cc-field full">
                    <label for="ccGroupParent">Parent Group</label>
                    <select id="ccGroupParent"></select>
                </div>
                <div class="cc-field full">
                    <label for="ccGroupDescription">Description</label>
                    <textarea id="ccGroupDescription" rows="2" placeholder="Optional group description..."></textarea>
                </div>
            </div>
            <div class="pd-modal-foot cc-modal-foot">
                <button class="btn-ghost" type="button" data-close-group-modal>Cancel</button>
                <button class="bb-btn-procore-primary" id="ccGroupSave" type="submit">
                    <i class="fas fa-check"></i> Save Group
                </button>
            </div>
        </form>
    </div>
</div>

<!-- Modal 4: Archive Group Modal -->
<div class="cc-modal-backdrop pd-modal-backdrop" id="ccArchiveGroupModal">
    <div class="cc-modal pd-modal small" role="dialog" aria-modal="true" aria-labelledby="ccArchiveGroupTitle">
        <form id="ccArchiveGroupForm">
            <div class="pd-modal-head cc-modal-head">
                <h3 id="ccArchiveGroupTitle"><i class="fas fa-box-archive"></i> Archive Group</h3>
                <button class="pd-modal-head-close" type="button" data-close-group-archive aria-label="Close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="pd-modal-body cc-modal-body">
                <p id="ccArchiveGroupImpact" class="cc-modal-warning-text"></p>
                <div class="cc-field full">
                    <label for="ccArchiveGroupTarget">Move Affected Items To</label>
                    <select id="ccArchiveGroupTarget">
                        <option value="">Ungrouped</option>
                    </select>
                </div>
                <label class="cc-check-row full">
                    <input id="ccArchiveGroupTree" type="checkbox">
                    <span>Archive all subgroups recursively</span>
                </label>
                <div class="cc-inline-error" id="ccArchiveGroupError" role="alert" hidden></div>
            </div>
            <div class="pd-modal-foot cc-modal-foot">
                <button class="btn-ghost" type="button" data-close-group-archive>Cancel</button>
                <button class="bb-btn-danger" id="ccArchiveGroupSubmit" type="submit">
                    <i class="fas fa-box-archive"></i> Archive Group
                </button>
            </div>
        </form>
    </div>
</div>

<!-- Modal 5: Move Item Modal -->
<div class="cc-modal-backdrop pd-modal-backdrop" id="ccMoveItemModal">
    <div class="cc-modal pd-modal small">
        <form id="ccMoveItemForm">
            <div class="pd-modal-head cc-modal-head">
                <h3><i class="fas fa-arrow-right-arrow-left"></i> Move Catalog Item</h3>
                <button class="pd-modal-head-close" type="button" data-close-item-modal aria-label="Close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="pd-modal-body cc-modal-body">
                <div class="cc-field full">
                    <label for="ccMoveCatalog">Destination Catalog <span class="req">*</span></label>
                    <select id="ccMoveCatalog" required></select>
                </div>
                <div class="cc-field full">
                    <label for="ccMoveGroup">Destination Group</label>
                    <select id="ccMoveGroup"></select>
                </div>
            </div>
            <div class="pd-modal-foot cc-modal-foot">
                <button class="btn-ghost" type="button" data-close-item-modal>Cancel</button>
                <button class="bb-btn-procore-primary" type="submit" id="ccMoveSubmitBtn">
                    <i class="fas fa-check"></i> Move Item
                </button>
            </div>
        </form>
    </div>
</div>

<!-- Modal 6: Paste Items Modal -->
<div class="cc-modal-backdrop pd-modal-backdrop" id="ccPasteItemModal">
    <div class="cc-modal pd-modal small">
        <form id="ccPasteItemForm">
            <div class="pd-modal-head cc-modal-head">
                <h3 id="ccPasteModalTitle"><i class="fas fa-paste"></i> Paste Items</h3>
                <button class="pd-modal-head-close" type="button" data-close-paste-modal aria-label="Close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="pd-modal-body cc-modal-body">
                <p id="ccPasteModalSubtitle" style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">Select destination catalog and group to paste the copied items.</p>
                <div class="cc-field full">
                    <label for="ccPasteCatalog">Destination Catalog <span class="req">*</span></label>
                    <select id="ccPasteCatalog" required></select>
                </div>
                <div class="cc-field full">
                    <label for="ccPasteGroup">Destination Group</label>
                    <select id="ccPasteGroup"></select>
                </div>
            </div>
            <div class="pd-modal-foot cc-modal-foot">
                <button class="btn-ghost" type="button" data-close-paste-modal>Cancel</button>
                <button class="bb-btn-procore-primary" type="submit" id="ccPasteSubmitBtn">
                    <i class="fas fa-paste"></i> Paste Items
                </button>
            </div>
        </form>
    </div>
</div>

<!-- Modal: Unified Master Excel Import / Export -->
<div class="cc-modal-backdrop pd-modal-backdrop" id="ccIoModal" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="ccIoModalTitle">
    <div class="cc-modal pd-modal" style="max-width: 540px;">
        <div class="pd-modal-head cc-modal-head">
            <h3 id="ccIoModalTitle" style="display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-file-excel" style="color: #10b981;"></i>
                <span id="ccIoModalHeading">Master Catalog Excel (Parts & Assemblies)</span>
            </h3>
            <button class="pd-modal-head-close" type="button" id="ccCloseIoModal" aria-label="Close">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="pd-modal-body cc-modal-body">
            <!-- Mode Tabs (Export / Import) -->
            <div style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--border-soft); padding-bottom: 10px;">
                <button type="button" class="bb-control-btn is-active" id="ccIoTabExport" style="flex: 1; justify-content: center; font-weight: 700;">
                    <i class="fas fa-file-export"></i> Export Master Excel
                </button>
                <button type="button" class="bb-control-btn" id="ccIoTabImport" style="flex: 1; justify-content: center; font-weight: 700;">
                    <i class="fas fa-file-import"></i> Import Master Excel
                </button>
            </div>

            <div class="cc-inline-error" id="ccIoModalError" role="alert" style="display:none; margin-bottom: 12px; padding: 10px 14px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 6px; color: #dc2626; font-size: 12.5px;"></div>
            <div class="cc-inline-success" id="ccIoModalSuccess" style="display:none; margin-bottom: 12px; padding: 10px 14px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; color: #059669; font-size: 12.5px;"></div>

            <!-- Target Catalog & Group Selector -->
            <div class="cc-field full">
                <label for="ccIoCatalogSelect">Catalog <span class="req">*</span></label>
                <div class="pro-create-control-box">
                    <select id="ccIoCatalogSelect"></select>
                    <span class="pd-field-caret"><i class="fas fa-chevron-down"></i></span>
                </div>
            </div>

            <div class="cc-field full">
                <label for="ccIoGroupSelect">Filter by Group</label>
                <div class="pro-create-control-box">
                    <select id="ccIoGroupSelect">
                        <option value="all">All Groups (Whole Catalog)</option>
                    </select>
                    <span class="pd-field-caret"><i class="fas fa-chevron-down"></i></span>
                </div>
            </div>

            <!-- EXPORT TAB CONTENT -->
            <div id="ccIoExportSection">
                <div class="cc-field full">
                    <label>Export Format</label>
                    <div class="bb-studio-mode-stack" style="display: flex; flex-direction: column; gap: 9px; margin-top: 6px;">
                        <div class="bb-mode-card bb-studio-card active" style="cursor: default; border-color: #10b981; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.12);">
                            <div class="bb-mode-card-header">
                                <div class="bb-mode-icon-wrap" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">
                                    <i class="fas fa-layer-group"></i>
                                </div>
                                <span class="bb-mode-badge" style="background: rgba(16, 185, 129, 0.18); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3);">
                                    Synchronized Master
                                </span>
                            </div>
                            <div class="bb-mode-title" style="font-size: 14px;">Master Excel Workbook (Parts &amp; Assemblies)</div>
                            <p class="bb-mode-desc">Exports a unified <code>.xlsx</code> workbook with two synchronized tabs: <strong>'Parts'</strong> (all catalog items, materials, conduit, wire, labor) and <strong>'Assemblies'</strong> (all assemblies with nested component items, quantities, and ratios).</p>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 12px; padding: 12px; background: rgba(16, 185, 129, 0.07); border: 1px solid rgba(16, 185, 129, 0.22); border-radius: 6px; font-size: 12px; color: var(--text-muted); line-height: 1.45;">
                    <i class="fas fa-circle-check" style="color: #10b981; margin-right: 5px;"></i>
                    Both sheets export together so that unit costs, labor times, and assembly component links remain 100% consistent.
                </div>
            </div>

            <!-- IMPORT TAB CONTENT -->
            <div id="ccIoImportSection" style="display:none;">
                <div class="cc-field full">
                    <label for="ccIoFileInput">Upload Master Excel File (.xlsx) <span class="req">*</span></label>
                    <input type="file" id="ccIoFileInput" accept=".xlsx" style="font-size: 12.5px; padding: 12px; background: var(--bg-input); border: 1px dashed var(--border); border-radius: 8px; width: 100%; cursor: pointer;">
                </div>

                <div style="margin-top: 10px; padding: 12px 14px; background: var(--bg-input); border: 1px solid var(--border-soft); border-radius: 8px; font-size: 12px; color: var(--text-muted); line-height: 1.45;">
                    <div style="display: flex; gap: 8px; align-items: flex-start;">
                        <i class="fas fa-bolt" style="color: #f59e0b; margin-top: 2px;"></i>
                        <div>
                            <strong style="color: var(--text-main);">Two-Pass Atomic Loading:</strong><br>
                            1. Reads and updates all catalog items from the <code>Parts</code> sheet.<br>
                            2. Immediately resolves and links each component in the <code>Assemblies</code> sheet, automatically calculating costs and labor times with zero missing items.
                        </div>
                    </div>
                </div>

                <div style="margin-top: 14px; padding: 12px 14px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                    <div style="font-size: 12px;">
                        <strong style="color: var(--text-main);"><i class="fas fa-file-excel" style="color: #10b981; margin-right: 5px;"></i> Need the blank template?</strong><br>
                        <span style="color: var(--text-muted);">Download the official Master Template with both sheets ('Parts' and 'Assemblies') and format guides.</span>
                    </div>
                    <a href="../api/catalog_io.php?action=template&type=both" target="_blank" class="bb-btn-procore-primary" style="padding: 7px 14px; font-size: 12px; text-decoration: none; white-space: nowrap; background: #10b981; border-color: #059669; font-weight: 600;">
                        <i class="fas fa-file-arrow-down"></i> Download Master Template
                    </a>
                </div>
            </div>
        </div>

        <div class="pd-modal-foot cc-modal-foot">
            <button class="btn-ghost" type="button" id="ccIoCancelBtn">Cancel</button>
            <button class="bb-btn-procore-primary" type="button" id="ccIoSubmitBtn">
                <i class="fas fa-file-export" id="ccIoSubmitIcon"></i> <span id="ccIoSubmitText">Export Master Excel</span>
            </button>
        </div>
    </div>
</div>

<!-- Floating 3-dots Context Dropdown for Sidebar Tree Catalogs and Groups -->
<div class="cc-tree-more-menu" id="ccTreeMoreMenu" hidden></div>
<!-- Floating Context Menu for Table Items (Portal) -->
<div class="cc-row-item-floating-menu" id="ccRowItemFloatingMenu" hidden></div>

<script src="../assets/global_tools.js?v=<?= time() ?>"></script>
<script src="../assets/catalog_item_contract.js"></script>
<script src="../assets/assembly_expansion_service.js"></script>
<script src="../assets/cost_catalog.js?v=<?= time() ?>"></script>
<script src="../assets/catalog_admin_service.js?v=catalog-phase6-20260827-1"></script>
</body>
</html>
