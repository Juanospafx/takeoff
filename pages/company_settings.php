<?php
// Standalone Company Settings module. No auth dependency.
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Company Settings | Brightronix</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../assets/company_settings.css">
</head>
<body>
<div class="cs-shell">
    <aside class="cs-side">
        <div class="cs-brand">
            <div class="cs-brand-icon"><i class="fas fa-gear"></i></div>
            <span>Company Settings</span>
        </div>
        <nav class="cs-nav">
            <button class="active" data-tab="general"><i class="fas fa-building"></i><span>General</span></button>
            <button data-tab="estimates"><i class="fas fa-calculator"></i><span>Estimates</span></button>
            <button data-tab="pdf"><i class="fas fa-file-pdf"></i><span>PDF Forms</span></button>
            <button data-tab="costTypes"><i class="fas fa-tags"></i><span>Cost Types</span></button>
            <button data-tab="projectStatuses"><i class="fas fa-list-check"></i><span>Project Statuses</span></button>
            <button data-tab="users"><i class="fas fa-user-gear"></i><span>Users</span></button>
            <button data-tab="estimateTypes"><i class="fas fa-layer-group"></i><span>Estimate Types</span></button>
            <a href="/pages/cost_catalog.php"><i class="fas fa-book"></i><span>Cost Catalog</span></a>
            <a href="/pages/project_module.php"><i class="fas fa-folder-tree"></i><span>Projects</span></a>
        </nav>
    </aside>

    <main class="cs-main">
        <div class="cs-topbar">
            <div>
                <h1>Company Settings</h1>
                <p>Global defaults used by projects, estimates, proposals and PDFs.</p>
            </div>
            <button class="cs-btn primary" id="csSaveSettings"><i class="fas fa-save"></i> Save Settings</button>
        </div>

        <div id="csError" class="cs-error" style="display:none;"></div>

        <section class="cs-panel active" data-panel="general">
            <h2>General</h2>
            <div class="cs-form-grid">
                <label>Company name<input id="company_name"></label>
                <label>Logo<input id="logo_url" placeholder="Logo URL"></label>
                <label class="full">Address<input id="address"></label>
                <label>Phone<input id="phone"></label>
                <label>Email<input id="email" type="email"></label>
                <label>Default currency<input id="default_currency" maxlength="3"></label>
            </div>
        </section>

        <section class="cs-panel" data-panel="estimates">
            <h2>Estimates</h2>
            <div class="cs-form-grid">
                <label>Default tax labor rate<input id="default_tax_labor_rate" type="number" min="0" step="0.0001"></label>
                <label>Default tax material rate<input id="default_tax_material_rate" type="number" min="0" step="0.0001"></label>
                <label>Default overhead percentage<input id="default_overhead_percentage" type="number" min="0" step="0.0001"></label>
                <label>Default profit percentage<input id="default_profit_percentage" type="number" min="0" step="0.0001"></label>
                <label>Default waste percentage<input id="default_waste_percentage" type="number" min="0" step="0.0001"></label>
            </div>
        </section>

        <section class="cs-panel" data-panel="pdf">
            <h2>PDF Forms</h2>
            <div class="cs-form-grid">
                <label>Proposal template<input id="proposal_template"></label>
                <label>Logo visibility<select id="logo_visibility"><option value="1">Visible</option><option value="0">Hidden</option></select></label>
                <label class="full">Header/footer<textarea id="pdf_header_footer" rows="3"></textarea></label>
                <label class="full">Signature block<textarea id="signature_block" rows="3"></textarea></label>
            </div>
        </section>

        <section class="cs-panel" data-panel="costTypes">
            <div class="cs-list-head"><h2>Cost Types</h2><button class="cs-btn" data-add-list="cost_types">Add</button></div>
            <div id="costTypesList" class="cs-list"></div>
        </section>

        <section class="cs-panel" data-panel="projectStatuses">
            <div class="cs-list-head"><h2>Project Statuses</h2><button class="cs-btn" data-add-list="project_statuses">Add</button></div>
            <div id="projectStatusesList" class="cs-list"></div>
        </section>

        <section class="cs-panel" data-panel="users">
            <div class="cs-list-head"><h2>Users</h2><button class="cs-btn" id="csAddUser">Add</button></div>
            <div id="usersList" class="cs-list"></div>
        </section>

        <section class="cs-panel" data-panel="estimateTypes">
            <div class="cs-list-head"><h2>Estimate Types</h2><button class="cs-btn" data-add-list="estimate_types">Add</button></div>
            <div id="estimateTypesList" class="cs-list"></div>
        </section>
    </main>
</div>

<script src="../assets/company_settings.js"></script>
</body>
</html>
