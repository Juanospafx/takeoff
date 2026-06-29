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
    <header class="bb-global-header">
        <div class="bb-global-left">
            <a class="bb-logo" href="/pages/index.php" aria-label="Brightronix home">
                <span class="bb-logo-mark">B</span>
                <span class="bb-logo-text">Brightronix</span>
            </a>
            <button class="bb-context-btn" type="button"><span>Brightronix Electric</span><i class="fas fa-chevron-down"></i></button>
            <button class="bb-context-btn" type="button"><span>Preconstruction</span><i class="fas fa-chevron-down"></i></button>
        </div>
        <nav class="bb-global-center" aria-label="Workspace shortcuts">
            <a href="/pages/bid_board.php" class="active">Favorites</a>
            <a href="/pages/project_module.php">Recent</a>
            <a href="/pages/takeoff.php">Pinned</a>
        </nav>
        <div class="bb-global-right">
            <button class="bb-icon-btn" type="button" title="Help" aria-label="Help"><i class="far fa-circle-question"></i></button>
            <button class="bb-icon-btn" type="button" title="Notifications" aria-label="Notifications"><i class="far fa-bell"></i></button>
            <div class="bb-user-avatar" title="Juan Pablo">JP</div>
        </div>
    </header>

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
                <button class="bb-btn primary" id="bbNewBid"><i class="fas fa-plus"></i> New Bid</button>
                <button class="bb-icon-btn bordered" type="button" title="More actions" aria-label="More actions"><i class="fas fa-ellipsis-vertical"></i></button>
            </div>
        </section>

        <div class="bb-alert" id="bbError" hidden></div>

        <section class="bb-pipeline-tabs" id="bbPipelineTabs" aria-label="Bid status pipeline"></section>

        <section class="bb-table-controls" aria-label="Bid table controls">
            <div class="bb-search-field">
                <input id="bbSearch" type="search" placeholder="Search bids...">
                <i class="fas fa-magnifying-glass"></i>
            </div>
            <label class="bb-select-field">
                <span>Sort by</span>
                <select id="bbSortBy">
                    <option value="dueDate">Due Date</option>
                    <option value="totalValue">Total Value</option>
                    <option value="recordName">Record Name</option>
                    <option value="requestingEntity">Requesting Entity</option>
                    <option value="responsible">Responsible</option>
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
                    <thead>
                        <tr>
                            <th>Record Name <i class="fas fa-sort"></i></th>
                            <th class="center">Metrics <i class="fas fa-sort"></i></th>
                            <th>Requesting Entity <i class="fas fa-sort"></i></th>
                            <th>ID / Project <i class="fas fa-sort"></i></th>
                            <th>Due Date <i class="fas fa-sort"></i></th>
                            <th>Total Value <i class="fas fa-sort"></i></th>
                            <th>Responsible <i class="fas fa-sort"></i></th>
                            <th>Status <i class="fas fa-sort"></i></th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="bbTableBody"></tbody>
                </table>
            </div>
        </section>
    </main>
</div>

<div class="bb-modal-backdrop" id="bbEditModal">
    <div class="bb-modal">
        <form id="bbBidForm">
            <div class="bb-modal-head">
                <strong id="bbModalTitle">New Bid</strong>
                <button class="bb-icon-btn bordered" type="button" data-close-modal aria-label="Close"><i class="fas fa-times"></i></button>
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
                        <label>Total Value</label>
                        <input id="bbTotalSales" type="number" min="0" step="0.01">
                    </div>
                    <div class="bb-field">
                        <label>Currency</label>
                        <input id="bbCurrency" maxlength="3" value="USD">
                    </div>
                    <div class="bb-field">
                        <label>Responsible</label>
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
                <button class="bb-btn secondary" type="button" data-close-modal>Cancel</button>
                <button class="bb-btn primary" type="submit">Save</button>
            </div>
        </form>
    </div>
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
                <strong>Create New Project</strong>
                <button class="bb-icon-btn bordered" type="button" data-close-modal aria-label="Close"><i class="fas fa-times"></i></button>
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
                <button class="bb-btn secondary" type="button" data-close-modal>Cancel</button>
                <button class="bb-btn primary" type="submit">Create Project</button>
            </div>
        </form>
    </div>
</div>

<script src="../assets/bid_board.js"></script>
</body>
</html>
