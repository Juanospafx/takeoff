<?php
// Takeoff layer workspace. No auth/session dependency.
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Takeoff Layers | Brightronix</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../assets/takeoff_layers.css">
</head>
<body>
<div class="tl-shell">
    <aside class="tl-app-nav">
        <div class="tl-brand">
            <div class="tl-brand-icon"><i class="fas fa-ruler-combined"></i></div>
            <span>Takeoff</span>
        </div>
        <nav class="tl-nav">
            <a href="/pages/bid_board.php"><i class="fas fa-table-columns"></i><span>Bid Board</span></a>
            <a href="/pages/project_module.php"><i class="fas fa-folder-tree"></i><span>Projects</span></a>
            <a class="active" href="/pages/takeoff_layers.php"><i class="fas fa-ruler-combined"></i><span>Takeoff</span></a>
            <a href="/pages/estimate_module.php"><i class="fas fa-calculator"></i><span>Estimate</span></a>
            <a href="/pages/cost_catalog.php"><i class="fas fa-book"></i><span>Cost Catalog</span></a>
            <a href="/pages/company_settings.php"><i class="fas fa-gear"></i><span>Settings</span></a>
        </nav>
    </aside>

    <aside class="tl-left-panel">
        <div class="tl-panel-head">
            <div>
                <strong>Takeoffs (<span id="tlLayerCount">0</span>)</strong>
                <small>Layers, groups and quantities</small>
            </div>
            <button class="tl-icon-btn" id="tlNewLayer" title="Create layer"><i class="fas fa-plus"></i></button>
        </div>

        <div class="tl-search">
            <i class="fas fa-search"></i>
            <input id="tlSearch" placeholder="Search layers, groups, items">
        </div>

        <div class="tl-filters">
            <select id="tlTypeFilter">
                <option value="">All types</option>
                <option value="count">Count</option>
                <option value="linear">Linear</option>
                <option value="area">Area</option>
                <option value="volume">Volume</option>
                <option value="lump_sum">Lump Sum</option>
            </select>
            <select id="tlGroupFilter">
                <option value="">All groups</option>
            </select>
        </div>

        <div class="tl-global-actions">
            <button data-global-action="show"><i class="fas fa-eye"></i></button>
            <button data-global-action="hide"><i class="fas fa-eye-slash"></i></button>
            <button data-global-action="lock"><i class="fas fa-lock"></i></button>
            <button data-global-action="sync"><i class="fas fa-arrows-rotate"></i></button>
            <button data-global-action="delete"><i class="fas fa-trash"></i></button>
        </div>

        <div id="tlError" class="tl-error" style="display:none;"></div>
        <div id="tlGroups" class="tl-groups"></div>
    </aside>

    <main class="tl-workspace">
        <div class="tl-topbar">
            <div>
                <h1>Drawing Takeoff</h1>
                <p>Select a layer, then click the canvas to add quantity. Catalog-linked layers sync to Estimate.</p>
            </div>
            <div class="tl-top-actions">
                <a class="tl-btn" href="/pages/takeoff.php"><i class="fas fa-file-pdf"></i> PDF Uploads</a>
                <a class="tl-btn primary" href="/pages/estimate_module.php"><i class="fas fa-calculator"></i> Estimate</a>
            </div>
        </div>

        <section class="tl-board">
            <div class="tl-canvas-toolbar">
                <span id="tlSelectedLabel">No layer selected</span>
                <button class="tl-btn" id="tlAddMeasurement"><i class="fas fa-plus"></i> Add Quantity</button>
                <button class="tl-btn" id="tlSyncSelected"><i class="fas fa-arrows-rotate"></i> Sync Estimate</button>
            </div>
            <div class="tl-canvas" id="tlCanvas">
                <div class="tl-canvas-grid"></div>
                <div class="tl-canvas-empty">
                    <i class="fas fa-crosshairs"></i>
                    <strong>Takeoff drawing area</strong>
                    <span>Click here to mark the selected layer and update its quantity.</span>
                </div>
                <div id="tlMarks"></div>
            </div>
        </section>
    </main>
</div>

<div class="tl-modal-backdrop" id="tlLayerModal">
    <div class="tl-modal">
        <form id="tlLayerForm">
            <div class="tl-modal-head">
                <strong id="tlLayerModalTitle">Create Takeoff Layer</strong>
                <button class="tl-btn" type="button" data-close-layer><i class="fas fa-times"></i></button>
            </div>
            <div class="tl-modal-body">
                <div class="tl-form-grid">
                    <div class="tl-field full with-action">
                        <label>Catalog Item Name</label>
                        <div class="tl-inline">
                            <input id="tlLayerName" placeholder="Search or enter manually" required>
                            <button class="tl-btn" type="button" id="tlBrowseCatalog"><i class="fas fa-book"></i> Browse Catalog</button>
                        </div>
                    </div>
                    <div class="tl-field">
                        <label>Takeoff Type</label>
                        <select id="tlLayerType" required>
                            <option value="">Select type</option>
                            <option value="count">Count</option>
                            <option value="linear">Linear</option>
                            <option value="area">Area</option>
                            <option value="volume">Volume</option>
                            <option value="lump_sum">Lump Sum</option>
                        </select>
                        <small id="tlTypeHelp">Choose how quantity will be measured.</small>
                    </div>
                    <div class="tl-field">
                        <label>Unit of Measure</label>
                        <input id="tlLayerUom" value="ea" required>
                    </div>
                    <div class="tl-field">
                        <label>Group</label>
                        <input id="tlLayerGroup" value="Lighting">
                    </div>
                    <div class="tl-field">
                        <label>Symbol</label>
                        <select id="tlLayerSymbol">
                            <option value="circle">Circle</option>
                            <option value="square">Square</option>
                            <option value="diamond">Diamond</option>
                            <option value="triangle">Triangle</option>
                            <option value="cross">Cross</option>
                            <option value="line">Line</option>
                        </select>
                    </div>
                    <div class="tl-field">
                        <label>Size</label>
                        <select id="tlLayerSize">
                            <option>Small</option>
                            <option selected>Medium</option>
                            <option>Large</option>
                        </select>
                    </div>
                    <div class="tl-field">
                        <label>Color</label>
                        <input id="tlLayerColor" type="color" value="#2563eb">
                    </div>
                </div>
                <input type="hidden" id="tlLayerCatalogItemId">
            </div>
            <div class="tl-modal-actions">
                <button class="tl-btn" type="button" data-close-layer>Cancel</button>
                <button class="tl-btn primary" id="tlCreateLayer" type="submit" disabled>Create</button>
            </div>
        </form>
    </div>
</div>

<div class="tl-modal-backdrop" id="tlCatalogDrawer">
    <div class="tl-drawer">
        <div class="tl-modal-head">
            <strong>Browse Cost Catalog</strong>
            <button class="tl-btn" type="button" data-close-catalog><i class="fas fa-times"></i></button>
        </div>
        <div class="tl-search wide">
            <i class="fas fa-search"></i>
            <input id="tlCatalogSearch" placeholder="Search name, description, manufacturer, catalog number, cost code, group">
        </div>
        <div id="tlCatalogResults" class="tl-catalog-results"></div>
    </div>
</div>

<script src="../assets/takeoff_layers.js"></script>
</body>
</html>
