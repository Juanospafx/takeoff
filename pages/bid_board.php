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
    <link rel="stylesheet" href="../assets/bid_board.css?v=project-action-menu-20260811-1">
</head>
<body>
<?php include __DIR__ . '/../views/global_tools_header.php'; ?>
<div class="bid-board-shell">
    <main class="bid-board-main">
        <section class="bb-page-head">
            <div class="bb-title-wrap">
                <div class="bb-module-icon"><i class="fas fa-gear"></i></div>
                <div>
                    <h1>Bid Board</h1>
                    <p>Bid management pipeline for invitations, active bidding, submissions and outcomes.</p>
                </div>
            </div>
            <div class="bb-page-actions">
                <button class="bb-btn primary" id="bbCreateProject"><i class="fas fa-plus"></i> Create New Project</button>
                <button class="bb-icon-btn bordered" type="button" title="More actions" aria-label="More actions"><i class="fas fa-ellipsis-vertical"></i></button>
            </div>
        </section>

        <div class="bb-alert" id="bbError" hidden></div>

        <section class="bb-pipeline-tabs" id="bbPipelineTabs" aria-label="Bid status pipeline"></section>

        <section class="bb-empty-state" id="bbEmptyState" hidden>
            <div class="bb-empty-icon"><i class="fas fa-folder-plus"></i></div>
            <h2>No projects yet</h2>
            <p>Create your first project to start managing bids, documents, takeoffs, estimates, and proposals.</p>
            <button class="bb-btn primary" type="button" data-open-project-modal><i class="fas fa-plus"></i> Create Project</button>
        </section>

        <section class="bb-table-controls" id="bbTableControls" aria-label="Bid table controls">
            <div class="bb-search-field">
                <input id="bbSearch" type="search" placeholder="Search projects">
                <i class="fas fa-magnifying-glass"></i>
            </div>
            <label class="bb-select-field">
                <span>Sort by</span>
                <select id="bbSortBy">
                    <option value="recordName">Name</option>
                    <option value="dueDate">Due Date</option>
                    <option value="totalValue">Total Sales</option>
                    <option value="requestingEntity">Requester Company</option>
                    <option value="responsible">Estimator</option>
                </select>
            </label>
            <button class="bb-icon-btn bordered" id="bbSortDir" type="button" title="Toggle sort direction" aria-label="Toggle sort direction">
                <i class="fas fa-arrow-down-wide-short"></i>
            </button>
            <button class="bb-btn secondary" id="bbFiltersBtn" type="button"><i class="fas fa-filter"></i> Filters</button>
        </section>

        <section class="bb-table-shell" aria-label="Bid records">
            <div class="bb-table-scroll">
                <table class="bb-table">
                    <colgroup>
                        <col class="bb-col-name">
                        <col class="bb-col-info">
                        <col class="bb-col-requester">
                        <col class="bb-col-project">
                        <col class="bb-col-due">
                        <col class="bb-col-sales">
                        <col class="bb-col-estimator">
                        <col class="bb-col-status">
                        <col class="bb-col-actions">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Name <i class="fas fa-sort"></i></th>
                            <th class="center">Info <i class="fas fa-sort"></i></th>
                            <th>Requester Company <i class="fas fa-sort"></i></th>
                            <th>Project <i class="fas fa-sort"></i></th>
                            <th>Due Date <i class="fas fa-sort"></i></th>
                            <th>Total Sales <i class="fas fa-sort"></i></th>
                            <th>Estimator <i class="fas fa-sort"></i></th>
                            <th>Status <i class="fas fa-sort"></i></th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="bbTableBody"></tbody>
                </table>
            </div>
        </section>
    </main>
</div>

<div class="bb-modal-backdrop" id="bbViewModal">
    <div class="bb-modal">
        <div class="bb-modal-head">
            <strong id="bbViewTitle">Bid</strong>
            <button class="bb-icon-btn bordered" type="button" data-close-modal aria-label="Close"><i class="fas fa-times"></i></button>
        </div>
        <div class="bb-modal-body" id="bbViewBody"></div>
        <div class="bb-modal-foot">
            <button class="bb-btn secondary" type="button" data-close-modal>Close</button>
        </div>
    </div>
</div>

<div class="bb-modal-backdrop" id="bbProjectModal">
    <div class="bb-modal">
        <form id="bbProjectForm">
            <div class="bb-modal-head">
                <strong>Create Project</strong>
                <button class="bb-icon-btn bordered" type="button" data-close-modal aria-label="Close"><i class="fas fa-times"></i></button>
            </div>
            <div class="bb-modal-body">
                <div class="bb-create-mode">
                    <label><input type="radio" name="bbProjectMode" value="template" checked> Create project from template</label>
                    <label><input type="radio" name="bbProjectMode" value="empty"> Create empty new project</label>
                </div>
                <div class="bb-form-grid">
                    <div class="bb-field full" id="bbProjectTemplateWrap">
                        <label>Template</label>
                        <select id="bbProjectTemplate"></select>
                    </div>
                </div>
            </div>
            <div class="bb-modal-foot">
                <button class="bb-btn secondary" type="button" data-close-modal>Cancel</button>
                <button class="bb-btn primary orange" type="submit">Confirm</button>
            </div>
        </form>
    </div>
</div>

<script src="../assets/global_tools.js"></script>
<script src="../assets/bid_board.js"></script>
</body>
</html>
