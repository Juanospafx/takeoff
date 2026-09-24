<?php
// Standalone Bid Board module. No auth/session dependency.
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Bid Board | Brightronix</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../assets/global_tools.css?v=brightronix-nohalo-v1">
    <script>
        (function () {
            try {
                var saved = localStorage.getItem('takeoff.theme');
                var theme = (saved === 'dark' || saved === 'light') ? saved : 'light';
                document.documentElement.setAttribute('data-theme', theme);
                document.addEventListener('DOMContentLoaded', function () {
                    document.body.classList.toggle('theme-light', theme === 'light');
                    document.body.classList.toggle('theme-dark', theme === 'dark');
                });
            } catch (error) {
                document.documentElement.setAttribute('data-theme', 'light');
            }
        })();
    </script>
    <link rel="stylesheet" href="../assets/bid_board.css?v=brightronix-nohalo-v1">
</head>
<body>
<?php include __DIR__ . '/../views/global_tools_header.php'; ?>
<div class="bid-board-shell">
    <main class="bid-board-main">
        <section class="bb-page-head">
            <div class="bb-title-wrap">
                <button class="bb-settings-icon-btn" type="button" aria-label="Company Settings" title="Company Settings" onclick="window.location.href='company_settings.php'">
                    <i class="fas fa-gear"></i>
                </button>
                <h1 class="bb-page-title">Bid Board</h1>
            </div>
            <div class="bb-page-actions">
                <button class="bb-btn-procore-primary" id="bbCreateProject" type="button">
                    <i class="fas fa-plus"></i> Create New Project
                </button>
                <div class="bb-head-actions-wrap">
                    <button class="bb-icon-btn" id="bbHeadMoreBtn" type="button" title="More actions" aria-label="More actions" aria-expanded="false">
                        <i class="fas fa-ellipsis-vertical"></i>
                    </button>
                    <div class="bb-head-actions-dropdown" id="bbHeadDropdown" hidden>
                        <button type="button" class="bb-head-dropdown-item" id="bbExportStageBtn">
                            <i class="fas fa-file-export"></i>
                            <span id="bbExportStageLabel">Export Projects</span>
                        </button>
                    </div>
                </div>
            </div>
        </section>

        <div class="bb-alert" id="bbError" hidden></div>

        <div class="bb-pipeline-tabs-wrapper">
            <section class="bb-pipeline-tabs" id="bbPipelineTabs" aria-label="Bid status pipeline"></section>
            <div class="bb-pipeline-more">
                <button class="bb-icon-btn" id="bbConfigPhasesBtn" type="button" aria-label="Configure pipeline phases" title="Customize Phases & Colors"><i class="fas fa-ellipsis-vertical"></i></button>
            </div>
        </div>

        <div class="bb-page-body">
            <section class="bb-empty-state" id="bbEmptyState" hidden>
                <div class="bb-empty-icon"><i class="fas fa-folder-plus"></i></div>
                <h2>No projects yet</h2>
                <p>Create your first project to start managing bids, documents, takeoffs, estimates, and proposals.</p>
                <button class="bb-btn-procore-primary" type="button" data-open-project-modal><i class="fas fa-plus"></i> Create Project</button>
            </section>

            <div class="bb-card-container">
                <section class="bb-table-controls" id="bbTableControls" aria-label="Bid table controls">
                    <div class="bb-search-field-procore">
                        <input id="bbSearch" type="search" placeholder="Search projects">
                        <button class="bb-search-submit" type="button" aria-label="Search"><i class="fas fa-magnifying-glass"></i></button>
                    </div>
                    <div class="bt-selector-wrap" id="bbSortByWrap">
                        <button class="bt-selector bt-company-tools-trigger bt-field-selector" id="bbSortByTrigger" type="button" aria-expanded="false" aria-haspopup="listbox" title="Sort projects">
                            <div class="bt-picker-lines">
                                <span class="bt-picker-top">Sort By</span>
                                <strong class="bt-picker-bottom" id="bbSortByText">Creation Date</strong>
                            </div>
                            <i class="fas fa-caret-down bt-picker-caret"></i>
                        </button>
                        <div class="bt-small-menu bt-field-menu" id="bbSortByMenu" role="listbox" hidden>
                            <div class="bt-field-menu-eyebrow">Sort projects by</div>
                            <div class="bt-field-menu-options">
                                <button type="button" class="bt-field-option active" data-value="createdAt">
                                    <span>Creation Date</span>
                                    <i class="fas fa-check bt-option-check"></i>
                                </button>
                                <button type="button" class="bt-field-option" data-value="recordName">
                                    <span>Name</span>
                                    <i class="fas fa-check bt-option-check"></i>
                                </button>
                                <button type="button" class="bt-field-option" data-value="dueDate">
                                    <span>Due Date</span>
                                    <i class="fas fa-check bt-option-check"></i>
                                </button>
                                <button type="button" class="bt-field-option" data-value="totalValue">
                                    <span>Total Sales</span>
                                    <i class="fas fa-check bt-option-check"></i>
                                </button>
                                <button type="button" class="bt-field-option" data-value="requestingEntity">
                                    <span>Requester Company</span>
                                    <i class="fas fa-check bt-option-check"></i>
                                </button>
                                <button type="button" class="bt-field-option" data-value="responsible">
                                    <span>Estimator</span>
                                    <i class="fas fa-check bt-option-check"></i>
                                </button>
                            </div>
                        </div>
                        <select id="bbSortBy" class="bb-visually-hidden" aria-hidden="true" tabindex="-1">
                            <option value="createdAt" selected>Creation Date</option>
                            <option value="recordName">Name</option>
                            <option value="dueDate">Due Date</option>
                            <option value="totalValue">Total Sales</option>
                            <option value="requestingEntity">Requester Company</option>
                            <option value="responsible">Estimator</option>
                        </select>
                    </div>
                    <button class="bb-control-btn" id="bbSortDir" type="button" title="Toggle sort direction" aria-label="Toggle sort direction">
                        <i class="fas fa-arrow-down"></i>
                    </button>
                    <button class="bb-control-btn" id="bbFiltersBtn" type="button" title="Toggle Filters" aria-label="Filters">
                        <i class="fas fa-filter"></i>
                        <span class="bb-filter-badge" id="bbFilterActiveBadge" hidden>0</span>
                    </button>
                </section>

                <div class="bb-filters-panel" id="bbFiltersPanel" hidden>
                    <div class="bb-filters-grid">
                        <div class="bb-filter-col">
                            <label for="bbFilterEstimator">Estimator</label>
                            <select id="bbFilterEstimator">
                                <option value="">All Estimators</option>
                            </select>
                        </div>
                        <div class="bb-filter-col">
                            <label for="bbFilterRequester">Requester Company / Email</label>
                            <input id="bbFilterRequester" type="text" placeholder="Filter by company or email">
                        </div>
                        <div class="bb-filter-col">
                            <label for="bbFilterDueDate">Due Date</label>
                            <select id="bbFilterDueDate">
                                <option value="">All Due Dates</option>
                                <option value="overdue">Past Due</option>
                                <option value="next7">Due in next 7 days</option>
                                <option value="next30">Due in next 30 days</option>
                                <option value="none">No Due Date</option>
                            </select>
                        </div>
                        <div class="bb-filter-col">
                            <label>Sales Value Range ($)</label>
                            <div class="bb-range-group">
                                <input id="bbFilterMinSales" type="number" placeholder="Min $" min="0" step="500">
                                <span>to</span>
                                <input id="bbFilterMaxSales" type="number" placeholder="Max $" min="0" step="500">
                            </div>
                        </div>
                    </div>
                    <div class="bb-filters-footer">
                        <div class="bb-filters-meta">
                            <span id="bbFiltersMatchCount">Showing all projects</span>
                        </div>
                        <div class="bb-filters-actions">
                            <button class="bb-btn-ghost" id="bbClearFiltersBtn" type="button">Clear Filters</button>
                            <button class="bb-btn-procore-primary small" id="bbApplyFiltersBtn" type="button">Apply Filters</button>
                        </div>
                    </div>
                </div>

                <section class="bb-table-shell" aria-label="Bid records">
                    <div class="bb-table-scroll">
                        <table class="bb-table">
                            <thead>
                                <tr>
                                    <th class="bb-col-name sortable" data-sort="recordName">
                                        <div class="bb-th-flex"><span>Name</span> <i class="fas fa-sort"></i></div>
                                    </th>
                                    <th class="bb-col-info">
                                        <div class="bb-th-flex bb-th-center"><span>Info</span></div>
                                    </th>
                                    <th class="bb-col-requester">
                                        <div class="bb-th-flex"><span>Requester Company</span></div>
                                    </th>
                                    <th class="bb-col-project sortable" data-sort="projectId">
                                        <div class="bb-th-flex"><span>Project</span> <i class="fas fa-sort"></i></div>
                                    </th>
                                    <th class="bb-col-due sortable" data-sort="dueDate">
                                        <div class="bb-th-flex"><span>Due Date</span> <i class="fas fa-sort"></i></div>
                                    </th>
                                    <th class="bb-col-sales sortable" data-sort="totalValue">
                                        <div class="bb-th-flex"><span>Total Sales</span> <i class="fas fa-sort"></i></div>
                                    </th>
                                    <th class="bb-col-estimator">
                                        <div class="bb-th-flex"><span>Estimator</span></div>
                                    </th>
                                    <th class="bb-col-status">
                                        <div class="bb-th-flex"><span>Status</span></div>
                                    </th>
                                    <th class="bb-col-actions"></th>
                                </tr>
                            </thead>
                            <tbody id="bbTableBody"></tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    </main>

    <footer class="bb-brightronix-footer">
        <span>All Rights Reserved by Brightronix &copy; 2026</span>
    </footer>
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
    <div class="bb-modal bb-create-project-modal">
        <form id="bbProjectForm">
            <div class="bb-modal-head">
                <div class="bb-modal-title-wrap">
                    <div class="bb-modal-icon-badge">
                        <i class="fas fa-folder-plus"></i>
                    </div>
                    <div>
                        <strong class="bb-modal-heading">Create New Project</strong>
                        <div class="bb-modal-subheading">Set up a takeoff workspace to start estimating quantities and drafting proposals</div>
                    </div>
                </div>
                <button class="bb-icon-btn" type="button" data-close-modal aria-label="Close"><i class="fas fa-times"></i></button>
            </div>
            <div class="bb-modal-body">
                <div class="bb-modal-section-title">CHOOSE PROJECT SETUP</div>
                <div class="bb-create-mode-cards">
                    <label class="bb-mode-card active" data-mode-card="template">
                        <input type="radio" name="bbProjectMode" value="template" checked class="bb-mode-radio">
                        <div class="bb-mode-card-header">
                            <div class="bb-mode-icon-wrap"><i class="fas fa-layer-group"></i></div>
                            <span class="bb-mode-badge">Recommended</span>
                        </div>
                        <div class="bb-mode-title">From Template</div>
                        <p class="bb-mode-desc">Pre-loads CSI cost items, default assemblies, markup rates, and standard bid takeoff structures ready to estimate.</p>
                    </label>
                    <label class="bb-mode-card" data-mode-card="empty">
                        <input type="radio" name="bbProjectMode" value="empty" class="bb-mode-radio">
                        <div class="bb-mode-card-header">
                            <div class="bb-mode-icon-wrap"><i class="fas fa-file-circle-plus"></i></div>
                        </div>
                        <div class="bb-mode-title">Blank Project</div>
                        <p class="bb-mode-desc">Starts with a clean slate with zero predefined items. Ideal for custom specialty takeoffs or unique bids.</p>
                    </label>
                </div>

                <div class="bb-form-section">
                    <div class="bb-form-group">
                        <label class="bb-form-label" for="bbProjectName">
                            <span>Project Name</span>
                            <span class="bb-required-dot">*</span>
                        </label>
                        <div class="bb-input-icon-wrap">
                            <i class="fas fa-building bb-input-icon"></i>
                            <input id="bbProjectName" type="text" class="bb-input-control" placeholder="e.g. Commercial Plaza - Electrical Bid" required value="New Project">
                        </div>
                        <div class="bb-input-hint">Enter a descriptive title for this bid and related customer proposals.</div>
                    </div>

                    <div class="bb-form-group" id="bbProjectTemplateWrap">
                        <label class="bb-form-label" for="bbProjectTemplate">
                            <span>Estimating Template</span>
                            <span class="bb-required-dot">*</span>
                        </label>
                        <div class="bb-input-icon-wrap">
                            <i class="fas fa-shapes bb-input-icon"></i>
                            <select id="bbProjectTemplate" class="bb-select-control"></select>
                        </div>
                        <div class="bb-input-hint">Select the template library containing the cost assemblies and measurement tools.</div>
                    </div>
                </div>
            </div>
            <div class="bb-modal-foot">
                <button class="bb-btn-procore-secondary" type="button" data-close-modal>Cancel</button>
                <button class="bb-btn-procore-primary" type="submit">
                    <i class="fas fa-check"></i> Create Project
                </button>
            </div>
        </form>
    </div>
</div>

<div class="bb-modal-backdrop" id="bbPhaseConfigModal">
    <div class="bb-modal bb-phase-modal">
        <div class="bb-modal-head">
            <div class="bb-modal-title-wrap">
                <i class="fas fa-sliders" style="color: #ff5100; font-size: 18px;"></i>
                <strong>Customize Pipeline Phases & Colors</strong>
            </div>
            <button class="bb-icon-btn bordered" type="button" data-close-modal aria-label="Close"><i class="fas fa-times"></i></button>
        </div>
        <div class="bb-modal-body">
            <p class="bb-modal-desc">Rename each pipeline phase button and customize its color indicator across the Bid Board and Status badges.</p>
            <div class="bb-phase-list" id="bbPhaseList"></div>
        </div>
        <div class="bb-modal-foot">
            <button class="bb-btn secondary" id="bbPhaseResetBtn" type="button">Reset Defaults</button>
            <button class="bb-btn secondary" type="button" data-close-modal>Cancel</button>
            <button class="bb-btn-procore-primary" id="bbPhaseSaveBtn" type="button">Save Changes</button>
        </div>
    </div>
</div>

<div class="bb-floating-row-menu" id="bbFloatingRowMenu" hidden>
    <a href="#" id="bbActionOpen"><i class="fas fa-arrow-up-right-from-square"></i> Open</a>
    <button type="button" id="bbActionDuplicate"><i class="fas fa-copy"></i> Duplicate</button>
    <button type="button" id="bbActionArchive"><i class="fas fa-box-archive"></i> Archive</button>
    <button type="button" class="danger" id="bbActionDelete"><i class="fas fa-trash-can"></i> Delete</button>
</div>

<script src="../assets/global_tools.js"></script>
<script src="../assets/bid_board.js?v=procore-20260923-v8"></script>
</body>
</html>
