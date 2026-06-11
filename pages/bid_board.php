<?php
// Standalone Bid Board module. No auth/session dependency.
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Bid Board | Brightronix</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../assets/bid_board.css">
</head>
<body>
<div class="bid-board-shell">
    <aside class="bid-board-side">
        <div class="bid-board-brand">
            <div class="bid-board-brand-icon"><i class="fas fa-table-columns"></i></div>
            <span>Bid Board</span>
        </div>
        <nav class="bid-board-nav-list">
            <a class="active" href="/pages/bid_board.php"><i class="fas fa-chart-line"></i><span>Pipeline</span></a>
            <a href="/pages/project_module.php"><i class="fas fa-folder-tree"></i><span>Projects</span></a>
            <a href="/pages/cost_catalog.php"><i class="fas fa-book"></i><span>Cost Catalog</span></a>
        </nav>
    </aside>

    <main class="bid-board-main">
        <div class="bid-board-topbar">
            <div class="bid-board-title">
                <h1>Bid Board</h1>
                <p>Pipeline dashboard for bid invitations, estimating, submissions and outcomes.</p>
            </div>
            <div class="bid-board-actions">
                <button class="bb-btn primary" id="bbNewBid"><i class="fas fa-plus"></i> New Bid</button>
            </div>
        </div>

        <div class="alert" id="bbError" style="display:none;background:#7f1d1d;color:#fecaca;border:1px solid #991b1b;border-radius:8px;padding:12px;margin-bottom:16px;"></div>

        <section class="bb-filters">
            <div class="bb-field">
                <label>Search</label>
                <input id="bbSearch" placeholder="Search bids, requester, project">
            </div>
            <div class="bb-field">
                <label>Status Filter</label>
                <select id="bbStatusFilter"></select>
            </div>
        </section>

        <section class="bb-dashboard" id="bbDashboard"></section>

        <section class="bb-pipeline" id="bbPipeline"></section>

        <section class="bb-table-wrap">
            <table class="bb-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Requester Company</th>
                        <th>Project</th>
                        <th>Due Date</th>
                        <th>Total Sales</th>
                        <th>Estimator</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="bbTableBody"></tbody>
            </table>
        </section>
    </main>
</div>

<div class="bb-modal-backdrop" id="bbEditModal">
    <div class="bb-modal">
        <form id="bbBidForm">
            <div class="bb-modal-head">
                <strong id="bbModalTitle">New Bid</strong>
                <button class="bb-btn" type="button" data-close-modal><i class="fas fa-times"></i></button>
            </div>
            <div class="bb-modal-body">
                <div class="bb-form-grid">
                    <div class="bb-field full">
                        <label>Name</label>
                        <input id="bbName" required>
                    </div>
                    <div class="bb-field">
                        <label>Requester Company</label>
                        <input id="bbRequesterCompany">
                    </div>
                    <div class="bb-field">
                        <label>Project</label>
                        <input id="bbProjectName" placeholder="Project module pending">
                    </div>
                    <div class="bb-field">
                        <label>Due Date</label>
                        <input id="bbDueDate" type="date">
                    </div>
                    <div class="bb-field">
                        <label>Total Sales</label>
                        <input id="bbTotalSales" type="number" min="0" step="0.01">
                    </div>
                    <div class="bb-field">
                        <label>Currency</label>
                        <input id="bbCurrency" maxlength="3" value="USD">
                    </div>
                    <div class="bb-field">
                        <label>Estimator</label>
                        <select id="bbEstimator"></select>
                    </div>
                    <div class="bb-field">
                        <label>Status</label>
                        <select id="bbStatus"></select>
                    </div>
                    <div class="bb-field full">
                        <label>Notes</label>
                        <textarea id="bbNotes" rows="3"></textarea>
                    </div>
                </div>
            </div>
            <div class="bb-modal-foot">
                <button class="bb-btn" type="button" data-close-modal>Cancel</button>
                <button class="bb-btn primary" type="submit">Save</button>
            </div>
        </form>
    </div>
</div>

<div class="bb-modal-backdrop" id="bbViewModal">
    <div class="bb-modal">
        <div class="bb-modal-head">
            <strong id="bbViewTitle">Bid</strong>
            <button class="bb-btn" type="button" data-close-modal><i class="fas fa-times"></i></button>
        </div>
        <div class="bb-modal-body" id="bbViewBody"></div>
        <div class="bb-modal-foot">
            <button class="bb-btn" type="button" data-close-modal>Close</button>
        </div>
    </div>
</div>

<div class="bb-modal-backdrop" id="bbProjectModal">
    <div class="bb-modal">
        <form id="bbProjectForm">
            <div class="bb-modal-head">
                <strong>Create New Project</strong>
                <button class="bb-btn" type="button" data-close-modal><i class="fas fa-times"></i></button>
            </div>
            <div class="bb-modal-body">
                <div class="bb-create-mode">
                    <label><input type="radio" name="bbProjectMode" value="template" checked> Create project from template</label>
                    <label><input type="radio" name="bbProjectMode" value="empty"> Create empty new project</label>
                </div>
                <div class="bb-form-grid">
                    <div class="bb-field full">
                        <label>Project Name</label>
                        <input id="bbProjectCreateName" required>
                    </div>
                    <div class="bb-field full" id="bbProjectTemplateWrap">
                        <label>Template</label>
                        <select id="bbProjectTemplate"></select>
                    </div>
                    <div class="bb-field full">
                        <label>Source Bid</label>
                        <input id="bbProjectSourceBid" disabled>
                    </div>
                </div>
            </div>
            <div class="bb-modal-foot">
                <button class="bb-btn" type="button" data-close-modal>Cancel</button>
                <button class="bb-btn primary" type="submit">Create Project</button>
            </div>
        </form>
    </div>
</div>

<script src="../assets/bid_board.js"></script>
</body>
</html>
