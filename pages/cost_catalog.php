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
                <button class="cc-btn" id="ccAddGroup"><i class="fas fa-folder-plus"></i> Add Group</button>
                <button class="cc-btn primary" id="ccAddCatalogTop"><i class="fas fa-plus"></i> Add Catalog</button>
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

<script src="../assets/cost_catalog.js"></script>
</body>
</html>
