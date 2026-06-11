<?php
// Estimate module foundation. No auth/session dependency.
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Estimate | Brightronix</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../assets/estimate_module.css">
</head>
<body>
<div class="em-shell">
    <aside class="em-nav">
        <div class="em-brand">
            <div class="em-brand-icon"><i class="fas fa-calculator"></i></div>
            <span>Estimate</span>
        </div>
        <nav>
            <a href="/pages/bid_board.php"><i class="fas fa-table-columns"></i><span>Bid Board</span></a>
            <a href="/pages/project_module.php"><i class="fas fa-folder-tree"></i><span>Projects</span></a>
            <a href="/pages/takeoff_layers.php"><i class="fas fa-ruler-combined"></i><span>Takeoff</span></a>
            <a class="active" href="/pages/estimate_module.php"><i class="fas fa-calculator"></i><span>Estimate</span></a>
            <a href="/pages/cost_catalog.php"><i class="fas fa-book"></i><span>Cost Catalog</span></a>
            <a href="/pages/company_settings.php"><i class="fas fa-gear"></i><span>Settings</span></a>
        </nav>
    </aside>

    <main class="em-main">
        <div class="em-topbar">
            <div>
                <h1>Estimate</h1>
                <p>Add manual, catalog, assembly or takeoff-linked items. Takeoff quantities stay locked and synced.</p>
            </div>
            <button class="em-btn primary" id="emAddItem"><i class="fas fa-plus"></i> Add Item</button>
        </div>

        <div id="emError" class="em-error" style="display:none;"></div>

        <section class="em-summary" id="emSummary"></section>

        <section class="em-table-wrap">
            <table class="em-table">
                <thead>
                    <tr>
                        <th>Cost Item Name</th>
                        <th>Source</th>
                        <th>Budget Code</th>
                        <th>Cost Type</th>
                        <th>Qty</th>
                        <th>UOM</th>
                        <th>Unit Cost</th>
                        <th>Unit Labor</th>
                        <th>Total</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="emItemsBody"></tbody>
            </table>
        </section>
    </main>
</div>

<div class="em-modal-backdrop" id="emItemModal">
    <div class="em-modal">
        <form id="emItemForm">
            <div class="em-modal-head">
                <strong id="emModalTitle">Add Estimate Item</strong>
                <button class="em-btn" type="button" data-close-em-modal><i class="fas fa-times"></i></button>
            </div>
            <div class="em-modal-body">
                <div class="em-form-grid">
                    <div class="em-field">
                        <label>Source Type</label>
                        <select id="emSourceType">
                            <option value="manual">Manual</option>
                            <option value="catalog">Catalog</option>
                            <option value="assembly">Assembly</option>
                            <option value="takeoff">Takeoff</option>
                        </select>
                    </div>
                    <div class="em-field" id="emTakeoffPickerWrap">
                        <label>Link to Takeoff Layer</label>
                        <select id="emTakeoffLayer"></select>
                    </div>
                    <div class="em-field" id="emCatalogPickerWrap">
                        <label>Catalog / Assembly Item</label>
                        <select id="emCatalogItem"></select>
                    </div>
                    <div class="em-field full">
                        <label>Cost Item Name</label>
                        <input id="emName" required>
                    </div>
                    <div class="em-field full">
                        <label>Description</label>
                        <textarea id="emDescription" rows="3"></textarea>
                    </div>
                    <div class="em-field">
                        <label>Budget Code</label>
                        <input id="emBudgetCode">
                    </div>
                    <div class="em-field">
                        <label>Cost Type</label>
                        <input id="emCostType" placeholder="Material, Labor, Equipment">
                    </div>
                    <div class="em-field">
                        <label>Quantity</label>
                        <input id="emQuantity" type="number" step="0.0001" min="0" value="1">
                    </div>
                    <div class="em-field">
                        <label>Unit of Measure</label>
                        <input id="emUom" value="ea">
                    </div>
                    <div class="em-field">
                        <label>Unit Cost</label>
                        <input id="emUnitCost" type="number" step="0.0001" min="0" value="0">
                    </div>
                    <div class="em-field">
                        <label>Unit Labor Time</label>
                        <input id="emUnitLaborTime" type="number" step="0.0001" min="0" value="0">
                    </div>
                    <div class="em-field">
                        <label>Waste %</label>
                        <input id="emWaste" type="number" step="0.01" min="0" value="0">
                    </div>
                    <div class="em-field">
                        <label>Margin %</label>
                        <input id="emMargin" type="number" step="0.01" min="0" value="0">
                    </div>
                    <div class="em-field">
                        <label>Taxable</label>
                        <select id="emTaxable">
                            <option value="1">Yes</option>
                            <option value="0">No</option>
                        </select>
                    </div>
                    <div class="em-field">
                        <label>Group</label>
                        <input id="emGroup">
                    </div>
                </div>
            </div>
            <div class="em-modal-actions">
                <span id="emLockNote"></span>
                <button class="em-btn" type="button" data-close-em-modal>Cancel</button>
                <button class="em-btn primary" type="submit">Save Item</button>
            </div>
        </form>
    </div>
</div>

<script src="../assets/estimate_module.js"></script>
</body>
</html>
