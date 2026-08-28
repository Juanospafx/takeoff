<?php
// Standalone Cost Catalog foundation. No item modal in this task.
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cost Catalog | Brightronix</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../assets/global_tools.css">
    <script>
        (function () {
            try {
                var saved = localStorage.getItem('takeoff.theme');
                document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
            } catch (error) {
                document.documentElement.setAttribute('data-theme', 'light');
            }
        })();
    </script>
    <link rel="stylesheet" href="../assets/cost_catalog.css?v=procore-catalog-20260824-1">
</head>
<body>
<?php include __DIR__ . '/../views/global_tools_header.php'; ?>
<div class="cc-shell">
    <aside class="cc-catalog-sidebar">
        <div class="cc-sidebar-head">
            <div><span class="cc-eyebrow">Company tool</span><strong>Catalog Library</strong></div>
            <button class="cc-icon-btn" id="ccAddCatalog" title="Add catalog" aria-label="Add catalog"><i class="fas fa-plus" aria-hidden="true"></i></button>
        </div>
        <button class="cc-tree-row active" data-view="all"><i class="fas fa-layer-group" aria-hidden="true"></i><span>All Catalog Items</span></button>
        <button class="cc-tree-row" data-view="recent"><i class="far fa-clock" aria-hidden="true"></i><span>Most Recently Used</span></button>
        <div class="cc-tree-title">Catalogs</div>
        <div id="ccCatalogTree"></div>
    </aside>

    <main class="cc-main">
        <div class="cc-topbar">
            <div class="cc-title-wrap">
                <div class="cc-module-icon"><i class="fas fa-book" aria-hidden="true"></i></div>
                <div>
                    <h1 id="ccTitle">All Catalog Items</h1>
                    <p id="ccSubtitle">Browse catalog items by catalog, group or subgroup.</p>
                </div>
            </div>
            <div class="cc-actions">
                <button class="cc-btn primary" id="ccAddItem"><i class="fas fa-plus" aria-hidden="true"></i> Add Item</button>
                <button class="cc-btn" id="ccAddGroup"><i class="fas fa-folder-plus" aria-hidden="true"></i> Add Group</button>
                <button class="cc-icon-btn bordered" id="ccAddCatalogTop" title="Add catalog" aria-label="Add catalog"><i class="fas fa-book-medical" aria-hidden="true"></i></button>
            </div>
        </div>

        <div id="ccError" class="cc-error" style="display:none;"></div>
        <nav class="cc-breadcrumb" id="ccBreadcrumb" aria-label="Catalog breadcrumb"></nav>

        <section class="cc-context-actions" aria-label="Selected catalog and group actions">
            <div class="cc-panel">
                <div class="cc-panel-head">
                    <span>Catalog</span><strong id="ccCatalogContext">No catalog selected</strong>
                </div>
                <div class="cc-action-grid" id="ccCatalogActions"></div>
            </div>

            <div class="cc-panel">
                <div class="cc-panel-head">
                    <span>Group</span><strong id="ccGroupContext">No group selected</strong>
                </div>
                <div class="cc-action-grid" id="ccGroupActions"></div>
            </div>
        </section>

        <section class="cc-table-section" aria-label="Cost catalog items">
            <div class="cc-table-controls">
                <label class="cc-search-field">
                    <span class="sr-only">Search catalog items</span>
                    <input id="ccSearch" type="search" placeholder="Search catalog items" autocomplete="off">
                    <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                </label>
                <label class="cc-select-field"><span>Sort by</span><select id="ccSortBy"><option value="name">Item name</option><option value="cost">Unit cost</option><option value="labor">Labor time</option><option value="catalog">Catalog</option></select></label>
                <label class="cc-select-field"><span>Type</span><select id="ccTypeFilter"><option value="all">All types</option><option value="part">Material</option><option value="cable">Cable</option><option value="labor">Labor</option><option value="equipment">Equipment</option><option value="assembly">Assembly</option></select></label>
                <button class="cc-icon-btn bordered" id="ccSortDir" type="button" aria-label="Sort descending" title="Toggle sort direction"><i class="fas fa-arrow-down-wide-short" aria-hidden="true"></i></button>
                <span class="cc-result-count" id="ccResultCount" aria-live="polite"></span>
            </div>
            <div class="cc-table-wrap">
                <table class="cc-table">
                    <thead><tr><th>Item Name</th><th>Description</th><th>UoM</th><th>Unit Cost</th><th>Unit Labor Time</th><th>Catalog Name</th><th>Group Name</th><th><span class="sr-only">Actions</span></th></tr></thead>
                    <tbody id="ccItemsBody"></tbody>
                </table>
            </div>
        </section>
    </main>
</div>

<div class="cc-details-scrim" id="ccItemDetailsScrim" hidden></div>
<aside class="cc-details-drawer" id="ccItemDetailsDrawer" aria-labelledby="ccItemDetailsTitle" aria-hidden="true" tabindex="-1">
    <header class="cc-details-head">
        <div><span class="cc-eyebrow">Catalog item</span><h2 id="ccItemDetailsTitle">Item details</h2></div>
        <button class="cc-icon-btn bordered" type="button" id="ccCloseItemDetails" aria-label="Close item details"><i class="fas fa-times" aria-hidden="true"></i></button>
    </header>
    <div class="cc-details-body" id="ccItemDetailsBody"></div>
</aside>

<div class="cc-modal-backdrop" id="ccItemModal">
    <div class="cc-modal">
        <form id="ccItemForm">
            <div class="cc-modal-head">
                <strong id="ccItemModalTitle">Create Catalog Item</strong>
                <button class="cc-btn" type="button" data-close-item-modal><i class="fas fa-times"></i></button>
            </div>
            <div class="cc-modal-body" aria-describedby="ccItemFormError">
                <div class="cc-inline-error" id="ccItemFormError" role="alert" hidden></div>
                <h3 class="cc-form-section-title">Essential Details</h3>
                <div class="cc-form-grid">
                    <div class="cc-field full">
                        <label>Name</label>
                        <input id="ccItemName" required>
                    </div>
                    <div class="cc-field full">
                        <label>Description</label>
                        <textarea id="ccItemDescription" rows="3"></textarea>
                    </div>
                    <div class="cc-field">
                        <label>Catalog</label>
                        <select id="ccItemCatalog" required></select>
                    </div>
                    <div class="cc-field">
                        <label>Category</label>
                        <select id="ccItemGroup"></select>
                    </div>
                    <div class="cc-field">
                        <label>Type</label>
                        <select id="ccItemType">
                            <option value="part">Part</option>
                            <option value="labor">Labor</option>
                            <option value="equipment">Equipment</option>
                            <option value="assembly">Assembly</option>
                        </select>
                    </div>
                    <div class="cc-field"><label>MasterFormat</label><input id="ccItemMasterFormat"></div>
                    <div class="cc-field"><label>UniFormat</label><input id="ccItemUniFormat"></div>
                    <div class="cc-field">
                        <label>Unit of Measure</label>
                        <input id="ccItemUom" required value="ea">
                    </div>
                    <div class="cc-field" data-item-specific="part equipment assembly">
                        <label for="ccItemUnitCost">Unit Cost</label>
                        <input id="ccItemUnitCost" type="number" min="0" step="0.0001" value="0" aria-describedby="ccItemUnitCostHint">
                        <small id="ccItemUnitCostHint" class="cc-field-hint"></small>
                    </div>
                    <div class="cc-field" data-item-specific="part equipment assembly">
                        <label for="ccItemLaborHours">Unit Labor Time</label>
                        <input id="ccItemLaborHours" type="number" min="0" step="0.0001" value="0" aria-describedby="ccItemLaborHoursHint">
                        <small id="ccItemLaborHoursHint" class="cc-field-hint"></small>
                    </div>
                    <div class="cc-field" data-item-specific="labor">
                        <label for="ccItemLaborRate">Unit Labor Cost per hour</label>
                        <input id="ccItemLaborRate" type="number" min="0" step="0.0001" value="0">
                    </div>
                    <div class="cc-field" data-item-specific="part equipment">
                        <label>Taxable</label>
                        <select id="ccItemTaxable">
                            <option value="1">Yes</option>
                            <option value="0">No</option>
                        </select>
                    </div>
                    <div class="cc-field" data-item-specific="part equipment labor assembly">
                        <label>Color</label>
                        <input id="ccItemColor" type="color" value="#2563eb">
                    </div>
                    <h3 class="cc-form-section-title full">Catalog Details</h3>
                    <div class="cc-field" data-item-specific="part equipment assembly">
                        <label>Symbol</label>
                        <select id="ccItemSymbol">
                            <option value="circle">Circle</option>
                            <option value="square">Square</option>
                            <option value="diamond">Diamond</option>
                            <option value="triangle">Triangle</option>
                            <option value="cross">Cross</option>
                            <option value="line">Line</option>
                        </select>
                    </div>
                    <div class="cc-field">
                        <label>Manufacturer</label>
                        <input id="ccItemManufacturer">
                    </div>
                    <div class="cc-field">
                        <label>Supplier</label>
                        <input id="ccItemSupplier">
                    </div>
                    <div class="cc-field">
                        <label>Catalog Number</label>
                        <input id="ccItemCatalogNumber">
                    </div>
                    <div class="cc-field">
                        <label>Cost Code</label>
                        <input id="ccItemCostCode">
                    </div>
                    <div class="cc-field">
                        <label>Sub Job Code</label>
                        <input id="ccItemSubJobCode">
                    </div>
                    <div class="cc-field">
                        <label>Sub Job Name</label>
                        <input id="ccItemSubJobName">
                    </div>
                    <div class="cc-field full">
                        <label>EPD URL</label>
                        <input id="ccItemEpdUrl" type="url">
                    </div>
                    <input id="ccItemAttachmentUrl" type="hidden">
                    <div class="cc-field full cc-pdf-field">
                        <label for="ccItemPdf">PDF attachment <span class="cc-optional">Optional · maximum 10 MB</span></label>
                        <input id="ccItemPdf" type="file" accept="application/pdf,.pdf" aria-describedby="ccItemPdfHint ccItemPdfFeedback">
                        <small id="ccItemPdfHint" class="cc-field-hint">Upload a verified PDF. Selecting a file replaces the current managed PDF when you save.</small>
                        <div class="cc-pdf-current" id="ccItemPdfCurrent" hidden>
                            <span id="ccItemPdfName"></span>
                            <div class="cc-pdf-actions">
                                <a class="cc-btn" id="ccItemPdfView" target="_blank" rel="noopener">View PDF</a>
                                <button class="cc-btn danger" id="ccItemPdfRemove" type="button">Remove</button>
                            </div>
                        </div>
                        <div class="cc-pdf-current" id="ccItemLegacyAttachment" hidden>
                            <span>Legacy attachment (read-only)</span>
                            <a class="cc-btn" id="ccItemLegacyAttachmentView" target="_blank" rel="noopener">View legacy file</a>
                        </div>
                        <small id="ccItemPdfFeedback" class="cc-field-hint" role="status" aria-live="polite"></small>
                    </div>
                </div>
                <section class="cc-assembly-section" id="ccAssemblySection">
                    <div class="cc-section-head">
                        <div><strong>Items Included</strong> <button class="cc-link-btn" type="button" id="ccAssemblyAdvanced" aria-pressed="false">Advanced</button></div>
                        <span id="ccAssemblyTotals">Cost $0.00 · Labor 0.0000</span>
                    </div>
                    <button class="cc-btn cc-assembly-open" type="button" id="ccOpenAssemblyBrowser">Add Item</button>
                    <div class="cc-assembly-browser" id="ccAssemblyBrowser" hidden aria-label="Catalog item selector">
                        <div class="cc-assembly-filters">
                            <input id="ccAssemblySearch" type="search" placeholder="Search catalog items" aria-label="Search catalog items">
                            <select id="ccAssemblyCatalogFilter" aria-label="Filter by catalog"></select>
                            <select id="ccAssemblyCategoryFilter" aria-label="Filter by category"></select>
                            <select id="ccAssemblyTypeFilter" aria-label="Filter by type"><option value="">All types</option><option value="part">Part</option><option value="labor">Labor</option><option value="equipment">Equipment</option><option value="assembly">Assembly</option></select>
                        </div>
                        <div class="cc-assembly-results" id="ccAssemblyResults" role="listbox" aria-label="Available catalog items"></div>
                        <button class="cc-btn" type="button" id="ccCloseAssemblyBrowser">Close selector</button>
                    </div>
                    <div class="cc-assembly-note" id="ccAssemblyNote"></div>
                    <table class="cc-mini-table">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Quantity</th><th>UoM</th>
                                <th>Unit Cost</th>
                                <th>Unit Labor Time</th>
                                <th>Extended Cost</th><th>Extended Labor</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="ccAssemblyPartsBody"></tbody>
                    </table>
                </section>
            </div>
            <div class="cc-modal-foot">
                <button class="cc-btn" type="button" data-close-item-modal>Cancel</button>
                <button class="cc-btn primary" id="ccItemSave" type="submit">Save Item</button>
            </div>
        </form>
    </div>
</div>

<div class="cc-modal-backdrop" id="ccMoveItemModal">
    <div class="cc-modal small">
        <form id="ccMoveItemForm">
            <div class="cc-modal-head">
                <strong>Move Catalog Item</strong>
                <button class="cc-btn" type="button" data-close-item-modal><i class="fas fa-times"></i></button>
            </div>
            <div class="cc-modal-body">
                <div class="cc-form-grid">
                    <div class="cc-field full">
                        <label>Catalog</label>
                        <select id="ccMoveCatalog" required></select>
                    </div>
                    <div class="cc-field full">
                        <label>Group</label>
                        <select id="ccMoveGroup"></select>
                    </div>
                </div>
            </div>
            <div class="cc-modal-foot">
                <button class="cc-btn" type="button" data-close-item-modal>Cancel</button>
                <button class="cc-btn primary" type="submit">Move Item</button>
            </div>
        </form>
    </div>
</div>

<script src="../assets/global_tools.js"></script>
<script src="../assets/catalog_item_contract.js"></script>
<script src="../assets/assembly_expansion_service.js"></script>
<script src="../assets/cost_catalog.js?v=assembly-builder-20260828-1"></script>
<script src="../assets/catalog_admin_service.js?v=catalog-phase6-20260827-1"></script>
</body>
</html>
