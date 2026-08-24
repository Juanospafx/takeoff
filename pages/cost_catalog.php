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

<div class="cc-modal-backdrop" id="ccItemModal">
    <div class="cc-modal">
        <form id="ccItemForm">
            <div class="cc-modal-head">
                <strong id="ccItemModalTitle">Create Catalog Item</strong>
                <button class="cc-btn" type="button" data-close-item-modal><i class="fas fa-times"></i></button>
            </div>
            <div class="cc-modal-body">
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
                        <label>Group</label>
                        <select id="ccItemGroup"></select>
                    </div>
                    <div class="cc-field">
                        <label>Item Type</label>
                        <select id="ccItemType">
                            <option value="material">Material</option>
                            <option value="labor">Labor</option>
                            <option value="equipment">Equipment</option>
                            <option value="assembly">Assembly</option>
                        </select>
                    </div>
                    <div class="cc-field">
                        <label>Unit of Measure</label>
                        <input id="ccItemUom" required value="ea">
                    </div>
                    <div class="cc-field">
                        <label>Unit Cost</label>
                        <input id="ccItemUnitCost" type="number" min="0" step="0.0001" value="0">
                    </div>
                    <div class="cc-field">
                        <label>Unit Labor Time</label>
                        <input id="ccItemLaborHours" type="number" min="0" step="0.0001" value="0">
                    </div>
                    <div class="cc-field">
                        <label>Taxable</label>
                        <select id="ccItemTaxable">
                            <option value="1">Yes</option>
                            <option value="0">No</option>
                        </select>
                    </div>
                    <div class="cc-field">
                        <label>Color</label>
                        <input id="ccItemColor" type="color" value="#2563eb">
                    </div>
                    <div class="cc-field">
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
                    <div class="cc-field full">
                        <label>Attachment</label>
                        <input id="ccItemAttachmentUrl" type="url">
                    </div>
                </div>
                <section class="cc-assembly-section" id="ccAssemblySection">
                    <div class="cc-section-head">
                        <strong>Items Included</strong>
                        <span id="ccAssemblyTotals">Cost $0.00 · Labor 0.0000</span>
                    </div>
                    <div class="cc-assembly-add">
                        <select id="ccAssemblyChildItem"></select>
                        <input id="ccAssemblyQuantity" type="number" min="0.0001" step="0.0001" value="1">
                        <button class="cc-btn" type="button" id="ccAddAssemblyPart">Add Item</button>
                    </div>
                    <div class="cc-assembly-note" id="ccAssemblyNote"></div>
                    <table class="cc-mini-table">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Qty</th>
                                <th>Unit Cost</th>
                                <th>Labor</th>
                                <th>Total</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="ccAssemblyPartsBody"></tbody>
                    </table>
                </section>
            </div>
            <div class="cc-modal-foot">
                <button class="cc-btn" type="button" data-close-item-modal>Cancel</button>
                <button class="cc-btn primary" type="submit">Save Item</button>
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
<script src="../assets/cost_catalog.js?v=procore-catalog-20260824-1"></script>
</body>
</html>
