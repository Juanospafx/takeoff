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
    <link rel="stylesheet" href="../assets/cost_catalog.css">
</head>
<body>
<div class="cc-shell">
    <aside class="cc-app-nav">
        <div class="cc-brand">
            <div class="cc-brand-icon"><i class="fas fa-book"></i></div>
            <span>Cost Catalog</span>
        </div>
        <nav class="cc-nav">
            <a class="active" href="/pages/cost_catalog.php"><i class="fas fa-book"></i><span>Cost Catalog</span></a>
            <a href="/pages/bid_board.php"><i class="fas fa-table-columns"></i><span>Bid Board</span></a>
            <a href="/pages/project_module.php"><i class="fas fa-folder-tree"></i><span>Projects</span></a>
            <a href="/pages/takeoff.php"><i class="fas fa-ruler-combined"></i><span>Takeoff</span></a>
        </nav>
    </aside>

    <aside class="cc-catalog-sidebar">
        <div class="cc-sidebar-head">
            <strong>Catalog Library</strong>
            <button class="cc-icon-btn" id="ccAddCatalog" title="Add Catalog"><i class="fas fa-plus"></i></button>
        </div>
        <button class="cc-tree-row active" data-view="all"><i class="fas fa-layer-group"></i><span>All Catalog Items</span></button>
        <button class="cc-tree-row" data-view="recent"><i class="fas fa-clock"></i><span>Most Recently Used</span></button>
        <div class="cc-tree-title">Catalogs</div>
        <div id="ccCatalogTree"></div>
    </aside>

    <main class="cc-main">
        <div class="cc-topbar">
            <div>
                <h1 id="ccTitle">All Catalog Items</h1>
                <p id="ccSubtitle">Browse catalog items by catalog, group or subgroup.</p>
            </div>
            <div class="cc-actions">
                <button class="cc-btn primary" id="ccAddItem"><i class="fas fa-plus"></i> Add Item</button>
                <button class="cc-btn" id="ccAddGroup"><i class="fas fa-folder-plus"></i> Add Group</button>
                <button class="cc-btn" id="ccAddCatalogTop"><i class="fas fa-book-medical"></i> Add Catalog</button>
            </div>
        </div>

        <div id="ccError" class="cc-error" style="display:none;"></div>

        <section class="cc-workspace">
            <div class="cc-panel">
                <div class="cc-panel-head">
                    <strong>Catalog Actions</strong>
                </div>
                <div class="cc-action-grid" id="ccCatalogActions"></div>
            </div>

            <div class="cc-panel">
                <div class="cc-panel-head">
                    <strong>Group Actions</strong>
                </div>
                <div class="cc-action-grid" id="ccGroupActions"></div>
            </div>
        </section>

        <section class="cc-table-wrap">
            <table class="cc-table">
                <thead>
                    <tr>
                        <th>Item Name</th>
                        <th>Description</th>
                        <th>UoM</th>
                        <th>Unit Cost</th>
                        <th>Unit Labor Time</th>
                        <th>Catalog Name</th>
                        <th>Group Name</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="ccItemsBody"></tbody>
            </table>
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

<script src="../assets/cost_catalog.js"></script>
</body>
</html>
