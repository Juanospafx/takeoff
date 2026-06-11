<?php
// Standalone Project module. No auth/session dependency.
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Projects | Brightronix</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../assets/project_module.css">
</head>
<body>
<div class="pm-shell">
    <aside class="pm-side">
        <div class="pm-brand">
            <div class="pm-brand-icon"><i class="fas fa-folder-tree"></i></div>
            <span>Projects</span>
        </div>
        <nav class="pm-nav">
            <a class="active" href="/pages/project_module.php"><i class="fas fa-list"></i><span>Project List</span></a>
            <a href="/pages/bid_board.php"><i class="fas fa-table-columns"></i><span>Bid Board</span></a>
            <a href="/pages/cost_catalog.php"><i class="fas fa-book"></i><span>Cost Catalog</span></a>
            <a href="/pages/company_settings.php"><i class="fas fa-gear"></i><span>Settings</span></a>
            <a href="/pages/takeoff.php"><i class="fas fa-ruler-combined"></i><span>Takeoff</span></a>
        </nav>
    </aside>

    <main class="pm-main">
        <div class="pm-topbar">
            <div class="pm-title">
                <h1>Projects</h1>
                <p>Create, copy, archive, delete and inspect project records.</p>
            </div>
            <div class="pm-actions">
                <button class="pm-btn primary" id="pmCreateProject"><i class="fas fa-plus"></i> Create Project</button>
            </div>
        </div>

        <div id="pmError" style="display:none;background:#7f1d1d;color:#fecaca;border:1px solid #991b1b;border-radius:8px;padding:12px;margin-bottom:16px;"></div>

        <div class="pm-layout">
            <section class="pm-card">
                <div class="pm-card-head">
                    <strong>Project List</strong>
                </div>
                <div class="pm-table-wrap">
                    <table class="pm-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Client</th>
                                <th>Template</th>
                                <th>Status</th>
                                <th>Bid Due</th>
                                <th>Updated</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="pmTableBody"></tbody>
                    </table>
                </div>
            </section>

            <section class="pm-card" id="pmDetail"></section>
        </div>
    </main>
</div>

<div class="pm-modal-backdrop" id="pmEditModal">
    <div class="pm-modal">
        <form id="pmProjectForm">
            <div class="pm-modal-head">
                <strong id="pmModalTitle">Create Project</strong>
                <button class="pm-btn" type="button" data-close-modal><i class="fas fa-times"></i></button>
            </div>
            <div class="pm-modal-body">
                <div class="pm-create-mode">
                    <label><input type="radio" name="pmCreateMode" value="empty" checked> Empty Project</label>
                    <label><input type="radio" name="pmCreateMode" value="template"> Project From Template</label>
                </div>
                <div class="pm-form-grid">
                    <div class="pm-field full" id="pmTemplateWrap" style="display:none;">
                        <label>Template</label>
                        <select id="pmTemplate"></select>
                    </div>
                    <div class="pm-field full">
                        <label>Name</label>
                        <input id="pmName" required>
                    </div>
                    <div class="pm-field">
                        <label>Project Number</label>
                        <input id="pmProjectNumber">
                    </div>
                    <div class="pm-field">
                        <label>Client</label>
                        <input id="pmClientName">
                    </div>
                    <div class="pm-field">
                        <label>Status</label>
                        <select id="pmStatus">
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                            <option value="on_hold">On Hold</option>
                            <option value="archived">Archived</option>
                        </select>
                    </div>
                    <div class="pm-field">
                        <label>Bid Due</label>
                        <input id="pmBidDue" type="date">
                    </div>
                    <div class="pm-field">
                        <label>Start Date</label>
                        <input id="pmStartDate" type="date">
                    </div>
                    <div class="pm-field">
                        <label>End Date</label>
                        <input id="pmEndDate" type="date">
                    </div>
                    <div class="pm-field full">
                        <label>Address</label>
                        <input id="pmAddress">
                    </div>
                    <div class="pm-field">
                        <label>City</label>
                        <input id="pmCity">
                    </div>
                    <div class="pm-field">
                        <label>State</label>
                        <input id="pmState">
                    </div>
                    <div class="pm-field">
                        <label>Postal Code</label>
                        <input id="pmPostalCode">
                    </div>
                    <div class="pm-field">
                        <label>Country</label>
                        <input id="pmCountry">
                    </div>
                    <div class="pm-field full">
                        <label>Description</label>
                        <textarea id="pmDescription" rows="3"></textarea>
                    </div>
                </div>
            </div>
            <div class="pm-modal-foot">
                <button class="pm-btn" type="button" data-close-modal>Cancel</button>
                <button class="pm-btn primary" type="submit">Save Project</button>
            </div>
        </form>
    </div>
</div>

<script src="../assets/project_module.js"></script>
</body>
</html>
